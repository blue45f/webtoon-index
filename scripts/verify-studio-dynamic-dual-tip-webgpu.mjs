/**
 * Actual Chromium SwiftShader verifier for dynamic dual-tip RGBA16F rendering.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-dynamic-dual-tip-webgpu.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_DYNAMIC_DUAL_TIP_VERIFY_DIR=/tmp/dynamic-dual-tip \
 *     pnpm exec node scripts/verify-studio-dynamic-dual-tip-webgpu.mjs
 *
 * Exit codes: 0 = observed/passed, 1 = regression, 2 = structured environment skip.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT, WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_DYNAMIC_DUAL_TIP_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-dynamic-dual-tip-${Date.now()}`);
const HARNESS_PATH = "/__studio_dynamic_dual_tip_webgpu__";
const HARNESS_ENTRY = "/scripts/studio-dynamic-dual-tip-webgpu-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const FAMILY_IDS = [
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
];
const EXPECTED_CASE_IDS = [
  ...FAMILY_IDS.map((family) => `family-${family}`),
  "append-sequence",
  "destination-out",
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
        reject(new Error("could not allocate a dynamic dual-tip verifier port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(name, value) {
  writeFileSync(join(SCRATCH, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeDataUrlPng(name, value) {
  invariant(
    typeof value === "string" && value.startsWith("data:image/png;base64,"),
    `${name} was not a PNG data URL`,
  );
  writeFileSync(
    join(SCRATCH, name),
    Buffer.from(value.slice(value.indexOf(",") + 1), "base64"),
  );
}

function persistEvidence(result) {
  for (const evidence of result.cases) {
    writeDataUrlPng(`${evidence.id}.cpu.png`, evidence.cpuPng);
    writeDataUrlPng(`${evidence.id}.webgpu.png`, evidence.webgpuPng);
    writeDataUrlPng(`${evidence.id}.diff.png`, evidence.diffPng);
  }
}

function stripPngs(result) {
  return {
    ...result,
    cases: result.cases.map((evidence) => {
      const copy = { ...evidence };
      delete copy.cpuPng;
      delete copy.webgpuPng;
      delete copy.diffPng;
      return copy;
    }),
  };
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "dynamic-dual-tip-rgba16float-webgpu") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.provider?.kind !== "real-chromium-webgpu-device-boundary"
    || result.provider?.textureFormat !== "rgba16float"
    || result.provider?.readback !== "aligned-rgba16float-map-read"
    || result.provider?.bytesPerRow !== 512
    || result.provider?.bytesPerRow % 256 !== 0
  ) failures.push("provider was not an aligned real Chromium RGBA16F boundary");
  if (
    JSON.stringify(result.cases.map((evidence) => evidence.id))
    !== JSON.stringify(EXPECTED_CASE_IDS)
  ) failures.push("dynamic dual-tip case coverage/order drifted");

  for (const evidence of result.cases) {
    if (
      evidence.primaryDabs <= 0
      || evidence.secondaryStations <= 0
      || evidence.secondaryInstances <= evidence.secondaryStations
      || evidence.reflectedAffineInstances !== evidence.secondaryInstances
    ) failures.push(`${evidence.id}: independent count/scatter/reflected affine evidence missing`);
    if (
      evidence.receipts.length <= 0
      || evidence.receipts.some(
        (receipt) =>
          receipt.backend !== "webgpu"
          || receipt.providerCapability
            !== "dynamic-dual-tip-r8-aggregate-preview-v1"
          || receipt.textureFormat !== "rgba16float"
          || receipt.colorModel !== "scene-linear-premultiplied"
          || receipt.maskCombination
            !== "independent-primary-secondary-aggregate-preview-v1"
          || receipt.fidelity !== "aggregate-mask-preview-only"
          || receipt.exactExecutionRoute !== "webgpu-exact-packed-deposition-v2"
          || receipt.queueState !== "completed"
          || receipt.complete !== false
          || receipt.deviceEpoch !== 1,
      )
    ) failures.push(`${evidence.id}: specialist runtime receipt evidence invalid`);
    if (
      evidence.metrics.comparedComponents !== 64 * 48 * 4
      || evidence.metrics.outsideEdgeViolatingComponents !== 0
      || evidence.metrics.edgeBandPixels <= 0
      || evidence.metrics.unaffectedExactHalfWordMismatches !== 0
      || evidence.metrics.outsideEdgeMaxAbsoluteDelta > result.tolerance.cpuAbsolute
      || evidence.samples.some(
        (sample) => sample.maxAbsoluteDelta > result.tolerance.cpuAbsolute,
      )
    ) {
      failures.push(
        `${evidence.id}: independent CPU parity failed `
        + `(violations=${evidence.metrics.violatingComponents}, `
        + `outside=${evidence.metrics.outsideEdgeViolatingComponents}, `
        + `unaffected=${evidence.metrics.unaffectedExactHalfWordMismatches}, `
        + `outsideMax=${evidence.metrics.outsideEdgeMaxAbsoluteDelta})`,
      );
    }
  }

  for (let index = 0; index < FAMILY_IDS.length; index += 1) {
    const family = FAMILY_IDS[index];
    const evidence = result.cases[index];
    if (
      evidence?.blendFamilies?.length !== 1
      || evidence.blendFamilies[0] !== family
      || evidence.receipts[0]?.blendFamily !== family
    ) failures.push(`${family}: blend-family shader/receipt route was not preserved`);
  }
  if (
    Math.abs(
      result.familyCenterAlpha.intersect - result.familyCenterAlpha.multiply,
    ) > 0.000_001
  ) failures.push("intersect/multiply mathematical equivalence drifted");
  const distinctCenterAlphas = new Set(
    Object.values(result.familyCenterAlpha).map((value) => value.toFixed(5)),
  );
  if (distinctCenterAlphas.size < 4) {
    failures.push("8-family coverage did not produce sufficiently distinct observed masks");
  }

  if (
    JSON.stringify(result.append?.receiptModes) !== JSON.stringify(["rebuild", "append"])
    || result.append?.outsideEdgeCpuParityViolations !== 0
  ) failures.push("append sequence did not preserve/load the existing authority");
  if (
    result.destinationOut?.outsideEdgeCpuParityViolations !== 0
    || result.destinationOut?.baseCenterAlpha <= 0
    || result.destinationOut?.erasedCenterAlpha <= 0
    || result.destinationOut?.erasedCenterAlpha
      >= result.destinationOut?.baseCenterAlpha
  ) failures.push("destination-out did not destructively composite the combined dual mask");

  if (
    result.assetBoundary?.firstTextureCreations !== 2
    || result.assetBoundary?.cachedTextureCreations !== 0
    || result.assetBoundary?.mutatedHashStatus !== "rejected"
    || result.assetBoundary?.mutatedHashReason !== "invalid-frame"
    || result.assetBoundary?.budgetStatus !== "rejected"
    || result.assetBoundary?.budgetReason !== "resident-asset-budget"
  ) failures.push("content-addressed asset cache/hash/budget fail-close evidence incomplete");
  if (
    result.flow?.cancelledStatus !== "cancelled"
    || result.flow?.cancelledSequenceReusable !== true
    || result.flow?.busyStatus !== "busy"
    || result.flow?.busyInFlight !== 1
    || result.flow?.busySequenceReusable !== true
  ) failures.push("cancellation/backpressure did not preserve reusable sequences");

  if (
    !Array.isArray(result.shaders)
    || result.shaders.length < 3
    || result.shaders.some(
      (shader) => shader.available !== true || shader.messages.length !== 0,
    )
  ) failures.push("actual WGSL compilation info was unavailable or non-empty");
  if (result.errorScopes?.validation !== null) {
    failures.push(`WebGPU validation error: ${result.errorScopes.validation}`);
  }
  if (result.errorScopes?.outOfMemory !== null) {
    failures.push(`WebGPU out-of-memory error: ${result.errorScopes.outOfMemory}`);
  }
  if (result.uncapturedGpuErrors?.length > 0) {
    failures.push(`uncaptured GPU errors: ${result.uncapturedGpuErrors.join("; ")}`);
  }
  if (
    result.deviceLoss?.trigger !== "GPUDevice.destroy"
    || result.deviceLoss?.runtimeEpoch !== 2
    || result.deviceLoss?.rejectedStatus !== "device-lost"
    || result.deviceLoss?.rejectedEpoch !== 2
    || result.deviceLoss?.callbackReason !== result.deviceLoss?.reason
  ) failures.push("actual GPUDevice loss did not advance the epoch and fail closed");

  if (!diagnostics.contentSecurityPolicy.includes("script-src 'self'")) {
    failures.push("verifier page did not enforce CSP");
  }
  if (diagnostics.consoleErrors.length > 0) {
    failures.push(`console errors: ${diagnostics.consoleErrors.join("; ")}`);
  }
  if (diagnostics.consoleWarnings.length > 0) {
    failures.push(`console warnings: ${diagnostics.consoleWarnings.join("; ")}`);
  }
  if (diagnostics.pageErrors.length > 0) {
    failures.push(`page errors: ${diagnostics.pageErrors.join("; ")}`);
  }
  if (diagnostics.requestFailures.length > 0) {
    failures.push(`request failures: ${diagnostics.requestFailures.join("; ")}`);
  }
  invariant(
    failures.length === 0,
    `dynamic dual-tip WebGPU gate failed:\n  ${failures.join("\n  ")}`,
  );
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}/`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    configFile: WEB_VITE_CONFIG,
    logLevel: "warn",
    appType: "custom",
    server: { port, strictPort: true, host: "127.0.0.1" },
    plugins: [{
      name: "studio-dynamic-dual-tip-webgpu-harness",
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
            + "<title>Studio Dynamic Dual Tip WebGPU</title></head>"
            + "<body><main>Running dynamic dual-tip WebGPU parity…</main>"
            + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
          );
        });
      },
    }],
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
      () => window.__studioDynamicDualTipWebGpuResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioDynamicDualTipWebGpuResult,
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

    persistEvidence(result);
    const stripped = stripPngs(result);
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
        realChromiumSwiftShaderWebGpu: true,
        actualWgslCompilation: true,
        rgba16floatAlignedMapRead: true,
        independentAffineHalfFloatCpuOracle: true,
        independentPrimarySecondaryMasks: true,
        eightBlendFamilyAggregatePreviewCoverage: true,
        exactPerDepositionComposition: false,
        secondarySpacingCountScatter: true,
        reflectedShearedAffineFootprints: true,
        sourceOverAndDestinationOut: true,
        appendAndRebuild: true,
        contentAddressedAssetCacheAndBudgets: true,
        cancellationAndBackpressure: true,
        actualDeviceLossEpoch: true,
        zeroGpuAndBrowserDiagnostics: true,
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
