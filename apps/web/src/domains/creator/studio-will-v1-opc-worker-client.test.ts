import { describe, expect, it, vi } from "vitest";

import { STUDIO_WILL_V1_LIMITS } from "./studio-will-v1-interchange";
import {
  buildStudioWillV1OpcBytes,
  importStudioWillV1Opc,
} from "./studio-will-v1-opc-interchange";
import {
  inspectStudioWillV1OpcPacked,
  packStudioWillV1OpcBuildResult,
  packStudioWillV1OpcImportResult,
  unpackStudioWillV1OpcExportInput,
} from "./studio-will-v1-opc-packed-codec";
import {
  buildStudioWillV1OpcBytesInWorker,
  importStudioWillV1OpcInWorker,
  type StudioWillV1OpcWorkerLike,
} from "./studio-will-v1-opc-worker-client";
import {
  STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
  studioWillV1OpcWorkerResponseTransfers,
  type StudioWillV1OpcWorkerRequest,
  type StudioWillV1OpcWorkerResponse,
} from "./studio-will-v1-opc-worker-protocol";

const SAMPLE_INPUT = {
  width: 32,
  height: 24,
  title: "Worker sample",
  paths: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      strokeWidths: [1, 2],
      strokeColor: { r: 10, g: 20, b: 30, a: 255 },
    },
  ],
};

class FakeWorker implements StudioWillV1OpcWorkerLike {
  onmessage: StudioWillV1OpcWorkerLike["onmessage"] = null;
  onerror: StudioWillV1OpcWorkerLike["onerror"] = null;
  onmessageerror: StudioWillV1OpcWorkerLike["onmessageerror"] = null;
  readonly requests: StudioWillV1OpcWorkerRequest[] = [];
  readonly transferCounts: number[] = [];
  terminateCount = 0;

  constructor(
    private readonly autoRespond = false,
    private readonly postThrows = false,
  ) {}

  postMessage(
    message: StudioWillV1OpcWorkerRequest,
    transfer: Transferable[],
  ): void {
    if (this.postThrows) throw new DOMException("secret path", "DataCloneError");
    this.transferCounts.push(transfer.length);
    const request = structuredClone(message, { transfer });
    this.requests.push(request);
    if (this.autoRespond) {
      queueMicrotask(() => {
        void this.respond(request);
      });
    }
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }

