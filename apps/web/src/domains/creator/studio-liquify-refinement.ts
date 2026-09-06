import {
  LIQUIFY_MAX_FIELD_CELLS,
  liquifyBrushWeight,
  planLiquifyBrushDabs,
  type LiquifyDisplacementField,
  type LiquifyPixelPoint,
  type StudioLiquifyBrushDynamics,
} from "./studio-liquify";

export const STUDIO_LIQUIFY_REFINEMENT_MODES = ["reconstruct", "smooth"] as const;
export type StudioLiquifyRefinementMode = (typeof STUDIO_LIQUIFY_REFINEMENT_MODES)[number];

export interface StudioLiquifyFieldRefinementPlan {
  readonly mode: StudioLiquifyRefinementMode;
  /** Canvas-space origin of the compact influence grid. */
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly influence: Float32Array;
  readonly estimatedCellVisits: number;
}

export type StudioLiquifyRefinementOptions = StudioLiquifyBrushDynamics & {
  readonly signal?: AbortSignal;
};

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("리퀴파이 필드 보정을 취소했습니다.", "AbortError");
  }
  const error = new Error("리퀴파이 필드 보정을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function validField(field: LiquifyDisplacementField): boolean {
  const cells = field.width * field.height;
  return Number.isSafeInteger(field.originX)
    && Number.isSafeInteger(field.originY)
    && Number.isSafeInteger(field.width)
    && Number.isSafeInteger(field.height)
    && field.width > 0
    && field.height > 0
    && Number.isSafeInteger(cells)
    && cells <= LIQUIFY_MAX_FIELD_CELLS
    && field.dx instanceof Float32Array
    && field.dy instanceof Float32Array
    && field.dx.length === cells
    && field.dy.length === cells;
}

/**
 * Produces a compact, structured-clone-safe brush influence map. Reconstruct and Smooth are field
 * operations, not destructive image filters: callers must retain the pre-liquify source plus the
 * accumulated displacement field for the duration of the editing session.
 */
export function planStudioLiquifyFieldRefinement(
  field: LiquifyDisplacementField,
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  mode: StudioLiquifyRefinementMode,
  options: StudioLiquifyRefinementOptions = {}
): StudioLiquifyFieldRefinementPlan | null {
  throwIfAborted(options.signal);
  if (!validField(field) || !STUDIO_LIQUIFY_REFINEMENT_MODES.includes(mode)) return null;
  const dabPlan = planLiquifyBrushDabs(points, radiusPx, strength, {
    ...options,
    // A center-based mode makes both a tap and a stroke produce brush dabs; its deformation vector
    // is intentionally ignored because refinement operates on the retained field below.
    mode: "bloat",
  });
  if (!dabPlan.complete || dabPlan.dabs.length === 0) return null;

  const fieldEndX = field.originX + field.width - 1;
  const fieldEndY = field.originY + field.height - 1;
  let originX = Number.POSITIVE_INFINITY;
  let originY = Number.POSITIVE_INFINITY;
  let endX = Number.NEGATIVE_INFINITY;
  let endY = Number.NEGATIVE_INFINITY;
  for (const dab of dabPlan.dabs) {
    originX = Math.min(originX, Math.max(field.originX, Math.floor(dab.x - dab.radius)));
    originY = Math.min(originY, Math.max(field.originY, Math.floor(dab.y - dab.radius)));
    endX = Math.max(endX, Math.min(fieldEndX, Math.ceil(dab.x + dab.radius)));
    endY = Math.max(endY, Math.min(fieldEndY, Math.ceil(dab.y + dab.radius)));
  }
  if (![originX, originY, endX, endY].every(Number.isFinite) || endX < originX || endY < originY) {
    return null;
  }
  const width = endX - originX + 1;
  const height = endY - originY + 1;
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > LIQUIFY_MAX_FIELD_CELLS) return null;

  let influence: Float32Array;
  try {
    influence = new Float32Array(cells);
  } catch {
    return null;
  }
  const hardness = options.hardness;
  let touched = false;
  for (let dabIndex = 0; dabIndex < dabPlan.dabs.length; dabIndex += 1) {
    if ((dabIndex & 15) === 0) throwIfAborted(options.signal);
    const dab = dabPlan.dabs[dabIndex]!;
    const minimumX = Math.max(originX, Math.floor(dab.x - dab.radius));
    const maximumX = Math.min(endX, Math.ceil(dab.x + dab.radius));
    const minimumY = Math.max(originY, Math.floor(dab.y - dab.radius));
    const maximumY = Math.min(endY, Math.ceil(dab.y + dab.radius));
    for (let y = minimumY; y <= maximumY; y += 1) {
      if (((y - minimumY) & 31) === 0) throwIfAborted(options.signal);
      const rowOffset = (y - originY) * width;
      for (let x = minimumX; x <= maximumX; x += 1) {
        const weight = liquifyBrushWeight(x - dab.x, y - dab.y, dab.radius, hardness);
        if (weight <= 0) continue;
        const amount = Math.min(1, Math.max(0, dab.strength * weight));
        const index = rowOffset + (x - originX);
        // Coverage union is stable in input order and never exceeds one, even after repeated dabs.
        influence[index] = 1 - (1 - influence[index]!) * (1 - amount);
        touched = true;
      }
    }
  }
  if (!touched) return null;
  return {
    mode,
    originX,
    originY,
    width,
    height,
    influence,
    estimatedCellVisits: dabPlan.estimatedCellVisits,
  };
}

