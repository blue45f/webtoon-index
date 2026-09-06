import { studioHighBitSrgbToLinear } from "../studio-highbit-transfer";

import { studioGpuStrokeFeedPointCount } from "./studio-webgpu-stroke-feed";
import {
  fingerprintStudioGpuStroke,
  planStudioGpuTileStates,
  planVisibleStudioGpuTiles,
  signatureStudioGpuStroke,
  STUDIO_GPU_TILE_BLEED,
  STUDIO_GPU_TILE_SIZE,
  type StudioGpuRect,
  type StudioGpuTile,
  type StudioGpuTileState,
} from "./studio-webgpu-tile-plan";

import type {
  PlannedStudioGpuDabs,
  StudioGpuDab,
} from "./studio-webgpu-dab-plan-contract";
import type { StudioGpuStroke } from "./studio-webgpu-stroke";
import type {
  StudioGpuTileCompositeFrame,
  StudioGpuTileDocumentContract,
  StudioGpuTileRenderTask,
} from "./studio-webgpu-tile-runtime";

const PRESENTATION_VERTEX_FLOATS = 4;
/**
 * center(2) + quad radius(2) + premultiplied color(4) + nominal-radius-to-quad-radius ratio(1).
 * The quad is deliberately rasterized larger than the analytic dab radius (see writePackedTileDab)
 * so the fragment shader's antialiasing transition has real geometry to feather into on every side,
 * not just toward the instanced quad's corners; the ratio tells the shader where the true circle
 * boundary sits inside that larger quad.
 */
export const STUDIO_GPU_DAB_INSTANCE_FLOATS = 9;

export interface StudioGpuNormalizedTileViewport {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly flipX: boolean;
}

export interface StudioGpuPlannedTileFrame {
  readonly contract: StudioGpuTileDocumentContract;
  readonly viewBox: StudioGpuRect;
  readonly visibleTiles: readonly StudioGpuTile[];
  readonly tileStates: readonly StudioGpuTileState[];
}

export interface StudioGpuResolvedTileTask<Resource> {
  readonly task: StudioGpuTileRenderTask<Resource>;
  readonly plan: PlannedStudioGpuDabs;
  readonly firstInstance: number;
}

export interface StudioGpuResolvedTileTasks<Resource> {
  readonly tasks: readonly StudioGpuResolvedTileTask<Resource>[];
  readonly dabCount: number;
}

export type StudioGpuDabPlanner = (
  strokes: readonly StudioGpuStroke[],
  clipRect: StudioGpuRect,
  maximumDabs: number
) => PlannedStudioGpuDabs;

export type StudioGpuStrokeExtensionDabPlanner = (
  stroke: StudioGpuStroke,
  previousPointCount: number,
  clipRect: StudioGpuRect,
  maximumDabs: number,
  expectedPreviousRevisionToken?: string
) => PlannedStudioGpuDabs;

export interface StudioGpuTilePresentationDraw<Resource> {
  readonly resource: Resource;
  readonly firstVertex: number;
  readonly vertexCount: 6;
  readonly tileId: string;
}

