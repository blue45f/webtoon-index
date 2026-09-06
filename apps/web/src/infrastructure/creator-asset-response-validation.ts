import {
  inspectStrictJpegDimensions,
  inspectStrictStaticWebpDimensions,
} from "@/shared/lib/strict-raster-image-inspector";

const CONTENT_MAX_BYTES = 2_250_000;
const CONTENT_MAX_DIMENSION = 4096;
const CONTENT_MAX_PIXELS = 16_777_216;
const PREVIEW_MAX_BYTES = 128 * 1024;
const PREVIEW_MAX_DIMENSION = 320;
const VRM_FRAGMENT_MAX_ENCODED_CHARS = 256 * 1024;
const VRM_FRAGMENT_MAX_DECODED_BYTES = 192 * 1024;
const VRM_FRAGMENT_MAX_DEPTH = 32;
const VRM_FRAGMENT_MAX_NODES = 20_000;
const ASSET_LICENSES = new Set([
  "toonspectrum-standard",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-nc-4.0",
]);
const ASSET_MODERATION_STATUSES = new Set(["published", "under_review", "rejected"]);

type AssetKind = "image" | "sticker" | "vrm_pose";
type AssetMime = "image/png" | "image/jpeg" | "image/webp";

interface InspectedDataUrl {
  mimeType: AssetMime;
  byteSize: number;
  bytes: Uint8Array;
  width: number;
  height: number;
  metadataJson: string | null;
}

export interface ValidatedSharedAssetContent {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  kind: AssetKind;
  mimeType: AssetMime;
  byteSize: number;
  contentHash: string;
}

function invalid(): never {
  throw new Error("공유 에셋 응답이 올바르지 않습니다.");
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    signature.some((value, index) => bytes[index] !== value) ||
    ascii(bytes, 12, 16) !== "IHDR"
  ) return null;
  return { width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) };
}

function strictCompressedDimensions(
  mimeType: "image/jpeg" | "image/webp",
  bytes: Uint8Array,
): { width: number; height: number } | null {
  try {
    return mimeType === "image/jpeg"
      ? inspectStrictJpegDimensions(bytes)
      : inspectStrictStaticWebpDimensions(bytes);
  } catch {
    return null;
  }
}

function decodeStrictBase64(encoded: string): Uint8Array {
  if (encoded.length < 4 || encoded.length % 4 === 1) invalid();
  const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    invalid();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assertBoundedMetadata(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if ((value as { tool?: unknown }).tool !== "vrm-poser") invalid();
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    nodes += 1;
    if (nodes > VRM_FRAGMENT_MAX_NODES || entry.depth > VRM_FRAGMENT_MAX_DEPTH) invalid();
    if (!entry.value || typeof entry.value !== "object") continue;
    const children = Array.isArray(entry.value)
      ? entry.value
      : Object.values(entry.value as Record<string, unknown>);
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
}

function parseVrmMetadata(fragment: string): string {
  if (fragment.length < 1 || fragment.length > VRM_FRAGMENT_MAX_ENCODED_CHARS || fragment.includes("#")) invalid();
  let decoded: string;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    invalid();
  }
  if (new TextEncoder().encode(decoded).byteLength > VRM_FRAGMENT_MAX_DECODED_BYTES) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    invalid();
  }
  assertBoundedMetadata(parsed);
  const canonical = JSON.stringify(parsed);
  if (new TextEncoder().encode(canonical).byteLength > VRM_FRAGMENT_MAX_DECODED_BYTES) invalid();
  return canonical;
}

function inspectDataUrl(input: {
  value: unknown;
  kind: AssetKind;
  expectedWidth: number;
  expectedHeight: number;
  maxBytes: number;
  maxDimension: number;
  maxPixels: number;
}): InspectedDataUrl {
  if (typeof input.value !== "string") invalid();
  const hashIndex = input.value.indexOf("#");
  const baseDataUrl = hashIndex === -1 ? input.value : input.value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? null : input.value.slice(hashIndex + 1);
  if (fragment !== null && input.kind !== "vrm_pose") invalid();
  const metadataJson = fragment === null ? null : parseVrmMetadata(fragment);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(baseDataUrl);
  if (!match) invalid();
  const mimeType = match[1] as AssetMime;
  const bytes = decodeStrictBase64(match[2]!);
  if (bytes.length < 24 || bytes.length > input.maxBytes) invalid();
  const dimensions = mimeType === "image/png"
    ? readPngDimensions(bytes)
    : strictCompressedDimensions(mimeType, bytes);
  if (
    !dimensions ||
    dimensions.width !== input.expectedWidth ||
    dimensions.height !== input.expectedHeight ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > input.maxDimension ||
    dimensions.height > input.maxDimension ||
    dimensions.width * dimensions.height > input.maxPixels
  ) invalid();
  return {
    mimeType,
    byteSize: bytes.length,
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    metadataJson,
  };
}

