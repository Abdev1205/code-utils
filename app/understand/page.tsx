import { UnderstandLibrary } from "@/components/understand/library";
import { indexDocs } from "@/lib/understand";
import { getCollections } from "@/lib/understand/roots";
import { readState } from "@/lib/understand/state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Understand · utils" };

export default async function UnderstandPage() {
  const [docs, state, collections] = await Promise.all([
    indexDocs(),
    readState(),
    getCollections(),
  ]);
  return (
    <UnderstandLibrary
      docs={docs}
      collections={collections}
      artifacts={state.artifacts}
    />
  );
}
