import { indexDocs } from "@/lib/understand";
import { getCollections } from "@/lib/understand/roots";
import { readState } from "@/lib/understand/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const [docs, state, collections] = await Promise.all([
    indexDocs(),
    readState(),
    getCollections(),
  ]);
  return Response.json(
    { docs, collections, artifacts: state.artifacts },
    { headers: { "cache-control": "no-store" } },
  );
}
