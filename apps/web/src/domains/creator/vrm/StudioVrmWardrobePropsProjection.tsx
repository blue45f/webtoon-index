import { createPortal, useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import {
  buildBodySilhouette,
  type BodySilhouette,
  type BodySilhouetteSample,
} from "./studio-vrm-body-silhouette";
import { sampleStudioVrmGarmentWeave, studioVrmGarmentBumpScaleM } from "./studio-vrm-garment-weave";
import { PHYSICS_PREVIEW_MAX_DELTA } from "./studio-vrm-physics";
import { refineVrmGripFingerWrap } from "./studio-vrm-poser-utils";
import {
  acquireStudioVrmPropAsset,
  type StudioVrmPropAssetLease,
} from "./studio-vrm-prop-asset-runtime";
import {
  applyVrmTwoBoneGrip,
  createVrmTwoBoneGripState,
  releaseVrmTwoBoneGripState,
} from "./studio-vrm-prop-ik";
import { applyStudioVrmPropTint } from "./studio-vrm-prop-material";
import {
  resolvePropAttachment,
  resolveSecondaryHandConstraint,
  resolveSecondaryPropTarget,
  type ResolvedPropAttachment,
  type VrmPropRigMetrics,
} from "./studio-vrm-prop-rig";
import {
  buildPropObject,
  propDefById,
  type PropInstance,
} from "./studio-vrm-props";
import {
  buildStudioVrmGarmentGeometry,
  buildStudioVrmSkinnedGarment,
  type StudioVrmGarmentSkinBone,
  type StudioVrmSkinnedGarmentReceipt,
} from "./studio-vrm-skinned-garment";
import { createStudioVrmSurfaceVertexSampler } from "./studio-vrm-surface-vertex-sampler";
import {
  WARDROBE_FABRICS,
  buildGarmentParts,
  sanitizeWardrobeMetrics,
  wardrobeFabricById,
  wardrobeItemById,
  type GarmentPart,
  type LimbMetric,
  type Vec3,
  type WardrobeBone,
  type WardrobeEquip,
  type WardrobeMetrics,
  type WardrobeSlot,
} from "./studio-vrm-wardrobe";
import {
  StudioVrmXpbdSkirtAttachment,
  type StudioVrmXpbdSkirtCaptureSync,
  type StudioVrmXpbdSkirtSurfaceReceipt,
} from "./StudioVrmXpbdSkirtAttachment";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const pendingPropDisposals = new WeakMap<THREE.Object3D, object>();

function disposePropObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    meshMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/** StrictMode의 setup→cleanup→setup 재생에서는 두 번째 setup이 같은 object의 폐기를 취소한다. */
function cancelScheduledPropDisposal(object: THREE.Object3D) {
  pendingPropDisposals.delete(object);
}

function schedulePropDisposal(object: THREE.Object3D) {
  const token = {};
  pendingPropDisposals.set(object, token);
  queueMicrotask(() => {
    if (pendingPropDisposals.get(object) !== token) return;
    pendingPropDisposals.delete(object);
    disposePropObject(object);
  });
}

const VRM_FRAME_PROP_PRIORITY = -2;
const VRM_FRAME_COMMIT_PRIORITY = -1;

/**
 * 자동그립 손가락이 접점까지 실제로 닿도록 컬을 증폭한다(items/metrics 변경 시 1회).
 * 프레임마다 돌리면 트래킹·IK와 경합하므로 상태 변경 시점에만 정렬한다.
 */
export function StudioVrmGripContactRefine({
  vrm,
  items,
  metrics,
  rigRevision,
}: {
  vrm: VRM;
  items: PropInstance[];
  metrics: VrmPropRigMetrics;
  /** Re-resolves normalized bone identities after a humanoid rebuild. */
  rigRevision?: number;
}) {
  const targets = useMemo(() => {
    void rigRevision;
    return items
      .filter((item) => item.rig?.autoFingerPose === true)
      .map((item) => {
        const def = propDefById(item.propId);
        const side: "left" | "right" | null = item.bone === "leftHand"
          ? "left"
          : item.bone === "rightHand" ? "right" : null;
        if (!def?.grip || !side || !vrm.humanoid) return null;
        let resolved: ResolvedPropAttachment;
        try {
          resolved = resolvePropAttachment(def, item, metrics);
        } catch {
          return null;
        }
        if (!resolved.usesSmartRig) return null;
        return {
          bone: item.bone,
          side,
          socketLocal: [...resolved.socketPosition] as [number, number, number],
          gripRadius: def.grip.radius,
          // flat/support는 감싸지 않고 받치는 소품이라 목표를 느슨하게 한다.
          goalBias: def.grip.kind === "flat" || def.grip.kind === "support" ? 0.012 : 0,
        };
      })
      .filter((target): target is NonNullable<typeof target> => target !== null);
  }, [items, metrics, rigRevision, vrm]);

  useEffect(() => {
    if (targets.length === 0) return;
    const refined: Array<{
      side: "left" | "right";
      socketWorldPoint: THREE.Vector3;
      gripRadius: number;
      goalBias?: number;
    }> = [];
    for (const target of targets) {
      const node = vrm.humanoid?.getNormalizedBoneNode(target.bone);
      if (!node) continue;
      node.updateWorldMatrix(true, false);
      const socketWorldPoint = new THREE.Vector3(...target.socketLocal);
      node.localToWorld(socketWorldPoint);
      refined.push({
      side: target.side,
      socketWorldPoint,
      gripRadius: target.gripRadius,
      goalBias: target.goalBias,
    });
    }
    if (refined.length > 0) refineVrmGripFingerWrap(vrm, refined);
  }, [targets, vrm]);

  return null;
}
/**
 * 보조 손 목표 수렴 속도(초 단위 지수 감쇠). 이전 고정 lerp 0.35/프레임(@60fps)과 동등한
 * 지연 시간을 프레임률과 무관하게 유지한다 — 고정 계수는 고주사 모니터에서 아이템이
 * 빨리 끌려오고 저주사에서 늦게 따라와 접촉점이 들썩였다.
 */
const STUDIO_VRM_SECONDARY_HAND_SMOOTH_RATE = 25.8;
/** 초당 최대 이동 거리 클램프(순간 이동·리바인드 급증만 잘라낸다). 이전 0.12/프레임(@60fps). */
const STUDIO_VRM_SECONDARY_HAND_MAX_STEP_PER_SECOND = 7.2;
/** 프레임 스파이크·탭 복귀 시 스무딩이 폭주하지 않도록 자르는 단일 프레임 상한. */
const STUDIO_VRM_PROP_MAX_FRAME_DELTA = 0.1;
const STUDIO_VRM_PROP_GEOMETRY_QUALITY = Object.freeze({
  roundedBox: (width: number, height: number, depth: number, radius: number) => (
    new RoundedBoxGeometry(width, height, depth, 3, radius)
  ),
});

export type StudioVrmProjectionAttachmentStatus = "ready" | "unavailable" | "detached";
export type StudioVrmWardrobeSurfaceReceipt =
  | StudioVrmSkinnedGarmentReceipt
  | StudioVrmXpbdSkirtSurfaceReceipt;
export type StudioVrmWardrobeCaptureSync = StudioVrmXpbdSkirtCaptureSync;

/**
 * V1은 기존 본 포털 좌표를 그대로 보존한다. V2는 본의 world 위치·회전만 추종하는 rigid follower로
 * 렌더해 body/head 비균일 스케일의 shear를 피하고, 실제 geometry anchor를 측정된 소켓에 맞춘다.
 */
export function StudioVrmPropAttachment({
  vrm,
  instance,
  metrics,
  rigRevision,
  onAttachmentStatus,
}: {
  vrm: VRM;
  instance: PropInstance;
  metrics: VrmPropRigMetrics;
  /** Re-resolves normalized bone identities after a humanoid rebuild. */
  rigRevision?: number;
  onAttachmentStatus?: (
    uid: string,
    propId: string,
    status: StudioVrmProjectionAttachmentStatus,
  ) => void;
}) {
  const boneNode = useMemo(
    () => {
      void rigRevision;
      return vrm.humanoid?.getNormalizedBoneNode(instance.bone) ?? null;
    },
    [instance.bone, rigRevision, vrm],
  );
  const smartGroupRef = useRef<THREE.Group | null>(null);
  const localPositionRef = useRef(new THREE.Vector3());
  const boneWorldQuaternionRef = useRef(new THREE.Quaternion());
  const localQuaternionRef = useRef(new THREE.Quaternion());
  const localEulerRef = useRef(new THREE.Euler());
  const anchorWorldOffsetRef = useRef(new THREE.Vector3());
  const secondaryWorldTargetRef = useRef(new THREE.Vector3());
  const secondaryTargetQuaternionRef = useRef(new THREE.Quaternion());
  const secondaryTargetSmoothedRef = useRef(new THREE.Vector3());
  const secondaryTargetQuaternionSmoothedRef = useRef(new THREE.Quaternion());
  const secondaryTargetInitializedRef = useRef(false);
  const smoothingScratchRef = useRef(new THREE.Vector3());
  const groupWorldPositionRef = useRef(new THREE.Vector3());
  const groupWorldQuaternionRef = useRef(new THREE.Quaternion());
  const groupWorldScaleRef = useRef(new THREE.Vector3());
  const handWorldScaleRef = useRef(new THREE.Vector3());
  const attachmentStatusRef = useRef<StudioVrmProjectionAttachmentStatus | null>(null);
  const [secondaryGripState] = useState(createVrmTwoBoneGripState);
  const [loadedGltfProp, setLoadedGltfProp] = useState<{
    readonly propId: string;
    readonly url: string;
    readonly lease: StudioVrmPropAssetLease;
  } | null>(null);
  const definition = propDefById(instance.propId);

  const proceduralObject = useMemo(() => {
    if (!definition || definition.geometrySource.kind !== "procedural") return null;
    return buildPropObject(
      THREE as unknown as Parameters<typeof buildPropObject>[0],
      definition,
      instance.color,
      STUDIO_VRM_PROP_GEOMETRY_QUALITY,
    ) as unknown as THREE.Object3D;
  }, [definition, instance.color]);
  const gltfUrl = definition?.geometrySource.kind === "gltf"
    ? definition.geometrySource.url
    : null;
  const gltfObject = loadedGltfProp?.propId === instance.propId
    && loadedGltfProp.url === gltfUrl
    && !loadedGltfProp.lease.released
    ? loadedGltfProp.lease.object
    : null;
  const object = proceduralObject ?? gltfObject;
  const resolved = definition ? resolvePropAttachment(definition, instance, metrics) : null;
  const secondary = definition ? resolveSecondaryPropTarget(definition, instance) : null;
  const secondaryActive = Boolean(secondary && secondary.influence > 0);
  const secondaryBone = secondary?.bone ?? null;

  useEffect(() => {
    if (!gltfObject || instance.color === null) return;
    return applyStudioVrmPropTint(gltfObject, instance.propId, instance.color);
  }, [gltfObject, instance.color, instance.propId]);

  function reportAttachmentStatus(status: StudioVrmProjectionAttachmentStatus) {
    if (attachmentStatusRef.current === status) return;
    attachmentStatusRef.current = status;
    onAttachmentStatus?.(instance.uid, instance.propId, status);
  }

  useEffect(() => {
    const source = definition?.geometrySource;
    if (!source || source.kind !== "gltf") return;
    let active = true;
    let lease: StudioVrmPropAssetLease | null = null;

    void acquireStudioVrmPropAsset(instance.propId, source)
      .then((loadedLease) => {
        if (!active) {
          loadedLease.release();
          return;
        }
        lease = loadedLease;
        setLoadedGltfProp({ propId: instance.propId, url: source.url, lease: loadedLease });
      })
      .catch(() => {
        // GLB 항목은 절차형 큐브로 위장하지 않는다. object=null이 attachment unavailable을 보고한다.
      });

    return () => {
      active = false;
      lease?.release();
    };
  }, [definition, instance.propId]);

  useLayoutEffect(() => {
    if (!onAttachmentStatus) return;
    const primaryReady = Boolean(
      boneNode
      && object
      && (!instance.rig || resolved?.usesSmartRig === true),
    );
    const initialStatus = !primaryReady
      ? "unavailable" as const
      : !secondaryActive
        ? "ready" as const
        : null;
    if (initialStatus && attachmentStatusRef.current !== initialStatus) {
      attachmentStatusRef.current = initialStatus;
      onAttachmentStatus(instance.uid, instance.propId, initialStatus);
    }
    return () => {
      onAttachmentStatus(instance.uid, instance.propId, "detached");
      attachmentStatusRef.current = null;
    };
  }, [
    boneNode,
    instance.propId,
    instance.rig,
    instance.uid,
    object,
    onAttachmentStatus,
    resolved?.usesSmartRig,
    secondaryActive,
  ]);

  useEffect(() => {
    if (!secondaryActive) {
      releaseVrmTwoBoneGripState(secondaryGripState);
      secondaryTargetInitializedRef.current = false;
      return;
    }
    return () => {
      releaseVrmTwoBoneGripState(secondaryGripState);
      vrm.scene.updateMatrixWorld(true);
    };
  }, [secondaryActive, secondaryBone, secondaryGripState, vrm]);

  useEffect(() => {
    if (!object) return;
    if (instance.rig) {
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(1);
    } else {
      object.position.set(instance.position[0], instance.position[1], instance.position[2]);
      object.rotation.set(
        THREE.MathUtils.degToRad(instance.rotationDeg[0]),
        THREE.MathUtils.degToRad(instance.rotationDeg[1]),
        THREE.MathUtils.degToRad(instance.rotationDeg[2])
      );
      object.scale.setScalar(instance.scale);
    }
  }, [object, instance.position, instance.rig, instance.rotationDeg, instance.scale]);

  useEffect(() => {
    if (!proceduralObject) return;
    cancelScheduledPropDisposal(proceduralObject);
    return () => schedulePropDisposal(proceduralObject);
  }, [proceduralObject]);

  useFrame((_, rawDelta) => {
    const group = smartGroupRef.current;
    if (!group || !boneNode || !resolved?.usesSmartRig) {
      if (instance.rig) reportAttachmentStatus("unavailable");
      return;
    }
    // 프레임 스파이크에서 스무딩·클램프가 폭주하지 않도록 델타를 먼저 정규화한다.
    const frameDelta = THREE.MathUtils.clamp(rawDelta, 1e-4, STUDIO_VRM_PROP_MAX_FRAME_DELTA);

    boneNode.updateWorldMatrix(true, false);
    // socket만 bone matrix로 world 변환하고, geometry anchor 보정은 scale이 제거된 rigid world
    // quaternion으로 계산한다. 부모의 비균일 body/head scale이 소품을 찌그러뜨리거나 접점을
    // 밀어내지 않으면서도 손바닥 위치 자체는 체형 변화를 정확히 따라간다.
    const socketWorldPosition = localPositionRef.current.set(...resolved.socketPosition);
    boneNode.localToWorld(socketWorldPosition);
    const boneWorldQuaternion = boneNode.getWorldQuaternion(boneWorldQuaternionRef.current);
    const localQuaternion = localQuaternionRef.current.setFromEuler(localEulerRef.current.set(
      THREE.MathUtils.degToRad(resolved.rotationDeg[0]),
      THREE.MathUtils.degToRad(resolved.rotationDeg[1]),
      THREE.MathUtils.degToRad(resolved.rotationDeg[2]),
      "XYZ"
    ));
    group.quaternion.copy(boneWorldQuaternion).multiply(localQuaternion).normalize();
    group.scale.setScalar(resolved.scale);
    const anchorWorldOffset = anchorWorldOffsetRef.current
      .set(...resolved.anchor.position)
      .multiplyScalar(resolved.scale)
      .applyQuaternion(group.quaternion);
    group.position.copy(socketWorldPosition).sub(anchorWorldOffset);
    group.updateMatrixWorld(true);

    if (secondary && secondary.influence > 0) {
      const secondaryHandNode = vrm.humanoid?.getNormalizedBoneNode(secondary.bone) ?? null;
      if (!secondaryHandNode) {
        releaseVrmTwoBoneGripState(secondaryGripState);
        reportAttachmentStatus("unavailable");
        return;
      }
      secondaryHandNode.updateWorldMatrix(true, false);
      const groupWorldPosition = group.getWorldPosition(groupWorldPositionRef.current);
      const groupWorldQuaternion = group.getWorldQuaternion(groupWorldQuaternionRef.current);
      const groupWorldScale = group.getWorldScale(groupWorldScaleRef.current);
      const handWorldScale = secondaryHandNode.getWorldScale(handWorldScaleRef.current);
      const constraint = resolveSecondaryHandConstraint(
        secondary.anchor,
        [groupWorldPosition.x, groupWorldPosition.y, groupWorldPosition.z],
        [groupWorldQuaternion.x, groupWorldQuaternion.y, groupWorldQuaternion.z, groupWorldQuaternion.w],
        groupWorldScale.x,
        metrics.handSockets[secondary.bone],
        [handWorldScale.x, handWorldScale.y, handWorldScale.z]
      );
      if (!constraint) {
        releaseVrmTwoBoneGripState(secondaryGripState);
        reportAttachmentStatus("unavailable");
        return;
      }
      const rawTarget = secondaryWorldTargetRef.current.set(...constraint.wristWorldPosition);
      const rawTargetQuaternion = secondaryTargetQuaternionRef.current.set(...constraint.targetHandWorldQuaternion);
      if (
        !Number.isFinite(rawTarget.x)
        || !Number.isFinite(rawTarget.y)
        || !Number.isFinite(rawTarget.z)
        || !Number.isFinite(rawTargetQuaternion.x)
        || !Number.isFinite(rawTargetQuaternion.y)
        || !Number.isFinite(rawTargetQuaternion.z)
        || !Number.isFinite(rawTargetQuaternion.w)
      ) {
        secondaryTargetInitializedRef.current = false;
        reportAttachmentStatus("unavailable");
        releaseVrmTwoBoneGripState(secondaryGripState);
        return;
      }

      if (!secondaryTargetInitializedRef.current) {
        secondaryTargetSmoothedRef.current.copy(rawTarget);
        secondaryTargetQuaternionSmoothedRef.current.copy(rawTargetQuaternion);
        secondaryTargetInitializedRef.current = true;
      } else {
        // 프레임률 무관 지수 감쇠 + 초당 최대 이동 클램프. 매 프레임 clone 대신 스크래치 벡터를
        // 재사용해 GC 러시로 인한 미세 프레임 드랍도 제거한다.
        const blend = 1 - Math.exp(-STUDIO_VRM_SECONDARY_HAND_SMOOTH_RATE * frameDelta);
        const maxStep = STUDIO_VRM_SECONDARY_HAND_MAX_STEP_PER_SECOND * frameDelta;
        const next = smoothingScratchRef.current
          .copy(secondaryTargetSmoothedRef.current)
          .lerp(rawTarget, blend);
        const jump = next.distanceTo(secondaryTargetSmoothedRef.current);
        if (jump > maxStep) {
          next.sub(secondaryTargetSmoothedRef.current).setLength(maxStep).add(secondaryTargetSmoothedRef.current);
        }
        secondaryTargetSmoothedRef.current.copy(next);
        secondaryTargetQuaternionSmoothedRef.current.slerp(rawTargetQuaternion, blend);
      }
      const target = secondaryTargetSmoothedRef.current;
      const targetQuaternion = secondaryTargetQuaternionSmoothedRef.current;
      const applied = applyVrmTwoBoneGrip(
        vrm,
        secondary.bone === "leftHand" ? "left" : "right",
        target,
        Math.max(0, Math.min(1, secondary.influence)),
        secondary.elbowHint,
        { targetQuaternion, state: secondaryGripState }
      );
      reportAttachmentStatus(applied ? "ready" : "unavailable");
    }
  }, VRM_FRAME_PROP_PRIORITY);

  if (!boneNode || !object) return null;
  if (resolved?.usesSmartRig) {
    return (
      <group ref={smartGroupRef}>
        <primitive object={object} />
      </group>
    );
  }
  return createPortal(<primitive object={object} />, boneNode);
}

/* ── 실장착 워드로브(studio-vrm-wardrobe) — 측정·조립·본 부착 ────────── */

/** 몸통 표면으로 인정하는 휴머노이드 본. 이 본이 최대 가중치인 정점만 링 재료가 된다. */
const TORSO_SILHOUETTE_BONES: readonly VRMHumanBoneName[] = ["hips", "spine", "chest", "upperChest"];

/**
 * 메시 하나에서 훑는 정점 수 상한(12k). 20만 정점짜리 모델이 로딩을 붙잡지 않도록 일정 간격으로
 * 솎아낸다. 간격은 정점 수만으로 정해지므로 같은 모델은 언제 재도 같은 정점을 고른다.
 */
const TORSO_MESH_VERTEX_BUDGET = 12_000;

/** 씬 전체 상한(48k). vrm.scene 순회 순서가 결정적이라 예산이 어디서 끊기는지도 결정적이다. */
/** 이 스튜디오가 만들어 붙인 노드의 이름 규약 — 의상은 `wardrobe:<slot>:<id>`, 소품은 `prop:<id>`. */
const STUDIO_ATTACHMENT_NAME = /^(wardrobe:(outer|top|bottom|shoes)\b|prop:)/u;
const STUDIO_ATTACHMENT_ANCESTRY_DEPTH = 32;

/** 이름(또는 조상의 이름)이 스튜디오 부착물이면 실측 대상이 아니다. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure predicate shared with its colocated test.
export function isStudioAuthoredAttachment(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  for (let depth = 0; node && depth < STUDIO_ATTACHMENT_ANCESTRY_DEPTH; depth += 1) {
    if (node.name && STUDIO_ATTACHMENT_NAME.test(node.name)) return true;
    node = node.parent;
  }
  return false;
}

const TORSO_SCENE_VERTEX_BUDGET = 48_000;

/** 실측으로 인정할 최소 표면 정점 수. 이보다 적으면 실루엣 없이 골격 폴백에 맡긴다. */
const TORSO_MIN_SAMPLES = 96;

/** hips↔목 높이차가 이보다 짧으면 t 정규화의 분모로 쓸 수 없다. */
const TORSO_MIN_SPAN_M = 0.02;

/** 몸통 실측 좌표계. 세 축 모두 spine 로컬 공간의 단위 벡터다. */
export interface TorsoMeasureFrame {
  /** 위 = spine → 목. 높이를 재는 축. */
  up: Vec3;
  /** 왼쪽 = 오른팔 → 왼팔에서 up 성분을 제거한 축. 샘플의 x. */
  left: Vec3;
  /** 앞 = 왼쪽 × 위. footForward와 같은 해부학 규약이다. 샘플의 z. */
  forward: Vec3;
  /** t = 0 인 높이(hips 관절의 up 투영값). */
  hipsHeight: number;
  /** t = 1 까지의 높이(목 관절 − hips 관절). */
  span: number;
}

function normalizedVec3(x: number, y: number, z: number): Vec3 | null {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  return [x / length, y / length, z / length];
}

function dotVec3(axis: Vec3, x: number, y: number, z: number): number {
  return axis[0] * x + axis[1] * y + axis[2] * z;
}

function matrixIsFinite(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every((value) => Number.isFinite(value));
}

/**
 * spine 로컬 관절 위치에서 몸통 실측 프레임을 만든다. 어깨선이 기울어도 높이 축이 오염되지
 * 않도록 좌우 축에서 up 성분을 빼고, 앞 축은 기존 footForward와 같은 왼쪽×위로 잡는다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure rig math tested beside the projection that is its only caller.
export function buildTorsoMeasureFrame(anchors: {
  /** spine → 목 벡터. WardrobeMetrics.up과 같은 축이라 재단 압출 방향과 어긋나지 않는다. */
  up: Vec3;
  hips: Vec3;
  neck: Vec3;
  leftUpperArm: Vec3;
  rightUpperArm: Vec3;
}): TorsoMeasureFrame | null {
  const up = normalizedVec3(anchors.up[0], anchors.up[1], anchors.up[2]);
  if (!up) return null;
  const shoulderX = anchors.leftUpperArm[0] - anchors.rightUpperArm[0];
  const shoulderY = anchors.leftUpperArm[1] - anchors.rightUpperArm[1];
  const shoulderZ = anchors.leftUpperArm[2] - anchors.rightUpperArm[2];
  const alongUp = dotVec3(up, shoulderX, shoulderY, shoulderZ);
  const left = normalizedVec3(
    shoulderX - up[0] * alongUp,
    shoulderY - up[1] * alongUp,
    shoulderZ - up[2] * alongUp,
  );
  if (!left) return null;
  const forward = normalizedVec3(
    left[1] * up[2] - left[2] * up[1],
    left[2] * up[0] - left[0] * up[2],
    left[0] * up[1] - left[1] * up[0],
  );
  if (!forward) return null;
  const hipsHeight = dotVec3(up, anchors.hips[0], anchors.hips[1], anchors.hips[2]);
  const span = dotVec3(up, anchors.neck[0], anchors.neck[1], anchors.neck[2]) - hipsHeight;
  if (!(span > TORSO_MIN_SPAN_M)) return null;
  return { up, left, forward, hipsHeight, span };
}

