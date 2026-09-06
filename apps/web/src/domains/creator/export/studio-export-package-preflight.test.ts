import { describe, expect, it } from "vitest";

import {
  mmToPxAtDpi,
  planStudioExportDialogueTxt,
  planStudioExportPrintGeometry,
  preflightStudioExportPackage,
  pxToMmAtDpi,
  recommendExportScaleForPrint,
  resolveStudioExportPageRange,
  STUDIO_EXPORT_BLEED_MM_RANGE,
  STUDIO_EXPORT_DPI_RANGE,
  STUDIO_EXPORT_MAX_CANVAS_DIM,
  STUDIO_EXPORT_MAX_CANVAS_PIXELS,
  STUDIO_EXPORT_TRIM_MM_RANGE,
  studioExportGeometryPreset,
  studioExportMaxSafeScale,
  validateStudioExportGeometry,
} from "./studio-export-package-preflight";

import type { DialoguePageLike } from "../lettering/studio-dialogue-batch";

const dialoguePages: DialoguePageLike[] = [
  {
    id: "p1",
    elements: [
      { id: "b1", type: "bubble", text: "안녕", x: 0, y: 0, width: 100, height: 60 },
      { id: "t1", type: "text", text: "지문", x: 0, y: 80, width: 100 },
    ],
  },
  {
    id: "p2",
    elements: [
      { id: "b2", type: "bubble", text: "잘 가", x: 0, y: 0, width: 100, height: 60 },
    ],
  },
  {
    id: "p3",
    elements: [{ id: "frame", type: "frame", x: 0, y: 0, width: 100, height: 100 }],
  },
];

describe("resolveStudioExportPageRange", () => {
  it("defaults to the full inclusive range", () => {
    expect(resolveStudioExportPageRange(3)).toEqual({ ok: true, indices: [0, 1, 2] });
  });

  it("rejects inverted, out-of-bounds, and empty page counts with Korean reasons", () => {
    const empty = resolveStudioExportPageRange(0);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0]?.message).toContain("페이지");

    const inverted = resolveStudioExportPageRange(3, { fromIndex: 2, toIndex: 1 });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.issues[0]?.code).toBe("PAGE_RANGE_INVALID");

    const oob = resolveStudioExportPageRange(3, { fromIndex: 0, toIndex: 9 });
    expect(oob.ok).toBe(false);
  });

  it("keeps a contiguous sub-range", () => {
    expect(resolveStudioExportPageRange(5, { fromIndex: 1, toIndex: 3 })).toEqual({
      ok: true,
      indices: [1, 2, 3],
    });
  });
});

describe("mm/px conversion and geometry presets", () => {
  it("converts mm ↔ px at DPI with 25.4 mm/inch", () => {
    // 25.4 mm at 300 dpi → 300 px (one inch).
    expect(mmToPxAtDpi(25.4, 300)).toBeCloseTo(300, 5);
    expect(pxToMmAtDpi(300, 300)).toBeCloseTo(25.4, 5);
    // Round-trip.
    expect(pxToMmAtDpi(mmToPxAtDpi(148, 300), 300)).toBeCloseTo(148, 5);
  });

  it("exports inclusive editor ranges aligned with validation", () => {
    expect(STUDIO_EXPORT_DPI_RANGE).toEqual({ min: 36, max: 1200 });
    expect(STUDIO_EXPORT_BLEED_MM_RANGE).toEqual({ min: 0, max: 50 });
    expect(STUDIO_EXPORT_TRIM_MM_RANGE).toEqual({ min: 0.1, max: 2000 });
  });

  it("returns named geometry presets", () => {
    expect(studioExportGeometryPreset("webtoon72")).toEqual({ dpi: 72 });
    expect(studioExportGeometryPreset("print300-b6")).toEqual({
      dpi: 300,
      trimWidthMm: 148,
      trimHeightMm: 210,
      bleedMm: 3,
    });
    expect(studioExportGeometryPreset("print300-a4")).toEqual({
      dpi: 300,
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
    });
  });

  it("recommends integer export scale 1–3 to cover trim at DPI", () => {
    // Canvas already larger than B6 @ 72 dpi → scale 1.
    expect(
      recommendExportScaleForPrint({
        canvasWidthPx: 2000,
        canvasHeightPx: 3000,
        trimWidthMm: 148,
        trimHeightMm: 210,
        dpi: 72,
      })
    ).toBe(1);

    // Tiny canvas vs A4 @ 300 dpi needs max scale.
    expect(
      recommendExportScaleForPrint({
        canvasWidthPx: 400,
        canvasHeightPx: 600,
        trimWidthMm: 210,
        trimHeightMm: 297,
        dpi: 300,
      })
    ).toBe(3);

    // Invalid inputs fall back to 1.
    expect(
      recommendExportScaleForPrint({
        canvasWidthPx: 0,
        canvasHeightPx: 100,
        trimWidthMm: 148,
        trimHeightMm: 210,
        dpi: 300,
      })
    ).toBe(1);
  });
});

