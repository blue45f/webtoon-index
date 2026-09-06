import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS, resolveStudioBrushRenderFamily } from "../studio-brush";

import { resolveStudioBrushAliasPencilPasses } from "./studio-brush-alias-profile";
import { resolveStudioBrushDynamicsPresetId } from "./studio-brush-dynamics-types";
import { studioBrushEngineLaneRowById } from "./studio-brush-engine-lane-catalog";
import {
  STUDIO_PENCIL_DEFAULT_ALIAS_PASS,
  studioPencilAliasPassAlpha,
  studioPencilAliasPasses,
  studioPencilAliasPassPoints,
} from "./studio-pencil-alias-passes";

const LINE = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];

describe("studioPencilAliasPasses", () => {
  it("gives an un-profiled pencil exactly one core pass", () => {
    expect(studioPencilAliasPasses("pencil-grain")).toEqual([STUDIO_PENCIL_DEFAULT_ALIAS_PASS]);
    expect(studioPencilAliasPasses(undefined)).toEqual([STUDIO_PENCIL_DEFAULT_ALIAS_PASS]);
  });

  it("passes an alias profile's own passes straight through", () => {
    for (const id of ["pencil", "soft-pencil", "pencil--side-shade"] as const) {
      expect(studioPencilAliasPasses(id)).toEqual(resolveStudioBrushAliasPencilPasses(id));
      expect(studioPencilAliasPasses(id).length).toBeGreaterThan(0);
    }
  });

  it("keeps the side-shade skirt, which only the committed renderer used to draw", () => {
    // 실측: 라이브 14px/농도 95 vs 커밋 24px/농도 32. 치마가 곧 별칭 패스였다.
    const passes = studioPencilAliasPasses("pencil--side-shade");
    expect(passes.filter(({ role }) => role === "soft-edge").length).toBeGreaterThan(2);
    expect(Math.max(...passes.map(({ widthScale }) => widthScale))).toBeGreaterThan(1.5);
  });
});

describe("studioPencilAliasPassPoints", () => {
  it("is stable under append, so an incremental live builder lands on committed geometry", () => {
    const prefix = studioPencilAliasPassPoints(LINE.slice(0, 6), 0.75);
    const full = studioPencilAliasPassPoints(LINE, 0.75);
    expect(full.slice(0, prefix.length)).toEqual(prefix);
  });

  it("scales the frozen graphite offset by the pass radius, around the source point", () => {
    const source = [12, 34];
    const wide = studioPencilAliasPassPoints(source, 1.5);
    const narrow = studioPencilAliasPassPoints(source, 0.75);
    const zero = studioPencilAliasPassPoints(source, 0);
    expect(zero).toEqual(source);
    for (let index = 0; index < source.length; index += 1) {
      const wideOffset = wide[index]! - source[index]!;
      const narrowOffset = narrow[index]! - source[index]!;
      expect(wideOffset).toBeCloseTo(narrowOffset * 2, 10);
    }
  });

  it("returns the frozen default jitter unchanged at the default radius", () => {
    expect(studioPencilAliasPassPoints(LINE, 0.75))
      .toEqual(studioPencilAliasPassPoints([...LINE], 0.75));
  });
});

describe("studioPencilAliasPassAlpha", () => {
  it("folds the pass opacity into the cell's own pressure response and clamps at 1", () => {
    expect(studioPencilAliasPassAlpha({ ...STUDIO_PENCIL_DEFAULT_ALIAS_PASS, opacityScale: 0.5 }, 1, 1))
      .toBeCloseTo(0.5, 10);
    expect(studioPencilAliasPassAlpha(STUDIO_PENCIL_DEFAULT_ALIAS_PASS, 0.25, 0.25))
      .toBeCloseTo(0.25, 10);
    expect(studioPencilAliasPassAlpha({ ...STUDIO_PENCIL_DEFAULT_ALIAS_PASS, opacityScale: 4 }, 1, 1))
      .toBe(1);
  });
});

/**
 * 겹칠 사다리 — 같은 획을 다시 그으면 진해져야 한다.
 *
 * 이 계열은 별칭 패스 알파에 요소 불투명도를 곱한 값 하나로 리본 셀을 칠하므로, 한 획이 종이에
 * 남기는 알파 A 가 곧 사다리의 전부다: N번 겹친 결과는 1 - (1 - A)^N 이다. A 가 크면 사다리가
 * 몇 계단 만에 끝난다 — `pencil` 은 0.85 로 그려 실측 평균 농도가 82.9 → 91.1 → 95.0 → 97.0 →
 * 97.9 로 3회차부터 8비트 한 계단 안이었고, 20번을 덧칠해도 화면이 그대로였다.
 *
 * 그래서 "처음 5회차 동안 매 회차가 8비트 한 계단 이상 진해진다"를 계약으로 못 박는다. 픽셀
 * 도메인의 쌍둥이 판정은 scripts/studio-brush-scenario-quality.ts 의 `buildup-lost` 이며 같은
 * 5회차 · 한 계단 기준을 쓴다.
 */
