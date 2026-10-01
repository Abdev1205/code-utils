"use client";

import {
  FileSearch,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import * as React from "react";

import { SessionCard } from "@/components/claude-sessions/session-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SessionSummary } from "@/lib/claude-sessions/types";
import { formatDuration, shortPath } from "@/lib/format";

type SortKey = "recent" | "oldest" | "prompts" | "longest" | "size";
type TimeKey = "all" | "today" | "7d" | "30d";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Most recent",
  oldest: "Oldest first",
  prompts: "Most prompts",
  longest: "Longest running",
  size: "Largest transcript",
};

const TIME_LABELS: Record<TimeKey, string> = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function windowStart(key: TimeKey): number {
  if (key === "all") return 0;
  const now = new Date();
  if (key === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = key === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

export function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  const [query, setQuery] = React.useState("");
  const [project, setProject] = React.useState("all");
  const [time, setTime] = React.useState<TimeKey>("all");
  const [sort, setSort] = React.useState<SortKey>("recent");
  const [deep, setDeep] = React.useState<{
    query: string;
    hits: Map<string, number>;
  } | null>(null);
  const [deepLoading, setDeepLoading] = React.useState(false);

  const projects = React.useMemo(() => {
    const paths = new Map<string, number>();
    for (const session of sessions) {
      paths.set(session.projectPath, (paths.get(session.projectPath) ?? 0) + 1);
    }
    return [...paths.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const after = windowStart(time);

    const filtered = sessions.filter((session) => {
      if (project !== "all" && session.projectPath !== project) return false;
      if (after && (Date.parse(session.lastActivityAt ?? "") || 0) < after)
        return false;
      if (deep) return deep.hits.has(session.id);
      if (!needle) return true;
      return (
        session.title.toLowerCase().includes(needle) ||
        session.searchText.includes(needle) ||
        session.projectPath.toLowerCase().includes(needle) ||
        session.id.includes(needle) ||
        Object.keys(session.toolCounts).some((t) =>
          t.toLowerCase().includes(needle),
        )
      );
    });

    if (deep) {
      return filtered.sort(
        (a, b) => (deep.hits.get(b.id) ?? 0) - (deep.hits.get(a.id) ?? 0),
      );
    }

    const time_ = (s: SessionSummary) =>
      Date.parse(s.lastActivityAt ?? "") || 0;
    return filtered.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (
            (Date.parse(a.startedAt ?? "") || 0) -
            (Date.parse(b.startedAt ?? "") || 0)
          );
        case "prompts":
          return b.userMsgCount - a.userMsgCount;
        case "longest":
          return b.activeMs - a.activeMs;
        case "size":
          return b.sizeBytes - a.sizeBytes;
        default:
          return time_(b) - time_(a);
      }
    });
  }, [sessions, query, project, time, sort, deep]);

  async function runDeepSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setDeepLoading(true);
    try {
      const res = await fetch(
        `/api/claude-sessions/search?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      const hits = new Map<string, number>();
      for (const row of data.results ?? []) hits.set(row.id, row.hits);
      setDeep({ query: q, hits });
    } finally {
      setDeepLoading(false);
    }
  }

  const totals = React.useMemo(
    () => ({
      prompts: sessions.reduce((n, s) => n + s.userMsgCount, 0),
      activeMs: sessions.reduce((n, s) => n + s.activeMs, 0),
    }),
    [sessions],
  );

  const filtersActive =
    query !== "" || project !== "all" || time !== "all" || deep !== null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Claude Sessions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sessions.length} sessions across {projects.length}{" "}
          {projects.length === 1 ? "project" : "projects"} · {totals.prompts}{" "}
          prompts · {formatDuration(totals.activeMs)} of work. Copy a command to
          resume or fork any of them.
        </p>
      </div>

      <div className="sticky top-14 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (deep) setDeep(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runDeepSearch();
            }}
            placeholder="Search titles and your prompts…"
            className="h-8 pl-8"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setDeep(null);
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={runDeepSearch}
          disabled={query.trim().length < 2 || deepLoading}
          title="Grep the full transcripts, including tool output"
        >
          {deepLoading ? <Loader2 className="animate-spin" /> : <FileSearch />}
          <span className="hidden sm:inline">Deep search</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <SlidersHorizontal />
            <span className="hidden sm:inline">
              {project === "all" ? "All projects" : shortPath(project)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-64">
            {/* Base UI requires GroupLabel to sit inside its Group/RadioGroup. */}
            <DropdownMenuRadioGroup
              value={project}
              onValueChange={(v) => setProject(v as string)}
            >
              <DropdownMenuLabel>Project</DropdownMenuLabel>
              <DropdownMenuRadioItem value="all">
                All projects
              </DropdownMenuRadioItem>
              {projects.map(([path, count]) => (
                <DropdownMenuRadioItem key={path} value={path}>
                  <span className="truncate">{shortPath(path)}</span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    {count}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={time}
              onValueChange={(v) => setTime(v as TimeKey)}
            >
              <DropdownMenuLabel>Last active</DropdownMenuLabel>
              {Object.entries(TIME_LABELS).map(([key, label]) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <span className="max-sm:hidden">{SORT_LABELS[sort]}</span>
            <span className="sm:hidden">Sort</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(v) => setSort(v as SortKey)}
            >
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {Object.entries(SORT_LABELS).map(([key, label]) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {deep && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
          <FileSearch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            Deep search for <span className="font-mono">{deep.query}</span> —
            found in {deep.hits.size} session{deep.hits.size === 1 ? "" : "s"},
            ranked by hit count.
          </span>
          <Button variant="ghost" size="xs" onClick={() => setDeep(null)}>
            Clear
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {sessions.length === 0
              ? "No sessions found under ~/.claude/projects."
              : "Nothing matches those filters."}
          </p>
          {filtersActive && sessions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setQuery("");
                setProject("all");
                setTime("all");
                setDeep(null);
              }}
            >
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-2 text-xs text-muted-foreground">
            Showing {visible.length} of {sessions.length}
          </div>
          <div className="flex flex-col gap-2">
            {visible.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                deepHits={deep?.hits.get(session.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
