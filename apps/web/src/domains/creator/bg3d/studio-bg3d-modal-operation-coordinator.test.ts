import { afterEach, describe, expect, it, vi } from "vitest";

import {
  combineStudioBg3dAbortSignals,
  StudioBg3dAssetLoadGate,
  StudioBg3dModalOperationCoordinator,
} from "./studio-bg3d-modal-operation-coordinator";

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("StudioBg3dModalOperationCoordinator", () => {
  it("combines abort signals without native AbortSignal.any and forwards the first reason", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineStudioBg3dAbortSignals([first.signal, second.signal]);

    second.abort("outer-scene-closed");

    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("outer-scene-closed");
    first.abort("late-asset-timeout");
    expect(combined.signal.reason).toBe("outer-scene-closed");
    combined.dispose();
  });

  it("returns an already-aborted combined signal and preserves its reason", () => {
    const stale = new AbortController();
    const live = new AbortController();
    stale.abort("stale-before-admission");

    const combined = combineStudioBg3dAbortSignals([stale.signal, live.signal]);

    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("stale-before-admission");
    combined.dispose();
  });

  it("accepts commits only from the exact active modal epoch", () => {
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const first = coordinator.beginSession();
    const firstCommit = vi.fn();

    expect(coordinator.commitIfCurrent(first, firstCommit)).toBe(true);
    expect(firstCommit).toHaveBeenCalledOnce();

    const second = coordinator.beginSession();
    expect(second.epoch).toBeGreaterThan(first.epoch);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.commitIfCurrent(first, firstCommit)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    expect(coordinator.endSession(first)).toBe(false);
    expect(coordinator.endSession(second)).toBe(true);
    expect(coordinator.isCurrent(second)).toBe(false);
  });

  it("does not let a stale async completion commit into a reopened modal", async () => {
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const oldSession = coordinator.beginSession();
    const oldResult = deferred<string>();
    const oldCommit = vi.fn();
    const oldMutation = coordinator.runSceneMutation(
      oldSession,
      () => oldResult.promise,
      oldCommit,
    );

    const newSession = coordinator.beginSession();
    const newCommit = vi.fn();
    const newMutation = coordinator.runSceneMutation(
      newSession,
      () => "new-scene",
      newCommit,
    );
    oldResult.resolve("old-scene");

    await expect(oldMutation).resolves.toEqual({ status: "stale" });
    expect(oldCommit).not.toHaveBeenCalled();
    await expect(newMutation).resolves.toEqual({ status: "committed", value: "new-scene" });
    expect(newCommit).toHaveBeenCalledExactlyOnceWith("new-scene");
  });

  it("serializes scene mutations in intent order and recovers after a failure", async () => {
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const firstResult = deferred<string>();
    const order: string[] = [];
    const first = coordinator.runSceneMutation(
      session,
      () => {
        order.push("prepare-add");
        return firstResult.promise;
      },
      () => order.push("commit-add"),
    );
    const secondPrepare = vi.fn(() => {
      order.push("prepare-delete");
      throw new Error("delete failed");
    });
    const second = coordinator.runSceneMutation(session, secondPrepare, vi.fn());
    const third = coordinator.runSceneMutation(
      session,
      () => {
        order.push("prepare-readd");
        return "readded";
      },
      () => order.push("commit-readd"),
    );

    await Promise.resolve();
    expect(order).toEqual(["prepare-add"]);
    expect(secondPrepare).not.toHaveBeenCalled();
    firstResult.resolve("added");

    await expect(first).resolves.toEqual({ status: "committed", value: "added" });
    await expect(second).rejects.toThrow("delete failed");
    await expect(third).resolves.toEqual({ status: "committed", value: "readded" });
    expect(order).toEqual([
      "prepare-add",
      "commit-add",
      "prepare-delete",
      "prepare-readd",
      "commit-readd",
    ]);
  });

  it("skips queued work from a closed epoch before its prepare phase starts", async () => {
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const headResult = deferred<void>();
    const head = coordinator.runSceneMutation(session, () => headResult.promise, vi.fn());
    const stalePrepare = vi.fn(() => "stale");
    const stale = coordinator.runSceneMutation(session, stalePrepare, vi.fn());

    coordinator.endSession(session);
    const reopened = coordinator.beginSession();
    const reopenedCommit = vi.fn();
    const current = coordinator.runSceneMutation(
      reopened,
      () => "current",
      reopenedCommit,
    );
    headResult.resolve();

    await expect(head).resolves.toEqual({ status: "stale" });
    await expect(stale).resolves.toEqual({ status: "stale" });
    expect(stalePrepare).not.toHaveBeenCalled();
    await expect(current).resolves.toEqual({ status: "committed", value: "current" });
    expect(reopenedCommit).toHaveBeenCalledExactlyOnceWith("current");
  });

  it("expires a never-settling head without blocking the next mutation", async () => {
    vi.useFakeTimers();
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const headResult = deferred<string>();
    const headCommit = vi.fn();
    let headSignal: AbortSignal | undefined;
    const head = coordinator.runSceneMutation(
      session,
      (lease) => {
        headSignal = lease.signal;
        return headResult.promise;
      },
      headCommit,
      { timeoutMs: 50 },
    );
    const headOutcome = head.catch((reason: unknown) => reason);
    const nextCommit = vi.fn();
    const next = coordinator.runSceneMutation(
      session,
      () => "after-timeout",
      nextCommit,
      { timeoutMs: 50 },
    );

    await Promise.resolve();
    expect(headSignal?.aborted).toBe(false);
    expect(nextCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(await headOutcome).toMatchObject({
      code: "operation-lease-timeout",
      name: "TimeoutError",
      scope: "scene-mutation",
      timeoutMs: 50,
    });
    await expect(next).resolves.toEqual({
      status: "committed",
      value: "after-timeout",
    });
    expect(headSignal?.aborted).toBe(true);
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith("after-timeout");

    headResult.resolve("late-head");
    await Promise.resolve();
    expect(headCommit).not.toHaveBeenCalled();
  });

  it("quarantines an authoritative delete through timeout and commits when persistence wins abort", async () => {
    vi.useFakeTimers();
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const persistedDelete = deferred<string>();
    const deleteCommit = vi.fn();
    let deleteSignal: AbortSignal | undefined;
    let deleteSettled = false;
    const deletion = coordinator.runSceneMutation(
      session,
      (lease) => {
        deleteSignal = lease.signal;
        return persistedDelete.promise;
      },
      deleteCommit,
      { authoritativePersistence: true, timeoutMs: 50 },
    );
    void deletion.finally(() => {
      deleteSettled = true;
    });
    const nextPrepare = vi.fn(() => "next-mutation");
    const nextCommit = vi.fn();
    const next = coordinator.runSceneMutation(session, nextPrepare, nextCommit);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    expect(deleteSignal?.aborted).toBe(true);
    expect(deleteSettled).toBe(false);
    expect(deleteCommit).not.toHaveBeenCalled();
    expect(nextPrepare).not.toHaveBeenCalled();

    // IndexedDB's complete event arrives after the deadline: this value is authoritative.
    persistedDelete.resolve("delete-committed");

    await expect(deletion).resolves.toEqual({
      status: "committed",
      value: "delete-committed",
    });
    expect(deleteCommit).toHaveBeenCalledExactlyOnceWith("delete-committed");
    await expect(next).resolves.toEqual({
      status: "committed",
      value: "next-mutation",
    });
    expect(nextPrepare).toHaveBeenCalledOnce();
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith("next-mutation");
  });

  it("reports timeout only after an authoritative delete confirms that abort rolled persistence back", async () => {
    vi.useFakeTimers();
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const persistedDelete = deferred<string>();
    const deleteCommit = vi.fn();
    let callerSettled = false;
    const deletion = coordinator.runSceneMutation(
      session,
      () => persistedDelete.promise,
      deleteCommit,
      { authoritativePersistence: true, timeoutMs: 25 },
    );
    void deletion.catch(() => undefined).finally(() => {
      callerSettled = true;
    });
    const nextPrepare = vi.fn(() => "after-rollback");
    const next = coordinator.runSceneMutation(session, nextPrepare, vi.fn());

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    expect(callerSettled).toBe(false);
    expect(nextPrepare).not.toHaveBeenCalled();

    persistedDelete.reject(new Error("indexeddb-abort-confirmed"));

    await expect(deletion).rejects.toMatchObject({
      code: "operation-lease-timeout",
      scope: "scene-mutation",
    });
    await expect(next).resolves.toEqual({
      status: "committed",
      value: "after-rollback",
    });
    expect(deleteCommit).not.toHaveBeenCalled();
  });

  it("keeps a revoked authoritative delete in the physical lane until its journal commit settles", async () => {
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const oldSession = coordinator.beginSession();
    const persistedDelete = deferred<string>();
    const oldCommit = vi.fn();
    const deletion = coordinator.runSceneMutation(
      oldSession,
      () => persistedDelete.promise,
      oldCommit,
      { authoritativePersistence: true },
    );

    await Promise.resolve();
    expect(coordinator.endSession(oldSession)).toBe(true);
    const reopened = coordinator.beginSession();
    const reopenedPrepare = vi.fn(() => "restored-after-journal");
    const reopenedCommit = vi.fn();
    const reopenedMutation = coordinator.runSceneMutation(
      reopened,
      reopenedPrepare,
      reopenedCommit,
    );
    let laneReady = false;
    void coordinator.waitForSceneMutationLane().then(() => {
      laneReady = true;
    });

    await expect(deletion).resolves.toEqual({ status: "stale" });
    expect(reopenedPrepare).not.toHaveBeenCalled();
    expect(laneReady).toBe(false);

    persistedDelete.resolve("journal-committed");
    await expect(reopenedMutation).resolves.toEqual({
      status: "committed",
      value: "restored-after-journal",
    });
    await coordinator.waitForSceneMutationLane();
    expect(laneReady).toBe(true);
    expect(oldCommit).not.toHaveBeenCalled();
    expect(reopenedCommit).toHaveBeenCalledExactlyOnceWith("restored-after-journal");
  });

  it("revokes a never-settling old lease on close and reopen before its deadline", async () => {
    vi.useFakeTimers();
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const oldSession = coordinator.beginSession();
    const oldResult = deferred<string>();
    const oldCommit = vi.fn();
    let oldSignal: AbortSignal | undefined;
    const oldMutation = coordinator.runSceneMutation(
      oldSession,
      (lease) => {
        oldSignal = lease.signal;
        return oldResult.promise;
      },
      oldCommit,
      { timeoutMs: 5_000 },
    );

    await Promise.resolve();
    expect(coordinator.endSession(oldSession)).toBe(true);
    const reopened = coordinator.beginSession();
    const reopenedCommit = vi.fn();
    const reopenedMutation = coordinator.runSceneMutation(
      reopened,
      () => "reopened",
      reopenedCommit,
      { timeoutMs: 5_000 },
    );

    await expect(oldMutation).resolves.toEqual({ status: "stale" });
    await expect(reopenedMutation).resolves.toEqual({
      status: "committed",
      value: "reopened",
    });
    expect(oldSignal?.aborted).toBe(true);
    expect(reopenedCommit).toHaveBeenCalledExactlyOnceWith("reopened");
    expect(vi.getTimerCount()).toBe(0);

    oldResult.resolve("late-old-value");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(oldCommit).not.toHaveBeenCalled();
  });

  it("keeps recovering after a timed-out head and a later prepare failure", async () => {
    vi.useFakeTimers();
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const timedOut = coordinator.runSceneMutation(
      session,
      () => new Promise<never>(() => undefined),
      vi.fn(),
      { timeoutMs: 25 },
    );
    const timedOutOutcome = timedOut.catch((reason: unknown) => reason);
    const failed = coordinator.runSceneMutation(
      session,
      () => {
        throw new Error("prepare-failed");
      },
      vi.fn(),
      { timeoutMs: 25 },
    );
    const failedOutcome = failed.catch((reason: unknown) => reason);
    const finalCommit = vi.fn();
    const final = coordinator.runSceneMutation(
      session,
      () => "recovered",
      finalCommit,
      { timeoutMs: 25 },
    );

    await vi.advanceTimersByTimeAsync(25);
    expect(await timedOutOutcome).toMatchObject({ code: "operation-lease-timeout" });
    expect(await failedOutcome).toEqual(new Error("prepare-failed"));
    await expect(final).resolves.toEqual({ status: "committed", value: "recovered" });
    expect(finalCommit).toHaveBeenCalledExactlyOnceWith("recovered");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("StudioBg3dAssetLoadGate", () => {
  it("bounds global work and admits queued loads in FIFO order", async () => {
    const gate = new StudioBg3dAssetLoadGate(2);
    const releases = [deferred<number>(), deferred<number>(), deferred<number>()];
    const starts: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const tasks = releases.map((release, index) => gate.run(async () => {
      starts.push(index);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        return await release.promise;
      } finally {
        active -= 1;
      }
    }));

    await Promise.resolve();
    expect(starts).toEqual([0, 1]);
    expect(gate.activeCount).toBe(2);
    expect(gate.queuedCount).toBe(1);

    releases[1]!.resolve(20);
    await expect(tasks[1]).resolves.toBe(20);
    await Promise.resolve();
    expect(starts).toEqual([0, 1, 2]);
    expect(maximumActive).toBe(2);

    releases[0]!.resolve(10);
    releases[2]!.resolve(30);
    await expect(Promise.all(tasks)).resolves.toEqual([10, 20, 30]);
    expect(gate.activeCount).toBe(0);
    expect(gate.queuedCount).toBe(0);
  });

  it("rejects a stale queued generation before the load allocates resources", async () => {
    const gate = new StudioBg3dAssetLoadGate(1);
    const headResult = deferred<void>();
    let current = true;
    const head = gate.run(() => headResult.promise);
    const staleTask = vi.fn(() => "must-not-load");
    const stale = gate.run(staleTask, { isCurrent: () => current });

    await Promise.resolve();
    current = false;
    headResult.resolve();

    await expect(head).resolves.toBeUndefined();
    await expect(stale).rejects.toMatchObject({
      code: "stale-modal-epoch",
      name: "AbortError",
    });
    expect(staleTask).not.toHaveBeenCalled();
    expect(gate.activeCount).toBe(0);
  });

  it("rejects a timed-out load but quarantines its slot until physical settlement", async () => {
    vi.useFakeTimers();
    const gate = new StudioBg3dAssetLoadGate(1);
    const headResult = deferred<string>();
    let headSignal: AbortSignal | undefined;
    const head = gate.run(
      (lease) => {
        headSignal = lease.signal;
        return headResult.promise;
      },
      { timeoutMs: 40 },
    );
    const headOutcome = head.catch((reason: unknown) => reason);
    const starts: string[] = [];
    const next = gate.run(
      () => {
        starts.push("next");
        return "next-value";
      },
      { timeoutMs: 40 },
    );

    await Promise.resolve();
    expect(gate.activeCount).toBe(1);
    expect(gate.queuedCount).toBe(1);
    expect(headSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(40);
    expect(await headOutcome).toMatchObject({
      code: "operation-lease-timeout",
      name: "TimeoutError",
      scope: "asset-load",
      timeoutMs: 40,
    });
    expect(starts).toEqual([]);
    expect(gate.activeCount).toBe(1);
    expect(gate.queuedCount).toBe(1);
    expect(headSignal?.aborted).toBe(true);

    headResult.resolve("late-head-value");
    await Promise.resolve();
    await expect(next).resolves.toBe("next-value");
    expect(starts).toEqual(["next"]);
    expect(gate.activeCount).toBe(0);
    expect(gate.queuedCount).toBe(0);
  });

  it("reports a stale timeout when an in-flight asset generation was closed", async () => {
    vi.useFakeTimers();
    const gate = new StudioBg3dAssetLoadGate(1);
    let current = true;
    let signal: AbortSignal | undefined;
    const physicalLoad = deferred<void>();
    const load = gate.run(
      (lease) => {
        signal = lease.signal;
        return physicalLoad.promise;
      },
      { isCurrent: () => current, timeoutMs: 30 },
    );
    const loadOutcome = load.catch((reason: unknown) => reason);

    await Promise.resolve();
    current = false;
    await vi.advanceTimersByTimeAsync(30);
    expect(await loadOutcome).toMatchObject({
      code: "stale-modal-epoch",
      name: "AbortError",
    });
    expect(signal?.aborted).toBe(true);
    expect(gate.activeCount).toBe(1);

    physicalLoad.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.activeCount).toBe(0);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid concurrency %s",
    (capacity) => {
      expect(() => new StudioBg3dAssetLoadGate(capacity)).toThrow(RangeError);
    },
  );
});
