/**
 * Build generators: floor-plan→wall, stairs/ramp, ceiling/floor/trim, measurement (BLD-009…012, 016).
 * Composes with room builder semantic parts on the shared scene document.
 */

export const STUDIO_BUILD_GENERATORS_REVISION = 1 as const;

export interface StudioFloorPlanPoint {
  readonly x: number;
  readonly z: number;
}

export interface StudioFloorPlanWallRequest {
  readonly points: readonly StudioFloorPlanPoint[];
  readonly closed: boolean;
  readonly wallHeight: number;
  readonly wallThickness: number;
  readonly defaultOpenings?: readonly {
    readonly segmentIndex: number;
    readonly type: "door" | "window";
    readonly t: number;
    readonly width: number;
    readonly height: number;
    readonly sillHeight: number;
  }[];
}

export interface StudioGeneratedWallSegment {
  readonly id: string;
  readonly start: StudioFloorPlanPoint;
  readonly end: StudioFloorPlanPoint;
  readonly height: number;
  readonly thickness: number;
  readonly length: number;
  readonly yawRad: number;
  readonly openings: readonly {
    readonly type: "door" | "window";
    readonly t: number;
    readonly width: number;
    readonly height: number;
    readonly sillHeight: number;
  }[];
}

export interface StudioFloorPlanBuildResult {
  readonly revision: typeof STUDIO_BUILD_GENERATORS_REVISION;
  readonly walls: readonly StudioGeneratedWallSegment[];
  readonly roomsDetected: number;
  readonly floorPolygon: readonly StudioFloorPlanPoint[];
}

export function buildStudioWallsFromFloorPlan(
  request: StudioFloorPlanWallRequest,
): StudioFloorPlanBuildResult {
  const pts = request.points;
  if (pts.length < 2) {
    return {
      revision: STUDIO_BUILD_GENERATORS_REVISION,
      walls: [],
      roomsDetected: 0,
      floorPolygon: [],
    };
  }
  const segs: StudioGeneratedWallSegment[] = [];
  const count = request.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const openings = (request.defaultOpenings ?? [])
      .filter((o) => o.segmentIndex === i)
      .map((o) => ({
        type: o.type,
        t: Math.max(0, Math.min(1, o.t)),
        width: o.width,
        height: o.height,
        sillHeight: o.sillHeight,
      }));
    segs.push({
      id: `wall-${i}`,
      start: a,
      end: b,
      height: request.wallHeight,
      thickness: request.wallThickness,
      length,
      yawRad: Math.atan2(dz, dx),
      openings,
    });
  }
  const floorPolygon = request.closed ? [...pts] : [];
  return {
    revision: STUDIO_BUILD_GENERATORS_REVISION,
    walls: segs,
    roomsDetected: request.closed && pts.length >= 3 ? 1 : 0,
    floorPolygon,
  };
}

export interface StudioStairGeneratorInput {
  readonly steps: number;
  readonly rise: number;
  readonly run: number;
  readonly width: number;
  readonly landing?: boolean;
  readonly origin?: readonly [number, number, number];
}

