/**
 * The **stage raster == full document raster** contract.
 *
 * Every editor path that reads Konva Stage pixels derives its `pixelRatio` from the assumption that
 * the Stage covers the whole document at `document × effectiveScale`
 * (`exportScale / effectiveScale`, `1 / effectiveScale`, `2 / effectiveScale`, …). If the Stage is
 * ever laid out smaller than the document — the obvious shape for a viewport-clipped Stage that
 * stops zoom from reallocating a 32Mpx backing store per layer — those reads keep type-checking and
 * keep passing every behavioural test while quietly handing the artist a **cropped export**.
 *
 * This suite is the detector for that failure. It drives the real
 * `createStudioRasterExportOrchestration`, the real `planStudioCanvasStageLayout` and the real
 * `readStudioStageInDocumentView` against a Stage model that reports *which document region a
 * capture actually covered*, on a document far larger than the viewport. It must pass before the
 * Stage becomes viewport-clipped and it must still pass afterwards.
 *
 * The model is deliberately geometric rather than pixel-based: `toCanvas`/`toDataURL` return the
 * capture's output size plus the Stage transform in effect, and the assertions map the four
 * document corners through that transform. A crop shows up as a corner falling outside the captured
 * region — exactly how a real viewport-clipped Stage would lose content.
 */

import { readFileSync } from "node:fs";




import { beforeAll, describe, expect, it, vi } from "vitest";

import { createStudioRasterExportOrchestration } from "../render/studio-raster-export-orchestration-runtime";
import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { DEFAULT_PAGE_GRADE } from "../studio-page-grade";
import { planStudioCanvasStageLayout, type StudioViewStageLayout } from "../studio-view-controls";

import { readStudioCanvasViewportStack } from "./read-studio-canvas-viewport-stack";
import {
  planStudioStageDocumentViewBox,
  readStudioStageInDocumentView,
  type StudioDocumentViewStage,
} from "./studio-stage-document-view";


import type { PageState } from "../studio-page-state";
import type { WatermarkSettings } from "../studio-watermark";
import type Konva from "konva";

// Encoders and file sinks are not the subject here; the capture geometry is. Keeping the real
// modules would only add DOM/worker requirements between the Stage read and the assertion.
vi.mock("../export/studio-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/studio-export")>();
  return {
    ...actual,
    canvasToBlob: async () => new Blob([]),
    downloadBlob: () => undefined,
    copyCanvasToClipboard: async () => undefined,
  };
});

vi.mock("../render/studio-raster-interchange-worker-client", () => ({
  encodeStudioRasterInterchangeAsync: async () => ({
    encoded: { format: "qoi", bytes: new Uint8Array(), width: 1, height: 1 },
  }),
}));

// A page far taller than any viewport, viewed at 5× — the worst case from the zoom-freeze findings
// (`docs/perf/canvas-findings.md` §B): a 4620×6930 Stage against an 800×600 visible area.
const DOCUMENT_WIDTH = 924;
const DOCUMENT_HEIGHT = 1386;
const EFFECTIVE_SCALE = 5;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

/*
 * The artist's live view in every case below is a *clipped* Stage — scrolled deep into a 4620×6930
 * page through an 800×600 window. That is the whole point of this suite: at 5× the adaptive clip is
 * armed, so if `captureDocumentView` ever stopped discarding it, every export here would hand back
 * an 800×600 crop of the middle of the page. Passing no clip would make the suite prove only that
 * the feature is absent.
 */
const LIVE_VIEWPORT_CLIP = {
  viewportWidth: VIEWPORT_WIDTH,
  viewportHeight: VIEWPORT_HEIGHT,
  scrollLeft: 1_600,
  scrollTop: 3_200,
} as const;

interface CaptureRecord {
  readonly kind: "toCanvas" | "toDataURL";
  /** Output raster size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Captured window in Stage-local pixels. */
  readonly region: { x: number; y: number; width: number; height: number };
  /** Stage transform in effect at capture time. */
  readonly transform: StudioViewStageLayout;
}

interface GeometryStage extends StudioDocumentViewStage {
  applyLayout(layout: StudioViewStageLayout): void;
  readonly captures: CaptureRecord[];
  currentLayout(): StudioViewStageLayout;
}

