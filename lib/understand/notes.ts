/**
 * Your own explanation of each topic, in your own words — step 3 of the
 * curriculum's five-step loop.
 *
 * The curriculum says to write these in `notes/<module>.md`, so that's where
 * they go. Within that file each topic gets its own `## <topic title>` section,
 * which lets the app show and edit one topic's note in place while the file
 * stays a normal, readable document in your editor.
 */

const HEADING = /^##\s+(.*)$/;

/** topic title -> the note written under it. */
export function parseNoteSections(raw: string | null): Map<string, string> {
  const sections = new Map<string, string>();
  if (!raw) return sections;

  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, buffer.join("\n").trim());
    buffer = [];
  };

  for (const line of raw.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      current = heading[1].trim();
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Everything above the first `## ` heading — the file's title and any preamble. */
function preamble(raw: string | null, moduleTitle: string): string {
  if (!raw) return `# ${moduleTitle} — my notes\n`;
  const lines = raw.split("\n");
  const firstHeading = lines.findIndex((l) => HEADING.test(l));
  const head = (firstHeading === -1 ? lines : lines.slice(0, firstHeading))
    .join("\n")
    .trim();
  return head ? head + "\n" : `# ${moduleTitle} — my notes\n`;
}

/**
 * Writes one topic's note into the module file, leaving every other section
 * untouched and preserving the order topics appear in the module.
 */
export function upsertNoteSection(
  raw: string | null,
  options: {
    moduleTitle: string;
    topicTitle: string;
    body: string;
    topicOrder: string[];
  },
): string {
  const { moduleTitle, topicTitle, body, topicOrder } = options;
  const sections = parseNoteSections(raw);

  const trimmed = body.trim();
  if (trimmed) sections.set(topicTitle, trimmed);
  else sections.delete(topicTitle);

  // Known topics first, in module order; anything else keeps its relative order.
  const known = topicOrder.filter((t) => sections.has(t));
  const extra = [...sections.keys()].filter((t) => !topicOrder.includes(t));

  const out = [preamble(raw, moduleTitle)];
  for (const title of [...known, ...extra]) {
    out.push(`\n## ${title}\n\n${sections.get(title)}\n`);
  }
  return out.join("");
}
