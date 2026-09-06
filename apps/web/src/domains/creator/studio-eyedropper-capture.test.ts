import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS,
  captureStudioEyedropperCanvasRegion,
  planStudioEyedropperCapture,
  planStudioEyedropperReference,
  sampleStudioEyedropperCapture,
  sampleStudioEyedropperTopLayer,
  studioEyedropperCaptureHasOpaqueCenter,
  withStudioEyedropperIsolatedLayer,
} from "./studio-eyedropper-capture";

function fakeCanvas(width: number, height: number, rgba: readonly number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset);
  }
  const getImageData = vi.fn(() => ({ data, width, height }));
  return {
    width,
    height,
    getContext: vi.fn(() => ({ getImageData })),
    getImageData,
  };
}

describe("planStudioEyedropperCapture", () => {
  it("bounds a maximum-radius read to 65×65 pixels regardless of document size", () => {
    const plan = planStudioEyedropperCapture({
      point: { x: 500, y: 80_000 },
      bounds: { width: 1_080, height: 200_000 },
      averageRadius: 32,
    });

    expect(plan).toMatchObject({
      x: 468,
      y: 79_968,
      width: 65,
      height: 65,
      sampleX: 32,
      sampleY: 32,
      averageRadius: 32,
    });
    expect(plan?.pixelCount).toBe(STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS);
  });

  it("clips at document edges without shifting the sample point", () => {
    expect(planStudioEyedropperCapture({
      point: { x: 1, y: 2 },
      bounds: { width: 10, height: 12 },
      averageRadius: 4,
      loupeRadius: 5,
    })).toMatchObject({
      x: 0,
      y: 0,
      width: 7,
      height: 8,
      sampleX: 1,
      sampleY: 2,
    });
  });

  it("rejects non-finite, out-of-bounds, and empty document inputs", () => {
    expect(planStudioEyedropperCapture({
      point: { x: Number.NaN, y: 0 },
      bounds: { width: 10, height: 10 },
    })).toBeNull();
    expect(planStudioEyedropperCapture({
      point: { x: 10, y: 0 },
      bounds: { width: 10, height: 10 },
    })).toBeNull();
    expect(planStudioEyedropperCapture({
      point: { x: 0, y: 0 },
      bounds: { width: 0, height: 10 },
    })).toBeNull();
  });
});

describe("captureStudioEyedropperCanvasRegion", () => {
  it("requests an inverse-scaled 1:1 crop and samples it", () => {
    const plan = planStudioEyedropperCapture({
      point: { x: 50, y: 60 },
      bounds: { width: 100, height: 100 },
      averageRadius: 1,
      loupeRadius: 2,
    });
    expect(plan).not.toBeNull();
    const canvas = fakeCanvas(5, 5, [12, 34, 56, 255]);
    const toCanvas = vi.fn(() => canvas as unknown as HTMLCanvasElement);

    const capture = captureStudioEyedropperCanvasRegion({ toCanvas }, plan!, 2);

    expect(toCanvas).toHaveBeenCalledWith({
      x: 96,
      y: 116,
      width: 10,
      height: 10,
      pixelRatio: 0.5,
    });
    expect(sampleStudioEyedropperCapture(capture!)).toMatchObject({
      hex: "#0c2238",
      averageRadius: 1,
    });
  });

  it("fails closed when canvas reads throw or adapters ignore the crop budget", () => {
    const plan = planStudioEyedropperCapture({
      point: { x: 5, y: 5 },
      bounds: { width: 20, height: 20 },
    });
    expect(plan).not.toBeNull();
    expect(captureStudioEyedropperCanvasRegion({
      toCanvas: () => {
        throw new DOMException("tainted", "SecurityError");
      },
    }, plan!)).toBeNull();
    expect(captureStudioEyedropperCanvasRegion({
      toCanvas: () => ({
        width: 1_000,
        height: 1_000,
        getContext: vi.fn(),
      }) as unknown as HTMLCanvasElement,
    }, plan!)).toBeNull();
  });
});

