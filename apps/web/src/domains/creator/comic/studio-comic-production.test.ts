import {
  comicGraphIRSchema,
  comicPageIRSchema,
  sceneDigest,
  sceneIRSchema,
  validateComicGraph,
} from "@toonspectrum/studio-project-model";
import { beforeAll, describe, expect, it } from "vitest";

import {
  COMIC_PAGE_PRESETS,
  COMIC_PAGE_PRESET_IDS,
  comicPresetRectPath,
  renderComicPagePng,
} from "./studio-comic-production";

import type { ComicPageIR, SceneIR } from "@toonspectrum/studio-project-model";

/**
 * The skia engine is loaded through a runtime-resolved specifier on purpose:
 * the root app tsconfig maps `canvaskit-wasm` to a narrow type shim, so a
 * statically analyzable import of "@toonspectrum/studio-engine-skia" would
 * pull the engine sources (typed against the full canvaskit-wasm API) into
 * the root program and break `tsc --noEmit`. Runtime resolution keeps the
 * type universes separate while the test still drives the real engine.
 */
const SKIA_PACKAGE = "@toonspectrum/studio-engine-skia";

interface SkiaRenderModule {
  renderSceneToPng(
    ck: unknown,
    scene: SceneIR,
    options?: { fontData?: Uint8Array },
  ): Uint8Array;
  renderSceneToPixels(
    ck: unknown,
    scene: SceneIR,
    options?: { fontData?: Uint8Array },
  ): Uint8Array;
}

interface SkiaNodeModule {
  loadCanvasKitNode(): Promise<unknown>;
}

async function importSkiaModule(subpath: ""): Promise<SkiaRenderModule>;
async function importSkiaModule(subpath: "/node"): Promise<SkiaNodeModule>;
async function importSkiaModule(subpath: string): Promise<unknown> {
  return import(/* @vite-ignore */ `${SKIA_PACKAGE}${subpath}`);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // IHDR is always the first chunk: length(4) + "IHDR"(4) then width/height.
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function countNonWhitePixels(pixels: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const r = pixels[offset] ?? 255;
    const g = pixels[offset + 1] ?? 255;
    const b = pixels[offset + 2] ?? 255;
    if (r < 250 || g < 250 || b < 250) count += 1;
  }
  return count;
}

describe("COMIC_PAGE_PRESETS", () => {
  it.each(COMIC_PAGE_PRESET_IDS)(
    "%s creates a schema-valid page that passes the comic validator",
    (presetId) => {
      const preset = COMIC_PAGE_PRESETS[presetId];
      const page = preset.createPage();
      // Schema round-trip: parsing the produced page changes nothing.
      expect(comicPageIRSchema.parse(page)).toEqual(page);
      expect(page.widthPx).toBe(preset.widthPx);
      expect(page.heightPx).toBe(preset.heightPx);
      expect(page.panels).toHaveLength(preset.panelCount);
      // Every cut masks its content and reading order is contiguous 0..n-1.
      expect(page.panels.every((panel) => panel.masksContent)).toBe(true);
      expect(page.panels.map((panel) => panel.readingOrder)).toEqual(
        page.panels.map((_, index) => index),
      );
      const graph = comicGraphIRSchema.parse({ version: 1, pages: [page] });
      expect(validateComicGraph(graph)).toEqual([]);
    },
  );

  it("pins the webtoon scroll preset to the 828×1920 authoring viewport", () => {
    const preset = COMIC_PAGE_PRESETS["webtoon-scroll-3"];
    expect(preset.widthPx).toBe(828);
    expect(preset.heightPx).toBe(1920);
    const page = preset.createPage("scroll-page");
    expect(page.id).toBe("scroll-page");
  });
});

describe("renderComicPagePng (preset→render round-trip)", () => {
  let ck: unknown;
  let skia: SkiaRenderModule;

  beforeAll(async () => {
    skia = await importSkiaModule("");
    const { loadCanvasKitNode } = await importSkiaModule("/node");
    ck = await loadCanvasKitNode();
  });

  it.each(COMIC_PAGE_PRESET_IDS)(
    "%s round-trips to a PNG with matching dimensions and visible ink",
    (presetId) => {
      const preset = COMIC_PAGE_PRESETS[presetId];
      const page = preset.createPage();
      const { png, scene, warnings } = renderComicPagePng(ck, page, {
        renderSceneToPng: skia.renderSceneToPng,
      });
      // Preset pages carry no text/tone entities, so no lowering warnings.
      expect(warnings).toEqual([]);
      expect(sceneIRSchema.parse(scene)).toEqual(scene);
      expect(readPngDimensions(png)).toEqual({
        width: preset.widthPx,
        height: preset.heightPx,
      });
      // Panel borders must actually rasterize: non-white pixels exist.
      const pixels = skia.renderSceneToPixels(ck, scene);
      expect(countNonWhitePixels(pixels)).toBeGreaterThan(
        preset.panelCount * 100,
      );
    },
  );

  it("propagates lowering warnings (text lane, screentone) with the PNG", () => {
    const page: ComicPageIR = comicPageIRSchema.parse({
      id: "warn-page",
      widthPx: 96,
      heightPx: 96,
      panels: [
        {
          id: "cut-1",
          shape: comicPresetRectPath(8, 8, 80, 80),
          folderId: "f1",
          masksContent: true,
          readingOrder: 0,
        },
      ],
      balloons: [
        {
          id: "b1",
          panelId: "cut-1",
          shape: comicPresetRectPath(16, 16, 32, 20),
          textNodeId: "txt-1",
          readingOrder: 0,
        },
      ],
      tones: [
        {
          id: "t1",
          panelId: "cut-1",
          region: comicPresetRectPath(20, 48, 40, 24),
          lpi: 60,
          angleDeg: 45,
          density: 0.4,
        },
      ],
    });
    const { png, warnings } = renderComicPagePng(ck, page, {
      renderSceneToPng: skia.renderSceneToPng,
    });
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    const joined = warnings.join("\n");
    expect(joined).toContain("text node txt-1");
    expect(joined).toContain("스크린톤");
  });

  it("is deterministic: identical preset input → identical scene digest and PNG", () => {
    const page = COMIC_PAGE_PRESETS["free-2cut"].createPage();
    const first = renderComicPagePng(ck, page, {
      renderSceneToPng: skia.renderSceneToPng,
    });
    const second = renderComicPagePng(ck, page, {
      renderSceneToPng: skia.renderSceneToPng,
    });
    expect(sceneDigest(second.scene)).toBe(sceneDigest(first.scene));
    expect(second.png).toEqual(first.png);
  });
});
