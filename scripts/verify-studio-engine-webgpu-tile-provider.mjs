/**
 * Real Chromium WebGPU verifier for StudioEngineWebGpuTileProviderV1.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-engine-webgpu-tile-provider.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_WEBGPU_TILE_PROVIDER_VERIFY_DIR=/tmp/tile-provider \
 *     pnpm exec node scripts/verify-studio-engine-webgpu-tile-provider.mjs
 *
 * Exit codes:
 *   0 = actual RGBA16F tile provider, parity, flow-control and lifecycle gates passed
 *   1 = provider, parity, shader, GPU lifecycle or browser diagnostic failure
 *   2 = structured environment skip because real Chromium WebGPU is unavailable
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT, WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_WEBGPU_TILE_PROVIDER_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-webgpu-tile-provider-${Date.now()}`);
const HARNESS_PATH = "/__studio_engine_webgpu_tile_provider__";
const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-tile-provider-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const EXPECTED_TILE_ORDER = ["0:0", "1:0", "0:1"];
const TILE_SIZE = 512;
const TILE_BYTES = 512 * 512 * 8;
const ROW_BYTES = 512 * 8;
const CSP =
  "default-src 'none'; "
  + "script-src 'self'; "
  + "connect-src 'self'; "
  + "img-src 'self' data:; "
  + "style-src 'none'; "
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
        reject(new Error("could not allocate a WebGPU tile-provider harness port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(join(SCRATCH, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function writeDataUrlPng(fileName, dataUrl) {
  invariant(
    typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,"),
    `${fileName} did not contain a PNG data URL`,
  );
  const comma = dataUrl.indexOf(",");
  writeFileSync(join(SCRATCH, fileName), Buffer.from(dataUrl.slice(comma + 1), "base64"));
}

function stripPngPayloads(result) {
  const main = { ...result.main };
  delete main.cpuPng;
  delete main.appendGpuPng;
  delete main.appendCpuDiffPng;
  delete main.rebuildGpuPng;
  delete main.appendRebuildDiffPng;
  return { ...result, main };
}

function persistVisualEvidence(result) {
  writeDataUrlPng("cpu-oracle.png", result.main.cpuPng);
  writeDataUrlPng("append-webgpu.png", result.main.appendGpuPng);
  writeDataUrlPng("append-vs-cpu-diff.png", result.main.appendCpuDiffPng);
  writeDataUrlPng("rebuild-webgpu.png", result.main.rebuildGpuPng);
  writeDataUrlPng(
    "append-vs-rebuild-diff.png",
    result.main.appendRebuildDiffPng,
  );
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "webgpu-rgba16float-tile-provider-v1") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.provider?.kind !== "real-chromium-webgpu-device-boundary"
    || result.provider?.textureFormat !== "rgba16float"
    || result.provider?.tileSize !== TILE_SIZE
    || result.provider?.readback !== "full-tile-256-byte-aligned-map-read"
    || result.provider?.maxTextureDimension2D < TILE_SIZE
    || result.provider?.maxBufferSize < TILE_BYTES * EXPECTED_TILE_ORDER.length
  ) {
    failures.push("provider was not a sufficient real Chromium RGBA16F WebGPU boundary");
  }

  const main = result.main;
  if (
    main.appendReceipt?.mode !== "append"
    || main.rebuildReceipt?.mode !== "rebuild"
    || main.appendReceipt?.requestEpoch !== 41
    || main.rebuildReceipt?.requestEpoch !== 41
    || main.appendReceipt?.deviceEpoch !== 1
    || main.rebuildReceipt?.deviceEpoch !== 1
    || main.appendReceipt?.requestSequence !== 1
    || main.rebuildReceipt?.requestSequence !== 1
    || main.appendReceipt?.tileCount !== EXPECTED_TILE_ORDER.length
    || main.rebuildReceipt?.tileCount !== EXPECTED_TILE_ORDER.length
    || main.appendReceipt?.textureFormat !== "rgba16float"
    || main.rebuildReceipt?.textureFormat !== "rgba16float"
    || main.appendReceipt?.encoding !== "linear-rgba16float-le-v1"
    || main.rebuildReceipt?.encoding !== "linear-rgba16float-le-v1"
    || main.appendReceipt?.complete !== true
    || main.rebuildReceipt?.complete !== true
  ) {
    failures.push("append/rebuild receipt authority or RGBA16F metadata drifted");
  }
  if (
    JSON.stringify(main.deltaOrder) !== JSON.stringify(EXPECTED_TILE_ORDER)
    || JSON.stringify(main.stagingOffsets)
      !== JSON.stringify([0, TILE_BYTES, TILE_BYTES * 2])
    || main.rowBytes !== ROW_BYTES
    || main.rowBytesAlignment !== 256
    || main.rowBytes % main.rowBytesAlignment !== 0
    || main.rowPaddingBytes !== 0
    || main.tileStride !== TILE_BYTES
    || main.appendReceipt.stagingBytes !== TILE_BYTES * EXPECTED_TILE_ORDER.length
    || main.rebuildReceipt.stagingBytes !== TILE_BYTES * EXPECTED_TILE_ORDER.length
    || main.deltaByteLengths.some((length) => length !== TILE_BYTES)
  ) {
    failures.push("full-tile 256-byte aligned MAP_READ layout/order evidence is invalid");
  }
  if (
    main.appendReceipt.uploadedBaseBytes !== TILE_BYTES * 2
    || main.rebuildReceipt.uploadedBaseBytes !== TILE_BYTES * 2
  ) {
    failures.push("the two encoded RGBA16F authority base tiles were not fully uploaded");
  }
  if (
    main.appendReceipt.dabCount <= 0
    || main.appendReceipt.dispatchCount <= 0
    || main.rebuildReceipt.dabCount !== main.appendReceipt.dabCount
    || main.rebuildReceipt.dispatchCount !== main.appendReceipt.dispatchCount
  ) {
    failures.push("canonical analytic brush replay did not produce stable GPU work");
  }
  if (
    main.stableBatchDigest !== true
    || main.appendBatchDigest !== main.rebuildBatchDigest
    || main.appendBatchDigest !== main.recalculatedAppendBatchDigest
    || JSON.stringify(main.appendContentDigests)
      !== JSON.stringify(main.rebuildContentDigests)
    || main.appendRebuildExactHalfWordMismatches !== 0
  ) {
    failures.push("append/rebuild bytes, tile digests, or batch digest were not exact");
  }
  if (
    !Array.isArray(main.parity)
    || main.parity.length !== EXPECTED_TILE_ORDER.length
  ) {
    failures.push("CPU half-float parity did not cover every target tile");
  } else {
    for (const [index, parity] of main.parity.entries()) {
      if (
        parity.tileId !== EXPECTED_TILE_ORDER[index]
        || parity.comparedComponents !== TILE_SIZE * TILE_SIZE * 4
        || parity.violatingComponents !== 0
        || parity.outsideEdgeViolatingComponents !== 0
        || parity.unaffectedExactHalfWordMismatches !== 0
        || parity.touchedPixels <= 0
        || parity.edgeBandPixels <= 0
        || parity.maxAbsoluteDelta > result.tolerance.absolute
        || parity.maxOutsideEdgeAbsoluteDelta
          > result.tolerance.outsideEdgeAbsolute
      ) {
        failures.push(
          `${parity.tileId}: CPU half-float parity failed `
          + `(max ${parity.maxAbsoluteDelta}, outside-edge `
          + `${parity.maxOutsideEdgeAbsoluteDelta})`,
        );
      }
    }
  }
  if (
    !Array.isArray(main.edgeSamples)
    || main.edgeSamples.length < 4
    || main.edgeSamples.some(
      (sample) => sample.maxAbsoluteDelta > result.tolerance.absolute,
    )
  ) {
    failures.push("tile-edge CPU/GPU samples exceeded the declared half-float tolerance");
  }

  if (
    result.epochs?.staleRequestEpochReason !== "stale-request-epoch"
    || result.epochs?.staleDeviceEpochReason !== "stale-device-epoch"
    || result.epochs?.statsUnchangedBeforeValidExecution !== true
  ) {
    failures.push("request/device epoch failures did not remain fail-closed");
  }
  if (
    result.flowControl?.preAbortedReason !== "aborted"
    || result.flowControl?.preAbortedSubmittedTileDelta !== 0
    || result.flowControl?.inFlightCancelledReason !== "aborted"
    || result.flowControl?.inFlightActiveRequestsBeforeAbort !== 1
    || result.flowControl?.inFlightActiveRequestsAfterAbort !== 0
    || result.flowControl?.backpressureReason !== "gpu-backpressure"
    || result.flowControl?.firstConcurrentStatus !== "completed"
    || result.flowControl?.maxInFlightRequests !== 1
  ) {
    failures.push("pre/in-flight cancel or real GPU backpressure evidence is incomplete");
  }
  if (
    !Array.isArray(result.shaderCompilation)
    || result.shaderCompilation.length < 3
    || result.shaderCompilation.some(
      (module) =>
        module.available !== true
        || module.messages.some((message) => message.type === "error"),
    )
  ) {
    failures.push("tile-provider shader compilation evidence is unavailable or contains errors");
  }
  if (result.errorScopes?.validation !== null) {
    failures.push(`WebGPU validation error scope: ${result.errorScopes.validation}`);
  }
  if (result.errorScopes?.outOfMemory !== null) {
    failures.push(`WebGPU out-of-memory scope: ${result.errorScopes.outOfMemory}`);
  }
  if (result.uncapturedGpuErrors?.length > 0) {
    failures.push(`uncaptured GPU errors: ${result.uncapturedGpuErrors.join("; ")}`);
  }
  if (
    result.deviceLoss?.trigger !== "GPUDevice.destroy"
    || result.deviceLoss?.pendingStatus !== "rejected"
    || result.deviceLoss?.pendingReason !== "device-lost"
    || result.deviceLoss?.providerStatus !== "device-lost"
    || result.deviceLoss?.providerDeviceEpoch !== 2
    || result.deviceLoss?.rejectedAfterLossReason !== "device-lost"
  ) {
    failures.push("real GPUDevice.destroy loss, epoch invalidation, or rejection was incomplete");
  }
  if (!diagnostics.contentSecurityPolicy.includes("script-src 'self'")) {
    failures.push("the synthetic verifier page did not enforce its CSP");
  }
  if (diagnostics.consoleErrors.length > 0) {
    failures.push(`browser console errors: ${diagnostics.consoleErrors.join("; ")}`);
  }
  if (diagnostics.pageErrors.length > 0) {
    failures.push(`browser page errors: ${diagnostics.pageErrors.join("; ")}`);
  }
  if (diagnostics.requestFailures.length > 0) {
    failures.push(`browser request failures: ${diagnostics.requestFailures.join("; ")}`);
  }
  invariant(
    failures.length === 0,
    `WebGPU tile-provider gate failed:\n  ${failures.join("\n  ")}`,
  );
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}/`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    configFile: WEB_VITE_CONFIG,
    logLevel: "warn",
    appType: "custom",
    server: { port, strictPort: true, host: "127.0.0.1" },
    plugins: [
      {
        name: "studio-webgpu-tile-provider-harness",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            response.setHeader("Content-Security-Policy", CSP);
            response.setHeader("X-Content-Type-Options", "nosniff");
            if (request.url !== HARNESS_PATH) {
              next();
              return;
            }
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(
              "<!doctype html><html><head><meta charset=\"utf-8\">"
              + "<title>Studio WebGPU Tile Provider</title></head>"
              + "<body><main>Running real Chromium RGBA16F tile-provider parity…</main>"
              + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
            );
          });
        },
      },
    ],
  });
  await viteServer.listen(port);

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
      contentSecurityPolicy: "",
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
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
      );
    });

    const navigation = await page.goto(`${origin}${HARNESS_PATH.slice(1)}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    diagnostics.contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    await page.waitForFunction(
      () => window.__studioEngineWebGpuTileProviderResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineWebGpuTileProviderResult,
    );
    await context.close();

    invariant(result && typeof result === "object", "browser returned no structured result");
    if (result.status === "unsupported") {
      const summary = {
        status: "skipped",
        skipKind: "environment-unsupported",
        reason: result.reason,
        message: result.message,
        capabilities: result.capabilities,
        diagnostics,
        artifactDirectory: SCRATCH,
      };
      writeJson("summary.json", summary);
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    invariant(
      result.status === "ok",
      `browser harness failed: ${result.status === "error" ? result.stack ?? result.message : "unknown"}`,
    );

    persistVisualEvidence(result);
    const stripped = stripPngPayloads(result);
    const rawObservations = {
      ...stripped,
      status: "observed-unvalidated",
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("browser-result.json", stripped);
    writeJson("observations.json", rawObservations);
    validateSuccess(result, diagnostics);
    const observations = {
      ...rawObservations,
      status: "observed",
      gates: {
        realChromiumWebGpu: true,
        rgba16floatAuthorityBaseUpload: true,
        canonicalAnalyticBrushReplay: true,
        fullTileAlignedMapRead: true,
        threeTileStableOrderAndDigest: true,
        appendRebuildExactHalfWords: true,
        cpuHalfFloatParity: true,
        tileEdgesAndPadding: true,
        requestAndDeviceEpochs: true,
        backpressureAndCancellation: true,
        realDeviceDestroyLoss: true,
        zeroShaderErrors: true,
        zeroErrorScopeFailures: true,
        zeroUncapturedGpuErrors: true,
        zeroConsoleErrors: true,
        zeroPageErrors: true,
        zeroRequestFailures: true,
      },
    };
    writeJson("observations.json", observations);
    const summary = { ...observations, status: "ok" };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await viteServer.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const summary = {
    status: "failed",
    message: error instanceof Error ? error.stack ?? error.message : String(error),
    artifactDirectory: SCRATCH,
  };
  try {
    mkdirSync(SCRATCH, { recursive: true });
    writeJson("failure.json", summary);
  } catch {
    // Preserve the original verifier failure when evidence persistence also fails.
  }
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
});
