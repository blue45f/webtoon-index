import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsEqual,
  studioBrushDynamicsPresetSettings,
} from "../brush/studio-brush-dynamics";

import type { DrawEl, El } from "../studio-element-model";
import type { StudioLiveGesturePreviewRendererSnapshot } from "./studio-live-gesture-preview";
import type {
  StudioLiveGesturePreviewSnapshot,
  StudioLiveGesturePreviewSnapshotEntry,
} from "./studio-live-gesture-preview-store";

function previewBrushDynamics(
  renderer: StudioLiveGesturePreviewRendererSnapshot,
): DrawEl["brushDynamics"] {
  const preview = renderer.brushDynamics;
  if (!preview) return undefined;
  const preset = studioBrushDynamicsPresetSettings(preview.presetId);
  return normalizeStudioBrushDynamicsSettings({
    ...preset,
    seed: preview.seed,
    fallbackPressure: preview.fallbackPressure,
    ...(preview.minimumDiameterRatio === undefined
      ? {}
      : { minimumDiameterRatio: preview.minimumDiameterRatio }),
    ...(preview.spacingRatio === undefined
      ? {}
      : { spacingRatio: preview.spacingRatio }),
    ...(preview.scatterRatio === undefined
      ? {}
      : { scatterRatio: preview.scatterRatio }),
  });
}

function operationMatchesRenderer(
  entry: StudioLiveGesturePreviewSnapshotEntry,
): boolean {
  const renderer = entry.renderer;
  if (!renderer) return false;
  switch (entry.operation) {
    case "draw":
      return renderer.kind === "freehand"
        && renderer.mode === "pen"
        && renderer.fill === undefined;
    case "erase":
      return renderer.kind === "freehand"
        && renderer.mode === "eraser"
        && renderer.fill === undefined;
    case "lasso-fill":
      return renderer.kind === "freehand"
        && renderer.mode === "pen"
        && renderer.fill !== undefined;
    case "shape":
      return Boolean(
        entry.shape
        && renderer.kind !== "freehand"
        && renderer.kind === entry.shape.kind
        && renderer.mode === "pen",
      );
    case "retouch":
      return false;
  }
}

function copySampleChannels(
  entry: StudioLiveGesturePreviewSnapshotEntry,
): Partial<DrawEl> {
  const samples = entry.samples;
  if (!samples) return {};
  return {
    ...(samples.pressures ? { pressures: [...samples.pressures] } : {}),
    ...(samples.tiltXs ? { tiltXs: [...samples.tiltXs] } : {}),
    ...(samples.tiltYs ? { tiltYs: [...samples.tiltYs] } : {}),
    ...(samples.twists ? { twists: [...samples.twists] } : {}),
    ...(samples.speeds ? { speeds: [...samples.speeds] } : {}),
    ...(samples.tangentialPressures
      ? { tangentialPressures: [...samples.tangentialPressures] }
      : {}),
    ...(samples.altitudeAngles
      ? { altitudeAngles: [...samples.altitudeAngles] }
      : {}),
    ...(samples.azimuthAngles
      ? { azimuthAngles: [...samples.azimuthAngles] }
      : {}),
    ...(samples.contactWidths
      ? { contactWidths: [...samples.contactWidths] }
      : {}),
    ...(samples.contactHeights
      ? { contactHeights: [...samples.contactHeights] }
      : {}),
    ...(samples.sampleTimeOffsets
      ? { sampleTimeOffsets: [...samples.sampleTimeOffsets] }
      : {}),
  };
}

/**
 * Converts one strict store entry into a disposable DrawEl for the retained `activeDraft` lane.
 * The result must never enter history, export, hit testing, or the authoritative CRDT document.
 */
