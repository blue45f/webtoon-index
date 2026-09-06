/**
 * Studio Path Tracer — 씬 계약 (studio-pathtrace-scene)
 *
 * 패스 트레이서가 먹는 유일한 입력 형식이다. three.js 를 import 하지 않는다 — 이미
 * 레포에 존재하는 순수 지오메트리 payload(`StudioBg3dCanonicalGeometryPayload`)와
 * 4x4 행렬만 받는다. three Object3D → payload 변환은 bg3d 소유 모듈의 책임이다
 * (통합 스펙 참조).
 *
 * 레이아웃
 *  - 전부 SoA typed array 다. `positions`(3*V f32), `indices`(3*T u32),
 *    `normals`(3*V f32 | null), `triMaterial`(T u32). 이 배열들은 그대로 WebGPU
 *    storage buffer 로 올라간다(변환 단계 없음).
 *  - 머티리얼/광원/환경/카메라는 개수가 작아 일반 객체 배열로 둔다(패커가 GPU 용
 *    Float32Array 로 굽는다).
 *
 * 정직한 한계 — Blender/Cycles 파리티가 **아니다**
 *  - **텍스처 없음.** albedo/normal/roughness 맵도, UV 샘플링도 없다. 상수 머티리얼만.
 *  - **투과/굴절 없음.** 유리·물·볼륨·SSS·참여 매질 전부 미구현. `ior` 는 유전체
 *    F0 계산에만 쓰인다.
 *  - **인스턴싱(TLAS) 없음.** 씬 전체를 단일 BLAS 로 평탄화한다 — 같은 모델 100개면
 *    삼각형도 100배다.
 *  - **면적 광원은 평행사변형 1종뿐**이고 지오메트리와 분리되어 있다(발광 삼각형은
 *    NEE 대상이 아니다).
 *  - 포인트 광원의 `radius` 는 섀도 소프트닝을 위한 위치 지터링이며, 엄밀한 구 광원
 *    적분이 아니다(델타로 취급 → MIS 대상 아님).
 */

import type { StudioBg3dCanonicalGeometryPayload } from "./bg3d/studio-bg3d-geometry-worker-protocol";
import type { StudioBg3dCameraSettings } from "./bg3d/studio-bg3d-scene-document";

export type StudioPathtraceVec3 = readonly [number, number, number];

/** 열 우선(three.js `Matrix4.elements` 와 동일) 4x4 행렬 16개. */
export type StudioPathtraceMatrix4 = readonly number[];

// ---------------------------------------------------------------------------
// 상한 — fail-closed 검증이 강제한다.
// ---------------------------------------------------------------------------

export const STUDIO_PATHTRACE_MAX_TRIANGLES = 500_000;
export const STUDIO_PATHTRACE_MAX_VERTICES = 1_000_000;
export const STUDIO_PATHTRACE_MAX_MATERIALS = 256;
export const STUDIO_PATHTRACE_MAX_LIGHTS = 64;
export const STUDIO_PATHTRACE_MAX_PIXELS = 4_194_304; // 2048×2048
/** 좌표 절댓값 상한 — bg3d 문서의 MAX_WORLD_COORDINATE 와 같은 자릿수. */
export const STUDIO_PATHTRACE_MAX_COORDINATE = 1_000_000;

// ---------------------------------------------------------------------------
// 머티리얼 / 광원 / 환경 / 카메라
// ---------------------------------------------------------------------------

export interface StudioPathtraceMaterial {
  /** 선형 공간 베이스 컬러(diffuse albedo 또는 metal F0). */
  readonly baseColorLinear: StudioPathtraceVec3;
  /** perceptual roughness ∈ [0,1]; alpha = roughness². */
  readonly roughness: number;
  /** 0 = 유전체, 1 = 금속. */
  readonly metallic: number;
  /** 선형 공간 자체 발광 radiance. */
  readonly emissiveLinear: StudioPathtraceVec3;
  /** 유전체 F0 = ((ior-1)/(ior+1))². ior = 1 이면 스페큘러가 완전히 꺼진다. */
  readonly ior: number;
}

export interface StudioPathtracePointLight {
  readonly kind: "point";
  readonly positionWorld: StudioPathtraceVec3;
  /** 선형 광도(W/sr 스케일 임의). 감쇠는 1/d². */
  readonly intensityLinear: StudioPathtraceVec3;
  /** > 0 이면 섀도 레이 목표점을 반지름 r 구 위에서 지터한다(소프트 섀도 근사). */
  readonly radius: number;
}

