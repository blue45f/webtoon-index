import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_PROPORTION_PRESETS,
  resolveStudioVrmProportionMetrics,
} from "./studio-vrm-proportion-core";
import {
  STUDIO_VRM_XPBD_SKIRT_BUDGETS,
  STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED,
  createStudioVrmXpbdSkirtTopology,
  solveStudioVrmXpbdSkirtPose,
  type StudioVrmXpbdSkirtBodyProxies,
  type StudioVrmXpbdSkirtCapsuleProxy,
  type StudioVrmXpbdSkirtKind,
  type StudioVrmXpbdSkirtMetrics,
  type StudioVrmXpbdSkirtSolveInput,
  type StudioVrmXpbdSkirtTopology,
  type StudioVrmXpbdSkirtVec3,
  type StudioVrmXpbdSkirtWaistFrame,
} from "./studio-vrm-xpbd-skirt";

const METRICS: StudioVrmXpbdSkirtMetrics = {
  totalHeight: 1.6,
  headUnits: 8,
  hipsHeight: 0.95,
  legLength: 0.86,
  shoulderSpan: 0.18,
};

const REST_WAIST: StudioVrmXpbdSkirtWaistFrame = {
  center: [0, 0.95, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, 1],
};

const CURRENT_WAIST: StudioVrmXpbdSkirtWaistFrame = {
  center: [0.03, 0.98, 0.02],
  right: [0.98, 0, -0.2],
  up: [0, 1, 0],
  forward: [0.2, 0, 0.98],
};

function capsule(
  restHead: StudioVrmXpbdSkirtVec3,
  restTail: StudioVrmXpbdSkirtVec3,
  currentHead: StudioVrmXpbdSkirtVec3,
  currentTail: StudioVrmXpbdSkirtVec3,
  radius: number,
): StudioVrmXpbdSkirtCapsuleProxy {
  return { restHead, restTail, currentHead, currentTail, radius, friction: 0.4 };
}

function bodyProxies(): StudioVrmXpbdSkirtBodyProxies {
  return {
    hips: capsule(
      [-0.1, 0.9, 0],
      [0.1, 0.9, 0],
      [-0.1, 0.93, 0.02],
      [0.1, 0.93, 0.02],
      0.11,
    ),
    leftThigh: capsule(
      [-0.08, 0.88, 0],
      [-0.08, 0.5, 0],
      [-0.08, 0.9, 0.02],
      [-0.22, 0.56, 0.1],
      0.075,
    ),
    rightThigh: capsule(
      [0.08, 0.88, 0],
      [0.08, 0.5, 0],
      [0.08, 0.9, 0.02],
      [0.22, 0.56, -0.08],
      0.075,
    ),
    leftCalf: capsule(
      [-0.08, 0.5, 0],
      [-0.08, 0.14, 0],
      [-0.22, 0.56, 0.1],
      [-0.18, 0.17, 0.18],
      0.065,
    ),
    rightCalf: capsule(
      [0.08, 0.5, 0],
      [0.08, 0.14, 0],
      [0.22, 0.56, -0.08],
      [0.2, 0.17, -0.16],
      0.065,
    ),
  };
}

function createTopology(
  kind: StudioVrmXpbdSkirtKind,
  metrics: StudioVrmXpbdSkirtMetrics = METRICS,
): StudioVrmXpbdSkirtTopology {
  const result = createStudioVrmXpbdSkirtTopology({ kind, metrics, restWaist: REST_WAIST });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.topology;
}

function solveInput(
  topology: StudioVrmXpbdSkirtTopology,
  overrides: Partial<StudioVrmXpbdSkirtSolveInput> = {},
): StudioVrmXpbdSkirtSolveInput {
  return {
    expectedPoseGeneration: 4,
    poseGeneration: 4,
    expectedTopologySha256: topology.topologySha256,
    currentWaist: CURRENT_WAIST,
    body: bodyProxies(),
    restToPoseSteps: topology.kind === "pleated" ? 12 : 20,
    ...overrides,
  };
}

