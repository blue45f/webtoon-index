/**
 * Oil and acrylic must differ in the RENDERED bed, not only in catalogue metadata.
 *
 * This test exists because they previously did not. `oil--flat-ribbon` and
 * `acrylic--stiff-ribbon` declared identical runtime fields — same family, tip, texture and
 * dynamics — and differed only by defaultWidth/defaultOpacity, because `engineVariant` is read by
 * no renderer. Measured on rendered captures the two sat 0.168 apart against a corpus median of
 * 1.04, i.e. the same texture under two names.
 *
 * The split asserted here is the physical one: acrylic sets while the stroke is still moving, so
 * it runs dry more often and keeps a crisper ridge; oil stays open and carries one load further.
 * Every bound is a comparison between the two bodies rather than a magic constant, so retuning the
 * bed is free as long as the two paints stay distinguishable.
 */
import { describe, expect, it } from "vitest";

import { planOilBrushDabs, studioOilPaintBodyForBrush } from "../studio-fx-brush";

function serpentine(): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    points.push(30 + index * 13, 60 + Math.sin(index / 6) * 7);
    pressures.push(0.7);
  }
  return { points, pressures };
}

function bristleSeries(paintBody: "oil" | "acrylic"): {
  load: number[];
  ridge: number[];
} {
  const { points, pressures } = serpentine();
  const dabs = planOilBrushDabs({
    points,
    pressures,
    baseWidth: 28,
    seed: 7,
    maxDabs: 4_096,
    paintBody,
  });
  // The whole serpentine, not its first 80 stations. A load cycle is measured in HEAD WIDTHS
  // (seven for oil, half that for acrylic) and a station is 0.068 of one, so 80 stations is barely
  // five widths — less than a single oil cycle, and a window shorter than the signal cannot count
  // the signal's crossings for either paint.
  const sampled = dabs;
  // The CONTACTING half of the bed, concatenated — not one hair, and never bristles[0].
  //
  // Two reasons. The bed runs outermost-to-outermost, so index 0 is the hair at the very edge of
  // the ferrule, and contact is a width: an edge hair is legitimately off the paper at anything
  // short of a hard press. And a hair carries its own reservoir for the whole stroke, so whether
  // any single hair crosses the dry threshold depends on the reservoir it was dealt. Sampling one
  // hair measures that draw; sampling the contacting band measures the paint.
  const count = dabs[0]?.bristles.length ?? 1;
  const from = Math.floor(count * 0.25);
  const to = Math.ceil(count * 0.75);
  const load: number[] = [];
  const ridge: number[] = [];
  for (let bristle = from; bristle < to; bristle += 1) {
    for (const dab of sampled) {
      load.push(dab.bristles[bristle]?.opacity ?? 0);
      ridge.push(dab.bristles[bristle]?.radiusYRatio ?? 0);
    }
  }
  return { load, ridge };
}

/** One bristle's load over a long stroke - long enough to span several dry/loaded cycles. */
function longBristleLoad(paintBody: "oil" | "acrylic", bristle = 3): number[] {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 400; index += 1) {
    points.push(20 + index * 4, 60 + Math.sin(index / 30) * 20);
    pressures.push(0.7);
  }
  const dabs = planOilBrushDabs({
    points,
    pressures,
    baseWidth: 28,
    seed: 7,
    maxDabs: 16_384,
    paintBody,
  });
  return dabs
    .map((dab) => dab.bristles[bristle]?.opacity)
    .filter((value): value is number => typeof value === "number");
}

function lagOneAutocorrelation(series: readonly number[]): number {
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < series.length - 1; index += 1) {
    numerator += (series[index]! - mean) * (series[index + 1]! - mean);
  }
  for (const value of series) denominator += (value - mean) ** 2;
  return numerator / denominator;
}

/** How often the hair crosses between loaded and dry — a fast-setting paint does this more. */
function dryOutCycles(series: readonly number[]): number {
  let flips = 0;
  for (let index = 1; index < series.length; index += 1) {
    if ((series[index]! > 0.3) !== (series[index - 1]! > 0.3)) flips += 1;
  }
  return flips;
}

