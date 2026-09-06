import { describe, expect, it, vi } from "vitest";

import {
  createStudioVelloClassicBrowserBackend,
  lowerStudioSceneOverlaysToVelloIsland,
  resolveStudioVelloHubProductCapability,
  StudioVelloHub,
  StudioVelloHubRenderSupersededError,
  STUDIO_VELLO_CLASSIC_BACKEND_ID,
  STUDIO_VELLO_CPU_BACKEND_ID,
  STUDIO_VELLO_HUB_PRODUCT_CAPABILITY,
  STUDIO_VELLO_HYBRID_BACKEND_ID,
  STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE,
  type StudioVelloBackendFrame,
  type StudioVelloHubBackend,
  type StudioVelloHubPresentationTarget,
} from "./studio-vello-hub";

import type { SceneIR } from "@toonspectrum/studio-project-model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function scene(id = "shape"): SceneIR {
  return {
    version: 11,
    width: 16,
    height: 16,
    background: { r: 0, g: 0, b: 0, a: 0 },
    nodes: [
      {
        id,
        kind: "fill-path",
        path: {
          verbs: [
            { v: "M", x: 2, y: 2 },
            { v: "L", x: 14, y: 2 },
            { v: "L", x: 14, y: 14 },
            { v: "L", x: 2, y: 14 },
            { v: "Z" },
          ],
        },
        paint: { kind: "solid", color: { r: 0, g: 0.4, b: 1, a: 1 } },
        fillRule: "nonzero",
        opacity: 1,
        blend: "src-over",
      },
    ],
  };
}

interface FakeBackendControl {
  failRender: boolean;
  available: boolean;
  comparePixels: Uint8Array;
  compareError: string | null;
}

function fakeBackend(
  id: typeof STUDIO_VELLO_CPU_BACKEND_ID | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID,
  milliseconds: number,
  advance: (milliseconds: number) => void,
  control: FakeBackendControl,
): StudioVelloHubBackend & { renderCount: number; disposeCount: number } {
  const backend = {
    id,
    renderCount: 0,
    disposeCount: 0,
    async availability() {
      return control.available
        ? { available: true, reason: null }
        : { available: false, reason: "fake-unavailable" };
    },
    async render(input: SceneIR): Promise<StudioVelloBackendFrame> {
      backend.renderCount += 1;
      advance(milliseconds);
      if (control.failRender) throw new Error(`${id}-render-failed`);
      if (id === STUDIO_VELLO_CPU_BACKEND_ID) {
        return {
          backendId: id,
          kind: "pixels",
          width: input.width,
          height: input.height,
          pixels: new Uint8Array(input.width * input.height * 4),
        };
      }
      return {
        backendId: id,
        kind: "texture",
        width: input.width,
        height: input.height,
        device: {} as GPUDevice,
        texture: { destroy: vi.fn() } as unknown as GPUTexture,
        release: vi.fn(),
      };
    },
    async compareToReference(input: SceneIR) {
      if (control.compareError) throw new Error(control.compareError);
      const cpuPixels = new Uint8Array(input.width * input.height * 4);
      return {
        width: input.width,
        height: input.height,
        gpuPixels: control.comparePixels.length === cpuPixels.length
          ? control.comparePixels
          : cpuPixels,
        cpuPixels,
        fuzzyMismatchPct: 0,
      };
    },
    dispose() {
      backend.disposeCount += 1;
    },
  } satisfies StudioVelloHubBackend & {
    renderCount: number;
    disposeCount: number;
  };
  return backend;
}

