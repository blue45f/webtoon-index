import {
  compileStudioClothXpbdModelV2,
  createStudioClothXpbdRuntimeV2,
  stepStudioClothXpbdV2,
  type StudioClothXpbdCapsuleFrameV2,
  type StudioClothXpbdCompiledModelV2,
  type StudioClothXpbdFailureCodeV2,
  type StudioClothXpbdKinematicPinV2,
} from "../studio-cloth-xpbd-kernel-v2";
import { sha256HexPortable } from "../studio-sha256";

import type { StudioVrmProportionMetrics } from "./studio-vrm-proportion-core";

/**
 * Deterministic procedural skirt authority for the VRM wardrobe.
 *
 * Version one deliberately keeps self collision disabled. Body collision, closed-ring topology,
 * waist following, and deterministic receipts are authoritative now; a future self-collision
 * revision can change that contract without silently changing existing saved shots.
 */

export const STUDIO_VRM_XPBD_SKIRT_VERSION = 1 as const;
export const STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED = false as const;

export const STUDIO_VRM_XPBD_SKIRT_BUDGETS = Object.freeze({
  maxParticles: 512,
  maxTriangles: 1_024,
  maxCapsules: 5,
  maxSolverIterations: 8,
  maxRestToPoseSteps: 24,
  maxCoordinateMagnitude: 10,
  minSegments: 16,
  maxSegments: 96,
  minRings: 3,
  maxRings: 24,
});

const MIN_VECTOR_LENGTH = 1e-6;
const MIN_CAPSULE_RADIUS = 0.004;
const MAX_CAPSULE_RADIUS = 0.5;

export type StudioVrmXpbdSkirtKind = "pleated" | "longskirt";
export type StudioVrmXpbdSkirtVec3 = readonly [number, number, number];

/** A right-handed, model-local waist frame. All axes may be non-unit; they are normalized. */
export interface StudioVrmXpbdSkirtWaistFrame {
  readonly center: StudioVrmXpbdSkirtVec3;
  readonly right: StudioVrmXpbdSkirtVec3;
  readonly up: StudioVrmXpbdSkirtVec3;
  readonly forward: StudioVrmXpbdSkirtVec3;
}

/**
 * Rest/current capsule endpoints in the same model-local space as the waist frame. Radius remains
 * constant during the bounded rest-to-pose solve, which matches the underlying XPBD v2 contract.
 */
export interface StudioVrmXpbdSkirtCapsuleProxy {
  readonly restHead: StudioVrmXpbdSkirtVec3;
  readonly restTail: StudioVrmXpbdSkirtVec3;
  readonly currentHead: StudioVrmXpbdSkirtVec3;
  readonly currentTail: StudioVrmXpbdSkirtVec3;
  readonly radius: number;
  readonly friction?: number;
}

export interface StudioVrmXpbdSkirtBodyProxies {
  readonly hips: StudioVrmXpbdSkirtCapsuleProxy;
  readonly leftThigh: StudioVrmXpbdSkirtCapsuleProxy;
  readonly rightThigh: StudioVrmXpbdSkirtCapsuleProxy;
  /** Required only by `longskirt`; short pleated skirts intentionally do not spend this budget. */
  readonly leftCalf?: StudioVrmXpbdSkirtCapsuleProxy;
  /** Required only by `longskirt`; short pleated skirts intentionally do not spend this budget. */
  readonly rightCalf?: StudioVrmXpbdSkirtCapsuleProxy;
}

export type StudioVrmXpbdSkirtMetrics = Pick<
  StudioVrmProportionMetrics,
  "totalHeight" | "headUnits" | "hipsHeight" | "legLength" | "shoulderSpan"
>;

export interface StudioVrmXpbdSkirtTopologyInput {
  readonly kind: StudioVrmXpbdSkirtKind;
  readonly metrics: StudioVrmXpbdSkirtMetrics;
  readonly restWaist: StudioVrmXpbdSkirtWaistFrame;
  readonly fit?: number;
  readonly segmentCount?: number;
  readonly ringCount?: number;
  readonly solverIterations?: number;
  readonly topologyEpoch?: number;
}

export interface StudioVrmXpbdSkirtDimensions {
  readonly waistRadiusX: number;
  readonly waistRadiusZ: number;
  readonly skirtLength: number;
  readonly hemFlare: number;
  readonly pleatCount: number;
  readonly pleatAmplitudeRatio: number;
  readonly particleRadius: number;
}

export interface StudioVrmXpbdSkirtTopology {
  readonly version: typeof STUDIO_VRM_XPBD_SKIRT_VERSION;
  readonly kind: StudioVrmXpbdSkirtKind;
  readonly segmentCount: number;
  readonly ringCount: number;
  readonly particleCount: number;
  readonly triangleCount: number;
  readonly solverIterations: number;
  readonly selfCollisionEnabled: typeof STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED;
  readonly dimensions: StudioVrmXpbdSkirtDimensions;
  readonly restWaist: StudioVrmXpbdSkirtWaistFrame;
  readonly restPositions: Float32Array;
  readonly uvs: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly waistParticleIndices: Uint32Array;
  readonly compiledModel: StudioClothXpbdCompiledModelV2;
  readonly topologySha256: string;
}

