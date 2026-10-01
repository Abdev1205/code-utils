"use client";

import { ArrowLeft, CalendarRange, CheckCircle2, Target } from "lucide-react";
import Link from "next/link";

import { PrereqGraph } from "@/components/understand/prereq-graph";
import { Badge } from "@/components/ui/badge";
import type { PlanRow } from "@/lib/understand/plan";
import type { DocSummary } from "@/lib/understand/types";
import { cn } from "@/lib/utils";

export type TrackProgress = {
  id: string;
  name: string;
  description: string;
  modules: DocSummary[];
  plan: PlanRow[];
};

export function ProgressDashboard({
  tracks,
  archivedCount,
}: {
  tracks: TrackProgress[];
  archivedCount: number;
}) {
  const many = tracks.length > 1;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href="/understand"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        All documents
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Progress</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A topic counts as done when you can explain it to someone else without
        looking.
      </p>

      {tracks.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No tracks found under{" "}
            <code className="font-mono">understand/tracks/</code>.
          </p>
        </div>
      )}

      {tracks.map((track) => (
        <TrackSection
          key={track.id}
          track={track}
          showHeading={many}
          archivedCount={many ? null : archivedCount}
        />
      ))}
    </div>
  );
}

function TrackSection({
  track,
  showHeading,
  archivedCount,
}: {
  track: TrackProgress;
  showHeading: boolean;
  archivedCount: number | null;
}) {
  const { modules, plan } = track;
  const total = modules.reduce((n, m) => n + m.topicCount, 0);
  const done = modules.reduce((n, m) => n + m.topicsDone, 0);
  const lessons = modules.reduce((n, m) => n + m.lessonsWritten, 0);
  const complete = modules.filter(
    (m) => m.topicCount > 0 && m.topicsDone === m.topicCount,
  ).length;
  const noted = modules.filter((m) => m.hasNote).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const byNumber = new Map(modules.map((m) => [m.moduleNumber!, m]));

  return (
    <section className="mt-6">
      {showHeading && (
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight">{track.name}</h2>
          {track.description && (
            <p className="text-xs text-muted-foreground">{track.description}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Topics" value={`${done}/${total}`} sub={`${pct}%`} />
        <Stat label="Lessons ready" value={`${lessons}/${total}`} />
        <Stat label="Modules done" value={`${complete}/${modules.length}`} />
        <Stat label="Notes written" value={`${noted}/${modules.length}`} />
        {archivedCount !== null && (
          <Stat label="Docs archived" value={String(archivedCount)} />
        )}
        <Stat label="Study time left" value={remainingHours(modules)} />
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {plan.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <CalendarRange className="size-4 text-muted-foreground" />
            Your plan, and where you are on it
          </h3>
          <div className="space-y-2">
            {plan.map((row) => {
              const rowModules = row.modules
                .map((n) => byNumber.get(n))
                .filter(Boolean) as DocSummary[];
              const rowTotal = rowModules.reduce((n, m) => n + m.topicCount, 0);
              const rowDone = rowModules.reduce((n, m) => n + m.topicsDone, 0);
              const rowPct = rowTotal
                ? Math.round((rowDone / rowTotal) * 100)
                : 0;
              return (
                <div
                  key={row.when}
                  className="rounded-xl border bg-card px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{row.when}</span>
                    <span className="text-xs text-muted-foreground">
                      for {row.because}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {rowDone}/{rowTotal} topics
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.modules.map((number) => {
                      const mod = byNumber.get(number);
                      if (!mod) return null;
                      const full =
                        mod.topicCount > 0 && mod.topicsDone === mod.topicCount;
                      return (
                        <Link
                          key={number}
                          href={`/understand/doc?id=${encodeURIComponent(mod.id)}`}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:border-foreground/30",
                            full &&
                              "border-emerald-500/40 bg-emerald-500/[0.06]",
                          )}
                        >
                          <span className="font-mono text-muted-foreground">
                            {number}
                          </span>
                          <span className="max-w-40 truncate">
                            {mod.title.replace(/^\d+\.\s*/, "")}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {mod.topicsDone}/{mod.topicCount}
                          </span>
                          {full && (
                            <CheckCircle2 className="size-3 text-emerald-500" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${rowPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modules.length > 0 && (
        <>
          <div className="mt-8">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Target className="size-4 text-muted-foreground" />
              What unlocks what
            </h3>
            <PrereqGraph modules={modules} />
          </div>

          <div className="mt-8">
            <h3 className="mb-2 text-sm font-medium">Every module</h3>
            <div className="space-y-1.5">
              {modules.map((mod) => {
                const modulePct = mod.topicCount
                  ? Math.round((mod.topicsDone / mod.topicCount) * 100)
                  : 0;
                return (
                  <Link
                    key={mod.id}
                    href={`/understand/doc?id=${encodeURIComponent(mod.id)}`}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-foreground/20"
                  >
                    <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                      {mod.moduleNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {mod.title.replace(/^\d+\.\s*/, "")}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {mod.lessonsWritten}/{mod.topicCount} lessons
                    </span>
                    {mod.hasNote && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        note
                      </Badge>
                    )}
                    {mod.archived && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        understood
                      </Badge>
                    )}
                    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          modulePct === 100 ? "bg-emerald-500" : "bg-primary",
                        )}
                        style={{ width: `${modulePct}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {mod.topicsDone}/{mod.topicCount}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Sums the `**Time:** 4 to 6 hours` estimates for modules that aren't finished. */
function remainingHours(modules: DocSummary[]): string {
  let low = 0;
  let high = 0;
  for (const mod of modules) {
    if (mod.topicCount > 0 && mod.topicsDone === mod.topicCount) continue;
    const numbers = mod.timeEstimate?.match(/\d+/g);
    if (!numbers?.length) continue;
    const remaining = mod.topicCount ? 1 - mod.topicsDone / mod.topicCount : 1;
    low += Number(numbers[0]) * remaining;
    high += Number(numbers[numbers.length - 1]) * remaining;
  }
  if (!high) return "—";
  return `${Math.round(low)}–${Math.round(high)}h`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-lg leading-tight font-semibold tabular-nums">
          {value}
        </span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
