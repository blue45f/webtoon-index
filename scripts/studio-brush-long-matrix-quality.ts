import {
  analyzeStudioBrushMediaPixelQuality,
  type StudioBrushMediaPixelImage,
  type StudioBrushMediaPixelPoint,
} from "./studio-brush-media-pixel-quality";

import type { StudioBrushMaterialGroup } from "../apps/web/src/domains/creator/brush/studio-brush-visual";

/** 예전 "paint" 미디어 그룹의 재질 축 대응 집합 (수채·유화·에어브러시). */
const SOFT_WET_MATERIAL_GROUPS: ReadonlySet<StudioBrushMaterialGroup> = new Set([
  "watercolor",
  "oil",
  "airbrush",
]);

export type StudioLongBrushQualityPolicyKind =
  | "strict-continuous"
  | "soft-wet-continuous"
  | "record-only-discrete"
  | "record-only-transparent";

export type StudioLongBrushQualityContinuousPolicyKind = Exclude<
  StudioLongBrushQualityPolicyKind,
  "record-only-discrete" | "record-only-transparent"
>;

/** 연속 캐리어 판정을 받지 않는(기록만 남기는) 정책. */
export function studioLongBrushQualityPolicyIsRecordOnly(
  kind: StudioLongBrushQualityPolicyKind,
): boolean {
  return kind === "record-only-discrete" || kind === "record-only-transparent";
}

export const STUDIO_LONG_BRUSH_QUALITY_REPORT_SCHEMA_VERSION = 3 as const;

export interface StudioLongBrushQualityPolicyInput {
  readonly id: string;
  readonly source: "core" | "pro";
  readonly runtimeBrushId: string;
  readonly mediaGroup: StudioBrushMaterialGroup;
  readonly previewStyle: string;
  readonly intentionalDiscrete: boolean;
  /**
   * 물붓처럼 안료를 얹지 않는 도구는 빈 종이에 아무것도 남기지 않는 것이 제품 계약이다. 라이브
   * 프레임의 젖음 표시는 힌트일 뿐 잉크가 아니므로, 연속 캐리어 판정(라이브 전용 시작 원·에너지
   * 붕괴·잉크 없음)을 그대로 적용하면 계약과 정반대를 요구하게 된다. 생략하면 안료를 얹는 도구.
   */
  readonly depositsPigment?: boolean;
}

export interface StudioLongBrushQualityPolicy {
  readonly kind: StudioLongBrushQualityPolicyKind;
  readonly reason: string;
}

export interface StudioLongBrushQualityRoute {
  readonly points: readonly StudioBrushMediaPixelPoint[];
  readonly crossSectionRadius: number;
  /**
   * Explicit endpoint exclusion for a visible UI cursor.
   *
   * Production-quality capture should disable the brush cursor before Studio initializes and pass
   * `0`, which compares every ink pixel and every sampled cross-section without masking.
   */
  readonly cursorIgnoreRadius: number;
  readonly nominalWidth: number;
}

export interface StudioLongBrushQualityFrame {
  readonly visiblePixels: number;
  readonly inkEnergy: number;
  readonly meanVisibleDelta: number;
  readonly p95VisibleDelta: number;
  readonly bounds: Readonly<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }> | null;
  readonly centroid: Readonly<{ x: number; y: number }> | null;
  readonly edgeDensity: number;
  readonly centerlineCoverage: number;
  readonly meanCenterlineOffset: number | null;
  readonly meanCrossSectionWidth: number | null;
  readonly scallopResidualCoefficient: number | null;
  readonly repetitionScore: number;
  readonly repetitionPeriodPx: number | null;
  readonly edgePeriodicityScore: number;
  readonly edgePeriodicitySamples: number;
  readonly edgePeriodPx: number | null;
}

export interface StudioLongBrushQualityTransition {
  readonly from: "live" | "released";
  readonly to: "released" | "settled";
  readonly fromInkEnergy: number;
  readonly toInkEnergy: number;
  readonly energyRatio: number;
  /** Every RGB-changing pixel, including one-code-value compositor quantization. */
  readonly rawChangedPixels: number;
  readonly rawComparedPixels: number;
  readonly rawChangedPixelRatio: number;
  readonly maxChannelDelta: number;
  /** Perceptible changes above the verifier tolerance. */
  readonly changedPixels: number;
  readonly comparedInkPixels: number;
  readonly perPixelDifferenceRatio: number;
  readonly shapeDifferenceRatio: number;
  readonly boundsDriftPx: number | null;
  readonly normalizedBoundsDrift: number | null;
  readonly centroidDriftPx: number | null;
  readonly normalizedCentroidDrift: number | null;
  readonly centerlineDriftPx: number | null;
  readonly normalizedCenterlineDrift: number | null;
  readonly crossSectionWidthDriftPx: number | null;
  readonly edgeDensityDelta: number;
  readonly liveOnlyStartPixels: number;
  readonly liveOnlyStartRatio: number;
  readonly ignoredCursorRadius: number;
}

