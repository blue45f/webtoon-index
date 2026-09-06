import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  CreateCreatorMarketplaceSocialCommentSchema,
  UpsertCreatorMarketplaceSocialReviewSchema,
} from "../../../../web/src/shared/lib/creator-marketplace-social-contract";

export const CreatorMarketplaceSocialResourceParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const CreatorMarketplaceSocialCommentParamsSchema = z
  .object({
    id: z.string().uuid(),
    commentId: z.string().uuid(),
  })
  .strict();

export const CreatorMarketplaceSocialReviewParamsSchema = z
  .object({
    id: z.string().uuid(),
    reviewId: z.string().uuid(),
  })
  .strict();

export class CreatorMarketplaceSocialResourceParamsDto extends createZodDto(
  CreatorMarketplaceSocialResourceParamsSchema,
) {}

export class CreatorMarketplaceSocialCommentParamsDto extends createZodDto(
  CreatorMarketplaceSocialCommentParamsSchema,
) {}

export class CreatorMarketplaceSocialReviewParamsDto extends createZodDto(
  CreatorMarketplaceSocialReviewParamsSchema,
) {}

export class CreateCreatorMarketplaceSocialCommentDto extends createZodDto(
  CreateCreatorMarketplaceSocialCommentSchema,
) {}

export class UpsertCreatorMarketplaceSocialReviewDto extends createZodDto(
  UpsertCreatorMarketplaceSocialReviewSchema,
) {}
