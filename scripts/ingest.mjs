// 로컬 카탈로그 ingest — 크롤러를 돌려(또는 --from 파일을 읽어) gz 카탈로그 파일을 갱신한다.
//
// 카탈로그는 파일 전용으로 운영한다(Neon 전송 쿼터 사고 이후 DB catalog_snapshot 경로는 레거시).
// 기본 동작: 크롤(또는 --from) → Title[] 검증 → apps/api/data/catalog.json.gz 원자적 저장(tmp→rename)
// → 다음 단계 안내 출력. DB 가 전혀 필요 없다.
//
//   pnpm ingest                     # 기본 소스셋으로 새로 크롤 후 gz 파일 저장
//   pnpm ingest --from out.json     # 미리 크롤해 둔 JSON(crawl.mjs --json) 저장(재크롤 없음)
//   pnpm ingest --out path.json.gz  # 저장 경로 재정의(기본: WEBDEX_CATALOG_FILE 또는 apps/api/data/catalog.json.gz)
//   pnpm ingest --force             # 동일 runHash(변경 없음)여도 강제로 다시 쓴다
//   pnpm ingest --db                # (레거시) DB catalog_snapshot 적재 — WEBDEX_CATALOG_FORCE_DB 운영 전용
//   WEBDEX_SOURCE_IDS=all pnpm ingest
//
// 품질 게이트는 건너뛴다(로컬 강제 채움). 운영 주기 ingest 는 POST /api/catalog/ingest/run
// 또는 CATALOG_INGEST_MODE=fixed(runCatalogIngest — 게이트 포함)를 사용한다.
import pg from "pg";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { constants as zlibConstants, gunzipSync, gzipSync } from "node:zlib";

import { normalizePgConnectionStringForTls } from "./pg-connection.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

// 레포 루트 .env.local 로드(→ WEBDEX_CATALOG_FILE / 레거시 --db 의 DATABASE_URL).
if (existsSync(path.join(ROOT, ".env.local"))) {
  try {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  } catch {
    // 무시
  }
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isTitleLike(item) {
  return (
    item &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.slug === "string" &&
    typeof item.title === "string" &&
    Array.isArray(item.availability)
  );
}

async function loadPayload() {
  const from = argValue("--from");
  if (from) {
    const raw = readFileSync(path.resolve(ROOT, from), "utf8");
    return JSON.parse(raw);
  }
  const sourceIds = process.env.WEBDEX_SOURCE_IDS || "all";
  console.error(`crawl 시작 (WEBDEX_SOURCE_IDS=${sourceIds}) …`);
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join("scripts", "crawl.mjs"), "--json", "--no-file"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 1_800_000,
      // 네이버시리즈 등 대형 소스 포함 시 출력이 수십 MB가 되므로 넉넉히 잡는다.
      maxBuffer: 256 * 1024 * 1024,
      env: {
        ...process.env,
        TZ: process.env.TZ ?? "Asia/Seoul",
        WEBDEX_SOURCE_IDS: sourceIds,
        // 하드 타임아웃 전에 그레이스풀 종료하도록 소프트 예산 주입(안전망 — 보통 자연 완료가 더 빠름).
        WEBDEX_CRAWL_BUDGET_MS: String(1_800_000 - 30_000),
      },
    }
  );
  return JSON.parse(stdout);
}

// 저장 경로: --out → WEBDEX_CATALOG_FILE(별칭 WEBDEX_CATALOG_GZ) → apps/api/data/catalog.json.gz
function resolveTargetFile() {
  const out = argValue("--out");
  if (out) return path.resolve(ROOT, out);
  const envPath = process.env.WEBDEX_CATALOG_FILE || process.env.WEBDEX_CATALOG_GZ;
  if (envPath) return path.resolve(envPath);
  return path.join(ROOT, "apps", "api", "data", "catalog.json.gz");
}

// 기존 파일의 runHash(있으면) — 동일 hash 면 다시 쓰지 않는다(스킵 의미 유지).
function readExistingRunHash(file) {
  if (!existsSync(file)) return null;
  try {
    const raw = file.endsWith(".gz")
      ? gunzipSync(readFileSync(file)).toString("utf8")
      : readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.runHash === "string" && parsed.runHash ? parsed.runHash : null;
  } catch {
    return null;
  }
}

// gz 파일 원자적 저장: tmp 에 전부 쓴 뒤 rename — 독자(API 폴링·catalog:gen)가 부분 쓰기를 보지 않는다.
function writeCatalogFileAtomic(file, wrapper) {
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
      // tmp 정리 실패는 무시
    }
    throw error;
  }
  return payload.length;
}

