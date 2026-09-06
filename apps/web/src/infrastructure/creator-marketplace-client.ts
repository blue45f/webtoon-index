import type {
  ConfirmCreatorMarketplaceStudioInstall,
  CreatorMarketplaceAcquisitionTarget,
  CreatorMarketplaceAcquireReceipt,
  CreatorMarketplaceArchiveReceipt,
  CreatorMarketplaceCloudLibraryPage,
  CreatorMarketplaceCloudLibraryView,
  CreatorMarketplaceStudioInstallConfirmationReceipt,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceOrphanReportDismissReceipt,
  CreatorMarketplaceOwnedHeadPage,
  CreatorMarketplaceOwnedHistoryPage,
  CreatorMarketplaceResourceModerationAction,
  CreatorMarketplaceResourceModerationQueuePage,
  CreatorMarketplaceResourceModerationReceipt,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceListPage,
  CreatorMarketplaceResourceManifest,
  CreatorMarketplaceResourceRecord,
  CreatorMarketplaceResourceReportReason,
  CreatorMarketplaceResourceReportReceipt,
  CreatorMarketplaceResourceReportStatus,
  CreatorMarketplaceResourceHistoryPage,
  CreatorMarketplaceResourceIdentity,
  CreatorMarketplaceResourceRelistReceipt,
  CreatorMarketplaceResourceSort,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { loadChunkWithReloadRecovery } from "@/shared/lib/chunk-load-recovery";
import {
  CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplacePortablePayloadSchema,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourceLicenseSchema,
  CreatorMarketplaceResourcePublisherQuerySchema,
  CreatorMarketplaceResourceSearchQuerySchema,
  CreatorMarketplaceResourceSortSchema,
  CreatorMarketplaceResourceTagQuerySchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "@/shared/lib/creator-marketplace-resource-contract";

const MEDIA_TYPE_BY_KIND = {
  asset: "application/vnd.toonspectrum.asset+json",
  brush: "application/vnd.toonspectrum.brush+json",
  filter: "application/vnd.toonspectrum.filter+json",
  palette: "application/vnd.toonspectrum.palette+json",
  template: "application/vnd.toonspectrum.template+json",
  "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
  "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
} as const;

export interface CreatorMarketplaceListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  tag?: string;
  kind?: CreatorMarketplaceResourceKind;
  license?: CreatorMarketplaceResourceLicense;
  publisher?: string;
  sort?: CreatorMarketplaceResourceSort;
}

export interface CreatorMarketplaceReportInput {
  readonly reason: CreatorMarketplaceResourceReportReason;
  readonly details?: string;
}

export interface CreatorMarketplaceModerationListParams {
  readonly status?: CreatorMarketplaceResourceReportStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreatorMarketplaceModerationInput {
  readonly action: CreatorMarketplaceResourceModerationAction;
  /** Queue-driven actions retain the exact report that initiated the package decision. */
  readonly sourceReportId?: string;
  readonly note: string;
}

export type CreatorMarketplaceOwnedHeadListParams = Omit<
  CreatorMarketplaceListParams,
  "publisher"
>;

export interface CreatorMarketplaceResourceHistoryParams {
  readonly limit?: number;
  readonly cursor?: number;
}

export interface CreatorMarketplaceOwnedHistoryParams
  extends CreatorMarketplaceResourceHistoryParams {
  readonly packageId: string;
}

export interface CreatorMarketplaceCloudLibraryListParams {
  readonly view?: CreatorMarketplaceCloudLibraryView;
  readonly limit?: number;
  readonly cursor?: string;
  readonly logicalPackId?: string;
}

export {
  CreatorMarketplaceReportError,
  creatorMarketplaceReportErrorCode,
} from "./creator-marketplace-report-error";

export class InvalidCreatorMarketplaceListQueryError extends TypeError {
  readonly field: keyof Pick<
    CreatorMarketplaceListParams,
    "search" | "tag" | "kind" | "license" | "publisher" | "sort"
  >;

  constructor(
    field: InvalidCreatorMarketplaceListQueryError["field"],
    message: string
  ) {
    super(message);
    this.name = "InvalidCreatorMarketplaceListQueryError";
    this.field = field;
  }
}

function invalidListQuery(
  field: InvalidCreatorMarketplaceListQueryError["field"],
  message: string
): never {
  throw new InvalidCreatorMarketplaceListQueryError(field, message);
}

/**
 * Keep every browser caller on the same query contract as the API. Invalid filters are rejected
 * instead of truncated or omitted, because either fallback could silently return a different list.
 */
export function normalizeCreatorMarketplaceListParams(
  params: CreatorMarketplaceListParams = {}
): CreatorMarketplaceListParams {
  const parsedSearch = params.search === undefined
    ? undefined
    : CreatorMarketplaceResourceSearchQuerySchema.safeParse(params.search);
  if (parsedSearch && !parsedSearch.success) {
    invalidListQuery(
      "search",
      `검색어는 ${CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS}자 이하여야 합니다.`
    );
  }

  const parsedTag = params.tag === undefined
    ? undefined
    : CreatorMarketplaceResourceTagQuerySchema.safeParse(params.tag);
  if (parsedTag && !parsedTag.success) {
    invalidListQuery(
      "tag",
      `태그는 ${CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS}자 이하여야 합니다.`
    );
  }

  const rawKind = typeof params.kind === "string" ? params.kind.trim() : params.kind;
  const parsedKind = rawKind === undefined
    ? undefined
    : CreatorMarketplaceResourceKindSchema.safeParse(rawKind);
  if (parsedKind && !parsedKind.success) {
    invalidListQuery("kind", "지원하지 않는 리소스 종류입니다.");
  }

  const rawLicense = typeof params.license === "string"
    ? params.license.trim()
    : params.license;
  const parsedLicense = rawLicense === undefined
    ? undefined
    : CreatorMarketplaceResourceLicenseSchema.safeParse(rawLicense);
  if (parsedLicense && !parsedLicense.success) {
    invalidListQuery("license", "지원하지 않는 라이선스입니다.");
  }

  const parsedPublisher = params.publisher === undefined
    ? undefined
    : CreatorMarketplaceResourcePublisherQuerySchema.safeParse(params.publisher);
  if (parsedPublisher && !parsedPublisher.success) {
    invalidListQuery("publisher", "배급자 식별자 형식이 올바르지 않습니다.");
  }

  const rawSort = typeof params.sort === "string" ? params.sort.trim() : params.sort;
  const parsedSort = rawSort === undefined
    ? undefined
    : CreatorMarketplaceResourceSortSchema.safeParse(rawSort);
  if (parsedSort && !parsedSort.success) {
    invalidListQuery("sort", "지원하지 않는 정렬 기준입니다.");
  }
  if (
    parsedSort?.success
    && parsedSort.data === "relevance"
    && !(parsedSearch?.success && parsedSearch.data)
  ) {
    invalidListQuery("sort", "관련도순 정렬에는 검색어가 필요합니다.");
  }

  return {
    limit: params.limit,
    cursor: params.cursor,
    search: parsedSearch?.success ? parsedSearch.data || undefined : undefined,
    tag: parsedTag?.success ? parsedTag.data || undefined : undefined,
    kind: parsedKind?.success ? parsedKind.data : undefined,
    license: parsedLicense?.success ? parsedLicense.data : undefined,
    publisher: parsedPublisher?.success
      ? parsedPublisher.data.toLowerCase()
      : undefined,
    sort: parsedSort?.success ? parsedSort.data : undefined,
  };
}

function loadCreatorMarketplaceNetworkClient() {
  return loadChunkWithReloadRecovery(
    () => import("./creator-marketplace-client-network"),
    "CreatorMarketplaceNetworkClient"
  );
}

async function creatorMarketplaceSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function createCreatorMarketplaceBuiltinDelivery(
  kind: keyof typeof CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND,
  runtimeRef: string
) {
  const expectedPrefix = CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND[kind];
  if (
    !runtimeRef.startsWith(expectedPrefix) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/u.test(
      runtimeRef.slice(expectedPrefix.length)
    )
  ) {
    throw new Error("지원되는 안정적인 built-in 참조가 아닙니다.");
  }
  return {
    mode: "builtin-ref" as const,
    runtimeRef,
    byteSize: 0 as const,
    sha256: await creatorMarketplaceSha256(
      canonicalizeCreatorMarketplaceJson({
        mode: "builtin-ref",
        runtimeRef,
      })
    ),
  };
}

export async function createCreatorMarketplacePortableDelivery(
  kind: CreatorMarketplaceResourceKind,
  definition: Record<string, CreatorMarketplaceJsonValue>
) {
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: kind,
    runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[kind],
    definition,
  };
  const validatedPayload = CreatorMarketplacePortablePayloadSchema.parse(payload);
  const canonical = canonicalizeCreatorMarketplaceJson(validatedPayload);
  return {
    mode:
      kind === "asset" || kind === "3d-preset" || kind === "3d-asset"
        ? ("procedural-recipe" as const)
        : ("portable-json" as const),
    mediaType: MEDIA_TYPE_BY_KIND[kind],
    payload: validatedPayload,
    byteSize: creatorMarketplaceJsonByteSize(validatedPayload),
    sha256: await creatorMarketplaceSha256(canonical),
  };
}

export async function listCreatorMarketplaceResources(
  params: CreatorMarketplaceListParams = {},
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceListPage> {
  const normalizedParams = normalizeCreatorMarketplaceListParams(params);
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listCreatorMarketplaceResources(normalizedParams, signal);
}

export async function getCreatorMarketplaceResource(
  id: string,
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceRecord> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.getCreatorMarketplaceResource(id, signal);
}

export async function getCreatorMarketplaceResourceIdentity(
  id: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceIdentity> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.getCreatorMarketplaceResourceIdentity(id, signal);
}

export async function listMyCreatorMarketplaceResources(
  params: CreatorMarketplaceListParams = {},
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceListPage> {
  const normalizedParams = normalizeCreatorMarketplaceListParams(params);
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listMyCreatorMarketplaceResources(normalizedParams, signal);
}

export async function publishCreatorMarketplaceResource(
  input: CreatorMarketplaceResourceManifest,
  signal?: AbortSignal
): Promise<CreatorMarketplaceResourceRecord> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.publishCreatorMarketplaceResource(input, signal);
}

export async function deleteCreatorMarketplaceResource(id: string): Promise<void> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.deleteCreatorMarketplaceResource(id);
}

export async function reportCreatorMarketplaceResource(
  id: string,
  input: CreatorMarketplaceReportInput,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceReportReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.reportCreatorMarketplaceResource(id, input, signal);
}

export async function listCreatorMarketplaceModerationQueue(
  params: CreatorMarketplaceModerationListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceModerationQueuePage> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listCreatorMarketplaceModerationQueue(params, signal);
}

export async function moderateCreatorMarketplaceResource(
  id: string,
  input: CreatorMarketplaceModerationInput,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceModerationReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.moderateCreatorMarketplaceResource(id, input, signal);
}

export async function dismissOrphanedReport(
  reportId: string,
  note: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOrphanReportDismissReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.dismissOrphanedReport(reportId, note, signal);
}

export async function listCreatorMarketplaceOwnedHeads(
  params: CreatorMarketplaceOwnedHeadListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOwnedHeadPage> {
  const { publisher: _publisher, ...normalized } =
    normalizeCreatorMarketplaceListParams(params);
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listCreatorMarketplaceOwnedHeads(normalized, signal);
}

export async function listCreatorMarketplaceOwnedHistory(
  params: CreatorMarketplaceOwnedHistoryParams,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceOwnedHistoryPage> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listCreatorMarketplaceOwnedHistory(params, signal);
}

export async function getCreatorMarketplaceResourceHistory(
  id: string,
  params: CreatorMarketplaceResourceHistoryParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceHistoryPage> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.getCreatorMarketplaceResourceHistory(id, params, signal);
}

export async function relistCreatorMarketplaceResource(
  id: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceResourceRelistReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.relistCreatorMarketplaceResource(id, signal);
}

export async function listCreatorMarketplaceCloudLibrary(
  params: CreatorMarketplaceCloudLibraryListParams = {},
  signal?: AbortSignal,
): Promise<CreatorMarketplaceCloudLibraryPage> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.listCreatorMarketplaceCloudLibrary(params, signal);
}

export async function acquireCreatorMarketplaceCloudLibraryRelease(
  releaseId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceAcquireReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.acquireCreatorMarketplaceCloudLibraryRelease(releaseId, signal);
}

export async function resolveCreatorMarketplaceCloudLibraryAcquisitionTarget(
  releaseId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceAcquisitionTarget> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.resolveCreatorMarketplaceCloudLibraryAcquisitionTarget(
    releaseId,
    signal,
  );
}

export async function confirmCreatorMarketplaceStudioInstall(
  releaseId: string,
  input: ConfirmCreatorMarketplaceStudioInstall,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceStudioInstallConfirmationReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.confirmCreatorMarketplaceStudioInstall(releaseId, input, signal);
}

export async function setCreatorMarketplaceCloudLibraryArchived(
  libraryItemId: string,
  archived: boolean,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceArchiveReceipt> {
  const client = await loadCreatorMarketplaceNetworkClient();
  return client.setCreatorMarketplaceCloudLibraryArchived(
    libraryItemId,
    archived,
    signal,
  );
}
