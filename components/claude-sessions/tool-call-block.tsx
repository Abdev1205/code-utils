"use client";

import { ChevronRight, Loader2, TriangleAlert, Wrench } from "lucide-react";
import * as React from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ToolCall, ToolCallBody } from "@/lib/claude-sessions/types";
import { shortToolName } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Collapsed by default — tool output is what makes transcripts unreadable.
 * Large bodies aren't in the page payload at all; they load on first expand.
 */
export function ToolCallBlock({
  call,
  sessionId,
}: {
  call: ToolCall;
  sessionId: string;
}) {
  const [body, setBody] = React.useState<ToolCallBody | null>(call.body);
  const [error, setError] = React.useState<string | null>(null);
  const requested = React.useRef(false);

  const load = React.useCallback(async () => {
    if (requested.current || body || !call.id) return;
    requested.current = true;
    try {
      const res = await fetch(
        `/api/claude-sessions/${sessionId}/tool?call=${encodeURIComponent(call.id)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBody(await res.json());
    } catch (cause) {
      requested.current = false;
      setError(cause instanceof Error ? cause.message : "failed to load");
    }
  }, [body, call.id, sessionId]);

  return (
    <Collapsible
      onOpenChange={(open: boolean) => {
        if (open) void load();
      }}
    >
      <CollapsibleTrigger
        className={cn(
          "group/tool flex w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-left text-[13px] hover:bg-muted",
          call.isError && "border-destructive/40",
        )}
      >
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool:rotate-90" />
        {call.isError ? (
          <TriangleAlert className="size-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 font-medium">{shortToolName(call.name)}</span>
        {call.inputSummary && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {call.inputSummary}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-1.5 rounded-md border bg-muted/20 p-2">
          {!body && !error && (
            <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading tool output…
            </div>
          )}
          {error && (
            <div className="py-1 text-xs text-destructive">
              Couldn&apos;t load this tool call ({error}).
            </div>
          )}
          {body && (
            <>
              <Field label="input">
                {body.input + (body.inputTruncated ? "\n… truncated" : "")}
              </Field>
              {body.result !== null && (
                <Field
                  label={call.isError ? "error" : "result"}
                  isError={call.isError}
                >
                  {(body.result || "(empty)") +
                    (body.resultTruncated ? "\n… truncated" : "")}
                </Field>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({
  label,
  children,
  isError,
}: {
  label: string;
  children: string;
  isError?: boolean;
}) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-80 overflow-auto rounded bg-background/60 p-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap",
          isError && "text-destructive",
        )}
      >
        {children}
      </pre>
    </div>
  );
}
