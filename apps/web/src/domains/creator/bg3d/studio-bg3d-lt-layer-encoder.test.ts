import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeStudioBg3dLtLayers } from "./studio-bg3d-lt-layer-encoder";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

class FakeCanvasContext {
  readonly putImages: Uint8ClampedArray[] = [];
  readonly drawnCanvases: FakeCanvas[] = [];

  createImageData(width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4) };
  }

  clearRect() {}

  putImageData(imageData: { readonly data: Uint8ClampedArray }) {
    this.putImages.push(imageData.data.slice());
  }

  drawImage(canvas: FakeCanvas) {
    this.drawnCanvases.push(canvas);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeCanvasContext();
  private encodingCount = 0;

  constructor(private readonly kind: "layer" | "composite") {}

  getContext(type: string) {
    return type === "2d" ? this.context : null;
  }

  toDataURL(type: string) {
    expect(type).toBe("image/png");
    this.encodingCount += 1;
    const payload = this.kind === "layer"
      ? `bGF5ZXIt${this.encodingCount}`
      : "Y29tcG9zaXRl";
    return `data:image/png;base64,${payload}#transient-fragment`;
  }
}

function layer(
  role: StudioBg3dLtRasterLayer["role"],
  pixels: readonly number[],
): StudioBg3dLtRasterLayer {
  return {
    role,
    width: 2,
    height: 1,
    data: Uint8ClampedArray.from(pixels),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encodeStudioBg3dLtLayers", () => {
  it("encodes each raster in paint order and returns a frozen composite contract", () => {
    const layerCanvas = new FakeCanvas("layer");
    const compositeCanvas = new FakeCanvas("composite");
    const canvases = [layerCanvas, compositeCanvas];
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvases.shift()),
    });
    const color = layer("color", [10, 20, 30, 255, 40, 50, 60, 255]);
    const line = layer("main-line", [0, 0, 0, 255, 0, 0, 0, 0]);

    const encoded = encodeStudioBg3dLtLayers([color, line]);

    expect(layerCanvas.width).toBe(2);
    expect(layerCanvas.height).toBe(1);
    expect(compositeCanvas.width).toBe(2);
    expect(compositeCanvas.height).toBe(1);
    expect(layerCanvas.context.putImages).toEqual([color.data, line.data]);
    expect(compositeCanvas.context.drawnCanvases).toEqual([layerCanvas, layerCanvas]);
    expect(encoded).toEqual({
      layers: [
        {
          role: "color",
          pngDataUrl: "data:image/png;base64,bGF5ZXIt1",
          width: 2,
          height: 1,
        },
        {
          role: "main-line",
          pngDataUrl: "data:image/png;base64,bGF5ZXIt2",
          width: 2,
          height: 1,
        },
      ],
      compositePngDataUrl: "data:image/png;base64,Y29tcG9zaXRl",
    });
    expect(Object.isFrozen(encoded)).toBe(true);
    expect(Object.isFrozen(encoded.layers)).toBe(true);
    expect(encoded.layers.every(Object.isFrozen)).toBe(true);
  });

  it("rejects empty and dimensionally inconsistent layer sets before DOM encoding", () => {
    expect(() => encodeStudioBg3dLtLayers([])).toThrow("LT layers are empty.");
    expect(() =>
      encodeStudioBg3dLtLayers([
        layer("color", [10, 20, 30, 255, 40, 50, 60, 255]),
        {
          role: "tone",
          width: 1,
          height: 1,
          data: new Uint8ClampedArray(4),
        },
      ])
    ).toThrow("LT layer dimensions do not match.");
  });

  it("fails closed when the DOM canvas encoder is unavailable", () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => null,
      })),
    });

    expect(() =>
      encodeStudioBg3dLtLayers([
        layer("color", [10, 20, 30, 255, 40, 50, 60, 255]),
      ])
    ).toThrow("2D PNG context unavailable.");
  });
});
