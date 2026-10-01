import { saveNote } from "@/lib/understand";

export const dynamic = "force-dynamic";

/** Saves your own explanation to understand/notes/<module>.md. */
export async function POST(request: Request) {
  const { id, body, topicTitle } = await request.json();
  if (typeof id !== "string" || typeof body !== "string") {
    return Response.json(
      { error: "Expected { id, body, topicTitle? }" },
      { status: 400 },
    );
  }
  const ok = await saveNote(
    id,
    body,
    typeof topicTitle === "string" ? topicTitle : undefined,
  );
  if (!ok) {
    return Response.json(
      { error: "Notes only apply to curriculum modules" },
      { status: 400 },
    );
  }
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
