import { describe, expect, it } from "vitest";

import { interpolateStudioPuppetPins } from "./studio-puppet-warp-animator";

describe("interpolateStudioPuppetPins", () => {
  it("interpolates pin positions linearly at mid time", () => {
    const kf1 = {
      timeSec: 0,
      pins: { pin1: { x: 100, y: 100 } },
    };
    const kf2 = {
      timeSec: 1,
      pins: { pin1: { x: 200, y: 300 } },
    };

    const mid = interpolateStudioPuppetPins(kf1, kf2, 0.5, { easing: "linear" });
    expect(mid.pin1.x).toBe(150);
    expect(mid.pin1.y).toBe(200);
  });

  it("applies easeInOut easing correctly", () => {
    const kf1 = {
      timeSec: 0,
      pins: { pin1: { x: 0, y: 0 } },
    };
    const kf2 = {
      timeSec: 1,
      pins: { pin1: { x: 100, y: 100 } },
    };

    const quarter = interpolateStudioPuppetPins(kf1, kf2, 0.25, { easing: "easeInOut" });
    // easeInOut at t=0.25 is 2 * 0.25^2 = 0.125
    expect(quarter.pin1.x).toBe(12.5);
  });
});
