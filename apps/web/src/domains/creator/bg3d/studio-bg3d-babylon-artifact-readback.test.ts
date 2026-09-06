import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runStudioBg3dBabylonSerializedReadbacks,
  StudioBg3dBabylonCaptureError,
} from "./studio-bg3d-babylon-artifact-capture";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio Babylon serialized GPU readback lease", () => {
  it("starts depth only after beauty has fully settled", async () => {
    const beauty = deferred<Uint8Array>();
    const depth = deferred<Float32Array>();
    const events: string[] = [];
    const release = vi.fn(() => events.push("release"));

    const result = runStudioBg3dBabylonSerializedReadbacks({
      beauty: () => {
        events.push("beauty:start");
        return beauty.promise;
      },
      depth: () => {
        events.push("depth:start");
        return depth.promise;
      },
      release,
      signal: new AbortController().signal,
    });

    await vi.waitFor(() => expect(events).toEqual(["beauty:start"]));
    beauty.resolve(Uint8Array.from([1, 2, 3, 4]));
    await vi.waitFor(() => expect(events).toEqual(["beauty:start", "depth:start"]));
    expect(release).not.toHaveBeenCalled();

    depth.resolve(Float32Array.from([0.5]));
    await expect(result).resolves.toEqual({
      beauty: Uint8Array.from([1, 2, 3, 4]),
      depth: Float32Array.from([0.5]),
    });
    expect(events).toEqual(["beauty:start", "depth:start", "release"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not start depth after a beauty failure and releases only after settlement", async () => {
    const beauty = deferred<Uint8Array>();
    const depth = vi.fn(async () => Float32Array.from([0.5]));
    const release = vi.fn();
    const result = runStudioBg3dBabylonSerializedReadbacks({
      beauty: () => beauty.promise,
      depth,
      release,
      signal: new AbortController().signal,
    });

    beauty.reject(new Error("mapAsync failed"));
    await expect(result).rejects.toMatchObject({
      code: "capture-failed",
      stage: "beauty",
    });
    expect(depth).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports abort promptly but retains the RTT lease until an active depth map settles", async () => {
    const controller = new AbortController();
    const depth = deferred<Float32Array>();
    const readDepth = vi.fn(() => depth.promise);
    const release = vi.fn();
    const result = runStudioBg3dBabylonSerializedReadbacks({
      beauty: async () => Uint8Array.from([1, 2, 3, 4]),
      depth: readDepth,
      release,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(readDepth).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toMatchObject({
      code: "aborted",
      stage: "depth",
    });
    expect(release).not.toHaveBeenCalled();

    depth.resolve(Float32Array.from([0.5]));
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
  });

  it("reports a staged timeout without disposing a still-mapped beauty buffer", async () => {
    vi.useFakeTimers();
    const beauty = deferred<Uint8Array>();
    const depth = vi.fn(async () => Float32Array.from([0.5]));
    const release = vi.fn();
    const result = runStudioBg3dBabylonSerializedReadbacks({
      beauty: () => beauty.promise,
      deadlineMs: 25,
      depth,
      release,
      signal: new AbortController().signal,
    });
    const rejected = expect(result).rejects.toMatchObject({
      code: "timeout",
      stage: "beauty",
    });

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(depth).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();

    beauty.resolve(Uint8Array.from([1, 2, 3, 4]));
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps the public error contract while adding a typed readback stage", () => {
    const error = new StudioBg3dBabylonCaptureError(
      "capture-failed",
      new Error("device lost"),
      "depth",
    );

    expect(error).toMatchObject({
      code: "capture-failed",
      name: "StudioBg3dBabylonCaptureError",
      stage: "depth",
    });
    expect(error.message).toContain("depth readback");
  });
});
