import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { decodePng } from "image-js";

import { studioBrushPresetUsesIntentionalDiscreteCarrier } from "../apps/web/src/domains/creator/brush/studio-brush-carrier-quality";
import {
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import {
  STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION,
  electStudioBrushGpuQuality,
  type StudioBrushCrossEngineQualityEvidence,
  type StudioBrushGpuExecutionEvidence,
  type StudioBrushGpuQualityPolicyKind,
  type StudioBrushLongStrokePerformanceEvidence,
  type StudioBrushLongStrokeQualityEvidence,
} from "../apps/web/src/domains/creator/brush/studio-brush-gpu-quality-election";
import {
  STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MAX_AGE_MS,
} from "../apps/web/src/domains/creator/brush/studio-brush-gpu-quality-evidence";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeStudioBrushCatalogSelection } from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { classifyStudioDryMediaCatalogIdV1 } from "../apps/web/src/domains/creator/brush/studio-dry-media-anisotropic-grain-v1";
import { studioWetInkBrushDepositsPigment } from "../apps/web/src/domains/creator/brush/studio-wet-ink-brush-runtime";
import { studioCc0MypaintPresetUsesIntentionalDiscreteCarrier } from "../apps/web/src/domains/creator/studio-cc0-mypaint-preset-import-v1";

import {
  classifyStudioLongBrushQualityPolicy,
} from "./studio-brush-long-matrix-quality";

const INPUT_ROOT = process.env.TOONSPECTRUM_ALL_BRUSH_INPUT_DIR
  ?? "artifacts/all-brush-long-stroke";
const OUTPUT_ROOT = process.env.TOONSPECTRUM_ALL_BRUSH_AGGREGATE_DIR
  ?? "artifacts/all-brush-long-stroke-aggregate";
const GENERATED_EVIDENCE_PATH = process.env.TOONSPECTRUM_GPU_EVIDENCE_OUTPUT
  ?? "apps/web/src/domains/creator/brush/studio-brush-gpu-quality-evidence.generated.ts";
const PIXEL_THRESHOLD = 8;
const PROFILE_BINS = 64;
const HISTOGRAM_BINS = 32;

interface ShardCaseResult {
  readonly id: string;
  readonly name: string;
  readonly operation: StudioBrushCatalogItem["operation"];
  readonly mediaGroup: StudioBrushCatalogItem["mediaGroup"];
  readonly source: StudioBrushCatalogItem["source"];
  readonly reportPath: string;
  readonly reportExists: boolean;
  readonly timedOut: boolean;
}

interface ShardReport {
  readonly mode: "baseline" | "gpu";
  readonly results: readonly ShardCaseResult[];
}

