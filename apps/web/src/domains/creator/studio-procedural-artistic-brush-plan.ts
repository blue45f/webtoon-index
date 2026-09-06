/**
 * Pure product planner for the isolated procedural-artistic brush provider.
 *
 * UI values are not forwarded directly to p5.brush. This boundary validates
 * every caller-owned field, applies a deliberately smaller product budget than
 * the provider's hard safety ceiling, generates bounded deterministic geometry,
 * and emits one settled-only request. It owns no Worker, surface, pixels,
 * document state, history, or provider lifecycle.
 */
import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
  estimateStudioProceduralArtisticBrushRasterMemory,
} from "./studio-procedural-artistic-brush-provider";

import type {
  StudioProceduralArtisticBrushParameter,
  StudioProceduralArtisticBrushRequest,
  StudioProceduralArtisticBrushSample,
  StudioProceduralArtisticBrushTechnique,
} from "./studio-procedural-artistic-brush-provider";

export type StudioProceduralArtisticBrushPlanTechnique = Extract<
  StudioProceduralArtisticBrushTechnique,
  | "flow-field"
  | "hatch"
  | "mass"
  | "watercolor-fill"
  | "flat-wash"
>;

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS = Object.freeze({
  minDimension: 32,
  maxDimension: 4_096,
  maxPixels: 16_777_216,
  minDensity: 1,
  maxDensity: 100,
  minAngleDegrees: -180,
  maxAngleDegrees: 180,
  minWeight: 0.1,
  maxWeight: 32,
  minStrength: 0,
  maxStrength: 1,
  maxPixelRatio: 4,
  maxGeneratedSamples: 64,
  minFlatWashOpacity: 0.01,
  watercolorFillOpacity: 0.72,
  maxUint32: 0xffff_ffff,
} as const);

export interface StudioProceduralArtisticBrushTechniqueDisplayMetadata {
  readonly technique: StudioProceduralArtisticBrushPlanTechnique;
  readonly label: string;
  readonly outputName: string;
  readonly description: string;
}

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_TECHNIQUE_METADATA:
Readonly<Record<
  StudioProceduralArtisticBrushPlanTechnique,
  StudioProceduralArtisticBrushTechniqueDisplayMetadata
>> = Object.freeze({
  "flow-field": Object.freeze({
    technique: "flow-field",
    label: "흐름장",
    outputName: "절차적 흐름장",
    description: "유기적인 흐름의 결정적 선 질감 레이어",
  }),
  hatch: Object.freeze({
    technique: "hatch",
    label: "해칭",
    outputName: "절차적 해칭",
    description: "일정한 밀도와 방향의 결정적 해칭 패턴 레이어",
  }),
  mass: Object.freeze({
    technique: "mass",
    label: "매스",
    outputName: "절차적 매스",
    description: "목탄처럼 밀도와 농담이 있는 덩어리 질감 레이어",
  }),
  "watercolor-fill": Object.freeze({
    technique: "watercolor-fill",
    label: "수채 채움",
    outputName: "절차적 수채 채움",
    description: "종이결과 가장자리 번짐이 살아 있는 결정적 수채 면 레이어",
  }),
  "flat-wash": Object.freeze({
    technique: "flat-wash",
    label: "플랫 워시",
    outputName: "절차적 플랫 워시",
    description: "균일한 투명도로 넓은 색면을 채우는 결정적 워시 레이어",
  }),
});

export interface StudioProceduralArtisticBrushPlanInput {
  readonly technique: StudioProceduralArtisticBrushPlanTechnique;
  readonly color: string;
  readonly density: number;
  /** Product UI angle in degrees. The adapter receives radians. */
  readonly angle: number;
  readonly weight: number;
  readonly strength: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly signal?: AbortSignal;
}

export interface StudioProceduralArtisticBrushPlanDisplay {
  readonly techniqueLabel: string;
  readonly name: string;
  readonly description: string;
  readonly settingsSummary: string;
}

/**
 * A planner success is narrower than the generic provider request: this
 * product path emits only settled, built-in procedural technique plans.
 */
export type StudioProceduralArtisticBrushPlannedRequest = Omit<
  StudioProceduralArtisticBrushRequest,
  "stage" | "plan"
> & Readonly<{
  stage: "settled";
  plan: Readonly<{
    technique: StudioProceduralArtisticBrushPlanTechnique;
    presetId: string;
    samples: readonly StudioProceduralArtisticBrushSample[];
    parameters: Readonly<
      Record<string, StudioProceduralArtisticBrushParameter>
    >;
  }>;
}>;

