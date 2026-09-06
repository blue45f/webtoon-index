import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyLiquifyDisplacement,
  buildLiquifyDisplacementField,
  type LiquifyPixelPoint,
  type StudioLiquifyMode,
} from "./studio-liquify";
import {
  bakeLiquifyFieldToCanvas,
  bakeLiquifyStrokeToCanvas,
  liquifyRasterRegionWorkerBytes,
  planLiquifyStrokeRasterRegion,
  type LiquifyCanvasFactory,
} from "./studio-liquify-browser";
import {
  disposeStudioLiquifyModuleWorker,
  type StudioLiquifyWorkerLike,
} from "./studio-liquify-worker-client";
import {
  studioLiquifySuccessTransfers,
  type StudioLiquifyWorkerResponseMessage,
  type StudioLiquifyWorkerRunMessage,
  type StudioLiquifyWorkerSuccessMessage,
} from "./studio-liquify-worker-protocol";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskImageSource } from "./studio-selection-tools";

type PixelSource = MaskImageSource & { readonly pixels: StudioImageDataLike };
type PixelCanvas = MaskImageSource & {
  readonly width: number;
  readonly height: number;
  readonly pixels: StudioImageDataLike;
};

function patternedImage(width: number, height: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 17 + y * 31 + x * y) % 256;
      data[offset + 1] = (x * 43 + y * 7) % 256;
      data[offset + 2] = (x * 3 + y * 53) % 256;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function cloneImage(image: StudioImageDataLike): StudioImageDataLike {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
}

function createPixelCanvasHarness(): {
  readonly createCanvas: LiquifyCanvasFactory;
  readonly createCalls: Array<{ width: number; height: number }>;
  readonly reads: Array<{ x: number; y: number; width: number; height: number }>;
  readonly writes: Array<{ x: number; y: number; width: number; height: number }>;
} {
  const createCalls: Array<{ width: number; height: number }> = [];
  const reads: Array<{ x: number; y: number; width: number; height: number }> = [];
  const writes: Array<{ x: number; y: number; width: number; height: number }> = [];
  const createCanvas: LiquifyCanvasFactory = (width, height) => {
    createCalls.push({ width, height });
    const pixels = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const canvas = { width, height, pixels } as PixelCanvas;
    return {
      canvas,
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
          pixels.data.set((image as PixelSource).pixels.data);
        },
        getImageData: (sx, sy, sw, sh) => {
          reads.push({ x: sx, y: sy, width: sw, height: sh });
          const data = new Uint8ClampedArray(sw * sh * 4);
          for (let y = 0; y < sh; y += 1) {
            for (let x = 0; x < sw; x += 1) {
              const sourceOffset = ((sy + y) * width + sx + x) * 4;
              data.set(pixels.data.subarray(sourceOffset, sourceOffset + 4), (y * sw + x) * 4);
            }
          }
          return { data, width: sw, height: sh };
        },
        putImageData: (image, dx, dy) => {
          writes.push({ x: dx, y: dy, width: image.width, height: image.height });
          for (let y = 0; y < image.height; y += 1) {
            for (let x = 0; x < image.width; x += 1) {
              const sourceOffset = (y * image.width + x) * 4;
              const destinationOffset = ((dy + y) * width + dx + x) * 4;
              pixels.data.set(image.data.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
            }
          }
        },
      },
    };
  };
  return { createCanvas, createCalls, reads, writes };
}

function expectedFullFrame(
  source: StudioImageDataLike,
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  options: Parameters<typeof buildLiquifyDisplacementField>[5],
): StudioImageDataLike {
  const expected = cloneImage(source);
  const field = buildLiquifyDisplacementField(
    points,
    radiusPx,
    strength,
    source.width,
    source.height,
    options,
  );
  if (field) applyLiquifyDisplacement(source, expected, field);
  return expected;
}

