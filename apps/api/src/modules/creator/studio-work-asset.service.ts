import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
} from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import {
  parseStudioWorkAssetDescriptor,
  isStudioWorkAssetAdmissionOptedIn,
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE,
  STUDIO_WORK_ASSET_MAX_IMAGE_AXIS,
  STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES,
  STUDIO_WORK_ASSET_MAX_IMAGE_PIXELS,
  STUDIO_WORK_ASSET_LAYER_LIFT_BATCH_VERSION,
  StudioWorkAssetLayerLiftBatchMetadataSchema,
  StudioWorkAssetLayerLiftBatchReceiptSchema,
  StudioWorkAssetManifestSchema,
  StudioWorkAssetReferenceSchema,
  serializeStudioWorkAssetDescriptorCanonical,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";
import {
  SUPABASE_OBJECT_STORAGE_CONTRACT_VERSION,
  SupabaseObjectReferenceSchema,
  SupabaseSignedReadUrlSchema,
  type SupabaseObjectPurpose,
  type SupabaseObjectReference,
  type SupabaseSignedReadUrl,
} from "../../infrastructure/supabase-object-storage/supabase-object-storage.contract";
import {
  SUPABASE_OBJECT_STORAGE_PORT,
  type SupabaseObjectStoragePort,
} from "../../infrastructure/supabase-object-storage/supabase-object-storage.port";

import {
  assertStudioR8GrainAdmissionContents,
  assertStudioR8GrainAdmissionManifest,
  assertStudioR8GrainAdmissionSourceBudget,
} from "./studio-r8-grain-admission";
import {
  STUDIO_WORK_ASSET_REPOSITORY,
  StudioWorkAssetCleanupOwnershipError,
  StudioWorkAssetForbiddenError,
  StudioWorkAssetImmutableConflictError,
  StudioWorkAssetNotFoundError,
  StudioWorkAssetQuotaError,
  StudioWorkAssetReferencedError,
  StudioWorkAssetStorageReferenceConflictError,
  StudioWorkAssetStorageReferenceNotFoundError,
  StudioWorkAssetTypeConflictError,
  isExactStudioWorkAssetStorageObject,
} from "./studio-work-asset.repository";

import type { DrizzleStudioCrdtTransaction } from "./studio-crdt.repository";
import type {
  StudioWorkAssetContent,
  StudioWorkAssetGeneratedObjectPurpose,
  StudioWorkAssetRepository,
  StudioWorkAssetStorageReference,
  StudioWorkAssetWrite,
} from "./studio-work-asset.repository";
import type { StudioBrushR8TextureGrainSource } from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import type {
  StudioWorkAssetDescriptor,
  StudioWorkAssetLayerLiftBatchMetadata,
  StudioWorkAssetLayerLiftBatchReceipt,
  StudioWorkAssetManifest,
  StudioWorkAssetIntrinsicImage,
  StudioWorkAssetReference,
  StudioWorkAssetType,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";

const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLB_MAX_JSON_BYTES = 2 * 1024 * 1024;
const STUDIO_WORK_ASSET_SIGNED_READ_MAX_SECONDS = 300;

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const GLB_UPLOAD_MIME_TYPES = new Set([
  "model/gltf-binary",
  "application/octet-stream",
  "application/vrm",
  "model/vrm",
]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

export interface StudioWorkAssetUploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface StudioWorkAssetLayerLiftUploadFiles {
  background?: StudioWorkAssetUploadFile[];
  foreground?: StudioWorkAssetUploadFile[];
}

export interface AdmittedStudioWorkAssetPayload {
  mimeType: StudioWorkAssetManifest["mimeType"];
  payload: Uint8Array;
  sha256: string;
  intrinsicImage: StudioWorkAssetIntrinsicImage | null;
}

export interface StudioWorkAssetGeneratedDeleteResult {
  readonly deleted: true;
  readonly remoteObjectDeleted: boolean;
}

export interface StudioWorkAssetSignedRead {
  readonly reference: StudioWorkAssetStorageReference;
  readonly signedRead: SupabaseSignedReadUrl;
}

interface ResolvedStudioWorkAssetStorageObject {
  readonly object: SupabaseObjectReference;
  readonly uploaded: boolean;
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

type SniffedImageMime = Extract<StudioWorkAssetManifest["mimeType"], `image/${string}`> | "image/gif";

function sniffImageMime(bytes: Uint8Array): SniffedImageMime | null {
  if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  if (
    bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  return null;
}

export interface StudioWorkAssetImageDimensions {
  width: number;
  height: number;
}

function checkedImageDimensions(width: number, height: number): StudioWorkAssetImageDimensions {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS || height > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS ||
    width * height > STUDIO_WORK_ASSET_MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `이미지는 한 변 ${STUDIO_WORK_ASSET_MAX_IMAGE_AXIS.toLocaleString("en-US")}px, ` +
      `총 ${Math.floor(STUDIO_WORK_ASSET_MAX_IMAGE_PIXELS / 1024 / 1024)}MP 이하만 사용할 수 있습니다.`
    );
  }
  return { width, height };
}

function intrinsicImageFrom(
  dimensions: StudioWorkAssetImageDimensions
): StudioWorkAssetIntrinsicImage {
  const decodedRgbaBytes = dimensions.width * dimensions.height * 4;
  if (
    !Number.isSafeInteger(decodedRgbaBytes) ||
    decodedRgbaBytes > STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES
  ) {
    throw new Error("이미지 RGBA 디코드 크기가 안전 한도를 넘었습니다.");
  }
  return { ...dimensions, decodedRgbaBytes };
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

function assertStaticPng(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  let ended = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) throw new Error("PNG 내부 블록이 잘렸습니다.");
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const type = chunkName(bytes, typeOffset);
    const chunkEnd = typeOffset + 4 + length + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) {
      throw new Error("PNG 내부 블록 경계가 올바르지 않습니다.");
    }
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      throw new Error("PNG IHDR 헤더가 올바르지 않습니다.");
    }
    if (type === "acTL") {
      throw new Error("움직이는 APNG는 협업 에셋으로 사용할 수 없습니다. 정적 PNG로 변환해 주세요.");
    }
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.byteLength) {
        throw new Error("PNG 종료 블록이 올바르지 않습니다.");
      }
      ended = true;
      break;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (!ended) throw new Error("PNG 종료 블록을 찾을 수 없습니다.");
}

