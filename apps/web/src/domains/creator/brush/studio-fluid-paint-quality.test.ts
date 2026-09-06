import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import { studioOilProgramSetForBrush } from "./studio-brush-engine-program-set";
import { STUDIO_FLUID_PAINT_STATION_SPACING_RATIO } from "./studio-fluid-paint-reference";
import {
  planStudioOilRibbonCarrier,
  studioOilRibbonProgramsForBrush,
} from "./studio-oil-ribbon-carrier";
import { wetMixStroke } from "./studio-wet-mix";

function longStroke() {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 24; index += 1) {
    points.push(20 + index * 16, 40 + Math.sin(index / 4) * 10);
    pressures.push(0.7);
  }
  return { points, pressures };
}

/**
 * david.li Fluid Paint 의 참조 수치가 유화 계열의 엔진 옵션으로 살아 있는지 — 옵션을 켠 플랜과
 * 혼합이 실제로 다르게 나오는지 본다. 한때 이 수치를 id 로 골라 쓰던 fluid-paint* 브러시 4종은 어느
 * 카탈로그에도 등록된 적이 없어 2026-09-02 에 제거됐다. 남는 것은 옵션과 참조 수치다.
 */
describe("Fluid Paint reference in the oil family", () => {
  it("walks stations at the reference 1/8 oil pitch when a plan asks for it, so the film is a capsule splat, not beads", () => {
    const { points, pressures } = longStroke();
    const oil = planOilBrushDabs({
      points,
      pressures,
      baseWidth: 28,
      seed: 7,
    });
    const fluid = planOilBrushDabs({
      points,
      pressures,
      baseWidth: 28,
      seed: 7,
      stationSpacingRatio: STUDIO_FLUID_PAINT_STATION_SPACING_RATIO,
    });
    expect(fluid.length).toBeGreaterThan(oil.length * 3);
    expect(fluid.every((dab) => dab.bristles.length >= 5)).toBe(true);
  });

  it("upgrades the core oil and acrylic brushes to bristle physics plus GGX relief", () => {
    expect(studioOilProgramSetForBrush("oil").bristlePhysics).toBe(true);
    expect(studioOilProgramSetForBrush("oil").impastoRelief).toBe(true);
    expect(studioOilProgramSetForBrush("acrylic").bristlePhysics).toBe(true);
    expect(studioOilProgramSetForBrush("acrylic").impastoRelief).toBe(true);
    const dabs = planOilBrushDabs({ ...longStroke(), baseWidth: 26, seed: 3 });
    const plan = planStudioOilRibbonCarrier(
      dabs,
      studioOilRibbonProgramsForBrush("oil", 3),
    );
    expect(plan.impastoReliefLanes?.length ?? 0).toBeGreaterThan(0);
    expect(plan.bristleLanes.length).toBeGreaterThan(0);
  });

  it("mixes in RYB when a paint input asks for it, so red+yellow stays orange, not brown-mud", () => {
    const canvas = new Uint8ClampedArray(32 * 16 * 4);
    for (let index = 0; index < 32 * 16; index += 1) {
      const offset = index * 4;
      canvas[offset] = 255;
      canvas[offset + 1] = 0;
      canvas[offset + 2] = 0;
      canvas[offset + 3] = 255;
    }
    const mixed = wetMixStroke(
      canvas,
      32,
      16,
      [{ x: 16, y: 8 }],
      {
        radiusPx: 8,
        hardness: 0.4,
        strength: 1,
        wetness: 0.5,
        pickup: 1,
        paintColor: { r: 255, g: 255, b: 0 },
        mixModel: "ryb",
      },
    );
    const center = (8 * 32 + 16) * 4;
    expect(mixed[center]!).toBeGreaterThan(180);
    expect(mixed[center + 1]!).toBeGreaterThan(40);
    expect(mixed[center + 2]!).toBeLessThan(80);
  });
});
