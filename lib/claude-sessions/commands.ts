/**
 * Shell commands you can run against a saved session. No node imports here —
 * client components render these directly.
 *
 * All of them `cd` into the session's owning directory first. Claude Code keys
 * a project's history off the directory it was started in, so `--resume` run
 * from somewhere else will not find the session.
 */
import type { SessionSummary } from "./types";

export type SessionCommand = {
  key: string;
  label: string;
  description: string;
  command: string;
  /** Contains a placeholder you must fill in before running. */
  needsEdit?: boolean;
};

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9._\-/]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function inDir(projectPath: string, rest: string): string {
  return `cd ${shellQuote(projectPath)} && ${rest}`;
}

export function resumeCommand(summary: SessionSummary): string {
  return inDir(summary.projectPath, `claude --resume ${summary.id}`);
}

export function forkCommand(summary: SessionSummary): string {
  return inDir(summary.projectPath, `claude --resume ${summary.id} --fork-session`);
}

/** Every command offered for a session, in the order they're shown. */
export function sessionCommands(summary: SessionSummary): SessionCommand[] {
  const dir = summary.projectPath;
  const id = summary.id;

  return [
    {
      key: "resume",
      label: "Resume",
      description: "Pick up exactly where you left off. Continues this same session.",
      command: resumeCommand(summary),
    },
    {
      key: "fork",
      label: "Fork",
      description:
        "Start a new session from this one's history. The original stays untouched — good for trying a different direction.",
      command: forkCommand(summary),
    },
    {
      key: "ask",
      label: "Ask one question",
      description:
        "Headless query with the session's full context. Prints an answer and exits — nothing is written back.",
      command: inDir(dir, `claude --resume ${id} -p "your question here"`),
      needsEdit: true,
    },
    {
      key: "background",
      label: "Resume in background",
      description: "Runs detached as a background agent. Manage it later with `claude agents`.",
      command: inDir(dir, `claude --resume ${id} --bg`),
    },
    {
      key: "model",
      label: "Resume with overrides",
      description: "Same session, different model or effort level for the rest of it.",
      command: inDir(dir, `claude --resume ${id} --model opus --effort high`),
      needsEdit: true,
    },
    {
      key: "fork-ask",
      label: "Fork and ask",
      description:
        "Fork into a fresh session and open it with a starting prompt already typed.",
      command: inDir(dir, `claude --resume ${id} --fork-session "pick up where we left off"`),
      needsEdit: true,
    },
    {
      key: "id",
      label: "Session ID",
      description: "The raw UUID, for your own commands.",
      command: id,
    },
    {
      key: "transcript",
      label: "Transcript path",
      description: "The raw JSONL on disk. Read-only — don't edit it while a session is live.",
      command: summary.transcriptPath,
    },
    {
      key: "open-transcript",
      label: "Open transcript in editor",
      description: "Opens the raw JSONL in VS Code.",
      command: `code ${shellQuote(summary.transcriptPath)}`,
    },
  ];
}
