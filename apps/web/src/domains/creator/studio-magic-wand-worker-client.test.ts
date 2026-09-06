import { afterEach, describe, expect, it, vi } from "vitest";

import { scanMagicWandRegionFromImageData } from "./studio-magic-wand";
import {
  runStudioMagicWandWorker,
  type StudioMagicWandWorkerLike,
} from "./studio-magic-wand-worker-client";

import type {
  StudioMagicWandWorkerResponseMessage,
  StudioMagicWandWorkerRunMessage,
} from "./studio-magic-wand-worker-protocol";

function request() {
  return {
    data: new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
      240, 230, 220, 255,
    ]),
    w: 3,
    h: 1,
    startX: 0,
    startY: 0,
    tolerance: 0,
  };
}

class ControlledWorker implements StudioMagicWandWorkerLike {
  onmessage: StudioMagicWandWorkerLike["onmessage"] = null;
  onerror: StudioMagicWandWorkerLike["onerror"] = null;
  message: StudioMagicWandWorkerRunMessage | null = null;
  terminateCount = 0;

  constructor(private readonly postError?: unknown) {}

  postMessage(message: StudioMagicWandWorkerRunMessage): void {
    if (this.postError !== undefined) throw this.postError;
    this.message = message;
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  ready(): void {
    this.onmessage?.({
      data: { type: "studio-magic-wand/ready", version: 1 },
    } as MessageEvent<StudioMagicWandWorkerResponseMessage>);
  }

  fail(message: string): void {
    this.onerror?.({ message });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runStudioMagicWandWorker", () => {
  it("runs direct only when it was explicitly selected before work", async () => {
    const input = request();
    const factory = vi.fn(() => null);
    const expected = scanMagicWandRegionFromImageData(
      input.data,
      input.w,
      input.h,
      input.startX,
      input.startY,
      input.tolerance,
    );

    await expect(runStudioMagicWandWorker(input, {
      executionMode: "direct",
      workerFactory: factory,
    })).resolves.toEqual({ execution: "direct", region: expected });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["null factory", null],
    ["throwing factory", () => { throw new Error("blocked by CSP"); }],
  ] as const)("rejects %s without direct re-execution", async (_label, workerFactory) => {
    await expect(runStudioMagicWandWorker(request(), { workerFactory })).rejects.toMatchObject({
      name: "StudioMagicWandWorkerUnavailableError",
    });
  });

  it("keeps pre-ready, post, and runtime failures terminal", async () => {
    const loadWorker = new ControlledWorker();
    const load = runStudioMagicWandWorker(request(), { workerFactory: () => loadWorker });
    loadWorker.fail("module load failed");
    await expect(load).rejects.toMatchObject({ name: "StudioMagicWandWorkerUnavailableError" });

    const postWorker = new ControlledWorker(new DOMException("clone failed", "DataCloneError"));
    const post = runStudioMagicWandWorker(request(), { workerFactory: () => postWorker });
    postWorker.ready();
    await expect(post).rejects.toMatchObject({ name: "StudioMagicWandWorkerUnavailableError" });

    const runtimeWorker = new ControlledWorker();
    const runtime = runStudioMagicWandWorker(request(), { workerFactory: () => runtimeWorker });
    runtimeWorker.ready();
    expect(runtimeWorker.message?.type).toBe("studio-magic-wand/run");
    runtimeWorker.fail("runtime failed");
    await expect(runtime).rejects.toThrow("runtime failed");
  });

  it("rejects a ready timeout without changing execution mode", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const pending = runStudioMagicWandWorker(request(), { workerFactory: () => worker });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "StudioMagicWandWorkerUnavailableError",
    });
    await vi.advanceTimersByTimeAsync(3_001);
    await rejection;
    expect(worker.message).toBeNull();
    expect(worker.terminateCount).toBe(1);
  });
});
