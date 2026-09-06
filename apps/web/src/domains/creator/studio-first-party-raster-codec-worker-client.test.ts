import { describe, expect, it, vi } from "vitest";

import {
  encodeStudioCodecRgbaEnvelope,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";
import {
  runStudioFirstPartyRasterCodecWorker,
  StudioFirstPartyRasterCodecWorkerClient,
  type StudioFirstPartyRasterCodecWorkerLike,
} from "./studio-first-party-raster-codec-worker-client";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
  type StudioFirstPartyRasterCodecWorkerRunMessage,
} from "./studio-first-party-raster-codec-worker-protocol";
import {
  executeStudioFirstPartyRasterCodecWorkerMessage,
} from "./studio-first-party-raster-codec.worker";

import type {
  StudioCodecDirection,
  StudioCodecExecutionRequest,
} from "./studio-codec-provider-contract";

function request(
  format = "qoi",
  direction: StudioCodecDirection = "encode",
): StudioCodecExecutionRequest {
  const provider = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
    (candidate) => candidate.manifest.format === format,
  );
  if (!provider) throw new Error(`Missing fixture provider for ${format}.`);
  return {
    schemaVersion: 1,
    direction,
    format,
    profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
    mimeType: provider.manifest.mimeTypes[0]!,
    extension: provider.manifest.extensions[0]!,
    allowedModes: ["public-clean-room"],
    requireDeterministic: true,
    maxInputBytes: 4 * 1024 * 1024,
    maxOutputBytes: 4 * 1024 * 1024,
  };
}

function rgbaEnvelope(): Uint8Array {
  return encodeStudioCodecRgbaEnvelope({
    width: 2,
    height: 2,
    data: Uint8Array.of(
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ),
  });
}

function observableInput(): {
  readonly bytes: Uint8Array;
  readonly copyReads: () => number;
} {
  const bytes = rgbaEnvelope();
  let reads = 0;
  Object.defineProperty(bytes, Symbol.iterator, {
    configurable: true,
    value() {
      reads += 1;
      return Uint8Array.prototype[Symbol.iterator].call(bytes);
    },
  });
  return {
    bytes,
    copyReads: () => reads,
  };
}

interface FakeWorkerOptions {
  readonly autoRespond?: boolean;
  readonly postThrows?: boolean;
}

class FakeWorker implements StudioFirstPartyRasterCodecWorkerLike {
  onmessage: StudioFirstPartyRasterCodecWorkerLike["onmessage"] = null;
  onerror: StudioFirstPartyRasterCodecWorkerLike["onerror"] = null;
  onmessageerror:
    StudioFirstPartyRasterCodecWorkerLike["onmessageerror"] = null;
  readonly requests: StudioFirstPartyRasterCodecWorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;
  readonly #options: FakeWorkerOptions;

  constructor(options: FakeWorkerOptions = {}) {
    this.#options = options;
  }

  postMessage(
    message: StudioFirstPartyRasterCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    if (this.#options.postThrows) {
      throw new DOMException("raw clone path", "DataCloneError");
    }
    this.transfers.push([...transfer]);
    const workerMessage = structuredClone(message, { transfer });
    this.requests.push(workerMessage);
    if (this.#options.autoRespond) {
      queueMicrotask(() => {
        void this.respond();
      });
    }
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }

  emitRawError(): void {
    this.onerror?.({
      error: new Error("/private/secret/codec.wasm: raw panic"),
      message: "/private/secret/codec.wasm: raw panic",
      preventDefault() {},
    });
  }

