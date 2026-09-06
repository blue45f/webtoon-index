import { describe, expect, it } from "vitest";

import {
  consumeStudioWetInkDirtyBounds,
  createStudioWetInkField,
  depositStudioWetInkStroke,
  normalizeStudioWetInkStrokeInput,
  planStudioWetInkTileUploads,
  readStudioWetInkCell,
  simulateStudioWetInkField,
  studioWetInkFieldDigest,
  type StudioWetInkField,
  type StudioWetInkFieldConfigInput,
  type StudioWetInkStrokeSample,
} from "./studio-wet-ink-field";

function field(
  patch: Partial<StudioWetInkFieldConfigInput> = {},
): StudioWetInkField {
  const created = createStudioWetInkField({
    width: 128,
    height: 64,
    tileSize: 16,
    maxTiles: 64,
    maxCells: 16_384,
    ...patch,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.reason);
  return created.value;
}

function linearSamples(
  rateHz: 60 | 120 | 240,
  durationMs = 1_000,
): StudioWetInkStrokeSample[] {
  const count = Math.round(rateHz * durationMs / 1_000);
  return Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count;
    return {
      x: 12 + 96 * progress,
      y: 18 + 24 * progress,
      timeMs: progress * durationMs,
      pressure: 0.25 + 0.65 * progress,
    };
  });
}

function deposit(
  target: StudioWetInkField,
  samples: readonly StudioWetInkStrokeSample[],
  patch: Partial<Parameters<typeof depositStudioWetInkStroke>[1]> = {},
) {
  return depositStudioWetInkStroke(target, {
    samples,
    radius: 5,
    hardness: 0.3,
    spacing: 2,
    waterLoad: 0.9,
    pigmentLoad: 0.75,
    wetnessLoad: 0.95,
    seed: 311,
    maxDabs: 8_192,
    ...patch,
  });
}

function fieldTotals(target: StudioWetInkField) {
  let water = 0;
  let pigment = 0;
  let wetness = 0;
  let stain = 0;
  for (const tile of target.tiles.values()) {
    for (const value of tile.water) water += value;
    for (const value of tile.pigment) pigment += value;
    for (const value of tile.wetness) wetness += value;
    for (const value of tile.stain) stain += value;
  }
  return { water, pigment, wetness, stain };
}

describe("wet ink field configuration and fail-closed budgets", () => {
  it("rejects unsafe dimensions and unstable/non-finite physical coefficients before allocation", () => {
    expect(createStudioWetInkField({
      width: 0,
      height: 64,
    })).toMatchObject({ ok: false, code: "invalid-config" });
    expect(createStudioWetInkField({
      width: 64,
      height: 64,
      waterDiffusion: 0.25,
    })).toMatchObject({ ok: false, code: "invalid-config" });
    expect(createStudioWetInkField({
      width: 64,
      height: 64,
      granulation: Number.NaN,
    })).toMatchObject({ ok: false, code: "invalid-config" });
  });

  it("does not mutate or allocate when a stroke would exceed its tile/cell budget", () => {
    const target = field({
      width: 64,
      height: 32,
      tileSize: 16,
      maxTiles: 1,
      maxCells: 256,
    });
    const before = studioWetInkFieldDigest(target);
    const result = deposit(target, [
      { x: 4, y: 16, timeMs: 0, pressure: 0.5 },
      { x: 44, y: 16, timeMs: 100, pressure: 0.5 },
    ]);

    expect(result).toMatchObject({ ok: false, code: "tile-budget-exceeded" });
    expect(target.tiles.size).toBe(0);
    expect(target.allocatedCells).toBe(0);
    expect(target.revision).toBe(0);
    expect(studioWetInkFieldDigest(target)).toBe(before);
  });

  it("rejects malformed input and lifetime-step overflow without changing an existing field", () => {
    const target = field({ maxSimulationSteps: 2 });
    expect(deposit(target, [
      { x: 20, y: 20, timeMs: 0 },
    ]).ok).toBe(true);
    const beforeInvalid = studioWetInkFieldDigest(target);
    expect(deposit(target, [
      { x: Number.NaN, y: 20, timeMs: 0 },
    ])).toMatchObject({ ok: false, code: "invalid-input" });
    expect(studioWetInkFieldDigest(target)).toBe(beforeInvalid);

    expect(simulateStudioWetInkField(target, 3)).toMatchObject({
      ok: false,
      code: "step-budget-exceeded",
    });
    expect(studioWetInkFieldDigest(target)).toBe(beforeInvalid);
  });
});

