// "3D 배경" 도구에 업로드한 커스텀 3D 모델(.glb/.gltf/.obj)의 씬 배치 순수 헬퍼 + 로더.
// studio-background-3d-primitives.ts(도형 프리미티브)의 관례를 그대로 따르되 그 파일은 이번 작업
// 범위(새 파일만 생성)상 절대 수정하지 않는다 — BgCustomModelInstance는 BgPrimitive의 새 kind가
// 아니라 완전히 별도인 인스턴스 목록으로, 씬 상태 상에서 구조적으로 구분된다(§5 통합 문서 참고,
// docs/studio-bg3d-custom-model-upload.md).
import * as THREE from "three";

import { loadStudioBg3dMeshoptDecoder } from "./bg3d/studio-bg3d-meshopt";
import {
  computeStudioBg3dAutoFitScale,
  STUDIO_BG3D_AUTO_FIT_TARGET_SIZE,
} from "./bg3d/studio-bg3d-model-scale-contract";
import { bakeStudioBg3dRigPoseLayer } from "./bg3d/studio-bg3d-rig-pose-bake";
import { isStudioBg3dThreeAnalyticIkMatrixSupported } from "./bg3d/studio-bg3d-three-hierarchy";
import { solveTwoBoneTarget } from "./studio-rig-two-bone-ik";

import type { Bg3dModelFormat } from "./bg3d/bg3d-model-library";
import type { StudioBg3dGlbValidationSuccess } from "./bg3d/studio-bg3d-glb-validation";
import type {
  StudioBg3dKtx2Renderer,
  StudioBg3dKtx2RendererRuntime,
} from "./bg3d/studio-bg3d-ktx2-renderer-runtime";
import type {
  StudioBg3dAnimationPlayback,
  StudioBg3dConstraintLayer,
  StudioBg3dMaterialOverride,
  StudioBg3dParsedGlbMetrics,
  StudioBg3dPoseLayer,
  StudioBg3dQuaternion,
  StudioBg3dMorphLayer,
  StudioBg3dSceneBudgets,
} from "./bg3d/studio-bg3d-scene-document";
import type { BgPrimitive } from "./studio-background-3d-primitives";

export interface BgCustomModelInstance {
  id: string;
  /** BG3D 로컬 SQLite/OPFS private id — 모델 바이너리 자체는 절대 씬 상태/직렬화에 포함되지 않는다. */
  modelId: string;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler XYZ, 라디안 — BgPrimitive와 동일 계약
  scale: [number, number, number];
  /** Optional user-defined name for the object list. */
  name?: string;
  /** When false, mesh is hidden in viewport/capture but kept in the scene graph. Default true. */
  visible?: boolean;
  /** When true, transform gizmo and numeric edits are blocked. Default false. */
  locked?: boolean;
  /** Parent entity ID for hierarchy grouping. null/undefined means root. */
  parentId?: string | null;
  /** Engine-neutral, per-instance adjustments applied to cloned materials only. */
  materialOverride?: StudioBg3dMaterialOverride;
  /** Optional clip playback state for animated glTF/FBX-derived assets. */
  animation?: StudioBg3dAnimationPlayback;
  /** Engine-neutral additive joint rotations applied after animation sampling. */
  pose?: StudioBg3dPoseLayer;
  /** Additive per-instance morph target offsets (expressions/deformations). */
  morph?: StudioBg3dMorphLayer;
  /** Non-destructive model-local joint aim constraints, applied after animation and pose. */
  constraints?: StudioBg3dConstraintLayer;
}

// PRIMITIVE_DEFS 도형들의 대략적인 크기 감각(반경 0.5~1m대)과 맞춘 오토핏 목표 치수.
// 레거시 단일-Blob .obj가 .mtl 없이 올라왔을 때 씌우는 무광 중립색 — 도형 프리셋
// 팔레트(예: box "#c9a876", cylinder "#9fb4c9")와 톤을 맞추되 특정 프리셋과 겹치지 않는
// 회색조를 고른다. 현행 다중 파일 가져오기는 OBJ와 MTL/텍스처를 함께 해석해 GLB로 정규화한다.
const BG3D_CUSTOM_MODEL_NEUTRAL_COLOR = "#b8b8c2";

