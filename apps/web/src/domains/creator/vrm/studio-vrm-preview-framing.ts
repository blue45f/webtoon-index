/** Perspective fit in camera space. No renderer, DOM or model mutation. */
type Vec3 = readonly [number, number, number];
export interface StudioVrmPreviewBounds { readonly min: Vec3; readonly max: Vec3 }
export interface StudioVrmPreviewCamera {
  readonly id: string;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}
export interface StudioVrmPreviewFrame {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly distance: number;
}
const PORTRAIT_PRESETS = new Set(["bust", "dramaticEye", "closeup", "overShoulder", "custom"]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function normalize(v: Vec3): [number, number, number] | null {
  const length = Math.hypot(...v);
  return Number.isFinite(length) && length > 1e-8 ? [v[0] / length, v[1] / length, v[2] / length] : null;
}

/**
 * Frame the complete bounds, including horizontal spread and depth. Portrait and
 * custom shots deliberately retain their authored crop. Margin is screen-space
 * padding, not a height-only distance multiplier that fails on narrow viewports.
 */
export function fitStudioVrmPreviewCamera(
  preset: StudioVrmPreviewCamera,
  bounds: StudioVrmPreviewBounds,
  aspect: number,
  margin = 0.12,
): StudioVrmPreviewFrame | null {
  if (PORTRAIT_PRESETS.has(preset.id)) return null;
  if (![...bounds.min, ...bounds.max, ...preset.position, ...preset.target, preset.fov, aspect, margin].every(Number.isFinite)) return null;
  if (aspect <= 0 || preset.fov <= 1 || preset.fov >= 170 || margin < 0 || margin >= 0.8) return null;
  const sizes = bounds.max.map((value, axis) => value - bounds.min[axis]);
  if (sizes.some((size) => size < 0) || Math.max(...sizes) < 1e-5 || Math.max(...sizes) > 100) return null;
  const backward = normalize([
    preset.position[0] - preset.target[0],
    preset.position[1] - preset.target[1],
    preset.position[2] - preset.target[2],
  ]);
  if (!backward) return null;
  const right = normalize(cross([0, 1, 0], backward)) ?? normalize(cross([0, 0, 1], backward));
  if (!right) return null;
  const up = cross(backward, right);
  const target: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const tanY = Math.tan(preset.fov * Math.PI / 360) * (1 - margin);
  const tanX = tanY * aspect;
  let distance = 0.05;
  for (let corner = 0; corner < 8; corner += 1) {
    const relative: Vec3 = [
      (corner & 1 ? bounds.max[0] : bounds.min[0]) - target[0],
      (corner & 2 ? bounds.max[1] : bounds.min[1]) - target[1],
      (corner & 4 ? bounds.max[2] : bounds.min[2]) - target[2],
    ];
    const depth = dot(relative, backward);
    distance = Math.max(distance, depth + 0.05,
      depth + Math.abs(dot(relative, right)) / tanX,
      depth + Math.abs(dot(relative, up)) / tanY);
  }
  if (!Number.isFinite(distance) || distance > 1000) return null;
  return {
    target,
    position: [target[0] + backward[0] * distance, target[1] + backward[1] * distance, target[2] + backward[2] * distance],
    distance,
  };
}
