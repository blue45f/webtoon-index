import {
  journalEntryIRSchema,
  snapshotIRSchema,
} from "@toonspectrum/studio-project-model";

import type { StudioLocalDatabase } from "./studio-local-database";
import type {
  JournalEntryIR,
  JournalStore,
  SnapshotIR,
  SnapshotSlot,
} from "@toonspectrum/studio-project-model";

/**
 * V12 E25 — SQLite(OPFS) 기반 JournalStore.
 *
 * MemoryJournalStore/FileJournalStore/OpfsJournalStore 와 같은 계약을
 * studio-local-database 의 journal_entries/snapshots 구조화 테이블 위에서
 * 구현한다. 저장 계층 규약 그대로:
 * - append 는 호출 순서대로 내구적이며(단일 트랜잭션), CRC 는 엔트리가 이미
 *   지닌 값(entryCrc/snapshotCrc 산출)을 컬럼에 사본으로만 보관한다 — 이
 *   계층은 CRC 를 재계산하지도 검증하지도 않는다(검증은 recovery 몫).
 * - readEntries/readSnapshots 는 크래시에서 살아남은 것을 돌려준다. 해석
 *   불가능한 payload 행(torn write)은 없는 것으로 취급되어 recovery 가
 *   내구 prefix 만 replay 한다.
 * - 스냅샷은 two-slot A/B(컬럼 0/1) upsert — 한 슬롯이 부패해도 형제 슬롯이
 *   복구 앵커로 남는다.
 *
 * 파일 저장소와 다른 점 하나: PRIMARY KEY(project_id, seq) 덕에 append 가
 * 같은 seq 의 잔여 꼬리(복구가 잘라낸 torn 엔트리)를 같은 트랜잭션에서 물리
 * 교체한다. JSONL 이라면 중복 seq 줄이 쌓였을 상황이 구조적으로 사라진다.
 */

const SNAPSHOT_SLOT_TO_COLUMN: Readonly<Record<SnapshotSlot, 0 | 1>> = Object.freeze({
  A: 0,
  B: 1,
});

export class SqliteJournalStore implements JournalStore {
  constructor(
    private readonly database: StudioLocalDatabase,
    private readonly projectId: string,
  ) {
    if (projectId.length === 0) {
      throw new Error("sqlite journal store: projectId must not be empty");
    }
  }

  async append(entry: JournalEntryIR): Promise<void> {
    await this.database.appendJournalEntry(this.projectId, {
      seq: entry.seq,
      payload: JSON.stringify(entry),
      crc32: entry.crc,
    });
  }

  async readEntries(): Promise<JournalEntryIR[]> {
    const rows = await this.database.listJournalEntries(this.projectId);
    const entries: JournalEntryIR[] = [];
    for (const row of rows) {
      try {
        const parsed = journalEntryIRSchema.safeParse(JSON.parse(row.payload));
        if (parsed.success) entries.push(parsed.data);
      } catch {
        // Torn payload 행 — 없는 것으로 취급, recovery 가 prefix 를 replay 한다.
      }
    }
    return entries;
  }

  async writeSnapshot(snapshot: SnapshotIR): Promise<void> {
    await this.database.putJournalSnapshot(this.projectId, {
      slot: SNAPSHOT_SLOT_TO_COLUMN[snapshot.slot],
      seq: snapshot.seq,
      payload: JSON.stringify(snapshot),
      crc32: snapshot.crc,
    });
  }

  async readSnapshots(): Promise<SnapshotIR[]> {
    const rows = await this.database.listJournalSnapshots(this.projectId);
    const snapshots: SnapshotIR[] = [];
    for (const row of rows) {
      try {
        const parsed = snapshotIRSchema.safeParse(JSON.parse(row.payload));
        if (parsed.success) snapshots.push(parsed.data);
      } catch {
        // 부패 슬롯 — two-slot 스킴이 형제 슬롯으로 폴백한다.
      }
    }
    return snapshots;
  }

  async compactBefore(seq: number): Promise<void> {
    await this.database.deleteJournalEntriesBefore(this.projectId, seq);
  }
}

/** 프로젝트별로 스코프된 SQLite JournalStore 를 만든다. */
export function createSqliteJournalStore(
  database: StudioLocalDatabase,
  projectId: string,
): SqliteJournalStore {
  return new SqliteJournalStore(database, projectId);
}
