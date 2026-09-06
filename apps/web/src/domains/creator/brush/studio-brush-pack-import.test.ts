/**
 * Brush pack import — bytes to drawn pixels.
 *
 * The contract this file defends is "registered means drawable". A parser that
 * returns a `BrushProgramIR` proves nothing on its own: the failure this suite
 * exists to catch is an import that lands in the library, applies to the pen,
 * and then deposits nothing (or deposits at a wrong size/opacity) because the
 * IR never reached the fields the dab planner reads.
 *
 * So every format goes: real corpus bytes → import → snapshot → the same
 * `planStudioDynamicBrushDabs` the pen uses → rasterized coverage.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { planStudioDynamicBrushDabs } from "./studio-brush-dynamics";
import { createBrush, writeBrushJson } from "./studio-brush-library";
import {
  KRITA_REFERENCE_MAX_DIAMETER_PX,
  MYPAINT_LOG_RADIUS_SCALE,
  STUDIO_BRUSH_PACK_ACCEPT,
  StudioBrushProgramImportError,
  importStudioBrushJsonText,
  importStudioKppBytes,
  importStudioMybBytes,
  studioBrushPackFormatOf,
  studioBrushSnapshotFromProgram,
} from "./studio-brush-pack-import";

import type { StudioBrushSnapshot } from "./studio-brush-library";

function corpusBytes(relative: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../../../tests/corpus/brushes/${relative}`, import.meta.url))),
  );
}

/**
 * The drawability probe: run the imported snapshot through the production dab
 * planner over a diagonal stroke with a rising pressure ramp, then stamp every
 * dab into a coverage grid. Non-zero cells are pixels the artist would see.
 */
function drawCoverage(snapshot: StudioBrushSnapshot): {
  dabCount: number;
  coveredPixels: number;
  minSize: number;
  maxSize: number;
} {
  const points: number[] = [];
  const pressures: number[] = [];
  const samples = 24;
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    points.push(20 + t * 160, 20 + t * 160);
    pressures.push(0.05 + t * 0.95);
  }
  const dabs = planStudioDynamicBrushDabs({
    points,
    pressures,
    baseWidth: snapshot.strokeWidth,
    baseOpacity: snapshot.brushOpacity,
    settings: snapshot.brushDynamics,
  });

  const width = 220;
  const height = 220;
  const grid = new Uint8Array(width * height);
  let minSize = Number.POSITIVE_INFINITY;
  let maxSize = 0;
  for (const dab of dabs) {
    minSize = Math.min(minSize, dab.size);
    maxSize = Math.max(maxSize, dab.size);
    if (dab.opacity <= 0 || dab.size <= 0) continue;
    const radius = dab.size / 2;
    const left = Math.max(0, Math.floor(dab.x - radius));
    const right = Math.min(width - 1, Math.ceil(dab.x + radius));
    const top = Math.max(0, Math.floor(dab.y - radius));
    const bottom = Math.min(height - 1, Math.ceil(dab.y + radius));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = x + 0.5 - dab.x;
        const dy = y + 0.5 - dab.y;
        if (dx * dx + dy * dy <= radius * radius) grid[y * width + x] = 1;
      }
    }
  }
  return {
    dabCount: dabs.length,
    coveredPixels: grid.reduce((sum, cell) => sum + cell, 0),
    minSize: Number.isFinite(minSize) ? minSize : 0,
    maxSize,
  };
}

describe("brush pack format sniffing", () => {
  it("routes every extension the file inputs advertise", () => {
    expect(studioBrushPackFormatOf("Studio.abr")).toBe("abr");
    expect(studioBrushPackFormatOf("wash-soft.myb")).toBe("myb");
    expect(studioBrushPackFormatOf("ink.KPP")).toBe("kpp");
    expect(studioBrushPackFormatOf("ink.sut")).toBe("sut");
    expect(studioBrushPackFormatOf("group.sutg")).toBe("sutg");
    expect(studioBrushPackFormatOf("paint.bundle")).toBe("bundle");
    expect(studioBrushPackFormatOf("saved.json")).toBe("json");
    expect(studioBrushPackFormatOf("nameless", "application/x-photoshop")).toBe("abr");
    expect(studioBrushPackFormatOf("nameless", "application/x-krita-resourcebundle"))
      .toBe("bundle");
  });

  it("advertises .myb and .kpp on the accept list, so the picker can offer them", () => {
    for (const extension of [".json", ".abr", ".myb", ".kpp", ".sut", ".sutg", ".bundle"]) {
      expect(STUDIO_BRUSH_PACK_ACCEPT).toContain(extension);
    }
  });
});

