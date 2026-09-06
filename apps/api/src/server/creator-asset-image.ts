import { createHash } from "node:crypto";

import { CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS } from "../../../web/src/shared/lib/creator-asset-contract";
import {
  inspectStrictJpegDimensions,
  inspectStrictStaticWebpDimensions,
} from "../../../web/src/shared/lib/strict-raster-image-inspector";

export const CREATOR_ASSET_MAX_ENCODED_BYTES = 2_250_000;
export const CREATOR_ASSET_MAX_DIMENSION = 4096;
export const CREATOR_ASSET_MAX_PIXELS = 16_777_216;
export const CREATOR_ASSET_PREVIEW_MAX_BYTES = 128 * 1024;
export const CREATOR_ASSET_PREVIEW_MAX_DIMENSION = 320;
export const CREATOR_ASSET_VRM_METADATA_MAX_ENCODED_CHARS = 256 * 1024;
export const CREATOR_ASSET_VRM_METADATA_MAX_DECODED_BYTES = 192 * 1024;

const CREATOR_ASSET_VRM_METADATA_MAX_DEPTH = 32;
const CREATOR_ASSET_VRM_METADATA_MAX_NODES = 20_000;
export const CREATOR_VRM_POSE_FRAGMENT_MAX_CHARACTERS = 100_000;

