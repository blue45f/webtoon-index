/** Real Chromium + checked-in Hokusai WASM gate for the incremental live provider. */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const EVIDENCE_ROOT = process.env.TOONSPECTRUM_HOKUSAI_LIVE_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-hokusai-live-${Date.now()}`);
const HARNESS_PATH = "/__studio_hokusai_live_quality__";
const ENTRY = "/scripts/studio-hokusai-live-brush-quality-browser.ts";
const TIMEOUT_MS = 150_000;
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
  + "connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; "
  + "style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a Hokusai live QA port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function writeJson(name, value) {
  writeFileSync(join(EVIDENCE_ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function html() {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Hokusai live brush quality</title><style>
*{box-sizing:border-box}body{margin:0;padding:20px;background:#171717;color:#f5f5f5;font:14px system-ui,sans-serif}
h1{margin:0 0 16px}.grid{display:grid;gap:16px}.card{padding:12px;border:1px solid #4a4a4a;border-radius:12px;background:#242424}
h2{margin:0 0 8px;font-size:15px;color:#ddd}.frame{overflow:hidden;border-radius:8px;background:#fff}
canvas{display:block;width:100%;height:auto}
</style></head><body><h1>Hokusai WASM dirty-delta live quality</h1><div class="grid">
<section class="card" id="first-card"><h2>첫 live dirty frame</h2><div class="frame"><canvas id="first-frame" width="1024" height="256"></canvas></div></section>
<section class="card" id="live-card"><h2>모든 delta + finish tail 합성</h2><div class="frame"><canvas id="live-frame" width="1024" height="256"></canvas></div></section>
<section class="card" id="canonical-card"><h2>canonical PNG</h2><div class="frame"><canvas id="canonical-frame" width="1024" height="256"></canvas></div></section>
<section class="card" id="material-card"><h2>동일 입력 자연매체 5종 · canonical</h2>
<div class="frame"><canvas id="quality-pencil" width="1024" height="320"></canvas></div>
<div class="frame"><canvas id="quality-charcoal" width="1024" height="320"></canvas></div>
<div class="frame"><canvas id="quality-oil" width="1024" height="320"></canvas></div>
<div class="frame"><canvas id="quality-calligraphy" width="1024" height="320"></canvas></div>
<div class="frame"><canvas id="quality-marker" width="1024" height="320"></canvas></div></section>
<section class="card" id="sparse-card"><h2>시간 채널 없는 희소 8자 획 · canonical</h2>
<div class="frame"><canvas id="quality-sparse-figure-eight" width="1024" height="320"></canvas></div></section>
</div><script type="module" src="${ENTRY}"></script></body></html>`;
}