/** Map a document-local point through the Stage transform into Stage-local pixels. */
function projectDocumentPointToStage(
  transform: StudioViewStageLayout,
  point: { x: number; y: number }
): { x: number; y: number } {
  const scaled = { x: point.x * transform.scaleX, y: point.y * transform.scaleY };
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: transform.x + scaled.x * cos - scaled.y * sin,
    y: transform.y + scaled.x * sin + scaled.y * cos,
  };
}

/** Was the whole document inside the captured window? A crop makes at least one corner fall out. */
function documentCornersCovered(record: CaptureRecord): boolean {
  const corners = [
    { x: 0, y: 0 },
    { x: DOCUMENT_WIDTH, y: 0 },
    { x: 0, y: DOCUMENT_HEIGHT },
    { x: DOCUMENT_WIDTH, y: DOCUMENT_HEIGHT },
  ];
  const epsilon = 1e-6;
  return corners.every((corner) => {
    const projected = projectDocumentPointToStage(record.transform, corner);
    return (
      projected.x >= record.region.x - epsilon
      && projected.x <= record.region.x + record.region.width + epsilon
      && projected.y >= record.region.y - epsilon
      && projected.y <= record.region.y + record.region.height + epsilon
    );
  });
}

function expectFullDocumentRaster(record: CaptureRecord, outputScale: number): void {
  expect(record.width).toBeCloseTo(DOCUMENT_WIDTH * outputScale, 6);
  expect(record.height).toBeCloseTo(DOCUMENT_HEIGHT * outputScale, 6);
  expect(documentCornersCovered(record)).toBe(true);
}

function createStubCanvas(width: number, height: number): HTMLCanvasElement {
  const pixels = new Uint8ClampedArray(4);
  const context = {
    getImageData: () => ({ width: 1, height: 1, data: pixels }),
    drawImage: () => undefined,
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    strokeText: () => undefined,
    fillText: () => undefined,
  };
  return {
    width,
    height,
    getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([])),
    toDataURL: () => "data:image/png;base64,",
  } as unknown as HTMLCanvasElement;
}

// `handleDownloadAll` composites its captured pages onto a fresh canvas. The composite is not the
// subject here — the captures that feed it are — so a minimal element factory keeps the node suite
// free of a DOM without short-circuiting the path before it reaches `stage.toCanvas()`.
beforeAll(() => {
  vi.stubGlobal("document", { createElement: () => createStubCanvas(0, 0) });
  return () => vi.unstubAllGlobals();
});

