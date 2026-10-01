import { notFound } from "next/navigation";

import { DocView } from "@/components/understand/doc-view";
import { getDoc } from "@/lib/understand";
import { getCollections } from "@/lib/understand/roots";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const doc = id ? await getDoc(id) : null;
  return {
    title: doc
      ? `${doc.summary.title} · Understand`
      : "Document not found · utils",
  };
}

export default async function DocPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; topic?: string }>;
}) {
  const { id, topic } = await searchParams;
  const detail = id ? await getDoc(id) : null;
  if (!detail) notFound();
  const collection = (await getCollections()).find(
    (c) => c.id === detail.summary.collection,
  );
  const parsed = Number.parseInt(topic ?? "", 10);
  return (
    <DocView
      detail={detail}
      collection={collection ?? null}
      initialTopic={Number.isNaN(parsed) ? null : parsed}
    />
  );
}
