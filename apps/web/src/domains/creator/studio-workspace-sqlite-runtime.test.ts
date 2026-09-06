import { describe, expect, it } from "vitest";

import {
  compareStudioWorkspaceSqliteSnapshots,
  createStudioWorkspacePersistenceRuntime,
  createStudioWorkspaceSqliteRepository,
  createStudioWorkspaceSqliteSnapshot,
  parseStudioWorkspaceSqliteSnapshot,
  type StudioWorkspaceInvalidationChannel,
} from "./studio-workspace-sqlite-runtime";
import {
  createStudioWorkspaceDefaultState,
  studioWorkspaceOwnerScope,
  updateStudioWorkspacePreferences,
} from "./studio-workspaces";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async set(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}

function testChannel() {
  const sent: unknown[] = [];
  const channel: StudioWorkspaceInvalidationChannel = {
    onmessage: null,
    postMessage(value) {
      sent.push(value);
    },
    close() {
      channel.onmessage = null;
    },
  };
  return { channel, sent };
}

describe("Studio workspace SQLite snapshot authority", () => {
  it("round-trips one canonical owner-scoped snapshot", () => {
    const ownerScope = studioWorkspaceOwnerScope("artist@example.com");
    const snapshot = createStudioWorkspaceSqliteSnapshot({
      ownerScope,
      revision: 1,
      writerInstanceId: "writer-a",
      mutationId: "mutation-a",
      state: createStudioWorkspaceDefaultState("artist@example.com"),
    });

    expect(parseStudioWorkspaceSqliteSnapshot(
      JSON.stringify(snapshot),
      ownerScope,
    )).toEqual(snapshot);
  });

  it("rejects cross-owner payloads and malformed revisions", () => {
    const ownerScope = studioWorkspaceOwnerScope("artist@example.com");
    const otherOwner = studioWorkspaceOwnerScope("other@example.com");
    const snapshot = createStudioWorkspaceSqliteSnapshot({
      ownerScope,
      revision: 1,
      writerInstanceId: "writer-a",
      mutationId: "mutation-a",
      state: createStudioWorkspaceDefaultState("artist@example.com"),
    });

    expect(() => parseStudioWorkspaceSqliteSnapshot(
      JSON.stringify(snapshot),
      otherOwner,
    )).toThrow("identity or version");
    expect(() => createStudioWorkspaceSqliteSnapshot({
      ...snapshot,
      revision: 0,
    })).toThrow("positive safe integer");
  });

  it("orders equal revisions deterministically by writer and mutation", () => {
    const ownerScope = "guest";
    const state = createStudioWorkspaceDefaultState(null);
    const first = createStudioWorkspaceSqliteSnapshot({
      ownerScope,
      revision: 3,
      writerInstanceId: "writer-a",
      mutationId: "mutation-b",
      state,
    });
    const second = createStudioWorkspaceSqliteSnapshot({
      ownerScope,
      revision: 3,
      writerInstanceId: "writer-b",
      mutationId: "mutation-a",
      state,
    });

    expect(compareStudioWorkspaceSqliteSnapshots(first, second)).toBeLessThan(0);
    expect(compareStudioWorkspaceSqliteSnapshots(second, first)).toBeGreaterThan(0);
  });

  it("verifies repository writes and refuses an older snapshot", async () => {
    const store = memoryStore();
    const repository = createStudioWorkspaceSqliteRepository(store);
    const state = createStudioWorkspaceDefaultState(null);
    const current = createStudioWorkspaceSqliteSnapshot({
      ownerScope: "guest",
      revision: 2,
      writerInstanceId: "writer-b",
      mutationId: "mutation-b",
      state,
    });
    const stale = createStudioWorkspaceSqliteSnapshot({
      ownerScope: "guest",
      revision: 1,
      writerInstanceId: "writer-a",
      mutationId: "mutation-a",
      state,
    });

    await expect(repository.save(current)).resolves.toMatchObject({
      accepted: true,
      snapshot: current,
    });
    await expect(repository.save(stale)).resolves.toMatchObject({
      accepted: false,
      snapshot: current,
    });
    await expect(repository.load("guest")).resolves.toEqual(current);
  });

  it("fails a silently ignored OPFS write instead of claiming persistence", async () => {
    const repository = createStudioWorkspaceSqliteRepository({
      async get() {
        return null;
      },
      async set() {
        // Deliberately ignored.
      },
      async delete() {
        return undefined;
      },
    });
    const snapshot = createStudioWorkspaceSqliteSnapshot({
      ownerScope: "guest",
      revision: 1,
      writerInstanceId: "writer-a",
      mutationId: "mutation-a",
      state: createStudioWorkspaceDefaultState(null),
    });

    await expect(repository.save(snapshot)).rejects.toThrow("could not be verified");
  });
});

