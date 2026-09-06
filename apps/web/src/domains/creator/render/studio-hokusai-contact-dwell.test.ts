import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_HOKUSAI_CONTACT_DWELL_MIN_RADIUS_PIXELS,
  STUDIO_HOKUSAI_CONTACT_DWELL_PRESSURELESS_CONTACT,
  STUDIO_HOKUSAI_CONTACT_DWELL_RADIUS_FACTOR,
  STUDIO_HOKUSAI_CONTACT_DWELL_STEPS,
  STUDIO_HOKUSAI_CONTACT_DWELL_STEP_MILLISECONDS,
  planStudioHokusaiContactDwell,
  type StudioHokusaiContactDwellSample,
} from "./studio-hokusai-contact-dwell";

function contact(
  overrides: Partial<StudioHokusaiContactDwellSample> = {},
): StudioHokusaiContactDwellSample {
  return {
    x: 200,
    y: 160,
    pressure: 0.6,
    tiltX: 0,
    tiltY: 0,
    timeMilliseconds: 0,
    ...overrides,
  };
}

const SURFACE = { surfaceWidth: 720, surfaceHeight: 1_080 } as const;

describe("Hokusai contact dwell recovery", () => {
  it("plans a bounded centred orbit for a zero-travel tap", () => {
    const plan = planStudioHokusaiContactDwell({
      samples: [contact()],
      radiusPixels: 1.25,
      ...SURFACE,
    });
    expect(plan).not.toBeNull();
    const samples = plan as readonly StudioHokusaiContactDwellSample[];
    expect(samples).toHaveLength(STUDIO_HOKUSAI_CONTACT_DWELL_STEPS + 1);

    const orbit = Math.max(
      STUDIO_HOKUSAI_CONTACT_DWELL_MIN_RADIUS_PIXELS,
      1.25 * STUDIO_HOKUSAI_CONTACT_DWELL_RADIUS_FACTOR,
    );
    for (const sample of samples) {
      const distance = Math.hypot(sample.x - 200, sample.y - 160);
      expect(distance).toBeCloseTo(orbit, 6);
      // The mark must stay a point: never further from the contact than the dab radius itself.
      expect(distance).toBeLessThanOrEqual(Math.max(1.25, orbit));
    }
    // A closed revolution keeps the composed mark centred on the artist's contact point.
    expect(samples.at(0)?.x).toBeCloseTo(samples.at(-1)?.x ?? Number.NaN, 6);
    expect(samples.at(0)?.y).toBeCloseTo(samples.at(-1)?.y ?? Number.NaN, 6);
  });

  it("advances time monotonically so a time-driven dab rate can also fire", () => {
    const samples = planStudioHokusaiContactDwell({
      samples: [contact({ timeMilliseconds: 1_234 })],
      radiusPixels: 6,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(samples.at(0)?.timeMilliseconds).toBe(
      1_234 + STUDIO_HOKUSAI_CONTACT_DWELL_STEP_MILLISECONDS,
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!.timeMilliseconds)
        .toBeGreaterThan(samples[index - 1]!.timeMilliseconds);
    }
  });

  it("keeps the artist's peak pressure and never exceeds full pressure", () => {
    const samples = planStudioHokusaiContactDwell({
      samples: [contact({ pressure: 0.2 }), contact({ pressure: 0.44 })],
      radiusPixels: 3,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(samples.every((sample) => sample.pressure === 0.44)).toBe(true);

    const clamped = planStudioHokusaiContactDwell({
      samples: [contact({ pressure: 4 })],
      radiusPixels: 3,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(clamped.every((sample) => sample.pressure === 1)).toBe(true);
  });

  it("substitutes the canonical contact weight for a pressureless channel", () => {
    // A mouse tap arrives with pressure 0 on every sample. Trusting that literal zero rendered
    // nothing at all, which is the defect this recovery exists to close.
    const samples = planStudioHokusaiContactDwell({
      samples: [contact({ pressure: 0 })],
      radiusPixels: 1.25,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(samples).not.toBeNull();
    expect(samples.every(
      (sample) => sample.pressure === STUDIO_HOKUSAI_CONTACT_DWELL_PRESSURELESS_CONTACT,
    )).toBe(true);
  });

  it("carries the contact tilt so a tilted stylus tap keeps its dab shape", () => {
    const samples = planStudioHokusaiContactDwell({
      samples: [contact({ tiltX: -0.4, tiltY: 0.25 })],
      radiusPixels: 8,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(samples.every((sample) => sample.tiltX === -0.4 && sample.tiltY === 0.25)).toBe(true);
  });

  it("never leaves the admitted stroke-local segment", () => {
    const samples = planStudioHokusaiContactDwell({
      samples: [contact({ x: 0, y: 0 })],
      radiusPixels: 64,
      surfaceWidth: 512,
      surfaceHeight: 512,
    }) as readonly StudioHokusaiContactDwellSample[];
    for (const sample of samples) {
      expect(sample.x).toBeGreaterThanOrEqual(0);
      expect(sample.y).toBeGreaterThanOrEqual(0);
      expect(sample.x).toBeLessThanOrEqual(511);
      expect(sample.y).toBeLessThanOrEqual(511);
    }
  });

  it("is a pure deterministic function of the admitted contact", () => {
    const input = {
      samples: [contact()],
      radiusPixels: 2.5,
      ...SURFACE,
    } as const;
    expect(planStudioHokusaiContactDwell(input))
      .toStrictEqual(planStudioHokusaiContactDwell(input));
  });

  it("plans nothing when there is no usable contact to recover", () => {
    expect(planStudioHokusaiContactDwell({
      samples: [],
      radiusPixels: 2,
      ...SURFACE,
    })).toBeNull();
    expect(planStudioHokusaiContactDwell({
      samples: [contact({ x: Number.NaN })],
      radiusPixels: 2,
      ...SURFACE,
    })).toBeNull();
    expect(planStudioHokusaiContactDwell({
      samples: [contact({ timeMilliseconds: Number.POSITIVE_INFINITY })],
      radiusPixels: 2,
      ...SURFACE,
    })).toBeNull();
    expect(planStudioHokusaiContactDwell({
      samples: [contact()],
      radiusPixels: 0,
      ...SURFACE,
    })).toBeNull();
    expect(planStudioHokusaiContactDwell({
      samples: [contact()],
      radiusPixels: 2,
      surfaceWidth: 1,
      surfaceHeight: 1,
    })).toBeNull();
  });

  it("scales the orbit with the dab radius but keeps a tracking-noise floor", () => {
    const tiny = planStudioHokusaiContactDwell({
      samples: [contact()],
      radiusPixels: 0.5,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(Math.hypot(tiny[0]!.x - 200, tiny[0]!.y - 160))
      .toBeCloseTo(STUDIO_HOKUSAI_CONTACT_DWELL_MIN_RADIUS_PIXELS, 6);

    const wide = planStudioHokusaiContactDwell({
      samples: [contact()],
      radiusPixels: 40,
      ...SURFACE,
    }) as readonly StudioHokusaiContactDwellSample[];
    expect(Math.hypot(wide[0]!.x - 200, wide[0]!.y - 160))
      .toBeCloseTo(40 * STUDIO_HOKUSAI_CONTACT_DWELL_RADIUS_FACTOR, 6);
  });
});

describe("Hokusai live worker contact dwell wiring", () => {
  const WORKER_SOURCE = readFileSync(
    new URL("./studio-hokusai-live-brush.worker.ts", import.meta.url),
    "utf8",
  );
  const TRANSACTION_SOURCE = readFileSync(
    new URL("./studio-hokusai-live-brush-transaction.ts", import.meta.url),
    "utf8",
  );

  it("runs the dwell only after the carrier itself composed no settle tail", () => {
    expect(WORKER_SOURCE).toContain(
      "const tail = await takePackedDirtyFrame(stroke)\n          ?? await depositContactDwell(stroke);",
    );
    // A stroke that already composed pixels must never have extra geometry appended to it.
    expect(WORKER_SOURCE).toContain("if (stroke.compositeBounds) return null;");
  });

  it("keeps the receipt describing the artist's own input, not the recovery samples", () => {
    const dwell = WORKER_SOURCE.slice(
      WORKER_SOURCE.indexOf("async function depositContactDwell"),
      WORKER_SOURCE.indexOf("/** One full-frame read is permitted only at canonical finish"),
    );
    expect(dwell).not.toContain("stroke.sampleCount");
    expect(dwell).not.toContain("stroke.inputChunks");
    // The recovery replays under the stroke's own seed so it stays deterministic.
    expect(dwell).toContain("stroke.canvas.beginStroke(stroke.brush, stroke.config.seed);");
  });

  it("accepts a single-sample tap as a restorable canonical source", () => {
    expect(TRANSACTION_SOURCE).toContain("|| source.points.length < 2");
    expect(TRANSACTION_SOURCE).not.toContain("|| source.points.length < 4");
  });
});
