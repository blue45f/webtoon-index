/**
 * Hybrid DCC sculpt / voxel-lite kernel (SCP-001–005, 008 subset).
 *
 * ## 한계
 * - 프로덕션 multires / dynamesh / face-set GPU 스컬프 코어(`studio-sculpt-*`)가 아니다.
 * - 삼각형 soup 위에서 동작하며 ZBrush급 수천만 poly·멀티레벨 델타를 지원하지 않는다.
 * - voxel remesh는 격자 스냅 근사(상세 손실 있음).
 */

import {
  createStudioEditableMeshFromPolygons,
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "../studio-editable-half-edge-mesh";

export const STUDIO_SCULPT_KERNEL_REVISION = 1 as const;

export type StudioSculptBrushKind =
  | "grab"
  | "smooth"
  | "inflate"
  | "clay"
  | "crease"
  | "flatten"
  | "scrape"
  | "snakeHook";

export interface StudioSculptStroke {
  readonly kind: StudioSculptBrushKind;
  readonly center: StudioMeshVec3;
  readonly radius: number;
  readonly strength: number;
  readonly direction?: StudioMeshVec3;
}

export type StudioSculptResult =
  | { readonly ok: true; readonly mesh: StudioEditableMesh }
  | { readonly ok: false; readonly detail: string };

function falloff(dist: number, radius: number): number {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return t * t * (3 - 2 * t);
}

function soupToMesh(positions: Float32Array, indices: Uint32Array): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    verts.push({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
  }
  const faces: number[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

export function applyStudioSculptStroke(
  mesh: StudioEditableMesh,
  stroke: StudioSculptStroke,
  mask?: Float32Array | null,
): StudioSculptResult {
  if (!(stroke.radius > 0) || !Number.isFinite(stroke.strength)) {
    return { ok: false, detail: "invalid brush" };
  }
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const positions = new Float32Array(soup.positions);
  const n = positions.length / 3;
  const cx = stroke.center.x;
  const cy = stroke.center.y;
  const cz = stroke.center.z;

  // Average normal for inflate
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t < soup.indices.length; t += 3) {
    const ia = soup.indices[t]!;
    const ib = soup.indices[t + 1]!;
    const ic = soup.indices[t + 2]!;
    const ax = positions[ia * 3]!;
    const ay = positions[ia * 3 + 1]!;
    const az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]! - ax;
    const by = positions[ib * 3 + 1]! - ay;
    const bz = positions[ib * 3 + 2]! - az;
    const cxn = positions[ic * 3]! - ax;
    const cyn = positions[ic * 3 + 1]! - ay;
    const czn = positions[ic * 3 + 2]! - az;
    nx += by * czn - bz * cyn;
    ny += bz * cxn - bx * czn;
    nz += bx * cyn - by * cxn;
  }
  const nl = Math.hypot(nx, ny, nz);
  // 닫힌 메시는 면적 가중 평균 법선이 0 으로 퇴화한다 — 그때는 브러시 direction 이 평면 축을 대신한다.
  if (nl > 1e-6) {
    nx /= nl;
    ny /= nl;
    nz /= nl;
  } else {
    nx = 0;
    ny = 1;
    nz = 0;
  }

  const dir = stroke.direction ?? { x: nx, y: ny, z: nz };
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;

  for (let i = 0; i < n; i += 1) {
    const m = mask ? (mask[i] ?? 1) : 1;
    if (m <= 0) continue;
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const dist = Math.hypot(x - cx, y - cy, z - cz);
    const w = falloff(dist, stroke.radius) * stroke.strength * m;
    if (w === 0) continue;
    if (stroke.kind === "grab" || stroke.kind === "snakeHook") {
      positions[i * 3] = x + (dir.x / dl) * w;
      positions[i * 3 + 1] = y + (dir.y / dl) * w;
      positions[i * 3 + 2] = z + (dir.z / dl) * w;
    } else if (stroke.kind === "inflate" || stroke.kind === "clay") {
      const s = stroke.kind === "clay" ? w * 0.5 : w;
      positions[i * 3] = x + nx * s;
      positions[i * 3 + 1] = y + ny * s;
      positions[i * 3 + 2] = z + nz * s;
    } else if (stroke.kind === "crease") {
      positions[i * 3] = x - nx * w * 0.5;
      positions[i * 3 + 1] = y - ny * w * 0.5;
      positions[i * 3 + 2] = z - nz * w * 0.5;
    } else if (stroke.kind === "flatten" || stroke.kind === "scrape") {
      // 가중 평균 평면 투영. scrape 는 방향 쪽으로 튀어나온 정점만 닦아내린다.
      // 평면 법선은 브러시 direction 을 따른다(닫힌 메시의 평균 법선은 0 으로 퇴화한다).
      const px = dir.x / dl;
      const py = dir.y / dl;
      const pz = dir.z / dl;
      const signed = (x - cx) * px + (y - cy) * py + (z - cz) * pz;
      const above = signed > 0;
      if (stroke.kind === "flatten" || above) {
        const step = stroke.kind === "scrape" ? Math.max(0, signed) * w : signed * w;
        positions[i * 3] = x - px * step;
        positions[i * 3 + 1] = y - py * step;
        positions[i * 3 + 2] = z - pz * step;
      }
    } else if (stroke.kind === "smooth") {
      // Laplacian toward neighborhood average (1-ring approx via same face verts)
      let ax = 0;
      let ay = 0;
      let az = 0;
      let count = 0;
      for (let t = 0; t < soup.indices.length; t += 3) {
        const tri = [soup.indices[t]!, soup.indices[t + 1]!, soup.indices[t + 2]!];
        if (!tri.includes(i)) continue;
        for (const j of tri) {
          if (j === i) continue;
          ax += positions[j * 3]!;
          ay += positions[j * 3 + 1]!;
          az += positions[j * 3 + 2]!;
          count += 1;
        }
      }
      if (count > 0) {
        ax /= count;
        ay /= count;
        az /= count;
        positions[i * 3] = x + (ax - x) * w;
        positions[i * 3 + 1] = y + (ay - y) * w;
        positions[i * 3 + 2] = z + (az - z) * w;
      }
    }
  }
  return { ok: true, mesh: soupToMesh(positions, soup.indices) };
}

export function createStudioSculptMask(
  vertexCount: number,
  fill = 1,
): Float32Array {
  const m = new Float32Array(vertexCount);
  m.fill(Math.max(0, Math.min(1, fill)));
  return m;
}

export function invertStudioSculptMask(mask: Float32Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = 1 - (mask[i] ?? 0);
  return out;
}

/** SCP-005 lite: voxel remesh by grid snap + unique points (detail loss). */
export function voxelRemeshStudioMesh(
  mesh: StudioEditableMesh,
  cellSize: number,
): StudioSculptResult {
  if (!(cellSize > 0)) return { ok: false, detail: "invalid cell" };
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x / cellSize)}|${Math.round(y / cellSize)}|${Math.round(z / cellSize)}`;
  const map = new Map<string, number>();
  const positions: number[] = [];
  const remap = (i: number) => {
    const x = soup.positions[i * 3]!;
    const y = soup.positions[i * 3 + 1]!;
    const z = soup.positions[i * 3 + 2]!;
    const k = key(x, y, z);
    let n = map.get(k);
    if (n !== undefined) return n;
    n = positions.length / 3;
    map.set(k, n);
    positions.push(
      Math.round(x / cellSize) * cellSize,
      Math.round(y / cellSize) * cellSize,
      Math.round(z / cellSize) * cellSize,
    );
    return n;
  };
  const indices: number[] = [];
  for (let t = 0; t < soup.indices.length; t += 3) {
    const a = remap(soup.indices[t]!);
    const b = remap(soup.indices[t + 1]!);
    const c = remap(soup.indices[t + 2]!);
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  if (indices.length === 0) return { ok: false, detail: "remesh empty" };
  return {
    ok: true,
    mesh: soupToMesh(new Float32Array(positions), new Uint32Array(indices)),
  };
}

/** SCP-008 lite: vertex color paint (RGB 0–1 stored as separate array). */
export function polypaintStudioMesh(
  vertexCount: number,
  colors: Float32Array | null,
  centerIndex: number,
  radiusIndices: number,
  rgb: readonly [number, number, number],
): Float32Array {
  const out = colors ? new Float32Array(colors) : new Float32Array(vertexCount * 3);
  if (!colors) {
    for (let i = 0; i < vertexCount; i += 1) {
      out[i * 3] = 0.7;
      out[i * 3 + 1] = 0.7;
      out[i * 3 + 2] = 0.7;
    }
  }
  const r = Math.max(0, Math.trunc(radiusIndices));
  for (let i = Math.max(0, centerIndex - r); i <= Math.min(vertexCount - 1, centerIndex + r); i += 1) {
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  }
  return out;
}
