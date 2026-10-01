"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { MarkdownBody } from "@/components/claude-sessions/markdown-body";
import { CopyButton } from "@/components/copy-button";
import { TopicNote } from "@/components/understand/topic-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { splitMarkdownSections } from "@/lib/understand/sections";
import type { DocDetail, Topic } from "@/lib/understand/types";
import { cn } from "@/lib/utils";

type Selection = { kind: "overview" } | { kind: "topic"; index: number };

/**
 * Two panes: pick on the left, read in full on the right. Nothing is collapsed
 * — the lesson is the page, not a drawer you have to open and close.
 */
export function DocWorkspace({
  detail,
  moduleName,
  initialTopic,
}: {
  detail: DocDetail;
  moduleName: string;
  initialTopic: number | null;
}) {
  const router = useRouter();
  const [topics, setTopics] = React.useState(detail.topics);
  const [pending, setPending] = React.useState<number | null>(null);
  const [selection, setSelection] = React.useState<Selection>(
    initialTopic !== null && detail.topics.some((t) => t.index === initialTopic)
      ? { kind: "topic", index: initialTopic }
      : detail.topics.length
        ? { kind: "topic", index: detail.topics[0].index }
        : { kind: "overview" },
  );

  const [seen, setSeen] = React.useState(detail.topics);
  if (seen !== detail.topics) {
    setSeen(detail.topics);
    setTopics(detail.topics);
  }

  // Prose documents have no checkboxes; their headings become the rail.
  const sections = React.useMemo(
    () => (detail.topics.length ? [] : splitMarkdownSections(detail.markdown)),
    [detail.topics.length, detail.markdown],
  );

  const items: {
    key: string;
    label: string;
    selection: Selection;
    topic?: Topic;
  }[] = [
    { key: "overview", label: "Overview", selection: { kind: "overview" } },
    ...topics.map((topic) => ({
      key: `t${topic.index}`,
      label: topic.title,
      selection: { kind: "topic" as const, index: topic.index },
      topic,
    })),
    ...sections.map((section) => ({
      key: `s${section.index}`,
      label: section.title,
      selection: { kind: "topic" as const, index: section.index },
    })),
  ];

  const currentIndex = items.findIndex(
    (i) =>
      i.selection.kind === selection.kind &&
      (selection.kind === "overview" ||
        (i.selection.kind === "topic" &&
          i.selection.index === selection.index)),
  );

  /** Keeps the URL shareable without a server round-trip. */
  function select(next: Selection) {
    setSelection(next);
    const url = new URL(window.location.href);
    if (next.kind === "topic")
      url.searchParams.set("topic", String(next.index));
    else url.searchParams.delete("topic");
    window.history.replaceState(null, "", url);
    document
      .getElementById("understand-pane")
      ?.scrollIntoView({ block: "start" });
  }

  function step(delta: number) {
    const next = items[currentIndex + delta];
    if (next) select(next.selection);
  }

  async function setDone(topic: Topic, done: boolean, advance: boolean) {
    setPending(topic.index);
    setTopics((prev) =>
      prev.map((t) => (t.index === topic.index ? { ...t, done } : t)),
    );
    try {
      const res = await fetch("/api/understand/topic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: detail.summary.id,
          index: topic.index,
          done,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      if (advance && done) step(1);
      router.refresh();
    } catch (cause) {
      setTopics((prev) =>
        prev.map((t) => (t.index === topic.index ? { ...t, done: !done } : t)),
      );
      toast.error("Couldn't save the tick", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setPending(null);
    }
  }

  const activeTopic =
    selection.kind === "topic"
      ? topics.find((t) => t.index === selection.index)
      : undefined;
  const activeSection =
    selection.kind === "topic" && !activeTopic
      ? sections.find((s) => s.index === selection.index)
      : undefined;

  const done = topics.filter((t) => t.done).length;

  return (
    <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Left rail */}
      <nav className="w-full shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-64 lg:overflow-y-auto xl:w-72">
        {topics.length > 0 && (
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {done}/{topics.length} understood
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${topics.length ? (done / topics.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <ul className="space-y-0.5">
          {items.map((item, i) => {
            const active = i === currentIndex;
            const topic = item.topic;
            return (
              <li key={item.key}>
                <button
                  onClick={() => select(item.selection)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                    active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.key === "overview" ? (
                    <FileText className="mt-0.5 size-3.5 shrink-0" />
                  ) : topic ? (
                    <span
                      className={cn(
                        "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                        topic.done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-input",
                      )}
                    >
                      {topic.done && <Check className="size-2.5" />}
                    </span>
                  ) : (
                    <span className="mt-0.5 w-3.5 shrink-0 text-center font-mono text-[10px] opacity-50">
                      {item.selection.kind === "topic"
                        ? item.selection.index + 1
                        : ""}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 leading-snug">
                    {item.label}
                  </span>
                  {topic?.note && (
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500"
                      title="You've written your explanation"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Content pane */}
      <div
        id="understand-pane"
        className="mx-auto w-full min-w-0 max-w-[800px] flex-1 scroll-mt-20"
      >
        {selection.kind === "overview" && (
          <div className="rounded-xl border bg-card px-6 py-5">
            <MarkdownBody className="text-base leading-7">
              {detail.markdown}
            </MarkdownBody>
          </div>
        )}

        {activeTopic && (
          <TopicPane
            docId={detail.summary.id}
            moduleName={moduleName}
            topic={activeTopic}
            pending={pending === activeTopic.index}
            onDone={(done, advance) => setDone(activeTopic, done, advance)}
            onLesson={(lesson) =>
              setTopics((prev) =>
                prev.map((t) =>
                  t.index === activeTopic.index ? { ...t, lesson } : t,
                ),
              )
            }
            onNote={(note) =>
              setTopics((prev) =>
                prev.map((t) =>
                  t.index === activeTopic.index ? { ...t, note } : t,
                ),
              )
            }
          />
        )}

        {activeSection && (
          <div className="rounded-xl border bg-card px-6 py-5">
            <MarkdownBody className="text-base leading-7">
              {activeSection.body}
            </MarkdownBody>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentIndex <= 0}
            onClick={() => step(-1)}
          >
            <ArrowLeft />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentIndex + 1} of {items.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={currentIndex >= items.length - 1}
            onClick={() => step(1)}
          >
            Next
            <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TopicPane({
  docId,
  moduleName,
  topic,
  pending,
  onDone,
  onLesson,
  onNote,
}: {
  docId: string;
  moduleName: string;
  topic: Topic;
  pending: boolean;
  onDone: (done: boolean, advance: boolean) => void;
  onLesson: (lesson: string) => void;
  onNote: (note: string | null) => void;
}) {
  const [generating, setGenerating] = React.useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/understand/lesson", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: docId, index: topic.index }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onLesson(data.lesson);
      toast.success("Lesson written", { description: data.lessonId });
    } catch (cause) {
      toast.error("Couldn't write the lesson", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <article className="rounded-xl border bg-card">
      <header className="border-b px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {topic.title}
          </h2>
          {topic.audit.map((item) => (
            <Badge key={item} variant="outline" className="font-mono text-xs">
              {item}
            </Badge>
          ))}
        </div>
        {topic.description && (
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
            {topic.description}
          </p>
        )}
      </header>

      <div className="px-6 py-5">
        {topic.lesson ? (
          <MarkdownBody className="text-base leading-7">
            {topic.lesson}
          </MarkdownBody>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed px-4 py-6">
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4 text-muted-foreground" />
              No lesson written for this topic yet.
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={generate}
              disabled={generating}
            >
              {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {generating ? "Writing…" : "Teach me this"}
            </Button>
          </div>
        )}
      </div>

      {(topic.ask || topic.see) && (
        <div className="space-y-1.5 border-t px-6 py-3">
          {topic.ask && (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground italic">
                {topic.ask}
              </p>
              <CopyButton
                value={topic.ask}
                label="Prompt copied"
                size="icon-xs"
                variant="ghost"
              />
            </div>
          )}
          {topic.see && (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <Terminal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre">
                {topic.see}
              </code>
              <CopyButton
                value={topic.see}
                label="Command copied"
                size="icon-xs"
                variant="ghost"
              />
            </div>
          )}
        </div>
      )}

      <div className="border-t px-6 py-5">
        <TopicNote
          inline
          docId={docId}
          moduleName={moduleName}
          topicTitle={topic.title}
          note={topic.note}
          onSaved={onNote}
          open
          onOpenChange={() => {}}
        />
      </div>

      <footer className="flex items-center gap-2 border-t px-6 py-4">
        <Button
          variant={topic.done ? "outline" : "default"}
          size="sm"
          disabled={pending}
          onClick={() => onDone(!topic.done, true)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          {topic.done ? "Understood — undo" : "I can explain this"}
        </Button>
        {!topic.done && (
          <span className="text-xs text-muted-foreground">
            Marks it done and moves you on
          </span>
        )}
      </footer>
    </article>
  );
}
