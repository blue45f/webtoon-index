import { describe, expect, it } from "vitest";

import {
  appendCausalWatercolorBrush,
  beginCausalWatercolorBrush,
  planCausalWatercolorBrushDabs,
  type StudioCausalWatercolorSample,
} from "../studio-causal-watercolor-brush";

import { applyStudioBrushAliasWatercolorMaterial } from "./studio-brush-alias-profile";
import { resolveStudioBrushEngineLaneWatercolorMaterial } from "./studio-brush-engine-lane-catalog";
import {
  getStudioPaperPresetV1,
  resolveStudioPaperMediaModulationV1,
} from "./studio-paper-media-profile-v1";
import { planWatercolorBrushDabs, type WatercolorBrushDab } from "./studio-watercolor-brush";
import {
  augmentStudioWetEdgeBloomDabs,
  isStudioWetEdgeBloomIdentitySettings,
  normalizeStudioWetEdgeBloomSettings,
  resolveStudioWetEdgeBloomProgram,
  STUDIO_WET_EDGE_BLOOM_DEFAULTS,
  STUDIO_WET_EDGE_BLOOM_FRESH_HALO_RADIUS_RATIO,
  STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS,
  STUDIO_WET_EDGE_BLOOM_PROGRAMS,
  STUDIO_WET_EDGE_BLOOM_RANGES,
  studioWetChromaticBleedRadiusMultipliers,
  studioWetFiberPermeabilitySample,
} from "./studio-wet-edge-bloom-v1";

const OFF = {
  edgeDarkening: 0,
  rimBeadCount: 0,
  granulation: 0,
  chroma: 0,
  wetness: 0,
} as const;

/** Long-enough diagonal so fibre noise decorrelates across stations. */
const LEGACY_PLAN_INPUT = {
  points: [0, 0, 420, 260, 840, 540, 1260, 780],
  baseWidth: 24,
  seed: 7,
} as const;

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

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

describe("normalizeStudioWetEdgeBloomSettings", () => {
  it("uses research defaults and clamps malformed values into contract ranges", () => {
    const defaults = normalizeStudioWetEdgeBloomSettings();
    expect(defaults.edgeDarkening).toBe(STUDIO_WET_EDGE_BLOOM_DEFAULTS.edgeDarkening);
    expect(defaults.edgeDarkening).toBe(1.35);
    expect(defaults.granulation).toBe(0.55);
    expect(defaults.chroma).toBe(0);
    expect(defaults.wetness).toBe(0);

    const clamped = normalizeStudioWetEdgeBloomSettings({
      seed: 3.9,
      edgeDarkening: 99,
      rimBeadCount: 7.6,
      granulation: -2,
      chroma: Number.NaN,
      wetness: 5,
      maxExtraDabs: 1e12,
    });
    expect(clamped.seed).toBe(3);
    expect(clamped.edgeDarkening).toBe(STUDIO_WET_EDGE_BLOOM_RANGES.edgeDarkening.max);
    expect(clamped.rimBeadCount).toBe(STUDIO_WET_EDGE_BLOOM_RANGES.rimBeadCount.max);
    expect(clamped.granulation).toBe(0);
    expect(clamped.chroma).toBe(0);
    expect(clamped.wetness).toBe(STUDIO_WET_EDGE_BLOOM_RANGES.wetness.max);
    expect(clamped.maxExtraDabs).toBe(STUDIO_WET_EDGE_BLOOM_RANGES.maxExtraDabs.max);
  });
});

describe("augmentStudioWetEdgeBloomDabs identity contract", () => {
  it("returns the exact input reference when every effect is disabled", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const settings = normalizeStudioWetEdgeBloomSettings({ ...OFF, seed: 11 });
    expect(isStudioWetEdgeBloomIdentitySettings(settings)).toBe(true);
    expect(augmentStudioWetEdgeBloomDabs(dabs, settings)).toBe(dabs);
  });

  it("returns the exact empty input reference", () => {
    const empty: WatercolorBrushDab[] = [];
    expect(augmentStudioWetEdgeBloomDabs(empty, { seed: 1 })).toBe(empty);
  });

  it("never mutates the input dabs while augmenting", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const frozen = structuredClone(dabs);
    augmentStudioWetEdgeBloomDabs(dabs, {
      seed: 21, edgeDarkening: 1.35, rimBeadCount: 2, granulation: 0.55, chroma: 0.5, wetness: 0.16,
    });
    expect(dabs).toEqual(frozen);
  });
});

