import type { Topic } from "./types";

const CHECKBOX = /^(\s*)- \[([ xX])\]\s*(.*)$/;
const AUDIT_REF = /\b(AWS|K8S|EGR|SGP)-\d+\b/g;

/** Matches the study hints indented under a topic. */
const SUB_LINE = /^\s+- (Audit|Ask|See):\s*(.*)$/;

export type ParsedDoc = {
  title: string;
  summary: string;
  prerequisites: string[];
  timeEstimate: string | null;
  headings: string[];
  topics: Topic[];
  audit: string[];
  wordCount: number;
};

/** `- [ ] **IP addresses** — Every machine…` → title and description. */
function splitTopicLine(rest: string): { title: string; description: string } {
  const bold = rest.match(/^\*\*(.+?)\*\*\s*(?:—|-|–)?\s*(.*)$/);
  if (bold) return { title: bold[1].trim(), description: bold[2].trim() };
  const code = rest.match(/^`(.+?)`\s*(.*)$/);
  if (code) return { title: code[1].trim(), description: code[2].trim() };
  const dash = rest.split(/\s+—\s+/);
  if (dash.length > 1)
    return {
      title: dash[0].trim(),
      description: dash.slice(1).join(" — ").trim(),
    };
  return { title: rest.trim(), description: "" };
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export function parseMarkdown(raw: string): ParsedDoc {
  const lines = raw.split("\n");
  const topics: Topic[] = [];
  const headings: string[] = [];
  let title = "";
  const summaryParts: string[] = [];
  let prerequisites: string[] = [];
  let timeEstimate: string | null = null;
  /** Counts every checkbox in file order — this index is how a tick is addressed. */
  let checkboxIndex = 0;
  let collectingGoal = false;

  for (const line of lines) {
    if (!title) {
      const h1 = line.match(/^#\s+(.*)$/);
      if (h1) {
        title = stripMarkdown(h1[1]);
        continue;
      }
    }
    const h2 = line.match(/^##+\s+(.*)$/);
    if (h2) {
      headings.push(stripMarkdown(h2[1]));
      collectingGoal = false;
      continue;
    }

    // `**Goal:** …` may wrap onto following lines until a blank line.
    const goal = line.match(/^\*\*Goal:\*\*\s*(.*)$/);
    if (goal) {
      summaryParts.push(goal[1]);
      collectingGoal = true;
      continue;
    }
    if (collectingGoal) {
      if (!line.trim() || line.startsWith("**") || line.startsWith("-")) {
        collectingGoal = false;
      } else {
        summaryParts.push(line.trim());
        continue;
      }
    }

    const prereq = line.match(/\*\*Prerequisites:\*\*\s*([^.*]*)/);
    if (prereq) {
      const value = prereq[1].trim().toLowerCase();
      prerequisites = value.startsWith("none")
        ? []
        : (value.match(/\d{2}/g) ?? []).map((n) => n);
    }
    const time = line.match(/\*\*Time:\*\*\s*([^.*]*)/);
    if (time) timeEstimate = time[1].trim();

    const box = line.match(CHECKBOX);
    if (box) {
      const { title: topicTitle, description } = splitTopicLine(box[3]);
      topics.push({
        index: checkboxIndex++,
        title: stripMarkdown(topicTitle),
        description: stripMarkdown(description),
        done: box[2].toLowerCase() === "x",
        audit: [...new Set(box[3].match(AUDIT_REF) ?? [])],
        ask: null,
        see: null,
        lesson: null,
        note: null,
        lessonId: "",
      });
      continue;
    }

    const sub = line.match(SUB_LINE);
    if (sub && topics.length) {
      const current = topics[topics.length - 1];
      const value = sub[2].trim();
      if (sub[1] === "Audit") {
        current.audit = [
          ...new Set([...current.audit, ...(value.match(AUDIT_REF) ?? [])]),
        ];
      } else if (sub[1] === "Ask") {
        current.ask = value.replace(/^"|"$/g, "");
      } else {
        current.see = value.replace(/^`|`$/g, "");
      }
    }
  }

  // Fall back to the first real paragraph when there's no Goal line.
  let summary = stripMarkdown(summaryParts.join(" "));
  if (!summary) {
    for (const line of lines) {
      const text = line.trim();
      if (
        !text ||
        text.startsWith("#") ||
        text.startsWith("- ") ||
        text.startsWith("|")
      )
        continue;
      summary = stripMarkdown(text);
      break;
    }
  }

  return {
    title,
    summary,
    prerequisites,
    timeEstimate,
    headings,
    topics,
    audit: [...new Set(raw.match(AUDIT_REF) ?? [])].sort(),
    wordCount: raw.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Flips the nth checkbox in a file, leaving every other byte untouched.
 * Returns null when the index doesn't exist, so a stale UI can't corrupt a file.
 */
export function toggleCheckbox(
  raw: string,
  index: number,
  done: boolean,
): string | null {
  const lines = raw.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const box = lines[i].match(CHECKBOX);
    if (!box) continue;
    if (seen === index) {
      lines[i] = `${box[1]}- [${done ? "x" : " "}] ${box[3]}`;
      return lines.join("\n");
    }
    seen++;
  }
  return null;
}
