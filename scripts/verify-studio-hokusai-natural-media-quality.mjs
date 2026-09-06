/**
 * Real Chromium quality gate for ToonSpectrum's selected-stroke Hokusai
 * natural-media provider. Evidence is always written outside the repository.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const EVIDENCE_ROOT =
  process.env.TOONSPECTRUM_HOKUSAI_QUALITY_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-hokusai-natural-media-quality-v2-${Date.now()}`);
const HARNESS_PATH = "/__studio_hokusai_natural_media_quality_v2__";
const HARNESS_ENTRY =
  "/scripts/studio-hokusai-natural-media-quality-browser.ts";
const TIMEOUT_MILLISECONDS = 120_000;
const CSP =
  "default-src 'none'; "
  + "script-src 'self' 'wasm-unsafe-eval'; "
  + "connect-src 'self'; "
  + "worker-src 'self' blob:; "
  + "img-src 'self' data: blob:; "
  + "style-src 'unsafe-inline'; "
  + "font-src 'none'; "
  + "object-src 'none'; "
  + "base-uri 'none'; "
  + "frame-ancestors 'none'";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a Hokusai QA port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(name, value) {
  writeFileSync(
    join(EVIDENCE_ROOT, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function html() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Hokusai natural-media quality v2</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #131211;
      color: #f4f1ed;
      font: 14px/1.4 system-ui, sans-serif;
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 28px 0 12px; color: #edcba7; font-size: 20px; }
    section { display: grid; gap: 14px; }
    .card {
      border: 1px solid #4c4640;
      border-radius: 14px;
      padding: 14px;
      background: #201e1c;
    }
    header { display: flex; justify-content: space-between; gap: 12px; }
    header span, p { color: #bcb4ab; }
    p { margin: 8px 0 0; font-size: 12px; }
    .frame {
      position: relative;
      overflow: hidden;
      margin-top: 10px;
      border-radius: 8px;
      background: #faf8f4;
      box-shadow: inset 0 0 0 1px #d8d2ca;
    }
    canvas { display: block; width: 100%; height: auto; image-rendering: auto; }
    .pressure-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .half::before {
      content: attr(data-label);
      position: absolute;
      z-index: 1;
      top: 6px;
      left: 8px;
      padding: 2px 6px;
      border-radius: 5px;
      background: #161412cc;
      color: #fff;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <h1>Hokusai 0.3.0 · natural-media perceptual quality v2</h1>
  <div>Identical path · colour · size · seed · real Chromium/WASM</div>
  <h2>Before · frozen worker presets</h2>
  <section id="before"></section>
  <h2>After · tuned Hokusai + monotonic material transfer</h2>
  <section id="after"></section>
  <h2>Start carrier · diagnostic crop (transport unchanged)</h2>
  <section id="start-caps"></section>
  <h2>Pressure differentiation</h2>
  <section id="pressure"></section>
  <script type="module" src="${HARNESS_ENTRY}"></script>
</body>
</html>`;
}

function validate(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (
    result?.status !== "ok"
    || result?.backend
      !== "real-chromium-dedicated-worker-hokusai-wasm-packed-dirty-frame-v2"
  ) {
    failures.push("real Worker/WASM quality harness did not complete");
    return failures;
  }
  if (
    !Number.isFinite(result.firstLoadMilliseconds)
    || result.firstLoadMilliseconds <= 0
    || result.firstLoadMilliseconds > 5_000
  ) {
    failures.push(`cold Worker/WASM load exceeded budget: ${
      result.firstLoadMilliseconds
    }`);
  }
  if (
    !Number.isFinite(result.maximumMainThreadDelayMilliseconds)
    || result.maximumMainThreadDelayMilliseconds > 120
  ) {
    failures.push(`main thread stalled during Worker render: ${
      result.maximumMainThreadDelayMilliseconds
    }`);
  }

  const afterHashes = new Set();
  let observedPackedReduction = false;
  for (const presetId of ["pencil", "charcoal", "oil", "calligraphy", "marker"]) {
    const entry = result.after?.[presetId];
    if (entry?.pixelHash) afterHashes.add(entry.pixelHash);
    const dirtyBounds = entry?.dirtyBounds;
    const packedGeometryValid =
      Array.isArray(dirtyBounds)
      && dirtyBounds.length === 4
      && dirtyBounds.every(Number.isSafeInteger)
      && dirtyBounds[0] >= 0
      && dirtyBounds[1] >= 0
      && dirtyBounds[2] > 0
      && dirtyBounds[3] > 0
      && Number.isSafeInteger(entry?.sourceRgbaBytes)
      && Number.isSafeInteger(entry?.packedRgbaBytes)
      && entry.sourceRgbaBytes > 0
      && entry.packedRgbaBytes === dirtyBounds[2] * dirtyBounds[3] * 4
      && entry.packedRgbaBytes <= entry.sourceRgbaBytes
      && Number.isFinite(entry?.packedRgbaRatio)
      && entry.packedRgbaRatio > 0
      && entry.packedRgbaRatio <= 1;
    if (packedGeometryValid && entry.packedRgbaRatio < 0.99) {
      observedPackedReduction = true;
    }
    if (
      !entry
      || !packedGeometryValid
      || entry.deterministicPixel !== true
      || entry.deterministicPng !== true
      || entry.centerlineGaps !== 0
      || entry.nonZeroPixels <= 0
      || !Number.isFinite(entry.periodicity)
      || entry.periodicity > 0.86
      || !Number.isFinite(entry.circleCarrierExposure)
      || entry.circleCarrierExposure > 0.7
    ) {
      failures.push(`${presetId} continuity/determinism/periodicity gate failed`);
    }
  }
  if (afterHashes.size !== 5) failures.push("the five presets are not distinct");
  if (!observedPackedReduction) {
    failures.push("the Worker did not demonstrate a smaller packed dirty frame");
  }

  for (const presetId of ["pencil", "charcoal", "oil"]) {
    const before = result.before?.[presetId];
    const after = result.after?.[presetId];
    const pressure = result.pressure?.[presetId];
    if (
      !before
      || !after
      || after.pixelHash === before.pixelHash
      || after.directPixelParity !== true
      || after.alphaDecreasePixels !== 0
      || !Number.isFinite(after.startBackMassRatio)
      || after.edgeDensity <= 0
      || after.localAlphaVariance <= 0
      || !pressure
      || !Number.isFinite(pressure.inkMassRatio)
      || pressure.inkMassRatio <= 1.05
      || !Number.isFinite(pressure.widthRatio)
      || pressure.widthRatio <= 1.05
    ) {
      failures.push(`${presetId} material/pressure differentiation gate failed`);
    }
  }

  if (
    diagnostics.consoleErrors.length !== 0
    || diagnostics.consoleWarnings.length !== 0
    || diagnostics.pageErrors.length !== 0
    || diagnostics.requestFailures.length !== 0
  ) {
    failures.push("Chromium emitted console, page or request diagnostics");
  }
  return failures;
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const port = await findFreePort();
  const viteServer = await createViteServer({
    appType: "custom",
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
    plugins: [{
      name: "studio-hokusai-natural-media-quality-verifier",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== HARNESS_PATH) {
            next();
            return;
          }
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Content-Security-Policy", CSP);
          response.setHeader("Cache-Control", "no-store");
          response.end(html());
        });
      },
    }],
  });
  await viteServer.listen();

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1_160, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const diagnostics = {
      browserVersion: browser.version(),
      contentSecurityPolicy: CSP,
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
    page.on("requestfailed", (request) => {
      diagnostics.requestFailures.push(
        `${request.method()} ${request.url()}: ${
          request.failure()?.errorText ?? "unknown failure"
        }`,
      );
    });

    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => window.__studioHokusaiNaturalMediaQualityResult !== undefined,
      undefined,
      { timeout: TIMEOUT_MILLISECONDS },
    );
    const result = await page.evaluate(
      () => window.__studioHokusaiNaturalMediaQualityResult,
    );
    invariant(result && typeof result === "object", "no browser quality result");
    writeJson("quality-metrics.json", result);
    writeJson("browser-diagnostics.json", diagnostics);
    if (result.status !== "ok") {
      throw new Error(
        `browser quality harness failed: ${result.message ?? result.status}`,
      );
    }

    await page.screenshot({
      path: join(EVIDENCE_ROOT, "before-after-full.png"),
      fullPage: true,
    });
    await page.locator("#before").screenshot({
      path: join(EVIDENCE_ROOT, "before-identical-input.png"),
    });
    await page.locator("#after").screenshot({
      path: join(EVIDENCE_ROOT, "after-identical-input.png"),
    });
    await page.locator("#start-caps").screenshot({
      path: join(EVIDENCE_ROOT, "start-carrier-before-after.png"),
    });
    await page.locator("#pressure").screenshot({
      path: join(EVIDENCE_ROOT, "after-pressure-comparison.png"),
    });

    const failures = validate(result, diagnostics);
    const summary = {
      status: failures.length === 0 ? "ok" : "failed",
      backend: result.backend ?? null,
      firstLoadMilliseconds: result.firstLoadMilliseconds ?? null,
      maximumMainThreadDelayMilliseconds:
        result.maximumMainThreadDelayMilliseconds ?? null,
      failures,
      evidenceDirectory: EVIDENCE_ROOT,
    };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await viteServer.close();
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