/** Applies a refinement plan immutably so cancellation can never leave a half-mutated session. */
export function applyStudioLiquifyFieldRefinement(
  field: LiquifyDisplacementField,
  plan: StudioLiquifyFieldRefinementPlan,
  signal?: AbortSignal
): LiquifyDisplacementField | null {
  throwIfAborted(signal);
  if (!validField(field)) return null;
  const planCells = plan.width * plan.height;
  if (
    !STUDIO_LIQUIFY_REFINEMENT_MODES.includes(plan.mode)
    || !Number.isSafeInteger(plan.originX)
    || !Number.isSafeInteger(plan.originY)
    || !Number.isSafeInteger(plan.width)
    || !Number.isSafeInteger(plan.height)
    || plan.width <= 0
    || plan.height <= 0
    || !Number.isSafeInteger(planCells)
    || planCells > LIQUIFY_MAX_FIELD_CELLS
    || !(plan.influence instanceof Float32Array)
    || plan.influence.length !== planCells
  ) {
    return null;
  }

  let dx: Float32Array;
  let dy: Float32Array;
  try {
    dx = field.dx.slice();
    dy = field.dy.slice();
  } catch {
    return null;
  }
  const fieldEndX = field.originX + field.width - 1;
  const fieldEndY = field.originY + field.height - 1;
  for (let localY = 0; localY < plan.height; localY += 1) {
    if ((localY & 31) === 0) throwIfAborted(signal);
    const canvasY = plan.originY + localY;
    if (canvasY < field.originY || canvasY > fieldEndY) continue;
    for (let localX = 0; localX < plan.width; localX += 1) {
      const canvasX = plan.originX + localX;
      if (canvasX < field.originX || canvasX > fieldEndX) continue;
      const influence = plan.influence[localY * plan.width + localX]!;
      if (!Number.isFinite(influence) || influence <= 0) continue;
      const fieldX = canvasX - field.originX;
      const fieldY = canvasY - field.originY;
      const fieldIndex = fieldY * field.width + fieldX;
      const amount = Math.min(1, influence);
      if (plan.mode === "reconstruct") {
        if (amount >= 1) {
          dx[fieldIndex] = 0;
          dy[fieldIndex] = 0;
        } else {
          dx[fieldIndex] = field.dx[fieldIndex]! * (1 - amount);
          dy[fieldIndex] = field.dy[fieldIndex]! * (1 - amount);
        }
        continue;
      }

      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const neighborY = fieldY + offsetY;
        if (neighborY < 0 || neighborY >= field.height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighborX = fieldX + offsetX;
          if (neighborX < 0 || neighborX >= field.width) continue;
          const neighborIndex = neighborY * field.width + neighborX;
          sumX += field.dx[neighborIndex]!;
          sumY += field.dy[neighborIndex]!;
          count += 1;
        }
      }
      if (count === 0) continue;
      const averageX = sumX / count;
      const averageY = sumY / count;
      dx[fieldIndex] = field.dx[fieldIndex]! + (averageX - field.dx[fieldIndex]!) * amount;
      dy[fieldIndex] = field.dy[fieldIndex]! + (averageY - field.dy[fieldIndex]!) * amount;
    }
  }
  return { ...field, dx, dy };
}

export function refineStudioLiquifyDisplacementField(
  field: LiquifyDisplacementField,
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  mode: StudioLiquifyRefinementMode,
  options: StudioLiquifyRefinementOptions = {}
): LiquifyDisplacementField | null {
  const plan = planStudioLiquifyFieldRefinement(
    field,
    points,
    radiusPx,
    strength,
    mode,
    options
  );
  return plan ? applyStudioLiquifyFieldRefinement(field, plan, options.signal) : null;
}
