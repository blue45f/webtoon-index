import { z } from "zod";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_MAX_ASSET_BYTES,
  STUDIO_RASTER_MAX_TILE_SIZE,
  assertStudioRasterAssetReference,
} from "./studio-crdt-raster-ops";

import type {
  StudioRasterAssetReference,
} from "./studio-crdt-raster-ops";

export {
  STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN,
  isStudioRasterAssetAdmissionOptedIn,
} from "./studio-raster-asset-admission";

export const STUDIO_RASTER_ASSET_CONTRACT_VERSION = STUDIO_RASTER_CRDT_VERSION;
export const STUDIO_RASTER_ASSET_MAX_BYTES = STUDIO_RASTER_MAX_ASSET_BYTES;
export const STUDIO_RASTER_ASSET_MAX_AXIS = STUDIO_RASTER_MAX_TILE_SIZE;
export const STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK = 250_000;
export const STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK = 2 * 1_024 * 1_024 * 1_024;
export const STUDIO_RASTER_ASSET_MEDIA_TYPE = "image/png" as const;
export type StudioRasterStorageMediaType = typeof STUDIO_RASTER_ASSET_MEDIA_TYPE;

export const STUDIO_RASTER_ASSET_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const StudioRasterAssetIdSchema = z
  .string()
  .regex(STUDIO_RASTER_ASSET_SHA256_PATTERN, "소문자 SHA-256 래스터 자산 ID가 필요합니다.");

export const StudioRasterAssetMediaTypeSchema = z.literal(STUDIO_RASTER_ASSET_MEDIA_TYPE);

const StudioRasterAssetReferenceShape = {
  scope: z.literal("work"),
  assetId: StudioRasterAssetIdSchema,
  sha256: z.string().regex(STUDIO_RASTER_ASSET_SHA256_PATTERN),
  byteLength: z.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_BYTES),
  mediaType: StudioRasterAssetMediaTypeSchema,
  width: z.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_AXIS),
  height: z.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_AXIS),
} as const;

function requireContentAddress(
  value: { assetId: string; sha256: string },
  context: z.RefinementCtx
): void {
  if (value.assetId !== value.sha256) {
    context.addIssue({
      code: "custom",
      path: ["assetId"],
      message: "래스터 자산 ID는 내용의 SHA-256과 정확히 같아야 합니다.",
    });
  }
}

export const StudioRasterStoredReferenceSchema = z
  .object(StudioRasterAssetReferenceShape)
  .strict()
  .superRefine(requireContentAddress);

export const StudioRasterAssetManifestSchema = z
  .object({
    version: z.literal(STUDIO_RASTER_ASSET_CONTRACT_VERSION),
    ...StudioRasterAssetReferenceShape,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine(requireContentAddress);

export type StudioRasterAssetManifest = z.infer<typeof StudioRasterAssetManifestSchema>;
export type StudioRasterStoredReference = z.infer<typeof StudioRasterStoredReferenceSchema>;

export function parseStudioRasterStoredReference(value: unknown): StudioRasterAssetReference {
  const parsed = StudioRasterStoredReferenceSchema.parse(value);
  // Keep this explicit cross-contract assertion so storage cannot silently diverge from replay.
  assertStudioRasterAssetReference(parsed);
  return parsed;
}

export function studioRasterAssetReferenceFromManifest(
  manifest: StudioRasterAssetManifest
): StudioRasterAssetReference {
  return parseStudioRasterStoredReference({
    scope: manifest.scope,
    assetId: manifest.assetId,
    sha256: manifest.sha256,
    byteLength: manifest.byteLength,
    mediaType: manifest.mediaType,
    width: manifest.width,
    height: manifest.height,
  });
}

export function isStudioRasterAssetReferenceStoredExactly(
  manifest: StudioRasterAssetManifest,
  reference: StudioRasterAssetReference
): boolean {
  try {
    const parsedManifest = StudioRasterAssetManifestSchema.parse(manifest);
    const parsedReference = parseStudioRasterStoredReference(reference);
    return (
      parsedManifest.assetId === parsedReference.assetId &&
      parsedManifest.sha256 === parsedReference.sha256 &&
      parsedManifest.byteLength === parsedReference.byteLength &&
      parsedManifest.mediaType === parsedReference.mediaType &&
      parsedManifest.width === parsedReference.width &&
      parsedManifest.height === parsedReference.height
    );
  } catch {
    return false;
  }
}

export function studioRasterAssetContentPath(input: {
  workId: string;
  assetId: string;
}): string {
  return `/api/creator/works/${encodeURIComponent(input.workId)}/raster-assets/${input.assetId}/content`;
}

export function isStudioRasterAssetMediaType(
  value: string
): value is StudioRasterStorageMediaType {
  return value === STUDIO_RASTER_ASSET_MEDIA_TYPE;
}