class RegionApplyingWorker implements StudioLiquifyWorkerLike {
  onmessage: StudioLiquifyWorkerLike["onmessage"] = null;
  onerror: StudioLiquifyWorkerLike["onerror"] = null;
  readonly requests: StudioLiquifyWorkerRunMessage[] = [];
  requestByteLength = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-liquify/ready", version: 1 },
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>));
  }

  postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    const received = structuredClone(message, { transfer });
    this.requests.push(received);
    const request = received.request;
    this.requestByteLength = request.src.data.byteLength + request.dst.data.byteLength;
    const field = "stroke" in request
      ? buildLiquifyDisplacementField(
          request.stroke.points,
          request.stroke.radiusPx,
          request.stroke.strength,
          request.region?.canvasWidth ?? request.src.width,
          request.region?.canvasHeight ?? request.src.height,
          request.stroke.options,
        )
      : request.field;
    if (field) applyLiquifyDisplacement(request.src, request.dst, field, {
      ...(request.region === undefined ? {} : { region: request.region }),
    });
    const response: StudioLiquifyWorkerSuccessMessage = {
      type: "studio-liquify/success",
      version: 1,
      applied: field !== null,
      dst: request.dst,
    };
    const returned = structuredClone(response, { transfer: studioLiquifySuccessTransfers(response) });
    queueMicrotask(() => this.onmessage?.({
      data: returned,
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>));
  }

  terminate(): void {}
}

afterEach(() => {
  disposeStudioLiquifyModuleWorker();
  vi.unstubAllGlobals();
});