export interface StudioVrmXpbdSkirtSolveInput {
  /** Required generation fence for stale asynchronous pose jobs. */
  readonly expectedPoseGeneration: number;
  readonly poseGeneration: number;
  /** Required topology fence. Callers must echo `topology.topologySha256`. */
  readonly expectedTopologySha256: string;
  readonly currentWaist: StudioVrmXpbdSkirtWaistFrame;
  readonly body: StudioVrmXpbdSkirtBodyProxies;
  readonly restToPoseSteps?: number;
  readonly solverIterations?: number;
}

export interface StudioVrmXpbdSkirtSolveDiagnostics {
  readonly maxCapsulePenetration: number;
  readonly finalCapsulePenetrationById: Readonly<Record<string, number>>;
  readonly totalCapsuleContactCount: number;
  readonly nonFiniteCount: 0;
}

export interface StudioVrmXpbdSkirtSolveReceipt {
  readonly kind: "studio-vrm-xpbd-skirt-solve-receipt";
  readonly version: typeof STUDIO_VRM_XPBD_SKIRT_VERSION;
  readonly complete: true;
  readonly garmentKind: StudioVrmXpbdSkirtKind;
  readonly poseGeneration: number;
  readonly restToPoseSteps: number;
  readonly solverIterations: number;
  readonly particleCount: number;
  readonly triangleCount: number;
  readonly capsuleCount: number;
  readonly capsuleIds: readonly string[];
  readonly selfCollisionEnabled: typeof STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED;
  readonly topologySha256: string;
  readonly kernelTopologySha256: string;
  readonly kernelReceiptChainSha256: string;
  readonly outputPositionsSha256: string;
  readonly outputSha256: string;
  readonly diagnostics: StudioVrmXpbdSkirtSolveDiagnostics;
  readonly receiptSha256: string;
}

export interface StudioVrmXpbdSkirtSolvedMesh {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly receipt: StudioVrmXpbdSkirtSolveReceipt;
}

export type StudioVrmXpbdSkirtUnavailableCode =
  | "missing-input"
  | "invalid-input"
  | "budget-exceeded"
  | "stale-input"
  | "topology-mismatch"
  | "solver-unavailable"
  | "numerical-failure";

export interface StudioVrmXpbdSkirtUnavailable {
  readonly ok: false;
  readonly status: "unavailable";
  readonly code: StudioVrmXpbdSkirtUnavailableCode;
  readonly detail: string;
}

export type StudioVrmXpbdSkirtTopologyResult =
  | { readonly ok: true; readonly status: "ready"; readonly topology: StudioVrmXpbdSkirtTopology }
  | StudioVrmXpbdSkirtUnavailable;

export type StudioVrmXpbdSkirtSolveResult =
  | { readonly ok: true; readonly status: "ready"; readonly mesh: StudioVrmXpbdSkirtSolvedMesh }
  | StudioVrmXpbdSkirtUnavailable;

function unavailable(
  code: StudioVrmXpbdSkirtUnavailableCode,
  detail: string,
): StudioVrmXpbdSkirtUnavailable {
  return Object.freeze({ ok: false, status: "unavailable", code, detail });
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function f32(value: number): number {
  return Math.fround(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isFiniteBounded(value: number, maximum = STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxCoordinateMagnitude): boolean {
  return Number.isFinite(value) && Math.abs(value) <= maximum;
}

function normalizeVector(
  vector: StudioVrmXpbdSkirtVec3,
): StudioVrmXpbdSkirtVec3 | undefined {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) return undefined;
  return [f32(vector[0] / length), f32(vector[1] / length), f32(vector[2] / length)];
}

function dot(a: StudioVrmXpbdSkirtVec3, b: StudioVrmXpbdSkirtVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: StudioVrmXpbdSkirtVec3, b: StudioVrmXpbdSkirtVec3): StudioVrmXpbdSkirtVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vec3Error(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value) || value.length !== 3) return `${label} must be an XYZ tuple.`;
  for (let axis = 0; axis < 3; axis += 1) {
    if (!isFiniteBounded(value[axis] as number)) {
      return `${label}[${axis}] must be finite and within the coordinate budget.`;
    }
  }
  return undefined;
}

function freezeVec3(value: StudioVrmXpbdSkirtVec3): StudioVrmXpbdSkirtVec3 {
  return Object.freeze([f32(value[0]), f32(value[1]), f32(value[2])]) as StudioVrmXpbdSkirtVec3;
}

