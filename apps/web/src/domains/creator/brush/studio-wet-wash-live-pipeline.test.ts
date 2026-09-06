import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
  planCausalWatercolorBrushDabs,
} from "../studio-causal-watercolor-brush";

import { applyStudioBrushAliasWatercolorMaterial } from "./studio-brush-alias-profile";
import {
  createStudioIncrementalWetRibbonCarrier,
  planStudioWetRibbonCarrier,
} from "./studio-wet-ribbon-carrier";
import {
  planStudioWetWashLivePipeline,
  resetStudioWetWashLivePipelineCacheForTests,
} from "./studio-wet-wash-live-pipeline";

import type { StudioWetRibbonSourceDab } from "./studio-wet-ribbon-carrier";

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
  let x = 140;
  let y = 260;
  let heading = 0.3;
  for (let index = 0; index < pointCount; index += 1) {
    heading += (random() - 0.42) * 0.5;
    x += Math.cos(heading) * (2 + random() * 6);
    y += Math.sin(heading) * (2 + random() * 6);
    points.push(x, y);
    pressures.push(0.2 + random() * 0.75);
  }
  return { points, pressures };
}

const GRANULAR = "watercolor--granular";
const CARRIER_SEED = 4171;

function granularDraftInput(points: readonly number[], pressures: readonly number[]) {
  return {
    points,
    pressures,
    baseWidth: 30,
    seed: CARRIER_SEED,
    maxDabs: DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
    previewEndpoint: true,
  };
}

/** `StudioDrawNode` 활성 초안의 배치 체인 — 파이프라인이 값으로 재현해야 하는 정본. */
function batchChain(points: readonly number[], pressures: readonly number[]) {
  const planned = planCausalWatercolorBrushDabs(granularDraftInput(points, pressures), false);
  const scaled = applyStudioBrushAliasWatercolorMaterial(
    GRANULAR,
    planned,
    CARRIER_SEED,
    "live",
  );
  return {
    dabs: scaled,
    carrierPlan: planStudioWetRibbonCarrier(scaled, { seed: CARRIER_SEED }),
  };
}

beforeEach(() => {
  resetStudioWetWashLivePipelineCacheForTests();
});

describe("planStudioWetWashLivePipeline", () => {
  it("matches the batch chain across point-by-point growth", () => {
    const random = mulberry32(0x11ce);
    const { points, pressures } = growingStroke(random, 180);
    for (let pairCount = 1; pairCount <= 180; pairCount += 1) {
      const prefixPoints = points.slice(0, pairCount * 2);
      const prefixPressures = pressures.slice(0, pairCount);
      const live = planStudioWetWashLivePipeline("growth", {
        brushId: GRANULAR,
        input: granularDraftInput(prefixPoints, prefixPressures),
        carrierSeed: CARRIER_SEED,
      });
      const batch = batchChain(prefixPoints, prefixPressures);
      expect(live).not.toBeNull();
      expect(live!.dabs).toEqual(batch.dabs);
      expect(live!.carrierPlan).toEqual(batch.carrierPlan);
    }
  });

  it("rebuilds to exact parity on undo shrink and last-point rewrite", () => {
    const random = mulberry32(0xacc7);
    const { points, pressures } = growingStroke(random, 120);
    const grow = (pairCount: number) =>
      planStudioWetWashLivePipeline("rebuild", {
        brushId: GRANULAR,
        input: granularDraftInput(points.slice(0, pairCount * 2), pressures.slice(0, pairCount)),
        carrierSeed: CARRIER_SEED,
      });
    grow(120);

    // 되돌리기: 소비한 prefix 가 줄었다 → 플래너 세대 증가 → 캐리어까지 전체 재구축.
    const shrunk = grow(60);
    const shrunkBatch = batchChain(points.slice(0, 120), pressures.slice(0, 60));
    expect(shrunk!.dabs).toEqual(shrunkBatch.dabs);
    expect(shrunk!.carrierPlan).toEqual(shrunkBatch.carrierPlan);

    // 마지막 채택 표본 재작성: O(1) 앵커가 감지하는 재작성 형태(플래너 계약 참조).
    const rewrittenPoints = points.slice(0, 120);
    rewrittenPoints[118] = rewrittenPoints[118]! + 17;
    const rewritten = planStudioWetWashLivePipeline("rebuild", {
      brushId: GRANULAR,
      input: granularDraftInput(rewrittenPoints, pressures.slice(0, 60)),
      carrierSeed: CARRIER_SEED,
    });
    const rewrittenBatch = batchChain(rewrittenPoints, pressures.slice(0, 60));
    expect(rewritten!.dabs).toEqual(rewrittenBatch.dabs);
    expect(rewritten!.carrierPlan).toEqual(rewrittenBatch.carrierPlan);
  });

  it("delegates wet-texture program lanes to the batch chain (null)", () => {
    const random = mulberry32(0xb100);
    const { points, pressures } = growingStroke(random, 12);
    expect(
      planStudioWetWashLivePipeline("bloom", {
        // 레인 행이 wet-edge-bloom 프로그램을 핀한다 — 전획 물리 단계가 있어 증분 대상이 아니다.
        brushId: "watercolor--edge-bloom",
        input: granularDraftInput(points, pressures),
        carrierSeed: CARRIER_SEED,
      }),
    ).toBeNull();
    expect(
      planStudioWetWashLivePipeline("bake", {
        brushId: "ink-wash--living-bake",
        input: granularDraftInput(points, pressures),
        carrierSeed: CARRIER_SEED,
      }),
    ).toBeNull();
  });
});

