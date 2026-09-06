import { describe, expect, it, vi } from "vitest";

import {
  buildStudioBg3dShotContactSheets,
  type StudioBg3dShotContactSheetRuntime,
} from "./studio-bg3d-shot-contact-sheet";
import {
  resolveStudioBg3dShotContactSheetLayout,
  type StudioBg3dShotContactSheetImage,
  type StudioBg3dShotContactSheetProgress,
} from "./studio-bg3d-shot-contact-sheet-contract";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: "image/png" });
}

function image(index: number, width = 320, height = 180): StudioBg3dShotContactSheetImage {
  return {
    shotId: `shot-${index + 1}`,
    shotName: `컷 ${index + 1}`,
    width,
    height,
    png: png(width, height),
  };
}

interface FakeRuntimeResult {
  readonly runtime: StudioBg3dShotContactSheetRuntime;
  readonly closes: ReturnType<typeof vi.fn>[];
  readonly drawImage: ReturnType<typeof vi.fn>;
  readonly canvases: Array<{ width: number; height: number }>;
  readonly fills: Array<{ readonly style: string; readonly width: number; readonly height: number }>;
}

function fakeRuntime(options: { readonly throwOnDraw?: boolean } = {}): FakeRuntimeResult {
  const closes: ReturnType<typeof vi.fn>[] = [];
  const drawImage = vi.fn(() => {
    if (options.throwOnDraw) throw new Error("draw failed");
  });
  const canvases: Array<{ width: number; height: number }> = [];
  const fills: Array<{ style: string; width: number; height: number }> = [];
  const runtime: StudioBg3dShotContactSheetRuntime = {
    createCanvas: (width, height) => {
      const canvasState = { width, height };
      canvases.push(canvasState);
      let fillStyle = "";
      const context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        get fillStyle() {
          return fillStyle;
        },
        set fillStyle(value: string) {
          fillStyle = value;
        },
        font: "",
        textAlign: "start",
        textBaseline: "alphabetic",
        fillRect: vi.fn((_x: number, _y: number, fillWidth: number, fillHeight: number) => {
          fills.push({ style: fillStyle, width: fillWidth, height: fillHeight });
        }),
        fillText: vi.fn(),
        drawImage,
      };
      const canvas = {
        get width() {
          return canvasState.width;
        },
        set width(value: number) {
          canvasState.width = value;
        },
        get height() {
          return canvasState.height;
        },
        set height(value: number) {
          canvasState.height = value;
        },
        getContext: () => context,
        convertToBlob: () => Promise.resolve(png(width, height)),
      };
      return canvas as unknown as OffscreenCanvas;
    },
    createImageBitmap: async (source) => {
      const bytes = new Uint8Array(await source.slice(0, 24).arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const close = vi.fn();
      closes.push(close);
      return {
        width: view.getUint32(16, false),
        height: view.getUint32(20, false),
        close,
      } as unknown as ImageBitmap;
    },
  };
  return { runtime, closes, drawImage, canvases, fills };
}

describe("Studio BG3D shot contact-sheet builder", () => {
  it("splits 13 ordered shots across bounded 4x3 PNG sheets", async () => {
    const fake = fakeRuntime();
    const progress: StudioBg3dShotContactSheetProgress[] = [];
    const images = Array.from({ length: 13 }, (_, index) => image(index));

    const result = await buildStudioBg3dShotContactSheets(images, {
      onProgress: (value) => progress.push(value),
    }, fake.runtime);

    expect(result.layout).toMatchObject({
      columns: 4,
      rows: 3,
      capacity: 12,
      sheetCount: 2,
      shotCount: 13,
    });
    expect(result.sheets.map((sheet) => sheet.fileName)).toEqual([
      "contact-sheet-001.png",
      "contact-sheet-002.png",
    ]);
    expect(result.sheets[0]?.shotIds).toEqual(images.slice(0, 12).map((entry) => entry.shotId));
    expect(result.sheets[1]?.shotIds).toEqual(["shot-13"]);
    expect(fake.drawImage).toHaveBeenCalledTimes(13);
    expect(fake.fills).toContainEqual({ style: "#fafafa", width: 512, height: 288 });
    expect(fake.fills.some(({ style }) => style === "#e4e4e7")).toBe(true);
    expect(fake.closes).toHaveLength(13);
    expect(fake.closes.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(fake.canvases).toEqual([{ width: 1, height: 1 }, { width: 1, height: 1 }]);
    expect(progress.at(-1)).toEqual({
      completedShots: 13,
      totalShots: 13,
      completedSheets: 2,
      totalSheets: 2,
    });
  });

  it("supports custom bounded grids and preserves the final partial sheet", async () => {
    const fake = fakeRuntime();
    const images = Array.from({ length: 9 }, (_, index) => image(index, 512, 512));
    const result = await buildStudioBg3dShotContactSheets(images, {
      layout: { columns: 2, rows: 2, cellWidth: 256, cellHeight: 256 },
    }, fake.runtime);

    expect(result.layout).toMatchObject({ capacity: 4, sheetCount: 3 });
    expect(result.sheets.map((sheet) => sheet.shotIds.length)).toEqual([4, 4, 1]);
  });

  it("always closes a decoded bitmap when drawing or cancellation fails", async () => {
    const drawing = fakeRuntime({ throwOnDraw: true });
    await expect(buildStudioBg3dShotContactSheets([image(0)], {}, drawing.runtime))
      .rejects.toThrow("draw failed");
    expect(drawing.closes[0]).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const cancelling = fakeRuntime();
    const originalDecode = cancelling.runtime.createImageBitmap;
    const runtime: StudioBg3dShotContactSheetRuntime = {
      ...cancelling.runtime,
      createImageBitmap: async (source) => {
        const bitmap = await originalDecode(source);
        controller.abort();
        return bitmap;
      },
    };
    await expect(buildStudioBg3dShotContactSheets([image(0)], {
      signal: controller.signal,
    }, runtime)).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelling.closes[0]).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate ids, forged PNG headers, IHDR mismatches, and oversized layouts", async () => {
    const fake = fakeRuntime();
    await expect(buildStudioBg3dShotContactSheets([image(0), image(0)], {}, fake.runtime))
      .rejects.toThrow(/입력 컷/iu);
    await expect(buildStudioBg3dShotContactSheets([{
      ...image(0),
      png: new Blob([new Uint8Array(24)], { type: "image/png" }),
    }], {}, fake.runtime)).rejects.toThrow(/signature|IHDR/iu);
    await expect(buildStudioBg3dShotContactSheets([{
      ...image(0),
      png: png(321, 180),
    }], {}, fake.runtime)).rejects.toThrow(/선언된 컷 크기/iu);
    expect(() => resolveStudioBg3dShotContactSheetLayout(64, {
      columns: 8,
      rows: 8,
      cellWidth: 1_024,
      cellHeight: 1_024,
      padding: 128,
      gap: 64,
      labelHeight: 96,
    })).toThrow(/픽셀 예산/iu);
    expect(fake.drawImage).not.toHaveBeenCalled();
  });
});
