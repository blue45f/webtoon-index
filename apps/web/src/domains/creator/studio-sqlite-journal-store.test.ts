import {
  CommandBus,
  FaultInjectingJournalStore,
  createEmptyScene,
  entryCrc,
  polylineToPath,
  recoverProject,
  sceneDigest,
  solidPaint,
} from "@toonspectrum/studio-project-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import { SqliteJournalStore, createSqliteJournalStore } from "./studio-sqlite-journal-store";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";
import type { SceneNodeIR } from "@toonspectrum/studio-project-model";

/**
 * 이 스위트는 node 에서 실 sqlite-wasm(:memory: DB)로 실제 SQL 을 실행하며,
 * CommandBus·recovery·fault-injection 하네스를 스텁 없이 그대로 돌린다 —
 * SQLite 저널 스토어가 기존 저장소들과 같은 계약(부패 CRC 감지, torn append
 * 절단, two-slot 스냅샷 폴백)을 지키는지 실동작으로 고정한다.
 */

let sqlite3: StudioSqliteApiHandle;

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

const opened: StudioLocalDatabase[] = [];

async function openTracked(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  opened.push(database);
  return database;
}

afterAll(async () => {
  for (const database of opened) await database.close();
});

function strokeNode(id: string): SceneNodeIR {
  return {
    id,
    kind: "stroke-path",
    path: polylineToPath([
      [0, 0],
      [10, 10],
      [20, 5],
    ]),
    paint: solidPaint(0, 0, 0),
    strokeWidth: 4,
    cap: "round",
    join: "round",
    miterLimit: 4,
    opacity: 1,
    blend: "src-over",
  };
}

describe("SqliteJournalStore + CommandBus (real SQL round trip)", () => {
  it("dispatches, reopens through crash recovery, and matches the live digest", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const { bus } = await CommandBus.open(store, { snapshotEvery: 3 });
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(128, 128) });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("s1") });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("s2") });
    await bus.dispatch({
      type: "scene/update-node",
      id: "s1",
      patch: { strokeWidth: 9 },
    });
    await bus.dispatch({ type: "scene/remove-node", id: "s2" });
    const liveDigest = sceneDigest(bus.getScene());

    // 재개방 = 같은 DB 위의 새 스토어 인스턴스(크래시 후 새 세션 모델).
    const { bus: reopened, recovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-a"),
    );
    expect(recovery.issues).toEqual([]);
    expect(sceneDigest(reopened.getScene())).toBe(liveDigest);
    expect(reopened.getSeq()).toBe(bus.getSeq());
    // two-slot 스냅샷도 실제로 앉았다(snapshotEvery=3, seq 3 에서 slot A).
    expect((await store.readSnapshots()).map((snapshot) => snapshot.slot)).toEqual(["A"]);
  });

  it("keeps projects isolated on one shared database", async () => {
    const database = await openTracked();
    const storeA = createSqliteJournalStore(database, "project-a");
    const storeB = createSqliteJournalStore(database, "project-b");
    const { bus: busA } = await CommandBus.open(storeA);
    const { bus: busB } = await CommandBus.open(storeB);
    await busA.dispatch({ type: "scene/init", scene: createEmptyScene(8, 8) });
    await busA.dispatch({ type: "scene/add-node", node: strokeNode("only-a") });
    await busB.dispatch({ type: "scene/init", scene: createEmptyScene(16, 16) });

    expect((await storeA.readEntries()).map((entry) => entry.seq)).toEqual([1, 2]);
    expect((await storeB.readEntries()).map((entry) => entry.seq)).toEqual([1]);
    expect(sceneDigest(busA.getScene())).not.toBe(sceneDigest(busB.getScene()));
  });

  it("compactBefore drops only entries below the snapshot seq", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const { bus } = await CommandBus.open(store);
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(8, 8) });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("s1") });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("s2") });
    await bus.writeSnapshot();
    await store.compactBefore(3);
    expect((await store.readEntries()).map((entry) => entry.seq)).toEqual([3]);
    // 스냅샷 앵커 + 남은 suffix 로 여전히 완전 복구된다.
    const { bus: reopened, recovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-a"),
    );
    expect(recovery.snapshotSlotUsed).toBe("A");
    expect(sceneDigest(reopened.getScene())).toBe(sceneDigest(bus.getScene()));
  });

  it("rejects an empty projectId", async () => {
    const database = await openTracked();
    expect(() => createSqliteJournalStore(database, "")).toThrow(/projectId/);
  });
});

