import { describe, expect, it, vi } from "vitest";

import {
  assertStudioSharedAssetContentMatchesCatalog,
  verifyStudioSharedAssetContent,
} from "./studio-shared-asset-content";

import type { SharedAssetCatalogItem, SharedAssetContent } from "@/src/infrastructure/creator-client";

const CATALOG_ITEM: SharedAssetCatalogItem = {
  id: "asset-1",
  name: "골목 배경",
  description: "",
  tags: [],
  previewDataUrl: "data:image/webp;base64,cHJldmlldw==",
  previewWidth: 160,
  previewHeight: 90,
  previewAvailable: true,
  width: 2,
  height: 1,
  kind: "image",
  license: "cc-by-4.0",
  licenseLabel: "CC BY",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attributionRequired: true,
  commercialUse: true,
  attributionText: "작가",
  containsAi: false,
  moderationStatus: "published",
  reportCount: 0,
  downloads: 3,
  author: { id: "author-1", name: "작가", avatar: "#fff" },
  isOwner: false,
  createdAt: "2026-07-20T00:00:00.000Z",
};

const CONTENT: SharedAssetContent = {
  id: "asset-1",
  dataUrl: "data:image/png;base64,AA==",
  width: 2,
  height: 1,
  kind: "image",
  mimeType: "image/png",
  byteSize: 1,
  contentHash: "0".repeat(64),
};

describe("shared asset on-demand content verification", () => {
  it("카탈로그와 일치하고 실제 픽셀 크기가 같은 원본만 반환하며 bitmap을 닫는다", async () => {
    const close = vi.fn();
    const decode = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBe(1);
      return { width: 2, height: 1, close };
    });

    await expect(verifyStudioSharedAssetContent(CATALOG_ITEM, CONTENT, { decode }))
      .resolves.toBe(CONTENT);
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("id·크기·kind가 카탈로그와 달라지면 디코더 전에 fail closed한다", () => {
    expect(() => assertStudioSharedAssetContentMatchesCatalog(CATALOG_ITEM, {
      ...CONTENT,
      id: "swapped-asset",
    })).toThrow("카탈로그 정보와 일치하지");
    expect(() => assertStudioSharedAssetContentMatchesCatalog(CATALOG_ITEM, {
      ...CONTENT,
      width: 3,
    })).toThrow("카탈로그 정보와 일치하지");
    expect(() => assertStudioSharedAssetContentMatchesCatalog(CATALOG_ITEM, {
      ...CONTENT,
      kind: "sticker",
    })).toThrow("카탈로그 정보와 일치하지");
  });

  it("깨진 data URL과 디코드 실패·픽셀 크기 불일치를 모두 거부하고 자원을 정리한다", async () => {
    await expect(verifyStudioSharedAssetContent(CATALOG_ITEM, {
      ...CONTENT,
      dataUrl: "data:text/plain;base64,AA==",
    }, { decode: vi.fn() })).rejects.toThrow("이미지 형식이 올바르지");

    await expect(verifyStudioSharedAssetContent(CATALOG_ITEM, CONTENT, {
      decode: vi.fn(async () => { throw new Error("corrupt"); }),
    })).rejects.toThrow("압축 픽셀 데이터를 해석하지");

    const close = vi.fn();
    await expect(verifyStudioSharedAssetContent(CATALOG_ITEM, CONTENT, {
      decode: vi.fn(async () => ({ width: 1, height: 1, close })),
    })).rejects.toThrow("실제 크기가 카탈로그 정보와 일치하지");
    expect(close).toHaveBeenCalledOnce();
  });

  it("VRM 포즈의 재편집 fragment는 이미지 디코드에서 제외하되 일반 이미지 fragment는 거부한다", async () => {
    const close = vi.fn();
    const vrmAsset = { ...CATALOG_ITEM, kind: "vrm_pose" };
    const vrmContent = {
      ...CONTENT,
      kind: "vrm_pose",
      dataUrl: `${CONTENT.dataUrl}#${encodeURIComponent(JSON.stringify({ tool: "vrm-poser" }))}`,
    };
    await expect(verifyStudioSharedAssetContent(vrmAsset, vrmContent, {
      decode: vi.fn(async () => ({ width: 2, height: 1, close })),
    })).resolves.toBe(vrmContent);
    expect(close).toHaveBeenCalledOnce();

    await expect(verifyStudioSharedAssetContent(CATALOG_ITEM, {
      ...CONTENT,
      dataUrl: `${CONTENT.dataUrl}#metadata`,
    }, { decode: vi.fn() })).rejects.toThrow("허용되지 않은 메타데이터");
  });
});
