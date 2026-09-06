/**
 * Reproducible real-Chromium verifier for the Studio BG3D next-generation (WebGPU) 3D engine.
 *
 * It proves three things that unit tests cannot:
 *   1. the production WebGPU renderer factory really initializes a WebGPU backend and fails closed;
 *   2. the WebGPU capture adapter produces the same raster and depth as the shipped WebGL adapter,
 *      within the engine benchmark contract's channel/depth tolerances; and
 *   3. the engine-selection policy resolves the way the product intends inside the in-app browsers
 *      Korean traffic actually arrives through, replayed as real Chromium user agents.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-bg3d-webgpu-engine.mjs
 *
 * Exit codes:
 *   0 = the WebGPU engine, capture parity, and in-app selection contracts passed
 *   1 = implementation, browser, or contract failure
 *   2 = explicit structured environment skip because WebGPU is unavailable here
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const SCRATCH =
  process.env.TOONSPECTRUM_BG3D_WEBGPU_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-bg3d-webgpu-${Date.now()}`);
const HARNESS_PATH = "/__studio_bg3d_webgpu_engine__";
const HARNESS_ENTRY = "/scripts/studio-bg3d-webgpu-engine-browser.ts";
const RESULT_TIMEOUT_MS = 180_000;
const CHANNEL_TOLERANCE = 4;
const DEPTH_TOLERANCE = 0.001;
/**
 * A software adapter rasterizes edges slightly differently from the WebGL2 path, so a handful of
 * silhouette pixels legitimately differ. The gate is on the share of the frame, not on zero.
 */
const MAX_OVER_TOLERANCE_SHARE = 0.02;
/**
 * Share of the VRM crop the character must cover. The camera frames head and torso against a
 * transparent clear, so a loaded-but-unbuilt material shows up as a near-empty raster; 20% is far
 * above that floor and far below a framing change that would need this number revisited anyway.
 */
const VRM_MIN_COVERAGE = 0.2;
/**
 * MToon does not shade the same on both backends, and this is the fence around that.
 *
 * `MToonMaterial` and `MToonNodeMaterial` are two independent upstream implementations of one
 * spec. Rendered here from one scene, one camera, one light rig and one tone mapping, they differ
 * across the whole surface — while the unlit scene above compares byte-identical, which is what
 * rules out the pipeline and leaves MToon itself. Measured on 2026-08-29 against
 * `@pixiv/three-vrm` 3.5.3 with `AliciaSolid.vrm`: composited max 169/255, 16.9% of channels over
 * tolerance, WebGPU ~5.7% darker in mean luminance, and a same-backend control of exactly 0.
 *
 * The product answer is `webgl-only-vrm-character`: a scene holding a character runs on the
 * baseline, so what is delivered matches the poser and every other machine. These numbers exist so
 * the gap cannot widen unnoticed, and so that the day upstream converges is visible as this gate
 * going quiet rather than as nobody remembering to look.
 */
const VRM_MAX_COMPOSITED_DELTA = 200;
const VRM_MAX_OVER_TOLERANCE_SHARE = 0.25;
const UNSUPPORTED_REASONS = new Set([
  "insecure-context",
  "api-unavailable",
  "adapter-unavailable",
  "insufficient-limits",
  "timeout",
  "aborted",
]);
/**
 * Replayed in-app browser user agents. Chromium runs the real page under each one, so the policy is
 * exercised against `navigator.userAgent` rather than a string handed to it in a unit test.
 */
