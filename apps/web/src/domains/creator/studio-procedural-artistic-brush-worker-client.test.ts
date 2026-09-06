import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  StudioProceduralArtisticBrushWorkerClientError,
  probeStudioProceduralArtisticBrushWorker,
  renderStudioProceduralArtisticBrushInWorker,
  type StudioProceduralArtisticBrushWorkerLike,
} from "./studio-procedural-artistic-brush-worker-client";
import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
  studioProceduralArtisticBrushWorkerResultTransfers,
  type StudioProceduralArtisticBrushWorkerOutboundMessage,
  type StudioProceduralArtisticBrushWorkerRenderMessage,
  type StudioProceduralArtisticBrushWorkerRequest,
  type StudioProceduralArtisticBrushWorkerResultMessage,
} from "./studio-procedural-artistic-brush-worker-protocol";

import type { StudioProceduralArtisticBrushCapability } from "./studio-procedural-artistic-brush-provider";

const HASH = `sha256:${"d".repeat(64)}` as const;

function request(): StudioProceduralArtisticBrushWorkerRequest {
  return {
    kind: "studio-procedural-artistic-brush/request",
    version: 1,
    requestSequence: 3,
    engineEpoch: 5,
    strokeId: "client-worker-stroke",
    stage: "settled",
    seed: 123,
    width: 2,
    height: 2,
    pixelRatio: 1,
    plan: {
      technique: "mass",
      presetId: "charcoal-mass",
      samples: [
        {
          x: 0,
          y: 0,
          pressure: 0.5,
          tiltX: 0,
          tiltY: 0,
          timeMilliseconds: 0,
        },
        {
          x: 2,
          y: 2,
          pressure: 0.9,
          tiltX: 8,
          tiltY: -4,
          timeMilliseconds: 8,
        },
      ],
      parameters: { brush: "charcoal", strength: 0.8 },
    },
  };
}

function watercolorFillRequest(): StudioProceduralArtisticBrushWorkerRequest {
  return {
    ...request(),
    requestSequence: 4,
    strokeId: "client-watercolor-fill",
    plan: {
      technique: "watercolor-fill",
      presetId: "studio-procedural-watercolor-fill-v1",
      samples: request().plan.samples,
      parameters: {
        angle: 0.6109,
        color: "#336699",
        density: 0.64,
        opacity: 0.72,
        strength: 0.78,
      },
    },
  };
}

function flatWashRequest(): StudioProceduralArtisticBrushWorkerRequest {
  return {
    ...request(),
    requestSequence: 5,
    strokeId: "client-flat-wash",
    plan: {
      technique: "flat-wash",
      presetId: "studio-procedural-flat-wash-v1",
      samples: request().plan.samples,
      parameters: {
        color: "#336699",
        opacity: 0.78,
      },
    },
  };
}

function ready(): StudioProceduralArtisticBrushWorkerOutboundMessage {
  return {
    type: "studio-procedural-artistic-brush/ready",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    probe: {
      workerScope: "DedicatedWorkerGlobalScope",
      dedicatedWorker: true,
      offscreenCanvas: true,
      webgl2: true,
      privateSurface: true,
      mainThreadFallback: false,
      webglVersion: "WebGL 2.0 test",
    },
  };
}

function completed(
  message: StudioProceduralArtisticBrushWorkerRenderMessage,
): StudioProceduralArtisticBrushWorkerResultMessage {
  const { request: active } = message;
  const pixels = new Uint8ClampedArray(16).fill(91);
  const capability: StudioProceduralArtisticBrushCapability =
    active.plan.technique === "flow-field"
      ? "procedural:flow-field"
      : active.plan.technique === "hatch"
        ? "procedural:hatch"
        : active.plan.technique === "mass"
          ? "procedural:mass"
          : active.plan.technique === "watercolor-fill"
            ? "procedural:watercolor-fill"
            : "procedural:flat-wash";
  return {
    type: "studio-procedural-artistic-brush/result",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: message.requestId,
    requestSequence: active.requestSequence,
    engineEpoch: active.engineEpoch,
    result: {
      status: "completed",
      consumed: false,
      artifact: {
        kind: "studio-procedural-artistic-brush/artifact",
        version: 1,
        width: active.width,
        height: active.height,
        encoding: "rgba8-unorm",
        colorSpace: "srgb",
        alpha: "straight",
        pixels,
        receipt: {
          kind: "studio-procedural-artistic-brush/receipt",
          version: 1,
          requestSequence: active.requestSequence,
          engineEpoch: active.engineEpoch,
          strokeId: active.strokeId,
          seed: active.seed,
          technique: active.plan.technique,
          presetId: active.plan.presetId,
          width: active.width,
          height: active.height,
          outputBytes: pixels.byteLength,
          inputFingerprint: HASH,
          pixelHash: HASH,
          replayFingerprint: HASH,
          adapter: {
            id: "p5-brush-standalone-worker",
            version: "2.2.1-adapter.3",
            compatibility: "p5.brush/standalone",
          },
          execution: {
            stage: "settled",
            locality: "dedicated-worker",
            surface: "offscreen-canvas-webgl2",
            backend: "webgl2",
            mainThreadFallback: false,
          },
          authority: {
            mainScene: false,
            document: false,
            history: false,
            persistence: false,
            output: "settled-raster-suggestion",
          },
          capabilitiesUsed: [capability],
          complete: true,
        },
      },
    },
  };
}

