import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  createStudioPagesHistoryCommandJournalClient,
  STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS,
  type StudioPagesHistoryCommandJournalClientOptions,
} from "./studio-pages-history-command-journal-client";

import type {
  StudioHistoryJournalNavigationTarget,
  StudioHistoryJournalTransitionInput,
} from "./studio-pages-history-command-journal";
import type { StudioPagesHistoryDurabilityStatus } from "./studio-pages-history-durable-runtime";

function pages(elementCount: number) {
  return [{
    id: "page-1",
    elements: Array.from({ length: elementCount }, (_, index) => ({
      id: `element-${index}`,
    })),
    canvasH: 2_000,
  }];
}

function deferredRuntime() {
  let resolve!: (runtime: FakeRuntime) => void;
  const promise = new Promise<FakeRuntime>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeRuntime {
  disposeCount = 0;
  readonly actions: Array<
    | { kind: "transition"; input: StudioHistoryJournalTransitionInput }
    | { kind: "undo" | "redo" | "rebase"; target: StudioHistoryJournalNavigationTarget }
    | { kind: "reset" }
  > = [];

  recordTransition(input: StudioHistoryJournalTransitionInput) {
    this.actions.push({ kind: "transition", input });
  }

  recordUndo(target: StudioHistoryJournalNavigationTarget) {
    this.actions.push({ kind: "undo", target });
  }

  recordRedo(target: StudioHistoryJournalNavigationTarget) {
    this.actions.push({ kind: "redo", target });
  }

  rebase(target: StudioHistoryJournalNavigationTarget) {
    this.actions.push({ kind: "rebase", target });
  }

  reset() {
    this.actions.push({ kind: "reset" });
  }

  dispose() {
    this.disposeCount += 1;
  }
}

class BrokenRecoveryRuntime extends FakeRuntime {
  constructor(
    private readonly applyFailure: Error,
    private readonly recoveryFailure: Error
  ) {
    super();
  }

  override recordTransition(_input: StudioHistoryJournalTransitionInput) {
    throw this.applyFailure;
  }

  override rebase(_target: StudioHistoryJournalNavigationTarget) {
    throw this.recoveryFailure;
  }

  override reset() {
    throw this.recoveryFailure;
  }
}

class DurabilityRuntime extends FakeRuntime {
  closeCount = 0;

  constructor(
    private readonly status: StudioPagesHistoryDurabilityStatus,
  ) {
    super();
  }

  durabilityStatus() {
    return this.status;
  }

  async close() {
    this.closeCount += 1;
    this.dispose();
  }
}

function clientWithDeferredRuntime() {
  const deferred = deferredRuntime();
  const loadRuntime = vi.fn(() => deferred.promise);
  const client = createStudioPagesHistoryCommandJournalClient({
    loadRuntime,
  } satisfies StudioPagesHistoryCommandJournalClientOptions);
  return { client, deferred, loadRuntime };
}

describe("Studio pages history command journal lazy client", () => {
  it("does not block an edit and replays queued actions in order after loading", async () => {
    const { client, deferred, loadRuntime } = clientWithDeferredRuntime();
    const runtime = new FakeRuntime();

    client.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(0),
      nextPages: pages(1),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });
    client.recordUndo({ pages: pages(0), historyIndex: 0 });
    expect(runtime.actions).toEqual([]);
    await vi.waitFor(() => expect(loadRuntime).toHaveBeenCalledOnce());

    deferred.resolve(runtime);
    await client.ready();
    expect(runtime.actions.map((action) => action.kind)).toEqual([
      "transition",
      "undo",
    ]);
  });

  it("coalesces pointer samples before the runtime chunk resolves", async () => {
    const { client, deferred } = clientWithDeferredRuntime();
    const runtime = new FakeRuntime();

    for (let index = 0; index < 128; index += 1) {
      client.recordTransition({
        mutationKind: "transform.drag",
        previousPages: pages(index),
        nextPages: pages(index + 1),
        previousHistoryIndex: index === 0 ? 0 : 1,
        nextHistoryIndex: 1,
        coalesceKey: "transform:selected",
      });
    }
    deferred.resolve(runtime);
    await client.ready();

    expect(runtime.actions).toHaveLength(1);
    expect(runtime.actions[0]).toMatchObject({
      kind: "transition",
      input: {
        previousHistoryIndex: 0,
        nextHistoryIndex: 1,
        nextPages: [{ elements: expect.any(Array) }],
      },
    });
    const transition = runtime.actions[0];
    expect(transition?.kind === "transition"
      ? transition.input.nextPages[0]?.elements
      : []).toHaveLength(128);
  });

  it("collapses an overloaded pre-load queue to the latest authoritative checkpoint", async () => {
    const { client, deferred } = clientWithDeferredRuntime();
    const runtime = new FakeRuntime();

    for (let index = 0; index < 80; index += 1) {
      client.recordTransition({
        mutationKind: `step-${index}`,
        previousPages: pages(index),
        nextPages: pages(index + 1),
        previousHistoryIndex: index,
        nextHistoryIndex: index + 1,
      });
    }
    deferred.resolve(runtime);
    await client.ready();

    expect(runtime.actions.at(0)).toMatchObject({
      kind: "rebase",
      target: {
        historyIndex: 65,
      },
    });
    expect(runtime.actions.at(-1)).toMatchObject({
      kind: "transition",
      input: {
        nextHistoryIndex: 80,
      },
    });
    expect(runtime.actions.length).toBeLessThanOrEqual(16);
  });

  it("contains synchronous loader and diagnostic callback throws outside the edit path", async () => {
    const loaderFailure = new Error("synchronous loader failure");
    const loadRuntime = vi.fn((): Promise<FakeRuntime> => {
      throw loaderFailure;
    });
    const onError = vi.fn(() => {
      throw new Error("diagnostic callback failure");
    });
    const client = createStudioPagesHistoryCommandJournalClient({
      loadRuntime,
      onError,
    });

    expect(() => {
      client.recordTransition({
        mutationKind: "elements.commit",
        previousPages: pages(0),
        nextPages: pages(1),
        previousHistoryIndex: 0,
        nextHistoryIndex: 1,
      });
    }).not.toThrow();

    await expect(client.ready()).rejects.toBe(loaderFailure);
    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(loaderFailure);
  });

  it("reports a failed ready attempt and retries from the retained checkpoint", async () => {
    const loaderFailure = new Error("first lazy load failed");
    const runtime = new FakeRuntime();
    let attempt = 0;
    const loadRuntime = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw loaderFailure;
      return runtime;
    });
    const client = createStudioPagesHistoryCommandJournalClient({ loadRuntime });

    client.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(0),
      nextPages: pages(1),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });

    await expect(client.ready()).rejects.toBe(loaderFailure);
    await expect(client.ready()).resolves.toBeUndefined();
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(runtime.actions).toEqual([
      {
        kind: "rebase",
        target: {
          pages: pages(1),
          historyIndex: 1,
        },
      },
    ]);
  });

  it("retains the latest checkpoint when runtime application and recovery both fail", async () => {
    const applyFailure = new Error("runtime application failed");
    const recoveryFailure = new Error("runtime recovery failed");
    const brokenRuntime = new BrokenRecoveryRuntime(applyFailure, recoveryFailure);
    const replacementRuntime = new FakeRuntime();
    let attempt = 0;
    const loadRuntime = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? brokenRuntime : replacementRuntime;
    });
    const onError = vi.fn();
    const client = createStudioPagesHistoryCommandJournalClient({
      loadRuntime,
      onError,
    });

    client.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(0),
      nextPages: pages(2),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });

    await expect(client.ready()).rejects.toBe(recoveryFailure);
    await expect(client.ready()).resolves.toBeUndefined();
    expect(onError).toHaveBeenNthCalledWith(1, applyFailure);
    expect(onError).toHaveBeenNthCalledWith(2, recoveryFailure);
    expect(replacementRuntime.actions).toEqual([
      {
        kind: "rebase",
        target: {
          pages: pages(2),
          historyIndex: 1,
        },
      },
    ]);
  });

  it("drops queued graphs and never replays a runtime that resolves after disposal", async () => {
    const { client, deferred, loadRuntime } = clientWithDeferredRuntime();
    const runtime = new FakeRuntime();

    client.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(0),
      nextPages: pages(1),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });
    await vi.waitFor(() => expect(loadRuntime).toHaveBeenCalledOnce());
    client.dispose();
    client.recordUndo({ pages: pages(0), historyIndex: 0 });

    deferred.resolve(runtime);
    await deferred.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.actions).toEqual([]);
    expect(runtime.disposeCount).toBe(1);
    await expect(client.ready()).rejects.toThrow(
      "Studio history journal client has been disposed."
    );
    expect(loadRuntime).toHaveBeenCalledOnce();
  });

  it("retries a memory-only authority and checkpoints the latest accepted snapshot", async () => {
    const unavailable = new Error("durable authority unavailable");
    const memoryRuntime = new DurabilityRuntime({
      state: "memory-only",
      durable: false,
      persistenceKind: "memory-only",
      retryable: true,
      cause: unavailable,
    });
    const durableRuntime = new DurabilityRuntime({
      state: "durable",
      durable: true,
      persistenceKind: "sqlite-opfs",
      retryable: false,
      cause: null,
    });
    const onDurabilityStatus = vi.fn();
    let attempt = 0;
    const client = createStudioPagesHistoryCommandJournalClient({
      loadRuntime: async () => (++attempt === 1 ? memoryRuntime : durableRuntime),
      onDurabilityStatus,
    });

    client.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(0),
      nextPages: pages(3),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });
    await client.ready();
    expect(client.durabilityStatus()).toMatchObject({ state: "memory-only" });

    await expect(client.retryDurability()).resolves.toBe(true);
    expect(memoryRuntime.closeCount).toBe(1);
    expect(durableRuntime.actions).toEqual([
      {
        kind: "rebase",
        target: {
          pages: pages(3),
          historyIndex: 1,
        },
      },
    ]);
    expect(client.durabilityStatus()).toMatchObject({
      state: "durable",
      persistenceKind: "sqlite-opfs",
    });
    expect(onDurabilityStatus.mock.calls.map(([status]) => status.state)).toEqual([
      STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS.state,
      "memory-only",
      "retrying",
      "durable",
    ]);
  });

  it("keeps a failed retry explicitly memory-only and retryable", async () => {
    const onDurabilityStatus = vi.fn();
    const loadRuntime = vi.fn(async () => new DurabilityRuntime({
      state: "memory-only",
      durable: false,
      persistenceKind: "memory-only",
      retryable: true,
      cause: new Error("still unavailable"),
    }));
    const client = createStudioPagesHistoryCommandJournalClient({
      loadRuntime,
      onDurabilityStatus,
    });

    client.rebase({ pages: pages(2), historyIndex: 0 });
    await client.ready();
    await expect(client.retryDurability()).resolves.toBe(false);

    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(client.durabilityStatus()).toMatchObject({
      state: "memory-only",
      durable: false,
      retryable: true,
    });
    expect(onDurabilityStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "memory-only", retryable: true }),
    );
  });

  it("keeps the production journal status observable with a retry control", () => {
    const studioPage = readStudioCuttoonEditorSource();
    const shellRuntime = readFileSync(new URL("./studio-page-shell-runtime.ts", import.meta.url), "utf8");

    expect(shellRuntime).toContain("onError: (cause) =>");
    expect(shellRuntime).toContain("if (studioAutosaveDocumentBusy(cause)) return;");
    expect(shellRuntime.indexOf("if (studioAutosaveDocumentBusy(cause)) return;")).toBeLessThan(
      shellRuntime.indexOf('console.error("Studio command journal durability degraded."'),
    );
    expect(studioPage).toContain("setPagesHistoryDurabilityStatus");
    expect(studioPage).toContain("retryDurability()");
    expect(studioPage).toContain('data-studio-pages-history-durability="memory-only"');
    expect(studioPage).toContain("복구 기록 저장소 다시 연결");
  });
});
