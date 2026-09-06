import * as THREE from "three";

import { measureStudioVrmHeadSurface, studioVrmHeadwearSurfaceSocket } from "./studio-vrm-head-surface";
import { clampStudioVrmJointRotation } from "./studio-vrm-joint-limits";
import {
  VRM_PROP_GRIP_FIT_MAX,
  VRM_PROP_GRIP_FIT_MIN,
  propDefById,
  type PropAnchorDef,
  type PropAttachBone,
  type PropDef,
  type PropFitProfile,
  type PropFitReference,
  type PropGripKind,
  type PropGripProfile,
  type PropHandBone,
  type PropInstance,
  type PropRigSecondary,
  type Vec3,
} from "./studio-vrm-props";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/**
 * VRM마다 다른 골격 비율을 소품 제작 기준 치수로 변환하는 측정 결과.
 * 단위는 VRM scene의 world-space meter이며, 불완전한 VRM은 안전한 실측 추정값으로 폴백한다.
 */
export interface VrmPropRigMetrics {
  avatarHeight: number;
  hand: number;
  leftHand: number;
  rightHand: number;
  head: number;
  eyeDistance: number;
  shoulder: number;
  hip: number;
  handSockets: Record<PropHandBone, VrmPropHandSocket>;
  /**
   * 머리 본 로컬 공간의 눈/얼굴 착용 소켓(선글라스·마스크·헤드셋).
   * handSockets 와 같이 본 로컬이라 루트 체형 스케일과 중복 적용하지 않는다.
   */
  faceSocket: VrmPropFaceSocket;
  boneWorldPositions: Partial<Record<VrmPropMetricBone, Vec3>>;
  sources: Record<Exclude<PropFitReference, "none">, PropMetricSource>;
  missingBones: VrmPropMetricBone[];
}

export type Quat4 = readonly [number, number, number, number];

/** hand bone 로컬 공간의 손바닥 중심과 정렬 basis. */
export interface VrmPropHandSocket {
  position: Vec3;
  rotationQuaternion: Quat4;
  rotationDeg: Vec3;
  source: PropMetricSource;
}

/** head bone 로컬 공간의 얼굴/눈 착용 소켓(선글라스·마스크 등). */
export interface VrmPropFaceSocket extends VrmPropHandSocket {
  surfaceMeasured?: boolean;
  /** Crown height in head-bone local metres, unaffected by body root scale. */
  surfaceCrownHeight?: number;
  hairClearanceRequired?: boolean;
}

export type PropMetricSource = "measured" | "derived" | "fallback";

export type VrmPropMetricBone =
  | "hips"
  | "head"
  | "neck"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHand"
  | "rightHand"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftThumbMetacarpal"
  | "rightThumbMetacarpal"
  | "leftThumbProximal"
  | "rightThumbProximal"
  | "leftThumbDistal"
  | "rightThumbDistal"
  | "leftIndexProximal"
  | "rightIndexProximal"
  | "leftIndexIntermediate"
  | "rightIndexIntermediate"
  | "leftIndexDistal"
  | "rightIndexDistal"
  | "leftMiddleProximal"
  | "rightMiddleProximal"
  | "leftMiddleIntermediate"
  | "rightMiddleIntermediate"
  | "leftMiddleDistal"
  | "rightMiddleDistal"
  | "leftRingProximal"
  | "rightRingProximal"
  | "leftRingIntermediate"
  | "rightRingIntermediate"
  | "leftRingDistal"
  | "rightRingDistal"
  | "leftLittleProximal"
  | "rightLittleProximal"
  | "leftLittleIntermediate"
  | "rightLittleIntermediate"
  | "leftLittleDistal"
  | "rightLittleDistal"
  | "leftUpperLeg"
  | "rightUpperLeg"
  | "leftFoot"
  | "rightFoot";

export const PROP_RIG_FIT_MIN = 0.25;
export const PROP_RIG_FIT_MAX = 4;

const METRIC_BONES: readonly VrmPropMetricBone[] = [
  "hips",
  "head",
  "neck",
  "leftShoulder",
  "rightShoulder",
  "leftHand",
  "rightHand",
  "leftLowerArm",
  "rightLowerArm",
  "leftThumbMetacarpal",
  "rightThumbMetacarpal",
  "leftThumbProximal",
  "rightThumbProximal",
  "leftThumbDistal",
  "rightThumbDistal",
  "leftIndexProximal",
  "rightIndexProximal",
  "leftIndexIntermediate",
  "rightIndexIntermediate",
  "leftIndexDistal",
  "rightIndexDistal",
  "leftMiddleProximal",
  "rightMiddleProximal",
  "leftMiddleIntermediate",
  "rightMiddleIntermediate",
  "leftMiddleDistal",
  "rightMiddleDistal",
  "leftRingProximal",
  "rightRingProximal",
  "leftRingIntermediate",
  "rightRingIntermediate",
  "leftRingDistal",
  "rightRingDistal",
  "leftLittleProximal",
  "rightLittleProximal",
  "leftLittleIntermediate",
  "rightLittleIntermediate",
  "leftLittleDistal",
  "rightLittleDistal",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftFoot",
  "rightFoot",
] as const;

const FALLBACK_HAND_SOCKETS: Record<PropHandBone, VrmPropHandSocket> = {
  leftHand: {
    position: [0, -0.035, 0],
    rotationQuaternion: [0, 0, 0, 1],
    rotationDeg: [0, 0, 0],
    source: "fallback",
  },
  rightHand: {
    position: [0, -0.035, 0],
    rotationQuaternion: [0, 0, 0, 1],
    rotationDeg: [0, 0, 0],
    source: "fallback",
  },
};

/** 선글라스 카탈로그 defaultPosition([0,0.02,0.07])과 호환되는 얼굴 소켓 폴백. */
const FALLBACK_FACE_SOCKET: VrmPropFaceSocket = {
  position: [0, 0.02, 0.07],
  rotationQuaternion: [0, 0, 0, 1],
  rotationDeg: [0, 0, 0],
  source: "fallback",
};

const FALLBACK_METRICS: Omit<VrmPropRigMetrics, "boneWorldPositions" | "handSockets" | "faceSocket" | "missingBones"> = {
  avatarHeight: 1.65,
  hand: 0.075,
  leftHand: 0.075,
  rightHand: 0.075,
  head: 0.18,
  eyeDistance: 0.064,
  shoulder: 0.32,
  hip: 0.18,
  sources: {
    avatarHeight: "fallback",
    hand: "fallback",
    head: "fallback",
    eyeDistance: "fallback",
    shoulder: "fallback",
    hip: "fallback",
  },
};

type NumericMetricKey = Exclude<
  keyof VrmPropRigMetrics,
  "boneWorldPositions" | "handSockets" | "faceSocket" | "sources" | "missingBones"
>;

const METRIC_RANGES: Record<NumericMetricKey, readonly [number, number]> = {
  avatarHeight: [0.45, 3.2],
  hand: [0.025, 0.28],
  leftHand: [0.025, 0.28],
  rightHand: [0.025, 0.28],
  head: [0.08, 0.55],
  eyeDistance: [0.025, 0.18],
  shoulder: [0.12, 0.85],
  hip: [0.08, 0.65],
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizedMetric(value: unknown, fallback: number, range: readonly [number, number]): number {
  const number = finite(value) ?? fallback;
  return clamp(number, range[0], range[1]);
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  const z = finite(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

function metricSource(value: unknown, fallback: PropMetricSource): PropMetricSource {
  return value === "measured" || value === "derived" || value === "fallback" ? value : fallback;
}

function quaternionTuple(value: unknown): Quat4 | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const components = value.slice(0, 4).map(finite);
  if (components.some((component) => component === null)) return null;
  const quaternion = new THREE.Quaternion(
    components[0]!,
    components[1]!,
    components[2]!,
    components[3]!
  );
  if (quaternion.lengthSq() < 1e-8) return null;
  quaternion.normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function quaternionDegrees(value: Quat4): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...value), "XYZ");
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
}