export interface StudioStairStepPart {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

export interface StudioStairGeneratorResult {
  readonly steps: readonly StudioStairStepPart[];
  readonly totalRise: number;
  readonly totalRun: number;
  readonly landing: StudioStairStepPart | null;
}

export function generateStudioStairs(
  input: StudioStairGeneratorInput,
): StudioStairGeneratorResult {
  const stepsN = Math.max(1, Math.min(64, Math.trunc(input.steps)));
  const rise = Math.max(0.05, input.rise);
  const run = Math.max(0.05, input.run);
  const width = Math.max(0.3, input.width);
  const ox = input.origin?.[0] ?? 0;
  const oy = input.origin?.[1] ?? 0;
  const oz = input.origin?.[2] ?? 0;
  const steps: StudioStairStepPart[] = [];
  for (let i = 0; i < stepsN; i += 1) {
    steps.push({
      id: `step-${i}`,
      position: [ox + run * (i + 0.5), oy + rise * (i + 0.5), oz],
      size: [run, rise, width],
    });
  }
  let landing: StudioStairStepPart | null = null;
  if (input.landing) {
    landing = {
      id: "landing",
      position: [ox + run * stepsN + width * 0.5, oy + rise * stepsN, oz],
      size: [width, rise * 0.5, width],
    };
  }
  return {
    steps,
    totalRise: rise * stepsN,
    totalRun: run * stepsN,
    landing,
  };
}

export interface StudioSlabGeneratorInput {
  readonly polygon: readonly StudioFloorPlanPoint[];
  readonly elevation: number;
  readonly thickness: number;
  readonly kind: "floor" | "ceiling" | "trim";
}

export interface StudioSlabPart {
  readonly id: string;
  readonly kind: "floor" | "ceiling" | "trim";
  readonly polygon: readonly StudioFloorPlanPoint[];
  readonly elevation: number;
  readonly thickness: number;
  readonly area: number;
}

function polygonArea(poly: readonly StudioFloorPlanPoint[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) * 0.5;
}

export function generateStudioSlab(input: StudioSlabGeneratorInput): StudioSlabPart | null {
  if (input.polygon.length < 3) return null;
  return {
    id: `${input.kind}-slab`,
    kind: input.kind,
    polygon: input.polygon,
    elevation: input.elevation,
    thickness: input.thickness,
    area: polygonArea(input.polygon),
  };
}

export type StudioLengthUnit = "m" | "cm" | "mm" | "ft" | "in";

export interface StudioDimensionAnnotation {
  readonly id: string;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly lengthMeters: number;
  readonly display: string;
  readonly unit: StudioLengthUnit;
  readonly precision: number;
}

/**
 * BLD-004: Offset a closed 2D face polygon by distance (outward positive).
 * Resolves simple self-intersection by clamping to a minimum edge length.
 */
export function offsetStudioFloorPlanPolygon(
  points: readonly StudioFloorPlanPoint[],
  distance: number,
): {
  readonly ok: true;
  readonly polygon: readonly StudioFloorPlanPoint[];
  readonly selfIntersectionResolved: boolean;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  if (points.length < 3) return { ok: false, reason: "need ≥3 points" };
  if (!Number.isFinite(distance)) return { ok: false, reason: "invalid distance" };
  // Compute signed area for winding
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    area += p.x * q.z - q.x * p.z;
  }
  const sign = area >= 0 ? 1 : -1;
  const out: StudioFloorPlanPoint[] = [];
  let resolved = false;
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i + points.length - 1) % points.length]!;
    const cur = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const e1x = cur.x - prev.x;
    const e1z = cur.z - prev.z;
    const e2x = next.x - cur.x;
    const e2z = next.z - cur.z;
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    // Outward normals (perpendicular)
    const n1x = (sign * -e1z) / l1;
    const n1z = (sign * e1x) / l1;
    const n2x = (sign * -e2z) / l2;
    const n2z = (sign * e2x) / l2;
    let nx = n1x + n2x;
    let nz = n1z + n2z;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-8) {
      nx = n1x;
      nz = n1z;
    } else {
      nx /= nl;
      nz /= nl;
    }
    // Miter scale
    const miter = Math.min(4, 1 / Math.max(0.25, (n1x * nx + n1z * nz)));
    const ox = cur.x + nx * distance * miter;
    const oz = cur.z + nz * distance * miter;
    if (out.length > 0) {
      const last = out[out.length - 1]!;
      if (Math.hypot(ox - last.x, oz - last.z) < 1e-4) {
        resolved = true;
        continue;
      }
    }
    out.push({ x: ox, z: oz });
  }
  if (out.length < 3) return { ok: false, reason: "offset collapsed" };
  return { ok: true, polygon: out, selfIntersectionResolved: resolved };
}

export function createStudioDimension(
  id: string,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  unit: StudioLengthUnit = "m",
  precision = 2,
): StudioDimensionAnnotation {
  const meters = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const factor =
    unit === "m" ? 1
      : unit === "cm" ? 100
        : unit === "mm" ? 1000
          : unit === "ft" ? 1 / 0.3048
            : 1 / 0.0254;
  const value = meters * factor;
  const display = `${value.toFixed(Math.max(0, Math.min(6, precision)))} ${unit}`;
  return {
    id,
    a,
    b,
    lengthMeters: meters,
    display,
    unit,
    precision,
  };
}