export function projectStudioLiveGesturePreviewEntry(
  entry: StudioLiveGesturePreviewSnapshotEntry,
): DrawEl | null {
  if (!operationMatchesRenderer(entry) || entry.retouch) return null;
  const renderer = entry.renderer!;
  const shape = entry.shape;
  const samples = entry.samples;
  const points = entry.operation === "shape"
    ? shape
      ? [shape.x0, shape.y0, shape.x1, shape.y1]
      : null
    : samples
      && samples.points.length / 2 === entry.sampleCount
      && entry.sampleCount > 0
      ? [...samples.points]
      : null;
  if (!points) return null;

  let brushDynamics: DrawEl["brushDynamics"];
  try {
    brushDynamics = previewBrushDynamics(renderer);
  } catch {
    return null;
  }

  return {
    id: entry.gestureId,
    type: "draw",
    kind: renderer.kind,
    mode: renderer.mode,
    points,
    stroke: renderer.stroke,
    strokeWidth: renderer.strokeWidth,
    ...(renderer.opacity === undefined ? {} : { opacity: renderer.opacity }),
    ...(renderer.fill === undefined ? {} : { fill: renderer.fill }),
    ...(renderer.brush === undefined ? {} : { brush: renderer.brush }),
    ...(renderer.brushCatalogId === undefined
      ? {}
      : { brushCatalogId: renderer.brushCatalogId }),
    ...(renderer.brushCatalogName === undefined
      ? {}
      : { brushCatalogName: renderer.brushCatalogName }),
    ...(renderer.sampleSpacing === undefined
      ? {}
      : { sampleSpacing: renderer.sampleSpacing }),
    ...(renderer.blendMode === undefined
      ? {}
      : {
          blendMode: renderer.blendMode === "normal"
            ? "source-over"
            : renderer.blendMode,
        }),
    ...(renderer.paintModel === undefined ? {} : { paintModel: renderer.paintModel }),
    ...(renderer.pressureModel === undefined
      ? {}
      : { pressureModel: renderer.pressureModel }),
    ...(renderer.materialPressureModel === undefined
      ? {}
      : { materialPressureModel: renderer.materialPressureModel }),
    ...(renderer.materialMinimumDiameterRatio === undefined
      ? {}
      : { materialMinimumDiameterRatio: renderer.materialMinimumDiameterRatio }),
    ...(renderer.watercolorPipeline === undefined
      ? {}
      : { watercolorPipeline: renderer.watercolorPipeline }),
    ...(renderer.stampPipeline === undefined
      ? {}
      : { stampPipeline: renderer.stampPipeline }),
    ...(renderer.brushTip ? { brushTip: { ...renderer.brushTip } } : {}),
    ...(renderer.strokeStyle
      ? { strokeStyle: { ...renderer.strokeStyle } }
      : {}),
    ...(renderer.shapeParams
      ? { shapeParams: { ...renderer.shapeParams } }
      : {}),
    ...(renderer.sketch ? { sketch: { ...renderer.sketch } } : {}),
    ...(renderer.symmetry ? { symmetry: { ...renderer.symmetry } } : {}),
    ...(brushDynamics ? { brushDynamics } : {}),
    ...copySampleChannels(entry),
  };
}

export function projectStudioLiveGesturePreviewSnapshot(
  snapshot: StudioLiveGesturePreviewSnapshot,
): readonly DrawEl[] {
  const projected: DrawEl[] = [];
  for (const entry of snapshot) {
    const element = projectStudioLiveGesturePreviewEntry(entry);
    if (element) projected.push(element);
  }
  return projected;
}

function drawKind(element: DrawEl): NonNullable<DrawEl["kind"]> {
  return element.kind ?? "freehand";
}

function shapeEndpointsMatch(authoritative: DrawEl, preview: DrawEl): boolean {
  return drawKind(authoritative) === drawKind(preview)
    && authoritative.points.length >= 4
    && authoritative.points[0] === preview.points[0]
    && authoritative.points[1] === preview.points[1]
    && authoritative.points[2] === preview.points[2]
    && authoritative.points[3] === preview.points[3];
}

function canonicalBlendMode(blendMode: string | undefined): string {
  return blendMode === undefined || blendMode === "normal"
    ? "source-over"
    : blendMode;
}

