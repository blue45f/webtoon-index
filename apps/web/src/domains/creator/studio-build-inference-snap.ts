/**
 * SketchUp-class inference snaps (BLD-001, BLD-002).
 * Pure geometry — no Three.js. Pointer velocity / zoom scale modulate pixel thresholds.
 */

export const STUDIO_BUILD_INFERENCE_REVISION = 1 as const;

export type StudioInferenceSnapKind =
  | "endpoint"
  | "midpoint"
  | "intersection"
  | "axis"
  | "parallel"
  | "perpendicular"
  | "tangent";

export type StudioInferenceAxisLock = "x" | "y" | "z" | "none";

export interface StudioInferencePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StudioInferenceSegment {
  readonly id: string;
  readonly a: StudioInferencePoint;
  readonly b: StudioInferencePoint;
}

export interface StudioInferenceSnapCandidate {
  readonly kind: StudioInferenceSnapKind;
  readonly point: StudioInferencePoint;
  readonly distance: number;
  readonly sourceIds: readonly string[];
  readonly axis?: StudioInferenceAxisLock;
  readonly locked: boolean;
}

export interface StudioInferenceSnapQuery {
  readonly cursor: StudioInferencePoint;
  readonly segments: readonly StudioInferenceSegment[];
  /** Screen-space pixel threshold projected to world via pixelsPerUnit. */
  readonly pixelThreshold: number;
  readonly pixelsPerUnit: number;
  readonly pointerVelocity: number;
  readonly axisLock: StudioInferenceAxisLock;
  readonly preferKinds?: readonly StudioInferenceSnapKind[];
}

export interface StudioInferenceSnapResult {
  readonly revision: typeof STUDIO_BUILD_INFERENCE_REVISION;
  readonly snapped: boolean;
  readonly candidate: StudioInferenceSnapCandidate | null;
  readonly candidates: readonly StudioInferenceSnapCandidate[];
  readonly worldThreshold: number;
}

function dist(a: StudioInferencePoint, b: StudioInferencePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mid(a: StudioInferencePoint, b: StudioInferencePoint): StudioInferencePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function sub(a: StudioInferencePoint, b: StudioInferencePoint): StudioInferencePoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: StudioInferencePoint, b: StudioInferencePoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(a: StudioInferencePoint): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: StudioInferencePoint): StudioInferencePoint {
  const l = len(a);
  if (l <= 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Closest point on segment AB to P. */
function closestOnSegment(
  p: StudioInferencePoint,
  a: StudioInferencePoint,
  b: StudioInferencePoint,
): StudioInferencePoint {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab))));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
}

/** Segment-segment closest points (3D); returns midpoint of closest pair when nearly intersecting. */
function segmentIntersection(
  a: StudioInferenceSegment,
  b: StudioInferenceSegment,
): StudioInferencePoint | null {
  const p1 = a.a;
  const d1 = sub(a.b, a.a);
  const p2 = b.a;
  const d2 = sub(b.b, b.a);
  const r = sub(p1, p2);
  const aDot = dot(d1, d1);
  const bDot = dot(d1, d2);
  const cDot = dot(d2, d2);
  const dDot = dot(d1, r);
  const eDot = dot(d2, r);
  const denom = aDot * cDot - bDot * bDot;
  if (Math.abs(denom) < 1e-12) return null;
  let s = (bDot * eDot - cDot * dDot) / denom;
  let t = (aDot * eDot - bDot * dDot) / denom;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const q1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const q2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  if (dist(q1, q2) > 1e-4) return null;
  return mid(q1, q2);
}

function axisPoint(
  cursor: StudioInferencePoint,
  origin: StudioInferencePoint,
  axis: StudioInferenceAxisLock,
): StudioInferencePoint | null {
  if (axis === "none") return null;
  if (axis === "x") return { x: cursor.x, y: origin.y, z: origin.z };
  if (axis === "y") return { x: origin.x, y: cursor.y, z: origin.z };
  return { x: origin.x, y: origin.y, z: cursor.z };
}

const KIND_PRIORITY: Record<StudioInferenceSnapKind, number> = {
  endpoint: 0,
  midpoint: 1,
  intersection: 2,
  axis: 3,
  parallel: 4,
  perpendicular: 5,
  tangent: 6,
};

