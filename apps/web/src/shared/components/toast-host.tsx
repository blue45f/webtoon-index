import { Check, Info, X } from "lucide-react";

import { useToastStore, type ToastTone } from "@/shared/lib/toast-store";
import { useUi } from "@/shared/lib/ui-store";
import { cn } from "@/shared/lib/utils";

const toneIcon: Record<ToastTone, typeof Check> = {
  success: Check,
  info: Info,
  default: Info,
};

const toneClass: Record<ToastTone, string> = {
  success: "text-good",
  info: "text-cool",
  default: "text-accent",
};

// 토스트 호스트 — 전역 1개 마운트. 우하단 위로 쌓이며, 좌하단 스위처·우하단 BackToTop 와
// 충돌하지 않도록 가운데 하단 정렬(모바일 바텀 내비 위)로 띄운다. aria-live=polite 로 안내한다.
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const studioImmersive = useUi((state) => state.immersiveSurface === "studio");

  if (toasts.length === 0) return null;

  return (
    <div
      data-studio-immersive-offset={studioImmersive ? "true" : "false"}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[95] flex flex-col items-center gap-2 px-4 max-md:bottom-20"
      style={
        studioImmersive
          ? { bottom: "calc(7.5rem + env(safe-area-inset-bottom))" }
          : undefined
      }
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-[20rem] animate-fade-up items-center gap-2.5 rounded-xl border border-line-strong bg-panel/95 py-2.5 pl-3 pr-2 text-sm text-fg shadow-[0_14px_40px_-16px_oklch(0.1_0.02_70/0.6)] backdrop-blur-md"
          >
            <Icon size={16} className={cn("shrink-0", toneClass[t.tone])} />
            <span className="min-w-0 flex-1 truncate">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="알림 닫기"
              className="grid size-6 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