export type CreatorAssetImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface InspectedCreatorAssetImage {
  dataUrl: string;
  mimeType: CreatorAssetImageMime;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export interface InspectedCreatorAssetPayload extends InspectedCreatorAssetImage {
  baseDataUrl: string;
  vrmMetadata: Record<string, unknown> | null;
}

export interface PersistedCreatorAssetIntegrityMetadata {
  mimeType: unknown;
  byteSize: unknown;
  contentHash: unknown;
}

export interface CreatorAssetPreviewForResponse {
  dataUrl: string;
  width: number;
  height: number;
  available: boolean;
}

export const CREATOR_ASSET_FALLBACK_PREVIEW_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=";

export interface InspectCreatorAssetDataUrlOptions {
  /** Allows the URI-encoded, re-editable VRM state carried after the preview PNG fragment. */
  allowVrmPoseFragment?: boolean;
}

function invalid(message: string): never {
  throw new Error(message);
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function dimensionsForMime(mimeType: CreatorAssetImageMime, bytes: Buffer) {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  try {
    if (mimeType === "image/jpeg") return inspectStrictJpegDimensions(bytes);
    return inspectStrictStaticWebpDimensions(bytes);
  } catch {
    return null;
  }
}

export function inspectCreatorAssetDataUrl(
  value: unknown,
  claimedWidth?: unknown,
  claimedHeight?: unknown,
  options: InspectCreatorAssetDataUrlOptions = {},
): InspectedCreatorAssetImage {
  if (typeof value !== "string") invalid("이미지 데이터가 올바르지 않습니다.");
  const fragmentIndex = value.indexOf("#");
  const imageDataUrl = fragmentIndex === -1 ? value : value.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? null : value.slice(fragmentIndex + 1);
  if (fragment !== null) {
    if (
      !options.allowVrmPoseFragment
      || fragment.length < 1
      || fragment.length > CREATOR_VRM_POSE_FRAGMENT_MAX_CHARACTERS
      || fragment.includes("#")
    ) {
      invalid("재편집 메타데이터가 올바르지 않습니다.");
    }
    try {
      const decoded = decodeURIComponent(fragment);
      if (decoded.length > CREATOR_VRM_POSE_FRAGMENT_MAX_CHARACTERS) {
        invalid("재편집 메타데이터가 너무 큽니다.");
      }
      const metadata: unknown = JSON.parse(decoded);
      if (
        typeof metadata !== "object"
        || metadata === null
        || Array.isArray(metadata)
        || (metadata as { tool?: unknown }).tool !== "vrm-poser"
      ) {
        invalid("VRM 포즈 재편집 메타데이터가 올바르지 않습니다.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("메타데이터")) throw error;
      invalid("VRM 포즈 재편집 메타데이터를 해석할 수 없습니다.");
    }
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
  if (!match) invalid("PNG, JPEG 또는 WebP 이미지 데이터만 공유할 수 있습니다.");

  const mimeType = match[1] as CreatorAssetImageMime;
  const encoded = match[2]!;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
    invalid("이미지 base64 데이터가 손상되었습니다.");
  }
  if (bytes.length < 24 || bytes.length > CREATOR_ASSET_MAX_ENCODED_BYTES) {
    invalid("이미지는 2.25MB 이하의 유효한 파일이어야 합니다.");
  }
  const dimensions = dimensionsForMime(mimeType, bytes);
  if (!dimensions) invalid("파일 내용과 이미지 형식이 일치하지 않거나 헤더가 손상되었습니다.");
  const { width, height } = dimensions;
  if (
    width < 1 ||
    height < 1 ||
    width > CREATOR_ASSET_MAX_DIMENSION ||
    height > CREATOR_ASSET_MAX_DIMENSION ||
    width * height > CREATOR_ASSET_MAX_PIXELS
  ) {
    invalid("이미지 크기는 각 변 4096px, 전체 1,677만 픽셀 이하여야 합니다.");
  }

  const expectedWidth = Math.round(Number(claimedWidth));
  const expectedHeight = Math.round(Number(claimedHeight));
  if (
    !Number.isFinite(expectedWidth) ||
    !Number.isFinite(expectedHeight) ||
    expectedWidth !== width ||
    expectedHeight !== height
  ) {
    invalid(`이미지의 실제 크기(${width}×${height})와 전달된 크기가 일치하지 않습니다.`);
  }

  return {
    dataUrl: value,
    mimeType,
    byteSize: bytes.length,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function assertBoundedVrmMetadata(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("VRM 포즈 메타데이터는 JSON 객체여야 합니다.");
  }
  if ((value as { tool?: unknown }).tool !== "vrm-poser") {
    invalid("VRM 포즈 메타데이터의 도구 식별자가 올바르지 않습니다.");
  }

  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodeCount = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > CREATOR_ASSET_VRM_METADATA_MAX_NODES) {
      invalid("VRM 포즈 메타데이터 항목이 너무 많습니다.");
    }
    if (entry.depth > CREATOR_ASSET_VRM_METADATA_MAX_DEPTH) {
      invalid("VRM 포즈 메타데이터의 중첩이 너무 깊습니다.");
    }
    if (typeof entry.value !== "object" || entry.value === null) continue;
    const children = Array.isArray(entry.value)
      ? entry.value
      : Object.values(entry.value as Record<string, unknown>);
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
}

function parseVrmPoseFragment(fragment: string): { encoded: string; json: string; value: Record<string, unknown> } {
  if (
    fragment.length < 1 ||
    fragment.length > CREATOR_ASSET_VRM_METADATA_MAX_ENCODED_CHARS ||
    fragment.includes("#")
  ) {
    invalid("VRM 포즈 메타데이터 크기가 허용 범위를 벗어났습니다.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    invalid("VRM 포즈 메타데이터 인코딩이 손상되었습니다.");
  }
  if (Buffer.byteLength(decoded, "utf8") > CREATOR_ASSET_VRM_METADATA_MAX_DECODED_BYTES) {
    invalid("VRM 포즈 메타데이터는 192KiB 이하여야 합니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    invalid("VRM 포즈 메타데이터 JSON이 손상되었습니다.");
  }
  assertBoundedVrmMetadata(parsed);
  const json = JSON.stringify(parsed);
  if (Buffer.byteLength(json, "utf8") > CREATOR_ASSET_VRM_METADATA_MAX_DECODED_BYTES) {
    invalid("VRM 포즈 메타데이터는 192KiB 이하여야 합니다.");
  }
  return { encoded: encodeURIComponent(json), json, value: parsed };
}

/**
 * Shared raster assets are plain image data URLs. A VRM pose may additionally carry one
 * percent-encoded, bounded `vrm-poser` JSON fragment. The raster bytes are always inspected
 * independently so metadata can never bypass MIME, size, or decoded-dimension limits.
 */
export function inspectCreatorAssetPayload(
  value: unknown,
  kind: unknown,
  claimedWidth?: unknown,
  claimedHeight?: unknown
): InspectedCreatorAssetPayload {
  if (typeof value !== "string") invalid("이미지 데이터가 올바르지 않습니다.");
  const hashIndex = value.indexOf("#");
  const baseDataUrl = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? null : value.slice(hashIndex + 1);
  const inspected = inspectCreatorAssetDataUrl(baseDataUrl, claimedWidth, claimedHeight);

  if (fragment === null) {
    return { ...inspected, baseDataUrl, vrmMetadata: null };
  }
  if (kind !== "vrm_pose") {
    invalid("이미지 에셋에는 URL fragment를 포함할 수 없습니다.");
  }
  const metadata = parseVrmPoseFragment(fragment);
  return {
    ...inspected,
    dataUrl: `${baseDataUrl}#${metadata.encoded}`,
    baseDataUrl,
    vrmMetadata: metadata.value,
    sha256: createHash("sha256")
      .update(inspected.sha256, "utf8")
      .update("\0", "utf8")
      .update(metadata.json, "utf8")
      .digest("hex"),
  };
}

export function inspectCreatorAssetPreviewDataUrl(
  value: unknown,
  claimedWidth?: unknown,
  claimedHeight?: unknown
): InspectedCreatorAssetImage {
  const inspected = inspectCreatorAssetDataUrl(value, claimedWidth, claimedHeight);
  if (inspected.byteSize > CREATOR_ASSET_PREVIEW_MAX_BYTES) {
    invalid("에셋 미리보기는 128KiB 이하여야 합니다.");
  }
  if (
    inspected.width > CREATOR_ASSET_PREVIEW_MAX_DIMENSION ||
    inspected.height > CREATOR_ASSET_PREVIEW_MAX_DIMENSION
  ) {
    invalid("에셋 미리보기의 각 변은 320px 이하여야 합니다.");
  }
  return inspected;
}

export function assertCreatorAssetPersistedIntegrity(
  inspected: Pick<InspectedCreatorAssetImage, "mimeType" | "byteSize" | "sha256">,
  persisted: PersistedCreatorAssetIntegrityMetadata
): void {
  if (
    persisted.mimeType !== inspected.mimeType ||
    persisted.byteSize !== inspected.byteSize ||
    persisted.contentHash !== inspected.sha256
  ) {
    invalid("저장된 에셋 무결성 메타데이터가 원본과 일치하지 않습니다.");
  }
}

/**
 * Catalog rows can predate the strict preview contract or be altered outside the application.
 * Never echo such bytes into a list response: verify bytes and persisted metadata together, then
 * fall back to a tiny inert PNG without exposing whether the row was missing or corrupt.
 */
export function resolveCreatorAssetPreviewForResponse(input: {
  dataUrl: unknown;
  width: unknown;
  height: unknown;
  mimeType: unknown;
  byteSize: unknown;
  contentHash: unknown;
}): CreatorAssetPreviewForResponse {
  const fallback = {
    dataUrl: CREATOR_ASSET_FALLBACK_PREVIEW_DATA_URL,
    width: 1,
    height: 1,
    available: false,
  } as const;
  if (
    typeof input.dataUrl !== "string" ||
    input.dataUrl.length > CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS
  ) return fallback;
  try {
    const inspected = inspectCreatorAssetPreviewDataUrl(input.dataUrl, input.width, input.height);
    assertCreatorAssetPersistedIntegrity(inspected, {
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      contentHash: input.contentHash,
    });
    return {
      dataUrl: inspected.dataUrl,
      width: inspected.width,
      height: inspected.height,
      available: true,
    };
  } catch {
    return fallback;
  }
}
