import { describe, expect, it, vi } from "vitest";

import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
} from "../studio-canonical-brush-webgpu-lowering";

import {
  StudioEngineFutureBrushController,
  type StudioEngineFutureBrushGpuBoundary,
  type StudioEngineFutureBrushSubmission,
  type StudioEngineFutureBrushTileBoundary,
} from "./studio-engine-future-brush-controller";
import {
  createStudioEngineVNextBrushProviderGpuCompletion,
  StudioEngineVNextBrushProviderGpuBoundaryAdapter,
  type StudioEngineVNextBrushProviderGpuExecutionBoundary,
} from "./studio-engine-vnext-brush-provider-gpu-boundary";
import {
  StudioEngineVNextBrushProviderRouter,
  type StudioEngineVNextBrushProviderCapability,
  type StudioEngineVNextBrushProviderDescriptor,
  type StudioEngineVNextBrushProviderExecution,
} from "./studio-engine-vnext-brush-provider-router";
import {
  adaptLoweredStudioCanonicalBrushWebGpuDabs,
  fingerprintStudioEngineWebGpuBrushPlan,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
} from "./studio-engine-webgpu-brush-runtime";

import type { StudioCanonicalBrushPlan } from "../studio-canonical-brush-plan";
import type {
  StudioEngineTileCommitReceipt,
  StudioEngineTileCommitResult,
} from "./studio-engine-tile-authority";
import type {
  StudioEngineWebGpuBrushExecutionResult,
  StudioEngineWebGpuBrushFrame,
} from "./studio-engine-webgpu-brush-runtime";

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function proceduralGrain() {
  return {
    kind: "procedural-noise",
    assetId: null,
    contentHash: null,
    space: "document",
    scale: 1,
    depth: 0.5,
    contrast: 1,
    seed: 1,
  };
}

function canonicalPlan(
  commandSequence = 1,
  options: {
    readonly role?: "authoritative" | "predicted";
    readonly grain?: unknown;
  } = {},
): Record<string, unknown> {
  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `stroke-${commandSequence}`,
    seed: 0x1234_5678,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.25, 0.5, 0.75, 0.8],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 0.9,
    },
    recipe: {
      version: 1,
      brushId: "future-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: {
        kind: "analytic",
        shape: "ellipse",
        edgeSoftness: 0.15,
      },
      size: 12,
      flow: 0.8,
      hardness: 0.85,
      spacingRatio: 0.25,
      scatter: {
        radiusRatio: 0.03,
        distribution: "uniform-disk",
      },
      angleRadians: 0.2,
      roundness: 0.7,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: options.grain ?? null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          role: options.role ?? "authoritative",
          sequence: 1,
          x: 2,
          y: 4,
          pressure: 0.5,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          role: "authoritative",
          sequence: 2,
          x: 18,
          y: 14,
          pressure: 0.8,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
  return candidate;
}

function submission(
  commandSequence = 1,
  overrides: Partial<StudioEngineFutureBrushSubmission> = {},
): StudioEngineFutureBrushSubmission {
  return {
    mode: "rebuild",
    resizeEpoch: 3,
    deviceEpoch: 5,
    rasterRect: { x: 0, y: 0, width: 64, height: 64 },
    layerId: "line-art",
    baseDocumentRevision: commandSequence - 1,
    baseLayerRevision: commandSequence - 1,
    dirtyRects: [{ x: 0, y: 0, width: 32, height: 32 }],
    brushPlan: canonicalPlan(commandSequence),
    ...overrides,
  };
}

