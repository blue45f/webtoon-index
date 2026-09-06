/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioProDrawPreferencesRepository,
  type StudioProDrawBroadcastChannelLike,
} from "./studio-pro-draw-preferences-sqlite";
import { useStudioProDrawPrefs } from "./useStudioProDrawPrefs";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

class FakeChannel implements StudioProDrawBroadcastChannelLike {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly postMessage = vi.fn();
  readonly close = vi.fn();

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.delete(listener);
  }
}

function fixture() {
  const values = new Map<string, string>();
  const store: StudioAsyncKeyValueStore = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => { values.set(key, value); }),
    delete: vi.fn(async (key) => { values.delete(key); }),
  };
  return {
    repository: createStudioProDrawPreferencesRepository(store),
    store,
    values,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useStudioProDrawPrefs", () => {
  it("uses SQLite without touching ambient localStorage and closes its channel", async () => {
    const sqlite = fixture();
    const channel = new FakeChannel();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    window.localStorage.setItem(
      "toonspectrum-studio-pro-draw-prefs:v1",
      JSON.stringify({ favoriteBrushIds: ["watercolor"] }),
    );
    getItem.mockClear();
    setItem.mockClear();

    const hook = renderHook(() => useStudioProDrawPrefs({
      acquireRepository: async () => sqlite.repository,
      createChannel: () => channel,
      writerId: "hook-tab",
    }));
    await vi.waitFor(() => {
      expect(hook.result.current.proDrawPrefsPersistenceState).toBe("durable");
    });
    expect(hook.result.current.proDrawPrefs.favoriteBrushIds).toEqual([]);

    let persistence!: Promise<boolean>;
    act(() => {
      persistence = hook.result.current.commitProDrawPrefsMutation((prefs) => ({
        ...prefs,
        sizeLocked: true,
      })).persistence;
    });
    await act(async () => {
      await expect(persistence).resolves.toBe(true);
    });
    expect(hook.result.current).toMatchObject({
      proDrawPrefs: { sizeLocked: true },
      proDrawPrefsPersistenceState: "durable",
      proDrawPrefsDurable: true,
      proDrawPrefsPersistenceMessage: null,
    });
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    hook.unmount();
    expect(channel.listeners).toHaveLength(0);
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("exposes memory-only state and retry instead of pretending a failed write persisted", async () => {
    const sqlite = fixture();
    let failWrites = true;
    sqlite.store.set = vi.fn(async (key, value) => {
      if (failWrites) throw new Error("disk full");
      sqlite.values.set(key, value);
    });
    const repository = createStudioProDrawPreferencesRepository(sqlite.store);
    const hook = renderHook(() => useStudioProDrawPrefs({
      acquireRepository: async () => repository,
      createChannel: () => null,
      writerId: "hook-retry-tab",
    }));
    await vi.waitFor(() => {
      expect(hook.result.current.proDrawPrefsPersistenceState).toBe("durable");
    });

    let persistence!: Promise<boolean>;
    act(() => {
      const result = hook.result.current.commitProDrawPrefsMutation((prefs) => ({
        ...prefs,
        opacityLocked: true,
      }));
      expect(result.persisted).toBe(false);
      persistence = result.persistence;
    });
    await act(async () => {
      await expect(persistence).resolves.toBe(false);
    });
    expect(hook.result.current).toMatchObject({
      proDrawPrefs: { opacityLocked: true },
      proDrawPrefsPersistenceState: "memory-only",
      proDrawPrefsDurable: false,
    });
    expect(hook.result.current.proDrawPrefsPersistenceMessage).toContain("disk full");

    failWrites = false;
    await act(async () => {
      await expect(hook.result.current.retryProDrawPrefsPersistence()).resolves.toBe(true);
    });
    expect(hook.result.current).toMatchObject({
      proDrawPrefs: { opacityLocked: true },
      proDrawPrefsPersistenceState: "durable",
      proDrawPrefsDurable: true,
    });
  });
});
