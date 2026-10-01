/**
 * Indexes the markdown knowledge base. Server-only — imports node:fs.
 *
 * These documents are small (the whole corpus is well under a megabyte), so
 * unlike the session transcripts they're read in full and cached on mtime.
 */
import fsp from "node:fs/promises";
import path from "node:path";

import { lessonId, readLesson } from "./lessons";
import { parseNoteSections, upsertNoteSection } from "./notes";
import { resolvePlaceholders } from "./placeholders";
import { parseMarkdown, toggleCheckbox } from "./parse";
import {
  CLAUDE_DIR,
  getRoots,
  isTrackDoc,
  repoRoot,
  resolveDocPath,
} from "./roots";
import { readState } from "./state";
import type { CollectionKind, DocDetail, DocSummary, Topic } from "./types";

type TranscriptTopics = Topic[];

const WORDS_PER_MINUTE = 220;
const SEARCH_TEXT_MAX = 4000;

type CachedDoc = {
  stamp: string;
  summary: Omit<
    DocSummary,
    "archived" | "archivedAt" | "archiveNote" | "hasNote" | "noteWords"
  >;
  topics: Topic[];
  markdown: string;
};

const cache = new Map<string, CachedDoc>();

async function listMarkdown(
  dir: string,
  recursive: boolean,
  exclude: string[],
): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return; // Configured root that doesn't exist yet is not an error.
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        if (depth === 0 && exclude.includes(entry.name)) continue;
        if (recursive) await walk(full, depth + 1);
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        out.push(full);
      }
    }
  }
  await walk(dir, 0);
  return out;
}

async function loadDoc(
  absolute: string,
  id: string,
  collection: string,
  collectionKind: CollectionKind,
): Promise<CachedDoc> {
  const stat = await fsp.stat(absolute);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const cached = cache.get(absolute);
  if (cached && cached.stamp === stamp) return cached;

  const markdown = resolvePlaceholders(await fsp.readFile(absolute, "utf8"));
  const parsed = parseMarkdown(markdown);
  const base = path.basename(absolute, ".md");
  const moduleNumber = /^\d{2}\b/.test(base) ? base.slice(0, 2) : null;

  const entry: CachedDoc = {
    stamp,
    markdown,
    topics: parsed.topics,
    summary: {
      id,
      collection,
      collectionKind,
      title: parsed.title || base.replace(/[-_]/g, " "),
      summary: parsed.summary.slice(0, 400),
      moduleNumber,
      prerequisites: parsed.prerequisites,
      timeEstimate: parsed.timeEstimate,
      headings: parsed.headings.slice(0, 40),
      audit: parsed.audit,
      topicCount: parsed.topics.length,
      topicsDone: parsed.topics.filter((t) => t.done).length,
      lessonsWritten: 0,
      wordCount: parsed.wordCount,
      readingMinutes: Math.max(
        1,
        Math.round(parsed.wordCount / WORDS_PER_MINUTE),
      ),
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      searchText: `${parsed.title} ${id} ${markdown}`
        .toLowerCase()
        .slice(0, SEARCH_TEXT_MAX),
    },
  };
  cache.set(absolute, entry);
  return entry;
}

/** How many of a module's topics already have a lesson written. */
async function countLessons(
  id: string,
  topics: TranscriptTopics,
): Promise<number> {
  const found = await Promise.all(topics.map((topic) => readLesson(id, topic)));
  return found.filter(Boolean).length;
}

/**
 * Your own explanation for a module, stored beside it inside its track:
 * `<track>/notes/<module>.md`.
 */
function notePathFor(id: string): string | null {
  if (!isTrackDoc(id)) return null;
  const moduleDir = path.dirname(path.resolve(repoRoot(), id));
  return path.join(moduleDir, "notes", `${path.basename(id, ".md")}.md`);
}

