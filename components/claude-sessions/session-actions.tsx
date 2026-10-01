"use client";

import { Download, Ellipsis, GitFork, Play } from "lucide-react";
import * as React from "react";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  forkCommand,
  resumeCommand,
  sessionCommands,
} from "@/lib/claude-sessions/commands";
import type { SessionSummary } from "@/lib/claude-sessions/types";
import { copyText } from "@/lib/copy";

/**
 * Resume and Fork are one click each; everything else lives behind the menu.
 * Every entry copies a shell command — nothing here executes anything.
 */
export function SessionActions({
  session,
  compact = false,
}: {
  session: SessionSummary;
  compact?: boolean;
}) {
  const extras = sessionCommands(session).filter(
    (command) => command.key !== "resume" && command.key !== "fork",
  );

  return (
    <div className="flex items-center gap-1.5">
      <CopyButton
        value={resumeCommand(session)}
        label="Resume command copied"
        variant="default"
        size={compact ? "xs" : "sm"}
        title="Copy the command that continues this session"
      >
        <Play className="hidden sm:inline" />
        Resume
      </CopyButton>

      <CopyButton
        value={forkCommand(session)}
        label="Fork command copied"
        variant="outline"
        size={compact ? "xs" : "sm"}
        title="Copy a command that branches a new session from this one"
      >
        <GitFork className="hidden sm:inline" />
        Fork
      </CopyButton>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size={compact ? "icon-xs" : "icon-sm"}
              title="More commands"
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-80">
          {/* Base UI requires GroupLabel to sit inside a Group. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Copy a command</DropdownMenuLabel>
            {extras.map((command) => (
              <DropdownMenuItem
                key={command.key}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void copyText(command.command, `${command.label} copied`);
                }}
                className="flex-col items-start gap-0.5 py-1.5"
              >
                <span className="flex w-full items-center gap-2 text-sm">
                  {command.label}
                  {command.needsEdit && (
                    <span className="ml-auto rounded bg-muted px-1 text-xs text-muted-foreground">
                      edit me
                    </span>
                  )}
                </span>
                <span className="line-clamp-1 w-full font-mono text-xs text-muted-foreground">
                  {command.command}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <a
                href={`/api/claude-sessions/${session.id}/export`}
                download
                onClick={(event) => event.stopPropagation()}
              />
            }
          >
            <Download />
            Export transcript as markdown
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
