import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./studio-living-ink-webgl2-runtime.ts", import.meta.url), "utf8");
const webGpuRuntime = readFileSync(
  new URL("./studio-living-ink-webgpu-pure-runtime.ts", import.meta.url),
  "utf8",
);
const wgsl = readFileSync(new URL("./studio-living-ink-wgsl-shaders.ts", import.meta.url), "utf8");
// CPU reference solver + shared damping selector, split out of the WGSL library (2026-08-14) so
// the route-side settled bake stops dragging the compute-kernel sources into the studio chunk.
const fluidReference = readFileSync(
  new URL("./studio-living-ink-fluid-reference.ts", import.meta.url),
  "utf8",
);
const worker = readFileSync(new URL("./studio-living-ink.worker.ts", import.meta.url), "utf8");
const provider = readFileSync(new URL("./studio-living-ink-provider.ts", import.meta.url), "utf8");
const validation = readFileSync(
  new URL("./studio-living-ink-execution-validation.ts", import.meta.url),
  "utf8",
);
const browserGate = readFileSync(
  new URL("../../../../../scripts/studio-living-ink-execution-browser.ts", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../../../scripts/verify-studio-living-ink-execution.mjs", import.meta.url),
  "utf8",
);

describe("Living Ink actual execution boundary", () => {
  it("owns reviewed half-float physics and an RGBA8 readback authority", () => {
    for (const token of [
      "gl.RGBA16F",
      "gl.RG16F",
      "gl.R16F",
      "VELOCITY_FRAGMENT",
      "VORTICITY_FRAGMENT",
      "PRESSURE_FRAGMENT",
      "WET_FRAGMENT",
      "PIGMENT_FRAGMENT",
      "EXCHANGE_FRAGMENT",
      "DISPLAY_FRAGMENT",
      "createDisplaySurface",
      "rgba8-staging-fbo",
    ]) expect(runtime).toContain(token);
    expect(runtime).not.toContain("Math.random");
    expect(runtime).toContain("settlePressureIterations");
    expect(runtime).toContain("fixDurationSeconds");
  });

  it("ships InkWash §06 chromatography chemistry and brush-tip scrub bleed on the GPU path", () => {
    // Chemistry is computed in TS helpers and uploaded as uniforms — not re-derived only in GLSL.
    expect(runtime).toContain("studioLivingInkChromaBleedMultipliers");
    expect(runtime).toContain("studioLivingInkPigmentDiffusionRates");
    expect(runtime).toContain("chromaMultipliers");
    expect(runtime).toContain("separatedDiffusionQuiet");
    expect(runtime).toContain("separatedDiffusionTip");
    expect(runtime).toContain("mix(separatedDiffusionQuiet, separatedDiffusionTip, brush)");
    expect(runtime).toContain("uniform vec3 brushFootprint");
    expect(runtime).toContain("clearBrushFootprint");
    expect(runtime).toContain("0.16 * load");
    // Interactive path must not interleave a full fluid step every few marks (stutter).
    expect(runtime).not.toContain("interleaved-wash-step");
    expect(runtime).toContain("paper * exp(-opticalDensity)");
    expect(runtime).toContain("bleachCoverage");
    // Ghost tip must not survive pen-up into settle/advance/fix ticks.
    expect(runtime).toContain("this.clearBrushFootprint()");
    const clearAfterDeposit = runtime.indexOf("this.clearBrushFootprint()");
    const settleLoop = runtime.indexOf("for (let tick = 0; tick < ticks; tick += 1)");
    expect(clearAfterDeposit).toBeGreaterThan(0);
    expect(settleLoop).toBeGreaterThan(clearAfterDeposit);
  });

  it("keeps continuous Gaussian segments, selection orientation and ping-pong identity explicit", () => {
    expect(runtime).toContain("float along = clamp");
    expect(runtime).toContain("private syncDoubleDirty");
    // Jacobi mid-loop sync was removed for interactive perf; remaining syncs still cover parity.
    expect(runtime.match(/this\.syncDoubleDirty\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(runtime).toContain("this.advanceDirtyHalo();");
    expect(runtime).toContain("height - 1 - (selection.bounds.y + row)");
    expect(runtime).toContain("if (!selection && this.selectionTextureHasFullCoverage) return false;");
    expect(runtime).toContain("this.selectionTextureHasFullCoverage = selection === null;");
    expect(runtime).toContain("accepted = clamp(settle * coverage");
    expect(runtime).toContain("strokeDeposit");
    expect(runtime).toContain("MERGE_DEPOSIT_FRAGMENT");
    expect(runtime).toContain("startAmount");
    expect(runtime).toContain("startRadius");
    expect(runtime).toContain("continuous-stroke-deposit-merge");
    expect(runtime).not.toContain("gl.blendEquation");
  });

  it("preserves the reviewed 1.2 second Fix evolution while isolating fixed pigment from Water", () => {
    const mobileDilution = runtime.indexOf("mobileContribution.rgb *= 1.0 - saturatedCenterDilution");
    const fixedComposition = runtime.indexOf(
      "combined = fixedContribution + mobileContribution",
      mobileDilution,
    );
    expect(mobileDilution).toBeGreaterThan(0);
    expect(fixedComposition).toBeGreaterThan(mobileDilution);
    expect(runtime).toContain("fixedOpticalDensity *= 1.0 + fixedPigmentEdge * edgeAmount * 0.65");
    expect(runtime).toContain("dryingFront * mobileCenterDensity");
    expect(runtime).toContain("STUDIO_LIVING_INK_EXECUTION_LIMITS.fixDurationSeconds");
    expect(runtime).toContain("operation.kind === \"fix\"");
    expect(runtime).not.toContain("fullyFixed");
    expect(runtime).not.toContain("operation.kind === \"fix\") ticks = 0");
    expect(browserGate).toContain('await render(fixProvider, "fixed-pigment", "fixed-before")');
    expect(browserGate).toContain('await render(fixProvider, "fixed-pigment", "fixed-after")');
    expect(browserGate).toContain("maximumRgbDifference(fixedBefore.image, fixedAfter.image)");
    expect(verifier).toContain("fixed pigment changed under water scrub/advance");
    expect(verifier).toContain("result.fixedInvariant?.maximumRgbDifference !== 0");
  });

  it("damps release-settle velocity without activating fixation chemistry in either backend", () => {
    for (const source of [runtime, webGpuRuntime]) {
      expect(source).toContain(
        'const velocitySettling = operation.kind === "advance" && quality === "settle";',
      );
    }
    expect(runtime).toMatch(
      /operation\.kind === "fix",\s+pressureIterations,\s+velocitySettling,/,
    );
    expect(webGpuRuntime).toContain(
      'this.step(operation.kind === "fix", pressureIterations, velocitySettling)',
    );
    expect(runtime).toContain(
      "studioLivingInkVelocityDampingForStep(\n        material.flow,\n        dt,\n        fixing,\n        velocitySettling,",
    );
    expect(runtime).toContain("if (fixing) {");
    expect(runtime).toContain("Math.exp(-dt / (fixing ? 0.25 : dryWindow))");
    expect(webGpuRuntime).toContain("fixTransfer: fixing ? 1 - Math.exp(-dt * 5) : 0");
    expect(webGpuRuntime).toContain("if (fixing) {");
    // The selector is defined once, in the shader-free CPU reference leaf …
    expect(fluidReference).toContain(
      "STUDIO_LIVING_INK_RELEASE_VELOCITY_DAMPING_RATE_PER_SECOND = 60",
    );
    expect(fluidReference).toContain(
      "if (fixing) return studioLivingInkVelocityDamping(flow, dt, true)",
    );
    // … and the WGSL library consumes and re-exports that single copy (uniform slot 12), so the
    // GPU backends and the CPU reference cannot drift into two different retention curves.
    expect(wgsl).toContain("studioLivingInkVelocityDampingForStep(");
    expect(wgsl).toContain(
      'import { studioLivingInkVelocityDampingForStep } from "./studio-living-ink-fluid-reference"',
    );
    expect(wgsl).toContain(
      "studioLivingInkEvaporationMultiplier(input.dryRate, input.dt, input.fixing)",
    );
  });

  it("gates organic wash quality and continuous-stroke artifacts against actual pixels", () => {
    for (const token of [
      "normalizedHighFrequencyEdgeCurvature",
      "continuousCapsule",
      "selfIntersectionLuminanceRatio",
      "minimumWashBandToMaximumRatio",
      "whiteCenterLuminanceDeltaFromPaper",
      "workerCrashRecovery",
      "isolatedBloomAsymmetry",
      "deferredPresentation",
    ]) expect(browserGate).toContain(token);
    expect(verifier).toContain("INKWASH_ORACLE");
    expect(verifier).toContain("watercolour bloom expansion");
    expect(verifier).toContain("continuous capsule exposes periodic dab seams");
    expect(verifier).toContain("actual Chromium Worker crash");
    expect(verifier).toContain("two to four smooth capillary lobes");
    expect(verifier).toContain("simulation ACK batching dropped input");
  });

  it("empties the centre of a dwell wash through the divergence of its own capillary flow", () => {
    // A dwell mark's outflow is divergent by construction, so the pressure-projected velocity
    // field cannot carry it and semi-Lagrangian value advection cannot express its dilution. The
    // pigment pass therefore has to scale density by the divergence of the displacement it uses,
    // or the mark dries as an ink dot with its darkest point dead centre.
    expect(runtime).toContain("capillaryBacktrace");
    expect(runtime).toContain("frontCurvature");
    expect(runtime).toContain("wetSecondDerivativeAlongNormal");
    expect(runtime).toContain("displacementDivergence");
    // Both halves of div(A*n) must be present: geometric spreading empties the interior and the
    // along-flow slowdown deposits that pigment into the drying rim. Keeping only the first is a
    // pigment sink that bleaches every wash.
    expect(runtime).toContain("mobility * frontCurvature");
    expect(runtime).toContain("mobilitySlope * wetGradientStrength");
    expect(verifier).toContain("central ink dot or an artificial hollow ring");
  });

  it("gates both shipped GPU backends instead of whichever one the launch flags selected", () => {
    // Each browser lane explicitly selects one provider. Launch flags only make it available.
    expect(verifier).toContain("BACKEND_LANES");
    expect(verifier).toContain("?backend=${encodeURIComponent(lane.id)}");
    expect(verifier).toContain("--enable-unsafe-webgpu");
    expect(verifier).toContain("--use-angle=metal");
    expect(verifier).toContain("--disable-features=WebGPU");
    expect(verifier).toContain("real-chromium-dedicated-worker-offscreen-webgpu-half-float-v1");
    expect(verifier).toContain("webgpuVisualParity");
    // The WGSL gap is a ratchet, not an exemption: the run fails when the observed gap grows *or*
    // shrinks without the record being updated, so neither a regression nor a repair can pass
    // unnoticed. No threshold is per-backend.
    expect(verifier).toContain("WEBGPU_RECORDED_PARITY_GAP");
    expect(verifier).toContain("regressedGates");
    expect(verifier).toContain("repairedGates");
    /*
     * Backend identity has to come from the receipt of an operation that actually ran, not from a
     * literal and not from the capability record.
     *
     * The provider rejects a capability or receipt from any backend other than the query-selected
     * one, and the receipt remains the final witness of the runtime that actually produced pixels.
     */
    expect(browserGate).toContain("lineReceiptBackend = lineFrame.receipt.backend");
    expect(browserGate).toContain('lineReceiptBackend === "webgpu-offscreen-half-float"');
    expect(browserGate).toContain("await bloomProvider.initialize()");
    expect(browserGate).toContain("selectedProviderOptions");
    expect(worker).toContain("createSelectedRuntime");
    expect(worker).not.toContain("createPreferredRuntime");
    expect(verifier).not.toContain('backend !== "real-chromium-dedicated-worker-offscreen-webgl2');
  });

  it("serializes all input and rolls failed or cancelled mutations back before acknowledgement", () => {
    expect(worker).toContain("queue = queue.then(() => handle(request), () => handle(request))");
    expect(worker).toContain("await rebuildAcceptedJournal();");
    expect(worker).toContain("rollback failed and the runtime was sealed unavailable");
    expect(worker).toContain("queuedApplyRequests");
    expect(worker).toContain("cancelAcknowledgements");
    expect(worker).toContain("{ ...entry.options, present: false }");
    expect(worker).toContain('applied.kind !== "living-ink/applied"');
  });

  it("applies every coalesced operation while deferring presentation and strictly parses persisted input", () => {
    expect(runtime).toContain("options.present === false");
    expect(runtime).toContain('kind: "living-ink/applied"');
    expect(runtime).toContain("displayReadbackCount: 0");
    expect(runtime).toContain("imageBitmapCount: 0");
    expect(provider).toContain('response.type !== "living-ink/applied"');
    expect(worker).toContain("parseStudioLivingInkExecutionOperation");
    expect(worker).toContain("parseStudioLivingInkExecutionApplyOptions");
    expect(validation).toContain("parseStudioLivingInkExecutionSelection");
    expect(validation).toContain("coverage.length !== expected");
    expect(validation).not.toContain("Math.random");
  });

  it("closes invalid/stale frames and states the GPU determinism boundary truthfully", () => {
    expect(provider).toContain("validFrameResponse");
    expect(provider).toContain("response.frame.image.close()");
    expect(provider).toContain("failedWorker?.terminate()");
    expect(provider).toContain("worker.onerror");
    expect(runtime).toContain('determinism: "same-runtime-replay"');
    expect(runtime).toContain("crossDeviceBitExact: false");
    expect(runtime).toContain('displayReadbackOrientation: "webgl-bottom-left-row-major"');
    expect(webGpuRuntime).toContain('displayReadbackOrientation: "top-left-row-major"');
    expect(webGpuRuntime).toContain('readbackFormat: "rgba32float-storage-buffer-to-rgba8"');
    expect(provider).toContain("isStudioLivingInkExecutionReadbackProvenance(receipt)");
    expect(browserGate).toContain("receiptOrientedHash");
    expect(browserGate).toContain("normalizedDisplayHashMatchesReceipt");
  });
});
