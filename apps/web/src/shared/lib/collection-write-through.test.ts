import { describe, expect, it, vi } from "vitest";

import {
  CollectionWriteThroughCoordinator,
  beginCollectionMerge,
  collectionAccountKey,
  collectionLaneKey,
  completeCollectionMerge,
  failCollectionMerge,
  remapCollectionCommand,
  waitForCollectionMerge,
} from "./collection-write-through";

import type { CollectionAuthFence, CollectionWriteJob } from "./collection-write-through";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const fence: CollectionAuthFence = {
  userId: "owner-1",
  sessionToken: "session-1",
  generation: 3,
};

function job(
  collectionId: string,
  overrides: Partial<CollectionWriteJob> = {}
): CollectionWriteJob {
  return {
    accountKey: collectionAccountKey(fence),
    laneKey: collectionLaneKey(fence, collectionId),
    run: vi.fn().mockResolvedValue(undefined),
    shouldRetry: () => false,
    onPermanentFailure: vi.fn(),
    onTransientFailure: vi.fn(),
    ...overrides,
  };
}

describe("CollectionWriteThroughCoordinator", () => {
  it("keeps token rotations in the same account and collection FIFO lane", () => {
    const rotated = { ...fence, sessionToken: "session-2", generation: 4 };

    expect(collectionAccountKey(rotated)).toBe(collectionAccountKey(fence));
    expect(collectionLaneKey(rotated, "collection-1"))
      .toBe(collectionLaneKey(fence, "collection-1"));
  });

  it("serializes create and every dependent command in one collection lane", async () => {
    const coordinator = new CollectionWriteThroughCoordinator();
    const createGate = deferred<void>();
    const events: string[] = [];
    const laneKey = collectionLaneKey(fence, "collection-1");

    coordinator.enqueue(job("collection-1", {
      run: async () => {
        events.push("create:start");
        await createGate.promise;
        events.push("create:end");
      },
    }));
    coordinator.enqueue(job("collection-1", {
      run: async () => {
        events.push("set-item");
      },
    }));
    coordinator.enqueue(job("collection-1", {
      run: async () => {
        events.push("rename");
      },
    }));

    await vi.waitFor(() => expect(events).toEqual(["create:start"]));
    expect(coordinator.hasPending(collectionAccountKey(fence))).toBe(true);
    createGate.resolve();
    await coordinator.waitForIdle(laneKey);

    expect(events).toEqual(["create:start", "create:end", "set-item", "rename"]);
    expect(coordinator.hasPending(collectionAccountKey(fence))).toBe(false);
  });

  it("retries one transient failure without duplicating the permanent callback", async () => {
    const coordinator = new CollectionWriteThroughCoordinator();
    const transient = Object.assign(new Error("offline"), { transient: true });
    const onTransientFailure = vi.fn();
    const onPermanentFailure = vi.fn();
    const run = vi.fn().mockRejectedValue(transient);
    const laneKey = collectionLaneKey(fence, "collection-2");

    coordinator.enqueue(job("collection-2", {
      run,
      shouldRetry: (error) => (error as { transient?: boolean }).transient === true,
      onTransientFailure,
      onPermanentFailure,
    }));
    await coordinator.waitForIdle(laneKey);

    expect(run).toHaveBeenCalledTimes(2);
    expect(onTransientFailure).toHaveBeenCalledOnce();
    expect(onPermanentFailure).not.toHaveBeenCalled();
  });

  it("does not retry a permanent failure and lets the next queued command continue", async () => {
    const coordinator = new CollectionWriteThroughCoordinator();
    const events: string[] = [];
    const onPermanentFailure = vi.fn(() => events.push("rollback"));
    const laneKey = collectionLaneKey(fence, "collection-3");

    coordinator.enqueue(job("collection-3", {
      run: vi.fn(async () => {
        events.push("create");
        throw new Error("invalid");
      }),
      onPermanentFailure,
    }));
    coordinator.enqueue(job("collection-3", {
      run: vi.fn(async () => {
        events.push("dependent");
      }),
    }));
    await coordinator.waitForIdle(laneKey);

    expect(events).toEqual(["create", "rollback", "dependent"]);
    expect(onPermanentFailure).toHaveBeenCalledOnce();
  });

  it("allows independent collection lanes to progress in parallel", async () => {
    const coordinator = new CollectionWriteThroughCoordinator();
    const firstGate = deferred<void>();
    const events: string[] = [];

    coordinator.enqueue(job("slow", {
      run: async () => {
        events.push("slow:start");
        await firstGate.promise;
      },
    }));
    coordinator.enqueue(job("fast", {
      run: async () => {
        events.push("fast");
      },
    }));

    await vi.waitFor(() => expect(events).toEqual(["slow:start", "fast"]));
    firstGate.resolve();
    await Promise.all([
      coordinator.waitForIdle(collectionLaneKey(fence, "slow")),
      coordinator.waitForIdle(collectionLaneKey(fence, "fast")),
    ]);
  });

  it("waits for every parallel lane in one account", async () => {
    const coordinator = new CollectionWriteThroughCoordinator();
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    let idle = false;

    coordinator.enqueue(job("first", { run: () => firstGate.promise }));
    coordinator.enqueue(job("second", { run: () => secondGate.promise }));
    const waiting = coordinator.waitForAccountIdle(collectionAccountKey(fence))
      .then(() => { idle = true; });

    firstGate.resolve();
    await Promise.resolve();
    expect(idle).toBe(false);
    secondGate.resolve();
    await waiting;
    expect(idle).toBe(true);
  });
});

describe("collection login merge barrier", () => {
  it("blocks commands until a guest UUID remap is available", async () => {
    const mergeFence = { ...fence, userId: "merge-owner-1" };
    const handle = beginCollectionMerge(mergeFence);
    let settled = false;
    const waiting = waitForCollectionMerge(mergeFence.userId).then((idMap) => {
      settled = true;
      return idMap;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    completeCollectionMerge(handle, { "guest-id": "server-id" });
    const idMap = await waiting;

    expect(remapCollectionCommand(
      { action: "delete", id: "guest-id" },
      idMap
    )).toEqual({ action: "delete", id: "server-id" });
  });

  it("keeps a failed current barrier closed until a later merge replaces it", async () => {
    const mergeFence = { ...fence, userId: "merge-owner-2" };
    const failed = beginCollectionMerge(mergeFence);
    failCollectionMerge(failed, new Error("offline"));

    await expect(waitForCollectionMerge(mergeFence.userId)).rejects.toThrow("offline");

    const replacement = beginCollectionMerge({ ...mergeFence, generation: 4 });
    completeCollectionMerge(replacement, {});
    await expect(waitForCollectionMerge(mergeFence.userId)).resolves.toEqual({});
  });
});