export interface StudioPathtraceAreaLight {
  readonly kind: "area";
  readonly origin: StudioPathtraceVec3;
  readonly edgeU: StudioPathtraceVec3;
  readonly edgeV: StudioPathtraceVec3;
  /** 선형 공간 emitted radiance(면적당이 아니라 radiance). */
  readonly emissiveLinear: StudioPathtraceVec3;
  readonly twoSided: boolean;
}

export type StudioPathtraceLight = StudioPathtracePointLight | StudioPathtraceAreaLight;

export interface StudioPathtraceConstantEnvironment {
  readonly kind: "constant";
  readonly radianceLinear: StudioPathtraceVec3;
}

export interface StudioPathtraceGradientEnvironment {
  readonly kind: "gradient";
  readonly zenithLinear: StudioPathtraceVec3;
  readonly horizonLinear: StudioPathtraceVec3;
}

export type StudioPathtraceEnvironment =
  | StudioPathtraceConstantEnvironment
  | StudioPathtraceGradientEnvironment;

export interface StudioPathtraceCamera {
  readonly position: StudioPathtraceVec3;
  readonly target: StudioPathtraceVec3;
  readonly up: StudioPathtraceVec3;
  readonly fovYRadians: number;
}

export interface StudioPathtraceScene {
  readonly positions: Float32Array;
  /** 셰이딩 노멀. null 이면 지오메트릭 노멀을 쓴다. */
  readonly normals: Float32Array | null;
  readonly indices: Uint32Array;
  readonly triMaterial: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly materials: readonly StudioPathtraceMaterial[];
  readonly lights: readonly StudioPathtraceLight[];
  readonly environment: StudioPathtraceEnvironment;
  readonly camera: StudioPathtraceCamera;
}

// ---------------------------------------------------------------------------
// 기본값
// ---------------------------------------------------------------------------

export const STUDIO_PATHTRACE_DEFAULT_MATERIAL: StudioPathtraceMaterial = {
  baseColorLinear: [0.8, 0.8, 0.8],
  roughness: 0.5,
  metallic: 0,
  emissiveLinear: [0, 0, 0],
  ior: 1.5,
};

export function createStudioPathtraceMaterial(
  overrides: Partial<StudioPathtraceMaterial> = {},
): StudioPathtraceMaterial {
  return { ...STUDIO_PATHTRACE_DEFAULT_MATERIAL, ...overrides };
}

// ---------------------------------------------------------------------------
// 빌더 — 삼각형을 누적한 뒤 finalize 로 SoA 를 굳힌다.
// ---------------------------------------------------------------------------

export interface StudioPathtraceSceneBuilder {
  readonly positions: number[];
  readonly normals: number[];
  readonly indices: number[];
  readonly triMaterial: number[];
  /** 노멀 속성이 하나라도 빠지면 씬 전체가 지오메트릭 노멀로 떨어진다. */
  hasAllNormals: boolean;
}

export function createStudioPathtraceSceneBuilder(): StudioPathtraceSceneBuilder {
  return { positions: [], normals: [], indices: [], triMaterial: [], hasAllNormals: true };
}

/**
 * 이미 삼각형화된 raw 배열을 추가한다(테스트/합성 씬용).
 * `indices` 는 `positions` 로컬 인덱스이며 빌더가 전역 오프셋을 더한다.
 */
export function appendStudioPathtraceTriangles(
  builder: StudioPathtraceSceneBuilder,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  materialIndex: number,
  normals?: ArrayLike<number> | null,
): void {
  const baseVertex = builder.positions.length / 3;
  for (let i = 0; i < positions.length; i += 1) builder.positions.push(positions[i]);
  if (normals && normals.length === positions.length) {
    for (let i = 0; i < normals.length; i += 1) builder.normals.push(normals[i]);
  } else {
    builder.hasAllNormals = false;
    for (let i = 0; i < positions.length; i += 1) builder.normals.push(0);
  }
  for (let i = 0; i < indices.length; i += 1) builder.indices.push(baseVertex + indices[i]);
  const triangles = Math.floor(indices.length / 3);
  for (let i = 0; i < triangles; i += 1) builder.triMaterial.push(materialIndex);
}

