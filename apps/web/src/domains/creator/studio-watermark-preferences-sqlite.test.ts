import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { DEFAULT_WATERMARK, type WatermarkSettings } from "./studio-watermark";
import {
  createStudioWatermarkPreferenceRuntime,
  createStudioWatermarkPreferencesRepository,
  type StudioWatermarkPreferencesRepository,
} from "./studio-watermark-preferences-sqlite";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function memoryStore(initial: string | null = null): {
  readonly values: Map<string, string>;
  readonly store: StudioAsyncKeyValueStore;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set("settings", initial);
  return {
    values,
    store: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
}

function settings(text: string): WatermarkSettings {
  return {
    ...DEFAULT_WATERMARK,
    enabled: true,
    text,
    position: "tl",
    opacity: 0.42,
  };
}

function repository(overrides: Partial<StudioWatermarkPreferencesRepository> = {}) {
  return {
    authority: "sqlite-opfs" as const,
    load: vi.fn(async () => DEFAULT_WATERMARK),
    save: vi.fn(async () => undefined),
    ...overrides,
  } satisfies StudioWatermarkPreferencesRepository;
}

describe("Studio watermark SQLite/OPFS repository", () => {
  it("round-trips normalized settings without browser key/value storage", async () => {
    const fixture = memoryStore();
    const sqlite = createStudioWatermarkPreferencesRepository(fixture.store);

    await sqlite.save({
      ...settings("© ToonSpectrum"),
      opacity: 4,
      size: 1,
    });

    await expect(sqlite.load()).resolves.toEqual({
      ...settings("© ToonSpectrum"),
      opacity: 1,
      size: 0.08,
    });
    expect(sqlite.authority).toBe("sqlite-opfs");
  });

  it("uses defaults for missing or corrupt rows instead of inventing partial state", async () => {
    const missing = createStudioWatermarkPreferencesRepository(memoryStore().store);
    const corrupt = createStudioWatermarkPreferencesRepository(memoryStore("{broken").store);

    await expect(missing.load()).resolves.toEqual(DEFAULT_WATERMARK);
    await expect(corrupt.load()).resolves.toEqual(DEFAULT_WATERMARK);
  });

  it("serializes rapid writes so an older write cannot overtake the newest value", async () => {
    const firstGate = deferred<void>();
    const writes: string[] = [];
    const store: StudioAsyncKeyValueStore = {
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
      set: vi.fn(async (_key: string, value: string) => {
        writes.push(JSON.parse(value).text as string);
        if (writes.length === 1) await firstGate.promise;
      }),
    };
    const sqlite = createStudioWatermarkPreferencesRepository(store);

    const first = sqlite.save(settings("old"));
    const second = sqlite.save(settings("new"));
    await vi.waitFor(() => expect(writes).toEqual(["old"]));
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(writes).toEqual(["old", "new"]);
  });
});

describe("Studio watermark persistence runtime", () => {
  it("shares one readiness barrier and does not expose defaults before SQLite hydration settles", async () => {
    const loadGate = deferred<WatermarkSettings>();
    const sqlite = repository({ load: vi.fn(() => loadGate.promise) });
    const acquireRepository = vi.fn(async () => sqlite);
    const runtime = createStudioWatermarkPreferenceRuntime({ acquireRepository });

    const first = runtime.awaitReady();
    const second = runtime.awaitReady();
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(acquireRepository).toHaveBeenCalledOnce();
    expect(sqlite.load).toHaveBeenCalledOnce();

    loadGate.resolve(settings("durable export"));
    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(firstSnapshot).toMatchObject({
      state: "durable",
      durable: true,
      settings: settings("durable export"),
    });
    expect(acquireRepository).toHaveBeenCalledOnce();
    expect(sqlite.load).toHaveBeenCalledOnce();
  });

  it("hydrates asynchronously and publishes the durable SQLite value", async () => {
    const loadGate = deferred<WatermarkSettings>();
    const sqlite = repository({ load: vi.fn(() => loadGate.promise) });
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => sqlite,
    });
    const observed: string[] = [];
    runtime.subscribe(() => observed.push(runtime.getSnapshot().state));

    const hydration = runtime.hydrate();
    expect(runtime.getSnapshot()).toMatchObject({ state: "hydrating", durable: false });
    loadGate.resolve(settings("hydrated"));

    await expect(hydration).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      durable: true,
      settings: settings("hydrated"),
    });
    expect(observed).toContain("durable");
  });

  it("never lets a late hydration overwrite an edit made while SQLite opens", async () => {
    const acquireGate = deferred<StudioWatermarkPreferencesRepository>();
    const sqlite = repository({ load: vi.fn(async () => settings("stale disk")) });
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: () => acquireGate.promise,
    });

    const hydration = runtime.hydrate();
    runtime.update(settings("artist edit"));
    acquireGate.resolve(sqlite);

    await expect(hydration).resolves.toBe(true);
    expect(sqlite.load).not.toHaveBeenCalled();
    expect(sqlite.save).toHaveBeenLastCalledWith(settings("artist edit"));
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      settings: settings("artist edit"),
    });
  });

  it("returns the newest artist edit from readiness when the edit lands during disk load", async () => {
    const loadGate = deferred<WatermarkSettings>();
    const sqlite = repository({ load: vi.fn(() => loadGate.promise) });
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => sqlite,
    });

    const ready = runtime.awaitReady();
    await vi.waitFor(() => expect(sqlite.load).toHaveBeenCalledOnce());
    runtime.update(settings("edited before hydration"));
    loadGate.resolve(settings("stale durable value"));

    await expect(ready).resolves.toMatchObject({
      state: "durable",
      settings: settings("edited before hydration"),
    });
    expect(sqlite.save).toHaveBeenCalledWith(settings("edited before hydration"));
  });

  it("keeps the setting in memory and exposes the exact acquisition failure", async () => {
    const denied = new Error("OPFS denied");
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => { throw denied; },
    });
    runtime.update(settings("session only"));

    await expect(runtime.hydrate()).resolves.toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "memory-only",
      durable: false,
      cause: denied,
      settings: settings("session only"),
    });
    expect(runtime.getSnapshot().message).toMatch(/새로고침하면 사라집니다/u);
  });

  it("resolves readiness as memory-only after acquisition failure and retries only explicitly", async () => {
    const retryGate = deferred<StudioWatermarkPreferencesRepository>();
    const sqlite = repository({ load: vi.fn(async () => settings("retry durable")) });
    const denied = new Error("OPFS denied before export");
    let attempt = 0;
    const acquireRepository = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw denied;
      return retryGate.promise;
    });
    const runtime = createStudioWatermarkPreferenceRuntime({ acquireRepository });

    await expect(runtime.awaitReady()).resolves.toMatchObject({
      state: "memory-only",
      durable: false,
      cause: denied,
      settings: DEFAULT_WATERMARK,
    });
    await expect(runtime.awaitReady()).resolves.toMatchObject({ state: "memory-only" });
    expect(acquireRepository).toHaveBeenCalledOnce();

    const retry = runtime.retry();
    const waitingForRetry = runtime.awaitReady();
    retryGate.resolve(sqlite);

    await expect(retry).resolves.toBe(true);
    await expect(waitingForRetry).resolves.toMatchObject({
      state: "durable",
      settings: settings("retry durable"),
    });
    expect(acquireRepository).toHaveBeenCalledTimes(2);
  });

  it("retries after an unavailable database and persists the newest memory value", async () => {
    const sqlite = repository({ load: vi.fn(async () => settings("older disk")) });
    let attempt = 0;
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("temporarily unavailable");
        return sqlite;
      },
    });

    await expect(runtime.hydrate()).resolves.toBe(false);
    runtime.update(settings("newest memory"));
    await expect(runtime.retry()).resolves.toBe(true);

    expect(sqlite.load).not.toHaveBeenCalled();
    expect(sqlite.save).toHaveBeenCalledWith(settings("newest memory"));
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      settings: settings("newest memory"),
    });
  });

  it("surfaces a save failure without reverting the edited setting", async () => {
    const saveFailure = new Error("disk full");
    const sqlite = repository({
      load: vi.fn(async () => settings("loaded")),
      save: vi.fn(async () => { throw saveFailure; }),
    });
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => sqlite,
    });
    await runtime.hydrate();

    runtime.update(settings("not lost"));
    await vi.waitFor(() => expect(runtime.getSnapshot().state).toBe("memory-only"));

    expect(runtime.getSnapshot()).toMatchObject({
      durable: false,
      cause: saveFailure,
      settings: settings("not lost"),
    });
  });

  it("waits for an in-flight save decision while preserving the edited export settings", async () => {
    const saveGate = deferred<void>();
    const sqlite = repository({
      load: vi.fn(async () => settings("loaded")),
      save: vi.fn(() => saveGate.promise),
    });
    const runtime = createStudioWatermarkPreferenceRuntime({
      acquireRepository: async () => sqlite,
    });
    await runtime.awaitReady();

    runtime.update(settings("edited and saving"));
    const ready = runtime.awaitReady();
    let settled = false;
    void ready.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "saving",
      settings: settings("edited and saving"),
    });

    saveGate.resolve();
    await expect(ready).resolves.toMatchObject({
      state: "durable",
      settings: settings("edited and saving"),
    });
  });
});

