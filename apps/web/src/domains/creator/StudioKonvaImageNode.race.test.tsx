// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetStudioGpuFilterLaneAdmissionForTests } from "./render/studio-gpu-filter-lane-admission";
import { StudioKonvaImageNode } from "./StudioKonvaImageNode";


import type { StudioGpuFilterPreviewFrame } from "./render/studio-gpu-filter-apply";
import type { ImageEl } from "./studio-element-model";

interface WorkerRun {
  reject: (reason?: unknown) => void;
  request: { imageData: ImageData; el: ImageEl };
  signal?: AbortSignal;
  sourceRevision?: string | number;
  resolve: (value: {
    execution: "worker";
    imageData: { data: Uint8ClampedArray; height: number; width: number };
  }) => void;
}

const konvaCapture = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const workerHarness = vi.hoisted(() => {
  const runs: WorkerRun[] = [];
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const createSession = vi.fn(() => {
    const dispose = vi.fn();
    disposals.push(dispose);
    return { dispose, run };
  });
  function run(
    request: WorkerRun["request"],
    options?: { signal?: AbortSignal; sourceRevision?: string | number },
  ): Promise<Parameters<WorkerRun["resolve"]>[0]> {
    return new Promise<Parameters<WorkerRun["resolve"]>[0]>((resolve, reject) => {
      runs.push({
        reject,
        request,
        resolve,
        signal: options?.signal,
        sourceRevision: options?.sourceRevision,
      });
    });
  }
  return {
    createSession,
    disposals,
    requiresWorker: false,
    runs,
    run: vi.fn((
      request: WorkerRun["request"],
      options?: { signal?: AbortSignal; sourceRevision?: string | number },
    ) => run(request, options)),
  };
});

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { createElement, forwardRef } = await import("react");
  return {
    Image: forwardRef<unknown, Record<string, unknown>>((props, _ref) => {
      konvaCapture.current = props;
      return createElement("div", { "data-testid": "konva-image" });
    }),
  };
});

// The GPU filter module must be mocked like the other lazy chunks. Left real, its dynamic
// import resolves at wall-clock time (heavy transform graph) while the tests run on fake
// timers; `gpuFilterModule` is a dependency of the Worker filter effect, so a late arrival
// re-runs that effect and cancels an in-flight worker run between a test's dispatch and
// resolution — a load-dependent flake (the committed canvas silently stays the raw source).
const gpuHarness = vi.hoisted(() => ({
  apply: vi.fn(async (): Promise<{
    data: Uint8ClampedArray;
    height: number;
    width: number;
  } | null> => null),
  createSurface: vi.fn(() => ({
    canvas: document.createElement("canvas"),
    dispose: vi.fn(),
    present: vi.fn(),
    revision: 0,
  })),
  eligible: false,
  isEligible: vi.fn(() => false),
  present: vi.fn(async (): Promise<StudioGpuFilterPreviewFrame | null> => null),
}));

vi.mock("./render/studio-gpu-filter-apply", () => ({
  applyGpuFilterChain: gpuHarness.apply,
  createStudioGpuFilterPresentationSurface: gpuHarness.createSurface,
  isStudioGpuFilterChainEligible: gpuHarness.isEligible,
  presentGpuFilterChain: gpuHarness.present,
}));

vi.mock("./render/studio-konva-filters", () => ({
  buildImageFilters: (el: ImageEl) => ({
    attrs: { brightness: el.brightness ?? 0 },
    cachePad: 0,
    filters: [() => undefined],
  }),
  registerStudioKonvaFilters: vi.fn(),
}));

vi.mock("./studio-image-filter-worker-client", () => ({
  createStudioImageFilterResidentWorkerSession: workerHarness.createSession,
  createStudioImageFilterWorkerSession: workerHarness.createSession,
  runStudioImageFilterWorker: workerHarness.run,
  studioImageFilterRequiresWorker: () => workerHarness.requiresWorker,
}));

const imageHarness = {
  assigned: [] as ControlledImage[],
};

