import type { ToolCall, ToolCallBody } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Injected context blocks that would otherwise swamp the real prompt text. */
const NOISE_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
];

export function stripNoise(text: string): string {
  let out = text;
  for (const re of NOISE_PATTERNS) out = out.replace(re, "");
  return out.trim();
}

/** Pulls readable text out of a message `content` that may be a string or block array. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n\n");
}

export function contentThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b && b.type === "thinking" && typeof b.thinking === "string")
    .map((b: any) => b.thinking)
    .join("\n\n");
}

export function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((b: any) => b && b.type === "image").length;
}

export function hasToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b: any) => b && b.type === "tool_result");
}

/**
 * A real prompt you typed, as opposed to a tool-result envelope or injected
 * context. Newer sessions mark these with `origin.kind === "human"`; the
 * content checks cover older ones.
 */
export function isHumanPrompt(entry: any): boolean {
  if (entry?.type !== "user") return false;
  if (entry.isMeta) return false;
  const content = entry.message?.content;
  if (hasToolResult(content)) return false;
  if (entry.origin?.kind && entry.origin.kind !== "human") return false;
  const text = stripNoise(contentToText(content));
  if (!text) return countImages(content) > 0;
  // Slash-command scaffolding and caveat preambles are not prompts.
  if (text.startsWith("Caveat:")) return false;
  return true;
}

function truncate(value: string, max: number): [string, boolean] {
  if (value.length <= max) return [value, false];
  return [value.slice(0, max), true];
}

/** Best-effort one-liner describing what a tool call actually did. */
export function summarizeToolInput(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const direct = first(
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "description",
    "subject",
    "prompt",
    "skill",
    "notebook_path",
  );
  if (direct) return direct.replace(/\s+/g, " ");
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    return `${input.todos.length} items`;
  }
  const firstString = Object.values(input).find(
    (v) => typeof v === "string" && v.trim(),
  );
  return typeof firstString === "string" ? firstString.replace(/\s+/g, " ") : "";
}

/** tool_result content is sometimes a string, sometimes blocks. */
export function toolResultToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content
    .map((b: any) => {
      if (typeof b === "string") return b;
      if (b?.type === "text") return b.text ?? "";
      if (b?.type === "image") return "[image]";
      return "";
    })
    .join("\n");
}

/**
 * Message bodies are rendered as markdown, and a pasted log can run to a
 * million characters. 99% of messages here are under 24k, so this clips only
 * the pathological pastes — the markdown export keeps the full text.
 */
export const MESSAGE_TEXT_MAX = 40_000;
export const THINKING_MAX = 20_000;

export function clip(text: string, max: number): [string, boolean] {
  return text.length <= max ? [text, false] : [text.slice(0, max), true];
}

export const TOOL_INPUT_MAX = 2000;
export const TOOL_RESULT_MAX = 3000;
/** Bodies at or under this combined size are cheap enough to inline. */
export const TOOL_INLINE_MAX = 700;

export function buildToolBody(block: any): ToolCallBody {
  const rawInput = block?.input ?? {};
  let pretty: string;
  try {
    pretty = JSON.stringify(rawInput, null, 2);
  } catch {
    pretty = String(rawInput);
  }
  const [input, inputTruncated] = truncate(pretty, TOOL_INPUT_MAX);
  return { input, inputTruncated, result: null, resultTruncated: false };
}

export function buildToolCall(block: any, entry: any): ToolCall {
  const name = block.name ?? "unknown";
  return {
    id: block.id ?? "",
    name,
    inputSummary: summarizeToolInput(name, block.input).slice(0, 300),
    isError: false,
    mcpServer: entry?.attributionMcpServer ?? null,
    body: buildToolBody(block),
  };
}

export function applyToolResult(body: ToolCallBody, block: any): void {
  const [result, resultTruncated] = truncate(
    toolResultToText(block.content).trim(),
    TOOL_RESULT_MAX,
  );
  body.result = result;
  body.resultTruncated = resultTruncated;
}

export function attachToolResult(call: ToolCall, block: any): void {
  if (call.body) applyToolResult(call.body, block);
  call.isError = Boolean(block.is_error);
}

/** How much of the page payload this call's body would cost. */
export function bodyWeight(body: ToolCallBody | null): number {
  if (!body) return 0;
  return body.input.length + (body.result?.length ?? 0);
}

/**
 * Fallback when a session file has no `cwd` anywhere: decode the folder name.
 * Lossy — a real directory containing "-" is indistinguishable from a
 * separator — which is why `cwd` from the entries is preferred.
 */
export function decodeProjectKey(key: string): string {
  return key.startsWith("-") ? "/" + key.slice(1).replace(/-/g, "/") : key;
}
