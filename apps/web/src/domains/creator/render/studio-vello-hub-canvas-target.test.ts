// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioVelloHub,
  StudioVelloHubRenderSupersededError,
  STUDIO_VELLO_CLASSIC_BACKEND_ID,
  STUDIO_VELLO_CPU_BACKEND_ID,
  type StudioVelloHubBackend,
  type StudioVelloSceneIsland,
} from "./studio-vello-hub";
import { createStudioVelloHubCanvasTarget } from "./studio-vello-hub-canvas-target";

import type { SceneIR } from "@toonspectrum/studio-project-model";

const island: StudioVelloSceneIsland = {
  id: "selection:a",
  placement: { left: 12, top: 18, width: 8, height: 8, dpr: 1 },
  documentIds: ["a"],
  scene: {
    version: 11,
    width: 8,
    height: 8,
    background: { r: 0, g: 0, b: 0, a: 0 },
    nodes: [],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Models the browser rule that makes device loss dangerous here: a canvas that
 * has handed out a WebGPU context can never return a 2D context again, so a
 * explicit CPU reference frame has nowhere to land unless the target mints a
 * new canvas.
 */
function stubBrowserCanvasContexts(putImageData: ReturnType<typeof vi.fn>) {
  const webgpuBound = new WeakSet<HTMLCanvasElement>();
  const gpuContext = {
    configure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({}) as GPUTexture),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "webgpu") {
        webgpuBound.add(this);
        return gpuContext;
      }
      if (kind === "2d") return webgpuBound.has(this) ? null : { putImageData };
      return null;
    } as never,
  );
  vi.stubGlobal("GPUTextureUsage", { COPY_DST: 2, COPY_SRC: 4, RENDER_ATTACHMENT: 16 });
  vi.stubGlobal(
    "ImageData",
    class FakeImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  return gpuContext;
}

