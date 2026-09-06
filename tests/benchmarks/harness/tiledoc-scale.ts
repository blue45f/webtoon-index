/**
 * Exact-size sparse-document core benchmark.
 *
 * This lane executes the product's StudioTiledDocumentStore and
 * StudioTileDocCompositePlanner at 8192x8192/100 layers and 2048x30720/100 layers. It measures
 * storage, viewport query, retained compositor planning and in-place edit costs. It deliberately
 * does not call this an end-to-end browser render: GPU upload/presentation remains a separate gate.
 *
 * Run with explicit GC so sequential exact-size cases do not contaminate one another:
 *   node --expose-gc --import tsx tests/benchmarks/harness/tiledoc-scale.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { StudioTileDocCompositePlanner } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-composite-plan";
import { STUDIO_TILEDOC_TILE_SIZE } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-geometry";
import { StudioTiledDocumentStore } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-store";

import type { StudioTileDocCompositeLayer } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-composite-plan";
import type { StudioTileDocRect } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-geometry";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RESULT_PATH = resolve(REPO_ROOT, "tests/benchmarks/results/tiledoc-scale.json");
const LAYER_COUNT = 100;
const SAMPLES = 201;
const TILE_BYTES = STUDIO_TILEDOC_TILE_SIZE ** 2 * 4;
const CORE_P95_GATE_MS = 8.3;
const RESIDENT_GATE_BYTES = 256 * 1024 * 1024;

interface Percentiles {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly samples: number;
}

interface MemorySample {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
}

interface ScaleCaseDefinition {
  readonly id: "8k-100-layer" | "webtoon-30720-100-layer";
  readonly width: number;
  readonly height: number;
  readonly coordinatesForLayer: (index: number) => readonly (readonly [number, number])[];
  readonly cameraRects: readonly StudioTileDocRect[];
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? Number.NaN;
}

function summarize(samples: readonly number[]): Percentiles {
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? Number.NaN),
    samples: samples.length,
  });
}

function memorySample(): MemorySample {
  const value = process.memoryUsage();
  return Object.freeze({
    rssBytes: value.rss,
    heapUsedBytes: value.heapUsed,
    externalBytes: value.external,
    arrayBuffersBytes: value.arrayBuffers,
  });
}

function measure(run: () => void): number {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
}

function layers(): readonly StudioTileDocCompositeLayer[] {
  return Object.freeze(Array.from({ length: LAYER_COUNT }, (_, index) => Object.freeze({
    id: `layer-${String(index).padStart(3, "0")}`,
    visible: true,
    opacity: 1,
    blendMode: "normal",
  })));
}

function writeMarker(red: number, green: number) {
  return (pixels: Uint8ClampedArray): void => {
    pixels[0] = red;
    pixels[1] = green;
    pixels[2] = red ^ green;
    pixels[3] = 255;
  };
}

function buildStore(definition: ScaleCaseDefinition): Readonly<{
  store: StudioTiledDocumentStore;
  layers: readonly StudioTileDocCompositeLayer[];
  buildMs: number;
}> {
  const store = new StudioTiledDocumentStore({
    documentWidth: definition.width,
    documentHeight: definition.height,
  });
  const documentLayers = layers();
  const buildMs = measure(() => {
    documentLayers.forEach((layer, index) => {
      for (const [column, row] of definition.coordinatesForLayer(index)) {
        const result = store.writeTile(
          layer.id,
          column,
          row,
          writeMarker((index * 37 + column) & 0xff, (index * 17 + row) & 0xff),
        );
        if (result.status !== "written") {
          throw new Error(`${definition.id}: failed to materialize ${layer.id}/${column}:${row}`);
        }
      }
    });
  });
  return Object.freeze({ store, layers: documentLayers, buildMs });
}

function exactPixelHash(
  store: StudioTiledDocumentStore,
  definition: ScaleCaseDefinition,
): string {
  const hash = createHash("sha256");
  for (let index = 0; index < LAYER_COUNT; index += 1) {
    const layerId = `layer-${String(index).padStart(3, "0")}`;
    for (const [column, row] of definition.coordinatesForLayer(index)) {
      const pixels = store.readTilePixels(layerId, column, row);
      if (!pixels) throw new Error(`${definition.id}: missing pixels for ${layerId}/${column}:${row}`);
      hash.update(pixels);
    }
  }
  return hash.digest("hex");
}

function runCase(definition: ScaleCaseDefinition) {
  globalThis.gc?.();
  const memoryBefore = memorySample();
  const first = buildStore(definition);
  const { store, layers: documentLayers } = first;
  const stats = store.stats();
  const expectedTileCount = definition.coordinatesForLayer(0).length * LAYER_COUNT;
  if (
    stats.layerCount !== LAYER_COUNT
    || stats.currentTileCount !== expectedTileCount
    || stats.distinctBufferCount !== expectedTileCount
  ) {
    throw new Error(`${definition.id}: exact-size store invariant failed`);
  }
  const memoryAfterBuild = memorySample();
  const planner = new StudioTileDocCompositePlanner();

  const cameraSamples: number[] = [];
  let maximumViewportReferences = 0;
  let maximumCompositeStack = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const rect = definition.cameraRects[index % definition.cameraRects.length]!;
    cameraSamples.push(measure(() => {
      const viewportTiles = store.queryViewport(rect);
      maximumViewportReferences = Math.max(maximumViewportReferences, viewportTiles.length);
      const plan = planner.plan({
        scopeId: store.viewportScopeId(rect),
        layers: documentLayers,
        viewportTiles,
      });
      if (plan.status !== "planned") throw new Error(`${definition.id}: camera plan rejected`);
      for (const tile of plan.tiles) maximumCompositeStack = Math.max(maximumCompositeStack, tile.stack.length);
    }));
  }

  const steadyRect = definition.cameraRects[0]!;
  const steadySamples: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    steadySamples.push(measure(() => {
      const viewportTiles = store.queryViewport(steadyRect);
      const plan = planner.plan({
        scopeId: store.viewportScopeId(steadyRect),
        layers: documentLayers,
        viewportTiles,
      });
      if (plan.status !== "planned") throw new Error(`${definition.id}: steady plan rejected`);
    }));
  }

  const editSamples: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    editSamples.push(measure(() => {
      const result = store.writeTile("layer-000", 0, 0, writeMarker(index & 0xff, (index * 3) & 0xff));
      if (result.status !== "written") throw new Error(`${definition.id}: edit failed`);
      const viewportTiles = store.queryViewport(steadyRect);
      const plan = planner.plan({
        scopeId: store.viewportScopeId(steadyRect),
        layers: documentLayers,
        viewportTiles,
      });
      if (plan.status !== "planned" || !plan.dirtyTileIds.includes("0:0")) {
        throw new Error(`${definition.id}: edit was not invalidated`);
      }
    }));
  }

  const layerChangeSamples: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const target = index % 2 === 0 ? [...documentLayers].reverse() : documentLayers;
    layerChangeSamples.push(measure(() => {
      const plan = planner.plan({
        scopeId: store.viewportScopeId(steadyRect),
        layers: target,
        viewportTiles: store.queryViewport(steadyRect),
      });
      if (plan.status !== "planned") throw new Error(`${definition.id}: layer plan rejected`);
    }));
  }

  const hashA = exactPixelHash(store, definition);
  const memoryPeak = memorySample();
  const capturedStats = store.stats();
  const cacheStats = store.viewportCacheStats();
  store.dispose();
  globalThis.gc?.();

  const repeat = buildStore(definition);
  // Reproduce the exact edit sequence before hashing, rather than comparing an edited run with
  // pristine pixels.
  for (let index = 0; index < SAMPLES; index += 1) {
    repeat.store.writeTile("layer-000", 0, 0, writeMarker(index & 0xff, (index * 3) & 0xff));
  }
  const hashB = exactPixelHash(repeat.store, definition);
  repeat.store.dispose();
  globalThis.gc?.();
  if (hashA !== hashB) throw new Error(`${definition.id}: deterministic pixel hash mismatch`);

  const camera = summarize(cameraSamples);
  const steady = summarize(steadySamples);
  const edit = summarize(editSamples);
  const layerChange = summarize(layerChangeSamples);
  const corePassed = [camera, steady, edit, layerChange]
    .every((summary) => summary.p95Ms <= CORE_P95_GATE_MS)
    && capturedStats.residentBytes <= RESIDENT_GATE_BYTES
    && hashA === hashB;

  return Object.freeze({
    id: definition.id,
    dimensions: Object.freeze({ width: definition.width, height: definition.height }),
    layerCount: LAYER_COUNT,
    tileSize: STUDIO_TILEDOC_TILE_SIZE,
    exactTileCount: capturedStats.currentTileCount,
    expectedTileCount,
    exactResidentBytes: capturedStats.residentBytes,
    naiveFullFrameLayerBytes: definition.width * definition.height * 4 * LAYER_COUNT,
    sparseToNaiveRatio: round(capturedStats.residentBytes / (
      definition.width * definition.height * 4 * LAYER_COUNT
    ), 8),
    buildMs: round(first.buildMs),
    repeatBuildMs: round(repeat.buildMs),
    cameraPanZoomPlan: camera,
    steadyViewportPlan: steady,
    inPlaceEditAndPlan: edit,
    layerReorderAndPlan: layerChange,
    maximumViewportReferences,
    maximumCompositeStack,
    deterministicPixelSha256A: hashA,
    deterministicPixelSha256B: hashB,
    stats: capturedStats,
    viewportCacheStats: cacheStats,
    memory: Object.freeze({ before: memoryBefore, afterBuild: memoryAfterBuild, observedPeak: memoryPeak }),
    gates: Object.freeze({
      coreP95Ms: CORE_P95_GATE_MS,
      residentBytes: RESIDENT_GATE_BYTES,
      corePassed,
      browserGpuPresentationMeasured: false,
      releaseGateClosed: false,
      remaining: "production browser GPU upload/presentation and physical-device interaction",
    }),
  });
}

export function runTiledocScaleBenchmark() {
  const cases: readonly ScaleCaseDefinition[] = [
    Object.freeze({
      id: "8k-100-layer",
      width: 8192,
      height: 8192,
      coordinatesForLayer: () => Object.freeze([[0, 0], [15, 15]] as const),
      cameraRects: Object.freeze([
        Object.freeze({ x: 0, y: 0, width: 512, height: 512 }),
        Object.freeze({ x: 7680, y: 7680, width: 512, height: 512 }),
        Object.freeze({ x: 0, y: 0, width: 1024, height: 1024 }),
      ]),
    }),
    Object.freeze({
      id: "webtoon-30720-100-layer",
      width: 2048,
      height: 30720,
      coordinatesForLayer: (index: number) => Object.freeze([
        [0, 0],
        [index % 4, ((index * 17) % 59) + 1],
      ] as const),
      cameraRects: Object.freeze(Array.from({ length: 60 }, (_, row) => Object.freeze({
        x: 0,
        y: row * 512,
        width: 1024,
        height: 512,
      }))),
    }),
  ];
  const startedAt = new Date().toISOString();
  const results = cases.map(runCase);
  const output = Object.freeze({
    schemaVersion: 1,
    harness: "tests/benchmarks/harness/tiledoc-scale.ts",
    command: "node --expose-gc --import tsx tests/benchmarks/harness/tiledoc-scale.ts",
    measuredAt: startedAt,
    scope: "product sparse storage and retained compositor core; not browser GPU presentation",
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    host: Object.freeze({
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCores: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
    }),
    configuration: Object.freeze({
      exactLayerCount: LAYER_COUNT,
      samplesPerOperation: SAMPLES,
      tileSize: STUDIO_TILEDOC_TILE_SIZE,
      tileBytes: TILE_BYTES,
      coreP95GateMs: CORE_P95_GATE_MS,
      residentGateBytes: RESIDENT_GATE_BYTES,
    }),
    cases: Object.freeze(results),
    overall: Object.freeze({
      corePassed: results.every((result) => result.gates.corePassed),
      releaseGateClosed: false,
      remaining: "browser GPU presentation at exact document sizes plus physical-device CSP comparison",
    }),
  });
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

const isDirectRun = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = runTiledocScaleBenchmark();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
