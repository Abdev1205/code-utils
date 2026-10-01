import fsp from "node:fs/promises";
import path from "node:path";

import { repoRoot, STATE_FILE, UNDERSTAND_DIR } from "./roots";
import type { ArtifactLink, UnderstandState } from "./types";

const EMPTY: UnderstandState = { archived: {}, artifacts: [] };

function statePath(): string {
  return path.join(repoRoot(), STATE_FILE);
}

/**
 * Archive marks and registered artifact links, kept in one JSON file beside the
 * curriculum. Topic ticks are NOT here — those are written into the markdown
 * itself so they show up in your editor and in GitLab.
 */
export async function readState(): Promise<UnderstandState> {
  try {
    const raw = await fsp.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UnderstandState>;
    return {
      archived: parsed.archived ?? {},
      artifacts: parsed.artifacts ?? [],
    };
  } catch {
    // Missing or unreadable file just means nothing has been recorded yet.
    return { ...EMPTY };
  }
}

async function writeState(state: UnderstandState): Promise<void> {
  const file = statePath();
  await fsp.mkdir(path.join(repoRoot(), UNDERSTAND_DIR), { recursive: true });
  // Write-then-rename so a crash can't leave a half-written state file.
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
}

export async function setArchived(
  id: string,
  archived: boolean,
  note: string | null,
): Promise<UnderstandState> {
  const state = await readState();
  if (archived) {
    state.archived[id] = {
      at: new Date().toISOString(),
      note: note?.trim() || null,
    };
  } else {
    delete state.archived[id];
  }
  await writeState(state);
  return state;
}

export async function addArtifact(
  input: Omit<ArtifactLink, "id" | "addedAt">,
): Promise<UnderstandState> {
  const state = await readState();
  const id = `art-${Date.now().toString(36)}`;
  state.artifacts = [
    { ...input, id, addedAt: new Date().toISOString() },
    ...state.artifacts.filter((a) => a.url !== input.url),
  ];
  await writeState(state);
  return state;
}

export async function updateArtifact(
  id: string,
  patch: Partial<ArtifactLink>,
): Promise<UnderstandState> {
  const state = await readState();
  state.artifacts = state.artifacts.map((a) =>
    a.id === id ? { ...a, ...patch, id } : a,
  );
  await writeState(state);
  return state;
}

export async function removeArtifact(id: string): Promise<UnderstandState> {
  const state = await readState();
  state.artifacts = state.artifacts.filter((a) => a.id !== id);
  await writeState(state);
  return state;
}
