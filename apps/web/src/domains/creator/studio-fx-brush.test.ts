import { describe, expect, it } from "vitest";

import {
  FX_BRUSH_SEED_RANGE,
  fxBrushSeedFromKey,
  planGlitterBrushParticles,
  planGlowBrushPasses,
  planNeonBrushPasses,
  planOilBrushDabs,
  planPastelBrushDabs,
} from "./studio-fx-brush";

describe("fxBrushSeedFromKey", () => {
  it("is stable for the same key and differs across ids", () => {
    expect(fxBrushSeedFromKey("draw-glow-1")).toBe(fxBrushSeedFromKey("draw-glow-1"));
    expect(fxBrushSeedFromKey("draw-glow-1")).not.toBe(fxBrushSeedFromKey("draw-glow-2"));
  });
});

describe("planGlowBrushPasses", () => {
  it("returns outer-to-core passes with decreasing width for hard glow", () => {
    const passes = planGlowBrushPasses(16, false);
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(passes[0]!.widthScale).toBeGreaterThan(passes.at(-1)!.widthScale);
    // The core must still land opaque, but each pass now carries an INCREMENTAL deposit on top of
    // the shells outside it rather than a standalone ring opacity, so the claim is about the
    // composited result. Back-to-front normal compositing gives 1 - prod(1 - o).
    const composited = passes.reduce((carried, pass) => 1 - (1 - carried) * (1 - pass.opacity), 0);
    expect(composited).toBeGreaterThan(0.8);
    // No single step may be a visible band: 255 * step must stay within a few 8-bit levels.
    let previous = 0;
    let worstStep = 0;
    for (const pass of passes) {
      const next = 1 - (1 - previous) * (1 - pass.opacity);
      worstStep = Math.max(worstStep, next - previous);
      previous = next;
    }
    expect(worstStep * 255).toBeLessThan(8);
  });

  it("soft glow uses a wider halo stack", () => {
    const soft = planGlowBrushPasses(16, true);
    const hard = planGlowBrushPasses(16, false);
    expect(soft[0]!.widthScale).toBeGreaterThan(hard[0]!.widthScale);
  });
});

describe("planNeonBrushPasses", () => {
  it("plans two coloured halos and one narrow luminous core", () => {
    const passes = planNeonBrushPasses(18);
    expect(passes).toHaveLength(3);
    expect(passes.map((pass) => pass.tone)).toEqual(["color", "color", "white-core"]);
    expect(passes[0]!.widthScale).toBeGreaterThan(passes[1]!.widthScale);
    expect(passes[1]!.widthScale).toBeGreaterThan(passes[2]!.widthScale);
    expect(passes[2]!.opacity).toBeGreaterThan(passes[1]!.opacity);
  });

  it("keeps a visible relative halo for very small neon widths", () => {
    expect(planNeonBrushPasses(2)[0]!.widthScale).toBeGreaterThan(
      planNeonBrushPasses(18)[0]!.widthScale
    );
  });
});

describe("planGlitterBrushParticles", () => {
  it("is deterministic and keeps particles near the stroke", () => {
    const points = [0, 0, 40, 0, 80, 10];
    const a = planGlitterBrushParticles({
      points,
      baseWidth: 20,
      seed: 42,
      mode: "glitter",
    });
    const b = planGlitterBrushParticles({
      points,
      baseWidth: 20,
      seed: 42,
      mode: "glitter",
    });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(4);
    for (const p of a) {
      expect(p.y).toBeGreaterThan(-40);
      expect(p.y).toBeLessThan(50);
      expect(p.radius).toBeGreaterThan(0);
    }
  });

  it("star-dust produces fewer larger sparks than glitter on the same path", () => {
    const points = [0, 0, 100, 0];
    const glitter = planGlitterBrushParticles({
      points,
      baseWidth: 24,
      seed: 7,
      mode: "glitter",
    });
    const dust = planGlitterBrushParticles({
      points,
      baseWidth: 24,
      seed: 7,
      mode: "star-dust",
    });
    expect(dust.length).toBeLessThan(glitter.length);
  });

  it.each(["glitter", "star-dust", "sparkle-star"] as const)(
    "guarantees a deterministic visible %s particle for every supported seed on a point tap",
    (mode) => {
      const missingSeeds: number[] = [];
      let minimumRadius = Number.POSITIVE_INFINITY;
      let minimumOpacity = Number.POSITIVE_INFINITY;

      for (let seed = FX_BRUSH_SEED_RANGE.min; seed <= FX_BRUSH_SEED_RANGE.max; seed++) {
        const input = {
          points: [12, 34],
          pressures: [0.5],
          baseWidth: 18,
          seed,
          mode,
        } as const;
        const particles = planGlitterBrushParticles(input);
        if (particles.length === 0) {
          missingSeeds.push(seed);
          continue;
        }
        minimumRadius = Math.min(minimumRadius, ...particles.map((particle) => particle.radius));
        minimumOpacity = Math.min(minimumOpacity, ...particles.map((particle) => particle.opacity));
        expect(planGlitterBrushParticles(input)).toEqual(particles);
      }

      expect(missingSeeds).toEqual([]);
      expect(minimumRadius).toBeGreaterThanOrEqual(0.35);
      expect(minimumOpacity).toBeGreaterThanOrEqual(0.35);
    }
  );

  it.each(["glitter", "star-dust", "sparkle-star"] as const)(
    "spreads a capped %s plan across the complete long stroke for every tested seed",
    (mode) => {
      for (let seed = 0; seed < 128; seed += 1) {
        const particles = planGlitterBrushParticles({
          points: [0, 0, 500, 0, 1_000, 0],
          pressures: [0.5, 0.5, 0.5],
          baseWidth: 20,
          seed,
          mode,
          maxParticles: 4,
        });

        expect(particles.length).toBeGreaterThan(0);
        expect(particles.length).toBeLessThanOrEqual(4);
        expect(Math.min(...particles.map((particle) => particle.x))).toBeLessThan(50);
        expect(Math.max(...particles.map((particle) => particle.x))).toBeGreaterThan(950);
      }
    }
  );
});

