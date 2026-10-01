"use client";

import { MoonStar, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Toggle light / dark"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Swapped by CSS so there's no mount flash and no hydration mismatch. */}
      <Sun className="hidden dark:block" />
      <MoonStar className="block dark:hidden" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
