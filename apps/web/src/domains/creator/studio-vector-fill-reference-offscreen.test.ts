import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeStudioVectorReferenceRasterizer,
  preloadStudioVectorReferenceRasterizer,
  rasterizeStudioVectorReferenceOffscreen,
} from "./studio-vector-fill-reference";

import type {
  StudioOffscreenRasterRunInput,
  StudioOffscreenRasterSession,
} from "./studio-offscreen-raster-worker-client";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pngBlob(size: number): Blob {
  const bytes = new Uint8Array(Math.max(size, PNG_SIGNATURE.byteLength));
  bytes.set(PNG_SIGNATURE);
  return new Blob([bytes], { type: "image/png" });
}

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  abort(): void {}

  readAsDataURL(): void {
    this.result = PNG_DATA_URL;
    queueMicrotask(() => this.onload?.());
  }
}

afterEach(() => {
  disposeStudioVectorReferenceRasterizer();
  vi.unstubAllGlobals();
});

function request(over: Partial<Parameters<typeof rasterizeStudioVectorReferenceOffscreen>[0]> = {}) {
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"/>',
    width: 320,
    height: 240,
    maxOutputBytes: 1024,
    ...over,
  };
}

describe("Studio vector reference OffscreenCanvas rasterizer", () => {
  it("transfers one decoded SVG bitmap and receives an asynchronously encoded PNG", async () => {
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("FileReader", FakeFileReader);
    const close = vi.fn();
    const bitmap = { width: 320, height: 240, close } as unknown as ImageBitmap;
    const dispose = vi.fn();
    let captured: StudioOffscreenRasterRunInput | null = null;
    const session: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async (_jobKey, input) => {
        captured = input;
        return {
          ok: true as const,
          runId: 1,
          width: 320,
          height: 240,
          payload: {
            kind: "encoded" as const,
            mime: "image/png" as const,
            blob: pngBlob(24),
          },
        };
      }),
      dispose,
    };

    const result = await rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap: vi.fn(async () => bitmap),
      createSession: () => session,
    });

    expect(result).toEqual({ dataUrl: PNG_DATA_URL, width: 320, height: 240 });
    expect(captured).toMatchObject({
      target: { width: 320, height: 240, background: null },
      sources: [{
        kind: "bitmap",
        placement: {
          dx: 0,
          dy: 0,
          dw: 320,
          dh: 240,
          opacity: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
      }],
      output: { kind: "encoded", mime: "image/png" },
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a mislabeled non-PNG Worker result instead of accepting codec substitution", async () => {
    vi.stubGlobal("Worker", class Worker {});
    const close = vi.fn();
    const session: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async () => ({
        ok: true as const,
        runId: 1,
        width: 320,
        height: 240,
        payload: {
          kind: "encoded" as const,
          mime: "image/png" as const,
          blob: new Blob([new TextEncoder().encode("RIFF0000WEBP")], { type: "image/png" }),
        },
      })),
      dispose: vi.fn(),
    };

    await expect(rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap: async () => ({ width: 320, height: 240, close }) as unknown as ImageBitmap,
      createSession: () => session,
    })).rejects.toMatchObject({ code: "raster-unavailable" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed before decoding when the selected Worker provider is unavailable", async () => {
    const createBitmap = vi.fn();

    await expect(rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap,
    })).rejects.toMatchObject({ code: "raster-unavailable" });
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("does not switch providers when the selected Worker session fails to start", async () => {
    vi.stubGlobal("Worker", class Worker {});
    const close = vi.fn();
    const browserCanvas = vi.fn();
    vi.stubGlobal("document", { createElement: browserCanvas });

    await expect(rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap: async () => ({ width: 320, height: 240, close }) as unknown as ImageBitmap,
      createSession: () => { throw new Error("startup failed"); },
    })).rejects.toMatchObject({ code: "raster-unavailable" });

    expect(browserCanvas).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("decodes SVG through the image element when the blob decoder cannot read it", async () => {
    // Chromium and WebKit reject createImageBitmap(svgBlob) with InvalidStateError, which used to
    // make this provider — the only one the filter menu selects — fail on every real browser.
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("FileReader", FakeFileReader);
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:studio-vector-reference",
      revokeObjectURL: () => {},
    });
    const loaded: string[] = [];
    vi.stubGlobal("Image", class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        loaded.push(value);
        queueMicrotask(() => this.onload?.());
      }
    });
    const close = vi.fn();
    const elementSources: unknown[] = [];
    vi.stubGlobal("createImageBitmap", async (source: unknown) => {
      elementSources.push(source);
      return { width: 320, height: 240, close } as unknown as ImageBitmap;
    });
    const session: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async () => ({
        ok: true as const,
        runId: 1,
        width: 320,
        height: 240,
        payload: {
          kind: "encoded" as const,
          mime: "image/png" as const,
          blob: pngBlob(24),
        },
      })),
      dispose: vi.fn(),
    };
    const createBitmap = vi.fn(async () => {
      throw new DOMException("The source image could not be decoded.", "InvalidStateError");
    });

    const result = await rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap,
      createSession: () => session,
    });

    expect(result).toEqual({ dataUrl: PNG_DATA_URL, width: 320, height: 240 });
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(loaded).toEqual(["blob:studio-vector-reference"]);
    // The draw and PNG encode still happen on the Worker, so the selected backend stays honest.
    expect(session.run).toHaveBeenCalledOnce();
    expect(elementSources).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("still fails closed when neither SVG decoder can read the page", async () => {
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:studio-vector-reference",
      revokeObjectURL: () => {},
    });
    vi.stubGlobal("Image", class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    });
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("unreachable");
    });

    await expect(rasterizeStudioVectorReferenceOffscreen(request(), {
      createBitmap: async () => {
        throw new DOMException("The source image could not be decoded.", "InvalidStateError");
      },
      createSession: () => { throw new Error("session must not be leased"); },
    })).rejects.toMatchObject({ code: "raster-unavailable" });
  });

  it("keeps the PNG output budget authoritative on the accelerated path", async () => {
    vi.stubGlobal("Worker", class Worker {});
    const close = vi.fn();
    const session: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async () => ({
        ok: true as const,
        runId: 1,
        width: 320,
        height: 240,
        payload: {
          kind: "encoded" as const,
          mime: "image/png" as const,
          blob: pngBlob(64),
        },
      })),
      dispose: vi.fn(),
    };

    await expect(rasterizeStudioVectorReferenceOffscreen(
      request({ maxOutputBytes: 16 }),
      {
        createBitmap: async () => ({ width: 320, height: 240, close }) as unknown as ImageBitmap,
        createSession: () => session,
      },
    )).rejects.toMatchObject({
      code: "png-budget-exceeded",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels before allocating a bitmap", async () => {
    vi.stubGlobal("Worker", class Worker {});
    const controller = new AbortController();
    controller.abort();
    const createBitmap = vi.fn();

    await expect(rasterizeStudioVectorReferenceOffscreen(
      request({ signal: controller.signal }),
      { createBitmap },
    )).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("reuses an intent-warmed session and releases it only after the idle lease", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Worker", class Worker {});
      vi.stubGlobal("FileReader", FakeFileReader);
      const close = vi.fn();
      const warm = vi.fn(() => true);
      const dispose = vi.fn();
      const session: StudioOffscreenRasterSession = {
        warm,
        run: vi.fn(async () => ({
          ok: true as const,
          runId: 1,
          width: 320,
          height: 240,
          payload: {
            kind: "encoded" as const,
            mime: "image/png" as const,
            blob: pngBlob(24),
          },
        })),
        dispose,
      };

      expect(preloadStudioVectorReferenceRasterizer(() => session)).toBe(true);
      expect(warm).toHaveBeenCalledOnce();
      expect(session.run).not.toHaveBeenCalled();

      await rasterizeStudioVectorReferenceOffscreen(request(), {
        createBitmap: async () => ({ width: 320, height: 240, close }) as unknown as ImageBitmap,
      });
      await rasterizeStudioVectorReferenceOffscreen(request({ svg: "<svg data-document='second'/>" }), {
        createBitmap: async () => ({ width: 320, height: 240, close }) as unknown as ImageBitmap,
      });

      expect(session.run).toHaveBeenCalledTimes(2);
      expect(vi.mocked(session.run).mock.calls[0]?.[0])
        .not.toBe(vi.mocked(session.run).mock.calls[1]?.[0]);
      expect(dispose).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards a fatal shared session before the next intent warmup", async () => {
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("FileReader", FakeFileReader);
    const firstDispose = vi.fn();
    const first: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async () => ({
        ok: false as const,
        runId: 1,
        code: "worker-failed" as const,
        message: "worker crashed",
      })),
      dispose: firstDispose,
    };
    const second: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(async () => ({
        ok: true as const,
        runId: 2,
        width: 320,
        height: 240,
        payload: {
          kind: "encoded" as const,
          mime: "image/png" as const,
          blob: pngBlob(24),
        },
      })),
      dispose: vi.fn(),
    };
    const createBitmap = async () => ({
      width: 320,
      height: 240,
      close: vi.fn(),
    }) as unknown as ImageBitmap;

    expect(preloadStudioVectorReferenceRasterizer(() => first)).toBe(true);
    await expect(rasterizeStudioVectorReferenceOffscreen(
      request(),
      { createBitmap },
    )).rejects.toMatchObject({ code: "raster-unavailable" });
    expect(firstDispose).toHaveBeenCalledOnce();

    expect(preloadStudioVectorReferenceRasterizer(() => second)).toBe(true);
    await expect(rasterizeStudioVectorReferenceOffscreen(
      request(),
      { createBitmap },
    )).resolves.toEqual({ dataUrl: PNG_DATA_URL, width: 320, height: 240 });
    expect(second.run).toHaveBeenCalledOnce();
  });

  it("fails a throwing intent handshake closed without retaining the session", () => {
    vi.stubGlobal("Worker", class Worker {});
    const dispose = vi.fn();
    const broken: StudioOffscreenRasterSession = {
      warm: () => { throw new Error("startup failed"); },
      run: vi.fn(),
      dispose,
    };

    expect(preloadStudioVectorReferenceRasterizer(() => broken)).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("drops an unavailable warm session so the next intent can create a healthy one", () => {
    vi.stubGlobal("Worker", class Worker {});
    const unavailableDispose = vi.fn();
    const unavailable: StudioOffscreenRasterSession = {
      warm: vi.fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      run: vi.fn(),
      dispose: unavailableDispose,
    };
    const healthy: StudioOffscreenRasterSession = {
      warm: vi.fn(() => true),
      run: vi.fn(),
      dispose: vi.fn(),
    };
    const createHealthy = vi.fn(() => healthy);

    expect(preloadStudioVectorReferenceRasterizer(() => unavailable)).toBe(true);
    expect(preloadStudioVectorReferenceRasterizer(createHealthy)).toBe(false);
    expect(unavailableDispose).toHaveBeenCalledOnce();
    expect(createHealthy).not.toHaveBeenCalled();
    expect(preloadStudioVectorReferenceRasterizer(createHealthy)).toBe(true);
    expect(createHealthy).toHaveBeenCalledOnce();
    expect(healthy.warm).toHaveBeenCalledOnce();
  });
});
