// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioWebGpuCanvas,
  type StudioWebGpuCanvasHandle,
  type StudioWebGpuSurfaceFrameRequest,
} from "./StudioWebGpuCanvas";

import type { StudioGpuFrameReceipt } from "./render/studio-webgpu-frame-contract";
import type { StudioGpuStroke } from "./render/studio-webgpu-stroke";

const engineHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: {
      onFrameInvalid?: () => void;
      onFrameReady?: (receipt: StudioGpuFrameReceipt) => void;
    };
    viewportKey: string | null;
    calls: Array<{ method: string; requestId: string }>;
  }>,
}));

vi.mock("./render/studio-webgpu-engine", () => {
  class StudioWebGpuEngineMock {
    public readonly options: {
      onFrameInvalid?: () => void;
      onFrameReady?: (receipt: StudioGpuFrameReceipt) => void;
    };
    public viewportKey: string | null = null;
    public readonly calls: Array<{ method: string; requestId: string }> = [];

    constructor(options: StudioWebGpuEngineMock["options"]) {
      this.options = options;
      engineHarness.instances.push(this);
    }

    getBackend() {
      return "webgpu" as const;
    }

    isBackendAvailable() {
      return true;
    }

    getPerformanceMetrics() {
      return {
        instanceBufferAllocations: 0,
        presentationBufferAllocations: 0,
        presentationBindGroupAllocations: 0,
        presentationBindGroupReuses: 0,
      };
    }

    captureFrame() {
      return Promise.resolve({ status: "rejected" as const, reason: "frame-unavailable" as const });
    }

    initialize() {
      return Promise.resolve("webgpu" as const);
    }

    resize(
      viewport: Record<string, unknown>,
      options?: {
        requestId?: string;
        render?: boolean;
        onBeforeSurfaceMutation?: (requestId: string) => void;
      }
    ) {
      const viewportKey = JSON.stringify(viewport);
      const requestId = options?.requestId ?? "initial";
      if (viewportKey === this.viewportKey) {
        return { status: "unchanged" as const, requestId, rerendered: false };
      }
      options?.onBeforeSurfaceMutation?.(requestId);
      this.options.onFrameInvalid?.();
      this.viewportKey = viewportKey;
      if (options?.render !== false) this.emitReady(requestId);
      return {
        status: "resized" as const,
        requestId,
        rerendered: options?.render !== false,
      };
    }

    render(_strokes: readonly StudioGpuStroke[], requestId: string) {
      this.emit("render", requestId);
    }

    replaceStrokeFeed(_strokes: readonly StudioGpuStroke[], requestId: string) {
      this.emit("replace", requestId);
    }

    replaceStrokeFeedJournalBaseline(
      _strokes: readonly StudioGpuStroke[],
      requestId: string
    ) {
      this.emit("journal-replace", requestId);
      return "replaced" as const;
    }

    appendStrokeFeedSuffix(_patch: unknown, requestId: string) {
      this.emit("append", requestId);
      return "appended" as const;
    }

    appendStrokeFeedSuffixBatch(_patch: unknown, requestId: string) {
      this.emit("append-batch", requestId);
      return "appended" as const;
    }

    appendStrokeFeedJournalSuffix(_patch: unknown, requestId: string) {
      this.emit("journal-append", requestId);
      return "appended" as const;
    }

    appendStrokeFeedJournalSuffixBatch(_patch: unknown, requestId: string) {
      this.emit("journal-append-batch", requestId);
      return "appended" as const;
    }

    appendStrokeFeedOperations(_patch: unknown, requestId: string) {
      this.emit("append-operations", requestId);
      return "appended" as const;
    }

    retainStrokeFeed(requestId: string) {
      this.emit("retain", requestId);
    }

    resetStrokeFeed(requestId: string) {
      this.calls.push({ method: "reset", requestId });
    }

    suspend(requestId: string) {
      this.calls.push({ method: "suspend", requestId });
    }

    releaseSuspendedSurfaceBackingStores() {
      this.calls.push({ method: "release-backing", requestId: "suspended" });
      return true;
    }

    dispose() {}

    private emit(method: string, requestId: string) {
      this.calls.push({ method, requestId });
      this.options.onFrameInvalid?.();
      this.emitReady(requestId);
    }

    private emitReady(requestId: string) {
      this.options.onFrameReady?.({
        requestId,
        backend: "canvas2d",
        complete: true,
        strokeCount: 1,
        dabCount: 1,
        physicalWidth: 800,
        physicalHeight: 1_200,
        fingerprint: `fake:${requestId}`,
      });
    }
  }

  return { StudioWebGpuEngine: StudioWebGpuEngineMock };
});

