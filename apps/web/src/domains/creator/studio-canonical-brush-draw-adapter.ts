/**
 * Pure DrawEl -> versioned canonical brush boundary.
 *
 * Legacy direct-dab strokes retain recipe v1. Stroke-local layered/bounded flow uses recipe v2 and
 * carries the exact normalized dynamics program. Any consumer without explicit v2 compositor and
 * retained-dynamics capabilities must reject it instead of approximating round Canvas dabs.
 */

import {
  isStudioBrushEraserAliasId,
  resolveStudioBrushAliasProfile,
  studioBrushAliasEffectiveDiameter,
} from "./brush/studio-brush-alias-profile";
import {
  normalizeStudioBrushDynamicsSettings,
  resolveStudioCapturedBrushDynamicsPresetId,
  studioBrushDynamicsSeedFromKey,
} from "./brush/studio-brush-dynamics";
import {
  composeStudioBrushDualTipAlphaMap,
  planNormalizedStudioBrushTipComposition,
} from "./brush/studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  sampleStudioBrushTipAlphaMap,
  studioBrushTipUsesSolidEllipse,
} from "./brush/studio-brush-tip-stamp";
import {
  isStudioInkPressureModel,
  studioInkFallbackPressure,
  studioInkUsesResidualDabSpacing,
} from "./brush/studio-ink-pressure-model";
import {
  isStudioStrokePaintModelCompatible,
  STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
  STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
} from "./brush/studio-stroke-paint-model";
import {
  STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ,
  STUDIO_WET_INK_BRUSH_SIMULATION_STEPS,
  resolveStudioWetInkBrushPhysicalRecipe,
  studioWetInkBrushRuntimeSupportsElement,
} from "./brush/studio-wet-ink-brush-runtime";
import { resolveStudioBrushRenderFamily } from "./studio-brush";
import {
  parseStudioCanonicalBrushPlan,
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
  STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION,
  STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION,
} from "./studio-canonical-brush-plan";
import { parseStudioColorToLinear } from "./studio-color-quality-engine";
import { sha256HexPortable } from "./studio-sha256";

import type {
  NormalizedStudioBrushDynamicsMapping,
  NormalizedStudioBrushDynamicsProperty,
  NormalizedStudioBrushDynamicsSettings,
} from "./brush/studio-brush-dynamics";
import type {
  NormalizedStudioBrushTipSettings,
  StudioBrushTipAlphaMap,
} from "./brush/studio-brush-tip-stamp";
import type { StudioEngineWebGpuTexturedBrushAssetPayload } from "./render/studio-engine-webgpu-textured-brush-plan";
import type {
  StudioCanonicalBrushAffineTransform,
  StudioCanonicalBrushColor,
  StudioCanonicalBrushComposite,
  StudioCanonicalBrushGrain,
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushPaintContractV2,
  StudioCanonicalBrushRecipe,
  StudioCanonicalBrushRecipeV1,
  StudioCanonicalBrushResponseCurve,
  StudioCanonicalBrushSourceSampleCandidate,
  StudioCanonicalBrushTip,
  StudioCanonicalBrushTipCompositionV2,
} from "./studio-canonical-brush-plan";
import type { StudioCanonicalBrushSpecialistLoweringRequirement } from "./studio-canonical-brush-webgpu-lowering";
import type { StudioLinearColorSpace } from "./studio-color-quality-engine";
import type { DrawEl } from "./studio-element-model";

export const STUDIO_CANONICAL_BRUSH_DRAW_ADAPTER_VERSION = 2 as const;

const MAX_RUNTIME_SPEED = 64;
const MAX_SOURCE_IDENTIFIER_CHARACTERS = 4_096;
const MAX_CANONICAL_COMPOSED_TIP_DIMENSION = 2_048;
const MAX_CANONICAL_COMPOSED_TIP_PIXELS =
  MAX_CANONICAL_COMPOSED_TIP_DIMENSION * MAX_CANONICAL_COMPOSED_TIP_DIMENSION;
const EPSILON = 1e-10;
const IDENTITY_CURVE = Object.freeze({
  minimum: 1,
  maximum: 1,
  exponent: 1,
}) satisfies StudioCanonicalBrushResponseCurve;

export interface StudioCanonicalBrushDrawAdapterRequest {
  readonly element: DrawEl;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly commandSequence: number;
  readonly firstSampleSequence: number;
  readonly firstTimeMilliseconds: number;
  /**
   * Used only when the snapshot has no persisted speed channel. It is explicit so replay never
   * depends on Date.now(), requestAnimationFrame cadence or the receiving machine.
   */
  readonly fallbackSampleIntervalMilliseconds: number;
  readonly pointerId?: number;
  readonly flags?: number;
  readonly colorSpace: StudioLinearColorSpace;
  readonly transform: StudioCanonicalBrushAffineTransform;
}

export type StudioCanonicalBrushDrawAdapterFailureReason =
  | "invalid-request"
  | "invalid-element"
  | "invalid-geometry"
  | "invalid-samples"
  | "invalid-color"
  | "invalid-composite"
  | "unsupported-geometry"
  | "unsupported-layer-effect"
  | "unsupported-paint-model"
  | "unsupported-brush"
  | "unsupported-dynamics"
  | "canonical-validation";

export interface StudioCanonicalBrushDrawAdapterRejection {
  readonly status: "rejected";
  readonly reason: StudioCanonicalBrushDrawAdapterFailureReason;
  readonly path: string;
  readonly detail: string;
}

export interface StudioCanonicalBrushDrawAdapterReady {
  readonly status: "ready";
  readonly adapterVersion: typeof STUDIO_CANONICAL_BRUSH_DRAW_ADAPTER_VERSION;
  readonly plan: StudioCanonicalBrushPlan;
  readonly requirements: readonly StudioCanonicalBrushDrawAdapterRequirement[];
  /**
   * Embedded, content-addressed R8 tips produced from persisted procedural/custom alpha maps.
   * Consumers still have to satisfy the `texture-tip` specialist requirement before rendering.
   */
  readonly assets: readonly StudioEngineWebGpuTexturedBrushAssetPayload[];
}

export type StudioCanonicalBrushDrawAdapterResult =
  | StudioCanonicalBrushDrawAdapterReady
  | StudioCanonicalBrushDrawAdapterRejection;

/**
 * V2/V3 causal ink uses a pressure integral plus physical 0.5px/10px cuts. A generic diameter
 * ratio lowerer cannot reproduce those cuts, so the adapter keeps that route explicit.
 */
export type StudioCanonicalBrushDrawAdapterRequirement =
  | StudioCanonicalBrushSpecialistLoweringRequirement
  | "causal-residual-spacing";

interface DetachedSource {
  readonly samples: readonly StudioCanonicalBrushSourceSampleCandidate[];
  readonly firstSequence: number;
  readonly lastSequence: number;
}