function fakeGpuDevice() {
  const retained = { width: 8, height: 8 } as GPUTexture;
  const createTexture = vi.fn(() => retained);
  const writeTexture = vi.fn();
  const device = {
    createTexture,
    createCommandEncoder: vi.fn(() => ({
      copyTextureToTexture: vi.fn(),
      finish: vi.fn(() => ({}) as GPUCommandBuffer),
    })),
    queue: {
      submit: vi.fn(),
      writeTexture,
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
  } as unknown as GPUDevice;
  return {
    device,
    createTexture,
    writeTexture,
    texture: {} as GPUTexture,
    release: vi.fn(),
  };
}

function fakeClassicBackend(gpu: ReturnType<typeof fakeGpuDevice>): StudioVelloHubBackend {
  return {
    id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    async availability() {
      return { available: true, reason: null };
    },
    async render(input: SceneIR) {
      return {
        backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
        kind: "texture" as const,
        width: input.width,
        height: input.height,
        device: gpu.device,
        texture: gpu.texture,
        release: gpu.release,
      };
    },
    async compareToReference(input: SceneIR) {
      const pixels = new Uint8Array(input.width * input.height * 4);
      return {
        width: input.width,
        height: input.height,
        gpuPixels: pixels,
        cpuPixels: new Uint8Array(pixels),
        fuzzyMismatchPct: 0,
      };
    },
    dispose() {
      // Test double owns no resources.
    },
  };
}

function fakeCpuBackend(): StudioVelloHubBackend {
  return {
    id: STUDIO_VELLO_CPU_BACKEND_ID,
    async availability() {
      return { available: true, reason: null };
    },
    async render(input: SceneIR) {
      return {
        backendId: STUDIO_VELLO_CPU_BACKEND_ID,
        kind: "pixels" as const,
        width: input.width,
        height: input.height,
        pixels: new Uint8Array(input.width * input.height * 4),
      };
    },
    dispose() {
      // Test double owns no resources.
    },
  };
}

describe("VelloHub canvas target", () => {
  it("atomically exposes one CPU primary and holdLastGood never clears it", async () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((kind: string) => kind === "2d" ? { putImageData } : null) as never,
    );
    vi.stubGlobal(
      "ImageData",
      class FakeImageData {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);

    await target.present({
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      kind: "pixels",
      width: 8,
      height: 8,
      pixels: new Uint8Array(8 * 8 * 4),
    });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(target.activeBackendId).toBe(STUDIO_VELLO_CPU_BACKEND_ID);
    expect(target.cpuCanvas.style.display).toBe("block");
    expect(target.cpuCanvas.dataset.studioVelloHubPrimary).toBe("true");
    expect(target.gpuCanvas).toBe(target.cpuCanvas);

    target.holdLastGood("device-lost");
    expect(target.cpuCanvas.style.display).toBe("block");
    expect(target.cpuCanvas.dataset.studioVelloHubHoldReason).toBe("device-lost");
    target.destroy();
    expect(mount.childElementCount).toBe(0);
  });

  it("presents an adopted-device texture by GPU copy without pixel readback", async () => {
    const destination = {} as GPUTexture;
    const configure = vi.fn();
    const getCurrentTexture = vi.fn(() => destination);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((kind: string) => kind === "webgpu"
        ? { configure, getCurrentTexture }
        : null) as never,
    );
    vi.stubGlobal("GPUTextureUsage", { COPY_DST: 2, COPY_SRC: 4, RENDER_ATTACHMENT: 16 });
    const retained = { width: 8, height: 8 } as GPUTexture;
    const copyTextureToTexture = vi.fn();
    const finish = vi.fn(() => ({}) as GPUCommandBuffer);
    const submit = vi.fn();
    const release = vi.fn();
    const device = {
      createTexture: vi.fn(() => retained),
      createCommandEncoder: vi.fn(() => ({ copyTextureToTexture, finish })),
      queue: {
        submit,
        onSubmittedWorkDone: vi.fn(async () => undefined),
      },
    } as unknown as GPUDevice;
    const source = {} as GPUTexture;
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);

    await target.present({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 8,
      height: 8,
      device,
      texture: source,
      release,
    });
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      device,
      format: "rgba8unorm",
      usage: 18,
    }));
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: source },
      { texture: retained },
      { width: 8, height: 8, depthOrArrayLayers: 1 },
    );
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: retained },
      { texture: destination },
      { width: 8, height: 8, depthOrArrayLayers: 1 },
    );
    expect(submit).toHaveBeenCalled();
    expect(target.activeBackendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(target.gpuCanvas.style.display).toBe("block");
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

    target.park();
    expect(target.canvas.style.display).toBe("none");
    expect(target.canvas.width).toBe(1);
    expect(target.canvas.height).toBe(1);
    expect(target.canvas.dataset.studioVelloPresentNodes).toBe("0");
    target.destroy();
  });

  it("conceals retained pixels without presenting through another renderer", async () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((kind: string) => kind === "2d" ? { putImageData } : null) as never,
    );
    vi.stubGlobal(
      "ImageData",
      class FakeImageData {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);
    const frame = {
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      kind: "pixels" as const,
      width: 8,
      height: 8,
      pixels: new Uint8Array(8 * 8 * 4),
    };
    await target.present(frame);

    target.conceal();

    expect(target.canvas.style.display).toBe("none");
    expect(target.canvas.dataset.studioVelloHubPrimary).toBeUndefined();
    expect(target.canvas.dataset.studioVelloPresentNodes).toBe("0");
    expect(target.activeBackendId).toBeNull();
    expect(putImageData).toHaveBeenCalledOnce();

    await target.present(frame);
    expect(target.canvas.style.display).toBe("block");
    expect(target.activeBackendId).toBe(STUDIO_VELLO_CPU_BACKEND_ID);
    expect(putImageData).toHaveBeenCalledTimes(2);
    target.destroy();
  });

  it("rejects impossible frame kind/backend pairs before exposing a canvas", async () => {
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);
    const release = vi.fn();

    await expect(target.present({
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      kind: "texture",
      width: 8,
      height: 8,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release,
    } as never)).rejects.toThrow(
      `VelloHub frame contract mismatch: texture:${STUDIO_VELLO_CPU_BACKEND_ID}`,
    );
    await expect(target.present({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "pixels",
      width: 8,
      height: 8,
      pixels: new Uint8Array(8 * 8 * 4),
    } as never)).rejects.toThrow(
      `VelloHub frame contract mismatch: pixels:${STUDIO_VELLO_CLASSIC_BACKEND_ID}`,
    );

    expect(release).toHaveBeenCalledOnce();
    expect(target.canvas.style.display).toBe("none");
    expect(target.activeBackendId).toBeNull();
    target.destroy();
  });

  it("keeps a parked target hidden when an invalidated product render completes late", async () => {
    let resolveFrame!: (frame: Awaited<ReturnType<StudioVelloHubBackend["render"]>>) => void;
    const frameFlight = new Promise<Awaited<ReturnType<StudioVelloHubBackend["render"]>>>(
      (resolve) => {
        resolveFrame = resolve;
      },
    );
    const render = vi.fn(() => frameFlight);
    const release = vi.fn();
    const backend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      render,
      dispose: vi.fn(),
    };
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);
    const hub = new StudioVelloHub({
      target,
      classicBackend: backend,
      subscribeDeviceLoss: () => () => undefined,
    });

    const pending = hub.render(island.scene);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    hub.invalidatePendingProductRender();
    target.park();
    resolveFrame({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 8,
      height: 8,
      device: {} as GPUDevice,
      texture: {} as GPUTexture,
      release,
    });

    await expect(pending).rejects.toBeInstanceOf(
      StudioVelloHubRenderSupersededError,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(target.canvas.style.display).toBe("none");
    expect(target.activeBackendId).toBeNull();
    hub.dispose();
    target.destroy();
  });
});