describe("Studio watermark and OPFS product authority boundary", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const studioPageSource = readStudioCuttoonEditorSource();
  const menubarSource = readFileSync(resolve(here, "StudioMenubarContent.tsx"), "utf8");
  const rasterExportSource = readFileSync(
    resolve(here, "render/studio-raster-export-orchestration-runtime.ts"),
    "utf8",
  );
  const opfsSource = readFileSync(resolve(here, "studio-opfs-filesystem.ts"), "utf8");

  it("wires StudioPage to async SQLite hydration and a visible memory-only warning", () => {
    const start = studioPageSource.indexOf("const watermarkPreferenceRuntimeRef");
    const end = studioPageSource.indexOf("const exportMenuRef", start);
    const watermarkBoundary = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(studioPageSource).toContain('import("./studio-watermark-preferences-sqlite")');
    expect(watermarkBoundary).toContain("module.createStudioWatermarkPreferenceRuntime");
    expect(watermarkBoundary).toContain("runtime.hydrate()");
    expect(watermarkBoundary).toContain("await runtime.awaitReady()");
    expect(watermarkBoundary).toContain("runtime.update(next)");
    expect(watermarkBoundary).not.toContain("localStorage");
    expect(studioPageSource).not.toContain("toonspectrum-studio-watermark");
    expect(studioPageSource).toContain('data-studio-watermark-persistence-warning="memory-only"');
  });

  it("awaits the watermark readiness barrier at every current export capture boundary", () => {
    expect(rasterExportSource.match(/await ensureWatermarkLoaded\(\)/gu)).toHaveLength(4);
    expect(rasterExportSource).not.toMatch(
      /const watermarkForExport = ensureWatermarkLoaded\(\)/u,
    );
    expect(menubarSource).toContain("await ensureWatermarkLoaded();");
    expect(studioPageSource).toContain(
      "const watermarkForExport = await ensureWatermarkLoaded();",
    );
    expect(studioPageSource.match(/watermark: watermarkForExport/gu)).toHaveLength(2);
    expect(studioPageSource).not.toContain("watermark: ensureWatermarkLoaded()");
  });

  it("keeps localStorage out of automatic OPFS selection and names the manual adapter legacy", () => {
    const selectorStart = opfsSource.indexOf("export async function selectStudioOpfsFileSystem");
    const selectorEnd = opfsSource.indexOf("// ── 표시 유틸", selectorStart);
    const selector = opfsSource.slice(selectorStart, selectorEnd);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(selectorEnd).toBeGreaterThan(selectorStart);
    expect(selector).not.toContain("localStorage");
    expect(selector).not.toContain("createStudioOpfsLegacyLocalStorageFileSystem");
    expect(selector).toContain('durability: "memory-only"');
    expect(opfsSource).toContain("createStudioOpfsLegacyLocalStorageFileSystem");
    expect(opfsSource).not.toContain("createStudioOpfsLocalStorageFileSystem");
  });
});
