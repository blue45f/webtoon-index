import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVING_INK_FLUID_DEFAULTS,
  STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS,
  STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY,
  studioLivingInkVelocityDamping,
} from "./studio-living-ink-execution-protocol";
import {
  createStudioLivingInkFluidReference,
  listStudioLivingInkWgslDeclaredIdentifiers,
  listStudioLivingInkWgslPassSources,
  studioLivingInkWgslDisplayModeCode,
  studioLivingInkWgslPassGrid,
  studioLivingInkWgslPassIsCoarse,
  studioLivingInkWgslSourceForPass,
  studioLivingInkVelocityDampingForStep,
  stepStudioLivingInkFluidReference,
  STUDIO_LIVING_INK_RELEASE_VELOCITY_DAMPING_RATE_PER_SECOND,
  STUDIO_LIVING_INK_WGSL_GRANULATION_RESPONSE_GAIN,
  STUDIO_LIVING_INK_WGSL_COARSE_PASSES,
  STUDIO_LIVING_INK_WGSL_LEGACY_PASS_ORDER,
  STUDIO_LIVING_INK_WGSL_PASS_ORDER,
  STUDIO_LIVING_INK_WGSL_RESERVED_IDENTIFIERS,
  STUDIO_LIVING_INK_WGSL_SHADER_REVISION,
  STUDIO_LIVING_INK_WGSL_UNIFORM_WORDS,
  writeStudioLivingInkFieldUniforms,
} from "./studio-living-ink-wgsl-shaders";

const display = Object.freeze({
  displayWidth: 512,
  displayHeight: 256,
  densityStrength: 1.98,
  paperFiber: 0.5,
  paperTooth: 0.56,
  granulation: 0.42,
  edgeAmount: 1.188,
  wetSheen: 0.24,
  vignette: 0.12,
  seed: 77,
  displayMode: 0,
});

