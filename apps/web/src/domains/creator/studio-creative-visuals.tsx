/**
 * Creative-feature visual glyphs — AutoDraw / CSP / Canva / Concepts style
 * mini illustrations for tools, not brand clones. Pure presentation.
 */
/* eslint-disable react-refresh/only-export-components -- shape kind maps + picker kinds shared with StudioPage / options bar */
import { STUDIO_DRAW_SHAPE_PICKER_KINDS as DRAW_SHAPE_PICKER_KINDS } from "./brush/studio-draw-hud";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolHintSpec } from "./studio-tool-hints";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

/** Re-export pure kind list for pickers (SSOT: studio-draw-hud). */
export const STUDIO_DRAW_SHAPE_PICKER_KINDS = DRAW_SHAPE_PICKER_KINDS;
export type StudioShapePickerKind = (typeof STUDIO_DRAW_SHAPE_PICKER_KINDS)[number]["kind"];

export type StudioShapeKindVisual =
  | "line"
  | "rect"
  | "circle"
  | "triangle"
  | "poly"
  | "star"
  | "arrow"
  | "ellipse";

export type StudioShapePickerItem = {
  readonly kind: StudioShapePickerKind;
  readonly label: string;
  readonly disabled?: boolean;
  readonly unavailableReason?: string;
};

const SHAPE_PICKER_DESCRIPTION_BY_KIND: Readonly<Record<string, string>> = {
  line: "시작점에서 끝점까지 드래그해 곧은 선을 그립니다. Shift를 누르면 수평·수직·45° 방향으로 고정해요.",
  rect: "한 모서리에서 반대 모서리까지 드래그해 사각형을 만듭니다. Shift를 누르면 정사각형으로 고정해요.",
  ellipse: "바깥 영역을 드래그해 타원을 만듭니다. Shift를 누르면 가로세로 비율이 같은 정원으로 고정해요.",
  star: "대각선으로 드래그해 별의 위치와 크기를 정합니다. 별 꼭짓점과 안쪽 반경은 도형 속성에서 다듬을 수 있어요.",
  arrow: "시작점에서 가리킬 곳까지 드래그해 방향 화살표를 만듭니다. 드래그 방향이 화살촉의 방향이 돼요.",
  triangle: "대각선으로 드래그해 삼각형의 바깥 영역을 정합니다. Shift를 누르면 균형 잡힌 비율로 고정해요.",
  polygon: "대각선으로 드래그해 정다각형의 위치와 크기를 정합니다. 변의 수는 도형 속성에서 바꿀 수 있어요.",
};

const SHAPE_PICKER_TIP_BY_KIND: Readonly<Record<string, string>> = {
  line: "투시·아이소메트릭 자가 켜져 있으면 선이 활성 가이드에 맞춰집니다.",
  rect: "채우기를 켜면 외곽선과 내부 색을 함께 만들 수 있어요.",
  ellipse: "정원이 필요할 때는 드래그하는 동안 Shift를 유지하세요.",
  star: "별의 뾰족함은 안쪽 반경 값을 낮출수록 강해집니다.",
  arrow: "화살표는 채우기 없이 선 색과 굵기를 그대로 사용합니다.",
  triangle: "채우기를 켠 뒤 드래그하면 내부가 닫힌 도형으로 생성됩니다.",
  polygon: "변 수를 먼저 정하면 반복 배경과 소품 형태를 빠르게 만들 수 있어요.",
};

const SHAPE_PICKER_DEFAULT_UNAVAILABLE_REASON =
  "현재 작업 상태에서는 이 도형을 사용할 수 없습니다.";

function shapePickerUnavailableReason(item: StudioShapePickerItem): string | undefined {
  if (!item.disabled) return undefined;
  return item.unavailableReason ?? SHAPE_PICKER_DEFAULT_UNAVAILABLE_REASON;
}

