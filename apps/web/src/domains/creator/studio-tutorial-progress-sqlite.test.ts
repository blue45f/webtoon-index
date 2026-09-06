import { describe, expect, it, vi } from "vitest";

import {
  createStudioTutorialProgressRepository,
  STUDIO_TUTORIAL_PROGRESS_SQLITE_NAMESPACE,
} from "./studio-tutorial-progress-sqlite";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

function memoryStore(initial?: string): {
  readonly values: Map<string, string>;
  readonly store: StudioAsyncKeyValueStore;
} {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set("progress", initial);
  return {
    values,
    store: {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => { values.set(key, value); }),
      delete: vi.fn(async (key) => { values.delete(key); }),
    },
  };
}

describe("Studio tutorial progress SQLite repository", () => {
  it("round-trips normalized progress in its dedicated namespace", async () => {
    const fixture = memoryStore();
    const repository = createStudioTutorialProgressRepository(fixture.store);
    await repository.save({ completed: ["pen", "pen"], lastId: "pen" });
    const loaded = await repository.load();
    expect(loaded.completed).toEqual(["pen"]);
    expect(loaded.lastId).toBe("pen");
    expect(repository.authority).toBe("sqlite-opfs");
    expect(STUDIO_TUTORIAL_PROGRESS_SQLITE_NAMESPACE).toBe("studio-tutorial-progress-v1");
  });

  it("fails closed for malformed or unknown tutorial ids", async () => {
    const fixture = memoryStore(JSON.stringify({ completed: ["unknown"], lastId: "unknown" }));
    const repository = createStudioTutorialProgressRepository(fixture.store);
    await expect(repository.load()).resolves.toEqual({ completed: [] });
  });

  it("serializes writes and propagates SQLite failures", async () => {
    const fixture = memoryStore();
    fixture.store.set = vi.fn(async () => { throw new Error("SQLITE_FULL"); });
    const repository = createStudioTutorialProgressRepository(fixture.store);
    await expect(repository.save({ completed: [] })).rejects.toThrow("SQLITE_FULL");
  });
});