/**
 * spine 로컬 점 하나를 실루엣 샘플로 바꾼다. hips(0)~목(1) 밖은 몸통 단면이 아니므로 버린다 —
 * 머리·다리에 걸친 정점이 링을 부풀리지 않게 하는 1차 필터다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure rig math tested beside the projection that is its only caller.
export function projectTorsoSample(
  frame: TorsoMeasureFrame,
  x: number,
  y: number,
  z: number,
): BodySilhouetteSample | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const t = (dotVec3(frame.up, x, y, z) - frame.hipsHeight) / frame.span;
  if (!(t >= 0 && t <= 1)) return null;
  return { t, x: dotVec3(frame.left, x, y, z), z: dotVec3(frame.forward, x, y, z) };
}

/**
 * 정점 하나의 스킨 영향 4개 중 가장 큰 것. 가중치가 같으면 앞선 슬롯을 택해 같은 모델이
 * 언제나 같은 본을 고르게 한다(결정론). 유효한 양의 가중치가 없으면 null.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure rig math tested beside the projection that is its only caller.
export function pickDominantSkinInfluence(
  boneIndices: ArrayLike<number>,
  weights: ArrayLike<number>,
): { boneIndex: number; weight: number } | null {
  let boneIndex = -1;
  let weight = 0;
  const slots = Math.min(4, boneIndices.length, weights.length);
  for (let slot = 0; slot < slots; slot += 1) {
    const candidate = weights[slot];
    if (!Number.isFinite(candidate) || candidate <= weight) continue;
    const candidateIndex = boneIndices[slot];
    if (!Number.isFinite(candidateIndex) || candidateIndex < 0) continue;
    boneIndex = Math.trunc(candidateIndex);
    weight = candidate;
  }
  return boneIndex < 0 ? null : { boneIndex, weight };
}

/** 정점 수와 예산으로 정하는 고정 샘플 간격. 입력이 같으면 결과도 같다. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure rig math tested beside the projection that is its only caller.
export function torsoVertexStride(vertexCount: number, budget: number): number {
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) return 1;
  const cap = Number.isFinite(budget) && budget >= 1 ? Math.trunc(budget) : 1;
  return Math.max(1, Math.ceil(vertexCount / cap));
}

/**
 * 스킨 메시에서 몸통 표면 정점을 모아 실루엣을 만든다. 골격이 아니라 실제 표면을 재므로
 * 가슴은 넓고 얕게, 허리는 좁게 나온다. 재료가 모자라면 null을 돌려 골격 폴백에 맡긴다 —
 * 없는 측정을 지어내는 것보다 예전 재단이 그대로 도는 편이 정직하다.
 *
 * 좌표계는 나머지 치수와 같은 spine 로컬 rest 공간이다. 지배 본은 몸통 분류에만 사용한다.
 * 위치는 렌더러와 동일한 전체 스킨 가중치와 활성 모프를 적용해 화면에 보이는 표면을 잰다.
 * Avatar Forge가 리그를 바꾼 뒤에도 몸과 옷이 같은 공간과 형상을 기준으로 재단된다.
 */
