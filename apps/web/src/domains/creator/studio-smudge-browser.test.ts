import { afterEach, describe, expect, it, vi } from "vitest";

import { smudgeStrokeImage } from "./studio-smudge-browser";

const mocks = vi.hoisted(() => ({
  encodePng: vi.fn(),
  loadImage: vi.fn(),
  runWorker: vi.fn(),
}));

vi.mock("./studio-flood-fill", () => ({
  loadFloodFillSourceImage: mocks.loadImage,
}));
vi.mock("./studio-retouch-browser", () => ({
  encodeStudioRetouchCanvasPng: mocks.encodePng,
  loadStudioRetouchSourceImage: mocks.loadImage,
  studioRetouchSourceDimensions: (image: { naturalHeight: number; naturalWidth: number }) => ({
    height: image.naturalHeight,
    width: image.naturalWidth,
  }),
}));
vi.mock("./studio-smudge-worker-client", () => ({
  runStudioSmudgeWorker: mocks.runWorker,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Studio smudge browser dirty-region orchestration", () => {
  it("reads, transfers, and writes only the stroke ROI while forwarding cancellation", async () => {
    const signal = new AbortController().signal;
    const getImageData = vi.fn((x: number, y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }));
    const putImageData = vi.fn();
    const drawImage = vi.fn();
    const context = { drawImage, getImageData, putImageData };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        expect(tag).toBe("canvas");
        return canvas;
      }),
    });
    vi.stubGlobal("ImageData", class FakeImageData {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    });
    mocks.loadImage.mockResolvedValue({ naturalWidth: 2_000, naturalHeight: 30_000 });
    mocks.runWorker.mockImplementation(async (request) => ({ data: request.data }));
    mocks.encodePng.mockResolvedValue("data:image/png;base64,roi");

    await expect(smudgeStrokeImage(
      "data:image/png;base64,source",
      [{ x: 0.49, y: 0.499 }, { x: 0.51, y: 0.501 }],
      0.01,
      0.5,
      { signal },
    )).resolves.toBe("data:image/png;base64,roi");

    expect(mocks.loadImage).toHaveBeenCalledWith("data:image/png;base64,source", signal);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2_000, 30_000);
    expect(getImageData).toHaveBeenCalledOnce();
    const [x, y, width, height] = getImageData.mock.calls[0]!;
    expect({ x, y, width, height }).toEqual({ x: 958, y: 14_948, width: 85, height: 105 });
    expect(width * height).toBeLessThan(2_000 * 30_000 / 1_000);
    expect(mocks.runWorker).toHaveBeenCalledWith(expect.objectContaining({
      w: width,
      h: height,
      radiusPx: 20,
      points: [{ x: 22, y: 22 }, { x: 62, y: 82 }],
    }), { executionMode: "worker", signal });
    expect(putImageData).toHaveBeenCalledWith(
      expect.objectContaining({ width, height }),
      x,
      y,
    );
    expect(mocks.encodePng).toHaveBeenCalledWith(canvas, { signal });
  });
});
