import { describe, expect, it } from "vitest";

import {
  parseVrmPhysicsSettings,
  composeSpringGravity,
  countSpringBoneJoints,
  applyVrmSpringBonePhysics,
  settleVrmPhysics,
  isDefaultVrmPhysics,
  DEFAULT_VRM_PHYSICS,
  type VrmPhysicsSettings,
  type PhysicsVrmLike,
  type SpringBoneManagerLike,
  type SpringJointLike,
  type SpringVector3Like,
} from "./studio-vrm-physics";

function makeVec(x: number, y: number, z: number): SpringVector3Like {
  return {
    x, y, z,
    set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz; },
  };
}

function makeJoint(stiffness: number, gPower: number, gDir: [number,number,number]): SpringJointLike {
  return {
    settings: {
      stiffness,
      gravityPower: gPower,
      gravityDir: makeVec(gDir[0], gDir[1], gDir[2]),
    },
  };
}

function makeManager(joints: SpringJointLike[]): SpringBoneManagerLike {
  return {
    joints,
    reset() {},
  };
}

function makeVrm(manager: SpringBoneManagerLike | null, updateCalls: number[] = []): PhysicsVrmLike {
  return {
    springBoneManager: manager,
    update(delta: number) { updateCalls.push(delta); },
  };
}

describe("studio-vrm-physics direct exports (AC3)", () => {
  it("parseVrmPhysicsSettings normalizes and clamps", () => {
    expect(parseVrmPhysicsSettings(null)).toEqual({ ...DEFAULT_VRM_PHYSICS });
    const raw = { stiffnessScale: 3, gravityScale: -1, windDirectionDeg: 200, windStrength: 5 };
    const p = parseVrmPhysicsSettings(raw);
    expect(p.stiffnessScale).toBe(2);
    expect(p.gravityScale).toBe(0);
    expect(p.windDirectionDeg).toBe(180);
    expect(p.windStrength).toBe(2);
  });

  it("isDefaultVrmPhysics detects default", () => {
    expect(isDefaultVrmPhysics(DEFAULT_VRM_PHYSICS)).toBe(true);
    expect(isDefaultVrmPhysics({ ...DEFAULT_VRM_PHYSICS, stiffnessScale: 1.1 })).toBe(false);
  });

  it("composeSpringGravity combines base + wind (horizontal via dir rotation)", () => {
    const baseDir: [number, number, number] = [0, -1, 0];
    const res = composeSpringGravity(baseDir, 0.1, { gravityScale: 1, windDirectionDeg: 90, windStrength: 1 });
    expect(res.power).toBeGreaterThan(0);
    // wind 90 deg (positive Z) should tilt the vector
    expect(res.dir[2]).not.toBe(0);
  });

  it("countSpringBoneJoints counts from manager", () => {
    const j1 = makeJoint(1, 0.1, [0,-1,0]);
    const j2 = makeJoint(1, 0.1, [0,-1,0]);
    const mgr = makeManager([j1, j2]);
    const v = makeVrm(mgr);
    expect(countSpringBoneJoints(v)).toBe(2);
    expect(countSpringBoneJoints(makeVrm(null))).toBe(0);
  });

  it("applyVrmSpringBonePhysics scales stiffness and composes gravity on joints (idempotent on base)", () => {
    const j = makeJoint(0.5, 0.2, [0, -1, 0]);
    const mgr = makeManager([j]);
    const v = makeVrm(mgr);
    const settings: VrmPhysicsSettings = { ...DEFAULT_VRM_PHYSICS, stiffnessScale: 2, windStrength: 0.5, windDirectionDeg: 0 };
    const n = applyVrmSpringBonePhysics(v, settings);
    expect(n).toBe(1);
    expect(j.settings.stiffness).toBeCloseTo(0.5 * 2);
    // gravityPower should be adjusted by compose
    expect(j.settings.gravityPower).toBeGreaterThan(0);
  });

  it("settleVrmPhysics resets and runs fixed steps calling update", () => {
    const updates: number[] = [];
    const v = makeVrm(makeManager([]), updates);
    settleVrmPhysics(v, 3, 1/60);
    expect(updates.length).toBe(3);
    expect(updates.every(d => d === 1/60)).toBe(true);
  });
});