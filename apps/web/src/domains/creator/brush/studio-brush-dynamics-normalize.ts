import {
  STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
  isStudioDryMediaUnionComposableProgramPin,
  isStudioDryMediaKernelDabProgramPin,
  isStudioSoftFalloffLinearAccumulationProgramPin,
  isStudioDynamicBrushCausalDepositPipeline,
  type StudioDryMediaUnionProgramPin,
  type StudioDryMediaKernelProgramPin,
  type StudioSoftFalloffLinearProgramPin,
} from "./studio-brush-dynamics-program-pins";
import {
  MAX_POINTER_SPEED,
  STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS,
  STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS,
  STUDIO_BRUSH_TAPER_LIMITS,
  isStudioBrushDynamicsPresetId,
  type NormalizedStudioBrushDynamicsJitter,
  type NormalizedStudioBrushDynamicsMapping,
  type NormalizedStudioBrushDynamicsProperty,
  type NormalizedStudioBrushDynamicsSample,
  type NormalizedStudioBrushDynamicsSettings,
  type NormalizedStudioBrushTaperSettings,
  type StudioBrushDynamicsMappingMode,
  type StudioBrushDynamicsRecipe,
  type StudioBrushDynamicsSample,
  type StudioBrushDynamicsSettings,
  type StudioBrushDynamicsSource,
} from "./studio-brush-dynamics-types";
import {
  normalizeStudioBrushColorDynamicsSettings,
  normalizeStudioBrushGrainSettings,
} from "./studio-brush-material-dynamics";
import {
  normalizeStudioBrushDualBrushSettings,
  normalizeStudioBrushTipLayers,
  studioBrushDualBrushSettingsAreIdentity,
  type NormalizedStudioBrushDualBrushSettings,
  type NormalizedStudioBrushTipLayerSettings,
} from "./studio-brush-tip-composition";
import {
  normalizeStudioBrushTipSettings,
  type NormalizedStudioBrushTipSettings,
} from "./studio-brush-tip-stamp";

const MAX_MAPPING_COUNT = 24;
const MAX_ADDITIVE_MAPPING = 8192;
const MAX_UINT32 = 0xffff_ffff;
const TAU = Math.PI * 2;

type DynamicsPropertyName = keyof typeof STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS;

const PROPERTY_NAMES: readonly DynamicsPropertyName[] = [
  "width",
  "opacity",
  "flow",
  "spacing",
  "scatter",
  "angle",
  "roundness",
];

const PROPERTY_SALTS: Record<DynamicsPropertyName, number> = {
  width: 0x91e1_0da5,
  opacity: 0x6a09_e667,
  flow: 0xbb67_ae85,
  spacing: 0x3c6e_f372,
  scatter: 0xa54f_f53a,
  angle: 0x510e_527f,
  roundness: 0x9b05_688c,
};

const INTERNAL_DEFAULT_TAPER: NormalizedStudioBrushTaperSettings = {
  enabled: false,
  startLength: 0.12,
  endLength: 0.18,
  minSizeRatio: 0.2,
  minOpacityRatio: 0.55,
  curve: 1,
};

export const INTERNAL_DEFAULT_SETTINGS: NormalizedStudioBrushDynamicsSettings = {
  version: STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
  seed: 1,
  fallbackPressure: 0.5,
  maxSpeed: 1.6,
  spacingRatio: 0.34,
  scatterRatio: null,
  taper: { ...INTERNAL_DEFAULT_TAPER },
  tip: normalizeStudioBrushTipSettings(),
  colorDynamics: normalizeStudioBrushColorDynamicsSettings(),
  grain: normalizeStudioBrushGrainSettings(),
  tipLayers: [],
  width: {
    base: 6,
    min: STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.min,
    max: STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.max,
    // Existing G-pen behavior: p=0 -> 0.3x, p=.5 -> 1x, p=1 -> 1.7x.
    mappings: [
      { source: "pressure", mode: "multiply", from: 0.3, to: 1.7, amount: 1, curve: 1, invert: false },
    ],
    jitter: null,
  },
  opacity: { base: 1, min: 0, max: 1, mappings: [], jitter: null },
  flow: { base: 1, min: 0, max: 1, mappings: [], jitter: null },
  spacing: { base: 2.04, min: 0.25, max: 4096, mappings: [], jitter: null },
  scatter: { base: 0, min: 0, max: 4096, mappings: [], jitter: null },
  angle: {
    base: 0,
    min: -180,
    max: 180,
    // Particle tips follow the stroke tangent unless the caller explicitly supplies mappings: [].
    mappings: [
      { source: "direction", mode: "add", from: 0, to: 360, amount: 1, curve: 1, invert: false },
    ],
    jitter: null,
  },
  roundness: { base: 1, min: 0.08, max: 1, mappings: [], jitter: null },
};

