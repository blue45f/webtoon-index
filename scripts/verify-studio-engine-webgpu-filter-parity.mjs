/**
 * Real Chromium WebGPU RGBA16F golden/parity verifier for the canonical filter runtime.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-engine-webgpu-filter-parity.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_ENGINE_WEBGPU_FILTER_PARITY_VERIFY_DIR=/tmp/filter-parity \
 *     pnpm exec node scripts/verify-studio-engine-webgpu-filter-parity.mjs
 *
 * Exit codes:
 *   0 = real WebGPU execution, half-float parity and lifecycle gates passed
 *   1 = runtime, shader, receipt, parity or browser diagnostic failure
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
  process.env.TOONSPECTRUM_ENGINE_WEBGPU_FILTER_PARITY_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-engine-webgpu-filter-parity-${Date.now()}`);
const HARNESS_PATH = "/__studio_engine_webgpu_filter_parity__";
const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-filter-parity-browser.ts";
const RESULT_TIMEOUT_MS = 60_000;

const EXPECTED_CASE_IDS = [
  "identity",
  "gaussian-reflect-small-tiles",
  "gaussian-clamp-radius-larger-than-tile",
  "gaussian-transparent-no-dark-fringe",
  "unsharp-mask",
  "exposure-contrast-levels",
  "monotone-curves",
  "color-matrix-channel-mixer",
  "posterize-threshold",
  "morphology-min",
  "morphology-max",
  "order-exposure-then-posterize",
  "order-posterize-then-exposure",
];

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
        reject(new Error("could not allocate a browser-harness port"));
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

function stripCasePayload(parityCase) {
  const summary = { ...parityCase };
  delete summary.cpuPng;
  delete summary.webgpuPng;
  delete summary.diffPng;
  delete summary.cpuPixels;
  delete summary.gpuPixels;
  return summary;
}

function persistSuccessEvidence(result, diagnostics) {
  for (const parityCase of result.cases) {
    writeDataUrlPng(`${parityCase.id}.cpu.png`, parityCase.cpuPng);
    writeDataUrlPng(`${parityCase.id}.webgpu.png`, parityCase.webgpuPng);
    writeDataUrlPng(`${parityCase.id}.diff.png`, parityCase.diffPng);
  }
  const observations = {
    status: "observed",
    backend: result.backend,
    width: result.width,
    height: result.height,
    capabilities: result.capabilities,
    provider: result.provider,
    tolerance: result.tolerance,
    gates: {
      zeroComponentsOutsideDeclaredHalfFloatTolerance: true,
      identityExactHalfWords: true,
      morphologyExactHalfWords: true,
      transparentEdgeMaxStraightRgbDelta: 0.02,
      orderDifferenceMinimumMaxDelta: 0.02,
      realDeviceDestroyRequired: true,
      zeroUncapturedGpuErrors: true,
      zeroErrorScopeFailures: true,
    },
    shaderCompilation: result.shaderCompilation,
    cases: result.cases.map(stripCasePayload),
    orderDifference: result.orderDifference,
    deviceLoss: result.deviceLoss,
    uncapturedGpuErrors: result.uncapturedGpuErrors,
    diagnostics,
    artifactDirectory: SCRATCH,
  };
  writeJson("observations.json", observations);
  return observations;
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  invariant(result.backend === "webgpu", `expected WebGPU backend, got ${result.backend}`);
  invariant(
    result.provider?.kind === "real-chromium-webgpu-rgba16float",
    "provider was not a real Chromium WebGPU RGBA16F device",
  );
  invariant(result.provider?.textureFormat === "rgba16float", "provider format drifted");
  invariant(
    result.provider?.sourceEncoding === "scene-linear-premultiplied-f16",
    "source was not uploaded as scene-linear premultiplied half-float",
  );
  invariant(
    result.provider?.readback === "aligned-copy-buffer-map-read",
    "readback did not use an aligned MAP_READ copy buffer",
  );
  invariant(
    JSON.stringify(result.cases.map(({ id }) => id)) === JSON.stringify(EXPECTED_CASE_IDS),
    "filter golden case order or coverage drifted",
  );

  const failures = [];
  for (const compilation of result.shaderCompilation) {
    for (const message of compilation.messages) {
      if (message.type === "error") {
        failures.push(`${compilation.kernel}: WGSL compilation error: ${message.message}`);
      }
    }
  }
  for (const parityCase of result.cases) {
    const { receipt, metrics, plan } = parityCase;
    if (
      receipt.kind !== "studio-engine-webgpu-filter-receipt"
      || receipt.version !== 1
      || receipt.backend !== "webgpu"
      || receipt.textureFormat !== "rgba16float"
      || receipt.storageAlphaMode !== "premultiplied"
      || receipt.filterMathAlphaMode !== "straight"
      || receipt.queueState !== "completed"
      || receipt.complete !== true
      || receipt.width !== result.width
      || receipt.height !== result.height
      || receipt.stageCount !== plan.stageCount
      || receipt.dispatchCount !== plan.dispatchCount
    ) {
      failures.push(`${parityCase.id}: incomplete or inconsistent WebGPU receipt`);
    }
    if (metrics.violatingComponents !== 0) {
      failures.push(
        `${parityCase.id}: ${metrics.violatingComponents} components exceeded the explicit `
        + `half-float tolerance (max ratio ${metrics.maxToleranceRatio})`,
      );
    }
    if (parityCase.validationError || parityCase.outOfMemoryError) {
      failures.push(
        `${parityCase.id}: GPU error scope failure: `
        + `${parityCase.validationError ?? parityCase.outOfMemoryError}`,
      );
    }
  }

  const identity = result.cases.find(({ id }) => id === "identity");
  if (!identity || identity.metrics.exactHalfWordMismatches !== 0) {
    failures.push(
      `identity: expected exact half words, got `
      + `${identity?.metrics.exactHalfWordMismatches ?? "missing case"}`,
    );
  }
  for (const id of ["morphology-min", "morphology-max"]) {
    const parityCase = result.cases.find((candidate) => candidate.id === id);
    if (!parityCase || parityCase.metrics.exactHalfWordMismatches !== 0) {
      failures.push(
        `${id}: expected exact selected half words, got `
        + `${parityCase?.metrics.exactHalfWordMismatches ?? "missing case"}`,
      );
    }
  }

  const transparent = result.cases.find(
    ({ id }) => id === "gaussian-transparent-no-dark-fringe",
  );
  if (
    !transparent?.transparentEdge
    || transparent.transparentEdge.sampledPixels === 0
    || transparent.transparentEdge.cpuMaxStraightRgbDelta > 0.02
    || transparent.transparentEdge.gpuMaxStraightRgbDelta > 0.02
  ) {
    failures.push(
      "transparent Gaussian edge did not preserve straight colour without a dark fringe",
    );
  }
  if (
    result.orderDifference.gpuChangedPixels === 0
    || result.orderDifference.cpuChangedPixels === 0
    || result.orderDifference.gpuMaxAbsoluteDelta <= 0.02
    || result.orderDifference.cpuMaxAbsoluteDelta <= 0.02
  ) {
    failures.push("filter ordering did not produce a material CPU and GPU difference");
  }
  if (
    result.deviceLoss.trigger !== "GPUDevice.destroy"
    || result.deviceLoss.runtimeStatus !== "device-lost"
    || result.deviceLoss.runtimeDeviceEpoch !== 8
    || result.deviceLoss.rejectedExecutionReason !== "device-lost"
  ) {
    failures.push("real GPUDevice.destroy lifecycle evidence was incomplete");
  }
  if (result.uncapturedGpuErrors.length > 0) {
    failures.push(`uncaptured GPU errors: ${result.uncapturedGpuErrors.join("; ")}`);
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
  invariant(failures.length === 0, `WebGPU filter parity gate failed:\n  ${failures.join("\n  ")}`);
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}/`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    configFile: WEB_VITE_CONFIG,
    logLevel: "warn",
    server: { port, strictPort: true, host: "127.0.0.1" },
    appType: "custom",
  });
  viteServer.middlewares.use((request, response, next) => {
    if (request.url !== HARNESS_PATH) {
      next();
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      "<!doctype html><html><head><meta charset=\"utf-8\">"
      + "<title>Studio Engine WebGPU Filter Parity</title></head>"
      + "<body><main>Running real Chromium RGBA16F filter parity…</main>"
      + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
    );
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
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    };
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      diagnostics.requestFailures.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
      );
    });

    await page.goto(`${origin}${HARNESS_PATH.slice(1)}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => window.__studioEngineWebGpuFilterParityResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineWebGpuFilterParityResult,
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
      `browser harness failed: ${result.status === "error" ? result.message : "unknown"}`,
    );

    const observations = persistSuccessEvidence(result, diagnostics);
    validateSuccess(result, diagnostics);
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
