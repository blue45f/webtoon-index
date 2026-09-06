/**
 * Real Chromium WebGPU golden/parity verifier for the rich canonical brush runtime.
 *
 * This intentionally has no package.json alias yet:
 *
 *   pnpm exec node scripts/verify-studio-engine-webgpu-brush-parity.mjs
 *
 * Evidence:
 *
 *   TOONSPECTRUM_ENGINE_WEBGPU_BRUSH_PARITY_VERIFY_DIR=/tmp/my-run \
 *     pnpm exec node scripts/verify-studio-engine-webgpu-brush-parity.mjs
 *
 * Exit codes:
 *   0 = real WebGPU pixels and receipts passed every numeric gate
 *   1 = harness/runtime/parity failure
 *   2 = structured environment skip (real Chromium WebGPU/OffscreenCanvas unavailable)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT, WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_ENGINE_WEBGPU_BRUSH_PARITY_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-engine-webgpu-brush-parity");
const HARNESS_PATH = "/__studio_engine_webgpu_brush_parity__";
const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-brush-parity-browser.ts";
const RESULT_TIMEOUT_MS = 60_000;
const MAX_GOLDEN_SAMPLE_CHANNEL_DELTA = 2;
const MAX_OUTSIDE_EDGE_CHANGED_PIXELS_TOLERANCE_2 = 0;
const MAX_MEAN_PREMULTIPLIED_ABSOLUTE_CHANNEL_DELTA = 0.25;

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

function stripCaseImages(parityCase) {
  const summary = { ...parityCase };
  delete summary.cpuPng;
  delete summary.webgpuPng;
  delete summary.diffPng;
  return summary;
}

function persistSuccessEvidence(result, diagnostics) {
  for (const parityCase of result.cases) {
    writeDataUrlPng(`${parityCase.id}.cpu.png`, parityCase.cpuPng);
    writeDataUrlPng(`${parityCase.id}.webgpu.png`, parityCase.webgpuPng);
    writeDataUrlPng(`${parityCase.id}.diff.png`, parityCase.diffPng);
  }
  writeDataUrlPng("append-vs-rebuild.diff.png", result.appendRebuild.diffPng);
  const summary = {
    status: "observed",
    backend: result.backend,
    width: result.width,
    height: result.height,
    capabilities: result.capabilities,
    provider: result.provider,
    gates: {
      maxGoldenSampleChannelDelta: MAX_GOLDEN_SAMPLE_CHANNEL_DELTA,
      maxOutsideEdgeChangedPixelsTolerance2:
        MAX_OUTSIDE_EDGE_CHANGED_PIXELS_TOLERANCE_2,
      maxMeanPremultipliedAbsoluteChannelDelta:
        MAX_MEAN_PREMULTIPLIED_ABSOLUTE_CHANNEL_DELTA,
      appendVsRebuildExact: true,
      receiptRevision: 2,
      readbackRequiresCompletedSubmission: true,
      productionCasesRequireCanonicalLoweringAdapter: true,
    },
    cases: result.cases.map(stripCaseImages),
    appendRebuild: {
      ...result.appendRebuild,
      diffPng: "append-vs-rebuild.diff.png",
    },
    deviceLoss: result.deviceLoss,
    uncapturedGpuErrors: result.uncapturedGpuErrors,
    diagnostics,
    artifactDirectory: SCRATCH,
  };
  writeJson("observations.json", summary);
  return summary;
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  invariant(result.backend === "webgpu", `expected webgpu backend, got ${result.backend}`);
  invariant(result.provider?.kind === "real-chromium-webgpu-device-boundary", "provider was not real WebGPU");
  invariant(result.provider?.surface === "OffscreenCanvas", "provider did not use OffscreenCanvas");
  invariant(result.width > 0 && result.height > 0, "result dimensions are invalid");
  invariant(result.cases.length === 11, `expected 11 golden cases, got ${result.cases.length}`);

  const expectedIds = [
    "diagnostic-round-normal",
    "diagnostic-translucent-linear-overlap",
    "diagnostic-destination-out-erase",
    "canonical-append-base",
    "canonical-append-result",
    "canonical-rebuild-equivalent",
    "canonical-linear-premultiplied-presentation",
    "canonical-rotated-sheared-ellipse",
    "canonical-square",
    "canonical-hardness-edge-softness",
    "canonical-affine-footprint",
  ];
  invariant(
    JSON.stringify(result.cases.map((parityCase) => parityCase.id))
      === JSON.stringify(expectedIds),
    "golden case order/coverage drifted",
  );

  const failures = [];
  for (const [caseIndex, parityCase] of result.cases.entries()) {
    const { receipt, readback, metrics, samples } = parityCase;
    const expectedPlanSource = caseIndex < 3
      ? "legacy-diagnostic-oracle"
      : "canonical-lowering-adapter";
    if (parityCase.planSource !== expectedPlanSource) {
      failures.push(
        `${parityCase.id}: plan source ${parityCase.planSource} !== ${expectedPlanSource}`,
      );
    }
    if (
      receipt.revision !== 2
      || receipt.backend !== "webgpu"
      || receipt.complete !== true
      || receipt.colorModel !== "linear-premultiplied"
      || receipt.workingColorSpace !== "linear-srgb"
      || receipt.inputColorEncoding !== "scene-linear-straight"
      || receipt.presentationColorSpace !== "srgb"
      || receipt.queueState !== "submitted"
    ) {
      failures.push(`${parityCase.id}: incomplete/non-rich-v2 WebGPU provider receipt`);
    }
    if (
      receipt.requestSequence !== readback.requestSequence
      || receipt.resizeEpoch !== readback.resizeEpoch
      || receipt.width !== readback.width
      || receipt.height !== readback.height
    ) {
      failures.push(`${parityCase.id}: provider receipt/readback epoch mismatch`);
    }
    if (
      readback.completedSubmissionSequence < readback.submittedSubmissionSequence
      || readback.inFlightSubmissions !== 0
      || readback.maxInFlightSubmissions !== 3
    ) {
      failures.push(
        `${parityCase.id}: presentation readback was not protected by the bounded queue fence`,
      );
    }
    if (
      receipt.strokeId !== parityCase.plan.strokeId
      || receipt.loweringVersion !== parityCase.plan.loweringVersion
      || JSON.stringify(receipt.batchOrder)
        !== JSON.stringify(parityCase.plan.porterDuffOrder)
    ) {
      failures.push(`${parityCase.id}: rich receipt/plan provenance mismatch`);
    }
    if (
      metrics.outsideEdgeBandTolerance2.changedPixels
        > MAX_OUTSIDE_EDGE_CHANGED_PIXELS_TOLERANCE_2
    ) {
      failures.push(
        `${parityCase.id}: ${metrics.outsideEdgeBandTolerance2.changedPixels} `
        + "pixels changed by >2 outside the analytic edge band",
      );
    }
    if (
      metrics.exact.meanPremultipliedAbsoluteDelta
        > MAX_MEAN_PREMULTIPLIED_ABSOLUTE_CHANNEL_DELTA
    ) {
      failures.push(
        `${parityCase.id}: mean premultiplied absolute channel delta `
        + `${metrics.exact.meanPremultipliedAbsoluteDelta} > `
        + MAX_MEAN_PREMULTIPLIED_ABSOLUTE_CHANNEL_DELTA,
      );
    }
    for (const sample of samples) {
      if (sample.maxCpuExpectedDelta > 0) {
        failures.push(
          `${parityCase.id}/${sample.label}: CPU oracle missed exact golden by `
          + sample.maxCpuExpectedDelta,
        );
      }
      if (sample.maxGpuExpectedDelta > MAX_GOLDEN_SAMPLE_CHANNEL_DELTA) {
        failures.push(
          `${parityCase.id}/${sample.label}: WebGPU golden sample delta `
          + `${sample.maxGpuExpectedDelta} > ${MAX_GOLDEN_SAMPLE_CHANNEL_DELTA}`,
        );
      }
    }
  }

  const diagnosticErase = result.cases.find(
    (parityCase) => parityCase.id === "diagnostic-destination-out-erase",
  );
  if (
    !diagnosticErase
    || JSON.stringify(diagnosticErase.receipt.batchOrder)
      !== JSON.stringify(["source-over", "destination-out"])
  ) {
    failures.push("diagnostic erase did not preserve Porter-Duff batch order");
  }
  const ellipse = result.cases.find(
    (parityCase) => parityCase.id === "canonical-rotated-sheared-ellipse",
  );
  if (
    !ellipse
    || !ellipse.plan.shapes.every((shape) => shape === "ellipse")
    || !ellipse.plan.bases.every(([xx, xy, yx, yy]) =>
      (Math.abs(xy) > 0.01 || Math.abs(yx) > 0.01) && Math.abs(xx * yy - xy * yx) > 0.01)
  ) {
    failures.push("canonical rotated/sheared ellipse footprint was not evidenced");
  }
  const square = result.cases.find(
    (parityCase) => parityCase.id === "canonical-square",
  );
  if (!square || !square.plan.shapes.every((shape) => shape === "square")) {
    failures.push("canonical square shape was not evidenced");
  }
  const softness = result.cases.find(
    (parityCase) => parityCase.id === "canonical-hardness-edge-softness",
  );
  if (
    !softness
    || !softness.plan.hardness.every((value) => Math.abs(value - 0.45) <= 1e-5)
    || !softness.plan.edgeSoftness.every((value) => Math.abs(value - 0.65) <= 1e-5)
  ) {
    failures.push("canonical hardness/edgeSoftness values were not evidenced");
  }
  const affine = result.cases.find(
    (parityCase) => parityCase.id === "canonical-affine-footprint",
  );
  if (
    !affine
    || !affine.plan.bases.every(([xx, xy, yx, yy]) =>
      (Math.abs(xy) > 0.01 || Math.abs(yx) > 0.01) && Math.abs(xx * yy - xy * yx) > 0.01)
  ) {
    failures.push("canonical affine footprint was not evidenced");
  }

  if (
    result.appendRebuild.exact.changedPixels !== 0
    || result.appendRebuild.exact.maxChannelDelta !== 0
  ) {
    failures.push(
      "append and equivalent rebuild did not produce byte-identical presented pixels "
      + `(changed=${result.appendRebuild.exact.changedPixels}, `
      + `max=${result.appendRebuild.exact.maxChannelDelta})`,
    );
  }
  if (result.deviceLoss.status === "observed") {
    if (
      result.deviceLoss.trigger !== "GPUDevice.destroy"
      || result.deviceLoss.runtimeStatus !== "device-lost"
      || result.deviceLoss.deviceEpoch !== 2
      || result.deviceLoss.rejectedExecutionReason !== "device-lost"
    ) {
      failures.push("actual GPUDevice.destroy loss evidence was incomplete");
    }
  } else {
    failures.push(`real device-loss probe was unavailable: ${result.deviceLoss.reason}`);
  }
  if (result.uncapturedGpuErrors.length > 0) {
    failures.push(`uncaptured WebGPU errors: ${result.uncapturedGpuErrors.join("; ")}`);
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
  invariant(failures.length === 0, `WebGPU brush parity gate failed:\n  ${failures.join("\n  ")}`);
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
      + "<title>Studio Engine WebGPU Brush Parity</title></head>"
      + "<body><main>Running real Chromium WebGPU brush parity…</main>"
      + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
    );
  });
  await viteServer.listen(port);

  let browser = null;
  try {
    const headedWebGpu = process.env.TOONSPECTRUM_WEBGPU_HEADED === "1";
    const launchArgs = process.platform === "darwin"
      ? [
          "--no-sandbox",
          "--enable-unsafe-webgpu",
          "--use-gpu-in-tests",
        ]
      : [
          "--no-sandbox",
          "--enable-unsafe-webgpu",
          "--enable-features=CDPScreenshotNewSurface,Vulkan",
          "--use-vulkan=swiftshader",
          "--use-webgpu-adapter=swiftshader",
          "--use-gpu-in-tests",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ];
    browser = await chromium.launch({
      channel: "chromium",
      // Chromium 151 repeatedly loses Dawn's SwiftShader device on the first queue fence in
      // new-headless Linux. The suite opts into the regular compositor under Xvfb; standalone
      // callers retain headless mode unless they explicitly request the same proof boundary.
      headless: !headedWebGpu,
      args: launchArgs,
    });
    console.log(
      `[webgpu-browser] mode=${headedWebGpu ? "headed" : "headless"} `
        + `adapterPath=${process.platform === "darwin" ? "native" : "forced-swiftshader"} `
        + `version=${browser.version()}`,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = {
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
      () => window.__studioEngineWebGpuBrushParityResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineWebGpuBrushParityResult,
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
    // Preserve the original parity error when evidence persistence itself fails.
  }
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
});
