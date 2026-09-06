// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
} from "./render/studio-hokusai-live-brush-document-receipt";
import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
} from "./render/studio-hokusai-live-brush-protocol";
import {
  clearStudioRasterEditSurfaces,
  rememberStudioRasterEditSurface,
} from "./render/studio-raster-edit-surface-cache";
import { STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION } from "./render/studio-raster-image-presentation";
import { STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION } from "./studio-living-ink-execution-protocol";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import { sha256HexPortable } from "./studio-sha256";
import { StudioKonvaImageNode } from "./StudioKonvaImageNode";

import type { StudioAnimatedImageFilterStatus } from "./studio-animated-image-filter-runtime";
import type { FrameEl, ImageEl } from "./studio-element-model";

type DragEndEventStub = {
  target: {
    x: () => number;
    y: () => number;
  };
};

type CapturedImageProps = {
  filters?: unknown[];
  image?: CanvasImageSource;
  onDragEnd?: (event: DragEndEventStub) => void;
  outlineWorkerRevision?: string;
  studioAnimatedImageFilterOwner?: string;
  studioAnimatedImageFilterReason?: string;
  studioAnimatedImageFilterStatus?: string;
  visible?: boolean;
  x?: number;
};

type CanvasContextCapture = {
  createImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
};

class TestImage {
  height = 48;
  naturalHeight = 48;
  naturalWidth = 64;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  src = "";
  width = 64;
}

const konvaCapture = vi.hoisted(() => {
  const drawListeners = new Set<() => void>();
  const layer = {
    batchDraw: vi.fn(),
    drawScene: vi.fn(),
    off: vi.fn((_event: string, listener: () => void) => {
      drawListeners.delete(listener);
    }),
    on: vi.fn((_event: string, listener: () => void) => {
      drawListeners.add(listener);
    }),
  };
  const capture = {
    appliedImage: undefined as CanvasImageSource | undefined,
    drawListeners,
    layer,
    node: {
      cache: vi.fn(),
      clearCache: vi.fn(),
      getLayer: vi.fn(() => layer),
      image: vi.fn(() => capture.appliedImage),
      isVisible: vi.fn(() => true),
      visible: vi.fn(),
    },
    currentProps: null as Record<string, unknown> | null,
    fireLayerDraw: () => {
      const listeners = [...drawListeners];
      drawListeners.clear();
      listeners.forEach((listener) => listener());
    },
    props: [] as Record<string, unknown>[],
  };
  return capture;
});

const filterCapture = vi.hoisted(() => ({
  build: vi.fn(),
  cachePad: 0,
  filter: vi.fn(),
  register: vi.fn(),
  runWorker: vi.fn((): Promise<unknown> => new Promise(() => undefined)),
}));

const tournamentCapture = vi.hoisted(() => ({
  schedule: vi.fn(),
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  const Image = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    useImperativeHandle(ref, () => {
      konvaCapture.appliedImage = props.image as CanvasImageSource | undefined;
      return konvaCapture.node;
    }, [props.image]);
    useEffect(() => {
      konvaCapture.currentProps = props;
      return () => {
        if (konvaCapture.currentProps === props) konvaCapture.currentProps = null;
      };
    }, [props]);
    konvaCapture.props.push(props);
    return null;
  });
  Image.displayName = "TestKonvaImage";
  return { Image };
});

vi.mock("./render/studio-konva-runtime", () => ({
  studioKonvaRuntime: { Filters: {} },
}));

vi.mock("./render/studio-konva-filters", () => ({
  buildImageFilters: filterCapture.build,
  registerStudioKonvaFilters: filterCapture.register,
}));

vi.mock("./studio-image-filter-worker-client", () => ({
  createStudioImageFilterResidentWorkerSession: undefined,
  runStudioImageFilterWorker: filterCapture.runWorker,
  studioImageFilterRequiresWorker: () => false,
}));

vi.mock("./filter/studio-filter-render-tournament", () => ({
  scheduleStudioFilterRenderTournament: tournamentCapture.schedule,
}));

vi.mock("./render/studio-gpu-filter-apply", () => ({
  applyGpuFilterChain: vi.fn(async () => null),
  isStudioGpuFilterChainEligible: () => false,
}));

const imageCapture = {
  instances: [] as TestImage[],
};

const canvasCapture = {
  contexts: [] as CanvasContextCapture[],
};