  async respond(request = this.requests.at(-1)): Promise<void> {
    if (!request) throw new Error("No request");
    let response: StudioWillV1OpcWorkerResponse;
    if (request.type === "studio-will-v1-opc/encode") {
      const input = unpackStudioWillV1OpcExportInput(
        request.packedInput,
        request.options,
      );
      const result = await buildStudioWillV1OpcBytes(input, request.options);
      response = {
        type: "studio-will-v1-opc/encode-success",
        version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        archive: result.bytes.slice(),
        packedResult: packStudioWillV1OpcBuildResult(result, request.options),
      };
    } else {
      const result = await importStudioWillV1Opc(request.source, request.options);
      response = {
        type: "studio-will-v1-opc/decode-success",
        version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        packedResult: packStudioWillV1OpcImportResult(result, request.options),
      };
    }
    this.emit(structuredClone(response, {
      transfer: studioWillV1OpcWorkerResponseTransfers(response),
    }));
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("WILL v1 OPC Worker client packed success", () => {
  it("roundtrips while preserving public API models and transferring only packed buffers", async () => {
    const inputSnapshot = structuredClone(SAMPLE_INPUT);
    const encodeWorker = new FakeWorker(true);
    const encoded = await buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      requestIdFactory: () => "encode",
      workerFactory: () => encodeWorker,
    });
    expect(SAMPLE_INPUT).toEqual(inputSnapshot);
    expect(encoded.paths).toHaveLength(1);
    expect(encoded.bytes.byteLength).toBeGreaterThan(22);
    expect(encodeWorker.transferCounts).toEqual([1]);
    expect(encodeWorker.requests[0]).not.toHaveProperty("input");
    const encodeRequest = encodeWorker.requests[0]!;
    if (encodeRequest.type !== "studio-will-v1-opc/encode") throw new Error("encode");
    expect(inspectStudioWillV1OpcPacked(
      encodeRequest.packedInput,
      "export-input",
    )).toMatchObject({ totalPoints: 4 });

    const sourceBuffer = encoded.bytes.buffer;
    const sourceSnapshot = encoded.bytes.slice();
    const decodeWorker = new FakeWorker(true);
    const decodeMaterialization = vi.fn();
    const decoded = await importStudioWillV1OpcInWorker(encoded.bytes, {
      willLimits: { maxTotalPoints: 200_000 },
      onDecodeMaterialization: decodeMaterialization,
      requestIdFactory: () => "decode",
      workerFactory: () => decodeWorker,
    });
    expect(decoded).toMatchObject({
      width: SAMPLE_INPUT.width,
      height: SAMPLE_INPUT.height,
      title: SAMPLE_INPUT.title,
    });
    expect(decoded.paths).toEqual(encoded.paths);
    expect(encoded.bytes.buffer).toBe(sourceBuffer);
    expect(encoded.bytes).toEqual(sourceSnapshot);
    expect(decodeWorker.transferCounts).toEqual([1]);
    const decodeRequest = decodeWorker.requests[0]!;
    if (decodeRequest.type !== "studio-will-v1-opc/decode") throw new Error("decode");
    expect(decodeRequest.options?.willLimits?.maxTotalPoints).toBe(200_000);
    expect(decodeRequest).not.toHaveProperty("onDecodeMaterialization");
    expect(decodeMaterialization).toHaveBeenCalledOnce();
    expect(decodeMaterialization).toHaveBeenCalledWith({
      materializedPathObjects: 1,
      materializedPointObjects: 4,
      packedPointCount: 4,
      pointObjectBudget: 200_000,
    });
    expect(encodeWorker.terminateCount).toBe(1);
    expect(decodeWorker.terminateCount).toBe(1);
  });

  it("keeps Blob reading inside the Worker", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const imported = await importStudioWillV1Opc(built.bytes);
    const blob = new Blob([built.bytes.slice().buffer as ArrayBuffer]);
    const arrayBufferSpy = vi.spyOn(blob, "arrayBuffer");
    const worker = new FakeWorker();
    const pending = importStudioWillV1OpcInWorker(blob, {
      requestIdFactory: () => "blob",
      workerFactory: () => worker,
    });
    await flushMicrotasks();
    expect(worker.transferCounts).toEqual([0]);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    worker.emit({
      type: "studio-will-v1-opc/decode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "blob",
      packedResult: packStudioWillV1OpcImportResult(imported),
    });
    await expect(pending).resolves.toMatchObject({ title: SAMPLE_INPUT.title });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it(
    "accepts one million points without cloning their object graph into the request",
    async () => {
      const point = { x: 1, y: 2 };
      const paths = Array.from({ length: 10 }, () => ({
        points: new Array(100_000).fill(point),
        strokeWidths: [1],
        strokeColor: { r: 0, g: 0, b: 0, a: 255 },
      }));
      const worker = new FakeWorker();
      const pending = buildStudioWillV1OpcBytesInWorker(
        { width: 10, height: 10, paths },
        {
          willLimits: { maxTotalPoints: 1_000_000 },
          requestIdFactory: () => "million",
          workerFactory: () => worker,
        },
      );
      const rejection = expect(pending).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
      await flushMicrotasks();
      const request = worker.requests[0]!;
      expect(request).not.toHaveProperty("input");
      if (request.type !== "studio-will-v1-opc/encode") throw new Error("encode");
      expect(inspectStudioWillV1OpcPacked(
        request.packedInput,
        "export-input",
      )).toMatchObject({ totalPoints: 1_000_000 });
      worker.emit({
        type: "studio-will-v1-opc/failure",
        version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
        requestId: "million",
        operation: "encode",
        error: {
          code: "OPERATION_FAILED",
          name: "Error",
          message: "synthetic stop",
        },
      });
      await rejection;
    },
    30_000,
  );
});

describe("WILL v1 OPC Worker client lifecycle and failure isolation", () => {
  it("preserves abort, timeout, post failure, and runtime failure behavior", async () => {
    const abortWorker = new FakeWorker();
    const controller = new AbortController();
    const aborted = buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      signal: controller.signal,
      workerFactory: () => abortWorker,
    });
    const abortExpectation = expect(aborted).rejects.toMatchObject({
      code: "ABORTED",
      name: "AbortError",
    });
    await flushMicrotasks();
    controller.abort();
    await abortExpectation;
    expect(abortWorker.terminateCount).toBe(1);

    await expect(buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      workerFactory: () => new FakeWorker(false, true),
    })).rejects.toMatchObject({ code: "WORKER_POST_FAILED" });

