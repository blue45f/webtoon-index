/**
 * Real Chromium CanvasKit module-Worker/WASM boundary verifier.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-canvaskit-quality-worker.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_CANVASKIT_WORKER_VERIFY_DIR=/tmp/canvaskit-worker \
 *     pnpm exec node scripts/verify-studio-canvaskit-quality-worker.mjs
 *
 * Exit codes:
 *   0 = actual Worker/WASM operations and all fail-closed gates passed
 *   1 = provider, protocol, Worker, WASM, CSP or browser diagnostic failure
 *   2 = structured environment skip because a required browser primitive is unavailable
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT, WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_CANVASKIT_WORKER_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-canvaskit-quality-worker-${Date.now()}`);
const HARNESS_PATH = "/__studio_canvaskit_quality_worker__";
const HARNESS_ENTRY = "/scripts/studio-canvaskit-quality-worker-browser.ts";
const RESULT_TIMEOUT_MS = 90_000;
const CSP =
  "default-src 'none'; "
  + "script-src 'self' 'wasm-unsafe-eval'; "
  + "worker-src 'self' blob:; "
  + "child-src 'self' blob:; "
  + "connect-src 'self'; "
  + "img-src 'self' data:; "
  + "style-src 'none'; "
  + "font-src 'none'; "
  + "object-src 'none'; "
  + "base-uri 'none'; "
  + "frame-ancestors 'none'";
const EXPECTED_OPERATIONS = ["union", "intersect", "difference", "xor"];

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
        reject(new Error("could not allocate a CanvasKit browser-harness port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(join(SCRATCH, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function writeSvgEvidence(result) {
  const rows = [
    ...result.booleanOperations.map((operation) => ({
      label: operation.op,
      pathData: operation.pathData,
      fill: "#7c3aed",
    })),
    {
      label: "stroke-to-fill",
      pathData: result.strokeToFill.pathData,
      fill: "#0891b2",
    },
  ];
  const groups = rows.map((row, index) => {
    const offset = index * 120;
    return [
      `<g transform="translate(15 ${offset + 20})">`,
      `<text x="0" y="-5" font-family="sans-serif" font-size="12">${escapeXml(row.label)}</text>`,
      `<path d="${escapeXml(row.pathData)}" fill="${row.fill}" fill-opacity="0.72"/>`,
      "</g>",
    ].join("");
  });
  writeFileSync(
    join(SCRATCH, "pathops-and-stroke.svg"),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="170" height="620" viewBox="0 0 170 620">',
      '<rect width="170" height="620" fill="#f8fafc"/>',
      groups.join(""),
      "</svg>",
      "",
    ].join("\n"),
  );
}

function isCanvasKitWasmUrl(url) {
  return /canvaskit[^?#]*\.wasm|canvaskit.*wasm|\.(?:wasm)(?:[?#]|$)/iu.test(url);
}

function isQualityWorkerUrl(url) {
  return /studio-quality-worker-entry|toonspectrum-quality-geometry/iu.test(url);
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "canvaskit-wasm-module-worker") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.provider?.id !== "canvaskit"
    || result.provider?.profile !== "canvaskit-pathops-stroke-v1"
    || result.provider?.capabilities?.pathBoolean !== true
    || result.provider?.capabilities?.strokeToPath !== true
  ) {
    failures.push("real CanvasKit PathOps/stroke provider ready receipt is incomplete");
  }
  if (
    JSON.stringify(result.booleanOperations.map(({ op }) => op))
    !== JSON.stringify(EXPECTED_OPERATIONS)
  ) {
    failures.push("union/intersection/difference/xor coverage or order drifted");
  }
  for (const operation of result.booleanOperations) {
    if (
      operation.execution !== "quality-worker"
      || operation.providerId !== "canvaskit"
      || typeof operation.pathData !== "string"
      || operation.pathData.length === 0
      || operation.pathDataCodeUnits !== operation.pathData.length
    ) {
      failures.push(`${operation.op}: no portable CanvasKit Worker path result`);
    }
    if (
      JSON.stringify(operation.samples)
      !== JSON.stringify(operation.expectedSamples)
    ) {
      failures.push(
        `${operation.op}: Path2D semantic samples ${JSON.stringify(operation.samples)} `
        + `did not match ${JSON.stringify(operation.expectedSamples)}`,
      );
    }
  }
  if (
    result.strokeToFill?.execution !== "quality-worker"
    || result.strokeToFill?.providerId !== "canvaskit"
    || !result.strokeToFill.pathData
    || JSON.stringify(result.strokeToFill.samples)
      !== JSON.stringify(result.strokeToFill.expectedSamples)
  ) {
    failures.push("stroke-to-fill did not produce the expected portable filled geometry");
  }
  if (
    result.determinism?.booleanSameInputExactPathData !== true
    || result.determinism?.strokeSameInputExactPathData !== true
  ) {
    failures.push("identical path/stroke inputs were not byte-for-byte deterministic");
  }
  if (
    result.structuredCloneBoundary?.passed !== true
    || result.structuredCloneBoundary?.violations?.length !== 0
    || result.structuredCloneBoundary?.forbiddenKeys?.length !== 0
    || result.structuredCloneBoundary?.checkedValues === 0
    || result.structuredCloneBoundary?.structuredCloneRoundTrips
      !== result.structuredCloneBoundary?.checkedValues
    || result.structuredCloneBoundary?.jsonRoundTrips
      !== result.structuredCloneBoundary?.checkedValues
  ) {
    failures.push("Worker boundary contained a non-portable or non-structured-clone value");
  }
  if (
    result.budgetFailClosed?.testedCodeUnits
      <= result.budgetFailClosed?.limitCodeUnits
    || result.budgetFailClosed?.error?.code !== "invalid-input"
    || result.budgetFailClosed?.workerPostDelta !== 0
    || result.budgetFailClosed?.pendingCountAfterFailure !== 0
    || result.budgetFailClosed?.recoveryProviderId !== "canvaskit"
    || result.budgetFailClosed?.recoveryOk !== true
  ) {
    failures.push("oversized path input did not fail closed before Worker posting and recover");
  }
  if (
    result.cancellationFailClosed?.preAbortedError?.code !== "aborted"
    || result.cancellationFailClosed?.preAbortedWorkerPostDelta !== 0
    || result.cancellationFailClosed?.inFlightError?.code !== "aborted"
    || result.cancellationFailClosed?.cancelMessagePosted !== true
    || result.cancellationFailClosed?.resultDeliveredToCaller !== false
    || result.cancellationFailClosed?.pendingCountAfterAbort !== 0
    || result.cancellationFailClosed?.recoveryProviderId !== "canvaskit"
    || result.cancellationFailClosed?.recoveryOk !== true
  ) {
    failures.push("pre-start/in-flight cancellation did not fail closed and recover");
  }
  if (
    result.malformedPayloadFailClosed?.initializedRealProvider !== true
    || result.malformedPayloadFailClosed?.fatalType !== "studio-quality/fatal"
    || result.malformedPayloadFailClosed?.fatalStage !== "protocol"
    || result.malformedPayloadFailClosed?.fatalCode !== "invalid-message"
    || result.malformedPayloadFailClosed?.fatalWorkerEpoch !== 7_002
    || result.malformedPayloadFailClosed?.requestId !== 1
  ) {
    failures.push("malformed payload was not rejected by a real initialized Worker epoch");
  }
  if (
    !Array.isArray(result.workerObservations)
    || result.workerObservations.length !== 2
    || result.workerObservations.some(
      (worker) =>
        worker.createdBy !== "createStudioQualityModuleWorker"
        || worker.errorEvents.length > 0
        || worker.messageErrorEvents.length > 0
        || worker.cloneFailures.length > 0,
    )
  ) {
    failures.push("module Worker observations contain Worker/message/clone errors");
  }
  if (result.securityPolicyViolations?.length > 0) {
    failures.push(
      `browser security policy violations: ${JSON.stringify(result.securityPolicyViolations)}`,
    );
  }

  const wasmRequests = diagnostics.requests.filter(({ url }) => isCanvasKitWasmUrl(url));
  const wasmResponses = diagnostics.responses.filter(({ url }) => isCanvasKitWasmUrl(url));
  const workerRequests = diagnostics.requests.filter(({ url }) => isQualityWorkerUrl(url));
  if (wasmRequests.length === 0 || wasmResponses.length === 0) {
    failures.push("no real CanvasKit WASM network load was observed");
  }
  if (wasmResponses.some(({ status }) => status >= 400)) {
    failures.push(`CanvasKit WASM HTTP failures: ${JSON.stringify(wasmResponses)}`);
  }
  if (workerRequests.length === 0 && diagnostics.workerUrls.length === 0) {
    failures.push("no real module Worker script load was observed");
  }
  if (
    !diagnostics.contentSecurityPolicy.includes("'wasm-unsafe-eval'")
    || !diagnostics.contentSecurityPolicy.includes("worker-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("connect-src 'self'")
  ) {
    failures.push("the verifier response did not enforce the declared Worker/WASM CSP");
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
    `CanvasKit quality Worker/WASM gate failed:\n  ${failures.join("\n  ")}`,
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
    plugins: [
      {
        name: "studio-canvaskit-quality-worker-harness",
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
              + "<title>Studio CanvasKit Quality Worker</title></head>"
              + "<body><main>Running real CanvasKit Worker/WASM boundary…</main>"
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
      args: ["--no-sandbox"],
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
      requests: [],
      responses: [],
      workerUrls: [],
    };
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
      if (message.type() === "warning") diagnostics.consoleWarnings.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("request", (request) => {
      diagnostics.requests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
    });
    page.on("response", (response) => {
      const url = response.url();
      if (isCanvasKitWasmUrl(url) || isQualityWorkerUrl(url)) {
        diagnostics.responses.push({
          status: response.status(),
          url,
        });
      }
    });
    page.on("requestfailed", (request) => {
      diagnostics.requestFailures.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
      );
    });
    page.on("worker", (worker) => {
      diagnostics.workerUrls.push(worker.url());
    });

    const navigation = await page.goto(`${origin}${HARNESS_PATH.slice(1)}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    diagnostics.contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    await page.waitForFunction(
      () => window.__studioCanvasKitQualityWorkerResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioCanvasKitQualityWorkerResult,
    );
    await context.close();

    invariant(result && typeof result === "object", "browser returned no structured result");
    writeJson("browser-result.json", result);
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

    writeSvgEvidence(result);
    const rawObservations = {
      status: "observed-unvalidated",
      backend: result.backend,
      provider: result.provider,
      booleanOperations: result.booleanOperations,
      strokeToFill: result.strokeToFill,
      determinism: result.determinism,
      structuredCloneBoundary: result.structuredCloneBoundary,
      budgetFailClosed: result.budgetFailClosed,
      cancellationFailClosed: result.cancellationFailClosed,
      malformedPayloadFailClosed: result.malformedPayloadFailClosed,
      workerObservations: result.workerObservations,
      securityPolicyViolations: result.securityPolicyViolations,
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("observations.json", rawObservations);
    validateSuccess(result, diagnostics);
    const observations = {
      ...rawObservations,
      status: "observed",
      gates: {
        realModuleWorker: true,
        realCanvasKitWasmNetworkLoad: true,
        allFourPathOps: true,
        strokeToFill: true,
        exactSameInputDeterminism: true,
        structuredCloneOnly: true,
        malformedPayloadFailClosed: true,
        inputBudgetFailClosed: true,
        cancellationFailClosed: true,
        zeroWorkerErrors: true,
        zeroWasmErrors: true,
        zeroCspViolations: true,
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
