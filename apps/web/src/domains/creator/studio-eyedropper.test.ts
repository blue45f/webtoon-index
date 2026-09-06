import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_EYEDROPPER_SETTINGS,
  normalizeStudioEyedropperSettings,
  pickColorFromImageData,
  sampleColorFromImageData,
} from "./studio-eyedropper";

function makeImageData(width: number, height: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return data;
}

describe("pickColorFromImageData", () => {
  it("returns the hex color of an opaque pixel", () => {
    const data = makeImageData(4, 4, [255, 0, 128, 255]);
    expect(pickColorFromImageData(data, 4, 4, 1, 1)).toBe("#ff0080");
  });

  it("floors fractional coordinates onto the containing pixel", () => {
    const data = makeImageData(4, 4, [10, 20, 30, 255]);
    expect(pickColorFromImageData(data, 4, 4, 1.9, 2.4)).toBe("#0a141e");
  });

  it("returns null for out-of-bounds coordinates", () => {
    const data = makeImageData(4, 4, [255, 255, 255, 255]);
    expect(pickColorFromImageData(data, 4, 4, -1, 0)).toBeNull();
    expect(pickColorFromImageData(data, 4, 4, 4, 0)).toBeNull();
    expect(pickColorFromImageData(data, 4, 4, 0, 4)).toBeNull();
  });

  it("returns null for a fully transparent pixel", () => {
    const data = makeImageData(4, 4, [255, 0, 0, 0]);
    expect(pickColorFromImageData(data, 4, 4, 0, 0)).toBeNull();
  });

  it("alpha-weights a circular average and ignores hidden RGB in transparent pixels", () => {
    const data = makeImageData(3, 3, [0, 0, 0, 0]);
    const set = (x: number, y: number, rgba: [number, number, number, number]) => {
      const index = (y * 3 + x) * 4;
      data.set(rgba, index);
    };
    set(1, 1, [255, 0, 0, 255]);
    set(1, 0, [0, 0, 255, 128]);
    set(0, 1, [0, 255, 0, 0]);

    const sample = sampleColorFromImageData(data, 3, 3, 1, 1, { averageRadius: 1 });

    expect(sample).toMatchObject({
      hex: "#aa0055",
      sampleCount: 2,
      candidateCount: 5,
      averageRadius: 1,
    });
    expect(sample?.rgba[3]).toBe(192);
  });

  it("clips the average kernel at image edges without duplicating edge pixels", () => {
    const data = makeImageData(2, 2, [100, 120, 140, 255]);
    const sample = sampleColorFromImageData(data, 2, 2, 0, 0, { averageRadius: 2 });
    expect(sample).toMatchObject({ hex: "#64788c", sampleCount: 4, candidateCount: 4 });
  });

  it("fails closed for malformed dimensions, short buffers, and non-finite coordinates", () => {
    const data = makeImageData(1, 1, [255, 255, 255, 255]);
    expect(sampleColorFromImageData(data, 0, 1, 0, 0)).toBeNull();
    expect(sampleColorFromImageData(data, 2, 2, 0, 0)).toBeNull();
    expect(sampleColorFromImageData(data, 1, 1, Number.NaN, 0)).toBeNull();
  });
});

describe("normalizeStudioEyedropperSettings", () => {
  it("returns commercial-tool defaults for missing input", () => {
    expect(normalizeStudioEyedropperSettings()).toEqual(DEFAULT_STUDIO_EYEDROPPER_SETTINGS);
  });

  it("preserves valid sampling controls and clamps the average radius", () => {
    expect(normalizeStudioEyedropperSettings({
      reference: "active-layer",
      averageRadius: 999,
      target: "secondary",
      showLoupe: false,
      autoReturn: false,
      excludeLocked: true,
      excludeText: true,
      excludeBackground: true,
      excludeDraft: true,
      excludeReference: true,
    })).toEqual({
      reference: "active-layer",
      averageRadius: 32,
      target: "secondary",
      showLoupe: false,
      autoReturn: false,
      excludeLocked: true,
      excludeText: true,
      excludeBackground: true,
      excludeDraft: true,
      excludeReference: true,
    });
  });

  it("rejects unknown enum values and non-finite radii", () => {
    expect(normalizeStudioEyedropperSettings({
      reference: "future" as "merged",
      averageRadius: Number.POSITIVE_INFINITY,
      target: "future" as "primary",
    })).toMatchObject({ reference: "merged", averageRadius: 0, target: "primary" });
  });
});
