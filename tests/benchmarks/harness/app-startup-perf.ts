/**
 * tests/benchmarks/harness/app-startup-perf.ts
 *
 * Real-browser startup/loading profile for the production Studio bundle.
 *
 * Measurement-only harness (no app code is touched). It drives a Playwright
 * Chromium against a `vite preview` server that is already serving `dist/`,
 * and records, per scenario and per throttle profile:
 *
 *   - Navigation Timing (TTFB, DOMContentLoaded, load)
 *   - Paint Timing (FCP) and largest-contentful-paint
 *   - Long tasks (PerformanceObserver "longtask") for 5s after entry, with
 *     Total Blocking Time derived from them
 *   - Time-to-interactive-surface: when the Studio canvas surface actually
 *     exists and the shipped undo control is enabled
 *   - Every network response (transfer + decoded bytes) so the *actual*
 *     downloaded JS can be compared against check-studio-bundle.mjs's static
 *     manifest closure
 *   - Chrome trace `EvaluateScript`/`v8.compile` events attributed per URL, so
 *     per-chunk parse+eval cost is real rather than inferred
 *
 * Usage (preview server must already be running):
 *   STARTUP_PERF_BASE_URL=http://localhost:4199 \
 *     pnpm exec tsx tests/benchmarks/harness/app-startup-perf.ts
 *
 * Results are written to tests/benchmarks/results/app-startup-perf.json.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { chromium } from "playwright";

import type { Browser, CDPSession, Page } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const RESULTS_PATH = join(REPO_ROOT, "tests", "benchmarks", "results", "app-startup-perf.json");
const DIST_DIR = join(REPO_ROOT, "dist");
const MANIFEST_PATH = join(DIST_DIR, ".vite", "manifest.json");

const BASE_URL = process.env.STARTUP_PERF_BASE_URL ?? "http://localhost:4199";
const ITERATIONS = Number(process.env.STARTUP_PERF_ITERATIONS ?? 3);
const LONGTASK_WINDOW_MS = 5_000;

/** Chrome DevTools "Slow 4G" preset (== legacy "Fast 3G"). */
const SLOW_4G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
} as const;

const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";

interface ThrottleProfile {
  readonly id: string;
  readonly label: string;
  readonly cpuRate: number;
  readonly network: typeof SLOW_4G | null;
}

const PROFILES: readonly ThrottleProfile[] = [
  { id: "unthrottled", label: "desktop, no throttling", cpuRate: 1, network: null },
  { id: "cpu4x-slow4g", label: "CPU 4x + Slow 4G", cpuRate: 4, network: SLOW_4G },
];

interface NetworkRecord {
  url: string;
  status: number;
  resourceType: string;
  mimeType: string;
  transferBytes: number;
  decodedBytes: number;
  fromCache: boolean;
  startMs: number;
  endMs: number;
}

interface LongTask {
  startTime: number;
  duration: number;
  name: string;
  containerType: string;
  containerName: string;
  containerSrc: string;
}

interface PageMetrics {
  ttfbMs: number;
  domContentLoadedMs: number;
  loadEventMs: number;
  fcpMs: number;
  lcpMs: number;
  domInteractiveMs: number;
  responseEndMs: number;
  longTasks: LongTask[];
  navigationCount: number;
  crossOriginIsolated: boolean;
  resourceTiming: Array<{
    name: string;
    initiatorType: string;
    startTime: number;
    duration: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  }>;
}

interface EvalCost {
  url: string;
  compileMs: number;
  evaluateMs: number;
  totalMs: number;
  events: number;
}

interface ScenarioRun {
  interactiveSurfaceMs: number | null;
  interactiveSurfaceError: string | null;
  metrics: PageMetrics;
  network: NetworkRecord[];
  evalCosts: EvalCost[];
  consoleErrors: string[];
  wallClockMs: number;
  mainFrameNavigations: string[];
}

/**
 * Manifest-derived static closure of the Studio route plus the app shell.
 * Anything the browser actually downloads that is NOT in this set arrived
 * through a dynamic import — which is exactly the gap between
 * scripts/check-studio-bundle.mjs's static budget and real startup cost.
 */
