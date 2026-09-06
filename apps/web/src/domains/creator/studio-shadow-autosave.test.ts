import {
  canonicalJson,
  fnv1a64Hex,
  sceneDigest,
} from "@toonspectrum/studio-project-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import {
  createShadowAutosaveMirror,
  normalizeShadowDocument,
  readShadowAutosave,
  shadowDocumentDigest,
  shadowStateDigest,
} from "./studio-shadow-autosave";
import { createSqliteJournalStore } from "./studio-sqlite-journal-store";

import type {
  StudioAsyncKeyValueStore,
  StudioCostSampleKind,
  StudioCostSampleRecord,
  StudioJournalEntryRecord,
  StudioJournalSnapshotRecord,
  StudioLocalDatabase,
  StudioSqliteApiHandle,
  StudioTournamentWinnerCandidate,
  StudioTournamentWinnerRecord,
} from "./studio-local-database";
import type { ShadowMirrorScheduler } from "./studio-shadow-autosave";

/**
 * 섀도 미러 레인을 실 sqlite-wasm(:memory: DB) 위에서 스텁 없이 고정한다:
 * 미러 왕복 digest 일치, 디바운스·백프레셔, 실패 격리(레거시 무전파),
 * 재개방 복구, 결정성, close 정합, 레거시 테이블 무접촉, 1k 노드 스모크.
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

/**
 * 실 DB 를 감싸 저널 메서드에 실패를 주입하고 모든 호출명을 기록하는
 * 위임 래퍼 — sqlite 는 비주입 경로에서 그대로 실행된다.
 */
class InterceptingDatabase implements StudioLocalDatabase {
  readonly calls: string[] = [];
  failAppend: Error | null = null;
  failListSnapshots: Error | null = null;

  constructor(private readonly inner: StudioLocalDatabase) {}

  kvGet(namespace: string, key: string): Promise<string | null> {
    this.calls.push("kvGet");
    return this.inner.kvGet(namespace, key);
  }

  kvSet(namespace: string, key: string, value: string): Promise<void> {
    this.calls.push("kvSet");
    return this.inner.kvSet(namespace, key, value);
  }

  kvDelete(namespace: string, key: string): Promise<void> {
    this.calls.push("kvDelete");
    return this.inner.kvDelete(namespace, key);
  }

  putTournamentWinner(
    winner: Omit<StudioTournamentWinnerRecord, "updatedAt">,
  ): Promise<void> {
    this.calls.push("putTournamentWinner");
    return this.inner.putTournamentWinner(winner);
  }

  getTournamentWinner(
    bucket: string,
    deviceHash: string,
  ): Promise<StudioTournamentWinnerRecord | null> {
    this.calls.push("getTournamentWinner");
    return this.inner.getTournamentWinner(bucket, deviceHash);
  }

  listTournamentWinners(): Promise<StudioTournamentWinnerRecord[]> {
    this.calls.push("listTournamentWinners");
    return this.inner.listTournamentWinners();
  }

  listTournamentWinnerCandidates(): Promise<StudioTournamentWinnerCandidate[]> {
    this.calls.push("listTournamentWinnerCandidates");
    return this.inner.listTournamentWinnerCandidates();
  }

  replaceTournamentWinners(
    winners: readonly Omit<StudioTournamentWinnerRecord, "updatedAt">[],
  ): Promise<void> {
    this.calls.push("replaceTournamentWinners");
    return this.inner.replaceTournamentWinners(winners);
  }

  evictTournamentProvider(providerId: string): Promise<number> {
    this.calls.push("evictTournamentProvider");
    return this.inner.evictTournamentProvider(providerId);
  }

  recordCostSample(
    providerId: string,
    bucket: string,
    kind: StudioCostSampleKind,
    ms: number,
  ): Promise<void> {
    this.calls.push("recordCostSample");
    return this.inner.recordCostSample(providerId, bucket, kind, ms);
  }

  listCostSamples(
    providerId: string,
    bucket: string,
    limit?: number,
  ): Promise<StudioCostSampleRecord[]> {
    this.calls.push("listCostSamples");
    return this.inner.listCostSamples(providerId, bucket, limit);
  }

  appendJournalEntry(
    projectId: string,
    entry: StudioJournalEntryRecord,
  ): Promise<void> {
    this.calls.push("appendJournalEntry");
    if (this.failAppend !== null) return Promise.reject(this.failAppend);
    return this.inner.appendJournalEntry(projectId, entry);
  }