interface LongStrokeAssertion {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface LongStrokeReport {
  readonly ok?: boolean;
  readonly fatal?: string;
  readonly brush?: { readonly name?: string | null; readonly width?: number };
  readonly paper?: {
    readonly clip?: { readonly width?: number; readonly height?: number };
    readonly localPathPoints?: readonly { readonly x: number; readonly y: number }[];
  };
  readonly parity?: {
    readonly inputDeliveryRatio?: number;
    readonly diffs?: {
      readonly liveVsCommitted?: {
        readonly changedPixels?: number;
        readonly width?: number;
        readonly height?: number;
        readonly regions?: Readonly<Record<string, { readonly changed?: number; readonly pixels?: number }>>;
      };
      readonly committed300VsSettled900?: {
        readonly changedPixels?: number;
        readonly width?: number;
        readonly height?: number;
      };
    };
  };
  readonly perf?: {
    readonly inputDeliveryRatio?: number;
    readonly drawMilliseconds?: number;
    readonly frames?: {
      readonly p50?: number;
      readonly p95?: number;
      readonly p99?: number;
      readonly max?: number;
      readonly longTaskCount?: number;
      readonly longTaskTotalMs?: number;
    };
  };
  readonly memory?: "unavailable" | {
    readonly beforePointerDown?: number;
    readonly afterUndoIdle?: number;
  };
  readonly assertions?: readonly LongStrokeAssertion[];
  readonly browserErrors?: {
    readonly console?: readonly unknown[];
    readonly page?: readonly unknown[];
    readonly unhandledRejections?: number;
  };
  readonly surfaceEvidence?: {
    readonly gpuEverActive?: boolean;
    readonly gpuEverAuthorized?: boolean;
    readonly gpuSurfaceKinds?: readonly string[];
    readonly refusedStrokeNotices?: number;
  };
  readonly gpuAdapter?: {
    readonly available?: boolean;
    readonly adapterClass?: "hardware" | "software" | "unknown" | "unavailable";
    readonly isFallbackAdapter?: boolean | null;
    readonly adapterFingerprint?: string | null;
  };
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

interface DeltaAnalysis {
  readonly field: Uint8Array;
  readonly mask: Uint8Array;
  readonly visiblePixels: number;
  readonly inkEnergy: number;
  readonly edgeDensity: number;
  readonly gradientEnergy: number;
  readonly histogram: readonly number[];
  readonly horizontalProfile: readonly number[];
  readonly verticalProfile: readonly number[];
  readonly bounds: { left: number; top: number; right: number; bottom: number } | null;
  readonly centroid: { x: number; y: number } | null;
}

interface LocatedCase {
  readonly metadata: ShardCaseResult;
  readonly report: LongStrokeReport | null;
  readonly caseRoot: string;
  readonly imagePaths: Readonly<{
    blank: string;
    live: string;
    committed: string;
    settled: string;
  }>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function walkFiles(root: string, targetName: string, output: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, targetName, output);
    else if (entry === targetName) output.push(path);
  }
  return output;
}

function parseJson<Value>(path: string): Value {
  return JSON.parse(readFileSync(path, "utf8")) as Value;
}

function locateCases(): Map<string, Map<"baseline" | "gpu", LocatedCase>> {
  const cases = new Map<string, Map<"baseline" | "gpu", LocatedCase>>();
  for (const shardPath of walkFiles(INPUT_ROOT, "shard-report.json")) {
    const shard = parseJson<ShardReport>(shardPath);
    if (shard.mode !== "baseline" && shard.mode !== "gpu") continue;
    const shardDirectory = dirname(shardPath);
    for (const metadata of shard.results) {
      const originalCaseRoot = dirname(dirname(metadata.reportPath));
      const caseDirectoryName = basename(originalCaseRoot);
      const caseRoot = join(shardDirectory, caseDirectoryName, "studio-long-stroke");
      const reportPath = join(caseRoot, "report.json");
      let report: LongStrokeReport | null;
      try {
        report = parseJson<LongStrokeReport>(reportPath);
      } catch {
        report = null;
      }
      const byMode = cases.get(metadata.id) ?? new Map();
      invariant(!byMode.has(shard.mode), `${metadata.id}: duplicate ${shard.mode} measurement`);
      byMode.set(shard.mode, {
        metadata,
        report,
        caseRoot,
        imagePaths: {
          blank: join(caseRoot, "00-blank.png"),
          live: join(caseRoot, "01-live.png"),
          committed: join(caseRoot, "02-committed.png"),
          settled: join(caseRoot, "03-settled.png"),
        },
      });
      cases.set(metadata.id, byMode);
    }
  }
  return cases;
}

function decode(path: string): DecodedImage {
  const bytes = readFileSync(path);
  const image = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return {
    width: image.width,
    height: image.height,
    channels: image.channels,
    data: image.getRawImage().data as Uint8Array,
  };
}

function assertCompatible(...images: readonly DecodedImage[]): void {
  const first = images[0];
  invariant(first, "no image supplied");
  for (const image of images) {
    invariant(
      image.width === first.width
      && image.height === first.height
      && image.channels >= 3
      && image.data.length >= image.width * image.height * image.channels,
      "benchmark images are not dimensionally compatible",
    );
  }
}

function deltaAnalysis(blank: DecodedImage, frame: DecodedImage): DeltaAnalysis {
  assertCompatible(blank, frame);
  const pixels = blank.width * blank.height;
  const field = new Uint8Array(pixels);
  const mask = new Uint8Array(pixels);
  const horizontal = new Array<number>(PROFILE_BINS).fill(0);
  const vertical = new Array<number>(PROFILE_BINS).fill(0);
  const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  let visiblePixels = 0;
  let inkEnergy = 0;
  let weightedX = 0;
  let weightedY = 0;
  let left = blank.width;
  let top = blank.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < blank.height; y += 1) {
    for (let x = 0; x < blank.width; x += 1) {
      const pixel = y * blank.width + x;
      const a = pixel * blank.channels;
      const b = pixel * frame.channels;
      const delta = Math.max(
        Math.abs((blank.data[a] ?? 0) - (frame.data[b] ?? 0)),
        Math.abs((blank.data[a + 1] ?? 0) - (frame.data[b + 1] ?? 0)),
        Math.abs((blank.data[a + 2] ?? 0) - (frame.data[b + 2] ?? 0)),
      );
      field[pixel] = delta;
      if (delta <= PIXEL_THRESHOLD) continue;
      mask[pixel] = 1;
      visiblePixels += 1;
      inkEnergy += delta;
      weightedX += x * delta;
      weightedY += y * delta;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      horizontal[Math.min(PROFILE_BINS - 1, Math.floor(x * PROFILE_BINS / blank.width))] += delta;
      vertical[Math.min(PROFILE_BINS - 1, Math.floor(y * PROFILE_BINS / blank.height))] += delta;
      histogram[Math.min(HISTOGRAM_BINS - 1, Math.floor(delta * HISTOGRAM_BINS / 256))] += 1;
    }
  }
  let gradientEnergy = 0;
  let edgePixels = 0;
  for (let y = 1; y + 1 < blank.height; y += 1) {
    for (let x = 1; x + 1 < blank.width; x += 1) {
      const pixel = y * blank.width + x;
      if (mask[pixel] === 0) continue;
      const gx = Math.abs(field[pixel + 1]! - field[pixel - 1]!);
      const gy = Math.abs(field[pixel + blank.width]! - field[pixel - blank.width]!);
      const gradient = gx + gy;
      gradientEnergy += gradient;
      if (gradient > 16) edgePixels += 1;
    }
  }
  const normalize = (values: number[]): readonly number[] => {
    const sum = values.reduce((total, value) => total + value, 0);
    return Object.freeze(values.map((value) => sum > 0 ? value / sum : 0));
  };
  return {
    field,
    mask,
    visiblePixels,
    inkEnergy,
    edgeDensity: visiblePixels > 0 ? edgePixels / visiblePixels : 0,
    gradientEnergy,
    histogram: normalize(histogram),
    horizontalProfile: normalize(horizontal),
    verticalProfile: normalize(vertical),
    bounds: right >= left && bottom >= top ? { left, top, right, bottom } : null,
    centroid: inkEnergy > 0 ? { x: weightedX / inkEnergy, y: weightedY / inkEnergy } : null,
  };
}

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = (left[index] ?? 0) - leftMean;
    const b = (right[index] ?? 0) - rightMean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  if (leftVariance <= 1e-15 || rightVariance <= 1e-15) {
    return left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= 1e-12) ? 1 : 0;
  }
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function safeRatio(candidate: number, baseline: number): number {
  if (baseline <= 0) return candidate <= 0 ? 1 : Number.POSITIVE_INFINITY;
  return candidate / baseline;
}

