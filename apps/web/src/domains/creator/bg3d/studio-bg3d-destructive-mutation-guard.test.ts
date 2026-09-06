import { describe, expect, it, vi } from "vitest";

import { StudioBg3dDestructiveMutationGuard } from "./studio-bg3d-destructive-mutation-guard";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("StudioBg3dDestructiveMutationGuard", () => {
  it("blocks dismiss from persistence start through the matching logical commit", async () => {
    const guard = new StudioBg3dDestructiveMutationGuard();
    const persistence = deferred<void>();
    const logicalCommit = vi.fn();
    const lease = guard.begin();
    expect(lease).not.toBeNull();
    expect(guard.blocksClose).toBe(true);

    const deletion = persistence.promise.then(() => {
      expect(guard.blocksClose).toBe(true);
      logicalCommit();
      expect(lease && guard.finish(lease)).toBe(true);
    });
    persistence.resolve();
    await deletion;

    expect(logicalCommit).toHaveBeenCalledOnce();
    expect(guard.blocksClose).toBe(false);
  });

  it("does not let an old completion clear a newer destructive lease", () => {
    const guard = new StudioBg3dDestructiveMutationGuard();
    const first = guard.begin();
    expect(first).not.toBeNull();
    expect(first && guard.finish(first)).toBe(true);
    const second = guard.begin();
    expect(second).not.toBeNull();

    expect(first && guard.finish(first)).toBe(false);
    expect(guard.blocksClose).toBe(true);
    expect(second && guard.finish(second)).toBe(true);
    expect(guard.blocksClose).toBe(false);
  });

  it("admits at most one destructive operation at a time", () => {
    const guard = new StudioBg3dDestructiveMutationGuard();
    expect(guard.begin()).not.toBeNull();
    expect(guard.begin()).toBeNull();
  });
});