describe("fixed-clock input and deterministic replay", () => {
  it("normalizes equivalent 60/120/240 Hz linear input to the same authoritative sequence", () => {
    const plans = ([60, 120, 240] as const).map((rate) =>
      normalizeStudioWetInkStrokeInput(linearSamples(rate))
    );
    for (const plan of plans) expect(plan.ok).toBe(true);
    const values = plans.map((plan) => {
      if (!plan.ok) throw new Error(plan.reason);
      return plan.value.samples;
    });
    expect(values[1]).toEqual(values[0]);
    expect(values[2]).toEqual(values[0]);
    expect(values[0]).toHaveLength(241);
  });

  it("produces byte-identical physical fields after 60/120/240 Hz replay", () => {
    const digests = ([60, 120, 240] as const).map((rate) => {
      const target = field({ seed: 911 });
      const deposited = deposit(target, linearSamples(rate));
      expect(deposited.ok).toBe(true);
      const simulated = simulateStudioWetInkField(target, 18);
      expect(simulated.ok).toBe(true);
      return studioWetInkFieldDigest(target);
    });

    expect(new Set(digests).size).toBe(1);
  });

  it("keeps fixed-seed replay stable and gives a different paper field to another seed", () => {
    const run = (seed: number) => {
      const target = field({ seed });
      expect(deposit(target, linearSamples(120, 250)).ok).toBe(true);
      expect(simulateStudioWetInkField(target, 12).ok).toBe(true);
      return studioWetInkFieldDigest(target);
    };

    expect(run(72)).toBe(run(72));
    expect(run(72)).not.toBe(run(73));
  });

  it("keeps paper tooth continuous across the former 8-cell hash lattice", () => {
    const target = field({
      width: 128,
      height: 96,
      seed: 808,
      paperRoughness: 1,
    });
    const boundaryDeltas: number[] = [];
    const interiorDeltas: number[] = [];
    for (let y = 2; y < 94; y += 1) {
      for (let x = 1; x < 127; x += 1) {
        const current = readStudioWetInkCell(target, x, y)!.paper;
        const previous = readStudioWetInkCell(target, x - 1, y)!.paper;
        (x % 8 === 0 ? boundaryDeltas : interiorDeltas).push(
          Math.abs(current - previous),
        );
      }
    }
    const mean = (values: readonly number[]): number => (
      values.reduce((sum, value) => sum + value, 0) / values.length
    );

    // A nearest-cell cloud made the old lattice boundary over 2.4× rougher than its interior and
    // appeared as a 2 px checkerboard after the 4× field was downsampled. Paper variation remains,
    // but the boundary is now statistically indistinguishable from any neighbouring cell.
    expect(mean(boundaryDeltas) / mean(interiorDeltas)).toBeLessThan(1.35);
    expect(Math.max(...boundaryDeltas)).toBeLessThan(0.15);
    expect(new Set(
      boundaryDeltas.map((value) => value.toFixed(5)),
    ).size).toBeGreaterThan(16);
  });
});