function histogramIntersection(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    total += Math.min(left[index] ?? 0, right[index] ?? 0);
  }
  return total;
}

function crossEngineQuality(
  baseline: DeltaAnalysis,
  gpu: DeltaAnalysis,
  baselineCommitted: DecodedImage,
  gpuCommitted: DecodedImage,
): StudioBrushCrossEngineQualityEvidence {
  assertCompatible(baselineCommitted, gpuCommitted);
  let intersection = 0;
  let union = 0;
  let changed = 0;
  for (let pixel = 0; pixel < baseline.mask.length; pixel += 1) {
    const aMask = baseline.mask[pixel] === 1;
    const bMask = gpu.mask[pixel] === 1;
    if (aMask && bMask) intersection += 1;
    if (!aMask && !bMask) continue;
    union += 1;
    const a = pixel * baselineCommitted.channels;
    const b = pixel * gpuCommitted.channels;
    const delta = Math.max(
      Math.abs((baselineCommitted.data[a] ?? 0) - (gpuCommitted.data[b] ?? 0)),
      Math.abs((baselineCommitted.data[a + 1] ?? 0) - (gpuCommitted.data[b + 1] ?? 0)),
      Math.abs((baselineCommitted.data[a + 2] ?? 0) - (gpuCommitted.data[b + 2] ?? 0)),
    );
    if (delta > PIXEL_THRESHOLD) changed += 1;
  }
  const diagonal = Math.hypot(baselineCommitted.width, baselineCommitted.height) || 1;
  const boundsDrift = baseline.bounds && gpu.bounds
    ? Math.max(
        Math.abs(baseline.bounds.left - gpu.bounds.left),
        Math.abs(baseline.bounds.top - gpu.bounds.top),
        Math.abs(baseline.bounds.right - gpu.bounds.right),
        Math.abs(baseline.bounds.bottom - gpu.bounds.bottom),
      ) / diagonal
    : baseline.bounds === gpu.bounds ? 0 : 1;
  const centroidDrift = baseline.centroid && gpu.centroid
    ? Math.hypot(
        baseline.centroid.x - gpu.centroid.x,
        baseline.centroid.y - gpu.centroid.y,
      ) / diagonal
    : baseline.centroid === gpu.centroid ? 0 : 1;
  return {
    comparedPixels: baseline.mask.length,
    changedInkRatio: union > 0 ? changed / union : 1,
    silhouetteIntersectionOverUnion: union > 0 ? intersection / union : 0,
    inkEnergyRatio: safeRatio(gpu.inkEnergy, baseline.inkEnergy),
    edgeDensityRatio: safeRatio(gpu.edgeDensity, baseline.edgeDensity),
    gradientEnergyRatio: safeRatio(gpu.gradientEnergy, baseline.gradientEnergy),
    luminanceHistogramIntersection: histogramIntersection(baseline.histogram, gpu.histogram),
    horizontalProfileCorrelation: correlation(baseline.horizontalProfile, gpu.horizontalProfile),
    verticalProfileCorrelation: correlation(baseline.verticalProfile, gpu.verticalProfile),
    normalizedBoundsDrift: boundsDrift,
    normalizedCentroidDrift: centroidDrift,
  };
}

