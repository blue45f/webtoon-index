import {
  resolveStudioOutlineStrokeContract,
  type StudioOutlineStrokeContractV1,
} from "../studio-outline-stroke-contract";

import type { DrawEl } from "../studio-element-model";

export const STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION =
  "studio-hokusai-natural-media-v2" as const;
export const STUDIO_HOKUSAI_RUNTIME_VERSION = "0.3.0" as const;

export const STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS = Object.freeze({
  maxDimension: 4_096,
  maxPixels: 16_777_216,
  maxRgbaBytes: 64 * 1_024 * 1_024,
  maxPngBytes: 64 * 1_024 * 1_024,
  maxSamples: 131_072,
  maxSourceCoordinate: 1_000_000_000,
  minLogicalSize: 0.25,
  maxLogicalSize: 512,
  minScale: 0.125,
  maxScale: 4,
  maxIdentityCodeUnits: 512,
} as const);

export const STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS = Object.freeze([
  {
    id: "pencil",
    label: "연필",
    description: "필압에 따라 농도와 굵기가 함께 변하는 부드러운 연필선",
  },
  {
    id: "charcoal",
    label: "목탄",
    description: "입자 분산과 낮은 경도로 종이결이 살아나는 목탄선",
  },
  {
    id: "oil",
    label: "오일",
    description: "안료 혼색과 느린 추적을 사용하는 두터운 회화선",
  },
  {
    id: "calligraphy",
    label: "캘리그래피",
    description: "기울기와 방향에 반응하는 납작한 붓·펜 선",
  },
  {
    id: "marker",
    label: "마커",
    description: "기울기에 따라 각도와 폭이 바뀌는 단단한 마커선",
  },
] as const);

export type StudioHokusaiNaturalMediaPresetId =
  (typeof STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS)[number]["id"];

/**
 * Product material identity is intentionally independent from the libmypaint
 * carrier preset. Chalk, crayon, pastel and charcoal can therefore share the
 * quality-gated `charcoal` MYB dynamics without collapsing back to one visual
 * texture; the same rule applies to the painterly `oil` carrier family.
 */
export const STUDIO_HOKUSAI_MATERIAL_PROFILES = Object.freeze([
  { id: "pencil", carrierPresetId: "pencil" },
  { id: "charcoal", carrierPresetId: "charcoal" },
  { id: "chalk", carrierPresetId: "charcoal" },
  { id: "crayon", carrierPresetId: "charcoal" },
  { id: "pastel", carrierPresetId: "charcoal" },
  { id: "oil-pastel", carrierPresetId: "charcoal" },
  { id: "oil", carrierPresetId: "oil" },
  { id: "acrylic", carrierPresetId: "oil" },
  { id: "gouache", carrierPresetId: "oil" },
  { id: "painterly", carrierPresetId: "oil" },
  { id: "calligraphy", carrierPresetId: "calligraphy" },
  { id: "marker", carrierPresetId: "marker" },
] as const);

export type StudioHokusaiMaterialProfileId =
  (typeof STUDIO_HOKUSAI_MATERIAL_PROFILES)[number]["id"];

const HOKUSAI_MATERIAL_PROFILE_CARRIER = new Map<
  StudioHokusaiMaterialProfileId,
  StudioHokusaiNaturalMediaPresetId
>(STUDIO_HOKUSAI_MATERIAL_PROFILES.map((profile) => [
  profile.id,
  profile.carrierPresetId,
]));

export function studioHokusaiDefaultMaterialProfileId(
  presetId: StudioHokusaiNaturalMediaPresetId,
): StudioHokusaiMaterialProfileId {
  if (presetId === "charcoal") return "charcoal";
  if (presetId === "oil") return "oil";
  return presetId;
}

export function studioHokusaiMaterialProfileIsCompatible(
  presetId: StudioHokusaiNaturalMediaPresetId,
  materialProfileId: unknown,
): materialProfileId is StudioHokusaiMaterialProfileId {
  return typeof materialProfileId === "string"
    && HOKUSAI_MATERIAL_PROFILE_CARRIER.get(
      materialProfileId as StudioHokusaiMaterialProfileId,
    ) === presetId;
}

