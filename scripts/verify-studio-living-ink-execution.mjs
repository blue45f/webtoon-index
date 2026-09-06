/**
 * Actual Chromium gate for the independent ToonSpectrum Living Ink execution provider.
 *
 * Each lane passes an explicit provider id into every Worker epoch. Browser capabilities can make
 * that provider unavailable, but cannot select or substitute the other backend. The same visual
 * harness therefore verifies WebGPU/WGSL and WebGL2/GLSL as independent product choices.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_VITE_CONFIG } from "./lib/repo-paths.mjs";

const EVIDENCE_ROOT = process.env.TOONSPECTRUM_LIVING_INK_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-living-ink-${Date.now()}`);
const PROBE_RESULTS_PATH = process.env.TOONSPECTRUM_LIVING_INK_PROBE_RESULTS_PATH
  ?? new URL("../tests/benchmarks/results/living-ink-probe.json", import.meta.url);
const HARNESS_PATH = "/__studio_living_ink_execution__";
const ENTRY = "/scripts/studio-living-ink-execution-browser.ts";
const TIMEOUT_MS = 180_000;
const INKWASH_ORACLE = Object.freeze({
  pinnedCommit: "48b7cf0f4f2afaa8c4256460e696c1b46cfab985",
  evidenceDirectory: process.env.TOONSPECTRUM_INKWASH_ORACLE_EVIDENCE ?? null,
  viewportWidth: 512,
  viewportHeight: 384,
  lineWashHeightExpansion: 78,
  washDifferenceMean: 54.59905716318946,
  paperLuminanceStandardDeviation: 3.5975805982535674,
});
const CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; "
  + "img-src 'self' data: blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'";

/**
 * One lane per shipped backend. `--use-angle=metal` plus `--enable-unsafe-webgpu` is the same
 * launch recipe the Vello gpu-browser probe uses to obtain a real adapter on this platform; the
 * WebGL2 lane explicitly disables WebGPU as an adversarial check: the query still selects WebGL2,
 * and a WebGPU lane cannot succeed by executing GLSL when its selected adapter/runtime fails.
 */
const BACKEND_LANES = Object.freeze([
  Object.freeze({
    id: "webgl2",
    label: "WebGL2 half-float GLSL runtime",
    blocking: true,
    expectedBackend: "real-chromium-dedicated-worker-offscreen-webgl2-half-float-v1",
    launchArguments: Object.freeze(["--no-sandbox", "--disable-features=WebGPU"]),
  }),
  Object.freeze({
    id: "webgpu",
    label: "WebGPU WGSL field runtime",
    blocking: false,
    expectedBackend: "real-chromium-dedicated-worker-offscreen-webgpu-half-float-v1",
    launchArguments: Object.freeze([
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=WebGPU",
      "--use-angle=metal",
    ]),
  }),
]);

/**
 * Recorded parity gap for the non-blocking WGSL lane, as a ratchet rather than an exemption.
 * Nothing here relaxes a threshold: the WGSL runtime is measured against exactly the same gates as
 * GLSL, and the run fails if the observed gap differs from this list in either direction — a new
 * regression, or a gate that started passing and was not removed from the record.
 *
 * **It is empty. The WGSL field runtime passes every gate the GLSL runtime passes.**
 *
 * Keeping the mechanism (and this note) after reaching parity is the point: an empty list means any
 * WGSL regression now fails the run outright, and the history below is what a reader needs to
 * recognise the two failure shapes this lane has already produced once.
 *
 * The first measured run recorded nineteen entries with a single cause: the WGSL display buffer was
 * allocated with `MAP_READ | STORAGE | …`, which WebGPU forbids, so the buffer was invalid from
 * allocation, the `display` pass's bind group was rejected, and the Beer-Lambert resolve never ran.
 * Every readback was zeros — which is why the receipt agreed with the screen and no hash-based
 * check objected: both sides were hashing the same blank.
 *
 * Fixing that left fifteen, and they were not one bug either. Two were gates a blank frame had
 * satisfied vacuously; twelve were real content differences, because the WGSL display resolve was a
 * bare `exp(-density)` with no paper fibre, granulation, edge deposition, near-black floor or wash
 * calibration, and the field kernels had lost the anisotropic capillary stencil, the Deegan
 * compressibility term and the white-gouache bleaching exchange; one was a harness assertion that
 * hard-coded the WebGL2 backend and so could never be satisfied on this lane.
 *
 * Those are all closed. Two lessons are worth carrying, because both defects were *invisible* to a
 * green-looking run:
 *
 * 1. A WGSL reserved word in a declaration (`from: vec2f`) does not throw. `createComputePipeline`
 *    returns an invalid pipeline and every dispatch against it is silently dropped, so the runtime
 *    computes nothing while still presenting a plausible frame.
 * 2. A historical WebGPU factory could execute WebGL2 while stamping a WebGPU capability. Provider
 *    selection is now explicit in the initialize request, the factory is WebGPU-only, and both the
 *    provider and this harness reject a receipt whose backend differs from that selection.
 */
