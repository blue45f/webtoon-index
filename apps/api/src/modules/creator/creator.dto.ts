import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
  CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE,
  CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS,
} from "../../../../web/src/shared/lib/creator-asset-contract";

import {
  CREATOR_DRAFT_COLLABORATION_FINAL_STATUSES,
  CREATOR_DRAFT_COLLABORATION_PROVISION_INTENTS,
} from "./creator-draft-collaboration.contract";

const CreatorReferenceIdSchema = z.string().trim().min(1).max(160).nullable();
const CreatorWorkRevisionSchema = z.number().int().min(1).max(2_147_483_647);
const CreatorCrdtServerSequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/)
  .refine((value) => {
    try {
      return BigInt(value) <= BigInt("9223372036854775807");
    } catch {
      return false;
    }
  }, {
    message: "CRDT server sequence must fit a nonnegative PostgreSQL bigint",
  });
const CreatorCollaborationUserIdSchema = z.string().trim().min(1).max(160);
const CreatorCollaborationRoleSchema = z.enum(["admin", "editor", "commenter", "viewer"]);
const CreatorCollaborationViewerRoleSchema = z.enum([
  "owner",
  "admin",
  "editor",
  "commenter",
  "viewer",
]);
const CreatorCollaborationInvitationIdSchema = z.string().uuid();
const CreatorIsoDateTimeSchema = z.iso.datetime({ offset: true });
const CreatorSharedWorksCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

const CreatorWorkMutableFieldsSchema = z.object({
  title: z.string().max(120),
  description: z.string().max(2_000),
  tags: z.array(z.string().max(24)).max(8),
  format: z.enum(["cuttoon", "upload"]),
  titleId: CreatorReferenceIdSchema,
  cover: z.string(),
  pages: z.array(z.string()).max(200),
  doc: z.record(z.string(), z.unknown()),
  status: z.enum(["draft", "published"]),
  seriesId: CreatorReferenceIdSchema,
  challengeId: CreatorReferenceIdSchema,
  remixFromId: CreatorReferenceIdSchema,
});

export const CreateCreatorWorkSchema = CreatorWorkMutableFieldsSchema.partial()
  .extend({ title: CreatorWorkMutableFieldsSchema.shape.title })
  .strict();

const updateFields = CreatorWorkMutableFieldsSchema.omit({ remixFromId: true }).partial();
const updateFieldNames = Object.keys(updateFields.shape);

export const UpdateCreatorWorkSchema = updateFields
  .extend({ baseRevision: CreatorWorkRevisionSchema.optional() })
  .strict()
  .superRefine((value, context) => {
    if (!updateFieldNames.some((field) => Object.hasOwn(value, field))) {
      context.addIssue({
        code: "custom",
        message: "수정할 작품 필드를 하나 이상 보내 주세요.",
      });
    }
  });

const CreatorSharedDocumentMutableFieldsSchema = CreatorWorkMutableFieldsSchema.omit({
  seriesId: true,
  challengeId: true,
  remixFromId: true,
  format: true,
}).extend({
  // 공동 편집 저장은 creator.ts의 clamp/빈 제목 검증을 우회하므로 DTO 경계에서 같은 불변식을 지킨다.
  title: z.string().trim().min(1).max(120),
});
const creatorSharedDocumentFieldNames = Object.keys(
  CreatorSharedDocumentMutableFieldsSchema.shape
);

/**
 * 공동 편집자는 작품 콘텐츠만 저장한다. 시리즈/챌린지 연결과 리믹스 원본은 소유자 전용
 * 기존 플로우에 남겨, 다른 사용자의 연재 관계를 우회 변경하지 못하게 한다.
 */
export const UpdateCreatorSharedDocumentSchema = CreatorSharedDocumentMutableFieldsSchema.partial()
  .extend({
    baseRevision: CreatorWorkRevisionSchema,
    crdtServerSequence: CreatorCrdtServerSequenceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!creatorSharedDocumentFieldNames.some((field) => Object.hasOwn(value, field))) {
      context.addIssue({
        code: "custom",
        message: "저장할 공동 문서 필드를 하나 이상 보내 주세요.",
      });
    }
  });

