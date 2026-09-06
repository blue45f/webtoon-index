/**
 * Browser quality gate for representative shipped Studio brush media.
 *
 * Unlike the exhaustive catalogue verifier, this gate inspects a small, intentional cross-section
 * deeply: pencil, G-pen, airbrush, wet/granular watercolor, fibrous texture, oil/bristle, and
 * highlighter. Each medium is drawn through the production `/studio` UI on an isolated page,
 * captured live, settled after pointerup, undone, redone, and accumulated over three identical
 * curved passes.
 *
 * Run after `pnpm build`:
 *   pnpm run verify:studio-brush-media
 *
 * Evidence:
 *   TOONSPECTRUM_BRUSH_MEDIA_VERIFY_DIR=/tmp/my-run \
 *     pnpm run verify:studio-brush-media
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { decodePng } from "image-js";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";

import {
  enabledStudioHistoryControl,
} from "./lib/studio-verify-history-controls.mjs";
import {
  cleanScratchDir,
  findFreePort,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";
import {
  analyzeStudioBrushMediaPixelQuality,
} from "./studio-brush-media-pixel-quality";
import {
  STUDIO_BRUSH_MEDIA_CASES,
  evaluateStudioBrushMediaCase,
  evaluateStudioBrushMediaSuite,
  type StudioBrushMediaAccumulationMetrics,
  type StudioBrushMediaArtifactQualityMetrics,
  type StudioBrushMediaCaseMetrics,
  type StudioBrushMediaCasePolicy,
  type StudioBrushMediaFrameMetrics,
  type StudioBrushMediaPixelDiff,
  type StudioBrushMediaTransitionMetrics,
} from "./studio-brush-media-quality-policy";

const SCRATCH =
  process.env.TOONSPECTRUM_BRUSH_MEDIA_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-brush-media");
const LOG_PATH = join(SCRATCH, "studio-brush-media-verify.log");
const REPORT_PATH = join(SCRATCH, "studio-brush-media-report.json");
const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const AUTOSAVE_PREFIX = "toonspectrum-studio-autosave";
const OPTIONAL_STATIC_PREVIEW_PATHS = [
  "/api/auth/session",
  "/api/kmas/merge-on-access",
  "/api/studio-ai/status",
  "/api/analytics/traffic/",
  "/socket.io/",
] as const;
const SETTLE_MS = 340;

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface ScreenshotClip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BrowserFrameMetrics extends StudioBrushMediaFrameMetrics {
  readonly bounds: Readonly<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }> | null;
}

interface BrushRoute {
  readonly points: readonly ScreenPoint[];
  readonly localPoints: readonly ScreenPoint[];
  readonly clip: ScreenshotClip;
  readonly supportRadius: number;
  readonly crossSectionRadius: number;
  readonly cursorIgnoreRadius: number;
}

interface BrowserErrors {
  readonly console: string[];
  readonly page: string[];
  readonly responses: string[];
}

interface BrushMediaArtifacts {
  readonly baseline: string;
  readonly live: string;
  readonly released: string;
  readonly settled: string;
  readonly undo: string;
  readonly redo: string;
  readonly pass2: string;
  readonly pass3: string;
}

interface BrushMediaBrowserResult {
  readonly id: StudioBrushMediaCasePolicy["id"];
  readonly name: string;
  readonly medium: StudioBrushMediaCasePolicy["medium"];
  readonly source: StudioBrushCatalogItem["source"];
  readonly runtimeMs: number;
  readonly route: Readonly<{
    sampleCount: number;
    supportRadius: number;
    crossSectionRadius: number;
    cursorIgnoreRadius: number;
    clip: ScreenshotClip;
  }>;
  readonly metrics: StudioBrushMediaCaseMetrics;
  readonly evaluation: ReturnType<typeof evaluateStudioBrushMediaCase>;
  readonly artifacts: BrushMediaArtifacts;
  readonly browserErrors: BrowserErrors;
}

function log(message: string): void {
  const line = `[verify-studio-brush-media] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_PATH, `${line}\n`);
  } catch {
    // The verifier's policy result remains authoritative if diagnostics cannot be appended.
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedStaticPreviewFailure(message: string): boolean {
  return OPTIONAL_STATIC_PREVIEW_PATHS.some((path) => message.includes(path));
}

function collectBrowserErrors(page: Page, label: string): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [], responses: [] };
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const message = entry.location().url
      ? `${entry.text()} @ ${entry.location().url}`
      : entry.text();
    if (!expectedStaticPreviewFailure(message)) errors.console.push(`${label}: ${message}`);
  });
  page.on("pageerror", (error) => {
    errors.page.push(`${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const message = `${response.status()} ${response.url()}`;
    if (!expectedStaticPreviewFailure(message)) errors.responses.push(`${label}: ${message}`);
  });
  return errors;
}

async function installIsolatedStudioState(page: Page): Promise<void> {
  await page.addInitScript(
    ({ autosavePrefix, mobileHintKey, quickstartKey }) => {
      try {
        window.localStorage.setItem(quickstartKey, "1");
        window.localStorage.setItem(mobileHintKey, "1");
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(autosavePrefix)) window.localStorage.removeItem(key);
        }
      } catch {
        // The visible browser assertions remain strict when storage is unavailable.
      }
    },
    {
      autosavePrefix: AUTOSAVE_PREFIX,
      mobileHintKey: MOBILE_HINT_KEY,
      quickstartKey: QUICKSTART_KEY,
    },
  );
}

async function prepareStudioPage(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(9_000);
  await installIsolatedStudioState(page);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
  // `tsx` preserves nested evaluator function names through an esbuild helper. Playwright
  // serializes the evaluator body without that module-scoped helper, so provide the standard
  // identity implementation inside this isolated QA page before pixel-analysis evaluators run.
  await page.evaluate("globalThis.__name ??= (target) => target");
  const stage = page.locator(".konvajs-content").first();
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("b");
  const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
  await toolbar.waitFor({ state: "visible", timeout: 10_000 });
  const pen = toolbar.getByRole("button", { name: "펜", exact: true });
  if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
  await toolbar.getByRole("button", { name: /브러시 선택 열기$/u }).waitFor({
    state: "visible",
  });

  const shell = await page.evaluate(() => ({
    hasErrorOverlay: Boolean(
      document.querySelector(
        "vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay",
      ),
    ),
    bodyTextLength: document.body.innerText.trim().length,
  }));
  invariant(shell.bodyTextLength > 0, "Studio rendered a blank document");
  invariant(!shell.hasErrorOverlay, "Studio rendered a Vite error overlay");
}

async function selectBrush(
  page: Page,
  brush: Pick<StudioBrushCatalogItem, "id" | "name">,
): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
  await toolbar.getByRole("button", { name: /브러시 선택 열기$/u }).click();
  const catalog = page.getByRole("dialog", { name: "브러시 전체 라이브러리" });
  await catalog.waitFor({ state: "visible" });
  await catalog.getByRole("searchbox", { name: "전체 브러시 검색" }).fill(brush.id);
  const option = catalog.getByRole("button", {
    name: `${brush.name} 선택`,
    exact: true,
  });
  await option.waitFor({ state: "visible" });
  await option.click();
  await catalog.waitFor({ state: "detached" });
  await toolbar.getByRole("button", {
    name: new RegExp(`^현재 도구 ${escapeRegExp(brush.name)},`, "u"),
  }).waitFor({ state: "visible" });
  await page.mouse.move(4, 4);
  await page.waitForTimeout(100);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sanitizeClip(
  clip: ScreenshotClip,
  viewport: { width: number; height: number },
): ScreenshotClip {
  const x = Math.max(0, Math.min(viewport.width - 2, Math.floor(clip.x)));
  const y = Math.max(0, Math.min(viewport.height - 2, Math.floor(clip.y)));
  return {
    x,
    y,
    width: Math.max(2, Math.min(viewport.width - x, Math.ceil(clip.width))),
    height: Math.max(2, Math.min(viewport.height - y, Math.ceil(clip.height))),
  };
}

function createBrushRoute(
  stageBox: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  defaultWidth: number,
): BrushRoute {
  const left = Math.max(stageBox.x + 90, viewport.width * 0.33);
  const right = Math.min(stageBox.x + stageBox.width - 90, viewport.width * 0.68);
  const safeTop = Math.max(stageBox.y + 110, viewport.height * 0.24);
  const safeBottom = Math.min(stageBox.y + stageBox.height - 110, viewport.height * 0.61);
  invariant(right - left >= 360, "visible Studio canvas is too narrow for media quality route");
  invariant(safeBottom - safeTop >= 180, "visible Studio canvas is too short for media quality route");

  const centerY = (safeTop + safeBottom) / 2;
  const amplitude = Math.min(58, (safeBottom - safeTop) * 0.28);
  const points = Array.from({ length: 81 }, (_, index) => {
    const t = index / 80;
    return {
      x: left + (right - left) * t,
      y: centerY
        + Math.sin(t * Math.PI * 2) * amplitude
        + Math.sin(t * Math.PI * 4) * amplitude * 0.16,
    };
  });
  const margin = Math.max(52, Math.min(104, defaultWidth * 1.35));
  const clip = sanitizeClip({
    x: left - margin,
    y: centerY - amplitude * 1.2 - margin,
    width: right - left + margin * 2,
    height: amplitude * 2.4 + margin * 2,
  }, viewport);
  return {
    points,
    localPoints: points.map((point) => ({
      x: point.x - clip.x,
      y: point.y - clip.y,
    })),
    clip,
    supportRadius: Math.max(4, Math.min(18, defaultWidth * 0.36)),
    crossSectionRadius: Math.max(12, Math.min(90, defaultWidth * 1.45)),
    cursorIgnoreRadius: Math.max(14, Math.min(50, defaultWidth / 2 + 8)),
  };
}

async function assertRouteHitsCanvas(page: Page, points: readonly ScreenPoint[]): Promise<void> {
  const sampled = points.filter((_, index) => index % 8 === 0);
  const misses = await page.evaluate((route) => route.flatMap((point) => {
    const target = document.elementFromPoint(point.x, point.y);
    return target?.closest(".konvajs-content") ? [] : [{
      x: point.x,
      y: point.y,
      target: target?.tagName ?? null,
      className: typeof target?.className === "string" ? target.className : null,
    }];
  }), sampled);
  invariant(misses.length === 0, `media route is covered by editor chrome: ${JSON.stringify(misses)}`);
}

async function screenshot(page: Page, clip: ScreenshotClip): Promise<Buffer> {
  return page.screenshot({ animations: "disabled", clip });
}

async function drawCurve(
  page: Page,
  points: readonly ScreenPoint[],
  onLive?: () => Promise<void>,
): Promise<void> {
  const first = points[0];
  invariant(first, "brush route has no starting point");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y);
  }
  if (onLive) {
    await page.waitForTimeout(50);
    await onLive();
  }
  await page.mouse.up();
  await page.mouse.move(4, 4);
}

async function waitForHistoryButton(
  page: Page,
  ariaLabel: "실행취소" | "다시실행",
): Promise<Locator> {
  return enabledStudioHistoryControl(page, ariaLabel === "실행취소" ? "undo" : "redo");
}

async function analyzeFrame(
  page: Page,
  baseline: Buffer,
  frame: Buffer,
  route: BrushRoute,
  tolerance = 3,
): Promise<BrowserFrameMetrics> {
  return page.evaluate(async ({
    baselineBase64,
    frameBase64,
    localPoints,
    supportRadius,
    crossSectionRadius,
    pixelTolerance,
  }) => {
    const decode = async (base64: string) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("could not decode brush-media screenshot");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };
    const [before, after] = await Promise.all([
      decode(baselineBase64),
      decode(frameBase64),
    ]);
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error("brush-media screenshots have different dimensions");
    }

    const width = before.width;
    const height = before.height;
    const deltas = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    let changedPixels = 0;
    let maxChannelDelta = 0;
    let totalDelta = 0;
    let totalSquaredDelta = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const delta = Math.max(
        Math.abs(before.data[offset]! - after.data[offset]!),
        Math.abs(before.data[offset + 1]! - after.data[offset + 1]!),
        Math.abs(before.data[offset + 2]! - after.data[offset + 2]!),
      );
      deltas[pixel] = delta;
      histogram[delta]! += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta <= pixelTolerance) continue;
      changedPixels += 1;
      totalDelta += delta;
      totalSquaredDelta += delta * delta;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }

    const pixelDelta = (x: number, y: number): number => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      if (roundedX < 0 || roundedX >= width || roundedY < 0 || roundedY >= height) return 0;
      return deltas[roundedY * width + roundedX] ?? 0;
    };
    const pointCovered = (point: { x: number; y: number }): boolean => {
      const radius = Math.max(1, Math.ceil(supportRadius));
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          if (pixelDelta(point.x + dx, point.y + dy) > pixelTolerance) return true;
        }
      }
      return false;
    };

    const coverage = localPoints.map(pointCovered);
    let longestGapSamples = 0;
    let gapRun = 0;
    for (const covered of coverage) {
      if (covered) {
        longestGapSamples = Math.max(longestGapSamples, gapRun);
        gapRun = 0;
      } else {
        gapRun += 1;
      }
    }
    longestGapSamples = Math.max(longestGapSamples, gapRun);

    const widths: number[] = [];
    for (let index = 1; index + 1 < localPoints.length; index += 1) {
      const previous = localPoints[index - 1]!;
      const current = localPoints[index]!;
      const next = localPoints[index + 1]!;
      const tangentX = next.x - previous.x;
      const tangentY = next.y - previous.y;
      const length = Math.hypot(tangentX, tangentY);
      if (length <= 0.0001) continue;
      const normalX = -tangentY / length;
      const normalY = tangentX / length;
      let minimum: number | null = null;
      let maximum: number | null = null;
      const radius = Math.max(1, Math.ceil(crossSectionRadius));
      for (let offset = -radius; offset <= radius; offset += 1) {
        if (
          pixelDelta(
            current.x + normalX * offset,
            current.y + normalY * offset,
          ) <= pixelTolerance
        ) continue;
        minimum = minimum === null ? offset : Math.min(minimum, offset);
        maximum = maximum === null ? offset : Math.max(maximum, offset);
      }
      if (minimum !== null && maximum !== null) widths.push(maximum - minimum + 1);
    }
    const widthMean = widths.length > 0
      ? widths.reduce((sum, value) => sum + value, 0) / widths.length
      : 0;
    const widthVariance = widths.length > 0
      ? widths.reduce((sum, value) => sum + (value - widthMean) ** 2, 0) / widths.length
      : 0;
    const scallopCoefficient = widthMean > 0
      ? Math.sqrt(widthVariance) / widthMean
      : null;

    const bounds = right >= left && bottom >= top
      ? { left, top, right, bottom }
      : null;
    const gridSize = 8;
    const gridEnergy = new Float64Array(gridSize * gridSize);
    const gridPixels = new Uint32Array(gridSize * gridSize);
    if (bounds) {
      const boundsWidth = Math.max(1, bounds.right - bounds.left + 1);
      const boundsHeight = Math.max(1, bounds.bottom - bounds.top + 1);
      for (let y = bounds.top; y <= bounds.bottom; y += 1) {
        for (let x = bounds.left; x <= bounds.right; x += 1) {
          const delta = deltas[y * width + x] ?? 0;
          const cellX = Math.min(
            gridSize - 1,
            Math.floor(((x - bounds.left) / boundsWidth) * gridSize),
          );
          const cellY = Math.min(
            gridSize - 1,
            Math.floor(((y - bounds.top) / boundsHeight) * gridSize),
          );
          const cell = cellY * gridSize + cellX;
          gridPixels[cell]! += 1;
          if (delta > pixelTolerance) gridEnergy[cell]! += delta / 255;
        }
      }
    }
    const normalizedGrid = [...gridEnergy].map((energy, index) => (
      energy / Math.max(1, gridPixels[index] ?? 0)
    ));
    const meanChannelDelta = totalDelta / Math.max(1, changedPixels);
    const deltaVariance = Math.max(
      0,
      totalSquaredDelta / Math.max(1, changedPixels) - meanChannelDelta ** 2,
    );
    const textureCoefficient = meanChannelDelta > 0
      ? Math.sqrt(deltaVariance) / meanChannelDelta
      : 0;
    let textureEntropy = 0;
    if (changedPixels > 0) {
      for (let value = pixelTolerance + 1; value < histogram.length; value += 1) {
        const count = histogram[value] ?? 0;
        if (count <= 0) continue;
        const probability = count / changedPixels;
        textureEntropy -= probability * Math.log2(probability);
      }
      textureEntropy /= Math.log2(Math.max(2, 255 - pixelTolerance));
    }
    const featureVector = [
      changedPixels / Math.max(1, width * height),
      totalDelta / Math.max(1, changedPixels * 255),
      (scallopCoefficient ?? 0) / 2,
      Math.min(1, textureCoefficient),
      textureEntropy,
      ...normalizedGrid,
    ];
    const quantized = featureVector.map((value) => (
      Math.max(0, Math.min(255, Math.round(value * 255)))
    ));
    let hash = 0x811c9dc5;
    for (const value of quantized) {
      hash ^= value;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    const p95Target = Math.max(1, Math.ceil(changedPixels * 0.95));
    let p95ChannelDelta = 0;
    let observed = 0;
    for (let value = pixelTolerance + 1; value < histogram.length; value += 1) {
      observed += histogram[value] ?? 0;
      if (observed >= p95Target) {
        p95ChannelDelta = value;
        break;
      }
    }

    return {
      changedPixels,
      totalPixels: width * height,
      maxChannelDelta,
      inkEnergy: totalDelta / 255,
      meanChannelDelta,
      p95ChannelDelta,
      textureCoefficient,
      textureEntropy,
      pathCoverage: coverage.filter(Boolean).length / Math.max(1, coverage.length),
      longestGapSamples,
      pathSamples: coverage.length,
      scallopCoefficient,
      fingerprint: hash.toString(16).padStart(8, "0"),
      featureVector,
      bounds,
    };
  }, {
    baselineBase64: baseline.toString("base64"),
    frameBase64: frame.toString("base64"),
    localPoints: route.localPoints,
    supportRadius: route.supportRadius,
    crossSectionRadius: route.crossSectionRadius,
    pixelTolerance: tolerance,
  });
}

async function compareFrames(
  page: Page,
  first: Buffer,
  second: Buffer,
  tolerance: number,
): Promise<StudioBrushMediaPixelDiff> {
  return page.evaluate(async ({
    firstBase64,
    secondBase64,
    pixelTolerance,
  }) => {
    const decode = async (base64: string) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("could not decode brush-media comparison");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };
    const [left, right] = await Promise.all([
      decode(firstBase64),
      decode(secondBase64),
    ]);
    if (left.width !== right.width || left.height !== right.height) {
      return {
        changedPixels: Math.max(left.width * left.height, right.width * right.height),
        totalPixels: Math.max(left.width * left.height, right.width * right.height),
        maxChannelDelta: 255,
      };
    }
    let changedPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < left.data.length; offset += 4) {
      const delta = Math.max(
        Math.abs(left.data[offset]! - right.data[offset]!),
        Math.abs(left.data[offset + 1]! - right.data[offset + 1]!),
        Math.abs(left.data[offset + 2]! - right.data[offset + 2]!),
      );
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > pixelTolerance) changedPixels += 1;
    }
    return {
      changedPixels,
      totalPixels: left.width * left.height,
      maxChannelDelta,
    };
  }, {
    firstBase64: first.toString("base64"),
    secondBase64: second.toString("base64"),
    pixelTolerance: tolerance,
  });
}

async function analyzeLiveToSettled(
  page: Page,
  baseline: Buffer,
  live: Buffer,
  settled: Buffer,
  route: BrushRoute,
): Promise<StudioBrushMediaTransitionMetrics> {
  const cursorPoint = route.localPoints[route.localPoints.length - 1];
  invariant(cursorPoint, "brush-media route has no cursor endpoint");
  return page.evaluate(async ({
    baselineBase64,
    liveBase64,
    settledBase64,
    ignoredPoint,
    ignoredRadius,
  }) => {
    const decode = async (base64: string) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("could not decode live-settled brush-media transition");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };
    const [base, before, after] = await Promise.all([
      decode(baselineBase64),
      decode(liveBase64),
      decode(settledBase64),
    ]);
    if (
      base.width !== before.width
      || base.height !== before.height
      || base.width !== after.width
      || base.height !== after.height
    ) throw new Error("live-settled brush-media screenshots have different dimensions");

    let changedPixels = 0;
    let maxChannelDelta = 0;
    let liveEnergy = 0;
    let settledEnergy = 0;
    let comparedInkPixels = 0;
    for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
      const x = pixel % base.width;
      const y = Math.floor(pixel / base.width);
      if (
        (x - ignoredPoint.x) ** 2 + (y - ignoredPoint.y) ** 2
          <= ignoredRadius ** 2
      ) continue;
      const offset = pixel * 4;
      const liveDelta = Math.max(
        Math.abs(base.data[offset]! - before.data[offset]!),
        Math.abs(base.data[offset + 1]! - before.data[offset + 1]!),
        Math.abs(base.data[offset + 2]! - before.data[offset + 2]!),
      );
      const settledDelta = Math.max(
        Math.abs(base.data[offset]! - after.data[offset]!),
        Math.abs(base.data[offset + 1]! - after.data[offset + 1]!),
        Math.abs(base.data[offset + 2]! - after.data[offset + 2]!),
      );
      if (liveDelta > 3) liveEnergy += liveDelta;
      if (settledDelta > 3) settledEnergy += settledDelta;
      if (liveDelta > 3 || settledDelta > 3) comparedInkPixels += 1;
      const transitionDelta = Math.max(
        Math.abs(before.data[offset]! - after.data[offset]!),
        Math.abs(before.data[offset + 1]! - after.data[offset + 1]!),
        Math.abs(before.data[offset + 2]! - after.data[offset + 2]!),
      );
      maxChannelDelta = Math.max(maxChannelDelta, transitionDelta);
      if (transitionDelta > 4) changedPixels += 1;
    }
    return {
      changedPixels,
      totalPixels: base.width * base.height,
      maxChannelDelta,
      liveInkEnergy: liveEnergy / 255,
      settledInkEnergy: settledEnergy / 255,
      energyRatio: liveEnergy <= 0 ? 0 : settledEnergy / liveEnergy,
      comparedInkPixels,
      differenceRatio: changedPixels / Math.max(1, comparedInkPixels),
      ignoredCursorRadius: ignoredRadius,
    };
  }, {
    baselineBase64: baseline.toString("base64"),
    liveBase64: live.toString("base64"),
    settledBase64: settled.toString("base64"),
    ignoredPoint: cursorPoint,
    ignoredRadius: route.cursorIgnoreRadius,
  });
}

async function analyzeAccumulation(
  page: Page,
  baseline: Buffer,
  previous: Buffer,
  next: Buffer,
): Promise<StudioBrushMediaAccumulationMetrics> {
  return page.evaluate(async ({
    baselineBase64,
    previousBase64,
    nextBase64,
  }) => {
    const decode = async (base64: string) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("could not decode brush-media accumulation");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [base, left, right] = await Promise.all([
      decode(baselineBase64),
      decode(previousBase64),
      decode(nextBase64),
    ]);
    if (base.length !== left.length || base.length !== right.length) {
      throw new Error("brush-media accumulation screenshots have different dimensions");
    }
    let previousEnergy = 0;
    let nextEnergy = 0;
    let previousInkPixels = 0;
    let regressedInkPixels = 0;
    let regressedInkEnergy = 0;
    let maximumPigmentLossDelta = 0;
    for (let offset = 0; offset < base.length; offset += 4) {
      const previousDelta = Math.max(
        Math.abs(base[offset]! - left[offset]!),
        Math.abs(base[offset + 1]! - left[offset + 1]!),
        Math.abs(base[offset + 2]! - left[offset + 2]!),
      );
      const nextDelta = Math.max(
        Math.abs(base[offset]! - right[offset]!),
        Math.abs(base[offset + 1]! - right[offset + 1]!),
        Math.abs(base[offset + 2]! - right[offset + 2]!),
      );
      if (previousDelta > 3) previousEnergy += previousDelta;
      if (nextDelta > 3) nextEnergy += nextDelta;
      if (previousDelta < 8) continue;
      previousInkPixels += 1;
      const tolerance = Math.max(5, previousDelta * 0.08);
      if (nextDelta + tolerance < previousDelta) {
        const loss = previousDelta - nextDelta;
        regressedInkPixels += 1;
        regressedInkEnergy += loss;
        maximumPigmentLossDelta = Math.max(maximumPigmentLossDelta, loss);
      }
    }
    return {
      previousInkEnergy: previousEnergy / 255,
      nextInkEnergy: nextEnergy / 255,
      energyRatio: previousEnergy <= 0 ? 0 : nextEnergy / previousEnergy,
      regressedInkPixels,
      previousInkPixels,
      regressedInkRatio: regressedInkPixels / Math.max(1, previousInkPixels),
      regressedInkEnergy: regressedInkEnergy / 255,
      regressedInkEnergyRatio: regressedInkEnergy / Math.max(1, previousEnergy),
      maximumPigmentLossDelta,
    };
  }, {
    baselineBase64: baseline.toString("base64"),
    previousBase64: previous.toString("base64"),
    nextBase64: next.toString("base64"),
  });
}

function analyzeArtifactPixelQuality(
  baseline: Buffer,
  settled: Buffer,
  route: BrushRoute,
): StudioBrushMediaArtifactQualityMetrics {
  const before = decodePng(new Uint8Array(
    baseline.buffer,
    baseline.byteOffset,
    baseline.byteLength,
  ));
  const after = decodePng(new Uint8Array(
    settled.buffer,
    settled.byteOffset,
    settled.byteLength,
  ));
  const beforeRaw = before.getRawImage();
  const afterRaw = after.getRawImage();
  return analyzeStudioBrushMediaPixelQuality({
    baseline: {
      width: before.width,
      height: before.height,
      channels: before.channels,
      data: beforeRaw.data,
    },
    frame: {
      width: after.width,
      height: after.height,
      channels: after.channels,
      data: afterRaw.data,
    },
    routePoints: route.localPoints,
    crossSectionRadius: route.crossSectionRadius,
  });
}

function artifactPaths(id: string): BrushMediaArtifacts {
  const path = (state: string) => join(SCRATCH, `studio-brush-media-${id}-${state}.png`);
  return {
    baseline: path("00-baseline"),
    live: path("01-live"),
    released: path("02-released"),
    settled: path("03-settled"),
    undo: path("04-undo"),
    redo: path("05-redo"),
    pass2: path("06-pass2"),
    pass3: path("07-pass3"),
  };
}

function saveArtifacts(
  paths: BrushMediaArtifacts,
  images: Readonly<Record<keyof BrushMediaArtifacts, Buffer>>,
): void {
  for (const [key, path] of Object.entries(paths) as Array<
    [keyof BrushMediaArtifacts, string]
  >) {
    writeFileSync(path, images[key]);
  }
}

async function runBrushMedium(
  browser: Browser,
  studioUrl: string,
  policy: StudioBrushMediaCasePolicy,
  brush: StudioBrushCatalogItem,
): Promise<BrushMediaBrowserResult> {
  const started = performance.now();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page, policy.id);

  try {
    await prepareStudioPage(page, studioUrl);
    await selectBrush(page, brush);
    const stage = page.locator(".konvajs-content").first();
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, `${policy.id}: could not measure Studio canvas`);
    const route = createBrushRoute(stageBox, viewport, brush.defaultWidth);
    await assertRouteHitsCanvas(page, route.points);
    const baseline = await screenshot(page, route.clip);

    let live: Buffer | null = null;
    await drawCurve(page, route.points, async () => {
      live = await screenshot(page, route.clip);
    });
    invariant(live, `${policy.id}: live screenshot was not captured`);
    const released = await screenshot(page, route.clip);
    await page.waitForTimeout(SETTLE_MS);
    const settled = await screenshot(page, route.clip);

    await waitForHistoryButton(page, "실행취소");
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(100);
    const undo = await screenshot(page, route.clip);
    await waitForHistoryButton(page, "다시실행");
    await page.keyboard.press("Meta+Shift+z");
    await page.waitForTimeout(SETTLE_MS);
    const redo = await screenshot(page, route.clip);

    await drawCurve(page, route.points);
    await page.waitForTimeout(SETTLE_MS);
    const pass2 = await screenshot(page, route.clip);
    await drawCurve(page, route.points);
    await page.waitForTimeout(SETTLE_MS);
    const pass3 = await screenshot(page, route.clip);

    const [
      liveMetrics,
      settledMetrics,
      pass2Metrics,
      pass3Metrics,
      liveToSettled,
      undoToBaseline,
      redoToSettled,
      pass1ToPass2,
      pass2ToPass3,
    ] = await Promise.all([
      analyzeFrame(page, baseline, live, route),
      analyzeFrame(page, baseline, settled, route),
      analyzeFrame(page, baseline, pass2, route),
      analyzeFrame(page, baseline, pass3, route),
      analyzeLiveToSettled(page, baseline, live, settled, route),
      compareFrames(page, baseline, undo, 18),
      compareFrames(page, settled, redo, 6),
      analyzeAccumulation(page, baseline, settled, pass2),
      analyzeAccumulation(page, baseline, pass2, pass3),
    ]);
    const pixelQuality = analyzeArtifactPixelQuality(baseline, settled, route);

    const metrics: StudioBrushMediaCaseMetrics = {
      id: policy.id,
      live: liveMetrics,
      settled: settledMetrics,
      pass2: pass2Metrics,
      pass3: pass3Metrics,
      pixelQuality,
      liveToSettled,
      undoToBaseline,
      redoToSettled,
      pass1ToPass2,
      pass2ToPass3,
    };
    const evaluation = evaluateStudioBrushMediaCase(policy, metrics);
    const paths = artifactPaths(policy.id);
    saveArtifacts(paths, {
      baseline,
      live,
      released,
      settled,
      undo,
      redo,
      pass2,
      pass3,
    });
    const runtimeMs = performance.now() - started;
    log(
      `${policy.id}: ${evaluation.ok ? "OK" : "FAIL"} · `
        + `${settledMetrics.changedPixels}px · `
        + `${(settledMetrics.pathCoverage * 100).toFixed(1)}% curve/`
        + `${settledMetrics.longestGapSamples}/${settledMetrics.pathSamples} gap · `
        + `P95 Δ${settledMetrics.p95ChannelDelta} · `
        + `texture ${settledMetrics.textureCoefficient.toFixed(3)}/`
        + `${settledMetrics.textureEntropy.toFixed(3)} · `
        + `scallop ${settledMetrics.scallopCoefficient?.toFixed(3) ?? "n/a"} · `
        + `detrended ${pixelQuality.scallopResidualCoefficient?.toFixed(3) ?? "n/a"} · `
        + `repeat ${pixelQuality.repetitionScore.toFixed(3)}@`
        + `${pixelQuality.repetitionPeriodPx ?? "n/a"}${pixelQuality.repetitionAxis ?? ""} · `
        + `settled/live ${liveToSettled.energyRatio.toFixed(3)} `
        + `(${(liveToSettled.differenceRatio * 100).toFixed(1)}% diff) · `
        + `${pass1ToPass2.energyRatio.toFixed(3)}/${pass2ToPass3.energyRatio.toFixed(3)} `
        + `accumulation (${pass1ToPass2.regressedInkPixels}/`
        + `${pass2ToPass3.regressedInkPixels} regressed; `
        + `${(pass1ToPass2.regressedInkEnergyRatio * 100).toFixed(1)}%/`
        + `${(pass2ToPass3.regressedInkEnergyRatio * 100).toFixed(1)}% energy) · `
        + `Undo ${undoToBaseline.changedPixels}px · Redo ${redoToSettled.changedPixels}px · `
        + `fingerprint ${pass3Metrics.fingerprint} · `
        + `${runtimeMs.toFixed(0)}ms`,
    );
    for (const finding of evaluation.findings) {
      log(`${policy.id} ${finding.level.toUpperCase()} ${finding.code}: ${finding.message}`);
    }
    return {
      id: policy.id,
      name: brush.name,
      medium: policy.medium,
      source: brush.source,
      runtimeMs,
      route: {
        sampleCount: route.points.length,
        supportRadius: route.supportRadius,
        crossSectionRadius: route.crossSectionRadius,
        cursorIgnoreRadius: route.cursorIgnoreRadius,
        clip: route.clip,
      },
      metrics,
      evaluation,
      artifacts: paths,
      browserErrors,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  cleanScratchDir({
    directory: SCRATCH,
    filePrefix: "studio-brush-media-",
    extensions: [".png", ".json", ".log"],
  });
  const started = performance.now();
  const catalogById = new Map(
    STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((brush) => [brush.id, brush]),
  );
  const filterIds = process.env.TOONSPECTRUM_BRUSH_VERIFY_IDS
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const filteredCases = filterIds && filterIds.length > 0
    ? STUDIO_BRUSH_MEDIA_CASES.filter((policy) => filterIds.includes(policy.id))
    : STUDIO_BRUSH_MEDIA_CASES;
  const representativeCases = filteredCases.map((policy) => {
    const brush = catalogById.get(policy.id);
    invariant(brush, `${policy.id}: representative medium is missing from the shipped catalogue`);
    return { policy, brush };
  });
  invariant(
    new Set(representativeCases.map(({ brush }) => brush.id)).size
      === representativeCases.length,
    "representative media contain duplicate brush identities",
  );

  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  const port = externalOrigin
    ? null
    : await findFreePort({ unavailableMessage: "could not reserve preview port" });
  const origin = externalOrigin
    ? `${externalOrigin.replace(/\/+$/u, "")}/`
    : `http://127.0.0.1:${port}/`;
  const studioUrl = `${origin}studio`;
  const server: ChildProcess | null = externalOrigin
    ? null
    : spawn(
        process.execPath,
        [
          join(process.cwd(), "node_modules", "vite", "bin", "vite.js"),
          "preview",
          "--port",
          String(port),
          "--strictPort",
          "--host",
          "127.0.0.1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
  server?.stdout?.on("data", (chunk) => appendFileSync(LOG_PATH, String(chunk)));
  server?.stderr?.on("data", (chunk) => appendFileSync(LOG_PATH, String(chunk)));

  let browser: Browser | null = null;
  const cases: BrushMediaBrowserResult[] = [];
  const executionFailures: Array<{ id: string; message: string }> = [];
  try {
    await waitForServer(origin, {
      maxAttempts: 100,
      pollIntervalMs: 100,
      requestInit: { redirect: "manual" },
      notReadyMessage: `Vite preview did not become ready at ${origin}`,
    });
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const { policy, brush } of representativeCases) {
      try {
        cases.push(await runBrushMedium(browser, studioUrl, policy, brush));
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        executionFailures.push({ id: policy.id, message });
        log(`${policy.id}: EXECUTION FAILURE ${message}`);
      }
    }

    const suite = evaluateStudioBrushMediaSuite(cases.map((entry) => entry.metrics));
    for (const finding of suite.findings) {
      log(`SUITE ${finding.level.toUpperCase()} ${finding.code}: ${finding.message}`);
    }
    const unexpectedBrowserErrors = cases.flatMap((entry) => [
      ...entry.browserErrors.console,
      ...entry.browserErrors.page,
      ...entry.browserErrors.responses,
    ]);
    const report = {
      kind: "toonspectrum-studio-brush-media-browser-quality-v2",
      generatedAt: new Date().toISOString(),
      route: studioUrl,
      scratch: SCRATCH,
      diagnosticPolicy: {
        description:
          "Cross-platform broad floors fail visible/faint media, live-settled divergence, "
          + "interior gaps, detrended scalloping, repeated tile/grid peaks, local pigment-energy "
          + "loss, history divergence, and representative fingerprint collapse.",
        settleMs: SETTLE_MS,
        cases: STUDIO_BRUSH_MEDIA_CASES,
      },
      runtimeMs: performance.now() - started,
      cases,
      suite,
      executionFailures,
      unexpectedBrowserErrors,
      ok:
        cases.length === representativeCases.length
        && executionFailures.length === 0
        && cases.every((entry) => entry.evaluation.ok)
        && suite.ok
        && unexpectedBrowserErrors.length === 0,
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    log(
      `report ${REPORT_PATH} · ${cases.length}/${representativeCases.length} media · `
        + `${suite.uniqueFingerprintCount} unique fingerprints`,
    );
    invariant(report.ok, "Studio brush-media browser quality gate failed; inspect the JSON report");
    log("ALL REPRESENTATIVE BRUSH MEDIA GATES OK");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopChildProcess(server).catch(() => undefined);
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  },
);
