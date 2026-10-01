"use client";

import {
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Scissors,
  User,
} from "lucide-react";
import Link from "next/link";

import { MarkdownBody } from "@/components/claude-sessions/markdown-body";
import { ToolCallBlock } from "@/components/claude-sessions/tool-call-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  SessionDetail,
  TranscriptEntry,
} from "@/lib/claude-sessions/types";
import { absoluteTime, shortModel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TranscriptViewer({
  detail,
  id,
}: {
  detail: SessionDetail;
  id: string;
}) {
  const { page, pageCount, pageSize, totalEntries } = detail;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalEntries);

  return (
    <div className="space-y-3">
      {pageCount > 1 && (
        <Pager id={id} detail={detail} from={first} to={last} />
      )}

      <div className="space-y-3">
        {detail.entries.map((entry) => (
          <EntryBlock key={entry.uuid} entry={entry} sessionId={id} />
        ))}
      </div>

      {pageCount > 1 && (
        <Pager id={id} detail={detail} from={first} to={last} />
      )}
    </div>
  );
}

function Pager({
  id,
  detail,
  from,
  to,
}: {
  id: string;
  detail: SessionDetail;
  from: number;
  to: number;
}) {
  const { page, pageCount, totalEntries } = detail;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        Entries {from}–{to} of {totalEntries}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <PageButton
          href={`/claude-sessions/${id}?page=${page - 1}`}
          disabled={page <= 1}
          title="Previous page"
        >
          <ChevronLeft />
        </PageButton>
        <span className="px-1 tabular-nums">
          {page} / {pageCount}
        </span>
        <PageButton
          href={`/claude-sessions/${id}?page=${page + 1}`}
          disabled={page >= pageCount}
          title="Next page"
        >
          <ChevronRight />
        </PageButton>
      </div>
    </div>
  );
}

/**
 * A real <button> when there's nowhere to go, a link otherwise. Base UI's Button
 * assumes native button semantics unless told the rendered element isn't one.
 */
function PageButton({
  href,
  disabled,
  title,
  children,
}: {
  href: string;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon-xs" disabled title={title}>
        {children}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="icon-xs"
      title={title}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  );
}

function EntryBlock({
  entry,
  sessionId,
}: {
  entry: TranscriptEntry;
  sessionId: string;
}) {
  if (entry.notice) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Scissors className="size-3" />
        <span>{entry.notice}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = entry.role === "user";

  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        isUser ? "border-primary/25 bg-primary/[0.04]" : "bg-card",
        entry.isSidechain && "ml-6 border-dashed",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[13px]">
        {isUser ? (
          <User className="size-3.5 text-primary" />
        ) : (
          <Bot className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">
          {isUser ? "You" : entry.isSidechain ? "Subagent" : "Claude"}
        </span>
        {entry.model && (
          <Badge
            variant="ghost"
            className="font-mono text-xs text-muted-foreground"
          >
            {shortModel(entry.model)}
            {entry.effort ? ` · ${entry.effort}` : ""}
          </Badge>
        )}
        <span className="ml-auto text-muted-foreground">
          {absoluteTime(entry.timestamp)}
        </span>
      </div>

      {entry.imageCount > 0 && (
        <div className="mb-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3" />
          {entry.imageCount} image{entry.imageCount === 1 ? "" : "s"} attached
        </div>
      )}

      {entry.thinking && (
        <Collapsible className="mb-2">
          <CollapsibleTrigger className="group/think flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[panel-open]/think:rotate-90" />
            <Brain className="size-3" />
            Thinking ({entry.thinking.length.toLocaleString()} chars)
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 border-l-2 pl-3 text-[13px] whitespace-pre-wrap text-muted-foreground italic">
              {entry.thinking}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {entry.text && <MarkdownBody>{entry.text}</MarkdownBody>}

      {entry.textTruncated && (
        <p className="mt-1.5 rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
          Clipped after {entry.text.length.toLocaleString()} of{" "}
          {entry.textLength.toLocaleString()} characters. Export the transcript
          for the full text.
        </p>
      )}

      {entry.toolCalls.length > 0 && (
        <div className={cn("space-y-1", entry.text && "mt-2")}>
          {entry.toolCalls.map((call, index) => (
            <ToolCallBlock
              key={call.id || index}
              call={call}
              sessionId={sessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
