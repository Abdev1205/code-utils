import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders assistant/user message text. Transcripts contain arbitrary markdown
 * including wide tables, so anything that can overflow scrolls in place rather
 * than stretching the page.
 */
export function MarkdownBody({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Full prose size, not prose-sm — this is the surface you actually read.
        "prose max-w-none text-[15px] leading-relaxed break-words dark:prose-invert",
        "prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-muted prose-pre:text-foreground",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-headings:font-semibold prose-headings:tracking-tight prose-p:leading-relaxed",
        "prose-a:break-all prose-table:block prose-table:overflow-x-auto",
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
