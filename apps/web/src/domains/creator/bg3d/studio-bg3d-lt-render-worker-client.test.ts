import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
  renderStudioBg3dLtLayers,
  type StudioBg3dLtRasterInput,
  type StudioBg3dLtRenderResult,
  type StudioBg3dLtRenderSettings,
} from "./studio-bg3d-lt-render";
import {
  renderStudioBg3dLtLayersInWorker,
  type StudioBg3dLtRenderWorkerLike,
} from "./studio-bg3d-lt-render-worker-client";
import {
  STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
  isStudioBg3dLtRenderWorkerRequest,
  isStudioBg3dLtRenderWorkerRequestEnvelope,
  isStudioBg3dLtRenderWorkerResponse,
  type StudioBg3dLtRenderWorkerRequest,
  type StudioBg3dLtRenderWorkerResponse,
} from "./studio-bg3d-lt-render-worker-protocol";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

interface MessageEventLike { readonly data: unknown }
interface ErrorEventLike { preventDefault?(): void }

class FakeWorker implements StudioBg3dLtRenderWorkerLike {
  readonly requests: StudioBg3dLtRenderWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  readonly errorListeners = new Set<(event: ErrorEventLike) => void>();
  readonly messageErrorListeners = new Set<(event: ErrorEventLike) => void>();
  terminateCalls = 0;
  throwOnPost = false;

  postMessage(message: StudioBg3dLtRenderWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("structured clone failed");
    this.requests.push(message);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errorListeners.add(listener as (event: ErrorEventLike) => void);
    else this.messageErrorListeners.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
    else this.messageErrorListeners.delete(listener as (event: ErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitError(kind: "error" | "messageerror" = "error"): void {
    const event = { preventDefault: vi.fn() };
    const listeners = kind === "error" ? this.errorListeners : this.messageErrorListeners;
    for (const listener of listeners) listener(event);
  }
}

class DeterministicRenderWorker extends FakeWorker {
  override postMessage(message: StudioBg3dLtRenderWorkerRequest, transfer: Transferable[]): void {
    super.postMessage(message, transfer);
    queueMicrotask(() => {
      if (!isStudioBg3dLtRenderWorkerRequest(message)) return;
      const result = renderStudioBg3dLtLayers({
        width: message.input.width,
        height: message.input.height,
        rgba: new Uint8Array(message.input.rgbaBuffer),
        ...(message.input.depthBuffer
          ? { depth: new Float32Array(message.input.depthBuffer) }
          : {}),
      }, message.settings);
      this.emitMessage(responseFor(message, result));
    });
  }
}

function raster(width = 8, height = 6): StudioBg3dLtRasterInput {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const depth = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      rgba[offset] = x < width / 2 ? 24 : 224;
      rgba[offset + 1] = (x * 29 + y * 7) % 256;
      rgba[offset + 2] = (x * 11 + y * 31) % 256;
      rgba[offset + 3] = x === 0 && y === 0 ? 0 : 255;
      depth[index] = (x + y) / Math.max(1, width + height - 2);
    }
  }
  return { width, height, rgba, depth };
}

function settings(): StudioBg3dLtRenderSettings {
  return {
    line: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.line,
      enabled: true,
      depthEnabled: true,
      textureLineEnabled: true,
      textureLineStrength: 0.6,
    },
    tone: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.tone,
      mode: "screentone",
      type: "pattern",
      pattern: "dot",
      opacity: 0.8,
    },
  };
}