interface RecipeBuild {
  readonly recipe: StudioCanonicalBrushRecipe;
  readonly seed: number;
  readonly color: StudioCanonicalBrushColor;
  readonly composite: StudioCanonicalBrushComposite;
  readonly requirements: readonly StudioCanonicalBrushDrawAdapterRequirement[];
  readonly assets: readonly StudioEngineWebGpuTexturedBrushAssetPayload[];
  readonly fallbackPressure: number;
}

type BuildResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly rejection: StudioCanonicalBrushDrawAdapterRejection };

function reject<T>(
  reason: StudioCanonicalBrushDrawAdapterFailureReason,
  path: string,
  detail: string,
): BuildResult<T> {
  return {
    ok: false,
    rejection: { status: "rejected", reason, path, detail },
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeUnsignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return safeUnsignedInteger(value) && value > 0;
}

function uint32(value: unknown): value is number {
  return safeUnsignedInteger(value) && value <= 0xffff_ffff;
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function canonicalIdentifier(prefix: string, value: string): string {
  if (
    value.length > 0
    && value.length <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9._:/+-]+$/.test(value)
  ) {
    return value;
  }
  return `${prefix}:${sha256HexPortable(utf8(value))}`;
}

function elementOpacity(element: DrawEl): BuildResult<number> {
  const opacity = element.opacity ?? 1;
  if (!inRange(opacity, 0, 1)) {
    return reject("invalid-element", "element.opacity", "Stroke opacity must be finite in [0, 1].");
  }
  return { ok: true, value: opacity };
}

function canonicalBlendMode(
  element: DrawEl,
): BuildResult<StudioCanonicalBrushComposite> {
  const opacity = elementOpacity(element);
  if (!opacity.ok) return opacity;
  const raw = element.blendMode;
  const eraser = element.mode === "eraser";
  if (eraser) {
    if (
      raw !== undefined
      && raw !== "source-over"
      && raw !== "normal"
      && raw !== "destination-out"
    ) {
      return reject(
        "invalid-composite",
        "element.blendMode",
        "Eraser snapshots cannot combine destination-out with a colour blend mode.",
      );
    }
    return {
      ok: true,
      value: {
        porterDuff: "destination-out",
        blendMode: "normal",
        opacity: opacity.value,
      },
    };
  }
  if (raw === "destination-out") {
    return reject(
      "invalid-composite",
      "element.blendMode",
      "A destination-out snapshot must be persisted as eraser mode.",
    );
  }
  const blendMode = raw === undefined || raw === "source-over" || raw === "normal"
    ? "normal"
    : raw;
  if (
    blendMode !== "multiply"
    && blendMode !== "screen"
    && blendMode !== "overlay"
    && blendMode !== "darken"
    && blendMode !== "lighten"
    && blendMode !== "normal"
  ) {
    return reject(
      "invalid-composite",
      "element.blendMode",
      "Canonical brush v1 does not define this blend mode.",
    );
  }
  return {
    ok: true,
    value: {
      porterDuff: "source-over",
      blendMode,
      opacity: opacity.value,
    },
  };
}

function linearColor(
  cssColor: string,
  colorSpace: StudioLinearColorSpace,
  forceOpaque = false,
): BuildResult<StudioCanonicalBrushColor> {
  const parsed = parseStudioColorToLinear(cssColor, colorSpace, "none");
  if (!parsed.ok) {
    return reject("invalid-color", "element.stroke", parsed.detail);
  }
  if (!parsed.value.sourceInTargetGamut) {
    return reject(
      "invalid-color",
      "element.stroke",
      "The source colour is outside the requested linear target gamut; v1 will not clip it.",
    );
  }
  const [red, green, blue, alpha] = parsed.value.color.components;
  const components = [red, green, blue, forceOpaque ? 1 : alpha] as const;
  if (!components.every((component) => inRange(component, 0, 1))) {
    return reject(
      "invalid-color",
      "element.stroke",
      "The scene-linear conversion produced a component outside canonical v1 bounds.",
    );
  }
  return {
    ok: true,
    value: {
      space: colorSpace,
      alphaMode: "straight",
      components,
    },
  };
}

function layerEffectsAreRepresentable(element: DrawEl): BuildResult<true> {
  if (
    element.paintModel !== undefined
    && !isStudioStrokePaintModelCompatible(element)
  ) {
    return reject(
      "unsupported-paint-model",
      "element.paintModel",
      "The persisted stroke-local paint model is incompatible with this brush snapshot.",
    );
  }
  if (
    element.maskSrc !== undefined
    || element.maskEnabled === true
    || element.alphaLocked === true
    || element.clipBelow === true
  ) {
    return reject(
      "unsupported-layer-effect",
      "element",
      "Masks, alpha lock and clip-below must be applied by a layer compositor, not approximated by brush v1.",
    );
  }
  if (
    element.fill !== undefined
    || element.gradient !== undefined
    || element.pattern !== undefined
    || element.sketch !== undefined
    || element.strokeStyle !== undefined
    || element.shapeParams !== undefined
  ) {
    return reject(
      "unsupported-geometry",
      "element",
      "Fill, sketch and shape styling are not freehand canonical brush inputs.",
    );
  }
  const symmetryType = element.symmetry?.type ?? "none";
  if (symmetryType !== "none") {
    return reject(
      "unsupported-geometry",
      "element.symmetry",
      "Canonical brush v1 carries one source path and has no persisted symmetry transform set.",
    );
  }
  return { ok: true, value: true };
}

function validateRequestEnvelope(
  request: StudioCanonicalBrushDrawAdapterRequest,
): BuildResult<true> {
  if (
    typeof request !== "object"
    || request === null
    || !positiveSafeInteger(request.sessionEpoch)
    || !positiveSafeInteger(request.strokeEpoch)
    || !positiveSafeInteger(request.commandSequence)
    || !safeUnsignedInteger(request.firstSampleSequence)
    || !inRange(
      request.firstTimeMilliseconds,
      0,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTimeMilliseconds,
    )
    || !finite(request.fallbackSampleIntervalMilliseconds)
    || request.fallbackSampleIntervalMilliseconds <= 0
    || !safeUnsignedInteger(request.pointerId ?? 0)
    || !uint32(request.flags ?? 0)
    || (
      request.colorSpace !== "linear-srgb"
      && request.colorSpace !== "linear-display-p3"
    )
  ) {
    return reject(
      "invalid-request",
      "request",
      "Epochs, sequences, clock, pointer metadata or colour space are invalid.",
    );
  }
  return { ok: true, value: true };
}

function suppliedChannel(
  value: readonly number[] | undefined,
  count: number,
  path: string,
  minimum: number,
  maximum: number,
): BuildResult<readonly number[] | null> {
  if (value === undefined) return { ok: true, value: null };
  if (!Array.isArray(value) || value.length !== count) {
    return reject(
      "invalid-samples",
      path,
      "A supplied stylus channel must have exactly one value per source point.",
    );
  }
  if (!value.every((sample) => inRange(sample, minimum, maximum))) {
    return reject(
      "invalid-samples",
      path,
      `Every sample must be finite in [${minimum}, ${maximum}].`,
    );
  }
  return { ok: true, value: [...value] };
}

function sourceFromElement(
  request: StudioCanonicalBrushDrawAdapterRequest,
  fallbackPressure: number,
): BuildResult<DetachedSource> {
  const { element } = request;
  if (
    !Array.isArray(element.points)
    || element.points.length < 2
    || element.points.length % 2 !== 0
  ) {
    return reject(
      "invalid-geometry",
      "element.points",
      "Freehand points must contain one or more complete x/y pairs.",
    );
  }
  const count = element.points.length / 2;
  if (count > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples) {
    return reject("invalid-geometry", "element.points", "The canonical sample budget was exceeded.");
  }
  if (
    request.firstSampleSequence + count - 1 > Number.MAX_SAFE_INTEGER
    || !element.points.every((coordinate) => inRange(
      coordinate,
      -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
    ))
  ) {
    return reject(
      "invalid-geometry",
      "element.points",
      "A point is non-finite, outside the document budget or overflows its sequence.",
    );
  }
  const pressure = suppliedChannel(element.pressures, count, "element.pressures", 0, 1);
  if (!pressure.ok) return pressure;
  const speed = suppliedChannel(element.speeds, count, "element.speeds", 0, MAX_RUNTIME_SPEED);
  if (!speed.ok) return speed;
  const tiltX = suppliedChannel(element.tiltXs, count, "element.tiltXs", -90, 90);
  if (!tiltX.ok) return tiltX;
  const tiltY = suppliedChannel(element.tiltYs, count, "element.tiltYs", -90, 90);
  if (!tiltY.ok) return tiltY;
  const twist = suppliedChannel(
    element.twists,
    count,
    "element.twists",
    0,
    360 - Number.EPSILON,
  );
  if (!twist.ok) return twist;
  const tangentialPressure = suppliedChannel(
    element.tangentialPressures,
    count,
    "element.tangentialPressures",
    -1,
    1,
  );
  if (!tangentialPressure.ok) return tangentialPressure;

  let time = request.firstTimeMilliseconds;
  const samples: StudioCanonicalBrushSourceSampleCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = element.points[index * 2]!;
    const y = element.points[index * 2 + 1]!;
    if (index > 0) {
      if (speed.value) {
        const previousX = element.points[(index - 1) * 2]!;
        const previousY = element.points[(index - 1) * 2 + 1]!;
        const distance = Math.hypot(x - previousX, y - previousY);
        const segmentSpeed = speed.value[index]!;
        if (distance > 0 && segmentSpeed <= 0) {
          return reject(
            "invalid-samples",
            `element.speeds[${index}]`,
            "A moving segment cannot be reconstructed from a zero speed sample.",
          );
        }
        time += distance === 0 ? 0 : distance / segmentSpeed;
      } else {
        time += request.fallbackSampleIntervalMilliseconds;
      }
      if (
        !inRange(time, 0, STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTimeMilliseconds)
      ) {
        return reject(
          "invalid-samples",
          `element.points[${index * 2}]`,
          "Reconstructed source time exceeded the canonical clock budget.",
        );
      }
    }
    samples.push({
      role: "authoritative",
      sequence: request.firstSampleSequence + index,
      x,
      y,
      pressure: pressure.value?.[index] ?? fallbackPressure,
      tangentialPressure: tangentialPressure.value?.[index] ?? 0,
      tiltX: tiltX.value?.[index] ?? 0,
      tiltY: tiltY.value?.[index] ?? 0,
      twist: twist.value?.[index] ?? 0,
      timeMilliseconds: time,
      pointerId: request.pointerId ?? 0,
      flags: request.flags ?? 0,
    });
  }
  return {
    ok: true,
    value: {
      samples,
      firstSequence: request.firstSampleSequence,
      lastSequence: request.firstSampleSequence + count - 1,
    },
  };
}