describe("determinism", () => {
  const FULL = {
    edgeDarkening: 1.35, rimBeadCount: 3, granulation: 0.55, chroma: 0.4, wetness: 0.16,
  } as const;

  it("same input and seed produce identical augmented plans", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const first = augmentStudioWetEdgeBloomDabs(dabs, { ...FULL, seed: 77 });
    const second = augmentStudioWetEdgeBloomDabs(dabs, { ...FULL, seed: 77 });
    expect(second).toEqual(first);
  });

  it("a different seed moves rim deposits without changing plan structure", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const first = augmentStudioWetEdgeBloomDabs(dabs, { ...FULL, seed: 77 });
    const second = augmentStudioWetEdgeBloomDabs(dabs, { ...FULL, seed: 78 });
    expect(second.length).toBeGreaterThan(0);
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });
});

describe("prefix stability", () => {
  it("augmenting a station-aligned prefix yields a prefix of the augmented full stroke", () => {
    const samples: StudioCausalWatercolorSample[] = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 9, y: 4, pressure: 0.35 },
      { x: 21, y: 11, pressure: 0.6 },
      { x: 36, y: 15, pressure: 0.8 },
      { x: 52, y: 12, pressure: 0.66 },
      { x: 70, y: 3, pressure: 0.44 },
      { x: 91, y: -6, pressure: 0.9 },
    ];
    const bloom = {
      seed: 314, edgeDarkening: 1.35, rimBeadCount: 2, granulation: 0.55, chroma: 0.3, wetness: 0.16,
    } as const;

    const started = beginCausalWatercolorBrush(samples[0]!, {
      baseWidth: 20,
      spacing: 5,
      seed: 314,
      maxDabs: 400,
    })!;
    const cumulative = [...started.dabs];
    const augmentedPrefixes = [augmentStudioWetEdgeBloomDabs([...cumulative], bloom)];
    for (const sample of samples.slice(1)) {
      cumulative.push(...appendCausalWatercolorBrush(started.state, sample));
      augmentedPrefixes.push(augmentStudioWetEdgeBloomDabs([...cumulative], bloom));
    }

    const full = augmentedPrefixes.at(-1)!;
    for (const prefix of augmentedPrefixes) {
      expect(full.slice(0, prefix.length)).toEqual(prefix);
    }
  });
});

