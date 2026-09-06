/**
 * Studio Lift 3D — 리프트 결과를 텍스처가 붙은 glTF 2.0 바이너리(GLB)로 굳히는 단계.
 *
 * 컨테이너 직렬화는 새로 쓰지 않고 저장소의 순수 GLB 2.0 writer 를 그대로 쓴다. 그 writer 는
 * `studio-bg3d-glb-validation` 과 같은 한도(100 MiB 파일 / 4 MiB JSON)를 공유하므로, 여기서 나온
 * 파일은 이 앱 자신의 모델 가져오기 게이트를 그대로 통과한다.
 *
 * 텍스처는 사용자가 올린 원본 바이트를 재인코딩 없이 그대로 싣는다. 리프트의 UV 가 원본 이미지
 * 좌표 그대로라서 재인코딩은 화질만 깎을 뿐 얻는 것이 없다.
 */

import { canonicalStudioBg3dGlbFileName } from "../bg3d/studio-bg3d-canonical-glb-download";
import {
  STUDIO_VRM_EXPORT_MIME_TYPE,
  writeStudioVrmExportGlb,
} from "../vrm/studio-vrm-export-glb-container";

import {
  STUDIO_LIFT3D_LIMITS,
  STUDIO_LIFT3D_REVISION,
  studioLift3dFailure,
  studioLift3dSuccess,
  studioLift3dWarning,
  type StudioLift3dResult,
  type StudioLift3dTexture,
  type StudioLift3dWarning,
} from "./studio-lift3d-contract";
import {
  buildStudioLift3dRenderBuffers,
  type StudioLift3dRenderBuffers,
} from "./studio-lift3d-render-buffers";

import type { StudioLift3dGeometry } from "./studio-lift3d-mesh";

export const STUDIO_LIFT3D_GLB_GENERATOR =
  `ToonSpectrum Studio Lift 3D v${STUDIO_LIFT3D_REVISION}` as const;

const GLTF_FLOAT = 5126;
const GLTF_UNSIGNED_INT = 5125;
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;
const GLTF_LINEAR = 9729;
const GLTF_LINEAR_MIPMAP_LINEAR = 9987;
const GLTF_CLAMP_TO_EDGE = 33071;

export interface StudioLift3dGlbOptions {
  /** 씬 그래프와 파일명에 쓰일 이름. */
  readonly name: string;
  /** 원본 이미지 바이트. 없으면 단색 베이스컬러로 나간다. */
  readonly texture?: StudioLift3dTexture | null;
  /** 반투명 가장자리를 잘라낼지. 캐릭터 컷아웃은 MASK, 배경 부조는 OPAQUE 가 맞다. */
  readonly alphaMode?: "MASK" | "OPAQUE";
  readonly alphaCutoff?: number;
  /** 원화를 조명 없이 그대로 보여준다(KHR_materials_unlit, required 아님). */
  readonly unlit?: boolean;
  readonly doubleSided?: boolean;
}

export interface StudioLift3dGlbFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly fileName: string;
  readonly mimeType: typeof STUDIO_VRM_EXPORT_MIME_TYPE;
  /** 이 파일에 실제로 실린 버퍼. 미리보기가 재계산 없이 같은 것을 그린다. */
  readonly buffers: StudioLift3dRenderBuffers;
  readonly metrics: {
    readonly vertexCount: number;
    readonly triangleCount: number;
    readonly byteLength: number;
    readonly textureByteLength: number;
  };
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

/**
 * 지오메트리 + 원본 텍스처를 한 장의 GLB 로 인코딩한다.
 *
 * 출력은 입력에만 의존한다 — 타임스탬프도, 난수 id 도 넣지 않으므로 같은 원화·같은 설정이면
 * 바이트 단위로 같은 파일이 나온다.
 */