function responseCurve(
  property: NormalizedStudioBrushDynamicsProperty,
  outputMode: "ratio" | "absolute",
): BuildResult<StudioCanonicalBrushResponseCurve> {
  if (property.jitter !== null) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics",
      "Canonical brush v1 has no per-dab property jitter channel.",
    );
  }
  if (property.mappings.length > 1) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics",
      "Canonical brush v1 can encode at most one monotonic pressure mapping per property.",
    );
  }
  let minimum = property.base;
  let maximum = property.base;
  let exponent = 1;
  const mapping = property.mappings[0];
  if (mapping) {
    if (
      mapping.source !== "pressure"
      || mapping.invert
      || mapping.curve < 0.01
      || mapping.curve > 16
    ) {
      return reject(
        "unsupported-dynamics",
        "element.brushDynamics",
        "Only non-inverted monotonic pressure mappings are representable in canonical v1.",
      );
    }
    const endpoints = mappingEndpoints(property.base, mapping);
    minimum = endpoints.minimum;
    maximum = endpoints.maximum;
    exponent = mapping.curve;
  }
  if (
    maximum < minimum
    || minimum < property.min - EPSILON
    || maximum > property.max + EPSILON
  ) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics",
      "The runtime mapping relies on reversal or property clamping that canonical v1 cannot retain.",
    );
  }
  if (outputMode === "ratio") {
    if (property.base <= 0) {
      return reject("unsupported-dynamics", "element.brushDynamics", "A size base must be positive.");
    }
    minimum /= property.base;
    maximum /= property.base;
  }
  if (
    !inRange(minimum, 0, 4)
    || !inRange(maximum, 0, 4)
    || maximum < minimum
  ) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics",
      "The mapped response exceeds canonical v1 curve bounds.",
    );
  }
  return {
    ok: true,
    value: { minimum, maximum, exponent },
  };
}

function mappingEndpoints(
  base: number,
  mapping: NormalizedStudioBrushDynamicsMapping,
): { readonly minimum: number; readonly maximum: number } {
  if (mapping.mode === "add") {
    return {
      minimum: base + mapping.from * mapping.amount,
      maximum: base + mapping.to * mapping.amount,
    };
  }
  return {
    minimum: base * (1 + (mapping.from - 1) * mapping.amount),
    maximum: base * (1 + (mapping.to - 1) * mapping.amount),
  };
}

function staticProperty(
  property: NormalizedStudioBrushDynamicsProperty,
  path: string,
): BuildResult<number> {
  if (property.jitter !== null || property.mappings.length > 0) {
    return reject(
      "unsupported-dynamics",
      path,
      "This dynamic channel has no canonical v1 source mapping.",
    );
  }
  return { ok: true, value: property.base };
}

interface CanonicalTipBuild {
  readonly tip: StudioCanonicalBrushTip;
  readonly assets: readonly StudioEngineWebGpuTexturedBrushAssetPayload[];
}

