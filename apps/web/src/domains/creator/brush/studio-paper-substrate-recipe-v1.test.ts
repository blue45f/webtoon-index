import { describe, expect, it } from "vitest";

import {
  createStudioPaperSubstrateRecipeV1,
  STUDIO_PAPER_SUBSTRATE_MICROSTRUCTURE_V1,
  studioPaperSubstrateRecipeInputV1,
} from "./studio-paper-substrate-recipe-v1";
import { PAPER_GRAIN_KINDS } from "./studio-paper-texture";

const SEED = 0x1234_5678;

describe("studio paper substrate recipes", () => {
  it("maps every one of the 21 artist sheets onto a recipe the provider accepts", () => {
    const rejected = PAPER_GRAIN_KINDS.filter(
      (kind) => createStudioPaperSubstrateRecipeV1(kind, SEED) === null,
    );
    expect(rejected).toEqual([]);
  });

  it("ships as a recipe, not as a height map", () => {
    // A 256² R8 tile is 65,536 bytes. The recipe that reproduces it must be orders of magnitude
    // smaller or the "bake at runtime, ship nothing" claim is false.
    const sizes = PAPER_GRAIN_KINDS.map(
      (kind) =>
        new TextEncoder().encode(
          JSON.stringify(studioPaperSubstrateRecipeInputV1(kind, SEED)),
        ).length,
    );
    const largest = Math.max(...sizes);
    expect(largest).toBeLessThan(2_048);
    expect(largest * 21).toBeLessThan(256 * 256);
  });

  it("is deterministic — the same sheet always fingerprints the same", () => {
    for (const kind of PAPER_GRAIN_KINDS.slice(0, 5)) {
      const a = createStudioPaperSubstrateRecipeV1(kind, SEED);
      const b = createStudioPaperSubstrateRecipeV1(kind, SEED);
      expect(a?.fingerprint).toBe(b?.fingerprint);
    }
  });

  it("gives every sheet its own identity — no two sheets collapse to one recipe", () => {
    const fingerprints = new Set(
      PAPER_GRAIN_KINDS.map((kind) => createStudioPaperSubstrateRecipeV1(kind, SEED)?.fingerprint),
    );
    // toned-tan and toned-gray share a microstructure but differ in preset params, so all 21
    // must still be distinct.
    expect(fingerprints.size).toBe(PAPER_GRAIN_KINDS.length);
  });

  it("scales grain frequency with documentScale so zooming the sheet is a real axis", () => {
    const base = studioPaperSubstrateRecipeInputV1("cold-press", SEED, { documentScale: 1 });
    const doubled = studioPaperSubstrateRecipeInputV1("cold-press", SEED, { documentScale: 2 });
    expect(doubled.relief.frequency).toBeCloseTo(base.relief.frequency * 2, 10);
    expect(doubled.worldScale).toBe(base.worldScale);
  });

  it("turns the seamless torus on only when a period is asked for", () => {
    expect(studioPaperSubstrateRecipeInputV1("rough", SEED).seamlessPeriod).toBeNull();
    expect(
      studioPaperSubstrateRecipeInputV1("rough", SEED, { seamlessPeriod: 256 }).seamlessPeriod,
    ).toEqual([256, 256]);
  });

  it("keeps weave structure exclusive to woven sheets", () => {
    const woven = ["canvas", "linen-canvas"] as const;
    for (const kind of PAPER_GRAIN_KINDS) {
      const amplitude = STUDIO_PAPER_SUBSTRATE_MICROSTRUCTURE_V1[kind].weaveAmplitude;
      if ((woven as readonly string[]).includes(kind)) {
        expect(amplitude).toBeGreaterThan(0);
      } else {
        expect(amplitude).toBe(0);
      }
    }
  });

  it("gives rough sheets more structure than plate-finish sheets", () => {
    const micro = STUDIO_PAPER_SUBSTRATE_MICROSTRUCTURE_V1;
    const structure = (kind: keyof typeof micro): number => {
      const entry = micro[kind];
      return (
        entry.weaveAmplitude + entry.fiberAmplitude + entry.poreAmplitude + entry.speckleAmplitude
      );
    };
    expect(structure("charcoal")).toBeGreaterThan(structure("hot-press"));
    expect(structure("sanded-pastel")).toBeGreaterThan(structure("marker-pad"));
    expect(structure("rough")).toBeGreaterThan(structure("bristol"));
  });
});