export const CreatorSharedWorkCapabilitiesSchema = z
  .object({
    view: z.boolean(),
    comment: z.boolean(),
    edit: z.boolean(),
    manageMembers: z.boolean(),
  })
  .strict();

export const CreatorSharedWorkSchema = z
  .object({
    workId: CreatorCollaborationUserIdSchema,
    title: z.string().max(120),
    format: z.enum(["cuttoon", "upload"]),
    role: CreatorCollaborationViewerRoleSchema,
    status: z.literal("active"),
    capabilities: CreatorSharedWorkCapabilitiesSchema,
    owner: z.object({ name: z.string().min(1) }).strict(),
    updatedAt: CreatorIsoDateTimeSchema,
  })
  .strict();

export const CreatorSharedWorksResponseSchema = z
  .object({
    items: z.array(CreatorSharedWorkSchema).max(50),
    nextCursor: CreatorSharedWorksCursorSchema.nullable(),
  })
  .strict();

export const CreatorSharedDocumentContentSchema = CreatorWorkMutableFieldsSchema.extend({
  episodeNo: z.number().int().min(1).nullable(),
}).strict();

export const CreatorSharedDocumentResponseSchema = z
  .object({
    workId: CreatorCollaborationUserIdSchema,
    role: CreatorCollaborationViewerRoleSchema,
    status: z.literal("active"),
    capabilities: z.object({ view: z.literal(true), edit: z.boolean() }).strict(),
    revision: CreatorWorkRevisionSchema,
    crdtServerSequence: CreatorCrdtServerSequenceSchema,
    updatedAt: CreatorIsoDateTimeSchema,
    document: CreatorSharedDocumentContentSchema,
  })
  .strict();

export const CreatorSharedDocumentMetaResponseSchema = CreatorSharedDocumentResponseSchema.omit({
  document: true,
}).strict();

export const CreatorSharedDocumentSaveResponseSchema = z
  .object({
    workId: CreatorCollaborationUserIdSchema,
    revision: CreatorWorkRevisionSchema,
    updatedAt: CreatorIsoDateTimeSchema,
  })
  .strict();

/**
 * Owner-only revision comparison contract. Rendered cover/pages are intentionally absent so large
 * data URLs cannot be returned by this endpoint even if the persisted revision snapshot has them.
 */
export const CreatorWorkRevisionComparisonSnapshotSchema = CreatorWorkMutableFieldsSchema.omit({
  cover: true,
  pages: true,
})
  .extend({ episodeNo: z.number().int().min(1).max(2_147_483_647).nullable() })
  .strict();

export const CreatorWorkRevisionComparisonResponseSchema = z
  .object({
    revision: CreatorWorkRevisionSchema,
    restoredFromRevision: CreatorWorkRevisionSchema.nullable(),
    createdAt: CreatorIsoDateTimeSchema,
    snapshot: CreatorWorkRevisionComparisonSnapshotSchema,
  })
  .strict();

export const CreatorWorkRevisionParamsSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    revision: z.coerce.number().int().min(1).max(2_147_483_647),
  })
  .strict();

export const CreatorWorkRevisionListParamsSchema = z
  .object({ id: z.string().trim().min(1).max(160) })
  .strict();

export const CreatorWorkRevisionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(20),
    path: z.unknown().optional(),
  })
  .strict();

export const CreatorTeamListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    path: z.unknown().optional(),
  })
  .strict();

export const CreatorSharedWorksListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z
      .preprocess(
        (val) => (typeof val === "string" && !val.trim() ? undefined : val ?? undefined),
        CreatorSharedWorksCursorSchema.optional()
      ),
    path: z.unknown().optional(),
  });

export const RestoreCreatorWorkRevisionSchema = z
  .object({ baseRevision: CreatorWorkRevisionSchema })
  .strict();

export const CreatorTeamWorkParamsSchema = z
  .object({ id: CreatorCollaborationUserIdSchema })
  .strict();