function edges(indices: Uint32Array): Set<string> {
  const result = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge]!;
      const b = triangle[(edge + 1) % 3]!;
      result.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  return result;
}

function transformedRestWaistPoint(
  topology: StudioVrmXpbdSkirtTopology,
  segment: number,
  frame: StudioVrmXpbdSkirtWaistFrame,
): StudioVrmXpbdSkirtVec3 {
  const offset = segment * 3;
  const dx = topology.restPositions[offset]! - topology.restWaist.center[0];
  const dy = topology.restPositions[offset + 1]! - topology.restWaist.center[1];
  const dz = topology.restPositions[offset + 2]! - topology.restWaist.center[2];
  const localX =
    dx * topology.restWaist.right[0] +
    dy * topology.restWaist.right[1] +
    dz * topology.restWaist.right[2];
  const localZ =
    dx * topology.restWaist.forward[0] +
    dy * topology.restWaist.forward[1] +
    dz * topology.restWaist.forward[2];
  const rightLength = Math.hypot(frame.right[0], frame.right[1], frame.right[2]);
  const right = frame.right.map((value) => Math.fround(value / rightLength));
  // `CURRENT_WAIST.up` is already orthogonal to right. Mirror the production frame's f32
  // normalization and right × up handedness so the assertion checks the exact pin target.
  const forward = [Math.fround(-right[2]!), 0, Math.fround(right[0]!)];
  return [
    Math.fround(frame.center[0] + right[0]! * localX + forward[0]! * localZ),
    Math.fround(frame.center[1] + right[1]! * localX + forward[1]! * localZ),
    Math.fround(frame.center[2] + right[2]! * localX + forward[2]! * localZ),
  ];
}

