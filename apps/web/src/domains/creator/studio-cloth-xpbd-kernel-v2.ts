import { sha256HexPortable } from "./studio-sha256";

/**
 * Deterministic, CPU reference cloth kernel.
 *
 * This deliberately does not depend on Three.js, Rapier, the DOM, or a renderer. The same
 * typed-array contract can therefore be moved into a Worker without changing the solver.
 */

export const STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION = 2 as const;
export const STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS = 1 / 120;
export const STUDIO_CLOTH_XPBD_DETERMINISM_SCOPE = "same-engine-f32" as const;
export const STUDIO_CLOTH_XPBD_BEND_MODEL = "opposite-vertex-distance-v1" as const;
export const STUDIO_CLOTH_XPBD_CAPSULE_POSE_MODEL =
  "previous-mid-current-sampled-v1" as const;

export const STUDIO_CLOTH_XPBD_V2_BUDGETS = Object.freeze({
  maxParticles: 8_192,
  maxTriangles: 16_384,
  maxConstraints: 65_536,
  maxSeams: 512,
  maxPins: 512,
  maxCapsules: 32,
  maxSelfCollisionPairs: 131_072,
  maxSolverIterations: 12,
  maxWorkUnitsPerStep: 8_000_000,
  maxCoordinateMagnitude: 10_000,
  maxGravityMagnitude: 1_000,
  maxInverseMass: 1_000_000,
  minParticleRadius: Math.fround(0.000_001),
  maxParticleRadius: 100,
  maxIdentifierLength: 128,
});

const DEFAULT_SOLVER_ITERATIONS = 8;
const DEFAULT_PARTICLE_RADIUS = 0.01;
const DEFAULT_DAMPING_PER_SECOND = 0.5;
const DEFAULT_STRUCTURAL_COMPLIANCE = 0;
const DEFAULT_BEND_COMPLIANCE = 0.000_01;
const DEFAULT_SEAM_COMPLIANCE = 0;
const DEFAULT_SELF_COLLISION_COMPLIANCE = 0;
const MIN_DISTANCE = 1e-8;
const TRIANGLE_AREA_EPSILON = 1e-12;

export type StudioClothXpbdVec3V2 = readonly [number, number, number];

export interface StudioClothXpbdSeamV2 {
  readonly id: string;
  /** Flat particle-index pairs: [a0, b0, a1, b1, ...]. */
  readonly pairs: Uint32Array;
  /** Defaults to zero, which stitches both seam vertices to the same point. */
  readonly restLengths?: Float32Array;
  readonly compliance?: number;
}

export interface StudioClothXpbdCompileInputV2 {
  readonly restPositions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly inverseMasses?: Float32Array;
  readonly particleRadii?: Float32Array;
  readonly fixedParticleIndices?: Uint32Array;
  readonly seams?: readonly StudioClothXpbdSeamV2[];
  readonly structuralCompliance?: number;
  readonly bendCompliance?: number;
  readonly seamCompliance?: number;
  readonly selfCollisionCompliance?: number;
  readonly selfCollisionEnabled?: boolean;
  readonly dampingPerSecond?: number;
  readonly gravity?: StudioClothXpbdVec3V2;
  readonly solverIterations?: number;
  readonly topologyEpoch?: number;
}

export interface StudioClothXpbdKinematicPinV2 {
  readonly particle: number;
  readonly previous: StudioClothXpbdVec3V2;
  readonly current: StudioClothXpbdVec3V2;
}

export interface StudioClothXpbdCapsuleFrameV2 {
  readonly id: string;
  readonly previousHead: StudioClothXpbdVec3V2;
  readonly previousTail: StudioClothXpbdVec3V2;
  readonly currentHead: StudioClothXpbdVec3V2;
  readonly currentTail: StudioClothXpbdVec3V2;
  readonly radius: number;
  readonly friction?: number;
  readonly compliance?: number;
}

export interface StudioClothXpbdStepInputV2 {
  /** Monotonic anti-stale token. It must exactly match runtime.stepIndex. */
  readonly expectedStepIndex: number;
  readonly expectedTopologySha256?: string;
  readonly kinematicPins?: readonly StudioClothXpbdKinematicPinV2[];
  readonly capsules?: readonly StudioClothXpbdCapsuleFrameV2[];
  readonly solverIterations?: number;
}

export interface StudioClothXpbdCompiledModelV2 {
  readonly revision: typeof STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION;
  readonly topologyEpoch: number;
  readonly particleCount: number;
  readonly triangleCount: number;
  readonly restPositions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly inverseMasses: Float32Array;
  readonly particleRadii: Float32Array;
  readonly fixedMask: Uint8Array;
  readonly structuralPairs: Uint32Array;
  readonly structuralRestLengths: Float32Array;
  readonly bendPairs: Uint32Array;
  readonly bendRestLengths: Float32Array;
  readonly seamPairs: Uint32Array;
  readonly seamRestLengths: Float32Array;
  readonly seamCompliances: Float32Array;
  readonly selfCollisionExclusionPairs: Uint32Array;
  readonly structuralCompliance: number;
  readonly bendCompliance: number;
  readonly selfCollisionCompliance: number;
  readonly selfCollisionEnabled: boolean;
  readonly dampingPerSecond: number;
  readonly gravity: StudioClothXpbdVec3V2;
  readonly solverIterations: number;
  readonly bendModel: typeof STUDIO_CLOTH_XPBD_BEND_MODEL;
  readonly topologySha256: string;
}

export interface StudioClothXpbdRuntimeV2 {
  readonly model: StudioClothXpbdCompiledModelV2;
  readonly positions: Float32Array;
  readonly previousPositions: Float32Array;
  readonly velocities: Float32Array;
  stepIndex: number;
  lastReceipt?: StudioClothXpbdStepReceiptV2;
}

export interface StudioClothXpbdStepDiagnosticsV2 {
  readonly maxStructuralError: number;
  readonly maxBendError: number;
  readonly maxSeamError: number;
  readonly maxCapsulePenetration: number;
  readonly maxSelfCollisionPenetration: number;
  readonly structuralLambdaL1: number;
  readonly bendLambdaL1: number;
  readonly seamLambdaL1: number;
  readonly capsuleLambdaL1: number;
  readonly selfCollisionLambdaL1: number;
  readonly nonFiniteCount: 0;
}

export interface StudioClothXpbdStepReceiptV2 {
  readonly revision: typeof STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION;
  readonly complete: true;
  readonly fixedStepSeconds: typeof STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS;
  readonly determinismScope: typeof STUDIO_CLOTH_XPBD_DETERMINISM_SCOPE;
  readonly bendModel: typeof STUDIO_CLOTH_XPBD_BEND_MODEL;
  readonly capsulePoseModel: typeof STUDIO_CLOTH_XPBD_CAPSULE_POSE_MODEL;
  readonly topologyEpoch: number;
  readonly topologySha256: string;
  readonly stepIndexBefore: number;
  readonly stepIndexAfter: number;
  readonly solverIterations: number;
  readonly structuralConstraintCount: number;
  readonly bendConstraintCount: number;
  readonly seamConstraintCount: number;
  readonly selfCollisionPairCount: number;
  /** Broadphase particle entries inspected before exclusion and distance filtering. */
  readonly selfCollisionCandidateCheckCount: number;
  /** Deterministic budget charge for spatial-hash keys, probes, candidates, and pair sorting. */
  readonly selfCollisionBroadphaseWorkUnits: number;
  readonly capsuleContactCount: number;
  readonly inputStateSha256: string;
  readonly pinFrameSha256: string;
  readonly capsuleFrameSha256: string;
  readonly outputPositionsSha256: string;
  readonly outputVelocitiesSha256: string;
  readonly diagnostics: StudioClothXpbdStepDiagnosticsV2;
  readonly receiptSha256: string;
}

export type StudioClothXpbdFailureCodeV2 =
  | "invalid-input"
  | "budget-exceeded"
  | "stale-step"
  | "topology-mismatch"
  | "numerical-failure";

export interface StudioClothXpbdFailureV2 {
  readonly ok: false;
  readonly code: StudioClothXpbdFailureCodeV2;
  readonly detail: string;
}

export type StudioClothXpbdCompileResultV2 =
  | { readonly ok: true; readonly model: StudioClothXpbdCompiledModelV2 }
  | StudioClothXpbdFailureV2;

export type StudioClothXpbdRuntimeResultV2 =
  | { readonly ok: true; readonly runtime: StudioClothXpbdRuntimeV2 }
  | StudioClothXpbdFailureV2;

export type StudioClothXpbdStepResultV2 =
  | { readonly ok: true; readonly receipt: StudioClothXpbdStepReceiptV2 }
  | StudioClothXpbdFailureV2;

interface EdgeOccurrence {
  readonly opposite: number;
  readonly direction: -1 | 1;
}

interface EdgeRecord {
  readonly a: number;
  readonly b: number;
  readonly occurrences: EdgeOccurrence[];
}

interface SelfCollisionPairsResult {
  readonly ok: true;
  readonly pairs: Uint32Array;
  readonly candidateCheckCount: number;
  readonly broadphaseWorkUnits: number;
}

interface CapsuleContact {
  readonly penetration: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly colliderVx: number;
  readonly colliderVy: number;
  readonly colliderVz: number;
}

