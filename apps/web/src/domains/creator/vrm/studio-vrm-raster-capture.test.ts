import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dShotPngWorkerError } from "../bg3d/studio-bg3d-shot-png-worker-client";

import {
  captureStudioVrmRgba,
  encodeStudioVrmCapturePngBlob,
  encodeStudioVrmCapturePngDataUrl,
  flipStudioVrmCaptureRows,
  readStudioVrmPngBlobAsDataUrl,
  type StudioVrmRasterCaptureDependencies,
} from "./studio-vrm-raster-capture";

import type { StudioBg3dLtRasterLayer } from "../bg3d/studio-bg3d-lt-render";

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

function dependencies(
  overrides: Partial<StudioVrmRasterCaptureDependencies> = {},
): StudioVrmRasterCaptureDependencies {
  return {
    encodePngInWorker: vi.fn(async (layers) => png(layers[0]?.width ?? 1, layers[0]?.height ?? 1)),
    encodePngOnMainThread: vi.fn(async (_rgba, dimensions) => png(dimensions.width, dimensions.height)),
    blobToDataUrl: vi.fn(async () => "data:image/png;base64,verified"),
    ...overrides,
  };
}

class FakeRenderer {
  readonly capabilities = { maxSamples: 8 };
  readonly outputColorSpace = THREE.SRGBColorSpace;
  readonly toneMapping = THREE.ACESFilmicToneMapping;
  readonly toneMappingExposure = 1;
  readonly calls: string[] = [];
  clearColor = new THREE.Color("#234567");
  clearAlpha = 0.75;
  failRead = false;
  captureTargets: THREE.WebGLRenderTarget[] = [];
  readTarget: THREE.WebGLRenderTarget | null = null;
  previousActiveCubeFace = 3;
  previousActiveMipmapLevel = 2;

  getRenderTarget(): THREE.WebGLRenderTarget | null {
    this.calls.push("get-target");
    return null;
  }

  getActiveCubeFace(): number {
    this.calls.push("get-active-cube-face");
    return this.previousActiveCubeFace;
  }

  getActiveMipmapLevel(): number {
    this.calls.push("get-active-mipmap-level");
    return this.previousActiveMipmapLevel;
  }

  getClearColor(target: THREE.Color): THREE.Color {
    this.calls.push("get-clear-color");
    return target.copy(this.clearColor);
  }

  getClearAlpha(): number {
    this.calls.push("get-clear-alpha");
    return this.clearAlpha;
  }

  setRenderTarget(
    target: THREE.WebGLRenderTarget | null,
    activeCubeFace = 0,
    activeMipmapLevel = 0,
  ): void {
    if (target) {
      this.captureTargets.push(target);
      this.calls.push(`set-capture-target:${this.captureTargets.length}`);
    } else {
      this.calls.push(`restore-target:${activeCubeFace}:${activeMipmapLevel}`);
    }
  }

  setClearColor(value: THREE.ColorRepresentation, alpha = 1): void {
    if (value instanceof THREE.Color) {
      this.calls.push("restore-clear-color");
      this.clearColor.copy(value);
    } else {
      this.calls.push("set-transparent-clear");
      this.clearColor.set(value);
    }
    this.clearAlpha = alpha;
  }

  clear(): void {
    this.calls.push("clear");
  }

  render(): void {
    this.calls.push("render");
  }

  readRenderTargetPixels(
    target: THREE.WebGLRenderTarget,
    _x: number,
    _y: number,
    width: number,
    height: number,
    output: Uint8Array,
  ): void {
    this.calls.push("read");
    this.readTarget = target;
    if (this.failRead) throw new Error("readback failed");
    expect({ width, height }).toEqual({ width: 1, height: 2 });
    output.set([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Studio VRM raster capture", () => {
  it("flips bottom-up WebGL rows into a fresh top-down RGBA snapshot", () => {
    const source = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]);

    const output = flipStudioVrmCaptureRows(source, { width: 1, height: 2 });

    expect([...output]).toEqual([
      5, 6, 7, 8,
      1, 2, 3, 4,
    ]);
    expect(output.buffer).not.toBe(source.buffer);
    expect(() => flipStudioVrmCaptureRows(source, { width: 2, height: 2 })).toThrow(TypeError);
  });

  it("renders the scene into an MSAA linear target, tone-maps through the straight-alpha output pass, and restores renderer state", () => {
    const renderer = new FakeRenderer();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ff00ff");

    const output = captureStudioVrmRgba(
      renderer as unknown as THREE.WebGLRenderer,
      scene,
      new THREE.PerspectiveCamera(),
      { width: 1, height: 2 },
    );

    expect([...output]).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    expect(renderer.calls).toEqual([
      "get-target",
      "get-active-cube-face",
      "get-active-mipmap-level",
      "get-clear-color",
      "get-clear-alpha",
      "set-capture-target:1",
      "set-transparent-clear",
      "clear",
      "render",
      "set-capture-target:2",
      "render",
      "read",
      "restore-target:3:2",
      "restore-clear-color",
    ]);
    // Transparent cutouts suppress scene.background for the color pass, then restore it.
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHexString()).toBe("ff00ff");
    const [sceneTarget, outputTarget] = renderer.captureTargets;
    // Scene pass: antialiased linear working buffer; no output color space of its own.
    expect(sceneTarget?.samples).toBe(4);
    expect(sceneTarget?.texture.colorSpace).toBe(THREE.NoColorSpace);
    // Output pass target: display-ready bytes, read back synchronously.
    expect(outputTarget?.samples).toBe(0);
    expect(outputTarget?.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(renderer.readTarget).toBe(outputTarget);
    expect(renderer.clearColor.getHexString()).toBe("234567");
    expect(renderer.clearAlpha).toBe(0.75);
  });

  it("honors an opaque capture clear without suppressing scene.background", () => {
    const renderer = new FakeRenderer();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#112233");

    captureStudioVrmRgba(
      renderer as unknown as THREE.WebGLRenderer,
      scene,
      new THREE.PerspectiveCamera(),
      { width: 1, height: 2 },
      { color: "#abcdef", alpha: 1 },
    );

    expect(renderer.clearAlpha).toBe(0.75);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHexString()).toBe("112233");
    expect(renderer.calls).toContain("set-transparent-clear");
  });

