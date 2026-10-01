"use client";

import { ExternalLink, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtifactLink } from "@/lib/understand/types";

type Discovered = { url: string; foundIn: string; context: string };

/**
 * claude.ai artifacts can't be stored as files, so they're registered by link.
 * Discover scans the indexed documents for artifact URLs mentioned in prose.
 */
export function ArtifactRegistry({ artifacts }: { artifacts: ArtifactLink[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(artifacts);
  const [discovered, setDiscovered] = React.useState<Discovered[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");

  // Adopt refreshed props during render; see topic-list for the same pattern.
  const [seen, setSeen] = React.useState(artifacts);
  if (seen !== artifacts) {
    setSeen(artifacts);
    setItems(artifacts);
  }

  async function call(init: RequestInit & { query?: string }) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/understand/artifacts${init.query ?? ""}`,
        init,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.artifacts) setItems(data.artifacts);
      return data;
    } catch (cause) {
      toast.error("Registry error", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add(nextUrl: string, nextTitle: string) {
    const data = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: nextUrl, title: nextTitle }),
    });
    if (data) {
      toast.success("Artifact registered", {
        description: nextTitle || nextUrl,
      });
      setUrl("");
      setTitle("");
      setDiscovered((prev) => prev?.filter((d) => d.url !== nextUrl) ?? null);
      router.refresh();
    }
  }

  async function discover() {
    const data = await call({ query: "?discover=1", method: "GET" });
    if (data) {
      setDiscovered(data.discovered ?? []);
      const n = data.discovered?.length ?? 0;
      toast.success(
        n
          ? `Found ${n} unregistered link${n === 1 ? "" : "s"}`
          : "No new links found",
      );
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Link2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Claude artifacts</span>
        <span className="text-xs text-muted-foreground">
          {items.length} registered — pages that live on claude.ai, not on disk
        </span>
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          onClick={discover}
          disabled={busy}
          title="Scan indexed documents for claude.ai links that aren't registered"
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
          Discover
        </Button>
      </div>

      <div className="divide-y">
        {items.map((artifact) => (
          <div
            key={artifact.id}
            className="group flex items-center gap-3 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                {artifact.title}
                <ExternalLink className="size-3 text-muted-foreground" />
              </a>
              <div className="truncate font-mono text-xs text-muted-foreground">
                {artifact.url}
              </div>
              {artifact.description && (
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {artifact.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Remove from registry"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={async () => {
                await call({
                  method: "DELETE",
                  query: `?id=${encodeURIComponent(artifact.id)}`,
                });
                router.refresh();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}

        {discovered?.map((item) => (
          <div
            key={item.url}
            className="flex items-start gap-3 bg-muted/30 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">{item.url}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                found in <span className="font-mono">{item.foundIn}</span>
                {item.context && <> — “…{item.context}”</>}
              </p>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                add(item.url, item.context.slice(-60) || item.foundIn)
              }
              disabled={busy}
            >
              <Plus />
              Register
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="h-8 w-44"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://claude.ai/artifact/…"
            className="h-8 min-w-64 flex-1 font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !url.startsWith("https://claude.ai/")}
            onClick={() => add(url, title)}
          >
            <Plus />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
