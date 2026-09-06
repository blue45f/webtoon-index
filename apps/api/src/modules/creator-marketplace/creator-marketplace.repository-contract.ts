import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceManifest,
  CreatorMarketplacePackageModerationState,
  CreatorMarketplaceResourceModerationAction,
  CreatorMarketplaceResourceReportEvidence,
  CreatorMarketplaceResourceReportReason,
  CreatorMarketplaceResourceReportStatus,
  CreatorMarketplaceResourceSort,
  CreatorMarketplaceStoredResourceManifest,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

export const CREATOR_MARKETPLACE_RESOURCE_REPOSITORY = Symbol(
  "CREATOR_MARKETPLACE_RESOURCE_REPOSITORY"
);

export type CreatorMarketplaceResourceCursor =
  | {
      sort: "newest";
      createdAt: Date;
      id: string;
    }
  | {
      sort: "relevance";
      relevanceScore: number;
      createdAt: Date;
      id: string;
    };

export interface CreatorMarketplaceResourceListInput {
  publisherId?: string;
  viewerId?: string;
  limit: number;
  cursor: CreatorMarketplaceResourceCursor | null;
  sort: CreatorMarketplaceResourceSort;
  search?: string;
  tag?: string;
  kind?: CreatorMarketplaceResourceKind;
  license?: CreatorMarketplaceResourceLicense;
}

export interface CreatorMarketplaceOwnedHeadListInput
  extends Omit<
    CreatorMarketplaceResourceListInput,
    "publisherId" | "viewerId"
  > {
  publisherId: string;
}

export interface CreatorMarketplaceResourceStoredRow {
  id: string;
  publisherId: string;
  publisherName: string | null;
  publisherAvatar: string | null;
  manifest: CreatorMarketplaceStoredResourceManifest;
  manifestHash: string;
  manifestByteSize: number;
  createdAt: Date;
  updatedAt: Date;
  /** Internal keyset value. It is selected only for relevance-sorted list rows. */
  relevanceScore?: number;
}

export interface CreatorMarketplaceLifecycleStoredRow
  extends CreatorMarketplaceResourceStoredRow {
  releaseOrdinal: number;
  /** @deprecated Compatibility value derived from packageState. */
  hidden: boolean;
  delistedAt: Date | null;
  packageState: CreatorMarketplacePackageModerationState;
  packageRevision: number;
  packageHiddenAt: Date | null;
}

/** Payload-free exact identity projection for legacy local-install reconciliation. */
export interface CreatorMarketplaceResourceIdentityStoredRow {
  id: string;
  publisherId: string;
  packageId: string;
  kind: CreatorMarketplaceResourceKind;
  releaseDelistedAt: Date | null;
  currentHeadDelistedAt: Date | null;
  packageState: CreatorMarketplacePackageModerationState;
  publisherStatus: string | null;
}

export interface CreatorMarketplacePackageHistoryInput {
  publisherId: string;
  packageId: string;
  limit: number;
  cursor: number | null;
}

export interface CreatorMarketplaceRelistResult {
  id: string;
  changed: boolean;
}

export interface CreatorMarketplaceResourcePublishInput {
  id: string;
  publisherId: string;
  manifest: CreatorMarketplaceResourceManifest;
  manifestHash: string;
  manifestByteSize: number;
}

export interface CreatorMarketplaceResourceReportInput {
  id: string;
  resourceId: string;
  reporterId: string;
  reporterKeyHash: Uint8Array;
  reason: CreatorMarketplaceResourceReportReason;
  details: string;
}

export interface CreatorMarketplaceResourceReportResult {
  reportId: string;
  createdAt: Date;
}

export interface CreatorMarketplaceModerationListInput {
  status: CreatorMarketplaceResourceReportStatus;
  limit: number;
  offset: number;
}

export interface CreatorMarketplaceModerationStoredRow {
  reportId: string;
  reason: CreatorMarketplaceResourceReportReason;
  details: string;
  status: CreatorMarketplaceResourceReportStatus;
  resolutionNote: string;
  reporterId: string | null;
  reporterName: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  evidence: CreatorMarketplaceResourceReportEvidence;
  packagePublisherIdSnapshot: string | null;
  packageIdSnapshot: string | null;
  packageModerationRevision: number | null;
  packageReportEpoch: number | null;
  currentResourceId: string | null;
  currentResourceHidden: boolean | null;
  currentResourceDelistedAt: Date | null;
  currentPackagePublisherId: string | null;
  currentPackageId: string | null;
  currentPackageState: CreatorMarketplacePackageModerationState | null;
  currentPackageRevision: number | null;
  currentPackageHiddenAt: Date | null;
  currentPackageHeadId: string | null;
  currentPackageHeadDelistedAt: Date | null;
  currentPackagePublisherStatus: string | null;
}