function sanitizeHandSocket(value: unknown, fallback: VrmPropHandSocket): VrmPropHandSocket {
  const raw = value && typeof value === "object" ? value as Partial<VrmPropHandSocket> : {};
  const position = vec3(raw.position) ?? fallback.position;
  const rotationQuaternion = quaternionTuple(raw.rotationQuaternion) ?? fallback.rotationQuaternion;
  return {
    position,
    rotationQuaternion,
    rotationDeg: quaternionDegrees(rotationQuaternion),
    source: metricSource(raw.source, fallback.source),
  };
}

/** 저장값·외부 모델에서 들어온 NaN/극단값을 렌더링에 안전한 범위로 정규화한다. */
export function sanitizeVrmPropRigMetrics(raw: unknown): VrmPropRigMetrics {
  const value = raw && typeof raw === "object" ? raw as Partial<VrmPropRigMetrics> : {};
  const boneWorldPositions: Partial<Record<VrmPropMetricBone, Vec3>> = {};
  const rawPositions = value.boneWorldPositions;
  if (rawPositions && typeof rawPositions === "object") {
    for (const bone of METRIC_BONES) {
      const position = vec3(rawPositions[bone]);
      if (position) boneWorldPositions[bone] = position;
    }
  }

  const missingBones = METRIC_BONES.filter((bone) => !boneWorldPositions[bone]);
  const rawHandSockets: Partial<VrmPropRigMetrics["handSockets"]> =
    value.handSockets && typeof value.handSockets === "object" ? value.handSockets : {};
  const rawSources = value.sources && typeof value.sources === "object" ? value.sources : FALLBACK_METRICS.sources;
  return {
    avatarHeight: sanitizedMetric(value.avatarHeight, FALLBACK_METRICS.avatarHeight, METRIC_RANGES.avatarHeight),
    hand: sanitizedMetric(value.hand, FALLBACK_METRICS.hand, METRIC_RANGES.hand),
    leftHand: sanitizedMetric(value.leftHand, FALLBACK_METRICS.leftHand, METRIC_RANGES.leftHand),
    rightHand: sanitizedMetric(value.rightHand, FALLBACK_METRICS.rightHand, METRIC_RANGES.rightHand),
    head: sanitizedMetric(value.head, FALLBACK_METRICS.head, METRIC_RANGES.head),
    eyeDistance: sanitizedMetric(value.eyeDistance, FALLBACK_METRICS.eyeDistance, METRIC_RANGES.eyeDistance),
    shoulder: sanitizedMetric(value.shoulder, FALLBACK_METRICS.shoulder, METRIC_RANGES.shoulder),
    hip: sanitizedMetric(value.hip, FALLBACK_METRICS.hip, METRIC_RANGES.hip),
    handSockets: {
      leftHand: sanitizeHandSocket(rawHandSockets.leftHand, FALLBACK_HAND_SOCKETS.leftHand),
      rightHand: sanitizeHandSocket(rawHandSockets.rightHand, FALLBACK_HAND_SOCKETS.rightHand),
    },
    faceSocket: {
      ...sanitizeHandSocket(value.faceSocket, FALLBACK_FACE_SOCKET),
      ...(value.faceSocket?.surfaceMeasured === true
        && Number.isFinite(value.faceSocket.surfaceCrownHeight)
        && value.faceSocket.surfaceCrownHeight! > 0
        && value.faceSocket.surfaceCrownHeight! < 0.5
        ? { surfaceMeasured: true, surfaceCrownHeight: value.faceSocket.surfaceCrownHeight,
          ...(value.faceSocket.hairClearanceRequired ? { hairClearanceRequired: true } : {}) } : {}),
    },
    boneWorldPositions,
    sources: {
      avatarHeight: metricSource(rawSources.avatarHeight, "fallback"),
      hand: metricSource(rawSources.hand, "fallback"),
      head: metricSource(rawSources.head, "fallback"),
      eyeDistance: metricSource(rawSources.eyeDistance, "fallback"),
      shoulder: metricSource(rawSources.shoulder, "fallback"),
      hip: metricSource(rawSources.hip, "fallback"),
    },
    missingBones,
  };
}

/** 루트 비균일 체형 스케일을 rest-pose 실측값에 합성해 현재 화면 기준 자동 핏을 만든다. */
export function scaleVrmPropRigMetrics(
  rawMetrics: VrmPropRigMetrics,
  bodyScale: { height: number; width: number }
): VrmPropRigMetrics {
  const metrics = sanitizeVrmPropRigMetrics(rawMetrics);
  const height = clamp(finite(bodyScale?.height) ?? 1, 0.5, 1.6);
  const width = clamp(finite(bodyScale?.width) ?? 1, 0.5, 1.6);
  // 손은 모델마다 종축 방향이 달라 한 축만 택하면 T/A 포즈에 따라 튄다. 두 축의 기하평균은
  // 비균일 루트 스케일에서도 회전 방향과 무관한 안정적인 대표 길이를 제공한다.
  const handScale = Math.sqrt(height * width);
  const scalePosition = (value: Vec3): Vec3 => [value[0] * width, value[1] * height, value[2] * width];

  return sanitizeVrmPropRigMetrics({
    ...metrics,
    avatarHeight: metrics.avatarHeight * height,
    hand: metrics.hand * handScale,
    leftHand: metrics.leftHand * handScale,
    rightHand: metrics.rightHand * handScale,
    head: metrics.head * (metrics.faceSocket.surfaceMeasured ? width : height),
    eyeDistance: metrics.eyeDistance * width,
    shoulder: metrics.shoulder * width,
    hip: metrics.hip * width,
    boneWorldPositions: Object.fromEntries(
      Object.entries(metrics.boneWorldPositions).map(([bone, position]) => [bone, scalePosition(position)])
    ),
  });
}

export const DEFAULT_VRM_PROP_RIG_METRICS: VrmPropRigMetrics = sanitizeVrmPropRigMetrics(null);

function distance(a: Vec3 | undefined, b: Vec3 | undefined): number | null {
  if (!a || !b) return null;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  const result = Math.hypot(dx, dy, dz);
  return Number.isFinite(result) && result > 1e-5 ? result : null;
}

function measuredOrFallback(
  measured: number | null,
  fallback: number,
  range: readonly [number, number]
): readonly [number, PropMetricSource] {
  return measured === null
    ? [fallback, "fallback"]
    : [sanitizedMetric(measured, fallback, range), "measured"];
}

function quaternionToTuple(quaternion: THREE.Quaternion): Quat4 {
  const normalized = quaternion.clone().normalize();
  return [normalized.x, normalized.y, normalized.z, normalized.w];
}

