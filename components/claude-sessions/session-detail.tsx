"use client";

import { ArrowLeft, FolderGit2, GitBranch, MoveRight } from "lucide-react";
import Link from "next/link";

import { SessionActions } from "@/components/claude-sessions/session-actions";
import { SessionCommandsCard } from "@/components/claude-sessions/session-commands-card";
import { TranscriptViewer } from "@/components/claude-sessions/transcript-viewer";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionDetail } from "@/lib/claude-sessions/types";
import {
  absoluteTime,
  formatBytes,
  formatCount,
  formatDuration,
  relativeTime,
  shortModel,
  shortToolName,
} from "@/lib/format";

export function SessionDetailView({ detail }: { detail: SessionDetail }) {
  const { summary } = detail;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/claude-sessions"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        All sessions
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {summary.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FolderGit2 className="size-3" />
              <span className="font-mono">{summary.projectPath}</span>
            </span>
            {summary.lastCwd && (
              <span
                className="inline-flex items-center gap-1"
                title="Claude moved here during the session"
              >
                <MoveRight className="size-3" />
                <span className="font-mono">{summary.lastCwd}</span>
              </span>
            )}
            {summary.gitBranch && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" />
                {summary.gitBranch}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{absoluteTime(summary.startedAt)}</span>
            <span>→</span>
            <span>{absoluteTime(summary.lastActivityAt)}</span>
            <span suppressHydrationWarning>
              ({relativeTime(summary.lastActivityAt)})
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              {summary.id}
            </code>
            <CopyButton
              value={summary.id}
              label="Session ID copied"
              size="icon-xs"
              variant="ghost"
            />
          </div>
        </div>

        <SessionActions session={summary} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Prompts" value={String(summary.userMsgCount)} />
        <Stat label="Replies" value={String(summary.assistantMsgCount)} />
        <Stat label="Tool calls" value={String(summary.toolCallCount)} />
        <Stat label="Active time" value={formatDuration(summary.activeMs)} />
        <Stat label="Output tokens" value={formatCount(summary.outputTokens)} />
        <Stat label="Transcript" value={formatBytes(summary.sizeBytes)} />
      </div>

      <div className="mt-4">
        <SessionCommandsCard session={summary} />
      </div>

      <Tabs defaultValue="transcript" className="mt-5">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="prompts">
            Your prompts ({detail.prompts.length})
          </TabsTrigger>
          <TabsTrigger value="stats">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-4">
          <TranscriptViewer detail={detail} id={summary.id} />
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <div className="space-y-2">
            {detail.prompts.map((prompt, index) => (
              <div
                key={prompt.uuid}
                className="group rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">#{index + 1}</span>
                  <span>{absoluteTime(prompt.timestamp)}</span>
                  <CopyButton
                    value={prompt.text}
                    label="Prompt copied"
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {prompt.text}
                </p>
              </div>
            ))}
            {detail.prompts.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No human prompts recorded in this session.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label="Models">
              {summary.models.length ? (
                <BadgeRow items={summary.models.map(shortModel)} />
              ) : (
                <Muted />
              )}
            </Detail>
            <Detail label="Effort levels">
              {summary.efforts.length ? (
                <BadgeRow items={summary.efforts} />
              ) : (
                <Muted />
              )}
            </Detail>
            <Detail label="MCP servers">
              {summary.mcpServers.length ? (
                <BadgeRow items={summary.mcpServers} />
              ) : (
                <Muted />
              )}
            </Detail>
            <Detail label="Skills invoked">
              {summary.skills.length ? (
                <BadgeRow items={summary.skills} />
              ) : (
                <Muted />
              )}
            </Detail>
            <Detail label="Claude Code versions">
              {summary.claudeVersions.length ? (
                <BadgeRow items={summary.claudeVersions} />
              ) : (
                <Muted />
              )}
            </Detail>
            <Detail label="Subagents spawned">
              <span className="text-sm">{summary.subagentCount || "none"}</span>
            </Detail>
            <Detail label="Cache reads">
              <span className="text-sm">
                {formatCount(summary.cacheReadTokens)} tokens
              </span>
            </Detail>
            <Detail label="JSONL entries">
              <span className="text-sm">
                {summary.entryCount.toLocaleString()}
              </span>
            </Detail>
            <div className="sm:col-span-2">
              <Detail label="Transcript path">
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-1.5 py-1 font-mono text-xs whitespace-pre">
                    {summary.transcriptPath}
                  </code>
                  <CopyButton
                    value={summary.transcriptPath}
                    label="Path copied"
                    size="icon-xs"
                    variant="ghost"
                  />
                </div>
              </Detail>
            </div>
            <div className="sm:col-span-2">
              <Detail
                label={`Tools used (${Object.keys(summary.toolCounts).length})`}
              >
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(summary.toolCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => (
                      <Badge key={name} variant="outline" className="text-xs">
                        {shortToolName(name)}
                        <span className="ml-1 text-muted-foreground">
                          {count}
                        </span>
                      </Badge>
                    ))}
                  {Object.keys(summary.toolCounts).length === 0 && <Muted />}
                </div>
              </Detail>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-lg leading-tight font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function BadgeRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant="secondary" className="font-mono text-xs">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function Muted() {
  return <span className="text-sm text-muted-foreground">—</span>;
}