function uid(): string {
  return `bg3dmodel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 반복 추가 시 매번 원점에 완전히 겹쳐 쌓이지 않도록 x축 결정적 지터를 준다 — createPrimitive와
// 동일한 패턴(studio-background-3d-primitives.ts). 정확한 위치는 사용자가 TransformControls로 잡는다.
export function createBgCustomModelInstance(
  modelId: string,
  existingCount: number,
  scale: [number, number, number] = [1, 1, 1]
): BgCustomModelInstance {
  const offsetX = (existingCount % 5) * 0.8;
  return {
    id: uid(),
    modelId,
    position: [offsetX, 0, 0],
    rotation: [0, 0, 0],
    scale: [...scale],
  };
}

export function duplicateBgCustomModelInstance(instance: BgCustomModelInstance): BgCustomModelInstance {
  return {
    ...instance,
    id: uid(),
    position: [instance.position[0] + 0.4, instance.position[1], instance.position[2] + 0.4],
    // 복제본은 편집 가능·표시 상태로 둔다(잠긴 원본을 복제해 곧바로 못 움직이는 함정 방지).
    locked: false,
    visible: instance.visible !== false,
  };
}

// undo/redo 스냅샷용 깊은 복제 — clonePrimitives와 동일한 이유로 필드별 스프레드를 쓴다
// (배열/문자열/숫자만 갖는 평평한 구조라 JSON 왕복보다 저렴).
export function cloneBgCustomModelInstances(instances: BgCustomModelInstance[]): BgCustomModelInstance[] {
  return instances.map((inst) => ({
    ...inst,
    position: [...inst.position] as [number, number, number],
    rotation: [...inst.rotation] as [number, number, number],
    scale: [...inst.scale] as [number, number, number],
    name: inst.name,
    visible: inst.visible,
    locked: inst.locked,
    parentId: inst.parentId,
    materialOverride: inst.materialOverride ? { ...inst.materialOverride } : undefined,
    animation: inst.animation ? { ...inst.animation } : undefined,
    pose: inst.pose ? {
      ...inst.pose,
      joints: inst.pose.joints.map((joint) => ({
        jointKey: joint.jointKey,
        rotationOffset: [...joint.rotationOffset],
      })),
    } : undefined,
    morph: inst.morph ? {
      ...inst.morph,
      targets: inst.morph.targets.map((target) => ({ ...target })),
    } : undefined,
    constraints: inst.constraints ? {
      ...inst.constraints,
      aims: (Array.isArray(inst.constraints.aims) ? inst.constraints.aims : [])
        .map((aim) => ({ ...aim, target: [...aim.target] })),
      twoBoneIks: (Array.isArray(inst.constraints.twoBoneIks) ? inst.constraints.twoBoneIks : [])
        .map((ik) => ({
          ...ik,
          target: [...ik.target],
          poleTarget: [...ik.poleTarget],
        })),
    } : undefined,
  }));
}

/**
 * 로드 직후 측정한 바운딩 박스 크기(measureBg3dObjectSize 참고)로부터, 모델의 최대 변이
 * targetSize(기본 2m — 도형 프리셋 감각과 맞춤)에 맞도록 균일 스케일 배율을 역산한다.
 * SketchUp(대개 인치 단위 원본을 그대로 내보냄)·Blender(미터)·기타 툴마다 내보내기 단위 관례가
 * 제각각이라, 업로드된 모델의 크기가 사방 몇 mm~몇 km까지 널뛸 수 있다 — 이 함수가 그 격차를
 * 보정하는 유일한 지점이다. 치수가 유한하지 않거나 0 이하(빈/퇴화 지오메트리 방어)면 1(무변경)을
 * 반환한다.
 */
export function computeAutoFitScale(
  boundingSize: [number, number, number],
  targetSize: number = STUDIO_BG3D_AUTO_FIT_TARGET_SIZE,
): number {
  return computeStudioBg3dAutoFitScale(boundingSize, targetSize);
}

/** 로드된 모델 루트의 월드축 정렬 바운딩 박스 변 길이(x/y/z)를 측정한다 — computeAutoFitScale의 입력. */
export function measureBg3dObjectSize(object: THREE.Object3D): [number, number, number] {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return [0, 0, 0];
  const size = box.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

/**
 * 현행 가져오기는 OBJ와 MTL/텍스처를 함께 받아 재질을 적용한 자체 포함 GLB로 정규화한다.
 * 이 함수는 그 경계 이전에 저장된 레거시 단일-Blob OBJ 또는 MTL이 없는 OBJ의 폴백이다.
 * 모든 메시에 도형 프리셋과 같은 계열의 무광 중립색 MeshStandardMaterial 하나를 공유시켜
 * "실루엣은 정확하되 색은 신경 안 써도 되는" 블록아웃 톤을 보장한다. 교체되는 원본
 * 머티리얼(들)은 즉시 dispose해 GPU 리소스가 새지 않게 한다.
 */
export function applyBg3dFallbackMaterial(root: THREE.Object3D, color: string = BG3D_CUSTOM_MODEL_NEUTRAL_COLOR): void {
  const material = new THREE.MeshStandardMaterial({ color });
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const prevMaterial = mesh.material;
    mesh.material = material;
    for (const mat of Array.isArray(prevMaterial) ? prevMaterial : [prevMaterial]) {
      mat.dispose();
    }
  });
}

/**
 * IndexedDB에서 꺼낸 blob을 GLTFLoader(.glb/.gltf)/OBJLoader(.obj)로 파싱해 씬에 넣을 수 있는
 * Object3D 루트를 만든다. StudioVrmPoser.tsx의 loadVrmAsset과 동일하게 로더를 동적 import
 * (three/examples/jsm)해 초기 번들을 무겁게 만들지 않는다.
 *
 * blob: URL은 이미 로컬 메모리에 있는 데이터(방금 IndexedDB에서 꺼낸 값)라, loadVrmAsset과 달리
 * resolveAssetUrl/HEAD 프리플라이트(HTML 폴백 감지)가 필요 없다 — 그 대상은 배포 오리진이 다를 수
 * 있는 root-relative 정적 경로(/vrm/..)뿐이고, blob: 스킴은 애초에 그 대상이 아니다
 * (loadVrmAsset의 shouldPreflightVrmUrl도 blob:을 프리플라이트 대상에서 제외한다).
 */
export async function loadBg3dCustomModelFromBlob(blob: Blob, format: Bg3dModelFormat): Promise<THREE.Object3D> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    if (format === "obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const root = await new OBJLoader().loadAsync(objectUrl);
      applyBg3dFallbackMaterial(root);
      return root;
    }

    // GLTFLoader는 .glb(바이너리)/.gltf(JSON) 콘텐츠를 자동 판별하므로 둘을 따로 분기할 필요가 없다.
    const [{ GLTFLoader }, meshoptDecoder] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      loadStudioBg3dMeshoptDecoder(),
    ]);
    const gltf = await new GLTFLoader().setMeshoptDecoder(meshoptDecoder).loadAsync(objectUrl);
    return gltf.scene;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/* ── 검증 완료 GLB → Three.js 안전 경계 ─────────────────────────────────────────────
   위 loadBg3dCustomModelFromBlob은 기존 프로젝트 호환을 위해 남겨 둔 레거시 경로다. 새 상용 경로는
   반드시 studio-bg3d-glb-validation.ts가 돌려준 성공 객체만 받고, URL·파일명·포맷 문자열을 받지
   않는다. 따라서 JSON glTF/OBJ나 외부 네트워크 리소스를 이 API로 우회해 넣을 수 없다. */

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;

export type StudioBg3dThreeFailureCode =
  | "invalid-verified-glb"
  | "invalid-budgets"
  | "model-byte-budget-exceeded"
  | "renderer-unavailable"
  | "ktx2-renderer-unavailable"
  | "ktx2-runtime-unavailable"
  | "ktx2-decode-failed"
  | "parse-failed"
  | "clone-failed"
  | "invalid-scene"
  | "unsafe-scene-metrics"
  | "node-budget-exceeded"
  | "triangle-budget-exceeded"
  | "draw-call-budget-exceeded"
  | "material-budget-exceeded"
  | "light-budget-exceeded"
  | "animation-count-budget-exceeded"
  | "animation-channel-budget-exceeded"
  | "animation-keyframe-budget-exceeded"
  | "animation-value-budget-exceeded"
  | "skin-count-budget-exceeded"
  | "joint-count-budget-exceeded"
  | "morph-target-budget-exceeded"
  | "accessor-element-budget-exceeded"
  | "geometry-memory-budget-exceeded"
  | "texture-count-budget-exceeded"
  | "texture-byte-budget-exceeded"
  | "texture-dimension-budget-exceeded";

export interface StudioBg3dThreeFailure {
  readonly ok: false;
  readonly code: StudioBg3dThreeFailureCode;
  /** 파일명, 파서 예외, 모델 메타데이터를 절대 섞지 않는 고정 UI 문구. */
  readonly message: string;
}

export interface StudioBg3dThreeMetricsSuccess {
  readonly ok: true;
  readonly metrics: StudioBg3dParsedGlbMetrics;
}

export type StudioBg3dThreeMetricsResult =
  | StudioBg3dThreeMetricsSuccess
  | StudioBg3dThreeFailure;

export interface StudioBg3dThreeDisposeSummary {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly renderTargets: number;
  readonly imageBitmaps: number;
}

export interface StudioBg3dThreeLoadSuccess {
  readonly ok: true;
  readonly code: "loaded";
  readonly message: string;
  /** glTF 기본 장면. 보조 장면까지 포함한 모든 소유 자원은 dispose()가 정리한다. */
  readonly root: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
  readonly metrics: StudioBg3dParsedGlbMetrics;
  /** Stable, privacy-safe runtime marker for local diagnostics and release telemetry. */
  readonly textureRuntime: "standard" | "ktx2-basis";
  /** React Strict Mode 정리처럼 여러 번 호출해도 실제 Three 자원은 한 번만 해제한다. */
  readonly dispose: () => StudioBg3dThreeDisposeSummary;
}

export type StudioBg3dThreeLoadResult =
  | StudioBg3dThreeLoadSuccess
  | StudioBg3dThreeFailure;

const THREE_FAILURE_MESSAGES: Readonly<Record<StudioBg3dThreeFailureCode, string>> =
  Object.freeze({
    "invalid-verified-glb": "검증 완료된 GLB 2.0 모델만 불러올 수 있습니다. 모델을 다시 등록해 주세요.",
    "invalid-budgets": "3D 모델 안전 기준을 확인할 수 없습니다. 작업공간을 새로고침해 주세요.",
    "model-byte-budget-exceeded": "이 장면의 3D 모델 용량 기준을 초과했습니다. 더 작은 모델을 사용해 주세요.",
    "renderer-unavailable": "3D 모델 처리기를 시작하지 못했습니다. 최신 브라우저에서 다시 시도해 주세요.",
    "ktx2-renderer-unavailable": "KTX2 텍스처를 표시할 3D 렌더러를 준비하지 못했습니다. 편집기를 다시 열어 주세요.",
    "ktx2-runtime-unavailable": "KTX2 텍스처 처리기를 안전하게 시작하지 못했습니다. 최신 브라우저에서 다시 시도해 주세요.",
    "ktx2-decode-failed": "KTX2 텍스처를 표시 형식으로 변환하지 못했습니다. 모델 텍스처를 다시 내보내 주세요.",
    "parse-failed": "3D 모델을 안전하게 해석하지 못했습니다. GLB 2.0으로 다시 내보내 주세요.",
    "clone-failed": "3D 모델 인스턴스를 복제하지 못했습니다. 모델을 다시 불러와 주세요.",
    "invalid-scene": "3D 모델에 표시할 수 있는 기본 장면이 없습니다. 모델을 다시 내보내 주세요.",
    "unsafe-scene-metrics": "3D 모델의 렌더링 복잡도를 안전하게 계산할 수 없습니다. 모델을 단순화해 주세요.",
    "node-budget-exceeded": "이 장면의 3D 노드 수 기준을 초과했습니다. 모델 계층을 단순화해 주세요.",
    "triangle-budget-exceeded": "이 장면의 삼각형 수 기준을 초과했습니다. 메시를 경량화해 주세요.",
    "draw-call-budget-exceeded": "이 장면의 드로콜 기준을 초과했습니다. 메시와 재질을 병합해 주세요.",
    "material-budget-exceeded": "이 장면의 재질 수 기준을 초과했습니다. 재질을 정리하거나 병합해 주세요.",
    "light-budget-exceeded": "이 장면의 조명 수 기준을 초과했습니다. 조명 수를 줄여 주세요.",
    "animation-count-budget-exceeded": "이 장면의 애니메이션 클립 수 기준을 초과했습니다. 사용하지 않는 동작을 정리해 주세요.",
    "animation-channel-budget-exceeded": "이 장면의 애니메이션 채널 수 기준을 초과했습니다. 트랙을 단순화해 주세요.",
    "animation-keyframe-budget-exceeded": "이 장면의 애니메이션 키프레임 기준을 초과했습니다. 키프레임을 줄여 주세요.",
    "animation-value-budget-exceeded": "이 장면의 애니메이션 메모리 기준을 초과했습니다. 애니메이션을 압축해 주세요.",
    "skin-count-budget-exceeded": "이 장면의 스킨 수 기준을 초과했습니다. 리깅 구조를 단순화해 주세요.",
    "joint-count-budget-exceeded": "이 장면의 조인트 수 기준을 초과했습니다. 본 구조를 단순화해 주세요.",
    "morph-target-budget-exceeded": "이 장면의 모프 타깃 수 기준을 초과했습니다. 표정·변형 타깃을 정리해 주세요.",
    "accessor-element-budget-exceeded": "이 장면의 3D 데이터 요소 수 기준을 초과했습니다. 메시와 애니메이션을 단순화해 주세요.",
    "geometry-memory-budget-exceeded": "이 장면의 디코딩된 3D 데이터 메모리 기준을 초과했습니다. 모델을 최적화해 주세요.",
    "texture-count-budget-exceeded": "이 장면의 텍스처 개수 기준을 초과했습니다. 텍스처를 정리해 주세요.",
    "texture-byte-budget-exceeded": "이 장면의 디코딩 텍스처 메모리 기준을 초과했습니다. 텍스처를 축소해 주세요.",
    "texture-dimension-budget-exceeded": "이 장면의 텍스처 해상도 기준을 초과했습니다. 텍스처 크기를 낮춰 주세요.",
  });

function threeFailure(code: StudioBg3dThreeFailureCode): StudioBg3dThreeFailure {
  return Object.freeze({ ok: false, code, message: THREE_FAILURE_MESSAGES[code] });
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeAdd(left: number, right: number): number | null {
  if (!isSafeCount(left) || !isSafeCount(right) || left > Number.MAX_SAFE_INTEGER - right) {
    return null;
  }
  return left + right;
}

function safeMultiply(left: number, right: number): number | null {
  if (!isSafeCount(left) || !isSafeCount(right)) return null;
  if (left === 0 || right === 0) return 0;
  if (left > Math.floor(Number.MAX_SAFE_INTEGER / right)) return null;
  return left * right;
}

function isObject3d(value: unknown): value is THREE.Object3D {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { isObject3D?: unknown }).isObject3D === true &&
      typeof (value as { traverse?: unknown }).traverse === "function"
  );
}

function uniqueRoots(rootOrRoots: THREE.Object3D | readonly THREE.Object3D[]): readonly THREE.Object3D[] {
  return [...new Set(Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots])];
}

function normalizedElementRange(
  geometry: THREE.BufferGeometry
): { readonly start: number; readonly end: number } | null {
  const elementCount = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  if (!isSafeCount(elementCount)) return null;
  const start = geometry.drawRange.start;
  const count = geometry.drawRange.count;
  if (!isSafeCount(start) || !(count === Number.POSITIVE_INFINITY || isSafeCount(count))) return null;
  const clampedStart = Math.min(start, elementCount);
  if (count === Number.POSITIVE_INFINITY) return { start: clampedStart, end: elementCount };
  const unclampedEnd = safeAdd(clampedStart, count);
  if (unclampedEnd === null) return null;
  return { start: clampedStart, end: Math.min(unclampedEnd, elementCount) };
}

function groupIntersectionElements(
  group: THREE.BufferGeometry["groups"][number],
  range: { readonly start: number; readonly end: number }
): number | null {
  if (!isSafeCount(group.start) || !isSafeCount(group.count)) return null;
  const groupEnd = safeAdd(group.start, group.count);
  if (groupEnd === null) return null;
  return Math.max(0, Math.min(groupEnd, range.end) - Math.max(group.start, range.start));
}

interface MeshRenderWork {
  readonly triangles: number;
  readonly drawCalls: number;
}

interface GroupedRenderWork {
  readonly elements: number;
  readonly drawCalls: number;
}

function measureGroupedRenderWork(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[]
): GroupedRenderWork | null {
  const range = normalizedElementRange(geometry);
  if (!range) return null;

  let elements = range.end - range.start;
  let drawCalls = elements > 0 ? 1 : 0;
  if (Array.isArray(material) && geometry.groups.length > 0) {
    elements = 0;
    drawCalls = 0;
    for (const group of geometry.groups) {
      const groupElements = groupIntersectionElements(group, range);
      if (groupElements === null) return null;
      if (groupElements > 0) {
        const nextDrawCalls = safeAdd(drawCalls, 1);
        if (nextDrawCalls === null) return null;
        drawCalls = nextDrawCalls;
      }
      const nextElements = safeAdd(elements, groupElements);
      if (nextElements === null) return null;
      elements = nextElements;
    }
  }
  return { elements, drawCalls };
}

function measureMeshRenderWork(mesh: THREE.Mesh): MeshRenderWork | null {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return null;
  const grouped = measureGroupedRenderWork(geometry, mesh.material);
  if (!grouped) return null;

  // glTF/Three Mesh는 삼각형 목록이며, 완성되지 않은 마지막 1~2개 인덱스는 그려지지 않는다.
  const baseTriangles = Math.floor(grouped.elements / 3);
  const instanceCount = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
  if (!isSafeCount(instanceCount)) return null;
  const triangles = safeMultiply(baseTriangles, instanceCount);
  if (triangles === null) return null;
  return { triangles, drawCalls: grouped.drawCalls };
}

function measureNonTriangleRenderWork(
  object: THREE.Line | THREE.Points
): MeshRenderWork | null {
  if (!(object.geometry instanceof THREE.BufferGeometry)) return null;
  const grouped = measureGroupedRenderWork(object.geometry, object.material);
  return grouped ? { triangles: 0, drawCalls: grouped.drawCalls } : null;
}

interface TextureMetric {
  readonly decodedBytes: number;
  readonly maxDimension: number;
}

interface ImageSourceMetric extends TextureMetric {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

const MIPMAP_MIN_FILTERS: ReadonlySet<number> = new Set([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

function dimension(value: unknown, fallbackKeys: readonly string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  let largest = 0;
  for (const key of fallbackKeys) {
    const candidate = record[key];
    if (isSafeCount(candidate) && candidate > largest) largest = candidate;
  }
  return largest > 0 ? largest : null;
}

function bufferByteLength(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

function measureImageSource(value: unknown): ImageSourceMetric | null {
  if (!value || typeof value !== "object") return null;
  const width = dimension(value, ["width", "naturalWidth", "videoWidth"]);
  const height = dimension(value, ["height", "naturalHeight", "videoHeight"]);
  if (width === null || height === null) return null;
  const record = value as Record<string, unknown>;
  const depthValue = record.depth;
  const depth = depthValue === undefined ? 1 : depthValue;
  if (!isSafeCount(depth) || depth < 1) return null;
  const pixels = safeMultiply(width, height);
  const volumePixels = pixels === null ? null : safeMultiply(pixels, depth);
  const rgbaBytes = volumePixels === null ? null : safeMultiply(volumePixels, 4);
  if (rgbaBytes === null) return null;
  return {
    decodedBytes: Math.max(rgbaBytes, bufferByteLength(record.data)),
    maxDimension: Math.max(width, height),
    width,
    height,
    depth,
  };
}

function measureAutomaticMipChain(source: ImageSourceMetric, reduceDepth: boolean): number | null {
  const basePixels = safeMultiply(source.width, source.height);
  const baseTexels = basePixels === null ? null : safeMultiply(basePixels, source.depth);
  if (baseTexels === null || baseTexels === 0) return null;
  const bytesPerTexel = Math.ceil(source.decodedBytes / baseTexels);
  if (!isSafeCount(bytesPerTexel) || bytesPerTexel < 1) return null;

  let width = source.width;
  let height = source.height;
  let depth = source.depth;
  let total = 0;
  while (true) {
    const pixels = safeMultiply(width, height);
    const texels = pixels === null ? null : safeMultiply(pixels, depth);
    const levelBytes = texels === null ? null : safeMultiply(texels, bytesPerTexel);
    const nextTotal = levelBytes === null ? null : safeAdd(total, levelBytes);
    if (nextTotal === null) return null;
    total = nextTotal;
    if (width === 1 && height === 1 && (!reduceDepth || depth === 1)) return total;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    if (reduceDepth) depth = Math.max(1, Math.floor(depth / 2));
  }
}

function measureTexture(texture: THREE.Texture): TextureMetric | null {
  // Three.js는 수동 mipmap 배열의 0번 항목을 base level로 업로드하고 source image는 업로드하지
  // 않는다. 따라서 명시된 체인은 그 배열만 합산해 source/자동 체인과 중복 계산하지 않는다.
  if (texture.mipmaps.length > 0) {
    let decodedBytes = 0;
    let maxDimension = 0;
    for (const mipmap of texture.mipmaps) {
      const measured = measureImageSource(mipmap);
      if (!measured) return null;
      const nextBytes = safeAdd(decodedBytes, measured.decodedBytes);
      if (nextBytes === null) return null;
      decodedBytes = nextBytes;
      maxDimension = Math.max(maxDimension, measured.maxDimension);
    }
    return { decodedBytes, maxDimension };
  }

  const sourceData = texture.source?.data ?? texture.image;
  const sources = sourceData === null || sourceData === undefined
    ? []
    : Array.isArray(sourceData) ? sourceData : [sourceData];
  if (sources.length === 0) return null;
  const automaticMipmaps = texture.generateMipmaps && MIPMAP_MIN_FILTERS.has(texture.minFilter);
  const reduceDepth = (texture as THREE.Texture & { isData3DTexture?: boolean }).isData3DTexture === true;
  let decodedBytes = 0;
  let maxDimension = 0;
  for (const source of sources) {
    const measured = measureImageSource(source);
    if (!measured) return null;
    const sourceBytes = automaticMipmaps
      ? measureAutomaticMipChain(measured, reduceDepth)
      : measured.decodedBytes;
    if (sourceBytes === null) return null;
    const nextBytes = safeAdd(decodedBytes, sourceBytes);
    if (nextBytes === null) return null;
    decodedBytes = nextBytes;
    maxDimension = Math.max(maxDimension, measured.maxDimension);
  }
  return { decodedBytes, maxDimension };
}

interface ThreeResources {
  readonly geometries: Set<THREE.BufferGeometry>;
  readonly materials: Set<THREE.Material>;
  readonly textures: Set<THREE.Texture>;
  readonly renderTargets: Set<THREE.RenderTarget>;
  readonly imageBitmaps: Set<ImageBitmap>;
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  if (!value || typeof value !== "object" || typeof (value as { close?: unknown }).close !== "function") {
    return false;
  }
  const ImageBitmapConstructor = globalThis.ImageBitmap;
  if (typeof ImageBitmapConstructor === "function" && value instanceof ImageBitmapConstructor) return true;
  return Object.prototype.toString.call(value) === "[object ImageBitmap]";
}

function addImageBitmaps(value: unknown, imageBitmaps: Set<ImageBitmap>, seen: WeakSet<object>): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (isImageBitmap(value)) {
    imageBitmaps.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addImageBitmaps(item, imageBitmaps, seen);
  }
}

function collectThreeResources(roots: readonly THREE.Object3D[]): ThreeResources {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const renderTargets = new Set<THREE.RenderTarget>();
  const imageBitmaps = new Set<ImageBitmap>();
  const scannedValues = new WeakSet<object>();
  const scannedImages = new WeakSet<object>();

  const scanValue = (value: unknown): void => {
    if (!value || typeof value !== "object" || scannedValues.has(value)) return;
    scannedValues.add(value);
    if (value instanceof THREE.Texture) {
      textures.add(value);
      addImageBitmaps(value.source?.data ?? value.image, imageBitmaps, scannedImages);
      addImageBitmaps(value.mipmaps, imageBitmaps, scannedImages);
      if (value.renderTarget) scanValue(value.renderTarget);
      return;
    }
    if (value instanceof THREE.RenderTarget) {
      renderTargets.add(value);
      for (const texture of value.textures) scanValue(texture);
      if (value.depthTexture) scanValue(value.depthTexture);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scanValue(item);
      return;
    }
    if (value instanceof Map || value instanceof Set) {
      for (const item of value.values()) scanValue(item);
      return;
    }
    // ShaderMaterial uniforms는 { value: Texture }의 중첩 레코드다. 순환은 WeakSet으로 끊는다.
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null || "value" in value) {
      for (const item of Object.values(value as Record<string, unknown>)) scanValue(item);
    }
  };

  const addMaterial = (material: THREE.Material): void => {
    if (materials.has(material)) return;
    materials.add(material);
    for (const value of Object.values(material as unknown as Record<string, unknown>)) scanValue(value);
  };

  const seenObjects = new Set<THREE.Object3D>();
  for (const root of roots) {
    root.traverse((object) => {
      if (seenObjects.has(object)) return;
      seenObjects.add(object);
      const renderable = object as THREE.Object3D & {
        geometry?: unknown;
        material?: unknown;
        skeleton?: THREE.Skeleton;
      };
      if (renderable.geometry instanceof THREE.BufferGeometry) geometries.add(renderable.geometry);
      const objectMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of objectMaterials) {
        if (material instanceof THREE.Material) addMaterial(material);
      }
      if (renderable.skeleton?.boneTexture) scanValue(renderable.skeleton.boneTexture);
    });
  }
  return { geometries, materials, textures, renderTargets, imageBitmaps };
}

/**
 * 파싱된 Three 장면의 실제 렌더 작업량을 다시 측정한다. 공유 geometry도 각 배치/인스턴스의
 * 삼각형 작업에는 반복 반영하되, 재질·텍스처 GPU 자원은 객체 동일성 기준으로 한 번만 센다.
 */
export function measureStudioBg3dThreeMetrics(
  rootOrRoots: THREE.Object3D | readonly THREE.Object3D[],
  animations: readonly THREE.AnimationClip[] = [],
): StudioBg3dThreeMetricsResult {
  const roots = uniqueRoots(rootOrRoots);
  if (roots.length === 0 || roots.some((root) => !isObject3d(root))) return threeFailure("invalid-scene");
  if (!Array.isArray(animations)) return threeFailure("unsafe-scene-metrics");

  const resources = collectThreeResources(roots);
  let nodes = 0;
  let triangles = 0;
  let drawCalls = 0;
  let lights = 0;
  const skeletons = new Set<THREE.Skeleton>();
  const decodedArrays = new Set<ArrayBufferView>();
  let accessorElements = 0;
  const seenObjects = new Set<THREE.Object3D>();
  let unsafe = false;
  for (const root of roots) {
    root.traverse((object) => {
      if (unsafe || seenObjects.has(object)) return;
      seenObjects.add(object);
      const nextNodes = safeAdd(nodes, 1);
      if (nextNodes === null) {
        unsafe = true;
        return;
      }
      nodes = nextNodes;
      if ((object as THREE.Light).isLight) {
        const nextLights = safeAdd(lights, 1);
        if (nextLights === null) {
          unsafe = true;
          return;
        }
        lights = nextLights;
      }
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        const skeleton = (object as THREE.SkinnedMesh).skeleton;
        if (!(skeleton instanceof THREE.Skeleton)) {
          unsafe = true;
          return;
        }
        skeletons.add(skeleton);
      }
      let work: MeshRenderWork | null;
      if ((object as THREE.Mesh).isMesh) work = measureMeshRenderWork(object as THREE.Mesh);
      else if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints) {
        work = measureNonTriangleRenderWork(object as THREE.Line | THREE.Points);
      } else return;
      if (!work) {
        unsafe = true;
        return;
      }
      const nextTriangles = safeAdd(triangles, work.triangles);
      const nextDrawCalls = safeAdd(drawCalls, work.drawCalls);
      if (nextTriangles === null || nextDrawCalls === null) {
        unsafe = true;
        return;
      }
      triangles = nextTriangles;
      drawCalls = nextDrawCalls;
    });
  }
  if (unsafe) return threeFailure("unsafe-scene-metrics");

  let joints = 0;
  for (const skeleton of skeletons) {
    const nextJoints = safeAdd(joints, skeleton.bones.length);
    if (nextJoints === null) return threeFailure("unsafe-scene-metrics");
    joints = nextJoints;
    const nextAccessorElements = safeAdd(accessorElements, skeleton.boneInverses.length);
    if (nextAccessorElements === null || !ArrayBuffer.isView(skeleton.boneMatrices)) {
      return threeFailure("unsafe-scene-metrics");
    }
    accessorElements = nextAccessorElements;
    decodedArrays.add(skeleton.boneMatrices);
  }

  let morphTargets = 0;
  for (const geometry of resources.geometries) {
    const morphAttributeSets = Object.values(geometry.morphAttributes);
    if (morphAttributeSets.some((attributes) => !Array.isArray(attributes))) {
      return threeFailure("unsafe-scene-metrics");
    }
    // A single glTF morph target can contain POSITION, NORMAL, and TANGENT accessors. Three keeps
    // those semantics in parallel arrays, so the largest semantic-array length is the number of
    // target records for this primitive; summing the arrays would count one target up to 3 times.
    const targetCount = morphAttributeSets.reduce(
      (largest, attributes) => Math.max(largest, attributes.length),
      0,
    );
    const nextMorphTargets = safeAdd(morphTargets, targetCount);
    if (nextMorphTargets === null) return threeFailure("unsafe-scene-metrics");
    morphTargets = nextMorphTargets;
    const attributes = [
      geometry.index,
      ...Object.values(geometry.attributes),
      ...Object.values(geometry.morphAttributes).flat(),
    ].filter((attribute): attribute is THREE.BufferAttribute | THREE.InterleavedBufferAttribute => Boolean(attribute));
    const uniqueAttributes = new Set(attributes);
    for (const attribute of uniqueAttributes) {
      if (!isSafeCount(attribute.count)) return threeFailure("unsafe-scene-metrics");
      const nextAccessorElements = safeAdd(accessorElements, attribute.count);
      const array = attribute instanceof THREE.InterleavedBufferAttribute
        ? attribute.data.array
        : attribute.array;
      if (nextAccessorElements === null || !ArrayBuffer.isView(array)) {
        return threeFailure("unsafe-scene-metrics");
      }
      accessorElements = nextAccessorElements;
      decodedArrays.add(array);
    }
  }

  let animationChannels = 0;
  let animationKeyframes = 0;
  let animationValues = 0;
  for (const clip of animations) {
    if (!(clip instanceof THREE.AnimationClip) || !Array.isArray(clip.tracks)) {
      return threeFailure("unsafe-scene-metrics");
    }
    const nextChannels = safeAdd(animationChannels, clip.tracks.length);
    if (nextChannels === null) return threeFailure("unsafe-scene-metrics");
    animationChannels = nextChannels;
    for (const track of clip.tracks) {
      const times = track.times;
      const values = track.values;
      if (
        !times
        || !values
        || !isSafeCount(times.length)
        || !isSafeCount(values.length)
        || (times.length === 0 && values.length !== 0)
        || (times.length > 0 && values.length % times.length !== 0)
      ) {
        return threeFailure("unsafe-scene-metrics");
      }
      const nextKeyframes = safeAdd(animationKeyframes, times.length);
      const nextValues = safeAdd(animationValues, values.length);
      if (nextKeyframes === null || nextValues === null) return threeFailure("unsafe-scene-metrics");
      animationKeyframes = nextKeyframes;
      animationValues = nextValues;
      const outputElementCount = track.getValueSize() > 0
        ? Math.ceil(values.length / track.getValueSize())
        : Number.NaN;
      const nextAccessorElements = Number.isSafeInteger(outputElementCount)
        ? safeAdd(accessorElements, times.length + outputElementCount)
        : null;
      if (
        nextAccessorElements === null ||
        !ArrayBuffer.isView(times) ||
        !ArrayBuffer.isView(values)
      ) {
        return threeFailure("unsafe-scene-metrics");
      }
      accessorElements = nextAccessorElements;
      decodedArrays.add(times);
      decodedArrays.add(values);
    }
  }

  let estimatedDecodedGeometryBytes = 0;
  for (const array of decodedArrays) {
    const nextBytes = safeAdd(estimatedDecodedGeometryBytes, array.byteLength);
    if (nextBytes === null) return threeFailure("unsafe-scene-metrics");
    estimatedDecodedGeometryBytes = nextBytes;
  }

  let textureBytes = 0;
  let maxTextureDimension = 0;
  for (const texture of resources.textures) {
    const measured = measureTexture(texture);
    if (!measured) return threeFailure("unsafe-scene-metrics");
    const nextTextureBytes = safeAdd(textureBytes, measured.decodedBytes);
    if (nextTextureBytes === null) return threeFailure("unsafe-scene-metrics");
    textureBytes = nextTextureBytes;
    maxTextureDimension = Math.max(maxTextureDimension, measured.maxDimension);
  }

  return Object.freeze({
    ok: true,
    metrics: Object.freeze({
      nodes,
      triangles,
      drawCalls,
      materials: resources.materials.size,
      lights,
      animations: animations.length,
      animationChannels,
      animationKeyframes,
      animationValues,
      skins: skeletons.size,
      joints,
      morphTargets,
      accessorElements,
      estimatedDecodedGeometryBytes,
      textures: resources.textures.size,
      textureBytes,
      maxTextureDimension,
    }),
  });
}

function validBudgets(budgets: StudioBg3dSceneBudgets): boolean {
  if (!budgets || typeof budgets !== "object") return false;
  const values = [
    budgets.complexity?.maxNodes,
    budgets.complexity?.maxTriangles,
    budgets.complexity?.maxDrawCalls,
    budgets.complexity?.maxMaterials,
    budgets.complexity?.maxLights,
    budgets.complexity?.maxAnimations,
    budgets.complexity?.maxAnimationChannels,
    budgets.complexity?.maxAnimationKeyframes,
    budgets.complexity?.maxAnimationValues,
    budgets.complexity?.maxSkins,
    budgets.complexity?.maxJoints,
    budgets.complexity?.maxMorphTargets,
    budgets.complexity?.maxAccessorElements,
    budgets.complexity?.maxDecodedGeometryBytes,
    budgets.complexity?.maxModelBytes,
    budgets.textures?.maxTextures,
    budgets.textures?.maxTotalBytes,
    budgets.textures?.maxDimension,
  ];
  return values.every(isSafeCount);
}

function validParsedMetrics(metrics: StudioBg3dParsedGlbMetrics): boolean {
  if (!metrics || typeof metrics !== "object") return false;
  return [
    metrics.nodes,
    metrics.triangles,
    metrics.drawCalls,
    metrics.materials,
    metrics.lights,
    metrics.animations,
    metrics.animationChannels,
    metrics.animationKeyframes,
    metrics.animationValues,
    metrics.skins,
    metrics.joints,
    metrics.morphTargets,
    metrics.accessorElements,
    metrics.estimatedDecodedGeometryBytes,
    metrics.textures,
    metrics.textureBytes,
    metrics.maxTextureDimension,
  ].every(isSafeCount);
}

/** 검사 결과가 null이면 예산을 통과했다. */
export function checkStudioBg3dThreeBudgets(
  metrics: StudioBg3dParsedGlbMetrics,
  budgets: StudioBg3dSceneBudgets
): StudioBg3dThreeFailure | null {
  if (!validBudgets(budgets)) return threeFailure("invalid-budgets");
  if (!validParsedMetrics(metrics)) return threeFailure("unsafe-scene-metrics");
  if (metrics.nodes > budgets.complexity.maxNodes) return threeFailure("node-budget-exceeded");
  if (metrics.triangles > budgets.complexity.maxTriangles) return threeFailure("triangle-budget-exceeded");
  if (metrics.drawCalls > budgets.complexity.maxDrawCalls) return threeFailure("draw-call-budget-exceeded");
  if (metrics.materials > budgets.complexity.maxMaterials) return threeFailure("material-budget-exceeded");
  if (metrics.lights > budgets.complexity.maxLights) return threeFailure("light-budget-exceeded");
  if (metrics.animations > budgets.complexity.maxAnimations) return threeFailure("animation-count-budget-exceeded");
  if (metrics.animationChannels > budgets.complexity.maxAnimationChannels) return threeFailure("animation-channel-budget-exceeded");
  if (metrics.animationKeyframes > budgets.complexity.maxAnimationKeyframes) return threeFailure("animation-keyframe-budget-exceeded");
  if (metrics.animationValues > budgets.complexity.maxAnimationValues) return threeFailure("animation-value-budget-exceeded");
  if (metrics.skins > budgets.complexity.maxSkins) return threeFailure("skin-count-budget-exceeded");
  if (metrics.joints > budgets.complexity.maxJoints) return threeFailure("joint-count-budget-exceeded");
  if (metrics.morphTargets > budgets.complexity.maxMorphTargets) return threeFailure("morph-target-budget-exceeded");
  if (metrics.accessorElements > budgets.complexity.maxAccessorElements) return threeFailure("accessor-element-budget-exceeded");
  if (metrics.estimatedDecodedGeometryBytes > budgets.complexity.maxDecodedGeometryBytes) {
    return threeFailure("geometry-memory-budget-exceeded");
  }
  if (metrics.textures > budgets.textures.maxTextures) return threeFailure("texture-count-budget-exceeded");
  if (metrics.textureBytes > budgets.textures.maxTotalBytes) return threeFailure("texture-byte-budget-exceeded");
  if (metrics.maxTextureDimension > budgets.textures.maxDimension) {
    return threeFailure("texture-dimension-budget-exceeded");
  }
  return null;
}

function disposeThreeResourceSnapshot(resources: ThreeResources): StudioBg3dThreeDisposeSummary {
  for (const geometry of resources.geometries) {
    try { geometry.dispose(); } catch { /* 다음 자원을 계속 정리한다. */ }
  }
  for (const material of resources.materials) {
    try { material.dispose(); } catch { /* 다음 자원을 계속 정리한다. */ }
  }
  for (const texture of resources.textures) {
    try { texture.dispose(); } catch { /* 다음 자원을 계속 정리한다. */ }
  }
  for (const renderTarget of resources.renderTargets) {
    try { renderTarget.dispose(); } catch { /* 다음 자원을 계속 정리한다. */ }
  }
  for (const bitmap of resources.imageBitmaps) {
    try { bitmap.close(); } catch { /* 이미 닫혔어도 전체 정리를 중단하지 않는다. */ }
  }
  return Object.freeze({
    geometries: resources.geometries.size,
    materials: resources.materials.size,
    textures: resources.textures.size,
    renderTargets: resources.renderTargets.size,
    imageBitmaps: resources.imageBitmaps.size,
  });
}

/**
 * 호출 시점 장면의 geometry/material/texture/렌더타깃/ImageBitmap을 객체 동일성 기준으로
 * 정확히 한 번씩 정리하는 편의 API. 로더 소유권 정리에는 아래 성공 시점 snapshot을 사용한다.
 */
export function disposeStudioBg3dThreeResources(
  rootOrRoots: THREE.Object3D | readonly THREE.Object3D[]
): StudioBg3dThreeDisposeSummary {
  return disposeThreeResourceSnapshot(collectThreeResources(uniqueRoots(rootOrRoots)));
}

/** 스킨 메시가 있으면 SkeletonUtils.clone으로 뼈/스켈레톤 바인딩까지 독립 복제한다. */
export async function cloneStudioBg3dThreeObject(root: THREE.Object3D): Promise<THREE.Object3D> {
  try {
    let hasSkinnedContent = false;
    root.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedContent = true;
    });
    if (!hasSkinnedContent) return root.clone(true);
    const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
    return clone(root);
  } catch {
    throw new StudioBg3dThreeOperationError("clone-failed");
  }
}

interface StudioBg3dEditableMaterialBinding {
  readonly source: THREE.Material;
  readonly editable: THREE.Material;
}

export interface StudioBg3dThreeJointDescriptor {
  readonly key: string;
  /** First stable key for this physical bone across every skin that aliases it. */
  readonly canonicalKey: string;
  readonly name: string;
  readonly skinIndex: number;
  readonly jointIndex: number;
  /** Canonical parent ordinal when the parent belongs to the same skin. */
  readonly parentKey: string | null;
  /** Rest-pose joint origin in model-root local coordinates, for IK authoring defaults. */
  readonly restPosition: readonly [number, number, number];
}

interface StudioBg3dThreeJointBinding {
  readonly descriptor: StudioBg3dThreeJointDescriptor;
  readonly bone: THREE.Bone;
  readonly restRotation: THREE.Quaternion;
}

export interface StudioBg3dThreePoseController {
  readonly joints: readonly StudioBg3dThreeJointDescriptor[];
  restoreRestPose(): void;
  /** Removes the last additive layer while preserving the underlying animation/rest sample. */
  removeAppliedPoseOffsets(): void;
  /** Applies additive offsets to the current animation/rest sample. */
  applyToCurrentPose(pose: StudioBg3dPoseLayer | undefined): void;
  /** Applies analytic two-bone IK, then single-joint aims, after animation and additive pose. */
  applyConstraints(constraints: StudioBg3dConstraintLayer | undefined): void;
  /** Captures the last fully successful pose + constraint pass as weight-1 additive rotations. */
  captureConstraintBakePose(): StudioBg3dPoseLayer | null;
  /** Restores the cloned asset's original local rotations, then applies the pose layer. */
  applyFromRestPose(pose: StudioBg3dPoseLayer | undefined): void;
}

export interface StudioBg3dThreeMorphDescriptor {
  readonly key: string;
  readonly name: string;
  readonly meshIndex: number;
  readonly targetIndex: number;
}

interface StudioBg3dThreeMorphBinding {
  readonly descriptor: StudioBg3dThreeMorphDescriptor;
  readonly influences: number[];
  readonly restWeight: number;
}

export interface StudioBg3dThreeMorphController {
  readonly targets: readonly StudioBg3dThreeMorphDescriptor[];
  restoreRestWeights(): void;
  /** Removes the last additive layer while preserving the underlying animation/rest sample. */
  removeAppliedWeightOffsets(): void;
  applyToCurrentWeights(morph: StudioBg3dMorphLayer | undefined): void;
  applyFromRestWeights(morph: StudioBg3dMorphLayer | undefined): void;
}

/**
 * Samples a played Three action at an absolute clip-local time without advancing mixer time.
 *
 * Studio resolves repeat and ping-pong itself, so the action must stay paused and use LoopOnce.
 * Assigning `action.time` before `mixer.update(0)` is deliberate: `mixer.setTime()` resets every
 * action's local time and retained loop counter, which can snap paused clips to frame zero or
 * double-reflect a manually resolved ping-pong boundary.
 */
export function sampleStudioBg3dAnimationActionAtTime(
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  timeSeconds: number,
): number {
  const duration = action.getClip().duration;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeTime = Number.isFinite(timeSeconds)
    ? Math.min(safeDuration, Math.max(0, timeSeconds))
    : 0;
  action.paused = true;
  action.time = safeTime;
  mixer.update(0);
  return safeTime;
}

function collectStudioBg3dThreeJointBindings(root: THREE.Object3D): StudioBg3dThreeJointBinding[] {
  const skeletons: THREE.Skeleton[] = [];
  const seen = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
    const skeleton = (object as THREE.SkinnedMesh).skeleton;
    if (!(skeleton instanceof THREE.Skeleton) || seen.has(skeleton)) return;
    seen.add(skeleton);
    skeletons.push(skeleton);
  });
  root.updateWorldMatrix(true, true);
  const rootDeterminant = root.matrixWorld.determinant();
  const inverseRoot = Number.isFinite(rootDeterminant) && Math.abs(rootDeterminant) > 1e-12
    ? root.matrixWorld.clone().invert()
    : null;
  const jointWorld = new THREE.Vector3();
  const canonicalKeyByBone = new Map<THREE.Bone, string>();
  return skeletons.flatMap((skeleton, skinIndex) => {
    const indexByBone = new Map(skeleton.bones.map((bone, index) => [bone, index] as const));
    return skeleton.bones.map((bone, jointIndex) => {
      const key = `skin-${skinIndex}:joint-${jointIndex}`;
      const canonicalKey = canonicalKeyByBone.get(bone) ?? key;
      canonicalKeyByBone.set(bone, canonicalKey);
      const parentIndex = bone.parent instanceof THREE.Bone
        ? indexByBone.get(bone.parent) ?? null
        : null;
      const modelLocal = inverseRoot
        ? bone.getWorldPosition(jointWorld).applyMatrix4(inverseRoot)
        : jointWorld.set(0, 0, 0);
      return {
        descriptor: Object.freeze({
          key,
          canonicalKey,
          name: (bone.name || `Joint ${jointIndex + 1}`).slice(0, 128),
          skinIndex,
          jointIndex,
          parentKey: parentIndex === null ? null : `skin-${skinIndex}:joint-${parentIndex}`,
          restPosition: Object.freeze([
            Number.isFinite(modelLocal.x) ? modelLocal.x : 0,
            Number.isFinite(modelLocal.y) ? modelLocal.y : 0,
            Number.isFinite(modelLocal.z) ? modelLocal.z : 0,
          ] as const),
        }),
        bone,
        restRotation: bone.quaternion.clone(),
      };
    });
  });
}

export function collectStudioBg3dThreeJoints(
  root: THREE.Object3D,
): readonly StudioBg3dThreeJointDescriptor[] {
  return Object.freeze(collectStudioBg3dThreeJointBindings(root).map((binding) => binding.descriptor));
}

/**
 * Mirrors the pose controller's exact world-basis gate for one authored chain without mutating it.
 * `instanceWorldMatrix` is the canonical entity world transform that will parent the cloned model.
 */
export function isStudioBg3dThreeTwoBoneIkChainSupported(input: {
  readonly root: THREE.Object3D;
  readonly instanceWorldMatrix: THREE.Matrix4;
  readonly upperJointKey: string;
  readonly middleJointKey: string;
  readonly endJointKey: string;
}): boolean {
  const bindings = collectStudioBg3dThreeJointBindings(input.root);
  const byKey = new Map(bindings.map((binding) => [binding.descriptor.key, binding] as const));
  const upper = byKey.get(input.upperJointKey);
  const middle = byKey.get(input.middleJointKey);
  const end = byKey.get(input.endJointKey);
  if (
    !upper || !middle || !end ||
    upper.descriptor.skinIndex !== middle.descriptor.skinIndex ||
    upper.descriptor.skinIndex !== end.descriptor.skinIndex ||
    middle.bone.parent !== upper.bone || end.bone.parent !== middle.bone ||
    !isStudioBg3dThreeAnalyticIkMatrixSupported(input.instanceWorldMatrix)
  ) return false;

  input.root.updateWorldMatrix(true, true);
  const rootParentWorld = input.root.parent?.matrixWorld;
  if (rootParentWorld && Math.abs(rootParentWorld.determinant()) <= 1e-12) return false;
  const inverseRootParent = rootParentWorld
    ? rootParentWorld.clone().invert()
    : new THREE.Matrix4();
  return [input.root, upper.bone, middle.bone, end.bone].every((object) => {
    const relative = inverseRootParent.clone().multiply(object.matrixWorld);
    const effectiveWorld = input.instanceWorldMatrix.clone().multiply(relative);
    return isStudioBg3dThreeAnalyticIkMatrixSupported(effectiveWorld);
  });
}

export function createStudioBg3dThreePoseController(
  root: THREE.Object3D,
): StudioBg3dThreePoseController {
  const bindings = collectStudioBg3dThreeJointBindings(root);
  const byKey = new Map(bindings.map((binding) => [binding.descriptor.key, binding] as const));
  const keysByBone = new Map<THREE.Bone, string[]>();
  for (const binding of bindings) {
    const keys = keysByBone.get(binding.bone);
    if (keys) keys.push(binding.descriptor.key);
    else keysByBone.set(binding.bone, [binding.descriptor.key]);
  }
  const appliedBoneStates = new Map<THREE.Bone, {
    readonly base: THREE.Quaternion;
    readonly output: THREE.Quaternion;
  }>();
  let lastConstraintEvaluationHadEffectiveConstraint = false;
  let lastConstraintEvaluationSafe = false;
  const identity = new THREE.Quaternion();
  const weighted = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const poleWorld = new THREE.Vector3();
  const startWorld = new THREE.Vector3();
  const middleWorld = new THREE.Vector3();
  const endWorld = new THREE.Vector3();
  const currentDirection = new THREE.Vector3();
  const desiredDirection = new THREE.Vector3();
  const boneWorld = new THREE.Vector3();
  const directionInParent = new THREE.Vector3();
  const inverseParentWorld = new THREE.Matrix4();
  const currentInverse = new THREE.Quaternion();
  const desired = new THREE.Quaternion();
  const currentWorldRotation = new THREE.Quaternion();
  const parentWorldRotation = new THREE.Quaternion();
  const worldDelta = new THREE.Quaternion();
  const nextLocalRotation = new THREE.Quaternion();
  const isFiniteQuaternion = (quaternion: THREE.Quaternion) =>
    Number.isFinite(quaternion.x) && Number.isFinite(quaternion.y) &&
    Number.isFinite(quaternion.z) && Number.isFinite(quaternion.w) &&
    quaternion.lengthSq() > 1e-12;
  const rotationsMatch = (left: THREE.Quaternion, right: THREE.Quaternion) => {
    if (!isFiniteQuaternion(left) || !isFiniteQuaternion(right)) return false;
    const normalizedDot = Math.abs(left.dot(right)) / Math.sqrt(left.lengthSq() * right.lengthSq());
    return normalizedDot >= 1 - 1e-7;
  };
  const recordAppliedOutput = (
    binding: StudioBg3dThreeJointBinding,
    baseBeforeWrite: THREE.Quaternion,
  ) => {
    const existing = appliedBoneStates.get(binding.bone);
    const base = existing && rotationsMatch(baseBeforeWrite, existing.output)
      ? existing.base
      : baseBeforeWrite.clone();
    appliedBoneStates.set(binding.bone, {
      base,
      output: binding.bone.quaternion.clone(),
    });
  };
  const applyWeightedLocalRotation = (
    binding: StudioBg3dThreeJointBinding,
    fullRotation: THREE.Quaternion,
    weight: number,
  ) => {
    if (!isFiniteQuaternion(fullRotation)) return false;
    const base = binding.bone.quaternion.clone();
    nextLocalRotation.copy(base).slerp(fullRotation, THREE.MathUtils.clamp(weight, 0, 1)).normalize();
    if (!isFiniteQuaternion(nextLocalRotation)) return false;
    binding.bone.quaternion.copy(nextLocalRotation);
    binding.bone.updateMatrix();
    binding.bone.updateWorldMatrix(true, true);
    recordAppliedOutput(binding, base);
    return true;
  };
  const aimedLocalRotation = (
    binding: StudioBg3dThreeJointBinding,
    segmentStart: THREE.Vector3,
    segmentEnd: THREE.Vector3,
    desiredEnd: THREE.Vector3,
  ): THREE.Quaternion | null => {
    currentDirection.copy(segmentEnd).sub(segmentStart);
    desiredDirection.copy(desiredEnd).sub(segmentStart);
    if (
      !Number.isFinite(currentDirection.lengthSq()) || currentDirection.lengthSq() < 1e-12 ||
      !Number.isFinite(desiredDirection.lengthSq()) || desiredDirection.lengthSq() < 1e-12
    ) return null;
    currentDirection.normalize();
    desiredDirection.normalize();
    binding.bone.getWorldQuaternion(currentWorldRotation);
    worldDelta.setFromUnitVectors(currentDirection, desiredDirection);
    desired.copy(worldDelta).multiply(currentWorldRotation).normalize();
    const parent = binding.bone.parent;
    if (!parent) return null;
    parent.getWorldQuaternion(parentWorldRotation);
    nextLocalRotation.copy(parentWorldRotation).invert().multiply(desired).normalize();
    return isFiniteQuaternion(nextLocalRotation) ? nextLocalRotation.clone() : null;
  };
  const supportsAnalyticIk = (objects: readonly THREE.Object3D[]) => objects.every((object) => {
    object.updateWorldMatrix(true, false);
    return isStudioBg3dThreeAnalyticIkMatrixSupported(object.matrixWorld);
  });
  const hierarchyDepthByBone = new Map<THREE.Bone, number>();
  const hierarchyDepth = (bone: THREE.Bone) => {
    const cached = hierarchyDepthByBone.get(bone);
    if (cached !== undefined) return cached;
    let depth = 0;
    let ancestor: THREE.Object3D | null = bone;
    while (ancestor && ancestor !== root) {
      depth += 1;
      ancestor = ancestor.parent;
    }
    // Detached/hostile skeletons are sorted after joints that actually belong to this model root.
    const resolved = ancestor === root ? depth : Number.MAX_SAFE_INTEGER;
    hierarchyDepthByBone.set(bone, resolved);
    return resolved;
  };
  const stableIkConstraintKey = (
    constraint: StudioBg3dConstraintLayer["twoBoneIks"][number],
  ) => JSON.stringify([
    constraint.upperJointKey,
    constraint.middleJointKey,
    constraint.endJointKey,
    constraint.target,
    constraint.poleTarget,
    constraint.weight,
  ]);
  const orderedTwoBoneIkConstraints = (constraints: StudioBg3dConstraintLayer) =>
    [...(constraints.twoBoneIks ?? [])].sort((left, right) => {
      const leftDepth = byKey.has(left.upperJointKey)
        ? hierarchyDepth(byKey.get(left.upperJointKey)!.bone)
        : Number.MAX_SAFE_INTEGER;
      const rightDepth = byKey.has(right.upperJointKey)
        ? hierarchyDepth(byKey.get(right.upperJointKey)!.bone)
        : Number.MAX_SAFE_INTEGER;
      if (leftDepth !== rightDepth) return leftDepth - rightDepth;
      const leftKey = stableIkConstraintKey(left);
      const rightKey = stableIkConstraintKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const removeAppliedPoseOffsets = () => {
    for (const [bone, applied] of appliedBoneStates) {
      // A later animation/tracking/physics owner wins; only undo output that is still ours.
      if (rotationsMatch(bone.quaternion, applied.output)) bone.quaternion.copy(applied.base);
      bone.updateMatrix();
    }
    appliedBoneStates.clear();
    lastConstraintEvaluationHadEffectiveConstraint = false;
    lastConstraintEvaluationSafe = false;
  };
  const restoreRestPose = () => {
    appliedBoneStates.clear();
    lastConstraintEvaluationHadEffectiveConstraint = false;
    lastConstraintEvaluationSafe = false;
    for (const binding of bindings) {
      binding.bone.quaternion.copy(binding.restRotation);
      binding.bone.updateMatrix();
    }
  };
  const applyToCurrentPose = (pose: StudioBg3dPoseLayer | undefined) => {
    lastConstraintEvaluationHadEffectiveConstraint = false;
    lastConstraintEvaluationSafe = false;
    if (!pose?.enabled || pose.weight <= 0) return;
    for (const override of pose.joints) {
      const binding = byKey.get(override.jointKey);
      if (!binding) continue;
      weighted.set(...override.rotationOffset);
      if (!Number.isFinite(weighted.lengthSq()) || weighted.lengthSq() < 1e-12) continue;
      weighted.normalize();
      if (pose.weight < 1) weighted.slerpQuaternions(identity, weighted, pose.weight);
      const base = binding.bone.quaternion.clone();
      binding.bone.quaternion.multiply(weighted).normalize();
      binding.bone.updateMatrix();
      recordAppliedOutput(binding, base);
    }
  };
  const applyConstraints = (constraints: StudioBg3dConstraintLayer | undefined) => {
    lastConstraintEvaluationHadEffectiveConstraint = false;
    lastConstraintEvaluationSafe = false;
    if (!constraints?.enabled) return;
    let hadFailure = false;
    root.updateWorldMatrix(true, true);
    const claimedIkBones = new Set<THREE.Bone>();
    const ikProtectedJointKeys = new Set<string>();
    // Parent chains must settle before descendant chains. Otherwise a later parent solve moves an
    // already-solved child end effector, making equivalent documents depend on array order.
    for (const constraint of orderedTwoBoneIkConstraints(constraints)) {
      if (constraint.weight <= 0) continue;
      lastConstraintEvaluationHadEffectiveConstraint = true;
      const upper = byKey.get(constraint.upperJointKey);
      const middle = byKey.get(constraint.middleJointKey);
      const end = byKey.get(constraint.endJointKey);
      if (
        !upper || !middle || !end ||
        upper.descriptor.skinIndex !== middle.descriptor.skinIndex ||
        upper.descriptor.skinIndex !== end.descriptor.skinIndex ||
        middle.bone.parent !== upper.bone || end.bone.parent !== middle.bone ||
        claimedIkBones.has(upper.bone) || claimedIkBones.has(middle.bone) ||
        claimedIkBones.has(end.bone) ||
        !supportsAnalyticIk([root, upper.bone, middle.bone, end.bone])
      ) {
        hadFailure = true;
        continue;
      }
      upper.bone.getWorldPosition(startWorld);
      middle.bone.getWorldPosition(middleWorld);
      end.bone.getWorldPosition(endWorld);
      targetWorld.set(...constraint.target).applyMatrix4(root.matrixWorld);
      poleWorld.set(...constraint.poleTarget).applyMatrix4(root.matrixWorld);
      const solution = solveTwoBoneTarget(
        startWorld,
        middleWorld,
        endWorld,
        targetWorld,
        poleWorld,
      );
      if (!solution) {
        hadFailure = true;
        continue;
      }
      const upperRotation = aimedLocalRotation(
        upper,
        startWorld,
        middleWorld,
        solution.elbow,
      );
      const upperBaseRotation = upper.bone.quaternion.clone();
      const upperAppliedBefore = appliedBoneStates.get(upper.bone);
      if (!upperRotation || !applyWeightedLocalRotation(upper, upperRotation, constraint.weight)) {
        hadFailure = true;
        continue;
      }
      root.updateWorldMatrix(true, true);
      middle.bone.getWorldPosition(middleWorld);
      end.bone.getWorldPosition(endWorld);
      const middleRotation = aimedLocalRotation(
        middle,
        middleWorld,
        endWorld,
        solution.end,
      );
      if (!middleRotation || !applyWeightedLocalRotation(middle, middleRotation, constraint.weight)) {
        // A chain is atomic: never leave a half-solved upper segment behind.
        upper.bone.quaternion.copy(upperBaseRotation);
        upper.bone.updateMatrix();
        if (upperAppliedBefore) appliedBoneStates.set(upper.bone, upperAppliedBefore);
        else appliedBoneStates.delete(upper.bone);
        root.updateWorldMatrix(true, true);
        hadFailure = true;
        continue;
      }
      claimedIkBones.add(upper.bone);
      claimedIkBones.add(middle.bone);
      claimedIkBones.add(end.bone);
      for (const key of keysByBone.get(middle.bone) ?? []) ikProtectedJointKeys.add(key);
      let ancestor: THREE.Object3D | null = upper.bone;
      while (ancestor instanceof THREE.Bone) {
        for (const key of keysByBone.get(ancestor) ?? []) ikProtectedJointKeys.add(key);
        ancestor = ancestor.parent;
      }
      root.updateWorldMatrix(true, true);
    }
    for (const constraint of constraints.aims) {
      // Re-aiming a solved segment or any of its joint ancestors would move the end effector.
      if (constraint.weight <= 0) continue;
      lastConstraintEvaluationHadEffectiveConstraint = true;
      if (ikProtectedJointKeys.has(constraint.jointKey)) continue;
      const binding = byKey.get(constraint.jointKey);
      const parent = binding?.bone.parent;
      if (!binding || !parent) {
        hadFailure = true;
        continue;
      }
      targetWorld.set(...constraint.target).applyMatrix4(root.matrixWorld);
      binding.bone.getWorldPosition(boneWorld);
      directionInParent.copy(targetWorld).sub(boneWorld);
      if (!Number.isFinite(directionInParent.lengthSq()) || directionInParent.lengthSq() < 1e-12) {
        hadFailure = true;
        continue;
      }
      parent.updateWorldMatrix(true, false);
      if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) {
        hadFailure = true;
        continue;
      }
      inverseParentWorld.copy(parent.matrixWorld).invert();
      directionInParent.transformDirection(inverseParentWorld);
      switch (constraint.axis) {
        case "+x": axis.set(1, 0, 0); break;
        case "-x": axis.set(-1, 0, 0); break;
        case "+y": axis.set(0, 1, 0); break;
        case "-y": axis.set(0, -1, 0); break;
        case "+z": axis.set(0, 0, 1); break;
        case "-z": axis.set(0, 0, -1); break;
      }
      desired.setFromUnitVectors(axis, directionInParent);
      weighted.copy(currentInverse.copy(binding.bone.quaternion).invert().multiply(desired));
      if (constraint.weight < 1) weighted.slerpQuaternions(identity, weighted, constraint.weight);
      const base = binding.bone.quaternion.clone();
      binding.bone.quaternion.multiply(weighted).normalize();
      if (!isFiniteQuaternion(binding.bone.quaternion)) {
        binding.bone.quaternion.copy(base);
        binding.bone.updateMatrix();
        hadFailure = true;
        continue;
      }
      binding.bone.updateMatrix();
      binding.bone.updateWorldMatrix(false, true);
      recordAppliedOutput(binding, base);
    }
    lastConstraintEvaluationSafe = lastConstraintEvaluationHadEffectiveConstraint && !hadFailure;
  };
  const captureConstraintBakePose = () => {
    if (!lastConstraintEvaluationHadEffectiveConstraint || !lastConstraintEvaluationSafe) return null;
    const capturedBones = new Set<THREE.Bone>();
    const samples: Array<{
      jointKey: string;
      baseRotation: StudioBg3dQuaternion;
      outputRotation: StudioBg3dQuaternion;
    }> = [];
    for (const binding of bindings) {
      if (capturedBones.has(binding.bone)) continue;
      const applied = appliedBoneStates.get(binding.bone);
      if (!applied) continue;
      if (!rotationsMatch(binding.bone.quaternion, applied.output)) return null;
      const jointKey = keysByBone.get(binding.bone)?.[0];
      if (!jointKey) return null;
      capturedBones.add(binding.bone);
      samples.push({
        jointKey,
        baseRotation: [applied.base.x, applied.base.y, applied.base.z, applied.base.w],
        outputRotation: [applied.output.x, applied.output.y, applied.output.z, applied.output.w],
      });
    }
    return bakeStudioBg3dRigPoseLayer(samples);
  };
  return Object.freeze({
    joints: Object.freeze(bindings.map((binding) => binding.descriptor)),
    restoreRestPose,
    removeAppliedPoseOffsets,
    applyToCurrentPose,
    applyConstraints,
    captureConstraintBakePose,
    applyFromRestPose(pose: StudioBg3dPoseLayer | undefined) {
      restoreRestPose();
      applyToCurrentPose(pose);
    },
  });
}

function collectStudioBg3dThreeMorphBindings(root: THREE.Object3D): StudioBg3dThreeMorphBinding[] {
  const bindings: StudioBg3dThreeMorphBinding[] = [];
  let meshIndex = 0;
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const currentMeshIndex = meshIndex;
    meshIndex += 1;
    const influences = mesh.morphTargetInfluences;
    if (!Array.isArray(influences)) return;
    const namesByIndex = new Map<number, string>();
    for (const [name, targetIndex] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      if (Number.isSafeInteger(targetIndex) && targetIndex >= 0 && targetIndex < influences.length) {
        namesByIndex.set(targetIndex, name);
      }
    }
    for (let targetIndex = 0; targetIndex < influences.length; targetIndex += 1) {
      const restWeight = influences[targetIndex];
      if (typeof restWeight !== "number" || !Number.isFinite(restWeight)) continue;
      bindings.push({
        descriptor: Object.freeze({
          key: `mesh-${currentMeshIndex}:target-${targetIndex}`,
          name: (namesByIndex.get(targetIndex) || `Morph ${targetIndex + 1}`).slice(0, 128),
          meshIndex: currentMeshIndex,
          targetIndex,
        }),
        influences,
        restWeight,
      });
    }
  });
  return bindings;
}

export function collectStudioBg3dThreeMorphTargets(
  root: THREE.Object3D,
): readonly StudioBg3dThreeMorphDescriptor[] {
  return Object.freeze(collectStudioBg3dThreeMorphBindings(root).map((binding) => binding.descriptor));
}

export function createStudioBg3dThreeMorphController(
  root: THREE.Object3D,
): StudioBg3dThreeMorphController {
  const bindings = collectStudioBg3dThreeMorphBindings(root);
  const byKey = new Map(bindings.map((binding) => [binding.descriptor.key, binding] as const));
  const weightsBeforeAppliedOffsets = new Map<StudioBg3dThreeMorphBinding, number>();
  const removeAppliedWeightOffsets = () => {
    for (const [binding, weight] of weightsBeforeAppliedOffsets) {
      binding.influences[binding.descriptor.targetIndex] = weight;
    }
    weightsBeforeAppliedOffsets.clear();
  };
  const restoreRestWeights = () => {
    weightsBeforeAppliedOffsets.clear();
    for (const binding of bindings) binding.influences[binding.descriptor.targetIndex] = binding.restWeight;
  };
  const applyToCurrentWeights = (morph: StudioBg3dMorphLayer | undefined) => {
    if (!morph?.enabled || morph.weight <= 0) return;
    for (const override of morph.targets) {
      const binding = byKey.get(override.targetKey);
      if (!binding) continue;
      const current = binding.influences[binding.descriptor.targetIndex] ?? binding.restWeight;
      if (!weightsBeforeAppliedOffsets.has(binding)) {
        weightsBeforeAppliedOffsets.set(binding, current);
      }
      binding.influences[binding.descriptor.targetIndex] = Math.max(
        0,
        Math.min(1, current + override.weightOffset * morph.weight),
      );
    }
  };
  return Object.freeze({
    targets: Object.freeze(bindings.map((binding) => binding.descriptor)),
    restoreRestWeights,
    removeAppliedWeightOffsets,
    applyToCurrentWeights,
    applyFromRestWeights(morph: StudioBg3dMorphLayer | undefined) {
      restoreRestWeights();
      applyToCurrentWeights(morph);
    },
  });
}

export interface StudioBg3dEditableThreeClone {
  readonly root: THREE.Object3D;
  readonly materialCount: number;
  readonly poseController: StudioBg3dThreePoseController;
  readonly morphController: StudioBg3dThreeMorphController;
  applyMaterialOverride(override: StudioBg3dMaterialOverride | undefined): void;
  /** Disposes only instance-owned material clones; geometry and textures remain cache-owned. */
  dispose(): void;
}

type AdjustableThreeMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  metalness?: number;
  opacity: number;
  roughness?: number;
  wireframe?: boolean;
};

function applyMaterialOverrideToBinding(
  binding: StudioBg3dEditableMaterialBinding,
  override: StudioBg3dMaterialOverride | undefined,
): void {
  const source = binding.source as AdjustableThreeMaterial;
  const editable = binding.editable as AdjustableThreeMaterial;
  editable.copy(source);
  if (!override) {
    editable.needsUpdate = true;
    return;
  }

  if (source.color && editable.color && override.colorMode !== "original") {
    const original = source.color.clone();
    const selected = new THREE.Color(override.color);
    const target = override.colorMode === "multiply"
      ? original.clone().multiply(selected)
      : selected;
    editable.color.copy(original).lerp(target, override.colorStrength);
  }
  editable.opacity = Math.max(0, Math.min(1, source.opacity * override.opacityMultiplier));
  editable.transparent = source.transparent || editable.opacity < 1;
  if (typeof editable.roughness === "number" && override.roughness !== null) {
    editable.roughness = override.roughness;
  }
  if (typeof editable.metalness === "number" && override.metalness !== null) {
    editable.metalness = override.metalness;
  }
  if (
    editable.emissive
    && typeof editable.emissiveIntensity === "number"
    && override.emissiveIntensity !== null
  ) {
    editable.emissive.set(override.emissiveColor);
    editable.emissiveIntensity = override.emissiveIntensity;
  }
  if (typeof editable.wireframe === "boolean") editable.wireframe = override.wireframe;
  if (override.doubleSided) editable.side = THREE.DoubleSide;
  editable.needsUpdate = true;
}

/**
 * Produces an editable render instance while retaining cache ownership of geometry and textures.
 * Shared source materials are cloned once per instance, preserving sharing inside that instance.
 */
export async function createStudioBg3dEditableThreeClone(
  root: THREE.Object3D,
): Promise<StudioBg3dEditableThreeClone> {
  const clone = await cloneStudioBg3dThreeObject(root);
  const poseController = createStudioBg3dThreePoseController(clone);
  const morphController = createStudioBg3dThreeMorphController(clone);
  const editableBySource = new Map<THREE.Material, THREE.Material>();
  const bindings: StudioBg3dEditableMaterialBinding[] = [];
  clone.traverse((object) => {
    const isRenderable =
      (object as THREE.Mesh).isMesh
      || (object as THREE.Points).isPoints
      || (object as THREE.Line).isLine;
    if (!isRenderable) {
      return;
    }
    const renderable = object as THREE.Mesh | THREE.Points | THREE.Line;
    const sourceMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    const editableMaterials = sourceMaterials.map((source) => {
      let editable = editableBySource.get(source);
      if (!editable) {
        editable = source.clone();
        editableBySource.set(source, editable);
        bindings.push({ source, editable });
      }
      return editable;
    });
    renderable.material = Array.isArray(renderable.material)
      ? editableMaterials
      : editableMaterials[0];
  });

  let disposed = false;
  return {
    root: clone,
    materialCount: bindings.length,
    poseController,
    morphController,
    applyMaterialOverride(override) {
      if (disposed) return;
      for (const binding of bindings) applyMaterialOverrideToBinding(binding, override);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { editable } of bindings) editable.dispose();
      bindings.length = 0;
      editableBySource.clear();
    },
  };
}

/** 결과 union을 쓰기 어려운 clone 호출부에도 고정 코드/한국어 문구만 전달하는 안전 예외. */
export class StudioBg3dThreeOperationError extends Error {
  readonly code: StudioBg3dThreeFailureCode;

  constructor(code: StudioBg3dThreeFailureCode) {
    super(THREE_FAILURE_MESSAGES[code]);
    this.name = "StudioBg3dThreeOperationError";
    this.code = code;
  }
}

function copyVerifiedGlbBytes(verification: StudioBg3dGlbValidationSuccess): ArrayBuffer | null {
  if (
    !verification ||
    typeof verification !== "object" ||
    verification.ok !== true ||
    !(verification.verifiedBytes instanceof Uint8Array)
  ) return null;
  const bytes = verification.verifiedBytes;
  if (bytes.byteLength < GLB_HEADER_BYTES) return null;
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const view = new DataView(copy);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION ||
    view.getUint32(8, true) !== copy.byteLength
  ) {
    return null;
  }
  return copy;
}

/**
 * 검증기가 소유한 성공 스냅샷만 Three.js로 넘기는 상용 로더. parseAsync의 base path는 반드시
 * 빈 문자열이며 이 경계에는 URL.createObjectURL/loadAsync/fetch 경로가 존재하지 않는다.
 */
export async function loadVerifiedStudioBg3dGlbWithThree(
  verification: StudioBg3dGlbValidationSuccess,
  budgets: StudioBg3dSceneBudgets,
  options: {
    /**
     * The renderer that owns the editor canvas, used only to pick KTX2 transcode formats. Either
     * interactive backend is accepted; the KTX2 runtime reads whichever capability API that
     * renderer exposes.
     */
    readonly renderer?: StudioBg3dKtx2Renderer | null;
  } = {},
): Promise<StudioBg3dThreeLoadResult> {
  if (!validBudgets(budgets)) return threeFailure("invalid-budgets");
  const buffer = copyVerifiedGlbBytes(verification);
  if (!buffer) return threeFailure("invalid-verified-glb");
  if (buffer.byteLength > budgets.complexity.maxModelBytes) {
    return threeFailure("model-byte-budget-exceeded");
  }
  if (verification.requiresBasisTextures && !verification.usesBasisTextures) {
    return threeFailure("invalid-verified-glb");
  }
  if (verification.requiresBasisTextures && !options.renderer) {
    return threeFailure("ktx2-renderer-unavailable");
  }

  let loader: import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
  let ktx2Runtime: StudioBg3dKtx2RendererRuntime | null = null;
  const disposeKtx2Runtime = (): boolean => {
    if (!ktx2Runtime) return true;
    try {
      ktx2Runtime.dispose();
      return true;
    } catch {
      return false;
    }
  };
  try {
    const baseLoaderPromise = Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      loadStudioBg3dMeshoptDecoder(),
    ]);
    // Optional KHR_texture_basisu assets deliberately use their core PNG/JPEG source. Three only
    // selects that standards-defined fallback when no KTX2Loader is attached.
    const ktx2RuntimePromise = verification.requiresBasisTextures
      ? import("./bg3d/studio-bg3d-ktx2-renderer-runtime").then(({ createStudioBg3dKtx2RendererRuntime }) =>
          createStudioBg3dKtx2RendererRuntime({ renderer: options.renderer as StudioBg3dKtx2Renderer })
        )
      : Promise.resolve(null);
    const [baseLoaderResult, ktx2RuntimeResult] = await Promise.allSettled([
      baseLoaderPromise,
      ktx2RuntimePromise,
    ]);
    if (ktx2RuntimeResult.status === "fulfilled") ktx2Runtime = ktx2RuntimeResult.value;
    if (baseLoaderResult.status === "rejected") {
      disposeKtx2Runtime();
      return threeFailure("renderer-unavailable");
    }
    if (ktx2RuntimeResult.status === "rejected") {
      const runtimeCode = (ktx2RuntimeResult.reason as { readonly code?: unknown } | null)?.code;
      return threeFailure(
        runtimeCode === "renderer-unavailable"
          ? "ktx2-renderer-unavailable"
          : "ktx2-runtime-unavailable"
      );
    }
    const [{ GLTFLoader }, meshoptDecoder] = baseLoaderResult.value;
    loader = new GLTFLoader().setMeshoptDecoder(meshoptDecoder);
    if (ktx2Runtime) loader.setKTX2Loader(ktx2Runtime.loader);
  } catch {
    disposeKtx2Runtime();
    return threeFailure("renderer-unavailable");
  }

  let parsed: import("three/examples/jsm/loaders/GLTFLoader.js").GLTF;
  try {
    parsed = await loader.parseAsync(buffer, "");
  } catch {
    const decodeFailed = ktx2Runtime?.hasDecodeFailure() === true;
    const disposed = disposeKtx2Runtime();
    return threeFailure(decodeFailed || !disposed ? "ktx2-decode-failed" : "parse-failed");
  }

  const parsedScenes = Array.isArray(parsed.scenes) ? parsed.scenes.filter(isObject3d) : [];
  const ownedRoots = uniqueRoots(isObject3d(parsed.scene) ? [parsed.scene, ...parsedScenes] : parsedScenes);
  const decodeFailed = ktx2Runtime?.hasDecodeFailure() === true;
  const runtimeDisposed = disposeKtx2Runtime();
  if (decodeFailed || !runtimeDisposed) {
    if (ownedRoots.length > 0) disposeStudioBg3dThreeResources(ownedRoots);
    return threeFailure("ktx2-decode-failed");
  }
  if (!isObject3d(parsed.scene)) {
    if (ownedRoots.length > 0) disposeStudioBg3dThreeResources(ownedRoots);
    return threeFailure("invalid-scene");
  }

  const parsedAnimations = Object.freeze([...(Array.isArray(parsed.animations) ? parsed.animations : [])]);
  const measured = measureStudioBg3dThreeMetrics(ownedRoots, parsedAnimations);
  if (!measured.ok) {
    disposeStudioBg3dThreeResources(ownedRoots);
    return measured;
  }
  const budgetFailure = checkStudioBg3dThreeBudgets(measured.metrics, budgets);
  if (budgetFailure) {
    disposeStudioBg3dThreeResources(ownedRoots);
    return budgetFailure;
  }

  // 소유권 경계는 성공 Promise가 사용자 코드에 전달되기 전에 고정한다. 이후 root에서 파서 메시를
  // 떼어 내거나 앱 소유 helper를 붙여도 dispose()는 이 snapshot 외 자원을 재탐색하지 않는다.
  const ownedResourceSnapshot = collectThreeResources(ownedRoots);
  let disposed = false;
  let summary: StudioBg3dThreeDisposeSummary | null = null;
  const dispose = (): StudioBg3dThreeDisposeSummary => {
    if (!disposed) {
      summary = disposeThreeResourceSnapshot(ownedResourceSnapshot);
      disposed = true;
    }
    return summary as StudioBg3dThreeDisposeSummary;
  };
  return Object.freeze({
    ok: true,
    code: "loaded",
    message: "검증된 3D 모델을 안전하게 불러왔습니다.",
    root: parsed.scene,
    animations: parsedAnimations,
    metrics: measured.metrics,
    textureRuntime: verification.requiresBasisTextures ? "ktx2-basis" : "standard",
    dispose,
  });
}

/* ── 씬 해시 직렬화(customModels 확장) ───────────────────────────────────────────────
   studio-background-3d-primitives.ts의 encodeBg3dSceneHash/parseBg3dSceneFromDataUrl(프리미티브
   전용, 무변경)과 별개로, 여기서는 customModels(인스턴스 배치 + modelId 참조만 — 모델 바이너리
   자체는 절대 포함하지 않음)까지 함께 실어 나르는 새 버전을 추가한다. 캡처된 PNG data URL 뒤에
   `#`으로 장면 그래프를 붙이는 트릭은 동일(VRM 포저/도형 프리미티브와 공유하는 round-trip 계약).
   customModels 필드가 없는 기존(프리미티브 전용) 해시도 계속 파싱되도록(빈 배열로 취급) 하위
   호환을 지킨다. */

interface Bg3dSceneWithModelsMetadata {
  tool: "bg3d";
  primitives: BgPrimitive[];
  customModels: BgCustomModelInstance[];
}

export interface Bg3dSceneWithModels {
  primitives: BgPrimitive[];
  customModels: BgCustomModelInstance[];
}

export function encodeBg3dSceneWithModelsHash(primitives: BgPrimitive[], customModels: BgCustomModelInstance[]): string {
  const metadata: Bg3dSceneWithModelsMetadata = { tool: "bg3d", primitives, customModels };
  return encodeURIComponent(JSON.stringify(metadata));
}

export function parseBg3dSceneWithModelsFromDataUrl(dataUrl: string | undefined): Bg3dSceneWithModels | null {
  if (!dataUrl) return null;
  const hashIndex = dataUrl.indexOf("#");
  if (hashIndex < 0) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(dataUrl.slice(hashIndex + 1))) as Partial<Bg3dSceneWithModelsMetadata>;
    if (raw.tool !== "bg3d" || !Array.isArray(raw.primitives)) return null;
    return {
      primitives: raw.primitives,
      customModels: Array.isArray(raw.customModels) ? raw.customModels : [],
    };
  } catch {
    return null;
  }
}
