/**
 * Studio Magic Resize Panel — page aspect presets + reflow strategy.
 * Polished for warm-ink chrome; used in inspector (and optionally elsewhere).
 */
import {
  CreditCard,
  RectangleHorizontal,
  RectangleVertical,
  Smartphone,
  Square,
  type LucideIcon,
} from "lucide-react";

import { studioCanvasAspectPreviewRect } from "./canvas/studio-canvas-size";
import {
  MAGIC_RESIZE_PRESETS,
  MAGIC_RESIZE_STRATEGIES,
  presetCanvasSize,
  type MagicResizeCanvasSize,
  type MagicResizePreset,
  type MagicResizeStrategy,
} from "./studio-magic-resize";
import { STUDIO_EASE, STUDIO_FOCUS_RING, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const PRESET_ICONS: Record<string, LucideIcon> = {
  square: Square,
  "landscape-thumb": RectangleHorizontal,
  "portrait-story": Smartphone,
  "tall-cut": RectangleVertical,
  "landscape-card": CreditCard,
};

function isSameAspect(a: MagicResizeCanvasSize, b: MagicResizeCanvasSize): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return Math.abs(a.width / a.height - b.width / b.height) < 0.01;
}

export interface StudioMagicResizePanelProps {
  currentSize?: MagicResizeCanvasSize;
  disabled?: boolean;
  strategy: MagicResizeStrategy;
  onStrategyChange: (next: MagicResizeStrategy) => void;
  onApplyPreset: (preset: MagicResizePreset) => void;
}

export function StudioMagicResizePanel({
  currentSize,
  disabled = false,
  strategy,
  onStrategyChange,
  onApplyPreset,
}: StudioMagicResizePanelProps): ReactElement {
  return (
    <div className="space-y-2.5" data-studio-magic-resize-panel="true">
      <div>
        <p className="text-[0.7rem] font-bold text-fg">매직 리사이즈</p>
        <p className="mt-0.5 text-[0.62rem] leading-snug text-fg-3">
          규격을 고르면 요소를 새 비율에 맞춰 다시 배치해요. 실수해도 Ctrl+Z로 되돌릴 수 있어요.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MAGIC_RESIZE_STRATEGIES.map((s) => (
          <StudioToggleChip
            key={s.id}
            active={strategy === s.id}
            disabled={disabled}
            title={s.hint}
            onClick={() => onStrategyChange(s.id)}
          >
            {s.label}
          </StudioToggleChip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {MAGIC_RESIZE_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.id] ?? Square;
          const size = presetCanvasSize(preset);
          const active = currentSize ? isSameAspect(currentSize, size) : false;
          const preview = studioCanvasAspectPreviewRect(size.width, size.height, 28);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              disabled={disabled}
              title={preset.hint}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2 py-2 text-left transition-colors",
                disabled && "cursor-not-allowed disabled:opacity-50",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
              )}
            >
              <svg aria-hidden width={28} height={28} viewBox="0 0 28 28" className="shrink-0">
                <rect
                  x={0.5}
                  y={0.5}
                  width={27}
                  height={27}
                  rx={5}
                  fill="oklch(0.2 0.01 66 / 0.45)"
                  stroke="oklch(0.35 0.012 64 / 0.4)"
                />
                <rect
                  x={preview.x * (28 / 40)}
                  y={preview.y * (28 / 40)}
                  width={preview.w * (28 / 40)}
                  height={preview.h * (28 / 40)}
                  rx={2}
                  fill={active ? "oklch(0.72 0.185 42)" : "oklch(0.62 0.08 42 / 0.75)"}
                />
              </svg>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[0.7rem] font-bold">
                  <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  {preset.label}
                </span>
                <span className="block text-[0.58rem] tabular-nums text-fg-3">
                  {size.width}×{size.height}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
