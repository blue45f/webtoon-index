import { describe, it, expect } from "vitest";

import { Studio3DPropHandGripSolver } from "./studio-3d-prop-hand-grip-solver";

describe("Studio3DPropHandGripSolver", () => {
  it("attaches and detaches props to sockets", () => {
    const solver = new Studio3DPropHandGripSolver();
    const katana = {
      id: "katana-01",
      name: "일본도",
      defaultSocket: "hand-right" as const,
      boundingRadius: 0.015,
      recommendedGrip: "sword-power-grip" as const,
      localOffset: [0, 0, 0] as const,
      localRotationEuler: [0, 90, 0] as const,
    };

    solver.attachProp(katana);
    expect(solver.getAttachedProps().length).toBe(1);
    expect(solver.getAttachedProps()[0].prop.name).toBe("일본도");

    solver.detachProp("katana-01");
    expect(solver.getAttachedProps().length).toBe(0);
  });

  it("solves finger joint flexion for sword power grip vs gun trigger grip", () => {
    const solver = new Studio3DPropHandGripSolver();

    const swordGrip = solver.solveHandGrip("sword-power-grip", 0.015);
    // Index finger should be curled
    expect(swordGrip.index.intermediateAngleDeg).toBeGreaterThan(60);

    const gunGrip = solver.solveHandGrip("gun-pistol-trigger", 0.02);
    // Index finger on gun trigger should remain extended
    expect(gunGrip.index.proximalAngleDeg).toBeLessThan(20);
    // Middle finger should be tightly curled
    expect(gunGrip.middle.intermediateAngleDeg).toBeGreaterThan(70);
  });

  it("adjusts finger curl tightness based on prop radius and tightness factor", () => {
    const solver = new Studio3DPropHandGripSolver();
    const tightGrip = solver.solveHandGrip("sword-power-grip", 0.01, 1.2);
    const looseGrip = solver.solveHandGrip("sword-power-grip", 0.04, 0.8);

    expect(tightGrip.middle.proximalAngleDeg).toBeGreaterThan(looseGrip.middle.proximalAngleDeg);
  });
});