interface EffectiveTipCarrierBuild extends CanonicalTipBuild {
  /** Symmetric diameter expansion relative to the primary dab's authored diameter. */
  readonly diameterScale: number;
}

function textureTipAndAsset(alphaMap: StudioBrushTipAlphaMap): CanonicalTipBuild {
  const bytes = new Uint8Array(alphaMap.alphas.length);
  for (let index = 0; index < alphaMap.alphas.length; index += 1) {
    const alpha = alphaMap.alphas[index]!;
    bytes[index] = Math.round(alpha * 255);
  }
  const contentHash = `sha256:${sha256HexPortable(bytes)}`;
  const assetId = `tip:${contentHash}`;
  const asset: StudioEngineWebGpuTexturedBrushAssetPayload = {
    kind: "studio-textured-brush-r8-asset",
    version: 1,
    assetId,
    contentHash,
    width: alphaMap.size,
    height: alphaMap.size,
    channel: "alpha",
    format: "r8-unorm",
    byteLength: bytes.byteLength,
    bytes,
  };
  return {
    tip: {
      kind: "texture",
      assetId,
      contentHash,
      channel: "alpha",
      width: alphaMap.size,
      height: alphaMap.size,
    },
    assets: [asset],
  };
}

function canonicalTip(
  settings: NormalizedStudioBrushTipSettings,
  forcedAlphaMap?: StudioBrushTipAlphaMap,
): BuildResult<CanonicalTipBuild> {
  if (!forcedAlphaMap && studioBrushTipUsesSolidEllipse(settings)) {
    return {
      ok: true,
      value: {
        tip: { kind: "analytic", shape: "round", edgeSoftness: 0 },
        assets: [],
      },
    };
  }
  const alphaMap = forcedAlphaMap ?? buildStudioBrushTipAlphaMap(settings);
  if (
    !positiveSafeInteger(alphaMap.size)
    || alphaMap.size > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
    || alphaMap.alphas.length !== alphaMap.size * alphaMap.size
    || Array.from(alphaMap.alphas).some((alpha) => !inRange(alpha, 0, 1))
  ) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.tip",
      "The normalized tip produced an invalid or over-budget alpha texture.",
    );
  }
  return { ok: true, value: textureTipAndAsset(alphaMap) };
}

function composedDabSymmetricExtent(
  dab: Readonly<{
    x: number;
    y: number;
    size: number;
    angle: number;
    roundness: number;
  }>,
): number {
  const radiusX = dab.size / 2;
  const radiusY = radiusX * dab.roundness;
  const angle = dab.angle * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfWidth = Math.hypot(radiusX * cos, radiusY * sin);
  const halfHeight = Math.hypot(radiusX * sin, radiusY * cos);
  return Math.max(Math.abs(dab.x) + halfWidth, Math.abs(dab.y) + halfHeight);
}

function sampleComposedTipDab(
  alphaMap: StudioBrushTipAlphaMap,
  dab: Readonly<{
    x: number;
    y: number;
    size: number;
    angle: number;
    roundness: number;
    opacity: number;
    flow: number;
  }>,
  x: number,
  y: number,
): number {
  const radiusX = dab.size / 2;
  const radiusY = radiusX * dab.roundness;
  if (!(radiusX > 0) || !(radiusY > 0)) return 0;
  const angle = dab.angle * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const deltaX = x - dab.x;
  const deltaY = y - dab.y;
  const localX = (cos * deltaX + sin * deltaY) / radiusX;
  const localY = (-sin * deltaX + cos * deltaY) / radiusY;
  if (localX < -1 || localX > 1 || localY < -1 || localY > 1) return 0;
  return sampleStudioBrushTipAlphaMap(
    alphaMap,
    (localX * 0.5 + 0.5) * (alphaMap.size - 1),
    (localY * 0.5 + 0.5) * (alphaMap.size - 1),
  ) * dab.opacity * dab.flow;
}

/**
 * Flattens the exact ordered multi-tip visual program into one bounded R8 carrier.
 *
 * The retained renderer paints primary, layer 0 and layer 1 in that order. Repeating the
 * source-over operation with an R8 quantization boundary after every mark mirrors an RGBA8
 * destination and deliberately keeps ordering observable in the carrier bytes. Geometry comes
 * from the shared composition planner, so scale, offset, rotation, roundness and opacity cannot
 * drift from Canvas/SVG semantics.
 */
function flattenEffectiveTipCarrier(
  settings: NormalizedStudioBrushDynamicsSettings,
): BuildResult<EffectiveTipCarrierBuild> {
  const primaryAlphaMap = composeStudioBrushDualTipAlphaMap(
    settings.tip,
    settings.dualBrush,
  );
  const layerAlphaMaps = settings.tipLayers.map((layer) => (
    buildStudioBrushTipAlphaMap(layer.tip)
  ));
  const composed = planNormalizedStudioBrushTipComposition(
    {
      x: 0,
      y: 0,
      size: 2,
      angle: settings.angle.base,
      roundness: settings.roundness.base,
      opacity: 1,
      flow: 1,
    },
    settings.tip,
    settings.tipLayers,
  );
  const alphaMaps = [primaryAlphaMap, ...layerAlphaMaps];
  if (composed.length < 1 || composed.length > alphaMaps.length) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.tipLayers",
      "The normalized multi-tip planner produced an inconsistent layer count.",
    );
  }
  let diameterScale = 1;
  let sourceDimension = primaryAlphaMap.size;
  for (const composedTip of composed) {
    const alphaMapIndex = composedTip.role === "primary" ? 0 : composedTip.layerIndex + 1;
    const alphaMap = alphaMaps[alphaMapIndex];
    if (!alphaMap) {
      return reject(
        "unsupported-dynamics",
        "element.brushDynamics.tipLayers",
        "A composed tip layer has no deterministic alpha-map source.",
      );
    }
    diameterScale = Math.max(
      diameterScale,
      composedDabSymmetricExtent(composedTip.dab),
    );
    sourceDimension = Math.max(sourceDimension, alphaMap.size);
  }
  const outputDimension = Math.ceil(sourceDimension * diameterScale);
  const outputPixels = outputDimension * outputDimension;
  if (
    !finite(diameterScale)
    || diameterScale < 1
    || !positiveSafeInteger(outputDimension)
    || outputDimension > MAX_CANONICAL_COMPOSED_TIP_DIMENSION
    || !positiveSafeInteger(outputPixels)
    || outputPixels > MAX_CANONICAL_COMPOSED_TIP_PIXELS
    || outputDimension > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
  ) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.tipLayers",
      "The transformed multi-tip carrier exceeds the canonical R8 texture budget.",
    );
  }

  const r8 = new Uint8Array(outputPixels);
  const maximumPixel = outputDimension - 1;
  for (let pixelY = 0; pixelY < outputDimension; pixelY += 1) {
    const y = maximumPixel === 0
      ? 0
      : (pixelY / maximumPixel * 2 - 1) * diameterScale;
    for (let pixelX = 0; pixelX < outputDimension; pixelX += 1) {
      const x = maximumPixel === 0
        ? 0
        : (pixelX / maximumPixel * 2 - 1) * diameterScale;
      const outputIndex = pixelY * outputDimension + pixelX;
      let destination = 0;
      for (const composedTip of composed) {
        const alphaMapIndex = composedTip.role === "primary" ? 0 : composedTip.layerIndex + 1;
        const source = Math.round(
          Math.min(1, Math.max(0, sampleComposedTipDab(
            alphaMaps[alphaMapIndex]!,
            composedTip.dab,
            x,
            y,
          ))) * 255,
        );
        destination = Math.min(
          255,
          Math.round(source + destination * (255 - source) / 255),
        );
      }
      r8[outputIndex] = destination;
    }
  }
  const alphas = new Float32Array(outputPixels);
  for (let index = 0; index < outputPixels; index += 1) {
    alphas[index] = r8[index]! / 255;
  }
  const carrier = canonicalTip(settings.tip, {
    size: outputDimension,
    alphas,
    shape: settings.tip.shape,
    softness: settings.tip.softness,
    custom: true,
    revision: `canonical-ordered-tip-layers-v1:${JSON.stringify({
      primary: settings.tip,
      layers: settings.tipLayers,
      dualBrush: settings.dualBrush ?? null,
      angle: settings.angle.base,
      roundness: settings.roundness.base,
      diameterScale,
    })}`,
  });
  if (!carrier.ok) return carrier;
  return {
    ok: true,
    value: {
      ...carrier.value,
      diameterScale,
    },
  };
}

