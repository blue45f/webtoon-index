/**
 * Studio 3D 데생 인형 — Three.js 씬 계층.
 *
 * studio-mannequin-model.ts 스펙에서 관절 그룹/프리미티브 메시를 만들고, 관절 클릭 선택·
 * 손/발 IK 드래그·원근/직교 카메라·오빗 컨트롤·리사이즈·캡처를 담당한다.
 *
 * 하우스 규칙 준수:
 * - 렌더링은 invalidate() 기반 on-demand 1프레임 rAF — 상시 루프가 없어 패널이 닫히면
 *   자동으로 멈추고, dispose()가 보류 중 rAF·지오메트리·머티리얼·렌더러를 전부 정리한다.
 * - Math.random 없이 완전 결정적(툰 그라디언트도 절차 생성 DataTexture).
 * - Three import 는 이 파일과 패널 청크 안에만 머문다(check:studio-bundle 경계).
 * - 캡처는 VRM 포저와 같은 오프스크린 렌더타깃 → Worker PNG 인코딩 파이프라인을 재사용한다.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "../bg3d/studio-bg3d-lt-render";
import {
  captureStudioVrmRgba,
  encodeStudioVrmCapturePngDataUrl,
} from "../vrm/studio-vrm-raster-capture";

import { solveStudioMannequinTwoBoneIk } from "./studio-mannequin-ik";
import {
  buildStudioMannequinSpec,
  clampStudioMannequinJointRotation,
  getStudioMannequinJointLimit,
  isStudioMannequinJointId,
  STUDIO_MANNEQUIN_CHAIN_IDS,
  type StudioMannequinChainId,
  type StudioMannequinChainSpec,
  type StudioMannequinJointId,
  type StudioMannequinMaterialStyle,
  type StudioMannequinSpec,
  type StudioMannequinVec3,
} from "./studio-mannequin-model";
import {
  createStudioMannequinRestPose,
  normalizeStudioMannequinPose,
  type StudioMannequinPose,
} from "./studio-mannequin-poses";

export type StudioMannequinProjection = "perspective" | "orthographic";

export interface StudioMannequinCaptureResult {
  readonly pngDataUrl: string;
  /** 캡처 래스터 크기(px) — PNG 원본 치수. */
  readonly width: number;
  readonly height: number;
  /**
   * 100% 줌에서 문서에 놓일 논리 크기(캡처 시점의 뷰포트 논리 뷰 크기). 캡처는
   * pixelRatio × 배율로 슈퍼샘플링되므로 래스터 크기로 삽입하면 물리적으로 커진다 —
   * 소비자는 displayWidth ?? width 로 논리 크기 삽입을 선택한다(VRM 3D 삽입 계약과 동일).
   * 래스터가 논리 크기보다 작게 축소된 경우(픽셀 예산 등)에는 업스케일 삽입을 막기 위해
   * 생략된다.
   */
  readonly displayWidth?: number;
  readonly displayHeight?: number;
}

/**
 * 캡처 래스터와 논리 뷰 크기로 삽입 결과를 만든다 — display 쌍은 둘 다 유한 양수이면서
 * 래스터 이하일 때만 포함한다(업스케일 금지 — studio-3d-insert-controller 의
 * resolveVrmInsertDisplaySize 와 같은 규칙). 순수 함수라 WebGL 없이 단위 테스트된다.
 */
export function resolveStudioMannequinCaptureResult(input: {
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}): StudioMannequinCaptureResult {
  const { pngDataUrl, width, height, displayWidth, displayHeight } = input;
  const displayValid =
    Number.isFinite(displayWidth)
    && displayWidth > 0
    && Number.isFinite(displayHeight)
    && displayHeight > 0
    && displayWidth <= width
    && displayHeight <= height;
  return displayValid
    ? { pngDataUrl, width, height, displayWidth, displayHeight }
    : { pngDataUrl, width, height };
}

export interface StudioMannequinSceneOptions {
  readonly container: HTMLElement;
  readonly initialSpec?: StudioMannequinSpec;
  readonly initialPose?: StudioMannequinPose;
  /** 뷰포트에서 몸통/팔다리를 클릭해 관절을 고르면 호출된다(빈 곳 클릭 시 null). */
  readonly onSelectJoint?: (jointId: StudioMannequinJointId | null) => void;
  /** IK 드래그가 끝날 때 최종 포즈로 1회 호출된다(프레임당 React 갱신 금지 계약). */
  readonly onPoseEdited?: (pose: StudioMannequinPose) => void;
}

