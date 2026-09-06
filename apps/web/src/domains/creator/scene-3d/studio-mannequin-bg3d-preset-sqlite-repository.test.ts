import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
  createStudioBg3dLtUserPreset,
} from "../bg3d/studio-bg3d-lt-preset-library";
import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  type StudioBg3dLtPresetPayload,
} from "../bg3d/studio-bg3d-lt-presets";
import { openStudioLocalDatabase } from "../studio-local-database";

import {
  STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
  STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
  STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
  STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
  createStudioBg3dLtPresetSqliteRepository,
  createStudioMannequinStateSqliteRepository,
  parseCanonicalStudioBg3dLtPresetSqlitePayload,
  parseCanonicalStudioMannequinSqliteState,
} from "./studio-mannequin-bg3d-preset-sqlite-repository";
import {
  STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
} from "./studio-mannequin-model";
import {
  STUDIO_MANNEQUIN_STATE_DOC_KIND,
  STUDIO_MANNEQUIN_STATE_DOC_MAX_BYTES,
  STUDIO_MANNEQUIN_STATE_DOC_VERSION,
  STUDIO_MANNEQUIN_POSE_PRESETS,
  parseStudioMannequinState,
  serializeStudioMannequinState,
  type StudioMannequinPersistentState,
} from "./studio-mannequin-poses";

import type { StudioLocalDatabase } from "../studio-local-database";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function mannequinState(heightCm = 168): StudioMannequinPersistentState {
  return {
    params: { ...STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS, heightCm },
    pose: STUDIO_MANNEQUIN_POSE_PRESETS.find((preset) => preset.id === "run")!.pose,
  };
}

