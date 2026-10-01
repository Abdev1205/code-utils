/**
 * Reads Claude Code session transcripts off disk. Server-only — imports node:fs.
 *
 * The whole corpus is well over 100 MB, so nothing here ever loads a file into
 * memory whole. Files are streamed line by line, the list view keeps only small
 * per-session metadata, and full transcripts are parsed on demand for one
 * session at a time.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import {
  applyToolResult,
  attachToolResult,
  bodyWeight,
  buildToolBody,
  buildToolCall,
  clip,
  contentThinking,
  contentToText,
  countImages,
  decodeProjectKey,
  isHumanPrompt,
  MESSAGE_TEXT_MAX,
  stripNoise,
  THINKING_MAX,
  TOOL_INLINE_MAX,
} from "./parse";
import type {
  SessionDetail,
  SessionSummary,
  ToolCall,
  ToolCallBody,
  TranscriptEntry,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SEARCH_TEXT_MAX = 8000;
const PROMPT_PREVIEW_MAX = 400;
/** Transcript entries per page on the detail view. */
export const TRANSCRIPT_PAGE_SIZE = 250;

export function sessionsRoot(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ??
    path.join(os.homedir(), ".claude", "projects")
  );
}

type SessionFile = {
  id: string;
  projectKey: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
};

async function listSessionFiles(): Promise<SessionFile[]> {
  const root = sessionsRoot();
  let projectDirs: string[];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const files: SessionFile[] = [];
  for (const projectKey of projectDirs) {
    const dir = path.join(root, projectKey);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, name);
      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) continue;
        files.push({
          id: name.slice(0, -".jsonl".length),
          projectKey,
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Session removed between readdir and stat — skip it.
      }
    }
  }
  return files;
}

async function countSubagents(file: SessionFile): Promise<number> {
  const dir = path.join(path.dirname(file.filePath), file.id, "subagents");
  try {
    const names = await fsp.readdir(dir);
    return names.filter((n) => n.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

/** Yields one parsed JSON object per line, skipping anything unparseable. */
async function* readEntries(filePath: string): AsyncGenerator<any> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Partially written line (session still live) — ignore.
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

function pushUnique(list: string[], value: unknown): void {
  if (typeof value !== "string" || !value) return;
  if (!list.includes(value)) list.push(value);
}

async function buildSummary(file: SessionFile): Promise<SessionSummary> {
  const summary: SessionSummary = {
    id: file.id,
    projectKey: file.projectKey,
    projectPath: "",
    projectLabel: "",
    lastCwd: null,
    transcriptPath: file.filePath,
    title: "",
    hasAiTitle: false,
    firstPrompt: "",
    lastPrompt: "",
    gitBranch: null,
    startedAt: null,
    lastActivityAt: null,
    activeMs: 0,
    userMsgCount: 0,
    assistantMsgCount: 0,
    toolCallCount: 0,
    toolCounts: {},
    models: [],
    efforts: [],
    outputTokens: 0,
    cacheReadTokens: 0,
    mcpServers: [],
    skills: [],
    subagentCount: await countSubagents(file),
    sizeBytes: file.sizeBytes,
    entryCount: 0,
    claudeVersions: [],
    searchText: "",
  };

  const searchParts: string[] = [];
  let searchLength = 0;
  let lastPromptFromEntries = "";

  for await (const entry of readEntries(file.filePath)) {
    summary.entryCount++;

    if (typeof entry.cwd === "string" && entry.cwd) {
      // First cwd owns the session — the project folder name is derived from it.
      if (!summary.projectPath) summary.projectPath = entry.cwd;
      summary.lastCwd = entry.cwd;
    }
    if (typeof entry.gitBranch === "string" && entry.gitBranch) {
      summary.gitBranch = entry.gitBranch;
    }
    pushUnique(summary.claudeVersions, entry.version);
    pushUnique(summary.mcpServers, entry.attributionMcpServer);

    if (typeof entry.timestamp === "string") {
      if (!summary.startedAt) summary.startedAt = entry.timestamp;
      summary.lastActivityAt = entry.timestamp;
    }

    switch (entry.type) {
      case "ai-title": {
        if (typeof entry.aiTitle === "string" && entry.aiTitle.trim()) {
          summary.title = entry.aiTitle.trim();
          summary.hasAiTitle = true;
        }
        break;
      }
      case "last-prompt": {
        if (typeof entry.lastPrompt === "string") {
          lastPromptFromEntries = stripNoise(entry.lastPrompt);
        }
        break;
      }
      case "system": {
        if (
          entry.subtype === "turn_duration" &&
          typeof entry.durationMs === "number"
        ) {
          summary.activeMs += entry.durationMs;
        }
        break;
      }
      case "user": {
        if (!isHumanPrompt(entry)) break;
        summary.userMsgCount++;
        const text = stripNoise(contentToText(entry.message?.content));
        const images = countImages(entry.message?.content);
        const display =
          text || (images ? `[${images} image${images > 1 ? "s" : ""}]` : "");
        if (!display) break;
        if (!summary.firstPrompt)
          summary.firstPrompt = display.slice(0, PROMPT_PREVIEW_MAX);
        summary.lastPrompt = display.slice(0, PROMPT_PREVIEW_MAX);
        if (searchLength < SEARCH_TEXT_MAX) {
          const chunk = display.slice(0, 600);
          searchParts.push(chunk);
          searchLength += chunk.length;
        }
        break;
      }
      case "assistant": {
        summary.assistantMsgCount++;
        // "<synthetic>" marks locally generated messages (API errors, aborts).
        if (entry.message?.model !== "<synthetic>") {
          pushUnique(summary.models, entry.message?.model);
        }
        pushUnique(summary.efforts, entry.effort);
        const usage = entry.message?.usage;
        if (usage) {
          if (typeof usage.output_tokens === "number")
            summary.outputTokens += usage.output_tokens;
          if (typeof usage.cache_read_input_tokens === "number") {
            summary.cacheReadTokens += usage.cache_read_input_tokens;
          }
        }
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "tool_use") {
              summary.toolCallCount++;
              const name =
                typeof block.name === "string" ? block.name : "unknown";
              summary.toolCounts[name] = (summary.toolCounts[name] ?? 0) + 1;
              if (name === "Skill")
                pushUnique(summary.skills, block.input?.skill);
            }
          }
        }
        break;
      }
    }
  }

  if (lastPromptFromEntries) {
    summary.lastPrompt = lastPromptFromEntries.slice(0, PROMPT_PREVIEW_MAX);
  }
  if (!summary.projectPath)
    summary.projectPath = decodeProjectKey(file.projectKey);
  summary.projectLabel =
    path.basename(summary.projectPath) || summary.projectPath;
  if (!summary.title) {
    summary.title = summary.firstPrompt
      ? summary.firstPrompt.split("\n")[0].slice(0, 90)
      : "Untitled session";
  }
  if (summary.lastCwd === summary.projectPath) summary.lastCwd = null;
  summary.searchText = searchParts.join("  ").toLowerCase();

  return summary;
}

