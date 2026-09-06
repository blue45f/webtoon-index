import {
  SqliteUnavailableError,
  type StudioLocalDatabase,
} from "./studio-local-database";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
  STUDIO_TOURNAMENT_WINNER_STORAGE_KEY,
  installDefaultTournamentPersistence,
  parsePersistedTournamentState,
  type PersistedTournamentStateV1,
  type StudioTournamentPersistenceStatus,
  type StudioTournamentRenderSampleEvent,
  type TournamentPersistencePort,
} from "./studio-renderer-tournament-runtime";

/**
 * SQLite(OPFS) 어댑터를 토너먼트 영속 포트에 접합하는 글루.
 * SQLite 개방은 첫 load/save/sample 시점에 lazy 하게 1회 시도한다. 실패 시
 * 포트는 명시적인 memory-only/non-durable 상태가 되며 localStorage나
 * IndexedDB로 자동 강등하지 않는다. 다음 세션의 새 포트만 다시 시도한다.
 *
 * V12 E25: 영속 매체가 kv JSON blob 에서 tournament_winners 구조화 테이블로
 * 승격됐다. load 는 raw 후보 행을 기존 검증기(parsePersistedTournamentState)에
 * 통과시켜 부분 필드가 오염된 행만 드롭하고, save 는 단일 트랜잭션 전체
 * 교체(upsert + 고아 삭제)라 실패 시 이전 상태가 그대로 남는다. 구버전
 * 세션이 남긴 kv blob 은 구조화 행이 하나도 없을 때만 1회성으로 읽히고,
 * 다음 save 가 구조화 테이블로 승격하면서 blob 을 지운다(스키마 버전 의미와
 * 파싱/검증 규약은 kv 시절과 동일).
 */

const TOURNAMENT_KV_NAMESPACE = "tournament";

export interface SqliteTournamentPersistenceOptions {
  /** 테스트 시임 — 기본은 openStudioLocalDatabase (OPFS). */
  openDatabase?: () => Promise<StudioLocalDatabase>;
}

export class StudioTournamentPersistenceUnavailableError extends Error {
  constructor(readonly status: StudioTournamentPersistenceStatus) {
    super(status.reason ?? "Studio tournament SQLite persistence is unavailable");
    this.name = "StudioTournamentPersistenceUnavailableError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

async function loadLegacyKvState(
  database: StudioLocalDatabase,
): Promise<PersistedTournamentStateV1 | null> {
  const payload = await database.kvGet(
    TOURNAMENT_KV_NAMESPACE,
    STUDIO_TOURNAMENT_WINNER_STORAGE_KEY,
  );
  if (payload === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return null;
  }
  return parsePersistedTournamentState(decoded);
}

export function createSqliteTournamentPersistence(
  options: SqliteTournamentPersistenceOptions = {},
): TournamentPersistencePort {
  const openDatabase = options.openDatabase ?? acquireStudioLocalDatabase;
  let database: Promise<StudioLocalDatabase> | null = null;
  let sampleSink: ReturnType<typeof createCostSampleSink> | null = null;
  let persistenceStatus: StudioTournamentPersistenceStatus = {
    mode: "initializing-sqlite",
    durable: false,
    reason: "SQLite/OPFS tournament database has not opened yet",
  };

  function degrade(error: unknown, phase: string): StudioTournamentPersistenceUnavailableError {
    const unavailable = error instanceof SqliteUnavailableError;
    persistenceStatus = {
      mode: "memory-only",
      durable: false,
      reason: `${phase}: ${unavailable ? "SQLite/OPFS unavailable" : "SQLite operation failed"}: ${errorMessage(error)}`,
    };
    return new StudioTournamentPersistenceUnavailableError({ ...persistenceStatus });
  }

  function resolveDatabase(): Promise<StudioLocalDatabase> {
    if (persistenceStatus.mode === "memory-only") {
      return Promise.reject(
        new StudioTournamentPersistenceUnavailableError({ ...persistenceStatus }),
      );
    }
    database ??= openDatabase().then(
      (opened) => {
        persistenceStatus = { mode: "sqlite-opfs", durable: true, reason: null };
        sampleSink = createCostSampleSink(opened, {
          onFailure: (error) => {
            degrade(error, "cost sample write failed");
          },
        });
        return opened;
      },
      (error: unknown) => Promise.reject(degrade(error, "database open failed")),
    );
    return database;
  }

  return {
    status: () => ({ ...persistenceStatus }),
    async load(): Promise<PersistedTournamentStateV1 | null> {
      try {
        const db = await resolveDatabase();
        const candidates = await db.listTournamentWinnerCandidates();
        if (candidates.length === 0) {
          // 구조화 행이 전혀 없을 때만 구버전 SQLite kv blob 을 읽는다.
          return loadLegacyKvState(db);
        }
        return parsePersistedTournamentState({
          version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
          entries: candidates,
        });
      } catch (error) {
        if (error instanceof StudioTournamentPersistenceUnavailableError) throw error;
        throw degrade(error, "winner load failed");
      }
    },
    async save(state: PersistedTournamentStateV1): Promise<void> {
      try {
        const db = await resolveDatabase();
        await db.replaceTournamentWinners(state.entries);
        // 구조화 저장이 성공한 뒤에만 구버전 SQLite kv blob 을 지운다.
        await db.kvDelete(TOURNAMENT_KV_NAMESPACE, STUDIO_TOURNAMENT_WINNER_STORAGE_KEY);
      } catch (error) {
        if (error instanceof StudioTournamentPersistenceUnavailableError) throw error;
        // A rejected state (for example a NOT NULL/finite constraint) does not
        // make the already-open SQLite authority non-durable. Preserve the
        // previous atomic rows and surface the exact write error to the caller.
        throw error;
      }
    },
    async recordSample(sample: StudioTournamentRenderSampleEvent): Promise<void> {
      const db = await resolveDatabase();
      const sink = sampleSink ?? createCostSampleSink(db, {
        onFailure: (error) => {
          degrade(error, "cost sample write failed");
        },
      });
      sampleSink = sink;
      await sink(sample);
    },
  };
}

/**
 * recordRenderSample 이 수용한 실측 샘플을 영속 cost_samples 테이블로 흘리는
 * 싱크. StudioTournamentRuntimeOptions.onRenderSample 에 그대로 꽂힌다.
 * 쓰기 실패는 핫패스로 전파되지 않으며, 반복 스팸을 피해 첫 실패만 경고한다.
 * (recordRenderSample 은 warm 실측만 수용하므로 kind 는 항상 "warm".)
 */
export function createCostSampleSink(
  database: StudioLocalDatabase,
  options: { onFailure?: (error: unknown) => void } = {},
): (sample: StudioTournamentRenderSampleEvent) => Promise<void> {
  let warned = false;
  return async (sample) => {
    try {
      await database.recordCostSample(sample.providerId, sample.bucket, "warm", sample.ms);
    } catch (error) {
      options.onFailure?.(error);
      if (!warned) {
        warned = true;
        console.warn("studio tournament cost sample sink degraded", error);
      }
    }
  };
}

let installed = false;

/** 제품 기본 영속화를 SQLite 우선 체인으로 설치한다(1회, idempotent). */
export function installStudioTournamentSqlitePersistence(): void {
  if (installed) return;
  installed = true;
  installDefaultTournamentPersistence(() => createSqliteTournamentPersistence());
}
