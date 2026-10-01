"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <h1 className="mt-4 text-lg font-semibold">Something broke</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This is a local tool, so the message is shown in full rather than
        hidden.
      </p>
      <pre className="mt-4 max-h-64 w-full overflow-auto rounded-lg border bg-muted p-3 text-left font-mono text-xs whitespace-pre-wrap">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <Button variant="outline" size="sm" className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