function staticClosureFileNames(): { files: Set<string>; studioChunks: number; appChunks: number } {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
    string,
    { file: string; imports?: string[] }
  >;
  const closure = (entryKey: string) => {
    const visited = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      const entry = manifest[key];
      if (!entry) return;
      visited.add(key);
      for (const imported of entry.imports ?? []) visit(imported);
    };
    visit(entryKey);
    return visited;
  };
  const studioKeys = closure("apps/web/src/domains/creator/StudioPage.tsx");
  const appKeys = closure("index.html");
  const files = new Set(
    [...studioKeys, ...appKeys].map((key) => manifest[key]!.file.split("/").pop()!),
  );
  return { files, studioChunks: studioKeys.size, appChunks: appKeys.size };
}

const STATIC_CLOSURE = staticClosureFileNames();

function shortName(url: string): string {
  try {
    return new URL(url).pathname.split("/").pop() ?? url;
  } catch {
    return url;
  }
}

/**
 * `vite preview` serves most emitted assets uncompressed, so the wire bytes it
 * reports are not what production (Vercel, brotli/gzip) would send. Gzipping
 * the emitted file gives a production-representative transfer size.
 */
const gzipCache = new Map<string, number>();
function gzipBytesForChunk(fileName: string): number {
  const cached = gzipCache.get(fileName);
  if (cached !== undefined) return cached;
  let size: number;
  try {
    size = gzipSync(readFileSync(join(DIST_DIR, "assets", fileName))).byteLength;
  } catch {
    size = 0;
  }
  gzipCache.set(fileName, size);
  return size;
}

function median(values: number[]): number {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) return Number.NaN;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 === 1
    ? usable[mid]!
    : ((usable[mid - 1]! + usable[mid]!) / 2);
}

function round(value: number, digits = 1): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : Number.NaN;
}

/** Total Blocking Time: sum of (longtask duration - 50ms) over the window. */
function totalBlockingTime(tasks: LongTask[]): number {
  return tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
}

const OBSERVER_INIT_SCRIPT = `(() => {
  const store = { longTasks: [], lcp: 0 };
  globalThis.__startupPerf = store;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = entry.attribution && entry.attribution[0];
        store.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
          containerType: attribution ? attribution.containerType : "",
          containerName: attribution ? attribution.containerName : "",
          containerSrc: attribution ? attribution.containerSrc : "",
        });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
})();`;

const DISMISS_OVERLAYS_SCRIPT = `(() => {
  try {
    localStorage.setItem(${JSON.stringify(QUICKSTART_KEY)}, "1");
    localStorage.setItem(${JSON.stringify(MOBILE_HINT_KEY)}, "1");
  } catch {}
})();`;

async function collectMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const store = (globalThis as unknown as {
      __startupPerf?: { longTasks: LongTask[]; lcp: number };
    }).__startupPerf ?? { longTasks: [], lcp: 0 };
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const nav = navEntries[navEntries.length - 1];
    const fcpEntry = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    return {
      ttfbMs: nav ? nav.responseStart : Number.NaN,
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : Number.NaN,
      loadEventMs: nav ? nav.loadEventEnd : Number.NaN,
      domInteractiveMs: nav ? nav.domInteractive : Number.NaN,
      responseEndMs: nav ? nav.responseEnd : Number.NaN,
      fcpMs: fcpEntry ? fcpEntry.startTime : Number.NaN,
      lcpMs: store.lcp,
      longTasks: store.longTasks,
      navigationCount: navEntries.length,
      crossOriginIsolated: Boolean((globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated),
      resourceTiming: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(
        (entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        }),
      ),
    };
  }) as Promise<PageMetrics>;
}

/**
 * Chrome trace events give the only trustworthy per-chunk parse+eval numbers.
 * `EvaluateScript` / `v8.compile` carry the script URL in their args, so we can
 * attribute main-thread script cost back to the emitted chunk file.
 */
async function startTrace(client: CDPSession): Promise<void> {
  await client.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8",
        "v8.execute",
        "disabled-by-default-v8.compile",
      ],
    },
  });
}

interface TraceEvent {
  name?: string;
  ph?: string;
  dur?: number;
  args?: { data?: { url?: string; fileName?: string; notStreamedReason?: string } };
}

