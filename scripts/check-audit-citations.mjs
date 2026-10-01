#!/usr/bin/env node
/**
 * Deterministic checks on how lessons cite audit findings.
 *
 *   node scripts/check-audit-citations.mjs [track]
 *
 * Deliberately narrow. An earlier version tried to judge whether a lesson's
 * one-line gloss of a finding matched the audit map, by keyword overlap. It
 * flagged 21 citations, nearly all of them correct paraphrases: a lesson citing
 * "NET-04 (anyone can reach the database)" shares no keyword with a finding
 * titled "Security group ingress unrestricted on 5432", yet summarises it
 * fairly. Whether a paraphrase is faithful is a semantic question, so it
 * belongs to a reviewer, not to a regex. What a script CAN settle is whether a
 * cited code exists at all, and which findings nothing teaches.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const track = process.argv[2] ?? "kubernetes-basics";
// A track is public or private by which folder it sits in; check either.
const trackDir = ["understand/tracks", "understand/private"]
  .map((d) => path.join(REPO, d, track))
  .find((d) => existsSync(d)) ?? path.join(REPO, "understand/tracks", track);
const mapFile = path.join(trackDir, "15-audit-map.md");

if (!existsSync(mapFile)) {
  console.log(`Track "${track}" has no 15-audit-map.md — nothing to check.`);
  process.exit(0);
}

const findings = new Map();
/** Jira project keys appear in the map as ticket references, not findings. */
const tickets = new Set();
for (const line of readFileSync(mapFile, "utf8").split("\n")) {
  const m = line.match(/^- \[[ x]\] \*\*([A-Z0-9-]+)\*\*\s*(.*)$/);
  if (!m) continue;
  findings.set(m[1], m[2].split(" — ")[0].trim());
  // e.g. "In progress, ABC-12." — the ticket tracks the finding, it is not one.
  for (const t of m[2].matchAll(/\b([A-Z]{2,5}-\d+)\b/g)) tickets.add(t[1]);
}

// Prefixes come from the map itself rather than a hard-coded list, so a track
// that numbers its findings differently still checks correctly.
const prefixes = [...new Set([...findings.keys()].map((c) => c.split("-")[0]))];
const CODE = new RegExp(`\\b((?:${prefixes.join("|")})-\\d+)\\b`, "g");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

const lessons = walk(path.join(trackDir, "lessons"));
const unknown = new Map();   // code -> files citing it
const covered = new Set();

for (const file of lessons) {
  for (const m of readFileSync(file, "utf8").matchAll(CODE)) {
    const code = m[1];
    if (findings.has(code)) covered.add(code);
    else if (!tickets.has(code)) {
      if (!unknown.has(code)) unknown.set(code, new Set());
      unknown.get(code).add(path.relative(REPO, file));
    }
  }
}

console.log(
  `${lessons.length} lessons · ${findings.size} findings (${prefixes.join(", ")}) in the audit map`,
);

let bad = 0;
if (unknown.size) {
  bad = 1;
  console.log(`\n✗ cited codes that do not exist in the audit map:`);
  for (const [code, files] of unknown) {
    console.log(`    ${code} — in ${files.size} lesson(s):`);
    for (const f of [...files].slice(0, 5)) console.log(`        ${f}`);
  }
  console.log(`    Either the code is invented, or the audit map is missing it.`);
}

const uncovered = [...findings.keys()].filter((c) => !covered.has(c));
if (uncovered.length) {
  console.log(`\n· findings no lesson mentions yet (${uncovered.length}):`);
  console.log(`    ${uncovered.join(", ")}`);
}

if (!bad && !uncovered.length) console.log("\n  ✓ every cited code exists, every finding is covered");
process.exit(bad);