function fakeTarget() {
  const events: Array<
    | { kind: "present"; backendId: string }
    | { kind: "hold"; reason: string; activeBackendId: string | null }
  > = [];
  let activeBackendId: string | null = null;
  const control = { failPresent: false };
  const target: StudioVelloHubPresentationTarget = {
    async present(frame) {
      if (control.failPresent) throw new Error("presentation-failed");
      activeBackendId = frame.backendId;
      events.push({ kind: "present", backendId: frame.backendId });
      if (frame.kind === "texture") frame.release();
    },
    holdLastGood(reason) {
      events.push({ kind: "hold", reason, activeBackendId });
    },
  };
  return {
    target,
    control,
    events,
    get activeBackendId() {
      return activeBackendId;
    },
  };
}

function harness(options?: { mismatch?: boolean; isPenDown?: () => boolean }) {
  let now = 0;
  const advance = (milliseconds: number) => {
    now += milliseconds;
  };
  const cpuControl: FakeBackendControl = {
    failRender: false,
    available: true,
    comparePixels: new Uint8Array(),
    compareError: null,
  };
  const classicControl: FakeBackendControl = {
    failRender: false,
    available: true,
    comparePixels: options?.mismatch
      ? new Uint8Array(16 * 16 * 4).fill(255)
      : new Uint8Array(16 * 16 * 4),
    compareError: null,
  };
  const cpu = fakeBackend(STUDIO_VELLO_CPU_BACKEND_ID, 20, advance, cpuControl);
  const classic = fakeBackend(
    STUDIO_VELLO_CLASSIC_BACKEND_ID,
    5,
    advance,
    classicControl,
  );
  const presentation = fakeTarget();
  let lossListener: ((event: { epoch: number; reason: string }) => void) | null = null;
  const unavailableEvents: Array<{
    source: "selection" | "render" | "presentation" | "device-loss";
    reason: string;
  }> = [];
  const hub = new StudioVelloHub({
    target: presentation.target,
    cpuBackend: cpu,
    classicBackend: classic,
    now: () => now,
    deviceHash: "test-device",
    isPenDown: options?.isPenDown,
    onUnavailable(failure) {
      unavailableEvents.push({
        source: failure.source,
        reason: failure.reason,
      });
    },
    subscribeDeviceLoss(listener) {
      lossListener = listener;
      return () => {
        lossListener = null;
      };
    },
  });
  return {
    hub,
    cpu,
    classic,
    cpuControl,
    classicControl,
    presentation,
    unavailableEvents,
    emitLoss(reason = "destroyed") {
      lossListener?.({ epoch: 7, reason });
    },
  };
}

async function promoteClassic(runtime: ReturnType<typeof harness>) {
  await runtime.hub.render(scene());
  await runtime.hub.render(scene());
  return runtime.hub.render(scene());
}

