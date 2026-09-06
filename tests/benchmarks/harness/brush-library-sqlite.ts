/**
 * Real sqlite-wasm benchmark for the unlimited brush-library product lane.
 * Run from the repository root:
 *   pnpm exec tsx tests/benchmarks/harness/brush-library-sqlite.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import sqliteWasm from "@sqlite.org/sqlite-wasm";

import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioSavedBrush,
} from "../../../apps/web/src/domains/creator/brush/studio-brush-library";
import { createSqliteBrushLibraryRepository } from "../../../apps/web/src/domains/creator/brush/studio-brush-library-sqlite-repository";
import {
  openStudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "../../../apps/web/src/domains/creator/studio-local-database";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");
const BRUSH_COUNT = 10_000;
const PAGE_SIZE = 257;
const LOOKUP_SAMPLES = 100;
const FILTER_SAMPLES = 50;

interface Distribution {
  readonly samplesMs: number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
  const fixed = (value: number): number => Number(value.toFixed(4));
  return {
    samplesMs: samples.map(fixed),
    p50Ms: fixed(percentile(0.5)),
    p95Ms: fixed(percentile(0.95)),
    p99Ms: fixed(percentile(0.99)),
    meanMs: fixed(samples.reduce((sum, value) => sum + value, 0) / samples.length),
  };
}

function makeBrush(index: number): StudioSavedBrush {
  const timestamp = index + 1;
  const brushId = index % 5 === 0 ? "watercolor" : index % 7 === 0 ? "pencil" : "pen";
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    id: `bench-brush-${String(index).padStart(5, "0")}`,
    name: `${brushId} 작가 브러시 ${String(index).padStart(5, "0")}`,
    brushId,
    createdAt: timestamp,
    updatedAt: timestamp * 2,
    pinned: index % 17 === 0,
    lastUsedAt: index % 3 === 0 ? timestamp * 3 : null,
  };
}

async function main(): Promise<void> {
  const sqlite3 = (await sqliteWasm()) as unknown as StudioSqliteApiHandle;
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  const repository = createSqliteBrushLibraryRepository(database);
  const source = Array.from({ length: BRUSH_COUNT }, (_, index) => makeBrush(index));
  const payloadBytes = source.reduce(
    (sum, brush) => sum + Buffer.byteLength(JSON.stringify(brush)),
    0,
  );
  const memoryBefore = process.memoryUsage();

  const writeStartedAt = performance.now();
  const writeSummary = await repository.putMany(source);
  const batchWriteMs = performance.now() - writeStartedAt;

  const pageSamples: number[] = [];
  const ids = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const startedAt = performance.now();
    const page = await repository.query({ cursor, limit: PAGE_SIZE });
    pageSamples.push(performance.now() - startedAt);
    for (const brush of page.items) ids.add(brush.id);
    hasMore = page.hasMore;
    cursor = page.nextCursor;
  }

  const lookupSamples: number[] = [];
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    const id = `bench-brush-${String((index * 97) % BRUSH_COUNT).padStart(5, "0")}`;
    const startedAt = performance.now();
    await repository.getById(id);
    lookupSamples.push(performance.now() - startedAt);
  }

  const filterSamples: number[] = [];
  for (let index = 0; index < FILTER_SAMPLES; index += 1) {
    const startedAt = performance.now();
    await repository.query({
      category: "watercolor",
      pinned: index % 2 === 0 ? true : undefined,
      search: index % 3 === 0 ? "작가 브러시" : "watercolor",
      limit: 64,
    });
    filterSamples.push(performance.now() - startedAt);
  }

  const memoryAfter = process.memoryUsage();
  const report = {
    harness: "tests/benchmarks/harness/brush-library-sqlite.ts",
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      node: process.version,
      sqliteWasmPackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
    },
    config: {
      brushCount: BRUSH_COUNT,
      pageSize: PAGE_SIZE,
      lookupSamples: LOOKUP_SAMPLES,
      filterSamples: FILTER_SAMPLES,
      vfs: "wasm-memory (same SQL/query path as OPFS SAH-pool)",
    },
    results: {
      batchWriteMs: Number(batchWriteMs.toFixed(4)),
      savedCount: writeSummary.savedCount,
      skippedDuplicateCount: writeSummary.skippedDuplicateCount,
      sourcePayloadBytes: payloadBytes,
      keysetFullScan: {
        pageCount: pageSamples.length,
        uniqueIds: ids.size,
        distribution: distribution(pageSamples),
      },
      idLookup: distribution(lookupSamples),
      filteredQuery: distribution(filterSamples),
      memory: {
        rssBeforeMb: Number((memoryBefore.rss / 1_048_576).toFixed(2)),
        rssAfterMb: Number((memoryAfter.rss / 1_048_576).toFixed(2)),
        heapUsedBeforeMb: Number((memoryBefore.heapUsed / 1_048_576).toFixed(2)),
        heapUsedAfterMb: Number((memoryAfter.heapUsed / 1_048_576).toFixed(2)),
      },
    },
  };

  await database.close();
  await mkdir(RESULTS_DIR, { recursive: true });
  const target = join(RESULTS_DIR, "brush-library-sqlite.json");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.results, null, 2));
  console.log(`written: ${target}`);
}

await main();
