/**
 * Reproducible real-Chromium verifier for the shared WebGPU presentation surface.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-engine-webgpu-presentation.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_WEBGPU_PRESENTATION_VERIFY_DIR=/tmp/presentation-evidence \
 *     pnpm exec node scripts/verify-studio-engine-webgpu-presentation.mjs
 *
 * Exit codes:
 *   0 = the actual WebGPU presentation contract and diagnostics passed
 *   1 = implementation, browser, GPU diagnostic or contract failure
 *   2 = explicit structured environment skip because WebGPU is unavailable
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const SCRATCH =
  process.env.TOONSPECTRUM_WEBGPU_PRESENTATION_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-webgpu-presentation-${Date.now()}`);
const HARNESS_PATH = "/__studio_engine_webgpu_presentation__";
const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-presentation-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const CSP =
  "default-src 'none'; "
  + "script-src 'self'; "
  + "connect-src 'self'; "
  + "img-src 'self' data: blob:; "
  + "style-src 'none'; "
  + "font-src 'none'; "
  + "object-src 'none'; "
  + "base-uri 'none'; "
  + "frame-ancestors 'none'";
const UNSUPPORTED_REASONS = new Set([
  "adapter-unavailable",
  "context-unavailable",
  "device-request-failed",
  "offscreen-canvas-unavailable",
  "webgpu-unavailable",
]);

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
        reject(new Error("could not allocate a presentation verifier port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(join(SCRATCH, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function validSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "real-chromium-webgpu-presentation") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.capabilities?.webgpu !== true
    || result.capabilities?.offscreenCanvas !== true
    || result.capabilities?.webgpuCanvasContext !== true
  ) {
    failures.push("real WebGPU OffscreenCanvas capability evidence is incomplete");
  }
  if (
    typeof result.adapterInfo?.vendor !== "string"
    || typeof result.adapterInfo?.architecture !== "string"
    || !["bgra8unorm", "rgba8unorm"].includes(result.canvasFormat)
  ) {
    failures.push("adapter or preferred canvas-format evidence is invalid");
  }

  const configuration = result.initial?.configuration;
  if (
    configuration?.physicalWidth !== 160
    || configuration?.physicalHeight !== 96
    || configuration?.dpr !== 2
    || configuration?.presentationEpoch !== 1
    || configuration?.resizeEpoch !== 1
    || configuration?.viewportEpoch !== 1
    || configuration?.flipEpoch !== 1
  ) {
    failures.push("initial DPR/layout epoch contract drifted");
  }
  const renderReceipt = result.initial?.renderReceipt;
  const presentationReceipt = result.initial?.presentationReceipt;
  if (
    result.initial?.missingLeaseReason !== "presentation-lease-required"
    || renderReceipt?.requestSequence !== 1
    || renderReceipt?.renderTarget !== "presentation"
    || renderReceipt?.workSurfaceEpoch !== 1
    || renderReceipt?.complete !== true
    || !validSha256(renderReceipt?.sourceFrameFingerprint)
    || presentationReceipt?.requestSequence !== 1
    || presentationReceipt?.sourceFrameFingerprint
      !== renderReceipt?.sourceFrameFingerprint
    || presentationReceipt?.workSurfaceEpoch !== 1
    || presentationReceipt?.width !== 160
    || presentationReceipt?.height !== 96
    || presentationReceipt?.visible !== true
    || presentationReceipt?.complete !== true
    || result.initial?.visibilityAuthorized !== true
  ) {
    failures.push("render/presentation receipt authority contract drifted");
  }
  const contentAuthority = result.contentAuthority;
  if (
    !Number.isSafeInteger(contentAuthority?.initialGeneration)
    || contentAuthority.initialGeneration <= 0
    || !validSha256(contentAuthority?.initialFingerprint)
    || contentAuthority?.appendBaseGeneration
      !== contentAuthority?.initialGeneration
    || contentAuthority?.appendBaseFingerprint
      !== contentAuthority?.initialFingerprint
    || !Number.isSafeInteger(contentAuthority?.appendGeneration)
    || contentAuthority.appendGeneration
      <= contentAuthority.initialGeneration
    || !validSha256(contentAuthority?.appendFingerprint)
    || contentAuthority.appendFingerprint
      === contentAuthority.initialFingerprint
    || contentAuthority?.chainLinked !== true
  ) {
    failures.push("rebuild/append content-generation chain drifted");
  }

  const linear = result.initial?.linearSurface;
  if (
    linear?.width !== 160
    || linear?.height !== 96
    || linear?.bytesPerRow % 256 !== 0
    || linear?.nonZeroAlphaPixels <= 0
    || linear?.maxAlpha < 0.5
    || !linear?.bounds
  ) {
    failures.push("aligned RGBA16F shared-surface readback is incomplete");
  }
  const canvas = result.initial?.canvas;
  if (
    canvas?.available === true
    && (
      canvas.nonZeroAlphaPixels <= 0
      || canvas.maxRed <= 0
      || canvas.maxAlpha <= 0
      || canvas.reason !== null
    )
  ) {
    failures.push("available browser-canvas readback did not contain visible pixels");
  }
  if (
    canvas?.available !== true
    && typeof canvas?.reason !== "string"
  ) {
    failures.push("optional browser-canvas readback did not explain unavailability");
  }

  const resized = result.resized;
  if (
    resized?.allocation !== "created"
    || resized?.canvasWidth !== 128
    || resized?.canvasHeight !== 80
    || resized?.workSurfaceEpoch !== 2
    || resized?.receiptWidth !== 128
    || resized?.receiptHeight !== 80
    || resized?.flipX !== true
    || resized?.linearSurface?.width !== 128
    || resized?.linearSurface?.height !== 80
    || resized?.linearSurface?.bytesPerRow % 256 !== 0
    || resized?.linearSurface?.nonZeroAlphaPixels <= 0
    || resized?.linearSurface?.maxAlpha < 0.5
  ) {
    failures.push("resize/work-surface epoch/flip evidence drifted");
  }

  if (
    result.staleLease?.runtimeStatus !== "rejected"
    || result.staleLease?.runtimeReason !== "presentation-lease-invalid"
    || result.staleLease?.ownerStatus !== "rejected"
    || result.staleLease?.ownerReason !== "invalid-frame"
    || result.staleLease?.abortStatus !== "aborted"
  ) {
    failures.push("stale or retired presentation lease did not fail closed");
  }
  if (
    result.disposal?.visibilityReason !== "disposed"
    || result.disposal?.surfaceStatus !== "disposed"
    || result.disposal?.configureStatus !== "rejected"
    || result.disposal?.configureReason !== "disposed"
    || result.disposal?.externallyOwnedDeviceUsable !== true
    || result.disposal?.deviceLossReason !== "destroyed"
  ) {
    failures.push("surface/device ownership and disposal contract drifted");
  }

  if (
    !Array.isArray(result.diagnostics?.uncapturedErrors)
    || result.diagnostics.uncapturedErrors.length !== 0
    || result.diagnostics?.validationError !== null
  ) {
    failures.push("browser harness reported WebGPU diagnostics");
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
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const viteServer = await createViteServer({
    appType: "custom",
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
    plugins: [{
      name: "studio-engine-webgpu-presentation-verifier",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== HARNESS_PATH) {
            next();
            return;
          }
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Content-Security-Policy", CSP);
          response.setHeader("Cache-Control", "no-store");
          response.end(
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<title>Studio WebGPU Presentation</title></head>"
            + "<body><main>Running real Chromium WebGPU presentation…</main>"
            + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
          );
        });
      },
    }],
  });
  await viteServer.listen();

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--enable-unsafe-webgpu",
        "--use-angle=swiftshader",
      ],
    });
    const context = await browser.newContext();
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
        `${request.method()} ${request.url()}: `
        + `${request.failure()?.errorText ?? "unknown failure"}`,
      );
    });

    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => window.__studioEngineWebGpuPresentationResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineWebGpuPresentationResult,
    );
    invariant(result && typeof result === "object", "browser returned no structured result");
    writeJson("browser-result.json", result);
    writeJson("observations.json", diagnostics);

    if (result.status === "unsupported") {
      invariant(
        UNSUPPORTED_REASONS.has(result.reason),
        `unknown unsupported reason: ${result.reason}`,
      );
      const summary = {
        status: "unsupported",
        reason: result.reason,
        message: result.message,
        evidenceDirectory: SCRATCH,
      };
      writeJson("summary.json", summary);
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    if (result.status !== "ok") {
      throw new Error(
        `browser presentation harness failed: ${result.message ?? result.status}`,
      );
    }

    const failures = validateSuccess(result, diagnostics);
    const summary = {
      status: failures.length === 0 ? "ok" : "failed",
      backend: result.backend,
      browserVersion: diagnostics.browserVersion,
      adapterInfo: result.adapterInfo,
      canvasFormat: result.canvasFormat,
      initialSurface: {
        width: result.initial.linearSurface.width,
        height: result.initial.linearSurface.height,
        nonZeroAlphaPixels: result.initial.linearSurface.nonZeroAlphaPixels,
        maxAlpha: result.initial.linearSurface.maxAlpha,
      },
      presentedCanvas: result.initial.canvas,
      resizedSurface: {
        width: result.resized.linearSurface.width,
        height: result.resized.linearSurface.height,
        workSurfaceEpoch: result.resized.workSurfaceEpoch,
        flipX: result.resized.flipX,
      },
      staleLease: result.staleLease,
      disposal: result.disposal,
      zeroGpuDiagnostics:
        result.diagnostics.uncapturedErrors.length === 0
        && result.diagnostics.validationError === null,
      zeroBrowserDiagnostics:
        diagnostics.consoleErrors.length === 0
        && diagnostics.consoleWarnings.length === 0
        && diagnostics.pageErrors.length === 0
        && diagnostics.requestFailures.length === 0,
      failures,
      evidenceDirectory: SCRATCH,
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
    evidenceDirectory: SCRATCH,
  };
  mkdirSync(SCRATCH, { recursive: true });
  writeJson("summary.json", failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
