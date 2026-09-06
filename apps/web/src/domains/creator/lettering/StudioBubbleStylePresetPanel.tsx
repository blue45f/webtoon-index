import { normalizeStrokeStyle, type StrokeStyle } from "../brush/studio-stroke-shapes";

import { BUBBLE_STYLE_PRESETS, type BubbleStylePreset } from "./studio-bubble-style-presets";

import type { BubbleVariant } from "../studio-assets";

import { cx } from "@/shared/lib/cx";

export type BubbleStylePresetTarget = {
  fill: string;
  textFill: string;
  stroke?: string;
  strokeWidth?: number;
  font?: string;
  strokeStyle?: StrokeStyle;
  variant: BubbleVariant;
};

export type BubbleStylePresetPatch = Pick<
  BubbleStylePreset,
  | "fill"
  | "textFill"
  | "stroke"
  | "strokeWidth"
  | "strokeStyle"
  | "variant"
  | "starAmplitude"
  | "shadowColor"
  | "shadowBlur"
  | "shadowOffsetX"
  | "shadowOffsetY"
  | "shadowOpacity"
  | "font"
>;

/** 프리셋이 가리키는 모양을 스와치에 반영 — 전부 같은 말하기 실루엣이면 다양성이 안 보인다. */
function BubbleStyleSwatch({ preset }: { preset: BubbleStylePreset }) {
  const fill = preset.fill === "transparent" ? "oklch(0.95 0.01 85 / 0.15)" : preset.fill;
  const stroke = preset.stroke || "oklch(0.3 0.01 70 / 0.35)";
  const sw = Math.max(1.2, Math.min(2.8, preset.strokeWidth ?? 1.75));
  const variant = preset.variant ?? "speech";
  const dash =
    preset.strokeStyle?.dash === "dot"
      ? "2 2.5"
      : preset.strokeStyle?.dash === "dash"
        ? "4 3"
        : undefined;

  let body: string;
  switch (variant) {
    case "thought":
      body = "M22 4.5 A14 9.5 0 1 1 21.99 4.5 Z";
      break;
    case "shout":
    case "angry":
      body = "M22 3 25 10 33 8 30 15 38 18 30 21 33 28 25 25 22 32 19 25 11 28 14 21 6 18 14 15 11 8 19 10Z";
      break;
    case "scared":
      body = "M8 9 Q11 5 14 9 T20 9 T26 9 T32 9 Q36 9 36 14 V20 Q36 24 32 24 H12 Q8 24 8 20 Z";
      break;
    case "heart":
      body = "M22 26 10 16 C5 11 8 5 13 5 c4 0 7 3 9 7 2-4 5-7 9-7 5 0 8 6 3 11Z";
      break;
    case "system":
    case "box":
      body = "M7 6 H37 V22 H7 Z";
      break;
    case "phone":
      body = "M8 6 H34 Q37 6 37 9 V18 Q37 21 34 21 H16 L11 26 12 21 H8 Q5 21 5 18 V9 Q5 6 8 6 Z";
      break;
    case "whisper":
      body = "M8 5.5 C8 3.5, 10 2, 14 2 H30 C34 2, 36 3.5, 36 5.5 V15 C36 17, 34 18.5, 30 18.5 H20 L14 24.5 V18.5 H14 C10 18.5, 8 17, 8 15 Z";
      break;
    case "double":
      body = "M10 3 H32 Q37 3 37 8 V11 Q37 14 33 15 Q37 16 37 19 V22 Q37 27 32 27 H22 L16 31 17 27 H10 Q5 27 5 22 V19 Q5 16 9 15 Q5 14 5 11 V8 Q5 3 10 3 Z";
      break;
    default:
      body =
        "M8 5.5 C8 3.5, 10 2, 14 2 H30 C34 2, 36 3.5, 36 5.5 V15 C36 17, 34 18.5, 30 18.5 H20 L14 24.5 V18.5 H14 C10 18.5, 8 17, 8 15 Z";
  }

  return (
    <svg
      aria-hidden
      width={44}
      height={28}
      viewBox="0 0 44 28"
      className="block drop-shadow-sm"
      data-studio-bubble-swatch={preset.id}
      data-studio-bubble-swatch-variant={variant}
    >
      <ellipse cx={22} cy={24} rx={14} ry={2.2} fill="oklch(0.1 0.01 70 / 0.22)" />
      <path
        d={body}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeDasharray={dash}
      />
      <text
        x={22}
        y={variant === "heart" || variant === "shout" || variant === "angry" ? 15 : 13.5}
        textAnchor="middle"
        fontSize={8}
        fontWeight={700}
        fill={preset.textFill}
        fontFamily="system-ui, sans-serif"
      >
        가
      </text>
    </svg>
  );
}

export function StudioBubbleStylePresetPanel({
  selected,
  onApplyPreset,
}: {
  selected: BubbleStylePresetTarget;
  onApplyPreset: (patch: BubbleStylePresetPatch) => void;
}) {
  return (
    <div
      className="mt-2.5 rounded-2xl border border-line/45 bg-gradient-to-b from-card/50 to-transparent p-2.5"
      data-studio-bubble-style-presets="true"
    >
      <p className="mb-0.5 text-[0.72rem] font-semibold tracking-tight text-fg-2">분위기 스와치</p>
      <p className="mb-2 text-[0.6rem] leading-snug text-fg-3">
        색·선·모양을 한 번에. 장면에 맞는 말투를 골라 보세요.
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {BUBBLE_STYLE_PRESETS.map((preset) => {
          const isMatch =
            selected.fill === preset.fill &&
            selected.textFill === preset.textFill &&
            (preset.stroke ? selected.stroke === preset.stroke : !selected.stroke) &&
            (preset.strokeWidth ? selected.strokeWidth === preset.strokeWidth : true) &&
            (preset.variant ? selected.variant === preset.variant : true) &&
            (preset.strokeStyle
              ? normalizeStrokeStyle(selected.strokeStyle).dash === preset.strokeStyle.dash
              : true);

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onApplyPreset({
                  fill: preset.fill,
                  textFill: preset.textFill,
                  stroke: preset.stroke,
                  strokeWidth: preset.strokeWidth,
                  strokeStyle: preset.strokeStyle,
                  // 프리셋에 variant가 있으면 모양까지 바꾸고, 없으면 기존 모양 유지.
                  variant: preset.variant ?? selected.variant,
                  starAmplitude: preset.starAmplitude,
                  shadowColor: preset.shadowColor,
                  shadowBlur: preset.shadowBlur,
                  shadowOffsetX: preset.shadowOffsetX,
                  shadowOffsetY: preset.shadowOffsetY,
                  shadowOpacity: preset.shadowOpacity,
                  font: preset.font ?? selected.font,
                });
              }}
              className={cx(
                "flex cursor-pointer flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition-[border-color,background,box-shadow,transform] duration-150 ease-out",
                "hover:-translate-y-px hover:bg-raised/80 hover:shadow-sm",
                isMatch
                  ? "border-accent/50 bg-accent-soft/40 shadow-sm ring-1 ring-accent/25"
                  : "border-line/55 bg-card/90"
              )}
              title={preset.description}
            >
              <div className="flex items-center justify-center rounded-lg bg-canvas/45 py-1.5 ring-1 ring-line/35">
                <BubbleStyleSwatch preset={preset} />
              </div>
              <span className="truncate text-[0.65rem] font-semibold tracking-tight text-fg">
                {preset.label}
              </span>
              <span className="line-clamp-2 text-[0.55rem] leading-snug text-fg-3">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
