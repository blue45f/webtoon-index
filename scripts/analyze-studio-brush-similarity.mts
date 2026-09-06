import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { decodePng } from "image-js";

import {
  curateStudioBrushCandidates,
  type StudioBrushCurationCandidate,
  type StudioBrushMarkFingerprint,
} from "../apps/web/src/domains/creator/brush/studio-brush-quality-curation";
import { STUDIO_BEGINNER_BRUSH_IDS } from "../apps/web/src/domains/creator/studio-creative-ux";

const INPUT_ROOT = process.env.TOONSPECTRUM_ALL_BRUSH_INPUT_DIR
  ?? "artifacts/all-brush-long-stroke-input";
const AGGREGATE_ROOT = process.env.TOONSPECTRUM_ALL_BRUSH_AGGREGATE_DIR
  ?? "artifacts/all-brush-long-stroke-aggregate";
const AGGREGATE_REPORT_PATH = process.env.TOONSPECTRUM_ALL_BRUSH_REPORT
  ?? join(AGGREGATE_ROOT, "all-brush-gpu-quality-report.json");
const OUTPUT_JSON = join(AGGREGATE_ROOT, "brush-curation-report.json");
const OUTPUT_MARKDOWN = join(AGGREGATE_ROOT, "brush-curation-report.md");
const NORMALIZED_SIZE = 64;
const HISTOGRAM_BINS = 32;
const PIXEL_THRESHOLD = 8 / 255;
const BEGINNER_IDS = new Set<string>(STUDIO_BEGINNER_BRUSH_IDS);

interface AggregateQuality {
  readonly ownQualityPassed?: boolean;
  readonly browserErrorCount?: number;
  readonly refusedStrokeCount?: number;
  readonly liveToCommittedChangedRatio?: number;
  readonly committedToSettledChangedRatio?: number;
  readonly centerlineCoverage?: number;
}

interface AggregatePerformance {
  readonly frameP95Milliseconds?: number;
  readonly inputDeliveryRatio?: number;
}

interface AggregateCase {
  readonly id: string;
  readonly name?: string;
  readonly operation: string;
  readonly mediaGroup: string;
  readonly policy: string;
  readonly baseline: {
    readonly report: string;
    readonly quality: AggregateQuality;
    readonly performance: AggregatePerformance;
  };
  readonly election: { readonly selected?: string };
}

interface AggregateReport {
  readonly benchmarkDigest?: string;
  readonly sourceCommit?: string | null;
  readonly cases: readonly AggregateCase[];
}

interface ImageData {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finite(value)));
}

function parseJson<Value>(path: string): Value {
  return JSON.parse(readFileSync(path, "utf8")) as Value;
}

function decode(path: string): ImageData {
  const bytes = readFileSync(path);
  const image = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return {
    width: image.width,
    height: image.height,
    channels: image.channels,
    data: image.getRawImage().data as Uint8Array,
  };
}

function assertCompatible(blank: ImageData, committed: ImageData): void {
  if (
    blank.width !== committed.width
    || blank.height !== committed.height
    || blank.channels < 3
    || committed.channels < 3
  ) throw new Error("blank and committed images are not compatible");
}

function sourceDarkness(blank: ImageData, committed: ImageData): Float32Array {
  assertCompatible(blank, committed);
  const pixels = blank.width * blank.height;
  const output = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const blankOffset = pixel * blank.channels;
    const committedOffset = pixel * committed.channels;
    output[pixel] = Math.max(
      Math.abs((blank.data[blankOffset] ?? 0) - (committed.data[committedOffset] ?? 0)),
      Math.abs((blank.data[blankOffset + 1] ?? 0) - (committed.data[committedOffset + 1] ?? 0)),
      Math.abs((blank.data[blankOffset + 2] ?? 0) - (committed.data[committedOffset + 2] ?? 0)),
    ) / 255;
  }
  return output;
}