interface SelectedCapsuleContact extends CapsuleContact {
  readonly capsuleIndex: number;
  readonly friction: number;
}

function failure(
  code: StudioClothXpbdFailureCodeV2,
  detail: string,
): StudioClothXpbdFailureV2 {
  return { ok: false, code, detail };
}

function isRecordObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteBounded(value: number, magnitude: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= magnitude;
}

function validateFiniteArray(
  values: Float32Array,
  label: string,
  magnitude: number,
): string | undefined {
  for (let index = 0; index < values.length; index += 1) {
    if (!isFiniteBounded(values[index]!, magnitude)) {
      return `${label}[${index}] must be finite and within +/-${magnitude}.`;
    }
  }
  return undefined;
}

function validateVec3(value: StudioClothXpbdVec3V2, label: string, magnitude: number): string | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return `${label} must be a three-number tuple.`;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!isFiniteBounded(value[axis]!, magnitude)) {
      return `${label}[${axis}] must be finite and within +/-${magnitude}.`;
    }
  }
  return undefined;
}

function validateCompliance(value: number, label: string): string | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return `${label} must be finite and in [0, 1].`;
  }
  return undefined;
}

function canonicalPair(a: number, b: number): readonly [number, number] {
  return a < b ? [a, b] : [b, a];
}

function pairKey(a: number, b: number): string {
  const pair = canonicalPair(a, b);
  return `${pair[0]}:${pair[1]}`;
}

function f32(value: number): number {
  return Math.fround(value);
}

function distanceAt(positions: Float32Array, a: number, b: number): number {
  const a3 = a * 3;
  const b3 = b * 3;
  return Math.hypot(
    positions[b3]! - positions[a3]!,
    positions[b3 + 1]! - positions[a3 + 1]!,
    positions[b3 + 2]! - positions[a3 + 2]!,
  );
}

function triangleDoubleAreaSquared(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): number {
  const a3 = a * 3;
  const b3 = b * 3;
  const c3 = c * 3;
  const abx = positions[b3]! - positions[a3]!;
  const aby = positions[b3 + 1]! - positions[a3 + 1]!;
  const abz = positions[b3 + 2]! - positions[a3 + 2]!;
  const acx = positions[c3]! - positions[a3]!;
  const acy = positions[c3 + 1]! - positions[a3 + 1]!;
  const acz = positions[c3 + 2]! - positions[a3 + 2]!;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return cx * cx + cy * cy + cz * cz;
}

function bytesForFloat32(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, values.length, true);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(4 + index * 4, values[index]!, true);
  }
  return bytes;
}

function bytesForUint32(values: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, values.length, true);
  for (let index = 0; index < values.length; index += 1) {
    view.setUint32(4 + index * 4, values[index]!, true);
  }
  return bytes;
}

function bytesForUint8(values: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(4 + values.length);
  new DataView(bytes.buffer).setUint32(0, values.length, true);
  bytes.set(values, 4);
  return bytes;
}

function hashText(value: string): string {
  return sha256HexPortable(new TextEncoder().encode(value));
}

function hashFloat32(values: Float32Array): string {
  return sha256HexPortable(bytesForFloat32(values));
}

function hashUint32(values: Uint32Array): string {
  return sha256HexPortable(bytesForUint32(values));
}

function hashUint8(values: Uint8Array): string {
  return sha256HexPortable(bytesForUint8(values));
}

function stablePairNormal(a: number, b: number): StudioClothXpbdVec3V2 {
  const seed = ((a + 1) * 73_856_093) ^ ((b + 1) * 19_349_663);
  const axis = Math.abs(seed) % 3;
  const sign = (seed & 4) === 0 ? 1 : -1;
  if (axis === 0) return [sign, 0, 0];
  if (axis === 1) return [0, sign, 0];
  return [0, 0, sign];
}

function topologyHash(model: Omit<StudioClothXpbdCompiledModelV2, "topologySha256">): string {
  return hashText([
    `revision=${model.revision}`,
    `epoch=${model.topologyEpoch}`,
    `rest=${hashFloat32(model.restPositions)}`,
    `triangles=${hashUint32(model.triangleIndices)}`,
    `invMass=${hashFloat32(model.inverseMasses)}`,
    `radii=${hashFloat32(model.particleRadii)}`,
    `fixed=${hashUint8(model.fixedMask)}`,
    `structuralPairs=${hashUint32(model.structuralPairs)}`,
    `structuralRest=${hashFloat32(model.structuralRestLengths)}`,
    `bendPairs=${hashUint32(model.bendPairs)}`,
    `bendRest=${hashFloat32(model.bendRestLengths)}`,
    `seamPairs=${hashUint32(model.seamPairs)}`,
    `seamRest=${hashFloat32(model.seamRestLengths)}`,
    `seamCompliance=${hashFloat32(model.seamCompliances)}`,
    `selfCollisionExclusions=${hashUint32(model.selfCollisionExclusionPairs)}`,
    `structuralCompliance=${model.structuralCompliance}`,
    `bendCompliance=${model.bendCompliance}`,
    `selfCollisionCompliance=${model.selfCollisionCompliance}`,
    `selfCollision=${model.selfCollisionEnabled ? 1 : 0}`,
    `damping=${model.dampingPerSecond}`,
    `gravity=${model.gravity.join(",")}`,
    `iterations=${model.solverIterations}`,
    `bendModel=${model.bendModel}`,
  ].join("|"));
}

function appendEdge(
  edgeMap: Map<string, EdgeRecord>,
  from: number,
  to: number,
  opposite: number,
): string | undefined {
  const pair = canonicalPair(from, to);
  const key = `${pair[0]}:${pair[1]}`;
  const direction: -1 | 1 = from === pair[0] ? 1 : -1;
  let record = edgeMap.get(key);
  if (!record) {
    record = { a: pair[0], b: pair[1], occurrences: [] };
    edgeMap.set(key, record);
  }
  record.occurrences.push({ opposite, direction });
  if (record.occurrences.length > 2) {
    return `Non-manifold edge ${key} has more than two incident triangles.`;
  }
  if (
    record.occurrences.length === 2 &&
    record.occurrences[0]!.direction === record.occurrences[1]!.direction
  ) {
    return `Shared edge ${key} has inconsistent triangle winding.`;
  }
  return undefined;
}

