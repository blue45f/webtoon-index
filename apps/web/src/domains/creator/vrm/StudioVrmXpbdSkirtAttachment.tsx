/* eslint-disable react-refresh/only-export-components -- The tested Three.js runtime is owned by this R3F leaf. */

import { createPortal, useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";

import {
  WARDROBE_FABRICS,
  sanitizeWardrobeMetrics,
  wardrobeFabricById,
  type WardrobeEquip,
  type WardrobeMetrics,
  type WardrobeSlot,
} from "./studio-vrm-wardrobe";
import {
  STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
  STUDIO_VRM_XPBD_SKIRT_VERSION,
  createStudioVrmXpbdSkirtTopology,
  solveStudioVrmXpbdSkirtPose,
  type StudioVrmXpbdSkirtBodyProxies,
  type StudioVrmXpbdSkirtCapsuleProxy,
  type StudioVrmXpbdSkirtKind,
  type StudioVrmXpbdSkirtMetrics,
  type StudioVrmXpbdSkirtSolveReceipt,
  type StudioVrmXpbdSkirtTopology,
  type StudioVrmXpbdSkirtVec3,
  type StudioVrmXpbdSkirtWaistFrame,
} from "./studio-vrm-xpbd-skirt";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/** Runs after normalized pose/prop IK/VRM raw-bone commit and before R3F's automatic render. */
export const VRM_FRAME_XPBD_SKIRT_PRIORITY = -0.5;

export type StudioVrmXpbdSkirtDeviceTier = "desktop" | "mobile";

export interface StudioVrmXpbdSkirtDeviceSignals {
  readonly hardwareConcurrency?: number;
  readonly deviceMemoryGb?: number;
  readonly mobileUserAgent?: boolean;
}

export interface StudioVrmXpbdSkirtDevicePlan {
  readonly tier: StudioVrmXpbdSkirtDeviceTier;
  readonly segmentCount: number;
  readonly pleatedRingCount: number;
  readonly longSkirtRingCount: number;
  readonly solverIterations: number;
  readonly pleatedRestToPoseSteps: number;
  readonly longSkirtRestToPoseSteps: number;
  /** SHA-producing rest-to-pose solves are capped; lightweight pose sampling still runs per frame. */
  readonly maxSolveHz: number;
}

const DESKTOP_DEVICE_PLAN: StudioVrmXpbdSkirtDevicePlan = Object.freeze({
  tier: "desktop",
  segmentCount: 48,
  pleatedRingCount: 7,
  longSkirtRingCount: 10,
  solverIterations: 6,
  pleatedRestToPoseSteps: 8,
  longSkirtRestToPoseSteps: 12,
  maxSolveHz: 20,
});

const MOBILE_DEVICE_PLAN: StudioVrmXpbdSkirtDevicePlan = Object.freeze({
  tier: "mobile",
  segmentCount: 24,
  pleatedRingCount: 5,
  longSkirtRingCount: 7,
  solverIterations: 4,
  pleatedRestToPoseSteps: 4,
  longSkirtRestToPoseSteps: 6,
  maxSolveHz: 10,
});

export function planStudioVrmXpbdSkirtDeviceTier(
  signals: StudioVrmXpbdSkirtDeviceSignals,
): StudioVrmXpbdSkirtDevicePlan {
  const constrained = signals.mobileUserAgent === true
    || (Number.isFinite(signals.hardwareConcurrency) && (signals.hardwareConcurrency ?? 0) <= 4)
    || (Number.isFinite(signals.deviceMemoryGb) && (signals.deviceMemoryGb ?? 0) <= 4);
  return constrained ? MOBILE_DEVICE_PLAN : DESKTOP_DEVICE_PLAN;
}

export interface StudioVrmXpbdSkirtSolveCadence {
  readonly shouldSolve: (
    deltaSeconds: number,
    poseSignature: string,
    captureActive: boolean,
  ) => boolean;
  readonly markSolved: (poseSignature: string) => void;
}

export function createStudioVrmXpbdSkirtSolveCadence(
  maxSolveHz: number,
): StudioVrmXpbdSkirtSolveCadence {
  const safeMaxSolveHz = clamp(Number.isFinite(maxSolveHz) ? maxSolveHz : 1, 1, 60);
  let elapsedSeconds = 0;
  let lastSolvedPoseSignature: string | null = null;
  let captureWasActive = false;
  return {
    shouldSolve(deltaSeconds, poseSignature, captureActive) {
      elapsedSeconds = Math.min(
        elapsedSeconds + Math.min(Math.max(deltaSeconds, 0), 0.25),
        1,
      );
      const captureEdge = captureActive && !captureWasActive;
      captureWasActive = captureActive;
      const initialSolve = lastSolvedPoseSignature === null;
      const poseChanged = poseSignature !== lastSolvedPoseSignature;
      const cadenceReady = elapsedSeconds >= 1 / safeMaxSolveHz;
      return initialSolve || captureEdge || (poseChanged && cadenceReady);
    },
    markSolved(poseSignature) {
      elapsedSeconds = 0;
      lastSolvedPoseSignature = poseSignature;
    },
  };
}

function readStudioVrmXpbdSkirtDeviceSignals(): StudioVrmXpbdSkirtDeviceSignals {
  if (typeof navigator === "undefined") return {};
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: deviceMemory,
    mobileUserAgent: /Android|iPad|iPhone|iPod|Mobile/iu.test(navigator.userAgent),
  };
}

