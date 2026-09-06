import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioImageFilterResidentWorkerSession,
  createStudioImageFilterWorkerSession,
  runStudioImageFilterWorker,
  type StudioImageFilterWorkerLike,
} from "./studio-image-filter-worker-client";


import type {
  StudioImageFilterWorkerRequestMessage,
  StudioImageFilterWorkerResponseMessage,
  StudioImageFilterWorkerRunRequest,
} from "./studio-image-filter-worker-protocol";

function request(width = 3, height = 2): StudioImageFilterWorkerRunRequest {
  return { imageData: { width, height, data: new Uint8ClampedArray(width * height * 4) }, el: {} };
}

class ControlledWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  onmessageerror: StudioImageFilterWorkerLike["onmessageerror"] = null;
  terminated = 0;
  posted: StudioImageFilterWorkerRequestMessage[] = [];
  postMessage(message: StudioImageFilterWorkerRequestMessage): void { this.posted.push(message); }
  terminate(): void { this.terminated += 1; }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
  }
  ready(): void { this.emit({ type: "studio-image-filter/ready", version: 1 }); }
  success(width = 3, height = 2): void {
    this.emit({ type: "studio-image-filter/success", version: 1, imageData: request(width, height).imageData });
  }
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.useRealTimers();
});
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
function outcome(pending: Promise<unknown>) {
  const result: { state: "pending" | "resolved" | "rejected"; error?: unknown } = { state: "pending" };
  void pending.then(
    () => { result.state = "resolved"; },
    (error: unknown) => { result.state = "rejected"; result.error = error; },
  );
  return result;
}

function oneShot(worker: ControlledWorker) {
  const controller = new AbortController();
  cleanup.push(() => controller.abort());
  return runStudioImageFilterWorker(request(), { workerFactory: () => worker, signal: controller.signal });
}

describe("image-filter Worker long-session recovery", () => {
  it("bounds one-shot execution after ready and clears every handler and timer", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const result = outcome(oneShot(worker));
    worker.ready();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(result.state).toBe("rejected");
    expect(result.error).toMatchObject({ message: expect.stringContaining("초과") });
    expect(worker.terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("settles messageerror (ready=%s) without waiting for a watchdog", async (ready) => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const result = outcome(oneShot(worker));
    if (ready) worker.ready();
    worker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
    await flush();
    expect(result.state).toBe("rejected");
    expect(worker.terminated).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a well-formed buffer with the wrong source dimensions", async () => {
    const worker = new ControlledWorker();
    const result = outcome(oneShot(worker));
    worker.ready();
    worker.success(2, 3);
    await flush();
    expect(result.state).toBe("rejected");
    expect(result.error).toBeInstanceOf(RangeError);
  });

  it("turns malformed failure envelopes into a rejection rather than an uncaught handler exception", async () => {
    const worker = new ControlledWorker();
    const result = outcome(oneShot(worker));
    worker.ready();
    expect(() => worker.emit({ type: "studio-image-filter/failure", version: 1 })).not.toThrow();
    await flush();
    expect(result.state).toBe("rejected");
    expect(worker.terminated).toBe(1);
  });

  it("does not leave a timer behind when a transport completes synchronously", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    worker.postMessage = () => worker.success();
    const session = createStudioImageFilterWorkerSession({ workerFactory: () => worker });
    cleanup.push(() => session.dispose());
    const pending = session.run(request());
    worker.ready();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["serial", "resident"] as const)("ignores retired %s Worker events after recovery", async (mode) => {
    vi.useFakeTimers();
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    let created = 0;
    const factory = () => created++ === 0 ? firstWorker : secondWorker;
    const session = mode === "serial"
      ? createStudioImageFilterWorkerSession({ workerFactory: factory })
      : createStudioImageFilterResidentWorkerSession({ workerFactory: factory });
    cleanup.push(() => session.dispose());
    const run = () => mode === "serial"
      ? (session as ReturnType<typeof createStudioImageFilterWorkerSession>).run(request())
      : (session as ReturnType<typeof createStudioImageFilterResidentWorkerSession>)
          .run(request(), { sourceRevision: 1 });
    const first = outcome(run());
    firstWorker.ready();
    const staleMessage = firstWorker.onmessage;
    const staleError = firstWorker.onerror;
    const staleDecodeError = firstWorker.onmessageerror;
    firstWorker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
    await flush();
    expect(first.state).toBe("rejected");
    const second = outcome(run());
    secondWorker.ready();
    staleMessage?.({ data: { type: "studio-image-filter/success", version: 1, imageData: request().imageData } } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    staleError?.({ message: "retired worker error" });
    staleDecodeError?.({ data: null } as MessageEvent<unknown>);
    await flush();
    expect(second.state).toBe("pending");
    expect(secondWorker.terminated).toBe(0);
    session.dispose();
    await flush();
    expect(second.state).toBe("rejected");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never posts 1,000 cancelled slider snapshots and still completes the newest tick", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const session = createStudioImageFilterWorkerSession({ workerFactory: () => worker });
    cleanup.push(() => session.dispose());
    const first = outcome(session.run(request()));
    worker.ready();
    const cancelled: ReturnType<typeof outcome>[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const controller = new AbortController();
      cancelled.push(outcome(session.run(request(), { signal: controller.signal })));
      controller.abort();
    }
    const newest = outcome(session.run(request()));
    worker.success();
    await flush();
    worker.success();
    await flush();
    expect(first.state).toBe("resolved");
    expect(newest.state).toBe("resolved");
    expect(cancelled.every((item) => item.state === "rejected")).toBe(true);
    expect(worker.posted).toHaveLength(2);
    expect(worker.terminated).toBe(0);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reuses a resident source across 1,000 completions without compounding or detaching it", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    let loads = 0;
    let runs = 0;
    worker.postMessage = (message) => {
      queueMicrotask(() => {
        if (message.type === "studio-image-filter/load-source") {
          loads += 1;
          worker.emit({ type: "studio-image-filter/source-loaded", version: 1, sourceId: message.sourceId, sourceGeneration: message.sourceGeneration });
        } else if (message.type === "studio-image-filter/run-source") {
          runs += 1;
          worker.emit({ type: "studio-image-filter/source-success", version: 1, sourceId: message.sourceId, sourceGeneration: message.sourceGeneration, requestId: message.requestId, imageData: request().imageData });
        }
      });
    };
    const session = createStudioImageFilterResidentWorkerSession({ workerFactory: () => worker });
    cleanup.push(() => session.dispose());
    const source = request();
    const first = session.run(source, { sourceRevision: 1 });
    worker.ready();
    await first;
    for (let index = 1; index < 1_000; index += 1) {
      await session.run(source, { sourceRevision: 1 });
    }
    expect(loads).toBe(1);
    expect(runs).toBe(1_000);
    expect(source.imageData.data.byteLength).toBe(24);
    expect(vi.getTimerCount()).toBe(0);
  });
});