function createGeometryStage(): GeometryStage {
  let layout: StudioViewStageLayout = {
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  const captures: CaptureRecord[] = [];

  const record = (
    kind: CaptureRecord["kind"],
    config: { pixelRatio?: number; x?: number; y?: number; width?: number; height?: number } = {}
  ): CaptureRecord => {
    const pixelRatio = config.pixelRatio ?? 1;
    const region = {
      x: config.x ?? 0,
      y: config.y ?? 0,
      width: config.width ?? layout.width,
      height: config.height ?? layout.height,
    };
    const entry: CaptureRecord = {
      kind,
      width: region.width * pixelRatio,
      height: region.height * pixelRatio,
      region,
      transform: { ...layout },
    };
    captures.push(entry);
    return entry;
  };

  const stage = {
    width: () => layout.width,
    height: () => layout.height,
    x: () => layout.x,
    y: () => layout.y,
    scaleX: () => layout.scaleX,
    scaleY: () => layout.scaleY,
    rotation: (angle?: number) => {
      if (angle === undefined) return layout.rotation;
      layout = { ...layout, rotation: angle as StudioViewStageLayout["rotation"] };
      return undefined;
    },
    size: (box: { width: number; height: number }) => {
      layout = { ...layout, width: box.width, height: box.height };
    },
    position: (point: { x: number; y: number }) => {
      layout = { ...layout, x: point.x, y: point.y };
    },
    scale: (value: { x: number; y: number }) => {
      layout = { ...layout, scaleX: value.x, scaleY: value.y };
    },
    draw: () => undefined,
    batchDraw: () => undefined,
    findOne: () => null,
    toCanvas: (config?: Parameters<typeof record>[1]) => {
      const entry = record("toCanvas", config);
      return createStubCanvas(entry.width, entry.height);
    },
    toDataURL: (config?: Parameters<typeof record>[1]) => {
      record("toDataURL", config);
      return "data:image/png;base64,";
    },
    applyLayout: (next: StudioViewStageLayout) => {
      layout = { ...next };
    },
    currentLayout: () => ({ ...layout }),
    captures,
  };
  return stage as unknown as GeometryStage;
}

/**
 * Mirrors the editor's React boundary: `preserveStudioViewBeforeCapture()` → `setIsExporting(true)`
 * → a re-render in which `StudioCanvasViewport` re-plans the Stage with `captureDocumentView` on.
 * The layout itself comes from the production planner, so a Stage-geometry change lands here too.
 */
function createStageHost(options: { canvasFlipH: boolean; canvasRotation: number }) {
  const stage = createGeometryStage();
  let captureDocumentView = false;

  const relayout = () => {
    stage.applyLayout(
      planStudioCanvasStageLayout({
        documentWidth: DOCUMENT_WIDTH,
        documentHeight: DOCUMENT_HEIGHT,
        scale: EFFECTIVE_SCALE,
        canvasFlipH: options.canvasFlipH,
        canvasRotation: options.canvasRotation,
        viewportClip: LIVE_VIEWPORT_CLIP,
        captureDocumentView,
      })
    );
  };
  relayout();
  // Guard the guard: if the live layout were not actually clipped, every export assertion below
  // would pass for the trivial reason that there was nothing to exclude.
  if (stage.currentLayout().width >= DOCUMENT_WIDTH * EFFECTIVE_SCALE) {
    throw new Error("live stage was not viewport-clipped; the export assertions would be vacuous");
  }

  return {
    stage,
    setIsExporting(exporting: boolean) {
      captureDocumentView = exporting;
      relayout();
    },
  };
}

function createPage(id: string): PageState {
  return { id, elements: [], bg: "#ffffff", bgGrad: null, canvasH: DOCUMENT_HEIGHT };
}

function deferred<Value>() {
  let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
  let rejectPromise!: (cause?: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const EXPORT_SCALE = 2;

function createOrchestration(
  host: ReturnType<typeof createStageHost>,
  pages: readonly PageState[],
  watermarkOptions: {
    ensureWatermarkLoaded?: () => Promise<WatermarkSettings>;
    drawWatermarkOnCanvas?: (
      canvas: HTMLCanvasElement,
      settings: WatermarkSettings,
    ) => void;
  } = {},
) {
  const errors: (string | null)[] = [];
  const orchestration = createStudioRasterExportOrchestration({
    activePage: pages[0]!,
    pages,
    currentPageId: pages[0]!.id,
    masterEditMode: false,
    exportTransparent: false,
    exportFormat: "png",
    exportScale: EXPORT_SCALE,
    effectiveScale: EFFECTIVE_SCALE,
    pageGrade: DEFAULT_PAGE_GRADE,
    title: "contract",
    ensureSharedDocumentAvailableForExport: () => true,
    ensureWatermarkLoaded: watermarkOptions.ensureWatermarkLoaded ?? (async () => ({
      enabled: false,
      text: "",
      opacity: 0,
      position: "br",
      size: 1,
    })),
    drawWatermarkOnCanvas: watermarkOptions.drawWatermarkOnCanvas ?? (() => undefined),
    // The production `captureReadyStageForPage` awaits the committed capture render; the flag flip
    // above is that commit. Awaiting a microtask keeps the async ordering of the real call.
    captureReadyStageForPage: async () => {
      await Promise.resolve();
      return host.stage as unknown as Konva.Stage;
    },
    preserveStudioViewBeforeCapture: () => undefined,
    setExportMenuOpen: () => undefined,
    setSelectedId: () => undefined,
    setMasterEditMode: () => undefined,
    setIsExporting: (exporting) => host.setIsExporting(exporting),
    setError: (message) => errors.push(message),
    setCurrentPageId: () => undefined,
  });
  return { orchestration, errors };
}

describe("stage raster is always the full document raster", () => {
  const viewStates = [
    { label: "no view transform", canvasFlipH: false, canvasRotation: 0 },
    { label: "horizontal flip", canvasFlipH: true, canvasRotation: 0 },
    { label: "quarter turn", canvasFlipH: false, canvasRotation: 90 },
    { label: "flip + three-quarter turn", canvasFlipH: true, canvasRotation: 270 },
  ] as const;

  const exportPaths = [
    {
      label: "handleDownload",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleDownload(),
      expectedCaptures: 1,
      outputScale: EXPORT_SCALE,
    },
    {
      label: "exportCurrentPageToRasterInterchange",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.exportCurrentPageToRasterInterchange("qoi"),
      expectedCaptures: 1,
      outputScale: EXPORT_SCALE,
    },
    {
      label: "handleCopyToClipboard",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleCopyToClipboard(),
      expectedCaptures: 1,
      outputScale: EXPORT_SCALE,
    },
    {
      label: "handleDownloadAll",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleDownloadAll(),
      expectedCaptures: 2,
      outputScale: EXPORT_SCALE,
    },
    {
      label: "handleCapturePagesForPreset(current)",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleCapturePagesForPreset("current"),
      expectedCaptures: 1,
      outputScale: EXPORT_SCALE,
    },
    {
      label: "handleCapturePagesForIndices",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleCapturePagesForIndices([0, 1]),
      expectedCaptures: 2,
      outputScale: EXPORT_SCALE,
    },
  ] as const;

  for (const view of viewStates) {
    for (const path of exportPaths) {
      it(`${path.label} exports the whole document (${view.label})`, async () => {
        const host = createStageHost(view);
        const pages = [createPage("page-1"), createPage("page-2")];
        const { orchestration } = createOrchestration(host, pages);

        await path.run(orchestration);

        expect(host.stage.captures).toHaveLength(path.expectedCaptures);
        for (const capture of host.stage.captures) {
          expectFullDocumentRaster(capture, path.outputScale);
        }
      });
    }
  }

  it("restores the artist's exact view layout once the export finishes", async () => {
    const view = { canvasFlipH: true, canvasRotation: 270 } as const;
    const host = createStageHost(view);
    const before = host.stage.currentLayout();
    const { orchestration } = createOrchestration(host, [createPage("page-1")]);

    await orchestration.handleDownload();

    const liveLayout = planStudioCanvasStageLayout({
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      scale: EFFECTIVE_SCALE,
      canvasFlipH: view.canvasFlipH,
      canvasRotation: view.canvasRotation,
      viewportClip: LIVE_VIEWPORT_CLIP,
      captureDocumentView: false,
    });
    expect(host.stage.currentLayout()).toEqual(before);
    expect(before).toEqual(liveLayout);
    // The restored view is the artist's clipped window, not a document-sized Stage left behind.
    expect(liveLayout.clip).not.toBeNull();
  });

  /*
   * Negative control. Without this the whole suite could pass vacuously: if the assertions could
   * not distinguish a correct capture from a truncated or transposed one, they would prove nothing
   * about a future viewport-clipped Stage. Here the capture reads a Stage that was never switched
   * into the document view, which is precisely what a missed choke point looks like.
   */
  it("fails a capture taken from a viewport-clipped stage", () => {
    const stage = createGeometryStage();
    stage.applyLayout({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      x: -1200,
      y: -3400,
      rotation: 0,
      scaleX: EFFECTIVE_SCALE,
      scaleY: EFFECTIVE_SCALE,
    });
    (stage as unknown as { toCanvas: (config: { pixelRatio: number }) => unknown }).toCanvas({
      pixelRatio: EXPORT_SCALE / EFFECTIVE_SCALE,
    });

    const capture = stage.captures[0]!;
    expect(documentCornersCovered(capture)).toBe(false);
    expect(capture.width).not.toBeCloseTo(DOCUMENT_WIDTH * EXPORT_SCALE, 6);
  });

  it("fails a capture taken from the artist's live stage", () => {
    const host = createStageHost({ canvasFlipH: false, canvasRotation: 90 });
    (host.stage as unknown as { toCanvas: (config: { pixelRatio: number }) => unknown }).toCanvas({
      pixelRatio: EXPORT_SCALE / EFFECTIVE_SCALE,
    });

    const capture = host.stage.captures[0]!;
    // The live Stage is both quarter-turned (which transposes its box) and clipped to a scrolled
    // window, so the raster is neither dimension of the document and loses its corners.
    expect(capture.width).not.toBeCloseTo(DOCUMENT_WIDTH * EXPORT_SCALE, 6);
    expect(capture.width).not.toBeCloseTo(DOCUMENT_HEIGHT * EXPORT_SCALE, 6);
    expect(documentCornersCovered(capture)).toBe(false);
    expect(() => expectFullDocumentRaster(capture, EXPORT_SCALE)).toThrow();
  });
});

describe("raster export watermark readiness", () => {
  const exportPaths = [
    {
      label: "download",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleDownload(),
    },
    {
      label: "raster interchange",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.exportCurrentPageToRasterInterchange("qoi"),
    },
    {
      label: "clipboard",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleCopyToClipboard(),
    },
    {
      label: "all-page strip",
      run: (orchestration: ReturnType<typeof createOrchestration>["orchestration"]) =>
        orchestration.handleDownloadAll(),
    },
  ] as const;

  for (const path of exportPaths) {
    it(`does not capture ${path.label} before durable or memory-only settings resolve`, async () => {
      const host = createStageHost({ canvasFlipH: false, canvasRotation: 0 });
      const pages = [createPage("page-1"), createPage("page-2")];
      const ready = deferred<WatermarkSettings>();
      const durableSettings: WatermarkSettings = {
        enabled: true,
        text: `hydrated ${path.label}`,
        opacity: 0.37,
        position: "tl",
        size: 0.04,
      };
      const ensureWatermarkLoaded = vi.fn(() => ready.promise);
      const drawWatermarkOnCanvas = vi.fn();
      const { orchestration } = createOrchestration(host, pages, {
        ensureWatermarkLoaded,
        drawWatermarkOnCanvas,
      });

      const exporting = path.run(orchestration);
      await vi.waitFor(() => expect(ensureWatermarkLoaded).toHaveBeenCalledOnce());

      expect(host.stage.captures).toHaveLength(0);
      expect(drawWatermarkOnCanvas).not.toHaveBeenCalled();

      ready.resolve(durableSettings);
      await exporting;

      expect(drawWatermarkOnCanvas).toHaveBeenCalledWith(
        expect.anything(),
        durableSettings,
      );
      expect(ensureWatermarkLoaded).toHaveBeenCalledOnce();
    });
  }
});

describe("readStudioStageInDocumentView", () => {
  const geometry = {
    documentWidth: DOCUMENT_WIDTH,
    documentHeight: DOCUMENT_HEIGHT,
    effectiveScale: EFFECTIVE_SCALE,
  } as const;

  it("captures the whole document from a viewport-clipped stage", () => {
    const stage = createGeometryStage();
    stage.applyLayout({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      x: -1200,
      y: -3400,
      rotation: 0,
      scaleX: EFFECTIVE_SCALE,
      scaleY: EFFECTIVE_SCALE,
    });

    readStudioStageInDocumentView(stage, geometry, () => {
      (stage as unknown as { toCanvas: (config: { pixelRatio: number }) => unknown }).toCanvas({
        pixelRatio: 1 / EFFECTIVE_SCALE,
      });
    });

    expect(stage.captures).toHaveLength(1);
    expectFullDocumentRaster(stage.captures[0]!, 1);
  });

  it("normalizes a flipped, quarter-turned stage before reading", () => {
    const host = createStageHost({ canvasFlipH: true, canvasRotation: 90 });

    readStudioStageInDocumentView(host.stage, geometry, () => {
      (host.stage as unknown as { toCanvas: (config: { pixelRatio: number }) => unknown }).toCanvas({
        pixelRatio: 2 / EFFECTIVE_SCALE,
      });
    });

    expectFullDocumentRaster(host.stage.captures[0]!, 2);
  });

  it("restores the exact previous layout, including when the read throws", () => {
    const host = createStageHost({ canvasFlipH: true, canvasRotation: 180 });
    const before = host.stage.currentLayout();

    expect(() =>
      readStudioStageInDocumentView(host.stage, geometry, () => {
        throw new Error("capture failed");
      })
    ).toThrow("capture failed");

    expect(host.stage.currentLayout()).toEqual(before);
  });

  it("plans the same document box the capture render produces", () => {
    expect(planStudioStageDocumentViewBox(geometry)).toEqual(
      planStudioCanvasStageLayout({
        documentWidth: DOCUMENT_WIDTH,
        documentHeight: DOCUMENT_HEIGHT,
        scale: EFFECTIVE_SCALE,
        // The live canvas may be flipped, turned and clipped to a scrolled window; a capture
        // render must ignore all three.
        canvasFlipH: true,
        canvasRotation: 90,
        viewportClip: LIVE_VIEWPORT_CLIP,
        captureDocumentView: true,
      })
    );
  });
});

/*
 * Source guard. The two suites above prove the choke points are correct; this one proves nothing
 * bypasses them. A new `stage.toCanvas()` added outside a choke point is exactly the change that
 * ships a silently cropped export, and it is invisible to every behavioural test in the repo.
 */
describe("every stage raster read goes through a choke point", () => {
  const editorSource = readStudioPageCompositionSource();

  it("routes each StudioPage stage read through a document-view restore or a capture render", () => {
    // 의도적 변경(2026-08, B-09): handleSave 의 페이지 캡처 읽기(stage.toDataURL)는
    // studio-page-save-pipeline.ts 로 추출됐다 — 같은 초크 포인트 규칙을 두 파일에
    // 적용한다(기존 7 = StudioPage 6 + save pipeline 1).
    const savePipelineSource = readFileSync(
      new URL("../studio-page-save-pipeline.ts", import.meta.url),
      "utf8"
    );
    const scannedSources = [
      { source: editorSource, expectedReads: 6 },
      { source: savePipelineSource, expectedReads: 1 },
    ];
    for (const { source: scannedSource, expectedReads } of scannedSources) {
    const lines = scannedSource.split("\n");
    const reads: { line: number; text: string }[] = [];
    for (const [index, text] of lines.entries()) {
      if (/\bstage\.(toCanvas|toDataURL|toBlob|toImage)\(/u.test(text) && !text.trimStart().startsWith("//")) {
        reads.push({ line: index + 1, text: text.trim() });
      }
    }
    // Fewer reads than expected means a path was removed and this guard needs re-deriving; more
    // means a new one appeared and has to be classified before it can ship.
    expect(reads).toHaveLength(expectedReads);

    /*
     * Each read must sit inside one of the two choke points. `readStageInDocumentView` /
     * `readStudioStageInDocumentView` restore the document Stage synchronously; the async export
     * paths instead await `captureReadyStageForPage(…)` / `captureReadyStageForHistoryPage(…)`,
     * which resolve only after React has committed a `suppressViewTransform` render.
     */
    const chokePoint = /readStageInDocumentView\(|readStudioStageInDocumentView\(|captureReadyStageFor(Page|HistoryPage)\(/u;
    for (const read of reads) {
      const window = lines.slice(Math.max(0, read.line - 30), read.line).join("\n");
      expect(
        chokePoint.test(window),
        `${read.line}: ${read.text} — stage raster read outside a document-view choke point`
      ).toBe(true);
    }
    }
  });

  it("keeps the export orchestration runtime on captureReadyStageForPage", () => {
    const runtimeSource = readFileSync(
      new URL("../render/studio-raster-export-orchestration-runtime.ts", import.meta.url),
      "utf8"
    );
    const reads = runtimeSource.match(/\bstage\.toCanvas\(/gu) ?? [];
    expect(reads).toHaveLength(6);
    expect(runtimeSource.match(/await captureReadyStageForPage\(/gu) ?? []).toHaveLength(6);
    expect(runtimeSource).toMatch(
      /encodeStudioRasterInterchangeAsync\([\s\S]*?\{\s*executionMode:\s*"worker"\s*\}\s*\)/u,
    );
    // No other Stage geometry may be consulted; `pixelRatio` is the only knob these paths turn.
    expect(runtimeSource).not.toMatch(/stage\.(width|height|x|y|scaleX|scaleY|rotation)\(/u);
  });

  it("keeps the live canvas on the shared stage-layout planner", () => {
    const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./");
    expect(viewportSource).toContain("captureDocumentView: suppressViewTransform");
    // Calling the lower-level planner here would let the live layout diverge from the capture path.
    expect(viewportSource).not.toMatch(/planStudioViewStageLayout\(/u);
  });
});