function validate(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result?.status !== "ok") return [`browser harness failed: ${result?.message ?? "unknown"}`];
  if (result.backend !== "real-chromium-dedicated-worker-hokusai-wasm-dirty-delta-live-v1") {
    failures.push("production Dedicated Worker/WASM identity missing");
  }
  if (result.ready !== true || result.capabilities?.mainThreadFullFrameCopy !== false) {
    failures.push("prewarm capability admission failed");
  }
  if (!Number.isFinite(result.prewarmMilliseconds) || result.prewarmMilliseconds > 5_000) {
    failures.push(`prewarm exceeded 5s: ${result.prewarmMilliseconds}`);
  }
  if (result.sampleCount !== 5_000 || result.batchCount < 2 || result.liveFrameCount < 1) {
    failures.push("5k multi-batch input was not exercised");
  }
  if (result.stalePresentationsCoalesced !== true) {
    failures.push("one-frame backpressure did not coalesce a stale presentation");
  }
  if (result.maximumConcurrentPresentationCallbacks !== 1) {
    failures.push("more than one transferable presentation callback was active");
  }
  if (result.settleTailFrameCount > 1) {
    failures.push("more than one settle tail was transmitted");
  }
  if (
    !Number.isFinite(result.totalTransferredBytes)
    || result.totalTransferredBytes <= 0
    || result.totalTransferredBytes > 32 * 1024 * 1024
  ) failures.push(`dirty-delta transfer budget failed: ${result.totalTransferredBytes}`);
  if (
    !Number.isFinite(result.maximumTransferredFrameBytes)
    || result.maximumTransferredFrameBytes > 16 * 1024 * 1024
  ) failures.push(`single dirty-frame budget failed: ${result.maximumTransferredFrameBytes}`);
  if (
    !Number.isFinite(result.appendToFrameLatency?.maximumMilliseconds)
    || result.appendToFrameLatency.maximumMilliseconds > 10_000
  ) failures.push(`append-to-frame latency failed: ${result.appendToFrameLatency?.maximumMilliseconds}`);
  if (!Number.isFinite(result.totalRenderMilliseconds) || result.totalRenderMilliseconds > 90_000) {
    failures.push(`5k render exceeded 90s: ${result.totalRenderMilliseconds}`);
  }
  const performanceReceipt = result.performanceReceipt;
  const startupDelay = performanceReceipt?.mainThreadDelayByPhase?.["startup-prewarm"];
  const interactiveDelay = performanceReceipt?.mainThreadDelayByPhase?.["interactive-5k"];
  if (
    performanceReceipt?.version !== "studio-hokusai-live-performance-v1"
    || performanceReceipt.sampleIntervalMilliseconds !== 4
    || performanceReceipt.interactiveBudgetMilliseconds !== 20
  ) failures.push("phase-separated main-thread performance receipt is missing");
  if (
    !Number.isFinite(startupDelay?.maximumDelayMilliseconds)
    || startupDelay.maximumDelayMilliseconds > 1_000
  ) failures.push(`startup/prewarm main delay exceeded 1s: ${startupDelay?.maximumDelayMilliseconds}`);
  if (
    !Number.isFinite(interactiveDelay?.maximumDelayMilliseconds)
    || interactiveDelay.maximumDelayMilliseconds > 20
    || interactiveDelay.overBudgetTickCount !== 0
    || result.maximumMainThreadDelayMilliseconds !== interactiveDelay.maximumDelayMilliseconds
  ) failures.push(`interactive 5k main delay exceeded 20ms: ${interactiveDelay?.maximumDelayMilliseconds}`);
  for (const [name, value] of Object.entries({
    appendDispatch: performanceReceipt?.appendDispatchMaximumMilliseconds,
    frameCallback: performanceReceipt?.frameCallbackMaximumMilliseconds,
    frameCompose: performanceReceipt?.frameComposeMaximumMilliseconds,
    frameOverlay: performanceReceipt?.frameOverlayMaximumMilliseconds,
  })) {
    if (!Number.isFinite(value) || value > 20) {
      failures.push(`${name} synchronous main-thread work exceeded 20ms: ${value}`);
    }
  }
  if (
    result.browserComposedExactCanonical !== true
    || result.browserComposedHash !== result.finalCanonicalHash
    || result.exactLiveCommitParity !== true
  ) failures.push("browser patch composition does not equal canonical pixels/hash");
  if (
    result.cancelRecovery?.cancelledStrokeReleased !== true
    || result.cancelRecovery?.recoveryComplete !== true
    || result.cancelRecovery?.recoveryEngineEpoch < 3
  ) failures.push("epoch cancellation/recovery gate failed");
  const families = Array.isArray(result.materialFamilies) ? result.materialFamilies : [];
  if (families.length !== 5) {
    failures.push(
      "pencil/charcoal/oil/calligraphy/marker material evidence is incomplete",
    );
  }
  const hashes = new Set();
  for (
    const presetId of ["pencil", "charcoal", "oil", "calligraphy", "marker"]
  ) {
    const family = families.find((candidate) => candidate?.presetId === presetId);
    const metrics = family?.metrics;
    const timing = family?.timing;
    if (family?.settledPixelHash) hashes.add(family.settledPixelHash);
    if (
      !family
      || family.exactLiveCommitParity !== true
      || family.browserComposedExactCanonical !== true
      || !metrics
      || metrics.nonZeroPixels < 1_000
      || !Number.isFinite(metrics.alphaMean)
      || metrics.alphaMean < 0.16
      || !Number.isFinite(metrics.alphaStandardDeviation)
      || metrics.alphaStandardDeviation < 18
      || !Number.isFinite(metrics.edgeDensity)
      || metrics.edgeDensity < 0.08
      || !Number.isFinite(metrics.neighbourDifference)
      || metrics.neighbourDifference < 3
      || !Number.isFinite(metrics.periodicity)
      || metrics.periodicity > 0.55
      || !Number.isFinite(metrics.circleCarrierExposure)
      || metrics.circleCarrierExposure > 0.45
      || !Number.isFinite(metrics.startBackMassRatio)
      || metrics.startBackMassRatio > 0.35
      || metrics.centerlineGapsAfterStart !== 0
      || !Number.isFinite(metrics.directionalAnisotropy)
      || metrics.directionalAnisotropy < 1.01
      || !Number.isFinite(family.totalMilliseconds)
      || family.totalMilliseconds > 8_000
      || !timing
      || ![
        timing.beginMilliseconds,
        timing.appendDispatchMilliseconds,
        timing.workerRoundTripAndCanonicalMilliseconds,
        timing.framePresentationTotalMilliseconds,
        timing.framePresentationMaximumMilliseconds,
        timing.parityVerificationMilliseconds,
        timing.canonicalDrawMilliseconds,
        timing.qualityAnalysisMilliseconds,
      ].every((value) => Number.isFinite(value) && value >= 0)
      || timing.framePresentationMaximumMilliseconds > 20
    ) failures.push(`${presetId} material quality/continuity gate failed`);
  }
  if (hashes.size !== 5) {
    failures.push(
      "pencil/charcoal/oil/calligraphy/marker material outputs are not distinct",
    );
  }
  const sparse = result.sparseFigureEightCoverage;
  if (
    sparse?.sampleCount !== 24
    || sparse.receiptSampleCount !== sparse.sampleCount
    || sparse.browserComposedExactCanonical !== true
    || !Number.isFinite(sparse.leftCoverage)
    || sparse.leftCoverage < 0.75
    || !Number.isFinite(sparse.rightCoverage)
    || sparse.rightCoverage < 0.75
    || !Number.isFinite(sparse.leftAlphaMassRatio)
    || sparse.leftAlphaMassRatio < 0.15
    || !Number.isFinite(sparse.rightAlphaMassRatio)
    || sparse.rightAlphaMassRatio < 0.15
    || !Array.isArray(sparse.sourceBounds)
    || !Array.isArray(sparse.canonicalBounds)
    || sparse.canonicalBounds[0] > sparse.sourceBounds[0] + 14
    || sparse.canonicalBounds[2] < sparse.sourceBounds[2] - 14
  ) failures.push("sparse mouse figure-eight lost authored geometry at canonical commit");
  const oil = families.find((candidate) => candidate?.presetId === "oil")?.metrics;
  const charcoal = families.find((candidate) => candidate?.presetId === "charcoal")?.metrics;
  if (
    !oil
    || !charcoal
    || oil.directionalAnisotropy <= 1.08
    || Math.abs(oil.alphaStandardDeviation - charcoal.alphaStandardDeviation) < 2
  ) failures.push("oil bristle ridges are not measurably separated from charcoal grain");
  if (
    diagnostics.consoleErrors.length
    || diagnostics.consoleWarnings.length
    || diagnostics.pageErrors.length
    || diagnostics.requestFailures.length
  ) failures.push("Chromium emitted console/page/network diagnostics");
  return failures;
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const port = await freePort();
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
    plugins: [{
      name: "studio-hokusai-live-quality-verifier",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== HARNESS_PATH) return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Content-Security-Policy", CSP);
          response.setHeader("Cache-Control", "no-store");
          response.end(html());
        });
      },
    }],
  });
  await vite.listen();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1_100, height: 1_020 } });
    const diagnostics = {
      browserVersion: browser.version(),
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
    };
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
      if (message.type() === "warning") diagnostics.consoleWarnings.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => diagnostics.requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
    ));
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => window.__studioHokusaiLiveQualityResult !== undefined,
      undefined,
      { timeout: TIMEOUT_MS },
    );
    const result = await page.evaluate(() => window.__studioHokusaiLiveQualityResult);
    writeJson("live-quality-metrics.json", result);
    writeJson("browser-diagnostics.json", diagnostics);
    await page.locator("#first-card").screenshot({ path: join(EVIDENCE_ROOT, "first-live-frame.png") });
    await page.locator("#live-card").screenshot({ path: join(EVIDENCE_ROOT, "final-live-composition.png") });
    await page.locator("#canonical-card").screenshot({ path: join(EVIDENCE_ROOT, "final-canonical-png.png") });
    await page.locator("#material-card").screenshot({ path: join(EVIDENCE_ROOT, "material-family-canonical.png") });
    await page.locator("#sparse-card").screenshot({ path: join(EVIDENCE_ROOT, "sparse-figure-eight-canonical.png") });
    await page.screenshot({ path: join(EVIDENCE_ROOT, "live-quality-full.png"), fullPage: true });
    const failures = validate(result, diagnostics);
    const summary = {
      status: failures.length ? "failed" : "ok",
      backend: result?.backend ?? null,
      samples: result?.sampleCount ?? null,
      liveFrames: result?.liveFrameCount ?? null,
      settleTailFrames: result?.settleTailFrameCount ?? null,
      totalTransferredBytes: result?.totalTransferredBytes ?? null,
      totalRenderMilliseconds: result?.totalRenderMilliseconds ?? null,
      maximumMainThreadDelayMilliseconds: result?.maximumMainThreadDelayMilliseconds ?? null,
      startupMainThreadDelayMilliseconds: result?.performanceReceipt
        ?.mainThreadDelayByPhase?.["startup-prewarm"]?.maximumDelayMilliseconds ?? null,
      performanceReceipt: result?.performanceReceipt ?? null,
      materialFamilyTimings: Array.isArray(result?.materialFamilies)
        ? result.materialFamilies.map(({ presetId, timing }) => ({ presetId, timing }))
        : [],
      failures,
      evidenceDirectory: EVIDENCE_ROOT,
    };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await vite.close();
  }
}

main().catch((error) => {
  const failure = {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    evidenceDirectory: EVIDENCE_ROOT,
  };
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeJson("summary.json", failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
