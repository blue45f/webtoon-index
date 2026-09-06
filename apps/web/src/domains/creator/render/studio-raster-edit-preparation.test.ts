import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  prepareStudioVectorReferenceExport,
  renderPreparedStudioVectorReference,
  renderStudioVectorReference,
} from "../studio-vector-fill-reference";

import {
  applyStudioEditableRasterCopy,
  createStudioEditablePageRasterContext,
  describeStudioEditableRasterSelectionSurface,
  isStudioEditableRasterCopyPlanCurrent,
  materializeStudioEditableRasterCopy,
  planStudioEditableRasterCopy,
  prepareAndRenderStudioEditableRasterCopy,
  renderStudioEditableRasterCopy,
  STUDIO_EDITABLE_RASTER_SELECTION_TOOL_KINDS,
  summarizeStudioRasterPreparationSources,
} from "./studio-raster-edit-preparation";

import type { El } from "../studio-element-model";
import type { StudioVectorReferencePreparedExport } from "../studio-vector-fill-reference";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PAGE_COMPOSITE_MAX_BYTES = 4 * 1024 * 1024;

function preparedVectorExport(input: {
  readonly svg?: string;
  readonly width?: number;
  readonly height?: number;
  readonly elementCount?: number;
  readonly skipped?: StudioVectorReferencePreparedExport["result"]["skipped"];
  readonly maxSvgBytes?: number;
  readonly maxPngBytes?: number;
} = {}): StudioVectorReferencePreparedExport {
  return {
    result: {
      svg: input.svg ?? '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"></svg>',
      skipped: input.skipped ? [...input.skipped] : [],
      fontFamilies: [],
      caveats: [],
      elementCount: input.elementCount ?? 1,
    },
    execution: "worker",
    width: input.width ?? 320,
    height: input.height ?? 480,
    fingerprintNamespace: "editable-raster-copy-v1",
    maxSvgBytes: input.maxSvgBytes ?? 16 * 1024 * 1024,
    maxPngBytes: input.maxPngBytes ?? 32 * 1024 * 1024,
  };
}

function renderedPreparedVectorExport(
  prepared: StudioVectorReferencePreparedExport,
) {
  return {
    dataUrl: PNG,
    fingerprint: `${prepared.fingerprintNamespace}:0000000000000000`,
    elementCount: prepared.result.elementCount,
    width: prepared.width,
    height: prepared.height,
    svgByteLength: new TextEncoder().encode(prepared.result.svg).byteLength,
    pngByteLength: 8,
    execution: prepared.execution,
  } as const;
}

function line(id = "line", patch: Partial<Extract<El, { type: "draw" }>> = {}): Extract<El, { type: "draw" }> {
  return {
    id,
    type: "draw",
    kind: "freehand",
    points: [10, 10, 40, 40],
    stroke: "#111111",
    strokeWidth: 4,
    brush: "gpen",
    ...patch,
  };
}

function text(id = "text"): Extract<El, { type: "text" }> {
  return {
    id,
    type: "text",
    text: "대사",
    x: 20,
    y: 20,
    width: 120,
    fontSize: 24,
    fill: "#111111",
    rotation: 0,
  };
}

function bubble(id = "bubble"): Extract<El, { type: "bubble" }> {
  return {
    id,
    type: "bubble",
    variant: "speech",
    text: "짧은 대사",
    x: 50,
    y: 60,
    width: 140,
    height: 80,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
  };
}

function frame(id = "frame"): Extract<El, { type: "frame" }> {
  return {
    id,
    type: "frame",
    x: 8,
    y: 12,
    width: 280,
    height: 220,
    bgColor: "#ffffff",
    stroke: "#111111",
    strokeWidth: 3,
  };
}

function shape(id = "shape"): Extract<El, { type: "draw" }> {
  return line(id, {
    kind: "ellipse",
    points: [80, 90, 180, 190],
    fill: "#f2efe8",
  });
}

function image(
  id = "image",
  patch: Partial<Extract<El, { type: "image" }>> = {},
): Extract<El, { type: "image" }> {
  return {
    id,
    type: "image",
    src: PNG,
    x: 0,
    y: 0,
    width: 120,
    height: 100,
    rotation: 0,
    ...patch,
  };
}

function pageRasterContext(options: {
  width?: number;
  height?: number;
  sharedDocument?: boolean;
  localHiddenElementIds?: ReadonlySet<string>;
  budgets?: {
    maxPixelCount?: number;
    maxPngBytes?: number;
  };
  purpose?: "page-filter" | "pixel-selection";
} = {}) {
  const pageElements: El[] = [line()];
  return createStudioEditablePageRasterContext({
    page: {
      id: "page-1",
      canvasH: options.height ?? 480,
      elements: pageElements,
      bg: "#ffffff",
    },
    canvasWidth: options.width ?? 320,
    masterElements: [],
    localHiddenElementIds: options.localHiddenElementIds ?? new Set<string>(),
    name: "필터 · 현재 페이지 합성",
    collaborationLockedReason: null,
    sharedDocument: options.sharedDocument ?? false,
    masterEditMode: false,
    reviewLocked: false,
    timelinePlaying: false,
    viewTransformSuppressed: false,
    purpose: options.purpose,
    budgets: options.budgets,
  });
}