function compileStudioClothXpbdModelV2Unchecked(
  input: StudioClothXpbdCompileInputV2,
): StudioClothXpbdCompileResultV2 {
  if (!(input.restPositions instanceof Float32Array)) {
    return failure("invalid-input", "restPositions must be a Float32Array.");
  }
  if (!(input.triangleIndices instanceof Uint32Array)) {
    return failure("invalid-input", "triangleIndices must be a Uint32Array.");
  }
  if (input.restPositions.length === 0 || input.restPositions.length % 3 !== 0) {
    return failure("invalid-input", "restPositions must contain complete XYZ triplets.");
  }
  if (input.triangleIndices.length === 0 || input.triangleIndices.length % 3 !== 0) {
    return failure("invalid-input", "triangleIndices must contain complete triangles.");
  }

  const particleCount = input.restPositions.length / 3;
  const triangleCount = input.triangleIndices.length / 3;
  if (particleCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticles) {
    return failure(
      "budget-exceeded",
      `Particle count ${particleCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticles}.`,
    );
  }
  if (triangleCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles) {
    return failure(
      "budget-exceeded",
      `Triangle count ${triangleCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles}.`,
    );
  }

  const positionError = validateFiniteArray(
    input.restPositions,
    "restPositions",
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
  );
  if (positionError) return failure("invalid-input", positionError);

  if (input.inverseMasses && !(input.inverseMasses instanceof Float32Array)) {
    return failure("invalid-input", "inverseMasses must be a Float32Array.");
  }
  if (input.particleRadii && !(input.particleRadii instanceof Float32Array)) {
    return failure("invalid-input", "particleRadii must be a Float32Array.");
  }
  if (input.seams !== undefined && !Array.isArray(input.seams)) {
    return failure("invalid-input", "seams must be an array.");
  }
  if (
    input.selfCollisionEnabled !== undefined &&
    typeof input.selfCollisionEnabled !== "boolean"
  ) {
    return failure("invalid-input", "selfCollisionEnabled must be a boolean.");
  }

  const inverseMasses = input.inverseMasses
    ? new Float32Array(input.inverseMasses)
    : new Float32Array(particleCount).fill(1);
  if (inverseMasses.length !== particleCount) {
    return failure("invalid-input", "inverseMasses length must equal the particle count.");
  }
  for (let index = 0; index < inverseMasses.length; index += 1) {
    const value = inverseMasses[index]!;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxInverseMass
    ) {
      return failure(
        "invalid-input",
        `inverseMasses[${index}] must be finite and in [0, ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxInverseMass}].`,
      );
    }
  }

  const particleRadii = input.particleRadii
    ? new Float32Array(input.particleRadii)
    : new Float32Array(particleCount).fill(DEFAULT_PARTICLE_RADIUS);
  if (particleRadii.length !== particleCount) {
    return failure("invalid-input", "particleRadii length must equal the particle count.");
  }
  for (let index = 0; index < particleRadii.length; index += 1) {
    const value = particleRadii[index]!;
    if (
      !Number.isFinite(value) ||
      value < STUDIO_CLOTH_XPBD_V2_BUDGETS.minParticleRadius ||
      value > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticleRadius
    ) {
      return failure(
        "invalid-input",
        `particleRadii[${index}] must be finite and in [${STUDIO_CLOTH_XPBD_V2_BUDGETS.minParticleRadius}, ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticleRadius}].`,
      );
    }
  }

  const structuralCompliance =
    input.structuralCompliance ?? DEFAULT_STRUCTURAL_COMPLIANCE;
  const bendCompliance = input.bendCompliance ?? DEFAULT_BEND_COMPLIANCE;
  const defaultSeamCompliance = input.seamCompliance ?? DEFAULT_SEAM_COMPLIANCE;
  const selfCollisionCompliance =
    input.selfCollisionCompliance ?? DEFAULT_SELF_COLLISION_COMPLIANCE;
  for (const [label, value] of [
    ["structuralCompliance", structuralCompliance],
    ["bendCompliance", bendCompliance],
    ["seamCompliance", defaultSeamCompliance],
    ["selfCollisionCompliance", selfCollisionCompliance],
  ] as const) {
    const error = validateCompliance(value, label);
    if (error) return failure("invalid-input", error);
  }

  const dampingPerSecond = input.dampingPerSecond ?? DEFAULT_DAMPING_PER_SECOND;
  if (!Number.isFinite(dampingPerSecond) || dampingPerSecond < 0 || dampingPerSecond > 100) {
    return failure("invalid-input", "dampingPerSecond must be finite and in [0, 100].");
  }
  const gravity = input.gravity ?? [0, -9.81, 0];
  const gravityError = validateVec3(
    gravity,
    "gravity",
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxGravityMagnitude,
  );
  if (gravityError) return failure("invalid-input", gravityError);

  const solverIterations = input.solverIterations ?? DEFAULT_SOLVER_ITERATIONS;
  if (
    !Number.isInteger(solverIterations) ||
    solverIterations < 1 ||
    solverIterations > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations
  ) {
    return failure(
      "invalid-input",
      `solverIterations must be an integer in [1, ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations}].`,
    );
  }
  const topologyEpoch = input.topologyEpoch ?? 1;
  if (!Number.isSafeInteger(topologyEpoch) || topologyEpoch < 1) {
    return failure("invalid-input", "topologyEpoch must be a positive safe integer.");
  }

  const fixedMask = new Uint8Array(particleCount);
  const fixedIndices = input.fixedParticleIndices ?? new Uint32Array();
  if (!(fixedIndices instanceof Uint32Array)) {
    return failure("invalid-input", "fixedParticleIndices must be a Uint32Array.");
  }
  if (fixedIndices.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins) {
    return failure(
      "budget-exceeded",
      `Fixed pin count ${fixedIndices.length} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins}.`,
    );
  }
  for (let index = 0; index < fixedIndices.length; index += 1) {
    const particle = fixedIndices[index]!;
    if (particle >= particleCount) {
      return failure("invalid-input", `fixedParticleIndices[${index}] is out of range.`);
    }
    if (fixedMask[particle] !== 0) {
      return failure("invalid-input", `Fixed particle ${particle} is duplicated.`);
    }
    fixedMask[particle] = 1;
    inverseMasses[particle] = 0;
  }

  const edgeMap = new Map<string, EdgeRecord>();
  const faceKeys = new Set<string>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = input.triangleIndices[offset]!;
    const b = input.triangleIndices[offset + 1]!;
    const c = input.triangleIndices[offset + 2]!;
    if (a >= particleCount || b >= particleCount || c >= particleCount) {
      return failure("invalid-input", `Triangle ${triangle} contains an out-of-range particle.`);
    }
    if (a === b || b === c || c === a) {
      return failure("invalid-input", `Triangle ${triangle} repeats a particle index.`);
    }
    const faceKey = [a, b, c].sort((left, right) => left - right).join(":");
    if (faceKeys.has(faceKey)) {
      return failure("invalid-input", `Triangle ${triangle} duplicates face ${faceKey}.`);
    }
    faceKeys.add(faceKey);
    if (triangleDoubleAreaSquared(input.restPositions, a, b, c) <= TRIANGLE_AREA_EPSILON) {
      return failure("invalid-input", `Triangle ${triangle} is degenerate in the rest pose.`);
    }
    const edgeError =
      appendEdge(edgeMap, a, b, c) ??
      appendEdge(edgeMap, b, c, a) ??
      appendEdge(edgeMap, c, a, b);
    if (edgeError) return failure("invalid-input", edgeError);
  }

  const sortedEdges = [...edgeMap.values()].sort(
    (left, right) => left.a - right.a || left.b - right.b,
  );
  const structuralPairs = new Uint32Array(sortedEdges.length * 2);
  const structuralRestLengths = new Float32Array(sortedEdges.length);
  const bendPairList: number[] = [];
  const bendRestList: number[] = [];
  const bendKeys = new Set<string>();
  for (let index = 0; index < sortedEdges.length; index += 1) {
    const edge = sortedEdges[index]!;
    structuralPairs[index * 2] = edge.a;
    structuralPairs[index * 2 + 1] = edge.b;
    const restLength = distanceAt(input.restPositions, edge.a, edge.b);
    if (restLength <= MIN_DISTANCE) {
      return failure("invalid-input", `Structural edge ${edge.a}:${edge.b} has zero rest length.`);
    }
    structuralRestLengths[index] = f32(restLength);
    if (edge.occurrences.length !== 2) continue;
    const pair = canonicalPair(
      edge.occurrences[0]!.opposite,
      edge.occurrences[1]!.opposite,
    );
    if (pair[0] === pair[1]) {
      return failure("invalid-input", `Internal edge ${edge.a}:${edge.b} has one opposite vertex.`);
    }
    const key = `${pair[0]}:${pair[1]}`;
    if (bendKeys.has(key)) continue;
    bendKeys.add(key);
    const bendRest = distanceAt(input.restPositions, pair[0], pair[1]);
    if (bendRest <= MIN_DISTANCE) {
      return failure("invalid-input", `Bend pair ${key} has zero rest length.`);
    }
    bendPairList.push(pair[0], pair[1]);
    bendRestList.push(f32(bendRest));
  }

  const seamPairsList: number[] = [];
  const seamRestList: number[] = [];
  const seamComplianceList: number[] = [];
  const seamIds = new Set<string>();
  const seamPairKeys = new Set<string>();
  const inputSeams = input.seams ?? [];
  const seamCount = inputSeams.length;
  if (seamCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSeams) {
    return failure(
      "budget-exceeded",
      `Seam count ${seamCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSeams}.`,
    );
  }
  const baseConstraintCount = structuralRestLengths.length + bendRestList.length;
  if (baseConstraintCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints) {
    return failure(
      "budget-exceeded",
      `Constraint count ${baseConstraintCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints}.`,
    );
  }
  let preflightSeamPairCount = 0;
  const preflightSeams: StudioClothXpbdSeamV2[] = [];
  for (let seamIndex = 0; seamIndex < seamCount; seamIndex += 1) {
    const seam = inputSeams[seamIndex];
    if (!isRecordObject(seam)) {
      return failure("invalid-input", `seams[${seamIndex}] must be an object.`);
    }
    const id = seam.id;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxIdentifierLength
    ) {
      return failure("invalid-input", "Every seam id must be a non-empty bounded string.");
    }
    const pairs = seam.pairs;
    if (!(pairs instanceof Uint32Array) || pairs.length % 2 !== 0) {
      return failure(
        "invalid-input",
        `seams[${seamIndex}].pairs must be a Uint32Array of pairs.`,
      );
    }
    const pairCount = pairs.length / 2;
    const restLengths = seam.restLengths;
    if (
      restLengths !== undefined &&
      (!(restLengths instanceof Float32Array) || restLengths.length !== pairCount)
    ) {
      return failure("invalid-input", `Seam ${id} restLengths must match its pair count.`);
    }
    const compliance = seam.compliance;
    if (compliance !== undefined && typeof compliance !== "number") {
      return failure("invalid-input", `Seam ${id} compliance must be a number.`);
    }
    const nextPairCount = preflightSeamPairCount + pairCount;
    if (!Number.isSafeInteger(pairCount) || !Number.isSafeInteger(nextPairCount)) {
      return failure("budget-exceeded", "Total seam pair count exceeds the safe-integer range.");
    }
    const nextConstraintCount = baseConstraintCount + nextPairCount;
    if (nextConstraintCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints) {
      return failure(
        "budget-exceeded",
        `Constraint count ${nextConstraintCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints}.`,
      );
    }
    preflightSeamPairCount = nextPairCount;
    preflightSeams.push({
      id,
      pairs,
      restLengths,
      compliance,
    });
  }
  const seams = preflightSeams.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const seam of seams) {
    if (
      typeof seam.id !== "string" ||
      seam.id.length === 0 ||
      seam.id.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxIdentifierLength
    ) {
      return failure("invalid-input", "Every seam id must be a non-empty bounded string.");
    }
    if (seamIds.has(seam.id)) {
      return failure("invalid-input", `Seam id ${seam.id} is duplicated.`);
    }
    seamIds.add(seam.id);
    if (!(seam.pairs instanceof Uint32Array) || seam.pairs.length % 2 !== 0) {
      return failure("invalid-input", `Seam ${seam.id} pairs must be a Uint32Array of pairs.`);
    }
    const pairCount = seam.pairs.length / 2;
    if (seam.restLengths && (!(seam.restLengths instanceof Float32Array) || seam.restLengths.length !== pairCount)) {
      return failure("invalid-input", `Seam ${seam.id} restLengths must match its pair count.`);
    }
    const compliance = seam.compliance ?? defaultSeamCompliance;
    const complianceError = validateCompliance(compliance, `Seam ${seam.id} compliance`);
    if (complianceError) return failure("invalid-input", complianceError);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const rawA = seam.pairs[pairIndex * 2]!;
      const rawB = seam.pairs[pairIndex * 2 + 1]!;
      if (rawA >= particleCount || rawB >= particleCount || rawA === rawB) {
        return failure("invalid-input", `Seam ${seam.id} pair ${pairIndex} is invalid.`);
      }
      const pair = canonicalPair(rawA, rawB);
      const key = `${pair[0]}:${pair[1]}`;
      if (seamPairKeys.has(key)) {
        return failure("invalid-input", `Seam particle pair ${key} is duplicated.`);
      }
      seamPairKeys.add(key);
      const rest = seam.restLengths?.[pairIndex] ?? 0;
      if (!Number.isFinite(rest) || rest < 0 || rest > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude * 2) {
        return failure("invalid-input", `Seam ${seam.id} rest length ${pairIndex} is invalid.`);
      }
      seamPairsList.push(pair[0], pair[1]);
      seamRestList.push(f32(rest));
      seamComplianceList.push(f32(compliance));
    }
  }

  const bendPairs = Uint32Array.from(bendPairList);
  const bendRestLengths = Float32Array.from(bendRestList);
  const seamPairs = Uint32Array.from(seamPairsList);
  const seamRestLengths = Float32Array.from(seamRestList);
  const seamCompliances = Float32Array.from(seamComplianceList);
  const constraintCount =
    structuralRestLengths.length + bendRestLengths.length + seamRestLengths.length;
  if (constraintCount > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints) {
    return failure(
      "budget-exceeded",
      `Constraint count ${constraintCount} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints}.`,
    );
  }

  const exclusionKeys = new Set<string>();
  for (let index = 0; index < structuralPairs.length; index += 2) {
    exclusionKeys.add(pairKey(structuralPairs[index]!, structuralPairs[index + 1]!));
  }
  for (let index = 0; index < seamPairs.length; index += 2) {
    exclusionKeys.add(pairKey(seamPairs[index]!, seamPairs[index + 1]!));
  }
  const exclusionPairsList = [...exclusionKeys]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
    .flat();

  const restPositions = new Float32Array(input.restPositions);
  const triangleIndices = new Uint32Array(input.triangleIndices);
  const modelWithoutHash: Omit<StudioClothXpbdCompiledModelV2, "topologySha256"> = {
    revision: STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION,
    topologyEpoch,
    particleCount,
    triangleCount,
    restPositions,
    triangleIndices,
    inverseMasses,
    particleRadii,
    fixedMask,
    structuralPairs,
    structuralRestLengths,
    bendPairs,
    bendRestLengths,
    seamPairs,
    seamRestLengths,
    seamCompliances,
    selfCollisionExclusionPairs: Uint32Array.from(exclusionPairsList),
    structuralCompliance: f32(structuralCompliance),
    bendCompliance: f32(bendCompliance),
    selfCollisionCompliance: f32(selfCollisionCompliance),
    selfCollisionEnabled: input.selfCollisionEnabled ?? true,
    dampingPerSecond: f32(dampingPerSecond),
    gravity: [f32(gravity[0]), f32(gravity[1]), f32(gravity[2])],
    solverIterations,
    bendModel: STUDIO_CLOTH_XPBD_BEND_MODEL,
  };
  const model: StudioClothXpbdCompiledModelV2 = Object.freeze({
    ...modelWithoutHash,
    topologySha256: topologyHash(modelWithoutHash),
  });
  return { ok: true, model };
}