describe("liquify raster ROI", () => {
  const width = 180;
  const height = 140;
  const sourceImage = patternedImage(width, height);

  it.each<StudioLiquifyMode>([
    "push",
    "twirl-clockwise",
    "twirl-counterclockwise",
    "pinch",
    "bloat",
  ])("direct fallback의 %s 결과가 기존 전체 프레임 결과와 byte-identical이다", async (mode) => {
    vi.stubGlobal("Worker", undefined);
    const source = { pixels: sourceImage } as PixelSource;
    const harness = createPixelCanvasHarness();
    const points: LiquifyPixelPoint[] = [
      { x: 61.25, y: 61.75, pressure: 0.35 },
      { x: 70.5, y: 68.25, pressure: 0.9 },
      { x: 79.75, y: 64.5, pressure: 0.55 },
    ];
    const options = {
      executionMode: "direct",
      mode,
      hardness: 0.65,
      minimumRadiusRatio: 0.25,
      pressureAffectsRadius: true,
      pressureAffectsStrength: true,
      stabilizer: 0.4,
      spacingRatio: 0.2,
    } as const;

    const output = await bakeLiquifyStrokeToCanvas(
      source,
      width,
      height,
      points,
      12.5,
      0.83,
      harness.createCanvas,
      options,
    ) as PixelCanvas;

    expect(output.pixels.data).toEqual(
      expectedFullFrame(sourceImage, points, 12.5, 0.83, options).data,
    );
    expect(harness.createCalls).toEqual([{ width, height }]);
    expect(harness.reads).toHaveLength(1);
    expect(harness.reads[0]!.width).toBeLessThan(width);
    expect(harness.reads[0]!.height).toBeLessThan(height);
    expect(harness.writes).toEqual(harness.reads);
  });

  it.each([
    { label: "top-left", points: [{ x: 1.25, y: 2.5 }, { x: 8.75, y: 6.25 }] },
    { label: "bottom-right", points: [{ x: 172.5, y: 132.25 }, { x: 178.5, y: 138.5 }] },
  ])("$label 경계에서도 global clamp parity와 ROI 밖 불변성을 유지한다", async ({ points }) => {
    vi.stubGlobal("Worker", undefined);
    const source = { pixels: sourceImage } as PixelSource;
    const harness = createPixelCanvasHarness();
    const output = await bakeLiquifyStrokeToCanvas(
      source,
      width,
      height,
      points,
      11,
      0.9,
      harness.createCanvas,
      { executionMode: "direct", mode: "push", hardness: 0.2 },
    ) as PixelCanvas;
    const expected = expectedFullFrame(sourceImage, points, 11, 0.9, {
      mode: "push",
      hardness: 0.2,
    });
    expect(output.pixels.data).toEqual(expected.data);

    const region = harness.reads[0]!;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) {
          continue;
        }
        const offset = (y * width + x) * 4;
        expect(output.pixels.data.slice(offset, offset + 4)).toEqual(
          sourceImage.data.slice(offset, offset + 4),
        );
      }
    }
  });

  it.each([
    { flipX: true, flipY: false },
    { flipX: false, flipY: true },
    { flipX: true, flipY: true },
  ])("flipX=$flipX flipY=$flipY도 전역 좌표 field와 정확히 일치한다", async ({ flipX, flipY }) => {
    vi.stubGlobal("Worker", undefined);
    const displayPoints = [{ x: 27.25, y: 38.5 }, { x: 39.75, y: 45.25 }];
    const sourcePoints = displayPoints.map((point) => ({
      x: flipX ? width - point.x : point.x,
      y: flipY ? height - point.y : point.y,
    }));
    const source = { pixels: sourceImage } as PixelSource;
    const harness = createPixelCanvasHarness();
    const output = await bakeLiquifyStrokeToCanvas(
      source,
      width,
      height,
      displayPoints,
      10,
      0.75,
      harness.createCanvas,
      { executionMode: "direct", flipX, flipY },
    ) as PixelCanvas;
    expect(output.pixels.data).toEqual(
      expectedFullFrame(sourceImage, sourcePoints, 10, 0.75, { mode: "push" }).data,
    );
  });

  it("module Worker에도 full canvas 좌표와 ROI bytes만 보내고 결과 parity를 유지한다", async () => {
    let worker: RegionApplyingWorker | null = null;
    vi.stubGlobal("Worker", vi.fn(function MockWorker() {
      worker = new RegionApplyingWorker();
      return worker;
    }));
    const points = [{ x: 74.5, y: 64.25 }, { x: 86.75, y: 72.5 }];
    const source = { pixels: sourceImage } as PixelSource;
    const harness = createPixelCanvasHarness();
    const output = await bakeLiquifyStrokeToCanvas(
      source,
      width,
      height,
      points,
      9,
      0.72,
      harness.createCanvas,
    ) as PixelCanvas;

    expect(output.pixels.data).toEqual(
      expectedFullFrame(sourceImage, points, 9, 0.72, { mode: "push" }).data,
    );
    const request = worker!.requests[0]!.request;
    expect(request.region).toEqual({
      originX: harness.reads[0]!.x,
      originY: harness.reads[0]!.y,
      canvasWidth: width,
      canvasHeight: height,
    });
    expect(worker!.requestByteLength).toBe(
      harness.reads[0]!.width * harness.reads[0]!.height * 4 * 2,
    );
  });

  it("retained field 경로도 실제 displacement halo만 읽고 full-frame 결과와 일치한다", async () => {
    vi.stubGlobal("Worker", undefined);
    const points = [{ x: 66.25, y: 49.5 }, { x: 78.75, y: 57.25 }];
    const field = buildLiquifyDisplacementField(points, 10, 0.8, width, height, {
      mode: "push",
    })!;
    const source = { pixels: sourceImage } as PixelSource;
    const harness = createPixelCanvasHarness();
    const output = await bakeLiquifyFieldToCanvas(
      source,
      width,
      height,
      field,
      harness.createCanvas,
      { executionMode: "direct" },
    ) as PixelCanvas;
    const expected = cloneImage(sourceImage);
    applyLiquifyDisplacement(sourceImage, expected, field);

    expect(output.pixels.data).toEqual(expected.data);
    expect(harness.reads).toHaveLength(1);
    expect(harness.reads[0]!.width).toBeLessThan(width);
    expect(harness.reads[0]!.height).toBeLessThan(height);
  });

  it("2000×30000 원고의 멀리 떨어진 작은 stroke는 전체 RGBA가 아니라 footprint bytes만 계획한다", () => {
    const region = planLiquifyStrokeRasterRegion(
      [{ x: 1_127.25, y: 27_411.5 }, { x: 1_143.75, y: 27_419.25 }],
      20,
      2_000,
      30_000,
    );
    const roiBytes = liquifyRasterRegionWorkerBytes(region);
    const previousFullFrameBytes = 2_000 * 30_000 * 4 * 2;

    expect(region.width).toBeLessThan(150);
    expect(region.height).toBeLessThan(150);
    expect(roiBytes).toBeLessThan(previousFullFrameBytes / 1_000);
    expect(roiBytes).toBe(region.width * region.height * 8);
  });
});
