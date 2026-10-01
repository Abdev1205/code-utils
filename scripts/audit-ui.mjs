#!/usr/bin/env node
/**
 * Static guard for the UI mistakes that only blow up in the browser.
 *
 * Base UI and cmdk parts read context from a required ancestor, and portalled
 * content (menus, dialogs, tooltips) never renders during SSR — so a missing
 * root returns a clean 200 from curl and then throws on hydration. These checks
 * catch that class without needing a browser.
 *
 *   node scripts/audit-ui.mjs        (also: npm run audit:ui)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Part -> the ancestor that must provide its context. */
const REQUIRED_ROOT = {
  Command: ["CommandInput", "CommandList", "CommandEmpty", "CommandGroup", "CommandItem", "CommandSeparator"],
  DropdownMenu: ["DropdownMenuTrigger", "DropdownMenuContent", "DropdownMenuItem", "DropdownMenuLabel", "DropdownMenuGroup", "DropdownMenuRadioGroup", "DropdownMenuRadioItem", "DropdownMenuSeparator", "DropdownMenuCheckboxItem"],
  Tabs: ["TabsList", "TabsTrigger", "TabsContent"],
  Collapsible: ["CollapsibleTrigger", "CollapsibleContent"],
  Select: ["SelectTrigger", "SelectContent", "SelectItem", "SelectValue", "SelectGroup"],
  TooltipProvider: ["Tooltip", "TooltipTrigger", "TooltipContent"],
  Dialog: ["DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"],
  SidebarProvider: ["Sidebar", "SidebarInset", "SidebarTrigger", "SidebarMenuButton"],
};

/** Base UI requires these labels to sit inside a group, not loose in the menu. */
const GROUP_LABELS = { DropdownMenuLabel: ["DropdownMenuGroup", "DropdownMenuRadioGroup"] };

const partToRoot = new Map();
for (const [root, parts] of Object.entries(REQUIRED_ROOT)) {
  for (const part of parts) partToRoot.set(part, root);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") && !full.includes(`${path.sep}ui${path.sep}`)) out.push(full);
  }
  return out;
}

/** Finds a JSX open tag's attributes, respecting `>` nested inside `{...}`. */
function openTags(src, name) {
  const tags = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let match;
  while ((match = re.exec(src))) {
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push({ attrs: src.slice(match.index + match[0].length, i), index: match.index });
  }
  return tags;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const problems = [];
const files = [...walk("components"), ...walk("app")];

const layout = readFileSync("app/layout.tsx", "utf8");
const globalRoots = ["TooltipProvider", "SidebarProvider"].filter((r) =>
  new RegExp(`<${r}\\b`).test(layout),
);

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // 1. Every context-dependent part has its root in the same file (or globally).
  const needed = new Set();
  for (const [part, root] of partToRoot) {
    if (new RegExp(`<${part}\\b`).test(src)) needed.add(root);
  }
  const have = new Set(globalRoots);
  for (const root of needed) if (new RegExp(`<${root}\\b`).test(src)) have.add(root);
  if (/<CommandDialog\b/.test(src)) have.add("Dialog");
  if (/<SidebarMenuButton\b/.test(src)) have.add("Tooltip");
  for (const root of needed) {
    if (!have.has(root)) problems.push(`${file}: <${root}> missing for its parts`);
  }

  // 2. Menu group labels must sit inside a group.
  for (const [label, groups] of Object.entries(GROUP_LABELS)) {
    for (const tag of openTags(src, label)) {
      const before = src.slice(0, tag.index);
      const inGroup = groups.some((g) => {
        const opens = (before.match(new RegExp(`<${g}\\b`, "g")) ?? []).length;
        const closes = (before.match(new RegExp(`</${g}>`, "g")) ?? []).length;
        return opens > closes;
      });
      if (!inGroup) {
        problems.push(`${file}:${lineOf(src, tag.index)}: <${label}> is outside ${groups.join(" / ")}`);
      }
    }
  }

  // 3. A Button rendering a non-button must say so, or it strips native semantics.
  for (const tag of openTags(src, "Button")) {
    if (!/render=/.test(tag.attrs)) continue;
    if (!/render=\{[\s\S]*?<(Link|a)\b/.test(tag.attrs)) continue;
    if (!/nativeButton=\{false\}/.test(tag.attrs)) {
      problems.push(`${file}:${lineOf(src, tag.index)}: <Button render={<Link|a>} needs nativeButton={false}`);
    }
  }
}

console.log(`audit-ui: checked ${files.length} files`);
for (const problem of problems) console.log(`  ✗ ${problem}`);
if (!problems.length) console.log("  ✓ no problems");
process.exit(problems.length ? 1 : 0);