export function compileStudioClothXpbdModelV2(
  input: StudioClothXpbdCompileInputV2,
): StudioClothXpbdCompileResultV2 {
  try {
    if (!isRecordObject(input)) {
      return failure("invalid-input", "Compile input must be an object.");
    }
    return compileStudioClothXpbdModelV2Unchecked(input);
  } catch {
    return failure("invalid-input", "Compile input could not be validated safely.");
  }
}

function createStudioClothXpbdRuntimeV2Unchecked(
  model: StudioClothXpbdCompiledModelV2,
  initial?: {
    readonly positions?: Float32Array;
    readonly velocities?: Float32Array;
  },
): StudioClothXpbdRuntimeResultV2 {
  if (model.revision !== STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION) {
    return failure("invalid-input", "The compiled model revision is not supported.");
  }
  if (topologyHash(model) !== model.topologySha256) {
    return failure("topology-mismatch", "The compiled model arrays no longer match their topology hash.");
  }
  if (initial?.positions && !(initial.positions instanceof Float32Array)) {
    return failure("invalid-input", "Initial positions must be a Float32Array.");
  }
  if (initial?.velocities && !(initial.velocities instanceof Float32Array)) {
    return failure("invalid-input", "Initial velocities must be a Float32Array.");
  }
  const positions = initial?.positions
    ? new Float32Array(initial.positions)
    : new Float32Array(model.restPositions);
  const velocities = initial?.velocities
    ? new Float32Array(initial.velocities)
    : new Float32Array(model.particleCount * 3);
  if (positions.length !== model.particleCount * 3) {
    return failure("invalid-input", "Initial positions length does not match the compiled model.");
  }
  if (velocities.length !== model.particleCount * 3) {
    return failure("invalid-input", "Initial velocities length does not match the compiled model.");
  }
  const positionError = validateFiniteArray(
    positions,
    "initial.positions",
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
  );
  if (positionError) return failure("invalid-input", positionError);
  const velocityError = validateFiniteArray(
    velocities,
    "initial.velocities",
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
  );
  if (velocityError) return failure("invalid-input", velocityError);

  for (let particle = 0; particle < model.particleCount; particle += 1) {
    const offset = particle * 3;
    if (model.inverseMasses[particle] === 0) {
      velocities[offset] = 0;
      velocities[offset + 1] = 0;
      velocities[offset + 2] = 0;
    }
    if (model.fixedMask[particle] !== 0) {
      positions[offset] = model.restPositions[offset]!;
      positions[offset + 1] = model.restPositions[offset + 1]!;
      positions[offset + 2] = model.restPositions[offset + 2]!;
    }
  }
  return {
    ok: true,
    runtime: {
      model,
      positions,
      previousPositions: new Float32Array(positions),
      velocities,
      stepIndex: 0,
    },
  };
}

export function createStudioClothXpbdRuntimeV2(
  model: StudioClothXpbdCompiledModelV2,
  initial?: {
    readonly positions?: Float32Array;
    readonly velocities?: Float32Array;
  },
): StudioClothXpbdRuntimeResultV2 {
  try {
    if (!isRecordObject(model)) {
      return failure("invalid-input", "Compiled model must be an object.");
    }
    if (initial !== undefined && !isRecordObject(initial)) {
      return failure("invalid-input", "Initial runtime state must be an object.");
    }
    return createStudioClothXpbdRuntimeV2Unchecked(model, initial);
  } catch {
    return failure("invalid-input", "Runtime input could not be validated safely.");
  }
}

