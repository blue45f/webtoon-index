import { afterEach, describe, expect, it, vi } from "vitest";

import {
  admitStudioLayerLiftArtifactPair,
  type StudioLayerLiftArtifactPairInput,
  type StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import {
  StudioLayerLiftArtifactWorkerClientError,
  admitStudioLayerLiftArtifactPairInWorker,
  type StudioLayerLiftArtifactWorkerLike,
} from "./studio-layer-lift-artifact-worker-client";
import {
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
  type StudioLayerLiftArtifactWorkerRequest,
  type StudioLayerLiftArtifactWorkerResult,
} from "./studio-layer-lift-artifact-worker-protocol";

const BACKGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";
const FOREGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

type MessageListener = (event: MessageEventLike) => void;
type ErrorListener = (event: ErrorEventLike) => void;

class FakeWorker implements StudioLayerLiftArtifactWorkerLike {
  readonly posts: Array<{
    readonly request: StudioLayerLiftArtifactWorkerRequest;
    readonly transfer: readonly Transferable[];
  }> = [];
  terminated = false;
  postError: unknown;
  onPost?: (
    request: StudioLayerLiftArtifactWorkerRequest,
    transfer: readonly Transferable[],
  ) => void;

  readonly #messageListeners = new Set<MessageListener>();
  readonly #errorListeners = new Set<ErrorListener>();
  readonly #messageErrorListeners = new Set<ErrorListener>();

  postMessage(
    request: StudioLayerLiftArtifactWorkerRequest,
    transfer: readonly Transferable[],
  ): void {
    if (this.postError !== undefined) {
      throw this.postError;
    }
    this.posts.push({ request, transfer });
    this.onPost?.(request, transfer);
  }

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: ErrorListener,
  ): void;
  addEventListener(
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

  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: ErrorListener,
  ): void;
  removeEventListener(
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

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.#messageListeners) {
      listener({ data });
    }
  }

  emitFailure(type: "error" | "messageerror"): void {
    const listeners =
      type === "error" ? this.#errorListeners : this.#messageErrorListeners;
    for (const listener of listeners) {
      listener({ preventDefault: vi.fn() });
    }
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function input(): StudioLayerLiftArtifactPairInput {
  return {
    requestId: "lift-request-1",
    sourceId: "scene-source-1",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: "lift-background-1",
      bytes: ownedBuffer(decodeBase64(BACKGROUND_PNG_BASE64)),
    },
    foreground: {
      outputId: "lift-foreground-1",
      bytes: ownedBuffer(decodeBase64(FOREGROUND_PNG_BASE64)),
    },
  };
}

async function trustedFixture(): Promise<StudioLayerLiftTrustedArtifactPair> {
  return admitStudioLayerLiftArtifactPair(input(), {
    decodePngDimensions: async () => ({ width: 4, height: 1 }),
  });
}

function response(
  request: StudioLayerLiftArtifactWorkerRequest,
  trusted: StudioLayerLiftTrustedArtifactPair,
  identity: Partial<Pick<StudioLayerLiftArtifactWorkerResult, "generation" | "sequence">> = {},
): StudioLayerLiftArtifactWorkerResult {
  return {
    version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
    generation: identity.generation ?? request.generation,
    sequence: identity.sequence ?? request.sequence,
    receipt: trusted.receipt,
    backgroundByteLength: trusted.background.byteLength,
    foregroundByteLength: trusted.foreground.byteLength,
    backgroundBytes: trusted.background.bytes,
    foregroundBytes: trusted.foreground.bytes,
  };
}

