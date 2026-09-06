import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_PHYSICS_TIMELINE_HZ,
  STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
  STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
  createStudioBg3dPhysicsTimelineResult,
  isStudioBg3dPhysicsTimelineWorkerResponseMessage,
  normalizeStudioBg3dPhysicsTimelineInput,
  parseStudioBg3dPhysicsTimelineWorkerRunMessage,
  sampleStudioBg3dPhysicsTimeline,
  studioBg3dPhysicsTimelineExpectedFloatCount,
} from "./studio-bg3d-physics-timeline";

import type { StudioBg3dPhysicsBody } from "./studio-bg3d-physics";

function body(
  nodeId: string,
  motion: StudioBg3dPhysicsBody["motion"] = "dynamic",
): StudioBg3dPhysicsBody {
  return {
    nodeId,
    motion,
    collider: { kind: "sphere", radius: 0.5 },
    mass: motion === "dynamic" ? 1 : 0,
    friction: 0.6,
    restitution: 0.1,
    linearDamping: 0.05,
    angularDamping: 0.05,
  };
}

function inputFor(bodies: readonly StudioBg3dPhysicsBody[] = [body("dynamic")]) {
  return {
    world: { bodies, solverSubsteps: 2, allowSleep: true },
    initialPoses: bodies.map((entry, index) => ({
      nodeId: entry.nodeId,
      position: [index, index + 1, index + 2],
      rotation: [0, 0, 0, 2],
    })),
    durationSeconds: 1.009,
  };
}

function identityTimelineBuffer(frameCount: number, bodyCount: number): ArrayBuffer {
  const floats = new Float32Array(frameCount * bodyCount * 7);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let bodyIndex = 0; bodyIndex < bodyCount; bodyIndex += 1) {
      floats[(frame * bodyCount + bodyIndex) * 7 + 6] = 1;
    }
  }
  return floats.buffer;
}

describe("studio BG3D deterministic physics timeline DTO", () => {
  it("normalizes stable body order, poses, duration, and immutable defaults", () => {
    const normalized = normalizeStudioBg3dPhysicsTimelineInput(
      inputFor([body("z-static", "static"), body("a-dynamic")]),
    );

    expect(normalized).toMatchObject({
      durationSeconds: 61 / STUDIO_BG3D_PHYSICS_TIMELINE_HZ,
      frameCount: 62,
      gravity: [0, -9.81, 0],
      ground: null,
      dynamicNodeIds: ["a-dynamic"],
    });
    expect(normalized?.world.bodies.map((entry) => entry.nodeId)).toEqual([
      "a-dynamic",
      "z-static",
    ]);
    expect(normalized?.initialPoses.map((pose) => pose.nodeId)).toEqual([
      "a-dynamic",
      "z-static",
    ]);
    expect(normalized?.initialPoses[0]?.rotation).toEqual([0, 0, 0, 1]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.initialPoses)).toBe(true);
    expect(Object.isFrozen(normalized?.initialPoses[0]?.position)).toBe(true);
    expect(Object.isFrozen(normalized?.dynamicNodeIds)).toBe(true);
  });

  it("fails closed on identity, pose, duration, gravity, and body budgets", () => {
    const base = inputFor();
    expect(normalizeStudioBg3dPhysicsTimelineInput({
      ...base,
      initialPoses: [{ ...base.initialPoses[0], nodeId: "bad id" }],
    })).toBeNull();
    expect(normalizeStudioBg3dPhysicsTimelineInput({
      ...base,
      initialPoses: [{ ...base.initialPoses[0], rotation: [0, 0, 0, 0] }],
    })).toBeNull();
    expect(normalizeStudioBg3dPhysicsTimelineInput({ ...base, durationSeconds: 0.99 })).toBeNull();
    expect(normalizeStudioBg3dPhysicsTimelineInput({ ...base, durationSeconds: 8.01 })).toBeNull();
    expect(normalizeStudioBg3dPhysicsTimelineInput({ ...base, gravity: [0, -101, 0] })).toBeNull();

    const tooManyDynamic = Array.from({ length: 33 }, (_, index) => body(`body-${index}`));
    expect(normalizeStudioBg3dPhysicsTimelineInput(inputFor(tooManyDynamic))).toBeNull();
    const tooManyTotal = Array.from(
      { length: 257 },
      (_, index) => body(`body-${index}`, "static"),
    );
    expect(normalizeStudioBg3dPhysicsTimelineInput(inputFor(tooManyTotal))).toBeNull();
  });

  it("preserves bounded model AABB offsets and rejects unsafe collider centers at the Worker DTO boundary", () => {
    const offsetBox: StudioBg3dPhysicsBody = {
      ...body("offset-box"),
      collider: {
        kind: "box",
        halfExtents: [1, 2, 0.5],
        center: [0.5, 2, -0.25],
      },
    };
    const normalized = normalizeStudioBg3dPhysicsTimelineInput(inputFor([offsetBox]));
    expect(normalized?.world.bodies[0]?.collider).toEqual(offsetBox.collider);
    expect(Object.isFrozen(
      normalized?.world.bodies[0]?.collider.kind === "box"
        ? normalized.world.bodies[0].collider.center
        : null,
    )).toBe(true);

    expect(normalizeStudioBg3dPhysicsTimelineInput(inputFor([{
      ...offsetBox,
      collider: {
        kind: "box",
        halfExtents: [1, 2, 0.5],
        center: [10_001, 0, 0],
      },
    }]))).toBeNull();
  });

  it("requires explicit, bounded geometry for hull and mesh colliders", () => {
    const hull: StudioBg3dPhysicsBody = {
      ...body("hull"),
      collider: { kind: "convex-hull", vertexCount: 4 },
    };
    const base = inputFor([hull]);
    expect(normalizeStudioBg3dPhysicsTimelineInput(base)).toBeNull();

    const normalizedHull = normalizeStudioBg3dPhysicsTimelineInput({
      ...base,
      geometries: [{
        nodeId: "hull",
        kind: "convex-hull",
        vertices: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
          0, 0, 1,
        ]),
      }],
    });
    expect(normalizedHull?.geometries[0]).toMatchObject({
      nodeId: "hull",
      kind: "convex-hull",
    });
    expect(Object.isFrozen(normalizedHull?.geometries[0]?.vertices)).toBe(true);

    const mesh: StudioBg3dPhysicsBody = {
      ...body("mesh", "static"),
      collider: { kind: "triangle-mesh", triangleCount: 1 },
    };
    const meshBase = inputFor([mesh]);
    expect(normalizeStudioBg3dPhysicsTimelineInput({
      ...meshBase,
      geometries: [{
        nodeId: "mesh",
        kind: "triangle-mesh",
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 3],
      }],
    })).toBeNull();
    expect(normalizeStudioBg3dPhysicsTimelineInput({
      ...meshBase,
      geometries: [{
        nodeId: "mesh",
        kind: "triangle-mesh",
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: new Uint32Array([0, 1, 2]),
      }],
    })?.geometries).toHaveLength(1);
  });
});