function normalizeKinematicPins(
  model: StudioClothXpbdCompiledModelV2,
  pins: readonly StudioClothXpbdKinematicPinV2[],
):
  | { readonly ok: true; readonly pins: readonly StudioClothXpbdKinematicPinV2[] }
  | StudioClothXpbdFailureV2 {
  if (pins.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins) {
    return failure(
      "budget-exceeded",
      `Kinematic pin count ${pins.length} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins}.`,
    );
  }
  let fixedPinCount = 0;
  for (let particle = 0; particle < model.fixedMask.length; particle += 1) {
    fixedPinCount += model.fixedMask[particle]!;
  }
  if (fixedPinCount + pins.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins) {
    return failure(
      "budget-exceeded",
      `Combined fixed and kinematic pin count ${fixedPinCount + pins.length} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins}.`,
    );
  }
  const normalized = [...pins].sort((left, right) => left.particle - right.particle);
  let previousParticle = -1;
  for (const pin of normalized) {
    if (!Number.isInteger(pin.particle) || pin.particle < 0 || pin.particle >= model.particleCount) {
      return failure("invalid-input", `Kinematic pin particle ${pin.particle} is out of range.`);
    }
    if (pin.particle === previousParticle) {
      return failure("invalid-input", `Kinematic pin particle ${pin.particle} is duplicated.`);
    }
    if (model.fixedMask[pin.particle] !== 0) {
      return failure(
        "invalid-input",
        `Particle ${pin.particle} cannot be both a fixed and a kinematic pin.`,
      );
    }
    if (model.inverseMasses[pin.particle] === 0) {
      return failure(
        "invalid-input",
        `Static particle ${pin.particle} cannot be a kinematic pin.`,
      );
    }
    const previousError = validateVec3(
      pin.previous,
      `Kinematic pin ${pin.particle} previous`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    if (previousError) return failure("invalid-input", previousError);
    const currentError = validateVec3(
      pin.current,
      `Kinematic pin ${pin.particle} current`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    if (currentError) return failure("invalid-input", currentError);
    previousParticle = pin.particle;
  }
  return { ok: true, pins: normalized };
}

function normalizeCapsules(
  capsules: readonly StudioClothXpbdCapsuleFrameV2[],
):
  | { readonly ok: true; readonly capsules: readonly StudioClothXpbdCapsuleFrameV2[] }
  | StudioClothXpbdFailureV2 {
  if (capsules.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCapsules) {
    return failure(
      "budget-exceeded",
      `Capsule count ${capsules.length} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCapsules}.`,
    );
  }
  const normalized = [...capsules].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  let previousId: string | undefined;
  for (const capsule of normalized) {
    if (
      typeof capsule.id !== "string" ||
      capsule.id.length === 0 ||
      capsule.id.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxIdentifierLength
    ) {
      return failure("invalid-input", "Every capsule id must be a non-empty bounded string.");
    }
    if (capsule.id === previousId) {
      return failure("invalid-input", `Capsule id ${capsule.id} is duplicated.`);
    }
    for (const [label, value] of [
      ["previousHead", capsule.previousHead],
      ["previousTail", capsule.previousTail],
      ["currentHead", capsule.currentHead],
      ["currentTail", capsule.currentTail],
    ] as const) {
      const error = validateVec3(
        value,
        `Capsule ${capsule.id} ${label}`,
        STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
      );
      if (error) return failure("invalid-input", error);
    }
    if (
      !Number.isFinite(capsule.radius) ||
      capsule.radius < STUDIO_CLOTH_XPBD_V2_BUDGETS.minParticleRadius ||
      capsule.radius > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticleRadius
    ) {
      return failure("invalid-input", `Capsule ${capsule.id} radius is invalid.`);
    }
    const friction = capsule.friction ?? 0;
    if (!Number.isFinite(friction) || friction < 0 || friction > 1) {
      return failure("invalid-input", `Capsule ${capsule.id} friction must be in [0, 1].`);
    }
    const complianceError = validateCompliance(
      capsule.compliance ?? 0,
      `Capsule ${capsule.id} compliance`,
    );
    if (complianceError) return failure("invalid-input", complianceError);
    previousId = capsule.id;
  }
  return { ok: true, capsules: normalized };
}

function pinFrameHash(pins: readonly StudioClothXpbdKinematicPinV2[]): string {
  return hashText(pins.map((pin) => [
    pin.particle,
    ...pin.previous.map(f32),
    ...pin.current.map(f32),
  ].join(",")).join("|"));
}

function capsuleFrameHash(capsules: readonly StudioClothXpbdCapsuleFrameV2[]): string {
  return hashText(capsules.map((capsule) => [
    capsule.id,
    ...capsule.previousHead.map(f32),
    ...capsule.previousTail.map(f32),
    ...capsule.currentHead.map(f32),
    ...capsule.currentTail.map(f32),
    f32(capsule.radius),
    f32(capsule.friction ?? 0),
    f32(capsule.compliance ?? 0),
  ].join(",")).join("|"));
}

function restoreFixedAndKinematicPositions(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  pins: readonly StudioClothXpbdKinematicPinV2[],
): void {
  for (let particle = 0; particle < model.particleCount; particle += 1) {
    if (model.fixedMask[particle] === 0) continue;
    const offset = particle * 3;
    positions[offset] = model.restPositions[offset]!;
    positions[offset + 1] = model.restPositions[offset + 1]!;
    positions[offset + 2] = model.restPositions[offset + 2]!;
  }
  for (const pin of pins) {
    const offset = pin.particle * 3;
    positions[offset] = f32(pin.current[0]);
    positions[offset + 1] = f32(pin.current[1]);
    positions[offset + 2] = f32(pin.current[2]);
  }
}

function effectiveInverseMass(
  model: StudioClothXpbdCompiledModelV2,
  kinematicMask: Uint8Array,
  particle: number,
): number {
  return kinematicMask[particle] === 0 ? model.inverseMasses[particle]! : 0;
}

function solveDistanceConstraints(
  positions: Float32Array,
  inverseMasses: Float32Array,
  kinematicMask: Uint8Array,
  pairs: Uint32Array,
  restLengths: Float32Array,
  compliance: number | Float32Array,
  lambdas: Float32Array,
): void {
  const inverseStepSquared =
    1 / (STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS * STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS);
  for (let constraint = 0; constraint < restLengths.length; constraint += 1) {
    const a = pairs[constraint * 2]!;
    const b = pairs[constraint * 2 + 1]!;
    const a3 = a * 3;
    const b3 = b * 3;
    const dx = positions[b3]! - positions[a3]!;
    const dy = positions[b3 + 1]! - positions[a3 + 1]!;
    const dz = positions[b3 + 2]! - positions[a3 + 2]!;
    const distance = Math.hypot(dx, dy, dz);
    const normal = distance > MIN_DISTANCE
      ? [dx / distance, dy / distance, dz / distance] as const
      : stablePairNormal(a, b);
    const weightA = kinematicMask[a] === 0 ? inverseMasses[a]! : 0;
    const weightB = kinematicMask[b] === 0 ? inverseMasses[b]! : 0;
    if (weightA + weightB === 0) continue;
    const complianceValue = typeof compliance === "number" ? compliance : compliance[constraint]!;
    const alphaTilde = complianceValue * inverseStepSquared;
    const constraintError = distance - restLengths[constraint]!;
    const deltaLambda =
      (-constraintError - alphaTilde * lambdas[constraint]!) /
      (weightA + weightB + alphaTilde);
    lambdas[constraint] = f32(lambdas[constraint]! + deltaLambda);
    if (weightA > 0) {
      positions[a3] = f32(positions[a3]! - weightA * normal[0] * deltaLambda);
      positions[a3 + 1] = f32(positions[a3 + 1]! - weightA * normal[1] * deltaLambda);
      positions[a3 + 2] = f32(positions[a3 + 2]! - weightA * normal[2] * deltaLambda);
    }
    if (weightB > 0) {
      positions[b3] = f32(positions[b3]! + weightB * normal[0] * deltaLambda);
      positions[b3 + 1] = f32(positions[b3 + 1]! + weightB * normal[1] * deltaLambda);
      positions[b3 + 2] = f32(positions[b3 + 2]! + weightB * normal[2] * deltaLambda);
    }
  }
}

function makeExclusionSet(model: StudioClothXpbdCompiledModelV2): Set<string> {
  const exclusions = new Set<string>();
  for (let index = 0; index < model.selfCollisionExclusionPairs.length; index += 2) {
    exclusions.add(pairKey(
      model.selfCollisionExclusionPairs[index]!,
      model.selfCollisionExclusionPairs[index + 1]!,
    ));
  }
  return exclusions;
}

function buildSelfCollisionPairs(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  availableWorkUnits: number,
  solverIterations: number,
): SelfCollisionPairsResult | StudioClothXpbdFailureV2 {
  if (!model.selfCollisionEnabled) {
    return {
      ok: true,
      pairs: new Uint32Array(),
      candidateCheckCount: 0,
      broadphaseWorkUnits: 0,
    };
  }
  let candidateCheckCount = 0;
  let broadphaseWorkUnits = model.selfCollisionExclusionPairs.length / 2;
  let reservedSolverWorkUnits = 0;
  const budgetFailure = (): StudioClothXpbdFailureV2 => failure(
    "budget-exceeded",
    `Self-collision work exceeds the remaining ${availableWorkUnits} work units ` +
      `(candidate checks: ${candidateCheckCount}).`,
  );
  if (broadphaseWorkUnits > availableWorkUnits) return budgetFailure();

  let maximumRadius = 0;
  for (let index = 0; index < model.particleRadii.length; index += 1) {
    maximumRadius = Math.max(maximumRadius, model.particleRadii[index]!);
  }
  const cellSize = maximumRadius * 2;
  const cells = new Map<string, number[]>();
  const cellCoordinates = new Float64Array(model.particleCount * 3);
  for (let particle = 0; particle < model.particleCount; particle += 1) {
    const offset = particle * 3;
    const x = Math.floor(positions[offset]! / cellSize);
    const y = Math.floor(positions[offset + 1]! / cellSize);
    const z = Math.floor(positions[offset + 2]! / cellSize);
    cellCoordinates[offset] = x;
    cellCoordinates[offset + 1] = y;
    cellCoordinates[offset + 2] = z;
    broadphaseWorkUnits += 1;
    if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
      return budgetFailure();
    }
    const key = `${x},${y},${z}`;
    const cell = cells.get(key);
    if (cell) cell.push(particle);
    else cells.set(key, [particle]);
  }

  const exclusions = makeExclusionSet(model);
  const pairList: number[] = [];
  for (let a = 0; a < model.particleCount; a += 1) {
    const a3 = a * 3;
    const cellX = cellCoordinates[a3]!;
    const cellY = cellCoordinates[a3 + 1]!;
    const cellZ = cellCoordinates[a3 + 2]!;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          broadphaseWorkUnits += 1;
          if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
            return budgetFailure();
          }
          const cell = cells.get(`${cellX + dx},${cellY + dy},${cellZ + dz}`);
          if (!cell) continue;
          for (const b of cell) {
            candidateCheckCount += 1;
            broadphaseWorkUnits += 1;
            if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
              return budgetFailure();
            }
            if (b <= a) continue;
            broadphaseWorkUnits += 1;
            if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
              return budgetFailure();
            }
            if (exclusions.has(pairKey(a, b))) continue;
            const b3 = b * 3;
            const separationX = positions[b3]! - positions[a3]!;
            const separationY = positions[b3 + 1]! - positions[a3 + 1]!;
            const separationZ = positions[b3 + 2]! - positions[a3 + 2]!;
            const minimumDistance = model.particleRadii[a]! + model.particleRadii[b]!;
            if (
              separationX * separationX +
              separationY * separationY +
              separationZ * separationZ >= minimumDistance * minimumDistance
            ) {
              continue;
            }
            pairList.push(a, b);
            reservedSolverWorkUnits += solverIterations;
            if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
              return budgetFailure();
            }
            if (pairList.length / 2 > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSelfCollisionPairs) {
              return failure(
                "budget-exceeded",
                `Self-collision pair count exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSelfCollisionPairs}.`,
              );
            }
          }
        }
      }
    }
  }
  const pairCount = pairList.length / 2;
  const pairOrderingWorkUnits = pairCount > 1
    ? pairCount * (1 + Math.ceil(Math.log2(pairCount)))
    : pairCount;
  broadphaseWorkUnits += pairOrderingWorkUnits;
  if (broadphaseWorkUnits + reservedSolverWorkUnits > availableWorkUnits) {
    return budgetFailure();
  }
  const pairs = Array.from({ length: pairCount }, (_, index) => [
    pairList[index * 2]!,
    pairList[index * 2 + 1]!,
  ] as const).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return {
    ok: true,
    pairs: Uint32Array.from(pairs.flat()),
    candidateCheckCount,
    broadphaseWorkUnits,
  };
}

