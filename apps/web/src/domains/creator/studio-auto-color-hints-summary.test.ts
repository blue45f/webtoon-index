import { describe, expect, it } from "vitest";

import {
  planStudioAutoColorHints,
  type StudioAutoColorHintImageDataLike,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";
import {
  createStudioAutoColorHintsDemoRequest,
  planStudioAutoColorHintsDemo,
  summarizeStudioAutoColorHintPlan,
} from "./studio-auto-color-hints-summary";

const WHITE: StudioAutoColorHintRgba = [255, 255, 255, 255];
const BLACK: StudioAutoColorHintRgba = [0, 0, 0, 255];
const RED: StudioAutoColorHintRgba = [240, 40, 30, 255];
const BLUE: StudioAutoColorHintRgba = [30, 80, 240, 255];

function imageFromRows(rows: readonly string[]): StudioAutoColorHintImageDataLike {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const palette: Record<string, StudioAutoColorHintRgba> = { W: WHITE, B: BLACK };
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((key, x) => {
      data.set(palette[key]!, (y * width + x) * 4);
    });
  });
  return { data, width, height };
}

function seed(
  id: string,
  x: number,
  y: number,
  color: StudioAutoColorHintRgba,
): StudioAutoColorHintSeed {
  return { id, x, y, color };
}

describe("createStudioAutoColorHintsDemoRequest", () => {
  it("builds a clone-safe demo request with one seed and two fillable sides", () => {
    const request = createStudioAutoColorHintsDemoRequest();
    expect(request.image.width).toBe(5);
    expect(request.image.height).toBe(3);
    expect(request.seeds).toHaveLength(1);
    expect(request.seeds[0]?.id).toBe("demo-left");

    const plan = planStudioAutoColorHintsDemo();
    expect(plan.engine).toBe("connected-region-hints");
    expect(plan.status).toBe("ready");
    expect(plan.diagnostics.componentCount).toBe(2);
    expect(plan.operations).toHaveLength(1);
    expect(plan.recommendations.length).toBeGreaterThanOrEqual(1);
  });
});

describe("summarizeStudioAutoColorHintPlan", () => {
  it("summarises a ready plan in Korean without pixel mutation claims", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WWBWW", "WWBWW"]),
      seeds: [seed("left", 0, 0, RED), seed("right", 4, 1, BLUE)],
      options: {
        recommendations: {
          minimumArea: 1,
          minimumBackgroundArea: 1,
          minimumTransparentArea: 1,
          maximumRecommendations: 8,
        },
      },
    });

    const summary = summarizeStudioAutoColorHintPlan(plan);
    expect(summary.status).toBe("ready");
    expect(summary.statusLabel).toBe("적용 가능(계획)");
    expect(summary.regionCount).toBe(2);
    expect(summary.operationCount).toBe(2);
    expect(summary.conflictCount).toBe(0);
    expect(summary.headline).toContain("힌트 계획 준비됨");
    expect(summary.headline).toContain("영역 2");
    expect(summary.detailLines.some((line) => line.includes("픽셀을 자동으로 덮어쓰지 않습니다"))).toBe(
      true,
    );
    expect(summary.copyText).toContain("ToonSpectrum 자동 채색 힌트 계획");
    expect(summary.copyText).toContain("고급 채우기");
    expect(summary.copyText).not.toContain("자동 적용 완료");
  });

  it("summarises blocked conflicts and rejections honestly", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WWW"]),
      seeds: [seed("a", 0, 0, RED), seed("b", 2, 0, BLUE)],
    });

    expect(plan.status).toBe("blocked");
    const summary = summarizeStudioAutoColorHintPlan(plan);
    expect(summary.statusLabel).toBe("차단됨");
    expect(summary.conflictCount).toBeGreaterThanOrEqual(1);
    expect(summary.headline).toContain("힌트 계획 차단");
    expect(summary.detailLines.some((line) => line.includes("충돌"))).toBe(true);
    expect(summary.copyText).toContain("차단");
  });
});
