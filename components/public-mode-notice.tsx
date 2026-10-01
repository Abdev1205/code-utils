"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { switchMode } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";

/** What a hidden page shows in public mode, with the way back. */
export function PublicModeNotice({ what }: { what: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-md rounded-xl border border-dashed p-8 text-center">
        <Lock className="mx-auto mb-3 size-6 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Hidden in public mode</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {what} {what.endsWith("s") ? "are" : "is"} personal to this machine
          and not part of what a clone of the repo would show. Switch back to
          private mode when no one else can see the screen.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-5"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await switchMode("private");
              router.refresh();
            })
          }
        >
          <Lock /> Switch to private
        </Button>
      </div>
    </div>
  );
}