function solveSelfCollisionPairs(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  kinematicMask: Uint8Array,
  pairs: Uint32Array,
  lambdas: Float32Array,
): void {
  const inverseStepSquared =
    1 / (STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS * STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS);
  const alphaTilde = model.selfCollisionCompliance * inverseStepSquared;
  for (let pairIndex = 0; pairIndex < pairs.length / 2; pairIndex += 1) {
    const a = pairs[pairIndex * 2]!;
    const b = pairs[pairIndex * 2 + 1]!;
    const a3 = a * 3;
    const b3 = b * 3;
    const dx = positions[b3]! - positions[a3]!;
    const dy = positions[b3 + 1]! - positions[a3 + 1]!;
    const dz = positions[b3 + 2]! - positions[a3 + 2]!;
    const distance = Math.hypot(dx, dy, dz);
    const minimumDistance = model.particleRadii[a]! + model.particleRadii[b]!;
    const constraintError = distance - minimumDistance;
    if (constraintError >= 0 && lambdas[pairIndex] === 0) continue;
    const normal = distance > MIN_DISTANCE
      ? [dx / distance, dy / distance, dz / distance] as const
      : stablePairNormal(a, b);
    const weightA = effectiveInverseMass(model, kinematicMask, a);
    const weightB = effectiveInverseMass(model, kinematicMask, b);
    if (weightA + weightB === 0) continue;
    const unclamped =
      (-constraintError - alphaTilde * lambdas[pairIndex]!) /
      (weightA + weightB + alphaTilde);
    const nextLambda = Math.max(0, lambdas[pairIndex]! + unclamped);
    const deltaLambda = nextLambda - lambdas[pairIndex]!;
    lambdas[pairIndex] = f32(nextLambda);
    if (weightA > 0) {
      positions[a3] = f32(positions[a3]! - weightA * normal[0] * deltaLambda);
      positions[a3 + 1] = f32(positions[a3 + 1]! - weightA * normal[1] * deltaLambda);
      positions[a3 + 2] = f32(positions[a3 + 2]! - weightA * normal[2] * deltaLambda);
    }
    if (weightB > 0) {
      positions[b3] = f32(positions[b3]! + weightB * normal[0] * deltaLambda);
      positions[b3 + 1] = f32(positions[b3 + 1]! + weightB * normal[1] * deltaLambda);
      positions[b3 + 2] = f32(positions[b3 + 2]! + weightB * normal[2] * deltaLambda);
    }
  }
}

function closestPointOnSegment(
  px: number,
  py: number,
  pz: number,
  head: StudioClothXpbdVec3V2,
  tail: StudioClothXpbdVec3V2,
): readonly [number, number, number, number] {
  const sx = tail[0] - head[0];
  const sy = tail[1] - head[1];
  const sz = tail[2] - head[2];
  const lengthSquared = sx * sx + sy * sy + sz * sz;
  const projection = lengthSquared > MIN_DISTANCE
    ? Math.max(
      0,
      Math.min(1, ((px - head[0]) * sx + (py - head[1]) * sy + (pz - head[2]) * sz) / lengthSquared),
    )
    : 0;
  return [
    head[0] + sx * projection,
    head[1] + sy * projection,
    head[2] + sz * projection,
    projection,
  ];
}

function interpolateVec3(
  previous: StudioClothXpbdVec3V2,
  current: StudioClothXpbdVec3V2,
  alpha: number,
): StudioClothXpbdVec3V2 {
  return [
    previous[0] + (current[0] - previous[0]) * alpha,
    previous[1] + (current[1] - previous[1]) * alpha,
    previous[2] + (current[2] - previous[2]) * alpha,
  ];
}

function capsuleContactAtParticle(
  positions: Float32Array,
  particle: number,
  particleRadius: number,
  capsule: StudioClothXpbdCapsuleFrameV2,
  capsuleIndex: number,
): CapsuleContact {
  const offset = particle * 3;
  const px = positions[offset]!;
  const py = positions[offset + 1]!;
  const pz = positions[offset + 2]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDx = 0;
  let bestDy = 0;
  let bestDz = 0;
  let bestProjection = 0;
  for (const alpha of [0, 0.5, 1] as const) {
    const head = interpolateVec3(capsule.previousHead, capsule.currentHead, alpha);
    const tail = interpolateVec3(capsule.previousTail, capsule.currentTail, alpha);
    const closest = closestPointOnSegment(px, py, pz, head, tail);
    const dx = px - closest[0];
    const dy = py - closest[1];
    const dz = pz - closest[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDx = dx;
      bestDy = dy;
      bestDz = dz;
      bestProjection = closest[3];
    }
  }
  const previousClosestX =
    capsule.previousHead[0] +
    (capsule.previousTail[0] - capsule.previousHead[0]) * bestProjection;
  const previousClosestY =
    capsule.previousHead[1] +
    (capsule.previousTail[1] - capsule.previousHead[1]) * bestProjection;
  const previousClosestZ =
    capsule.previousHead[2] +
    (capsule.previousTail[2] - capsule.previousHead[2]) * bestProjection;
  const currentClosestX =
    capsule.currentHead[0] +
    (capsule.currentTail[0] - capsule.currentHead[0]) * bestProjection;
  const currentClosestY =
    capsule.currentHead[1] +
    (capsule.currentTail[1] - capsule.currentHead[1]) * bestProjection;
  const currentClosestZ =
    capsule.currentHead[2] +
    (capsule.currentTail[2] - capsule.currentHead[2]) * bestProjection;
  const colliderVx =
    (currentClosestX - previousClosestX) / STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS;
  const colliderVy =
    (currentClosestY - previousClosestY) / STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS;
  const colliderVz =
    (currentClosestZ - previousClosestZ) / STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS;
  const minimumDistance = capsule.radius + particleRadius;
  if (bestDistance > MIN_DISTANCE) {
    return {
      penetration: minimumDistance - bestDistance,
      nx: bestDx / bestDistance,
      ny: bestDy / bestDistance,
      nz: bestDz / bestDistance,
      colliderVx,
      colliderVy,
      colliderVz,
    };
  }
  const fallback = stablePairNormal(particle, capsuleIndex + 1_000_000);
  return {
    penetration: minimumDistance,
    nx: fallback[0],
    ny: fallback[1],
    nz: fallback[2],
    colliderVx,
    colliderVy,
    colliderVz,
  };
}