function transitionRatio(report: LongStrokeReport, region: "firstHalf" | "whole"): number {
  const diff = report.parity?.diffs?.liveVsCommitted;
  if (region === "firstHalf") {
    const first = diff?.regions?.firstHalf;
    return finite(first?.pixels) > 0 ? finite(first?.changed) / finite(first?.pixels) : 1;
  }
  return finite(diff?.width) * finite(diff?.height) > 0
    ? finite(diff?.changedPixels) / (finite(diff?.width) * finite(diff?.height))
    : 1;
}

function settleRatio(report: LongStrokeReport): number {
  const diff = report.parity?.diffs?.committed300VsSettled900;
  const pixels = finite(diff?.width) * finite(diff?.height);
  return pixels > 0 ? finite(diff?.changedPixels) / pixels : 1;
}

function performanceEvidence(report: LongStrokeReport | null): StudioBrushLongStrokePerformanceEvidence {
  const perf = report?.perf;
  const memory = report?.memory;
  const heapGrowthBytes = memory && memory !== "unavailable"
    && typeof memory.beforePointerDown === "number"
    && typeof memory.afterUndoIdle === "number"
      ? memory.afterUndoIdle - memory.beforePointerDown
      : null;
  return {
    drawMilliseconds: finite(perf?.drawMilliseconds, Number.POSITIVE_INFINITY),
    frameP50Milliseconds: finite(perf?.frames?.p50, Number.POSITIVE_INFINITY),
    frameP95Milliseconds: finite(perf?.frames?.p95, Number.POSITIVE_INFINITY),
    frameP99Milliseconds: finite(perf?.frames?.p99 ?? perf?.frames?.max, Number.POSITIVE_INFINITY),
    longTaskCount: finite(perf?.frames?.longTaskCount, Number.POSITIVE_INFINITY),
    longTaskTotalMilliseconds: finite(perf?.frames?.longTaskTotalMs, Number.POSITIVE_INFINITY),
    inputDeliveryRatio: finite(perf?.inputDeliveryRatio),
    heapGrowthBytes,
  };
}

