import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioOpenCvImageProvider,
  type StudioOpenCvImageResult,
} from "./studio-opencv-image-provider";
import {
  createStudioOpenCvImageWorkerClient,
  type StudioOpenCvImageWorkerLike,
} from "./studio-opencv-image-worker-client";
import { installStudioOpenCvImageWorkerHost } from "./studio-opencv-image-worker-host";
import {
  STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
  isStudioOpenCvImageResult,
  isStudioOpenCvImageWorkerInboundMessage,
  isStudioOpenCvImageWorkerOutboundMessage,
  studioOpenCvImageRequestTransfers,
  studioOpenCvImageResultTransfers,
  type StudioOpenCvImageWorkerInboundMessage,
  type StudioOpenCvImageWorkerOutboundMessage,
} from "./studio-opencv-image-worker-protocol";

import type { StudioOpenCvImageWorkerHostScope } from "./studio-opencv-image-worker-host";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function receipt() {
  return {
    provider: "opencv.js",
    packageName: "@techstark/opencv-js",
    packageVersion: "5.0.0-release.1",
    runtimeSource: "injected",
    execution: "wasm-provider",
    intendedHost: "dedicated-worker",
    synchronousJsFallback: false,
    nativeHandlesReturned: false,
    outputOwnership: "defensive-copy",
    capabilities: [
      "morphology",
      "connected-components",
      "contours",
      "perspective-warp",
    ],
  } as const;
}

function morphologyRequest(requestEpoch = 0) {
  return {
    operation: "morphology",
    requestEpoch,
    image: {
      width: 2,
      height: 2,
      channels: 1,
      data: Uint8Array.from([0, 255, 255, 0]),
    },
    mode: "open",
    kernel: { shape: "rect", width: 3, height: 3 },
  } as const;
}

class EchoWorker implements StudioOpenCvImageWorkerLike {
  readonly inbound: StudioOpenCvImageWorkerInboundMessage[] = [];
  terminated = false;
  autoRespond = true;
  private readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  private readonly errorListeners = new Set<(event: ErrorEventLike) => void>();

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEventLike) => void);
      if (this.messageListeners.size === 1) {
        queueMicrotask(() => this.emit({
          type: "studio-opencv-image/ready",
          version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
          requestEpoch: 0,
        }));
      }
    } else {
      this.errorListeners.add(listener as (event: ErrorEventLike) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
    }
  }

  postMessage(message: StudioOpenCvImageWorkerInboundMessage): void {
    this.inbound.push(message);
    if (message.type !== "studio-opencv-image/execute" || !this.autoRespond) return;
    const data = new Uint8Array(message.request.image.data);
    queueMicrotask(() => this.emit({
      type: "studio-opencv-image/result",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      result: {
        ok: true,
        artifact: {
          operation: "morphology",
          mode: "open",
          image: {
            width: message.request.image.width,
            height: message.request.image.height,
            channels: message.request.image.channels,
            data,
          },
          receipt: receipt(),
        },
      },
    }));
  }

  emit(message: StudioOpenCvImageWorkerOutboundMessage | unknown): void {
    for (const listener of this.messageListeners) listener({ data: message });
  }

  fail(): void {
    for (const listener of this.errorListeners) listener({});
  }

  terminate(): void {
    this.terminated = true;
  }
}

class MemoryHostScope implements StudioOpenCvImageWorkerHostScope {
  readonly outbound: Array<{
    message: StudioOpenCvImageWorkerOutboundMessage;
    transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<(event: MessageEventLike) => void>();

  postMessage(
    message: StudioOpenCvImageWorkerOutboundMessage,
    transfer: Transferable[],
  ): void {
    this.outbound.push({ message, transfer });
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEventLike) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEventLike) => void,
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio OpenCV image Worker boundary", () => {
  it("returns an explicit no-fallback receipt when Worker construction fails", async () => {
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => {
        throw new Error("Worker unavailable");
      },
    });

