import { z } from "zod";

import {
  CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS,
  isCreatorMarketplaceSemver,
  normalizeCreatorMarketplaceLegacySemver,
} from "./creator-marketplace-semver";

export const CREATOR_MARKETPLACE_RESOURCE_KINDS = [
  "asset",
  "brush",
  "filter",
  "palette",
  "template",
  "3d-preset",
  "3d-asset",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_LICENSES = [
  "toonspectrum-standard",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-nc-4.0",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_SORTS = [
  "newest",
  "relevance",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_ENGINES = [
  "canvas2d",
  "webgl2",
  "webgpu",
  "three",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_RUNTIMES = [
  "studio-procedural-asset-v1",
  "studio-brush-v1",
  "studio-filter-v1",
  "studio-palette-v1",
  "studio-template-v1",
  "studio-bg3d-preset-v1",
  "studio-3d-asset-v1",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_REPORT_REASONS = [
  "copyright",
  "unsafe",
  "spam",
  "misleading",
  "other",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_REPORT_STATUSES = [
  "open",
  "resolved",
  "dismissed",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_MODERATION_ACTIONS = [
  "hide",
  "restore",
  "dismiss",
] as const;

export const CREATOR_MARKETPLACE_PACKAGE_MODERATION_STATES = [
  "active",
  "hidden",
] as const;

/** Appeals are intentionally not part of the 0034 P0 API; only administrators hide/restore. */
export const CREATOR_MARKETPLACE_PACKAGE_MODERATION_DECISION_ACTIONS = [
  "hide",
  "restore",
] as const;

export const CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES = 64 * 1_024;
export const CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRY_BYTES = 16 * 1_024;
export const CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE = 20;
export const CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRIES = 32;
export const CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS = 512;
export const CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS = 80;
export const CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS = 24;
export const CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS = 2_000;
export const CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL = 2_147_483_647;
export const CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS = 500;
export const CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS = 500;
export const CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE = 50;

export type CreatorMarketplaceResourceKind =
  (typeof CREATOR_MARKETPLACE_RESOURCE_KINDS)[number];
export type CreatorMarketplaceResourceLicense =
  (typeof CREATOR_MARKETPLACE_RESOURCE_LICENSES)[number];
export type CreatorMarketplaceResourceSort =
  (typeof CREATOR_MARKETPLACE_RESOURCE_SORTS)[number];
export type CreatorMarketplaceResourceEngine =
  (typeof CREATOR_MARKETPLACE_RESOURCE_ENGINES)[number];
export type CreatorMarketplaceResourceReportReason =
  (typeof CREATOR_MARKETPLACE_RESOURCE_REPORT_REASONS)[number];
export type CreatorMarketplaceResourceReportStatus =
  (typeof CREATOR_MARKETPLACE_RESOURCE_REPORT_STATUSES)[number];
export type CreatorMarketplaceResourceModerationAction =
  (typeof CREATOR_MARKETPLACE_RESOURCE_MODERATION_ACTIONS)[number];
export type CreatorMarketplacePackageModerationState =
  (typeof CREATOR_MARKETPLACE_PACKAGE_MODERATION_STATES)[number];
export type CreatorMarketplacePackageModerationDecisionAction =
  (typeof CREATOR_MARKETPLACE_PACKAGE_MODERATION_DECISION_ACTIONS)[number];

export const CREATOR_MARKETPLACE_RUNTIME_BY_KIND = {
  asset: "studio-procedural-asset-v1",
  brush: "studio-brush-v1",
  filter: "studio-filter-v1",
  palette: "studio-palette-v1",
  template: "studio-template-v1",
  "3d-preset": "studio-bg3d-preset-v1",
  "3d-asset": "studio-3d-asset-v1",
} as const satisfies Record<CreatorMarketplaceResourceKind, string>;

export const CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND = {
  asset: "studio-asset:",
  template: "studio-scene-template:",
  "3d-preset": "studio-bg3d-preset:",
  "3d-asset": "studio-3d-asset:",
} as const;

export type CreatorMarketplaceJsonValue =
  | null
  | boolean
  | number
  | string
  | CreatorMarketplaceJsonValue[]
  | { [key: string]: CreatorMarketplaceJsonValue };

export const CreatorMarketplaceSemverSchema = z
  .string()
  .trim()
  .max(CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS)
  .refine(
    isCreatorMarketplaceSemver,
    "버전은 1.2.3, 1.2.3-rc.1 또는 1.2.3+build.7 형태의 SemVer 2.0이어야 합니다."
  );

/**
 * Read-only compatibility validator for rows admitted by the 0021-era grammar. It intentionally
 * does not transform the value: normalizing here would change canonical manifest bytes and break
 * the immutable stored hash. New publish requests continue to use CreatorMarketplaceSemverSchema.
 */
export const CreatorMarketplaceHistoricalSemverSchema = z
  .string()
  .trim()
  .max(CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS)
  .refine(
    (value) => normalizeCreatorMarketplaceLegacySemver(value) !== null,
    "저장된 마켓 버전 형식이 지원 범위를 벗어났습니다."
  );
const ResourceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, "리소스 식별자 형식이 올바르지 않습니다.");
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const HttpsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => value.startsWith("https://"), "HTTPS 주소만 사용할 수 있습니다.");

const ShallowPortableDefinitionSchema = z.custom<
  Record<string, CreatorMarketplaceJsonValue>
>(
  (value) => isPlainRecord(value) && Object.keys(value).length > 0,
  "portable JSON definition은 비어 있지 않은 일반 객체여야 합니다."
);

export const CreatorMarketplaceResourceKindSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_KINDS
);
export const CreatorMarketplaceResourceLicenseSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_LICENSES
);
export const CreatorMarketplaceResourceSortSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_SORTS
);
export const CreatorMarketplaceResourceReportReasonSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_REPORT_REASONS
);
export const CreatorMarketplaceResourceReportStatusSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_REPORT_STATUSES
);
export const CreatorMarketplaceResourceModerationActionSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_ACTIONS
);
export const CreatorMarketplacePackageModerationStateSchema = z.enum(
  CREATOR_MARKETPLACE_PACKAGE_MODERATION_STATES
);
export const CreatorMarketplacePackageModerationDecisionActionSchema = z.enum(
  CREATOR_MARKETPLACE_PACKAGE_MODERATION_DECISION_ACTIONS
);
const CreatorMarketplaceResourceRuntimeSchema = z.enum(
  CREATOR_MARKETPLACE_RESOURCE_RUNTIMES
);

function creatorMarketplaceQueryContainsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

export const CreatorMarketplaceResourceSearchQuerySchema = z
  .string()
  .trim()
  .max(CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS)
  .refine(
    (value) => !creatorMarketplaceQueryContainsControlCharacter(value),
    "검색어에 제어 문자를 사용할 수 없습니다."
  );
export const CreatorMarketplaceResourceTagQuerySchema = z
  .string()
  .trim()
  .max(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS)
  .refine(
    (value) => !creatorMarketplaceQueryContainsControlCharacter(value),
    "태그에 제어 문자를 사용할 수 없습니다."
  );
export const CreatorMarketplaceResourcePublisherQuerySchema = z
  .string()
  .trim()
  .uuid();
export const CreatorMarketplaceResourcePackageIdSchema = ResourceKeySchema;

export const CreatorMarketplacePortablePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    resourceKind: CreatorMarketplaceResourceKindSchema,
    runtime: CreatorMarketplaceResourceRuntimeSchema,
    definition: ShallowPortableDefinitionSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    const issue = inspectPortablePayload(payload.definition);
    if (issue) {
      context.addIssue({
        code: "custom",
        path: ["definition", ...issue.path],
        message: issue.message,
      });
    }
    if (
      payload.runtime !==
      CREATOR_MARKETPLACE_RUNTIME_BY_KIND[payload.resourceKind]
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime"],
        message: "리소스 종류와 portable runtime 식별자가 일치해야 합니다.",
      });
    }
    if (!issue) {
      const definitionIssue = inspectKindDefinition(
        payload.resourceKind,
        payload.definition
      );
      if (definitionIssue) {
        context.addIssue({
          code: "custom",
          path: ["definition", ...definitionIssue.path],
          message: definitionIssue.message,
        });
      }
    }
  });

export type CreatorMarketplacePortablePayload = z.infer<
  typeof CreatorMarketplacePortablePayloadSchema
>;

const CreatorMarketplaceResourceProvenanceSchema = z.discriminatedUnion("origin", [
  z
    .object({
      origin: z.literal("original"),
      authoredByPublisher: z.literal(true),
    })
    .strict(),
  z
    .object({
      origin: z.literal("permissive"),
      authoredByPublisher: z.literal(false),
      sourceName: z.string().trim().min(1).max(120),
      sourceUrl: HttpsUrlSchema,
      sourceLicenseUrl: HttpsUrlSchema,
    })
    .strict(),
]);

const CreatorMarketplaceBuiltinDeliverySchema = z
  .object({
    mode: z.literal("builtin-ref"),
    runtimeRef: ResourceKeySchema,
    byteSize: z.literal(0),
    sha256: Sha256Schema,
  })
  .strict();

const CreatorMarketplacePortableDeliverySchema = z
  .object({
    mode: z.enum(["portable-json", "procedural-recipe"]),
    mediaType: z.enum([
      "application/vnd.toonspectrum.asset+json",
      "application/vnd.toonspectrum.brush+json",
      "application/vnd.toonspectrum.filter+json",
      "application/vnd.toonspectrum.palette+json",
      "application/vnd.toonspectrum.template+json",
      "application/vnd.toonspectrum.3d-preset+json",
      "application/vnd.toonspectrum.3d-asset+json",
    ]),
    payload: CreatorMarketplacePortablePayloadSchema,
    byteSize: z.number().int().min(2).max(CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRY_BYTES),
    sha256: Sha256Schema,
  })
  .strict();