function normalizeWaistFrame(
  value: unknown,
  label: string,
): { readonly ok: true; readonly frame: StudioVrmXpbdSkirtWaistFrame } | StudioVrmXpbdSkirtUnavailable {
  if (!isRecord(value)) return unavailable("missing-input", `${label} is required.`);
  for (const key of ["center", "right", "up", "forward"] as const) {
    const error = vec3Error(value[key], `${label}.${key}`);
    if (error) return unavailable("invalid-input", error);
  }
  const center = value.center as StudioVrmXpbdSkirtVec3;
  const suppliedRight = normalizeVector(value.right as StudioVrmXpbdSkirtVec3);
  const suppliedUp = normalizeVector(value.up as StudioVrmXpbdSkirtVec3);
  const suppliedForward = normalizeVector(value.forward as StudioVrmXpbdSkirtVec3);
  if (!suppliedRight || !suppliedUp || !suppliedForward) {
    return unavailable("invalid-input", `${label} axes must have a non-zero finite length.`);
  }
  const upWithoutRight: StudioVrmXpbdSkirtVec3 = [
    suppliedUp[0] - suppliedRight[0] * dot(suppliedRight, suppliedUp),
    suppliedUp[1] - suppliedRight[1] * dot(suppliedRight, suppliedUp),
    suppliedUp[2] - suppliedRight[2] * dot(suppliedRight, suppliedUp),
  ];
  const up = normalizeVector(upWithoutRight);
  const forward = up ? normalizeVector(cross(suppliedRight, up)) : undefined;
  if (!up || !forward || dot(forward, suppliedForward) < 0.5) {
    return unavailable(
      "invalid-input",
      `${label} must contain a non-degenerate right-handed orthogonal basis.`,
    );
  }
  return {
    ok: true,
    frame: Object.freeze({
      center: freezeVec3(center),
      right: freezeVec3(suppliedRight),
      up: freezeVec3(up),
      forward: freezeVec3(forward),
    }),
  };
}

function hashText(value: string): string {
  return sha256HexPortable(new TextEncoder().encode(value));
}

function typedArrayBytes(values: Float32Array | Uint32Array): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, values.length, true);
  if (values instanceof Float32Array) {
    for (let index = 0; index < values.length; index += 1) {
      view.setFloat32(4 + index * 4, values[index]!, true);
    }
  } else {
    for (let index = 0; index < values.length; index += 1) {
      view.setUint32(4 + index * 4, values[index]!, true);
    }
  }
  return bytes;
}

function hashTypedArray(values: Float32Array | Uint32Array): string {
  return sha256HexPortable(typedArrayBytes(values));
}

function metricsError(value: unknown): string | undefined {
  if (!isRecord(value)) return "metrics are required.";
  for (const [key, minimum, maximum] of [
    ["totalHeight", 0.35, 3.5],
    ["headUnits", 1.5, 14],
    ["hipsHeight", 0.1, 2.8],
    ["legLength", 0.1, 2.2],
    ["shoulderSpan", 0.03, 1.2],
  ] as const) {
    const field = value[key];
    if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum) {
      return `metrics.${key} must be finite and in [${minimum}, ${maximum}].`;
    }
  }
  return undefined;
}

function deriveDimensions(
  kind: StudioVrmXpbdSkirtKind,
  metrics: StudioVrmXpbdSkirtMetrics,
  fit: number,
  segmentCount: number,
): StudioVrmXpbdSkirtDimensions {
  const waistRadiusX = clamp(
    Math.max(metrics.totalHeight * 0.075, metrics.shoulderSpan * 0.72) * fit,
    0.075,
    0.36,
  );
  const waistRadiusZ = waistRadiusX * 0.78;
  const rawLength = metrics.legLength * (kind === "pleated" ? 0.58 : 0.92);
  const skirtLength = clamp(
    rawLength,
    metrics.totalHeight * (kind === "pleated" ? 0.16 : 0.28),
    Math.min(metrics.hipsHeight * 0.94, metrics.totalHeight * 0.62),
  );
  const hemFlare = kind === "pleated" ? 1.72 : 1.52;
  const pleatCount = Math.max(4, Math.min(12, Math.floor(segmentCount / 4)));
  const pleatAmplitudeRatio = kind === "pleated" ? 0.09 : 0.055;
  const circumferenceStep = (Math.PI * 2 * waistRadiusX) / segmentCount;
  const particleRadius = clamp(circumferenceStep * 0.18, 0.0025, 0.012);
  return Object.freeze({
    waistRadiusX: f32(waistRadiusX),
    waistRadiusZ: f32(waistRadiusZ),
    skirtLength: f32(skirtLength),
    hemFlare: f32(hemFlare),
    pleatCount,
    pleatAmplitudeRatio: f32(pleatAmplitudeRatio),
    particleRadius: f32(particleRadius),
  });
}