// ── 캐리어 단독 성질 시험 ─────────────────────────────────────────────────────────────────────
// 파이프라인 성장 시험은 실제 플래너가 만드는 dab 흐름만 지나간다. 여기서는 안정/휘발 경계를
// 직접 조종해 배치와 어긋나기 쉬운 지점(휘발 꼬리 치환, 탭 전이, 캡, 역방향, 중복 스테이션,
// 비유한 dab)을 명시적으로 때린다.

function syntheticStableDabs(random: () => number, stationCount: number): StudioWetRibbonSourceDab[] {
  const dabs: StudioWetRibbonSourceDab[] = [];
  let x = 60;
  let y = 90;
  let heading = 0.1;
  for (let index = 0; index < stationCount; index += 1) {
    const kind = random();
    if (kind < 0.08 && index > 0) {
      // 중복 스테이션: 같은 좌표의 코어 — 세그먼트 스킵 분기(POINT_EPSILON)와 previousEdge 유지.
    } else if (kind < 0.16) {
      // 급반전: previousEdge 재사용 불가 분기(방향 내적 <= 0).
      heading += Math.PI * (0.9 + random() * 0.2);
      x += Math.cos(heading) * (6 + random() * 8);
      y += Math.sin(heading) * (6 + random() * 8);
    } else {
      heading += (random() - 0.5) * 0.6;
      x += Math.cos(heading) * (4 + random() * 7);
      y += Math.sin(heading) * (4 + random() * 7);
    }
    const radius = 3 + random() * 6;
    const opacity = random() < 0.06 ? 0 : 0.05 + random() * 0.5;
    dabs.push({ x, y, radius, opacity, role: "core" });
    if (random() < 0.15) {
      // 비유한 코어: collectStations 가 건너뛰는 분기.
      dabs.push({ x: Number.NaN, y, radius, opacity: 0.4, role: "core" });
    }
    if (random() < 0.85) {
      dabs.push({
        x: x + 1,
        y: y - 1,
        radius: radius * (1.4 + random() * 0.8),
        opacity: 0.04 + random() * 0.2,
        role: "diffuse",
      });
    }
  }
  return dabs;
}

