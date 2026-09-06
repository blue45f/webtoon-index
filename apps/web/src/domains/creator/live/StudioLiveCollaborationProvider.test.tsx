import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_CRDT_PROTOCOL_VERSION } from "./studio-crdt-protocol";
import { StudioLiveCollaborationProvider } from "./StudioLiveCollaborationProvider";

import type { StudioCrdtRecoveryVaultEntry } from "./studio-crdt-recovery-vault";
import type { StudioLiveCollaborationContextValue } from "./studio-live-collaboration-context";
import type { StudioLiveParticipant } from "./studio-live-collaboration-protocol";
import type { StudioLiveRoomEvent } from "./studio-live-collaboration-room";
import type { StudioLiveTransportFactory } from "./studio-live-collaboration-transport";
import type { ReactNode } from "react";

type EffectCleanup = (() => void) | undefined;

type HookSlot =
  | { kind: "state"; value: unknown }
  | { kind: "ref"; value: { current: unknown } }
  | {
      kind: "effect";
      dependencies: readonly unknown[] | undefined;
      cleanup: EffectCleanup;
    };

interface PendingEffect {
  index: number;
  effect: () => void | (() => void);
}

interface RoomRecord {
  options: {
    workId: string;
    participant: StudioLiveParticipant;
    dependencies?: { transportFactory?: StudioLiveTransportFactory };
  };
  ready: boolean;
  closeCount: number;
  startCount: number;
  unsubscribeCount: number;
  clearCursorCount: number;
  presenceUpdates: Array<Record<string, unknown>>;
  emit: (event: StudioLiveRoomEvent) => void;
}

interface MockBindingStatus {
  state: "idle" | "syncing" | "ready" | "retrying" | "error" | "recovery-required";
  message: string;
  durabilityAtRisk?: boolean;
  pendingCount?: number;
  persistenceDurability?: "checking" | "durable" | "degraded" | "unavailable";
  transportReady?: boolean;
  lastAckAt?: number | null;
  lastAckServerSequence?: string | null;
  code?: string;
  updateId?: string;
  recoveryUpdateCount?: number;
  collaborativeEditsBlocked?: true;
  retryable?: false;
  recoveryVaultId?: string;
  recoveryExportAvailable?: boolean;
}

/**
 * The repository intentionally runs Vitest in Node without jsdom. This tiny deterministic hook
 * driver exercises this provider's effect lifecycle directly; it is not a general React renderer.
 */
