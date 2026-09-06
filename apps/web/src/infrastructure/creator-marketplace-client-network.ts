import { z } from "zod";

import {
  CreatorMarketplaceReportError,
  creatorMarketplaceReportErrorCode,
} from "./creator-marketplace-report-error";

import type {
  CreatorMarketplaceCloudLibraryListParams,
  CreatorMarketplaceModerationInput,
  CreatorMarketplaceModerationListParams,
  CreatorMarketplaceListParams,
  CreatorMarketplaceOwnedHeadListParams,
  CreatorMarketplaceOwnedHistoryParams,
  CreatorMarketplaceReportInput,
  CreatorMarketplaceResourceHistoryParams,
} from "./creator-marketplace-client";
import type {
  ConfirmCreatorMarketplaceStudioInstall,
  CreatorMarketplaceAcquisitionTarget,
  CreatorMarketplaceAcquireReceipt,
  CreatorMarketplaceArchiveReceipt,
  CreatorMarketplaceCloudLibraryPage,
  CreatorMarketplaceStudioInstallConfirmationReceipt,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import type {
  CreatorMarketplaceResourceModerationQueuePage,
  CreatorMarketplaceResourceModerationReceipt,
  CreatorMarketplaceOrphanReportDismissReceipt,
  CreatorMarketplaceOwnedHeadPage,
  CreatorMarketplaceOwnedHistoryPage,
  CreatorMarketplaceResourceListPage,
  CreatorMarketplaceResourceManifest,
  CreatorMarketplaceResourceRecord,
  CreatorMarketplaceResourceHistoryPage,
  CreatorMarketplaceResourceIdentity,
  CreatorMarketplaceResourceRelistReceipt,
  CreatorMarketplaceResourceReportReceipt,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE,
  CreatorMarketplaceAcquireReceiptSchema,
  CreatorMarketplaceAcquisitionTargetSchema,
  CreatorMarketplaceArchiveReceiptSchema,
  CreatorMarketplaceCloudLibraryPageSchema,
  CreatorMarketplaceCloudLibraryViewSchema,
  CreatorMarketplaceLogicalPackIdSchema,
  CreatorMarketplaceStudioInstallConfirmationReceiptSchema,
  ConfirmCreatorMarketplaceStudioInstallSchema,
  SetCreatorMarketplaceLibraryArchiveSchema,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import {
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE,
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL,
  CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE,
  CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS,
  CreatorMarketplaceResourceModerationActionSchema,
  CreatorMarketplaceResourceModerationQueuePageSchema,
  CreatorMarketplaceResourceModerationReceiptSchema,
  CreatorMarketplaceOrphanReportDismissReceiptSchema,
  CreatorMarketplaceOwnedHeadPageSchema,
  CreatorMarketplaceOwnedHistoryPageSchema,
  CreatorMarketplaceResourceListPageSchema,
  CreatorMarketplaceResourceManifestSchema,
  CreatorMarketplaceResourceRecordSchema,
  CreatorMarketplaceResourceHistoryPageSchema,
  CreatorMarketplaceResourceIdentitySchema,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourceLicenseSchema,
  CreatorMarketplaceResourcePackageIdSchema,
  CreatorMarketplaceResourceSearchQuerySchema,
  CreatorMarketplaceResourceSortSchema,
  CreatorMarketplaceResourceTagQuerySchema,
  CreatorMarketplaceResourceRelistReceiptSchema,
  CreatorMarketplaceResourceReportReasonSchema,
  CreatorMarketplaceResourceReportReceiptSchema,
  CreatorMarketplaceResourceReportStatusSchema,
} from "@/shared/lib/creator-marketplace-resource-contract";
import { api, getApiErrorMessage, toApiError } from "@/src/infrastructure/api";
import { NotFoundError } from "@/src/infrastructure/use-api-resource";

const BASE = "/creator/marketplace/resources";
const LIBRARY_BASE = "/creator/marketplace/library";

const CreatorMarketplaceResourceIdSchema = z.string().uuid();
const CreatorMarketplaceReportInputSchema = z
  .object({
    reason: CreatorMarketplaceResourceReportReasonSchema,
    details: z
      .string()
      .trim()
      .max(CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS)
      .default(""),
  })
  .strict();
const CreatorMarketplaceModerationListParamsSchema = z
  .object({
    status: CreatorMarketplaceResourceReportStatusSchema.default("open"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE)
      .default(CREATOR_MARKETPLACE_RESOURCE_MODERATION_MAX_PAGE_SIZE),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const CreatorMarketplaceModerationInputSchema = z
  .object({
    action: CreatorMarketplaceResourceModerationActionSchema,
    sourceReportId: CreatorMarketplaceResourceIdSchema.optional(),
    note: z
      .string()
      .trim()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS),
  })
  .strict();
const CreatorMarketplaceOrphanReportDismissInputSchema = z
  .object({
    action: z.literal("dismiss"),
    note: z
      .string()
      .trim()
      .min(1)
      .max(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS),
  })
  .strict();
const CreatorMarketplaceResourceHistoryParamsSchema = z
  .object({
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE)
      .default(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE),
    cursor: z.number().int().min(1).max(CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL)
      .optional(),
  })
  .strict();
const CreatorMarketplaceOwnedHeadListParamsSchema = z
  .object({
    limit: z.number().int().min(1).max(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE)
      .optional(),
    cursor: z.string().min(1).max(CREATOR_MARKETPLACE_RESOURCE_CURSOR_MAX_CHARACTERS)
      .regex(/^[A-Za-z0-9_-]+$/u).optional(),
    search: CreatorMarketplaceResourceSearchQuerySchema.optional(),
    tag: CreatorMarketplaceResourceTagQuerySchema.optional(),
    kind: CreatorMarketplaceResourceKindSchema.optional(),
    license: CreatorMarketplaceResourceLicenseSchema.optional(),
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
const CreatorMarketplaceOwnedHistoryParamsSchema =
  CreatorMarketplaceResourceHistoryParamsSchema.extend({
    packageId: CreatorMarketplaceResourcePackageIdSchema,
  }).strict();
const CreatorMarketplaceCloudLibraryListParamsSchema = z
  .object({
    view: CreatorMarketplaceCloudLibraryViewSchema.default("active"),
    limit: z.number().int().min(1).max(
      CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE,
    ).default(CREATOR_MARKETPLACE_CLOUD_LIBRARY_MAX_PAGE_SIZE),
    cursor: z.string().min(1).max(
      CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS,
    ).regex(/^[A-Za-z0-9_-]+$/u).optional(),
    logicalPackId: CreatorMarketplaceLogicalPackIdSchema.optional(),
  })
  .strict();

export async function listCreatorMarketplaceResources(
  params: CreatorMarketplaceListParams = {},
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceListPage> {
  try {
    const response = await api.get<unknown>(BASE, {
      params: {
        limit: params.limit,
        cursor: params.cursor,
        search: params.search,
        tag: params.tag,
        kind: params.kind,
        license: params.license,
        publisher: params.publisher,
        sort: params.sort,
      },
      signal,
    });
    return CreatorMarketplaceResourceListPageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "공유 리소스 마켓을 불러오지 못했습니다.");
  }
}

export async function listMyCreatorMarketplaceResources(
  params: CreatorMarketplaceListParams = {},
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceListPage> {
  try {
    const response = await api.get<unknown>(`${BASE}/mine`, {
      params: {
        limit: params.limit,
        cursor: params.cursor,
        search: params.search,
        tag: params.tag,
        kind: params.kind,
        license: params.license,
        sort: params.sort,
      },
      signal,
    });
    return CreatorMarketplaceResourceListPageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "내 공유 리소스를 불러오지 못했습니다.");
  }
}

export async function getCreatorMarketplaceResource(
  id: string,
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceRecord> {
  try {
    const response = await api.get<unknown>(
      `${BASE}/${encodeURIComponent(id)}`,
      { signal }
    );
    return CreatorMarketplaceResourceRecordSchema.parse(response);
  } catch (error) {
    // 404는 흐름 제어(notFound)로 다룬다 — useApiResource 계약과 동일.
    // ky HTTPError는 response.status를 노출하므로 instanceof 대신 형태로 판별한다.
    if (
      error && typeof error === "object"
      && "response" in error
      && (error as { response?: { status?: number } }).response?.status === 404
    ) {
      throw new NotFoundError();
    }
    throw await toApiError(error, "공유 리소스를 불러오지 못했습니다.");
  }
}

export async function getCreatorMarketplaceResourceIdentity(
  id: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceIdentity> {
  const resourceId = CreatorMarketplaceResourceIdSchema.parse(id);
  try {
    const response = await api.get<unknown>(
      `${BASE}/identity/${encodeURIComponent(resourceId)}`,
      { signal },
    );
    return CreatorMarketplaceResourceIdentitySchema.parse(response);
  } catch (error) {
    if (
      error && typeof error === "object"
      && "response" in error
      && (error as { response?: { status?: number } }).response?.status === 404
    ) {
      throw new NotFoundError();
    }
    throw await toApiError(error, "마켓 릴리스 식별자를 확인하지 못했습니다.");
  }
}

export async function publishCreatorMarketplaceResource(
  input: CreatorMarketplaceResourceManifest,
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceRecord> {
  const manifest = CreatorMarketplaceResourceManifestSchema.parse(input);
  try {
    const response = await api.post<unknown>(BASE, manifest, { signal });
    return CreatorMarketplaceResourceRecordSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "리소스 패키지를 공유하지 못했습니다.");
  }
}

export async function deleteCreatorMarketplaceResource(id: string): Promise<void> {
  try {
    await api.delete(`${BASE}/${encodeURIComponent(id)}`);
  } catch (error) {
    throw await toApiError(error, "공유 리소스를 마켓 목록에서 내리지 못했습니다.");
  }
}

export async function reportCreatorMarketplaceResource(
  id: string,
  input: CreatorMarketplaceReportInput,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceReportReceipt> {
  const resourceId = CreatorMarketplaceResourceIdSchema.parse(id);
  const body = CreatorMarketplaceReportInputSchema.parse(input);
  try {
    const response = await api.post<unknown>(
      `${BASE}/${encodeURIComponent(resourceId)}/report`,
      body,
      { signal },
    );
    return CreatorMarketplaceResourceReportReceiptSchema.parse(response);
  } catch (error) {
    const code = creatorMarketplaceReportErrorCode(error);
    const message = await getApiErrorMessage(
      error,
      "마켓 리소스를 신고하지 못했습니다.",
    );
    throw new CreatorMarketplaceReportError(code, message, error);
  }
}

export async function listCreatorMarketplaceModerationQueue(
  params: CreatorMarketplaceModerationListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceModerationQueuePage> {
  const query = CreatorMarketplaceModerationListParamsSchema.parse(params);
  try {
    const response = await api.get<unknown>(`${BASE}/moderation`, {
      params: query,
      signal,
    });
    return CreatorMarketplaceResourceModerationQueuePageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "마켓 신고 검수 목록을 불러오지 못했습니다.");
  }
}

export async function moderateCreatorMarketplaceResource(
  id: string,
  input: CreatorMarketplaceModerationInput,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceModerationReceipt> {
  const resourceId = CreatorMarketplaceResourceIdSchema.parse(id);
  const body = CreatorMarketplaceModerationInputSchema.parse(input);
  try {
    const response = await api.patch<unknown>(
      `${BASE}/${encodeURIComponent(resourceId)}/moderation`,
      body,
      { signal },
    );
    return CreatorMarketplaceResourceModerationReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "마켓 리소스 검수 상태를 변경하지 못했습니다.");
  }
}

export async function dismissOrphanedReport(
  reportId: string,
  note: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOrphanReportDismissReceipt> {
  const normalizedReportId = CreatorMarketplaceResourceIdSchema.parse(reportId);
  const body = CreatorMarketplaceOrphanReportDismissInputSchema.parse({
    action: "dismiss",
    note,
  });
  try {
    const response = await api.patch<unknown>(
      `${BASE}/moderation/reports/${encodeURIComponent(normalizedReportId)}`,
      body,
      { signal },
    );
    return CreatorMarketplaceOrphanReportDismissReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "원본이 없는 마켓 신고를 종결하지 못했습니다.");
  }
}

export async function listCreatorMarketplaceOwnedHeads(
  params: CreatorMarketplaceOwnedHeadListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOwnedHeadPage> {
  const query = CreatorMarketplaceOwnedHeadListParamsSchema.parse(params);
  try {
    const response = await api.get<unknown>(`${BASE}/mine/heads`, {
      params: {
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        tag: query.tag,
        kind: query.kind,
        license: query.license,
        sort: query.sort,
      },
      signal,
    });
    return CreatorMarketplaceOwnedHeadPageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "내 마켓 패키지 상태를 불러오지 못했습니다.");
  }
}

export async function listCreatorMarketplaceOwnedHistory(
  params: CreatorMarketplaceOwnedHistoryParams,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOwnedHistoryPage> {
  const query = CreatorMarketplaceOwnedHistoryParamsSchema.parse(params);
  try {
    const response = await api.get<unknown>(`${BASE}/mine/history`, {
      params: query,
      signal,
    });
    return CreatorMarketplaceOwnedHistoryPageSchema.parse(response);
  } catch (error) {
    if (
      error && typeof error === "object"
      && "response" in error
      && (error as { response?: { status?: number } }).response?.status === 404
    ) {
      throw new NotFoundError();
    }
    throw await toApiError(error, "내 마켓 패키지 릴리스 이력을 불러오지 못했습니다.");
  }
}

export async function getCreatorMarketplaceResourceHistory(
  id: string,
  params: CreatorMarketplaceResourceHistoryParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceHistoryPage> {
  const resourceId = CreatorMarketplaceResourceIdSchema.parse(id);
  const query = CreatorMarketplaceResourceHistoryParamsSchema.parse(params);
  try {
    const response = await api.get<unknown>(
      `${BASE}/history/${encodeURIComponent(resourceId)}`,
      { params: query, signal },
    );
    return CreatorMarketplaceResourceHistoryPageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "마켓 릴리스 이력을 불러오지 못했습니다.");
  }
}

export async function relistCreatorMarketplaceResource(
  id: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceRelistReceipt> {
  const resourceId = CreatorMarketplaceResourceIdSchema.parse(id);
  try {
    const response = await api.post<unknown>(
      `${BASE}/${encodeURIComponent(resourceId)}/relist`,
      undefined,
      { signal },
    );
    return CreatorMarketplaceResourceRelistReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "마켓 리소스를 다시 등록하지 못했습니다.");
  }
}

export async function listCreatorMarketplaceCloudLibrary(
  params: CreatorMarketplaceCloudLibraryListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceCloudLibraryPage> {
  const query = CreatorMarketplaceCloudLibraryListParamsSchema.parse(params);
  try {
    const response = await api.get<unknown>(LIBRARY_BASE, {
      params: {
        view: query.view,
        limit: query.limit,
        cursor: query.cursor,
        logicalPackId: query.logicalPackId,
      },
      signal,
    });
    return CreatorMarketplaceCloudLibraryPageSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "계정 마켓 라이브러리를 불러오지 못했습니다.");
  }
}

export async function acquireCreatorMarketplaceCloudLibraryRelease(
  releaseId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceAcquireReceipt> {
  const normalizedReleaseId = CreatorMarketplaceResourceIdSchema.parse(releaseId);
  try {
    const response = await api.post<unknown>(
      `${LIBRARY_BASE}/acquisitions/${encodeURIComponent(normalizedReleaseId)}`,
      undefined,
      { signal },
    );
    return CreatorMarketplaceAcquireReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "계정 마켓 라이브러리에 추가하지 못했습니다.");
  }
}

export async function resolveCreatorMarketplaceCloudLibraryAcquisitionTarget(
  releaseId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceAcquisitionTarget> {
  const id = CreatorMarketplaceResourceIdSchema.parse(releaseId);
  try {
    const response = await api.get<unknown>(
      `${LIBRARY_BASE}/acquisition-target/${encodeURIComponent(id)}`,
      { signal },
    );
    return CreatorMarketplaceAcquisitionTargetSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "계정 라이브러리에 추가할 현재 릴리스를 확인하지 못했습니다.");
  }
}

export async function confirmCreatorMarketplaceStudioInstall(
  releaseId: string,
  input: ConfirmCreatorMarketplaceStudioInstall,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceStudioInstallConfirmationReceipt> {
  const normalizedReleaseId = CreatorMarketplaceResourceIdSchema.parse(releaseId);
  const body = ConfirmCreatorMarketplaceStudioInstallSchema.parse(input);
  try {
    const response = await api.post<unknown>(
      `${LIBRARY_BASE}/install-confirmations/${encodeURIComponent(normalizedReleaseId)}`,
      body,
      { signal },
    );
    return CreatorMarketplaceStudioInstallConfirmationReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(error, "계정 라이브러리에 Studio 설치를 확인하지 못했습니다.");
  }
}

export async function setCreatorMarketplaceCloudLibraryArchived(
  libraryItemId: string,
  archived: boolean,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceArchiveReceipt> {
  const normalizedLibraryItemId = CreatorMarketplaceResourceIdSchema.parse(libraryItemId);
  const body = SetCreatorMarketplaceLibraryArchiveSchema.parse({ archived });
  try {
    const response = await api.patch<unknown>(
      `${LIBRARY_BASE}/${encodeURIComponent(normalizedLibraryItemId)}`,
      body,
      { signal },
    );
    return CreatorMarketplaceArchiveReceiptSchema.parse(response);
  } catch (error) {
    throw await toApiError(
      error,
      archived
        ? "계정 마켓 라이브러리 항목을 보관하지 못했습니다."
        : "계정 마켓 라이브러리 항목을 복원하지 못했습니다.",
    );
  }
}