describe("validateStudioExportGeometry", () => {
  it("accepts screen webtoon geometry without trim/bleed", () => {
    const result = validateStudioExportGeometry({
      widthPx: 800,
      heightPx: 1280,
      dpi: 72,
    });
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.outputSizeMm).toBeNull();
  });

  it("blocks invalid DPI and bleed that consumes trim", () => {
    const dpi = validateStudioExportGeometry({
      widthPx: 800,
      heightPx: 1280,
      dpi: 12,
    });
    expect(dpi.issues.some((issue) => issue.code === "DPI_INVALID" && issue.severity === "error")).toBe(
      true
    );

    const bleed = validateStudioExportGeometry({
      widthPx: 2400,
      heightPx: 3600,
      dpi: 300,
      trimWidthMm: 10,
      trimHeightMm: 15,
      bleedMm: 6,
    });
    expect(bleed.issues.some((issue) => issue.code === "BLEED_EXCEEDS_TRIM")).toBe(true);
  });

  it("computes output size with valid bleed", () => {
    const result = validateStudioExportGeometry({
      widthPx: 2400,
      heightPx: 3600,
      dpi: 300,
      trimWidthMm: 148,
      trimHeightMm: 210,
      bleedMm: 3,
    });
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.outputSizeMm).toEqual({ width: 154, height: 216 });
  });
});

describe("planStudioExportDialogueTxt / preflightStudioExportPackage", () => {
  it("serializes dialogue as TXT for the selected page range", () => {
    const plan = planStudioExportDialogueTxt({
      pages: dialoguePages,
      title: "에피소드1",
      pageIndices: [0, 1],
    });
    expect(plan).not.toBeNull();
    expect(plan?.cueCount).toBe(3);
    expect(plan?.fileName).toBe("에피소드1.txt");
    expect(plan?.text).toContain("안녕");
    expect(plan?.text).toContain("잘 가");
    expect(plan?.text).not.toContain("frame");
  });

  it("embeds 漢字(かんじ) ruby preview when the source element has rubySpans", () => {
    const pagesWithRuby: DialoguePageLike[] = [
      {
        id: "p-ruby",
        elements: [
          {
            id: "b-ruby",
            type: "bubble",
            text: "漢字テスト",
            x: 0,
            y: 0,
            width: 100,
            height: 60,
            // DialoguePageLike is structural; rubySpans live on elements at runtime.
            ...({
              rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
            } as object),
          },
          {
            id: "t-plain",
            type: "text",
            text: "지문 그대로",
            x: 0,
            y: 80,
            width: 100,
          },
        ],
      },
    ];
    const plan = planStudioExportDialogueTxt({
      pages: pagesWithRuby,
      title: "ruby-export",
    });
    expect(plan).not.toBeNull();
    expect(plan?.cueCount).toBe(2);
    expect(plan?.text).toContain("漢字(かんじ)テスト");
    // Sibling without rubySpans stays plain.
    expect(plan?.text).toContain("지문 그대로");
    expect(plan?.text).not.toContain("지문 그대로(");
  });

  it("keeps plain cue text when the source element has no rubySpans", () => {
    const plan = planStudioExportDialogueTxt({
      pages: dialoguePages,
      title: "plain-export",
      pageIndices: [0],
    });
    expect(plan).not.toBeNull();
    expect(plan?.cueCount).toBe(2);
    expect(plan?.text).toContain("안녕");
    expect(plan?.text).toContain("지문");
    // No furigana parentheticals when elements lack rubySpans.
    expect(plan?.text).not.toMatch(/\S+\([^)]+\)/u);
  });

  it("accepts a valid package and rejects bad range or missing required dialogue", () => {
    const ok = preflightStudioExportPackage({
      pageCount: 3,
      pageRange: { fromIndex: 0, toIndex: 1 },
      geometry: { widthPx: 800, heightPx: 1280, dpi: 72 },
      requireDialogueTxt: true,
      pagesForDialogue: dialoguePages,
      dialogueTitle: "test",
    });
    expect(ok.canExport).toBe(true);
    expect(ok.pageIndices).toEqual([0, 1]);
    expect(ok.dialogueTxt?.cueCount).toBe(3);
    expect(ok.errors).toEqual([]);

    const badRange = preflightStudioExportPackage({
      pageCount: 3,
      pageRange: { fromIndex: 2, toIndex: 0 },
    });
    expect(badRange.canExport).toBe(false);
    expect(badRange.errors[0]?.message).toMatch(/페이지 범위/);

    const emptyDialogue = preflightStudioExportPackage({
      pageCount: 3,
      pageRange: { fromIndex: 2, toIndex: 2 },
      requireDialogueTxt: true,
      pagesForDialogue: dialoguePages,
    });
    expect(emptyDialogue.canExport).toBe(false);
    expect(emptyDialogue.errors.some((issue) => issue.code === "DIALOGUE_TXT_EMPTY")).toBe(true);
  });
});

