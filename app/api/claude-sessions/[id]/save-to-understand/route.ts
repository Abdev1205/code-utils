import { getSessionDetail } from "@/lib/claude-sessions";
import {
  markdownFilename,
  sessionToMarkdown,
} from "@/lib/claude-sessions/markdown";
import { saveClaudeDoc } from "@/lib/understand";
import { hiddenInPublicMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

/** Exports a session transcript into understand/claude/ so it becomes a document you keep. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hidden = await hiddenInPublicMode();
  if (hidden) return hidden;
  const { id } = await params;
  const detail = await getSessionDetail(id, { all: true });
  if (!detail)
    return Response.json({ error: "Session not found" }, { status: 404 });

  const saved = await saveClaudeDoc(
    `session-${markdownFilename(detail)}`,
    sessionToMarkdown(detail),
  );
  if (!saved)
    return Response.json(
      { error: "Could not write the file" },
      { status: 500 },
    );

  return Response.json(
    { id: saved, title: detail.summary.title },
    { headers: { "cache-control": "no-store" } },
  );
}
