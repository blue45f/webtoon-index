import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
  decodeStudioBg3dThreeRgbaDepth,
  renderStudioBg3dLtLayers,
  type StudioBg3dLtRasterInput,
  type StudioBg3dLtRenderSettings,
} from "./studio-bg3d-lt-render";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  type StudioBg3dLineOutputSettings,
  type StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";

describe("decodeStudioBg3dThreeRgbaDepth", () => {
  it("matches Three RGBADepthPacking reference channel factors", () => {
    const packed = new Uint8Array([
      0, 0, 0, 0,
      128, 0, 0, 0,
      0, 128, 0, 0,
      0, 0, 128, 0,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const result = decodeStudioBg3dThreeRgbaDepth({ width: 6, height: 1, rgba: packed });

    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toHaveLength(6);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0.5);
    expect(result[2]).toBe(128 / 65_536);
    expect(result[3]).toBe(128 / 16_777_216);
    expect(result[4]).toBe(1 / 16_777_216);
    expect(result[5]).toBe(1);
  });

  it("decodes exact quarter-depth reference pixels", () => {
    const packed = new Uint8ClampedArray([
      0, 0, 0, 0,
      64, 0, 0, 0,
      128, 0, 0, 0,
      192, 0, 0, 0,
      255, 255, 255, 255,
    ]);

    expect(
      Array.from(decodeStudioBg3dThreeRgbaDepth({ width: 5, height: 1, rgba: packed }))
    ).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("optionally converts WebGL bottom-up rows to top-down order", () => {
    const bottomUp = new Uint8Array([
      64, 0, 0, 0,
      128, 0, 0, 0,
      192, 0, 0, 0,
      255, 255, 255, 255,
    ]);
    const unchanged = decodeStudioBg3dThreeRgbaDepth({
      width: 2,
      height: 2,
      rgba: bottomUp,
    });
    const flipped = decodeStudioBg3dThreeRgbaDepth({
      width: 2,
      height: 2,
      rgba: bottomUp,
      flipY: true,
    });

    expect(Array.from(unchanged)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(Array.from(flipped)).toEqual([0.75, 1, 0.25, 0.5]);
  });

  it("returns a fresh finite normalized array without mutating packed bytes", () => {
    const packed = new Uint8Array([
      13, 91, 207, 44,
      250, 128, 64, 32,
    ]);
    const before = packed.slice();
    const first = decodeStudioBg3dThreeRgbaDepth({ width: 2, height: 1, rgba: packed });
    const second = decodeStudioBg3dThreeRgbaDepth({ width: 2, height: 1, rgba: packed });

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(packed).toEqual(before);
    for (const value of first) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    first[0] = 1;
    expect(packed).toEqual(before);
  });

  it("rejects invalid shapes, packed types, budgets, and flip options", () => {
    const valid = { width: 1, height: 1, rgba: new Uint8Array(4) };
    expect(() =>
      decodeStudioBg3dThreeRgbaDepth(null as unknown as typeof valid)
    ).toThrow(TypeError);
    expect(() => decodeStudioBg3dThreeRgbaDepth({ ...valid, width: 0 })).toThrow(RangeError);
    expect(() => decodeStudioBg3dThreeRgbaDepth({ ...valid, height: 1.5 })).toThrow(RangeError);
    expect(() =>
      decodeStudioBg3dThreeRgbaDepth({ ...valid, rgba: new Uint8Array(3) })
    ).toThrow(/length/u);
    expect(() =>
      decodeStudioBg3dThreeRgbaDepth({
        width: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1,
        height: 1,
        rgba: new Uint8Array(),
      })
    ).toThrow(/pixel budget/u);
    expect(() =>
      decodeStudioBg3dThreeRgbaDepth({
        ...valid,
        rgba: new Uint16Array(4) as unknown as Uint8Array,
      })
    ).toThrow(TypeError);
    expect(() =>
      decodeStudioBg3dThreeRgbaDepth({
        ...valid,
        flipY: "yes" as unknown as boolean,
      })
    ).toThrow(/flipY/u);
  });
});

function settings(
  line: Partial<StudioBg3dLineOutputSettings> = {},
  tone: Partial<StudioBg3dToneOutputSettings> = {}
): StudioBg3dLtRenderSettings {
  return {
    line: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.line,
      textureLineEnabled: false,
      ...line,
    },
    // Most tests exercise an isolated line/tone branch. Opt out of the product default color
    // base unless the case explicitly requests it.
    tone: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.tone,
      mode: "none",
      type: "grayscale",
      ...tone,
    },
  };
}

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number]
): StudioBg3dLtRasterInput {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba.set(pixel(x, y), offset);
    }
  }
  return { width, height, rgba };
}