function solveCapsules(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  kinematicMask: Uint8Array,
  capsules: readonly StudioClothXpbdCapsuleFrameV2[],
  lambdas: Float32Array,
  contactMask: Uint8Array,
  selectedContacts: Array<SelectedCapsuleContact | undefined>,
): void {
  const inverseStepSquared =
    1 / (STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS * STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS);
  for (let particle = 0; particle < model.particleCount; particle += 1) {
    const weight = effectiveInverseMass(model, kinematicMask, particle);
    if (weight === 0) continue;
    for (let capsuleIndex = 0; capsuleIndex < capsules.length; capsuleIndex += 1) {
      const capsule = capsules[capsuleIndex]!;
      const lambdaIndex = particle * capsules.length + capsuleIndex;
      const contact = capsuleContactAtParticle(
        positions,
        particle,
        model.particleRadii[particle]!,
        capsule,
        capsuleIndex,
      );
      if (contact.penetration <= 0 && lambdas[lambdaIndex] === 0) continue;
      const alphaTilde = (capsule.compliance ?? 0) * inverseStepSquared;
      const constraintError = -contact.penetration;
      const unclamped =
        (-constraintError - alphaTilde * lambdas[lambdaIndex]!) /
        (weight + alphaTilde);
      const nextLambda = Math.max(0, lambdas[lambdaIndex]! + unclamped);
      const deltaLambda = nextLambda - lambdas[lambdaIndex]!;
      lambdas[lambdaIndex] = f32(nextLambda);
      const offset = particle * 3;
      positions[offset] = f32(positions[offset]! + weight * contact.nx * deltaLambda);
      positions[offset + 1] = f32(positions[offset + 1]! + weight * contact.ny * deltaLambda);
      positions[offset + 2] = f32(positions[offset + 2]! + weight * contact.nz * deltaLambda);
      if (contact.penetration > 0) {
        contactMask[lambdaIndex] = 1;
        const selected = selectedContacts[particle];
        if (
          selected === undefined ||
          contact.penetration > selected.penetration ||
          (contact.penetration === selected.penetration && capsuleIndex < selected.capsuleIndex)
        ) {
          selectedContacts[particle] = {
            capsuleIndex,
            penetration: f32(contact.penetration),
            nx: f32(contact.nx),
            ny: f32(contact.ny),
            nz: f32(contact.nz),
            friction: f32(capsule.friction ?? 0),
            colliderVx: f32(contact.colliderVx),
            colliderVy: f32(contact.colliderVy),
            colliderVz: f32(contact.colliderVz),
          };
        }
      }
    }
  }
}

function lambdaL1(values: Float32Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += Math.abs(values[index]!);
  }
  return f32(total);
}

function maximumDistanceError(
  positions: Float32Array,
  pairs: Uint32Array,
  restLengths: Float32Array,
): number {
  let maximum = 0;
  for (let constraint = 0; constraint < restLengths.length; constraint += 1) {
    maximum = Math.max(
      maximum,
      Math.abs(
        distanceAt(positions, pairs[constraint * 2]!, pairs[constraint * 2 + 1]!) -
        restLengths[constraint]!,
      ),
    );
  }
  return f32(maximum);
}

function maximumSelfCollisionPenetration(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  pairs: Uint32Array,
): number {
  let maximum = 0;
  for (let pairIndex = 0; pairIndex < pairs.length / 2; pairIndex += 1) {
    const a = pairs[pairIndex * 2]!;
    const b = pairs[pairIndex * 2 + 1]!;
    maximum = Math.max(
      maximum,
      model.particleRadii[a]! + model.particleRadii[b]! - distanceAt(positions, a, b),
    );
  }
  return f32(Math.max(0, maximum));
}

function maximumCapsulePenetration(
  model: StudioClothXpbdCompiledModelV2,
  positions: Float32Array,
  capsules: readonly StudioClothXpbdCapsuleFrameV2[],
  kinematicMask: Uint8Array,
): number {
  let maximum = 0;
  for (let particle = 0; particle < model.particleCount; particle += 1) {
    if (effectiveInverseMass(model, kinematicMask, particle) === 0) continue;
    for (let capsuleIndex = 0; capsuleIndex < capsules.length; capsuleIndex += 1) {
      maximum = Math.max(
        maximum,
        capsuleContactAtParticle(
          positions,
          particle,
          model.particleRadii[particle]!,
          capsules[capsuleIndex]!,
          capsuleIndex,
        ).penetration,
      );
    }
  }
  return f32(Math.max(0, maximum));
}

function countContacts(contactMask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < contactMask.length; index += 1) {
    count += contactMask[index]!;
  }
  return count;
}

function receiptHash(
  receipt: Omit<StudioClothXpbdStepReceiptV2, "receiptSha256">,
): string {
  const diagnostics = receipt.diagnostics;
  return hashText([
    `revision=${receipt.revision}`,
    `complete=${receipt.complete ? 1 : 0}`,
    `fixedStep=${receipt.fixedStepSeconds}`,
    `determinism=${receipt.determinismScope}`,
    `bend=${receipt.bendModel}`,
    `capsulePose=${receipt.capsulePoseModel}`,
    `epoch=${receipt.topologyEpoch}`,
    `topology=${receipt.topologySha256}`,
    `step=${receipt.stepIndexBefore}:${receipt.stepIndexAfter}`,
    `iterations=${receipt.solverIterations}`,
    `constraints=${receipt.structuralConstraintCount}:${receipt.bendConstraintCount}:${receipt.seamConstraintCount}`,
    `contacts=${receipt.selfCollisionPairCount}:${receipt.capsuleContactCount}`,
    `selfCollisionBroadphase=${receipt.selfCollisionCandidateCheckCount}:${receipt.selfCollisionBroadphaseWorkUnits}`,
    `input=${receipt.inputStateSha256}`,
    `pins=${receipt.pinFrameSha256}`,
    `capsules=${receipt.capsuleFrameSha256}`,
    `positions=${receipt.outputPositionsSha256}`,
    `velocities=${receipt.outputVelocitiesSha256}`,
    `errors=${diagnostics.maxStructuralError}:${diagnostics.maxBendError}:${diagnostics.maxSeamError}:${diagnostics.maxCapsulePenetration}:${diagnostics.maxSelfCollisionPenetration}`,
    `lambdas=${diagnostics.structuralLambdaL1}:${diagnostics.bendLambdaL1}:${diagnostics.seamLambdaL1}:${diagnostics.capsuleLambdaL1}:${diagnostics.selfCollisionLambdaL1}`,
    `nonFinite=${diagnostics.nonFiniteCount}`,
  ].join("|"));
}

function validateOutput(values: Float32Array, label: string): string | undefined {
  return validateFiniteArray(
    values,
    label,
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
  );
}