function optionalFlatObjectFieldsEqual<T extends object>(
  left: T | undefined,
  right: T | undefined,
  fields: readonly (keyof T)[],
): boolean {
  if (!left || !right) return left === right;
  return fields.every((field) => Object.is(left[field], right[field]));
}

function rendererIdentityMatches(authoritative: DrawEl, preview: DrawEl): boolean {
  return (authoritative.mode ?? "pen") === (preview.mode ?? "pen")
    && authoritative.stroke === preview.stroke
    && authoritative.strokeWidth === preview.strokeWidth
    && (authoritative.opacity ?? 1) === (preview.opacity ?? 1)
    && authoritative.fill === preview.fill
    && authoritative.brush === preview.brush
    && authoritative.brushCatalogId === preview.brushCatalogId
    && authoritative.brushCatalogName === preview.brushCatalogName
    && authoritative.sampleSpacing === preview.sampleSpacing
    && canonicalBlendMode(authoritative.blendMode) === canonicalBlendMode(preview.blendMode)
    && authoritative.paintModel === preview.paintModel
    && authoritative.pressureModel === preview.pressureModel
    && authoritative.materialPressureModel === preview.materialPressureModel
    && authoritative.materialMinimumDiameterRatio === preview.materialMinimumDiameterRatio
    && authoritative.watercolorPipeline === preview.watercolorPipeline
    && authoritative.stampPipeline === preview.stampPipeline
    && optionalFlatObjectFieldsEqual(
      authoritative.brushTip,
      preview.brushTip,
      ["tiltEnabled", "angleDeg", "roundness"],
    )
    && optionalFlatObjectFieldsEqual(
      authoritative.strokeStyle,
      preview.strokeStyle,
      ["dash", "lineCap", "arrowStart", "arrowEnd"],
    )
    && optionalFlatObjectFieldsEqual(
      authoritative.shapeParams,
      preview.shapeParams,
      ["starPoints", "starInnerRatio", "polygonSides", "cornerRadius"],
    )
    && optionalFlatObjectFieldsEqual(
      authoritative.sketch,
      preview.sketch,
      ["enabled", "roughness", "bowing", "fillStyle"],
    )
    && optionalFlatObjectFieldsEqual(
      authoritative.symmetry,
      preview.symmetry,
      ["type", "centerX", "centerY", "radialCount"],
    )
    && studioBrushDynamicsSettingsEqual(
      authoritative.brushDynamics,
      preview.brushDynamics,
    )
    // V1 cannot faithfully describe these paint programs. If the retained slot owns one, it wins
    // immediately instead of being approximated by a simpler speculative renderer.
    && authoritative.gradient === undefined
    && authoritative.pattern === undefined
    && authoritative.outlineStroke === undefined
    && authoritative.brushEnginePrograms === undefined
    && authoritative.stamp === undefined;
}

function authoritativeElementWins(authoritative: El, preview: DrawEl): boolean {
  if (authoritative.type !== "draw") return true;
  const previewKind = drawKind(preview);
  const authoritativeKind = drawKind(authoritative);
  // The CRDT slot is authoritative for every incompatible renderer identity. In particular, an
  // eraser preview may never temporarily replace a pen that later appears with the same id.
  if (
    authoritativeKind !== previewKind
    || !rendererIdentityMatches(authoritative, preview)
  ) return true;
  if (previewKind === "freehand") {
    const authoritativeSampleCount = Math.floor(authoritative.points.length / 2);
    const previewSampleCount = Math.floor(preview.points.length / 2);
    return authoritativeSampleCount >= previewSampleCount;
  }
  return shapeEndpointsMatch(authoritative, preview);
}

