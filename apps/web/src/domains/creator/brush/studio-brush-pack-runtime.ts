import {
  renderStudioDualBrushTip,
  STUDIO_DUAL_TIP_CONTRACT_VERSION,
  type StudioDualTipCombineMode,
  type StudioDualTipDynamics,
  type StudioDualTipAlphaField,
  type StudioDualTipJitter,
  type StudioDualTipOutputSurface,
  type StudioDualTipResult,
  type StudioDualTipStrokeSample,
  type StudioDualTipTransform,
} from "../studio-dual-brush-tip-engine";

import {
  applyStudioBrushContinuousCarrierQualityPolicy,
} from "./studio-brush-carrier-quality";
import {
  normalizeStudioBrushDynamicsSettings,
  serializeStudioBrushDynamicsSettingsCanonical,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  studioBrushDynamicsPresetSettings,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsMappingSettings,
  type StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  applyStudioBrushPackExpansionTuning,
  studioBrushPackExpansionTuningById,
} from "./studio-brush-pack-expansion";
import { STUDIO_BRUSH_PACK_CATALOG_IDS, type StudioBrushPackCatalogId } from "./studio-brush-pack-id";
import {
  STUDIO_BRUSH_PACK_DESCRIPTORS,
  studioBrushPackDescriptorById,
  type StudioBrushPackDescriptor,
  type StudioBrushPackRuntimeBrushId,
} from "./studio-brush-pack-index";
import {
  buildStudioBrushTipAlphaMap,
  encodeStudioBrushTipAlphaMapBase64,
  isStudioBrushTipShapeId,
  normalizeStudioBrushTipSettings,
  STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE,
  STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE,
  type NormalizedStudioBrushTipSettings,
  type StudioBrushTipSettings,
  type StudioBrushTipShapeId,
} from "./studio-brush-tip-stamp";

import type { StudioBrushCatalogSelection } from "./studio-brush-selection";
import type { StudioBrushTipLayerSettings } from "./studio-brush-tip-composition";
import type { StudioBrushPreviewStyle } from "./studio-brush-visual";
import type { StudioBrushMediaGroup } from "../studio-creative-ux";

export const STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS = [
  "square",
  "chisel",
  "line-block",
  "rake",
  "leaf",
  "leaf-cluster",
  "grass",
  "oval-stack",
  "checker",
  "hair",
  "stripe",
  "footstep",
  "heart",
  "cross-hatch",
  "halftone",
  "weave",
  "fold",
  "pine",
  "fan-bristle",
  "knife-edge",
  "salt-crystal",
  "bloom-ring",
  "ribbon-fold",
  "chain-link",
  "lace-scallop",
  "stitch-dash",
  "knit-loop",
  "metal-scratch",
  "smoke-wisp",
  "flame-tongue",
  "bokeh-ring",
  "flower-petal",
  "rock-shard",
  "brick",
  "curl",
  "sesame",
  "focus-ray",
] as const;

export type StudioBrushPackCustomTipMotif =
  (typeof STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS)[number];
export type StudioBrushPackTipMotif = StudioBrushTipShapeId | StudioBrushPackCustomTipMotif;

export interface StudioBrushPackSelection extends StudioBrushCatalogSelection {
  catalogId: StudioBrushPackCatalogId;
  runtimeBrushId: StudioBrushPackRuntimeBrushId;
  brushDynamics: NormalizedStudioBrushDynamicsSettings;
  /**
   * Optional next-generation dual-tip execution descriptor. Missing means the established
   * single-tip/legacy dual-brush renderer remains the sole authority.
   */
  dualTip?: NormalizedStudioBrushPackDualTipDescriptor;
  mediaGroup: StudioBrushMediaGroup;
  previewStyle: StudioBrushPreviewStyle;
  shortName: string;
  hint: string;
}

/**
 * Serializable brush-pack adapter for the independent CPU dual-tip oracle. Descriptor presence
 * opts into the new path; absence is deliberately not normalized to an enabled default.
 */
export interface StudioBrushPackDualTipDescriptor {
  readonly contractVersion?: typeof STUDIO_DUAL_TIP_CONTRACT_VERSION;
  readonly secondaryTip?: StudioBrushTipSettings | null;
  readonly combineMode?: StudioDualTipCombineMode;
  readonly primaryTransform?: StudioDualTipTransform;
  readonly secondaryTransform?: StudioDualTipTransform;
  readonly dynamics?: StudioDualTipDynamics;
  readonly jitter?: StudioDualTipJitter;
}

export interface NormalizedStudioBrushPackDualTipDescriptor {
  readonly contractVersion: typeof STUDIO_DUAL_TIP_CONTRACT_VERSION;
  readonly secondaryTip: NormalizedStudioBrushTipSettings;
  readonly combineMode: StudioDualTipCombineMode;
  readonly primaryTransform: Required<StudioDualTipTransform>;
  readonly secondaryTransform: Required<StudioDualTipTransform>;
  readonly dynamics: Required<StudioDualTipDynamics>;
  readonly jitter: Required<StudioDualTipJitter>;
}

export interface StudioBrushPackDualTipRenderInput {
  readonly samples: readonly StudioDualTipStrokeSample[];
  /** Defaults to the selection's normalized brush width. */
  readonly diameter?: number;
  /** Defaults to the normalized pack spacing ratio. */
  readonly spacingRatio?: number;
  /** Defaults to the normalized pack seed. */
  readonly seed?: number;
  /** Defaults to the catalogue opacity. */
  readonly opacity?: number;
  readonly linearColor?: readonly [number, number, number];
  /**
   * Authority operation for exact GPU/replay providers. The CPU artifact remains a premultiplied
   * source/mask and the provider applies this operation when it reaches an existing authority.
   */
  readonly porterDuff?: "source-over" | "destination-out";
  readonly output: StudioDualTipOutputSurface;
  readonly workBudget?: number;
}

export interface StudioBrushPackDualTipR8Asset {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha";
  readonly bytes: Uint8Array;
  readonly field: StudioDualTipAlphaField;
}

export interface StudioBrushPackDualTipR8Materialization {
  readonly descriptor: NormalizedStudioBrushPackDualTipDescriptor;
  readonly primary: StudioBrushPackDualTipR8Asset;
  readonly secondary: StudioBrushPackDualTipR8Asset;
}

const CUSTOM_MOTIF_SET: ReadonlySet<string> = new Set(STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS);
/**
 * Bundled custom motifs use the full document-safe R8 tip resolution. This keeps the smallest
 * authored texture texel below 3.2 CSS px even at a 200 px brush diameter, while retaining the
 * existing collaboration/import payload boundary.
 */
const CUSTOM_TIP_SIZE = STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE;
const DUAL_TIP_COMBINE_MODES: readonly StudioDualTipCombineMode[] = [
  "multiply",
  "min",
  "max",
  "add",
  "subtract",
  "intersect",
];

function dualTipRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function dualTipOwn(
  source: Record<string, unknown>,
  key: string
): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function dualTipFinite(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const candidate = dualTipOwn(source, key);
  if (candidate === undefined) return fallback;
  return typeof candidate === "number"
    && Number.isFinite(candidate)
    && candidate >= minimum
    && candidate <= maximum
    ? candidate
    : null;
}

function normalizeBrushPackDualTipTransform(
  value: unknown,
  secondary: boolean
): Required<StudioDualTipTransform> | null {
  const source = value === undefined ? {} : dualTipRecord(value);
  if (!source) return null;
  const rotationDegrees = dualTipFinite(source, "rotationDegrees", 0, -360_000, 360_000);
  const scaleX = dualTipFinite(source, "scaleX", 1, 1 / 64, 64);
  const scaleY = dualTipFinite(source, "scaleY", 1, 1 / 64, 64);
  const offsetX = dualTipFinite(source, "offsetX", 0, -8, 8);
  const offsetY = dualTipFinite(source, "offsetY", 0, -8, 8);
  if (
    rotationDegrees === null
    || scaleX === null
    || scaleY === null
    || offsetX === null
    || offsetY === null
    || (!secondary && (offsetX !== 0 || offsetY !== 0))
  ) return null;
  return { rotationDegrees, scaleX, scaleY, offsetX, offsetY };
}

function normalizeBrushPackDualTipDynamics(
  value: unknown
): Required<StudioDualTipDynamics> | null {
  const source = value === undefined ? {} : dualTipRecord(value);
  if (!source) return null;
  const pressureSizeGain = dualTipFinite(source, "pressureSizeGain", 0, -1, 1);
  const pressureOpacityGain = dualTipFinite(source, "pressureOpacityGain", 0, 0, 1);
  const tiltStretchGain = dualTipFinite(source, "tiltStretchGain", 0, 0, 4);
  const tiltRotationGain = dualTipFinite(source, "tiltRotationGain", 0, 0, 1);
  const velocitySizeGain = dualTipFinite(source, "velocitySizeGain", 0, 0, 1);
  const velocityOpacityGain = dualTipFinite(source, "velocityOpacityGain", 0, 0, 1);
  const referenceVelocity = dualTipFinite(
    source,
    "referenceVelocity",
    1_000,
    Number.EPSILON,
    1_000_000_000
  );
  if (
    pressureSizeGain === null
    || pressureOpacityGain === null
    || tiltStretchGain === null
    || tiltRotationGain === null
    || velocitySizeGain === null
    || velocityOpacityGain === null
    || referenceVelocity === null
  ) return null;
  return {
    pressureSizeGain,
    pressureOpacityGain,
    tiltStretchGain,
    tiltRotationGain,
    velocitySizeGain,
    velocityOpacityGain,
    referenceVelocity,
  };
}

