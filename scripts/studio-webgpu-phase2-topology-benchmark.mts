import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  planStudioGpuDabTileBinning,
  studioGpuDabIndicesForTile,
} from "../apps/web/src/domains/creator/render/studio-webgpu-dab-tile-binning";

interface BenchmarkDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface Distribution {
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly meanMs: number;
}

const DOCUMENT_WIDTH = 4_096;
const DOCUMENT_HEIGHT = 4_096;
const TILE_SIZE = 128;
const DAB_COUNT = 4_096;
const WARMUP = 2;
const ITERATIONS = 7;

function quantile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    samplesMs: Object.freeze(samples.map((value) => Number(value.toFixed(4)))),
    p50Ms: Number(quantile(sorted, 0.5).toFixed(4)),
    p95Ms: Number(quantile(sorted, 0.95).toFixed(4)),
    meanMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(4)),
  });
}

function benchmark(run: () => number): Readonly<{ output: number; timing: Distribution }> {
  let output = 0;
  for (let index = 0; index < WARMUP; index += 1) output ^= run();
  const samples: number[] = [];
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now();
    output ^= run();
    samples.push(performance.now() - started);
  }
  return Object.freeze({ output: output >>> 0, timing: distribution(samples) });
}

function hashIndex(hash: number, value: number): number {
  let next = (hash ^ value) >>> 0;
  next = Math.imul(next, 0x0100_0193) >>> 0;
  return next;
}

function syntheticDabs(): readonly BenchmarkDab[] {
  let state = 0x6d2b_79f5;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const dabs: BenchmarkDab[] = [
    { x: 128, y: 128, radius: 12 },
    { x: 2_048, y: 2_048, radius: 28 },
    { x: -12, y: 512, radius: 8 },
    { x: 4_104, y: 3_000, radius: 16 },
  ];
  while (dabs.length < DAB_COUNT) {
    dabs.push(Object.freeze({
      x: random() * DOCUMENT_WIDTH,
      y: random() * DOCUMENT_HEIGHT,
      radius: 1.5 + random() * 30,
    }));
  }
  return Object.freeze(dabs);
}

function intersectsTile(
  dab: BenchmarkDab,
  column: number,
  row: number,
): boolean {
  const minimumX = column * TILE_SIZE;
  const minimumY = row * TILE_SIZE;
  const maximumX = Math.min(DOCUMENT_WIDTH, minimumX + TILE_SIZE);
  const maximumY = Math.min(DOCUMENT_HEIGHT, minimumY + TILE_SIZE);
  return dab.x + dab.radius > minimumX
    && dab.y + dab.radius > minimumY
    && dab.x - dab.radius < maximumX
    && dab.y - dab.radius < maximumY;
}

function naiveTileScanHash(dabs: readonly BenchmarkDab[]): number {
  const columns = Math.ceil(DOCUMENT_WIDTH / TILE_SIZE);
  const rows = Math.ceil(DOCUMENT_HEIGHT / TILE_SIZE);
  let hash = 0x811c_9dc5;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tileIndex = row * columns + column;
      hash = hashIndex(hash, tileIndex);
      for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
        if (intersectsTile(dabs[dabIndex]!, column, row)) {
          hash = hashIndex(hash, dabIndex);
        }
      }
    }
  }
  return hash >>> 0;
}

function sparseBinningHash(dabs: readonly BenchmarkDab[]): number {
  const result = planStudioGpuDabTileBinning({
    documentWidth: DOCUMENT_WIDTH,
    documentHeight: DOCUMENT_HEIGHT,
    tileSize: TILE_SIZE,
    dabs,
  });
  if (result.status !== "ready") throw new Error(`binning rejected: ${result.reason}`);
  let hash = 0x811c_9dc5;
  for (let tileIndex = 0; tileIndex < result.plan.tileCount; tileIndex += 1) {
    hash = hashIndex(hash, tileIndex);
    const indices = studioGpuDabIndicesForTile(result.plan, tileIndex);
    if (!indices) throw new Error(`missing tile ${tileIndex}`);
    for (const dabIndex of indices) hash = hashIndex(hash, dabIndex);
  }
  return hash >>> 0;
}

function verifyExactParity(dabs: readonly BenchmarkDab[]): Readonly<{
  tileCount: number;
  referenceCount: number;
  nonEmptyTileCount: number;
  storageBytes: number;
}> {
  const result = planStudioGpuDabTileBinning({
    documentWidth: DOCUMENT_WIDTH,
    documentHeight: DOCUMENT_HEIGHT,
    tileSize: TILE_SIZE,
    dabs,
  });
  if (result.status !== "ready") throw new Error(`binning rejected: ${result.reason}`);
  for (let tileIndex = 0; tileIndex < result.plan.tileCount; tileIndex += 1) {
    const column = tileIndex % result.plan.columns;
    const row = Math.floor(tileIndex / result.plan.columns);
    const expected: number[] = [];
    for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
      if (intersectsTile(dabs[dabIndex]!, column, row)) expected.push(dabIndex);
    }
    const actual = studioGpuDabIndicesForTile(result.plan, tileIndex);
    if (!actual || actual.length !== expected.length) {
      throw new Error(`tile ${tileIndex} reference count mismatch`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      if (actual[index] !== expected[index]) {
        throw new Error(`tile ${tileIndex} stable order mismatch at ${index}`);
      }
    }
  }
  return Object.freeze({
    tileCount: result.plan.tileCount,
    referenceCount: result.plan.referenceCount,
    nonEmptyTileCount: result.plan.nonEmptyTileCount,
    storageBytes: result.plan.tileOffsets.byteLength + result.plan.dabIndices.byteLength,
  });
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const dabs = syntheticDabs();
  const parity = verifyExactParity(dabs);
  const baselineComparisons = parity.tileCount * dabs.length;
  const sparseTopologyOperations = dabs.length + parity.tileCount + parity.referenceCount * 2;
  const baseline = benchmark(() => naiveTileScanHash(dabs));
  const sparse = benchmark(() => sparseBinningHash(dabs));
  const hashesMatch = naiveTileScanHash(dabs) === sparseBinningHash(dabs);
  const structurallyReduced = sparseTopologyOperations < baselineComparisons;
  const report = Object.freeze({
    kind: "studio-webgpu-phase2-topology-benchmark",
    revision: 1,
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      node: process.version,
    },
    corpus: {
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      tileSize: TILE_SIZE,
      dabCount: dabs.length,
      ...parity,
    },
    baseline: {
      algorithm: "row-major tile × full dab scan",
      comparisons: baselineComparisons,
      timing: baseline.timing,
    },
    candidate: {
      algorithm: "stable count + exclusive scan + scatter CSR",
      topologyOperations: sparseTopologyOperations,
      operationReductionRatio: Number(
        (1 - sparseTopologyOperations / baselineComparisons).toFixed(6),
      ),
      timing: sparse.timing,
    },
    gates: {
      exactTileMembershipAndOrder: true,
      hashesMatch,
      structurallyReduced,
      timingIsInformationalOnly: true,
    },
  });

  const output = argument("--output");
  if (output) {
    const target = resolve(output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
  if (
    process.argv.includes("--check")
    && (!hashesMatch || !structurallyReduced)
  ) process.exitCode = 1;
}

await main();