/** Shared semantic contract for both the inspector grid and compact shape strip. */
export function studioShapePickerHint(item: Pick<StudioShapePickerItem, "kind" | "label">): StudioToolHintSpec {
  return {
    id: `shape-picker-${item.kind}`,
    title: `${item.label} 도형`,
    description:
      SHAPE_PICKER_DESCRIPTION_BY_KIND[item.kind]
      ?? `${item.label} 도형을 선택하고 캔버스에서 드래그해 위치와 크기를 정합니다.`,
    preview: "shape",
    previewVariant: item.kind,
    tip: SHAPE_PICKER_TIP_BY_KIND[item.kind],
  };
}

/** Map StudioPage DrawShapeKind → glyph id. */
export function studioDrawShapeToGlyph(
  kind: string
): StudioShapeKindVisual {
  if (kind === "ellipse") return "ellipse";
  if (kind === "polygon") return "poly";
  if (
    kind === "line" ||
    kind === "rect" ||
    kind === "triangle" ||
    kind === "star" ||
    kind === "arrow"
  ) {
    return kind;
  }
  return "rect";
}

/** Mini shape icons for smart-shape / shape tool pickers (Photopea/Canva). */
export function StudioShapeKindGlyph({
  kind,
  className,
  active = false,
  filled = false,
}: {
  kind: StudioShapeKindVisual;
  className?: string;
  active?: boolean;
  filled?: boolean;
}): ReactElement {
  const stroke = "currentColor";
  const fill = filled ? "currentColor" : "none";
  const fillOp = filled ? 0.22 : undefined;
  return (
    <svg
      aria-hidden
      width={18}
      height={18}
      viewBox="0 0 18 18"
      className={cn(active ? "text-accent" : "text-fg-2", className)}
      data-studio-shape-glyph={kind}
    >
      {kind === "line" && (
        <path d="M3 13 L15 5" fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" />
      )}
      {kind === "rect" && (
        <rect
          x={3.5}
          y={4.5}
          width={11}
          height={9}
          rx={1.5}
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.6}
        />
      )}
      {kind === "circle" && (
        <circle
          cx={9}
          cy={9}
          r={5.2}
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.6}
        />
      )}
      {kind === "ellipse" && (
        <ellipse
          cx={9}
          cy={9}
          rx={6.2}
          ry={4.5}
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.6}
        />
      )}
      {kind === "triangle" && (
        <path
          d="M9 3.5 L14.5 14 H3.5 Z"
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      )}
      {kind === "poly" && (
        <path
          d="M9 2.8 L14.2 6.2 L12.8 12.5 H5.2 L3.8 6.2 Z"
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {kind === "star" && (
        <path
          d="M9 2.5 L10.7 6.8 L15.3 7.1 L11.7 10 L12.9 14.5 L9 12.2 L5.1 14.5 L6.3 10 L2.7 7.1 L7.3 6.8 Z"
          fill={fill}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={1.35}
          strokeLinejoin="round"
        />
      )}
      {kind === "arrow" && (
        <path
          d="M3 9 H12 M12 9 L8.5 5.5 M12 9 L8.5 12.5"
          fill="none"
          stroke={stroke}
          strokeWidth={1.65}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Visual shape picker tile grid used in tool options / inspector. */
export function StudioShapePickerGrid({
  kinds = STUDIO_DRAW_SHAPE_PICKER_KINDS,
  activeKind,
  onSelect,
  filled = false,
  showLabels = false,
  className,
}: {
  kinds?: readonly StudioShapePickerItem[];
  activeKind: string;
  onSelect: (kind: string) => void;
  /** Preview glyphs with soft fill (when shape fill is on). */
  filled?: boolean;
  /** Prefer glyph-only; labels remain available through ARIA and the rich hint. */
  showLabels?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      data-studio-shape-picker="true"
      role="listbox"
      aria-label="도형 종류"
      className={cn(
        showLabels ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-4 gap-1 sm:grid-cols-7",
        className
      )}
    >
      {kinds.map((item) => {
        const active = activeKind === item.kind;
        const glyph = studioDrawShapeToGlyph(item.kind);
        const canFill = item.kind !== "line" && item.kind !== "arrow";
        const hint = studioShapePickerHint(item);
        const unavailableReason = shapePickerUnavailableReason(item);
        return (
          <StudioToolHintTarget
            key={item.kind}
            hint={hint}
            preferredSide="left"
            unavailableReason={unavailableReason}
            className="w-full"
          >
            <button
              type="button"
              role="option"
              aria-selected={active}
              aria-label={item.label}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (!item.disabled) onSelect(item.kind);
              }}
              className={cn(
                "flex w-full flex-col items-center gap-1 rounded-xl border transition-[background,border-color,box-shadow,transform] duration-150",
                "hover:-translate-y-px hover:shadow-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:translate-y-0 aria-disabled:hover:shadow-none",
                showLabels ? "px-1 py-1.5" : "aspect-square place-items-center p-1.5",
                active
                  ? "border-accent/55 bg-accent-soft/50 text-fg shadow-sm ring-1 ring-accent/20"
                  : "border-line/70 bg-card/90 text-fg-2 hover:border-line hover:bg-raised"
              )}
            >
              <span
                className={cn(
                  "grid place-items-center rounded-lg border",
                  showLabels ? "size-8" : "size-9",
                  active
                    ? "border-accent/40 bg-canvas/50 text-accent"
                    : "border-line/50 bg-canvas/40"
                )}
              >
                <StudioShapeKindGlyph kind={glyph} active={active} filled={filled && canFill} />
              </span>
              {showLabels ? (
                <span className="text-[0.58rem] font-bold leading-none tracking-tight">{item.label}</span>
              ) : null}
            </button>
          </StudioToolHintTarget>
        );
      })}
    </div>
  );
}

/**
 * Compact horizontal shape chips for tool-options / mobile dock (CSP/Photopea).
 * Glyph-first, label optional — denser than the inspector grid.
 */
export function StudioShapePickerStrip({
  kinds = STUDIO_DRAW_SHAPE_PICKER_KINDS,
  activeKind,
  onSelect,
  filled = false,
  showLabels = false,
  className,
}: {
  kinds?: readonly StudioShapePickerItem[];
  activeKind: string;
  onSelect: (kind: string) => void;
  filled?: boolean;
  showLabels?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      data-studio-shape-strip="true"
      role="listbox"
      aria-label="도형 모양"
      className={cn(
        "flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {kinds.map((item) => {
        const active = activeKind === item.kind;
        const glyph = studioDrawShapeToGlyph(item.kind);
        const canFill = item.kind !== "line" && item.kind !== "arrow";
        const hint = studioShapePickerHint(item);
        const unavailableReason = shapePickerUnavailableReason(item);
        return (
          <StudioToolHintTarget
            key={item.kind}
            hint={hint}
            preferredSide="top"
            unavailableReason={unavailableReason}
            className="shrink-0"
          >
            <button
              type="button"
              role="option"
              aria-selected={active}
              aria-label={item.label}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (!item.disabled) onSelect(item.kind);
              }}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border transition-[background,border-color,box-shadow,transform] duration-150",
                "hover:-translate-y-px aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:translate-y-0",
                showLabels ? "px-1.5 text-[0.62rem] font-bold" : "w-8 justify-center px-0",
                active
                  ? "border-accent/55 bg-accent-soft/55 text-fg shadow-sm ring-1 ring-accent/20"
                  : "border-line/70 bg-card/90 text-fg-2 hover:border-line hover:bg-raised"
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-md",
                  active ? "bg-canvas/40 text-accent" : "text-current"
                )}
              >
                <StudioShapeKindGlyph kind={glyph} active={active} filled={filled && canFill} />
              </span>
              {showLabels ? <span className="pr-0.5">{item.label}</span> : null}
            </button>
          </StudioToolHintTarget>
        );
      })}
    </div>
  );
}