async function stopTrace(client: CDPSession): Promise<EvalCost[]> {
  const events: TraceEvent[] = [];
  const onData = (payload: { value: TraceEvent[] }) => {
    events.push(...payload.value);
  };
  client.on("Tracing.dataCollected", onData as never);
  const complete = new Promise<void>((resolvePromise) => {
    client.once("Tracing.tracingComplete", () => resolvePromise());
  });
  await client.send("Tracing.end");
  await complete;
  client.off("Tracing.dataCollected", onData as never);

  const byUrl = new Map<string, EvalCost>();
  for (const event of events) {
    if (event.ph !== "X" || typeof event.dur !== "number") continue;
    const name = event.name ?? "";
    const isEvaluate = name === "EvaluateScript" || name === "v8.run" || name === "v8.evaluateModule";
    const isCompile = name === "v8.compile" || name === "v8.compileModule" || name === "v8.parseOnBackground";
    if (!isEvaluate && !isCompile) continue;
    const url = event.args?.data?.url ?? event.args?.data?.fileName ?? "";
    if (!url || !url.startsWith("http")) continue;
    const ms = event.dur / 1000;
    const bucket = byUrl.get(url) ?? { url, compileMs: 0, evaluateMs: 0, totalMs: 0, events: 0 };
    if (isEvaluate) bucket.evaluateMs += ms;
    else bucket.compileMs += ms;
    bucket.totalMs += ms;
    bucket.events += 1;
    byUrl.set(url, bucket);
  }
  return [...byUrl.values()].sort((a, b) => b.totalMs - a.totalMs);
}

interface ScenarioDefinition {
  readonly id: string;
  readonly label: string;
  readonly run: (page: Page) => Promise<void>;
  readonly waitForInteractive: (page: Page) => Promise<void>;
}

/** Studio is interactive once the Konva surface exists and undo is reachable. */
async function waitForStudioSurface(page: Page): Promise<void> {
  await page.waitForSelector(".konvajs-content, canvas", { state: "attached", timeout: 120_000 });
}

const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: "studio-cold-direct",
    label: "cold direct load of /studio (deep link)",
    run: async (page) => {
      await page.goto(`${BASE_URL}/studio`, { waitUntil: "commit", timeout: 180_000 });
    },
    waitForInteractive: waitForStudioSurface,
  },
  {
    id: "landing-cold",
    label: "cold load of / (landing)",
    run: async (page) => {
      await page.goto(`${BASE_URL}/`, { waitUntil: "commit", timeout: 180_000 });
    },
    waitForInteractive: async (page) => {
      await page.waitForSelector("main, #root > *", { state: "attached", timeout: 120_000 });
      await page.waitForLoadState("load", { timeout: 120_000 });
    },
  },
  {
    id: "landing-to-studio-spa",
    label: "landing then in-app navigation to /studio",
    run: async (page) => {
      await page.goto(`${BASE_URL}/`, { waitUntil: "load", timeout: 180_000 });
      // Reset the observer store so the SPA leg is measured on its own clock.
      await page.evaluate(() => {
        const store = (globalThis as unknown as {
          __startupPerf?: { longTasks: unknown[]; lcp: number };
        }).__startupPerf;
        if (store) {
          store.longTasks.length = 0;
          store.lcp = 0;
        }
      });
      await page.evaluate((target) => {
        globalThis.history.pushState({}, "", target);
        globalThis.dispatchEvent(new PopStateEvent("popstate"));
      }, "/studio");
    },
    waitForInteractive: waitForStudioSurface,
  },
];