const stroke: StudioGpuStroke = {
  id: "resize-contract-stroke",
  points: [10, 10, 40, 40],
  pressures: [0.5, 1],
  color: "#7c5cff",
  size: 8,
};

let resizeObserverCallback: ResizeObserverCallback | null = null;

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  engineHarness.instances.length = 0;
  resizeObserverCallback = null;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StudioWebGpuCanvas resize/request boundary", () => {
  it("keeps inactive surfaces parked through resize signals and syncs before first ink", async () => {
    const view = render(
      <StudioWebGpuCanvas
        width={800}
        height={1_200}
        surfaceBounds={{ left: 0, top: 0, width: 640, height: 480 }}
      />
    );
    await waitFor(() => expect(engineHarness.instances).toHaveLength(1));
    const engine = engineHarness.instances[0]!;

    expect(engine.calls).toContainEqual({
      method: "release-backing",
      requestId: "suspended",
    });
    expect(engine.viewportKey).toBeNull();

    act(() => {
      resizeObserverCallback?.(
        [{ contentRect: { width: 720, height: 540 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      globalThis.dispatchEvent(new Event("resize"));
    });
    expect(engine.viewportKey).toBeNull();

    view.rerender(
      <StudioWebGpuCanvas
        width={800}
        height={1_200}
        surfaceBounds={{ left: 0, top: 0, width: 720, height: 540 }}
        strokes={[stroke]}
      />
    );
    expect(engine.viewportKey).not.toBeNull();
    expect(engine.calls).toContainEqual({
      method: "render",
      requestId: expect.stringMatching(/^frame:\d+$/),
    });

    const activeViewportKey = engine.viewportKey;
    const releasedBeforeReset = engine.calls.filter(
      ({ method }) => method === "release-backing",
    ).length;
    view.rerender(
      <StudioWebGpuCanvas
        width={800}
        height={1_200}
        surfaceBounds={{ left: 0, top: 0, width: 720, height: 540 }}
      />
    );
    expect(engine.calls.filter(({ method }) => method === "release-backing")).toHaveLength(
      releasedBeforeReset + 1,
    );

    act(() => {
      resizeObserverCallback?.(
        [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      globalThis.dispatchEvent(new Event("resize"));
    });
    expect(engine.viewportKey).toBe(activeViewportKey);
  });

  it("returns the exact issued request id from legacy pinned feed commands", async () => {
    const handle = createRef<StudioWebGpuCanvasHandle>();
    render(
      <StudioWebGpuCanvas
        ref={handle}
        width={800}
        height={1_200}
      />
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    const engine = engineHarness.instances[0]!;

    let synced!: ReturnType<StudioWebGpuCanvasHandle["syncPinnedStrokes"]>;
    let replaced!: ReturnType<StudioWebGpuCanvasHandle["replacePinnedStrokes"]>;
    let reset!: ReturnType<StudioWebGpuCanvasHandle["resetPinnedStrokes"]>;
    act(() => {
      synced = handle.current!.syncPinnedStrokes([stroke]);
      replaced = handle.current!.replacePinnedStrokes([{ ...stroke, size: 12 }]);
      reset = handle.current!.resetPinnedStrokes();
    });

    expect(synced).toEqual(expect.objectContaining({ status: "accepted" }));
    expect(replaced).toEqual(expect.objectContaining({ status: "accepted" }));
    expect(reset).toEqual(expect.objectContaining({ status: "accepted" }));
    expect(new Set([synced.requestId, replaced.requestId, reset.requestId]).size).toBe(3);
    expect(engine.calls).toContainEqual({
      method: "replace",
      requestId: synced.requestId,
    });
    expect(engine.calls).toContainEqual({
      method: "replace",
      requestId: replaced.requestId,
    });
    expect(engine.calls).toContainEqual({
      method: "reset",
      requestId: reset.requestId,
    });
  });

  it("publishes a fresh resize request before mutation and keeps presentation hidden until reopened", async () => {
    const handle = createRef<StudioWebGpuCanvasHandle>();
    const requests: StudioWebGpuSurfaceFrameRequest[] = [];
    const receipts: StudioGpuFrameReceipt[] = [];
    const view = render(
      <StudioWebGpuCanvas
        ref={handle}
        width={800}
        height={1_200}
        strokes={[stroke]}
        frameAuthorized
        onFrameRequest={(request) => requests.push(request)}
        onFrameReady={(receipt) => receipts.push(receipt)}
      />
    );
    await waitFor(() => expect(receipts.length).toBeGreaterThan(0));
    requests.length = 0;
    receipts.length = 0;

    act(() => {
      resizeObserverCallback?.(
        [{
          contentRect: {
            width: 640,
            height: 480,
          },
        } as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      requestId: expect.stringMatching(/^frame:\d+$/),
      reason: "surface-resize",
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.requestId).toBe(requests[0]?.requestId);
    const compositor = view.container.querySelector<HTMLElement>(
      '[data-studio-gpu-compositor="true"]'
    );
    expect(compositor?.style.visibility).toBe("hidden");

    act(() => handle.current?.setPinnedPresentationVisible(true));
    expect(compositor?.style.visibility).not.toBe("hidden");
  });

  it("re-presents an active pinned journal for a viewport transform without replaying its baseline", async () => {
    const handle = createRef<StudioWebGpuCanvasHandle>();
    const requests: StudioWebGpuSurfaceFrameRequest[] = [];
    const receipts: StudioGpuFrameReceipt[] = [];
    const props = {
      ref: handle,
      width: 800,
      height: 1_200,
      onFrameRequest: (request: StudioWebGpuSurfaceFrameRequest) => requests.push(request),
      onFrameReady: (receipt: StudioGpuFrameReceipt) => receipts.push(receipt),
    };
    const view = render(<StudioWebGpuCanvas {...props} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    const engine = engineHarness.instances[0]!;
    act(() => {
      handle.current!.syncPinnedStrokes([stroke]);
    });
    requests.length = 0;
    receipts.length = 0;
    engine.calls.length = 0;

    view.rerender(
      <StudioWebGpuCanvas
        {...props}
        scaleX={1.5}
        scaleY={1.5}
        offsetX={-120}
        offsetY={-80}
      />
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      requestId: expect.stringMatching(/^frame:\d+$/),
      reason: "viewport-change",
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.requestId).toBe(requests[0]?.requestId);
    expect(engine.calls).toEqual([{
      method: "retain",
      requestId: requests[0]!.requestId,
    }]);
  });

  it("moves the compositor in CSS without issuing an unregistered pixel-surface request", async () => {
    const handle = createRef<StudioWebGpuCanvasHandle>();
    const requests: StudioWebGpuSurfaceFrameRequest[] = [];
    const props = {
      ref: handle,
      width: 800,
      height: 1_200,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      onFrameRequest: (request: StudioWebGpuSurfaceFrameRequest) => requests.push(request),
    };
    const view = render(
      <StudioWebGpuCanvas
        {...props}
        surfaceBounds={{ left: 0, top: 0, width: 640, height: 480 }}
      />
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    const engine = engineHarness.instances[0]!;
    act(() => {
      handle.current!.syncPinnedStrokes([stroke]);
    });
    requests.length = 0;
    engine.calls.length = 0;

    view.rerender(
      <StudioWebGpuCanvas
        {...props}
        surfaceBounds={{ left: 24, top: 32, width: 640, height: 480 }}
      />
    );

    expect(requests).toEqual([]);
    expect(engine.calls).toEqual([]);
  });
});
