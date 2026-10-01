"use client";

import { ChevronRight, Download, Terminal } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { sessionCommands } from "@/lib/claude-sessions/commands";
import type { SessionSummary } from "@/lib/claude-sessions/types";

/** Every command for this session, each with a copy button and a note on what it does. */
export function SessionCommandsCard({ session }: { session: SessionSummary }) {
  const commands = sessionCommands(session);

  return (
    <Collapsible defaultOpen className="rounded-xl border bg-card">
      <CollapsibleTrigger className="group/cmd flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/cmd:rotate-90" />
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Commands for this session</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {commands.length} options
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y border-t">
          {commands.map((command) => (
            <div
              key={command.key}
              className="flex items-start gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{command.label}</span>
                  {command.needsEdit && (
                    <span className="rounded bg-muted px-1 text-xs text-muted-foreground">
                      edit before running
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {command.description}
                </p>
                <code className="mt-1.5 block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[13px] whitespace-pre">
                  {command.command}
                </code>
              </div>
              <CopyButton
                value={command.command}
                label={`${command.label} copied`}
                size="icon-sm"
                variant="ghost"
                className="mt-0.5 shrink-0"
              />
            </div>
          ))}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">Export transcript</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Downloads the whole conversation as markdown — prompts, replies
                and tool calls.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              title="Download markdown"
              // Rendering an <a>, so Base UI must not assume native button semantics.
              nativeButton={false}
              render={
                <a
                  href={`/api/claude-sessions/${session.id}/export`}
                  download
                />
              }
            >
              <Download />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
