import { describe, expect, it, vi } from "vitest";

import {
  createStudioOutOfCoreExportPlan,
  createStudioOutOfCoreExportProvider,
  StudioOutOfCoreExportError,
  type StudioOutOfCoreExportRequest,
  type StudioOutOfCoreInteger,
  type StudioOutOfCoreRendererCapability,
  type StudioOutOfCoreSha256,
  type StudioOutOfCoreSinkAdapter,
} from "./studio-out-of-core-export-provider";

const RENDERER_HASH = `sha256:${"1".repeat(64)}` as const;
const SINK_HASH = `sha256:${"2".repeat(64)}` as const;
const RESUME_HASH = `sha256:${"3".repeat(64)}` as const;

function rendererCapability(
  overrides: Partial<StudioOutOfCoreRendererCapability> = {},
): StudioOutOfCoreRendererCapability {
  return {
    id: "test-renderer.v1",
    hash: RENDERER_HASH,
    maxWorkingBytes: 0,
    maxOutputBytes: 1_024,
    ...overrides,
  };
}

function sinkCapability() {
  return {
    id: "test-sink.v1",
    hash: SINK_HASH,
    maxWorkingBytes: 0,
  } as const;
}

function baseRequest(
  overrides: Partial<StudioOutOfCoreExportRequest> = {},
): StudioOutOfCoreExportRequest {
  const renderer = {
    capability: rendererCapability(),
    renderTile: vi.fn(() => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
    })),
  };
  const sink: StudioOutOfCoreSinkAdapter = {
    capability: sinkCapability(),
    writeTile: vi.fn((context) => ({
      verifiedHash: context.contentHash,
      byteLength: context.bytes.byteLength,
    })),
  };
  return {
    logicalWidth: 4,
    logicalHeight: 4,
    scale: { numerator: 1, denominator: 1 },
    tiling: { coreWidth: 2, coreHeight: 2 },
    bytesPerPixel: 1,
    renderer,
    sink,
    epoch: 0,
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("Studio out-of-core export planner", () => {
  it("keeps dimensions, scale, and pixel counts beyond canvas and 32-bit limits exact", () => {
    const plan = createStudioOutOfCoreExportPlan({
      logicalWidth: BigInt("5000000000"),
      logicalHeight: "2",
      scale: { numerator: "3", denominator: "2" },
      tiling: {
        coreWidth: 1_000_000,
        coreHeight: 2,
        order: "row-major",
      },
      bytesPerPixel: 4,
      rendererCapability: rendererCapability({
        maxOutputBytes: 8_000_000,
      }),
      sinkCapability: sinkCapability(),
    });

    expect(plan).toMatchObject({
      logicalWidth: "5000000000",
      logicalHeight: "2",
      logicalPixelCount: "10000000000",
      scaleNumerator: "3",
      scaleDenominator: "2",
      outputWidth: "7500000000",
      outputHeight: "3",
      outputPixelCount: "22500000000",
      tileColumns: 7_500,
      tileRows: 2,
      totalTiles: 15_000,
      totalTilesDecimal: "15000",
    });
    expect(plan.manifestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(plan.tiles()).toBeTypeOf("object");
    expect(plan.tiles().next().value?.core.x).toBe("0");
  });

  it("produces exact edge, halo, overlap, and seam-excluding crop rectangles", () => {
    const plan = createStudioOutOfCoreExportPlan({
      logicalWidth: 10,
      logicalHeight: 7,
      scale: { numerator: 1, denominator: 1 },
      tiling: {
        coreWidth: 4,
        coreHeight: 3,
        haloPixels: 1,
        overlapPixels: 1,
      },
      bytesPerPixel: 4,
      rendererCapability: rendererCapability(),
      sinkCapability: sinkCapability(),
    });

    expect(plan.tileAt(0, 0)).toMatchObject({
      id: "r0-c0",
      core: { x: "0", y: "0", width: 4, height: 3 },
      render: { x: "0", y: "0", width: 6, height: 5 },
      crop: { x: 0, y: 0, width: 4, height: 3 },
      haloPixels: 1,
      overlapPixels: 1,
    });
    expect(plan.tileAt(1, 1)).toMatchObject({
      core: { x: "4", y: "3", width: 4, height: 3 },
      render: { x: "2", y: "1", width: 8, height: 6 },
      crop: { x: 2, y: 2, width: 4, height: 3 },
    });
    expect(plan.tileAt(2, 2)).toMatchObject({
      core: { x: "8", y: "6", width: 2, height: 1 },
      render: { x: "6", y: "4", width: 4, height: 3 },
      crop: { x: 2, y: 2, width: 2, height: 1 },
    });
  });

  it("keeps ordering, tile ids, and manifest fingerprints deterministic", () => {
    const input = {
      logicalWidth: 5,
      logicalHeight: 3,
      scale: { numerator: 1, denominator: 1 },
      tiling: {
        coreWidth: 2,
        coreHeight: 2,
        order: "morton" as const,
      },
      bytesPerPixel: 1,
      rendererCapability: rendererCapability(),
      sinkCapability: sinkCapability(),
    };
    const first = createStudioOutOfCoreExportPlan(input);
    const second = createStudioOutOfCoreExportPlan(structuredClone(input));

    expect([...first.tiles()].map((tile) => tile.id)).toEqual([
      "r0-c0",
      "r0-c1",
      "r1-c0",
      "r1-c1",
      "r0-c2",
      "r1-c2",
    ]);
    expect(first.manifestFingerprint).toBe(second.manifestFingerprint);
    expect([...second.tiles()].map((tile) => tile.ordinal)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    const rowMajor = createStudioOutOfCoreExportPlan({
      ...input,
      tiling: { ...input.tiling, order: "row-major" },
    });
    expect(rowMajor.manifestFingerprint).not.toBe(first.manifestFingerprint);
    expect([...rowMajor.tiles()].map((tile) => tile.id)).toEqual([
      "r0-c0",
      "r0-c1",
      "r0-c2",
      "r1-c0",
      "r1-c1",
      "r1-c2",
    ]);
  });

  it("reserves raw, both encoded copies, and adapter working bytes simultaneously", () => {
    const input = {
      logicalWidth: 8,
      logicalHeight: 8,
      scale: { numerator: 1, denominator: 1 },
      tiling: { coreWidth: 8, coreHeight: 8 },
      bytesPerPixel: 1,
      rendererCapability: rendererCapability({
        maxWorkingBytes: 8,
        maxOutputBytes: 64,
      }),
      sinkCapability: {
        ...sinkCapability(),
        maxWorkingBytes: 4,
      },
    };

    expect(() => createStudioOutOfCoreExportPlan(input, {
      maxResidentBytes: 203,
    })).toThrow(expect.objectContaining({ code: "budget-exceeded" }));

    const plan = createStudioOutOfCoreExportPlan(input, {
      maxResidentBytes: 204,
    });
    expect(plan.maxTileReservationBytes).toBe(204);
    expect(plan.tileAt(0, 0).reservedResidentBytes).toBe(204);
  });

  it.each([
    [{ logicalWidth: Number.POSITIVE_INFINITY }, "invalid-request"],
    [{ logicalWidth: "01" }, "invalid-request"],
    [{ tiling: { coreWidth: 0, coreHeight: 2 } }, "invalid-request"],
    [{ logicalWidth: "1000000000000000" }, "budget-exceeded"],
  ] as const)("rejects malformed or excessive plans before rendering", (
    override,
    code,
  ) => {
    const request = baseRequest(override as Partial<StudioOutOfCoreExportRequest>);
    expect(() => createStudioOutOfCoreExportPlan({
      logicalWidth: request.logicalWidth,
      logicalHeight: request.logicalHeight,
      scale: request.scale,
      tiling: request.tiling,
      bytesPerPixel: request.bytesPerPixel,
      rendererCapability: request.renderer.capability,
      sinkCapability: request.sink.capability,
    })).toThrow(expect.objectContaining({ code }));
    expect(request.renderer.renderTile).not.toHaveBeenCalled();
  });
});

describe("Studio out-of-core export orchestrator", () => {
  it("applies resident-byte backpressure and reports a conservative peak", async () => {
    let active = 0;
    let peakActive = 0;
    const renderer = {
      capability: rendererCapability({
        maxWorkingBytes: 4,
        maxOutputBytes: 4,
      }),
      renderTile: vi.fn(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await Promise.resolve();
        active -= 1;
        return { bytes: new Uint8Array([1, 2, 3, 4]) };
      }),
    };
    const provider = createStudioOutOfCoreExportProvider({
      budgets: { maxResidentBytes: 32 },
    });
    const receipt = await provider.exportDocument(baseRequest({
      logicalWidth: 8,
      logicalHeight: 4,
      renderer,
      concurrency: 8,
    }));

    expect(peakActive).toBe(2);
    expect(receipt).toMatchObject({
      status: "complete",
      completedTiles: 8,
      skippedTiles: 0,
      effectiveConcurrency: 2,
      peakResidentBytes: 32,
      tileCount: "8",
    });
    expect(receipt.tileManifestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("skips only sink-verified resume tiles and renders unverified entries", async () => {
    const request = baseRequest({
      logicalWidth: 4,
      logicalHeight: 2,
    });
    const plan = createStudioOutOfCoreExportPlan({
      logicalWidth: request.logicalWidth,
      logicalHeight: request.logicalHeight,
      scale: request.scale,
      tiling: request.tiling,
      bytesPerPixel: request.bytesPerPixel,
      rendererCapability: request.renderer.capability,
      sinkCapability: request.sink.capability,
    });
    const verifyTile = vi.fn((context) => (
      context.tile.id === "r0-c0"
        ? {
          verifiedHash: context.expectedHash,
          byteLength: context.expectedByteLength,
        }
        : { verifiedHash: null, byteLength: null }
    ));
    const requestWithResume: StudioOutOfCoreExportRequest = {
      ...request,
      sink: { ...request.sink, verifyTile },
      resume: {
        revision: 1,
        planFingerprint: plan.manifestFingerprint,
        rendererCapability: capabilityIdentity(request.renderer.capability),
        sinkCapability: capabilityIdentity(request.sink.capability),
        tiles: [
          { tileId: "r0-c0", contentHash: RESUME_HASH, byteLength: 4 },
          { tileId: "r0-c1", contentHash: RESUME_HASH, byteLength: 4 },
        ],
      },
    };

    const provider = createStudioOutOfCoreExportProvider();
    const receipt = await provider.exportDocument(requestWithResume);

    expect(verifyTile).toHaveBeenCalledTimes(2);
    expect(request.renderer.renderTile).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      status: "complete",
      completedTiles: 1,
      skippedTiles: 1,
    });
  });

  it("rejects resume provenance and hash errors before renderer admission", async () => {
    const request = baseRequest();
    const sink = { ...request.sink, verifyTile: vi.fn() };
    const provenanceRequest: StudioOutOfCoreExportRequest = {
      ...request,
      sink,
      resume: {
        revision: 1,
        planFingerprint: `sha256:${"f".repeat(64)}`,
        rendererCapability: capabilityIdentity(request.renderer.capability),
        sinkCapability: capabilityIdentity(request.sink.capability),
        tiles: [],
      },
    };
    const provider = createStudioOutOfCoreExportProvider();

    await expect(provider.exportDocument(provenanceRequest)).rejects.toMatchObject({
      code: "provenance-mismatch",
    });
    expect(request.renderer.renderTile).not.toHaveBeenCalled();

    const plan = createStudioOutOfCoreExportPlan({
      logicalWidth: request.logicalWidth,
      logicalHeight: request.logicalHeight,
      scale: request.scale,
      tiling: request.tiling,
      bytesPerPixel: request.bytesPerPixel,
      rendererCapability: request.renderer.capability,
      sinkCapability: request.sink.capability,
    });
    const invalidHashRequest: StudioOutOfCoreExportRequest = {
      ...request,
      sink,
      resume: {
        revision: 1,
        planFingerprint: plan.manifestFingerprint,
        rendererCapability: capabilityIdentity(request.renderer.capability),
        sinkCapability: capabilityIdentity(request.sink.capability),
        tiles: [{
          tileId: "r0-c0",
          contentHash: "sha256:not-a-hash",
          byteLength: 4,
        }],
      },
    };
    await expect(provider.exportDocument(invalidHashRequest)).rejects.toMatchObject({
      code: "provenance-mismatch",
    });
    expect(request.renderer.renderTile).not.toHaveBeenCalled();
  });

  it("retries transient tile failures and emits fail-closed receipts on exhaustion", async () => {
    let attempts = 0;
    const request = baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient");
          return { bytes: new Uint8Array([1, 2, 3, 4]) };
        }),
      },
      retryBudget: 1,
    });
    const provider = createStudioOutOfCoreExportProvider();
    const receipt = await provider.exportDocument(request);
    expect(receipt).toMatchObject({
      completedTiles: 1,
      retriedTiles: 1,
      retryAttempts: 1,
      status: "complete",
    });

    const failedProvider = createStudioOutOfCoreExportProvider();
    const failed = baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      retryBudget: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => {
          throw new Error("persistent");
        }),
      },
    });
    const failure = await failedProvider.exportDocument(failed)
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(StudioOutOfCoreExportError);
    expect(failure).toMatchObject({
      code: "tile-failed",
      receipt: {
        status: "fail-closed",
        failureCode: "tile-failed",
        completedTiles: 0,
        retriedTiles: 1,
        retryAttempts: 2,
        tileManifestHash: null,
      },
    });
  });

  it("fails stale, externally aborted, and disposed jobs without finalizing", async () => {
    const staleGate = deferred<{ bytes: Uint8Array }>();
    const staleProvider = createStudioOutOfCoreExportProvider({ epoch: 4 });
    const staleRequest = baseRequest({
      epoch: 4,
      logicalWidth: 2,
      logicalHeight: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => staleGate.promise),
      },
    });
    const stalePending = staleProvider.exportDocument(staleRequest);
    staleProvider.setEpoch(5);
    await expect(stalePending).rejects.toMatchObject({
      code: "epoch-mismatch",
      receipt: { status: "fail-closed", failureCode: "epoch-mismatch" },
    });
    expect(staleProvider.snapshot()).toMatchObject({ activeExports: 0 });
    staleGate.resolve({ bytes: new Uint8Array([1]) });
    await Promise.resolve();
    await expect(staleProvider.exportDocument(baseRequest({
      epoch: 5,
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });

    const abortGate = deferred<{ bytes: Uint8Array }>();
    const abortController = new AbortController();
    const abortProvider = createStudioOutOfCoreExportProvider();
    const abortPending = abortProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      signal: abortController.signal,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => abortGate.promise),
      },
    }));
    abortController.abort();
    await expect(abortPending).rejects.toMatchObject({
      code: "aborted",
      receipt: { status: "fail-closed", failureCode: "aborted" },
    });
    expect(abortProvider.snapshot()).toMatchObject({ activeExports: 0 });
    abortGate.resolve({ bytes: new Uint8Array([1]) });
    await Promise.resolve();
    await expect(abortProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });

    const disposeGate = deferred<{ bytes: Uint8Array }>();
    const disposeProvider = createStudioOutOfCoreExportProvider();
    const disposePending = disposeProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => disposeGate.promise),
      },
    }));
    disposeProvider.dispose();
    await expect(disposePending).rejects.toMatchObject({
      code: "disposed",
      receipt: { status: "fail-closed", failureCode: "disposed" },
    });
    expect(disposeProvider.snapshot()).toMatchObject({
      state: "disposed",
      activeExports: 0,
    });
    disposeGate.resolve({ bytes: new Uint8Array([1]) });
    await Promise.resolve();
  });

  it("races never-settling verify and write adapters against lifecycle invalidation", async () => {
    const verifyBase = baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
    });
    const verifyPlan = createStudioOutOfCoreExportPlan({
      logicalWidth: verifyBase.logicalWidth,
      logicalHeight: verifyBase.logicalHeight,
      scale: verifyBase.scale,
      tiling: verifyBase.tiling,
      bytesPerPixel: verifyBase.bytesPerPixel,
      rendererCapability: verifyBase.renderer.capability,
      sinkCapability: verifyBase.sink.capability,
    });
    const verifyGate = deferred<{
      verifiedHash: StudioOutOfCoreSha256;
      byteLength: number;
    }>();
    const verifyProvider = createStudioOutOfCoreExportProvider();
    const verifyPending = verifyProvider.exportDocument({
      ...verifyBase,
      sink: {
        ...verifyBase.sink,
        verifyTile: vi.fn(() => verifyGate.promise),
      },
      resume: {
        revision: 1,
        planFingerprint: verifyPlan.manifestFingerprint,
        rendererCapability: capabilityIdentity(verifyBase.renderer.capability),
        sinkCapability: capabilityIdentity(verifyBase.sink.capability),
        tiles: [{
          tileId: "r0-c0",
          contentHash: RESUME_HASH,
          byteLength: 4,
        }],
      },
    });
    verifyProvider.setEpoch(1);
    await expect(verifyPending).rejects.toMatchObject({
      code: "epoch-mismatch",
      receipt: { failureCode: "epoch-mismatch" },
    });
    expect(verifyProvider.snapshot()).toMatchObject({ activeExports: 0 });
    verifyGate.resolve({ verifiedHash: RESUME_HASH, byteLength: 4 });
    await Promise.resolve();
    await expect(verifyProvider.exportDocument(baseRequest({
      epoch: 1,
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });

    const writeGate = deferred<{
      verifiedHash: StudioOutOfCoreSha256;
      byteLength: number;
    }>();
    const writeAbort = new AbortController();
    const writeProvider = createStudioOutOfCoreExportProvider();
    const writePending = writeProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      signal: writeAbort.signal,
      sink: {
        capability: sinkCapability(),
        writeTile: vi.fn(() => writeGate.promise),
      },
    }));
    writeAbort.abort();
    await expect(writePending).rejects.toMatchObject({
      code: "aborted",
      receipt: { failureCode: "aborted" },
    });
    expect(writeProvider.snapshot()).toMatchObject({ activeExports: 0 });
    writeGate.resolve({ verifiedHash: RESUME_HASH, byteLength: 4 });
    await Promise.resolve();
    await expect(writeProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });
  });

  it("times out ignored adapter promises and ignores their late resolution", async () => {
    const gate = deferred<{ bytes: Uint8Array }>();
    const provider = createStudioOutOfCoreExportProvider();
    const pending = provider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      operationTimeoutMs: 10,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => gate.promise),
      },
    }));

    await expect(pending).rejects.toMatchObject({
      code: "operation-timeout",
      receipt: {
        status: "fail-closed",
        failureCode: "operation-timeout",
        operationTimeoutMs: 10,
      },
    });
    expect(provider.snapshot()).toMatchObject({ activeExports: 0 });

    gate.resolve({ bytes: new Uint8Array([9]) });
    await Promise.resolve();
    await expect(provider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });
  });

  it("bounds request timeouts by the provider policy before adapter admission", async () => {
    const provider = createStudioOutOfCoreExportProvider({
      budgets: {
        defaultOperationTimeoutMs: 7,
        maxOperationTimeoutMs: 10,
      },
    });
    const excessive = baseRequest({ operationTimeoutMs: 11 });

    await expect(provider.exportDocument(excessive)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(excessive.renderer.renderTile).not.toHaveBeenCalled();
    expect(provider.snapshot()).toMatchObject({
      sequence: 0,
      activeExports: 0,
    });

    await expect(provider.exportDocument(baseRequest())).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
      operationTimeoutMs: 7,
    });
  });

  it("cannot be poisoned by hostile AbortSignal listener methods", async () => {
    const addThrows = {
      aborted: false,
      addEventListener: vi.fn(() => {
        throw new Error("hostile add");
      }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const addProvider = createStudioOutOfCoreExportProvider();
    await expect(addProvider.exportDocument(baseRequest({
      signal: addThrows,
    }))).rejects.toMatchObject({ code: "invalid-request" });
    expect(addProvider.snapshot()).toMatchObject({
      sequence: 0,
      activeExports: 0,
    });
    await expect(addProvider.exportDocument(baseRequest())).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });

    const removeThrows = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error("hostile remove");
      }),
    } as unknown as AbortSignal;
    const removeProvider = createStudioOutOfCoreExportProvider();
    await expect(removeProvider.exportDocument(baseRequest({
      signal: removeThrows,
    }))).resolves.toMatchObject({ status: "complete", sequence: 1 });
    expect(removeProvider.snapshot()).toMatchObject({ activeExports: 0 });
    await expect(removeProvider.exportDocument(baseRequest())).resolves.toMatchObject({
      status: "complete",
      sequence: 2,
    });
  });

  it("claims ownership before hostile signal setup and rolls back invalidated preflight", async () => {
    const reentrantProvider = createStudioOutOfCoreExportProvider();
    let nestedResult: Promise<unknown> | undefined;
    const reentrantSignal = {
      aborted: false,
      addEventListener: vi.fn(() => {
        nestedResult = reentrantProvider.exportDocument(baseRequest())
          .then(
            (receipt) => receipt,
            (error: unknown) => error,
          );
      }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;

    await expect(reentrantProvider.exportDocument(baseRequest({
      signal: reentrantSignal,
    }))).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });
    await expect(nestedResult).resolves.toMatchObject({
      code: "backpressure",
    });
    expect(reentrantProvider.snapshot()).toMatchObject({
      sequence: 1,
      activeExports: 0,
    });

    const epochProvider = createStudioOutOfCoreExportProvider();
    const epochInvalidated = baseRequest({
      signal: {
        aborted: false,
        addEventListener: vi.fn(() => epochProvider.setEpoch(1)),
        removeEventListener: vi.fn(),
      } as unknown as AbortSignal,
    });
    await expect(epochProvider.exportDocument(epochInvalidated)).rejects.toMatchObject({
      code: "epoch-mismatch",
      receipt: null,
    });
    expect(epochInvalidated.renderer.renderTile).not.toHaveBeenCalled();
    expect(epochProvider.snapshot()).toMatchObject({
      epoch: 1,
      sequence: 0,
      activeExports: 0,
    });
    await expect(epochProvider.exportDocument(baseRequest({
      epoch: 1,
      logicalWidth: 2,
      logicalHeight: 2,
    }))).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });

    const disposedProvider = createStudioOutOfCoreExportProvider();
    const disposeInvalidated = baseRequest({
      signal: {
        aborted: false,
        addEventListener: vi.fn(() => disposedProvider.dispose()),
        removeEventListener: vi.fn(),
      } as unknown as AbortSignal,
    });
    await expect(disposedProvider.exportDocument(disposeInvalidated)).rejects.toMatchObject({
      code: "disposed",
      receipt: null,
    });
    expect(disposeInvalidated.renderer.renderTile).not.toHaveBeenCalled();
    expect(disposedProvider.snapshot()).toMatchObject({
      state: "disposed",
      sequence: 0,
      activeExports: 0,
    });
  });

  it("rejects stale artifact accessors and mutable sink payloads without counting them", async () => {
    const staleProvider = createStudioOutOfCoreExportProvider();
    const staleWrite = vi.fn((context) => ({
      verifiedHash: context.contentHash,
      byteLength: context.bytes.byteLength,
    }));
    const staleFailure = await staleProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => ({
          get bytes() {
            staleProvider.setEpoch(1);
            return new Uint8Array([7]);
          },
        })),
      },
      sink: {
        capability: sinkCapability(),
        writeTile: staleWrite,
      },
    })).then(() => null, (error: unknown) => error);
    expect(staleFailure).toMatchObject({
      code: "epoch-mismatch",
      receipt: {
        failureCode: "epoch-mismatch",
        completedTiles: 0,
      },
    });
    expect(staleWrite).not.toHaveBeenCalled();

    const metricProvider = createStudioOutOfCoreExportProvider();
    const metricFailure = await metricProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      sink: {
        capability: sinkCapability(),
        writeTile: vi.fn((context) => ({
          get verifiedHash() {
            metricProvider.setEpoch(1);
            return context.contentHash;
          },
          byteLength: context.bytes.byteLength,
        })),
      },
    })).then(() => null, (error: unknown) => error);
    expect(metricFailure).toMatchObject({
      code: "epoch-mismatch",
      receipt: {
        failureCode: "epoch-mismatch",
        completedTiles: 0,
      },
    });

    const mutationProvider = createStudioOutOfCoreExportProvider();
    const mutationFailure = await mutationProvider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      sink: {
        capability: sinkCapability(),
        writeTile: vi.fn((context) => {
          context.bytes[0] ^= 0xff;
          return {
            verifiedHash: context.contentHash,
            byteLength: context.bytes.byteLength,
          };
        }),
      },
    })).then(() => null, (error: unknown) => error);
    expect(mutationFailure).toMatchObject({
      code: "integrity-mismatch",
      receipt: {
        failureCode: "integrity-mismatch",
        completedTiles: 0,
      },
    });
  });

  it("isolates caller-owned request metadata and keeps adapter artifacts bounded", async () => {
    const firstTileGate = deferred<{ bytes: Uint8Array }>();
    const originalRender = vi.fn()
      .mockImplementationOnce(() => firstTileGate.promise)
      .mockImplementation(() => ({ bytes: new Uint8Array([5, 6]) }));
    const replacementRender = vi.fn(() => ({
      bytes: new Uint8Array([9, 9]),
    }));
    const base = baseRequest();
    const callerOwnedRendererCapability = { ...rendererCapability() };
    const request = {
      ...base,
      logicalWidth: 4 as StudioOutOfCoreInteger,
      logicalHeight: 2 as StudioOutOfCoreInteger,
      tiling: { ...base.tiling },
      renderer: {
        capability: callerOwnedRendererCapability,
        renderTile: originalRender,
      },
      concurrency: 1,
    };
    const provider = createStudioOutOfCoreExportProvider();
    const pending = provider.exportDocument(request);

    request.logicalWidth = BigInt("999999999");
    request.tiling.coreWidth = 1;
    callerOwnedRendererCapability.id = "mutated-renderer";
    request.renderer.renderTile = replacementRender;
    firstTileGate.resolve({ bytes: new Uint8Array([1, 2]) });

    const receipt = await pending;
    expect(receipt).toMatchObject({
      status: "complete",
      tileCount: "2",
      logicalDimensions: { width: "4", height: "2" },
      rendererCapability: { id: "test-renderer.v1" },
    });
    expect(originalRender).toHaveBeenCalledTimes(2);
    expect(replacementRender).not.toHaveBeenCalled();
    for (const [tile] of originalRender.mock.calls) {
      expect(Object.isFrozen(tile)).toBe(true);
      expect(Object.isFrozen(tile.core)).toBe(true);
      expect(tile.render.width * tile.render.height).toBeLessThanOrEqual(4);
    }
  });

  it("backpressures concurrent document exports and increments sequences deterministically", async () => {
    const gate = deferred<{ bytes: Uint8Array }>();
    const provider = createStudioOutOfCoreExportProvider();
    const first = provider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
      renderer: {
        capability: rendererCapability(),
        renderTile: vi.fn(() => gate.promise),
      },
    }));
    await expect(provider.exportDocument(baseRequest())).rejects.toMatchObject({
      code: "backpressure",
    });
    gate.resolve({ bytes: new Uint8Array([1]) });
    const firstReceipt = await first;
    const secondReceipt = await provider.exportDocument(baseRequest({
      logicalWidth: 2,
      logicalHeight: 2,
    }));
    expect(firstReceipt.sequence).toBe(1);
    expect(secondReceipt.sequence).toBe(2);
  });
});

function capabilityIdentity(
  capability: Readonly<{ id: string; hash: StudioOutOfCoreSha256 }>,
) {
  return { id: capability.id, hash: capability.hash };
}