export type StudioLongBrushQualityFindingCode =
  | "missing-live-ink"
  | "missing-released-ink"
  | "missing-settled-ink"
  | "energy-collapse"
  | "energy-surge"
  | "bounds-drift"
  | "centroid-drift"
  | "centerline-drift"
  | "shape-drift"
  | "edge-density-churn"
  | "live-only-start-circle"
  | "transparent-wash-residue"
  | "scallop-artifact"
  | "repeated-pattern"
  | "edge-periodicity";

export interface StudioLongBrushQualityFinding {
  readonly level: "error" | "warning";
  readonly code: StudioLongBrushQualityFindingCode;
  readonly message: string;
}

export interface StudioLongBrushQualityResult {
  readonly policy: StudioLongBrushQualityPolicy;
  readonly frames: Readonly<{
    live: StudioLongBrushQualityFrame;
    released: StudioLongBrushQualityFrame;
    settled: StudioLongBrushQualityFrame;
  }>;
  readonly transitions: Readonly<{
    liveToReleased: StudioLongBrushQualityTransition;
    liveToSettled: StudioLongBrushQualityTransition;
    releasedToSettled: StudioLongBrushQualityTransition;
  }>;
  readonly findings: readonly StudioLongBrushQualityFinding[];
  readonly ok: boolean;
}

interface FrameAnalysis {
  readonly publicMetrics: StudioLongBrushQualityFrame;
  readonly deltaField: Uint8Array;
  readonly centerlineOffsets: readonly (number | null)[];
  readonly crossSectionWidths: readonly (number | null)[];
}

interface StudioLongBrushQualityInput {
  readonly policy: StudioLongBrushQualityPolicy;
  readonly baseline: StudioBrushMediaPixelImage;
  readonly live: StudioBrushMediaPixelImage;
  readonly released: StudioBrushMediaPixelImage;
  readonly settled: StudioBrushMediaPixelImage;
  readonly route: StudioLongBrushQualityRoute;
  readonly pixelTolerance?: number;
}

const CORE_DISCRETE_BRUSH_IDS: ReadonlySet<string> = new Set([
  "glitter",
  "star-dust",
  "spray",
  "ink-particle",
  "screentone",
  "sparkle-star",
  "splatter",
  "crosshatch",
  "sketchpad-tile",
  "web-multi-agent",
  "web-rough-ink",
  "web-gravity-drip",
  "web-scatter-stamp",
  "web-dot-tone",
  "web-kaleido-ink",
  "web-fur-strand",
  "web-radial-burst",
  "web-spiro-orbit",
  "web-zigzag-edge",
  "web-cross-hatch-pen",
  // The product promise is a repeated dash/stitch motif, not an unbroken pen carrier.
  "web-dash-stitch",
]);

/**
 * Hatching pens draw their mark by repeating parallel or crossed strokes, so the periodicity the
 * continuous metrics treat as a defect is the motif itself (the classic `crosshatch` preset is
 * already listed above). Enumerated rather than matched on the substring "hatch": this waives the
 * 6/6 route-coverage invariant, so joining the lane has to be a reviewable diff. A future
 * `thatch-roller` — or a genuinely broken hatch carrier — must not exempt itself by its name.
 */
const AUTHORED_HATCH_MOTIF_BRUSH_IDS: ReadonlySet<string> = new Set([
  "cross-hatch",
  "crosshatch",
  "fill-hatch",
  "hatch",
  "hatch-1",
  "hatch-dense",
  "hatch-light",
  "hatch-tone",
  "hatching",
  "hatching-contour-rake",
  "pattern-crosshatch",
  "speed-hatch",
  "toon-hatch-tone",
  "web-cross-hatch-pen",
  "web-cross-hatch-pen-x",
  "web-hatch-color",
  "web-hatch-color-lattice",
]);

function isAuthoredHatchMotifBrushId(brushId: string): boolean {
  return AUTHORED_HATCH_MOTIF_BRUSH_IDS.has(brushId);
}

