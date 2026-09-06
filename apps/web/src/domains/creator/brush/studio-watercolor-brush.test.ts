import { describe, expect, it } from "vitest";

import {
  DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH,
  DEFAULT_WATERCOLOR_BRUSH_MAX_DABS,
  DEFAULT_WATERCOLOR_BRUSH_SEED,
  WATERCOLOR_BRUSH_DAB_CAP_RANGE,
  WATERCOLOR_BRUSH_SEED_RANGE,
  WATERCOLOR_BRUSH_SPACING_RANGE,
  WATERCOLOR_BRUSH_WIDTH_RANGE,
  normalizeWatercolorBrushPlanSettings,
  planWatercolorBrush,
  planWatercolorBrushDabs,
  watercolorBrushSeedFromKey,
  type WatercolorBrushDab,
  type WatercolorBrushPlanInput,
} from "./studio-watercolor-brush";

function coreDabs(dabs: readonly WatercolorBrushDab[]): WatercolorBrushDab[] {
  return dabs.filter((dab) => dab.role === "core");
}

function allFiniteDabs(dabs: readonly WatercolorBrushDab[]): boolean {
  return dabs.every((dab) => Number.isFinite(dab.x) && Number.isFinite(dab.y) && Number.isFinite(dab.radius) && Number.isFinite(dab.opacity));
}

function longHorizontalPoints(count: number): number[] {
  const points: number[] = [];
  for (let index = 0; index < count; index++) points.push(index * 2, 0);
  return points;
}

describe("normalizeWatercolorBrushPlanSettings", () => {
  it("기본 폭·시드·cap·자동 간격을 안정적으로 제공한다", () => {
    const settings = normalizeWatercolorBrushPlanSettings();
    expect(settings.baseWidth).toBe(DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH);
    expect(settings.seed).toBe(DEFAULT_WATERCOLOR_BRUSH_SEED);
    expect(settings.maxDabs).toBe(DEFAULT_WATERCOLOR_BRUSH_MAX_DABS);
    expect(settings.diffuse).toBe(true);
    expect(settings.spacing).toBeCloseTo(DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH * 0.34, 10);
  });

  it("범위 밖·무효 설정을 렌더 안전 범위로 정규화한다", () => {
    const settings = normalizeWatercolorBrushPlanSettings({
      baseWidth: -10,
      seed: 10002.9,
      maxDabs: 1.7,
      spacing: 0,
      diffuse: "yes" as unknown as boolean,
    });
    expect(settings).toMatchObject({
      baseWidth: WATERCOLOR_BRUSH_WIDTH_RANGE.min,
      seed: WATERCOLOR_BRUSH_SEED_RANGE.max,
      maxDabs: WATERCOLOR_BRUSH_DAB_CAP_RANGE.min,
      diffuse: true,
    });
    expect(settings.spacing).toBe(WATERCOLOR_BRUSH_SPACING_RANGE.min);

    const malformed = normalizeWatercolorBrushPlanSettings({
      baseWidth: Number.NaN,
      seed: Number.NaN,
      maxDabs: Number.POSITIVE_INFINITY,
      spacing: Number.NEGATIVE_INFINITY,
    });
    expect(malformed.baseWidth).toBe(DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH);
    expect(malformed.seed).toBe(DEFAULT_WATERCOLOR_BRUSH_SEED);
    expect(malformed.maxDabs).toBe(DEFAULT_WATERCOLOR_BRUSH_MAX_DABS);
    expect(malformed.spacing).toBeCloseTo(DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH * 0.34, 10);
  });
});