const animationFrames = {
  cancel: vi.fn(),
  nextId: 1,
  pending: new Map<number, FrameRequestCallback>(),
  request: vi.fn(),
};

function imageEl(overrides: Partial<ImageEl> = {}): ImageEl {
  return {
    height: 200,
    id: "image-1",
    rotation: 0,
    src: "data:image/png;base64,test",
    type: "image",
    width: 200,
    x: 10,
    y: 20,
    ...overrides,
  };
}

const HOKUSAI_HASH = `sha256:${"a".repeat(64)}` as const;
const HOKUSAI_PNG_HASH = `sha256:${"b".repeat(64)}` as const;
const HOKUSAI_INPUT_HASH = `sha256:${"c".repeat(64)}` as const;

function livingInkImageEl(): ImageEl {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const pngHash = `sha256:${sha256HexPortable(bytes)}` as const;
  const routeKey = "studio-living-ink-action:page-1:clear-1";
  return imageEl({
    src: `data:image/png;base64,${globalThis.btoa(binary)}`,
    livingInkReceipt: {
      kind: "studio-living-ink/document-receipt",
      version: 1,
      protocolVersion: 1,
      engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
      pageId: "page-1",
      routeKey,
      documentWidth: 200,
      documentHeight: 200,
      config: {
        displayWidth: 200,
        displayHeight: 200,
        fieldWidth: 128,
        fieldHeight: 128,
        coarseBase: 128,
        seed: 7,
        material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
        displayMode: "composite",
      },
      journal: [{ kind: "clear", version: 1, sequence: 1, scope: "all", selection: null }],
      sourceElementIds: [],
      canonicalPngSha256: pngHash,
      finalExecutionReceipt: {
        kind: "studio-living-ink-execution-receipt",
        version: 1,
        engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
        requestId: 1,
        revision: 1,
        operationKind: "clear",
        backend: "webgl2-offscreen-half-float",
        displaySha256: `sha256:${"a".repeat(64)}`,
        operationSha256: `sha256:${"b".repeat(64)}`,
        dirtyBounds: { x: 0, y: 0, width: 128, height: 128 },
        dirtyTileCount: 16,
        passCount: 1,
        pressureIterations: 10,
        simulationTicks: 0,
        elapsedMilliseconds: 1,
        fixedPigmentPolicy: "immutable",
        dryingWindowSeconds: 2,
        fixDurationSeconds: 1.2,
        determinism: "same-runtime-replay",
        crossDeviceBitExact: false,
        cpuOperationHashCrossDeviceDeterministic: true,
        canonicalFrameAuthority: "first-rendered-rgba8-frame",
        replayValidation: "bounded-visual-parity",
        displayReadbackOrientation: "webgl-bottom-left-row-major",
        gpuError: 0,
        readbackFormat: "rgba8-staging-fbo",
        imageOwnership: "caller-must-close",
        contextRecovery: "worker-rebuild-journal-replay",
      },
      restorePolicy: "replay-or-flattened-raster-fail-closed",
      fixedPigmentPolicy: "immutable",
      historyEntryCount: 1,
    },
  });
}

function hokusaiImageEl(): ImageEl {
  const logicalPlacement = { x: 10, y: 20, width: 200, height: 200 } as const;
  return imageEl({
    hokusaiLiveReceipt: {
      kind: "studio-hokusai-live/document-receipt",
      version: STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
      liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
      sourceElementId: "source-stroke-1",
      sourceRevision: `hokusai-source-v1:${"d".repeat(16)}`,
      canonical: {
        kind: "studio-hokusai-live/canonical-receipt",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        requestId: 1,
        engineEpoch: 1,
        strokeId: "source-stroke-1",
        presetId: "charcoal",
        materialProfileId: "charcoal",
        seed: 17,
        sampleCount: 2,
        finalSequence: 2,
        segmentCount: 1,
        segments: [{
          segmentIndex: 0,
          logicalPlacement,
          pixelHash: HOKUSAI_HASH,
          pngHash: HOKUSAI_PNG_HASH,
        }],
        dirtyBounds: [0, 0, 200, 200],
        pixelLayout: "packed-dirty-rgba8",
        inputHash: HOKUSAI_INPUT_HASH,
        lastLivePixelHash: HOKUSAI_HASH,
        settledPixelHash: HOKUSAI_HASH,
        pngHash: HOKUSAI_PNG_HASH,
        exactLiveCommitParity: true,
        execution: "dedicated-worker-wasm-packed-dirty-live",
        materialTexture: "studio-hokusai-material-texture-v2",
        endpointPolicy: "tapered-start-no-dab-carrier-v1",
        colorOpacityApplication: "worker-once-before-material-transfer-v1",
        canonicalAuthority: "settled-png-receipt-v1",
        undoAuthority: "single-stroke-transaction-v1",
        saveAuthority: "canonical-png-plus-versioned-receipt-v1",
        complete: true,
      },
    },
  });
}

