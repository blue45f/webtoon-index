import {
  isStudioInkPressureModel,
  resolveStudioInkPressure,
  studioInkUsesResidualDabSpacing,
} from "../brush/studio-ink-pressure-model";
import {
  advanceStudioResidualInk,
  planStudioCausalInkDabs,
  startStudioResidualInk,
} from "../studio-causal-ink";

import { parseStudioGpuColor } from "./studio-webgpu-color";
import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  isStudioGpuFiniteScalar,
  orderStudioGpuStrokes,
  studioGpuPressureRadius,
  STUDIO_GPU_MAX_BRUSH_SIZE,
  type StudioGpuComposite,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";
import {
  isTrustedStudioGpuStrokeFeedDabExtensionReceipt,
  isTrustedStudioGpuStrokeFeedRevision,
  isTrustedStudioGpuStrokeFeedStroke,
  materializeStudioGpuStrokeFeedStroke,
  sameStudioGpuStrokeFeedStyle,
  studioGpuStrokeFeedDabExtensionReceipt,
  studioGpuStrokeFeedPointCount,
} from "./studio-webgpu-stroke-feed";

import type {
  PlannedStudioGpuDabs,
  StudioGpuBatch,
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./studio-webgpu-dab-plan-contract";
import type { StudioGpuStrokeFeedDabExtensionReceipt } from "./studio-webgpu-stroke-feed";
import type { StudioGpuRect } from "./studio-webgpu-tile-plan";

export const STUDIO_GPU_MAX_DABS = 100_000;

interface StudioGpuDabPlanOptions {
  readonly clipRect: StudioGpuRect | null;
  readonly maximumDabs: number;
  readonly includeInitialDab: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointPressure(stroke: StudioGpuStroke, index: number): number {
  return resolveStudioInkPressure(stroke.pressures?.[index], stroke.pressureModel);
}

function validClipRect(rect: StudioGpuRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
    && Number.isFinite(rect.x + rect.width)
    && Number.isFinite(rect.y + rect.height);
}

/** Shared fail-closed validation for both full-frame and tiled render paths. */
export function isValidStudioGpuStroke(stroke: StudioGpuStroke): boolean {
  const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (feed) {
    return isTrustedStudioGpuStrokeFeedStroke(stroke)
      && isTrustedStudioGpuStrokeFeedRevision(feed)
      && feed.trustedImmutable
      && feed.pointCount >= 1
      && feed.styleSignature.length > 0
      && isStudioGpuFiniteScalar(feed.minimumX)
      && isStudioGpuFiniteScalar(feed.minimumY)
      && isStudioGpuFiniteScalar(feed.maximumX)
      && isStudioGpuFiniteScalar(feed.maximumY)
      && typeof stroke.color === "string"
      && parseStudioGpuColor(stroke.color) !== null
      && isStudioGpuFiniteScalar(stroke.size)
      && stroke.size > 0
      && stroke.size <= STUDIO_GPU_MAX_BRUSH_SIZE
      && (stroke.pressureModel === undefined || isStudioInkPressureModel(stroke.pressureModel))
      && (stroke.opacity === undefined || (
        isStudioGpuFiniteScalar(stroke.opacity) && stroke.opacity >= 0 && stroke.opacity <= 1
      ));
  }
  return Array.isArray(stroke.points)
    && stroke.points.length >= 2
    && stroke.points.length % 2 === 0
    && stroke.points.every(isStudioGpuFiniteScalar)
    && (stroke.pressures === undefined || (
      Array.isArray(stroke.pressures) && stroke.pressures.every(isStudioGpuFiniteScalar)
    ))
    && typeof stroke.color === "string"
    && parseStudioGpuColor(stroke.color) !== null
    && isStudioGpuFiniteScalar(stroke.size)
    && stroke.size > 0
    && stroke.size <= STUDIO_GPU_MAX_BRUSH_SIZE
    && (stroke.pressureModel === undefined || isStudioInkPressureModel(stroke.pressureModel))
    && (stroke.opacity === undefined || (
      isStudioGpuFiniteScalar(stroke.opacity) && stroke.opacity >= 0 && stroke.opacity <= 1
    ));
}

/** A display compositor stays cold until every operation in a non-empty frame is supported. */
export function isStudioWebGpuCanvasActive(strokes: readonly StudioGpuStroke[]): boolean {
  return strokes.length > 0 && strokes.every(isValidStudioGpuStroke);
}

function dabIntersectsRect(
  x: number,
  y: number,
  radius: number,
  rect: StudioGpuRect
): boolean {
  const nearestX = clamp(x, rect.x, rect.x + rect.width);
  const nearestY = clamp(y, rect.y, rect.y + rect.height);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

interface StudioGpuSegmentClip {
  readonly valid: boolean;
  readonly interval: readonly [number, number] | null;
}

/**
 * Returns the parameter interval whose dab centers can possibly touch the rectangle. The caller
 * performs an exact circle/rectangle check because pressure can make the radius vary per dab.
 */
function clipStudioGpuSegment(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  rect: StudioGpuRect
): StudioGpuSegmentClip {
  const minimumX = rect.x - radius;
  const minimumY = rect.y - radius;
  const maximumX = rect.x + rect.width + radius;
  const maximumY = rect.y + rect.height + radius;
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return { valid: false, interval: null };
  }

  let minimumAmount = 0;
  let maximumAmount = 1;
  for (const [origin, delta, minimum, maximum] of [
    [x, dx, minimumX, maximumX],
    [y, dy, minimumY, maximumY],
  ] as const) {
    if (delta === 0) {
      if (origin < minimum || origin > maximum) {
        return { valid: true, interval: null };
      }
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return { valid: false, interval: null };
    }
    minimumAmount = Math.max(minimumAmount, Math.min(first, second));
    maximumAmount = Math.min(maximumAmount, Math.max(first, second));
    if (minimumAmount > maximumAmount) {
      return { valid: true, interval: null };
    }
  }
  return {
    valid: true,
    interval: [clamp(minimumAmount, 0, 1), clamp(maximumAmount, 0, 1)],
  };
}

function singleCompositeBatches(
  dabs: readonly StudioGpuDab[],
  composite: StudioGpuComposite
): StudioGpuBatch[] {
  return dabs.length === 0
    ? []
    : [{ composite, firstInstance: 0, instanceCount: dabs.length }];
}

/**
 * Consumes a trusted legacy/V1 feed suffix directly from immutable revision chunks.
 *
 * This deliberately mirrors the frozen per-source-segment planner below: the previous endpoint
 * and pressure come from the retained revision, zero-length pressure changes still advance that
 * state, and no bridge/full source array is allocated.
 */
function planStudioGpuFeedStrokeExtensionInternal(
  stroke: StudioGpuStroke,
  receipt: StudioGpuStrokeFeedDabExtensionReceipt,
  clipRect: StudioGpuRect | null,
  maximumDabs: number
): PlannedStudioGpuDabs {
  const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    !isValidStudioGpuStroke(stroke)
    || !isTrustedStudioGpuStrokeFeedDabExtensionReceipt(receipt)
    || !isTrustedStudioGpuStrokeFeedRevision(latest)
    || receipt.lineage !== latest.lineage
    || receipt.toRevisionToken !== latest.token
    || receipt.pointCount !== latest.pointCount
    || receipt.styleSignature !== latest.styleSignature
    || !Number.isSafeInteger(maximumDabs)
    || maximumDabs < 0
    || (clipRect !== null && !validClipRect(clipRect))
    || studioInkUsesResidualDabSpacing(stroke.pressureModel)
  ) {
    return { dabs: [], batches: [], complete: false };
  }

  const parsedColor = parseStudioGpuColor(stroke.color);
  if (!parsedColor) return { dabs: [], batches: [], complete: false };
  const [red, green, blue, colorAlpha] = parsedColor;
  const composite: StudioGpuComposite = stroke.composite === "erase" ? "erase" : "normal";
  const alpha = (stroke.opacity ?? 1) * (composite === "erase" ? 1 : colorAlpha);
  if (alpha <= 0) return { dabs: [], batches: [], complete: true };

  const dabs: StudioGpuDab[] = [];
  let previousX = receipt.previousX;
  let previousY = receipt.previousY;
  let previousPressure = receipt.previousPressure;
  let consumedPointCount = 0;

  for (const revision of receipt.suffixRevisions) {
    const chunkPointCount = revision.suffixPressures.length;
    for (let index = 0; index < chunkPointCount; index += 1) {
      const nextX = revision.suffixPoints[index * 2]!;
      const nextY = revision.suffixPoints[index * 2 + 1]!;
      const nextPressure = resolveStudioInkPressure(
        revision.suffixPressures[index],
        stroke.pressureModel
      );
      const dx = nextX - previousX;
      const dy = nextY - previousY;
      const distance = Math.hypot(dx, dy);
      if (![dx, dy, distance].every(Number.isFinite)) {
        return { dabs: [], batches: [], complete: false };
      }

      if (distance > 1e-6) {
        const spacing = Math.max(
          0.5,
          Math.min(
            studioGpuPressureRadius(stroke.size, previousPressure, stroke.pressureModel),
            studioGpuPressureRadius(stroke.size, nextPressure, stroke.pressureModel)
          ) * 0.45
        );
        const steps = Math.max(1, Math.ceil(distance / spacing));
        if (!Number.isFinite(spacing) || !Number.isFinite(steps)) {
          return { dabs: [], batches: [], complete: false };
        }

        let firstStep = 1;
        let lastStep = steps;
        if (clipRect !== null) {
          if (!Number.isSafeInteger(steps)) {
            return { dabs: [], batches: [], complete: false };
          }
          const maximumRadius = Math.max(
            studioGpuPressureRadius(stroke.size, previousPressure, stroke.pressureModel),
            studioGpuPressureRadius(stroke.size, nextPressure, stroke.pressureModel)
          );
          const clipped = clipStudioGpuSegment(
            previousX,
            previousY,
            dx,
            dy,
            maximumRadius,
            clipRect
          );
          if (!clipped.valid) return { dabs: [], batches: [], complete: false };
          if (clipped.interval) {
            const [minimumAmount, maximumAmount] = clipped.interval;
            firstStep = Math.max(1, Math.floor(minimumAmount * steps) - 1);
            lastStep = Math.min(steps, Math.ceil(maximumAmount * steps) + 1);
          } else {
            firstStep = 1;
            lastStep = 0;
          }
        }

        for (let step = firstStep; step <= lastStep; step += 1) {
          const amount = step / steps;
          const x = previousX + dx * amount;
          const y = previousY + dy * amount;
          const pressure = previousPressure + (nextPressure - previousPressure) * amount;
          const radius = studioGpuPressureRadius(stroke.size, pressure, stroke.pressureModel);
          if (clipRect !== null && !dabIntersectsRect(x, y, radius, clipRect)) continue;
          if (dabs.length >= maximumDabs) {
            return {
              dabs,
              batches: singleCompositeBatches(dabs, composite),
              complete: false,
            };
          }
          dabs.push({
            x,
            y,
            radius,
            red,
            green,
            blue,
            alpha,
            composite,
          });
        }
      }

      previousX = nextX;
      previousY = nextY;
      previousPressure = nextPressure;
      consumedPointCount += 1;
    }
  }

  if (
    consumedPointCount !== receipt.suffixPointCount
    || !Object.is(previousX, latest.lastX)
    || !Object.is(previousY, latest.lastY)
    || !Object.is(previousPressure, latest.lastPressure)
  ) {
    return { dabs: [], batches: [], complete: false };
  }
  return {
    dabs,
    batches: singleCompositeBatches(dabs, composite),
    complete: true,
  };
}

function planStudioGpuDabsInternal(
  strokes: readonly StudioGpuStroke[],
  options: StudioGpuDabPlanOptions
): PlannedStudioGpuDabs {
  const dabs: StudioGpuDab[] = [];
  const batches: StudioGpuBatch[] = [];
  let complete = true;
  const { clipRect, maximumDabs, includeInitialDab } = options;

  if (
    !Number.isSafeInteger(maximumDabs)
    || maximumDabs < 0
    || (clipRect !== null && !validClipRect(clipRect))
  ) {
    return { dabs, batches, complete: false };
  }

  for (const sourceStroke of orderStudioGpuStrokes(strokes)) {
    const sourceFeed = sourceStroke[STUDIO_GPU_STROKE_FEED_REVISION];
    const stroke = isTrustedStudioGpuStrokeFeedStroke(sourceStroke)
      && isTrustedStudioGpuStrokeFeedRevision(sourceFeed)
      ? materializeStudioGpuStrokeFeedStroke(sourceStroke)
      : sourceStroke;
    if (!stroke) {
      complete = false;
      break;
    }
    // The unclipped Canvas2D/full-frame planner retains its historical truncation behavior. A
    // clipped tile planner must continue validating off-tile operations after reaching the exact
    // emitted-dab limit, because those operations consume no frame budget.
    if (clipRect === null && dabs.length >= maximumDabs) {
      complete = false;
      break;
    }
    if (!isValidStudioGpuStroke(stroke)) {
      complete = false;
      break;
    }
    const pointCount = stroke.points.length / 2;
    const size = stroke.size;
    const opacity = stroke.opacity ?? 1;
    const composite: StudioGpuComposite = stroke.composite === "erase" ? "erase" : "normal";
    const parsedColor = parseStudioGpuColor(stroke.color);
    if (!parsedColor) {
      complete = false;
      break;
    }
    const [red, green, blue, colorAlpha] = parsedColor;
    // Erasing is coverage, not paint color. A transparent/alpha-zero color must therefore erase
    // with the requested opacity instead of silently becoming a no-op.
    const alpha = opacity * (composite === "erase" ? 1 : colorAlpha);
    if (alpha <= 0) continue;
    const batchStart = dabs.length;
    let capacityExceeded = false;
    let invalidStroke = false;
    const pushDab = (x: number, y: number, pressure: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(pressure)) {
        complete = false;
        invalidStroke = true;
        return;
      }
      const radius = studioGpuPressureRadius(size, pressure, stroke.pressureModel);
      if (clipRect !== null && !dabIntersectsRect(x, y, radius, clipRect)) return;
      if (dabs.length >= maximumDabs) {
        complete = false;
        capacityExceeded = true;
        return;
      }
      dabs.push({
        x,
        y,
        radius,
        red,
        green,
        blue,
        alpha,
        composite,
      });
    };

    if (studioInkUsesResidualDabSpacing(stroke.pressureModel) && stroke.pressureModel) {
      const residualPlan = planStudioCausalInkDabs({
        samples: Array.from({ length: pointCount }, (_, sourceIndex) => ({
          x: stroke.points[sourceIndex * 2]!,
          y: stroke.points[sourceIndex * 2 + 1]!,
          pressure: pointPressure(stroke, sourceIndex),
          sourceIndex,
        })),
        size,
        pressureModel: stroke.pressureModel,
        maximumDabs: STUDIO_GPU_MAX_DABS,
      });
      if (!residualPlan.complete) {
        complete = false;
        invalidStroke = true;
      } else {
        const initialPressure = pointPressure(stroke, 0);
        const startIndex = includeInitialDab || initialPressure <= 0 ? 0 : 1;
        for (
          let index = startIndex;
          index < residualPlan.dabs.length && !capacityExceeded && !invalidStroke;
          index += 1
        ) {
          const dab = residualPlan.dabs[index]!;
          pushDab(dab.x, dab.y, dab.pressure);
        }
      }
    } else {
      const firstX = stroke.points[0];
      const firstY = stroke.points[1];
      if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) continue;
      if (includeInitialDab) pushDab(firstX!, firstY!, pointPressure(stroke, 0));

      for (
        let pointIndex = 1;
        pointIndex < pointCount && !capacityExceeded && !invalidStroke;
        pointIndex += 1
      ) {
        const x0 = stroke.points[(pointIndex - 1) * 2];
        const y0 = stroke.points[(pointIndex - 1) * 2 + 1];
        const x1 = stroke.points[pointIndex * 2];
        const y1 = stroke.points[pointIndex * 2 + 1];
        if (![x0, y0, x1, y1].every((coordinate) => Number.isFinite(coordinate))) continue;
        const dx = x1! - x0!;
        const dy = y1! - y0!;
        const distance = Math.hypot(dx, dy);
        if (![dx, dy, distance].every(Number.isFinite)) {
          complete = false;
          invalidStroke = true;
          break;
        }
        if (distance <= 1e-6) continue;
        const p0 = pointPressure(stroke, pointIndex - 1);
        const p1 = pointPressure(stroke, pointIndex);
        // Frozen V1/legacy spacing contract for already-persisted strokes.
        const spacing = Math.max(
          0.5,
          Math.min(
            studioGpuPressureRadius(size, p0, stroke.pressureModel),
            studioGpuPressureRadius(size, p1, stroke.pressureModel)
          ) * 0.45
        );
        const steps = Math.max(1, Math.ceil(distance / spacing));
        if (!Number.isFinite(spacing) || !Number.isFinite(steps)) {
          complete = false;
          invalidStroke = true;
          break;
        }
        let firstStep = 1;
        let lastStep = steps;
        if (clipRect !== null) {
          if (!Number.isSafeInteger(steps)) {
            complete = false;
            invalidStroke = true;
            break;
          }
          const maximumRadius = Math.max(
            studioGpuPressureRadius(size, p0, stroke.pressureModel),
            studioGpuPressureRadius(size, p1, stroke.pressureModel)
          );
          const clipped = clipStudioGpuSegment(
            x0!,
            y0!,
            dx,
            dy,
            maximumRadius,
            clipRect
          );
          if (!clipped.valid) {
            complete = false;
            invalidStroke = true;
            break;
          }
          if (!clipped.interval) continue;
          const [minimumAmount, maximumAmount] = clipped.interval;
          // Expand by one sample on both ends, then use the exact circle test in `pushDab`.
          firstStep = Math.max(1, Math.floor(minimumAmount * steps) - 1);
          lastStep = Math.min(steps, Math.ceil(maximumAmount * steps) + 1);
        }
        for (
          let step = firstStep;
          step <= lastStep && !capacityExceeded && !invalidStroke;
          step += 1
        ) {
          const amount = step / steps;
          pushDab(
            x0! + dx * amount,
            y0! + dy * amount,
            p0 + (p1 - p0) * amount
          );
        }
      }
    }

    if (invalidStroke) {
      dabs.length = batchStart;
      break;
    }

    const batchCount = dabs.length - batchStart;
    if (batchCount <= 0) continue;
    const previous = batches.at(-1);
    if (previous?.composite === composite && previous.firstInstance + previous.instanceCount === batchStart) {
      previous.instanceCount += batchCount;
    } else {
      batches.push({ composite, firstInstance: batchStart, instanceCount: batchCount });
    }
    if (capacityExceeded) break;
  }

  return { dabs, batches, complete };
}