function measureTorsoSilhouette(vrm: VRM, anchors: {
  spine: THREE.Object3D | null;
  /** spine 로컬 위 방향. 나머지는 월드 좌표. */
  up: THREE.Vector3 | null;
  hips: THREE.Vector3 | null;
  neck: THREE.Vector3 | null;
  leftUpperArm: THREE.Vector3 | null;
  rightUpperArm: THREE.Vector3 | null;
}): BodySilhouette | null {
  const humanoid = vrm.humanoid;
  const spine = anchors.spine;
  if (!humanoid || !spine || !anchors.up) return null;
  if (!matrixIsFinite(spine.matrixWorld) || Math.abs(spine.matrixWorld.determinant()) < 1e-12) return null;

  const spineLocal = (worldPoint: THREE.Vector3 | null): Vec3 | null => {
    if (!worldPoint) return null;
    const local = spine.worldToLocal(worldPoint.clone());
    return Number.isFinite(local.x) && Number.isFinite(local.y) && Number.isFinite(local.z)
      ? [local.x, local.y, local.z]
      : null;
  };
  const hips = spineLocal(anchors.hips);
  const neck = spineLocal(anchors.neck);
  const leftUpperArm = spineLocal(anchors.leftUpperArm);
  const rightUpperArm = spineLocal(anchors.rightUpperArm);
  if (!hips || !neck || !leftUpperArm || !rightUpperArm) return null;
  const frame = buildTorsoMeasureFrame({
    up: [anchors.up.x, anchors.up.y, anchors.up.z],
    hips,
    neck,
    leftUpperArm,
    rightUpperArm,
  });
  if (!frame) return null;

  const torsoNodes = new Set<THREE.Object3D>();
  for (const boneName of TORSO_SILHOUETTE_BONES) {
    const boneNode = humanoid.getRawBoneNode(boneName);
    if (boneNode) torsoNodes.add(boneNode);
  }
  if (torsoNodes.size === 0) return null;

  const worldToSpine = new THREE.Matrix4().copy(spine.matrixWorld).invert();
  const vertex = new THREE.Vector3();
  const influenceIndices = [0, 0, 0, 0];
  const influenceWeights = [0, 0, 0, 0];
  const samples: BodySilhouetteSample[] = [];
  let inspected = 0;

  vrm.scene.traverse((object) => {
    if (inspected >= TORSO_SCENE_VERTEX_BUDGET) return;
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    // 이 스튜디오가 입힌 절차형 의상은 vrm.scene 안으로 포털되고 몸통 본에 스킨된다. 걸러 내지
    // 않으면 "몸"이 아니라 이미 입은 옷을 재게 되고, 다음 옷은 그 위에 또 여유분을 얹는다.
    if (isStudioAuthoredAttachment(mesh)) return;
    const skeleton = mesh.skeleton;
    if (!skeleton || skeleton.bones.length === 0) return;
    const geometry = mesh.geometry;
    if (
      !geometry.hasAttribute("position")
      || !geometry.hasAttribute("skinIndex")
      || !geometry.hasAttribute("skinWeight")
    ) return;
    if (
      !matrixIsFinite(mesh.bindMatrix)
      || !matrixIsFinite(mesh.bindMatrixInverse)
      || !matrixIsFinite(mesh.matrixWorld)
    ) return;
    const position = geometry.getAttribute("position");
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    if (skinIndex.itemSize < 4 || skinWeight.itemSize < 4) return;
    if (skinIndex.count < position.count || skinWeight.count < position.count) return;

    // Dominant bones select the torso region only. Actual shape uses every skin weight and morph.
    const torsoBoneIndices = new Set<number>();
    skeleton.bones.forEach((bone, index) => {
      if (torsoNodes.has(bone)) torsoBoneIndices.add(index);
    });
    if (torsoBoneIndices.size === 0) return;
    const sampleVertex = createStudioVrmSurfaceVertexSampler(mesh, worldToSpine);
    if (!sampleVertex) return;

    const stride = torsoVertexStride(position.count, TORSO_MESH_VERTEX_BUDGET);
    for (let index = 0; index < position.count; index += stride) {
      if (inspected >= TORSO_SCENE_VERTEX_BUDGET) break;
      inspected += 1;
      // 정규화 속성(ubyte/ushort 가중치)까지 풀어주는 접근자로 읽는다.
      influenceIndices[0] = skinIndex.getX(index);
      influenceIndices[1] = skinIndex.getY(index);
      influenceIndices[2] = skinIndex.getZ(index);
      influenceIndices[3] = skinIndex.getW(index);
      influenceWeights[0] = skinWeight.getX(index);
      influenceWeights[1] = skinWeight.getY(index);
      influenceWeights[2] = skinWeight.getZ(index);
      influenceWeights[3] = skinWeight.getW(index);
      const dominant = pickDominantSkinInfluence(influenceIndices, influenceWeights);
      if (!dominant) continue;
      if (!torsoBoneIndices.has(dominant.boneIndex)) continue;
      if (!sampleVertex(index, vertex)) continue;
      const sample = projectTorsoSample(frame, vertex.x, vertex.y, vertex.z);
      if (sample) samples.push(sample);
    }
  });

  if (samples.length < TORSO_MIN_SAMPLES) return null;
  return buildBodySilhouette(samples);
}

