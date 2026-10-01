import { indexDocs } from "./index";
import { getRoots } from "./roots";
import type { SubnavItem } from "@/lib/utils-registry";

/**
 * One entry per collection, with how many documents it holds. "All" first.
 * Counts are totals (archived included) because this is navigation, not the
 * active/archived filter — the page header reports those separately.
 */
export async function understandSubnav(): Promise<SubnavItem[]> {
  const [docs, roots] = await Promise.all([indexDocs(), getRoots()]);
  const counts = new Map<string, number>();
  for (const doc of docs) {
    counts.set(doc.collection, (counts.get(doc.collection) ?? 0) + 1);
  }
  return [
    { id: "all", label: "All", href: "/understand", count: docs.length },
    ...roots.map((c) => ({
      id: c.id,
      label: c.name,
      href: `/understand?collection=${encodeURIComponent(c.id)}`,
      icon: c.icon,
      count: counts.get(c.id) ?? 0,
      prefix: `${c.dir}/`,
    })),
  ];
}
