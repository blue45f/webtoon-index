import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeStudioRetouchModuleWorker, runStudioRetouchWorker } from "./studio-retouch-worker-client";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";
import { smudgeStroke } from "./studio-smudge";
import { disposeStudioSmudgeModuleWorker, runStudioSmudgeWorker } from "./studio-smudge-worker-client";

import type { StudioRetouchWorkerRunMessage } from "./studio-retouch-worker-protocol";
import type { StudioSmudgeWorkerRunMessage } from "./studio-smudge-worker-protocol";

const cases = [
  {
    kind: "smudge",
    run: (signal?: AbortSignal) => runStudioSmudgeWorker({
      data: new Uint8ClampedArray(8 * 8 * 4).fill(128), w: 8, h: 8,
      points: [{ x: 3, y: 3 }, { x: 6, y: 5 }], radiusPx: 3, strength: 0.5,
    }, { signal }),
  },
  {
    kind: "retouch",
    run: (signal?: AbortSignal) => runStudioRetouchWorker({
      kind: "dodge-burn", data: new Uint8ClampedArray(8 * 8 * 4).fill(128), w: 8, h: 8,
      points: [{ x: 4, y: 4 }],
      settings: { radiusPx: 3, hardness: 0.5, exposure: 50, mode: "dodge", range: "midtones", sponge: "saturate" },
    }, { signal }),
  },
] as const;

async function flush(): Promise<void> {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

beforeEach(() => {
  // Keep queueMicrotask/Promises real so both admission and executor handoff are exercised.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  disposeStudioSmudgeModuleWorker();
  disposeStudioRetouchModuleWorker();
  await flush();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(cases)("$kind Worker idle deadline survives cancelled admission", ({ kind, run }) => {
  function transport() {
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
        queueMicrotask(() => this.onmessage?.({ data: { type: `studio-${kind}/ready`, version: 1 } }));
      }
      postMessage(message: StudioSmudgeWorkerRunMessage | StudioRetouchWorkerRunMessage, transfer: Transferable[]): void {
        this.pending.push(structuredClone(message, { transfer }));
        this.postCount++;
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

  it.each(["before-pump", "executor-handoff", "pre-aborted", "1000-cancellations"] as const)(
    "preserves the original deadline for %s and recovers on a fresh Worker",
    async (timing) => {
      const workers = transport();
      const first = run();
      await flush();
      workers[0]!.complete();
      await first;
      await flush();
      const repetitions = timing === "1000-cancellations" ? 1_000 : 1;
      for (let i = 0; i < repetitions; i++) {
        const controller = new AbortController();
        if (timing === "pre-aborted") controller.abort();
        const pending = run(controller.signal);
        const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
        if (timing === "executor-handoff") await Promise.resolve();
        controller.abort();
        await rejected;
        await flush();
      }
      expect(workers).toHaveLength(1);
      expect(workers[0]!.postCount).toBe(1);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(workers[0]!.terminateCount).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(workers[0]!.terminateCount).toBe(1);
      const next = run();
      await flush();
      expect(workers).toHaveLength(2);
      workers[1]!.complete();
      expect((await next).execution).toBe("worker");
    },
  );

  it("clears the old deadline only for live work, then grants a new idle window", async () => {
    const workers = transport();
    const first = run();
    await flush();
    workers[0]!.complete();
    await first;
    await flush();
    await vi.advanceTimersByTimeAsync(44_999);
    const next = run();
    await flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminateCount).toBe(0);
    workers[0]!.complete();
    expect((await next).execution).toBe("worker");
    await flush();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(workers[0]!.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminateCount).toBe(1);
  });
});
