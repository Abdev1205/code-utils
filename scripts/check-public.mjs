#!/usr/bin/env node
/**
 * Refuses to let anything secret become public.
 *
 *   npm run check:public
 *
 * Content and app live in one repo, so "what is public" is simply what git
 * would commit: every file .gitignore does not exclude, committed or not. The
 * privacy rule is one .gitignore line ignoring every private/ folder, and this is
 * the check that the rule and the content agree:
 *
 *   1. no git-visible path contains a private/ segment (the rule holds)
 *   2. no git-visible file contains a credential or environment identifier
 *      (the content is templated with {{env:NAME|fallback}} where it must be)
 *   3. no git-visible file names a private track (a usage example or default
 *      argument can leak what you work on)
 *
 * Runs as part of `npm run check`. Exit 1 blocks.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = process.cwd();
const PRIVATE_DIR = path.join(APP, "understand", "private");

/**
 * Credentials. Unambiguous shapes, so these are checked in every file.
 */
const HIGH = [
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "bearer-ish token", re: /\b(sk|ghp|gho|xox[baprs])-[A-Za-z0-9_-]{16,}\b/ },
];

/**
 * Environment identifiers. These are shape-matched, so they false-positive on
 * machine-generated data — SVG path coordinates look exactly like IP addresses,
 * and lockfile hashes contain any digit run you like. Only applied to prose and
 * hand-written config, where a real identifier would actually be meaningful.
 */
const HEURISTIC = [
  { name: "AWS account id", re: /\b\d{12}\b/ },
  { name: "AWS resource id", re: /\b(vpc|subnet|sg|eni|igw|nat|ami|vol|snap)-[0-9a-f]{8,17}\b/ },
  // Excludes private, loopback, link-local (incl. the cloud metadata address),
  // CGNAT, multicast, netmasks and the RFC 5737 documentation ranges — all of
  // which appear in teaching material and identify nobody.
  { name: "public IPv4", re: /\b(?!10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|2(2[4-9]|[3-5]\d)\.|255\.)(\d{1,3}\.){3}\d{1,3}\b/ },
  // `.local` is left out on purpose: Kubernetes' own `svc.cluster.local` suffix
  // and the file `.env.local` are in every repo and reveal nothing.
  { name: "internal hostname", re: /\b[a-z0-9-]+\.(internal|corp|intranet)\b/ },
];

const PROSE = new Set([".md", ".mdx", ".txt", ".yml", ".yaml", ".sh", ".env", ".example", ".toml", ".ini", ".conf"]);
const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

/**
 * Filled in once the private tracks are known. A usage example or a default
 * argument that names a private track leaks what you work on, and nothing in
 * HIGH or HEURISTIC would notice — the names are only sensitive because you
 * marked those tracks private, so the rule has to be derived, not written down.
 */
const DYNAMIC = [];

function patternsFor(file) {
  const ext = path.extname(file);
  if (GENERATED.test(file)) return [...HIGH, ...DYNAMIC];
  if (PROSE.has(ext) || CODE.has(ext)) return [...HIGH, ...HEURISTIC, ...DYNAMIC];
  return [...HIGH, ...DYNAMIC];
}
/** Placeholders and documentation examples are allowed to look like the real thing. */
// A line that names example.com/.org/.net is documentation by convention (RFC 2606).
const ALLOW = [/\{\{env:[A-Z_][A-Z0-9_]*\}\}/, /\bexample\.(com|org|net)\b/, /\b(111122223333|123456789012|9111400012345?|919876543210)\b/, /\b(1\.2\.3\.4|8\.8\.8\.8|0\.0\.0\.0|255\.255\.255\.255)\b/];


function scan(file, text) {
  const hits = [];
  const patterns = patternsFor(file);
  text.split("\n").forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const d of patterns) {
      const m = line.match(d.re);
      if (m) hits.push({ file, line: i + 1, what: d.name, sample: m[0] });
    }
  });
  return hits;
}


// ---- what git would publish: tracked + untracked, .gitignore respected.
let files;
try {
  files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: APP, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
} catch {
  console.error("This must run inside the git repo (git ls-files failed).");
  process.exit(1);
}

// ---- 1. the rule holds
const leaked = files.filter((f) => f.split("/").includes("private"));

// ---- 3. derived rule: the private track names themselves
// Only real tracks (folders with a track.json). private/claude/ is a folder of
// saved sessions, and "claude" is a word this codebase is allowed to say.
const privateTracks = existsSync(PRIVATE_DIR)
  ? readdirSync(PRIVATE_DIR).filter((n) => existsSync(path.join(PRIVATE_DIR, n, "track.json")))
  : [];
for (const id of privateTracks) {
  DYNAMIC.push({
    name: `private track name "${id}"`,
    re: new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
  });
}

// ---- 2. the content is clean
const problems = [];
for (const rel of files) {
  const f = path.join(APP, rel);
  if (!existsSync(f) || statSync(f).size > 2_000_000) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue; // binary
  }
  problems.push(...scan(rel, text));
}

const publicTracks = existsSync("understand/tracks")
  ? readdirSync("understand/tracks").filter((n) => statSync(path.join("understand/tracks", n)).isDirectory())
  : [];
console.log(`public  : ${files.length} files; tracks: ${publicTracks.join(", ") || "none"}`);
console.log(`private : ${privateTracks.join(", ") || "none"}  (never leaves this machine)`);

if (leaked.length) {
  console.error(`\n✗ BLOCKED — ${leaked.length} private path(s) are visible to git. Is the private/ rule still in .gitignore?`);
  for (const f of leaked.slice(0, 10)) console.error(`    ${f}`);
  process.exit(1);
}
if (problems.length) {
  console.error(`\n✗ BLOCKED — ${problems.length} thing(s) that must not be public:\n`);
  for (const p of problems.slice(0, 25)) console.error(`    ${p.file}:${p.line}  ${p.what}: ${p.sample}`);
  if (problems.length > 25) console.error(`    … and ${problems.length - 25} more`);
  console.error(
    "\n  Fix each one at the source, then re-run:\n" +
      "    · an identifier    → {{env:NAME|fallback}}, with NAME listed in .env.example\n" +
      "    · a private name   → rename it, or use the example track instead\n" +
      "    · a whole document → move it under understand/private/",
  );
  process.exit(1);
}
console.log(`scan    : clean`);