function transformPoint(m: StudioPathtraceMatrix4, x: number, y: number, z: number, out: number[]): void {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const invW = w === 0 ? 1 : 1 / w;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW;
}

/**
 * 법선 변환 — 비균등 스케일에서 정확하려면 역전치가 필요하지만, 여기서는 상삼각
 * 3x3 만 적용한 뒤 재정규화한다(균등/비균등 스케일 모두에서 방향은 맞고, 심한
 * 비등방 스케일에서만 오차가 남는다 — 정직한 한계).
 */
function transformDirection(m: StudioPathtraceMatrix4, x: number, y: number, z: number, out: number[]): void {
  const nx = m[0] * x + m[4] * y + m[8] * z;
  const ny = m[1] * x + m[5] * y + m[9] * z;
  const nz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0 || !Number.isFinite(len)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 1;
    return;
  }
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
}

export const STUDIO_PATHTRACE_IDENTITY_MATRIX4: StudioPathtraceMatrix4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * 정규 지오메트리 payload(PLY/STL 워커 산출물 또는 bg3d 브리지 산출물)를 월드 변환과
 * 함께 빌더에 붙인다. `kind !== "mesh"` 이거나 position 속성이 없으면 조용히 무시한다
 * (points 클라우드는 패스 트레이싱 대상이 아니다).
 */
export function appendStudioPathtraceMesh(
  builder: StudioPathtraceSceneBuilder,
  payload: StudioBg3dCanonicalGeometryPayload,
  worldMatrix: StudioPathtraceMatrix4,
  materialIndex: number,
): boolean {
  if (payload.kind !== "mesh") return false;
  const positionAttr = payload.attributes.find((a) => a.name === "position");
  if (!positionAttr || positionAttr.itemSize !== 3) return false;
  const normalAttr = payload.attributes.find((a) => a.name === "normal") ?? null;

  const src = new Float32Array(positionAttr.buffer);
  const vertexCount = positionAttr.count;
  const baseVertex = builder.positions.length / 3;
  const tmp: number[] = [0, 0, 0];
  for (let v = 0; v < vertexCount; v += 1) {
    transformPoint(worldMatrix, src[v * 3], src[v * 3 + 1], src[v * 3 + 2], tmp);
    builder.positions.push(tmp[0], tmp[1], tmp[2]);
  }
  if (normalAttr && normalAttr.itemSize === 3 && normalAttr.count === vertexCount) {
    const nsrc = new Float32Array(normalAttr.buffer);
    for (let v = 0; v < vertexCount; v += 1) {
      transformDirection(worldMatrix, nsrc[v * 3], nsrc[v * 3 + 1], nsrc[v * 3 + 2], tmp);
      builder.normals.push(tmp[0], tmp[1], tmp[2]);
    }
  } else {
    builder.hasAllNormals = false;
    for (let v = 0; v < vertexCount; v += 1) builder.normals.push(0, 0, 0);
  }

  if (payload.index) {
    const idx = new Uint32Array(payload.index.buffer);
    const count = Math.floor(payload.index.count / 3) * 3;
    for (let i = 0; i < count; i += 1) builder.indices.push(baseVertex + idx[i]);
    for (let i = 0; i < count / 3; i += 1) builder.triMaterial.push(materialIndex);
  } else {
    const count = Math.floor(vertexCount / 3) * 3;
    for (let i = 0; i < count; i += 1) builder.indices.push(baseVertex + i);
    for (let i = 0; i < count / 3; i += 1) builder.triMaterial.push(materialIndex);
  }
  return true;
}

export interface StudioPathtraceSceneFinalizeInput {
  readonly materials: readonly StudioPathtraceMaterial[];
  readonly lights: readonly StudioPathtraceLight[];
  readonly environment: StudioPathtraceEnvironment;
  readonly camera: StudioPathtraceCamera;
}

export function finalizeStudioPathtraceScene(
  builder: StudioPathtraceSceneBuilder,
  input: StudioPathtraceSceneFinalizeInput,
): StudioPathtraceScene {
  const positions = Float32Array.from(builder.positions);
  const indices = Uint32Array.from(builder.indices);
  const triMaterial = Uint32Array.from(builder.triMaterial);
  const normals = builder.hasAllNormals && builder.normals.length === builder.positions.length
    ? Float32Array.from(builder.normals)
    : null;
  return {
    positions,
    normals,
    indices,
    triMaterial,
    vertexCount: positions.length / 3,
    triangleCount: Math.floor(indices.length / 3),
    materials: input.materials.length > 0 ? input.materials : [STUDIO_PATHTRACE_DEFAULT_MATERIAL],
    lights: input.lights,
    environment: input.environment,
    camera: input.camera,
  };
}