export interface StudioVrmXpbdSkirtSurfaceReceipt {
  readonly kind: "studio-vrm-xpbd-skirt-surface-receipt";
  readonly version: typeof STUDIO_VRM_XPBD_SKIRT_VERSION;
  readonly mode: "xpbd-skirt-v1";
  readonly signature: string;
  readonly garmentKind: StudioVrmXpbdSkirtKind;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly solverIterations: number;
  readonly restToPoseSteps: number;
  readonly deviceTier: StudioVrmXpbdSkirtDeviceTier;
  readonly selfCollisionEnabled: false;
}

export interface StudioVrmXpbdSkirtSurface {
  readonly mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshPhysicalMaterial;
  readonly skeleton: THREE.Skeleton;
  readonly receipt: StudioVrmXpbdSkirtSurfaceReceipt;
  readonly disposed: boolean;
  readonly retain: () => boolean;
  readonly release: () => void;
  readonly updateMaterial: (color: string, fabricId: WardrobeEquip["fabricId"]) => void;
}

export type StudioVrmXpbdSkirtAttachmentUnavailableCode =
  | "disposed"
  | "invalid-generation"
  | "missing-bone"
  | "invalid-rig-frame"
  | "stale-topology-generation"
  | "stale-pose-generation"
  | "topology-unavailable"
  | "solver-unavailable"
  | "geometry-unavailable";

export interface StudioVrmXpbdSkirtAttachmentUnavailable {
  readonly ok: false;
  readonly status: "unavailable";
  readonly code: StudioVrmXpbdSkirtAttachmentUnavailableCode;
  readonly detail: string;
}

export interface StudioVrmXpbdSkirtAttachmentFrameReceipt {
  readonly ok: true;
  readonly status: "ready";
  readonly topologyGeneration: number;
  readonly poseGeneration: number;
  readonly surface: StudioVrmXpbdSkirtSurfaceReceipt;
  readonly solve: StudioVrmXpbdSkirtSolveReceipt;
}

export type StudioVrmXpbdSkirtAttachmentFrameResult =
  | StudioVrmXpbdSkirtAttachmentFrameReceipt
  | StudioVrmXpbdSkirtAttachmentUnavailable;

/** Synchronous capture fence: solves the latest raw-bone pose into the mounted viewport mesh. */
export type StudioVrmXpbdSkirtCaptureSync = () => StudioVrmXpbdSkirtAttachmentFrameResult;

export interface StudioVrmXpbdSkirtAttachmentRuntime {
  readonly topologyGeneration: number;
  readonly topology: StudioVrmXpbdSkirtTopology;
  readonly surface: StudioVrmXpbdSkirtSurface;
  readonly devicePlan: StudioVrmXpbdSkirtDevicePlan;
  readonly lastPoseGeneration: number;
  readonly solveCount: number;
  readonly readPoseSignature: () => string | null;
  readonly step: (
    expectedTopologyGeneration: number,
    poseGeneration: number,
  ) => StudioVrmXpbdSkirtAttachmentFrameResult;
  readonly retain: () => boolean;
  readonly release: () => void;
}

export type StudioVrmXpbdSkirtAttachmentRuntimeResult =
  | { readonly ok: true; readonly runtime: StudioVrmXpbdSkirtAttachmentRuntime }
  | StudioVrmXpbdSkirtAttachmentUnavailable;

interface StudioVrmXpbdSkirtRuntimeBinding {
  readonly vrm: VRM;
  readonly kind: StudioVrmXpbdSkirtKind;
  readonly metrics: WardrobeMetrics;
  readonly effectiveFit: number;
  readonly topologyGeneration: number;
  readonly devicePlan: StudioVrmXpbdSkirtDevicePlan;
  readonly result: StudioVrmXpbdSkirtAttachmentRuntimeResult;
  readonly releaseOwnerLease: () => void;
}

function unavailable(
  code: StudioVrmXpbdSkirtAttachmentUnavailableCode,
  detail: string,
): StudioVrmXpbdSkirtAttachmentUnavailable {
  return Object.freeze({ ok: false, status: "unavailable", code, detail });
}

function readSelectedRuntimePoseSignature(
  runtime: StudioVrmXpbdSkirtAttachmentRuntime,
): string | null {
  try {
    return runtime.readPoseSignature();
  } catch {
    return null;
  }
}

