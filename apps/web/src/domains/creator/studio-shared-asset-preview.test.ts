import { describe, expect, it, vi } from "vitest";

import {
  createStudioSharedAssetPreview,
  creatorAssetBaseImageDataUrl,
  creatorAssetDataUrlByteLength,
  fitCreatorAssetPreviewDimensions,
} from "./studio-shared-asset-preview";

import type { StudioSharedAssetPreviewRuntime } from "./studio-shared-asset-preview";

function encodedDataUrl(byteLength: number): string {
  return `data:image/webp;base64,${Buffer.alloc(byteLength, 1).toString("base64")}`;
}

describe("shared asset catalog preview", () => {
  it("VRM metadata fragment를 이미지 디코더에 전달하지 않는다", () => {
    const base = "data:image/png;base64,AAAA";
    expect(creatorAssetBaseImageDataUrl(`${base}#${encodeURIComponent('{"tool":"vrm-poser"}')}`)).toBe(base);
  });

  it("긴 변 320px 안에서 종횡비를 보존한다", () => {
    expect(fitCreatorAssetPreviewDimensions(1600, 900, 320)).toEqual({ width: 320, height: 180 });
    expect(fitCreatorAssetPreviewDimensions(120, 240, 320)).toEqual({ width: 120, height: 240 });
    expect(() => fitCreatorAssetPreviewDimensions(0, 100, 320)).toThrow("원본 크기");
  });

  it("base64의 실제 decoded byte 수를 계산한다", () => {
    expect(creatorAssetDataUrlByteLength(encodedDataUrl(131_072))).toBe(131_072);
    expect(creatorAssetDataUrlByteLength("data:image/svg+xml;base64,AAAA")).toBeNull();
  });

  it("품질 시도 후에도 큰 경우 치수를 낮춰 128KiB 이하 결과만 반환한다", async () => {
    const loadImage = vi.fn(async () => ({ image: {} as CanvasImageSource, width: 1600, height: 900 }));
    const encode = vi.fn((_image: CanvasImageSource, width: number) =>
      encodedDataUrl(width === 320 ? 140_000 : 90_000)
    );
    const runtime: StudioSharedAssetPreviewRuntime = { loadImage, encode };

    await expect(createStudioSharedAssetPreview("data:image/png;base64,AAAA#metadata", runtime)).resolves.toEqual({
      previewDataUrl: encodedDataUrl(90_000),
      previewWidth: 256,
      previewHeight: 144,
    });
    expect(loadImage).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(encode).toHaveBeenCalledTimes(5);
  });
});
