/** Conservative landmark framing; not exact head-mesh segmentation. */
type Vec3 = readonly [number, number, number];
export interface StudioVrmPortraitBounds { readonly min: Vec3; readonly max: Vec3 }
export interface StudioVrmPortraitLandmarks {
  readonly head?: Vec3;
  readonly neck?: Vec3;
  readonly leftEye?: Vec3;
  readonly rightEye?: Vec3;
  readonly chest?: Vec3;
  readonly leftUpperArm?: Vec3;
  readonly rightUpperArm?: Vec3;
}
const finite = (v: Vec3 | undefined): v is Vec3 => (
  Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
);
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a: Vec3, b: Vec3): number => Math.hypot(...subtract(a, b));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const midpoint = (a: Vec3, b: Vec3): Vec3 => [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2, a[2] / 2 + b[2] / 2];
function unit(v: Vec3): Vec3 | null {
  const length = Math.hypot(...v);
  return Number.isFinite(length) && length > 1e-8 ? [v[0] / length, v[1] / length, v[2] / length] : null;
}
function perpendicular(v: Vec3, up: Vec3): Vec3 | null {
  const projection = dot(v, up);
  return unit([v[0] - up[0] * projection, v[1] - up[1] * projection, v[2] - up[2] * projection]);
}

export function resolveStudioVrmPortraitBounds(
  presetId: string,
  body: StudioVrmPortraitBounds,
  points: StudioVrmPortraitLandmarks,
): StudioVrmPortraitBounds | null {
  if (!["closeup", "dramaticEye", "bust"].includes(presetId)) return null;
  if (!finite(body.min) || !finite(body.max) || !finite(points.head)) return null;
  const span = subtract(body.max, body.min);
  // World Y height collapses for lying/reclining poses; use the largest body extent.
  const size = Math.max(...span);
  if (span.some((value) => value < 0) || !Number.isFinite(size) || size < 0.05 || size > 100) return null;
  const head = points.head;
  const withinBody = (point: Vec3): boolean => point.every((value, axis) => (
    value >= body.min[axis] - size * 0.1 && value <= body.max[axis] + size * 0.1
  ));
  if (!withinBody(head)) return null;
  const nearby = (point: Vec3 | undefined, ratio: number): point is Vec3 => (
    finite(point) && withinBody(point) && distance(point, head) < size * ratio
  );
  const neck = nearby(points.neck, 0.3) ? points.neck : null;
  const neckSpan = neck ? distance(head, neck) : 0;
  const up: Vec3 = neck ? unit(subtract(head, neck)) ?? [0, 1, 0] : [0, 1, 0];
  const leftEye = nearby(points.leftEye, 0.35) ? points.leftEye : null;
  const rightEye = nearby(points.rightEye, 0.35) ? points.rightEye : null;
  const eyeSpan = leftEye && rightEye ? distance(leftEye, rightEye) : 0;
  const eyeAxis = leftEye && rightEye && eyeSpan > size * 0.003 && eyeSpan < size * 0.2
    ? perpendicular(subtract(leftEye, rightEye), up) : null;
  const eyeCenter = eyeAxis && leftEye && rightEye ? midpoint(leftEye, rightEye) : null;
  const shoulderAxis = nearby(points.leftUpperArm, 0.85) && nearby(points.rightUpperArm, 0.85)
    ? perpendicular(subtract(points.leftUpperArm, points.rightUpperArm), up) : null;
  const right: Vec3 = eyeAxis ?? shoulderAxis
    ?? perpendicular(Math.abs(up[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], up)!;
  const forward: Vec3 = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
  const radius = clamp(Math.max(size * 0.065, neckSpan * 1.25, eyeCenter ? eyeSpan * 1.65 : 0), size * 0.05, size * 0.22);
  const center: Vec3 = eyeCenter ?? [head[0] + up[0] * radius * 0.45, head[1] + up[1] * radius * 0.45, head[2] + up[2] * radius * 0.45];
  const radii: Vec3 = presetId === "dramaticEye" && eyeCenter
    ? [radius * 0.95, radius * 0.72, radius * 0.65]
    : [radius * 1.05, radius * 1.2, radius * 0.95];
  // World bounds of a head-aligned ellipsoid: a tilted head keeps its vertical headroom.
  const extent = [0, 1, 2].map((axis) => Math.hypot(right[axis] * radii[0], up[axis] * radii[1], forward[axis] * radii[2]));
  const min: [number, number, number] = [center[0] - extent[0], center[1] - extent[1], center[2] - extent[2]];
  const max: [number, number, number] = [center[0] + extent[0], center[1] + extent[1], center[2] + extent[2]];
  if (presetId === "bust") {
    const chest: Vec3 = nearby(points.chest, 0.75) ? points.chest
      : [head[0] - up[0] * radius * 2.1, head[1] - up[1] * radius * 2.1, head[2] - up[2] * radius * 2.1];
    for (const point of [chest, points.leftUpperArm, points.rightUpperArm]) {
      if (!finite(point) || (point !== chest && !nearby(point, 0.85))) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        const padding = radius * Math.hypot(right[axis] * 0.5, up[axis] * 0.5, forward[axis] * 0.85);
        min[axis] = Math.min(min[axis], point[axis] - padding);
        max[axis] = Math.max(max[axis], point[axis] + padding);
      }
    }
  }
  return [...min, ...max].every(Number.isFinite) ? { min, max } : null;
}