export const CreatorMarketplaceResourceEntrySchema = z
  .object({
    id: ResourceKeySchema,
    kind: CreatorMarketplaceResourceKindSchema,
    name: z.string().trim().min(1).max(80),
    delivery: z.discriminatedUnion("mode", [
      CreatorMarketplaceBuiltinDeliverySchema,
      CreatorMarketplacePortableDeliverySchema,
    ]),
  })
  .strict();

const CREATOR_MARKETPLACE_MEDIA_TYPE_BY_KIND: Record<
  CreatorMarketplaceResourceKind,
  string
> = {
  asset: "application/vnd.toonspectrum.asset+json",
  brush: "application/vnd.toonspectrum.brush+json",
  filter: "application/vnd.toonspectrum.filter+json",
  palette: "application/vnd.toonspectrum.palette+json",
  template: "application/vnd.toonspectrum.template+json",
  "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
  "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
};

const CreatorMarketplaceResourceManifestBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageId: ResourceKeySchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1_000).default(""),
    // Optional without a default so adding release notes never rewrites the canonical bytes/hash
    // of 0021-era manifests that predate this field.
    releaseNotes: z
      .string()
      .trim()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS)
      .optional(),
    kind: CreatorMarketplaceResourceKindSchema,
    resourceVersion: CreatorMarketplaceSemverSchema,
    minimumStudioVersion: CreatorMarketplaceSemverSchema,
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS)
      )
      .max(8)
      .default([]),
    license: CreatorMarketplaceResourceLicenseSchema,
    attributionText: z.string().trim().max(240).default(""),
    containsAi: z.boolean().default(false),
    rightsConfirmed: z.literal(true),
    provenance: CreatorMarketplaceResourceProvenanceSchema,
    compatibility: z
      .object({
        engines: z.array(z.enum(CREATOR_MARKETPLACE_RESOURCE_ENGINES)).min(1).max(4),
      })
      .strict(),
    previewRef: ResourceKeySchema.optional(),
    entries: z
      .array(CreatorMarketplaceResourceEntrySchema)
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRIES),
  })
  .strict();

const CreatorMarketplaceStoredResourceManifestBaseSchema =
  CreatorMarketplaceResourceManifestBaseSchema.extend({
    resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
    minimumStudioVersion: CreatorMarketplaceHistoricalSemverSchema,
  });

type CreatorMarketplaceResourceManifestSemanticValue = Omit<
  z.infer<typeof CreatorMarketplaceResourceManifestBaseSchema>,
  "rightsConfirmed"
>;

function refineCreatorMarketplaceManifest(
  manifest: CreatorMarketplaceResourceManifestSemanticValue,
  context: z.RefinementCtx
): void {
    if (
      (manifest.license === "cc-by-4.0" || manifest.license === "cc-by-nc-4.0") &&
      !manifest.attributionText
    ) {
      context.addIssue({
        code: "custom",
        path: ["attributionText"],
        message: "CC BY 계열 리소스에는 출처 표시 문구가 필요합니다.",
      });
    }
    if (
      manifest.provenance.origin === "permissive" &&
      manifest.license === "toonspectrum-standard"
    ) {
      context.addIssue({
        code: "custom",
        path: ["license"],
        message: "외부 허용 리소스를 ToonSpectrum 표준 사용권으로 재라이선스할 수 없습니다.",
      });
    }

    const entryIds = new Set<string>();
    for (const [index, entry] of manifest.entries.entries()) {
      if (entry.kind !== manifest.kind) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "kind"],
          message: "패키지 종류와 항목 종류가 일치해야 합니다.",
        });
      }
      const normalizedId = entry.id.toLowerCase();
      if (entryIds.has(normalizedId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "id"],
          message: "패키지 안에서 리소스 식별자는 중복될 수 없습니다.",
        });
      }
      entryIds.add(normalizedId);

      if (entry.delivery.mode === "builtin-ref") {
        const expectedPrefix =
          entry.kind === "asset" ||
          entry.kind === "template" ||
          entry.kind === "3d-preset" ||
          entry.kind === "3d-asset"
            ? CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND[entry.kind]
            : null;
        if (
          !expectedPrefix ||
          !entry.delivery.runtimeRef.startsWith(expectedPrefix) ||
          !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/u.test(
            entry.delivery.runtimeRef.slice(expectedPrefix?.length ?? 0)
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["entries", index, "delivery", "runtimeRef"],
            message: "리소스 종류에 등록된 안정적인 built-in 참조만 공유할 수 있습니다.",
          });
        }
        continue;
      }

      if (
        (entry.kind === "asset" || entry.kind === "3d-preset" || entry.kind === "3d-asset") &&
        entry.delivery.mode !== "procedural-recipe"
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "mode"],
          message: "2D/3D 리소스는 절차형 recipe만 portable 콘텐츠로 공유할 수 있습니다.",
        });
      }
      if (
        entry.kind !== "asset" &&
        entry.kind !== "3d-preset" &&
        entry.kind !== "3d-asset" &&
        entry.delivery.mode !== "portable-json"
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "mode"],
          message: "브러시·필터·팔레트·템플릿은 적용 가능한 portable JSON으로 공유해야 합니다.",
        });
      }

      if (
        entry.delivery.payload.resourceKind !== entry.kind ||
        entry.delivery.payload.runtime !==
          CREATOR_MARKETPLACE_RUNTIME_BY_KIND[entry.kind]
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "payload"],
          message: "리소스 종류와 portable runtime 식별자가 일치해야 합니다.",
        });
      }
      if (entry.delivery.mediaType !== CREATOR_MARKETPLACE_MEDIA_TYPE_BY_KIND[entry.kind]) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "mediaType"],
          message: "리소스 종류와 portable JSON 미디어 타입이 일치해야 합니다.",
        });
      }
      const issue = inspectPortablePayload(entry.delivery.payload);
      if (issue) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "payload", ...issue.path],
          message: issue.message,
        });
      } else {
        const definitionIssue = inspectKindDefinition(
          entry.kind,
          entry.delivery.payload.definition
        );
        if (definitionIssue) {
          context.addIssue({
            code: "custom",
            path: [
              "entries",
              index,
              "delivery",
              "payload",
              "definition",
              ...definitionIssue.path,
            ],
            message: definitionIssue.message,
          });
        }
      }
      if (
        !issue &&
        creatorMarketplaceJsonByteSize(entry.delivery.payload) !==
          entry.delivery.byteSize
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "delivery", "byteSize"],
          message: "선언한 항목 크기와 실제 JSON 크기가 일치하지 않습니다.",
        });
      }
    }
}

