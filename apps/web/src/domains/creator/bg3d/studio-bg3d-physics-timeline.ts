import {
  normalizeStudioBg3dPhysicsWorld,
  type StudioBg3dPhysicsWorld,
} from "./studio-bg3d-physics";

import type {
  StudioBg3dQuaternion,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_PHYSICS_TIMELINE_HZ = 60 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS =
  1 / STUDIO_BG3D_PHYSICS_TIMELINE_HZ;
export const STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE = 7 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_MIN_DURATION_SECONDS = 1 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DURATION_SECONDS = 8 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_MAX_BODIES = 256 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DYNAMIC_BODIES = 32 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_MAX_GRAVITY = 100 as const;
export const STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION = 1 as const;

const MAX_WORLD_COORDINATE = 10_000;
const MAX_RESULT_COORDINATE = 100_000;
const MAX_QUATERNION_COMPONENT = 1_000_000;
const MAX_CONVEX_HULL_VERTICES = 4_096;
const MAX_TRIANGLE_MESH_TRIANGLES = 50_000;
const MAX_GEOMETRY_SCALARS = 1_000_000;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;

const DEFAULT_GRAVITY = Object.freeze([
  0,
  -9.81,
  0,
]) as StudioBg3dVec3;

export interface StudioBg3dPhysicsInitialPose {
  readonly nodeId: string;
  readonly position: StudioBg3dVec3;
  readonly rotation: StudioBg3dQuaternion;
}

export interface StudioBg3dPhysicsGround {
  readonly y: number;
  readonly friction: number;
  readonly restitution: number;
}

export interface StudioBg3dPhysicsConvexHullGeometry {
  readonly nodeId: string;
  readonly kind: "convex-hull";
  /** Flat xyz triples in collider-local coordinates. */
  readonly vertices: readonly number[];
}

export interface StudioBg3dPhysicsTriangleMeshGeometry {
  readonly nodeId: string;
  readonly kind: "triangle-mesh";
  /** Flat xyz triples in collider-local coordinates. */
  readonly vertices: readonly number[];
  /** Flat unsigned triangle-index triples. */
  readonly indices: readonly number[];
}

export type StudioBg3dPhysicsColliderGeometry =
  | StudioBg3dPhysicsConvexHullGeometry
  | StudioBg3dPhysicsTriangleMeshGeometry;

export interface StudioBg3dPhysicsTimelineInput {
  readonly world: StudioBg3dPhysicsWorld;
  readonly initialPoses: readonly StudioBg3dPhysicsInitialPose[];
  readonly durationSeconds: number;
  readonly gravity?: StudioBg3dVec3;
  readonly ground?: StudioBg3dPhysicsGround | null;
  readonly geometries?: readonly StudioBg3dPhysicsColliderGeometry[];
}

export interface NormalizedStudioBg3dPhysicsTimelineInput {
  readonly world: StudioBg3dPhysicsWorld;
  /** Poses are in the same stable order as `world.bodies`. */
  readonly initialPoses: readonly StudioBg3dPhysicsInitialPose[];
  /** A canonical multiple of 1/60 second. */
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly gravity: StudioBg3dVec3;
  readonly ground: StudioBg3dPhysicsGround | null;
  readonly geometries: readonly StudioBg3dPhysicsColliderGeometry[];
  readonly dynamicNodeIds: readonly string[];
}

export interface StudioBg3dPhysicsTimelineResult {
  readonly nodeIds: readonly string[];
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly stepSeconds: number;
  readonly transforms: Float32Array;
}

export interface StudioBg3dPhysicsTimelineSample {
  readonly nodeId: string;
  readonly position: StudioBg3dVec3;
  readonly rotation: StudioBg3dQuaternion;
}

export interface StudioBg3dPhysicsTimelineWorkerRunMessage {
  readonly version: typeof STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION;
  readonly kind: "run";
  readonly requestId: number;
  readonly input: NormalizedStudioBg3dPhysicsTimelineInput;
}

export interface StudioBg3dPhysicsTimelineWorkerResultMessage {
  readonly version: typeof STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly nodeIds: readonly string[];
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly stepSeconds: number;
  readonly transformsBuffer: ArrayBuffer;
}

export type StudioBg3dPhysicsTimelineWorkerFailureCode =
  | "invalid-request"
  | "simulation-failed";

export interface StudioBg3dPhysicsTimelineWorkerFailureMessage {
  readonly version: typeof STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION;
  readonly kind: "failure";
  readonly requestId: number;
  readonly code: StudioBg3dPhysicsTimelineWorkerFailureCode;
}

export type StudioBg3dPhysicsTimelineWorkerResponseMessage =
  | StudioBg3dPhysicsTimelineWorkerResultMessage
  | StudioBg3dPhysicsTimelineWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sequenceToNumbers(value: unknown): number[] | null {
  if (Array.isArray(value)) return [...value] as number[];
  if (value instanceof Float32Array || value instanceof Uint32Array) return Array.from(value);
  return null;
}

function freezeVec3(values: readonly number[]): StudioBg3dVec3 {
  return Object.freeze([values[0], values[1], values[2]]) as StudioBg3dVec3;
}

function freezeQuaternion(values: readonly number[]): StudioBg3dQuaternion {
  return Object.freeze([values[0], values[1], values[2], values[3]]) as StudioBg3dQuaternion;
}

function normalizeVec3(
  value: unknown,
  minimum: number,
  maximum: number,
): StudioBg3dVec3 | null {
  const values = sequenceToNumbers(value);
  if (
    !values || values.length !== 3 ||
    values.some((component) => !finiteInRange(component, minimum, maximum))
  ) return null;
  return freezeVec3(values);
}

function normalizeQuaternion(value: unknown): StudioBg3dQuaternion | null {
  const values = sequenceToNumbers(value);
  if (
    !values || values.length !== 4 ||
    values.some((component) =>
      !finiteInRange(component, -MAX_QUATERNION_COMPONENT, MAX_QUATERNION_COMPONENT)
    )
  ) return null;
  const length = Math.hypot(values[0], values[1], values[2], values[3]);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  return freezeQuaternion(values.map((component) => component / length));
}

function normalizeInitialPoses(
  value: unknown,
  world: StudioBg3dPhysicsWorld,
): readonly StudioBg3dPhysicsInitialPose[] | null {
  if (!Array.isArray(value) || value.length !== world.bodies.length) return null;
  const bodyNodeIds = new Set(world.bodies.map((body) => body.nodeId));
  const poseByNodeId = new Map<string, StudioBg3dPhysicsInitialPose>();
  for (const rawPose of value) {
    if (!isRecord(rawPose) || typeof rawPose.nodeId !== "string") return null;
    if (
      !NODE_ID_PATTERN.test(rawPose.nodeId) ||
      !bodyNodeIds.has(rawPose.nodeId) ||
      poseByNodeId.has(rawPose.nodeId)
    ) return null;
    const position = normalizeVec3(
      rawPose.position,
      -MAX_WORLD_COORDINATE,
      MAX_WORLD_COORDINATE,
    );
    const rotation = normalizeQuaternion(rawPose.rotation);
    if (!position || !rotation) return null;
    poseByNodeId.set(rawPose.nodeId, Object.freeze({
      nodeId: rawPose.nodeId,
      position,
      rotation,
    }));
  }
  const poses = world.bodies.map((body) => poseByNodeId.get(body.nodeId));
  if (poses.some((pose) => !pose)) return null;
  return Object.freeze(poses as StudioBg3dPhysicsInitialPose[]);
}

function normalizeDuration(value: unknown): { durationSeconds: number; frameCount: number } | null {
  if (!finiteInRange(
    value,
    STUDIO_BG3D_PHYSICS_TIMELINE_MIN_DURATION_SECONDS,
    STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DURATION_SECONDS,
  )) return null;
  const stepCount = Math.round(value * STUDIO_BG3D_PHYSICS_TIMELINE_HZ);
  const durationSeconds = stepCount / STUDIO_BG3D_PHYSICS_TIMELINE_HZ;
  return {
    durationSeconds,
    frameCount: stepCount + 1,
  };
}

function normalizeGround(value: unknown): StudioBg3dPhysicsGround | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    !finiteInRange(value.y, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE) ||
    !finiteInRange(value.friction, 0, 2) ||
    !finiteInRange(value.restitution, 0, 1)
  ) return undefined;
  return Object.freeze({
    y: value.y,
    friction: value.friction,
    restitution: value.restitution,
  });
}

