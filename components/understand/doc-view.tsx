"use client";

import { ArrowLeft, Clock, FileText, Link2 } from "lucide-react";
import Link from "next/link";

import { CopyButton } from "@/components/copy-button";
import { ArchiveButton } from "@/components/understand/archive-button";
import { DocWorkspace } from "@/components/understand/doc-workspace";
import { Badge } from "@/components/ui/badge";
import { absoluteTime } from "@/lib/format";
import type { CollectionMeta, DocDetail } from "@/lib/understand/types";

export function DocView({
  detail,
  collection,
  initialTopic,
}: {
  detail: DocDetail;
  /** Where "back" goes: the collection you came from, which the sidebar also shows. */
  collection: CollectionMeta | null;
  initialTopic: number | null;
}) {
  const { summary, related } = detail;
  const moduleName = summary.id.split("/").pop()?.replace(/\.md$/, "") ?? "";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
      <Link
        href={
          collection
            ? `/understand?collection=${encodeURIComponent(collection.id)}`
            : "/understand"
        }
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        {collection?.name ?? "All documents"}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {summary.title}
          </h1>
          {summary.summary && (
            <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
              {summary.summary}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono">
              <FileText className="size-3" />
              {summary.id}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {summary.readingMinutes} min read ·{" "}
              {summary.wordCount.toLocaleString()} words
            </span>
            {summary.timeEstimate && (
              <span>study time: {summary.timeEstimate}</span>
            )}
            <span>updated {absoluteTime(summary.modifiedAt)}</span>
          </div>

          {(summary.prerequisites.length > 0 || summary.audit.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {summary.prerequisites.map((p) => (
                <Badge
                  key={p}
                  variant="secondary"
                  className="font-mono text-xs"
                >
                  needs {p}
                </Badge>
              ))}
              {summary.audit.map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {item}
                </Badge>
              ))}
            </div>
          )}

          {summary.archived && summary.archivedAt && (
            <p className="mt-2 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
              Marked understood on {absoluteTime(summary.archivedAt)}
              {summary.archiveNote ? ` — “${summary.archiveNote}”` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <CopyButton
            value={`${summary.id}`}
            label="Path copied"
            size="sm"
            variant="outline"
            title="Copy the file path"
          />
          <ArchiveButton id={summary.id} archived={summary.archived} />
        </div>
      </div>

      <DocWorkspace
        detail={detail}
        moduleName={moduleName}
        initialTopic={initialTopic}
      />

      {related.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium">
            Related documents ({related.length})
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            They reference at least one of the same audit items.
          </p>
          <div className="flex flex-col gap-1.5">
            {related.map((doc) => (
              <Link
                key={doc.id}
                href={`/understand/doc?id=${encodeURIComponent(doc.id)}`}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-foreground/20"
              >
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {doc.collection}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
