import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  resolveStudioMagneticLassoGesture,
  studioMagneticLassoFieldKey,
} from "./studio-magnetic-lasso-authority";

const field = {
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([0, 255]),
};

describe("Studio magnetic-lasso execution authority", () => {
  it("uses ordinary lasso only when the magnetic provider was not selected", () => {
    expect(resolveStudioMagneticLassoGesture(null, { status: "disabled" })).toEqual({
      status: "ordinary",
      field: null,
    });
  });

  it("admits only the ready field from the exact selected image epoch", () => {
    const key = studioMagneticLassoFieldKey("image-1", "data:image/png;base64,a", false, true);
    expect(resolveStudioMagneticLassoGesture(key, { status: "ready", key, field })).toEqual({
      status: "selected",
      providerId: "luminance-edge-snap",
      field,
    });

    const staleKey = studioMagneticLassoFieldKey(
      "image-2",
      "data:image/png;base64,a",
      false,
      true,
    );
    expect(resolveStudioMagneticLassoGesture(staleKey, {
      status: "ready",
      key,
      field,
    })).toMatchObject({
      status: "rejected",
      providerId: "luminance-edge-snap",
      field: null,
    });
  });

  it("rejects loading and unavailable provider epochs instead of returning an ordinary field", () => {
    const key = studioMagneticLassoFieldKey("image-1", "source", false, false);
    expect(resolveStudioMagneticLassoGesture(key, { status: "loading", key })).toMatchObject({
      status: "rejected",
      field: null,
    });
    expect(resolveStudioMagneticLassoGesture(key, {
      status: "unavailable",
      key,
      reason: "decode failed",
    })).toEqual({
      status: "rejected",
      providerId: "luminance-edge-snap",
      field: null,
      reason: "decode failed",
    });
  });

  it("wires lasso and polygon lasso through the pre-gesture rejection boundary", () => {
    const pageSource = readStudioPageCompositionSource();
    const pointerSource = readFileSync(
      new URL(
        "./studio-cuttoon-editor/studio-cuttoon-stage-pointers-down-pixel.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(pageSource).toContain('(pixelTool === "lasso" || pixelTool === "poly-lasso")');
    expect(pageSource).toContain('status: "unavailable"');
    expect(pointerSource).toContain('magneticLassoResolution.status === "rejected"');
    expect(pointerSource).toContain("일반 올가미로 자동 전환하지 않습니다.");
    expect(pointerSource.indexOf('magneticLassoResolution.status === "rejected"'))
      .toBeLessThan(pointerSource.indexOf("beginPolyLassoSession("));
    expect(pointerSource.indexOf('magneticLassoResolution.status === "rejected"'))
      .toBeLessThan(pointerSource.lastIndexOf("beginSelectionDrag("));
  });
});
