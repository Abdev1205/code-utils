/**
 * Shapes for Claude Code session transcripts stored as JSONL under
 * ~/.claude/projects/<encoded-project-dir>/<session-id>.jsonl
 *
 * These are derived from the on-disk format, not an official schema, so every
 * field is treated as optional when reading.
 */

/** One session, as shown in the list. Small enough to ship ~50 of these to the client. */
export type SessionSummary = {
  id: string;
  /** Encoded directory name, e.g. "-Users-abhaymishra-code-internal-repos". */
  projectKey: string;
  /**
   * The directory that owns this session — the first `cwd` seen in the file.
   * `claude --resume` must run from here, since the project folder name is
   * derived from it.
   */
  projectPath: string;
  /** Short label for badges, e.g. "internal-repos". */
  projectLabel: string;
  /** Where Claude ended up working, if it moved during the session. */
  lastCwd: string | null;
  /** Absolute path to the .jsonl transcript on disk. */
  transcriptPath: string;
  /** From the `ai-title` entry Claude writes; falls back to the first prompt. */
  title: string;
  hasAiTitle: boolean;
  firstPrompt: string;
  lastPrompt: string;
  gitBranch: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  /** Sum of `turn_duration` entries — time Claude was actually working. */
  activeMs: number;
  /** Human prompts, not tool-result envelopes. */
  userMsgCount: number;
  assistantMsgCount: number;
  toolCallCount: number;
  /** Tool name -> times called. */
  toolCounts: Record<string, number>;
  models: string[];
  efforts: string[];
  outputTokens: number;
  cacheReadTokens: number;
  mcpServers: string[];
  skills: string[];
  subagentCount: number;
  sizeBytes: number;
  entryCount: number;
  claudeVersions: string[];
  /** Lowercased prompt text, capped — powers instant client-side search. */
  searchText: string;
};

export type ToolCallBody = {
  /** Pretty-printed input, truncated. */
  input: string;
  inputTruncated: boolean;
  result: string | null;
  resultTruncated: boolean;
};

export type ToolCall = {
  id: string;
  name: string;
  /** One-line gist: the bash command, the file path, the search pattern. */
  inputSummary: string;
  isError: boolean;
  mcpServer: string | null;
  /**
   * Small bodies ride along with the page. Large ones are fetched when you
   * expand the call — inlining every one made a long transcript weigh
   * megabytes for output almost nobody reads.
   */
  body: ToolCallBody | null;
};

export type TranscriptEntry = {
  uuid: string;
  role: "user" | "assistant" | "system";
  timestamp: string | null;
  /** Markdown body. Empty for tool-only assistant turns. */
  text: string;
  /** Set when `text` was clipped for rendering; `textLength` is the real size. */
  textTruncated: boolean;
  textLength: number;
  thinking: string;
  toolCalls: ToolCall[];
  model: string | null;
  effort: string | null;
  /** Subagent / sidechain work, rendered indented. */
  isSidechain: boolean;
  imageCount: number;
  /** Set on system notices we keep, e.g. compact boundaries. */
  notice: string | null;
};

export type SessionDetail = {
  summary: SessionSummary;
  /** Just the requested page of the transcript. */
  entries: TranscriptEntry[];
  /** Every human prompt in the session, regardless of page. */
  prompts: { uuid: string; timestamp: string | null; text: string }[];
  totalEntries: number;
  page: number;
  pageCount: number;
  pageSize: number;
};