function ownQualityPassed(report: LongStrokeReport | null): boolean {
  if (!report || report.fatal || !Array.isArray(report.assertions)) return false;
  const performanceAssertions = new Set([
    "frame-time-p95",
    "long-tasks",
    "perf-input-delivery-ratio",
    "heap-after-release",
  ]);
  return report.assertions
    .filter((assertion) => !performanceAssertions.has(assertion.id))
    .every((assertion) => assertion.ok);
}

function qualityEvidence(
  report: LongStrokeReport | null,
  analysis: DeltaAnalysis | null,
): StudioBrushLongStrokeQualityEvidence {
  const browserErrors = report?.browserErrors;
  const errorCount = (browserErrors?.console?.length ?? 0)
    + (browserErrors?.page?.length ?? 0)
    + finite(browserErrors?.unhandledRejections);
  const surface = report?.surfaceEvidence;
  return {
    measured: Boolean(report && analysis && !report.fatal),
    ownQualityPassed: ownQualityPassed(report),
    browserErrorCount: errorCount,
    refusedStrokeCount: finite(surface?.refusedStrokeNotices),
    gpuSurfaceObserved: surface?.gpuEverActive === true
      && surface?.gpuEverAuthorized === true
      && (surface.gpuSurfaceKinds?.length ?? 0) > 0,
    liveToCommittedChangedRatio: report ? transitionRatio(report, "firstHalf") : 1,
    committedToSettledChangedRatio: report ? settleRatio(report) : 1,
    centerlineCoverage: report?.assertions?.find((entry) => entry.id === "committed-path-length")?.ok
      ? 1
      : 0,
    visiblePixels: analysis?.visiblePixels ?? 0,
    inkEnergy: analysis?.inkEnergy ?? 0,
    edgeDensity: analysis?.edgeDensity ?? 0,
  };
}

function gpuExecutionEvidence(
  report: LongStrokeReport | null,
): StudioBrushGpuExecutionEvidence {
  const adapter = report?.gpuAdapter;
  const adapterClass = adapter?.adapterClass;
  return {
    adapterClass: adapterClass === "hardware"
      || adapterClass === "software"
      || adapterClass === "unknown"
      || adapterClass === "unavailable"
        ? adapterClass
        : "unavailable",
    isFallbackAdapter: typeof adapter?.isFallbackAdapter === "boolean"
      ? adapter.isFallbackAdapter
      : null,
    adapterFingerprint: typeof adapter?.adapterFingerprint === "string"
      && adapter.adapterFingerprint.length > 0
        ? adapter.adapterFingerprint
        : null,
  };
}

async function qualityPolicy(item: StudioBrushCatalogItem): Promise<StudioBrushGpuQualityPolicyKind> {
  if (item.operation === "erase") return "eraser";
  const selection = await materializeStudioBrushCatalogSelection(item.id);
  if (!selection) return "record-only-transparent";
  const descriptor = studioBrushPackDescriptorById(item.id);
  const dryMedia = classifyStudioDryMediaCatalogIdV1(item.id);
  const intentionalDiscrete = dryMedia
    ? dryMedia.kind === "intentional-discrete"
    : descriptor
      ? studioBrushPresetUsesIntentionalDiscreteCarrier(descriptor)
      : studioCc0MypaintPresetUsesIntentionalDiscreteCarrier(item.id);
  return classifyStudioLongBrushQualityPolicy({
    id: item.id,
    source: item.source,
    runtimeBrushId: selection.runtimeBrushId,
    mediaGroup: item.mediaGroup,
    previewStyle: item.previewStyle,
    intentionalDiscrete,
    depositsPigment: studioWetInkBrushDepositsPigment(selection.runtimeBrushId),
  }).kind;
}

