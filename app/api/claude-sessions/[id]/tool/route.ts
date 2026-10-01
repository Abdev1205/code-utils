import type { NextRequest } from "next/server";

import { getToolCallBody } from "@/lib/claude-sessions";
import { hiddenInPublicMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

/** GET ?call=toolu_xxx — the input and result for one tool call, fetched on expand. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const hidden = await hiddenInPublicMode();
  if (hidden) return hidden;
  const { id } = await params;
  const callId = request.nextUrl.searchParams.get("call");
  if (!callId) {
    return Response.json({ error: "Missing ?call=" }, { status: 400 });
  }
  const body = await getToolCallBody(id, callId);
  if (!body) {
    return Response.json({ error: "Tool call not found" }, { status: 404 });
  }
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
