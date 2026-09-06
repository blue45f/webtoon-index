/**
 * Procedural scatter / cloner / curve array (PRC-002–004, BLD-013/014 lite).
 */

export const STUDIO_PROCEDURAL_SCATTER_REVISION = 1 as const;

export type StudioVec3 = readonly [number, number, number];

export interface StudioScatterInstance {
  readonly id: string;
  readonly position: StudioVec3;
  readonly yaw: number;
  readonly scale: number;
  readonly variant: number;
}

export interface StudioScatterRequest {
  readonly seed: number;
  readonly count: number;
  readonly areaMin: StudioVec3;
  readonly areaMax: StudioVec3;
  readonly minSpacing?: number;
  readonly densityMask?: (p: StudioVec3) => number;
}

/** Deterministic mulberry32 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scatterStudioInstances(
  request: StudioScatterRequest,
): readonly StudioScatterInstance[] {
  const random = rng(request.seed);
  const count = Math.max(0, Math.min(10_000, Math.trunc(request.count)));
  const minSpacing = request.minSpacing ?? 0;
  const out: StudioScatterInstance[] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 40) {
    attempts += 1;
    const p: StudioVec3 = [
      request.areaMin[0]
        + random() * (request.areaMax[0] - request.areaMin[0]),
      request.areaMin[1]
        + random() * (request.areaMax[1] - request.areaMin[1]),
      request.areaMin[2]
        + random() * (request.areaMax[2] - request.areaMin[2]),
    ];
    if (request.densityMask && request.densityMask(p) < random()) continue;
    if (minSpacing > 0) {
      const ok = out.every(
        (o) =>
          Math.hypot(
            o.position[0] - p[0],
            o.position[1] - p[1],
            o.position[2] - p[2],
          ) >= minSpacing,
      );
      if (!ok) continue;
    }
    out.push({
      id: `inst-${out.length}`,
      position: p,
      yaw: random() * Math.PI * 2,
      scale: 0.8 + random() * 0.4,
      variant: Math.floor(random() * 4),
    });
  }
  return out;
}

/** Curve array: place instances along a polyline. */
export function arrayStudioAlongCurve(
  points: readonly StudioVec3[],
  count: number,
  seed = 1,
): readonly StudioScatterInstance[] {
  if (points.length < 2 || count < 1) return [];
  const random = rng(seed);
  // cumulative length
  const seg: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    seg.push(
      seg[i - 1]!
        + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
    );
  }
  const total = seg[seg.length - 1]! || 1;
  const out: StudioScatterInstance[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = count === 1 ? 0 : i / (count - 1);
    const dist = u * total;
    let s = 0;
    while (s + 1 < seg.length && seg[s + 1]! < dist) s += 1;
    const a = points[s]!;
    const b = points[Math.min(points.length - 1, s + 1)]!;
    const segLen = Math.max(1e-8, seg[s + 1]! - seg[s]!);
    const t = (dist - seg[s]!) / segLen;
    const position: StudioVec3 = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    const yaw = Math.atan2(b[2] - a[2], b[0] - a[0]);
    out.push({
      id: `curve-${i}`,
      position,
      yaw,
      scale: 1,
      variant: Math.floor(random() * 3),
    });
  }
  return out;
}

export interface StudioClonerField {
  readonly falloffRadius: number;
  readonly strength: number;
  readonly center: StudioVec3;
}

/** Cinema4D-like effector: scale instances by distance field. */
export function applyStudioClonerField(
  instances: readonly StudioScatterInstance[],
  field: StudioClonerField,
): readonly StudioScatterInstance[] {
  return instances.map((inst) => {
    const d = Math.hypot(
      inst.position[0] - field.center[0],
      inst.position[1] - field.center[1],
      inst.position[2] - field.center[2],
    );
    const w =
      d >= field.falloffRadius
        ? 0
        : (1 - d / field.falloffRadius) * field.strength;
    return { ...inst, scale: inst.scale * (1 + w) };
  });
}