describe("Studio oil vs acrylic paint body", () => {
  it("routes only the acrylic shelf to the fast-setting body", () => {
    for (const brush of ["acrylic", "acrylic--stiff-ribbon", "acrylic--polymer-flat"]) {
      expect(studioOilPaintBodyForBrush(brush), brush).toBe("acrylic");
    }
    for (const brush of [
      "oil",
      "oil--flat-ribbon",
      "oil--impasto-ribbon",
      "brush--oil-lanes",
      "paint-tube",
    ]) {
      expect(studioOilPaintBodyForBrush(brush), brush).toBe("oil");
    }
  });

  it("makes acrylic run dry sooner and hold a crisper ridge than oil", () => {
    const oil = bristleSeries("oil");
    const acrylic = bristleSeries("acrylic");

    // The distinguishing pair. Acrylic sets mid-stroke, so one load does not carry as far.
    expect(dryOutCycles(acrylic.load)).toBeGreaterThan(dryOutCycles(oil.load));
    const meanRidge = (series: readonly number[]): number =>
      series.reduce((sum, value) => sum + value, 0) / series.length;
    expect(meanRidge(acrylic.ridge)).toBeGreaterThan(meanRidge(oil.ridge) * 1.2);
  });

  it("keeps both bodies off the white-noise load that made bristles read as particles", () => {
    // The regression this guards is a load signal that is independent per station: it measured a
    // lag-1 autocorrelation of -0.03 and rasterised as disconnected angular dashes. Either paint
    // may be retuned, but neither may go back to noise, and neither may buy smoothness by
    // flattening its texture — hence the variance floor beside the correlation floor.
    for (const [name, series] of [
      ["oil", bristleSeries("oil").load],
      ["acrylic", bristleSeries("acrylic").load],
    ] as const) {
      expect(lagOneAutocorrelation(series), name).toBeGreaterThan(0.5);
    }

    // Texture strength is "does the hair still reach both ends, and does it pass through the
    // middle" - measured over a LONG stroke, because a short sample need not span a full dry
    // cycle and will report a narrow range for a perfectly healthy load.
    //
    // Variance and range both FALL when the load's bimodal gap is filled, and filling it is the
    // improvement: it took the rendered stroke from 73.1% of its ink in two tone bins to 54.6%.
    // So neither is the floor. What a genuinely flattened load loses is its extremes, and what a
    // re-hardened boolean gate loses is the middle - this asserts all three populations survive.
    // 의도적 변경(2026-08-16 시각 대조): 세 population 은 이제 한 털의 길이 방향이 아니라
    // 털들 사이에 존재해야 한다. 각 털이 제 길이 안에서 마름↔가득을 다 훑으면, 그 털은 여러
    // load 밴드를 가로지르며 짧은 조각으로 잘려 서로 다른 페인트 패스로 흩어진다 — 4배 확대
    // 대조 시트에서 유화 베드가 털이 아니라 판때기 위의 점선으로 읽힌 원인이 정확히 이것이었다.
    // 실제 붓은 털마다 머금은 양이 다르고, 한 털은 제 길이 내내 대체로 그 양을 유지한다.
    for (const paintBody of ["oil", "acrylic"] as const) {
      const perBristle = Array.from({ length: 5 }, (_, index) =>
        longBristleLoad(paintBody, index));
      const across = perBristle.flat();
      const dry = across.filter((v) => v < 0.1).length / across.length;
      const mid = across.filter((v) => v >= 0.1 && v <= 0.5).length / across.length;
      const loaded = across.filter((v) => v > 0.5).length / across.length;
      expect(Math.min(...across), paintBody).toBeLessThan(0.1);
      expect(Math.max(...across), paintBody).toBeGreaterThan(0.5);

      // 그리고 한 털의 길이 방향 변동은 털 사이 변동보다 좁아야 한다 — 이게 연속 줄무늬를
      // 만드는 조건이다. 0 이면 죽은 평행선이므로 하한도 함께 고정한다.
      const withinRanges = perBristle.map((series) =>
        Math.max(...series) - Math.min(...series));
      const acrossRange = Math.max(...across) - Math.min(...across);
      const widestWithin = Math.max(...withinRanges);
      expect(widestWithin, `${paintBody} within-hair range`).toBeGreaterThan(0.05);
      expect(widestWithin, `${paintBody} within vs across`).toBeLessThan(acrossRange);
      // 개체군은 이제 털 사이에 있으므로, 한 털의 시계열 점유율이 아니라 털별 평균의 분포로
      // 본다. 마른 털·중간 털·머금은 털이 실제로 공존해야 갈필과 진한 결이 같이 나온다.
      const means = perBristle.map((series) =>
        series.reduce((sum, value) => sum + value, 0) / series.length);
      expect(Math.min(...means), `${paintBody} driest hair`).toBeLessThan(0.35);
      expect(Math.max(...means), `${paintBody} wettest hair`).toBeGreaterThan(0.5);
      expect(mid, `${paintBody} mid`).toBeGreaterThan(0.05);
      void dry;
      expect(loaded, `${paintBody} loaded`).toBeGreaterThan(0.2);
    }
  });
});