function validVertexScalars(values: readonly number[]): boolean {
  return values.every((component) =>
    finiteInRange(component, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE)
  );
}

function normalizeGeometries(
  value: unknown,
  world: StudioBg3dPhysicsWorld,
): readonly StudioBg3dPhysicsColliderGeometry[] | null {
  const rawGeometries = value === undefined ? [] : value;
  if (!Array.isArray(rawGeometries) || rawGeometries.length > world.bodies.length) return null;
  const bodyByNodeId = new Map(world.bodies.map((body) => [body.nodeId, body] as const));
  const geometryByNodeId = new Map<string, StudioBg3dPhysicsColliderGeometry>();
  let scalarCount = 0;

  for (const rawGeometry of rawGeometries) {
    if (
      !isRecord(rawGeometry) ||
      typeof rawGeometry.nodeId !== "string" ||
      !NODE_ID_PATTERN.test(rawGeometry.nodeId) ||
      geometryByNodeId.has(rawGeometry.nodeId)
    ) return null;
    const body = bodyByNodeId.get(rawGeometry.nodeId);
    if (!body || body.collider.kind !== rawGeometry.kind) return null;
    const vertices = sequenceToNumbers(rawGeometry.vertices);
    if (!vertices || vertices.length % 3 !== 0 || !validVertexScalars(vertices)) return null;

    if (rawGeometry.kind === "convex-hull" && body.collider.kind === "convex-hull") {
      const vertexCount = vertices.length / 3;
      if (
        vertexCount !== body.collider.vertexCount ||
        vertexCount < 4 ||
        vertexCount > MAX_CONVEX_HULL_VERTICES
      ) return null;
      scalarCount += vertices.length;
      geometryByNodeId.set(rawGeometry.nodeId, Object.freeze({
        nodeId: rawGeometry.nodeId,
        kind: "convex-hull",
        vertices: Object.freeze(vertices),
      }));
      continue;
    }

    if (rawGeometry.kind === "triangle-mesh" && body.collider.kind === "triangle-mesh") {
      const indices = sequenceToNumbers(rawGeometry.indices);
      const vertexCount = vertices.length / 3;
      if (
        !indices ||
        vertexCount < 3 ||
        vertexCount > MAX_TRIANGLE_MESH_TRIANGLES * 3 ||
        indices.length !== body.collider.triangleCount * 3 ||
        body.collider.triangleCount > MAX_TRIANGLE_MESH_TRIANGLES ||
        indices.some((index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= vertexCount
        )
      ) return null;
      scalarCount += vertices.length + indices.length;
      geometryByNodeId.set(rawGeometry.nodeId, Object.freeze({
        nodeId: rawGeometry.nodeId,
        kind: "triangle-mesh",
        vertices: Object.freeze(vertices),
        indices: Object.freeze(indices),
      }));
      continue;
    }
    return null;
  }

  if (scalarCount > MAX_GEOMETRY_SCALARS) return null;
  const geometries: StudioBg3dPhysicsColliderGeometry[] = [];
  for (const body of world.bodies) {
    const requiresGeometry =
      body.collider.kind === "convex-hull" || body.collider.kind === "triangle-mesh";
    const geometry = geometryByNodeId.get(body.nodeId);
    if (requiresGeometry !== Boolean(geometry)) return null;
    if (geometry) geometries.push(geometry);
  }
  return Object.freeze(geometries);
}

/**
 * Clones untrusted input into an engine-neutral, deeply frozen and resource-bounded timeline DTO.
 * Duration is canonicalized to the nearest 60 Hz step; frame zero is always the initial pose.
 */
export function normalizeStudioBg3dPhysicsTimelineInput(
  value: unknown,
): NormalizedStudioBg3dPhysicsTimelineInput | null {
  try {
    if (!isRecord(value)) return null;
    const world = normalizeStudioBg3dPhysicsWorld(value.world);
    if (
      !world ||
      world.bodies.length > STUDIO_BG3D_PHYSICS_TIMELINE_MAX_BODIES ||
      world.bodies.some((body) => !NODE_ID_PATTERN.test(body.nodeId))
    ) return null;
    const dynamicNodeIds = world.bodies
      .filter((body) => body.motion === "dynamic")
      .map((body) => body.nodeId);
    if (dynamicNodeIds.length > STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DYNAMIC_BODIES) return null;

    const duration = normalizeDuration(value.durationSeconds);
    const initialPoses = normalizeInitialPoses(value.initialPoses, world);
    const gravity = value.gravity === undefined
      ? DEFAULT_GRAVITY
      : normalizeVec3(
          value.gravity,
          -STUDIO_BG3D_PHYSICS_TIMELINE_MAX_GRAVITY,
          STUDIO_BG3D_PHYSICS_TIMELINE_MAX_GRAVITY,
        );
    const ground = normalizeGround(value.ground);
    const geometries = normalizeGeometries(value.geometries, world);
    if (!duration || !initialPoses || !gravity || ground === undefined || !geometries) return null;

    return Object.freeze({
      world,
      initialPoses,
      durationSeconds: duration.durationSeconds,
      frameCount: duration.frameCount,
      gravity,
      ground,
      geometries,
      dynamicNodeIds: Object.freeze(dynamicNodeIds),
    });
  } catch {
    return null;
  }
}

export function studioBg3dPhysicsTimelineExpectedFloatCount(
  frameCount: number,
  dynamicBodyCount: number,
): number | null {
  if (
    !Number.isSafeInteger(frameCount) || frameCount < 1 ||
    !Number.isSafeInteger(dynamicBodyCount) ||
    dynamicBodyCount < 0 ||
    dynamicBodyCount > STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DYNAMIC_BODIES
  ) return null;
  const count = frameCount * dynamicBodyCount * STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE;
  return Number.isSafeInteger(count) ? count : null;
}

function validTimelineTransforms(
  transforms: Float32Array,
  frameCount: number,
  bodyCount: number,
): boolean {
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let body = 0; body < bodyCount; body += 1) {
      const offset = (frame * bodyCount + body) * STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE;
      for (let component = 0; component < 3; component += 1) {
        if (!finiteInRange(transforms[offset + component], -MAX_RESULT_COORDINATE, MAX_RESULT_COORDINATE)) {
          return false;
        }
      }
      const quaternion = transforms.subarray(offset + 3, offset + 7);
      if (quaternion.some((component) => !finiteInRange(component, -1.001, 1.001))) return false;
      const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      if (!finiteInRange(length, 0.99, 1.01)) return false;
    }
  }
  return true;
}

