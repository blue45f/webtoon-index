import { describe, expect, it, vi } from "vitest";

import {
  createStudioMediaPipeVisionInitArbiter,
  StudioMediaPipeVisionRuntimeError,
  type StudioMediaPipeVisionModule,
} from "./studio-mediapipe-vision-init-arbiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("MediaPipe Vision init arbiter", () => {
  it("serializes factories from different feature owners in FIFO order", async () => {
    const arbiter = createStudioMediaPipeVisionInitArbiter();
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const entered: number[] = [];
    let active = 0;
    let maxActive = 0;
    const tasks = gates.map((gate, index) => arbiter.runTaskCreation({
      owner: ["vrm-video-face", "mannequin-video-pose", "foreground-image-segmenter"][index]! as
        "vrm-video-face",
      create: async () => {
        entered.push(index);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      },
    }));

    await vi.waitFor(() => expect(entered).toEqual([0]));
    gates[0]!.resolve("face");
    await vi.waitFor(() => expect(entered).toEqual([0, 1]));
    gates[1]!.resolve("pose");
    await vi.waitFor(() => expect(entered).toEqual([0, 1, 2]));
    gates[2]!.resolve("segmenter");
    await expect(Promise.all(tasks)).resolves.toEqual(["face", "pose", "segmenter"]);
    expect(maxActive).toBe(1);
  });

  it("does not poison the queue when an earlier factory rejects", async () => {
    const arbiter = createStudioMediaPipeVisionInitArbiter();
    const failure = new Error("gpu factory failed");
    const first = arbiter.runTaskCreation({
      owner: "vrm-video-face",
      create: () => Promise.reject(failure),
    });
    const second = arbiter.runTaskCreation({
      owner: "vrm-video-pose",
      create: () => Promise.resolve("cpu-ready"),
    });
    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe("cpu-ready");
  });

  it("removes an aborted waiter without invoking it or blocking the next factory", async () => {
    const arbiter = createStudioMediaPipeVisionInitArbiter();
    const active = deferred<void>();
    const first = arbiter.runTaskCreation({
      owner: "vrm-video-face",
      create: () => active.promise,
    });
    const controller = new AbortController();
    const skippedFactory = vi.fn(() => Promise.resolve("stale"));
    const skipped = arbiter.runTaskCreation({
      owner: "mannequin-video-pose",
      signal: controller.signal,
      create: skippedFactory,
    });
    const lastFactory = vi.fn(() => Promise.resolve("ready"));
    const last = arbiter.runTaskCreation({
      owner: "vrm-photo-pose",
      create: lastFactory,
    });

    controller.abort("panel-closed");
    await expect(skipped).rejects.toMatchObject({ code: "aborted" });
    expect(skippedFactory).not.toHaveBeenCalled();
    active.resolve();
    await first;
    await expect(last).resolves.toBe("ready");
    expect(lastFactory).toHaveBeenCalledOnce();
  });

  it("keeps the lock until an already-started factory settles after abort", async () => {
    const arbiter = createStudioMediaPipeVisionInitArbiter();
    const controller = new AbortController();
    const active = deferred<string>();
    const entered: string[] = [];
    const first = arbiter.runTaskCreation({
      owner: "mannequin-video-pose",
      signal: controller.signal,
      create: () => {
        entered.push("first");
        return active.promise;
      },
    });
    const second = arbiter.runTaskCreation({
      owner: "vrm-video-hand",
      create: () => {
        entered.push("second");
        return Promise.resolve("hand");
      },
    });
    await vi.waitFor(() => expect(entered).toEqual(["first"]));
    controller.abort();
    await Promise.resolve();
    expect(entered).toEqual(["first"]);
    active.resolve("pose");
    await expect(first).resolves.toBe("pose");
    await expect(second).resolves.toBe("hand");
  });

  it("deduplicates module imports and permits an explicit retry after failure", async () => {
    const failure = new Error("chunk unavailable");
    const fakeModule = {} as StudioMediaPipeVisionModule;
    const loader = vi.fn<() => Promise<StudioMediaPipeVisionModule>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(fakeModule);
    const arbiter = createStudioMediaPipeVisionInitArbiter({ loadModule: loader });

    const first = arbiter.loadModule();
    const duplicate = arbiter.loadModule();
    expect(duplicate).toBe(first);
    await expect(first).rejects.toEqual(expect.objectContaining({
      name: "StudioMediaPipeVisionRuntimeError",
      code: "module-import-failed",
      cause: failure,
    } satisfies Partial<StudioMediaPipeVisionRuntimeError>));
    await expect(arbiter.loadModule()).resolves.toBe(fakeModule);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
