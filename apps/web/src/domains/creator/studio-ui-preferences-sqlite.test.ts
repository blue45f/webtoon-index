import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS } from "./studio-advanced-fill-settings";
import { defaultStudioAppSettings } from "./studio-app-settings";
import {
  createStudioAssetFavoriteId,
  normalizeStudioAssetFavoriteState,
} from "./studio-asset-favorites";
import { createStudioEffectId } from "./studio-effect-favorites";
import {
  STUDIO_PAGE_PREVIEW_SIZE_VALUES,
  createStudioUiPreferencesRepository,
  normalizeStudioPagePreviewSize,
} from "./studio-ui-preferences-sqlite";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

function memoryStore(initial: Readonly<Record<string, string>> = {}): {
  readonly values: Map<string, string>;
  readonly store: StudioAsyncKeyValueStore;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    store: {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      delete: vi.fn(async (key) => {
        values.delete(key);
      }),
    },
  };
}

describe("Studio SQLite UI preferences", () => {
  it("round-trips normalized application settings without a browser-storage authority", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    const settings = defaultStudioAppSettings();
    settings.general.densityMode = "simple";
    settings.other.pressureCurve = 1.75;
    settings.toolbar.visibleIds = ["pen", "eraser"];

    await repository.saveAppSettings(settings);
    await expect(repository.loadAppSettings()).resolves.toMatchObject({
      general: { densityMode: "simple" },
      other: { pressureCurve: 1.75 },
      toolbar: { visibleIds: ["pen", "eraser"] },
    });
    expect(fixture.values.has("app-settings")).toBe(true);
  });

  it("normalizes malformed application settings to safe defaults", async () => {
    const fixture = memoryStore({
      "app-settings": JSON.stringify({
        general: { densityMode: "unknown" },
        other: { pressureCurve: Number.POSITIVE_INFINITY },
        toolbar: { visibleIds: ["not-a-tool"] },
      }),
    });
    const repository = createStudioUiPreferencesRepository(fixture.store);

    await expect(repository.loadAppSettings()).resolves.toEqual(defaultStudioAppSettings());
  });

  it("round-trips advanced fill settings and normalizes unsafe values", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await repository.saveAdvancedFillSettings({
      ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
      tolerance: 77,
      closeGapPx: 4,
    });
    await expect(repository.loadAdvancedFillSettings()).resolves.toMatchObject({
      tolerance: 77,
      closeGapPx: 4,
    });

    fixture.values.set("advanced-fill-settings", JSON.stringify({ tolerance: 9999 }));
    await expect(repository.loadAdvancedFillSettings()).resolves.toEqual(
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
    );
  });

  it("scopes asset favorites by owner and keeps only canonical ids", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    const local = createStudioAssetFavoriteId("local", "asset-1");
    const raster = createStudioAssetFavoriteId("raster", "pack-2");
    await repository.saveAssetFavorites("user-a", normalizeStudioAssetFavoriteState({
      version: 1,
      ids: [local, raster],
    }));

    await expect(repository.loadAssetFavorites("user-a")).resolves.toEqual({
      version: 1,
      ids: [local, raster],
    });
    await expect(repository.loadAssetFavorites("user-b")).resolves.toEqual({
      version: 1,
      ids: [],
    });
  });

  it("persists bounded UI booleans, recent colors and server provider selection", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await repository.saveBooleanPreference("ai-notice-acknowledged", true);
    await repository.saveBooleanPreference("comment-pins-hidden", false);
    await repository.saveRecentColors(["#ABC", "bad", "#aabbcc", "#112233"]);
    await repository.saveServerAiProvider("deepseek");

    await expect(
      repository.loadBooleanPreference("ai-notice-acknowledged"),
    ).resolves.toBe(true);
    await expect(
      repository.loadBooleanPreference("comment-pins-hidden"),
    ).resolves.toBe(false);
    await expect(repository.loadRecentColors()).resolves.toEqual(["#aabbcc", "#112233"]);
    await expect(repository.loadServerAiProvider()).resolves.toBe("deepseek");

    fixture.values.set("server-ai-provider", "unknown");
    await expect(repository.loadServerAiProvider()).resolves.toBe("auto");
  });

  it("round-trips background recents with normalization and no localStorage dependency", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await repository.saveBackgroundRecent({
      version: 1,
      ids: ["g-sunset", "g-sunset", "s-paper"],
    });
    await expect(repository.loadBackgroundRecent()).resolves.toEqual({
      version: 1,
      ids: ["g-sunset", "s-paper"],
    });
    expect(repository.authority).toBe("sqlite-opfs");
  });

  it("round-trips effect favorites and recent order", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    const blur = createStudioEffectId("filter", "blur");
    const levels = createStudioEffectId("adjustment", "levels");
    await repository.saveEffectFavorites({ version: 1, favorites: [blur], recent: [levels] });
    await expect(repository.loadEffectFavorites()).resolves.toEqual({
      version: 1,
      favorites: [blur],
      recent: [levels],
    });
  });

  it("round-trips element recents without probing the retired browser-storage envelope", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await repository.saveElementsRecent({
      version: 1,
      ids: ["shape-star", "shape-star", "frame-film"],
    });
    await expect(repository.loadElementsRecent()).resolves.toEqual({
      version: 1,
      ids: ["shape-star", "frame-film"],
    });
    expect(fixture.values.has("elements-recent")).toBe(true);
  });

  it.each(STUDIO_PAGE_PREVIEW_SIZE_VALUES)("round-trips page preview size %s", async (value) => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await repository.savePagePreviewSize(value);
    await expect(repository.loadPagePreviewSize()).resolves.toBe(value);
  });

  it("round-trips the remembered primary tool and reports no memory before a first pick", async () => {
    const fixture = memoryStore();
    const repository = createStudioUiPreferencesRepository(fixture.store);

    await expect(repository.loadPrimaryTool()).resolves.toBeNull();
    await repository.savePrimaryTool("draw");
    await expect(repository.loadPrimaryTool()).resolves.toBe("draw");
    expect(fixture.values.get("primary-tool")).toBe("draw");
    await repository.savePrimaryTool("select");
    await expect(repository.loadPrimaryTool()).resolves.toBe("select");
  });

  it("treats an unknown persisted primary tool as no memory at all", async () => {
    const fixture = memoryStore({ "primary-tool": "hand" });
    const repository = createStudioUiPreferencesRepository(fixture.store);

    // `hand` 는 잠깐 쓰는 보조 동작이라 다음 세션의 시작 도구가 되면 안 된다.
    await expect(repository.loadPrimaryTool()).resolves.toBeNull();
  });

  it("fails closed to defaults for malformed persisted values", async () => {
    const fixture = memoryStore({
      "background-recent": "{bad",
      "effect-favorites": JSON.stringify({ favorites: ["bad:id:shape"] }),
      "elements-recent": JSON.stringify({ version: 1, ids: [null, "", "shape-star"] }),
      "page-preview-size": "giant",
    });
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await expect(repository.loadBackgroundRecent()).resolves.toEqual({ version: 1, ids: [] });
    await expect(repository.loadEffectFavorites()).resolves.toEqual({
      version: 1,
      favorites: [],
      recent: [],
    });
    await expect(repository.loadElementsRecent()).resolves.toEqual({
      version: 1,
      ids: ["shape-star"],
    });
    await expect(repository.loadPagePreviewSize()).resolves.toBe("comfortable");
    expect(normalizeStudioPagePreviewSize(null)).toBe("comfortable");
  });

  it("serializes rapid writes so an older operation cannot overtake the latest", async () => {
    const values = new Map<string, string>();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const store: StudioAsyncKeyValueStore = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        calls += 1;
        if (calls === 1) {
          markFirstStarted();
          await firstGate;
        }
        values.set(key, value);
      },
      delete: async (key) => { values.delete(key); },
    };
    const repository = createStudioUiPreferencesRepository(store);
    const first = repository.savePagePreviewSize("compact");
    const second = repository.savePagePreviewSize("large");
    await firstStarted;
    releaseFirst();
    await Promise.all([first, second]);
    await expect(repository.loadPagePreviewSize()).resolves.toBe("large");
  });

  it("propagates SQLite write failures instead of pretending a preference was saved", async () => {
    const fixture = memoryStore();
    fixture.store.set = vi.fn(async () => {
      throw new Error("SQLITE_FULL");
    });
    const repository = createStudioUiPreferencesRepository(fixture.store);
    await expect(repository.savePagePreviewSize("large")).rejects.toThrow("SQLITE_FULL");
  });
});
