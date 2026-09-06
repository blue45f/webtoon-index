import { describe, expect, it } from "vitest";

import {
  createStudioFloatingSurfacePreferencesRepository,
  isValidStudioFloatingSurfaceId,
} from "./studio-floating-surface-preferences-sqlite";

const FALLBACK = Object.freeze({
  version: 2 as const,
  xRatio: 1,
  yRatio: 0,
  width: 336,
  height: 720,
  dock: "free" as const,
  positionLocked: false,
  sizeLocked: false,
});

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

describe("studio floating surface SQLite preferences", () => {
  it("validates bounded opaque panel IDs", () => {
    expect(isValidStudioFloatingSurfaceId("quick-access")).toBe(true);
    expect(isValidStudioFloatingSurfaceId("animatic:work-123")).toBe(true);
    expect(isValidStudioFloatingSurfaceId("../other-user")).toBe(false);
    expect(isValidStudioFloatingSurfaceId("")).toBe(false);
  });

  it("round-trips the exact docked layout and verifies the write", async () => {
    const store = memoryStore();
    const repository = createStudioFloatingSurfacePreferencesRepository(store);
    const layout = {
      ...FALLBACK,
      xRatio: 0.25,
      width: 420,
      dock: "left" as const,
    };

    await expect(repository.save("quick-access", layout)).resolves.toEqual({
      layout,
      status: "persisted",
      failure: null,
    });
    await expect(repository.load("quick-access", FALLBACK)).resolves.toEqual({
      layout,
      persisted: true,
      failure: null,
    });
    expect(Object.keys(JSON.parse(
      store.values.get("surface:quick-access")!,
    ))).toEqual([
      "version",
      "xRatio",
      "yRatio",
      "width",
      "height",
      "dock",
      "positionLocked",
      "sizeLocked",
    ]);
  });

  it("serializes accepted writes so an older layout cannot overtake a newer one", async () => {
    const store = memoryStore();
    const writes: string[] = [];
    const repository = createStudioFloatingSurfacePreferencesRepository({
      ...store,
      async set(key, value) {
        await Promise.resolve();
        writes.push(value);
        store.values.set(key, value);
      },
    });

    const first = repository.save("page-review", {
      ...FALLBACK,
      xRatio: 0.2,
    });
    const second = repository.save("page-review", {
      ...FALLBACK,
      xRatio: 0.8,
    });
    await Promise.all([first, second]);

    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes.at(-1)!).xRatio).toBe(0.8);
    await expect(repository.load("page-review", FALLBACK)).resolves.toMatchObject({
      layout: { xRatio: 0.8 },
      persisted: true,
    });
  });

  it("waits for an accepted write before a remount-style load", async () => {
    const store = memoryStore();
    const repository = createStudioFloatingSurfacePreferencesRepository({
      ...store,
      async set(key, value) {
        await Promise.resolve();
        store.values.set(key, value);
      },
    });
    const layout = { ...FALLBACK, xRatio: 0.63, dock: "right" as const };

    const pendingSave = repository.save("quick-access", layout);
    const pendingLoad = repository.load("quick-access", FALLBACK);

    await expect(pendingLoad).resolves.toMatchObject({
      layout,
      persisted: true,
      failure: null,
    });
    await expect(pendingSave).resolves.toMatchObject({
      status: "persisted",
      failure: null,
    });
  });

  it("fails closed for invalid IDs, malformed reads, and ignored writes", async () => {
    const malformed = memoryStore({
      "surface:quick-access": "{bad-json",
    });
    const malformedRepository =
      createStudioFloatingSurfacePreferencesRepository(malformed);
    await expect(
      malformedRepository.load("quick-access", FALLBACK),
    ).resolves.toEqual({
      layout: FALLBACK,
      persisted: false,
      failure: "read-failed",
    });

    await expect(
      malformedRepository.save("../escape", FALLBACK),
    ).resolves.toMatchObject({
      status: "memory-only",
      failure: "invalid-surface-id",
    });

    const ignored = createStudioFloatingSurfacePreferencesRepository({
      async get() {
        return null;
      },
      async set() {
        // Simulates an interrupted or ignored OPFS write.
      },
      async delete() {
        // no-op
      },
    });
    await expect(ignored.save("quick-access", FALLBACK)).resolves.toMatchObject({
      status: "memory-only",
      failure: "verification-failed",
    });
  });
});
