"use client";

import { Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Mode } from "@/lib/mode";

/** Persists the mode and re-renders every server component with it. */
export async function switchMode(mode: Mode): Promise<void> {
  const res = await fetch("/api/mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`mode switch failed: ${res.status}`);
}

/**
 * Private / Public, in the top bar. Public is deliberately louder than
 * private: when someone else can see the screen, you want to be able to
 * confirm the state at a glance, not go looking for it.
 */
export function ModeToggle({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function choose(next: Mode) {
    if (next === mode || pending) return;
    startTransition(async () => {
      try {
        await switchMode(next);
        router.refresh();
        toast(
          next === "public"
            ? "Public mode: private tracks, other repos and your sessions are hidden."
            : "Private mode: everything is visible again.",
        );
      } catch {
        toast.error("Couldn't switch mode.");
      }
    });
  }

  const isPublic = mode === "public";
  return (
    <div
      role="radiogroup"
      aria-label="Visibility mode"
      title="Public mode shows only what a clone of this repo would show"
      className={cn(
        "inline-flex h-8 items-center rounded-lg border p-0.5 text-xs",
        isPublic && "border-amber-500/60 bg-amber-500/10",
        pending && "opacity-60",
      )}
    >
      <ModeOption
        active={!isPublic}
        onClick={() => choose("private")}
        icon={<Lock />}
        label="Private"
      />
      <ModeOption
        active={isPublic}
        onClick={() => choose("public")}
        icon={<Globe />}
        label="Public"
        emphasis={isPublic}
      />
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  icon,
  label,
  emphasis = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors [&>svg]:size-3.5",
        active
          ? emphasis
            ? "bg-amber-500 font-medium text-black"
            : "bg-secondary font-medium text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