export type StudioProceduralArtisticBrushPlanFailureCode =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-technique"
  | "invalid-color"
  | "invalid-density"
  | "invalid-angle"
  | "invalid-weight"
  | "invalid-strength"
  | "invalid-seed"
  | "invalid-dimensions"
  | "dimension-budget-exceeded"
  | "invalid-pixel-ratio"
  | "invalid-request-sequence"
  | "invalid-engine-epoch"
  | "invalid-stroke-id"
  | "invalid-signal"
  | "sample-budget-exceeded";

export interface StudioProceduralArtisticBrushPlanFailure {
  readonly ok: false;
  readonly code: StudioProceduralArtisticBrushPlanFailureCode;
  readonly path: string;
  readonly message: string;
}

export interface StudioProceduralArtisticBrushPlanSuccess {
  readonly ok: true;
  readonly request: StudioProceduralArtisticBrushPlannedRequest;
  readonly display: StudioProceduralArtisticBrushPlanDisplay;
}

export type StudioProceduralArtisticBrushPlanResult =
  | StudioProceduralArtisticBrushPlanFailure
  | StudioProceduralArtisticBrushPlanSuccess;

type UnknownRecord = Record<string, unknown>;
type InspectionResult =
  | Readonly<{ readonly ok: true; readonly value: UnknownRecord }>
  | StudioProceduralArtisticBrushPlanFailure;

const REQUIRED_INPUT_KEYS = [
  "technique",
  "color",
  "density",
  "angle",
  "weight",
  "strength",
  "seed",
  "width",
  "height",
  "pixelRatio",
  "requestSequence",
  "engineEpoch",
  "strokeId",
] as const;
const OPTIONAL_INPUT_KEYS = ["signal"] as const;
const INPUT_KEYS = new Set<string>([
  ...REQUIRED_INPUT_KEYS,
  ...OPTIONAL_INPUT_KEYS,
]);
const TECHNIQUES = new Set<StudioProceduralArtisticBrushPlanTechnique>([
  "flow-field",
  "hatch",
  "mass",
  "watercolor-fill",
  "flat-wash",
]);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const TWO_PI = Math.PI * 2;

function fail(
  code: StudioProceduralArtisticBrushPlanFailureCode,
  path: string,
  message: string,
): StudioProceduralArtisticBrushPlanFailure {
  return Object.freeze({ ok: false, code, path, message });
}

/**
 * Reads property descriptors before values so hostile accessors are rejected
 * without invoking their getters.
 */
function inspectInput(
  input: unknown,
): InspectionResult {
  try {
    if (
      typeof input !== "object"
      || input === null
      || Array.isArray(input)
      || (
        Object.getPrototypeOf(input) !== Object.prototype
        && Object.getPrototypeOf(input) !== null
      )
    ) {
      return fail("not-plain-data", "$", "설정은 일반 데이터 객체여야 합니다.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) {
      return fail("not-plain-data", "$", "심볼 설정은 사용할 수 없습니다.");
    }
    const output: UnknownRecord = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return fail(
          "not-plain-data",
          `$.${key}`,
          "접근자나 숨김 설정은 사용할 수 없습니다.",
        );
      }
      if (!INPUT_KEYS.has(key)) {
        return fail("unknown-field", `$.${key}`, "알 수 없는 설정입니다.");
      }
      output[key] = descriptor.value;
    }
    for (const key of REQUIRED_INPUT_KEYS) {
      if (!Object.hasOwn(descriptors, key)) {
        return fail("not-plain-data", `$.${key}`, "필수 설정이 없습니다.");
      }
    }
    return Object.freeze({ ok: true, value: output });
  } catch {
    return fail("not-plain-data", "$", "설정 객체를 안전하게 읽을 수 없습니다.");
  }
}

function isIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isFiniteBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Stateless 32-bit mixer: the same seed/index pair always returns [0, 1). */
function seededUnit(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e37_79b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function sample(
  x: number,
  y: number,
  pressure: number,
  index: number,
  seed: number,
): StudioProceduralArtisticBrushSample {
  return Object.freeze({
    x: roundCoordinate(x),
    y: roundCoordinate(y),
    pressure: roundCoordinate(clamp(pressure, 0.01, 1)),
    tiltX: roundCoordinate(-24 + seededUnit(seed, index * 3 + 1) * 48),
    tiltY: roundCoordinate(-24 + seededUnit(seed, index * 3 + 2) * 48),
    timeMilliseconds: index * 8,
  });
}

function flowSamples(
  width: number,
  height: number,
  density: number,
  strength: number,
  seed: number,
): readonly StudioProceduralArtisticBrushSample[] {
  const count = clamp(Math.round(8 + density * 0.3), 8, 40);
  const marginX = Math.max(2, width * 0.08);
  const marginY = Math.max(2, height * 0.14);
  const usableWidth = width - marginX * 2;
  const centerY = height / 2;
  const amplitude = Math.max(
    1,
    Math.min(height * 0.28, height / 2 - marginY)
      * (0.35 + strength * 0.65),
  );
  const phase = seededUnit(seed, 0) * TWO_PI;
  const waveCount = 1.25 + (density / 100) * 2.25;
  const jitter = Math.min(height * 0.025, 6);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const progress = count === 1 ? 0 : index / (count - 1);
      const x = marginX + usableWidth * progress;
      const y = centerY
        + Math.sin(phase + progress * TWO_PI * waveCount) * amplitude
        + (seededUnit(seed, index + 11) - 0.5) * jitter;
      const pressure = 0.2
        + strength * 0.65
        + (seededUnit(seed, index + 73) - 0.5) * 0.08;
      return sample(
        clamp(x, 0, width),
        clamp(y, 0, height),
        pressure,
        index,
        seed,
      );
    }),
  );
}

function boundaryPolygonSamples(
  width: number,
  height: number,
  seed: number,
): readonly StudioProceduralArtisticBrushSample[] {
  const insetX = Math.max(2, width * 0.06);
  const insetY = Math.max(2, height * 0.06);
  const left = insetX;
  const right = width - insetX;
  const top = insetY;
  const bottom = height - insetY;
  const middleX = width / 2;
  const middleY = height / 2;
  const jitterX = Math.min(width * 0.012, 4);
  const jitterY = Math.min(height * 0.012, 4);
  const vertices = [
    [left, top],
    [middleX, top],
    [right, top],
    [right, middleY],
    [right, bottom],
    [middleX, bottom],
    [left, bottom],
    [left, middleY],
  ] as const;
  return Object.freeze(vertices.map(([baseX, baseY], index) => {
    const x = baseX + (seededUnit(seed, index + 101) - 0.5) * jitterX;
    const y = baseY + (seededUnit(seed, index + 131) - 0.5) * jitterY;
    return sample(
      clamp(x, 0, width),
      clamp(y, 0, height),
      0.68 + seededUnit(seed, index + 151) * 0.18,
      index,
      seed,
    );
  }));
}

function massSamples(
  width: number,
  height: number,
  density: number,
  strength: number,
  seed: number,
): readonly StudioProceduralArtisticBrushSample[] {
  const count = clamp(Math.round(8 + density * 0.16), 8, 24);
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(2, width * 0.4);
  const radiusY = Math.max(2, height * 0.4);
  const phase = seededUnit(seed, 211) * TWO_PI;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const angle = phase + (index / count) * TWO_PI;
      const radiusScale = 0.88 + seededUnit(seed, index + 223) * 0.12;
      const x = centerX + Math.cos(angle) * radiusX * radiusScale;
      const y = centerY + Math.sin(angle) * radiusY * radiusScale;
      const pressure = 0.28
        + strength * 0.62
        + seededUnit(seed, index + 257) * 0.08;
      return sample(
        clamp(x, 0, width),
        clamp(y, 0, height),
        pressure,
        index,
        seed,
      );
    }),
  );
}