  async respond(
    request = this.requests.at(-1),
    requestId?: number,
  ): Promise<void> {
    if (!request) throw new Error("No Worker request is available.");
    const dispatch =
      await executeStudioFirstPartyRasterCodecWorkerMessage(request);
    if (!dispatch) throw new Error("Worker dispatch was unexpectedly null.");
    const response = requestId === undefined
      ? dispatch.response
      : { ...dispatch.response, requestId };
    const transfers =
      response === dispatch.response
        ? [...dispatch.transfer]
        : [];
    this.emit(structuredClone(response, { transfer: transfers }));
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("first-party raster codec Worker client success", () => {
  it("transfers a private input snapshot, receives output ownership, and terminates", async () => {
    const worker = new FakeWorker({ autoRespond: true });
    const input = rgbaEnvelope();
    const original = input.slice();
    const originalBuffer = input.buffer;

    const result = await runStudioFirstPartyRasterCodecWorker(
      request(),
      input,
      { workerFactory: () => worker },
    );

    expect(worker.requests).toHaveLength(1);
    expect(worker.transfers).toHaveLength(1);
    expect(worker.transfers[0]).toHaveLength(1);
    expect(input.buffer).toBe(originalBuffer);
    expect(input).toEqual(original);
    expect(input.byteLength).toBeGreaterThan(0);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.receipt).toMatchObject({
      providerId: "toonspectrum.raster.qoi.v1",
      direction: "encode",
      format: "qoi",
      output: { byteLength: result.bytes.byteLength },
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("maps provider failure to a typed, raw-error-free client error", async () => {
    const worker = new FakeWorker({ autoRespond: true });
    const promise = runStudioFirstPartyRasterCodecWorker(
      request("qoi", "decode"),
      Uint8Array.of(0x00),
      { workerFactory: () => worker },
    );

    await expect(promise).rejects.toMatchObject({
      code: "provider-failure",
      providerCode: "provider-runtime-error",
      name: "StudioFirstPartyRasterCodecWorkerClientError",
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("reports unsupported requests before constructing or transferring to a Worker", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(
      runStudioFirstPartyRasterCodecWorker(
        {
          ...request(),
          format: "webp",
        },
        rgbaEnvelope(),
        { workerFactory },
      ),
    ).rejects.toMatchObject({
      code: "unsupported-format",
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("does not snapshot large input when already aborted or explicitly unsupported", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const aborted = new AbortController();
    aborted.abort();
    const first = observableInput();
    await expect(
      runStudioFirstPartyRasterCodecWorker(
        request(),
        first.bytes,
        {
          workerFactory,
          signal: aborted.signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "worker-aborted",
    });
    expect(first.copyReads()).toBe(0);
    expect(workerFactory).not.toHaveBeenCalled();

    const second = observableInput();
    await expect(
      runStudioFirstPartyRasterCodecWorker(
        request(),
        second.bytes,
        { workerFactory: null },
      ),
    ).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    expect(second.copyReads()).toBe(0);
  });
});

describe("first-party raster codec Worker client lifecycle", () => {
  it("terminates the running Worker when AbortSignal fires", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = runStudioFirstPartyRasterCodecWorker(
      request(),
      rgbaEnvelope(),
      {
        workerFactory: () => worker,
        signal: controller.signal,
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "worker-aborted",
      name: "AbortError",
    });
    await flushMicrotasks();

    controller.abort();

    await rejection;
    expect(worker.terminateCount).toBe(1);
  });

  it("closes the abort registration race without posting detached input", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation((
      ...args: Parameters<AbortSignal["addEventListener"]>
    ) => {
      originalAdd(...args);
      controller.abort();
    });

    await expect(
      runStudioFirstPartyRasterCodecWorker(
        request(),
        rgbaEnvelope(),
        { workerFactory: () => worker, signal },
      ),
    ).rejects.toMatchObject({
      code: "worker-aborted",
    });
    expect(worker.requests).toHaveLength(0);
    expect(worker.transfers).toHaveLength(0);
    expect(worker.terminateCount).toBe(1);
  });

  it("times out with hard termination", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = runStudioFirstPartyRasterCodecWorker(
        request(),
        rgbaEnvelope(),
        {
          timeoutMs: 5,
          workerFactory: () => worker,
        },
      );
      const rejection = expect(pending).rejects.toMatchObject({
        code: "worker-timeout",
        name: "TimeoutError",
      });

      await vi.advanceTimersByTimeAsync(5);

      await rejection;
      expect(worker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast for a wrong request id instead of retaining the job", async () => {
    const worker = new FakeWorker();
    const client = new StudioFirstPartyRasterCodecWorkerClient({
      workerFactory: () => worker,
    });
    const pending = client.run(request(), rgbaEnvelope());
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    const posted = worker.requests[0]!;

    await worker.respond(posted, posted.requestId + 100);
    await expect(pending).rejects.toMatchObject({
      code: "worker-protocol",
    });
    expect(client.hasActiveJob).toBe(false);
    expect(worker.terminateCount).toBe(1);
    client.dispose();
  });
});

describe("first-party raster codec Worker client fail-closed errors", () => {
  it("does not expose raw Worker runtime errors", async () => {
    const worker = new FakeWorker();
    const pending = runStudioFirstPartyRasterCodecWorker(
      request(),
      rgbaEnvelope(),
      { workerFactory: () => worker },
    );
    await flushMicrotasks();

    worker.emitRawError();

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: "worker-runtime",
    });
    expect(String((error as Error).message)).not.toContain("secret");
    expect(String((error as Error).message)).not.toContain("wasm");
    expect(worker.terminateCount).toBe(1);
  });

  it("fails closed for a malformed correlated success envelope", async () => {
    const worker = new FakeWorker();
    const pending = runStudioFirstPartyRasterCodecWorker(
      request(),
      rgbaEnvelope(),
      { workerFactory: () => worker },
    );
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    const posted = worker.requests[0]!;

    worker.emit({
      type: "studio-first-party-raster-codec/success",
      version:
        STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
      requestId: posted.requestId,
      bytes: new ArrayBuffer(4),
      receipt: { providerId: "attacker" },
    });

    await expect(pending).rejects.toMatchObject({
      code: "worker-protocol",
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a valid-shaped receipt whose input digest was substituted", async () => {
    const worker = new FakeWorker();
    const pending = runStudioFirstPartyRasterCodecWorker(
      request(),
      rgbaEnvelope(),
      { workerFactory: () => worker },
    );
    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1);
    });
    const posted = worker.requests[0]!;
    const dispatch =
      await executeStudioFirstPartyRasterCodecWorkerMessage(posted);
    if (
      !dispatch
      || dispatch.response.type
        !== "studio-first-party-raster-codec/success"
    ) {
      throw new Error("Expected a raster Worker success fixture.");
    }
    worker.emit({
      ...structuredClone(dispatch.response),
      receipt: {
        ...dispatch.response.receipt,
        input: {
          ...dispatch.response.receipt.input,
          sha256: `sha256:${"0".repeat(64)}`,
        },
      },
    });

    await expect(pending).rejects.toMatchObject({
      code: "worker-protocol",
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("returns explicit unavailable and post failures without direct fallback", async () => {
    await expect(
      runStudioFirstPartyRasterCodecWorker(
        request(),
        rgbaEnvelope(),
        { workerFactory: null },
      ),
    ).rejects.toMatchObject({
      code: "worker-unavailable",
    });

    const worker = new FakeWorker({ postThrows: true });
    const failed = runStudioFirstPartyRasterCodecWorker(
      request(),
      rgbaEnvelope(),
      { workerFactory: () => worker },
    );
    const error = await failed.catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: "worker-post-failed",
    });
    expect(String((error as Error).message)).not.toContain("clone path");
    expect(worker.terminateCount).toBe(1);
  });
});
