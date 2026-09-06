/**
 * Camera wall hiding (BLD-018 / SHT-005): hide or fade walls between camera and subject.
 */

export const STUDIO_CAMERA_WALL_HIDE_REVISION = 1 as const;

export interface StudioWallPlane {
  readonly id: string;
  /** Plane point */
  readonly point: readonly [number, number, number];
  /** Outward normal (unit-ish) */
  readonly normal: readonly [number, number, number];
  readonly thickness: number;
  readonly tag?: string;
}

export interface StudioCameraWallHideInput {
  readonly cameraPosition: readonly [number, number, number];
  readonly subjectPosition: readonly [number, number, number];
  readonly walls: readonly StudioWallPlane[];
  /** Opacity for occluding walls (0 = fully hidden). */
  readonly occludedOpacity: number;
  readonly visibleOpacity?: number;
}

export type StudioWallVisibilityMode = "visible" | "transparent" | "hidden";

export interface StudioWallVisibilityDecision {
  readonly wallId: string;
  readonly mode: StudioWallVisibilityMode;
  readonly opacity: number;
  readonly occludesSegment: boolean;
  readonly hitT: number | null;
}

export interface StudioCameraWallHideResult {
  readonly revision: typeof STUDIO_CAMERA_WALL_HIDE_REVISION;
  readonly decisions: readonly StudioWallVisibilityDecision[];
  readonly occludedWallIds: readonly string[];
}

function dot(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Ray-plane intersection for segment camera→subject.
 * Returns t in [0,1] if the infinite plane is crossed within the segment and within thickness slab.
 */
export function segmentIntersectsWall(
  camera: readonly [number, number, number],
  subject: readonly [number, number, number],
  wall: StudioWallPlane,
): { readonly hits: boolean; readonly t: number | null } {
  const dir = sub(subject, camera);
  const denom = dot(wall.normal, dir);
  if (Math.abs(denom) < 1e-10) {
    // Parallel: check if camera is inside thickness slab toward subject
    const toCam = sub(camera, wall.point);
    const dist = Math.abs(dot(wall.normal, toCam));
    if (dist <= wall.thickness * 0.5) {
      return { hits: true, t: 0 };
    }
    return { hits: false, t: null };
  }
  const toPoint = sub(wall.point, camera);
  const t = dot(wall.normal, toPoint) / denom;
  if (t < 0 || t > 1) return { hits: false, t: null };
  return { hits: true, t };
}

export function resolveStudioCameraWallHide(
  input: StudioCameraWallHideInput,
): StudioCameraWallHideResult {
  const visibleOpacity = input.visibleOpacity ?? 1;
  const occludedOpacity = Math.max(0, Math.min(1, input.occludedOpacity));
  const decisions: StudioWallVisibilityDecision[] = [];
  const occluded: string[] = [];

  for (const wall of input.walls) {
    const hit = segmentIntersectsWall(
      input.cameraPosition,
      input.subjectPosition,
      wall,
    );
    if (hit.hits) {
      const mode: StudioWallVisibilityMode =
        occludedOpacity <= 0 ? "hidden" : "transparent";
      decisions.push({
        wallId: wall.id,
        mode,
        opacity: occludedOpacity,
        occludesSegment: true,
        hitT: hit.t,
      });
      occluded.push(wall.id);
    } else {
      decisions.push({
        wallId: wall.id,
        mode: "visible",
        opacity: visibleOpacity,
        occludesSegment: false,
        hitT: null,
      });
    }
  }

  return {
    revision: STUDIO_CAMERA_WALL_HIDE_REVISION,
    decisions,
    occludedWallIds: occluded,
  };
}