/** Canva/Express size chip — disc radius encodes width (no XS/S/M text). */
export function StudioSizeChipGlyph({
  widthPx,
  className,
}: {
  widthPx: number;
  className?: string;
}): ReactElement {
  const r = Math.min(7.5, Math.max(1.4, widthPx * 0.32));
  return (
    <svg
      aria-hidden
      width={16}
      height={16}
      viewBox="0 0 16 16"
      className={cn("text-current", className)}
      data-studio-size-chip-glyph={widthPx}
    >
      <circle cx={8} cy={8} r={r} fill="currentColor" opacity={0.92} />
    </svg>
  );
}

/** Opacity well — checkerboard + fill level. */
export function StudioOpacityGlyph({
  opacity01,
  className,
}: {
  opacity01: number;
  className?: string;
}): ReactElement {
  const op = Math.min(1, Math.max(0, opacity01));
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-opacity-glyph="true"
    >
      <rect x={1} y={1} width={12} height={12} rx={2} fill="oklch(0.35 0.01 70 / 0.45)" />
      <path d="M1 1 H7 V7 H1 Z M7 7 H13 V13 H7 Z" fill="oklch(0.55 0.01 70 / 0.35)" />
      <rect
        x={1}
        y={1}
        width={12}
        height={12}
        rx={2}
        fill="currentColor"
        fillOpacity={0.25 + op * 0.7}
      />
      <rect x={1} y={1} width={12} height={12} rx={2} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  );
}