describe("studioExportMaxSafeScale", () => {
  it("bounds scale by canvas side and pixel-area budget, not by the 1–3 button row", () => {
    expect(STUDIO_EXPORT_MAX_CANVAS_DIM).toBe(16_384);
    expect(STUDIO_EXPORT_MAX_CANVAS_PIXELS).toBe(100_000_000);

    // 720×1080 webtoon page: 11.34× before the area budget bites — the 3× cap was never a
    // safety limit for this canvas.
    expect(studioExportMaxSafeScale({ canvasWidthPx: 720, canvasHeightPx: 1080 })).toBeCloseTo(11.34, 2);

    // A tall page is bounded by the 16384 px side limit instead.
    expect(
      studioExportMaxSafeScale({ canvasWidthPx: 200, canvasHeightPx: 8000 })
    ).toBeCloseTo(2.04, 2);
  });
});

describe("planStudioExportPrintGeometry", () => {
  const a4 = {
    canvasWidthPx: 720,
    canvasHeightPx: 1080,
    dpi: 300,
    trimWidthMm: 210,
    trimHeightMm: 297,
    bleedMm: 3,
  };

  it("reports the DPI the current scale really delivers instead of the requested one", () => {
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 3 });
    expect(plan).not.toBeNull();
    // Output box = trim + bleed on every side.
    expect(plan!.outputWidthMm).toBe(216);
    expect(plan!.outputHeightMm).toBe(303);
    expect(plan!.requiredWidthPx).toBe(2552);
    expect(plan!.requiredHeightPx).toBe(3579);
    // 3× is 2160×3240 px — 254 DPI against a 216×303 mm sheet, not 300.
    expect(plan!.currentWidthPx).toBe(2160);
    expect(plan!.currentHeightPx).toBe(3240);
    expect(Math.round(plan!.currentDpi)).toBe(254);
    expect(plan!.meetsTargetDpi).toBe(false);
    expect(plan!.issue?.code).toBe("PRINT_DPI_BELOW_TARGET");
    expect(plan!.issue?.severity).toBe("error");
    expect(plan!.issue?.message).toContain("254DPI");
    expect(plan!.issue?.message).toContain("300DPI");
  });

  it("recommends the exact scale that reaches the target instead of clamping to 3×", () => {
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 3 })!;
    // The legacy button-row recommender silently clamps this to 3× (261 DPI).
    expect(
      recommendExportScaleForPrint({
        canvasWidthPx: 720,
        canvasHeightPx: 1080,
        trimWidthMm: 210,
        trimHeightMm: 297,
        dpi: 300,
      })
    ).toBe(3);
    expect(plan.neededScale).toBeGreaterThan(3);
    expect(plan.recommendedScale).toBe(3.55);
    expect(plan.recommendedWidthPx).toBe(2556);
    expect(plan.recommendedHeightPx).toBe(3834);
    expect(plan.recommendedDpi).toBeGreaterThanOrEqual(300);
    expect(plan.reachable).toBe(true);
  });

  it("models the exporter's truncation, so it never quotes more pixels than it can deliver", () => {
    // The export ends at `canvas.width = size * pixelRatio`, which discards the fraction.
    // Rounding up would promise a pixel row the file does not contain.
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 3.56 })!;
    expect(plan.currentWidthPx).toBe(Math.floor(720 * 3.56));
    expect(plan.currentHeightPx).toBe(Math.floor(1080 * 3.56));
    expect(plan.currentHeightPx).toBe(3844);
    expect(plan.currentHeightPx).toBeLessThan(Math.round(1080 * 3.56));
  });

  it("keeps the recommended scale covering the requirement after truncation", () => {
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 1 })!;
    expect(Math.floor(720 * plan.recommendedScale)).toBeGreaterThanOrEqual(plan.requiredWidthPx);
    expect(Math.floor(1080 * plan.recommendedScale)).toBeGreaterThanOrEqual(plan.requiredHeightPx);
  });

  it("clears the issue once the recommended scale is applied", () => {
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 3.55 })!;
    expect(plan.meetsTargetDpi).toBe(true);
    expect(plan.issue).toBeNull();
    expect(Math.round(plan.currentDpi)).toBe(301);
  });

  it("blocks with the required canvas size when the target is out of reach", () => {
    const plan = planStudioExportPrintGeometry({
      canvasWidthPx: 4000,
      canvasHeightPx: 4000,
      dpi: 600,
      trimWidthMm: 500,
      trimHeightMm: 500,
      exportScale: 1,
    })!;
    expect(plan.reachable).toBe(false);
    expect(plan.issue?.code).toBe("PRINT_DPI_UNREACHABLE");
    expect(plan.issue?.severity).toBe("error");
    expect(plan.issue?.message).toContain("4000×4000px");
    expect(plan.requiredCanvasWidthPx).toBeGreaterThan(4000);
    expect(plan.issue?.message).toContain(`${plan.requiredCanvasWidthPx}×${plan.requiredCanvasHeightPx}px`);
  });

  it("never recommends a downscale when the canvas already exceeds the target", () => {
    const plan = planStudioExportPrintGeometry({
      canvasWidthPx: 4000,
      canvasHeightPx: 6000,
      dpi: 300,
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
      exportScale: 1,
    })!;
    expect(plan.neededScale).toBeLessThan(1);
    expect(plan.recommendedScale).toBe(1);
    expect(plan.meetsTargetDpi).toBe(true);
    expect(plan.issue).toBeNull();
  });

  it("surfaces how far the printed page overruns the output box", () => {
    const plan = planStudioExportPrintGeometry({ ...a4, exportScale: 3.55 })!;
    // 720×1080 is taller than 216×303 mm, so height overflows while width lands on the box.
    expect(plan.overflowWidthMm).toBeCloseTo(0, 1);
    expect(plan.overflowHeightMm).toBeGreaterThan(10);
  });

  it("returns null when there is no print geometry to plan", () => {
    expect(
      planStudioExportPrintGeometry({
        canvasWidthPx: 720,
        canvasHeightPx: 1080,
        dpi: 72,
        trimWidthMm: 0,
        trimHeightMm: 0,
        exportScale: 2,
      })
    ).toBeNull();
  });
});

