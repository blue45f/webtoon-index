/**
 * F1 — W7 종이 프로그램의 스탬프 플래너 배선 계약.
 *
 * 고정하는 계약:
 * 1. 카탈로그 핀: 네 dry-stamp 레인만 dry-peak-catch-v1 을 옵트인한다(크레용·초크·목탄=판화지,
 *    파스텔=켄트지). 다른 어떤 스탬프 브러시도 paperGrain 을 얻지 않는다.
 * 2. 핀 on ⇒ 계획이 변한다(알파만; 기하는 동일). 핀 off ⇒ 알파 산식이 종이 배선 이전과
 *    비트 단위로 같다(잉크/에어브러시/수채 스탬프 회귀).
 * 3. 저필압 이빨 가시성: 판화지에서 p=0.2 의 커버리지 분산이 p=0.9 보다 크다(peak-catch).
 * 4. Canvas·SVG 파리티: 두 표면이 같은 공유 플래너의 알파를 소비한다(표면별 재구현 금지).
 */

import { describe, expect, it } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";

import { resolveStudioBrushEngineLaneStampTuning } from "./studio-brush-engine-lane-catalog";
import {
  drawStampStroke,
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  resolveStudioStampPaperGrainStyle,
  STUDIO_STAMP_PAPER_PROGRAMS,
  type StudioStampBrushKind,
  type StudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import { transformStudioBrushSymmetryPoint } from "./studio-brush-symmetry";
import { drawStudioStampStrokeWithSymmetry } from "./studio-stamp-symmetry-rendering";

const BASE = { color: "#1f6feb", size: 14, opacity: 0.85 } as const;

const PINNED_LANES = [
  { brushId: "crayon--klecks-stamp", kind: "crayon", presetId: "printmaking" },
  { brushId: "chalk--klecks-stamp", kind: "chalk", presetId: "printmaking" },
  { brushId: "charcoal--mypaint-stamp", kind: "charcoal", presetId: "printmaking" },
  { brushId: "pastel--soft-stamp", kind: "pastel", presetId: "kent" },
] as const;

/** 스탬프 엔진을 타지만 종이 프로그램이 없는 모든 제품 id — 비트 동일 회귀 대상. */
const UNPINNED_STAMP_BRUSH_IDS = [
  "ink-brush",
  "airbrush-fine",
  "airbrush-soft",
  "pencil-grain",
  "wash-brush",
  "mypaint-smudge-oil",
  "krita-auto-soft",
  "gouache--flat-stamp",
  "watercolor--edge-stamp",
  "airbrush--stamp-soft",
  "pencil--stamp-grain",
] as const;

const LINE: number[] = [];
for (let index = 0; index <= 80; index += 1) {
  LINE.push(index * 5, (index % 2) * 3);
}

function constantPressures(value: number): number[] {
  return Array.from({ length: LINE.length / 2 }, () => value);
}

function withoutPaperGrain(style: StudioStampBrushStyle): StudioStampBrushStyle {
  const { paperGrain: _paperGrain, ...rest } = style;
  return rest;
}

function laneStyle(brushId: string): StudioStampBrushStyle {
  const kind = resolveStudioStampBrushKind(brushId);
  if (!kind) throw new Error(`not a stamp brush: ${brushId}`);
  return resolveStudioStampBrushStyle(kind, BASE, null, brushId);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function variance(values: readonly number[]): number {
  const center = mean(values);
  return mean(values.map((value) => (value - center) ** 2));
}

describe("F1 dry-stamp paper program pins", () => {
  it("pins dry-peak-catch-v1 with the W7 sheets on exactly the four dry-stamp lanes", () => {
    for (const lane of PINNED_LANES) {
      const tuning = resolveStudioBrushEngineLaneStampTuning(lane.brushId);
      expect(tuning?.paperProgramId, lane.brushId).toBe("dry-peak-catch-v1");
      expect(tuning?.paperPresetId, lane.brushId).toBe(lane.presetId);
      const style = laneStyle(lane.brushId);
      expect(style.paperGrain?.programId, lane.brushId).toBe("dry-peak-catch-v1");
      expect(style.paperGrain?.presetId, lane.brushId).toBe(lane.presetId);
      expect(style.paperGrain?.medium, lane.brushId).toBe(lane.kind);
      expect(Number.isFinite(style.paperGrain?.seed)).toBe(true);
    }
    for (const brushId of UNPINNED_STAMP_BRUSH_IDS) {
      expect(
        resolveStudioBrushEngineLaneStampTuning(brushId)?.paperProgramId,
        brushId,
      ).toBeUndefined();
      const style = laneStyle(brushId);
      expect(style.paperGrain, brushId).toBeUndefined();
      // 필드 부재 자체가 계약이다 — undefined 값이 아니라 키가 없어야 한다.
      expect(Object.hasOwn(style, "paperGrain"), brushId).toBe(false);
    }
  });

  it("fails closed on unregistered kinds and unknown sheets (honesty policy)", () => {
    const program = STUDIO_STAMP_PAPER_PROGRAMS["dry-peak-catch-v1"];
    expect(Object.isFrozen(program)).toBe(true);
    // 프로그램이 렌더를 보장하지 않는 kind 는 핀을 줘도 결합이 생기지 않는다.
    for (const kind of ["ink", "airbrush", "watercolor", "mypaint"] as const) {
      expect(
        resolveStudioStampPaperGrainStyle(kind, { paperProgramId: "dry-peak-catch-v1" }),
        kind,
      ).toBeNull();
    }
    expect(resolveStudioStampPaperGrainStyle("crayon", null)).toBeNull();
    expect(
      resolveStudioStampPaperGrainStyle("crayon", {
        paperProgramId: "unknown-program" as never,
      }),
    ).toBeNull();
    expect(
      resolveStudioStampPaperGrainStyle("crayon", {
        paperProgramId: "dry-peak-catch-v1",
        paperPresetId: "washi" as never,
      }),
    ).toBeNull();
    // 레인이 종이를 고정하지 않으면 프로그램의 W7 기본 낱장으로 굴러간다.
    const fallback = resolveStudioStampPaperGrainStyle("pastel", {
      paperProgramId: "dry-peak-catch-v1",
    });
    expect(fallback?.presetId).toBe("kent");
  });
});

describe("F1 plan byte-change proof", () => {
  it("paper pin on ⇒ plan alphas change; pin off ⇒ byte-identical geometry and alphas", () => {
    const pressures = constantPressures(0.35);
    for (const lane of PINNED_LANES) {
      const styleOn = laneStyle(lane.brushId);
      const styleOff = withoutPaperGrain(styleOn);
      const on = planStudioStampBrushDabs(styleOn, LINE, pressures);
      const off = planStudioStampBrushDabs(styleOff, LINE, pressures);

      // 기하(간격·반경·지터 인덱스)는 종이와 무관하게 동일하다 — 알파만 종이를 탄다.
      expect(on.length, lane.brushId).toBe(off.length);
      expect(on.length).toBeGreaterThan(20);
      const baseAlpha = off[0]!.alpha;
      for (let index = 0; index < on.length; index += 1) {
        expect(on[index]!.x).toBe(off[index]!.x);
        expect(on[index]!.y).toBe(off[index]!.y);
        expect(on[index]!.radius).toBe(off[index]!.radius);
        expect(on[index]!.index).toBe(off[index]!.index);
        // 핀 off 의 알파 산식은 배선 이전 그대로: 상수 flow×opacity.
        expect(off[index]!.alpha).toBe(baseAlpha);
        // peak-catch 침착은 [0,1] — 알파가 기본값을 넘지 않는다.
        expect(on[index]!.alpha).toBeGreaterThanOrEqual(0);
        expect(on[index]!.alpha).toBeLessThanOrEqual(baseAlpha + 1e-12);
      }
      expect(
        on.some((dab, index) => dab.alpha !== off[index]!.alpha),
        `${lane.brushId}: paper pin produced no byte change`,
      ).toBe(true);
      // 결정성: 같은 입력이면 재계획도 비트 단위로 같다(증분/재생/SVG 계약의 전제).
      expect(planStudioStampBrushDabs(styleOn, LINE, pressures)).toEqual(on);
    }
  });

  it("keeps every non-pinned stamp plan on the pre-paper alpha formula (regression)", () => {
    const pressures = constantPressures(0.6);
    for (const brushId of UNPINNED_STAMP_BRUSH_IDS) {
      const style = laneStyle(brushId);
      const plan = planStudioStampBrushDabs(style, LINE, pressures);
      expect(plan.length, brushId).toBeGreaterThan(3);
      const expectedAlpha =
        Math.min(1, Math.max(0, style.flow)) * Math.min(1, Math.max(0, style.opacity));
      for (const dab of plan) {
        // 배선 이전의 정확한 산식: 모든 dab 알파 = clamp01(flow) × clamp01(opacity).
        expect(dab.alpha, brushId).toBe(expectedAlpha);
      }
    }
  });
});

describe("F1 low-pressure tooth visibility (판화지 peak-catch)", () => {
  it("keeps coverage variance higher at p=0.2 than p=0.9 and floods tooth with pressure", () => {
    for (const brushId of ["charcoal--mypaint-stamp", "crayon--klecks-stamp"] as const) {
      const style = laneStyle(brushId);
      expect(style.paperGrain?.presetId).toBe("printmaking");
      const light = planStudioStampBrushDabs(style, LINE, constantPressures(0.2));
      const heavy = planStudioStampBrushDabs(style, LINE, constantPressures(0.9));
      const lightAlphas = light.map((dab) => dab.alpha);
      const heavyAlphas = heavy.map((dab) => dab.alpha);
      // 저필압: 봉우리만 안료를 받아 이빨(공백·반점)이 보인다 → 분산이 크다.
      expect(
        variance(lightAlphas),
        `${brushId}: light-pressure tooth invisible`,
      ).toBeGreaterThan(variance(heavyAlphas));
      // 고필압: 골까지 잠겨 평균 침착이 오른다(왁스/목탄 실물 규약).
      expect(mean(lightAlphas), brushId).toBeLessThan(mean(heavyAlphas));
    }
  });
});

// ---------------------------------------------------------------------------
// Canvas / SVG 공유 플래너 파리티 — 목탄 스탬프 레인
// ---------------------------------------------------------------------------

/** studio-svg-export 의 dab 불투명도 포맷 미러(6자리, 0 초과 보존). */
function fmtDabOpacityMirror(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const bounded = Math.min(1, Math.max(0, n));
  const rounded = Math.round(bounded * 1_000_000) / 1_000_000;
  const visible = bounded > 0 && rounded === 0 ? 0.000001 : rounded;
  return visible.toFixed(6).replace(/\.?0+$/u, "");
}

/** canvas2d 호출 기록 컨텍스트 — 픽셀 대신 (x, y, r, alpha) 시퀀스로 검증한다. */
function recordingContext() {
  const dabs: Array<{ x: number; y: number; r: number; alpha: number }> = [];
  let alpha = 1;
  let pathArc: { x: number; y: number; r: number } | null = null;
  const context = {
    set globalAlpha(value: number) {
      alpha = value;
    },
    get globalAlpha() {
      return alpha;
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => {
      pathArc = null;
    },
    arc: (x: number, y: number, r: number) => {
      pathArc = { x, y, r };
    },
    fill: () => {
      if (pathArc) dabs.push({ ...pathArc, alpha });
    },
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  return { context, dabs };
}

describe("F1 Canvas/SVG shared-planner parity (charcoal--mypaint-stamp)", () => {
  const BRUSH_ID = "charcoal--mypaint-stamp";
  const POINTS = [10, 34, 24, 18, 42, 42, 62, 20, 82, 31];
  const PRESSURES = [0.35, 0.55, 0.8, 0.6, 0.42];
  const STROKE = "#1f6feb";
  const WIDTH = 12;
  const OPACITY = 0.72;

  function planForExportInputs() {
    const style = resolveStudioStampBrushStyle(
      "charcoal" as StudioStampBrushKind,
      { color: STROKE, size: WIDTH, opacity: OPACITY },
      undefined,
      BRUSH_ID,
    );
    return { style, plan: planStudioStampBrushDabs(style, POINTS, PRESSURES) };
  }

  it("SVG export serializes exactly the shared plan's paper-modulated alphas", () => {
    const { style, plan } = planForExportInputs();
    expect(style.paperGrain).toBeDefined();
    // 종이가 실제로 변조 중인 픽스처인지 먼저 보증한다(전부 동일 알파면 파리티가 공허하다).
    expect(new Set(plan.map((dab) => dab.alpha)).size).toBeGreaterThan(1);

    const { svg } = exportPageToSvg({
      width: 96,
      height: 64,
      bg: "#ffffff",
      transparentBg: true,
      elements: [{
        id: "paper-parity-stroke",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: BRUSH_ID,
        brushCatalogId: BRUSH_ID,
        points: POINTS,
        pressures: PRESSURES,
        stroke: STROKE,
        strokeWidth: WIDTH,
        opacity: OPACITY,
        sampleSpacing: 1,
        stampPipeline: "causal-walker-v2",
      }],
    });

    const group = /<g data-stamp-brush="charcoal">([\s\S]*?)<\/g>/u.exec(svg)?.[1];
    expect(group, "charcoal stamp group missing in SVG").toBeTruthy();
    const opacities = [...group!.matchAll(/<circle [^>]*opacity="([^"]+)"/gu)]
      .map((match) => match[1]!);
    // 제너릭 스탬프 직렬화는 dab 당 (본체, 림) 두 원 — 본체 불투명도가 계획 알파와 자릿수까지
    // 같아야 SVG 가 공유 플래너를 소비한다는 증거다.
    expect(opacities.length).toBe(plan.length * 2);
    plan.forEach((dab, index) => {
      expect(opacities[index * 2], `dab ${index}`).toBe(fmtDabOpacityMirror(dab.alpha));
      expect(opacities[index * 2 + 1], `dab ${index} rim`).toBe(
        fmtDabOpacityMirror(dab.alpha * 0.22),
      );
    });
  });

  it("Canvas replay draws exactly the shared plan's paper-modulated alphas", () => {
    const { style, plan } = planForExportInputs();
    const recorder = recordingContext();
    drawStampStroke(recorder.context, style, POINTS, PRESSURES);
    expect(recorder.dabs.map((dab) => dab.alpha)).toEqual(plan.map((dab) => dab.alpha));
    expect(recorder.dabs.map((dab) => dab.r)).toEqual(plan.map((dab) => dab.radius));
  });

  it("mirrored symmetry copies agree byte-for-byte with the SVG per-variation plans", () => {
    const { style } = planForExportInputs();
    const symmetry = { type: "vertical", centerX: 47.3, centerY: 0 } as const;
    const recorder = recordingContext();
    const plan = drawStudioStampStrokeWithSymmetry(
      recorder.context,
      style,
      POINTS,
      PRESSURES,
      symmetry,
    );

    expect(plan.transforms).toHaveLength(2);
    // SVG 절차 그대로: 원본 점열을 변환한 뒤 변주마다 문서 좌표에서 독립적으로 계획한다.
    const svgVariationPlans = plan.transforms.map((transform) => {
      const variationPoints: number[] = [];
      for (let index = 0; index + 1 < POINTS.length; index += 2) {
        variationPoints.push(...transformStudioBrushSymmetryPoint(
          POINTS[index]!,
          POINTS[index + 1]!,
          transform,
        ));
      }
      return planStudioStampBrushDabs(style, variationPoints, PRESSURES);
    });
    expect(plan.dabVariations).toEqual(svgVariationPlans);

    // Canvas 팬은 그 문서 좌표 dab 을 컨텍스트 변환 없이 그대로 그린다(거울 사본 포함).
    const flat = svgVariationPlans.flat();
    expect(recorder.dabs.map((dab) => dab.alpha)).toEqual(flat.map((dab) => dab.alpha));
    expect(recorder.dabs.map((dab) => dab.x)).toEqual(flat.map((dab) => dab.x));

    // 종이는 문서에 고정된 낱장 — 거울 사본은 원본과 다른 이빨을 읽어야 한다. (구 affine
    // 복제는 두 사본이 같은 원본 알파를 실어 날랐다: 이 단언이 그 회귀를 막는다.)
    const sourcePlan = plan.dabVariations[0]!;
    const mirroredPlan = plan.dabVariations[1]!;
    expect(mirroredPlan).toHaveLength(sourcePlan.length);
    expect(
      mirroredPlan.some((dab, index) => dab.alpha !== sourcePlan[index]!.alpha),
    ).toBe(true);

    // 엔드투엔드: 내보낸 SVG 도 변주마다 자기 위치의 종이 변조 알파를 자릿수까지 직렬화한다.
    const { svg } = exportPageToSvg({
      width: 128,
      height: 64,
      bg: "#ffffff",
      transparentBg: true,
      elements: [{
        id: "paper-parity-mirrored-stroke",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: BRUSH_ID,
        brushCatalogId: BRUSH_ID,
        points: POINTS,
        pressures: PRESSURES,
        stroke: STROKE,
        strokeWidth: WIDTH,
        opacity: OPACITY,
        sampleSpacing: 1,
        stampPipeline: "causal-walker-v2",
        symmetry: { ...symmetry },
      }],
    });
    const groups = [...svg.matchAll(/<g data-stamp-brush="charcoal">([\s\S]*?)<\/g>/gu)]
      .map((match) => match[1]!);
    expect(groups).toHaveLength(2);
    groups.forEach((group, variationIndex) => {
      const opacities = [...group.matchAll(/<circle [^>]*opacity="([^"]+)"/gu)]
        .map((match) => match[1]!);
      const variation = plan.dabVariations[variationIndex]!;
      expect(opacities.length).toBe(variation.length * 2);
      variation.forEach((dab, index) => {
        expect(
          opacities[index * 2],
          `variation ${variationIndex} dab ${index}`,
        ).toBe(fmtDabOpacityMirror(dab.alpha));
      });
    });
  });
});
