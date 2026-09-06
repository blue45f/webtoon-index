import { describe, expect, it } from "vitest";

import {
  createStudioIncrementalFxPressurePathBuilder,
} from "./studio-fx-brush";
import {
  createStudioIncrementalHighlighterWashRibbonBuilder,
  planStudioHighlighterWashRibbon,
} from "./studio-highlighter-wash-ribbon";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

import type { StudioFxPressurePathPlan, StudioFxPressurePathSegment } from "./studio-fx-brush";

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
  let x = 80;
  let y = 320;
  let heading = -0.2;
  for (let index = 0; index < pointCount; index += 1) {
    heading += (random() - 0.45) * 0.5;
    x += Math.cos(heading) * (3 + random() * 7);
    y += Math.sin(heading) * (3 + random() * 7);
    points.push(x, y);
    pressures.push(0.2 + random() * 0.75);
  }
  return { points, pressures };
}

describe("createStudioIncrementalHighlighterWashRibbonBuilder", () => {
  it.each([
    ["highlighter"],
    ["chisel-highlighter"],
    ["pastel-highlighter"],
  ] as const)(
    "matches the batch planner across production-chain growth (%s)",
    (brushId) => {
      const random = mulberry32(0x41a5);
      const { points, pressures } = growingStroke(random, 150);
      const fxBuilder = createStudioIncrementalFxPressurePathBuilder();
      const washBuilder = createStudioIncrementalHighlighterWashRibbonBuilder();
      for (let pairCount = 1; pairCount <= 150; pairCount += 1) {
        // 오버레이 `paintHighlighterSuffix`의 호출 형상: fx 빌더가 만든 같은 압력 경로를
        // 증분/배치 워시가 함께 소비한다 — 워시 빌더의 동등성만 여기서 격리 검증한다.
        const pressurePath = fxBuilder.append({
          brushId: "highlighter",
          points: points.slice(0, pairCount * 2),
          pressures: pressures.slice(0, pairCount),
          pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          tension: 0.35,
        });
        const incremental = washBuilder.plan(
          { brushId, pressurePath, baseWidth: 24 },
          fxBuilder.stableSegmentCount(),
          fxBuilder.generation(),
        );
        const batch = planStudioHighlighterWashRibbon({
          brushId,
          pressurePath,
          baseWidth: 24,
        });
        expect(incremental).toEqual({ ...batch });
      }
    },
  );

  it("rebuilds to exact parity on undo shrink and config change", () => {
    const random = mulberry32(0x77e1);
    const { points, pressures } = growingStroke(random, 90);
    const fxBuilder = createStudioIncrementalFxPressurePathBuilder();
    const washBuilder = createStudioIncrementalHighlighterWashRibbonBuilder();
    const planAt = (pairCount: number, baseWidth: number) => {
      const pressurePath = fxBuilder.append({
        brushId: "highlighter",
        points: points.slice(0, pairCount * 2),
        pressures: pressures.slice(0, pairCount),
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        tension: 0.35,
      });
      return {
        incremental: washBuilder.plan(
          { brushId: "highlighter" as const, pressurePath, baseWidth },
          fxBuilder.stableSegmentCount(),
          fxBuilder.generation(),
        ),
        batch: planStudioHighlighterWashRibbon({
          brushId: "highlighter",
          pressurePath,
          baseWidth,
        }),
      };
    };
    planAt(90, 24);
    // 되돌리기: fx 빌더 세대가 올라가고 워시도 전체 재구축한다.
    const shrunk = planAt(45, 24);
    expect(shrunk.incremental).toEqual({ ...shrunk.batch });
    // 폭 변경: 평탄화 허용 오차·halfWidth 가 모두 달라지므로 재구축되어야 한다.
    const widened = planAt(45, 31);
    expect(widened.incremental).toEqual({ ...widened.batch });
  });

  it("returns the batch empty plan for invalid widths and recovers afterwards", () => {
    const random = mulberry32(0x0bad);
    const { points, pressures } = growingStroke(random, 20);
    const fxBuilder = createStudioIncrementalFxPressurePathBuilder();
    const washBuilder = createStudioIncrementalHighlighterWashRibbonBuilder();
    const pressurePath = fxBuilder.append({
      brushId: "highlighter",
      points,
      pressures,
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.35,
    });
    for (const width of [Number.NaN, 0, -3, 24]) {
      expect(
        washBuilder.plan(
          { brushId: "highlighter", pressurePath, baseWidth: width },
          fxBuilder.stableSegmentCount(),
          fxBuilder.generation(),
        ),
      ).toEqual({
        ...planStudioHighlighterWashRibbon({
          brushId: "highlighter",
          pressurePath,
          baseWidth: width,
        }),
      });
    }
  });
});