describe("tiled deposition, diffusion and drying", () => {
  it("deposits all five physical fields and diffuses pigment across a tile boundary without a seam", () => {
    const target = field({
      width: 48,
      height: 32,
      tileSize: 16,
      paperRoughness: 0,
      granulation: 0,
    });
    const result = deposit(target, [
      { x: 15.5, y: 16, timeMs: 0, pressure: 0.8 },
    ], {
      radius: 4,
      spacing: 1.5,
    });
    expect(result.ok).toBe(true);
    expect(target.tiles.size).toBeGreaterThanOrEqual(2);
    expect(simulateStudioWetInkField(target, 8).ok).toBe(true);

    const left = readStudioWetInkCell(target, 15, 16)!;
    const right = readStudioWetInkCell(target, 16, 16)!;
    for (const cell of [left, right]) {
      expect(cell.water + cell.wetness).toBeGreaterThan(0);
      expect(cell.pigment + cell.stain).toBeGreaterThan(0);
      expect(cell.paper).toBeCloseTo(0.5, 6);
    }
    expect(Math.abs(
      (left.pigment + left.stain) - (right.pigment + right.stain),
    )).toBeLessThan(0.08);
  });

  it("moves mobile pigment into a fixed stain while water and wetness dry", () => {
    const target = field({
      evaporation: 0.035,
      dryingRate: 0.09,
      fixationRate: 0.2,
    });
    expect(deposit(target, [
      { x: 48, y: 30, timeMs: 0, pressure: 0.9 },
    ], {
      radius: 7,
      waterLoad: 1.1,
      pigmentLoad: 1,
    }).ok).toBe(true);
    const before = fieldTotals(target);
    const simulated = simulateStudioWetInkField(target, 40);
    expect(simulated.ok).toBe(true);
    const after = fieldTotals(target);

    expect(after.water).toBeLessThan(before.water);
    expect(after.wetness).toBeLessThan(before.wetness);
    expect(after.pigment).toBeLessThan(before.pigment);
    expect(after.stain).toBeGreaterThan(before.stain);
  });

  it("adds deterministic wet-edge darkening and paper-granulation variation", () => {
    const run = (edgeDarkening: number, granulation: number) => {
      const target = field({
        seed: 808,
        edgeDarkening,
        granulation,
        paperRoughness: 1,
      });
      expect(deposit(target, [
        { x: 48, y: 30, timeMs: 0, pressure: 0.8 },
      ], {
        radius: 9,
        waterLoad: 1.2,
        pigmentLoad: 1,
      }).ok).toBe(true);
      expect(simulateStudioWetInkField(target, 24).ok).toBe(true);
      return target;
    };
    const plain = run(0, 0);
    const edged = run(1, 0);
    const granulated = run(1, 1);

    expect(fieldTotals(edged).stain).toBeGreaterThan(fieldTotals(plain).stain);
    expect(studioWetInkFieldDigest(granulated)).not.toBe(
      studioWetInkFieldDigest(edged),
    );
    const granulatedStains = [...granulated.tiles.values()]
      .flatMap((tile) => [...tile.stain])
      .filter((value) => value > 0);
    expect(new Set(granulatedStains.map((value) => value.toFixed(5))).size).toBeGreaterThan(8);
  });

  it("keeps every stored field finite and within its stability range", () => {
    const target = field();
    expect(deposit(target, linearSamples(240, 400), {
      waterLoad: 4,
      pigmentLoad: 4,
      wetnessLoad: 1,
    }).ok).toBe(true);
    expect(simulateStudioWetInkField(target, 32).ok).toBe(true);

    for (const tile of target.tiles.values()) {
      for (const source of [
        tile.water,
        tile.pigment,
        tile.wetness,
        tile.stain,
      ]) {
        expect([...source].every((value) =>
          Number.isFinite(value) && value >= 0 && value <= 4
        )).toBe(true);
      }
      expect([...tile.paper].every((value) =>
        Number.isFinite(value) && value >= 0 && value <= 1
      )).toBe(true);
    }
  });
});