function gpuPresented(
  frame: StudioEngineWebGpuBrushFrame,
  deviceEpoch = 5,
): StudioEngineWebGpuBrushExecutionResult {
  return {
    status: "presented",
    receipt: Object.freeze({
      kind: "studio-engine-webgpu-brush-receipt",
      revision: STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
      backend: "webgpu",
      requestSequence: frame.requestSequence,
      resizeEpoch: frame.resizeEpoch,
      deviceEpoch,
      width: 64,
      height: 64,
      textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
      colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
      workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
      inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
      presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
      mode: frame.update.mode,
      strokeId: frame.update.strokeId,
      loweringVersion: frame.update.loweringVersion,
      dabCount: frame.update.dabs.length,
      batchCount: frame.update.batches.length,
      batchOrder: Object.freeze(
        frame.update.batches.map((batch) => batch.composite.porterDuff),
      ),
      planFingerprint: fingerprintStudioEngineWebGpuBrushPlan(frame),
      queueState: "submitted",
      complete: true,
    }),
  };
}

function tileReceipt(commandSequence: number): StudioEngineTileCommitReceipt {
  return Object.freeze({
    kind: "studio-engine-tile-commit-receipt",
    version: 1,
    encoding: "linear-rgba16float-le-v1",
    documentId: "future-document",
    commandIdentity: `command-${commandSequence}`,
    commandSequence,
    baseDocumentRevision: commandSequence - 1,
    documentRevision: commandSequence,
    layerId: "line-art",
    baseLayerRevision: commandSequence - 1,
    layerRevision: commandSequence,
    tiles: Object.freeze([Object.freeze({
      tileId: "0:0",
      column: 0,
      row: 0,
      layerId: "line-art",
      layerIndex: 0,
      logicalTileIndex: BigInt(0),
      logicalByteOffset: BigInt(0),
      shardIndex: BigInt(0),
      shardByteOffset: BigInt(0),
      baseTileRevision: commandSequence - 1,
      tileRevision: commandSequence,
      contentDigest: `tile-${commandSequence}`,
      byteLength: 512,
    })]),
    journalSequence: commandSequence,
    journalDigest: `journal-${commandSequence}`,
    journalByteLength: 256,
    journalLogicalByteOffset: BigInt((commandSequence - 1) * 256),
  });
}

function committedTile(commandSequence: number): StudioEngineTileCommitResult {
  return {
    status: "committed",
    receipt: tileReceipt(commandSequence),
    journalBytes: new Uint8Array([commandSequence]),
  };
}

