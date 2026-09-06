import { describe, it, expect } from "vitest";

import { Studio3DCinematographyRail } from "./studio-3d-cinematography-rail";

describe("Studio3DCinematographyRail", () => {
  it("initializes with default 3-keyframe rail and calculates total duration", () => {
    const rail = new Studio3DCinematographyRail();
    expect(rail.getKeyframes().length).toBe(3);
    expect(rail.getDurationSec()).toBe(4.0);
  });

  it("smoothly evaluates position and FOV at fractional times along the spline", () => {
    const rail = new Studio3DCinematographyRail();

    const startFrame = rail.evaluateAt(0);
    expect(startFrame.position[0]).toBeCloseTo(0, 2);
    expect(startFrame.focalLengthMm).toBe(35);
    expect(startFrame.fovDeg).toBeCloseTo(37.8, 1);

    const midFrame = rail.evaluateAt(2.0);
    expect(midFrame.position[0]).toBeCloseTo(2.5, 2);
    expect(midFrame.focalLengthMm).toBe(50);
    expect(midFrame.dutchRollDeg).toBe(-5);

    const fractional = rail.evaluateAt(1.0);
    expect(fractional.position[0]).toBeGreaterThan(0);
    expect(fractional.position[0]).toBeLessThan(2.5);
    expect(fractional.focalLengthMm).toBeGreaterThan(35);
    expect(fractional.focalLengthMm).toBeLessThan(50);
  });

  it("generates discrete webtoon panel cut proposals with aspect ratio recommendations", () => {
    const rail = new Studio3DCinematographyRail();
    const cuts = rail.generateWebtoonPanelProposals(4);

    expect(cuts.length).toBe(4);
    expect(cuts[0].panelIndex).toBe(0);
    expect(cuts[3].panelIndex).toBe(3);

    // Final cut (85mm telephoto) recommends 9:16 vertical closeup
    expect(cuts[3].recommendedAspect).toBe("9:16-vertical");
    expect(cuts[3].shotLabel).toContain("클로즈업");
  });

  it("handles keyframe additions and deletions reactively", () => {
    const rail = new Studio3DCinematographyRail([]);
    expect(rail.getDurationSec()).toBe(0);

    rail.addKeyframe({
      id: "custom-1",
      timeSec: 10,
      position: [1, 2, 3],
      target: [0, 0, 0],
      focalLengthMm: 24,
      dutchRollDeg: 0,
      dofFocusDistance: 5,
      dofAperture: 2.8,
      tempoEasing: "linear",
    });

    expect(rail.getDurationSec()).toBe(10);
    expect(rail.getKeyframes().length).toBe(1);

    rail.removeKeyframe("custom-1");
    expect(rail.getKeyframes().length).toBe(0);
  });
});
