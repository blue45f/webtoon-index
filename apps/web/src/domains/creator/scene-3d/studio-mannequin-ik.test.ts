import { describe, expect, it } from "vitest";

import {
  solveStudioMannequinTwoBoneIk,
  studioMannequinEulerXyzFromMatrix,
  studioMannequinMatrixFromEulerXyz,
  type StudioMannequinIkInput,
  type StudioMannequinIkVec3,
} from "./studio-mannequin-ik";

const UPPER = 0.4;
const LOWER = 0.35;

function distance(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function solve(overrides: Partial<StudioMannequinIkInput> = {}) {
  return solveStudioMannequinTwoBoneIk({
    root: [0, 0, 0],
    target: [0.2, -0.5, 0.1],
    pole: [0, -0.2, 0.8],
    upperLength: UPPER,
    lowerLength: LOWER,
    hingeSign: 1,
    ...overrides,
  });
}

describe("studio-mannequin-ik 오일러/행렬 왕복", () => {
  it("compose→extract→compose 가 같은 회전을 재현한다", () => {
    const cases: StudioMannequinIkVec3[] = [
      [0, 0, 0],
      [0.4, -0.9, 1.2],
      [-1.2, 0.3, -0.5],
      [Math.PI / 2 - 0.01, 1.1, -2.5],
    ];
    for (const euler of cases) {
      const matrix = studioMannequinMatrixFromEulerXyz(euler);
      const extracted = studioMannequinEulerXyzFromMatrix(matrix);
      const rebuilt = studioMannequinMatrixFromEulerXyz(extracted);
      for (let index = 0; index < 9; index += 1) {
        expect(rebuilt[index]).toBeCloseTo(matrix[index], 9);
      }
    }
  });
});

describe("studio-mannequin-ik 도달", () => {
  it("도달 가능한 목표는 정확히 맞춘다(본 길이 불변 포함)", () => {
    const result = solve();
    expect(result.reachable).toBe(true);
    expect(result.clampedAtExtension).toBe(false);
    expect(result.clampedByLimits).toBe(false);
    expect(result.reached).toBe(true);
    expect(result.endDistanceToTarget).toBeLessThan(1e-6);
    expect(distance(result.middle, [0, 0, 0])).toBeCloseTo(UPPER, 9);
    expect(distance(result.end, result.middle)).toBeCloseTo(LOWER, 9);
  });

  it("체인 길이 밖 목표는 완전 신전 방향으로 클램프한다", () => {
    const result = solve({ target: [0, -1.4, 0] });
    expect(result.reachable).toBe(false);
    expect(result.clampedAtExtension).toBe(true);
    expect(distance(result.end, [0, 0, 0])).toBeCloseTo(UPPER + LOWER, 4);
    // 방향은 목표를 향한다.
    expect(result.end[1]).toBeLessThan(0);
    expect(Math.abs(result.end[0])).toBeLessThan(1e-6);
  });

  it("과수축 목표는 최소 반경으로 클램프한다", () => {
    const result = solve({ target: [0, -0.01, 0] });
    expect(result.reachable).toBe(false);
    expect(result.clampedAtExtension).toBe(true);
    expect(distance(result.end, [0, 0, 0])).toBeCloseTo(Math.abs(UPPER - LOWER), 4);
  });

  it("루트와 겹친 목표도 결정적 폴백 방향으로 안전하게 푼다", () => {
    const first = solve({ target: [0, 0, 0], pole: null });
    const second = solve({ target: [0, 0, 0], pole: null });
    expect(second).toEqual(first);
    expect(Number.isFinite(first.end[0])).toBe(true);
  });
});

describe("studio-mannequin-ik 폴 힌트", () => {
  it("폴 방향이 굽힘 평면(팔꿈치/무릎 쪽)을 결정한다", () => {
    const forward = solve({ pole: [0, -0.2, 0.8] });
    const backward = solve({ pole: [0, -0.2, -0.8] });
    expect(forward.middle[2]).toBeGreaterThan(0);
    expect(backward.middle[2]).toBeLessThan(0);
    // 양쪽 다 목표에는 도달한다.
    expect(forward.reached).toBe(true);
    expect(backward.reached).toBe(true);
  });

  it("hingeSign 은 하부 관절 굽힘 부호를 결정한다(팔 −, 다리 +)", () => {
    const leg = solve({ hingeSign: 1 });
    const arm = solve({ hingeSign: -1 });
    expect(leg.lowerEuler[0]).toBeGreaterThanOrEqual(0);
    expect(arm.lowerEuler[0]).toBeLessThanOrEqual(0);
    expect(arm.reached).toBe(true);
    // 부호 규약이 달라도 FK 결과(손끝 위치)는 동일하다.
    expect(distance(arm.end, leg.end)).toBeLessThan(1e-6);
  });
});

describe("studio-mannequin-ik 관절 한계 클램프", () => {
  it("하부 굽힘 한계가 결과를 제한하면 clampedByLimits 를 보고한다", () => {
    const result = solveStudioMannequinTwoBoneIk(
      {
        root: [0, 0, 0],
        target: [0, -0.45, 0.2],
        pole: [0, -0.2, 0.8],
        upperLength: UPPER,
        lowerLength: LOWER,
        hingeSign: 1,
      },
      { lower: { x: [0, 0.1] } },
    );
    expect(result.clampedByLimits).toBe(true);
    expect(result.lowerEuler[0]).toBeLessThanOrEqual(0.1 + 1e-9);
    // 클램프 후에도 본 길이 불변식은 유지된다(FK 재계산 계약).
    expect(distance(result.middle, [0, 0, 0])).toBeCloseTo(UPPER, 9);
    expect(distance(result.end, result.middle)).toBeCloseTo(LOWER, 9);
    expect(result.reached).toBe(false);
  });

  it("상부 한계 클램프도 FK 일관성을 유지한다", () => {
    const result = solve({ target: [0.5, 0.3, 0] });
    const limited = solveStudioMannequinTwoBoneIk(
      {
        root: [0, 0, 0],
        target: [0.5, 0.3, 0],
        pole: [0, -0.2, 0.8],
        upperLength: UPPER,
        lowerLength: LOWER,
        hingeSign: 1,
      },
      { upper: { x: [-0.2, 0.2], y: [-0.2, 0.2], z: [-0.2, 0.2] } },
    );
    expect(limited.clampedByLimits).toBe(true);
    expect(distance(limited.end, result.end)).toBeGreaterThan(0.05);
    expect(distance(limited.middle, [0, 0, 0])).toBeCloseTo(UPPER, 9);
    expect(distance(limited.end, limited.middle)).toBeCloseTo(LOWER, 9);
  });
});

describe("studio-mannequin-ik 결정성·방어", () => {
  it("같은 입력은 항상 같은 출력을 만든다", () => {
    const input: StudioMannequinIkInput = {
      root: [0.1, 1.2, -0.05],
      target: [0.42, 0.61, 0.33],
      pole: [0.2, 0.9, 0.8],
      upperLength: UPPER,
      lowerLength: LOWER,
      hingeSign: -1,
    };
    const first = solveStudioMannequinTwoBoneIk(input);
    const second = solveStudioMannequinTwoBoneIk(input);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("유효하지 않은 본 길이/좌표는 RangeError 를 던진다", () => {
    expect(() => solve({ upperLength: 0 })).toThrow(RangeError);
    expect(() => solve({ lowerLength: Number.NaN })).toThrow(RangeError);
    expect(() => solve({ target: [Number.NaN, 0, 0] })).toThrow(RangeError);
  });
});
