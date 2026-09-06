import { execFile } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { and, desc, eq, lt, notInArray } from "drizzle-orm";

import { getCatalogState, loadCatalogSnapshot, replaceCatalogData, resetCatalogToEmpty } from "../../../../packages/core/src/server/catalog-store";
import { catalogIngestRuns, catalogSnapshots, db, dbClient } from "../db";

import {
  loadCatalogTitlesFromFile,
  readCatalogFileSummary,
  statCatalogFile,
  writeCatalogTitlesToFile,
} from "./catalog-file";
import { buildCatalogSourcePlan, parseCatalogSourceIds } from "./catalog-sources";

import type { Title } from "../../../web/src/shared/lib/types";


const execFileAsync = promisify(execFile);

export type CatalogIngestMode = "off" | "fixed";
export type CatalogIngestRunStatus = "running" | "success" | "failed" | "aborted";

export interface CatalogIngestConfig {
  mode: CatalogIngestMode;
  intervalSeconds: number;
  timeoutMs: number;
  maxOutputMb: number;
  scriptPath: string;
  triggerToken: string;
  sourceIds: ReturnType<typeof parseCatalogSourceIds>;
  minRetainRatio: number;
  // 폴링 핫 리로드 주기(초). 0이면 비활성(스케줄러 ingest의 in-process 갱신만).
  // 파일 모드(기본)는 gz 파일 mtime/size 스탯 비교(무비용), 레거시 FORCE_DB 모드만 DB id 조회.
  refreshPollSeconds: number;
  // (레거시 FORCE_DB 전용) 보존할 최신 DB 스냅샷 개수(나머지 프루닝). 무한 증가(수십 MB/행) 방지.
  snapshotRetention: number;
}

// 품질 게이트 상수: 직전에 이 이상 수집되던 주요 소스가 0이 되면 '붕괴'로 간주.
const SOURCE_PRESENT_FLOOR = 5;
const REGRESSION_SOURCE_KEYS = ["naverWebtoon", "naverSeries", "kakaoWebtoon", "lezhin"] as const;

export interface CatalogCrawlerPayload {
  titles: Title[];
  count?: number;
  sourceVersion?: string;
  crawledAt?: string;
  metadata?: unknown;
}

export interface CatalogIngestRunResult {
  runId: string;
  status: CatalogIngestRunStatus;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  titleCount: number;
  runHash: string | null;
  snapshotId: string | null;
  duplicate: boolean;
  message: string | null;
  error: string | null;
}

export interface CatalogIngestRunOptions {
  requestedBy?: string;
  triggeredBy?: string;
  force?: boolean;
  config?: CatalogIngestConfig;
}

type EnvLike = Partial<Record<string, string | undefined>>;

const execSource = "crawl.mjs";
let runSchemaReady = false;
let snapshotSchemaReady = false;
// 레거시 FORCE_DB 모드: 현재 메모리에 로드된 current 스냅샷 id — DB 폴링 핫 리로드의 변경 감지 기준.
let loadedSnapshotId: string | null = null;
// 파일 모드: 메모리에 로드된 카탈로그 파일의 (경로, mtime, size) — 스탯 폴링의 변경 감지 기준.
let loadedFileStat: { file: string; mtimeMs: number; size: number } | null = null;
let loadedFileRunHash: string | null = null;

// 카탈로그 저장 모드. 기본은 파일 전용(catalog.json.gz) — DB 전송 0.
// Neon 무료 전송 쿼터 사고(스냅샷 행 ~22MB 를 읽고 쓰던 구조) 이후 DB catalog_snapshot 경로는
// WEBDEX_CATALOG_FORCE_DB=1 레거시 플래그일 때만 동작한다(하위호환·롤백용).
export function isCatalogForceDb(env: EnvLike = process.env): boolean {
  return env.WEBDEX_CATALOG_FORCE_DB === "1";
}

// 파일 모드의 스냅샷 식별자: ingest 가 기록한 runHash, 없으면(수동 gzip 산출물) 파일 스탯 태그.
function fileSnapshotId(): string | null {
  if (loadedFileRunHash) return loadedFileRunHash;
  if (loadedFileStat) {
    return `file:${path.basename(loadedFileStat.file)}@${Math.round(loadedFileStat.mtimeMs)}`;
  }
  return null;
}