function ringPoint(
  frame: StudioVrmXpbdSkirtWaistFrame,
  dimensions: StudioVrmXpbdSkirtDimensions,
  segment: number,
  segmentCount: number,
  ring: number,
  ringCount: number,
): StudioVrmXpbdSkirtVec3 {
  const angle = (segment / segmentCount) * Math.PI * 2;
  const t = ring / (ringCount - 1);
  const easedT = t * t * (3 - 2 * t);
  const flare = 1 + (dimensions.hemFlare - 1) * easedT;
  // The waistband remains nearly smooth; pleat relief grows continuously towards the hem.
  const pleatEnvelope = 0.08 + 0.92 * easedT;
  const pleatScale = 1 +
    dimensions.pleatAmplitudeRatio * pleatEnvelope * Math.cos(dimensions.pleatCount * angle);
  const x = Math.cos(angle) * dimensions.waistRadiusX * flare * pleatScale;
  const z = Math.sin(angle) * dimensions.waistRadiusZ * flare * pleatScale;
  const y = -dimensions.skirtLength * t;
  return [
    f32(frame.center[0] + frame.right[0] * x + frame.forward[0] * z + frame.up[0] * y),
    f32(frame.center[1] + frame.right[1] * x + frame.forward[1] * z + frame.up[1] * y),
    f32(frame.center[2] + frame.right[2] * x + frame.forward[2] * z + frame.up[2] * y),
  ];
}

function topologyHash(
  topology: Omit<StudioVrmXpbdSkirtTopology, "topologySha256">,
): string {
  const d = topology.dimensions;
  const w = topology.restWaist;
  return hashText([
    `version=${topology.version}`,
    `kind=${topology.kind}`,
    `segments=${topology.segmentCount}`,
    `rings=${topology.ringCount}`,
    `particles=${topology.particleCount}`,
    `triangles=${topology.triangleCount}`,
    `iterations=${topology.solverIterations}`,
    `selfCollision=${topology.selfCollisionEnabled ? 1 : 0}`,
    `dimensions=${d.waistRadiusX},${d.waistRadiusZ},${d.skirtLength},${d.hemFlare},${d.pleatCount},${d.pleatAmplitudeRatio},${d.particleRadius}`,
    `waist=${[...w.center, ...w.right, ...w.up, ...w.forward].join(",")}`,
    `rest=${hashTypedArray(topology.restPositions)}`,
    `uv=${hashTypedArray(topology.uvs)}`,
    `tri=${hashTypedArray(topology.triangleIndices)}`,
    `pins=${hashTypedArray(topology.waistParticleIndices)}`,
    `kernel=${topology.compiledModel.topologySha256}`,
  ].join("|"));
}

function mapKernelFailure(
  code: StudioClothXpbdFailureCodeV2,
): StudioVrmXpbdSkirtUnavailableCode {
  switch (code) {
    case "budget-exceeded":
      return "budget-exceeded";
    case "stale-step":
      return "stale-input";
    case "topology-mismatch":
      return "topology-mismatch";
    case "numerical-failure":
      return "numerical-failure";
    case "invalid-input":
      return "solver-unavailable";
  }
}