function stableBasis(
  forwardInput: THREE.Vector3,
  rightInput: THREE.Vector3
): THREE.Quaternion | null {
  const forward = forwardInput.clone();
  if (forward.lengthSq() < 1e-8) return null;
  forward.normalize();
  const right = rightInput.clone().addScaledVector(forward, -rightInput.dot(forward));
  if (right.lengthSq() < 1e-8) {
    const fallbackAxis = Math.abs(forward.x) < 0.8
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    right.copy(fallbackAxis).addScaledVector(forward, -fallbackAxis.dot(forward));
  }
  right.normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const correctedRight = new THREE.Vector3().crossVectors(up, forward).normalize();
  const matrix = new THREE.Matrix4().makeBasis(correctedRight, up, forward);
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

function measureHandSocket(
  side: "left" | "right",
  nodes: Partial<Record<VrmPropMetricBone, THREE.Object3D>>,
  positions: Partial<Record<VrmPropMetricBone, Vec3>>
): VrmPropHandSocket {
  const handName = `${side}Hand` as const;
  const lowerArmName = `${side}LowerArm` as const;
  const indexName = `${side}IndexProximal` as const;
  const middleName = `${side}MiddleProximal` as const;
  const littleName = `${side}LittleProximal` as const;
  const fallback = FALLBACK_HAND_SOCKETS[handName];
  const hand = nodes[handName];
  const handPosition = positions[handName];
  if (!hand || !handPosition) return fallback;

  const handWorldQuaternion = hand.getWorldQuaternion(new THREE.Quaternion()).normalize();
  const middlePosition = positions[middleName];
  const indexPosition = positions[indexName];
  const littlePosition = positions[littleName];
  const lowerArmPosition = positions[lowerArmName];

  let forwardWorld: THREE.Vector3 | null = null;
  let socketWorld: THREE.Vector3 | null = null;
  let source: PropMetricSource = "fallback";
  if (middlePosition) {
    const wrist = new THREE.Vector3(...handPosition);
    const middle = new THREE.Vector3(...middlePosition);
    forwardWorld = middle.clone().sub(wrist);
    socketWorld = wrist.clone().lerp(middle, 0.5);
    source = indexPosition && littlePosition ? "measured" : "derived";
  } else if (lowerArmPosition) {
    const wrist = new THREE.Vector3(...handPosition);
    forwardWorld = wrist.clone().sub(new THREE.Vector3(...lowerArmPosition));
    if (forwardWorld.lengthSq() > 1e-8) {
      socketWorld = wrist.clone().add(forwardWorld.clone().normalize().multiplyScalar(0.035));
      source = "derived";
    }
  }

  if (!forwardWorld || !socketWorld || forwardWorld.lengthSq() < 1e-8) return fallback;
  const localPositionVector = hand.worldToLocal(socketWorld.clone());
  const position: Vec3 = [localPositionVector.x, localPositionVector.y, localPositionVector.z];

  let rightWorld: THREE.Vector3;
  if (indexPosition && littlePosition) {
    // index→little 순서를 양손 모두 동일하게 사용하면 결과 basis가 자연스럽게 좌우 반사된다.
    rightWorld = new THREE.Vector3(...indexPosition).sub(new THREE.Vector3(...littlePosition));
  } else {
    rightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(handWorldQuaternion);
  }
  const socketWorldQuaternion = stableBasis(forwardWorld, rightWorld);
  if (!socketWorldQuaternion) {
    return { ...fallback, position, source };
  }
  const socketLocalQuaternion = handWorldQuaternion.clone().invert().multiply(socketWorldQuaternion).normalize();
  const rotationQuaternion = quaternionToTuple(socketLocalQuaternion);
  return {
    position,
    rotationQuaternion,
    rotationDeg: quaternionDegrees(rotationQuaternion),
    source,
  };
}

/**
 * 머리 본 로컬의 눈 착용 소켓. VRM 표준에 눈 본이 없어 head 치수에서 유도한다.
 * 콧등/눈 사이 중앙 전방 — 선글라스·마스크가 떠 보이거나 정수리에 붙는 문제를 줄인다.
 */
export function measureFaceSocket(
  nodes: Partial<Record<VrmPropMetricBone, THREE.Object3D>>,
  positions: Partial<Record<VrmPropMetricBone, Vec3>>,
  headSize: number
): VrmPropFaceSocket {
  const headNode = nodes.head;
  const headPos = positions.head;
  const neckPos = positions.neck;
  if (!headNode || !headPos) return FALLBACK_FACE_SOCKET;

  const safeHead = clamp(headSize, METRIC_RANGES.head[0], METRIC_RANGES.head[1]);
  // VRM head 본은 구의 중심이 아니라 목 바로 위에서 시작한다. 머리 치수의 절반만큼
  // 올라가야 실제 눈 높이에 도달하며, 전방도 얼굴 표면에 맞춰 같은 비율로 유도한다.
  const y = safeHead * 0.50;
  const z = safeHead * 0.58;
  let source: PropMetricSource = "derived";

  // neck→head 방향이 있으면 고개를 든/숙인 rest 포즈에 맞춰 전방 축을 보정한다.
  if (neckPos) {
    const upWorld = new THREE.Vector3(...headPos).sub(new THREE.Vector3(...neckPos));
    if (upWorld.lengthSq() > 1e-8) {
      source = "measured";
    }
  }

  const position: Vec3 = [0, y, z];
  // 얼굴 전방 basis: local +Z forward, +Y up (wearable 표면이 시선과 수직에 가깝게).
  return {
    position,
    rotationQuaternion: [0, 0, 0, 1],
    rotationDeg: [0, 0, 0],
    source,
  };
}

/**
 * 정규화 humanoid rest pose의 핵심 본을 world-space에서 측정한다.
 * 손가락/발 본이 없는 불완전 VRM도 부분 실측 + 카탈로그 기준 폴백으로 계속 사용할 수 있다.
 */
export function measureVrmPropRigMetrics(vrm: VRM): VrmPropRigMetrics {
  const humanoid = vrm.humanoid;
  if (!humanoid) return sanitizeVrmPropRigMetrics(null);

  try {
    vrm.scene.updateMatrixWorld(true);
  } catch {
    return sanitizeVrmPropRigMetrics(null);
  }

  const boneWorldPositions: Partial<Record<VrmPropMetricBone, Vec3>> = {};
  const boneNodes: Partial<Record<VrmPropMetricBone, THREE.Object3D>> = {};
  for (const bone of METRIC_BONES) {
    try {
      const node = humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
      if (!node) continue;
      boneNodes[bone] = node;
      const position = node.getWorldPosition(new THREE.Vector3());
      if ([position.x, position.y, position.z].every(Number.isFinite)) {
        boneWorldPositions[bone] = [position.x, position.y, position.z];
      }
    } catch {
      // 개별 잘못된 본은 버리고 나머지 실측값을 계속 사용한다.
    }
  }

  const neckToHead = distance(boneWorldPositions.neck, boneWorldPositions.head);
  const [boneHead, boneHeadSource] = measuredOrFallback(
    neckToHead === null ? null : neckToHead * 1.2,
    FALLBACK_METRICS.head,
    METRIC_RANGES.head
  );

  let surface: ReturnType<typeof measureStudioVrmHeadSurface> = null;
  try {
    surface = measureStudioVrmHeadSurface(vrm);
  } catch {
    // A malformed or incomplete mesh must not prevent bone-based fitting.
  }
  const head = surface?.head ?? boneHead;
  const headSource: PropMetricSource = surface ? "measured" : boneHeadSource;

  const leftHandLength = distance(boneWorldPositions.leftHand, boneWorldPositions.leftMiddleProximal);
  const rightHandLength = distance(boneWorldPositions.rightHand, boneWorldPositions.rightMiddleProximal);
  const [leftHand, leftHandSource] = measuredOrFallback(
    leftHandLength === null ? null : leftHandLength * 1.15,
    FALLBACK_METRICS.leftHand,
    METRIC_RANGES.leftHand
  );
  const [rightHand, rightHandSource] = measuredOrFallback(
    rightHandLength === null ? null : rightHandLength * 1.15,
    FALLBACK_METRICS.rightHand,
    METRIC_RANGES.rightHand
  );
  const measuredHandCount = Number(leftHandSource === "measured") + Number(rightHandSource === "measured");
  const hand = measuredHandCount === 0
    ? FALLBACK_METRICS.hand
    : (leftHandSource === "measured" ? leftHand : 0) / measuredHandCount
      + (rightHandSource === "measured" ? rightHand : 0) / measuredHandCount;

  const shoulderDistance = distance(boneWorldPositions.leftShoulder, boneWorldPositions.rightShoulder);
  const [shoulder, shoulderSource] = measuredOrFallback(
    shoulderDistance,
    FALLBACK_METRICS.shoulder,
    METRIC_RANGES.shoulder
  );
  const hipDistance = distance(boneWorldPositions.leftUpperLeg, boneWorldPositions.rightUpperLeg);
  const [hip, hipSource] = measuredOrFallback(hipDistance, FALLBACK_METRICS.hip, METRIC_RANGES.hip);

  const feet = [boneWorldPositions.leftFoot, boneWorldPositions.rightFoot].filter((item): item is Vec3 => Boolean(item));
  const headPosition = boneWorldPositions.head;
  let heightMeasured: number | null = null;
  let heightSource: PropMetricSource = "fallback";
  if (headPosition && feet.length > 0) {
    heightMeasured = headPosition[1] + boneHead * 0.5 - Math.min(...feet.map((foot) => foot[1]));
    heightSource = "measured";
  } else if (headPosition && boneWorldPositions.hips) {
    heightMeasured = Math.abs(headPosition[1] - boneWorldPositions.hips[1]) * 2.65;
    heightSource = "derived";
  }
  const avatarHeight = sanitizedMetric(heightMeasured, FALLBACK_METRICS.avatarHeight, METRIC_RANGES.avatarHeight);

  // Prefer usable eye bones; otherwise derive optical spacing from the measured skull width.
  const eyeDistance = sanitizedMetric(surface?.eyeDistance ?? head * 0.355, FALLBACK_METRICS.eyeDistance, METRIC_RANGES.eyeDistance);
  const eyeSource: PropMetricSource = surface?.eyeDistanceSource ?? (headSource === "fallback" ? "fallback" : "derived");
  const handSockets: Record<PropHandBone, VrmPropHandSocket> = {
    leftHand: measureHandSocket("left", boneNodes, boneWorldPositions),
    rightHand: measureHandSocket("right", boneNodes, boneWorldPositions),
  };
  const faceSocket = surface?.faceSocket ?? measureFaceSocket(boneNodes, boneWorldPositions, head);

  return sanitizeVrmPropRigMetrics({
    avatarHeight,
    hand,
    leftHand,
    rightHand,
    head,
    eyeDistance,
    shoulder,
    hip,
    handSockets,
    faceSocket,
    boneWorldPositions,
    sources: {
      avatarHeight: heightMeasured === null ? "fallback" : heightSource,
      hand: measuredHandCount > 0 ? "measured" : "fallback",
      head: headSource,
      eyeDistance: eyeSource,
      shoulder: shoulderSource,
      hip: hipSource,
    },
  });
}

function fitMetric(metrics: VrmPropRigMetrics, reference: PropFitReference, bone: PropAttachBone): number {
  if (reference === "hand") {
    if (bone === "leftHand") return metrics.leftHand;
    if (bone === "rightHand") return metrics.rightHand;
    return metrics.hand;
  }
  if (reference === "none") return 1;
  return metrics[reference];
}

export type PropFitStatusKind = "manual" | "exact" | "adjusted" | "clamped" | "fallback";

export interface PropFitStatus {
  kind: PropFitStatusKind;
  label: string;
  reference: PropFitReference;
  measured: number;
  designReference: number;
  requestedScale: number;
  fitScale: number;
  wasClamped: boolean;
  usedFallback: boolean;
}

function safeFitProfile(profile: PropFitProfile): PropFitProfile {
  const designReference = clamp(finite(profile.designReference) ?? 1, 1e-4, 10);
  const minScale = clamp(finite(profile.minScale) ?? 1, PROP_RIG_FIT_MIN, PROP_RIG_FIT_MAX);
  const maxScale = clamp(finite(profile.maxScale) ?? 1, minScale, PROP_RIG_FIT_MAX);
  return { ...profile, designReference, minScale, maxScale };
}

/** UI 배지와 renderer가 동일한 자동 맞춤 판단을 공유한다. */
export function getPropFitStatus(
  def: PropDef,
  instance: PropInstance,
  metrics: VrmPropRigMetrics
): PropFitStatus {
  const profile = safeFitProfile(def.fit);
  const autoScale = instance.rig?.autoScale ?? false;
  const reference = profile.reference;
  const measured = fitMetric(metrics, reference, instance.bone);
  if (!autoScale || reference === "none") {
    return {
      kind: "manual",
      label: "수동 크기",
      reference,
      measured,
      designReference: profile.designReference,
      requestedScale: 1,
      fitScale: 1,
      wasClamped: false,
      usedFallback: false,
    };
  }

  const requestedScale = measured / profile.designReference;
  const fitScale = clamp(requestedScale, profile.minScale, profile.maxScale);
  const wasClamped = Math.abs(requestedScale - fitScale) > 1e-6;
  const source = reference === "hand"
    ? metrics.sources.hand
    : metrics.sources[reference as Exclude<PropFitReference, "none">];
  const usedFallback = source === "fallback";
  const exact = Math.abs(fitScale - 1) <= 0.025;
  const kind: PropFitStatusKind = wasClamped ? "clamped" : usedFallback ? "fallback" : exact ? "exact" : "adjusted";
  const label = kind === "clamped"
    ? "맞춤 한계 적용"
    : kind === "fallback"
      ? "표준 체형 기준"
      : kind === "exact"
        ? "원본 크기 적합"
        : "체형 자동 맞춤";
  return {
    kind,
    label,
    reference,
    measured,
    designReference: profile.designReference,
    requestedScale,
    fitScale,
    wasClamped,
    usedFallback,
  };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function mirrorPosition(value: Vec3): Vec3 {
  return [-value[0], value[1], value[2]];
}

/** YZ 평면 반사에서 XYZ Euler 회전을 같은 시각 방향으로 옮긴다. */
function mirrorEulerDeg(value: Vec3): Vec3 {
  return [value[0], -value[1], -value[2]];
}

function handSide(bone: PropAttachBone): PropHandBone | null {
  return bone === "leftHand" || bone === "rightHand" ? bone : null;
}

function safeDirection(value: Vec3, fallback: THREE.Vector3): THREE.Vector3 {
  const vector = new THREE.Vector3(value[0], value[1], value[2]);
  return vector.lengthSq() > 1e-8 && [vector.x, vector.y, vector.z].every(Number.isFinite)
    ? vector.normalize()
    : fallback.clone();
}

function anchorBasisQuaternion(anchor: PropAnchorDef): THREE.Quaternion {
  const forward = safeDirection(anchor.forward, new THREE.Vector3(0, 0, 1));
  let up = safeDirection(anchor.up, new THREE.Vector3(0, 1, 0));
  up = up.addScaledVector(forward, -up.dot(forward));
  if (up.lengthSq() < 1e-8) {
    up = Math.abs(forward.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    up.addScaledVector(forward, -up.dot(forward));
  }
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, correctedUp, forward);
  return new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
}

function primaryAnchor(def: PropDef, instance: PropInstance): PropAnchorDef {
  const requested = instance.rig?.anchorId
    ? def.anchors.find((anchor) => anchor.id === instance.rig?.anchorId && anchor.role !== "secondary")
    : undefined;
  return requested
    ?? def.anchors.find((anchor) => anchor.role === "primary" || anchor.role === "surface")
    ?? def.anchors[0];
}

/** Definition-only placement contract; persisted instances remain schema-compatible. */
export function usesVrmPropFaceSocket(def: PropDef, bone: PropAttachBone): boolean {
  return bone === "head" && def.wearSocket === "face";
}

export interface ResolvedPropAttachment {
  bone: PropAttachBone;
  anchorId: string;
  anchor: PropAnchorDef;
  /** 본/소켓 로컬 공간에서 anchor가 도달해야 하는 최종 접촉점. */
  socketPosition: Vec3;
  socketRotationQuaternion: Quat4;
  socketRotationDeg: Vec3;
  socketSource: PropMetricSource;
  /** anchor.position * scale을 단순 반전한, 회전 전 geometry 원점 보정값. */
  anchorInverseLocal: Vec3;
  /** anchorInverseLocal을 최종 회전한 뒤의 실제 wrapper 위치 보정값. */
  visualOffset: Vec3;
  /** geometry wrapper에 바로 적용할 본 로컬 transform. */
  position: Vec3;
  rotationDeg: Vec3;
  scale: number;
  fit: PropFitStatus;
  mirrored: boolean;
  /** false면 rig 없는 V1 인스턴스를 그대로 통과시킨 결과다. */
  usesSmartRig: boolean;
}

/**
 * geometry 원점이 아닌 의미적 anchor를 소켓 원점에 정확히 맞추는 wrapper transform을 만든다.
 * invariant: position + rotate(anchor.position * scale) === socketPosition.
 */
export function resolvePropAttachment(
  def: PropDef,
  instance: PropInstance,
  rawMetrics: VrmPropRigMetrics
): ResolvedPropAttachment {
  const metrics = sanitizeVrmPropRigMetrics(rawMetrics);
  const anchor = primaryAnchor(def, instance);
  const rig = instance.rig;

  // V1 문서는 top-level transform이 이미 geometry 원점 기준으로 저작되어 있다.
  // anchor를 소급 적용하면 기존 컷이 이동하므로 스마트 리그는 rig가 명시된 V2에만 적용한다.
  if (!rig) {
    const fit = getPropFitStatus(def, instance, metrics);
    return {
      bone: instance.bone,
      anchorId: anchor.id,
      anchor,
      socketPosition: instance.position,
      socketRotationQuaternion: [0, 0, 0, 1],
      socketRotationDeg: [0, 0, 0],
      socketSource: "fallback",
      anchorInverseLocal: [0, 0, 0],
      visualOffset: [0, 0, 0],
      position: instance.position,
      rotationDeg: instance.rotationDeg,
      scale: instance.scale,
      fit,
      mirrored: false,
      usesSmartRig: false,
    };
  }

  const deltaPosition = rig.deltaPosition;
  const deltaRotation = rig.deltaRotationDeg;
  const deltaScale = clamp(finite(rig.deltaScale) ?? 1, PROP_RIG_FIT_MIN, PROP_RIG_FIT_MAX);
  const sourceHand = handSide(def.defaultBone);
  const targetHand = handSide(instance.bone);
  const mirrored = sourceHand !== null && targetHand !== null && sourceHand !== targetHand;

  // rig가 존재하면 top-level V1 transform은 절대 base로 재사용하지 않는다.
  // 손 → 실측 palm socket, 머리 착용(선글라스 등) → face socket, 그 외 → 카탈로그 기본점.
  const handSocket = targetHand ? metrics.handSockets[targetHand] : null;
  // 얼굴 장비만 derived face socket을 사용한다. 모자·왕관·헬멧은 저장된 defaultPosition이
  // 표현하는 head-bone 접점을 유지하고, neck으로 옮긴 항목도 임의로 얼굴에 재배치하지 않는다.
  const faceWear = !handSocket && usesVrmPropFaceSocket(def, instance.bone);
  const faceSocket = faceWear ? metrics.faceSocket : null;
  const headwearSocket = rig.mode === "auto"
    ? studioVrmHeadwearSurfaceSocket(def.id, instance.bone, metrics.faceSocket) : null;
  const activeSocket = handSocket ?? headwearSocket ?? faceSocket;
  const socketBasis = activeSocket
    ? new THREE.Quaternion(...activeSocket.rotationQuaternion).normalize()
    : new THREE.Quaternion();
  let adjustedDeltaPosition: Vec3 = [...deltaPosition];
  let userRotationDeg = addVec3(def.smartRotationDeg ?? def.defaultRotationDeg, deltaRotation);
  if (mirrored) {
    adjustedDeltaPosition = mirrorPosition(adjustedDeltaPosition);
    userRotationDeg = mirrorEulerDeg(userRotationDeg);
  }
  const socketPosition = addVec3(activeSocket?.position ?? def.defaultPosition, adjustedDeltaPosition);

  const fit = getPropFitStatus(def, instance, metrics);
  const baseScale = clamp(finite(def.defaultScale) ?? 1, PROP_RIG_FIT_MIN, PROP_RIG_FIT_MAX);
  const scale = clamp(baseScale * fit.fitScale * deltaScale, PROP_RIG_FIT_MIN, PROP_RIG_FIT_MAX);

  const userRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(userRotationDeg[0]),
    THREE.MathUtils.degToRad(userRotationDeg[1]),
    THREE.MathUtils.degToRad(userRotationDeg[2]),
    "XYZ"
  ));
  const anchorInverseRotation = anchorBasisQuaternion(anchor).invert();
  const wrapperRotation = socketBasis.clone().multiply(userRotation).multiply(anchorInverseRotation).normalize();
  const euler = new THREE.Euler().setFromQuaternion(wrapperRotation, "XYZ");
  const rotationDeg: Vec3 = [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];

  const anchorInverseLocal: Vec3 = [
    -anchor.position[0] * scale,
    -anchor.position[1] * scale,
    -anchor.position[2] * scale,
  ];
  const rotatedOffset = new THREE.Vector3(...anchorInverseLocal).applyQuaternion(wrapperRotation);
  const visualOffset: Vec3 = [rotatedOffset.x, rotatedOffset.y, rotatedOffset.z];
  const position = addVec3(socketPosition, visualOffset);

  return {
    bone: instance.bone,
    anchorId: anchor.id,
    anchor,
    socketPosition,
    socketRotationQuaternion: quaternionToTuple(socketBasis),
    socketRotationDeg: quaternionDegrees(quaternionToTuple(socketBasis)),
    socketSource: activeSocket?.source ?? "fallback",
    anchorInverseLocal,
    visualOffset,
    position,
    rotationDeg,
    scale,
    fit,
    mirrored,
    usesSmartRig: true,
  };
}

