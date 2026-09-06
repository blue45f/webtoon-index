/**
 * Real Chromium WebGPU verifier for professional bristle lowering.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-professional-bristle-webgpu.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_BRISTLE_WEBGPU_VERIFY_DIR=/tmp/bristle-webgpu \
 *     pnpm exec node scripts/verify-studio-professional-bristle-webgpu.mjs
 *
 * Exit codes: 0 = observed/passed, 1 = regression, 2 = structured environment skip.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_BRISTLE_WEBGPU_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-professional-bristle-webgpu-${Date.now()}`);
const HARNESS_PATH = "/__studio_professional_bristle_webgpu__";
const HARNESS_ENTRY = "/scripts/studio-professional-bristle-webgpu-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const EXPECTED_CASE_IDS = [
  "straight-rake",
  "curved-turn",
  "pressure-tilt-fan",
  "fixed-feature-scale",
  "affine-reflection-shear-oklch",
  "contact-angle",
  "destination-out",
];
const EXPECTED_UNSUPPORTED = [
  "display-p3",
  "non-normal-blend",
  "texture-tip",
  "grain",
  "wet-media",
  "unsupported-tip-shape",
];
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
        reject(new Error("could not allocate a bristle verifier port"));
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
  writeFileSync(
    join(SCRATCH, fileName),
    Buffer.from(dataUrl.slice(comma + 1), "base64"),
  );
}

function persistVisualEvidence(result) {
  for (const evidence of result.cases) {
    writeDataUrlPng(`${evidence.id}.cpu.png`, evidence.cpuPng);
    writeDataUrlPng(`${evidence.id}.webgpu.png`, evidence.webgpuPng);
    writeDataUrlPng(`${evidence.id}.diff.png`, evidence.diffPng);
  }
  writeDataUrlPng("append-vs-rebuild.diff.png", result.appendRebuild.diffPng);
}

function stripPngPayloads(result) {
  return {
    ...result,
    cases: result.cases.map((evidence) => {
      const copy = { ...evidence };
      delete copy.cpuPng;
      delete copy.webgpuPng;
      delete copy.diffPng;
      return copy;
    }),
    appendRebuild: {
      ...result.appendRebuild,
      diffPng: "append-vs-rebuild.diff.png",
    },
  };
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "professional-bristle-rgba16float-webgpu") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.provider?.kind !== "real-chromium-webgpu-device-boundary"
    || result.provider?.textureFormat !== "rgba16float"
    || result.provider?.readback !== "aligned-rgba16float-map-read"
    || result.provider?.bytesPerRow !== 1_024
    || result.provider?.bytesPerRow % 256 !== 0
    || result.provider?.maxTextureDimension2D < 128
  ) {
    failures.push("provider was not a real aligned RGBA16F WebGPU boundary");
  }
  if (
    JSON.stringify(result.cases.map((evidence) => evidence.id))
      !== JSON.stringify(EXPECTED_CASE_IDS)
  ) {
    failures.push("bristle parity case order or coverage drifted");
  }

  for (const evidence of result.cases) {
    if (evidence.dabCount <= 0 || evidence.runtimeReceipts.length <= 0) {
      failures.push(`${evidence.id}: no bristle depositions reached the GPU`);
    }
    for (const receipt of evidence.loweringReceipts) {
      if (
        receipt.kind !== "studio-professional-bristle-webgpu-capability-receipt"
        || receipt.version !== 1
        || receipt.loweringVersion !== 1
        || receipt.dynamicsVersion !== 1
        || receipt.extensionVersion !== 1
        || receipt.providerCapability !== "rgba16float-analytic-bristle-v1"
        || receipt.textureFormat !== "rgba16float"
        || receipt.surfaceColorModel !== "linear-premultiplied"
        || receipt.inputColorEncoding !== "scene-linear-straight"
        || receipt.workingColorSpace !== "linear-srgb"
        || receipt.colorVariation !== "oklch-gamut-safe-v1"
        || receipt.tipMapping !== "canonical-round-ellipse-v1"
        || receipt.ordering !== "station-major-bristle-index-v1"
        || !receipt.planFingerprint.startsWith("bristle-wgpu-v1-")
        || !receipt.contentFingerprint.startsWith("bristle-wgpu-v1-")
        || receipt.complete !== true
      ) failures.push(`${evidence.id}: lowering capability receipt drifted`);
    }
    for (const receipt of evidence.runtimeReceipts) {
      if (
        receipt.revision !== 2
        || receipt.backend !== "webgpu"
        || receipt.textureFormat !== "rgba16float"
        || receipt.colorModel !== "linear-premultiplied"
        || receipt.workingColorSpace !== "linear-srgb"
        || receipt.inputColorEncoding !== "scene-linear-straight"
        || receipt.presentationColorSpace !== "srgb"
        || receipt.queueState !== "submitted"
        || receipt.complete !== true
        || receipt.deviceEpoch !== 1
      ) failures.push(`${evidence.id}: runtime provider receipt drifted`);
    }
    if (
      evidence.metrics.comparedComponents !== 128 * 96 * 4
      || evidence.metrics.violatingComponents !== 0
      || evidence.metrics.unaffectedExactHalfWordMismatches !== 0
      || evidence.metrics.outsideEdgeViolatingComponents !== 0
      || evidence.metrics.maxAbsoluteDelta > result.tolerance.cpuAbsolute
    ) {
      failures.push(
        `${evidence.id}: independent affine/half CPU parity failed `
        + `(violations=${evidence.metrics.violatingComponents}, `
        + `outside=${evidence.metrics.outsideEdgeViolatingComponents}, `
        + `unaffected=${evidence.metrics.unaffectedExactHalfWordMismatches}, `
        + `max=${evidence.metrics.maxAbsoluteDelta})`,
      );
    }
    if (
      evidence.samples.some(
        (sample) => sample.maxAbsoluteDelta > result.tolerance.cpuAbsolute,
      )
    ) failures.push(`${evidence.id}: sampled CPU/GPU pixels exceeded tolerance`);
  }

  const destinationOut = result.cases.find(
    (evidence) => evidence.id === "destination-out",
  );
  if (
    !destinationOut
    || JSON.stringify(destinationOut.batchOrder)
      !== JSON.stringify(["source-over", "destination-out"])
    || destinationOut.runtimeReceipts.at(-1)?.mode !== "append"
  ) failures.push("destination-out append order was not preserved");

  if (
    result.appendRebuild.contentFingerprintEqual !== true
    || result.appendRebuild.planFingerprintDifferent !== true
    || result.appendRebuild.exactHalfWordMismatches !== 0
    || result.appendRebuild.appendRuntimeFingerprint
      === result.appendRebuild.rebuildRuntimeFingerprint
  ) failures.push("append/rebuild content or exact RGBA16F determinism failed");

  const features = result.features;
  if (
    features.straightRake.stationCount < 2
    || features.straightRake.depositionCount <= features.straightRake.stationCount
    || features.straightRake.activeBristles.some((count) => count !== 7)
  ) failures.push("straight station-major seven-bristle rake evidence is incomplete");
  if (
    features.curvedTurn.headingCount < 3
    || features.curvedTurn.maximumLongitudinalDisplacement <= 0.01
  ) failures.push("curved heading/turn displacement evidence is incomplete");
  if (
    features.contactAngle.partialDepositions
      >= features.contactAngle.fullDepositions
    || features.contactAngle.partialDepositions <= 0
  ) failures.push("contact-angle active bristle reduction was not observed");
  if (
    features.pressureTiltFan.expressiveSpread
      <= features.pressureTiltFan.neutralSpread
    || features.pressureTiltFan.expressiveMaximumRadius
      <= features.pressureTiltFan.neutralMaximumRadius
  ) failures.push("pressure/tilt fanning did not expand spread and radius");
  if (
    features.fixedFeatureScaling.maximumDiameterDelta > 1e-9
    || features.fixedFeatureScaling.firstStationDiameters.length === 0
    || JSON.stringify(features.fixedFeatureScaling.firstStationDiameters)
      !== JSON.stringify(features.fixedFeatureScaling.lastStationDiameters)
  ) failures.push("fixed feature scaling changed with pressure");
  if (
    features.affineReflectionShearScatter.negativeDeterminants <= 0
    || features.affineReflectionShearScatter.maximumInverseBasisScatterDelta > 1e-4
    || features.affineReflectionShearScatter.maximumNormalizedScatterRadius > 1.4001
  ) failures.push("local-disk affine scatter collapsed or lost reflection/shear");
  if (
    features.oklchVariation.distinctColors < 4
    || features.oklchVariation.allGamutSafe !== true
  ) failures.push("gamut-safe per-bristle OKLCH variation is incomplete");

  if (
    result.preflight.hostileCanonical.status !== "rejected"
    || result.preflight.hostileCanonical.reason !== "invalid-canonical-plan"
    || result.preflight.hostileCanonical.getterReads !== 0
    || result.preflight.hostileExtension.status !== "rejected"
    || result.preflight.hostileExtension.reason !== "invalid-extension"
    || result.preflight.hostileExtension.getterReads !== 0
  ) failures.push("hostile descriptor preflight invoked or accepted an accessor");
  if (
    JSON.stringify(result.preflight.unsupported.map((entry) => entry.id))
      !== JSON.stringify(EXPECTED_UNSUPPORTED)
    || result.preflight.unsupported.some(
      (entry) => entry.status !== "unsupported" || entry.reason !== entry.id,
    )
  ) failures.push("unsupported specialist paths did not fail closed");
  if (
    result.preflight.preAborted.status !== "cancelled"
    || result.preflight.preAborted.phase !== "resolve"
    || result.preflight.preAborted.processedStations !== 0
    || result.preflight.preAborted.emittedDabs !== 0
  ) failures.push("pre-aborted lowering did not cancel before work");

  if (
    result.flow.appendWithoutBase !== "append-without-base"
    || result.flow.invalidSequence !== "invalid-request-sequence"
    || result.flow.staleSequence !== "stale-request-sequence"
    || result.flow.resizeEpochMismatch !== "resize-epoch-mismatch"
    || result.flow.staleResizeEpoch !== "stale-resize-epoch"
    || result.flow.backpressure !== "gpu-backpressure"
    || result.flow.completedAfterGate !== 1
  ) failures.push("sequence/epoch/backpressure flow-control evidence drifted");

  if (
    result.shaders.moduleCount < 2
    || result.shaders.messages.length !== 0
    || result.errorScopes.validation !== null
    || result.errorScopes.outOfMemory !== null
    || result.uncapturedGpuErrors.length !== 0
  ) failures.push("WGSL compilation or GPU error diagnostics were not clean");
  if (
    result.deviceLoss.trigger !== "GPUDevice.destroy"
    || result.deviceLoss.deviceReason !== "destroyed"
    || result.deviceLoss.callbackReason !== "destroyed"
    || result.deviceLoss.runtimeStatus !== "device-lost"
    || result.deviceLoss.runtimeDeviceEpoch !== 2
    || result.deviceLoss.rejectedAfterLoss !== "device-lost"
  ) failures.push("actual GPUDevice destroy did not invalidate runtime epoch");

  if (
    diagnostics.consoleErrors.length !== 0
    || diagnostics.consoleWarnings.length !== 0
    || diagnostics.pageErrors.length !== 0
    || diagnostics.requestFailures.length !== 0
  ) failures.push("browser console/page/request diagnostics were not zero");
  if (
    !diagnostics.contentSecurityPolicy.includes("default-src 'none'")
    || !diagnostics.contentSecurityPolicy.includes("script-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("object-src 'none'")
  ) failures.push("synthetic browser harness was not isolated by CSP");

  if (failures.length > 0) {
    throw new Error(`professional bristle WebGPU verification failed:\n- ${failures.join("\n- ")}`);
  }
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}/`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    appType: "custom",
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
    plugins: [{
      name: "studio-professional-bristle-webgpu-harness",
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
            + "<title>Professional Bristle WebGPU</title></head>"
            + "<body><main>Running real Chromium bristle verification…</main>"
            + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
          );
        });
      },
    }],
  });
  await viteServer.listen();

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

    const navigation = await page.goto(
      `${origin}${HARNESS_PATH.slice(1)}`,
      { waitUntil: "load", timeout: 30_000 },
    );
    diagnostics.contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    await page.waitForFunction(
      () => window.__studioProfessionalBristleWebGpuResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioProfessionalBristleWebGpuResult,
    );
    await context.close();

    invariant(result && typeof result === "object", "browser returned no result");
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
      `browser harness failed: ${
        result.status === "error" ? result.stack ?? result.message : "unknown"
      }`,
    );

    persistVisualEvidence(result);
    const stripped = stripPngPayloads(result);
    writeJson("browser-result.json", stripped);
    const observations = {
      ...stripped,
      status: "observed-unvalidated",
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("observations.json", observations);
    validateSuccess(result, diagnostics);
    const validated = {
      ...observations,
      status: "observed",
      gates: {
        realChromiumWebGpu: true,
        rgba16floatAlignedMapRead: true,
        independentAffineEllipseHalfFloatOracle: true,
        straightAndCurvedRake: true,
        contactAngleAndPressureTiltFan: true,
        turnDisplacementAndFixedFeatureScaling: true,
        nonUniformShearReflection: true,
        localDiskAffineScatter: true,
        gamutSafeOklchVariation: true,
        sourceOverAndDestinationOut: true,
        appendRebuildExactHalfWords: true,
        capabilityAndRuntimeFingerprints: true,
        hostileAndUnsupportedFailClosed: true,
        cancellationSequenceEpochBackpressure: true,
        actualDeviceDestroy: true,
        zeroShaderMessages: true,
        zeroGpuErrors: true,
        zeroBrowserDiagnostics: true,
        contentSecurityPolicy: true,
      },
    };
    writeJson("observations.json", validated);
    const summary = { ...validated, status: "ok" };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      artifactDirectory: SCRATCH,
    };
    writeJson("summary.json", failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await viteServer.close();
  }
}

await main();
