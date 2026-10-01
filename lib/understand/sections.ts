/**
 * Splits a markdown document into its top-level sections.
 *
 * Curriculum modules navigate by their `- [ ]` topics. Prose documents — a
 * runbook, or an imported write-up — have no checkboxes, so their `##` headings
 * become the navigation instead. Both end up as a list you pick from on the
 * left with the content shown in full on the right.
 */
export type DocSection = {
  /** Stable index, used as the selection key. */
  index: number;
  title: string;
  /** The section body including its own heading, ready to render. */
  body: string;
  wordCount: number;
};

const H2 = /^##\s+(.+)$/;

export function splitMarkdownSections(markdown: string): DocSection[] {
  const lines = markdown.split("\n");
  const sections: DocSection[] = [];
  let title: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (title === null) return;
    const body = buffer.join("\n").trim();
    sections.push({
      index: sections.length,
      title,
      body: `## ${title}\n\n${body}`,
      wordCount: body.split(/\s+/).filter(Boolean).length,
    });
    buffer = [];
  };

  for (const line of lines) {
    // A "## " inside a fenced code block is code, not a heading.
    if (/^```/.test(line.trim())) inFence = !inFence;
    const heading = inFence ? null : line.match(H2);
    if (heading) {
      flush();
      title = heading[1].trim();
    } else if (title !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Everything before the first `##` — the title and any intro prose. */
export function markdownPreamble(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) inFence = !inFence;
    if (!inFence && H2.test(lines[i]))
      return lines.slice(0, i).join("\n").trim();
  }
  return markdown.trim();
}