function refineCreatorMarketplaceManifestWithSize(
  manifest: CreatorMarketplaceResourceManifestSemanticValue,
  context: z.RefinementCtx
): void {
    refineCreatorMarketplaceManifest(manifest, context);
    const definitionsAreStructurallySafe = manifest.entries.every(
      (entry) =>
        entry.delivery.mode === "builtin-ref" ||
        inspectPortablePayload(entry.delivery.payload) === null
    );
    if (
      definitionsAreStructurallySafe &&
      creatorMarketplaceJsonByteSize(manifest) >
      CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "공유 manifest가 허용된 크기를 초과했습니다.",
      });
    }
}

export const CreatorMarketplaceResourceManifestSchema =
  CreatorMarketplaceResourceManifestBaseSchema.superRefine(
    refineCreatorMarketplaceManifestWithSize
  );

export const CreatorMarketplaceStoredResourceManifestSchema =
  CreatorMarketplaceStoredResourceManifestBaseSchema.superRefine(
    refineCreatorMarketplaceManifestWithSize
  );

export type CreatorMarketplaceStoredResourceManifest = z.infer<
  typeof CreatorMarketplaceStoredResourceManifestSchema
>;

export type CreatorMarketplaceResourceManifest = z.infer<
  typeof CreatorMarketplaceResourceManifestSchema
>;

export const CreatorMarketplaceResourcePublisherSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(120),
    avatar: z.string().max(500).nullable(),
  })
  .strict();

/**
 * Exact, payload-free identity used only to reconcile legacy local Studio installs.
 * The UUID was already supplied by the caller; this deliberately exposes no manifest,
 * release version, entitlement, moderation note, or owner/account state.
 */
export const CreatorMarketplaceResourceIdentitySchema = z
  .object({
    id: z.string().uuid(),
    publisherId: z.string().trim().min(1).max(160),
    packageId: ResourceKeySchema,
    kind: CreatorMarketplaceResourceKindSchema,
    availability: z.enum([
      "listed",
      "owner-delisted",
      "moderator-hidden",
      "publisher-unavailable",
    ]),
  })
  .strict();

export type CreatorMarketplaceResourceIdentity = z.infer<
  typeof CreatorMarketplaceResourceIdentitySchema
>;

const CreatorMarketplacePublicManifestBaseSchema =
  CreatorMarketplaceStoredResourceManifestBaseSchema.omit({ rightsConfirmed: true });

export const CreatorMarketplacePublicManifestSchema =
  CreatorMarketplacePublicManifestBaseSchema.superRefine(
    refineCreatorMarketplaceManifest
  );

export const CreatorMarketplaceResourceRecordSchema =
  CreatorMarketplacePublicManifestBaseSchema
    .extend({
      id: z.string().uuid(),
      manifestHash: Sha256Schema,
      manifestByteSize: z
        .number()
        .int()
        .min(1)
        .max(CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES),
      publisher: CreatorMarketplaceResourcePublisherSchema,
      createdAt: z.iso.datetime({ offset: true }),
      updatedAt: z.iso.datetime({ offset: true }),
      isOwner: z.boolean(),
      access: z.literal("free"),
    })
    .strict()
    .superRefine(refineCreatorMarketplaceManifest);

export type CreatorMarketplaceResourceRecord = z.infer<
  typeof CreatorMarketplaceResourceRecordSchema
>;

export const CreatorMarketplaceResourceListPageSchema = z
  .object({
    items: z
      .array(CreatorMarketplaceResourceRecordSchema)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
    nextCursor: z
      .string()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .nullable(),
  })
  .strict();

export type CreatorMarketplaceResourceListPage = z.infer<
  typeof CreatorMarketplaceResourceListPageSchema
>;