export interface ResolvedSecondaryPropTarget {
  enabled: boolean;
  bone: PropHandBone;
  anchor: PropAnchorDef;
  anchorId: string;
  influence: number;
  elbowHint?: Vec3;
}

export interface ResolvedSecondaryHandConstraint {
  /** 소품의 secondary anchor가 놓인 정확한 world-space 접촉점. */
  anchorWorldPosition: Vec3;
  /** IK가 맞춰야 하는 hand bone(손목) world-space 위치. */
  wristWorldPosition: Vec3;
  /** 손바닥 소켓 basis가 소품 anchor basis와 일치하도록 하는 hand bone world 회전. */
  targetHandWorldQuaternion: Quat4;
}

/** 양손 IK renderer가 소비할 보조 anchor/손 정보만 계산한다. 팔 IK 자체는 호출자가 담당한다. */
export function resolveSecondaryPropTarget(
  def: PropDef,
  instance: PropInstance
): ResolvedSecondaryPropTarget | null {
  const secondary = instance.rig?.secondary;
  if (!secondary?.enabled) return null;
  const anchor = def.anchors.find((candidate) => candidate.id === secondary.anchorId && candidate.role === "secondary")
    ?? def.anchors.find((candidate) => candidate.role === "secondary");
  if (!anchor || secondary.bone === instance.bone) return null;
  return {
    enabled: true,
    bone: secondary.bone,
    anchor,
    anchorId: anchor.id,
    influence: clamp(finite(secondary.influence) ?? 1, 0, 1),
    ...(secondary.elbowHint ? { elbowHint: secondary.elbowHint } : {}),
  };
}

