import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_PAPER_SURFACE,
  acquireStudioPaperGranulationTile,
  clearStudioPaperGranulationTileCache,
} from "../../apps/web/src/domains/creator/brush/studio-paper-granulation-runtime";
import {
  PAPER_LAB_BRUSHES,
  loadCanvasKit,
  measurePaperBrush,
  type PaperBrushRecord,
} from "../benchmarks/harness/brush-paper-grain-lab";

/**
 * 종이 결 실배선 게이트 — "붓으로 그은 획에 질감이 있는가"를 숫자로 고정한다.
 *
 * 잣대는 새로 만들지 않았다. `tests/benchmarks/harness/brush-texture-lab.ts`가 wasm 엔진 두 개를
 * 재던 바로 그 `grainMetrics`/`edgeMetrics`/`rippleMetrics`/`pressureResponseMetrics`와 같은
 * 레인 기하를 그대로 가져다, 이번에는 **Studio가 실제로 획을 그리는 경로**
 * (studio-brush-dynamics → studio-dynamic-brush-coverage-renderer → CanvasKit 2D)에 댄다.
 *
 * 배선 전/후는 같은 dab 배열을 두 번 렌더한 것이라 기하가 공유된다는 사실 자체가 증명된다
 * (`dabGeometrySha256`, before/after `markGeometrySha256`). 따라서 지표 차이는 전부 종이
 * 변조 때문이다.
 *
 * 실측치는 타임스탬프 없이 `tests/benchmarks/results/brush-texture-lab-wired.json`에 기록되므로
 * (하네스를 직접 실행), 물리를 바꾸면 그 파일이 git diff로 드러난다.
 */

const measurements = new Map<string, PaperBrushRecord>();

async function measureAll(): Promise<Map<string, PaperBrushRecord>> {
  if (measurements.size > 0) return measurements;
  clearStudioPaperGranulationTileCache();
  const canvasKit = await loadCanvasKit();
  for (const brushId of PAPER_LAB_BRUSHES) {
    measurements.set(brushId, measurePaperBrush(canvasKit, brushId));
  }
  return measurements;
}

/** 종이 결이 강하게 걸리는 자연매체 — 중주파가 실제로 올라야 하는 브러시들. */
const NATURAL_MEDIA = ["crayon", "charcoal", "erodible-pencil"] as const;
/** 정확한 항등이어야 하는 대조군. */
const INK_CONTROL = "technical-pen" as const;