export interface CreatorMarketplaceModerationInput {
  resourceId: string;
  reviewerId: string;
  action: CreatorMarketplaceResourceModerationAction;
  note: string;
  sourceReportId?: string;
}

export interface CreatorMarketplaceModerationResult {
  publisherId: string;
  packageId: string;
  packageState: CreatorMarketplacePackageModerationState;
  packageRevision: number;
  packageHiddenAt: Date | null;
  changed: boolean;
  decisionId: string | null;
  hidden: boolean;
  delisted: boolean;
  reviewedReportCount: number;
}

export interface CreatorMarketplaceOrphanReportDismissInput {
  reportId: string;
  reviewerId: string;
  note: string;
}

export interface CreatorMarketplaceOrphanReportDismissResult {
  reportId: string;
  dismissedReportCount: number;
}

export interface CreatorMarketplaceResourceRepository {
  list(
    input: CreatorMarketplaceResourceListInput
  ): Promise<readonly CreatorMarketplaceResourceStoredRow[]>;
  findById(id: string): Promise<CreatorMarketplaceResourceStoredRow | null>;
  findIdentityById(
    id: string
  ): Promise<CreatorMarketplaceResourceIdentityStoredRow | null>;
  findHistoryAnchor(
    id: string
  ): Promise<CreatorMarketplaceLifecycleStoredRow | null>;
  listPublicHistory(
    input: CreatorMarketplacePackageHistoryInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]>;
  listOwnedHeads(
    input: CreatorMarketplaceOwnedHeadListInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]>;
  findOwnedPackageHead(
    publisherId: string,
    packageId: string
  ): Promise<CreatorMarketplaceLifecycleStoredRow | null>;
  listOwnedPackageHistory(
    input: CreatorMarketplacePackageHistoryInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]>;
  publish(
    input: CreatorMarketplaceResourcePublishInput
  ): Promise<CreatorMarketplaceResourceStoredRow>;
  deleteOwned(publisherId: string, id: string): Promise<boolean>;
  relistOwned(
    publisherId: string,
    id: string
  ): Promise<CreatorMarketplaceRelistResult | null>;
  report(
    input: CreatorMarketplaceResourceReportInput
  ): Promise<CreatorMarketplaceResourceReportResult>;
  listModeration(
    input: CreatorMarketplaceModerationListInput
  ): Promise<readonly CreatorMarketplaceModerationStoredRow[]>;
  moderate(
    input: CreatorMarketplaceModerationInput
  ): Promise<CreatorMarketplaceModerationResult | null>;
  dismissOrphanReport(
    input: CreatorMarketplaceOrphanReportDismissInput
  ): Promise<CreatorMarketplaceOrphanReportDismissResult | null>;
}

export class CreatorMarketplaceResourceDuplicateError extends Error {
  constructor() {
    super("creator_marketplace_resource_duplicate");
    this.name = "CreatorMarketplaceResourceDuplicateError";
  }
}

export class CreatorMarketplaceResourceReleaseRejectedError extends Error {
  constructor(
    readonly reason: "downgrade" | "equivocation" | "moderated",
    readonly latestVersion: string,
  ) {
    super(`creator_marketplace_resource_release_${reason}`);
    this.name = "CreatorMarketplaceResourceReleaseRejectedError";
  }
}

export class CreatorMarketplaceResourceReportRejectedError extends Error {
  constructor(
    readonly reason: "duplicate" | "not-found" | "rate-limited" | "self-report",
  ) {
    super(`creator_marketplace_resource_report_${reason}`);
    this.name = "CreatorMarketplaceResourceReportRejectedError";
  }
}

export class CreatorMarketplaceResourceRelistRejectedError extends Error {
  constructor(readonly reason: "moderated" | "non-head") {
    super(`creator_marketplace_resource_relist_${reason}`);
    this.name = "CreatorMarketplaceResourceRelistRejectedError";
  }
}

export class CreatorMarketplaceModerationRejectedError extends Error {
  constructor(readonly reason: "source-report") {
    super(`creator_marketplace_moderation_${reason}`);
    this.name = "CreatorMarketplaceModerationRejectedError";
  }
}

export class CreatorMarketplaceOrphanReportDismissRejectedError extends Error {
  constructor(readonly reason: "attached" | "closed") {
    super(`creator_marketplace_orphan_report_dismiss_${reason}`);
    this.name = "CreatorMarketplaceOrphanReportDismissRejectedError";
  }
}