const STUDIO_VRM_SECONDARY_PALM_OFFSET_MAX = 0.95;

/**
 * 보조 손의 손목 목표를 계산한다.
 *
 * 팔 IK의 endpoint는 hand bone 원점(손목)이지만 창작자가 기대하는 접촉점은 실측된 손바닥
 * 소켓이다. 따라서 소품 anchor의 world transform에서 손바닥의 회전·스케일된 로컬 오프셋을
 * 빼야 손목을 소품 안에 파묻지 않고 정확한 접촉점을 만들 수 있다.
 */
export function resolveSecondaryHandConstraint(
  anchor: PropAnchorDef,
  groupWorldPositionRaw: Vec3,
  groupWorldQuaternionRaw: Quat4,
  propScaleRaw: number,
  handSocket: VrmPropHandSocket,
  handWorldScaleRaw: Vec3 = [1, 1, 1]
): ResolvedSecondaryHandConstraint | null {
  const groupWorldPosition = vec3(groupWorldPositionRaw);
  const groupWorldQuaternionTuple = quaternionTuple(groupWorldQuaternionRaw);
  const anchorPosition = vec3(anchor.position);
  const socketPosition = vec3(handSocket.position);
  const socketQuaternionTuple = quaternionTuple(handSocket.rotationQuaternion);
  const handWorldScale = vec3(handWorldScaleRaw);
  const propScale = finite(propScaleRaw);
  if (
    !groupWorldPosition
    || !groupWorldQuaternionTuple
    || !anchorPosition
    || !socketPosition
    || !socketQuaternionTuple
    || !handWorldScale
    || propScale === null
    || propScale <= 0
  ) {
    return null;
  }

  const groupWorldQuaternion = new THREE.Quaternion(...groupWorldQuaternionTuple).normalize();
  const anchorWorldQuaternion = groupWorldQuaternion.clone()
    .multiply(anchorBasisQuaternion(anchor))
    .normalize();
  const socketLocalQuaternion = new THREE.Quaternion(...socketQuaternionTuple).normalize();
  const targetHandWorldQuaternion = anchorWorldQuaternion.clone()
    .multiply(socketLocalQuaternion.invert())
    .normalize();

  const anchorWorldPosition = new THREE.Vector3(...anchorPosition)
    .multiplyScalar(propScale)
    .applyQuaternion(groupWorldQuaternion)
    .add(new THREE.Vector3(...groupWorldPosition));
  // T * R * S: preserve each signed scale axis before rotating the palm offset.
  // A geometric mean moves the contact point on wide/tall hands and reflected rigs.
  // The existing world-distance guard below still bounds malformed imported sockets.
  const palmWorldOffset = new THREE.Vector3(...socketPosition)
    .multiply(new THREE.Vector3(...handWorldScale))
    .applyQuaternion(targetHandWorldQuaternion);
  const maxPalmOffset = Math.min(
    STUDIO_VRM_SECONDARY_PALM_OFFSET_MAX,
    Math.max(0.05, propScale * 0.45)
  );
  if (palmWorldOffset.lengthSq() > maxPalmOffset * maxPalmOffset) {
    palmWorldOffset.setLength(maxPalmOffset);
  }
  const wristWorldPosition = anchorWorldPosition.clone().sub(palmWorldOffset);

  if (
    ![anchorWorldPosition.x, anchorWorldPosition.y, anchorWorldPosition.z].every(Number.isFinite)
    || ![wristWorldPosition.x, wristWorldPosition.y, wristWorldPosition.z].every(Number.isFinite)
  ) {
    return null;
  }

  return {
    anchorWorldPosition: [anchorWorldPosition.x, anchorWorldPosition.y, anchorWorldPosition.z],
    wristWorldPosition: [wristWorldPosition.x, wristWorldPosition.y, wristWorldPosition.z],
    targetHandWorldQuaternion: quaternionToTuple(targetHandWorldQuaternion),
  };
}