const hooks = vi.hoisted(() => {
  const slots: HookSlot[] = [];
  let cursor = 0;
  let dirty = false;
  let pending: PendingEffect[] = [];

  function equalDependencies(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined
  ): boolean {
    if (previous === undefined || next === undefined || previous.length !== next.length) {
      return false;
    }
    return previous.every((value, index) => Object.is(value, next[index]));
  }

  function useState<T>(initialValue: T | (() => T)) {
    const index = cursor++;
    const existing = slots[index];
    const slot = existing ?? {
      kind: "state" as const,
      value: typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue,
    };
    if (slot.kind !== "state") throw new Error(`Hook ${index} changed kind.`);
    slots[index] = slot;

    const setValue = (nextValue: T | ((previousValue: T) => T)) => {
      const previousValue = slot.value as T;
      const resolvedValue = typeof nextValue === "function"
        ? (nextValue as (previousValue: T) => T)(previousValue)
        : nextValue;
      if (Object.is(previousValue, resolvedValue)) return;
      slot.value = resolvedValue;
      dirty = true;
    };
    return [slot.value as T, setValue] as const;
  }

  function useRef<T>(initialValue: T) {
    const index = cursor++;
    const existing = slots[index];
    const slot = existing ?? { kind: "ref" as const, value: { current: initialValue } };
    if (slot.kind !== "ref") throw new Error(`Hook ${index} changed kind.`);
    slots[index] = slot;
    return slot.value as { current: T };
  }

  function useEffect(
    effect: () => void | (() => void),
    dependencies?: readonly unknown[]
  ): void {
    const index = cursor++;
    const existing = slots[index];
    if (existing && existing.kind !== "effect") {
      throw new Error(`Hook ${index} changed kind.`);
    }
    if (existing && equalDependencies(existing.dependencies, dependencies)) return;
    slots[index] = {
      kind: "effect",
      dependencies,
      cleanup: existing?.cleanup,
    };
    pending.push({ index, effect });
  }

  function flushEffects(): void {
    const effects = pending;
    pending = [];
    for (const { index, effect } of effects) {
      const slot = slots[index];
      if (!slot || slot.kind !== "effect") throw new Error(`Missing effect hook ${index}.`);
      slot.cleanup?.();
      const cleanup = effect();
      slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  function render(renderComponent: () => ReactNode): ReactNode {
    for (let pass = 1; pass <= 20; pass += 1) {
      dirty = false;
      cursor = 0;
      const output = renderComponent();
      flushEffects();
      if (!dirty && pending.length === 0) return output;
    }
    throw new Error("Provider did not reach a stable hook state.");
  }

  function unmount(): void {
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      const slot = slots[index];
      if (slot?.kind === "effect") slot.cleanup?.();
    }
    slots.length = 0;
    pending = [];
    cursor = 0;
    dirty = false;
  }

  function reset(): void {
    unmount();
  }

  return { render, reset, unmount, useEffect, useRef, useState };
});

const rooms = vi.hoisted(() => ({ instances: [] as RoomRecord[] }));
const recoveryDownloads = vi.hoisted(() => ({ count: 0 }));
const recoveryVault = vi.hoisted(() => ({
  entries: [] as StudioCrdtRecoveryVaultEntry[],
  listCount: 0,
  emptyReadsBeforeVisible: 0,
}));
const lifecycle = vi.hoisted(() => ({
  roomStart: "pending" as "pending" | "resolve" | "reject",
  bindingStart: "resolve" as "pending" | "resolve" | "reject",
  bindingStartResolvers: [] as Array<() => void>,
  bindingStatusOnStart: null as MockBindingStatus | null,
  documents: [] as Array<{ destroyCount: number }>,
  bindings: [] as Array<{
    closeCount: number;
    closeGracefullyCount: number;
    authoritativeBarrierCount: number;
    document: { destroyCount: number };
    onStatus?: (status: MockBindingStatus) => void;
  }>,
}));

vi.mock("./studio-crdt-recovery-vault", () => ({
  createStudioCrdtRecoveryVault: () => ({
    list: async (scope: string, workId: string) => {
      recoveryVault.listCount += 1;
      if (recoveryVault.listCount <= recoveryVault.emptyReadsBeforeVisible) return [];
      return recoveryVault.entries.filter((entry) =>
        entry.scope === scope && entry.workId === workId
      );
    },
  }),
  downloadStudioCrdtRecoveryBundle: async () => {
    recoveryDownloads.count += 1;
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

vi.mock("./studio-live-collaboration-room", () => {
  class StudioLiveRoom {
    readonly mode = "server";
    readonly workId: string;
    readonly record: RoomRecord;

    get ready(): boolean {
      return this.record.ready;
    }

    constructor(options: RoomRecord["options"]) {
      this.workId = options.workId;
      this.record = {
        options,
        ready: false,
        closeCount: 0,
        startCount: 0,
        unsubscribeCount: 0,
        clearCursorCount: 0,
        presenceUpdates: [],
        emit: () => undefined,
      };
      rooms.instances.push(this.record);
    }

    subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void {
      this.record.emit = listener;
      return () => {
        this.record.unsubscribeCount += 1;
        this.record.emit = () => undefined;
      };
    }

    get participant(): StudioLiveParticipant {
      return this.record.options.participant;
    }

    start(): Promise<void> {
      this.record.startCount += 1;
      if (lifecycle.roomStart === "reject") {
        return Promise.reject(new Error("room start failed"));
      }
      if (lifecycle.roomStart === "resolve") {
        this.record.ready = true;
        return Promise.resolve();
      }
      return new Promise(() => undefined);
    }

    getPeers(): [] {
      return [];
    }

    getLocks(): [] {
      return [];
    }

    updatePresence(patch: Record<string, unknown>): void {
      this.record.presenceUpdates.push(patch);
    }

    clearCursor(): boolean {
      this.record.clearCursorCount += 1;
      return true;
    }

    close(): void {
      this.record.closeCount += 1;
    }
  }

  return { StudioLiveRoom };
});

// The provider resolves the room and the adaptive cursor transport in one Promise.all. Leaving the
// transport module real adds a second module graph to that await, so the room is not constructed
// within the microtask budget renderProvider spends — every room assertion then reads undefined.
// The stub also records which base factory was wrapped, which is the observable this suite needs.
vi.mock("./studio-live-adaptive-cursor-transport", () => ({
  STUDIO_LIVE_CURSOR_CAPTURE_INTERVAL_MS: 16,
  createStudioAdaptiveCursorTransportFactory: (
    dependencies: { baseFactory?: unknown } = {},
  ) => {
    const factory = (): never => {
      throw new Error("The mocked room must not open a real transport.");
    };
    (factory as { wrappedBaseFactory?: unknown }).wrappedBaseFactory =
      dependencies.baseFactory ?? null;
    return factory;
  },
}));

vi.mock("./studio-crdt-document", () => ({
  StudioCrdtDocument: class StudioCrdtDocument {
    readonly record = { destroyCount: 0 };

    constructor() {
      lifecycle.documents.push(this.record);
    }

    destroy(): void {
      this.record.destroyCount += 1;
    }
  },
}));

vi.mock("./studio-crdt-room-binding", () => ({
  StudioCrdtRoomBinding: class StudioCrdtRoomBinding {
    readonly record: (typeof lifecycle.bindings)[number];

    constructor(options: {
      document: { record: { destroyCount: number } };
      onStatus?: (status: MockBindingStatus) => void;
    }) {
      this.record = {
        closeCount: 0,
        closeGracefullyCount: 0,
        authoritativeBarrierCount: 0,
        document: options.document.record,
        onStatus: options.onStatus,
      };
      lifecycle.bindings.push(this.record);
    }

    start(): Promise<void> {
      if (lifecycle.bindingStatusOnStart) this.record.onStatus?.(lifecycle.bindingStatusOnStart);
      if (lifecycle.bindingStart === "reject") {
        return Promise.reject(new Error("binding start failed"));
      }
      if (lifecycle.bindingStart === "resolve") return Promise.resolve();
      return new Promise<void>((resolve) => {
        lifecycle.bindingStartResolvers.push(resolve);
      });
    }

    get recoveryRequired(): boolean {
      return lifecycle.bindingStatusOnStart?.state === "recovery-required";
    }

    close(): void {
      this.record.closeCount += 1;
    }

    async closeGracefully(): Promise<void> {
      this.record.closeGracefullyCount += 1;
    }

    async flushAndWaitForAuthoritativeAck(): Promise<{
      serverSequence: string;
      acknowledgedAt: number;
    }> {
      this.record.authoritativeBarrierCount += 1;
      return { serverSequence: "41", acknowledgedAt: 1_234 };
    }
  },
}));

vi.mock("./studio-crdt-scene-publisher", () => ({
  publishStudioCrdtSceneGraphDiff: () => ({
    sceneElementMutations: 0,
    pageMutations: 0,
    elementMoves: 0,
    pageMoves: 0,
  }),
}));

vi.mock("./studio-crdt-history", () => ({
  reconcileStudioCrdtSceneGraphHistory: () => ({ history: [], changed: false }),
}));

vi.mock("./studio-crdt-page-bridge", () => ({
  reconcileStudioCrdtSceneGraphPages: () => ({ pages: [], changed: false }),
}));

vi.mock("./studio-crdt-raster-ui-bridge", () => ({
  nextStudioRasterLogicalClock: () => "1",
  planStudioRasterDrawPromotion: () => null,
  studioRasterDrawPromotionSourceMatches: () => false,
  publishStudioRasterHistoryTransition: () => ({
    undoOperationIds: [],
    acknowledgementIds: [],
  }),
  sha256StudioRasterSemanticParameters: async () => "0".repeat(64),
}));

const participant: Omit<StudioLiveParticipant, "sessionId"> = {
  displayName: "민지",
  role: "editor",
};

const transportFactory: StudioLiveTransportFactory = () => {
  throw new Error("The mocked room must not open a real transport.");
};

function recoveryVaultEntry(options: {
  rejectedUpdateId: string;
  vaultId?: string;
  scope?: string;
  workId?: string;
  status?: "pending-export" | "exported";
}): StudioCrdtRecoveryVaultEntry {
  const scope = options.scope ?? "user-a";
  const workId = options.workId ?? "work-a";
  return {
    vaultId: options.vaultId ?? "private-vault-id",
    scope,
    workId,
    status: options.status ?? "pending-export",
    failureCode: "forbidden",
    failureMessage: "server rejected update",
    rejectedUpdateId: options.rejectedUpdateId,
    updates: [{
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId,
      updateId: options.rejectedUpdateId,
      clientSequence: 1,
      update: "AQ==",
    }],
    createdAt: 1,
    exportedAt: options.status === "exported" ? 2 : null,
  };
}

interface RenderProviderOptions {
  children?: ReactNode;
  workId?: string | null;
  participant?: Omit<StudioLiveParticipant, "sessionId"> | null;
  currentPageId?: string | null;
  currentTool?: string | null;
  outboxScope?: string | null;
  transportFactory?: StudioLiveTransportFactory | null;
  serverRequired?: boolean;
  onRoomChange?: (room: unknown) => void;
  onCrdtDocumentChange?: (document: unknown, runtime: unknown | null) => void;
  onEditSafetyChange?: (editsDurablyProtected: boolean) => void;
  onAuthoritativeSaveBarrierChange?: (barrier: (() => Promise<unknown>) | null) => void;
}

function renderProviderOnce(
  options: RenderProviderOptions = {}
): StudioLiveCollaborationContextValue {
  const output = hooks.render(() => StudioLiveCollaborationProvider({
    children: options.children ?? null,
    workId: options.workId === undefined ? "work-a" : options.workId,
    participant: options.participant === undefined ? participant : options.participant,
    currentPageId: options.currentPageId === undefined ? "page-a" : options.currentPageId,
    currentTool: options.currentTool === undefined ? "pen" : options.currentTool,
    outboxScope: options.outboxScope ?? null,
    transportFactory:
      options.transportFactory === null
        ? undefined
        : (options.transportFactory ?? transportFactory),
    serverRequired: options.serverRequired,
    onRoomChange: options.onRoomChange,
    onCrdtDocumentChange: options.onCrdtDocumentChange,
    onEditSafetyChange: options.onEditSafetyChange,
    onAuthoritativeSaveBarrierChange: options.onAuthoritativeSaveBarrierChange,
  }));
  return (output as { props: { value: StudioLiveCollaborationContextValue } }).props.value;
}

/**
 * The provider fetches studio-live-collaboration-room on demand, so a single render pass no
 * longer produces a room. Draining the microtask queue and rendering again is what React does
 * once the lazy chunk lands, so every assertion below observes the post-resolution state — which
 * is also what makes this suite a proof that the dynamic boundary resolves.
 */
async function renderProvider(
  options: RenderProviderOptions = {}
): Promise<StudioLiveCollaborationContextValue> {
  renderProviderOnce(options);
  // The gated effect now awaits two dynamic imports (room + adaptive cursor transport) before it
  // constructs anything, so the drain has to outlast that chain rather than a single import.
  for (let tick = 0; tick < 64; tick += 1) await Promise.resolve();
  return renderProviderOnce(options);
}

describe("StudioLiveCollaborationProvider lifecycle", () => {
  beforeEach(() => {
    rooms.instances.length = 0;
    lifecycle.roomStart = "pending";
    lifecycle.bindingStart = "resolve";
    lifecycle.bindingStartResolvers.length = 0;
    lifecycle.bindingStatusOnStart = null;
    lifecycle.documents.length = 0;
    lifecycle.bindings.length = 0;
    recoveryDownloads.count = 0;
    recoveryVault.entries.length = 0;
    recoveryVault.listCount = 0;
    recoveryVault.emptyReadsBeforeVisible = 0;
  });

  afterEach(() => {
    hooks.reset();
    vi.unstubAllGlobals();
  });

  it("closes the previous room when the work or authorized participant changes", async () => {
    const onRoomChange = vi.fn();
    await renderProvider({ onRoomChange });
    const first = rooms.instances[0];

    await renderProvider({ workId: "work-b", onRoomChange });
    const second = rooms.instances[1];
    expect(first.closeCount).toBe(1);
    expect(first.unsubscribeCount).toBe(1);
    expect(second.options.workId).toBe("work-b");

    await renderProvider({ workId: "work-b", participant: null, onRoomChange });
    expect(second.closeCount).toBe(1);
    expect(rooms.instances).toHaveLength(2);

    await renderProvider({
      workId: "work-b",
      participant: { displayName: "서윤", role: "commenter" },
      onRoomChange,
    });
    const third = rooms.instances[2];
    expect(third.options.participant).toMatchObject({
      displayName: "서윤 · 이 탭",
      role: "commenter",
    });

    await renderProvider({
      workId: "work-b",
      participant: { displayName: "민호", role: "owner" },
      onRoomChange,
    });
    expect(third.closeCount).toBe(1);
    expect(third.unsubscribeCount).toBe(1);
    expect(rooms.instances[3].options.participant).toMatchObject({
      displayName: "민호 · 이 탭",
      role: "owner",
    });
  });

  it("updates page and tool presence without recreating the room", async () => {
    const onRoomChange = vi.fn();
    await renderProvider({ onRoomChange });
    const room = rooms.instances[0];

    expect(room.presenceUpdates).toEqual([{ pageId: "page-a", tool: "pen" }]);

    await renderProvider({ currentPageId: "page-b", currentTool: "eraser", onRoomChange });

    expect(rooms.instances).toHaveLength(1);
    expect(room.closeCount).toBe(0);
    expect(room.presenceUpdates).toEqual([
      { pageId: "page-a", tool: "pen" },
      { pageId: "page-b", tool: "eraser" },
    ]);
    expect(room.clearCursorCount).toBe(1);
  });

  it("builds no room until the deferred room module resolves, then runs the session normally", async () => {
    lifecycle.roomStart = "resolve";
    const onRoomChange = vi.fn();

    // One synchronous render pass is exactly what first paint of the canvas does. Nothing from
    // studio-live-collaboration-room may be reachable at that point — the module, its transports
    // and the live wire protocol only load once the gated effect asks for a session.
    const connecting = renderProviderOnce({ onRoomChange });
    expect(rooms.instances).toHaveLength(0);
    expect(onRoomChange).not.toHaveBeenCalled();
    expect(connecting.availability).toBe("connecting");

    const live = await renderProvider({ onRoomChange });

    expect(rooms.instances).toHaveLength(1);
    expect(rooms.instances[0]?.startCount).toBe(1);
    expect(onRoomChange).toHaveBeenCalledWith(expect.anything());
    expect(live.room).not.toBeNull();
    expect(live.availability).not.toBe("error");

    // The session still behaves the same after the chunk lands: presence, locks and chat all
    // flow through the subscription the deferred room installed.
    rooms.instances[0]?.emit({ type: "locks", locks: [] });
    const settled = await renderProvider({ onRoomChange });
    expect(settled.locks).toEqual([]);

    hooks.unmount();
    expect(rooms.instances[0]?.unsubscribeCount).toBe(1);
    await vi.waitFor(() => expect(rooms.instances[0]?.closeCount).toBe(1));
  });

  it("tears the effect down cleanly when it unmounts while the room module is still loading", async () => {
    const onRoomChange = vi.fn();

    renderProviderOnce({ onRoomChange });
    expect(rooms.instances).toHaveLength(0);
    hooks.unmount();
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();

    // An in-flight import must not resurrect a room for an editor that is already gone, and no
    // room object may escape to the parent after the teardown.
    expect(rooms.instances).toHaveLength(0);
    expect(
      onRoomChange.mock.calls.filter(([exposedRoom]) => exposedRoom !== null)
    ).toHaveLength(0);
  });

  it("starts a same-origin jam on the local transport even when a server factory exists", async () => {
    const live = await renderProvider({ serverRequired: false });

    expect(rooms.instances).toHaveLength(1);
    // The adaptive cursor transport is always installed; a same-origin jam is the case where it
    // wraps no server base factory.
    const jamFactory = rooms.instances[0]?.options.dependencies?.transportFactory as
      { wrappedBaseFactory?: unknown } | undefined;
    expect(jamFactory).toBeTypeOf("function");
    expect(jamFactory?.wrappedBaseFactory ?? null).toBeNull();
    expect(live.usingLocalFallback).toBe(true);
    expect(live.availability).not.toBe("error");
  });

  it("fails closed when an authenticated work loses its server transport", async () => {
    const live = await renderProvider({ transportFactory: null, serverRequired: true });

    expect(rooms.instances).toHaveLength(0);
    expect(live.availability).toBe("error");
    expect(live.mode).toBe("server");
    expect(live.usingLocalFallback).toBe(false);
    expect(live.error).toContain("자동 전환하지 않았습니다");
  });

  it("latches a terminal authorization failure across retries and transport rotation", async () => {
    const options = { serverRequired: true };
    await renderProvider(options);
    const room = rooms.instances[0];
    room.emit({
      type: "transport-status",
      status: {
        state: "revoked",
        recoverable: false,
        message: "작품 접근 권한이 회수되었습니다.",
      },
    });

    const revoked = await renderProvider(options);
    expect(revoked.localFallbackAllowed).toBe(false);
    expect(revoked.sync).toMatchObject({
      phase: "revoked",
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
    revoked.retryServer();
    revoked.useLocalFallback();
    const afterAttempt = await renderProvider(options);

    expect(rooms.instances).toHaveLength(1);
    expect(afterAttempt.usingLocalFallback).toBe(false);
    expect(room.closeCount).toBe(0);

    const rotatedTransportFactory: StudioLiveTransportFactory = () => {
      throw new Error("A revoked work must not open a replacement transport.");
    };
    const afterTokenRotation = await renderProvider({
      ...options,
      transportFactory: rotatedTransportFactory,
    });

    expect(rooms.instances).toHaveLength(1);
    expect(room.closeCount).toBe(1);
    expect(afterTokenRotation.sync).toMatchObject({
      phase: "revoked",
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
    expect(afterTokenRotation.localFallbackAllowed).toBe(false);

    await renderProvider({
      ...options,
      workId: "work-b",
      transportFactory: rotatedTransportFactory,
    });
    expect(rooms.instances).toHaveLength(2);
    expect(rooms.instances[1]?.options.workId).toBe("work-b");
  });

  it("keeps transport revocation terminal when CRDT recovery reports afterward", async () => {
    lifecycle.roomStart = "resolve";
    const options = { serverRequired: true, outboxScope: "user-a" };
    await renderProvider(options);
    await vi.waitFor(() => expect(lifecycle.bindings).toHaveLength(1));

    rooms.instances[0]?.emit({
      type: "transport-status",
      status: {
        state: "revoked",
        recoverable: false,
        message: "작품 접근 권한이 회수되었습니다.",
      },
    });
    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "거부된 변경 때문에 권위 원고 복구가 필요합니다.",
      code: "access_revoked",
      updateId: "private-update-id",
      recoveryUpdateCount: 1,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryVaultId: "private-vault-id",
      recoveryExportAvailable: true,
    });

    const live = await renderProvider(options);
    expect(live.sync).toMatchObject({
      phase: "revoked",
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
    expect(live.recovery).toBeNull();
    expect(live.error).toBe("작품 접근 권한이 회수되었습니다.");
    expect(live.localFallbackAllowed).toBe(false);
  });

  it("replaces CRDT recovery with transport revocation and keeps it across rotation", async () => {
    lifecycle.roomStart = "resolve";
    const options = { serverRequired: true, outboxScope: "user-a" };
    await renderProvider(options);
    await vi.waitFor(() => expect(lifecycle.bindings).toHaveLength(1));

    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "거부된 변경 때문에 권위 원고 복구가 필요합니다.",
      code: "access_revoked",
      updateId: "private-update-id",
      recoveryUpdateCount: 1,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryVaultId: "private-vault-id",
      recoveryExportAvailable: true,
    });
    expect((await renderProvider(options)).sync.phase).toBe("recovery-required");

    rooms.instances[0]?.emit({
      type: "transport-status",
      status: {
        state: "revoked",
        recoverable: false,
        message: "작품 접근 권한이 회수되었습니다.",
      },
    });
    const revoked = await renderProvider(options);
    expect(revoked.sync.phase).toBe("revoked");
    expect(revoked.recovery).toBeNull();
    expect(revoked.error).toBe("작품 접근 권한이 회수되었습니다.");

    const rotatedTransportFactory: StudioLiveTransportFactory = () => {
      throw new Error("A revoked work must not open a replacement transport.");
    };
    const afterRotation = await renderProvider({
      ...options,
      transportFactory: rotatedTransportFactory,
    });
    expect(rooms.instances).toHaveLength(1);
    expect(afterRotation.sync).toMatchObject({
      phase: "revoked",
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
    expect(afterRotation.recovery).toBeNull();
    expect(afterRotation.localFallbackAllowed).toBe(false);
  });

  it("unsubscribes, closes, and clears the exposed room on unmount", async () => {
    lifecycle.roomStart = "resolve";
    const onRoomChange = vi.fn();
    let live = await renderProvider({ onRoomChange });
    const room = rooms.instances[0];
    await vi.waitFor(async () => {
      live = await renderProvider({ onRoomChange });
      expect(live.availability).toBe("ready");
    });

    hooks.unmount();

    expect(room.unsubscribeCount).toBe(1);
    await vi.waitFor(() => expect(room.closeCount).toBe(1));
    expect(onRoomChange).toHaveBeenLastCalledWith(null);
  });

  it("exposes the CRDT document only after binding sync and destroys it on unmount", async () => {
    lifecycle.roomStart = "resolve";
    const onRoomChange = vi.fn();
    const onCrdtDocumentChange = vi.fn();
    await renderProvider({ onRoomChange, onCrdtDocumentChange });

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publish: expect.any(Function),
          reconcileHistory: expect.any(Function),
          reconcilePages: expect.any(Function),
        })
      );
    });
    const room = rooms.instances[0];
    const binding = lifecycle.bindings[0];
    const document = lifecycle.documents[0];

    hooks.unmount();
    await vi.waitFor(async () => {
      expect(binding?.closeGracefullyCount).toBe(1);
      expect(document?.destroyCount).toBe(1);
      expect(room?.closeCount).toBe(1);
    });

    expect(onCrdtDocumentChange).toHaveBeenLastCalledWith(null, null);
    expect(onRoomChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps operation sync fail-closed while the lazy runtime and initial binding are pending", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStart = "pending";
    const onRoomChange = vi.fn();
    const onCrdtDocumentChange = vi.fn();
    const options = { onRoomChange, onCrdtDocumentChange };

    const connecting = await renderProvider(options);

    expect(onRoomChange).toHaveBeenCalledWith(expect.anything());
    expect(onCrdtDocumentChange).toHaveBeenLastCalledWith(null, null);
    expect(connecting.availability).toBe("connecting");
    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(lifecycle.bindingStartResolvers).toHaveLength(1);
    });
    expect(
      onCrdtDocumentChange.mock.calls.filter(([document]) => document !== null)
    ).toHaveLength(0);

    lifecycle.bindingStartResolvers[0]?.();

    await vi.waitFor(async () => {
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publish: expect.any(Function),
          reconcileHistory: expect.any(Function),
          reconcilePages: expect.any(Function),
        })
      );
    });
  });

  it("does not overwrite a degraded local durability warning with ready after initial sync", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "error",
      message: "실시간 서버 동기화는 유지되지만 IndexedDB 복구 저장소가 저하되었습니다.",
      durabilityAtRisk: true,
    };
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publish: expect.any(Function),
          reconcileHistory: expect.any(Function),
          reconcilePages: expect.any(Function),
        })
      );
    });
    const live = await renderProvider(options);

    expect(live.availability).toBe("error");
    expect(live.error).toContain("IndexedDB 복구 저장소가 저하");
    expect(live.sync).toMatchObject({
      phase: "durability-risk",
      editsDurablyProtected: true,
    });
  });

  it("exposes pending count, local durability, transport readiness, and the latest ACK", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "ready",
      message: "팀 원고와 로컬 복구 저장소가 동기화됩니다.",
      pendingCount: 0,
      persistenceDurability: "durable",
      transportReady: true,
      lastAckAt: 1_234,
      lastAckServerSequence: "27",
    };
    const options = { onCrdtDocumentChange: vi.fn() };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(options.onCrdtDocumentChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything()
      );
    });
    const live = await renderProvider(options);
    expect(live.sync).toMatchObject({
      phase: "synced",
      pendingCount: 0,
      persistenceDurability: "durable",
      transportReady: true,
      operationSyncReady: true,
      lastAckAt: 1_234,
      lastAckServerSequence: "27",
      editsDurablyProtected: true,
    });
  });

  it("does not trigger hard reload while synced", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "ready",
      message: "팀 원고와 로컬 복구 저장소가 동기화됩니다.",
      pendingCount: 0,
      persistenceDurability: "durable",
      transportReady: true,
      lastAckAt: 1_234,
      lastAckServerSequence: "27",
    };

    const reloadSpy = vi.fn();
    vi.stubGlobal("location", { reload: reloadSpy } as unknown as Location);
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(expect.anything(), expect.anything());
    });

    const live = await renderProvider(options);
    await vi.waitFor(async () => {
      expect(live.sync.phase).toBe("synced");
    });

    live.reloadAuthoritative();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("exposes a same-generation authoritative save barrier and revokes it on teardown", async () => {
    lifecycle.roomStart = "resolve";
    const onAuthoritativeSaveBarrierChange = vi.fn();
    const options = {
      onCrdtDocumentChange: vi.fn(),
      onAuthoritativeSaveBarrierChange,
    };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(onAuthoritativeSaveBarrierChange).toHaveBeenCalledWith(expect.any(Function));
    });
    const barrier = onAuthoritativeSaveBarrierChange.mock.calls
      .map(([candidate]) => candidate)
      .find((candidate) => typeof candidate === "function") as (() => Promise<unknown>);

    await expect(barrier()).resolves.toEqual({
      serverSequence: "41",
      acknowledgedAt: 1_234,
    });
    expect(lifecycle.bindings[0]?.authoritativeBarrierCount).toBe(1);

    hooks.unmount();
    expect(onAuthoritativeSaveBarrierChange).toHaveBeenLastCalledWith(null);
  });

  it("reports fail-closed edit safety when both the server and browser outbox are unavailable", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "ready",
      message: "팀 원고와 로컬 복구 저장소가 동기화됩니다.",
      pendingCount: 0,
      persistenceDurability: "durable",
      transportReady: true,
    };
    const onEditSafetyChange = vi.fn();
    const options = {
      onCrdtDocumentChange: vi.fn(),
      onEditSafetyChange,
    };
    await renderProvider(options);

    await vi.waitFor(async () => {
      await renderProvider(options);
      expect(onEditSafetyChange).toHaveBeenLastCalledWith(true);
    });

    lifecycle.bindings[0]?.onStatus?.({
      state: "error",
      message: "서버 연결과 브라우저 복구 저장소가 모두 준비되지 않았습니다.",
      durabilityAtRisk: true,
      pendingCount: 1,
      persistenceDurability: "unavailable",
      transportReady: false,
    });
    await renderProvider(options);

    expect(onEditSafetyChange).toHaveBeenLastCalledWith(false);
  });

  it("locks collaborative editing immediately when a permanent CRDT rejection requires recovery", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "ready",
      message: "팀 원고가 실시간으로 동기화됩니다.",
    };
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange, serverRequired: true };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(expect.anything(), expect.anything());
    });
    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "서버가 이 변경을 영구 거부해 권위 원고 복구가 필요합니다.",
      code: "forbidden",
      updateId: "private-update-id",
      recoveryUpdateCount: 1,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryVaultId: "private-vault-id",
      recoveryExportAvailable: true,
    });

    const live = await renderProvider(options);
    expect(live.sync).toMatchObject({
      phase: "recovery-required",
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
    expect(live.recovery).toMatchObject({
      vaultId: "private-vault-id",
      updateCount: 1,
      exportAvailable: true,
      exported: false,
    });
    expect(live.localFallbackAllowed).toBe(false);
    expect(live.error).toContain("권위 원고 복구");
    expect(onCrdtDocumentChange).toHaveBeenLastCalledWith(null, null);

    live.retryServer();
    live.useLocalFallback();
    const afterBypassAttempts = await renderProvider(options);
    expect(rooms.instances).toHaveLength(1);
    expect(afterBypassAttempts.mode).toBe("server");
    expect(afterBypassAttempts.usingLocalFallback).toBe(false);
  });

  it("keeps an exported recovery boundary latched across transport factory rotation until full reload", async () => {
    lifecycle.roomStart = "resolve";
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange, outboxScope: "user-a" };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(expect.anything(), expect.anything());
    });
    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "거부된 변경을 내보낸 뒤 서버 원고를 다시 열어야 합니다.",
      code: "forbidden",
      updateId: "private-update-id",
      recoveryUpdateCount: 2,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryVaultId: "private-vault-id",
      recoveryExportAvailable: true,
    });

    const recoveryRequired = await renderProvider(options);
    recoveryVault.entries.push(recoveryVaultEntry({
      rejectedUpdateId: "private-update-id",
    }));
    await recoveryRequired.exportRecovery();
    const exported = await renderProvider(options);
    expect(exported.recovery?.exported).toBe(true);
    expect(recoveryDownloads.count).toBe(1);

    const rotatedTransportFactory: StudioLiveTransportFactory = () => {
      throw new Error("The latched recovery boundary must not open a replacement transport.");
    };
    const afterTokenRotation = await renderProvider({
      ...options,
      transportFactory: rotatedTransportFactory,
    });

    expect(rooms.instances).toHaveLength(1);
    expect(afterTokenRotation.sync).toMatchObject({
      phase: "recovery-required",
      editsDurablyProtected: false,
    });
    expect(afterTokenRotation.recovery).toMatchObject({ exported: true, updateCount: 2 });
    expect(afterTokenRotation.localFallbackAllowed).toBe(false);
    expect(onCrdtDocumentChange).toHaveBeenLastCalledWith(null, null);
  });

  it("rehydrates a late preserved recovery frontier after transport generation rotation", async () => {
    lifecycle.roomStart = "resolve";
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange, outboxScope: "user-late" };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalledWith(expect.anything(), expect.anything());
    });
    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "복구 frontier를 영구 저장소에 보존하는 중입니다.",
      code: "forbidden",
      updateId: "late-preserved-update",
      recoveryUpdateCount: 1,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryExportAvailable: false,
    });

    const preserving = await renderProvider(options);
    expect(preserving.recovery).toMatchObject({
      vaultId: null,
      exportAvailable: false,
      exported: false,
    });

    recoveryVault.entries.push(
      recoveryVaultEntry({
        scope: "user-late",
        rejectedUpdateId: "older-unrelated-update",
        vaultId: "older-vault",
        status: "exported",
      }),
      recoveryVaultEntry({
        scope: "user-late",
        rejectedUpdateId: "late-preserved-update",
        vaultId: "late-vault",
      })
    );
    // The first read races the manifest commit and sees no entry; the cancellable retry must recover.
    recoveryVault.emptyReadsBeforeVisible = 1;
    const rotatedTransportFactory: StudioLiveTransportFactory = () => {
      throw new Error("A recovery boundary must not open a replacement transport.");
    };
    const rotatedOptions = {
      ...options,
      transportFactory: rotatedTransportFactory,
    };
    const immediatelyAfterRotation = await renderProvider(rotatedOptions);
    expect(immediatelyAfterRotation.recovery?.exportAvailable).toBe(false);

    await vi.waitFor(async () => {
      expect((await renderProvider(rotatedOptions)).recovery).toMatchObject({
        vaultId: "late-vault",
        exportAvailable: true,
        exported: false,
      });
    });
    const hydrated = await renderProvider(rotatedOptions);
    await hydrated.exportRecovery();
    const exported = await renderProvider(rotatedOptions);

    expect(rooms.instances).toHaveLength(1);
    expect(recoveryVault.listCount).toBeGreaterThanOrEqual(3);
    expect(recoveryDownloads.count).toBe(1);
    expect(exported.recovery).toMatchObject({
      vaultId: "late-vault",
      exportAvailable: true,
      exported: true,
    });
  });

  it("keeps checking a terminal recovery boundary after the former retry window", async () => {
    lifecycle.roomStart = "resolve";
    const options = {
      onCrdtDocumentChange: vi.fn(),
      outboxScope: "user-slow-vault",
    };
    await renderProvider(options);
    await vi.waitFor(() => expect(lifecycle.bindings).toHaveLength(1));
    lifecycle.bindings[0]?.onStatus?.({
      state: "recovery-required",
      message: "대형 복구 frontier를 저장하는 중입니다.",
      code: "forbidden",
      updateId: "slow-preserved-update",
      recoveryUpdateCount: 4_097,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryExportAvailable: false,
    });
    await renderProvider(options);

    recoveryVault.entries.push(recoveryVaultEntry({
      scope: "user-slow-vault",
      rejectedUpdateId: "slow-preserved-update",
      vaultId: "slow-vault",
    }));
    // The old implementation stopped permanently after ten reads. Keep the manifest hidden for
    // longer than that boundary and advance the low-frequency polling without a real-time wait.
    recoveryVault.emptyReadsBeforeVisible = 12;
    const rotatedOptions = {
      ...options,
      transportFactory: (() => {
        throw new Error("A terminal recovery boundary must remain closed.");
      }) as StudioLiveTransportFactory,
    };

    vi.useFakeTimers();
    try {
      await renderProvider(rotatedOptions);
      for (let attempt = 0; attempt < 13; attempt += 1) {
        await vi.advanceTimersByTimeAsync(5_000);
        await renderProvider(rotatedOptions);
      }
      expect((await renderProvider(rotatedOptions)).recovery).toMatchObject({
        vaultId: "slow-vault",
        updateCount: 4_097,
        exportAvailable: true,
        exported: false,
      });
      expect(recoveryVault.listCount).toBeGreaterThan(10);
      expect(rooms.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never exposes a divergent document rejected during the initial outbox drain", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStatusOnStart = {
      state: "recovery-required",
      message: "보관된 변경이 영구 거부되어 권위 원고를 다시 불러와야 합니다.",
      code: "invalid_payload",
      updateId: "private-restored-update",
      recoveryUpdateCount: 2,
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryVaultId: "restored-vault-id",
      recoveryExportAvailable: true,
    };
    const onCrdtDocumentChange = vi.fn();
    const options = { onCrdtDocumentChange };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(onCrdtDocumentChange).toHaveBeenCalled();
    });
    const live = await renderProvider(options);

    expect(
      onCrdtDocumentChange.mock.calls.filter(([document]) => document !== null)
    ).toHaveLength(0);
    expect(live.sync.phase).toBe("recovery-required");
    expect(live.sync.operationSyncReady).toBe(false);
  });

  it("fails closed and releases every resource when initial CRDT sync rejects", async () => {
    lifecycle.roomStart = "resolve";
    lifecycle.bindingStart = "reject";
    const onRoomChange = vi.fn();
    const onCrdtDocumentChange = vi.fn();
    const options = { onRoomChange, onCrdtDocumentChange };
    await renderProvider(options);

    await vi.waitFor(async () => {
      expect(lifecycle.bindings).toHaveLength(1);
      expect(lifecycle.bindings[0]?.closeCount).toBe(1);
      expect(lifecycle.documents[0]?.destroyCount).toBe(1);
      expect(rooms.instances[0]?.closeCount).toBe(1);
    });
    const failed = await renderProvider(options);

    expect(failed.availability).toBe("error");
    expect(failed.error).toContain("binding start failed");
    expect(onCrdtDocumentChange).toHaveBeenLastCalledWith(null, null);
    expect(onRoomChange).toHaveBeenLastCalledWith(null);

    hooks.unmount();
    expect(rooms.instances[0]?.closeCount).toBe(1);
    expect(lifecycle.documents[0]?.destroyCount).toBe(1);
  });
});
