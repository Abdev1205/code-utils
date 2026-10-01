import { resolveDocPath } from "@/lib/understand/roots";
import { setArchived } from "@/lib/understand/state";

export const dynamic = "force-dynamic";

/** Archive means: seen, understood, acknowledged. Reversible, and never deletes. */
export async function POST(request: Request) {
  const { id, archived, note } = await request.json();
  if (typeof id !== "string" || typeof archived !== "boolean") {
    return Response.json(
      { error: "Expected { id, archived, note? }" },
      { status: 400 },
    );
  }
  if (!resolveDocPath(id)) {
    return Response.json({ error: "Unknown document" }, { status: 404 });
  }
  const state = await setArchived(
    id,
    archived,
    typeof note === "string" ? note : null,
  );
  return Response.json(
    { archived: state.archived[id] ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
