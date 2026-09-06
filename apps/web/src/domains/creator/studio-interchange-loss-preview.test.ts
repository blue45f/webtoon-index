import { describe, expect, it } from "vitest";

import {
  summarizeStudioInterchangeLoss,
  type StudioInterchangeLossPreviewInput,
} from "./studio-interchange-loss-preview";

function completeRasterPreview(
  overrides: Partial<StudioInterchangeLossPreviewInput> = {},
): StudioInterchangeLossPreviewInput {
  return {
    format: "raster",
    fileName: "character.png",
    source: {
      width: 1_600,
      height: 2_400,
      alpha: "present",
      colorSpace: "sRGB",
      editability: "pixels",
    },
    result: {
      width: 1_600,
      height: 2_400,
      alpha: "present",
      colorSpace: "sRGB",
      editability: "pixels",
    },
    proxy: { enabled: false },
    ...overrides,
  };
}

describe("summarizeStudioInterchangeLoss", () => {
  it("returns seven ordered, neutral checks for a raster import that preserves its inspected traits", () => {
    const summary = summarizeStudioInterchangeLoss(completeRasterPreview());

    expect(summary.findings.map((finding) => finding.category)).toEqual([
      "pages",
      "layers",
      "resolution",
      "alpha",
      "color-space",
      "editability",
      "proxy",
    ]);
    expect(summary.findings.every((finding) => finding.severity === "neutral")).toBe(true);
    expect(summary.status).toBe("ready");
    expect(summary.highestSeverity).toBe("neutral");
    expect(summary.canConfirm).toBe(true);
    expect(summary.advisoryCount).toBe(0);
    expect(summary.blockingCount).toBe(0);
    expect(summary.formatLabel).toBe("래스터 이미지");
  });

  it("describes ORA flattening, downscaling, color conversion, editability loss, and a destructive proxy", () => {
    const summary = summarizeStudioInterchangeLoss({
      format: "ora",
      fileName: "episode-12.ora",
      source: {
        layerCount: 12,
        width: 4_000,
        height: 6_000,
        alpha: "present",
        colorSpace: "Display P3",
        editability: "layered",
      },
      result: {
        layerCount: 1,
        width: 1_280,
        height: 1_920,
        alpha: "present",
        colorSpace: "sRGB",
        editability: "pixels",
      },
      proxy: {
        enabled: true,
        format: "WebP",
        quality: 0.85,
        width: 1_280,
        height: 1_920,
        originalRetained: false,
      },
    });

    expect(summary.status).toBe("review");
    expect(summary.highestSeverity).toBe("warning");
    expect(summary.canConfirm).toBe(true);
    expect(summary.blockingCount).toBe(0);
    expect(summary.advisoryCount).toBe(5);
    expect(summary.findings.find((finding) => finding.category === "layers")).toMatchObject({
      severity: "warning",
      gate: "advisory",
      sourceValue: "12개",
      resultValue: "1개",
    });
    expect(summary.findings.find((finding) => finding.category === "proxy")?.detail)
      .toContain("복원할 수 없습니다");
  });

  it("blocks a CBZ import when all source pages would be dropped while treating layers as not applicable", () => {
    const summary = summarizeStudioInterchangeLoss({
      format: "cbz",
      source: {
        pageCount: 24,
        width: 800,
        height: 1_200,
        alpha: "opaque",
        colorSpace: "sRGB",
        editability: "page-images",
      },
      result: {
        pageCount: 0,
        width: 800,
        height: 1_200,
        alpha: "opaque",
        colorSpace: "sRGB",
        editability: "page-images",
      },
    });

    expect(summary.status).toBe("blocked");
    expect(summary.canConfirm).toBe(false);
    expect(summary.blockingCount).toBe(1);
    expect(summary.highestSeverity).toBe("critical");
    expect(summary.findings.find((finding) => finding.category === "pages")).toMatchObject({
      gate: "blocking",
      severity: "critical",
    });
    expect(summary.findings.find((finding) => finding.category === "layers")).toMatchObject({
      sourceValue: "해당 없음",
      resultValue: "해당 없음",
      severity: "neutral",
    });
  });

  it("promotes codec policy constraints into the same category gate and keeps their details", () => {
    const summary = summarizeStudioInterchangeLoss(completeRasterPreview({
      constraints: [
        {
          category: "color-space",
          gate: "blocking",
          message: "인쇄 프로필 승인이 필요합니다.",
        },
        {
          category: "alpha",
          severity: "warning",
          message: "가장자리 매트를 육안으로 확인하세요.",
        },
      ],
    }));

    expect(summary.status).toBe("blocked");
    expect(summary.blockingCount).toBe(1);
    expect(summary.advisoryCount).toBe(1);
    expect(summary.findings.find((finding) => finding.category === "color-space")).toMatchObject({
      gate: "blocking",
      severity: "critical",
      notes: ["인쇄 프로필 승인이 필요합니다."],
    });
    expect(summary.findings.find((finding) => finding.category === "alpha")).toMatchObject({
      gate: "advisory",
      severity: "warning",
      notes: ["가장자리 매트를 육안으로 확인하세요."],
    });
  });

  it("marks a retained proxy as an advisory but blocks malformed proxy settings", () => {
    const retained = summarizeStudioInterchangeLoss(completeRasterPreview({
      proxy: {
        enabled: true,
        format: "WebP",
        quality: 0.85,
        width: 1_280,
        height: 1_920,
        originalRetained: true,
      },
    }));
    const invalid = summarizeStudioInterchangeLoss(completeRasterPreview({
      proxy: {
        enabled: true,
        format: "WebP",
        quality: 1.2,
        width: 1_280,
        originalRetained: true,
      },
    }));

    expect(retained.findings.find((finding) => finding.category === "proxy")).toMatchObject({
      severity: "notice",
      gate: "advisory",
    });
    expect(retained.status).toBe("review");
    expect(invalid.findings.find((finding) => finding.category === "proxy")).toMatchObject({
      severity: "critical",
      gate: "blocking",
    });
    expect(invalid.canConfirm).toBe(false);
  });
});