export function encodeStudioLift3dGlb(
  geometry: StudioLift3dGeometry,
  options: StudioLift3dGlbOptions,
): StudioLift3dResult<StudioLift3dGlbFile> {
  const warnings: StudioLift3dWarning[] = [];
  const buffers = buildStudioLift3dRenderBuffers(geometry);
  const vertexCount = buffers.vertexCount;
  if (vertexCount === 0 || buffers.indices.length === 0) {
    return studioLift3dFailure("degenerate-geometry", "삼각형이 없는 메시는 내보낼 수 없습니다");
  }
  if (geometry.uvs.length !== vertexCount) {
    return studioLift3dFailure("invalid-option", "UV 개수가 정점 개수와 다릅니다");
  }

  let texture = options.texture ?? null;
  if (texture !== null && texture.bytes.byteLength > STUDIO_LIFT3D_LIMITS.maxTextureBytes) {
    warnings.push(studioLift3dWarning(
      "texture-omitted",
      "원본 이미지가 16MB 를 넘어 텍스처 없이 형상만 내보냈습니다",
    ));
    texture = null;
  }

  const { indices, normals, positions, uvs } = buffers;
  const positionBytes = positions.byteLength;
  const normalBytes = normals.byteLength;
  const uvBytes = uvs.byteLength;
  const indexBytes = indices.byteLength;
  const textureBytes = texture?.bytes.byteLength ?? 0;

  const positionOffset = 0;
  const normalOffset = align4(positionOffset + positionBytes);
  const uvOffset = align4(normalOffset + normalBytes);
  const indexOffset = align4(uvOffset + uvBytes);
  const textureOffset = align4(indexOffset + indexBytes);
  const binaryLength = textureOffset + align4(textureBytes);

  const binary = new Uint8Array(binaryLength);
  binary.set(new Uint8Array(positions.buffer, positions.byteOffset, positionBytes), positionOffset);
  binary.set(new Uint8Array(normals.buffer, normals.byteOffset, normalBytes), normalOffset);
  binary.set(new Uint8Array(uvs.buffer, uvs.byteOffset, uvBytes), uvOffset);
  binary.set(new Uint8Array(indices.buffer, indices.byteOffset, indexBytes), indexOffset);
  if (texture !== null) binary.set(texture.bytes, textureOffset);

  const bufferViews: Record<string, unknown>[] = [
    { buffer: 0, byteOffset: positionOffset, byteLength: positionBytes, target: GLTF_ARRAY_BUFFER },
    { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes, target: GLTF_ARRAY_BUFFER },
    { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes, target: GLTF_ARRAY_BUFFER },
    { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes, target: GLTF_ELEMENT_ARRAY_BUFFER },
  ];
  if (texture !== null) {
    bufferViews.push({ buffer: 0, byteOffset: textureOffset, byteLength: textureBytes });
  }

  const { min, max } = geometry.bounds;
  const material: Record<string, unknown> = {
    name: `${options.name}-material`,
    doubleSided: options.doubleSided ?? false,
    alphaMode: options.alphaMode ?? "OPAQUE",
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      ...(texture === null ? {} : { baseColorTexture: { index: 0, texCoord: 0 } }),
    },
  };
  if ((options.alphaMode ?? "OPAQUE") === "MASK") {
    material.alphaCutoff = Math.min(1, Math.max(0, options.alphaCutoff ?? 0.5));
  }
  if (options.unlit ?? true) {
    // `extensionsUsed` 에만 올린다(required 아님). 미지원 로더는 조용히 PBR 로 떨어진다.
    material.extensions = { KHR_materials_unlit: {} };
  }

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: STUDIO_LIFT3D_GLB_GENERATOR },
    scene: 0,
    scenes: [{ name: options.name, nodes: [0] }],
    nodes: [{ name: options.name, mesh: 0 }],
    meshes: [{
      name: options.name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
        mode: 4,
      }],
    }],
    materials: [material],
    accessors: [
      {
        bufferView: 0,
        componentType: GLTF_FLOAT,
        count: vertexCount,
        type: "VEC3",
        min: [min.x, min.y, min.z],
        max: [max.x, max.y, max.z],
      },
      { bufferView: 1, componentType: GLTF_FLOAT, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: GLTF_FLOAT, count: vertexCount, type: "VEC2" },
      {
        bufferView: 3,
        componentType: GLTF_UNSIGNED_INT,
        count: indices.length,
        type: "SCALAR",
      },
    ],
    bufferViews,
    buffers: [{ byteLength: binaryLength }],
  };
  if (options.unlit ?? true) json.extensionsUsed = ["KHR_materials_unlit"];
  if (texture !== null) {
    json.images = [{ name: `${options.name}-texture`, bufferView: 4, mimeType: texture.mimeType }];
    json.samplers = [{
      magFilter: GLTF_LINEAR,
      minFilter: GLTF_LINEAR_MIPMAP_LINEAR,
      wrapS: GLTF_CLAMP_TO_EDGE,
      wrapT: GLTF_CLAMP_TO_EDGE,
    }];
    json.textures = [{ sampler: 0, source: 0 }];
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = writeStudioVrmExportGlb({ json, binary });
  } catch (error) {
    return studioLift3dFailure(
      "budget-exceeded",
      error instanceof Error ? error.message : "GLB 컨테이너를 만들지 못했습니다",
    );
  }

  return studioLift3dSuccess(
    {
      bytes,
      // GLB 저장 이름 규칙은 이 저장소에 이미 있다 — NFKC 정규화, 제어문자 제거, Windows
      // 예약 이름 회피, 코드포인트 단위 절단(서로게이트 쌍을 가르지 않는다).
      fileName: canonicalStudioBg3dGlbFileName(options.name),
      mimeType: STUDIO_VRM_EXPORT_MIME_TYPE,
      buffers,
      metrics: {
        vertexCount,
        triangleCount: buffers.triangleCount,
        byteLength: bytes.byteLength,
        textureByteLength: textureBytes,
      },
    },
    warnings,
  );
}
