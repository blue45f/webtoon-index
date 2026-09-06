/**
 * Solid boolean backends for MOD-014.
 * Default commit path uses Manifold WASM (manifold-3d) as its only provider.
 * Pure convex CSG remains available only through an explicitly selected backend.
 */

import {
  createStudioManifoldMeshProvider,
  createStudioManifoldRuntime,
  loadStudioManifoldRuntime,
  type StudioManifoldRuntime,
} from "./studio-manifold-mesh-provider";

import type {
  StudioMeshBooleanOp,
  StudioSolidBooleanBackend,
} from "./studio-mesh-modifier-stack";

export type StudioSolidBooleanResult = {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly diagnostic?: string;
};

let cachedRuntime: StudioManifoldRuntime | null = null;
let cachedRuntimePromise: Promise<StudioManifoldRuntime> | null = null;

async function loadManifoldRuntimeForHost(): Promise<StudioManifoldRuntime> {
  if (cachedRuntime) return cachedRuntime;
  if (cachedRuntimePromise) return cachedRuntimePromise;
  cachedRuntimePromise = (async () => {
    // Select one host-specific loader before work starts. A loader failure is terminal for this
    // request; it must not trigger a second execution path with different module semantics.
    if (typeof process !== "undefined" && process.versions?.node) {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve("manifold-3d/manifold.wasm");
      const factory = await import("manifold-3d");
      const module = await factory.default({ locateFile: () => wasmPath });
      module.setup();
      const runtime = createStudioManifoldRuntime(module);
      cachedRuntime = runtime;
      return runtime;
    }
    const runtime = await loadStudioManifoldRuntime();
    cachedRuntime = runtime;
    return runtime;
  })();
  try {
    return await cachedRuntimePromise;
  } catch (error) {
    // A later, separately initiated boolean may make a fresh runtime selection. This request never
    // retries after its selected Manifold loader failed.
    cachedRuntimePromise = null;
    throw error;
  }
}

/**
 * True when a solid boolean result is non-degenerate.
 * Rejects classic pure-convex 2-tri garbage on inverted cubes; allows small solids
 * (e.g. tetra difference ≈4 tris). Unit-cube product path enforces a higher bar in MOD-014.
 */
export function isStudioSolidBooleanResultViable(
  result: StudioSolidBooleanResult,
  _operation: StudioMeshBooleanOp,
): boolean {
  const tris = result.indices.length / 3;
  const verts = result.positions.length / 3;
  if (!Number.isFinite(tris) || tris < 4) return false;
  if (!Number.isFinite(verts) || verts < 4) return false;
  // 2-tri / 3-tri soups are not closed solids
  if (tris < 4) return false;
  return true;
}

/** Production / default: one Manifold triangle-solid execution per admitted request. */
export function createStudioManifoldSolidBooleanBackend(
  options: {
    readonly runtimeLoader?: () => Promise<StudioManifoldRuntime> | StudioManifoldRuntime;
  } = {},
): StudioSolidBooleanBackend {
  return {
    async boolean(input) {
      const runtime = await (options.runtimeLoader?.() ?? loadManifoldRuntimeForHost());
      const provider = createStudioManifoldMeshProvider({
        epoch: 0,
        runtimeLoader: () => runtime,
      });
      try {
        const receipt = await provider.boolean({
          left: {
            positions: input.left.positions,
            triangleIndices: input.left.indices,
          },
          right: {
            positions: input.right.positions,
            triangleIndices: input.right.indices,
          },
          operation: input.operation,
          epoch: 0,
        });
        const result = {
          positions: receipt.output.mesh.positions,
          indices: receipt.output.mesh.triangleIndices,
          diagnostic: `manifold:${receipt.runtimeVersion}:${receipt.operation}`,
        };
        if (!isStudioSolidBooleanResultViable(result, input.operation)) {
          throw new Error(
            `Manifold boolean produced degenerate solid (tris=${result.indices.length / 3})`,
          );
        }
        return result;
      } finally {
        await provider.destroy();
      }
    },
  };
}

/**
 * Pure convex solid CSG (plane-clip). Changes topology on non-AABB meshes (e.g. tetrahedra).
 * This is a separate, caller-selected backend. It is never invoked by the default backend after
 * a Manifold failure.
 */