/**
 * 실제 스킨을 움직이는 raw 휴머노이드에서 본 로컬 치수를 잰다.
 * Avatar Forge가 raw 체형을 바꾼 뒤에도 같은 좌표계를 사용하므로 의상과 몸이 갈라지지 않는다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Shared Stage and Poser must measure the same pristine VRM rig.
export function measureStudioVrmWardrobeMetrics(vrm: VRM): WardrobeMetrics {
  const humanoid = vrm.humanoid;
  const fallback = sanitizeWardrobeMetrics(null);
  if (!humanoid) return fallback;
  vrm.scene.updateMatrixWorld(true);

  const node = (name: VRMHumanBoneName) => humanoid.getRawBoneNode(name);
  const world = (name: VRMHumanBoneName): THREE.Vector3 | null => {
    const n = node(name);
    return n ? n.getWorldPosition(new THREE.Vector3()) : null;
  };
  // 부착 본의 로컬 공간에서 목표 관절까지의 벡터. raw 본 스케일을 다시 곱하지 않도록
  // world 길이가 아니라 이 로컬 길이로 geometry를 만든다.
  const localVector = (from: VRMHumanBoneName, toWorld: THREE.Vector3): THREE.Vector3 | null => {
    const n = node(from);
    if (!n) return null;
    const vector = n.worldToLocal(toWorld.clone());
    return Number.isFinite(vector.x) && vector.lengthSq() > 1e-8 ? vector : null;
  };
  const toVec3 = (v: THREE.Vector3 | null): [number, number, number] | null => (v ? [v.x, v.y, v.z] : null);
  const localDistanceBetween = (
    anchor: VRMHumanBoneName,
    a: THREE.Vector3 | null,
    b: THREE.Vector3 | null,
  ): number | undefined => {
    const anchorNode = node(anchor);
    if (!anchorNode || !a || !b) return undefined;
    return anchorNode.worldToLocal(a.clone()).distanceTo(anchorNode.worldToLocal(b.clone()));
  };

  const hips = world("hips");
  const spine = world("spine");
  const neckW = world("neck") ?? world("head");
  const limb = (from: VRMHumanBoneName, to: VRMHumanBoneName, fb: LimbMetric): LimbMetric => {
    const b = world(to);
    const vector = b ? localVector(from, b) : null;
    if (!vector) return fb;
    const len = vector.length();
    const axis = vector.normalize();
    return { len, axis: toVec3(axis) ?? fb.axis };
  };

  const lUpArm = world("leftUpperArm");
  const rUpArm = world("rightUpperArm");
  const lUpLeg = world("leftUpperLeg");
  const rUpLeg = world("rightUpperLeg");
  const lFoot = world("leftFoot");
  const rFoot = world("rightFoot");
  const rigSource: WardrobeMetrics["source"] = ([
    "hips", "spine", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
    "leftHand", "rightHand", "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg",
    "leftFoot", "rightFoot",
  ] as const).every((boneName) => node(boneName)) && neckW
    ? "raw-rig"
    : "partial-rig";

  // 몸통 위 방향(spine 로컬) + 발 앞 방향(해부학: 왼쪽×위 = 앞).
  const upVector = spine && neckW ? localVector("spine", neckW) : null;
  const upLocal = upVector?.normalize() ?? null;
  let footForward = fallback.footForward;
  if (lUpLeg && rUpLeg && hips && neckW && lFoot && rFoot) {
    const leftWorld = lUpLeg.clone().sub(rUpLeg).normalize();
    const upWorld = neckW.clone().sub(hips).normalize();
    const fwdWorld = leftWorld.clone().cross(upWorld).normalize();
    const footLocalDir = (name: VRMHumanBoneName, at: THREE.Vector3): [number, number, number] | null => {
      const n = node(name);
      if (!n) return null;
      const origin = n.worldToLocal(at.clone());
      const tip = n.worldToLocal(at.clone().add(fwdWorld));
      const dir = tip.sub(origin).normalize();
      return Number.isFinite(dir.x) && dir.lengthSq() > 1e-8 ? [dir.x, dir.y, dir.z] : null;
    };
    footForward = {
      left: footLocalDir("leftFoot", lFoot) ?? fallback.footForward.left,
      right: footLocalDir("rightFoot", rFoot) ?? fallback.footForward.right,
    };
  }

  return sanitizeWardrobeMetrics({
    source: rigSource,
    // 스킨 표면 실측. 앵커나 표면 정점이 모자라면 null이 되고, 재단은 아래 골격 치수만 쓴다.
    torso: measureTorsoSilhouette(vrm, {
      spine: node("spine"),
      up: upLocal,
      hips,
      neck: neckW,
      leftUpperArm: lUpArm,
      rightUpperArm: rUpArm,
    }),
    shoulderW: localDistanceBetween("spine", lUpArm, rUpArm),
    hipW: localDistanceBetween("hips", lUpLeg, rUpLeg),
    hipsToSpine: spine ? localVector("hips", spine)?.length() : undefined,
    spineToNeck: neckW ? localVector("spine", neckW)?.length() : undefined,
    // Ground height is not represented by a humanoid bone. A lower-leg-relative value remains
    // stable under overall character scale and avoids measuring posed world Y as local geometry.
    ankleH: Math.max(
      0.02,
      (limb("leftLowerLeg", "leftFoot", fallback.lowerLeg.left).len
        + limb("rightLowerLeg", "rightFoot", fallback.lowerLeg.right).len) * 0.1,
    ),
    up: upLocal ? (toVec3(upLocal) ?? undefined) : undefined,
    footForward,
    upperArm: {
      left: limb("leftUpperArm", "leftLowerArm", fallback.upperArm.left),
      right: limb("rightUpperArm", "rightLowerArm", fallback.upperArm.right),
    },
    lowerArm: {
      left: limb("leftLowerArm", "leftHand", fallback.lowerArm.left),
      right: limb("rightLowerArm", "rightHand", fallback.lowerArm.right),
    },
    upperLeg: {
      left: limb("leftUpperLeg", "leftLowerLeg", fallback.upperLeg.left),
      right: limb("rightUpperLeg", "rightLowerLeg", fallback.upperLeg.right),
    },
    lowerLeg: {
      left: limb("leftLowerLeg", "leftFoot", fallback.lowerLeg.left),
      right: limb("rightLowerLeg", "rightFoot", fallback.lowerLeg.right),
    },
  });
}

const GARMENT_Y = new THREE.Vector3(0, 1, 0);
const GARMENT_Z = new THREE.Vector3(0, 0, 1);

function createGarmentWeaveTexture(fabricId: WardrobeEquip["fabricId"]): THREE.DataTexture | null {
  const fabric = wardrobeFabricById(fabricId);
  if (!fabric || fabric.weaveStrength <= 0) return null;
  const size = 128;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      data[y * size + x] = sampleStudioVrmGarmentWeave(fabric, u, v);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = `wardrobe-weave:${fabricId}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createGarmentMaterial(
  part: GarmentPart,
  itemColor: string,
  fabricId: WardrobeEquip["fabricId"],
  weaveTexture: THREE.DataTexture | null,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
  applyGarmentMaterialStyle(material, part, itemColor, fabricId, weaveTexture);
  return material;
}

function applyGarmentMaterialStyle(
  material: THREE.MeshPhysicalMaterial,
  part: GarmentPart,
  itemColor: string,
  fabricId: WardrobeEquip["fabricId"],
  weaveTexture: THREE.DataTexture | null,
) {
  const fabric = wardrobeFabricById(fabricId) ?? WARDROBE_FABRICS[0];
  const color = new THREE.Color(part.color ?? itemColor);
  const roughness = part.metalness !== undefined && part.metalness > 0.35
    ? part.roughness ?? fabric.roughness
    : fabric.roughness;
  const metalness = part.metalness ?? fabric.metalness;
  const fabricSurface = metalness < 0.35;
  material.color.copy(color);
  material.roughness = roughness;
  material.metalness = metalness;
  material.sheen = fabricSurface ? fabric.sheen : 0;
  material.sheenRoughness = fabricSurface ? fabric.sheenRoughness : 1;
  material.sheenColor.copy(color).lerp(new THREE.Color("#ffffff"), 0.12);
  material.clearcoat = fabric.clearcoat;
  material.clearcoatRoughness = fabric.clearcoatRoughness;
  material.bumpMap = fabricSurface ? weaveTexture : null;
  material.bumpScale = fabricSurface ? studioVrmGarmentBumpScaleM(fabric) : 0;
  material.userData.studioVrmGarmentPart = part;
  material.userData.studioVrmGarmentFabricId = fabricId;
  material.needsUpdate = true;
}

function disposeGarmentMaterials(materials: readonly THREE.Material[]) {
  const textures = new Set<THREE.Texture>();
  for (const material of materials) {
    const physical = material as THREE.MeshPhysicalMaterial;
    if (physical.bumpMap) textures.add(physical.bumpMap);
    material.dispose();
  }
  textures.forEach((texture) => texture.dispose());
}

/** 파츠 스펙 목록을 본별 three 그룹으로 조립한다. */
function assembleGarmentGroups(
  parts: GarmentPart[],
  itemColor: string,
  fabricId: WardrobeEquip["fabricId"],
  name: string,
): Map<WardrobeBone, THREE.Group> {
  const groups = new Map<WardrobeBone, THREE.Group>();
  const weaveTexture = createGarmentWeaveTexture(fabricId);
  for (const part of parts) {
    let group = groups.get(part.bone);
    if (!group) {
      group = new THREE.Group();
      group.name = `${name}:${part.bone}`;
      groups.set(part.bone, group);
    }
    const material = createGarmentMaterial(part, itemColor, fabricId, weaveTexture);
    const geometry = buildStudioVrmGarmentGeometry(part.shape);
    // Preserve analytic seam normals; UV duplicates are not separate cloth surfaces.
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(part.offset[0], part.offset[1], part.offset[2]);
    if (part.align) {
      // 실린더/박스/구는 +Y, 토러스는 링 축(+Z)을 목표 방향으로 정렬.
      const source = part.shape.kind === "torus" ? GARMENT_Z : GARMENT_Y;
      const target = new THREE.Vector3(part.align[0], part.align[1], part.align[2]).normalize();
      if (target.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(source, target);
    }
    if (part.squash) mesh.scale.set(part.squash[0], part.squash[1], part.squash[2]);
    group.add(mesh);
  }
  return groups;
}

function collectVrmSourceSkeletonBones(vrm: VRM): Set<THREE.Bone> {
  const bones = new Set<THREE.Bone>();
  vrm.scene.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    skinned.skeleton.bones.forEach((bone) => bones.add(bone));
  });
  return bones;
}