// ---------------------------------------------------------------------------
// 카메라 어댑터
// ---------------------------------------------------------------------------

/**
 * bg3d 카메라 설정 → 패스트레이스 카메라. **핀홀 원근만** 지원하므로
 * `projection: "orthographic"` 은 무시하고 원근으로 취급한다(정직한 한계).
 * `zoom` 은 fov 를 나누는 방식으로만 반영하고 `lensShift` 는 지원하지 않는다.
 */
export function studioPathtraceCameraFromBg3d(
  settings: StudioBg3dCameraSettings,
  up: StudioPathtraceVec3 = [0, 1, 0],
): StudioPathtraceCamera {
  const zoom = settings.zoom && settings.zoom > 0 ? settings.zoom : 1;
  const fovDegrees = Math.min(179, Math.max(1, settings.fovDegrees / zoom));
  return {
    position: settings.position,
    target: settings.target,
    up,
    fovYRadians: (fovDegrees * Math.PI) / 180,
  };
}

// ---------------------------------------------------------------------------
// fail-closed 검증
// ---------------------------------------------------------------------------

export type StudioPathtraceSceneValidationCode =
  | "empty-geometry"
  | "index-count-not-multiple-of-3"
  | "triangle-budget-exceeded"
  | "vertex-budget-exceeded"
  | "material-budget-exceeded"
  | "light-budget-exceeded"
  | "tri-material-count-mismatch"
  | "index-out-of-range"
  | "material-index-out-of-range"
  | "non-finite-position"
  | "position-out-of-range"
  | "non-finite-normal"
  | "normal-count-mismatch"
  | "non-finite-material"
  | "invalid-material-range"
  | "non-finite-light"
  | "degenerate-area-light"
  | "non-finite-environment"
  | "non-finite-camera"
  | "degenerate-camera"
  | "invalid-fov";

export type StudioPathtraceSceneValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: StudioPathtraceSceneValidationCode; readonly detail: string };

function fail(
  code: StudioPathtraceSceneValidationCode,
  detail: string,
): StudioPathtraceSceneValidation {
  return { ok: false, code, detail };
}

