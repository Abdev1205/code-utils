import { SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function SessionNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center">
      <SearchX className="size-8 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">Session not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No transcript with that ID exists under <code>~/.claude/projects</code>.
        It may have been deleted, or the ID may be truncated — session IDs are
        full UUIDs.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-5"
        nativeButton={false}
        render={<Link href="/claude-sessions" />}
      >
        Back to all sessions
      </Button>
    </div>
  );
}