function withAuthoritativeLayerStructure(
  authoritative: El,
  preview: DrawEl,
): El {
  return {
    ...preview,
    ...(authoritative.name === undefined ? {} : { name: authoritative.name }),
    ...(authoritative.hidden === undefined ? {} : { hidden: authoritative.hidden }),
    ...(authoritative.locked === undefined ? {} : { locked: authoritative.locked }),
    ...(authoritative.noClip === undefined ? {} : { noClip: authoritative.noClip }),
    ...(authoritative.lockAspect === undefined
      ? {}
      : { lockAspect: authoritative.lockAspect }),
    ...(authoritative.groupId === undefined
      ? {}
      : { groupId: authoritative.groupId }),
    ...(authoritative.clipBelow === undefined
      ? {}
      : { clipBelow: authoritative.clipBelow }),
    ...(authoritative.alphaLocked === undefined
      ? {}
      : { alphaLocked: authoritative.alphaLocked }),
    ...(authoritative.maskSrc === undefined
      ? {}
      : { maskSrc: authoritative.maskSrc }),
    ...(authoritative.maskEnabled === undefined
      ? {}
      : { maskEnabled: authoritative.maskEnabled }),
    ...(authoritative.layerRole === undefined
      ? {}
      : { layerRole: authoritative.layerRole }),
    ...(authoritative.layerColor === undefined
      ? {}
      : { layerColor: authoritative.layerColor }),
    ...(authoritative.emeresSourceId === undefined
      ? {}
      : { emeresSourceId: authoritative.emeresSourceId }),
  };
}

export interface StudioLiveGesturePreviewRenderPlan {
  /** The sole paint list for the retained canvas layer. Never persist this list. */
  readonly elements: readonly El[];
  /** Element ids whose current paint slot contains speculative preview geometry. */
  readonly previewElementIds: ReadonlySet<string>;
  /** Preview ids whose authoritative slot is ready to own the next visible layer draw. */
  readonly authoritativeHandoffIds: readonly string[];
  /** Latest preview sequence for cache invalidation of speculative paint slots. */
  readonly previewSequenceByElementId: ReadonlyMap<string, number>;
  /** Changes whenever the exact authoritative gesture+sequence receipt set changes. */
  readonly authoritativeHandoffToken: string;
}

interface ProjectedPreview {
  readonly entry: StudioLiveGesturePreviewSnapshotEntry;
  readonly element: DrawEl;
}

const EMPTY_PREVIEW_ELEMENT_IDS: ReadonlySet<string> = new Set();
const EMPTY_PREVIEW_SEQUENCE_BY_ELEMENT_ID: ReadonlyMap<string, number> = new Map();
const EMPTY_AUTHORITATIVE_HANDOFF_IDS: readonly string[] = Object.freeze([]);

function emptyStudioLiveGesturePreviewRenderPlan(
  authoritative: readonly El[],
): StudioLiveGesturePreviewRenderPlan {
  return {
    elements: authoritative,
    previewElementIds: EMPTY_PREVIEW_ELEMENT_IDS,
    authoritativeHandoffIds: EMPTY_AUTHORITATIVE_HANDOFF_IDS,
    previewSequenceByElementId: EMPTY_PREVIEW_SEQUENCE_BY_ELEMENT_ID,
    authoritativeHandoffToken: "[]",
  };
}

/**
 * Builds the one retained-layer paint plan for speculative remote gestures. Eligibility is pinned
 * by the room adapter to the exact sender+gesture begin packet. Ambiguous ids are omitted from both
 * preview paint and authoritative receipts, so an id collision always fails closed.
 */
