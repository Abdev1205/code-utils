import { resumeCommand } from "./commands";
import type { SessionDetail } from "./types";

function stamp(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** Renders a session as a readable markdown document for archiving or sharing. */
export function sessionToMarkdown(detail: SessionDetail): string {
  const { summary, entries } = detail;
  const out: string[] = [];

  out.push(`# ${summary.title}`, "");
  out.push(`| | |`, `|---|---|`);
  out.push(`| Session ID | \`${summary.id}\` |`);
  out.push(`| Project | \`${summary.projectPath}\` |`);
  if (summary.lastCwd) out.push(`| Last working dir | \`${summary.lastCwd}\` |`);
  if (summary.gitBranch) out.push(`| Git branch | \`${summary.gitBranch}\` |`);
  out.push(`| Started | ${stamp(summary.startedAt)} |`);
  out.push(`| Last activity | ${stamp(summary.lastActivityAt)} |`);
  out.push(`| Messages | ${summary.userMsgCount} prompts, ${summary.assistantMsgCount} replies |`);
  out.push(`| Tool calls | ${summary.toolCallCount} |`);
  if (summary.models.length) out.push(`| Models | ${summary.models.join(", ")} |`);
  out.push("");
  out.push("Resume this session:", "", "```bash", resumeCommand(summary), "```", "");

  out.push("---", "");

  for (const entry of entries) {
    if (entry.notice) {
      out.push(`> ${entry.notice}`, "");
      continue;
    }

    const who = entry.role === "user" ? "You" : entry.isSidechain ? "Subagent" : "Claude";
    const when = stamp(entry.timestamp);
    out.push(`## ${who}${when ? ` — ${when}` : ""}`, "");

    if (entry.imageCount) out.push(`_[${entry.imageCount} image(s) attached]_`, "");
    if (entry.text) out.push(entry.text, "");

    for (const call of entry.toolCalls) {
      const gist = call.inputSummary ? ` — ${call.inputSummary}` : "";
      out.push(`<details>`);
      out.push(`<summary>🔧 ${call.name}${gist}${call.isError ? " (error)" : ""}</summary>`, "");
      // Exports are built with `all: true`, so every body is present.
      if (call.body) {
        out.push(
          "```json",
          call.body.input + (call.body.inputTruncated ? "\n… truncated" : ""),
          "```",
          "",
        );
        if (call.body.result) {
          out.push(
            "```",
            call.body.result + (call.body.resultTruncated ? "\n… truncated" : ""),
            "```",
            "",
          );
        }
      }
      out.push(`</details>`, "");
    }
  }

  return out.join("\n");
}

/** Safe, descriptive download filename. */
export function markdownFilename(detail: SessionDetail): string {
  const slug = detail.summary.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "session"}-${detail.summary.id.slice(0, 8)}.md`;
}
