import { describe, expect, it, vi } from "vitest";

import { captureStudioCompanionWindowLayout } from "./studio-companion-window-layout";
import {
  STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL,
  createStudioCompanionWindowPreferenceSnapshot,
  createStudioCompanionWindowPreferencesRepository,
  createStudioCompanionWindowPreferencesRuntime,
  type StudioCompanionWindowPreferencesChannel,
  type StudioCompanionWindowPreferencesRepository,
} from "./studio-companion-window-preferences-sqlite";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

const WRITER_A = "companion-writer-a-0001";
const WRITER_B = "companion-writer-b-0001";

function mutationFactory(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${String(++sequence).padStart(4, "0")}`;
}

function layout(savedAt = Date.now()) {
  const captured = captureStudioCompanionWindowLayout({
    surface: "navigator",
    now: savedAt,
    screens: [{
      availLeft: 0,
      availTop: 24,
      availWidth: 1_920,
      availHeight: 1_056,
      devicePixelRatio: 1,
      isPrimary: true,
      isInternal: true,
    }],
    currentScreen: {
      availLeft: 0,
      availTop: 24,
      availWidth: 1_920,
      availHeight: 1_056,
      devicePixelRatio: 1,
      isPrimary: true,
      isInternal: true,
    },
    windowMetrics: {
      screenX: 120,
      screenY: 80,
      outerWidth: 420,
      outerHeight: 760,
    },
  });
  if (!captured) throw new Error("layout fixture failed");
  return captured;
}

function memoryStore(): StudioAsyncKeyValueStore & { records: Map<string, string> } {
  const records = new Map<string, string>();
  return {
    records,
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      records.delete(key);
    }),
  };
}

class SharedChannel implements StudioCompanionWindowPreferencesChannel {
  static readonly peers = new Map<string, Set<SharedChannel>>();
  static readonly transcript: unknown[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly close = vi.fn(() => {
    const peers = SharedChannel.peers.get(this.name);
    peers?.delete(this);
    if (peers?.size === 0) SharedChannel.peers.delete(this.name);
    this.onmessage = null;
  });

  constructor(readonly name: string) {
    const peers = SharedChannel.peers.get(name) ?? new Set<SharedChannel>();
    peers.add(this);
    SharedChannel.peers.set(name, peers);
  }

  postMessage(message: unknown): void {
    SharedChannel.transcript.push(message);
    for (const peer of SharedChannel.peers.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data: message } as MessageEvent);
    }
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  static reset(): void {
    SharedChannel.peers.clear();
    SharedChannel.transcript.length = 0;
  }
}

function runtime(input: {
  writer: string;
  repository: StudioCompanionWindowPreferencesRepository;
  initial?: boolean;
}) {
  const channel = new SharedChannel(STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL);
  const value = createStudioCompanionWindowPreferencesRuntime({
    surface: "navigator",
    initialRememberEnabled: input.initial ?? false,
    writerInstanceId: input.writer,
    createMutationId: mutationFactory(`mutation-${input.writer}`),
    repositoryFactory: async () => input.repository,
    channelFactory: () => channel,
  });
  return { channel, runtime: value };
}

describe("Studio companion window SQLite preferences", () => {
  it("round-trips a bounded snapshot and rejects a sequential stale revision", async () => {
    const store = memoryStore();
    const repository = createStudioCompanionWindowPreferencesRepository(store);
    const newer = createStudioCompanionWindowPreferenceSnapshot({
      surface: "navigator",
      revision: 8,
      writerInstanceId: WRITER_A,
      mutationId: "mutation-newer-0008",
      rememberEnabled: true,
      layout: layout(),
    });
    const stale = createStudioCompanionWindowPreferenceSnapshot({
      surface: "navigator",
      revision: 7,
      writerInstanceId: WRITER_B,
      mutationId: "mutation-stale-0007",
      rememberEnabled: false,
      layout: null,
    });

    expect(await repository.save(newer)).toEqual({ accepted: true, snapshot: newer });
    expect(await repository.save(stale)).toEqual({ accepted: false, snapshot: newer });
    expect(await repository.load("navigator")).toEqual(newer);
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it("propagates a mutation between two windows without browser KV", async () => {
    SharedChannel.reset();
    const repository = createStudioCompanionWindowPreferencesRepository(memoryStore());
    const first = runtime({ writer: WRITER_A, repository });
    const second = runtime({ writer: WRITER_B, repository });
    await Promise.all([first.runtime.hydrate(), second.runtime.hydrate()]);

    const written = first.runtime.setRememberEnabled(true);

    expect(second.runtime.current().snapshot).toEqual(written);
    expect(second.runtime.current().liveSync).toBe("broadcast");
    first.runtime.close();
    second.runtime.close();
  });

  it("rejects a replayed stale revision after both windows accepted a newer value", async () => {
    SharedChannel.reset();
    const repository = createStudioCompanionWindowPreferencesRepository(memoryStore());
    const first = runtime({ writer: WRITER_A, repository });
    const second = runtime({ writer: WRITER_B, repository });
    await Promise.all([first.runtime.hydrate(), second.runtime.hydrate()]);
    first.runtime.setRememberEnabled(true);
    const staleMessage = SharedChannel.transcript.at(-1);
    const newest = first.runtime.setRememberEnabled(false);

    second.channel.emit(staleMessage);

    expect(second.runtime.current().snapshot).toEqual(newest);
    expect(second.runtime.current().snapshot.rememberEnabled).toBe(false);
    first.runtime.close();
    second.runtime.close();
  });

  it("rebases a user mutation above a late SQLite hydration snapshot", async () => {
    SharedChannel.reset();
    let resolveLoad!: (snapshot: ReturnType<typeof createStudioCompanionWindowPreferenceSnapshot>) => void;
    const load = new Promise<ReturnType<typeof createStudioCompanionWindowPreferenceSnapshot>>(
      (resolve) => { resolveLoad = resolve; },
    );
    const persisted = createStudioCompanionWindowPreferenceSnapshot({
      surface: "navigator",
      revision: 41,
      writerInstanceId: WRITER_B,
      mutationId: "mutation-persisted-0041",
      rememberEnabled: true,
      layout: layout(),
    });
    const save = vi.fn(async (snapshot) => ({ accepted: true as const, snapshot }));
    const repository: StudioCompanionWindowPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => load),
      save,
      flush: vi.fn(async () => undefined),
    };
    const target = runtime({ writer: WRITER_A, repository, initial: true });
    const hydration = target.runtime.hydrate();
    target.runtime.setRememberEnabled(false);

    resolveLoad(persisted);
    await hydration;

    expect(target.runtime.current()).toMatchObject({
      authority: "sqlite-opfs",
      snapshot: {
        revision: 42,
        writerInstanceId: WRITER_A,
        rememberEnabled: false,
        layout: null,
      },
    });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      revision: 42,
      rememberEnabled: false,
    }));
    target.runtime.close();
  });

  it("exposes memory-only authority when SQLite/OPFS is unavailable", async () => {
    SharedChannel.reset();
    const channel = new SharedChannel(STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL);
    const target = createStudioCompanionWindowPreferencesRuntime({
      surface: "navigator",
      initialRememberEnabled: true,
      writerInstanceId: WRITER_A,
      createMutationId: mutationFactory("memory-mutation"),
      repositoryFactory: async () => {
        throw new DOMException("OPFS blocked", "SecurityError");
      },
      channelFactory: () => channel,
    });

    await expect(target.hydrate()).resolves.toMatchObject({ authority: "memory-only" });
    expect(target.setLayout(layout()).layout).not.toBeNull();
    expect(target.current().authority).toBe("memory-only");
    target.close();
  });

  it("closes its channel and removes listeners on runtime cleanup", async () => {
    SharedChannel.reset();
    const repository = createStudioCompanionWindowPreferencesRepository(memoryStore());
    const first = runtime({ writer: WRITER_A, repository });
    const second = runtime({ writer: WRITER_B, repository });
    await Promise.all([first.runtime.hydrate(), second.runtime.hydrate()]);
    const listener = vi.fn();
    second.runtime.subscribe(listener);
    second.runtime.close();
    listener.mockClear();

    first.runtime.setRememberEnabled(true);

    expect(second.channel.close).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(SharedChannel.peers.get(STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL)?.size).toBe(1);
    first.runtime.close();
    expect(SharedChannel.peers.has(STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL)).toBe(false);
  });
});