describe("incremental dirty bounds and renderer-neutral tile uploads", () => {
  it("reports and consumes localized dirty bounds independently for later strokes", () => {
    const target = field();
    const first = deposit(target, [
      { x: 18, y: 18, timeMs: 0 },
    ], { radius: 3 });
    expect(first.ok).toBe(true);
    const firstDirty = consumeStudioWetInkDirtyBounds(target);
    expect(firstDirty).toEqual(first.ok ? first.value.dirtyBounds : null);
    expect(consumeStudioWetInkDirtyBounds(target)).toBeNull();

    const second = deposit(target, [
      { x: 102, y: 44, timeMs: 0 },
    ], { radius: 3 });
    expect(second.ok).toBe(true);
    const secondDirty = consumeStudioWetInkDirtyBounds(target);
    expect(secondDirty?.x).toBeGreaterThan((firstDirty?.x ?? 0) + (firstDirty?.width ?? 0));
  });

  it("emits ordered, edge-cropped RGBA tiles without consuming dirty state", () => {
    const target = field({
      width: 20,
      height: 20,
      tileSize: 16,
      maxUploadBytes: 4_096,
    });
    expect(deposit(target, [
      { x: 15.5, y: 15.5, timeMs: 0 },
    ], { radius: 5 }).ok).toBe(true);
    const dirty = target.dirtyBounds;
    const uploads = planStudioWetInkTileUploads(target);

    expect(uploads.ok).toBe(true);
    if (!uploads.ok) return;
    expect(uploads.value.map((upload) => [upload.tileX, upload.tileY])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(uploads.value.at(-1)).toMatchObject({ width: 4, height: 4 });
    for (const upload of uploads.value) {
      expect(upload.rgba).toHaveLength(upload.width * upload.height * 4);
      expect([...upload.rgba].every(Number.isFinite)).toBe(true);
    }
    expect(target.dirtyBounds).toEqual(dirty);
  });

  it("fails a tile-upload byte budget without mutating or consuming the field", () => {
    const target = field({
      width: 48,
      height: 32,
      tileSize: 16,
      maxUploadBytes: 1_024,
    });
    expect(deposit(target, [
      { x: 15.5, y: 16, timeMs: 0 },
    ], { radius: 5 }).ok).toBe(true);
    const before = studioWetInkFieldDigest(target);
    const dirty = target.dirtyBounds;
    expect(planStudioWetInkTileUploads(target)).toMatchObject({
      ok: false,
      code: "upload-budget-exceeded",
    });
    expect(target.dirtyBounds).toEqual(dirty);
    expect(studioWetInkFieldDigest(target)).toBe(before);
  });

  it("renders multi-spectral Beer-Lambert subtractive optical transmission and white gouache scattering correctly", () => {
    const sumiField = field({
      width: 32,
      height: 32,
      tileSize: 32,
      spectralAbsorption: { r: 1.0, g: 0.96, b: 0.88 },
    });
    deposit(sumiField, [{ x: 16, y: 16, timeMs: 0 }], { radius: 10 });
    const sumiUploads = planStudioWetInkTileUploads(sumiField);
    expect(sumiUploads.ok).toBe(true);
    if (!sumiUploads.ok) return;
    expect(sumiUploads.value[0]?.rgba.some((byte) => byte > 0)).toBe(true);

    const gouacheField = field({
      width: 32,
      height: 32,
      tileSize: 32,
      spectralAbsorption: { r: -1.0, g: -1.0, b: -1.0 },
    });
    deposit(gouacheField, [{ x: 16, y: 16, timeMs: 0 }], { radius: 10 });
    const gouacheUploads = planStudioWetInkTileUploads(gouacheField);
    expect(gouacheUploads.ok).toBe(true);
    if (!gouacheUploads.ok) return;
    const rgba = gouacheUploads.value[0]?.rgba ?? new Uint8ClampedArray(0);
    // White gouache pixels must have R=255, G=255, B=255 and non-zero scattering alpha
    let foundWhitePixel = false;
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index] === 255 && rgba[index + 1] === 255 && rgba[index + 2] === 255 && rgba[index + 3]! > 0) {
        foundWhitePixel = true;
        break;
      }
    }
    expect(foundWhitePixel).toBe(true);
  });
});
