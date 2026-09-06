/**
 * CAD-019 BIM → Room Builder mapping.
 * Parses IFC cartesian points + entity counts into floor-plan walls with
 * placement/size/openings and a StudioBg3dRoomSpec consumable by room builder.
 */

import {
  buildStudioWallsFromFloorPlan,
  type StudioFloorPlanBuildResult,
  type StudioFloorPlanPoint,
} from "./studio-build-generators";
import { importStudioIfcShell } from "./studio-mesh-format-adapters";

import type { StudioBg3dRoomOpening, StudioBg3dRoomSpec } from "./bg3d/studio-bg3d-room-builder";

export const STUDIO_BIM_ROOM_MAP_REVISION = 2 as const;

export type StudioBimRoomPart = {
  readonly id: string;
  readonly kind: "wall" | "slab" | "door" | "window" | "space" | "column" | "beam" | "floor";
  readonly name: string;
  /** World placement (meters). */
  readonly position: readonly [number, number, number];
  /** Size extents (meters): length, height, thickness or footprint. */
  readonly size: readonly [number, number, number];
  readonly yawRad: number;
  readonly openings: readonly {
    readonly type: "door" | "window";
    readonly t: number;
    readonly width: number;
    readonly height: number;
    readonly sillHeight: number;
  }[];
};

function convexHullXZ(points: readonly StudioFloorPlanPoint[]): StudioFloorPlanPoint[] {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  const cross = (o: StudioFloorPlanPoint, a: StudioFloorPlanPoint, b: StudioFloorPlanPoint) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: StudioFloorPlanPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: StudioFloorPlanPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function floorPointsFromIfcCartesian(ifcText: string): StudioFloorPlanPoint[] {
  const points: StudioFloorPlanPoint[] = [];
  const re = /IFCCARTESIANPOINT\s*\(\s*\(([^)]+)\)/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ifcText)) !== null) {
    const nums = m[1]!.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (nums.length >= 2) {
      points.push({ x: nums[0]!, z: nums[nums.length >= 3 ? 2 : 1]! });
    }
  }
  return points;
}

/**
 * Map IFC STEP-physical text → Room Builder walls/openings with real placement geometry.
 */
