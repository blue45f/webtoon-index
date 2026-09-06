import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface Distribution {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
}

interface FilterLibraryReport {
  harness: string;
  policy: {
    noFilterCatalogCap: boolean;
    legacyDataMigration: boolean;
    discardExistingStudioData: boolean;
    authority: string;
  };
  config: {
    presetCount: number;
    insertBatchSize: number;
    pageSize: number;
    searchSamples: number;
    filterSamples: number;
  };
  results: {
    savedCount: number;
    sourcePayloadBytes: number;
    insert: { totalMs: number; batchCount: number; distribution: Distribution };
    keysetFullScan: { pageCount: number; uniqueIds: number; distribution: Distribution };
    searchQuery: Distribution;
    categoryFavoriteFilter: Distribution;
  };
}

const report = JSON.parse(readFileSync(
  new URL("../benchmarks/results/filter-library-sqlite.json", import.meta.url),
  "utf8",
)) as FilterLibraryReport;
const repositorySource = readFileSync(
  new URL("../../apps/web/src/domains/creator/filter/studio-filter-library-sqlite-repository.ts",
    import.meta.url,
  ),
  "utf8",
);
const dialogSource = readFileSync(
  new URL("../../apps/web/src/domains/creator/filter/StudioFilterDialog.tsx", import.meta.url),
  "utf8",
);

function fixed(value: number): number {
  return Number(value.toFixed(4));
}

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return fixed(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!);
}

function expectRawDistribution(
  measured: Distribution,
  expectedSamples: number,
): void {
  expect(measured.samplesMs).toHaveLength(expectedSamples);
  expect(measured.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
  expect(measured.p50Ms).toBe(percentile(measured.samplesMs, 0.5));
  expect(measured.p95Ms).toBe(percentile(measured.samplesMs, 0.95));
  expect(measured.p99Ms).toBe(percentile(measured.samplesMs, 0.99));
  expect(measured.meanMs).toBe(fixed(
    measured.samplesMs.reduce((sum, sample) => sum + sample, 0) / measured.samplesMs.length,
  ));
}

describe("filter-library SQLite benchmark contract", () => {
  it("pins the V12 uncapped/discard policy and exact 10,000-row corpus", () => {
    expect(report.harness).toBe("tests/benchmarks/harness/filter-library-sqlite.ts");
    expect(report.policy).toMatchObject({
      noFilterCatalogCap: true,
      legacyDataMigration: false,
      discardExistingStudioData: true,
      authority: "SQLite wasm structured table",
    });
    expect(report.config.presetCount).toBe(10_000);
    expect(report.results.savedCount).toBe(10_000);
    expect(report.results.keysetFullScan.uniqueIds).toBe(10_000);
    expect(report.results.sourcePayloadBytes).toBeGreaterThan(3_000_000);
  });

  it("retains raw insert/page/search/filter samples and recomputable percentiles", () => {
    expectRawDistribution(
      report.results.insert.distribution,
      report.results.insert.batchCount,
    );
    expectRawDistribution(
      report.results.keysetFullScan.distribution,
      report.results.keysetFullScan.pageCount,
    );
    expectRawDistribution(report.results.searchQuery, report.config.searchSamples);
    expectRawDistribution(
      report.results.categoryFavoriteFilter,
      report.config.filterSamples,
    );
    expect(report.results.insert.batchCount).toBe(
      report.config.presetCount / report.config.insertBatchSize,
    );
    expect(report.results.keysetFullScan.pageCount).toBe(
      Math.ceil(report.config.presetCount / report.config.pageSize),
    );
  });

  it("passes bounded latency gates without redefining the catalog size", () => {
    expect(report.results.insert.totalMs).toBeLessThan(5_000);
    expect(report.results.insert.distribution.p95Ms).toBeLessThan(100);
    expect(report.results.keysetFullScan.distribution.p95Ms).toBeLessThan(100);
    expect(report.results.searchQuery.p95Ms).toBeLessThan(100);
    expect(report.results.categoryFavoriteFilter.p95Ms).toBeLessThan(100);
  });

  it("keeps legacy and localStorage fallbacks out of product open", () => {
    const productOpen = repositorySource.slice(
      repositorySource.indexOf("export async function openProductFilterLibraryRepository"),
      repositorySource.indexOf("let sharedProductRepository"),
    );
    expect(productOpen).toContain(
      "const memory = createMemorySessionFilterLibraryProduct();",
    );
    expect(productOpen).toContain("repository: memory.repository");
    expect(productOpen).toContain(
      "compareAndRestoreInstallSnapshot: memory.compareAndRestoreInstallSnapshot",
    );
    expect(productOpen).toContain("STUDIO_FILTER_LIBRARY_DATA_POLICY");
    expect(productOpen).not.toContain("importLegacyFilterLibraryToSqlite");
    expect(productOpen).not.toContain("createV12FallbackFilterLibraryRepository");
    expect(productOpen).not.toContain("STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY");
    expect(productOpen).not.toContain("STUDIO_FILTER_LIBRARY_V12_FALLBACK_KEY");
    expect(productOpen).not.toContain("localStorage");
    // The retired key remains available only to the explicit legacy/test adapter below.
    expect(repositorySource).toContain(
      '"toonspectrum.studio-filter-library.v12.fallback"',
    );
  });

  it("wires the live dialog to SQL and visibly labels the uncapped authority", () => {
    expect(dialogSource).toContain("acquireProductFilterLibraryRepository");
    expect(dialogSource).toContain("STUDIO_FILTER_LIBRARY_DIALOG_PAGE_SIZE = 128");
    expect(dialogSource).toContain("product.repository.query({");
    expect(dialogSource).toContain("더 불러오기 (");
    expect(dialogSource).not.toContain("readAllFilterPresetsFromRepository");
    expect(dialogSource).toContain("무제한 · 로컬 SQL");
    expect(dialogSource).not.toContain('from "./studio-creator-filter-preset-reader"');
    expect(dialogSource).not.toContain("STUDIO_CREATOR_FILTER_PRESET_LIBRARY_MAX");
  });
});
