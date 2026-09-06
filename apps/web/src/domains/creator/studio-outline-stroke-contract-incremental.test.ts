import { describe, expect, it } from "vitest";

import {
  captureStudioOutlineStrokeContractV1,
  createStudioIncrementalPerfectFreehandRenderPlanner,
  planStudioPerfectFreehandRender,
} from "./studio-outline-stroke-contract";

import type { StudioOutlineStrokeContractV1 } from "./studio-outline-stroke-contract";

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
  let x = 100;
  let y = 200;
  let heading = 0.4;
  for (let index = 0; index < pointCount; index += 1) {
    const kind = random();
    if (kind < 0.06 && index > 0) {
      // 정확한 중복 위치: 정규화 병합(최대 반지름) 분기.
      points.push(points[points.length - 2]!, points[points.length - 1]!);
    } else {
      if (kind < 0.14) heading += Math.PI * (0.8 + random() * 0.4);
      else heading += (random() - 0.45) * 0.6;
      x += Math.cos(heading) * (2 + random() * 8);
      y += Math.sin(heading) * (2 + random() * 8);
      points.push(x, y);
    }
    // 0 필압 구간(빈 링/삼킴 분기)과 급변 필압을 섞는다.
    pressures.push(random() < 0.08 ? 0 : 0.1 + random() * 0.9);
  }
  return { points, pressures };
}

function capsuleContract(): StudioOutlineStrokeContractV1 {
  const contract = captureStudioOutlineStrokeContractV1({
    brushId: "gpen--croquis-capsule",
    pressureSource: "recorded",
  });
  if (!contract) throw new Error("gpen--croquis-capsule: no outline stroke contract");
  return contract;
}

/** pulled-string 프로그램 변형 — 같은 캡슐 엔진, 팔로워 워크 활성. */
function pulledStringContract(): StudioOutlineStrokeContractV1 {
  const base = capsuleContract();
  return Object.freeze({
    ...base,
    profile: Object.freeze({
      ...base.profile,
      pulledStringLengthPx: 50,
    }),
  }) as StudioOutlineStrokeContractV1;
}

describe("createStudioIncrementalPerfectFreehandRenderPlanner (croquis capsule)", () => {
  it.each([
    ["plain capsule", () => capsuleContract()],
    ["pulled-string capsule", () => pulledStringContract()],
  ] as const)(
    "matches the batch planner across point-by-point growth (%s)",
    (_label, makeContract) => {
      const random = mulberry32(0xca9541);
      const { points, pressures } = growingStroke(random, 140);
      const contract = makeContract();
      const planner = createStudioIncrementalPerfectFreehandRenderPlanner();
      for (let pairCount = 1; pairCount <= 140; pairCount += 1) {
        const input = {
          contract,
          stroker: null,
          points: points.slice(0, pairCount * 2),
          pressures: pressures.slice(0, pairCount),
          strokeWidth: 8,
          sampleSpacing: 1,
          legacyMinDistance: 1.2,
        };
        const incremental = planner.plan(input);
        const batch = planStudioPerfectFreehandRender(input);
        expect(incremental).toEqual({ ...batch });
      }
    },
  );

  it("rebuilds to exact parity on undo shrink, last-point rewrite and width change", () => {
    const random = mulberry32(0x77c4);
    const { points, pressures } = growingStroke(random, 90);
    const contract = capsuleContract();
    const planner = createStudioIncrementalPerfectFreehandRenderPlanner();
    const planAt = (pairCount: number, strokeWidth: number, sourcePoints = points) => {
      const input = {
        contract,
        stroker: null,
        points: sourcePoints.slice(0, pairCount * 2),
        pressures: pressures.slice(0, pairCount),
        strokeWidth,
        sampleSpacing: 1,
        legacyMinDistance: 1.2,
      };
      return { incremental: planner.plan(input), batch: planStudioPerfectFreehandRender(input) };
    };
    planAt(90, 8);
    const shrunk = planAt(45, 8);
    expect(shrunk.incremental).toEqual({ ...shrunk.batch });
    const rewrittenPoints = points.slice();
    rewrittenPoints[88] = rewrittenPoints[88]! + 21;
    const rewritten = planAt(45, 8, rewrittenPoints);
    expect(rewritten.incremental).toEqual({ ...rewritten.batch });
    const widened = planAt(45, 13);
    expect(widened.incremental).toEqual({ ...widened.batch });
  });

  it("matches batch fail-closed branches: bad points, bad pressure, zero-pressure stroke", () => {
    const contract = capsuleContract();
    const planner = createStudioIncrementalPerfectFreehandRenderPlanner();
    const base = {
      contract,
      stroker: null,
      strokeWidth: 8,
      sampleSpacing: 1,
      legacyMinDistance: 1.2,
    };
    // 전 구간 0 필압: 링이 전혀 없어 라운드 라인 폴백으로 떨어진다.
    const zeroInput = {
      ...base,
      points: [10, 10, 40, 20, 70, 8, 90, 30],
      pressures: [0, 0, 0, 0],
    };
    expect(planner.plan(zeroInput)).toEqual({
      ...planStudioPerfectFreehandRender(zeroInput),
    });
    // suffix 에 비유한 좌표: invalid-points (소비하지 않고 매 호출 같은 판정).
    const badPointInput = {
      ...base,
      points: [10, 10, 40, 20, Number.NaN, 8],
      pressures: [0.5, 0.6, 0.7],
    };
    expect(planner.plan(badPointInput)).toEqual({
      ...planStudioPerfectFreehandRender(badPointInput),
    });
    // 범위 밖 필압: invalid-recorded-pressure.
    const badPressureInput = {
      ...base,
      points: [10, 10, 40, 20, 60, 26],
      pressures: [0.5, 1.4, 0.7],
    };
    expect(planner.plan(badPressureInput)).toEqual({
      ...planStudioPerfectFreehandRender(badPressureInput),
    });
    // 회복: 유효 입력이 다시 오면 성장 경로로 복귀한다.
    const recovered = {
      ...base,
      points: [10, 10, 40, 20, 60, 26, 90, 12],
      pressures: [0.5, 0.6, 0.7, 0.8],
    };
    expect(planner.plan(recovered)).toEqual({
      ...planStudioPerfectFreehandRender(recovered),
    });
  });

  it("delegates non-parallel pressures and non-capsule contracts to the batch planner", () => {
    const contract = capsuleContract();
    const planner = createStudioIncrementalPerfectFreehandRenderPlanner();
    const nonParallel = {
      contract,
      stroker: null,
      points: [10, 10, 40, 20, 60, 26, 80, 40],
      pressures: [0.5, 0.6],
      strokeWidth: 8,
      sampleSpacing: 1,
      legacyMinDistance: 1.2,
    };
    expect(planner.plan(nonParallel)).toEqual(
      planStudioPerfectFreehandRender(nonParallel),
    );
    const perfectContract = captureStudioOutlineStrokeContractV1({
      brushId: "perfect-ink",
      pressureSource: "recorded",
    });
    expect(perfectContract).not.toBeNull();
    const perfectInput = {
      contract: perfectContract,
      stroker: null,
      points: [10, 10, 40, 20, 60, 26, 80, 40],
      pressures: [0.5, 0.6, 0.7, 0.8],
      strokeWidth: 8,
      sampleSpacing: 1,
      legacyMinDistance: 1.2,
    };
    expect(planner.plan(perfectInput)).toEqual(
      planStudioPerfectFreehandRender(perfectInput),
    );
  });
});