function normalizeBrushPackDualTipJitter(
  value: unknown
): Required<StudioDualTipJitter> | null {
  const source = value === undefined ? {} : dualTipRecord(value);
  if (!source) return null;
  const position = dualTipFinite(source, "position", 0, 0, 4);
  const rotationDegrees = dualTipFinite(source, "rotationDegrees", 0, 0, 360);
  const scale = dualTipFinite(source, "scale", 0, 0, 0.95);
  const opacity = dualTipFinite(source, "opacity", 0, 0, 1);
  if (
    position === null
    || rotationDegrees === null
    || scale === null
    || opacity === null
  ) return null;
  return { position, rotationDegrees, scale, opacity };
}

function normalizeBrushPackDualTipSecondaryTip(
  value: unknown,
  fallbackValue: unknown
): NormalizedStudioBrushTipSettings | null {
  if (value === undefined || value === null) {
    return normalizeStudioBrushTipSettings(fallbackValue);
  }
  const source = dualTipRecord(value);
  if (!source) return null;
  const shape = dualTipOwn(source, "shape");
  const softness = dualTipOwn(source, "softness");
  const alphaMapSize = dualTipOwn(source, "alphaMapSize");
  const alphaMapBase64 = dualTipOwn(source, "alphaMapBase64");
  if (shape !== undefined && !isStudioBrushTipShapeId(shape)) return null;
  if (
    softness !== undefined
    && (
      typeof softness !== "number"
      || !Number.isFinite(softness)
      || softness < 0
      || softness > 1
    )
  ) return null;
  if (
    alphaMapSize !== undefined
    && (
      !Number.isInteger(alphaMapSize)
      || (alphaMapSize as number) < STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.min
      || (alphaMapSize as number) > STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.max
    )
  ) return null;
  if (
    alphaMapBase64 !== undefined
    && alphaMapBase64 !== null
    && (typeof alphaMapBase64 !== "string" || alphaMapBase64.length === 0)
  ) return null;
  const normalized = normalizeStudioBrushTipSettings(source);
  if (typeof alphaMapBase64 === "string" && normalized.alphaMapBase64 === null) return null;
  return normalized;
}

/**
 * Strict optional boundary: absent/null means no new engine path, while a present descriptor
 * either becomes one canonical JSON-safe value or fails closed as null.
 */
export function normalizeStudioBrushPackDualTipDescriptor(
  value: unknown,
  fallbackSecondaryTipValue?: unknown
): NormalizedStudioBrushPackDualTipDescriptor | null {
  if (value === undefined || value === null) return null;
  const source = dualTipRecord(value);
  if (!source) return null;
  const contractVersion = dualTipOwn(source, "contractVersion")
    ?? STUDIO_DUAL_TIP_CONTRACT_VERSION;
  const combineMode = dualTipOwn(source, "combineMode") ?? "multiply";
  if (
    contractVersion !== STUDIO_DUAL_TIP_CONTRACT_VERSION
    || typeof combineMode !== "string"
    || !DUAL_TIP_COMBINE_MODES.includes(combineMode as StudioDualTipCombineMode)
  ) return null;
  const secondaryTip = normalizeBrushPackDualTipSecondaryTip(
    dualTipOwn(source, "secondaryTip"),
    fallbackSecondaryTipValue
  );
  const primaryTransform = normalizeBrushPackDualTipTransform(
    dualTipOwn(source, "primaryTransform"),
    false
  );
  const secondaryTransform = normalizeBrushPackDualTipTransform(
    dualTipOwn(source, "secondaryTransform"),
    true
  );
  const dynamics = normalizeBrushPackDualTipDynamics(dualTipOwn(source, "dynamics"));
  const jitter = normalizeBrushPackDualTipJitter(dualTipOwn(source, "jitter"));
  if (!secondaryTip || !primaryTransform || !secondaryTransform || !dynamics || !jitter) {
    return null;
  }
  return {
    contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
    secondaryTip,
    combineMode: combineMode as StudioDualTipCombineMode,
    primaryTransform,
    secondaryTransform,
    dynamics,
    jitter,
  };
}

/** Canonical persistence/collaboration form; invalid and absent descriptors return null. */
export function serializeStudioBrushPackDualTipDescriptorCanonical(
  value: unknown,
  fallbackSecondaryTipValue?: unknown
): string | null {
  const normalized = normalizeStudioBrushPackDualTipDescriptor(
    value,
    fallbackSecondaryTipValue
  );
  return normalized ? JSON.stringify(normalized) : null;
}

/**
 * Compact per-brush physics row. Values are intentionally renderer-neutral:
 * `[motif, spacing bias, scatter bias, roundness, angle, behavior flags]`.
 */
type CompactProfileRow = readonly [
  motif: StudioBrushPackTipMotif,
  spacingBias: number,
  scatterBias: number,
  roundness: number,
  angle: number,
  flags: number,
];

const FOLLOW_DIRECTION = 1;
const TAPER = 2;
const PRESSURE_OPACITY = 4;
const WIDTH_GRAIN = 8;
const ANGLE_GRAIN = 16;
const SPEED_SPACING = 32;

