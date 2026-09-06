import { describe, expect, it } from "vitest";

import { generate3dSpeedLines } from "./studio-3d-speed-lines-generator";

describe("Studio 3D Speed Lines Generator", () => {
  it("generates radial focus speed lines converging towards a 3D point", () => {
    const res = generate3dSpeedLines({
      kind: "radial-focus",
      lineCount: 36,
      innerRadius: 2.0,
      outerRadius: 8.0,
      focusPoint: [0, 1.5, 0],
      lineThickness: 0.05,
      lengthVariation: 0.5,
      taperFactor: 0.8,
      densityNoise: 0.2,
      color: "#ffffff",
      opacity: 0.9,
    });

    expect(res.kind).toBe("radial-focus");
    expect(res.totalLines).toBe(36);
    expect(res.segments.length).toBe(36);

    // Verify lines start far and end close to focus point
    const first = res.segments[0];
    const distStart = Math.hypot(first.start[0] - 0, first.start[2] - 0);
    const distEnd = Math.hypot(first.end[0] - 0, first.end[2] - 0);

    expect(distStart).toBeGreaterThan(distEnd);
  });

  it("generates linear action streaks along camera axis", () => {
    const res = generate3dSpeedLines({
      kind: "linear-streak",
      lineCount: 20,
      innerRadius: 1.0,
      outerRadius: 10.0,
      focusPoint: [0, 0, 0],
      lineThickness: 0.03,
      lengthVariation: 0.2,
      taperFactor: 0.5,
      densityNoise: 0.1,
      color: "#000000",
      opacity: 0.8,
    });

    expect(res.kind).toBe("linear-streak");
    expect(res.totalLines).toBe(20);
  });
});
