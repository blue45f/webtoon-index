/**
 * SVG-only exact R8 coverage bridge.
 *
 * The retained Canvas planner temporarily bakes one Float32 tip × paper map per dab because its
 * mark plan must outlive planning. SVG does not need to retain those maps: it can encode one map,
 * append the corresponding definition/use markup, zero the temporary Float32 storage, and move
 * to the next dab. This visitor preserves the Canvas CPU sampler and mark order while keeping
 * transient alpha-map memory at O(one tip), not O(dabs × tip).
 *
 * We intentionally do not express the R8 paper as an SVG pattern/filter. SVG implementations are
 * allowed to differ in pattern anchoring, colour interpolation and filter precision, so that route
 * cannot guarantee the verified CPU sampler's pixels across renderers.
 */

import { resolveNormalizedStudioBrushDabColor } from "../brush/studio-brush-material-dynamics";
import {
  composeStudioBrushR8TipPaperAlphaMap,
  resolveStudioBrushR8GrainSampler,
} from "../brush/studio-brush-r8-grain-runtime";
import {
  composeNormalizedStudioBrushTipLayerDab,
  composeStudioBrushDualTipAlphaMap,
  type StudioBrushComposableDab,
} from "../brush/studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  type StudioBrushTipAlphaMap,
} from "../brush/studio-brush-tip-stamp";
import {
  bridgeStudioDynamicDabVariationToDryMediaV1,
  type StudioDynamicBrushMaterialIdentity,
} from "../brush/studio-dry-media-dynamic-bridge";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "../brush/studio-brush-dynamics";

/**
 * Bounds the deterministic, uncompressed RGBA payload represented by SVG mask images. Base64 and
 * XML add predictable overhead, but this 64 MiB preflight prevents a hostile stroke from asking
 * the synchronous serializer to construct an unbounded document. It is four times the former
 * retained-Float32 ceiling for the same tip resolution while transient Float32 use remains one map.
 */
export const STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET = 64 * 1_024 * 1_024;

export interface StudioSvgR8SegmentedDabVariation {
  readonly kind: "studio-dynamic-brush-segmented-dab-variation";
  readonly segments: readonly (readonly StudioDynamicBrushDab[])[];
}

export type StudioSvgR8DabVariation =
  | readonly StudioDynamicBrushDab[]
  | StudioSvgR8SegmentedDabVariation;

export interface StudioSvgR8StreamingCoverageMark {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  readonly alpha: number;
  readonly color: string;
  readonly texture: Readonly<{
    readonly kind: "alpha-map";
    /**
     * Ephemeral exact tip × R8 paper map. Callers may only consume it synchronously; the visitor
     * zeros its Float32 storage immediately after the callback returns.
     */
    readonly alphaMap: StudioBrushTipAlphaMap;
  }>;
}

export interface StudioSvgR8StreamingExportInput {
  readonly dabVariations: readonly StudioSvgR8DabVariation[];
  readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  readonly materialIdentity?: StudioDynamicBrushMaterialIdentity;
  readonly dynamicSeed: number;
  readonly stroke: string;
  readonly markBudget: number;
  readonly rgbaByteBudget?: number;
}

export type StudioSvgR8StreamingMarkVisitor = (
  mark: Readonly<StudioSvgR8StreamingCoverageMark>,
  variationIndex: number,
  markIndexInVariation: number,
) => boolean;

export type StudioSvgR8StreamingExportResult =
  | Readonly<{
      ok: true;
      sourceKey: string;
      marksPerVariation: readonly number[];
      totalMarks: number;
      /** Sum of all generated Float32 map bytes; may exceed the peak by many orders of magnitude. */
      generatedAlphaMapBytes: number;
      /** Maximum simultaneously live per-dab Float32 map storage. */
      peakTransientAlphaMapBytes: number;
      /** Deterministic raw RGBA bytes represented by the embedded SVG mask images. */
      embeddedRgbaBytes: number;
      rgbaByteBudget: number;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "invalid-input"
        | "dry-media-bridge"
        | "r8-grain-unavailable"
        | "mark-budget"
        | "embedded-rgba-budget"
        | "invalid-mark"
        | "sink-rejected"
        | "sink-failed";
    }>;

