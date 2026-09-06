import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioAbortableSerialQueue } from "./studio-abortable-serial-queue";
import { disposeStudioRetouchModuleWorker, runStudioRetouchWorker } from "./studio-retouch-worker-client";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";
import { smudgeStroke } from "./studio-smudge";
import { disposeStudioSmudgeModuleWorker, runStudioSmudgeWorker } from "./studio-smudge-worker-client";

import type { StudioRetouchWorkerRunMessage, StudioRetouchWorkerRunRequest } from "./studio-retouch-worker-protocol";
import type { StudioSmudgeWorkerRunMessage, StudioSmudgeWorkerRunRequest } from "./studio-smudge-worker-protocol";

function pixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7) % 256;
    data[i + 1] = (i * 11) % 256;
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
  return data;
}

function smudgeRequest(): StudioSmudgeWorkerRunRequest {
  return { data: pixels(), w: 8, h: 8, points: [{ x: 3, y: 3 }, { x: 6, y: 5 }], radiusPx: 3, strength: 0.5 };
}

function retouchRequest(): StudioRetouchWorkerRunRequest {
  return {
    kind: "dodge-burn", data: pixels(), w: 8, h: 8, points: [{ x: 4, y: 4 }],
    settings: { radiusPx: 3, hardness: 0.5, exposure: 50, mode: "dodge", range: "midtones", sponge: "saturate" },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}

function outcome(promise: Promise<unknown>) {
  const result: { state: "pending" | "resolved" | "rejected"; error?: unknown } = { state: "pending" };
  void promise.then(
    () => { result.state = "resolved"; },
    (error: unknown) => { result.state = "rejected"; result.error = error; },
  );
  return result;
}

const cases = [
  { kind: "smudge", run: (signal?: AbortSignal) => runStudioSmudgeWorker(smudgeRequest(), { signal }) },
  { kind: "retouch", run: (signal?: AbortSignal) => runStudioRetouchWorker(retouchRequest(), { signal }) },
] as const;

afterEach(async () => {
  disposeStudioSmudgeModuleWorker();
  disposeStudioRetouchModuleWorker();
  await flush();
  vi.unstubAllGlobals();
});

describe.each(cases)("$kind Worker repeated-use recovery", ({ kind, run }) => {
  function transport(automatic = false, ready = true) {
    const workers: ControlledWorker[] = [];
    class ControlledWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      onmessageerror: ((event: { data: unknown }) => void) | null = null;
      pending: (StudioSmudgeWorkerRunMessage | StudioRetouchWorkerRunMessage)[] = [];
      postCount = 0;
      terminateCount = 0;
      constructor() {
        workers.push(this);
        if (ready) queueMicrotask(() => this.onmessage?.({ data: { type: `studio-${kind}/ready`, version: 1 } }));
      }
      postMessage(message: StudioSmudgeWorkerRunMessage | StudioRetouchWorkerRunMessage, transfer: Transferable[]): void {
        this.pending.push(structuredClone(message, { transfer }));
        this.postCount++;
        if (automatic) this.complete();
      }
      complete(): void {
        const message = this.pending.shift();
        if (!message) throw new Error("No active raster request");
        if (message.type === "studio-retouch/run") {
          this.onmessage?.({ data: { type: "studio-retouch/success", version: 1, ...applyStudioRetouchWorkerRequest(message.request) } });
        } else {
          const { data, w, h, points, radiusPx, strength } = message.request;
          this.onmessage?.({ data: { type: "studio-smudge/success", version: 1, data: smudgeStroke(data, w, h, points, radiusPx, strength) } });
        }
      }
      terminate(): void { this.terminateCount++; this.pending = []; }
    }
    vi.stubGlobal("Worker", ControlledWorker);
    return workers;
  }

  it("rejects 1,000 cancelled waiting strokes before the active stroke finishes, then runs the newest", async () => {
    const workers = transport();
    const first = outcome(run());
    await flush();
    const cancelled = [];
    for (let i = 0; i < 1_000; i++) {
      const controller = new AbortController();
      cancelled.push(outcome(run(controller.signal)));
      controller.abort();
    }
    const newest = outcome(run());
    await flush();
    expect(cancelled.every((item) => item.state === "rejected")).toBe(true);
    expect(cancelled.every((item) => (item.error as Error).name === "AbortError")).toBe(true);
    expect(first.state).toBe("pending");
    expect(workers).toHaveLength(1);
    expect(workers[0]!.postCount).toBe(1);
    expect(workers[0]!.terminateCount).toBe(0);
    workers[0]!.complete();
    await flush();
    expect(workers[0]!.postCount).toBe(2);
    workers[0]!.complete();
    await flush();
    expect(first.state).toBe("resolved");
    expect(newest.state).toBe("resolved");
  });

  it.each([false, true])("settles a deserialization error promptly (ready=%s)", async (ready) => {
    const workers = transport(false, ready);
    const failed = outcome(run());
    await flush();
    workers[0]!.onmessageerror?.({ data: null });
    await flush();
    expect(failed.state).toBe("rejected");
    expect(workers[0]!.terminateCount).toBe(1);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[0]!.onerror).toBeNull();
    expect(workers[0]!.onmessageerror).toBeNull();
  });

  it("advances to a new Worker after a messageerror without a silent direct fallback", async () => {
    const workers = transport();
    const failed = outcome(run());
    const next = outcome(run());
    await flush();
    workers[0]!.onmessageerror?.({ data: null });
    await flush();
    expect(failed.state).toBe("rejected");
    expect(workers).toHaveLength(2);
    expect(workers[1]!.postCount).toBe(1);
    workers[1]!.complete();
    await flush();
    expect(next.state).toBe("resolved");
  });

  it("disposes active and queued work without resurrecting an old document's Worker", async () => {
    const workers = transport();
    const first = outcome(run());
    await flush();
    const pending = Array.from({ length: 100 }, () => outcome(run()));
    disposeStudioSmudgeModuleWorker();
    disposeStudioRetouchModuleWorker();
    await flush();
    expect(first.state).toBe("rejected");
    expect(pending.every((item) => item.state === "rejected")).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminateCount).toBe(1);
    const next = outcome(run());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]!.complete();
    await flush();
    expect(next.state).toBe("resolved");
  });

  it("reuses one warm Worker across 1,000 strokes with exact repeated kernel output", async () => {
    const workers = transport(true);
    const first = await run();
    for (let i = 1; i < 1_000; i++) {
      const next = await run();
      expect(next.execution).toBe("worker");
      expect(next.data).toEqual(first.data);
    }
    expect(workers).toHaveLength(1);
    expect(workers[0]!.postCount).toBe(1_000);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[0]!.onerror).toBeNull();
    expect(workers[0]!.onmessageerror).toBeNull();
  });
});

describe("abortable raster queue", () => {
  it("preserves FIFO order after an executor throws synchronously", async () => {
    const queue = createStudioAbortableSerialQueue<number, number>();
    const visited: number[] = [];
    const first = outcome(queue.run(1, () => { visited.push(1); throw new Error("injected"); }));
    const second = queue.run(2, async (value) => { visited.push(value); return value; });
    expect(await second).toBe(2);
    expect(first.state).toBe("rejected");
    expect(visited).toEqual([1, 2]);
  });

  it("rejects pre-aborted work without calling the executor", async () => {
    const queue = createStudioAbortableSerialQueue<number, number>();
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async (value: number) => value);
    const result = outcome(queue.run(1, execute, controller.signal));
    await flush();
    expect(result.state).toBe("rejected");
    expect(execute).not.toHaveBeenCalled();
  });
});
