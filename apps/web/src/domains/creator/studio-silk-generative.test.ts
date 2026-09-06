import { describe, expect, it } from "vitest";

import {
  expandStudioSilkSample,
  studioSilkVariationCount,
} from "./studio-silk-generative";

describe("studio-silk-generative", () => {
  it("emits multi-arm mirrored silk filaments", () => {
    const points = expandStudioSilkSample(
      { x: 500, y: 600, pressure: 0.8 },
      { arms: 4, mirror: true, trailCopies: 2, centerX: 400, centerY: 600 },
    );
    // 4 arms × 2 mirrors × (1 live + 2 trails) = 24
    expect(points.length).toBe(24);
    expect(studioSilkVariationCount({ arms: 4, mirror: true, trailCopies: 2 })).toBe(24);
  });

  it("keeps pressures falling along trails", () => {
    const points = expandStudioSilkSample(
      { x: 450, y: 600, pressure: 1 },
      {
        arms: 1,
        mirror: false,
        trailCopies: 2,
        trailFalloff: 0.5,
        centerX: 400,
        centerY: 600,
        noiseForceScale: 0,
      },
    );
    expect(points[0]?.pressure).toBe(1);
    expect(points[1]?.pressure).toBeCloseTo(0.5, 5);
    expect(points[2]?.pressure).toBeCloseTo(0.25, 5);
  });

  it("applies deterministic noise force and spiral trail bend", () => {
    const quiet = expandStudioSilkSample(
      { x: 480, y: 610, pressure: 0.75, t: 0.2 },
      {
        arms: 1,
        mirror: false,
        trailCopies: 1,
        centerX: 400,
        centerY: 600,
        noiseForceScale: 0,
        spiral: false,
      },
    );
    const noisy = expandStudioSilkSample(
      { x: 480, y: 610, pressure: 0.75, t: 0.2 },
      {
        arms: 1,
        mirror: false,
        trailCopies: 1,
        centerX: 400,
        centerY: 600,
        noiseForceScale: 8,
        noiseSeed: 42,
        spiral: true,
      },
    );
    expect(noisy).toHaveLength(quiet.length);
    // Noise + spiral must move the filament off the pure radial geometry.
    expect(
      Math.hypot(
        (noisy[0]?.x ?? 0) - (quiet[0]?.x ?? 0),
        (noisy[0]?.y ?? 0) - (quiet[0]?.y ?? 0),
      ),
    ).toBeGreaterThan(0.5);
    // Same seed → identical points
    const noisyAgain = expandStudioSilkSample(
      { x: 480, y: 610, pressure: 0.75, t: 0.2 },
      {
        arms: 1,
        mirror: false,
        trailCopies: 1,
        centerX: 400,
        centerY: 600,
        noiseForceScale: 8,
        noiseSeed: 42,
        spiral: true,
      },
    );
    expect(noisyAgain).toEqual(noisy);
  });
});
