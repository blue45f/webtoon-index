/** Real Chromium entry for the exact-size product tiled-document WebGPU benchmark. */

import {
  acquireStudioGpuDevice,
  activeStudioGpuDeviceLeaseCount,
  disposeStudioGpuFabric,
} from "../../../apps/web/src/domains/creator/render/studio-gpu-fabric";
import { StudioTiledDocumentStore } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-store";
import { StudioTileDocWebGpuRuntime } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-webgpu-runtime";

import type { StudioTileDocCompositeLayer } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-composite-plan";
import type { StudioTileDocRect } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-geometry";
import type { StudioTileDocWebGpuCompositeConsumerStats } from "../../../apps/web/src/domains/creator/render/studio-tiledoc-webgpu-composite-consumer";

const RESULT_GLOBAL = "__TOONSPECTRUM_TILEDOC_WEBGPU_BROWSER_RESULT__";
const LAYER_COUNT = 100;
const TILE_SIZE = 512;
const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;
const EXACT_TILE_COUNT = 200;
const EXACT_RESIDENT_BYTES = EXACT_TILE_COUNT * TILE_BYTES;
const SAMPLES = 201;
const INTERACTION_P95_GATE_MS = 250;
const INTERACTION_P99_GATE_MS = 500;
const QUALITY_MAX_LINEAR_DELTA = 0.002;

interface BrowserMemoryPerformance extends Performance {
  readonly memory?: {
    readonly jsHeapSizeLimit: number;
    readonly totalJSHeapSize: number;
    readonly usedJSHeapSize: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: readonly unknown[];
  }>;
}

interface Percentiles {
  readonly sampleCount: number;
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly percentileMethod: "nearest-rank-ceil";
}

interface CaseDefinition {
  readonly id: "8k-100-layer" | "webtoon-30720-100-layer";
  readonly width: number;
  readonly height: number;
  readonly coordinatesForLayer: (index: number) => readonly (readonly [number, number])[];
  readonly cameraRects: readonly StudioTileDocRect[];
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function summarize(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * fraction) - 1)
    );
    return sorted[index] ?? Number.NaN;
  };
  return Object.freeze({
    sampleCount: values.length,
    samplesMs: Object.freeze(values.map((value) => round(value))),
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    p99Ms: round(at(0.99)),
    maxMs: round(sorted.at(-1) ?? Number.NaN),
    percentileMethod: "nearest-rank-ceil",
  });
}

function layers(): readonly StudioTileDocCompositeLayer[] {
  return Object.freeze(Array.from({ length: LAYER_COUNT }, (_, index) => Object.freeze({
    id: `layer-${String(index).padStart(3, "0")}`,
    visible: true,
    opacity: 1,
    blendMode: "normal",
  })));
}

function markerWriter(red: number, green: number) {
  return (pixels: Uint8ClampedArray): void => {
    pixels[0] = red;
    pixels[1] = green;
    pixels[2] = red ^ green;
    pixels[3] = 255;
  };
}

function buildStore(definition: CaseDefinition): {
  readonly store: StudioTiledDocumentStore;
  readonly layers: readonly StudioTileDocCompositeLayer[];
  readonly buildMs: number;
} {
  const store = new StudioTiledDocumentStore({
    documentWidth: definition.width,
    documentHeight: definition.height,
  });
  const documentLayers = layers();
  const started = performance.now();
  documentLayers.forEach((layer, index) => {
    for (const [column, row] of definition.coordinatesForLayer(index)) {
      const result = store.writeTile(
        layer.id,
        column,
        row,
        markerWriter((index * 37 + column) & 0xff, (index * 17 + row) & 0xff)
      );
      if (result.status !== "written") {
        throw new Error(`${definition.id}: failed to materialize ${layer.id}/${column}:${row}`);
      }
    }
  });
  return { store, layers: documentLayers, buildMs: performance.now() - started };
}

function memoryNow(): Record<string, number> | null {
  const value = (performance as BrowserMemoryPerformance).memory;
  return value ? {
    usedJSHeapSizeBytes: value.usedJSHeapSize,
    totalJSHeapSizeBytes: value.totalJSHeapSize,
    jsHeapSizeLimitBytes: value.jsHeapSizeLimit,
  } : null;
}