const WEBGPU_RECORDED_PARITY_GAP = Object.freeze([]);


function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a Living Ink QA port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function html() {
  const cards = [
    ["line", "Ink line"],
    ["long-stroke", "Continuous capsule seam gate"],
    ["self-intersection", "Bounded self intersection"],
    ["bloom", "Water bloom"],
    ["water-field", "Water field"],
    ["flow-field", "Velocity field"],
    ["radial-wash", "Isolated capillary wash"],
    ["fixed-before", "Fixed before scrub"],
    ["fixed-after", "Fixed after scrub"],
    ["selection", "Asymmetric partial clear"],
    ["clear", "Clear"],
    ["white-layer", "White fixed over dark"],
    ["dark-over-white", "Dark over fixed white"],
    ["cancel-recovery", "Cancelled fix rollback"],
  ].map(([id, label]) => `<section class="card" id="${id}-card"><h2>${label}</h2><canvas id="${id}" width="256" height="160"></canvas></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Living Ink execution QA</title><style>
*{box-sizing:border-box}body{margin:0;padding:18px;background:#111827;color:#f9fafb;font:13px system-ui,sans-serif}
h1{margin:0 0 16px;font-size:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{padding:10px;border:1px solid #374151;border-radius:12px;background:#1f2937}h2{margin:0 0 8px;font-size:13px}
canvas{display:block;width:100%;height:auto;border-radius:8px;background:#f7f3ea;image-rendering:auto}
</style></head><body><h1>ToonSpectrum Living Ink · actual Worker GPU gate (WebGL2 and WebGPU lanes)</h1><main class="grid">${cards}</main>
<script type="module" src="${ENTRY}"></script></body></html>`;
}

function writeJson(name, value) {
  writeFileSync(join(EVIDENCE_ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function validate(result, diagnostics, lane) {
  const failures = [];
  if (result?.status !== "ok") return [`browser harness failed: ${result?.message ?? "unknown"}`];
  if (result.backend !== lane.expectedBackend) {
    failures.push(
      `actual Worker backend identity missing: lane ${lane.id} ran ${result.backend} `
      + `instead of ${lane.expectedBackend}`,
    );
  }
  const contract = result.executionContract ?? {};
  if (
    !contract.worker
    || !contract.offscreenCanvas
    || !contract.gpuApi
    || !contract.halfFloatFields
    || !contract.rgba8Readback
  ) failures.push("execution capability contract is incomplete");
  const readback = contract.readbackProvenance ?? {};
  const expectedReadback = lane.id === "webgpu"
    ? {
        orientation: "top-left-row-major",
        format: "rgba32float-storage-buffer-to-rgba8",
      }
    : {
        orientation: "webgl-bottom-left-row-major",
        format: "rgba8-staging-fbo",
      };
  if (
    readback.orientation !== expectedReadback.orientation
    || readback.format !== expectedReadback.format
  ) failures.push("backend receipt reported contradictory readback provenance");
  if (!result.line?.normalizedDisplayHashMatchesReceipt) {
    failures.push("receipt-oriented RGBA8 readback did not normalize to the displayed ImageBitmap");
  }
  const deferred = result.deferredPresentation ?? {};
  if (
    deferred.operationCount !== 81
    || deferred.appliedAckCount !== 81
    || deferred.ackReadbackCount !== 0
    || deferred.ackImageBitmapCount !== 0
    || deferred.explicitPresentationFrames !== 1
    || deferred.presentEveryOperationFrames !== 81
    || deferred.finalRevision !== 81
    || !deferred.endpointExact
  ) failures.push("simulation ACK batching dropped input, performed an intermediate readback/bitmap, or changed the exact endpoint");
  if (result.line?.darkness <= 1 || result.line?.bounds?.width < 160) {
    failures.push("ink line is blank or truncated");
  }
  if (
    result.bloom?.receipt?.displaySha256 === result.line?.receiptHash
    || result.bloom?.bounds?.width < result.line?.bounds?.width * 0.8
  ) failures.push("water did not evolve a visible retained bloom");
  if (!result.fixedInvariant?.exact) failures.push("fixed pigment changed under water scrub/advance");
  const selection = result.selection ?? {};
  if (
    selection.fullTopMiddleLightening <= selection.partialTopLeftLightening
    || selection.partialTopLeftLightening <= selection.untouchedTopRightLightening + 0.1
  ) failures.push("non-symmetric partial-alpha selection clear is not ordered correctly");
  if (Math.abs(selection.untouchedBottomLightening) >= 0.1) failures.push("selection Y orientation cleared or painted the wrong half");
  if (result.clearDarkness >= 20) failures.push("clear did not return to paper");
  if (result.layering?.darkOverWhiteCenterDarkness <= result.layering?.whiteCenterDarkness + 1) {
    failures.push("white-fix-dark transmittance layering did not darken in order");
  }
  if (!result.cancelRecovery?.rejected || !result.cancelRecovery?.exact) {
    failures.push("cancelled fixation did not rollback exactly before the next render");
  }
  if (!result.deterministicReplay?.sameRuntimeClassExact || result.deterministicReplay?.crossDeviceBitExactClaimed) {
    failures.push("same-runtime replay truth or cross-device determinism truth is wrong");
  }
  if (result.performance?.maximumMainThreadDelayMilliseconds > 80) {
    failures.push(`main-thread delay exceeded Worker isolation budget: ${result.performance.maximumMainThreadDelayMilliseconds}`);
  }
  if (result.performance?.maximumInteractiveWorkerMilliseconds > 1_500) {
    failures.push(`interactive GPU operation exceeded fail-closed budget: ${result.performance.maximumInteractiveWorkerMilliseconds}`);
  }
  const quality = result.visualQuality ?? {};
  const scaledOracleExpansion = INKWASH_ORACLE.lineWashHeightExpansion
    * ((result.viewport?.height ?? 0) / INKWASH_ORACLE.viewportHeight);
  if (quality.lineWashHeightExpansion < scaledOracleExpansion) {
    failures.push(
      `watercolour bloom expansion ${quality.lineWashHeightExpansion} is below oracle-relative ${scaledOracleExpansion}`,
    );
  }
  if (quality.wetSheenAndBloomDifference < INKWASH_ORACLE.washDifferenceMean) {
    failures.push(
      `watercolour wash difference ${quality.wetSheenAndBloomDifference} is below oracle ${INKWASH_ORACLE.washDifferenceMean}`,
    );
  }
  if (quality.paperLuminanceStandardDeviation < INKWASH_ORACLE.paperLuminanceStandardDeviation) {
    failures.push(
      `paper texture stddev ${quality.paperLuminanceStandardDeviation} is below oracle ${INKWASH_ORACLE.paperLuminanceStandardDeviation}`,
    );
  }
  if (
    quality.fiberGranulationResidual < 2
    || quality.isolatedBloomGranulationResidual < 1.5
  ) failures.push("watercolour granulation is below the reviewed visible-texture floor");
  if (!(quality.bloomEdgeConcentration >= 70 && quality.bloomEdgeConcentration <= 210)) {
    failures.push("watercolour edge deposition is flat or clipped into an artificial hard rim");
  }
  const radial = quality.isolatedBloomRadialShape ?? {};
  if (
    radial.angularCoverage < 0.95
    || radial.coefficientOfVariation > 0.22
    || radial.maximumAdjacentJumpRatio > 0.2
    || radial.normalizedHighFrequencyEdgeCurvature > 0.18
  ) failures.push("isolated wash has a spoke, facet, folded wedge or discontinuous radial edge");
  if (!(radial.dominantLobeCount >= 2 && radial.dominantLobeCount <= 4)) {
    failures.push("isolated wash did not settle into two to four smooth capillary lobes");
  }
  const asymmetry = quality.isolatedBloomAsymmetry ?? {};
  if (
    !(asymmetry.leftRightMirrorResidual >= 0.1 && asymmetry.leftRightMirrorResidual <= 0.8)
    || !(asymmetry.topBottomMirrorResidual >= 0.1 && asymmetry.topBottomMirrorResidual <= 0.8)
    || !(Math.abs(asymmetry.centroidOffsetY) >= 1 && Math.abs(asymmetry.centroidOffsetY) <= 12)
  ) failures.push("isolated wash is mirror-symmetric or has collapsed into unbounded random drift");
  if (!(quality.isolatedBloomAspectRatio >= 1 && quality.isolatedBloomAspectRatio <= 1.35)) {
    failures.push("isolated wash collapsed into a square or strongly biased ellipse");
  }
  if (
    quality.centralWashBandToMaximumRatio < 0.45
    || quality.minimumWashBandToMaximumRatio < 0.22
  ) failures.push("watercolour line wash has a detached center lump or loses continuity at its shoulders");
  if (
    quality.isolatedBloomRimMinusCenterDarkness < -15
    || quality.isolatedBloomRimMinusCenterDarkness > 28
  ) failures.push("isolated wash has a central ink dot or an artificial hollow ring");
  if (
    quality.redBlueCentroidSeparationPixels < 0.15
    || quality.redBlueCentroidSeparationPixels > 8
  ) failures.push("chromatic separation is absent or exaggerated into a rainbow fringe");
  const continuous = quality.continuousCapsule ?? {};
  if (
    continuous.normalizedHighFrequencyResidual > 0.08
    || continuous.maximumAdjacentJumpRatio > 0.22
    || !(continuous.startEndToInteriorRatio >= 0.65 && continuous.startEndToInteriorRatio <= 1.3)
    || continuous.minimumToMedianRatio < 0.55
  ) failures.push("continuous capsule exposes periodic dab seams, gaps, or start/end bulbs");
  if (!(quality.selfIntersectionLuminanceRatio >= 0.72 && quality.selfIntersectionLuminanceRatio <= 1.35)) {
    failures.push("self-intersection erases pigment or accumulates an unbounded dark knot");
  }
  if (quality.whiteCenterLuminanceDeltaFromPaper > 3) {
    failures.push("white gouache does not converge to paper reflectance in the isolated coverage gate");
  }
  if (
    !result.persistedJournalReload?.whiteExact
    || !result.persistedJournalReload?.darkOverWhiteExact
  ) failures.push("fresh-Worker JSON journal replay changed white/dark optical layering");
  if (!result.nearBlackReflectanceParity?.exact) {
    failures.push("near-black reflectance floor is not deterministic");
  }
  if (result.fixedInvariant?.maximumRgbDifference !== 0) {
    failures.push("fixed pigment changed by at least one RGB code value under water");
  }
  if (
    !result.workerCrashRecovery?.rejectedImmediately
    || !result.workerCrashRecovery?.reinitialized
    || result.workerCrashRecovery?.workerInstances < 2
    || !result.workerCrashRecovery?.postCrashFrameHash
  ) failures.push("actual Chromium Worker crash did not reject the epoch and recover on a fresh Worker");
  if (
    diagnostics.consoleErrors.length
    || diagnostics.consoleWarnings.length
    || diagnostics.pageErrors.length
    || diagnostics.requestFailures.length
  ) failures.push("Chromium emitted console/page/network diagnostics");
  return failures;
}

async function runLane(lane, port) {
  const laneDirectory = join(EVIDENCE_ROOT, lane.id);
  mkdirSync(laneDirectory, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: [...lane.launchArguments] });
  } catch (error) {
    return {
      id: lane.id,
      label: lane.label,
      blocking: lane.blocking,
      status: "unavailable",
      reason: `Chromium could not launch for lane ${lane.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      failures: [],
      result: null,
      diagnostics: null,
    };
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1_120, height: 900 } });
    const diagnostics = {
      browserVersion: browser.version(),
      launchArguments: [...lane.launchArguments],
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
    page.on("requestfailed", (request) => diagnostics.requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
    ));
    await page.goto(
      `http://127.0.0.1:${port}${HARNESS_PATH}?backend=${encodeURIComponent(lane.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(
      () => window.__studioLivingInkExecutionResult !== undefined,
      undefined,
      { timeout: TIMEOUT_MS },
    );
    const result = await page.evaluate(() => window.__studioLivingInkExecutionResult);
    writeJson(join(lane.id, "metrics.json"), result);
    writeJson(join(lane.id, "browser-diagnostics.json"), diagnostics);
    for (const id of ["line", "long-stroke", "self-intersection", "bloom", "water-field", "flow-field", "radial-wash", "selection", "white-layer", "dark-over-white", "cancel-recovery"]) {
      await page.locator(`#${id}-card`).screenshot({ path: join(laneDirectory, `${id}.png`) });
    }
    await page.screenshot({ path: join(laneDirectory, "living-ink-full.png"), fullPage: true });
    const failures = validate(result, diagnostics, lane);
    return {
      id: lane.id,
      label: lane.label,
      blocking: lane.blocking,
      status: failures.length ? "failed" : "ok",
      reason: null,
      failures,
      result,
      diagnostics,
    };
  } finally {
    await browser.close();
  }
}

function laneSummary(lane, result) {
  return {
    id: lane.id,
    label: lane.label,
    blocking: lane.blocking,
    status: lane.status,
    reason: lane.reason,
    backend: result?.backend ?? null,
    capabilities: result?.capabilities ?? null,
    executionContract: result?.executionContract ?? null,
    launchArguments: lane.diagnostics?.launchArguments ?? null,
    lineBounds: result?.line?.bounds ?? null,
    bloomBounds: result?.bloom?.bounds ?? null,
    fixedInvariant: result?.fixedInvariant?.exact ?? false,
    cancelRollback: result?.cancelRecovery?.exact ?? false,
    deterministicReplay: result?.deterministicReplay?.sameRuntimeClassExact ?? false,
    deferredPresentation: result?.deferredPresentation ?? null,
    visualQuality: result?.visualQuality ?? null,
    persistedJournalReload: result?.persistedJournalReload ?? null,
    nearBlackReflectanceParity: result?.nearBlackReflectanceParity ?? null,
    workerCrashRecovery: result?.workerCrashRecovery ?? null,
    performance: result?.performance ?? null,
    failures: lane.failures,
  };
}

/**
 * The WGSL lane is measured against the same gates but does not block on its own failures; it
 * blocks on *changes* to the recorded gap. That keeps the second backend genuinely gated — it can
 * neither regress unnoticed nor stay broken once someone repairs it — without pretending the two
 * runtimes are already at parity.
 */
function parityVerdict(lane) {
  if (!lane || lane.status === "unavailable") {
    return {
      status: "unavailable",
      reason: lane?.reason ?? "WebGPU lane did not run",
      unresolvedGates: [],
      regressedGates: [],
      repairedGates: [],
      recordedGap: [...WEBGPU_RECORDED_PARITY_GAP],
    };
  }
  const observed = [...lane.failures].sort();
  const recorded = [...WEBGPU_RECORDED_PARITY_GAP].sort();
  const regressedGates = observed.filter((entry) => !recorded.includes(entry));
  const repairedGates = recorded.filter((entry) => !observed.includes(entry));
  return {
    status: observed.length === 0 ? "reached" : "blocked",
    reason: observed.length === 0
      ? "the WGSL field runtime passes every gate the GLSL runtime passes"
      : "the WGSL field runtime does not yet match the GLSL runtime on these gates",
    unresolvedGates: observed,
    regressedGates,
    repairedGates,
    recordedGap: recorded,
  };
}

async function main() {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const port = await freePort();
  const vite = await createViteServer({
    appType: "custom",
    configFile: WEB_VITE_CONFIG,
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
    plugins: [{
      name: "studio-living-ink-execution-verifier",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?", 1)[0] !== HARNESS_PATH) return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Content-Security-Policy", CSP);
          response.setHeader("Cache-Control", "no-store");
          response.end(html());
        });
      },
    }],
  });
  await vite.listen();
  try {
    const lanes = [];
    for (const lane of BACKEND_LANES) lanes.push(await runLane(lane, port));
    const certified = lanes.find((lane) => lane.blocking);
    const webgpu = lanes.find((lane) => lane.id === "webgpu");
    const parity = parityVerdict(webgpu);
    const failures = [...(certified?.failures ?? ["certified WebGL2 lane did not run"])];
    // A second backend nobody can measure is the state this runner exists to end.
    if (parity.status === "unavailable") {
      failures.push(`WebGPU lane was never executed, so the WGSL runtime stayed unverified: ${parity.reason}`);
    }
    if (parity.regressedGates.length) {
      failures.push(`WebGPU lane regressed on gates outside the recorded gap: ${parity.regressedGates.join("; ")}`);
    }
    if (parity.repairedGates.length) {
      failures.push(`WebGPU lane now passes recorded-gap gates; remove them from WEBGPU_RECORDED_PARITY_GAP: ${parity.repairedGates.join("; ")}`);
    }
    const summary = {
      status: failures.length ? "failed" : "ok",
      // Retained for readers that only look at the certified lane.
      backend: certified?.result?.backend ?? null,
      lineBounds: certified?.result?.line?.bounds ?? null,
      bloomBounds: certified?.result?.bloom?.bounds ?? null,
      fixedInvariant: certified?.result?.fixedInvariant?.exact ?? false,
      cancelRollback: certified?.result?.cancelRecovery?.exact ?? false,
      deterministicReplay: certified?.result?.deterministicReplay?.sameRuntimeClassExact ?? false,
      deferredPresentation: certified?.result?.deferredPresentation ?? null,
      oracle: {
        ...INKWASH_ORACLE,
        scaledLineWashHeightExpansion:
          INKWASH_ORACLE.lineWashHeightExpansion
          * ((certified?.result?.viewport?.height ?? 0) / INKWASH_ORACLE.viewportHeight),
      },
      visualQuality: certified?.result?.visualQuality ?? null,
      persistedJournalReload: certified?.result?.persistedJournalReload ?? null,
      nearBlackReflectanceParity: certified?.result?.nearBlackReflectanceParity ?? null,
      workerCrashRecovery: certified?.result?.workerCrashRecovery ?? null,
      performance: certified?.result?.performance ?? null,
      backends: Object.fromEntries(lanes.map((lane) => [lane.id, laneSummary(lane, lane.result)])),
      webgpuVisualParity: parity,
      failures,
      evidenceDirectory: EVIDENCE_ROOT,
    };
    writeJson("summary.json", summary);
    writeFileSync(PROBE_RESULTS_PATH, `${JSON.stringify({
      generatedBy: "scripts/verify-studio-living-ink-execution.mjs",
      note:
        "Per-backend numbers for the actual-Chromium Living Ink probe. The WebGL2 lane is the "
        + "certified blocking gate; the WebGPU lane runs the identical harness so the WGSL field "
        + "runtime is measured on a real adapter instead of being shipped unverified.",
      status: summary.status,
      webgpuVisualParity: parity,
      // Wall-clock timings live in the evidence directory only; they would churn this file on
      // every run and hide the numbers a reviewer actually diffs.
      backends: Object.fromEntries(
        Object.entries(summary.backends).map(([id, lane]) => [
          id,
          Object.fromEntries(Object.entries(lane).filter(([key]) => key !== "performance")),
        ]),
      ),
    }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await vite.close();
  }
}

main().catch((error) => {
  const result = {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    evidenceDirectory: EVIDENCE_ROOT,
  };
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeJson("summary.json", result);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