function isAssetKind(value: unknown): value is AssetKind {
  return value === "image" || value === "sticker" || value === "vrm_pose";
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) invalid();
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateSharedAssetContentResponse(
  value: unknown,
  expectedId: string
): Promise<ValidatedSharedAssetContent> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const candidate = value as Record<string, unknown>;
  if (
    candidate.id !== expectedId ||
    typeof candidate.width !== "number" ||
    !Number.isInteger(candidate.width) ||
    typeof candidate.height !== "number" ||
    !Number.isInteger(candidate.height) ||
    !isAssetKind(candidate.kind) ||
    typeof candidate.mimeType !== "string" ||
    typeof candidate.byteSize !== "number" ||
    !Number.isInteger(candidate.byteSize) ||
    typeof candidate.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(candidate.contentHash)
  ) invalid();
  const inspected = inspectDataUrl({
    value: candidate.dataUrl,
    kind: candidate.kind,
    expectedWidth: candidate.width,
    expectedHeight: candidate.height,
    maxBytes: CONTENT_MAX_BYTES,
    maxDimension: CONTENT_MAX_DIMENSION,
    maxPixels: CONTENT_MAX_PIXELS,
  });
  if (candidate.mimeType !== inspected.mimeType || candidate.byteSize !== inspected.byteSize) invalid();
  const baseHash = await sha256Hex(inspected.bytes);
  const computedHash = inspected.metadataJson === null
    ? baseHash
    : await sha256Hex(new TextEncoder().encode(`${baseHash}\0${inspected.metadataJson}`));
  if (computedHash !== candidate.contentHash) invalid();
  return candidate as unknown as ValidatedSharedAssetContent;
}

export function validateSharedAssetCatalogItem<T extends Record<string, unknown>>(value: T): T | null {
  try {
    const author = value.author as Record<string, unknown> | null;
    if (
      typeof value.id !== "string" ||
      value.id.length < 1 ||
      value.id.length > 200 ||
      typeof value.name !== "string" ||
      value.name.trim().length < 1 ||
      value.name.length > 60 ||
      typeof value.description !== "string" ||
      !Array.isArray(value.tags) ||
      value.tags.length > 20 ||
      value.tags.some((tag) => typeof tag !== "string" || tag.length > 80) ||
      typeof value.width !== "number" ||
      !Number.isInteger(value.width) ||
      value.width < 1 ||
      value.width > CONTENT_MAX_DIMENSION ||
      typeof value.height !== "number" ||
      !Number.isInteger(value.height) ||
      value.height < 1 ||
      value.height > CONTENT_MAX_DIMENSION ||
      value.width * value.height > CONTENT_MAX_PIXELS ||
      !isAssetKind(value.kind) ||
      typeof value.previewWidth !== "number" ||
      !Number.isInteger(value.previewWidth) ||
      typeof value.previewHeight !== "number" ||
      !Number.isInteger(value.previewHeight) ||
      typeof value.previewAvailable !== "boolean" ||
      typeof value.downloads !== "number" ||
      !Number.isInteger(value.downloads) ||
      value.downloads < 0 ||
      typeof value.reportCount !== "number" ||
      !Number.isInteger(value.reportCount) ||
      value.reportCount < 0 ||
      typeof value.license !== "string" ||
      !ASSET_LICENSES.has(value.license) ||
      typeof value.licenseLabel !== "string" ||
      value.licenseLabel.length < 1 ||
      (value.licenseUrl !== null && (
        typeof value.licenseUrl !== "string" ||
        !value.licenseUrl.startsWith("https://")
      )) ||
      typeof value.attributionRequired !== "boolean" ||
      typeof value.commercialUse !== "boolean" ||
      typeof value.attributionText !== "string" ||
      typeof value.containsAi !== "boolean" ||
      typeof value.moderationStatus !== "string" ||
      !ASSET_MODERATION_STATUSES.has(value.moderationStatus) ||
      typeof value.isOwner !== "boolean" ||
      typeof value.createdAt !== "string" ||
      value.createdAt.length > 40 ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !author ||
      typeof author.id !== "string" ||
      author.id.length < 1 ||
      typeof author.name !== "string" ||
      author.name.trim().length < 1 ||
      author.name.length > 100 ||
      typeof author.avatar !== "string" ||
      author.avatar.length > 2048
    ) return null;
    inspectDataUrl({
      value: value.previewDataUrl,
      kind: "image",
      expectedWidth: value.previewWidth,
      expectedHeight: value.previewHeight,
      maxBytes: PREVIEW_MAX_BYTES,
      maxDimension: PREVIEW_MAX_DIMENSION,
      maxPixels: PREVIEW_MAX_DIMENSION * PREVIEW_MAX_DIMENSION,
    });
    if (value.previewAvailable) {
      const previewAspect = value.previewWidth / value.previewHeight;
      const contentAspect = value.width / value.height;
      const aspectError = Math.abs(previewAspect - contentAspect) / Math.max(previewAspect, contentAspect);
      if (!Number.isFinite(aspectError) || aspectError > 0.03) return null;
    }
    return value;
  } catch {
    return null;
  }
}