export function createStudioPureConvexSolidBooleanBackend(): StudioSolidBooleanBackend {
  return {
    async boolean(input) {
      const result = pureConvexMeshBoolean(
        input.left.positions,
        input.left.indices,
        input.right.positions,
        input.right.indices,
        input.operation,
      );
      if (!isStudioSolidBooleanResultViable(result, input.operation)) {
        throw new Error(
          `pure-convex boolean degenerate (tris=${result.indices.length / 3}, verts=${result.positions.length / 3})`,
        );
      }
      return result;
    },
  };
}

type Aabb = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

function meshAabb(pos: Float32Array): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    const y = pos[i + 1]!;
    const z = pos[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** True when every vertex sits near an AABB corner (unit-cube / box solids). */
function isAabbLikeMesh(pos: Float32Array, aabb: Aabb, eps = 1e-4): boolean {
  const corners: Array<readonly [number, number, number]> = [];
  for (const x of [aabb.min[0], aabb.max[0]]) {
    for (const y of [aabb.min[1], aabb.max[1]]) {
      for (const z of [aabb.min[2], aabb.max[2]]) {
        corners.push([x, y, z]);
      }
    }
  }
  for (let i = 0; i < pos.length; i += 3) {
    const p: readonly [number, number, number] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
    let near = false;
    for (const c of corners) {
      if (
        Math.abs(p[0] - c[0]) <= eps
        && Math.abs(p[1] - c[1]) <= eps
        && Math.abs(p[2] - c[2]) <= eps
      ) {
        near = true;
        break;
      }
    }
    if (!near) return false;
  }
  const dx = aabb.max[0] - aabb.min[0];
  const dy = aabb.max[1] - aabb.min[1];
  const dz = aabb.max[2] - aabb.min[2];
  return dx > eps && dy > eps && dz > eps;
}

/** Outward half-spaces for an axis-aligned solid (n·p + d ≤ 0 inside). */
function aabbOutwardPlanes(aabb: Aabb): Plane[] {
  const [x0, y0, z0] = aabb.min;
  const [x1, y1, z1] = aabb.max;
  return [
    { n: [1, 0, 0], d: -x1 },
    { n: [-1, 0, 0], d: x0 },
    { n: [0, 1, 0], d: -y1 },
    { n: [0, -1, 0], d: y0 },
    { n: [0, 0, 1], d: -z1 },
    { n: [0, 0, -1], d: z0 },
  ];
}

function pureConvexMeshBoolean(
  leftPos: Float32Array,
  leftIdx: Uint32Array,
  rightPos: Float32Array,
  rightIdx: Uint32Array,
  operation: StudioMeshBooleanOp,
): StudioSolidBooleanResult {
  const leftTris = trianglesOf(leftPos, leftIdx);
  const rightTris = trianglesOf(rightPos, rightIdx);
  const leftAabb = meshAabb(leftPos);
  const rightAabb = meshAabb(rightPos);
  // Prefer exact AABB half-spaces for box solids — triangle-derived planes can be
  // coplanar-duplicated or inverted and collapse cube difference to garbage.
  const rightPlanes = isAabbLikeMesh(rightPos, rightAabb)
    ? aabbOutwardPlanes(rightAabb)
    : planesOf(rightTris);
  const leftPlanes = isAabbLikeMesh(leftPos, leftAabb)
    ? aabbOutwardPlanes(leftAabb)
    : planesOf(leftTris);
  const diagTag = isAabbLikeMesh(leftPos, leftAabb) && isAabbLikeMesh(rightPos, rightAabb)
    ? "pure-convex-aabb"
    : "pure-convex";

  if (operation === "union") {
    const a = clipMeshOutsideSolid(leftTris, rightPlanes);
    const b = clipMeshOutsideSolid(rightTris, leftPlanes);
    return meshFromTriangles([...a, ...b], `${diagTag}:union`);
  }
  if (operation === "intersection") {
    const a = clipMeshInsideSolid(leftTris, rightPlanes);
    return meshFromTriangles(a, `${diagTag}:intersection`);
  }
  // difference = left outside right + inverted right faces inside left
  const a = clipMeshOutsideSolid(leftTris, rightPlanes);
  const b = clipMeshInsideSolid(rightTris, leftPlanes).map(flipTri);
  return meshFromTriangles([...a, ...b], `${diagTag}:difference`);
}

type Tri = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
type Plane = { readonly n: readonly [number, number, number]; readonly d: number };

function trianglesOf(pos: Float32Array, idx: Uint32Array): Tri[] {
  const out: Tri[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t]!;
    const ib = idx[t + 1]!;
    const ic = idx[t + 2]!;
    out.push([
      [pos[ia * 3]!, pos[ia * 3 + 1]!, pos[ia * 3 + 2]!],
      [pos[ib * 3]!, pos[ib * 3 + 1]!, pos[ib * 3 + 2]!],
      [pos[ic * 3]!, pos[ic * 3 + 1]!, pos[ic * 3 + 2]!],
    ]);
  }
  return out;
}

