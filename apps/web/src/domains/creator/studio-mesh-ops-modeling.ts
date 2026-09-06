/**
 * Direct-edit modeling ops wave 2 (MOD-009/010/011 subset): triangulate, flip normals,
 * fill hole, poke faces, Laplacian smooth. Pure soup-level algorithms; no Three.js.
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";

export const STUDIO_MESH_OPS_MODELING_REVISION = 1 as const;

export type StudioMeshOpsModelingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function ok<T>(value: T): StudioMeshOpsModelingResult<T> {
  return { ok: true, value };
}

function fail<T>(code: string, detail: string): StudioMeshOpsModelingResult<T> {
  return { ok: false, code, detail };
}

function v(x: number, y: number, z: number): StudioMeshVec3 {
  return { x, y, z };
}

const MAX_SOUP_VERTICES = 200_000;
const MAX_SOUP_INDICES = 1_200_000;

function soupOf(mesh: StudioEditableMesh): {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
} {
  const positions = new Float32Array(mesh.vertices.length * 3);
  for (let i = 0; i < mesh.vertices.length; i += 1) {
    const p = mesh.vertices[i]!.position;
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }
  const indexValues: number[] = [];
  for (const face of mesh.faces) {
    const loop: number[] = [];
    let cursor = face.he;
    do {
      const edge = mesh.halfEdges[cursor]!;
      loop.push(edge.vertex);
      cursor = edge.next;
    } while (cursor !== face.he && loop.length <= mesh.halfEdges.length);
    for (let k = 1; k + 1 < loop.length; k += 1) {
      indexValues.push(loop[0]!, loop[k]!, loop[k + 1]!);
    }
  }
  return { positions, indices: new Uint32Array(indexValues) };
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

/** MOD-011 subset: fan-triangulate every face loop (quads and n-gons included). */
export function triangulateStudioMeshFaces(
  mesh: StudioEditableMesh,
): StudioMeshOpsModelingResult<StudioEditableMesh> {
  const soup = soupOf(mesh);
  return ok(soupToMesh(soup.positions, soup.indices));
}

/** MOD-011 subset: invert winding on every triangle so all normals flip. */
export function flipStudioMeshNormals(
  mesh: StudioEditableMesh,
): StudioMeshOpsModelingResult<StudioEditableMesh> {
  const soup = soupOf(mesh);
  const flipped = new Uint32Array(soup.indices.length);
  for (let t = 0; t < soup.indices.length; t += 3) {
    flipped[t] = soup.indices[t]!;
    flipped[t + 1] = soup.indices[t + 2]!;
    flipped[t + 2] = soup.indices[t + 1]!;
  }
  return ok(soupToMesh(soup.positions, flipped));
}

/**
 * MOD-009 subset: cap every open boundary loop with a centroid fan.
 * Returns the mesh unchanged when no boundary exists.
 */
export function fillHoleStudioEditableMesh(
  mesh: StudioEditableMesh,
): StudioMeshOpsModelingResult<StudioEditableMesh> {
  const soup = soupOf(mesh);
  if (soup.indices.length === 0 || soup.indices.length % 3 !== 0) {
    return fail("invalid-mesh", "mesh has malformed triangle data");
  }
  if (soup.positions.length / 3 > MAX_SOUP_VERTICES
    || soup.indices.length > MAX_SOUP_INDICES) {
    return fail("budget-exceeded", "mesh exceeds fill-hole budgets");
  }
  const usage = new Map<string, number>();
  const keyOf = (a: number, b: number) => `${Math.min(a, b)}|${Math.max(a, b)}`;
  for (let t = 0; t < soup.indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const key = keyOf(soup.indices[t + k]!, soup.indices[t + ((k + 1) % 3)]!);
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
  }
  const adjacency = new Map<number, number[]>();
  let boundaryEdgeCount = 0;
  for (let t = 0; t < soup.indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = soup.indices[t + k]!;
      const b = soup.indices[t + ((k + 1) % 3)]!;
      if ((usage.get(keyOf(a, b)) ?? 0) !== 1) continue;
      boundaryEdgeCount += 1;
      let nexts = adjacency.get(a);
      if (!nexts) {
        nexts = [];
        adjacency.set(a, nexts);
      }
      nexts.push(b);
    }
  }
  if (boundaryEdgeCount === 0) return ok(mesh);
  if (boundaryEdgeCount % 3 !== 0 && boundaryEdgeCount < 3) {
    return fail("non-manifold", "boundary edges cannot form a closed loop");
  }
  const visitedDirected = new Set<string>();
  const positions: number[] = [...soup.positions];
  const indices: number[] = [...soup.indices];
  const centroidOfLoop = (loop: readonly number[]) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const vertex of loop) {
      cx += soup.positions[vertex * 3]!;
      cy += soup.positions[vertex * 3 + 1]!;
      cz += soup.positions[vertex * 3 + 2]!;
    }
    const n = loop.length;
    positions.push(cx / n, cy / n, cz / n);
    return positions.length / 3 - 1;
  };
  for (const [start] of adjacency) {
    if (visitedDirected.size >= boundaryEdgeCount) break;
    let cursor = start;
    const loop: number[] = [start];
    let guard = 0;
    while (guard <= boundaryEdgeCount) {
      guard += 1;
      const nexts = adjacency.get(cursor);
      if (!nexts || nexts.length === 0) break;
      const next = nexts.find((candidate) =>
        !visitedDirected.has(`${cursor}|${candidate}`)
      );
      if (next === undefined) break;
      visitedDirected.add(`${cursor}|${next}`);
      if (next === start) break;
      loop.push(next);
      cursor = next;
    }
    if (loop.length < 3) continue;
    const center = centroidOfLoop(loop);
    for (let k = 0; k < loop.length; k += 1) {
      indices.push(center, loop[(k + 1) % loop.length]!, loop[k]!);
    }
  }
  if (indices.length < 3) return ok(mesh);
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

