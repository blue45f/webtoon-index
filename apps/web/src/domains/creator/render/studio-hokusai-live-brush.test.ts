import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
  STUDIO_HOKUSAI_LIVE_MIN_SAMPLE_INTERVAL_MS,
  STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE,
  packStudioHokusaiLiveSamples,
  snapshotStudioHokusaiLiveInboundMessage,
  studioHokusaiLiveInboundTransfers,
  type StudioHokusaiLiveBrushCapabilities,
} from "./studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
  planStudioHokusaiLiveSegment,
  resolveStudioHokusaiLiveAutoRouteDecision,
  resolveStudioHokusaiLiveMaterialProfile,
  resolveStudioHokusaiLivePreset,
  resolveStudioHokusaiLiveRoute,
  studioHokusaiLiveSampleFitsPinnedSegment,
} from "./studio-hokusai-live-brush-router";
import {
  StudioHokusaiLiveBrushProvider,
  type StudioHokusaiLiveWorkerLike,
} from "./studio-hokusai-live-brush-runtime";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

const CAPABILITIES: StudioHokusaiLiveBrushCapabilities = {
  engine: "reearth-hokusai",
  engineVersion: "0.3.0",
  surfaceAdapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  wasm: true,
  dedicatedWorker: true,
  packedDirtyFrames: true,
  transferableFrames: true,
  epochCancellation: true,
  canonicalPng: true,
  liveCommitParityReceipt: true,
  materialTexture: "studio-hokusai-material-texture-v2",
  materialProfileRouting: "identity-profile-v1",
  endpointPolicy: "tapered-start-no-dab-carrier-v1",
  mainThreadFullFrameCopy: false,
};