export interface StudioHokusaiNaturalMediaSettings {
  readonly presetId: StudioHokusaiNaturalMediaPresetId;
  /** Omitted by v1 documents and resolved to the carrier's legacy profile. */
  readonly materialProfileId?: StudioHokusaiMaterialProfileId;
  readonly color: `#${string}`;
  readonly sizeScale: number;
  readonly opacity: number;
  readonly seed: number;
}

export interface StudioHokusaiNaturalMediaSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeMilliseconds: number;
}

export interface StudioHokusaiNaturalMediaRenderPlan {
  readonly kind: "studio-hokusai-natural-media/render-plan";
  readonly version: typeof STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION;
  readonly engine: Readonly<{
    readonly id: "reearth-hokusai";
    readonly version: typeof STUDIO_HOKUSAI_RUNTIME_VERSION;
    readonly brushFormat: "libmypaint-myb-v3";
    readonly alpha: "transparent-straight-rgba8";
    readonly execution: "dedicated-worker-wasm";
  }>;
  readonly source: Readonly<{
    readonly elementId: string;
    readonly brushId: string;
    readonly sourcePointCount: number;
    readonly revision: `hokusai-source-v1:${string}`;
  }>;
  readonly presetId: StudioHokusaiNaturalMediaPresetId;
  readonly materialProfileId: StudioHokusaiMaterialProfileId;
  readonly color: `#${string}`;
  readonly opacity: number;
  readonly seed: number;
  readonly logicalBounds: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly raster: Readonly<{
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly radiusPixels: number;
  }>;
  readonly samples: readonly StudioHokusaiNaturalMediaSample[];
}

export type StudioHokusaiNaturalMediaPlanResult =
  | Readonly<{
      readonly ok: true;
      readonly plan: StudioHokusaiNaturalMediaRenderPlan;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason:
        | "invalid-source"
        | "invalid-settings"
        | "empty-stroke"
        | "budget-exceeded";
      readonly message: string;
    }>;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const PRESET_IDS = new Set<string>(
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS.map(({ id }) => id),
);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxIdentityCodeUnits;
}

function isUint32(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffff_ffff;
}

function normalizedSettings(
  candidate: StudioHokusaiNaturalMediaSettings,
): (StudioHokusaiNaturalMediaSettings & Readonly<{
  materialProfileId: StudioHokusaiMaterialProfileId;
}>) | null {
  const materialProfileId = candidate.materialProfileId
    ?? studioHokusaiDefaultMaterialProfileId(candidate.presetId);
  if (
    !PRESET_IDS.has(candidate.presetId)
    || !studioHokusaiMaterialProfileIsCompatible(
      candidate.presetId,
      materialProfileId,
    )
    || typeof candidate.color !== "string"
    || !COLOR_PATTERN.test(candidate.color)
    || !Number.isFinite(candidate.sizeScale)
    || candidate.sizeScale < STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.minScale
    || candidate.sizeScale > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxScale
    || !Number.isFinite(candidate.opacity)
    || candidate.opacity <= 0
    || candidate.opacity > 1
    || !isUint32(candidate.seed)
  ) {
    return null;
  }
  return Object.freeze({
    presetId: candidate.presetId,
    materialProfileId,
    color: candidate.color.toLowerCase() as `#${string}`,
    sizeScale: candidate.sizeScale,
    opacity: candidate.opacity,
    seed: candidate.seed,
  });
}

function pressureAt(source: DrawEl, index: number): number {
  return clamp(finiteNumber(source.pressures?.[index], 0.5), 0, 1);
}

function fnv1a32(value: string, initial: number): number {
  let hash = initial >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash;
}

/**
 * Cheap synchronous optimistic-concurrency identity for the selected vector.
 * Cryptographic integrity is separately provided by the Worker receipt.
 */
