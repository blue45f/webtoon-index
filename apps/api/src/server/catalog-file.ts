// 카탈로그 gz 파일 계층 — 카탈로그의 단일 운영 저장소(읽기 + 원자적 쓰기 + 스탯 폴링).
// Neon 전송 쿼터 사고(24k편 ~22MB JSON을 catalog_snapshot 행으로 읽고 쓰던 구조) 이후
// 카탈로그는 파일 전용으로 운영한다: 부팅·핫리로드·ingest 가 전부 이 모듈을 거치며 DB 전송 0.
// 서버리스(api/index.js, includeFiles 로 번들)와 로컬 dev 양쪽에서 동작하도록 cwd 에서 위로 탐색한다.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { constants as zlibConstants, gunzipSync, gzipSync } from "node:zlib";

import type { Title } from "../../../web/src/shared/lib/types";

const CANDIDATES = ["apps/api/data/catalog.json.gz", "data/catalog.json.gz", "catalog.json.gz"];

type EnvLike = Partial<Record<string, string | undefined>>;

// 명시 경로 환경변수 — WEBDEX_CATALOG_FILE 이 정식 이름, WEBDEX_CATALOG_GZ 는 기존 스크립트 호환 별칭.
function envCatalogPath(env: EnvLike): string | null {
  const raw = env.WEBDEX_CATALOG_FILE || env.WEBDEX_CATALOG_GZ;
  return raw ? path.resolve(raw) : null;
}

// 읽기용 경로 해석. 환경변수로 명시된 경로는 그 경로만 본다(없으면 null — 번들 폴백으로 새지 않음).
// 미지정이면 cwd 에서 위로 올라가며 번들 후보를 찾는다.
export function resolveCatalogFile(env: EnvLike = process.env): string | null {
  const envPath = envCatalogPath(env);
  if (envPath) return existsSync(envPath) ? envPath : null;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    for (const rel of CANDIDATES) {
      const candidate = path.resolve(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// 쓰기용 경로 해석 — 아직 파일이 없어도 목표 경로를 돌려준다.
// 우선순위: 환경변수 명시 경로 → 기존 파일 위치(제자리 갱신) → 레포 루트의 apps/api/data/catalog.json.gz.
export function resolveCatalogFileForWrite(env: EnvLike = process.env): string {
  const envPath = envCatalogPath(env);
  if (envPath) return envPath;
  const existing = resolveCatalogFile(env);
  if (existing) return existing;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "apps", "api"))) {
      return path.join(dir, "apps", "api", "data", "catalog.json.gz");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "apps/api/data/catalog.json.gz");
}