type MessageListener = (
  event: Readonly<{ data: unknown }>,
) => void;
type ErrorListener = (
  event: Readonly<{
    error?: unknown;
    message?: string;
    preventDefault?(): void;
  }>,
) => void;

class MockWorker implements StudioProceduralArtisticBrushWorkerLike {
  readonly #messageListeners = new Set<MessageListener>();
  readonly #errorListeners = new Set<ErrorListener>();
  readonly #messageErrorListeners = new Set<ErrorListener>();
  public terminateCount = 0;
  public posted = 0;
  public transferredOutput = 0;
  public lastPosted:
    StudioProceduralArtisticBrushWorkerRenderMessage | null = null;
  public mode:
    | "success"
    | "hang"
    | "malformed"
    | "provider-rejected"
    | "throw-post" = "success";

  public constructor(emitReady = true) {
    if (emitReady) queueMicrotask(() => this.emitMessage(ready()));
  }

  public postMessage(
    message: StudioProceduralArtisticBrushWorkerRenderMessage,
  ): void {
    this.posted += 1;
    this.lastPosted = message;
    if (this.mode === "throw-post") {
      throw new DOMException("blocked", "DataCloneError");
    }
    if (this.mode === "hang") return;
    if (this.mode === "malformed") {
      queueMicrotask(() => this.emitMessage({
        ...completed(message),
        requestId: 99,
        extra: true,
      }));
      return;
    }
    if (this.mode === "provider-rejected") {
      queueMicrotask(() => this.emitMessage({
        type: "studio-procedural-artistic-brush/result",
        version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestSequence: message.request.requestSequence,
        engineEpoch: message.request.engineEpoch,
        result: {
          status: "rejected",
          consumed: false,
          reason: "adapter-failed",
          detail: "p5 adapter rejected the plan",
        },
      }));
      return;
    }
    const response = completed(message);
    const transfer =
      studioProceduralArtisticBrushWorkerResultTransfers(response);
    this.transferredOutput = transfer.length;
    const cloned = structuredClone(response, { transfer });
    queueMicrotask(() => this.emitMessage(cloned));
  }