describe("libmypaint .myb import draws", () => {
  it("turns ink-crisp.myb into a brush that deposits pixels", () => {
    const result = importStudioMybBytes(corpusBytes("myb/ink-crisp.myb"), "ink-crisp.myb");
    expect(result.format).toBe("myb");
    expect(result.brushes).toHaveLength(1);

    const [brush] = result.brushes;
    const snapshot = brush!.snapshot;
    // radius_logarithmic 1.45 with a +0.25 pressure delta → the widest dab is
    // exp(1.70) in radius. The gateway stores that as (1.45 + 0.25) / 6, so the
    // scale constant is what turns the LUT tap back into log-radius.
    const widestTap = (1.45 + 0.25) / MYPAINT_LOG_RADIUS_SCALE;
    expect(snapshot.strokeWidth).toBe(
      Math.round(2 * Math.exp(widestTap * MYPAINT_LOG_RADIUS_SCALE)),
    );
    expect(snapshot.strokeWidth).toBeGreaterThan(0);
    expect(snapshot.brushOpacity).toBeGreaterThan(0.5);

    const drawn = drawCoverage(snapshot);
    expect(drawn.dabCount).toBeGreaterThan(0);
    expect(drawn.coveredPixels).toBeGreaterThan(500);
    // Pressure genuinely reaches the geometry: thin at the start, thick at the end.
    expect(drawn.maxSize).toBeGreaterThan(drawn.minSize);
  });

  it("carries slow_tracking into the stabilizer and names every unmapped setting", () => {
    const result = importStudioMybBytes(corpusBytes("myb/wash-soft.myb"), "wash-soft.myb");
    const snapshot = result.brushes[0]!.snapshot;
    // slow_tracking 1.8 → strength 0.18 → 2 on the 0..10 stabilizer slider.
    expect(snapshot.stabilizer).toBe(2);

    // dabs_per_actual_radius 3.4 → 100 / (2 × 3.4) = 15% spacing, not the
    // 10% default the old `dabs_per_radius` misspelling silently produced.
    expect(snapshot.brushDynamics?.spacingRatio).toBeCloseTo(0.15);

    // The honest ledger: libmypaint settings the common IR does NOT carry.
    // smudge (→ mixing) and dabs_per_actual_radius (→ spacing) are applied,
    // so naming them here would be a false loss report.
    expect(result.unmapped).toContain("myb:smudge_length");
    expect(result.unmapped).toContain("myb:color_h");
    expect(result.unmapped).not.toContain("myb:smudge");
    expect(result.unmapped).not.toContain("myb:dabs_per_actual_radius");
    expect(result.unmapped.every((entry) => entry.length > 0)).toBe(true);

    expect(drawCoverage(snapshot).coveredPixels).toBeGreaterThan(500);
  });

  it("refuses a non-v3 document loudly instead of registering a fake brush", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 2, settings: {} }));
    expect(() => importStudioMybBytes(bytes, "old.myb")).toThrow(StudioBrushProgramImportError);
  });
});