/** Reconstructs an exact frozen public result around an owned transferable frame buffer. */
export function createStudioBg3dPhysicsTimelineResult(
  nodeIdsValue: unknown,
  frameCountValue: unknown,
  durationSecondsValue: unknown,
  stepSecondsValue: unknown,
  transformsBufferValue: unknown,
): StudioBg3dPhysicsTimelineResult | null {
  if (
    !Array.isArray(nodeIdsValue) ||
    nodeIdsValue.length > STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DYNAMIC_BODIES ||
    nodeIdsValue.some((nodeId) => typeof nodeId !== "string" || !NODE_ID_PATTERN.test(nodeId)) ||
    new Set(nodeIdsValue).size !== nodeIdsValue.length ||
    !Number.isSafeInteger(frameCountValue) ||
    !finiteInRange(
      durationSecondsValue,
      STUDIO_BG3D_PHYSICS_TIMELINE_MIN_DURATION_SECONDS,
      STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DURATION_SECONDS,
    ) ||
    stepSecondsValue !== STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS ||
    !(transformsBufferValue instanceof ArrayBuffer)
  ) return null;
  const frameCount = frameCountValue as number;
  const expectedFrameCount = Math.round(
    durationSecondsValue * STUDIO_BG3D_PHYSICS_TIMELINE_HZ,
  ) + 1;
  const expectedFloatCount = studioBg3dPhysicsTimelineExpectedFloatCount(
    frameCount,
    nodeIdsValue.length,
  );
  if (
    frameCount !== expectedFrameCount ||
    expectedFloatCount === null ||
    transformsBufferValue.byteLength !== expectedFloatCount * Float32Array.BYTES_PER_ELEMENT
  ) return null;
  const transforms = new Float32Array(transformsBufferValue);
  if (!validTimelineTransforms(transforms, frameCount, nodeIdsValue.length)) return null;
  return Object.freeze({
    nodeIds: Object.freeze([...nodeIdsValue]) as readonly string[],
    frameCount,
    durationSeconds: durationSecondsValue,
    stepSeconds: STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
    transforms,
  });
}

