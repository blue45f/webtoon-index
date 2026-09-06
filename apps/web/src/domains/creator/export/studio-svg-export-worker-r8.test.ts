// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
} from "../brush/studio-brush-dynamics";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
  resolveStudioBrushR8GrainSampler,
  studioBrushR8GrainRegistryStats,
} from "../brush/studio-brush-r8-grain-runtime";
import { sha256HexPortable } from "../studio-sha256";

import { exportPageToSvg } from "./studio-svg-export";
import {
  disposeStudioSvgExportPrewarmedWorker,
  prepareStudioSvgExportWorkerR8Transfer,
  preloadStudioSvgExportWorker,
  runStudioSvgExportWorker,
  type StudioSvgExportWorkerLike,
} from "./studio-svg-export-worker-client";
import {
  collectStudioSvgExportReferencedR8GrainSources,
  STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
  type StudioSvgExportWorkerResponseMessage,
  type StudioSvgExportWorkerRunMessage,
} from "./studio-svg-export-worker-protocol";

import type {
  SvgDrawElLike,
  SvgExportPageInput,
  SvgExportResult,
} from "./studio-svg-export";
import type { StudioBrushR8TextureGrainSource } from "../brush/studio-brush-r8-grain-asset-contract";

const decodedBytes = new Uint8Array([
  0, 64,
  192, 255,
]);

function r8Source(assetId = "paper.worker-r8.v1"): StudioBrushR8TextureGrainSource {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId,
      encodedSha256: `sha256:${"e".repeat(64)}`,
      decodedSha256: `sha256:${sha256HexPortable(decodedBytes)}`,
      byteLength: 128,
      mediaType: "image/png",
      width: 2,
      height: 2,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

function r8ExportInput(
  source = r8Source(),
  duplicate = false,
): SvgExportPageInput {
  const draw = (id: string) => ({
    id,
    type: "draw" as const,
    kind: "freehand" as const,
    mode: "pen" as const,
    brush: "dry-media",
    points: [8, 16, 26, 18, 48, 12],
    pressures: [0.4, 0.8, 0.6],
    stroke: "#263a54",
    strokeWidth: 12,
    opacity: 1,
    brushDynamics: normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      seed: 77,
      grain: {
        amount: 0.8,
        scale: 12,
        contrast: 0.45,
        source,
      },
      spacingRatio: 0.2,
      spacing: { base: 2.4 },
    }),
  });
  return {
    width: 64,
    height: 40,
    transparentBg: true,
    elements: duplicate ? [draw("r8-a"), draw("r8-b")] : [draw("r8-a")],
  };
}

function largeR8ExportInput(source = r8Source()): SvgExportPageInput {
  return {
    width: 80,
    height: 32,
    transparentBg: true,
    elements: [{
      id: "r8-large-streaming",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: "dry-media",
      points: [0, 16, 64, 16],
      pressures: [0.7, 0.7],
      stroke: "#263a54",
      strokeWidth: 16,
      opacity: 1,
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
        seed: 77,
        width: { base: 16, mappings: [] },
        opacity: { base: 0.8, mappings: [] },
        flow: { base: 0.7, mappings: [] },
        spacingRatio: null,
        spacing: { base: 1, mappings: [] },
        scatterRatio: null,
        scatter: { base: 0, mappings: [] },
        roundness: { base: 1, mappings: [] },
        taper: { enabled: false },
        tip: {
          shape: "hard",
          softness: 0,
          alphaMapSize: 256,
        },
        grain: {
          amount: 0.8,
          scale: 12,
          contrast: 0.45,
          source,
        },
        tipLayers: [],
        dualBrush: { enabled: false },
      }),
    }],
  };
}

const successResult: SvgExportResult = {
  svg: "<svg/>",
  skipped: [],
  fontFamilies: [],
  caveats: [],
  elementCount: 1,
};

function workerRunEvent(
  data: StudioSvgExportWorkerRunMessage,
): MessageEvent<StudioSvgExportWorkerRunMessage> {
  return { data } as unknown as MessageEvent<StudioSvgExportWorkerRunMessage>;
}

class ReadySvgWorker implements StudioSvgExportWorkerLike {
  onmessage: StudioSvgExportWorkerLike["onmessage"] = null;
  onerror: StudioSvgExportWorkerLike["onerror"] = null;
  posted: StudioSvgExportWorkerRunMessage | null = null;
  transferred: ArrayBuffer[] = [];
  bytesSeenDuringPost: number[] = [];
  terminated = false;

