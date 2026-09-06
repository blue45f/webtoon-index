import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  validateSharedAssetCatalogItem,
  validateSharedAssetContentResponse,
} from "./creator-asset-response-validation";

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_1X1.split(",")[1]!, "base64");
const PNG_HASH = createHash("sha256").update(PNG_BYTES).digest("hex");

function mismatchedExtendedWebp(): { dataUrl: string; bytes: Buffer; hash: string } {
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, "ascii");
  vp8x.writeUInt32LE(10, 4);
  const vp8l = Buffer.alloc(14);
  vp8l.write("VP8L", 0, "ascii");
  vp8l.writeUInt32LE(5, 4);
  vp8l.set([0x2f, 0x01, 0x40, 0x00, 0x00], 8);
  const body = Buffer.concat([vp8x, vp8l]);
  const bytes = Buffer.alloc(12 + body.length);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  body.copy(bytes, 12);
  return {
    bytes,
    dataUrl: `data:image/webp;base64,${bytes.toString("base64")}`,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function catalogItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    name: "배경",
    description: "",
    tags: [],
    width: 1,
    height: 1,
    kind: "image",
    previewDataUrl: PNG_1X1,
    previewWidth: 1,
    previewHeight: 1,
    previewAvailable: true,
    downloads: 0,
    reportCount: 0,
    license: "cc-by-4.0",
    licenseLabel: "CC BY",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionRequired: true,
    commercialUse: true,
    attributionText: "작가",
    containsAi: false,
    moderationStatus: "published",
    author: { id: "author-1", name: "작가", avatar: "#fff" },
    isOwner: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("creator asset response validation", () => {
  it("content의 magic·실제 크기·byteSize·SHA-256을 모두 검증한다", async () => {
    await expect(validateSharedAssetContentResponse({
      id: "asset-1",
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash: PNG_HASH,
    }, "asset-1")).resolves.toMatchObject({ id: "asset-1", mimeType: "image/png" });

    await expect(validateSharedAssetContentResponse({
      id: "asset-1",
      dataUrl: PNG_1X1.replace("image/png", "image/webp"),
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/webp",
      byteSize: PNG_BYTES.length,
      contentHash: PNG_HASH,
    }, "asset-1")).rejects.toThrow("응답이 올바르지");
    await expect(validateSharedAssetContentResponse({
      id: "asset-1",
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash: "0".repeat(64),
    }, "asset-1")).rejects.toThrow("응답이 올바르지");
  });

  it("fragment는 vrm_pose의 bounded vrm-poser JSON에만 허용하고 같은 hash 계약을 쓴다", async () => {
    const metadata = JSON.stringify({ tool: "vrm-poser", version: 3 });
    const contentHash = createHash("sha256").update(`${PNG_HASH}\0${metadata}`).digest("hex");
    await expect(validateSharedAssetContentResponse({
      id: "pose-1",
      dataUrl: `${PNG_1X1}#${encodeURIComponent(metadata)}`,
      width: 1,
      height: 1,
      kind: "vrm_pose",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash,
    }, "pose-1")).resolves.toMatchObject({ kind: "vrm_pose" });

    await expect(validateSharedAssetContentResponse({
      id: "asset-1",
      dataUrl: `${PNG_1X1}#${encodeURIComponent(metadata)}`,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash,
    }, "asset-1")).rejects.toThrow("응답이 올바르지");
  });

  it("catalog sanitizer가 PNG/JPEG/WebP 외 preview와 위장 MIME·fragment를 제거한다", () => {
    expect(validateSharedAssetCatalogItem(catalogItem())).not.toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({
      previewDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({
      previewDataUrl: PNG_1X1.replace("image/png", "image/webp"),
    }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({
      previewDataUrl: `${PNG_1X1}#payload`,
    }))).toBeNull();
  });

  it("VP8X canvas와 실제 payload가 다른 catalog preview와 content를 fail-closed 한다", async () => {
    const mismatch = mismatchedExtendedWebp();
    expect(validateSharedAssetCatalogItem(catalogItem({
      previewDataUrl: mismatch.dataUrl,
    }))).toBeNull();
    await expect(validateSharedAssetContentResponse({
      id: "asset-1",
      dataUrl: mismatch.dataUrl,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/webp",
      byteSize: mismatch.bytes.length,
      contentHash: mismatch.hash,
    }, "asset-1")).rejects.toThrow("응답이 올바르지");
  });

  it("catalog metadata의 author·license·moderation·owner·date·count도 exact 검증한다", () => {
    expect(validateSharedAssetCatalogItem(catalogItem({ author: { id: "a", avatar: "#fff" } }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ license: "javascript:alert(1)" }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ licenseUrl: "javascript:alert(1)" }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ moderationStatus: "deleted" }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ isOwner: "yes" }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ createdAt: "not-a-date" }))).toBeNull();
    expect(validateSharedAssetCatalogItem(catalogItem({ downloads: -1 }))).toBeNull();
  });
});