function assembleSkinnedGarment(
  vrm: VRM,
  parts: readonly GarmentPart[],
  itemColor: string,
  fabricId: WardrobeEquip["fabricId"],
  name: string,
) {
  const weaveTexture = createGarmentWeaveTexture(fabricId);
  const materials = parts.map((part) => createGarmentMaterial(part, itemColor, fabricId, weaveTexture));
  const sourceBones = collectVrmSourceSkeletonBones(vrm);
  const built = buildStudioVrmSkinnedGarment({
    name,
    root: vrm.scene,
    parts,
    materials,
    resolveBone: (boneName: StudioVrmGarmentSkinBone) => {
      const node = vrm.humanoid?.getRawBoneNode(boneName as VRMHumanBoneName) ?? null;
      return node && sourceBones.has(node as THREE.Bone) ? node : null;
    },
  });
  if (!built.surface) disposeGarmentMaterials(materials);
  return built;
}

function disposeGarmentObject(group: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      (mesh as THREE.SkinnedMesh).skeleton.dispose();
    }
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((m) => {
      const physical = m as THREE.MeshPhysicalMaterial | undefined;
      if (physical?.bumpMap) textures.add(physical.bumpMap);
      m?.dispose();
    });
  });
  textures.forEach((texture) => texture.dispose());
}

