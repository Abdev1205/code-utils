import { SessionList } from "@/components/claude-sessions/session-list";
import { indexSessions } from "@/lib/claude-sessions";

// The index is read from disk per request; there is nothing to prerender.
export const dynamic = "force-dynamic";

export const metadata = { title: "Claude Sessions · utils" };

export default async function ClaudeSessionsPage() {
  const sessions = await indexSessions();
  return <SessionList sessions={sessions} />;
}