function interpolateQuaternion(
  left: Float32Array,
  leftOffset: number,
  rightOffset: number,
  alpha: number,
): StudioBg3dQuaternion {
  const ax = left[leftOffset];
  const ay = left[leftOffset + 1];
  const az = left[leftOffset + 2];
  const aw = left[leftOffset + 3];
  let bx = left[rightOffset];
  let by = left[rightOffset + 1];
  let bz = left[rightOffset + 2];
  let bw = left[rightOffset + 3];
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const x = ax + (bx - ax) * alpha;
  const y = ay + (by - ay) * alpha;
  const z = az + (bz - az) * alpha;
  const w = aw + (bw - aw) * alpha;
  const length = Math.hypot(x, y, z, w);
  return freezeQuaternion([x / length, y / length, z / length, w / length]);
}

/** Samples the packed 60 Hz timeline with clamped linear/nlerp interpolation. */
export function sampleStudioBg3dPhysicsTimeline(
  timeline: StudioBg3dPhysicsTimelineResult,
  timeSeconds: number,
): readonly StudioBg3dPhysicsTimelineSample[] | null {
  if (!Number.isFinite(timeSeconds)) return null;
  const clampedTime = Math.min(timeline.durationSeconds, Math.max(0, timeSeconds));
  const framePosition = clampedTime * STUDIO_BG3D_PHYSICS_TIMELINE_HZ;
  const leftFrame = Math.min(timeline.frameCount - 1, Math.floor(framePosition));
  const rightFrame = Math.min(timeline.frameCount - 1, leftFrame + 1);
  const alpha = rightFrame === leftFrame ? 0 : framePosition - leftFrame;
  const bodyCount = timeline.nodeIds.length;
  const samples = timeline.nodeIds.map((nodeId, bodyIndex) => {
    const leftOffset = (leftFrame * bodyCount + bodyIndex) *
      STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE;
    const rightOffset = (rightFrame * bodyCount + bodyIndex) *
      STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE;
    const position = freezeVec3([
      timeline.transforms[leftOffset] +
        (timeline.transforms[rightOffset] - timeline.transforms[leftOffset]) * alpha,
      timeline.transforms[leftOffset + 1] +
        (timeline.transforms[rightOffset + 1] - timeline.transforms[leftOffset + 1]) * alpha,
      timeline.transforms[leftOffset + 2] +
        (timeline.transforms[rightOffset + 2] - timeline.transforms[leftOffset + 2]) * alpha,
    ]);
    const rotation = interpolateQuaternion(
      timeline.transforms,
      leftOffset + 3,
      rightOffset + 3,
      alpha,
    );
    return Object.freeze({ nodeId, position, rotation });
  });
  return Object.freeze(samples);
}