function expectClientError(
  code: StudioLayerLiftArtifactWorkerClientError["code"],
): (error: unknown) => boolean {
  return (error: unknown) => {
    expect(error).toBeInstanceOf(StudioLayerLiftArtifactWorkerClientError);
    expect((error as StudioLayerLiftArtifactWorkerClientError).code).toBe(code);
    return true;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("admitStudioLayerLiftArtifactPairInWorker", () => {
  it("transfers both input buffers and verifies the returned receipt bytes", async () => {
    const requestInput = input();
    const originalBackground = requestInput.background.bytes as ArrayBuffer;
    const originalForeground = requestInput.foreground.bytes as ArrayBuffer;
    const trusted = await trustedFixture();
    const worker = new FakeWorker();
    worker.onPost = (posted) => {
      queueMicrotask(() => worker.emitMessage(response(posted, trusted)));
    };

    const result = await admitStudioLayerLiftArtifactPairInWorker(requestInput, {
      workerFactory: () => worker,
    });

    expect(worker.posts).toHaveLength(1);
    expect(worker.posts[0]!.transfer).toEqual([
      originalBackground,
      originalForeground,
    ]);
    expect(result.receipt).toEqual(trusted.receipt);
    expect(result.receipt).not.toBe(trusted.receipt);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.background)).toBe(true);
    expect(Object.isFrozen(result.receipt.foreground)).toBe(true);
    expect(result.background.bytes).not.toBe(trusted.background.bytes);
    expect(result.foreground.bytes).not.toBe(trusted.foreground.bytes);
    expect(new Uint8Array(result.background.bytes)).toEqual(
      new Uint8Array(trusted.background.bytes),
    );
    expect(new Uint8Array(result.foreground.bytes)).toEqual(
      new Uint8Array(trusted.foreground.bytes),
    );
    expect(worker.terminated).toBe(true);
  });

  it("ignores a valid stale generation/sequence before accepting current authority", async () => {
    const trusted = await trustedFixture();
    const worker = new FakeWorker();
    worker.onPost = (posted) => {
      queueMicrotask(() => {
        worker.emitMessage(
          response(posted, trusted, {
            generation:
              posted.generation === 0x7fff_ffff ? 1 : posted.generation + 1,
          }),
        );
        worker.emitMessage(response(posted, trusted));
      });
    };

    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => worker,
      }),
    ).resolves.toMatchObject({
      receipt: { requestId: "lift-request-1", sourceId: "scene-source-1" },
    });
  });

  it("rejects malformed current responses and receipt authority tampering", async () => {
    const trusted = await trustedFixture();
    const malformedWorker = new FakeWorker();
    malformedWorker.onPost = (posted) => {
      queueMicrotask(() =>
        malformedWorker.emitMessage({
          ...response(posted, trusted),
          extra: true,
        }),
      );
    };
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => malformedWorker,
      }),
    ).rejects.toSatisfy(expectClientError("protocol"));

    const receiptWorker = new FakeWorker();
    receiptWorker.onPost = (posted) => {
      queueMicrotask(() =>
        receiptWorker.emitMessage({
          ...response(posted, trusted),
          receipt: {
            ...trusted.receipt,
            requestId: "other-request",
          },
        }),
      );
    };
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => receiptWorker,
      }),
    ).rejects.toSatisfy(expectClientError("receipt-mismatch"));
  });

  it("lets the first current-identity response consume authority during async verification", async () => {
    const trusted = await trustedFixture();
    const worker = new FakeWorker();
    worker.onPost = (posted) => {
      queueMicrotask(() => {
        worker.emitMessage({
          ...response(posted, trusted),
          receipt: {
            ...trusted.receipt,
            requestId: "other-request",
          },
        });
        worker.emitMessage(response(posted, trusted));
      });
    };

    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => worker,
      }),
    ).rejects.toSatisfy(expectClientError("receipt-mismatch"));
  });

  it("re-hashes actual returned bytes and rejects output mutation", async () => {
    const trusted = await trustedFixture();
    new Uint8Array(trusted.foreground.bytes)[12] ^= 0x01;
    const worker = new FakeWorker();
    worker.onPost = (posted) => {
      queueMicrotask(() => worker.emitMessage(response(posted, trusted)));
    };

    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => worker,
      }),
    ).rejects.toSatisfy(expectClientError("receipt-mismatch"));
  });

  it("propagates bounded worker errors and worker event failures", async () => {
    const errorWorker = new FakeWorker();
    errorWorker.onPost = (posted) => {
      queueMicrotask(() =>
        errorWorker.emitMessage({
          version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
          kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
          generation: posted.generation,
          sequence: posted.sequence,
          code: "invalid-png",
          message: "CRC mismatch",
        }),
      );
    };
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => errorWorker,
      }),
    ).rejects.toSatisfy(expectClientError("invalid-png"));

    const failedWorker = new FakeWorker();
    failedWorker.onPost = () => {
      queueMicrotask(() => failedWorker.emitFailure("error"));
    };
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => failedWorker,
      }),
    ).rejects.toSatisfy(expectClientError("worker-failed"));
  });

  it("does not create or transfer to a worker for a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const workerFactory = vi.fn(() => new FakeWorker());

    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        signal: controller.signal,
        workerFactory,
      }),
    ).rejects.toSatisfy(expectClientError("aborted"));
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("terminates the worker on in-flight abort and timeout", async () => {
    const controller = new AbortController();
    const abortedWorker = new FakeWorker();
    const aborted = admitStudioLayerLiftArtifactPairInWorker(input(), {
      signal: controller.signal,
      workerFactory: () => abortedWorker,
    });
    controller.abort();
    await expect(aborted).rejects.toSatisfy(expectClientError("aborted"));
    expect(abortedWorker.terminated).toBe(true);

    vi.useFakeTimers();
    const timedOutWorker = new FakeWorker();
    const timedOut = admitStudioLayerLiftArtifactPairInWorker(input(), {
      timeoutMs: 5,
      workerFactory: () => timedOutWorker,
    });
    const rejection = expect(timedOut).rejects.toSatisfy(
      expectClientError("timeout"),
    );
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
    expect(timedOutWorker.terminated).toBe(true);
  });

  it("fails closed when worker creation or postMessage fails", async () => {
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => null,
      }),
    ).rejects.toSatisfy(expectClientError("worker-unavailable"));

    const worker = new FakeWorker();
    worker.postError = new Error("clone failed");
    await expect(
      admitStudioLayerLiftArtifactPairInWorker(input(), {
        workerFactory: () => worker,
      }),
    ).rejects.toSatisfy(expectClientError("post-failed"));
    expect(worker.terminated).toBe(true);
  });
});
