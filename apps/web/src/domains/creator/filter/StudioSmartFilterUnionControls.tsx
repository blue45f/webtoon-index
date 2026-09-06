import { useId, type ReactElement } from "react";

import {
  STUDIO_FILTER_UNION_WAVE_KINDS,
  type StudioFilterUnionWaveKind,
} from "./studio-filter-pack-registry";

export type StudioSmartFilterUnionParams = Record<string, number | string | boolean>;

type NumericControlSpec = Readonly<{
  key: "amount" | "scale" | "detail" | "seed" | "centerX" | "centerY" | "angle";
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  suffix?: string;
}>;

const UNION_ENGINE_SET: ReadonlySet<string> = new Set(STUDIO_FILTER_UNION_WAVE_KINDS);

const GEOMETRY_ENGINE_SET: ReadonlySet<StudioFilterUnionWaveKind> = new Set([
  "wave-warp",
  "ripple-warp",
  "fisheye",
  "twirl",
  "pinch-bloat",
  "lens-distortion",
  "polar-coordinates",
]);

const AMOUNT = {
  key: "amount",
  label: "세기",
  min: 0,
  max: 100,
  step: 1,
  fallback: 50,
  suffix: "%",
} as const;
const SIGNED_AMOUNT = { ...AMOUNT, min: -100, label: "방향 / 세기" } as const;
const CENTER_X = {
  key: "centerX",
  label: "중심 X",
  min: 0,
  max: 100,
  step: 1,
  fallback: 50,
  suffix: "%",
} as const;
const CENTER_Y = { ...CENTER_X, key: "centerY", label: "중심 Y" } as const;
const SEED = {
  key: "seed",
  label: "시드",
  min: 0,
  max: 9_999,
  step: 1,
  fallback: 1_337,
} as const;

const UNION_NUMERIC_CONTROLS: Readonly<
  Record<StudioFilterUnionWaveKind, readonly NumericControlSpec[]>
> = Object.freeze({
  "wave-warp": [
    SIGNED_AMOUNT,
    { key: "scale", label: "파장", min: 4, max: 120, step: 1, fallback: 28, suffix: "px" },
    { key: "angle", label: "위상", min: -180, max: 180, step: 1, fallback: 0, suffix: "°" },
  ],
  "ripple-warp": [
    SIGNED_AMOUNT,
    { key: "scale", label: "파장", min: 4, max: 120, step: 1, fallback: 22, suffix: "px" },
    CENTER_X,
    CENTER_Y,
    { key: "angle", label: "위상", min: -180, max: 180, step: 1, fallback: 0, suffix: "°" },
  ],
  fisheye: [SIGNED_AMOUNT, CENTER_X, CENTER_Y],
  twirl: [SIGNED_AMOUNT, CENTER_X, CENTER_Y],
  "pinch-bloat": [SIGNED_AMOUNT, CENTER_X, CENTER_Y],
  "lens-distortion": [
    SIGNED_AMOUNT,
    { key: "scale", label: "광학 배율", min: 50, max: 150, step: 1, fallback: 100, suffix: "%" },
    CENTER_X,
    CENTER_Y,
  ],
  "film-grain-pro": [
    AMOUNT,
    { key: "scale", label: "입자 크기", min: 1, max: 6, step: 1, fallback: 1, suffix: "px" },
    SEED,
  ],
  "salt-pepper": [AMOUNT, SEED],
  "rgb-noise": [
    AMOUNT,
    { key: "scale", label: "입자 크기", min: 1, max: 8, step: 1, fallback: 1, suffix: "px" },
    SEED,
  ],
  "perlin-texture": [
    AMOUNT,
    { key: "scale", label: "재질 스케일", min: 4, max: 120, step: 1, fallback: 32, suffix: "px" },
    { key: "detail", label: "세부 옥타브", min: 51, max: 255, step: 1, fallback: 153 },
    SEED,
  ],
  pointillize: [
    AMOUNT,
    { key: "scale", label: "점 크기", min: 3, max: 32, step: 1, fallback: 9, suffix: "px" },
    SEED,
  ],
  "stained-glass": [
    AMOUNT,
    { key: "scale", label: "셀 크기", min: 4, max: 40, step: 1, fallback: 12, suffix: "px" },
    { key: "detail", label: "납선 농도", min: 0, max: 255, step: 1, fallback: 96 },
    SEED,
  ],
  "poster-edges": [
    AMOUNT,
    { key: "scale", label: "색상 단계", min: 2, max: 12, step: 1, fallback: 6 },
    { key: "detail", label: "윤곽 임계", min: 1, max: 255, step: 1, fallback: 92 },
  ],
  photocopy: [
    AMOUNT,
    { key: "scale", label: "국소 반경", min: 1, max: 5, step: 1, fallback: 2, suffix: "px" },
    { key: "detail", label: "용지 임계", min: 1, max: 254, step: 1, fallback: 148 },
  ],
  "normal-map": [
    AMOUNT,
    { key: "scale", label: "기울기 반경", min: 1, max: 4, step: 1, fallback: 1, suffix: "px" },
    { key: "detail", label: "표면 강도", min: 1, max: 255, step: 1, fallback: 110 },
  ],
  "god-rays": [
    AMOUNT,
    { key: "scale", label: "샘플 수", min: 2, max: 10, step: 1, fallback: 7 },
    { key: "detail", label: "밝기 임계", min: 0, max: 255, step: 1, fallback: 152 },
    CENTER_X,
    CENTER_Y,
  ],
  "polar-coordinates": [AMOUNT, CENTER_X, CENTER_Y],
});

