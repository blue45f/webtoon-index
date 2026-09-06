import { afterEach, describe, expect, it, vi } from "vitest";

import {
  encodeStudioPixelEditCanvasPng,
  runStudioPixelEditBakePipeline,
  yieldStudioMainThread,
} from "./studio-pixel-edit-async";

class FakeFileReader {
  error: DOMException | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: string | ArrayBuffer | null = null;

  abort(): void {}

  readAsDataURL(): void {
    this.result = "data:image/png;base64,async";
    queueMicrotask(() => this.onload?.());
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio-pixel-edit-async", () => {
  it("yieldStudioMainThread resolves (scheduler.yield or rAF/setTimeout fallback)", async () => {
    await expect(yieldStudioMainThread()).resolves.toBeUndefined();
  });

  it("runStudioPixelEditBakePipeline yields between rasterize, apply, and encode", async () => {
    const order: string[] = [];
    const yieldControl = vi.fn(async () => {
      order.push("yield");
    });

    const src = await runStudioPixelEditBakePipeline({
      rasterize: () => {
        order.push("rasterize");
        return { mask: true };
      },
      apply: (mask) => {
        order.push(`apply:${mask.mask}`);
        return { canvas: true };
      },
      encode: async (out) => {
        order.push(`encode:${out.canvas}`);
        return "data:image/png;base64,abc";
      },
      yieldControl,
    });

    expect(src).toBe("data:image/png;base64,abc");
    expect(order).toEqual(["rasterize", "yield", "apply:true", "yield", "encode:true"]);
    expect(yieldControl).toHaveBeenCalledTimes(2);
  });

  it("runStudioPixelEditBakePipeline returns null when rasterize yields nothing", async () => {
    const encode = vi.fn(async () => "unused");
    const src = await runStudioPixelEditBakePipeline({
      rasterize: () => null,
      apply: () => ({ ok: true }),
      encode,
      yieldBetweenStages: false,
    });
    expect(src).toBeNull();
    expect(encode).not.toHaveBeenCalled();
  });

  it("encodeStudioPixelEditCanvasPng prefers toBlob over toDataURL", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    const toDataURL = vi.fn(() => "data:image/png;base64,sync");
    const toBlob = vi.fn((callback: BlobCallback) => {
      queueMicrotask(() => callback(new Blob(["png-bytes"], { type: "image/png" })));
    });
    const canvas = { toBlob, toDataURL } as unknown as HTMLCanvasElement;

    const src = await encodeStudioPixelEditCanvasPng(canvas);
    expect(toBlob).toHaveBeenCalledOnce();
    expect(toDataURL).not.toHaveBeenCalled();
    expect(src).toBe("data:image/png;base64,async");
  });

  it("encodeStudioPixelEditCanvasPng falls back to toDataURL when toBlob is missing", async () => {
    const toDataURL = vi.fn(() => "data:image/png;base64,legacy");
    const canvas = { toDataURL } as unknown as HTMLCanvasElement;
    await expect(encodeStudioPixelEditCanvasPng(canvas)).resolves.toBe(
      "data:image/png;base64,legacy",
    );
  });
});