function responseFor(
  request: StudioBg3dLtRenderWorkerRequest,
  result: StudioBg3dLtRenderResult = renderStudioBg3dLtLayers({
    width: request.input.width,
    height: request.input.height,
    rgba: new Uint8Array(request.input.rgbaBuffer),
    ...(request.input.depthBuffer
      ? { depth: new Float32Array(request.input.depthBuffer) }
      : {}),
  }, request.settings),
): StudioBg3dLtRenderWorkerResponse {
  return {
    version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    width: result.width,
    height: result.height,
    layers: result.layers.map((layer) => ({
      role: layer.role,
      width: layer.width,
      height: layer.height,
      dataBuffer: layer.data.buffer as ArrayBuffer,
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio BG3D LT render Worker boundary", () => {
  it("is deterministically equivalent to the direct renderer after a defensive input snapshot", async () => {
    const input = raster();
    const renderSettings = settings();
    const expected = renderStudioBg3dLtLayers({
      width: input.width,
      height: input.height,
      rgba: input.rgba.slice(),
      depth: input.depth?.slice(),
    }, {
      line: { ...renderSettings.line },
      tone: { ...renderSettings.tone },
    });
    const worker = new DeterministicRenderWorker();
    const pending = renderStudioBg3dLtLayersInWorker(input, renderSettings, {
      workerFactory: () => worker,
    });

    input.rgba.fill(0);
    input.depth?.fill(1);
    (renderSettings.line as { strength: number }).strength = 0;
    (renderSettings.tone as { mode: string }).mode = "none";

    const result = await pending;
    expect(result.width).toBe(expected.width);
    expect(result.height).toBe(expected.height);
    expect(result.layers.map((layer) => layer.role)).toEqual(
      expected.layers.map((layer) => layer.role),
    );
    expect(result.layers.map((layer) => Array.from(layer.data))).toEqual(
      expected.layers.map((layer) => Array.from(layer.data)),
    );
    expect(result.layers.every((layer) => layer.data instanceof Uint8ClampedArray)).toBe(true);
    expect(worker.terminateCalls).toBe(1);
  });

  it("transfers fresh ArrayBuffers and never detaches caller-owned RGBA or depth storage", async () => {
    const input = raster(3, 2);
    const rgbaBuffer = input.rgba.buffer;
    const depthBuffer = input.depth?.buffer;
    const rgbaBefore = input.rgba.slice();
    const depthBefore = input.depth?.slice();
    const worker = new FakeWorker();
    const pending = renderStudioBg3dLtLayersInWorker(input, settings(), {
      workerFactory: () => worker,
    });
    const request = worker.requests[0];

    expect(isStudioBg3dLtRenderWorkerRequest(request)).toBe(true);
    expect(worker.transfers[0]).toEqual([
      request.input.rgbaBuffer,
      request.input.depthBuffer,
    ]);
    expect(request.input.rgbaBuffer).not.toBe(rgbaBuffer);
    expect(request.input.depthBuffer).not.toBe(depthBuffer);
    expect(request.input.rgbaBuffer).toBeInstanceOf(ArrayBuffer);
    expect(request.input.depthBuffer).toBeInstanceOf(ArrayBuffer);
    expect(input.rgba.buffer).toBe(rgbaBuffer);
    expect(input.depth?.buffer).toBe(depthBuffer);
    expect(input.rgba).toEqual(rgbaBefore);
    expect(input.depth).toEqual(depthBefore);

    worker.emitMessage(responseFor(request));
    await expect(pending).resolves.toMatchObject({ width: 3, height: 2 });
  });

  it("rejects unknown keys, non-finite settings, invalid shapes, and SharedArrayBuffer input", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const extraInput = { ...raster(1, 1), extra: true } as StudioBg3dLtRasterInput;
    await expect(renderStudioBg3dLtLayersInWorker(extraInput, settings(), {
      workerFactory,
    })).rejects.toMatchObject({ code: "invalid-request" });

    const invalidSettings = settings();
    (invalidSettings.line as { strength: number }).strength = Number.NaN;
    await expect(renderStudioBg3dLtLayersInWorker(raster(1, 1), invalidSettings, {
      workerFactory,
    })).rejects.toMatchObject({ code: "invalid-request" });

    await expect(renderStudioBg3dLtLayersInWorker({
      ...raster(1, 1),
      rgba: new Uint8Array(3),
    }, settings(), { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });

    if (typeof SharedArrayBuffer === "function") {
      await expect(renderStudioBg3dLtLayersInWorker({
        width: 1,
        height: 1,
        rgba: new Uint8Array(new SharedArrayBuffer(4)),
      }, settings(), { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });
    }
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("rejects dimension and byte-length abuse before copying caller storage", async () => {
    const setSpy = vi.spyOn(Uint8Array.prototype, "set");
    const workerFactory = vi.fn(() => new FakeWorker());
    const oversizedForClaimedPixel = renderStudioBg3dLtLayersInWorker({
      width: 1,
      height: 1,
      rgba: new Uint8Array(1024 * 1024),
    }, settings(), { workerFactory });
    const overPixelBudget = renderStudioBg3dLtLayersInWorker({
      width: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1,
      height: 1,
      rgba: new Uint8Array(4),
    }, settings(), { workerFactory });

    expect(setSpy).not.toHaveBeenCalled();
    await expect(oversizedForClaimedPixel).rejects.toMatchObject({ code: "invalid-request" });
    await expect(overPixelBudget).rejects.toMatchObject({ code: "invalid-request" });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("moves the linear normalized-depth scan behind the Worker transfer boundary", async () => {
    const input = raster(1, 1);
    if (!input.depth) throw new Error("test depth unavailable");
    input.depth[0] = Number.NaN;
    const worker = new FakeWorker();
    const pending = renderStudioBg3dLtLayersInWorker(input, settings(), {
      workerFactory: () => worker,
    });
    const request = worker.requests[0];

    expect(isStudioBg3dLtRenderWorkerRequestEnvelope(request)).toBe(true);
    expect(isStudioBg3dLtRenderWorkerRequest(request)).toBe(false);
    worker.emitMessage({
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      code: "protocol",
    });
    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("uses an exact versioned protocol and rejects forged result roles, order, dimensions, and lengths", () => {
    const inputBuffer = new ArrayBuffer(4);
    const validRequest = {
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "render",
      requestId: 1,
      input: { width: 1, height: 1, rgbaBuffer: inputBuffer },
      settings: settings(),
    };
    expect(isStudioBg3dLtRenderWorkerRequest(validRequest)).toBe(true);
    expect(isStudioBg3dLtRenderWorkerRequest({ ...validRequest, version: 2 })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerRequest({ ...validRequest, extra: true })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerRequest({
      ...validRequest,
      input: { ...validRequest.input, extra: true },
    })).toBe(false);

    const validResponse = {
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      width: 1,
      height: 1,
      layers: [{ role: "main-line", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) }],
    };
    expect(isStudioBg3dLtRenderWorkerResponse(validResponse)).toBe(true);
    expect(isStudioBg3dLtRenderWorkerResponse({ ...validResponse, width: Number.NaN })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerResponse({
      ...validResponse,
      layers: [{ ...validResponse.layers[0], role: "normal" }],
    })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerResponse({
      ...validResponse,
      layers: [{ ...validResponse.layers[0], dataBuffer: new ArrayBuffer(3) }],
    })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerResponse({
      ...validResponse,
      layers: [
        { role: "main-line", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) },
        { role: "tone", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) },
      ],
    })).toBe(false);
    expect(isStudioBg3dLtRenderWorkerResponse({ ...validResponse, extra: true })).toBe(false);
  });

  it("ignores a stale request ID, then fails closed on a correlated dimension mismatch", async () => {
    const worker = new FakeWorker();
    const pending = renderStudioBg3dLtLayersInWorker(raster(2, 2), settings(), {
      workerFactory: () => worker,
    });
    const request = worker.requests[0];
    worker.emitMessage({ ...responseFor(request), requestId: request.requestId + 1 });
    expect(worker.terminateCalls).toBe(0);
    worker.emitMessage({
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      width: 1,
      height: 1,
      layers: [],
    });

    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("rejects result roles that the frozen request settings could not produce", async () => {
    const renderSettings = settings();
    (renderSettings.line as { enabled: boolean }).enabled = false;
    (renderSettings.tone as { mode: string }).mode = "none";
    const worker = new FakeWorker();
    const pending = renderStudioBg3dLtLayersInWorker(raster(1, 1), renderSettings, {
      workerFactory: () => worker,
    });
    const request = worker.requests[0];
    worker.emitMessage({
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      width: 1,
      height: 1,
      layers: [{
        role: "main-line",
        width: 1,
        height: 1,
        dataBuffer: new ArrayBuffer(4),
      }],
    });

    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("maps sanitized render failures and Worker error events and removes all listeners", async () => {
    const renderWorker = new FakeWorker();
    const renderFailure = renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      workerFactory: () => renderWorker,
    });
    renderWorker.emitMessage({
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: renderWorker.requests[0].requestId,
      code: "render-failed",
    });
    await expect(renderFailure).rejects.toMatchObject({ code: "render-failed" });

    const failedWorker = new FakeWorker();
    const workerFailure = renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      workerFactory: () => failedWorker,
    });
    failedWorker.emitError("messageerror");
    await expect(workerFailure).rejects.toMatchObject({ code: "worker-failed" });
    expect(failedWorker.terminateCalls).toBe(1);
    expect(failedWorker.messageListeners.size).toBe(0);
    expect(failedWorker.errorListeners.size).toBe(0);
    expect(failedWorker.messageErrorListeners.size).toBe(0);
  });

  it("terminates on abort and timeout and ignores late output", async () => {
    const controller = new AbortController();
    const abortedWorker = new FakeWorker();
    const aborted = renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      signal: controller.signal,
      workerFactory: () => abortedWorker,
    });
    const abortedRequest = abortedWorker.requests[0];
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(abortedWorker.terminateCalls).toBe(1);
    abortedWorker.emitMessage(responseFor(abortedRequest));
    expect(abortedWorker.terminateCalls).toBe(1);

    vi.useFakeTimers();
    const timedWorker = new FakeWorker();
    const timed = renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      timeoutMs: 100,
      workerFactory: () => timedWorker,
    });
    const outcome = timed.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(timedWorker.terminateCalls).toBe(1);
  });

  it("does not leak a Worker on unsupported, construction, or transfer failures", async () => {
    await expect(renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      workerFactory: () => null,
    })).rejects.toMatchObject({ code: "worker-unavailable" });
    await expect(renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      workerFactory: () => {
        throw new Error("blocked by CSP");
      },
    })).rejects.toMatchObject({ code: "worker-unavailable" });

    const postFailure = new FakeWorker();
    postFailure.throwOnPost = true;
    await expect(renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      workerFactory: () => postFailure,
    })).rejects.toMatchObject({ code: "worker-failed" });
    expect(postFailure.terminateCalls).toBe(1);

    const controller = new AbortController();
    controller.abort();
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(renderStudioBg3dLtLayersInWorker(raster(1, 1), settings(), {
      signal: controller.signal,
      workerFactory,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
