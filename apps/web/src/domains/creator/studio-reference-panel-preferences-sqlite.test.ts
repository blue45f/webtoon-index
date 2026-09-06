import { describe, expect, it, vi } from "vitest";

import { serializeReferencePanelSettings } from "./studio-reference-panel";
import {
  STUDIO_REFERENCE_PANEL_SETTINGS_KEY,
  createStudioReferencePanelPreferencesRepository,
} from "./studio-reference-panel-preferences-sqlite";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

function memoryStore(initial: string | null = null): {
  readonly values: Map<string, string>;
  readonly store: StudioAsyncKeyValueStore;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(STUDIO_REFERENCE_PANEL_SETTINGS_KEY, initial);
  return {
    values,
    store: {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => { values.set(key, value); }),
      delete: vi.fn(async (key) => { values.delete(key); }),
    },
  };
}

describe("Studio reference-panel SQLite preferences", () => {
  it("loads and round-trips the versioned panel settings in its bounded key", async () => {
    const fixture = memoryStore(serializeReferencePanelSettings({
      x: 140,
      y: 120,
      width: 420,
      height: 360,
      assetId: "asset-pinned",
      flipped: true,
    }));
    const repository = createStudioReferencePanelPreferencesRepository(fixture.store);

    await expect(repository.load(1_280, 800)).resolves.toEqual({
      settings: {
        x: 140,
        y: 120,
        width: 420,
        height: 360,
        assetId: "asset-pinned",
        flipped: true,
      },
      persisted: true,
    });

    await repository.save({
      x: 200,
      y: 100,
      width: 360,
      height: 300,
      assetId: null,
      flipped: false,
    });
    await repository.flush();
    expect(JSON.parse(fixture.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY) ?? "null")).toEqual({
      v: 1,
      x: 200,
      y: 100,
      width: 360,
      height: 300,
      assetId: null,
      flipped: false,
    });
    expect(repository.authority).toBe("sqlite-opfs");
  });

  it("distinguishes an absent SQLite row from a malformed row while normalizing both safely", async () => {
    const absent = createStudioReferencePanelPreferencesRepository(memoryStore().store);
    const malformed = createStudioReferencePanelPreferencesRepository(memoryStore("{bad").store);

    await expect(absent.load(1_024, 768)).resolves.toMatchObject({ persisted: false });
    await expect(malformed.load(1_024, 768)).resolves.toMatchObject({
      persisted: true,
      settings: { width: 300, height: 260, assetId: null, flipped: false },
    });
  });

  it("serializes rapid writes so the newest layout cannot be overtaken", async () => {
    const values = new Map<string, string>();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let writes = 0;
    const store: StudioAsyncKeyValueStore = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        writes += 1;
        if (writes === 1) {
          markFirstStarted();
          await firstGate;
        }
        values.set(key, value);
      },
      delete: async (key) => { values.delete(key); },
    };
    const repository = createStudioReferencePanelPreferencesRepository(store);
    const first = repository.save({
      x: 100, y: 100, width: 320, height: 260, assetId: null, flipped: false,
    });
    const second = repository.save({
      x: 180, y: 120, width: 480, height: 400, assetId: null, flipped: false,
    });

    await firstStarted;
    expect(writes).toBe(1);
    releaseFirst();
    await Promise.all([first, second, repository.flush()]);
    const persisted = JSON.parse(values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY) ?? "null") as {
      width: number;
    };
    expect(persisted.width).toBe(480);
    expect(writes).toBe(2);
  });

  it("propagates OPFS write failure and permits a later explicit retry", async () => {
    const fixture = memoryStore();
    let fail = true;
    fixture.store.set = vi.fn(async (key, value) => {
      if (fail) throw new Error("SQLITE_FULL");
      fixture.values.set(key, value);
    });
    const repository = createStudioReferencePanelPreferencesRepository(fixture.store);
    const settings = {
      x: 100, y: 100, width: 320, height: 260, assetId: null, flipped: false,
    };

    await expect(repository.save(settings)).rejects.toThrow("SQLITE_FULL");
    fail = false;
    await expect(repository.save({ ...settings, width: 400 })).resolves.toBeUndefined();
    await expect(repository.flush()).resolves.toBeUndefined();
    expect(fixture.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY)).toContain('"width":400');
  });
});
