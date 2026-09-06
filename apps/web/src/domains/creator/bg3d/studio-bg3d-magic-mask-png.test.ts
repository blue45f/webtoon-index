import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_MAGIC_MASK_MAIN_THREAD_MAX_PIXELS,
  STUDIO_BG3D_MAGIC_MASK_PNG_DATA_URL_PREFIX,
  StudioBg3dMagicMaskPngError,
  encodeStudioBg3dMagicMaskPngDataUrl,
  type StudioBg3dMagicMaskPngInput,
} from "./studio-bg3d-magic-mask-png";
import { StudioBg3dShotPngWorkerError } from "./studio-bg3d-shot-png-worker-client";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

function input(
  patch: Partial<StudioBg3dMagicMaskPngInput> = {},
): StudioBg3dMagicMaskPngInput {
  return {
    width: 2,
    height: 1,
    data: Uint8Array.from([
      255, 255, 255, 255,
      255, 255, 255, 0,
    ]),
    ...patch,
  };
}

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: "image/png" });
}

function dataUrlForPng(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) =>
    `${STUDIO_BG3D_MAGIC_MASK_PNG_DATA_URL_PREFIX}${Buffer.from(buffer).toString("base64")}`,
  );
}

function contextFor(
  written: Uint8ClampedArray[],
): CanvasRenderingContext2D {
  return {
    createImageData(width: number, height: number) {
      return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: "srgb",
      } as ImageData;
    },
    putImageData(imageData: ImageData) {
      written.push(imageData.data.slice());
    },
  } as unknown as CanvasRenderingContext2D;
}

function canvasFor(
  encoded: Blob | null,
  written: Uint8ClampedArray[] = [],
  defer: (callback: BlobCallback) => void = (callback) => callback(encoded),
): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => contextFor(written)),
    toBlob: vi.fn((callback: BlobCallback) => defer(callback)),
  } as unknown as HTMLCanvasElement;
}

