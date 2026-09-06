import {
  StudioHokusaiLiveOverlayRenderer,
} from "../apps/web/src/domains/creator/render/studio-hokusai-live-brush-overlay";
import {
  StudioHokusaiLiveBrushProvider,
  type StudioHokusaiLiveFrame,
} from "../apps/web/src/domains/creator/render/studio-hokusai-live-brush-runtime";

import type {
  StudioHokusaiLiveSampleLike,
} from "../apps/web/src/domains/creator/render/studio-hokusai-live-brush-protocol";

declare global {
  interface Window {
    __studioHokusaiLiveQualityResult?: unknown;
  }
}

const DOCUMENT_WIDTH = 4_096;
const DOCUMENT_HEIGHT = 1_024;
const VIEW_SCALE = 0.25;
const SAMPLE_COUNT = 5_000;
const BATCH_SIZE = 250;
const QUALITY_WIDTH = 1_024;
const QUALITY_HEIGHT = 320;
const QUALITY_RADIUS = 16;

type QualityPresetId =
  | "pencil" | "charcoal" | "oil" | "calligraphy" | "marker";

type MainThreadMeasurementPhase =
  | "startup-prewarm"
  | "stroke-setup"
  | "interactive-5k"
  | "canonical-verification"
  | "cancel-recovery";

interface MainThreadPhaseMetric {
  maximumDelayMilliseconds: number;
  tickCount: number;
  overBudgetTickCount: number;
}

const MAIN_THREAD_SAMPLE_INTERVAL_MS = 4;
const MAIN_THREAD_INTERACTIVE_BUDGET_MS = 20;

interface LiveMaterialQualityMetrics {
  readonly nonZeroPixels: number;
  readonly alphaMean: number;
  readonly alphaStandardDeviation: number;
  readonly edgeDensity: number;
  readonly neighbourDifference: number;
  readonly periodicity: number;
  readonly circleCarrierExposure: number;
  readonly startBackMassRatio: number;
  readonly centerlineGapsAfterStart: number;
  readonly horizontalVariation: number;
  readonly verticalVariation: number;
  readonly directionalAnisotropy: number;
}

function createMainThreadDelayTracker(initialPhase: MainThreadMeasurementPhase) {
  let phase = initialPhase;
  let expectedTick = performance.now() + MAIN_THREAD_SAMPLE_INTERVAL_MS;
  const metrics = new Map<MainThreadMeasurementPhase, MainThreadPhaseMetric>();
  const metric = (key: MainThreadMeasurementPhase): MainThreadPhaseMetric => {
    const existing = metrics.get(key);
    if (existing) return existing;
    const created = {
      maximumDelayMilliseconds: 0,
      tickCount: 0,
      overBudgetTickCount: 0,
    };
    metrics.set(key, created);
    return created;
  };
  metric(initialPhase);
  const timer = window.setInterval(() => {
    const now = performance.now();
    const delayMilliseconds = Math.max(0, now - expectedTick);
    const current = metric(phase);
    current.maximumDelayMilliseconds = Math.max(
      current.maximumDelayMilliseconds,
      delayMilliseconds,
    );
    current.tickCount += 1;
    if (delayMilliseconds > MAIN_THREAD_INTERACTIVE_BUDGET_MS) {
      current.overBudgetTickCount += 1;
    }
    expectedTick = now + MAIN_THREAD_SAMPLE_INTERVAL_MS;
  }, MAIN_THREAD_SAMPLE_INTERVAL_MS);
  return {
    setPhase(nextPhase: MainThreadMeasurementPhase): void {
      phase = nextPhase;
      metric(nextPhase);
      // A delay that occurred in the previous phase must never bleed into the
      // next phase simply because its first interval starts with an old target.
      expectedTick = performance.now() + MAIN_THREAD_SAMPLE_INTERVAL_MS;
    },
    snapshot(): Record<MainThreadMeasurementPhase, MainThreadPhaseMetric> {
      return Object.fromEntries(
        [...metrics].map(([key, value]) => [key, { ...value }]),
      ) as Record<MainThreadMeasurementPhase, MainThreadPhaseMetric>;
    },
    stop(): void {
      window.clearInterval(timer);
    },
  };
}

function canvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`Missing canvas: ${id}`);
  return element;
}

function longStrokeSamples(): Array<Readonly<{
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timeMilliseconds: number;
}>> {
  return Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const progress = index / (SAMPLE_COUNT - 1);
    return {
      x: 180 + progress * 3_700,
      y: 512 + Math.sin(progress * Math.PI * 12) * 150,
      pressure: 0.2 + 0.75 * (0.5 + Math.sin(progress * Math.PI * 4) * 0.5),
      tiltX: Math.sin(progress * Math.PI * 2) * 35,
      tiltY: Math.cos(progress * Math.PI * 2) * 28,
      timeMilliseconds: index * 2,
    };
  });
}

function qualityStrokeSamples(): ReturnType<typeof longStrokeSamples> {
  return Array.from({ length: 321 }, (_, index) => {
    const progress = index / 320;
    return {
      x: 88 + progress * 848,
      y: 160
        + Math.sin(progress * Math.PI * 4) * 54
        + Math.sin(progress * Math.PI * 9) * 8,
      pressure: 0.22 + Math.sin(progress * Math.PI) ** 1.35 * 0.7,
      tiltX: Math.sin(progress * Math.PI * 2) * 35,
      tiltY: Math.cos(progress * Math.PI * 2) * 26,
      timeMilliseconds: index * 3,
    };
  });
}

function sparseFigureEightSamples(): StudioHokusaiLiveSampleLike[] {
  return Array.from({ length: 24 }, (_, index) => {
    const angle = Math.PI * 2 * index / 23;
    return {
      x: 512 + 270 * Math.sin(angle),
      y: 160 + 72 * Math.sin(angle * 2),
      pressure: 0.72,
      tiltX: 0,
      tiltY: 0,
      // Deliberately omit timeMilliseconds. Mouse and legacy input do not
      // persist the v2 sensor clock, but a sparse curve must still retain its
      // complete geometry across multiple incremental append batches.
    };
  });
}

function alphaAt(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius = 1,
): number {
  let maximum = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = Math.round(x + offsetX);
      const sampleY = Math.round(y + offsetY);
      if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
      maximum = Math.max(
        maximum,
        pixels[(sampleY * width + sampleX) * 4 + 3] ?? 0,
      );
    }
  }
  return maximum;
}

function localResidual(values: readonly number[], radius: number): number[] {
  return values.map((value, index) => {
    let sum = 0;
    let count = 0;
    for (
      let neighbour = Math.max(0, index - radius);
      neighbour <= Math.min(values.length - 1, index + radius);
      neighbour += 1
    ) {
      sum += values[neighbour] ?? 0;
      count += 1;
    }
    return value - sum / Math.max(1, count);
  });
}

function normalizedPeriodicity(values: readonly number[]): number {
  const residual = localResidual(values, 8);
  let maximum = 0;
  for (let lag = 3; lag <= Math.min(24, residual.length / 3); lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < residual.length; index += 1) {
      const left = residual[index] ?? 0;
      const right = residual[index - lag] ?? 0;
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    if (denominator > 0) maximum = Math.max(maximum, correlation / denominator);
  }
  return Math.max(0, maximum);
}