function fullPageComposite(
  plan: { readonly width: number; readonly height: number },
  src = PNG,
): Extract<El, { type: "image" }> {
  return {
    id: "filtered-copy",
    type: "image",
    src,
    x: 0,
    y: 0,
    width: plan.width,
    height: plan.height,
    rotation: 0,
  };
}

function oversizedPngDataUrl(): string {
  const minimumPayloadLength = Math.ceil((PAGE_COMPOSITE_MAX_BYTES + 1) * 4 / 3);
  const alignedPayloadLength = Math.ceil(minimumPayloadLength / 4) * 4;
  const signature = "iVBORw0KGgo";
  return `data:image/png;base64,${signature}${"A".repeat(alignedPayloadLength - signature.length)}`;
}

describe("editable raster copy planning", () => {
  it("caps page-composite pixel and PNG budgets at exactly 4 Mi units", () => {
    const defaults = pageRasterContext();
    const clamped = pageRasterContext({
      budgets: {
        maxPixelCount: 64 * 1024 * 1024,
        maxPngBytes: 64 * 1024 * 1024,
      },
    });
    const stricter = pageRasterContext({
      budgets: {
        maxPixelCount: 1_000_000,
        maxPngBytes: 2_000_000,
      },
    });

    expect(defaults.input.budgets).toMatchObject({
      maxPixelCount: PAGE_COMPOSITE_MAX_BYTES,
      maxPngBytes: PAGE_COMPOSITE_MAX_BYTES,
    });
    expect(clamped.input.budgets).toMatchObject({
      maxPixelCount: PAGE_COMPOSITE_MAX_BYTES,
      maxPngBytes: PAGE_COMPOSITE_MAX_BYTES,
    });
    expect(stricter.input.budgets).toMatchObject({
      maxPixelCount: 1_000_000,
      maxPngBytes: 2_000_000,
    });
  });

  it("keeps the general render budget and hides originals for pixel-selection preparation", () => {
    const context = pageRasterContext({
      purpose: "pixel-selection",
      budgets: {
        maxPixelCount: 8 * 1024 * 1024,
        maxPngBytes: 12 * 1024 * 1024,
      },
    });
    const planned = planStudioEditableRasterCopy(context.input);

    expect(context.input.budgets).toEqual({
      maxPixelCount: 8 * 1024 * 1024,
      maxPngBytes: 12 * 1024 * 1024,
    });
    expect(context.input.sourceDisposition).toBe("hide-originals");
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        sourceDisposition: "hide-originals",
        frame: { x: 0, y: 0, width: 320, height: 480, rotation: 0 },
      },
    });
  });

  it("rejects a page-composite pixel budget before the injected renderer can run", () => {
    const context = pageRasterContext({ width: 2_048, height: 2_049 });
    const renderer = vi.fn();

    expect(planStudioEditableRasterCopy(context.input)).toMatchObject({
      ok: false,
      code: "invalid-dimensions",
    });
    expect(renderer).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "shared documents",
      options: { sharedDocument: true },
      recovery: /공동 작업 문서.*동일한 픽셀 결과.*선택 이미지 필터/u,
    },
    {
      label: "local-only hidden layers",
      options: { localHiddenElementIds: new Set(["line"]) },
      recovery: /나만 숨기기.*다시 표시.*공유·저장/u,
    },
  ])("fails closed for $label in the extracted page context", ({ options, recovery }) => {
    const context = pageRasterContext(options);

    expect(context.input.documentMutationBlockedReason).toMatch(recovery);
    expect(planStudioEditableRasterCopy(context.input)).toMatchObject({
      ok: false,
      code: "document-locked",
      reason: expect.stringMatching(recovery),
    });
    expect(context.destinationElements).toHaveLength(1);
    expect(context.destinationElements[0]).toBe(context.input.elements[0]);
  });

  it("ignores local-only hidden ids that belong to another page", () => {
    const context = pageRasterContext({
      localHiddenElementIds: new Set(["different-page-line"]),
    });

    expect(context.input.documentMutationBlockedReason).toBeNull();
    expect(planStudioEditableRasterCopy(context.input)).toMatchObject({ ok: true });
  });

  it("summarizes exact, hidden, locked, raster and vector sources for all UI surfaces", () => {
    const summary = summarizeStudioRasterPreparationSources({
      width: 320,
      height: 480,
      elements: [
        line("visible"),
        line("eraser", { mode: "eraser" }),
        line("hidden", { hidden: true }),
        {
          id: "image",
          type: "image",
          src: PNG,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          locked: true,
        },
      ],
    });

    expect(summary).toMatchObject({
      frame: { x: 0, y: 0, width: 320, height: 480, rotation: 0 },
      sourceBounds: { x: 0, y: 0, width: 100, height: 100 },
      orderedVisibleSourceIds: ["visible", "eraser", "image"],
      exactRenderableSourceIds: ["visible", "image"],
      lockedVisibleSourceIds: ["image"],
      visibleContentCount: 3,
      hiddenContentCount: 1,
      visibleRasterCount: 1,
      visibleUnlockedRasterCount: 0,
      visibleVectorDrawCount: 1,
      visibleCompositeVectorCount: 1,
      visibleLinked3dPreviewCount: 0,
      exactRenderableVisibleCount: 2,
      unsupportedVisibleCount: 1,
      hasPageBackground: true,
    });
  });

  it("censuses freehand, smart shape, frame, text, bubble and linked 3D preview in one z-order", () => {
    const linked3d = image("linked-3d", {
      x: 200,
      y: 260,
      bg3dScene: {} as Extract<El, { type: "image" }>["bg3dScene"],
    });
    const elements: El[] = [
      frame(),
      line(),
      shape(),
      text(),
      bubble(),
      linked3d,
    ];
    const summary = summarizeStudioRasterPreparationSources({
      width: 320,
      height: 480,
      elements,
    });
    const result = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements,
      includeBackground: true,
      sourceDisposition: "hide-originals",
      sourceDispositionIds: elements.map((element) => element.id),
    });

    expect(summary).toMatchObject({
      orderedVisibleSourceIds: ["frame", "line", "shape", "text", "bubble", "linked-3d"],
      exactRenderableSourceIds: ["frame", "line", "shape", "text", "bubble", "linked-3d"],
      visibleVectorDrawCount: 2,
      visibleCompositeVectorCount: 5,
      visibleLinked3dPreviewCount: 1,
      exactRenderableVisibleCount: 6,
      unsupportedVisibleCount: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      plan: {
        sourceIds: ["frame", "line", "shape", "text", "bubble", "linked-3d"],
        sourceDispositionIds: ["frame", "line", "shape", "text", "bubble", "linked-3d"],
        frame: { x: 0, y: 0, width: 320, height: 480, rotation: 0 },
        sourceSummary: {
          exactRenderableVisibleCount: 6,
          unsupportedVisibleCount: 0,
        },
      },
    });
  });

  it("keeps transparent geometry out of selectable bounds and never plans a blank transparent copy", () => {
    const transparent = line("transparent", {
      opacity: 0,
      points: [-100, -100, 600, 600],
    });
    const edgeLine = line("edge", {
      points: [-20, 20, 40, 20],
      strokeWidth: 10,
    });
    const summary = summarizeStudioRasterPreparationSources({
      width: 100,
      height: 80,
      elements: [transparent, edgeLine],
      hasPageBackground: false,
    });

    expect(summary).toMatchObject({
      orderedVisibleSourceIds: ["edge"],
      visibleVectorDrawCount: 1,
      sourceBounds: { x: 0, y: 15, width: 45, height: 10 },
    });
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 100,
      height: 80,
      elements: [transparent],
      includeBackground: false,
    })).toMatchObject({
      ok: false,
      code: "no-visible-source",
    });
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 100,
      height: 80,
      elements: [transparent],
      includeBackground: true,
      sourceDisposition: "hide-originals",
    })).toMatchObject({
      ok: false,
      code: "no-visible-source",
    });
  });

  it("includes locked sources in preserve-visible composites but blocks hide-originals mutations", () => {
    const lockedGroup = { id: "locked-group", name: "잠금", locked: true };
    const lockedLine = line("locked-line", { groupId: lockedGroup.id });
    const preserve = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [lockedLine],
      groups: [lockedGroup],
      includeBackground: false,
      sourceDisposition: "preserve-visible",
    });
    const hide = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [lockedLine],
      groups: [lockedGroup],
      includeBackground: false,
      sourceDisposition: "hide-originals",
      sourceDispositionIds: [lockedLine.id],
    });

    expect(preserve).toMatchObject({
      ok: true,
      plan: {
        sourceIds: ["locked-line"],
        sourceSummary: { lockedVisibleSourceIds: ["locked-line"] },
      },
    });
    expect(hide).toMatchObject({
      ok: false,
      code: "source-locked",
      reason: expect.stringMatching(/잠금/u),
    });
  });

  it("renders locked master underlays but only hides authored disposition targets", () => {
    const master = line("master", { locked: true });
    const pageLine = line("page-line");
    const result = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [master, pageLine],
      includeBackground: true,
      insertionIndex: 1,
      sourceDisposition: "hide-originals",
      sourceDispositionIds: [pageLine.id],
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        sourceIds: ["master", "page-line"],
        sourceDispositionIds: ["page-line"],
      },
    });
  });

  it("fails closed for filtered composites, orphan/transformed groups and invalid geometry", () => {
    const transformedGroup = {
      id: "transformed",
      name: "변형 그룹",
      rotation: 15,
    } as const;
    const cases: Array<{ elements: El[]; groups?: typeof transformedGroup[] }> = [
      { elements: [image("filter-only", { filterPageComposite: true, blur: 8 })] },
      { elements: [line("orphan", { groupId: "missing-group" })] },
      {
        elements: [line("transformed-line", { groupId: transformedGroup.id })],
        groups: [transformedGroup],
      },
      { elements: [line("invalid", { points: [10, Number.NaN, 20, 30] })] },
    ];

    for (const entry of cases) {
      expect(planStudioEditableRasterCopy({
        pageId: "page-1",
        width: 320,
        height: 480,
        elements: entry.elements,
        groups: entry.groups,
        includeBackground: false,
      })).toMatchObject({
        ok: false,
        code: "unsupported-fidelity",
      });
    }
  });

  it("honors explicit exclusions and rejects ambiguous requested targets", () => {
    const elements: El[] = [line("back"), line("preview"), line("front")];
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements,
      excludedSourceIds: ["preview"],
      includeBackground: false,
    })).toMatchObject({
      ok: true,
      plan: { sourceIds: ["back", "front"] },
    });
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements,
      sourceIds: ["preview"],
      excludedSourceIds: ["preview"],
      includeBackground: false,
    })).toMatchObject({
      ok: false,
      code: "source-selection-mismatch",
    });
  });

  it("preserves z-order and invalidates the plan when the source revision is reordered", () => {
    const original = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("back"), text("middle"), line("front")],
      includeBackground: false,
    } as const;
    const planned = planStudioEditableRasterCopy(original);

    expect(planned).toMatchObject({
      ok: true,
      plan: {
        sourceIds: ["back", "middle", "front"],
        sourceSummary: {
          orderedVisibleSourceIds: ["back", "middle", "front"],
        },
      },
    });
    if (!planned.ok) return;
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, original)).toBe(true);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...original,
      elements: [line("front"), text("middle"), line("back")],
    })).toBe(false);
  });

  it("shares one deterministic image-local frame and revision across every pixel-selection tool", () => {
    const result = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("only-line")],
      includeBackground: true,
      sourceDisposition: "hide-originals",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const surfaces = STUDIO_EDITABLE_RASTER_SELECTION_TOOL_KINDS.map((toolKind) =>
      describeStudioEditableRasterSelectionSurface(result.plan, toolKind)
    );
    expect(surfaces.map((surface) => surface.toolKind)).toEqual([
      "rect",
      "ellipse",
      "lasso",
      "poly-lasso",
      "brush",
      "wand",
      "color-range",
    ]);
    for (const surface of surfaces) {
      expect(surface.frame).toBe(result.plan.frame);
      expect(surface.sourceBounds).toBe(result.plan.sourceBounds);
      expect(surface.sourceSummary).toBe(result.plan.sourceSummary);
      expect(surface.sourceFingerprint).toBe(result.plan.sourceFingerprint);
    }
  });

  it("plans an opaque full-page visible copy while preserving original elements", () => {
    const elements: El[] = [line(), text()];
    const result = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements,
      bg: "#f3e9d2",
      includeBackground: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sourceIds).toEqual(["line", "text"]);
    expect(result.plan.insertionIndex).toBe(2);
    expect(result.plan.includeBackground).toBe(true);
    expect(elements).toHaveLength(2);
  });

  it("accepts a visible draw-only page as an exact filter source", () => {
    const result = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("only-visible-line")],
      includeBackground: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sourceIds).toEqual(["only-visible-line"]);
    expect(result.plan.sourceElementCount).toBe(1);
  });

  it("filters ordinary hidden items but fails closed when an explicit source is hidden", () => {
    const hiddenFiltered = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("visible"), line("hidden", { hidden: true }), text("other")],
      includeBackground: false,
    });
    expect(hiddenFiltered).toMatchObject({
      ok: true,
      plan: { sourceIds: ["visible", "other"], includeBackground: false },
    });

    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("visible"), line("hidden", { hidden: true }), text("other")],
      sourceIds: ["visible", "hidden"],
      includeBackground: false,
    })).toMatchObject({
      ok: false,
      code: "source-selection-mismatch",
      reason: expect.stringMatching(/hidden|숨김/u),
    });
  });

  it("allows background-only merged filters but rejects an empty transparent copy", () => {
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [],
      includeBackground: true,
    }).ok).toBe(true);
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [],
      includeBackground: false,
    })).toMatchObject({ ok: false, code: "no-visible-source" });
  });

  it("fails closed for eraser/approximated fidelity and document locks", () => {
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("eraser", { mode: "eraser" })],
      includeBackground: false,
    })).toMatchObject({ ok: false, code: "unsupported-fidelity" });
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      documentMutationBlockedReason: "검토 잠금을 해제하세요.",
    })).toEqual({
      ok: false,
      code: "document-locked",
      reason: "검토 잠금을 해제하세요.",
    });
  });

  it("guards missing page ids and unsafe canvas dimensions before rendering", () => {
    expect(planStudioEditableRasterCopy({
      pageId: " ",
      width: 320,
      height: 480,
      elements: [line()],
    })).toMatchObject({ ok: false, code: "invalid-page-id" });
    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 100_000,
      height: 100_000,
      elements: [line()],
    })).toMatchObject({ ok: false, code: "invalid-dimensions" });
  });

  it("enforces source and SVG byte budgets before allocating a raster canvas", () => {
    const base = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
    } as const;
    expect(planStudioEditableRasterCopy({
      ...base,
      budgets: { maxSourceBytes: 8 },
    })).toMatchObject({ ok: false, code: "source-budget-exceeded" });
    expect(planStudioEditableRasterCopy({
      ...base,
      budgets: { maxSvgBytes: 8 },
    })).toMatchObject({ ok: false, code: "svg-budget-exceeded" });
  });

  it("fails closed when circular source data cannot be canonically fingerprinted", () => {
    const circular = line() as Extract<El, { type: "draw" }> & {
      circularOwner?: unknown;
    };
    circular.circularOwner = circular;

    expect(planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [circular],
    })).toMatchObject({
      ok: false,
      code: "source-budget-exceeded",
    });
  });
});

