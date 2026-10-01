"use client";

import { Archive, BookOpen, LayoutGrid, Search, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { ArtifactRegistry } from "@/components/understand/artifact-registry";
import { DocCard } from "@/components/understand/doc-card";
import { SetupHint } from "@/components/setup-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ArtifactLink,
  CollectionMeta,
  DocSummary,
} from "@/lib/understand/types";
import { cn } from "@/lib/utils";

type View = "active" | "archived" | "all";

export function UnderstandLibrary({
  docs,
  collections,
  artifacts,
}: {
  docs: DocSummary[];
  collections: CollectionMeta[];
  artifacts: ArtifactLink[];
}) {
  const [query, setQuery] = React.useState("");
  // The sidebar owns collection navigation and encodes it in the URL, so a
  // link to a filtered view is shareable and the back button works.
  const requested = useSearchParams().get("collection");
  const collection =
    requested && collections.some((c) => c.id === requested)
      ? requested
      : "all";
  const [view, setView] = React.useState<View>("active");

  const counts = React.useMemo(() => {
    const byCollection = new Map<string, number>();
    for (const doc of docs) {
      byCollection.set(
        doc.collection,
        (byCollection.get(doc.collection) ?? 0) + 1,
      );
    }
    return {
      byCollection,
      archived: docs.filter((d) => d.archived).length,
      topics: docs.reduce((n, d) => n + d.topicCount, 0),
      topicsDone: docs.reduce((n, d) => n + d.topicsDone, 0),
    };
  }, [docs]);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (collection !== "all" && doc.collection !== collection) return false;
      if (view === "active" && doc.archived) return false;
      if (view === "archived" && !doc.archived) return false;
      if (!needle) return true;
      return (
        doc.searchText.includes(needle) ||
        doc.title.toLowerCase().includes(needle)
      );
    });
  }, [docs, query, collection, view]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, DocSummary[]>();
    for (const doc of visible) {
      const list = map.get(doc.collection) ?? [];
      list.push(doc);
      map.set(doc.collection, list);
    }
    return map;
  }, [visible]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Understand</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {docs.length} documents · {counts.topicsDone}/{counts.topics} topics
            understood · {counts.archived} archived. Archive means you&apos;ve
            read it and can explain it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/understand/progress" />}
          nativeButton={false}
        >
          <LayoutGrid />
          Progress
        </Button>
      </div>

      <div className="sticky top-14 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every document…"
            className="h-8 pl-8"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(["active", "archived", "all"] as View[]).map((key) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "rounded-md px-2 py-1 text-xs capitalize transition-colors",
                view === key
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "archived" && <Archive className="mr-1 inline size-3" />}
              {key}
              {key === "archived" && counts.archived > 0 && (
                <span className="ml-1 tabular-nums">({counts.archived})</span>
              )}
            </button>
          ))}
        </div>
      </div>


      {visible.length === 0 ? (
        docs.length === 0 ? (
          <SetupHint
            icon={BookOpen}
            title="No documents yet"
            lead="Understand reads markdown you already have — a curriculum you're working through, runbooks, write-ups. Point it at a folder, or start a track from scratch."
            steps={[
              {
                text: "By default it looks one directory above the app. Create a track there:",
                command:
                  "mkdir -p understand/tracks/my-subject/{lessons,notes}",
              },
              {
                text: "Describe the track. The context line is what grounds generated lessons in your world.",
                command: `echo '{"name":"My Subject","order":1,"context":"Who is learning this and what system they work on."}' > understand/tracks/my-subject/track.json`,
              },
              {
                text: "Add a module — a markdown file whose `- [ ]` lines become its topics.",
                command:
                  "printf '# 01. First module\n\n## Topics\n\n- [ ] **A topic** — one line about it.\n' > understand/tracks/my-subject/01-first.md",
              },
              {
                text: "Reload. The track appears, and every topic gets a \u201cTeach me this\u201d button.",
              },
              {
                text: "Already have docs elsewhere? Point the app at them instead of moving anything.",
                command: "UNDERSTAND_ROOT=/path/to/your/docs npm run dev",
              },
            ]}
            footer={
              <>
                Collections beyond tracks — runbooks, policies, reports — are
                configured in{" "}
                <code className="font-mono">lib/understand/roots.ts</code>.
              </>
            }
          />
        ) : (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <BookOpen className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {view === "archived"
                ? "Nothing archived yet. Archive a document once you can explain it."
                : "No documents match."}
            </p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([id, list]) => {
            const meta = collections.find((c) => c.id === id);
            return (
              <section key={id}>
                <h2 className="mb-2 flex items-baseline gap-2 text-sm font-medium">
                  {meta?.name ?? id}
                  <span className="text-xs font-normal text-muted-foreground">
                    {meta?.description}
                  </span>
                </h2>
                <div className="flex flex-col gap-2">
                  {list.map((doc) => (
                    <DocCard key={doc.id} doc={doc} collection={meta} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-8">
        <ArtifactRegistry artifacts={artifacts} />
      </div>
    </div>
  );
}
