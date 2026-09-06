import { describe, expect, it } from "vitest";

import { planWatercolorBrushDabs, type WatercolorBrushDab } from "./brush/studio-watercolor-brush";
import { planCausalWatercolorBrushDabs } from "./studio-causal-watercolor-brush";
import {
  augmentStudioLivingInkSettledBakeDabs,
  bakeStudioLivingInkSettledField,
  deriveStudioLivingInkSettledBakeDab,
  isStudioLivingInkSettledBakeIdentitySettings,
  normalizeStudioLivingInkSettledBakeSettings,
  resolveStudioLivingInkSettledBakeProgram,
  STUDIO_LIVING_INK_SETTLED_BAKE_DEFAULTS,
  STUDIO_LIVING_INK_SETTLED_BAKE_GRID,
  STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS,
  STUDIO_LIVING_INK_SETTLED_BAKE_RANGES,
  STUDIO_LIVING_INK_SETTLED_BAKE_STEPS,
} from "./studio-living-ink-settled-bake-v1";

const SUMI = STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS["sumi-flow-bake"];

/** Horizontal left→right stroke — travel direction is +x for downstream gates. */
const HORIZONTAL_PLAN_INPUT = {
  points: [0, 50, 200, 50, 400, 50, 600, 50],
  baseWidth: 24,
  seed: 7,
} as const;

const SETTLED_SUMI = { ...SUMI, phase: "settled", seed: 11 } as const;

interface ParsedStation {
  readonly core: WatercolorBrushDab;
  readonly diffuse: WatercolorBrushDab[];
}

function parseStations(dabs: readonly WatercolorBrushDab[]): ParsedStation[] {
  const stations: ParsedStation[] = [];
  for (const dab of dabs) {
    if (dab.role === "core") {
      stations.push({ core: dab, diffuse: [] });
      continue;
    }
    stations.at(-1)?.diffuse.push(dab);
  }
  return stations;
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

describe("normalizeStudioLivingInkSettledBakeSettings", () => {
  it("defaults to the fail-closed live phase and clamps malformed values", () => {
    const defaults = normalizeStudioLivingInkSettledBakeSettings();
    expect(defaults.phase).toBe("live");
    expect(defaults.strength).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_DEFAULTS.strength);
    expect(defaults.featherCount).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_DEFAULTS.featherCount);

    const clamped = normalizeStudioLivingInkSettledBakeSettings({
      seed: 3.9,
      phase: "later" as never,
      strength: 99,
      rimGain: -4,
      featherCount: 7.9,
      maxExtraDabs: 1e12,
      flow: Number.NaN,
      bleed: 2,
      dryRate: -1,
    });
    expect(clamped.seed).toBe(3);
    expect(clamped.phase).toBe("live");
    expect(clamped.strength).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_RANGES.strength.max);
    expect(clamped.rimGain).toBe(0);
    expect(clamped.featherCount).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_RANGES.featherCount.max);
    expect(clamped.maxExtraDabs).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_RANGES.maxExtraDabs.max);
    expect(clamped.flow).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_DEFAULTS.flow);
    expect(clamped.bleed).toBe(1);
    expect(clamped.dryRate).toBe(0);
  });
});

describe("settled-only identity contract (prefix safety)", () => {
  it("returns the exact input reference for any non-settled phase", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    expect(augmentStudioLivingInkSettledBakeDabs(dabs, { ...SUMI, seed: 5 })).toBe(dabs);
    expect(
      augmentStudioLivingInkSettledBakeDabs(dabs, { ...SUMI, seed: 5, phase: "live" }),
    ).toBe(dabs);
    expect(
      isStudioLivingInkSettledBakeIdentitySettings(
        normalizeStudioLivingInkSettledBakeSettings({ ...SUMI, phase: "live" }),
      ),
    ).toBe(true);
  });

  it("returns the exact input reference when every settled channel is zero", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const settings = {
      phase: "settled", seed: 5, strength: 0, rimGain: 0, featherCount: 0,
    } as const;
    expect(
      isStudioLivingInkSettledBakeIdentitySettings(
        normalizeStudioLivingInkSettledBakeSettings(settings),
      ),
    ).toBe(true);
    expect(augmentStudioLivingInkSettledBakeDabs(dabs, settings)).toBe(dabs);
    const empty: WatercolorBrushDab[] = [];
    expect(augmentStudioLivingInkSettledBakeDabs(empty, SETTLED_SUMI)).toBe(empty);
  });

  it("never mutates the input dabs while augmenting", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const frozen = structuredClone(dabs);
    augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    expect(dabs).toEqual(frozen);
  });
});