export const CreatorMarketplaceResourceHistoryItemSchema = z
  .object({
    // Public history exposes identifiers only for releases that are currently listed. Hidden and
    // owner-delisted rows are excluded by the repository before this contract is constructed.
    id: z.string().uuid(),
    releaseOrdinal: z.number().int().min(1),
    name: z.string().trim().min(1).max(80),
    resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
    minimumStudioVersion: CreatorMarketplaceHistoricalSemverSchema,
    releaseNotes: z
      .string()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS)
      .optional(),
    manifestHash: Sha256Schema,
    createdAt: z.iso.datetime({ offset: true }),
    selected: z.boolean(),
  })
  .strict();

export type CreatorMarketplaceResourceHistoryItem = z.infer<
  typeof CreatorMarketplaceResourceHistoryItemSchema
>;

export const CreatorMarketplaceResourceHistoryPageSchema = z
  .object({
    packageId: ResourceKeySchema,
    anchor: z
      .object({
        // This UUID was already supplied by the caller. A delisted anchor may be echoed, but no
        // other delisted identifier is ever admitted into `items`.
        id: z.string().uuid(),
        resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
        listed: z.boolean(),
      })
      .strict(),
    items: z
      .array(CreatorMarketplaceResourceHistoryItemSchema)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
    nextCursor: z.number().int().min(1).nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    const ids = new Set<string>();
    const ordinals = new Set<number>();
    for (const [index, item] of page.items.entries()) {
      if (ids.has(item.id) || ordinals.has(item.releaseOrdinal)) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "릴리스 이력 식별자와 순서는 중복될 수 없습니다.",
        });
      }
      ids.add(item.id);
      ordinals.add(item.releaseOrdinal);
      if (item.selected !== (item.id === page.anchor.id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "selected"],
          message: "선택 상태는 요청한 이력 기준 릴리스와 일치해야 합니다.",
        });
      }
      if (!page.anchor.listed && item.id === page.anchor.id) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "id"],
          message: "목록에서 내린 기준 릴리스는 공개 이력에 포함할 수 없습니다.",
        });
      }
    }
  });

export type CreatorMarketplaceResourceHistoryPage = z.infer<
  typeof CreatorMarketplaceResourceHistoryPageSchema
>;

export const CreatorMarketplacePackageModerationSnapshotSchema = z
  .object({
    state: CreatorMarketplacePackageModerationStateSchema,
    revision: z.number().int().min(0),
    hiddenAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "hidden") !== (value.hiddenAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["hiddenAt"],
        message: "패키지 숨김 상태와 숨김 시각이 일치해야 합니다.",
      });
    }
    if (value.revision === 0 && value.state !== "active") {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "초기 패키지 중재 상태는 공개 상태여야 합니다.",
      });
    }
  });

export type CreatorMarketplacePackageModerationSnapshot = z.infer<
  typeof CreatorMarketplacePackageModerationSnapshotSchema
>;

export const CreatorMarketplaceOwnedReleaseSchema = z
  .object({
    resource: CreatorMarketplaceResourceRecordSchema,
    releaseOrdinal: z.number().int().min(1),
    /** @deprecated Compatibility projection derived from packageModeration.state. */
    hidden: z.boolean(),
    delistedAt: z.iso.datetime({ offset: true }).nullable(),
    packageModeration: CreatorMarketplacePackageModerationSnapshotSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.resource.isOwner) {
      context.addIssue({
        code: "custom",
        path: ["resource", "isOwner"],
        message: "소유 릴리스에는 소유자 투영만 사용할 수 있습니다.",
      });
    }
    if (value.hidden !== (value.packageModeration.state === "hidden")) {
      context.addIssue({
        code: "custom",
        path: ["hidden"],
        message: "호환 숨김 값은 패키지 중재 상태에서 파생되어야 합니다.",
      });
    }
  });

export type CreatorMarketplaceOwnedRelease = z.infer<
  typeof CreatorMarketplaceOwnedReleaseSchema
>;

export const CreatorMarketplaceOwnedHeadPageSchema = z
  .object({
    items: z
      .array(CreatorMarketplaceOwnedReleaseSchema)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
    nextCursor: z
      .string()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .nullable(),
  })
  .strict();

export type CreatorMarketplaceOwnedHeadPage = z.infer<
  typeof CreatorMarketplaceOwnedHeadPageSchema
>;

export const CreatorMarketplaceOwnedHistoryPageSchema = z
  .object({
    packageId: ResourceKeySchema,
    items: z
      .array(CreatorMarketplaceOwnedReleaseSchema)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
    nextCursor: z.number().int().min(1).nullable(),
  })
  .strict();

export type CreatorMarketplaceOwnedHistoryPage = z.infer<
  typeof CreatorMarketplaceOwnedHistoryPageSchema
>;

export const CreatorMarketplaceResourceRelistReceiptSchema = z
  .object({
    relisted: z.literal(true),
    changed: z.boolean(),
    id: z.string().uuid(),
    delistedAt: z.null(),
  })
  .strict();

export type CreatorMarketplaceResourceRelistReceipt = z.infer<
  typeof CreatorMarketplaceResourceRelistReceiptSchema
