/**
 * User-authored corrections for Scene Layer Lift masks.
 *
 * The UI records source-pixel coordinates and commits one immutable mask snapshot at pointer-up.
 * Interpolating the centres before stamping keeps fast pen/mouse strokes continuous without
 * running a full-image morphology pass on the interaction thread.
 */

export const STUDIO_LAYER_LIFT_CORRECTION_MAX_AXIS = 8_192;
export const STUDIO_LAYER_LIFT_CORRECTION_MAX_PIXELS = 16_777_216;
export const STUDIO_LAYER_LIFT_CORRECTION_MAX_POINTS = 16_384;
export const STUDIO_LAYER_LIFT_CORRECTION_MAX_RADIUS = 1_024;

export type StudioLayerLiftCorrectionMode = "include" | "exclude";

export interface StudioLayerLiftCorrectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioLayerLiftCorrectionStroke {
  readonly mode: StudioLayerLiftCorrectionMode;
  readonly radius: number;
  readonly points: readonly StudioLayerLiftCorrectionPoint[];
}

export type StudioLayerLiftCorrectionResult =
  | Readonly<{
      readonly ok: true;
      readonly mask: Uint8Array<ArrayBuffer>;
      readonly changedPixelCount: number;
    }>
  | Readonly<{
      readonly ok: false;
      readonly code:
        | "invalid-dimensions"
        | "invalid-mask"
        | "invalid-stroke"
        | "budget-exceeded";
      readonly message: string;
    }>;

function failure(
  code: Extract<StudioLayerLiftCorrectionResult, { ok: false }>["code"],
  message: string,
): StudioLayerLiftCorrectionResult {
  return Object.freeze({ ok: false as const, code, message });
}

function validateDimensions(
  width: unknown,
  height: unknown,
): Readonly<{ width: number; height: number; pixels: number }> | null {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > STUDIO_LAYER_LIFT_CORRECTION_MAX_AXIS
    || height > STUDIO_LAYER_LIFT_CORRECTION_MAX_AXIS
  ) {
    return null;
  }
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_LAYER_LIFT_CORRECTION_MAX_PIXELS
  ) {
    return null;
  }
  return Object.freeze({ width, height, pixels });
}

function finitePoint(
  point: unknown,
): point is StudioLayerLiftCorrectionPoint {
  if (typeof point !== "object" || point === null || Array.isArray(point)) {
    return false;
  }
  const record = point as Partial<StudioLayerLiftCorrectionPoint>;
  return (
    typeof record.x === "number"
    && typeof record.y === "number"
    && Number.isFinite(record.x)
    && Number.isFinite(record.y)
  );
}

function stampCircle(
  mask: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  centreX: number,
  centreY: number,
  radius: number,
  value: 0 | 255,
): number {
  const left = Math.max(0, Math.floor(centreX - radius));
  const right = Math.min(width - 1, Math.ceil(centreX + radius));
  const top = Math.max(0, Math.floor(centreY - radius));
  const bottom = Math.min(height - 1, Math.ceil(centreY + radius));
  const radiusSquared = radius * radius;
  let changed = 0;

  for (let y = top; y <= bottom; y += 1) {
    const dy = y + 0.5 - centreY;
    const row = y * width;
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - centreX;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const index = row + x;
      if (mask[index] === value) continue;
      mask[index] = value;
      changed += 1;
    }
  }
  return changed;
}

/**
 * Applies one correction stroke to an owned mutable mask.
 *
 * This is intentionally exported for the correction canvas, which owns a private clone during a
 * pointer session. Product callers that need immutability should use
 * `applyStudioLayerLiftCorrectionStroke` below.
 */
export function applyStudioLayerLiftCorrectionStrokeInPlace(input: {
  readonly mask: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  readonly stroke: StudioLayerLiftCorrectionStroke;
}): StudioLayerLiftCorrectionResult {
  const dimensions = validateDimensions(input.width, input.height);
  if (!dimensions) {
    return failure(
      "invalid-dimensions",
      "보정 마스크 크기가 지원 범위를 벗어났습니다.",
    );
  }
  if (
    !(input.mask instanceof Uint8Array)
    || !(input.mask.buffer instanceof ArrayBuffer)
    || input.mask.byteLength !== dimensions.pixels
  ) {
    return failure("invalid-mask", "보정 마스크 바이트 수가 이미지 크기와 다릅니다.");
  }

  const stroke = input.stroke;
  if (
    !stroke
    || (stroke.mode !== "include" && stroke.mode !== "exclude")
    || typeof stroke.radius !== "number"
    || !Number.isFinite(stroke.radius)
    || stroke.radius < 0.5
    || stroke.radius > STUDIO_LAYER_LIFT_CORRECTION_MAX_RADIUS
    || !Array.isArray(stroke.points)
    || stroke.points.length < 1
    || stroke.points.length > STUDIO_LAYER_LIFT_CORRECTION_MAX_POINTS
    || stroke.points.some((point) => !finitePoint(point))
  ) {
    return failure("invalid-stroke", "포함·제외 보정 획이 올바르지 않습니다.");
  }

  const value = stroke.mode === "include" ? 255 : 0;
  let changedPixelCount = 0;
  let previous = stroke.points[0]!;
  changedPixelCount += stampCircle(
    input.mask,
    dimensions.width,
    dimensions.height,
    previous.x,
    previous.y,
    stroke.radius,
    value,
  );

  for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex += 1) {
    const current = stroke.points[pointIndex]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    const stepLength = Math.max(0.5, stroke.radius * 0.45);
    const stepCount = Math.max(1, Math.ceil(distance / stepLength));
    for (let step = 1; step <= stepCount; step += 1) {
      const progress = step / stepCount;
      changedPixelCount += stampCircle(
        input.mask,
        dimensions.width,
        dimensions.height,
        previous.x + dx * progress,
        previous.y + dy * progress,
        stroke.radius,
        value,
      );
    }
    previous = current;
  }

  return Object.freeze({
    ok: true as const,
    mask: input.mask,
    changedPixelCount,
  });
}

/** Defensively clones the source mask and returns one immutable correction result. */
export function applyStudioLayerLiftCorrectionStroke(input: {
  readonly mask: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  readonly stroke: StudioLayerLiftCorrectionStroke;
}): StudioLayerLiftCorrectionResult {
  const dimensions = validateDimensions(input.width, input.height);
  if (!dimensions) {
    return failure(
      "invalid-dimensions",
      "보정 마스크 크기가 지원 범위를 벗어났습니다.",
    );
  }
  if (
    !(input.mask instanceof Uint8Array)
    || !(input.mask.buffer instanceof ArrayBuffer)
    || input.mask.byteLength !== dimensions.pixels
  ) {
    return failure("invalid-mask", "보정 마스크 바이트 수가 이미지 크기와 다릅니다.");
  }

  let owned: Uint8Array<ArrayBuffer>;
  try {
    owned = new Uint8Array(input.mask);
  } catch {
    return failure("budget-exceeded", "보정 마스크 작업 메모리를 확보하지 못했습니다.");
  }
  return applyStudioLayerLiftCorrectionStrokeInPlace({
    ...input,
    mask: owned,
  });
}
