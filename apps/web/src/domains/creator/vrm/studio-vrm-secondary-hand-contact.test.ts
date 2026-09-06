import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  resolveSecondaryHandConstraint,
  type Quat4,
  type VrmPropHandSocket,
} from "./studio-vrm-prop-rig";

import type { PropAnchorDef, Vec3 } from "./studio-vrm-props";

const ANCHOR: PropAnchorDef = {
  id: "secondary-grip",
  role: "secondary",
  position: [0.02, 0.14, -0.03],
  forward: [0, 0, 1],
  up: [0, 1, 0],
  gripRadius: 0.018,
};
const tuple = (q: THREE.Quaternion): Quat4 => [q.x, q.y, q.z, q.w];
const GROUP_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.6, 0.2));
const SOCKET: VrmPropHandSocket = {
  position: [0.024, -0.038, 0.011],
  rotationQuaternion: tuple(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.4, 0.15))),
  rotationDeg: [0, 0, 0],
  source: "measured",
};
const SCALES: readonly Vec3[] = [
  [1, 1, 1], [0.65, 1.55, 0.9], [1.8, 0.6, 1.1], [-1, 1.2, 0.8], [0.3, 0.3, 0.3],
];

describe("secondary hand contact", () => {
  it.each(SCALES.map((scale) => ({ scale })))("reconstructs the same palm contact with scale $scale", ({ scale }) => {
    const groupPosition: Vec3 = [0.3, 1.2, -0.5];
    const result = resolveSecondaryHandConstraint(ANCHOR, groupPosition, tuple(GROUP_QUATERNION), 1.2, SOCKET, scale);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected a valid secondary hand constraint");
    const targetRotation = new THREE.Quaternion(...result.targetHandWorldQuaternion);
    const reconstructedPalm = new THREE.Vector3(...SOCKET.position)
      .multiply(new THREE.Vector3(...scale))
      .applyQuaternion(targetRotation)
      .add(new THREE.Vector3(...result.wristWorldPosition));
    const expectedAnchor = new THREE.Vector3(...ANCHOR.position)
      .multiplyScalar(1.2)
      .applyQuaternion(GROUP_QUATERNION)
      .add(new THREE.Vector3(...groupPosition));
    expect(reconstructedPalm.distanceTo(expectedAnchor)).toBeLessThan(1e-10);
    expect(new THREE.Vector3(...result.anchorWorldPosition).distanceTo(expectedAnchor)).toBeLessThan(1e-10);
    const reconstructedSocketRotation = targetRotation.clone().multiply(new THREE.Quaternion(...SOCKET.rotationQuaternion));
    expect(reconstructedSocketRotation.angleTo(GROUP_QUATERNION)).toBeLessThan(1e-6);
  });

  it("defaults to unit scale for existing callers", () => {
    expect(resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 1], 1, SOCKET))
      .toEqual(resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 1], 1, SOCKET, [1, 1, 1]));
  });

  it("keeps the existing maximum palm-offset guard for malformed imported sockets", () => {
    const result = resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 1], 1,
      { ...SOCKET, position: [100, -100, 100] }, [100, 100, 100]);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected a bounded fallback");
    const distance = new THREE.Vector3(...result.anchorWorldPosition)
      .distanceTo(new THREE.Vector3(...result.wristWorldPosition));
    expect(distance).toBeCloseTo(0.45, 10);
    expect(result.wristWorldPosition.every(Number.isFinite)).toBe(true);
  });

  it("fails closed for non-finite transforms and invalid quaternions", () => {
    expect(resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 1], 1, SOCKET, [NaN, 1, 1])).toBeNull();
    expect(resolveSecondaryHandConstraint(ANCHOR, [Infinity, 0, 0], [0, 0, 0, 1], 1, SOCKET)).toBeNull();
    expect(resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 0], 1, SOCKET)).toBeNull();
    expect(resolveSecondaryHandConstraint(ANCHOR, [0, 0, 0], [0, 0, 0, 1], 0, SOCKET)).toBeNull();
  });
});
