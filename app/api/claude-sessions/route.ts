import { indexSessions } from "@/lib/claude-sessions";

// Reads the filesystem on every request — never prerender this.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const sessions = await indexSessions();
  return Response.json(
    { sessions, count: sessions.length, tookMs: Date.now() - started },
    { headers: { "cache-control": "no-store" } },
  );
}