function liveMaterialQualityMetrics(
  pixels: Uint8Array,
  width: number,
  height: number,
  placement: Readonly<{ x: number; y: number }>,
  samples: ReturnType<typeof qualityStrokeSamples>,
  radiusPixels: number,
): LiveMaterialQualityMetrics {
  let nonZeroPixels = 0;
  let alphaSum = 0;
  let alphaSquareSum = 0;
  let edgeCount = 0;
  let neighbourCount = 0;
  let horizontalDifference = 0;
  let verticalDifference = 0;
  let horizontalPairs = 0;
  let verticalPairs = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4 + 3;
      const alpha = pixels[index] ?? 0;
      if (alpha <= 0) continue;
      nonZeroPixels += 1;
      alphaSum += alpha;
      alphaSquareSum += alpha * alpha;
      const right = pixels[index + 4] ?? 0;
      const down = pixels[index + width * 4] ?? 0;
      edgeCount += Math.abs(alpha - right) >= 12 ? 1 : 0;
      edgeCount += Math.abs(alpha - down) >= 12 ? 1 : 0;
      neighbourCount += 2;
      if (right > 0) {
        horizontalDifference += Math.abs(alpha - right);
        horizontalPairs += 1;
      }
      if (down > 0) {
        verticalDifference += Math.abs(alpha - down);
        verticalPairs += 1;
      }
    }
  }
  const localSamples = samples.map((sample) => ({
    x: sample.x - placement.x,
    y: sample.y - placement.y,
  }));
  const centerline = localSamples.map((sample) => (
    alphaAt(pixels, width, height, sample.x, sample.y)
  ));
  const periodicity = normalizedPeriodicity(centerline);
  const mean = alphaSum / Math.max(1, nonZeroPixels);
  const variance = Math.max(
    0,
    alphaSquareSum / Math.max(1, nonZeroPixels) - mean * mean,
  );
  const horizontalVariation = horizontalDifference / Math.max(1, horizontalPairs);
  const verticalVariation = verticalDifference / Math.max(1, verticalPairs);
  const origin = localSamples[0];
  const next = localSamples.find((sample) => origin && (
    Math.hypot(sample.x - origin.x, sample.y - origin.y) >= 0.5
  ));
  let backMass = 0;
  let forwardMass = 0;
  if (origin && next) {
    const deltaX = next.x - origin.x;
    const deltaY = next.y - origin.y;
    const length = Math.hypot(deltaX, deltaY);
    const tangentX = deltaX / length;
    const tangentY = deltaY / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const radius = Math.max(3, radiusPixels * 1.5);
    for (
      let y = Math.max(0, Math.floor(origin.y - radius));
      y <= Math.min(height - 1, Math.ceil(origin.y + radius));
      y += 1
    ) {
      for (
        let x = Math.max(0, Math.floor(origin.x - radius));
        x <= Math.min(width - 1, Math.ceil(origin.x + radius));
        x += 1
      ) {
        const relativeX = x - origin.x;
        const relativeY = y - origin.y;
        const along = relativeX * tangentX + relativeY * tangentY;
        const across = Math.abs(relativeX * normalX + relativeY * normalY);
        if (across > radiusPixels || Math.abs(along) > radiusPixels) continue;
        const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
        if (along < 0) backMass += alpha;
        else forwardMass += alpha;
      }
    }
  }
  return {
    nonZeroPixels,
    alphaMean: mean / 255,
    alphaStandardDeviation: Math.sqrt(variance),
    edgeDensity: edgeCount / Math.max(1, neighbourCount),
    neighbourDifference:
      (horizontalDifference + verticalDifference)
      / Math.max(1, horizontalPairs + verticalPairs),
    periodicity,
    circleCarrierExposure: periodicity * Math.min(1, Math.sqrt(variance) / 64),
    startBackMassRatio: backMass / Math.max(1, forwardMass),
    centerlineGapsAfterStart: centerline.slice(2).filter((alpha) => alpha <= 0).length,
    horizontalVariation,
    verticalVariation,
    directionalAnisotropy: Math.max(horizontalVariation, verticalVariation)
      / Math.max(0.001, Math.min(horizontalVariation, verticalVariation)),
  };
}

function writePatch(
  destination: Uint8Array,
  surfaceWidth: number,
  frame: StudioHokusaiLiveFrame,
): void {
  const [x, y, width, height] = frame.dirtyBounds;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * width * 4;
    const destinationStart = ((y + row) * surfaceWidth + x) * 4;
    destination.set(
      frame.pixels.subarray(sourceStart, sourceStart + width * 4),
      destinationStart,
    );
  }
}