  listJournalEntries(projectId: string): Promise<StudioJournalEntryRecord[]> {
    this.calls.push("listJournalEntries");
    return this.inner.listJournalEntries(projectId);
  }

  deleteJournalEntriesBefore(projectId: string, seq: number): Promise<number> {
    this.calls.push("deleteJournalEntriesBefore");
    return this.inner.deleteJournalEntriesBefore(projectId, seq);
  }

  putJournalSnapshot(
    projectId: string,
    snapshot: Omit<StudioJournalSnapshotRecord, "updatedAt">,
  ): Promise<void> {
    this.calls.push("putJournalSnapshot");
    return this.inner.putJournalSnapshot(projectId, snapshot);
  }

  listJournalSnapshots(projectId: string): Promise<StudioJournalSnapshotRecord[]> {
    this.calls.push("listJournalSnapshots");
    if (this.failListSnapshots !== null) return Promise.reject(this.failListSnapshots);
    return this.inner.listJournalSnapshots(projectId);
  }

  asAsyncKeyValueStore(namespace: string): StudioAsyncKeyValueStore {
    this.calls.push("asAsyncKeyValueStore");
    return this.inner.asAsyncKeyValueStore(namespace);
  }

  close(): Promise<void> {
    this.calls.push("close");
    return this.inner.close();
  }
}

class ManualScheduler implements ShadowMirrorScheduler {
  readonly scheduledDelays: number[] = [];
  private readonly tasks = new Map<number, () => void>();
  private nextHandle = 1;