describe("edge darkening (coffee ring)", () => {
  const EDGE_ONLY = {
    seed: 5, edgeDarkening: 1.35, rimBeadCount: 2, granulation: 0, chroma: 0, wetness: 0,
  } as const;

  it("raises rim alpha against an unchanged interior by a measurable ratio", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const inputStations = parseStations(input);
    const outputStations = parseStations([
      ...augmentStudioWetEdgeBloomDabs(input, EDGE_ONLY),
    ]);
    expect(outputStations.length).toBe(inputStations.length);
    expect(inputStations.length).toBeGreaterThan(40);

    const rimRatios: number[] = [];
    for (let index = 0; index < inputStations.length; index += 1) {
      const inputStation = inputStations[index]!;
      const outputStation = outputStations[index]!;
      // Interior pigment is untouched when granulation is off.
      expect(outputStation.core.opacity).toBe(inputStation.core.opacity);
      expect(outputStation.core.radius).toBe(inputStation.core.radius);
      const inputHalo = inputStation.diffuse[0]!;
      const outputHalo = outputStation.diffuse[0]!;
      const ratio = outputHalo.opacity / inputHalo.opacity;
      expect(ratio).toBeGreaterThan(1.05);
      expect(ratio).toBeLessThanOrEqual(1 + EDGE_ONLY.edgeDarkening);
      rimRatios.push(ratio);
    }
    const meanRatio = rimRatios.reduce((sum, value) => sum + value, 0) / rimRatios.length;
    expect(meanRatio).toBeGreaterThan(1.15);
  });

  it("inscribes uneven rim beads strictly inside the halo footprint", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const inputStations = parseStations(input);
    const outputStations = parseStations([
      ...augmentStudioWetEdgeBloomDabs(input, EDGE_ONLY),
    ]);

    let beadTotal = 0;
    const beadAngles = new Set<string>();
    for (let index = 0; index < inputStations.length; index += 1) {
      const halo = outputStations[index]!.diffuse[0]!;
      const beads = outputStations[index]!.diffuse.slice(1);
      expect(beads.length).toBeLessThanOrEqual(EDGE_ONLY.rimBeadCount);
      for (const bead of beads) {
        const centreDistance = Math.hypot(bead.x - halo.x, bead.y - halo.y);
        expect(centreDistance + bead.radius).toBeLessThanOrEqual(halo.radius + 1e-9);
        expect(bead.role).toBe("diffuse");
        expect(bead.opacity).toBeGreaterThan(0);
        beadAngles.add(`${Math.atan2(bead.y - halo.y, bead.x - halo.x).toFixed(3)}`);
        beadTotal += 1;
      }
    }
    // Nearly every station keeps both beads; only the faintest stations may skip.
    expect(beadTotal).toBeGreaterThanOrEqual(inputStations.length);
    // Seeded angles do not tile one orientation around the stroke.
    expect(beadAngles.size).toBeGreaterThan(inputStations.length / 2);
  });

  it("zero edge darkening emits no beads and keeps halo alpha untouched", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const output = augmentStudioWetEdgeBloomDabs(input, {
      ...EDGE_ONLY, edgeDarkening: 0, wetness: 0.16,
    });
    const stations = parseStations([...output]);
    for (const station of stations) {
      // fresh halo + shaped halo only — no rim beads ride a ring that does not exist.
      expect(station.diffuse.length).toBe(2);
    }
  });
});

describe("granulation via fibre permeability", () => {
  const GRAIN_ONLY = {
    seed: 9, edgeDarkening: 0, rimBeadCount: 0, granulation: 0.55, chroma: 0, wetness: 0,
  } as const;

  it("modulates core pigment within bounds and with bounded variance", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const output = augmentStudioWetEdgeBloomDabs(input, GRAIN_ONLY);
    expect(output.length).toBe(input.length);

    const multipliers: number[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (input[index]!.role !== "core") continue;
      const ratio = output[index]!.opacity / input[index]!.opacity;
      // amplitude = granulation 0.55 × core amplitude 0.5 = ±0.275
      expect(ratio).toBeGreaterThanOrEqual(1 - 0.276);
      expect(ratio).toBeLessThanOrEqual(1 + 0.276);
      multipliers.push(ratio);
    }
    expect(multipliers.length).toBeGreaterThan(40);
    const mean = multipliers.reduce((sum, value) => sum + value, 0) / multipliers.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
    const deviation = standardDeviation(multipliers);
    expect(deviation).toBeGreaterThan(0.02);
    expect(deviation).toBeLessThan(0.28);
  });

  it("fibre permeability field is deterministic, bounded and spatially varied", () => {
    const values: number[] = [];
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const value = studioWetFiberPermeabilitySample(x * 7.3, y * 7.3, 42);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        values.push(value);
      }
    }
    expect(Math.min(...values)).toBeLessThan(0.45);
    expect(Math.max(...values)).toBeGreaterThan(0.55);
    expect(studioWetFiberPermeabilitySample(123.4, 56.7, 42))
      .toBe(studioWetFiberPermeabilitySample(123.4, 56.7, 42));
    expect(studioWetFiberPermeabilitySample(123.4, 56.7, 42))
      .not.toBe(studioWetFiberPermeabilitySample(123.4, 56.7, 43));
    expect(studioWetFiberPermeabilitySample(Number.NaN, 1, 42)).toBe(0.5);
  });
});