export interface StudioGpuTilePresentationPlan<Resource> {
  readonly vertices: Float32Array;
  readonly draws: readonly StudioGpuTilePresentationDraw<Resource>[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function visibleAxis(
  logicalExtent: number,
  scale: number,
  offset: number,
  flipped: boolean
): readonly [number, number] {
  const first = flipped
    ? logicalExtent - (0 - offset) / scale
    : (0 - offset) / scale;
  const second = flipped
    ? logicalExtent - (logicalExtent - offset) / scale
    : (logicalExtent - offset) / scale;
  const minimum = clamp(Math.min(first, second), 0, logicalExtent);
  const maximum = clamp(Math.max(first, second), 0, logicalExtent);
  return [minimum, maximum];
}

/** Inverts the normalized document transform into the logical rectangle visible on the surface. */
export function studioGpuLogicalViewBox(
  viewport: StudioGpuNormalizedTileViewport
): StudioGpuRect {
  const [minimumX, maximumX] = visibleAxis(
    viewport.logicalWidth,
    viewport.scaleX,
    viewport.offsetX,
    viewport.flipX
  );
  const [minimumY, maximumY] = visibleAxis(
    viewport.logicalHeight,
    viewport.scaleY,
    viewport.offsetY,
    false
  );
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(0, maximumX - minimumX),
    height: Math.max(0, maximumY - minimumY),
  };
}

export function planStudioGpuVisibleTileFrame(
  strokes: readonly StudioGpuStroke[],
  viewport: StudioGpuNormalizedTileViewport
): StudioGpuPlannedTileFrame {
  const contract = {
    logicalWidth: viewport.logicalWidth,
    logicalHeight: viewport.logicalHeight,
    tileSize: STUDIO_GPU_TILE_SIZE,
    bleed: STUDIO_GPU_TILE_BLEED,
  };
  const viewBox = studioGpuLogicalViewBox(viewport);
  // `planVisibleStudioGpuTiles` also serves closed paint bounds. A viewport is half-open, so avoid
  // selecting the next tile when its right/bottom edge lands exactly on a tile boundary.
  const selectionViewBox = {
    ...viewBox,
    width: Math.max(
      0,
      viewBox.width - Math.abs(viewBox.x + viewBox.width) * Number.EPSILON
    ),
    height: Math.max(
      0,
      viewBox.height - Math.abs(viewBox.y + viewBox.height) * Number.EPSILON
    ),
  };
  const visibleTiles = planVisibleStudioGpuTiles({
    ...contract,
    viewBox: selectionViewBox,
    overscanRows: 1,
    overscanColumns: 1,
  });
  return {
    contract,
    viewBox,
    visibleTiles,
    tileStates: planStudioGpuTileStates(strokes, contract, visibleTiles),
  };
}

function exactStrokeForOperation(
  operation: StudioGpuTileRenderTask<unknown>["operations"][number],
  strokesById: ReadonlyMap<string, readonly StudioGpuStroke[]>
): StudioGpuStroke | null {
  const candidates = strokesById.get(operation.id) ?? [];
  return candidates.find((stroke) => (
    fingerprintStudioGpuStroke(stroke) === operation.fingerprint
    && signatureStudioGpuStroke(stroke) === operation.signature
  )) ?? null;
}

/**
 * Resolves opaque tile log entries back to the exact immutable stroke snapshots supplied by the
 * current request. Missing/colliding entries and any incomplete dab plan fail the entire frame.
 */
export function resolveStudioGpuTileTasks<Resource>(
  tasks: readonly StudioGpuTileRenderTask<Resource>[],
  strokes: readonly StudioGpuStroke[],
  planDabs: StudioGpuDabPlanner,
  maximumDabs: number,
  planStrokeExtension?: StudioGpuStrokeExtensionDabPlanner
): StudioGpuResolvedTileTasks<Resource> | null {
  if (!Number.isSafeInteger(maximumDabs) || maximumDabs < 0) return null;
  const strokesById = new Map<string, StudioGpuStroke[]>();
  for (const stroke of strokes) {
    const candidates = strokesById.get(stroke.id) ?? [];
    candidates.push(stroke);
    strokesById.set(stroke.id, candidates);
  }

  const resolved: StudioGpuResolvedTileTask<Resource>[] = [];
  let dabCount = 0;
  for (const task of tasks) {
    const clipRect = {
      x: task.descriptor.renderX,
      y: task.descriptor.renderY,
      width: task.descriptor.renderWidth,
      height: task.descriptor.renderHeight,
    };
    let plan: PlannedStudioGpuDabs;
    if (task.strokeExtension) {
      const { previous, next } = task.strokeExtension;
      if (
        !planStrokeExtension
        || task.operations.length !== 1
        || task.operations[0]?.signature !== next.signature
        || task.operations[0]?.fingerprint !== next.fingerprint
        || previous.pointCount === undefined
        || next.pointCount === undefined
      ) {
        return null;
      }
      const exact = exactStrokeForOperation(next, strokesById);
      if (!exact || next.pointCount !== studioGpuStrokeFeedPointCount(exact)) return null;
      plan = planStrokeExtension(
        exact,
        previous.pointCount,
        clipRect,
        maximumDabs - dabCount,
        previous.feedRevisionToken
      );
    } else {
      const exactStrokes: StudioGpuStroke[] = [];
      for (const operation of task.operations) {
        const exact = exactStrokeForOperation(operation, strokesById);
        if (!exact) return null;
        exactStrokes.push(exact);
      }
      plan = planDabs(exactStrokes, clipRect, maximumDabs - dabCount);
    }
    if (!plan.complete || dabCount + plan.dabs.length > maximumDabs) return null;
    resolved.push({ task, plan, firstInstance: dabCount });
    dabCount += plan.dabs.length;
  }
  return { tasks: resolved, dabCount };
}

/**
 * Packs every resolved dab into instance floats.
 *
 * `scratch` is an optional grow-only staging array owned by the caller. When it is large enough,
 * the pack writes into it and returns a length-exact subarray view; the view stays valid only
 * until the next pack into the same scratch, so callers must upload/consume it synchronously
 * (GPUQueue.writeBuffer copies at call time). A missing or too-small scratch allocates a fresh
 * exact-size array, which the caller may retain as its next scratch. Every returned float is
 * written by this call — stale scratch content can never leak into the view.
 */
export function packStudioGpuTileDabs(
  tasks: StudioGpuResolvedTileTasks<unknown>,
  scratch?: Float32Array
): Float32Array {
  const requiredFloats = tasks.dabCount * STUDIO_GPU_DAB_INSTANCE_FLOATS;
  const packed = scratch !== undefined && scratch.length >= requiredFloats
    ? scratch.subarray(0, requiredFloats)
    : new Float32Array(requiredFloats);
  // Dabs are ordered in contiguous stroke batches, so a single-entry cache removes three
  // piecewise transfer-function evaluations from virtually every repeated dab. Keep the analytic
  // dab contract renderer-neutral/sRGB; only the WebGPU retained surface stores linear light.
  let cachedRed = Number.NaN;
  let cachedGreen = Number.NaN;
  let cachedBlue = Number.NaN;
  let linearRed = 0;
  let linearGreen = 0;
  let linearBlue = 0;
  for (const resolved of tasks.tasks) {
    const { descriptor } = resolved.task;
    for (let index = 0; index < resolved.plan.dabs.length; index += 1) {
      const dab = resolved.plan.dabs[index]!;
      if (
        dab.red !== cachedRed
        || dab.green !== cachedGreen
        || dab.blue !== cachedBlue
      ) {
        cachedRed = dab.red;
        cachedGreen = dab.green;
        cachedBlue = dab.blue;
        linearRed = studioHighBitSrgbToLinear(dab.red);
        linearGreen = studioHighBitSrgbToLinear(dab.green);
        linearBlue = studioHighBitSrgbToLinear(dab.blue);
      }
      const outputOffset = (resolved.firstInstance + index) * STUDIO_GPU_DAB_INSTANCE_FLOATS;
      writePackedTileDab(
        packed,
        outputOffset,
        dab,
        descriptor,
        linearRed,
        linearGreen,
        linearBlue
      );
    }
  }
  return packed;
}

function writePackedTileDab(
  target: Float32Array,
  offset: number,
  dab: StudioGpuDab,
  descriptor: StudioGpuTileRenderTask<unknown>["descriptor"],
  linearRed: number,
  linearGreen: number,
  linearBlue: number
): void {
  const alpha = clamp(dab.alpha, 0, 1);
  const nominalRadius = Math.max(0, dab.radius);
  // One physical tile texel, expressed in the same logical document units as dab.radius.
  const onePhysicalPixel = Math.max(
    descriptor.renderWidth / descriptor.width,
    descriptor.renderHeight / descriptor.height
  );
  const quadRadius = nominalRadius > 0 ? nominalRadius + onePhysicalPixel : 0;
  const nominalRadiusRatio = quadRadius > 0 ? nominalRadius / quadRadius : 0;

  target[offset] = ((dab.x - descriptor.renderX) / descriptor.renderWidth) * 2 - 1;
  target[offset + 1] = 1 - ((dab.y - descriptor.renderY) / descriptor.renderHeight) * 2;
  target[offset + 2] = (quadRadius / descriptor.renderWidth) * 2;
  target[offset + 3] = (quadRadius / descriptor.renderHeight) * 2;
  target[offset + 4] = linearRed * alpha;
  target[offset + 5] = linearGreen * alpha;
  target[offset + 6] = linearBlue * alpha;
  target[offset + 7] = alpha;
  target[offset + 8] = nominalRadiusRatio;
}

function logicalPointToNdc(
  x: number,
  y: number,
  viewport: StudioGpuNormalizedTileViewport
): readonly [number, number] {
  const transformedX = (
    viewport.flipX ? viewport.logicalWidth - x : x
  ) * viewport.scaleX + viewport.offsetX;
  const transformedY = y * viewport.scaleY + viewport.offsetY;
  return [
    transformedX / viewport.logicalWidth * 2 - 1,
    1 - transformedY / viewport.logicalHeight * 2,
  ];
}

/** Builds cropped tile quads; bleed texels remain sampleable but never overlap adjacent content. */
export function planStudioGpuTilePresentation<Resource>(
  frame: StudioGpuTileCompositeFrame<Resource>,
  viewport: StudioGpuNormalizedTileViewport
): StudioGpuTilePresentationPlan<Resource> {
  const drawable = frame.items.filter((item) => item.resource && item.descriptor);
  const vertices = new Float32Array(drawable.length * 6 * PRESENTATION_VERTEX_FLOATS);
  const draws: StudioGpuTilePresentationDraw<Resource>[] = [];
  const corners = [
    [0, 0], [1, 0], [0, 1],
    [0, 1], [1, 0], [1, 1],
  ] as const;

  for (let drawIndex = 0; drawIndex < drawable.length; drawIndex += 1) {
    const item = drawable[drawIndex]!;
    const descriptor = item.descriptor!;
    const resource = item.resource!;
    const firstVertex = drawIndex * 6;
    const u0 = descriptor.contentX / descriptor.width;
    const v0 = descriptor.contentY / descriptor.height;
    const u1 = (descriptor.contentX + descriptor.contentWidth) / descriptor.width;
    const v1 = (descriptor.contentY + descriptor.contentHeight) / descriptor.height;
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const [horizontal, vertical] = corners[cornerIndex]!;
      const x = item.tile.x + item.tile.width * horizontal;
      const y = item.tile.y + item.tile.height * vertical;
      const [positionX, positionY] = logicalPointToNdc(x, y, viewport);
      const offset = (firstVertex + cornerIndex) * PRESENTATION_VERTEX_FLOATS;
      vertices[offset] = positionX;
      vertices[offset + 1] = positionY;
      vertices[offset + 2] = horizontal === 0 ? u0 : u1;
      vertices[offset + 3] = vertical === 0 ? v0 : v1;
    }
    draws.push({ resource, firstVertex, vertexCount: 6, tileId: item.tile.id });
  }
  return { vertices, draws };
}
