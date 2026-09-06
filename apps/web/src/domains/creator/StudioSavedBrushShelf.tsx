import { Check, Pin, SlidersHorizontal } from "lucide-react";

import { selectQuickBrushes, type StudioSavedBrush } from "./brush/studio-brush-library";

import type { MouseEventHandler } from "react";

import { cx } from "@/shared/lib/cx";

export interface StudioSavedBrushShelfProps {
  brushes: readonly StudioSavedBrush[];
  activeBrushId?: string | null;
  onApply: (brush: StudioSavedBrush) => void;
  onManage?: MouseEventHandler<HTMLButtonElement>;
}

/** 모바일 브러시 시트에서 엄지 한 번으로 고정/최근 브러시를 적용하는 최대 8개 선반. */
export function StudioSavedBrushShelf({
  brushes,
  activeBrushId = null,
  onApply,
  onManage,
}: StudioSavedBrushShelfProps) {
  const quickBrushes = selectQuickBrushes(brushes);
  if (quickBrushes.length === 0 && !onManage) return null;

  return (
    <section className="mb-2.5" aria-label="고정 및 최근 브러시">
      <div className="mb-1 flex min-h-11 items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[0.7rem] font-medium text-fg-3">
          <Pin size={11} aria-hidden /> 고정·최근
          <span className="tabular-nums text-fg-2">{quickBrushes.length}/8</span>
        </p>
        {onManage ? (
          <button
            type="button"
            data-studio-brush-manager-launcher="true"
            onClick={onManage}
            className="flex min-h-11 items-center gap-1 rounded-lg px-3 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <SlidersHorizontal size={13} aria-hidden /> 저장·관리
          </button>
        ) : null}
      </div>
      {quickBrushes.length === 0 ? (
        <button
          type="button"
          data-studio-brush-manager-launcher="true"
          onClick={onManage}
          className="flex min-h-14 w-full items-center justify-center rounded-xl border border-dashed border-line px-3 text-center text-[0.68rem] leading-relaxed text-fg-3 hover:border-accent/60 hover:bg-accent-soft/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          브러시를 저장하거나 고정하면 이 선반에서 바로 꺼내 쓸 수 있어요.
        </button>
      ) : (
      <div className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-1 pr-8 [mask-image:linear-gradient(to_right,#000_0%,#000_calc(100%-1.5rem),transparent_100%)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickBrushes.map((brush) => {
          const active = activeBrushId === brush.id;
          return (
            <button
              key={brush.id}
              type="button"
              onClick={() => onApply(brush)}
              aria-pressed={active}
              aria-label={`${brush.name} 브러시 적용, ${brush.strokeWidth}px, ${Math.round(brush.brushOpacity * 100)}퍼센트`}
              className={cx(
                "relative flex min-h-14 w-[5.4rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                active
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised"
              )}
            >
              {brush.pinned ? (
                <Pin size={10} className="absolute right-1.5 top-1.5 fill-current text-accent" aria-hidden />
              ) : null}
              {active ? (
                <span className="absolute left-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-accent text-on-accent" aria-hidden>
                  <Check size={10} strokeWidth={3} />
                </span>
              ) : null}
              <span className="grid h-4 w-10 place-items-center overflow-hidden rounded-md border border-line bg-[linear-gradient(90deg,#f8fafc_0_50%,#242936_50%_100%)]" aria-hidden>
                <span
                  className="block w-9 rounded-full"
                  style={{
                    height: Math.min(12, Math.max(2, brush.strokeWidth / 3)),
                    backgroundColor: brush.color,
                    opacity: brush.brushOpacity,
                  }}
                />
              </span>
              <span className="w-full truncate text-[0.66rem] font-semibold">{brush.name}</span>
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}
