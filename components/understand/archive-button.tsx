"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Archiving is an acknowledgement, not a delete: it records that you've read
 * and understood the document. Archived docs stay browsable under the Archived
 * filter and can be restored at any time.
 */
export function ArchiveButton({
  id,
  archived,
  size = "sm",
  onDone,
}: {
  id: string;
  archived: boolean;
  size?: React.ComponentProps<typeof Button>["size"];
  onDone?: (archived: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch("/api/understand/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, archived: !archived }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      toast.success(archived ? "Moved back to active" : "Marked understood", {
        description: archived ? id : `${id} — archived, still searchable`,
      });
      onDone?.(!archived);
      router.refresh();
    } catch (cause) {
      toast.error("Couldn't update", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={archived ? "outline" : "secondary"}
      size={size}
      disabled={busy}
      onClick={toggle}
      title={
        archived
          ? "Move back to active"
          : "I've read and understood this — move it to Archived"
      }
    >
      {archived ? <ArchiveRestore /> : <Archive />}
      {archived ? "Restore" : "Understood"}
    </Button>
  );
}