/* Aligned with STUDIO_BRUSH_PACK_CATALOG_IDS; no alpha bitmap or third-party asset is stored. */
const COMPACT_PROFILE_ROWS: readonly CompactProfileRow[] = [
  ["hard", 0.00, 0.00, 1.00, 0, FOLLOW_DIRECTION | TAPER],
  ["hard", -0.05, 0.00, 0.92, 0, FOLLOW_DIRECTION | TAPER | SPEED_SPACING],
  ["sumi", -0.03, 0.02, 0.62, -8, FOLLOW_DIRECTION | TAPER | ANGLE_GRAIN],
  ["soft", 0.12, 0.02, 1.00, 0, PRESSURE_OPACITY],
  ["soft", 0.18, 0.04, 1.00, 0, PRESSURE_OPACITY | WIDTH_GRAIN],
  ["grain", 0.06, 0.09, 0.86, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | SPEED_SPACING],
  ["round", 0.02, 0.03, 0.96, 0, FOLLOW_DIRECTION | TAPER],
  ["bristle", 0.08, 0.06, 0.7, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["grain", -0.02, 0.02, 0.82, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY],
  ["soft", 0.05, 0.03, 0.84, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["hair", 0.00, 0.01, 0.72, 0, FOLLOW_DIRECTION | TAPER],
  ["round", 0.03, 0.00, 1.00, 0, PRESSURE_OPACITY],
  ["chisel", 0.02, 0.00, 0.48, -18, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["grain", 0.08, 0.08, 0.88, 0, WIDTH_GRAIN | PRESSURE_OPACITY],
  ["sponge", 0.11, 0.12, 0.82, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["chisel", 0.06, 0.04, 0.54, -12, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["stripe", 0.12, 0.05, 0.52, 20, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["hair", 0.1, 0.06, 0.5, -10, FOLLOW_DIRECTION | ANGLE_GRAIN | SPEED_SPACING],
  ["sponge", 0.14, 0.09, 0.9, 0, PRESSURE_OPACITY | WIDTH_GRAIN],
  ["line-block", 0.05, 0.01, 0.42, -20, FOLLOW_DIRECTION | TAPER],
  ["square", 0.03, 0.00, 1.00, 0, FOLLOW_DIRECTION],
  ["chisel", -0.01, 0.00, 0.28, 0, FOLLOW_DIRECTION | TAPER],
  ["chisel", -0.01, 0.00, 0.28, 90, FOLLOW_DIRECTION | TAPER],
  ["chisel", 0.03, 0.00, 0.44, -12, FOLLOW_DIRECTION],
  ["chisel", 0.08, 0.16, 0.46, -8, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["chisel", 0.24, 0.02, 0.46, -12, FOLLOW_DIRECTION],
  ["chisel", 0.11, 0.2, 0.42, -10, FOLLOW_DIRECTION | ANGLE_GRAIN | SPEED_SPACING],
  ["round", 0.01, 0.00, 0.96, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["bristle", 0.07, 0.03, 0.72, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["chisel", 0.02, 0.00, 0.42, -16, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["chisel", 0.09, 0.01, 0.5, -12, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["round", 0.01, 0.00, 0.55, -8, FOLLOW_DIRECTION],
  ["checker", 0.12, 0.02, 0.82, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["grain", 0.1, 0.1, 0.86, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["sponge", 0.13, 0.12, 0.88, 0, WIDTH_GRAIN | PRESSURE_OPACITY],
  ["sponge", 0.17, 0.08, 0.78, 0, WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["sponge", 0.16, 0.05, 0.92, 0, PRESSURE_OPACITY | ANGLE_GRAIN],
  ["grain", 0.14, 0.2, 0.9, 0, WIDTH_GRAIN],
  ["sponge", 0.18, 0.08, 0.76, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["sponge", 0.2, 0.14, 0.72, 0, WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["hair", 0.12, 0.16, 0.6, 0, ANGLE_GRAIN | PRESSURE_OPACITY],
  ["grain", 0.15, 0.12, 0.84, 0, WIDTH_GRAIN | PRESSURE_OPACITY],
  ["round", 0.02, 0.00, 0.94, 0, FOLLOW_DIRECTION | TAPER],
  ["sumi", 0.03, 0.02, 0.68, -7, FOLLOW_DIRECTION | TAPER | WIDTH_GRAIN],
  ["stripe", 0.11, 0.02, 0.52, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["grain", 0.16, 0.42, 0.92, 0, WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["sumi", 0.08, 0.06, 0.64, -6, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["rake", 0.08, 0.02, 0.62, 0, FOLLOW_DIRECTION | TAPER],
  ["rake", 0.1, 0.03, 0.54, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["rake", 0.14, 0.05, 0.58, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | SPEED_SPACING],
  ["grass", 0.16, 0.22, 0.72, 0, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["grass", 0.2, 0.48, 0.62, 0, FOLLOW_DIRECTION | ANGLE_GRAIN | SPEED_SPACING],
  ["grass", 0.11, 0.22, 0.68, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["leaf", 0.18, 0.28, 0.66, 0, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["leaf", 0.16, 0.22, 0.44, 0, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["leaf", 0.14, 0.18, 0.8, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["leaf-cluster", 0.2, 0.38, 0.7, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["flake", 0.22, 0.24, 0.8, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["round", 0.2, 0.5, 0.58, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["round", 0.22, 0.02, 0.56, 0, FOLLOW_DIRECTION],
  ["oval-stack", 0.26, 0.12, 0.54, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["checker", 0.24, 0.00, 1.00, 0, FOLLOW_DIRECTION],
  ["hair", 0.05, 0.01, 0.38, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY],
  ["stripe", 0.14, 0.00, 0.68, 0, FOLLOW_DIRECTION],
  ["stripe", 0.16, 0.06, 0.62, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["footstep", 0.34, 0.04, 0.72, 0, FOLLOW_DIRECTION],
  ["heart", 0.3, 0.08, 0.82, 0, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["hard", -0.06, 0, 0.34, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | SPEED_SPACING],
  ["sumi", 0.13, 0.05, 0.58, -7, FOLLOW_DIRECTION | TAPER | WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["chisel", 0.07, 0.04, 0.28, -18, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["sponge", 0.1, 0.08, 0.45, -12, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["round", 0.04, 0.01, 0.9, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY],
  ["chisel", 0.1, 0.02, 0.32, -12, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["sponge", 0.03, 0.01, 0.82, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["oval-stack", 0.08, 0.03, 0.6, -8, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["chisel", 0.02, 0, 0.34, -22, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["bristle", 0.05, 0.02, 0.58, -8, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["square", -0.05, 0, 1, 0, FOLLOW_DIRECTION],
  ["checker", 0.16, 0, 1, 0, FOLLOW_DIRECTION],
  ["cross-hatch", 0.18, 0.01, 0.92, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["rake", 0.14, 0.04, 0.52, 0, FOLLOW_DIRECTION | TAPER | SPEED_SPACING],
  ["halftone", 0.14, 0, 1, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["soft", 0.22, 0.58, 1, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["weave", 0.12, 0.03, 0.82, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["hair", 0.04, 0.015, 0.28, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | ANGLE_GRAIN],
  ["fold", 0.11, 0.04, 0.5, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["pine", 0.18, 0.32, 0.58, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  // ── 2026-07 확장 웨이브(33) — 세부 물성은 studio-brush-pack-expansion.ts 튜닝이 덮어쓴다.
  ["grain", 0.02, 0.04, 0.86, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["hard", -0.06, 0.00, 0.97, 0, FOLLOW_DIRECTION | TAPER],
  ["grain", 0.04, 0.05, 0.8, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["sponge", 0.06, 0.08, 0.66, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["grain", 0.08, 0.03, 0.8, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["hard", -0.05, 0.00, 0.9, 0, FOLLOW_DIRECTION | TAPER | SPEED_SPACING],
  ["hard", -0.07, 0.00, 0.95, 0, FOLLOW_DIRECTION | TAPER],
  ["round", -0.04, 0.00, 0.93, 0, FOLLOW_DIRECTION | TAPER],
  ["sumi", -0.02, 0.02, 0.55, -6, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | SPEED_SPACING],
  ["chisel", 0.00, 0.00, 0.24, -32, TAPER],
  ["hard", -0.03, 0.00, 1.00, 0, 0],
  ["soft", 0.08, 0.04, 1.00, 0, PRESSURE_OPACITY | WIDTH_GRAIN],
  ["sponge", 0.14, 0.08, 0.94, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["bristle", -0.07, 0.01, 0.62, -6, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["bristle", 0.08, 0.05, 0.58, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["sponge", 0.09, 0.05, 0.85, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["grain", 0.03, 0.03, 0.78, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["soft", 0.2, 0.02, 1.00, 0, PRESSURE_OPACITY],
  ["sponge", 0.6, 0.16, 0.9, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["soft", 0.08, 0.00, 0.86, 0, PRESSURE_OPACITY],
  ["chisel", 0.00, 0.00, 0.3, -35, 0],
  ["hard", 0.28, 0.9, 1.00, 0, PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["star", 0.55, 0.5, 1.00, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["leaf", 0.45, 0.6, 0.6, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["sponge", 0.22, 0.1, 1.00, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["fold", 0.85, 0.00, 0.55, 90, FOLLOW_DIRECTION],
  ["halftone", 0.3, 0.00, 1.00, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY],
  ["hair", 0.35, 0.5, 0.3, -70, SPEED_SPACING | WIDTH_GRAIN],
  ["star", 0.9, 0.35, 1.00, 0, PRESSURE_OPACITY | WIDTH_GRAIN],
  ["flake", 0.55, 0.65, 0.95, 0, ANGLE_GRAIN | WIDTH_GRAIN],
  ["hard", 0.45, 0.8, 0.9, 0, WIDTH_GRAIN],
  ["hair", 0.06, 0.1, 0.5, 0, FOLLOW_DIRECTION | TAPER | ANGLE_GRAIN],
  ["fold", 0.08, 0.02, 0.6, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | SPEED_SPACING],
  // ── 2026-07 재료·장식·효과 확장 웨이브(40) ───────────────────────────
  ["bristle", -0.03, 0.02, 0.82, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["fan-bristle", 0.11, 0.04, 0.42, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["rake", 0.03, 0.02, 0.38, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["knife-edge", -0.02, 0.01, 0.22, -18, FOLLOW_DIRECTION | PRESSURE_OPACITY | ANGLE_GRAIN],
  ["grain", 0.1, 0.06, 0.82, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["salt-crystal", 0.32, 0.22, 0.88, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["bloom-ring", 0.24, 0.12, 0.94, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["soft", 0.12, 0.04, 0.72, -8, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["chisel", 0.02, 0.02, 0.48, -10, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["chisel", -0.02, 0, 0.34, -14, FOLLOW_DIRECTION | PRESSURE_OPACITY | TAPER],
  ["bristle", -0.04, 0.015, 0.58, -6, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["sumi", 0.04, 0.03, 0.54, -4, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["ribbon-fold", 0.18, 0, 0.52, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | ANGLE_GRAIN],
  ["fold", 0.28, 0, 0.5, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["chain-link", 0.62, 0.01, 0.7, 0, FOLLOW_DIRECTION | ANGLE_GRAIN],
  ["lace-scallop", 0.44, 0.02, 0.66, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["stitch-dash", 0.48, 0.01, 0.36, 0, FOLLOW_DIRECTION | TAPER],
  ["cross-hatch", 0.38, 0.01, 0.72, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["knit-loop", 0.2, 0.015, 0.78, 0, FOLLOW_DIRECTION | WIDTH_GRAIN],
  ["metal-scratch", 0.16, 0.08, 0.48, -22, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["smoke-wisp", 0.2, 0.12, 0.84, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["flame-tongue", 0.32, 0.22, 0.58, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | WIDTH_GRAIN],
  ["hair", 0.24, 0.34, 0.32, -68, SPEED_SPACING | WIDTH_GRAIN | ANGLE_GRAIN],
  ["flake", 0.4, 0.62, 0.9, 0, WIDTH_GRAIN | ANGLE_GRAIN | SPEED_SPACING],
  ["grain", 0.38, 0.76, 0.95, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["hard", 0.3, 0.84, 0.86, 0, PRESSURE_OPACITY | WIDTH_GRAIN | ANGLE_GRAIN],
  ["bokeh-ring", 0.56, 0.46, 1, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["smoke-wisp", 0.11, 0.06, 0.42, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["leaf-cluster", 0.25, 0.42, 0.68, 0, FOLLOW_DIRECTION | WIDTH_GRAIN | ANGLE_GRAIN],
  ["fold", 0.08, 0.025, 0.5, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["flower-petal", 0.42, 0.58, 0.76, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["rock-shard", 0.24, 0.26, 0.74, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["brick", 0.5, 0, 0.84, 0, FOLLOW_DIRECTION],
  ["rake", 0.09, 0.035, 0.48, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | WIDTH_GRAIN | SPEED_SPACING],
  ["hair", 0.05, 0.08, 0.56, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | ANGLE_GRAIN],
  ["curl", 0.11, 0.02, 0.46, 0, FOLLOW_DIRECTION | TAPER | PRESSURE_OPACITY | ANGLE_GRAIN],
  ["sesame", 0.58, 0.46, 0.78, 0, WIDTH_GRAIN | ANGLE_GRAIN],
  ["halftone", 0.2, 0.01, 1, 0, FOLLOW_DIRECTION | PRESSURE_OPACITY | SPEED_SPACING],
  ["rake", 0.08, 0.03, 0.44, 0, FOLLOW_DIRECTION | TAPER | WIDTH_GRAIN | ANGLE_GRAIN],
  ["focus-ray", 0.14, 0.04, 0.3, 0, FOLLOW_DIRECTION | TAPER | WIDTH_GRAIN | SPEED_SPACING],
];

if (COMPACT_PROFILE_ROWS.length !== STUDIO_BRUSH_PACK_CATALOG_IDS.length) {
  throw new Error("Studio procedural brush runtime table is out of sync with its stable ids");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothEdge(distance: number, inner: number, outer: number): number {
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const amount = (outer - distance) / Math.max(0.0001, outer - inner);
  return amount * amount * (3 - 2 * amount);
}

function hashUnit(x: number, y: number, seed: number): number {
  let hash = Math.imul((x | 0) ^ seed, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16) ^ (y | 0), 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffff_ffff;
}

function rotatedEllipseAlpha(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angle: number
): number {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const offsetX = x - centerX;
  const offsetY = y - centerY;
  const localX = (offsetX * cosine + offsetY * sine) / radiusX;
  const localY = (-offsetX * sine + offsetY * cosine) / radiusY;
  return smoothEdge(Math.hypot(localX, localY), 0.76, 1);
}

function distanceToSegment(
  x: number,
  y: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const amount = lengthSquared > 0
    ? clamp01(((x - startX) * segmentX + (y - startY) * segmentY) / lengthSquared)
    : 0;
  return Math.hypot(x - (startX + segmentX * amount), y - (startY + segmentY * amount));
}

function customTipAlpha(
  motif: StudioBrushPackCustomTipMotif,
  x: number,
  y: number,
  variant: number
): number {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const radius = Math.hypot(x, y);
  const phase = (variant % 11) * 0.17;

  switch (motif) {
    case "square": {
      const skewedX = x + y * (((variant % 3) - 1) * 0.06);
      return smoothEdge(Math.max(Math.abs(skewedX), absY), 0.72, 0.9);
    }
    case "chisel": {
      const skewedX = x + y * (0.18 + (variant % 4) * 0.035);
      const boundary = Math.max(Math.abs(skewedX) * 0.58, absY * 1.48);
      return smoothEdge(boundary, 0.72, 0.96);
    }
    case "rake": {
      if (absY >= 0.94) return 0;
      const count = 4 + (variant % 4);
      const position = ((x + 0.92) / 1.84) * (count - 1);
      const lineDistance = Math.abs(position - Math.round(position));
      const line = smoothEdge(lineDistance, 0.07, 0.18 + (variant % 2) * 0.025);
      return line * smoothEdge(Math.hypot(x * 0.92, y), 0.78, 0.98);
    }
    case "line-block": {
      const thinLine = smoothEdge(Math.max(Math.abs(x + 0.26) / 0.7, absY / 0.075), 0.72, 1);
      const block = smoothEdge(Math.max(Math.abs(x - 0.45) / 0.28, absY / 0.52), 0.76, 1);
      return Math.max(thinLine, block);
    }
    case "leaf": {
      if (absY >= 0.96) return 0;
      const belly = Math.pow(Math.max(0, 1 - absY / 0.96), 0.58) * (0.48 + (variant % 4) * 0.055);
      const body = smoothEdge(absX, Math.max(0, belly - 0.1), belly);
      const vein = smoothEdge(absX, 0, 0.045 + (variant % 2) * 0.012) * 0.35;
      return clamp01(Math.max(body, vein) * smoothEdge(absY, 0.82, 0.98));
    }
    case "leaf-cluster": {
      const left = rotatedEllipseAlpha(x, y, -0.28, 0.12, 0.28, 0.62, -0.58);
      const right = rotatedEllipseAlpha(x, y, 0.3, 0.08, 0.29, 0.65, 0.6);
      const top = rotatedEllipseAlpha(x, y, 0, -0.34, 0.25, 0.55, 0.04);
      const stem = smoothEdge(Math.abs(x + y * 0.08), 0.018, 0.055)
        * smoothEdge(Math.abs(y - 0.34), 0.45, 0.72);
      return clamp01(Math.max(left, right, top, stem));
    }
    case "grass": {
      const count = 3 + (variant % 3);
      let alpha = 0;
      for (let blade = 0; blade < count; blade++) {
        const base = -0.62 + blade * (1.24 / Math.max(1, count - 1));
        const progress = clamp01((1 - y) / 1.9);
        const bend = ((blade % 2 === 0 ? -1 : 1) * (0.14 + (variant % 5) * 0.018));
        const targetX = base + bend * progress * progress + Math.sin(progress * 4 + phase) * 0.025;
        const width = 0.055 * (1 - progress * 0.72) + 0.012;
        alpha = Math.max(alpha, smoothEdge(Math.abs(x - targetX), width * 0.35, width));
      }
      return alpha * smoothEdge(absY, 0.82, 1);
    }
    case "checker": {
      if (Math.max(absX, absY) >= 0.94) return 0;
      const cells = 4 + (variant % 3);
      const cellX = Math.floor(((x + 1) / 2) * cells);
      const cellY = Math.floor(((y + 1) / 2) * cells);
      const filled = (cellX + cellY + variant) % 2 === 0;
      const localX = Math.abs((((x + 1) / 2) * cells) % 1 - 0.5);
      const localY = Math.abs((((y + 1) / 2) * cells) % 1 - 0.5);
      const border = Math.max(localX, localY);
      return filled ? smoothEdge(border, 0.36, 0.48) : 0;
    }
    case "hair": {
      const count = 5 + (variant % 4);
      let alpha = 0;
      for (let strand = 0; strand < count; strand++) {
        const origin = -0.68 + strand * (1.36 / Math.max(1, count - 1));
        const targetX = origin + Math.sin(y * (2.2 + strand * 0.13) + phase + strand) * 0.055;
        const strandWidth = 0.018 + ((strand + variant) % 3) * 0.009;
        alpha = Math.max(alpha, smoothEdge(Math.abs(x - targetX), strandWidth * 0.25, strandWidth));
      }
      return alpha * smoothEdge(radius, 0.82, 1);
    }
    case "stripe": {
      if (radius >= 1) return 0;
      const count = 3 + (variant % 5);
      const position = ((x + 0.9) / 1.8) * count;
      const stripeDistance = Math.abs(position - Math.round(position));
      const roughness = 0.82 + hashUnit(Math.round(x * 31), Math.round(y * 31), variant + 71) * 0.18;
      return smoothEdge(stripeDistance, 0.08, 0.2) * smoothEdge(radius, 0.82, 1) * roughness;
    }
    case "oval-stack": {
      const back = rotatedEllipseAlpha(x, y, -0.28, 0.12, 0.48, 0.25, -0.2);
      const middle = rotatedEllipseAlpha(x, y, 0.04, -0.08, 0.58, 0.29, 0.12);
      const front = rotatedEllipseAlpha(x, y, 0.38, 0.14, 0.4, 0.22, 0.28);
      return clamp01(Math.max(back * 0.62, middle * 0.82, front));
    }
    case "cross-hatch": {
      const frequency = 3 + (variant % 3);
      const firstPosition = ((x + y + 2) * frequency) / 4;
      const secondPosition = ((x - y + 2) * frequency) / 4;
      const firstDistance = Math.abs(firstPosition - Math.round(firstPosition));
      const secondDistance = Math.abs(secondPosition - Math.round(secondPosition));
      const lineWidth = 0.045 + (variant % 4) * 0.008;
      const lines = Math.max(
        smoothEdge(firstDistance, lineWidth * 0.35, lineWidth),
        smoothEdge(secondDistance, lineWidth * 0.35, lineWidth)
      );
      return lines * smoothEdge(Math.max(absX, absY), 0.82, 0.98);
    }
    case "halftone": {
      const cells = 4 + (variant % 3);
      const gridX = ((x + 1) / 2) * cells;
      const gridY = ((y + 1) / 2) * cells;
      const localX = gridX - Math.floor(gridX) - 0.5;
      const localY = gridY - Math.floor(gridY) - 0.5;
      const dotRadius = 0.22 + (variant % 5) * 0.025;
      const dot = smoothEdge(Math.hypot(localX, localY), dotRadius * 0.72, dotRadius);
      return dot * smoothEdge(Math.max(absX, absY), 0.84, 0.98);
    }
    case "weave": {
      const frequency = 5 + (variant % 3);
      const gridX = ((x + 1) / 2) * frequency;
      const gridY = ((y + 1) / 2) * frequency;
      const column = Math.floor(gridX);
      const row = Math.floor(gridY);
      const localX = Math.abs(gridX - column - 0.5);
      const localY = Math.abs(gridY - row - 0.5);
      const vertical = smoothEdge(localX, 0.08, 0.22) * ((column + row) % 2 === 0 ? 1 : 0.48);
      const horizontal = smoothEdge(localY, 0.08, 0.22) * ((column + row) % 2 === 0 ? 0.48 : 1);
      return Math.max(vertical, horizontal) * smoothEdge(Math.max(absX, absY), 0.84, 0.98);
    }
    case "fold": {
      const count = 3 + (variant % 4);
      let alpha = 0;
      for (let fold = 0; fold < count; fold++) {
        const origin = -0.68 + fold * (1.36 / Math.max(1, count - 1));
        const curve = Math.sin((y + 1) * (1.4 + fold * 0.18) + phase) * (0.08 + fold * 0.012);
        const width = 0.035 + ((fold + variant) % 3) * 0.012;
        alpha = Math.max(alpha, smoothEdge(Math.abs(x - origin - curve), width * 0.35, width));
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.84, 0.99);
    }
    case "pine": {
      let alpha = smoothEdge(Math.abs(y), 0.018, 0.055) * smoothEdge(absX, 0.72, 0.9);
      const count = 5 + (variant % 3);
      for (let needle = 0; needle < count; needle++) {
        const originX = -0.65 + needle * (1.3 / Math.max(1, count - 1));
        const length = 0.42 + ((needle + variant) % 3) * 0.08;
        const lean = 0.14 + (needle % 2) * 0.05;
        for (const direction of [-1, 1] as const) {
          const distance = distanceToSegment(
            x,
            y,
            originX,
            0,
            originX + lean,
            direction * length
          );
          alpha = Math.max(alpha, smoothEdge(distance, 0.012, 0.038));
        }
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.86, 1);
    }
    case "fan-bristle": {
      // Seven dry bristle rays opening from a loaded ferrule. Fixed loop keeps tip generation
      // cheap and deterministic while producing a true fan rather than a stretched round stamp.
      const count = 6 + (variant % 3);
      let alpha = 0;
      for (let bristle = 0; bristle < count; bristle++) {
        const amount = count === 1 ? 0.5 : bristle / (count - 1);
        const endX = -0.82 + amount * 1.64;
        const endY = -0.7 + Math.abs(amount - 0.5) * 0.16;
        const distance = distanceToSegment(x, y, 0, 0.72, endX, endY);
        const width = 0.018 + ((bristle + variant) % 3) * 0.008;
        alpha = Math.max(alpha, smoothEdge(distance, width * 0.28, width));
      }
      const ferrule = rotatedEllipseAlpha(x, y, 0, 0.66, 0.28, 0.16, 0);
      return clamp01(Math.max(alpha, ferrule * 0.7) * smoothEdge(radius, 0.9, 1.04));
    }
    case "knife-edge": {
      const angle = -0.24 + (variant % 4) * 0.025;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const localX = x * cosine + y * sine;
      const localY = -x * sine + y * cosine;
      const blade = smoothEdge(
        Math.max(Math.abs(localX + 0.05) / 0.88, Math.abs(localY) / 0.105),
        0.72,
        1
      );
      const loadedCorner = rotatedEllipseAlpha(localX, localY, 0.63, 0.08, 0.24, 0.18, -0.28);
      const scrapedGap = rotatedEllipseAlpha(localX, localY, -0.14, -0.015, 0.18, 0.055, 0);
      return clamp01(Math.max(blade, loadedCorner * 0.92) * (1 - scrapedGap * 0.72));
    }
    case "salt-crystal": {
      let alpha = 0;
      const crystalCount = 5 + (variant % 3);
      for (let crystal = 0; crystal < crystalCount; crystal++) {
        const turn = crystal * 2.399_963 + phase;
        const orbit = crystal === 0 ? 0 : 0.26 + (crystal % 3) * 0.19;
        const centerX = Math.cos(turn) * orbit;
        const centerY = Math.sin(turn) * orbit;
        const arm = 0.1 + (crystal % 2) * 0.035;
        const horizontal = distanceToSegment(
          x,
          y,
          centerX - arm,
          centerY,
          centerX + arm,
          centerY
        );
        const vertical = distanceToSegment(
          x,
          y,
          centerX,
          centerY - arm,
          centerX,
          centerY + arm
        );
        const diagonal = distanceToSegment(
          x,
          y,
          centerX - arm * 0.7,
          centerY - arm * 0.7,
          centerX + arm * 0.7,
          centerY + arm * 0.7
        );
        alpha = Math.max(
          alpha,
          smoothEdge(Math.min(horizontal, vertical, diagonal), 0.012, 0.04)
        );
      }
      return alpha * smoothEdge(radius, 0.84, 1);
    }
    case "bloom-ring": {
      const angle = Math.atan2(y, x);
      const irregularRadius = 0.62
        + Math.sin(angle * (5 + variant % 3) + phase) * 0.08
        + Math.sin(angle * 3 - phase) * 0.035;
      const ring = smoothEdge(Math.abs(radius - irregularRadius), 0.025, 0.11);
      const pigmentPool = smoothEdge(radius, 0.05, irregularRadius * 0.88) * 0.18;
      const brokenEdge = 0.72 + hashUnit(
        Math.round(x * 37),
        Math.round(y * 37),
        variant + 0x3d
      ) * 0.28;
      return clamp01(Math.max(ring * brokenEdge, pigmentPool));
    }
    case "ribbon-fold": {
      const wave = Math.sin((y + 1) * (2.2 + (variant % 3) * 0.18) + phase) * 0.28;
      const bandDistance = Math.abs(x - wave);
      const band = smoothEdge(bandDistance, 0.16, 0.28);
      const highlight = smoothEdge(Math.abs(x - wave + 0.09), 0.012, 0.045) * 0.42;
      const foldShadow = smoothEdge(
        Math.abs(x - wave - Math.sin(y * 5 + phase) * 0.035),
        0.04,
        0.09
      ) * (0.42 + clamp01((y + 1) / 2) * 0.36);
      return clamp01(Math.max(band * (0.62 + foldShadow), highlight))
        * smoothEdge(Math.max(absX, absY), 0.86, 1);
    }
    case "chain-link": {
      let alpha = 0;
      for (const [centerX, centerY, linkAngle] of [
        [-0.27, 0.18, -0.48],
        [0.28, -0.18, 0.48],
      ] as const) {
        const outer = rotatedEllipseAlpha(x, y, centerX, centerY, 0.42, 0.25, linkAngle);
        const inner = rotatedEllipseAlpha(x, y, centerX, centerY, 0.26, 0.105, linkAngle);
        alpha = Math.max(alpha, outer * (1 - inner * 0.96));
      }
      return alpha * smoothEdge(radius, 0.86, 1.04);
    }
    case "lace-scallop": {
      let alpha = smoothEdge(Math.abs(y + 0.34), 0.018, 0.05)
        * smoothEdge(absX, 0.82, 0.98);
      for (let scallop = 0; scallop < 4; scallop++) {
        const centerX = -0.66 + scallop * 0.44;
        const ringRadius = Math.hypot((x - centerX) / 0.23, (y - 0.02) / 0.32);
        const lowerHalf = y >= -0.06 ? 1 : smoothEdge(Math.abs(y + 0.06), 0, 0.08);
        alpha = Math.max(alpha, smoothEdge(Math.abs(ringRadius - 1), 0.03, 0.12) * lowerHalf);
        alpha = Math.max(
          alpha,
          rotatedEllipseAlpha(x, y, centerX, 0.48, 0.055, 0.055, 0) * 0.86
        );
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.88, 1);
    }
    case "stitch-dash": {
      let alpha = 0;
      for (let stitch = 0; stitch < 4; stitch++) {
        const centerY = -0.72 + stitch * 0.48;
        const offset = stitch % 2 === 0 ? -0.08 : 0.08;
        const distance = distanceToSegment(
          x,
          y,
          -0.52 + offset,
          centerY,
          0.52 + offset,
          centerY + 0.06
        );
        alpha = Math.max(alpha, smoothEdge(distance, 0.018, 0.055));
        alpha = Math.max(alpha, rotatedEllipseAlpha(x, y, -0.55 + offset, centerY, 0.06, 0.06, 0));
        alpha = Math.max(alpha, rotatedEllipseAlpha(x, y, 0.55 + offset, centerY + 0.06, 0.06, 0.06, 0));
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.88, 1);
    }
    case "knit-loop": {
      let alpha = 0;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          const centerX = -0.58 + column * 0.58 + (row % 2) * 0.08;
          const centerY = -0.58 + row * 0.58;
          const left = distanceToSegment(
            x,
            y,
            centerX - 0.2,
            centerY - 0.2,
            centerX,
            centerY + 0.23
          );
          const right = distanceToSegment(
            x,
            y,
            centerX + 0.2,
            centerY - 0.2,
            centerX,
            centerY + 0.23
          );
          alpha = Math.max(alpha, smoothEdge(Math.min(left, right), 0.018, 0.055));
        }
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.87, 1);
    }
    case "metal-scratch": {
      let alpha = 0;
      const count = 6 + (variant % 4);
      for (let scratch = 0; scratch < count; scratch++) {
        const centerY = -0.72 + scratch * (1.44 / Math.max(1, count - 1));
        const startX = -0.78 + hashUnit(scratch, variant, 91) * 0.35;
        const length = 0.72 + hashUnit(scratch, variant, 193) * 0.82;
        const rise = ((scratch + variant) % 3 - 1) * 0.12;
        const distance = distanceToSegment(
          x,
          y,
          startX,
          centerY,
          Math.min(0.88, startX + length),
          centerY + rise
        );
        const width = 0.014 + (scratch % 3) * 0.007;
        alpha = Math.max(alpha, smoothEdge(distance, width * 0.25, width));
      }
      return alpha * smoothEdge(Math.max(absX, absY), 0.86, 1);
    }
    case "smoke-wisp": {
      let alpha = 0;
      for (let strand = 0; strand < 3; strand++) {
        const center = (strand - 1) * 0.28;
        const wave = center
          + Math.sin((y + 1) * (2.3 + strand * 0.37) + phase + strand) * (0.16 + strand * 0.025);
        const width = 0.09 + strand * 0.035 + (1 - clamp01((y + 1) / 2)) * 0.04;
        alpha = Math.max(
          alpha,
          smoothEdge(Math.abs(x - wave), width * 0.28, width) * (0.52 + strand * 0.16)
        );
      }
      const haze = smoothEdge(Math.hypot(x * 0.84, y), 0.35, 0.96) * 0.18;
      return clamp01(Math.max(alpha, haze) * smoothEdge(Math.max(absX, absY), 0.88, 1));
    }
    case "flame-tongue": {
      const normalizedY = clamp01((y + 0.92) / 1.84);
      const halfWidth = Math.max(
        0.04,
        Math.sin(normalizedY * Math.PI) * 0.52 * (1 - normalizedY * 0.48)
      );
      const center = Math.sin(normalizedY * 5.2 + phase) * (0.05 + normalizedY * 0.14);
      const body = smoothEdge(Math.abs(x - center), halfWidth * 0.66, halfWidth);
      const inner = smoothEdge(
        Math.hypot((x + 0.08) / 0.22, (y - 0.3) / 0.5),
        0.45,
        1
      ) * 0.36;
      const spark = rotatedEllipseAlpha(x, y, 0.56, -0.55, 0.055, 0.12, -0.28) * 0.82;
      return clamp01(Math.max(body * smoothEdge(absY, 0.78, 0.98), inner, spark));
    }
    case "bokeh-ring": {
      const irregularity = Math.sin(Math.atan2(y, x) * 6 + phase) * 0.015;
      const ring = smoothEdge(Math.abs(radius - 0.64 - irregularity), 0.035, 0.11);
      const highlight = rotatedEllipseAlpha(x, y, -0.3, -0.34, 0.11, 0.07, -0.4) * 0.7;
      const centerGlow = smoothEdge(radius, 0, 0.54) * 0.1;
      return clamp01(Math.max(ring, highlight, centerGlow));
    }
    case "flower-petal": {
      let alpha = 0;
      const petalCount = 5 + (variant % 2);
      for (let petal = 0; petal < petalCount; petal++) {
        const turn = -Math.PI / 2 + petal * ((Math.PI * 2) / petalCount) + phase * 0.08;
        alpha = Math.max(
          alpha,
          rotatedEllipseAlpha(
            x,
            y,
            Math.cos(turn) * 0.38,
            Math.sin(turn) * 0.38,
            0.2,
            0.43,
            turn + Math.PI / 2
          )
        );
      }
      const center = smoothEdge(radius, 0.08, 0.2);
      return clamp01(Math.max(alpha * 0.86, center));
    }
    case "rock-shard": {
      const skewX = x + y * 0.22;
      const outer = smoothEdge(
        Math.max(
          Math.abs(skewX) / (0.72 - y * 0.08),
          Math.abs(y + x * 0.09) / (0.78 + x * 0.05)
        ),
        0.72,
        0.98
      );
      const crackA = distanceToSegment(x, y, -0.5, -0.2, 0.12, 0.12);
      const crackB = distanceToSegment(x, y, 0.12, 0.12, 0.48, -0.46);
      const cracks = Math.max(
        smoothEdge(crackA, 0.012, 0.045),
        smoothEdge(crackB, 0.012, 0.04)
      );
      const chip = rotatedEllipseAlpha(x, y, 0.54, 0.52, 0.17, 0.12, 0.45);
      return clamp01(Math.max(outer * (1 - cracks * 0.82), chip * 0.74));
    }
    case "brick": {
      const columns = 3;
      const rows = 4;
      const gridX = ((x + 1) / 2) * columns;
      const gridY = ((y + 1) / 2) * rows;
      const row = Math.floor(gridY);
      const shiftedX = gridX + (row % 2 === 0 ? 0 : 0.5);
      const mortarX = Math.abs(shiftedX - Math.round(shiftedX));
      const mortarY = Math.abs(gridY - Math.round(gridY));
      const mortar = Math.max(
        smoothEdge(mortarX, 0.025, 0.095),
        smoothEdge(mortarY, 0.025, 0.095)
      );
      const faceNoise = 0.5 + hashUnit(
        Math.floor(shiftedX),
        Math.floor(gridY),
        variant + 0x51
      ) * 0.34;
      return clamp01(Math.max(mortar, faceNoise * 0.28))
        * smoothEdge(Math.max(absX, absY), 0.88, 1);
    }
    case "curl": {
      const polarAngle = Math.atan2(y, x);
      const turns = 1.55 + (variant % 3) * 0.12;
      let alpha = 0;
      for (let turn = 0; turn < 3; turn++) {
        const unwrappedAngle = polarAngle + turn * Math.PI * 2;
        const targetRadius = 0.12 + unwrappedAngle / (Math.PI * 2 * turns) * 0.76;
        if (targetRadius < 0 || targetRadius > 0.96) continue;
        alpha = Math.max(
          alpha,
          smoothEdge(Math.abs(radius - targetRadius), 0.018, 0.055)
        );
      }
      const tail = smoothEdge(distanceToSegment(x, y, 0.72, -0.2, 0.88, -0.72), 0.016, 0.05);
      return Math.max(alpha, tail) * smoothEdge(radius, 0.88, 1);
    }
    case "sesame": {
      let alpha = 0;
      const seedCount = 7 + (variant % 4);
      for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
        const turn = seedIndex * 2.399_963 + phase;
        const orbit = 0.18 + (seedIndex % 4) * 0.18;
        const centerX = Math.cos(turn) * orbit;
        const centerY = Math.sin(turn) * orbit;
        alpha = Math.max(
          alpha,
          rotatedEllipseAlpha(
            x,
            y,
            centerX,
            centerY,
            0.07 + (seedIndex % 2) * 0.012,
            0.16,
            turn + 0.4
          )
        );
      }
      return alpha * smoothEdge(radius, 0.88, 1);
    }
    case "focus-ray": {
      let alpha = 0;
      const rayCount = 7 + (variant % 3);
      for (let ray = 0; ray < rayCount; ray++) {
        const turn = -0.86 + ray * (1.72 / Math.max(1, rayCount - 1));
        const startRadius = 0.18 + (ray % 3) * 0.07;
        const endRadius = 0.94;
        const distance = distanceToSegment(
          x,
          y,
          Math.cos(turn) * startRadius,
          Math.sin(turn) * startRadius,
          Math.cos(turn) * endRadius,
          Math.sin(turn) * endRadius
        );
        const width = 0.012 + (ray % 3) * 0.006;
        alpha = Math.max(alpha, smoothEdge(distance, width * 0.25, width));
      }
      return alpha * smoothEdge(radius, 0.86, 1);
    }
    case "footstep": {
      let alpha = 0;
      for (const [centerX, centerY, mirror] of [
        [-0.3, 0.3, 1],
        [0.3, -0.3, -1],
      ] as const) {
        const localX = (x - centerX) * mirror;
        const localY = y - centerY;
        const soleX = (localX + 0.04) / 0.2;
        const soleY = (localY + 0.01) / 0.34;
        alpha = Math.max(alpha, smoothEdge(Math.hypot(soleX, soleY), 0.7, 1));
        for (let toe = 0; toe < 4; toe++) {
          const toeX = -0.16 + toe * 0.1;
          const toeY = -0.4 - Math.abs(toe - 1.5) * 0.018;
          const toeRadius = 0.055 - Math.abs(toe - 1.5) * 0.006;
          alpha = Math.max(
            alpha,
            smoothEdge(Math.hypot(localX - toeX, localY - toeY), toeRadius * 0.48, toeRadius)
          );
        }
      }
      return alpha;
    }
    case "heart": {
      const hx = x * 1.04;
      const hy = -(y + 0.08) * 1.06;
      const implicit = Math.pow(hx * hx + hy * hy - 0.58, 3) - hx * hx * hy * hy * hy;
      if (implicit > 0.04) return 0;
      return smoothEdge(implicit, -0.08, 0.04) * smoothEdge(radius, 0.86, 1.02);
    }
  }
}

function buildCustomTipBytes(
  motif: StudioBrushPackCustomTipMotif,
  variant: number,
  size = CUSTOM_TIP_SIZE
): Uint8Array {
  const bytes = new Uint8Array(size * size);
  const center = (size - 1) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = center === 0 ? 0 : (px - center) / center;
      const y = center === 0 ? 0 : (py - center) / center;
      bytes[py * size + px] = Math.round(clamp01(customTipAlpha(motif, x, y, variant)) * 255);
    }
  }
  return bytes;
}

/** Materialize a deterministic procedural/custom alpha tip without any external image asset. */
export function materializeStudioBrushPackTipSettings(
  motif: StudioBrushPackTipMotif,
  variant = 0,
  softness = 0.2
): NormalizedStudioBrushTipSettings {
  if (!CUSTOM_MOTIF_SET.has(motif)) {
    return normalizeStudioBrushTipSettings({ shape: motif, softness });
  }
  const customMotif = motif as StudioBrushPackCustomTipMotif;
  return normalizeStudioBrushTipSettings({
    shape: "hard",
    softness,
    alphaMapSize: CUSTOM_TIP_SIZE,
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(
      buildCustomTipBytes(customMotif, variant)
    ),
  });
}

function profileSoftness(descriptor: StudioBrushPackDescriptor, index: number): number {
  if (descriptor.runtimeBrushId === "airbrush") return 0.58 + (index % 5) * 0.065;
  if (descriptor.runtimeBrushId === "dry-media") return 0.08 + (index % 6) * 0.055;
  return 0.04 + (index % 5) * 0.045;
}

function pressureWidthMapping(
  descriptor: StudioBrushPackDescriptor,
  index: number
): StudioBrushDynamicsMappingSettings {
  const dry = descriptor.runtimeBrushId === "dry-media";
  const soft = descriptor.runtimeBrushId === "airbrush";
  return {
    source: "pressure",
    from: dry ? 0.5 + (index % 3) * 0.06 : soft ? 0.7 : 0.22 + (index % 4) * 0.07,
    to: dry ? 1.2 + (index % 4) * 0.08 : soft ? 1.12 + (index % 3) * 0.06 : 1.42 + (index % 5) * 0.075,
    curve: 0.78 + (index % 6) * 0.11,
  };
}

function angleMappings(flags: number): readonly StudioBrushDynamicsMappingSettings[] {
  if ((flags & FOLLOW_DIRECTION) === 0) return [];
  return [{ source: "direction", mode: "add", from: 0, to: 360 }];
}

function colorDynamicsFor(
  descriptor: StudioBrushPackDescriptor,
  index: number
): StudioBrushDynamicsSettings["colorDynamics"] {
  if (descriptor.category === "foliage") {
    return {
      hueJitter: 5 + (index % 4) * 1.5,
      saturationJitter: 0.035 + (index % 3) * 0.015,
      valueJitter: 0.055 + (index % 4) * 0.012,
    };
  }
  if (
    descriptor.category === "pattern"
    || descriptor.category === "stamp"
    || descriptor.category === "tone"
    || descriptor.category === "effect"
  ) {
    return {
      hueJitter: 2 + (index % 3),
      saturationJitter: 0.02,
      valueJitter: 0.035 + (index % 3) * 0.012,
    };
  }
  if (descriptor.category === "paint" || descriptor.category === "marker") {
    return { valueJitter: 0.018 + (index % 4) * 0.009 };
  }
  return undefined;
}

function grainFor(
  descriptor: StudioBrushPackDescriptor,
  index: number
): StudioBrushDynamicsSettings["grain"] {
  const textured = descriptor.category === "sketch"
    || descriptor.category === "chalk"
    || descriptor.category === "texture"
    || descriptor.category === "rake";
  if (!textured) return undefined;
  return {
    space: index % 2 === 0 ? "canvas-fixed" : "stroke-fixed",
    amount: descriptor.category === "texture"
      ? 0.34 + (index % 4) * 0.055
      : 0.2 + (index % 4) * 0.045,
    scale: 2.5 + (index % 7) * 1.15,
    contrast: 0.38 + (index % 5) * 0.09,
    seed: (0x6d2b_79f5 + Math.imul(index + 3, 0x85eb_ca6b)) >>> 0,
  };
}

function tipLayersFor(
  descriptor: StudioBrushPackDescriptor,
  motif: StudioBrushPackTipMotif,
  index: number
): readonly StudioBrushTipLayerSettings[] | undefined {
  if (
    motif === "salt-crystal"
    || motif === "bloom-ring"
    || motif === "smoke-wisp"
    || motif === "flame-tongue"
    || motif === "bokeh-ring"
  ) {
    const secondaryMotif: StudioBrushPackTipMotif = motif === "salt-crystal"
      ? "sponge"
      : motif === "flame-tongue"
        ? "star"
        : "soft";
    return [
      {
        tip: materializeStudioBrushPackTipSettings(secondaryMotif, index + 131, 0.54),
        scale: motif === "smoke-wisp" ? 1.42 : 0.72,
        opacity: motif === "smoke-wisp" || motif === "bloom-ring" ? 0.28 : 0.48,
        offsetX: 0.26,
        offsetY: -0.34,
        angle: 18,
        roundness: 0.82,
      },
      {
        tip: materializeStudioBrushPackTipSettings(motif, index + 257, 0.16),
        scale: 0.5,
        opacity: 0.38,
        offsetX: -0.4,
        offsetY: 0.38,
        angle: -24,
        roundness: 0.68,
      },
    ];
  }
  if (
    motif === "ribbon-fold"
    || motif === "chain-link"
    || motif === "lace-scallop"
    || motif === "stitch-dash"
    || motif === "knit-loop"
    || motif === "brick"
  ) {
    return [{
      tip: materializeStudioBrushPackTipSettings(motif, index + 97, 0.08),
      scale: 0.58,
      opacity: 0.48,
      offsetY: 0.48,
      angle: motif === "chain-link" ? 90 : 8,
      roundness: 0.76,
    }];
  }
  if (
    motif === "flower-petal"
    || motif === "rock-shard"
    || motif === "curl"
    || motif === "sesame"
    || motif === "focus-ray"
  ) {
    return [{
      tip: materializeStudioBrushPackTipSettings(motif, index + 149, 0.08),
      scale: 0.56,
      opacity: 0.52,
      offsetX: 0.36,
      offsetY: -0.32,
      angle: 26,
      roundness: 0.74,
    }];
  }
  if (descriptor.category === "rake") {
    return [
      {
        tip: materializeStudioBrushPackTipSettings(motif, index + 101, 0.12),
        scale: 0.78,
        opacity: 0.62,
        offsetY: -0.48,
        angle: -3,
        roundness: 0.82,
      },
      {
        tip: materializeStudioBrushPackTipSettings(motif, index + 211, 0.16),
        scale: 0.64,
        opacity: 0.46,
        offsetY: 0.5,
        angle: 4,
        roundness: 0.7,
      },
    ];
  }
  if (descriptor.category === "foliage" && motif === "pine") {
    return [
      {
        tip: materializeStudioBrushPackTipSettings("pine", index + 79, 0.08),
        scale: 0.72,
        opacity: 0.64,
        offsetX: 0.34,
        offsetY: -0.28,
        angle: 18,
        roundness: 0.7,
      },
      {
        tip: materializeStudioBrushPackTipSettings("hair", index + 37, 0.1),
        scale: 0.34,
        opacity: 0.4,
        offsetX: -0.38,
        offsetY: 0.3,
        angle: -16,
        roundness: 0.54,
      },
    ];
  }
  if (descriptor.category === "foliage") {
    return [
      {
        tip: materializeStudioBrushPackTipSettings("leaf", index + 79, 0.1),
        scale: 0.7,
        opacity: 0.68,
        offsetX: 0.4,
        offsetY: -0.32,
        angle: 24,
        roundness: 0.72,
      },
      {
        tip: materializeStudioBrushPackTipSettings("round", index, 0.18),
        scale: 0.3,
        opacity: 0.42,
        offsetX: -0.42,
        offsetY: 0.28,
        angle: -18,
        roundness: 0.8,
      },
    ];
  }
  if (
    descriptor.category === "pattern"
    && (motif === "oval-stack" || motif === "stripe" || motif === "checker")
  ) {
    return [{
      tip: materializeStudioBrushPackTipSettings(motif, index + 53, 0.14),
      scale: 0.62,
      opacity: 0.58,
      offsetY: 0.52,
      angle: 12,
      roundness: 0.78,
    }];
  }
  return undefined;
}

/** Expand one compact catalogue row into a detached, finite, renderer-ready settings snapshot. */
export function materializeStudioBrushPackDynamics(
  value: unknown
): NormalizedStudioBrushDynamicsSettings | null {
  const descriptor = studioBrushPackDescriptorById(value);
  if (!descriptor) return null;
  const index = STUDIO_BRUSH_PACK_CATALOG_IDS.indexOf(descriptor.catalogId);
  const profile = COMPACT_PROFILE_ROWS[index]!;
  const motif = profile[0];
  const flags = profile[5];
  const tuning = studioBrushPackExpansionTuningById(descriptor.catalogId);
  const base = studioBrushDynamicsPresetSettings(descriptor.runtimeBrushId);
  const widthMapping = pressureWidthMapping(descriptor, index);
  const opacityMappings: StudioBrushDynamicsMappingSettings[] = (flags & PRESSURE_OPACITY) !== 0
    ? [{ source: "pressure", from: 0.32 + (index % 4) * 0.07, to: 1, curve: 0.82 + (index % 5) * 0.1 }]
    : [];
  const spacingMappings: StudioBrushDynamicsMappingSettings[] = (flags & SPEED_SPACING) !== 0
    ? [{ source: "speed", from: 0.78, to: 1.3 + (index % 4) * 0.08 }]
    : [];
  const seed = (0x51f1_5e5d + Math.imul(index + 1, 0x9e37_79b1)) >>> 0;
  const spacingBase = descriptor.runtimeBrushId === "airbrush"
    ? 0.18
    : descriptor.runtimeBrushId === "dry-media" ? 0.2 : 0.12;
  const scatterBase = descriptor.runtimeBrushId === "airbrush"
    ? 0.2
    : descriptor.runtimeBrushId === "dry-media" ? 0.04 : 0;
  // Toolbar opacity is stored on the draw element and multiplied after every planned dab. Keep
  // the dynamics opacity neutral so a 34% catalogue default is not applied twice (0.34²) before
  // flow/pressure. Media character belongs to flow; the artist's opacity lock remains an outer,
  // predictable control.
  const flowBase = descriptor.runtimeBrushId === "airbrush"
    ? 0.22 + (index % 4) * 0.035
    : descriptor.runtimeBrushId === "dry-media"
      ? 0.46 + (index % 5) * 0.045
      : 0.72 + (index % 4) * 0.055;
  const settings: StudioBrushDynamicsSettings = {
    ...base,
    depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
    seed,
    fallbackPressure: 0.48 + (index % 5) * 0.025,
    maxSpeed: 1.2 + (index % 7) * 0.14,
    tip: materializeStudioBrushPackTipSettings(
      // The causal G-pen's pressure/roundness channels already describe the nib silhouette. A
      // round primitive keeps that same ellipse on the renderer's exact one-mark fast path.
      descriptor.catalogId === "g-pen-flex" ? "round" : motif,
      index,
      // The 3% software feather previously expanded every G-pen dab into a 5×5 alpha lattice.
      // Canvas already antialiases the primitive at the sub-pixel edge, so that lattice added
      // pointer latency without a visible benefit and exhausted the live mark budget on ordinary
      // curves. Persisted older snapshots retain their serialized hard-tip settings and pixels.
      descriptor.catalogId === "g-pen-flex"
        ? 0
        : tuning?.tipSoftness ?? profileSoftness(descriptor, index)
    ),
    colorDynamics: colorDynamicsFor(descriptor, index),
    grain: grainFor(descriptor, index),
    tipLayers: tipLayersFor(descriptor, motif, index),
    taper: {
      ...base.taper,
      enabled: (flags & TAPER) !== 0,
      startLength: 0.06 + (index % 5) * 0.018,
      endLength: 0.1 + (index % 6) * 0.018,
      minSizeRatio: 0.12 + (index % 4) * 0.06,
      minOpacityRatio: 0.34 + (index % 5) * 0.07,
      curve: 0.82 + (index % 6) * 0.12,
    },
    width: {
      ...base.width,
      base: descriptor.defaultWidth,
      mappings: [widthMapping],
      jitter: (flags & WIDTH_GRAIN) !== 0
        ? { mode: "multiply", amount: 0.035 + (index % 6) * 0.022 }
        : null,
    },
    opacity: {
      ...base.opacity,
      base: 1,
      mappings: opacityMappings,
      jitter: descriptor.runtimeBrushId === "dry-media"
        ? { mode: "multiply", amount: 0.04 + (index % 5) * 0.018 }
        : null,
    },
    flow: {
      ...base.flow,
      base: Math.min(1, flowBase),
      mappings: (flags & PRESSURE_OPACITY) !== 0
        ? [{ source: "pressure", from: 0.58, to: 1, curve: 0.9 + (index % 3) * 0.12 }]
        : [],
    },
    spacingRatio: Math.max(0.02, spacingBase + profile[1] + (index % 11) * 0.0031),
    spacing: { ...base.spacing, mappings: spacingMappings },
    scatterRatio: Math.max(0, scatterBase + profile[2] + (index % 13) * 0.0027),
    scatter: {
      ...base.scatter,
      mappings: profile[2] > 0.1
        ? [{ source: "speed", from: 0.62, to: 1.18 + (index % 5) * 0.08 }]
        : [],
      jitter: profile[2] > 0.02 ? { mode: "add", amount: 0.08 + (index % 7) * 0.025 } : null,
    },
    angle: {
      ...base.angle,
      base: profile[4] + ((index % 3) - 1) * 1.5,
      mappings: angleMappings(flags),
      jitter: (flags & ANGLE_GRAIN) !== 0
        ? { mode: "add", amount: 3 + (index % 7) * 2.25 }
        : null,
    },
    roundness: {
      ...base.roundness,
      base: profile[3],
      mappings: motif === "chisel" || motif === "leaf" || motif === "leaf-cluster"
        ? [{ source: "tilt-magnitude", from: 1, to: 0.72, amount: 0.5 }]
        : [],
      jitter: (flags & WIDTH_GRAIN) !== 0
        ? { mode: "multiply", amount: 0.025 + (index % 4) * 0.018 }
        : null,
    },
  };
  if (tuning) {
    // Expansion presets replace the index-derived formula with hand-tuned physics. Catalogue
    // width and the neutral dynamics opacity stay invariant so the toolbar remains the artist's
    // outer control (same contract as the formula path above).
    const tuned = applyStudioBrushPackExpansionTuning(settings, tuning);
    return applyStudioBrushContinuousCarrierQualityPolicy({
      runtimeBrushId: descriptor.runtimeBrushId,
      category: descriptor.category,
      previewStyle: descriptor.previewStyle,
      settings: normalizeStudioBrushDynamicsSettings({
        ...tuned,
        width: { ...tuned.width, base: descriptor.defaultWidth },
        opacity: { ...tuned.opacity, base: 1 },
      }),
    });
  }
  return applyStudioBrushContinuousCarrierQualityPolicy({
    runtimeBrushId: descriptor.runtimeBrushId,
    category: descriptor.category,
    previewStyle: descriptor.previewStyle,
    settings: normalizeStudioBrushDynamicsSettings(settings),
  });
}

/**
 * Materialize the serializable selection contract consumed by StudioPage. The catalogue id/name
 * remain available for UI history while runtimeBrushId + brushDynamics are sufficient to replay.
 */
function materializeStudioBrushPackSelectionInternal(
  value: unknown,
  dualTipValue: unknown,
  dualTipRequested: boolean
): StudioBrushPackSelection | null {
  const descriptor = studioBrushPackDescriptorById(value);
  if (!descriptor) return null;
  const brushDynamics = materializeStudioBrushPackDynamics(descriptor.catalogId);
  if (!brushDynamics) return null;
  const dualTip = dualTipRequested
    ? normalizeStudioBrushPackDualTipDescriptor(
      dualTipValue,
      brushDynamics.dualBrush?.tip ?? brushDynamics.tip
    )
    : null;
  if (dualTipRequested && !dualTip) return null;
  return {
    catalogId: descriptor.catalogId,
    catalogName: descriptor.catalogName,
    operation: "paint",
    defaultWidth: descriptor.defaultWidth,
    defaultOpacity: descriptor.defaultOpacity,
    runtimeBrushId: descriptor.runtimeBrushId,
    brushDynamics,
    ...(dualTip ? { dualTip } : {}),
    mediaGroup: descriptor.mediaGroup,
    previewStyle: descriptor.previewStyle,
    shortName: descriptor.shortName,
    hint: descriptor.hint,
  };
}

/** Legacy materialization entry point. Its one-argument callback behavior remains unchanged. */
export function materializeStudioBrushPackSelection(
  value: unknown
): StudioBrushPackSelection | null {
  return materializeStudioBrushPackSelectionInternal(value, undefined, false);
}

/** Explicit opt-in materialization boundary for the next-generation dual-tip descriptor. */
export function materializeStudioBrushPackSelectionWithDualTip(
  value: unknown,
  dualTipValue: unknown
): StudioBrushPackSelection | null {
  return materializeStudioBrushPackSelectionInternal(value, dualTipValue, true);
}

/** Stable cache/collaboration key for a fully materialized library behavior. */
export function studioBrushPackRuntimeSignature(
  value: unknown
): string | null {
  const selection = materializeStudioBrushPackSelection(value);
  if (!selection) return null;
  return `${selection.runtimeBrushId}:${serializeStudioBrushDynamicsSettingsCanonical(selection.brushDynamics)}`;
}

/** Dual-tip-aware signature without changing the callback arity/semantics of the legacy helper. */
export function studioBrushPackRuntimeSignatureWithDualTip(
  value: unknown,
  dualTipValue: unknown
): string | null {
  const selection = materializeStudioBrushPackSelectionWithDualTip(value, dualTipValue);
  if (!selection?.dualTip) return null;
  const legacy = `${selection.runtimeBrushId}:${serializeStudioBrushDynamicsSettingsCanonical(selection.brushDynamics)}`;
  return `${legacy}:dual-tip:${JSON.stringify(selection.dualTip)}`;
}

/** Eager materialization is intentionally opt-in; the library loader may call this after import. */
export function materializeAllStudioBrushPackSelections(): readonly StudioBrushPackSelection[] {
  return STUDIO_BRUSH_PACK_DESCRIPTORS.map((descriptor) =>
    materializeStudioBrushPackSelection(descriptor.catalogId)!
  );
}

function invalidStudioBrushPackDualTipResult(): StudioDualTipResult {
  return {
    ok: false,
    error: {
      code: "invalid-request",
      stage: "validation",
    },
  };
}

function studioBrushPackTipMapToR8(
  selection: StudioBrushPackSelection,
  role: "primary" | "secondary",
  tip: NormalizedStudioBrushTipSettings,
): StudioBrushPackDualTipR8Asset {
  const map = buildStudioBrushTipAlphaMap(tip);
  const bytes = Uint8Array.from(
    map.alphas,
    (alpha) => Math.round(Math.min(1, Math.max(0, alpha)) * 255),
  );
  return Object.freeze({
    assetId: `brush-pack:${selection.catalogId}:dual-tip:${role}`,
    width: map.size,
    height: map.size,
    channel: "alpha" as const,
    bytes,
    field: Object.freeze({
      width: map.size,
      height: map.size,
      alpha: Object.freeze(Array.from(bytes, (alpha) => alpha / 255)),
    }),
  });
}

/**
 * One canonical R8 materialization shared by CPU authority, exact WebGPU and saved replay.
 *
 * Quantizing once at this boundary prevents the CPU oracle from sampling an f32 procedural map
 * while WebGPU samples a different R8 representation.
 */
export function materializeStudioBrushPackDualTipR8(
  selection: StudioBrushPackSelection,
): StudioBrushPackDualTipR8Materialization | null {
  const selectionSource = dualTipRecord(selection);
  if (
    !selectionSource
    || !Object.prototype.hasOwnProperty.call(selectionSource, "dualTip")
    || selectionSource.dualTip === undefined
    || selectionSource.dualTip === null
  ) return null;
  const brushDynamics = normalizeStudioBrushDynamicsSettings(
    dualTipOwn(selectionSource, "brushDynamics"),
  );
  const descriptor = normalizeStudioBrushPackDualTipDescriptor(
    selectionSource.dualTip,
    brushDynamics.dualBrush?.tip ?? brushDynamics.tip,
  );
  if (!descriptor) return null;
  return Object.freeze({
    descriptor,
    primary: studioBrushPackTipMapToR8(selection, "primary", brushDynamics.tip),
    secondary: studioBrushPackTipMapToR8(
      selection,
      "secondary",
      descriptor.secondaryTip,
    ),
  });
}

/**
 * Optional bridge into the authoritative dual-tip CPU oracle.
 *
 * A null return is a deliberate single-tip pass-through signal: callers must continue through
 * their established renderer unchanged. A present but malformed descriptor returns a fail-closed
 * validation error, while oracle work/stamp budget failures are forwarded without partial output.
 */
export function renderStudioBrushPackDualTipIfConfigured(
  selection: StudioBrushPackSelection,
  input: StudioBrushPackDualTipRenderInput
): StudioDualTipResult | null {
  const selectionSource = dualTipRecord(selection);
  if (!selectionSource) return invalidStudioBrushPackDualTipResult();
  if (
    !Object.prototype.hasOwnProperty.call(selectionSource, "dualTip")
    || selectionSource.dualTip === undefined
    || selectionSource.dualTip === null
  ) {
    return null;
  }
  const inputSource = dualTipRecord(input);
  if (!inputSource) return invalidStudioBrushPackDualTipResult();
  const brushDynamics = normalizeStudioBrushDynamicsSettings(
    dualTipOwn(selectionSource, "brushDynamics")
  );
  const materialized = materializeStudioBrushPackDualTipR8(selection);
  if (!materialized) return invalidStudioBrushPackDualTipResult();
  const { descriptor, primary, secondary } = materialized;
  const diameterValue = dualTipOwn(inputSource, "diameter");
  const diameter = diameterValue === undefined
    ? brushDynamics.width.base
    : diameterValue as number;
  const spacingRatioValue = dualTipOwn(inputSource, "spacingRatio");
  const spacingRatio = spacingRatioValue === undefined
    ? brushDynamics.spacingRatio
      ?? brushDynamics.spacing.base / Math.max(0.1, diameter)
    : spacingRatioValue as number;
  const seedValue = dualTipOwn(inputSource, "seed");
  const selectionOpacity = dualTipOwn(selectionSource, "defaultOpacity");
  const opacityValue = dualTipOwn(inputSource, "opacity");

  return renderStudioDualBrushTip({
    contractVersion: descriptor.contractVersion,
    primary: primary.field,
    secondary: secondary.field,
    samples: dualTipOwn(inputSource, "samples") as readonly StudioDualTipStrokeSample[],
    combineMode: descriptor.combineMode,
    diameter,
    spacingRatio,
    seed: (seedValue === undefined ? brushDynamics.seed : seedValue) as number,
    opacity: (
      opacityValue === undefined
        ? selectionOpacity
        : opacityValue
    ) as number | undefined,
    linearColor: dualTipOwn(inputSource, "linearColor") as
      | readonly [number, number, number]
      | undefined,
    primaryTransform: descriptor.primaryTransform,
    secondaryTransform: descriptor.secondaryTransform,
    dynamics: descriptor.dynamics,
    jitter: descriptor.jitter,
    output: dualTipOwn(inputSource, "output") as StudioDualTipOutputSurface,
    workBudget: dualTipOwn(inputSource, "workBudget") as number | undefined,
  });
}
