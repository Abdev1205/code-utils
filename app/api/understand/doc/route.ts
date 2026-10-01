import type { NextRequest } from "next/server";

import { getDoc } from "@/lib/understand";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });
  const doc = await getDoc(id);
  if (!doc)
    return Response.json({ error: "Document not found" }, { status: 404 });
  return Response.json(doc, { headers: { "cache-control": "no-store" } });
}
