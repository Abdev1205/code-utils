"use client";

import {
  FolderGit2,
  GitBranch,
  MessageSquare,
  Timer,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { SessionActions } from "@/components/claude-sessions/session-actions";
import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/lib/claude-sessions/types";
import {
  formatDuration,
  relativeTime,
  shortModel,
  shortPath,
} from "@/lib/format";

export function SessionCard({
  session,
  deepHits,
}: {
  session: SessionSummary;
  deepHits?: number;
}) {
  const router = useRouter();
  const href = `/claude-sessions/${session.id}`;

  // The title is a real link; clicking anywhere else on the card follows it too,
  // except when the click landed on a control.
  function onCardClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "a, button, [role='menuitem'], [data-slot='dropdown-menu-content']",
      )
    )
      return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  return (
    <div
      onClick={onCardClick}
      className="group cursor-pointer rounded-xl border bg-card px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            className="line-clamp-1 font-medium tracking-tight hover:underline"
            title={session.title}
          >
            {session.title}
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span
              className="inline-flex items-center gap-1"
              title={session.projectPath}
            >
              <FolderGit2 className="size-3" />
              {shortPath(session.projectPath)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" />
              {session.userMsgCount} prompts
            </span>
            <span className="inline-flex items-center gap-1">
              <Wrench className="size-3" />
              {session.toolCallCount} tools
            </span>
            {session.activeMs > 0 && (
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3" />
                {formatDuration(session.activeMs)}
              </span>
            )}
            <span suppressHydrationWarning title={session.lastActivityAt ?? ""}>
              {relativeTime(session.lastActivityAt)}
            </span>
          </div>
        </div>

        {/* Kept visible on touch/narrow; de-emphasised until hover on the desktop grid. */}
        <div className="shrink-0 opacity-100 transition-opacity md:opacity-60 md:group-hover:opacity-100">
          <SessionActions session={session} compact />
        </div>
      </div>

      {session.lastPrompt && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground/90">
          <span className="text-muted-foreground/60">last:</span>{" "}
          {session.lastPrompt}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {typeof deepHits === "number" && (
          <Badge variant="default" className="font-mono text-xs">
            {deepHits} match{deepHits === 1 ? "" : "es"} in transcript
          </Badge>
        )}
        {session.models.map((model) => (
          <Badge key={model} variant="secondary" className="font-mono text-xs">
            {shortModel(model)}
          </Badge>
        ))}
        {session.efforts.length > 0 && (
          <Badge variant="outline" className="text-xs">
            effort: {session.efforts.join("/")}
          </Badge>
        )}
        {session.mcpServers.map((server) => (
          <Badge key={server} variant="outline" className="text-xs">
            {server}
          </Badge>
        ))}
        {session.subagentCount > 0 && (
          <Badge variant="outline" className="text-xs">
            {session.subagentCount} subagent
            {session.subagentCount === 1 ? "" : "s"}
          </Badge>
        )}
        {session.gitBranch && session.gitBranch !== "HEAD" && (
          <Badge variant="outline" className="text-xs">
            <GitBranch className="size-2.5" />
            {session.gitBranch}
          </Badge>
        )}
        {!session.hasAiTitle && (
          <Badge variant="ghost" className="text-xs text-muted-foreground">
            untitled
          </Badge>
        )}
      </div>
    </div>
  );
}
