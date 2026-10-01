import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { isPublicMode } from "@/lib/mode";

import type { CollectionMeta } from "./types";

/**
 * Where the content lives: this repo. `understand/` sits beside `app/` so the
 * tool and what it teaches ship together, and one `git clone` is a working
 * install. UNDERSTAND_ROOT overrides it for people who keep notes elsewhere.
 */
export function repoRoot(): string {
  return process.env.UNDERSTAND_ROOT || process.cwd();
}

/**
 * Optional second root for collections that are not part of this repo —
 * runbooks, RCAs and reports that live in other repositories on your machine.
 * Unset, those collections are simply absent. Set it in `.env.local`, which is
 * ignored by git, so the paths never travel.
 */
export function extraRoot(): string | null {
  const dir = process.env.UNDERSTAND_EXTRA_ROOT;
  return dir && existsSync(dir) ? dir : null;
}

export const UNDERSTAND_DIR = "understand";
export const TRACKS_DIR = `${UNDERSTAND_DIR}/tracks`;
/**
 * The one privacy rule: any path with a `private/` segment never leaves this
 * machine. `.gitignore` enforces it; the app treats both folders identically,
 * so locally you see everything and a clone sees only `tracks/`.
 */
export const PRIVATE_TRACKS_DIR = `${UNDERSTAND_DIR}/private`;
export const TRACK_ROOTS = [TRACKS_DIR, PRIVATE_TRACKS_DIR] as const;
/**
 * Saved sessions and documents Claude wrote for you are personal by nature —
 * a session transcript about your work is private even when no identifier in
 * it looks like one — so they live under private/ and never leave the machine.
 */
export const CLAUDE_DIR = `${PRIVATE_TRACKS_DIR}/claude`;
export const STATE_FILE = `${UNDERSTAND_DIR}/.understand.json`;

/** True for a module, lesson or note inside any track, public or private. */
export function isTrackDoc(id: string): boolean {
  return TRACK_ROOTS.some((dir) => id.startsWith(dir + "/"));
}

/** The track folders visible right now: both normally, only `tracks/` in public mode. */
async function visibleTrackRoots(): Promise<readonly string[]> {
  return (await isPublicMode()) ? [TRACKS_DIR] : TRACK_ROOTS;
}

/** Folders inside a track that hold generated material, not curriculum. */
export const TRACK_SUBFOLDERS = ["notes", "lessons"];

export type TrackMeta = {
  id: string;
  name: string;
  description: string;
  order: number;
  /** Derived from location, never declared: `understand/private/` is private. */
  visibility: "public" | "private";
  /** Background about the learner and environment, fed into lesson prompts. */
  context: string;
  /** Repo-relative directory. */
  dir: string;
};

/**
 * A track is a subject you're learning — infra & security today, AI or backend
 * tomorrow. Adding one means creating understand/tracks/<id>/ with a track.json
 * and some numbered module files. No code change.
 */
export async function discoverTracks(): Promise<TrackMeta[]> {
  const tracks: TrackMeta[] = [];
  for (const tracksDir of await visibleTrackRoots()) {
    const base = path.join(repoRoot(), tracksDir);
    let entries;
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      continue; // No private/ folder yet is the normal state of a fresh clone.
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = `${tracksDir}/${entry.name}`;
      let meta: Partial<TrackMeta> = {};
      try {
        meta = JSON.parse(
          await fsp.readFile(path.join(base, entry.name, "track.json"), "utf8"),
        );
      } catch {
        // A track without a track.json still works; it just uses defaults.
      }
      tracks.push({
        id: entry.name,
        name: meta.name ?? entry.name.replace(/[-_]/g, " "),
        description: meta.description ?? "",
        order: typeof meta.order === "number" ? meta.order : 99,
        visibility: tracksDir === PRIVATE_TRACKS_DIR ? "private" : "public",
        context: meta.context ?? "",
        dir,
      });
    }
  }
  return tracks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export async function trackForDoc(docId: string): Promise<TrackMeta | null> {
  const tracks = await discoverTracks();
  return tracks.find((t) => docId.startsWith(t.dir + "/")) ?? null;
}

