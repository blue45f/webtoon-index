import { describe, expect, it } from "vitest";

import {
  createStudioIncrementalFxPressurePathBuilder,
  planStudioFxBrushPressurePath,
} from "./studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

import type { StudioFxPressurePathSegment } from "./studio-fx-brush";

/** 결정적 의사난수 — 테스트 재현성. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growingStroke(random: () => number, pointCount: number): {
  points: number[];
  pressures: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  let x = 120;
  let y = 240;
  for (let index = 0; index < pointCount; index += 1) {
    // 가끔은 EPS 이내 중복(병합 분기), 가끔은 급커브(코너 분기)를 섞는다.
    const duplicate = index > 0 && random() < 0.08;
    if (!duplicate) {
      x += 1 + random() * 9;
      y += (random() - 0.5) * 8;
    }
    points.push(x, y);
    pressures.push(0.15 + random() * 0.8);
  }
  return { points, pressures };
}

/**
 * 유지된 옛 점의 필압은 소비 시점의 진행률로 고정되므로 신선한 배치 플랜과 최대 ulp 수준
 * 차이가 난다(빌더 doc 참조). 기하 좌표는 같은 입력에 같은 연산이라 정확히 일치해야 한다.
 */
function expectSegmentParity(
  actual: readonly StudioFxPressurePathSegment[],
  expected: readonly StudioFxPressurePathSegment[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index]! as unknown as Record<string, unknown>;
    const right = expected[index]! as unknown as Record<string, unknown>;
    expect(left.command, `segment ${index} command`).toBe(right.command);
    expect(left.sourceSegmentIndex, `segment ${index} index`).toBe(right.sourceSegmentIndex);
    for (const key of Object.keys(right)) {
      const expectedValue = right[key];
      if (typeof expectedValue !== "number") continue;
      const actualValue = left[key];
      if (key === "pressure" || key === "widthScale" || key === "opacityScale" || key === "haloScale") {
        expect(actualValue, `segment ${index} ${key}`).toBeCloseTo(expectedValue, 9);
      } else {
        expect(actualValue, `segment ${index} ${key}`).toBe(expectedValue);
      }
    }
  }
}

describe("createStudioIncrementalFxPressurePathBuilder", () => {
  it.each([
    ["tension 0 / canonical", 0, true],
    ["tension 0.35 / canonical", 0.35, true],
    ["tension 0.35 / legacy pressure", 0.35, false],
  ] as const)(
    "matches the batch planner across point-by-point growth (%s)",
    (_label, tension, canonical) => {
      const random = mulberry32(canonical ? 0xfab1e : 0x5eed);
      const { points, pressures } = growingStroke(random, 160);
      const builder = createStudioIncrementalFxPressurePathBuilder();
      for (let pairCount = 1; pairCount <= 160; pairCount += 1) {
        const input = {
          brushId: "neon" as const,
          points: points.slice(0, pairCount * 2),
          pressures: pressures.slice(0, pairCount),
          ...(canonical
            ? { pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 }
            : {}),
          tension,
        };
        const incremental = builder.append(input);
        const batch = planStudioFxBrushPressurePath(input);
        expect(incremental.sourcePointCount).toBe(batch.sourcePointCount);
        expectSegmentParity(incremental.segments, batch.segments);
      }
    },
  );

  it("matches the batch planner without a pressure channel", () => {
    const random = mulberry32(0xdead5);
    const { points } = growingStroke(random, 96);
    const builder = createStudioIncrementalFxPressurePathBuilder();
    for (let pairCount = 2; pairCount <= 96; pairCount += 7) {
      const input = {
        brushId: "glow" as const,
        points: points.slice(0, pairCount * 2),
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        tension: 0.3,
      };
      expectSegmentParity(
        builder.append(input).segments,
        planStudioFxBrushPressurePath(input).segments,
      );
    }
  });

  it("rebuilds from scratch when the consumed prefix is rewritten", () => {
    const random = mulberry32(0xbeef1);
    const { points, pressures } = growingStroke(random, 40);
    const builder = createStudioIncrementalFxPressurePathBuilder();
    const base = {
      brushId: "neon" as const,
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.35,
    };
    builder.append({ ...base, points, pressures });
    // Shift 치환·되돌리기: 소비한 prefix가 다른 좌표로 다시 쓰였다.
    const rewrittenPoints = points.slice();
    rewrittenPoints[10] = rewrittenPoints[10]! + 25;
    rewrittenPoints[rewrittenPoints.length - 2] =
      rewrittenPoints[rewrittenPoints.length - 2]! + 3;
    const incremental = builder.append({
      ...base,
      points: rewrittenPoints,
      pressures,
    });
    const batch = planStudioFxBrushPressurePath({
      ...base,
      points: rewrittenPoints,
      pressures,
    });
    // 전체 재구축 경로는 배치와 완전히 같은 입력·순서로 계산하므로 필압까지 정확히 같다.
    expect(incremental.segments).toEqual(batch.segments.slice());
  });

  it("rebuilds when the stroke shrinks (undo)", () => {
    const random = mulberry32(0xc0ffee);
    const { points, pressures } = growingStroke(random, 60);
    const builder = createStudioIncrementalFxPressurePathBuilder();
    const base = {
      brushId: "neon" as const,
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0,
    };
    builder.append({ ...base, points, pressures });
    const shrunk = {
      ...base,
      points: points.slice(0, 30 * 2),
      pressures: pressures.slice(0, 30),
    };
    expect(builder.append(shrunk).segments).toEqual(
      planStudioFxBrushPressurePath(shrunk).segments.slice(),
    );
  });

  it("delegates non-parallel pressure inputs to the batch planner verbatim", () => {
    const random = mulberry32(0xaaaa1);
    const { points, pressures } = growingStroke(random, 24);
    const builder = createStudioIncrementalFxPressurePathBuilder();
    const input = {
      brushId: "neon" as const,
      points,
      // 리샘플/레거시 문서: 필압 배열이 점과 나란하지 않다.
      pressures: pressures.slice(0, 10),
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.35,
    };
    expect(builder.append(input)).toEqual(planStudioFxBrushPressurePath(input));
  });

  it("truncates at the first non-finite coordinate exactly like the batch planner", () => {
    const random = mulberry32(0xf00d5);
    const { points, pressures } = growingStroke(random, 30);
    points[40] = Number.NaN;
    const builder = createStudioIncrementalFxPressurePathBuilder();
    for (const pairCount of [12, 19, 24, 30]) {
      const input = {
        brushId: "neon" as const,
        points: points.slice(0, pairCount * 2),
        pressures: pressures.slice(0, pairCount),
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        tension: 0.35,
      };
      expectSegmentParity(
        builder.append(input).segments,
        planStudioFxBrushPressurePath(input).segments,
      );
    }
  });
});