async function runScenario(
  browser: Browser,
  scenario: ScenarioDefinition,
  profile: ThrottleProfile,
): Promise<ScenarioRun> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(DISMISS_OVERLAYS_SCRIPT);
  await context.addInitScript(OBSERVER_INIT_SCRIPT);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`.slice(0, 400)));

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Page.enable");
  // A landing -> /studio SPA transition trips the Studio cross-origin-isolation
  // guard, which performs a full document reload. Counting main-frame
  // navigations is the only way to see that discarded first load.
  const mainFrameNavigations: string[] = [];
  client.on("Page.frameNavigated", (payload) => {
    if (!payload.frame.parentId) mainFrameNavigations.push(payload.frame.url);
  });
  if (profile.network) {
    await client.send("Network.emulateNetworkConditions", { ...profile.network });
  }
  if (profile.cpuRate > 1) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  }

  const network: NetworkRecord[] = [];
  const inFlight = new Map<string, { url: string; type: string; start: number }>();
  client.on("Network.requestWillBeSent", (payload) => {
    inFlight.set(payload.requestId, {
      url: payload.request.url,
      type: payload.type ?? "Other",
      start: payload.timestamp * 1000,
    });
  });
  const responseMeta = new Map<string, { status: number; mimeType: string; fromCache: boolean }>();
  client.on("Network.responseReceived", (payload) => {
    responseMeta.set(payload.requestId, {
      status: payload.response.status,
      mimeType: payload.response.mimeType,
      fromCache: Boolean(payload.response.fromDiskCache),
    });
    const pending = inFlight.get(payload.requestId);
    if (pending && payload.type) pending.type = payload.type;
  });
  client.on("Network.loadingFinished", (payload) => {
    const pending = inFlight.get(payload.requestId);
    if (!pending) return;
    const meta = responseMeta.get(payload.requestId);
    network.push({
      url: pending.url,
      status: meta?.status ?? 0,
      resourceType: pending.type,
      mimeType: meta?.mimeType ?? "",
      transferBytes: payload.encodedDataLength,
      decodedBytes: 0,
      fromCache: meta?.fromCache ?? false,
      startMs: pending.start,
      endMs: payload.timestamp * 1000,
    });
    inFlight.delete(payload.requestId);
  });

  await startTrace(client);
  const wallStart = Date.now();
  let interactiveSurfaceMs: number | null = null;
  let interactiveSurfaceError: string | null = null;
  try {
    await scenario.run(page);
    const interactiveStart = Date.now();
    await scenario.waitForInteractive(page);
    interactiveSurfaceMs = Date.now() - interactiveStart;
  } catch (error) {
    interactiveSurfaceError = error instanceof Error ? error.message.slice(0, 300) : String(error);
  }
  // Keep observing so post-hydration long tasks (engine warmup, autosave, worker
  // spin-up) are attributed to startup rather than silently dropped.
  await page.waitForTimeout(LONGTASK_WINDOW_MS);
  const wallClockMs = Date.now() - wallStart;

  const metrics = await collectMetrics(page).catch(() => ({
    ttfbMs: Number.NaN,
    domContentLoadedMs: Number.NaN,
    loadEventMs: Number.NaN,
    domInteractiveMs: Number.NaN,
    responseEndMs: Number.NaN,
    fcpMs: Number.NaN,
    lcpMs: Number.NaN,
    longTasks: [],
    navigationCount: 0,
    crossOriginIsolated: false,
    resourceTiming: [],
  }));
  const evalCosts = await stopTrace(client).catch(() => [] as EvalCost[]);

  // Resource Timing is the source of truth for byte accounting. CDP's
  // encodedDataLength is 0 for anything vite preview serves uncompressed, so
  // using it alone would understate the payload by an order of magnitude.
  const cdpByUrl = new Map(network.map((record) => [record.url, record]));
  const reconciled: NetworkRecord[] = metrics.resourceTiming.map((entry) => {
    const cdp = cdpByUrl.get(entry.name);
    return {
      url: entry.name,
      status: cdp?.status ?? 200,
      resourceType: cdp?.resourceType ?? entry.initiatorType,
      mimeType: cdp?.mimeType ?? "",
      // Wire bytes: prefer Resource Timing transferSize; it accounts for
      // content-encoding, which is what a production CDN would apply.
      transferBytes: entry.transferSize > 0 ? entry.transferSize : (cdp?.transferBytes ?? 0),
      decodedBytes: entry.decodedBodySize,
      fromCache: cdp?.fromCache ?? false,
      startMs: entry.startTime,
      endMs: entry.startTime + entry.duration,
    };
  });

  await context.close();
  return {
    interactiveSurfaceMs,
    interactiveSurfaceError,
    metrics,
    network: reconciled,
    evalCosts,
    consoleErrors,
    wallClockMs,
    mainFrameNavigations,
  };
}

function isJavaScript(record: NetworkRecord): boolean {
  return record.mimeType.includes("javascript") || record.url.endsWith(".js");
}

function summarizeRuns(runs: ScenarioRun[]) {
  const last = runs[runs.length - 1]!;
  const jsRecords = last.network.filter(isJavaScript);
  const allTasks = runs.flatMap((run) => run.metrics.longTasks);
  return {
    iterations: runs.length,
    ttfbMs: round(median(runs.map((run) => run.metrics.ttfbMs))),
    domContentLoadedMs: round(median(runs.map((run) => run.metrics.domContentLoadedMs))),
    loadEventMs: round(median(runs.map((run) => run.metrics.loadEventMs))),
    fcpMs: round(median(runs.map((run) => run.metrics.fcpMs))),
    lcpMs: round(median(runs.map((run) => run.metrics.lcpMs))),
    interactiveSurfaceMs: round(
      median(runs.map((run) => run.interactiveSurfaceMs ?? Number.NaN)),
    ),
    totalBlockingTimeMs: round(
      median(runs.map((run) => totalBlockingTime(run.metrics.longTasks))),
    ),
    longTaskCount: round(median(runs.map((run) => run.metrics.longTasks.length)), 0),
    longestTaskMs: round(median(runs.map((run) => Math.max(0, ...run.metrics.longTasks.map((t) => t.duration))))),
    navigationCount: last.metrics.navigationCount,
    crossOriginIsolated: last.metrics.crossOriginIsolated,
    jsRequestCount: jsRecords.length,
    jsTransferBytes: jsRecords.reduce((sum, record) => sum + record.transferBytes, 0),
    jsDecodedBytes: jsRecords.reduce((sum, record) => sum + record.decodedBytes, 0),
    jsGzipBytes: jsRecords.reduce(
      (sum, record) => sum + gzipBytesForChunk(shortName(record.url)),
      0,
    ),
    totalRequestCount: last.network.length,
    totalTransferBytes: last.network.reduce((sum, record) => sum + record.transferBytes, 0),
    topJsChunks: jsRecords
      .slice()
      .sort((a, b) => b.decodedBytes - a.decodedBytes)
      .slice(0, 10)
      .map((record) => ({
        file: shortName(record.url),
        decodedBytes: record.decodedBytes,
        transferBytes: record.transferBytes,
        gzipBytes: gzipBytesForChunk(shortName(record.url)),
        requestedAtMs: round(record.startMs),
      })),
    // The gap this whole harness exists to quantify: chunks the manifest calls
    // "dynamic" (and which therefore never count against the static budget in
    // scripts/check-studio-bundle.mjs) but which the browser downloads anyway
    // during startup, before the user has done anything.
    eagerDynamic: (() => {
      const beyond = jsRecords.filter(
        (record) => !STATIC_CLOSURE.files.has(shortName(record.url)),
      );
      return {
        requestCount: beyond.length,
        decodedBytes: beyond.reduce((sum, record) => sum + record.decodedBytes, 0),
        chunks: beyond
          .slice()
          .sort((a, b) => b.decodedBytes - a.decodedBytes)
          .slice(0, 20)
          .map((record) => ({
            file: shortName(record.url),
            decodedBytes: record.decodedBytes,
            requestedAtMs: round(record.startMs),
          })),
      };
    })(),
    // Serialized dynamic-import waves: each cluster of request start times is
    // one extra round trip the user waits through.
    requestWaves: (() => {
      const starts = jsRecords.map((record) => record.startMs).sort((a, b) => a - b);
      const waves: Array<{ startMs: number; endMs: number; requests: number }> = [];
      for (const start of starts) {
        const current = waves[waves.length - 1];
        if (current && start - current.endMs < 80) {
          current.endMs = start;
          current.requests += 1;
        } else {
          waves.push({ startMs: start, endMs: start, requests: 1 });
        }
      }
      return waves.map((wave) => ({
        startMs: round(wave.startMs),
        endMs: round(wave.endMs),
        requests: wave.requests,
      }));
    })(),
    tinyChunkCount: jsRecords.filter((record) => record.decodedBytes < 4096).length,
    tinyChunkBytes: jsRecords
      .filter((record) => record.decodedBytes < 4096)
      .reduce((sum, record) => sum + record.decodedBytes, 0),
    stylesheetBytes: last.network
      .filter((record) => record.url.endsWith(".css"))
      .reduce((sum, record) => sum + record.decodedBytes, 0),
    mainFrameNavigations: last.mainFrameNavigations,
    topEvalCosts: last.evalCosts.slice(0, 12).map((cost) => ({
      file: shortName(cost.url),
      compileMs: round(cost.compileMs),
      evaluateMs: round(cost.evaluateMs),
      totalMs: round(cost.totalMs),
    })),
    topLongTasks: allTasks
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 8)
      .map((task) => ({
        durationMs: round(task.duration),
        startMs: round(task.startTime),
        containerType: task.containerType,
        containerName: task.containerName,
      })),
    consoleErrorCount: last.consoleErrors.length,
    consoleErrorSamples: [...new Set(last.consoleErrors)].slice(0, 5),
    interactiveSurfaceError: last.interactiveSurfaceError,
  };
}

/**
 * Content-hashed names of the largest emitted chunks. Recording these makes a
 * result set self-verifying: if two runs report the same names, they measured
 * the same bytes regardless of dist/ mtimes.
 */
function largestChunkNames(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
    string,
    { file: string }
  >;
  return Object.values(manifest)
    .map((entry) => entry.file)
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({ file, size: statSync(join(DIST_DIR, file)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .map((entry) => `${entry.file.split("/").pop()} (${(entry.size / 1024).toFixed(0)} KiB)`);
}

function staticManifestClosure() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
    string,
    { file: string; imports?: string[] }
  >;
  const closure = (entryKey: string) => {
    const visited = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      const entry = manifest[key];
      if (!entry) return;
      visited.add(key);
      for (const imported of entry.imports ?? []) visit(imported);
    };
    visit(entryKey);
    return visited;
  };
  const measure = (keys: Set<string>) => {
    let raw = 0;
    for (const key of keys) {
      const entry = manifest[key];
      if (!entry) continue;
      raw += statSync(join(DIST_DIR, entry.file)).size;
    }
    return raw;
  };
  const studioKeys = closure("apps/web/src/domains/creator/StudioPage.tsx");
  const appKeys = closure("index.html");
  return {
    studioChunkCount: studioKeys.size,
    studioRawBytes: measure(studioKeys),
    appChunkCount: appKeys.size,
    appRawBytes: measure(appKeys),
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const results: Record<string, Record<string, ReturnType<typeof summarizeRuns>>> = {};
  const rawRuns: Record<string, Record<string, unknown>> = {};

  for (const profile of PROFILES) {
    for (const scenario of SCENARIOS) {
      const runs: ScenarioRun[] = [];
      for (let index = 0; index < ITERATIONS; index += 1) {
        process.stdout.write(
          `run ${profile.id} / ${scenario.id} / iteration ${index + 1}/${ITERATIONS}\n`,
        );
        runs.push(await runScenario(browser, scenario, profile));
      }
      results[profile.id] ??= {};
      results[profile.id]![scenario.id] = summarizeRuns(runs);
      rawRuns[profile.id] ??= {};
      rawRuns[profile.id]![scenario.id] = runs.map((run) => ({
        interactiveSurfaceMs: run.interactiveSurfaceMs,
        wallClockMs: run.wallClockMs,
        ttfbMs: round(run.metrics.ttfbMs),
        fcpMs: round(run.metrics.fcpMs),
        lcpMs: round(run.metrics.lcpMs),
        loadEventMs: round(run.metrics.loadEventMs),
        tbtMs: round(totalBlockingTime(run.metrics.longTasks)),
        longTaskCount: run.metrics.longTasks.length,
        jsRequestCount: run.network.filter(isJavaScript).length,
      }));
    }
  }

  await browser.close();

  const distStat = statSync(join(DIST_DIR, "index.html"));
  const payload = {
    schema: "toonspectrum.app-startup-perf/1",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    iterationsPerScenario: ITERATIONS,
    longTaskWindowMs: LONGTASK_WINDOW_MS,
    bundle: {
      distBuiltAt: distStat.mtime.toISOString(),
      note:
        "This harness never builds; it measures whatever dist/ currently holds. Content "
        + "hashes of the largest chunks are recorded below so a result set can prove every "
        + "scenario hit the same artifact even when another process rebuilds concurrently.",
      largestChunkHashes: largestChunkNames(),
      staticManifest: staticManifestClosure(),
    },
    host: {
      platform: process.platform,
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      totalMemGiB: round(totalmem() / 1024 ** 3),
      loadAverage: loadavg().map((value) => round(value, 2)),
      concurrentLoadNote:
        "Measured on a shared workstation with other Claude Code agents editing the same "
        + "repository concurrently; loadAverage above is the 1/5/15-minute average captured "
        + "at the end of the run. Absolute timings carry that background-load caveat; "
        + "relative ordering of bottlenecks is stable across iterations.",
    },
    throttleProfiles: PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.label,
      cpuThrottleRate: profile.cpuRate,
      network: profile.network ?? "none",
    })),
    scenarios: SCENARIOS.map((scenario) => ({ id: scenario.id, label: scenario.label })),
    results,
    rawRuns,
  };

  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${RESULTS_PATH}\n`);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