function assertStaticWebp(bytes: Uint8Array): void {
  if (bytes.byteLength < 20) throw new Error("WebP 헤더가 잘렸습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = view.getUint32(4, true) + 8;
  if (declaredLength !== bytes.byteLength) throw new Error("WebP 파일 길이가 올바르지 않습니다.");
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) throw new Error("WebP 내부 블록이 잘렸습니다.");
    const type = chunkName(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + length + (length % 2);
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) {
      throw new Error("WebP 내부 블록 경계가 올바르지 않습니다.");
    }
    if (
      type === "ANIM" || type === "ANMF" ||
      (type === "VP8X" && length >= 1 && ((bytes[offset + 8] ?? 0) & 0x02) !== 0)
    ) {
      throw new Error("움직이는 WebP는 협업 에셋으로 사용할 수 없습니다. 정적 이미지로 변환해 주세요.");
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.byteLength) throw new Error("WebP 내부 블록 경계가 올바르지 않습니다.");
}

function jpegDimensions(bytes: Uint8Array): StudioWorkAssetImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG 헤더가 올바르지 않습니다.");
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset++]!;
    if (marker === 0x00) throw new Error("JPEG 헤더가 올바르지 않습니다.");
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error("JPEG 헤더가 잘렸습니다.");
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error("JPEG 크기 헤더가 올바르지 않습니다.");
      return checkedImageDimensions(
        view.getUint16(offset + 5, false),
        view.getUint16(offset + 3, false)
      );
    }
    offset += segmentLength;
  }
  throw new Error("JPEG 크기 헤더를 찾을 수 없습니다.");
}

function webpDimensions(bytes: Uint8Array): StudioWorkAssetImageDimensions {
  if (bytes.byteLength < 20) throw new Error("WebP 헤더가 잘렸습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = view.getUint32(4, true) + 8;
  const chunkLength = view.getUint32(16, true);
  if (
    declaredLength < 20 || declaredLength > bytes.byteLength ||
    chunkLength > declaredLength - 20
  ) {
    throw new Error("WebP 파일 길이가 올바르지 않습니다.");
  }
  if (bytesEqual(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
    if (chunkLength < 10 || bytes.byteLength < 30) throw new Error("WebP VP8X 헤더가 잘렸습니다.");
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return checkedImageDimensions(width, height);
  }
  if (bytesEqual(bytes, 12, [0x56, 0x50, 0x38, 0x20])) {
    if (
      chunkLength < 10 || bytes.byteLength < 30 ||
      !bytesEqual(bytes, 23, [0x9d, 0x01, 0x2a])
    ) {
      throw new Error("WebP VP8 헤더가 올바르지 않습니다.");
    }
    return checkedImageDimensions(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff
    );
  }
  if (bytesEqual(bytes, 12, [0x56, 0x50, 0x38, 0x4c])) {
    if (chunkLength < 5 || bytes.byteLength < 25 || bytes[20] !== 0x2f) {
      throw new Error("WebP VP8L 헤더가 올바르지 않습니다.");
    }
    const width = 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8);
    const height = 1 + ((bytes[22]! & 0xc0) >> 6) + (bytes[23]! << 2) +
      ((bytes[24]! & 0x0f) << 10);
    return checkedImageDimensions(width, height);
  }
  throw new Error("지원하지 않는 WebP 이미지 헤더입니다.");
}

export function readStudioWorkAssetImageDimensions(
  mimeType: Extract<StudioWorkAssetManifest["mimeType"], `image/${string}`>,
  bytes: Uint8Array
): StudioWorkAssetImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") {
    if (
      bytes.byteLength < 33 || view.getUint32(8, false) !== 13 ||
      !bytesEqual(bytes, 12, [0x49, 0x48, 0x44, 0x52])
    ) {
      throw new Error("PNG IHDR 헤더가 잘렸거나 올바르지 않습니다.");
    }
    assertStaticPng(bytes);
    return checkedImageDimensions(view.getUint32(16, false), view.getUint32(20, false));
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp") {
    assertStaticWebp(bytes);
    return webpDimensions(bytes);
  }
  throw new Error("지원하지 않는 이미지 형식입니다.");
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseGlbJson(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
    throw new Error("3D 에셋 파일이 완전하지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error("GLB 2.0 형식만 사용할 수 있습니다.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("3D 에셋의 선언 길이와 실제 크기가 다릅니다.");
  }
  let chunkOffset = GLB_HEADER_BYTES;
  let jsonChunks = 0;
  let binaryChunks = 0;
  while (chunkOffset < bytes.byteLength) {
    if (bytes.byteLength - chunkOffset < GLB_CHUNK_HEADER_BYTES) {
      throw new Error("3D 에셋 내부 블록이 완전하지 않습니다.");
    }
    const chunkLength = view.getUint32(chunkOffset, true);
    const chunkType = view.getUint32(chunkOffset + 4, true);
    const chunkEnd = chunkOffset + GLB_CHUNK_HEADER_BYTES + chunkLength;
    if (chunkLength % 4 !== 0 || chunkEnd > bytes.byteLength) {
      throw new Error("3D 에셋 내부 블록 경계가 올바르지 않습니다.");
    }
    if (chunkType === GLB_JSON_CHUNK) jsonChunks += 1;
    else if (chunkType === GLB_BIN_CHUNK) binaryChunks += 1;
    else throw new Error("지원하지 않는 3D 에셋 내부 블록이 있습니다.");
    if (
      jsonChunks > 1 ||
      binaryChunks > 1 ||
      (chunkOffset === GLB_HEADER_BYTES && chunkType !== GLB_JSON_CHUNK)
    ) {
      throw new Error("3D 에셋 내부 블록 구성이 올바르지 않습니다.");
    }
    chunkOffset = chunkEnd;
  }
  if (chunkOffset !== bytes.byteLength || jsonChunks !== 1) {
    throw new Error("3D 에셋 장면 블록이 없습니다.");
  }
  const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const jsonType = view.getUint32(GLB_HEADER_BYTES + 4, true);
  if (
    jsonType !== GLB_JSON_CHUNK ||
    jsonLength < 2 ||
    jsonLength > GLB_MAX_JSON_BYTES ||
    GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + jsonLength > bytes.byteLength
  ) {
    throw new Error("3D 에셋 장면 설명이 올바르지 않습니다.");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + jsonLength));
    let contentEnd = decoded.length;
    while (contentEnd > 0) {
      const code = decoded.charCodeAt(contentEnd - 1);
      if (code !== 0 && code !== 32) break;
      contentEnd -= 1;
    }
    decoded = decoded.slice(0, contentEnd);
  } catch {
    throw new Error("3D 에셋 장면 설명의 인코딩이 올바르지 않습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("3D 에셋 장면 설명을 해석할 수 없습니다.");
  }
  if (!plainRecord(parsed) || !plainRecord(parsed.asset) || parsed.asset.version !== "2.0") {
    throw new Error("GLB 2.0 장면 정보가 없습니다.");
  }
  for (const collectionName of ["buffers", "images"] as const) {
    const collection = parsed[collectionName];
    if (!Array.isArray(collection)) continue;
    if (collection.some((entry) => plainRecord(entry) && typeof entry.uri === "string")) {
      throw new Error("외부 리소스를 참조하는 3D 에셋은 사용할 수 없습니다.");
    }
  }
  return parsed;
}