/** Stabilizer / stream-line wave mark. */
export function StudioStabilizerGlyph({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-stabilizer-glyph="true"
    >
      <path
        d="M2 9 C4 4, 6 10, 8 6 S12 5, 12 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

export type StudioStabilizerModeVisual = "standard" | "adaptive" | "precision";

/** Stabilizer mode glyphs — jagged → smooth. */
export function StudioStabilizerModeGlyph({
  mode,
  className,
}: {
  mode: StudioStabilizerModeVisual;
  className?: string;
}): ReactElement {
  const d =
    mode === "standard"
      ? "M2 9 L4 5 L6 10 L8 4 L10 9 L12 6"
      : mode === "adaptive"
        ? "M2 8 C4 4, 5 10, 7 6 S11 5, 12 7"
        : "M2 7 C5 4, 9 4, 12 7";
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-stabilizer-mode={mode}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type StudioPressureCurveVisual = "soft" | "linear" | "firm";

/** Pressure response curve mini-graph (Procreate/CSP cue). */
export function StudioPressureCurveGlyph({
  curve,
  className,
}: {
  curve: StudioPressureCurveVisual;
  className?: string;
}): ReactElement {
  const d =
    curve === "soft"
      ? "M2 11 C5 11, 6 3, 12 3"
      : curve === "firm"
        ? "M2 11 C8 11, 9 3, 12 3"
        : "M2 11 L12 3";
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-pressure-curve={curve}
    >
      <path d="M2 12 H12 M2 2 V12" stroke="currentColor" strokeWidth={1} opacity={0.35} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.55} strokeLinecap="round" />
    </svg>
  );
}

/** Post-stroke smooth / polish mark. */
export function StudioPostCorrectGlyph({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-post-correct-glyph="true"
    >
      <path
        d="M2 10 C4 6, 6 11, 8 7 S12 6, 12 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.45}
      />
      <path
        d="M2 9 C5 5, 7 9, 9 6 S12 5, 12 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.55}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Concepts/Krita-style live pressure meter for status HUD. */
export function StudioPressureHudMeter({
  ratio,
  className,
}: {
  /** 0–1, or null when no pen sample. */
  ratio: number | null;
  className?: string;
}): ReactElement | null {
  if (ratio === null) return null;
  const pct = Math.round(ratio * 100);
  return (
    <span
      data-studio-pressure-meter="true"
      role="meter"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-card/80 px-1.5 py-0.5",
        className
      )}
      aria-label="실시간 필압"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-raised ring-1 ring-line/50">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums text-[0.58rem] font-bold text-fg-2">{pct}%</span>
    </span>
  );
}

export type StudioSymmetryVisual = "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";

/** Symmetry mode glyphs for the options strip (CSP mirror tools). */
export function StudioSymmetryGlyph({
  mode,
  className,
}: {
  mode: StudioSymmetryVisual;
  className?: string;
}): ReactElement {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      className={cn("text-current", className)}
      data-studio-symmetry-glyph={mode}
    >
      {mode === "none" && (
        <path
          d="M3 7 H11 M7 3 V11"
          stroke="currentColor"
          strokeWidth={1.3}
          strokeLinecap="round"
          opacity={0.45}
        />
      )}
      {mode === "vertical" && (
        <>
          <path d="M7 2 V12" stroke="currentColor" strokeWidth={1.2} strokeDasharray="1.5 1.2" />
          <path
            d="M3 4 C5 5.5, 5 8.5, 3 10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path
            d="M11 4 C9 5.5, 9 8.5, 11 10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </>
      )}
      {mode === "horizontal" && (
        <>
          <path d="M2 7 H12" stroke="currentColor" strokeWidth={1.2} strokeDasharray="1.5 1.2" />
          <path
            d="M4 3 C5.5 5, 8.5 5, 10 3"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path
            d="M4 11 C5.5 9, 8.5 9, 10 11"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </>
      )}
      {mode === "radial" && (
        <>
          <circle cx={7} cy={7} r={2.2} fill="none" stroke="currentColor" strokeWidth={1.2} />
          {[0, 45, 90, 135].map((deg) => (
            <path
              key={deg}
              d="M7 7 L7 2.2"
              stroke="currentColor"
              strokeWidth={1.15}
              strokeLinecap="round"
              transform={`rotate(${deg} 7 7)`}
            />
          ))}
        </>
      )}
      {mode === "kaleidoscope" && (
        <>
          <circle cx={7} cy={7} r={1.45} fill="currentColor" opacity={0.85} />
          {[0, 60, 120].map((deg) => (
            <path
              key={deg}
              d="M7 7 6.05 2.15 7.95 2.15Z"
              fill="currentColor"
              opacity={deg === 0 ? 0.95 : 0.62}
              transform={`rotate(${deg} 7 7)`}
            />
          ))}
          <circle cx={7} cy={7} r={4.85} fill="none" stroke="currentColor" strokeWidth={0.75} opacity={0.45} />
        </>
      )}
      {mode === "silk" && (
        <>
          {/* Distinct from vertical/radial: spiral arms + open ring, no center cross. */}
          <circle cx={7} cy={7} r={4.6} fill="none" stroke="currentColor" strokeWidth={0.85} opacity={0.4} />
          <path
            d="M7 7 C8.4 6.2, 9.8 4.6, 10.6 3.1 C11.2 4.8, 10.4 6.6, 9.1 7.6 C10.6 7.9, 11.8 9.1, 12.1 10.5 C10.4 10.2, 8.7 9.2, 7.7 7.9 C7.4 9.4, 6.2 10.7, 4.7 11.1 C4.9 9.5, 5.8 8, 7 7 Z"
            fill="currentColor"
            opacity={0.88}
          />
          <circle cx={7} cy={7} r={0.85} fill="currentColor" opacity={0.95} />
        </>
      )}
    </svg>
  );
}