function isStudioSmartFilterUnionEngine(
  value: string,
): value is StudioFilterUnionWaveKind {
  return UNION_ENGINE_SET.has(value);
}

function numericParam(
  params: StudioSmartFilterUnionParams,
  key: NumericControlSpec["key"],
  fallback: number,
): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatNumericValue(value: number, step: number): string {
  if (Number.isInteger(step)) return String(Math.round(value));
  const precision = Math.min(3, Math.max(1, String(step).split(".")[1]?.length ?? 1));
  return value.toFixed(precision).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function UnionNumericControl({
  spec,
  params,
  onChange,
}: {
  spec: NumericControlSpec;
  params: StudioSmartFilterUnionParams;
  onChange: (next: StudioSmartFilterUnionParams) => void;
}): ReactElement {
  const id = useId();
  const value = numericParam(params, spec.key, spec.fallback);
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
      <label htmlFor={id} className="text-[0.62rem] font-semibold text-fg-2">
        {spec.label}
      </label>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange({
          ...params,
          [spec.key]: Number(event.target.value),
        })}
        aria-valuetext={spec.suffix ? `${formatNumericValue(value, spec.step)}${spec.suffix}` : undefined}
        className="h-10 min-w-0 cursor-pointer accent-accent pointer-coarse:h-11"
      />
      <output htmlFor={id} className="text-right text-[0.6rem] tabular-nums text-fg-3">
        {formatNumericValue(value, spec.step)}{spec.suffix ?? ""}
      </output>
    </div>
  );
}

function UnionSelectControl({
  label,
  paramKey,
  value,
  options,
  params,
  onChange,
}: {
  label: string;
  paramKey: "mode" | "interpolation";
  value: string;
  options: readonly { value: string; label: string }[];
  params: StudioSmartFilterUnionParams;
  onChange: (next: StudioSmartFilterUnionParams) => void;
}): ReactElement {
  const id = useId();
  return (
    <label htmlFor={id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange({ ...params, [paramKey]: event.target.value })}
        className="min-h-10 min-w-0 rounded-lg border border-line bg-canvas px-2 text-[0.65rem] text-fg outline-none focus:border-accent pointer-coarse:min-h-11"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function StudioSmartFilterUnionControls({
  engine,
  params,
  onChange,
}: {
  engine: string;
  params: StudioSmartFilterUnionParams;
  onChange: (next: StudioSmartFilterUnionParams) => void;
}): ReactElement | null {
  if (!isStudioSmartFilterUnionEngine(engine)) return null;
  const controls = UNION_NUMERIC_CONTROLS[engine];
  return (
    <>
      {engine === "polar-coordinates" ? (
        <UnionSelectControl
          label="좌표 모드"
          paramKey="mode"
          value={params.mode === "polar-to-rectangular" ? "polar-to-rectangular" : "rectangular-to-polar"}
          options={[
            { value: "rectangular-to-polar", label: "직교 → 극좌표" },
            { value: "polar-to-rectangular", label: "극좌표 → 직교" },
          ]}
          params={params}
          onChange={onChange}
        />
      ) : null}
      {GEOMETRY_ENGINE_SET.has(engine) ? (
        <UnionSelectControl
          label="보간"
          paramKey="interpolation"
          value={params.interpolation === "nearest" ? "nearest" : "bilinear"}
          options={[
            { value: "bilinear", label: "부드러운 보간" },
            { value: "nearest", label: "최근접 · 픽셀 보존" },
          ]}
          params={params}
          onChange={onChange}
        />
      ) : null}
      {controls.map((spec) => (
        <UnionNumericControl
          key={spec.key}
          spec={spec}
          params={params}
          onChange={onChange}
        />
      ))}
    </>
  );
}