const pendingGarmentDisposals = new WeakMap<THREE.Object3D, object>();

function cancelScheduledGarmentDisposal(group: THREE.Object3D) {
  pendingGarmentDisposals.delete(group);
}

function scheduleGarmentDisposal(group: THREE.Object3D) {
  const token = {};
  pendingGarmentDisposals.set(group, token);
  queueMicrotask(() => {
    if (pendingGarmentDisposals.get(group) !== token) return;
    pendingGarmentDisposals.delete(group);
    disposeGarmentObject(group);
  });
}

export interface StudioVrmWardrobeAttachmentProps {
  readonly vrm: VRM;
  readonly slot: WardrobeSlot;
  readonly equip: WardrobeEquip;
  readonly metrics: WardrobeMetrics;
  readonly effectiveFit: number;
  readonly rigRevision?: number;
  readonly onSurfaceReceipt: (
    slot: WardrobeSlot,
    receipt: StudioVrmWardrobeSurfaceReceipt | null,
  ) => void;
  readonly onAttachmentStatus?: (
    slot: WardrobeSlot,
    itemId: string,
    status: StudioVrmProjectionAttachmentStatus,
  ) => void;
  readonly onXpbdCaptureSyncChange?: (
    slot: WardrobeSlot,
    sync: StudioVrmWardrobeCaptureSync,
    active: boolean,
  ) => void;
}

