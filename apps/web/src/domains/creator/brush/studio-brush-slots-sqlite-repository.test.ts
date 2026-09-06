import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";

import { normalizeStudioBrushDynamicsSettings } from "./studio-brush-dynamics";
import {
  assignStudioBrushSlot,
  emptyStudioBrushSlots,
  STUDIO_BRUSH_SLOTS_LEGACY_AUTO_MIGRATION,
} from "./studio-brush-slots";
import {
  createStudioBrushQuickSlotsSqliteRepository,
  getProductStudioBrushQuickSlotsSqliteRepository,
  parseStudioBrushQuickSlotsSnapshot,
  serializeStudioBrushQuickSlotsSnapshot,
  STUDIO_BRUSH_QUICK_SLOTS_LEGACY_MIGRATION,
  STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
  studioBrushQuickSlotsSqliteKey,
} from "./studio-brush-slots-sqlite-repository";

import type { StudioBrushSlotsState } from "./studio-brush-slots";
import type { StudioBrushQuickSlotsScope } from "./studio-brush-slots-sqlite-repository";
import type { StudioLocalDatabase } from "../studio-local-database";

const databases: StudioLocalDatabase[] = [];
const scope: StudioBrushQuickSlotsScope = {
  ownerScope: "owner-7",
  deviceProfile: "wacom-k80-pressure-v2",
};

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function authoredState(seed = 73): StudioBrushSlotsState {
  return assignStudioBrushSlot(emptyStudioBrushSlots(), 3, {
    brushId: "pencil",
    strokeWidth: 7,
    brushOpacity: 0.83,
    sourcePresetId: "artist:pencil-pressure",
    sourcePresetName: "필압 연필",
    brushDynamics: normalizeStudioBrushDynamicsSettings({
      seed,
      fallbackPressure: 0.37,
      minimumDiameterRatio: 0.08,
      width: {
        base: 7,
        mappings: [{ source: "pressure", from: 0.07, to: 1, curve: 1.4 }],
      },
      opacity: {
        base: 0.83,
        mappings: [{ source: "pressure", from: 0.11, to: 1, curve: 1.2 }],
      },
    }),
  });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("brush quick slots SQLite repository", () => {
  it("round-trips owner/device-scoped slots and the exact normalized dynamics snapshot", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 1_700_000_000_123,
    });
    const state = authoredState();

    const saved = await repository.save(scope, state, 0);

    expect(saved).toMatchObject({
      ...scope,
      revision: 1,
      updatedAt: 1_700_000_000_123,
    });
    expect(saved.slots[3]).toEqual(state.slots[3]);
    const raw = await database.kvGet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      studioBrushQuickSlotsSqliteKey(scope),
    );
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
      ownerScope: scope.ownerScope,
      deviceProfile: scope.deviceProfile,
      revision: 1,
      slots: [{ slotIndex: 3, brushId: "pencil" }],
    });
    expect(parseStudioBrushQuickSlotsSnapshot(raw!).slots[3]?.brushDynamics)
      .toEqual(state.slots[3]?.brushDynamics);

    const reopened = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopened.load(scope)).resolves.toEqual(saved);
  });

  it("keeps owner and device profiles isolated with collision-free keys", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 4,
    });
    const adjacent = { ownerScope: "owner-7:wacom", deviceProfile: "k80" };
    expect(studioBrushQuickSlotsSqliteKey(scope))
      .not.toBe(studioBrushQuickSlotsSqliteKey(adjacent));

    await repository.save(scope, authoredState(1), 0);
    await repository.save(adjacent, authoredState(2), 0);

    await expect(repository.load(scope)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ brushDynamics: expect.objectContaining({ seed: 1 }) }),
      ]),
    });
    await expect(repository.load(adjacent)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ brushDynamics: expect.objectContaining({ seed: 2 }) }),
      ]),
    });
  });

  it("starts empty at revision zero without writing a row", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
    });

    await expect(repository.load(scope)).resolves.toEqual({
      ...scope,
      ...emptyStudioBrushSlots(),
      revision: 0,
      updatedAt: 0,
    });
    await expect(database.kvGet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      studioBrushQuickSlotsSqliteKey(scope),
    )).resolves.toBeNull();
  });

  it("rejects stale revision writers instead of overwriting a newer slot snapshot", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 8,
    });
    const first = await repository.save(scope, authoredState(1), 0);

    await expect(repository.save(scope, authoredState(2), 0)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("expected 0, actual 1"),
    });
    await expect(repository.load(scope)).resolves.toEqual(first);
  });

  it("queues concurrent mutations in invocation order", async () => {
    const database = await memoryDatabase();
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const delayed = {
      kvGet: database.kvGet.bind(database),
      kvDelete: database.kvDelete.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (++writes === 1) await blocked;
        await database.kvSet(namespace, key, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => delayed,
      now: () => writes + 10,
    });

    const first = repository.save(scope, authoredState(1), 0);
    const second = repository.save(scope, authoredState(2), 1);
    await vi.waitFor(() => expect(delayed.kvSet).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    await expect(repository.load(scope)).resolves.toMatchObject({
      revision: 2,
      slots: expect.arrayContaining([
        expect.objectContaining({ brushDynamics: expect.objectContaining({ seed: 2 }) }),
      ]),
    });
  });

  it("clears slots by persisting a new revision so stale writers stay rejected", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 50,
    });
    await repository.save(scope, authoredState(), 0);

    const cleared = await repository.clear(scope, 1);

    expect(cleared).toEqual({
      ...scope,
      ...emptyStudioBrushSlots(),
      revision: 2,
      updatedAt: 50,
    });
    await expect(repository.save(scope, authoredState(9), 1)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("fails closed for malformed, future, duplicate, unsorted and noncanonical rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
    });
    const key = studioBrushQuickSlotsSqliteKey(scope);
    const saved = {
      ...scope,
      ...authoredState(),
      revision: 1,
      updatedAt: 5,
    };
    const canonical = JSON.parse(serializeStudioBrushQuickSlotsSnapshot(saved));
    const slot = canonical.slots[0];
    const cases = [
      "{broken",
      JSON.stringify({ ...canonical, version: 2 }),
      JSON.stringify({ ...canonical, future: true }),
      JSON.stringify({ ...canonical, slots: [slot, slot] }),
      JSON.stringify({ ...canonical, slots: [
        { ...slot, slotIndex: 4 },
        { ...slot, slotIndex: 2 },
      ] }),
      JSON.stringify(canonical, null, 2),
    ];

    for (const raw of cases) {
      await database.kvSet(STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE, key, raw);
      await expect(repository.load(scope)).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("fails closed when stored scope does not match its composite SQLite key", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
    });
    const wrongScopeSnapshot = {
      ownerScope: "other-owner",
      deviceProfile: scope.deviceProfile,
      ...authoredState(),
      revision: 1,
      updatedAt: 10,
    };
    await database.kvSet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      studioBrushQuickSlotsSqliteKey(scope),
      serializeStudioBrushQuickSlotsSnapshot(wrongScopeSnapshot),
    );

    await expect(repository.load(scope)).rejects.toMatchObject({ code: "invalid" });
  });

  it("restores the previous canonical value if post-write durability verification fails", async () => {
    const database = await memoryDatabase();
    const initialRepository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 1,
    });
    const initial = await initialRepository.save(scope, authoredState(1), 0);
    const key = studioBrushQuickSlotsSqliteKey(scope);
    const before = await database.kvGet(STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE, key);
    let corruptNextRead = false;
    const corrupting = {
      kvDelete: database.kvDelete.bind(database),
      kvSet: vi.fn(async (namespace: string, targetKey: string, value: string) => {
        await database.kvSet(namespace, targetKey, value);
        corruptNextRead = true;
      }),
      kvGet: vi.fn(async (namespace: string, targetKey: string) => {
        if (corruptNextRead) {
          corruptNextRead = false;
          return "corrupt-readback";
        }
        return await database.kvGet(namespace, targetKey);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => corrupting,
      now: () => 2,
    });

    await expect(repository.save(scope, authoredState(2), initial.revision))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(database.kvGet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      key,
    )).resolves.toBe(before);
  });

  it("never reads legacy localStorage v1/v2 or silently downgrades SQLite failure", async () => {
    expect(STUDIO_BRUSH_SLOTS_LEGACY_AUTO_MIGRATION).toBe(false);
    expect(STUDIO_BRUSH_QUICK_SLOTS_LEGACY_MIGRATION).toBe(false);
    const getItem = vi.fn(() => JSON.stringify(authoredState(99)));
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS SAH pool denied");
      },
    });

    await expect(repository.load(scope)).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS SAH pool denied"),
    });
    expect(getItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("notifies subscribers only after a verified durable commit", async () => {
    const database = await memoryDatabase();
    const listener = vi.fn();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 100,
    });
    const unsubscribe = repository.subscribe(listener);

    const saved = await repository.save(scope, authoredState(), 0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(saved);
    unsubscribe();
    await repository.clear(scope, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not report a verified durable commit as failed when a view listener throws", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrushQuickSlotsSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 101,
    });
    repository.subscribe(() => {
      throw new Error("detached view");
    });

    await expect(repository.save(scope, authoredState(), 0)).resolves.toMatchObject({
      revision: 1,
      updatedAt: 101,
    });
    await expect(repository.load(scope)).resolves.toMatchObject({ revision: 1 });
  });

  it("exports one app-lifetime product singleton with SQLite-only authority", () => {
    const first = getProductStudioBrushQuickSlotsSqliteRepository();
    const second = getProductStudioBrushQuickSlotsSqliteRepository();
    expect(first).toBe(second);
    expect(first).toMatchObject({
      authority: "sqlite",
      legacyMigration: "disabled",
    });
  });
});