function controller(options: {
  readonly webGpu?: StudioEngineFutureBrushGpuBoundary;
  readonly specialistGpu?: StudioEngineVNextBrushProviderGpuExecutionBoundary;
  readonly tileAuthority?: StudioEngineFutureBrushTileBoundary;
  readonly lower?: typeof lowerStudioCanonicalBrushPlanToWebGpuDabs;
}) {
  return new StudioEngineFutureBrushController({
    sessionEpoch: 7,
    strokeEpoch: 11,
    resizeEpoch: 3,
    deviceEpoch: 5,
    webGpu: options.webGpu ?? {
      execute: (frame) => gpuPresented(frame),
    },
    specialistGpu: options.specialistGpu,
    tileAuthority: options.tileAuthority ?? {
      commit: (input) => committedTile(
        (input.brushPlan as { commandSequence: number }).commandSequence,
      ),
    },
    lower: options.lower,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const GRAIN_SPECIALIST_CAPABILITIES = [
  "tip:analytic",
  "grain:procedural",
  "media:dry",
  "color:linear-srgb",
  "porter-duff:source-over",
  "blend:normal",
  "intent:professional",
] as const satisfies readonly StudioEngineVNextBrushProviderCapability[];

function specialistBoundary(options: Readonly<{
  beforeComplete?: (
    execution: StudioEngineVNextBrushProviderExecution,
    signal: AbortSignal,
  ) => Promise<void> | void;
  forgeProof?: boolean;
}> = {}) {
  const descriptor: StudioEngineVNextBrushProviderDescriptor = Object.freeze({
    id: "future-grain-provider",
    version: 2,
    priority: 100,
    capabilities: GRAIN_SPECIALIST_CAPABILITIES,
  });
  const executions: StudioEngineVNextBrushProviderExecution[] = [];
  const execute = vi.fn(async (
    execution: StudioEngineVNextBrushProviderExecution,
    signal: AbortSignal,
  ) => {
    executions.push(execution);
    await options.beforeComplete?.(execution, signal);
    const completed = createStudioEngineVNextBrushProviderGpuCompletion(
      descriptor,
      execution,
      {
        executionDigest: `future:gpu:${execution.globalRequestSequence}`,
        width: 64,
        height: 64,
        loweringVersion: 9,
        dabCount: 2,
        batchCount: 1,
        batchOrder: [execution.canonicalPlan.composite.porterDuff],
      },
    );
    return options.forgeProof
      ? {
        ...completed,
        proof: {
          ...completed.proof,
          providerLocalSequence: 999,
        },
      }
      : completed;
  });
  const notifyDeviceLoss = vi.fn();
  const router = new StudioEngineVNextBrushProviderRouter({
    sessionEpoch: 7,
    deviceEpoch: 5,
    resizeEpoch: 3,
    providers: [{
      descriptor,
      execute,
      notifyDeviceLoss,
      dispose: vi.fn(),
    }],
  });
  return {
    boundary: new StudioEngineVNextBrushProviderGpuBoundaryAdapter(router),
    execute,
    executions,
    notifyDeviceLoss,
  };
}

describe("StudioEngineFutureBrushController", () => {
  it("orders rich lowering, exact WebGPU submission, then authoritative tile commit", async () => {
    const events: string[] = [];
    let adaptedPlan: unknown;
    let gpuPlan: unknown;
    let authorityPlan: unknown;
    const lower = vi.fn((plan: StudioCanonicalBrushPlan) => {
      events.push("lower");
      return lowerStudioCanonicalBrushPlanToWebGpuDabs(plan);
    });
    const adapt = vi.fn((mode, lowering, maximumDabs) => {
      events.push("adapt");
      const result = adaptLoweredStudioCanonicalBrushWebGpuDabs(
        mode,
        lowering,
        maximumDabs,
      );
      if (result.status === "ready") adaptedPlan = result.plan;
      return result;
    });
    const target = new StudioEngineFutureBrushController({
      sessionEpoch: 7,
      strokeEpoch: 11,
      resizeEpoch: 3,
      deviceEpoch: 5,
      lower,
      adapt,
      webGpu: {
        execute: (frame) => {
          events.push("gpu");
          gpuPlan = frame.update;
          return gpuPresented(frame);
        },
      },
      tileAuthority: {
        commit: (input) => {
          events.push("tile");
          authorityPlan = input.brushPlan;
          return committedTile(
            (input.brushPlan as { commandSequence: number }).commandSequence,
          );
        },
      },
    });
    const input = submission();

    const result = await target.submit(input);

    expect(events).toEqual(["lower", "adapt", "gpu", "tile"]);
    expect(lower).toHaveBeenCalledTimes(1);
    expect(adapt).toHaveBeenCalledTimes(1);
    expect(gpuPlan).toBe(adaptedPlan);
    expect(authorityPlan).not.toBe(input.brushPlan);
    expect(authorityPlan).toMatchObject({
      commandSequence: 1,
      source: {
        samples: [
          { role: "authoritative", sequence: 1 },
          { role: "authoritative", sequence: 2 },
        ],
      },
    });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected committed result");
    expect(result.receipt).toMatchObject({
      storageDurability: "awaiting-opfs-ack",
      gpu: {
        state: "submitted",
        requestSequence: 1,
        resizeEpoch: 3,
        deviceEpoch: 5,
      },
      authority: {
        state: "tile-authority-committed",
        documentRevision: 1,
        layerRevision: 1,
        journalDigest: "journal-1",
      },
    });
  });

  it("never calls tile authority or advances command authority after GPU rejection", async () => {
    const tileCommit = vi.fn();
    let gpuCalls = 0;
    const target = controller({
      webGpu: {
        execute: (frame) => {
          gpuCalls += 1;
          return gpuCalls === 1
            ? { status: "rejected", reason: "submission-failed" }
            : gpuPresented(frame);
        },
      },
      tileAuthority: {
        commit: tileCommit.mockImplementation(() => committedTile(1)),
      },
    });

    const rejected = await target.submit(submission());
    const retried = await target.submit(submission());

    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "gpu-rejected",
      gpuReason: "submission-failed",
    });
    expect(retried.status).toBe("committed");
    expect(tileCommit).toHaveBeenCalledTimes(1);
    expect(gpuCalls).toBe(2);
    if (retried.status !== "committed") throw new Error("Expected committed retry");
    expect(retried.receipt.gpu.requestSequence).toBe(2);
  });

  it("makes a reported device loss terminal and never reaches tile authority", async () => {
    const execute = vi.fn(() => ({
      status: "rejected" as const,
      reason: "device-lost" as const,
    }));
    const commit = vi.fn();
    const target = controller({
      webGpu: { execute },
      tileAuthority: { commit },
    });

    const lost = await target.submit(submission());
    const afterLoss = await target.submit(submission());

    expect(lost).toMatchObject({
      status: "rejected",
      reason: "device-lost",
      gpuReason: "device-lost",
    });
    expect(afterLoss).toEqual({ status: "rejected", reason: "device-lost" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not expose a combined receipt when tile authority rejects", async () => {
    const target = controller({
      tileAuthority: {
        commit: () => ({
          status: "rejected",
          reason: "stale-document-revision",
        }),
      },
    });

    const result = await target.submit(submission());

    expect(result).toEqual({
      status: "rejected",
      reason: "tile-authority-rejected",
      tileReason: "stale-document-revision",
    });
    expect(result).not.toHaveProperty("receipt");
  });

  it("returns the immutable cached receipt for an exact duplicate without re-lowering", async () => {
    const lower = vi.fn(lowerStudioCanonicalBrushPlanToWebGpuDabs);
    const execute = vi.fn((frame: StudioEngineWebGpuBrushFrame) => gpuPresented(frame));
    const commit = vi.fn(() => committedTile(1));
    const target = controller({
      lower,
      webGpu: { execute },
      tileAuthority: { commit },
    });
    const input = submission();

    const first = await target.submit(input);
    const duplicate = await target.submit(input);
    const conflict = await target.submit(submission(1, {
      dirtyRects: [{ x: 16, y: 16, width: 32, height: 32 }],
    }));

    expect(first.status).toBe("committed");
    expect(duplicate.status).toBe("duplicate");
    if (first.status !== "committed" || duplicate.status !== "duplicate") {
      throw new Error("Expected committed then duplicate");
    }
    expect(duplicate.receipt).toBe(first.receipt);
    expect(conflict).toMatchObject({
      status: "rejected",
      reason: "command-sequence-conflict",
    });
    expect(lower).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("fails a disposal race after GPU submission without starting tile commit", async () => {
    const pendingGpu = deferred<StudioEngineWebGpuBrushExecutionResult>();
    const gpuDispose = vi.fn();
    const tileDispose = vi.fn();
    const tileCommit = vi.fn();
    const execute = vi.fn((_frame: StudioEngineWebGpuBrushFrame) => pendingGpu.promise);
    const target = controller({
      webGpu: { execute, dispose: gpuDispose },
      tileAuthority: { commit: tileCommit, dispose: tileDispose },
    });
    const resultPromise = target.submit(submission());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const frame = execute.mock.calls[0]![0] as StudioEngineWebGpuBrushFrame;

    target.dispose();
    pendingGpu.resolve(gpuPresented(frame));
    const result = await resultPromise;

    expect(result).toEqual({ status: "rejected", reason: "disposed" });
    expect(tileCommit).not.toHaveBeenCalled();
    expect(gpuDispose).toHaveBeenCalledOnce();
    expect(tileDispose).toHaveBeenCalledOnce();
  });

  it("exposes only frozen provider-neutral identities and revisions", async () => {
    const gpuProviderSecret = { device: Symbol("GPUDevice") };
    const tileProviderSecret = { storage: Symbol("OPFS") };
    const target = controller({
      webGpu: {
        execute: (frame) => {
          void gpuProviderSecret;
          return gpuPresented(frame);
        },
      },
      tileAuthority: {
        commit: (input) => {
          void tileProviderSecret;
          return committedTile(
            (input.brushPlan as { commandSequence: number }).commandSequence,
          );
        },
      },
    });

    const result = await target.submit(submission());

    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected committed result");
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.gpu)).toBe(true);
    expect(Object.isFrozen(result.receipt.authority)).toBe(true);
    expect(Object.isFrozen(result.receipt.authority.tileRevisions)).toBe(true);
    const serialized = JSON.stringify(result.receipt, (_key, value) => (
      typeof value === "bigint" ? value.toString() : value
    ));
    expect(serialized).not.toContain("GPUDevice");
    expect(serialized).not.toContain("OPFS");
    expect(serialized).not.toContain("backend");
    expect(result.receipt).not.toHaveProperty("durable");
    expect(result.receipt.storageDurability).toBe("awaiting-opfs-ack");
  });

  it("fails closed for predicted samples, specialist recipes and stale epochs", async () => {
    const lower = vi.fn(lowerStudioCanonicalBrushPlanToWebGpuDabs);
    const execute = vi.fn();
    const commit = vi.fn();
    const target = controller({
      lower,
      webGpu: { execute },
      tileAuthority: { commit },
    });

    const predicted = await target.submit(submission(1, {
      brushPlan: canonicalPlan(1, { role: "predicted" }),
    }));
    const specialist = await target.submit(submission(1, {
      brushPlan: canonicalPlan(1, {
        grain: proceduralGrain(),
      }),
    }));
    const staleResize = await target.submit(submission(1, { resizeEpoch: 2 }));
    const staleDevice = await target.submit(submission(1, { deviceEpoch: 4 }));

    expect(predicted).toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
      canonicalReason: "predicted-sample",
    });
    expect(specialist).toMatchObject({
      status: "rejected",
      reason: "specialist-lowering-required",
      specialistRequirements: ["grain"],
    });
    expect(staleResize).toEqual({ status: "rejected", reason: "stale-resize-epoch" });
    expect(staleDevice).toEqual({ status: "rejected", reason: "stale-device-epoch" });
    expect(lower).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("cancels queued work before it can reach GPU or tile authority", async () => {
    const firstGpu = deferred<StudioEngineWebGpuBrushExecutionResult>();
    const frames: StudioEngineWebGpuBrushFrame[] = [];
    const execute = vi.fn((frame: StudioEngineWebGpuBrushFrame) => {
      frames.push(frame);
      return firstGpu.promise;
    });
    const commit = vi.fn((input) => committedTile(
      (input.brushPlan as { commandSequence: number }).commandSequence,
    ));
    const target = controller({
      webGpu: { execute },
      tileAuthority: { commit },
    });
    const first = target.submit(submission(1));
    const second = target.submit(submission(2));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    expect(target.cancel(2)).toEqual({ status: "canceled", commandSequence: 2 });
    firstGpu.resolve(gpuPresented(frames[0]!));

    expect((await first).status).toBe("committed");
    expect(await second).toEqual({ status: "rejected", reason: "canceled" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("interleaves analytic and specialist GPU sequences without approximation", async () => {
    const events: string[] = [];
    const specialist = specialistBoundary({
      beforeComplete: () => {
        events.push("specialist-gpu");
      },
    });
    const analyticExecute = vi.fn((frame: StudioEngineWebGpuBrushFrame) => {
      events.push(`analytic-gpu:${frame.requestSequence}`);
      return gpuPresented(frame);
    });
    const tileCommit = vi.fn((input) => {
      const sequence = (
        input.brushPlan as { commandSequence: number }
      ).commandSequence;
      events.push(`tile:${sequence}`);
      return committedTile(sequence);
    });
    const target = controller({
      webGpu: { execute: analyticExecute },
      specialistGpu: specialist.boundary,
      tileAuthority: { commit: tileCommit },
    });

    const first = await target.submit(submission(1));
    const second = await target.submit(submission(2, {
      brushPlan: canonicalPlan(2, { grain: proceduralGrain() }),
    }));
    const third = await target.submit(submission(3));

    expect([first.status, second.status, third.status]).toEqual([
      "committed",
      "committed",
      "committed",
    ]);
    expect(events).toEqual([
      "analytic-gpu:1",
      "tile:1",
      "specialist-gpu",
      "tile:2",
      "analytic-gpu:3",
      "tile:3",
    ]);
    expect(analyticExecute).toHaveBeenCalledTimes(2);
    expect(specialist.execute).toHaveBeenCalledTimes(1);
    expect(specialist.executions[0]).toMatchObject({
      globalRequestSequence: 1,
      canonicalPlan: { commandSequence: 2, strokeId: "stroke-2" },
    });
    if (second.status !== "committed") throw new Error("Expected specialist commit");
    expect(second.receipt.gpu).toMatchObject({
      requestSequence: 2,
      planFingerprint: expect.stringMatching(
        /^vnext-provider:future-grain-provider@2:/u,
      ),
    });
  });

  it("rejects a forged specialist proof before tile authority", async () => {
    const specialist = specialistBoundary({ forgeProof: true });
    const tileCommit = vi.fn();
    const analyticExecute = vi.fn();
    const target = controller({
      webGpu: { execute: analyticExecute },
      specialistGpu: specialist.boundary,
      tileAuthority: { commit: tileCommit },
    });

    const result = await target.submit(submission(1, {
      brushPlan: canonicalPlan(1, { grain: proceduralGrain() }),
    }));

    expect(result).toEqual({
      status: "rejected",
      reason: "gpu-receipt-mismatch",
    });
    expect(analyticExecute).not.toHaveBeenCalled();
    expect(tileCommit).not.toHaveBeenCalled();
  });

  it("aborts active specialist work on controller cancellation", async () => {
    const started = deferred<void>();
    let observedSignal: AbortSignal | null = null;
    const specialist = specialistBoundary({
      beforeComplete: (_execution, signal) => {
        observedSignal = signal;
        started.resolve(undefined);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    });
    const tileCommit = vi.fn();
    const target = controller({
      specialistGpu: specialist.boundary,
      tileAuthority: { commit: tileCommit },
    });
    const pending = target.submit(submission(1, {
      brushPlan: canonicalPlan(1, { grain: proceduralGrain() }),
    }));
    await started.promise;

    expect(target.cancel(1)).toEqual({ status: "canceled", commandSequence: 1 });

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "canceled",
    });
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(tileCommit).not.toHaveBeenCalled();
  });

  it("propagates terminal device loss through the specialist router", async () => {
    const started = deferred<void>();
    const specialist = specialistBoundary({
      beforeComplete: (_execution, signal) => {
        started.resolve(undefined);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    });
    const tileCommit = vi.fn();
    const target = controller({
      specialistGpu: specialist.boundary,
      tileAuthority: { commit: tileCommit },
    });
    const pending = target.submit(submission(1, {
      brushPlan: canonicalPlan(1, { grain: proceduralGrain() }),
    }));
    await started.promise;

    target.notifyDeviceLost();

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
    });
    expect(specialist.notifyDeviceLoss).toHaveBeenCalledWith({
      deviceEpoch: 6,
      reason: "future-brush-controller-device-lost",
    });
    expect(tileCommit).not.toHaveBeenCalled();
    await expect(target.submit(submission(1, {
      brushPlan: canonicalPlan(1, { grain: proceduralGrain() }),
    }))).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
    });
  });
});