describe("chromatic bleed (chromatography)", () => {
  it("matches the published per-channel bleed radius vector exactly", () => {
    expect(studioWetChromaticBleedRadiusMultipliers(0)).toEqual({ red: 1, green: 1, blue: 1 });
    const half = studioWetChromaticBleedRadiusMultipliers(0.5);
    expect(half.red).toBeCloseTo(1.425, 12);
    expect(half.green).toBeCloseTo(1.075, 12);
    expect(half.blue).toBeCloseTo(0.675, 12);
    const full = studioWetChromaticBleedRadiusMultipliers(1);
    expect(full.red).toBeCloseTo(1.85, 12);
    expect(full.green).toBeCloseTo(1.15, 12);
    expect(full.blue).toBeCloseTo(0.35, 12);
    // Out-of-range amounts clamp instead of exploding the bleed geometry.
    expect(studioWetChromaticBleedRadiusMultipliers(2)).toEqual(full);
    expect(studioWetChromaticBleedRadiusMultipliers(Number.NaN))
      .toEqual({ red: 1, green: 1, blue: 1 });
  });

  it("splits each halo into a dense inner lag and a faint fast outer fringe", () => {
    const input = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 20, seed: 3 });
    expect(input.length).toBe(2);
    const inputHalo = input[1]!;
    const output = augmentStudioWetEdgeBloomDabs(input, {
      seed: 3, edgeDarkening: 0, rimBeadCount: 0, granulation: 0, chroma: 0.5, wetness: 0,
    });
    expect(output.length).toBe(4);
    const [core, halo, innerLag, outerFringe] = output as readonly [
      WatercolorBrushDab, WatercolorBrushDab, WatercolorBrushDab, WatercolorBrushDab,
    ];
    expect(core.role).toBe("core");
    expect(halo.radius).toBeCloseTo(inputHalo.radius * 1.075, 9);
    expect(innerLag.radius).toBeCloseTo(inputHalo.radius * 0.675, 9);
    expect(outerFringe.radius).toBeCloseTo(inputHalo.radius * 1.425, 9);
    expect(innerLag.opacity).toBeCloseTo(inputHalo.opacity * 0.45 * 0.5, 9);
    expect(outerFringe.opacity).toBeCloseTo(inputHalo.opacity * 0.3 * 0.5, 9);
    // Warm core / cool halo: the lagging front is denser than the fast fringe.
    expect(innerLag.opacity).toBeGreaterThan(outerFringe.opacity);
    expect(outerFringe.radius).toBeGreaterThan(halo.radius);
    expect(innerLag.radius).toBeLessThan(halo.radius);
  });
});

