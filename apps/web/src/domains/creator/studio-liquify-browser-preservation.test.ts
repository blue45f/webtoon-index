import { afterEach, describe, expect, it, vi } from "vitest";

import { bakeLiquifyStrokeToCanvas, type LiquifyCanvasFactory } from "./studio-liquify-browser";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskImageSource } from "./studio-selection-tools";

type TestSource = MaskImageSource & { pixels: StudioImageDataLike };

afterEach(() => {
  vi.unstubAllGlobals();
});

function patternedImage(width: number, height: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = index % 251;
    data[index * 4 + 1] = (index * 3) % 253;
    data[index * 4 + 2] = (index * 7) % 255;
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("bakeLiquifyStrokeToCanvas source preservation", () => {
  it("Worker의 plain 결과를 native ImageData로 복원한 뒤 캔버스에 기록한다", async () => {
    class NativeImageDataStub {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    vi.stubGlobal("ImageData", NativeImageDataStub);

    const source: TestSource = { pixels: patternedImage(8, 8) };
    let written: unknown = null;
    const factory: LiquifyCanvasFactory = (width, height) => ({
      canvas: { width, height } as MaskImageSource & { width: number; height: number },
      ctx: {
        fillStyle: "#fff",
        strokeStyle: "#fff",
        globalCompositeOperation: "source-over",
        filter: "none",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(source.pixels.data),
          width,
          height,
        }),
        putImageData: (next) => {
          written = next;
        },
      },
    });

    await bakeLiquifyStrokeToCanvas(
      source,
      8,
      8,
      [{ x: 4, y: 4 }],
      3,
      0.6,
      factory,
      { executionMode: "direct", mode: "bloat" },
    );

    expect(written).toBeInstanceOf(NativeImageDataStub);
  });

  it("한 결과 canvas에서 ROI snapshot을 복제해 단일 bloat 밖의 픽셀을 보존한다", async () => {
    const width = 64;
    const height = 64;
    const source: TestSource = { pixels: patternedImage(width, height) };
    const buffers = new Map<number, StudioImageDataLike>();
    let canvasId = 0;
    const factory: LiquifyCanvasFactory = (canvasWidth, canvasHeight) => {
      canvasId += 1;
      const id = canvasId;
      let pixels: StudioImageDataLike = {
        data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4),
        width: canvasWidth,
        height: canvasHeight,
      };
      buffers.set(id, pixels);
      return {
        canvas: { width: canvasWidth, height: canvasHeight, id } as MaskImageSource & {
          width: number;
          height: number;
          id: number;
        },
        ctx: {
          fillStyle: "#fff",
          strokeStyle: "#fff",
          globalCompositeOperation: "source-over",
          filter: "none",
          lineWidth: 1,
          lineCap: "butt",
          lineJoin: "miter",
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          closePath: () => {},
          fill: () => {},
          stroke: () => {},
          fillRect: () => {},
          clearRect: () => {},
          drawImage: (image) => {
            const input = (image as TestSource).pixels;
            pixels = { data: new Uint8ClampedArray(input.data), width: input.width, height: input.height };
          },
          getImageData: (sx, sy, sw, sh) => {
            const data = new Uint8ClampedArray(sw * sh * 4);
            for (let y = 0; y < sh; y += 1) {
              for (let x = 0; x < sw; x += 1) {
                const sourceOffset = ((sy + y) * canvasWidth + sx + x) * 4;
                data.set(pixels.data.subarray(sourceOffset, sourceOffset + 4), (y * sw + x) * 4);
              }
            }
            return { data, width: sw, height: sh };
          },
          putImageData: (next, dx, dy) => {
            for (let y = 0; y < next.height; y += 1) {
              for (let x = 0; x < next.width; x += 1) {
                const sourceOffset = (y * next.width + x) * 4;
                const targetOffset = ((dy + y) * canvasWidth + dx + x) * 4;
                pixels.data.set(next.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
              }
            }
            buffers.set(id, pixels);
          },
        },
      };
    };

    const output = await bakeLiquifyStrokeToCanvas(
      source,
      width,
      height,
      [{ x: 32, y: 32 }],
      10,
      0.8,
      factory,
      { executionMode: "direct", mode: "bloat" },
    );

    expect(output).not.toBeNull();
    expect(canvasId).toBe(1);
    const result = buffers.get(1)!;
    const farOffset = (4 * width + 4) * 4;
    expect(result.data.slice(farOffset, farOffset + 4)).toEqual(
      source.pixels.data.slice(farOffset, farOffset + 4),
    );
    let transparentPixels = 0;
    for (let offset = 3; offset < result.data.length; offset += 4) {
      if (result.data[offset] !== 255) transparentPixels += 1;
    }
    expect(transparentPixels).toBe(0);
  });
});