/**
 * Plans a residual V2 suffix from its cached feed phase. Non-feed callers reconstruct the phase
 * once from the retained prefix; the live WebGPU path reads no historical point coordinates.
 */
function planStudioGpuResidualStrokeExtensionInternal(
  stroke: StudioGpuStroke,
  previousPointCount: number,
  clipRect: StudioGpuRect | null,
  maximumDabs: number,
  expectedPreviousRevisionToken?: string
): PlannedStudioGpuDabs {
  const pointCount = studioGpuStrokeFeedPointCount(stroke);
  if (
    !studioInkUsesResidualDabSpacing(stroke.pressureModel)
    || !stroke.pressureModel
    || !isValidStudioGpuStroke(stroke)
    || !Number.isSafeInteger(previousPointCount)
    || previousPointCount < 1
    || previousPointCount >= pointCount
    || !Number.isSafeInteger(maximumDabs)
    || maximumDabs < 0
    || (clipRect !== null && !validClipRect(clipRect))
  ) {
    return { dabs: [], batches: [], complete: false };
  }
  const pressureModel = stroke.pressureModel;
  const parsedColor = parseStudioGpuColor(stroke.color);
  if (!parsedColor) return { dabs: [], batches: [], complete: false };
  const [red, green, blue, colorAlpha] = parsedColor;
  const composite: StudioGpuComposite = stroke.composite === "erase" ? "erase" : "normal";
  const alpha = (stroke.opacity ?? 1) * (composite === "erase" ? 1 : colorAlpha);
  if (alpha <= 0) return { dabs: [], batches: [], complete: true };

  const trustedFeed = isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(stroke[STUDIO_GPU_STROKE_FEED_REVISION]);
  const receipt = trustedFeed
    ? studioGpuStrokeFeedDabExtensionReceipt(stroke, previousPointCount)
    : null;
  if (
    trustedFeed
    && (
      !receipt
      || (expectedPreviousRevisionToken !== undefined
        && receipt.fromRevisionToken !== expectedPreviousRevisionToken)
    )
  ) {
    return { dabs: [], batches: [], complete: false };
  }
  let state = receipt?.residualInkState;
  let totalDabCount = receipt?.residualDabCount;
  if (!state || totalDabCount === undefined) {
    if (trustedFeed) return { dabs: [], batches: [], complete: false };
    const started = startStudioResidualInk(
      {
        x: stroke.points[0]!,
        y: stroke.points[1]!,
        pressure: pointPressure(stroke, 0),
        sourceIndex: 0,
      },
      stroke.size,
      pressureModel,
      STUDIO_GPU_MAX_DABS
    );
    if (!started.complete) return { dabs: [], batches: [], complete: false };
    state = started.state;
    totalDabCount = started.dabs.length;
    for (let sourceIndex = 1; sourceIndex < previousPointCount; sourceIndex += 1) {
      const advanced = advanceStudioResidualInk(
        state,
        {
          x: stroke.points[sourceIndex * 2]!,
          y: stroke.points[sourceIndex * 2 + 1]!,
          pressure: pointPressure(stroke, sourceIndex),
          sourceIndex,
        },
        stroke.size,
        pressureModel,
        STUDIO_GPU_MAX_DABS - totalDabCount
      );
      if (!advanced.complete) return { dabs: [], batches: [], complete: false };
      state = advanced.state;
      totalDabCount += advanced.dabs.length;
    }
  }
  let activeState = state;
  let activeDabCount = totalDabCount;

  const dabs: StudioGpuDab[] = [];
  let sourceIndex = previousPointCount;
  const advanceSource = (
    x: number,
    y: number,
    pressure: number,
    currentSourceIndex: number
  ): boolean => {
    const advanced = advanceStudioResidualInk(
      activeState,
      {
        x,
        y,
        pressure,
        sourceIndex: currentSourceIndex,
      },
      stroke.size,
      pressureModel,
      STUDIO_GPU_MAX_DABS - activeDabCount
    );
    if (!advanced.complete) return false;
    activeState = advanced.state;
    activeDabCount += advanced.dabs.length;
    for (const dab of advanced.dabs) {
      if (clipRect !== null && !dabIntersectsRect(dab.x, dab.y, dab.radius, clipRect)) continue;
      if (dabs.length >= maximumDabs) return false;
      dabs.push({
        x: dab.x,
        y: dab.y,
        radius: dab.radius,
        red,
        green,
        blue,
        alpha,
        composite,
      });
    }
    return true;
  };

  if (receipt) {
    for (const revision of receipt.suffixRevisions) {
      for (let index = 0; index < revision.suffixPressures.length; index += 1) {
        if (!advanceSource(
          revision.suffixPoints[index * 2]!,
          revision.suffixPoints[index * 2 + 1]!,
          revision.suffixPressures[index]!,
          sourceIndex
        )) {
          return {
            dabs,
            batches: singleCompositeBatches(dabs, composite),
            complete: false,
          };
        }
        sourceIndex += 1;
      }
    }
    const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION]!;
    const expectedState = latest.residualInkState;
    if (
      sourceIndex !== receipt.pointCount
      || activeDabCount !== latest.residualDabCount
      || !expectedState
      || !Object.is(activeState.previousX, expectedState.previousX)
      || !Object.is(activeState.previousY, expectedState.previousY)
      || !Object.is(activeState.previousPressure, expectedState.previousPressure)
      || !Object.is(activeState.lastDabX, expectedState.lastDabX)
      || !Object.is(activeState.lastDabY, expectedState.lastDabY)
      || !Object.is(activeState.distanceRemainder, expectedState.distanceRemainder)
      || !Object.is(activeState.spacingPhase, expectedState.spacingPhase)
    ) {
      return { dabs: [], batches: [], complete: false };
    }
  } else {
    for (; sourceIndex < pointCount; sourceIndex += 1) {
      if (!advanceSource(
        stroke.points[sourceIndex * 2]!,
        stroke.points[sourceIndex * 2 + 1]!,
        pointPressure(stroke, sourceIndex),
        sourceIndex
      )) {
        return {
          dabs,
          batches: singleCompositeBatches(dabs, composite),
          complete: false,
        };
      }
    }
  }
  return {
    dabs,
    batches: singleCompositeBatches(dabs, composite),
    complete: true,
  };
}