describe("SqliteJournalStore fault injection (storage-agnostic scenarios)", () => {
  it("detects a corrupt-CRC entry on recovery and truncates the tail", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const faulty = new FaultInjectingJournalStore(store, { tearAppendAtSeq: 3 });
    const { bus } = await CommandBus.open(faulty);
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(64, 64) });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("keep") });
    const digestBeforeFault = sceneDigest(bus.getScene());
    await expect(
      bus.dispatch({ type: "scene/add-node", node: strokeNode("lost") }),
    ).rejects.toThrow(/torn append/);

    // 부패 CRC 사본은 실제로 기록됐다 — 스토어는 검증하지 않고 돌려준다.
    expect((await store.readEntries()).map((entry) => entry.seq)).toEqual([1, 2, 3]);

    const recovered = await recoverProject(new SqliteJournalStore(database, "project-a"));
    expect(recovered.seq).toBe(2);
    expect(recovered.report.truncatedFromSeq).toBe(3);
    expect(recovered.report.droppedEntries).toBe(1);
    expect(sceneDigest(recovered.scene)).toBe(digestBeforeFault);
  });

  it("continues past a truncated torn tail: the next append replaces it physically", async () => {
    const database = await openTracked();
    const faulty = new FaultInjectingJournalStore(
      createSqliteJournalStore(database, "project-a"),
      { tearAppendAtSeq: 2 },
    );
    const { bus } = await CommandBus.open(faulty);
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(32, 32) });
    await expect(
      bus.dispatch({ type: "scene/add-node", node: strokeNode("torn") }),
    ).rejects.toThrow(/torn append/);

    const { bus: reopened, recovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-a"),
    );
    expect(recovery.truncatedFromSeq).toBe(2);
    expect(reopened.getSeq()).toBe(1);
    await reopened.dispatch({ type: "scene/add-node", node: strokeNode("healthy") });

    const { bus: final, recovery: finalRecovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-a"),
    );
    expect(finalRecovery.issues).toEqual([]);
    expect(final.getSeq()).toBe(2);
    expect(sceneDigest(final.getScene())).toBe(sceneDigest(reopened.getScene()));
  });

  it("falls back to the sibling snapshot slot when one slot is corrupted", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const faulty = new FaultInjectingJournalStore(store, { corruptSnapshotSlot: "B" });
    const { bus } = await CommandBus.open(faulty, { snapshotEvery: 2 });
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(64, 64) });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("n1") }); // snapshot A @2
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("n2") });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("n3") }); // snapshot B @4 (corrupt)

    const recovered = await recoverProject(new SqliteJournalStore(database, "project-a"));
    expect(recovered.report.snapshotSlotUsed).toBe("A");
    expect(recovered.report.snapshotSeq).toBe(2);
    expect(recovered.seq).toBe(4);
    expect(sceneDigest(recovered.scene)).toBe(sceneDigest(bus.getScene()));
    expect(
      recovered.report.issues.some((issue) => issue.includes("slot B")),
    ).toBe(true);
  });

  it("treats an unparsable payload row as a torn tail (absent on read)", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const { bus } = await CommandBus.open(store);
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(8, 8) });
    await bus.dispatch({ type: "scene/add-node", node: strokeNode("safe") });
    // 크래시 mid-append 가 남긴 반쪽 JSON 을 저장 계층에 직접 심는다.
    await database.appendJournalEntry("project-a", {
      seq: 3,
      payload: '{"seq":3,"tMs":123,"comman',
      crc32: 0,
    });

    const { bus: reopened, recovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-a"),
    );
    expect(recovery.issues).toEqual([]);
    expect(reopened.getSeq()).toBe(2);
    expect(sceneDigest(reopened.getScene())).toBe(sceneDigest(bus.getScene()));
  });

  it("stores the entry's own crc verbatim in the crc32 column (no recomputation)", async () => {
    const database = await openTracked();
    const store = createSqliteJournalStore(database, "project-a");
    const { bus } = await CommandBus.open(store);
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(8, 8) });
    const [entry] = await store.readEntries();
    if (!entry) throw new Error("expected one journal entry");
    const rows = await database.listJournalEntries("project-a");
    expect(rows[0]?.crc32).toBe(entry.crc);
    const { crc, ...body } = entry;
    expect(crc).toBe(entryCrc(body));
  });
});