/** MOD-009 subset: split each face by inserting a centroid vertex and re-fanning. */
export function pokeStudioMeshFaces(
  mesh: StudioEditableMesh,
): StudioMeshOpsModelingResult<StudioEditableMesh> {
  const soup = soupOf(mesh);
  if (soup.positions.length / 3 > MAX_SOUP_VERTICES
    || soup.indices.length > MAX_SOUP_INDICES) {
    return fail("budget-exceeded", "mesh exceeds poke-face budgets");
  }
  const positions: number[] = [...soup.positions];
  const indices: number[] = [];
  for (let t = 0; t < soup.indices.length; t += 3) {
    const a = soup.indices[t]!;
    const b = soup.indices[t + 1]!;
    const c = soup.indices[t + 2]!;
    positions.push(
      (soup.positions[a * 3]! + soup.positions[b * 3]! + soup.positions[c * 3]!) / 3,
      (soup.positions[a * 3 + 1]! + soup.positions[b * 3 + 1]! + soup.positions[c * 3 + 1]!) / 3,
      (soup.positions[a * 3 + 2]! + soup.positions[b * 3 + 2]! + soup.positions[c * 3 + 2]!) / 3,
    );
    const center = positions.length / 3 - 1;
    indices.push(a, b, center, b, c, center, c, a, center);
  }
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

/**
 * MOD-010 adjacent: uniform Laplacian relaxation over position-welded vertices.
 * `factor` clamps to 0..1 per iteration; `iterations` clamps to 0..8.
 */
export function smoothStudioMeshVerticesLaplacian(
  mesh: StudioEditableMesh,
  iterations = 1,
  factor = 0.5,
): StudioMeshOpsModelingResult<StudioEditableMesh> {
  const iterCount = Math.max(0, Math.min(8, Math.trunc(iterations)));
  const lambda = Math.max(0, Math.min(1, factor));
  if (iterCount === 0 || lambda === 0) return ok(mesh);
  const soup = soupOf(mesh);
  if (soup.positions.length / 3 > MAX_SOUP_VERTICES
    || soup.indices.length > MAX_SOUP_INDICES) {
    return fail("budget-exceeded", "mesh exceeds Laplacian smooth budgets");
  }
  // Position-weld first so duplicated soup corners relax as one logical vertex.
  const weldKeyOf = (i: number) => {
    const q = 1e5;
    return `${Math.round(soup.positions[i * 3]! * q)}|${Math.round(soup.positions[i * 3 + 1]! * q)}|${Math.round(soup.positions[i * 3 + 2]! * q)}`;
  };
  const weldIndex = new Map<string, number>();
  const remap = new Int32Array(soup.positions.length / 3);
  const welded: number[] = [];
  for (let i = 0; i < soup.positions.length / 3; i += 1) {
    const key = weldKeyOf(i);
    let target = weldIndex.get(key);
    if (target === undefined) {
      target = welded.length / 3;
      weldIndex.set(key, target);
      welded.push(soup.positions[i * 3]!, soup.positions[i * 3 + 1]!, soup.positions[i * 3 + 2]!);
    }
    remap[i] = target;
  }
  const vertexCount = welded.length / 3;
  const indicesWelded = new Uint32Array(soup.indices.length);
  for (let i = 0; i < soup.indices.length; i += 1) {
    indicesWelded[i] = remap[soup.indices[i]!]!;
  }
  let current = Float32Array.from(welded);
  for (let iter = 0; iter < iterCount; iter += 1) {
    const accum = new Float64Array(vertexCount * 3);
    const degree = new Uint32Array(vertexCount);
    for (let t = 0; t < indicesWelded.length; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const i = indicesWelded[t + k]!;
        const j = indicesWelded[t + ((k + 1) % 3)]!;
        accum[i * 3]! += current[j * 3]!;
        accum[i * 3 + 1]! += current[j * 3 + 1]!;
        accum[i * 3 + 2]! += current[j * 3 + 2]!;
        degree[i]! += 1;
      }
    }
    const next = Float32Array.from(current);
    for (let i = 0; i < vertexCount; i += 1) {
      if (degree[i] === 0) continue;
      next[i * 3] = current[i * 3]! * (1 - lambda)
        + (accum[i * 3]! / degree[i]!) * lambda;
      next[i * 3 + 1] = current[i * 3 + 1]! * (1 - lambda)
        + (accum[i * 3 + 1]! / degree[i]!) * lambda;
      next[i * 3 + 2] = current[i * 3 + 2]! * (1 - lambda)
        + (accum[i * 3 + 2]! / degree[i]!) * lambda;
    }
    current = next;
  }
  return ok(soupToMesh(current, indicesWelded));
}