describe("determinism", () => {
  it("same stroke and settings bake to identical augmented plans", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const first = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const second = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(dabs.length);
  });

  it("a different seed moves feather deposits without changing station structure", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const first = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const second = augmentStudioLivingInkSettledBakeDabs(dabs, { ...SETTLED_SUMI, seed: 12 });
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
    expect(second.length).toBe(first.length);
    expect(second.map((dab) => dab.role)).toEqual(first.map((dab) => dab.role));
  });
});

describe("station structure", () => {
  it("passes every core through byte-identical (same object), stations aligned", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const output = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const inputCores = dabs.filter((dab) => dab.role === "core");
    const outputCores = output.filter((dab) => dab.role === "core");
    expect(outputCores.length).toBe(inputCores.length);
    for (let index = 0; index < inputCores.length; index += 1) {
      expect(outputCores[index]).toBe(inputCores[index]);
    }
    expect(parseStations([...output]).length).toBe(parseStations([...dabs]).length);
  });

  it("caps extras monotonically while always keeping shaped originals", () => {
    const dabs = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 24, seed: 3 });
    expect(dabs.length).toBe(2);
    const unlimited = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    // core + shifted halo + feathers (bounded by featherCount).
    expect(unlimited.length).toBeGreaterThan(2);
    expect(unlimited.length).toBeLessThanOrEqual(2 + SUMI.featherCount);

    const capped = augmentStudioLivingInkSettledBakeDabs(dabs, {
      ...SETTLED_SUMI, maxExtraDabs: 1,
    });
    expect(capped.length).toBe(3);
    expect(capped[0]).toEqual(unlimited[0]);
    expect(capped[1]).toEqual(unlimited[1]);
    expect(capped[2]).toEqual(unlimited[2]);

    const zero = augmentStudioLivingInkSettledBakeDabs(dabs, {
      ...SETTLED_SUMI, maxExtraDabs: 0,
    });
    expect(zero.length).toBe(2);
    expect(zero.map((dab) => dab.role)).toEqual(["core", "diffuse"]);
  });
});

describe("fluid realism metrics", () => {
  it("biases pigment downstream of motion: halos and feathers drift with travel", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const inputStations = parseStations([...dabs]);
    const output = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const outputStations = parseStations([...output]);
    expect(outputStations.length).toBe(inputStations.length);

    const haloShifts: number[] = [];
    const featherOffsets: number[] = [];
    for (let index = 0; index < inputStations.length; index += 1) {
      const inputHalo = inputStations[index]!.diffuse[0];
      const outputHalo = outputStations[index]!.diffuse[0];
      if (!inputHalo || !outputHalo) continue;
      haloShifts.push(outputHalo.x - inputHalo.x);
      for (const feather of outputStations[index]!.diffuse.slice(1)) {
        featherOffsets.push(feather.x - inputStations[index]!.core.x);
      }
    }
    expect(haloShifts.length).toBeGreaterThan(20);
    expect(featherOffsets.length).toBeGreaterThan(20);
    // Travel is +x: the drag momentum must push the settled wash downstream by a
    // visible margin (measured ≈ 4.3px halo / ≈ 32px feather on this fixture).
    expect(mean(haloShifts)).toBeGreaterThan(1);
    expect(mean(featherOffsets)).toBeGreaterThan(2);
    // The bleed offset is bounded: a halo can never abandon its own core.
    for (let index = 0; index < inputStations.length; index += 1) {
      const inputHalo = inputStations[index]!.diffuse[0];
      const outputHalo = outputStations[index]!.diffuse[0];
      if (!inputHalo || !outputHalo) continue;
      const shift = Math.hypot(outputHalo.x - inputHalo.x, outputHalo.y - inputHalo.y);
      expect(shift).toBeLessThanOrEqual(inputHalo.radius * 0.5 + 1e-9);
    }
  });

  it("forms a rim on a dwelled mark: outward migration raises halo alpha", () => {
    const dabs = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 26, seed: 3 });
    const halo = dabs[1]!;
    const bake = bakeStudioLivingInkSettledField(dabs, SETTLED_SUMI)!;
    expect(bake.steps).toBe(STUDIO_LIVING_INK_SETTLED_BAKE_STEPS);
    const derived = deriveStudioLivingInkSettledBakeDab(bake, halo.x, halo.y, halo.radius);
    // Capillary creep pushes the wet front past the pigment; the drying ring
    // precursor is a strong rim signal (measured ≈ 0.78 on this dwell fixture).
    expect(derived.rimSignal).toBeGreaterThan(0.2);

    const output = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const outputHalo = output[1]!;
    expect(outputHalo.role).toBe("diffuse");
    expect(outputHalo.opacity).toBeGreaterThan(halo.opacity);
  });

  it("keeps the stroke-local grids under the workstream caps", () => {
    const wide = planCausalWatercolorBrushDabs({
      points: Array.from({ length: 500 }, (_, index) => [index * 8, Math.sin(index * 0.11) * 900])
        .flat(),
      baseWidth: 30,
      seed: 4,
      spacing: 6,
      maxDabs: 4096,
    });
    const bake = bakeStudioLivingInkSettledField(wide, SETTLED_SUMI)!;
    const grid = STUDIO_LIVING_INK_SETTLED_BAKE_GRID;
    expect(Math.max(bake.field.width, bake.field.height)).toBeLessThanOrEqual(grid.pigmentLongSideCap);
    expect(bake.field.width * bake.field.height).toBeLessThanOrEqual(grid.fineMaxCells * 1.2);
    expect(Math.max(bake.field.coarseWidth, bake.field.coarseHeight))
      .toBeLessThanOrEqual(grid.velocityShortSideCap);
  });
});

