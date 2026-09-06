import { describe, expect, it } from "vitest";

import {
  createStudioGeometryRandom,
  STUDIO_GEOMETRY_MAX_NOISE_OCTAVES,
  studioGeometryFractalNoise3,
  studioGeometryHash32,
  studioGeometryHashUnit,
  studioGeometryNormalizeSeed,
  studioGeometryRandomBarycentric,
  studioGeometryRandomUnitVector,
  studioGeometryValueNoise3,
} from "./studio-geometry-nodes-random";

function take(seed: number, count: number): number[] {
  const random = createStudioGeometryRandom(seed);
  return Array.from({ length: count }, () => random.nextUint32());
}

describe("studio-geometry-nodes-random", () => {
  it("같은 시드는 비트 단위로 같은 시퀀스를 낸다", () => {
    const first = take(12345, 32);
    const second = take(12345, 32);
    expect(second).toEqual(first);
  });

  it("다른 시드는 다른 시퀀스를 낸다", () => {
    const a = take(1, 16);
    const b = take(2, 16);
    expect(a).not.toEqual(b);
    // 첫 값이 우연히 같을 확률을 배제하기 위해 겹치는 원소 개수도 확인한다.
    const shared = a.filter((value) => b.includes(value)).length;
    expect(shared).toBe(0);
  });

  it("nextUint32 는 부호 없는 32비트 정수 범위 안이다", () => {
    const random = createStudioGeometryRandom(7);
    for (let i = 0; i < 512; i++) {
      const value = random.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("nextFloat 는 [0,1) 이고 평균이 0.5 근처다", () => {
    const random = createStudioGeometryRandom(99);
    let sum = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i++) {
      const value = random.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / samples).toBeGreaterThan(0.49);
    expect(sum / samples).toBeLessThan(0.51);
  });

  it("nextBelow 는 항상 [0,bound) 정수이고 bound<=0 이면 0 이다", () => {
    const random = createStudioGeometryRandom(3);
    for (let i = 0; i < 200; i++) {
      const value = random.nextBelow(7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
    expect(random.nextBelow(0)).toBe(0);
    expect(random.nextBelow(-5)).toBe(0);
  });

  it("nextRange 는 min>=max 면 min 을 그대로 준다", () => {
    const random = createStudioGeometryRandom(11);
    expect(random.nextRange(5, 5)).toBe(5);
    expect(random.nextRange(9, 2)).toBe(9);
  });

  it("비정수·비유한 시드도 결정적인 32비트 값으로 접힌다", () => {
    expect(studioGeometryNormalizeSeed(Number.NaN)).toBe(0);
    expect(studioGeometryNormalizeSeed(Number.POSITIVE_INFINITY)).toBe(0);
    expect(studioGeometryNormalizeSeed(-1)).toBe(4_294_967_295);
    expect(take(3.9, 4)).toEqual(take(3, 4));
  });

  it("좌표 해시는 위치·시드에 모두 반응하고 [0,1) 로 정규화된다", () => {
    expect(studioGeometryHash32(1, 2, 3, 0)).toBe(studioGeometryHash32(1, 2, 3, 0));
    expect(studioGeometryHash32(1, 2, 3, 0)).not.toBe(studioGeometryHash32(1, 2, 4, 0));
    expect(studioGeometryHash32(1, 2, 3, 0)).not.toBe(studioGeometryHash32(1, 2, 3, 1));
    for (const [x, y, z] of [
      [0, 0, 0],
      [17, -4, 9],
      [-1, -1, -1],
    ]) {
      const unit = studioGeometryHashUnit(x, y, z, 42);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it("값 노이즈는 정수 격자점에서 격자 해시와 정확히 일치한다", () => {
    // 삼선형 가중치가 격자점에서 (1,0) 이 되므로 보간 결과가 해시 그 자체여야 한다.
    for (const [x, y, z] of [
      [0, 0, 0],
      [3, -2, 5],
    ]) {
      expect(studioGeometryValueNoise3(x, y, z, 8)).toBeCloseTo(
        studioGeometryHashUnit(x, y, z, 8),
        12
      );
    }
  });

  it("값 노이즈는 [0,1) 이며 연속적이다(격자 사이에서 튀지 않음)", () => {
    let previous = studioGeometryValueNoise3(0, 0, 0, 5);
    for (let step = 1; step <= 200; step++) {
      const value = studioGeometryValueNoise3(step / 100, 0, 0, 5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Math.abs(value - previous)).toBeLessThan(0.2);
      previous = value;
    }
  });

  it("프랙탈 노이즈는 옥타브를 1~5 로 클램프하고 결정적이다", () => {
    const inRange = studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, 3);
    expect(inRange).toBe(studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, 3));
    expect(studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, 99)).toBe(
      studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, STUDIO_GEOMETRY_MAX_NOISE_OCTAVES)
    );
    expect(studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, 0)).toBe(
      studioGeometryFractalNoise3(0.3, 0.7, 1.1, 4, 1)
    );
    expect(inRange).toBeGreaterThanOrEqual(0);
    expect(inRange).toBeLessThan(1);
  });

  it("단위 벡터는 길이 1 이고 삼각함수 없이 결정적이다", () => {
    const a = createStudioGeometryRandom(2024);
    const b = createStudioGeometryRandom(2024);
    for (let i = 0; i < 64; i++) {
      const va = studioGeometryRandomUnitVector(a);
      const vb = studioGeometryRandomUnitVector(b);
      expect(vb).toEqual(va);
      const length = Math.sqrt(va[0] * va[0] + va[1] * va[1] + va[2] * va[2]);
      expect(length).toBeCloseTo(1, 12);
    }
  });

  it("배리센트릭 좌표는 합이 1 이고 모두 음이 아니며 난수를 정확히 2개 쓴다", () => {
    const probe = createStudioGeometryRandom(555);
    const before = probe.state();
    const [a, b, c] = studioGeometryRandomBarycentric(probe);
    expect(a + b + c).toBeCloseTo(1, 12);
    expect(Math.min(a, b, c)).toBeGreaterThanOrEqual(0);
    // 정확히 2번 전진했는지 — 같은 시드로 2번 뽑은 스트림의 상태와 일치해야 한다.
    const reference = createStudioGeometryRandom(555);
    expect(reference.state()).toBe(before);
    reference.nextUint32();
    reference.nextUint32();
    expect(probe.state()).toBe(reference.state());
  });
});