describe("planStudioEyedropperReference", () => {
  const layers = [
    { id: "paint", visible: true, locked: false, textual: false, background: false, draft: false, reference: false, hit: true },
    { id: "locked", visible: true, locked: true, textual: false, background: false, draft: false, reference: false, hit: true },
    { id: "caption", visible: true, locked: false, textual: true, background: false, draft: false, reference: false, hit: true },
  ] as const;

  it("keeps exact merged display color independent of layer exclusions", () => {
    expect(planStudioEyedropperReference({
      settings: { reference: "merged", excludeLocked: true, excludeText: true },
      layers,
      activeLayerId: "paint",
    })).toEqual({ kind: "merged", reference: "merged" });
  });

  it("resolves the active layer and explains unavailable active references", () => {
    expect(planStudioEyedropperReference({
      settings: { reference: "active-layer" },
      layers,
      activeLayerId: "paint",
    })).toEqual({ kind: "layer", reference: "active-layer", layerId: "paint" });
    expect(planStudioEyedropperReference({
      settings: { reference: "active-layer", excludeText: true },
      layers,
      activeLayerId: "caption",
    })).toEqual({
      kind: "unavailable",
      reference: "active-layer",
      reason: "active-layer-excluded",
    });
  });

  it("walks top-to-bottom and skips locked/text layers according to settings", () => {
    expect(planStudioEyedropperReference({
      settings: { reference: "top-layer", excludeLocked: true, excludeText: true },
      layers,
      activeLayerId: null,
    })).toEqual({ kind: "layer-stack", reference: "top-layer", layerIds: ["paint"] });
    expect(planStudioEyedropperReference({
      settings: { reference: "top-layer", excludeText: true },
      layers: layers.map((layer) => ({ ...layer, hit: layer.id === "caption" })),
      activeLayerId: null,
    })).toEqual({ kind: "unavailable", reference: "top-layer", reason: "no-layer-at-point" });
    expect(planStudioEyedropperReference({
      settings: { reference: "top-layer" },
      layers,
      activeLayerId: null,
    })).toEqual({
      kind: "layer-stack",
      reference: "top-layer",
      layerIds: ["caption", "locked", "paint"],
    });
  });
});

describe("top-layer alpha fallback and visibility transaction", () => {
  it("falls through an empty top candidate to the first opaque layer", () => {
    const emptyData = new Uint8ClampedArray(3 * 3 * 4);
    emptyData.set([255, 0, 0, 255], 0); // neighbor is opaque, exact center remains transparent
    const empty = {
      imageData: { data: emptyData, width: 3, height: 3 },
      sampleX: 1,
      sampleY: 1,
      averageRadius: 1,
      plan: { x: 0, y: 0, width: 3, height: 3, sampleX: 1, sampleY: 1, averageRadius: 1, loupeRadius: 1, pixelCount: 9 },
    };
    const opaque = {
      ...empty,
      imageData: { data: new Uint8ClampedArray(3 * 3 * 4).fill(255), width: 3, height: 3 },
    };
    opaque.imageData.data.set([20, 40, 60, 255], (1 * 3 + 1) * 4);
    const result = sampleStudioEyedropperTopLayer(
      ["top", "below"],
      (layerId) => layerId === "top" ? empty : opaque,
    );
    expect(studioEyedropperCaptureHasOpaqueCenter(empty)).toBe(false);
    expect(result).toMatchObject({ layerId: "below" });
  });

  it("isolates one element root and restores every visibility bit after an exception", () => {
    const state = new Map([["below", true], ["target", true], ["hidden", false]]);
    const handles = [...state.keys()].map((id) => ({
      id,
      getVisible: () => state.get(id) ?? false,
      setVisible: (visible: boolean) => state.set(id, visible),
    }));
    const flush = vi.fn();

    expect(() => withStudioEyedropperIsolatedLayer(handles, "target", () => {
      expect(Object.fromEntries(state)).toEqual({ below: false, target: true, hidden: false });
      throw new Error("capture failed");
    }, flush)).toThrow("capture failed");
    expect(Object.fromEntries(state)).toEqual({ below: true, target: true, hidden: false });
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
