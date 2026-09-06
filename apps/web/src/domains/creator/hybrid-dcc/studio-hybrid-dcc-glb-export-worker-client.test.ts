import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
} from "../studio-editable-half-edge-mesh";

import { exportStudioHybridDccMeshGlb } from "./studio-hybrid-dcc-glb-export";
import { STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS } from "./studio-hybrid-dcc-glb-export-diagnostic-limits";
import {
  STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES,
  hasValidStudioHybridDccPackedMeshChecksums,
  packStudioHybridDccGlbExportInput,
  unpackStudioHybridDccGlbExportInput,
} from "./studio-hybrid-dcc-glb-export-packed-mesh";
import {
  StudioHybridDccGlbExportClientError,
  exportStudioHybridDccGlbBatch,
  type StudioHybridDccGlbExportWorkerLike,
} from "./studio-hybrid-dcc-glb-export-worker-client";
import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_VERTICES,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
  isStudioHybridDccGlbExportWorkerRequest,
  isStudioHybridDccGlbExportWorkerRequestEnvelope,
  isStudioHybridDccGlbExportWorkerResponse,
  studioHybridDccGlbExportWorkerRequestTransfers,
  type StudioHybridDccGlbExportWorkerRequest,
  type StudioHybridDccGlbExportWorkerResponse,
} from "./studio-hybrid-dcc-glb-export-worker-protocol";

import type { StudioHybridDccMeshGlbExportInput } from "./studio-hybrid-dcc-glb-export";

interface WorkerMessageLike {
  readonly data: unknown;
}

interface WorkerErrorLike {
  preventDefault?(): void;
}

class FakeWorker implements StudioHybridDccGlbExportWorkerLike {
  readonly requests: StudioHybridDccGlbExportWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly postArgumentCounts: number[] = [];
  readonly messageListeners = new Set<(event: WorkerMessageLike) => void>();
  readonly errorListeners = new Set<(event: WorkerErrorLike) => void>();
  readonly messageErrorListeners = new Set<(event: WorkerErrorLike) => void>();
  terminateCalls = 0;
  throwOnPost = false;

  postMessage(message: StudioHybridDccGlbExportWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new DOMException("clone failed", "DataCloneError");
    this.requests.push(message);
    this.transfers.push(transfer);
    this.postArgumentCounts.push(arguments.length);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageLike) => void) | ((event: WorkerErrorLike) => void),
  ): void {
    if (type === "message") this.messageListeners.add(listener as (event: WorkerMessageLike) => void);
    else if (type === "error") this.errorListeners.add(listener as (event: WorkerErrorLike) => void);
    else this.messageErrorListeners.add(listener as (event: WorkerErrorLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: WorkerMessageLike) => void) | ((event: WorkerErrorLike) => void),
  ): void {
    if (type === "message") this.messageListeners.delete(listener as (event: WorkerMessageLike) => void);
    else if (type === "error") this.errorListeners.delete(listener as (event: WorkerErrorLike) => void);
    else this.messageErrorListeners.delete(listener as (event: WorkerErrorLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitFailure(type: "error" | "messageerror" = "error"): void {
    const event = { preventDefault: vi.fn() };
    const listeners = type === "error" ? this.errorListeners : this.messageErrorListeners;
    for (const listener of listeners) listener(event);
  }
}

function input(assetId = "worker-cube"): StudioHybridDccMeshGlbExportInput {
  const mesh = createStudioUnitCubeMesh();
  return {
    assetId,
    mesh,
    sourceRevision: 3,
    sourceHash: hashStudioEditableMesh(mesh),
  };
}

function largeMaterialInput(): StudioHybridDccMeshGlbExportInput {
  const faceCount = STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS + 1;
  const positions: Array<{ readonly x: number; readonly y: number; readonly z: number }> = [];
  const faces: number[][] = [];
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const offset = positions.length;
    const x = faceIndex * 2;
    positions.push(
      { x, y: 0, z: 0 },
      { x: x + 1, y: 0, z: 0 },
      { x, y: 1, z: 0 },
    );
    faces.push([offset, offset + 1, offset + 2]);
  }
  const base = createStudioEditableMeshFromPolygons(positions, faces);
  const mesh = {
    ...base,
    faces: base.faces.map((face) => ({ ...face, materialSlot: 1 })),
  };
  return {
    assetId: "worker-large-material",
    mesh,
    sourceRevision: 1,
    sourceHash: hashStudioEditableMesh(mesh),
  };
}

function requestFor(
  exportInput = input(),
  requestId = 7,
): StudioHybridDccGlbExportWorkerRequest {
  return {
    version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
    kind: "export-batch",
    requestId,
    inputTransport: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT,
    payloads: [packStudioHybridDccGlbExportInput(exportInput)],
    maxResponseBytes: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES,
  };
}

function successResponse(
  request: StudioHybridDccGlbExportWorkerRequest,
): StudioHybridDccGlbExportWorkerResponse {
  const results = request.payloads.map((payload) => {
    const exportInput = unpackStudioHybridDccGlbExportInput(payload);
    if (!exportInput) throw new Error("invalid packed request fixture");
    const result = exportStudioHybridDccMeshGlb(exportInput);
    if (!result.ok) throw new Error(JSON.stringify(result.report));
    return { ...result, bytes: result.bytes.buffer };
  });
  return {
    version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    results,
    totalByteLength: results.reduce((total, result) => total + result.bytes.byteLength, 0),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Hybrid DCC GLB export Worker protocol", () => {
  it("validates packed checksums and fails closed on malformed offsets and provenance", () => {
    const request = requestFor();
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(request)).toBe(true);
    expect(isStudioHybridDccGlbExportWorkerRequest(request)).toBe(true);
    expect(hasValidStudioHybridDccPackedMeshChecksums(request.payloads[0]!)).toBe(true);

    const corruptedBuffer = request.payloads[0]!.buffer.slice(0);
    new Uint8Array(corruptedBuffer)[0] ^= 0xff;
    const corruptedRequest = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        buffer: corruptedBuffer,
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(corruptedRequest)).toBe(true);
    expect(isStudioHybridDccGlbExportWorkerRequest(corruptedRequest)).toBe(false);

    const vertexIds = request.payloads[0]!.manifest.sections.vertexIds;
    const malformedOffset = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        manifest: {
          ...request.payloads[0]!.manifest,
          sections: {
            ...request.payloads[0]!.manifest.sections,
            vertexIds: { ...vertexIds, offset: vertexIds.offset + 8 },
          },
        },
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(malformedOffset)).toBe(false);

    const malformedCount = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        manifest: {
          ...request.payloads[0]!.manifest,
          sections: {
            ...request.payloads[0]!.manifest.sections,
            vertexIds: { ...vertexIds, count: vertexIds.count + 1 },
          },
        },
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(malformedCount)).toBe(false);

    const overBudget = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        manifest: {
          ...request.payloads[0]!.manifest,
          counts: {
            ...request.payloads[0]!.manifest.counts,
            vertices: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_VERTICES + 1,
          },
        },
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(overBudget)).toBe(false);

    const provenanceMismatch = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        manifest: {
          ...request.payloads[0]!.manifest,
          sourceHash: "mesh:forged",
        },
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(provenanceMismatch)).toBe(true);
    expect(isStudioHybridDccGlbExportWorkerRequest(provenanceMismatch)).toBe(false);
    expect(unpackStudioHybridDccGlbExportInput(provenanceMismatch.payloads[0])).toBeNull();
    expect(isStudioHybridDccGlbExportWorkerRequest({ ...request, unexpected: true })).toBe(false);
  });

  it("caps batches at 64 and advertises the versioned transferable SoA transport", () => {
    const exportInput = input();
    const maximum = {
      ...requestFor(exportInput),
      payloads: Array.from(
        { length: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH },
        () => packStudioHybridDccGlbExportInput(exportInput),
      ),
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(maximum)).toBe(true);
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope({
      ...maximum,
      payloads: [...maximum.payloads, packStudioHybridDccGlbExportInput(exportInput)],
    })).toBe(false);
    expect(maximum.inputTransport).toBe("transferable-packed-soa-v1");
    expect(maximum.version).toBe(2);
  });

  it("moves packed input ownership without cloning the authoring object graph", () => {
    const request = requestFor(input("ownership"));
    const sourceBuffer = request.payloads[0]!.buffer;
    const sourceByteLength = sourceBuffer.byteLength;
    const transfers = studioHybridDccGlbExportWorkerRequestTransfers(request);
    const received = structuredClone(request, { transfer: transfers });

    expect(transfers).toEqual([sourceBuffer]);
    expect(sourceBuffer.byteLength).toBe(0);
    expect(received.payloads[0]?.buffer.byteLength).toBe(sourceByteLength);
    expect(unpackStudioHybridDccGlbExportInput(received.payloads[0]!)).toMatchObject({
      assetId: "ownership",
      mesh: { vertices: expect.any(Array), halfEdges: expect.any(Array), faces: expect.any(Array) },
    });
  });

  it("round-trips a large authoring mesh through finite little-endian packed sections", () => {
    const exportInput = largeMaterialInput();
    const payload = packStudioHybridDccGlbExportInput(exportInput);
    const restored = unpackStudioHybridDccGlbExportInput(payload);

    expect(payload.manifest).toMatchObject({
      revision: 1,
      endianness: "little",
      assetId: exportInput.assetId,
      sourceRevision: exportInput.sourceRevision,
      sourceHash: exportInput.sourceHash,
      counts: {
        vertices: exportInput.mesh.vertices.length,
        halfEdges: exportInput.mesh.halfEdges.length,
        faces: exportInput.mesh.faces.length,
      },
    });
    expect(payload.buffer.byteLength).toBeGreaterThan(100_000);
    expect(hasValidStudioHybridDccPackedMeshChecksums(payload)).toBe(true);
    for (const section of Object.values(payload.manifest.sections)) {
      if (section.encoding !== "uint8-boolean") expect(section.offset % 8).toBe(0);
      expect(section.offset + section.byteLength).toBeLessThanOrEqual(payload.buffer.byteLength);
    }
    expect(restored).toEqual(exportInput);
    const packedResult = restored && exportStudioHybridDccMeshGlb(restored);
    const directResult = exportStudioHybridDccMeshGlb(exportInput);
    expect(packedResult).toEqual(directResult);

    const invalid = input("non-finite");
    const nonFinite = {
      ...invalid,
      mesh: {
        ...invalid.mesh,
        vertices: invalid.mesh.vertices.map((vertex, index) => index === 0
          ? { ...vertex, position: { ...vertex.position, x: Number.NaN } }
          : vertex),
      },
    };
    expect(() => packStudioHybridDccGlbExportInput(nonFinite)).toThrow(/must be finite/u);
  });

  it("revalidates GLB headers, metrics, reports, and measured aggregate bytes", () => {
    const request = requestFor();
    const response = successResponse(request);
    expect(isStudioHybridDccGlbExportWorkerResponse(response)).toBe(true);
    if (response.kind !== "result" || !response.results[0]?.ok) throw new Error("expected result");
    expect(isStudioHybridDccGlbExportWorkerResponse({
      ...response,
      totalByteLength: response.totalByteLength + 4,
    })).toBe(false);
    expect(isStudioHybridDccGlbExportWorkerResponse({
      ...response,
      results: [{
        ...response.results[0],
        metrics: { ...response.results[0].metrics, glbByteLength: 12 },
      }],
    })).toBe(false);
    const forgedBytes = response.results[0].bytes.slice(0);
    new DataView(forgedBytes).setUint32(0, 0, true);
    expect(isStudioHybridDccGlbExportWorkerResponse({
      ...response,
      results: [{ ...response.results[0], bytes: forgedBytes }],
    })).toBe(false);
  });
});