describe("planOilBrushDabs", () => {
  it("renders a deterministic pressure-sensitive dab for a point tap", () => {
    const low = planOilBrushDabs({
      points: [10, 12],
      pressures: [0],
      baseWidth: 22,
      seed: 3,
    });
    const high = planOilBrushDabs({
      points: [10, 12],
      pressures: [1],
      baseWidth: 22,
      seed: 3,
    });

    expect(low).toHaveLength(1);
    expect(planOilBrushDabs({
      points: [10, 12],
      pressures: [0],
      baseWidth: 22,
      seed: 3,
    })).toEqual(low);
    expect(high[0]!.radiusX).toBeGreaterThan(low[0]!.radiusX);
    expect(high[0]!.opacity).toBeGreaterThan(low[0]!.opacity);
  });

  it("emits elliptical dabs with finite geometry", () => {
    const dabs = planOilBrushDabs({
      points: [10, 10, 50, 30, 90, 20],
      pressures: [0.4, 0.8, 0.5],
      baseWidth: 22,
      seed: 3,
    });
    expect(dabs.length).toBeGreaterThan(2);
    for (const d of dabs) {
      expect(d.radiusX).toBeGreaterThan(0);
      expect(d.radiusY).toBeGreaterThan(0);
      expect(d.opacity).toBeGreaterThan(0);
      expect(Number.isFinite(d.angleRad)).toBe(true);
      // The bed is width-scaled, floored at the seven it used to be pinned at and capped so a
      // huge head cannot ask for sub-pixel hairs without bound.
      expect(d.bristles.length).toBeGreaterThanOrEqual(7);
      expect(d.bristles.length).toBeLessThanOrEqual(44);
      for (const bristle of d.bristles) {
        expect(Math.abs(bristle.offsetRatio)).toBeLessThanOrEqual(1.05);
        expect(bristle.radiusXRatio).toBeGreaterThan(0.6);
        expect(bristle.radiusYRatio).toBeGreaterThan(0);
        expect(bristle.opacity).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the wet carrier dense and centre-stable enough to avoid visible bead scallops", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 80, 40, 160, 10, 240, 60],
      pressures: [0.45, 0.7, 0.55, 0.8],
      baseWidth: 22,
      seed: 91,
    });

    expect(dabs.length).toBeGreaterThan(100);
    for (let index = 1; index < dabs.length; index += 1) {
      const previous = dabs[index - 1]!;
      const current = dabs[index]!;
      const centreGap = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(centreGap).toBeLessThanOrEqual(
        Math.min(previous.radiusY, current.radiusY) * 0.62,
      );
    }
  });

  it("preserves both ends and their aligned pressures when a long stroke hits the dab budget", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 500, 0, 1_000, 0],
      pressures: [0, 0.5, 1],
      baseWidth: 20,
      seed: 17,
      maxDabs: 2,
    });

    expect(dabs).toHaveLength(2);
    expect(Math.hypot(dabs[0]!.x, dabs[0]!.y)).toBeLessThan(2);
    expect(Math.hypot(dabs[1]!.x - 1_000, dabs[1]!.y)).toBeLessThan(2);
    expect(dabs[1]!.radiusX).toBeGreaterThan(dabs[0]!.radiusX);
  });

  it("still preserves both ends at the minimum budget on the prefix-stable ladder", () => {
    // The ladder honours the budget by coarsening the spacing, and it has to reserve BOTH
    // endpoints out of it. A budget of two leaves room for no interior station at all; fitting one
    // anyway would push the endpoint past the budget, where it is truncated off the end and the
    // stroke visibly stops short.
    const dabs = planOilBrushDabs({
      points: [0, 0, 500, 0, 1_000, 0],
      pressures: [0, 0.5, 1],
      baseWidth: 20,
      seed: 17,
      maxDabs: 2,
      capMode: "prefix-stable-ladder-v2",
    });

    expect(dabs).toHaveLength(2);
    expect(Math.hypot(dabs[0]!.x, dabs[0]!.y)).toBeLessThan(2);
    expect(Math.hypot(dabs[1]!.x - 1_000, dabs[1]!.y)).toBeLessThan(2);
  });

  it("leaves the budget-filling refit in place for callers that do not opt into the ladder", () => {
    // This planner also serves the airbrush family's exports, which have no carrier pipeline to
    // save and so nothing to buy with a redistributed bed. The ladder must stay opt-in: the same
    // stroke planned without `capMode` fills the budget exactly, as it always has.
    const points: number[] = [];
    for (let index = 0; index < 900; index += 1) points.push(index * 4, 200);
    const pressures = Array.from({ length: 900 }, () => 0.6);

    const refit = planOilBrushDabs({ points, pressures, baseWidth: 20, seed: 17, maxDabs: 512 });
    expect(refit).toHaveLength(512);

    const laddered = planOilBrushDabs({
      points,
      pressures,
      baseWidth: 20,
      seed: 17,
      maxDabs: 512,
      capMode: "prefix-stable-ladder-v2",
    });
    expect(laddered.length).toBeLessThan(512);
    // …but only by a ladder rung, never unboundedly.
    expect(laddered.length).toBeGreaterThan(512 / 1.19);
  });
});