  schedule(callback: () => void, delayMs: number): unknown {
    this.scheduledDelays.push(delayMs);
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.tasks.set(handle, callback);
    return handle;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pendingCount(): number {
    return this.tasks.size;
  }

  fire(): void {
    const callbacks = [...this.tasks.values()];
    this.tasks.clear();
    for (const callback of callbacks) callback();
  }
}

function makeStepClock(start = 1_000): () => number {
  let t = start;
  return () => {
    t += 1;
    return t;
  };
}

function legacyDoc(marker: string, elements = 2): Record<string, unknown> {
  return {
    version: 2,
    savedAt: marker,
    title: `title-${marker}`,
    pagesList: [
      {
        id: `page-${marker}`,
        canvasH: 1_200,
        elements: Array.from({ length: elements }, (_, i) => ({
          id: `el-${marker}-${i}`,
          type: "text",
          x: 10 + i,
          y: 20 + i,
          text: `content-${marker}-${i}`,
        })),
      },
    ],
  };
}

interface MirrorHarness {
  database: InterceptingDatabase;
  scheduler: ManualScheduler;
  mirror: ReturnType<typeof createShadowAutosaveMirror>;
}

async function openHarness(
  overrides: {
    projectId?: string;
    debounceMs?: number;
    snapshotEvery?: number;
    compactAfterMirror?: boolean;
  } = {},
): Promise<MirrorHarness> {
  const database = new InterceptingDatabase(await openTracked());
  const scheduler = new ManualScheduler();
  const mirror = createShadowAutosaveMirror({
    database,
    projectId: overrides.projectId ?? "shadow-project",
    debounceMs: overrides.debounceMs ?? 250,
    scheduler,
    now: makeStepClock(),
    ...(overrides.snapshotEvery === undefined
      ? {}
      : { snapshotEvery: overrides.snapshotEvery }),
    ...(overrides.compactAfterMirror === undefined
      ? {}
      : { compactAfterMirror: overrides.compactAfterMirror }),
  });
  return { database, scheduler, mirror };
}

// ---------------------------------------------------------------------------
// 정규화 (순수 함수)
// ---------------------------------------------------------------------------

describe("normalizeShadowDocument — SceneIR 축약 정규화", () => {
  it("pagesList 를 group 노드로, 요소를 digest 텍스트 노드로 축약한다", () => {
    const element = { id: "el-a-0", type: "text", x: 10, y: 20, text: "content" };
    const doc = {
      version: 2,
      pagesList: [{ id: "page-a", canvasH: 1_200, elements: [element] }],
    };
    const scene = normalizeShadowDocument(doc);
    expect(scene.version).toBe(11);
    expect(scene.nodes[0]).toMatchObject({ id: "doc:digest", kind: "text" });
    const page = scene.nodes[1];
    if (page?.kind !== "group") throw new Error("expected page group node");
    expect(page.id).toBe("page:0:page-a");
    expect(page.children).toHaveLength(1);
    const first = page.children[0];
    if (first?.kind !== "text") throw new Error("expected text node");
    // 위치는 보존되고, 내용은 원문 대신 안정 digest 로 축약된다.
    expect(first).toMatchObject({ id: "el:0:el-a-0", x: 10, y: 20 });
    expect(first.text).toBe(shadowStateDigest(element));
  });

  it("pagesList 가 없으면 elements 배열을 최상위 노드로 축약한다", () => {
    const scene = normalizeShadowDocument({
      elements: [{ id: "solo", x: 3, y: 4 }],
    });
    expect(scene.nodes).toHaveLength(2);
    expect(scene.nodes[1]).toMatchObject({ id: "el:0:solo", x: 3, y: 4 });
  });

  it("digest 는 키 순서에 불변이고 깊은 변경에는 민감하다", () => {
    // 키 순서만 다른 같은 문서(중첩 포함)는 같은 digest.
    const orderedOne = {
      title: "t",
      pagesList: [{ id: "p", elements: [{ id: "e", x: 1, text: "hello" }] }],
    };
    const orderedTwo = {
      pagesList: [{ elements: [{ text: "hello", x: 1, id: "e" }], id: "p" }],
      title: "t",
    };
    expect(shadowDocumentDigest(orderedOne)).toBe(shadowDocumentDigest(orderedTwo));
    // 요소 깊숙한 곳의 한 글자 변경이 scene digest 를 바꾼다.
    const mutated = {
      title: "t",
      pagesList: [{ id: "p", elements: [{ id: "e", x: 1, text: "hellp" }] }],
    };
    expect(shadowDocumentDigest(mutated)).not.toBe(shadowDocumentDigest(orderedOne));
  });

  it("적대적 입력(원시값·순환·비유한 수)에도 던지지 않고 결정적이다", () => {
    expect(() => normalizeShadowDocument(null)).not.toThrow();
    expect(() => normalizeShadowDocument("just a string")).not.toThrow();
    expect(shadowDocumentDigest(42)).not.toBe(shadowDocumentDigest("42"));

    const cyclic: Record<string, unknown> = { id: "c" };
    cyclic.self = cyclic;
    const cyclicDigest = shadowDocumentDigest(cyclic);
    expect(cyclicDigest).toHaveLength(16);
    expect(cyclicDigest).toBe(shadowDocumentDigest(cyclic));

    const weird = normalizeShadowDocument({
      elements: [{ id: "w", x: Number.NaN, y: Number.POSITIVE_INFINITY }],
    });
    // 비유한 좌표는 0 으로 강하되 digest 에는 센티널로 남는다.
    expect(weird.nodes[1]).toMatchObject({ x: 0, y: 0 });
    expect(shadowDocumentDigest({ elements: [{ id: "w", x: Number.NaN }] })).not.toBe(
      shadowDocumentDigest({ elements: [{ id: "w", x: "#nan" }] }),
    );
  });

  it("문서의 양의 정수 width/height 만 채택하고 아니면 기본 치수를 쓴다", () => {
    expect(normalizeShadowDocument({ width: 640, height: 480 })).toMatchObject({
      width: 640,
      height: 480,
    });
    expect(normalizeShadowDocument({ width: -3, height: 1.5 })).toMatchObject({
      width: 1_080,
      height: 1_920,
    });
  });
});

// ---------------------------------------------------------------------------
// 미러 왕복 · 디바운스 · 백프레셔
// ---------------------------------------------------------------------------

describe("ShadowAutosaveMirror — 미러링", () => {
  it("디바운스가 발화하기 전에는 아무것도 쓰지 않는다(빈 레인 판독 포함)", async () => {
    const { database, scheduler, mirror } = await openHarness();
    expect(mirror.enqueueSnapshot(legacyDoc("idle"))).toBe(true);
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.scheduledDelays).toEqual([250]);
    const status = mirror.getStatus();
    expect(status.mirroring).toBe(false);
    expect(status.pendingSnapshot).toBe(true);
    expect(status.mirroredSnapshots).toBe(0);
    const empty = await readShadowAutosave(database, "shadow-project");
    expect(empty.digest).toBeNull();
    expect(empty.scene).toBeNull();
    expect(empty.seq).toBe(0);
  });

  it("미러 왕복: 저장된 digest 가 문서 계약 digest 와 일치한다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    const doc = legacyDoc("round-trip", 3);
    mirror.enqueueSnapshot(doc);
    scheduler.fire();
    await mirror.flush();

    const status = mirror.getStatus();
    expect(status.mirroredSnapshots).toBe(1);
    expect(status.failedMirrors).toBe(0);
    expect(status.lastError).toBeNull();
    // scene/init(1) + doc:digest(1) + page group(1) = 3 dispatches.
    expect(status.lastMirroredSeq).toBe(3);
    expect(status.lastMirroredDigest).toBe(shadowDocumentDigest(doc));

    const read = await readShadowAutosave(database, "shadow-project");
    expect(read.recovery.issues).toEqual([]);
    expect(read.digest).toBe(shadowDocumentDigest(doc));
    expect(read.seq).toBe(status.lastMirroredSeq);
    expect(read.scene).toEqual(normalizeShadowDocument(doc));
  });