const IN_APP_USER_AGENTS = [
  {
    id: "kakaotalk",
    expectedId: "kakaotalk",
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.6.5",
  },
  {
    id: "naver-app",
    expectedId: "naver",
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.9.6)",
  },
  {
    id: "instagram",
    expectedId: "instagram",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0",
  },
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
        reject(new Error("could not allocate a BG3D WebGPU verifier port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(join(SCRATCH, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function validateParity(label, section, failures) {
  const channels = section?.raster?.comparedChannels ?? 0;
  const samples = section?.depth?.comparedSamples ?? 0;
  if (channels === 0 || samples === 0) {
    failures.push(`${label}: capture produced no comparable data`);
    return;
  }
  if ((section.webgpu?.nonZeroAlpha ?? 0) === 0 || (section.webgl?.nonZeroAlpha ?? 0) === 0) {
    failures.push(`${label}: one of the backends rendered an empty raster`);
  }
  // Alpha is defined everywhere, so it is held to the tolerance exactly.
  if (section.raster.maxAlphaDelta > CHANNEL_TOLERANCE) {
    failures.push(
      `${label}: alpha differs by ${section.raster.maxAlphaDelta}, over ±${CHANNEL_TOLERANCE}`,
    );
  }
  // Straight-alpha RGB is undefined at alpha 0, so the composited value carries the gate.
  const compositedShare =
    section.raster.overToleranceCompositedChannels / (section.raster.comparedPixels * 3);
  if (compositedShare > MAX_OVER_TOLERANCE_SHARE) {
    failures.push(
      `${label}: ${(compositedShare * 100).toFixed(2)}% of composited channels exceed`
      + ` ±${CHANNEL_TOLERANCE} (max delta ${section.raster.maxCompositedDelta})`,
    );
  }
  const overShare = section.raster.overToleranceChannels / channels;
  if (overShare > MAX_OVER_TOLERANCE_SHARE) {
    failures.push(
      `${label}: ${(overShare * 100).toFixed(2)}% of raw channels exceed ±${CHANNEL_TOLERANCE}`
      + ` (max delta ${section.raster.maxChannelDelta})`,
    );
  }
  const depthOverShare = section.depth.overToleranceSamples / samples;
  if (depthOverShare > MAX_OVER_TOLERANCE_SHARE) {
    failures.push(
      `${label}: ${(depthOverShare * 100).toFixed(2)}% of depth samples exceed ±${DEPTH_TOLERANCE}`
      + ` (max delta ${section.depth.maxDepthDelta})`,
    );
  }
  if ((section.depth.distinctDepthValues ?? 0) < 3) {
    failures.push(`${label}: depth raster is flat, so parity would be vacuous`);
  }
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  if (result.backend !== "real-chromium-three-webgpu") {
    failures.push(`unexpected backend: ${result.backend}`);
  }
  if (
    result.adapters?.webgpu?.backend !== "three-webgpu"
    || result.adapters?.webgpu?.graphicsApi !== "webgpu"
    || result.adapters?.webgpu?.profileId !== result.adapters?.webgl?.profileId
  ) {
    failures.push("WebGPU capture adapter did not declare the shared capture profile");
  }
  validateParity("opaque", result.opaque, failures);
  validateParity("transparent", result.transparent, failures);

  // The engine policy is explicit and fail-closed (ADR 0018): an artist's selection is never
  // swapped for another backend. Capability, host and feature problems move `status` while
  // `backend` stays put, and the Korean notice tells the artist to choose WebGL2 themselves.
  //
  // This block used to assert the opposite — a two-lane `auto` policy that demoted in-app
  // browsers to WebGL2 and promoted capable ones to WebGPU. That policy was deleted in
  // 0520c7e18; the reason string it looked for (`auto-webgpu-promoted`) has not existed since,
  // so the check could not pass. It also read only `backend`, which for a fail-closed policy is
  // the one field that never moves: a correctly REFUSED plan and an admitted one serialize
  // identically. Every assertion below reads status, and reason, and diagnostics.
  const selectionById = new Map((result.selection ?? []).map((row) => [row.id, row]));

  const describeRow = (row) =>
    `webgpu=${row?.webgpuBackend}/${row?.webgpuStatus}/${row?.webgpuReason}`
    + ` webgl2=${row?.webgl2Backend}/${row?.webgl2Status}/${row?.webgl2Reason}`;

  /** Every host must keep the explicit WebGL2 baseline reachable — that is the advertised escape. */
  const assertWebgl2Escape = (id, row) => {
    if (row?.webgl2Backend !== "webgl2"
      || row?.webgl2Status !== "available"
      || row?.webgl2Reason !== "user-webgl2-override") {
      failures.push(`${id}: the explicit WebGL2 baseline was not available (${describeRow(row)})`);
    }
  };

  const desktop = selectionById.get("desktop-chrome");
  if (desktop?.webgpuBackend !== "webgpu"
    || desktop?.webgpuStatus !== "available"
    || desktop?.webgpuReason !== "user-webgpu-override"
    || (desktop?.webgpuDiagnostics ?? []).length !== 0) {
    failures.push(
      `a capable standalone browser did not admit its explicit WebGPU selection (${describeRow(desktop)}`
      + ` diagnostics=${JSON.stringify(desktop?.webgpuDiagnostics ?? null)})`,
    );
  }
  assertWebgl2Escape("desktop-chrome", desktop);

  // gpuTrust "opt-in" is advisory. It must flag the reservation in diagnostics and must NOT
  // change the backend or the status — that distinction is the whole of the current policy.
  for (const optIn of ["kakaotalk", "naver-app", "ios-webview"]) {
    const row = selectionById.get(optIn);
    if (row?.webgpuBackend !== "webgpu"
      || row?.webgpuStatus !== "available"
      || row?.webgpuReason !== "user-webgpu-override") {
      failures.push(`${optIn}: an opt-in in-app browser did not admit an explicit WebGPU selection (${describeRow(row)})`);
    }
    if (!(row?.webgpuDiagnostics ?? []).includes("inapp-browser-opt-in-required")) {
      failures.push(
        `${optIn}: the opt-in reservation was not surfaced as a diagnostic`
        + ` (${JSON.stringify(row?.webgpuDiagnostics ?? null)})`,
      );
    }
    assertWebgl2Escape(optIn, row);
  }

  // gpuTrust "blocked" is a hard block: the selection stays WebGPU and becomes unavailable.
  const blocked = selectionById.get("instagram");
  if (blocked?.webgpuBackend !== "webgpu"
    || blocked?.webgpuStatus !== "unavailable"
    || blocked?.webgpuReason !== "inapp-browser-blocked") {
    failures.push(`a blocked in-app browser did not refuse WebGPU (${describeRow(blocked)})`);
  }
  assertWebgl2Escape("instagram", blocked);

  // The KTX2 transcoder must initialize against both live renderers, or compressed-texture models
  // would fail to import on whichever backend the policy picked.
  for (const backend of ["webgpu", "webgl"]) {
    const ktx2 = result.ktx2?.[backend];
    if (ktx2?.ok !== true) {
      failures.push(
        `KTX2 transcoder did not initialize on ${backend}: ${ktx2?.code ?? ktx2?.message ?? "no result"}`,
      );
    } else if (ktx2.decodeFailure !== false || !ktx2.transcoderId) {
      failures.push(`KTX2 transcoder on ${backend} reported an unusable runtime`);
    }
  }
  // A real VRM must load and reach the raster on both backends. This is the gate that lets
  // characters onto WebGPU at all: picking the wrong MToon build never throws, it just leaves the
  // character out of an otherwise healthy frame, so coverage is asserted, not just "no error".
  for (const [backend, expectedBrand] of [["webgpu", "mtoonNode"], ["webgl", "mtoonShader"]]) {
    const vrm = result.vrmMToon?.[backend];
    if (vrm?.ok !== true) {
      failures.push(`VRM did not load on ${backend}: ${vrm?.message ?? "no result"}`);
      continue;
    }
    const expectedVariant = backend === "webgpu" ? "webgpu-node" : "webgl-shader";
    if (vrm.recordedVariant !== expectedVariant) {
      failures.push(
        `VRM on ${backend} recorded material variant ${vrm.recordedVariant}, expected ${expectedVariant}`,
      );
    }
    if ((vrm.brands?.[expectedBrand] ?? 0) === 0) {
      failures.push(
        `VRM on ${backend} produced no ${expectedBrand} materials`
        + ` (${JSON.stringify(vrm.brands)})`,
      );
    }
    const coverage = vrm.coveredPixels / (vrm.capturedPixels || 1);
    if (coverage < VRM_MIN_COVERAGE) {
      failures.push(
        `VRM on ${backend} covered ${(coverage * 100).toFixed(1)}% of the capture,`
        + ` under the ${(VRM_MIN_COVERAGE * 100).toFixed(0)}% floor — the character did not render`,
      );
    }
  }
  // Coverage answers "is the character there" and stops. Colour is a separate question, and for a
  // long time nobody was asking it: the two backends agreed on the silhouette and that read as
  // equivalence. They do not agree on shading. Assert the known gap so a regression that widens it
  // is a failure rather than a number nobody re-reads.
  const vrmRaster = result.vrmMToon?.raster;
  if (result.vrmMToon && !result.vrmMToon.skipped && !vrmRaster) {
    failures.push("VRM rendered on both backends but the harness reported no colour comparison");
  } else if (vrmRaster) {
    const overShare = vrmRaster.overToleranceCompositedChannels / (vrmRaster.comparedPixels * 3 || 1);
    if (vrmRaster.maxCompositedDelta > VRM_MAX_COMPOSITED_DELTA) {
      failures.push(
        `VRM MToon backends now differ by ${vrmRaster.maxCompositedDelta}/255 on a channel,`
        + ` over the ${VRM_MAX_COMPOSITED_DELTA} fence — the shading gap widened`,
      );
    }
    if (overShare > VRM_MAX_OVER_TOLERANCE_SHARE) {
      failures.push(
        `VRM MToon backends now differ on ${(overShare * 100).toFixed(1)}% of channels,`
        + ` over the ${(VRM_MAX_OVER_TOLERANCE_SHARE * 100).toFixed(0)}% fence`,
      );
    }
  }

  // A WebGL-only feature keeps WebGPU SELECTED and makes it unavailable — it never picks WebGL2
  // on the artist's behalf. The escape it advertises must be real, so the baseline is asserted too.
  for (const row of result.webglOnlyFeatures ?? []) {
    const expected = row.feature === "webxr" ? "webgl-only-webxr" : "webgl-only-vrm-character";
    if (row.webgpuBackend !== "webgpu"
      || row.webgpuStatus !== "unavailable"
      || row.webgpuReason !== expected) {
      failures.push(
        `${row.feature}: WebGL-only feature did not fail the WebGPU selection closed`
        + ` (backend=${row.webgpuBackend}, status=${row.webgpuStatus}, reason=${row.webgpuReason},`
        + ` expected reason=${expected})`,
      );
    }
    if (row.webgl2Backend !== "webgl2"
      || row.webgl2Status !== "available"
      || row.webgl2Reason !== "user-webgl2-override") {
      failures.push(
        `${row.feature}: the WebGL2 escape the notice advertises was not available`
        + ` (backend=${row.webgl2Backend}, status=${row.webgl2Status}, reason=${row.webgl2Reason})`,
      );
    }
  }

  if ((result.deviceLosses ?? []).length !== 0) {
    failures.push(`WebGPU device was lost during the run: ${result.deviceLosses.join("; ")}`);
  }
  if (diagnostics.pageErrors.length !== 0 || diagnostics.requestFailures.length !== 0) {
    // Naming them matters: "diagnostics were emitted" sends the reader back to the browser to
    // rediscover what this run already saw.
    failures.push(
      "Chromium emitted page or request diagnostics: "
      + [
        ...diagnostics.pageErrors.map((entry) => `pageerror ${entry}`),
        ...diagnostics.requestFailures.map((entry) => `request ${entry}`),
      ].join(" | "),
    );
  }
  return failures;
}

async function readHarnessResult(browser, port, { userAgent, probeVrm = false } = {}) {
  // Each run gets its own context so an emulated in-app user agent applies to the whole page.
  const context = await browser.newContext(userAgent ? { userAgent } : {});
  const page = await context.newPage();
  const diagnostics = {
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
  page.on("crash", () => diagnostics.pageErrors.push("renderer process crashed"));
  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  try {
    // The VRM probe downloads a multi-megabyte model, so only the primary run asks for it. The
    // in-app replays exist to classify a user agent; making them each reload a character would
    // triple the run for evidence the first pass already produced.
    const harnessUrl = `http://127.0.0.1:${port}${HARNESS_PATH}${probeVrm ? "?vrm=1" : ""}`;
    await page.goto(harnessUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__studioBg3dWebGpuEngineResult !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(() => window.__studioBg3dWebGpuEngineResult);
    return { result, diagnostics };
  } catch (error) {
    const detail = [
      ...diagnostics.pageErrors.map((entry) => `pageerror: ${entry}`),
      ...diagnostics.consoleErrors.slice(0, 8).map((entry) => `console: ${entry}`),
      ...diagnostics.requestFailures.slice(0, 8).map((entry) => `request: ${entry}`),
    ].join(" | ");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${detail ? " — " + detail : ""}`,
      { cause: error },
    );
  } finally {
    await page.close();
    await context.close();
  }
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const viteServer = await createViteServer({
    appType: "custom",
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
    // Pre-bundle what the VRM probe reaches through a dynamic import. Discovering these mid-run
    // makes Vite re-optimize and invalidate the module graph the page is already executing, which
    // surfaces as "Failed to fetch dynamically imported module" rather than as a real defect.
    optimizeDeps: {
      include: [
        "@pixiv/three-vrm",
        "@pixiv/three-vrm/nodes",
        "three/examples/jsm/loaders/GLTFLoader.js",
      ],
    },
    plugins: [{
      name: "studio-bg3d-webgpu-engine-verifier",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          // Compare the path only: the primary run appends `?vrm=1` to ask for the VRM probe.
          const [pathname] = (request.url ?? "").split("?");
          if (pathname !== HARNESS_PATH) {
            next();
            return;
          }
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<title>Studio BG3D WebGPU engine</title></head>"
            + "<body><main>Running real Chromium BG3D WebGPU verification…</main>"
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
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        // Software WebGPU is enough to prove the contract; a discrete GPU is not required.
        "--enable-unsafe-webgpu",
        "--use-angle=swiftshader",
      ],
    });
    const { result, diagnostics } = await readHarnessResult(browser, port, { probeVrm: true });
    invariant(result && typeof result === "object", "browser returned no structured result");
    writeJson("browser-result.json", result);

    if (result.status === "unsupported") {
      invariant(
        UNSUPPORTED_REASONS.has(result.reason),
        `unknown unsupported reason: ${result.reason}`,
      );
      const summary = {
        status: "unsupported",
        reason: result.reason,
        message: "WebGPU is unavailable in this environment; the engine policy stays on WebGL2.",
        evidenceDirectory: SCRATCH,
      };
      writeJson("summary.json", summary);
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    if (result.status !== "ok") {
      throw new Error(`browser harness failed: ${result.message ?? result.status}`);
    }

    const failures = validateSuccess(result, diagnostics);

    // Replay the same page under real in-app browser user agents.
    const inAppRuns = [];
    for (const host of IN_APP_USER_AGENTS) {
      const run = await readHarnessResult(browser, port, { userAgent: host.userAgent });
      const classified = run.result?.liveUserAgent?.classified;
      const row = {
        id: host.id,
        status: run.result?.status,
        classifiedId: classified?.id ?? null,
        gpuTrust: classified?.gpuTrust ?? null,
        pageErrors: run.diagnostics.pageErrors,
        requestFailures: run.diagnostics.requestFailures,
      };
      inAppRuns.push(row);
      if (run.result?.status !== "ok") {
        failures.push(`${host.id}: harness did not complete (${run.result?.status})`);
      }
      if (classified?.id !== host.expectedId) {
        failures.push(
          `${host.id}: live user agent classified as ${classified?.id} instead of ${host.expectedId}`,
        );
      }
      if (run.diagnostics.pageErrors.length > 0) {
        failures.push(`${host.id}: page errors ${run.diagnostics.pageErrors.join("; ")}`);
      }
    }
    writeJson("in-app-runs.json", inAppRuns);

    const summary = {
      status: failures.length === 0 ? "ok" : "failed",
      backend: result.backend,
      browserVersion: browser.version(),
      probe: result.probe,
      captureParity: {
        opaque: { raster: result.opaque.raster, depth: result.opaque.depth },
        transparent: { raster: result.transparent.raster, depth: result.transparent.depth },
        channelTolerance: CHANNEL_TOLERANCE,
        depthTolerance: DEPTH_TOLERANCE,
        maxOverToleranceShare: MAX_OVER_TOLERANCE_SHARE,
      },
      selection: result.selection,
      webglOnlyFeatures: result.webglOnlyFeatures,
      ktx2: result.ktx2,
      vrmMToon: result.vrmMToon,
      // Reported, not asserted — see the harness. `first` well above `medianAfterFirst` is the
      // shape that says pipeline cost is one-time and per-capture allocation needs no cache.
      captureCost: result.captureCost,
      inAppRuns,
      failures,
      evidenceDirectory: SCRATCH,
    };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await viteServer.close();
  }
}

main().catch((error) => {
  const failure = {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    evidenceDirectory: SCRATCH,
  };
  mkdirSync(SCRATCH, { recursive: true });
  writeJson("summary.json", failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
