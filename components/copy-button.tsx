"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  /** Shown in the toast, e.g. "Resume command copied". */
  label: string;
  children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  title?: string;
};

export function CopyButton({
  value,
  label,
  children,
  variant = "outline",
  size = "sm",
  className,
  title,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy(event: React.MouseEvent) {
    // Cards are links; a copy click must not navigate.
    event.preventDefault();
    event.stopPropagation();
    if (await copyText(value, label)) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={cn(className)}
      title={title ?? label}
      onClick={copy}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
      {children}
    </Button>
  );
}