const CORE_SOFT_WET_BRUSH_IDS: ReadonlySet<string> = new Set([
  "watercolor",
  "ink-wash",
  "gouache",
  "oil",
  "acrylic",
  "airbrush",
  "airbrush-fine",
  "soft-brush",
  "wash-brush",
  "glow",
  "soft-glow",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function assertCompatibleImages(images: readonly StudioBrushMediaPixelImage[]): void {
  const first = images[0];
  if (!first) throw new Error("long-brush quality analysis requires at least one image");
  for (const image of images) {
    if (
      image.width !== first.width
      || image.height !== first.height
      || image.channels < 3
      || image.data.length < image.width * image.height * image.channels
    ) {
      throw new Error("long-brush quality images have incompatible dimensions or channels");
    }
  }
}

function createDeltaField(
  baseline: StudioBrushMediaPixelImage,
  frame: StudioBrushMediaPixelImage,
): Uint8Array {
  const result = new Uint8Array(baseline.width * baseline.height);
  for (let pixel = 0; pixel < result.length; pixel += 1) {
    const beforeOffset = pixel * baseline.channels;
    const afterOffset = pixel * frame.channels;
    result[pixel] = Math.max(
      Math.abs(
        (baseline.data[beforeOffset] ?? 0)
          - (frame.data[afterOffset] ?? 0),
      ),
      Math.abs(
        (baseline.data[beforeOffset + 1] ?? 0)
          - (frame.data[afterOffset + 1] ?? 0),
      ),
      Math.abs(
        (baseline.data[beforeOffset + 2] ?? 0)
          - (frame.data[afterOffset + 2] ?? 0),
      ),
    );
  }
  return result;
}

function deltaAt(
  field: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  if (
    roundedX < 0
    || roundedX >= width
    || roundedY < 0
    || roundedY >= height
  ) return 0;
  return field[roundedY * width + roundedX] ?? 0;
}

function analyzeCrossSections(
  field: Uint8Array,
  width: number,
  height: number,
  route: StudioLongBrushQualityRoute,
  tolerance: number,
): Readonly<{
  offsets: readonly (number | null)[];
  widths: readonly (number | null)[];
}> {
  const offsets: Array<number | null> = [];
  const widths: Array<number | null> = [];
  const radius = Math.max(2, Math.ceil(route.crossSectionRadius));
  for (let index = 0; index < route.points.length; index += 1) {
    const previous = route.points[Math.max(0, index - 1)];
    const current = route.points[index];
    const next = route.points[Math.min(route.points.length - 1, index + 1)];
    if (!previous || !current || !next) {
      offsets.push(null);
      widths.push(null);
      continue;
    }
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY);
    if (length <= 0.0001) {
      offsets.push(null);
      widths.push(null);
      continue;
    }
    const normalX = -tangentY / length;
    const normalY = tangentX / length;
    let minimum: number | null = null;
    let maximum: number | null = null;
    let weightedOffset = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const delta = deltaAt(
        field,
        width,
        height,
        current.x + normalX * offset,
        current.y + normalY * offset,
      );
      if (delta <= tolerance) continue;
      minimum = minimum === null ? offset : Math.min(minimum, offset);
      maximum = maximum === null ? offset : Math.max(maximum, offset);
      weightedOffset += offset * delta;
      weight += delta;
    }
    offsets.push(weight > 0 ? weightedOffset / weight : null);
    widths.push(
      minimum !== null && maximum !== null
        ? maximum - minimum + 1
        : null,
    );
  }
  return { offsets, widths };
}

function analyzeEdgePeriodicity(
  widths: readonly (number | null)[],
): Readonly<{
  score: number;
  samples: number;
  periodPx: number | null;
}> {
  const values = widths.flatMap((value) => value === null ? [] : [value]);
  if (values.length < 15) return { score: 0, samples: values.length, periodPx: null };
  const trendRadius = Math.max(2, Math.min(6, Math.floor(values.length / 16)));
  const residuals = values.map((value, index) => {
    const from = Math.max(0, index - trendRadius);
    const to = Math.min(values.length, index + trendRadius + 1);
    const trend = values
      .slice(from, to)
      .reduce((sum, candidate) => sum + candidate, 0) / Math.max(1, to - from);
    return value - trend;
  });
  const correlations: Array<{ lag: number; value: number }> = [];
  const maximumLag = Math.min(32, Math.floor(residuals.length / 3));
  for (let lag = 3; lag <= maximumLag; lag += 1) {
    const count = residuals.length - lag;
    if (count < 10) continue;
    let leftMean = 0;
    let rightMean = 0;
    for (let index = 0; index < count; index += 1) {
      leftMean += residuals[index] ?? 0;
      rightMean += residuals[index + lag] ?? 0;
    }
    leftMean /= count;
    rightMean /= count;
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;
    for (let index = 0; index < count; index += 1) {
      const left = (residuals[index] ?? 0) - leftMean;
      const right = (residuals[index + lag] ?? 0) - rightMean;
      covariance += left * right;
      leftVariance += left * left;
      rightVariance += right * right;
    }
    const denominator = Math.sqrt(leftVariance * rightVariance);
    correlations.push({
      lag,
      value: denominator > 0 ? clamp(covariance / denominator, -1, 1) : 0,
    });
  }
  let best: { lag: number; prominence: number } | null = null;
  for (const candidate of correlations) {
    const neighbors = correlations.filter((entry) => (
      entry.lag !== candidate.lag
      && Math.abs(entry.lag - candidate.lag) <= 2
    ));
    if (neighbors.length < 2) continue;
    const prominence = Math.max(
      0,
      candidate.value - median(neighbors.map((entry) => entry.value)),
    );
    if (!best || prominence > best.prominence) {
      best = { lag: candidate.lag, prominence };
    }
  }
  return {
    score: clamp(best?.prominence ?? 0, 0, 1),
    samples: values.length,
    periodPx: best?.lag ?? null,
  };
}