function isFiniteVec3(v: StudioPathtraceVec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** 예외를 던지지 않는다 — 코드 판별자를 반환한다(호출부가 UI 메시지를 고른다). */
export function validateStudioPathtraceScene(scene: StudioPathtraceScene): StudioPathtraceSceneValidation {
  const { positions, indices, triMaterial, normals, materials, lights } = scene;
  if (indices.length === 0 || positions.length === 0) {
    return fail("empty-geometry", "삼각형이 하나도 없습니다.");
  }
  if (indices.length % 3 !== 0) {
    return fail("index-count-not-multiple-of-3", `indices.length=${indices.length}`);
  }
  const triangleCount = indices.length / 3;
  const vertexCount = positions.length / 3;
  if (triangleCount > STUDIO_PATHTRACE_MAX_TRIANGLES) {
    return fail("triangle-budget-exceeded", `${triangleCount} > ${STUDIO_PATHTRACE_MAX_TRIANGLES}`);
  }
  if (vertexCount > STUDIO_PATHTRACE_MAX_VERTICES) {
    return fail("vertex-budget-exceeded", `${vertexCount} > ${STUDIO_PATHTRACE_MAX_VERTICES}`);
  }
  if (materials.length === 0 || materials.length > STUDIO_PATHTRACE_MAX_MATERIALS) {
    return fail("material-budget-exceeded", `materials=${materials.length}`);
  }
  if (lights.length > STUDIO_PATHTRACE_MAX_LIGHTS) {
    return fail("light-budget-exceeded", `${lights.length} > ${STUDIO_PATHTRACE_MAX_LIGHTS}`);
  }
  if (triMaterial.length !== triangleCount) {
    return fail("tri-material-count-mismatch", `${triMaterial.length} !== ${triangleCount}`);
  }
  if (normals && normals.length !== positions.length) {
    return fail("normal-count-mismatch", `${normals.length} !== ${positions.length}`);
  }

  for (let i = 0; i < positions.length; i += 1) {
    const p = positions[i];
    if (!Number.isFinite(p)) return fail("non-finite-position", `positions[${i}]`);
    if (Math.abs(p) > STUDIO_PATHTRACE_MAX_COORDINATE) {
      return fail("position-out-of-range", `positions[${i}]=${p}`);
    }
  }
  if (normals) {
    for (let i = 0; i < normals.length; i += 1) {
      if (!Number.isFinite(normals[i])) return fail("non-finite-normal", `normals[${i}]`);
    }
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      return fail("index-out-of-range", `indices[${i}]=${indices[i]} >= ${vertexCount}`);
    }
  }
  for (let i = 0; i < triMaterial.length; i += 1) {
    if (triMaterial[i] >= materials.length) {
      return fail("material-index-out-of-range", `triMaterial[${i}]=${triMaterial[i]}`);
    }
  }

  for (let i = 0; i < materials.length; i += 1) {
    const m = materials[i];
    if (!isFiniteVec3(m.baseColorLinear) || !isFiniteVec3(m.emissiveLinear)) {
      return fail("non-finite-material", `materials[${i}] color`);
    }
    if (!Number.isFinite(m.roughness) || !Number.isFinite(m.metallic) || !Number.isFinite(m.ior)) {
      return fail("non-finite-material", `materials[${i}] scalar`);
    }
    if (m.roughness < 0 || m.roughness > 1 || m.metallic < 0 || m.metallic > 1 || m.ior < 1) {
      return fail("invalid-material-range", `materials[${i}]`);
    }
    if (m.baseColorLinear.some((c) => c < 0) || m.emissiveLinear.some((c) => c < 0)) {
      return fail("invalid-material-range", `materials[${i}] negative color`);
    }
  }

  for (let i = 0; i < lights.length; i += 1) {
    const l = lights[i];
    if (l.kind === "point") {
      if (!isFiniteVec3(l.positionWorld) || !isFiniteVec3(l.intensityLinear) || !Number.isFinite(l.radius)) {
        return fail("non-finite-light", `lights[${i}]`);
      }
    } else {
      if (
        !isFiniteVec3(l.origin)
        || !isFiniteVec3(l.edgeU)
        || !isFiniteVec3(l.edgeV)
        || !isFiniteVec3(l.emissiveLinear)
      ) {
        return fail("non-finite-light", `lights[${i}]`);
      }
      const cx = l.edgeU[1] * l.edgeV[2] - l.edgeU[2] * l.edgeV[1];
      const cy = l.edgeU[2] * l.edgeV[0] - l.edgeU[0] * l.edgeV[2];
      const cz = l.edgeU[0] * l.edgeV[1] - l.edgeU[1] * l.edgeV[0];
      if (Math.hypot(cx, cy, cz) <= 0) {
        return fail("degenerate-area-light", `lights[${i}] area=0`);
      }
    }
  }

  const env = scene.environment;
  const envOk = env.kind === "constant"
    ? isFiniteVec3(env.radianceLinear)
    : isFiniteVec3(env.zenithLinear) && isFiniteVec3(env.horizonLinear);
  if (!envOk) return fail("non-finite-environment", env.kind);

  const cam = scene.camera;
  if (!isFiniteVec3(cam.position) || !isFiniteVec3(cam.target) || !isFiniteVec3(cam.up)) {
    return fail("non-finite-camera", "position/target/up");
  }
  if (!Number.isFinite(cam.fovYRadians) || cam.fovYRadians <= 0 || cam.fovYRadians >= Math.PI) {
    return fail("invalid-fov", `${cam.fovYRadians}`);
  }
  const fx = cam.target[0] - cam.position[0];
  const fy = cam.target[1] - cam.position[1];
  const fz = cam.target[2] - cam.position[2];
  if (Math.hypot(fx, fy, fz) === 0) return fail("degenerate-camera", "position === target");
  const cross = Math.hypot(
    fy * cam.up[2] - fz * cam.up[1],
    fz * cam.up[0] - fx * cam.up[2],
    fx * cam.up[1] - fy * cam.up[0],
  );
  if (cross === 0) return fail("degenerate-camera", "up is parallel to view direction");

  return { ok: true };
}

/** 해상도 예산 검사(씬과 독립이라 별도 함수). */
export function isStudioPathtraceResolutionAllowed(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < 1 || height < 1) return false;
  return width * height <= STUDIO_PATHTRACE_MAX_PIXELS;
}