describe("watercolorBrushSeedFromKey", () => {
  it("동일한 저장 스트로크 키는 같은 유효 시드, 다른 키는 독립적인 변주를 만든다", () => {
    const first = watercolorBrushSeedFromKey("draw-watercolor-001");
    expect(first).toBe(watercolorBrushSeedFromKey("draw-watercolor-001"));
    expect(first).toBeGreaterThanOrEqual(WATERCOLOR_BRUSH_SEED_RANGE.min);
    expect(first).toBeLessThanOrEqual(WATERCOLOR_BRUSH_SEED_RANGE.max);
    expect(first).not.toBe(watercolorBrushSeedFromKey("draw-watercolor-002"));
  });

  it("빈/비문자 키도 안전한 기본 시드로 정규화한다", () => {
    expect(watercolorBrushSeedFromKey("")).toBe(DEFAULT_WATERCOLOR_BRUSH_SEED);
    expect(watercolorBrushSeedFromKey(null)).toBe(DEFAULT_WATERCOLOR_BRUSH_SEED);
  });
});

describe("planWatercolorBrush — input safety", () => {
  it("점이 없거나 전부 무효면 빈 계획을 반환한다", () => {
    expect(planWatercolorBrush()).toMatchObject({ dabs: [], sourcePointCount: 0, totalLength: 0, capped: false });

    const malformed = planWatercolorBrush({
      points: [Number.NaN, 2, Infinity, -Infinity],
      pressures: [Number.NaN],
      baseWidth: Number.NaN,
      seed: Number.NaN,
    });
    expect(malformed).toMatchObject({ dabs: [], sourcePointCount: 0, totalLength: 0, capped: false });
  });

  it("무효 쌍·중복점·무효 필압을 건너뛰고 모든 출력값을 유한하게 만든다", () => {
    const points = [0, 0, Number.NaN, 10, 0, 0, 0, 0, 60, 20, Infinity];
    const pressures = [Number.NaN, 2, -1, Infinity, 0.9];
    const pointsBefore = points.slice();
    const pressuresBefore = pressures.slice();
    const plan = planWatercolorBrush({ points, pressures, baseWidth: 10, seed: 9, maxDabs: 24 });
    const cores = coreDabs(plan.dabs);

    expect(plan.sourcePointCount).toBe(2);
    expect(cores[0]).toMatchObject({ x: 0, y: 0, role: "core" });
    expect(cores.at(-1)).toMatchObject({ x: 60, y: 20, role: "core" });
    expect(allFiniteDabs(plan.dabs)).toBe(true);
    for (const dab of plan.dabs) {
      expect(dab.radius).toBeGreaterThan(0);
      expect(dab.opacity).toBeGreaterThan(0);
      expect(dab.opacity).toBeLessThanOrEqual(1);
    }
    expect(points).toEqual(pointsBefore);
    expect(pressures).toEqual(pressuresBefore);
  });

  it("극단적으로 큰 유한 좌표도 유한한 계획으로 제한한다", () => {
    const plan = planWatercolorBrush({
      points: [-1e100, 1e100, 1e100, -1e100],
      baseWidth: 8,
      seed: 3,
      maxDabs: 8,
    });
    expect(plan.dabs).not.toHaveLength(0);
    expect(allFiniteDabs(plan.dabs)).toBe(true);
    expect(coreDabs(plan.dabs)[0]!.x).toBe(-1_000_000);
    expect(coreDabs(plan.dabs).at(-1)!.x).toBe(1_000_000);
  });
});