function analyzeScallopResidual(
  widths: readonly (number | null)[],
): number | null {
  const values = widths.flatMap((value) => value === null ? [] : [value]);
  if (values.length < 7) return null;
  const trendRadius = Math.max(2, Math.min(5, Math.floor(values.length / 12)));
  const residuals = values.map((value, index) => {
    const from = Math.max(0, index - trendRadius);
    const to = Math.min(values.length, index + trendRadius + 1);
    const trend = values
      .slice(from, to)
      .reduce((sum, candidate) => sum + candidate, 0) / Math.max(1, to - from);
    return value - trend;
  });
  const meanWidth = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (meanWidth <= 0) return null;
  const rms = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );
  return rms / meanWidth;
}

function analyzeFrame(
  baseline: StudioBrushMediaPixelImage,
  frame: StudioBrushMediaPixelImage,
  route: StudioLongBrushQualityRoute,
  tolerance: number,
  includeSpatialRepetition: boolean,
): FrameAnalysis {
  const field = createDeltaField(baseline, frame);
  let visiblePixels = 0;
  let energy = 0;
  let weightedX = 0;
  let weightedY = 0;
  let left = baseline.width;
  let top = baseline.height;
  let right = -1;
  let bottom = -1;
  let edgePixels = 0;
  const histogram = new Uint32Array(256);
  for (let pixel = 0; pixel < field.length; pixel += 1) {
    const delta = field[pixel] ?? 0;
    if (delta <= tolerance) continue;
    const x = pixel % baseline.width;
    const y = Math.floor(pixel / baseline.width);
    visiblePixels += 1;
    energy += delta;
    weightedX += x * delta;
    weightedY += y * delta;
    histogram[delta]! += 1;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    const neighborOffsets = [
      pixel - 1,
      pixel + 1,
      pixel - baseline.width,
      pixel + baseline.width,
    ];
    if (
      x === 0
      || x === baseline.width - 1
      || y === 0
      || y === baseline.height - 1
      || neighborOffsets.some((offset) => (field[offset] ?? 0) <= tolerance)
    ) edgePixels += 1;
  }
  const p95Target = Math.max(1, Math.ceil(visiblePixels * 0.95));
  let p95VisibleDelta = 0;
  let observed = 0;
  for (let value = tolerance + 1; value < histogram.length; value += 1) {
    observed += histogram[value] ?? 0;
    if (observed < p95Target) continue;
    p95VisibleDelta = value;
    break;
  }
  const crossSections = analyzeCrossSections(
    field,
    baseline.width,
    baseline.height,
    route,
    tolerance,
  );
  const validOffsets = crossSections.offsets.flatMap((value) => (
    value === null ? [] : [value]
  ));
  const validWidths = crossSections.widths.flatMap((value) => (
    value === null ? [] : [value]
  ));
  const periodicity = analyzeEdgePeriodicity(crossSections.widths);
  const artifact = includeSpatialRepetition
    ? analyzeStudioBrushMediaPixelQuality({
        baseline,
        frame,
        routePoints: route.points,
        crossSectionRadius: route.crossSectionRadius,
        pixelTolerance: tolerance,
      })
    : null;
  return {
    publicMetrics: {
      visiblePixels,
      inkEnergy: energy / 255,
      meanVisibleDelta: energy / Math.max(1, visiblePixels),
      p95VisibleDelta,
      bounds: right >= left && bottom >= top ? { left, top, right, bottom } : null,
      centroid: energy > 0
        ? { x: weightedX / energy, y: weightedY / energy }
        : null,
      edgeDensity: edgePixels / Math.max(1, visiblePixels),
      centerlineCoverage: validOffsets.length / Math.max(1, route.points.length),
      meanCenterlineOffset: validOffsets.length > 0
        ? validOffsets.reduce((sum, value) => sum + value, 0) / validOffsets.length
        : null,
      meanCrossSectionWidth: validWidths.length > 0
        ? validWidths.reduce((sum, value) => sum + value, 0) / validWidths.length
        : null,
      scallopResidualCoefficient: analyzeScallopResidual(crossSections.widths),
      repetitionScore: artifact?.repetitionScore ?? 0,
      repetitionPeriodPx: artifact?.repetitionPeriodPx ?? null,
      edgePeriodicityScore: periodicity.score,
      edgePeriodicitySamples: periodicity.samples,
      edgePeriodPx: periodicity.periodPx,
    },
    deltaField: field,
    centerlineOffsets: crossSections.offsets,
    crossSectionWidths: crossSections.widths,
  };
}

function meanPairedDifference(
  left: readonly (number | null)[],
  right: readonly (number | null)[],
  routePoints?: readonly StudioBrushMediaPixelPoint[],
  ignoredEndpointRadius = 0,
): number | null {
  let difference = 0;
  let count = 0;
  const endpoint = routePoints?.at(-1);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const point = routePoints?.[index];
    if (
      ignoredEndpointRadius > 0
      &&
      endpoint
      && point
      && (point.x - endpoint.x) ** 2 + (point.y - endpoint.y) ** 2
        <= ignoredEndpointRadius ** 2
    ) continue;
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === null || leftValue === undefined) continue;
    if (rightValue === null || rightValue === undefined) continue;
    difference += Math.abs(leftValue - rightValue);
    count += 1;
  }
  return count > 0 ? difference / count : null;
}

