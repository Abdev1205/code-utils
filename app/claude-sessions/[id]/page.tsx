import { notFound } from "next/navigation";

import { SessionDetailView } from "@/components/claude-sessions/session-detail";
import { getSessionDetail } from "@/lib/claude-sessions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getSessionDetail(id);
  return {
    title: detail
      ? `${detail.summary.title} · utils`
      : "Session not found · utils",
  };
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page = Number.parseInt(query.page ?? "1", 10);
  const detail = await getSessionDetail(id, {
    page: Number.isNaN(page) ? 1 : page,
  });
  if (!detail) notFound();
  return <SessionDetailView detail={detail} />;
}
