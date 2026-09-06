/**
 * Permanent real-runtime gate for ToonSpectrum's p5.brush standalone adapter.
 *
 * The successful path is the exact product topology:
 * Chromium page -> production Worker client -> one-shot module Dedicated Worker
 * -> production provider -> production adapter -> p5.brush/standalone ->
 * private Worker OffscreenCanvas WebGL2 -> transferred owned RGBA pixels.
 *
 * Exit codes:
 *   0 = all one-shot Worker/WebGL2 render, quality and replay gates passed
 *   1 = harness, product path, adapter, pixel, context or policy regression
 *   2 = structured environment skip because WebGL2 context creation is absent
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_P5_BRUSH_REAL_RUNTIME_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-p5-brush-real-runtime-${Date.now()}`);
const HARNESS_PATH = "/__studio_p5_brush_real_runtime__";
const HARNESS_ENTRY = "/scripts/studio-p5-brush-real-runtime-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const EXPECTED_ADAPTER_VERSION = "2.2.1-adapter.7";
const EXPECTED_CASE_IDS = [
  "flow-field",
  "hatch",
  "mass",
  "watercolor-fill",
  "flat-wash",
];
const EXPECTED_SURFACE_COUNT = 10;
const EXPECTED_RENDER_WORKER_COUNT = 10;
const WIDTH = 160;
const HEIGHT = 128;
const EXPECTED_BYTES = WIDTH * HEIGHT * 4;
const MIN_PAINTED_PIXELS = 8;
const CSP =
  "default-src 'none'; "
  + "script-src 'self'; "
  + "worker-src 'self'; "
  + "child-src 'self'; "
  + "connect-src 'self'; "
  + "img-src 'none'; "
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
        reject(new Error("could not allocate a p5.brush verifier port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(join(SCRATCH, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function validatePixelEvidence(caseId, label, evidence, failures) {
  if (
    evidence?.byteLength !== EXPECTED_BYTES
    || typeof evidence?.pixelHash !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(evidence.pixelHash)
    || evidence.alphaSum <= 0
    || evidence.nonTransparentPixels <= 0
    || evidence.paintedPixels < MIN_PAINTED_PIXELS
    || evidence.paintedBounds === null
  ) {
    failures.push(`${caseId}/${label}: empty or malformed real RGBA readback`);
  }
}

function validateSuccess(result, contextAffinityStress, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "p5.brush/standalone-offscreen-webgl2") {
    failures.push(`unexpected backend: ${String(result.backend)}`);
  }
  if (result.topology !== "production-one-shot-worker-per-render") {
    failures.push(`unexpected execution topology: ${String(result.topology)}`);
  }
  if (result.adapterVersion !== EXPECTED_ADAPTER_VERSION) {
    failures.push(
      `unexpected adapter version: ${String(result.adapterVersion)}`,
    );
  }
  if (
    result.capabilities?.worker !== true
    || result.capabilities?.dedicatedWorkerScope !== true
    || result.capabilities?.workerScopeConstructor !== "DedicatedWorkerGlobalScope"
    || result.capabilities?.offscreenCanvas !== true
    || result.capabilities?.webgl2 !== true
    || result.capabilities?.privateSurface !== true
    || result.capabilities?.mainThreadFallback !== false
    || !String(result.capabilities?.webglVersion).includes("WebGL 2")
  ) {
    failures.push(
      "execution was not a real production Dedicated Worker OffscreenCanvas WebGL2 path",
    );
  }
  if (
    JSON.stringify(result.cases?.map((entry) => entry.id))
      !== JSON.stringify(EXPECTED_CASE_IDS)
  ) {
    failures.push("five-technique real-runtime case coverage drifted");
  }
  if (
    result.probeWorkerCount !== 1
    || result.renderWorkerCount !== EXPECTED_RENDER_WORKER_COUNT
    || result.surfaceCount !== EXPECTED_SURFACE_COUNT
  ) {
    failures.push(
      "the release gate no longer creates one product Worker/surface per render",
    );
  }
  for (const evidence of result.cases ?? []) {
    validatePixelEvidence(evidence.id, "first", evidence.first, failures);
    validatePixelEvidence(evidence.id, "replay", evidence.replay, failures);
    if (
      evidence.width !== WIDTH
      || evidence.height !== HEIGHT
      || evidence.technique !== evidence.id
      || evidence.capability !== `procedural:${evidence.id}`
      || evidence.adapterId !== "p5-brush-standalone-worker"
      || evidence.adapterCompatibility !== "p5.brush/standalone"
    ) {
      failures.push(`${evidence.id}: production adapter/capability receipt drifted`);
    }
    if (
      evidence.execution?.stage !== "settled"
      || evidence.execution?.locality !== "dedicated-worker"
      || evidence.execution?.surface !== "offscreen-canvas-webgl2"
      || evidence.execution?.backend !== "webgl2"
      || evidence.execution?.mainThreadFallback !== false
    ) {
      failures.push(`${evidence.id}: execution receipt allowed a fallback`);
    }
    if (
      evidence.quality?.ok !== true
      || !evidence.quality.metrics
      || evidence.quality.findings?.length !== 0
    ) {
      failures.push(
        `${evidence.id}: golden structural quality policy failed `
        + `${JSON.stringify(evidence.quality?.findings ?? [])}`,
      );
    }
    if (
      evidence.exactPixelReplay !== true
      || evidence.first?.pixelHash !== evidence.replay?.pixelHash
    ) {
      failures.push(
        `${evidence.id}: two production one-shot Workers did not produce identical bytes `
        + `(${String(evidence.first?.pixelHash)} != `
        + `${String(evidence.replay?.pixelHash)})`,
      );
    }
  }
  if (
    contextAffinityStress?.status !== "ok"
    || contextAffinityStress.sameContextExactPixelReplay !== true
    || contextAffinityStress.crossContextRejected !== true
    || !String(contextAffinityStress.crossContextMessage).includes("context-affine")
    || contextAffinityStress.surfaceCount !== 2
    || contextAffinityStress.surfaceDisposeCount !== 2
    || contextAffinityStress.webGlErrorFree !== true
  ) {
    const contextDetail = contextAffinityStress
      ? JSON.stringify(contextAffinityStress)
      : "missing result";
    failures.push(
      `real p5.brush context-affinity stress did not fail closed: ${contextDetail}`,
    );
  }
  if (
    diagnostics.consoleErrors.length > 0
    || diagnostics.pageErrors.length > 0
    || diagnostics.failedRequests.length > 0
    || diagnostics.securityPolicyViolations.length > 0
  ) {
    failures.push("browser diagnostics or CSP policy violations were observed");
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    // This harness imports only the isolated production Worker graph. Loading
    // the application-wide React/compiler/catalog configuration needlessly
    // expands the verifier's memory footprint and can perturb software-WebGL
    // scheduling on small Linux runners.
    configFile: false,
    envFile: false,
    optimizeDeps: {
      entries: [HARNESS_ENTRY.slice(1)],
    },
    logLevel: "warn",
    appType: "custom",
    server: { port, strictPort: true, host: "127.0.0.1" },
    plugins: [{
      name: "studio-p5-brush-real-runtime-harness",
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
            + "<title>Studio p5.brush real runtime</title></head>"
            + "<body><main>Running production p5.brush Worker gate…</main>"
            + `<script type="module" src="${HARNESS_ENTRY}"></script>`
            + "</body></html>",
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
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-angle=swiftshader",
      ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      securityPolicyViolations: [],
    };
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      diagnostics.failedRequests.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      );
    });

    await page.goto(`${origin}${HARNESS_PATH}`, { waitUntil: "load" });
    await page.waitForFunction(
      () => window.__studioP5BrushRealRuntimeResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const browserResult = await page.evaluate(
      () => window.__studioP5BrushRealRuntimeResult,
    );
    await context.close();

    invariant(browserResult, "browser harness did not publish a result");
    diagnostics.securityPolicyViolations = [
      ...(browserResult.securityPolicyViolations ?? []),
    ];
    const result = browserResult.result;
    if (result.status === "unsupported") {
      invariant(
        result.reason === "webgl2-unavailable"
        && result.probe?.webgl2ContextAttempted === true,
        "only a genuine production Worker WebGL2 context absence may skip this gate",
      );
      const report = {
        status: "unsupported",
        policy: "skip-only-when-product-worker-offscreen-webgl2-is-null",
        result,
        diagnostics,
        artifactDirectory: SCRATCH,
      };
      writeJson("unsupported.json", report);
      console.warn(JSON.stringify(report, null, 2));
      process.exitCode = 2;
      return;
    }
    invariant(
      result.status === "ok",
      `production one-shot gate failed: ${result.message ?? "unknown error"}`,
    );
    writeJson("raw-observations.json", {
      result,
      contextAffinityStress: browserResult.contextAffinityStress,
      diagnostics,
      artifactDirectory: SCRATCH,
    });
    validateSuccess(
      result,
      browserResult.contextAffinityStress,
      diagnostics,
    );
    const report = {
      status: "observed",
      policy: "production-one-shot-worker-offscreen-webgl2-required",
      result,
      contextAffinityStress: browserResult.contextAffinityStress,
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("observations.json", report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await viteServer.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeJson("failure.json", {
    status: "failed",
    message,
    artifactDirectory: SCRATCH,
  });
  console.error(message);
  process.exitCode = 1;
});