export interface StudioMannequinSceneHandle {
  setBodySpec(spec: StudioMannequinSpec): void;
  setPose(pose: StudioMannequinPose): void;
  getPose(): StudioMannequinPose;
  setJointRotation(jointId: StudioMannequinJointId, rotation: StudioMannequinVec3): void;
  getJointRotation(jointId: StudioMannequinJointId): StudioMannequinVec3;
  selectJoint(jointId: StudioMannequinJointId | null): void;
  setMaterialStyle(style: StudioMannequinMaterialStyle): void;
  getMaterialStyle(): StudioMannequinMaterialStyle;
  setCameraPreset(preset: "front" | "side" | "back" | "top" | "high" | "low"): void;
  setProjection(projection: StudioMannequinProjection): void;
  getProjection(): StudioMannequinProjection;
  resetCamera(): void;
  resize(width: number, height: number): void;
  invalidate(): void;
  captureDataUrl(
    scale: number,
    options?: { signal?: AbortSignal },
  ): Promise<StudioMannequinCaptureResult>;
  dispose(): void;
}

export type StudioMannequinCameraPreset =
  | "home"
  | "front"
  | "side"
  | "back"
  | "top"
  | "high"
  | "low";

export interface StudioMannequinCameraFrame {
  readonly target: StudioMannequinVec3;
  readonly position: StudioMannequinVec3;
}

const CAMERA_REFERENCE_HEIGHT_M = 1.65;
const CAMERA_REFERENCE_OFFSETS: Readonly<Record<StudioMannequinCameraPreset, StudioMannequinVec3>> = {
  home: [1.55, 0.53, 3.1],
  front: [0, 0.18, 3.4],
  side: [3.4, 0.18, 0],
  back: [0, 0.18, -3.4],
  top: [0, 2.88, 0.01],
  high: [1.8, 2.28, 2.6],
  low: [1.4, -0.72, 2.8],
};

/** 120–200cm 체형을 같은 화면 여유로 담는 결정적 카메라 프레임. */
export function resolveStudioMannequinCameraFrame(
  heightM: number,
  preset: StudioMannequinCameraPreset = "home",
): StudioMannequinCameraFrame {
  const safeHeight = Number.isFinite(heightM)
    ? Math.min(3, Math.max(0.5, heightM))
    : CAMERA_REFERENCE_HEIGHT_M;
  const scale = safeHeight / CAMERA_REFERENCE_HEIGHT_M;
  const target: StudioMannequinVec3 = [0, safeHeight / 2, 0];
  const offset = CAMERA_REFERENCE_OFFSETS[preset];
  return {
    target,
    position: [
      target[0] + offset[0] * scale,
      target[1] + offset[1] * scale,
      target[2] + offset[2] * scale,
    ],
  };
}

const CAPTURE_PNG_TIMEOUT_MS = 20_000;
const MIN_CAPTURE_SCALE = 0.5;
const MAX_CAPTURE_SCALE = 3;