function routeInput() {
  return {
    brushId: "charcoal",
    documentWidth: 1_440,
    documentHeight: 80_000,
    firstX: 720,
    firstY: 40_000,
    radiusPixels: 18,
    color: "#223344" as const,
    opacity: 0.8,
    seed: 17,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hash(buffer: ArrayBuffer): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

class FakeHokusaiLiveWorker implements StudioHokusaiLiveWorkerLike {
  readonly sent: Readonly<{ message: unknown; transfer: readonly Transferable[] }>[] = [];
  readonly #messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly #errorListeners = new Set<(event: ErrorEvent) => void>();
  readonly #messageErrorListeners = new Set<(event: MessageEvent<unknown>) => void>();
  #lastIdentity: { requestId: number; engineEpoch: number; strokeId: string } | null = null;
  #lastSequence = 0;
  #config: Record<string, unknown> | null = null;
  #appendCount = 0;
  terminateCount = 0;

  constructor(
    readonly options: Readonly<{ acceptFirstAppendWithoutFrame?: boolean }> = {},
  ) {}

  addEventListener(
    type: "error" | "message" | "messageerror",
    listener: ((event: ErrorEvent) => void) | ((event: MessageEvent<unknown>) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.#errorListeners.add(listener as (event: ErrorEvent) => void);
    } else {
      this.#messageErrorListeners.add(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  removeEventListener(
    type: "error" | "message" | "messageerror",
    listener: ((event: ErrorEvent) => void) | ((event: MessageEvent<unknown>) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.#errorListeners.delete(listener as (event: ErrorEvent) => void);
    } else {
      this.#messageErrorListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    (this.sent as { message: unknown; transfer: readonly Transferable[] }[]).push({
      message,
      transfer,
    });
    if (typeof message !== "object" || message === null) return;
    const candidate = message as Record<string, unknown>;
    if (candidate.type === "studio-hokusai-live/begin") {
      this.#lastIdentity = {
        requestId: candidate.requestId as number,
        engineEpoch: candidate.engineEpoch as number,
        strokeId: candidate.strokeId as string,
      };
      this.#config = candidate.config as Record<string, unknown>;
      queueMicrotask(() => this.emit({
        type: "studio-hokusai-live/begun",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        ...this.#lastIdentity,
      }));
    } else if (candidate.type === "studio-hokusai-live/append") {
      this.#lastSequence = candidate.sequence as number;
      this.#appendCount += 1;
      if (this.options.acceptFirstAppendWithoutFrame && this.#appendCount === 1) {
        queueMicrotask(() => this.emit({
          type: "studio-hokusai-live/accepted",
          version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
          ...this.#lastIdentity,
          sequence: this.#lastSequence,
          presentation: "no-dirty-pixels",
        }));
      } else {
        queueMicrotask(() => void this.#emitFrame());
      }
    } else if (candidate.type === "studio-hokusai-live/finish") {
      queueMicrotask(() => void this.#emitComplete());
    } else if (candidate.type === "studio-hokusai-live/cancel") {
      queueMicrotask(() => this.emit({
        type: "studio-hokusai-live/cancelled",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        ...this.#lastIdentity,
      }));
    }
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  listenerSnapshot(): Readonly<{
    message: readonly ((event: MessageEvent<unknown>) => void)[];
    error: readonly ((event: ErrorEvent) => void)[];
    messageerror: readonly ((event: MessageEvent<unknown>) => void)[];
  }> {
    return Object.freeze({
      message: Object.freeze([...this.#messageListeners]),
      error: Object.freeze([...this.#errorListeners]),
      messageerror: Object.freeze([...this.#messageErrorListeners]),
    });
  }

  emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of this.#messageListeners) listener(event);
  }

  ready(): void {
    this.emit({
      type: "studio-hokusai-live/ready",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      capabilities: CAPABILITIES,
    });
  }

  async #emitFrame(): Promise<void> {
    const pixels = Uint8Array.from([12, 34, 56, 255]).buffer;
    const pixelHash = await hash(pixels);
    this.emit({
      type: "studio-hokusai-live/frame",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      ...this.#lastIdentity,
      sequence: this.#lastSequence,
      phase: "live",
      segmentIndex: 0,
      dirtyBounds: [0, 0, 1, 1],
      logicalPlacement: {
        x: this.#config?.logicalOriginX ?? 0,
        y: this.#config?.logicalOriginY ?? 0,
        width: 1,
        height: 1,
      },
      pixelLayout: "packed-dirty-rgba8",
      pixels,
      pixelHash,
    });
  }

  async #emitComplete(): Promise<void> {
    const pixels = Uint8Array.from([12, 34, 56, 255]).buffer;
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer;
    const [pixelHash, pngHash, inputHash] = await Promise.all([
      hash(pixels),
      hash(pngBytes),
      hash(Uint8Array.from([1, 2, 3]).buffer),
    ]);
    const logicalPlacement = {
      x: this.#config?.logicalOriginX ?? 0,
      y: this.#config?.logicalOriginY ?? 0,
      width: 1,
      height: 1,
    };
    this.emit({
      type: "studio-hokusai-live/complete",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      ...this.#lastIdentity,
      finalSequence: this.#lastSequence,
      segmentIndex: 0,
      dirtyBounds: [0, 0, 1, 1],
      logicalPlacement,
      pixelLayout: "packed-dirty-rgba8",
      pixels,
      pngBytes,
      receipt: {
        kind: "studio-hokusai-live/canonical-receipt",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        ...this.#lastIdentity,
        presetId: this.#config?.presetId,
        materialProfileId: this.#config?.materialProfileId,
        seed: this.#config?.seed,
        sampleCount: 2,
        finalSequence: this.#lastSequence,
        segmentCount: 1,
        segments: [{ segmentIndex: 0, logicalPlacement, pixelHash, pngHash }],
        dirtyBounds: [0, 0, 1, 1],
        pixelLayout: "packed-dirty-rgba8",
        inputHash,
        lastLivePixelHash: pixelHash,
        settledPixelHash: pixelHash,
        pngHash,
        exactLiveCommitParity: true,
        materialTexture: "studio-hokusai-material-texture-v2",
        endpointPolicy: "tapered-start-no-dab-carrier-v1",
        colorOpacityApplication: "worker-once-before-material-transfer-v1",
        execution: "dedicated-worker-wasm-packed-dirty-live",
        canonicalAuthority: "settled-png-receipt-v1",
        undoAuthority: "single-stroke-transaction-v1",
        saveAuthority: "canonical-png-plus-versioned-receipt-v1",
        complete: true,
      },
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio Hokusai live brush vertical slice", () => {
  it("automatically maps every quality-gated core shelf, and nothing else", () => {
    expect(resolveStudioHokusaiLivePreset("pencil-6b")).toBe("pencil");
    expect(resolveStudioHokusaiLivePreset("charcoal")).toBe("charcoal");
    expect(resolveStudioHokusaiLivePreset("acrylic")).toBe("oil");
    expect(resolveStudioHokusaiLiveMaterialProfile("charcoal")).toBe("charcoal");
    expect(resolveStudioHokusaiLiveMaterialProfile("chalk")).toBe("chalk");
    expect(resolveStudioHokusaiLiveMaterialProfile("crayon")).toBe("crayon");
    expect(resolveStudioHokusaiLiveMaterialProfile("pastel")).toBe("pastel");
    expect(resolveStudioHokusaiLiveMaterialProfile("oil-pastel")).toBe("oil-pastel");
    expect(resolveStudioHokusaiLiveMaterialProfile("oil")).toBe("oil");
    expect(resolveStudioHokusaiLiveMaterialProfile("acrylic")).toBe("acrylic");
    expect(resolveStudioHokusaiLiveMaterialProfile("gouache")).toBe("gouache");
    expect(resolveStudioHokusaiLiveMaterialProfile("brush")).toBe("painterly");
    expect(resolveStudioHokusaiLivePreset("parallel-pen")).toBe("calligraphy");
    expect(resolveStudioHokusaiLiveMaterialProfile("parallel-pen"))
      .toBe("calligraphy");
    expect(resolveStudioHokusaiLivePreset("alcohol-marker")).toBe("marker");
    expect(resolveStudioHokusaiLiveMaterialProfile("alcohol-marker"))
      .toBe("marker");
    // gpen stays procedural: no natural-media preset claims the G-pen ink family.
    expect(resolveStudioHokusaiLivePreset("gpen")).toBeNull();
    expect(resolveStudioHokusaiLiveAutoRouteDecision(
      "dry-media",
      "precision-pencil",
    )).toEqual({
      status: "rejected",
      reason: "catalog-identity-not-quality-gated",
    });
  });

  it("admits an 80,000px webtoon document through a bounded stroke-local surface", () => {
    const route = resolveStudioHokusaiLiveRoute({
      ...routeInput(),
      providerState: "ready",
      capabilities: CAPABILITIES,
    });
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    expect(route.config.documentHeight).toBe(80_000);
    expect(route.config.surfaceWidth).toBeLessThanOrEqual(4_096);
    expect(route.config.surfaceHeight).toBeLessThanOrEqual(4_096);
    expect(route.config.surfaceWidth * route.config.surfaceHeight)
      .toBeLessThanOrEqual(16_777_216);
    expect(route.config.logicalOriginY).toBeGreaterThan(0);
    expect(route.config.materialProfileId).toBe("charcoal");
    expect(route.autoRoutePolicy).toEqual({
      version: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
      qualityGate: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
      identity: "charcoal",
      identityAuthority: "brush-id",
    });
    expect(route.admission).toMatchObject({
      boundary: "stroke-start",
      ownership: "pinned-for-entire-stroke",
      midStrokePromotion: false,
      inFlightFrameLimit: 1,
      stalePresentationPolicy: "coalesce-latest",
      inputDropAllowed: false,
      segmentPolicy: "single-bounded-4096-fail-closed",
      midStrokeFallbackForbiddenReason:
        "would-split-pixel-authority-and-break-live-commit-undo-save-parity",
    });
  });

  it("plans bounded rebased segments without treating document height as a WASM allocation", () => {
    const first = planStudioHokusaiLiveSegment({
      documentWidth: 1_440,
      documentHeight: 120_000,
      contactX: 200,
      contactY: 2_000,
      radiusPixels: 32,
      segmentIndex: 0,
    });
    const rebased = planStudioHokusaiLiveSegment({
      documentWidth: 1_440,
      documentHeight: 120_000,
      contactX: 1_100,
      contactY: 90_000,
      radiusPixels: 32,
      segmentIndex: 1,
    });
    expect(first).not.toBeNull();
    expect(rebased).not.toBeNull();
    expect(rebased).toMatchObject({
      documentHeight: 120_000,
      segmentIndex: 1,
    });
    expect(rebased!.surfaceHeight).toBeLessThanOrEqual(4_096);
    expect(rebased!.logicalOriginY).toBeGreaterThan(first!.logicalOriginY);
  });

  it("exposes the v1 single-segment limit instead of clipping or silently switching mid-stroke", () => {
    const route = resolveStudioHokusaiLiveRoute({
      ...routeInput(),
      providerState: "ready",
      capabilities: CAPABILITIES,
    });
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    expect(studioHokusaiLiveSampleFitsPinnedSegment(route.config, {
      x: 720,
      y: 40_100,
    })).toBe(true);
    expect(studioHokusaiLiveSampleFitsPinnedSegment(route.config, {
      x: 720,
      y: 47_000,
    })).toBe(false);
    expect(route.admission.midStrokeFallbackForbiddenReason)
      .toContain("break-live-commit-undo-save-parity");
  });

  it("rejects a not-ready selected provider before input transfer and permits only a next-stroke retry", () => {
    expect(resolveStudioHokusaiLiveRoute({
      ...routeInput(),
      providerState: "loading",
      capabilities: null,
    })).toEqual({
      status: "unavailable",
      reason: "provider-loading",
      selectedBackendId: "hokusai-myb-worker",
      retainedInput: false,
      lastGoodFrame: null,
      nextStrokeOnly: true,
    });
    const incomplete = { ...CAPABILITIES, liveCommitParityReceipt: false };
    expect(resolveStudioHokusaiLiveRoute({
      ...routeInput(),
      providerState: "ready",
      capabilities: incomplete as unknown as StudioHokusaiLiveBrushCapabilities,
    })).toMatchObject({
      status: "unavailable",
      reason: "runtime-capability-rejected",
      selectedBackendId: "hokusai-myb-worker",
      retainedInput: false,
      lastGoodFrame: null,
      nextStrokeOnly: true,
    });
  });

  it("packs coalesced input into one transferable Float32 batch", () => {
    const packedBatch = packStudioHokusaiLiveSamples([
      { x: 10, y: 20, pressure: 0.2, tiltX: -45, tiltY: 90, timeMilliseconds: 10 },
      { x: 12, y: 23, pressure: 0.8, tiltX: 45, tiltY: -90, timeMilliseconds: 20 },
    ]);
    const samples = packedBatch.buffer;
    const message = snapshotStudioHokusaiLiveInboundMessage({
      type: "studio-hokusai-live/append",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: 1,
      engineEpoch: 1,
      strokeId: "stroke-1",
      sequence: 1,
      sampleCount: 2,
      sampleStride: STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE,
      samples,
    });
    expect(message?.type).toBe("studio-hokusai-live/append");
    if (message?.type !== "studio-hokusai-live/append") return;
    expect(studioHokusaiLiveInboundTransfers(message)).toEqual([samples]);
    const packed = Array.from(new Float32Array(samples));
    expect(packed).toHaveLength(12);
    expect(packed.slice(0, 2)).toEqual([10, 20]);
    expect(packed[2]).toBeCloseTo(0.2);
    expect(packed.slice(3, 8)).toEqual([-0.5, 1, 10, 12, 23]);
    expect(packed[8]).toBeCloseTo(0.8);
    expect(packed.slice(9)).toEqual([0.5, -1, 20]);
    expect(packedBatch.lastTimeMilliseconds).toBe(20);
  });

  it("fails closed when a material profile does not match its MYB carrier", () => {
    const route = resolveStudioHokusaiLiveRoute({
      ...routeInput(),
      brushId: "chalk",
      providerState: "ready",
      capabilities: CAPABILITIES,
    });
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    expect(route.config).toMatchObject({
      presetId: "charcoal",
      materialProfileId: "chalk",
    });
    const identity = {
      type: "studio-hokusai-live/begin",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: 1,
      engineEpoch: 1,
      strokeId: "chalk-profile-validation",
    } as const;
    expect(snapshotStudioHokusaiLiveInboundMessage({
      ...identity,
      config: route.config,
    })).not.toBeNull();
    expect(snapshotStudioHokusaiLiveInboundMessage({
      ...identity,
      config: { ...route.config, materialProfileId: "acrylic" },
    })).toBeNull();
  });

  it("closes a pending prewarm without letting its stale completion poison a restart", async () => {
    vi.useFakeTimers();
    const workers: FakeHokusaiLiveWorker[] = [];
    const provider = new StudioHokusaiLiveBrushProvider({
      workerFactory: () => {
        const worker = new FakeHokusaiLiveWorker();
        workers.push(worker);
        return worker;
      },
      startupTimeoutMs: 1_000,
    });

    const firstPrewarm = provider.prewarm();
    const firstOutcome = firstPrewarm.then(
      () => null,
      (cause: unknown) => cause,
    );
    const firstWorker = workers[0]!;
    const staleListeners = firstWorker.listenerSnapshot();
    expect(staleListeners.message).toHaveLength(1);
    expect(staleListeners.error).toHaveLength(1);
    expect(staleListeners.messageerror).toHaveLength(1);

    provider.close();

    const closedError = await firstOutcome;
    expect(closedError).toBeInstanceOf(Error);
    expect((closedError as Error).name).toBe("AbortError");
    expect(provider.state).toBe("idle");
    expect(provider.capabilities).toBeNull();
    expect(firstWorker.terminateCount).toBe(1);
    expect(firstWorker.listenerSnapshot()).toMatchObject({
      message: [],
      error: [],
      messageerror: [],
    });

    const secondPrewarm = provider.prewarm();
    const secondWorker = workers[1]!;
    secondWorker.ready();
    await expect(secondPrewarm).resolves.toEqual(CAPABILITIES);
    expect(provider.state).toBe("ready");
    expect(secondWorker.terminateCount).toBe(0);

    // Model a callback already copied into the browser's dispatch queue before removeEventListener,
    // then let the first attempt's old timeout deadline pass. Both paths must be generation-fenced.
    const lateReadyEvent = {
      data: {
        type: "studio-hokusai-live/ready",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        capabilities: CAPABILITIES,
      },
    } as MessageEvent<unknown>;
    for (const listener of staleListeners.message) listener(lateReadyEvent);
    for (const listener of staleListeners.error) {
      listener({ message: "late first-worker failure" } as ErrorEvent);
    }
    for (const listener of staleListeners.messageerror) listener(lateReadyEvent);
    await vi.advanceTimersByTimeAsync(1_001);

    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toEqual(CAPABILITIES);
    expect(firstWorker.terminateCount).toBe(1);
    expect(secondWorker.terminateCount).toBe(0);

    provider.close();
    provider.close();
    expect(provider.state).toBe("idle");
    expect(secondWorker.terminateCount).toBe(1);
    expect(secondWorker.listenerSnapshot()).toMatchObject({
      message: [],
      error: [],
      messageerror: [],
    });
  });

  it("owns one monotonic fallback clock across missing-time append batches", async () => {
    const worker = new FakeHokusaiLiveWorker();
    const provider = new StudioHokusaiLiveBrushProvider({
      workerFactory: () => worker,
      startupTimeoutMs: 1_000,
      finishTimeoutMs: 1_000,
    });
    const warming = provider.prewarm();
    worker.ready();
    await warming;
    const route = provider.admitStroke(routeInput());
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    const session = await provider.beginStroke(route, {
      strokeId: "missing-time-clock",
      signal: new AbortController().signal,
      onFrame: () => undefined,
    });
    session.append([
      { x: 720, y: 40_000, pressure: 0.4 },
      { x: 722, y: 40_002, pressure: 0.5 },
    ]);
    session.append([
      { x: 724, y: 40_004, pressure: 0.6 },
      { x: 726, y: 40_006, pressure: 0.7 },
    ]);
    const appendTimes = worker.sent
      .map(({ message }) => message as Partial<{
        type: string;
        samples: ArrayBuffer;
      }>)
      .filter((message) => message.type === "studio-hokusai-live/append")
      .map((message) => {
        const values = new Float32Array(message.samples!);
        return Array.from(
          { length: values.length / STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE },
          (_, index) => values[index * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE + 5],
        );
      });
    expect(appendTimes).toEqual([
      [0, STUDIO_HOKUSAI_LIVE_MIN_SAMPLE_INTERVAL_MS],
      [20, 30],
    ]);
    const firstAppend = worker.sent
      .map(({ message }) => message as Partial<{ type: string; samples: ArrayBuffer }>)
      .find((message) => message.type === "studio-hokusai-live/append");
    expect(new Float32Array(firstAppend!.samples!)[2]).toBe(0);
    provider.close();
  });

  it("repairs explicit duplicate and sub-tick timestamps without resetting between batches", () => {
    const first = packStudioHokusaiLiveSamples([
      { x: 10, y: 20, timeMilliseconds: 100 },
      { x: 12, y: 22, timeMilliseconds: 100 },
    ]);
    const second = packStudioHokusaiLiveSamples([
      { x: 14, y: 24, timeMilliseconds: 99 },
      { x: 16, y: 26 },
      { x: 18, y: 28, timeMilliseconds: 116 },
    ], first.lastTimeMilliseconds);
    const times = (batch: ArrayBuffer): number[] => {
      const values = new Float32Array(batch);
      return Array.from(
        { length: values.length / STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE },
        (_, index) => values[index * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE + 5]!,
      );
    };
    expect(times(first.buffer)).toEqual([100, 110]);
    expect(times(second.buffer)).toEqual([120, 130, 140]);
    expect(second.lastTimeMilliseconds).toBe(140);
  });

  it("prewarms before admission, transfers live dirty pixels and validates canonical parity", async () => {
    const worker = new FakeHokusaiLiveWorker();
    const provider = new StudioHokusaiLiveBrushProvider({
      workerFactory: () => worker,
      startupTimeoutMs: 1_000,
      finishTimeoutMs: 1_000,
    });
    expect(provider.admitStroke(routeInput())).toMatchObject({
      status: "unavailable",
      reason: "provider-loading",
      selectedBackendId: "hokusai-myb-worker",
      retainedInput: false,
      lastGoodFrame: null,
      nextStrokeOnly: true,
    });
    const warming = provider.prewarm();
    worker.ready();
    await warming;
    const route = provider.admitStroke(routeInput());
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    const frames: Uint8Array[] = [];
    const session = await provider.beginStroke(route, {
      strokeId: "live-stroke-1",
      signal: new AbortController().signal,
      onFrame: ({ pixels }) => frames.push(pixels),
    });
    session.append([
      { x: 720, y: 40_000, pressure: 0.4, timeMilliseconds: 1 },
      { x: 722, y: 40_002, pressure: 0.8, timeMilliseconds: 3 },
    ]);
    const completed = await session.finish();
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]!)).toEqual([12, 34, 56, 255]);
    expect(completed.receipt).toMatchObject({
      presetId: "charcoal",
      materialProfileId: "charcoal",
      exactLiveCommitParity: true,
      materialTexture: "studio-hokusai-material-texture-v2",
      endpointPolicy: "tapered-start-no-dab-carrier-v1",
      colorOpacityApplication: "worker-once-before-material-transfer-v1",
      canonicalAuthority: "settled-png-receipt-v1",
      undoAuthority: "single-stroke-transaction-v1",
      saveAuthority: "canonical-png-plus-versioned-receipt-v1",
      segmentCount: 1,
    });
    const append = worker.sent.find(({ message }) => (
      (message as { type?: string }).type === "studio-hokusai-live/append"
    ));
    expect(append?.transfer).toHaveLength(1);
    expect(worker.sent.some(({ message }) => (
      (message as { type?: string }).type === "studio-hokusai-live/frame-ack"
    ))).toBe(true);
    provider.close();
  });

  it("finishes a single-contact stroke after an accepted no-dirty prefix", async () => {
    const worker = new FakeHokusaiLiveWorker({
      acceptFirstAppendWithoutFrame: true,
    });
    const provider = new StudioHokusaiLiveBrushProvider({
      workerFactory: () => worker,
      startupTimeoutMs: 1_000,
      finishTimeoutMs: 50,
    });
    const warming = provider.prewarm();
    worker.ready();
    await warming;
    const route = provider.admitStroke(routeInput());
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    const session = await provider.beginStroke(route, {
      strokeId: "single-contact",
      signal: new AbortController().signal,
      onFrame: () => undefined,
    });
    expect(session.append([
      { x: 720, y: 40_000, pressure: 0.4, timeMilliseconds: 1 },
    ])).toBe(1);

    const completed = await session.finish();

    expect(completed.receipt).toMatchObject({
      finalSequence: 1,
      sampleCount: 2,
      exactLiveCommitParity: true,
    });
    expect(worker.sent.some(({ message }) => (
      (message as { type?: string }).type === "studio-hokusai-live/finish"
    ))).toBe(true);
    provider.close();
  });

  it("waits for a pointer-up endpoint append to be presented before canonical finish", async () => {
    const worker = new FakeHokusaiLiveWorker();
    const provider = new StudioHokusaiLiveBrushProvider({
      workerFactory: () => worker,
      startupTimeoutMs: 1_000,
      finishTimeoutMs: 1_000,
    });
    const warming = provider.prewarm();
    worker.ready();
    await warming;
    const route = provider.admitStroke(routeInput());
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;
    let resolveFirstFrame: (() => void) | null = null;
    const firstFrame = new Promise<void>((resolve) => {
      resolveFirstFrame = resolve;
    });
    const session = await provider.beginStroke(route, {
      strokeId: "release-endpoint",
      signal: new AbortController().signal,
      onFrame: ({ sequence }) => {
        if (sequence === 1) resolveFirstFrame?.();
      },
    });
    expect(session.append([
      { x: 720, y: 40_000, pressure: 0.4, timeMilliseconds: 1 },
      { x: 722, y: 40_002, pressure: 0.6, timeMilliseconds: 11 },
    ])).toBe(1);
    await firstFrame;

    expect(session.append([
      { x: 724, y: 40_004, pressure: 0.8, timeMilliseconds: 21 },
    ])).toBe(2);
    const completedPromise = session.finish();
    expect(worker.sent.some(({ message }) => (
      (message as { type?: string }).type === "studio-hokusai-live/finish"
    ))).toBe(false);

    const completed = await completedPromise;
    expect(completed.receipt.finalSequence).toBe(2);
    const finish = worker.sent.find(({ message }) => (
      (message as { type?: string }).type === "studio-hokusai-live/finish"
    ))?.message as { finalSequence?: number } | undefined;
    expect(finish?.finalSequence).toBe(2);
    provider.close();
  });

  it("streams incremental dirty deltas and reads one full frame only at canonical finish", () => {
    const source = readFileSync(
      new URL("./studio-hokusai-live-brush.worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("frameInFlight");
    expect(source).toContain("pendingPresentationSequence");
    expect(source).toContain("Input is never dropped");
    expect(source).toContain('presentation: "no-dirty-pixels"');
    expect(source).not.toContain(
      'throw new Error("Hokusai produced no dirty pixels for the accepted input batch.")',
    );
    expect(source).toContain("await emitLiveFrame(stroke, pending)");
    expect(source).toContain("pixels.slice()");
    expect(source).toContain("canvas.dirtyFrame()");
    expect(source).toContain("stroke.canvas.clearDirty()");
    expect(source).toContain("writePackedPatch(stroke.retainedPixels");
    expect(source).toContain("writePackedPatch(\n    stroke.rawRetainedPixels");
    expect(source).toContain("applyStudioHokusaiNaturalMediaTextureV2");
    expect(source).not.toContain("applyTaperedStart");
    expect(source.match(/stroke\.canvas\.fullFrame\(\)/gu)).toHaveLength(1);
    expect(source).toContain("raw acknowledged patch composition differs");
    expect(source).toContain('"settle-tail"');
    expect(source).not.toContain("document.");
    expect(source).not.toContain("window.");
  });
});