function usedHeap(): number {
  return (performance as BrowserMemoryPerformance).memory?.usedJSHeapSize ?? 0;
}

async function userAgentMemory(): Promise<Record<string, unknown>> {
  const browserPerformance = performance as BrowserMemoryPerformance;
  if (typeof browserPerformance.measureUserAgentSpecificMemory !== "function") {
    return { available: false, bytes: null, reason: "API unavailable" };
  }
  try {
    const measured = await browserPerformance.measureUserAgentSpecificMemory();
    return {
      available: true,
      bytes: measured.bytes,
      breakdownEntryCount: measured.breakdown?.length ?? null,
    };
  } catch (error) {
    return {
      available: false,
      bytes: null,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function consumerStats(runtime: StudioTileDocWebGpuRuntime): StudioTileDocWebGpuCompositeConsumerStats {
  const stats = runtime.stats().consumer;
  if (!stats) throw new Error("tiledoc WebGPU consumer was not initialized");
  return stats;
}

function counterDelta(
  before: StudioTileDocWebGpuCompositeConsumerStats,
  after: StudioTileDocWebGpuCompositeConsumerStats
): Record<string, number> {
  const names = [
    "sourceCacheHits",
    "sourceCacheMisses",
    "sourceCacheEvictions",
    "retainedCacheHits",
    "retainedCacheMisses",
    "retainedCacheEvictions",
    "compositeCacheReuses",
    "sourceUploadCount",
    "sourcePayloadBytesUploaded",
    "physicalBytesUploaded",
    "presentedFrames",
    "presentationDraws",
    "validationReadbackCount",
    "validationReadbackBytes",
  ] as const;
  return Object.fromEntries(names.map((name) => [name, after[name] - before[name]]));
}

async function present(
  runtime: StudioTileDocWebGpuRuntime,
  frameId: string,
  viewport: StudioTileDocRect,
  documentLayers: readonly StudioTileDocCompositeLayer[]
): Promise<number> {
  const started = performance.now();
  const result = await runtime.requestFrame({ frameId, viewport, layers: documentLayers });
  const elapsed = performance.now() - started;
  if (result.status !== "ready") {
    throw new Error(`frame ${frameId} failed: ${JSON.stringify(result)}`);
  }
  return elapsed;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  message: string
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function readHalfPixel(bytes: Uint8Array, bytesPerRow: number, x: number, y: number): number[] {
  const offset = y * bytesPerRow + x * 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return [0, 2, 4, 6].map((channelOffset) => halfToFloat(
    view.getUint16(channelOffset, true)
  ));
}

function adapterInfoShape(adapter: GPUAdapter | null): Record<string, unknown> | null {
  if (!adapter) return null;
  const info = adapter.info as GPUAdapterInfo | undefined;
  if (!info) return null;
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
}

async function runCase(definition: CaseDefinition): Promise<Record<string, unknown>> {
  disposeStudioGpuFabric();
  const memoryBefore = memoryNow();
  let peakJsHeapBytes = usedHeap();
  const built = buildStore(definition);
  const { store, layers: allLayers } = built;
  const storeStats = store.stats();
  if (
    storeStats.layerCount !== LAYER_COUNT
    || storeStats.currentTileCount !== EXACT_TILE_COUNT
    || storeStats.distinctBufferCount !== EXACT_TILE_COUNT
    || storeStats.residentBytes !== EXACT_RESIDENT_BYTES
  ) {
    throw new Error(`${definition.id}: exact 200-tile/200MiB store invariant failed`);
  }

  const sentinel = await acquireStudioGpuDevice();
  if (!sentinel) throw new Error(`${definition.id}: StudioGpuFabric unavailable`);
  const canvas = document.createElement("canvas");
  canvas.dataset.studioPrimarySurfaceOwner = "tiledoc-webgpu";
  canvas.dataset.studioTiledocBenchmark = definition.id;
  document.body.append(canvas);
  const lossEvents: Array<Record<string, unknown>> = [];
  const handoffs: Array<Record<string, unknown>> = [];
  const runtime = new StudioTileDocWebGpuRuntime({
    canvas,
    store,
    onDeviceLost: (info) => lossEvents.push({ reason: info.reason, message: info.message }),
    onCanvas2dHandoff: (handoff) => handoffs.push({ ...handoff }),
  });
  const resized = runtime.resize({ cssWidth: 512, cssHeight: 512, devicePixelRatio: 1 });
  if (resized.status !== "resized") throw new Error(`${definition.id}: initial resize rejected`);

  const firstViewport = definition.cameraRects[0]!;
  const coldMs = await present(runtime, `${definition.id}:cold`, firstViewport, allLayers);
  const initialized = consumerStats(runtime);
  const sharedDevice = initialized.deviceOwnership === "studio-gpu-fabric"
    && initialized.deviceEpoch === sentinel.epoch
    && activeStudioGpuDeviceLeaseCount() === 2;

  // Make every sparse composite/source resident before interactive timing. The exact cold upload
  // remains in cumulative counters and is reported separately.
  for (let index = 0; index < definition.cameraRects.length; index += 1) {
    await present(
      runtime,
      `${definition.id}:pan-warm:${index}`,
      definition.cameraRects[index]!,
      allLayers
    );
  }
  const afterWarm = consumerStats(runtime);

  const panBefore = afterWarm;
  const panSamples: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const viewport = definition.cameraRects[index % definition.cameraRects.length]!;
    panSamples.push(await present(runtime, `${definition.id}:pan:${index}`, viewport, allLayers));
    peakJsHeapBytes = Math.max(peakJsHeapBytes, usedHeap());
  }
  const panAfter = consumerStats(runtime);

  await present(runtime, `${definition.id}:edit-warm`, firstViewport, allLayers);
  const editBefore = consumerStats(runtime);
  const editSamples: number[] = [];
  const [editColumn, editRow] = definition.coordinatesForLayer(0)[0]!;
  for (let index = 0; index < SAMPLES; index += 1) {
    const started = performance.now();
    const write = store.writeTile(
      allLayers[0]!.id,
      editColumn,
      editRow,
      markerWriter(index & 0xff, (index * 3) & 0xff)
    );
    if (write.status !== "written") throw new Error(`${definition.id}: edit ${index} failed`);
    const result = await runtime.requestFrame({
      frameId: `${definition.id}:edit:${index}`,
      viewport: firstViewport,
      layers: allLayers,
    });
    if (result.status !== "ready") throw new Error(`${definition.id}: edit frame failed`);
    editSamples.push(performance.now() - started);
    peakJsHeapBytes = Math.max(peakJsHeapBytes, usedHeap());
  }
  const editAfter = consumerStats(runtime);

  const reversedLayers = [...allLayers].reverse();
  await present(runtime, `${definition.id}:reorder-warm:a`, firstViewport, allLayers);
  await present(runtime, `${definition.id}:reorder-warm:b`, firstViewport, reversedLayers);
  const reorderBefore = consumerStats(runtime);
  const reorderSamples: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    reorderSamples.push(await present(
      runtime,
      `${definition.id}:reorder:${index}`,
      firstViewport,
      index % 2 === 0 ? allLayers : reversedLayers
    ));
    peakJsHeapBytes = Math.max(peakJsHeapBytes, usedHeap());
  }
  const reorderAfter = consumerStats(runtime);

  const resizeSamples: number[] = [];
  const resizeDefinitions = [
    { cssWidth: 640, cssHeight: 384, devicePixelRatio: 1 },
    { cssWidth: 384, cssHeight: 640, devicePixelRatio: 1 },
    { cssWidth: 512, cssHeight: 512, devicePixelRatio: 2 },
    { cssWidth: 768, cssHeight: 512, devicePixelRatio: 1 },
    { cssWidth: 512, cssHeight: 768, devicePixelRatio: 1 },
    { cssWidth: 512, cssHeight: 512, devicePixelRatio: 1 },
  ] as const;
  for (let index = 0; index < resizeDefinitions.length; index += 1) {
    const started = performance.now();
    const outcome = runtime.resize(resizeDefinitions[index]!);
    if (outcome.status !== "resized") throw new Error(`${definition.id}: resize rejected`);
    await present(runtime, `${definition.id}:resize:${index}`, firstViewport, allLayers);
    resizeSamples.push(performance.now() - started);
  }
  const resizeStats = runtime.stats();

  const epochBeforeLoss = consumerStats(runtime).deviceEpoch;
  const deviceLossCountBefore = runtime.stats().deviceLossCount;
  sentinel.release();
  disposeStudioGpuFabric();
  await waitFor(
    () => runtime.stats().deviceLossCount > deviceLossCountBefore,
    10_000,
    `${definition.id}: device loss was not observed`
  );
  await waitFor(
    () => {
      const stats = runtime.stats();
      return stats.status === "ready"
        && (stats.consumer?.deviceEpoch ?? 0) > epochBeforeLoss;
    },
    20_000,
    `${definition.id}: shared-device recovery did not present`
  );
  const recoveryStats = runtime.stats();
  const recoverySentinel = await acquireStudioGpuDevice();
  if (!recoverySentinel) throw new Error(`${definition.id}: recovered fabric lease unavailable`);
  const recoveredConsumer = consumerStats(runtime);
  const recoveryPassed = recoveredConsumer.deviceEpoch === recoverySentinel.epoch
    && recoveredConsumer.deviceEpoch > epochBeforeLoss
    && activeStudioGpuDeviceLeaseCount() === 2
    && recoveryStats.status === "ready";

  // Quality readback is explicitly after every timed scenario and after device-loss recovery.
  await present(runtime, `${definition.id}:quality`, firstViewport, allLayers);
  const qualityBefore = consumerStats(runtime);
  const readbackA = await runtime.readbackRetainedTileForValidation("0:0");
  const readbackB = await runtime.readbackRetainedTileForValidation("0:0");
  if (!readbackA || !readbackB) throw new Error(`${definition.id}: validation readback unavailable`);
  const digestA = await sha256(readbackA.bytes);
  const digestB = await sha256(readbackB.bytes);
  const actual = readHalfPixel(readbackA.bytes, readbackA.bytesPerRow, 0, 0);
  const transparent = readHalfPixel(readbackA.bytes, readbackA.bytesPerRow, 1, 0);
  const topLayerIndex = LAYER_COUNT - 1;
  const expectedRed = (topLayerIndex * 37 + editColumn) & 0xff;
  const expectedGreen = (topLayerIndex * 17 + editRow) & 0xff;
  const expectedBlue = expectedRed ^ expectedGreen;
  const expected = [
    srgbToLinear(expectedRed),
    srgbToLinear(expectedGreen),
    srgbToLinear(expectedBlue),
    1,
  ];
  const channelDeltas = actual.map((value, index) => Math.abs(value - expected[index]!));
  const maxLinearDelta = Math.max(...channelDeltas);
  const qualityAfter = consumerStats(runtime);
  const qualityPassed = digestA === digestB
    && maxLinearDelta <= QUALITY_MAX_LINEAR_DELTA
    && transparent.every((value) => Math.abs(value) <= QUALITY_MAX_LINEAR_DELTA)
    && qualityAfter.hotPathReadbackCount === 0
    && qualityAfter.validationReadbackCount - qualityBefore.validationReadbackCount === 2;

  const finalStats = runtime.stats();
  const primarySurfaceCount = document.querySelectorAll(
    '[data-studio-primary-surface-owner="tiledoc-webgpu"]'
  ).length;
  const pan = summarize(panSamples);
  const edit = summarize(editSamples);
  const reorder = summarize(reorderSamples);
  const interactionPassed = [pan, edit, reorder].every((summary) => (
    summary.sampleCount === SAMPLES
    && summary.p95Ms <= INTERACTION_P95_GATE_MS
    && summary.p99Ms <= INTERACTION_P99_GATE_MS
  ));
  const finalConsumer = consumerStats(runtime);
  const cacheLookups = finalConsumer.retainedCacheHits + finalConsumer.retainedCacheMisses;
  const cacheHitRatio = cacheLookups === 0 ? 0 : finalConsumer.retainedCacheHits / cacheLookups;
  const browserMemoryAfter = memoryNow();
  const userAgentSpecificMemory = await userAgentMemory();
  const result = {
    id: definition.id,
    dimensions: { width: definition.width, height: definition.height },
    exactWorkload: {
      layerCount: LAYER_COUNT,
      tileSize: TILE_SIZE,
      exactTileCount: storeStats.currentTileCount,
      expectedTileCount: EXACT_TILE_COUNT,
      exactResidentBytes: storeStats.residentBytes,
      expectedResidentBytes: EXACT_RESIDENT_BYTES,
      bytesPerTile: TILE_BYTES,
      proxyOrReductionUsed: false,
      buildMs: round(built.buildMs),
    },
    device: {
      ownership: initialized.deviceOwnership,
      initialEpoch: initialized.deviceEpoch,
      sentinelEpoch: sentinel.epoch,
      sharedDevice,
      activeLeasesAfterInitialization: 2,
      lossEvents,
      handoffs,
    },
    coldPresentationMs: round(coldMs),
    warmup: {
      viewportCount: definition.cameraRects.length,
      cumulativeStats: afterWarm,
    },
    scenarios: {
      panZoom: {
        distribution: pan,
        all100LayersVisible: true,
        viewportVariantCount: definition.cameraRects.length,
        counters: counterDelta(panBefore, panAfter),
      },
      edit: {
        distribution: edit,
        activeLayerIsolation: false,
        declaredLayerCount: allLayers.length,
        visibleLayerCount: allLayers.length,
        counters: counterDelta(editBefore, editAfter),
      },
      reorder: {
        distribution: reorder,
        declaredLayerCount: allLayers.length,
        visibleLayerCount: allLayers.length,
        counters: counterDelta(reorderBefore, reorderAfter),
      },
      resize: {
        distribution: summarize(resizeSamples),
        requests: resizeDefinitions,
        finalBackingWidth: resizeStats.backingWidth,
        finalBackingHeight: resizeStats.backingHeight,
        passed: resizeStats.backingWidth === 512 && resizeStats.backingHeight === 512,
      },
    },
    residency: {
      sourceCacheEntries: finalConsumer.sourceCacheEntries,
      sourceCacheBytes: finalConsumer.sourceCacheBytes,
      retainedEntries: finalConsumer.retainedEntries,
      retainedBytes: finalConsumer.retainedBytes,
      trackedGpuBytes: finalConsumer.trackedGpuBytes,
      peakTrackedGpuBytes: finalConsumer.peakTrackedGpuBytes,
      browserExposedGpuAllocationBytes: null,
      browserGpuMemoryReason: "WebGPU does not expose total allocation bytes",
      retainedCacheHits: finalConsumer.retainedCacheHits,
      retainedCacheMisses: finalConsumer.retainedCacheMisses,
      retainedCacheHitRatio: round(cacheHitRatio, 6),
      sourceCacheHits: finalConsumer.sourceCacheHits,
      sourceCacheMisses: finalConsumer.sourceCacheMisses,
      sourceCacheEvictions: finalConsumer.sourceCacheEvictions,
      compositeCacheReuses: finalConsumer.compositeCacheReuses,
    },
    upload: {
      sourceUploadCount: finalConsumer.sourceUploadCount,
      sourcePayloadBytesUploaded: finalConsumer.sourcePayloadBytesUploaded,
      physicalBytesUploaded: finalConsumer.physicalBytesUploaded,
    },
    readback: {
      hotPathReadbackCount: finalConsumer.hotPathReadbackCount,
      validationReadbackCount: finalConsumer.validationReadbackCount,
      validationReadbackBytes: finalConsumer.validationReadbackBytes,
      timingScope: "validation readbacks executed after all interaction timing",
    },
    quality: {
      tileId: "0:0",
      format: readbackA.format,
      digestA,
      digestB,
      deterministic: digestA === digestB,
      expectedLinearPremultipliedRgba: expected.map((value) => round(value, 8)),
      actualLinearPremultipliedRgba: actual.map((value) => round(value, 8)),
      channelDeltas: channelDeltas.map((value) => round(value, 8)),
      maxLinearDelta: round(maxLinearDelta, 8),
      transparentProbe: transparent.map((value) => round(value, 8)),
      gate: QUALITY_MAX_LINEAR_DELTA,
      passed: qualityPassed,
    },
    recovery: {
      epochBeforeLoss,
      epochAfterLoss: recoveredConsumer.deviceEpoch,
      recoverySentinelEpoch: recoverySentinel.epoch,
      deviceLossCount: recoveryStats.deviceLossCount,
      recoveryAttempts: recoveryStats.recoveryAttempts,
      status: recoveryStats.status,
      passed: recoveryPassed,
    },
    ownership: {
      onePrimarySurface: primarySurfaceCount === 1,
      primarySurfaceCount,
      productIsland: "CRDT raster document",
      velloIsland: "selection overlay only",
    },
    memory: {
      before: memoryBefore,
      after: browserMemoryAfter,
      peakObservedJsHeapBytes: peakJsHeapBytes,
      userAgentSpecific: userAgentSpecificMemory,
      wasmUsed: false,
      wasmMemoryBytes: 0,
    },
    runtime: finalStats,
    gates: {
      exactWorkloadPassed: storeStats.residentBytes === EXACT_RESIDENT_BYTES,
      sharedDevicePassed: sharedDevice,
      interactionPassed,
      resizePassed: resizeStats.backingWidth === 512 && resizeStats.backingHeight === 512,
      deviceRecoveryPassed: recoveryPassed,
      onePrimarySurfacePassed: primarySurfaceCount === 1,
      hotPathReadbackPassed: finalConsumer.hotPathReadbackCount === 0,
      qualityPassed,
    },
  };
  recoverySentinel.release();
  runtime.dispose();
  store.dispose();
  canvas.remove();
  disposeStudioGpuFabric();
  return result;
}

async function run(): Promise<void> {
  const cspViolations: Array<Record<string, unknown>> = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    cspViolations.push({
      effectiveDirective: event.effectiveDirective,
      blockedUri: event.blockedURI,
      disposition: event.disposition,
    });
  });
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
    ?? null;
  if (!adapter) {
    (window as unknown as Record<string, unknown>)[RESULT_GLOBAL] = {
      schemaVersion: 1,
      status: "unsupported",
      pass: false,
      reason: "Chromium did not expose a WebGPU adapter",
    };
    return;
  }
  const definitions: readonly CaseDefinition[] = [
    {
      id: "8k-100-layer",
      width: 8192,
      height: 8192,
      coordinatesForLayer: () => [[0, 0], [15, 15]],
      cameraRects: [
        { x: 0, y: 0, width: 512, height: 512 },
        { x: 7680, y: 7680, width: 512, height: 512 },
        { x: 0, y: 0, width: 1024, height: 1024 },
      ],
    },
    {
      id: "webtoon-30720-100-layer",
      width: 2048,
      height: 30720,
      coordinatesForLayer: (index) => [
        [0, 0],
        [index % 4, ((index * 17) % 59) + 1],
      ],
      cameraRects: Array.from({ length: 60 }, (_, row) => ({
        x: 0,
        y: row * 512,
        width: 1024,
        height: 512,
      })),
    },
  ];
  const cases: Array<Record<string, unknown>> = [];
  for (const definition of definitions) {
    cases.push(await runCase(definition));
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const pass = cases.every((candidate) => {
    const gates = candidate.gates as Record<string, unknown>;
    return Object.values(gates).every((value) => value === true);
  }) && cspViolations.length === 0;
  (window as unknown as Record<string, unknown>)[RESULT_GLOBAL] = {
    schemaVersion: 1,
    status: pass ? "ok" : "failed",
    pass,
    execution: "vite-production-build-chromium-metal-webgpu",
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: globalThis.isSecureContext,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      webGpuExposed: !!navigator.gpu,
    },
    adapter: adapterInfoShape(adapter),
    configuration: {
      exactLayerCount: LAYER_COUNT,
      exactTileCount: EXACT_TILE_COUNT,
      exactResidentBytes: EXACT_RESIDENT_BYTES,
      samplesPerInteractiveScenario: SAMPLES,
      interactionP95GateMs: INTERACTION_P95_GATE_MS,
      interactionP99GateMs: INTERACTION_P99_GATE_MS,
      qualityMaxLinearDelta: QUALITY_MAX_LINEAR_DELTA,
    },
    cases,
    cspViolations,
  };
}

run().catch((error) => {
  (window as unknown as Record<string, unknown>)[RESULT_GLOBAL] = {
    schemaVersion: 1,
    status: "error",
    pass: false,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack ?? null }
      : { name: "NonError", message: String(error) },
  };
});
