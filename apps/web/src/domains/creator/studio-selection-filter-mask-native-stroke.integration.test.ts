import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { Image, encodePng } from "image-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyFilterMaskToPixels,
  computeFilterMaskCoverage,
} from "./filter/studio-filter-mask";
import {
  applyStudioInlineFilterMaskMutation,
} from "./filter/studio-filter-mask-surface-projection";
import {
  alphaBitmapFromRgba,
  layerAlphaToPixelSelection,
} from "./layer/studio-layer-alpha-selection";
import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "./render/studio-konva-filters";
import {
  applyStudioEditableRasterCopy,
  materializeStudioEditableRasterCopy,
  planStudioEditableRasterCopy,
  renderStudioEditableRasterCopy,
} from "./render/studio-raster-edit-preparation";
import { selectionToMask } from "./studio-quick-mask";
import {
  commitStudioSelectionFilterMaskTransaction,
  createStudioSelectionFilterMaskTransaction,
} from "./studio-selection-filter-mask-transaction";
import {
  isSelectionUsable,
  pointInSelection,
  type MaskCtx2DLike,
  type SelectionCanvasFactory,
} from "./studio-selection-tools";
import { renderStudioVectorReference } from "./studio-vector-fill-reference";

import type { El } from "./studio-element-model";

let resvgModule: typeof import("@resvg/resvg-wasm");

beforeAll(async () => {
  resvgModule = await import("@resvg/resvg-wasm");
  const require = createRequire(import.meta.url);
  await resvgModule.initWasm(
    await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  );
});

function nativeStrokeAndShape(): El[] {
  const stroke: Extract<El, { type: "draw" }> = {
    id: "native-gpen-stroke",
    type: "draw",
    kind: "freehand",
    points: [8, 16, 56, 16],
    stroke: "#111111",
    strokeWidth: 8,
    brush: "gpen",
  };
  const shape: Extract<El, { type: "draw" }> = {
    id: "native-ellipse-object",
    type: "draw",
    kind: "ellipse",
    points: [20, 30, 44, 54],
    stroke: "#333333",
    strokeWidth: 3,
    fill: "#777777",
    brush: "gpen",
  };
  return [stroke, shape];
}

function noOpCanvasFactory(): SelectionCanvasFactory {
  return (width, height) => {
    const canvas = { width, height };
    const ctx: MaskCtx2DLike = {
      fillStyle: "",
      strokeStyle: "",
      globalCompositeOperation: "source-over",
      filter: "none",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    };
    return { canvas, ctx };
  };
}

function rgbaMask(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = alpha[index]!;
  }
  return rgba;
}

function pngDataUrl(width: number, height: number, rgba: Uint8ClampedArray): string {
  const png = encodePng(new Image(width, height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
  }));
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

describe("native Studio stroke -> alpha selection -> masked filter commit", () => {
  it("recognizes real composite alpha, limits filter pixels, and commits one editable mask", async () => {
    const width = 64;
    const height = 64;
    const originals = nativeStrokeAndShape();
    const current = {
      pageId: "native-stroke-page",
      width,
      height,
      elements: originals,
      includeBackground: false,
      sourceDisposition: "hide-originals" as const,
      sourceDispositionIds: originals.map((element) => element.id),
      name: "픽셀 선택용 선화 합성본",
    };
    const planned = planStudioEditableRasterCopy(current);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    let compositePixels: Uint8ClampedArray | null = null;
    const rendered = await renderStudioEditableRasterCopy(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize: async (request) => {
          const renderer = new resvgModule.Resvg(request.svg, {
            font: { loadSystemFonts: false },
          });
          const image = renderer.render();
          try {
            compositePixels = new Uint8ClampedArray(image.pixels);
            return {
              dataUrl: `data:image/png;base64,${Buffer.from(image.asPng()).toString("base64")}`,
              width: image.width,
              height: image.height,
            };
          } finally {
            image.free();
            renderer.free();
          }
        },
      },
    );
    expect(compositePixels).not.toBeNull();
    const originalRgba = compositePixels!;
    const composite = materializeStudioEditableRasterCopy({
      plan: planned.plan,
      rendered,
      newId: "native-stroke-raster-owner",
    });
    const prepared = applyStudioEditableRasterCopy({
      plan: planned.plan,
      current,
      composite,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.elements.slice(0, 2).every((element) => element.hidden)).toBe(true);
    expect(prepared.elements[2]).toBe(composite);

    const alphaBitmap = alphaBitmapFromRgba(originalRgba, width, height);
    expect(alphaBitmap).not.toBeNull();
    const selection = layerAlphaToPixelSelection(alphaBitmap!);
    expect(isSelectionUsable(selection)).toBe(true);
    expect(pointInSelection(selection, { x: 0.5, y: 0.25 })).toBe(true);
    expect(pointInSelection(selection, { x: 0.04, y: 0.04 })).toBe(false);

    const selectionAlpha = selectionToMask(selection, width, height);
    const maskRgba = rgbaMask(selectionAlpha);
    const coverage = computeFilterMaskCoverage(maskRgba, width, height);
    expect(coverage).not.toBeNull();
    const filteredRgba = new Uint8ClampedArray(originalRgba);
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const filterBuild = buildImageFilters({ invert: true }, konva);
    applyImageFilters(
      { data: filteredRgba, width, height },
      filterBuild.filters,
      filterBuild.attrs,
    );
    expect(applyFilterMaskToPixels({
      target: filteredRgba,
      original: originalRgba,
      width,
      height,
      coverage: coverage!,
    })).toBe(true);

    const strokePixel = (16 * width + 32) * 4;
    const clearPixel = (2 * width + 2) * 4;
    expect(originalRgba[strokePixel + 3]).toBeGreaterThan(200);
    expect([...filteredRgba.slice(strokePixel, strokePixel + 3)])
      .not.toEqual([...originalRgba.slice(strokePixel, strokePixel + 3)]);
    expect([...filteredRgba.slice(clearPixel, clearPixel + 4)])
      .toEqual([...originalRgba.slice(clearPixel, clearPixel + 4)]);

    const maskSrc = pngDataUrl(width, height, maskRgba);
    const transaction = createStudioSelectionFilterMaskTransaction({
      target: composite,
      selection,
      scope: "inside",
      imageWidth: width,
      imageHeight: height,
      filterPatch: { invert: true },
      createCanvas: noOpCanvasFactory(),
      serializeMask: () => maskSrc,
    });
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;

    let committedElements = prepared.elements;
    const history: El[][] = [];
    expect(commitStudioSelectionFilterMaskTransaction(
      transaction.transaction,
      ({ targetId, patch }) => {
        committedElements = committedElements.map((element) =>
          element.id === targetId
            ? applyStudioInlineFilterMaskMutation(element, patch)
            : element,
        );
        history.push(committedElements);
        return true;
      },
    )).toBe(true);
    expect(history).toHaveLength(1);
    expect(committedElements[2]).toMatchObject({
      id: composite.id,
      type: "image",
      invert: true,
      filterMaskSrc: maskSrc,
      filterMaskEnabled: true,
    });
    expect(committedElements.slice(0, 2).every((element) => element.hidden)).toBe(true);
  });
});
