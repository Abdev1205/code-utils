"use client";

import Link from "next/link";
import * as React from "react";

import type { DocSummary } from "@/lib/understand/types";

type Node = {
  id: string;
  number: string;
  title: string;
  done: number;
  total: number;
  prerequisites: string[];
  level: number;
  row: number;
};

const COL_WIDTH = 190;
const ROW_HEIGHT = 74;
const NODE_W = 158;
const NODE_H = 54;

/**
 * Modules laid out left to right by dependency depth, with arrows from each
 * prerequisite. Levels are computed from the `**Prerequisites:**` lines, so the
 * picture stays correct if the curriculum changes.
 */
export function PrereqGraph({ modules }: { modules: DocSummary[] }) {
  const nodes = React.useMemo(() => {
    const byNumber = new Map<string, DocSummary>();
    for (const m of modules)
      if (m.moduleNumber) byNumber.set(m.moduleNumber, m);

    // Longest-path depth, guarded against a cycle in the source text.
    const level = new Map<string, number>();
    function depth(number: string, seen: Set<string>): number {
      if (level.has(number)) return level.get(number)!;
      if (seen.has(number)) return 0;
      const doc = byNumber.get(number);
      const prereqs = (doc?.prerequisites ?? []).filter((p) => byNumber.has(p));
      const value = prereqs.length
        ? 1 +
          Math.max(...prereqs.map((p) => depth(p, new Set([...seen, number]))))
        : 0;
      level.set(number, value);
      return value;
    }
    for (const number of byNumber.keys()) depth(number, new Set());

    const rowCursor = new Map<number, number>();
    const out: Node[] = [];
    for (const number of [...byNumber.keys()].sort()) {
      const doc = byNumber.get(number)!;
      const lvl = level.get(number) ?? 0;
      const row = rowCursor.get(lvl) ?? 0;
      rowCursor.set(lvl, row + 1);
      out.push({
        id: doc.id,
        number,
        title: doc.title.replace(/^\d+\.\s*/, ""),
        done: doc.topicsDone,
        total: doc.topicCount,
        prerequisites: doc.prerequisites.filter((p) => byNumber.has(p)),
        level: lvl,
        row,
      });
    }
    return out;
  }, [modules]);

  if (!nodes.length) return null;

  const cols = Math.max(...nodes.map((n) => n.level)) + 1;
  const rows = Math.max(...nodes.map((n) => n.row)) + 1;
  const width = cols * COL_WIDTH + 20;
  const height = rows * ROW_HEIGHT + 20;
  const at = (n: Node) => ({
    x: n.level * COL_WIDTH + 10,
    y: n.row * ROW_HEIGHT + 10,
  });
  const byNumber = new Map(nodes.map((n) => [n.number, n]));

  return (
    <div className="overflow-x-auto rounded-xl border bg-card p-3">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
        role="img"
        aria-label="Module prerequisite graph"
      >
        <defs>
          <marker
            id="prereq-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,1 L7,4 L0,7 z" className="fill-muted-foreground/50" />
          </marker>
        </defs>

        {nodes.flatMap((node) =>
          node.prerequisites.map((p) => {
            const from = byNumber.get(p);
            if (!from) return null;
            const a = at(from);
            const b = at(node);
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${p}-${node.number}`}
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                fill="none"
                strokeWidth={1.25}
                className="stroke-muted-foreground/35"
                markerEnd="url(#prereq-arrow)"
              />
            );
          }),
        )}

        {nodes.map((node) => {
          const { x, y } = at(node);
          const pct = node.total ? node.done / node.total : 0;
          return (
            <g key={node.number}>
              <Link href={`/understand/doc?id=${encodeURIComponent(node.id)}`}>
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className="fill-background stroke-border transition-colors hover:stroke-foreground/40"
                  strokeWidth={1}
                />
                <text
                  x={x + 10}
                  y={y + 19}
                  className="fill-muted-foreground font-mono text-[11px]"
                >
                  {node.number}
                </text>
                <text
                  x={x + 32}
                  y={y + 19}
                  className="fill-foreground text-[12px]"
                >
                  {node.title.length > 20
                    ? node.title.slice(0, 19) + "…"
                    : node.title}
                </text>
                <rect
                  x={x + 10}
                  y={y + 30}
                  width={NODE_W - 20}
                  height={5}
                  rx={2.5}
                  className="fill-muted"
                />
                <rect
                  x={x + 10}
                  y={y + 30}
                  width={(NODE_W - 20) * pct}
                  height={5}
                  rx={2.5}
                  className={pct === 1 ? "fill-emerald-500" : "fill-primary"}
                />
                <text
                  x={x + 10}
                  y={y + 47}
                  className="fill-muted-foreground text-[10px]"
                >
                  {node.done}/{node.total} topics
                </text>
              </Link>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Arrows point from a prerequisite to what it unlocks. Left-most modules
        need nothing first.
      </p>
    </div>
  );
}
