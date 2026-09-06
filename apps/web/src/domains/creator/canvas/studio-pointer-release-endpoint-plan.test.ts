import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import {
  planStudioPointerReleaseEndpoint,
  type StudioPointerReleaseEndpointPlanInput,
} from "./studio-pointer-release-endpoint-plan";

import type { DrawEl } from "../studio-element-model";

import {
  captureStudioInkInputContractV1,
  captureStudioInkInputContractV2,
} from "@/shared/lib/studio-ink-input-contract";

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 10, 10],
    stroke: "#112233",
    strokeWidth: 8,
    brush: "pen",
    pressures: [0.25, 0.75],
    ...overrides,
  };
}

function plan(
  completed: DrawEl,
  overrides: Partial<Omit<StudioPointerReleaseEndpointPlanInput, "stroke">> = {}
) {
  return planStudioPointerReleaseEndpoint({
    stroke: completed,
    endpoint: { x: 20, y: 15 },
    pointer: { pointerType: "mouse", pressure: 0.5 },
    pressureCurve: 1,
    ...overrides,
  });
}

describe("planStudioPointerReleaseEndpoint", () => {
  it.each([
    ["identical", { x: 10, y: 10 }],
    ["inside the endpoint epsilon", { x: 10 + 0.5e-6, y: 10 }],
    ["non-finite", { x: Number.NaN, y: 10 }],
  ])("preserves the exact stroke reference for an %s endpoint", (_, endpoint) => {
    const completed = stroke();
    const result = plan(completed, { endpoint });

    expect(result).toEqual({ stroke: completed, appended: false });
    expect(result.stroke).toBe(completed);
  });

  it("appends one endpoint without mutating the source stroke", () => {
    const completed = stroke();
    const before = structuredClone(completed);
    const result = plan(completed);

    expect(result.appended).toBe(true);
    expect(result.stroke).not.toBe(completed);
    expect(result.stroke.points).toEqual([0, 0, 10, 10, 20, 15]);
    expect(result.stroke.pressures).toEqual([0.25, 0.75, 0.75]);
    expect(completed).toEqual(before);
  });

  it("aligns a short pressure channel before retaining pointerup's last pen-contact pressure", () => {
    const completed = stroke({ pressures: [0.4] });
    const result = plan(completed, {
      pointer: { pointerType: "pen", pressure: 0 },
      pressureCurve: 4,
    });

    expect(result.stroke.pressures).toEqual([0.4, 0.5, 0.4]);
  });

  it("uses the versioned nominal pressure when the prior channel is missing", () => {
    const completed = stroke({
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      pressures: undefined,
    });
    const result = plan(completed, {
      pointer: { pointerType: "mouse", pressure: 0 },
    });

    expect(result.stroke.pressures).toEqual([1, 1, 1]);
  });

  it("captures normalized stylus and dynamics channels for a dynamic pen brush", () => {
    const completed = stroke({
      brush: "spray",
      pressures: [0.3, 0.6],
      tiltXs: [12, 999, 1_000],
      tiltYs: undefined,
      twists: [10],
      speeds: [3],
      tangentialPressures: [0.2],
    });
    const result = plan(completed, {
      pointer: {
        pointerType: "pen",
        pressure: 0.25,
        tiltX: 120,
        tiltY: -140,
        twist: 500,
        tangentialPressure: 4,
      },
      pressureCurve: 2,
    });

    expect(result.stroke.pressures?.slice(0, 2)).toEqual([0.3, 0.6]);
    expect(result.stroke.pressures?.at(-1)).toBeCloseTo(
      Math.pow(0.25, 0.78 * 2),
      10
    );
    expect(result.stroke.tiltXs).toEqual([12, 999, 90]);
    expect(result.stroke.tiltYs).toEqual([0, 0, -90]);
    expect(result.stroke.twists).toEqual([10, 0, 359]);
    expect(result.stroke.speeds).toEqual([3, 0, 3]);
    expect(result.stroke.tangentialPressures).toEqual([0.2, 0, 1]);
  });

  it("falls back to the last barrel-pressure sample when pointerup omits it", () => {
    const completed = stroke({
      brush: "airbrush",
      tangentialPressures: [-0.3, 0.45],
    });
    const result = plan(completed, {
      pointer: { pointerType: "pen", pressure: 0, tangentialPressure: Number.NaN },
    });

    expect(result.stroke.tangentialPressures).toEqual([-0.3, 0.45, 0.45]);
  });

  it("captures zeroed mouse orientation for calligraphy but preserves unrelated channels", () => {
    const speeds = [4, 5];
    const tangentialPressures = [0.1, 0.2];
    const completed = stroke({
      brush: "calligraphy",
      speeds,
      tangentialPressures,
    });
    const result = plan(completed, {
      pointer: {
        pointerType: "mouse",
        pressure: 0.5,
        tiltX: 80,
        tiltY: 70,
        twist: 180,
      },
    });

    expect(result.stroke.tiltXs).toEqual([0, 0, 0]);
    expect(result.stroke.tiltYs).toEqual([0, 0, 0]);
    expect(result.stroke.twists).toEqual([0, 0, 0]);
    expect(result.stroke.speeds).toBe(speeds);
    expect(result.stroke.tangentialPressures).toBe(tangentialPressures);
  });

  it("leaves optional hardware channels untouched for a regular pen brush", () => {
    const tiltXs = [1];
    const tiltYs = [2];
    const twists = [3];
    const speeds = [4];
    const tangentialPressures = [0.1];
    const completed = stroke({ tiltXs, tiltYs, twists, speeds, tangentialPressures });
    const result = plan(completed, {
      pointer: {
        pointerType: "pen",
        pressure: 0,
        tiltX: 80,
        tiltY: 70,
        twist: 180,
        tangentialPressure: 0.9,
      },
    });

    expect(result.stroke.tiltXs).toBe(tiltXs);
    expect(result.stroke.tiltYs).toBe(tiltYs);
    expect(result.stroke.twists).toBe(twists);
    expect(result.stroke.speeds).toBe(speeds);
    expect(result.stroke.tangentialPressures).toBe(tangentialPressures);
  });

  it("aligns all persisted sensor channels for a new regular pen stroke", () => {
    const completed = stroke({
      inkInput: captureStudioInkInputContractV1("pen"),
      tiltXs: [11],
      tiltYs: [-9],
      twists: [45],
      speeds: [2.5],
      tangentialPressures: [-0.2],
    });
    const result = plan(completed, {
      pointer: {
        pointerType: "pen",
        pressure: 0.5,
        tiltX: 35,
        tiltY: -28,
        twist: 300,
        tangentialPressure: 0.4,
      },
    });

    expect(result.stroke.tiltXs).toEqual([11, 0, 35]);
    expect(result.stroke.tiltYs).toEqual([-9, 0, -28]);
    expect(result.stroke.twists).toEqual([45, 0, 300]);
    expect(result.stroke.speeds).toEqual([2.5, 0, 2.5]);
    expect(result.stroke.tangentialPressures).toEqual([-0.2, 0, 0.4]);
  });

  it("aligns v2 altitude, azimuth, contact geometry and gesture-relative time", () => {
    const completed = stroke({
      inkInput: captureStudioInkInputContractV2("pen"),
      altitudeAngles: [0.8],
      azimuthAngles: [1.2],
      contactWidths: [3],
      contactHeights: [2],
      sampleTimeOffsets: [0],
    });
    const result = plan(completed, {
      pointer: {
        pointerType: "pen",
        pressure: 0.5,
        altitudeAngle: 0.45,
        azimuthAngle: 2.75,
        width: 4.5,
        height: 3.5,
        sampleTimeOffset: 24,
      },
    });

    expect(result.stroke.altitudeAngles).toEqual([0.8, Math.PI / 2, 0.45]);
    expect(result.stroke.azimuthAngles).toEqual([1.2, 0, 2.75]);
    expect(result.stroke.contactWidths).toEqual([3, 1, 4.5]);
    expect(result.stroke.contactHeights).toEqual([2, 1, 3.5]);
    expect(result.stroke.sampleTimeOffsets).toEqual([0, 0, 24]);
  });

  it("does not reinterpret a legacy v1 contract as persisted v2 sensor arrays", () => {
    const completed = stroke({
      inkInput: captureStudioInkInputContractV1("pen"),
    });
    const result = plan(completed, {
      pointer: {
        pointerType: "pen",
        altitudeAngle: 0.45,
        azimuthAngle: 2.75,
        width: 4.5,
        height: 3.5,
        sampleTimeOffset: 24,
      },
    });

    expect(result.stroke.altitudeAngles).toBeUndefined();
    expect(result.stroke.azimuthAngles).toBeUndefined();
    expect(result.stroke.contactWidths).toBeUndefined();
    expect(result.stroke.contactHeights).toBeUndefined();
    expect(result.stroke.sampleTimeOffsets).toBeUndefined();
  });
});