function latestImageProps(): CapturedImageProps {
  const props = konvaCapture.currentProps;
  if (!props) throw new Error("Konva Image was not rendered");
  return props as CapturedImageProps;
}

async function resolveLatestImage(): Promise<TestImage> {
  const image = imageCapture.instances.at(-1);
  if (!image) throw new Error("Image loader was not created");
  await act(async () => {
    image.onload?.();
    await Promise.resolve();
  });
  return image;
}

function fireNextAnimationFrame(now: number): number {
  const next = animationFrames.pending.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  if (!next) throw new Error("No animation frame is pending");
  const [id, callback] = next;
  animationFrames.pending.delete(id);
  act(() => callback(now));
  return id;
}

beforeEach(() => {
  clearStudioRasterEditSurfaces();
  vi.clearAllMocks();
  konvaCapture.props.length = 0;
  konvaCapture.currentProps = null;
  konvaCapture.appliedImage = undefined;
  konvaCapture.drawListeners.clear();
  delete window.__studioRasterImagePresentationProbe;
  imageCapture.instances.length = 0;
  canvasCapture.contexts.length = 0;
  animationFrames.nextId = 1;
  animationFrames.pending.clear();
  filterCapture.cachePad = 0;
  filterCapture.build.mockImplementation(() => ({
    attrs: { brightness: 0.25 },
    cachePad: filterCapture.cachePad,
    filters: [filterCapture.filter],
  }));

  class CapturedImage extends TestImage {
    constructor() {
      super();
      imageCapture.instances.push(this);
    }
  }
  vi.stubGlobal("Image", CapturedImage);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => {
      if (contextId !== "2d") return null;
      const context: CanvasContextCapture = {
        createImageData: vi.fn((width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        })),
        drawImage: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        })),
        putImageData: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
      };
      canvasCapture.contexts.push(context);
      return context as unknown as CanvasRenderingContext2D;
    }) as typeof HTMLCanvasElement.prototype.getContext
  ));

  animationFrames.request.mockImplementation((callback: FrameRequestCallback) => {
    const id = animationFrames.nextId++;
    animationFrames.pending.set(id, callback);
    return id;
  });
  animationFrames.cancel.mockImplementation((id: number) => {
    animationFrames.pending.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", animationFrames.request);
  vi.stubGlobal("cancelAnimationFrame", animationFrames.cancel);
});