/**
 * What this host's WebGPU looks like. Lane planning now settles adapter admission before it
 * chooses a lane, so a test that expects GPU work has to describe a host that has an adapter —
 * jsdom has no navigator.gpu at all, which reads as "refused" and routes every filter to the
 * Worker. The default is an adapter that answers, matching what every GPU-lane test assumed.
 */
function installHostAdapter(adapter: object | null): void {
  resetStudioGpuFilterLaneAdmissionForTests();
  Object.defineProperty(globalThis.navigator, "gpu", {
    configurable: true,
    value: { requestAdapter: async () => adapter },
  });
}

function uninstallHostAdapter(): void {
  resetStudioGpuFilterLaneAdmissionForTests();
  const navigatorRecord = globalThis.navigator as unknown as Record<string, unknown>;
  if (Object.getOwnPropertyDescriptor(navigatorRecord, "gpu")) delete navigatorRecord.gpu;
}

class ControlledImage {
  height = 32;
  naturalHeight = 32;
  naturalWidth = 64;
  onerror: ((event: Event) => void) | null = null;
  onload: ((event: Event) => void) | null = null;
  private value = "";
  width = 64;
  handlersBeforeSrc = false;

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.handlersBeforeSrc = typeof this.onload === "function" && typeof this.onerror === "function";
    this.value = value;
    imageHarness.assigned.push(this);
  }
}

const canvasHarness = {
  getImageDataCalls: 0,
  getImageDataError: null as Error | null,
  invalidMaskCoverage: false,
};

function imageEl(overrides: Partial<ImageEl> = {}): ImageEl {
  return {
    height: 10.4,
    id: "image-1",
    rotation: 0,
    src: "a.png",
    type: "image",
    width: 20.4,
    x: 0,
    y: 0,
    ...overrides,
  };
}

function node(el: ImageEl) {
  return (
    <StudioKonvaImageNode
      autoFitFrames={null}
      draggable={false}
      el={el}
      innerRef={vi.fn()}
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushWorkerDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(80);
  });
  await flush();
}

async function load(image: ControlledImage): Promise<void> {
  await act(async () => {
    image.onload?.(new Event("load"));
    await Promise.resolve();
  });
  await flush();
}

function assignedImage(src: string): ControlledImage {
  const image = imageHarness.assigned.findLast((candidate) => candidate.src === src);
  if (!image) throw new Error(`Image loader was not created for ${src}`);
  return image;
}

