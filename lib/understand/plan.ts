import fsp from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./roots";

export type PlanRow = {
  when: string;
  /** Module numbers mentioned in the row, e.g. ["00", "01", "07"]. */
  modules: string[];
  study: string;
  because: string;
};

/**
 * Reads the "Learning order" table out of a track's README, so the dashboard
 * shows the plan you already wrote rather than inventing one. Takes the track's
 * directory because each track has its own README and its own plan.
 */
export async function readPlan(trackDir: string): Promise<PlanRow[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(
      path.join(repoRoot(), trackDir, "README.md"),
      "utf8",
    );
  } catch {
    return [];
  }

  const rows: PlanRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^-+$/.test(cells[0]) || cells[0].toLowerCase() === "when") continue;
    const modules = [...new Set(cells[1].match(/`(\d{2})`/g) ?? [])].map((m) =>
      m.replace(/`/g, ""),
    );
    if (!modules.length) continue;
    rows.push({
      when: cells[0],
      modules,
      study: cells[1].replace(/`/g, ""),
      because: cells[2],
    });
  }
  return rows;
}
