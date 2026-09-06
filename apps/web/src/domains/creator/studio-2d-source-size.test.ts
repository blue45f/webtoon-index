import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { STUDIO_2D_ASSET_METADATA } from "./studio-2d-asset-quality";
import { createStudio2dCanvasImage, studio2dSourceSize } from "./studio-2d-source-size";
import { BG_SCENES } from "./studio-bg-scenes";
import { createCanvasImageElement } from "./studio-image-placement";

describe("2D original aspect ratio through canvas placement", () => {
  it("carries all 29 original dimensions through the real catalog", () => {
    for (const asset of STUDIO_2D_ASSET_METADATA) {
      const scene = BG_SCENES.find((entry) => entry.id === asset.id)!;
      expect(studio2dSourceSize(scene)).toEqual({ width: asset.width, height: asset.height });
      const image = createCanvasImageElement({ id: scene.id, src: scene.imgSrc!, canvasWidth: 720,
        canvasHeight: 1080, sourceWidth: scene.width!, sourceHeight: scene.height!, horizontalInset: 0, minY: 0 });
      expect(Math.abs(image.height - image.width * asset.height / asset.width)).toBeLessThanOrEqual(1);
      expect(createStudio2dCanvasImage(scene, { id: scene.id, src: scene.imgSrc!, canvasWidth: 720, canvasHeight: 1080 })).toEqual(image);
    }
  });
  it("places a landscape original as a landscape image, not a stretched portrait", () => {
    const scene = BG_SCENES.find((entry) => entry.id === "webtoon-rooftop-sunset")!;
    const size = studio2dSourceSize(scene);
    const image = createCanvasImageElement({ id: scene.id, src: scene.imgSrc!, canvasWidth: 720,
      canvasHeight: 1080, sourceWidth: size.width, sourceHeight: size.height, horizontalInset: 0, minY: 0 });
    expect(image.width).toBe(720); expect(image.height).toBe(405);
  });
  it("retains the legacy vector placement contract", () => {
    for (const scene of BG_SCENES.filter((entry) => !entry.imgSrc)) {
      expect(studio2dSourceSize(scene)).toEqual({ width: 720, height: 1080 });
    }
  });
  it.each([{ width: NaN, height: 1000 }, { width: Infinity, height: 1000 }, { width: 1000 },
    { width: 0, height: 1000 }, { width: -5, height: 1000 }, { width: 1000.5, height: 1000 },
    { width: 8193, height: 1 }, { width: 8192, height: 8192 }])("rejects unsafe or partial dimensions: %j", (source) => {
    expect(studio2dSourceSize(source)).toEqual({ width: 720, height: 1080 });
  });
  it("connects source dimensions to the production addBgScene path without eager catalog imports", () => {
    const host = readFileSync(new URL("./StudioCuttoonEditorHost.tsx", import.meta.url), "utf8");
    const insertion = host.slice(host.indexOf("function addBgScene(bg:"), host.indexOf("function insertAiBackgroundImage("));
    expect(insertion).toContain("createStudio2dCanvasImage(bg, {");
    expect(insertion).not.toContain("sourceWidth: 720");
    expect(host).not.toMatch(/import[^;]*from ["']\.\/studio-2d-asset-(?:quality|manifest)/u);
  });
});
