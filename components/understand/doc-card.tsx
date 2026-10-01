"use client";

import {
  Archive,
  BookOpen,
  CheckCircle2,
  Clock,
  NotebookPen,
} from "lucide-react";
import Link from "next/link";

import { ArchiveButton } from "@/components/understand/archive-button";
import { CollectionIcon } from "@/components/understand/collection-icon";
import { Badge } from "@/components/ui/badge";
import type { CollectionMeta, DocSummary } from "@/lib/understand/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocCard({
  doc,
  collection,
}: {
  doc: DocSummary;
  collection: CollectionMeta | undefined;
}) {
  const href = `/understand/doc?id=${encodeURIComponent(doc.id)}`;
  const pct = doc.topicCount
    ? Math.round((doc.topicsDone / doc.topicCount) * 100)
    : 0;

  return (
    <div
      className={cn(
        "group rounded-xl border bg-card px-4 py-3 transition-colors hover:border-foreground/20",
        doc.archived && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CollectionIcon
              name={collection?.icon ?? ""}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <Link
              href={href}
              className="line-clamp-1 font-medium tracking-tight hover:underline"
            >
              {doc.moduleNumber && (
                <span className="mr-1.5 font-mono text-muted-foreground">
                  {doc.moduleNumber}
                </span>
              )}
              {doc.title}
            </Link>
            {doc.archived && (
              <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                <Archive className="size-2.5" />
                understood
              </Badge>
            )}
          </div>

          {doc.summary && (
            <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
              {doc.summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{doc.id}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {doc.readingMinutes} min read
            </span>
            {doc.timeEstimate && <span>study: {doc.timeEstimate}</span>}
            {doc.hasNote && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
                <NotebookPen className="size-3" />
                note ({doc.noteWords}w)
              </span>
            )}
            <span suppressHydrationWarning>{relativeTime(doc.modifiedAt)}</span>
          </div>

          {doc.topicCount > 0 && (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {doc.topicsDone}/{doc.topicCount} topics
              </span>
              {doc.lessonsWritten > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <BookOpen className="size-3" />
                  {doc.lessonsWritten} lesson
                  {doc.lessonsWritten === 1 ? "" : "s"}
                </span>
              )}
              {pct === 100 && (
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              )}
            </div>
          )}

          {doc.audit.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {doc.audit.slice(0, 8).map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {item}
                </Badge>
              ))}
              {doc.audit.length > 8 && (
                <Badge
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                >
                  +{doc.audit.length - 8}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <ArchiveButton id={doc.id} archived={doc.archived} size="xs" />
        </div>
      </div>
    </div>
  );
}