describe("VelloHub product capability and SceneIR island", () => {
  it("enables only the bounded product island by default and supports an emergency kill", () => {
    expect(resolveStudioVelloHubProductCapability({ globalObject: {} })).toEqual({
      enabled: true,
      capabilityId: "studio-vello-hub-document-hybrid-v13",
      scope: "document-vector-hybrid",
      reason: "product-default",
    });
    expect(resolveStudioVelloHubProductCapability({
      globalObject: { __TOONSPECTRUM_STUDIO_VELLO_HUB_DISABLED__: true },
    })).toMatchObject({ enabled: false, reason: "emergency-disabled" });
    expect(STUDIO_VELLO_HUB_PRODUCT_CAPABILITY).toMatchObject({
      documentAuthority: true,
      inputAuthority: false,
      brushPixelAuthority: false,
      primarySurfaceOwnership: "frame-graph-compositor",
      admissionMode: "selected-gpu-provider",
      persistentWinnerStorage: false,
      productWidePromotionRequiresSoak: true,
    });
  });

  it("keeps Hybrid/Sparse GPU explicitly unavailable and uses the compositor Hybrid lane", () => {
    expect(STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE).toMatchObject({
      eligible: false,
      status: "unavailable-upstream-api",
    });
    expect(STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE.reason).toContain(
      "vello_hybrid 0.2",
    );
  });

  it("lowers the neutral selection-provider seam into a transparent bounded SceneIR", () => {
    const result = lowerStudioSceneOverlaysToVelloIsland(
      [
        {
          documentId: "selected-image",
          zIndex: 0,
          opacity: 1,
          fill: { color: 0x2563eb, alpha: 0.07 },
          stroke: { color: 0x2563eb, alpha: 0.95, width: 1.5 },
          shape: {
            kind: "rect",
            bounds: { x: 10, y: 20, width: 100, height: 50 },
          },
        },
      ],
      {
        width: 500,
        height: 400,
        dpr: 2,
        documentTransform: {
          scaleX: 1.5,
          scaleY: 1.5,
          offsetX: 4,
          offsetY: 6,
          rotation: 0,
        },
      },
    );
    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    expect(result.island.scene.background.a).toBe(0);
    expect(result.island.scene.nodes.map(({ id }) => id)).toEqual([
      "selected-image:selection-fill",
      "selected-image:selection-stroke",
    ]);
    expect(result.island.scene.width).toBeLessThan(500 * 2);
    expect(result.island.scene.height).toBeLessThan(400 * 2);
    expect(result.island.placement).toMatchObject({ dpr: 2 });
    expect(result.island.documentIds).toEqual(["selected-image"]);
  });

  it("rejects an oversized island with an explicit admission reason", () => {
    const result = lowerStudioSceneOverlaysToVelloIsland(
      [
        {
          documentId: "huge",
          zIndex: 0,
          fill: { color: 0, alpha: 1 },
          shape: {
            kind: "rect",
            bounds: { x: 0, y: 0, width: 900, height: 900 },
          },
        },
      ],
      { width: 1_000, height: 1_000, dpr: 1 },
      { maxCssDimension: 512 },
    );
    expect(result).toEqual({ admitted: false, reason: "css-dimension-limit" });
  });
});

