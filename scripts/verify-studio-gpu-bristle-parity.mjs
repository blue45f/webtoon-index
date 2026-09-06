/**
 * Real Chromium WebGPU parity verifier for the GPU bristle lane.
 *
 * `package.json` is owned by another workflow in this wave, so there is no alias yet:
 *
 *   node scripts/verify-studio-gpu-bristle-parity.mjs
 *
 * Evidence:
 *
 *   TOONSPECTRUM_GPU_BRISTLE_PARITY_VERIFY_DIR=/tmp/my-run \
 *     node scripts/verify-studio-gpu-bristle-parity.mjs
 *
 * Exit codes:
 *   0 = real WebGPU pixels and buffers passed every gate
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
  process.env.TOONSPECTRUM_GPU_BRISTLE_PARITY_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-gpu-bristle-parity");
const HARNESS_PATH = "/__studio_gpu_bristle_parity__";
const HARNESS_ENTRY = "/scripts/studio-gpu-bristle-parity-browser.ts";
const RESULT_TIMEOUT_MS = 180_000;

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

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];

  invariant(result.backend === "webgpu", `expected webgpu backend, got ${result.backend}`);
  invariant(result.stationCount > 0, "harness reported no stations");

  // G1 — byte-exact self-parity. Same device, same shader, two different chunkings of the same
  // 3,200 stations. This is the gate the station-major splat layout exists to make possible; an
  // atomic-append design cannot pass it at any price.
  if (!result.selfParity?.bristleState?.equal) {
    failures.push(
      "G1: bristleState differed between chunkings at f32 index "
      + `${result.selfParity?.bristleState?.firstDifferingIndex}`,
    );
  }
  if (!result.selfParity?.splatSlots?.equal) {
    failures.push(
      "G1: splat stream differed between chunkings at f32 index "
      + `${result.selfParity?.splatSlots?.firstDifferingIndex}`,
    );
  }

  // G3 — invariants and statistics against the deterministic CPU twin. Every threshold lives in
  // studio-gpu-bristle-contract.ts; the verifier only reports what the judges decided.
  const judgements = Array.isArray(result.judgements) ? result.judgements : [];
  const expectedMetrics = [
    "constraint-satisfaction",
    "pigment-conservation",
    "tip-lag",
    "terminal-load-ks",
  ];
  for (const metric of expectedMetrics) {
    const judgement = judgements.find((entry) => entry.metric === metric);
    if (!judgement) {
      failures.push(`G3: judgement ${metric} was not produced`);
      continue;
    }
    if (!judgement.pass) {
      failures.push(`G3 ${metric}: ${judgement.detail} (threshold ${judgement.threshold})`);
    }
  }

  // A tuft whose hairs all carry the same terminal load is a uniform rake, not a brush. The KS
  // judgement alone cannot see that (two identical degenerate samples agree perfectly).
  if (result.metrics?.gpuTerminalLoadStdDev <= 0) {
    failures.push(
      "G3: every bristle ended with an identical load — STIFFNESS_VARIATION/BRISTLE_JITTER collapsed",
    );
  }
  if (result.metrics?.depositedSplatCount <= 0) {
    failures.push("G3: the twin deposited nothing, so conservation compared zero against zero");
  }

  // G4 — the picture admission the product path itself runs.
  if (result.admission?.status !== "observed") {
    failures.push(`G4: admission probe unavailable (${result.admission?.reason})`);
  } else if (result.admission.admitted !== true) {
    failures.push(`G4: admission refused: ${(result.admission.reasons ?? []).join(", ")}`);
  }

  // Device loss must be observed from a real GPUDevice.destroy, not claimed.
  if (result.deviceLoss?.status !== "observed") {
    failures.push(`device-loss probe unavailable: ${result.deviceLoss?.reason}`);
  } else if (result.deviceLoss.runtimeStatus !== "device-lost") {
    failures.push(
      `runtime did not reach device-lost after GPUDevice.destroy (${result.deviceLoss.runtimeStatus})`,
    );
  } else if (result.deviceLoss.advanceAfterLoss !== "device-lost") {
    failures.push("advance() kept working after device loss instead of failing closed");
  }

  if ((result.uncapturedGpuErrors ?? []).length > 0) {
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

  invariant(
    failures.length === 0,
    `GPU bristle parity gate failed:\n  ${failures.join("\n  ")}`,
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
      + "<title>Studio GPU Bristle Parity</title></head>"
      + "<body><main>Running real Chromium WebGPU bristle parity…</main>"
      + `<script type="module" src="${HARNESS_ENTRY}"></script></body></html>`,
    );
  });
  await viteServer.listen(port);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-angle=swiftshader"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [] };
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
      () => window.__studioGpuBristleParityResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(() => window.__studioGpuBristleParityResult);
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

    writeJson("observations.json", { ...result, diagnostics, artifactDirectory: SCRATCH });
    validateSuccess(result, diagnostics);
    const summary = { ...result, status: "ok", diagnostics, artifactDirectory: SCRATCH };
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
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
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
