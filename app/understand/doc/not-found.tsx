import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function DocNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center">
      <FileQuestion className="size-8 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">Document not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That path isn&apos;t inside one of the configured collections, or the
        file has moved. Collections are defined in{" "}
        <code className="font-mono">lib/understand/roots.ts</code>.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-5"
        nativeButton={false}
        render={<Link href="/understand" />}
      >
        Back to all documents
      </Button>
    </div>
  );
}