function isVrmDocument(document: Record<string, unknown>): boolean {
  const extensionsUsed = Array.isArray(document.extensionsUsed)
    ? document.extensionsUsed.filter((value): value is string => typeof value === "string")
    : [];
  const extensions = plainRecord(document.extensions) ? document.extensions : {};
  return (
    extensionsUsed.includes("VRM") ||
    extensionsUsed.includes("VRMC_vrm") ||
    Object.hasOwn(extensions, "VRM") ||
    Object.hasOwn(extensions, "VRMC_vrm")
  );
}

export function admitStudioWorkAssetPayload(
  elementType: StudioWorkAssetType,
  declaredMimeType: string,
  input: Uint8Array
): AdmittedStudioWorkAssetPayload {
  const maximumBytes = STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE[elementType];
  if (input.byteLength < 1 || input.byteLength > maximumBytes) {
    throw new Error(`에셋은 ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하만 사용할 수 있습니다.`);
  }
  const payload = new Uint8Array(input);
  let mimeType: StudioWorkAssetManifest["mimeType"];
  let intrinsicImage: StudioWorkAssetIntrinsicImage | null = null;
  if (elementType === "image") {
    const sniffed = sniffImageMime(payload);
    if (sniffed === "image/gif") {
      throw new Error("움직일 수 있는 GIF는 협업 에셋으로 사용할 수 없습니다. 정적 PNG, JPEG 또는 WebP로 변환해 주세요.");
    }
    if (!sniffed || (!IMAGE_MIME_TYPES.has(declaredMimeType) && declaredMimeType !== "application/octet-stream")) {
      throw new Error("정적 PNG, JPEG, WebP 이미지 파일만 사용할 수 있습니다.");
    }
    if (declaredMimeType !== "application/octet-stream" && declaredMimeType !== sniffed) {
      throw new Error("이미지 MIME 형식과 실제 파일 내용이 다릅니다.");
    }
    intrinsicImage = intrinsicImageFrom(readStudioWorkAssetImageDimensions(sniffed, payload));
    mimeType = sniffed;
  } else {
    if (!GLB_UPLOAD_MIME_TYPES.has(declaredMimeType)) {
      throw new Error("VRM과 3D 배경은 내장 리소스가 포함된 GLB 파일만 사용할 수 있습니다.");
    }
    const document = parseGlbJson(payload);
    if (elementType === "vrm" && !isVrmDocument(document)) {
      throw new Error("VRM 확장 정보가 없는 모델입니다.");
    }
    mimeType = "model/gltf-binary";
  }
  return {
    mimeType,
    payload,
    sha256: createHash("sha256").update(payload).digest("hex"),
    intrinsicImage,
  };
}

function parseDescriptorJson(
  raw: string,
  expected: { assetId: string; elementType: StudioWorkAssetType }
): StudioWorkAssetDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BadRequestException("에셋 요소 설명이 올바른 JSON이 아닙니다.");
  }
  try {
    return parseStudioWorkAssetDescriptor(value, expected);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "에셋 요소 설명이 올바르지 않습니다.");
  }
}