function generatedEvidenceSource(input: Readonly<{
  generatedAt: string;
  expiresAt: string;
  sourceCommit: string | null;
  digest: string;
  measurementRunCount: number;
  measuredBrushCount: number;
  hardwareAdapterFingerprints: readonly string[];
  approved: readonly string[];
  rejected: readonly string[];
}>): string {
  const literal = (values: readonly string[]) => JSON.stringify(values, null, 2)
    .split("\n")
    .map((line, index) => index === 0 ? line : `  ${line}`)
    .join("\n");
  return `/** Generated by scripts/aggregate-studio-all-brush-long-stroke.mts. */\n`
    + `export const STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_SCHEMA_VERSION = 2 as const;\n`
    + `export const STUDIO_BRUSH_GPU_QUALITY_EVIDENCE = Object.freeze({\n`
    + `  schemaVersion: STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_SCHEMA_VERSION,\n`
    + `  rendererContractVersion: ${STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION},\n`
    + `  generatedAt: ${JSON.stringify(input.generatedAt)},\n`
    + `  expiresAt: ${JSON.stringify(input.expiresAt)},\n`
    + `  sourceCommit: ${JSON.stringify(input.sourceCommit)},\n`
    + `  benchmarkDigest: ${JSON.stringify(input.digest)},\n`
    + `  measurementRunCount: ${input.measurementRunCount},\n`
    + `  measuredBrushCount: ${input.measuredBrushCount},\n`
    + `  hardwareClass: ${input.hardwareAdapterFingerprints.length > 0 ? '"hardware"' : 'null'} as "hardware" | null,\n`
    + `  hardwareAdapterFingerprints: Object.freeze(${literal(input.hardwareAdapterFingerprints)} as string[]),\n`
    + `  approvedBrushIds: Object.freeze(${literal(input.approved)} as string[]),\n`
    + `  rejectedBrushIds: Object.freeze(${literal(input.rejected)} as string[]),\n`
    + `});\n`;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const located = locateCases();
  invariant(
    located.size === STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    `located ${located.size}/${STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length} listed brushes`,
  );
  const cases = [];
  for (const item of STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS) {
    const pair = located.get(item.id);
    const baseline = pair?.get("baseline");
    const gpu = pair?.get("gpu");
    invariant(baseline && gpu, `${item.id}: missing baseline or GPU measurement`);
    let baselineAnalysis: DeltaAnalysis | null = null;
    let gpuAnalysis: DeltaAnalysis | null = null;
    let cross: StudioBrushCrossEngineQualityEvidence = {
      comparedPixels: 0,
      changedInkRatio: 1,
      silhouetteIntersectionOverUnion: 0,
      inkEnergyRatio: Number.POSITIVE_INFINITY,
      edgeDensityRatio: Number.POSITIVE_INFINITY,
      gradientEnergyRatio: Number.POSITIVE_INFINITY,
      luminanceHistogramIntersection: 0,
      horizontalProfileCorrelation: 0,
      verticalProfileCorrelation: 0,
      normalizedBoundsDrift: 1,
      normalizedCentroidDrift: 1,
    };
    try {
      const baselineBlank = decode(baseline.imagePaths.blank);
      const baselineCommitted = decode(baseline.imagePaths.committed);
      const gpuBlank = decode(gpu.imagePaths.blank);
      const gpuCommitted = decode(gpu.imagePaths.committed);
      baselineAnalysis = deltaAnalysis(baselineBlank, baselineCommitted);
      gpuAnalysis = deltaAnalysis(gpuBlank, gpuCommitted);
      cross = crossEngineQuality(
        baselineAnalysis,
        gpuAnalysis,
        baselineCommitted,
        gpuCommitted,
      );
    } catch {
      // Election remains fail-closed with the sentinel cross-engine evidence above.
    }
    const policy = await qualityPolicy(item);
    const election = electStudioBrushGpuQuality({
      brushId: item.id,
      policy,
      baseline: {
        quality: qualityEvidence(baseline.report, baselineAnalysis),
        performance: performanceEvidence(baseline.report),
      },
      gpu: {
        quality: qualityEvidence(gpu.report, gpuAnalysis),
        performance: performanceEvidence(gpu.report),
      },
      gpuExecution: gpuExecutionEvidence(gpu.report),
      crossEngine: cross,
    });
    cases.push({
      id: item.id,
      name: item.name,
      operation: item.operation,
      mediaGroup: item.mediaGroup,
      source: item.source,
      policy,
      baseline: {
        verifierOk: baseline.report?.ok ?? false,
        quality: qualityEvidence(baseline.report, baselineAnalysis),
        performance: performanceEvidence(baseline.report),
        report: relative(INPUT_ROOT, join(baseline.caseRoot, "report.json")),
      },
      gpu: {
        verifierOk: gpu.report?.ok ?? false,
        quality: qualityEvidence(gpu.report, gpuAnalysis),
        performance: performanceEvidence(gpu.report),
        execution: gpuExecutionEvidence(gpu.report),
        report: relative(INPUT_ROOT, join(gpu.caseRoot, "report.json")),
      },
      crossEngine: cross,
      election,
    });
  }
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(generatedAt) + STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MAX_AGE_MS,
  ).toISOString();
  const sourceCommit = process.env.GITHUB_SHA ?? null;
  const hardwareAdapterFingerprints = [...new Set(cases.flatMap((entry) =>
    entry.gpu.execution.adapterClass === "hardware"
      && entry.gpu.execution.isFallbackAdapter !== true
      && entry.gpu.execution.adapterFingerprint
        ? [entry.gpu.execution.adapterFingerprint]
        : []
  ))].sort();
  // A single hosted shard sweep remains diagnostic-only. Product admission requires three
  // independent measurements on a non-fallback physical adapter.
  const measurementRunCount = 1;
  const approved = cases
    .filter((entry) => entry.election.selected === "gpu")
    .map((entry) => entry.id)
    .sort();
  const rejected = cases
    .filter((entry) => entry.election.selected !== "gpu")
    .map((entry) => entry.id)
    .sort();
  const digestPayload = JSON.stringify({ sourceCommit, cases });
  const benchmarkDigest = `sha256:${createHash("sha256").update(digestPayload).digest("hex")}`;
  const report = {
    kind: "toonspectrum-all-brush-screen-fill-gpu-election-v2",
    generatedAt,
    expiresAt,
    sourceCommit,
    rendererContractVersion: STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION,
    measurementRunCount,
    hardwareClass: hardwareAdapterFingerprints.length > 0 ? "hardware" : null,
    hardwareAdapterFingerprints,
    benchmarkDigest,
    listedBrushCount: STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    measuredBrushCount: cases.length,
    approvedBrushCount: approved.length,
    rejectedBrushCount: rejected.length,
    approvedBrushIds: approved,
    rejectedBrushIds: rejected,
    cases,
  };
  writeFileSync(join(OUTPUT_ROOT, "all-brush-gpu-quality-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const reasonCounts = new Map<string, number>();
  for (const entry of cases) {
    for (const reason of entry.election.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const markdown = [
    "# 전체 브러시 화면 충전 장획 GPU 품질·성능 비교",
    "",
    `- 측정 브러시: ${cases.length}`,
    `- GPU 품질 승인 후보: ${approved.length}`,
    `- 물리 GPU 증거: ${hardwareAdapterFingerprints.length > 0 ? hardwareAdapterFingerprints.join(", ") : "없음(진단 전용)"}`,
    `- 반복 측정: ${measurementRunCount}회 (자동 승격 최소 3회)`,
    `- 증거 만료: ${expiresAt}`,
    `- 기존 경로 유지: ${rejected.length}`,
    `- 증거 다이제스트: \`${benchmarkDigest}\``,
    "",
    "## 판정 원칙",
    "",
    "질감·형태·라이브/커밋 연속성이 먼저이며, 성능이 빨라도 품질 축 하나가 열화되면 기존 경로를 유지한다. 비폴백 물리 GPU가 확인되고 품질이 거의 동일하며 p95가 2% 이내일 때만 승격 후보가 된다. 자동 승격에는 같은 렌더 계약에서 세 번의 독립 측정이 필요하다.",
    "",
    "## 주요 기존 경로 유지 사유",
    "",
    ...[...reasonCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## GPU 승인 브러시",
    "",
    approved.length > 0 ? approved.map((id) => `- ${id}`).join("\n") : "승인 없음",
    "",
  ].join("\n");
  writeFileSync(join(OUTPUT_ROOT, "all-brush-gpu-quality-report.md"), markdown);
  writeFileSync(GENERATED_EVIDENCE_PATH, generatedEvidenceSource({
    generatedAt,
    expiresAt,
    sourceCommit,
    digest: benchmarkDigest,
    measurementRunCount,
    measuredBrushCount: cases.length,
    hardwareAdapterFingerprints,
    approved,
    rejected,
  }));
  process.stdout.write(
    `[all-brush-aggregate] measured=${cases.length} gpu=${approved.length} incumbent=${rejected.length}\n`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
