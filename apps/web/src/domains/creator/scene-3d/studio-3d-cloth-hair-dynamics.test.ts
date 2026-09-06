import { describe, it, expect } from "vitest";

import { Studio3DClothHairDynamics } from "./studio-3d-cloth-hair-dynamics";

describe("Studio3DClothHairDynamics", () => {
  it("initializes a cloth particle grid with correct structural and shear constraints", () => {
    const sim = new Studio3DClothHairDynamics();
    sim.initClothGrid(4, 4, 0.1, 0); // 4x4 grid, row 0 pinned

    expect(sim.getParticles().length).toBe(16);

    // Row 0 should be pinned (invMass = 0)
    for (let i = 0; i < 4; i += 1) {
      expect(sim.getParticles()[i].invMass).toBe(0);
    }

    // Row 1-3 should be free (invMass = 1)
    for (let i = 4; i < 16; i += 1) {
      expect(sim.getParticles()[i].invMass).toBe(1.0);
    }

    expect(sim.getConstraints().length).toBeGreaterThan(20);
  });

  it("advances simulation under gravity and wind while maintaining pinned anchors", () => {
    const sim = new Studio3DClothHairDynamics({
      gravity: [0, -9.81, 0],
      windVector: [2.0, 0, 0],
    });
    sim.initClothGrid(3, 3, 0.1, 0);

    const initialPinnedY = sim.getParticles()[0].position[1];
    const initialFreeY = sim.getParticles()[8].position[1];

    // Simulate 30 steps
    for (let i = 0; i < 30; i += 1) {
      sim.step();
    }

    // Pinned anchor must not move
    expect(sim.getParticles()[0].position[1]).toBe(initialPinnedY);

    // Free bottom particles should have fallen under gravity and drifted under wind
    expect(sim.getParticles()[8].position[1]).toBeLessThan(initialFreeY);
    expect(sim.getParticles()[8].position[0]).toBeGreaterThan(0);
  });

  it("resolves collision against character body proxy capsules", () => {
    const sim = new Studio3DClothHairDynamics({
      gravity: [0, -9.81, 0],
      windVector: [0, 0, 0],
    });
    sim.initClothGrid(3, 3, 0.1, 0);

    // Place a collision cylinder capsule right underneath the falling cloth
    sim.setCollisionCapsules([
      {
        id: "thigh-proxy",
        start: [-0.5, 1.3, 0],
        end: [0.5, 1.3, 0],
        radius: 0.15,
      },
    ]);

    for (let i = 0; i < 40; i += 1) {
      sim.step();
    }

    // Center free particle should rest outside the capsule radius (>= 1.3 - radius)
    const centerParticle = sim.getParticles()[4];
    const distFromCapsuleAxis = Math.hypot(
      centerParticle.position[1] - 1.3,
      centerParticle.position[2] - 0,
    );
    expect(distFromCapsuleAxis).toBeGreaterThanOrEqual(0.14);
  });
});