export const CreatorTeamMemberParamsSchema = CreatorTeamWorkParamsSchema.extend({
  userId: CreatorCollaborationUserIdSchema,
}).strict();

export const InviteCreatorTeamMemberSchema = z
  .object({
    userId: CreatorCollaborationUserIdSchema,
    role: CreatorCollaborationRoleSchema,
  })
  .strict();

export const UpdateCreatorTeamMemberSchema = InviteCreatorTeamMemberSchema.pick({ role: true }).strict();

export const RespondCreatorTeamInvitationSchema = z
  .object({
    action: z.enum(["accept", "decline"]),
    invitationId: CreatorCollaborationInvitationIdSchema,
  })
  .strict();

const CreatorDraftCollaborationDraftIdSchema = z
  .string()
  .regex(
    /^draft_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
const CreatorDraftCollaborationRoomIdSchema = z
  .string()
  .regex(
    /^draft-room_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
const CreatorDraftCollaborationMutationIdSchema = z.string().uuid();
const CreatorDraftCollaborationGraphRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647);
const CreatorDraftCollaborationProvisionIntentSchema = z.enum(
  CREATOR_DRAFT_COLLABORATION_PROVISION_INTENTS
);

export const ProvisionCreatorDraftCollaborationRoomSchema = z
  .object({
    draftDocumentId: CreatorDraftCollaborationDraftIdSchema,
    ownerScopeKey: CreatorCollaborationUserIdSchema,
    intent: CreatorDraftCollaborationProvisionIntentSchema,
    clientMutationId: CreatorDraftCollaborationMutationIdSchema,
    initialSnapshotByteLength: z.number().int().min(0).max(16 * 1_024 * 1_024),
  })
  .strict();

export const CreatorDraftCollaborationRoomParamsSchema = z
  .object({ roomId: CreatorDraftCollaborationRoomIdSchema })
  .strict();

export const PromoteCreatorDraftCollaborationRoomSchema = z
  .object({
    draftDocumentId: CreatorDraftCollaborationDraftIdSchema,
    ownerScopeKey: CreatorCollaborationUserIdSchema,
    targetWorkId: CreatorCollaborationUserIdSchema,
    expectedGraphRevision: CreatorDraftCollaborationGraphRevisionSchema,
    expectedWorkRevision: CreatorWorkRevisionSchema,
    finalStatus: z.enum(CREATOR_DRAFT_COLLABORATION_FINAL_STATUSES),
    clientMutationId: CreatorDraftCollaborationMutationIdSchema,
  })
  .strict();

export const CreatorDraftCollaborationRoomResponseSchema = z
  .object({
    version: z.literal(1),
    roomId: CreatorDraftCollaborationRoomIdSchema,
    draftDocumentId: CreatorDraftCollaborationDraftIdSchema,
    provisionalWorkId: CreatorCollaborationUserIdSchema,
    ownerScopeKey: CreatorCollaborationUserIdSchema,
    status: z.enum(["active", "promoted"]),
    graphRevision: CreatorDraftCollaborationGraphRevisionSchema,
    initialSnapshotByteLength: z.number().int().min(0).max(16 * 1_024 * 1_024),
    provisionIntent: CreatorDraftCollaborationProvisionIntentSchema,
    provisionedAt: CreatorIsoDateTimeSchema,
    expiresAt: CreatorIsoDateTimeSchema,
    promotedAt: CreatorIsoDateTimeSchema.nullable(),
  })
  .strict();

const CreatorAssetLicenseSchema = z.enum([
  "toonspectrum-standard",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-nc-4.0",
]);

export const CreatorAssetParamsSchema = z
  .object({ id: z.string().trim().min(1).max(160) })
  .strict();

export const CreatorAssetListQuerySchema = z
  .object({
    mine: z.literal("1").optional(),
    limit: z.coerce.number().int().min(1).max(CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE).default(
      CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE
    ),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    search: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(24).optional(),
    license: CreatorAssetLicenseSchema.optional(),
    kind: z.enum(["image", "sticker", "vrm_pose"]).optional(),
    sort: z.enum(["newest", "popular", "name"]).default("newest"),
  })
  .strict();

export const PublishCreatorAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500).default(""),
    tags: z.array(z.string().max(80)).max(20).default([]),
    dataUrl: z.string().min(1).max(3_300_000),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    previewDataUrl: z.string().min(1).max(CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS),
    previewWidth: z.number().int().min(1).max(320),
    previewHeight: z.number().int().min(1).max(320),
    kind: z.enum(["image", "sticker", "vrm_pose"]).default("image"),
    license: CreatorAssetLicenseSchema,
    attributionText: z.string().trim().max(160).default(""),
    containsAi: z.boolean().default(false),
    rightsConfirmed: z.literal(true),
  })
  .strict();