/** Selects exactly one authored garment provider before the attachment operation starts. */
export function StudioVrmWardrobeAttachment(props: StudioVrmWardrobeAttachmentProps) {
  const def = wardrobeItemById(props.equip.itemId);
  if (def?.geometrySource === "xpbd-skirt-v1") {
    return (
      <StudioVrmXpbdSkirtAttachment
        vrm={props.vrm}
        slot={props.slot}
        equip={props.equip}
        metrics={props.metrics}
        effectiveFit={props.effectiveFit}
        topologyGeneration={props.rigRevision}
        onSurfaceReceipt={props.onSurfaceReceipt}
        onAttachmentStatus={props.onAttachmentStatus}
        onCaptureSyncChange={props.onXpbdCaptureSyncChange}
      />
    );
  }
  if (def?.geometrySource === "skinned-procedural-v1") {
    return <StudioVrmSelectedWardrobeAttachment {...props} mode="skinned-procedural-v1" />;
  }
  if (def?.geometrySource === "rigid-procedural") {
    return <StudioVrmSelectedWardrobeAttachment {...props} mode="rigid-procedural" />;
  }
  return null;
}

/**
 * Mounts only the mode selected by the catalog before work starts. A failed skinned build stays
 * unavailable; bone-local rigid geometry is constructed only for an explicit rigid selection.
 */