export function studioHokusaiSourceRevision(
  source: DrawEl,
): `hokusai-source-v1:${string}` {
  const outlineResolution = resolveStudioOutlineStrokeContract(
    source.outlineStroke,
  );
  const outlineAuthority:
    | StudioOutlineStrokeContractV1
    | null
    | Readonly<{
        status: "unsupported";
        code: string;
        path: string;
      }> = outlineResolution.status === "ready"
      ? outlineResolution.contract
      : outlineResolution.status === "legacy"
        ? null
        : Object.freeze({
            status: "unsupported",
            code: outlineResolution.issue.code,
            path: outlineResolution.issue.path,
          });
  const canonical = JSON.stringify({
    id: source.id,
    kind: source.kind ?? "freehand",
    mode: source.mode ?? "pen",
    brush: source.brush ?? "pen",
    stroke: source.stroke,
    strokeWidth: source.strokeWidth,
    opacity: source.opacity ?? 1,
    outlineStroke: outlineAuthority,
    points: source.points,
    pressures: source.pressures ?? null,
    tiltXs: source.tiltXs ?? null,
    tiltYs: source.tiltYs ?? null,
    speeds: source.speeds ?? null,
  });
  const first = fnv1a32(canonical, 0x811c_9dc5)
    .toString(16)
    .padStart(8, "0");
  const second = fnv1a32(canonical, 0x9e37_79b9)
    .toString(16)
    .padStart(8, "0");
  return `hokusai-source-v1:${first}${second}`;
}

function tiltAt(
  values: readonly number[] | undefined,
  index: number,
): number {
  return clamp(finiteNumber(values?.[index], 0), -90, 90) / 90;
}

function sampleTimeMilliseconds(
  source: DrawEl,
  index: number,
  previousTime: number,
): number {
  if (index === 0) return 0;
  const previousX = source.points[(index - 1) * 2] ?? 0;
  const previousY = source.points[(index - 1) * 2 + 1] ?? 0;
  const x = source.points[index * 2] ?? previousX;
  const y = source.points[index * 2 + 1] ?? previousY;
  const distance = Math.hypot(x - previousX, y - previousY);
  const normalizedSpeed = clamp(
    finiteNumber(source.speeds?.[index], 0.5),
    0,
    64,
  );
  // Older documents do not persist event timestamps. Reconstruct a bounded,
  // deterministic delta from geometric distance and the captured speed hint.
  const nominalPixelsPerMillisecond = 0.2 + normalizedSpeed * 0.65;
  const delta = clamp(distance / nominalPixelsPerMillisecond, 1, 32);
  return previousTime + delta;
}

function invalid(
  reason: Exclude<
    StudioHokusaiNaturalMediaPlanResult,
    { readonly ok: true }
  >["reason"],
  message: string,
): StudioHokusaiNaturalMediaPlanResult {
  return Object.freeze({ ok: false, reason, message });
}

/**
 * Snapshots a vector stroke into a deterministic, crop-local Hokusai request.
 *
 * The source DrawEl remains the document authority until the verified PNG is
 * committed. This planner owns no Worker, WASM instance, pixels or history.
 */