/** CPU planning is shared by Canvas2D and non-tiled callers with identical geometry and ordering. */
export function planStudioGpuDabs(strokes: readonly StudioGpuStroke[]): PlannedStudioGpuDabs {
  return planStudioGpuDabsInternal(strokes, {
    clipRect: null,
    maximumDabs: STUDIO_GPU_MAX_DABS,
    includeInitialDab: true,
  });
}

/**
 * Plans only round dabs whose coverage intersects one tile render rectangle. Segment step counts,
 * pressure interpolation, and batch ordering remain byte-for-byte compatible with the full plan.
 */
export function planStudioGpuDabsInRect(
  strokes: readonly StudioGpuStroke[],
  clipRect: StudioGpuRect,
  maximumDabs = STUDIO_GPU_MAX_DABS
): PlannedStudioGpuDabs {
  return planStudioGpuDabsInternal(strokes, {
    clipRect,
    maximumDabs,
    includeInitialDab: true,
  });
}

/** Plans the bridge from the retained endpoint plus only the newly appended point suffix. */
export function planStudioGpuStrokeExtensionInRect(
  stroke: StudioGpuStroke,
  previousPointCount: number,
  clipRect: StudioGpuRect,
  maximumDabs = STUDIO_GPU_MAX_DABS,
  expectedPreviousRevisionToken?: string
): PlannedStudioGpuDabs {
  const pointCount = studioGpuStrokeFeedPointCount(stroke);
  if (
    !Number.isSafeInteger(previousPointCount)
    || previousPointCount < 1
    || previousPointCount >= pointCount
  ) {
    return { dabs: [], batches: [], complete: false };
  }
  if (studioInkUsesResidualDabSpacing(stroke.pressureModel)) {
    return planStudioGpuResidualStrokeExtensionInternal(
      stroke,
      previousPointCount,
      clipRect,
      maximumDabs,
      expectedPreviousRevisionToken
    );
  }
  const trustedFeed = isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(stroke[STUDIO_GPU_STROKE_FEED_REVISION]);
  if (trustedFeed) {
    const receipt = studioGpuStrokeFeedDabExtensionReceipt(stroke, previousPointCount);
    return receipt
      && (
        expectedPreviousRevisionToken === undefined
        || receipt.fromRevisionToken === expectedPreviousRevisionToken
      )
      ? planStudioGpuFeedStrokeExtensionInternal(stroke, receipt, clipRect, maximumDabs)
      : { dabs: [], batches: [], complete: false };
  }
  const suffixStart = previousPointCount - 1;
  const suffixPointCount = pointCount - suffixStart;
  const suffix: StudioGpuStroke = {
    ...stroke,
    points: stroke.points.slice(suffixStart * 2),
    pressures: Array.from(
      { length: suffixPointCount },
      (_, index) => pointPressure(stroke, suffixStart + index)
    ),
  };
  return planStudioGpuDabsInternal([suffix], {
    clipRect,
    maximumDabs,
    includeInitialDab: false,
  });
}