export function normalizeCatalogIngestConfig(env: EnvLike = process.env): CatalogIngestConfig {
  return {
    mode: env.CATALOG_INGEST_MODE === "fixed" ? "fixed" : "off",
    intervalSeconds: parseBoundedInt(env.CATALOG_INGEST_INTERVAL_SECONDS, 1_800, 60, 86_400),
    // 풀 크롤은 플랫폼 병렬화로 보통 ~3분이면 끝난다. 예산이 잘려 '부분 결과'가 되지 않도록 타임아웃을
    // 넉넉히 잡는다(기본 10분, env 로 최대 30분). 예산(timeoutMs - 버퍼)은 SIGTERM 방지용 안전망으로만 동작 —
    // 모든 루프가 유한 캡으로 끝나므로 정상 상황에선 트리거되지 않고 전부 완주한다.
    timeoutMs: parseBoundedInt(env.CATALOG_INGEST_TIMEOUT_MS, 600_000, 30_000, 1_800_000),
    // 기본 소스셋(네이버시리즈 등 대형 포함)의 크롤 JSON은 수십 MB라, 12MB로는 maxBuffer 초과로
    // ingest가 실패한다. 기본값을 넉넉히 잡아 정식 파이프라인이 기본 소스셋에서도 동작하게 한다.
    maxOutputMb: parseBoundedInt(env.CATALOG_INGEST_SCRIPT_MAX_OUTPUT_MB, 64, 1, 200),
    scriptPath: env.CATALOG_CRAWL_SCRIPT || path.join("scripts", "crawl.mjs"),
    // 트림 필수: env 파일의 후행 공백/개행이 토큰에 섞이면 정상 토큰이 거부되고,
    // 공백뿐인 값이 '설정된 토큰'으로 살아나는 것도 막는다(공백 토큰 = 미설정).
    triggerToken: (env.CATALOG_INGEST_TRIGGER_TOKEN ?? "").trim(),
    sourceIds: parseCatalogSourceIds(env.WEBDEX_SOURCE_IDS),
    // 직전 스냅샷 대비 이 비율 미만으로 총건수가 급감하면(force 아니면) 승격 거부 (0<r<=1)
    minRetainRatio: parseBoundedRatio(env.CATALOG_INGEST_MIN_RETAIN_RATIO, 0.6),
    refreshPollSeconds: parseBoundedInt(env.CATALOG_REFRESH_POLL_SECONDS, 60, 0, 3600),
    snapshotRetention: parseBoundedInt(env.CATALOG_SNAPSHOT_RETENTION, 5, 1, 100),
  };
}

// 토큰 비교(타이밍 세이프) — sha256 다이제스트끼리 비교해 길이 차이로 인한 조기 반환도 없앤다.
export function safeTokenEqual(expected: string, provided: unknown): boolean {
  if (!expected || typeof provided !== "string" || !provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

export type CatalogIngestTokenVerdict = "ok" | "not-configured" | "invalid";

// 수동 ingest 토큰 검증. 토큰 미설정이면 토큰 인증 자체를 사용할 수 없다("not-configured").
// 후보(헤더/바디)를 모두 평가해 단락(short-circuit)으로 인한 타이밍 차이를 줄인다.
export function verifyCatalogIngestToken(
  expectedToken: string,
  ...candidates: unknown[]
): CatalogIngestTokenVerdict {
  if (!expectedToken) return "not-configured";
  let matched = false;
  for (const candidate of candidates) {
    if (safeTokenEqual(expectedToken, candidate)) matched = true;
  }
  return matched ? "ok" : "invalid";
}

// 직전 current 스냅샷 통계(총건수·소스별 count) vs 신규 payload 비교 — 순수 함수(테스트 용이)
export function evaluateRegression(
  newCount: number,
  newSources: Record<string, number> | null,
  current: { titleCount: number; sources: Record<string, number> | null } | null,
  minRetainRatio: number
): { reason: string; newCount: number; currentCount: number } | null {
  if (!current || current.titleCount <= 0) return null; // 비교 대상 없음(첫 스냅샷)
  if (newCount < Math.floor(current.titleCount * minRetainRatio)) {
    return {
      reason: `title count dropped ${newCount} < ${current.titleCount}×${minRetainRatio}`,
      newCount,
      currentCount: current.titleCount,
    };
  }
  if (current.sources && newSources) {
    for (const key of REGRESSION_SOURCE_KEYS) {
      const prev = current.sources[key] ?? 0;
      const next = newSources[key] ?? 0;
      if (prev >= SOURCE_PRESENT_FLOOR && next === 0) {
        return {
          reason: `source "${key}" collapsed (prev ${prev} → 0)`,
          newCount,
          currentCount: current.titleCount,
        };
      }
    }
  }
  return null;
}

export function extractSourceCounts(metadata: unknown): Record<string, number> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const sources = (metadata as { sources?: unknown }).sources;
  if (!sources || typeof sources !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sources as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function parseCrawlerJsonPayload(stdout: string): CatalogCrawlerPayload {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("crawler returned empty stdout");

  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate) as Partial<CatalogCrawlerPayload>;
      if (!Array.isArray(payload.titles)) continue;
      return {
        titles: payload.titles.filter(isTitleLike),
        count: typeof payload.count === "number" ? payload.count : payload.titles.length,
        sourceVersion: payload.sourceVersion,
        crawledAt: payload.crawledAt,
        metadata: payload.metadata,
      };
    } catch {
      continue;
    }
  }

  throw new Error("crawler stdout did not contain a valid catalog JSON payload");
}