describe("VelloHub canvas target device loss", () => {
  it("keeps an explicit CPU reference frame off the lost device", async () => {
    const putImageData = vi.fn();
    stubBrowserCanvasContexts(putImageData);
    const gpu = fakeGpuDevice();
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);

    await target.present({
      backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      kind: "texture",
      width: 8,
      height: 8,
      device: gpu.device,
      texture: gpu.texture,
      release: gpu.release,
    });
    const lostSurface = target.canvas;
    gpu.createTexture.mockClear();

    target.releaseLostDevice("device-lost:7:destroyed");
    target.holdLastGood("device-lost:7:destroyed");
    expect(lostSurface.style.display).toBe("block");

    await target.present({
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      kind: "pixels",
      width: 8,
      height: 8,
      pixels: new Uint8Array(8 * 8 * 4),
    });

    expect(gpu.writeTexture).not.toHaveBeenCalled();
    expect(gpu.createTexture).not.toHaveBeenCalled();
    expect(putImageData).toHaveBeenCalledOnce();
    expect(target.canvas).not.toBe(lostSurface);
    expect(lostSurface.isConnected).toBe(false);
    expect(mount.childElementCount).toBe(1);
    expect(target.activeBackendId).toBe(STUDIO_VELLO_CPU_BACKEND_ID);
    expect(target.canvas.style.display).toBe("block");
    expect(target.canvas.dataset.studioVelloHubPrimary).toBe("true");
    expect(target.canvas.dataset.studioVelloHubHoldReason).toBe("device-lost:7:destroyed");
    expect(target.canvas.dataset.studioVelloHubDeviceLost).toBe("device-lost:7:destroyed");
    target.destroy();
    expect(mount.childElementCount).toBe(0);
  });

  it("holds the last GPU canvas on hub device loss without creating a CPU recovery canvas", async () => {
    const putImageData = vi.fn();
    stubBrowserCanvasContexts(putImageData);
    const gpu = fakeGpuDevice();
    const mount = document.createElement("div");
    const target = createStudioVelloHubCanvasTarget(document, mount);
    target.setIsland(island);
    const hub = new StudioVelloHub({
      target,
      cpuBackend: fakeCpuBackend(),
      classicBackend: fakeClassicBackend(gpu),
      hybridBackend: fakeClassicBackend(gpu),
      now: () => 0,
      deviceHash: "device-loss-recovery",
      subscribeDeviceLoss: () => () => undefined,
    });

    const first = await hub.render(island.scene, {
      preferredBackend: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    });
    expect(first.backendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    const lostSurface = target.canvas;
    gpu.createTexture.mockClear();
    gpu.writeTexture.mockClear();

    const receipt = await hub.handleDeviceLoss("device-lost:7:destroyed");

    expect(receipt).toBeNull();
    expect(gpu.writeTexture).not.toHaveBeenCalled();
    expect(gpu.createTexture).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    expect(target.activeBackendId).toBe(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    expect(target.canvas).toBe(lostSurface);
    expect(target.canvas.dataset.studioVelloHubDeviceLost).toBe("device-lost:7:destroyed");
    expect(target.canvas.dataset.studioVelloHubHoldReason).toBe(
      "unavailable-device-loss:device-lost:7:destroyed",
    );
    expect(mount.childElementCount).toBe(1);
    hub.dispose();
    target.destroy();
  });
});