  it("restores renderer state even when GPU readback fails", () => {
    const renderer = new FakeRenderer();
    renderer.failRead = true;

    expect(() => captureStudioVrmRgba(
      renderer as unknown as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { width: 1, height: 2 },
    )).toThrow("readback failed");
    expect(renderer.calls.slice(-2)).toEqual(["restore-target:3:2", "restore-clear-color"]);
    expect(renderer.clearColor.getHexString()).toBe("234567");
    expect(renderer.clearAlpha).toBe(0.75);
  });

  it("encodes exactly one color layer in the Worker without mutating caller pixels", async () => {
    let received: StudioBg3dLtRasterLayer | undefined;
    const deps = dependencies({
      encodePngInWorker: vi.fn(async (layers) => {
        received = layers[0];
        return png(2, 1);
      }),
    });
    const rgba = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);

    await expect(encodeStudioVrmCapturePngDataUrl(
      rgba,
      { width: 2, height: 1 },
      {},
      deps,
    )).resolves.toBe("data:image/png;base64,verified");

    expect(received).toEqual({ role: "color", width: 2, height: 1, data: rgba });
    expect([...rgba]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(deps.encodePngOnMainThread).not.toHaveBeenCalled();
    expect(deps.blobToDataUrl).toHaveBeenCalledOnce();
    expect(deps.blobToDataUrl).toHaveBeenCalledWith(expect.any(Blob), {});
  });

  it("returns a verified PNG Blob without data-URL serialization for artifact persistence", async () => {
    const deps = dependencies();
    const rgba = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);

    const result = await encodeStudioVrmCapturePngBlob(
      rgba,
      { width: 2, height: 1 },
      {},
      deps,
    );

    expect(result.type).toBe("image/png");
    expect(deps.encodePngInWorker).toHaveBeenCalledOnce();
    expect(deps.blobToDataUrl).not.toHaveBeenCalled();
    expect([...rgba]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("bounds and cancels a stalled PNG data URL read", async () => {
    class HangingFileReader {
      static last: HangingFileReader | null = null;
      result: string | ArrayBuffer | null = null;
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      abort = vi.fn();

      constructor() {
        HangingFileReader.last = this;
      }

      readAsDataURL(): void {
        // Intentionally never settles.
      }
    }
    vi.useFakeTimers();
    vi.stubGlobal("FileReader", HangingFileReader);

    const pending = readStudioVrmPngBlobAsDataUrl(png(1, 1), { timeoutMs: 100 });
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(HangingFileReader.last?.abort).toHaveBeenCalledOnce();
  });

  it("keeps Worker failure terminal and uses main-thread encoding only when preselected", async () => {
    const encodePngOnMainThread = vi.fn(
      async (_rgba, dimensions) => png(dimensions.width, dimensions.height),
    );
    const workerUnavailable = dependencies({
      encodePngInWorker: vi.fn(async () => {
        throw new StudioBg3dShotPngWorkerError("worker-unavailable");
      }),
      encodePngOnMainThread,
    });

    await expect(encodeStudioVrmCapturePngDataUrl(
      new Uint8ClampedArray(8),
      { width: 2, height: 1 },
      {},
      workerUnavailable,
    )).rejects.toMatchObject({ code: "worker-unavailable" });
    expect(encodePngOnMainThread).not.toHaveBeenCalled();

    const explicitMainThread = dependencies({
      encodePngInWorker: vi.fn(),
      encodePngOnMainThread,
    });
    await expect(encodeStudioVrmCapturePngDataUrl(
      new Uint8ClampedArray(8),
      { width: 2, height: 1 },
      { encoderBackend: "main-thread" },
      explicitMainThread,
    )).resolves.toBe("data:image/png;base64,verified");
    expect(encodePngOnMainThread).toHaveBeenCalledOnce();
    expect(explicitMainThread.encodePngInWorker).not.toHaveBeenCalled();
  });

  it("rejects malformed output, oversized requests, and already-aborted work", async () => {
    const malformed = dependencies({
      encodePngInWorker: vi.fn(async () => new Blob([new Uint8Array(32)], { type: "image/png" })),
    });
    await expect(encodeStudioVrmCapturePngDataUrl(
      new Uint8ClampedArray(8),
      { width: 2, height: 1 },
      {},
      malformed,
    )).rejects.toThrow("PNG 헤더");
    expect(malformed.blobToDataUrl).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    const aborted = dependencies();
    await expect(encodeStudioVrmCapturePngDataUrl(
      new Uint8ClampedArray(8),
      { width: 2, height: 1 },
      { signal: controller.signal },
      aborted,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted.encodePngInWorker).not.toHaveBeenCalled();

    expect(() => flipStudioVrmCaptureRows(new Uint8Array(4), {
      width: 4_097,
      height: 1,
    })).toThrow(RangeError);
  });
});