function analyzeTransition(
  input: Readonly<{
    baseline: StudioBrushMediaPixelImage;
    leftImage: StudioBrushMediaPixelImage;
    rightImage: StudioBrushMediaPixelImage;
    left: FrameAnalysis;
    right: FrameAnalysis;
    route: StudioLongBrushQualityRoute;
    from: StudioLongBrushQualityTransition["from"];
    to: StudioLongBrushQualityTransition["to"];
    tolerance: number;
  }>,
): StudioLongBrushQualityTransition {
  const endpoint = input.route.points[input.route.points.length - 1];
  const start = input.route.points[0];
  if (!endpoint || !start) throw new Error("long-brush route has no endpoints");
  let fromEnergy = 0;
  let toEnergy = 0;
  let rawChangedPixels = 0;
  let rawComparedPixels = 0;
  let maxChannelDelta = 0;
  let changedPixels = 0;
  let comparedInkPixels = 0;
  let maskUnion = 0;
  let maskIntersection = 0;
  let liveOnlyStartPixels = 0;
  let startLivePixels = 0;
  let leftBoundLeft = input.baseline.width;
  let leftBoundTop = input.baseline.height;
  let leftBoundRight = -1;
  let leftBoundBottom = -1;
  let rightBoundLeft = input.baseline.width;
  let rightBoundTop = input.baseline.height;
  let rightBoundRight = -1;
  let rightBoundBottom = -1;
  let leftWeightedX = 0;
  let leftWeightedY = 0;
  let leftWeight = 0;
  let rightWeightedX = 0;
  let rightWeightedY = 0;
  let rightWeight = 0;
  const startRadius = Math.max(8, input.route.crossSectionRadius);
  for (let pixel = 0; pixel < input.left.deltaField.length; pixel += 1) {
    const x = pixel % input.baseline.width;
    const y = Math.floor(pixel / input.baseline.width);
    const inIgnoredCursor = (
      input.route.cursorIgnoreRadius > 0
      &&
      (x - endpoint.x) ** 2 + (y - endpoint.y) ** 2
        <= input.route.cursorIgnoreRadius ** 2
    );
    const leftDelta = input.left.deltaField[pixel] ?? 0;
    const rightDelta = input.right.deltaField[pixel] ?? 0;
    const leftVisible = leftDelta > input.tolerance;
    const rightVisible = rightDelta > input.tolerance;
    if (!inIgnoredCursor) {
      if (leftVisible) {
        fromEnergy += leftDelta;
        leftWeight += leftDelta;
        leftWeightedX += x * leftDelta;
        leftWeightedY += y * leftDelta;
        leftBoundLeft = Math.min(leftBoundLeft, x);
        leftBoundTop = Math.min(leftBoundTop, y);
        leftBoundRight = Math.max(leftBoundRight, x);
        leftBoundBottom = Math.max(leftBoundBottom, y);
      }
      if (rightVisible) {
        toEnergy += rightDelta;
        rightWeight += rightDelta;
        rightWeightedX += x * rightDelta;
        rightWeightedY += y * rightDelta;
        rightBoundLeft = Math.min(rightBoundLeft, x);
        rightBoundTop = Math.min(rightBoundTop, y);
        rightBoundRight = Math.max(rightBoundRight, x);
        rightBoundBottom = Math.max(rightBoundBottom, y);
      }
      if (leftVisible || rightVisible) {
        comparedInkPixels += 1;
        maskUnion += 1;
      }
      if (leftVisible && rightVisible) maskIntersection += 1;
      const leftOffset = pixel * input.leftImage.channels;
      const rightOffset = pixel * input.rightImage.channels;
      const transitionDelta = Math.max(
        Math.abs(
          (input.leftImage.data[leftOffset] ?? 0)
            - (input.rightImage.data[rightOffset] ?? 0),
        ),
        Math.abs(
          (input.leftImage.data[leftOffset + 1] ?? 0)
            - (input.rightImage.data[rightOffset + 1] ?? 0),
        ),
        Math.abs(
          (input.leftImage.data[leftOffset + 2] ?? 0)
            - (input.rightImage.data[rightOffset + 2] ?? 0),
        ),
      );
      rawComparedPixels += 1;
      if (transitionDelta > 0) rawChangedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, transitionDelta);
      if (transitionDelta > Math.max(4, input.tolerance)) changedPixels += 1;
    }
    if (
      (x - start.x) ** 2 + (y - start.y) ** 2 <= startRadius ** 2
      && leftVisible
    ) {
      startLivePixels += 1;
      if (!rightVisible) liveOnlyStartPixels += 1;
    }
  }

  const leftBounds = leftBoundRight >= leftBoundLeft && leftBoundBottom >= leftBoundTop
    ? {
        left: leftBoundLeft,
        top: leftBoundTop,
        right: leftBoundRight,
        bottom: leftBoundBottom,
      }
    : null;
  const rightBounds = rightBoundRight >= rightBoundLeft && rightBoundBottom >= rightBoundTop
    ? {
        left: rightBoundLeft,
        top: rightBoundTop,
        right: rightBoundRight,
        bottom: rightBoundBottom,
      }
    : null;
  const boundsDriftPx = leftBounds && rightBounds
    ? Math.max(
        Math.abs(leftBounds.left - rightBounds.left),
        Math.abs(leftBounds.top - rightBounds.top),
        Math.abs(leftBounds.right - rightBounds.right),
        Math.abs(leftBounds.bottom - rightBounds.bottom),
      )
    : null;
  const leftCentroid = leftWeight > 0
    ? { x: leftWeightedX / leftWeight, y: leftWeightedY / leftWeight }
    : null;
  const rightCentroid = rightWeight > 0
    ? { x: rightWeightedX / rightWeight, y: rightWeightedY / rightWeight }
    : null;
  const centroidDriftPx = leftCentroid && rightCentroid
    ? Math.hypot(
        leftCentroid.x - rightCentroid.x,
        leftCentroid.y - rightCentroid.y,
      )
    : null;
  const centerlineDriftPx = meanPairedDifference(
    input.left.centerlineOffsets,
    input.right.centerlineOffsets,
    input.route.points,
    input.route.cursorIgnoreRadius,
  );
  const crossSectionWidthDriftPx = meanPairedDifference(
    input.left.crossSectionWidths,
    input.right.crossSectionWidths,
    input.route.points,
    input.route.cursorIgnoreRadius,
  );
  const scale = Math.max(4, input.route.nominalWidth);
  return {
    from: input.from,
    to: input.to,
    fromInkEnergy: fromEnergy / 255,
    toInkEnergy: toEnergy / 255,
    energyRatio: fromEnergy <= 0 ? 0 : toEnergy / fromEnergy,
    rawChangedPixels,
    rawComparedPixels,
    rawChangedPixelRatio: rawChangedPixels / Math.max(1, rawComparedPixels),
    maxChannelDelta,
    changedPixels,
    comparedInkPixels,
    perPixelDifferenceRatio: changedPixels / Math.max(1, comparedInkPixels),
    shapeDifferenceRatio: 1 - maskIntersection / Math.max(1, maskUnion),
    boundsDriftPx,
    normalizedBoundsDrift: boundsDriftPx === null ? null : boundsDriftPx / scale,
    centroidDriftPx,
    normalizedCentroidDrift: centroidDriftPx === null ? null : centroidDriftPx / scale,
    centerlineDriftPx,
    normalizedCenterlineDrift: centerlineDriftPx === null
      ? null
      : centerlineDriftPx / scale,
    crossSectionWidthDriftPx,
    edgeDensityDelta: Math.abs(
      input.left.publicMetrics.edgeDensity
        - input.right.publicMetrics.edgeDensity,
    ),
    liveOnlyStartPixels,
    liveOnlyStartRatio: liveOnlyStartPixels / Math.max(1, startLivePixels),
    ignoredCursorRadius: input.route.cursorIgnoreRadius,
  };
}

