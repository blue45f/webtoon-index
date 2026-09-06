import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createTwoBoneDefaultPoleTarget,
  solveTwoBoneTarget,
} from "./studio-rig-two-bone-ik";

function expectLengthPreserved(
  result: NonNullable<ReturnType<typeof solveTwoBoneTarget>>,
  upperLength: number,
  lowerLength: number,
) {
  expect(result.start.distanceTo(result.elbow)).toBeCloseTo(upperLength, 10);
  expect(result.elbow.distanceTo(result.end)).toBeCloseTo(lowerLength, 10);
}

describe("engine-neutral two-bone IK solver", () => {
  it("derives a non-collinear deterministic pole for straight chains on any primary axis", () => {
    for (const end of [[2, 0, 0], [0, 2, 0], [0, 0, 2]] as const) {
      const middle = end.map((value) => value / 2) as [number, number, number];
      const pole = new THREE.Vector3(...createTwoBoneDefaultPoleTarget([0, 0, 0], middle, end));
      const axis = new THREE.Vector3(...end).normalize();
      const fromStart = pole.clone();
      const perpendicularMagnitude = fromStart.addScaledVector(
        axis,
        -fromStart.dot(axis),
      ).length();
      expect(perpendicularMagnitude).toBeGreaterThan(0.9);
    }
  });

  it("preserves the authored rest-pose bend side when deriving a default pole", () => {
    const pole = createTwoBoneDefaultPoleTarget([0, 0, 0], [1, 1, 0], [2, 0, 0]);
    expect(pole[1]).toBeGreaterThan(1);
    expect(pole.every(Number.isFinite)).toBe(true);
  });

  it("honors opposite pole directions for very small valid rigs", () => {
    const start = new THREE.Vector3(0, 0, 0);
    const elbow = new THREE.Vector3(1e-5, 0, 0);
    const end = new THREE.Vector3(2e-5, 0, 0);
    const target = new THREE.Vector3(1e-5, 0, 0);

    const positive = solveTwoBoneTarget(
      start,
      elbow,
      end,
      target,
      new THREE.Vector3(0, 0, 1e-5),
    );
    const negative = solveTwoBoneTarget(
      start,
      elbow,
      end,
      target,
      new THREE.Vector3(0, 0, -1e-5),
    );

    expect(positive).not.toBeNull();
    expect(negative).not.toBeNull();
    expect(positive!.elbow.z).toBeGreaterThan(0);
    expect(negative!.elbow.z).toBeLessThan(0);
    expectLengthPreserved(positive!, 1e-5, 1e-5);
    expectLengthPreserved(negative!, 1e-5, 1e-5);
  });

  it("normalizes huge finite poles without collapsing the solved triangle", () => {
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1e308),
    );

    expect(result).not.toBeNull();
    expect(result!.poleDirection.toArray().every(Number.isFinite)).toBe(true);
    expect(result!.poleDirection.z).toBeCloseTo(1, 12);
    expectLengthPreserved(result!, 1, 1);
  });

  it("uses a scale-independent target direction and never mutates caller vectors", () => {
    const start = new THREE.Vector3(0, 0, 0);
    const elbow = new THREE.Vector3(0, 1e-5, 0);
    const end = new THREE.Vector3(0, 2e-5, 0);
    const target = new THREE.Vector3(0, 0, 1e-5);
    const pole = new THREE.Vector3(1e-5, 0, 0);
    const snapshots = [start, elbow, end, target, pole].map((value) => value.clone());

    const result = solveTwoBoneTarget(start, elbow, end, target, pole);

    expect(result).not.toBeNull();
    expect(result!.end.z).toBeGreaterThan(0);
    expect(Math.abs(result!.end.x)).toBeLessThan(1e-12);
    expect(Math.abs(result!.end.y)).toBeLessThan(1e-12);
    [start, elbow, end, target, pole].forEach((value, index) => {
      expect(value.equals(snapshots[index]!)).toBe(true);
    });
  });

  it("preserves both segments across extreme valid length ratios", () => {
    const upperLength = 10_000;
    const lowerLength = 0.00001;
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(upperLength, 0, 0),
      new THREE.Vector3(upperLength + lowerLength, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1),
      [upperLength, lowerLength],
    );

    expect(result).not.toBeNull();
    expect(result!.start.distanceTo(result!.elbow)).toBeCloseTo(upperLength, 8);
    expect(result!.elbow.distanceTo(result!.end)).toBeCloseTo(lowerLength, 8);
  });

  it("keeps randomized near-fold and near-extension solutions finite and length preserving", () => {
    let seed = 0x51f15e;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let index = 0; index < 200; index += 1) {
      const upperLength = 10 ** (-1 + random() * 5);
      const ratio = 10 ** (-4 + random() * 4);
      const lowerLength = upperLength * ratio;
      const extension = index % 2 === 0
        ? upperLength + lowerLength
        : Math.abs(upperLength - lowerLength);
      const targetDistance = extension * (0.999999 + random() * 0.000002);
      const result = solveTwoBoneTarget(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(upperLength, 0, 0),
        new THREE.Vector3(upperLength + lowerLength, 0, 0),
        new THREE.Vector3(targetDistance, 0.1 * upperLength, 0),
        new THREE.Vector3(0, 0, upperLength),
        [upperLength, lowerLength],
      );
      expect(result, `case ${index}`).not.toBeNull();
      if (!result) continue;
      const upperError = Math.abs(result.start.distanceTo(result.elbow) - upperLength) / upperLength;
      const lowerError = Math.abs(result.elbow.distanceTo(result.end) - lowerLength) / lowerLength;
      expect(upperError, `upper case ${index}`).toBeLessThan(1e-8);
      expect(lowerError, `lower case ${index}`).toBeLessThan(1e-8);
      expect(result.end.toArray().every(Number.isFinite)).toBe(true);
      expect(result.elbow.toArray().every(Number.isFinite)).toBe(true);
    }
  });
});