export const ReportCreatorAssetSchema = z
  .object({
    reason: z.enum(["copyright", "unsafe", "spam", "misleading", "other"]),
    details: z.string().max(500).default(""),
  })
  .strict();

export const CreatorAssetModerationQuerySchema = z
  .object({
    status: z.enum(["open", "resolved", "dismissed"]).default("open"),
    limit: z.coerce.number().int().min(1).max(CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE).default(
      CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE
    ),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export const ModerateCreatorAssetSchema = z
  .object({
    status: z.enum(["published", "under_review", "rejected"]),
    note: z.string().max(500).default(""),
  })
  .strict();

export class CreateCreatorWorkDto extends createZodDto(CreateCreatorWorkSchema) {}
export class UpdateCreatorWorkDto extends createZodDto(UpdateCreatorWorkSchema) {}
export class UpdateCreatorSharedDocumentDto extends createZodDto(UpdateCreatorSharedDocumentSchema) {}
export class CreatorWorkRevisionParamsDto extends createZodDto(CreatorWorkRevisionParamsSchema) {}
export class CreatorWorkRevisionListParamsDto extends createZodDto(CreatorWorkRevisionListParamsSchema) {}
export class CreatorWorkRevisionListQueryDto extends createZodDto(CreatorWorkRevisionListQuerySchema) {}
export class CreatorTeamListQueryDto extends createZodDto(CreatorTeamListQuerySchema) {}
export class CreatorSharedWorksListQueryDto extends createZodDto(CreatorSharedWorksListQuerySchema) {}
export class RestoreCreatorWorkRevisionDto extends createZodDto(RestoreCreatorWorkRevisionSchema) {}
export class CreatorTeamWorkParamsDto extends createZodDto(CreatorTeamWorkParamsSchema) {}
export class CreatorTeamMemberParamsDto extends createZodDto(CreatorTeamMemberParamsSchema) {}
export class InviteCreatorTeamMemberDto extends createZodDto(InviteCreatorTeamMemberSchema) {}
export class UpdateCreatorTeamMemberDto extends createZodDto(UpdateCreatorTeamMemberSchema) {}
export class RespondCreatorTeamInvitationDto extends createZodDto(RespondCreatorTeamInvitationSchema) {}
export class ProvisionCreatorDraftCollaborationRoomDto extends createZodDto(
  ProvisionCreatorDraftCollaborationRoomSchema
) {}
export class CreatorDraftCollaborationRoomParamsDto extends createZodDto(
  CreatorDraftCollaborationRoomParamsSchema
) {}
export class PromoteCreatorDraftCollaborationRoomDto extends createZodDto(
  PromoteCreatorDraftCollaborationRoomSchema
) {}
export class CreatorAssetParamsDto extends createZodDto(CreatorAssetParamsSchema) {}
export class CreatorAssetListQueryDto extends createZodDto(CreatorAssetListQuerySchema) {}
export class PublishCreatorAssetDto extends createZodDto(PublishCreatorAssetSchema) {}
export class ReportCreatorAssetDto extends createZodDto(ReportCreatorAssetSchema) {}
export class CreatorAssetModerationQueryDto extends createZodDto(CreatorAssetModerationQuerySchema) {}
export class ModerateCreatorAssetDto extends createZodDto(ModerateCreatorAssetSchema) {}
