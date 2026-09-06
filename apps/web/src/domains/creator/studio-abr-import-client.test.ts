import { describe, expect, it, vi } from "vitest";

import { importStudioAbrFile } from "./studio-abr-import-client";
import { STUDIO_ABR_WORKER_PROTOCOL_VERSION } from "./studio-abr-import-worker-protocol";

import type { StudioAbrImportResult } from "./studio-abr-import";
import type { StudioAbrWorkerRequest } from "./studio-abr-import-worker-protocol";

function abrFile(): File {
  return new File([Uint8Array.of(0, 10, 0, 1)], "pack.abr", { type: "application/octet-stream" });
}

function emptyResult(): StudioAbrImportResult {
  return {
    brushes: [],
    sourceBrushCount: 0,
    sourceSampleCount: 0,
    skippedBrushCount: 0,
    approximatedBrushCount: 0,
  };
}

describe("Studio ABR worker client", () => {
  it("transfers the owned buffer, accepts one correlated response and terminates the worker", async () => {
    const messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
    let terminated = 0;
    let transferred: Transferable[] = [];
    const result = await importStudioAbrFile(abrFile(), {
      executionBackend: "worker",
      workerFactory: () => ({
        postMessage(request: StudioAbrWorkerRequest, transfer: Transferable[]) {
          transferred = transfer;
          queueMicrotask(() => {
            for (const listener of messageListeners) listener({ data: {
              version: STUDIO_ABR_WORKER_PROTOCOL_VERSION,
              requestId: request.requestId,
              ok: true,
              result: emptyResult(),
            } } as MessageEvent<unknown>);
          });
        },
        addEventListener(type, listener) {
          if (type === "message") messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
        },
        removeEventListener(type, listener) {
          if (type === "message") messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
        },
        terminate() { terminated++; },
      }),
    });
    expect(result.sourceBrushCount).toBe(0);
    expect(transferred).toHaveLength(1);
    expect(terminated).toBe(1);
  });

  it("runs the direct provider only when direct was selected before reading the file", async () => {
    const directImporter = vi.fn(async (bytes: ArrayBuffer) => {
      expect(Array.from(new Uint8Array(bytes))).toEqual([0, 10, 0, 1]);
      return emptyResult();
    });
    const workerFactory = vi.fn(() => null);

    const result = await importStudioAbrFile(abrFile(), {
      executionBackend: "direct",
      workerFactory,
      directImporter,
    });

    expect(result).toEqual(emptyResult());
    expect(directImporter).toHaveBeenCalledOnce();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("defaults to Worker and fails closed when that backend is unavailable or cannot be created", async () => {
    const directImporter = vi.fn(async () => emptyResult());

    await expect(importStudioAbrFile(abrFile(), {
      workerFactory: null,
      directImporter,
    })).rejects.toMatchObject({ code: "worker" });

    const throwingFactory = vi.fn(() => {
      throw new Error("worker constructor blocked");
    });
    await expect(importStudioAbrFile(abrFile(), {
      executionBackend: "worker",
      workerFactory: throwingFactory,
      directImporter,
    })).rejects.toMatchObject({ code: "worker" });

    expect(throwingFactory).toHaveBeenCalledOnce();
    expect(directImporter).not.toHaveBeenCalled();
  });

  it("does not rerun direct import after Worker post or runtime failure", async () => {
    const directImporter = vi.fn(async () => emptyResult());
    let postAttempts = 0;
    let postFailureTerminations = 0;
    await expect(importStudioAbrFile(abrFile(), {
      executionBackend: "worker",
      directImporter,
      workerFactory: () => ({
        postMessage() {
          postAttempts += 1;
          throw new DOMException("clone failed", "DataCloneError");
        },
        addEventListener() {},
        removeEventListener() {},
        terminate() { postFailureTerminations += 1; },
      }),
    })).rejects.toMatchObject({ code: "worker" });
    expect(postAttempts).toBe(1);
    expect(postFailureTerminations).toBe(1);

    const errorListeners = new Set<() => void>();
    let runtimePostAttempts = 0;
    let runtimeFailureTerminations = 0;
    await expect(importStudioAbrFile(abrFile(), {
      executionBackend: "worker",
      directImporter,
      workerFactory: () => ({
        postMessage() {
          runtimePostAttempts += 1;
          queueMicrotask(() => {
            for (const listener of errorListeners) listener();
          });
        },
        addEventListener(type, listener) {
          if (type === "error") errorListeners.add(listener as () => void);
        },
        removeEventListener(type, listener) {
          if (type === "error") errorListeners.delete(listener as () => void);
        },
        terminate() { runtimeFailureTerminations += 1; },
      }),
    })).rejects.toMatchObject({ code: "worker" });
    expect(runtimePostAttempts).toBe(1);
    expect(runtimeFailureTerminations).toBe(1);
    expect(directImporter).not.toHaveBeenCalled();
  });

  it("treats a missing Worker response as terminal without changing backends", async () => {
    vi.useFakeTimers();
    try {
      const directImporter = vi.fn(async () => emptyResult());
      let resolvePosted: () => void = () => undefined;
      const posted = new Promise<void>((resolve) => {
        resolvePosted = resolve;
      });
      let terminated = 0;
      const pending = importStudioAbrFile(abrFile(), {
        executionBackend: "worker",
        timeoutMs: 1_000,
        directImporter,
        workerFactory: () => ({
          postMessage() { resolvePosted(); },
          addEventListener() {},
          removeEventListener() {},
          terminate() { terminated += 1; },
        }),
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await posted;
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(terminated).toBe(1);
      expect(directImporter).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hard-cancels a running parser worker", async () => {
    const controller = new AbortController();
    const directImporter = vi.fn(async () => emptyResult());
    let terminated = 0;
    const promise = importStudioAbrFile(abrFile(), {
      executionBackend: "worker",
      signal: controller.signal,
      directImporter,
      workerFactory: () => ({
        postMessage() { controller.abort(); },
        addEventListener() {},
        removeEventListener() {},
        terminate() { terminated++; },
      }),
    });
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(terminated).toBe(1);
    expect(directImporter).not.toHaveBeenCalled();
  });
});