    const runtimeWorker = new FakeWorker();
    const runtime = buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      workerFactory: () => runtimeWorker,
    });
    await flushMicrotasks();
    runtimeWorker.onerror?.({
      error: new Error("/private/secret"),
      message: "/private/secret",
      preventDefault() {},
    });
    const runtimeError = await runtime.catch((error: unknown) => error);
    expect(runtimeError).toMatchObject({ code: "WORKER_RUNTIME" });
    expect(String((runtimeError as Error).message)).not.toContain("private");
  });

  it("terminates and detaches a never-responding Worker at the hard timeout", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
        timeoutMs: 5,
        workerFactory: () => worker,
      });
      const rejection = expect(pending).rejects.toMatchObject({
        code: "WORKER_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(5);
      await rejection;
      expect(worker.terminateCount).toBe(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
      // A late or compromised response cannot revive the settled download promise.
      worker.emit({
        type: "studio-will-v1-opc/encode-success",
        version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
        requestId: "late",
        archive: new Uint8Array(22),
        packedResult: new Uint8Array(128),
      });
      expect(worker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast on wrong request IDs and malformed packed results", async () => {
    const wrongWorker = new FakeWorker();
    const wrong = buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      requestIdFactory: () => "current",
      workerFactory: () => wrongWorker,
    });
    const wrongRejection = expect(wrong).rejects.toMatchObject({
      code: "WORKER_PROTOCOL",
    });
    await flushMicrotasks();
    wrongWorker.emit({
      type: "studio-will-v1-opc/encode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "stale",
      archive: new Uint8Array(22),
      packedResult: new Uint8Array(128),
    });
    await wrongRejection;

    const malformedWorker = new FakeWorker();
    const malformed = buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      requestIdFactory: () => "malformed",
      workerFactory: () => malformedWorker,
    });
    const malformedRejection = expect(malformed).rejects.toMatchObject({
      code: "WORKER_PROTOCOL",
    });
    await flushMicrotasks();
    malformedWorker.emit({
      type: "studio-will-v1-opc/encode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "malformed",
      archive: new Uint8Array(22),
      packedResult: new Uint8Array(128),
    });
    await malformedRejection;
  });
});

describe("WILL v1 OPC Worker client preflight", () => {
  it("rejects budgets before Worker creation and allows the core one-million maximum", async () => {
    const factory = vi.fn(() => new FakeWorker());
    await expect(buildStudioWillV1OpcBytesInWorker(SAMPLE_INPUT, {
      willLimits: { maxTotalPoints: STUDIO_WILL_V1_LIMITS.maxTotalPoints + 1 },
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "OPTIONS_INVALID" });
    await expect(buildStudioWillV1OpcBytesInWorker({
      ...SAMPLE_INPUT,
      paths: [],
    }, {
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "STROKES_INVALID" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("copies a Uint8Array subview into a private exact transfer buffer", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const backing = new Uint8Array(built.bytes.byteLength + 20);
    backing.set(built.bytes, 10);
    const source = backing.subarray(10, 10 + built.bytes.byteLength);
    const worker = new FakeWorker();
    const pending = importStudioWillV1OpcInWorker(source, {
      requestIdFactory: () => "subview",
      workerFactory: () => worker,
    });
    await flushMicrotasks();
    const request = worker.requests[0]!;
    if (request.type !== "studio-will-v1-opc/decode") throw new Error("decode");
    if (!(request.source instanceof Uint8Array)) throw new Error("bytes");
    expect(request.source.byteOffset).toBe(0);
    expect(request.source.buffer.byteLength).toBe(request.source.byteLength);
    expect(request.source.byteLength).toBe(built.bytes.byteLength);
    worker.emit({
      type: "studio-will-v1-opc/failure",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "subview",
      operation: "decode",
      error: {
        code: "OPERATION_FAILED",
        name: "Error",
        message: "stop",
      },
    });
    await expect(pending).rejects.toMatchObject({ code: "OPERATION_FAILED" });
  });

  it("rejects an oversized packed response before reporting any materialized point objects", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const imported = await importStudioWillV1Opc(built.bytes);
    const packedResult = packStudioWillV1OpcImportResult({
      ...imported,
      paths: [
        imported.paths[0]!,
        {
          ...imported.paths[0]!,
          strokeColor: { r: 1, g: 2, b: 3, a: 255 },
        },
      ],
    });
    const worker = new FakeWorker();
    const onDecodeMaterialization = vi.fn();
    const pending = importStudioWillV1OpcInWorker(built.bytes, {
      willLimits: { maxTotalPoints: 4 },
      onDecodeMaterialization,
      requestIdFactory: () => "bounded-main",
      workerFactory: () => worker,
    });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "RESOURCE_LIMIT",
    });
    await flushMicrotasks();
    worker.emit({
      type: "studio-will-v1-opc/decode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "bounded-main",
      packedResult,
    });

    await rejection;
    expect(onDecodeMaterialization).not.toHaveBeenCalled();
  });
});
