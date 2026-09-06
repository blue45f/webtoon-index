/**
 * Real Chromium WebGPU verifier for the textured-brush specialist.
 *
 * Run directly:
 *   pnpm exec node scripts/verify-studio-engine-webgpu-textured-brush.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_WEBGPU_TEXTURED_BRUSH_VERIFY_DIR=/tmp/textured-brush \
 *     pnpm exec node scripts/verify-studio-engine-webgpu-textured-brush.mjs
 *
 * Exit codes:
 *   0 = every real-WebGPU and CPU-oracle gate passed
 *   1 = implementation, parity, browser or diagnostic failure
 *   2 = structured environment skip because WebGPU is unavailable
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT, WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_WEBGPU_TEXTURED_BRUSH_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-webgpu-textured-brush-${Date.now()}`);
const HARNESS_PATH = "/__studio_engine_webgpu_textured_brush__";
const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-textured-brush-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const EXPECTED_CASE_IDS = [
  "zero-border-source-over",
  "procedural-document",
  "procedural-stroke",
  "asset-document",
  "asset-stroke",
  "durable-r8-alpha-canvas",
  "durable-r8-alpha-stroke",
  "durable-r8-luminance-canvas",
  "durable-r8-luminance-stroke",
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
        reject(new Error("could not allocate a textured-brush verifier port"));
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
  writeDataUrlPng(
    "append-vs-rebuild.diff.png",
    result.appendRebuild.diffPng,
  );
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

function centerAlpha(evidence) {
  return evidence.samples.find((sample) => sample.label === "center")?.gpu?.[3] ?? -1;
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "webgpu-textured-brush-rgba16float") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.provider?.kind !== "real-chromium-webgpu-device-boundary"
    || result.provider?.textureFormat !== "rgba16float"
    || result.provider?.readback !== "aligned-rgba16float-map-read"
    || result.provider?.bytesPerRow !== 512
    || result.provider?.bytesPerRow % 256 !== 0
    || result.provider?.maxTextureDimension2D < 64
  ) {
    failures.push("provider was not a sufficient real RGBA16F WebGPU boundary");
  }
  if (
    JSON.stringify(result.cases.map((evidence) => evidence.id))
      !== JSON.stringify(EXPECTED_CASE_IDS)
  ) {
    failures.push("textured-brush parity case order or coverage drifted");
  }
  for (const evidence of result.cases) {
    if (
      evidence.receipts.length === 0
      || evidence.receipts.some(
        (receipt) =>
          receipt.backend !== "webgpu"
          || receipt.textureFormat !== "rgba16float"
          || receipt.colorModel !== "scene-linear-premultiplied"
          || receipt.queueState !== "completed"
          || receipt.complete !== true
          || receipt.deviceEpoch !== 1,
      )
    ) {
      failures.push(`${evidence.id}: completed RGBA16F receipt evidence is invalid`);
    }
    if (
      evidence.metrics.comparedComponents !== 64 * 48 * 4
      || evidence.metrics.violatingComponents !== 0
      || evidence.metrics.unaffectedExactHalfWordMismatches !== 0
      || evidence.metrics.maxAbsoluteDelta > result.tolerance.cpuAbsolute
    ) {
      failures.push(
        `${evidence.id}: independent CPU parity failed `
        + `(violations=${evidence.metrics.violatingComponents}, `
        + `max=${evidence.metrics.maxAbsoluteDelta})`,
      );
    }
    if (
      evidence.samples.some(
        (sample) => sample.maxAbsoluteDelta > result.tolerance.cpuAbsolute,
      )
    ) {
      failures.push(`${evidence.id}: sampled CPU/GPU pixels exceeded tolerance`);
    }
  }

  const zeroBorder = result.cases.find(
    (evidence) => evidence.id === "zero-border-source-over",
  );
  const edge = zeroBorder?.samples.find(
    (sample) => sample.label === "zero-border-edge",
  );
  const outside = zeroBorder?.samples.find(
    (sample) => sample.label === "outside-footprint",
  );
  if (
    !zeroBorder
    || !edge
    || !outside
    || edge.gpu[3] <= 0
    || edge.gpu[3] >= centerAlpha(zeroBorder)
    || outside.gpu.some((value) => value !== 0)
  ) {
    failures.push("R8 tip zero-border bilinear evidence is incomplete");
  }
  if (
    result.uninitializedAppend?.status !== "rejected"
    || result.uninitializedAppend?.reason !== "content-uninitialized"
    || result.uninitializedAppend?.assetTextureCreations !== 0
    || result.uninitializedAppend?.nativeR8TextureCreations !== 0
    || result.uninitializedAppend?.nonZeroHalfWords !== 0
  ) {
    failures.push(
      "an append without canonical base content did not fail closed before GPU mutation",
    );
  }

  const proceduralDocument = result.cases.find(
    (evidence) => evidence.id === "procedural-document",
  );
  const proceduralStroke = result.cases.find(
    (evidence) => evidence.id === "procedural-stroke",
  );
  const assetDocument = result.cases.find(
    (evidence) => evidence.id === "asset-document",
  );
  const assetStroke = result.cases.find(
    (evidence) => evidence.id === "asset-stroke",
  );
  if (
    proceduralDocument?.grainKind !== "procedural-integer-noise"
    || proceduralDocument?.grainSpace !== "document"
    || proceduralDocument?.grainSeed !== 0xffff_ffff
    || proceduralStroke?.grainKind !== "procedural-integer-noise"
    || proceduralStroke?.grainSpace !== "stroke"
    || proceduralStroke?.grainSeed !== 0xffff_ffff
    || result.anchors?.proceduralDocumentVsStrokeHalfWordMismatches <= 0
  ) {
    failures.push("procedural document/stroke grain or u32 0xffffffff seed was not evidenced");
  }
  if (
    assetDocument?.grainKind !== "asset-r8-repeat"
    || assetDocument?.grainSpace !== "document"
    || assetStroke?.grainKind !== "asset-r8-repeat"
    || assetStroke?.grainSpace !== "stroke"
    || result.anchors?.assetDocumentVsStrokeHalfWordMismatches <= 0
  ) {
    failures.push("asset R8 document/stroke grain anchoring was not evidenced");
  }

  const durableCases = result.cases.filter((evidence) => evidence.durableR8 === true);
  const durableById = new Map(durableCases.map((evidence) => [evidence.id, evidence]));
  for (const [id, channel, space] of [
    ["durable-r8-alpha-canvas", "alpha", "document"],
    ["durable-r8-alpha-stroke", "alpha", "stroke"],
    ["durable-r8-luminance-canvas", "luminance", "document"],
    ["durable-r8-luminance-stroke", "luminance", "stroke"],
  ]) {
    const evidence = durableById.get(id);
    const receipt = evidence?.receipts?.[0];
    const repeatLeft = evidence?.samples?.find(
      (sample) => sample.label === "native-repeat-seam-left",
    );
    const repeatRight = evidence?.samples?.find(
      (sample) => sample.label === "native-repeat-seam-right",
    );
    if (
      evidence?.grainKind !== "asset-r8-repeat"
      || evidence?.grainChannel !== channel
      || evidence?.grainSpace !== space
      || evidence?.nativeR8TextureCreations !== 1
      || !Number.isFinite(evidence?.repeatSeamDocumentX)
      || !repeatLeft
      || !repeatRight
      || repeatLeft.x + 1 !== repeatRight.x
      || repeatLeft.maxAbsoluteDelta > result.tolerance.cpuAbsolute
      || repeatRight.maxAbsoluteDelta > result.tolerance.cpuAbsolute
      || receipt?.grainSamplingSemantics !== "durable-r8-cpu-parity-v1"
      || typeof receipt?.nativeR8GrainSourceKey !== "string"
      || receipt.nativeR8GrainSourceKey.length === 0
      || typeof receipt?.planSemanticFingerprint !== "string"
      || receipt.planSemanticFingerprint.length === 0
      || receipt.nativeR8GrainTextureBytes !== 16
      || evidence.metrics.violatingComponents !== 0
      || evidence.metrics.unaffectedExactHalfWordMismatches !== 0
    ) {
      failures.push(
        `${id}: durable native R8 identity/parity evidence is incomplete (repeat seam)`,
      );
    }
  }
  if (
    durableCases.length !== 4
    || result.anchors?.durableAlphaCanvasVsStrokeHalfWordMismatches <= 0
    || result.anchors?.durableLuminanceCanvasVsStrokeHalfWordMismatches <= 0
  ) {
    failures.push("durable alpha/luminance canvas/stroke anchor coverage is incomplete");
  }
  if (
    typeof result.durableR8Identity?.omittedSourceFingerprint !== "string"
    || result.durableR8Identity.omittedSourceFingerprint.length === 0
    || typeof result.durableR8Identity?.boundSourceFingerprint !== "string"
    || result.durableR8Identity.boundSourceFingerprint.length === 0
    || result.durableR8Identity.fingerprintsDiffer !== true
    || result.durableR8Identity.omittedSourceFingerprint
      === result.durableR8Identity.boundSourceFingerprint
  ) {
    failures.push("durable source omission/presence did not alter the renderer semantic fingerprint");
  }

  const erased = result.cases.find((evidence) => evidence.id === "destination-out");
  if (
    !erased
    || JSON.stringify(erased.porterDuffOrder)
      !== JSON.stringify(["source-over", "destination-out"])
    || erased.receipts[0]?.mode !== "rebuild"
    || erased.receipts[1]?.mode !== "append"
    || centerAlpha(erased) <= 0
    || centerAlpha(erased) >= centerAlpha(zeroBorder)
  ) {
    failures.push("destination-out RGBA16F readback did not prove destructive compositing");
  }

  if (
    result.appendRebuild?.appendReceipts?.length !== 2
    || result.appendRebuild?.appendReceipts?.[0]?.mode !== "rebuild"
    || result.appendRebuild?.appendReceipts?.[1]?.mode !== "append"
    || result.appendRebuild?.rebuildReceipt?.mode !== "rebuild"
    || result.appendRebuild?.exactHalfWordMismatches !== 0
  ) {
    failures.push("append and equivalent rebuild were not exact RGBA16F half-word matches");
  }

  const cache = result.cacheBudgetEpochs;
  if (
    cache?.firstExecutionStatus !== "completed"
    || cache?.secondExecutionStatus !== "completed"
    || cache?.firstAssetTextureCreations !== 2
    || cache?.secondAssetTextureCreations !== 0
    || cache?.staleSequenceReason !== "request-sequence"
    || cache?.staleDeviceEpochReason !== "device-epoch"
    || cache?.budgetReason !== "resident-asset-budget"
    || cache?.budgetAssetTextureCreations !== 0
    || cache?.metadataAliasTextureCreations !== 1
    || cache?.metadataAliasViolatingComponents !== 0
    || cache?.metadataAliasMaxAbsoluteDelta > result.tolerance.cpuAbsolute
    || cache?.mutatedHashStatus !== "rejected"
    || cache?.mutatedHashReason !== "invalid-frame"
    || cache?.mutatedHashSubmittedTextures !== 0
  ) {
    failures.push("asset cache/budget/metadata-alias/hash fail-close evidence is incomplete");
  }

  const flow = result.flowControl;
  if (
    flow?.cancelledStatus !== "cancelled"
    || flow?.cancelledSequenceWasReusable !== true
    || flow?.busyStatus !== "busy"
    || flow?.busyInFlight !== 1
    || flow?.firstConcurrentStatus !== "completed"
    || flow?.busySequenceWasReusable !== true
  ) {
    failures.push("preflight cancel or deterministic in-flight backpressure evidence is incomplete");
  }

  if (
    !Array.isArray(result.shaderCompilation)
    || result.shaderCompilation.length < 1
    || result.shaderCompilation.some(
      (module) => module.available !== true || module.messages.length !== 0,
    )
  ) {
    failures.push("actual WGSL compilation info was unavailable or non-empty");
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
    || result.deviceLoss?.completedReceiptEpoch !== 1
    || result.deviceLoss?.runtimeDeviceEpoch !== 2
    || result.deviceLoss?.rejectedStatus !== "device-lost"
    || result.deviceLoss?.rejectedDeviceEpoch !== 2
    || result.deviceLoss?.callbackReason !== result.deviceLoss?.deviceReason
  ) {
    failures.push("actual device destroy did not increment epoch and fail closed");
  }

  if (!diagnostics.contentSecurityPolicy.includes("script-src 'self'")) {
    failures.push("synthetic browser page did not enforce the expected CSP");
  }
  if (diagnostics.consoleErrors.length > 0) {
    failures.push(`browser console errors: ${diagnostics.consoleErrors.join("; ")}`);
  }
  if (diagnostics.consoleWarnings.length > 0) {
    failures.push(`browser console warnings: ${diagnostics.consoleWarnings.join("; ")}`);
  }
  if (diagnostics.pageErrors.length > 0) {
    failures.push(`browser page errors: ${diagnostics.pageErrors.join("; ")}`);
  }
  if (diagnostics.requestFailures.length > 0) {
    failures.push(`browser request failures: ${diagnostics.requestFailures.join("; ")}`);
  }
  invariant(
    failures.length === 0,
    `WebGPU textured-brush gate failed:\n  ${failures.join("\n  ")}`,
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
      name: "studio-webgpu-textured-brush-harness",
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
            + "<title>Studio WebGPU Textured Brush</title></head>"
            + "<body><main>Running real Chromium textured-brush parity…</main>"
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
      () => window.__studioEngineWebGpuTexturedBrushResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineWebGpuTexturedBrushResult,
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
        actualWgslCompilation: true,
        rgba16floatAlignedMapRead: true,
        independentCpuHalfFloatOracle: true,
        zeroBorderBilinearTip: true,
        proceduralDocumentAndStrokeGrain: true,
        assetDocumentAndStrokeGrain: true,
        durableNativeR8AlphaAndLuminance: true,
        durableNativeR8CanvasAndStrokeAnchors: true,
        durableNativeR8RepeatBilinearCpuParity: true,
        durableRendererSemanticFingerprint: true,
        maximumUint32Seed: true,
        sourceOverAndDestinationOut: true,
        uninitializedAppendFailsClosed: true,
        appendRebuildExactHalfWords: true,
        metadataAwareAssetCache: true,
        residentAssetBudget: true,
        mutatedAssetHashFailClosed: true,
        requestAndDeviceEpochs: true,
        cancellationAndBackpressure: true,
        actualDeviceDestroyEpochIncrement: true,
        zeroShaderMessages: true,
        zeroErrorScopeFailures: true,
        zeroUncapturedGpuErrors: true,
        zeroConsoleErrorsAndWarnings: true,
        zeroPageErrors: true,
        zeroRequestFailures: true,
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
