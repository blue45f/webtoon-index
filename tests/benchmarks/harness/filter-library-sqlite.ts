/**
 * Real sqlite-wasm benchmark for the uncapped V12 filter-preset catalog.
 * Run from the repository root:
 *   pnpm exec tsx tests/benchmarks/harness/filter-library-sqlite.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import sqliteWasm from "@sqlite.org/sqlite-wasm";

import {
  createSqliteFilterLibraryRepository,
  type StudioFilterLibraryPreset,
} from "../../../apps/web/src/domains/creator/filter/studio-filter-library-sqlite-repository";
import {
  openStudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "../../../apps/web/src/domains/creator/studio-local-database";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");
const PRESET_COUNT = 10_000;
const INSERT_BATCH_SIZE = 250;
const PAGE_SIZE = 257;
const QUERY_SAMPLES = 100;
const CATEGORIES = ["comic", "photo", "tone", "line", "color", "webtoon"] as const;

interface Distribution {
  readonly samplesMs: number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
}

function fixed(value: number): number {
  return Number(value.toFixed(4));
}

function distribution(samples: readonly number[]): Distribution {
  if (samples.length === 0) throw new Error("distribution requires at least one sample");
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!;
  return {
    samplesMs: samples.map(fixed),
    p50Ms: fixed(percentile(0.5)),
    p95Ms: fixed(percentile(0.95)),
    p99Ms: fixed(percentile(0.99)),
    meanMs: fixed(samples.reduce((sum, value) => sum + value, 0) / samples.length),
  };
}

function makePreset(index: number): StudioFilterLibraryPreset {
  const number = String(index).padStart(5, "0");
  const category = CATEGORIES[index % CATEGORIES.length]!;
  return {
    id: `bench-filter-${number}`,
    packageId: `bench-pack-${String(index % 400).padStart(3, "0")}`,
    entryId: `entry-${number}`,
    name: `${category} 작가 프리셋 ${number}`,
    engine: "vignette",
    values: {
      darkness: 1 + (index % 100),
      size: (index * 3) % 101,
      roundness: (index * 7) % 101,
      feather: (index * 11) % 101,
    },
    installedAt: index + 1,
    updatedAt: (index + 1) * 2,
    category,
    favorite: index % 13 === 0,
    sortOrder: index % 1000,
    packageVersion: "12.0.0",
    packageFingerprint: `bench-fingerprint-${index % 400}`,
  };
}

async function main(): Promise<void> {
  const sqlite3 = (await sqliteWasm()) as unknown as StudioSqliteApiHandle;
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  const repository = createSqliteFilterLibraryRepository(database);
  const source = Array.from({ length: PRESET_COUNT }, (_, index) => makePreset(index));
  const payloadBytes = source.reduce(
    (sum, preset) => sum + Buffer.byteLength(JSON.stringify(preset)),
    0,
  );
  const memoryBefore = process.memoryUsage();

  const insertSamples: number[] = [];
  let savedCount = 0;
  const insertStartedAt = performance.now();
  for (let offset = 0; offset < source.length; offset += INSERT_BATCH_SIZE) {
    const batch = source.slice(offset, offset + INSERT_BATCH_SIZE);
    const startedAt = performance.now();
    savedCount += await repository.putMany(batch);
    insertSamples.push(performance.now() - startedAt);
  }
  const insertTotalMs = performance.now() - insertStartedAt;

  const pageSamples: number[] = [];
  const ids = new Set<string>();
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const startedAt = performance.now();
    const page = await repository.query({ cursor, limit: PAGE_SIZE });
    pageSamples.push(performance.now() - startedAt);
    for (const preset of page.items) ids.add(preset.id);
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }

  const searchSamples: number[] = [];
  for (let index = 0; index < QUERY_SAMPLES; index += 1) {
    const search = index % 2 === 0
      ? `작가 프리셋 ${String((index * 97) % PRESET_COUNT).padStart(2, "0").slice(0, 2)}`
      : CATEGORIES[index % CATEGORIES.length]!;
    const startedAt = performance.now();
    await repository.query({ search, limit: 64 });
    searchSamples.push(performance.now() - startedAt);
  }

  const filterSamples: number[] = [];
  for (let index = 0; index < QUERY_SAMPLES; index += 1) {
    const startedAt = performance.now();
    await repository.query({
      category: CATEGORIES[index % CATEGORIES.length],
      engine: "vignette",
      favorite: index % 2 === 0 ? true : null,
      limit: 64,
    });
    filterSamples.push(performance.now() - startedAt);
  }

  const memoryAfter = process.memoryUsage();
  const report = {
    harness: "tests/benchmarks/harness/filter-library-sqlite.ts",
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      node: process.version,
      sqliteWasmPackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
    },
    policy: {
      noFilterCatalogCap: true,
      legacyDataMigration: false,
      discardExistingStudioData: true,
      authority: "SQLite wasm structured table",
      vfs: "wasm-memory (same SQL/query path as OPFS SAH-pool)",
    },
    config: {
      presetCount: PRESET_COUNT,
      insertBatchSize: INSERT_BATCH_SIZE,
      pageSize: PAGE_SIZE,
      searchSamples: QUERY_SAMPLES,
      filterSamples: QUERY_SAMPLES,
    },
    results: {
      savedCount,
      sourcePayloadBytes: payloadBytes,
      insert: {
        totalMs: fixed(insertTotalMs),
        batchCount: insertSamples.length,
        distribution: distribution(insertSamples),
      },
      keysetFullScan: {
        pageCount: pageSamples.length,
        uniqueIds: ids.size,
        distribution: distribution(pageSamples),
      },
      searchQuery: distribution(searchSamples),
      categoryFavoriteFilter: distribution(filterSamples),
      memory: {
        rssBeforeMb: fixed(memoryBefore.rss / 1_048_576),
        rssAfterMb: fixed(memoryAfter.rss / 1_048_576),
        heapUsedBeforeMb: fixed(memoryBefore.heapUsed / 1_048_576),
        heapUsedAfterMb: fixed(memoryAfter.heapUsed / 1_048_576),
      },
    },
  };

  await database.close();
  await mkdir(RESULTS_DIR, { recursive: true });
  const target = join(RESULTS_DIR, "filter-library-sqlite.json");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.results, null, 2));
  console.log(`written: ${target}`);
}

await main();
