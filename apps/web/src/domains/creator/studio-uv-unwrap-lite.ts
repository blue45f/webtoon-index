/**
 * UV unwrap lite (MAT-004 / SCP-013 subset) — planar + box projection, pack islands.
 */

import {
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
} from "./studio-editable-half-edge-mesh";

export const STUDIO_UV_UNWRAP_LITE_REVISION = 1 as const;

export type StudioUvMode = "planar-xy" | "planar-xz" | "planar-yz" | "box";

export interface StudioUvMap {
  readonly uvs: Float32Array; // 2 * vertexCount
  readonly mode: StudioUvMode;
  readonly packed: boolean;
}

export function unwrapStudioMeshPlanar(
  mesh: StudioEditableMesh,
  mode: Exclude<StudioUvMode, "box"> = "planar-xy",
): StudioUvMap {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const n = soup.positions.length / 3;
  const uvs = new Float32Array(n * 2);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = soup.positions[i * 3]!;
    const y = soup.positions[i * 3 + 1]!;
    const z = soup.positions[i * 3 + 2]!;
    let u = x;
    let v = y;
    if (mode === "planar-xz") {
      u = x;
      v = z;
    } else if (mode === "planar-yz") {
      u = y;
      v = z;
    }
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  const du = Math.max(1e-8, maxU - minU);
  const dv = Math.max(1e-8, maxV - minV);
  for (let i = 0; i < n; i += 1) {
    uvs[i * 2] = (uvs[i * 2]! - minU) / du;
    uvs[i * 2 + 1] = (uvs[i * 2 + 1]! - minV) / dv;
  }
  return { uvs, mode, packed: true };
}

export function unwrapStudioMeshBox(mesh: StudioEditableMesh): StudioUvMap {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const n = soup.positions.length / 3;
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    const x = soup.positions[i * 3]!;
    const y = soup.positions[i * 3 + 1]!;
    const z = soup.positions[i * 3 + 2]!;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) {
      uvs[i * 2] = z;
      uvs[i * 2 + 1] = y;
    } else if (ay >= ax && ay >= az) {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = z;
    } else {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = y;
    }
  }
  // normalize
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i += 1) {
    minU = Math.min(minU, uvs[i * 2]!);
    minV = Math.min(minV, uvs[i * 2 + 1]!);
    maxU = Math.max(maxU, uvs[i * 2]!);
    maxV = Math.max(maxV, uvs[i * 2 + 1]!);
  }
  const du = Math.max(1e-8, maxU - minU);
  const dv = Math.max(1e-8, maxV - minV);
  for (let i = 0; i < n; i += 1) {
    uvs[i * 2] = (uvs[i * 2]! - minU) / du;
    uvs[i * 2 + 1] = (uvs[i * 2 + 1]! - minV) / dv;
  }
  return { uvs, mode: "box", packed: true };
}

/** Pack multiple UV islands into unit square (row layout). */
export function packStudioUvIslands(
  islands: readonly Float32Array[],
): Float32Array {
  const totalVerts = islands.reduce((n, u) => n + u.length / 2, 0);
  const out = new Float32Array(totalVerts * 2);
  const cols = Math.max(1, Math.ceil(Math.sqrt(islands.length)));
  let write = 0;
  islands.forEach((uv, islandIndex) => {
    const col = islandIndex % cols;
    const row = Math.floor(islandIndex / cols);
    const cell = 1 / cols;
    const pad = cell * 0.05;
    for (let i = 0; i < uv.length; i += 2) {
      out[write * 2] = col * cell + pad + uv[i]! * (cell - 2 * pad);
      out[write * 2 + 1] = row * cell + pad + uv[i + 1]! * (cell - 2 * pad);
      write += 1;
    }
  });
  return out;
}