// ── 불연속(런 분할) 성질 시험 ─────────────────────────────────────────────────────────────────
// fx 압력 경로는 첫 비유한 좌표에서 잘리므로 실제 플랜은 연속이다. 런 분할 경로(안정 구간
// 폐쇄, 휘발 구간 폐쇄, 미결 휘발 런)는 합성 세그먼트로 직접 때린다.

function lineSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  widthScale: number,
  opacityScale: number,
): StudioFxPressurePathSegment {
  return Object.freeze({
    command: "line",
    moveX: x0,
    moveY: y0,
    endX: x1,
    endY: y1,
    widthScale,
    opacityScale,
    sourceSegmentIndex: 0,
  }) as unknown as StudioFxPressurePathSegment;
}

function planOf(segments: readonly StudioFxPressurePathSegment[]): StudioFxPressurePathPlan {
  return {
    kind: "studio-fx-pressure-path",
    brushId: "highlighter",
    sourcePointCount: segments.length + 1,
    segments,
  } as unknown as StudioFxPressurePathPlan;
}

function syntheticSegments(random: () => number, count: number): StudioFxPressurePathSegment[] {
  const segments: StudioFxPressurePathSegment[] = [];
  let x = 40;
  let y = 60;
  for (let index = 0; index < count; index += 1) {
    if (random() < 0.12 && index > 0) {
      // 불연속: 다음 세그먼트가 이전 끝점에서 떨어진 곳에서 시작한다 → 런 분할.
      x += 60 + random() * 40;
      y += (random() - 0.5) * 90;
    }
    const nx = x + (random() - 0.3) * 26;
    const ny = y + (random() - 0.5) * 26;
    if (random() < 0.08) {
      // 퇴화 세그먼트: 방향이 없어 섹션으로 채택되지 않는다.
      segments.push(lineSegment(x, y, x, y, 1, 0.8));
    } else {
      segments.push(lineSegment(x, y, nx, ny, 0.4 + random(), 0.3 + random() * 0.7));
      x = nx;
      y = ny;
    }
  }
  return segments;
}

/** 매 호출 값이 바뀌는 휘발 꼬리 — 가끔은 불연속으로 시작해 활성 런을 휘발 구간에서 닫는다. */
function volatileTail(step: number): StudioFxPressurePathSegment[] {
  const gap = step % 4 === 0 ? 80 : 0;
  const x = 500 + gap + Math.sin(step * 0.8) * 30;
  const y = 140 + Math.cos(step * 0.6) * 30;
  return [
    lineSegment(x, y, x + 14 + (step % 3), y + 9, 0.8, 0.5 + (step % 5) * 0.08),
    lineSegment(x + 14 + (step % 3), y + 9, x + 25, y + 20 + (step % 2), 1.1, 0.4),
  ];
}

describe("run-splitting parity against the batch planner", () => {
  it("matches across growth with gaps in both the stable prefix and the churning tail", () => {
    const random = mulberry32(0x5eed5);
    const stable = syntheticSegments(random, 60);
    const washBuilder = createStudioIncrementalHighlighterWashRibbonBuilder();
    let step = 0;
    for (let stableCount = 0; stableCount <= stable.length; stableCount += 2) {
      step += 1;
      const current = [...stable.slice(0, stableCount), ...volatileTail(step)];
      const incremental = washBuilder.plan(
        { brushId: "pastel-highlighter", pressurePath: planOf(current), baseWidth: 18 },
        stableCount,
        1,
      );
      const batch = planStudioHighlighterWashRibbon({
        brushId: "pastel-highlighter",
        pressurePath: planOf(current),
        baseWidth: 18,
      });
      expect(incremental).toEqual({ ...batch });
    }
  });
});