/**
 * Keyed by file path; the value records mtime+size so an unchanged session is
 * never re-read. Only files you actually touched cost anything on reload.
 */
const summaryCache = new Map<
  string,
  { stamp: string; summary: SessionSummary }
>();

export async function indexSessions(): Promise<SessionSummary[]> {
  const files = await listSessionFiles();
  const seen = new Set<string>();

  const summaries = await Promise.all(
    files.map(async (file) => {
      seen.add(file.filePath);
      const stamp = `${file.mtimeMs}:${file.sizeBytes}`;
      const cached = summaryCache.get(file.filePath);
      if (cached && cached.stamp === stamp) return cached.summary;
      const summary = await buildSummary(file);
      summaryCache.set(file.filePath, { stamp, summary });
      return summary;
    }),
  );

  for (const key of summaryCache.keys()) {
    if (!seen.has(key)) summaryCache.delete(key);
  }

  return summaries.sort(
    (a, b) => order(b.lastActivityAt) - order(a.lastActivityAt),
  );
}

function order(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

async function findSessionFile(id: string): Promise<SessionFile | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null; // no traversal via the URL
  const files = await listSessionFiles();
  return files.find((f) => f.id === id) ?? null;
}

export async function getSessionSummary(
  id: string,
): Promise<SessionSummary | null> {
  const file = await findSessionFile(id);
  if (!file) return null;
  const stamp = `${file.mtimeMs}:${file.sizeBytes}`;
  const cached = summaryCache.get(file.filePath);
  if (cached && cached.stamp === stamp) return cached.summary;
  const summary = await buildSummary(file);
  summaryCache.set(file.filePath, { stamp, summary });
  return summary;
}

/**
 * One page of a transcript. Pages exist because the largest sessions here run
 * past a thousand entries — rendering all of them at once took ~50s and 11 MB
 * of HTML.
 */