export function planStudioLiveGesturePreviewRenderElements(
  authoritative: readonly El[],
  snapshot: StudioLiveGesturePreviewSnapshot,
  eligiblePreviewKeys: ReadonlySet<string>,
  reservedAuthoritativeElementIds?: ReadonlySet<string>,
): StudioLiveGesturePreviewRenderPlan {
  if (
    !eligiblePreviewKeys
    || typeof eligiblePreviewKeys.has !== "function"
    || snapshot.length === 0
    || eligiblePreviewKeys.size === 0
  ) {
    return emptyStudioLiveGesturePreviewRenderPlan(authoritative);
  }

  const projected: ProjectedPreview[] = [];
  const previewIdCounts = new Map<string, number>();
  for (const entry of snapshot) {
    if (!eligiblePreviewKeys.has(entry.key)) continue;
    const element = projectStudioLiveGesturePreviewEntry(entry);
    if (!element) continue;
    projected.push({ entry, element });
    previewIdCounts.set(element.id, (previewIdCounts.get(element.id) ?? 0) + 1);
  }
  if (projected.length === 0) {
    return emptyStudioLiveGesturePreviewRenderPlan(authoritative);
  }

  const authoritativeIndex = new Map<string, number>();
  const duplicateAuthoritativeIds = new Set<string>();
  for (const [index, element] of authoritative.entries()) {
    if (authoritativeIndex.has(element.id)) duplicateAuthoritativeIds.add(element.id);
    else authoritativeIndex.set(element.id, index);
  }

  let merged: El[] | null = null;
  const previewElementIds = new Set<string>();
  const previewSequenceByElementId = new Map<string, number>();
  const authoritativeHandoffIds: string[] = [];
  const authoritativeHandoffReceipts: Array<readonly [gestureId: string, seq: number]> = [];

  for (const { entry, element: preview } of projected) {
    if (
      previewIdCounts.get(preview.id) !== 1
      || duplicateAuthoritativeIds.has(preview.id)
    ) continue;

    const index = authoritativeIndex.get(preview.id);
    if (index === undefined) {
      // Paint projections may temporarily omit an authored work-asset element while it hydrates.
      // Its raw document id still reserves the slot, so a remote gesture may not borrow that id.
      if (reservedAuthoritativeElementIds?.has(preview.id)) continue;
      merged ??= [...authoritative];
      authoritativeIndex.set(preview.id, merged.length);
      merged.push(preview);
      previewElementIds.add(preview.id);
      previewSequenceByElementId.set(preview.id, entry.seq);
      continue;
    }

    const current = (merged ?? authoritative)[index]!;
    if (authoritativeElementWins(current, preview)) {
      authoritativeHandoffIds.push(preview.id);
      authoritativeHandoffReceipts.push([preview.id, entry.seq]);
      continue;
    }

    merged ??= [...authoritative];
    merged[index] = withAuthoritativeLayerStructure(current, preview);
    previewElementIds.add(preview.id);
    previewSequenceByElementId.set(preview.id, entry.seq);
  }

  return {
    elements: merged ?? authoritative,
    previewElementIds,
    authoritativeHandoffIds,
    previewSequenceByElementId,
    authoritativeHandoffToken: JSON.stringify(authoritativeHandoffReceipts),
  };
}

/**
 * Produces one paint slot per id during the speculative→CRDT handoff. A lagging authoritative
 * element is replaced in place, never painted beside its preview, so alpha and destination-out
 * cannot be applied twice. Once authoritative geometry catches up, its original object wins.
 */
export function mergeStudioLiveGesturePreviewElements(
  authoritative: readonly El[],
  snapshot: StudioLiveGesturePreviewSnapshot,
  eligiblePreviewKeys: ReadonlySet<string>,
): readonly El[] {
  return planStudioLiveGesturePreviewRenderElements(
    authoritative,
    snapshot,
    eligiblePreviewKeys,
  ).elements;
}

/**
 * Returns preview ids whose authoritative render slot is ready to own the next visible layer draw.
 * The caller must wait for that draw receipt before retiring the matching store entries.
 */
export function studioLiveGesturePreviewAuthoritativeReceiptIds(
  authoritative: readonly El[],
  snapshot: StudioLiveGesturePreviewSnapshot,
  eligiblePreviewKeys: ReadonlySet<string>,
): readonly string[] {
  return planStudioLiveGesturePreviewRenderElements(
    authoritative,
    snapshot,
    eligiblePreviewKeys,
  ).authoritativeHandoffIds;
}
