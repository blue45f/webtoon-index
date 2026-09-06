import { Check } from "lucide-react";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioEraserQuickPickerId =
  | "standard-eraser"
  | "kneaded-eraser";

export interface StudioEraserQuickPickerProps {
  selectedId: StudioEraserQuickPickerId;
  onSelect: (id: StudioEraserQuickPickerId) => void;
  className?: string;
  /** Accessible name for the reusable desktop popover or mobile sheet group. */
  ariaLabel?: string;
}

interface StudioEraserQuickOption {
  readonly id: StudioEraserQuickPickerId;
  readonly name: string;
  readonly description: string;
  readonly strengthPercent: 38 | 100;
  readonly residualOpacity: 0 | 0.62;
  readonly previewLabel: string;
}

const STUDIO_ERASER_QUICK_OPTIONS: readonly StudioEraserQuickOption[] = [
  {
    id: "standard-eraser",
    name: "일반 지우개",
    description: "한 번에 완전히 지워요",
    strengthPercent: 100,
    residualOpacity: 0,
    previewLabel: "지우기 전 선과 한 번 지운 뒤 빈 띠",
  },
  {
    id: "kneaded-eraser",
    name: "떡지우개",
    description: "한 번에 38%만 걷어내요",
    strengthPercent: 38,
    residualOpacity: 0.62,
    previewLabel: "지우기 전 선과 한 번 지운 뒤 원래 농도의 62%가 남은 선",
  },
] as const;

function StudioEraserBeforeAfterPreview({
  option,
}: {
  option: StudioEraserQuickOption;
}): ReactElement {
  return (
    <div
      data-studio-eraser-preview={option.id}
      className="rounded-xl bg-canvas/80 px-2.5 pb-2 pt-1.5 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.055)]"
    >
      <div
        aria-hidden
        className="mb-1 flex items-center justify-between text-[0.58rem] font-semibold text-fg-3"
      >
        <span>지우기 전</span>
        <span>한 번 지운 뒤</span>
      </div>
      <svg
        viewBox="0 0 220 48"
        role="img"
        aria-label={`${option.name} 미리보기: ${option.previewLabel}`}
        className="block h-10 w-full overflow-visible text-fg"
      >
        <rect
          x="0"
          y="4"
          width="98"
          height="40"
          rx="9"
          className="fill-card"
        />
        <rect
          x="122"
          y="4"
          width="98"
          height="40"
          rx="9"
          className="fill-card"
        />
        <path
          d="M 12 25 C 31 18, 56 31, 86 23"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          data-studio-eraser-after-line={option.id}
          data-studio-residual-opacity={option.residualOpacity}
          d="M 134 25 C 153 18, 178 31, 208 23"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          opacity={option.residualOpacity}
        />
        <path
          d="m 105 18 7 7-7 7"
          fill="none"
          className="stroke-fg-3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * Controlled two-choice eraser picker shared by desktop popovers and mobile sheets.
 * The preview demonstrates the result on ink instead of drawing a decorative eraser swatch.
 */
export function StudioEraserQuickPicker({
  selectedId,
  onSelect,
  className,
  ariaLabel = "지우개 종류 빠른 선택",
}: StudioEraserQuickPickerProps): ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-studio-eraser-quick-picker="true"
      className={cn(
        "grid grid-cols-1 gap-2 min-[340px]:grid-cols-2",
        className,
      )}
    >
      {STUDIO_ERASER_QUICK_OPTIONS.map((option) => {
        const selected = option.id === selectedId;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            aria-label={`${option.name}, ${option.strengthPercent}% 지움. ${option.description}`}
            onClick={() => onSelect(option.id)}
            data-studio-eraser-quick-option={option.id}
            data-studio-min-target-px="44"
            className={cn(
              "relative flex min-h-[8.5rem] w-full flex-col gap-2 rounded-2xl border p-3 text-left",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              selected
                ? "border-accent/65 bg-accent-soft/45 text-fg shadow-[0_3px_12px_oklch(0.08_0.01_70/0.24)]"
                : "border-line/70 bg-card/75 text-fg hover:border-line-strong hover:bg-raised/85",
            )}
          >
            <span className="flex w-full items-start gap-2">
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-extrabold tracking-tight text-fg">
                  {option.name}
                </strong>
                <span className="mt-1 block text-[0.7rem] leading-5 text-fg-2">
                  {option.description}
                </span>
              </span>
              <span
                aria-label={`지우기 강도 ${option.strengthPercent}%`}
                className={cn(
                  "inline-flex min-h-6 shrink-0 items-center rounded-full border px-2 text-[0.64rem] font-extrabold tabular-nums",
                  selected
                    ? "border-accent/45 bg-accent text-on-accent"
                    : "border-line bg-canvas/80 text-fg-2",
                )}
              >
                {option.strengthPercent}% 지움
              </span>
            </span>

            <StudioEraserBeforeAfterPreview option={option} />

            <span
              aria-hidden
              className={cn(
                "absolute bottom-2.5 right-2.5 grid size-5 place-items-center rounded-full border",
                selected
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line-strong bg-card text-transparent",
              )}
            >
              <Check size={12} strokeWidth={2.5} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