export function classifyStudioLongBrushQualityPolicy(
  input: StudioLongBrushQualityPolicyInput,
): StudioLongBrushQualityPolicy {
  if (input.depositsPigment === false) {
    return {
      kind: "record-only-transparent",
      reason: "water-only wash deposits no pigment; the live wet sheen is a hint, not ink",
    };
  }
  if (
    input.intentionalDiscrete
    || (input.source === "core" && CORE_DISCRETE_BRUSH_IDS.has(input.id))
    || isAuthoredHatchMotifBrushId(input.id)
    // A "tone" preview is the catalogue's own word for a halftone/screentone carrier, and the
    // sibling carrier-quality SSOT already treats that preview style as intentionally discrete.
    // Engine-lane rows carry no brush-pack descriptor, so they never reached that SSOT and a
    // screentone was being held to an unbroken-edge standard a dot grid cannot meet by design.
    || input.previewStyle === "tone"
  ) {
    return {
      kind: "record-only-discrete",
      reason: "authored particle, motif, tone, or stamp carrier",
    };
  }
  if (input.runtimeBrushId === "dry-media") {
    return {
      kind: "strict-continuous",
      reason: "continuous dry-media carrier",
    };
  }
  if (
    input.runtimeBrushId === "airbrush"
    || (input.source === "core" && CORE_SOFT_WET_BRUSH_IDS.has(input.id))
    // 예전의 단일 "paint" 미디어 그룹은 재질 축에서 수채·유화·에어 셋으로 갈라졌다.
    // 정책 대상 집합은 그대로 유지해야 품질 게이트의 의미가 바뀌지 않는다.
    || (
      SOFT_WET_MATERIAL_GROUPS.has(input.mediaGroup)
      && (input.previewStyle === "soft" || input.previewStyle === "oil")
    )
  ) {
    return {
      kind: "soft-wet-continuous",
      reason: "soft, wet, airbrush, glow, or paint medium with bounded settling",
    };
  }
  return {
    kind: "strict-continuous",
    reason: "ink, marker, pencil, dry texture, or continuous shape carrier",
  };
}