function stepStudioClothXpbdV2Unchecked(
  runtime: StudioClothXpbdRuntimeV2,
  input: StudioClothXpbdStepInputV2,
): StudioClothXpbdStepResultV2 {
  const model = runtime.model;
  if (!Number.isSafeInteger(input.expectedStepIndex) || input.expectedStepIndex < 0) {
    return failure("invalid-input", "expectedStepIndex must be a non-negative safe integer.");
  }
  if (input.expectedStepIndex !== runtime.stepIndex) {
    return failure(
      "stale-step",
      `Expected step ${input.expectedStepIndex}, but runtime is at ${runtime.stepIndex}.`,
    );
  }
  if (
    input.expectedTopologySha256 !== undefined &&
    input.expectedTopologySha256 !== model.topologySha256
  ) {
    return failure("topology-mismatch", "The requested topology hash does not match the runtime.");
  }
  if (input.kinematicPins !== undefined && !Array.isArray(input.kinematicPins)) {
    return failure("invalid-input", "kinematicPins must be an array.");
  }
  if (input.capsules !== undefined && !Array.isArray(input.capsules)) {
    return failure("invalid-input", "capsules must be an array.");
  }
  if (topologyHash(model) !== model.topologySha256) {
    return failure("topology-mismatch", "The compiled model arrays no longer match their topology hash.");
  }
  if (
    runtime.positions.length !== model.particleCount * 3 ||
    runtime.previousPositions.length !== model.particleCount * 3 ||
    runtime.velocities.length !== model.particleCount * 3
  ) {
    return failure("invalid-input", "Runtime typed-array lengths do not match the compiled model.");
  }

  const iterations = input.solverIterations ?? model.solverIterations;
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations
  ) {
    return failure(
      "invalid-input",
      `solverIterations must be an integer in [1, ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations}].`,
    );
  }
  const normalizedPinsResult = normalizeKinematicPins(model, input.kinematicPins ?? []);
  if (!normalizedPinsResult.ok) return normalizedPinsResult;
  const pins = normalizedPinsResult.pins;
  const normalizedCapsulesResult = normalizeCapsules(input.capsules ?? []);
  if (!normalizedCapsulesResult.ok) return normalizedCapsulesResult;
  const capsules = normalizedCapsulesResult.capsules;
  const baseConstraintCount =
    model.structuralRestLengths.length +
    model.bendRestLengths.length +
    model.seamRestLengths.length;
  const baseWorkUnits =
    (baseConstraintCount + model.particleCount * capsules.length) * iterations;
  if (baseWorkUnits > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxWorkUnitsPerStep) {
    return failure(
      "budget-exceeded",
      `Base solver work ${baseWorkUnits} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxWorkUnitsPerStep}.`,
    );
  }

  const oldPositions = new Float32Array(runtime.positions);
  const positions = new Float32Array(runtime.positions);
  const velocities = new Float32Array(runtime.velocities);
  const inputStateSha256 = hashText(
    `${hashFloat32(oldPositions)}|${hashFloat32(velocities)}|step=${runtime.stepIndex}`,
  );
  const kinematicMask = new Uint8Array(model.particleCount);
  for (const pin of pins) kinematicMask[pin.particle] = 1;

  const stepSeconds = STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS;
  const damping = Math.exp(-model.dampingPerSecond * stepSeconds);
  for (let particle = 0; particle < model.particleCount; particle += 1) {
    if (model.inverseMasses[particle] === 0 || kinematicMask[particle] !== 0) continue;
    const offset = particle * 3;
    velocities[offset] = f32((velocities[offset]! + model.gravity[0] * stepSeconds) * damping);
    velocities[offset + 1] = f32((velocities[offset + 1]! + model.gravity[1] * stepSeconds) * damping);
    velocities[offset + 2] = f32((velocities[offset + 2]! + model.gravity[2] * stepSeconds) * damping);
    positions[offset] = f32(positions[offset]! + velocities[offset]! * stepSeconds);
    positions[offset + 1] = f32(positions[offset + 1]! + velocities[offset + 1]! * stepSeconds);
    positions[offset + 2] = f32(positions[offset + 2]! + velocities[offset + 2]! * stepSeconds);
  }
  restoreFixedAndKinematicPositions(model, positions, pins);

  const selfPairsResult = buildSelfCollisionPairs(
    model,
    positions,
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxWorkUnitsPerStep - baseWorkUnits,
    iterations,
  );
  if (!selfPairsResult.ok) return selfPairsResult;
  const selfPairs = selfPairsResult.pairs;
  const totalWorkUnits =
    baseWorkUnits +
    selfPairsResult.broadphaseWorkUnits +
    selfPairs.length / 2 * iterations;
  if (totalWorkUnits > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxWorkUnitsPerStep) {
    return failure(
      "budget-exceeded",
      `Total solver work ${totalWorkUnits} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxWorkUnitsPerStep}.`,
    );
  }

  const structuralLambdas = new Float32Array(model.structuralRestLengths.length);
  const bendLambdas = new Float32Array(model.bendRestLengths.length);
  const seamLambdas = new Float32Array(model.seamRestLengths.length);
  const selfCollisionLambdas = new Float32Array(selfPairs.length / 2);
  const capsuleLambdas = new Float32Array(model.particleCount * capsules.length);
  const capsuleContactMask = new Uint8Array(capsuleLambdas.length);
  const selectedCapsuleContacts = new Array<SelectedCapsuleContact | undefined>(
    model.particleCount,
  );

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    solveDistanceConstraints(
      positions,
      model.inverseMasses,
      kinematicMask,
      model.structuralPairs,
      model.structuralRestLengths,
      model.structuralCompliance,
      structuralLambdas,
    );
    solveDistanceConstraints(
      positions,
      model.inverseMasses,
      kinematicMask,
      model.bendPairs,
      model.bendRestLengths,
      model.bendCompliance,
      bendLambdas,
    );
    solveDistanceConstraints(
      positions,
      model.inverseMasses,
      kinematicMask,
      model.seamPairs,
      model.seamRestLengths,
      model.seamCompliances,
      seamLambdas,
    );
    solveCapsules(
      model,
      positions,
      kinematicMask,
      capsules,
      capsuleLambdas,
      capsuleContactMask,
      selectedCapsuleContacts,
    );
    solveSelfCollisionPairs(
      model,
      positions,
      kinematicMask,
      selfPairs,
      selfCollisionLambdas,
    );
    restoreFixedAndKinematicPositions(model, positions, pins);
  }

  for (let particle = 0; particle < model.particleCount; particle += 1) {
    const offset = particle * 3;
    if (model.inverseMasses[particle] === 0) {
      velocities[offset] = 0;
      velocities[offset + 1] = 0;
      velocities[offset + 2] = 0;
      continue;
    }
    const pin = kinematicMask[particle] !== 0
      ? pins.find((candidate) => candidate.particle === particle)
      : undefined;
    if (pin) {
      velocities[offset] = f32((pin.current[0] - pin.previous[0]) / stepSeconds);
      velocities[offset + 1] = f32((pin.current[1] - pin.previous[1]) / stepSeconds);
      velocities[offset + 2] = f32((pin.current[2] - pin.previous[2]) / stepSeconds);
      continue;
    }
    let vx = (positions[offset]! - oldPositions[offset]!) / stepSeconds;
    let vy = (positions[offset + 1]! - oldPositions[offset + 1]!) / stepSeconds;
    let vz = (positions[offset + 2]! - oldPositions[offset + 2]!) / stepSeconds;
    const selectedContact = selectedCapsuleContacts[particle];
    if (selectedContact !== undefined && selectedContact.friction > 0) {
      const nx = selectedContact.nx;
      const ny = selectedContact.ny;
      const nz = selectedContact.nz;
      let relativeVx = vx - selectedContact.colliderVx;
      let relativeVy = vy - selectedContact.colliderVy;
      let relativeVz = vz - selectedContact.colliderVz;
      const normalVelocity = relativeVx * nx + relativeVy * ny + relativeVz * nz;
      if (normalVelocity < 0) {
        relativeVx -= normalVelocity * nx;
        relativeVy -= normalVelocity * ny;
        relativeVz -= normalVelocity * nz;
      }
      const adjustedNormalVelocity =
        relativeVx * nx + relativeVy * ny + relativeVz * nz;
      const tangentX = relativeVx - adjustedNormalVelocity * nx;
      const tangentY = relativeVy - adjustedNormalVelocity * ny;
      const tangentZ = relativeVz - adjustedNormalVelocity * nz;
      relativeVx -= tangentX * selectedContact.friction;
      relativeVy -= tangentY * selectedContact.friction;
      relativeVz -= tangentZ * selectedContact.friction;
      vx = relativeVx + selectedContact.colliderVx;
      vy = relativeVy + selectedContact.colliderVy;
      vz = relativeVz + selectedContact.colliderVz;
    }
    velocities[offset] = f32(vx);
    velocities[offset + 1] = f32(vy);
    velocities[offset + 2] = f32(vz);
  }

  const outputPositionError = validateOutput(positions, "output.positions");
  if (outputPositionError) return failure("numerical-failure", outputPositionError);
  const outputVelocityError = validateOutput(velocities, "output.velocities");
  if (outputVelocityError) return failure("numerical-failure", outputVelocityError);

  const diagnostics: StudioClothXpbdStepDiagnosticsV2 = Object.freeze({
    maxStructuralError: maximumDistanceError(
      positions,
      model.structuralPairs,
      model.structuralRestLengths,
    ),
    maxBendError: maximumDistanceError(positions, model.bendPairs, model.bendRestLengths),
    maxSeamError: maximumDistanceError(positions, model.seamPairs, model.seamRestLengths),
    maxCapsulePenetration: maximumCapsulePenetration(
      model,
      positions,
      capsules,
      kinematicMask,
    ),
    maxSelfCollisionPenetration: maximumSelfCollisionPenetration(model, positions, selfPairs),
    structuralLambdaL1: lambdaL1(structuralLambdas),
    bendLambdaL1: lambdaL1(bendLambdas),
    seamLambdaL1: lambdaL1(seamLambdas),
    capsuleLambdaL1: lambdaL1(capsuleLambdas),
    selfCollisionLambdaL1: lambdaL1(selfCollisionLambdas),
    nonFiniteCount: 0,
  });
  const receiptWithoutHash: Omit<StudioClothXpbdStepReceiptV2, "receiptSha256"> = {
    revision: STUDIO_CLOTH_XPBD_KERNEL_V2_REVISION,
    complete: true,
    fixedStepSeconds: STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS,
    determinismScope: STUDIO_CLOTH_XPBD_DETERMINISM_SCOPE,
    bendModel: STUDIO_CLOTH_XPBD_BEND_MODEL,
    capsulePoseModel: STUDIO_CLOTH_XPBD_CAPSULE_POSE_MODEL,
    topologyEpoch: model.topologyEpoch,
    topologySha256: model.topologySha256,
    stepIndexBefore: runtime.stepIndex,
    stepIndexAfter: runtime.stepIndex + 1,
    solverIterations: iterations,
    structuralConstraintCount: model.structuralRestLengths.length,
    bendConstraintCount: model.bendRestLengths.length,
    seamConstraintCount: model.seamRestLengths.length,
    selfCollisionPairCount: selfPairs.length / 2,
    selfCollisionCandidateCheckCount: selfPairsResult.candidateCheckCount,
    selfCollisionBroadphaseWorkUnits: selfPairsResult.broadphaseWorkUnits,
    capsuleContactCount: countContacts(capsuleContactMask),
    inputStateSha256,
    pinFrameSha256: pinFrameHash(pins),
    capsuleFrameSha256: capsuleFrameHash(capsules),
    outputPositionsSha256: hashFloat32(positions),
    outputVelocitiesSha256: hashFloat32(velocities),
    diagnostics,
  };
  const receipt: StudioClothXpbdStepReceiptV2 = Object.freeze({
    ...receiptWithoutHash,
    receiptSha256: receiptHash(receiptWithoutHash),
  });

  runtime.previousPositions.set(oldPositions);
  runtime.positions.set(positions);
  runtime.velocities.set(velocities);
  runtime.stepIndex += 1;
  runtime.lastReceipt = receipt;
  return { ok: true, receipt };
}

export function stepStudioClothXpbdV2(
  runtime: StudioClothXpbdRuntimeV2,
  input: StudioClothXpbdStepInputV2,
): StudioClothXpbdStepResultV2 {
  try {
    if (!isRecordObject(runtime)) {
      return failure("invalid-input", "Runtime must be an object.");
    }
    if (!isRecordObject(input)) {
      return failure("invalid-input", "Step input must be an object.");
    }
    return stepStudioClothXpbdV2Unchecked(runtime, input);
  } catch {
    return failure("invalid-input", "Step input could not be validated safely.");
  }
}
