/**
 * Product compiler for the first visible canonical-vNext dry-media slice.
 *
 * DrawEl remains the durable/CRDT authority. The canonical plan is a content-addressed presentation
 * envelope and the textured plan is rebuilt from the exact retained dynamic-dab plan that Canvas,
 * SVG and collaboration replay already consume. The dry-media bridge is applied exactly once.
 *
 * This compiler is deliberately narrow:
 * - one source-over freehand stroke;
 * - one explicitly classified continuous dry-media catalogue material;
 * - one textured tip and procedural grain;
 * - no symmetry, dual tip, tip layers, colour jitter, masks or destructive compositing.
 *
 * Unsupported material semantics are classified before execution and remain on the explicitly selected
 * Canvas renderer. They are never approximated by a generic round-dab GPU path.
 */

import {
  normalizeStudioBrushDynamicsSettings,
  serializeStudioBrushDynamicsSettingsCanonical,
} from "./brush/studio-brush-dynamics";
import { classifyStudioDryMediaCatalogIdV1 } from "./brush/studio-dry-media-anisotropic-grain-v1";
import {
  bridgeStudioDynamicDabVariationToDryMediaV1,
  type StudioDryMediaDynamicDabVariation,
} from "./brush/studio-dry-media-dynamic-bridge";
import { STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2 } from "./brush/studio-stroke-paint-model";
import {
  buildStudioEngineWebGpuTexturedBrushPlan,
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS,
  type StudioEngineWebGpuTexturedBrushAssetPayload,
  type StudioEngineWebGpuTexturedBrushAssetResolver,
  type StudioEngineWebGpuTexturedBrushDab,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import { adaptStudioDrawElementToCanonicalBrushPlan } from "./studio-canonical-brush-draw-adapter";
import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import {
  STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CATALOG_ID,
  STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION,
  validateStudioCanonicalVNextDryMediaCompiledFrame,
  type StudioCanonicalVNextDryMediaCompiledFrame,
} from "./studio-canonical-vnext-dry-media-presentation-controller";
import { planStudioDynamicBrushRender } from "./studio-dynamic-brush-render-plan";
import { parseStudioProfessionalBrushDynamicsPlan } from "./studio-professional-brush-dynamics";
import { sha256HexPortable } from "./studio-sha256";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import type { StudioCanonicalBrushPlan } from "./studio-canonical-brush-plan";
import type { DrawEl } from "./studio-element-model";
import type { StudioProfessionalBrushDynamicsPlan } from "./studio-professional-brush-dynamics";

export const STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRODUCT_ADAPTER_VERSION = 1 as const;

export type StudioCanonicalVNextDryMediaProductCompileFailureReason =
  | "canonical-adapter-rejected"
  | "canonical-envelope-rejected"
  | "dynamic-plan-rejected"
  | "ineligible-material"
  | "invalid-input"
  | "quality-gate-rejected"
  | "textured-plan-rejected"
  | "unsupported-color-dynamics"
  | "unsupported-composite"
  | "unsupported-grain-source"
  | "unsupported-multi-tip"
  | "unsupported-paint-model"
  | "unsupported-paint-roller"
  | "unsupported-symmetry";

export type StudioCanonicalVNextDryMediaProductCompileResult =
  | Readonly<{
      status: "ready";
      adapterVersion:
        typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRODUCT_ADAPTER_VERSION;
      elementId: string;
      catalogueId: string;
      dynamicPlanDigest: `sha256:${string}`;
      sourceDabCount: number;
      texturedDabCount: number;
      laneCount: 3 | 5;
      frame: StudioCanonicalVNextDryMediaCompiledFrame;
    }>
  | Readonly<{
      status: "unavailable";
      reason: StudioCanonicalVNextDryMediaProductCompileFailureReason;
      detail?: string;
    }>;

export interface StudioCanonicalVNextDryMediaProductCompileRequest {
  readonly element: DrawEl;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly commandSequence: number;
  readonly signal?: AbortSignal;
}

function unavailableResult(
  reason: StudioCanonicalVNextDryMediaProductCompileFailureReason,
  detail?: string,
): Extract<
  StudioCanonicalVNextDryMediaProductCompileResult,
  { readonly status: "unavailable" }
> {
  return Object.freeze({
    status: "unavailable",
    reason,
    ...(detail ? { detail } : {}),
  });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function colorDynamicsAreIdentity(
  settings: NormalizedStudioBrushDynamicsSettings,
): boolean {
  const color = settings.colorDynamics;
  return color.foregroundBackgroundMix === 0
    && color.foregroundBackgroundJitter === 0
    && color.hueJitter === 0
    && color.saturationJitter === 0
    && color.valueJitter === 0;
}

function dualTipIsActive(settings: NormalizedStudioBrushDynamicsSettings): boolean {
  return settings.tipLayers.length > 0 || settings.dualBrush?.enabled === true;
}

function flattenVariation(
  variation: StudioDryMediaDynamicDabVariation,
): readonly StudioDynamicBrushDab[] {
  return !Array.isArray(variation) && "segments" in variation
    ? variation.segments.flatMap((segment: readonly StudioDynamicBrushDab[]) => segment)
    : variation as readonly StudioDynamicBrushDab[];
}

function pressureAtProgress(
  element: DrawEl,
  progress: number,
  fallbackPressure: number,
): number {
  const pointCount = Math.floor(element.points.length / 2);
  const pressures = element.pressures;
  if (!pressures || pressures.length !== pointCount || pointCount <= 0) {
    return clamp01(fallbackPressure);
  }
  if (pointCount === 1) return clamp01(pressures[0] ?? fallbackPressure);
  const position = clamp01(progress) * (pointCount - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(pointCount - 1, leftIndex + 1);
  const mix = position - leftIndex;
  const left = pressures[leftIndex] ?? fallbackPressure;
  const right = pressures[rightIndex] ?? left;
  return clamp01(left + (right - left) * mix);
}

/**
 * The canonical v1 recipe cannot serialize every mapped/jittered dynamic channel yet. For the
 * visible specialist slice we therefore compile a content-addressed envelope:
 *
 * - source samples, colour, composite, exact R8 tip and grain remain canonical;
 * - the full normalized dynamics identity is bound into recipe.brushId;
 * - actual resolved dabs come from planStudioDynamicBrushRender, never from this projection;
 * - DrawEl remains the only durable authority.
 */
function canonicalProjection(
  element: DrawEl,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): DrawEl {
  const projectedDynamics = normalizeStudioBrushDynamicsSettings({
    seed: dynamics.seed,
    fallbackPressure: dynamics.fallbackPressure,
    maxSpeed: dynamics.maxSpeed,
    spacingRatio: 0.15,
    scatterRatio: 0,
    taper: { enabled: false },
    tip: dynamics.tip,
    tipLayers: [],
    dualBrush: { enabled: false },
    colorDynamics: {
      backgroundColor: null,
      foregroundBackgroundMix: 0,
      foregroundBackgroundJitter: 0,
      hueJitter: 0,
      saturationJitter: 0,
      valueJitter: 0,
    },
    grain: dynamics.grain,
    width: {
      base: Math.max(1, element.strokeWidth),
      mappings: [],
      jitter: null,
    },
    opacity: { base: 1, mappings: [], jitter: null },
    flow: { base: 1, mappings: [], jitter: null },
    spacing: {
      base: Math.max(0.25, Math.max(1, element.strokeWidth) * 0.15),
      mappings: [],
      jitter: null,
    },
    scatter: { base: 0, mappings: [], jitter: null },
    angle: { base: 0, mappings: [], jitter: null },
    roundness: { base: 0.5, mappings: [], jitter: null },
  });
  return {
    ...element,
    // Time has no visual authority after all dynamic channels have been resolved into immutable
    // dabs. Integer fallback ticks keep the generic textured asset lowerer deterministic.
    speeds: undefined,
    // bounded-flow-v2 applies element opacity once after stroke-local accumulation. At exactly
    // unit opacity that final operation is an identity, so the specialist's transparent RGBA16F
    // rebuild is pixel-equivalent. Non-unit bounded flow is rejected before projection.
    paintModel: element.paintModel === STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2
      ? STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2
      : undefined,
    brushDynamics: projectedDynamics,
  };
}

function bindDynamicIdentity(
  canonical: StudioCanonicalBrushPlan,
  dynamicPlanDigest: `sha256:${string}`,
): Readonly<{ ok: true; plan: StudioCanonicalBrushPlan }>
  | Readonly<{ ok: false; detail: string }> {
  const candidate = {
    ...canonical,
    recipe: {
      ...canonical.recipe,
      brushId: `dry-media-resolved:${dynamicPlanDigest.slice("sha256:".length)}`,
    },
    source: {
      ...canonical.source,
      samples: canonical.source.samples.map((sample) => ({
        role: "authoritative",
        ...sample,
      })),
    },
  };
  const parsed = parseStudioCanonicalBrushPlan(candidate, {
    sessionEpoch: canonical.sessionEpoch,
    strokeEpoch: canonical.strokeEpoch,
    lastAcceptedCommandSequence: canonical.commandSequence - 1,
  });
  return parsed.ok
    ? Object.freeze({ ok: true, plan: parsed.value.plan })
    : Object.freeze({
        ok: false,
        detail: `${parsed.reason}:${parsed.path}`,
      });
}

function constantChannel(base: number, minimum: number, maximum: number) {
  return Object.freeze({
    base,
    min: minimum,
    max: maximum,
    mappings: Object.freeze([]),
  });
}

function assetLoweringDynamics(
  canonical: StudioCanonicalBrushPlan,
): StudioProfessionalBrushDynamicsPlan | null {
  const sampleCount = canonical.source.samples.length;
  const candidate = {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: `dry-media-assets:${canonical.strokeId}`.slice(0, 128),
    revision: 1,
    seed: canonical.seed,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: { timeUnit: "milliseconds", tickMilliseconds: 1 },
    budgets: {
      maxSamples: Math.max(1, sampleCount),
      maxEvents: Math.min(
        STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs,
        Math.max(1_024, sampleCount * 64),
      ),
      maxMappings: 0,
      maxCurvePoints: 2,
      maxStationaryEventsPerGap: 0,
    },
    velocity: {
      normalizationPixelsPerMillisecond: 1,
      smoothingTimeMilliseconds: 1,
      initialPixelsPerMillisecond: 0,
      maximumPixelsPerMillisecond: 1_000_000,
    },
    taper: {
      start: { mode: "stroke-percentage", value: 0 },
      end: { mode: "stroke-percentage", value: 0 },
      minimumSizeRatio: 1,
      minimumOpacityRatio: 1,
      speedInfluence: 0,
    },
    stationary: {
      mode: "disabled",
      intervalTicks: 1,
      movementEpsilonPixels: 0,
    },
    channels: {
      size: constantChannel(canonical.recipe.size, 0.01, 8_192),
      opacity: constantChannel(1, 0, 1),
      flow: constantChannel(1, 0, 1),
      spacing: constantChannel(
        Math.max(0.05, canonical.recipe.size * canonical.recipe.spacingRatio),
        0.05,
        4_096,
      ),
      angle: constantChannel(canonical.recipe.angleRadians, -Math.PI * 2, Math.PI * 2),
      roundness: constantChannel(canonical.recipe.roundness, 0.01, 1),
      scatter: constantChannel(0, 0, 8_192),
      textureDepth: constantChannel(canonical.recipe.grain ? 1 : 0, 0, 1),
    },
  };
  const parsed = parseStudioProfessionalBrushDynamicsPlan(candidate);
  return parsed.ok ? parsed.plan : null;
}

function embeddedAssetResolver(
  assets: readonly StudioEngineWebGpuTexturedBrushAssetPayload[],
): StudioEngineWebGpuTexturedBrushAssetResolver {
  return Object.freeze({
    async resolve(request: Parameters<StudioEngineWebGpuTexturedBrushAssetResolver["resolve"]>[0]) {
      const asset = assets.find((candidate) =>
        candidate.assetId === request.assetId
        && candidate.contentHash === request.contentHash
        && candidate.channel === request.expectedChannel
        && candidate.width === request.expectedWidth
        && candidate.height === request.expectedHeight
        && candidate.byteLength <= request.maximumByteLength
      );
      return asset
        ? {
            ...asset,
            bytes: new Uint8Array(asset.bytes),
          }
        : null;
    },
  });
}

function texturedDabsFromDynamicPlan(
  canonical: StudioCanonicalBrushPlan,
  basePlan: StudioEngineWebGpuTexturedBrushPlan,
  element: DrawEl,
  dynamics: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
): readonly StudioEngineWebGpuTexturedBrushDab[] | null {
  if (
    dabs.length < 1
    || dabs.length > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs
    || basePlan.assets.length !== 1
    || basePlan.batches.length !== 1
  ) return null;
  const [red, green, blue, sourceAlpha] = canonical.color.components;
  const hardness = basePlan.dabs[0]?.tip.hardness ?? canonical.recipe.hardness;
  const grainDepth = basePlan.grain?.depth ?? 0;
  const result: StudioEngineWebGpuTexturedBrushDab[] = [];
  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index]!;
    const radius = dab.size / 2;
    const angleRadians = dab.angle * Math.PI / 180;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    const opacity = clamp01(canonical.composite.opacity * dab.opacity);
    const flow = clamp01(dab.flow);
    const alpha = clamp01(sourceAlpha * opacity * flow);
    const values = [
      dab.sourceX,
      dab.sourceY,
      dab.x,
      dab.y,
      dab.size,
      dab.roundness,
      angleRadians,
      opacity,
      flow,
      alpha,
    ];
    if (
      !values.every(finite)
      || dab.size <= 0
      || dab.roundness <= 0
      || dab.roundness > 1
    ) return null;
    result.push(Object.freeze({
      index,
      stationX: Math.fround(dab.sourceX),
      stationY: Math.fround(dab.sourceY),
      x: Math.fround(dab.x),
      y: Math.fround(dab.y),
      pressure: Math.fround(
        pressureAtProgress(element, dab.progress, dynamics.fallbackPressure),
      ),
      diameter: Math.fround(dab.size),
      opacity: Math.fround(opacity),
      flow: Math.fround(flow),
      grainDepth: Math.fround(grainDepth),
      color: Object.freeze({
        space: "linear-srgb",
        alphaMode: "straight",
        components: Object.freeze([
          Math.fround(red),
          Math.fround(green),
          Math.fround(blue),
          Math.fround(alpha),
        ]) as unknown as readonly [number, number, number, number],
      }),
      composite: Object.freeze({
        porterDuff: "source-over",
        blendMode: "normal",
      }),
      tip: Object.freeze({
        hardness: Math.fround(hardness),
        roundness: Math.fround(dab.roundness),
        angleRadians: Math.fround(angleRadians),
        localToDocument: Object.freeze([
          Math.fround(cosine * radius),
          Math.fround(sine * radius),
          Math.fround(-sine * radius * dab.roundness),
          Math.fround(cosine * radius * dab.roundness),
        ]) as unknown as readonly [number, number, number, number],
      }),
    }));
  }
  return Object.freeze(result);
}

function rebuildTexturedPlan(
  basePlan: StudioEngineWebGpuTexturedBrushPlan,
  dabs: readonly StudioEngineWebGpuTexturedBrushDab[],
): StudioEngineWebGpuTexturedBrushPlan | null {
  const firstBatch = basePlan.batches[0];
  if (!firstBatch || dabs.length < 1) return null;
  const withoutFingerprint: StudioEngineWebGpuTexturedBrushPlan = {
    ...basePlan,
    mode: "rebuild",
    dabs,
    batches: Object.freeze([Object.freeze({
      ...firstBatch,
      firstInstance: 0,
      instanceCount: dabs.length,
    })]),
    semanticFingerprint: undefined,
  };
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(withoutFingerprint);
  return semanticFingerprint
    ? Object.freeze({ ...withoutFingerprint, semanticFingerprint })
    : null;
}

export async function compileStudioCanonicalVNextDryMediaProductFrame(
  request: StudioCanonicalVNextDryMediaProductCompileRequest,
): Promise<StudioCanonicalVNextDryMediaProductCompileResult> {
  const { element } = request;
  if (
    !element
    || element.type !== "draw"
    || element.kind && element.kind !== "freehand"
    || element.mode === "eraser"
    || element.brush !== "dry-media"
    || !positiveSafeInteger(request.sessionEpoch)
    || !positiveSafeInteger(request.strokeEpoch)
    || !positiveSafeInteger(request.commandSequence)
  ) return unavailableResult("invalid-input");
  if (request.signal?.aborted) return unavailableResult("invalid-input", "cancelled");
  const classification = classifyStudioDryMediaCatalogIdV1(element.brushCatalogId);
  if (classification?.kind !== "anisotropic-continuous") {
    return unavailableResult("ineligible-material");
  }
  if (element.brushCatalogId === "paint-roller") {
    return unavailableResult("unsupported-paint-roller");
  }
  if ((element.symmetry?.type ?? "none") !== "none") {
    return unavailableResult("unsupported-symmetry");
  }
  if (
    element.blendMode !== undefined
      && element.blendMode !== "normal"
      && element.blendMode !== "source-over"
  ) return unavailableResult("unsupported-composite");
  if (
    element.paintModel !== undefined
    && (
      element.paintModel !== "bounded-flow-v2"
      || (element.opacity ?? 1) !== 1
    )
  ) {
    return unavailableResult(
      "unsupported-paint-model",
      `${element.paintModel}:${element.opacity ?? 1}`,
    );
  }

  const dynamicPlanResult = planStudioDynamicBrushRender(element, "dry-media", false);
  if (dynamicPlanResult.status !== "ready") {
    return unavailableResult("dynamic-plan-rejected", dynamicPlanResult.reason);
  }
  const dynamicPlan = dynamicPlanResult.plan;
  if (dualTipIsActive(dynamicPlan.dynamics)) {
    return unavailableResult("unsupported-multi-tip");
  }
  if (!colorDynamicsAreIdentity(dynamicPlan.dynamics)) {
    return unavailableResult("unsupported-color-dynamics");
  }
  if (dynamicPlan.dynamics.grain.source) {
    return unavailableResult("unsupported-grain-source");
  }
  if (
    dynamicPlan.materialIdentity.dryMediaPresetId !== classification.presetId
    || dynamicPlan.dabVariations.length !== 1
  ) return unavailableResult("ineligible-material");

  const variation = dynamicPlan.dabVariations[0] as StudioDryMediaDynamicDabVariation;
  const bridged = bridgeStudioDynamicDabVariationToDryMediaV1({
    materialIdentity: dynamicPlan.materialIdentity,
    seed: dynamicPlan.seed,
    variation,
  });
  if (!bridged.ok || !bridged.applied) {
    return unavailableResult(
      "dynamic-plan-rejected",
      bridged.ok ? "bridge-not-applied" : bridged.reason,
    );
  }
  const sourceDabs = flattenVariation(variation);
  const materialDabs = flattenVariation(bridged.variation);
  if (sourceDabs.length < 1 || materialDabs.length < 1) {
    return unavailableResult("dynamic-plan-rejected", "empty-plan");
  }
  const laneRatio = materialDabs.length / sourceDabs.length;
  if (laneRatio !== 3 && laneRatio !== 5) {
    return unavailableResult("dynamic-plan-rejected", "invalid-lane-count");
  }

  const projection = canonicalProjection(element, dynamicPlan.dynamics);
  const adapted = adaptStudioDrawElementToCanonicalBrushPlan({
    element: projection,
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.strokeEpoch,
    commandSequence: request.commandSequence,
    firstSampleSequence: 1,
    firstTimeMilliseconds: 0,
    fallbackSampleIntervalMilliseconds: 1,
    colorSpace: "linear-srgb",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
  });
  if (adapted.status !== "ready") {
    return unavailableResult(
      "canonical-adapter-rejected",
      `${adapted.reason}:${adapted.path}`,
    );
  }
  const dynamicsCanonical = serializeStudioBrushDynamicsSettingsCanonical(
    dynamicPlan.dynamics,
  );
  const dynamicPlanDigest =
    `sha256:${sha256HexPortable(new TextEncoder().encode(JSON.stringify({
      catalogueId: element.brushCatalogId,
      material: dynamicPlan.materialIdentity,
      dynamics: dynamicsCanonical,
    })))}` as const;
  const canonicalEnvelope = bindDynamicIdentity(adapted.plan, dynamicPlanDigest);
  if (!canonicalEnvelope.ok) {
    return unavailableResult("canonical-envelope-rejected", canonicalEnvelope.detail);
  }
  const canonicalPlan = canonicalEnvelope.plan;
  const assetDynamics = assetLoweringDynamics(canonicalPlan);
  if (!assetDynamics) return unavailableResult("textured-plan-rejected", "asset-dynamics");
  const baseTextured = await buildStudioEngineWebGpuTexturedBrushPlan(
    canonicalPlan,
    assetDynamics,
    embeddedAssetResolver(adapted.assets),
    { mode: "rebuild", signal: request.signal },
  );
  if (baseTextured.status !== "ready") {
    return unavailableResult(
      "textured-plan-rejected",
      `${baseTextured.status}:${"reason" in baseTextured ? baseTextured.reason : ""}`,
    );
  }
  const texturedDabs = texturedDabsFromDynamicPlan(
    canonicalPlan,
    baseTextured.plan,
    element,
    dynamicPlan.dynamics,
    materialDabs,
  );
  if (!texturedDabs) return unavailableResult("textured-plan-rejected", "material-dabs");
  const texturedPlan = rebuildTexturedPlan(baseTextured.plan, texturedDabs);
  if (!texturedPlan) return unavailableResult("textured-plan-rejected", "fingerprint");
  const frame: StudioCanonicalVNextDryMediaCompiledFrame = Object.freeze({
    kind: "studio-canonical-vnext-dry-media-compiled-frame",
    version:
      STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION,
    catalogId: STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CATALOG_ID,
    canonicalPlan,
    canonicalPlanHash: hashStudioCanonicalBrushPlan(canonicalPlan),
    texturedPlan,
  });
  const quality = validateStudioCanonicalVNextDryMediaCompiledFrame(frame);
  if (quality.status !== "ready") {
    return unavailableResult("quality-gate-rejected", quality.reason);
  }
  return Object.freeze({
    status: "ready",
    adapterVersion:
      STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRODUCT_ADAPTER_VERSION,
    elementId: element.id,
    catalogueId: element.brushCatalogId!,
    dynamicPlanDigest,
    sourceDabCount: sourceDabs.length,
    texturedDabCount: materialDabs.length,
    laneCount: laneRatio,
    frame,
  });
}