function boundsOf(field: Float32Array, width: number, height: number): {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
} | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((field[y * width + x] ?? 0) <= PIXEL_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function sampleBilinear(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const clampedX = Math.min(width - 1, Math.max(0, x));
  const clampedY = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const top = (field[y0 * width + x0] ?? 0) * (1 - tx)
    + (field[y0 * width + x1] ?? 0) * tx;
  const bottom = (field[y1 * width + x0] ?? 0) * (1 - tx)
    + (field[y1 * width + x1] ?? 0) * tx;
  return top * (1 - ty) + bottom * ty;
}

function normalizedField(
  field: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const output = new Float32Array(NORMALIZED_SIZE * NORMALIZED_SIZE);
  const bounds = boundsOf(field, width, height);
  if (!bounds) return output;
  const pad = Math.max(4, Math.ceil(Math.max(
    bounds.right - bounds.left + 1,
    bounds.bottom - bounds.top + 1,
  ) * 0.015));
  const left = Math.max(0, bounds.left - pad);
  const top = Math.max(0, bounds.top - pad);
  const right = Math.min(width - 1, bounds.right + pad);
  const bottom = Math.min(height - 1, bounds.bottom + pad);
  const cropWidth = Math.max(1, right - left + 1);
  const cropHeight = Math.max(1, bottom - top + 1);
  const targetSpan = NORMALIZED_SIZE - 8;
  const scale = Math.min(targetSpan / cropWidth, targetSpan / cropHeight);
  const renderedWidth = cropWidth * scale;
  const renderedHeight = cropHeight * scale;
  const offsetX = (NORMALIZED_SIZE - renderedWidth) / 2;
  const offsetY = (NORMALIZED_SIZE - renderedHeight) / 2;
  for (let y = 0; y < NORMALIZED_SIZE; y += 1) {
    for (let x = 0; x < NORMALIZED_SIZE; x += 1) {
      const sourceX = (x + 0.5 - offsetX) / scale + left - 0.5;
      const sourceY = (y + 0.5 - offsetY) / scale + top - 0.5;
      if (sourceX < left || sourceX > right || sourceY < top || sourceY > bottom) continue;
      output[y * NORMALIZED_SIZE + x] = sampleBilinear(
        field,
        width,
        height,
        sourceX,
        sourceY,
      );
    }
  }
  return output;
}

function normalize(values: number[]): readonly number[] {
  const sum = values.reduce((total, value) => total + value, 0);
  return Object.freeze(values.map((value) => sum > 0 ? value / sum : 0));
}

function fingerprint(blank: ImageData, committed: ImageData): StudioBrushMarkFingerprint {
  const source = sourceDarkness(blank, committed);
  const field = normalizedField(source, blank.width, blank.height);
  const silhouette = new Array<number>(field.length).fill(0);
  const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  const horizontal = new Array<number>(NORMALIZED_SIZE).fill(0);
  const vertical = new Array<number>(NORMALIZED_SIZE).fill(0);
  let visiblePixels = 0;
  let inkEnergy = 0;
  let edgePixels = 0;
  let gradientEnergy = 0;
  for (let y = 0; y < NORMALIZED_SIZE; y += 1) {
    for (let x = 0; x < NORMALIZED_SIZE; x += 1) {
      const index = y * NORMALIZED_SIZE + x;
      const value = field[index] ?? 0;
      if (value <= PIXEL_THRESHOLD) continue;
      silhouette[index] = 1;
      visiblePixels += 1;
      inkEnergy += value;
      horizontal[x] = (horizontal[x] ?? 0) + value;
      vertical[y] = (vertical[y] ?? 0) + value;
      const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(value * HISTOGRAM_BINS));
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      if (x > 0 && x + 1 < NORMALIZED_SIZE && y > 0 && y + 1 < NORMALIZED_SIZE) {
        const gx = Math.abs((field[index + 1] ?? 0) - (field[index - 1] ?? 0));
        const gy = Math.abs(
          (field[index + NORMALIZED_SIZE] ?? 0)
          - (field[index - NORMALIZED_SIZE] ?? 0),
        );
        const gradient = gx + gy;
        gradientEnergy += gradient;
        if (gradient > 0.08) edgePixels += 1;
      }
    }
  }
  const normalizedHistogram = normalize(histogram);
  let entropy = 0;
  for (const probability of normalizedHistogram) {
    if (probability > 0) entropy -= probability * Math.log2(probability);
  }
  return Object.freeze({
    darkness: Object.freeze([...field]),
    silhouette: Object.freeze(silhouette),
    width: NORMALIZED_SIZE,
    height: NORMALIZED_SIZE,
    toneHistogram: normalizedHistogram,
    horizontalProfile: normalize(horizontal),
    verticalProfile: normalize(vertical),
    inkDensity: visiblePixels > 0 ? inkEnergy / visiblePixels : 0,
    edgeDensity: visiblePixels > 0 ? edgePixels / visiblePixels : 0,
    gradientDensity: visiblePixels > 0 ? gradientEnergy / visiblePixels : 0,
    textureEntropy: clamp01(entropy / Math.log2(HISTOGRAM_BINS)),
  });
}

