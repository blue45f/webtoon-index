import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  encodeStudioWillV1DocumentTransport,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS,
  runStudioFirstPartyWillV1DocumentCodecWorker,
  type StudioFirstPartyWillV1DocumentCodecWorkerLike,
} from "./studio-first-party-will-v1-document-codec-worker-client";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
  type StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";
import {
  executeStudioFirstPartyWillV1DocumentCodecWorkerMessage,
} from "./studio-first-party-will-v1-document-codec.worker";

import type { StudioCodecExecutionRequest } from "./studio-codec-provider-contract";

function request(
  direction: "decode" | "encode" = "encode",
): StudioCodecExecutionRequest {
  const manifest =
    STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest;
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: manifest.format,
    profile: manifest.profile,
    version: manifest.version,
    mimeType: manifest.mimeTypes[0]!,
    extension: manifest.extensions[0]!,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: manifest.maxInputBytes,
    maxOutputBytes: manifest.maxOutputBytes,
  });
}

async function transport(): Promise<Uint8Array> {
  return encodeStudioWillV1DocumentTransport({
    width: 328,
    height: 439,
    title: "Worker client",
    createdAt: "2026-07-30T12:34:56Z",
    application: "ToonSpectrum Studio",
    applicationVersion: "1.0.0",
    paths: [{
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 12 },
        { x: 16, y: 20 },
        { x: 28, y: 14 },
      ],
      strokeWidths: [0.75, 1.25],
      strokeColor: { r: 12, g: 34, b: 56, a: 220 },
      decimalPrecision: 2,
    }],
  });
}

interface FakeWorkerOptions {
  readonly autoRespond?: boolean;
  readonly postThrows?: boolean;
}