describe("lane programs", () => {
  it("every program round-trips through normalization and is non-identity when settled", () => {
    for (const [programId, program] of Object.entries(STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS)) {
      const normalized = normalizeStudioLivingInkSettledBakeSettings({
        ...program, seed: 9, phase: "settled",
      });
      expect(normalized.strength, programId).toBe(program.strength);
      expect(normalized.rimGain, programId).toBe(program.rimGain);
      expect(normalized.featherCount, programId).toBe(program.featherCount);
      expect(normalized.flow, programId).toBe(program.flow);
      expect(normalized.bleed, programId).toBe(program.bleed);
      expect(isStudioLivingInkSettledBakeIdentitySettings(normalized), programId).toBe(false);
      expect(Object.isFrozen(program), programId).toBe(true);
      // Without the explicit settled assertion the same program is exact identity.
      expect(
        isStudioLivingInkSettledBakeIdentitySettings(
          normalizeStudioLivingInkSettledBakeSettings({ ...program, seed: 9 }),
        ),
        programId,
      ).toBe(true);
    }
  });

  it("resolves known program ids and rejects unknown ones", () => {
    expect(resolveStudioLivingInkSettledBakeProgram("sumi-flow-bake"))
      .toBe(STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS["sumi-flow-bake"]);
    expect(resolveStudioLivingInkSettledBakeProgram("fluid-feather-lite"))
      .toBe(STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS["fluid-feather-lite"]);
    expect(resolveStudioLivingInkSettledBakeProgram("edge-bloom")).toBeNull();
    expect(resolveStudioLivingInkSettledBakeProgram(null)).toBeNull();
    expect(resolveStudioLivingInkSettledBakeProgram("")).toBeNull();
  });

  it("the two programs produce different settled textures on the same stroke", () => {
    const dabs = planWatercolorBrushDabs(HORIZONTAL_PLAN_INPUT);
    const sumi = augmentStudioLivingInkSettledBakeDabs(dabs, SETTLED_SUMI);
    const lite = augmentStudioLivingInkSettledBakeDabs(dabs, {
      ...STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS["fluid-feather-lite"],
      phase: "settled",
      seed: 11,
    });
    expect(JSON.stringify(lite)).not.toBe(JSON.stringify(sumi));
  });
});

describe("performance", () => {
  it("bakes a 2000-dab settled stroke in under 120ms", () => {
    const points: number[] = [];
    for (let index = 0; index < 800; index += 1) {
      points.push(index * 8, (index % 2) * 6 + index * 0.5);
    }
    const input = planCausalWatercolorBrushDabs({
      points,
      baseWidth: 18,
      seed: 12,
      spacing: 4,
      maxDabs: 8_192,
    }).slice(0, 2_000);
    expect(input.length).toBe(2_000);

    // Warm-up excludes JIT compilation from the budget, matching commit-pass reality.
    augmentStudioLivingInkSettledBakeDabs(input, SETTLED_SUMI);

    let bestMs = Number.POSITIVE_INFINITY;
    let augmentedLength = 0;
    for (let run = 0; run < 3; run += 1) {
      const startedAt = performance.now();
      const augmented = augmentStudioLivingInkSettledBakeDabs(input, SETTLED_SUMI);
      bestMs = Math.min(bestMs, performance.now() - startedAt);
      augmentedLength = augmented.length;
    }
    expect(augmentedLength).toBeGreaterThan(input.length);
    expect(bestMs).toBeLessThan(120);
  });
});