function finding(
  level: StudioLongBrushQualityFinding["level"],
  code: StudioLongBrushQualityFindingCode,
  message: string,
): StudioLongBrushQualityFinding {
  return { level, code, message };
}

function evaluateContinuousQuality(
  policy: StudioLongBrushQualityContinuousPolicyKind,
  frames: StudioLongBrushQualityResult["frames"],
  transitions: StudioLongBrushQualityResult["transitions"],
): StudioLongBrushQualityFinding[] {
  const findings: StudioLongBrushQualityFinding[] = [];
  if (frames.live.visiblePixels < 4) {
    findings.push(finding("error", "missing-live-ink", "live pointer-down frame has no visible ink"));
  }
  if (frames.released.visiblePixels < 4) {
    findings.push(finding("error", "missing-released-ink", "pointer-up frame has no visible ink"));
  }
  if (frames.settled.visiblePixels < 4) {
    findings.push(finding("error", "missing-settled-ink", "committed/autosaved frame has no visible ink"));
  }

  const strict = policy === "strict-continuous";
  const minimumEnergyRatio = strict ? 0.5 : 0.22;
  const maximumEnergyRatio = strict ? 2 : 3.5;
  for (const transition of [
    transitions.liveToReleased,
    transitions.liveToSettled,
    transitions.releasedToSettled,
  ]) {
    const label = `${transition.from}/${transition.to}`;
    if (transition.energyRatio < minimumEnergyRatio) {
      findings.push(finding(
        "error",
        "energy-collapse",
        `${label} energy ratio ${transition.energyRatio.toFixed(3)} is below ${minimumEnergyRatio}`,
      ));
    }
    if (transition.energyRatio > maximumEnergyRatio) {
      findings.push(finding(
        "error",
        "energy-surge",
        `${label} energy ratio ${transition.energyRatio.toFixed(3)} exceeds ${maximumEnergyRatio}`,
      ));
    }
    if ((transition.normalizedBoundsDrift ?? 0) > (strict ? 0.85 : 1.1)) {
      findings.push(finding(
        "error",
        "bounds-drift",
        `${label} bounds drift ${transition.boundsDriftPx?.toFixed(2)}px`,
      ));
    }
    if ((transition.normalizedCentroidDrift ?? 0) > (strict ? 0.5 : 0.7)) {
      findings.push(finding(
        "error",
        "centroid-drift",
        `${label} centroid drift ${transition.centroidDriftPx?.toFixed(2)}px`,
      ));
    }
    if ((transition.normalizedCenterlineDrift ?? 0) > (strict ? 0.35 : 0.5)) {
      findings.push(finding(
        "error",
        "centerline-drift",
        `${label} centerline drift ${transition.centerlineDriftPx?.toFixed(2)}px`,
      ));
    }
    if (transition.shapeDifferenceRatio > (strict ? 0.82 : 0.93)) {
      findings.push(finding(
        "error",
        "shape-drift",
        `${label} mask difference ${(transition.shapeDifferenceRatio * 100).toFixed(1)}%`,
      ));
    }
    if (transition.edgeDensityDelta > (strict ? 0.5 : 0.72)) {
      findings.push(finding(
        "error",
        "edge-density-churn",
        `${label} edge-density delta ${transition.edgeDensityDelta.toFixed(3)}`,
      ));
    }
    if (
      transition.from === "live"
      && transition.liveOnlyStartPixels >= 12
      && transition.liveOnlyStartRatio > 0.55
    ) {
      findings.push(finding(
        "error",
        "live-only-start-circle",
        `${transition.liveOnlyStartPixels} start-cap pixels exist only in ${label}`,
      ));
    }
  }

  const artifactLevel: StudioLongBrushQualityFinding["level"] = "error";
  const scallopLimit = strict ? 0.5 : 0.62;
  if (
    frames.settled.scallopResidualCoefficient !== null
    && frames.settled.scallopResidualCoefficient > scallopLimit
  ) {
    findings.push(finding(
      artifactLevel,
      "scallop-artifact",
      `detrended edge scallop ${frames.settled.scallopResidualCoefficient.toFixed(3)} exceeds ${scallopLimit}`,
    ));
  }
  const repetitionLimit = strict ? 0.64 : 0.72;
  if (frames.settled.repetitionScore > repetitionLimit) {
    findings.push(finding(
      artifactLevel,
      "repeated-pattern",
      `repetition ${frames.settled.repetitionScore.toFixed(3)} at ${frames.settled.repetitionPeriodPx ?? "n/a"}px`,
    ));
  }
  const edgePeriodicityLimit = strict ? 0.46 : 0.56;
  const edgePeriodicityAmplitudeFloor = strict ? 0.025 : 0.04;
  const edgePeriodicityAmplitude =
    frames.settled.scallopResidualCoefficient ?? 0;
  /**
   * Absolute-pixel guard alongside the relative floor. A faint soft deposit (web-blend-softener:
   * mean visible width 11.25px at 2-code tolerance) shows a deterministic ~1px contour wobble
   * from dab-center-vs-pixel-grid quantization; its coefficient (0.086) clears the relative floor
   * while the physical amplitude is invisible. No renderer controls sub-1.5px anti-aliased
   * contour wobble at a tolerance boundary, so periodicity below that is measurement structure,
   * not a stroke defect. Real scallops stay caught: the pre-fix calligraphy ribbon measured
   * 0.354 x 24px = 8.5px RMS.
   */
  const edgePeriodicityAmplitudePx =
    edgePeriodicityAmplitude * (frames.settled.meanCrossSectionWidth ?? 0);
  if (
    frames.settled.edgePeriodicityScore > edgePeriodicityLimit
    && edgePeriodicityAmplitude > edgePeriodicityAmplitudeFloor
    && edgePeriodicityAmplitudePx > 1.5
  ) {
    findings.push(finding(
      artifactLevel,
      "edge-periodicity",
      `edge periodicity ${frames.settled.edgePeriodicityScore.toFixed(3)} `
        + `with amplitude ${edgePeriodicityAmplitude.toFixed(3)} `
        + `at ${frames.settled.edgePeriodPx ?? "n/a"} samples`,
    ));
  }
  return findings;
}