// 파일 스탯(mtime/size) — 갱신 감지 폴링용. DB/네트워크 왕복 없이 syscall 1번이라 사실상 무비용.
export function statCatalogFile(env: EnvLike = process.env): { file: string; mtimeMs: number; size: number } | null {
  const file = resolveCatalogFile(env);
  if (!file) return null;
  try {
    const stat = statSync(file);
    return { file, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

// 카탈로그 교환 포맷({titles, ...} 래퍼) — crawl/news-gen/build-static-catalog 소비 호환을 위해 불변.
// runHash 등 ingest 메타는 추가 필드로만 붙인다(독자들은 .titles 만 읽는다).
export interface CatalogFileWrapper {
  titles: Title[];
  count?: number;
  sourceVersion?: string;
  crawledAt?: string;
  metadata?: unknown;
  // ingest 가 기록하는 추가 필드(없을 수 있음 — 수동 gzip 산출물 등)
  runHash?: string;
  writtenAt?: string;
  writtenBy?: string;
}

function readWrapper(file: string): CatalogFileWrapper | null {
  try {
    const raw = file.endsWith(".gz")
      ? gunzipSync(readFileSync(file)).toString("utf8")
      : readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { titles: parsed as Title[] };
    const wrapper = parsed as CatalogFileWrapper;
    if (!Array.isArray(wrapper?.titles)) return null;
    return wrapper;
  } catch {
    return null;
  }
}

export function loadCatalogTitlesFromFile(env: EnvLike = process.env): {
  titles: Title[];
  sourceVersion: string;
  file: string;
  runHash: string | null;
} | null {
  const file = resolveCatalogFile(env);
  if (!file) return null;
  const wrapper = readWrapper(file);
  if (!wrapper || wrapper.titles.length === 0) return null;
  return {
    titles: wrapper.titles,
    sourceVersion: `file:${path.basename(file)}`,
    file,
    runHash: typeof wrapper.runHash === "string" && wrapper.runHash ? wrapper.runHash : null,
  };
}

// ── 파일 요약(중복 판정·품질 게이트·status 용) ──
// gunzip+parse 는 로컬 CPU 만 쓰지만 22MB 파일이라 status 폴링이 반복 호출해도 싸지 않다 —
// (mtime,size) 가 같으면 캐시를 돌려준다(파일이 바뀌면 키가 달라져 자동 무효화).
export interface CatalogFileSummary {
  file: string;
  mtimeMs: number;
  size: number;
  runHash: string | null;
  titleCount: number;
  sourceVersion: string | null;
  crawledAt: string | null;
  sources: Record<string, number> | null;
}

let summaryCache: { key: string; value: CatalogFileSummary } | null = null;

function extractSources(metadata: unknown): Record<string, number> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const sources = (metadata as { sources?: unknown }).sources;
  if (!sources || typeof sources !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sources as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function readCatalogFileSummary(env: EnvLike = process.env): CatalogFileSummary | null {
  const stat = statCatalogFile(env);
  if (!stat) return null;
  const key = `${stat.file}:${stat.mtimeMs}:${stat.size}`;
  if (summaryCache?.key === key) return summaryCache.value;
  const wrapper = readWrapper(stat.file);
  if (!wrapper) return null;
  const value: CatalogFileSummary = {
    file: stat.file,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    runHash: typeof wrapper.runHash === "string" && wrapper.runHash ? wrapper.runHash : null,
    titleCount: wrapper.titles.length,
    sourceVersion: wrapper.sourceVersion ?? null,
    crawledAt: wrapper.crawledAt ?? null,
    sources: extractSources(wrapper.metadata),
  };
  summaryCache = { key, value };
  return value;
}

// ── 원자적 쓰기 ──
// tmp 파일에 gzip 본문을 전부 쓴 뒤 같은 디렉터리 안에서 rename 한다. POSIX rename 은 원자적이라
// 동시 독자(빌드 스크립트·다른 프로세스·폴링 리로더)가 절대 부분 쓰기 상태를 읽지 않는다.
export function writeCatalogTitlesToFile(
  input: {
    titles: Title[];
    sourceVersion?: string;
    crawledAt?: string;
    metadata?: unknown;
    runHash?: string;
    writtenBy?: string;
  },
  env: EnvLike = process.env
): string {
  const file = resolveCatalogFileForWrite(env);
  const wrapper: CatalogFileWrapper = {
    titles: input.titles,
    count: input.titles.length,
    sourceVersion: input.sourceVersion,
    crawledAt: input.crawledAt,
    metadata: input.metadata ?? undefined,
    runHash: input.runHash,
    writtenAt: new Date().toISOString(),
    writtenBy: input.writtenBy ?? "catalog-ingest",
  };
  const body = JSON.stringify(wrapper);
  const payload = file.endsWith(".gz")
    ? gzipSync(Buffer.from(body, "utf8"), { level: zlibConstants.Z_BEST_COMPRESSION })
    : Buffer.from(body, "utf8");

  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, payload);
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp 정리 실패는 무시(원본 에러를 우선 전달)
    }
    throw error;
  }
  summaryCache = null; // 같은 (mtime,size) 충돌 가능성까지 차단 — 다음 요약은 새로 읽는다.
  return file;
}