describe("studio-bg3d-magic-mask-png", () => {
  it("uses the shared Worker encoder with an exact private snapshot and canonical data URL", async () => {
    const source = input();
    const originalBuffer = source.data.buffer;
    const expected = source.data.slice();
    const encoded = png(2, 1);
    const encodePngInWorker = vi.fn(
      async (layers: readonly StudioBg3dLtRasterLayer[]) => {
        expect(layers).toHaveLength(1);
        expect(layers[0]).toMatchObject({ role: "color", width: 2, height: 1 });
        expect(layers[0]?.data).toBeInstanceOf(Uint8ClampedArray);
        expect(Array.from(layers[0]?.data ?? [])).toEqual(Array.from(expected));
        expect(layers[0]?.data.buffer).not.toBe(originalBuffer);
        layers[0]?.data.fill(0);
        return encoded;
      },
    );

    await expect(encodeStudioBg3dMagicMaskPngDataUrl(source, {
      encodePngInWorker,
      readBlobAsDataUrl: dataUrlForPng,
    })).resolves.toBe(await dataUrlForPng(encoded));
    expect(source.data).toEqual(expected);
    expect(source.data.buffer).toBe(originalBuffer);
  });

  it("accepts only fixed, exclusive, tightly packed Uint8 storage", async () => {
    const encodePngInWorker = vi.fn(async () => png(2, 1));
    const readBlobAsDataUrl = dataUrlForPng;
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({
      data: new Uint8ClampedArray(8),
    }), { encodePngInWorker, readBlobAsDataUrl })).resolves.toMatch(
      /^data:image\/png;base64,/u,
    );

    const aliased = new Uint8Array(9).subarray(0, 8);
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({ data: aliased }), {
      encodePngInWorker,
      readBlobAsDataUrl,
    })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({
      data: new Uint8Array(7),
    }), { encodePngInWorker, readBlobAsDataUrl }))
      .rejects.toMatchObject({ code: "invalid-input" });
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({
      data: new Uint32Array(2) as unknown as Uint8Array,
    }), { encodePngInWorker, readBlobAsDataUrl }))
      .rejects.toMatchObject({ code: "invalid-input" });

    if (typeof SharedArrayBuffer === "function") {
      await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({
        data: new Uint8Array(new SharedArrayBuffer(8)),
      }), { encodePngInWorker, readBlobAsDataUrl }))
        .rejects.toMatchObject({ code: "invalid-input" });
    }
    expect(encodePngInWorker).toHaveBeenCalledTimes(1);
  });

  it("normalizes hostile input access into a typed invalid-input rejection", async () => {
    const hostile = new Proxy(input(), {
      get() {
        throw new Error("hostile getter");
      },
    });
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(hostile, {
      encodePngInWorker: vi.fn(),
    })).rejects.toMatchObject({ code: "invalid-input" });
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [1, -1],
    [1.5, 1],
    [1, Number.NaN],
    [4_097, 1],
  ])("rejects invalid dimensions %s x %s", async (width, height) => {
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input({
      width,
      height,
      data: new Uint8Array(8),
    }), {
      encodePngInWorker: vi.fn(),
    })).rejects.toMatchObject({ code: "invalid-input" });
  });

  it.each([
    "worker-unavailable",
    "offscreen-unavailable",
  ] as const)("keeps Worker capability failure %s terminal", async (code) => {
    const createCanvas = vi.fn(() => canvasFor(png(2, 1)));
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encodePngInWorker: vi.fn(async () => {
        throw new StudioBg3dShotPngWorkerError(code);
      }),
      createCanvas,
      readBlobAsDataUrl: dataUrlForPng,
    })).rejects.toMatchObject({ code });
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("uses the bounded DOM canvas encoder only when selected before execution", async () => {
    const written: Uint8ClampedArray[] = [];
    const canvas = canvasFor(png(2, 1), written);
    const source = input();
    const expected = source.data.slice();
    const encodePngInWorker = vi.fn();

    const result = await encodeStudioBg3dMagicMaskPngDataUrl(source, {
      encoderBackend: "main-thread",
      encodePngInWorker,
      createCanvas: () => canvas,
      readBlobAsDataUrl: dataUrlForPng,
    });

    expect(result).toBe(await dataUrlForPng(png(2, 1)));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(written).toEqual([new Uint8ClampedArray(expected)]);
    expect(source.data).toEqual(expected);
    expect(encodePngInWorker).not.toHaveBeenCalled();
  });

  it.each([
    "invalid-request",
    "protocol",
    "encode-failed",
    "timeout",
    "worker-failed",
    "aborted",
  ] as const)("keeps terminal Worker error %s fail-closed", async (code) => {
    const createCanvas = vi.fn(() => canvasFor(png(2, 1)));
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encodePngInWorker: vi.fn(async () => {
        throw new StudioBg3dShotPngWorkerError(code);
      }),
      createCanvas,
      readBlobAsDataUrl: dataUrlForPng,
    })).rejects.toMatchObject({ code });
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("refuses an oversized explicitly selected main-thread request before creating a canvas", async () => {
    const width = 1_025;
    const height = 1_024;
    expect(width * height).toBeGreaterThan(STUDIO_BG3D_MAGIC_MASK_MAIN_THREAD_MAX_PIXELS);
    const createCanvas = vi.fn(() => canvasFor(png(width, height)));
    await expect(encodeStudioBg3dMagicMaskPngDataUrl({
      width,
      height,
      data: new Uint8Array(width * height * 4),
    }, {
      encoderBackend: "main-thread",
      createCanvas,
      readBlobAsDataUrl: dataUrlForPng,
    })).rejects.toMatchObject({ code: "main-thread-too-large" });
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("fails closed when the DOM canvas/context/PNG result is unavailable", async () => {
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encoderBackend: "main-thread",
      createCanvas: () => null,
    })).rejects.toMatchObject({ code: "main-thread-unavailable" });
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encoderBackend: "main-thread",
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
        toBlob: vi.fn(),
      } as unknown as HTMLCanvasElement),
    })).rejects.toMatchObject({ code: "main-thread-unavailable" });
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encoderBackend: "main-thread",
      createCanvas: () => canvasFor(null),
    })).rejects.toMatchObject({ code: "encode-failed" });
  });

  it("validates PNG type, signature, and IHDR dimensions on both paths", async () => {
    for (const invalid of [
      new Blob([new Uint8Array(33)], { type: "image/png" }),
      png(1, 1),
      new Blob([new Uint8Array(33)], { type: "image/jpeg" }),
    ]) {
      await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
        encodePngInWorker: vi.fn(async () => invalid),
        readBlobAsDataUrl: dataUrlForPng,
      })).rejects.toMatchObject({ code: "invalid-png" });
    }
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encodePngInWorker: vi.fn(async () => "not-a-blob" as unknown as Blob),
      readBlobAsDataUrl: dataUrlForPng,
    })).rejects.toMatchObject({ code: "invalid-png" });
  });

  it.each([
    "data:image/jpeg;base64,iVBORw0KGgo=",
    "data:image/png;base64,",
    "data:image/png;base64,iVBORw0KGgo",
    "data:image/png;base64,iVBORw0KGgo=fragment#bad",
    "data:image/png;base64,iVBORw0KGgo%3D",
  ])("rejects non-canonical data URL %j", async (value) => {
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encodePngInWorker: vi.fn(async () => png(2, 1)),
      readBlobAsDataUrl: vi.fn(async () => value),
    })).rejects.toMatchObject({ code: "data-url-failed" });
  });

  it("rejects a non-string data URL result", async () => {
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      encodePngInWorker: vi.fn(async () => png(2, 1)),
      readBlobAsDataUrl: vi.fn(async () => 42 as unknown as string),
    })).rejects.toMatchObject({ code: "data-url-failed" });
  });

  it("honors cancellation before work and while the selected main-thread encoder runs", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const encodePngInWorker = vi.fn();
    await expect(encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      signal: preAborted.signal,
      encodePngInWorker,
    })).rejects.toEqual(new StudioBg3dMagicMaskPngError("aborted"));
    expect(encodePngInWorker).not.toHaveBeenCalled();

    const deferredEncoding: { callback: BlobCallback | null } = { callback: null };
    const canvas = canvasFor(png(2, 1), [], (callback) => {
      deferredEncoding.callback = callback;
    });
    const controller = new AbortController();
    const pending = encodeStudioBg3dMagicMaskPngDataUrl(input(), {
      signal: controller.signal,
      encoderBackend: "main-thread",
      createCanvas: () => canvas,
      readBlobAsDataUrl: dataUrlForPng,
    });
    await vi.waitFor(() => expect(deferredEncoding.callback).not.toBeNull());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    deferredEncoding.callback?.(png(2, 1));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });
});