afterEach(() => {
  cleanup();
  clearStudioRasterEditSurfaces();
  delete window.__studioRasterImagePresentationProbe;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudioKonvaImageNode image lifecycle", () => {
  it("retains the exact surface only until its canonical PNG source is ready", async () => {
    const element = imageEl({ src: "data:image/png;base64,cached-retouch" });
    const cached = document.createElement("canvas");
    cached.width = 64;
    cached.height = 48;
    rememberStudioRasterEditSurface(element.src, cached);
    window.__studioRasterImagePresentationProbe = {
      version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
      expectationEpoch: 1,
      expected: { elementId: element.id, epoch: 1, src: element.src },
      receiptEpoch: 0,
      receipt: null,
    };

    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(latestImageProps().image).toBe(cached));
    expect(imageCapture.instances).toHaveLength(1);
    act(() => clearStudioRasterEditSurfaces());
    expect(latestImageProps().image).toBe(cached);
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
    await waitFor(() => expect(konvaCapture.layer.on).toHaveBeenCalledWith(
      "draw.studioRasterPresentation",
      expect.any(Function),
    ));
    act(() => konvaCapture.fireLayerDraw());
    expect(window.__studioRasterImagePresentationProbe.receipt).toMatchObject({
      elementId: element.id,
      src: element.src,
    });

    const canonical = await resolveLatestImage();
    await waitFor(() => expect(latestImageProps().image).toBe(canonical));
    expect(latestImageProps().image).not.toBe(cached);
  });

  it("prepares a canonical flipped source before releasing an evicted surface", async () => {
    const element = imageEl({
      flipped: true,
      src: "data:image/png;base64,cached-flipped-retouch",
    });
    const cached = document.createElement("canvas");
    cached.width = 64;
    cached.height = 48;
    rememberStudioRasterEditSurface(element.src, cached);

    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(latestImageProps().image).toBeInstanceOf(HTMLCanvasElement));
    const cachedFlip = latestImageProps().image;
    expect(cachedFlip).not.toBe(cached);

    act(() => clearStudioRasterEditSurfaces());
    expect(latestImageProps().image).toBe(cachedFlip);

    const canonical = await resolveLatestImage();
    await waitFor(() => {
      expect(latestImageProps().image).toBeInstanceOf(HTMLCanvasElement);
      expect(latestImageProps().image).not.toBe(cachedFlip);
    });
    expect(canvasCapture.contexts.at(-1)?.drawImage).toHaveBeenCalledWith(canonical, 0, 0);
  });

  it("keeps a filtered cached surface receipt open until the exact Worker result draws", async () => {
    let resolveWorker: ((value: {
      imageData: { data: Uint8ClampedArray; height: number; width: number };
    }) => void) | undefined;
    filterCapture.runWorker.mockImplementationOnce(() => new Promise((resolve) => {
      resolveWorker = resolve;
    }));
    vi.stubGlobal("ImageData", class FakeImageData {
      readonly data: Uint8ClampedArray;
      readonly height: number;
      readonly width: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    });
    const element = imageEl({
      brightness: 0.2,
      src: "data:image/png;base64,cached-filtered-retouch",
    });
    const cached = document.createElement("canvas");
    cached.width = 64;
    cached.height = 48;
    rememberStudioRasterEditSurface(element.src, cached);
    window.__studioRasterImagePresentationProbe = {
      version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
      expectationEpoch: 1,
      expected: { elementId: element.id, epoch: 1, src: element.src },
      receiptEpoch: 0,
      receipt: null,
    };

    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(filterCapture.runWorker).toHaveBeenCalledOnce());
    expect(latestImageProps().image).toBe(cached);
    act(() => konvaCapture.fireLayerDraw());
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();

    await act(async () => {
      resolveWorker?.({
        imageData: {
          data: new Uint8ClampedArray(200 * 200 * 4),
          height: 200,
          width: 200,
        },
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(latestImageProps().image).toBeInstanceOf(HTMLCanvasElement);
      expect(latestImageProps().image).not.toBe(cached);
      expect(konvaCapture.layer.on).toHaveBeenCalledWith(
        "draw.studioRasterPresentation",
        expect.any(Function),
      );
    });
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
    act(() => konvaCapture.fireLayerDraw());
    expect(window.__studioRasterImagePresentationProbe.receipt).toMatchObject({
      elementId: element.id,
      src: element.src,
    });

    const filteredCanvas = latestImageProps().image;
    await resolveLatestImage();
    act(() => clearStudioRasterEditSurfaces());
    await waitFor(() => expect(latestImageProps().image).toBe(filteredCanvas));
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 120));
    });
    expect(filterCapture.runWorker).toHaveBeenCalledTimes(1);
    expect(latestImageProps().image).toBe(filteredCanvas);
  });

  it("receipts a Konva outline fallback only after its current source cache is ready", async () => {
    filterCapture.cachePad = 7;
    const element = imageEl({
      outline: { color: "#ff00ff", opacity: 100, width: 9 },
      src: "data:image/png;base64,cached-outline-retouch",
    });
    const cached = document.createElement("canvas");
    cached.width = 64;
    cached.height = 48;
    rememberStudioRasterEditSurface(element.src, cached);
    window.__studioRasterImagePresentationProbe = {
      version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
      expectationEpoch: 1,
      expected: { elementId: element.id, epoch: 1, src: element.src },
      receiptEpoch: 0,
      receipt: null,
    };

    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
    await waitFor(() => {
      expect(konvaCapture.node.cache).toHaveBeenCalledWith({ offset: 7 });
      expect(konvaCapture.layer.on).toHaveBeenCalledWith(
        "draw.studioRasterPresentation",
        expect.any(Function),
      );
    });
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
    act(() => konvaCapture.fireLayerDraw());
    expect(window.__studioRasterImagePresentationProbe.receipt).toMatchObject({
      elementId: element.id,
      src: element.src,
    });

    const cacheCallsBeforeHandoff = konvaCapture.node.cache.mock.calls.length;
    const canonical = await resolveLatestImage();
    act(() => clearStudioRasterEditSurfaces());
    await waitFor(() => expect(latestImageProps().image).toBe(canonical));
    await waitFor(() => {
      expect(konvaCapture.node.cache.mock.calls.length).toBeGreaterThan(cacheCallsBeforeHandoff);
    });
  });

  it("receipts the exact decoded raster source only after its real Konva layer draw", async () => {
    const element = imageEl({ src: "data:image/png;base64,presentation-target" });
    window.__studioRasterImagePresentationProbe = {
      version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
      expectationEpoch: 1,
      expected: { elementId: element.id, epoch: 1, src: element.src },
      receiptEpoch: 0,
      receipt: null,
    };
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
    await resolveLatestImage();
    await waitFor(() => expect(konvaCapture.layer.on).toHaveBeenCalledWith(
      "draw.studioRasterPresentation",
      expect.any(Function),
    ));
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();

    act(() => konvaCapture.fireLayerDraw());

    expect(window.__studioRasterImagePresentationProbe.receipt).toMatchObject({
      elementId: element.id,
      expectationEpoch: 1,
      receiptEpoch: 1,
      src: element.src,
    });
    expect(window.__studioRasterImagePresentationProbe.receipt?.presentedAt).toEqual(expect.any(Number));
    expect(konvaCapture.node.image).toHaveReturnedWith(latestImageProps().image);
  });

  it("does not confuse a re-armed probe's restarted epoch with the prior operation", async () => {
    const first = imageEl({ src: "data:image/png;base64,heal-cold" });
    const second = imageEl({ src: "data:image/png;base64,heal-warm" });
    const handlers = {
      innerRef: vi.fn(),
      onChange: vi.fn(),
      onSelect: vi.fn(),
    };
    const arm = (element: ImageEl) => {
      window.__studioRasterImagePresentationProbe = {
        version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
        expectationEpoch: 1,
        expected: { elementId: element.id, epoch: 1, src: element.src },
        receiptEpoch: 0,
        receipt: null,
      };
    };
    arm(first);
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={first}
        {...handlers}
      />,
    );
    await resolveLatestImage();
    await waitFor(() => expect(konvaCapture.layer.on).toHaveBeenCalledTimes(1));
    act(() => konvaCapture.fireLayerDraw());
    expect(window.__studioRasterImagePresentationProbe?.receipt?.src).toBe(first.src);

    // Heal prepares its raster before measurement: cold effect and freshly armed warm effect are
    // both epoch 1, but they belong to different probe objects and must each receive a draw fence.
    arm(second);
    view.rerender(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={second}
        {...handlers}
      />,
    );
    await resolveLatestImage();
    await waitFor(() => expect(konvaCapture.layer.on).toHaveBeenCalledTimes(2));
    expect(window.__studioRasterImagePresentationProbe?.receipt).toBeNull();
    act(() => konvaCapture.fireLayerDraw());

    expect(window.__studioRasterImagePresentationProbe?.receipt).toMatchObject({
      elementId: second.id,
      expectationEpoch: 1,
      receiptEpoch: 1,
      src: second.src,
    });
  });

  it("does not receipt a draw for a different raster src", async () => {
    const element = imageEl({ src: "data:image/png;base64,current" });
    window.__studioRasterImagePresentationProbe = {
      version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
      expectationEpoch: 1,
      expected: {
        elementId: element.id,
        epoch: 1,
        src: "data:image/png;base64,different",
      },
      receiptEpoch: 0,
      receipt: null,
    };
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await resolveLatestImage();
    await waitFor(() => expect(latestImageProps().image).toBeDefined());
    act(() => konvaCapture.fireLayerDraw());

    expect(konvaCapture.layer.on).not.toHaveBeenCalled();
    expect(window.__studioRasterImagePresentationProbe.receipt).toBeNull();
  });

  it("acknowledges a Hokusai canonical image only after its decoded pixels draw on the main layer", async () => {
    const onReady = vi.fn();
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={hokusaiImageEl()}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onHokusaiCanonicalImageReady={onReady}
        onSelect={vi.fn()}
      />,
    );

    expect(onReady).not.toHaveBeenCalled();
    expect(konvaCapture.layer.drawScene).not.toHaveBeenCalled();
    await resolveLatestImage();

    await waitFor(() => {
      expect(konvaCapture.layer.drawScene).toHaveBeenCalledTimes(1);
      expect(onReady).toHaveBeenCalledWith("image-1", HOKUSAI_PNG_HASH);
    });
  });

  it("acknowledges Living Ink with the exact route token only after byte verification and main-layer draw", async () => {
    const onReady = vi.fn();
    const element = livingInkImageEl();
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={element}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onLivingInkCanonicalImageReady={onReady}
        onSelect={vi.fn()}
      />,
    );

    expect(onReady).not.toHaveBeenCalled();
    await resolveLatestImage();
    await waitFor(() => {
      expect(konvaCapture.layer.drawScene).toHaveBeenCalledTimes(1);
      expect(onReady).toHaveBeenCalledWith(
        "image-1",
        element.livingInkReceipt?.canonicalPngSha256,
        element.livingInkReceipt?.routeKey,
      );
    });
  });

  it.each([
    ["horizontal", { flipped: true }, [64, 0], [-1, 1]],
    ["vertical", { flippedY: true }, [0, 48], [1, -1]],
    ["both axes", { flipped: true, flippedY: true }, [64, 48], [-1, -1]],
  ])("bakes the %s flip into a canvas", async (_label, overrides, translate, scale) => {
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl(overrides)}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const image = await resolveLatestImage();
    const context = canvasCapture.contexts.at(-1);
    expect(context).toBeDefined();
    expect(context!.translate).toHaveBeenCalledWith(...translate);
    expect(context!.scale).toHaveBeenCalledWith(...scale);
    expect(context!.drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(latestImageProps().image).toBeInstanceOf(HTMLCanvasElement);
  });

  it("keeps an animated GIF live and bypasses flip baking", async () => {
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ flipped: true, flippedY: true, isAnimatedGif: true })}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const image = await resolveLatestImage();
    expect(latestImageProps().image).toBe(image);
    expect(canvasCapture.contexts).toHaveLength(0);
  });

  it("reuses the filter build, clears stale node cache, and applies cachePad", async () => {
    filterCapture.cachePad = 7;
    const filtered = imageEl({
      outline: { color: "#ffffff", opacity: 100, width: 7 },
    });
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={filtered}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();

    await waitFor(() => {
      expect(konvaCapture.node.cache).toHaveBeenCalledWith({ offset: 7 });
    });
    expect(konvaCapture.node.clearCache).toHaveBeenCalled();
    expect(filterCapture.build).toHaveBeenCalledTimes(1);
    expect(latestImageProps().filters).toEqual([filterCapture.filter]);
    expect(latestImageProps().outlineWorkerRevision).toBeTypeOf("string");

    view.rerender(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={{ ...filtered, x: 99 }}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(filterCapture.build).toHaveBeenCalledTimes(1);
    expect(latestImageProps().x).toBe(99);

    const clearCount = konvaCapture.node.clearCache.mock.calls.length;
    view.rerender(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ x: 99 })}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(konvaCapture.node.clearCache.mock.calls.length).toBeGreaterThan(clearCount);
    expect(latestImageProps().filters).toEqual([]);
    expect(latestImageProps().outlineWorkerRevision).toBeUndefined();
  });

});