  it("트레일링 디바운스: 연속 enqueue 는 타이머를 재무장하고 한 패스로 합쳐진다", async () => {
    const { database, scheduler, mirror } = await openHarness({
      compactAfterMirror: false,
    });
    mirror.enqueueSnapshot(legacyDoc("d1"));
    mirror.enqueueSnapshot(legacyDoc("d2"));
    const finalDoc = legacyDoc("d3");
    mirror.enqueueSnapshot(finalDoc);
    // 매 enqueue 가 이전 타이머를 취소하고 재무장한다.
    expect(scheduler.scheduledDelays).toEqual([250, 250, 250]);
    expect(scheduler.pendingCount).toBe(1);
    scheduler.fire();
    await mirror.flush();

    const status = mirror.getStatus();
    expect(status.enqueuedSnapshots).toBe(3);
    expect(status.mirroredSnapshots).toBe(1);
    expect(status.droppedSnapshots).toBe(2);
    expect(status.lastMirroredDigest).toBe(shadowDocumentDigest(finalDoc));
    // 저널에도 마지막 문서의 배치 하나만 실렸다.
    const entries = await createSqliteJournalStore(database, "shadow-project").readEntries();
    expect(entries.filter((entry) => entry.command.type === "scene/init")).toHaveLength(1);
  });

  it("백프레셔: 패스 진행 중 도착한 스냅샷은 최신 1건만 살아남고 드롭은 카운트된다", async () => {
    const { scheduler, mirror } = await openHarness({ compactAfterMirror: false });
    mirror.enqueueSnapshot(legacyDoc("A"));
    scheduler.fire();
    expect(mirror.getStatus().mirroring).toBe(true);
    // 패스가 비동기로 도는 동안(동기 구간) B→C→D 가 밀려든다.
    mirror.enqueueSnapshot(legacyDoc("B"));
    mirror.enqueueSnapshot(legacyDoc("C"));
    const last = legacyDoc("D");
    mirror.enqueueSnapshot(last);
    expect(scheduler.pendingCount).toBe(0); // 진행 중에는 타이머를 새로 안 건다.
    await mirror.flush();

    const status = mirror.getStatus();
    expect(status.enqueuedSnapshots).toBe(4);
    expect(status.mirroredSnapshots).toBe(2); // A 와 D 만.
    expect(status.droppedSnapshots).toBe(2); // B, C 는 교체 드롭.
    expect(status.lastMirroredDigest).toBe(shadowDocumentDigest(last));
  });

