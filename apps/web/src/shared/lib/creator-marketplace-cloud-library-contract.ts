import { z } from "zod";

import {
  CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL,
  CreatorMarketplaceHistoricalSemverSchema,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourcePackageIdSchema,
} from "./creator-marketplace-resource-contract";

export const CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE = 50;
export const CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS = 512;
export const CREATOR_MARKETPLACE_CLOUD_LIBRARY_SCOPE = "account-ever" as const;
export const CREATOR_MARKETPLACE_CLOUD_LIBRARY_VIEWS = [
  "active",
  "archived",
  "all",
] as const;
export const CREATOR_MARKETPLACE_CLOUD_LIBRARY_MEMBERSHIPS = [
  "active",
  "archived",
] as const;
export const CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS = [
  "brush",
  "filter",
  "palette",
] as const;
export const CREATOR_MARKETPLACE_CATALOG_UNAVAILABLE_REASONS = [
  "moderated",
  "owner-delisted",
  "publisher-unavailable",
  "removed",
] as const;

export const CREATOR_MARKETPLACE_LOGICAL_PACK_ID_PATTERN =
  /^community:[0-9a-f]{64}$/u;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const UuidSchema = z.string().uuid();
const IsoDateSchema = z.iso.datetime({ offset: true });

export const CreatorMarketplaceCloudLibraryViewSchema = z.enum(
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_VIEWS,
);
export const CreatorMarketplaceCloudLibraryMembershipSchema = z.enum(
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_MEMBERSHIPS,
);
export const CreatorMarketplaceStudioConfirmableKindSchema = z.enum(
  CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS,
);
export const CreatorMarketplaceCatalogUnavailableReasonSchema = z.enum(
  CREATOR_MARKETPLACE_CATALOG_UNAVAILABLE_REASONS,
);
export const CreatorMarketplaceLogicalPackIdSchema = z
  .string()
  .regex(CREATOR_MARKETPLACE_LOGICAL_PACK_ID_PATTERN);

const CreatorMarketplacePackagePublisherIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => !value.includes("\0"),
    "배급자 식별자에는 NUL 문자를 사용할 수 없습니다.",
  );

function parsePackageIdentity(
  publisherId: string,
  packageId: string,
): { publisherId: string; packageId: string } {
  return {
    publisherId: CreatorMarketplacePackagePublisherIdSchema.parse(publisherId),
    packageId: CreatorMarketplaceResourcePackageIdSchema.parse(packageId),
  };
}

/** Canonical, delimiter-safe package identity bytes shared by browser and API code. */
export function creatorMarketplacePackageIdentityPreimage(
  publisherId: string,
  packageId: string,
): Uint8Array {
  const parsed = parsePackageIdentity(publisherId, packageId);
  return new TextEncoder().encode(`${parsed.publisherId}\0${parsed.packageId}`);
}

/** Adds the stable Studio namespace after a caller hashes the canonical preimage. */
export function creatorMarketplaceLogicalPackIdFromPackageKeyHex(
  packageKeyHex: string,
): string {
  return `community:${Sha256Schema.parse(packageKeyHex)}`;
}

const CreatorMarketplaceLibraryReleaseSnapshotSchema = z
  .object({
    releaseId: UuidSchema.nullable(),
    resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
    releaseOrdinal: z.number().int().min(1).max(CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL),
    manifestHash: Sha256Schema,
  })
  .strict();

const CreatorMarketplaceNoStudioConfirmationSchema = z
  .object({ state: z.literal("none") })
  .strict();

const CreatorMarketplaceConfirmedStudioInstallSchema =
  CreatorMarketplaceLibraryReleaseSnapshotSchema.extend({
    state: z.literal("confirmed"),
    scope: z.literal(CREATOR_MARKETPLACE_CLOUD_LIBRARY_SCOPE),
    firstConfirmedAt: IsoDateSchema,
    lastConfirmedAt: IsoDateSchema,
  })
    .strict()
    .superRefine((confirmation, context) => {
      if (
        Date.parse(confirmation.firstConfirmedAt)
        > Date.parse(confirmation.lastConfirmedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["lastConfirmedAt"],
          message: "마지막 설치 확인 시각은 최초 확인 시각보다 빠를 수 없습니다.",
        });
      }
    });

export const CreatorMarketplaceStudioConfirmationSchema = z.discriminatedUnion(
  "state",
  [
    CreatorMarketplaceNoStudioConfirmationSchema,
    CreatorMarketplaceConfirmedStudioInstallSchema,
  ],
);

const CreatorMarketplaceCatalogHeadSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(80),
    kind: CreatorMarketplaceResourceKindSchema,
    resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
    minimumStudioVersion: CreatorMarketplaceHistoricalSemverSchema,
    releaseOrdinal: z.number().int().min(1).max(CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL),
    manifestHash: Sha256Schema,
  })
  .strict();

export const CreatorMarketplaceLibraryCatalogStateSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("available"),
        head: CreatorMarketplaceCatalogHeadSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("unavailable"),
        reason: CreatorMarketplaceCatalogUnavailableReasonSchema,
      })
      .strict(),
  ],
);

const CreatorMarketplaceAcquisitionTargetBaseSchema = z
  .object({
    requestReleaseId: UuidSchema,
    publisherId: CreatorMarketplacePackagePublisherIdSchema,
    packageId: CreatorMarketplaceResourcePackageIdSchema,
    kind: CreatorMarketplaceResourceKindSchema,
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema,
  })
  .strict();

export const CreatorMarketplaceAcquisitionTargetSchema = z.discriminatedUnion(
  "state",
  [
    CreatorMarketplaceAcquisitionTargetBaseSchema.extend({
      state: z.literal("available"),
      currentHead: z.object({
        id: UuidSchema,
        resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
      }).strict(),
    }).strict(),
    CreatorMarketplaceAcquisitionTargetBaseSchema.extend({
      state: z.literal("unavailable"),
      reason: z.enum([
        "moderated",
        "owner-delisted",
        "publisher-unavailable",
      ]),
    }).strict(),
  ],
);

export const CreatorMarketplaceLibraryUpdateStateSchema = z.enum([
  "no-account-confirmation",
  "account-confirmed-current-head",
  "account-confirmed-update-available",
  "catalog-unavailable",
]);

export const CreatorMarketplaceCloudLibraryItemSchema = z
  .object({
    id: UuidSchema,
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema,
    packageId: CreatorMarketplaceResourcePackageIdSchema,
    name: z.string().trim().min(1).max(80),
    kind: CreatorMarketplaceResourceKindSchema,
    membership: CreatorMarketplaceCloudLibraryMembershipSchema,
    addedFrom: CreatorMarketplaceLibraryReleaseSnapshotSchema,
    addedAt: IsoDateSchema,
    archivedAt: IsoDateSchema.nullable(),
    confirmation: CreatorMarketplaceStudioConfirmationSchema,
    catalog: CreatorMarketplaceLibraryCatalogStateSchema,
    updateState: CreatorMarketplaceLibraryUpdateStateSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (
      (item.membership === "active") !== (item.archivedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["membership"],
        message: "보관 상태와 라이브러리 멤버십이 일치해야 합니다.",
      });
    }
    if (item.catalog.state === "unavailable") {
      if (item.updateState !== "catalog-unavailable") {
        context.addIssue({
          code: "custom",
          path: ["updateState"],
          message: "카탈로그를 사용할 수 없으면 업데이트 상태도 사용할 수 없어야 합니다.",
        });
      }
      return;
    }
    if (item.confirmation.state === "none") {
      if (item.updateState !== "no-account-confirmation") {
        context.addIssue({
          code: "custom",
          path: ["updateState"],
          message: "설치 확인 전에는 업데이트 여부를 표시할 수 없습니다.",
        });
      }
      return;
    }
    if (item.catalog.head.kind !== item.kind) {
      context.addIssue({
        code: "custom",
        path: ["catalog", "head", "kind"],
        message: "패키지 종류는 공개 release history 전체에서 같아야 합니다.",
      });
    }
    if (item.confirmation.releaseOrdinal > item.catalog.head.releaseOrdinal) {
      context.addIssue({
        code: "custom",
        path: ["confirmation", "releaseOrdinal"],
        message: "설치 확인 ordinal이 현재 공개 head보다 앞설 수 없습니다.",
      });
      return;
    }
    const isOlder = item.confirmation.releaseOrdinal < item.catalog.head.releaseOrdinal;
    if (!isOlder && (
      item.confirmation.resourceVersion !== item.catalog.head.resourceVersion
      || item.confirmation.manifestHash !== item.catalog.head.manifestHash
      || (
        item.confirmation.releaseId !== null
        && item.confirmation.releaseId !== item.catalog.head.id
      )
    )) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "같은 ordinal의 설치 확인과 공개 head 증거가 일치해야 합니다.",
      });
      return;
    }
    const expected = isOlder
      ? "account-confirmed-update-available"
      : "account-confirmed-current-head";
    if (item.updateState !== expected) {
      context.addIssue({
        code: "custom",
        path: ["updateState"],
        message: "설치 확인 버전과 현재 공개 head의 업데이트 상태가 일치해야 합니다.",
      });
    }
  });