/** 매 호출 값이 바뀌는 미리보기 꼬리 — 프리뷰 dab 치환을 흉내 낸다. */
function volatileTail(step: number): StudioWetRibbonSourceDab[] {
  return [
    {
      x: 400 + Math.sin(step * 0.7) * 40,
      y: 200 + Math.cos(step * 0.9) * 40,
      radius: 4 + (step % 5),
      opacity: 0.1 + (step % 7) * 0.05,
      role: "core",
    },
    {
      x: 401 + Math.sin(step * 0.7) * 40,
      y: 199 + Math.cos(step * 0.9) * 40,
      radius: 9 + (step % 4),
      opacity: 0.06 + (step % 5) * 0.02,
      role: "diffuse",
    },
  ];
}

describe("createStudioIncrementalWetRibbonCarrier", () => {
  it.each([
    ["default cap", undefined],
    ["tiny cap (stable-region cap break)", 9],
  ] as const)(
    "matches the batch carrier across growth with a churning volatile tail (%s)",
    (_label, maxFootprints) => {
      const random = mulberry32(0xca44);
      const stable = syntheticStableDabs(random, 40);
      const carrier = createStudioIncrementalWetRibbonCarrier();
      const options = { seed: 7, ...(maxFootprints ? { maxFootprints } : {}) };
      let step = 0;
      for (let stableCount = 0; stableCount <= stable.length; stableCount += 3) {
        step += 1;
        const current = [...stable.slice(0, stableCount), ...volatileTail(step)];
        const incremental = carrier.plan(current, stableCount, 1, options);
        const batch = planStudioWetRibbonCarrier(current, options);
        expect(incremental).toEqual({ ...batch });
      }
    },
  );

  it("keeps tap → segment transition and empty input in parity", () => {
    const carrier = createStudioIncrementalWetRibbonCarrier();
    const options = { seed: 11 };
    const core = (x: number, y: number): StudioWetRibbonSourceDab => ({
      x,
      y,
      radius: 5,
      opacity: 0.3,
      role: "core",
    });
    const steps: Array<{ dabs: StudioWetRibbonSourceDab[]; stable: number }> = [
      { dabs: [], stable: 0 },
      // 탭: 스테이션 하나(휘발) — 방향성 잎.
      { dabs: [core(50, 50)], stable: 0 },
      // 같은 탭이 안정으로 넘어와도 잎은 그대로.
      { dabs: [core(50, 50)], stable: 1 },
      // 두 번째 스테이션: 잎이 사라지고 세그먼트가 시작된다.
      { dabs: [core(50, 50), core(60, 54)], stable: 1 },
      // 완전 중복 스테이션: 세그먼트 스킵 분기.
      { dabs: [core(50, 50), core(60, 54), core(60, 54), core(72, 60)], stable: 2 },
    ];
    for (const { dabs, stable } of steps) {
      expect(carrier.plan(dabs, stable, 1, options)).toEqual({
        ...planStudioWetRibbonCarrier(dabs, options),
      });
    }
  });

  it("rebuilds when the source generation or options change", () => {
    const random = mulberry32(0x9e4e);
    const stable = syntheticStableDabs(random, 24);
    const carrier = createStudioIncrementalWetRibbonCarrier();
    carrier.plan(stable, stable.length, 1, { seed: 7 });
    // 세대 증가 + 더 짧은 배열(되돌리기): 전체 재구축 후에도 배치와 동일.
    const shrunk = stable.slice(0, Math.floor(stable.length / 2));
    expect(carrier.plan(shrunk, shrunk.length, 2, { seed: 7 })).toEqual({
      ...planStudioWetRibbonCarrier(shrunk, { seed: 7 }),
    });
    // 시드 변경: 탭 각/경계 방향 해시가 달라지므로 재구축되어야 한다.
    expect(carrier.plan(shrunk, shrunk.length, 2, { seed: 8 })).toEqual({
      ...planStudioWetRibbonCarrier(shrunk, { seed: 8 }),
    });
  });
});