function parametersFor(
  technique: StudioProceduralArtisticBrushPlanTechnique,
  color: string,
  density: number,
  angle: number,
  weight: number,
  strength: number,
  seed: number,
): Readonly<Record<string, StudioProceduralArtisticBrushParameter>> {
  switch (technique) {
    case "flow-field":
      return Object.freeze({
        brush: "HB",
        color,
        curvature: strength,
        field: "waves",
        fieldTime: roundCoordinate((seed % 100_000) / 1_000),
        weight,
      });
    case "hatch":
      return Object.freeze({
        angle: roundCoordinate(angle * Math.PI / 180),
        brush: "pen",
        color,
        continuous: false,
        distance: roundCoordinate(2 + ((100 - density) / 99) * 22),
        gradient: 0.08,
        randomness: 0.06,
        weight,
      });
    case "mass":
      return Object.freeze({
        brush: "charcoal",
        color,
        gradient: roundCoordinate(0.08 + (1 - strength) * 0.12),
        outline: false,
        precision: roundCoordinate(0.35 + (density / 100) * 0.65),
        strength,
      });
    case "watercolor-fill":
      return Object.freeze({
        angle: roundCoordinate(angle * Math.PI / 180),
        color,
        density: roundCoordinate(density / 100),
        opacity:
          STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS
            .watercolorFillOpacity,
        strength,
      });
    case "flat-wash":
      return Object.freeze({
        color,
        opacity: roundCoordinate(clamp(
          strength,
          STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS
            .minFlatWashOpacity,
          1,
        )),
      });
  }
}

function samplesFor(
  technique: StudioProceduralArtisticBrushPlanTechnique,
  width: number,
  height: number,
  density: number,
  strength: number,
  seed: number,
): readonly StudioProceduralArtisticBrushSample[] {
  switch (technique) {
    case "flow-field":
      return flowSamples(width, height, density, strength, seed);
    case "hatch":
      return boundaryPolygonSamples(width, height, seed);
    case "mass":
      return massSamples(width, height, density, strength, seed);
    case "watercolor-fill":
    case "flat-wash":
      return boundaryPolygonSamples(width, height, seed);
  }
}

function presetId(
  technique: StudioProceduralArtisticBrushPlanTechnique,
): string {
  return `studio-procedural-${technique}-v1`;
}

function settingsSummary(
  technique: StudioProceduralArtisticBrushPlanTechnique,
  density: number,
  angle: number,
  weight: number,
  strength: number,
  seed: number,
): string {
  switch (technique) {
    case "flow-field":
      return `밀도 ${Math.round(density)}% · 굵기 ${weight.toFixed(1)}px · 강도 ${Math.round(strength * 100)}% · 시드 ${seed}`;
    case "hatch":
      return `밀도 ${Math.round(density)}% · 방향 ${Math.round(angle)}° · 굵기 ${weight.toFixed(1)}px · 시드 ${seed}`;
    case "mass":
      return `밀도 ${Math.round(density)}% · 강도 ${Math.round(strength * 100)}% · 시드 ${seed}`;
    case "watercolor-fill":
      return `종이 질감 ${Math.round(density)}% · 번짐 ${Math.round(strength * 100)}% · 방향 ${Math.round(angle)}° · 시드 ${seed}`;
    case "flat-wash":
      return `불투명도 ${Math.round(clamp(
        strength,
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minFlatWashOpacity,
        1,
      ) * 100)}% · 시드 ${seed}`;
  }
}

