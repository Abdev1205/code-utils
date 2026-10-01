import { cookies } from "next/headers";

import { MODE_COOKIE, type Mode } from "@/lib/mode";

export const dynamic = "force-dynamic";

/** Switches between private and public mode. The choice persists in a cookie. */
export async function POST(request: Request) {
  const { mode } = await request.json().catch(() => ({}));
  if (mode !== "private" && mode !== "public") {
    return Response.json(
      { error: 'Expected { mode: "private" | "public" }' },
      { status: 400 },
    );
  }
  (await cookies()).set(MODE_COOKIE, mode satisfies Mode, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ mode }, { headers: { "cache-control": "no-store" } });
}