describe("planWatercolorBrush — path ordering and endpoints", () => {
  const base: WatercolorBrushPlanInput = {
    points: [10, 20, 60, 20, 100, 70],
    pressures: [0.2, 0.5, 0.85],
    baseWidth: 10,
    seed: 123,
    maxDabs: 40,
  };

  it("core dab은 스트로크 진행 순서로 나오며 양 끝 좌표를 정확히 보존한다", () => {
    const plan = planWatercolorBrush(base);
    const cores = coreDabs(plan.dabs);

    expect(cores.length).toBeGreaterThanOrEqual(2);
    expect(cores[0]).toMatchObject({ x: 10, y: 20, role: "core" });
    expect(cores.at(-1)).toMatchObject({ x: 100, y: 70, role: "core" });
    expect(plan.dabs[0]!.role).toBe("core");
    // diffuse를 켠 충분한 예산에서는 station 단위로 core → diffuse 순서를 유지한다.
    for (let index = 0; index < plan.dabs.length; index += 2) {
      expect(plan.dabs[index]!.role).toBe("core");
      if (plan.dabs[index + 1]) expect(plan.dabs[index + 1]!.role).toBe("diffuse");
    }
  });

  it("동일 입력·seed는 완전히 결정적이고 seed만 바꾸면 자연 매체 변주는 바뀐다", () => {
    const first = planWatercolorBrush(base);
    const second = planWatercolorBrush(base);
    const changedSeed = planWatercolorBrush({ ...base, seed: 124 });

    expect(first).toEqual(second);
    expect(first.dabs).not.toEqual(changedSeed.dabs);
    expect(coreDabs(first.dabs)[0]).toMatchObject({ x: 10, y: 20 });
    expect(coreDabs(changedSeed.dabs).at(-1)).toMatchObject({ x: 100, y: 70 });
  });

  it("압력이 높을수록 같은 경로의 core 반경과 안료 농도가 커진다", () => {
    const plan = planWatercolorBrush({
      points: [0, 0, 100, 0],
      pressures: [0, 1],
      baseWidth: 12,
      seed: 7,
      maxDabs: 4,
    });
    const cores = coreDabs(plan.dabs);
    expect(cores).toHaveLength(2);
    expect(cores[1]!.radius).toBeGreaterThan(cores[0]!.radius);
    expect(cores[1]!.opacity).toBeGreaterThan(cores[0]!.opacity);
  });
});