>;

/**
 * A bounded, immutable snapshot captured by the API while the target release row is locked.
 * It deliberately stores verifiable release metadata rather than another copy of the potentially
 * 64 KiB manifest. The referenced release normally remains available, while this snapshot keeps
 * the moderation record intelligible if account lifecycle cleanup later removes that release.
 */
const CreatorMarketplaceResourceReportEvidenceBaseSchema = z
  .object({
    resourceId: z.string().uuid(),
    packageId: ResourceKeySchema,
    name: z.string().trim().min(1).max(80),
    kind: CreatorMarketplaceResourceKindSchema,
    resourceVersion: CreatorMarketplaceHistoricalSemverSchema,
    license: CreatorMarketplaceResourceLicenseSchema,
    manifestHash: Sha256Schema,
    manifestByteSize: z
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES),
    releaseCreatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const CreatorMarketplaceResourceReportEvidenceV1Schema =
  CreatorMarketplaceResourceReportEvidenceBaseSchema.extend({
    schemaVersion: z.literal(1),
  }).strict();

export const CreatorMarketplaceResourceReportEvidenceV2Schema =
  CreatorMarketplaceResourceReportEvidenceBaseSchema.extend({
    schemaVersion: z.literal(2),
    publisherId: z.string().trim().min(1).max(160),
    packageModerationRevision: z.number().int().min(0),
  }).strict();

export const CreatorMarketplaceResourceReportEvidenceV3Schema =
  CreatorMarketplaceResourceReportEvidenceBaseSchema.extend({
    schemaVersion: z.literal(3),
    publisherId: z.string().trim().min(1).max(160),
    packageModerationRevision: z.number().int().min(0),
    /** Absolute package-head releaseOrdinal observed under the package advisory lock. */
    packageReportEpoch: z.number().int().min(1),
  }).strict();

export const CreatorMarketplaceResourceReportEvidenceSchema =
  z.discriminatedUnion("schemaVersion", [
    CreatorMarketplaceResourceReportEvidenceV1Schema,
    CreatorMarketplaceResourceReportEvidenceV2Schema,
    CreatorMarketplaceResourceReportEvidenceV3Schema,
  ]);

export type CreatorMarketplaceResourceReportEvidence = z.infer<
  typeof CreatorMarketplaceResourceReportEvidenceSchema
>;

export const CreatorMarketplaceResourceReportReceiptSchema = z
  .object({
    reported: z.literal(true),
    reportId: z.string().uuid(),
    status: z.literal("open"),
  })
  .strict();

export type CreatorMarketplaceResourceReportReceipt = z.infer<
  typeof CreatorMarketplaceResourceReportReceiptSchema
>;

export const CreatorMarketplaceCurrentPackageAvailabilitySchema =
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("available"),
      currentHead: z.object({ id: z.string().uuid() }).strict(),
    }).strict(),
    z.object({
      state: z.literal("unavailable"),
      reason: z.enum([
        "moderated",
        "owner-delisted",
        "publisher-unavailable",
      ]),
    }).strict(),
  ]);

export type CreatorMarketplaceCurrentPackageAvailability = z.infer<
  typeof CreatorMarketplaceCurrentPackageAvailabilitySchema
>;

export const CreatorMarketplaceResourceModerationQueueItemSchema = z
  .object({
    reportId: z.string().uuid(),
    reason: CreatorMarketplaceResourceReportReasonSchema,
    details: z
      .string()
      .max(CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS),
    status: CreatorMarketplaceResourceReportStatusSchema,
    resolutionNote: z
      .string()
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS),
    reporter: z
      .object({
        id: z.string().trim().min(1).max(160).nullable(),
        name: z.string().trim().min(1).max(120),
      })
      .strict(),
    reviewedBy: z.string().trim().min(1).max(160).nullable(),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    evidence: CreatorMarketplaceResourceReportEvidenceSchema,
    currentResource: z
      .object({
        id: z.string().uuid(),
        /** @deprecated Compatibility projection derived from currentPackage.state. */
        hidden: z.boolean(),
        delistedAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict()
      .nullable(),
    currentPackage: z
      .object({
        publisherId: z.string().trim().min(1).max(160),
        packageId: ResourceKeySchema,
        /** Absolute-head UUID used only as the package moderation action target. */
        moderationTargetId: z.string().uuid(),
        moderation: CreatorMarketplacePackageModerationSnapshotSchema,
        availability: CreatorMarketplaceCurrentPackageAvailabilitySchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.currentResource
      && item.currentPackage
      && item.currentResource.hidden
        !== (item.currentPackage.moderation.state === "hidden")
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentResource", "hidden"],
        message: "리소스 호환 숨김 값은 현재 패키지 상태에서 파생되어야 합니다.",
      });
    }
    if (!item.currentPackage) return;
    const moderated = item.currentPackage.moderation.state === "hidden";
    const availabilityModerated = item.currentPackage.availability.state === "unavailable"
      && item.currentPackage.availability.reason === "moderated";
    if (moderated !== availabilityModerated) {
      context.addIssue({
        code: "custom",
        path: ["currentPackage", "availability"],
        message: "패키지 중재 상태와 공개 가용성 사유가 일치해야 합니다.",
      });
    }
    if (
      item.currentPackage.availability.state === "available"
      && item.currentPackage.availability.currentHead.id
        !== item.currentPackage.moderationTargetId
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentPackage", "availability", "currentHead", "id"],
        message: "공개 head와 중재 대상 head가 일치해야 합니다.",
      });
    }
  });