describe("Krita .kpp import draws", () => {
  it("turns a paintbrush preset's diameter and opacity into drawable settings", () => {
    const result = importStudioKppBytes(
      corpusBytes("kpp/paintbrush-ink-basic.kpp"),
      "paintbrush-ink-basic.kpp",
    );
    expect(result.format).toBe("kpp");
    const snapshot = result.brushes[0]!.snapshot;
    expect(snapshot.strokeWidth).toBeGreaterThanOrEqual(1);
    expect(snapshot.strokeWidth).toBeLessThanOrEqual(80);
    expect(snapshot.brushOpacity).toBeGreaterThan(0);

    const drawn = drawCoverage(snapshot);
    expect(drawn.dabCount).toBeGreaterThan(0);
    expect(drawn.coveredPixels).toBeGreaterThan(200);
  });

  it("keeps the pressure curve preset drawable and pressure-reactive", () => {
    const result = importStudioKppBytes(
      corpusBytes("kpp/paintbrush-pressure-curve.kpp"),
      "paintbrush-pressure-curve.kpp",
    );
    const snapshot = result.brushes[0]!.snapshot;
    const drawn = drawCoverage(snapshot);
    expect(drawn.coveredPixels).toBeGreaterThan(200);
    expect(drawn.maxSize).toBeGreaterThanOrEqual(drawn.minSize);
  });

  it("routes a mypaintbrush preset through the myb lane and still draws", () => {
    const result = importStudioKppBytes(
      corpusBytes("kpp/mypaint-wash-soft.kpp"),
      "mypaint-wash-soft.kpp",
    );
    const snapshot = result.brushes[0]!.snapshot;
    expect(drawCoverage(snapshot).coveredPixels).toBeGreaterThan(200);
    // Delegated myb settings stay traceable through the kpp prefix.
    expect(result.unmapped.some((entry) => entry.startsWith("kpp:"))).toBe(true);
  });

  it("refuses bytes that are not a Krita preset", () => {
    expect(() => importStudioKppBytes(new Uint8Array([1, 2, 3, 4]), "broken.kpp")).toThrow(
      StudioBrushProgramImportError,
    );
  });
});

describe("BrushProgramIR → snapshot mapping surfaces what it cannot carry", () => {
  const baseProgram = {
    id: "test:program",
    name: "Test",
    stabilizer: { kind: "ema" as const, strength: 0.5, predictionMs: 0 },
    sizeDynamics: [{ input: "constant" as const, curve: [0.024, 0.024], min: 0, max: 1 }],
    flowDynamics: [{ input: "constant" as const, curve: [0.8, 0.8], min: 0, max: 1 }],
    geometry: {
      kind: "perfect-freehand" as const,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      capStart: true,
      capEnd: true,
    },
    tip: { kind: "round" as const, hardness: 0.9, spacingPct: 12, angleJitterDeg: 0 },
    mixing: { kind: "none" as const, strength: 0 },
    output: { target: "vector-path" as const, bake: "editable-proxy" as const },
    providerPreference: ["hokusai-natural-media"],
  };

  it("reads the Krita diameter reference rather than guessing a size", () => {
    const { snapshot } = studioBrushSnapshotFromProgram(baseProgram);
    expect(snapshot.strokeWidth).toBe(Math.round(0.024 * KRITA_REFERENCE_MAX_DIAMETER_PX));
    expect(snapshot.brushOpacity).toBeCloseTo(0.8, 5);
    expect(snapshot.stabilizer).toBe(5);
  });

  it("reports smudge, image tips and unsupported inputs instead of faking them", () => {
    const { unmapped, warnings } = studioBrushSnapshotFromProgram({
      ...baseProgram,
      mixing: { kind: "smudge", strength: 0.4 },
      tip: { kind: "image", hardness: 1, spacingPct: 10, angleJitterDeg: 15 },
      sizeDynamics: [
        ...baseProgram.sizeDynamics,
        { input: "tiltAltitude", curve: [0, 1], min: 0, max: 1 },
      ],
    });
    expect(unmapped).toContain("mixing.smudge");
    expect(unmapped).toContain("tip.image");
    expect(unmapped).toContain("tip.angleJitterDeg");
    expect(unmapped).toContain("sizeDynamics(tiltAltitude)");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("flags a non-linear pressure LUT as an approximation", () => {
    const { warnings } = studioBrushSnapshotFromProgram({
      ...baseProgram,
      sizeDynamics: [
        { input: "pressure", curve: [0, 0.02, 0.05, 0.1, 0.2, 0.45, 0.75, 1], min: 0, max: 1 },
      ],
    });
    expect(warnings.some((warning) => warning.includes("직선 근사"))).toBe(true);
  });
});

describe("app-private .json stays on one reporting shape", () => {
  it("imports a round-tripped saved brush", () => {
    const saved = createBrush("내 펜", {
      ...importStudioMybBytes(corpusBytes("myb/ink-crisp.myb"), "ink-crisp.myb").brushes[0]!
        .snapshot,
    });
    const result = importStudioBrushJsonText(writeBrushJson(saved), "내 펜.json");
    expect(result.format).toBe("json");
    expect(result.brushes[0]!.snapshot.strokeWidth).toBe(saved.strokeWidth);
    expect(drawCoverage(result.brushes[0]!.snapshot).coveredPixels).toBeGreaterThan(100);
  });
});