function StudioVrmSelectedWardrobeAttachment({
  vrm,
  slot,
  equip,
  metrics,
  effectiveFit,
  onSurfaceReceipt,
  onAttachmentStatus,
  mode,
}: StudioVrmWardrobeAttachmentProps & {
  readonly mode: "skinned-procedural-v1" | "rigid-procedural";
}) {
  const renderable = useMemo(() => {
    const def = wardrobeItemById(equip.itemId);
    if (!def || def.geometrySource !== mode) {
      return { entries: [], receipt: null, complete: false };
    }
    const parts = buildGarmentParts(equip.itemId, metrics, effectiveFit);
    const name = `wardrobe:${def.slot}:${def.id}`;
    if (mode === "skinned-procedural-v1") {
      const built = assembleSkinnedGarment(
        vrm,
        parts,
        def.defaultColor,
        def.defaultFabricId,
        name,
      );
      if (built.surface) {
        return {
          entries: [{
            key: `${equip.itemId}:skinned`,
            node: vrm.scene as THREE.Object3D,
            object: built.surface.mesh as THREE.Object3D,
          }],
          receipt: built.receipt,
          complete: true,
        };
      }
      return {
        entries: [],
        receipt: built.receipt,
        // The skinned selection remains unavailable and renders no rigid substitute.
        complete: false,
      };
    }

    const groups = assembleGarmentGroups(
      parts,
      def.defaultColor,
      def.defaultFabricId,
      `wardrobe:${def.slot}:${def.id}`,
    );
    const entries: { key: string; node: THREE.Object3D; object: THREE.Object3D }[] = [];
    for (const [bone, object] of groups) {
      const boneNode = vrm.humanoid?.getRawBoneNode(bone as VRMHumanBoneName) ?? null;
      if (boneNode) entries.push({ key: `${equip.itemId}:${bone}`, node: boneNode, object });
    }
    return {
      entries,
      receipt: null,
      complete: groups.size > 0 && entries.length === groups.size,
    };
  }, [vrm, equip.itemId, effectiveFit, metrics, mode]);

  const entries = renderable.entries;

  useLayoutEffect(() => {
    if (!onAttachmentStatus) return;
    onAttachmentStatus(
      slot,
      equip.itemId,
      renderable.complete ? "ready" : "unavailable",
    );
    return () => onAttachmentStatus(slot, equip.itemId, "detached");
  }, [equip.itemId, onAttachmentStatus, renderable.complete, slot]);

  // 색상·원단만 바뀔 때 geometry/Skeleton을 다시 만들면 현재 포즈가 새 bind pose가 된다.
  // 재질만 제자리에서 갱신해 포즈·핏·스키닝 표면을 그대로 유지한다.
  useLayoutEffect(() => {
    const materials = new Set<THREE.MeshPhysicalMaterial>();
    for (const entry of entries) {
      entry.object.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of meshMaterials) {
          if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
            materials.add(material as THREE.MeshPhysicalMaterial);
          }
        }
      });
    }
    if (materials.size === 0) return;

    const fabricChanged = [...materials].some(
      (material) => material.userData.studioVrmGarmentFabricId !== equip.fabricId,
    );
    const replacementWeave = fabricChanged ? createGarmentWeaveTexture(equip.fabricId) : null;
    const retiredTextures = new Set<THREE.Texture>();
    let replacementUsed = false;

    for (const material of materials) {
      const part = material.userData.studioVrmGarmentPart as GarmentPart | undefined;
      if (!part) continue;
      const previousBump = material.bumpMap;
      const nextWeave = fabricChanged ? replacementWeave : previousBump as THREE.DataTexture | null;
      applyGarmentMaterialStyle(material, part, equip.color, equip.fabricId, nextWeave);
      if (replacementWeave && material.bumpMap === replacementWeave) replacementUsed = true;
      if (previousBump && previousBump !== material.bumpMap) retiredTextures.add(previousBump);
    }

    retiredTextures.forEach((texture) => texture.dispose());
    if (replacementWeave && !replacementUsed) replacementWeave.dispose();
  }, [entries, equip.color, equip.fabricId]);

  // GPU 버퍼 정리 — StrictMode의 setup→cleanup→setup에서는 같은 object 폐기를 취소하고,
  // 실제 아이템/색/핏 교체나 언마운트에서만 다음 microtask에 해제한다.
  useEffect(() => {
    entries.forEach((entry) => cancelScheduledGarmentDisposal(entry.object));
    return () => entries.forEach((entry) => scheduleGarmentDisposal(entry.object));
  }, [entries]);

  useEffect(() => {
    onSurfaceReceipt(slot, renderable.receipt);
  }, [onSurfaceReceipt, renderable.receipt, slot]);

  return (
    <>
      {entries.map((entry) => (
        <group key={entry.key}>{createPortal(<primitive object={entry.object} />, entry.node)}</group>
      ))}
    </>
  );
}

/** base pose/tracking과 모든 소품 IK가 끝난 뒤 normalized pose를 raw VRM에 한 번만 전달한다. */
export function StudioVrmRuntimeCommit({
  vrm,
  physicsPreview,
  webcamActive,
  onCommitFrame,
}: {
  vrm: VRM;
  physicsPreview: boolean;
  webcamActive: boolean;
  onCommitFrame?: (frame: number) => void;
}) {
  const frameRef = useRef(0);
  useFrame((_, delta) => {
    // 흔들림 미리보기·웹캠 트래킹 중에만 스프링본을 전진시키고, 탭 복귀 폭주는 상한 처리한다.
    const springDelta = webcamActive || physicsPreview
      ? Math.min(delta, PHYSICS_PREVIEW_MAX_DELTA)
      : 0;
    vrm.update(springDelta);
    const frame = frameRef.current;
    frameRef.current += 1;
    onCommitFrame?.(frame);
  }, VRM_FRAME_COMMIT_PRIORITY);
  return null;
}