function toVec3(value: StudioMannequinVec3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

/** 4스텝 절차 생성 툰 그라디언트 — 외부 matcap 에셋 없이 CSP 인형풍 셰이딩을 만든다. */
function createToonGradientTexture(): THREE.DataTexture {
  const data = new Uint8Array([88, 88, 88, 255, 148, 148, 148, 255, 208, 208, 208, 255, 244, 244, 244, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface EffectorHandleUserData {
  studioMannequinChainId: StudioMannequinChainId;
}

interface BodyMeshUserData {
  studioMannequinJointId: StudioMannequinJointId;
}

export function createStudioMannequinScene(
  options: StudioMannequinSceneOptions,
): StudioMannequinSceneHandle {
  const { container } = options;
  let spec = options.initialSpec ?? buildStudioMannequinSpec(undefined);
  let disposed = false;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const initialWidth = Math.max(1, container.clientWidth || 1);
  const initialHeight = Math.max(1, container.clientHeight || 1);
  renderer.setSize(initialWidth, initialHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // 조명 — warm-ink 팔레트에 맞춘 은은한 3점 구성.
  const hemisphere = new THREE.HemisphereLight(0xfff4e6, 0x38322b, 0.95);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(2.4, 4.2, 3.1);
  const fillLight = new THREE.DirectionalLight(0xffe9d4, 0.35);
  fillLight.position.set(-2.2, 1.6, -2.4);
  scene.add(hemisphere, keyLight, fillLight);

  // 바닥 그리드(캡처 시 숨김).
  const helpers = new THREE.Group();
  const grid = new THREE.GridHelper(4, 20, 0x766c5d, 0x3d3831);
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.55;
  helpers.add(grid);
  scene.add(helpers);

  // 머티리얼 — 기본은 실제 목조 인형에 가까운 따뜻한 무광 재질(선택 시 accent 틴트).
  const gradientMap = createToonGradientTexture();
  let bodyMaterial: THREE.Material = new THREE.MeshStandardMaterial({
    color: 0xc58b57,
    roughness: 0.62,
    metalness: 0.02,
  });
  let currentMaterialStyle: StudioMannequinMaterialStyle = "wood";
  const selectedMaterial = new THREE.MeshToonMaterial({ color: 0xe0925c, gradientMap });
  const handleMaterial = new THREE.MeshBasicMaterial({
    color: 0xe0925c,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const handleGeometry = new THREE.SphereGeometry(1, 12, 10);

  const mannequinRoot = new THREE.Group();
  scene.add(mannequinRoot);

  let joints = new Map<StudioMannequinJointId, THREE.Group>();
  let bodyMeshes: THREE.Mesh[] = [];
  let effectorHandles: THREE.Mesh[] = [];
  let pelvisRestOffset = new THREE.Vector3();
  let selectedJointId: StudioMannequinJointId | null = null;
  let currentPose = normalizeStudioMannequinPose(
    options.initialPose ?? createStudioMannequinRestPose(),
  );

  // ── 카메라 + 컨트롤 ───────────────────────────────────────────────────────
  let viewWidth = initialWidth;
  let viewHeight = initialHeight;
  let projection: StudioMannequinProjection = "perspective";
  const perspectiveCamera = new THREE.PerspectiveCamera(
    35,
    viewWidth / viewHeight,
    0.05,
    60,
  );
  const initialCameraFrame = resolveStudioMannequinCameraFrame(spec.heightM);
  const cameraTarget = toVec3(initialCameraFrame.target);
  perspectiveCamera.position.copy(toVec3(initialCameraFrame.position));
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 60);
  orthographicCamera.position.copy(toVec3(initialCameraFrame.position));
  let activeCamera: THREE.Camera = perspectiveCamera;
  let controls: OrbitControls | null = null;

  function updateOrthographicFrustum(): void {
    const distance = orthographicCamera.position.distanceTo(cameraTarget);
    const halfHeight = Math.max(
      0.2,
      distance * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2)),
    );
    const halfWidth = halfHeight * (viewWidth / viewHeight);
    orthographicCamera.left = -halfWidth;
    orthographicCamera.right = halfWidth;
    orthographicCamera.top = halfHeight;
    orthographicCamera.bottom = -halfHeight;
    orthographicCamera.updateProjectionMatrix();
  }

  function attachControls(): void {
    controls?.dispose();
    controls = new OrbitControls(activeCamera, renderer.domElement);
    controls.target.copy(cameraTarget);
    controls.enableDamping = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.96;
    controls.addEventListener("change", () => {
      if (projection === "orthographic") updateOrthographicFrustum();
      invalidate();
    });
    controls.update();
  }

  // ── on-demand 렌더 루프 (invalidate 기반, 상시 rAF 없음) ────────────────
  let pendingFrame = 0;

  function renderNow(): void {
    if (disposed) return;
    renderer.render(scene, activeCamera);
  }

  function invalidate(): void {
    if (disposed || pendingFrame !== 0) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      renderNow();
    });
  }

  // ── 마네킹 빌드 ──────────────────────────────────────────────────────────

  function disposeMannequinGraph(): void {
    for (const mesh of [...bodyMeshes, ...effectorHandles]) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    bodyMeshes = [];
    effectorHandles = [];
    for (const group of joints.values()) group.removeFromParent();
    joints = new Map();
    mannequinRoot.clear();
  }

  function buildPrimitiveMesh(
    primitive: StudioMannequinSpec["primitives"][number],
  ): THREE.Mesh {
    if (primitive.kind === "sphere") {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(primitive.radius, 32, 24),
        bodyMaterial,
      );
      mesh.position.copy(toVec3(primitive.center));
      if (primitive.scale) mesh.scale.copy(toVec3(primitive.scale));
      return mesh;
    }
    if (primitive.kind === "box") {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(primitive.size[0], primitive.size[1], primitive.size[2]),
        bodyMaterial,
      );
      mesh.position.copy(toVec3(primitive.center));
      return mesh;
    }
    const from = toVec3(primitive.from);
    const to = toVec3(primitive.to);
    const segment = new THREE.Vector3().subVectors(to, from);
    const segmentLength = segment.length();
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(primitive.radius, Math.max(0.001, segmentLength), 8, 20),
      bodyMaterial,
    );
    mesh.position.copy(from).addScaledVector(segment, 0.5);
    if (segmentLength > 1e-9) {
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        segment.clone().normalize(),
      );
    }
    return mesh;
  }

  function rebuildMannequin(): void {
    disposeMannequinGraph();

    for (const jointSpec of spec.joints) {
      const group = new THREE.Group();
      group.name = `studio-mannequin-joint:${jointSpec.id}`;
      group.position.copy(toVec3(jointSpec.offset));
      const parent = jointSpec.parentId ? joints.get(jointSpec.parentId) : null;
      (parent ?? mannequinRoot).add(group);
      joints.set(jointSpec.id, group);
      if (jointSpec.id === "pelvis") pelvisRestOffset = toVec3(jointSpec.offset);
    }

    for (const primitive of spec.primitives) {
      const jointGroup = joints.get(primitive.jointId);
      if (!jointGroup) continue;
      const mesh = buildPrimitiveMesh(primitive);
      (mesh.userData as BodyMeshUserData).studioMannequinJointId = primitive.jointId;
      jointGroup.add(mesh);
      bodyMeshes.push(mesh);
    }

    // 손목/발목 IK 핸들 — 항상 위에 그려지는 반투명 구.
    const handleRadius = spec.headUnit * 0.16;
    for (const chainId of STUDIO_MANNEQUIN_CHAIN_IDS) {
      const chain = spec.chains[chainId];
      const effectorGroup = joints.get(chain.effectorJointId);
      if (!effectorGroup) continue;
      const handle = new THREE.Mesh(handleGeometry, handleMaterial);
      handle.scale.setScalar(handleRadius);
      handle.renderOrder = 10;
      (handle.userData as EffectorHandleUserData).studioMannequinChainId = chainId;
      effectorGroup.add(handle);
      effectorHandles.push(handle);
    }

    applyPoseToGraph(currentPose);
    applySelectionTint();
  }

  function applyPoseToGraph(pose: StudioMannequinPose): void {
    for (const jointSpec of spec.joints) {
      const group = joints.get(jointSpec.id);
      if (!group) continue;
      const rotation = clampStudioMannequinJointRotation(
        jointSpec.id,
        pose.joints[jointSpec.id] ?? [0, 0, 0],
      );
      group.rotation.set(rotation[0], rotation[1], rotation[2]);
    }
    const pelvis = joints.get("pelvis");
    pelvis?.position.set(
      pelvisRestOffset.x + pose.pelvisOffset[0],
      pelvisRestOffset.y + pose.pelvisOffset[1],
      pelvisRestOffset.z + pose.pelvisOffset[2],
    );
  }

  function readPoseFromGraph(): StudioMannequinPose {
    const jointRotations: Partial<Record<StudioMannequinJointId, StudioMannequinVec3>> = {};
    for (const jointSpec of spec.joints) {
      const group = joints.get(jointSpec.id);
      if (!group) continue;
      jointRotations[jointSpec.id] = [group.rotation.x, group.rotation.y, group.rotation.z];
    }
    const pelvis = joints.get("pelvis");
    const pelvisOffset: StudioMannequinVec3 = pelvis
      ? [
          pelvis.position.x - pelvisRestOffset.x,
          pelvis.position.y - pelvisRestOffset.y,
          pelvis.position.z - pelvisRestOffset.z,
        ]
      : [0, 0, 0];
    return normalizeStudioMannequinPose({ joints: jointRotations, pelvisOffset });
  }

  function applySelectionTint(): void {
    for (const mesh of bodyMeshes) {
      const jointId = (mesh.userData as BodyMeshUserData).studioMannequinJointId;
      mesh.material = jointId === selectedJointId ? selectedMaterial : bodyMaterial;
    }
  }

  // ── 포인터 상호작용(관절 선택 + IK 드래그) ──────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragPoint = new THREE.Vector3();
  let draggingChain: StudioMannequinChainSpec | null = null;
  let dragPointerId: number | null = null;

  function updatePointerNdc(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function solveChainToward(chain: StudioMannequinChainSpec, worldTarget: THREE.Vector3): void {
    const upperJoint = joints.get(chain.rootJointId);
    const midJoint = joints.get(chain.midJointId);
    const parent = upperJoint?.parent;
    if (!upperJoint || !midJoint || !parent) return;

    parent.updateWorldMatrix(true, false);
    const parentInverse = parent.matrixWorld.clone().invert();
    const rootLocal = upperJoint.position.clone();
    const targetLocal = worldTarget.clone().applyMatrix4(parentInverse);

    // 폴: 현재 굽힘이 살아 있으면 현 팔꿈치/무릎 위치, 퇴화 시 체인 기본 힌트.
    midJoint.updateWorldMatrix(true, false);
    const midLocal = new THREE.Vector3()
      .setFromMatrixPosition(midJoint.matrixWorld)
      .applyMatrix4(parentInverse);
    const axis = targetLocal.clone().sub(rootLocal);
    const midOffset = midLocal.clone().sub(rootLocal);
    const bendLever = axis.lengthSq() > 1e-12
      ? midOffset.clone().sub(axis.clone().multiplyScalar(midOffset.dot(axis) / axis.lengthSq()))
      : midOffset;
    const chainScale = chain.upperLength + chain.lowerLength;
    const pole = bendLever.lengthSq() > (chainScale * 0.02) ** 2
      ? midLocal
      : rootLocal.clone().add(toVec3(chain.poleHint).multiplyScalar(chainScale));

    const upperLimit = getStudioMannequinJointLimit(chain.rootJointId);
    const lowerLimit = getStudioMannequinJointLimit(chain.midJointId);
    const solved = solveStudioMannequinTwoBoneIk(
      {
        root: [rootLocal.x, rootLocal.y, rootLocal.z],
        target: [targetLocal.x, targetLocal.y, targetLocal.z],
        pole: [pole.x, pole.y, pole.z],
        upperLength: chain.upperLength,
        lowerLength: chain.lowerLength,
        hingeSign: chain.hingeSign,
      },
      {
        upper: { x: upperLimit.x, y: upperLimit.y, z: upperLimit.z },
        lower: { x: lowerLimit.x, y: lowerLimit.y, z: lowerLimit.z },
      },
    );

    upperJoint.rotation.set(...solved.upperEuler);
    midJoint.rotation.set(...solved.lowerEuler);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disposed || event.button !== 0) return;
    updatePointerNdc(event);
    raycaster.setFromCamera(pointerNdc, activeCamera);

    const handleHits = raycaster.intersectObjects(effectorHandles, false);
    const handleHit = handleHits[0];
    if (handleHit) {
      const chainId = (handleHit.object.userData as EffectorHandleUserData)
        .studioMannequinChainId;
      draggingChain = spec.chains[chainId];
      dragPointerId = event.pointerId;
      const cameraDirection = new THREE.Vector3();
      activeCamera.getWorldDirection(cameraDirection);
      const handleWorld = new THREE.Vector3();
      handleHit.object.getWorldPosition(handleWorld);
      dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, handleWorld);
      if (controls) controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const bodyHits = raycaster.intersectObjects(bodyMeshes, false);
    const bodyHit = bodyHits[0];
    const jointId = bodyHit
      ? (bodyHit.object.userData as BodyMeshUserData).studioMannequinJointId
      : null;
    if (isStudioMannequinJointId(jointId) || jointId === null) {
      selectedJointId = jointId;
      applySelectionTint();
      invalidate();
      options.onSelectJoint?.(jointId);
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (disposed || !draggingChain || event.pointerId !== dragPointerId) return;
    updatePointerNdc(event);
    raycaster.setFromCamera(pointerNdc, activeCamera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    solveChainToward(draggingChain, dragPoint);
    invalidate();
    event.preventDefault();
  }

  function finishDrag(event: PointerEvent): void {
    if (!draggingChain || event.pointerId !== dragPointerId) return;
    draggingChain = null;
    dragPointerId = null;
    if (controls) controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
    currentPose = readPoseFromGraph();
    options.onPoseEdited?.(currentPose);
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerup", finishDrag, { passive: true });
  renderer.domElement.addEventListener("pointercancel", finishDrag, { passive: true });

  // ── 캡처 ─────────────────────────────────────────────────────────────────

  function clampCaptureDimensions(scale: number): { width: number; height: number } {
    const safeScale = Math.min(MAX_CAPTURE_SCALE, Math.max(MIN_CAPTURE_SCALE, scale));
    const pixelRatio = renderer.getPixelRatio();
    let width = Math.max(1, Math.round(viewWidth * pixelRatio * safeScale));
    let height = Math.max(1, Math.round(viewHeight * pixelRatio * safeScale));
    if (width * height > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
      const shrink = Math.sqrt(STUDIO_BG3D_LT_RENDER_MAX_PIXELS / (width * height));
      width = Math.max(1, Math.floor(width * shrink));
      height = Math.max(1, Math.floor(height * shrink));
    }
    return { width, height };
  }

  async function captureDataUrl(
    scale: number,
    captureOptions: { signal?: AbortSignal } = {},
  ): Promise<StudioMannequinCaptureResult> {
    if (disposed) throw new Error("이미 정리된 3D 데생 인형 씬입니다.");
    const { width, height } = clampCaptureDimensions(scale);
    // 논리 뷰 크기는 인코딩 await 중 리사이즈로 바뀔 수 있으니 래스터 계산 시점에 스냅샷한다.
    const displayWidth = viewWidth;
    const displayHeight = viewHeight;

    // 헬퍼(그리드·IK 핸들)와 선택 틴트는 참고용 이미지에 굽지 않는다.
    const previousSelection = selectedJointId;
    selectedJointId = null;
    applySelectionTint();
    helpers.visible = false;
    for (const handle of effectorHandles) handle.visible = false;
    let rgba: Uint8ClampedArray;
    try {
      rgba = captureStudioVrmRgba(renderer, scene, activeCamera, { width, height });
    } finally {
      helpers.visible = true;
      for (const handle of effectorHandles) handle.visible = true;
      selectedJointId = previousSelection;
      applySelectionTint();
      invalidate();
    }

    const pngDataUrl = await encodeStudioVrmCapturePngDataUrl(
      rgba,
      { width, height },
      { signal: captureOptions.signal, timeoutMs: CAPTURE_PNG_TIMEOUT_MS },
    );
    return resolveStudioMannequinCaptureResult({
      pngDataUrl,
      width,
      height,
      displayWidth,
      displayHeight,
    });
  }

  // ── 핸들 구성 ────────────────────────────────────────────────────────────

  rebuildMannequin();
  attachControls();
  renderNow();

  return {
    setBodySpec(nextSpec) {
      if (disposed) return;
      const previousTarget = cameraTarget.clone();
      const heightScale = nextSpec.heightM / Math.max(0.5, spec.heightM);
      spec = nextSpec;
      rebuildMannequin();
      cameraTarget.set(0, spec.heightM / 2, 0);
      for (const camera of [perspectiveCamera, orthographicCamera]) {
        const offset = camera.position.clone().sub(previousTarget).multiplyScalar(heightScale);
        camera.position.copy(cameraTarget).add(offset);
        camera.lookAt(cameraTarget);
      }
      controls?.target.copy(cameraTarget);
      controls?.update();
      updateOrthographicFrustum();
      invalidate();
    },
    setPose(posePatch) {
      if (disposed) return;
      currentPose = normalizeStudioMannequinPose(posePatch);
      applyPoseToGraph(currentPose);
      invalidate();
    },
    getPose() {
      return disposed ? currentPose : readPoseFromGraph();
    },
    setJointRotation(jointId, rotation) {
      if (disposed) return;
      const group = joints.get(jointId);
      if (!group) return;
      const clamped = clampStudioMannequinJointRotation(jointId, rotation);
      group.rotation.set(clamped[0], clamped[1], clamped[2]);
      currentPose = readPoseFromGraph();
      invalidate();
    },
    getJointRotation(jointId) {
      const group = joints.get(jointId);
      if (!group) return [0, 0, 0];
      return [group.rotation.x, group.rotation.y, group.rotation.z];
    },
    selectJoint(jointId) {
      if (disposed) return;
      selectedJointId = jointId;
      applySelectionTint();
      invalidate();
    },
    setMaterialStyle(style) {
      if (disposed) return;
      currentMaterialStyle = style;
      let nextMaterial: THREE.Material;
      if (style === "clay") {
        nextMaterial = new THREE.MeshStandardMaterial({ color: 0xe6e2dd, roughness: 0.85, metalness: 0.05 });
      } else if (style === "wireframe") {
        nextMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
      } else if (style === "shaded") {
        nextMaterial = new THREE.MeshToonMaterial({ color: 0x94a3b8, gradientMap });
      } else if (style === "magma") {
        nextMaterial = new THREE.MeshStandardMaterial({ color: 0x18181b, emissive: 0xf97316, emissiveIntensity: 0.7, roughness: 0.3 });
      } else if (style === "stencil") {
        nextMaterial = new THREE.MeshBasicMaterial({ color: 0x09090b });
      } else if (style === "bronze") {
        nextMaterial = new THREE.MeshStandardMaterial({
          color: 0x9c6b30,
          metalness: 0.72,
          roughness: 0.28,
        });
      } else if (style === "porcelain") {
        nextMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xf5efe7,
          metalness: 0,
          roughness: 0.24,
          clearcoat: 0.65,
          clearcoatRoughness: 0.18,
        });
      } else {
        nextMaterial = new THREE.MeshStandardMaterial({
          color: 0xc58b57,
          roughness: 0.62,
          metalness: 0.02,
        });
      }
      bodyMaterial.dispose();
      bodyMaterial = nextMaterial;
      for (const mesh of bodyMeshes) {
        if (mesh.userData.studioMannequinJointId !== selectedJointId) {
          mesh.material = bodyMaterial;
        }
      }
      invalidate();
    },
    getMaterialStyle() {
      return currentMaterialStyle;
    },
    setCameraPreset(preset) {
      if (disposed) return;
      const frame = resolveStudioMannequinCameraFrame(spec.heightM, preset);
      cameraTarget.copy(toVec3(frame.target));
      activeCamera.position.copy(toVec3(frame.position));
      activeCamera.lookAt(cameraTarget);
      if (controls) {
        controls.target.copy(cameraTarget);
        controls.update();
      }
      if (projection === "orthographic") updateOrthographicFrustum();
      invalidate();
    },
    setProjection(nextProjection) {
      if (disposed || nextProjection === projection) return;
      projection = nextProjection;
      const previousCamera = activeCamera;
      activeCamera = projection === "perspective" ? perspectiveCamera : orthographicCamera;
      activeCamera.position.copy(previousCamera.position);
      activeCamera.lookAt(cameraTarget);
      if (projection === "orthographic") updateOrthographicFrustum();
      attachControls();
      invalidate();
    },
    getProjection() {
      return projection;
    },
    resetCamera() {
      if (disposed) return;
      const frame = resolveStudioMannequinCameraFrame(spec.heightM);
      cameraTarget.copy(toVec3(frame.target));
      activeCamera.position.copy(toVec3(frame.position));
      activeCamera.lookAt(cameraTarget);
      if (projection === "orthographic") updateOrthographicFrustum();
      controls?.target.copy(cameraTarget);
      controls?.update();
      invalidate();
    },
    resize(width, height) {
      if (disposed) return;
      viewWidth = Math.max(1, Math.floor(width));
      viewHeight = Math.max(1, Math.floor(height));
      renderer.setSize(viewWidth, viewHeight, false);
      perspectiveCamera.aspect = viewWidth / viewHeight;
      perspectiveCamera.updateProjectionMatrix();
      updateOrthographicFrustum();
      invalidate();
    },
    invalidate,
    captureDataUrl,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = 0;
      }
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", finishDrag);
      renderer.domElement.removeEventListener("pointercancel", finishDrag);
      controls?.dispose();
      controls = null;
      disposeMannequinGraph();
      handleGeometry.dispose();
      bodyMaterial.dispose();
      selectedMaterial.dispose();
      handleMaterial.dispose();
      gradientMap.dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
