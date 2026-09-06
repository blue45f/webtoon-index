/**
 * Controlled Studio surface for the isolated p5.brush settled-raster provider.
 *
 * This panel deliberately owns no engine, Worker, document, history, or async
 * state. The parent translates these product-facing controls into a provider
 * request and commits a completed artifact as one canonical raster operation.
 */
import {
  Brush,
  Droplets,
  Grid3X3,
  LoaderCircle,
  PaintBucket,
  Palette,
  Sparkles,
  Square,
  Waves,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_FOCUS_RING,
  StudioSliderRow,
} from "./studio-panel-ui";

import type { StudioProceduralArtisticBrushTechnique } from "./studio-procedural-artistic-brush-provider";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioProceduralArtisticBrushUiTechnique = Extract<
  StudioProceduralArtisticBrushTechnique,
  "flow-field" | "hatch" | "mass" | "watercolor-fill" | "flat-wash"
>;

export type StudioProceduralArtisticBrushCapabilityStatus =
  | "checking"
  | "ready"
  | "unavailable";

export interface StudioProceduralArtisticBrushPanelProps {
  readonly technique: StudioProceduralArtisticBrushUiTechnique;
  readonly color: string;
  /** Product-facing density or paper texture, normalized to 1..100. */
  readonly density: number;
  /** Hatch or watercolor bleed direction in degrees. */
  readonly angle: number;
  /** Settled flow-field or hatch line width in CSS pixels. */
  readonly weight: number;
  /** Technique intensity or flat-wash opacity, normalized to 0..1. */
  readonly strength: number;
  /** Deterministic signed 32-bit-compatible seed. */
  readonly seed: number;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly capabilityStatus: StudioProceduralArtisticBrushCapabilityStatus;
  readonly capabilityMessage?: string | null;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly onTechniqueChange: (
    technique: StudioProceduralArtisticBrushUiTechnique,
  ) => void;
  readonly onColorChange: (color: string) => void;
  readonly onDensityChange: (density: number) => void;
  readonly onAngleChange: (angle: number) => void;
  readonly onWeightChange: (weight: number) => void;
  readonly onStrengthChange: (strength: number) => void;
  readonly onSeedChange: (seed: number) => void;
  readonly onGenerate: () => void;
  readonly onCancel: () => void;
}

const TECHNIQUES: readonly {
  readonly id: StudioProceduralArtisticBrushUiTechnique;
  readonly label: string;
  readonly description: string;
  readonly Icon: LucideIcon;
}[] = [
  {
    id: "flow-field",
    label: "흐름장",
    description: "유기적인 흐름의 선 질감 레이어를 만듭니다.",
    Icon: Waves,
  },
  {
    id: "hatch",
    label: "해칭",
    description: "일정한 방향의 해칭 패턴 레이어를 만듭니다.",
    Icon: Grid3X3,
  },
  {
    id: "mass",
    label: "매스",
    description: "목탄처럼 밀도 있는 덩어리 질감 레이어를 만듭니다.",
    Icon: Brush,
  },
  {
    id: "watercolor-fill",
    label: "수채 채움",
    description: "종이결과 가장자리 번짐이 살아 있는 수채 면을 만듭니다.",
    Icon: Droplets,
  },
  {
    id: "flat-wash",
    label: "플랫 워시",
    description: "균일한 투명도의 넓은 색면 레이어를 만듭니다.",
    Icon: PaintBucket,
  },
] as const;

const CONTROL_CLASS = cn(
  "min-h-11 rounded-lg border border-line bg-card px-2.5 text-xs text-fg",
  "outline-none transition-colors hover:border-line-strong",
  STUDIO_FOCUS_RING,
  "disabled:cursor-not-allowed disabled:bg-raised/55 disabled:text-fg-3",
);

function capabilityText(
  status: StudioProceduralArtisticBrushCapabilityStatus,
  message: string | null | undefined,
): string {
  if (message) return message;
  switch (status) {
    case "checking":
      return "전용 Worker와 WebGL2 렌더링 기능을 확인하고 있습니다.";
    case "ready":
      return "전용 Worker에서 결정적 질감을 생성할 준비가 됐습니다.";
    case "unavailable":
      return "이 환경에서는 전용 Worker 또는 WebGL2 질감 렌더링을 사용할 수 없습니다.";
  }
}

