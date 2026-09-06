import type {
  ConfirmCreatorMarketplaceStudioInstall,
  CreatorMarketplaceCloudLibraryView,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";
import type {
  CreatorMarketplaceResourceKind,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

export const CREATOR_MARKETPLACE_LIBRARY_REPOSITORY = Symbol(
  "CREATOR_MARKETPLACE_LIBRARY_REPOSITORY",
);

export interface CreatorMarketplaceLibraryCursor {
  readonly addedAt: Date;
  readonly id: string;
}

export interface CreatorMarketplaceLibraryListInput {
  readonly userId: string;
  readonly view: CreatorMarketplaceCloudLibraryView;
  readonly logicalPackId?: string;
  readonly packageKeyHash?: Uint8Array;
  readonly limit: number;
  readonly cursor: CreatorMarketplaceLibraryCursor | null;
}

export interface CreatorMarketplaceLibraryStoredRow {
  readonly id: string;
  readonly userId: string;
  readonly packageKeyHash: Uint8Array;
  readonly publisherId: string | null;
  readonly packageId: string;
  readonly kind: CreatorMarketplaceResourceKind;
  readonly nameSnapshot: string;
  readonly addedFromReleaseId: string | null;
  readonly addedFromResourceVersion: string;
  readonly addedFromReleaseOrdinal: number;
  readonly addedFromManifestHash: string;
  readonly addedAt: Date;
  readonly archivedAt: Date | null;
  readonly lastConfirmedReleaseId: string | null;
  readonly lastConfirmedResourceVersion: string | null;
  readonly lastConfirmedReleaseOrdinal: number | null;
  readonly lastConfirmedManifestHash: string | null;
  readonly firstConfirmedAt: Date | null;
  readonly lastConfirmedAt: Date | null;
  readonly updatedAt: Date;
}

export interface CreatorMarketplaceLibraryCatalogHeadRow {
  readonly id: string;
  readonly publisherId: string;
  readonly packageId: string;
  readonly name: string;
  readonly kind: CreatorMarketplaceResourceKind;
  readonly resourceVersion: string;
  readonly minimumStudioVersion: string;
  readonly releaseOrdinal: number;
  readonly manifestHash: string;
  /** Compatibility projection derived from package moderation state, never from release.hidden. */
  readonly hidden: boolean;
  readonly delistedAt: Date | null;
  readonly publisherStatus: string | null;
}

export interface CreatorMarketplaceLibraryListResult {
  readonly rows: readonly CreatorMarketplaceLibraryStoredRow[];
  readonly catalogHeads: readonly CreatorMarketplaceLibraryCatalogHeadRow[];
}

export interface CreatorMarketplaceLibraryMutationResult {
  readonly row: CreatorMarketplaceLibraryStoredRow;
  readonly changed: boolean;
}

export interface CreatorMarketplaceAcquisitionTargetStoredRow {
  readonly requestReleaseId: string;
  readonly publisherId: string;
  readonly packageId: string;
  readonly kind: CreatorMarketplaceResourceKind;
  readonly packageState: "active" | "hidden";
  readonly publisherStatus: string | null;
  readonly requestReleaseDelistedAt: Date | null;
  readonly currentHeadId: string;
  readonly currentHeadKind: CreatorMarketplaceResourceKind;
  readonly currentHeadResourceVersion: string;
  readonly currentHeadDelistedAt: Date | null;
}

export interface CreatorMarketplaceCloudLibraryRepository {
  resolveAcquisitionTarget(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceAcquisitionTargetStoredRow>;
  acquire(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceLibraryMutationResult>;
  confirmStudioInstall(
    userId: string,
    releaseId: string,
    input: ConfirmCreatorMarketplaceStudioInstall,
  ): Promise<CreatorMarketplaceLibraryMutationResult>;
  setArchived(
    userId: string,
    libraryItemId: string,
    archived: boolean,
  ): Promise<CreatorMarketplaceLibraryMutationResult | null>;
  list(
    input: CreatorMarketplaceLibraryListInput,
  ): Promise<CreatorMarketplaceLibraryListResult>;
}

export class CreatorMarketplaceLibraryInactiveUserError extends Error {
  constructor() {
    super("creator_marketplace_library_inactive_user");
    this.name = "CreatorMarketplaceLibraryInactiveUserError";
  }
}

export class CreatorMarketplaceLibraryAcquisitionRejectedError extends Error {
  constructor(
    readonly reason:
      | "not-found"
      | "moderated"
      | "owner-delisted"
      | "publisher-unavailable"
      | "superseded",
  ) {
    super(`creator_marketplace_library_acquisition_${reason}`);
    this.name = "CreatorMarketplaceLibraryAcquisitionRejectedError";
  }
}

export class CreatorMarketplaceLibraryReleaseNotFoundError extends Error {
  constructor() {
    super("creator_marketplace_library_release_not_found");
    this.name = "CreatorMarketplaceLibraryReleaseNotFoundError";
  }
}

export class CreatorMarketplaceLibraryUnsupportedKindError extends Error {
  constructor(readonly kind: CreatorMarketplaceResourceKind) {
    super("creator_marketplace_library_studio_kind_unsupported");
    this.name = "CreatorMarketplaceLibraryUnsupportedKindError";
  }
}

export type CreatorMarketplaceLibraryIntegrityReason =
  | "confirmation-equivocation"
  | "logical-pack-id-mismatch"
  | "manifest-hash-mismatch"
  | "package-identity-collision"
  | "package-kind-continuity"
  | "stored-state-invalid";

export class CreatorMarketplaceLibraryIntegrityError extends Error {
  constructor(readonly reason: CreatorMarketplaceLibraryIntegrityReason) {
    super(`creator_marketplace_library_integrity_${reason}`);
    this.name = "CreatorMarketplaceLibraryIntegrityError";
  }
}

interface PostgresErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

function postgresErrorField(
  error: unknown,
  field: keyof PostgresErrorLike,
): unknown {
  if (!error || typeof error !== "object") return undefined;
  try {
    return Reflect.get(error, field);
  } catch {
    return undefined;
  }
}

export function isCreatorMarketplacePackageKindContinuityViolation(
  error: unknown,
): boolean {
  return postgresErrorField(error, "code") === "23514"
    && postgresErrorField(error, "constraint")
      === "creator_marketplace_resource_package_kind_continuity";
}

export function mapCreatorMarketplaceLibraryDatabaseError(
  error: unknown,
): never {
  if (isCreatorMarketplacePackageKindContinuityViolation(error)) {
    throw new CreatorMarketplaceLibraryIntegrityError("package-kind-continuity");
  }
  const constraint = postgresErrorField(error, "constraint");
  if (
    constraint === "creator_marketplace_library_package_identity_integrity"
    || constraint === "creator_marketplace_library_user_raw_package_unique"
  ) {
    throw new CreatorMarketplaceLibraryIntegrityError("package-identity-collision");
  }
  if (constraint === "creator_marketplace_library_confirmation_equivocation") {
    throw new CreatorMarketplaceLibraryIntegrityError("confirmation-equivocation");
  }
  if (
    typeof constraint === "string"
    && constraint.startsWith("creator_marketplace_library_")
  ) {
    throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
  }
  throw error;
}