describe("exportStudioHybridDccGlbBatch", () => {
  it("transfers packed SoA input ownership and restores transferred GLBs", async () => {
    const worker = new FakeWorker();
    const exportInput = input();
    const pending = exportStudioHybridDccGlbBatch([exportInput], {
      workerFactory: () => worker,
    });
    const request = worker.requests[0]!;
    expect(request.inputTransport).toBe(STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT);
    expect(Object.keys(request.payloads[0]!)).toEqual(["manifest", "buffer"]);
    expect(Object.keys(request.payloads[0]!.manifest.sections)).toEqual(
      STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES,
    );
    expect("mesh" in request.payloads[0]!).toBe(false);
    expect("renderCache" in request.payloads[0]!).toBe(false);
    expect(worker.postArgumentCounts).toEqual([2]);
    expect(worker.transfers[0]).toEqual([request.payloads[0]!.buffer]);

    const response = successResponse(request);
    worker.emitMessage(response);
    const outcome = await pending;
    const results = outcome.results;
    expect(outcome).toMatchObject({
      execution: "worker",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, mimeType: "model/gltf-binary" });
    expect(results[0]?.ok && results[0].bytes).toBeInstanceOf(Uint8Array);
    expect(results[0]?.ok && results[0].bytes.buffer).toBe(
      response.kind === "result" && response.results[0]?.ok
        ? response.results[0].bytes
        : null,
    );
    expect(worker.terminateCalls).toBe(1);
  });

  it("keeps bounded large diagnostics byte-identical across sync and Worker transports", async () => {
    const worker = new FakeWorker();
    const exportInput = largeMaterialInput();
    const synchronous = exportStudioHybridDccMeshGlb(exportInput);
    expect(synchronous.ok).toBe(true);
    const pending = exportStudioHybridDccGlbBatch([exportInput], {
      workerFactory: () => worker,
    });
    const response = successResponse(worker.requests[0]!);
    expect(isStudioHybridDccGlbExportWorkerResponse(response)).toBe(true);
    worker.emitMessage(response);
    const transported = (await pending).results;

    expect(transported[0]?.report).toEqual(synchronous.report);
    expect(transported[0]?.report.losses[0]?.faceIds).toHaveLength(
      STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS,
    );
    expect(transported[0]?.report.losses[0]?.detail).toContain("omitted=1");
  });

  it("hard-terminates aborts, stale replies, malformed replies, and Worker faults", async () => {
    const abortWorker = new FakeWorker();
    const controller = new AbortController();
    const aborted = exportStudioHybridDccGlbBatch([input("abort")], {
      workerFactory: () => abortWorker,
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(abortWorker.terminateCalls).toBe(1);

    const staleWorker = new FakeWorker();
    const stale = exportStudioHybridDccGlbBatch([input("stale")], {
      workerFactory: () => staleWorker,
    });
    staleWorker.emitMessage({ ...successResponse(staleWorker.requests[0]!), requestId: 999 });
    await expect(stale).rejects.toMatchObject({ code: "protocol" });
    expect(staleWorker.terminateCalls).toBe(1);

    const malformedWorker = new FakeWorker();
    const malformed = exportStudioHybridDccGlbBatch([input("malformed")], {
      workerFactory: () => malformedWorker,
    });
    malformedWorker.emitMessage({ kind: "result" });
    await expect(malformed).rejects.toMatchObject({ code: "protocol" });
    expect(malformedWorker.terminateCalls).toBe(1);

    const forgedWorker = new FakeWorker();
    const forged = exportStudioHybridDccGlbBatch([input("provenance")], {
      workerFactory: () => forgedWorker,
    });
    const forgedResponse = successResponse(forgedWorker.requests[0]!);
    if (forgedResponse.kind !== "result" || !forgedResponse.results[0]?.ok) {
      throw new Error("expected forged result fixture");
    }
    forgedWorker.emitMessage({
      ...forgedResponse,
      results: [{
        ...forgedResponse.results[0],
        report: {
          ...forgedResponse.results[0].report,
          source: {
            ...forgedResponse.results[0].report.source,
            assetId: "different-authority",
          },
        },
      }],
    });
    await expect(forged).rejects.toMatchObject({ code: "protocol" });
    expect(forgedWorker.terminateCalls).toBe(1);

    const crashedWorker = new FakeWorker();
    const crashed = exportStudioHybridDccGlbBatch([input("crash")], {
      workerFactory: () => crashedWorker,
    });
    crashedWorker.emitFailure("messageerror");
    await expect(crashed).rejects.toMatchObject({ code: "worker-failed" });
    expect(crashedWorker.terminateCalls).toBe(1);
  });

  it("times out, enforces the 100 MiB response gate, and rejects oversize batches", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const timedOut = exportStudioHybridDccGlbBatch([input("timeout")], {
      workerFactory: () => worker,
      timeoutMs: 100,
    });
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: "timeout",
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await timeoutAssertion;
    expect(worker.terminateCalls).toBe(1);

    const budgetWorker = new FakeWorker();
    const overBudget = exportStudioHybridDccGlbBatch([input("budget")], {
      workerFactory: () => budgetWorker,
    });
    budgetWorker.emitMessage({
      version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: budgetWorker.requests[0]!.requestId,
      code: "response-budget-exceeded",
    });
    await expect(overBudget).rejects.toMatchObject({ code: "response-budget-exceeded" });

    // Oversize explicitly-direct handoffs are chunked into protocol-sized windows.
    const oversizeCount = STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH + 3;
    const oversize = Array.from(
      { length: oversizeCount },
      (_, index) => input(`chunk-${index}`),
    );
    const oversizeOutcome = await exportStudioHybridDccGlbBatch(oversize, {
      executionBackend: "direct",
    });
    const oversizeResults = oversizeOutcome.results;
    expect(oversizeResults).toHaveLength(oversizeCount);
    expect(oversizeResults.every((result) => result.ok)).toBe(true);
    expect(oversizeOutcome).toMatchObject({
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
  });

  it("uses direct only when selected before work and defaults to fail-closed Worker", async () => {
    vi.stubGlobal("Worker", undefined);
    const exportInput = input("node-direct");
    const direct = exportStudioHybridDccMeshGlb(exportInput);
    const workerFactory = vi.fn(() => {
      throw new Error("must not construct");
    });
    const outcome = await exportStudioHybridDccGlbBatch([exportInput], {
      executionBackend: "direct",
      workerFactory,
    });
    const results = outcome.results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      report: { source: { assetId: "node-direct" } },
    });
    expect(results[0]).toEqual(direct);
    expect(outcome).toMatchObject({
      execution: "direct",
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
    expect(workerFactory).not.toHaveBeenCalled();

    const staleInput = { ...input("node-stale"), sourceHash: "mesh:00000000" };
    const staleDirect = exportStudioHybridDccMeshGlb(staleInput);
    const stalePacked = await exportStudioHybridDccGlbBatch([staleInput], {
      executionBackend: "direct",
    });
    expect(stalePacked.results[0]).toEqual(staleDirect);
    expect(stalePacked.results[0]).toMatchObject({
      ok: false,
      report: { errors: [{ code: "source-hash-mismatch" }] },
    });

    await expect(
      exportStudioHybridDccGlbBatch([input("no-fallback")]),
    ).rejects.toMatchObject({ code: "worker-unavailable" });
  });

  it("uses a static production Worker URL and never falls back after a browser Worker fault", async () => {
    const source = readFileSync(
      new URL("./studio-hybrid-dcc-glb-export-worker-client.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'new URL("./studio-hybrid-dcc-glb-export.worker.ts", import.meta.url)',
    );
    expect(source).not.toMatch(/new URL\(`[^`]*(?:test|spec)[^`]*`/u);
    expect(source).not.toContain("allowSynchronousFallback");
    expect(source).not.toContain("isNodeEnvironment");

    const failure = exportStudioHybridDccGlbBatch([input("constructor-fault")], {
      workerFactory: () => {
        throw new Error("CSP");
      },
    });
    await expect(failure).rejects.toBeInstanceOf(StudioHybridDccGlbExportClientError);
    await expect(failure).rejects.toMatchObject({ code: "worker-unavailable" });
  });
});

describe("Hybrid DCC GLB export module Worker", () => {
  it("strictly admits one request and transfers every successful GLB buffer back", async () => {
    vi.resetModules();
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const posts: Array<{ readonly response: unknown; readonly transfers: readonly Transferable[] }> = [];
    const fakeScope = {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === "message") listeners.add(listener);
      },
      postMessage(response: unknown, transfers: readonly Transferable[] = []) {
        posts.push({ response, transfers });
      },
    };
    vi.stubGlobal("self", fakeScope);
    await import("./studio-hybrid-dcc-glb-export.worker");

    const request = requestFor(input("actual-worker"), 51);
    for (const listener of listeners) listener({ data: request } as MessageEvent<unknown>);
    expect(posts).toHaveLength(1);
    expect(isStudioHybridDccGlbExportWorkerResponse(posts[0]?.response)).toBe(true);
    expect(posts[0]?.response).toMatchObject({ kind: "result", requestId: 51 });
    const response = posts[0]?.response;
    if (
      !isStudioHybridDccGlbExportWorkerResponse(response)
      || response.kind !== "result"
      || !response.results[0]?.ok
    ) throw new Error("expected a transferred Worker result");
    expect(posts[0]?.transfers).toHaveLength(1);
    expect(posts[0]?.transfers[0]).toBe(response.results[0].bytes);

    for (const listener of listeners) listener({ data: request } as MessageEvent<unknown>);
    expect(posts[1]?.response).toMatchObject({ kind: "error", code: "protocol", requestId: 51 });
  });

  it("rejects a provenance manifest whose checksum no longer binds its source", async () => {
    vi.resetModules();
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const posts: unknown[] = [];
    vi.stubGlobal("self", {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === "message") listeners.add(listener);
      },
      postMessage(response: unknown) {
        posts.push(response);
      },
    });
    await import("./studio-hybrid-dcc-glb-export.worker");
    const request = requestFor(input("manifest-provenance"), 73);
    const forged = {
      ...request,
      payloads: [{
        ...request.payloads[0],
        manifest: {
          ...request.payloads[0]!.manifest,
          sourceHash: "mesh:forged",
        },
      }],
    };
    expect(isStudioHybridDccGlbExportWorkerRequestEnvelope(forged)).toBe(true);
    expect(isStudioHybridDccGlbExportWorkerRequest(forged)).toBe(false);

    for (const listener of listeners) listener({ data: forged } as MessageEvent<unknown>);
    expect(posts).toEqual([{
      version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: 73,
      code: "protocol",
    }]);
  });

  it("preserves a legitimately packed stale-source diagnostic instead of hiding it", async () => {
    vi.resetModules();
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const posts: Array<{ readonly response: unknown; readonly transfers: readonly Transferable[] }> = [];
    vi.stubGlobal("self", {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === "message") listeners.add(listener);
      },
      postMessage(response: unknown, transfers: readonly Transferable[] = []) {
        posts.push({ response, transfers });
      },
    });
    await import("./studio-hybrid-dcc-glb-export.worker");
    const request = requestFor({
      ...input("worker-stale-source"),
      sourceHash: "mesh:00000000",
    }, 81);
    expect(isStudioHybridDccGlbExportWorkerRequest(request)).toBe(true);
    for (const listener of listeners) listener({ data: request } as MessageEvent<unknown>);

    expect(posts[0]?.response).toMatchObject({
      kind: "result",
      requestId: 81,
      results: [{
        ok: false,
        report: { errors: [{ code: "source-hash-mismatch" }] },
      }],
    });
    expect(posts[0]?.transfers).toEqual([]);
  });
});
