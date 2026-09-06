/**
 * Real Chromium verifier for exact WebGPU count / scan / stable-scatter dab tile binning.
 *
 * Exit codes: 0 = exact observed result, 1 = regression, 2 = structured environment skip.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRATCH =
  process.env.TOONSPECTRUM_DAB_BINNING_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-dab-binning-webgpu-${Date.now()}`);
const HARNESS_PATH = "/__studio_webgpu_dab_tile_binning_compute__";
const HARNESS_ENTRY = "/scripts/studio-webgpu-dab-tile-binning-compute-browser.ts";
const RESULT_TIMEOUT_MS = 180_000;
const CSP =
  "default-src 'none'; "
  + "script-src 'self'; "
  + "connect-src 'self'; "
  + "style-src 'none'; "
  + "img-src 'self' data:; "
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
        reject(new Error("could not allocate WebGPU binning verifier port"));
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
  if (result.status !== "ok") failures.push(`unexpected status: ${result.status}`);
  if (!Array.isArray(result.cases) || result.cases.length !== 3) {
    failures.push("expected three deterministic parity cases");
  }
  for (const evidence of result.cases ?? []) {
    if (evidence.offsetMismatches !== 0 || evidence.indexMismatches !== 0) {
      failures.push(
        `${evidence.id}: CSR mismatch offsets=${evidence.offsetMismatches} `
          + `indices=${evidence.indexMismatches}`,
      );
    }
    if (evidence.dabCount <= 0 || evidence.tileCount <= 0) {
      failures.push(`${evidence.id}: workload was not material`);
    }
  }
  if (
    result.benchmark?.parity?.offsetMismatches !== 0
    || result.benchmark?.parity?.indexMismatches !== 0
  ) failures.push("benchmark CSR parity was not exact");
  if ((result.shaderMessages?.length ?? 0) !== 0) {
    failures.push(`shader compilation emitted ${result.shaderMessages.length} messages`);
  }
  if ((result.scopedGpuErrors?.length ?? 0) !== 0) {
    failures.push(`scoped GPU errors: ${result.scopedGpuErrors.join("; ")}`);
  }
  if ((result.uncapturedGpuErrors?.length ?? 0) !== 0) {
    failures.push(`uncaptured GPU errors: ${result.uncapturedGpuErrors.join("; ")}`);
  }
  if (
    diagnostics.consoleErrors.length !== 0
    || diagnostics.consoleWarnings.length !== 0
    || diagnostics.pageErrors.length !== 0
    || diagnostics.requestFailures.length !== 0
  ) failures.push("browser diagnostics were not zero");
  if (
    !diagnostics.contentSecurityPolicy.includes("default-src 'none'")
    || !diagnostics.contentSecurityPolicy.includes("script-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("object-src 'none'")
  ) failures.push("isolated CSP boundary was missing");
  if (
    result.runtimeStats?.executions
      < (3 + 4 + 16 + 1)
  ) failures.push("runtime did not complete every parity and benchmark execution");
  if (!Number.isFinite(result.benchmark?.cpu?.p95Ms)) {
    failures.push("CPU benchmark distribution was invalid");
  }
  if (!Number.isFinite(result.benchmark?.gpu?.p95Ms)) {
    failures.push("GPU benchmark distribution was invalid");
  }
  if (failures.length > 0) {
    throw new Error(`WebGPU dab tile binning verification failed:\n- ${failures.join("\n- ")}`);
  }
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const viteServer = await createViteServer({
    root: ROOT,
    appType: "custom",
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
    plugins: [{
      name: "studio-webgpu-dab-tile-binning-compute-harness",
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
              + "<title>WebGPU Dab Tile Binning</title></head>"
              + "<body><main>Running exact WebGPU binning verification…</main>"
              + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
          );
        });
      },
    }],
  });
  await viteServer.listen();

  let browser = null;
  try {
    const headed = process.env.TOONSPECTRUM_WEBGPU_HEADED === "1";
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
      headless: !headed,
      args: launchArgs,
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

    const navigation = await page.goto(`${origin}${HARNESS_PATH}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    diagnostics.contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    await page.waitForFunction(
      () => window.__studioWebGpuDabTileBinningComputeResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioWebGpuDabTileBinningComputeResult,
    );
    await context.close();
    invariant(result && typeof result === "object", "browser returned no result");
    if (result.status === "unsupported") {
      const summary = {
        status: "skipped",
        skipKind: "environment-unsupported",
        result,
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
    const observed = {
      status: "observed",
      result,
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("observations.json", observed);
    validate(result, diagnostics);
    const summary = {
      ...observed,
      status: "ok",
      gates: {
        realChromiumWebGpu: true,
        exactCpuCsrParity: true,
        countScanStableScatter: true,
        zeroShaderMessages: true,
        zeroGpuErrors: true,
        zeroBrowserDiagnostics: true,
        boundedAdmission: true,
        promotionIsEvidenceGated: true,
        selectedBackend: result.election.selected,
      },
    };
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