describe("StudioKonvaImageNode animated GIF scheduling", () => {
  it("recaches and redraws filtered browser frames without entering the renderer tournament", async () => {
    const onStatus = vi.fn<(status: StudioAnimatedImageFilterStatus) => void>();
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ brightness: 0.25, isAnimatedGif: true })}
        innerRef={vi.fn()}
        onAnimatedImageFilterStatus={onStatus}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();

    await waitFor(() => {
      expect(latestImageProps().studioAnimatedImageFilterStatus).toBe("active");
    });
    expect(latestImageProps()).toMatchObject({
      filters: [filterCapture.filter],
      studioAnimatedImageFilterOwner: "konva-live-gif-frame-cache-v1",
      studioAnimatedImageFilterReason: "live-frame-cache",
    });
    expect(onStatus.mock.calls.at(-1)?.[0]).toMatchObject({
      reason: "live-frame-cache",
      state: "active",
    });
    expect(konvaCapture.node.cache).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(filterCapture.runWorker).not.toHaveBeenCalled();
    expect(tournamentCapture.schedule).not.toHaveBeenCalled();

    const cacheCount = konvaCapture.node.cache.mock.calls.length;
    fireNextAnimationFrame(79);
    expect(konvaCapture.node.cache).toHaveBeenCalledTimes(cacheCount);
    fireNextAnimationFrame(80);
    expect(konvaCapture.node.cache).toHaveBeenCalledTimes(cacheCount + 1);
    expect(konvaCapture.layer.batchDraw).toHaveBeenCalled();

    const pendingId = animationFrames.pending.keys().next().value as number;
    const clearCount = konvaCapture.node.clearCache.mock.calls.length;
    view.unmount();
    expect(animationFrames.cancel).toHaveBeenLastCalledWith(pendingId);
    expect(konvaCapture.node.clearCache.mock.calls.length).toBeGreaterThan(clearCount);
  });

  it("pauses filtered GIF cache work during pen-down and clears it when filters are removed", async () => {
    const liveStrokeRef = { current: { active: true } as unknown };
    const onStatus = vi.fn<(status: StudioAnimatedImageFilterStatus) => void>();
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ brightness: 0.25, isAnimatedGif: true })}
        innerRef={vi.fn()}
        liveStrokeRef={liveStrokeRef}
        onAnimatedImageFilterStatus={onStatus}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();
    await waitFor(() => {
      expect(latestImageProps().studioAnimatedImageFilterStatus).toBe("preparing");
    });
    expect(konvaCapture.node.cache).not.toHaveBeenCalled();

    fireNextAnimationFrame(80);
    expect(konvaCapture.node.cache).not.toHaveBeenCalled();
    liveStrokeRef.current = null;
    fireNextAnimationFrame(81);
    await waitFor(() => {
      expect(latestImageProps().studioAnimatedImageFilterStatus).toBe("active");
    });
    expect(konvaCapture.node.cache).toHaveBeenCalledTimes(1);

    const cacheCount = konvaCapture.node.cache.mock.calls.length;
    const clearCount = konvaCapture.node.clearCache.mock.calls.length;
    view.rerender(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ isAnimatedGif: true })}
        innerRef={vi.fn()}
        liveStrokeRef={liveStrokeRef}
        onAnimatedImageFilterStatus={onStatus}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(onStatus.mock.calls.at(-1)?.[0]).toMatchObject({
        reason: "not-requested",
        state: "inactive",
      });
    });
    expect(konvaCapture.node.clearCache.mock.calls.length).toBeGreaterThan(clearCount);
    expect(latestImageProps().filters).toEqual([]);
    fireNextAnimationFrame(160);
    expect(konvaCapture.node.cache).toHaveBeenCalledTimes(cacheCount);
  });

  it("rejects a stale filtered GIF callback and starts a fresh owner after source change", async () => {
    const onStatus = vi.fn<(status: StudioAnimatedImageFilterStatus) => void>();
    const renderNode = (src: string) => (
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ brightness: 0.25, isAnimatedGif: true, src })}
        innerRef={vi.fn()}
        onAnimatedImageFilterStatus={onStatus}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    const view = render(renderNode("first.gif"));
    await resolveLatestImage();
    await waitFor(() => {
      expect(latestImageProps().studioAnimatedImageFilterStatus).toBe("active");
    });

    const staleEntry = animationFrames.pending.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(staleEntry).toBeDefined();
    view.rerender(renderNode("second.gif"));
    const cacheCountAfterSourceChange = konvaCapture.node.cache.mock.calls.length;
    const drawCountAfterSourceChange = konvaCapture.layer.batchDraw.mock.calls.length;
    act(() => staleEntry![1](160));
    expect(konvaCapture.node.cache).toHaveBeenCalledTimes(cacheCountAfterSourceChange);
    expect(konvaCapture.layer.batchDraw).toHaveBeenCalledTimes(drawCountAfterSourceChange);

    await resolveLatestImage();
    await waitFor(() => {
      expect(latestImageProps().studioAnimatedImageFilterStatus).toBe("active");
      expect(latestImageProps().image).toBe(imageCapture.instances.at(-1));
    });
    expect(konvaCapture.node.cache.mock.calls.length).toBeGreaterThan(cacheCountAfterSourceChange);
    expect(animationFrames.pending).toHaveLength(1);
  });

  it("surfaces budget degradation without redisplaying the raw GIF", async () => {
    const onStatus = vi.fn<(status: StudioAnimatedImageFilterStatus) => void>();
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({
          brightness: 0.25,
          height: 5_000,
          isAnimatedGif: true,
          width: 5_000,
        })}
        innerRef={vi.fn()}
        onAnimatedImageFilterStatus={onStatus}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();

    await waitFor(() => {
      expect(latestImageProps()).toMatchObject({
        studioAnimatedImageFilterReason: "pixel-budget-exceeded",
        studioAnimatedImageFilterStatus: "degraded",
      });
    });
    expect(onStatus.mock.calls.at(-1)?.[0]).toMatchObject({
      reason: "pixel-budget-exceeded",
      state: "degraded",
    });
    expect(latestImageProps().filters).toBeUndefined();
    expect(latestImageProps().visible).toBe(false);
    expect(konvaCapture.node.cache).not.toHaveBeenCalled();
    konvaCapture.layer.batchDraw.mockClear();
    expect(animationFrames.pending).toHaveLength(0);
    expect(konvaCapture.layer.batchDraw).not.toHaveBeenCalled();
    expect(filterCapture.runWorker).not.toHaveBeenCalled();
    expect(tournamentCapture.schedule).not.toHaveBeenCalled();
  });

  it("throttles redraws, yields to live ink, resumes, and cancels on unmount", async () => {
    const liveStrokeRef = { current: null as unknown };
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({ isAnimatedGif: true })}
        innerRef={vi.fn()}
        liveStrokeRef={liveStrokeRef}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();
    expect(animationFrames.pending).toHaveLength(1);
    konvaCapture.layer.batchDraw.mockClear();

    fireNextAnimationFrame(79);
    expect(konvaCapture.layer.batchDraw).not.toHaveBeenCalled();
    fireNextAnimationFrame(80);
    expect(konvaCapture.layer.batchDraw).toHaveBeenCalledTimes(1);

    liveStrokeRef.current = { active: true };
    fireNextAnimationFrame(160);
    expect(konvaCapture.layer.batchDraw).toHaveBeenCalledTimes(1);
    liveStrokeRef.current = null;
    fireNextAnimationFrame(161);
    expect(konvaCapture.layer.batchDraw).toHaveBeenCalledTimes(2);

    const pendingId = animationFrames.pending.keys().next().value as number;
    view.unmount();
    expect(animationFrames.cancel).toHaveBeenLastCalledWith(pendingId);
  });

  it("does not start the GIF redraw loop when multi-frame cells own playback", async () => {
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl({
          frames: [
            { id: "frame-1", src: "frame-1.png" },
            { id: "frame-2", src: "frame-2.png" },
          ],
          isAnimatedGif: true,
        })}
        innerRef={vi.fn()}
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();

    expect(animationFrames.request).not.toHaveBeenCalled();
    expect(animationFrames.pending).toHaveLength(0);
  });
});