  public addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | ErrorListener,
  ): void {
    if (type === "message") {
      this.#messageListeners.add(listener as MessageListener);
    } else if (type === "error") {
      this.#errorListeners.add(listener as ErrorListener);
    } else {
      this.#messageErrorListeners.add(listener as ErrorListener);
    }
  }

  public removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | ErrorListener,
  ): void {
    if (type === "message") {
      this.#messageListeners.delete(listener as MessageListener);
    } else if (type === "error") {
      this.#errorListeners.delete(listener as ErrorListener);
    } else {
      this.#messageErrorListeners.delete(listener as ErrorListener);
    }
  }

  public terminate(): void {
    this.terminateCount += 1;
  }

  public emitMessage(data: unknown): void {
    for (const listener of this.#messageListeners) listener({ data });
  }

  public emitError(error: unknown): void {
    for (const listener of this.#errorListeners) {
      listener({ error, message: error instanceof Error ? error.message : "" });
    }
  }

  public emitMessageError(): void {
    for (const listener of this.#messageErrorListeners) listener({});
  }
}

describe("probeStudioProceduralArtisticBrushWorker", () => {
  it("returns an exact frozen capability receipt and never posts a render", async () => {
    const worker = new MockWorker();

    const result = await probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => worker,
    });

    expect(result).toEqual({
      available: true,
      probe: {
        workerScope: "DedicatedWorkerGlobalScope",
        dedicatedWorker: true,
        offscreenCanvas: true,
        webgl2: true,
        privateSurface: true,
        mainThreadFallback: false,
        webglVersion: "WebGL 2.0 test",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.available && Object.isFrozen(result.probe)).toBe(true);
    expect(worker.posted).toBe(0);
    expect(worker.terminateCount).toBe(1);
  });

  it("returns a frozen unavailable observation without treating it as an exception", async () => {
    const worker = new MockWorker(false);
    const pending = probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => worker,
    });
    worker.emitMessage({
      type: "studio-procedural-artistic-brush/unavailable",
      version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
      reason: "webgl2-unavailable",
      detail: "A private Worker WebGL2 context is unavailable.",
    });

    await expect(pending).resolves.toEqual({
      available: false,
      reason: "webgl2-unavailable",
      detail: "A private Worker WebGL2 context is unavailable.",
    });
    const result = await pending;
    expect(Object.isFrozen(result)).toBe(true);
    expect(worker.posted).toBe(0);
    expect(worker.terminateCount).toBe(1);
  });

  it("fails closed for duplicate ready and malformed capability messages", async () => {
    const duplicate = new MockWorker(false);
    const duplicatePending = probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => duplicate,
    });
    duplicate.emitMessage(ready());
    duplicate.emitMessage(ready());
    await expect(duplicatePending).rejects.toMatchObject({
      reason: "protocol-error",
    });
    expect(duplicate.posted).toBe(0);
    expect(duplicate.terminateCount).toBe(1);

    const malformed = new MockWorker(false);
    const malformedPending = probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => malformed,
    });
    const validReady = ready();
    if (validReady.type !== "studio-procedural-artistic-brush/ready") {
      throw new Error("expected a ready fixture");
    }
    malformed.emitMessage({
      ...validReady,
      probe: {
        ...validReady.probe,
        mainThreadFallback: true,
      },
    });
    await expect(malformedPending).rejects.toMatchObject({
      reason: "protocol-error",
    });
    expect(malformed.posted).toBe(0);
  });

  it("rejects Worker error, messageerror, startup timeout, and abort with cleanup", async () => {
    await expect(probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => null,
    })).rejects.toMatchObject({
      reason: "worker-unavailable",
    });

    const crashed = new MockWorker(false);
    const crashPending = probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => crashed,
    });
    crashed.emitError(new Error("module load failed"));
    await expect(crashPending).rejects.toMatchObject({
      reason: "worker-error",
    });
    expect(crashed.terminateCount).toBe(1);

    const cloneFailed = new MockWorker(false);
    const clonePending = probeStudioProceduralArtisticBrushWorker({
      workerFactory: () => cloneFailed,
    });
    cloneFailed.emitMessageError();
    await expect(clonePending).rejects.toMatchObject({
      reason: "data-clone-error",
    });
    expect(cloneFailed.terminateCount).toBe(1);

    vi.useFakeTimers();
    try {
      const timedOut = new MockWorker(false);
      const timeoutPending = probeStudioProceduralArtisticBrushWorker({
        workerFactory: () => timedOut,
        startupTimeoutMilliseconds: 25,
      });
      const timeoutAssertion = expect(timeoutPending).rejects.toMatchObject({
        reason: "startup-timeout",
      });
      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;
      expect(timedOut.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }

    const aborted = new MockWorker(false);
    const controller = new AbortController();
    const abortPending = probeStudioProceduralArtisticBrushWorker({
      signal: controller.signal,
      workerFactory: () => aborted,
    });
    controller.abort();
    await expect(abortPending).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted.terminateCount).toBe(1);
    expect(aborted.posted).toBe(0);
  });
});

