import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_POSER_PREFERENCES_SQLITE_NAMESPACE,
  createStudioVrmPoserPreferencesRepository,
  createStudioVrmPoserPreferencesRuntime,
  hasStudioVrmWebcamSessionConsent,
  rememberStudioVrmWebcamSessionConsent,
  type StudioVrmPoserPreferences,
  type StudioVrmPoserPreferencesRepository,
} from "./studio-vrm-poser-preferences-sqlite";

import type { StudioAsyncKeyValueStore } from "../studio-local-database";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memoryStore(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const store: StudioAsyncKeyValueStore = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { store, values };
}

function preferences(
  poses: readonly string[],
  characters: readonly string[],
): StudioVrmPoserPreferences {
  return {
    recentPoses: { version: 1, ids: [...poses] },
    recentCharacters: { version: 1, ids: [...characters] },
  };
}

describe("Studio VRM poser SQLite preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps webcam notice consent in sessionStorage without touching durable browser KV", () => {
    const values = new Map<string, string>();
    const sessionGet = vi.fn((key: string) => values.get(key) ?? null);
    const sessionSet = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });
    const durableGet = vi.fn(() => null);
    const durableSet = vi.fn();
    vi.stubGlobal("sessionStorage", {
      getItem: sessionGet,
      setItem: sessionSet,
    } as Pick<Storage, "getItem" | "setItem">);
    vi.stubGlobal("localStorage", {
      getItem: durableGet,
      setItem: durableSet,
    } as Pick<Storage, "getItem" | "setItem">);

    expect(hasStudioVrmWebcamSessionConsent()).toBe(false);
    rememberStudioVrmWebcamSessionConsent();
    expect(hasStudioVrmWebcamSessionConsent()).toBe(true);

    expect(sessionSet).toHaveBeenCalledWith("studio_webcam_consent", "true");
    expect(durableGet).not.toHaveBeenCalled();
    expect(durableSet).not.toHaveBeenCalled();
  });

  it("keeps webcam consent non-fatal when sessionStorage is denied", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
    } as Pick<Storage, "getItem" | "setItem">);

    expect(hasStudioVrmWebcamSessionConsent()).toBe(false);
    expect(() => rememberStudioVrmWebcamSessionConsent()).not.toThrow();
  });

  it("round-trips normalized recents in the dedicated V12 namespace contract", async () => {
    const fixture = memoryStore();
    const repository = createStudioVrmPoserPreferencesRepository(fixture.store);

    await repository.saveRecentPoses({ version: 1, ids: ["wave", "wave", "default"] });
    await repository.saveRecentCharacters({ version: 1, ids: ["hero", "hero", "guide"] });

    await expect(repository.load()).resolves.toEqual(preferences(
      ["wave", "default"],
      ["hero", "guide"],
    ));
    expect(repository.authority).toBe("sqlite-opfs");
    expect(STUDIO_VRM_POSER_PREFERENCES_SQLITE_NAMESPACE).toBe(
      "studio-vrm-poser-preferences-v12",
    );
  });

  it("fails closed to empty recents for malformed SQLite payloads", async () => {
    const fixture = memoryStore({
      "recent-poses": "{broken",
      "recent-characters": JSON.stringify({ version: 0, ids: ["legacy"] }),
    });
    const repository = createStudioVrmPoserPreferencesRepository(fixture.store);

    await expect(repository.load()).resolves.toEqual(preferences([], []));
  });

  it("serializes cross-key writes so a slower first write cannot be overtaken", async () => {
    const firstWrite = deferred<void>();
    const events: string[] = [];
    let calls = 0;
    const store: StudioAsyncKeyValueStore = {
      get: async () => null,
      set: async (key) => {
        calls += 1;
        events.push(`start:${key}`);
        if (calls === 1) await firstWrite.promise;
        events.push(`end:${key}`);
      },
      delete: async () => undefined,
    };
    const repository = createStudioVrmPoserPreferencesRepository(store);

    const poseSave = repository.saveRecentPoses({ version: 1, ids: ["wave"] });
    const characterSave = repository.saveRecentCharacters({ version: 1, ids: ["hero"] });
    await vi.waitFor(() => expect(events).toEqual(["start:recent-poses"]));
    firstWrite.resolve();
    await Promise.all([poseSave, characterSave]);

    expect(events).toEqual([
      "start:recent-poses",
      "end:recent-poses",
      "start:recent-characters",
      "end:recent-characters",
    ]);
  });

  it("hydrates untouched pose and character recents from SQLite", async () => {
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => preferences(["sit", "wave"], ["hero"])),
      saveRecentPoses: vi.fn(async () => undefined),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => repository,
    });

    await expect(runtime.hydrate()).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      durable: true,
      recentPoses: { ids: ["sit", "wave"] },
      recentCharacters: { ids: ["hero"] },
    });
  });

  it("does not let late hydration overwrite a pose selected before load resolves", async () => {
    const loading = deferred<StudioVrmPoserPreferences>();
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(() => loading.promise),
      saveRecentPoses: vi.fn(async () => undefined),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => repository,
    });

    const hydration = runtime.hydrate();
    await vi.waitFor(() => expect(repository.load).toHaveBeenCalledOnce());
    runtime.rememberPose("artist-pose");
    loading.resolve(preferences(["stale-pose"], ["stored-character"]));

    await expect(hydration).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      recentPoses: { ids: ["artist-pose"] },
      recentCharacters: { ids: ["stored-character"] },
    });
    expect(repository.saveRecentPoses).toHaveBeenCalledWith({
      version: 1,
      ids: ["artist-pose"],
    });
    expect(repository.saveRecentCharacters).not.toHaveBeenCalled();
  });

  it("does not let late hydration overwrite a character selected before load resolves", async () => {
    const loading = deferred<StudioVrmPoserPreferences>();
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(() => loading.promise),
      saveRecentPoses: vi.fn(async () => undefined),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => repository,
    });

    const hydration = runtime.hydrate();
    await vi.waitFor(() => expect(repository.load).toHaveBeenCalledOnce());
    runtime.rememberCharacter("artist-character");
    loading.resolve(preferences(["stored-pose"], ["stale-character"]));

    await expect(hydration).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      recentPoses: { ids: ["stored-pose"] },
      recentCharacters: { ids: ["artist-character"] },
    });
    expect(repository.saveRecentCharacters).toHaveBeenCalledWith({
      version: 1,
      ids: ["artist-character"],
    });
  });

  it("coalesces rapid selections while preserving the newest durable value", async () => {
    const firstSave = deferred<void>();
    const saved: string[][] = [];
    let saveCalls = 0;
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => preferences([], [])),
      saveRecentPoses: vi.fn(async (state) => {
        saveCalls += 1;
        saved.push([...state.ids]);
        if (saveCalls === 1) await firstSave.promise;
      }),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => repository,
    });
    await runtime.hydrate();

    runtime.rememberPose("first");
    await vi.waitFor(() => expect(repository.saveRecentPoses).toHaveBeenCalledTimes(1));
    runtime.rememberPose("second");
    runtime.rememberPose("third");
    firstSave.resolve();
    await runtime.awaitSettled();

    expect(saved).toEqual([
      ["first"],
      ["third", "second", "first"],
    ]);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      recentPoses: { ids: ["third", "second", "first"] },
    });
  });

  it("keeps current-tab state usable and visibly memory-only after database failure", async () => {
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => {
        throw new Error("OPFS permission denied");
      },
    });

    await expect(runtime.hydrate()).resolves.toBe(false);
    runtime.rememberPose("memory-pose");
    runtime.rememberCharacter("memory-character");

    expect(runtime.getSnapshot()).toMatchObject({
      state: "memory-only",
      durable: false,
      recentPoses: { ids: ["memory-pose"] },
      recentCharacters: { ids: ["memory-character"] },
    });
    expect(runtime.getSnapshot().message).toContain("현재 탭 메모리");
    expect(runtime.getSnapshot().message).toContain("OPFS permission denied");
  });

  it("retries after failure and flushes memory-only edits without accepting stale rows", async () => {
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => preferences(["stale-pose"], ["stale-character"])),
      saveRecentPoses: vi.fn(async () => undefined),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    let acquisitions = 0;
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => {
        acquisitions += 1;
        if (acquisitions === 1) throw new Error("SQLITE_BUSY");
        return repository;
      },
    });

    await runtime.hydrate();
    runtime.rememberPose("memory-pose");
    runtime.rememberCharacter("memory-character");
    await expect(runtime.retry()).resolves.toBe(true);

    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      recentPoses: { ids: ["memory-pose"] },
      recentCharacters: { ids: ["memory-character"] },
    });
    expect(repository.saveRecentPoses).toHaveBeenCalledWith({
      version: 1,
      ids: ["memory-pose"],
    });
    expect(repository.saveRecentCharacters).toHaveBeenCalledWith({
      version: 1,
      ids: ["memory-character"],
    });
  });

  it("propagates repository write rejection into retryable memory-only state", async () => {
    const repository: StudioVrmPoserPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => preferences([], [])),
      saveRecentPoses: vi.fn(async () => {
        throw new Error("SQLITE_FULL");
      }),
      saveRecentCharacters: vi.fn(async () => undefined),
    };
    const runtime = createStudioVrmPoserPreferencesRuntime({
      acquireRepository: async () => repository,
    });
    await runtime.hydrate();

    runtime.rememberPose("unsaved-pose");
    await runtime.awaitSettled();

    expect(runtime.getSnapshot()).toMatchObject({
      state: "memory-only",
      recentPoses: { ids: ["unsaved-pose"] },
    });
    expect(runtime.getSnapshot().message).toContain("SQLITE_FULL");
  });
});