function sameStrokeStyle(previous: StudioGpuStroke, next: StudioGpuStroke): boolean {
  return sameStudioGpuStrokeFeedStyle(previous, next);
}

function isStrictPointPrefix(previous: StudioGpuStroke, next: StudioGpuStroke): boolean {
  const previousFeed = previous[STUDIO_GPU_STROKE_FEED_REVISION];
  const nextFeed = next[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    isTrustedStudioGpuStrokeFeedStroke(previous)
    && isTrustedStudioGpuStrokeFeedStroke(next)
    && isTrustedStudioGpuStrokeFeedRevision(previousFeed)
    && isTrustedStudioGpuStrokeFeedRevision(nextFeed)
  ) {
    return previousFeed.lineage === nextFeed.lineage
      && previousFeed.pointCount < nextFeed.pointCount;
  }
  if (previous.points.length < 2 || previous.points.length % 2 !== 0) return false;
  if (next.points.length <= previous.points.length || next.points.length % 2 !== 0) return false;
  for (let index = 0; index < previous.points.length; index += 1) {
    if (!Number.isFinite(previous.points[index])) return false;
    if (!Object.is(previous.points[index], next.points[index])) return false;
  }
  const previousPointCount = studioGpuStrokeFeedPointCount(previous);
  for (let index = 0; index < previousPointCount; index += 1) {
    if (!Object.is(pointPressure(previous, index), pointPressure(next, index))) return false;
  }
  return true;
}