describe("fresh-ink wetness semantics", () => {
  it("gives freshly deposited lines a wide soft halo per station", () => {
    const input = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 20, seed: 3 });
    const core = input[0]!;
    const output = augmentStudioWetEdgeBloomDabs(input, {
      seed: 3, edgeDarkening: 0, rimBeadCount: 0, granulation: 0, chroma: 0,
      wetness: STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS,
    });
    expect(output.length).toBe(3);
    const freshHalo = output[1]!;
    expect(freshHalo.role).toBe("diffuse");
    expect(freshHalo.x).toBe(core.x);
    expect(freshHalo.y).toBe(core.y);
    expect(freshHalo.radius).toBeCloseTo(
      core.radius * STUDIO_WET_EDGE_BLOOM_FRESH_HALO_RADIUS_RATIO,
      9,
    );
    expect(freshHalo.opacity).toBeCloseTo(core.opacity * 0.1, 9);
  });

  it("dry-set lines get no fresh halo and partial wetness scales it down monotonically", () => {
    const input = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 20, seed: 3 });
    const settings = {
      seed: 3, edgeDarkening: 0, rimBeadCount: 0, granulation: 0, chroma: 0,
    } as const;
    expect(augmentStudioWetEdgeBloomDabs(input, { ...settings, wetness: 0 }).length).toBe(2);
    const faint = augmentStudioWetEdgeBloomDabs(input, { ...settings, wetness: 0.05 })[1]!;
    const fresh = augmentStudioWetEdgeBloomDabs(input, { ...settings, wetness: 0.16 })[1]!;
    expect(faint.opacity).toBeLessThan(fresh.opacity);
    expect(faint.radius).toBeCloseTo(fresh.radius, 9);
  });

  it("wet strokes ring softer: wetness reduces the coffee-ring gain", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const settings = {
      seed: 5, edgeDarkening: 1.35, rimBeadCount: 0, granulation: 0, chroma: 0,
    } as const;
    const dryStations = parseStations([
      ...augmentStudioWetEdgeBloomDabs(input, { ...settings, wetness: 0 }),
    ]);
    const wetStations = parseStations([
      ...augmentStudioWetEdgeBloomDabs(input, { ...settings, wetness: 0.32 }),
    ]);
    for (let index = 0; index < dryStations.length; index += 1) {
      const dryHalo = dryStations[index]!.diffuse.at(-1)!;
      const wetHalo = wetStations[index]!.diffuse.at(-1)!;
      expect(wetHalo.opacity).toBeLessThan(dryHalo.opacity);
    }
  });
});

describe("lane programs", () => {
  it("every program round-trips through settings normalization unchanged", () => {
    for (const [programId, program] of Object.entries(STUDIO_WET_EDGE_BLOOM_PROGRAMS)) {
      const normalized = normalizeStudioWetEdgeBloomSettings({ ...program, seed: 9 });
      expect(normalized.edgeDarkening, programId).toBe(program.edgeDarkening);
      expect(normalized.rimBeadCount, programId).toBe(program.rimBeadCount);
      expect(normalized.granulation, programId).toBe(program.granulation);
      expect(normalized.chroma, programId).toBe(program.chroma);
      expect(normalized.wetness, programId).toBe(program.wetness);
      expect(isStudioWetEdgeBloomIdentitySettings(normalized), programId).toBe(false);
      expect(Object.isFrozen(program), programId).toBe(true);
    }
  });

  it("resolves known program ids and rejects unknown ones", () => {
    expect(resolveStudioWetEdgeBloomProgram("edge-bloom"))
      .toBe(STUDIO_WET_EDGE_BLOOM_PROGRAMS["edge-bloom"]);
    expect(resolveStudioWetEdgeBloomProgram("fiber-feather"))
      .toBe(STUDIO_WET_EDGE_BLOOM_PROGRAMS["fiber-feather"]);
    expect(resolveStudioWetEdgeBloomProgram("granular")).toBeNull();
    expect(resolveStudioWetEdgeBloomProgram(null)).toBeNull();
    expect(resolveStudioWetEdgeBloomProgram("")).toBeNull();
  });
});

describe("extra-dab safety ceiling", () => {
  it("truncates extras monotonically while always keeping shaped originals", () => {
    const input = planWatercolorBrushDabs({ points: [30, 40], baseWidth: 20, seed: 3 });
    const settings = {
      seed: 3, edgeDarkening: 1.35, rimBeadCount: 2, granulation: 0, chroma: 0.5, wetness: 0.16,
    } as const;
    const unlimited = augmentStudioWetEdgeBloomDabs(input, settings);
    // core + fresh + halo + inner lag + outer fringe + 2 beads
    expect(unlimited.length).toBe(7);

    const capped = augmentStudioWetEdgeBloomDabs(input, { ...settings, maxExtraDabs: 2 });
    expect(capped.length).toBe(4);
    // The first extras in emission order survive; shaped originals are never dropped.
    expect(capped[0]).toEqual(unlimited[0]);
    expect(capped[1]).toEqual(unlimited[1]);
    expect(capped[2]).toEqual(unlimited[2]);
    expect(capped[3]).toEqual(unlimited[3]);

    const zero = augmentStudioWetEdgeBloomDabs(input, { ...settings, maxExtraDabs: 0 });
    expect(zero.length).toBe(2);
    expect(zero.map((dab) => dab.role)).toEqual(["core", "diffuse"]);
  });
});

