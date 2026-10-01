"use client";

import { Check, ChevronRight, Loader2, NotebookPen, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Step 3 of the loop — "explain it back in your own words" — right where you
 * just read the lesson, instead of in a different tab or a text editor. Saves
 * into this topic's section of notes/<module>.md.
 */
export function TopicNote({
  docId,
  moduleName,
  topicTitle,
  note,
  onSaved,
  open,
  onOpenChange,
  inline = false,
}: {
  docId: string;
  moduleName: string;
  topicTitle: string;
  note: string | null;
  onSaved: (note: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Render the editor directly, with no collapsible wrapper. */
  inline?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState(note ?? "");
  const [savedBody, setSavedBody] = React.useState(note ?? "");
  const [saving, setSaving] = React.useState(false);

  // Adopt refreshed props during render rather than in an effect.
  const [seen, setSeen] = React.useState(note);
  if (seen !== note) {
    setSeen(note);
    setBody(note ?? "");
    setSavedBody(note ?? "");
  }

  const dirty = body.trim() !== savedBody.trim();
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/understand/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: docId, topicTitle, body }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setSavedBody(body);
      onSaved(body.trim() || null);
      toast.success("Note saved", {
        description: `notes/${moduleName}.md → ${topicTitle}`,
      });
      router.refresh();
    } catch (cause) {
      toast.error("Couldn't save the note", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd+Enter saves, so you never have to reach for the mouse.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && dirty) {
      event.preventDefault();
      void save();
    }
  }

  const hasNote = Boolean(savedBody.trim());

  const editor = (
    <div className="rounded-lg border bg-background">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Three to five sentences, as if telling a colleague who has never heard of it. If you can't write it without looking, you don't understand it yet."
        className="min-h-28 rounded-none border-0 text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center gap-2 border-t px-2.5 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">
          notes/{moduleName}.md
        </span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">⌘↵ to save</span>
        <Button
          variant={dirty ? "default" : "outline"}
          size="xs"
          className="ml-auto"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {dirty ? "Save" : "Saved"}
        </Button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
          {hasNote ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <NotebookPen className="size-3.5 text-muted-foreground" />
          )}
          Explain it back in your own words
          {hasNote && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {words} words
            </span>
          )}
        </div>
        {editor}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mt-1.5">
      <CollapsibleTrigger
        className={cn(
          "group/note flex w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors",
          hasNote
            ? "border-emerald-500/30 bg-emerald-500/[0.05] hover:bg-emerald-500/10"
            : "border-dashed text-muted-foreground hover:text-foreground",
        )}
      >
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/note:rotate-90" />
        {hasNote ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <NotebookPen className="size-3.5 shrink-0" />
        )}
        {hasNote ? "Your explanation" : "Explain it back in your own words"}
        {hasNote && (
          <span className="ml-auto text-xs text-muted-foreground">
            {words} words
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1.5 rounded-lg border bg-background">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Three to five sentences, as if telling a colleague who has never heard of it. If you can't write it without looking, you don't understand it yet."
            className="min-h-28 rounded-none border-0 text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-2 border-t px-2.5 py-1.5">
            <span className="font-mono text-xs text-muted-foreground">
              notes/{moduleName}.md
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">⌘↵ to save</span>
            <Button
              variant={dirty ? "default" : "outline"}
              size="xs"
              className="ml-auto"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {dirty ? "Save" : "Saved"}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
