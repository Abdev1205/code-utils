import type { LucideIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";

/**
 * Shown when a tool has nothing to display. For a first-time user that is the
 * normal state, not an error — so it explains how to get data in rather than
 * just reporting emptiness.
 */
export function SetupHint({
  icon: Icon,
  title,
  lead,
  steps,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  lead: string;
  steps: { text: string; command?: string }[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-dashed px-6 py-10">
      <div className="flex flex-col items-center text-center">
        <Icon className="size-7 text-muted-foreground" />
        <h2 className="mt-3 text-base font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{lead}</p>
      </div>

      <ol className="mt-6 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed">{step.text}</p>
              {step.command && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs whitespace-pre">
                    {step.command}
                  </code>
                  <CopyButton
                    value={step.command}
                    label="Command copied"
                    size="icon-xs"
                    variant="ghost"
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {footer && (
        <div className="mt-5 border-t pt-4 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