describe("Studio VRM XPBD skirt v1", () => {
  it.each(["pleated", "longskirt"] as const)(
    "builds a finite indexed %s surface with a physically connected ring seam",
    (kind) => {
      const topology = createTopology(kind);
      const edgeSet = edges(topology.triangleIndices);

      expect(topology.particleCount).toBe(topology.segmentCount * topology.ringCount);
      expect(topology.triangleCount).toBe(topology.segmentCount * (topology.ringCount - 1) * 2);
      expect(topology.particleCount).toBeLessThanOrEqual(STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxParticles);
      expect(topology.triangleCount).toBeLessThanOrEqual(STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxTriangles);
      expect(topology.selfCollisionEnabled).toBe(STUDIO_VRM_XPBD_SKIRT_SELF_COLLISION_ENABLED);
      expect(topology.compiledModel.selfCollisionEnabled).toBe(false);
      expect(topology.topologySha256).toMatch(/^[a-f0-9]{64}$/u);
      expect([...topology.uvs].every(Number.isFinite)).toBe(true);
      expect([...topology.uvs].every((value) => value >= 0 && value <= 1)).toBe(true);
      expect([...topology.triangleIndices].every((index) => index < topology.particleCount)).toBe(true);
      expect([...topology.restPositions].every(Number.isFinite)).toBe(true);

      for (let ring = 0; ring < topology.ringCount; ring += 1) {
        const first = ring * topology.segmentCount;
        const last = first + topology.segmentCount - 1;
        expect(edgeSet.has(`${first}:${last}`)).toBe(true);
      }
    },
  );

  it("authors visible radial pleats instead of a smooth traffic-cone silhouette", () => {
    const topology = createTopology("pleated");
    const ring = topology.ringCount - 1;
    const normalizedRadii = Array.from({ length: topology.segmentCount }, (_, segment) => {
      const offset = (ring * topology.segmentCount + segment) * 3;
      const x = topology.restPositions[offset]! - topology.restWaist.center[0];
      const z = topology.restPositions[offset + 2]! - topology.restWaist.center[2];
      const radiusX = topology.dimensions.waistRadiusX * topology.dimensions.hemFlare;
      const radiusZ = topology.dimensions.waistRadiusZ * topology.dimensions.hemFlare;
      return Math.hypot(x / radiusX, z / radiusZ);
    });

    expect(Math.max(...normalizedRadii) - Math.min(...normalizedRadii)).toBeGreaterThan(0.16);
    expect(topology.dimensions.pleatCount).toBeGreaterThanOrEqual(8);
  });

  it("pins the complete waist ring to the posed hips frame and clears bent, spread thighs", () => {
    const topology = createTopology("pleated");
    const solved = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology));

    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    for (let segment = 0; segment < topology.segmentCount; segment += 1) {
      const expected = transformedRestWaistPoint(topology, segment, CURRENT_WAIST);
      const offset = segment * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        expect(solved.mesh.positions[offset + axis]).toBeCloseTo(expected[axis]!, 6);
      }
    }
    expect(solved.mesh.receipt.capsuleIds).toEqual(["hips", "leftThigh", "rightThigh"]);
    expect(solved.mesh.receipt.diagnostics.totalCapsuleContactCount).toBeGreaterThan(0);
    expect(solved.mesh.receipt.diagnostics.maxCapsulePenetration).toBeLessThan(0.000_1);
    expect(solved.mesh.receipt.diagnostics.finalCapsulePenetrationById.leftThigh).toBeLessThan(0.000_1);
    expect(solved.mesh.receipt.diagnostics.finalCapsulePenetrationById.rightThigh).toBeLessThan(0.000_1);
  });

  it("uses both calf proxies for a long skirt and resolves the hem outside them", () => {
    const topology = createTopology("longskirt");
    const solved = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology));

    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.mesh.receipt.capsuleCount).toBe(5);
    expect(solved.mesh.receipt.capsuleIds).toEqual([
      "hips",
      "leftThigh",
      "rightThigh",
      "leftCalf",
      "rightCalf",
    ]);
    expect(solved.mesh.receipt.diagnostics.totalCapsuleContactCount).toBeGreaterThan(0);
    expect(solved.mesh.receipt.diagnostics.finalCapsulePenetrationById.leftCalf).toBeLessThan(0.000_1);
    expect(solved.mesh.receipt.diagnostics.finalCapsulePenetrationById.rightCalf).toBeLessThan(0.000_1);
    expect(solved.mesh.receipt.diagnostics.maxCapsulePenetration).toBeLessThan(0.000_1);
  });

  it("produces byte-identical mesh arrays and deeply frozen receipts for identical runs", () => {
    const topology = createTopology("longskirt");
    const input = solveInput(topology);
    const first = solveStudioVrmXpbdSkirtPose(topology, input);
    const second = solveStudioVrmXpbdSkirtPose(topology, input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.mesh.positions).toEqual(second.mesh.positions);
    expect(first.mesh.uvs).toEqual(second.mesh.uvs);
    expect(first.mesh.triangleIndices).toEqual(second.mesh.triangleIndices);
    expect(first.mesh.receipt).toEqual(second.mesh.receipt);
    expect(first.mesh.receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.mesh.receipt.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first.mesh.receipt)).toBe(true);
    expect(Object.isFrozen(first.mesh.receipt.capsuleIds)).toBe(true);
    expect(Object.isFrozen(first.mesh.receipt.diagnostics)).toBe(true);
    expect(Object.isFrozen(first.mesh.receipt.diagnostics.finalCapsulePenetrationById)).toBe(true);
  });

  it("fails closed with explicit unavailable codes for missing, NaN, stale, and over-budget work", () => {
    const missingTopology = createStudioVrmXpbdSkirtTopology(
      null as unknown as Parameters<typeof createStudioVrmXpbdSkirtTopology>[0],
    );
    expect(missingTopology).toMatchObject({
      ok: false,
      status: "unavailable",
      code: "missing-input",
    });

    const nanMetrics = createStudioVrmXpbdSkirtTopology({
      kind: "pleated",
      metrics: { ...METRICS, legLength: Number.NaN },
      restWaist: REST_WAIST,
    });
    expect(nanMetrics).toMatchObject({ ok: false, status: "unavailable", code: "invalid-input" });

    const topologyBudget = createStudioVrmXpbdSkirtTopology({
      kind: "longskirt",
      metrics: METRICS,
      restWaist: REST_WAIST,
      segmentCount: 96,
      ringCount: 24,
    });
    expect(topologyBudget).toMatchObject({
      ok: false,
      status: "unavailable",
      code: "budget-exceeded",
    });

    const topology = createTopology("longskirt");
    const restBefore = new Float32Array(topology.restPositions);
    const staleHash = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology, {
      expectedTopologySha256: "0".repeat(64),
    }));
    const staleGeneration = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology, {
      expectedPoseGeneration: 3,
    }));
    const missingCalves = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology, {
      body: {
        hips: bodyProxies().hips,
        leftThigh: bodyProxies().leftThigh,
        rightThigh: bodyProxies().rightThigh,
      },
    }));
    const nanFrame = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology, {
      currentWaist: { ...CURRENT_WAIST, center: [Number.NaN, 0, 0] },
    }));
    const solveBudget = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology, {
      restToPoseSteps: STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxRestToPoseSteps + 1,
    }));
    const missingFence = solveStudioVrmXpbdSkirtPose(topology, {
      ...solveInput(topology),
      expectedTopologySha256: undefined,
    } as unknown as StudioVrmXpbdSkirtSolveInput);

    expect(staleHash).toMatchObject({ ok: false, status: "unavailable", code: "stale-input" });
    expect(staleGeneration).toMatchObject({ ok: false, status: "unavailable", code: "stale-input" });
    expect(missingCalves).toMatchObject({ ok: false, status: "unavailable", code: "missing-input" });
    expect(nanFrame).toMatchObject({ ok: false, status: "unavailable", code: "invalid-input" });
    expect(solveBudget).toMatchObject({ ok: false, status: "unavailable", code: "budget-exceeded" });
    expect(missingFence).toMatchObject({ ok: false, status: "unavailable", code: "missing-input" });
    expect(topology.restPositions).toEqual(restBefore);
  });

  it("detects topology mutation before entering the solver", () => {
    const topology = createTopology("pleated");
    topology.uvs[0] = 0.25;

    const result = solveStudioVrmXpbdSkirtPose(topology, solveInput(topology));

    expect(result).toMatchObject({
      ok: false,
      status: "unavailable",
      code: "topology-mismatch",
    });
  });

  it.each(["sd-chibi-3", "runway-9"] as const)(
    "keeps %s proportion extremes finite and inside every local budget",
    (presetId) => {
      const preset = STUDIO_VRM_PROPORTION_PRESETS.find(({ id }) => id === presetId);
      if (!preset) throw new Error(`Missing ${presetId} fixture.`);
      const metrics = resolveStudioVrmProportionMetrics(preset.proportions);

      for (const kind of ["pleated", "longskirt"] as const) {
        const built = createStudioVrmXpbdSkirtTopology({
          kind,
          metrics,
          restWaist: { ...REST_WAIST, center: [0, metrics.hipsHeight, 0] },
        });
        expect(built.ok).toBe(true);
        if (!built.ok) continue;
        expect(Object.values(built.topology.dimensions).every(Number.isFinite)).toBe(true);
        expect(built.topology.dimensions.skirtLength).toBeGreaterThan(0);
        expect(built.topology.particleCount).toBeLessThanOrEqual(
          STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxParticles,
        );
        expect(built.topology.triangleCount).toBeLessThanOrEqual(
          STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxTriangles,
        );
      }
    },
  );
});
