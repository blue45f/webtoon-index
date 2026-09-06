export interface StudioStrokeGuidePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioStrokeGuidePlan {
  readonly visible: boolean;
  readonly points: readonly [number, number, number, number];
  readonly strokeWidth: number;
  readonly dash: readonly [number, number];
}

const HIDDEN_POINTS = Object.freeze([0, 0, 0, 0]) as readonly [
  number,
  number,
  number,
  number,
];

function finitePoint(value: StudioStrokeGuidePoint | null | undefined): value is StudioStrokeGuidePoint {
  return Boolean(
    value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y),
  );
}

export function normalizeStudioStrokeGuideScale(effectiveScale: number): number {
  return Number.isFinite(effectiveScale) && effectiveScale > 0 ? effectiveScale : 1;
}

/**
 * Allocation-free hot-path predicate for native pointerrawupdate/pointermove handlers.
 *
 * Keep this scalar so a 120/240Hz input stream does not create temporary point/plan arrays merely
 * to decide whether the presentation-only tether needs a scene update.
 */
export function shouldShowStudioStrokeGuide(
  enabled: boolean,
  drawing: boolean,
  stabilizer: number,
  effectiveScale: number,
  inkX: number,
  inkY: number,
  pointerX: number,
  pointerY: number,
): boolean {
  if (
    !enabled
    || !drawing
    || !Number.isFinite(stabilizer)
    || stabilizer <= 0
    || !Number.isFinite(inkX)
    || !Number.isFinite(inkY)
    || !Number.isFinite(pointerX)
    || !Number.isFinite(pointerY)
  ) {
    return false;
  }
  const scale = normalizeStudioStrokeGuideScale(effectiveScale);
  const minimumVisibleDistance = Math.max(0.75 / scale, 1.15 / scale);
  const distance = Math.hypot(pointerX - inkX, pointerY - inkY);
  return Number.isFinite(distance) && distance > minimumVisibleDistance;
}

/**
 * Plans the transient tether between the authoritative ink endpoint and the latest pointer.
 *
 * The guide is intentionally presentation-only: it never participates in stroke geometry,
 * history, export, CRDT operations, or hit testing. Tiny sub-pixel differences are hidden so a
 * zero-latency brush does not shimmer even when the preference is enabled.
 */
export function planStudioStrokeGuide(input: {
  readonly enabled: boolean;
  readonly drawing: boolean;
  readonly stabilizer: number;
  readonly effectiveScale: number;
  readonly inkPoint: StudioStrokeGuidePoint | null | undefined;
  readonly pointerPoint: StudioStrokeGuidePoint | null | undefined;
}): StudioStrokeGuidePlan {
  const scale = normalizeStudioStrokeGuideScale(input.effectiveScale);
  const strokeWidth = 1.15 / scale;
  const dash = Object.freeze([4 / scale, 3 / scale]) as readonly [number, number];
  if (
    !finitePoint(input.inkPoint)
    || !finitePoint(input.pointerPoint)
    || !shouldShowStudioStrokeGuide(
      input.enabled,
      input.drawing,
      input.stabilizer,
      scale,
      input.inkPoint.x,
      input.inkPoint.y,
      input.pointerPoint.x,
      input.pointerPoint.y,
    )
  ) {
    return Object.freeze({
      visible: false,
      points: HIDDEN_POINTS,
      strokeWidth,
      dash,
    });
  }
  return Object.freeze({
    visible: true,
    points: Object.freeze([
      input.inkPoint.x,
      input.inkPoint.y,
      input.pointerPoint.x,
      input.pointerPoint.y,
    ]) as readonly [number, number, number, number],
    strokeWidth,
    dash,
  });
}
