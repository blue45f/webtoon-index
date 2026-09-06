/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeStudioRasterInterchange, encodeStudioRasterInterchange } from "../render/studio-raster-interchange";
import {
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  type StudioRasterInterchangeWorkerRequest,
  type StudioRasterInterchangeWorkerResponse,
} from "../render/studio-raster-interchange-worker-protocol";
import {
  STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS,
  STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS,
} from "../studio-upload-image-safety";

import {
  STUDIO_CANVAS_IMAGE_ACCEPT,
  assertStudioCanvasDecodedImageSize,
  createPixelEditCanvas,
  downscaleDataUrl,
  isStudioOpenRasterFile,
  loadImageFileForCanvas,
  loadPixelEditImage,
  studioCanvasDecodedPixelLimit,
  studioOpenRasterFormatForFile,
} from "./studio-canvas-image-io";

interface ControlledImage {
  crossOrigin: string | null;
  height: number;
  naturalHeight: number;
  naturalWidth: number;
  onerror: ((event: Event) => void) | null;
  onload: ((event: Event) => void) | null;
  src: string;
  width: number;
}

function installControlledImage({
  width = 320,
  height = 180,
  naturalWidth = width,
  naturalHeight = height,
}: {
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
} = {}): ControlledImage[] {
  const instances: ControlledImage[] = [];
  const resolvedWidth = width;
  const resolvedHeight = height;
  const resolvedNaturalWidth = naturalWidth;
  const resolvedNaturalHeight = naturalHeight;

  class ImageMock implements ControlledImage {
    crossOrigin: string | null = null;
    height = resolvedHeight;
    naturalHeight = resolvedNaturalHeight;
    naturalWidth = resolvedNaturalWidth;
    onerror: ((event: Event) => void) | null = null;
    onload: ((event: Event) => void) | null = null;
    src = "";
    width = resolvedWidth;

    constructor() {
      instances.push(this);
    }
  }

  vi.stubGlobal("Image", ImageMock);
  return instances;
}

function setDeviceMemory(value: number | undefined): void {
  Object.defineProperty(globalThis.navigator, "deviceMemory", {
    configurable: true,
    value,
  });
}

function mockCanvas2dContext(context: CanvasRenderingContext2D | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d" ? context : null) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
}

const GIF_HEADER_89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const GIF_LOGICAL_SCREEN = [0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
const GIF_GRAPHIC_CONTROL = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];
const GIF_IMAGE = [
  0x2c,
  0x00, 0x00,
  0x00, 0x00,
  0x01, 0x00,
  0x01, 0x00,
  0x00,
  0x02, 0x01, 0x00, 0x00,
];

function animatedGifFile(): File {
  const bytes = Uint8Array.from([
    ...GIF_HEADER_89A,
    ...GIF_LOGICAL_SCREEN,
    ...GIF_GRAPHIC_CONTROL,
    ...GIF_IMAGE,
    0x3b,
  ]);
  return new File([bytes], "motion.gif", { type: "image/gif" });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis.navigator, "deviceMemory");
});

describe("Studio canvas decoded image limits", () => {
  it("uses the desktop, coarse-pointer, and low-memory budgets", () => {
    setDeviceMemory(8);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    expect(studioCanvasDecodedPixelLimit()).toBe(STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS);

    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    expect(studioCanvasDecodedPixelLimit()).toBe(STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS);

    setDeviceMemory(4);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    expect(studioCanvasDecodedPixelLimit()).toBe(STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS);
  });

  it("accepts the exact budget and rejects unsafe or oversized decoded dimensions", () => {
    expect(() => assertStudioCanvasDecodedImageSize(4_096, 4_096, 16_777_216)).not.toThrow();
    expect(() => assertStudioCanvasDecodedImageSize(4_097, 4_096, 16_777_216)).toThrow(/16MP/);
    expect(() => assertStudioCanvasDecodedImageSize(0, 100, 16_777_216)).toThrow(/16MP/);
    expect(() => assertStudioCanvasDecodedImageSize(1.5, 100, 16_777_216)).toThrow(/16MP/);
  });
});