describe("planPastelBrushDabs", () => {
  it("renders deterministic crossed anisotropic fibres for a pressure-sensitive point tap", () => {
    const low = planPastelBrushDabs({
      points: [10, 12],
      pressures: [0],
      baseWidth: 18,
      seed: 11,
    });
    const high = planPastelBrushDabs({
      points: [10, 12],
      pressures: [1],
      baseWidth: 18,
      seed: 11,
    });

    expect(low).toHaveLength(2);
    expect(planPastelBrushDabs({
      points: [10, 12],
      pressures: [0],
      baseWidth: 18,
      seed: 11,
    })).toEqual(low);
    expect(high[0]!.radiusX).toBeGreaterThan(low[0]!.radiusX);
    expect(low.every((dab) => dab.radiusX / dab.radiusY >= 3.2)).toBe(true);
    expect(low[1]!.angleRad - low[0]!.angleRad).toBeCloseTo(Math.PI / 2, 8);
    expect(high[0]!.opacity).toBeGreaterThan(low[0]!.opacity);
  });

  it("builds soft low-opacity build-up dabs", () => {
    const dabs = planPastelBrushDabs({
      points: [0, 0, 60, 0],
      baseWidth: 18,
      seed: 11,
    });
    expect(dabs.length).toBeGreaterThan(2);
    expect(dabs.every((d) => d.opacity <= 0.5)).toBe(true);
    expect(dabs.every((d) => d.radiusX / d.radiusY >= 3.2)).toBe(true);
    expect(dabs.every((d) => Math.abs(d.angleRad) <= 0.08)).toBe(true);
  });

  it("reserves a visible end dab instead of exhausting a tiny cap at the stroke head", () => {
    const dabs = planPastelBrushDabs({
      points: [0, 0, 500, 0, 1_000, 0],
      pressures: [0, 0.5, 1],
      baseWidth: 20,
      seed: 23,
      maxDabs: 2,
    });

    expect(dabs).toHaveLength(2);
    expect(Math.hypot(dabs[0]!.x, dabs[0]!.y)).toBeLessThan(6);
    expect(Math.hypot(dabs[1]!.x - 1_000, dabs[1]!.y)).toBeLessThan(6);
    expect(dabs[1]!.radiusX).toBeGreaterThan(dabs[0]!.radiusX);
    expect(dabs[1]!.opacity).toBeGreaterThan(dabs[0]!.opacity);
  });

  it("keeps a long stroke dense without exposing the shared 512-circle budget", () => {
    const dabs = planPastelBrushDabs({
      points: [0, 0, 8_000, 0],
      pressures: [0.62, 0.62],
      baseWidth: 20,
      seed: 23,
    });

    expect(dabs.length).toBeGreaterThan(3_000);
    expect(dabs.length).toBeLessThanOrEqual(4_096);
    expect(dabs.every((dab) => dab.radiusX / dab.radiusY >= 3.2)).toBe(true);
    let maximumGap = 0;
    for (let index = 1; index < dabs.length; index += 1) {
      const previous = dabs[index - 1]!;
      const current = dabs[index]!;
      maximumGap = Math.max(
        maximumGap,
        Math.hypot(current.x - previous.x, current.y - previous.y),
      );
    }
    expect(maximumGap).toBeLessThan(
      Math.min(...dabs.map((dab) => dab.radiusX)),
    );
    expect(Math.hypot(dabs[0]!.x, dabs[0]!.y)).toBeLessThan(1);
    expect(Math.hypot(dabs.at(-1)!.x - 8_000, dabs.at(-1)!.y)).toBeLessThan(1);
  });
});