describe("studio BG3D physics timeline result and sampling", () => {
  it("accepts an initial-inclusive packed buffer and returns frozen interpolated samples", () => {
    const frameCount = STUDIO_BG3D_PHYSICS_TIMELINE_HZ + 1;
    const floats = new Float32Array(frameCount * 7);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = frame * 7;
      floats[offset] = frame === 0 ? 0 : 2;
      floats[offset + 1] = frame;
      floats[offset + 3] = 0;
      floats[offset + 4] = frame === 0 ? 0 : 1;
      floats[offset + 5] = 0;
      floats[offset + 6] = frame === 0 ? 1 : 0;
    }
    const result = createStudioBg3dPhysicsTimelineResult(
      ["dynamic"],
      frameCount,
      1,
      STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
      floats.buffer,
    );

    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {})).toEqual([
      "nodeIds",
      "frameCount",
      "durationSeconds",
      "stepSeconds",
      "transforms",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.nodeIds)).toBe(true);
    expect(result?.transforms).toBeInstanceOf(Float32Array);

    const halfway = sampleStudioBg3dPhysicsTimeline(
      result!,
      STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS / 2,
    );
    expect(halfway?.[0]?.position).toEqual([1, 0.5, 0]);
    expect(halfway?.[0]?.rotation[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(halfway?.[0]?.rotation[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Object.isFrozen(halfway)).toBe(true);
    expect(Object.isFrozen(halfway?.[0])).toBe(true);
    expect(Object.isFrozen(halfway?.[0]?.position)).toBe(true);

    expect(sampleStudioBg3dPhysicsTimeline(result!, -2)?.[0]?.position).toEqual([0, 0, 0]);
    expect(sampleStudioBg3dPhysicsTimeline(result!, 99)?.[0]?.position).toEqual([2, 60, 0]);
    expect(sampleStudioBg3dPhysicsTimeline(result!, Number.NaN)).toBeNull();
  });

  it("rejects malformed transfer lengths and non-unit quaternion frames", () => {
    expect(createStudioBg3dPhysicsTimelineResult(
      ["dynamic"],
      61,
      1,
      STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
      new ArrayBuffer(4),
    )).toBeNull();
    expect(createStudioBg3dPhysicsTimelineResult(
      ["dynamic"],
      61,
      1,
      STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
      new Float32Array(61 * 7).buffer,
    )).toBeNull();
    expect(studioBg3dPhysicsTimelineExpectedFloatCount(61, 1)).toBe(427);
    expect(studioBg3dPhysicsTimelineExpectedFloatCount(61, 33)).toBeNull();
  });
});

describe("studio BG3D physics timeline worker protocol", () => {
  it("parses a run request into a frozen normalized protocol DTO", () => {
    const parsed = parseStudioBg3dPhysicsTimelineWorkerRunMessage({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "run",
      requestId: 7,
      input: inputFor(),
    });
    expect(parsed).toMatchObject({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "run",
      requestId: 7,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.input)).toBe(true);
    expect(parseStudioBg3dPhysicsTimelineWorkerRunMessage({
      version: 999,
      kind: "run",
      requestId: 7,
      input: inputFor(),
    })).toBeNull();
    expect(parseStudioBg3dPhysicsTimelineWorkerRunMessage({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "run",
      requestId: 0,
      input: inputFor(),
    })).toBeNull();
  });

  it("guards success and sanitized failure response envelopes", () => {
    const success = {
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      nodeIds: ["dynamic"],
      frameCount: 61,
      durationSeconds: 1,
      stepSeconds: STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
      transformsBuffer: identityTimelineBuffer(61, 1),
    };
    expect(isStudioBg3dPhysicsTimelineWorkerResponseMessage(success)).toBe(true);
    expect(isStudioBg3dPhysicsTimelineWorkerResponseMessage({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "failure",
      requestId: 1,
      code: "simulation-failed",
    })).toBe(true);
    expect(isStudioBg3dPhysicsTimelineWorkerResponseMessage({
      ...success,
      transformsBuffer: new Float32Array(61 * 7),
    })).toBe(false);
    expect(isStudioBg3dPhysicsTimelineWorkerResponseMessage({
      ...success,
      nodeIds: ["duplicate", "duplicate"],
    })).toBe(false);
    expect(isStudioBg3dPhysicsTimelineWorkerResponseMessage({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "failure",
      requestId: 1,
      code: "worker-stack-leak",
    })).toBe(false);
  });
});
