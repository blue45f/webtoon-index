import type { StudioDynamicBrushDab } from "./studio-brush-dynamics";

export interface StudioBrushSymmetrySpec {
  type: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  centerX: number;
  centerY: number;
  radialCount?: number;
}

/** Affine transform using x'=a·x+c·y+e, y'=b·x+d·y+f. */
export interface StudioBrushSymmetryTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: StudioBrushSymmetryTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Persisted/imported documents do not pass through the inspector's 4..16 option list. Keep the
 * renderer boundary finite and aligned with the live WebGPU planner, which accepts at most 32
 * radial directions (64 affine copies for kaleidoscope).
 */
export const STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS = 32;
export const STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS =
  STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS * 2;

/**
 * Symmetry copies of ONE active draft whose per-stroke planners are worth retaining at once.
 *
 * A retained renderer draws every copy of the active draft on each frame, walking them in a fixed
 * index order, so a stroke-keyed planner cache sees a working set of `variations`, not one. An LRU
 * smaller than that is the textbook cyclic worst case: every copy is evicted just before its next
 * use, so the hit rate is exactly zero AND each miss now pays planner construction plus a
 * verification pass on top of the full rebuild the cache existed to avoid — strictly worse than no
 * cache. Callers therefore size their cache by this number and route a wider fan straight to the
 * batch planners, so a big kaleidoscope degrades to the uncached cost instead of below it.
 *
 * Sixteen is the inspector's largest radial count (16) and equally its 8-way kaleidoscope
 * (8 rotations + 8 mirrors). Past that the retained beds — a capped oil stroke holds ~27k run
 * objects per copy — cost more memory than the reuse is worth.
 */
export const STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS = 16;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function radialCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS, Math.round(value))
    : 4;
}

function aroundCenter(
  a: number,
  b: number,
  c: number,
  d: number,
  centerX: number,
  centerY: number
): StudioBrushSymmetryTransform {
  return {
    a,
    b,
    c,
    d,
    e: centerX - a * centerX - c * centerY,
    f: centerY - b * centerX - d * centerY,
  };
}

/**
 * Returns transforms in exactly the same order as getSymmetricPoints/getKaleidoscopePoints:
 * identity, rotations, then (for kaleidoscope) mirror families.
 */
export function studioBrushSymmetryTransforms(
  symmetry?: StudioBrushSymmetrySpec
): StudioBrushSymmetryTransform[] {
  if (!symmetry || symmetry.type === "none") return [{ ...IDENTITY }];
  const centerX = finite(symmetry.centerX, 0);
  const centerY = finite(symmetry.centerY, 0);
  if (symmetry.type === "vertical") {
    return [{ ...IDENTITY }, aroundCenter(-1, 0, 0, 1, centerX, centerY)];
  }
  if (symmetry.type === "horizontal") {
    return [{ ...IDENTITY }, aroundCenter(1, 0, 0, -1, centerX, centerY)];
  }

  // Silk generative: kaleidoscope family with denser default arms.
  const count = radialCount(
    symmetry.type === "silk"
      ? (symmetry.radialCount ?? 8)
      : symmetry.radialCount,
  );
  const transforms: StudioBrushSymmetryTransform[] = [{ ...IDENTITY }];
  for (let index = 1; index < count; index++) {
    const angle = index * 2 * Math.PI / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    transforms.push(aroundCenter(cos, sin, -sin, cos, centerX, centerY));
  }
  if (symmetry.type === "kaleidoscope" || symmetry.type === "silk") {
    for (let index = 0; index < count; index++) {
      const axisAngle = index * Math.PI / count;
      const cos = Math.cos(2 * axisAngle);
      const sin = Math.sin(2 * axisAngle);
      transforms.push(aroundCenter(cos, sin, sin, -cos, centerX, centerY));
    }
  }
  return transforms;
}

export function transformStudioBrushSymmetryPoint(
  x: number,
  y: number,
  transform: StudioBrushSymmetryTransform
): [number, number] {
  return [
    transform.a * x + transform.c * y + transform.e,
    transform.b * x + transform.d * y + transform.f,
  ];
}

function isIdentityStudioBrushSymmetryTransform(
  transform: StudioBrushSymmetryTransform
): boolean {
  return transform.a === 1 && transform.b === 0 && transform.c === 0
    && transform.d === 1 && transform.e === 0 && transform.f === 0;
}

/** Transforms the whole dab—including deterministic scatter and the elliptical tip axis. */
export function transformStudioDynamicBrushDab(
  dab: StudioDynamicBrushDab,
  transform: StudioBrushSymmetryTransform
): StudioDynamicBrushDab {
  if (isIdentityStudioBrushSymmetryTransform(transform)) {
    return { ...dab };
  }
  const [sourceX, sourceY] = transformStudioBrushSymmetryPoint(
    dab.sourceX,
    dab.sourceY,
    transform
  );
  const [x, y] = transformStudioBrushSymmetryPoint(dab.x, dab.y, transform);
  const angleRadians = dab.angle * Math.PI / 180;
  const axisX = Math.cos(angleRadians);
  const axisY = Math.sin(angleRadians);
  const transformedAxisX = transform.a * axisX + transform.c * axisY;
  const transformedAxisY = transform.b * axisX + transform.d * axisY;
  const angle = Math.atan2(transformedAxisY, transformedAxisX) * 180 / Math.PI;
  const transformDirection = (degrees: number): number => {
    const radians = degrees * Math.PI / 180;
    const directionAxisX = Math.cos(radians);
    const directionAxisY = Math.sin(radians);
    return Math.atan2(
      transform.b * directionAxisX + transform.d * directionAxisY,
      transform.a * directionAxisX + transform.c * directionAxisY,
    ) * 180 / Math.PI;
  };
  const direction = transformDirection(dab.direction ?? dab.angle);
  const segmentStartFrame = dab.segmentStartFrame
    ? (() => {
        const [frameSourceX, frameSourceY] =
          transformStudioBrushSymmetryPoint(
            dab.segmentStartFrame.sourceX,
            dab.segmentStartFrame.sourceY,
            transform,
          );
        return {
          ...dab.segmentStartFrame,
          sourceX: frameSourceX,
          sourceY: frameSourceY,
          direction: transformDirection(dab.segmentStartFrame.direction),
        };
      })()
    : undefined;
  return {
    ...dab,
    sourceX,
    sourceY,
    x,
    y,
    angle,
    ...(dab.direction !== undefined ? { direction } : {}),
    ...(segmentStartFrame ? { segmentStartFrame } : {}),
  };
}

/** Builds every exact affine copy from one deterministic base plan. */
export function studioDynamicBrushDabVariationsFromTransforms(
  dabs: readonly StudioDynamicBrushDab[],
  transforms: readonly StudioBrushSymmetryTransform[]
): Array<readonly StudioDynamicBrushDab[]> {
  return transforms.map((transform) => (
    isIdentityStudioBrushSymmetryTransform(transform)
      ? dabs
      : dabs.map((dab) => transformStudioDynamicBrushDab(dab, transform))
  ));
}

/** Builds every exact affine copy from one deterministic base plan. */
export function studioDynamicBrushDabVariations(
  dabs: readonly StudioDynamicBrushDab[],
  symmetry?: StudioBrushSymmetrySpec
): Array<readonly StudioDynamicBrushDab[]> {
  return studioDynamicBrushDabVariationsFromTransforms(
    dabs,
    studioBrushSymmetryTransforms(symmetry)
  );
}