function candidateFromCase(entry: AggregateCase, listedOrder: number): StudioBrushCurationCandidate {
  const caseRoot = dirname(join(INPUT_ROOT, entry.baseline.report));
  const blank = decode(join(caseRoot, "00-blank.png"));
  const committed = decode(join(caseRoot, "02-committed.png"));
  const mark = fingerprint(blank, committed);
  const quality = entry.baseline.quality;
  const performance = entry.baseline.performance;
  const settledRatio = finite(quality.committedToSettledChangedRatio, 1);
  return Object.freeze({
    id: entry.id,
    comparisonGroup: `${entry.operation}/${entry.mediaGroup}/${entry.policy}`,
    listedOrder,
    protectedFromCulling: BEGINNER_IDS.has(entry.id),
    qualityPassed: quality.ownQualityPassed === true,
    browserErrorCount: finite(quality.browserErrorCount),
    refusedStrokeCount: finite(quality.refusedStrokeCount),
    centerlineCoverage: clamp01(finite(quality.centerlineCoverage)),
    liveCommitFidelity: clamp01(1 - finite(quality.liveToCommittedChangedRatio, 1)),
    settledStability: clamp01(1 - settledRatio / 0.001),
    inputDeliveryRatio: clamp01(finite(performance.inputDeliveryRatio)),
    frameP95Milliseconds: finite(performance.frameP95Milliseconds, Number.POSITIVE_INFINITY),
    textureQuality: mark.textureEntropy,
    gpuApproved: entry.election.selected === "gpu",
    fingerprint: mark,
  });
}

function main(): void {
  mkdirSync(AGGREGATE_ROOT, { recursive: true });
  const aggregate = parseJson<AggregateReport>(AGGREGATE_REPORT_PATH);
  const candidates = aggregate.cases
    .filter((entry) => entry.operation === "paint")
    .map(candidateFromCase);
  const clusters = curateStudioBrushCandidates(candidates);
  const suggestedQuarantineIds = [...new Set(clusters.flatMap((cluster) =>
    cluster.suggestedQuarantineIds))].sort();
  const report = {
    kind: "toonspectrum-brush-quality-curation-v1",
    generatedAt: new Date().toISOString(),
    sourceCommit: aggregate.sourceCommit ?? null,
    benchmarkDigest: aggregate.benchmarkDigest ?? null,
    measuredPaintBrushCount: candidates.length,
    duplicateClusterCount: clusters.length,
    suggestedQuarantineCount: suggestedQuarantineIds.length,
    suggestedVisiblePaintCount: candidates.length - suggestedQuarantineIds.length,
    suggestedQuarantineIds,
    clusters,
  };
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    "# 브러시 품질 우선 유사도 정리",
    "",
    `- 측정 페인트 브러시: ${candidates.length}`,
    `- 완전연결 유사 군집: ${clusters.length}`,
    `- 노출 격리 제안: ${suggestedQuarantineIds.length}`,
    `- 제안 후 노출 수: ${candidates.length - suggestedQuarantineIds.length}`,
    "",
    "## 원칙",
    "",
    "- 런타임 ID와 저장 문서 재생 계약은 삭제하지 않는다.",
    "- 동일 매체·동일 품질 정책 안에서 모든 쌍이 엄격한 시각 게이트를 통과한 군집만 정리 후보가 된다.",
    "- 대표 브러시는 품질을 먼저 고르고, 품질 점수가 사실상 같을 때만 GPU 승인 브러시를 우선한다.",
    "- 보호된 스타터 브러시가 둘 이상 겹치면 자동 격리하지 않고 수동 검토로 남긴다.",
    "",
    "## 군집",
    "",
    ...clusters.flatMap((cluster, index) => [
      `### ${index + 1}. ${cluster.representativeId}`,
      "",
      `- 그룹: \`${cluster.comparisonGroup}\``,
      `- 신뢰도: ${(cluster.confidence * 100).toFixed(2)}%`,
      `- 구성: ${cluster.memberIds.map((id) => `\`${id}\``).join(", ")}`,
      `- 노출 격리 제안: ${cluster.suggestedQuarantineIds.length > 0
        ? cluster.suggestedQuarantineIds.map((id) => `\`${id}\``).join(", ")
        : "없음 — 수동 검토"}`,
      `- 대표 선정: ${cluster.representativeReason}`,
      "",
    ]),
  ].join("\n");
  writeFileSync(OUTPUT_MARKDOWN, markdown);
  process.stdout.write(
    `[brush-curation] measured=${candidates.length} clusters=${clusters.length} quarantine=${suggestedQuarantineIds.length}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