function resolveRun(run: WorkerRun): void {
  const { width, height } = run.request.imageData;
  run.resolve({
    execution: "worker",
    imageData: { data: new Uint8ClampedArray(width * height * 4), height, width },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installHostAdapter({});
  konvaCapture.current = null;
  workerHarness.createSession.mockClear();
  workerHarness.disposals.length = 0;
  workerHarness.runs.length = 0;
  workerHarness.run.mockClear();
  workerHarness.requiresWorker = false;
  gpuHarness.apply.mockClear();
  gpuHarness.createSurface.mockClear();
  gpuHarness.present.mockReset();
  gpuHarness.present.mockImplementation(async () => null);
  gpuHarness.eligible = false;
  gpuHarness.isEligible.mockReset();
  gpuHarness.isEligible.mockImplementation(() => gpuHarness.eligible);
  imageHarness.assigned.length = 0;
  canvasHarness.getImageDataCalls = 0;
  canvasHarness.getImageDataError = null;
  canvasHarness.invalidMaskCoverage = false;
  vi.stubGlobal("Image", ControlledImage);
  vi.stubGlobal("ImageData", class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") return null;
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => {
          canvasHarness.getImageDataCalls += 1;
          if (canvasHarness.getImageDataError) throw canvasHarness.getImageDataError;
          if (canvasHarness.invalidMaskCoverage && this.width === 64 && this.height === 32) {
            return {
              data: new Uint8ClampedArray(0),
              height: this.height,
              width: this.width,
            } as ImageData;
          }
          return {
            data: new Uint8ClampedArray(this.width * this.height * 4),
            height: this.height,
            width: this.width,
          } as ImageData;
        }),
        putImageData: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    }
  ) as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  uninstallHostAdapter();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioKonvaImageNode async identity", () => {
  it("never displays a stale src and fails closed when the current src errors", async () => {
    const view = render(node(imageEl()));
    const first = imageHarness.assigned[0]!;
    const staleLoad = first.onload;
    expect(first.handlersBeforeSrc).toBe(true);
    await load(first);
    expect(konvaCapture.current?.image).toBe(first);

    view.rerender(node(imageEl({ src: "b.png" })));
    expect(view.queryByTestId("konva-image")).toBeNull();
    await act(async () => staleLoad?.(new Event("load")));
    expect(view.queryByTestId("konva-image")).toBeNull();

    const second = imageHarness.assigned[1]!;
    await act(async () => second.onerror?.(new Event("error")));
    expect(view.queryByTestId("konva-image")).toBeNull();
  });

  it("rejects stale Worker canvases by src, filter key, and rounded size", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    const first = imageHarness.assigned[0]!;
    await load(first);
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(1);
    const staleRun = workerHarness.runs[0]!;

    view.rerender(node(imageEl({ brightness: 0.2, src: "b.png" })));
    expect(staleRun.signal?.aborted).toBe(true);
    expect(view.queryByTestId("konva-image")).toBeNull();
    const second = imageHarness.assigned[1]!;
    await load(second);
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(2);
    const currentRun = workerHarness.runs[1]!;
    expect(currentRun.sourceRevision).not.toBe(staleRun.sourceRevision);
    expect(currentRun.request.imageData.data).not.toBe(staleRun.request.imageData.data);

    await act(async () => resolveRun(staleRun));
    expect(konvaCapture.current?.image).toBe(second);
    await act(async () => resolveRun(currentRun));
    const currentCanvas = konvaCapture.current?.image;
    expect(currentCanvas).toBeInstanceOf(HTMLCanvasElement);

    view.rerender(node(imageEl({ brightness: 0.4, src: "b.png" })));
    expect(konvaCapture.current?.image).toBe(second);
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(3);

    await act(async () => resolveRun(workerHarness.runs[2]!));
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);
    view.rerender(node(imageEl({ brightness: 0.4, src: "b.png", width: 21.2 })));
    expect(konvaCapture.current?.image).toBe(second);
    await flushWorkerDebounce();
    expect(workerHarness.runs[3]!.request.imageData.width).toBe(21);
  });

  it("falls back to the current source without retaining a canvas after a security error", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    const image = imageHarness.assigned[0]!;
    await load(image);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);

    canvasHarness.getImageDataError = new DOMException("tainted", "SecurityError");
    view.rerender(node(imageEl({ brightness: 0.4, src: "b.png" })));
    const nextImage = imageHarness.assigned[1]!;
    await load(nextImage);
    await flushWorkerDebounce();

    expect(konvaCapture.current?.image).toBe(nextImage);
    expect(workerHarness.runs).toHaveLength(1);
  });

  it("retains the last successful canvas instead of silently direct-running an oversized fallback", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    const lastSuccessfulCanvas = konvaCapture.current?.image;
    expect(lastSuccessfulCanvas).toBeInstanceOf(HTMLCanvasElement);

    workerHarness.requiresWorker = true;
    view.rerender(node(imageEl({ brightness: 0.4 })));
    await flushWorkerDebounce();
    const error = Object.assign(new Error("worker unavailable"), {
      code: "STUDIO_ADVANCED_BLUR_WORKER_REQUIRED",
      name: "StudioAdvancedBlurWorkerRequiredError",
    });
    await act(async () => workerHarness.runs[1]!.reject(error));
    await flush();

    expect(konvaCapture.current?.image).toBe(lastSuccessfulCanvas);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("retaining the last successful result"),
      error,
    );
  });

  it("reuses one source pixel snapshot across parameter-only slider ticks", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));

    view.rerender(node(imageEl({ brightness: 0.4 })));
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(2);
    expect(canvasHarness.getImageDataCalls).toBe(1);
    expect(workerHarness.runs[1]!.sourceRevision).toBe(workerHarness.runs[0]!.sourceRevision);
    expect(workerHarness.runs[1]!.request.imageData.data)
      .toBe(workerHarness.runs[0]!.request.imageData.data);
  });

  it("disposes resident pixels as soon as the Worker filter path becomes inactive", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();

    expect(workerHarness.createSession).toHaveBeenCalledOnce();
    expect(workerHarness.disposals).toHaveLength(1);
    expect(workerHarness.disposals[0]).not.toHaveBeenCalled();
    const activeRun = workerHarness.runs[0]!;

    view.rerender(node(imageEl()));
    await flush();

    expect(activeRun.signal?.aborted).toBe(true);
    expect(workerHarness.disposals[0]).toHaveBeenCalledOnce();
  });

  it("keeps only one full-page composite result and releases evicted and unmounted canvases", async () => {
    const view = render(node(imageEl({ brightness: 0.2, filterPageComposite: true })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    const firstResult = konvaCapture.current?.image as HTMLCanvasElement;

    expect(firstResult).toBeInstanceOf(HTMLCanvasElement);
    expect(firstResult.width).toBe(20);
    expect(firstResult.height).toBe(10);

    view.rerender(node(imageEl({ brightness: 0.4, filterPageComposite: true })));
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[1]!));
    const secondResult = konvaCapture.current?.image as HTMLCanvasElement;

    expect(secondResult).toBeInstanceOf(HTMLCanvasElement);
    expect(secondResult).not.toBe(firstResult);
    expect(firstResult.width).toBe(0);
    expect(firstResult.height).toBe(0);
    expect(secondResult.width).toBe(20);
    expect(secondResult.height).toBe(10);

    view.rerender(node(imageEl({ brightness: 0.2, filterPageComposite: true })));
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(3);
    await act(async () => resolveRun(workerHarness.runs[2]!));
    const restoredFirstFilter = konvaCapture.current?.image as HTMLCanvasElement;

    expect(restoredFirstFilter).not.toBe(firstResult);
    expect(secondResult.width).toBe(0);
    expect(secondResult.height).toBe(0);

    view.unmount();
    expect(restoredFirstFilter.width).toBe(0);
    expect(restoredFirstFilter.height).toBe(0);
  });

  it("retains the existing multi-result cache for ordinary images", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    const firstResult = konvaCapture.current?.image as HTMLCanvasElement;

    view.rerender(node(imageEl({ brightness: 0.4 })));
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[1]!));
    const secondResult = konvaCapture.current?.image as HTMLCanvasElement;

    view.rerender(node(imageEl({ brightness: 0.2 })));
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(2);
    expect(konvaCapture.current?.image).toBe(firstResult);
    expect(firstResult.width).toBe(20);
    expect(firstResult.height).toBe(10);
    expect(secondResult.width).toBe(20);
    expect(secondResult.height).toBe(10);

    view.unmount();
    expect(firstResult.width).toBe(0);
    expect(firstResult.height).toBe(0);
    expect(secondResult.width).toBe(0);
    expect(secondResult.height).toBe(0);
  });

  it("immediately shrinks an existing ordinary-image cache when it becomes a page composite", async () => {
    const view = render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    const firstResult = konvaCapture.current?.image as HTMLCanvasElement;

    view.rerender(node(imageEl({ brightness: 0.4 })));
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[1]!));
    const currentResult = konvaCapture.current?.image as HTMLCanvasElement;

    expect(firstResult.width).toBe(20);
    expect(firstResult.height).toBe(10);
    expect(currentResult.width).toBe(20);
    expect(currentResult.height).toBe(10);

    view.rerender(node(imageEl({ brightness: 0.4, filterPageComposite: true })));

    expect(firstResult.width).toBe(0);
    expect(firstResult.height).toBe(0);
    expect(currentResult.width).toBe(20);
    expect(currentResult.height).toBe(10);

    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(2);
    expect(konvaCapture.current?.image).toBe(currentResult);
  });

  it("rejects oversized interactive filter surfaces before canvas allocation", async () => {
    render(node(imageEl({ brightness: 0.2, width: 5_000, height: 5_000 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(0);
    expect(canvasHarness.getImageDataCalls).toBe(0);
    expect(konvaCapture.current?.filters).toBeUndefined();
  });

  it("keeps a requested mask fail-closed while its exact coverage is pending", async () => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    const mask = assignedImage("mask-a.png");

    await load(source);
    await flushWorkerDebounce();

    expect(mask.handlersBeforeSrc).toBe(true);
    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(konvaCapture.current?.brightness).toBeUndefined();
  });

  it("keeps a durable mask reference fail-closed before its Blob projection is ready", async () => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSurfaceId: "filter-mask:v1:123e4567-e89b-42d3-a456-426614174000",
    })));
    const source = assignedImage("a.png");
    await load(source);
    await flushWorkerDebounce();

    expect(imageHarness.assigned).toHaveLength(1);
    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(konvaCapture.current?.brightness).toBeUndefined();
  });

  it.each([
    ["decode throws", "throw"],
    ["coverage validation fails", "coverage"],
  ] as const)("keeps a requested mask fail-closed when %s", async (_label, failure) => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    const mask = assignedImage("mask-a.png");
    await load(source);

    if (failure === "throw") {
      canvasHarness.getImageDataError = new DOMException("tainted mask", "SecurityError");
    } else {
      canvasHarness.invalidMaskCoverage = true;
    }
    await load(mask);
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(konvaCapture.current?.brightness).toBeUndefined();
  });

  it("keeps a requested mask fail-closed when the image decoder rejects it", async () => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    const mask = assignedImage("mask-a.png");
    await load(source);
    await act(async () => mask.onerror?.(new Event("error")));
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(konvaCapture.current?.brightness).toBeUndefined();
  });

  it("activates filtering only after coverage for the exact wanted mask is ready", async () => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    const mask = assignedImage("mask-a.png");
    await load(source);

    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(0);

    await load(mask);
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(1);

    await act(async () => resolveRun(workerHarness.runs[0]!));
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);
    expect(konvaCapture.current?.filters).toBeUndefined();
  });

  it("rejects a stale decoded mask immediately when filterMaskSrc is replaced", async () => {
    const view = render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    await load(source);
    await load(assignedImage("mask-a.png"));
    await flushWorkerDebounce();
    await act(async () => resolveRun(workerHarness.runs[0]!));
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);

    view.rerender(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-b.png",
    })));

    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();
    expect(konvaCapture.current?.brightness).toBeUndefined();
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(1);

    await load(assignedImage("mask-b.png"));
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(2);
  });

  it("ignores a stale mask load after replacement and waits for the current src", async () => {
    const view = render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    const staleMask = assignedImage("mask-a.png");
    const staleLoad = staleMask.onload;
    await load(source);

    view.rerender(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-b.png",
    })));
    await act(async () => staleLoad?.(new Event("load")));
    await flushWorkerDebounce();

    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();

    await load(assignedImage("mask-b.png"));
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(1);
  });

  it("aborts and ignores an in-flight result owned by a replaced mask src", async () => {
    const view = render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-a.png",
    })));
    const source = assignedImage("a.png");
    await load(source);
    await load(assignedImage("mask-a.png"));
    await flushWorkerDebounce();
    const staleRun = workerHarness.runs[0]!;

    view.rerender(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: true,
      filterMaskSrc: "mask-b.png",
    })));
    expect(staleRun.signal?.aborted).toBe(true);
    expect(konvaCapture.current?.image).toBe(source);
    expect(konvaCapture.current?.filters).toBeUndefined();

    await act(async () => resolveRun(staleRun));
    expect(konvaCapture.current?.image).toBe(source);

    await load(assignedImage("mask-b.png"));
    await flushWorkerDebounce();
    expect(workerHarness.runs).toHaveLength(2);
    await act(async () => resolveRun(workerHarness.runs[1]!));
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);
  });

  it("keeps the selected GPU lane authoritative when its presentation declines", async () => {
    gpuHarness.eligible = true;
    render(node(imageEl({ brightness: 0.2, width: 1_600, height: 1_600 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();

    expect(gpuHarness.isEligible).toHaveBeenCalled();
    expect(gpuHarness.present).toHaveBeenCalledTimes(1);
    expect(gpuHarness.apply).not.toHaveBeenCalled();
    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.filters).toBeUndefined();
  });

  it("selects the eligible GPU lane before work without cost-based backend substitution", async () => {
    gpuHarness.eligible = true;
    render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();

    expect(gpuHarness.apply).not.toHaveBeenCalled();
    expect(gpuHarness.present).toHaveBeenCalledTimes(1);
    expect(workerHarness.runs).toHaveLength(0);
  });

  it("routes a GPU-expressible program to the Worker when this host has no adapter", async () => {
    // The shape a GPU-blocklisted, hardware-acceleration-off, VM or remote-desktop session
    // presents: navigator.gpu exists, so any feature-detect passes, but requestAdapter() resolves
    // null. Before admission was part of lane planning, the program check alone sent this to the
    // gpu-chain lane, the presentation failed, and the branch returned without ever reaching the
    // Worker — a selected image's filter applied as zero changed pixels with only a toast.
    installHostAdapter(null);
    gpuHarness.eligible = true;
    render(node(imageEl({ brightness: 0.2 })));
    await load(imageHarness.assigned[0]!);
    await flushWorkerDebounce();

    expect(gpuHarness.present).not.toHaveBeenCalled();
    expect(gpuHarness.apply).not.toHaveBeenCalled();
    expect(workerHarness.runs).toHaveLength(1);
  });

  it("preserves full-image filtering when a mask is absent or explicitly disabled", async () => {
    render(node(imageEl({
      brightness: 0.2,
      filterMaskEnabled: false,
      filterMaskSrc: "disabled-mask.png",
    })));
    await load(assignedImage("a.png"));
    await flushWorkerDebounce();

    expect(imageHarness.assigned.some((image) => image.src === "disabled-mask.png")).toBe(false);
    expect(workerHarness.runs).toHaveLength(1);
  });

  it("retains one GPU canvas per slider revision and reads only the final settled frame", async () => {
    gpuHarness.eligible = true;
    const surfaceCanvas = document.createElement("canvas");
    surfaceCanvas.width = 1_200;
    surfaceCanvas.height = 1_200;
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const firstReadback = vi.fn(async () => ({
      data: new Uint8ClampedArray(1_200 * 1_200 * 4),
      height: 1_200,
      width: 1_200,
    }));
    const secondReadback = vi.fn(async () => ({
      data: new Uint8ClampedArray(1_200 * 1_200 * 4),
      height: 1_200,
      width: 1_200,
    }));
    gpuHarness.createSurface.mockReturnValue({
      canvas: surfaceCanvas,
      dispose: vi.fn(),
      present: vi.fn(),
      revision: 0,
    });
    gpuHarness.present
      .mockResolvedValueOnce({
        canvas: surfaceCanvas,
        dispose: firstDispose,
        height: 1_200,
        readbackFinal: firstReadback,
        revision: 1,
        sourceRevision: 1,
        width: 1_200,
      })
      .mockResolvedValueOnce({
        canvas: surfaceCanvas,
        dispose: secondDispose,
        height: 1_200,
        readbackFinal: secondReadback,
        revision: 2,
        sourceRevision: 1,
        width: 1_200,
      });

    const view = render(node(imageEl({ brightness: 0.2, width: 1_200, height: 1_200 })));
    await load(imageHarness.assigned[0]!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await flush();

    expect(gpuHarness.present).toHaveBeenCalledTimes(1);
    expect(firstReadback).not.toHaveBeenCalled();
    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBe(surfaceCanvas);
    expect(canvasHarness.getImageDataCalls).toBe(1);

    view.rerender(node(imageEl({ brightness: 0.4, width: 1_200, height: 1_200 })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await flush();

    expect(gpuHarness.present).toHaveBeenCalledTimes(2);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(firstReadback).not.toHaveBeenCalled();
    expect(secondReadback).not.toHaveBeenCalled();
    expect(canvasHarness.getImageDataCalls).toBe(1);
    expect(workerHarness.runs).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    await flush();

    expect(gpuHarness.present).toHaveBeenCalledTimes(2);
    expect(gpuHarness.apply).not.toHaveBeenCalled();
    expect(secondReadback).toHaveBeenCalledTimes(1);
    expect(workerHarness.runs).toHaveLength(0);
    expect(konvaCapture.current?.image).toBeInstanceOf(HTMLCanvasElement);
    expect(konvaCapture.current?.image).not.toBe(surfaceCanvas);
  });
});