function isExactStrokeMatch(previous: StudioGpuStroke, next: StudioGpuStroke): boolean {
  const previousFeed = previous[STUDIO_GPU_STROKE_FEED_REVISION];
  const nextFeed = next[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    isTrustedStudioGpuStrokeFeedStroke(previous)
    && isTrustedStudioGpuStrokeFeedStroke(next)
    && isTrustedStudioGpuStrokeFeedRevision(previousFeed)
    && isTrustedStudioGpuStrokeFeedRevision(nextFeed)
  ) {
    return previousFeed.token === nextFeed.token
      && previous.points === next.points
      && previous.pressures === next.pressures;
  }
  if (!sameStrokeStyle(previous, next) || previous.points.length !== next.points.length) {
    return false;
  }
  if (previous.points.length % 2 !== 0) return false;
  for (let index = 0; index < previous.points.length; index += 1) {
    if (!Number.isFinite(previous.points[index])) return false;
    if (!Object.is(previous.points[index], next.points[index])) return false;
  }
  const pointCount = studioGpuStrokeFeedPointCount(previous);
  for (let index = 0; index < pointCount; index += 1) {
    if (!Object.is(pointPressure(previous, index), pointPressure(next, index))) return false;
  }
  return true;
}

function concatenateStudioGpuDabPlans(
  plans: readonly PlannedStudioGpuDabs[]
): PlannedStudioGpuDabs {
  const dabs: StudioGpuDab[] = [];
  const batches: StudioGpuBatch[] = [];
  for (const plan of plans) {
    const instanceOffset = dabs.length;
    // A residual catch-up suffix can carry tens of thousands of dabs. `push(...plan.dabs)` spreads
    // each dab as one call argument and exceeds engine argument limits (~65k on JSC, ~124k on V8),
    // so the concatenation copies by index instead of by spread.
    for (let dabIndex = 0; dabIndex < plan.dabs.length; dabIndex += 1) {
      dabs.push(plan.dabs[dabIndex]!);
    }
    for (const batch of plan.batches) {
      const firstInstance = instanceOffset + batch.firstInstance;
      const previous = batches.at(-1);
      if (
        previous?.composite === batch.composite
        && previous.firstInstance + previous.instanceCount === firstInstance
      ) {
        previous.instanceCount += batch.instanceCount;
      } else {
        batches.push({ ...batch, firstInstance });
      }
    }
  }
  return { dabs, batches, complete: plans.every((plan) => plan.complete) };
}

