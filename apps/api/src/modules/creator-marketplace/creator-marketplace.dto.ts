import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE,
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL,
  CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE,
  CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS,
  CreatorMarketplaceResourceModerationActionSchema,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourceLicenseSchema,
  CreatorMarketplaceResourceManifestSchema,
  CreatorMarketplaceResourcePackageIdSchema,
  CreatorMarketplaceResourcePublisherQuerySchema,
  CreatorMarketplaceResourceReportReasonSchema,
  CreatorMarketplaceResourceReportStatusSchema,
  CreatorMarketplaceResourceSearchQuerySchema,
  CreatorMarketplaceResourceSortSchema,
  CreatorMarketplaceResourceTagQuerySchema,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

export const CreatorMarketplaceResourceListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE)
      .default(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    cursor: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim().length === 0
            ? undefined
            : value ?? undefined,
        z
          .string()
          .min(1)
          .max(CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS)
          .regex(/^[A-Za-z0-9_-]+$/u)
          .optional()
      ),
    search: CreatorMarketplaceResourceSearchQuerySchema.optional(),
    tag: CreatorMarketplaceResourceTagQuerySchema.optional(),
    kind: CreatorMarketplaceResourceKindSchema.optional(),
    license: CreatorMarketplaceResourceLicenseSchema.optional(),
    // 공개 카탈로그의 배급자 필터. viewer-agnostic URL 상태라 엣지 캐시와 충돌하지 않는다.
    publisher: CreatorMarketplaceResourcePublisherQuerySchema.optional(),
    sort: CreatorMarketplaceResourceSortSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.sort === "relevance" && !query.search) {
      context.addIssue({
        code: "custom",
        path: ["sort"],
        message: "관련도순 정렬에는 검색어가 필요합니다.",
      });
    }
  });

export const CreatorMarketplaceResourceParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const CreatorMarketplaceResourceHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE)
      .default(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    cursor: z.coerce
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL)
      .optional(),
  })
  .strict();

export const CreatorMarketplaceOwnedHistoryQuerySchema =
  CreatorMarketplaceResourceHistoryQuerySchema.extend({
    packageId: CreatorMarketplaceResourcePackageIdSchema,
  }).strict();

export const ReportCreatorMarketplaceResourceSchema = z
  .object({
    reason: CreatorMarketplaceResourceReportReasonSchema,
    details: z
      .string()
      .trim()
      .max(CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS)
      .default(""),
  })
  .strict();

export const CreatorMarketplaceModerationQuerySchema = z
  .object({
    status: CreatorMarketplaceResourceReportStatusSchema.default("open"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE)
      .default(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export const ModerateCreatorMarketplaceResourceSchema = z
  .object({
    action: CreatorMarketplaceResourceModerationActionSchema,
    // Optional for direct administrative actions. Queue-driven clients should send the initiating
    // report so the append-only package decision retains provenance after bulk resolution.
    sourceReportId: z.string().uuid().optional(),
    note: z
      .string()
      .trim()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS),
  })
  .strict();

export const DismissCreatorMarketplaceOrphanReportSchema = z
  .object({
    action: z.literal("dismiss"),
    note: z
      .string()
      .trim()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS),
  })
  .strict();

export class PublishCreatorMarketplaceResourceDto extends createZodDto(
  CreatorMarketplaceResourceManifestSchema
) {}
export class CreatorMarketplaceResourceListQueryDto extends createZodDto(
  CreatorMarketplaceResourceListQuerySchema
) {}
export class CreatorMarketplaceResourceParamsDto extends createZodDto(
  CreatorMarketplaceResourceParamsSchema
) {}
export class CreatorMarketplaceResourceHistoryQueryDto extends createZodDto(
  CreatorMarketplaceResourceHistoryQuerySchema
) {}
export class CreatorMarketplaceOwnedHistoryQueryDto extends createZodDto(
  CreatorMarketplaceOwnedHistoryQuerySchema
) {}
export class ReportCreatorMarketplaceResourceDto extends createZodDto(
  ReportCreatorMarketplaceResourceSchema
) {}
export class CreatorMarketplaceModerationQueryDto extends createZodDto(
  CreatorMarketplaceModerationQuerySchema
) {}
export class ModerateCreatorMarketplaceResourceDto extends createZodDto(
  ModerateCreatorMarketplaceResourceSchema
) {}
export class DismissCreatorMarketplaceOrphanReportDto extends createZodDto(
  DismissCreatorMarketplaceOrphanReportSchema
) {}