function crop(
  source: Uint8Array,
  surfaceWidth: number,
  bounds: readonly [number, number, number, number],
): Uint8Array {
  const [x, y, width, height] = bounds;
  const result = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * surfaceWidth + x) * 4;
    result.set(
      source.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", exact as ArrayBuffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

async function drawCanonicalPng(
  target: HTMLCanvasElement,
  pngBytes: ArrayBuffer,
  placement: Readonly<{ x: number; y: number; width: number; height: number }>,
  scale = VIEW_SCALE,
): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
  try {
    const context = target.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canonical evidence canvas is unavailable.");
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(
      bitmap,
      placement.x * scale,
      placement.y * scale,
      placement.width * scale,
      placement.height * scale,
    );
  } finally {
    bitmap.close();
  }
}

async function renderQualityFamily(
  provider: StudioHokusaiLiveBrushProvider,
  presetId: QualityPresetId,
): Promise<Readonly<{
  presetId: QualityPresetId;
  metrics: LiveMaterialQualityMetrics;
  exactLiveCommitParity: boolean;
  browserComposedExactCanonical: boolean;
  settledPixelHash: string;
  pngHash: string;
  totalMilliseconds: number;
  timing: Readonly<{
    beginMilliseconds: number;
    appendDispatchMilliseconds: number;
    workerRoundTripAndCanonicalMilliseconds: number;
    framePresentationTotalMilliseconds: number;
    framePresentationMaximumMilliseconds: number;
    parityVerificationMilliseconds: number;
    canonicalDrawMilliseconds: number;
    qualityAnalysisMilliseconds: number;
  }>;
}>> {
  const samples = qualityStrokeSamples();
  const route = provider.admitStroke({
    brushId: presetId,
    catalogId: presetId,
    documentWidth: QUALITY_WIDTH,
    documentHeight: QUALITY_HEIGHT,
    firstX: samples[0]!.x,
    firstY: samples[0]!.y,
    radiusPixels: QUALITY_RADIUS,
    color: "#302631",
    opacity: 0.95,
    seed: 0x0bad_cafe,
  });
  if (route.status !== "ready") throw new Error(`${presetId} quality route was not ready.`);
  const composed = new Uint8Array(
    route.config.surfaceWidth * route.config.surfaceHeight * 4,
  );
  const target = canvas(`quality-${presetId}`);
  const overlay = new StudioHokusaiLiveOverlayRenderer(target);
  const projection = {
    documentX: 0,
    documentY: 0,
    scaleX: 1,
    scaleY: 1,
    devicePixelRatio: 1,
  } as const;
  const started = performance.now();
  const beginStarted = performance.now();
  let framePresentationTotalMilliseconds = 0;
  let framePresentationMaximumMilliseconds = 0;
  const session = await provider.beginStroke(route, {
    strokeId: `quality-${presetId}`,
    signal: new AbortController().signal,
    onFrame: (frame) => {
      const presentationStarted = performance.now();
      writePatch(composed, route.config.surfaceWidth, frame);
      const result = overlay.present(frame, projection);
      if (result.status !== "presented") {
        throw new Error(`${presetId} quality overlay rejected: ${result.reason}`);
      }
      const presentationMilliseconds = performance.now() - presentationStarted;
      framePresentationTotalMilliseconds += presentationMilliseconds;
      framePresentationMaximumMilliseconds = Math.max(
        framePresentationMaximumMilliseconds,
        presentationMilliseconds,
      );
    },
  });
  const beginMilliseconds = performance.now() - beginStarted;
  const appendStarted = performance.now();
  // Match Studio's real pointer lifecycle: pointer-down is forwarded as a
  // one-sample prefix before coalesced move batches arrive. Slow-tracking
  // media may accept that contact without producing dirty pixels yet.
  session.append(samples.slice(0, 1));
  for (let offset = 1; offset < samples.length; offset += 32) {
    session.append(samples.slice(offset, offset + 32));
  }
  const appendDispatchMilliseconds = performance.now() - appendStarted;
  const workerRoundTripStarted = performance.now();
  const canonical = await session.finish();
  const workerRoundTripAndCanonicalMilliseconds = performance.now() - workerRoundTripStarted;
  const parityStarted = performance.now();
  const composedCrop = crop(
    composed,
    route.config.surfaceWidth,
    canonical.finalFrame.dirtyBounds,
  );
  const exact = equalBytes(composedCrop, canonical.finalFrame.pixels);
  const parityVerificationMilliseconds = performance.now() - parityStarted;
  const canonicalDrawStarted = performance.now();
  await drawCanonicalPng(
    target,
    canonical.pngBytes,
    canonical.finalFrame.logicalPlacement,
    1,
  );
  const canonicalDrawMilliseconds = performance.now() - canonicalDrawStarted;
  const qualityAnalysisStarted = performance.now();
  const metrics = liveMaterialQualityMetrics(
    canonical.finalFrame.pixels,
    canonical.finalFrame.dirtyBounds[2],
    canonical.finalFrame.dirtyBounds[3],
    canonical.finalFrame.logicalPlacement,
    samples,
    QUALITY_RADIUS,
  );
  const qualityAnalysisMilliseconds = performance.now() - qualityAnalysisStarted;
  return {
    presetId,
    metrics,
    exactLiveCommitParity: canonical.receipt.exactLiveCommitParity,
    browserComposedExactCanonical: exact,
    settledPixelHash: canonical.receipt.settledPixelHash,
    pngHash: canonical.receipt.pngHash,
    totalMilliseconds: performance.now() - started,
    timing: {
      beginMilliseconds,
      appendDispatchMilliseconds,
      workerRoundTripAndCanonicalMilliseconds,
      framePresentationTotalMilliseconds,
      framePresentationMaximumMilliseconds,
      parityVerificationMilliseconds,
      canonicalDrawMilliseconds,
      qualityAnalysisMilliseconds,
    },
  };
}