function tipAndAssets(
  settings: NormalizedStudioBrushDynamicsSettings,
  retainComposition: boolean,
): BuildResult<{
  readonly tip: StudioCanonicalBrushTip;
  readonly tipComposition: StudioCanonicalBrushTipCompositionV2 | null;
  readonly carrierDiameterScale: number;
  readonly carrierOwnsFootprint: boolean;
  readonly requirements: readonly StudioCanonicalBrushDrawAdapterRequirement[];
  readonly assets: readonly StudioEngineWebGpuTexturedBrushAssetPayload[];
}> {
  const hasComposition = settings.tipLayers.length > 0 || settings.dualBrush !== undefined;
  if (hasComposition && !retainComposition) {
    const path = settings.tipLayers.length > 0
      ? "element.brushDynamics.tipLayers"
      : "element.brushDynamics.dualBrush";
    return reject(
      "unsupported-dynamics",
      path,
      "Multi-tip and dual-brush composition requires retained bounded-flow-v2 dynamics.",
    );
  }
  const dualActive = settings.dualBrush?.enabled === true;
  const carrierOwnsFootprint = dualActive
    || settings.tipLayers.some((layer) => layer.opacity > 0);
  let carrierDiameterScale = 1;
  let effectivePrimary: BuildResult<CanonicalTipBuild>;
  if (carrierOwnsFootprint) {
    const flattened = flattenEffectiveTipCarrier(settings);
    if (!flattened.ok) return flattened;
    carrierDiameterScale = flattened.value.diameterScale;
    effectivePrimary = { ok: true, value: flattened.value };
  } else {
    effectivePrimary = canonicalTip(settings.tip);
    if (!effectivePrimary.ok) return effectivePrimary;
  }

  const assetById = new Map<string, StudioEngineWebGpuTexturedBrushAssetPayload>();
  const retainAssets = (build: CanonicalTipBuild): void => {
    for (const asset of build.assets) assetById.set(asset.assetId, asset);
  };
  retainAssets(effectivePrimary.value);
  if (hasComposition) {
    const primary = canonicalTip(settings.tip);
    if (!primary.ok) return primary;
    retainAssets(primary.value);
    for (const layer of settings.tipLayers) {
      const layerTip = canonicalTip(layer.tip);
      if (!layerTip.ok) return layerTip;
      retainAssets(layerTip.value);
    }
    if (settings.dualBrush) {
      const dualTip = canonicalTip(settings.dualBrush.tip);
      if (!dualTip.ok) return dualTip;
      retainAssets(dualTip.value);
    }
  }
  const assets = [...assetById.values()].sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
  return {
    ok: true,
    value: {
      tip: effectivePrimary.value.tip,
      tipComposition: hasComposition
        ? {
            model: "normalized-multi-tip-v1",
            primary: settings.tip,
            layers: settings.tipLayers,
            dualBrush: settings.dualBrush ?? null,
          }
        : null,
      carrierDiameterScale,
      carrierOwnsFootprint,
      requirements: effectivePrimary.value.tip.kind === "texture" ? ["texture-tip"] : [],
      assets,
    },
  };
}

function colorDynamicsAreIdentity(settings: NormalizedStudioBrushDynamicsSettings): boolean {
  const color = settings.colorDynamics;
  return color.foregroundBackgroundMix === 0
    && color.foregroundBackgroundJitter === 0
    && color.hueJitter === 0
    && color.saturationJitter === 0
    && color.valueJitter === 0;
}

function taperIsIdentity(settings: NormalizedStudioBrushDynamicsSettings): boolean {
  const taper = settings.taper;
  return !taper.enabled
    || (taper.startLength === 0 && taper.endLength === 0)
    || (taper.minSizeRatio === 1 && taper.minOpacityRatio === 1);
}

type StudioCanonicalBrushRecipeV1Base =
  Omit<StudioCanonicalBrushRecipeV1, "version">;

function paintContract(
  model:
    | typeof STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1
    | typeof STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
): StudioCanonicalBrushPaintContractV2 {
  return {
    model,
    depositionAlpha: "flow-times-dab-opacity",
    accumulation: "source-over-stroke-local-rgba",
    finalCompositeOpacity: "plan-composite-opacity-once",
    surface: model === STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2
      ? "bounded-sparse-rgba-tiles"
      : "stroke-local-rgba",
  };
}

function versionedRecipe(
  element: DrawEl,
  base: StudioCanonicalBrushRecipeV1Base,
  retainedDynamics: NormalizedStudioBrushDynamicsSettings | null,
  tipComposition: StudioCanonicalBrushTipCompositionV2 | null = null,
): BuildResult<StudioCanonicalBrushRecipe> {
  if (element.paintModel === undefined) {
    if (retainedDynamics !== null) {
      return reject(
        "unsupported-paint-model",
        "element.paintModel",
        "Retained dynamics require an explicit bounded-flow-v2 paint contract.",
      );
    }
    return {
      ok: true,
      value: {
        version: STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION,
        ...base,
      },
    };
  }
  if (
    element.paintModel === STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1
    && retainedDynamics === null
  ) {
    return {
      ok: true,
      value: {
        version: STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION,
        ...base,
        paint: paintContract(element.paintModel),
        retainedDynamics: null,
      },
    };
  }
  if (
    element.paintModel === STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2
    && retainedDynamics !== null
  ) {
    return {
      ok: true,
      value: {
        version: STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION,
        ...base,
        paint: paintContract(element.paintModel),
        retainedDynamics,
        ...(tipComposition ? { tipComposition } : {}),
      },
    };
  }
  return reject(
    "unsupported-paint-model",
    "element.paintModel",
    "Layered flow accepts ordinary ink or a named low-density eraser; bounded flow requires retained dynamic settings.",
  );
}

