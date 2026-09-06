/// <reference lib="webworker" />

import * as RAPIER from "@dimforge/rapier3d-deterministic-compat";

import {
  STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
  STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
  STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE,
  parseStudioBg3dPhysicsTimelineWorkerRunMessage,
  type NormalizedStudioBg3dPhysicsTimelineInput,
  type StudioBg3dPhysicsColliderGeometry,
  type StudioBg3dPhysicsTimelineWorkerFailureCode,
  type StudioBg3dPhysicsTimelineWorkerResponseMessage,
} from "./studio-bg3d-physics-timeline";

import type { StudioBg3dPhysicsBody } from "./studio-bg3d-physics";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const activeRequestIds = new Set<number>();
let rapierReady: Promise<void> | null = null;

function initializeRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

function colliderDescriptor(
  body: StudioBg3dPhysicsBody,
  geometryByNodeId: ReadonlyMap<string, StudioBg3dPhysicsColliderGeometry>,
): RAPIER.ColliderDesc {
  let descriptor: RAPIER.ColliderDesc | null;
  switch (body.collider.kind) {
    case "box":
      descriptor = RAPIER.ColliderDesc.cuboid(...body.collider.halfExtents);
      if (body.collider.center) descriptor.setTranslation(...body.collider.center);
      break;
    case "sphere":
      descriptor = RAPIER.ColliderDesc.ball(body.collider.radius);
      break;
    case "capsule":
      descriptor = RAPIER.ColliderDesc.capsule(
        body.collider.halfHeight,
        body.collider.radius,
      );
      break;
    case "convex-hull": {
      const geometry = geometryByNodeId.get(body.nodeId);
      if (!geometry || geometry.kind !== "convex-hull") {
        throw new Error("missing-convex-hull-geometry");
      }
      descriptor = RAPIER.ColliderDesc.convexHull(Float32Array.from(geometry.vertices));
      if (!descriptor) throw new Error("invalid-convex-hull-geometry");
      break;
    }
    case "triangle-mesh": {
      const geometry = geometryByNodeId.get(body.nodeId);
      if (!geometry || geometry.kind !== "triangle-mesh") {
        throw new Error("missing-triangle-mesh-geometry");
      }
      descriptor = RAPIER.ColliderDesc.trimesh(
        Float32Array.from(geometry.vertices),
        Uint32Array.from(geometry.indices),
      );
      break;
    }
  }
  descriptor
    .setFriction(body.friction)
    .setRestitution(body.restitution);
  if (body.motion === "dynamic") descriptor.setMass(body.mass);
  else descriptor.setDensity(0);
  return descriptor;
}

function rigidBodyDescriptor(
  body: StudioBg3dPhysicsBody,
  input: NormalizedStudioBg3dPhysicsTimelineInput,
  bodyIndex: number,
): RAPIER.RigidBodyDesc {
  const pose = input.initialPoses[bodyIndex];
  const descriptor = body.motion === "dynamic"
    ? RAPIER.RigidBodyDesc.dynamic()
    : body.motion === "kinematic"
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.fixed();
  return descriptor
    .setTranslation(...pose.position)
    .setRotation({
      x: pose.rotation[0],
      y: pose.rotation[1],
      z: pose.rotation[2],
      w: pose.rotation[3],
    })
    .setLinearDamping(body.linearDamping)
    .setAngularDamping(body.angularDamping)
    .setCanSleep(input.world.allowSleep);
}

function writeDynamicFrame(
  transforms: Float32Array,
  frameIndex: number,
  dynamicBodies: readonly RAPIER.RigidBody[],
): void {
  for (let bodyIndex = 0; bodyIndex < dynamicBodies.length; bodyIndex += 1) {
    const body = dynamicBodies[bodyIndex];
    const translation = body.translation();
    const rotation = body.rotation();
    const offset = (frameIndex * dynamicBodies.length + bodyIndex) *
      STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE;
    const values = [
      translation.x,
      translation.y,
      translation.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    ];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error("non-finite-simulation-result");
    }
    transforms.set(values, offset);
  }
}

function simulateTimeline(
  input: NormalizedStudioBg3dPhysicsTimelineInput,
): Float32Array {
  const world = new RAPIER.World({
    x: input.gravity[0],
    y: input.gravity[1],
    z: input.gravity[2],
  });
  try {
    const geometryByNodeId = new Map(
      input.geometries.map((geometry) => [geometry.nodeId, geometry] as const),
    );
    const dynamicBodies: RAPIER.RigidBody[] = [];
    for (let bodyIndex = 0; bodyIndex < input.world.bodies.length; bodyIndex += 1) {
      const body = input.world.bodies[bodyIndex];
      const rigidBody = world.createRigidBody(rigidBodyDescriptor(body, input, bodyIndex));
      world.createCollider(colliderDescriptor(body, geometryByNodeId), rigidBody);
      if (body.motion === "dynamic") dynamicBodies.push(rigidBody);
    }

    if (input.ground) {
      world.createCollider(
        new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }))
          .setTranslation(0, input.ground.y, 0)
          .setFriction(input.ground.friction)
          .setRestitution(input.ground.restitution),
      );
    }

    const transforms = new Float32Array(
      input.frameCount * dynamicBodies.length *
        STUDIO_BG3D_PHYSICS_TIMELINE_TRANSFORM_STRIDE,
    );
    // Frame zero is the exact engine-normalized initial pose before gravity or contacts advance.
    writeDynamicFrame(transforms, 0, dynamicBodies);
    world.timestep = STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS /
      input.world.solverSubsteps;
    for (let frameIndex = 1; frameIndex < input.frameCount; frameIndex += 1) {
      for (let substep = 0; substep < input.world.solverSubsteps; substep += 1) {
        world.step();
      }
      writeDynamicFrame(transforms, frameIndex, dynamicBodies);
    }
    return transforms;
  } finally {
    world.free();
  }
}

function postFailure(requestId: number, code: StudioBg3dPhysicsTimelineWorkerFailureCode): void {
  const response: StudioBg3dPhysicsTimelineWorkerResponseMessage = {
    version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
    kind: "failure",
    requestId,
    code,
  };
  scope.postMessage(response);
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const raw = event.data;
  const rawRequestId = typeof raw === "object" && raw !== null
    ? Reflect.get(raw, "requestId")
    : null;
  const request = parseStudioBg3dPhysicsTimelineWorkerRunMessage(raw);
  if (!request) {
    if (typeof rawRequestId === "number" && Number.isSafeInteger(rawRequestId) && rawRequestId > 0) {
      postFailure(rawRequestId, "invalid-request");
    }
    return;
  }
  if (activeRequestIds.has(request.requestId)) return;
  activeRequestIds.add(request.requestId);

  void initializeRapier()
    .then(() => {
      const transforms = simulateTimeline(request.input);
      const transformsBuffer = transforms.buffer as ArrayBuffer;
      const response: StudioBg3dPhysicsTimelineWorkerResponseMessage = {
        version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
        kind: "result",
        requestId: request.requestId,
        nodeIds: request.input.dynamicNodeIds,
        frameCount: request.input.frameCount,
        durationSeconds: request.input.durationSeconds,
        stepSeconds: STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
        transformsBuffer,
      };
      scope.postMessage(response, [transformsBuffer]);
    })
    .catch(() => postFailure(request.requestId, "simulation-failed"))
    .finally(() => activeRequestIds.delete(request.requestId));
});

export {};
