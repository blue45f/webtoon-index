import { describe, expect, it, vi } from "vitest";

import { createStudioHybridDccLatestTaskQueue } from "./studio-hybrid-dcc-latest-task-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("Studio Hybrid DCC latest task queue", () => {
  it("keeps only the newest pending checkpoint behind a slow save", async () => {
    const queue = createStudioHybridDccLatestTaskQueue();
    const first = deferred();
    const order: string[] = [];
    queue.enqueue("work-a", { run: async () => { order.push("first"); await first.promise; } });
    queue.enqueue("work-a", { run: async () => { order.push("obsolete"); } });
    queue.enqueue("work-a", { run: async () => { order.push("latest"); } });
    await settle();
    expect(order).toEqual(["first"]);
    expect(queue.activeScopeCount).toBe(1);

    first.resolve();
    await settle();
    expect(order).toEqual(["first", "latest"]);
    expect(queue.activeScopeCount).toBe(0);
  });

  it("drains independent document scopes without head-of-line blocking", async () => {
    const queue = createStudioHybridDccLatestTaskQueue();
    const slow = deferred();
    const other = vi.fn(async () => undefined);
    queue.enqueue("work-a", { run: () => slow.promise });
    queue.enqueue("work-b", { run: other });
    await settle();
    expect(other).toHaveBeenCalledOnce();
    expect(queue.activeScopeCount).toBe(1);
    slow.resolve();
    await settle();
    expect(queue.activeScopeCount).toBe(0);
  });

  it("reports a failed task and still drains the newest pending task", async () => {
    const queue = createStudioHybridDccLatestTaskQueue();
    const gate = deferred();
    const error = vi.fn();
    const latest = vi.fn(async () => undefined);
    queue.enqueue("work-a", {
      run: async () => {
        await gate.promise;
        throw new Error("quota");
      },
      onError: error,
    });
    queue.enqueue("work-a", { run: latest });
    gate.resolve();
    await settle();
    expect(error).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(queue.activeScopeCount).toBe(0);
  });
});