export function resolveStudioBuildInferenceSnap(
  query: StudioInferenceSnapQuery,
): StudioInferenceSnapResult {
  const velocityBoost = 1 + Math.min(2, Math.abs(query.pointerVelocity) * 0.01);
  const ppu = Math.max(1e-6, query.pixelsPerUnit);
  const worldThreshold =
    (Math.max(1, query.pixelThreshold) / ppu) * velocityBoost;

  const candidates: StudioInferenceSnapCandidate[] = [];
  const prefer = new Set(query.preferKinds ?? []);

  for (const seg of query.segments) {
    for (const [kind, point] of [
      ["endpoint", seg.a] as const,
      ["endpoint", seg.b] as const,
      ["midpoint", mid(seg.a, seg.b)] as const,
    ]) {
      const d = dist(query.cursor, point);
      if (d <= worldThreshold) {
        candidates.push({
          kind,
          point,
          distance: d,
          sourceIds: [seg.id],
          locked: query.axisLock !== "none",
          axis: query.axisLock,
        });
      }
    }

    // Parallel / perpendicular / tangent hints relative to segment direction.
    const dir = normalize(sub(seg.b, seg.a));
    const closest = closestOnSegment(query.cursor, seg.a, seg.b);
    const toCursor = sub(query.cursor, closest);
    const dClose = dist(query.cursor, closest);
    if (dClose <= worldThreshold * 1.5) {
      const parallelScore = Math.abs(dot(normalize(toCursor), dir));
      if (parallelScore > 0.95) {
        candidates.push({
          kind: "parallel",
          point: closest,
          distance: dClose,
          sourceIds: [seg.id],
          locked: query.axisLock !== "none",
        });
      }
      if (parallelScore < 0.15) {
        candidates.push({
          kind: "perpendicular",
          point: closest,
          distance: dClose,
          sourceIds: [seg.id],
          locked: query.axisLock !== "none",
        });
      }
      // Tangent: for straight segments, treat endpoint approach along direction as tangent.
      const endA = dist(query.cursor, seg.a);
      const endB = dist(query.cursor, seg.b);
      if (Math.min(endA, endB) <= worldThreshold && parallelScore > 0.8) {
        candidates.push({
          kind: "tangent",
          point: endA < endB ? seg.a : seg.b,
          distance: Math.min(endA, endB),
          sourceIds: [seg.id],
          locked: query.axisLock !== "none",
        });
      }
    }
  }

  for (let i = 0; i < query.segments.length; i += 1) {
    for (let j = i + 1; j < query.segments.length; j += 1) {
      const hit = segmentIntersection(query.segments[i]!, query.segments[j]!);
      if (!hit) continue;
      const d = dist(query.cursor, hit);
      if (d <= worldThreshold) {
        candidates.push({
          kind: "intersection",
          point: hit,
          distance: d,
          sourceIds: [query.segments[i]!.id, query.segments[j]!.id],
          locked: query.axisLock !== "none",
        });
      }
    }
  }

  if (query.axisLock !== "none" && query.segments.length > 0) {
    const origin = query.segments[0]!.a;
    const ap = axisPoint(query.cursor, origin, query.axisLock);
    if (ap) {
      const d = dist(query.cursor, ap);
      if (d <= worldThreshold * 2) {
        candidates.push({
          kind: "axis",
          point: ap,
          distance: d,
          sourceIds: [query.segments[0]!.id],
          axis: query.axisLock,
          locked: true,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    const prefA = prefer.has(a.kind) ? -10 : 0;
    const prefB = prefer.has(b.kind) ? -10 : 0;
    if (prefA !== prefB) return prefA - prefB;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  });

  const best = candidates[0] ?? null;
  return {
    revision: STUDIO_BUILD_INFERENCE_REVISION,
    snapped: best !== null,
    candidate: best,
    candidates,
    worldThreshold,
  };
}

/** Keyboard lock helper — toggles axis lock deterministically. */
export function cycleStudioInferenceAxisLock(
  current: StudioInferenceAxisLock,
): StudioInferenceAxisLock {
  if (current === "none") return "x";
  if (current === "x") return "y";
  if (current === "y") return "z";
  return "none";
}
