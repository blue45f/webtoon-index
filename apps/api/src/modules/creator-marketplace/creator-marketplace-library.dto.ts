import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE,
  ConfirmCreatorMarketplaceStudioInstallSchema,
  CreatorMarketplaceCloudLibraryViewSchema,
  CreatorMarketplaceLogicalPackIdSchema,
  SetCreatorMarketplaceLibraryArchiveSchema,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";

export const CreatorMarketplaceLibraryListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(
      CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE,
    ).default(CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE),
    cursor: z.preprocess(
      (value) => typeof value === "string" && value.trim().length === 0
        ? undefined
        : value ?? undefined,
      z.string()
        .min(1)
        .max(CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS)
        .regex(/^[A-Za-z0-9_-]+$/u)
        .optional(),
    ),
    view: CreatorMarketplaceCloudLibraryViewSchema.default("active"),
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema.optional(),
  })
  .strict();

export const CreatorMarketplaceLibraryIdParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export class CreatorMarketplaceLibraryListQueryDto extends createZodDto(
  CreatorMarketplaceLibraryListQuerySchema,
) {}

export class CreatorMarketplaceLibraryIdParamsDto extends createZodDto(
  CreatorMarketplaceLibraryIdParamsSchema,
) {}

export class ConfirmCreatorMarketplaceStudioInstallDto extends createZodDto(
  ConfirmCreatorMarketplaceStudioInstallSchema,
) {}

export class SetCreatorMarketplaceLibraryArchiveDto extends createZodDto(
  SetCreatorMarketplaceLibraryArchiveSchema,
) {}
