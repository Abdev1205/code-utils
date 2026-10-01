"use client";

import { CornerDownLeft, Loader2 } from "lucide-react";
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
import type { SessionSummary } from "@/lib/claude-sessions/types";
import { relativeTime } from "@/lib/format";
import { UTILS } from "@/lib/utils-registry";

const OPEN_EVENT = "utils:open-palette";

/** Lets any component (e.g. the header button) open the palette. */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [sessions, setSessions] = React.useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Sessions load on first open, not on mount — the palette shouldn't cost
  // anything until you reach for it. Idempotent, so callers needn't check.
  const loadStarted = React.useRef(false);
  const ensureSessions = React.useCallback(async () => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/claude-sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
      loadStarted.current = false; // let the next open retry
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void ensureSessions();
        setOpen((prev) => !prev);
      }
    }
    function onOpen() {
      void ensureSessions();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [ensureSessions]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (next) void ensureSessions();
        setOpen(next);
      }}
      title="Jump to"
      description="Search tools and Claude sessions"
      className="max-w-2xl"
    >
      {/* CommandDialog renders only the Dialog — cmdk's parts read their store
          from this root, so it has to be supplied here. */}
      <Command>
        <CommandInput placeholder="Search sessions by title or prompt…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Loading sessions…
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
          </CommandGroup>

          {sessions && sessions.length > 0 && (
            <CommandGroup heading={`Sessions (${sessions.length})`}>
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  // Prompt text is included so the palette matches on what you
                  // actually said, not only the generated title.
                  value={`${session.title} ${session.projectLabel} ${session.id} ${session.searchText.slice(0, 400)}`}
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