describe("Studio canvas image file loading", () => {
  it("advertises and recognizes the open raster extensions that browser image pickers omit", () => {
    expect(STUDIO_CANVAS_IMAGE_ACCEPT).toContain(".qoi");
    expect(STUDIO_CANVAS_IMAGE_ACCEPT).toContain(".tga");
    expect(STUDIO_CANVAS_IMAGE_ACCEPT).toContain(".tiff");
    expect(studioOpenRasterFormatForFile({ name: "INK.QOI", type: "" })).toBe("qoi");
    expect(studioOpenRasterFormatForFile({ name: "paper", type: "image/x-targa" })).toBe("tga");
    expect(isStudioOpenRasterFile({ name: "tone.pam", type: "application/octet-stream" })).toBe(true);
    expect(studioOpenRasterFormatForFile({ name: "scan.tif", type: "application/octet-stream" })).toBe("tiff");
    expect(isStudioOpenRasterFile({ name: "photo.png", type: "image/png" })).toBe(false);
  });

  it("decodes a QOI file and converts it to the canvas insertion source", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const workerPosts = vi.fn();
    const workerTerminates = vi.fn();
    class RasterWorkerMock {
      onmessage: ((event: MessageEvent<StudioRasterInterchangeWorkerResponse>) => void) | null = null;
      onerror: ((event: { readonly message?: string }) => void) | null = null;

      constructor() {
        queueMicrotask(() => this.onmessage?.({ data: {
          type: "studio-raster-interchange/ready",
          version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        } } as MessageEvent<StudioRasterInterchangeWorkerResponse>));
      }

      postMessage(request: StudioRasterInterchangeWorkerRequest): void {
        workerPosts(request);
        if (request.type !== "studio-raster-interchange/decode") throw new Error("decode request expected");
        const result = decodeStudioRasterInterchange(request.bytes, request.expectedFormat);
        queueMicrotask(() => this.onmessage?.({ data: {
          type: "studio-raster-interchange/decode-success",
          version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
          requestId: request.requestId,
          result,
        } } as MessageEvent<StudioRasterInterchangeWorkerResponse>));
      }

      terminate(): void {
        workerTerminates();
      }
    }
    vi.stubGlobal("Worker", RasterWorkerMock);
    const encoded = encodeStudioRasterInterchange("qoi", {
      width: 2,
      height: 1,
      data: Uint8Array.from([255, 0, 0, 255, 0, 128, 255, 192]),
    });
    const fileBytes = new Uint8Array(encoded.bytes.byteLength);
    fileBytes.set(encoded.bytes);
    const file = new File([fileBytes.buffer], "ink.qoi", { type: "image/qoi" });
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      })),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    mockCanvas2dContext(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,cW9p");

    await expect(loadImageFileForCanvas(file)).resolves.toEqual({
      src: "data:image/webp;base64,cW9p",
      width: 2,
      height: 1,
      isAnimatedGif: false,
    });
    expect(context.createImageData).toHaveBeenCalledWith(2, 1);
    expect(context.putImageData).toHaveBeenCalledTimes(1);
    expect(workerPosts).toHaveBeenCalledWith(expect.objectContaining({
      type: "studio-raster-interchange/decode",
      expectedFormat: "qoi",
    }));
    expect(workerTerminates).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the extension and the actual open-raster bytes disagree", async () => {
    class RasterWorkerMock {
      onmessage: ((event: MessageEvent<StudioRasterInterchangeWorkerResponse>) => void) | null = null;
      onerror: ((event: { readonly message?: string }) => void) | null = null;

      constructor() {
        queueMicrotask(() => this.onmessage?.({ data: {
          type: "studio-raster-interchange/ready",
          version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        } } as MessageEvent<StudioRasterInterchangeWorkerResponse>));
      }

      postMessage(request: StudioRasterInterchangeWorkerRequest): void {
        if (request.type !== "studio-raster-interchange/decode") throw new Error("decode request expected");
        try {
          const result = decodeStudioRasterInterchange(request.bytes, request.expectedFormat);
          queueMicrotask(() => this.onmessage?.({ data: {
            type: "studio-raster-interchange/decode-success",
            version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
            requestId: request.requestId,
            result,
          } } as MessageEvent<StudioRasterInterchangeWorkerResponse>));
        } catch (error) {
          queueMicrotask(() => this.onmessage?.({ data: {
            type: "studio-raster-interchange/failure",
            version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
            requestId: request.requestId,
            error: {
              name: error instanceof Error ? error.name : "Error",
              message: error instanceof Error ? error.message : String(error),
            },
          } } as MessageEvent<StudioRasterInterchangeWorkerResponse>));
        }
      }

      terminate(): void {}
    }
    vi.stubGlobal("Worker", RasterWorkerMock);

    const encoded = encodeStudioRasterInterchange("qoi", {
      width: 1,
      height: 1,
      data: Uint8Array.from([0, 0, 0, 255]),
    });
    const fileBytes = new Uint8Array(encoded.bytes.byteLength);
    fileBytes.set(encoded.bytes);
    const file = new File([fileBytes.buffer], "spoofed.bmp", { type: "image/bmp" });

    await expect(loadImageFileForCanvas(file)).rejects.toThrow(/\.qoi.*\.bmp/);
  });

  it("preserves animated GIF bytes and dimensions without a canvas re-encode", async () => {
    const instances = installControlledImage({ width: 320, height: 180 });
    const createElement = vi.spyOn(document, "createElement");
    const file = animatedGifFile();
    const pending = loadImageFileForCanvas(file);

    await vi.waitFor(() => expect(instances).toHaveLength(1));
    instances[0].onload?.(new Event("load"));

    await expect(pending).resolves.toEqual({
      src: `data:image/gif;base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
      width: 320,
      height: 180,
      isAnimatedGif: true,
    });
    expect(createElement).not.toHaveBeenCalledWith("canvas");
  });

  it("rejects animated GIF dimensions that exceed the active decoded-pixel budget", async () => {
    const instances = installControlledImage({ width: 5_000, height: 5_000 });
    const pending = loadImageFileForCanvas(animatedGifFile());

    await vi.waitFor(() => expect(instances).toHaveLength(1));
    instances[0].onload?.(new Event("load"));

    await expect(pending).rejects.toThrow(/안전 한도\(16MP\)/);
  });
});

describe("Studio pixel edit browser adapters", () => {
  it("returns null when a 2D canvas context is unavailable", () => {
    mockCanvas2dContext(null);

    expect(createPixelEditCanvas(10.6, 0)).toBeNull();
  });

  it("rounds safe canvas dimensions and returns the acquired context", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    mockCanvas2dContext(context);

    const result = createPixelEditCanvas(10.6, 0);

    expect(result?.canvas.width).toBe(11);
    expect(result?.canvas.height).toBe(1);
    expect(result?.ctx).toBe(context);
  });

  it("requests anonymous CORS only for non-data sources and resolves the loaded image", async () => {
    const instances = installControlledImage();
    const external = loadPixelEditImage("https://assets.example/ink.png");

    expect(instances[0].crossOrigin).toBe("anonymous");
    instances[0].onload?.(new Event("load"));
    await expect(external).resolves.toBe(instances[0]);

    const inline = loadPixelEditImage("data:image/png;base64,AA==");
    expect(instances[1].crossOrigin).toBeNull();
    instances[1].onload?.(new Event("load"));
    await expect(inline).resolves.toBe(instances[1]);
  });

  it("clears the source and rejects with AbortError when pixel loading is cancelled", async () => {
    const instances = installControlledImage();
    const controller = new AbortController();
    const pending = loadPixelEditImage("https://assets.example/large.png", controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(instances[0].src).toBe("");
  });

  it("handles a pre-aborted signal and source load failures", async () => {
    const instances = installControlledImage();
    const controller = new AbortController();
    controller.abort();

    await expect(loadPixelEditImage("https://assets.example/a.png", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    const failed = loadPixelEditImage("https://assets.example/b.png");
    instances[1].onerror?.(new Event("error"));
    await expect(failed).rejects.toThrow("이미지 원본을 불러오지 못했습니다.");
  });

  it("falls back to the original data URL when cover downscaling cannot load it", async () => {
    const instances = installControlledImage();
    const original = "data:image/png;base64,broken";
    const pending = downscaleDataUrl(original, 480);

    instances[0].onerror?.(new Event("error"));

    await expect(pending).resolves.toBe(original);
  });
});
