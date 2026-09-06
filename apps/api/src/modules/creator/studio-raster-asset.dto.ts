import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  STUDIO_RASTER_ASSET_MAX_AXIS,
  STUDIO_RASTER_ASSET_MAX_BYTES,
  StudioRasterAssetIdSchema,
  StudioRasterAssetMediaTypeSchema,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";

export const StudioRasterAssetParamsSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    assetId: StudioRasterAssetIdSchema,
  })
  .strict();

export class StudioRasterAssetParamsDto extends createZodDto(
  StudioRasterAssetParamsSchema
) {}

export const DeleteStudioRasterAssetQuerySchema = z
  .object({
    expectedSha256: StudioRasterAssetIdSchema,
    mediaType: StudioRasterAssetMediaTypeSchema,
    byteLength: z.coerce.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_BYTES),
    width: z.coerce.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_AXIS),
    height: z.coerce.number().int().min(1).max(STUDIO_RASTER_ASSET_MAX_AXIS),
  })
  .strict();

export class DeleteStudioRasterAssetQueryDto extends createZodDto(
  DeleteStudioRasterAssetQuerySchema
) {}