// 실행 이력(catalog_ingest_run, 행당 수 KB)은 파일 전용 모드에서도 계속 DB에 기록한다 —
// 수동 크롤 UI(status/recentRuns)가 소비. 대형 catalog_snapshot DDL 은 레거시 경로에서만 보장.
async function ensureIngestRunSchema() {
  if (runSchemaReady) return;

  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS catalog_ingest_run (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      "runHash" TEXT,
      "triggeredBy" TEXT,
      "requestedBy" TEXT,
      "startedAt" TIMESTAMPTZ NOT NULL,
      "finishedAt" TIMESTAMPTZ,
      "durationMs" INTEGER,
      "titleCount" INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      error TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_catalog_ingest_run_created ON catalog_ingest_run("createdAt")`);
  await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_catalog_ingest_run_status ON catalog_ingest_run(status, "createdAt")`);

  runSchemaReady = true;
}

// 레거시 전용: catalog_snapshot DDL. DB 스냅샷을 실제로 읽고 쓰는 함수들만 호출한다.
async function ensureLegacySnapshotSchema() {
  if (snapshotSchemaReady) return;

  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS catalog_snapshot (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      "sourceVersion" TEXT,
      "titleCount" INTEGER NOT NULL DEFAULT 0,
      "isCurrent" BOOLEAN NOT NULL DEFAULT false,
      snapshot TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_current ON catalog_snapshot("isCurrent", "createdAt")`);
  await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_created ON catalog_snapshot("createdAt")`);

  snapshotSchemaReady = true;
}

export async function ensureCatalogIngestSchema() {
  await ensureIngestRunSchema();
  // 파일 전용 모드에서는 스냅샷 테이블 DDL 자체를 건너뛴다(불필요한 DB 왕복/객체 생성 방지).
  if (isCatalogForceDb()) await ensureLegacySnapshotSchema();
}

// ── 파일 모드 로드(기본) ──
// 부팅 로드 순서: 번들/지정 gz 파일 → 없으면 빈 카탈로그(가짜 데이터 미노출). DB 왕복 없음.
export function loadLatestCatalogSnapshotFromFile() {
  const stat = statCatalogFile();
  const result = stat ? loadCatalogTitlesFromFile() : null;
  if (!stat || !result) {
    resetCatalogToEmpty("no-catalog-file");
    loadedFileStat = null;
    loadedFileRunHash = null;
    return {
      loaded: false as const,
      source: "empty",
      titleCount: getCatalogState().titleCount,
      generatedAt: new Date().toISOString(),
    };
  }
  const titles = replaceCatalogData(result.titles, {
    source: "file-snapshot",
    sourceVersion: result.sourceVersion,
  });
  loadedFileStat = stat;
  loadedFileRunHash = result.runHash;
  return {
    loaded: true as const,
    snapshotId: fileSnapshotId(),
    file: stat.file,
    source: "catalog-file",
    sourceVersion: result.sourceVersion,
    titleCount: titles.length,
    createdAt: new Date(stat.mtimeMs).toISOString(),
    generatedAt: new Date().toISOString(),
  };
}