class FakeWorker
implements StudioFirstPartyWillV1DocumentCodecWorkerLike {
  onmessage:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onmessage"] = null;
  onerror:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onerror"] = null;
  onmessageerror:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onmessageerror"] = null;
  readonly requests:
    StudioFirstPartyWillV1DocumentCodecWorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;

  constructor(private readonly options: FakeWorkerOptions = {}) {}

  postMessage(
    message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    if (this.options.postThrows) {
      throw new DOMException(
        "/private/raw/codec.wasm clone failure",
        "DataCloneError",
      );
    }
    this.transfers.push([...transfer]);
    this.requests.push(structuredClone(message, { transfer }));
    if (this.options.autoRespond) {
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
      error: new Error("/private/raw/codec.wasm: panic"),
      message: "/private/raw/codec.wasm: panic",
      preventDefault() {},
    });
  }

  async respond(): Promise<void> {
    const message = this.requests.at(-1);
    if (!message) throw new Error("No Worker request.");
    const dispatch =
      await executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
        message,
      );
    if (!dispatch) throw new Error("Missing Worker dispatch.");
    this.emit(structuredClone(dispatch.response, {
      transfer: [...dispatch.transfer],
    }));
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("first-party WILL v1 document Worker client", () => {
  it("transfers a private snapshot, validates the result, and terminates", async () => {
    const worker = new FakeWorker({ autoRespond: true });
    const input = await transport();
    const original = input.slice();
    const originalBuffer = input.buffer;
    const result =
      await runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => worker },
      );

    expect(input.buffer).toBe(originalBuffer);
    expect(input).toEqual(original);
    expect(worker.requests).toHaveLength(1);
    expect(worker.transfers[0]).toHaveLength(1);
    expect(result.receipt).toMatchObject({
      providerId: "toonspectrum.will-v1-annex-b-document.v1",
      direction: "encode",
      input: { byteLength: input.byteLength },
      output: { byteLength: result.bytes.byteLength },
    });
    expect(worker.terminateCount).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("hard-terminates on abort and closes the registration race", async () => {
    const input = await transport();
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending =
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        {
          workerFactory: () => worker,
          signal: controller.signal,
        },
      );
    await flushMicrotasks();
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "worker-aborted",
      name: "AbortError",
    });
    expect(worker.terminateCount).toBe(1);

    const raceWorker = new FakeWorker();
    const raceController = new AbortController();
    const signal = raceController.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation((
      ...args: Parameters<AbortSignal["addEventListener"]>
    ) => {
      originalAdd(...args);
      raceController.abort();
    });
    await expect(
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => raceWorker, signal },
      ),
    ).rejects.toMatchObject({ code: "worker-aborted" });
    expect(raceWorker.requests).toHaveLength(0);
    expect(raceWorker.terminateCount).toBe(1);
  });

  it("enforces the 120-600 second timeout range and hard-terminates", async () => {
    expect(
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
    ).toBe(120_000);
    expect(
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS,
    ).toBe(120_000);
    expect(
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS,
    ).toBe(600_000);
    const input = await transport();
    const factory = vi.fn(() => new FakeWorker());
    await expect(
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { timeoutMs: 119_999, workerFactory: factory },
      ),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(factory).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending =
        runStudioFirstPartyWillV1DocumentCodecWorker(
          request(),
          input,
          { timeoutMs: 120_000, workerFactory: () => worker },
        );
      const rejection = expect(pending).rejects.toMatchObject({
        code: "worker-timeout",
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(120_000);
      await rejection;
      expect(worker.terminateCount).toBe(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed for raw runtime, startup post, and forged response data", async () => {
    const input = await transport();
    const runtimeWorker = new FakeWorker();
    const runtime =
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => runtimeWorker },
      );
    await flushMicrotasks();
    runtimeWorker.emitRawError();
    const runtimeError = await runtime.catch(
      (reason: unknown) => reason,
    );
    expect(runtimeError).toMatchObject({ code: "worker-runtime" });
    expect(String((runtimeError as Error).message)).not.toContain(
      "private",
    );
    expect(String((runtimeError as Error).message)).not.toContain("wasm");

    const postWorker = new FakeWorker({ postThrows: true });
    const postError =
      await runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => postWorker },
      ).catch((reason: unknown) => reason);
    expect(postError).toMatchObject({ code: "worker-post-failed" });
    expect(String((postError as Error).message)).not.toContain("raw");

    const forgedWorker = new FakeWorker();
    const forged =
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => forgedWorker },
      );
    await vi.waitFor(() => {
      expect(forgedWorker.requests).toHaveLength(1);
    });
    const requestId = forgedWorker.requests[0]?.requestId;
    forgedWorker.emit({
      type: "studio-first-party-will-v1-document-codec/success",
      version:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
      requestId,
      bytes: Uint8Array.of(1, 2, 3).buffer,
      receipt: { providerId: "substituted.provider" },
    });
    await expect(forged).rejects.toMatchObject({
      code: "worker-protocol",
    });
    expect(forgedWorker.terminateCount).toBe(1);

    const digestWorker = new FakeWorker();
    const digestMismatch =
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: () => digestWorker },
      );
    await vi.waitFor(() => {
      expect(digestWorker.requests).toHaveLength(1);
    });
    const dispatch =
      await executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
        digestWorker.requests[0],
      );
    if (
      !dispatch
      || dispatch.response.type
        !== "studio-first-party-will-v1-document-codec/success"
    ) {
      throw new Error("Expected a WILL document Worker success fixture.");
    }
    digestWorker.emit({
      ...structuredClone(dispatch.response),
      receipt: {
        ...dispatch.response.receipt,
        input: {
          ...dispatch.response.receipt.input,
          sha256: `sha256:${"0".repeat(64)}`,
        },
      },
    });
    await expect(digestMismatch).rejects.toMatchObject({
      code: "worker-protocol",
    });
    expect(digestWorker.terminateCount).toBe(1);
  });

  it("reports unavailable and provider failures without direct fallback", async () => {
    const input = await transport();
    await expect(
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request(),
        input,
        { workerFactory: null },
      ),
    ).rejects.toMatchObject({ code: "worker-unavailable" });

    const worker = new FakeWorker({ autoRespond: true });
    await expect(
      runStudioFirstPartyWillV1DocumentCodecWorker(
        request("decode"),
        Uint8Array.of(0),
        { workerFactory: () => worker },
      ),
    ).rejects.toMatchObject({
      code: "provider-failure",
      providerCode: "provider-runtime-error",
    });
    expect(worker.terminateCount).toBe(1);
  });
});