describe("renderStudioProceduralArtisticBrushInWorker", () => {
  it("returns the transferred plain artifact and preserves integrity receipts", async () => {
    const worker = new MockWorker();

    const artifact = await renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => worker },
    );

    expect(artifact).toMatchObject({
      kind: "studio-procedural-artistic-brush/artifact",
      pixels: expect.any(Uint8ClampedArray),
      receipt: {
        pixelHash: HASH,
        replayFingerprint: HASH,
        execution: {
          locality: "dedicated-worker",
          mainThreadFallback: false,
        },
      },
    });
    expect(artifact.pixels).toHaveLength(16);
    expect(worker.posted).toBe(1);
    expect(worker.transferredOutput).toBe(1);
    expect(worker.terminateCount).toBe(1);
  });

  it("preserves declarative watercolor-fill and flat-wash plans end to end", async () => {
    for (const expected of [
      {
        request: watercolorFillRequest(),
        capability: "procedural:watercolor-fill",
      },
      {
        request: flatWashRequest(),
        capability: "procedural:flat-wash",
      },
    ] as const) {
      const worker = new MockWorker();
      const artifact = await renderStudioProceduralArtisticBrushInWorker(
        expected.request,
        { workerFactory: () => worker },
      );

      expect(worker.lastPosted?.request.plan).toEqual(
        expected.request.plan,
      );
      expect(artifact.receipt).toMatchObject({
        technique: expected.request.plan.technique,
        presetId: expected.request.plan.presetId,
        adapter: {
          version: "2.2.1-adapter.3",
        },
        capabilitiesUsed: [expected.capability],
      });
      expect(worker.transferredOutput).toBe(1);
      expect(worker.terminateCount).toBe(1);
    }
  });

  it("has no main-thread fallback when Worker capability is unavailable", async () => {
    const unsupported = new MockWorker(false);
    queueMicrotask(() => unsupported.emitMessage({
      type: "studio-procedural-artistic-brush/unavailable",
      version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
      reason: "webgl2-unavailable",
      detail: "Worker OffscreenCanvas WebGL2 is unavailable.",
    }));

    await expect(renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => unsupported },
    )).rejects.toMatchObject({
      reason: "unsupported-environment",
    });
    expect(unsupported.posted).toBe(0);
    expect(unsupported.terminateCount).toBe(1);

    await expect(renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => null },
    )).rejects.toMatchObject({
      reason: "worker-unavailable",
    });
  });

  it("terminates immediately when AbortSignal cancels an active render", async () => {
    const worker = new MockWorker();
    worker.mode = "hang";
    const controller = new AbortController();
    const pending = renderStudioProceduralArtisticBrushInWorker(
      request(),
      {
        signal: controller.signal,
        workerFactory: () => worker,
      },
    );
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posted).toBe(1);
    expect(worker.terminateCount).toBe(1);
  });

  it("fails closed for malformed output, provider rejection, and postMessage cloning errors", async () => {
    const malformed = new MockWorker();
    malformed.mode = "malformed";
    await expect(renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => malformed },
    )).rejects.toMatchObject({ reason: "protocol-error" });

    const rejected = new MockWorker();
    rejected.mode = "provider-rejected";
    await expect(renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => rejected },
    )).rejects.toMatchObject({
      reason: "provider-rejected",
      providerReason: "adapter-failed",
    });

    const cloneFailure = new MockWorker();
    cloneFailure.mode = "throw-post";
    await expect(renderStudioProceduralArtisticBrushInWorker(
      request(),
      { workerFactory: () => cloneFailure },
    )).rejects.toMatchObject({ reason: "data-clone-error" });
    expect(cloneFailure.terminateCount).toBe(1);
  });

  it("bounds both startup and operation waits", async () => {
    vi.useFakeTimers();
    try {
      const noReady = new MockWorker(false);
      const startup = renderStudioProceduralArtisticBrushInWorker(
        request(),
        {
          workerFactory: () => noReady,
          startupTimeoutMilliseconds: 20,
        },
      );
      const startupAssertion = expect(startup).rejects.toMatchObject({
        reason: "startup-timeout",
      });
      await vi.advanceTimersByTimeAsync(20);
      await startupAssertion;
      expect(noReady.terminateCount).toBe(1);

      const hanging = new MockWorker();
      hanging.mode = "hang";
      const operation = renderStudioProceduralArtisticBrushInWorker(
        request(),
        {
          workerFactory: () => hanging,
          operationTimeoutMilliseconds: 30,
        },
      );
      const operationAssertion = expect(operation).rejects.toMatchObject({
        reason: "operation-timeout",
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(hanging.posted).toBe(1);
      await vi.advanceTimersByTimeAsync(30);
      await operationAssertion;
      expect(hanging.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses only the production provider in a private module Worker", () => {
    const root = process.cwd();
    const client = readFileSync(join(
      root,
      "apps/web/src/domains/creator/studio-procedural-artistic-brush-worker-client.ts",
    ), "utf8");
    const worker = readFileSync(join(
      root,
      "apps/web/src/domains/creator/studio-procedural-artistic-brush.worker.ts",
    ), "utf8");

    expect(client).toMatch(
      /new URL\(\s*["']\.\/studio-procedural-artistic-brush\.worker\.ts["']/u,
    );
    expect(client).toContain('type: "module"');
    expect(client).not.toContain(
      "createStudioProceduralArtisticBrushProvider",
    );
    expect(client).not.toContain(
      "createStudioP5BrushStandaloneAdapterLoader",
    );
    expect(worker).toContain(
      "createStudioProceduralArtisticBrushProvider({",
    );
    expect(worker).toContain(
      "createStudioP5BrushStandaloneAdapterLoader()",
    );
    expect(worker).toContain("new OffscreenCanvas(width, height)");
    expect(worker).toContain('canvas.getContext("webgl2"');
    expect(worker).toContain("antialias: false");
    expect(worker).toContain("depth: false");
    expect(worker).toContain("stencil: false");
    expect(worker).toContain('getExtension("WEBGL_lose_context")');
    expect(worker).toContain('executionLocality: "dedicated-worker"');
    expect(worker).toContain("transferredFromMainThread: false");
  });

  it("exposes a typed boundary error for callers", () => {
    const error = new StudioProceduralArtisticBrushWorkerClientError(
      "provider-rejected",
      "failed",
      "adapter-failed",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "StudioProceduralArtisticBrushWorkerClientError",
      reason: "provider-rejected",
      providerReason: "adapter-failed",
    });
  });
});