// 기본 경로: gz 카탈로그 파일 저장(DB 불필요)
function ingestToFile(payload, titles) {
  const file = resolveTargetFile();
  const snapshotJson = JSON.stringify(titles);
  const runHash = createHash("sha256").update(snapshotJson).digest("hex");

  const existingHash = readExistingRunHash(file);
  if (!hasFlag("--force") && existingHash && existingHash === runHash) {
    console.error(
      `변경 없음(runHash 동일: ${runHash.slice(0, 12)}…) — 파일을 다시 쓰지 않습니다: ${file}\n` +
        `강제로 다시 쓰려면 --force 를 사용하세요.`
    );
    return;
  }

  const sourceVersion = payload.sourceVersion ?? `local-ingest/${new Date().toISOString()}`;
  const bytes = writeCatalogFileAtomic(file, {
    titles,
    count: titles.length,
    sourceVersion,
    crawledAt: payload.crawledAt ?? new Date().toISOString(),
    metadata: payload.metadata ?? undefined,
    runHash,
    writtenAt: new Date().toISOString(),
    writtenBy: "ingest.mjs",
  });

  const withCover = titles.filter((t) => t.coverImage).length;
  const sources = payload.metadata?.sources ?? {};
  console.error(
    `저장 완료: ${titles.length}편 (coverImage ${withCover}) → ${file} (${(bytes / 1024 / 1024).toFixed(1)}MB gz)\n` +
      `소스: ${JSON.stringify(sources)}\n` +
      `runHash: ${runHash}\n` +
      `다음 단계:\n` +
      `  · 정적 카탈로그 재생성: pnpm catalog:gen (→ apps/web/public/data/*.json)\n` +
      `  · 실행 중인 API 즉시 반영: POST /api/catalog/refresh (또는 파일 폴링이 ${process.env.CATALOG_REFRESH_POLL_SECONDS ?? 60}s 내 자동 반영)`
  );
}

// 레거시 경로(--db): DB catalog_snapshot 적재 — WEBDEX_CATALOG_FORCE_DB=1 운영에서만 의미 있다.
async function ingestToDb(payload, titles) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required.");
  }
  const client = new pg.Client({
    connectionString: normalizePgConnectionStringForTls(url),
  });
  await client.connect();

  try {
    // 컬럼명은 Drizzle pgTable과 동일한 camelCase(대소문자 보존) → 따옴표 필수.
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog_snapshot (
        "id" text PRIMARY KEY,
        "source" text NOT NULL,
        "sourceVersion" text,
        "titleCount" integer NOT NULL DEFAULT 0,
        "isCurrent" boolean NOT NULL DEFAULT false,
        "snapshot" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_current ON catalog_snapshot ("isCurrent", "createdAt")`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_created ON catalog_snapshot ("createdAt")`
    );

    const snapshotJson = JSON.stringify(titles);
    const id = randomUUID();
    const sourceVersion = payload.sourceVersion ?? `local-ingest/${new Date().toISOString()}`;
    const runHash = createHash("sha256").update(snapshotJson).digest("hex");
    const metadata = JSON.stringify({
      runHash,
      runId: id,
      requestedBy: "local-cli",
      triggeredBy: "ingest.mjs",
      crawler: payload.metadata ?? null,
    });

    // 원자적 승격: 직전 current 내림 → 신규 current 적재.
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE catalog_snapshot SET "isCurrent" = false WHERE "isCurrent" = true`);
      await client.query(
        `INSERT INTO catalog_snapshot
           ("id", "source", "sourceVersion", "titleCount", "isCurrent", "snapshot", "metadata", "createdAt")
         VALUES ($1, $2, $3, $4, true, $5, $6::jsonb, now())`,
        [id, "local-ingest", sourceVersion, titles.length, snapshotJson, metadata]
      );
      await client.query("COMMIT");
    } catch (txError) {
      await client.query("ROLLBACK").catch(() => {});
      throw txError;
    }

    const withCover = titles.filter((t) => t.coverImage).length;
    const sources = payload.metadata?.sources ?? {};
    console.error(
      `[레거시 DB] 적재 완료: ${titles.length}편 (coverImage ${withCover}) · snapshot=${id}\n` +
        `소스: ${JSON.stringify(sources)}\n` +
        `→ WEBDEX_CATALOG_FORCE_DB=1 인 API만 이 스냅샷을 읽습니다(기본 운영은 파일 전용).`
    );
  } finally {
    await client.end();
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.error(
      `사용법: node scripts/ingest.mjs [--from out.json] [--out path.json.gz] [--force] [--db]\n` +
        `  기본:    크롤(또는 --from) → 검증 → gz 카탈로그 파일 원자적 저장 (DB 불필요)\n` +
        `  --out:   저장 경로 재정의 (기본 WEBDEX_CATALOG_FILE 또는 apps/api/data/catalog.json.gz)\n` +
        `  --force: 동일 runHash 여도 강제로 다시 쓰기\n` +
        `  --db:    (레거시) DB catalog_snapshot 적재 — WEBDEX_CATALOG_FORCE_DB=1 운영 전용`
    );
    return;
  }

  const payload = await loadPayload();
  const titles = Array.isArray(payload?.titles) ? payload.titles.filter(isTitleLike) : [];
  if (!titles.length) {
    console.error("적재할 유효한 title이 없습니다. (crawler 출력 확인 필요)");
    process.exit(1);
  }

  if (hasFlag("--db")) {
    await ingestToDb(payload, titles);
  } else {
    ingestToFile(payload, titles);
  }
}

main().catch((error) => {
  console.error("ingest 실패:", error?.message ?? error);
  process.exit(1);
});