// 레거시 FORCE_DB 전용 — 스냅샷 행(~22MB)을 통째로 읽으므로 기본 경로에서는 호출하지 않는다.
export async function loadLatestCatalogSnapshotFromDb() {
  await ensureIngestRunSchema();
  await ensureLegacySnapshotSchema();
  const [snapshot] = await db
    .select()
    .from(catalogSnapshots)
    .where(eq(catalogSnapshots.isCurrent, true))
    .orderBy(desc(catalogSnapshots.createdAt))
    .limit(1);

  if (!snapshot) {
    resetCatalogToEmpty("no-current-db-snapshot");
    loadedSnapshotId = null;
    return {
      loaded: false,
      source: "empty",
      titleCount: getCatalogState().titleCount,
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    const parsed = JSON.parse(snapshot.snapshot);
    const titles = loadCatalogSnapshot(parsed, snapshot.sourceVersion ?? snapshot.source, false);
    loadedSnapshotId = snapshot.id;
    return {
      loaded: true,
      snapshotId: snapshot.id,
      source: snapshot.source,
      sourceVersion: snapshot.sourceVersion,
      titleCount: titles.length,
      createdAt: toIso(snapshot.createdAt),
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    resetCatalogToEmpty("invalid-db-snapshot");
    throw new Error(`catalog snapshot parse failed: ${error instanceof Error ? error.message : "unknown"}`, {
      cause: error,
    });
  }
}

export function getLoadedSnapshotId() {
  return isCatalogForceDb() ? loadedSnapshotId : fileSnapshotId();
}

// 레거시 FORCE_DB 전용: DB의 현재 current 스냅샷 id (가벼운 조회 — DB 해시 폴링용).
export async function getCurrentSnapshotIdFromDb(): Promise<string | null> {
  await ensureLegacySnapshotSchema();
  const [row] = await db
    .select({ id: catalogSnapshots.id })
    .from(catalogSnapshots)
    .where(eq(catalogSnapshots.isCurrent, true))
    .orderBy(desc(catalogSnapshots.createdAt))
    .limit(1);
  return row?.id ?? null;
}

// 무중단 핫 리로드: 외부 프로세스(CLI/cron/다른 인스턴스)가 새 카탈로그를 적재해도 재시작 없이 수렴.
//  - 파일 모드(기본): gz 파일의 mtime/size 스탯만 비교(syscall 1번, DB·네트워크 0) → 변경 시에만 재로드.
//  - 레거시 FORCE_DB: 기존 DB current 스냅샷 id 폴링.
// POST /api/catalog/refresh 의 응답 계약({ reloaded, snapshotId, titleCount })은 그대로 유지한다.
export async function refreshCatalogIfChanged(): Promise<{
  reloaded: boolean;
  snapshotId: string | null;
  titleCount: number;
}> {
  if (!isCatalogForceDb()) {
    const stat = statCatalogFile();
    if (!stat) {
      // 파일이 (일시적으로) 없으면 서빙 연속성을 위해 메모리 카탈로그를 유지한다 — 비우지 않음.
      return { reloaded: false, snapshotId: fileSnapshotId(), titleCount: getCatalogState().titleCount };
    }
    if (
      loadedFileStat &&
      loadedFileStat.file === stat.file &&
      loadedFileStat.mtimeMs === stat.mtimeMs &&
      loadedFileStat.size === stat.size
    ) {
      return { reloaded: false, snapshotId: fileSnapshotId(), titleCount: getCatalogState().titleCount };
    }
    const result = loadCatalogTitlesFromFile();
    if (!result) {
      // 읽기 실패(외부의 비원자적 쓰기/손상) — 직전 카탈로그 유지, 다음 폴링에서 재시도.
      return { reloaded: false, snapshotId: fileSnapshotId(), titleCount: getCatalogState().titleCount };
    }
    const titles = replaceCatalogData(result.titles, {
      source: "file-snapshot",
      sourceVersion: result.sourceVersion,
    });
    loadedFileStat = stat;
    loadedFileRunHash = result.runHash;
    return { reloaded: true, snapshotId: fileSnapshotId(), titleCount: titles.length };
  }

  const dbId = await getCurrentSnapshotIdFromDb();
  if (dbId === loadedSnapshotId) {
    return { reloaded: false, snapshotId: loadedSnapshotId, titleCount: getCatalogState().titleCount };
  }
  const result = await loadLatestCatalogSnapshotFromDb();
  return { reloaded: true, snapshotId: loadedSnapshotId, titleCount: result.titleCount };
}

// 좀비 이력 정리 기준: startedAt 이 (타임아웃 + 유예)보다 오래된 running 행은 살아 있을 수 없다.
// 프로세스가 run 도중 크래시/재시작하면 행이 'running' 으로 영원히 남아 status·이력이 왜곡되므로 failed 로 마감한다.
export const STALE_RUN_GRACE_MS = 120_000;

export function staleCatalogRunCutoff(timeoutMs: number, now: number = Date.now()): Date {
  return new Date(now - timeoutMs - STALE_RUN_GRACE_MS);
}

export async function reapStaleCatalogIngestRuns(
  config: CatalogIngestConfig = normalizeCatalogIngestConfig(),
  now: number = Date.now()
): Promise<number> {
  await ensureCatalogIngestSchema();
  const reaped = await db
    .update(catalogIngestRuns)
    .set({
      status: "failed",
      finishedAt: new Date(now),
      message: null,
      error: "stale running run reaped: process likely exited mid-run",
    })
    .where(and(eq(catalogIngestRuns.status, "running"), lt(catalogIngestRuns.startedAt, staleCatalogRunCutoff(config.timeoutMs, now))))
    .returning({ id: catalogIngestRuns.id });
  return reaped.length;
}

// status 의 currentSnapshot — 파일 모드에서는 gz 파일 요약으로 같은 응답 구조를 채운다
// (AdminOps UI 가 id·source·sourceVersion·titleCount·isCurrent·createdAt 를 소비).
type CatalogStatusSnapshot = {
  id: string;
  source: string;
  sourceVersion: string | null;
  titleCount: number;
  isCurrent: boolean;
  createdAt: string | null;
  metadata: unknown;
};

function currentSnapshotFromFile(): CatalogStatusSnapshot | null {
  const summary = readCatalogFileSummary();
  if (!summary) return null;
  return {
    id: summary.runHash ?? `file:${path.basename(summary.file)}@${Math.round(summary.mtimeMs)}`,
    source: "catalog-file",
    sourceVersion: summary.sourceVersion ?? `file:${path.basename(summary.file)}`,
    titleCount: summary.titleCount,
    isCurrent: true,
    createdAt: new Date(summary.mtimeMs).toISOString(),
    metadata: {
      storage: "file",
      file: summary.file,
      runHash: summary.runHash,
      sizeBytes: summary.size,
      crawledAt: summary.crawledAt,
      crawler: summary.sources ? { sources: summary.sources } : null,
    },
  };
}

export async function getCatalogIngestStatus(config = normalizeCatalogIngestConfig()) {
  const forceDb = isCatalogForceDb();
  let currentSnapshot: CatalogStatusSnapshot | null = null;
  let recentRuns: (typeof catalogIngestRuns.$inferSelect)[] = [];

  // 이력/레거시 스냅샷 조회는 DB 의존 — 파일 전용 운영에서 DB 가 잠들었거나 장애여도
  // status 자체(파일 스냅샷·config·sourcePlan)는 응답해야 하므로 실패를 격리한다.
  try {
    await ensureCatalogIngestSchema();
    // 죽은 프로세스가 남긴 'running' 이력을 정리해 상태 응답이 유령 실행을 보고하지 않게 한다(실패해도 조회는 계속).
    await reapStaleCatalogIngestRuns(config).catch(() => 0);

    if (forceDb) {
      const [snapshot] = await db
        .select()
        .from(catalogSnapshots)
        .where(eq(catalogSnapshots.isCurrent, true))
        .orderBy(desc(catalogSnapshots.createdAt))
        .limit(1);
      currentSnapshot = snapshot
        ? {
            id: snapshot.id,
            source: snapshot.source,
            sourceVersion: snapshot.sourceVersion,
            titleCount: snapshot.titleCount,
            isCurrent: Boolean(snapshot.isCurrent),
            createdAt: toIso(snapshot.createdAt),
            metadata: parseMaybeJson(snapshot.metadata),
          }
        : null;
    }

    recentRuns = await db
      .select()
      .from(catalogIngestRuns)
      .orderBy(desc(catalogIngestRuns.createdAt))
      .limit(10);
  } catch (error) {
    console.error("catalog ingest status: run history unavailable", error);
  }

  if (!forceDb) currentSnapshot = currentSnapshotFromFile();

  return {
    config: withoutToken(config),
    storage: forceDb ? "database" : "file",
    sourcePlan: buildCatalogSourcePlan(config.sourceIds),
    currentSnapshot,
    catalogState: getCatalogState(),
    recentRuns: recentRuns.map((run) => ({
      id: run.id,
      source: run.source,
      status: run.status,
      runHash: run.runHash,
      triggeredBy: run.triggeredBy,
      requestedBy: run.requestedBy,
      startedAt: toIso(run.startedAt),
      finishedAt: toIso(run.finishedAt),
      durationMs: run.durationMs,
      titleCount: run.titleCount,
      message: run.message,
      error: run.error,
      metadata: parseMaybeJson(run.metadata),
      createdAt: toIso(run.createdAt),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function runCatalogIngest(options: CatalogIngestRunOptions = {}): Promise<CatalogIngestRunResult> {
  const config = options.config ?? normalizeCatalogIngestConfig();
  await ensureCatalogIngestSchema();
  // 새 실행 기록 전에 좀비 running 행을 정리(이력 정확성). 정리 실패가 실행을 막지는 않는다.
  await reapStaleCatalogIngestRuns(config).catch(() => 0);

  const runId = randomUUID();
  const startedAt = new Date();
  const requestedBy = sanitizeLabel(options.requestedBy ?? "system");
  const triggeredBy = sanitizeLabel(options.triggeredBy ?? "system");

  await db.insert(catalogIngestRuns).values({
    id: runId,
    source: execSource,
    status: "running",
    triggeredBy,
    requestedBy,
    startedAt,
    titleCount: 0,
    message: "started",
    metadata: {
      scriptPath: config.scriptPath,
      timeoutMs: config.timeoutMs,
      intervalSeconds: config.intervalSeconds,
      mode: config.mode,
      sourceIds: config.sourceIds,
      force: Boolean(options.force),
    },
  });

  try {
    const payload = await executeCrawler(config);
    if (!payload.titles.length) throw new Error("crawler returned no valid titles");

    const sourceVersion = payload.sourceVersion ?? `crawl/${new Date().toISOString()}`;
    const runHash = hashTitles(payload.titles);
    const forceDb = isCatalogForceDb();
    // 동일-hash 스킵 기준: 파일 모드는 현재 gz 파일의 runHash, 레거시는 DB current 스냅샷 metadata.
    const fileSummary = forceDb ? null : readCatalogFileSummary();
    const duplicate = forceDb
      ? await currentSnapshotHasHash(runHash)
      : Boolean(fileSummary?.runHash && fileSummary.runHash === runHash);

    // 품질 게이트: 신규 데이터가 아닌(중복도 아닌) 경우, 직전 current 대비 총건수 급감 또는 주요 소스
    // 붕괴면 승격을 거부한다(낡은 데이터를 부분 데이터로 덮어쓰지 않음). 빈자리를 seed/추정으로 채우지 않음.
    if (!duplicate && !options.force) {
      const currentStats = forceDb
        ? await getCurrentSnapshotStats()
        : fileSummary
          ? { titleCount: fileSummary.titleCount, sources: fileSummary.sources }
          : null;
      const regression = evaluateRegression(
        payload.titles.length,
        extractSourceCounts(payload.metadata),
        currentStats,
        config.minRetainRatio
      );
      if (regression) {
        const finishedAt = new Date();
        await db
          .update(catalogIngestRuns)
          .set({
            status: "aborted",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            titleCount: payload.titles.length,
            message: null,
            error: `quality gate: ${regression.reason}`,
            metadata: { gate: regression, sourceVersion, crawledAt: payload.crawledAt ?? null },
          })
          .where(eq(catalogIngestRuns.id, runId));
        return {
          runId,
          status: "aborted",
          source: execSource,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          titleCount: payload.titles.length,
          runHash,
          snapshotId: null,
          duplicate: false,
          message: null,
          error: `quality gate: ${regression.reason}`,
        };
      }
    }

    let snapshotId: string | null = null;
    let catalogFile: string | null = fileSummary?.file ?? null;
    if (!duplicate || options.force) {
      if (forceDb) {
        // 레거시: DB catalog_snapshot 승격(+보존 프루닝)
        snapshotId = await persistCatalogSnapshot({
          titles: payload.titles,
          source: execSource,
          sourceVersion,
          runHash,
          runId,
          requestedBy,
          triggeredBy,
          metadata: payload.metadata,
          retention: config.snapshotRetention,
        });
      } else {
        // 파일 전용: gz 원자적 저장(tmp→rename). 동일 runHash 는 위에서 이미 스킵됨.
        catalogFile = writeCatalogTitlesToFile({
          titles: payload.titles,
          sourceVersion,
          runHash,
          crawledAt: payload.crawledAt,
          metadata: payload.metadata,
          writtenBy: "catalog-ingest",
        });
        snapshotId = runHash; // 파일 모드의 스냅샷 식별자 = runHash
      }
    }

    // 메모리 카탈로그 즉시 핫 리로드(파일 모드는 file-snapshot 출처로 표기).
    const titleCount = forceDb
      ? loadCatalogSnapshot(payload.titles, sourceVersion, false).length
      : replaceCatalogData(payload.titles, { source: "file-snapshot", sourceVersion }).length;
    if (!forceDb) {
      // 자기 자신의 쓰기(또는 동일-hash 확인)를 폴링이 다시 로드하지 않도록 스탯 기준점을 동기화.
      loadedFileStat = statCatalogFile();
      loadedFileRunHash = runHash;
    }
    const finishedAt = new Date();
    const message =
      duplicate && !options.force
        ? "unchanged snapshot; memory catalog refreshed"
        : forceDb
          ? "snapshot stored"
          : "catalog file stored";

    await db
      .update(catalogIngestRuns)
      .set({
        status: "success",
        runHash,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        titleCount,
        message,
        error: null,
        metadata: {
          sourceVersion,
          crawledAt: payload.crawledAt ?? null,
          count: payload.count ?? payload.titles.length,
          duplicate,
          force: Boolean(options.force),
          snapshotId,
          storage: forceDb ? "database" : "file",
          catalogFile,
          scriptMetadata: payload.metadata ?? null,
        },
      })
      .where(eq(catalogIngestRuns.id, runId));

    return {
      runId,
      status: "success",
      source: execSource,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      titleCount,
      runHash,
      snapshotId,
      duplicate,
      message,
      error: null,
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : "unknown ingest error";
    try {
      await db
        .update(catalogIngestRuns)
        .set({
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          titleCount: 0,
          message: null,
          error: message,
        })
        .where(eq(catalogIngestRuns.id, runId));
    } catch (updateError) {
      // 이력 기록 실패(DB 장애 등)가 원인 에러를 가리면 안 된다 — 원래 실패 메시지를 그대로 던진다.
      console.error("catalog ingest: failed to record run failure", updateError);
    }
    throw new Error(message, { cause: error });
  }
}

// 크롤 스크립트는 레포 루트의 scripts/crawl.mjs 에 있다. API 프로세스의 cwd 는
// 레포 루트(prod) 또는 apps/api(dev: pnpm --filter) 둘 다 가능하므로, cwd 에서 위로 올라가며
// 스크립트가 실제 존재하는 디렉터리(=레포 루트)를 찾아 절대경로로 실행한다.
function resolveCrawlScript(scriptPath: string): { script: string; base: string } {
  if (path.isAbsolute(scriptPath)) return { script: scriptPath, base: path.dirname(path.dirname(scriptPath)) };
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, scriptPath);
    if (existsSync(candidate)) return { script: candidate, base: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { script: path.resolve(process.cwd(), scriptPath), base: process.cwd() };
}

async function executeCrawler(config: CatalogIngestConfig): Promise<CatalogCrawlerPayload> {
  const { script: scriptPath, base } = resolveCrawlScript(config.scriptPath);
  // 크롤러가 하드 타임아웃(SIGTERM, 출력 유실)을 맞기 전에 스스로 루프를 정리하고 JSON 을 emit 하도록
  // 소프트 예산을 주입한다(안전망 — 보통은 자연 완료가 더 빨라 트리거되지 않는다).
  // 단일 fetch 타임아웃(12s) + 대용량 직렬화/flush 여유를 두고 30s 를 뺀다(최소 30s).
  const crawlBudgetMs = Math.max(30_000, config.timeoutMs - 30_000);
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--json", "--no-file"], {
    cwd: base,
    encoding: "utf8",
    timeout: config.timeoutMs,
    // 우아한 종료는 소프트 예산(WEBDEX_CRAWL_BUDGET_MS)이 담당한다. 하드 타임아웃까지 온 프로세스는
    // 이미 비정상이므로 SIGKILL 로 확실히 제거해 SIGTERM 무시로 인한 좀비/행을 방지한다.
    killSignal: "SIGKILL",
    maxBuffer: config.maxOutputMb * 1024 * 1024,
    env: {
      ...process.env,
      TZ: process.env.TZ ?? "Asia/Seoul",
      WEBDEX_SOURCE_IDS: config.sourceIds.join(","),
      WEBDEX_CRAWL_BUDGET_MS: String(crawlBudgetMs),
    },
  });
  return parseCrawlerJsonPayload(stdout);
}

// ── 파일 전용 저장(기본 경로) ──
// 정규화 검증을 통과한 titles 를 gz 로 원자적으로 저장한다(tmp 쓰기 → rename).
// 동일 runHash 면 파일을 다시 쓰지 않는다(기존 동일-hash 스킵 의미 유지 — mtime 도 보존되어
// 다른 인스턴스의 스탯 폴링이 불필요하게 재로드하지 않는다).
export function persistCatalogSnapshotToFile(input: {
  titles: Title[];
  sourceVersion: string;
  runHash: string;
  crawledAt?: string;
  metadata?: unknown;
  force?: boolean;
}): { written: boolean; file: string } {
  const summary = readCatalogFileSummary();
  if (!input.force && summary?.runHash && summary.runHash === input.runHash) {
    loadedFileRunHash = input.runHash;
    loadedFileStat = statCatalogFile();
    return { written: false, file: summary.file };
  }
  const file = writeCatalogTitlesToFile({
    titles: input.titles,
    sourceVersion: input.sourceVersion,
    crawledAt: input.crawledAt,
    metadata: input.metadata,
    runHash: input.runHash,
    writtenBy: "catalog-ingest",
  });
  loadedFileStat = statCatalogFile();
  loadedFileRunHash = input.runHash;
  return { written: true, file };
}

// 레거시 FORCE_DB 전용 — 스냅샷 행(~22MB)을 DB 에 쓴다. 기본(파일) 경로에서는 호출하지 않는다.
async function persistCatalogSnapshot(input: {
  titles: Title[];
  source: string;
  sourceVersion: string;
  runHash: string;
  runId: string;
  requestedBy: string;
  triggeredBy: string;
  metadata: unknown;
  retention?: number;
}) {
  await ensureLegacySnapshotSchema();
  const snapshotId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.update(catalogSnapshots).set({ isCurrent: false }).where(eq(catalogSnapshots.isCurrent, true));
    await tx.insert(catalogSnapshots).values({
      id: snapshotId,
      source: input.source,
      sourceVersion: input.sourceVersion,
      titleCount: input.titles.length,
      isCurrent: true,
      snapshot: JSON.stringify(input.titles),
      metadata: {
        runHash: input.runHash,
        runId: input.runId,
        requestedBy: input.requestedBy,
        triggeredBy: input.triggeredBy,
        crawler: input.metadata ?? null,
      },
    });
  });
  loadedSnapshotId = snapshotId;

  // 보존: 최신 N개만 남기고 오래된 스냅샷 프루닝(스냅샷 1행이 수십 MB라 무한 증가 방지).
  const retention = Math.max(1, input.retention ?? 5);
  const keep = await db
    .select({ id: catalogSnapshots.id })
    .from(catalogSnapshots)
    .orderBy(desc(catalogSnapshots.createdAt))
    .limit(retention);
  const keepIds = keep.map((k) => k.id);
  if (keepIds.length) {
    await db.delete(catalogSnapshots).where(notInArray(catalogSnapshots.id, keepIds));
  }

  return snapshotId;
}

// 레거시 FORCE_DB 전용 — 동일-hash 판정.
async function currentSnapshotHasHash(runHash: string) {
  await ensureLegacySnapshotSchema();
  const [snapshot] = await db
    .select({ metadata: catalogSnapshots.metadata })
    .from(catalogSnapshots)
    .where(eq(catalogSnapshots.isCurrent, true))
    .orderBy(desc(catalogSnapshots.createdAt))
    .limit(1);
  const metadata = parseMaybeJson(snapshot?.metadata);
  return metadata && typeof metadata === "object" && "runHash" in metadata
    ? (metadata as { runHash?: unknown }).runHash === runHash
    : false;
}

// 품질 게이트용(레거시 FORCE_DB): 직전 current 스냅샷의 총건수 + 소스별 count(metadata.crawler.sources) 조회
async function getCurrentSnapshotStats(): Promise<{ titleCount: number; sources: Record<string, number> | null } | null> {
  await ensureLegacySnapshotSchema();
  const [snapshot] = await db
    .select({ titleCount: catalogSnapshots.titleCount, metadata: catalogSnapshots.metadata })
    .from(catalogSnapshots)
    .where(eq(catalogSnapshots.isCurrent, true))
    .orderBy(desc(catalogSnapshots.createdAt))
    .limit(1);
  if (!snapshot) return null;
  const metadata = parseMaybeJson(snapshot.metadata);
  const crawler =
    metadata && typeof metadata === "object" ? (metadata as { crawler?: unknown }).crawler : null;
  return { titleCount: snapshot.titleCount ?? 0, sources: extractSourceCounts(crawler) };
}

function hashTitles(titles: Title[]) {
  return createHash("sha256").update(JSON.stringify(titles)).digest("hex");
}

function isTitleLike(item: unknown): item is Title {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<Title>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.availability)
  );
}

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseBoundedRatio(raw: unknown, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

function parseMaybeJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toIso(value: Date | number | string | null | undefined) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeLabel(value: string) {
  return value.replace(/[^\w:./@-]/g, "_").slice(0, 80) || "system";
}

function withoutToken(config: CatalogIngestConfig) {
  return {
    mode: config.mode,
    intervalSeconds: config.intervalSeconds,
    timeoutMs: config.timeoutMs,
    maxOutputMb: config.maxOutputMb,
    scriptPath: config.scriptPath,
    sourceIds: config.sourceIds,
    minRetainRatio: config.minRetainRatio,
    refreshPollSeconds: config.refreshPollSeconds,
    snapshotRetention: config.snapshotRetention,
    loadedSnapshotId: getLoadedSnapshotId(),
    triggerTokenConfigured: Boolean(config.triggerToken),
  };
}