describe("Worker-fused editable raster preparation", () => {
  it("reuses the exact preflight source-byte receipt instead of serializing the source twice", async () => {
    const source = line("receipt-cjk", { name: "긴 한글 크레용 획" });
    const stringify = vi.spyOn(JSON, "stringify");
    let preparedElements: readonly unknown[] | null = null;

    const result = await prepareAndRenderStudioEditableRasterCopy(
      {
        pageId: "page-receipt",
        width: 320,
        height: 480,
        elements: [source],
        includeBackground: false,
      },
      async (input, options) => {
        preparedElements = input.elements;
        return prepareStudioVectorReferenceExport(input, options);
      },
      renderPreparedStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({
          dataUrl: PNG,
          width: request.width,
          height: request.height,
        }),
      },
    );
    const preparedSourceSerializations = stringify.mock.calls.filter(
      ([value]) => value === preparedElements,
    );
    stringify.mockRestore();

    expect(result.ok).toBe(true);
    expect(preparedSourceSerializations).toHaveLength(1);
  });

  it("reuses one prepared SVG object for fidelity planning and rasterization", async () => {
    const prepared = preparedVectorExport({ elementCount: 2 });
    const prepare = vi.fn(async () => prepared);
    const render = vi.fn(async (received: StudioVectorReferencePreparedExport) =>
      renderedPreparedVectorExport(received));

    const result = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line(), text()],
      includeBackground: false,
      sourceDisposition: "hide-originals",
    }, prepare, render);

    expect(result.ok).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]?.[0]).toBe(prepared);
    if (!result.ok) return;
    expect(result.plan.sourceElementCount).toBe(2);
    expect(result.rendered.fingerprint).toBe(result.plan.sourceFingerprint);
  });

  it("keeps the established sync plan byte-for-byte equivalent to a fused direct export", async () => {
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line(), text(), shape()],
      groups: [] as const,
      includeBackground: true,
      bg: "#f3e9d2",
      name: "동일성 검사",
      sourceDisposition: "preserve-visible" as const,
    };
    const synchronous = planStudioEditableRasterCopy(input);
    expect(synchronous.ok).toBe(true);

    let rasterizedSvg = "";
    const fused = await prepareAndRenderStudioEditableRasterCopy(
      input,
      prepareStudioVectorReferenceExport,
      renderPreparedStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => {
          rasterizedSvg = request.svg;
          return { dataUrl: PNG, width: request.width, height: request.height };
        },
      },
    );

    expect(fused.ok).toBe(true);
    if (!synchronous.ok || !fused.ok) return;
    expect(fused.plan).toEqual(synchronous.plan);
    expect(rasterizedSvg).not.toContain("동일성 검사");
    expect(rasterizedSvg).toContain("#f3e9d2");
    expect(fused.rendered.fingerprint).toBe(fused.plan.sourceFingerprint);
  });

  it("fails closed on the authoritative Worker skip census before rasterization", async () => {
    const prepared = preparedVectorExport({
      skipped: [{
        id: "line",
        type: "draw",
        mode: "approximated",
        label: "지우개 합성은 SVG에 없어 근사됩니다.",
      }],
    });
    const render = vi.fn(async () => renderedPreparedVectorExport(prepared));
    const result = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
    }, async () => prepared, render);

    expect(result).toMatchObject({ ok: false, code: "unsupported-fidelity" });
    expect(result.ok ? "" : result.reason).toMatch(/지우개/u);
    expect(render).not.toHaveBeenCalled();
  });

  it("enforces source and SVG budgets before any unsafe downstream phase", async () => {
    const prepare = vi.fn(async () => preparedVectorExport());
    const render = vi.fn(async (prepared: StudioVectorReferencePreparedExport) =>
      renderedPreparedVectorExport(prepared));
    const sourceLimited = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
      budgets: { maxSourceBytes: 1 },
    }, prepare, render);
    expect(sourceLimited).toMatchObject({ ok: false, code: "source-budget-exceeded" });
    expect(prepare).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    const oversizedSvg = preparedVectorExport({
      svg: `<svg>${"x".repeat(128)}</svg>`,
      maxSvgBytes: 16,
    });
    const svgLimited = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
      budgets: { maxSvgBytes: 16 },
    }, async () => oversizedSvg, render);
    expect(svgLimited).toMatchObject({ ok: false, code: "svg-budget-exceeded" });
    expect(render).not.toHaveBeenCalled();
  });

  it("preserves document/source locks and the PNG budget on the fused path", async () => {
    const prepare = vi.fn(async () => preparedVectorExport());
    const render = vi.fn(async (prepared: StudioVectorReferencePreparedExport) =>
      renderedPreparedVectorExport(prepared));

    const documentLocked = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
      documentMutationBlockedReason: "검토 잠금",
    }, prepare, render);
    expect(documentLocked).toMatchObject({ ok: false, code: "document-locked" });

    const sourceLocked = await prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line("line", { locked: true })],
      includeBackground: false,
      sourceDisposition: "hide-originals",
    }, prepare, render);
    expect(sourceLocked).toMatchObject({ ok: false, code: "source-locked" });
    expect(prepare).not.toHaveBeenCalled();

    const pngLimitedPrepared = preparedVectorExport({ maxPngBytes: 1 });
    await expect(prepareAndRenderStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
      budgets: { maxPngBytes: 1 },
    }, async () => pngLimitedPrepared, async () =>
      renderedPreparedVectorExport(pngLimitedPrepared))).rejects.toThrow(/허용치/u);
  });

  it("preserves stale ownership checks after its single async preparation boundary", async () => {
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
    } as const;
    const prepared = preparedVectorExport();
    const result = await prepareAndRenderStudioEditableRasterCopy(
      input,
      async () => prepared,
      async () => renderedPreparedVectorExport(prepared),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isStudioEditableRasterCopyPlanCurrent(result.plan, input)).toBe(true);
    expect(isStudioEditableRasterCopyPlanCurrent(result.plan, {
      ...input,
      elements: [line("line", { points: [10, 10, 70, 90] })],
    })).toBe(false);
  });

  it("honors abort before export and between export and rasterization", async () => {
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
    } as const;
    const prepared = preparedVectorExport();
    const prepare = vi.fn(async () => prepared);
    const render = vi.fn(async () => renderedPreparedVectorExport(prepared));
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await expect(prepareAndRenderStudioEditableRasterCopy(
      input,
      prepare,
      render,
      { signal: alreadyAborted.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(prepare).not.toHaveBeenCalled();

    const betweenPhases = new AbortController();
    await expect(prepareAndRenderStudioEditableRasterCopy(
      input,
      async () => {
        betweenPhases.abort();
        return prepared;
      },
      render,
      { signal: betweenPhases.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps the fused implementation off the synchronous SVG exporter", () => {
    const implementation = readFileSync(
      new URL("./studio-raster-edit-preparation.ts", import.meta.url),
      "utf8",
    );
    const start = implementation.indexOf("export async function prepareAndRenderStudioEditableRasterCopy");
    const end = implementation.indexOf("export function materializeStudioEditableRasterCopy", start);
    const fusedBody = implementation.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(fusedBody).toContain("prepared.result");
    expect(fusedBody).not.toContain("exportPageToSvg");
    expect(fusedBody).not.toContain("planStudioEditableRasterCopy(");
  });
});

describe("editable raster copy rendering", () => {
  it("uses the shared SVG-to-PNG seam and materializes exactly one full-page ImageEl", async () => {
    const planned = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line(), text()],
      bg: "#f3e9d2",
      name: "필터 합성 레이어",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rasterize = vi.fn(async (request: { svg: string; width: number; height: number }) => ({
      dataUrl: PNG,
      width: request.width,
      height: request.height,
    }));
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize,
      },
    );
    expect(rasterize).toHaveBeenCalledOnce();
    expect(rasterize.mock.calls[0]?.[0].svg).toContain("#f3e9d2");
    expect(rendered.fingerprint).toBe(planned.plan.sourceFingerprint);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: planned.plan.sourceElements,
      bg: "#f3e9d2",
      name: "필터 합성 레이어",
    })).toBe(true);
    expect(materializeStudioEditableRasterCopy({
      plan: planned.plan,
      rendered,
      newId: "copy-1",
    })).toMatchObject({
      id: "copy-1",
      type: "image",
      name: "필터 합성 레이어",
      src: PNG,
      x: 0,
      y: 0,
      width: 320,
      height: 480,
      rotation: 0,
    });
  });

  it("renders a background-only page through the same filter raster seam", async () => {
    const planned = planStudioEditableRasterCopy({
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [],
      bg: "#f3e9d2",
      includeBackground: true,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rasterize = vi.fn(async (request: { svg: string; width: number; height: number }) => ({
      dataUrl: PNG,
      width: request.width,
      height: request.height,
    }));
    await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      { workerFactory: null, rasterExecutionBackend: "custom", rasterize },
    );
    expect(rasterize).toHaveBeenCalledOnce();
    expect(rasterize.mock.calls[0]?.[0].svg).toContain("#f3e9d2");
  });

  it("keeps document ownership stable across a lazy outline renderer fingerprint change", async () => {
    const current = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
    } as const;
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      async () => ({
        dataUrl: PNG,
        fingerprint: "editable-raster-copy-v1:0000000000000000",
        elementCount: planned.plan.sourceElementCount,
        width: planned.plan.width,
        height: planned.plan.height,
        svgByteLength: 1,
        pngByteLength: 8,
        execution: "direct",
      }),
    );

    expect(rendered.fingerprint).toBe(planned.plan.sourceFingerprint);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, current)).toBe(true);
  });

  it("rejects rendered outline dimension and element-count mismatches", async () => {
    const context = pageRasterContext();
    const planned = planStudioEditableRasterCopy(context.input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const result = {
      dataUrl: PNG,
      fingerprint: planned.plan.sourceFingerprint,
      elementCount: planned.plan.sourceElementCount,
      width: planned.plan.width,
      height: planned.plan.height,
      svgByteLength: 1,
      pngByteLength: 8,
      execution: "direct" as const,
    };

    await expect(renderStudioEditableRasterCopy(
      planned.plan,
      async () => ({ ...result, width: result.width + 1 }),
    )).rejects.toThrow(/해상도/u);
    await expect(renderStudioEditableRasterCopy(
      planned.plan,
      async () => ({ ...result, elementCount: result.elementCount + 1 }),
    )).rejects.toThrow(/레이어 수/u);
  });

  it("rejects an injected renderer result that exceeds the plan PNG budget", async () => {
    const context = pageRasterContext();
    const planned = planStudioEditableRasterCopy(context.input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    await expect(renderStudioEditableRasterCopy(
      planned.plan,
      async () => ({
        dataUrl: oversizedPngDataUrl(),
        fingerprint: planned.plan.sourceFingerprint,
        elementCount: planned.plan.sourceElementCount,
        width: planned.plan.width,
        height: planned.plan.height,
        svgByteLength: 1,
        pngByteLength: 4 * 1024 * 1024 + 1,
        execution: "direct",
      }),
    )).rejects.toThrow(/허용치/u);
  });

  it("detects stale source geometry after an async boundary", () => {
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
    } as const;
    const result = planStudioEditableRasterCopy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isStudioEditableRasterCopyPlanCurrent(result.plan, input)).toBe(true);
    expect(isStudioEditableRasterCopyPlanCurrent(result.plan, {
      ...input,
      elements: [line("line", { strokeWidth: 9 })],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(result.plan, {
      ...input,
      documentMutationBlockedReason: "검토 잠금을 해제하세요.",
    })).toBe(false);
  });

  it("lightweight revalidation preserves source selection, page style and mutation ownership", () => {
    const editableGroup = { id: "editable", name: "편집", hidden: false, locked: false };
    const selected = line("selected", { groupId: editableGroup.id, points: [100, 120, 160, 180] });
    const other = line("other", { points: [220, 260, 280, 320] });
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [selected, other],
      groups: [editableGroup],
      sourceIds: [selected.id],
      excludedSourceIds: [other.id],
      includeBackground: true,
      bg: "#ffffff",
      theme: "classic" as const,
      insertionIndex: 2,
      sourceDisposition: "hide-originals" as const,
      sourceDispositionIds: [selected.id],
    };
    const planned = planStudioEditableRasterCopy(input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, input)).toBe(true);
    // Inspector-only group presentation metadata is not a rendered document revision.
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      groups: [{ ...editableGroup, name: "이름만 변경", collapsed: true }],
    })).toBe(true);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      groups: [{ ...editableGroup, hidden: true }],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      groups: [{ ...editableGroup, locked: true }],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      groups: [],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      sourceIds: [other.id],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      excludedSourceIds: [selected.id],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      width: 321,
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      theme: "soft",
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      bg: "#f3e9d2",
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      bgGrad: ["#ffffff", "#111111"],
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      insertionIndex: 1,
    })).toBe(false);
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      sourceDisposition: "preserve-visible",
    })).toBe(false);
  });

  it("fails closed when any current raster budget becomes stricter", () => {
    const budgets = {
      maxPixelCount: 1_000_000,
      maxSourceBytes: 1_000_000,
      maxSvgBytes: 1_000_000,
      maxPngBytes: 1_000_000,
    };
    const input = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [line()],
      includeBackground: false,
      budgets,
    };
    const planned = planStudioEditableRasterCopy(input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.budgets).toEqual(budgets);
    expect(planned.plan.budgets).not.toBe(budgets);

    const budgetKeys = [
      "maxPixelCount",
      "maxSourceBytes",
      "maxSvgBytes",
      "maxPngBytes",
    ] as const;
    const stricterResults = Object.fromEntries(budgetKeys.map((budgetKey) => [
      budgetKey,
      isStudioEditableRasterCopyPlanCurrent(planned.plan, {
        ...input,
        budgets: { ...budgets, [budgetKey]: budgets[budgetKey] - 1 },
      }),
    ]));

    expect(stricterResults).toEqual({
      maxPixelCount: false,
      maxSourceBytes: false,
      maxSvgBytes: false,
      maxPngBytes: false,
    });
    expect(isStudioEditableRasterCopyPlanCurrent(planned.plan, {
      ...input,
      budgets: {
        maxPixelCount: budgets.maxPixelCount + 1,
        maxSourceBytes: budgets.maxSourceBytes + 1,
        maxSvgBytes: budgets.maxSvgBytes + 1,
        maxPngBytes: budgets.maxPngBytes + 1,
      },
    })).toBe(true);
  });

  it("keeps async current checks free of repeated SVG planning", () => {
    const implementation = readFileSync(
      new URL("./studio-raster-edit-preparation.ts", import.meta.url),
      "utf8",
    );
    const start = implementation.indexOf("export function isStudioEditableRasterCopyPlanCurrent");
    const end = implementation.indexOf("export function applyStudioEditableRasterCopy", start);
    const currentCheck = implementation.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(currentCheck).toContain("fingerprintEditableRasterCopySource");
    expect(currentCheck).not.toContain("planStudioEditableRasterCopy(current)");
    expect(currentCheck).not.toContain("exportPageToSvg");
  });
});

