import type { NextRequest } from "next/server";

import { getSessionDetail } from "@/lib/claude-sessions";
import { hiddenInPublicMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const hidden = await hiddenInPublicMode();
  if (hidden) return hidden;
  const { id } = await params;
  const params_ = request.nextUrl.searchParams;
  const page = Number.parseInt(params_.get("page") ?? "1", 10);
  const detail = await getSessionDetail(id, {
    page: Number.isNaN(page) ? 1 : page,
    // ?all=1 skips paging and inlines every tool body — used by the exporter.
    all: params_.get("all") === "1",
  });
  if (!detail) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return Response.json(detail, { headers: { "cache-control": "no-store" } });
}