export type AutoGripFingerOverrides = Record<string, Vec3>;

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const FINGER_SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const AUTO_GRIP_KINDS = new Set<PropGripKind>([
  "cylinder",
  "handle",
  "flat",
  "pinch",
  "support",
  "wear",
]);

type AutoGripFinger = (typeof FINGERS)[number];
type AutoGripSegment = (typeof FINGER_SEGMENTS)[number];

/**
 * 손가락별 접촉 역할. pinch는 검지·중지를 접촉 손가락으로 유지하고 약지·소지는
 * 이완시키며, flat/support는 바깥 손가락으로 갈수록 조금 더 받치게 한다.
 */
const AUTO_GRIP_FINGER_WEIGHTS: Record<PropGripKind, Record<AutoGripFinger, number>> = {
  cylinder: { Index: 0.9, Middle: 1, Ring: 1.02, Little: 0.94 },
  handle: { Index: 0.92, Middle: 1, Ring: 0.98, Little: 0.9 },
  flat: { Index: 0.46, Middle: 0.54, Ring: 0.64, Little: 0.72 },
  pinch: { Index: 1, Middle: 0.82, Ring: 0.46, Little: 0.52 },
  support: { Index: 0.3, Middle: 0.38, Ring: 0.48, Little: 0.56 },
  wear: { Index: 0, Middle: 0, Ring: 0, Little: 0 },
};

/**
 * fingerCurlDeg는 한 관절에 반복해서 넣는 값이 아니라 PIP 접촉 굽힘의 기준값이다.
 * DIP는 PIP보다 작게 결합하고 MCP는 손잡이 종류에 맞게 분배해 갈고리 모양을 막는다.
 */
const AUTO_GRIP_SEGMENT_WEIGHTS: Record<PropGripKind, Record<AutoGripSegment, number>> = {
  cylinder: { Proximal: 0.72, Intermediate: 1, Distal: 0.54 },
  handle: { Proximal: 0.76, Intermediate: 1, Distal: 0.52 },
  flat: { Proximal: 0.48, Intermediate: 0.58, Distal: 0.32 },
  pinch: { Proximal: 0.58, Intermediate: 0.82, Distal: 0.46 },
  support: { Proximal: 0.34, Intermediate: 0.46, Distal: 0.24 },
  wear: { Proximal: 0, Intermediate: 0, Distal: 0 },
};

type ThumbAxisWeights = {
  readonly metacarpal: readonly [y: number, z: number];
  readonly proximal: readonly [y: number, z: number];
  readonly distal: readonly [y: number, z: number];
};

/** 엄지 대립 각도를 세 관절에 분배한다. 같은 각도를 중복 가산하지 않는다. */
const AUTO_GRIP_THUMB_WEIGHTS: Record<PropGripKind, ThumbAxisWeights> = {
  cylinder: { metacarpal: [0.34, 0.13], proximal: [0.46, 0.32], distal: [0, 0.24] },
  handle: { metacarpal: [0.36, 0.15], proximal: [0.48, 0.34], distal: [0, 0.25] },
  flat: { metacarpal: [0.3, 0.1], proximal: [0.38, 0.22], distal: [0, 0.14] },
  pinch: { metacarpal: [0.4, 0.1], proximal: [0.42, 0.24], distal: [0, 0.16] },
  support: { metacarpal: [0.26, 0.08], proximal: [0.32, 0.18], distal: [0, 0.12] },
  wear: { metacarpal: [0, 0], proximal: [0, 0], distal: [0, 0] },
};

const AUTO_GRIP_REQUIRED_BONES: Record<PropHandBone, readonly VrmPropMetricBone[]> = {
  leftHand: [
    "leftHand",
    "leftThumbMetacarpal",
    "leftThumbProximal",
    "leftThumbDistal",
    "leftIndexProximal",
    "leftIndexIntermediate",
    "leftIndexDistal",
    "leftMiddleProximal",
    "leftMiddleIntermediate",
    "leftMiddleDistal",
    "leftRingProximal",
    "leftRingIntermediate",
    "leftRingDistal",
    "leftLittleProximal",
    "leftLittleIntermediate",
    "leftLittleDistal",
  ],
  rightHand: [
    "rightHand",
    "rightThumbMetacarpal",
    "rightThumbProximal",
    "rightThumbDistal",
    "rightIndexProximal",
    "rightIndexIntermediate",
    "rightIndexDistal",
    "rightMiddleProximal",
    "rightMiddleIntermediate",
    "rightMiddleDistal",
    "rightRingProximal",
    "rightRingIntermediate",
    "rightRingDistal",
    "rightLittleProximal",
    "rightLittleIntermediate",
    "rightLittleDistal",
  ],
};

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function hasValidGripAnchorBasis(anchor: PropAnchorDef): boolean {
  if (
    !isFiniteVec3(anchor.position)
    || !isFiniteVec3(anchor.forward)
    || !isFiniteVec3(anchor.up)
    || !Number.isFinite(anchor.gripRadius)
    || !(anchor.gripRadius! > 0)
    || anchor.gripRadius! > 0.12
  ) {
    return false;
  }
  const forward = new THREE.Vector3(...anchor.forward);
  const up = new THREE.Vector3(...anchor.up);
  return forward.lengthSq() > 1e-8
    && up.lengthSq() > 1e-8
    && new THREE.Vector3().crossVectors(forward, up).lengthSq() > 1e-8;
}

function isValidGripProfile(grip: unknown): grip is PropGripProfile {
  if (!grip || typeof grip !== "object") return false;
  const value = grip as Partial<PropGripProfile>;
  return AUTO_GRIP_KINDS.has(value.kind as PropGripKind)
    && Number.isFinite(value.radius)
    && value.radius! > 0
    && value.radius! <= 0.12
    && Number.isFinite(value.fingerCurlDeg)
    && value.fingerCurlDeg! >= 0
    && value.fingerCurlDeg! <= 95
    && Number.isFinite(value.thumbOppositionDeg)
    && value.thumbOppositionDeg! >= 0
    && value.thumbOppositionDeg! <= 75;
}

