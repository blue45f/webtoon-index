import { describe, expect, it } from "vitest";

import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";

describe("createStudioIntentLazyLoader", () => {
  it("coalesces preload and activation around one module request", async () => {
    let resolveModule!: (module: { value: string }) => void;
    let calls = 0;
    const loader = createStudioIntentLazyLoader(() => {
      calls += 1;
      return new Promise<{ value: string }>((resolve) => {
        resolveModule = resolve;
      });
    });

    loader.preload();
    const first = loader.load();
    const second = loader.load();

    expect(calls).toBe(1);
    expect(first).toBe(second);
    resolveModule({ value: "ready" });
    await expect(first).resolves.toEqual({ value: "ready" });
  });

  it("consumes a failed warm-up and retries on the next activation", async () => {
    const failure = new Error("temporary chunk failure");
    let calls = 0;
    const loader = createStudioIntentLazyLoader(async () => {
      calls += 1;
      if (calls === 1) throw failure;
      return { value: "recovered" };
    });

    expect(loader.preload()).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    await expect(loader.load()).resolves.toEqual({ value: "recovered" });
    expect(calls).toBe(2);
  });

  it("surfaces activation failures while clearing the cache for a later retry", async () => {
    const failure = new Error("activation failed");
    let calls = 0;
    const loader = createStudioIntentLazyLoader(async () => {
      calls += 1;
      if (calls === 1) throw failure;
      return { value: "ready" };
    });

    await expect(loader.load()).rejects.toBe(failure);
    await expect(loader.load()).resolves.toEqual({ value: "ready" });
    expect(calls).toBe(2);
  });
});