export async function getSessionDetail(
  id: string,
  options: { page?: number; all?: boolean } = {},
): Promise<SessionDetail | null> {
  const file = await findSessionFile(id);
  if (!file) return null;
  const summary = await getSessionSummary(id);
  if (!summary) return null;

  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = options.all ? 0 : (page - 1) * TRANSCRIPT_PAGE_SIZE;
  const to = options.all ? Infinity : from + TRANSCRIPT_PAGE_SIZE;

  const entries: TranscriptEntry[] = [];
  const prompts: SessionDetail["prompts"] = [];
  /** tool_use id -> the call awaiting its result, which arrives in a later entry. */
  const pending = new Map<string, ToolCall>();
  let totalEntries = 0;

  for await (const raw of readEntries(file.filePath)) {
    const content = raw.message?.content;

    // Tool results arrive as synthetic user turns; fold them into the call.
    if (raw.type === "user" && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== "tool_result") continue;
        const call = pending.get(block.tool_use_id);
        if (call) {
          attachToolResult(call, block);
          pending.delete(block.tool_use_id);
        }
      }
    }

    let entry: TranscriptEntry | null = null;

    if (raw.type === "user" && isHumanPrompt(raw)) {
      const full = stripNoise(contentToText(content));
      const [text, textTruncated] = options.all
        ? [full, false]
        : clip(full, MESSAGE_TEXT_MAX);
      const imageCount = countImages(content);
      if (full || imageCount) {
        entry = {
          uuid: raw.uuid ?? `u-${totalEntries}`,
          role: "user",
          timestamp: raw.timestamp ?? null,
          text,
          textTruncated,
          textLength: full.length,
          thinking: "",
          toolCalls: [],
          model: null,
          effort: null,
          isSidechain: Boolean(raw.isSidechain),
          imageCount,
          notice: null,
        };
        // The prompts tab is a skim view, so a short preview is enough there.
        prompts.push({
          uuid: entry.uuid,
          timestamp: entry.timestamp,
          text: clip(full, 4000)[0] || "[image]",
        });
      }
    } else if (raw.type === "assistant") {
      const full = stripNoise(contentToText(content));
      const [text, textTruncated] = options.all
        ? [full, false]
        : clip(full, MESSAGE_TEXT_MAX);
      const thinking = options.all
        ? contentThinking(content)
        : clip(contentThinking(content), THINKING_MAX)[0];
      const toolCalls: ToolCall[] = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== "tool_use") continue;
          const call = buildToolCall(block, raw);
          toolCalls.push(call);
          if (call.id) pending.set(call.id, call);
        }
      }
      if (full || thinking || toolCalls.length) {
        entry = {
          uuid: raw.uuid ?? `a-${totalEntries}`,
          role: "assistant",
          timestamp: raw.timestamp ?? null,
          text,
          textTruncated,
          textLength: full.length,
          thinking,
          toolCalls,
          model: raw.message?.model ?? null,
          effort: raw.effort ?? null,
          isSidechain: Boolean(raw.isSidechain),
          imageCount: 0,
          notice: null,
        };
      }
    } else if (raw.type === "system" && raw.isCompactSummary) {
      entry = {
        uuid: raw.uuid ?? `s-${totalEntries}`,
        role: "system",
        timestamp: raw.timestamp ?? null,
        text: "",
        textTruncated: false,
        textLength: 0,
        thinking: "",
        toolCalls: [],
        model: null,
        effort: null,
        isSidechain: false,
        imageCount: 0,
        notice: "Context compacted here",
      };
    }

    if (!entry) continue;
    const position = totalEntries;
    totalEntries++;
    // Only the requested page is retained; pending tool results still resolve
    // against the retained objects because the map holds the same references.
    if (position >= from && position < to) entries.push(entry);
  }

  // Big tool bodies are dropped from the payload and fetched on expand.
  if (!options.all) {
    for (const entry of entries) {
      for (const call of entry.toolCalls) {
        if (bodyWeight(call.body) > TOOL_INLINE_MAX) call.body = null;
      }
    }
  }

  return {
    summary,
    entries,
    prompts,
    totalEntries,
    page,
    pageCount: options.all
      ? 1
      : Math.max(1, Math.ceil(totalEntries / TRANSCRIPT_PAGE_SIZE)),
    pageSize: options.all ? totalEntries : TRANSCRIPT_PAGE_SIZE,
  };
}

/**
 * Fetches one tool call's input and result on demand, for calls whose body was
 * too large to inline. Re-streams the file, which costs a few hundred ms even
 * on the largest transcript.
 */
export async function getToolCallBody(
  id: string,
  callId: string,
): Promise<(ToolCallBody & { name: string; isError: boolean }) | null> {
  const file = await findSessionFile(id);
  if (!file) return null;

  let found: (ToolCallBody & { name: string; isError: boolean }) | null = null;

  for await (const raw of readEntries(file.filePath)) {
    const content = raw.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!found && block?.type === "tool_use" && block.id === callId) {
        found = {
          ...buildToolBody(block),
          name: typeof block.name === "string" ? block.name : "unknown",
          isError: false,
        };
      } else if (
        found &&
        block?.type === "tool_result" &&
        block.tool_use_id === callId
      ) {
        applyToolResult(found, block);
        found.isError = Boolean(block.is_error);
        return found;
      }
    }
  }

  // A call with no result — the session ended, or it was denied mid-flight.
  return found;
}

/**
 * Grep across full transcript bodies, including tool output the index skips.
 * Streamed and case-insensitive; returns matching session ids with a snippet.
 */
export async function deepSearch(
  query: string,
  limit = 50,
): Promise<{ id: string; hits: number; snippet: string }[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const files = await listSessionFiles();

  const results = await Promise.all(
    files.map(async (file) => {
      let hits = 0;
      let snippet = "";
      for await (const line of readline.createInterface({
        input: fs.createReadStream(file.filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      })) {
        const at = line.toLowerCase().indexOf(needle);
        if (at === -1) continue;
        hits++;
        if (!snippet) {
          snippet = line
            .slice(Math.max(0, at - 120), at + needle.length + 160)
            .replace(/\\n/g, " ")
            .replace(/\s+/g, " ");
        }
        if (hits > 500) break;
      }
      return hits ? { id: file.id, hits, snippet } : null;
    }),
  );

  return results
    .filter(
      (r): r is { id: string; hits: number; snippet: string } => r !== null,
    )
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}