export const CreatorMarketplaceCloudLibraryPageSchema = z
  .object({
    items: z
      .array(CreatorMarketplaceCloudLibraryItemSchema)
      .max(CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE),
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(
      CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS,
    ).regex(/^[A-Za-z0-9_-]+$/u).nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.hasMore !== (page.nextCursor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "다음 페이지 여부와 커서가 일치해야 합니다.",
      });
    }
  });

export const ConfirmCreatorMarketplaceStudioInstallSchema = z
  .object({
    schemaVersion: z.literal(1),
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema,
    packageFingerprint: Sha256Schema,
  })
  .strict();

export const SetCreatorMarketplaceLibraryArchiveSchema = z
  .object({ archived: z.boolean() })
  .strict();

const CreatorMarketplaceLibraryMutationBaseSchema = z
  .object({
    changed: z.boolean(),
    membership: CreatorMarketplaceCloudLibraryMembershipSchema,
    libraryScope: z.literal("account"),
    libraryItemId: UuidSchema,
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema,
    updatedAt: IsoDateSchema,
  })
  .strict();

export const CreatorMarketplaceAcquireReceiptSchema =
  CreatorMarketplaceLibraryMutationBaseSchema.extend({
    operation: z.literal("acquire"),
  }).strict();

export const CreatorMarketplaceArchiveReceiptSchema =
  CreatorMarketplaceLibraryMutationBaseSchema.extend({
    operation: z.literal("set-archive"),
  }).strict();

export const CreatorMarketplaceStudioInstallConfirmationReceiptSchema =
  CreatorMarketplaceLibraryMutationBaseSchema.extend({
    operation: z.literal("confirm-studio-install"),
    acknowledgement: z.object({
      releaseId: UuidSchema,
      manifestHash: Sha256Schema,
    }).strict(),
    confirmation: CreatorMarketplaceLibraryReleaseSnapshotSchema.extend({
      scope: z.literal(CREATOR_MARKETPLACE_CLOUD_LIBRARY_SCOPE),
      confirmedAt: IsoDateSchema,
    }).strict(),
  })
    .strict()
    .superRefine((receipt, context) => {
      if (
        receipt.confirmation.releaseId === receipt.acknowledgement.releaseId
        && receipt.confirmation.manifestHash !== receipt.acknowledgement.manifestHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["acknowledgement", "manifestHash"],
          message: "같은 릴리스의 요청 확인과 계정 설치 이력 지문이 일치해야 합니다.",
        });
      }
    });

export type CreatorMarketplaceCloudLibraryView = z.infer<
  typeof CreatorMarketplaceCloudLibraryViewSchema
>;
export type CreatorMarketplaceCloudLibraryMembership = z.infer<
  typeof CreatorMarketplaceCloudLibraryMembershipSchema
>;
export type CreatorMarketplaceCloudLibraryItem = z.infer<
  typeof CreatorMarketplaceCloudLibraryItemSchema
>;
export type CreatorMarketplaceCloudLibraryPage = z.infer<
  typeof CreatorMarketplaceCloudLibraryPageSchema
>;
export type CreatorMarketplaceAcquisitionTarget = z.infer<
  typeof CreatorMarketplaceAcquisitionTargetSchema
>;
export type ConfirmCreatorMarketplaceStudioInstall = z.infer<
  typeof ConfirmCreatorMarketplaceStudioInstallSchema
>;
export type SetCreatorMarketplaceLibraryArchive = z.infer<
  typeof SetCreatorMarketplaceLibraryArchiveSchema
>;
export type CreatorMarketplaceAcquireReceipt = z.infer<
  typeof CreatorMarketplaceAcquireReceiptSchema
>;
export type CreatorMarketplaceArchiveReceipt = z.infer<
  typeof CreatorMarketplaceArchiveReceiptSchema
>;
export type CreatorMarketplaceStudioInstallConfirmationReceipt = z.infer<
  typeof CreatorMarketplaceStudioInstallConfirmationReceiptSchema
>;
