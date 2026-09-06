import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioRasterEditSurfaces,
  getStudioRasterEditSurfaceSnapshot,
} from "./render/studio-raster-edit-surface-cache";
import {
  encodeStudioRetouchCanvasPng,
  loadStudioRetouchSourceImage,
  runStudioDodgeBurnRetouch,
  runStudioWetMixRetouch,
} from "./studio-retouch-browser";

class FakeFileReader {
  error: DOMException | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: string | ArrayBuffer | null = null;

  abort(): void {}

  readAsDataURL(): void {
    this.result = "data:image/png;base64,AQID";
    queueMicrotask(() => this.onload?.());
  }
}

function opaquePixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(96);
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  return data;
}

afterEach(() => {
  clearStudioRasterEditSurfaces();
  vi.unstubAllGlobals();
});

describe("Studio retouch browser orchestration", () => {
  it("keeps the product Worker authority exact when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    const dodgeData = opaquePixels(8, 8);
    const dodgePoints = [{ x: 4, y: 4 }];
    const dodgeSettings = {
      radiusPx: 3,
      hardness: 0.5,
      exposure: 35,
      mode: "dodge" as const,
      range: "midtones" as const,
      sponge: "saturate" as const,
    };
    const wetData = opaquePixels(8, 8);
    const wetPoints = [{ x: 3, y: 3 }, { x: 5, y: 5 }];
    const wetSettings = {
      radiusPx: 3,
      hardness: 0.4,
      strength: 0.65,
      wetness: 0.55,
      pickup: 0.35,
      paintColor: { r: 220, g: 40, b: 80 },
    };
    await expect(runStudioDodgeBurnRetouch(
      dodgeData,
      8,
      8,
      dodgePoints,
      dodgeSettings,
    )).rejects.toMatchObject({ name: "StudioRetouchWorkerUnavailableError" });
    await expect(runStudioWetMixRetouch(
      wetData,
      8,
      8,
      wetPoints,
      wetSettings,
    )).rejects.toMatchObject({ name: "StudioRetouchWorkerUnavailableError" });

    expect(dodgeData.byteLength).toBe(8 * 8 * 4);
    expect(wetData.byteLength).toBe(8 * 8 * 4);
  });

  it("encodes PNG asynchronously without calling synchronous toDataURL", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    const toDataURL = vi.fn(() => "data:image/png;base64,legacy");
    const toBlob = vi.fn((callback: BlobCallback, type?: string) => {
      expect(type).toBe("image/png");
      queueMicrotask(() => callback(new Blob([new Uint8Array([1, 2, 3])], { type })));
    });
    const canvas = { height: 2, toBlob, toDataURL, width: 3 } as unknown as HTMLCanvasElement;

    await expect(encodeStudioRetouchCanvasPng(canvas)).resolves.toBe(
      "data:image/png;base64,AQID",
    );
    expect(toBlob).toHaveBeenCalledOnce();
    expect(toDataURL).not.toHaveBeenCalled();
    expect(getStudioRasterEditSurfaceSnapshot("data:image/png;base64,AQID")).toBe(canvas);
    await expect(loadStudioRetouchSourceImage("data:image/png;base64,AQID")).resolves.toBe(canvas);
  });

  it("aborts a pending asynchronous encode and retains a legacy-only fallback", async () => {
    const controller = new AbortController();
    const pendingCanvas = {
      toBlob: vi.fn(() => undefined),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const pending = encodeStudioRetouchCanvasPng(pendingCanvas, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const toDataURL = vi.fn(() => "data:image/png;base64,legacy");
    const legacyCanvas = { toDataURL } as unknown as HTMLCanvasElement;
    await expect(encodeStudioRetouchCanvasPng(legacyCanvas)).resolves.toBe(
      "data:image/png;base64,legacy",
    );
    expect(toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("rejects a null PNG blob instead of committing an empty history entry", async () => {
    const canvas = {
      toBlob: (callback: BlobCallback) => queueMicrotask(() => callback(null)),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;

    await expect(encodeStudioRetouchCanvasPng(canvas)).rejects.toThrow(
      /인코딩에 실패/u,
    );
  });
});