type RootConfig = CollectionMeta & {
  /** Relative to `base`. Doc ids are this path plus the file. */
  dir: string;
  /** Absolute directory `dir` is relative to: this repo, or the extra root. */
  base: string;
  recursive: boolean;
  exclude: string[];
};

/** Collections that aren't tracks: Claude's output, runbooks, reference material. */
const STATIC_ROOTS: Omit<RootConfig, "base">[] = [
  {
    id: "claude",
    name: "Claude-created",
    description: "Documents Claude wrote for you, and saved sessions",
    kind: "claude",
    icon: "Sparkles",
    dir: CLAUDE_DIR,
    recursive: true,
    exclude: [],
  },
  {
    id: "runbooks",
    name: "Runbooks",
    description: "Step-by-step procedures for when something is on fire",
    kind: "runbooks",
    icon: "Siren",
    dir: "black-mirror/infra/runbooks",
    recursive: true,
    exclude: [],
  },
  {
    id: "policies",
    name: "Policies",
    description: "Security, privacy and AI-usage policy documents",
    kind: "reference",
    icon: "ShieldCheck",
    dir: "docs",
    recursive: true,
    exclude: [],
  },
  {
    id: "rca",
    name: "RCA",
    description: "Root-cause write-ups",
    kind: "reference",
    icon: "Microscope",
    dir: "rca",
    recursive: true,
    exclude: [],
  },
  {
    id: "reports",
    name: "Reports",
    description: "Investigations and findings you produced",
    kind: "reference",
    icon: "FileChartColumn",
    dir: "report",
    recursive: true,
    exclude: [],
  },
];

/**
 * Tracks first (in their configured order), then the static collections. The
 * Claude-created folder is part of this repo; the rest only exist when
 * UNDERSTAND_EXTRA_ROOT points at the machine that has them.
 */
export async function getRoots(): Promise<RootConfig[]> {
  const tracks = await discoverTracks();
  const here = repoRoot();
  // Neither other repos' collections nor the private Claude folder are part of
  // a clone, so public mode drops both.
  const publicMode = await isPublicMode();
  const extra = publicMode ? null : extraRoot();
  return [
    ...tracks.map<RootConfig>((track) => ({
      id: track.id,
      name: track.name,
      description: track.description,
      kind: "curriculum",
      icon: "GraduationCap",
      dir: track.dir,
      base: here,
      recursive: false,
      exclude: TRACK_SUBFOLDERS,
    })),
    ...STATIC_ROOTS.flatMap<RootConfig>((root) => {
      // Claude's folder is under private/, so public mode drops it like the rest.
      if (root.id === "claude") return publicMode ? [] : [{ ...root, base: here }];
      return extra ? [{ ...root, base: extra }] : [];
    }),
  ];
}

export async function getCollections(): Promise<CollectionMeta[]> {
  return (await getRoots()).map(({ id, name, description, kind, icon }) => ({
    id,
    name,
    description,
    kind,
    icon,
  }));
}

/**
 * Resolves a doc id (a repo-relative path) to an absolute path, refusing
 * anything that escapes a configured root. Every write path goes through this.
 */
export async function resolveDocPath(id: string): Promise<string | null> {
  if (!id || id.includes("\0") || !id.endsWith(".md")) return null;
  const roots = await getRoots();
  // Notes and lessons live inside a track beside its modules, so the track
  // folders themselves are allowed, not just the module files.
  const allowed = [
    ...roots.map((r) => ({ base: r.base, dir: r.dir })),
    ...(await visibleTrackRoots()).map((dir) => ({ base: repoRoot(), dir })),
  ];
  for (const { base, dir } of allowed) {
    if (!(id === dir || id.startsWith(dir + "/"))) continue;
    const absolute = path.resolve(base, id);
    const boundary = path.resolve(base, dir);
    if (absolute === boundary || absolute.startsWith(boundary + path.sep))
      return absolute;
  }
  return null;
}