    await expect(client.execute(morphologyRequest())).resolves.toEqual({
      ok: false,
      reason: "worker-unavailable",
      detail: "OpenCV Worker is unavailable: construction-failed",
      fallback: {
        kind: "no-fallback",
        workerAvailable: false,
        mainThreadSynchronousFallback: false,
        reason: "construction-failed",
      },
    });
    expect(client.getDiagnostics()).toMatchObject({
      phase: "unavailable",
      pendingRequestCount: 0,
    });
  });

  it("copies caller bytes, executes through a ready Worker, and validates the result", async () => {
    const worker = new EchoWorker();
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
    });
    const request = morphologyRequest();
    const original = new Uint8Array(request.image.data);
    const result = await client.execute(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.operation).toBe("morphology");
    expect(request.image.data).toEqual(original);
    expect(worker.inbound).toHaveLength(1);
    const sent = worker.inbound[0];
    expect(sent?.type).toBe("studio-opencv-image/execute");
    if (sent?.type !== "studio-opencv-image/execute") return;
    expect(sent.request.image.data).not.toBe(request.image.data);
    expect(sent.request.image.data).toEqual(request.image.data);
    expect(isStudioOpenCvImageResult(result)).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "ready",
      pendingRequestCount: 0,
    });
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("rejects nested accessor-backed request fields without invoking or cloning them", async () => {
    const getter = vi.fn(() => 3);
    const request = morphologyRequest() as unknown as {
      kernel: Record<string, unknown>;
    };
    Object.defineProperty(request.kernel, "width", {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    const clone = vi.spyOn(globalThis, "structuredClone");
    const worker = new EchoWorker();
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
    });
    await expect(client.execute(request)).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(worker.inbound).toHaveLength(0);
    clone.mockRestore();
  });

  it("settles cancellation locally and emits a Worker cancel message", async () => {
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
    });
    const controller = new AbortController();
    const execution = client.execute(morphologyRequest(), controller.signal);
    await vi.waitFor(() => {
      expect(worker.inbound.some(({ type }) => type === "studio-opencv-image/execute")).toBe(true);
    });
    controller.abort();

    await expect(execution).resolves.toMatchObject({ ok: false, reason: "cancelled" });
    expect(worker.inbound.map(({ type }) => type)).toEqual([
      "studio-opencv-image/execute",
      "studio-opencv-image/cancel",
    ]);
    expect(client.getDiagnostics().pendingRequestCount).toBe(0);
  });

  it("invalidates active requests when the request epoch advances", async () => {
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
    });
    const execution = client.execute(morphologyRequest());
    await vi.waitFor(() => {
      expect(worker.inbound.some(({ type }) => type === "studio-opencv-image/execute")).toBe(true);
    });
    expect(client.advanceRequestEpoch(1)).toBe(true);

    await expect(execution).resolves.toMatchObject({
      ok: false,
      reason: "stale-request-epoch",
    });
    expect(worker.inbound.map(({ type }) => type)).toEqual([
      "studio-opencv-image/execute",
    ]);
    expect(worker.terminated).toBe(true);
    await expect(client.execute(morphologyRequest())).resolves.toMatchObject({
      ok: false,
      reason: "stale-request-epoch",
    });
  });

  it("terminates and cold-restarts a Worker that exceeds the per-request budget", async () => {
    vi.useFakeTimers();
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      requestTimeoutMs: 250,
      workerFactory: () => worker,
    });
    const execution = client.execute(morphologyRequest());
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.inbound.map(({ type }) => type)).toContain(
      "studio-opencv-image/execute",
    );

    await vi.advanceTimersByTimeAsync(250);
    await expect(execution).resolves.toMatchObject({
      ok: false,
      reason: "time-budget-exceeded",
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics().phase).toBe("cold");
  });

  it("turns malformed Worker output into protocol-unavailable without fallback execution", async () => {
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
    });
    const execution = client.execute(morphologyRequest());
    await vi.waitFor(() => {
      expect(worker.inbound.some(({ type }) => type === "studio-opencv-image/execute")).toBe(true);
    });
    worker.emit({ type: "legacy/success", pixels: [] });

    await expect(execution).resolves.toMatchObject({
      ok: false,
      reason: "worker-unavailable",
      fallback: {
        kind: "no-fallback",
        mainThreadSynchronousFallback: false,
        reason: "protocol-error",
      },
    });
    expect(worker.terminated).toBe(true);
  });

  it("fails closed on startup timeout and never posts an image operation", async () => {
    vi.useFakeTimers();
    const worker = new EchoWorker();
    worker.addEventListener = function addWithoutReady(
      type: "message" | "error" | "messageerror",
      listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
    ): void {
      if (type === "message") {
        // Keep the listener so termination cleanup remains realistic, but never signal ready.
        void listener;
      }
    };
    const client = createStudioOpenCvImageWorkerClient({
      requestEpoch: 0,
      workerFactory: () => worker,
      startupTimeoutMs: 250,
    });
    const execution = client.execute(morphologyRequest());
    await vi.advanceTimersByTimeAsync(250);

    await expect(execution).resolves.toMatchObject({
      ok: false,
      reason: "worker-unavailable",
      fallback: { reason: "startup-timeout" },
    });
    expect(worker.inbound).toEqual([]);
  });

  it("host validates malformed requests before loading OpenCV and emits transferable results", async () => {
    const runtimeLoader = vi.fn(() => {
      throw new Error("must stay lazy");
    });
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader,
    });
    const scope = new MemoryHostScope();
    const host = installStudioOpenCvImageWorkerHost(scope, provider);
    expect(scope.outbound[0]?.message).toEqual({
      type: "studio-opencv-image/ready",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestEpoch: 0,
    });

    scope.dispatch({
      type: "studio-opencv-image/execute",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestId: 9,
      request: {
        operation: "connected-components",
        requestEpoch: 0,
        image: { width: 2, height: 2, channels: 1, data: new Uint8Array(3) },
      },
    });
    await vi.waitFor(() => expect(scope.outbound).toHaveLength(2));
    expect(scope.outbound[1]?.message).toMatchObject({
      type: "studio-opencv-image/result",
      requestId: 9,
      result: { ok: false, reason: "invalid-input" },
    });
    expect(runtimeLoader).not.toHaveBeenCalled();

    scope.dispatch({ requestId: 10, type: "legacy/run" });
    expect(scope.outbound[2]?.message).toMatchObject({
      type: "studio-opencv-image/result",
      requestId: 10,
      result: { ok: false, reason: "invalid-input" },
    });
    host.dispose();
  });

  it("strictly validates protocol messages and emits only typed-array transfer buffers", () => {
    const request: StudioOpenCvImageWorkerInboundMessage = {
      type: "studio-opencv-image/execute",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      request: morphologyRequest(),
    };
    expect(isStudioOpenCvImageWorkerInboundMessage(request)).toBe(true);
    expect(studioOpenCvImageRequestTransfers(request)).toEqual([
      request.request.image.data.buffer,
    ]);
    expect(isStudioOpenCvImageWorkerInboundMessage({
      ...request,
      version: 99,
    })).toBe(false);

    const result: StudioOpenCvImageResult = {
      ok: true,
      artifact: {
        operation: "morphology",
        mode: "open",
        image: {
          width: 2,
          height: 2,
          channels: 1,
          data: Uint8Array.from([0, 1, 1, 0]),
        },
        receipt: receipt(),
      },
    };
    const response: StudioOpenCvImageWorkerOutboundMessage = {
      type: "studio-opencv-image/result",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      result,
    };
    expect(isStudioOpenCvImageWorkerOutboundMessage(response)).toBe(true);
    if (response.type !== "studio-opencv-image/result") return;
    expect(studioOpenCvImageResultTransfers(response)).toEqual([
      result.ok && result.artifact.operation === "morphology"
        ? result.artifact.image.data.buffer
        : null,
    ]);
    expect(isStudioOpenCvImageWorkerOutboundMessage({
      ...response,
      result: {
        ok: true,
        artifact: {
          ...result.artifact,
          image: {
            width: 2,
            height: 2,
            channels: 1,
            data: new Uint8Array(3),
          },
        },
      },
    })).toBe(false);
  });

  it("keeps Worker wiring renderer-neutral and free of a main-thread OpenCV fallback", () => {
    const clientSource = readFileSync(
      new URL("./studio-opencv-image-worker-client.ts", import.meta.url),
      "utf8",
    );
    const hostSource = readFileSync(
      new URL("./studio-opencv-image-worker-host.ts", import.meta.url),
      "utf8",
    );
    const workerSource = readFileSync(
      new URL("./studio-opencv-image-provider.worker.ts", import.meta.url),
      "utf8",
    );

    expect(clientSource).toContain('new Worker(new URL("./studio-opencv-image-provider.worker.ts"');
    expect(clientSource).toContain('kind: "no-fallback"');
    expect(clientSource).toContain("mainThreadSynchronousFallback: false");
    expect(clientSource).not.toContain('@techstark/opencv-js');
    for (const source of [clientSource, hostSource, workerSource]) {
      expect(source).not.toMatch(/(?:react-)?konva/i);
      expect(source).not.toMatch(/\bdocument\b/i);
      expect(source).not.toMatch(/\bcanvas\b/i);
      expect(source).not.toContain("getContext(");
    }
  });
});