function hasCompleteAutoGripRig(
  hand: PropHandBone,
  metrics: VrmPropRigMetrics
): boolean {
  return metrics.handSockets[hand].source === "measured"
    && AUTO_GRIP_REQUIRED_BONES[hand].every((bone) => isFiniteVec3(metrics.boneWorldPositions[bone]!));
}

function clampedFingerRotation(boneName: string, value: Vec3): Vec3 {
  return clampStudioVrmJointRotation(boneName, value);
}

interface AutoGripHandAnatomy {
  readonly fingerCurlFactors: Record<AutoGripFinger, number>;
  readonly thumbOppositionFactor: number;
}

function measuredFingerReach(
  side: PropHandBone,
  finger: AutoGripFinger,
  metrics: VrmPropRigMetrics,
): number | null {
  const prefix = side === "leftHand" ? "left" : "right";
  const proximal = metrics.boneWorldPositions[
    `${prefix}${finger}Proximal` as VrmPropMetricBone
  ];
  const intermediate = metrics.boneWorldPositions[
    `${prefix}${finger}Intermediate` as VrmPropMetricBone
  ];
  const distal = metrics.boneWorldPositions[
    `${prefix}${finger}Distal` as VrmPropMetricBone
  ];
  const proximalLength = distance(proximal, intermediate);
  const intermediateLength = distance(intermediate, distal);
  if (proximalLength === null || intermediateLength === null) return null;

  // VRM humanoid에는 fingertip 본이 없으므로 마지막 마디는 바로 앞 마디의 안정적인
  // 비율로 추정한다. 절대 기본값 대신 모델 자체 비율을 써 SD·장신형 손에서도 적응한다.
  const distalTipEstimate = intermediateLength * 0.72;
  const reach = proximalLength + intermediateLength + distalTipEstimate;
  return Number.isFinite(reach) && reach > 1e-5 ? reach : null;
}

function measuredThumbReach(
  side: PropHandBone,
  metrics: VrmPropRigMetrics,
): number | null {
  const prefix = side === "leftHand" ? "left" : "right";
  const metacarpal = metrics.boneWorldPositions[
    `${prefix}ThumbMetacarpal` as VrmPropMetricBone
  ];
  const proximal = metrics.boneWorldPositions[
    `${prefix}ThumbProximal` as VrmPropMetricBone
  ];
  const distal = metrics.boneWorldPositions[
    `${prefix}ThumbDistal` as VrmPropMetricBone
  ];
  const metacarpalLength = distance(metacarpal, proximal);
  const proximalLength = distance(proximal, distal);
  if (metacarpalLength === null || proximalLength === null) return null;
  const reach = metacarpalLength + proximalLength + proximalLength * 0.68;
  return Number.isFinite(reach) && reach > 1e-5 ? reach : null;
}

function measureAutoGripHandAnatomy(
  side: PropHandBone,
  metrics: VrmPropRigMetrics,
): AutoGripHandAnatomy | null {
  const reaches = {} as Record<AutoGripFinger, number>;
  for (const finger of FINGERS) {
    const reach = measuredFingerReach(side, finger, metrics);
    if (reach === null) return null;
    reaches[finger] = reach;
  }
  const referenceReach = FINGERS.reduce((sum, finger) => sum + reaches[finger], 0)
    / FINGERS.length;
  const thumbReach = measuredThumbReach(side, metrics);
  if (!Number.isFinite(referenceReach) || referenceReach <= 1e-5 || thumbReach === null) {
    return null;
  }

  return {
    fingerCurlFactors: Object.fromEntries(FINGERS.map((finger) => [
      finger,
      // 짧은 약지·소지는 조금 더 감고 긴 중지는 과도하게 접히지 않도록 한다.
      // 제한 폭은 모델의 비정상 bone origin에도 포즈가 급변하지 않는 해부학적 가드다.
      clamp(referenceReach / reaches[finger], 0.84, 1.18),
    ])) as Record<AutoGripFinger, number>,
    thumbOppositionFactor: clamp(referenceReach / thumbReach, 0.88, 1.14),
  };
}

function fingerPoseForGrip(
  side: PropHandBone,
  grip: PropGripProfile,
  anatomy: AutoGripHandAnatomy,
  strength = 1,
): AutoGripFingerOverrides {
  if (grip.kind === "wear") return {};
  const prefix = side === "leftHand" ? "left" : "right";
  const sign = side === "leftHand" ? -1 : 1;
  const poseStrength = clamp(finite(strength) ?? 1, 0, 1.35);
  const result: AutoGripFingerOverrides = {};
  for (const finger of FINGERS) {
    const fingerStrength = clamp(
      poseStrength * anatomy.fingerCurlFactors[finger],
      0,
      1.35,
    );
    const curl = THREE.MathUtils.degToRad(
      grip.fingerCurlDeg * AUTO_GRIP_FINGER_WEIGHTS[grip.kind][finger] * fingerStrength
    );
    for (const segment of FINGER_SEGMENTS) {
      const boneName = `${prefix}${finger}${segment}`;
      result[boneName] = clampedFingerRotation(
        boneName,
        [0, 0, sign * curl * AUTO_GRIP_SEGMENT_WEIGHTS[grip.kind][segment]]
      );
    }
  }

  const thumb = THREE.MathUtils.degToRad(
    grip.thumbOppositionDeg
      * clamp(poseStrength * anatomy.thumbOppositionFactor, 0, 1.35),
  );
  const thumbWeights = AUTO_GRIP_THUMB_WEIGHTS[grip.kind];
  const thumbRotations = [
    ["Metacarpal", thumbWeights.metacarpal],
    ["Proximal", thumbWeights.proximal],
    ["Distal", thumbWeights.distal],
  ] as const;
  for (const [segment, [yWeight, zWeight]] of thumbRotations) {
    const boneName = `${prefix}Thumb${segment}`;
    result[boneName] = clampedFingerRotation(
      boneName,
      [0, sign * thumb * yWeight, sign * thumb * zWeight]
    );
  }
  return result;
}

export type PropDefinitionResolver = (propId: string) => PropDef | undefined;

function gripStrengthForHand(
  definition: PropDef,
  item: PropInstance,
  hand: PropHandBone,
  metrics: VrmPropRigMetrics,
  anchor: PropAnchorDef
): number | null {
  if (
    !definition.grip
    || !isValidGripProfile(definition.grip)
    || !hasValidGripAnchorBasis(anchor)
    || !hasCompleteAutoGripRig(hand, metrics)
  ) {
    return null;
  }
  let resolved: ResolvedPropAttachment;
  try {
    resolved = resolvePropAttachment(definition, item, metrics);
  } catch {
    return null;
  }
  if (
    !resolved.usesSmartRig
    || resolved.anchorId !== item.rig?.anchorId
    || !Number.isFinite(resolved.scale)
    || resolved.scale <= 0
  ) {
    return null;
  }
  const handSize = hand === "leftHand" ? metrics.leftHand : metrics.rightHand;
  if (!Number.isFinite(handSize) || !(handSize > 1e-6)) return null;
  // 실제 선택된 접촉 anchor의 반경을 사용한다. 프로필 반경만 쓰면 다른 anchor를 고른
  // 양손 소품이나 수정된 접촉점에서도 손가락이 예전 두께를 감아 소품을 관통한다.
  const normalizedDiameter = (anchor.gripRadius! * resolved.scale * 2) / handSize;
  if (!Number.isFinite(normalizedDiameter) || normalizedDiameter <= 0) return null;
  // 손 길이의 약 30% 지름을 중립 접촉 단면으로 삼고, 큰 단면은 펴고 가는 단면은
  // 조금 더 감는다. 완전 주먹으로 붕괴하지 않도록 해부학적 안전 범위 안에서 제한한다.
  return clamp(1 + (0.3 - normalizedDiameter) * 0.9, 0.62, 1.12);
}