const BUILDUP_LADDER_PASSES = 5;
const ONE_8BIT_STEP = 1 / 255;

/**
 * 한 획에 사실상 불투명해지는 것이 재료 그대로인 브러시 — 눕혀 그은 6B 는 종이를 거의 덮는다.
 * 사다리를 위해 옅게 만들면 6B 가 아니라 2B 가 되므로 예외로 두되, 근불투명이라는 사실 자체를
 * 못 박아 조용히 옅어지는 것도 막는다.
 */
const NEAR_OPAQUE_BY_MEDIUM: Readonly<Record<string, number>> = Object.freeze({
  "pencil-6b": 0.85,
});

/** 별칭 패스 리본으로 칠하는 프리셋 — 도장/동적 답 캐리어로 빠지는 연필 계열은 제외된다. */
function pencilRibbonPresetIds(): readonly string[] {
  return BRUSH_PRESETS
    .filter(({ id }) => resolveStudioBrushRenderFamily(id) === "pencil")
    .filter(({ id }) => resolveStudioBrushDynamicsPresetId(id) === null)
    .filter(({ id }) => (studioBrushEngineLaneRowById(id)?.engine ?? "pencil-path") === "pencil-path")
    .map(({ id }) => id);
}

/** 중립 필압에서 한 획이 남기는 알파. 패스들은 각자 요소 불투명도로 서로 위에 합성된다. */
function strokeDepositAlpha(brushId: string): number {
  const preset = BRUSH_PRESETS.find(({ id }) => id === brushId);
  if (!preset) throw new Error(`no preset for ${brushId}`);
  let clear = 1;
  for (const pass of studioPencilAliasPasses(brushId)) {
    clear *= 1 - Math.min(1, preset.defaultOpacity * studioPencilAliasPassAlpha(pass, 1, 1));
  }
  return 1 - clear;
}

const stacked = (alpha: number, passes: number): number => 1 - (1 - alpha) ** passes;
const passGain = (alpha: number, pass: number): number =>
  stacked(alpha, pass) - stacked(alpha, pass - 1);

describe("pencil buildup ladder", () => {
  it("keeps every alias-pass brush climbing through the fifth stacked stroke", () => {
    for (const id of pencilRibbonPresetIds()) {
      if (id in NEAR_OPAQUE_BY_MEDIUM) continue;
      const alpha = strokeDepositAlpha(id);
      for (let pass = 1; pass <= BUILDUP_LADDER_PASSES; pass += 1) {
        expect(passGain(alpha, pass), `${id} pass ${pass}`).toBeGreaterThan(ONE_8BIT_STEP);
        expect(stacked(alpha, pass), `${id} pass ${pass}`)
          .toBeGreaterThan(stacked(alpha, pass - 1));
      }
    }
  });

  it("pins the pencil ladder the defect erased", () => {
    // 실측 8비트 계단(1..5회차): 0.85 → 216.75, 32.51, 4.88, 0.73, 0.11 / 0.55 → 140.25, 63.11,
    // 28.40, 12.78, 5.75. 0.85 는 4회차부터 한 계단을 못 넘겨 사다리가 끝난다.
    expect(passGain(0.85, 4) * 255).toBeLessThan(1);
    expect(strokeDepositAlpha("pencil")).toBeCloseTo(0.55, 10);
    expect(passGain(strokeDepositAlpha("pencil"), 5) * 255).toBeGreaterThan(5);
    // 2B 는 HB 보다 진하고 6B 보다 옅다 — 등급 순서가 곧 재료다.
    expect(strokeDepositAlpha("pencil-2b")).toBeGreaterThan(strokeDepositAlpha("pencil"));
    expect(strokeDepositAlpha("pencil-2b")).toBeLessThan(strokeDepositAlpha("pencil-6b"));
  });

  it("holds the near-opaque grades opaque on purpose", () => {
    for (const [id, minimum] of Object.entries(NEAR_OPAQUE_BY_MEDIUM)) {
      expect(strokeDepositAlpha(id), id).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("classifies every alias-pass brush, so a new one cannot skip the contract", () => {
    expect([...pencilRibbonPresetIds()].sort()).toEqual([
      "colored-pencil",
      "pencil",
      "pencil--side-shade",
      "pencil-2b",
      "pencil-6b",
      "soft-pencil",
    ]);
  });
});