function withoutInitialDab(plan: PlannedStudioGpuDabs): PlannedStudioGpuDabs {
  if (plan.dabs.length <= 1) return { dabs: [], batches: [], complete: plan.complete };
  const dabs = plan.dabs.slice(1);
  const batches = plan.batches.flatMap((batch) => {
    const batchEnd = batch.firstInstance + batch.instanceCount;
    const retainedStart = Math.max(1, batch.firstInstance);
    if (batchEnd <= retainedStart) return [];
    return [{
      composite: batch.composite,
      firstInstance: retainedStart - 1,
      instanceCount: batchEnd - retainedStart,
    }];
  });
  return { dabs, batches, complete: plan.complete };
}

/**
 * Plans only the newly appended segments of one immutable live stroke. Any changed historical
 * sample (for example a replaced pointer-prediction tail) deliberately requests a full rebuild.
 */
export function planStudioGpuDabUpdate(
  previousStrokes: readonly StudioGpuStroke[],
  nextStrokes: readonly StudioGpuStroke[]
): StudioGpuDabRenderUpdate {
  const previousOrdered = orderStudioGpuStrokes(previousStrokes);
  const nextOrdered = orderStudioGpuStrokes(nextStrokes);
  const sharedCount = Math.min(previousOrdered.length, nextOrdered.length);
  let exactPrefixCount = 0;
  while (
    exactPrefixCount < sharedCount
    && isExactStrokeMatch(previousOrdered[exactPrefixCount]!, nextOrdered[exactPrefixCount]!)
  ) {
    exactPrefixCount += 1;
  }

  // An immutable operation-log suffix is safe to composite over the retained texture. This is the
  // important layer-level case: a new destination-out stroke can erase earlier normal strokes
  // without replaying them, while a new normal stroke can paint over an earlier eraser.
  if (exactPrefixCount === previousOrdered.length && nextOrdered.length >= previousOrdered.length) {
    return {
      mode: "append",
      ...planStudioGpuDabs(nextOrdered.slice(previousOrdered.length)),
    };
  }

  // The common live-input case keeps immutable completed strokes and extends only the final one.
  // New strokes that already follow it in deterministic order can be appended in the same pass.
  const terminalIndex = previousOrdered.length - 1;
  const previousTerminal = previousOrdered[terminalIndex];
  const nextTerminal = nextOrdered[terminalIndex];
  if (
    terminalIndex >= 0
    && exactPrefixCount === terminalIndex
    && nextOrdered.length >= previousOrdered.length
    && previousTerminal
    && nextTerminal
    && sameStrokeStyle(previousTerminal, nextTerminal)
    && isStrictPointPrefix(previousTerminal, nextTerminal)
  ) {
    if (studioInkUsesResidualDabSpacing(nextTerminal.pressureModel)) {
      const previousFeed = previousTerminal[STUDIO_GPU_STROKE_FEED_REVISION];
      const residualSuffix = planStudioGpuResidualStrokeExtensionInternal(
        nextTerminal,
        studioGpuStrokeFeedPointCount(previousTerminal),
        null,
        STUDIO_GPU_MAX_DABS,
        isTrustedStudioGpuStrokeFeedStroke(previousTerminal)
          && isTrustedStudioGpuStrokeFeedRevision(previousFeed)
          ? previousFeed.token
          : undefined
      );
      if (!residualSuffix.complete) {
        return { mode: "rebuild", ...planStudioGpuDabs(nextOrdered) };
      }
      return {
        mode: "append",
        ...concatenateStudioGpuDabPlans([
          residualSuffix,
          planStudioGpuDabs(nextOrdered.slice(previousOrdered.length)),
        ]),
      };
    }
    const previousPointCount = studioGpuStrokeFeedPointCount(previousTerminal);
    const previousFeed = previousTerminal[STUDIO_GPU_STROKE_FEED_REVISION];
    const nextFeed = nextTerminal[STUDIO_GPU_STROKE_FEED_REVISION];
    const trustedFeedExtension = isTrustedStudioGpuStrokeFeedStroke(previousTerminal)
      && isTrustedStudioGpuStrokeFeedStroke(nextTerminal)
      && isTrustedStudioGpuStrokeFeedRevision(previousFeed)
      && isTrustedStudioGpuStrokeFeedRevision(nextFeed);
    const feedReceipt = trustedFeedExtension
      ? studioGpuStrokeFeedDabExtensionReceipt(nextTerminal, previousPointCount)
      : null;
    if (
      trustedFeedExtension
      && (!feedReceipt || feedReceipt.fromRevisionToken !== previousFeed.token)
    ) {
      return { mode: "rebuild", ...planStudioGpuDabs(nextOrdered) };
    }
    let suffixPlan: PlannedStudioGpuDabs;
    if (feedReceipt) {
      suffixPlan = planStudioGpuFeedStrokeExtensionInternal(
        nextTerminal,
        feedReceipt,
        null,
        STUDIO_GPU_MAX_DABS
      );
    } else {
      const suffixStart = previousPointCount - 1;
      const suffixPointCount = studioGpuStrokeFeedPointCount(nextTerminal) - suffixStart;
      const suffix: StudioGpuStroke = {
        ...nextTerminal,
        points: nextTerminal.points.slice(suffixStart * 2),
        pressures: Array.from(
          { length: suffixPointCount },
          (_, index) => pointPressure(nextTerminal, suffixStart + index)
        ),
      };
      suffixPlan = withoutInitialDab(planStudioGpuDabs([suffix]));
    }
    if (!suffixPlan.complete) {
      return { mode: "rebuild", ...planStudioGpuDabs(nextOrdered) };
    }
    return {
      mode: "append",
      ...concatenateStudioGpuDabPlans([
        suffixPlan,
        planStudioGpuDabs(nextOrdered.slice(previousOrdered.length)),
      ]),
    };
  }

  // Deletion, insertion before retained content, prediction-tail replacement and any historical
  // style/sample change can alter pixels already in the texture and therefore requires replay.
  return { mode: "rebuild", ...planStudioGpuDabs(nextOrdered) };
}
