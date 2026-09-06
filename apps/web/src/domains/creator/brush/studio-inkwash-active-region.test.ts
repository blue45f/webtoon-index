import { describe, expect, it } from "vitest";

import {
  createStudioLivingInkFluidReference,
  depositStudioLivingInkReference,
  stepStudioLivingInkFluidReference,
} from "../studio-living-ink-fluid-reference";

import {
  STUDIO_INKWASH_ACTIVE_REGION_CELL_BUDGET,
  studioInkwashActiveRegionSteps,
  studioInkwashFluidStepParams,
} from "./studio-inkwash-fluid";
import { getStudioInkwashWash, resetStudioInkwashWash } from "./studio-inkwash-wash";
import { planStudioWetInkBrushReplay } from "./studio-wet-ink-brush-runtime";

import type { DrawEl } from "../studio-element-model";

/**
 * 공유 워시는 페이지의 모든 수묵 획 합집합 크기로 자란다. 예전에는 획 하나를 정착시킬 때 워시
 * 전체 셀 수를 상한과 비교해 128×128 문서 px 만 넘어도 스텝을 0으로 꺼 버렸고, 그 뒤로는
 * 번짐·건조·색분리가 통째로 사라졌다. 이제 획 자신의 활성 영역만 갱신하고 예산도 그 영역으로 잰다.
 */

function inkwashPen(id: string, x0: number, x1: number, y: number): DrawEl {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const t = index / 8;
    points.push(x0 + (x1 - x0) * t, y + 2 * t);
    pressures.push(0.6);
  }
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    brush: "inkwash-pen",
    brushCatalogId: "inkwash-pen",
    points,
    pressures,
    stroke: "#101014",
    strokeWidth: 8,
    opacity: 0.7,
    watercolorPipeline: "causal-walker-v2",
  } as unknown as DrawEl;
}

describe("ink-wash active region", () => {
  it("budgets settle steps by the stroke's own region, never by the whole wash", () => {
    const huge = { width: 2048, height: 2048 };
    const small = { x0: 100, y0: 100, x1: 700, y1: 180 };
    expect(studioInkwashActiveRegionSteps(16, small, huge)).toBe(16);
    const wide = { x0: 0, y0: 0, x1: 2048, y1: 2048 };
    const budgeted = studioInkwashActiveRegionSteps(16, wide, huge);
    expect(budgeted).toBeGreaterThanOrEqual(1);
    expect(budgeted).toBeLessThan(16);
    expect(studioInkwashActiveRegionSteps(16, { x0: 0, y0: 0, x1: 0, y1: 0 }, huge)).toBe(0);
    expect(STUDIO_INKWASH_ACTIVE_REGION_CELL_BUDGET).toBe(512 * 512);
  });

  it("steps a region exactly like the full grid when the region holds every wet cell", () => {
    const full = createStudioLivingInkFluidReference({ width: 160, height: 96 });
    const clipped = createStudioLivingInkFluidReference({ width: 160, height: 96 });
    const mark = { x: 60, y: 48, radius: 6, amount: 0.9, color: [0.2, 0.15, 0.1] as const, wet: 0.8 };
    depositStudioLivingInkReference(full, mark);
    depositStudioLivingInkReference(clipped, mark);
    const params = studioInkwashFluidStepParams();
    // 젖은 영역(반경 2배)에 모세관 전진이 8스텝 동안 닿을 수 있는 거리를 넉넉히 더한 후광.
    // 후광 밖은 마른 셀이라 갱신이 항등이므로 안쪽은 전체 격자 스텝과 부동소수 정밀도로 같아야 한다.
    const halo = 40;
    const region = { x0: 60 - halo, y0: 48 - halo, x1: 60 + halo, y1: 48 + halo };
    for (let step = 0; step < 8; step += 1) {
      stepStudioLivingInkFluidReference(full, params);
      stepStudioLivingInkFluidReference(clipped, params, region);
    }
    let maxDelta = 0;
    for (let index = 0; index < full.pigment.length; index += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(full.pigment[index]! - clipped.pigment[index]!));
    }
    for (let index = 0; index < full.wet.length; index += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(full.wet[index]! - clipped.wet[index]!));
    }
    expect(maxDelta).toBeLessThan(1e-5);
  });

  it("keeps settling a second stroke after the shared wash outgrows the old global cap", () => {
    resetStudioInkwashWash();
    const first = planStudioWetInkBrushReplay(inkwashPen("first", 40, 200, 60), { phase: "committed" });
    expect(first.ok).toBe(true);
    const afterFirst = getStudioInkwashWash()!.session.simulationStep;
    expect(afterFirst).toBeGreaterThan(0);

    // 240 문서 px 아래의 두 번째 획: 공유 워시는 약 (300+여백)² 문서 px, 즉 1.4M+ 셀로 자라
    // 예전 전역 상한(512² 셀 = 128×128 문서 px)을 훌쩍 넘는다. (필드 한 변 상한 2048 셀 = 512 px 안.)
    const second = planStudioWetInkBrushReplay(inkwashPen("second", 40, 300, 300), { phase: "committed" });
    expect(second.ok).toBe(true);
    const wash = getStudioInkwashWash()!;
    expect(wash.session.fluid.width * wash.session.fluid.height).toBeGreaterThan(512 * 512);
    expect(wash.session.simulationStep).toBeGreaterThan(afterFirst);
    resetStudioInkwashWash();
  });
});
