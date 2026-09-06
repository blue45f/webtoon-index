import { readPsd } from "ag-psd";
import { describe, expect, it } from "vitest";

import { buildStudioBg3dShotLayeredPsd } from "./studio-bg3d-shot-psd";
import {
  STUDIO_BG3D_SHOT_PSD_MAX_CANVAS_PIXELS,
  admitStudioBg3dShotPsdLayers,
} from "./studio-bg3d-shot-psd-contract";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

function layer(role: StudioBg3dLtRasterLayer["role"], value: number): StudioBg3dLtRasterLayer {
  return {
    role,
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      value, 0, 0, 255, value, 0, 0, 255,
      value, 0, 0, 255, value, 0, 0, 255,
    ]),
  };
}

describe("Studio BG3D bounded layered PSD", () => {
  it("writes an 8BPS v1 document in Photoshop top-to-bottom layer order", async () => {
    const source = [layer("color", 10), layer("texture-line", 20), layer("main-line", 30)];
    const before = source.map(({ data }) => data.slice());
    const blob = buildStudioBg3dShotLayeredPsd(source);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    expect(blob.type).toBe("image/vnd.adobe.photoshop");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("8BPS");
    expect(new DataView(bytes.buffer).getUint16(4, false)).toBe(1);
    expect(parsed.children?.map(({ name }) => name)).toEqual([
      "3D LT · 주선",
      "3D LT · 질감선",
      "3D LT · 컬러 렌더",
    ]);
    expect(source.map(({ data }) => data)).toEqual(before);
  });

  it("rejects duplicate roles, malformed layers, and 1080p-class budget overflow", () => {
    expect(() => buildStudioBg3dShotLayeredPsd([layer("color", 1), layer("color", 2)]))
      .toThrow(/중복/u);
    expect(admitStudioBg3dShotPsdLayers([])).toEqual({ ok: false, reason: "empty" });
    expect(admitStudioBg3dShotPsdLayers([{
      role: "color",
      width: STUDIO_BG3D_SHOT_PSD_MAX_CANVAS_PIXELS + 1,
      height: 1,
      data: new Uint8ClampedArray(),
    }])).toEqual({ ok: false, reason: "shape" });
    const tooLarge = {
      role: "color" as const,
      width: 2_048,
      height: 1_025,
      data: new Uint8ClampedArray(2_048 * 1_025 * 4),
    };
    expect(admitStudioBg3dShotPsdLayers([tooLarge])).toEqual({
      ok: false,
      reason: "canvas-budget",
    });
  });
});
