import { MessagesSquare, type LucideIcon } from "lucide-react";

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
];

/** Where `/` sends you. */
export const DEFAULT_UTIL = UTILS[0].slug;

export function utilForPath(pathname: string): UtilEntry | undefined {
  return UTILS.find((u) => pathname === `/${u.slug}` || pathname.startsWith(`/${u.slug}/`));
}