describe("studio-living-ink-wgsl-shaders", () => {
  it("ships a complete pure WGSL field pass set", () => {
    expect(STUDIO_LIVING_INK_WGSL_SHADER_REVISION).toContain("wgsl");
    // v1 contract, preserved: the original six passes are all still shipped, in the same relative
    // order. v2 interleaves the fluid passes between them rather than replacing any of them.
    expect(
      STUDIO_LIVING_INK_WGSL_PASS_ORDER.filter((pass) =>
        (STUDIO_LIVING_INK_WGSL_LEGACY_PASS_ORDER as readonly string[]).includes(pass),
      ),
    ).toEqual([...STUDIO_LIVING_INK_WGSL_LEGACY_PASS_ORDER]);
    for (const pass of listStudioLivingInkWgslPassSources()) {
      expect(pass.source).toContain("@compute");
      expect(pass.source).toContain("fn main");
      expect(pass.entryPoint).toBe("main");
      expect(studioLivingInkWgslSourceForPass(pass.id).length).toBeGreaterThan(80);
    }
  });

  it("embeds chromatography and beer-lambert knobs in field uniforms", () => {
    const pigment = studioLivingInkWgslSourceForPass("pigment");
    expect(pigment).toContain("chromaR");
    expect(pigment).toContain("bleed");
    const resolve = studioLivingInkWgslSourceForPass("display");
    expect(resolve).toContain("exp(-opticalDensity)");
  });

  /*
   * The WGSL display resolve used to be a bare `exp(-density)`: correct Beer-Lambert, and a dead
   * picture. It rendered pure white paper (measured stddev 0 against the GLSL oracle's 3.6) and ink
   * roughly thirty times too faint (0.67 against 22.8), because none of the watercolour model was
   * there. These assertions pin the ported elements by name so a future edit cannot quietly drop
   * one and leave WebGPU users with a visibly worse picture than WebGL2 users.
   */
  it("resolves the full watercolour display model, not a bare Beer-Lambert exponential", () => {
    const resolve = studioLivingInkWgslSourceForPass("display");
    // Paper: two-scale directional fibre, tooth, coarse tooth and micro tooth.
    expect(resolve).toContain("fn layeredFiber(");
    expect(resolve).toContain("vec3f(0.965, 0.956, 0.932)");
    expect(resolve).toContain("u.fiberAmount");
    expect(resolve).toContain("u.toothAmount");
    // Granulation: sediment modulation gated on centre density.
    expect(resolve).toContain("granulationMultiplier");
    expect(resolve).toContain("smoothstep(0.005, 0.24, centerDensity)");
    // Edge deposition: drying-front concentration, mobile-only.
    expect(resolve).toContain("dryingFront");
    expect(resolve).toContain("u.edgeAmount");
    // Capillary plume: rotated eight-tap kernel plus three deterministic lobes.
    expect(resolve).toContain("plumeRadius");
    expect(resolve).toContain("lobeOffsetC");
    expect(resolve).toContain("nearPlume * 2.76 + farPlume * 1.02 + lobePlume * lobeGain");
    // White gouache converges on paper reflectance rather than pure white.
    expect(resolve).toContain("vec3f(0.986, 0.982, 0.968)");
    expect(resolve).toContain("exp(-combined.w * 2.35)");
    // Wet sheen and vignette.
    expect(resolve).toContain("u.wetSheenAmount");
    expect(resolve).toContain("u.vignetteAmount");
  });

  it("maps directional paper physics from GLSL page space into the top-down WGSL grid", () => {
    const wet = studioLivingInkWgslSourceForPass("wet");
    expect(wet).toContain("let paperUv = vec2f(uv.x, 1.0 - uv.y);");
    expect(wet).toContain("let fibre = vec2f(pageFibre.x, -pageFibre.y);");

    const resolve = studioLivingInkWgslSourceForPass("display");
    expect(resolve).toContain("fn pageVectorToField(v: vec2f)");
    expect(resolve).toContain("(1.0 - uv.y) / fineTexel.y");
    expect(resolve).toContain("let axis = pageVectorToField(pageAxis);");
    expect(resolve).toContain("let plumeWarp = pageVectorToField(pagePlumeWarp);");
    expect(resolve).toContain("let lobeOffsetC = pageVectorToField(");
    expect(resolve).toContain("(1.0 - uv.y) * f32(u.displayHeight)");
    // A lone sign change on the mean drift is insufficient: every directed page-space vector has
    // to cross the same basis transform, while symmetric +/- taps remain symmetric afterwards.
    expect(resolve).not.toContain("let verticalDrift = -(");
  });

  it("compensates WebGPU resolve transfer without changing the sediment spectrum or gate", () => {
    expect(STUDIO_LIVING_INK_WGSL_GRANULATION_RESPONSE_GAIN).toBe(2.35);
    const resolve = studioLivingInkWgslSourceForPass("display");
    expect(resolve).toContain("sediment * u.granulationAmount\n        * 2.35 * granulationGate");
    expect(resolve).toContain("let sediment = (grain - 0.5) * 2.0 + (tooth - 0.5) * 0.7;");
    expect(resolve).toContain("smoothstep(0.005, 0.24, centerDensity)");
    expect(resolve).toContain(`let granulationMultiplier = clamp(`);
    expect(resolve).toContain(`${STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.minimum}`);
    expect(resolve).toContain(`${STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.maximum}.0`);
    expect(resolve).toContain("let opticalDensity = clamp(");
    expect(resolve).toContain(`vec3f(${STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY}.0)`);
  });

  it("branches display modes on the same ladder the GLSL resolve reads", () => {
    expect(studioLivingInkWgslDisplayModeCode("composite")).toBe(0);
    expect(studioLivingInkWgslDisplayModeCode("mobile-pigment")).toBe(1);
    expect(studioLivingInkWgslDisplayModeCode("fixed-pigment")).toBe(2);
    expect(studioLivingInkWgslDisplayModeCode("water")).toBe(3);
    expect(studioLivingInkWgslDisplayModeCode("flow")).toBe(4);
    const resolve = studioLivingInkWgslSourceForPass("display");
    expect(resolve).toContain("if (u.displayMode > 3.5)");
    expect(resolve).toContain("if (u.displayMode > 2.5)");
    // An isolated fixed-pigment view must drop mobile pigment entirely, which is what makes the
    // fixed well provably immutable under a later water scrub.
    expect(resolve).toContain("if (u.displayMode > 1.5) { return vec4f(0.0); }");
  });

  it("resolves on the display grid because the paper model is authored in display pixels", () => {
    expect(studioLivingInkWgslPassGrid("display")).toBe("display");
    expect(studioLivingInkWgslPassGrid("splat")).toBe("fine");
    expect(studioLivingInkWgslPassGrid("jacobi")).toBe("coarse");
    expect(studioLivingInkWgslSourceForPass("display")).toContain("u.displayWidth");
  });

  it("deposits through the same capsule kernel the GLSL splat uses", () => {
    const splat = studioLivingInkWgslSourceForPass("splat");
    expect(splat).toContain("mix(splat.startRadius, splat.radius, along)");
    expect(splat).toContain("mix(splat.startAmount, splat.endAmount, along)");
    expect(splat).toContain("exp(-splat.falloff * normalizedDistance)");
    // Max blend within a stroke, additive merge afterwards: a self-intersection must not
    // accumulate an unbounded dark knot.
    expect(splat).toContain("splat.maximumBlend > 0.5");
    expect(studioLivingInkWgslSourceForPass("merge-deposit")).toContain("+ max(deposit[i]");
    expect(studioLivingInkWgslSourceForPass("clear-masked"))
      .toContain("1.0 - clamp(selection[i].x, 0.0, 1.0)");
  });

  it("bounds fibre eccentricity while preserving the wet stencil's capillary area", () => {
    const wet = studioLivingInkWgslSourceForPass("wet");
    expect(wet).toContain("let geometricReach = sqrt(rawParallelReach * rawPerpendicularReach);");
    expect(wet).toContain("let maximumFibreRatio = 1.0 + u.fiberAmount * 1.2;");
    expect(wet).toContain("let axisScale = sqrt(fibreRatio);");
    expect(wet).toContain("geometricReach * axisScale");
    expect(wet).toContain("geometricReach / axisScale");
  });

  it("couples saturated-centre pigment dilution to bounded capillary outflow", () => {
    const resolve = studioLivingInkWgslSourceForPass("display");
    expect(resolve).toContain("let centerDilutionGain = 0.64 + u.capillaryCreep * 0.05;");
    expect(resolve).toContain(
      "let saturatedCenterDilution = smoothstep(0.3, 1.1, wetness) * centerDilutionGain;",
    );
  });

  /*
   * A selection clear has to reach velocity and pressure too, which live on the coarse grid. The
   * WGSL runtime used to clear only the three fine surfaces, so wash momentum survived inside a
   * cleared region and advected the next stroke laid there — a divergence from the certified GLSL
   * runtime that no gate caught, because the harness measures the cleared frame rather than what
   * the *following* stroke does.
   *
   * The coarse variant cannot index `selection[i]`: the mask is authored at pigment resolution and
   * a coarse index would read a fine cell from the top-left eighth of the field. It must resample,
   * which is what the GLSL twin gets for free from a `GL_LINEAR` fine selection texture sampled at
   * a coarse fragment's uv.
   */
  it("clears velocity and pressure under a selection by resampling the fine mask", () => {
    const coarse = studioLivingInkWgslSourceForPass("clear-masked-coarse");
    // Dispatched and indexed on the coarse grid...
    expect(coarse).toContain("if (gid.x >= u.coarseWidth || gid.y >= u.coarseHeight) { return; }");
    expect(coarse).toContain("let i = gid.y * u.coarseWidth + gid.x;");
    expect(studioLivingInkWgslPassGrid("clear-masked-coarse")).toBe("coarse");
    // ...while the mask is read bilinearly at fine resolution, never indexed by the coarse index.
    expect(coarse).toContain("fn sampleSelection(");
    expect(coarse).toContain("let cw = u.width;");
    expect(coarse).toContain("let ch = u.height;");
    expect(coarse).toContain("1.0 - clamp(sampleSelection(uv).x, 0.0, 1.0)");
    expect(coarse).not.toContain("selection[i]");
    // Same partial-alpha law as the fine twin: a half-covered cell keeps half of what it held.
    expect(coarse).toContain("field[i] = field[i] * keep;");
  });

  it("ships the incompressibility chain: divergence, Jacobi, gradient subtract", () => {
    for (const pass of ["divergence", "jacobi", "gradient"] as const) {
      expect(STUDIO_LIVING_INK_WGSL_PASS_ORDER).toContain(pass);
    }
    // Divergence must be the certified central difference and must land in the pressure cell's
    // source slot, otherwise the Jacobi sweep below relaxes against garbage.
    expect(studioLivingInkWgslSourceForPass("divergence"))
      .toContain("0.5 * (right - left + upper - lower)");
    // Poisson relaxation subtracts the source term; `+ c.y` here would grow divergence instead.
    expect(studioLivingInkWgslSourceForPass("jacobi"))
      .toContain("(l + r + d + uup - c.y) * 0.25");
    expect(studioLivingInkWgslSourceForPass("gradient"))
      .toContain("velocity[i].xy - 0.5 * vec2f(right - left, upper - lower)");
  });

  it("ships curl and vorticity confinement so washes keep their eddies", () => {
    const curl = studioLivingInkWgslSourceForPass("curl");
    expect(curl).toContain("0.5 * ((rightY - leftY) - (upperX - lowerX))");
    const vorticity = studioLivingInkWgslSourceForPass("vorticity");
    expect(vorticity).toContain("vec2f(upper - lower, right - left)");
    expect(vorticity).toContain("vec2f(ridge.x, -ridge.y) * centerCurl * u.vorticityStrength");
  });

  it("gates velocity and pigment mobility on wetness with smoothstep, not raw wetness", () => {
    expect(studioLivingInkWgslSourceForPass("advect-velocity"))
      .toContain("smoothstep(u.velocityWetGateMin, u.velocityWetGateMax, wetness)");
    expect(studioLivingInkWgslSourceForPass("pigment"))
      .toContain("smoothstep(u.pigmentWetGateMin, u.pigmentWetGateMax,");
  });

  it("runs velocity, pressure and curl on the coarse grid and pigment at full resolution", () => {
    for (const pass of STUDIO_LIVING_INK_WGSL_COARSE_PASSES) {
      expect(studioLivingInkWgslPassIsCoarse(pass)).toBe(true);
      expect(studioLivingInkWgslSourceForPass(pass)).toContain("u.coarseWidth");
    }
    for (const pass of ["splat", "wet", "pigment", "fix", "display"] as const) {
      expect(studioLivingInkWgslPassIsCoarse(pass)).toBe(false);
    }
    expect(listStudioLivingInkWgslPassSources().filter((pass) => pass.grid === "coarse"))
      .toHaveLength(STUDIO_LIVING_INK_WGSL_COARSE_PASSES.length);
  });

  /*
   * A WGSL reserved word in a declaration is the worst kind of shader bug, because nothing throws:
   * `createComputePipeline` hands back an *invalid* pipeline and every dispatch against it is
   * silently dropped. The runtime then computes nothing while still presenting a plausible frame,
   * and a historical WebGPU factory could then relabel a WebGL2 runtime after failed admission.
   * Explicit provider selection now rejects that substitution, while this test catches the shader
   * defect itself. Two shipped kernels (`splat` and `splat-velocity`, both declaring `from: vec2f`)
   * were dead exactly this way while the old visual gate reported near-parity.
   */
  it("declares no WGSL reserved word as an identifier", () => {
    const reserved = new Set(STUDIO_LIVING_INK_WGSL_RESERVED_IDENTIFIERS);
    for (const pass of listStudioLivingInkWgslPassSources()) {
      const offenders = listStudioLivingInkWgslDeclaredIdentifiers(pass.source)
        .filter((name) => reserved.has(name));
      expect(offenders, `pass ${pass.id}`).toEqual([]);
    }
  });

  it("scans declarations well enough to see a reserved word if one appears", () => {
    const declared = listStudioLivingInkWgslDeclaredIdentifiers(`
struct Splat {
  from: vec2f,
  radius: f32,
}
fn probe(point: vec2f) -> f32 {
  let along = point.x;
  var total = 0.0;
  return along + total;
}
`);
    expect(declared).toContain("from");
    expect(declared).toContain("radius");
    expect(declared).toContain("probe");
    expect(declared).toContain("point");
    expect(declared).toContain("along");
    expect(declared).toContain("total");
  });

  it("emits WGSL float literals rather than bare integers for interpolated constants", () => {
    // `3` is an AbstractInt in WGSL and `3.0.0` is a syntax error; both are compile failures the
    // Node suite cannot see, because it never runs a WGSL compiler.
    for (const pass of listStudioLivingInkWgslPassSources()) {
      expect(pass.source).not.toMatch(/\d+\.\d+\.\d/);
    }
    expect(studioLivingInkWgslSourceForPass("wet")).toContain("u.capillaryCreep * 1.6");
  });

  it("packs field uniforms in the slot order the WGSL struct declares", () => {
    const uniforms = writeStudioLivingInkFieldUniforms({
      width: 512,
      height: 256,
      coarseWidth: 128,
      coarseHeight: 64,
      dt: 1 / 60,
      bleed: 0.5,
      dryRate: 0.25,
      chroma: [1.4, 1.1, 0.6],
      chromaticSeparation: 0.5,
      beerDensity: 0.8,
      fixTransfer: 0.18,
      flow: 0.7,
      vorticity: 0.2,
      capillaryCreep: 0.3,
      fixing: false,
      velocitySettling: false,
      dryingEdgeDeposition: 0.4,
      pigmentDiffusion: [0.11, 0.02, 0.09, 0.12],
      fixSelectionEnabled: false,
      display,
    });
    expect(uniforms).toHaveLength(STUDIO_LIVING_INK_WGSL_UNIFORM_WORDS);
    const words = new Uint32Array(uniforms.buffer);
    expect(words[0]).toBe(512);
    expect(words[1]).toBe(256);
    expect(words[10]).toBe(128);
    expect(words[11]).toBe(64);
    expect(words[22]).toBe(display.displayWidth);
    expect(words[23]).toBe(display.displayHeight);
    expect(uniforms[24]).toBeCloseTo(display.densityStrength, 6);
    expect(uniforms[31]).toBeCloseTo(display.seed, 6);
    expect(uniforms[32]).toBeCloseTo(display.displayMode, 6);
    expect(uniforms[14]).toBeCloseTo(STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityWetGate.minimum, 6);
    expect(uniforms[17]).toBeCloseTo(STUDIO_LIVING_INK_FLUID_DEFAULTS.pigmentWetGate.maximum, 6);
    expect(uniforms[20]).toBeCloseTo(STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp, 6);
    // A fixation pass must damp the wash harder than a live stroke.
    const fixing = writeStudioLivingInkFieldUniforms({
      width: 512,
      height: 256,
      coarseWidth: 128,
      coarseHeight: 64,
      dt: 1 / 60,
      bleed: 0.5,
      dryRate: 0.25,
      chroma: [1.4, 1.1, 0.6],
      chromaticSeparation: 0.5,
      beerDensity: 0.8,
      fixTransfer: 0.18,
      flow: 0.7,
      vorticity: 0.2,
      capillaryCreep: 0.3,
      fixing: true,
      velocitySettling: false,
      dryingEdgeDeposition: 0.4,
      pigmentDiffusion: [0.11, 0.02, 0.09, 0.12],
      fixSelectionEnabled: false,
      display,
    });
    expect(fixing[12]).toBeLessThan(uniforms[12]!);
    expect(fixing[18]).toBeLessThan(uniforms[18]!);

    const settling = writeStudioLivingInkFieldUniforms({
      width: 512,
      height: 256,
      coarseWidth: 128,
      coarseHeight: 64,
      dt: 1 / 60,
      bleed: 0.5,
      dryRate: 0.25,
      chroma: [1.4, 1.1, 0.6],
      chromaticSeparation: 0.5,
      beerDensity: 0.8,
      fixTransfer: 0,
      flow: 0.7,
      vorticity: 0.2,
      capillaryCreep: 0.3,
      fixing: false,
      velocitySettling: true,
      dryingEdgeDeposition: 0.4,
      pigmentDiffusion: [0.11, 0.02, 0.09, 0.12],
      fixSelectionEnabled: false,
      display,
    });
    // Release settle uses a stronger release-only momentum brake. It must retain ordinary advance
    // evaporation and carry no mobile-to-fixed transfer request.
    expect(settling[12]).toBeLessThan(fixing[12]!);
    expect(settling[18]).toBeCloseTo(uniforms[18]!, 7);
    expect(settling[9]).toBe(0);
  });

  it("bounds the measured release momentum tail below the preferred seven-pixel gate", () => {
    const dt = 1 / 60;
    const ticks = 120;
    const flow = 0.7;
    const observedFixDriftPx = 32.31;
    const reviewedFixExtraRate = 7;
    const estimatedInitialVelocityPxPerSecond = observedFixDriftPx * reviewedFixExtraRate;
    const interactive = studioLivingInkVelocityDampingForStep(flow, dt, false, false);
    const fixing = studioLivingInkVelocityDampingForStep(flow, dt, true, false);
    const release = studioLivingInkVelocityDampingForStep(flow, dt, false, true);

    // Interactive and Fix are byte-for-byte the pre-release formulas; release is a third mode.
    expect(interactive).toBe(studioLivingInkVelocityDamping(flow, dt, false));
    expect(fixing).toBe(studioLivingInkVelocityDamping(flow, dt, true));
    expect(release).toBeLessThan(fixing);
    expect(STUDIO_LIVING_INK_RELEASE_VELOCITY_DAMPING_RATE_PER_SECOND).toBe(60);

    // Run the shared CPU fluid reference at the production 60 Hz/120-tick cadence. Integrating the
    // velocity before each reference tick deliberately measures the conservative pre-damp motion
    // convention, while the GPU kernels upload the same release retention into slot 12.
    const productionFieldHeight = 1_024;
    const field = createStudioLivingInkFluidReference({ width: 16, height: 16 });
    field.wet.fill(1);
    for (let index = 1; index < field.velocity.length; index += 2) {
      field.velocity[index] = estimatedInitialVelocityPxPerSecond / productionFieldHeight;
    }
    let measuredReferenceDisplacementPx = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      let meanVelocityY = 0;
      for (let index = 1; index < field.velocity.length; index += 2) {
        meanVelocityY += field.velocity[index] ?? 0;
      }
      meanVelocityY /= field.velocity.length / 2;
      measuredReferenceDisplacementPx += meanVelocityY * dt * productionFieldHeight;
      stepStudioLivingInkFluidReference(field, {
        dt,
        flow,
        bleed: 0.5,
        dryRate: 0.25,
        chromaticSeparation: 0.5,
        vorticity: 0.2,
        capillaryCreep: 0.3,
        pressureIterations: 0,
        fixing: false,
        velocitySettling: true,
        confinement: false,
        transport: false,
      });
    }
    expect(measuredReferenceDisplacementPx).toBeCloseTo(5.8868, 3);
    expect(measuredReferenceDisplacementPx).toBeLessThanOrEqual(7);
    expect(measuredReferenceDisplacementPx).toBeLessThanOrEqual(28 * 0.25);
  });

  /*
   * The wet and pigment kernels used to be reduced forms: an axis-aligned four-neighbour creep
   * stencil and a two-pass advect/diffuse split with its own diffusion constant. Both looked like
   * simplifications and were divergences — the axis-aligned stencil spreads as a diamond and
   * under-expands the wash along the paper fibre, and the split kernel applied the transport rate
   * twice per tick at four times the certified bleed. The Deegan compressibility term was absent
   * entirely, which is exactly what leaves a dwell mark reading as an ink dot instead of a wash.
   */
  it("carries the anisotropic fibre creep stencil rather than a four-neighbour Laplacian", () => {
    const wet = studioLivingInkWgslSourceForPass("wet");
    expect(wet).toContain("fibreAngle");
    expect(wet).toContain("parallelReach");
    expect(wet).toContain("perpendicularReach");
    expect(wet).toContain("frontierSource");
  });

  it("carries the Deegan compressibility term that empties a dwell mark's centre", () => {
    const pigment = studioLivingInkWgslSourceForPass("pigment");
    expect(pigment).toContain("displacementDivergence");
    expect(pigment).toContain("frontCurvature");
    expect(pigment).toContain("mobilitySlope");
    expect(pigment).toContain("clamp(1.0 + displacementDivergence, 0.8, 1.3)");
    // Drying-front pooling and saturated-centre dilution travel with it.
    expect(pigment).toContain("edgePool");
    expect(pigment).toContain("saturatedWashCenter");
    // Diffusion rates arrive as uniforms from the shared TS helper, never re-derived in shader text.
    expect(pigment).toContain("u.diffusionR");
    expect(STUDIO_LIVING_INK_WGSL_PASS_ORDER).not.toContain("advect-pigment");
  });

  it("declares every uniform slot the kernels read", () => {
    const common = studioLivingInkWgslSourceForPass("pigment");
    for (const field of [
      "coarseWidth",
      "coarseHeight",
      "velocityDamping",
      "vorticityStrength",
      "velocityWetGateMin",
      "pigmentWetGateMax",
      "evaporation",
      "capillaryCreep",
      "velocityClamp",
      "chromaticSeparation",
    ]) expect(common).toContain(`${field}:`);
  });
});
