import { BookOpen, MessagesSquare, type LucideIcon } from "lucide-react";

/**
 * Every tool in this app. The sidebar, the home redirect and the ⌘K palette all
 * read from here — adding a util means one entry below plus `app/<slug>/page.tsx`.
 */
export type UtilEntry = {
  slug: string;
  name: string;
  /** Shown under the name in the palette and on the sidebar tooltip. */
  description: string;
  icon: LucideIcon;
};

export const UTILS: UtilEntry[] = [
  {
    slug: "claude-sessions",
    name: "Claude Sessions",
    description: "Browse, resume and fork past Claude Code sessions",
    icon: MessagesSquare,
  },
  {
    slug: "understand",
    name: "Understand",
    description: "Curriculum, runbooks and documents — read, track and archive",
    icon: BookOpen,
  },
];

/** Where `/` sends you. */
export const DEFAULT_UTIL = UTILS[0].slug;

export function utilForPath(pathname: string): UtilEntry | undefined {
  return UTILS.find(
    (u) => pathname === `/${u.slug}` || pathname.startsWith(`/${u.slug}/`),
  );
}

/**
 * A tool's second level in the sidebar — Understand's collections, say. Built
 * server-side in the layout so counts come from the same index the page uses.
 */
export type SubnavItem = {
  id: string;
  label: string;
  href: string;
  /** Icon name understood by <CollectionIcon>; omit for a plain entry. */
  icon?: string;
  count?: number;
  /** Doc-id prefix this entry owns, so a document page can light up its collection. */
  prefix?: string;
};