describe("planWatercolorBrush — cap and roles", () => {
  it("긴 스트로크도 hard cap 이하로 제한하면서 두 종점 core를 남긴다", () => {
    const points = longHorizontalPoints(1001);
    const plan = planWatercolorBrush({
      points,
      baseWidth: 4,
      seed: 42,
      spacing: 0.25,
      maxDabs: 12,
    });
    const cores = coreDabs(plan.dabs);

    expect(plan.capped).toBe(true);
    expect(plan.dabs.length).toBeLessThanOrEqual(12);
    expect(plan.dabs).toHaveLength(12);
    expect(cores[0]).toMatchObject({ x: 0, y: 0 });
    expect(cores.at(-1)).toMatchObject({ x: 2000, y: 0 });
  });

  it("diffuse를 끄면 모든 dab이 core이고 cap을 core 연속성에 전부 쓴다", () => {
    const plan = planWatercolorBrush({
      points: longHorizontalPoints(80),
      baseWidth: 4,
      seed: 42,
      spacing: 0.25,
      maxDabs: 5,
      diffuse: false,
    });
    const cores = coreDabs(plan.dabs);

    expect(plan.capped).toBe(true);
    expect(plan.dabs).toHaveLength(5);
    expect(plan.dabs.every((dab) => dab.role === "core")).toBe(true);
    expect(cores[0]).toMatchObject({ x: 0, y: 0 });
    expect(cores.at(-1)).toMatchObject({ x: 158, y: 0 });
  });

  it("cap에 걸린 롱스트로크는 반경을 키워 인접 core가 겹치는 연속 커버리지를 유지한다", () => {
    // 4000px 경로에 station 예산 6개 → 재분배 간격 800px. 반경 보정이 없으면 지름 ≤ 8.8px의
    // 점이 800px 간격으로 놓여 구슬(string of pearls)이 된다.
    const plan = planWatercolorBrush({
      points: [0, 0, 4000, 0],
      baseWidth: 8,
      seed: 21,
      spacing: 2,
      maxDabs: 12,
    });
    const cores = coreDabs(plan.dabs);

    expect(plan.capped).toBe(true);
    expect(plan.dabs.length).toBeLessThanOrEqual(12);
    expect(cores[0]).toMatchObject({ x: 0, y: 0 });
    expect(cores.at(-1)).toMatchObject({ x: 4000, y: 0 });
    expect(allFiniteDabs(plan.dabs)).toBe(true);
    // 경로를 따라 어떤 간극도 dab 지름보다 클 수 없다: 인접 core 원이 실제로 겹쳐야 한다.
    for (let index = 1; index < cores.length; index++) {
      const previous = cores[index - 1]!;
      const current = cores[index]!;
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(distance).toBeLessThanOrEqual(previous.radius + current.radius);
    }
  });

  it("반경 보정된 capped 계획도 완전히 결정적이며 대각 경로에서도 간극이 없다", () => {
    const input: WatercolorBrushPlanInput = {
      points: [0, 0, 3000, 1500, 6000, 0],
      pressures: [0, 0.5, 1],
      baseWidth: 10,
      seed: 77,
      spacing: 1,
      maxDabs: 16,
    };
    const first = planWatercolorBrush(input);
    const second = planWatercolorBrush(input);
    expect(first).toEqual(second);
    expect(first.capped).toBe(true);
    expect(first.dabs.length).toBeLessThanOrEqual(16);

    const cores = coreDabs(first.dabs);
    for (let index = 1; index < cores.length; index++) {
      const previous = cores[index - 1]!;
      const current = cores[index]!;
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(distance).toBeLessThanOrEqual(previous.radius + current.radius);
    }
  });

  it("cap과 무관하게 작가가 고른 성긴 spacing(스티플 의도)은 반경을 키우지 않는다", () => {
    // ideal station 수가 예산 안에 들어오면 재분배가 없으므로 기존 반경 상한을 그대로 지킨다.
    const sparse = planWatercolorBrush({
      points: [0, 0, 400, 0],
      baseWidth: 8,
      seed: 5,
      spacing: 100,
      maxDabs: 64,
    });
    expect(sparse.capped).toBe(false);
    for (const dab of sparse.dabs) {
      expect(dab.radius).toBeLessThanOrEqual(8 * 1.7);
    }
    const cores = coreDabs(sparse.dabs);
    for (const core of cores) {
      expect(core.radius).toBeLessThanOrEqual(8 * 1.1);
    }
  });

  it("cap을 1로 요청해도 endpoint 계약을 위해 2로 정규화하고 diffuse를 생략한다", () => {
    const plan = planWatercolorBrush({
      points: [3, 4, 30, 40],
      baseWidth: 8,
      seed: 1,
      maxDabs: 1,
    });
    expect(plan.settings.maxDabs).toBe(2);
    expect(plan.dabs).toHaveLength(2);
    expect(plan.dabs.every((dab) => dab.role === "core")).toBe(true);
    expect(coreDabs(plan.dabs)[0]).toMatchObject({ x: 3, y: 4 });
    expect(coreDabs(plan.dabs).at(-1)).toMatchObject({ x: 30, y: 40 });
  });
});

describe("planWatercolorBrush — single point and convenience API", () => {
  it("한 점은 정확한 core와 선택적 diffuse 한 쌍으로 표현한다", () => {
    const plan = planWatercolorBrush({ points: [3, 4], pressures: [0.8], baseWidth: 9, seed: 55 });
    expect(plan.capped).toBe(false);
    expect(plan.totalLength).toBe(0);
    expect(plan.dabs).toHaveLength(2);
    expect(plan.dabs[0]).toMatchObject({ x: 3, y: 4, role: "core" });
    expect(plan.dabs[1]!.role).toBe("diffuse");
  });

  it("dabs 편의 함수는 완전한 계획의 dab 배열과 일치한다", () => {
    const input: WatercolorBrushPlanInput = {
      points: [0, 0, 40, 10],
      pressures: [0.4, 0.7],
      baseWidth: 6,
      seed: 88,
      maxDabs: 16,
    };
    expect(planWatercolorBrushDabs(input)).toEqual(planWatercolorBrush(input).dabs);
  });
});
