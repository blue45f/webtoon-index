import {
  CommandBus,
  animationGraphIRSchema,
  comicPageIRSchema,
  createEmptyScene,
  polylineToPath,
  projectDigest,
  sceneDigest,
} from "@toonspectrum/studio-project-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import { SqliteJournalStore, createSqliteJournalStore } from "./studio-sqlite-journal-store";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";

/**
 * 프로젝트 그래프 명령(comic/animation/effects)이 SQLite 저널 스토어 위에서도
 * 저장·복구 계약을 지키는지 실 SQL 왕복으로 고정한다 — v2 스냅샷 payload 가
 * 구조화 테이블에 앉고, 재개방 시 projectDigest 가 라이브와 일치해야 한다.
 */

let sqlite3: StudioSqliteApiHandle;

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

const opened: StudioLocalDatabase[] = [];

afterAll(async () => {
  for (const database of opened) await database.close();
});

function rect(x: number, y: number, w: number, h: number) {
  return polylineToPath(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    true,
  );
}

describe("SqliteJournalStore + project graph commands", () => {
  it("round-trips graph commands and a v2 snapshot through real SQL", async () => {
    const database = await openStudioLocalDatabase({
      vfs: "memory",
      loadSqlite: () => Promise.resolve(sqlite3),
    });
    opened.push(database);
    const store = createSqliteJournalStore(database, "project-graphs");
    const { bus } = await CommandBus.open(store, { snapshotEvery: 2 });
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(96, 96) });
    await bus.dispatch({
      type: "comic/set-page",
      page: comicPageIRSchema.parse({
        id: "sql-page",
        widthPx: 1200,
        heightPx: 1800,
        panels: [
          { id: "cut-1", shape: rect(10, 10, 500, 700), folderId: "f1", readingOrder: 0 },
        ],
        balloons: [],
      }),
    }); // snapshot A @2 (v2 format)
    await bus.dispatch({
      type: "animation/set-graph",
      graph: animationGraphIRSchema.parse({
        version: 1,
        fps: 12,
        durationFrames: 24,
        levels: [{ id: "L", name: "A", cels: [{ id: "c", sceneNodeId: "n", label: "" }] }],
        exposures: [{ frame: 0, levelId: "L", celId: "c" }],
      }),
    });
    const live = bus.getProject();
    expect(live).not.toBeNull();
    if (live === null) throw new Error("expected live project");

    const { bus: reopened, recovery } = await CommandBus.open(
      new SqliteJournalStore(database, "project-graphs"),
    );
    expect(recovery.issues).toEqual([]);
    const project = reopened.getProject();
    expect(project).not.toBeNull();
    if (project === null) throw new Error("expected recovered project");
    expect(projectDigest(project)).toBe(projectDigest(live));
    expect(sceneDigest(reopened.getScene())).toBe(sceneDigest(bus.getScene()));
    expect(project.comic?.pages[0]?.id).toBe("sql-page");
    expect(project.animation?.fps).toBe(12);

    // The v2 snapshot payload actually reached the structured snapshot table.
    const snapshots = await store.readSnapshots();
    expect(snapshots.map((snapshot) => snapshot.slot)).toEqual(["A"]);
    expect(snapshots[0]?.version).toBe(2);
    expect(snapshots[0]?.comic?.pages[0]?.id).toBe("sql-page");
  });
});