export function analyzeStudioLongBrushQuality(
  input: StudioLongBrushQualityInput,
): StudioLongBrushQualityResult {
  assertCompatibleImages([
    input.baseline,
    input.live,
    input.released,
    input.settled,
  ]);
  const tolerance = Math.max(0, Math.floor(input.pixelTolerance ?? 3));
  const live = analyzeFrame(
    input.baseline,
    input.live,
    input.route,
    tolerance,
    false,
  );
  const released = analyzeFrame(
    input.baseline,
    input.released,
    input.route,
    tolerance,
    false,
  );
  // The expensive two-axis spatial autocorrelation is authoritative only on the final retained
  // frame. Live/released geometry still records edge scallop and route-periodicity in linear time.
  const settled = analyzeFrame(
    input.baseline,
    input.settled,
    input.route,
    tolerance,
    true,
  );
  const transition = (
    leftImage: StudioBrushMediaPixelImage,
    rightImage: StudioBrushMediaPixelImage,
    left: FrameAnalysis,
    right: FrameAnalysis,
    from: StudioLongBrushQualityTransition["from"],
    to: StudioLongBrushQualityTransition["to"],
  ) => analyzeTransition({
    baseline: input.baseline,
    leftImage,
    rightImage,
    left,
    right,
    route: input.route,
    from,
    to,
    tolerance,
  });
  const frames = {
    live: live.publicMetrics,
    released: released.publicMetrics,
    settled: settled.publicMetrics,
  };
  const transitions = {
    liveToReleased: transition(
      input.live,
      input.released,
      live,
      released,
      "live",
      "released",
    ),
    liveToSettled: transition(
      input.live,
      input.settled,
      live,
      settled,
      "live",
      "settled",
    ),
    releasedToSettled: transition(
      input.released,
      input.settled,
      released,
      settled,
      "released",
      "settled",
    ),
  };
  if (input.policy.kind === "record-only-discrete") {
    const findings = [
      ...(frames.live.visiblePixels < 4
        ? [finding("warning", "missing-live-ink", "discrete live frame has no visible mark")]
        : []),
      ...(frames.settled.visiblePixels < 4
        ? [finding("warning", "missing-settled-ink", "discrete settled frame has no visible mark")]
        : []),
    ];
    return {
      policy: input.policy,
      frames,
      transitions,
      findings,
      // Intentional particle/stamp/tone geometry is diagnostic-only in the new carrier gate.
      ok: true,
    };
  }
  if (input.policy.kind === "record-only-transparent") {
    // 안료 없는 워시: 라이브 젖음 힌트는 있어야 하고, 손을 뗀 뒤에는 아무 잉크도 남으면 안 된다.
    // 남는 잉크는 이 획의 것이 아니라 공유 워시가 되살린 남의 안료다(실측: Undo 한 수묵 펜 획을
    // 같은 경로의 물붓이 다시 보이게 했다).
    const findings = [
      ...(frames.live.visiblePixels < 4
        ? [finding("warning", "missing-live-ink", "transparent wash live frame shows no wet hint")]
        : []),
      ...(frames.released.visiblePixels >= 4
        ? [finding(
            "error",
            "transparent-wash-residue",
            `pointer-up frame keeps ${frames.released.visiblePixels} ink pixels from a brush that deposits none`,
          )]
        : []),
      ...(frames.settled.visiblePixels >= 4
        ? [finding(
            "error",
            "transparent-wash-residue",
            `settled frame keeps ${frames.settled.visiblePixels} ink pixels from a brush that deposits none`,
          )]
        : []),
    ];
    return {
      policy: input.policy,
      frames,
      transitions,
      findings,
      ok: findings.every((entry) => entry.level !== "error"),
    };
  }
  const findings = evaluateContinuousQuality(input.policy.kind, frames, transitions);
  return {
    policy: input.policy,
    frames,
    transitions,
    findings,
    ok: findings.every((entry) => entry.level !== "error"),
  };
}