export type CreatorMarketplaceResourceModerationQueueItem = z.infer<
  typeof CreatorMarketplaceResourceModerationQueueItemSchema
>;

export const CreatorMarketplaceResourceModerationQueuePageSchema = z
  .object({
    items: z
      .array(CreatorMarketplaceResourceModerationQueueItemSchema)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE),
    status: CreatorMarketplaceResourceReportStatusSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE),
    offset: z.number().int().min(0).max(1_000_000),
    hasMore: z.boolean(),
    nextOffset: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .strict();

export type CreatorMarketplaceResourceModerationQueuePage = z.infer<
  typeof CreatorMarketplaceResourceModerationQueuePageSchema
>;

export const CreatorMarketplaceResourceModerationReceiptSchema = z
  .object({
    moderated: z.literal(true),
    scope: z.literal("package"),
    action: CreatorMarketplaceResourceModerationActionSchema,
    changed: z.boolean(),
    hidden: z.boolean(),
    delisted: z.boolean(),
    reviewedReportCount: z.number().int().min(0),
    decisionId: z.string().uuid().nullable(),
    package: z
      .object({
        publisherId: z.string().trim().min(1).max(160),
        packageId: ResourceKeySchema,
        moderation: CreatorMarketplacePackageModerationSnapshotSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.hidden !== (receipt.package.moderation.state === "hidden")) {
      context.addIssue({
        code: "custom",
        path: ["hidden"],
        message: "응답 숨김 값은 패키지 중재 상태에서 파생되어야 합니다.",
      });
    }
    if (receipt.changed !== (receipt.decisionId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["decisionId"],
        message: "변경된 중재 응답에는 새 결정 식별자가 필요합니다.",
      });
    }
  });

export type CreatorMarketplaceResourceModerationReceipt = z.infer<
  typeof CreatorMarketplaceResourceModerationReceiptSchema
>;

export const CreatorMarketplaceOrphanReportDismissReceiptSchema = z
  .object({
    dismissed: z.literal(true),
    reportId: z.string().uuid(),
    dismissedReportCount: z.number().int().min(1),
  })
  .strict();

export type CreatorMarketplaceOrphanReportDismissReceipt = z.infer<
  typeof CreatorMarketplaceOrphanReportDismissReceiptSchema
>;

export function creatorMarketplaceJsonByteSize(value: unknown): number {
  const serialized = canonicalizeCreatorMarketplaceJson(value);
  return new TextEncoder().encode(serialized).byteLength;
}

