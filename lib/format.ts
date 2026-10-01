import { formatDistanceToNowStrict } from "date-fns";

/** "3 days ago". Rendered inside suppressHydrationWarning spans — it drifts between server and client. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "unknown";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  return `${formatDistanceToNowStrict(ms)} ago`;
}

export function absoluteTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (!ms) return "—";
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "claude-opus-5" -> "opus-5"; drops the vendor prefix and date suffix. */
export function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/^us\.anthropic\./, "");
}

/** "mcp__local-india__in-grafana__query_loki_logs" -> "in-grafana · query_loki_logs" */
export function shortToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.split("__").slice(1);
  if (parts.length < 2) return parts.join(" · ");
  return `${parts[parts.length - 2]} · ${parts[parts.length - 1]}`;
}

/** Collapses a long absolute path to something that fits a badge. */
export function shortPath(p: string | null): string {
  if (!p) return "";
  const home = "/Users/";
  if (!p.startsWith(home)) return p;
  const rest = p.slice(home.length).split("/").slice(1);
  return `~/${rest.join("/")}`;
}