function dynamicRecipe(
  request: StudioCanonicalBrushDrawAdapterRequest,
): BuildResult<RecipeBuild> {
  const { element } = request;
  const presetId = resolveStudioCapturedBrushDynamicsPresetId(element);
  if (!presetId || !element.brushDynamics) {
    return reject(
      "unsupported-brush",
      "element.brush",
      "This snapshot is not a persisted Studio dynamic-brush preset.",
    );
  }
  if (
    element.stamp !== undefined
    || element.stampPipeline !== undefined
    || element.watercolorPipeline !== undefined
    || element.brushTip !== undefined
  ) {
    return reject(
      "unsupported-dynamics",
      "element",
      "A dynamic snapshot cannot also carry an independent stamp, wet or calligraphy pipeline.",
    );
  }
  const initial = normalizeStudioBrushDynamicsSettings(element.brushDynamics);
  const runtimeWidth = Math.max(1, element.strokeWidth);
  const seed = studioBrushDynamicsSeedFromKey(`${element.id}:${initial.seed}`);
  const settings = normalizeStudioBrushDynamicsSettings({
    ...initial,
    seed,
    width: { ...initial.width, base: runtimeWidth },
  });
  const material = presetId === "airbrush"
    ? "air"
    : presetId === "dry-media"
      ? "graphite"
      : "ink";
  if (element.paintModel === STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2) {
    const tip = tipAndAssets(settings, true);
    if (!tip.ok) return tip;
    const color = linearColor(element.stroke, request.colorSpace);
    if (!color.ok) return color;
    const composite = canonicalBlendMode(element);
    if (!composite.ok) return composite;
    const spacingRatioValue = settings.spacingRatio
      ?? settings.spacing.base / settings.width.base;
    const scatterRatioValue = settings.scatterRatio
      ?? settings.scatter.base / settings.width.base;
    const carrierSize = settings.width.base * tip.value.carrierDiameterScale;
    const carrierSpacingRatio = spacingRatioValue / tip.value.carrierDiameterScale;
    const carrierScatterRatio = scatterRatioValue / tip.value.carrierDiameterScale;
    if (
      !inRange(
        carrierSize,
        0.01,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize,
      )
      || !inRange(
        carrierSpacingRatio,
        0.001,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio,
      )
      || !inRange(
        carrierScatterRatio,
        0,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxScatterRatio,
      )
    ) {
      return reject(
        "unsupported-dynamics",
        "element.brushDynamics",
        "Retained dynamics summary ratios exceed canonical recipe budgets.",
      );
    }
    const grain: StudioCanonicalBrushGrain | null = settings.grain.amount > 0
      ? {
          kind: "procedural-noise",
          assetId: null,
          contentHash: null,
          space: settings.grain.space === "canvas-fixed" ? "document" : "stroke",
          scale: settings.grain.scale,
          depth: settings.grain.amount,
          contrast: settings.grain.contrast,
          seed: settings.grain.seed,
        }
      : null;
    const recipe = versionedRecipe(element, {
      brushId: canonicalIdentifier("brush", element.brush ?? presetId),
      engine: "dab-v1",
      material,
      tip: tip.value.tip,
      size: carrierSize,
      flow: 1,
      hardness: 1,
      spacingRatio: carrierSpacingRatio,
      scatter: {
        radiusRatio: carrierScatterRatio,
        distribution: "uniform-disk",
      },
      angleRadians: tip.value.carrierOwnsFootprint
        ? 0
        : settings.angle.base * Math.PI / 180,
      roundness: tip.value.carrierOwnsFootprint ? 1 : settings.roundness.base,
      pressure: {
        size: IDENTITY_CURVE,
        opacity: IDENTITY_CURVE,
        flow: IDENTITY_CURVE,
      },
      grain,
      wetMedia: null,
    }, settings, tip.value.tipComposition);
    if (!recipe.ok) return recipe;
    const requirements: StudioCanonicalBrushDrawAdapterRequirement[] = [
      ...tip.value.requirements,
    ];
    if (grain) requirements.push("grain");
    requirements.push("retained-dynamics", "stroke-local-compositor");
    return {
      ok: true,
      value: {
        seed,
        color: color.value,
        composite: composite.value,
        requirements,
        assets: tip.value.assets,
        fallbackPressure: settings.fallbackPressure,
        recipe: recipe.value,
      },
    };
  }
  if (!colorDynamicsAreIdentity(settings)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.colorDynamics",
      "Canonical brush v1 has one fixed colour and cannot retain per-dab colour dynamics.",
    );
  }
  if (!taperIsIdentity(settings)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.taper",
      "Canonical brush v1 has no stroke-progress taper response.",
    );
  }
  const size = responseCurve(settings.width, "ratio");
  if (!size.ok) return size;
  const opacity = responseCurve(settings.opacity, "absolute");
  if (!opacity.ok) return opacity;
  const flow = responseCurve(settings.flow, "absolute");
  if (!flow.ok) return flow;
  const angle = staticProperty(settings.angle, "element.brushDynamics.angle");
  if (!angle.ok) return angle;
  const roundness = staticProperty(settings.roundness, "element.brushDynamics.roundness");
  if (!roundness.ok) return roundness;
  const spacing = spacingRatio(settings, size.value);
  if (!spacing.ok) return spacing;
  const scatter = scatterRatio(settings, size.value);
  if (!scatter.ok) return scatter;
  const tip = tipAndAssets(settings, false);
  if (!tip.ok) return tip;
  const color = linearColor(element.stroke, request.colorSpace);
  if (!color.ok) return color;
  const composite = canonicalBlendMode(element);
  if (!composite.ok) return composite;

  const requirements = [...tip.value.requirements];
  let grain: StudioCanonicalBrushGrain | null = null;
  if (settings.grain.amount > 0) {
    grain = {
      kind: "procedural-noise",
      assetId: null,
      contentHash: null,
      space: settings.grain.space === "canvas-fixed" ? "document" : "stroke",
      scale: settings.grain.scale,
      depth: settings.grain.amount,
      contrast: settings.grain.contrast,
      seed: settings.grain.seed,
    };
    requirements.push("grain");
  }
  const recipe = versionedRecipe(element, {
    brushId: canonicalIdentifier("brush", element.brush ?? presetId),
    engine: "dab-v1",
    material,
    tip: tip.value.tip,
    size: settings.width.base,
    flow: 1,
    hardness: 1,
    spacingRatio: spacing.value,
    scatter: {
      radiusRatio: scatter.value,
      distribution: "uniform-disk",
    },
    angleRadians: angle.value * Math.PI / 180,
    roundness: roundness.value,
    pressure: {
      size: size.value,
      opacity: opacity.value,
      flow: flow.value,
    },
    grain,
    wetMedia: null,
  }, null);
  if (!recipe.ok) return recipe;
  return {
    ok: true,
    value: {
      seed,
      color: color.value,
      composite: composite.value,
      requirements,
      assets: tip.value.assets,
      fallbackPressure: settings.fallbackPressure,
      recipe: recipe.value,
    },
  };
}