export function canonicalizeCreatorMarketplaceJson(value: unknown): string {
  type PendingToken =
    | { type: "text"; value: string }
    | { type: "value"; value: unknown; depth: number };
  const pending: PendingToken[] = [{ type: "value", value, depth: 0 }];
  const serialized: string[] = [];
  const visitedObjects = new WeakSet<object>();
  let visited = 0;

  while (pending.length > 0) {
    const token = pending.pop()!;
    if (token.type === "text") {
      serialized.push(token.value);
      continue;
    }
    visited += 1;
    if (visited > 100_000 || token.depth > 64) {
      throw new TypeError("JSON canonicalization limits exceeded.");
    }
    if (token.value === null) {
      serialized.push("null");
      continue;
    }
    if (typeof token.value === "string" || typeof token.value === "boolean") {
      serialized.push(JSON.stringify(token.value));
      continue;
    }
    if (typeof token.value === "number") {
      if (!Number.isFinite(token.value)) {
        throw new TypeError("Only finite JSON numbers can be canonicalized.");
      }
      serialized.push(JSON.stringify(token.value));
      continue;
    }
    if (typeof token.value !== "object") {
      throw new TypeError("Only JSON values can be canonicalized.");
    }
    if (visitedObjects.has(token.value)) {
      throw new TypeError("Cyclic or shared object references cannot be canonicalized.");
    }
    visitedObjects.add(token.value);

    if (Array.isArray(token.value)) {
      pending.push({ type: "text", value: "]" });
      for (let index = token.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          type: "value",
          value: token.value[index],
          depth: token.depth + 1,
        });
        if (index > 0) pending.push({ type: "text", value: "," });
      }
      pending.push({ type: "text", value: "[" });
      continue;
    }
    if (!isPlainRecord(token.value)) {
      throw new TypeError("Only plain JSON objects can be canonicalized.");
    }

    const entries = Object.entries(token.value).sort(([left], [right]) =>
      left === right ? 0 : left < right ? -1 : 1
    );
    pending.push({ type: "text", value: "}" });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!;
      pending.push({
        type: "value",
        value: child,
        depth: token.depth + 1,
      });
      pending.push({ type: "text", value: ":" });
      pending.push({ type: "text", value: JSON.stringify(key) });
      if (index > 0) pending.push({ type: "text", value: "," });
    }
    pending.push({ type: "text", value: "{" });
  }
  return serialized.join("");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasPortableControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function inspectPortablePayload(
  payload: unknown
): { path: Array<string | number>; message: string } | null {
  const pending: Array<{
    value: unknown;
    path: Array<string | number>;
    depth: number;
  }> = [{ value: payload, path: [], depth: 0 }];
  const visitedObjects = new WeakSet<object>();
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > 4_096) {
      return { path: current.path, message: "portable JSON 항목 수가 너무 많습니다." };
    }
    if (current.depth > 12) {
      return { path: current.path, message: "portable JSON 중첩 깊이가 너무 큽니다." };
    }
    if (typeof current.value === "string") {
      if (
        current.value.length > 1_000 ||
        hasPortableControlCharacter(current.value) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(current.value.trim()) ||
        /^(?:\/\/|\\\\)/u.test(current.value.trim())
      ) {
        return {
          path: current.path,
          message: "portable JSON에는 제어문자, URI scheme, 원격 또는 protocol-relative 참조를 넣을 수 없습니다.",
        };
      }
      continue;
    }
    if (
      current.value === null ||
      typeof current.value === "boolean"
    ) continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        return { path: current.path, message: "portable JSON 숫자는 유한해야 합니다." };
      }
      continue;
    }
    if (typeof current.value !== "object") {
      return { path: current.path, message: "portable JSON 값 형식이 올바르지 않습니다." };
    }
    if (visitedObjects.has(current.value)) {
      return { path: current.path, message: "portable JSON에는 순환·공유 객체 참조를 넣을 수 없습니다." };
    }
    visitedObjects.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.value.length > 256) {
        return { path: current.path, message: "portable JSON 배열 항목이 너무 많습니다." };
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: [...current.path, index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!isPlainRecord(current.value)) {
      return { path: current.path, message: "portable JSON에는 일반 객체만 사용할 수 있습니다." };
    }

    for (const [key, child] of Object.entries(current.value)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(key)) {
        return {
          path: [...current.path, key],
          message: "portable JSON 키는 ASCII 식별자 형식이어야 합니다.",
        };
      }
      if (/^(?:data[-_]?url|base64|binary|blob|remote[-_]?url)$/iu.test(key)) {
        return {
          path: [...current.path, key],
          message: "portable JSON에는 바이너리 또는 원격 콘텐츠 필드를 넣을 수 없습니다.",
        };
      }
      pending.push({
        value: child,
        path: [...current.path, Array.isArray(current.value) ? Number(key) : key],
        depth: current.depth + 1,
      });
    }
  }
  return null;
}

function inspectKindDefinition(
  kind: CreatorMarketplaceResourceKind,
  definition: Record<string, CreatorMarketplaceJsonValue>
): { path: Array<string | number>; message: string } | null {
  const keys = Object.keys(definition).sort();
  const exactKeys = (...expected: string[]) =>
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index]);
  const stableId = (value: unknown) =>
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u.test(value);

  if (kind === "brush") {
    if (!exactKeys("snapshot") || !isPlainRecord(definition.snapshot) ||
      Object.keys(definition.snapshot).length === 0) {
      return {
        path: [],
        message: "브러시 definition은 비어 있지 않은 snapshot 객체 하나만 포함해야 합니다.",
      };
    }
    return null;
  }
  if (kind === "filter") {
    if (
      !exactKeys("engine", "values") ||
      !stableId(definition.engine) ||
      !isPlainRecord(definition.values) ||
      Object.keys(definition.values).length === 0
    ) {
      return {
        path: [],
        message: "필터 definition에는 engine과 비어 있지 않은 values 객체가 필요합니다.",
      };
    }
    return null;
  }
  if (kind === "palette") {
    if (!exactKeys("colors") || !Array.isArray(definition.colors) ||
      definition.colors.length < 1 || definition.colors.length > 64) {
      return { path: ["colors"], message: "팔레트에는 1~64개의 색상이 필요합니다." };
    }
    const colors = definition.colors;
    if (
      colors.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/u.test(color)) ||
      new Set(colors).size !== colors.length
    ) {
      return {
        path: ["colors"],
        message: "팔레트 색상은 중복 없는 소문자 #rrggbb 형식이어야 합니다.",
      };
    }
    return null;
  }
  if (kind === "template") {
    if (!exactKeys("templateId") || !stableId(definition.templateId)) {
      return {
        path: [],
        message: "템플릿 definition에는 안정적인 templateId 하나만 필요합니다.",
      };
    }
    return null;
  }
  if (
    !(
      exactKeys("recipeId") ||
      exactKeys("parameters", "recipeId")
    ) ||
    !stableId(definition.recipeId) ||
    (Object.hasOwn(definition, "parameters") && !isPlainRecord(definition.parameters))
  ) {
    return {
      path: [],
      message: "절차형 2D/3D definition에는 recipeId와 선택적 parameters 객체만 사용할 수 있습니다.",
    };
  }
  return null;
}
