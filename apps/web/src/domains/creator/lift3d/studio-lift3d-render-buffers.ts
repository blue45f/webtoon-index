/**
 * Studio Lift 3D — 편집 메시를 GPU/GLB 가 바로 먹는 인터리브 없는 버퍼로 편다.
 *
 * 화면 미리보기와 GLB 내보내기가 **같은 버퍼**를 쓰게 하려고 따로 뺐다. 두 경로가 각자
 * 삼각형화·법선 계산을 하면 미리보기에서 멀쩡하던 형상이 파일에서만 뒤집히는 부류의 차이가
 * 조용히 생긴다.
 */

import { studioEditableMeshToTriangleSoup } from "../studio-editable-half-edge-mesh";

import type { StudioLift3dGeometry } from "./studio-lift3d-mesh";

export interface StudioLift3dRenderBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** glTF TEXCOORD_0 규약과 동일(좌상단 원점). */
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** 면적 가중 평균 법선. 앞뒤 껍질이 공유하는 봉합선 정점에서 실루엣이 부드럽게 넘어간다. */
export function computeStudioLift3dNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    // 정규화하지 않은 외적 = 면적×2 가중치.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    // 세 정점 누적을 펼쳐 쓴다. `for (const base of [a, b, c])` 는 삼각형마다 임시 배열을
    // 하나씩 만드는데, 배경 프리셋이면 한 번 호출에 20만 개다.
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length < 1e-12) {
      normals[i + 2] = 1;
      continue;
    }
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

export function buildStudioLift3dRenderBuffers(
  geometry: StudioLift3dGeometry,
): StudioLift3dRenderBuffers {
  const soup = studioEditableMeshToTriangleSoup(geometry.mesh);
  const vertexCount = geometry.mesh.vertices.length;
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    const uv = geometry.uvs[i];
    if (uv === undefined) continue;
    uvs[i * 2] = uv.u;
    uvs[i * 2 + 1] = uv.v;
  }
  return {
    positions: soup.positions,
    normals: computeStudioLift3dNormals(soup.positions, soup.indices),
    uvs,
    indices: soup.indices,
    vertexCount,
    triangleCount: soup.indices.length / 3,
  };
}