async function renderSparseFigureEightCoverage(
  provider: StudioHokusaiLiveBrushProvider,
): Promise<Readonly<{
  sampleCount: number;
  receiptSampleCount: number;
  leftCoverage: number;
  rightCoverage: number;
  leftAlphaMassRatio: number;
  rightAlphaMassRatio: number;
  sourceBounds: readonly [number, number, number, number];
  canonicalBounds: readonly [number, number, number, number];
  browserComposedExactCanonical: boolean;
}>> {
  const samples = sparseFigureEightSamples();
  const route = provider.admitStroke({
    brushId: "crayon",
    catalogId: "crayon",
    documentWidth: QUALITY_WIDTH,
    documentHeight: QUALITY_HEIGHT,
    firstX: samples[0]!.x,
    firstY: samples[0]!.y,
    radiusPixels: 14,
    color: "#7455a8",
    opacity: 0.88,
    seed: 0x51a7_8e11,
  });
  if (route.status !== "ready") throw new Error("Sparse figure-eight route was not ready.");
  const composed = new Uint8Array(
    route.config.surfaceWidth * route.config.surfaceHeight * 4,
  );
  const session = await provider.beginStroke(route, {
    strokeId: "quality-sparse-figure-eight",
    signal: new AbortController().signal,
    onFrame: (frame) => writePatch(composed, route.config.surfaceWidth, frame),
  });
  session.append(samples.slice(0, 1));
  for (let offset = 1; offset < samples.length; offset += 4) {
    session.append(samples.slice(offset, offset + 4));
  }
  const canonical = await session.finish();
  const [, , dirtyWidth, dirtyHeight] = canonical.finalFrame.dirtyBounds;
  const placement = canonical.finalFrame.logicalPlacement;
  const composedCrop = crop(
    composed,
    route.config.surfaceWidth,
    canonical.finalFrame.dirtyBounds,
  );
  const coverage = (side: "left" | "right"): number => {
    const candidates = samples.filter(({ x }) => (
      side === "left" ? x < 492 : x > 532
    ));
    const covered = candidates.filter(({ x, y }) => (
      alphaAt(
        canonical.finalFrame.pixels,
        dirtyWidth,
        dirtyHeight,
        x - placement.x,
        y - placement.y,
        24,
      ) > 0
    ));
    return covered.length / Math.max(1, candidates.length);
  };
  const xs = samples.map(({ x }) => x);
  const ys = samples.map(({ y }) => y);
  let totalAlphaMass = 0;
  let leftAlphaMass = 0;
  let rightAlphaMass = 0;
  for (let y = 0; y < dirtyHeight; y += 1) {
    for (let x = 0; x < dirtyWidth; x += 1) {
      const alpha = canonical.finalFrame.pixels[(y * dirtyWidth + x) * 4 + 3] ?? 0;
      totalAlphaMass += alpha;
      const documentX = placement.x + x;
      if (documentX < 492) leftAlphaMass += alpha;
      if (documentX > 532) rightAlphaMass += alpha;
    }
  }
  await drawCanonicalPng(
    canvas("quality-sparse-figure-eight"),
    canonical.pngBytes,
    placement,
    1,
  );
  return {
    sampleCount: samples.length,
    receiptSampleCount: canonical.receipt.sampleCount,
    leftCoverage: coverage("left"),
    rightCoverage: coverage("right"),
    leftAlphaMassRatio: leftAlphaMass / Math.max(1, totalAlphaMass),
    rightAlphaMassRatio: rightAlphaMass / Math.max(1, totalAlphaMass),
    sourceBounds: [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ],
    canonicalBounds: [
      placement.x,
      placement.y,
      placement.x + dirtyWidth,
      placement.y + dirtyHeight,
    ],
    browserComposedExactCanonical: equalBytes(
      composedCrop,
      canonical.finalFrame.pixels,
    ),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const liveCanvas = canvas("live-frame");
  const firstCanvas = canvas("first-frame");
  const canonicalCanvas = canvas("canonical-frame");
  const liveOverlay = new StudioHokusaiLiveOverlayRenderer(liveCanvas);
  const firstOverlay = new StudioHokusaiLiveOverlayRenderer(firstCanvas);
  const projection = {
    documentX: 0,
    documentY: 0,
    scaleX: VIEW_SCALE,
    scaleY: VIEW_SCALE,
    devicePixelRatio: 1,
  } as const;
  const provider = new StudioHokusaiLiveBrushProvider({
    startupTimeoutMs: 30_000,
    finishTimeoutMs: 90_000,
  });
  const mainThreadDelayTracker = createMainThreadDelayTracker("startup-prewarm");
  try {
    const prewarmStarted = performance.now();
    const capabilities = await provider.prewarm();
    const prewarmMilliseconds = performance.now() - prewarmStarted;
    // Let the overdue interval produced by Worker/WASM startup run before the
    // phase boundary. Otherwise startup cost can be falsely assigned to input.
    await delay(12);
    mainThreadDelayTracker.setPhase("stroke-setup");
    const routeInput = {
      brushId: "charcoal",
      catalogId: "charcoal",
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      firstX: 180,
      firstY: 512,
      radiusPixels: 18,
      color: "#202631" as const,
      opacity: 0.92,
      seed: 0x5eeda11,
    };
    const route = provider.admitStroke(routeInput);
    if (route.status !== "ready") {
      throw new Error(`Hokusai live admission failed: ${route.status}`);
    }

    const composed = new Uint8Array(
      route.config.surfaceWidth * route.config.surfaceHeight * 4,
    );
    const appendTimes = new Map<number, number>();
    const frameMetrics: Array<Readonly<{
      sequence: number;
      phase: StudioHokusaiLiveFrame["phase"];
      bytes: number;
      appendToFrameMilliseconds: number | null;
      callbackMilliseconds: number;
      composeMilliseconds: number;
      overlayMilliseconds: number;
      dirtyBounds: readonly [number, number, number, number];
      pixelHash: string;
    }>> = [];
    let firstFramePresented = false;
    let activePresentationCallbacks = 0;
    let maximumConcurrentPresentationCallbacks = 0;
    const session = await provider.beginStroke(route, {
      strokeId: "browser-live-long-stroke",
      signal: new AbortController().signal,
      onFrame: (frame) => {
        const callbackStarted = performance.now();
        activePresentationCallbacks += 1;
        maximumConcurrentPresentationCallbacks = Math.max(
          maximumConcurrentPresentationCallbacks,
          activePresentationCallbacks,
        );
        try {
          const composeStarted = performance.now();
          writePatch(composed, route.config.surfaceWidth, frame);
          const composeMilliseconds = performance.now() - composeStarted;
          const overlayStarted = performance.now();
          const presented = liveOverlay.present(frame, projection);
          const overlayMilliseconds = performance.now() - overlayStarted;
          if (presented.status !== "presented") {
            throw new Error(`Live overlay rejected ${frame.phase}: ${presented.reason}`);
          }
          if (!firstFramePresented) {
            const first = firstOverlay.present(frame, projection);
            if (first.status !== "presented") {
              throw new Error(`First-frame overlay rejected: ${first.reason}`);
            }
            firstFramePresented = true;
          }
          const appendAt = appendTimes.get(frame.sequence);
          frameMetrics.push({
            sequence: frame.sequence,
            phase: frame.phase,
            bytes: frame.pixels.byteLength,
            appendToFrameMilliseconds: appendAt === undefined
              ? null
              : performance.now() - appendAt,
            callbackMilliseconds: performance.now() - callbackStarted,
            composeMilliseconds,
            overlayMilliseconds,
            dirtyBounds: frame.dirtyBounds,
            pixelHash: frame.pixelHash,
          });
        } finally {
          activePresentationCallbacks -= 1;
        }
      },
    });
    const samples = longStrokeSamples();
    await delay(12);
    mainThreadDelayTracker.setPhase("interactive-5k");
    const renderStarted = performance.now();
    let batchCount = 0;
    let appendDispatchTotalMilliseconds = 0;
    let appendDispatchMaximumMilliseconds = 0;
    for (let offset = 0; offset < samples.length; offset += BATCH_SIZE) {
      const appendStarted = performance.now();
      const sequence = session.append(samples.slice(offset, offset + BATCH_SIZE));
      const appendMilliseconds = performance.now() - appendStarted;
      appendDispatchTotalMilliseconds += appendMilliseconds;
      appendDispatchMaximumMilliseconds = Math.max(
        appendDispatchMaximumMilliseconds,
        appendMilliseconds,
      );
      appendTimes.set(sequence, performance.now());
      batchCount += 1;
    }
    const canonical = await session.finish();
    const totalRenderMilliseconds = performance.now() - renderStarted;
    // Include the complete-message callback, transferred canonical validation,
    // and its timer wake-up in the real interactive phase before switching.
    await delay(12);
    mainThreadDelayTracker.setPhase("canonical-verification");
    const composedCrop = crop(
      composed,
      route.config.surfaceWidth,
      canonical.finalFrame.dirtyBounds,
    );
    const browserComposedHash = await sha256(composedCrop);
    const browserComposedExactCanonical = equalBytes(
      composedCrop,
      canonical.finalFrame.pixels,
    );
    await drawCanonicalPng(
      canonicalCanvas,
      canonical.pngBytes,
      canonical.finalFrame.logicalPlacement,
    );

    await delay(12);
    mainThreadDelayTracker.setPhase("cancel-recovery");
    const cancelRoute = provider.admitStroke({
      ...routeInput,
      brushId: "pencil",
      catalogId: "pencil",
      seed: 0x1234,
    });
    if (cancelRoute.status !== "ready") throw new Error("Cancel route was not ready.");
    const cancelled = await provider.beginStroke(cancelRoute, {
      strokeId: "browser-live-cancelled",
      signal: new AbortController().signal,
      onFrame: () => undefined,
    });
    cancelled.cancel("user-cancelled");
    await delay(40);
    const recoveryRoute = provider.admitStroke({
      ...routeInput,
      brushId: "oil",
      catalogId: "oil",
      seed: 0x5678,
    });
    if (recoveryRoute.status !== "ready") throw new Error("Recovery route was not ready.");
    const recovery = await provider.beginStroke(recoveryRoute, {
      strokeId: "browser-live-recovery",
      signal: new AbortController().signal,
      onFrame: () => undefined,
    });
    recovery.append([
      { x: 300, y: 400, pressure: 0.4, timeMilliseconds: 0 },
      { x: 360, y: 430, pressure: 0.8, timeMilliseconds: 8 },
    ]);
    const recoveryResult = await recovery.finish();

    await delay(12);
    mainThreadDelayTracker.stop();
    const mainThreadDelayByPhase = mainThreadDelayTracker.snapshot();
    const frameCallbackMaximumMilliseconds = Math.max(
      0,
      ...frameMetrics.map(({ callbackMilliseconds }) => callbackMilliseconds),
    );
    const frameComposeMaximumMilliseconds = Math.max(
      0,
      ...frameMetrics.map(({ composeMilliseconds }) => composeMilliseconds),
    );
    const frameOverlayMaximumMilliseconds = Math.max(
      0,
      ...frameMetrics.map(({ overlayMilliseconds }) => overlayMilliseconds),
    );
    // Material analysis below is intentionally synchronous verifier work and
    // is excluded from shipped main-thread input latency.
    const materialFamilies = [];
    for (
      const presetId of
      ["pencil", "charcoal", "oil", "calligraphy", "marker"] as const
    ) {
      materialFamilies.push(await renderQualityFamily(provider, presetId));
    }
    const sparseFigureEightCoverage = await renderSparseFigureEightCoverage(provider);

    const liveFrames = frameMetrics.filter(({ phase }) => phase === "live");
    const tailFrames = frameMetrics.filter(({ phase }) => phase === "settle-tail");
    const latencies = liveFrames
      .map(({ appendToFrameMilliseconds }) => appendToFrameMilliseconds)
      .filter((value): value is number => value !== null);
    window.__studioHokusaiLiveQualityResult = {
      status: "ok",
      backend: "real-chromium-dedicated-worker-hokusai-wasm-dirty-delta-live-v1",
      capabilities,
      ready: provider.state === "ready",
      prewarmMilliseconds,
      document: {
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        surfaceWidth: route.config.surfaceWidth,
        surfaceHeight: route.config.surfaceHeight,
      },
      sampleCount: samples.length,
      batchCount,
      liveFrameCount: liveFrames.length,
      settleTailFrameCount: tailFrames.length,
      stalePresentationsCoalesced: liveFrames.length < batchCount,
      maximumConcurrentPresentationCallbacks,
      totalTransferredBytes: frameMetrics.reduce((sum, frame) => sum + frame.bytes, 0),
      maximumTransferredFrameBytes: Math.max(...frameMetrics.map(({ bytes }) => bytes)),
      appendToFrameLatency: {
        maximumMilliseconds: Math.max(...latencies),
        averageMilliseconds: latencies.reduce((sum, value) => sum + value, 0)
          / Math.max(1, latencies.length),
      },
      totalRenderMilliseconds,
      maximumMainThreadDelayMilliseconds:
        mainThreadDelayByPhase["interactive-5k"].maximumDelayMilliseconds,
      performanceReceipt: {
        version: "studio-hokusai-live-performance-v1",
        sampleIntervalMilliseconds: MAIN_THREAD_SAMPLE_INTERVAL_MS,
        interactiveBudgetMilliseconds: MAIN_THREAD_INTERACTIVE_BUDGET_MS,
        mainThreadDelayByPhase,
        appendDispatchTotalMilliseconds,
        appendDispatchMaximumMilliseconds,
        frameCallbackMaximumMilliseconds,
        frameComposeMaximumMilliseconds,
        frameOverlayMaximumMilliseconds,
      },
      browserComposedExactCanonical,
      browserComposedHash,
      finalCanonicalHash: canonical.receipt.settledPixelHash,
      pngHash: canonical.receipt.pngHash,
      inputHash: canonical.receipt.inputHash,
      exactLiveCommitParity: canonical.receipt.exactLiveCommitParity,
      finalSequence: canonical.receipt.finalSequence,
      frameMetrics,
      cancelRecovery: {
        cancelledStrokeReleased: true,
        recoveryComplete: recoveryResult.receipt.complete,
        recoveryEngineEpoch: recoveryResult.receipt.engineEpoch,
      },
      materialFamilies,
      sparseFigureEightCoverage,
    };
  } finally {
    mainThreadDelayTracker.stop();
    provider.close();
  }
}

void main().catch((error) => {
  window.__studioHokusaiLiveQualityResult = {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
});