function planesOf(tris: readonly Tri[]): Plane[] {
  return tris.map((tri) => {
    const [a, b, c] = tri;
    const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
    return { n: nn, d: -(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]) };
  });
}

function side(p: readonly [number, number, number], plane: Plane): number {
  return plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] + plane.d;
}

function lerp(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Clip polygon to keep points where plane side >= 0 (outside / positive half-space). */
function clipPolyToPlane(
  poly: readonly (readonly [number, number, number])[],
  plane: Plane,
  keepPositive: boolean,
): (readonly [number, number, number])[] {
  if (poly.length === 0) return [];
  const out: (readonly [number, number, number])[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const sc = side(cur, plane);
    const sp = side(prev, plane);
    const curIn = keepPositive ? sc >= -1e-9 : sc <= 1e-9;
    const prevIn = keepPositive ? sp >= -1e-9 : sp <= 1e-9;
    if (curIn) {
      if (!prevIn) {
        const t = sp / (sp - sc);
        out.push(lerp(prev, cur, t));
      }
      out.push(cur);
    } else if (prevIn) {
      const t = sp / (sp - sc);
      out.push(lerp(prev, cur, t));
    }
  }
  return out;
}

function clipMeshOutsideSolid(tris: readonly Tri[], solidPlanes: readonly Plane[]): Tri[] {
  return clipMesh(tris, solidPlanes, true);
}

function clipMeshInsideSolid(tris: readonly Tri[], solidPlanes: readonly Plane[]): Tri[] {
  // Inside convex solid = against all planes (side <= 0 if outward normals)
  return clipMesh(tris, solidPlanes, false);
}

function clipMesh(
  tris: readonly Tri[],
  solidPlanes: readonly Plane[],
  keepOutside: boolean,
): Tri[] {
  const result: Tri[] = [];
  for (const tri of tris) {
    let poly: (readonly [number, number, number])[] = [tri[0], tri[1], tri[2]];
    for (const plane of solidPlanes) {
      // Outside = positive side of outward plane
      poly = clipPolyToPlane(poly, plane, keepOutside);
      if (poly.length < 3) break;
    }
    for (let i = 1; i + 1 < poly.length; i += 1) {
      result.push([poly[0]!, poly[i]!, poly[i + 1]!]);
    }
  }
  return result;
}

function flipTri(tri: Tri): Tri {
  return [tri[0], tri[2], tri[1]];
}

function meshFromTriangles(
  tris: readonly Tri[],
  diagnostic: string,
): StudioSolidBooleanResult {
  if (tris.length === 0) {
    throw new Error(`${diagnostic}: empty boolean result`);
  }
  const key = (p: readonly [number, number, number]) =>
    `${p[0].toFixed(6)}|${p[1].toFixed(6)}|${p[2].toFixed(6)}`;
  const map = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const ensure = (p: readonly [number, number, number]) => {
    const k = key(p);
    let i = map.get(k);
    if (i !== undefined) return i;
    i = positions.length / 3;
    map.set(k, i);
    positions.push(p[0], p[1], p[2]);
    return i;
  };
  for (const tri of tris) {
    const a = ensure(tri[0]);
    const b = ensure(tri[1]);
    const c = ensure(tri[2]);
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  if (indices.length === 0) throw new Error(`${diagnostic}: no triangles after weld`);
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    diagnostic,
  };
}

/** Default commit backend: Manifold WASM only; failures and abnormal results stay terminal. */
export function createStudioDefaultSolidBooleanBackend(
  options: { readonly manifoldBackend?: StudioSolidBooleanBackend } = {},
): StudioSolidBooleanBackend {
  const manifold = options.manifoldBackend ?? createStudioManifoldSolidBooleanBackend();
  return {
    async boolean(input) {
      const result = await manifold.boolean(input);
      if (!isStudioSolidBooleanResultViable(result, input.operation)) {
        throw new Error(
          `Manifold solid is unavailable: non-viable result (tris=${result.indices.length / 3}).`,
        );
      }
      return result;
    },
  };
}