export function planStudioProceduralArtisticBrushRequest(
  input: unknown,
): StudioProceduralArtisticBrushPlanResult {
  const inspected = inspectInput(input);
  if (!inspected.ok) return inspected;

  const {
    technique,
    color,
    density,
    angle,
    weight,
    strength,
    seed,
    width,
    height,
    pixelRatio,
    requestSequence,
    engineEpoch,
    strokeId,
    signal,
  } = inspected.value;

  if (
    typeof technique !== "string"
    || !TECHNIQUES.has(
      technique as StudioProceduralArtisticBrushPlanTechnique,
    )
  ) {
    return fail("invalid-technique", "$.technique", "지원하지 않는 절차적 기법입니다.");
  }
  const normalizedTechnique =
    technique as StudioProceduralArtisticBrushPlanTechnique;
  if (typeof color !== "string" || !COLOR_PATTERN.test(color)) {
    return fail(
      "invalid-color",
      "$.color",
      "색상은 #RRGGBB 형식이어야 합니다.",
    );
  }
  if (
    !isFiniteBetween(
      density,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minDensity,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxDensity,
    )
  ) {
    return fail("invalid-density", "$.density", "밀도는 1~100이어야 합니다.");
  }
  if (
    !isFiniteBetween(
      angle,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minAngleDegrees,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxAngleDegrees,
    )
  ) {
    return fail("invalid-angle", "$.angle", "각도는 -180°~180°여야 합니다.");
  }
  if (
    !isFiniteBetween(
      weight,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minWeight,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxWeight,
    )
  ) {
    return fail("invalid-weight", "$.weight", "선 굵기는 0.1~32px여야 합니다.");
  }
  if (
    !isFiniteBetween(
      strength,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minStrength,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxStrength,
    )
  ) {
    return fail("invalid-strength", "$.strength", "강도는 0~1이어야 합니다.");
  }
  if (
    !isIntegerBetween(
      seed,
      0,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxUint32,
    )
  ) {
    return fail("invalid-seed", "$.seed", "시드는 uint32 정수여야 합니다.");
  }
  if (
    !isIntegerBetween(width, 1, Number.MAX_SAFE_INTEGER)
    || !isIntegerBetween(height, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return fail(
      "invalid-dimensions",
      "$.width",
      "렌더 크기는 양의 안전한 정수여야 합니다.",
    );
  }
  const pixelCount = width * height;
  if (
    width < STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minDimension
    || height < STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.minDimension
    || width > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxDimension
    || height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxDimension
    || !Number.isSafeInteger(pixelCount)
    || pixelCount
      > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxPixels
    || estimateStudioProceduralArtisticBrushRasterMemory(
      width,
      height,
      normalizedTechnique,
    ) === null
  ) {
    return fail(
      "dimension-budget-exceeded",
      "$.width",
      "절차적 질감의 보수적 렌더 크기 예산을 초과했습니다.",
    );
  }
  if (
    !isFiniteBetween(
      pixelRatio,
      Number.MIN_VALUE,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxPixelRatio,
    )
  ) {
    return fail(
      "invalid-pixel-ratio",
      "$.pixelRatio",
      "픽셀 배율은 0보다 크고 4 이하여야 합니다.",
    );
  }
  if (!isIntegerBetween(requestSequence, 1, Number.MAX_SAFE_INTEGER)) {
    return fail(
      "invalid-request-sequence",
      "$.requestSequence",
      "요청 순번은 양의 안전한 정수여야 합니다.",
    );
  }
  if (!isIntegerBetween(engineEpoch, 1, Number.MAX_SAFE_INTEGER)) {
    return fail(
      "invalid-engine-epoch",
      "$.engineEpoch",
      "엔진 epoch는 양의 안전한 정수여야 합니다.",
    );
  }
  if (
    typeof strokeId !== "string"
    || strokeId.length === 0
    || strokeId.length
      > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits
    || !SAFE_IDENTIFIER.test(strokeId)
  ) {
    return fail(
      "invalid-stroke-id",
      "$.strokeId",
      "획 ID는 안전한 ASCII 식별자여야 합니다.",
    );
  }
  if (
    signal !== undefined
    && (
      typeof AbortSignal === "undefined"
      || !(signal instanceof AbortSignal)
    )
  ) {
    return fail(
      "invalid-signal",
      "$.signal",
      "취소 신호는 AbortSignal이어야 합니다.",
    );
  }

  const samples = samplesFor(
    normalizedTechnique,
    width,
    height,
    density,
    strength,
    seed,
  );
  if (
    samples.length === 0
    || samples.length
      > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxGeneratedSamples
    || samples.length > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxSamples
  ) {
    return fail(
      "sample-budget-exceeded",
      "$.density",
      "생성된 샘플이 안전 예산을 초과했습니다.",
    );
  }
  const parameters = parametersFor(
    normalizedTechnique,
    color.toLowerCase(),
    density,
    angle,
    weight,
    strength,
    seed,
  );
  const plan = Object.freeze({
    technique: normalizedTechnique,
    presetId: presetId(normalizedTechnique),
    samples,
    parameters,
  });
  const request: StudioProceduralArtisticBrushPlannedRequest = Object.freeze({
    kind: "studio-procedural-artistic-brush/request",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
    requestSequence,
    engineEpoch,
    strokeId,
    stage: "settled",
    seed,
    width,
    height,
    pixelRatio,
    plan,
    ...(signal === undefined ? {} : { signal }),
  });
  const metadata =
    STUDIO_PROCEDURAL_ARTISTIC_BRUSH_TECHNIQUE_METADATA[normalizedTechnique];
  return Object.freeze({
    ok: true,
    request,
    display: Object.freeze({
      techniqueLabel: metadata.label,
      name: `${metadata.outputName} · 시드 ${seed}`,
      description: metadata.description,
      settingsSummary: settingsSummary(
        normalizedTechnique,
        density,
        angle,
        weight,
        strength,
        seed,
      ),
    }),
  });
}