function stepSelectedRuntime(
  runtime: StudioVrmXpbdSkirtAttachmentRuntime,
  topologyGeneration: number,
  poseGeneration: number,
): StudioVrmXpbdSkirtAttachmentFrameResult {
  try {
    return runtime.step(topologyGeneration, poseGeneration);
  } catch {
    return unavailable(
      "solver-unavailable",
      "The selected XPBD skirt runtime failed while solving the current attachment epoch.",
    );
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tuple(vector: THREE.Vector3): StudioVrmXpbdSkirtVec3 {
  return [Math.fround(vector.x), Math.fround(vector.y), Math.fround(vector.z)];
}

function finiteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

interface SkirtRigNodes {
  readonly hips: THREE.Object3D;
  readonly spine: THREE.Object3D;
  readonly leftUpperLeg: THREE.Object3D;
  readonly rightUpperLeg: THREE.Object3D;
  readonly leftLowerLeg: THREE.Object3D;
  readonly rightLowerLeg: THREE.Object3D;
  readonly leftFoot: THREE.Object3D | null;
  readonly rightFoot: THREE.Object3D | null;
}

function resolveRigNodes(
  vrm: VRM,
  kind: StudioVrmXpbdSkirtKind,
): { readonly ok: true; readonly nodes: SkirtRigNodes } | StudioVrmXpbdSkirtAttachmentUnavailable {
  const humanoid = vrm.humanoid;
  if (!humanoid) return unavailable("missing-bone", "The VRM has no humanoid rig.");
  const node = (name: VRMHumanBoneName) => humanoid.getRawBoneNode(name);
  const required = {
    hips: node("hips"),
    spine: node("spine"),
    leftUpperLeg: node("leftUpperLeg"),
    rightUpperLeg: node("rightUpperLeg"),
    leftLowerLeg: node("leftLowerLeg"),
    rightLowerLeg: node("rightLowerLeg"),
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value) return unavailable("missing-bone", `The XPBD skirt requires ${name}.`);
  }
  const leftFoot = node("leftFoot");
  const rightFoot = node("rightFoot");
  if (kind === "longskirt" && (!leftFoot || !rightFoot)) {
    return unavailable("missing-bone", "The long XPBD skirt requires both foot bones.");
  }
  return {
    ok: true,
    nodes: {
      hips: required.hips!,
      spine: required.spine!,
      leftUpperLeg: required.leftUpperLeg!,
      rightUpperLeg: required.rightUpperLeg!,
      leftLowerLeg: required.leftLowerLeg!,
      rightLowerLeg: required.rightLowerLeg!,
      leftFoot,
      rightFoot,
    },
  };
}

function sceneLocalPosition(scene: THREE.Object3D, node: THREE.Object3D): THREE.Vector3 | null {
  const world = node.getWorldPosition(new THREE.Vector3());
  const local = scene.worldToLocal(world);
  return finiteVector(local) ? local : null;
}

interface SampledSkirtRig {
  readonly waist: StudioVrmXpbdSkirtWaistFrame;
  readonly points: {
    readonly leftUpperLeg: StudioVrmXpbdSkirtVec3;
    readonly rightUpperLeg: StudioVrmXpbdSkirtVec3;
    readonly leftLowerLeg: StudioVrmXpbdSkirtVec3;
    readonly rightLowerLeg: StudioVrmXpbdSkirtVec3;
    readonly leftFoot: StudioVrmXpbdSkirtVec3 | null;
    readonly rightFoot: StudioVrmXpbdSkirtVec3 | null;
  };
}

function sampleRig(
  scene: THREE.Object3D,
  nodes: SkirtRigNodes,
  metrics: WardrobeMetrics,
): SampledSkirtRig | null {
  scene.updateMatrixWorld(true);
  const hips = sceneLocalPosition(scene, nodes.hips);
  const spine = sceneLocalPosition(scene, nodes.spine);
  const leftUpperLeg = sceneLocalPosition(scene, nodes.leftUpperLeg);
  const rightUpperLeg = sceneLocalPosition(scene, nodes.rightUpperLeg);
  const leftLowerLeg = sceneLocalPosition(scene, nodes.leftLowerLeg);
  const rightLowerLeg = sceneLocalPosition(scene, nodes.rightLowerLeg);
  const leftFoot = nodes.leftFoot ? sceneLocalPosition(scene, nodes.leftFoot) : null;
  const rightFoot = nodes.rightFoot ? sceneLocalPosition(scene, nodes.rightFoot) : null;
  if (
    !hips || !spine || !leftUpperLeg || !rightUpperLeg || !leftLowerLeg || !rightLowerLeg
    || (nodes.leftFoot && !leftFoot) || (nodes.rightFoot && !rightFoot)
  ) return null;

  const right = leftUpperLeg.clone().sub(rightUpperLeg).normalize();
  const suppliedUp = spine.clone().sub(hips);
  const up = suppliedUp.addScaledVector(right, -suppliedUp.dot(right)).normalize();
  const forward = right.clone().cross(up).normalize();
  if (
    !finiteVector(right) || !finiteVector(up) || !finiteVector(forward)
    || right.lengthSq() < 0.99 || up.lengthSq() < 0.99 || forward.lengthSq() < 0.99
  ) return null;
  const center = hips.clone().addScaledVector(up, metrics.hipsToSpine * 0.55);
  return {
    waist: {
      center: tuple(center),
      right: tuple(right),
      up: tuple(up),
      forward: tuple(forward),
    },
    points: {
      leftUpperLeg: tuple(leftUpperLeg),
      rightUpperLeg: tuple(rightUpperLeg),
      leftLowerLeg: tuple(leftLowerLeg),
      rightLowerLeg: tuple(rightLowerLeg),
      leftFoot: leftFoot ? tuple(leftFoot) : null,
      rightFoot: rightFoot ? tuple(rightFoot) : null,
    },
  };
}

function capsule(
  restHead: StudioVrmXpbdSkirtVec3,
  restTail: StudioVrmXpbdSkirtVec3,
  currentHead: StudioVrmXpbdSkirtVec3,
  currentTail: StudioVrmXpbdSkirtVec3,
  radius: number,
): StudioVrmXpbdSkirtCapsuleProxy {
  return {
    restHead,
    restTail,
    currentHead,
    currentTail,
    radius: clamp(radius, 0.004, 0.5),
    friction: 0.42,
  };
}

function bodyProxies(
  kind: StudioVrmXpbdSkirtKind,
  rest: SampledSkirtRig,
  current: SampledSkirtRig,
  metrics: WardrobeMetrics,
  fit: number,
): StudioVrmXpbdSkirtBodyProxies | null {
  const thighRadius = Math.max(metrics.hipW * 0.28, (
    metrics.upperLeg.left.len + metrics.upperLeg.right.len
  ) * 0.065) * fit;
  const calfRadius = Math.max(metrics.hipW * 0.22, (
    metrics.lowerLeg.left.len + metrics.lowerLeg.right.len
  ) * 0.05) * fit;
  const result: StudioVrmXpbdSkirtBodyProxies = {
    hips: capsule(
      rest.points.rightUpperLeg,
      rest.points.leftUpperLeg,
      current.points.rightUpperLeg,
      current.points.leftUpperLeg,
      Math.max(metrics.hipW * 0.38, metrics.shoulderW * 0.2) * fit,
    ),
    leftThigh: capsule(
      rest.points.leftUpperLeg,
      rest.points.leftLowerLeg,
      current.points.leftUpperLeg,
      current.points.leftLowerLeg,
      thighRadius,
    ),
    rightThigh: capsule(
      rest.points.rightUpperLeg,
      rest.points.rightLowerLeg,
      current.points.rightUpperLeg,
      current.points.rightLowerLeg,
      thighRadius,
    ),
  };
  if (kind === "longskirt") {
    if (
      !rest.points.leftFoot || !rest.points.rightFoot
      || !current.points.leftFoot || !current.points.rightFoot
    ) return null;
    return {
      ...result,
      leftCalf: capsule(
        rest.points.leftLowerLeg,
        rest.points.leftFoot,
        current.points.leftLowerLeg,
        current.points.leftFoot,
        calfRadius,
      ),
      rightCalf: capsule(
        rest.points.rightLowerLeg,
        rest.points.rightFoot,
        current.points.rightLowerLeg,
        current.points.rightFoot,
        calfRadius,
      ),
    };
  }
  return result;
}

function sampledRigSignature(sample: SampledSkirtRig): string {
  const values = [
    ...sample.waist.center,
    ...sample.waist.right,
    ...sample.waist.up,
    ...sample.waist.forward,
    ...sample.points.leftUpperLeg,
    ...sample.points.rightUpperLeg,
    ...sample.points.leftLowerLeg,
    ...sample.points.rightLowerLeg,
    ...(sample.points.leftFoot ?? []),
    ...(sample.points.rightFoot ?? []),
  ];
  // This is only a cheap change detector. Authoritative outputs retain the core SHA receipts.
  return values.map((value) => Math.round(value * 100_000)).join(",");
}

export function deriveStudioVrmXpbdSkirtMetrics(
  rawMetrics: WardrobeMetrics,
): StudioVrmXpbdSkirtMetrics {
  const metrics = sanitizeWardrobeMetrics(rawMetrics);
  const upperLeg = (metrics.upperLeg.left.len + metrics.upperLeg.right.len) * 0.5;
  const lowerLeg = (metrics.lowerLeg.left.len + metrics.lowerLeg.right.len) * 0.5;
  const legLength = clamp(upperLeg + lowerLeg, 0.1, 2.2);
  const hipsHeight = clamp(legLength + metrics.ankleH, 0.1, 2.8);
  const estimatedHeadLength = clamp(metrics.shoulderW * 0.64, 0.08, 0.42);
  const totalHeight = clamp(
    hipsHeight + metrics.hipsToSpine + metrics.spineToNeck + estimatedHeadLength,
    0.35,
    3.5,
  );
  return Object.freeze({
    totalHeight,
    headUnits: clamp(totalHeight / estimatedHeadLength, 1.5, 14),
    hipsHeight,
    legLength,
    shoulderSpan: clamp(metrics.shoulderW, 0.03, 1.2),
  });
}

function createWeaveTexture(fabricId: WardrobeEquip["fabricId"]): THREE.DataTexture | null {
  const fabric = wardrobeFabricById(fabricId);
  if (!fabric || fabric.weaveStrength <= 0) return null;
  const size = 32;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warp = Math.sin((x / size) * Math.PI * 2 * fabric.weaveFrequency);
      const weft = Math.sin((y / size) * Math.PI * 2 * fabric.weaveFrequency * 0.92);
      data[y * size + x] = Math.round(clamp(128 + warp * 32 + weft * 24, 0, 255));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = `wardrobe-xpbd-weave:${fabricId}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function applySurfaceMaterial(
  material: THREE.MeshPhysicalMaterial,
  color: string,
  fabricId: WardrobeEquip["fabricId"],
) {
  const fabric = wardrobeFabricById(fabricId) ?? WARDROBE_FABRICS[0];
  const previousTexture = material.bumpMap;
  const nextTexture = previousTexture?.name === `wardrobe-xpbd-weave:${fabricId}`
    ? previousTexture
    : createWeaveTexture(fabricId);
  material.color.set(color);
  material.roughness = fabric.roughness;
  material.metalness = fabric.metalness;
  material.sheen = fabric.sheen;
  material.sheenRoughness = fabric.sheenRoughness;
  material.sheenColor.copy(material.color).lerp(new THREE.Color("#ffffff"), 0.12);
  material.clearcoat = fabric.clearcoat;
  material.clearcoatRoughness = fabric.clearcoatRoughness;
  material.bumpMap = nextTexture;
  material.bumpScale = fabric.weaveStrength;
  material.userData.studioVrmGarmentFabricId = fabricId;
  material.needsUpdate = true;
  if (previousTexture && previousTexture !== nextTexture) previousTexture.dispose();
}

export function createStudioVrmXpbdSkirtSurface(
  topology: StudioVrmXpbdSkirtTopology,
  color: string,
  fabricId: WardrobeEquip["fabricId"],
  devicePlan: StudioVrmXpbdSkirtDevicePlan,
): StudioVrmXpbdSkirtSurface {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(topology.restPositions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(topology.uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(topology.triangleIndices), 1));
  const skinIndex = new Uint16Array(topology.particleCount * 4);
  const skinWeight = new Float32Array(topology.particleCount * 4);
  for (let particle = 0; particle < topology.particleCount; particle += 1) {
    skinWeight[particle * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
  applySurfaceMaterial(material, color, fabricId);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const rootBone = new THREE.Bone();
  rootBone.name = `wardrobe-xpbd:${topology.kind}:surface-root`;
  mesh.add(rootBone);
  const skeleton = new THREE.Skeleton([rootBone]);
  mesh.bind(skeleton);
  mesh.name = `wardrobe:bottom:${topology.kind}:xpbd`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The bounded cloth can leave its authored rest bounds on the very next frame.
  mesh.frustumCulled = false;
  mesh.userData.studioVrmXpbdSkirtTopologySha256 = topology.topologySha256;

  const restToPoseSteps = topology.kind === "pleated"
    ? devicePlan.pleatedRestToPoseSteps
    : devicePlan.longSkirtRestToPoseSteps;
  const receipt: StudioVrmXpbdSkirtSurfaceReceipt = Object.freeze({
    kind: "studio-vrm-xpbd-skirt-surface-receipt",
    version: STUDIO_VRM_XPBD_SKIRT_VERSION,
    mode: "xpbd-skirt-v1",
    signature: `xpbd-skirt-v1:${topology.topologySha256}`,
    garmentKind: topology.kind,
    vertexCount: topology.particleCount,
    triangleCount: topology.triangleCount,
    solverIterations: devicePlan.solverIterations,
    restToPoseSteps,
    deviceTier: devicePlan.tier,
    selfCollisionEnabled: STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
  });

  let retainCount = 0;
  let disposalGeneration = 0;
  let disposed = false;
  const disposeNow = () => {
    if (disposed) return;
    disposed = true;
    const bumpMap = material.bumpMap;
    material.bumpMap = null;
    bumpMap?.dispose();
    skeleton.dispose();
    geometry.dispose();
    material.dispose();
  };
  const surface: StudioVrmXpbdSkirtSurface = {
    mesh,
    geometry,
    material,
    skeleton,
    receipt,
    get disposed() {
      return disposed;
    },
    retain() {
      if (disposed) return false;
      retainCount += 1;
      disposalGeneration += 1;
      return true;
    },
    release() {
      retainCount = Math.max(0, retainCount - 1);
      if (retainCount > 0 || disposed) return;
      const expectedGeneration = ++disposalGeneration;
      queueMicrotask(() => {
        if (disposed || retainCount > 0 || disposalGeneration !== expectedGeneration) return;
        disposeNow();
      });
    },
    updateMaterial(nextColor, nextFabricId) {
      if (!disposed) applySurfaceMaterial(material, nextColor, nextFabricId);
    },
  };
  return surface;
}

export function createStudioVrmXpbdSkirtAttachmentRuntime({
  vrm,
  kind,
  metrics: rawMetrics,
  effectiveFit,
  topologyGeneration,
  devicePlan,
  color,
  fabricId,
}: {
  readonly vrm: VRM;
  readonly kind: StudioVrmXpbdSkirtKind;
  readonly metrics: WardrobeMetrics;
  readonly effectiveFit: number;
  readonly topologyGeneration: number;
  readonly devicePlan: StudioVrmXpbdSkirtDevicePlan;
  readonly color: string;
  readonly fabricId: WardrobeEquip["fabricId"];
}): StudioVrmXpbdSkirtAttachmentRuntimeResult {
  if (!Number.isSafeInteger(topologyGeneration) || topologyGeneration < 0) {
    return unavailable("invalid-generation", "Topology generation must be a non-negative safe integer.");
  }
  const resolvedNodes = resolveRigNodes(vrm, kind);
  if (!resolvedNodes.ok) return resolvedNodes;
  const metrics = sanitizeWardrobeMetrics(rawMetrics);
  const restRig = sampleRig(vrm.scene, resolvedNodes.nodes, metrics);
  if (!restRig) return unavailable("invalid-rig-frame", "The skirt rig frame is non-finite or degenerate.");
  const fit = clamp(Number.isFinite(effectiveFit) ? effectiveFit : 1, 0.75, 1.35);
  const topologyResult = createStudioVrmXpbdSkirtTopology({
    kind,
    metrics: deriveStudioVrmXpbdSkirtMetrics(metrics),
    restWaist: restRig.waist,
    fit,
    segmentCount: devicePlan.segmentCount,
    ringCount: kind === "pleated" ? devicePlan.pleatedRingCount : devicePlan.longSkirtRingCount,
    solverIterations: devicePlan.solverIterations,
    topologyEpoch: topologyGeneration + 1,
  });
  if (!topologyResult.ok) {
    return unavailable(
      "topology-unavailable",
      `XPBD skirt topology is unavailable (${topologyResult.code}): ${topologyResult.detail}`,
    );
  }
  const topology = topologyResult.topology;
  const surface = createStudioVrmXpbdSkirtSurface(topology, color, fabricId, devicePlan);
  let lastPoseGeneration = -1;
  let solveCount = 0;
  const runtime: StudioVrmXpbdSkirtAttachmentRuntime = {
    topologyGeneration,
    topology,
    surface,
    devicePlan,
    get lastPoseGeneration() {
      return lastPoseGeneration;
    },
    get solveCount() {
      return solveCount;
    },
    readPoseSignature() {
      const currentRig = sampleRig(vrm.scene, resolvedNodes.nodes, metrics);
      return currentRig ? sampledRigSignature(currentRig) : null;
    },
    step(expectedTopologyGeneration, poseGeneration) {
      if (surface.disposed) return unavailable("disposed", "The XPBD skirt surface was disposed.");
      if (expectedTopologyGeneration !== topologyGeneration) {
        return unavailable(
          "stale-topology-generation",
          `Expected topology generation ${topologyGeneration}, received ${expectedTopologyGeneration}.`,
        );
      }
      if (
        !Number.isSafeInteger(poseGeneration)
        || poseGeneration < 0
        || poseGeneration <= lastPoseGeneration
      ) {
        return unavailable(
          "stale-pose-generation",
          `Pose generation ${poseGeneration} does not follow ${lastPoseGeneration}.`,
        );
      }
      const currentRig = sampleRig(vrm.scene, resolvedNodes.nodes, metrics);
      if (!currentRig) return unavailable("invalid-rig-frame", "The current skirt rig frame is unavailable.");
      const body = bodyProxies(kind, restRig, currentRig, metrics, fit);
      if (!body) return unavailable("missing-bone", "The current long-skirt calf proxies are unavailable.");
      const solved = solveStudioVrmXpbdSkirtPose(topology, {
        expectedPoseGeneration: poseGeneration,
        poseGeneration,
        expectedTopologySha256: topology.topologySha256,
        currentWaist: currentRig.waist,
        body,
        restToPoseSteps: kind === "pleated"
          ? devicePlan.pleatedRestToPoseSteps
          : devicePlan.longSkirtRestToPoseSteps,
        solverIterations: devicePlan.solverIterations,
      });
      if (!solved.ok) {
        return unavailable(
          "solver-unavailable",
          `XPBD skirt solve is unavailable (${solved.code}): ${solved.detail}`,
        );
      }
      const position = surface.geometry.getAttribute("position");
      if (
        !(position.array instanceof Float32Array)
        || position.array.length !== solved.mesh.positions.length
      ) {
        return unavailable("geometry-unavailable", "The skirt GPU position buffer no longer matches its topology.");
      }
      position.array.set(solved.mesh.positions);
      position.needsUpdate = true;
      surface.geometry.computeVertexNormals();
      const normal = surface.geometry.getAttribute("normal");
      normal.needsUpdate = true;
      surface.mesh.userData.studioVrmXpbdSkirtSolveReceipt = solved.mesh.receipt;
      lastPoseGeneration = poseGeneration;
      solveCount += 1;
      return Object.freeze({
        ok: true,
        status: "ready",
        topologyGeneration,
        poseGeneration,
        surface: surface.receipt,
        solve: solved.mesh.receipt,
      });
    },
    retain: surface.retain,
    release: surface.release,
  };
  return Object.freeze({ ok: true, runtime });
}

export function StudioVrmXpbdSkirtAttachment({
  vrm,
  slot,
  equip,
  metrics,
  effectiveFit,
  topologyGeneration = 0,
  onSurfaceReceipt,
  onAttachmentStatus,
  onCaptureSyncChange,
}: {
  readonly vrm: VRM;
  readonly slot: WardrobeSlot;
  readonly equip: WardrobeEquip;
  readonly metrics: WardrobeMetrics;
  readonly effectiveFit: number;
  readonly topologyGeneration?: number;
  readonly onSurfaceReceipt: (
    slot: WardrobeSlot,
    receipt: StudioVrmXpbdSkirtSurfaceReceipt | null,
  ) => void;
  readonly onAttachmentStatus?: (
    slot: WardrobeSlot,
    itemId: string,
    status: "ready" | "unavailable" | "detached",
  ) => void;
  readonly onCaptureSyncChange?: (
    slot: WardrobeSlot,
    sync: StudioVrmXpbdSkirtCaptureSync,
    active: boolean,
  ) => void;
}) {
  const kind = equip.itemId as StudioVrmXpbdSkirtKind;
  const [devicePlan] = useState(() => planStudioVrmXpbdSkirtDeviceTier(
    readStudioVrmXpbdSkirtDeviceSignals(),
  ));
  const [runtimeBinding, setRuntimeBinding] = useState<StudioVrmXpbdSkirtRuntimeBinding | null>(null);
  const activeRuntimeBinding = runtimeBinding
    && runtimeBinding.vrm === vrm
    && runtimeBinding.kind === kind
    && runtimeBinding.metrics === metrics
    && runtimeBinding.effectiveFit === effectiveFit
    && runtimeBinding.topologyGeneration === topologyGeneration
    && runtimeBinding.devicePlan === devicePlan
    ? runtimeBinding
    : null;
  const runtimeResult = activeRuntimeBinding?.result ?? null;
  const runtime = runtimeResult?.ok ? runtimeResult.runtime : null;
  const [failedRuntime, setFailedRuntime] = useState<StudioVrmXpbdSkirtAttachmentRuntime | null>(null);
  const runtimePending = activeRuntimeBinding === null;
  const runtimeUnavailable = runtimeResult !== null && (!runtime || failedRuntime === runtime);

  useLayoutEffect(() => {
    let created: StudioVrmXpbdSkirtAttachmentRuntimeResult;
    try {
      created = createStudioVrmXpbdSkirtAttachmentRuntime({
        vrm,
        kind,
        metrics,
        effectiveFit,
        topologyGeneration,
        devicePlan,
        // Material-only authored changes are applied in the layout effect below and must not rebuild
        // topology/rest ownership.
        color: "#ffffff",
        fabricId: "cotton",
      });
    } catch {
      created = unavailable(
        "topology-unavailable",
        "The selected XPBD skirt runtime could not be constructed.",
      );
    }
    // GPU resources are created only after commit. An abandoned concurrent render therefore owns
    // nothing, while StrictMode cleanup/setup retains and releases each committed runtime exactly
    // once. Publishing the binding happens only after the runtime lease is held.
    if (created.ok && !created.runtime.retain()) {
      created = unavailable("disposed", "The selected XPBD skirt surface is unavailable.");
    }
    let ownerLeaseReleased = false;
    const releaseOwnerLease = () => {
      if (!created.ok || ownerLeaseReleased) return;
      ownerLeaseReleased = true;
      created.runtime.release();
    };
    const binding: StudioVrmXpbdSkirtRuntimeBinding = Object.freeze({
      vrm,
      kind,
      metrics,
      effectiveFit,
      topologyGeneration,
      devicePlan,
      result: created,
      releaseOwnerLease,
    });
    setRuntimeBinding(binding);
    return releaseOwnerLease;
  }, [devicePlan, effectiveFit, kind, metrics, topologyGeneration, vrm]);
  const poseFenceRef = useRef<{
    runtime: StudioVrmXpbdSkirtAttachmentRuntime | null;
    nextPoseGeneration: number;
  }>({ runtime: null, nextPoseGeneration: 0 });
  const cadenceRef = useRef<{
    runtime: StudioVrmXpbdSkirtAttachmentRuntime | null;
    controller: StudioVrmXpbdSkirtSolveCadence | null;
  }>({
    runtime: null,
    controller: null,
  });
  const reportedRuntimeRef = useRef<StudioVrmXpbdSkirtAttachmentRuntime | null>(null);
  const reportedUnavailableBindingRef = useRef<StudioVrmXpbdSkirtRuntimeBinding | null>(null);
  const onSurfaceReceiptRef = useRef(onSurfaceReceipt);
  const onAttachmentStatusRef = useRef(onAttachmentStatus);
  const onCaptureSyncChangeRef = useRef(onCaptureSyncChange);
  const captureSyncHandlerRef = useRef<StudioVrmXpbdSkirtCaptureSync>(() => (
    unavailable("disposed", "The XPBD skirt capture runtime is not mounted.")
  ));

  useLayoutEffect(() => {
    onSurfaceReceiptRef.current = onSurfaceReceipt;
    onAttachmentStatusRef.current = onAttachmentStatus;
    onCaptureSyncChangeRef.current = onCaptureSyncChange;
  }, [onAttachmentStatus, onCaptureSyncChange, onSurfaceReceipt]);

  useLayoutEffect(() => {
    if (!activeRuntimeBinding || !runtimeUnavailable) return;
    if (reportedUnavailableBindingRef.current === activeRuntimeBinding) return;
    reportedUnavailableBindingRef.current = activeRuntimeBinding;
    reportedRuntimeRef.current = null;
    onSurfaceReceiptRef.current(slot, null);
    onAttachmentStatusRef.current?.(slot, equip.itemId, "unavailable");
  }, [activeRuntimeBinding, equip.itemId, runtimeUnavailable, slot]);

  captureSyncHandlerRef.current = () => {
    if (!runtime || runtimeUnavailable || runtime.surface.disposed) {
      return unavailable("disposed", "The XPBD skirt capture runtime is not ready.");
    }
    if (poseFenceRef.current.runtime !== runtime) {
      poseFenceRef.current = { runtime, nextPoseGeneration: 0 };
    }
    if (cadenceRef.current.runtime !== runtime) {
      cadenceRef.current = {
        runtime,
        controller: createStudioVrmXpbdSkirtSolveCadence(runtime.devicePlan.maxSolveHz),
      };
    }
    const poseSignature = readSelectedRuntimePoseSignature(runtime);
    if (!poseSignature) {
      setFailedRuntime(runtime);
      return unavailable("invalid-rig-frame", "The capture skirt rig frame is unavailable.");
    }
    const poseGeneration = poseFenceRef.current.nextPoseGeneration;
    poseFenceRef.current.nextPoseGeneration += 1;
    const stepped = stepSelectedRuntime(runtime, topologyGeneration, poseGeneration);
    if (!stepped.ok) {
      setFailedRuntime(runtime);
      return stepped;
    }
    cadenceRef.current.controller?.markSolved(poseSignature);
    if (reportedRuntimeRef.current !== runtime) {
      reportedRuntimeRef.current = runtime;
      onSurfaceReceiptRef.current(slot, runtime.surface.receipt);
      onAttachmentStatusRef.current?.(slot, equip.itemId, "ready");
    }
    return stepped;
  };

  useLayoutEffect(() => {
    if (!runtime || runtimeUnavailable) return;
    runtime.surface.updateMaterial(equip.color, equip.fabricId);
  }, [equip.color, equip.fabricId, runtime, runtimeUnavailable]);

  useLayoutEffect(() => {
    if (
      !failedRuntime
      || !activeRuntimeBinding?.result.ok
      || activeRuntimeBinding.result.runtime !== failedRuntime
    ) return;
    // The failed portal has left the committed tree before layout effects run. Releasing the one
    // owner lease here avoids retaining an unusable GPU surface until a later prop change/unmount.
    activeRuntimeBinding.releaseOwnerLease();
  }, [activeRuntimeBinding, failedRuntime]);

  useLayoutEffect(() => {
    if (!runtime || runtimeUnavailable) return;
    const sync: StudioVrmXpbdSkirtCaptureSync = () => captureSyncHandlerRef.current();
    onCaptureSyncChangeRef.current?.(slot, sync, true);
    return () => onCaptureSyncChangeRef.current?.(slot, sync, false);
  }, [runtime, runtimeUnavailable, slot]);

  useEffect(() => {
    if (!runtime || runtimeUnavailable) return;
    return () => {
      if (reportedRuntimeRef.current !== runtime) return;
      reportedRuntimeRef.current = null;
      onSurfaceReceiptRef.current(slot, null);
      onAttachmentStatusRef.current?.(slot, equip.itemId, "detached");
    };
  }, [equip.itemId, runtime, runtimeUnavailable, slot]);

  useFrame((_, delta) => {
    if (!runtime || runtimeUnavailable || runtime.surface.disposed) return;
    if (poseFenceRef.current.runtime !== runtime) {
      poseFenceRef.current = { runtime, nextPoseGeneration: 0 };
    }
    if (cadenceRef.current.runtime !== runtime) {
      cadenceRef.current = {
        runtime,
        controller: createStudioVrmXpbdSkirtSolveCadence(runtime.devicePlan.maxSolveHz),
      };
    }
    const poseSignature = readSelectedRuntimePoseSignature(runtime);
    if (!poseSignature) {
      setFailedRuntime(runtime);
      return;
    }
    // Capture's rising edge bypasses cadence and synchronously updates this same GPU buffer before
    // the automatic render. Otherwise an unchanged pose never repeats the SHA-heavy solve.
    if (!cadenceRef.current.controller?.shouldSolve(delta, poseSignature, false)) return;
    const poseGeneration = poseFenceRef.current.nextPoseGeneration;
    poseFenceRef.current.nextPoseGeneration += 1;
    const stepped = stepSelectedRuntime(runtime, topologyGeneration, poseGeneration);
    if (!stepped.ok) {
      setFailedRuntime(runtime);
      return;
    }
    cadenceRef.current.controller.markSolved(poseSignature);
    if (reportedRuntimeRef.current === runtime) return;
    reportedRuntimeRef.current = runtime;
    onSurfaceReceiptRef.current(slot, runtime.surface.receipt);
    onAttachmentStatusRef.current?.(slot, equip.itemId, "ready");
  }, VRM_FRAME_XPBD_SKIRT_PRIORITY);

  // The selected XPBD operation owns this attachment epoch. Pending and terminal-unavailable
  // states render no replacement garment; a procedural garment is a separate catalog mode and is
  // never mounted in response to an XPBD runtime or solver failure.
  if (runtimePending) return null;
  if (runtimeUnavailable || !runtime) return null;
  return createPortal(<primitive object={runtime.surface.mesh} />, vrm.scene);
}