function depthImage(
  width: number,
  height: number,
  sample: (x: number, y: number) => number
): Float32Array {
  return Float32Array.from({ length: width * height }, (_, index) =>
    sample(index % width, Math.floor(index / width))
  );
}

function splitImage(width = 9, height = 9): StudioBg3dLtRasterInput {
  return image(width, height, (x) =>
    x < Math.floor(width / 2) ? [16, 16, 16, 255] : [240, 240, 240, 255]
  );
}

function alphaCount(data: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] > 0) count += 1;
  }
  return count;
}

function layerData(
  result: ReturnType<typeof renderStudioBg3dLtLayers>,
  role: "color" | "main-line" | "texture-line" | "tone"
): Uint8ClampedArray {
  const layer = result.layers.find((candidate) => candidate.role === role);
  if (!layer) throw new Error(`Expected ${role} layer.`);
  return layer.data;
}

describe("renderStudioBg3dLtLayers", () => {
  it("preserves the shaded material capture as the default backmost color layer", () => {
    const input = image(2, 1, (x) =>
      x === 0 ? [214, 86, 52, 255] : [48, 126, 184, 128]
    );
    const result = renderStudioBg3dLtLayers(input, {
      line: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.line, enabled: false },
      tone: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.tone,
    });

    expect(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.tone).toMatchObject({
      mode: "flat",
      type: "color",
      opacity: 1,
    });
    expect(result.layers.map((layer) => layer.role)).toEqual(["color"]);
    expect(layerData(result, "color")).toEqual(input.rgba);
    expect(layerData(result, "color")).not.toBe(input.rgba);
  });

  it("keeps color hue and source alpha while applying cel lightness and opacity", () => {
    const input = image(2, 1, (x) =>
      x === 0 ? [180, 60, 30, 200] : [30, 90, 180, 100]
    );
    const result = renderStudioBg3dLtLayers(
      input,
      settings(
        { enabled: false },
        { mode: "cel", type: "color", levels: 3, opacity: 0.5 }
      )
    );
    const output = layerData(result, "color");

    expect(output[3]).toBe(100);
    expect(output[7]).toBe(50);
    expect(output[0]).toBeGreaterThan(output[1]);
    expect(output[1]).toBeGreaterThan(output[2]);
    expect(output[6]).toBeGreaterThan(output[5]);
    expect(output[5]).toBeGreaterThan(output[4]);
  });

  it("returns a deterministic main line for a luminance boundary", () => {
    const input = splitImage();
    const options = settings({ strength: 1, accuracy: 1, smoothing: 0 });
    const first = renderStudioBg3dLtLayers(input, options);
    const second = renderStudioBg3dLtLayers(input, options);

    expect(first).toEqual(second);
    expect(first.layers.map((layer) => layer.role)).toEqual(["main-line"]);
    expect(first.layers[0]).toMatchObject({ width: 9, height: 9 });
    expect(first.layers[0]?.data).toBeInstanceOf(Uint8ClampedArray);
    expect(first.layers[0]?.data).toHaveLength(9 * 9 * 4);
    expect(alphaCount(first.layers[0]!.data)).toBeGreaterThan(0);
  });

  it("omits every disabled or empty output", () => {
    const uniform = image(5, 5, () => [128, 128, 128, 255]);
    const disabled = renderStudioBg3dLtLayers(
      uniform,
      settings({ enabled: false, textureLineEnabled: true }, { mode: "none" })
    );
    const emptyLine = renderStudioBg3dLtLayers(
      uniform,
      settings({ enabled: true, textureLineEnabled: false }, { mode: "none" })
    );

    expect(disabled.layers).toEqual([]);
    expect(emptyLine.layers).toEqual([]);
  });

  it("returns tone, texture line, and main line in back-to-front paint order", () => {
    const input = image(16, 16, (x, y) => {
      const checker = (x + y) % 2 === 0 ? 32 : 220;
      return [checker, checker, checker, 255];
    });
    const result = renderStudioBg3dLtLayers(
      input,
      settings(
        {
          strength: 1,
          accuracy: 1,
          smoothing: 0,
          textureLineEnabled: true,
          textureLineStrength: 1,
          creaseAngleDegrees: 0,
        },
        { mode: "flat", type: "grayscale", levels: 4 }
      )
    );

    expect(result.layers.map((layer) => layer.role)).toEqual([
      "tone",
      "texture-line",
      "main-line",
    ]);
  });

  it("does not mutate or alias caller-owned color, depth, or settings", () => {
    const base = splitImage();
    const depth = Float32Array.from({ length: base.width * base.height }, (_, index) =>
      index % base.width < 4 ? 0.25 : 0.75
    );
    const input = { ...base, depth };
    const options = settings({ depthEnabled: true, depthStrength: 1 });
    const rgbaBefore = base.rgba.slice();
    const depthBefore = depth.slice();
    const settingsBefore = structuredClone(options);
    const result = renderStudioBg3dLtLayers(input, options);

    expect(base.rgba).toEqual(rgbaBefore);
    expect(depth).toEqual(depthBefore);
    expect(options).toEqual(settingsBefore);
    const output = layerData(result, "main-line");
    output[0] = output[0] === 0 ? 255 : 0;
    expect(base.rgba).toEqual(rgbaBefore);
  });

  it("uses normalized depth discontinuities when color is uniform", () => {
    const base = image(9, 9, () => [128, 128, 128, 255]);
    const depth = Float32Array.from({ length: 81 }, (_, index) =>
      index % 9 < 4 ? 0.1 : 0.9
    );
    const withoutDepth = renderStudioBg3dLtLayers(
      { ...base, depth },
      settings({ depthEnabled: false, textureLineEnabled: false })
    );
    const withDepth = renderStudioBg3dLtLayers(
      { ...base, depth },
      settings({ depthEnabled: true, depthStrength: 1, strength: 1, textureLineEnabled: false })
    );

    expect(withoutDepth.layers).toEqual([]);
    expect(withDepth.layers.map((layer) => layer.role)).toEqual(["main-line"]);
    expect(alphaCount(layerData(withDepth, "main-line"))).toBeGreaterThan(0);
  });

  it("inks the foreground side of a depth step without a far-surface double contour", () => {
    const width = 9;
    const height = 7;
    const base = image(width, height, () => [128, 128, 128, 255]);
    const depth = depthImage(width, height, (x) => (x < 4 ? 0.25 : 0.75));
    const result = renderStudioBg3dLtLayers(
      { ...base, depth },
      settings({
        widthPx: 1,
        strength: 1,
        accuracy: 1,
        exteriorOutlineStrength: 0,
        depthEnabled: true,
        depthStrength: 1,
        depthOutlineOnly: true,
        textureLineEnabled: false,
      })
    );
    const output = layerData(result, "main-line");

    expect(output[(3 * width + 3) * 4 + 3]).toBeGreaterThan(0);
    expect(output[(3 * width + 4) * 4 + 3]).toBe(0);
  });

  it("detects a compressed far-depth contour without inking a constant depth ramp", () => {
    const width = 9;
    const height = 7;
    const base = image(width, height, () => [128, 128, 128, 255]);
    const line = {
      widthPx: 1,
      strength: 1,
      accuracy: 1,
      exteriorOutlineStrength: 0,
      depthEnabled: true,
      depthStrength: 1,
      depthOutlineOnly: true,
      textureLineEnabled: false,
    } satisfies Partial<StudioBg3dLineOutputSettings>;
    const farStep = depthImage(width, height, (x) => (x < 4 ? 0.99 : 0.995));
    const ramp = depthImage(width, height, (x, y) => 0.8 + x * 0.005 + y * 0.001);

    const contour = renderStudioBg3dLtLayers({ ...base, depth: farStep }, settings(line));
    const planar = renderStudioBg3dLtLayers({ ...base, depth: ramp }, settings(line));

    expect(alphaCount(layerData(contour, "main-line"))).toBeGreaterThan(0);
    expect(planar.layers).toEqual([]);
  });

  it("extracts high-frequency texture into its own layer and honors its switch", () => {
    const input = image(15, 15, (x, y) => {
      const value = (x + y) % 2 === 0 ? 48 : 208;
      return [value, value, value, 255];
    });
    const enabled = renderStudioBg3dLtLayers(
      input,
      settings({
        strength: 1,
        accuracy: 1,
        smoothing: 0,
        textureLineEnabled: true,
        textureLineStrength: 1,
        creaseAngleDegrees: 0,
      })
    );
    const disabled = renderStudioBg3dLtLayers(
      input,
      settings({ textureLineEnabled: false })
    );

    expect(enabled.layers.some((layer) => layer.role === "texture-line")).toBe(true);
    expect(alphaCount(layerData(enabled, "texture-line"))).toBeGreaterThan(0);
    expect(disabled.layers.some((layer) => layer.role === "texture-line")).toBe(false);
  });

  it("applies configured ink color and never exceeds source alpha", () => {
    const input = image(9, 7, (x) =>
      x < 4 ? [0, 0, 0, 80] : x === 4 ? [255, 255, 255, 160] : [255, 255, 255, 0]
    );
    const result = renderStudioBg3dLtLayers(
      input,
      settings({ color: "#123abc", strength: 1, exteriorOutlineStrength: 2 })
    );
    const output = layerData(result, "main-line");
    for (let index = 0; index < input.width * input.height; index += 1) {
      const offset = index * 4;
      expect(output[offset + 3]).toBeLessThanOrEqual(input.rgba[offset + 3]);
      if (output[offset + 3] > 0) {
        expect(Array.from(output.slice(offset, offset + 3))).toEqual([0x12, 0x3a, 0xbc]);
      }
    }
  });

  it("expands wider line settings without changing image bounds", () => {
    const input = splitImage(21, 9);
    const thin = renderStudioBg3dLtLayers(input, settings({ widthPx: 1, strength: 1 }));
    const wide = renderStudioBg3dLtLayers(input, settings({ widthPx: 8, strength: 1 }));

    expect(alphaCount(layerData(wide, "main-line"))).toBeGreaterThan(
      alphaCount(layerData(thin, "main-line"))
    );
    expect(layerData(wide, "main-line")).toHaveLength(input.width * input.height * 4);
  });

  it("renders bounded flat grayscale tones with the requested levels and opacity", () => {
    const input = image(8, 2, (x, y) => {
      const value = Math.round((x / 7) * 255);
      return [value, value, value, y === 0 ? 200 : 100];
    });
    const result = renderStudioBg3dLtLayers(
      input,
      settings({ enabled: false }, { mode: "flat", type: "grayscale", levels: 3, opacity: 0.5 })
    );
    const output = layerData(result, "tone");
    const grays = new Set<number>();
    for (let index = 0; index < input.width * input.height; index += 1) {
      const offset = index * 4;
      grays.add(output[offset]);
      expect(output[offset]).toBe(output[offset + 1]);
      expect(output[offset]).toBe(output[offset + 2]);
      expect(output[offset + 3]).toBe(Math.round(input.rgba[offset + 3] * 0.5));
    }
    expect(grays.size).toBeLessThanOrEqual(3);
  });

  it("makes cel quantization distinct from flat quantization", () => {
    const input = image(3, 1, (x) => {
      const values = [55, 128, 200];
      const value = values[x]!;
      return [value, value, value, 255];
    });
    const flat = renderStudioBg3dLtLayers(
      input,
      settings({ enabled: false }, { mode: "flat", type: "grayscale", levels: 4 })
    );
    const cel = renderStudioBg3dLtLayers(
      input,
      settings({ enabled: false }, { mode: "cel", type: "grayscale", levels: 4 })
    );

    expect(layerData(cel, "tone")).not.toEqual(layerData(flat, "tone"));
  });

  it.each(["dot", "line", "crosshatch", "noise"] as const)(
    "renders deterministic %s screentone patterns",
    (pattern) => {
      const input = image(32, 32, () => [112, 112, 112, 180]);
      const options = settings(
        { enabled: false },
        {
          mode: "screentone",
          type: "pattern",
          pattern,
          levels: 8,
          opacity: 0.75,
          frequency: 60,
          angleDegrees: 30,
        }
      );
      const first = renderStudioBg3dLtLayers(input, options);
      const second = renderStudioBg3dLtLayers(input, options);
      const output = layerData(first, "tone");

      expect(output).toEqual(layerData(second, "tone"));
      expect(alphaCount(output)).toBeGreaterThan(0);
      expect(alphaCount(output)).toBeLessThan(input.width * input.height);
      for (let offset = 0; offset < output.length; offset += 4) {
        expect(output[offset]).toBe(0);
        expect(output[offset + 1]).toBe(0);
        expect(output[offset + 2]).toBe(0);
        expect(output[offset + 3]).toBeLessThanOrEqual(input.rgba[offset + 3]);
      }
    }
  );

  it("honors screentone frequency and angle", () => {
    const input = image(40, 30, () => [120, 120, 120, 255]);
    const low = renderStudioBg3dLtLayers(
      input,
      settings(
        { enabled: false },
        { mode: "screentone", type: "pattern", pattern: "line", frequency: 20, angleDegrees: 0 }
      )
    );
    const highRotated = renderStudioBg3dLtLayers(
      input,
      settings(
        { enabled: false },
        {
          mode: "screentone",
          type: "pattern",
          pattern: "line",
          frequency: 120,
          angleDegrees: 75,
        }
      )
    );

    expect(layerData(low, "tone")).not.toEqual(layerData(highRotated, "tone"));
  });

  it("omits tones in none mode, at zero opacity, and on fully transparent captures", () => {
    const opaque = image(3, 3, () => [64, 64, 64, 255]);
    const transparent = image(3, 3, () => [64, 64, 64, 0]);

    expect(
      renderStudioBg3dLtLayers(opaque, settings({ enabled: false }, { mode: "none" })).layers
    ).toEqual([]);
    expect(
      renderStudioBg3dLtLayers(
        opaque,
        settings({ enabled: false }, { mode: "flat", opacity: 0 })
      ).layers
    ).toEqual([]);
    expect(
      renderStudioBg3dLtLayers(
        transparent,
        settings({ enabled: false }, { mode: "flat", opacity: 1 })
      ).layers
    ).toEqual([]);
  });

  it("accepts tightly packed Uint8Array capture pixels", () => {
    const clamped = splitImage();
    const input = { ...clamped, rgba: new Uint8Array(clamped.rgba) };
    expect(renderStudioBg3dLtLayers(input, settings()).layers).toHaveLength(1);
  });

  it("rejects invalid dimensions, pixel budgets, and RGBA buffers", () => {
    const valid = splitImage();
    expect(() => renderStudioBg3dLtLayers({ ...valid, width: 0 }, settings())).toThrow(
      RangeError
    );
    expect(() => renderStudioBg3dLtLayers({ ...valid, height: 1.5 }, settings())).toThrow(
      RangeError
    );
    expect(() =>
      renderStudioBg3dLtLayers(
        { width: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1, height: 1, rgba: new Uint8Array() },
        settings()
      )
    ).toThrow(/pixel budget/u);
    expect(() =>
      renderStudioBg3dLtLayers({ ...valid, rgba: new Uint8Array(7) }, settings())
    ).toThrow(/length/u);
    expect(() =>
      renderStudioBg3dLtLayers(
        { ...valid, rgba: new Uint16Array(valid.rgba.length) as unknown as Uint8Array },
        settings()
      )
    ).toThrow(TypeError);
  });

  it("rejects malformed, mismatched, nonfinite, and out-of-range depth buffers", () => {
    const input = splitImage();
    expect(() =>
      renderStudioBg3dLtLayers(
        { ...input, depth: new Float64Array(81) as unknown as Float32Array },
        settings()
      )
    ).toThrow(TypeError);
    expect(() =>
      renderStudioBg3dLtLayers({ ...input, depth: new Float32Array(2) }, settings())
    ).toThrow(/depth length/u);
    const nonfinite = new Float32Array(81).fill(0.5);
    nonfinite[4] = Number.NaN;
    expect(() => renderStudioBg3dLtLayers({ ...input, depth: nonfinite }, settings())).toThrow(
      /finite/u
    );
    const outside = new Float32Array(81).fill(0.5);
    outside[4] = 1.1;
    expect(() => renderStudioBg3dLtLayers({ ...input, depth: outside }, settings())).toThrow(
      /normalized/u
    );
  });

  it("rejects malformed or non-canonical line settings", () => {
    const input = splitImage();
    expect(() =>
      renderStudioBg3dLtLayers(
        input,
        settings({ color: "#ABCDEF" as StudioBg3dLineOutputSettings["color"] })
      )
    ).toThrow(/color/u);
    expect(() =>
      renderStudioBg3dLtLayers(input, settings({ strength: Number.NaN }))
    ).toThrow(/strength/u);
    expect(() =>
      renderStudioBg3dLtLayers(input, settings({ widthPx: 9 }))
    ).toThrow(/widthPx/u);
    expect(() =>
      renderStudioBg3dLtLayers(
        input,
        settings({ layerType: "mesh" as StudioBg3dLineOutputSettings["layerType"] })
      )
    ).toThrow(/layerType/u);
  });

  it("rejects malformed tone settings and missing setting objects", () => {
    const input = splitImage();
    expect(() =>
      renderStudioBg3dLtLayers(
        input,
        settings({}, { mode: "future" as StudioBg3dToneOutputSettings["mode"] })
      )
    ).toThrow(/mode/u);
    expect(() => renderStudioBg3dLtLayers(input, settings({}, { levels: 2.5 }))).toThrow(
      /levels/u
    );
    expect(() =>
      renderStudioBg3dLtLayers(input, settings({}, { opacity: Number.POSITIVE_INFINITY }))
    ).toThrow(/opacity/u);
    expect(() =>
      renderStudioBg3dLtLayers(input, null as unknown as StudioBg3dLtRenderSettings)
    ).toThrow(TypeError);
    expect(() =>
      renderStudioBg3dLtLayers(
        input,
        { line: null, tone: null } as unknown as StudioBg3dLtRenderSettings
      )
    ).toThrow(TypeError);
  });
});
