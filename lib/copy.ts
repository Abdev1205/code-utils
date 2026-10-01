import { toast } from "sonner";

/** Copy with a toast that shows exactly what landed on the clipboard. */
export async function copyText(value: string, label: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label, {
      description: value,
      classNames: { description: "font-mono text-[11px] break-all" },
    });
    return true;
  } catch {
    toast.error("Couldn't reach the clipboard", { description: value });
    return false;
  }
}
