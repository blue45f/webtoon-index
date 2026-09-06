import { Sparkles } from "lucide-react";

export function HeroBannerBadge() {
  return (
    <div className="absolute -top-3 left-4 z-20">
      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[0.72rem] font-bold uppercase tracking-wide text-on-accent shadow-[0_6px_20px_-4px_oklch(0.7_0.19_45/0.55)] ring-2 ring-canvas">
        <Sparkles size={13} className="shrink-0" /> 이 주의 발견
      </span>
    </div>
  );
}