function densityLabel(
  technique: StudioProceduralArtisticBrushUiTechnique,
): string {
  switch (technique) {
    case "flow-field":
      return "흐름 밀도";
    case "hatch":
      return "해칭 밀도";
    case "mass":
      return "입자 밀도";
    case "watercolor-fill":
      return "종이 질감";
    case "flat-wash":
      return "채움 밀도";
  }
}

function strengthLabel(
  technique: StudioProceduralArtisticBrushUiTechnique,
): string {
  switch (technique) {
    case "watercolor-fill":
      return "번짐 강도";
    case "flat-wash":
      return "불투명도";
    default:
      return "효과 강도";
  }
}

export function StudioProceduralArtisticBrushPanel({
  technique,
  color,
  density,
  angle,
  weight,
  strength,
  seed,
  busy = false,
  error = null,
  capabilityStatus,
  capabilityMessage = null,
  disabled = false,
  disabledReason = null,
  onTechniqueChange,
  onColorChange,
  onDensityChange,
  onAngleChange,
  onWeightChange,
  onStrengthChange,
  onSeedChange,
  onGenerate,
  onCancel,
}: StudioProceduralArtisticBrushPanelProps): ReactElement {
  const headingId = useId();
  const descriptionId = useId();
  const capabilityId = useId();
  const errorId = useId();
  const controlsDisabled =
    disabled || busy || capabilityStatus !== "ready";
  const generateDisabled =
    disabled || busy || capabilityStatus !== "ready";
  const statusText = capabilityText(capabilityStatus, capabilityMessage);
  const actionDescriptionIds = [
    descriptionId,
    capabilityId,
    error ? errorId : null,
  ].filter(Boolean).join(" ");

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      data-studio-procedural-artistic-brush-panel="true"
      className="space-y-3 rounded-lg border border-line/70 bg-panel/40 p-3"
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft/45 text-accent"
        >
          <Sparkles size={17} />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-bold tracking-tight text-fg">
            절차적 질감 생성기
          </h3>
          <p
            id={descriptionId}
            className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3"
          >
            설정한 기법과 시드로 결정적 질감을 전용 GPU Worker에서 렌더링해 새 래스터 레이어로 추가합니다.
          </p>
        </div>
      </header>

      <fieldset disabled={controlsDisabled} className="min-w-0">
        <legend className="mb-1.5 text-[0.68rem] font-semibold text-fg-2">
          질감 기법
        </legend>
        <div
          data-studio-procedural-artistic-brush-techniques="true"
          className="grid grid-cols-2 gap-1.5"
        >
          {TECHNIQUES.map(({ id, label, description, Icon }) => {
            const techniqueDescriptionId =
              `${headingId}-${id}-description`;
            return (
              <label
                key={id}
                title={description}
                className={cn(
                  "relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1.5 text-center transition-colors",
                  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  technique === id
                    ? "border-accent/60 bg-accent-soft/55 text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                  controlsDisabled && "cursor-not-allowed opacity-45",
                )}
              >
                <input
                  type="radio"
                  name={`${headingId}-technique`}
                  value={id}
                  checked={technique === id}
                  disabled={controlsDisabled}
                  aria-label={label}
                  aria-describedby={techniqueDescriptionId}
                  className="sr-only"
                  onChange={() => onTechniqueChange(id)}
                />
                <span className="flex items-center gap-1 text-[0.68rem] font-semibold">
                  <Icon size={13} aria-hidden />
                  {label}
                </span>
                <span
                  id={techniqueDescriptionId}
                  className="line-clamp-1 text-[0.56rem] text-fg-3"
                >
                  {description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,0.8fr)] gap-2 max-[340px]:grid-cols-1">
        <label className="min-w-0 text-[0.68rem] font-semibold text-fg-2">
          색상
          <span className="mt-1 flex min-w-0 gap-1.5">
            <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-card">
              <Palette size={15} aria-hidden className="pointer-events-none absolute text-fg-3" />
              <input
                type="color"
                aria-label="질감 색상"
                value={color}
                disabled={controlsDisabled}
                onChange={(event) => onColorChange(event.currentTarget.value)}
                className="size-14 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-1 rounded-md border border-black/15"
                style={{ backgroundColor: color }}
              />
            </span>
            <input
              type="text"
              aria-label="질감 색상 코드"
              value={color}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              disabled={controlsDisabled}
              onChange={(event) => onColorChange(event.currentTarget.value)}
              className={cn(CONTROL_CLASS, "min-w-0 flex-1 font-mono uppercase")}
            />
          </span>
        </label>

        <label className="min-w-0 text-[0.68rem] font-semibold text-fg-2">
          반복 시드
          <input
            type="number"
            aria-label="결정적 반복 시드"
            min={0}
            max={2_147_483_647}
            step={1}
            value={seed}
            disabled={controlsDisabled}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) onSeedChange(next);
            }}
            className={cn(CONTROL_CLASS, "mt-1 w-full tabular-nums")}
          />
        </label>
      </div>

      <div
        aria-label={`${TECHNIQUES.find((entry) => entry.id === technique)?.label ?? "절차적"} 세부 설정`}
        className="space-y-2 rounded-lg border border-line/60 bg-card/45 p-2.5"
      >
        {technique !== "flat-wash" ? (
          <StudioSliderRow
            label={densityLabel(technique)}
            min={1}
            max={100}
            step={1}
            value={density}
            disabled={controlsDisabled}
            onChange={onDensityChange}
            readout={`${Math.round(density)}%`}
          />
        ) : null}

        {technique === "hatch" || technique === "watercolor-fill" ? (
          <StudioSliderRow
            label={technique === "hatch" ? "선 방향" : "번짐 방향"}
            min={-180}
            max={180}
            step={1}
            value={angle}
            disabled={controlsDisabled}
            onChange={onAngleChange}
            readout={`${Math.round(angle)}°`}
          />
        ) : null}

        {technique === "flow-field" || technique === "hatch" ? (
          <StudioSliderRow
            label="선 굵기"
            min={0.1}
            max={32}
            step={0.1}
            value={weight}
            disabled={controlsDisabled}
            onChange={onWeightChange}
            readout={`${weight.toFixed(1)}px`}
          />
        ) : null}

        {technique !== "hatch" ? (
          <StudioSliderRow
            label={strengthLabel(technique)}
            min={technique === "flat-wash" ? 0.01 : 0}
            max={1}
            step={0.01}
            value={strength}
            disabled={controlsDisabled}
            onChange={onStrengthChange}
            readout={`${Math.round(strength * 100)}%`}
          />
        ) : null}
      </div>

      <div
        id={capabilityId}
        role="status"
        aria-live="polite"
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-2 text-[0.66rem] leading-relaxed",
          capabilityStatus === "ready"
            ? "border-good/25 bg-good/8 text-fg-2"
            : capabilityStatus === "unavailable"
              ? "border-warn/35 bg-warn/10 text-warn"
              : "border-line bg-raised/55 text-fg-3",
        )}
      >
        {capabilityStatus === "checking" ? (
          <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden />
        ) : (
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              capabilityStatus === "ready" ? "bg-good" : "bg-warn",
            )}
          />
        )}
        <span>{statusText}</span>
      </div>

      {disabled && disabledReason ? (
        <p className="text-[0.66rem] leading-relaxed text-warn" role="status">
          {disabledReason}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-lg border border-bad/35 bg-bad/10 px-2.5 py-2 text-[0.66rem] leading-relaxed text-bad"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            aria-describedby={actionDescriptionIds}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2",
              "transition-colors hover:border-bad/45 hover:bg-bad/10 hover:text-bad",
              STUDIO_FOCUS_RING,
            )}
          >
            <Square size={13} aria-hidden />
            생성 취소
          </button>
        ) : (
          <span aria-hidden className="min-h-11" />
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={generateDisabled}
          aria-describedby={actionDescriptionIds}
          title={
            generateDisabled && !busy
              ? disabledReason ?? statusText
              : "현재 설정으로 결정적인 절차적 질감을 생성합니다."
          }
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent",
            "transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg-3",
            STUDIO_FOCUS_RING,
          )}
        >
          {busy ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )}
          {busy ? "생성 중…" : "질감 생성"}
        </button>
      </div>
    </section>
  );
}
