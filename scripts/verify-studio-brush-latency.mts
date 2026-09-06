/**
 * Production-preview brush input-to-pixel latency gate.
 *
 * The browser-side probe timestamps trusted pointer events with performance.now(), then samples a
 * small compositor patch on each requestAnimationFrame. Probe patches sit behind the moving cursor,
 * so cursor motion is not mistaken for ink. The default command is a hard per-stroke smoke gate;
 * the explicit competitive mode additionally requires the complete route/workload/rate/DPR and
 * long-session resource matrices. Historical 34-200ms thresholds are telemetry only.
 *
 * Run after `pnpm build`:
 *   pnpm run verify:studio-brush-latency
 *   pnpm run verify:studio-brush-latency -- --competitive-long-stroke
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";

import {
  cleanScratchDir,
  findFreePort,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";
import {
  STUDIO_BRUSH_COMPETITIVE_DESKTOP_VIEWPORT,
  STUDIO_BRUSH_COMPETITIVE_EXECUTION_CASES,
  STUDIO_BRUSH_COMPETITIVE_FRAME_BUDGETS,
  STUDIO_BRUSH_COMPETITIVE_LONG_SESSION_COMMIT_COUNTS,
  STUDIO_BRUSH_COMPETITIVE_PROVIDER_ROUTES,
  evaluateStudioBrushCompetitiveCoverage,
  evaluateStudioBrushCompetitiveLongSession,
  evaluateStudioBrushFrameBudget,
  type StudioBrushCompetitiveExecutionCase,
  type StudioBrushCompetitiveLongSessionEvidence,
  type StudioBrushFrameBudgetEvaluation,
  type StudioBrushFrameBudgetMetrics,
} from "./studio-brush-frame-budget-policy";
import {
  assertStudioBrushFrameBudgetRouteVisible,
  createStudioBrushFrameBudgetRoute,
  profileStudioBrushFrameBudget,
} from "./studio-brush-frame-budget-profiler";
import {
  STUDIO_BRUSH_LATENCY_IDS,
  evaluateStudioBrushLatencyCase,
  type StudioBrushInputLatencySample,
  type StudioBrushLatencyCaseMetrics,
  type StudioBrushLatencyId,
  type StudioBrushSettleSample,
} from "./studio-brush-latency-policy";

const SCRATCH =
  process.env.TOONSPECTRUM_BRUSH_LATENCY_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-brush-latency");
const LOG_PATH = join(SCRATCH, "studio-brush-latency-verify.log");
const REPORT_PATH = join(SCRATCH, "studio-brush-latency-report.json");
const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const AUTOSAVE_PREFIX = "toonspectrum-studio-autosave";
const INPUT_TIMEOUT_MS = 360;
const SETTLE_OBSERVATION_MS = 360;
const OPTIONAL_LOOPBACK_PREVIEW_PATHS = new Set([
  "/api/auth/session",
  "/api/studio-ai/status",
  "/api/kmas/merge-on-access",
  // Exact paths, because this set is matched with `has(url.pathname)` rather than a prefix.
  "/api/analytics/traffic/page-view",
  "/api/analytics/traffic/heartbeat",
]);

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

interface BrowserErrors {
  readonly console: string[];
  readonly page: string[];
  readonly responses: string[];
}

interface BrushLatencyResult {
  readonly id: StudioBrushLatencyId;
  readonly name: string;
  readonly source: StudioBrushCatalogItem["source"];
  readonly runtimeMs: number;
  readonly metrics: StudioBrushLatencyCaseMetrics;
  readonly legacyLatencyTelemetry: ReturnType<typeof evaluateStudioBrushLatencyCase>;
  readonly frameBudgetMetrics: StudioBrushFrameBudgetMetrics;
  readonly frameBudgetEvaluation: StudioBrushFrameBudgetEvaluation;
  readonly competitiveExecutionCase: StudioBrushCompetitiveExecutionCase | null;
  readonly actualViewport: Readonly<{ width: number; height: number }>;
  readonly actualDeviceScaleFactor: number;
  readonly artifacts: Readonly<{ live: string; settled: string }>;
  readonly browserErrors: BrowserErrors;
}

const COMPETITIVE_LONG_STROKE_FLAG = "--competitive-long-stroke";

function log(message: string): void {
  const line = `[verify-studio-brush-latency] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_PATH, `${line}\n`);
  } catch {
    // Numeric policy output remains authoritative if the diagnostic log cannot be appended.
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function studioBrushCompetitiveLongStrokeRequested(
  argv: readonly string[] = process.argv.slice(2),
): boolean {
  return argv.includes(COMPETITIVE_LONG_STROKE_FLAG);
}

export function expectedStudioBrushLatencyPreviewFailure(
  message: string,
  studioUrl: string,
): boolean {
  let previewUrl: URL;
  try {
    previewUrl = new URL(studioUrl);
  } catch {
    return false;
  }
  if (
    previewUrl.protocol !== "http:"
    || previewUrl.hostname !== "127.0.0.1"
    || previewUrl.port.length === 0
  ) return false;
  const candidates = message.match(/(?:https?|wss?):\/\/[^\s]+/gu) ?? [];
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate.replace(/['"\]})>,.;]+$/u, ""));
      const sameLoopback = url.hostname === previewUrl.hostname && url.port === previewUrl.port;
      if (!sameLoopback || url.hash !== "") return false;
      if (url.protocol === "ws:" || url.protocol === "wss:") {
        return url.protocol === "ws:"
          && url.pathname === "/socket.io/"
          && url.search === "?EIO=4&transport=websocket";
      }
      return url.origin === previewUrl.origin
        && url.search === ""
        && OPTIONAL_LOOPBACK_PREVIEW_PATHS.has(url.pathname);
    } catch {
      return false;
    }
  });
}

function collectBrowserErrors(page: Page, label: string, studioUrl: string): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [], responses: [] };
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const message = entry.location().url
      ? `${entry.text()} @ ${entry.location().url}`
      : entry.text();
    if (!expectedStudioBrushLatencyPreviewFailure(message, studioUrl)) {
      errors.console.push(`${label}: ${message}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.page.push(`${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const message = `${response.status()} ${response.url()}`;
    if (!expectedStudioBrushLatencyPreviewFailure(message, studioUrl)) {
      errors.responses.push(`${label}: ${message}`);
    }
  });
  return errors;
}

async function prepareStudio(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(9_000);
  await page.addInitScript(({ autosavePrefix, mobileHintKey, quickstartKey }) => {
    try {
      window.localStorage.setItem(quickstartKey, "1");
      window.localStorage.setItem(mobileHintKey, "1");
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(autosavePrefix)) window.localStorage.removeItem(key);
      }
    } catch {
      // Visible and pixel assertions below remain strict without storage.
    }
  }, {
    autosavePrefix: AUTOSAVE_PREFIX,
    mobileHintKey: MOBILE_HINT_KEY,
    quickstartKey: QUICKSTART_KEY,
  });
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
  await page.evaluate("globalThis.__name ??= (target) => target");
  await page.locator(".konvajs-content").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.keyboard.press("b");
  const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
  await toolbar.waitFor({ state: "visible" });
  const pen = toolbar.getByRole("button", { name: "펜", exact: true });
  if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function selectBrush(
  page: Page,
  brush: Pick<StudioBrushCatalogItem, "id" | "name" | "operation">,
): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
  if (brush.operation === "erase") {
    const eraser = toolbar.getByRole("button", { name: "지우개", exact: true });
    if (await eraser.getAttribute("aria-pressed") !== "true") await eraser.click();
  } else {
    const pen = toolbar.getByRole("button", { name: "펜", exact: true });
    if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
  }
  await toolbar.getByRole("button", {
    name: brush.operation === "erase" ? /지우개 선택 열기$/u : /브러시 선택 열기$/u,
  }).click();
  const catalog = page.getByRole("dialog", {
    name: brush.operation === "erase" ? "지우개 선택" : "브러시 전체 라이브러리",
  });
  await catalog.waitFor({ state: "visible" });
  const searchName = brush.operation === "erase" ? "전체 지우개 검색" : "전체 브러시 검색";
  await catalog.getByRole("searchbox", { name: searchName }).fill(brush.id);
  await catalog.locator(`[data-studio-brush-select="${brush.id}"]`).click();
  await catalog.waitFor({ state: "detached" });
  await toolbar.getByRole("button", {
    name: new RegExp(`^현재 도구 ${escapeRegExp(brush.name)},`, "u"),
  }).waitFor({ state: "visible" });
  await page.mouse.move(4, 4);
  await page.waitForTimeout(80);
}

function latencyRoute(
  stageBox: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  width: number,
): { points: readonly ScreenPoint[]; clip: ScreenshotClip; patchSize: number } {
  const left = Math.max(stageBox.x + 100, viewport.width * 0.34);
  const right = Math.min(stageBox.x + stageBox.width - 100, viewport.width * 0.68);
  const centerY = Math.max(stageBox.y + 180, viewport.height * 0.42);
  invariant(right - left >= 320, "Studio canvas is too narrow for latency probes");
  const points = Array.from({ length: 9 }, (_, index) => {
    const t = index / 8;
    return {
      x: left + (right - left) * t,
      y: centerY + Math.sin(t * Math.PI * 1.5) * 48,
    };
  });
  const margin = Math.max(44, Math.min(76, width * 1.2));
  const x = Math.max(0, Math.floor(left - margin));
  const y = Math.max(0, Math.floor(centerY - 70 - margin));
  return {
    points,
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, Math.ceil(right - left + margin * 2)),
      height: Math.min(viewport.height - y, Math.ceil(140 + margin * 2)),
    },
    // Stabilized brushes may revise ink behind the newest contact rather than at the raw endpoint.
    // A 48–64px patch spans most of one 40–60px route segment while its centre remains behind the
    // cursor, capturing that legitimate visual response without mistaking cursor travel for ink.
    patchSize: Math.max(48, Math.min(64, Math.ceil(width * 1.2))),
  };
}

async function assertRouteVisible(page: Page, points: readonly ScreenPoint[]): Promise<void> {
  const misses = await page.evaluate((route) => route.flatMap((point) => (
    document.elementFromPoint(point.x, point.y)?.closest(".konvajs-content")
      ? []
      : [point]
  )), points);
  invariant(misses.length === 0, `latency route is covered by editor chrome: ${JSON.stringify(misses)}`);
}

async function armInputProbe(
  page: Page,
  phase: "pointerdown" | "pointermove",
  sampleIndex: number,
  probePoint: ScreenPoint,
  patchSize: number,
): Promise<void> {
  await page.evaluate(({
    eventType,
    index,
    center,
    cssPatchSize,
    timeoutMs,
  }) => {
    type ProbeResult = {
      phase: "pointerdown" | "pointermove";
      sampleIndex: number;
      latencyMs: number | null;
      changedPixels: number;
      maxChannelDelta: number;
      rafIntervalsMs: number[];
      droppedVisualFrames: number;
      timedOut: boolean;
    };
    type ProbeState = {
      result: ProbeResult | null;
      cancel: () => void;
    };
    const root = document.querySelector<HTMLElement>(".konvajs-content");
    if (!root) throw new Error("Studio canvas is unavailable for latency probe");
    // Low-latency ink, stamp, wet-ink, prediction, and GPU surfaces are sibling canvases of the
    // Konva Stage. Sampling only `.konvajs-content` misses their pointerdown pixels and then
    // mistakes the later retained-layer handoff for visible latency.
    const compositorRoot = root.parentElement?.closest<HTMLElement>(".relative") ?? root;
    const sampleCanvas = new OffscreenCanvas(cssPatchSize, cssPatchSize);
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) throw new Error("latency probe could not allocate sample canvas");
    const sample = (): Uint8ClampedArray => {
      sampleContext.clearRect(0, 0, cssPatchSize, cssPatchSize);
      for (const canvas of compositorRoot.querySelectorAll<HTMLCanvasElement>("canvas")) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const sourceX = (center.x - cssPatchSize / 2 - rect.left) * canvas.width / rect.width;
        const sourceY = (center.y - cssPatchSize / 2 - rect.top) * canvas.height / rect.height;
        const sourceWidth = cssPatchSize * canvas.width / rect.width;
        const sourceHeight = cssPatchSize * canvas.height / rect.height;
        sampleContext.drawImage(
          canvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          cssPatchSize,
          cssPatchSize,
        );
      }
      return sampleContext.getImageData(0, 0, cssPatchSize, cssPatchSize).data;
    };
    const baseline = sample();
    const intervals: number[] = [];
    let eventTime: number | null = null;
    let lastRaf: number | null = null;
    let rafId = 0;
    const armedAt = performance.now();
    const globalState = globalThis as typeof globalThis & {
      __studioBrushLatencyProbe?: ProbeState;
    };
    globalState.__studioBrushLatencyProbe?.cancel();
    const finish = (result: ProbeResult): void => {
      cancelAnimationFrame(rafId);
      root.removeEventListener(eventType, onInput, true);
      state.result = result;
    };
    const onInput = (): void => {
      if (eventTime === null) eventTime = performance.now();
    };
    const state: ProbeState = {
      result: null,
      cancel: () => {
        cancelAnimationFrame(rafId);
        root.removeEventListener(eventType, onInput, true);
      },
    };
    const tick = (now: number): void => {
      const observedAt = performance.now();
      if (lastRaf !== null && eventTime !== null) intervals.push(now - lastRaf);
      lastRaf = now;
      if (eventTime !== null) {
        const current = sample();
        let changedPixels = 0;
        let maxChannelDelta = 0;
        for (let offset = 0; offset < baseline.length; offset += 4) {
          const delta = Math.max(
            Math.abs(baseline[offset]! - current[offset]!),
            Math.abs(baseline[offset + 1]! - current[offset + 1]!),
            Math.abs(baseline[offset + 2]! - current[offset + 2]!),
            Math.abs(baseline[offset + 3]! - current[offset + 3]!),
          );
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta > 3) changedPixels += 1;
        }
        if (changedPixels >= 2 && maxChannelDelta >= 4) {
          const droppedVisualFrames = intervals.reduce((sum, interval) => (
            sum + Math.max(0, Math.floor(interval / 16.667) - 1)
          ), 0);
          finish({
            phase: eventType,
            sampleIndex: index,
            latencyMs: observedAt - eventTime,
            changedPixels,
            maxChannelDelta,
            rafIntervalsMs: intervals,
            droppedVisualFrames,
            timedOut: false,
          });
          return;
        }
        if (observedAt - eventTime >= timeoutMs) {
          finish({
            phase: eventType,
            sampleIndex: index,
            latencyMs: null,
            changedPixels: 0,
            maxChannelDelta,
            rafIntervalsMs: intervals,
            droppedVisualFrames: intervals.reduce((sum, interval) => (
              sum + Math.max(0, Math.floor(interval / 16.667) - 1)
            ), 0),
            timedOut: true,
          });
          return;
        }
      } else if (observedAt - armedAt >= timeoutMs + 150) {
        finish({
          phase: eventType,
          sampleIndex: index,
          latencyMs: null,
          changedPixels: 0,
          maxChannelDelta: 0,
          rafIntervalsMs: intervals,
          droppedVisualFrames: 0,
          timedOut: true,
        });
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    root.addEventListener(eventType, onInput, true);
    globalState.__studioBrushLatencyProbe = state;
    rafId = requestAnimationFrame(tick);
  }, {
    eventType: phase,
    index: sampleIndex,
    center: probePoint,
    cssPatchSize: patchSize,
    timeoutMs: INPUT_TIMEOUT_MS,
  });
}

async function inputProbeResult(page: Page): Promise<StudioBrushInputLatencySample> {
  await page.waitForFunction(() => Boolean(
    (globalThis as typeof globalThis & {
      __studioBrushLatencyProbe?: { result?: unknown };
    }).__studioBrushLatencyProbe?.result,
  ), undefined, { timeout: INPUT_TIMEOUT_MS + 700 });
  return page.evaluate(() => {
    const result = (globalThis as typeof globalThis & {
      __studioBrushLatencyProbe?: { result?: StudioBrushInputLatencySample };
    }).__studioBrushLatencyProbe?.result;
    if (!result) throw new Error("latency probe result is unavailable");
    return result;
  });
}

async function armSettleProbe(
  page: Page,
  clip: ScreenshotClip,
): Promise<void> {
  await page.evaluate(({ sampleRect, observationMs }) => {
    type SettleState = {
      result: StudioBrushSettleSample | null;
      cancel: () => void;
    };
    const root = document.querySelector<HTMLElement>(".konvajs-content");
    if (!root) throw new Error("Studio canvas is unavailable for settle probe");
    const compositorRoot = root.parentElement?.closest<HTMLElement>(".relative") ?? root;
    const width = 160;
    const height = 80;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("settle probe could not allocate sample canvas");
    const sample = (): Uint8ClampedArray => {
      context.clearRect(0, 0, width, height);
      for (const layer of compositorRoot.querySelectorAll<HTMLCanvasElement>("canvas")) {
        const rect = layer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const sourceX = (sampleRect.x - rect.left) * layer.width / rect.width;
        const sourceY = (sampleRect.y - rect.top) * layer.height / rect.height;
        const sourceWidth = sampleRect.width * layer.width / rect.width;
        const sourceHeight = sampleRect.height * layer.height / rect.height;
        context.drawImage(
          layer,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          width,
          height,
        );
      }
      return context.getImageData(0, 0, width, height).data;
    };
    const live = sample();
    let previous = live;
    let eventTime: number | null = null;
    let firstChange: number | null = null;
    let lastChange: number | null = null;
    let lastRaf: number | null = null;
    let rafId = 0;
    let droppedVisualFrames = 0;
    const globalState = globalThis as typeof globalThis & {
      __studioBrushSettleProbe?: SettleState;
    };
    globalState.__studioBrushSettleProbe?.cancel();
    const onPointerUp = (): void => {
      if (eventTime === null) eventTime = performance.now();
    };
    const state: SettleState = {
      result: null,
      cancel: () => {
        cancelAnimationFrame(rafId);
        root.removeEventListener("pointerup", onPointerUp, true);
      },
    };
    const finish = (now: number, timedOut: boolean): void => {
      const final = sample();
      let changedPixels = 0;
      let maxChannelDelta = 0;
      for (let offset = 0; offset < live.length; offset += 4) {
        const delta = Math.max(
          Math.abs(live[offset]! - final[offset]!),
          Math.abs(live[offset + 1]! - final[offset + 1]!),
          Math.abs(live[offset + 2]! - final[offset + 2]!),
          Math.abs(live[offset + 3]! - final[offset + 3]!),
        );
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > 3) changedPixels += 1;
      }
      const relativeLastChange = eventTime !== null && lastChange !== null
        ? lastChange - eventTime
        : null;
      state.result = {
        observationMs: eventTime === null ? 0 : now - eventTime,
        firstVisualChangeMs: eventTime !== null && firstChange !== null
          ? firstChange - eventTime
          : null,
        lastVisualChangeMs: relativeLastChange,
        settleMs: relativeLastChange === null ? 0 : relativeLastChange + 16.667,
        liveToSettledChangedPixels: changedPixels,
        liveToSettledMaxChannelDelta: maxChannelDelta,
        droppedVisualFrames,
        timedOut,
      };
      state.cancel();
    };
    const tick = (now: number): void => {
      const observedAt = performance.now();
      if (eventTime !== null) {
        if (lastRaf !== null) {
          const interval = now - lastRaf;
          droppedVisualFrames += Math.max(0, Math.floor(interval / 16.667) - 1);
        }
        lastRaf = now;
        const current = sample();
        let changedPixels = 0;
        let maxDelta = 0;
        for (let offset = 0; offset < previous.length; offset += 4) {
          const delta = Math.max(
            Math.abs(previous[offset]! - current[offset]!),
            Math.abs(previous[offset + 1]! - current[offset + 1]!),
            Math.abs(previous[offset + 2]! - current[offset + 2]!),
            Math.abs(previous[offset + 3]! - current[offset + 3]!),
          );
          maxDelta = Math.max(maxDelta, delta);
          if (delta > 3) changedPixels += 1;
        }
        if (changedPixels >= 2 && maxDelta >= 4) {
          firstChange ??= observedAt;
          lastChange = observedAt;
        }
        previous = current;
        if (observedAt - eventTime >= observationMs) {
          finish(observedAt, false);
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    root.addEventListener("pointerup", onPointerUp, true);
    globalState.__studioBrushSettleProbe = state;
    rafId = requestAnimationFrame(tick);
  }, {
    sampleRect: clip,
    observationMs: SETTLE_OBSERVATION_MS,
  });
}

async function settleProbeResult(page: Page): Promise<StudioBrushSettleSample> {
  await page.waitForFunction(() => Boolean(
    (globalThis as typeof globalThis & {
      __studioBrushSettleProbe?: { result?: unknown };
    }).__studioBrushSettleProbe?.result,
  ), undefined, { timeout: SETTLE_OBSERVATION_MS + 900 });
  return page.evaluate(() => {
    const result = (globalThis as typeof globalThis & {
      __studioBrushSettleProbe?: { result?: StudioBrushSettleSample };
    }).__studioBrushSettleProbe?.result;
    if (!result) throw new Error("settle probe result is unavailable");
    return result;
  });
}

async function runBrushLatency(
  browser: Browser,
  studioUrl: string,
  id: StudioBrushLatencyId,
  brush: StudioBrushCatalogItem,
  competitiveExecutionCase: StudioBrushCompetitiveExecutionCase | null,
): Promise<BrushLatencyResult> {
  const started = performance.now();
  const requestedViewport = competitiveExecutionCase
    ? STUDIO_BRUSH_COMPETITIVE_DESKTOP_VIEWPORT
    : { width: 1_440, height: 1_100 };
  const requestedDeviceScaleFactor = competitiveExecutionCase?.deviceScaleFactor ?? 1;
  const context = await browser.newContext({
    viewport: requestedViewport,
    deviceScaleFactor: requestedDeviceScaleFactor,
  });
  const page = await context.newPage();
  const caseSuffix = competitiveExecutionCase
    ? `-${competitiveExecutionCase.workloadId}-${competitiveExecutionCase.pointerRateHz}hz-dpr`
      + `${competitiveExecutionCase.deviceScaleFactor}`
    : "-smoke";
  const caseLabel = `${id}${caseSuffix}`;
  const browserErrors = collectBrowserErrors(page, caseLabel, studioUrl);
  const livePath = join(SCRATCH, `studio-brush-latency-${caseLabel}-live.png`);
  const settledPath = join(SCRATCH, `studio-brush-latency-${caseLabel}-settled.png`);

  try {
    await prepareStudio(page, studioUrl);
    await selectBrush(page, brush);
    const stage = page.locator(".konvajs-content").first();
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, `${id}: could not measure Studio canvas`);
    const route = latencyRoute(stageBox, viewport, brush.defaultWidth);
    await assertRouteVisible(page, route.points);

    const first = route.points[0]!;
    await page.mouse.move(first.x, first.y);
    await armInputProbe(page, "pointerdown", 0, first, route.patchSize);
    await page.mouse.down();
    const pointerDown = await inputProbeResult(page);

    const pointerMoves: StudioBrushInputLatencySample[] = [];
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1]!;
      const next = route.points[index]!;
      const probe = {
        x: previous.x + (next.x - previous.x) * 0.42,
        y: previous.y + (next.y - previous.y) * 0.42,
      };
      await armInputProbe(page, "pointermove", index, probe, route.patchSize);
      await page.mouse.move(next.x, next.y);
      pointerMoves.push(await inputProbeResult(page));
    }

    await page.screenshot({
      path: livePath,
      animations: "disabled",
      clip: route.clip,
    });
    await armSettleProbe(page, route.clip);
    await page.mouse.up();
    await page.mouse.move(4, 4);
    const pointerUp = await settleProbeResult(page);
    await page.screenshot({
      path: settledPath,
      animations: "disabled",
      clip: route.clip,
    });

    const metrics: StudioBrushLatencyCaseMetrics = {
      id,
      pointerDown,
      pointerMoves,
      pointerUp,
    };
    const legacyLatencyTelemetry = evaluateStudioBrushLatencyCase(metrics);
    const frameRoute = createStudioBrushFrameBudgetRoute(
      stageBox,
      viewport,
      brush.defaultWidth,
    );
    await assertStudioBrushFrameBudgetRouteVisible(page, frameRoute.points);
    const frameRuntime = await profileStudioBrushFrameBudget(page, frameRoute, {
      captureRenderWorkload:
        process.env.TOONSPECTRUM_BRUSH_FRAME_DIAGNOSTICS?.split(",")
          .map((candidate) => candidate.trim())
          .includes(id)
        ?? false,
      ...(competitiveExecutionCase ? { executionCase: competitiveExecutionCase } : {}),
    });
    const frameBudgetMetrics: StudioBrushFrameBudgetMetrics = {
      id,
      firstPixelMs: pointerDown.latencyMs,
      firstPixelChangedPixels: pointerDown.changedPixels,
      firstPixelMaxChannelDelta: pointerDown.maxChannelDelta,
      firstPixelTimedOut: pointerDown.timedOut,
      settleMs: frameRuntime.pointerUpToFirstFrameMs ?? Number.POSITIVE_INFINITY,
      settleTimedOut: frameRuntime.pointerUpToFirstFrameMs === null,
      ...frameRuntime,
    };
    const frameBudgetEvaluation = evaluateStudioBrushFrameBudget(frameBudgetMetrics);
    const actualViewport = page.viewportSize();
    invariant(actualViewport, `${caseLabel}: browser viewport is unavailable`);
    const actualDeviceScaleFactor = await page.evaluate(() => globalThis.devicePixelRatio);
    const runtimeMs = performance.now() - started;
    log(
      `${caseLabel}: LEGACY ${legacyLatencyTelemetry.ok ? "OK" : "FAIL"} · `
        + `${legacyLatencyTelemetry.summary.sampleCount} inputs · `
        + `p50 ${legacyLatencyTelemetry.summary.p50Ms.toFixed(1)}ms · `
        + `p95 ${legacyLatencyTelemetry.summary.p95Ms.toFixed(1)}ms · `
        + `max ${legacyLatencyTelemetry.summary.maxMs.toFixed(1)}ms · `
        + `dropped ${legacyLatencyTelemetry.summary.droppedVisualFrames} · `
        + `settle ${pointerUp.settleMs.toFixed(1)}ms `
        + `(first ${pointerUp.firstVisualChangeMs?.toFixed(1) ?? "none"}, `
        + `last ${pointerUp.lastVisualChangeMs?.toFixed(1) ?? "none"}) · `
        + `live→settled ${pointerUp.liveToSettledChangedPixels}px/`
        + `Δ${pointerUp.liveToSettledMaxChannelDelta} · ${runtimeMs.toFixed(0)}ms`,
    );
    log(
      `${caseLabel} continuous: ${frameBudgetEvaluation.ok ? "OK" : "FAIL"} · `
        + `frame p50 ${frameBudgetEvaluation.summary.moveFrameP50Ms.toFixed(1)}ms · `
        + `p95 ${frameBudgetEvaluation.summary.moveFrameP95Ms.toFixed(1)}ms · `
        + `input→frame p95 `
        + `${frameBudgetEvaluation.summary.moveToFrameP95Ms.toFixed(1)}ms · `
        + `miss ${frameBudgetEvaluation.summary.missedFrames} `
        + `(${(frameBudgetEvaluation.summary.frameMissRatio * 100).toFixed(1)}%) · `
        + `delivery ${(frameBudgetEvaluation.summary.inputDeliveryRatio * 100).toFixed(1)}% · `
        + `long task ${frameBudgetEvaluation.summary.longestLongTaskMs.toFixed(1)}ms · `
        + `${frameRuntime.compositorCanvasCount} compositor surfaces`,
    );
    for (const finding of legacyLatencyTelemetry.findings) {
      log(`${id} LEGACY ${finding.level.toUpperCase()} ${finding.code}: ${finding.message}`);
    }
    for (const finding of frameBudgetEvaluation.findings) {
      log(
        `${id} FRAME ${finding.level.toUpperCase()} ${finding.code}: ${finding.message}`,
      );
    }
    return {
      id,
      name: brush.name,
      source: brush.source,
      runtimeMs,
      metrics,
      legacyLatencyTelemetry,
      frameBudgetMetrics,
      frameBudgetEvaluation,
      competitiveExecutionCase,
      actualViewport,
      actualDeviceScaleFactor,
      artifacts: { live: livePath, settled: settledPath },
      browserErrors,
    };
  } finally {
    await context.close();
  }
}

async function runCompetitiveLongSessionResourceProbe(
  browser: Browser,
  studioUrl: string,
): Promise<readonly StudioBrushCompetitiveLongSessionEvidence[]> {
  const context = await browser.newContext({
    viewport: STUDIO_BRUSH_COMPETITIVE_DESKTOP_VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await prepareStudio(page, studioUrl);
    return await page.evaluate(async (commitCounts) => {
      type ResourceProbe = {
        run(input: { readonly commitCounts: readonly number[] }): Promise<unknown>;
      };
      const probe = (
        globalThis as typeof globalThis & {
          __studioBrushCompetitiveLongSessionProbe?: ResourceProbe;
        }
      ).__studioBrushCompetitiveLongSessionProbe;
      if (!probe || typeof probe.run !== "function") return [];
      const result = await probe.run({ commitCounts });
      return Array.isArray(result) ? result : [];
    }, STUDIO_BRUSH_COMPETITIVE_LONG_SESSION_COMMIT_COUNTS) as
      readonly StudioBrushCompetitiveLongSessionEvidence[];
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  cleanScratchDir({
    directory: SCRATCH,
    filePrefix: "studio-brush-latency-",
    extensions: [".png", ".json", ".log"],
  });
  const started = performance.now();
  const competitiveLongStroke = studioBrushCompetitiveLongStrokeRequested();
  const catalogById = new Map(
    STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((brush) => [brush.id, brush]),
  );
  const requestedIds = (process.env.TOONSPECTRUM_BRUSH_LATENCY_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const requestedIdSet = new Set(requestedIds);
  const representativeIds = requestedIds.length > 0
    ? STUDIO_BRUSH_LATENCY_IDS.filter((id) => requestedIdSet.has(id))
    : STUDIO_BRUSH_LATENCY_IDS;
  invariant(
    requestedIds.length === 0
      || (
        requestedIds.length === requestedIdSet.size
        && representativeIds.length === requestedIdSet.size
      ),
    "TOONSPECTRUM_BRUSH_LATENCY_IDS contains an unknown or duplicate representative id",
  );
  const representatives = representativeIds.map((id) => {
    const brush = catalogById.get(id);
    invariant(brush, `${id}: latency representative is absent from shipped catalogue`);
    return { id, brush };
  });
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
    : spawn(process.execPath, [
        join(process.cwd(), "node_modules", "vite", "bin", "vite.js"),
        "preview",
        "--port",
        String(port),
        "--strictPort",
        "--host",
        "127.0.0.1",
      ], { stdio: ["ignore", "pipe", "pipe"] });
  server?.stdout?.on("data", (chunk) => appendFileSync(LOG_PATH, String(chunk)));
  server?.stderr?.on("data", (chunk) => appendFileSync(LOG_PATH, String(chunk)));

  let browser: Browser | null = null;
  const results: BrushLatencyResult[] = [];
  const executionFailures: Array<{ caseId: string; message: string }> = [];
  try {
    await waitForServer(origin, {
      maxAttempts: 100,
      pollIntervalMs: 100,
      requestInit: { redirect: "manual" },
      notReadyMessage: `Vite preview did not become ready at ${origin}`,
    });
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const executionCases: readonly (StudioBrushCompetitiveExecutionCase | null)[] =
      competitiveLongStroke ? STUDIO_BRUSH_COMPETITIVE_EXECUTION_CASES : [null];
    for (const { id, brush } of representatives) {
      for (const executionCase of executionCases) {
        const caseId = executionCase
          ? `${id}:${executionCase.workloadId}:${executionCase.pointerRateHz}hz:`
            + `dpr${executionCase.deviceScaleFactor}`
          : `${id}:smoke`;
        try {
          results.push(await runBrushLatency(
            browser,
            studioUrl,
            id,
            brush,
            executionCase,
          ));
        } catch (error) {
          const message = error instanceof Error ? error.stack ?? error.message : String(error);
          executionFailures.push({ caseId, message });
          log(`${caseId}: EXECUTION FAILURE ${message}`);
        }
      }
    }
    const longSessionEvidence = competitiveLongStroke
      ? await runCompetitiveLongSessionResourceProbe(browser, studioUrl)
      : [];
    const longSessionCoverage = evaluateStudioBrushCompetitiveLongSession(longSessionEvidence);
    const competitiveCoverage = evaluateStudioBrushCompetitiveCoverage(results.flatMap((result) => {
      const executionCase = result.competitiveExecutionCase;
      if (!executionCase) return [];
      return [{
        id: result.id,
        workloadId: executionCase.workloadId,
        pointerRateHz: executionCase.pointerRateHz,
        targetInputSamples: executionCase.targetInputSamples,
        observedInputSamples: result.frameBudgetMetrics.observedPointerMoves,
        intendedStrokeDurationMs: executionCase.intendedStrokeDurationMs,
        observedStrokeDurationMs: result.frameBudgetMetrics.strokeDurationMs,
        requestedViewportWidth: STUDIO_BRUSH_COMPETITIVE_DESKTOP_VIEWPORT.width,
        requestedViewportHeight: STUDIO_BRUSH_COMPETITIVE_DESKTOP_VIEWPORT.height,
        actualViewportWidth: result.actualViewport.width,
        actualViewportHeight: result.actualViewport.height,
        requestedDeviceScaleFactor: executionCase.deviceScaleFactor,
        actualDeviceScaleFactor: result.actualDeviceScaleFactor,
        expectedProviderRoute: STUDIO_BRUSH_COMPETITIVE_PROVIDER_ROUTES[result.id],
        observedProviderRoute: result.frameBudgetMetrics.observedProviderRoute,
        routeDiagnostics: result.frameBudgetMetrics.routeDiagnostics,
        hardAcceptanceOk: result.frameBudgetEvaluation.ok,
      }];
    }));
    const unexpectedBrowserErrors = results.flatMap((result) => [
      ...result.browserErrors.console,
      ...result.browserErrors.page,
      ...result.browserErrors.responses,
    ]);
    const report = {
      kind: "toonspectrum-studio-brush-latency-browser-v3",
      generatedAt: new Date().toISOString(),
      mode: competitiveLongStroke ? "competitive-long-stroke" : "smoke",
      route: studioUrl,
      scratch: SCRATCH,
      policy: {
        hardAcceptance: STUDIO_BRUSH_COMPETITIVE_FRAME_BUDGETS,
        inputTimeoutMs: INPUT_TIMEOUT_MS,
        settleObservationMs: SETTLE_OBSERVATION_MS,
        legacyTelemetryOnly: true,
        note:
          "The competitive gate hard-fails pointer/append p95 or p99 tails, compositor latency, "
          + "lost delivery, blank frames, >=50ms long tasks, and >50ms pointerup/settle work. "
          + "Historical 34-200ms thresholds are emitted only as legacy telemetry and never "
          + "contribute to this report's ok value.",
      },
      coverageComplete: competitiveLongStroke && competitiveCoverage.ok,
      competitiveCoverage,
      longSessionCoverageComplete: competitiveLongStroke && longSessionCoverage.ok,
      longSessionCoverage,
      longSessionEvidence,
      runtimeMs: performance.now() - started,
      results,
      executionFailures,
      unexpectedBrowserErrors,
      ok:
        results.length === representatives.length * executionCases.length
        && executionFailures.length === 0
        && results.every((result) => result.frameBudgetEvaluation.ok)
        && (!competitiveLongStroke || competitiveCoverage.ok)
        && (!competitiveLongStroke || longSessionCoverage.ok)
        && unexpectedBrowserErrors.length === 0,
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    log(
      `report ${REPORT_PATH} · ${results.length}/`
        + `${representatives.length * executionCases.length} cases`,
    );
    invariant(report.ok, "Studio brush latency gate failed; inspect its JSON report");
    log("ALL REPRESENTATIVE BRUSH LATENCY GATES OK");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopChildProcess(server, { releaseStdio: false }).catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
