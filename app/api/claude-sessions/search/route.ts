import type { NextRequest } from "next/server";

import { deepSearch } from "@/lib/claude-sessions";
import { hiddenInPublicMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

/**
 * Full-transcript grep, including tool output that the list index omits.
 * Slower than the instant client-side search, so it's an explicit action.
 */
export async function GET(request: NextRequest) {
  const hidden = await hiddenInPublicMode();
  if (hidden) return hidden;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.trim().length < 2) {
    return Response.json(
      { results: [], query },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const started = Date.now();
  const results = await deepSearch(query);
  return Response.json(
    { results, query, tookMs: Date.now() - started },
    { headers: { "cache-control": "no-store" } },
  );
}