function sizeCurveIsConstant(curve: StudioCanonicalBrushResponseCurve): boolean {
  return almostEqual(curve.minimum, curve.maximum);
}

function spacingRatio(
  settings: NormalizedStudioBrushDynamicsSettings,
  sizeCurve: StudioCanonicalBrushResponseCurve,
): BuildResult<number> {
  const spacing = staticProperty(settings.spacing, "element.brushDynamics.spacing");
  if (!spacing.ok) return spacing;
  if (settings.spacingRatio !== null) return { ok: true, value: settings.spacingRatio };
  if (!sizeCurveIsConstant(sizeCurve)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.spacing",
      "Absolute spacing with pressure-varying size cannot be expressed as a canonical ratio.",
    );
  }
  const diameter = settings.width.base * sizeCurve.minimum;
  const ratio = spacing.value / diameter;
  if (!inRange(ratio, 0.001, STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.spacing",
      "Resolved absolute spacing is outside canonical ratio bounds.",
    );
  }
  return { ok: true, value: ratio };
}

function scatterRatio(
  settings: NormalizedStudioBrushDynamicsSettings,
  sizeCurve: StudioCanonicalBrushResponseCurve,
): BuildResult<number> {
  const scatter = staticProperty(settings.scatter, "element.brushDynamics.scatter");
  if (!scatter.ok) return scatter;
  if (settings.scatterRatio !== null) return { ok: true, value: settings.scatterRatio };
  if (scatter.value === 0) return { ok: true, value: 0 };
  if (!sizeCurveIsConstant(sizeCurve)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.scatter",
      "Absolute scatter with pressure-varying size cannot be expressed as a canonical ratio.",
    );
  }
  const ratio = scatter.value / (settings.width.base * sizeCurve.minimum);
  if (!inRange(ratio, 0, STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxScatterRatio)) {
    return reject(
      "unsupported-dynamics",
      "element.brushDynamics.scatter",
      "Resolved absolute scatter is outside canonical ratio bounds.",
    );
  }
  return { ok: true, value: ratio };
}

function wetRecipe(
  request: StudioCanonicalBrushDrawAdapterRequest,
): BuildResult<RecipeBuild> {
  const { element } = request;
  if (element.brushDynamics !== undefined || element.brushTip !== undefined || element.stamp !== undefined) {
    return reject(
      "unsupported-dynamics",
      "element",
      "The causal wet specialist cannot also consume a dynamic, calligraphy or stamp snapshot.",
    );
  }
  const physical = resolveStudioWetInkBrushPhysicalRecipe(element);
  const alias = resolveStudioBrushAliasProfile(element.brush);
  if (!physical || !alias) {
    return reject(
      "unsupported-brush",
      "element.brush",
      "The causal wet physical recipe could not be resolved.",
    );
  }
  const color = linearColor(
    `rgb(${physical.inkColor.r} ${physical.inkColor.g} ${physical.inkColor.b})`,
    request.colorSpace,
    true,
  );
  if (!color.ok) return color;
  const composite = canonicalBlendMode(element);
  if (!composite.ok) return composite;
  const material = physical.material;
  return {
    ok: true,
    value: {
      seed: physical.seed,
      color: color.value,
      composite: {
        ...composite.value,
        opacity: physical.compositeOpacity,
      },
      requirements: ["wet-media"],
      assets: [],
      fallbackPressure: 0.55,
      recipe: {
        version: 1,
        brushId: physical.brushId,
        engine: "wet-media-v1",
        material: "pigment",
        tip: { kind: "analytic", shape: "round", edgeSoftness: 0 },
        size: physical.baseWidth,
        flow: 1,
        hardness: material.hardness,
        spacingRatio: physical.spacing / physical.baseWidth,
        scatter: { radiusRatio: 0, distribution: "uniform-disk" },
        angleRadians: 0,
        roundness: 1,
        pressure: {
          size: {
            minimum: alias.pressure.minimum,
            maximum: alias.pressure.maximum,
            exponent: alias.pressure.exponent,
          },
          opacity: IDENTITY_CURVE,
          flow: IDENTITY_CURVE,
        },
        grain: null,
        wetMedia: {
          model: "pigment-water-v1",
          fieldScale: physical.fieldScale,
          fixedRateHz: STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ,
          simulationSteps: STUDIO_WET_INK_BRUSH_SIMULATION_STEPS,
          absorption: material.absorption,
          bleed: material.bleed,
          dryingRate: material.dryingRate,
          edgeDarkening: material.edgeDarkening,
          fixationRate: material.fixationRate,
          granulation: material.granulation,
          paperRoughness: material.paperRoughness,
          pigmentLoad: material.pigmentLoad,
          waterLoad: material.waterLoad,
          wetnessLoad: material.wetnessLoad,
        },
      },
    },
  };
}

function simplePressureCurve(
  element: DrawEl,
  minimumDiameter: number,
): BuildResult<StudioCanonicalBrushResponseCurve> {
  if (element.pressureModel !== undefined && !isStudioInkPressureModel(element.pressureModel)) {
    return reject(
      "invalid-element",
      "element.pressureModel",
      "The persisted pressure model is unknown.",
    );
  }
  const alias = element.mode === "eraser"
    && !isStudioBrushEraserAliasId(element.brush)
    ? null
    : resolveStudioBrushAliasProfile(element.brush ?? "pen");
  const aliasCurve = alias?.pressure ?? { minimum: 0, maximum: 1, exponent: 1 };
  const linear = element.pressureModel !== undefined;
  const minimum = linear ? aliasCurve.minimum : 0.3 + 1.4 * aliasCurve.minimum;
  const maximum = linear ? aliasCurve.maximum : 0.3 + 1.4 * aliasCurve.maximum;
  if (!linear && minimumDiameter * minimum < 0.5 - EPSILON) {
    return reject(
      "unsupported-brush",
      "element.strokeWidth",
      "The legacy quarter-pixel radius floor cannot be represented by a canonical power curve.",
    );
  }
  return {
    ok: true,
    value: { minimum, maximum, exponent: aliasCurve.exponent },
  };
}

