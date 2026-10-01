"use client";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { openPalette } from "@/components/command-palette";

/** The clickable half of ⌘K, for when you'd rather not remember the shortcut. */
export function PaletteHint() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={openPalette}
      className="text-muted-foreground"
      title="Jump to a session (⌘K)"
    >
      <Search />
      <span className="hidden sm:inline">Jump to…</span>
      <kbd className="ml-1 hidden rounded border bg-muted px-1 font-mono text-xs sm:inline">
        ⌘K
      </kbd>
    </Button>
  );
}
