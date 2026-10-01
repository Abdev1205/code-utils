"use client";

import { BookOpen, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CollectionIcon } from "@/components/understand/collection-icon";
import type { SessionSummary } from "@/lib/claude-sessions/types";
import type { CollectionMeta, DocSummary } from "@/lib/understand/types";
import { relativeTime } from "@/lib/format";
import { UTILS } from "@/lib/utils-registry";

const OPEN_EVENT = "utils:open-palette";
/** Enough to match on, without shipping whole documents into the palette. */
const MATCH_TEXT = 400;

/** Lets any component (e.g. the header button) open the palette. */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Data = {
  sessions: SessionSummary[];
  docs: DocSummary[];
  collections: CollectionMeta[];
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(false);

  // One search box over every tool. Both indexes load on first open and are
  // cheap enough to keep for the session.
  const loadStarted = React.useRef(false);
  const ensureData = React.useCallback(async () => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    try {
      const [sessionsRes, understandRes] = await Promise.all([
        fetch("/api/claude-sessions"),
        fetch("/api/understand"),
      ]);
      const [sessions, understand] = await Promise.all([
        sessionsRes.json(),
        understandRes.json(),
      ]);
      setData({
        sessions: sessions.sessions ?? [],
        docs: understand.docs ?? [],
        collections: understand.collections ?? [],
      });
    } catch {
      setData({ sessions: [], docs: [], collections: [] });
      loadStarted.current = false; // let the next open retry
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void ensureData();
        setOpen((prev) => !prev);
      }
    }
    function onOpen() {
      void ensureData();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [ensureData]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const docs = data?.docs ?? [];
  const sessions = data?.sessions ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (next) void ensureData();
        setOpen(next);
      }}
      title="Jump to"
      description="Search tools, documents and Claude sessions"
      className="max-w-2xl"
    >
      {/* CommandDialog renders only the Dialog — cmdk's parts read their store
          from this root, so it has to be supplied here. */}
      <Command>
        <CommandInput placeholder="Search everything — documents, sessions, tools…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </span>
            ) : (
              "No matches."
            )}
          </CommandEmpty>

          <CommandGroup heading="Tools">
            {UTILS.map((util) => (
              <CommandItem
                key={util.slug}
                value={`tool ${util.name} ${util.description}`}
                onSelect={() => go(`/${util.slug}`)}
              >
                <util.icon />
                <span>{util.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {util.description}
                </span>
              </CommandItem>
            ))}
            <CommandItem
              value="progress study dashboard"
              onSelect={() => go("/understand/progress")}
            >
              <BookOpen />
              <span>Progress</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                Study dashboard and prerequisite graph
              </span>
            </CommandItem>
          </CommandGroup>

          {docs.length > 0 && (
            <CommandGroup heading={`Documents (${docs.length})`}>
              {docs.map((doc) => {
                const meta = data?.collections.find(
                  (c) => c.id === doc.collection,
                );
                return (
                  <CommandItem
                    key={doc.id}
                    value={`${doc.title} ${doc.id} ${doc.audit.join(" ")} ${doc.searchText.slice(0, MATCH_TEXT)}`}
                    onSelect={() =>
                      go(`/understand/doc?id=${encodeURIComponent(doc.id)}`)
                    }
                    className="items-start gap-2"
                  >
                    <CollectionIcon
                      name={meta?.icon ?? ""}
                      className="mt-1 shrink-0 opacity-50"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {doc.title}
                        {doc.archived && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            archived
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {meta?.name ?? doc.collection}
                        {doc.topicCount > 0 &&
                          ` · ${doc.topicsDone}/${doc.topicCount} topics`}
                        {` · ${doc.readingMinutes} min`}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {sessions.length > 0 && (
            <CommandGroup heading={`Sessions (${sessions.length})`}>
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  // Prompt text is included so the palette matches on what you
                  // actually said, not only the generated title.
                  value={`${session.title} ${session.projectLabel} ${session.id} ${session.searchText.slice(0, MATCH_TEXT)}`}
                  onSelect={() => go(`/claude-sessions/${session.id}`)}
                  className="items-start gap-2"
                >
                  <CornerDownLeft className="mt-1 shrink-0 opacity-40" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{session.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {session.projectLabel} · {session.userMsgCount} prompts ·{" "}
                      <span suppressHydrationWarning>
                        {relativeTime(session.lastActivityAt)}
                      </span>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