describe("VelloHub runtime tournament", () => {
  it("invalidates an in-flight product epoch before its stale texture can present", async () => {
    const frameFlight = deferred<StudioVelloBackendFrame>();
    const release = vi.fn();
    const presentation = fakeTarget();
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      render: vi.fn(() => frameFlight.promise),
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      classicBackend: backend,
      subscribeDeviceLoss: () => () => undefined,
    });

    const pending = hub.render(scene());
    await vi.waitFor(() => expect(backend.render).toHaveBeenCalledOnce());
    hub.invalidatePendingProductRender();
    frameFlight.resolve({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 16,
      height: 16,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release,
    });

    await expect(pending).rejects.toBeInstanceOf(
      StudioVelloHubRenderSupersededError,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(presentation.events).toEqual([]);
    hub.dispose();
  });

  it("ignores a superseded render rejection without invalidating the newer scene", async () => {
    const oldFlight = deferred<StudioVelloBackendFrame>();
    const currentFlight = deferred<StudioVelloBackendFrame>();
    const currentRelease = vi.fn();
    const presentation = fakeTarget();
    const onUnavailable = vi.fn();
    let renderCount = 0;
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      render: vi.fn(() => {
        renderCount += 1;
        return renderCount === 1 ? oldFlight.promise : currentFlight.promise;
      }),
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      classicBackend: backend,
      onUnavailable,
      subscribeDeviceLoss: () => () => undefined,
    });

    const oldRender = hub.render(scene("old"));
    await vi.waitFor(() => expect(backend.render).toHaveBeenCalledTimes(1));
    const currentRender = hub.render(scene("current"));
    await vi.waitFor(() => expect(backend.render).toHaveBeenCalledTimes(2));
    oldFlight.reject(new Error("old-render-failed"));

    await expect(oldRender).rejects.toBeInstanceOf(
      StudioVelloHubRenderSupersededError,
    );
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(presentation.events).toEqual([]);
    expect(hub.snapshot().killedBackends).toEqual([]);

    currentFlight.resolve({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 16,
      height: 16,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release: currentRelease,
    });
    await expect(currentRender).resolves.toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    expect(currentRelease).toHaveBeenCalledOnce();
    expect(presentation.events).toEqual([
      { kind: "present", backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID },
    ]);
    hub.dispose();
  });

  it("ignores a superseded presentation rejection without killing the newer scene", async () => {
    const oldPresentation = deferred<void>();
    const oldRelease = vi.fn();
    const currentRelease = vi.fn();
    const onUnavailable = vi.fn();
    let renderCount = 0;
    let presentationCount = 0;
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      async render() {
        renderCount += 1;
        return {
          backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
          kind: "texture" as const,
          width: 16,
          height: 16,
          device: {} as GPUDevice,
          texture: {} as GPUTexture,
          release: renderCount === 1 ? oldRelease : currentRelease,
        };
      },
      dispose: vi.fn(),
    };
    const present = vi.fn((frame: StudioVelloBackendFrame) => {
      presentationCount += 1;
      if (presentationCount === 1) return oldPresentation.promise;
      if (frame.kind === "texture") frame.release();
      return Promise.resolve();
    });
    const holdLastGood = vi.fn();
    const hub = new StudioVelloHub({
      target: { present, holdLastGood },
      classicBackend: backend,
      onUnavailable,
      subscribeDeviceLoss: () => () => undefined,
    });

    const oldRender = hub.render(scene("old-present"));
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    const currentRender = hub.render(scene("current-present"));
    await expect(currentRender).resolves.toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    oldPresentation.reject(new Error("old-present-failed"));

    await expect(oldRender).rejects.toBeInstanceOf(
      StudioVelloHubRenderSupersededError,
    );
    expect(oldRelease).toHaveBeenCalledOnce();
    expect(currentRelease).toHaveBeenCalledOnce();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(holdLastGood).not.toHaveBeenCalled();
    expect(hub.snapshot().killedBackends).toEqual([]);
    hub.dispose();
  });

  it("invalidates pending product work when device loss makes the lane unavailable", async () => {
    const frameFlight = deferred<StudioVelloBackendFrame>();
    const release = vi.fn();
    const presentation = fakeTarget();
    presentation.target.releaseLostDevice = vi.fn();
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      render: vi.fn(() => frameFlight.promise),
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      classicBackend: backend,
      subscribeDeviceLoss: () => () => undefined,
    });

    const pending = hub.render(scene());
    await vi.waitFor(() => expect(backend.render).toHaveBeenCalledOnce());
    await hub.handleDeviceLoss("device-lost:9:reset");
    frameFlight.resolve({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 16,
      height: 16,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release,
    });

    await expect(pending).rejects.toBeInstanceOf(
      StudioVelloHubRenderSupersededError,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(presentation.target.releaseLostDevice).toHaveBeenCalledWith(
      "device-lost:9:reset",
    );
    expect(presentation.events).toEqual([
      {
        kind: "hold",
        reason: "unavailable-device-loss:device-lost:9:reset",
        activeBackendId: null,
      },
    ]);
    hub.dispose();
  });

  it("keeps an in-flight product frame valid when explicit QA comparison fails", async () => {
    const comparisonFlight = deferred<never>();
    const productFlight = deferred<StudioVelloBackendFrame>();
    const release = vi.fn();
    const presentation = fakeTarget();
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      render: vi.fn(() => productFlight.promise),
      compareToReference: vi.fn(() => comparisonFlight.promise),
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      classicBackend: backend,
      subscribeDeviceLoss: () => () => undefined,
    });

    const qa = hub.compareToReferenceForQa(scene());
    await vi.waitFor(() => expect(backend.compareToReference).toHaveBeenCalledOnce());
    const pending = hub.render(scene());
    await vi.waitFor(() => expect(backend.render).toHaveBeenCalledOnce());
    comparisonFlight.reject(new Error("qa-readback-failed"));
    await expect(qa).rejects.toThrow("qa-readback-failed");
    productFlight.resolve({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 16,
      height: 16,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release,
    });

    await expect(pending).resolves.toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(presentation.events.filter(({ kind }) => kind === "present")).toHaveLength(1);
    expect(presentation.events.filter(({ kind }) => kind === "hold")).toEqual([]);
    expect(hub.snapshot().killedBackends).toEqual([]);
    hub.dispose();
  });

  it("renders only the selected Classic GPU provider and holds it while pen-down", async () => {
    const runtime = harness();
    const compareToReference = vi.spyOn(runtime.classic, "compareToReference");
    const first = await runtime.hub.render(scene());
    expect(first).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      decision: "gpu-first",
      primarySurfaceOwner: "vello-hub",
      admissionMode: "selected-gpu-provider",
      productWidePromoted: false,
    });
    const warm = await runtime.hub.render(scene());
    expect(warm.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);

    const penDown = await runtime.hub.render(scene(), { penDown: true });
    expect(penDown).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      decision: "cached",
    });

    const held = await runtime.hub.render(scene(), { penDown: false });
    expect(held).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    expect(runtime.classic.renderCount).toBe(4);
    expect(runtime.cpu.renderCount).toBe(0);
    expect(compareToReference).not.toHaveBeenCalled();
    expect(runtime.presentation.activeBackendId).toBe(
      STUDIO_VELLO_CLASSIC_BACKEND_ID,
    );
    expect(runtime.hub.snapshot()).toMatchObject({
      admissionMode: "selected-gpu-provider",
      persistentWinnerStorage: false,
      productWidePromoted: false,
      hybridCompositor: expect.objectContaining({ eligible: true }),
    });
    runtime.hub.dispose();
  });

  it("reads live pen state instead of trusting a stale render-time false snapshot", async () => {
    let livePenDown = true;
    const runtime = harness({ isPenDown: () => livePenDown });
    await runtime.hub.render(scene());
    await runtime.hub.render(scene());

    const held = await runtime.hub.render(scene(), { penDown: false });
    expect(held).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      decision: "cached",
    });

    livePenDown = false;
    const next = await runtime.hub.render(scene(), { penDown: false });
    expect(next).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    runtime.hub.dispose();
  });

  it("keeps QA visual mismatch out of product authority and provider health", async () => {
    const runtime = harness({ mismatch: true });
    const first = await runtime.hub.render(scene());
    const qa = await runtime.hub.compareToReferenceForQa(scene());
    expect(qa).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      pass: false,
      mismatchPct: 100,
      error: null,
    });
    const second = await runtime.hub.render(scene("after-qa-mismatch"));
    expect(first.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(second.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(runtime.cpu.renderCount).toBe(0);
    expect(runtime.unavailableEvents).toEqual([]);
    expect(runtime.hub.snapshot().killedBackends).toEqual([]);
    runtime.hub.dispose();
  });

  it("keeps an unavailable QA comparison probe out of product provider health", async () => {
    const runtime = harness();
    runtime.classicControl.available = false;
    await expect(runtime.hub.compareToReferenceForQa(scene())).rejects.toThrow(
      `QA comparison backend unavailable:${STUDIO_VELLO_CLASSIC_BACKEND_ID}:fake-unavailable`,
    );
    const product = await runtime.hub.render(scene());
    expect(product.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(runtime.hub.snapshot().killedBackends).toEqual([]);
    expect(runtime.unavailableEvents).toEqual([]);
    expect(runtime.presentation.activeBackendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(runtime.cpu.renderCount).toBe(0);
    runtime.hub.dispose();
  });

  it("fails closed on GPU render failure and never presents CPU", async () => {
    const runtime = harness();
    const promoted = await promoteClassic(runtime);
    expect(promoted.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    runtime.classicControl.failRender = true;

    await expect(runtime.hub.render(scene())).rejects.toMatchObject({
      name: "StudioVelloHubUnavailableError",
      failure: {
        source: "render",
        backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
        reason: `${STUDIO_VELLO_CLASSIC_BACKEND_ID}-render-failed`,
      },
    });
    expect(runtime.presentation.events.at(-1)).toEqual(
      {
        kind: "hold",
        reason: `unavailable-render:${STUDIO_VELLO_CLASSIC_BACKEND_ID}-render-failed`,
        activeBackendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      },
    );
    expect(runtime.cpu.renderCount).toBe(0);
    runtime.hub.dispose();
  });

  it("reacts to fabric device loss with explicit unavailability and no CPU transaction", async () => {
    const runtime = harness();
    await promoteClassic(runtime);
    runtime.emitLoss("reset");
    await vi.waitFor(() => {
      expect(runtime.hub.snapshot().lastGoodFrame).toMatchObject({
        backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      });
      expect(runtime.unavailableEvents.at(-1)).toMatchObject({
        source: "device-loss",
        reason: "device-lost:7:reset",
      });
    });
    const hold = runtime.presentation.events.findLast(
      (event) => event.kind === "hold",
    );
    expect(hold).toMatchObject({
      activeBackendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      reason: "unavailable-device-loss:device-lost:7:reset",
    });
    expect(runtime.cpu.renderCount).toBe(0);
    runtime.hub.dispose();
  });

  it("does not mutate product state when an explicit QA comparison throws", async () => {
    const runtime = harness();
    const product = await runtime.hub.render(scene());
    runtime.classicControl.compareError = "qa-readback-failed";
    await expect(runtime.hub.compareToReferenceForQa(scene())).rejects.toThrow(
      "qa-readback-failed",
    );
    expect(runtime.hub.snapshot().lastGoodFrame).toMatchObject({
      requestId: product.requestId,
    });
    expect(runtime.hub.snapshot().killedBackends).toEqual([]);
    expect(runtime.unavailableEvents).toEqual([]);
    await expect(runtime.hub.render(scene("after-qa-error"))).resolves.toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    runtime.hub.dispose();
  });

  it("uses the CPU backend only for an explicit reference request", async () => {
    const runtime = harness();
    const receipt = await runtime.hub.renderReference(scene());
    expect(receipt).toMatchObject({
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      decision: "reference",
      referenceOnly: true,
    });
    expect(runtime.cpu.renderCount).toBe(1);
    expect(runtime.classic.renderCount).toBe(0);
    expect(runtime.unavailableEvents).toEqual([]);
    runtime.hub.dispose();
  });

  it("ignores fabric device loss before this hub has attempted product GPU work", () => {
    const runtime = harness();
    runtime.emitLoss("unowned-device");
    expect(runtime.unavailableEvents).toEqual([]);
    expect(runtime.presentation.events).toEqual([]);
    expect(runtime.cpu.renderCount).toBe(0);
    runtime.hub.dispose();
  });

  it("fails closed when the GPU frame cannot be presented", async () => {
    const runtime = harness();
    runtime.presentation.control.failPresent = true;
    await expect(runtime.hub.render(scene())).rejects.toMatchObject({
      failure: {
        source: "presentation",
        reason: "presentation-failed",
      },
    });
    expect(runtime.cpu.renderCount).toBe(0);
    expect(runtime.presentation.activeBackendId).toBeNull();
    runtime.hub.dispose();
  });

  it.each([
    {
      name: "pixel frame from the selected GPU backend",
      frame: {
        backendId: STUDIO_VELLO_CPU_BACKEND_ID,
        kind: "pixels",
        width: 16,
        height: 16,
        pixels: new Uint8Array(16 * 16 * 4),
      } as StudioVelloBackendFrame,
      reason: `selected GPU ${STUDIO_VELLO_CLASSIC_BACKEND_ID} returned pixels:${STUDIO_VELLO_CPU_BACKEND_ID}`,
    },
    {
      name: "texture frame carrying a different GPU backend id",
      frame: {
        backendId: STUDIO_VELLO_HYBRID_BACKEND_ID,
        kind: "texture",
        width: 16,
        height: 16,
        device: {} as GPUDevice,
        texture: {} as GPUTexture,
        release: vi.fn(),
      } as StudioVelloBackendFrame,
      reason: `selected GPU ${STUDIO_VELLO_CLASSIC_BACKEND_ID} returned texture:${STUDIO_VELLO_HYBRID_BACKEND_ID}`,
    },
  ])("rejects $name before presentation", async ({ frame, reason }) => {
    const presentation = fakeTarget();
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      async render() {
        return frame;
      },
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      classicBackend: backend,
      subscribeDeviceLoss: () => () => undefined,
    });

    await expect(hub.render(scene())).rejects.toMatchObject({
      failure: { source: "render", reason },
    });
    expect(presentation.events.filter(({ kind }) => kind === "present")).toEqual([]);
    hub.dispose();
  });

  it("rejects a texture returned by the explicit CPU reference lane", async () => {
    const release = vi.fn();
    const presentation = fakeTarget();
    const cpuBackend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CPU_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      async render() {
        return {
          backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
          kind: "texture",
          width: 16,
          height: 16,
          device: {} as GPUDevice,
          texture: {} as GPUTexture,
          release,
        };
      },
      dispose: vi.fn(),
    };
    const hub = new StudioVelloHub({
      target: presentation.target,
      cpuBackend,
      subscribeDeviceLoss: () => () => undefined,
    });

    await expect(hub.renderReference(scene())).rejects.toThrow(
      `explicit CPU reference returned texture:${STUDIO_VELLO_CLASSIC_BACKEND_ID}`,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(presentation.events).toEqual([]);
    hub.dispose();
  });

  it("disposes both backends and unregisters the device-loss listener", () => {
    const runtime = harness();
    runtime.hub.dispose();
    runtime.hub.dispose();
    expect(runtime.cpu.disposeCount).toBe(1);
    expect(runtime.classic.disposeCount).toBe(1);
    runtime.emitLoss();
    expect(runtime.presentation.events).toEqual([]);
  });
});