function primaryGripAnchor(definition: PropDef, item: PropInstance): PropAnchorDef | null {
  const rig = item.rig;
  if (
    !rig
    || rig.version !== 2
    || typeof rig.anchorId !== "string"
    || !Array.isArray(definition.anchors)
  ) {
    return null;
  }
  return definition.anchors.find((anchor) => (
    anchor.id === rig.anchorId && anchor.role === "primary"
  )) ?? null;
}

function autoGripPoseForContact(
  definition: PropDef,
  item: PropInstance,
  hand: PropHandBone,
  metrics: VrmPropRigMetrics,
  anchor: PropAnchorDef,
  influence = 1
): AutoGripFingerOverrides | null {
  if (!definition.grip || definition.grip.kind === "wear") return null;
  const strength = gripStrengthForHand(definition, item, hand, metrics, anchor);
  const anatomy = measureAutoGripHandAnatomy(hand, metrics);
  const safeInfluence = finite(influence);
  if (
    strength === null
    || !anatomy
    || safeInfluence === null
    || safeInfluence <= 0
  ) return null;
  const gripFit = clamp(
    finite(item.rig?.gripFit) ?? 1,
    VRM_PROP_GRIP_FIT_MIN,
    VRM_PROP_GRIP_FIT_MAX,
  );
  return fingerPoseForGrip(
    hand,
    definition.grip,
    anatomy,
    strength * gripFit * clamp(safeInfluence, 0, 1),
  );
}

export type AutoGripReadiness =
  | { readonly kind: "ready"; readonly hand: PropHandBone }
  | {
      readonly kind: "unavailable";
      readonly hand: PropHandBone | null;
      readonly reason:
        | "not-hand"
        | "unsupported"
        | "incomplete-rig"
        | "invalid-contact"
        | "contact-conflict";
    };

function countValidAutoGripContactsForHand(
  items: readonly PropInstance[],
  hand: PropHandBone,
  resolveDefinition: PropDefinitionResolver,
  metrics: VrmPropRigMetrics,
): number {
  let count = 0;
  for (const candidate of items) {
    if (candidate.rig?.autoFingerPose !== true) continue;
    const definition = resolveDefinition(candidate.propId);
    if (!definition?.grip) continue;
    const primaryHand = handSide(candidate.bone);
    const primaryAnchor = primaryGripAnchor(definition, candidate);
    if (
      primaryHand === hand
      && primaryAnchor
      && autoGripPoseForContact(
        definition,
        candidate,
        hand,
        metrics,
        primaryAnchor,
      )
    ) {
      count += 1;
    }
    const secondary = candidate.rig?.secondary;
    const secondaryAnchor = secondary?.enabled
      ? definition.anchors.find((anchor) => (
          anchor.id === secondary.anchorId && anchor.role === "secondary"
        ))
      : null;
    if (
      secondary?.enabled
      && secondary.bone === hand
      && secondaryAnchor
      && autoGripPoseForContact(
        definition,
        candidate,
        hand,
        metrics,
        secondaryAnchor,
        secondary.influence,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

/** UI가 켜진 척하지 않도록 실제 런타임과 같은 조건으로 선택 소품의 그립 상태를 진단한다. */
export function inspectAutoGripReadiness(
  item: PropInstance,
  allItems: readonly PropInstance[] = [item],
  resolveDefinition: PropDefinitionResolver = propDefById,
  rawMetrics: VrmPropRigMetrics = DEFAULT_VRM_PROP_RIG_METRICS,
): AutoGripReadiness {
  const hand = handSide(item.bone);
  if (!hand) return { kind: "unavailable", hand: null, reason: "not-hand" };
  const definition = resolveDefinition(item.propId);
  if (!definition?.grip || definition.grip.kind === "wear") {
    return { kind: "unavailable", hand, reason: "unsupported" };
  }
  const anchor = primaryGripAnchor(definition, item);
  if (
    !anchor
    || !isValidGripProfile(definition.grip)
    || !hasValidGripAnchorBasis(anchor)
  ) {
    return { kind: "unavailable", hand, reason: "invalid-contact" };
  }
  const metrics = sanitizeVrmPropRigMetrics(rawMetrics);
  if (!hasCompleteAutoGripRig(hand, metrics) || !measureAutoGripHandAnatomy(hand, metrics)) {
    return { kind: "unavailable", hand, reason: "incomplete-rig" };
  }
  const enabledItem: PropInstance = item.rig
    ? { ...item, rig: { ...item.rig, autoFingerPose: true } }
    : item;
  if (!autoGripPoseForContact(definition, enabledItem, hand, metrics, anchor)) {
    return { kind: "unavailable", hand, reason: "invalid-contact" };
  }
  const prospectiveItems = allItems.map((candidate) => (
    candidate.uid === item.uid ? enabledItem : candidate
  ));
  if (
    countValidAutoGripContactsForHand(
      prospectiveItems,
      hand,
      resolveDefinition,
      metrics,
    ) > 1
  ) {
    return { kind: "unavailable", hand, reason: "contact-conflict" };
  }
  return { kind: "ready", hand };
}

/**
 * 자동 그립이 켜진 손 소품을 FingerRotationMap 호환 레코드로 변환한다.
 * 호출자는 저작 손가락 값 뒤에 이 결과를 merge해 활성 손의 접촉을 최종 권위로 둔다.
 */
export function createAutoGripFingerOverrides(
  items: readonly PropInstance[],
  resolveDefinition: PropDefinitionResolver = propDefById,
  rawMetrics: VrmPropRigMetrics = DEFAULT_VRM_PROP_RIG_METRICS
): AutoGripFingerOverrides {
  const metrics = sanitizeVrmPropRigMetrics(rawMetrics);
  const posesByHand = new Map<PropHandBone, AutoGripFingerOverrides | null>();
  const registerPose = (hand: PropHandBone, pose: AutoGripFingerOverrides | null) => {
    if (!pose) return;
    // 한 손이 두 개의 서로 다른 접촉점을 동시에 감을 수는 없다. 배열 순서로 마지막
    // 소품을 덮어쓰지 않고 해당 손만 fail-closed해 결정성과 관통 방지를 지킨다.
    posesByHand.set(hand, posesByHand.has(hand) ? null : pose);
  };
  for (const item of items) {
    if ((item.rig?.autoFingerPose ?? false) !== true) continue;
    const side = handSide(item.bone);
    if (!side) continue;
    const definition = resolveDefinition(item.propId);
    if (!definition?.grip) continue;
    const primaryAnchor = primaryGripAnchor(definition, item);
    if (!primaryAnchor) continue;
    registerPose(
      side,
      autoGripPoseForContact(definition, item, side, metrics, primaryAnchor)
    );
    const secondary = item.rig?.secondary;
    if (
      secondary?.enabled
      && secondary.bone !== item.bone
      && Array.isArray(definition.anchors)
    ) {
      const secondaryAnchor = definition.anchors.find((anchor) => (
        anchor.id === secondary.anchorId && anchor.role === "secondary"
      ));
      if (secondaryAnchor) {
        registerPose(
          secondary.bone,
          autoGripPoseForContact(
            definition,
            item,
            secondary.bone,
            metrics,
            secondaryAnchor,
            secondary.influence
          )
        );
      }
    }
  }
  const result: AutoGripFingerOverrides = {};
  for (const pose of posesByHand.values()) {
    if (pose) Object.assign(result, pose);
  }
  return result;
}

/** V2 secondary를 UI에서 켤 때 사용할 안전한 기본값. */
export function createDefaultSecondaryRig(def: PropDef, primaryBone: PropAttachBone): PropRigSecondary | null {
  const secondaryAnchor = def.anchors.find((candidate) => candidate.role === "secondary");
  const hand = handSide(primaryBone);
  if (!secondaryAnchor || !hand) return null;
  return {
    enabled: true,
    anchorId: secondaryAnchor.id,
    bone: hand === "leftHand" ? "rightHand" : "leftHand",
    influence: clamp(finite(def.secondaryGripInfluence) ?? 0.75, 0, 1),
  };
}