function simpleRecipe(
  request: StudioCanonicalBrushDrawAdapterRequest,
): BuildResult<RecipeBuild> {
  const { element } = request;
  if (
    element.brushDynamics !== undefined
    || element.stamp !== undefined
    || element.stampPipeline !== undefined
    || element.watercolorPipeline !== undefined
    || element.brushTip !== undefined
  ) {
    return reject(
      "unsupported-brush",
      "element",
      "This retained specialist snapshot has no exact simple canonical-v1 recipe.",
    );
  }
  const brush = element.brush ?? "pen";
  const renderFamily = resolveStudioBrushRenderFamily(brush);
  if (
    element.mode !== "eraser"
    && renderFamily !== "pen"
    && renderFamily !== "gpen"
    && renderFamily !== "marker"
  ) {
    return reject(
      "unsupported-brush",
      "element.brush",
      "This retained multipass/material brush must use a specialist adapter.",
    );
  }
  const size = element.mode === "eraser" && !isStudioBrushEraserAliasId(brush)
    ? element.strokeWidth
    : studioBrushAliasEffectiveDiameter(brush, element.strokeWidth);
  const pressure = simplePressureCurve(element, size);
  if (!pressure.ok) return pressure;
  const color = element.mode === "eraser"
    ? {
        ok: true as const,
        value: {
          space: request.colorSpace,
          alphaMode: "straight" as const,
          components: [0, 0, 0, 1] as const,
        },
      }
    : linearColor(element.stroke, request.colorSpace);
  if (!color.ok) return color;
  const composite = canonicalBlendMode(element);
  if (!composite.ok) return composite;
  if (
    element.sampleSpacing !== undefined
    && (!finite(element.sampleSpacing) || element.sampleSpacing < 0)
  ) {
    return reject(
      "invalid-element",
      "element.sampleSpacing",
      "Persisted source sample spacing must be a non-negative finite document distance.",
    );
  }
  const residualSpacing = studioInkUsesResidualDabSpacing(element.pressureModel);
  const spacingRatioValue = residualSpacing
    ? 0.2
    : element.sampleSpacing === undefined || element.sampleSpacing === 0
      ? 0.1
      : element.sampleSpacing / size;
  if (
    !inRange(
      spacingRatioValue,
      0.001,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio,
    )
  ) {
    return reject(
      "invalid-element",
      "element.sampleSpacing",
      "Sample spacing cannot be represented by the canonical ratio budget.",
    );
  }
  const material = element.mode === "eraser"
    ? "eraser"
    : renderFamily === "marker"
      ? "marker"
      : "ink";
  const recipe = versionedRecipe(element, {
    brushId: element.mode === "eraser"
      ? isStudioBrushEraserAliasId(brush)
        ? canonicalIdentifier("eraser", `eraser:${brush}`)
        : "eraser"
      : canonicalIdentifier("brush", brush),
    engine: "dab-v1",
    material,
    tip: { kind: "analytic", shape: "round", edgeSoftness: 0 },
    size,
    flow: 1,
    hardness: 1,
    spacingRatio: spacingRatioValue,
    scatter: { radiusRatio: 0, distribution: "uniform-disk" },
    angleRadians: 0,
    roundness: 1,
    pressure: {
      size: pressure.value,
      opacity: IDENTITY_CURVE,
      flow: IDENTITY_CURVE,
    },
    grain: null,
    wetMedia: null,
  }, null);
  if (!recipe.ok) return recipe;
  const requirements: StudioCanonicalBrushDrawAdapterRequirement[] = residualSpacing
    ? ["causal-residual-spacing"]
    : [];
  if (element.paintModel === STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1) {
    requirements.push("stroke-local-compositor");
  }
  return {
    ok: true,
    value: {
      seed: studioBrushDynamicsSeedFromKey(`${element.id}:${brush}:canonical-draw-v1`),
      color: color.value,
      composite: composite.value,
      requirements,
      assets: [],
      fallbackPressure: studioInkFallbackPressure(element.pressureModel),
      recipe: recipe.value,
    },
  };
}

function recipeFromElement(
  request: StudioCanonicalBrushDrawAdapterRequest,
): BuildResult<RecipeBuild> {
  const { element } = request;
  if (
    element.type !== "draw"
    || typeof element.id !== "string"
    || element.id.length === 0
    || element.id.length > MAX_SOURCE_IDENTIFIER_CHARACTERS
    || typeof element.stroke !== "string"
    || element.stroke.length === 0
    || !inRange(
      element.strokeWidth,
      0.01,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize,
    )
  ) {
    return reject(
      "invalid-element",
      "element",
      "Draw identity, stroke colour or stroke width is invalid.",
    );
  }
  if ((element.kind ?? "freehand") !== "freehand") {
    return reject(
      "unsupported-geometry",
      "element.kind",
      "Only freehand DrawEl snapshots map to canonical brush v1.",
    );
  }
  const layer = layerEffectsAreRepresentable(element);
  if (!layer.ok) return layer;
  if (studioWetInkBrushRuntimeSupportsElement(element)) return wetRecipe(request);
  if (element.brushDynamics !== undefined) return dynamicRecipe(request);
  return simpleRecipe(request);
}

function freezeShallowArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

/**
 * Produces a validated, detached and deep-frozen canonical plan. No document or renderer state is
 * mutated; legacy persistence remains untouched until a caller explicitly adopts the returned plan.
 */
export function adaptStudioDrawElementToCanonicalBrushPlan(
  request: StudioCanonicalBrushDrawAdapterRequest,
): StudioCanonicalBrushDrawAdapterResult {
  const envelope = validateRequestEnvelope(request);
  if (!envelope.ok) return envelope.rejection;
  const recipe = recipeFromElement(request);
  if (!recipe.ok) return recipe.rejection;
  const source = sourceFromElement(request, recipe.value.fallbackPressure);
  if (!source.ok) return source.rejection;

  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.strokeEpoch,
    commandSequence: request.commandSequence,
    strokeId: canonicalIdentifier("stroke", request.element.id),
    seed: recipe.value.seed,
    coordinateSpace: "document-css-px",
    transform: { ...request.transform },
    color: recipe.value.color,
    composite: recipe.value.composite,
    recipe: recipe.value.recipe,
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: source.value.firstSequence,
      lastSequence: source.value.lastSequence,
      samples: source.value.samples,
    },
  };
  const parsed = parseStudioCanonicalBrushPlan(candidate, {
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.strokeEpoch,
    lastAcceptedCommandSequence: request.commandSequence - 1,
  });
  if (!parsed.ok) {
    return {
      status: "rejected",
      reason: "canonical-validation",
      path: parsed.path,
      detail: `The canonical parser rejected the detached versioned adapter candidate (${parsed.reason}).`,
    };
  }
  return Object.freeze({
    status: "ready",
    adapterVersion: STUDIO_CANONICAL_BRUSH_DRAW_ADAPTER_VERSION,
    plan: parsed.value.plan,
    requirements: freezeShallowArray(recipe.value.requirements),
    assets: freezeShallowArray(recipe.value.assets),
  });
}