export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeSignedDegrees(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

export function normalizeUnsignedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizedAngle(value: number): number {
  return ((value % 360) + 360) % 360 / 360;
}

export function uint32(value: unknown, fallback: number): number {
  return Math.trunc(clamp(finiteNumber(value, fallback), 0, MAX_UINT32));
}

function cloneMapping(mapping: NormalizedStudioBrushDynamicsMapping): NormalizedStudioBrushDynamicsMapping {
  const result = { ...mapping };
  if (mapping.curveLUT) {
    Object.defineProperty(result, 'curveLUT', {
      value: mapping.curveLUT,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function cloneProperty(property: NormalizedStudioBrushDynamicsProperty): NormalizedStudioBrushDynamicsProperty {
  return {
    ...property,
    mappings: property.mappings.map(cloneMapping),
    jitter: property.jitter ? { ...property.jitter } : null,
  };
}

export function cloneTaper(taper: NormalizedStudioBrushTaperSettings): NormalizedStudioBrushTaperSettings {
  return { ...taper };
}

export function cloneTip(tip: NormalizedStudioBrushTipSettings): NormalizedStudioBrushTipSettings {
  return { ...tip };
}

export function cloneTipLayers(
  layers: readonly NormalizedStudioBrushTipLayerSettings[]
): readonly NormalizedStudioBrushTipLayerSettings[] {
  return layers.map((layer) => ({ ...layer, tip: cloneTip(layer.tip) }));
}

export function cloneDualBrush(
  dualBrush: NormalizedStudioBrushDualBrushSettings
): NormalizedStudioBrushDualBrushSettings {
  return { ...dualBrush, tip: cloneTip(dualBrush.tip) };
}

export function cloneNormalizedSettings(
  settings: NormalizedStudioBrushDynamicsSettings
): NormalizedStudioBrushDynamicsSettings {
  return {
    version: STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
    ...(settings.depositPipeline
      ? { depositPipeline: settings.depositPipeline }
      : {}),
    ...(settings.dryMediaUnionProgram
      ? { dryMediaUnionProgram: { ...settings.dryMediaUnionProgram } }
      : {}),
    ...(settings.dryMediaKernelProgram
      ? { dryMediaKernelProgram: { ...settings.dryMediaKernelProgram } }
      : {}),
    ...(settings.softFalloffLinearProgram
      ? { softFalloffLinearProgram: { ...settings.softFalloffLinearProgram } }
      : {}),
    ...(settings.causalStampGridRule
      ? { causalStampGridRule: settings.causalStampGridRule }
      : {}),
    seed: settings.seed,
    fallbackPressure: settings.fallbackPressure,
    maxSpeed: settings.maxSpeed,
    ...(settings.minimumDiameterRatio !== undefined
      ? { minimumDiameterRatio: settings.minimumDiameterRatio }
      : {}),
    spacingRatio: settings.spacingRatio,
    scatterRatio: settings.scatterRatio,
    taper: cloneTaper(settings.taper),
    tip: cloneTip(settings.tip),
    colorDynamics: { ...settings.colorDynamics },
    grain: { ...settings.grain },
    tipLayers: cloneTipLayers(settings.tipLayers),
    ...(settings.dualBrush ? { dualBrush: cloneDualBrush(settings.dualBrush) } : {}),
    width: cloneProperty(settings.width),
    opacity: cloneProperty(settings.opacity),
    flow: cloneProperty(settings.flow),
    spacing: cloneProperty(settings.spacing),
    scatter: cloneProperty(settings.scatter),
    angle: cloneProperty(settings.angle),
    roundness: cloneProperty(settings.roundness),
  };
}

function normalizeTaper(value: unknown): NormalizedStudioBrushTaperSettings {
  if (value === null) return cloneTaper(INTERNAL_DEFAULT_TAPER);
  const source = asRecord(value);
  if (!source) return cloneTaper(INTERNAL_DEFAULT_TAPER);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : INTERNAL_DEFAULT_TAPER.enabled,
    startLength: clamp(
      finiteNumber(source.startLength, INTERNAL_DEFAULT_TAPER.startLength),
      STUDIO_BRUSH_TAPER_LIMITS.length.min,
      STUDIO_BRUSH_TAPER_LIMITS.length.max
    ),
    endLength: clamp(
      finiteNumber(source.endLength, INTERNAL_DEFAULT_TAPER.endLength),
      STUDIO_BRUSH_TAPER_LIMITS.length.min,
      STUDIO_BRUSH_TAPER_LIMITS.length.max
    ),
    minSizeRatio: clamp(
      finiteNumber(source.minSizeRatio, INTERNAL_DEFAULT_TAPER.minSizeRatio),
      STUDIO_BRUSH_TAPER_LIMITS.minSizeRatio.min,
      STUDIO_BRUSH_TAPER_LIMITS.minSizeRatio.max
    ),
    minOpacityRatio: clamp(
      finiteNumber(source.minOpacityRatio, INTERNAL_DEFAULT_TAPER.minOpacityRatio),
      STUDIO_BRUSH_TAPER_LIMITS.minOpacityRatio.min,
      STUDIO_BRUSH_TAPER_LIMITS.minOpacityRatio.max
    ),
    curve: clamp(
      finiteNumber(source.curve, INTERNAL_DEFAULT_TAPER.curve),
      STUDIO_BRUSH_TAPER_LIMITS.curve.min,
      STUDIO_BRUSH_TAPER_LIMITS.curve.max
    ),
  };
}

/**
 * Multiplier for size/opacity at a given arc-length progress (0=start, 1=end).
 * Disabled taper returns 1 for both channels.
 */
export function studioBrushTaperFactors(
  progress: number,
  taper: NormalizedStudioBrushTaperSettings
): { size: number; opacity: number } {
  if (!taper.enabled) return { size: 1, opacity: 1 };
  const tProgress = clamp01(progress);
  let size = 1;
  let opacity = 1;

  const applyZone = (distanceFromTip: number, zoneLength: number) => {
    if (zoneLength <= 0) return;
    if (distanceFromTip >= zoneLength) return;
    const linear = clamp01(distanceFromTip / zoneLength);
    const eased = Math.pow(linear, taper.curve);
    size *= taper.minSizeRatio + (1 - taper.minSizeRatio) * eased;
    opacity *= taper.minOpacityRatio + (1 - taper.minOpacityRatio) * eased;
  };

  applyZone(tProgress, taper.startLength);
  applyZone(1 - tProgress, taper.endLength);
  return {
    size: clamp(size, 0, 8),
    opacity: clamp01(opacity),
  };
}

function normalizeRatio(
  source: Record<string, unknown>,
  ratioKey: "spacingRatio" | "scatterRatio",
  propertyKey: "spacing" | "scatter",
  fallback: number | null,
  min: number,
  max: number
): number | null {
  if (source[ratioKey] === null) return null;
  if (source[ratioKey] !== undefined) {
    return clamp(finiteNumber(source[ratioKey], fallback ?? min), min, max);
  }
  const property = asRecord(source[propertyKey]);
  // Existing absolute-px settings remain meaningful: an explicit base opts out of ratio mode.
  if (property && typeof property.base === "number" && Number.isFinite(property.base)) return null;
  return fallback;
}

function isDynamicsSource(value: unknown): value is StudioBrushDynamicsSource {
  return value === "pressure"
    || value === "tangential-pressure"
    || value === "speed"
    || value === "tilt"
    || value === "tilt-magnitude"
    || value === "tilt-azimuth"
    || value === "twist"
    || value === "direction";
}

function getBezierCoordinate(t: number, c1: number, c2: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  return 3 * c1 * mt2 * t + 3 * c2 * mt * t2 + t3;
}

function getBezierDerivative(t: number, c1: number, c2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * c1 + 6 * mt * t * (c2 - c1) + 3 * t * t * (1 - c2);
}

export function evaluateCubicBezierCurve(x: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (p1x === p1y && p2x === p2y) return x;

  let t = x;
  for (let i = 0; i < 8; i++) {
    const currentX = getBezierCoordinate(t, p1x, p2x);
    const dx = getBezierDerivative(t, p1x, p2x);
    if (Math.abs(currentX - x) < 1e-6) break;
    if (dx === 0) break;
    t -= (currentX - x) / dx;
  }
  
  t = clamp01(t);
  return getBezierCoordinate(t, p1y, p2y);
}

function normalizeMapping(value: unknown): NormalizedStudioBrushDynamicsMapping | null {
  const source = asRecord(value);
  if (!source || !isDynamicsSource(source.source)) return null;

  const mode: StudioBrushDynamicsMappingMode = source.mode === "add" ? "add" : "multiply";
  const mappingLimit = mode === "multiply" ? 8 : MAX_ADDITIVE_MAPPING;
  const mappingMin = mode === "multiply" ? 0 : -mappingLimit;
  
  const curveMode = source.curveMode === "bezier" ? "bezier" : "power";
  let curveControlPoints: readonly [number, number, number, number] = [0.25, 0.1, 0.25, 1];
  let curveLUT: Float32Array | null = null;
  
  if (curveMode === "bezier") {
    if (Array.isArray(source.curveControlPoints) && source.curveControlPoints.length >= 4) {
      curveControlPoints = [
        clamp(finiteNumber(source.curveControlPoints[0], 0), 0, 1),
        finiteNumber(source.curveControlPoints[1], 0),
        clamp(finiteNumber(source.curveControlPoints[2], 1), 0, 1),
        finiteNumber(source.curveControlPoints[3], 1),
      ] as const;
    }
    
    curveLUT = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      curveLUT[i] = evaluateCubicBezierCurve(i / 255, curveControlPoints[0], curveControlPoints[1], curveControlPoints[2], curveControlPoints[3]);
    }
  }

  const result: NormalizedStudioBrushDynamicsMapping = {
    source: source.source,
    mode,
    from: clamp(finiteNumber(source.from, 0), mappingMin, mappingLimit),
    to: clamp(finiteNumber(source.to, 1), mappingMin, mappingLimit),
    amount: clamp01(finiteNumber(source.amount, 1)),
    curve: clamp(finiteNumber(source.curve, 1), 0.05, 8),
    invert: typeof source.invert === "boolean" ? source.invert : false,
  };

  if (curveMode === "bezier") {
    result.curveMode = "bezier";
    result.curveControlPoints = curveControlPoints;
    if (curveLUT) {
      Object.defineProperty(result, 'curveLUT', {
        value: curveLUT,
        enumerable: false, // Prevents JSON.stringify from including it, and keeps deep equality clean
        configurable: true,
        writable: true
      });
    }
  }

  return result;
}

function normalizeJitter(value: unknown): NormalizedStudioBrushDynamicsJitter | null {
  const source = asRecord(value);
  if (!source) return null;
  const mode: StudioBrushDynamicsMappingMode = source.mode === "add" ? "add" : "multiply";
  const maximum = mode === "multiply" ? 1 : MAX_ADDITIVE_MAPPING;
  const amount = clamp(finiteNumber(source.amount, 0), 0, maximum);
  return amount > 0 ? { mode, amount } : null;
}

function normalizeProperty(
  value: unknown,
  fallback: NormalizedStudioBrushDynamicsProperty,
  propertyName: DynamicsPropertyName
): NormalizedStudioBrushDynamicsProperty {
  const source = asRecord(value);
  if (!source) return cloneProperty(fallback);

  const hardLimits = STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS[propertyName];
  const firstBound = clamp(finiteNumber(source.min, fallback.min), hardLimits.min, hardLimits.max);
  const secondBound = clamp(finiteNumber(source.max, fallback.max), hardLimits.min, hardLimits.max);
  const min = Math.min(firstBound, secondBound);
  const max = Math.max(firstBound, secondBound);
  const base = clamp(finiteNumber(source.base, fallback.base), min, max);

  let mappings: readonly NormalizedStudioBrushDynamicsMapping[];
  if (source.mappings === undefined) {
    mappings = fallback.mappings.map(cloneMapping);
  } else if (Array.isArray(source.mappings)) {
    mappings = source.mappings
      .slice(0, MAX_MAPPING_COUNT)
      .map(normalizeMapping)
      .filter((mapping): mapping is NormalizedStudioBrushDynamicsMapping => mapping !== null);
  } else {
    mappings = fallback.mappings.map(cloneMapping);
  }

  const jitter = source.jitter === undefined
    ? (fallback.jitter ? { ...fallback.jitter } : null)
    : normalizeJitter(source.jitter);
  return { base, min, max, mappings, jitter };
}

/** Sanitizes partial/corrupt persisted settings into finite renderer-safe ranges. */
export function normalizeStudioBrushDynamicsSettings(value?: unknown): NormalizedStudioBrushDynamicsSettings {
  const source = asRecord(value) ?? {};
  const widthValue = source.width === undefined ? source.size : source.width;
  const width = normalizeProperty(widthValue, INTERNAL_DEFAULT_SETTINGS.width, "width");
  const spacingRatio = normalizeRatio(
    source,
    "spacingRatio",
    "spacing",
    INTERNAL_DEFAULT_SETTINGS.spacingRatio,
    STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS.spacing.min,
    STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS.spacing.max
  );
  const scatterRatio = normalizeRatio(
    source,
    "scatterRatio",
    "scatter",
    INTERNAL_DEFAULT_SETTINGS.scatterRatio,
    STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS.scatter.min,
    STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS.scatter.max
  );
  const spacing = normalizeProperty(source.spacing, INTERNAL_DEFAULT_SETTINGS.spacing, "spacing");
  const scatter = normalizeProperty(source.scatter, INTERNAL_DEFAULT_SETTINGS.scatter, "scatter");
  const tip = normalizeStudioBrushTipSettings(source.tip);
  const dualBrush = normalizeStudioBrushDualBrushSettings(source.dualBrush, tip);
  let dryMediaUnionProgram: StudioDryMediaUnionProgramPin | undefined;
  if (source.dryMediaUnionProgram !== undefined) {
    if (!isStudioDryMediaUnionComposableProgramPin(source.dryMediaUnionProgram)) {
      throw new TypeError("Unsupported dry-media union program pin.");
    }
    dryMediaUnionProgram = { ...source.dryMediaUnionProgram };
  }
  let dryMediaKernelProgram: StudioDryMediaKernelProgramPin | undefined;
  if (source.dryMediaKernelProgram !== undefined) {
    if (!isStudioDryMediaKernelDabProgramPin(source.dryMediaKernelProgram)) {
      throw new TypeError("Unsupported dry-media kernel program pin.");
    }
    dryMediaKernelProgram = { ...source.dryMediaKernelProgram };
  }
  let softFalloffLinearProgram: StudioSoftFalloffLinearProgramPin | undefined;
  if (source.softFalloffLinearProgram !== undefined) {
    if (
      !isStudioSoftFalloffLinearAccumulationProgramPin(
        source.softFalloffLinearProgram,
      )
    ) {
      throw new TypeError("Unsupported soft-falloff linear program pin.");
    }
    softFalloffLinearProgram = { ...source.softFalloffLinearProgram };
  }
  return {
    version: STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
    ...(isStudioDynamicBrushCausalDepositPipeline(source.depositPipeline)
      ? { depositPipeline: source.depositPipeline }
      : {}),
    ...(dryMediaUnionProgram ? { dryMediaUnionProgram } : {}),
    ...(dryMediaKernelProgram ? { dryMediaKernelProgram } : {}),
    ...(softFalloffLinearProgram ? { softFalloffLinearProgram } : {}),
    ...(source.causalStampGridRule === STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN
      ? { causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN }
      : {}),
    ...(isStudioBrushDynamicsPresetId(source.presetId)
      ? { presetId: source.presetId }
      : {}),
    seed: uint32(source.seed, INTERNAL_DEFAULT_SETTINGS.seed),
    fallbackPressure: clamp01(finiteNumber(source.fallbackPressure, INTERNAL_DEFAULT_SETTINGS.fallbackPressure)),
    maxSpeed: clamp(finiteNumber(source.maxSpeed, INTERNAL_DEFAULT_SETTINGS.maxSpeed), 0.01, MAX_POINTER_SPEED),
    ...(typeof source.minimumDiameterRatio === "number"
      && Number.isFinite(source.minimumDiameterRatio)
      ? { minimumDiameterRatio: clamp01(source.minimumDiameterRatio) }
      : {}),
    spacingRatio,
    scatterRatio,
    taper: normalizeTaper(source.taper),
    tip,
    colorDynamics: normalizeStudioBrushColorDynamicsSettings(source.colorDynamics),
    grain: normalizeStudioBrushGrainSettings(source.grain),
    tipLayers: normalizeStudioBrushTipLayers(source.tipLayers, tip),
    ...(studioBrushDualBrushSettingsAreIdentity(dualBrush) ? {} : { dualBrush }),
    width,
    opacity: normalizeProperty(source.opacity, INTERNAL_DEFAULT_SETTINGS.opacity, "opacity"),
    flow: normalizeProperty(source.flow, INTERNAL_DEFAULT_SETTINGS.flow, "flow"),
    spacing: spacingRatio === null
      ? spacing
      : { ...spacing, base: clamp(width.base * spacingRatio, spacing.min, spacing.max) },
    scatter: scatterRatio === null
      ? scatter
      : { ...scatter, base: clamp(width.base * scatterRatio, scatter.min, scatter.max) },
    angle: normalizeProperty(source.angle, INTERNAL_DEFAULT_SETTINGS.angle, "angle"),
    roundness: normalizeProperty(source.roundness, INTERNAL_DEFAULT_SETTINGS.roundness, "roundness"),
  };
}

/** Stable canonical JSON for persistence dirty-checks, collaboration patches and memo keys. */
export function serializeStudioBrushDynamicsSettingsCanonical(value?: unknown): string {
  return JSON.stringify(normalizeStudioBrushDynamicsSettings(value));
}

export function studioBrushDynamicsSettingsEqual(left?: unknown, right?: unknown): boolean {
  return serializeStudioBrushDynamicsSettingsCanonical(left) === serializeStudioBrushDynamicsSettingsCanonical(right);
}

/** Normalizes browser/serialized pointer data without mutating the source object. */
export function normalizeStudioBrushDynamicsSample(
  sample?: StudioBrushDynamicsSample | null,
  options?: Pick<StudioBrushDynamicsSettings, "fallbackPressure" | "maxSpeed"> | null
): NormalizedStudioBrushDynamicsSample {
  const fallbackPressure = clamp01(finiteNumber(options?.fallbackPressure, 0.5));
  const maxSpeed = clamp(finiteNumber(options?.maxSpeed, 1.6), 0.01, MAX_POINTER_SPEED);
  const pressure = clamp01(finiteNumber(sample?.pressure, fallbackPressure));
  const tangentialPressure = clamp(finiteNumber(sample?.tangentialPressure, 0), -1, 1);
  const speed = clamp(finiteNumber(sample?.speed, 0), 0, MAX_POINTER_SPEED);
  const tiltX = clamp(finiteNumber(sample?.tiltX, 0), -90, 90);
  const tiltY = clamp(finiteNumber(sample?.tiltY, 0), -90, 90);
  const tiltMagnitude = clamp01(Math.sqrt(tiltX * tiltX + tiltY * tiltY) / 90);
  const hasTilt = tiltMagnitude > Number.EPSILON;
  const rawDirection = finiteNumber(sample?.direction, Number.NaN);
  const hasDirection = Number.isFinite(rawDirection);

  return {
    pressure,
    tangentialPressure,
    tangentialPressureNormalized: (tangentialPressure + 1) / 2,
    speed,
    speedNormalized: clamp01(speed / maxSpeed),
    tiltX,
    tiltY,
    tiltMagnitude,
    tiltAzimuth: hasTilt ? normalizeSignedDegrees(Math.atan2(tiltY, tiltX) * 180 / Math.PI) : 0,
    twist: clamp(finiteNumber(sample?.twist, 0), 0, 359),
    direction: hasDirection ? normalizeSignedDegrees(rawDirection) : 0,
    hasTilt,
    hasDirection,
    stampIndex: uint32(sample?.stampIndex, 0),
  };
}

function sourceValue(
  source: StudioBrushDynamicsSource,
  sample: NormalizedStudioBrushDynamicsSample
): { value: number; active: boolean } {
  switch (source) {
    case "pressure":
      return { value: sample.pressure, active: true };
    case "tangential-pressure":
      return { value: sample.tangentialPressureNormalized, active: true };
    case "speed":
      return { value: sample.speedNormalized, active: true };
    case "tilt":
    case "tilt-magnitude":
      return { value: sample.tiltMagnitude, active: true };
    case "tilt-azimuth":
      return { value: normalizedAngle(sample.tiltAzimuth), active: sample.hasTilt };
    case "twist":
      return { value: sample.twist / 360, active: true };
    case "direction":
      return { value: normalizedAngle(sample.direction), active: sample.hasDirection };
  }
}

/** Stable unsigned hash converted to [0, 1); intentionally independent of Math.random. */
function seededUnit(seed: number, stampIndex: number, salt: number): number {
  let value = (seed ^ Math.imul((stampIndex + 1) >>> 0, 0x9e37_79b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function resolveProperty(
  property: NormalizedStudioBrushDynamicsProperty,
  propertyName: DynamicsPropertyName,
  sample: NormalizedStudioBrushDynamicsSample,
  seed: number
): number {
  let value = property.base;
  for (const mapping of property.mappings) {
    const input = sourceValue(mapping.source, sample);
    if (!input.active || mapping.amount <= 0) continue;
    const linearResponse = mapping.invert ? 1 - input.value : input.value;
    const clampedLinear = clamp01(linearResponse);
    let response: number;
    if (mapping.curveMode === "bezier" && mapping.curveLUT) {
      const idx = Math.round(clampedLinear * 255);
      response = mapping.curveLUT[idx];
    } else {
      response = Math.pow(clampedLinear, mapping.curve);
    }
    const target = mapping.from + (mapping.to - mapping.from) * response;
    if (mapping.mode === "multiply") value *= 1 + (target - 1) * mapping.amount;
    else value += target * mapping.amount;
  }

  if (property.jitter) {
    const signedRandom = seededUnit(seed, sample.stampIndex, PROPERTY_SALTS[propertyName]) * 2 - 1;
    if (property.jitter.mode === "multiply") value *= 1 + signedRandom * property.jitter.amount;
    else value += signedRandom * property.jitter.amount;
  }

  if (!Number.isFinite(value)) value = property.base;
  if (propertyName === "angle") value = normalizeSignedDegrees(value);
  return clamp(value, property.min, property.max);
}

/**
 * Reusable scratch property backing the per-dab spacing/scatter ratio rebase below.
 *
 * `resolveProperty` reads the property synchronously and only returns a plain number, so it never
 * retains the object; the planner hot loop can therefore rebase ratio-driven properties without
 * allocating a spread copy for every emitted dab. All five fields are rewritten before each use
 * and the object never escapes `resolveNormalizedStudioBrushDynamics`.
 */
const RATIO_SCRATCH_PROPERTY: {
  base: number;
  min: number;
  max: number;
  mappings: NormalizedStudioBrushDynamicsProperty["mappings"];
  jitter: NormalizedStudioBrushDynamicsProperty["jitter"];
} = { base: 0, min: 0, max: 0, mappings: [], jitter: null };

function ratioRebasedProperty(
  property: NormalizedStudioBrushDynamicsProperty,
  tipWidth: number,
  ratio: number
): NormalizedStudioBrushDynamicsProperty {
  RATIO_SCRATCH_PROPERTY.base = clamp(tipWidth * ratio, property.min, property.max);
  RATIO_SCRATCH_PROPERTY.min = property.min;
  RATIO_SCRATCH_PROPERTY.max = property.max;
  RATIO_SCRATCH_PROPERTY.mappings = property.mappings;
  RATIO_SCRATCH_PROPERTY.jitter = property.jitter;
  return RATIO_SCRATCH_PROPERTY;
}

export function resolveNormalizedStudioBrushDynamics(
  sample: NormalizedStudioBrushDynamicsSample,
  settings: NormalizedStudioBrushDynamicsSettings
): StudioBrushDynamicsRecipe {
  const values = {} as Record<DynamicsPropertyName, number>;
  for (const propertyName of PROPERTY_NAMES) {
    let property = settings[propertyName];
    // Ratio mode follows the pressure/jitter-adjusted tip size of this exact dab, not only the
    // nominal toolbar width. Property mappings then remain available for extra speed/pressure
    // modulation on top of that physical ratio.
    if (propertyName === "spacing" && settings.spacingRatio !== null) {
      property = ratioRebasedProperty(property, values.width, settings.spacingRatio);
    } else if (propertyName === "scatter" && settings.scatterRatio !== null) {
      property = ratioRebasedProperty(property, values.width, settings.scatterRatio);
    }
    values[propertyName] = resolveProperty(property, propertyName, sample, settings.seed);
  }

  if (values.scatter <= 0) {
    return {
      size: values.width,
      width: values.width,
      opacity: values.opacity,
      flow: values.flow,
      spacing: values.spacing,
      scatter: 0,
      scatterOffsetX: 0,
      scatterOffsetY: 0,
      scatterAngle: 0,
      angle: values.angle,
      roundness: values.roundness,
    };
  }

  const scatterAngleRadians = seededUnit(settings.seed, sample.stampIndex, 0x243f_6a88) * TAU;
  // sqrt gives a spatially uniform disk rather than clustering particles at its centre.
  const scatterDistance = Math.sqrt(seededUnit(settings.seed, sample.stampIndex, 0x85a3_08d3)) * values.scatter;
  return {
    size: values.width,
    width: values.width,
    opacity: values.opacity,
    flow: values.flow,
    spacing: values.spacing,
    scatter: values.scatter,
    scatterOffsetX: Math.cos(scatterAngleRadians) * scatterDistance,
    scatterOffsetY: Math.sin(scatterAngleRadians) * scatterDistance,
    scatterAngle: normalizeSignedDegrees(scatterAngleRadians * 180 / Math.PI),
    angle: values.angle,
    roundness: values.roundness,
  };
}

/** Resolves one normalized, finite dab recipe from a pointer sample and serializable settings. */
export function resolveStudioBrushDynamics(
  sample?: StudioBrushDynamicsSample | null,
  settings?: StudioBrushDynamicsSettings | null
): StudioBrushDynamicsRecipe {
  const normalizedSettings = normalizeStudioBrushDynamicsSettings(settings);
  const normalizedSample = normalizeStudioBrushDynamicsSample(sample, normalizedSettings);
  return resolveNormalizedStudioBrushDynamics(normalizedSample, normalizedSettings);
}

/**
 * Hot planner path for settings that already crossed the normalization boundary.
 *
 * `normalizeStudioBrushDynamicsSettings` is a byte-level fixpoint on its own output, so this
 * produces the exact recipe `resolveStudioBrushDynamics` would while skipping the per-dab re-walk
 * of every mapping/tip/grain/tip-layer field. The causal deposit walker resolves one recipe per
 * emitted dab, where that redundant re-normalization dominated whole-stroke planning cost.
 */
export function resolveStudioBrushDynamicsForNormalizedSettings(
  sample: StudioBrushDynamicsSample | null | undefined,
  settings: NormalizedStudioBrushDynamicsSettings
): StudioBrushDynamicsRecipe {
  return resolveNormalizedStudioBrushDynamics(
    normalizeStudioBrushDynamicsSample(sample, settings),
    settings,
  );
}

/** Stable FNV-1a seed for document/stroke ids. */
export function studioBrushDynamicsSeedFromKey(key: unknown): number {
  if (typeof key !== "string" || key.length === 0) return INTERNAL_DEFAULT_SETTINGS.seed;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
