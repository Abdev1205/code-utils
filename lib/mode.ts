import { cookies } from "next/headers";

/**
 * Private mode is the machine's owner looking at their own things. Public mode
 * is for when someone else can see the screen: it shows exactly what a fresh
 * clone of this repo would show — no `understand/private/`, no collections
 * from other repos, no Claude sessions.
 *
 * Enforced where data is read, not where it is drawn. A hidden component still
 * ships its props in the page payload, and ⌘K and the API routes return
 * whatever the index holds, so the index itself has to be smaller.
 */
export type Mode = "private" | "public";

export const MODE_COOKIE = "utils-mode";

export async function getMode(): Promise<Mode> {
  try {
    const value = (await cookies()).get(MODE_COOKIE)?.value;
    return value === "public" ? "public" : "private";
  } catch {
    // No request in scope (a build step, a script). Nothing is being shown to
    // anyone, and if it ever were, the safe reading is the narrow one.
    return "public";
  }
}

export async function isPublicMode(): Promise<boolean> {
  return (await getMode()) === "public";
}

/** For route handlers: the response to return instead, or null to proceed. */
export async function hiddenInPublicMode(): Promise<Response | null> {
  if (!(await isPublicMode())) return null;
  return Response.json(
    { hidden: true, error: "Hidden in public mode" },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