describe("preflightStudioExportPackage — print resolution honesty", () => {
  const a4Geometry = {
    widthPx: 720,
    heightPx: 1080,
    dpi: 300,
    trimWidthMm: 210,
    trimHeightMm: 297,
    bleedMm: 3,
  };

  it("blocks the package when the selected scale cannot deliver the requested DPI", () => {
    const result = preflightStudioExportPackage({
      pageCount: 1,
      geometry: a4Geometry,
      exportScale: 2,
    });
    expect(result.canExport).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("PRINT_DPI_BELOW_TARGET");
    // The plan is reported, not just the failure, so the UI shows the same numbers it blocks on.
    expect(result.printPlan).not.toBeNull();
    expect(result.printPlan!.currentWidthPx).toBe(1440);
    expect(result.printPlan!.currentHeightPx).toBe(2160);
    expect(Math.round(result.printPlan!.currentDpi)).toBe(169);
  });

  it("passes once the recommended scale is applied", () => {
    const blocked = preflightStudioExportPackage({
      pageCount: 1,
      geometry: a4Geometry,
      exportScale: 2,
    });
    const result = preflightStudioExportPackage({
      pageCount: 1,
      geometry: a4Geometry,
      exportScale: blocked.printPlan!.recommendedScale,
    });
    expect(result.canExport).toBe(true);
    expect(result.printPlan!.meetsTargetDpi).toBe(true);
    expect(result.printPlan!.currentDpi).toBeGreaterThanOrEqual(300);
  });

  it("blocks with the required canvas size when the target is unreachable", () => {
    const result = preflightStudioExportPackage({
      pageCount: 1,
      geometry: { ...a4Geometry, trimWidthMm: 1000, trimHeightMm: 1400 },
      exportScale: 2,
    });
    expect(result.canExport).toBe(false);
    const unreachable = result.errors.find((issue) => issue.code === "PRINT_DPI_UNREACHABLE");
    expect(unreachable).toBeDefined();
    expect(unreachable!.message).toContain("캔버스를");
    expect(unreachable!.message).toContain("px 이상으로 키운 뒤");
  });

  it("leaves screen/webtoon packs alone — no trim means no print plan and no block", () => {
    const result = preflightStudioExportPackage({
      pageCount: 1,
      geometry: { widthPx: 720, heightPx: 1080, dpi: 72 },
      exportScale: 2,
    });
    expect(result.printPlan).toBeNull();
    expect(result.canExport).toBe(true);
  });

  it("does not stack a resolution message on top of an invalid geometry", () => {
    const result = preflightStudioExportPackage({
      pageCount: 1,
      geometry: { ...a4Geometry, bleedMm: 200 },
      exportScale: 2,
    });
    expect(result.printPlan).toBeNull();
    expect(result.errors.some((issue) => issue.code.startsWith("PRINT_DPI_"))).toBe(false);
  });
});