describe("Vello Classic product backend", () => {
  it("adopts the fabric device by identity and returns a zero-readback texture frame", async () => {
    const device = {} as GPUDevice;
    const texture = { destroy: vi.fn() } as unknown as GPUTexture;
    const release = vi.fn();
    let adopted: GPUDevice | null = null;
    const engine = {
      loadVelloGpuBrowser: vi.fn(async () => undefined),
      adoptGpuDevice: vi.fn(async (next: GPUDevice) => {
        adopted = next;
      }),
      gpuDeviceHandle: vi.fn(async () => adopted),
      renderSceneToTextureGpu: vi.fn(async () => texture),
      compareGpuVsCpu: vi.fn(async (input: SceneIR) => ({
        width: input.width,
        height: input.height,
        gpuPixels: new Uint8Array(input.width * input.height * 4),
        cpuPixels: new Uint8Array(input.width * input.height * 4),
        fuzzyMismatchPct: 0,
      })),
    };
    const backend = createStudioVelloClassicBrowserBackend({
      loadEngine: async () => engine as never,
      acquireDevice: async () => ({
        device,
        epoch: 3,
        lost: false,
        released: false,
        release,
      }),
    });

    await expect(backend.availability()).resolves.toEqual({
      available: true,
      reason: null,
    });
    const frame = await backend.render(scene());
    expect(engine.adoptGpuDevice).toHaveBeenCalledWith(device);
    expect(engine.renderSceneToTextureGpu).toHaveBeenCalledOnce();
    expect(frame).toMatchObject({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      device,
      texture,
    });
    if (frame.kind === "texture") frame.release();
    expect(texture.destroy).toHaveBeenCalledOnce();
    backend.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
