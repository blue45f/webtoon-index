import { describe, expect, it } from "vitest";

import {
  createStudioCbzImportLossPreview,
  createStudioOpenRasterImportLossPreview,
  createStudioPsdImportLossPreview,
} from "./studio-document-interchange-preview";
import { summarizeStudioInterchangeLoss } from "./studio-interchange-loss-preview";

import type { StudioCbzImportResult } from "./studio-cbz-interchange";
import type { StudioOpenRasterImportResult } from "./studio-openraster-interchange";
import type { PsdImportResult } from "./studio-psd-import";

const OPTIONS = { canvasWidth: 1_080, maxEmbeddedBytes: 64 * 1024 * 1024 } as const;

describe("studio document interchange preview adapters", () => {
  it("explains PSD raster proxy and skipped editing features before applying", () => {
    const preview = createStudioPsdImportLossPreview("episode.psd", {
      elements: [{ id: "layer", type: "image" } as never],
      sourceWidth: 2_160,
      sourceHeight: 4_000,
      scale: 0.5,
      skipped: ["텍스트 레이어를 래스터화했습니다."],
    } satisfies PsdImportResult, OPTIONS);
    const summary = summarizeStudioInterchangeLoss(preview);

    expect(preview.proxy).toMatchObject({ enabled: true, originalRetained: false });
    expect(summary.status).toBe("review");
    expect(summary.findings.find((finding) => finding.category === "resolution")).toMatchObject({
      resultValue: "1,080 × 2,000 px",
      severity: "warning",
    });
    expect(summary.findings.find((finding) => finding.category === "editability")?.notes).toContain(
      "텍스트 레이어를 래스터화했습니다.",
    );
  });

  it("maps the structured PSD feature manifest into loss-preview categories", () => {
    const preview = createStudioPsdImportLossPreview("profile.psd", {
      elements: [{ id: "layer", type: "image" } as never],
      sourceWidth: 1_080,
      sourceHeight: 1_920,
      scale: 1,
      skipped: [],
      lossManifest: {
        direction: "import",
        source: {
          container: "psd",
          width: 1_080,
          height: 1_920,
          channels: 4,
          bitsPerChannel: 8,
          colorMode: "RGB",
        },
        target: {
          container: "studio",
          width: 1_080,
          height: 1_920,
          channels: 4,
          bitsPerChannel: 8,
          colorMode: "sRGB",
        },
        decisions: [
          {
            feature: "layer-mask",
            disposition: "rasterized",
            count: 2,
            message: "벡터 마스크 2개를 래스터화합니다.",
          },
          {
            feature: "color-space",
            disposition: "rasterized",
            count: 1,
            message: "ICC 프로필은 유지하지 않습니다.",
          },
        ],
        budgets: {
          maxFileBytes: 128,
          maxDecodedBytes: 128,
          maxDimensionPx: 30_000,
        },
        alternatives: ["원본 PSD 보관"],
      },
    } satisfies PsdImportResult, OPTIONS);

    expect(preview.source.colorSpace).toBe("RGB 8bit");
    expect(preview.result.colorSpace).toBe("sRGB 8bit");
    expect(preview.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "alpha", message: expect.stringContaining("벡터 마스크") }),
      expect.objectContaining({ category: "color-space", message: expect.stringContaining("ICC") }),
    ]));
  });

  it("blocks PSD application when converted layer payloads exceed the durable project budget", () => {
    const preview = createStudioPsdImportLossPreview("large.psd", {
      elements: [{
        id: "layer",
        type: "image",
        // Decoded bytes fit 32, but the data URL stored in project JSON does not.
        src: `data:image/png;base64,${"A".repeat(40)}`,
      } as never],
      sourceWidth: 1_080,
      sourceHeight: 1_080,
      scale: 1,
      skipped: [],
    } satisfies PsdImportResult, { canvasWidth: 1_080, maxEmbeddedBytes: 32 });

    expect(summarizeStudioInterchangeLoss(preview)).toMatchObject({
      status: "blocked",
      canConfirm: false,
    });
  });

  it("counts editable PNG maskSrc together with its raster source in the durable PSD budget", () => {
    const preview = createStudioPsdImportLossPreview("masked.psd", {
      elements: [{
        id: "layer",
        type: "image",
        src: `data:image/webp;base64,${"A".repeat(20)}`,
        maskSrc: `data:image/png;base64,${"B".repeat(20)}`,
      } as never],
      sourceWidth: 1_080,
      sourceHeight: 1_080,
      scale: 1,
      skipped: [],
    } satisfies PsdImportResult, { canvasWidth: 1_080, maxEmbeddedBytes: 64 });

    expect(preview.proxy?.format).toBe("WebP 레이어 + 무손실 PNG 마스크");
    expect(summarizeStudioInterchangeLoss(preview)).toMatchObject({
      status: "blocked",
      canConfirm: false,
    });
  });

  it("blocks ORA confirmation when durable embedded image bytes exceed the device profile", () => {
    const preview = createStudioOpenRasterImportLossPreview("large.ora", {
      width: 2_000,
      height: 3_000,
      // 48MiB raw expands beyond the 64MiB durable data-URL budget.
      layers: [{ byteLength: 48 * 1024 * 1024 }] as never,
      groups: [],
      mergedImage: new Blob(),
      thumbnail: new Blob(),
      mergedImageInfo: { colorType: 6 } as never,
      thumbnailInfo: {} as never,
      summary: {} as never,
      warnings: [],
    } satisfies StudioOpenRasterImportResult, OPTIONS);
    const summary = summarizeStudioInterchangeLoss(preview);

    expect(summary.status).toBe("blocked");
    expect(summary.canConfirm).toBe(false);
    expect(summary.findings.find((finding) => finding.category === "editability")?.notes[0]).toContain(
      "프로젝트 포함 한도 64MB",
    );
  });

  it("warns when nested ORA group compositing must be flattened and approximated", () => {
    const preview = createStudioOpenRasterImportLossPreview("groups.ora", {
      width: 1_080,
      height: 1_920,
      layers: [{ byteLength: 10 }] as never,
      groups: [{
        depth: 2,
        isolation: "auto",
        opacity: 0.5,
        blendMode: "multiply",
      }] as never,
      mergedImage: new Blob(),
      thumbnail: new Blob(),
      mergedImageInfo: { colorType: 6 } as never,
      thumbnailInfo: {} as never,
      summary: {} as never,
      warnings: [],
    } satisfies StudioOpenRasterImportResult, OPTIONS);
    const layerFinding = summarizeStudioInterchangeLoss(preview).findings.find(
      (finding) => finding.category === "layers",
    );

    expect(layerFinding?.severity).toBe("warning");
    expect(layerFinding?.notes.join(" ")).toContain("단일 Studio 그룹");
    expect(layerFinding?.notes.join(" ")).toContain("그룹 단위");
  });

  it("preserves CBZ page count but clearly reports canvas-fit display scaling", () => {
    const preview = createStudioCbzImportLossPreview("episode.cbz", {
      pages: [{ width: 2_000, height: 4_000 }] as never,
      metadata: {},
      summary: {
        pageCount: 1,
        totalEncodedBytes: 1_000,
        totalDecodedPixels: 8_000_000,
        totalDecodedBytes: 32_000_000,
        maxWidth: 2_000,
        maxHeight: 4_000,
        hasComicInfo: false,
        ignoredEntryCount: 0,
      },
      warnings: [{ code: "COMICINFO_MISSING", message: "ComicInfo.xml이 없습니다." }],
    } satisfies StudioCbzImportResult, OPTIONS);
    const summary = summarizeStudioInterchangeLoss(preview);

    expect(preview.source.pageCount).toBe(1);
    expect(preview.result).toMatchObject({ pageCount: 1, width: 1_080, height: 2_160 });
    expect(summary.status).toBe("review");
    expect(summary.findings.find((finding) => finding.category === "resolution")?.notes).toContain(
      "원본 픽셀은 보관하지만 1,080px Studio 페이지 폭에 맞춰 표시 크기를 조정합니다.",
    );
  });

  it("blocks a CBZ that would exceed the persisted Studio page limit", () => {
    const pages = Array.from({ length: 2 }, (_, index) => ({
      path: `${index + 1}.png`,
      width: 1_080,
      height: 1_920,
    })) as never;
    const preview = createStudioCbzImportLossPreview("long.cbz", {
      pages,
      metadata: {},
      summary: {
        pageCount: 2,
        totalEncodedBytes: 1_000,
        totalDecodedPixels: 1,
        totalDecodedBytes: 4,
        maxWidth: 1_080,
        maxHeight: 1_920,
        hasComicInfo: false,
        ignoredEntryCount: 0,
      },
      warnings: [],
    } satisfies StudioCbzImportResult, { ...OPTIONS, currentPageCount: 199 });

    expect(summarizeStudioInterchangeLoss(preview)).toMatchObject({
      status: "blocked",
      canConfirm: false,
    });
  });

  it("uses one real representative CBZ page and aggregates repeated codec warnings", () => {
    const warnings = Array.from({ length: 100 }, (_, index) => ({
      code: "IGNORED_ENTRY" as const,
      message: `무시 ${index + 1}`,
    }));
    const preview = createStudioCbzImportLossPreview("mixed.cbz", {
      pages: [
        { width: 2_000, height: 1_000 },
        { width: 1_000, height: 3_000 },
      ] as never,
      metadata: {},
      summary: {
        pageCount: 2,
        totalEncodedBytes: 1_000,
        totalDecodedPixels: 5_000_000,
        totalDecodedBytes: 20_000_000,
        maxWidth: 2_000,
        maxHeight: 3_000,
        hasComicInfo: false,
        ignoredEntryCount: 100,
      },
      warnings,
    } satisfies StudioCbzImportResult, OPTIONS);
    const summary = summarizeStudioInterchangeLoss(preview);

    expect(preview.source).toMatchObject({ width: 1_000, height: 3_000 });
    expect(preview.source).not.toMatchObject({ width: 2_000, height: 3_000 });
    const notes = summary.findings.flatMap((finding) => finding.notes);
    expect(notes.filter((note) => note.includes("같은 유형"))).toHaveLength(1);
    expect(notes.join(" ")).toContain("100건");
  });

  it("blocks a page whose fitted height cannot be persisted", () => {
    const preview = createStudioCbzImportLossPreview("tall.cbz", {
      pages: [{ width: 1, height: 100_001 }] as never,
      metadata: {},
      summary: {
        pageCount: 1,
        totalEncodedBytes: 1,
        totalDecodedPixels: 100_001,
        totalDecodedBytes: 400_004,
        maxWidth: 1,
        maxHeight: 100_001,
        hasComicInfo: false,
        ignoredEntryCount: 0,
      },
      warnings: [],
    } satisfies StudioCbzImportResult, OPTIONS);

    expect(summarizeStudioInterchangeLoss(preview)).toMatchObject({
      status: "blocked",
      canConfirm: false,
    });
  });
});