function parseLayerLiftBatchMetadata(
  raw: string
): StudioWorkAssetLayerLiftBatchMetadata {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BadRequestException("레이어 분리 에셋 metadata가 올바른 JSON이 아닙니다.");
  }
  const parsed = StudioWorkAssetLayerLiftBatchMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException("레이어 분리 에셋 metadata 형식이 올바르지 않습니다.");
  }
  return parsed.data;
}

function exactLayerLiftUploadFiles(
  files: StudioWorkAssetLayerLiftUploadFiles | undefined
): readonly [StudioWorkAssetUploadFile, StudioWorkAssetUploadFile] {
  if (
    !files ||
    Object.keys(files).length !== 2 ||
    !Array.isArray(files.background) ||
    files.background.length !== 1 ||
    !Array.isArray(files.foreground) ||
    files.foreground.length !== 1
  ) {
    throw new BadRequestException("배경과 전경 PNG 파일이 각각 하나씩 필요합니다.");
  }
  return [files.background[0]!, files.foreground[0]!];
}

function storageObjectFor(
  purpose: SupabaseObjectPurpose,
  admitted: AdmittedStudioWorkAssetPayload,
): SupabaseObjectReference {
  return SupabaseObjectReferenceSchema.parse({
    contractVersion: SUPABASE_OBJECT_STORAGE_CONTRACT_VERSION,
    purpose,
    digest: `sha256:${admitted.sha256}`,
    objectPath: `sha256/${admitted.sha256.slice(0, 2)}/${admitted.sha256}`,
    byteLength: admitted.payload.byteLength,
    contentType: admitted.mimeType,
  });
}

function opaqueControlId(namespace: string, value: string): string {
  return `${namespace}:${createHash("sha256").update(value).digest("hex")}`;
}

function assertShortSignedReadLifetime(expiresInSeconds: number): void {
  if (
    !Number.isInteger(expiresInSeconds)
    || expiresInSeconds < 30
    || expiresInSeconds > STUDIO_WORK_ASSET_SIGNED_READ_MAX_SECONDS
  ) {
    throw new BadRequestException(
      `서명 URL 유효 시간은 30초에서 ${STUDIO_WORK_ASSET_SIGNED_READ_MAX_SECONDS}초 사이여야 합니다.`,
    );
  }
}

@Injectable()
export class StudioWorkAssetService {
  constructor(
    @Inject(STUDIO_WORK_ASSET_REPOSITORY)
    private readonly repository: StudioWorkAssetRepository,
    @Optional()
    @Inject(SUPABASE_OBJECT_STORAGE_PORT)
    private readonly objectStorage?: SupabaseObjectStoragePort,
  ) {}

  async uploadLayerLiftBatch(
    actorUserId: string,
    workId: string,
    metadataJson: string,
    filesValue: StudioWorkAssetLayerLiftUploadFiles | undefined
  ): Promise<StudioWorkAssetLayerLiftBatchReceipt> {
    if (!isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 에셋 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    const metadata = parseLayerLiftBatchMetadata(metadataJson);
    const files = exactLayerLiftUploadFiles(filesValue);
    const admittedWrites = metadata.assets.map((entry, index) => {
      const file = files[index]!;
      if (
        !Buffer.isBuffer(file.buffer) ||
        file.size !== file.buffer.byteLength ||
        file.size !== entry.byteSize
      ) {
        throw new BadRequestException(
          `${entry.role === "background" ? "배경" : "전경"} PNG 크기가 metadata와 다릅니다.`
        );
      }
      if (file.mimetype !== "image/png") {
        throw new BadRequestException("레이어 분리 결과는 PNG 파일만 업로드할 수 있습니다.");
      }
      const descriptor = (() => {
        try {
          return parseStudioWorkAssetDescriptor(entry.descriptor, {
            assetId: entry.assetId,
            elementType: "image",
          });
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? error.message
              : "레이어 분리 에셋 요소 설명이 올바르지 않습니다."
          );
        }
      })();
      let admitted: AdmittedStudioWorkAssetPayload;
      try {
        admitted = admitStudioWorkAssetPayload("image", file.mimetype, file.buffer);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "레이어 분리 PNG 파일이 올바르지 않습니다."
        );
      }
      if (
        admitted.mimeType !== "image/png" ||
        admitted.sha256 !== entry.expectedSha256 ||
        admitted.payload.byteLength !== entry.byteSize ||
        admitted.intrinsicImage?.width !== entry.width ||
        admitted.intrinsicImage.height !== entry.height
      ) {
        throw new BadRequestException(
          `${entry.role === "background" ? "배경" : "전경"} PNG가 요청에 바인딩된 내용과 다릅니다.`
        );
      }
      return {
        workId,
        assetId: entry.assetId,
        elementType: "image" as const,
        descriptor,
        ...admitted,
      };
    });

    // Authorization is checked before any remote write, then checked again under the repository's
    // work-row lock when the source/reference rows are committed atomically.
    await this.run(() => this.repository.assertCanEditWork(actorUserId, workId));
    const storage = await this.requirePrivateObjectStorage();
    const writes: StudioWorkAssetWrite[] = [];
    for (const admittedWrite of admittedWrites) {
      const { object: storageObject } = await this.resolveStorageObject(
        storage,
        "source",
        admittedWrite,
        workId,
        admittedWrite.assetId,
      );
      writes.push({ ...admittedWrite, storageObject });
    }