describe("paper grain reaches the Studio dab path", () => {
  it("lane geometry is valid: the 64px grain window sits inside the stroke core", async () => {
    const records = await measureAll();
    for (const [brushId, record] of records) {
      // 창이 획보다 크면 측정되는 "결"은 획의 실루엣일 뿐이다. wasm 레인이
      // radius_logarithmic을 고정한 이유와 같은 이유로 여기서도 반지름을 검사한다.
      expect(
        record.before.edge.measuredRadiusPx,
        `${brushId}: measured radius must exceed the 32px window half-size`,
      ).toBeGreaterThan(32);
      expect(
        record.before.ripple.saturatedCentrelineFraction,
        `${brushId}: an alpha-clipped core would erase the variation being measured`,
      ).toBeLessThanOrEqual(0.005);
    }
  });

  it("grainMidBandRatio rises materially on natural media", async () => {
    const records = await measureAll();
    for (const brushId of NATURAL_MEDIA) {
      const record = records.get(brushId)!;
      expect(record.paperActive, `${brushId} must have an active paper response`).toBe(true);
      // 배선 전 기준선은 dab 격자와 팁 자체의 구조뿐이다. 종이가 붙으면 8~32px 대역
      // (= 종이 요철의 물리적 파장)에 새 에너지가 들어와야 한다.
      expect(
        record.after.grain.midBandRatio,
        `${brushId}: mid band ${record.before.grain.midBandRatio} -> ${record.after.grain.midBandRatio}`,
      ).toBeGreaterThan(record.before.grain.midBandRatio * 1.15);
      expect(
        record.after.grain.midBandPowerNormalised,
        `${brushId}: absolute grain strength must rise, not just its share`,
      ).toBeGreaterThan(record.before.grain.midBandPowerNormalised);
      expect(
        record.after.grain.midBandPeakPeriodPx,
        `${brushId}: the new energy must sit at a paper wavelength, not at sub-pixel noise`,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it("the alpha modulation follows the paper troughs", async () => {
    const records = await measureAll();
    for (const brushId of NATURAL_MEDIA) {
      const record = records.get(brushId)!;
      expect(record.correlation.samples).toBeGreaterThan(200);
      // granulation은 안료를 *골*에 가라앉힌다. 높이와 알파비의 상관은 음수여야 한다.
      expect(
        record.correlation.heightVsAlphaRatio,
        `${brushId}: height vs alpha ratio r=${record.correlation.heightVsAlphaRatio}`,
      ).toBeLessThan(-0.5);
      // 같은 사실의 다른 얼굴 — 정착 이득과 알파비는 양의 상관이어야 한다.
      expect(record.correlation.gainVsAlphaRatio).toBeGreaterThan(0.5);
    }
  });

  it("paper is glued to the canvas, not to the brush", async () => {
    const records = await measureAll();
    for (const brushId of NATURAL_MEDIA) {
      const record = records.get(brushId)!;
      // 같은 문서 좌표 = 같은 결. 획이 어디서 시작했는지는 종이와 무관하다.
      expect(
        record.canvasFixed.documentCoordinateDrift,
        `${brushId}: document-fixed grain must not depend on the stroke origin`,
      ).toBe(0);
      // 획을 옮기면 그 자리의 결은 달라야 한다 — 아니면 위 검사가 공허하다.
      expect(record.canvasFixed.strokeRelativeDrift).toBeGreaterThan(0.02);
    }
  });

  it("texture modulates alpha without moving or reshaping the stroke", async () => {
    const records = await measureAll();
    for (const [brushId, record] of records) {
      // 기하는 공유된 dab 배열에서 나오므로 두 렌더의 마크 좌표/반지름/각도가 동일하다.
      expect(
        record.after.markGeometrySha256,
        `${brushId}: mark geometry must be identical before and after`,
      ).toBe(record.before.markGeometrySha256);
      expect(record.after.markCount).toBe(record.before.markCount);
      // 총 잉크량은 이득의 타일 평균이 0이라 보존된다(경계 클램프만큼의 오차 허용).
      expect(
        Math.abs(record.delta.inkMassRelative),
        `${brushId}: ink mass moved ${(record.delta.inkMassRelative * 100).toFixed(2)}%`,
      ).toBeLessThan(0.03);
      expect(
        record.delta.centroidShiftPx,
        `${brushId}: stroke centroid moved ${record.delta.centroidShiftPx}px`,
      ).toBeLessThan(1);
      expect(
        Math.abs(record.delta.spreadYShiftPx),
        `${brushId}: cross-stroke spread changed ${record.delta.spreadYShiftPx}px`,
      ).toBeLessThan(1);
    }
  });

  it("pressure response survives the modulation", async () => {
    const records = await measureAll();
    for (const [brushId, record] of records) {
      // tests/visual/pressure-fidelity.test.ts의 축과 같은 것: 압력 → 단면 잉크량 상관.
      expect(
        record.pressure.massPressureCorrelationAfter,
        `${brushId}: corr(pressure, mass) ${record.pressure.massPressureCorrelationBefore} -> ${record.pressure.massPressureCorrelationAfter}`,
      ).toBeGreaterThan(0.95);
      expect(record.pressure.massPressureCorrelationAfter).toBeGreaterThan(
        record.pressure.massPressureCorrelationBefore - 0.02,
      );
      expect(record.pressure.after.r2LogLinear).toBeGreaterThan(
        record.pressure.before.r2LogLinear - 0.05,
      );
    }
  });

  it("ink and technical pens are a bit-exact identity", async () => {
    const records = await measureAll();
    const record = records.get(INK_CONTROL)!;
    expect(record.paperActive).toBe(false);
    // 종이를 타지 않는 도구는 배선 전후로 프레임이 한 비트도 달라지지 않는다.
    expect(record.after.frameSha256).toBe(record.before.frameSha256);
    expect(record.delta.grainMidBandRatio).toBe(0);
    expect(record.delta.inkMassRelative).toBe(0);
    expect(record.correlation.samples).toBe(0);
  });

  it("edge quality stays in the same regime", async () => {
    const records = await measureAll();
    for (const [brushId, record] of records) {
      // 질감은 알파를 곱하므로 가장자리 전이 폭이 조금 넓어지는 것은 물리적으로 정상이다.
      // 배가 되면 그건 질감이 아니라 흐림이므로 실패다.
      expect(
        record.after.edge.transitionWidthPx,
        `${brushId}: transition ${record.before.edge.transitionWidthPx} -> ${record.after.edge.transitionWidthPx}px`,
      ).toBeLessThan(record.before.edge.transitionWidthPx * 1.35);
      expect(record.after.edge.aliasingIndex).toBeLessThanOrEqual(
        record.before.edge.aliasingIndex + 0.1,
      );
    }
  });

  it("the paper tile is built once per (paper, strength), not per dab", async () => {
    await measureAll();
    clearStudioPaperGranulationTileCache();
    const response = { granulation: 0.7, staining: 0.04, scale: 1.5 };
    const first = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, response);
    const second = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, response);
    // 같은 종이·같은 강도면 같은 객체다 — dab마다 노이즈를 다시 만들지 않는다는 계약.
    expect(second).toBe(first);
    // scale은 좌표를 나누는 상수일 뿐이라 타일 내용을 바꾸지 않는다: 같은 타일을 공유한다.
    expect(
      acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, {
        ...response,
        scale: 3,
      }),
    ).toBe(first);
  });
});
