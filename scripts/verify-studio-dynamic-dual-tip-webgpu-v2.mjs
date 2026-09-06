/**
 * Actual Chromium SwiftShader verifier for exact dual-tip WebGPU v2.
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
  process.env.TOONSPECTRUM_DYNAMIC_DUAL_TIP_V2_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-dynamic-dual-tip-v2-${Date.now()}`);
const HARNESS_PATH = "/__studio_dynamic_dual_tip_webgpu_v2__";
const HARNESS_ENTRY = "/scripts/studio-dynamic-dual-tip-webgpu-v2-browser.ts";
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
        reject(new Error("could not allocate exact dual-tip v2 verifier port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(name, value) {
  writeFileSync(join(SCRATCH, name), `${JSON.stringify(value, null, 2)}\n`);
}

function validate(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "exact-dual-tip-v2-rgba16float-webgpu") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.providerCapability !== "dynamic-dual-tip-deposition-r8-v2"
    || result.executionRoute !== "webgpu-exact-packed-deposition-v2"
  ) failures.push("v2 provider route evidence drifted");
  if (
    Math.abs(result.regression0975.cpu[3] - 0.0975) > 1e-7
    || Math.abs(result.regression0975.gpu[3] - 0.0975) > result.tolerance
    || Math.abs(result.regression0975.gpu[3] - 0.1425)
      <= result.tolerance
    || result.regression0975.maxDelta > result.tolerance
  ) failures.push("0.0975 exact-order regression failed or matched forbidden aggregate path");
  if (
    JSON.stringify(Object.keys(result.families))
    !== JSON.stringify(FAMILY_IDS)
  ) failures.push("eight blend-family evidence coverage/order drifted");
  for (const family of FAMILY_IDS) {
    if (
      !result.families[family]
      || result.families[family].maxDelta > result.tolerance
    ) failures.push(`${family}: exact CPU/GPU parity failed`);
  }
  for (const [name, evidence] of [
    ["append", result.append],
    ["rebuild", result.rebuild],
    ["destination-out", result.destinationOut],
  ]) {
    if (evidence.maxDelta > result.tolerance) {
      failures.push(`${name}: exact CPU/GPU parity failed`);
    }
  }
  if (
    result.destinationOut.gpu[3] >= result.destinationOut.beforeAlpha
  ) failures.push("destination-out did not reduce authority alpha");
  if (
    result.receipts.length !== 7
    || result.receipts.some((receipt) => (
      receipt.kind !== "studio-dynamic-dual-tip-exact-webgpu-receipt"
      || receipt.revision !== 2
      || receipt.backend !== "webgpu"
      || receipt.providerCapability !== "dynamic-dual-tip-deposition-r8-v2"
      || receipt.executionRoute !== "webgpu-exact-packed-deposition-v2"
      || receipt.textureFormat !== "rgba16float"
      || receipt.compositionOrder
        !== "combine-same-deposition-then-premultiplied-authority"
      || receipt.numericalAuthority !== "ordered-rgba16float-webgpu"
      || receipt.exactness !== "algorithmically-exact-deposition-order"
      || receipt.queueState !== "completed"
      || receipt.complete !== true
    ))
  ) failures.push("exact v2 runtime receipt evidence invalid");
  if (
    JSON.stringify(result.receipts.map((receipt) => receipt.mode))
    !== JSON.stringify([
      "rebuild",
      "rebuild",
      "rebuild",
      "append",
      "rebuild",
      "rebuild",
      "append",
    ])
  ) failures.push("append/rebuild receipt sequence drifted");
  if (
    result.shaderMessages.some((messages) => (
      messages.some((message) => message.type === "error")
    ))
    || result.gpuErrors.validation !== null
    || result.gpuErrors.outOfMemory !== null
    || result.gpuErrors.uncaptured.length !== 0
  ) failures.push("WebGPU shader/error scopes reported diagnostics");
  if (
    diagnostics.consoleErrors.length !== 0
    || diagnostics.pageErrors.length !== 0
    || diagnostics.requestFailures.length !== 0
  ) failures.push("browser diagnostics were not clean");
  if (!diagnostics.contentSecurityPolicy.includes("default-src 'none'")) {
    failures.push("isolated verifier CSP was absent");
  }
  if (failures.length > 0) {
    throw new Error(`exact dual-tip v2 verification failed:\n- ${failures.join("\n- ")}`);
  }
}

mkdirSync(SCRATCH, { recursive: true });
const port = await findFreePort();
const origin = `http://127.0.0.1:${port}/`;
const viteServer = await createViteServer({
  root: WEB_ROOT,
  logLevel: "error",
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [{
    name: "studio-dynamic-dual-tip-v2-verifier-page",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== HARNESS_PATH) {
          next();
          return;
        }
        response.setHeader("Content-Security-Policy", CSP);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          "<!doctype html><html><head><meta charset=\"utf-8\">"
          + "<title>Studio Exact Dual Tip WebGPU v2</title></head>"
          + "<body><main>Running exact dual-tip WebGPU v2 parity…</main>"
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
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-angle=swiftshader"],
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
    () => window.__studioDynamicDualTipWebGpuV2Result !== undefined,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
  const result = await page.evaluate(
    () => window.__studioDynamicDualTipWebGpuV2Result,
  );
  await context.close();
  invariant(result && typeof result === "object", "browser returned no result");
  if (result.status === "unsupported") {
    const summary = {
      status: "skipped",
      skipKind: "environment-unsupported",
      reason: result.reason,
      capabilities: result.capabilities,
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("summary.json", summary);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 2;
  } else {
    invariant(
      result.status === "ok",
      `browser harness failed: ${
        result.status === "error" ? result.stack ?? result.message : "unknown"
      }`,
    );
    writeJson("browser-result.json", result);
    validate(result, diagnostics);
    const summary = {
      status: "ok",
      ...result,
      diagnostics,
      artifactDirectory: SCRATCH,
      gates: {
        realChromiumSwiftShaderWebGpu: true,
        actualWgslCompilation: true,
        rgba16floatAlignedMapRead: true,
        exactSameDepositionComposition: true,
        exact0975NonAggregateRegression: true,
        eightBlendFamilies: true,
        appendAndRebuild: true,
        sourceOverAndDestinationOut: true,
        varyingPaintColorAndAlpha: true,
        zeroGpuAndBrowserDiagnostics: true,
        contentSecurityPolicy: true,
      },
    };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  }
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