  constructor(private readonly throwOnPost = false) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-svg-export/ready",
          version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
        },
      } as MessageEvent<StudioSvgExportWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioSvgExportWorkerRunMessage, transfer: ArrayBuffer[]): void {
    this.posted = message;
    this.transferred = transfer;
    this.bytesSeenDuringPost = message.r8GrainAssets.flatMap((entry) => [...entry.decodedBytes]);
    if (this.throwOnPost) throw new Error("postMessage blocked");
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-svg-export/success",
          version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
          result: successResult,
        },
      } as MessageEvent<StudioSvgExportWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

class HangingSvgWorker implements StudioSvgExportWorkerLike {
  onmessage: StudioSvgExportWorkerLike["onmessage"] = null;
  onerror: StudioSvgExportWorkerLike["onerror"] = null;
  posted: StudioSvgExportWorkerRunMessage | null = null;
  terminated = false;

  constructor(private readonly responseAfterPost?: unknown) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-svg-export/ready",
          version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
        },
      } as MessageEvent<StudioSvgExportWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioSvgExportWorkerRunMessage): void {
    this.posted = message;
    if (this.responseAfterPost === undefined) return;
    queueMicrotask(() => {
      this.onmessage?.({ data: this.responseAfterPost } as MessageEvent<
        StudioSvgExportWorkerResponseMessage
      >);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("SVG export Worker R8 transfer protocol", () => {
  afterEach(() => {
    disposeStudioSvgExportPrewarmedWorker();
    resetStudioBrushR8GrainRegistry();
  });

  it("warms without document data and hands the ready Worker to the first production run", async () => {
    const worker = new ReadySvgWorker();

    expect(preloadStudioSvgExportWorker(() => worker)).toBe(true);
    expect(worker.posted).toBeNull();
    await Promise.resolve();

    const result = await runStudioSvgExportWorker({
      width: 32,
      height: 24,
      transparentBg: true,
      elements: [],
    });

    expect(result.execution).toBe("worker");
    expect(worker.posted?.input).toMatchObject({ width: 32, height: 24 });
    expect(worker.terminated).toBe(true);
  });

  it("terminates an unused prewarmed Worker when its intent lease expires", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ReadySvgWorker();

      expect(preloadStudioSvgExportWorker(() => worker)).toBe(true);
      await Promise.resolve();
      expect(worker.posted).toBeNull();
      expect(worker.terminated).toBe(false);

      await vi.advanceTimersByTimeAsync(45_000);
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a prewarmed Worker that never completes its ready handshake", async () => {
    vi.useFakeTimers();
    try {
      const terminateFirst = vi.fn();
      const first: StudioSvgExportWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: terminateFirst,
      };

      expect(preloadStudioSvgExportWorker(() => first)).toBe(true);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(terminateFirst).toHaveBeenCalledOnce();

      const replacement = new ReadySvgWorker();
      expect(preloadStudioSvgExportWorker(() => replacement)).toBe(true);
      await Promise.resolve();
      expect(replacement.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews an existing prewarmed Worker lease on repeated intent", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ReadySvgWorker();

      expect(preloadStudioSvgExportWorker(() => worker)).toBe(true);
      await vi.advanceTimersByTimeAsync(44_000);
      expect(preloadStudioSvgExportWorker(() => worker)).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(worker.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(44_000);
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates and zeroizes a posted transfer when the Worker run times out", async () => {
    vi.useFakeTimers();
    try {
      const source = r8Source();
      expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
      const worker = new HangingSvgWorker();
      const pending = runStudioSvgExportWorker(r8ExportInput(source), {
        workerFactory: () => worker,
        runTimeoutMs: 100,
      });
      await Promise.resolve();
      expect(worker.posted).not.toBeNull();
      const rejection = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(100);
      await expect(rejection).resolves.toMatchObject({
        message: expect.stringContaining("계산 시간이 초과되었습니다"),
      });
      expect(worker.terminated).toBe(true);
      expect([...worker.posted!.r8GrainAssets[0]!.decodedBytes]).toEqual([0, 0, 0, 0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Worker absence and factory construction failure terminal", async () => {
    const input: SvgExportPageInput = {
      width: 32,
      height: 24,
      transparentBg: true,
      elements: [],
    };

    await expect(runStudioSvgExportWorker(input, {
      workerFactory: null,
    })).rejects.toThrow("Worker를 사용할 수 없습니다");
    await expect(runStudioSvgExportWorker(input, {
      workerFactory: () => {
        throw new Error("CSP blocked Worker");
      },
    })).rejects.toThrow("Worker를 생성하지 못했습니다");
  });

  it("keeps Worker ready timeout and pre-ready error terminal", async () => {
    vi.useFakeTimers();
    try {
      const terminateTimedOut = vi.fn();
      const neverReady: StudioSvgExportWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: terminateTimedOut,
      };
      const pending = runStudioSvgExportWorker({
        width: 32,
        height: 24,
        transparentBg: true,
        elements: [],
      }, { workerFactory: () => neverReady });
      const rejection = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(rejection).resolves.toMatchObject({
        message: expect.stringContaining("준비 시간이 초과되었습니다"),
      });
      expect(terminateTimedOut).toHaveBeenCalledOnce();
      expect(neverReady.postMessage).not.toHaveBeenCalled();

      const terminateErrored = vi.fn();
      const errorsBeforeReady: StudioSvgExportWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: terminateErrored,
      };
      const errored = runStudioSvgExportWorker({
        width: 32,
        height: 24,
        transparentBg: true,
        elements: [],
      }, { workerFactory: () => errorsBeforeReady });
      errorsBeforeReady.onerror?.({ message: "startup failed", preventDefault: vi.fn() });
      await expect(errored).rejects.toThrow("startup failed");
      expect(terminateErrored).toHaveBeenCalledOnce();
      expect(errorsBeforeReady.postMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs direct serialization only when that backend is selected before work", async () => {
    const workerFactory = vi.fn();
    const result = await runStudioSvgExportWorker({
      width: 32,
      height: 24,
      transparentBg: true,
      elements: [],
    }, {
      executionBackend: "direct",
      workerFactory,
    });

    expect(result.execution).toBe("direct");
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("rejects a malformed runtime response instead of leaving the export pending", async () => {
    const worker = new HangingSvgWorker(null);

    await expect(runStudioSvgExportWorker({
      width: 32,
      height: 24,
      transparentBg: true,
      elements: [],
    }, { workerFactory: () => worker })).rejects.toThrow("알 수 없는 응답");
    expect(worker.terminated).toBe(true);
  });

  it("collects only canonical draw references and deduplicates identical sources", () => {
    const source = r8Source();
    const input = r8ExportInput(source, true);
    let accessorRead = false;
    const poisonedDynamics = Object.defineProperty({}, "grain", {
      enumerable: true,
      get: () => {
        accessorRead = true;
        return { source };
      },
    });
    const sources = collectStudioSvgExportReferencedR8GrainSources({
      ...input,
      elements: [
        ...input.elements,
        {
          id: "not-a-draw",
          type: "image",
          src: "",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          brushDynamics: { grain: { source } },
        } as never,
        {
          id: "poisoned",
          type: "draw",
          points: [0, 0, 1, 1],
          stroke: "#000000",
          strokeWidth: 1,
          brushDynamics: poisonedDynamics,
        } as never,
      ],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.source.asset.assetId).toBe(source.asset.assetId);
    expect(accessorRead).toBe(false);
  });

  it("does not transfer R8 authority for invisible, erasing, or disabled grain", () => {
    const drawElement = (source: StudioBrushR8TextureGrainSource): SvgDrawElLike =>
      r8ExportInput(source).elements[0] as SvgDrawElLike;
    const activeSource = r8Source("paper.active.v1");
    const active = drawElement(activeSource);
    const hidden = drawElement(r8Source("paper.hidden.v1"));
    const groupHidden = drawElement(r8Source("paper.group-hidden.v1"));
    const eraser = drawElement(r8Source("paper.eraser.v1"));
    const disabled = drawElement(r8Source("paper.disabled.v1"));
    const disabledDynamics = normalizeStudioBrushDynamicsSettings({
      ...disabled.brushDynamics,
      grain: {
        ...disabled.brushDynamics?.grain,
        amount: 0,
      },
    });

    const sources = collectStudioSvgExportReferencedR8GrainSources({
      ...r8ExportInput(activeSource),
      groups: [{ id: "hidden-group", name: "Hidden", hidden: true }],
      elements: [
        active,
        { ...hidden, id: "hidden", hidden: true },
        { ...groupHidden, id: "group-hidden", groupId: "hidden-group" },
        { ...eraser, id: "eraser", mode: "eraser" },
        { ...disabled, id: "disabled", brushDynamics: disabledDynamics },
      ],
    });

    expect(sources.map(({ source }) => source.asset.assetId)).toEqual([
      activeSource.asset.assetId,
    ]);
  });

  it("copies only referenced verified bytes and posts their exact private buffers", async () => {
    const source = r8Source();
    const unrelated = r8Source("paper.unrelated.v1");
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
    expect(hydrateStudioBrushR8GrainAsset(unrelated, decodedBytes).status).toBe("ready");
    const input = r8ExportInput(source, true);
    const prepared = prepareStudioSvgExportWorkerR8Transfer(input);

    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0]?.decodedBytes).not.toBe(decodedBytes);
    expect([...prepared.entries[0]!.decodedBytes]).toEqual([...decodedBytes]);
    expect(prepared.buffers).toEqual([prepared.entries[0]!.decodedBytes.buffer]);

    const worker = new ReadySvgWorker();
    const result = await runStudioSvgExportWorker(input, { workerFactory: () => worker });

    expect(result).toEqual({ execution: "worker", result: successResult });
    expect(worker.posted?.r8GrainAssets).toHaveLength(1);
    expect(worker.transferred).toEqual([worker.posted!.r8GrainAssets[0]!.decodedBytes.buffer]);
    expect(worker.bytesSeenDuringPost).toEqual([...decodedBytes]);
    expect(worker.terminated).toBe(true);
    // The fake does not detach like a real Worker, so cleanup must explicitly zero this private copy.
    expect([...worker.posted!.r8GrainAssets[0]!.decodedBytes]).toEqual([0, 0, 0, 0]);
    // Transfer cleanup must never clear or release the authoritative main-realm registry entry.
    expect(resolveStudioBrushR8GrainSampler(source)).not.toBeNull();
    expect(resolveStudioBrushR8GrainSampler(unrelated)).not.toBeNull();
  });

  it("keeps postMessage failure terminal without rerunning direct export", async () => {
    const source = r8Source();
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
    const worker = new ReadySvgWorker(true);

    await expect(runStudioSvgExportWorker(r8ExportInput(source), {
      workerFactory: () => worker,
    })).rejects.toThrow("요청을 전달하지 못했습니다");

    expect(resolveStudioBrushR8GrainSampler(source)).not.toBeNull();
    expect(worker.terminated).toBe(true);
    expect([...worker.posted!.r8GrainAssets[0]!.decodedBytes]).toEqual([0, 0, 0, 0]);
  });

  it("exports a product-path stroke beyond the former retained-Float32 ceiling", () => {
    const source = r8Source();
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");

    const result = exportPageToSvg(largeR8ExportInput(source));
    const alphaMapUses = (
      result.svg.match(/data-brush-coverage="alpha-map"/gu) ?? []
    ).length;
    const embeddedAssets = (
      result.svg.match(/data-brush-tip-asset="full-alpha-map-v1"/gu) ?? []
    ).length;

    // A 256² Float32 map is 256 KiB, so mark 65 is the first one rejected by the former
    // 16 MiB retained-map bridge. The SVG-only path encodes each verified map immediately.
    expect(alphaMapUses).toBeGreaterThan(64);
    expect(embeddedAssets).toBe(alphaMapUses);
    expect(result.skipped).toEqual([]);
    expect(result.svg).not.toContain(source.asset.assetId);
  }, 30_000);

  it("enforces the streamed R8 mask ceiling across the whole SVG document", () => {
    const source = r8Source();
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
    const single = largeR8ExportInput(source);
    const baseElement = single.elements[0]!;
    const input: SvgExportPageInput = {
      ...single,
      elements: Array.from({ length: 4 }, (_, index) => ({
        ...baseElement,
        id: `r8-document-${index + 1}`,
      })),
    };

    const result = exportPageToSvg(input);
    const alphaMapUses = (
      result.svg.match(/data-brush-coverage="alpha-map"/gu) ?? []
    ).length;

    // Each fixture stroke represents just over 16 MiB of 256² RGBA masks and roughly 45 MiB of
    // worst-case UTF-16 base64 definitions. One fits; retaining the second would exceed the
    // document-wide serialized-memory ceiling even though every stroke is valid in isolation.
    expect(alphaMapUses).toBeGreaterThan(64);
    expect(alphaMapUses).toBeLessThanOrEqual(64 * 2);
    expect(result.skipped).toContainEqual(expect.objectContaining({
      id: "r8-document-2",
      mode: "skipped",
    }));
    expect(result.skipped).toContainEqual(expect.objectContaining({
      id: "r8-document-4",
      mode: "skipped",
    }));
  }, 60_000);
});

describe("short-lived SVG export Worker R8 hydration", () => {
  const originalPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const originalOnMessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const responses: StudioSvgExportWorkerResponseMessage[] = [];
  let workerHandler:
    | ((event: MessageEvent<StudioSvgExportWorkerRunMessage>) => Promise<void>)
    | null = null;

  beforeAll(async () => {
    Object.defineProperty(globalThis, "postMessage", {
      configurable: true,
      writable: true,
      value: (message: StudioSvgExportWorkerResponseMessage) => {
        responses.push(message);
      },
    });
    await import("./studio-svg-export.worker");
    workerHandler = globalThis.onmessage as typeof workerHandler;
    responses.length = 0; // discard module ready
  });

  afterAll(() => {
    if (originalPostMessage) {
      Object.defineProperty(globalThis, "postMessage", originalPostMessage);
    } else {
      Reflect.deleteProperty(globalThis, "postMessage");
    }
    if (originalOnMessage) {
      Object.defineProperty(globalThis, "onmessage", originalOnMessage);
    } else {
      Reflect.deleteProperty(globalThis, "onmessage");
    }
  });

  afterEach(() => {
    responses.length = 0;
    resetStudioBrushR8GrainRegistry();
  });

  it("hydrates a referenced verified snapshot, exports, then resets and zeroizes", async () => {
    const source = r8Source();
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
    const input = r8ExportInput(source);
    const transfer = prepareStudioSvgExportWorkerR8Transfer(input);
    expect(transfer.entries).toHaveLength(1);

    await workerHandler?.(workerRunEvent({
        type: "studio-svg-export/run",
        version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
        input,
        r8GrainAssets: transfer.entries,
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]?.type).toBe("studio-svg-export/success");
    if (responses[0]?.type === "studio-svg-export/success") {
      expect(responses[0].result.skipped).toEqual([]);
      expect(responses[0].result.svg)
        .toContain('data-brush-coverage="alpha-map"');
    }
    expect([...transfer.entries[0]!.decodedBytes]).toEqual([0, 0, 0, 0]);
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it("preserves the existing fail-closed caveat for a missing R8 snapshot", async () => {
    const input = r8ExportInput();
    await workerHandler?.(workerRunEvent({
        type: "studio-svg-export/run",
        version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
        input,
        r8GrainAssets: [],
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]?.type).toBe("studio-svg-export/success");
    if (responses[0]?.type === "studio-svg-export/success") {
      expect(responses[0].result.skipped).toHaveLength(1);
      expect(responses[0].result.svg).not.toContain("r8-a");
    }
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it("rejects modified decoded bytes without retaining or substituting them", async () => {
    const source = r8Source();
    const input = r8ExportInput(source);
    const modified = new Uint8Array(decodedBytes).fill(7);
    const sourceKey = collectStudioSvgExportReferencedR8GrainSources(input)[0]!.sourceKey;
    await workerHandler?.(workerRunEvent({
        type: "studio-svg-export/run",
        version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
        input,
        r8GrainAssets: [{ sourceKey, source, decodedBytes: modified }],
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]?.type).toBe("studio-svg-export/success");
    if (responses[0]?.type === "studio-svg-export/success") {
      expect(responses[0].result.skipped).toHaveLength(1);
    }
    expect([...modified]).toEqual([0, 0, 0, 0]);
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it("fails the whole hydration envelope closed above the entry ceiling", async () => {
    const source = r8Source();
    const input = r8ExportInput(source);
    const sourceKey = collectStudioSvgExportReferencedR8GrainSources(input)[0]!.sourceKey;
    const overBudgetEntries = Array.from({ length: 33 }, () => ({
      sourceKey,
      source,
      decodedBytes: new Uint8Array(decodedBytes),
    }));

    await workerHandler?.(workerRunEvent({
      type: "studio-svg-export/run",
      version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
      input,
      r8GrainAssets: overBudgetEntries,
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]?.type).toBe("studio-svg-export/success");
    if (responses[0]?.type === "studio-svg-export/success") {
      expect(responses[0].result.skipped).toHaveLength(1);
    }
    expect(overBudgetEntries.every(
      (entry) => entry.decodedBytes.every((value) => value === 0),
    )).toBe(true);
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it("zeroizes transferred R8 bytes when a stale protocol version is rejected", async () => {
    const source = r8Source();
    expect(hydrateStudioBrushR8GrainAsset(source, decodedBytes).status).toBe("ready");
    const input = r8ExportInput(source);
    const transfer = prepareStudioSvgExportWorkerR8Transfer(input);
    expect(transfer.entries).toHaveLength(1);

    await workerHandler?.({
      data: {
        type: "studio-svg-export/run",
        version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION + 1,
        input,
        r8GrainAssets: transfer.entries,
      },
    } as unknown as MessageEvent<StudioSvgExportWorkerRunMessage>);

    expect(responses).toEqual([]);
    expect([...transfer.entries[0]!.decodedBytes]).toEqual([0, 0, 0, 0]);
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});