function ltPayload(name = "웹툰 LT"): StudioBg3dLtPresetPayload {
  const source = STUDIO_BG3D_LT_BUILT_IN_PRESETS[0];
  const created = createStudioBg3dLtUserPreset(
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
    {
      id: "user.sqlite-lt",
      name,
      description: "SQLite 라운드트립 검증용 사용자 프리셋입니다.",
      line: source.line,
      tone: source.tone,
    },
  );
  if (!created.ok) throw new Error(created.reason);
  return created.payload;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("mannequin and BG3D LT shared SQLite repositories", () => {
  it("round-trips both authorities through real sqlite-wasm without namespace overlap", async () => {
    const database = await memoryDatabase();
    const mannequin = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => database,
    });
    const bg3d = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: async () => database,
    });
    const authoredMannequin = mannequinState();
    const authoredLt = ltPayload();

    await expect(mannequin.load()).resolves.toBeNull();
    await expect(bg3d.load()).resolves.toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
    const savedMannequin = await mannequin.save(authoredMannequin);
    await bg3d.save(authoredLt);

    const reopenedMannequin = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => database,
    });
    const reopenedBg3d = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopenedMannequin.load()).resolves.toEqual(savedMannequin);
    await expect(reopenedBg3d.load()).resolves.toEqual(authoredLt);
    expect(STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE).not.toBe(
      STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
    );
    expect(STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE).toContain("v12");
    expect(STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE).toContain("v12");
  });

  it("stores only strict canonical bytes for each authority", async () => {
    const database = await memoryDatabase();
    const mannequin = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => database,
    });
    const bg3d = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: async () => database,
    });
    const savedMannequin = await mannequin.save(mannequinState());
    const savedLt = await bg3d.save(ltPayload());

    const mannequinRaw = await database.kvGet(
      STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
      STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
    );
    const ltRaw = await database.kvGet(
      STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
      STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
    );
    expect(parseCanonicalStudioMannequinSqliteState(mannequinRaw!)).toEqual(savedMannequin);
    expect(parseCanonicalStudioBg3dLtPresetSqlitePayload(ltRaw!)).toEqual(savedLt);
    expect(mannequinRaw).toBe(serializeStudioMannequinState(savedMannequin));
  });

  it("rejects corrupt, future, unknown-field, non-canonical, and oversized mannequin rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => database,
    });
    const canonical = serializeStudioMannequinState(mannequinState());
    const document = JSON.parse(canonical) as Record<string, unknown>;
    const invalidRows = [
      "{broken",
      JSON.stringify({ ...document, version: 99 }),
      JSON.stringify({ ...document, futureField: true }),
      JSON.stringify(document, null, 2),
      `{"kind":"${STUDIO_MANNEQUIN_STATE_DOC_KIND}","version":${STUDIO_MANNEQUIN_STATE_DOC_VERSION},"padding":"${"x".repeat(STUDIO_MANNEQUIN_STATE_DOC_MAX_BYTES)}"}`,
    ];

    for (const raw of invalidRows) {
      await database.kvSet(
        STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
        STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
        raw,
      );
      await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("rejects corrupt, future, unknown-field, non-canonical, and oversized LT rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: async () => database,
    });
    const payload = ltPayload();
    const canonical = JSON.stringify(payload);
    const invalidRows = [
      "{broken",
      JSON.stringify({ ...payload, version: 99 }),
      JSON.stringify({ ...payload, futureField: true }),
      JSON.stringify(payload, null, 2),
      `{"padding":"${"x".repeat(STUDIO_BG3D_LT_PRESET_MAX_BYTES)}"}`,
    ];

    expect(canonical.length).toBeLessThan(STUDIO_BG3D_LT_PRESET_MAX_BYTES);
    for (const raw of invalidRows) {
      await database.kvSet(
        STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
        STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
        raw,
      );
      await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("rejects typed mannequin values that would be silently clamped or stripped", async () => {
    const database = await memoryDatabase();
    const repository = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => database,
    });
    const outOfRange = {
      ...mannequinState(),
      params: { ...mannequinState().params, heightCm: 999 },
    };
    await expect(Promise.resolve().then(() => repository.save(outOfRange)))
      .rejects.toMatchObject({ code: "invalid" });

    const unknown = {
      ...mannequinState(),
      futureField: true,
    } as unknown as StudioMannequinPersistentState;
    await expect(Promise.resolve().then(() => repository.save(unknown)))
      .rejects.toMatchObject({ code: "invalid" });

    const malformed = { params: null, pose: null } as unknown as StudioMannequinPersistentState;
    await expect(Promise.resolve().then(() => repository.save(malformed)))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("queues overlapping complete snapshots in invocation order", async () => {
    let firstWriteRelease!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      firstWriteRelease = resolve;
    });
    let mannequinWrites = 0;
    let mannequinLatest = "";
    const mannequinDatabase = {
      kvSet: vi.fn(async (_namespace: string, _key: string, raw: string) => {
        if (++mannequinWrites === 1) await firstWriteGate;
        mannequinLatest = raw;
      }),
    } as unknown as StudioLocalDatabase;
    const mannequin = createStudioMannequinStateSqliteRepository({
      acquireDatabase: async () => mannequinDatabase,
    });

    const first = mannequin.save(mannequinState(170));
    const second = mannequin.save(mannequinState(190));
    await vi.waitFor(() => expect(mannequinWrites).toBe(1));
    firstWriteRelease();
    await Promise.all([first, second]);
    expect(parseStudioMannequinState(mannequinLatest)?.params.heightCm).toBe(190);

    let ltWrites = 0;
    const ltOrder: string[] = [];
    const bg3d = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: async () => ({
        kvSet: vi.fn(async (_namespace: string, _key: string, raw: string) => {
          ltWrites += 1;
          ltOrder.push(parseCanonicalStudioBg3dLtPresetSqlitePayload(raw).presets[0]!.name);
        }),
      } as unknown as StudioLocalDatabase),
    });
    await Promise.all([bg3d.save(ltPayload("첫 저장")), bg3d.save(ltPayload("마지막 저장"))]);
    expect(ltWrites).toBe(2);
    expect(ltOrder).toEqual(["첫 저장", "마지막 저장"]);
  });

  it("surfaces SQLite/OPFS failure without probing browser storage", async () => {
    const unavailable = async (): Promise<StudioLocalDatabase> => {
      throw new Error("SAH pool blocked");
    };
    const mannequin = createStudioMannequinStateSqliteRepository({
      acquireDatabase: unavailable,
    });
    const bg3d = createStudioBg3dLtPresetSqliteRepository({
      acquireDatabase: unavailable,
    });

    await expect(mannequin.load()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("SAH pool blocked"),
    });
    await expect(bg3d.save(ltPayload())).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("SAH pool blocked"),
    });
  });
});
