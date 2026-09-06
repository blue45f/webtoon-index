import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_QUICK_ACCESS_STATE,
  addStudioQuickAccessCommand,
} from "./studio-quick-access";
import {
  STUDIO_QUICK_ACCESS_COMMAND_IDS,
  buildStudioQuickAccessCommandCatalog,
  createStudioQuickAccessRepository,
  loadStudioQuickAccessState,
  resolveStudioQuickAccessExecutionIntent,
  saveStudioQuickAccessState,
  type StudioQuickAccessRepository,
} from "./studio-quick-access-integration";

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

function repositoryFactory(
  store: ReturnType<typeof memoryStore>,
): () => Promise<StudioQuickAccessRepository> {
  const repository = createStudioQuickAccessRepository(store);
  return async () => repository;
}

describe("studio quick access live command registry", () => {
  it("publishes only registered editor commands and fails omitted availability closed", () => {
    const catalog = buildStudioQuickAccessCommandCatalog({
      undo: true,
      pen: true,
    });

    expect(catalog.map(({ id }) => id)).toEqual([
      ...STUDIO_QUICK_ACCESS_COMMAND_IDS,
    ]);
    expect(catalog.find(({ id }) => id === "undo")?.available).toBe(true);
    expect(catalog.find(({ id }) => id === "pen")?.available).toBe(true);
    expect(catalog.find(({ id }) => id === "save")?.available).toBe(false);
    expect(catalog.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it("maps every registered command to a trusted intent and rejects unknown IDs", () => {
    for (const commandId of STUDIO_QUICK_ACCESS_COMMAND_IDS) {
      expect(resolveStudioQuickAccessExecutionIntent(commandId)).not.toBeNull();
    }
    expect(resolveStudioQuickAccessExecutionIntent("future-command")).toBeNull();
    expect(resolveStudioQuickAccessExecutionIntent("__proto__")).toBeNull();
    expect(resolveStudioQuickAccessExecutionIntent("")).toBeNull();
  });
});

describe("studio quick access owner-scoped SQLite persistence", () => {
  it("round-trips the exact local model without crossing owner scopes", async () => {
    const store = memoryStore();
    const acquireRepository = repositoryFactory(store);
    const customized = addStudioQuickAccessCommand(
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      DEFAULT_STUDIO_QUICK_ACCESS_STATE.activeSetId,
      "add-bubble",
    );

    await expect(saveStudioQuickAccessState(
      "owner-0123456789abcdef",
      customized,
      acquireRepository,
    )).resolves.toBe("persisted");
    await expect(loadStudioQuickAccessState(
      "owner-0123456789abcdef",
      acquireRepository,
    )).resolves.toMatchObject({
      state: customized,
      authority: "sqlite-opfs",
      failure: null,
    });
    await expect(loadStudioQuickAccessState(
      "owner-fedcba9876543210",
      acquireRepository,
    )).resolves.toMatchObject({
      state: DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      authority: "sqlite-opfs",
      failure: null,
    });
  });

  it("fails closed for invalid owners, malformed payloads, and unavailable SQLite", async () => {
    const store = memoryStore({ guest: "{bad json" });
    const acquireRepository = repositoryFactory(store);

    await expect(loadStudioQuickAccessState("guest", acquireRepository)).resolves.toMatchObject({
      state: DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      authority: "memory-only",
      failure: "read-failed",
    });
    await expect(saveStudioQuickAccessState(
      "../../other-user",
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      acquireRepository,
    )).resolves.toBe("invalid-owner");
    await expect(saveStudioQuickAccessState(
      "guest",
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      async () => {
        throw new Error("OPFS blocked");
      },
    )).resolves.toBe("storage-unavailable");
  });

  it("reports verified SQLite write failures without throwing", async () => {
    const values = new Map<string, string>();
    const repository = createStudioQuickAccessRepository({
      async get(key) {
        return values.get(key) ?? null;
      },
      async set() {
        // Simulates an interrupted or silently ignored OPFS write.
      },
      async delete(key) {
        values.delete(key);
      },
    });

    await expect(saveStudioQuickAccessState(
      "guest",
      DEFAULT_STUDIO_QUICK_ACCESS_STATE,
      async () => repository,
    )).resolves.toBe("verification-failed");
  });
});