export function mapStudioBimIfcToRoomBuilder(ifcText: string): {
  readonly revision: typeof STUDIO_BIM_ROOM_MAP_REVISION;
  readonly parts: readonly StudioBimRoomPart[];
  readonly floorPlan: StudioFloorPlanBuildResult;
  readonly roomSpec: StudioBg3dRoomSpec;
  readonly spaces: number;
  readonly walls: number;
  readonly slabs: number;
  readonly doors: number;
  readonly windows: number;
  readonly meshCount: number;
  readonly pointCount: number;
  /** Sum of wall segment lengths (meters) — geometry evidence, not entity echo. */
  readonly totalWallLength: number;
  /** Opening area sum (m²). */
  readonly openingArea: number;
} {
  const imported = importStudioIfcShell(ifcText);
  const extras = imported.extras ?? {};
  const cart = floorPointsFromIfcCartesian(ifcText);
  let hull = convexHullXZ(cart);
  if (hull.length < 3) {
    // Fallback rectangle from AABB of points or unit room
    let minX = 0, maxX = 4, minZ = 0, maxZ = 3;
    if (cart.length) {
      minX = Math.min(...cart.map((p) => p.x));
      maxX = Math.max(...cart.map((p) => p.x));
      minZ = Math.min(...cart.map((p) => p.z));
      maxZ = Math.max(...cart.map((p) => p.z));
      if (maxX - minX < 0.5) maxX = minX + 4;
      if (maxZ - minZ < 0.5) maxZ = minZ + 3;
    }
    hull = [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: maxX, z: maxZ },
      { x: minX, z: maxZ },
    ];
  }

  const doorCount = Number(extras.doorCount ?? 0);
  const windowCount = Number(extras.windowCount ?? 0);
  const slabCount = Number(extras.slabCount ?? 0);
  const spaceNames = (extras.spaces as string[] | undefined) ?? [];

  // Distribute doors/windows along wall segments by index
  const defaultOpenings: {
    segmentIndex: number;
    type: "door" | "window";
    t: number;
    width: number;
    height: number;
    sillHeight: number;
  }[] = [];
  const segN = hull.length;
  for (let i = 0; i < doorCount; i += 1) {
    defaultOpenings.push({
      segmentIndex: i % segN,
      type: "door",
      t: 0.3 + (i % 3) * 0.15,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
    });
  }
  for (let i = 0; i < windowCount; i += 1) {
    defaultOpenings.push({
      segmentIndex: (i + 1) % segN,
      type: "window",
      t: 0.5 + (i % 2) * 0.1,
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
    });
  }

  const wallHeight = 2.7;
  const wallThickness = 0.2;
  const floorPlan = buildStudioWallsFromFloorPlan({
    points: hull,
    closed: true,
    wallHeight,
    wallThickness,
    defaultOpenings,
  });

  // Prefer generated walls; if wallCount claims more, keep geometry from floor plan (truth is hull)
  const parts: StudioBimRoomPart[] = [];
  let totalWallLength = 0;
  let openingArea = 0;
  for (const w of floorPlan.walls) {
    totalWallLength += w.length;
    const midX = (w.start.x + w.end.x) / 2;
    const midZ = (w.start.z + w.end.z) / 2;
    const opens = w.openings.map((o) => {
      openingArea += o.width * o.height;
      return o;
    });
    parts.push({
      id: w.id,
      kind: "wall",
      name: w.id,
      position: [midX, w.height / 2, midZ],
      size: [w.length, w.height, w.thickness],
      yawRad: w.yawRad,
      openings: opens,
    });
  }

  // Floor slab from polygon AABB
  if (floorPlan.floorPolygon.length >= 3 || slabCount > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of floorPlan.floorPolygon.length ? floorPlan.floorPolygon : hull) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    parts.push({
      id: "floor-0",
      kind: "slab",
      name: "Floor",
      position: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
      size: [maxX - minX, 0.2, maxZ - minZ],
      yawRad: 0,
      openings: [],
    });
  }

  spaceNames.forEach((name, i) => {
    parts.push({
      id: `space-${i}`,
      kind: "space",
      name,
      position: [0, wallHeight / 2, 0],
      size: [totalWallLength / Math.max(1, floorPlan.walls.length), wallHeight, 1],
      yawRad: 0,
      openings: [],
    });
  });

  // Room builder openings in wall-id space (N/S/E/W heuristic from yaw)
  const openings: StudioBg3dRoomOpening[] = [];
  for (const w of floorPlan.walls) {
    const wallId =
      Math.abs(Math.cos(w.yawRad)) > Math.abs(Math.sin(w.yawRad))
        ? w.yawRad > 0
          ? "east"
          : "west"
        : w.yawRad > 0
          ? "south"
          : "north";
    for (const o of w.openings) {
      openings.push({
        wall: wallId as StudioBg3dRoomOpening["wall"],
        type: o.type,
        centerOffset: (o.t - 0.5) * w.length,
        width: o.width,
        height: o.height,
        sillHeight: o.sillHeight,
      });
    }
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of hull) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const roomSpec: StudioBg3dRoomSpec = {
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxZ - minZ),
    wallHeight,
    wallThickness,
    floorColor: "#e8e4dc",
    wallColor: "#f5f0e6",
    openings,
    furniture: [],
  };

  return {
    revision: STUDIO_BIM_ROOM_MAP_REVISION,
    parts,
    floorPlan,
    roomSpec,
    spaces: spaceNames.length,
    walls: floorPlan.walls.length,
    slabs: parts.filter((p) => p.kind === "slab").length,
    doors: doorCount,
    windows: windowCount,
    meshCount: imported.meshes.length,
    pointCount: cart.length,
    totalWallLength,
    openingArea,
  };
}
