import { SessionList } from "@/components/claude-sessions/session-list";
import { PublicModeNotice } from "@/components/public-mode-notice";
import { indexSessions } from "@/lib/claude-sessions";
import { isPublicMode } from "@/lib/mode";

// The index is read from disk per request; there is nothing to prerender.
export const dynamic = "force-dynamic";

export const metadata = { title: "Claude Sessions · utils" };

export default async function ClaudeSessionsPage() {
  if (await isPublicMode()) return <PublicModeNotice what="Your Claude sessions" />;
  const sessions = await indexSessions();
  return <SessionList sessions={sessions} />;
}