function createTopologyUnchecked(
  input: StudioVrmXpbdSkirtTopologyInput,
): StudioVrmXpbdSkirtTopologyResult {
  if (input.kind !== "pleated" && input.kind !== "longskirt") {
    return unavailable("invalid-input", "kind must be pleated or longskirt.");
  }
  const metricIssue = metricsError(input.metrics);
  if (metricIssue) {
    return unavailable(isRecord(input.metrics) ? "invalid-input" : "missing-input", metricIssue);
  }
  const normalizedRestWaist = normalizeWaistFrame(input.restWaist, "restWaist");
  if (!normalizedRestWaist.ok) return normalizedRestWaist;
  const fit = input.fit ?? 1;
  if (!Number.isFinite(fit) || fit < 0.75 || fit > 1.35) {
    return unavailable("invalid-input", "fit must be finite and in [0.75, 1.35].");
  }
  const segmentCount = input.segmentCount ?? 48;
  const ringCount = input.ringCount ?? (input.kind === "pleated" ? 7 : 10);
  const solverIterations = input.solverIterations ?? 8;
  const topologyEpoch = input.topologyEpoch ?? 1;
  if (!Number.isInteger(segmentCount) || segmentCount < STUDIO_VRM_XPBD_SKIRT_BUDGETS.minSegments) {
    return unavailable(
      "invalid-input",
      `segmentCount must be an integer >= ${STUDIO_VRM_XPBD_SKIRT_BUDGETS.minSegments}.`,
    );
  }
  if (segmentCount > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSegments) {
    return unavailable("budget-exceeded", "segmentCount exceeds the skirt topology budget.");
  }
  if (!Number.isInteger(ringCount) || ringCount < STUDIO_VRM_XPBD_SKIRT_BUDGETS.minRings) {
    return unavailable(
      "invalid-input",
      `ringCount must be an integer >= ${STUDIO_VRM_XPBD_SKIRT_BUDGETS.minRings}.`,
    );
  }
  if (ringCount > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxRings) {
    return unavailable("budget-exceeded", "ringCount exceeds the skirt topology budget.");
  }
  if (
    !Number.isInteger(solverIterations) ||
    solverIterations < 1 ||
    solverIterations > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSolverIterations
  ) {
    return unavailable(
      solverIterations > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSolverIterations
        ? "budget-exceeded"
        : "invalid-input",
      `solverIterations must be an integer in [1, ${STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSolverIterations}].`,
    );
  }
  if (!Number.isSafeInteger(topologyEpoch) || topologyEpoch < 1) {
    return unavailable("invalid-input", "topologyEpoch must be a positive safe integer.");
  }

  const particleCount = segmentCount * ringCount;
  const triangleCount = segmentCount * (ringCount - 1) * 2;
  if (particleCount > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxParticles) {
    return unavailable(
      "budget-exceeded",
      `Particle count ${particleCount} exceeds ${STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxParticles}.`,
    );
  }
  if (triangleCount > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxTriangles) {
    return unavailable(
      "budget-exceeded",
      `Triangle count ${triangleCount} exceeds ${STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxTriangles}.`,
    );
  }

  const dimensions = deriveDimensions(input.kind, input.metrics, fit, segmentCount);
  const restPositions = new Float32Array(particleCount * 3);
  const uvs = new Float32Array(particleCount * 2);
  const particleRadii = new Float32Array(particleCount).fill(dimensions.particleRadius);
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const particle = ring * segmentCount + segment;
      const point = ringPoint(
        normalizedRestWaist.frame,
        dimensions,
        segment,
        segmentCount,
        ring,
        ringCount,
      );
      restPositions.set(point, particle * 3);
      uvs[particle * 2] = f32(segment / segmentCount);
      uvs[particle * 2 + 1] = f32(ring / (ringCount - 1));
    }
  }

  const triangleIndices = new Uint32Array(triangleCount * 3);
  let triangleOffset = 0;
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount;
      const upper = ring * segmentCount + segment;
      const upperNext = ring * segmentCount + next;
      const lower = (ring + 1) * segmentCount + segment;
      const lowerNext = (ring + 1) * segmentCount + next;
      triangleIndices.set([upper, lower, upperNext, upperNext, lower, lowerNext], triangleOffset);
      triangleOffset += 6;
    }
  }
  const waistParticleIndices = Uint32Array.from(
    { length: segmentCount },
    (_, segment) => segment,
  );
  const compiled = compileStudioClothXpbdModelV2({
    restPositions,
    triangleIndices,
    particleRadii,
    gravity: [0, -9.81, 0],
    dampingPerSecond: 1.4,
    structuralCompliance: 0.000_002,
    bendCompliance: 0.000_06,
    selfCollisionEnabled: STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
    solverIterations,
    topologyEpoch,
  });
  if (!compiled.ok) {
    return unavailable(mapKernelFailure(compiled.code), `XPBD compile failed: ${compiled.detail}`);
  }
  const topologyWithoutHash: Omit<StudioVrmXpbdSkirtTopology, "topologySha256"> = {
    version: STUDIO_VRM_XPBD_SKIRT_VERSION,
    kind: input.kind,
    segmentCount,
    ringCount,
    particleCount,
    triangleCount,
    solverIterations,
    selfCollisionEnabled: STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
    dimensions,
    restWaist: normalizedRestWaist.frame,
    restPositions: compiled.model.restPositions,
    uvs,
    triangleIndices: compiled.model.triangleIndices,
    waistParticleIndices,
    compiledModel: compiled.model,
  };
  const topology = Object.freeze({
    ...topologyWithoutHash,
    topologySha256: topologyHash(topologyWithoutHash),
  });
  return Object.freeze({ ok: true, status: "ready", topology });
}

/** Builds a deterministic, seam-connected indexed skirt topology and its XPBD model. */
export function createStudioVrmXpbdSkirtTopology(
  input: StudioVrmXpbdSkirtTopologyInput,
): StudioVrmXpbdSkirtTopologyResult {
  try {
    if (!isRecord(input)) return unavailable("missing-input", "Topology input is required.");
    return createTopologyUnchecked(input);
  } catch {
    return unavailable("invalid-input", "Topology input could not be validated safely.");
  }
}

function lerp(a: number, b: number, alpha: number): number {
  return f32(a + (b - a) * alpha);
}

function lerpVec3(
  a: StudioVrmXpbdSkirtVec3,
  b: StudioVrmXpbdSkirtVec3,
  alpha: number,
): StudioVrmXpbdSkirtVec3 {
  return [lerp(a[0], b[0], alpha), lerp(a[1], b[1], alpha), lerp(a[2], b[2], alpha)];
}

