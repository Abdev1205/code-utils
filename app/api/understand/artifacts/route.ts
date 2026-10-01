import fsp from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";

import { indexDocs } from "@/lib/understand";
import { repoRoot } from "@/lib/understand/roots";
import {
  addArtifact,
  readState,
  removeArtifact,
  updateArtifact,
} from "@/lib/understand/state";

export const dynamic = "force-dynamic";

const ARTIFACT_URL =
  /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+/g;

/**
 * `?discover=1` scans the indexed documents for claude.ai artifact links that
 * aren't registered yet, so links buried in prose can be pulled up as cards.
 */
export async function GET(request: NextRequest) {
  const state = await readState();
  if (request.nextUrl.searchParams.get("discover") !== "1") {
    return Response.json(
      { artifacts: state.artifacts },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const known = new Set(state.artifacts.map((a) => a.url));
  const found = new Map<
    string,
    { url: string; foundIn: string; context: string }
  >();
  for (const doc of await indexDocs()) {
    let raw: string;
    try {
      raw = await fsp.readFile(path.join(repoRoot(), doc.id), "utf8");
    } catch {
      continue;
    }
    for (const match of raw.matchAll(ARTIFACT_URL)) {
      const url = match[0];
      if (known.has(url) || found.has(url)) continue;
      const at = match.index ?? 0;
      found.set(url, {
        url,
        foundIn: doc.id,
        context: raw
          .slice(Math.max(0, at - 160), at)
          .replace(/\s+/g, " ")
          .trim()
          .slice(-140),
      });
    }
  }
  return Response.json(
    { artifacts: state.artifacts, discovered: [...found.values()] },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const { title, url, description } = await request.json();
  if (typeof url !== "string" || !/^https:\/\/claude\.ai\//.test(url)) {
    return Response.json(
      { error: "Expected a claude.ai URL" },
      { status: 400 },
    );
  }
  const state = await addArtifact({
    title: typeof title === "string" && title.trim() ? title.trim() : url,
    url,
    description: typeof description === "string" ? description.trim() : "",
  });
  return Response.json(
    { artifacts: state.artifacts },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const { id, ...patch } = await request.json();
  if (typeof id !== "string")
    return Response.json({ error: "Expected { id }" }, { status: 400 });
  const state = await updateArtifact(id, patch);
  return Response.json(
    { artifacts: state.artifacts },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });
  const state = await removeArtifact(id);
  return Response.json(
    { artifacts: state.artifacts },
    { headers: { "cache-control": "no-store" } },
  );
}