async function readNote(id: string): Promise<string | null> {
  const file = notePathFor(id);
  if (!file) return null;
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function indexDocs(): Promise<DocSummary[]> {
  const state = await readState();
  const docs: DocSummary[] = [];

  const roots = await getRoots();
  for (const collection of roots) {
    const dir = path.resolve(collection.base, collection.dir);
    const files = await listMarkdown(
      dir,
      collection.recursive,
      collection.exclude,
    );
    for (const absolute of files) {
      const id = path.relative(collection.base, absolute);
      try {
        const loaded = await loadDoc(
          absolute,
          id,
          collection.id,
          collection.kind,
        );
        const note = await readNote(id);
        const lessonsWritten = await countLessons(id, loaded.topics);
        const archived = state.archived[id];
        docs.push({
          ...loaded.summary,
          lessonsWritten,
          archived: Boolean(archived),
          archivedAt: archived?.at ?? null,
          archiveNote: archived?.note ?? null,
          hasNote: Boolean(note && note.trim()),
          noteWords: note ? note.split(/\s+/).filter(Boolean).length : 0,
        });
      } catch {
        // Unreadable file — skip rather than failing the whole index.
      }
    }
  }

  return docs.sort((a, b) => {
    if (a.collection !== b.collection) {
      return (
        roots.findIndex((r) => r.id === a.collection) -
        roots.findIndex((r) => r.id === b.collection)
      );
    }
    if (a.moduleNumber && b.moduleNumber)
      return a.moduleNumber.localeCompare(b.moduleNumber);
    return a.title.localeCompare(b.title);
  });
}

export async function getDoc(id: string): Promise<DocDetail | null> {
  const absolute = await resolveDocPath(id);
  if (!absolute) return null;
  const roots = await getRoots();
  const root = roots.find(
    (r) => id.startsWith(r.dir + "/") || path.dirname(id) === r.dir,
  );

  let loaded: CachedDoc;
  try {
    loaded = await loadDoc(
      absolute,
      id,
      root?.id ?? "unknown",
      root?.kind ?? "reference",
    );
  } catch {
    return null;
  }

  const state = await readState();
  const archived = state.archived[id];
  const note = await readNote(id);

  // Lessons are the teaching material; notes are what you wrote back.
  const noteSections = parseNoteSections(note);
  const topics = await Promise.all(
    loaded.topics.map(async (topic) => ({
      ...topic,
      lesson: await readLesson(id, topic),
      lessonId: lessonId(id, topic),
      note: noteSections.get(topic.title) ?? null,
    })),
  );

  // Related = other docs that reference at least one of the same audit items.
  const all = await indexDocs();
  const related = loaded.summary.audit.length
    ? all
        .filter(
          (d) =>
            d.id !== id &&
            d.audit.some((a) => loaded.summary.audit.includes(a)),
        )
        .slice(0, 8)
        .map((d) => ({ id: d.id, title: d.title, collection: d.collection }))
    : [];

  return {
    summary: {
      ...loaded.summary,
      // Counted from the topics resolved just above, not re-read from disk.
      lessonsWritten: topics.filter((t) => t.lesson).length,
      archived: Boolean(archived),
      archivedAt: archived?.at ?? null,
      archiveNote: archived?.note ?? null,
      hasNote: Boolean(note && note.trim()),
      noteWords: note ? note.split(/\s+/).filter(Boolean).length : 0,
    },
    markdown: loaded.markdown,
    topics,
    note,
    related,
  };
}

/** Ticks or unticks one checkbox, writing the change into the markdown file. */
export async function setTopicDone(
  id: string,
  index: number,
  done: boolean,
): Promise<{ topicsDone: number; topicCount: number } | null> {
  const absolute = await resolveDocPath(id);
  if (!absolute) return null;
  const raw = await fsp.readFile(absolute, "utf8");
  const next = toggleCheckbox(raw, index, done);
  if (next === null) return null;
  await fsp.writeFile(absolute, next, "utf8");
  cache.delete(absolute);
  const parsed = parseMarkdown(next);
  return {
    topicsDone: parsed.topics.filter((t) => t.done).length,
    topicCount: parsed.topics.length,
  };
}

/**
 * Writes your own explanation to <track>/notes/<module>.md. With a topicTitle
 * it replaces just that topic's section, leaving the rest of the file alone;
 * without one it rewrites the whole file (the raw editor).
 */
export async function saveNote(
  id: string,
  body: string,
  topicTitle?: string,
): Promise<boolean> {
  // Same gate as every other write: refuses ids outside a visible root.
  if (!(await resolveDocPath(id))) return false;
  const file = notePathFor(id);
  if (!file) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true });

  let next = body;
  if (topicTitle) {
    const doc = await getDoc(id);
    if (!doc) return false;
    next = upsertNoteSection(await readNote(id), {
      moduleTitle: doc.summary.title,
      topicTitle,
      body,
      topicOrder: doc.topics.map((t) => t.title),
    });
  }
  await fsp.writeFile(file, next.endsWith("\n") ? next : next + "\n", "utf8");
  return true;
}

/** Files a markdown document into understand/claude/. Used by "Save to Understand". */
export async function saveClaudeDoc(
  filename: string,
  body: string,
): Promise<string | null> {
  const safe = filename
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!safe || !safe.endsWith(".md")) return null;
  const dir = path.join(repoRoot(), CLAUDE_DIR);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, safe), body, "utf8");
  return `${CLAUDE_DIR}/${safe}`;
}