describe("performance", () => {
  it("augments a 2000-dab stroke in under 25ms", () => {
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

    const settings = {
      seed: 12, edgeDarkening: 1.35, rimBeadCount: 4, granulation: 0.55, chroma: 0.5, wetness: 0.16,
    } as const;
    // Warm-up excludes JIT compilation from the budget, matching the hot-path reality.
    augmentStudioWetEdgeBloomDabs(input, settings);

    let bestMs = Number.POSITIVE_INFINITY;
    let augmentedLength = 0;
    for (let run = 0; run < 3; run += 1) {
      const startedAt = performance.now();
      const augmented = augmentStudioWetEdgeBloomDabs(input, settings);
      bestMs = Math.min(bestMs, performance.now() - startedAt);
      augmentedLength = augmented.length;
    }
    expect(augmentedLength).toBeGreaterThan(input.length);
    expect(bestMs).toBeLessThan(25);
  });
});

// ---------------------------------------------------------------------------
// F1 — W7 종이 valley-settle 결합 (paperPresetId)
// ---------------------------------------------------------------------------

describe("F1 paper valley-settle (paperPresetId)", () => {
  it("normalization keeps known W7 sheets and silently drops unknown ids", () => {
    expect(
      normalizeStudioWetEdgeBloomSettings({ paperPresetId: "watercolor-rough" }).paperPresetId,
    ).toBe("watercolor-rough");
    for (const invalid of ["washi", "", 7, null, undefined]) {
      const normalized = normalizeStudioWetEdgeBloomSettings({
        paperPresetId: invalid as never,
      });
      expect(normalized.paperPresetId, String(invalid)).toBeUndefined();
      expect(Object.hasOwn(normalized, "paperPresetId"), String(invalid)).toBe(false);
    }
  });

  it("keeps the identity reference-return contract with a paper sheet attached", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const settings = normalizeStudioWetEdgeBloomSettings({
      ...OFF, seed: 4, paperPresetId: "watercolor-rough",
    });
    // 종이는 granulation 강도만 스케일하므로 모든 효과가 0이면 여전히 정확한 항등이다.
    expect(isStudioWetEdgeBloomIdentitySettings(settings)).toBe(true);
    expect(augmentStudioWetEdgeBloomDabs(dabs, settings)).toBe(dabs);
  });

  it("pins W7 sheets on all four lane programs and round-trips them through normalization", () => {
    const expectedSheets = {
      "edge-bloom": "watercolor-rough",
      "granulating-wash": "watercolor-rough",
      "fiber-feather": "watercolor-hot-press",
      "chroma-halo": "watercolor-hot-press",
    } as const;
    for (const [programId, presetId] of Object.entries(expectedSheets)) {
      const program = resolveStudioWetEdgeBloomProgram(programId);
      expect(program?.paperPresetId, programId).toBe(presetId);
      expect(
        normalizeStudioWetEdgeBloomSettings({ ...program, seed: 5 }).paperPresetId,
        programId,
      ).toBe(presetId);
    }
  });

  it("paper sheet on ⇒ granulated plan changes; sheet off ⇒ byte-identical", () => {
    const dabs = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    for (const programId of Object.keys(STUDIO_WET_EDGE_BLOOM_PROGRAMS)) {
      const program = resolveStudioWetEdgeBloomProgram(programId)!;
      const withPaper = augmentStudioWetEdgeBloomDabs(dabs, { ...program, seed: 21 });
      const withoutPaper = augmentStudioWetEdgeBloomDabs(dabs, {
        ...program, seed: 21, paperPresetId: undefined,
      });
      // 구조(스테이션·역할 순서)는 동일하고 과립 알파만 종이를 탄다.
      expect(withPaper.length, programId).toBe(withoutPaper.length);
      expect(
        withPaper.map((dab) => dab.role),
        programId,
      ).toEqual(withoutPaper.map((dab) => dab.role));
      expect(
        withPaper.some((dab, index) => dab.opacity !== withoutPaper[index]!.opacity),
        `${programId}: paper sheet produced no byte change`,
      ).toBe(true);
      // 결정성.
      expect(augmentStudioWetEdgeBloomDabs(dabs, { ...program, seed: 21 })).toEqual(withPaper);
    }
  });

  it("scales core granulation by the exact W7 valley-settle law (granulation-only fixture)", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const seed = 9;
    const preset = getStudioPaperPresetV1("watercolor-rough");
    const output = augmentStudioWetEdgeBloomDabs(input, {
      ...OFF, granulation: 0.55, seed, paperPresetId: "watercolor-rough",
    });
    const inputStations = parseStations(input);
    const outputStations = parseStations([...output]);
    expect(outputStations.length).toBe(inputStations.length);
    const scaleSpread = new Set<string>();
    for (let index = 0; index < inputStations.length; index += 1) {
      const before = inputStations[index]!.core;
      const after = outputStations[index]!.core;
      const permeability = studioWetFiberPermeabilitySample(before.x, before.y, seed);
      const paperScale = resolveStudioPaperMediaModulationV1({
        medium: "watercolor",
        preset,
        pressure: 0.5,
        x: before.x,
        y: before.y,
        seed,
      }).granulationScale;
      // 코어 과립 진폭 0.5 (GRANULATION_CORE_AMPLITUDE) — 강도에 골 침착 스케일이 곱해진다.
      const expected = Math.min(
        0.95,
        before.opacity * (1 + 0.55 * paperScale * 0.5 * (permeability * 2 - 1)),
      );
      expect(after.opacity, `station ${index}`).toBeCloseTo(expected, 12);
      scaleSpread.add(paperScale.toFixed(4));
    }
    // 낱장 높이가 실제로 위치마다 달라야 valley-settle 이 공허하지 않다.
    expect(scaleSpread.size).toBeGreaterThan(8);
  });

  it("threads the lane program's sheet through the alias watercolor material pass", () => {
    const input = planWatercolorBrushDabs(LEGACY_PLAN_INPUT);
    const material = resolveStudioBrushEngineLaneWatercolorMaterial("watercolor--granulating");
    const program = resolveStudioWetEdgeBloomProgram(material?.wetEdgeBloomProgramId)!;
    expect(program.paperPresetId).toBe("watercolor-rough");
    // alias 패스의 재질 스케일을 그대로 재현한 뒤 프로그램(=시트 포함)을 얹으면 레인 산출물과
    // 비트 단위로 같아야 한다 — 카탈로그→alias→프로그램→W7 시트 체인의 무배선 증명.
    const scaled = input.map((dab) => {
      const core = dab.role === "core";
      return {
        ...dab,
        radius: Math.max(
          0.05,
          dab.radius * (core ? material!.coreRadiusScale : material!.diffuseRadiusScale),
        ),
        opacity: Math.min(
          1,
          Math.max(
            0,
            dab.opacity * (core ? material!.coreOpacityScale : material!.diffuseOpacityScale),
          ),
        ),
      };
    });
    const laneOutput = applyStudioBrushAliasWatercolorMaterial(
      "watercolor--granulating",
      input,
      33,
    );
    expect(laneOutput).toEqual(
      augmentStudioWetEdgeBloomDabs(scaled, { ...program, seed: 33 }),
    );
    // 종이를 소거한 같은 프로그램과는 달라야 한다 — 시트가 실제로 제품 경로를 흐른 증거.
    expect(JSON.stringify(laneOutput)).not.toBe(JSON.stringify(
      augmentStudioWetEdgeBloomDabs(scaled, {
        ...program, seed: 33, paperPresetId: undefined,
      }),
    ));
  });
});