export function planStudioHokusaiNaturalMediaRender(
  source: DrawEl,
  settingsCandidate: StudioHokusaiNaturalMediaSettings,
  document: Readonly<{ width: number; height: number }>,
): StudioHokusaiNaturalMediaPlanResult {
  const settings = normalizedSettings(settingsCandidate);
  if (!settings) {
    return invalid("invalid-settings", "자연매체 브러시 설정이 올바르지 않습니다.");
  }
  if (
    source.type !== "draw"
    || (source.kind ?? "freehand") !== "freehand"
    || source.mode === "eraser"
    || !boundedIdentity(source.id)
    || !boundedIdentity(source.brush ?? "pen")
    || !Array.isArray(source.points)
    || source.points.length < 4
    || source.points.length % 2 !== 0
    || !Number.isFinite(source.strokeWidth)
    || source.strokeWidth <= 0
    || !Number.isFinite(document.width)
    || !Number.isFinite(document.height)
    || document.width <= 0
    || document.height <= 0
  ) {
    return invalid(
      "invalid-source",
      "자연매체로 변환할 완성된 자유곡선 벡터 획을 선택해 주세요.",
    );
  }
  const outlineResolution = resolveStudioOutlineStrokeContract(
    source.outlineStroke,
  );
  if (outlineResolution.status === "unsupported") {
    return invalid(
      "invalid-source",
      `외곽선 획 계약을 자연매체 크기로 변환할 수 없습니다: ${
        outlineResolution.issue.message
      }`,
    );
  }
  const outlineDiameterScale = outlineResolution.status === "ready"
    ? outlineResolution.contract.profile.diameterScale
    : 1;
  const sourcePointCount = source.points.length / 2;
  if (
    sourcePointCount <= 1
    || sourcePointCount > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSamples
  ) {
    return invalid(
      sourcePointCount > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSamples
        ? "budget-exceeded"
        : "empty-stroke",
      "선택한 획의 샘플 수가 자연매체 렌더링 범위를 벗어났습니다.",
    );
  }

  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < source.points.length; index += 2) {
    const x = source.points[index];
    const y = source.points[index + 1];
    if (
      typeof x !== "number"
      || typeof y !== "number"
      || !Number.isFinite(x)
      || !Number.isFinite(y)
      || Math.abs(x)
        > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
      || Math.abs(y)
        > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
    ) {
      return invalid("invalid-source", "획에 유효하지 않은 좌표가 포함되어 있습니다.");
    }
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }

  const logicalRadius = clamp(
    source.strokeWidth * outlineDiameterScale * settings.sizeScale,
    STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.minLogicalSize,
    STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxLogicalSize,
  );
  // MyPaint-style random offsets, elliptical dabs and slow-tracking tails may
  // extend beyond the nominal radius. A six-radius halo remains bounded while
  // avoiding clipped charcoal grains and calligraphy corners.
  const margin = Math.max(8, Math.ceil(logicalRadius * 6 + 4));
  const left = clamp(Math.floor(minimumX - margin), 0, document.width);
  const top = clamp(Math.floor(minimumY - margin), 0, document.height);
  const right = clamp(Math.ceil(maximumX + margin), left + 1, document.width);
  const bottom = clamp(Math.ceil(maximumY + margin), top + 1, document.height);
  const logicalWidth = Math.max(1, right - left);
  const logicalHeight = Math.max(1, bottom - top);
  const scale = Math.min(
    1,
    STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension / logicalWidth,
    STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension / logicalHeight,
    Math.sqrt(
      STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPixels
        / (logicalWidth * logicalHeight),
    ),
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    return invalid("budget-exceeded", "획의 렌더링 영역이 너무 큽니다.");
  }
  const rasterWidth = Math.max(1, Math.ceil(logicalWidth * scale));
  const rasterHeight = Math.max(1, Math.ceil(logicalHeight * scale));
  const outputBytes = rasterWidth * rasterHeight * 4;
  if (
    rasterWidth > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || rasterHeight > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || rasterWidth * rasterHeight
      > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPixels
    || outputBytes > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxRgbaBytes
  ) {
    return invalid("budget-exceeded", "획의 렌더링 메모리 예산을 초과했습니다.");
  }

  const samples: StudioHokusaiNaturalMediaSample[] = [];
  let previousTime = 0;
  for (let index = 0; index < sourcePointCount; index += 1) {
    const timeMilliseconds = sampleTimeMilliseconds(
      source,
      index,
      previousTime,
    );
    previousTime = timeMilliseconds;
    samples.push(Object.freeze({
      x: ((source.points[index * 2] ?? left) - left) * scale,
      y: ((source.points[index * 2 + 1] ?? top) - top) * scale,
      pressure: pressureAt(source, index),
      tiltX: tiltAt(source.tiltXs, index),
      tiltY: tiltAt(source.tiltYs, index),
      timeMilliseconds,
    }));
  }

  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      kind: "studio-hokusai-natural-media/render-plan",
      version: STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
      engine: Object.freeze({
        id: "reearth-hokusai",
        version: STUDIO_HOKUSAI_RUNTIME_VERSION,
        brushFormat: "libmypaint-myb-v3",
        alpha: "transparent-straight-rgba8",
        execution: "dedicated-worker-wasm",
      }),
      source: Object.freeze({
        elementId: source.id,
        brushId: source.brush ?? "pen",
        sourcePointCount,
        revision: studioHokusaiSourceRevision(source),
      }),
      presetId: settings.presetId,
      materialProfileId: settings.materialProfileId,
      color: settings.color,
      opacity: settings.opacity * clamp(finiteNumber(source.opacity, 1), 0, 1),
      seed: settings.seed,
      logicalBounds: Object.freeze({
        x: left,
        y: top,
        width: logicalWidth,
        height: logicalHeight,
      }),
      raster: Object.freeze({
        width: rasterWidth,
        height: rasterHeight,
        scale,
        radiusPixels: logicalRadius * scale,
      }),
      samples: Object.freeze(samples),
    }),
  });
}