export function parseStudioBg3dPhysicsTimelineWorkerRunMessage(
  value: unknown,
): StudioBg3dPhysicsTimelineWorkerRunMessage | null {
  if (
    !isRecord(value) ||
    value.version !== STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION ||
    value.kind !== "run" ||
    !isPositiveSafeInteger(value.requestId)
  ) return null;
  const input = normalizeStudioBg3dPhysicsTimelineInput(value.input);
  if (!input) return null;
  return Object.freeze({
    version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
    kind: "run",
    requestId: value.requestId,
    input,
  });
}

export function isStudioBg3dPhysicsTimelineWorkerResponseMessage(
  value: unknown,
): value is StudioBg3dPhysicsTimelineWorkerResponseMessage {
  if (
    !isRecord(value) ||
    value.version !== STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION ||
    !isPositiveSafeInteger(value.requestId)
  ) return false;
  if (value.kind === "failure") {
    return value.code === "invalid-request" || value.code === "simulation-failed";
  }
  return value.kind === "result" &&
    Array.isArray(value.nodeIds) &&
    value.nodeIds.length <= STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DYNAMIC_BODIES &&
    value.nodeIds.every((nodeId) => typeof nodeId === "string" && NODE_ID_PATTERN.test(nodeId)) &&
    new Set(value.nodeIds).size === value.nodeIds.length &&
    Number.isSafeInteger(value.frameCount) &&
    finiteInRange(
      value.durationSeconds,
      STUDIO_BG3D_PHYSICS_TIMELINE_MIN_DURATION_SECONDS,
      STUDIO_BG3D_PHYSICS_TIMELINE_MAX_DURATION_SECONDS,
    ) &&
    value.stepSeconds === STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS &&
    value.transformsBuffer instanceof ArrayBuffer;
}