function capsuleError(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} is required.`;
  for (const key of ["restHead", "restTail", "currentHead", "currentTail"] as const) {
    const error = vec3Error(value[key], `${label}.${key}`);
    if (error) return error;
  }
  if (
    typeof value.radius !== "number" ||
    !Number.isFinite(value.radius) ||
    value.radius < MIN_CAPSULE_RADIUS ||
    value.radius > MAX_CAPSULE_RADIUS
  ) {
    return `${label}.radius must be finite and in [${MIN_CAPSULE_RADIUS}, ${MAX_CAPSULE_RADIUS}].`;
  }
  if (
    value.friction !== undefined &&
    (typeof value.friction !== "number" || !Number.isFinite(value.friction) || value.friction < 0 || value.friction > 1)
  ) {
    return `${label}.friction must be finite and in [0, 1].`;
  }
  return undefined;
}

interface NamedCapsuleProxy {
  readonly id: string;
  readonly proxy: StudioVrmXpbdSkirtCapsuleProxy;
}

function normalizeBodyProxies(
  kind: StudioVrmXpbdSkirtKind,
  value: unknown,
): { readonly ok: true; readonly capsules: readonly NamedCapsuleProxy[] } | StudioVrmXpbdSkirtUnavailable {
  if (!isRecord(value)) return unavailable("missing-input", "body proxies are required.");
  const keys = kind === "longskirt"
    ? ["hips", "leftThigh", "rightThigh", "leftCalf", "rightCalf"] as const
    : ["hips", "leftThigh", "rightThigh"] as const;
  if (keys.length > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxCapsules) {
    return unavailable("budget-exceeded", "Body capsule count exceeds the skirt budget.");
  }
  const capsules: NamedCapsuleProxy[] = [];
  for (const key of keys) {
    const issue = capsuleError(value[key], `body.${key}`);
    if (issue) {
      return unavailable(isRecord(value[key]) ? "invalid-input" : "missing-input", issue);
    }
    capsules.push(Object.freeze({
      id: key,
      proxy: value[key] as unknown as StudioVrmXpbdSkirtCapsuleProxy,
    }));
  }
  return { ok: true, capsules: Object.freeze(capsules) };
}

function waistPoints(
  topology: StudioVrmXpbdSkirtTopology,
  currentWaist: StudioVrmXpbdSkirtWaistFrame,
): readonly { readonly rest: StudioVrmXpbdSkirtVec3; readonly current: StudioVrmXpbdSkirtVec3 }[] {
  return Object.freeze(Array.from({ length: topology.segmentCount }, (_, segment) => {
    const offset = segment * 3;
    const rest = freezeVec3([
      topology.restPositions[offset]!,
      topology.restPositions[offset + 1]!,
      topology.restPositions[offset + 2]!,
    ]);
    const current = freezeVec3(ringPoint(
      currentWaist,
      topology.dimensions,
      segment,
      topology.segmentCount,
      0,
      topology.ringCount,
    ));
    return Object.freeze({ rest, current });
  }));
}

function capsuleFrameAt(
  named: NamedCapsuleProxy,
  previousAlpha: number,
  currentAlpha: number,
): StudioClothXpbdCapsuleFrameV2 {
  const proxy = named.proxy;
  return {
    id: named.id,
    previousHead: lerpVec3(proxy.restHead, proxy.currentHead, previousAlpha),
    previousTail: lerpVec3(proxy.restTail, proxy.currentTail, previousAlpha),
    currentHead: lerpVec3(proxy.restHead, proxy.currentHead, currentAlpha),
    currentTail: lerpVec3(proxy.restTail, proxy.currentTail, currentAlpha),
    radius: f32(proxy.radius),
    friction: f32(proxy.friction ?? 0.35),
  };
}

function pinFrameAt(
  waist: readonly { readonly rest: StudioVrmXpbdSkirtVec3; readonly current: StudioVrmXpbdSkirtVec3 }[],
  previousAlpha: number,
  currentAlpha: number,
): readonly StudioClothXpbdKinematicPinV2[] {
  return waist.map((point, particle) => ({
    particle,
    previous: lerpVec3(point.rest, point.current, previousAlpha),
    current: lerpVec3(point.rest, point.current, currentAlpha),
  }));
}

function pointSegmentDistance(
  point: StudioVrmXpbdSkirtVec3,
  head: StudioVrmXpbdSkirtVec3,
  tail: StudioVrmXpbdSkirtVec3,
): number {
  const sx = tail[0] - head[0];
  const sy = tail[1] - head[1];
  const sz = tail[2] - head[2];
  const lengthSquared = sx * sx + sy * sy + sz * sz;
  const projection = lengthSquared > MIN_VECTOR_LENGTH
    ? clamp(
      ((point[0] - head[0]) * sx + (point[1] - head[1]) * sy + (point[2] - head[2]) * sz) /
        lengthSquared,
      0,
      1,
    )
    : 0;
  return Math.hypot(
    point[0] - (head[0] + sx * projection),
    point[1] - (head[1] + sy * projection),
    point[2] - (head[2] + sz * projection),
  );
}

function finalPenetrationByCapsule(
  topology: StudioVrmXpbdSkirtTopology,
  positions: Float32Array,
  capsules: readonly NamedCapsuleProxy[],
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const named of capsules) {
    let maximum = 0;
    for (let particle = topology.segmentCount; particle < topology.particleCount; particle += 1) {
      const offset = particle * 3;
      const point: StudioVrmXpbdSkirtVec3 = [
        positions[offset]!,
        positions[offset + 1]!,
        positions[offset + 2]!,
      ];
      const distance = pointSegmentDistance(
        point,
        named.proxy.currentHead,
        named.proxy.currentTail,
      );
      maximum = Math.max(
        maximum,
        named.proxy.radius + topology.compiledModel.particleRadii[particle]! - distance,
      );
    }
    result[named.id] = f32(Math.max(0, maximum));
  }
  return Object.freeze(result);
}

function receiptHash(
  receipt: Omit<StudioVrmXpbdSkirtSolveReceipt, "receiptSha256">,
): string {
  return hashText([
    `kind=${receipt.kind}`,
    `version=${receipt.version}`,
    `complete=${receipt.complete ? 1 : 0}`,
    `garment=${receipt.garmentKind}`,
    `generation=${receipt.poseGeneration}`,
    `steps=${receipt.restToPoseSteps}`,
    `iterations=${receipt.solverIterations}`,
    `counts=${receipt.particleCount},${receipt.triangleCount},${receipt.capsuleCount}`,
    `capsules=${receipt.capsuleIds.join(",")}`,
    `selfCollision=${receipt.selfCollisionEnabled ? 1 : 0}`,
    `topology=${receipt.topologySha256}`,
    `kernelTopology=${receipt.kernelTopologySha256}`,
    `kernelReceipts=${receipt.kernelReceiptChainSha256}`,
    `positions=${receipt.outputPositionsSha256}`,
    `output=${receipt.outputSha256}`,
    `penetration=${receipt.diagnostics.maxCapsulePenetration}`,
    `finalPenetration=${receipt.capsuleIds.map((id) => `${id}:${receipt.diagnostics.finalCapsulePenetrationById[id]}`).join(",")}`,
    `contacts=${receipt.diagnostics.totalCapsuleContactCount}`,
    `nonFinite=${receipt.diagnostics.nonFiniteCount}`,
  ].join("|"));
}

function solveUnchecked(
  topology: StudioVrmXpbdSkirtTopology,
  input: StudioVrmXpbdSkirtSolveInput,
): StudioVrmXpbdSkirtSolveResult {
  if (!isRecord(topology)) return unavailable("missing-input", "Topology is required.");
  if (input.expectedTopologySha256 === undefined) {
    return unavailable("missing-input", "expectedTopologySha256 is required.");
  }
  if (input.expectedPoseGeneration === undefined || input.poseGeneration === undefined) {
    return unavailable("missing-input", "Both pose generation fences are required.");
  }
  if (
    !Number.isSafeInteger(input.expectedPoseGeneration) ||
    !Number.isSafeInteger(input.poseGeneration) ||
    input.expectedPoseGeneration < 0 ||
    input.poseGeneration < 0
  ) {
    return unavailable("invalid-input", "Pose generations must be non-negative safe integers.");
  }
  if (input.expectedPoseGeneration !== input.poseGeneration) {
    return unavailable(
      "stale-input",
      `Expected pose generation ${input.expectedPoseGeneration}, received ${input.poseGeneration}.`,
    );
  }
  if (input.expectedTopologySha256 !== topology.topologySha256) {
    return unavailable("stale-input", "The expected skirt topology hash is stale.");
  }
  if (topologyHash(topology) !== topology.topologySha256) {
    return unavailable("topology-mismatch", "The skirt topology arrays no longer match their hash.");
  }
  const normalizedCurrentWaist = normalizeWaistFrame(input.currentWaist, "currentWaist");
  if (!normalizedCurrentWaist.ok) return normalizedCurrentWaist;
  const normalizedBody = normalizeBodyProxies(topology.kind, input.body);
  if (!normalizedBody.ok) return normalizedBody;

  const restToPoseSteps = input.restToPoseSteps ?? (topology.kind === "pleated" ? 12 : 20);
  const solverIterations = input.solverIterations ?? topology.solverIterations;
  if (!Number.isInteger(restToPoseSteps) || restToPoseSteps < 1) {
    return unavailable("invalid-input", "restToPoseSteps must be a positive integer.");
  }
  if (restToPoseSteps > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxRestToPoseSteps) {
    return unavailable("budget-exceeded", "restToPoseSteps exceeds the skirt solve budget.");
  }
  if (!Number.isInteger(solverIterations) || solverIterations < 1) {
    return unavailable("invalid-input", "solverIterations must be a positive integer.");
  }
  if (solverIterations > STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSolverIterations) {
    return unavailable("budget-exceeded", "solverIterations exceeds the skirt solve budget.");
  }

  const runtimeResult = createStudioClothXpbdRuntimeV2(topology.compiledModel);
  if (!runtimeResult.ok) {
    return unavailable(
      mapKernelFailure(runtimeResult.code),
      `XPBD runtime unavailable: ${runtimeResult.detail}`,
    );
  }
  const runtime = runtimeResult.runtime;
  const waist = waistPoints(topology, normalizedCurrentWaist.frame);
  const kernelReceiptHashes: string[] = [];
  let maxCapsulePenetration = 0;
  let totalCapsuleContactCount = 0;
  for (let step = 0; step < restToPoseSteps; step += 1) {
    const previousAlpha = step / restToPoseSteps;
    const currentAlpha = (step + 1) / restToPoseSteps;
    const capsules = normalizedBody.capsules.map((capsule) =>
      capsuleFrameAt(capsule, previousAlpha, currentAlpha));
    const stepped = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: step,
      expectedTopologySha256: topology.compiledModel.topologySha256,
      kinematicPins: pinFrameAt(waist, previousAlpha, currentAlpha),
      capsules,
      solverIterations,
    });
    if (!stepped.ok) {
      return unavailable(mapKernelFailure(stepped.code), `XPBD solve failed: ${stepped.detail}`);
    }
    kernelReceiptHashes.push(stepped.receipt.receiptSha256);
    maxCapsulePenetration = Math.max(
      maxCapsulePenetration,
      stepped.receipt.diagnostics.maxCapsulePenetration,
    );
    totalCapsuleContactCount += stepped.receipt.capsuleContactCount;
  }

  const positions = new Float32Array(runtime.positions);
  const outputPositionsSha256 = hashTypedArray(positions);
  const outputSha256 = hashText(
    `${topology.topologySha256}|${outputPositionsSha256}|pose=${input.poseGeneration}`,
  );
  const capsuleIds = Object.freeze(normalizedBody.capsules.map(({ id }) => id));
  const diagnostics: StudioVrmXpbdSkirtSolveDiagnostics = Object.freeze({
    maxCapsulePenetration: f32(maxCapsulePenetration),
    finalCapsulePenetrationById: finalPenetrationByCapsule(
      topology,
      positions,
      normalizedBody.capsules,
    ),
    totalCapsuleContactCount,
    nonFiniteCount: 0,
  });
  const receiptWithoutHash: Omit<StudioVrmXpbdSkirtSolveReceipt, "receiptSha256"> = {
    kind: "studio-vrm-xpbd-skirt-solve-receipt",
    version: STUDIO_VRM_XPBD_SKIRT_VERSION,
    complete: true,
    garmentKind: topology.kind,
    poseGeneration: input.poseGeneration,
    restToPoseSteps,
    solverIterations,
    particleCount: topology.particleCount,
    triangleCount: topology.triangleCount,
    capsuleCount: normalizedBody.capsules.length,
    capsuleIds,
    selfCollisionEnabled: STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
    topologySha256: topology.topologySha256,
    kernelTopologySha256: topology.compiledModel.topologySha256,
    kernelReceiptChainSha256: hashText(kernelReceiptHashes.join("|")),
    outputPositionsSha256,
    outputSha256,
    diagnostics,
  };
  const receipt: StudioVrmXpbdSkirtSolveReceipt = Object.freeze({
    ...receiptWithoutHash,
    receiptSha256: receiptHash(receiptWithoutHash),
  });
  const mesh: StudioVrmXpbdSkirtSolvedMesh = Object.freeze({
    positions,
    uvs: new Float32Array(topology.uvs),
    triangleIndices: new Uint32Array(topology.triangleIndices),
    receipt,
  });
  return Object.freeze({ ok: true, status: "ready", mesh });
}

/**
 * Solves a fresh rest mesh to a fenced pose. The supplied topology and caller state are never
 * mutated, so every unavailable result is fail-closed and retryable.
 */
export function solveStudioVrmXpbdSkirtPose(
  topology: StudioVrmXpbdSkirtTopology,
  input: StudioVrmXpbdSkirtSolveInput,
): StudioVrmXpbdSkirtSolveResult {
  try {
    if (!isRecord(input)) return unavailable("missing-input", "Solve input is required.");
    return solveUnchecked(topology, input);
  } catch {
    return unavailable("invalid-input", "Skirt pose input could not be validated safely.");
  }
}
