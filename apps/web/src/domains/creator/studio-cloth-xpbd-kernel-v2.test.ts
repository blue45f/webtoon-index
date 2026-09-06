import { describe, expect, it } from "vitest";

import {
  STUDIO_CLOTH_XPBD_BEND_MODEL,
  STUDIO_CLOTH_XPBD_DETERMINISM_SCOPE,
  STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS,
  STUDIO_CLOTH_XPBD_V2_BUDGETS,
  compileStudioClothXpbdModelV2,
  createStudioClothXpbdRuntimeV2,
  stepStudioClothXpbdV2,
  type StudioClothXpbdCompileInputV2,
  type StudioClothXpbdCompiledModelV2,
  type StudioClothXpbdRuntimeV2,
} from "./studio-cloth-xpbd-kernel-v2";

const QUAD_POSITIONS = new Float32Array([
  0, 1, 0,
  1, 1, 0,
  1, 0, 0,
  0, 0, 0,
]);

const QUAD_TRIANGLES = new Uint32Array([
  0, 1, 2,
  0, 2, 3,
]);

function compileModel(
  overrides: Partial<StudioClothXpbdCompileInputV2> = {},
): StudioClothXpbdCompiledModelV2 {
  const result = compileStudioClothXpbdModelV2({
    restPositions: QUAD_POSITIONS,
    triangleIndices: QUAD_TRIANGLES,
    gravity: [0, 0, 0],
    selfCollisionEnabled: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.model;
}

function createRuntime(
  model: StudioClothXpbdCompiledModelV2,
  initial?: { readonly positions?: Float32Array; readonly velocities?: Float32Array },
): StudioClothXpbdRuntimeV2 {
  const result = createStudioClothXpbdRuntimeV2(model, initial);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.runtime;
}

function particleDistance(positions: Float32Array, a: number, b: number): number {
  const a3 = a * 3;
  const b3 = b * 3;
  return Math.hypot(
    positions[b3]! - positions[a3]!,
    positions[b3 + 1]! - positions[a3 + 1]!,
    positions[b3 + 2]! - positions[a3 + 2]!,
  );
}

describe("studio cloth XPBD kernel v2", () => {
  it("compiles a canonical structural and opposite-vertex bend topology", () => {
    const model = compileModel({ fixedParticleIndices: new Uint32Array([0]) });

    expect(model.particleCount).toBe(4);
    expect(model.triangleCount).toBe(2);
    expect(model.structuralRestLengths).toHaveLength(5);
    expect(model.bendRestLengths).toHaveLength(1);
    expect([...model.bendPairs]).toEqual([1, 3]);
    expect(model.fixedMask[0]).toBe(1);
    expect(model.inverseMasses[0]).toBe(0);
    expect(model.bendModel).toBe(STUDIO_CLOTH_XPBD_BEND_MODEL);
    expect(model.topologySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("solves structural constraints with accumulated XPBD lambdas", () => {
    const model = compileModel({
      structuralCompliance: 0,
      bendCompliance: 1,
      solverIterations: 8,
    });
    const stretched = new Float32Array(QUAD_POSITIONS);
    stretched[6] = 1.6;
    const runtime = createRuntime(model, { positions: stretched });
    const errorBefore = Math.abs(particleDistance(runtime.positions, 1, 2) - 1);

    const result = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.diagnostics.maxStructuralError).toBeLessThan(errorBefore);
    expect(result.receipt.diagnostics.structuralLambdaL1).toBeGreaterThan(0);
    expect(result.receipt.solverIterations).toBe(8);
    expect(runtime.stepIndex).toBe(1);
    expect(result.receipt.outputPositionsSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses the internal-edge opposite vertices as a deterministic bend constraint", () => {
    const model = compileModel({
      structuralCompliance: 1,
      bendCompliance: 0,
      solverIterations: 8,
    });
    const folded = new Float32Array(QUAD_POSITIONS);
    folded.set([0.9, 0.9, 0.05], 9);
    const runtime = createRuntime(model, { positions: folded });
    const errorBefore = Math.abs(particleDistance(runtime.positions, 1, 3) - Math.SQRT2);

    const result = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.diagnostics.maxBendError).toBeLessThan(errorBefore);
    expect(result.receipt.diagnostics.bendLambdaL1).toBeGreaterThan(0);
  });

  it("stitches disconnected panels with explicit seam pairs", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        3, 0, 0,
        4, 0, 0,
        3, 1, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      seams: [{ id: "side", pairs: new Uint32Array([1, 3]) }],
      structuralCompliance: 1,
      seamCompliance: 0,
      solverIterations: 8,
    });
    const runtime = createRuntime(model);
    const seamDistanceBefore = particleDistance(runtime.positions, 1, 3);

    const result = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(particleDistance(runtime.positions, 1, 3)).toBeLessThan(seamDistanceBefore * 0.01);
    expect(result.receipt.seamConstraintCount).toBe(1);
    expect(result.receipt.diagnostics.seamLambdaL1).toBeGreaterThan(0);
  });

  it("keeps fixed pins at rest and follows moving kinematic pins exactly", () => {
    const model = compileModel({
      fixedParticleIndices: new Uint32Array([0]),
      gravity: [0, -10, 0],
    });
    const runtime = createRuntime(model);
    const result = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 0,
      kinematicPins: [{
        particle: 1,
        previous: [1, 1, 0],
        current: [1.25, 1.5, 0],
      }],
    });

    expect(result.ok).toBe(true);
    expect([...runtime.positions.slice(0, 3)]).toEqual([0, 1, 0]);
    expect([...runtime.positions.slice(3, 6)]).toEqual([1.25, 1.5, 0]);
    expect([...runtime.velocities.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(runtime.velocities[3]).toBeCloseTo(30, 5);
    expect(runtime.velocities[4]).toBeCloseTo(60, 5);
  });

  it("keeps every zero-inverse-mass particle static without requiring a fixed index", () => {
    const model = compileModel({
      inverseMasses: new Float32Array([0, 1, 1, 1]),
      gravity: [3, -10, 2],
      structuralCompliance: 1,
      bendCompliance: 1,
    });
    const initialPositions = new Float32Array(QUAD_POSITIONS);
    initialPositions.set([0.25, 1.25, -0.5], 0);
    const initialVelocities = new Float32Array(QUAD_POSITIONS.length);
    initialVelocities.set([12, -7, 4], 0);
    const runtime = createRuntime(model, {
      positions: initialPositions,
      velocities: initialVelocities,
    });

    expect(model.fixedMask[0]).toBe(0);
    expect([...runtime.positions.slice(0, 3)]).toEqual([0.25, 1.25, -0.5]);
    expect([...runtime.velocities.slice(0, 3)]).toEqual([0, 0, 0]);

    const result = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });

    expect(result.ok).toBe(true);
    expect([...runtime.positions.slice(0, 3)]).toEqual([0.25, 1.25, -0.5]);
    expect([...runtime.velocities.slice(0, 3)]).toEqual([0, 0, 0]);
    const pinAttempt = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 1,
      kinematicPins: [{
        particle: 0,
        previous: [0.25, 1.25, -0.5],
        current: [1, 2, 3],
      }],
    });
    expect(pinAttempt).toMatchObject({ ok: false, code: "invalid-input" });
    expect([...runtime.positions.slice(0, 3)]).toEqual([0.25, 1.25, -0.5]);
  });

  it("projects particles outside moving capsule frames and records contacts", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0.05, 0, 0,
        0.3, 0, 0,
        0.05, 0.3, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2]),
      particleRadii: new Float32Array([0.05, 0.05, 0.05]),
      structuralCompliance: 1,
      solverIterations: 8,
    });
    const runtime = createRuntime(model);
    const result = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 0,
      capsules: [{
        id: "torso",
        previousHead: [0, -0.5, 0],
        previousTail: [0, 0.5, 0],
        currentHead: [0.02, -0.5, 0],
        currentTail: [0.02, 0.5, 0],
        radius: 0.2,
        friction: 0.5,
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const radialDistance = Math.hypot(runtime.positions[0]! - 0.02, runtime.positions[2]!);
    expect(radialDistance).toBeGreaterThanOrEqual(0.249);
    expect(result.receipt.capsuleContactCount).toBeGreaterThan(0);
    expect(result.receipt.diagnostics.capsuleLambdaL1).toBeGreaterThan(0);
    expect(result.receipt.diagnostics.maxCapsulePenetration).toBeLessThan(0.001);
  });

  it("applies capsule friction to relative velocity so a moving surface drags cloth", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0.2, 0, 0,
        1, 0, 0,
        0.2, 1, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2]),
      particleRadii: new Float32Array([0.05, 0.05, 0.05]),
      structuralCompliance: 1,
      bendCompliance: 1,
      dampingPerSecond: 0,
      solverIterations: 1,
    });
    const runtime = createRuntime(model);

    const first = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 0,
      capsules: [{
        id: "moving-surface",
        previousHead: [0, -0.01, -1],
        previousTail: [0, -0.01, 1],
        currentHead: [0, 0, -1],
        currentTail: [0, 0, 1],
        radius: 0.2,
        friction: 1,
      }],
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.receipt.capsuleContactCount).toBeGreaterThan(0);
    expect(runtime.velocities[1]).toBeCloseTo(1.2, 4);

    const second = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 1,
      capsules: [{
        id: "moving-surface",
        previousHead: [0, 0, -1],
        previousTail: [0, 0, 1],
        currentHead: [0, 0.01, -1],
        currentTail: [0, 0.01, 1],
        radius: 0.2,
        friction: 1,
      }],
    });

    expect(second.ok).toBe(true);
    expect(runtime.positions[1]).toBeGreaterThan(0.009);
    expect(runtime.velocities[1]).toBeCloseTo(1.2, 3);
  });

  it("preserves static-collider tangent damping while using relative velocity", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0.2, 0, 0,
        1, 0, 0,
        0.2, 1, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2]),
      particleRadii: new Float32Array([0.05, 0.05, 0.05]),
      structuralCompliance: 1,
      bendCompliance: 1,
      dampingPerSecond: 0,
      solverIterations: 1,
    });
    const velocities = new Float32Array(model.particleCount * 3);
    velocities[2] = 1;
    const runtime = createRuntime(model, { velocities });

    const result = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 0,
      capsules: [{
        id: "static-surface",
        previousHead: [0, 0, -1],
        previousTail: [0, 0, 1],
        currentHead: [0, 0, -1],
        currentTail: [0, 0, 1],
        radius: 0.2,
        friction: 0.5,
      }],
    });

    expect(result.ok).toBe(true);
    expect(runtime.velocities[2]).toBeCloseTo(0.5, 3);
  });

  it("selects one coherent multi-capsule contact deterministically", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0.2, 0, 0,
        1, 0, 0,
        0.2, 1, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2]),
      particleRadii: new Float32Array([0.05, 0.05, 0.05]),
      structuralCompliance: 1,
      bendCompliance: 1,
      dampingPerSecond: 0,
      solverIterations: 1,
    });
    const capsuleA = {
      id: "a-quarter-friction",
      previousHead: [0, -0.01, -1] as const,
      previousTail: [0, -0.01, 1] as const,
      currentHead: [0, 0, -1] as const,
      currentTail: [0, 0, 1] as const,
      radius: 0.2,
      friction: 0.25,
      compliance: 1,
    };
    const capsuleB = {
      id: "b-full-friction",
      previousHead: [0, 0.01, -1] as const,
      previousTail: [0, 0.01, 1] as const,
      currentHead: [0, 0, -1] as const,
      currentTail: [0, 0, 1] as const,
      radius: 0.2,
      friction: 1,
      compliance: 1,
    };
    const runtimeA = createRuntime(model);
    const runtimeB = createRuntime(model);

    const resultA = stepStudioClothXpbdV2(runtimeA, {
      expectedStepIndex: 0,
      capsules: [capsuleB, capsuleA],
    });
    const resultB = stepStudioClothXpbdV2(runtimeB, {
      expectedStepIndex: 0,
      capsules: [capsuleA, capsuleB],
    });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    expect(runtimeA.positions).toEqual(runtimeB.positions);
    expect(runtimeA.velocities).toEqual(runtimeB.velocities);
    expect(resultA).toEqual(resultB);
    expect(runtimeA.velocities[1]).toBeCloseTo(0.3, 3);
    expect(Math.abs(runtimeA.velocities[4]!)).toBeLessThan(0.001);
  });

  it("separates non-neighbor particles with deterministic spatial-hash self collision", () => {
    const model = compileModel({
      restPositions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]),
      triangleIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      particleRadii: new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
      structuralCompliance: 1,
      selfCollisionEnabled: true,
      solverIterations: 8,
    });
    const runtime = createRuntime(model);

    const result = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.selfCollisionPairCount).toBeGreaterThanOrEqual(3);
    expect(result.receipt.selfCollisionCandidateCheckCount).toBeGreaterThan(0);
    expect(result.receipt.selfCollisionBroadphaseWorkUnits).toBeGreaterThan(
      result.receipt.selfCollisionCandidateCheckCount,
    );
    expect(result.receipt.diagnostics.selfCollisionLambdaL1).toBeGreaterThan(0);
    expect(particleDistance(runtime.positions, 0, 3)).toBeGreaterThan(0);
    expect(result.receipt.diagnostics.maxSelfCollisionPenetration).toBeLessThan(0.2);
  });

  it("produces byte-identical typed arrays and receipts for identical runs", () => {
    const model = compileModel({
      fixedParticleIndices: new Uint32Array([0]),
      gravity: [0, -9.81, 0],
      selfCollisionEnabled: true,
    });
    const runtimeA = createRuntime(model);
    const runtimeB = createRuntime(model);
    const frame = {
      expectedStepIndex: 0,
      kinematicPins: [{
        particle: 1,
        previous: [1, 1, 0] as const,
        current: [1.01, 1.02, 0] as const,
      }],
      capsules: [{
        id: "body",
        previousHead: [0.5, -1, 0.4] as const,
        previousTail: [0.5, 2, 0.4] as const,
        currentHead: [0.5, -1, 0.4] as const,
        currentTail: [0.5, 2, 0.4] as const,
        radius: 0.1,
      }],
    };

    const resultA = stepStudioClothXpbdV2(runtimeA, frame);
    const resultB = stepStudioClothXpbdV2(runtimeB, frame);

    expect(resultA).toEqual(resultB);
    expect(runtimeA.positions).toEqual(runtimeB.positions);
    expect(runtimeA.velocities).toEqual(runtimeB.velocities);
    expect(resultA.ok && resultA.receipt.determinismScope).toBe(
      STUDIO_CLOTH_XPBD_DETERMINISM_SCOPE,
    );
    expect(resultA.ok && resultA.receipt.fixedStepSeconds).toBe(
      STUDIO_CLOTH_XPBD_FIXED_STEP_SECONDS,
    );
  });

  it("fails closed for stale frames, malformed colliders, and topology mutation", () => {
    const model = compileModel();
    const runtime = createRuntime(model);
    const positionsBefore = new Float32Array(runtime.positions);
    const velocitiesBefore = new Float32Array(runtime.velocities);

    const stale = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 1 });
    expect(stale).toMatchObject({ ok: false, code: "stale-step" });

    const malformed = stepStudioClothXpbdV2(runtime, {
      expectedStepIndex: 0,
      capsules: [{
        id: "bad",
        previousHead: [Number.NaN, 0, 0],
        previousTail: [0, 1, 0],
        currentHead: [0, 0, 0],
        currentTail: [0, 1, 0],
        radius: 0.1,
      }],
    });
    expect(malformed).toMatchObject({ ok: false, code: "invalid-input" });
    expect(runtime.positions).toEqual(positionsBefore);
    expect(runtime.velocities).toEqual(velocitiesBefore);
    expect(runtime.stepIndex).toBe(0);

    model.restPositions[0] = 0.25;
    const mutated = stepStudioClothXpbdV2(runtime, { expectedStepIndex: 0 });
    expect(mutated).toMatchObject({ ok: false, code: "topology-mismatch" });
    expect(runtime.positions).toEqual(positionsBefore);
    expect(runtime.stepIndex).toBe(0);
  });

  it("returns failure unions instead of throwing for null, malformed, and hostile JS inputs", () => {
    const model = compileModel();
    const runtime = createRuntime(model);
    const hostile = new Proxy({}, {
      get() {
        throw new Error("hostile getter");
      },
    });
    const calls: Array<() => unknown> = [
      () => compileStudioClothXpbdModelV2(
        null as unknown as StudioClothXpbdCompileInputV2,
      ),
      () => compileStudioClothXpbdModelV2(
        [] as unknown as StudioClothXpbdCompileInputV2,
      ),
      () => compileStudioClothXpbdModelV2(
        hostile as unknown as StudioClothXpbdCompileInputV2,
      ),
      () => createStudioClothXpbdRuntimeV2(
        null as unknown as StudioClothXpbdCompiledModelV2,
      ),
      () => createStudioClothXpbdRuntimeV2(
        hostile as unknown as StudioClothXpbdCompiledModelV2,
      ),
      () => createStudioClothXpbdRuntimeV2(
        model,
        [] as unknown as { readonly positions?: Float32Array },
      ),
      () => stepStudioClothXpbdV2(
        null as unknown as StudioClothXpbdRuntimeV2,
        { expectedStepIndex: 0 },
      ),
      () => stepStudioClothXpbdV2(
        runtime,
        null as unknown as { readonly expectedStepIndex: number },
      ),
      () => stepStudioClothXpbdV2(
        runtime,
        hostile as unknown as { readonly expectedStepIndex: number },
      ),
      () => stepStudioClothXpbdV2(runtime, {
        expectedStepIndex: 0,
        kinematicPins: [null] as unknown as [],
      }),
    ];

    for (const call of calls) {
      let result: unknown = undefined;
      expect(() => {
        result = call();
      }).not.toThrow();
      expect(result).toMatchObject({ ok: false, code: "invalid-input" });
    }
    expect(runtime.stepIndex).toBe(0);
  });

  it("charges adversarial spatial-hash candidates against the work budget", () => {
    const particleCount = 2_400;
    const positions = new Float32Array(particleCount * 3);
    const triangles = new Uint32Array(particleCount);
    const radii = new Float32Array(particleCount).fill(
      STUDIO_CLOTH_XPBD_V2_BUDGETS.minParticleRadius,
    );
    radii[0] = STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticleRadius;
    for (let triangle = 0; triangle < particleCount / 3; triangle += 1) {
      const particle = triangle * 3;
      const x = (triangle % 20) * 0.1;
      const y = (Math.floor(triangle / 20) % 20) * 0.1;
      const z = Math.floor(triangle / 400) * 0.1;
      positions.set([
        x, y, z,
        x + 0.002, y, z,
        x, y + 0.002, z,
      ], particle * 3);
      triangles.set([particle, particle + 1, particle + 2], particle);
    }
    const compiled = compileStudioClothXpbdModelV2({
      restPositions: positions,
      triangleIndices: triangles,
      particleRadii: radii,
      gravity: [0, 0, 0],
      structuralCompliance: 1,
      selfCollisionEnabled: true,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtimeResult = createStudioClothXpbdRuntimeV2(compiled.model);
    expect(runtimeResult.ok).toBe(true);
    if (!runtimeResult.ok) return;
    const positionsBefore = new Float32Array(runtimeResult.runtime.positions);

    const result = stepStudioClothXpbdV2(runtimeResult.runtime, {
      expectedStepIndex: 0,
    });

    expect(result).toMatchObject({ ok: false, code: "budget-exceeded" });
    if (!result.ok) {
      expect(result.detail).toContain("candidate checks");
    }
    expect(runtimeResult.runtime.positions).toEqual(positionsBefore);
    expect(runtimeResult.runtime.stepIndex).toBe(0);
  });

  it("preflights seam collection and pair budgets before sorting or flattening", () => {
    const tooManyEmptySeams = Array.from(
      { length: STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSeams + 1 },
      (_, index) => ({
        id: `empty-${index}`,
        pairs: new Uint32Array(),
      }),
    );

    const seamCountResult = compileStudioClothXpbdModelV2({
      restPositions: QUAD_POSITIONS,
      triangleIndices: QUAD_TRIANGLES,
      seams: tooManyEmptySeams,
    });

    expect(seamCountResult).toMatchObject({
      ok: false,
      code: "budget-exceeded",
      detail: `Seam count ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSeams + 1} exceeds ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSeams}.`,
    });

    const giantPairs = new Uint32Array(
      (STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints + 1) * 2,
    );
    const pairCountResult = compileStudioClothXpbdModelV2({
      restPositions: QUAD_POSITIONS,
      triangleIndices: QUAD_TRIANGLES,
      seams: [{ id: "giant", pairs: giantPairs }],
    });

    expect(pairCountResult).toMatchObject({
      ok: false,
      code: "budget-exceeded",
    });
    if (!pairCountResult.ok) {
      expect(pairCountResult.detail).toContain("Constraint count");
      expect(pairCountResult.detail).toContain(
        `${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxConstraints}`,
      );
    }
  });

  it("rejects invalid topology and hard-budget overflow instead of truncating", () => {
    const outOfRange = compileStudioClothXpbdModelV2({
      restPositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangleIndices: new Uint32Array([0, 1, 3]),
    });
    expect(outOfRange).toMatchObject({ ok: false, code: "invalid-input" });

    const nonFinite = compileStudioClothXpbdModelV2({
      restPositions: new Float32Array([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0]),
      triangleIndices: new Uint32Array([0, 1, 2]),
    });
    expect(nonFinite).toMatchObject({ ok: false, code: "invalid-input" });

    const nonBooleanSelfCollision = compileStudioClothXpbdModelV2({
      restPositions: QUAD_POSITIONS,
      triangleIndices: QUAD_TRIANGLES,
      selfCollisionEnabled: "yes" as never,
    });
    expect(nonBooleanSelfCollision).toMatchObject({
      ok: false,
      code: "invalid-input",
      detail: "selfCollisionEnabled must be a boolean.",
    });

    const overBudget = compileStudioClothXpbdModelV2({
      restPositions: new Float32Array((STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticles + 1) * 3),
      triangleIndices: new Uint32Array([0, 1, 2]),
    });
    expect(overBudget).toMatchObject({ ok: false, code: "budget-exceeded" });

    const denseParticleCount = 516;
    const densePositions = new Float32Array(denseParticleCount * 3);
    const denseTriangles = new Uint32Array(denseParticleCount);
    const denseRadii = new Float32Array(denseParticleCount).fill(1);
    for (let triangle = 0; triangle < denseParticleCount / 3; triangle += 1) {
      const particle = triangle * 3;
      densePositions.set([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], particle * 3);
      denseTriangles.set([particle, particle + 1, particle + 2], particle);
    }
    const denseCompile = compileStudioClothXpbdModelV2({
      restPositions: densePositions,
      triangleIndices: denseTriangles,
      particleRadii: denseRadii,
      gravity: [0, 0, 0],
      structuralCompliance: 1,
      selfCollisionEnabled: true,
    });
    expect(denseCompile.ok).toBe(true);
    if (!denseCompile.ok) return;
    const denseRuntimeResult = createStudioClothXpbdRuntimeV2(denseCompile.model);
    expect(denseRuntimeResult.ok).toBe(true);
    if (!denseRuntimeResult.ok) return;
    const denseBefore = new Float32Array(denseRuntimeResult.runtime.positions);

    const denseStep = stepStudioClothXpbdV2(denseRuntimeResult.runtime, {
      expectedStepIndex: 0,
    });

    expect(denseStep).toMatchObject({ ok: false, code: "budget-exceeded" });
    expect(denseRuntimeResult.runtime.positions).toEqual(denseBefore);
    expect(denseRuntimeResult.runtime.stepIndex).toBe(0);
  });
});
