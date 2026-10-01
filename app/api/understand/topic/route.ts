import { setTopicDone } from "@/lib/understand";

export const dynamic = "force-dynamic";

/** Ticks a checkbox by writing `- [x]` into the markdown file itself. */
export async function POST(request: Request) {
  const { id, index, done } = await request.json();
  if (
    typeof id !== "string" ||
    typeof index !== "number" ||
    typeof done !== "boolean"
  ) {
    return Response.json(
      { error: "Expected { id, index, done }" },
      { status: 400 },
    );
  }
  const result = await setTopicDone(id, index, done);
  if (!result) {
    return Response.json(
      { error: "Document or checkbox not found" },
      { status: 404 },
    );
  }
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