describe("Studio workspace SQLite product runtime", () => {
  it("hydrates an empty owner as SQLite-backed default without inventing persistence", async () => {
    const repository = createStudioWorkspaceSqliteRepository(memoryStore());
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-a",
      repositoryFactory: async () => repository,
      channelFactory: () => null,
    });
    const state = createStudioWorkspaceDefaultState(null);

    await expect(runtime.hydrate({
      getCurrentState: () => state,
      getDirtyRevision: () => 0,
    })).resolves.toMatchObject({
      state,
      authority: "sqlite-opfs",
      status: "session-only",
      source: "default",
      revision: 0,
    });
    runtime.close();
  });

  it("persists a scoped edit and broadcasts revision metadata without state", async () => {
    const repository = createStudioWorkspaceSqliteRepository(memoryStore());
    const { channel, sent } = testChannel();
    let mutation = 0;
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: "artist@example.com",
      writerInstanceId: "writer-a",
      createMutationId: () => `mutation-${++mutation}`,
      repositoryFactory: async () => repository,
      channelFactory: () => channel,
    });
    const base = createStudioWorkspaceDefaultState("artist@example.com");
    await runtime.hydrate({
      getCurrentState: () => base,
      getDirtyRevision: () => 0,
    });
    const edited = updateStudioWorkspacePreferences(base, {
      mobileControlSide: "left",
    });
    const result = await runtime.save(edited, runtime.ownerScope, 1);

    expect(result).toMatchObject({
      status: "persisted",
      authority: "sqlite-opfs",
      revision: 1,
      guardRevision: 1,
    });
    expect(result.state.mobileControlSide).toBe("left");
    expect(sent).toEqual([{
      v: 1,
      type: "studio-workspace-invalidated",
      ownerScope: runtime.ownerScope,
      revision: 1,
    }]);
    expect(JSON.stringify(sent)).not.toContain("liveLayout");
    runtime.close();
  });

  it("rejects a state crossing an authentication boundary", async () => {
    const repository = createStudioWorkspaceSqliteRepository(memoryStore());
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: "artist@example.com",
      writerInstanceId: "writer-a",
      repositoryFactory: async () => repository,
      channelFactory: () => null,
    });
    const guest = createStudioWorkspaceDefaultState(null);

    await expect(runtime.save(guest, "guest", 1)).resolves.toMatchObject({
      status: "session-only",
      failure: "owner-mismatch",
      authority: "memory-only",
    });
    runtime.close();
  });

  it("reconciles disjoint local and external edits through SQLite authority", async () => {
    const store = memoryStore();
    const repository = createStudioWorkspaceSqliteRepository(store);
    let firstMutation = 0;
    let secondMutation = 0;
    const first = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-a",
      createMutationId: () => `first-${++firstMutation}`,
      repositoryFactory: async () => repository,
      channelFactory: () => null,
    });
    const second = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-b",
      createMutationId: () => `second-${++secondMutation}`,
      repositoryFactory: async () => repository,
      channelFactory: () => null,
    });
    const base = createStudioWorkspaceDefaultState(null);
    await first.hydrate({ getCurrentState: () => base, getDirtyRevision: () => 0 });
    await second.hydrate({ getCurrentState: () => base, getDirtyRevision: () => 0 });

    const external = updateStudioWorkspacePreferences(base, {
      mobileControlSide: "left",
    });
    await first.save(external, "guest", 1);
    const local = updateStudioWorkspacePreferences(base, {
      applyQuickActionsOnSwitch: false,
    });
    const reconciled = await second.reconcile({
      sourceOwnerScope: "guest",
      baseState: base,
      getLocalState: () => local,
      getDirtyRevision: () => 1,
    });

    expect(reconciled.status).toBe("persisted");
    expect(reconciled.state.mobileControlSide).toBe("left");
    expect(reconciled.state.applyQuickActionsOnSwitch).toBe(false);
    expect(reconciled.conflictPaths).toEqual([]);
    first.close();
    second.close();
  });

  it("surfaces SQLite failure as explicit memory-only authority", async () => {
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-a",
      repositoryFactory: async () => {
        throw new DOMException("OPFS blocked", "SecurityError");
      },
      channelFactory: () => null,
    });
    const state = createStudioWorkspaceDefaultState(null);

    await expect(runtime.hydrate({
      getCurrentState: () => state,
      getDirtyRevision: () => 0,
    })).resolves.toMatchObject({
      state,
      authority: "memory-only",
      status: "session-only",
      failure: "read-failed",
    });
    expect(runtime.authority()).toBe("memory-only");
    runtime.close();
  });

  it("classifies another page owning OPFS SQLite as ownership-busy", async () => {
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-a",
      repositoryFactory: async () => {
        throw new Error(
          "DedicatedWorker ownership lock failed: Studio OPFS SQLite is already owned by another page",
        );
      },
      channelFactory: () => null,
    });
    const state = createStudioWorkspaceDefaultState(null);

    await expect(runtime.hydrate({
      getCurrentState: () => state,
      getDirtyRevision: () => 0,
    })).resolves.toMatchObject({
      authority: "memory-only",
      status: "session-only",
      failure: "ownership-busy",
    });
    runtime.close();
  });

  it("accepts only same-owner revision invalidations", () => {
    const repository = createStudioWorkspaceSqliteRepository(memoryStore());
    const { channel } = testChannel();
    const runtime = createStudioWorkspacePersistenceRuntime({
      userId: null,
      writerInstanceId: "writer-a",
      repositoryFactory: async () => repository,
      channelFactory: () => channel,
    });
    const revisions: number[] = [];
    runtime.subscribeInvalidation((event) => revisions.push(event.revision));

    channel.onmessage?.({
      data: {
        v: 1,
        type: "studio-workspace-invalidated",
        ownerScope: "guest",
        revision: 4,
      },
    } as MessageEvent);
    channel.onmessage?.({
      data: {
        v: 1,
        type: "studio-workspace-invalidated",
        ownerScope: studioWorkspaceOwnerScope("other@example.com"),
        revision: 5,
      },
    } as MessageEvent);
    channel.onmessage?.({ data: { revision: 6 } } as MessageEvent);

    expect(revisions).toEqual([4]);
    runtime.close();
  });
});