describe("editable raster copy commit contract", () => {
  it("rejects oversized and malformed PNG composites without mutating authored elements", () => {
    const context = pageRasterContext();
    const planned = planStudioEditableRasterCopy(context.input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const authored = context.destinationElements;
    const original = authored[0];

    const oversized = applyStudioEditableRasterCopy({
      plan: planned.plan,
      current: context.input,
      destinationElements: authored,
      composite: fullPageComposite(planned.plan, oversizedPngDataUrl()),
    });
    const malformed = applyStudioEditableRasterCopy({
      plan: planned.plan,
      current: context.input,
      destinationElements: authored,
      composite: fullPageComposite(
        planned.plan,
        "data:image/png;base64,iVBORw0KGgo*",
      ),
    });

    expect(oversized).toMatchObject({ ok: false, code: "invalid-composite" });
    expect(malformed).toMatchObject({ ok: false, code: "invalid-composite" });
    expect(context.destinationElements).toHaveLength(1);
    expect(context.destinationElements[0]).toBe(original);
    expect(context.input.elements).toHaveLength(1);
    expect(context.input.elements[0]).toBe(original);
  });

  it("treats preview cancellation as zero mutation", async () => {
    const first = Object.freeze(line());
    const second = Object.freeze(text());
    const elements: readonly El[] = Object.freeze([first, second]);
    const current = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements,
      includeBackground: true,
    } as const;
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({ dataUrl: PNG, width: request.width, height: request.height }),
      },
    );
    materializeStudioEditableRasterCopy({ plan: planned.plan, rendered, newId: "discarded-preview" });

    expect(current.elements).toEqual([line(), text()]);
    expect(current.elements[0]).toBe(first);
    expect(current.elements[1]).toBe(second);
  });

  it("applies one filtered composite while retaining every original object unchanged", async () => {
    const originals: El[] = [line(), text()];
    const current = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: originals,
      includeBackground: true,
      name: "가우시안 블러 · 페이지 합성",
    } as const;
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({ dataUrl: PNG, width: request.width, height: request.height }),
      },
    );
    const composite = {
      ...materializeStudioEditableRasterCopy({
        plan: planned.plan,
        rendered,
        newId: "filtered-copy",
      }),
      blur: 12,
      noClip: true,
    };
    const applied = applyStudioEditableRasterCopy({ plan: planned.plan, current, composite });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.elements).not.toBe(originals);
    expect(applied.elements).toHaveLength(3);
    expect(applied.elements[0]).toBe(originals[0]);
    expect(applied.elements[1]).toBe(originals[1]);
    expect(applied.elements[2]).toBe(composite);
    expect(originals).toEqual([line(), text()]);
  });

  it("can hide exact source objects while inserting one editable full-page raster copy", async () => {
    const originals: El[] = [line(), text()];
    const current = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: originals,
      includeBackground: true,
      sourceDisposition: "hide-originals" as const,
      name: "픽셀 선택용 합성본",
    };
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({
          dataUrl: PNG,
          width: request.width,
          height: request.height,
        }),
      },
    );
    const composite = materializeStudioEditableRasterCopy({
      plan: planned.plan,
      rendered,
      newId: "pixel-selection-copy",
    });
    const applied = applyStudioEditableRasterCopy({
      plan: planned.plan,
      current,
      composite,
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.elements).toHaveLength(3);
    expect(applied.elements.slice(0, 2)).toEqual([
      { ...originals[0], hidden: true },
      { ...originals[1], hidden: true },
    ]);
    expect(applied.elements[2]).toBe(composite);
    expect(originals[0]?.hidden).not.toBe(true);
    expect(originals[1]?.hidden).not.toBe(true);
  });

  it("fingerprints a visible master underlay without inserting it into the authored page", async () => {
    const masterUnderlay = line("master-line", { locked: true });
    const authored = [text("page-text")];
    const current = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [masterUnderlay, ...authored],
      includeBackground: true,
      insertionIndex: authored.length,
    } as const;
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({ dataUrl: PNG, width: request.width, height: request.height }),
      },
    );
    const composite = materializeStudioEditableRasterCopy({
      plan: planned.plan,
      rendered,
      newId: "master-page-filter-copy",
    });
    const applied = applyStudioEditableRasterCopy({
      plan: planned.plan,
      current,
      composite,
      destinationElements: authored,
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.elements).toEqual([authored[0], composite]);
    expect(applied.elements).not.toContain(masterUnderlay);
  });

  it("fails closed after a fingerprint or lock change without touching current elements", async () => {
    const original = line();
    const initial = {
      pageId: "page-1",
      width: 320,
      height: 480,
      elements: [original],
      includeBackground: true,
    } as const;
    const planned = planStudioEditableRasterCopy(initial);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => ({ dataUrl: PNG, width: request.width, height: request.height }),
      },
    );
    const composite = materializeStudioEditableRasterCopy({
      plan: planned.plan,
      rendered,
      newId: "filtered-copy",
    });
    const changedElements: El[] = [line("line", { strokeWidth: 9 })];

    expect(applyStudioEditableRasterCopy({
      plan: planned.plan,
      current: { ...initial, elements: changedElements },
      composite,
    })).toMatchObject({ ok: false, code: "stale-plan" });
    expect(applyStudioEditableRasterCopy({
      plan: planned.plan,
      current: { ...initial, documentMutationBlockedReason: "검토 잠금" },
      composite,
    })).toMatchObject({ ok: false, code: "stale-plan" });
    expect(changedElements).toEqual([line("line", { strokeWidth: 9 })]);
    expect(initial.elements).toEqual([original]);
  });
});
