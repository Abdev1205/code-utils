import { getSessionDetail } from "@/lib/claude-sessions";
import { markdownFilename, sessionToMarkdown } from "@/lib/claude-sessions/markdown";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Exports are always complete, regardless of the detail page's paging.
  const detail = await getSessionDetail(id, { all: true });
  if (!detail) {
    return new Response("Session not found", { status: 404 });
  }
  return new Response(sessionToMarkdown(detail), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${markdownFilename(detail)}"`,
      "cache-control": "no-store",
    },
  });
}