export type StudioStarterArtId =
  | "draw"
  | "smart-shape"
  | "brush-kit"
  | "template"
  | "collab-focus"
  | "character"
  | "background-3d"
  | "bubble"
  | "example";

/** Gradient + glyph header for Canva-style starter cards. */
export function StudioStarterCardArt({
  id,
  className,
}: {
  id: StudioStarterArtId;
  className?: string;
}): ReactElement {
  const gradient = (() => {
    switch (id) {
      case "draw":
        return "linear-gradient(145deg, oklch(0.35 0.06 42 / 0.55), oklch(0.2 0.02 70 / 0.8))";
      case "smart-shape":
        return "linear-gradient(145deg, oklch(0.38 0.08 290 / 0.35), oklch(0.2 0.02 70 / 0.85))";
      case "brush-kit":
        return "linear-gradient(145deg, oklch(0.4 0.1 150 / 0.3), oklch(0.2 0.02 70 / 0.85))";
      case "template":
        return "linear-gradient(145deg, oklch(0.36 0.06 232 / 0.35), oklch(0.2 0.02 70 / 0.85))";
      case "collab-focus":
        return "linear-gradient(145deg, oklch(0.32 0.03 70 / 0.5), oklch(0.18 0.01 70 / 0.9))";
      case "character":
        return "linear-gradient(145deg, oklch(0.4 0.09 25 / 0.28), oklch(0.2 0.02 70 / 0.85))";
      case "background-3d":
        return "linear-gradient(145deg, oklch(0.42 0.11 52 / 0.34), oklch(0.19 0.02 70 / 0.9))";
      case "bubble":
        return "linear-gradient(145deg, oklch(0.42 0.04 85 / 0.4), oklch(0.22 0.02 70 / 0.85))";
      case "example":
      default:
        return "linear-gradient(145deg, oklch(0.45 0.12 42 / 0.4), oklch(0.22 0.03 42 / 0.75))";
    }
  })();

  return (
    <div
      data-studio-starter-art={id}
      className={cn(
        "relative flex h-11 w-full items-center justify-center overflow-hidden rounded-lg",
        className
      )}
      style={{ background: gradient }}
    >
      {/* Soft ledger grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.97 0.01 85 / 0.06) 1px, transparent 1px), linear-gradient(90deg, oklch(0.97 0.01 85 / 0.05) 1px, transparent 1px)",
          backgroundSize: "6px 6px",
        }}
      />
      <svg
        aria-hidden
        width={40}
        height={28}
        viewBox="0 0 40 28"
        className="relative text-fg drop-shadow-sm"
      >
        {id === "draw" && (
          <path
            d="M4 20 C10 8, 16 22, 22 10 S32 18, 36 12"
            fill="none"
            stroke="oklch(0.85 0.08 42)"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        )}
        {id === "smart-shape" && (
          <>
            <rect x={5} y={7} width={12} height={12} rx={1.5} fill="none" stroke="oklch(0.82 0.08 290)" strokeWidth={1.5} />
            <circle cx={29} cy={13} r={6} fill="none" stroke="oklch(0.78 0.06 232)" strokeWidth={1.5} />
          </>
        )}
        {id === "brush-kit" && (
          <>
            <path d="M6 18 C12 10, 16 20, 22 12" fill="none" stroke="oklch(0.8 0.1 150)" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M18 20 C24 12, 28 20, 34 14" fill="none" stroke="oklch(0.75 0.12 42)" strokeWidth={3} strokeLinecap="round" opacity={0.75} />
          </>
        )}
        {id === "template" && (
          <>
            <rect x={4} y={5} width={14} height={18} rx={1.2} fill="oklch(0.3 0.02 232 / 0.45)" stroke="oklch(0.75 0.06 232)" strokeWidth={1.2} />
            <rect x={20} y={5} width={16} height={8} rx={1.2} fill="oklch(0.32 0.02 70 / 0.5)" stroke="oklch(0.7 0.03 70)" strokeWidth={1.1} />
            <rect x={20} y={15} width={16} height={8} rx={1.2} fill="oklch(0.32 0.02 70 / 0.5)" stroke="oklch(0.7 0.03 70)" strokeWidth={1.1} />
          </>
        )}
        {id === "collab-focus" && (
          <rect x={6} y={6} width={28} height={16} rx={2} fill="none" stroke="oklch(0.82 0.04 70)" strokeWidth={1.5} strokeDasharray="3 2" />
        )}
        {id === "character" && (
          <>
            <circle cx={20} cy={10} r={5} fill="none" stroke="oklch(0.8 0.08 25)" strokeWidth={1.5} />
            <path d="M10 24 C12 16, 28 16, 30 24" fill="none" stroke="oklch(0.8 0.08 25)" strokeWidth={1.5} strokeLinecap="round" />
          </>
        )}
        {id === "background-3d" && (
          <>
            <path
              d="M20 3 33 9.5 20 16 7 9.5Z"
              fill="oklch(0.78 0.12 52 / 0.3)"
              stroke="oklch(0.82 0.12 52)"
              strokeWidth={1.35}
              strokeLinejoin="round"
            />
            <path
              d="M7 9.5v9L20 25v-9M33 9.5v9L20 25"
              fill="none"
              stroke="oklch(0.72 0.08 52)"
              strokeWidth={1.35}
              strokeLinejoin="round"
            />
            <path
              d="M4 24h32"
              fill="none"
              stroke="oklch(0.7 0.03 70)"
              strokeWidth={1}
              strokeLinecap="round"
              strokeDasharray="2 2"
            />
          </>
        )}
        {id === "bubble" && (
          <path
            d="M8 6 H28 C31 6, 33 8, 33 10.5 V15 C33 17.5, 31 19.5, 28 19.5 H20 L14 24 V19.5 H12 C9 19.5, 7 17.5, 7 15 V10.5 C7 8, 9 6, 12 6 Z"
            fill="oklch(0.94 0.02 85 / 0.85)"
            stroke="oklch(0.55 0.03 70)"
            strokeWidth={1.2}
          />
        )}
        {id === "example" && (
          <>
            <path d="M5 8 H35" stroke="oklch(0.75 0.1 42)" strokeWidth={1.2} opacity={0.5} />
            <path d="M5 14 H28" stroke="oklch(0.75 0.1 42)" strokeWidth={1.2} opacity={0.7} />
            <path d="M5 20 H22" stroke="oklch(0.75 0.1 42)" strokeWidth={1.2} />
          </>
        )}
      </svg>
    </div>
  );
}

const SMART_SHAPE_KIND_LABELS: Record<
  Extract<StudioShapeKindVisual, "line" | "rect" | "circle" | "triangle" | "poly">,
  string
> = {
  line: "선",
  rect: "네모",
  circle: "원",
  triangle: "삼각",
  poly: "다각",
};

/** Row of shape kinds shown when smart-shape is armed — soft chips + Korean labels. */
export function StudioSmartShapeKindRow({
  className,
  highlightKind = null,
}: {
  className?: string;
  /** Currently recognized kind — AutoDraw-class match cue. */
  highlightKind?: StudioShapeKindVisual | null;
}): ReactElement {
  const kinds: Array<keyof typeof SMART_SHAPE_KIND_LABELS> = [
    "line",
    "rect",
    "circle",
    "triangle",
    "poly",
  ];
  return (
    <div
      data-studio-smart-shape-kinds="true"
      data-studio-smart-shape-match={highlightKind ?? undefined}
      role="list"
      aria-label="인식 가능한 도형"
      className={cn(
        "grid grid-cols-5 gap-1 rounded-xl border border-line/45 bg-canvas/35 p-1.5",
        className
      )}
    >
      {kinds.map((kind) => {
        const active = highlightKind === kind;
        const label = SMART_SHAPE_KIND_LABELS[kind];
        return (
          <span
            key={kind}
            role="listitem"
            data-studio-smart-shape-kind={kind}
            data-active={active ? "true" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 ring-1 transition-[background,box-shadow,transform,color] duration-200 ease-out",
              active
                ? "scale-[1.03] bg-accent-soft text-accent shadow-[0_1px_0_oklch(0.95_0.02_85_/_0.08)] ring-accent/40"
                : "bg-card/70 text-fg-2 ring-line/40"
            )}
          >
            <StudioShapeKindGlyph kind={kind} active={active} className="size-4" />
            <span
              className={cn(
                "text-[0.55rem] font-semibold leading-none tracking-tight",
                active ? "text-accent" : "text-fg-3"
              )}
            >
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