function clampAlpha(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

function isSegmentedVariation(
  variation: StudioSvgR8DabVariation,
): variation is StudioSvgR8SegmentedDabVariation {
  return !Array.isArray(variation);
}

function variationDabCount(variation: StudioSvgR8DabVariation): number {
  if (!isSegmentedVariation(variation)) return variation.length;
  let total = 0;
  for (const segment of variation.segments) {
    total += segment.length;
    if (!Number.isSafeInteger(total)) return Number.POSITIVE_INFINITY;
  }
  return total;
}

function variationFirstDab(
  variation: StudioSvgR8DabVariation,
): StudioDynamicBrushDab | undefined {
  if (!isSegmentedVariation(variation)) return variation[0];
  for (const segment of variation.segments) {
    if (segment[0]) return segment[0];
  }
  return undefined;
}

function* dabsInVariation(
  variation: StudioSvgR8DabVariation,
): Generator<StudioDynamicBrushDab, void> {
  if (!isSegmentedVariation(variation)) {
    yield* variation;
    return;
  }
  for (const segment of variation.segments) yield* segment;
}

function safeProduct(left: number, right: number): number | null {
  const product = left * right;
  return Number.isSafeInteger(product) && product >= 0 ? product : null;
}

function streamingMarkIsValid(mark: StudioSvgR8StreamingCoverageMark): boolean {
  return Number.isFinite(mark.x)
    && Number.isFinite(mark.y)
    && Number.isFinite(mark.radiusX)
    && mark.radiusX > 0
    && Number.isFinite(mark.radiusY)
    && mark.radiusY > 0
    && Number.isFinite(mark.angleRadians)
    && Number.isFinite(mark.alpha)
    && mark.alpha >= 0
    && mark.alpha <= 1
    && typeof mark.color === "string"
    && mark.color.length > 0
    && Number.isSafeInteger(mark.texture.alphaMap.size)
    && mark.texture.alphaMap.size > 0
    && mark.texture.alphaMap.alphas instanceof Float32Array
    && mark.texture.alphaMap.alphas.length
      === mark.texture.alphaMap.size * mark.texture.alphaMap.size;
}

/**
 * Visits exact R8 coverage in variation-major, dab-major, primary-then-layer order.
 *
 * The callback must synchronously encode/copy everything it needs. Every composed alpha map is
 * zeroized in `finally`, including rejected/throwing sinks, so neither the caller nor an export
 * Worker can accidentally retain stroke-wide Float32 paper maps.
 */
export function visitStudioSvgR8StreamingCoverage(
  input: StudioSvgR8StreamingExportInput,
  visit: StudioSvgR8StreamingMarkVisitor,
): StudioSvgR8StreamingExportResult {
  const markBudget = Number.isFinite(input.markBudget)
    ? Math.max(1, Math.floor(input.markBudget))
    : 0;
  const rgbaByteBudget = Number.isFinite(input.rgbaByteBudget)
    ? Math.max(
        0,
        Math.min(
          STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET,
          Math.floor(input.rgbaByteBudget as number),
        ),
      )
    : STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET;
  if (
    markBudget <= 0
    || rgbaByteBudget <= 0
    || !Number.isFinite(input.dynamicSeed)
    || typeof input.stroke !== "string"
    || input.stroke.length === 0
    || typeof visit !== "function"
  ) {
    return { ok: false, reason: "invalid-input" };
  }

  let dabVariations: readonly StudioSvgR8DabVariation[] = input.dabVariations;
  if (input.materialIdentity) {
    const bridgedVariations: StudioSvgR8DabVariation[] = [];
    for (const variation of input.dabVariations) {
      const bridged = bridgeStudioDynamicDabVariationToDryMediaV1({
        materialIdentity: input.materialIdentity,
        seed: input.dynamicSeed,
        variation,
      });
      if (!bridged.ok) {
        return { ok: false, reason: "dry-media-bridge" };
      }
      bridgedVariations.push(bridged.variation);
    }
    dabVariations = bridgedVariations;
  }

  const source = input.dynamics.grain.amount > 0
    ? input.dynamics.grain.source
    : undefined;
  const sampler = source
    ? resolveStudioBrushR8GrainSampler(source)
    : null;
  if (!source || !sampler) {
    return { ok: false, reason: "r8-grain-unavailable" };
  }

  const tipAlphaMaps = [
    composeStudioBrushDualTipAlphaMap(
      input.dynamics.tip,
      input.dynamics.dualBrush,
    ),
    ...input.dynamics.tipLayers.map((layer) => (
      buildStudioBrushTipAlphaMap(layer.tip)
    )),
  ];
  const enabledTipIndexes = [
    0,
    ...input.dynamics.tipLayers.flatMap((layer, layerIndex) => (
      layer.opacity > 0 ? [layerIndex + 1] : []
    )),
  ];
  let maximumMarks = 0;
  for (const variation of dabVariations) {
    const count = variationDabCount(variation);
    const variationMaximum = safeProduct(count, enabledTipIndexes.length);
    if (variationMaximum === null) {
      return { ok: false, reason: "invalid-input" };
    }
    maximumMarks += variationMaximum;
    if (!Number.isSafeInteger(maximumMarks)) {
      return { ok: false, reason: "invalid-input" };
    }
  }
  if (maximumMarks > markBudget) {
    return { ok: false, reason: "mark-budget" };
  }

  let rgbaBytesPerDab = 0;
  for (const tipIndex of enabledTipIndexes) {
    const map = tipAlphaMaps[tipIndex];
    if (!map) return { ok: false, reason: "invalid-input" };
    const pixels = safeProduct(map.size, map.size);
    const rgbaBytes = pixels === null ? null : safeProduct(pixels, 4);
    if (rgbaBytes === null) return { ok: false, reason: "invalid-input" };
    rgbaBytesPerDab += rgbaBytes;
    if (!Number.isSafeInteger(rgbaBytesPerDab)) {
      return { ok: false, reason: "invalid-input" };
    }
  }
  const maximumEmbeddedRgbaBytes = safeProduct(
    dabVariations.reduce(
      (total, variation) => total + variationDabCount(variation),
      0,
    ),
    rgbaBytesPerDab,
  );
  if (
    maximumEmbeddedRgbaBytes === null
    || maximumEmbeddedRgbaBytes > rgbaByteBudget
  ) {
    return { ok: false, reason: "embedded-rgba-budget" };
  }

  const marksPerVariation = dabVariations.map(() => 0);
  let totalMarks = 0;
  let generatedAlphaMapBytes = 0;
  let peakTransientAlphaMapBytes = 0;
  let embeddedRgbaBytes = 0;

  const visitComposedDab = (
    composedDab: StudioBrushComposableDab,
    tipAlphaMap: StudioBrushTipAlphaMap,
    variationIndex: number,
    strokeOriginX: number,
    strokeOriginY: number,
    dabColor: string,
  ): StudioSvgR8StreamingExportResult | null => {
    const depositionAlpha = clampAlpha(
      composedDab.opacity * composedDab.flow,
    );
    if (depositionAlpha <= 0) return null;
    const radiusX = Math.max(0.25, composedDab.size / 2);
    const radiusY = radiusX * composedDab.roundness;
    const angleRadians = composedDab.angle * Math.PI / 180;
    const composedAlphaMap = composeStudioBrushR8TipPaperAlphaMap({
      tip: tipAlphaMap,
      sampler,
      grain: input.dynamics.grain,
      centerX: composedDab.x,
      centerY: composedDab.y,
      radiusX,
      radiusY,
      angleRadians,
      strokeOriginX,
      strokeOriginY,
      strokeSeed: input.dynamicSeed,
    });
    if (!composedAlphaMap) {
      return { ok: false, reason: "invalid-mark" };
    }
    const transientBytes = composedAlphaMap.alphas.byteLength;
    generatedAlphaMapBytes += transientBytes;
    peakTransientAlphaMapBytes = Math.max(
      peakTransientAlphaMapBytes,
      transientBytes,
    );
    embeddedRgbaBytes += composedAlphaMap.size * composedAlphaMap.size * 4;
    const mark: StudioSvgR8StreamingCoverageMark = {
      x: composedDab.x,
      y: composedDab.y,
      radiusX,
      radiusY,
      angleRadians,
      alpha: depositionAlpha,
      color: dabColor,
      texture: {
        kind: "alpha-map",
        alphaMap: composedAlphaMap,
      },
    };
    try {
      if (!streamingMarkIsValid(mark)) {
        return { ok: false, reason: "invalid-mark" };
      }
      const markIndexInVariation = marksPerVariation[variationIndex]!;
      if (!visit(mark, variationIndex, markIndexInVariation)) {
        return { ok: false, reason: "sink-rejected" };
      }
      marksPerVariation[variationIndex] = markIndexInVariation + 1;
      totalMarks += 1;
      return null;
    } catch {
      return { ok: false, reason: "sink-failed" };
    } finally {
      composedAlphaMap.alphas.fill(0);
    }
  };

  for (
    let variationIndex = 0;
    variationIndex < dabVariations.length;
    variationIndex += 1
  ) {
    const variation = dabVariations[variationIndex]!;
    const firstDab = variationFirstDab(variation);
    const strokeOriginX = firstDab?.sourceX ?? firstDab?.x ?? 0;
    const strokeOriginY = firstDab?.sourceY ?? firstDab?.y ?? 0;
    for (const dab of dabsInVariation(variation)) {
      const dabColor = resolveNormalizedStudioBrushDabColor(
        input.stroke,
        dab.index,
        input.dynamicSeed,
        input.dynamics.colorDynamics,
      );
      const primaryFailure = visitComposedDab(
        dab,
        tipAlphaMaps[0]!,
        variationIndex,
        strokeOriginX,
        strokeOriginY,
        dabColor,
      );
      if (primaryFailure) return primaryFailure;
      for (
        let layerIndex = 0;
        layerIndex < input.dynamics.tipLayers.length;
        layerIndex += 1
      ) {
        const layer = input.dynamics.tipLayers[layerIndex]!;
        const composedDab = composeNormalizedStudioBrushTipLayerDab(dab, layer);
        if (!composedDab) continue;
        const layerFailure = visitComposedDab(
          composedDab,
          tipAlphaMaps[layerIndex + 1]!,
          variationIndex,
          strokeOriginX,
          strokeOriginY,
          dabColor,
        );
        if (layerFailure) return layerFailure;
      }
    }
  }

  return Object.freeze({
    ok: true,
    sourceKey: sampler.sourceKey,
    marksPerVariation: Object.freeze([...marksPerVariation]),
    totalMarks,
    generatedAlphaMapBytes,
    peakTransientAlphaMapBytes,
    embeddedRgbaBytes,
    rgbaByteBudget,
  });
}