  it("연속 스냅샷 갱신: 마지막 문서 상태가 최종 복구 상태다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    for (const marker of ["v1", "v2", "v3"]) {
      mirror.enqueueSnapshot(legacyDoc(marker));
      scheduler.fire();
      await mirror.flush();
    }
    expect(mirror.getStatus().mirroredSnapshots).toBe(3);
    const read = await readShadowAutosave(database, "shadow-project");
    expect(read.digest).toBe(shadowDocumentDigest(legacyDoc("v3")));
  });

  it("한 DB 에서 프로젝트별 미러 레인이 격리된다", async () => {
    const database = new InterceptingDatabase(await openTracked());
    const lanes = ["proj-a", "proj-b"].map((projectId) => {
      const scheduler = new ManualScheduler();
      const mirror = createShadowAutosaveMirror({
        database,
        projectId,
        debounceMs: 100,
        scheduler,
        now: makeStepClock(),
      });
      return { projectId, scheduler, mirror };
    });
    const first = lanes[0];
    const second = lanes[1];
    if (first === undefined || second === undefined) throw new Error("expected two lanes");
    first.mirror.enqueueSnapshot(legacyDoc("only-a"));
    second.mirror.enqueueSnapshot(legacyDoc("only-b"));
    await first.mirror.flush();
    await second.mirror.flush();

    const readA = await readShadowAutosave(database, "proj-a");
    const readB = await readShadowAutosave(database, "proj-b");
    expect(readA.digest).toBe(shadowDocumentDigest(legacyDoc("only-a")));
    expect(readB.digest).toBe(shadowDocumentDigest(legacyDoc("only-b")));
    expect(readA.digest).not.toBe(readB.digest);
  });

  it("1k 노드 대형 문서 스모크: 완주하고 복구 digest 가 일치한다", async () => {
    const { database, scheduler, mirror } = await openHarness({
      snapshotEvery: 4_096,
      compactAfterMirror: false,
    });
    const bigDoc = {
      elements: Array.from({ length: 1_000 }, (_, i) => ({
        id: `bulk-${i}`,
        x: i % 100,
        y: Math.floor(i / 100),
        payload: `content-${i}`,
      })),
    };
    mirror.enqueueSnapshot(bigDoc);
    scheduler.fire();
    await mirror.flush();

    const status = mirror.getStatus();
    // init(1) + doc:digest(1) + 요소 1000 = 1002 dispatches.
    expect(status.lastMirroredSeq).toBe(1_002);
    expect(status.failedMirrors).toBe(0);
    const read = await readShadowAutosave(database, "shadow-project");
    expect(read.recovery.issues).toEqual([]);
    expect(read.digest).toBe(shadowDocumentDigest(bigDoc));
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 실패 격리 · 재시도
// ---------------------------------------------------------------------------

describe("ShadowAutosaveMirror — 실패 격리", () => {
  it("저장 실패 주입 시에도 enqueue/flush 는 절대 던지지 않는다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    database.failAppend = new Error("injected: disk full");
    expect(mirror.enqueueSnapshot(legacyDoc("doomed"))).toBe(true);
    scheduler.fire();
    await expect(mirror.flush()).resolves.toBeUndefined();

    const status = mirror.getStatus();
    expect(status.failedMirrors).toBe(1);
    expect(status.mirroredSnapshots).toBe(0);
    expect(status.lastError).toBeInstanceOf(Error);
    expect((status.lastError as Error).message).toContain("disk full");
    // 저널에는 아무것도 안착하지 않았다.
    expect(
      (await readShadowAutosave(database, "shadow-project")).digest,
    ).toBeNull();
  });

  it("저장이 회복되면 다음 패스가 자연 재시도하고 lastError 를 지운다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    database.failAppend = new Error("injected: transient");
    mirror.enqueueSnapshot(legacyDoc("retry"));
    scheduler.fire();
    await mirror.flush();
    expect(mirror.getStatus().failedMirrors).toBe(1);

    database.failAppend = null;
    const healedDoc = legacyDoc("healed");
    mirror.enqueueSnapshot(healedDoc);
    scheduler.fire();
    await mirror.flush();

    const status = mirror.getStatus();
    expect(status.mirroredSnapshots).toBe(1);
    expect(status.lastError).toBeNull();
    expect(
      (await readShadowAutosave(database, "shadow-project")).digest,
    ).toBe(shadowDocumentDigest(healedDoc));
  });

  it("CommandBus 개방 실패도 격리되고, 회복 후 재개방·미러에 성공한다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    database.failListSnapshots = new Error("injected: open blocked");
    mirror.enqueueSnapshot(legacyDoc("blocked"));
    scheduler.fire();
    await mirror.flush();
    expect(mirror.getStatus().failedMirrors).toBe(1);
    expect((mirror.getStatus().lastError as Error).message).toContain("open blocked");

    database.failListSnapshots = null;
    const doc = legacyDoc("reopened");
    mirror.enqueueSnapshot(doc);
    scheduler.fire();
    await mirror.flush();
    expect(mirror.getStatus().mirroredSnapshots).toBe(1);
    expect(
      (await readShadowAutosave(database, "shadow-project")).digest,
    ).toBe(shadowDocumentDigest(doc));
  });

  it("미러 레인은 저널 테이블만 만진다(레거시 kv·토너먼트·비용 테이블 무접촉)", async () => {
    const { database, scheduler, mirror } = await openHarness();
    mirror.enqueueSnapshot(legacyDoc("touch-audit"));
    scheduler.fire();
    await mirror.flush();
    await mirror.close();

    const allowed = new Set([
      "appendJournalEntry",
      "listJournalEntries",
      "deleteJournalEntriesBefore",
      "putJournalSnapshot",
      "listJournalSnapshots",
    ]);
    expect(database.calls.length).toBeGreaterThan(0);
    expect(database.calls.filter((name) => !allowed.has(name))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// close 정합 · compaction · 결정성
// ---------------------------------------------------------------------------

describe("ShadowAutosaveMirror — close/복구/결정성", () => {
  it("close 는 대기 스냅샷을 드레인하고 재개방 digest 가 일치한다", async () => {
    const { database, mirror } = await openHarness();
    const doc = legacyDoc("pending-at-close");
    mirror.enqueueSnapshot(doc);
    // 디바운스를 발화시키지 않고 바로 닫는다 — close 가 드레인해야 한다.
    await mirror.close();

    const status = mirror.getStatus();
    expect(status.closed).toBe(true);
    expect(status.mirroredSnapshots).toBe(1);
    expect(status.pendingSnapshot).toBe(false);

    const read = await readShadowAutosave(database, "shadow-project");
    expect(read.recovery.issues).toEqual([]);
    expect(read.digest).toBe(status.lastMirroredDigest);
    expect(read.digest).toBe(shadowDocumentDigest(doc));
    // 클린 셧다운 스냅샷 앵커가 실제로 남았다.
    const snapshots = await createSqliteJournalStore(database, "shadow-project").readSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(read.recovery.snapshotSlotUsed).not.toBeNull();
  });

  it("close 이후 enqueue 는 거절되고 카운터로만 표면화된다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    mirror.enqueueSnapshot(legacyDoc("final"));
    scheduler.fire();
    await mirror.flush();
    await mirror.close();
    const before = await readShadowAutosave(database, "shadow-project");

    expect(mirror.enqueueSnapshot(legacyDoc("too-late"))).toBe(false);
    const status = mirror.getStatus();
    expect(status.rejectedAfterClose).toBe(1);
    expect(status.enqueuedSnapshots).toBe(1);
    const after = await readShadowAutosave(database, "shadow-project");
    expect(after.seq).toBe(before.seq);
    expect(after.digest).toBe(before.digest);
  });

  it("compaction(기본)이 저널 성장을 상수로 묶고 복구는 여전히 완전하다", async () => {
    const { database, scheduler, mirror } = await openHarness();
    for (const marker of ["c1", "c2", "c3", "c4"]) {
      mirror.enqueueSnapshot(legacyDoc(marker));
      scheduler.fire();
      await mirror.flush();
    }
    const store = createSqliteJournalStore(database, "shadow-project");
    // 성공 패스마다 앵커 스냅샷 + compactBefore(seq) — 앵커 seq 엔트리만 남는다.
    expect((await store.readEntries()).length).toBeLessThanOrEqual(1);
    expect(mirror.getStatus().maintenanceFailures).toBe(0);
    const read = await readShadowAutosave(database, "shadow-project");
    expect(read.recovery.issues).toEqual([]);
    expect(read.digest).toBe(shadowDocumentDigest(legacyDoc("c4")));
  });

  it("결정성: 같은 스냅샷 시퀀스 + 같은 클럭은 같은 저널 digest 를 낳는다", async () => {
    const journalDigestFor = async (projectId: string): Promise<string> => {
      const database = new InterceptingDatabase(await openTracked());
      const scheduler = new ManualScheduler();
      const mirror = createShadowAutosaveMirror({
        database,
        projectId,
        debounceMs: 50,
        scheduler,
        now: makeStepClock(),
        compactAfterMirror: false,
      });
      for (const marker of ["s1", "s2"]) {
        mirror.enqueueSnapshot(legacyDoc(marker));
        scheduler.fire();
        await mirror.flush();
      }
      await mirror.close();
      const entries = await createSqliteJournalStore(database, projectId).readEntries();
      expect(entries.length).toBeGreaterThan(0);
      return fnv1a64Hex(canonicalJson(entries));
    };

    const [first, second] = await Promise.all([
      journalDigestFor("determinism"),
      journalDigestFor("determinism"),
    ]);
    expect(first).toBe(second);
    // scene digest 경로도 동일 계약: 정규화는 순수 함수다.
    expect(sceneDigest(normalizeShadowDocument(legacyDoc("s2")))).toBe(
      shadowDocumentDigest(legacyDoc("s2")),
    );
  });
});