describe("StudioKonvaImageNode interaction lifecycle", () => {
  const frame: FrameEl = {
    height: 300,
    id: "frame-1",
    type: "frame",
    width: 400,
    x: 100,
    y: 200,
  };

  it("auto-fits on drag end, releases the interaction, and clears innerRef on unmount", async () => {
    const innerRef = vi.fn();
    const onChange = vi.fn();
    const onInteractionEnd = vi.fn();
    const view = render(
      <StudioKonvaImageNode
        autoFitFrames={[frame]}
        draggable
        el={imageEl()}
        innerRef={innerRef}
        onChange={onChange}
        onInteractionEnd={onInteractionEnd}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();
    expect(innerRef).toHaveBeenLastCalledWith(konvaCapture.node);

    act(() => {
      latestImageProps().onDragEnd?.({
        target: { x: () => 150, y: () => 250 },
      });
    });
    expect(onChange).toHaveBeenCalledWith({
      height: 400,
      width: 400,
      x: 100,
      y: 150,
    });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(innerRef).toHaveBeenLastCalledWith(null);
  });

  it("releases the interaction even when the drag commit throws", async () => {
    const error = new Error("commit failed");
    const onChange = vi.fn(() => {
      throw error;
    });
    const onInteractionEnd = vi.fn();
    render(
      <StudioKonvaImageNode
        autoFitFrames={null}
        draggable
        el={imageEl()}
        innerRef={vi.fn()}
        onChange={onChange}
        onInteractionEnd={onInteractionEnd}
        onSelect={vi.fn()}
      />,
    );
    await resolveLatestImage();

    expect(() => {
      act(() => {
        latestImageProps().onDragEnd?.({
          target: { x: () => 30, y: () => 40 },
        });
      });
    }).toThrow(error);
    expect(onChange).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });
});
