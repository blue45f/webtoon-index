import { cn } from "@/shared/lib/utils";

export function adminButtonClass(variant: "accent" | "ghost" | "danger" = "ghost") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
    variant === "accent" && "bg-accent text-on-accent hover:bg-accent-2",
    variant === "ghost" && "border border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg",
    variant === "danger" && "border border-bad/40 text-bad hover:bg-bad/10"
  );
}
