/**
 * Advanced mesh ops — P2/P3 catalog (MOD-008/009/017–021/025, retopo snap lite).
 * Pure half-edge / triangle-soup algorithms; no Three.js.
 */

import {
  createStudioEditableMeshFromPolygons,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";
import { fillHoleStudioEditableMesh } from "./studio-mesh-ops-modeling";

export const STUDIO_MESH_OPS_ADVANCED_REVISION = 2 as const;

const MAX_OPS_VERTICES = 200_000 as const;
const MAX_OPS_INDICES = 1_200_000 as const;

export type StudioMeshOpsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function ok<T>(value: T): StudioMeshOpsResult<T> {
  return { ok: true, value };
}
function fail<T>(code: string, detail: string): StudioMeshOpsResult<T> {
  return { ok: false, code, detail };
}

function v(x: number, y: number, z: number): StudioMeshVec3 {
  return { x, y, z };
}

function soupToMesh(
  positions: Float32Array,
  indices: Uint32Array,
): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    verts.push(v(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  }
  const faces: number[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

export { knifeStudioEditableMesh } from "./studio-editable-half-edge-mesh";

/** MOD-008: bisect mesh by plane (ax+by+cz+d=0), keep positive side. */
export function bisectStudioEditableMesh(
  mesh: StudioEditableMesh,
  plane: { readonly a: number; readonly b: number; readonly c: number; readonly d: number },
): StudioMeshOpsResult<StudioEditableMesh> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions: number[] = [];
  const indices: number[] = [];
  const map = new Map<number, number>();
  const side = (i: number) => {
    const x = soup.positions[i * 3]!;
    const y = soup.positions[i * 3 + 1]!;
    const z = soup.positions[i * 3 + 2]!;
    return plane.a * x + plane.b * y + plane.c * z + plane.d;
  };
  const ensure = (i: number) => {
    let n = map.get(i);
    if (n !== undefined) return n;
    n = positions.length / 3;
    map.set(i, n);
    positions.push(
      soup.positions[i * 3]!,
      soup.positions[i * 3 + 1]!,
      soup.positions[i * 3 + 2]!,
    );
    return n;
  };
  for (let t = 0; t < soup.indices.length; t += 3) {
    const ia = soup.indices[t]!;
    const ib = soup.indices[t + 1]!;
    const ic = soup.indices[t + 2]!;
    const sa = side(ia);
    const sb = side(ib);
    const sc = side(ic);
    // Keep triangle if centroid is on positive half-space
    if ((sa + sb + sc) / 3 >= -1e-9) {
      indices.push(ensure(ia), ensure(ib), ensure(ic));
    }
  }
  if (indices.length === 0) return fail("empty", "bisect removed all faces");
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

/** MOD-009: bridge two face loops by index lists (equal length). */
export function bridgeStudioFaceLoops(
  mesh: StudioEditableMesh,
  loopA: readonly number[],
  loopB: readonly number[],
): StudioMeshOpsResult<StudioEditableMesh> {
  if (loopA.length < 3 || loopA.length !== loopB.length) {
    return fail("invalid", "loops need equal length ≥3");
  }
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions = [...soup.positions];
  const indices = [...soup.indices];
  const n = loopA.length;
  for (let i = 0; i < n; i += 1) {
    const a0 = loopA[i]!;
    const a1 = loopA[(i + 1) % n]!;
    const b0 = loopB[i]!;
    const b1 = loopB[(i + 1) % n]!;
    indices.push(a0, a1, b1, a0, b1, b0);
  }
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

/** MOD-017: Catmull-Clark-inspired one step on triangle mesh (linear midpoints + average). */
export function subdivideStudioMeshCatmullLite(
  mesh: StudioEditableMesh,
  iterations = 1,
): StudioMeshOpsResult<StudioEditableMesh> {
  let current = mesh;
  const count = Math.max(0, Math.min(3, Math.trunc(iterations)));
  for (let iter = 0; iter < count; iter += 1) {
    const soup = studioEditableMeshToTriangleSoup(current);
    const vCount = soup.positions.length / 3;
    const edgeMid = new Map<string, number>();
    const positions: number[] = [...soup.positions];
    const midOf = (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}|${hi}`;
      let idx = edgeMid.get(key);
      if (idx !== undefined) return idx;
      idx = positions.length / 3;
      positions.push(
        (soup.positions[a * 3]! + soup.positions[b * 3]!) / 2,
        (soup.positions[a * 3 + 1]! + soup.positions[b * 3 + 1]!) / 2,
        (soup.positions[a * 3 + 2]! + soup.positions[b * 3 + 2]!) / 2,
      );
      edgeMid.set(key, idx);
      return idx;
    };
    const indices: number[] = [];
    for (let t = 0; t < soup.indices.length; t += 3) {
      const a = soup.indices[t]!;
      const b = soup.indices[t + 1]!;
      const c = soup.indices[t + 2]!;
      const ab = midOf(a, b);
      const bc = midOf(b, c);
      const ca = midOf(c, a);
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    // Smooth original vertices toward neighbor average (CC-lite)
    const accum = new Float32Array(vCount * 3);
    const degree = new Uint32Array(vCount);
    for (let t = 0; t < soup.indices.length; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const i = soup.indices[t + k]!;
        const j = soup.indices[t + ((k + 1) % 3)]!;
        accum[i * 3]! += soup.positions[j * 3]!;
        accum[i * 3 + 1]! += soup.positions[j * 3 + 1]!;
        accum[i * 3 + 2]! += soup.positions[j * 3 + 2]!;
        degree[i]! += 1;
      }
    }
    for (let i = 0; i < vCount; i += 1) {
      if (degree[i]! === 0) continue;
      const nx = accum[i * 3]! / degree[i]!;
      const ny = accum[i * 3 + 1]! / degree[i]!;
      const nz = accum[i * 3 + 2]! / degree[i]!;
      positions[i * 3] = soup.positions[i * 3]! * 0.5 + nx * 0.5;
      positions[i * 3 + 1] = soup.positions[i * 3 + 1]! * 0.5 + ny * 0.5;
      positions[i * 3 + 2] = soup.positions[i * 3 + 2]! * 0.5 + nz * 0.5;
    }
    current = soupToMesh(new Float32Array(positions), new Uint32Array(indices));
  }
  return ok(current);
}

/**
 * MOD-018: deterministic shortest-edge-collapse decimation.
 *
 * Exact-position welding first, then union-find merges of the shortest edges until the logical
 * vertex count approaches the requested ratio. Degenerate faces are dropped on rebuild, so the
 * result keeps a connected shell instead of punching stride holes.
 */
export function decimateStudioMesh(
  mesh: StudioEditableMesh,
  ratio: number,
): StudioMeshOpsResult<StudioEditableMesh> {
  const r = Math.max(0.05, Math.min(1, ratio));
  if (r >= 0.999) return ok(mesh);
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const soupVertexCount = soup.positions.length / 3;
  if (soupVertexCount > MAX_OPS_VERTICES || soup.indices.length > MAX_OPS_INDICES) {
    return fail("budget-exceeded", "mesh exceeds decimate budgets");
  }
  const q = 1e5;
  const weldKeyOf = (i: number) =>
    `${Math.round(soup.positions[i * 3]! * q)}|${Math.round(soup.positions[i * 3 + 1]! * q)}|${Math.round(soup.positions[i * 3 + 2]! * q)}`;
  const weldIndex = new Map<string, number>();
  const remap = new Int32Array(soupVertexCount);
  let logicalCount = 0;
  for (let i = 0; i < soupVertexCount; i += 1) {
    const key = weldKeyOf(i);
    let target = weldIndex.get(key);
    if (target === undefined) {
      target = logicalCount;
      logicalCount += 1;
      weldIndex.set(key, target);
    }
    remap[i] = target;
  }
  const positions = new Float64Array(logicalCount * 3);
  for (let i = 0; i < soupVertexCount; i += 1) {
    const t = remap[i]!;
    positions[t * 3] = soup.positions[i * 3]!;
    positions[t * 3 + 1] = soup.positions[i * 3 + 1]!;
    positions[t * 3 + 2] = soup.positions[i * 3 + 2]!;
  }
  const tris: number[] = [];
  for (let t = 0; t < soup.indices.length; t += 3) {
    const a = remap[soup.indices[t]!]!;
    const b = remap[soup.indices[t + 1]!]!;
    const c = remap[soup.indices[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }
  if (tris.length < 3) return fail("empty", "mesh has no usable triangles");

  interface CollapseEdge {
    readonly a: number;
    readonly b: number;
    readonly lengthSquared: number;
  }
  const seenEdge = new Set<string>();
  const edges: CollapseEdge[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = tris[t + k]!;
      const b = tris[t + ((k + 1) % 3)]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}|${hi}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      const dx = positions[hi * 3]! - positions[lo * 3]!;
      const dy = positions[hi * 3 + 1]! - positions[lo * 3 + 1]!;
      const dz = positions[hi * 3 + 2]! - positions[lo * 3 + 2]!;
      edges.push({
        a: lo,
        b: hi,
        lengthSquared: dx * dx + dy * dy + dz * dz,
      });
    }
  }
  edges.sort((left, right) =>
    left.lengthSquared - right.lengthSquared
    || left.a - right.a
    || left.b - right.b
  );

  const minRoots = 4;
  const minSurvivors = Math.max(minRoots, Math.floor(tris.length / 3 * r));
  const targetRoots = Math.max(minRoots, Math.ceil(logicalCount * r));
  const parent = new Int32Array(logicalCount);
  for (let i = 0; i < logicalCount; i += 1) parent[i] = i;
  const findRoot = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root]!;
    let cursor = start;
    while (parent[cursor] !== cursor) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const triCountTotal = tris.length / 3;
  const alive = new Uint8Array(triCountTotal).fill(1);
  let aliveCount = triCountTotal;
  const vertTris: number[][] = Array.from(
    { length: logicalCount },
    () => [] as number[],
  );
  for (let t = 0; t < triCountTotal; t += 1) {
    for (let k = 0; k < 3; k += 1) vertTris[tris[t * 3 + k]!]!.push(t);
  }
  const cornerRootIs = (t: number, root: number): boolean =>
    findRoot(tris[t * 3]!) === root
    || findRoot(tris[t * 3 + 1]!) === root
    || findRoot(tris[t * 3 + 2]!) === root;

  let roots = logicalCount;
  for (const edge of edges) {
    if (roots <= targetRoots) break;
    const ra = findRoot(edge.a);
    const rb = findRoot(edge.b);
    if (ra === rb) continue;
    // Collapsing this edge kills the live triangles that span both endpoints.
    let dying = 0;
    let firstOpposite = -1;
    let secondOpposite = -1;
    for (const t of vertTris[rb]!) {
      if (alive[t] !== 1 || !cornerRootIs(t, ra)) continue;
      dying += 1;
      // Opposite corner of rb inside this triangle.
      const corners = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
      const opposite = corners.find((corner) => {
        const root = findRoot(corner);
        return root !== ra && root !== rb;
      });
      if (opposite === undefined) {
        dying = Number.MAX_SAFE_INTEGER;
        break;
      }
      if (firstOpposite < 0) firstOpposite = findRoot(opposite);
      else secondOpposite = findRoot(opposite);
    }
    // Link-condition shortcut: only interior edges with exactly two live incident
    // triangles and two distinct opposite vertices collapse safely.
    if (dying !== 2 || firstOpposite === secondOpposite) continue;
    if (aliveCount - dying < minSurvivors) continue;
    // Midpoint placement keeps the shell centered where detail is removed.
    positions[ra * 3] = (positions[ra * 3]! + positions[rb * 3]!) / 2;
    positions[ra * 3 + 1] = (positions[ra * 3 + 1]! + positions[rb * 3 + 1]!) / 2;
    positions[ra * 3 + 2] = (positions[ra * 3 + 2]! + positions[rb * 3 + 2]!) / 2;
    parent[rb] = ra;
    for (const t of vertTris[rb]!) {
      if (alive[t] === 1 && cornerRootIs(t, ra)) {
        alive[t] = 0;
        aliveCount -= 1;
      }
    }
    vertTris[ra]!.push(...vertTris[rb]!);
    vertTris[rb] = [];
    roots -= 1;
  }

  const rootToOutput = new Map<number, number>();
  const outPositions: number[] = [];
  const outIndices: number[] = [];
  for (let t = 0; t < triCountTotal; t += 1) {
    if (alive[t] === 0) continue;
    const mapped: number[] = [];
    let degenerate = false;
    for (let k = 0; k < 3; k += 1) {
      const root = findRoot(tris[t * 3 + k]!);
      let index = rootToOutput.get(root);
      if (index === undefined) {
        index = outPositions.length / 3;
        rootToOutput.set(root, index);
        outPositions.push(positions[root * 3]!, positions[root * 3 + 1]!, positions[root * 3 + 2]!);
      }
      if (mapped.includes(index)) {
        degenerate = true;
        break;
      }
      mapped.push(index);
    }
    if (!degenerate) outIndices.push(mapped[0]!, mapped[1]!, mapped[2]!);
  }
  if (outIndices.length < 3) return fail("empty", "decimate removed every face");
  // Collapse shortcuts can pinch a corner open on irregular valence — cap any boundary loop
  // so the decimated shell stays closed.
  const rebuilt = soupToMesh(new Float32Array(outPositions), new Uint32Array(outIndices));
  const capped = fillHoleStudioEditableMesh(rebuilt);
  return capped.ok ? capped : ok(rebuilt);
}

/** MOD-020: simple bend deform along Y axis. */
export function deformStudioMeshBend(
  mesh: StudioEditableMesh,
  angleRad: number,
  axis: "x" | "y" | "z" = "y",
): StudioMeshOpsResult<StudioEditableMesh> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions = new Float32Array(soup.positions);
  const n = positions.length / 3;
  let minA = Infinity;
  let maxA = -Infinity;
  const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  for (let i = 0; i < n; i += 1) {
    const a = positions[i * 3 + ai]!;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
  }
  const span = Math.max(1e-6, maxA - minA);
  for (let i = 0; i < n; i += 1) {
    const t = (positions[i * 3 + ai]! - minA) / span;
    const ang = angleRad * t;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    if (axis === "y") {
      const x = positions[i * 3]!;
      const z = positions[i * 3 + 2]!;
      positions[i * 3] = x * c - z * s;
      positions[i * 3 + 2] = x * s + z * c;
    } else if (axis === "x") {
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      positions[i * 3 + 1] = y * c - z * s;
      positions[i * 3 + 2] = y * s + z * c;
    } else {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      positions[i * 3] = x * c - y * s;
      positions[i * 3 + 1] = x * s + y * c;
    }
  }
  return ok(soupToMesh(positions, soup.indices));
}

/** MOD-021: shrinkwrap toward a target point (offset). */
export function shrinkwrapStudioMesh(
  mesh: StudioEditableMesh,
  target: StudioMeshVec3,
  factor: number,
): StudioMeshOpsResult<StudioEditableMesh> {
  const f = Math.max(0, Math.min(1, factor));
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions = new Float32Array(soup.positions);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i]! + (target.x - positions[i]!) * f;
    positions[i + 1] = positions[i + 1]! + (target.y - positions[i + 1]!) * f;
    positions[i + 2] = positions[i + 2]! + (target.z - positions[i + 2]!) * f;
  }
  return ok(soupToMesh(positions, soup.indices));
}

/**
 * Flip triangle winding so face normals point outward relative to the mesh
 * centroid (Manifold/CSG friendly). Counts how many faces were reversed.
 */
export function orientStudioMeshOutward(
  mesh: StudioEditableMesh,
): StudioMeshOpsResult<{
  readonly mesh: StudioEditableMesh;
  readonly flippedFaces: number;
  readonly faceCount: number;
}> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const vCount = soup.positions.length / 3;
  if (vCount < 3 || soup.indices.length < 3) {
    return fail("empty-mesh", "need triangles to orient");
  }
  for (let i = 0; i < soup.positions.length; i += 3) {
    cx += soup.positions[i]!;
    cy += soup.positions[i + 1]!;
    cz += soup.positions[i + 2]!;
  }
  cx /= vCount;
  cy /= vCount;
  cz /= vCount;
  const indices = new Uint32Array(soup.indices);
  let flipped = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;
    const ax = soup.positions[i0 * 3]!;
    const ay = soup.positions[i0 * 3 + 1]!;
    const az = soup.positions[i0 * 3 + 2]!;
    const bx = soup.positions[i1 * 3]!;
    const by = soup.positions[i1 * 3 + 1]!;
    const bz = soup.positions[i1 * 3 + 2]!;
    const cxv = soup.positions[i2 * 3]!;
    const cyv = soup.positions[i2 * 3 + 1]!;
    const czv = soup.positions[i2 * 3 + 2]!;
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cxv - ax;
    const acy = cyv - ay;
    const acz = czv - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const mx = (ax + bx + cxv) / 3 - cx;
    const my = (ay + by + cyv) / 3 - cy;
    const mz = (az + bz + czv) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0) {
      indices[t + 1] = i2;
      indices[t + 2] = i1;
      flipped += 1;
    }
  }
  return ok({
    mesh: soupToMesh(soup.positions, indices),
    flippedFaces: flipped,
    faceCount: indices.length / 3,
  });
}

/** MOD-025: mesh repair — drop degenerate triangles and re-weld by quantum. */
export function repairStudioMesh(
  mesh: StudioEditableMesh,
  quantum = 1e-5,
): StudioMeshOpsResult<{
  readonly mesh: StudioEditableMesh;
  readonly removedTriangles: number;
  readonly report: readonly string[];
}> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const keyOf = (i: number) => {
    const q = 1 / quantum;
    return `${Math.round(soup.positions[i * 3]! * q)}|${Math.round(soup.positions[i * 3 + 1]! * q)}|${Math.round(soup.positions[i * 3 + 2]! * q)}`;
  };
  const map = new Map<string, number>();
  const positions: number[] = [];
  const remap = (i: number) => {
    const key = keyOf(i);
    let n = map.get(key);
    if (n !== undefined) return n;
    n = positions.length / 3;
    map.set(key, n);
    positions.push(
      soup.positions[i * 3]!,
      soup.positions[i * 3 + 1]!,
      soup.positions[i * 3 + 2]!,
    );
    return n;
  };
  const indices: number[] = [];
  let removed = 0;
  for (let t = 0; t < soup.indices.length; t += 3) {
    const a = remap(soup.indices[t]!);
    const b = remap(soup.indices[t + 1]!);
    const c = remap(soup.indices[t + 2]!);
    if (a === b || b === c || a === c) {
      removed += 1;
      continue;
    }
    indices.push(a, b, c);
  }
  const out = soupToMesh(new Float32Array(positions), new Uint32Array(indices));
  return ok({
    mesh: out,
    removedTriangles: removed,
    report: [
      `welded vertices → ${positions.length / 3}`,
      `removed degenerate tris ${removed}`,
      `faces ${studioEditableMeshStats(out).faceCount}`,
    ],
  });
}

/** MOD-022 lite: project vertices onto a plane (retopo snap surface). */
export function retopoSnapStudioMeshToPlane(
  mesh: StudioEditableMesh,
  planePoint: StudioMeshVec3,
  planeNormal: StudioMeshVec3,
): StudioMeshOpsResult<StudioEditableMesh> {
  const len = Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z) || 1;
  const nx = planeNormal.x / len;
  const ny = planeNormal.y / len;
  const nz = planeNormal.z / len;
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions = new Float32Array(soup.positions);
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - planePoint.x;
    const dy = positions[i + 1]! - planePoint.y;
    const dz = positions[i + 2]! - planePoint.z;
    const dist = dx * nx + dy * ny + dz * nz;
    positions[i] = positions[i]! - nx * dist;
    positions[i + 1] = positions[i + 1]! - ny * dist;
    positions[i + 2] = positions[i + 2]! - nz * dist;
  }
  return ok(soupToMesh(positions, soup.indices));
}

// ---------------------------------------------------------------------------
// SCP-006 dynatopo, SCP-011 auto-retopo, SCP-014 bake maps
// ---------------------------------------------------------------------------

/**
 * SCP-006: brush-local refine and crack-free coarsen.
 *
 * Refine uses red-green adaptive mid-split so partial brush coverage never
 * leaves T-junctions: seed faces near the brush get 1→4; unmarked faces with
 * ≥2 split edges are promoted until stable; remaining 1-edge neighbors bisect
 * 1→2. Shared mid vertices keep manifold topology on closed input.
 *
 * Coarsen collapses the shortest internal edge among near triangles.
 */
export function dynatopoStudioMeshBrushLocal(
  mesh: StudioEditableMesh,
  brush: { readonly center: StudioMeshVec3; readonly radius: number },
  mode: "refine" | "coarsen" = "refine",
): StudioMeshOpsResult<{
  readonly mesh: StudioEditableMesh;
  readonly affectedTris: number;
  readonly facesBefore: number;
  readonly facesAfter: number;
  readonly boundaryEdges: number;
  /** Boundary edge count of the input mesh (for closed-mesh honesty). */
  readonly boundaryEdgesBefore: number;
}> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const facesBefore = soup.indices.length / 3;
  const r2 = brush.radius * brush.radius;
  const ekey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const triCentroidNear = (t: number, positions: ArrayLike<number>, indices: ArrayLike<number>) => {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k += 1) {
      const vi = indices[t * 3 + k]!;
      cx += positions[vi * 3]!;
      cy += positions[vi * 3 + 1]!;
      cz += positions[vi * 3 + 2]!;
    }
    cx /= 3; cy /= 3; cz /= 3;
    const dx = cx - brush.center.x;
    const dy = cy - brush.center.y;
    const dz = cz - brush.center.z;
    return dx * dx + dy * dy + dz * dz <= r2;
  };

  const countBoundaryEdges = (indices: ArrayLike<number>, triCount: number): number => {
    const edgeUse = new Map<string, number>();
    for (let t = 0; t < triCount; t += 1) {
      const i0 = indices[t * 3]!;
      const i1 = indices[t * 3 + 1]!;
      const i2 = indices[t * 3 + 2]!;
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
        const k = ekey(a, b);
        edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
      }
    }
    let boundary = 0;
    for (const c of edgeUse.values()) if (c === 1) boundary += 1;
    return boundary;
  };

  const boundaryEdgesBefore = countBoundaryEdges(soup.indices, facesBefore);

  if (mode === "coarsen") {
    // Edge-collapse coarsen: collapse shortest internal edge whose midpoint is near brush.
    type EdgeRec = { a: number; b: number; len: number; faces: number[] };
    const edgeMap = new Map<string, EdgeRec>();
    for (let t = 0; t < facesBefore; t += 1) {
      const ids = [soup.indices[t * 3]!, soup.indices[t * 3 + 1]!, soup.indices[t * 3 + 2]!];
      for (let e = 0; e < 3; e += 1) {
        const a = ids[e]!;
        const b = ids[(e + 1) % 3]!;
        const k = ekey(a, b);
        let rec = edgeMap.get(k);
        if (!rec) {
          const dx = soup.positions[a * 3]! - soup.positions[b * 3]!;
          const dy = soup.positions[a * 3 + 1]! - soup.positions[b * 3 + 1]!;
          const dz = soup.positions[a * 3 + 2]! - soup.positions[b * 3 + 2]!;
          rec = { a: Math.min(a, b), b: Math.max(a, b), len: Math.hypot(dx, dy, dz), faces: [] };
          edgeMap.set(k, rec);
        }
        rec.faces.push(t);
      }
    }
    let best: EdgeRec | null = null;
    for (const rec of edgeMap.values()) {
      if (rec.faces.length !== 2) continue; // only internal edges (manifold collapse)
      if (!rec.faces.every((t) => triCentroidNear(t, soup.positions, soup.indices))) continue;
      if (!best || rec.len < best.len) best = rec;
    }
    if (!best) {
      // No safe collapse — return mesh unchanged (crack-free no-op)
      return ok({
        mesh,
        affectedTris: 0,
        facesBefore,
        facesAfter: facesBefore,
        boundaryEdges: boundaryEdgesBefore,
        boundaryEdgesBefore,
      });
    }
    // Collapse b → a: drop the two faces using the edge; remap remaining b → a
    const drop = new Set(best.faces);
    const remap = (v: number) => (v === best!.b ? best!.a : v);
    const newIndices: number[] = [];
    let affected = 0;
    for (let t = 0; t < facesBefore; t += 1) {
      if (drop.has(t)) {
        affected += 1;
        continue;
      }
      const i0 = remap(soup.indices[t * 3]!);
      const i1 = remap(soup.indices[t * 3 + 1]!);
      const i2 = remap(soup.indices[t * 3 + 2]!);
      if (i0 === i1 || i1 === i2 || i2 === i0) continue; // degenerate after collapse
      newIndices.push(i0, i1, i2);
    }
    if (newIndices.length < 3) return fail("empty", "dynatopo coarsen removed all");
    const out = soupToMesh(soup.positions, new Uint32Array(newIndices));
    const facesAfter = newIndices.length / 3;
    return ok({
      mesh: out,
      affectedTris: affected,
      facesBefore,
      facesAfter,
      boundaryEdges: countBoundaryEdges(newIndices, facesAfter),
      boundaryEdgesBefore,
    });
  }

  // refine: red-green adaptive mid-split (crack-free on partial brush coverage)
  const marked = new Uint8Array(facesBefore);
  for (let t = 0; t < facesBefore; t += 1) {
    if (triCentroidNear(t, soup.positions, soup.indices)) marked[t] = 1;
  }

  // Promote unmarked faces with ≥2 split edges until stable (red→green).
  let changed = true;
  while (changed) {
    changed = false;
    const splitEdges = new Set<string>();
    for (let t = 0; t < facesBefore; t += 1) {
      if (!marked[t]) continue;
      const i0 = soup.indices[t * 3]!;
      const i1 = soup.indices[t * 3 + 1]!;
      const i2 = soup.indices[t * 3 + 2]!;
      splitEdges.add(ekey(i0, i1));
      splitEdges.add(ekey(i1, i2));
      splitEdges.add(ekey(i2, i0));
    }
    for (let t = 0; t < facesBefore; t += 1) {
      if (marked[t]) continue;
      const i0 = soup.indices[t * 3]!;
      const i1 = soup.indices[t * 3 + 1]!;
      const i2 = soup.indices[t * 3 + 2]!;
      let n = 0;
      if (splitEdges.has(ekey(i0, i1))) n += 1;
      if (splitEdges.has(ekey(i1, i2))) n += 1;
      if (splitEdges.has(ekey(i2, i0))) n += 1;
      if (n >= 2) {
        marked[t] = 1;
        changed = true;
      }
    }
  }

  const splitEdges = new Set<string>();
  for (let t = 0; t < facesBefore; t += 1) {
    if (!marked[t]) continue;
    const i0 = soup.indices[t * 3]!;
    const i1 = soup.indices[t * 3 + 1]!;
    const i2 = soup.indices[t * 3 + 2]!;
    splitEdges.add(ekey(i0, i1));
    splitEdges.add(ekey(i1, i2));
    splitEdges.add(ekey(i2, i0));
  }

  const positions = [...soup.positions];
  const midCache = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = ekey(a, b);
    let idx = midCache.get(key);
    if (idx !== undefined) return idx;
    idx = positions.length / 3;
    positions.push(
      (soup.positions[a * 3]! + soup.positions[b * 3]!) / 2,
      (soup.positions[a * 3 + 1]! + soup.positions[b * 3 + 1]!) / 2,
      (soup.positions[a * 3 + 2]! + soup.positions[b * 3 + 2]!) / 2,
    );
    midCache.set(key, idx);
    return idx;
  };

  // Pre-create mids for every split edge so neighbors share the same vertex.
  for (const key of splitEdges) {
    const [as, bs] = key.split("|") as [string, string];
    mid(Number(as), Number(bs));
  }

  const indices: number[] = [];
  let affected = 0;
  for (let t = 0; t < facesBefore; t += 1) {
    const i0 = soup.indices[t * 3]!;
    const i1 = soup.indices[t * 3 + 1]!;
    const i2 = soup.indices[t * 3 + 2]!;
    const e01 = splitEdges.has(ekey(i0, i1));
    const e12 = splitEdges.has(ekey(i1, i2));
    const e20 = splitEdges.has(ekey(i2, i0));
    if (marked[t]) {
      // Full 1→4 mid-split (all three edges are split by construction).
      affected += 1;
      const m01 = mid(i0, i1);
      const m12 = mid(i1, i2);
      const m20 = mid(i2, i0);
      indices.push(i0, m01, m20, i1, m12, m01, i2, m20, m12, m01, m12, m20);
      continue;
    }
    // Unmarked: 0 or 1 split edge after promotion (red-green invariant).
    const splitCount = (e01 ? 1 : 0) + (e12 ? 1 : 0) + (e20 ? 1 : 0);
    if (splitCount === 0) {
      indices.push(i0, i1, i2);
      continue;
    }
    // 1→2 bisect along the single split edge (shares mid with refined neighbor).
    affected += 1;
    if (e01) {
      const m = mid(i0, i1);
      indices.push(i0, m, i2, m, i1, i2);
    } else if (e12) {
      const m = mid(i1, i2);
      indices.push(i1, m, i0, m, i2, i0);
    } else {
      const m = mid(i2, i0);
      indices.push(i2, m, i1, m, i0, i1);
    }
  }

  const out = soupToMesh(new Float32Array(positions), new Uint32Array(indices));
  const facesAfter = indices.length / 3;
  return ok({
    mesh: out,
    affectedTris: affected,
    facesBefore,
    facesAfter,
    boundaryEdges: countBoundaryEdges(indices, facesAfter),
    boundaryEdgesBefore,
  });
}

/**
 * SCP-011: automatic retopo basic — target poly count, optional symmetry, guide stroke, error map.
 */
export function autoRetopoStudioMeshBasic(
  mesh: StudioEditableMesh,
  options: {
    readonly targetFaces: number;
    readonly symmetryX?: boolean;
    readonly guideStroke?: readonly StudioMeshVec3[];
  },
): StudioMeshOpsResult<{
  readonly mesh: StudioEditableMesh;
  readonly facesBefore: number;
  readonly facesAfter: number;
  readonly targetFaces: number;
  readonly symmetryX: boolean;
  readonly guideSamples: number;
  readonly errorMap: Float32Array;
  readonly meanError: number;
}> {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const facesBefore = soup.indices.length / 3;
  const target = Math.max(1, Math.trunc(options.targetFaces));
  const ratio = Math.min(1, target / Math.max(1, facesBefore));
  const dec = decimateStudioMesh(mesh, Math.max(0.05, ratio));
  if (!dec.ok) return fail(dec.code, dec.detail);
  let out = dec.value;
  if (options.symmetryX) {
    // Mirror-snap x toward plane for symmetry bias
    const s = studioEditableMeshToTriangleSoup(out);
    const pos = new Float32Array(s.positions);
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i]!) < 0.05) pos[i] = 0;
    }
    out = soupToMesh(pos, s.indices);
  }
  // Error map: per remaining vertex distance to guide stroke (or original AABB center)
  const finalSoup = studioEditableMeshToTriangleSoup(out);
  const vCount = finalSoup.positions.length / 3;
  const errorMap = new Float32Array(vCount);
  const guide = options.guideStroke ?? [];
  let mean = 0;
  for (let i = 0; i < vCount; i += 1) {
    const x = finalSoup.positions[i * 3]!;
    const y = finalSoup.positions[i * 3 + 1]!;
    const z = finalSoup.positions[i * 3 + 2]!;
    let err = Math.hypot(x, y, z);
    if (guide.length) {
      let best = Infinity;
      for (const g of guide) {
        best = Math.min(best, Math.hypot(x - g.x, y - g.y, z - g.z));
      }
      err = best;
    }
    errorMap[i] = err;
    mean += err;
  }
  mean = vCount ? mean / vCount : 0;
  return ok({
    mesh: out,
    facesBefore,
    facesAfter: finalSoup.indices.length / 3,
    targetFaces: target,
    symmetryX: Boolean(options.symmetryX),
    guideSamples: guide.length,
    errorMap,
    meanError: mean,
  });
}

/**
 * SCP-014: bake normal / AO / curvature / object-ID from high-res mesh into UV atlas.
 * Uses box-unwrap UVs, per-texel nearest-triangle sample, cage offset, padding dilate,
 * and linear→sRGB encoding flag for color management of AO.
 */
export function bakeStudioMeshMaps(
  mesh: StudioEditableMesh,
  options: {
    readonly resolution: number;
    readonly paddingPx?: number;
    readonly cageScale?: number;
    /** Optional high-res mesh (defaults to mesh). Normals/AO sample this surface. */
    readonly highRes?: StudioEditableMesh;
    readonly workingSpace?: "linear" | "srgb";
  },
): {
  readonly resolution: number;
  readonly paddingPx: number;
  readonly cageScale: number;
  readonly normal: Float32Array;
  readonly ao: Float32Array;
  readonly curvature: Float32Array;
  readonly objectId: Uint32Array;
  readonly texelCount: number;
  readonly coveredTexels: number;
  readonly workingSpace: "linear" | "srgb";
  readonly meanNormalLength: number;
  readonly meanAoLinear: number;
  readonly meanCurvature: number;
} {
  const res = Math.max(4, Math.min(512, Math.trunc(options.resolution)));
  const pad = Math.max(0, Math.trunc(options.paddingPx ?? 2));
  const cage = options.cageScale ?? 1.02;
  const workingSpace = options.workingSpace ?? "linear";
  const n = res * res;
  const normal = new Float32Array(n * 3);
  const ao = new Float32Array(n);
  const curvature = new Float32Array(n);
  const objectId = new Uint32Array(n);
  const covered = new Uint8Array(n);

  const high = options.highRes ?? mesh;
  const soup = studioEditableMeshToTriangleSoup(high);
  const triCount = soup.indices.length / 3;

  // Per-face normals + area + UV (box projection per vertex, same as unwrapStudioMeshBox)
  const faceNx = new Float32Array(triCount);
  const faceNy = new Float32Array(triCount);
  const faceNz = new Float32Array(triCount);
  const faceCx = new Float32Array(triCount);
  const faceCy = new Float32Array(triCount);
  const faceCz = new Float32Array(triCount);
  const faceU0 = new Float32Array(triCount);
  const faceV0 = new Float32Array(triCount);
  const faceU1 = new Float32Array(triCount);
  const faceV1 = new Float32Array(triCount);
  const faceU2 = new Float32Array(triCount);
  const faceV2 = new Float32Array(triCount);

  // Vertex UVs via box unwrap
  const vCount = soup.positions.length / 3;
  const vU = new Float32Array(vCount);
  const vV = new Float32Array(vCount);
  for (let i = 0; i < vCount; i += 1) {
    const x = soup.positions[i * 3]!;
    const y = soup.positions[i * 3 + 1]!;
    const z = soup.positions[i * 3 + 2]!;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) {
      vU[i] = z;
      vV[i] = y;
    } else if (ay >= ax && ay >= az) {
      vU[i] = x;
      vV[i] = z;
    } else {
      vU[i] = x;
      vV[i] = y;
    }
  }
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < vCount; i += 1) {
    minU = Math.min(minU, vU[i]!);
    minV = Math.min(minV, vV[i]!);
    maxU = Math.max(maxU, vU[i]!);
    maxV = Math.max(maxV, vV[i]!);
  }
  const du = Math.max(1e-8, maxU - minU);
  const dv = Math.max(1e-8, maxV - minV);
  for (let i = 0; i < vCount; i += 1) {
    vU[i] = (vU[i]! - minU) / du;
    vV[i] = (vV[i]! - minV) / dv;
  }

  // Vertex normals (accumulate face normals)
  const vNx = new Float32Array(vCount);
  const vNy = new Float32Array(vCount);
  const vNz = new Float32Array(vCount);

  for (let t = 0; t < triCount; t += 1) {
    const ia = soup.indices[t * 3]!;
    const ib = soup.indices[t * 3 + 1]!;
    const ic = soup.indices[t * 3 + 2]!;
    const ax = soup.positions[ia * 3]!, ay = soup.positions[ia * 3 + 1]!, az = soup.positions[ia * 3 + 2]!;
    const bx = soup.positions[ib * 3]!, by = soup.positions[ib * 3 + 1]!, bz = soup.positions[ib * 3 + 2]!;
    const cx = soup.positions[ic * 3]!, cy = soup.positions[ic * 3 + 1]!, cz = soup.positions[ic * 3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    faceNx[t] = nx; faceNy[t] = ny; faceNz[t] = nz;
    faceCx[t] = (ax + bx + cx) / 3;
    faceCy[t] = (ay + by + cy) / 3;
    faceCz[t] = (az + bz + cz) / 3;
    faceU0[t] = vU[ia]!; faceV0[t] = vV[ia]!;
    faceU1[t] = vU[ib]!; faceV1[t] = vV[ib]!;
    faceU2[t] = vU[ic]!; faceV2[t] = vV[ic]!;
    vNx[ia]! += nx; vNy[ia]! += ny; vNz[ia]! += nz;
    vNx[ib]! += nx; vNy[ib]! += ny; vNz[ib]! += nz;
    vNx[ic]! += nx; vNy[ic]! += ny; vNz[ic]! += nz;
  }
  for (let i = 0; i < vCount; i += 1) {
    const l = Math.hypot(vNx[i]!, vNy[i]!, vNz[i]!) || 1;
    vNx[i]! /= l; vNy[i]! /= l; vNz[i]! /= l;
  }

  // Curvature proxy at vertices: variance of adjacent face normals
  const vCurv = new Float32Array(vCount);
  const vAdj: number[][] = Array.from({ length: vCount }, () => []);
  for (let t = 0; t < triCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      vAdj[soup.indices[t * 3 + k]!]!.push(t);
    }
  }
  for (let i = 0; i < vCount; i += 1) {
    const adj = vAdj[i]!;
    if (adj.length < 2) {
      vCurv[i] = 0;
      continue;
    }
    let mx = 0, my = 0, mz = 0;
    for (const t of adj) {
      mx += faceNx[t]!; my += faceNy[t]!; mz += faceNz[t]!;
    }
    mx /= adj.length; my /= adj.length; mz /= adj.length;
    let varn = 0;
    for (const t of adj) {
      varn += Math.hypot(faceNx[t]! - mx, faceNy[t]! - my, faceNz[t]! - mz);
    }
    vCurv[i] = varn / adj.length;
  }

  const barycentric = (
    u: number,
    v: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
  ): { w0: number; w1: number; w2: number; inside: boolean } => {
    const den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(den) < 1e-12) return { w0: 0, w1: 0, w2: 0, inside: false };
    const w0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / den;
    const w1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / den;
    const w2 = 1 - w0 - w1;
    const inside = w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4;
    return { w0, w1, w2, inside };
  };

  // Sample each texel from UV triangles
  for (let y = 0; y < res; y += 1) {
    for (let x = 0; x < res; x += 1) {
      const i = y * res + x;
      const u = (x + 0.5) / res;
      const v = (y + 0.5) / res;
      let bestD = Infinity;
      let bestT = -1;
      let bw0 = 0, bw1 = 0, bw2 = 0;
      for (let t = 0; t < triCount; t += 1) {
        const b = barycentric(
          u,
          v,
          faceU0[t]!,
          faceV0[t]!,
          faceU1[t]!,
          faceV1[t]!,
          faceU2[t]!,
          faceV2[t]!,
        );
        if (b.inside) {
          bestT = t;
          bw0 = b.w0; bw1 = b.w1; bw2 = b.w2;
          bestD = 0;
          break;
        }
        // distance to triangle centroid in UV for padding fill later
        const cu = (faceU0[t]! + faceU1[t]! + faceU2[t]!) / 3;
        const cv = (faceV0[t]! + faceV1[t]! + faceV2[t]!) / 3;
        const d = (u - cu) ** 2 + (v - cv) ** 2;
        if (d < bestD) {
          bestD = d;
          bestT = t;
          bw0 = 1 / 3; bw1 = 1 / 3; bw2 = 1 / 3;
        }
      }
      if (bestT < 0) continue;
      const ia = soup.indices[bestT * 3]!;
      const ib = soup.indices[bestT * 3 + 1]!;
      const ic = soup.indices[bestT * 3 + 2]!;
      // Interpolated normal
      let nx = vNx[ia]! * bw0 + vNx[ib]! * bw1 + vNx[ic]! * bw2;
      let ny = vNy[ia]! * bw0 + vNy[ib]! * bw1 + vNy[ic]! * bw2;
      let nz = vNz[ia]! * bw0 + vNz[ib]! * bw1 + vNz[ic]! * bw2;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / nl) * cage;
      ny = (ny / nl) * cage;
      nz = (nz / nl) * cage;
      normal[i * 3] = nx;
      normal[i * 3 + 1] = ny;
      normal[i * 3 + 2] = nz;
      // AO: bent-normal proxy — 0.5 + 0.5 * up-dot (not UV sin formula)
      const aoLin = Math.max(0, Math.min(1, 0.35 + 0.65 * Math.max(0, ny / cage)));
      ao[i] = workingSpace === "srgb" ? Math.pow(aoLin, 1 / 2.2) : aoLin;
      curvature[i] = vCurv[ia]! * bw0 + vCurv[ib]! * bw1 + vCurv[ic]! * bw2;
      objectId[i] = bestT + 1; // face id
      covered[i] = bestD === 0 ? 1 : 0;
    }
  }

  // Padding dilate: for border empty texels near covered, copy neighbor
  if (pad > 0) {
    for (let iter = 0; iter < pad; iter += 1) {
      const next = covered.slice();
      for (let y = 0; y < res; y += 1) {
        for (let x = 0; x < res; x += 1) {
          const i = y * res + x;
          if (covered[i]) continue;
          let found = false;
          for (let dy = -1; dy <= 1 && !found; dy += 1) {
            for (let dx = -1; dx <= 1 && !found; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
              const j = ny * res + nx;
              if (!covered[j]) continue;
              normal[i * 3] = normal[j * 3]!;
              normal[i * 3 + 1] = normal[j * 3 + 1]!;
              normal[i * 3 + 2] = normal[j * 3 + 2]!;
              ao[i] = ao[j]!;
              curvature[i] = curvature[j]!;
              objectId[i] = objectId[j]!;
              next[i] = 1;
              found = true;
            }
          }
        }
      }
      covered.set(next);
    }
  }

  let coveredTexels = 0;
  let meanNormalLength = 0;
  let meanAoLinear = 0;
  let meanCurvature = 0;
  for (let i = 0; i < n; i += 1) {
    if (objectId[i]! > 0) coveredTexels += 1;
    meanNormalLength += Math.hypot(normal[i * 3]!, normal[i * 3 + 1]!, normal[i * 3 + 2]!);
    const aoLin =
      workingSpace === "srgb" ? Math.pow(Math.max(0, ao[i]!), 2.2) : ao[i]!;
    meanAoLinear += aoLin;
    meanCurvature += curvature[i]!;
  }
  meanNormalLength /= n;
  meanAoLinear /= n;
  meanCurvature /= n;

  return {
    resolution: res,
    paddingPx: pad,
    cageScale: cage,
    normal,
    ao,
    curvature,
    objectId,
    texelCount: n,
    coveredTexels,
    workingSpace,
    meanNormalLength,
    meanAoLinear,
    meanCurvature,
  };
}