    // No repository mutation begins until both role-bound files have passed every binary,
    // descriptor, digest and dimension check. The repository then persists the pair in one
    // work-locked transaction.
    const stored = await this.run(() => this.repository.upsertBatch(actorUserId, writes));
    if (stored.length !== metadata.assets.length) {
      throw new Error("studio work asset layer-lift batch returned an incomplete receipt");
    }
    const manifests = stored.map((value, index) => {
      const manifest = StudioWorkAssetManifestSchema.parse(value);
      const expected = metadata.assets[index]!;
      if (
        manifest.assetId !== expected.assetId ||
        manifest.elementType !== "image" ||
        manifest.mimeType !== "image/png" ||
        manifest.sha256 !== expected.expectedSha256 ||
        manifest.byteSize !== expected.byteSize ||
        manifest.intrinsicImage?.width !== expected.width ||
        manifest.intrinsicImage.height !== expected.height ||
        serializeStudioWorkAssetDescriptorCanonical(manifest.descriptor)
          !== serializeStudioWorkAssetDescriptorCanonical(expected.descriptor)
      ) {
        throw new Error("studio work asset layer-lift batch receipt identity mismatch");
      }
      return manifest;
    });
    return StudioWorkAssetLayerLiftBatchReceiptSchema.parse({
      version: STUDIO_WORK_ASSET_LAYER_LIFT_BATCH_VERSION,
      batchId: metadata.batchId,
      assets: [
        { role: "background", manifest: manifests[0] },
        { role: "foreground", manifest: manifests[1] },
      ],
    });
  }

  async upload(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType,
    descriptorJson: string,
    file: StudioWorkAssetUploadFile | undefined
  ): Promise<StudioWorkAssetManifest> {
    if (!isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 에셋 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.byteLength) {
      throw new BadRequestException("업로드할 에셋 파일이 필요합니다.");
    }
    const descriptor = parseDescriptorJson(descriptorJson, { assetId, elementType });
    let admitted: AdmittedStudioWorkAssetPayload;
    try {
      admitted = admitStudioWorkAssetPayload(elementType, file.mimetype, file.buffer);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "에셋 파일이 올바르지 않습니다.");
    }
    await this.run(() => this.repository.assertCanEditWork(actorUserId, workId));
    const storage = await this.requirePrivateObjectStorage();
    const { object: storageObject } = await this.resolveStorageObject(
      storage,
      "source",
      admitted,
      workId,
      assetId,
    );
    return this.run(() => this.repository.upsert(actorUserId, {
      workId,
      assetId,
      elementType,
      descriptor,
      ...admitted,
      storageObject,
    }));
  }

  async uploadGeneratedObject(
    actorUserId: string,
    workId: string,
    sourceAssetId: string,
    purpose: StudioWorkAssetGeneratedObjectPurpose,
    referenceId: string,
    elementType: StudioWorkAssetType,
    file: StudioWorkAssetUploadFile | undefined,
  ): Promise<StudioWorkAssetStorageReference> {
    if (!isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 에셋 생성물 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    if (purpose !== "derived" && purpose !== "export") {
      throw new BadRequestException("원본 에셋은 생성물 경로에서 저장할 수 없습니다.");
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.byteLength) {
      throw new BadRequestException("업로드할 생성물 파일이 필요합니다.");
    }
    await this.run(() => this.repository.assertCanStoreGeneratedObject(
      actorUserId,
      workId,
      sourceAssetId,
    ));

    let admitted: AdmittedStudioWorkAssetPayload;
    try {
      admitted = admitStudioWorkAssetPayload(elementType, file.mimetype, file.buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "생성물 파일이 올바르지 않습니다.",
      );
    }
    const storage = await this.requirePrivateObjectStorage();
    const resolved = await this.resolveStorageObject(
      storage,
      purpose,
      admitted,
      workId,
      referenceId,
    );
    return this.run(() => this.repository.registerGeneratedStorageReference(
      actorUserId,
      {
        workId,
        sourceAssetId,
        referenceId,
        object: resolved.object,
      },
      resolved.uploaded,
    ));
  }

  async getSourceStorageReference(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType,
  ): Promise<StudioWorkAssetStorageReference> {
    const reference = await this.run(() => this.repository.getStorageReference(
      actorUserId,
      workId,
      assetId,
      "source",
      assetId,
      elementType,
    ));
    await this.requirePrivateObjectStorage();
    return reference;
  }

  async getGeneratedStorageReference(
    actorUserId: string,
    workId: string,
    sourceAssetId: string,
    purpose: StudioWorkAssetGeneratedObjectPurpose,
    referenceId: string,
  ): Promise<StudioWorkAssetStorageReference> {
    if (purpose !== "derived" && purpose !== "export") {
      throw new BadRequestException("원본 에셋은 생성물 경로에서 조회할 수 없습니다.");
    }
    const reference = await this.run(() => this.repository.getStorageReference(
      actorUserId,
      workId,
      sourceAssetId,
      purpose,
      referenceId,
    ));
    await this.requirePrivateObjectStorage();
    return reference;
  }

  async createSourceSignedReadUrl(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType,
    expiresInSeconds: number,
  ): Promise<StudioWorkAssetSignedRead> {
    assertShortSignedReadLifetime(expiresInSeconds);
    const reference = await this.run(() => this.repository.getStorageReference(
      actorUserId,
      workId,
      assetId,
      "source",
      assetId,
      elementType,
    ));
    return this.createSignedRead(reference, expiresInSeconds);
  }

  async createGeneratedSignedReadUrl(
    actorUserId: string,
    workId: string,
    sourceAssetId: string,
    purpose: StudioWorkAssetGeneratedObjectPurpose,
    referenceId: string,
    expiresInSeconds: number,
  ): Promise<StudioWorkAssetSignedRead> {
    if (purpose !== "derived" && purpose !== "export") {
      throw new BadRequestException("원본 에셋은 생성물 경로에서 조회할 수 없습니다.");
    }
    assertShortSignedReadLifetime(expiresInSeconds);
    const reference = await this.run(() => this.repository.getStorageReference(
      actorUserId,
      workId,
      sourceAssetId,
      purpose,
      referenceId,
    ));
    return this.createSignedRead(reference, expiresInSeconds);
  }

  async deleteGeneratedObject(
    actorUserId: string,
    workId: string,
    sourceAssetId: string,
    purpose: StudioWorkAssetGeneratedObjectPurpose,
    referenceId: string,
    expectedDigest: string,
  ): Promise<StudioWorkAssetGeneratedDeleteResult> {
    if (purpose !== "derived" && purpose !== "export") {
      throw new BadRequestException("원본 에셋은 삭제할 수 없습니다.");
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(expectedDigest)) {
      throw new BadRequestException("삭제할 생성물 digest가 올바르지 않습니다.");
    }
    // Do not transition the durable reference into `deleting` unless authorization and the
    // private-bucket invariant both hold. A remote failure afterwards intentionally leaves the
    // tokenized state fail-closed and retryable.
    await this.run(() => this.repository.assertCanStoreGeneratedObject(
      actorUserId,
      workId,
      sourceAssetId,
    ));
    const storage = await this.requirePrivateObjectStorage();
    const plan = await this.run(() => this.repository.beginGeneratedStorageReferenceDelete(
      actorUserId,
      { workId, sourceAssetId, purpose, referenceId, expectedDigest },
    ));
    if (!plan.remoteDeleteRequired) {
      return { deleted: true, remoteObjectDeleted: false };
    }
    if (!plan.deleteToken || plan.reference.object.purpose === "source") {
      throw new ConflictException("생성물 삭제 상태가 일치하지 않습니다.");
    }
    await this.storageCall(() => storage.deleteGeneratedObject({
      object: plan.reference.object,
    }));
    await this.run(() => this.repository.completeGeneratedStorageReferenceDelete(plan));
    return { deleted: true, remoteObjectDeleted: true };
  }

  /**
   * Drains generated/export references before a work row is removed. The repository returns a
   * deterministic bounded page and preserves `deleting` rows, so a request can resume after either
   * a provider timeout or a remote-success/database-acknowledgement split. The final work delete
   * still rechecks for references under the work-row lock to close the last admission race.
   */
  async deleteGeneratedObjectsForWork(
    actorUserId: string,
    workId: string,
    allowAdminOverride: boolean,
  ): Promise<number> {
    let deletedReferences = 0;
    let storage: SupabaseObjectStoragePort | undefined;
    while (true) {
      const references = await this.run(() =>
        this.repository.listGeneratedStorageReferencesForWorkDeletion(
          actorUserId,
          workId,
          allowAdminOverride,
        )
      );
      if (references.length === 0) return deletedReferences;
      storage ??= await this.requirePrivateObjectStorage();
      const privateStorage = storage;

      for (const reference of references) {
        const purpose = reference.object.purpose;
        if (purpose === "source") {
          throw new ConflictException("작품 삭제 정리 대상에 원본 에셋이 포함되었습니다.");
        }
        const plan = await this.run(() =>
          this.repository.beginGeneratedStorageReferenceDelete(
            actorUserId,
            {
              workId,
              sourceAssetId: reference.sourceAssetId,
              purpose,
              referenceId: reference.referenceId,
              expectedDigest: reference.object.digest,
            },
            allowAdminOverride,
          )
        );
        if (plan.remoteDeleteRequired) {
          if (!plan.deleteToken) {
            throw new ConflictException("생성물 삭제 상태가 일치하지 않습니다.");
          }
          await this.storageCall(() => privateStorage.deleteGeneratedObject({
            object: plan.reference.object,
          }));
          await this.run(() =>
            this.repository.completeGeneratedStorageReferenceDelete(plan)
          );
        }
        deletedReferences += 1;
      }
    }
  }

  getManifest(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType
  ): Promise<StudioWorkAssetManifest> {
    return this.run(() => this.repository.getManifest(actorUserId, workId, assetId, elementType));
  }

  getContent(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType
  ): Promise<StudioWorkAssetContent> {
    return this.run(async () => {
      const content = await this.repository.getContent(actorUserId, workId, assetId, elementType);
      const manifest = StudioWorkAssetManifestSchema.parse(content.manifest);
      const storedSha256 = createHash("sha256").update(content.payload).digest("hex");
      if (
        content.payload.byteLength !== manifest.byteSize ||
        storedSha256 !== manifest.sha256
      ) {
        throw new Error("stored studio work asset payload integrity mismatch");
      }
      return { manifest, payload: content.payload };
    });
  }

  deleteUnreferencedUpload(
    actorUserId: string,
    workId: string,
    assetId: string,
    elementType: StudioWorkAssetType,
    expectedSha256: string
  ): Promise<boolean> {
    return this.run(() => this.repository.deleteUnreferencedUpload(
      actorUserId,
      workId,
      assetId,
      elementType,
      expectedSha256
    ));
  }

  /**
   * Durable CRDT admission seam. References only contain immutable `(assetId, elementType)`
   * identities, so one authorized batch read is sufficient and avoids N per-reference work-access
   * queries on a collaboration append.
   */
  async assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioWorkAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    if (references.length > 0 && !isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 에셋 참조 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    if (references.length > STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK) {
      throw new BadRequestException("한 작품에서 활성화할 수 있는 에셋 참조가 너무 많습니다.");
    }
    const expectedById = new Map<string, StudioWorkAssetReference>();
    try {
      for (const value of references) {
        const reference = StudioWorkAssetReferenceSchema.parse(value);
        const existing = expectedById.get(reference.assetId);
        if (existing && existing.elementType !== reference.elementType) {
          throw new Error("같은 작품 에셋 ID가 서로 다른 타입을 가리킵니다.");
        }
        expectedById.set(reference.assetId, reference);
      }
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "작품 에셋 참조가 올바르지 않습니다."
      );
    }
    if (expectedById.size === 0) return;

    const assetIds = [...expectedById.keys()];
    const manifests = await this.run(() => transaction
      ? this.repository.getManifestsInTransaction(
          transaction,
          actorUserId,
          workId,
          assetIds
        )
      : this.repository.getManifests(actorUserId, workId, assetIds));
    const storedById = new Map(manifests.map((value) => {
      const stored = StudioWorkAssetManifestSchema.parse(value);
      return [stored.assetId, stored] as const;
    }));
    for (const reference of expectedById.values()) {
      const stored = storedById.get(reference.assetId);
      if (!stored || stored.elementType !== reference.elementType) {
        throw new BadRequestException("저장되지 않았거나 타입이 다른 작품 에셋 참조가 있습니다.");
      }
    }
  }

  /**
   * Stronger durable admission for renderer-significant R8 paper grain. The generic work-asset
   * identity check is insufficient because a canonical stroke also binds encoded and decoded
   * content. The exact at-rest PNG is read under the append transaction, decoded serially, and
   * accepted only when its alpha/luminance R8 bytes match the browser's deterministic hash.
   */
  async assertR8GrainReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly Readonly<StudioBrushR8TextureGrainSource>[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    if (references.length > 0 && !isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 R8 브러시 에셋 참조 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    if (references.length > STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK) {
      throw new BadRequestException("한 작품에서 활성화할 수 있는 R8 브러시 에셋이 너무 많습니다.");
    }

    const expectedById = new Map<
      string,
      Readonly<StudioBrushR8TextureGrainSource>
    >();
    try {
      for (const candidate of references) {
        const source = normalizeStudioBrushR8TextureGrainSource(candidate);
        if (!source) throw new Error("R8 브러시 에셋 참조가 올바르지 않습니다.");
        const existing = expectedById.get(source.asset.assetId);
        if (
          existing
          && serializeStudioBrushR8TextureGrainSourceCanonical(existing)
            !== serializeStudioBrushR8TextureGrainSourceCanonical(source)
        ) {
          throw new Error("같은 R8 브러시 에셋 ID가 서로 다른 콘텐츠를 가리킵니다.");
        }
        expectedById.set(source.asset.assetId, source);
      }
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "R8 브러시 에셋 참조가 올바르지 않습니다."
      );
    }
    if (expectedById.size === 0) return;

    const assetIds = [...expectedById.keys()];
    try {
      assertStudioR8GrainAdmissionSourceBudget([...expectedById.values()]);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "R8 브러시 에셋 검증 예산이 올바르지 않습니다."
      );
    }

    // Read only metadata first. A malicious set of otherwise-valid IDs cannot make the binary
    // query materialize more bytes than the aggregate source budget.
    const manifests = await this.run(() => transaction
      ? this.repository.getManifestsInTransaction(
          transaction,
          actorUserId,
          workId,
          assetIds
        )
      : this.repository.getManifests(actorUserId, workId, assetIds));
    try {
      const manifestById = new Map<string, StudioWorkAssetManifest>();
      for (const value of manifests) {
        const stored = StudioWorkAssetManifestSchema.parse(value);
        if (manifestById.has(stored.assetId)) {
          throw new Error("저장된 R8 브러시 에셋 조회 결과에 중복 ID가 있습니다.");
        }
        manifestById.set(stored.assetId, stored);
      }
      if (manifestById.size !== expectedById.size) {
        throw new Error("저장된 R8 브러시 에셋 조회 결과에 요청하지 않은 ID가 있습니다.");
      }
      for (const source of expectedById.values()) {
        const stored = manifestById.get(source.asset.assetId);
        if (!stored) throw new Error("저장되지 않은 R8 브러시 에셋 참조가 있습니다.");
        assertStudioR8GrainAdmissionManifest(source, stored);
      }
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : "저장되지 않았거나 콘텐츠가 다른 R8 브러시 에셋 참조가 있습니다."
      );
    }

    const contents = await this.run(() => transaction
      ? this.repository.getContentsInTransaction(
          transaction,
          actorUserId,
          workId,
          assetIds
        )
      : this.repository.getContents(actorUserId, workId, assetIds));
    try {
      const storedById = new Map<string, StudioWorkAssetContent>();
      for (const content of contents) {
        const manifest = StudioWorkAssetManifestSchema.parse(content.manifest);
        if (storedById.has(manifest.assetId)) {
          throw new Error("저장된 R8 브러시 에셋 조회 결과에 중복 ID가 있습니다.");
        }
        storedById.set(manifest.assetId, { manifest, payload: content.payload });
      }
      if (storedById.size !== expectedById.size) {
        throw new Error("저장된 R8 브러시 에셋 조회 결과에 요청하지 않은 ID가 있습니다.");
      }
      const admissionContents = [...expectedById.values()].map((source) => {
        const content = storedById.get(source.asset.assetId);
        if (!content) {
          throw new Error("저장되지 않은 R8 브러시 에셋 참조가 있습니다.");
        }
        return { source, content };
      });
      await assertStudioR8GrainAdmissionContents(admissionContents);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : "저장되지 않았거나 콘텐츠가 다른 R8 브러시 에셋 참조가 있습니다."
      );
    } finally {
      // The repository promises private copies. Scrub even schema/missing-row failures that occur
      // before the lower-level verifier takes ownership.
      for (const content of contents) content.payload.fill(0);
    }
  }

  private async resolveStorageObject(
    storage: SupabaseObjectStoragePort,
    purpose: SupabaseObjectPurpose,
    admitted: AdmittedStudioWorkAssetPayload,
    workId: string,
    referenceId: string,
  ): Promise<ResolvedStudioWorkAssetStorageObject> {
    const expected = storageObjectFor(purpose, admitted);
    const reusable = await this.run(() =>
      this.repository.findReusableStorageObject(expected)
    );
    if (reusable) {
      if (!isExactStudioWorkAssetStorageObject(reusable, expected)) {
        throw new ConflictException("저장된 오브젝트 메타데이터가 일치하지 않습니다.");
      }
      return { object: reusable, uploaded: false };
    }

    const uploaded = await this.storageCall(async () =>
      SupabaseObjectReferenceSchema.parse(await storage.uploadImmutable({
        purpose,
        contentType: admitted.mimeType,
        bytes: Uint8Array.from(admitted.payload),
        controlMetadata: {
          documentId: opaqueControlId("work", workId),
          operationId: opaqueControlId(`${purpose}-upload`, expected.digest),
          labels: {
            purpose,
            reference: opaqueControlId("ref", referenceId),
          },
        },
      }))
    );
    if (!isExactStudioWorkAssetStorageObject(uploaded, expected)) {
      throw new ServiceUnavailableException(
        "오브젝트 저장소가 업로드 무결성 확인을 통과하지 못했습니다.",
      );
    }
    return { object: uploaded, uploaded: true };
  }

  private async createSignedRead(
    reference: StudioWorkAssetStorageReference,
    expiresInSeconds: number,
  ): Promise<StudioWorkAssetSignedRead> {
    const storage = await this.requirePrivateObjectStorage();
    const signedRead = await this.storageCall(async () =>
      SupabaseSignedReadUrlSchema.parse(await storage.createSignedReadUrl({
        object: reference.object,
        expiresInSeconds,
      }))
    );
    const completedAt = Date.now();
    if (
      signedRead.expiresAtEpochMs <= completedAt
      || signedRead.expiresAtEpochMs > completedAt + expiresInSeconds * 1_000
    ) {
      throw new ServiceUnavailableException(
        "오브젝트 저장소가 안전한 만료 시간을 반환하지 않았습니다.",
      );
    }
    return { reference, signedRead };
  }

  private async requirePrivateObjectStorage(): Promise<SupabaseObjectStoragePort> {
    const storage = this.objectStorage;
    if (!storage) {
      throw new ServiceUnavailableException(
        "비공개 오브젝트 저장소가 구성되지 않았습니다.",
      );
    }
    const readiness = await this.storageCall(() => storage.verifyPrivatePurposeBuckets());
    if (readiness.ready !== true || readiness.privatePurposeBuckets !== 3) {
      throw new ServiceUnavailableException(
        "비공개 오브젝트 저장소 정책을 확인할 수 없습니다.",
      );
    }
    return storage;
  }

  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      // Provider URLs, bucket names, service-role material and response bodies stay inside the
      // infrastructure adapter. Creator routes expose one generic fail-closed boundary.
      throw new ServiceUnavailableException(
        "비공개 오브젝트 저장소 요청을 완료할 수 없습니다.",
      );
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      if (result && typeof result === "object" && Object.hasOwn(result, "assetId")) {
        return StudioWorkAssetManifestSchema.parse(result) as T;
      }
      return result;
    } catch (error) {
      if (error instanceof StudioWorkAssetNotFoundError) {
        throw new NotFoundException("작품 에셋을 찾을 수 없습니다.");
      }
      if (error instanceof StudioWorkAssetForbiddenError) {
        throw new ForbiddenException(
          error.operation === "edit"
            ? "이 작품의 에셋을 변경할 권한이 없습니다."
            : "이 작품의 에셋을 볼 권한이 없습니다."
        );
      }
      if (error instanceof StudioWorkAssetCleanupOwnershipError) {
        throw new ForbiddenException("직접 업로드한 미사용 작품 에셋만 정리할 수 있습니다.");
      }
      if (error instanceof StudioWorkAssetReferencedError) {
        throw new ConflictException(
          "이미 팀 문서에 기록된 작품 에셋은 자동 정리할 수 없습니다."
        );
      }
      if (error instanceof StudioWorkAssetStorageReferenceNotFoundError) {
        throw new NotFoundException("작품 에셋 오브젝트 참조를 찾을 수 없습니다.");
      }
      if (error instanceof StudioWorkAssetStorageReferenceConflictError) {
        throw new ConflictException("작품 에셋 오브젝트 참조 상태가 일치하지 않습니다.");
      }
      if (error instanceof StudioWorkAssetTypeConflictError) {
        throw new ConflictException("같은 ID의 다른 타입 에셋이 이미 존재합니다.");
      }
      if (error instanceof StudioWorkAssetImmutableConflictError) {
        throw new ConflictException("이미 동기화된 에셋 ID는 변경할 수 없습니다. 새 ID로 추가해 주세요.");
      }
      if (error instanceof StudioWorkAssetQuotaError) {
        throw new PayloadTooLargeException(
          error.quota === "count"
            ? "작품에 연결할 수 있는 에셋 수를 초과했습니다."
            : error.quota === "bytes"
              ? "작품 에셋의 전체 저장 용량을 초과했습니다."
              : "이 작품에서 삭제할 수 있는 에셋 ID 수를 초과했습니다. 작품을 복제해 정리해 주세요."
        );
      }
      throw error;
    }
  }
}
