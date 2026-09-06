import {
  CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";
import {
  compareCreatorMarketplaceSemver,
  isCreatorMarketplaceSemver,
  normalizeCreatorMarketplaceLegacySemver,
} from "../../../../web/src/shared/lib/creator-marketplace-semver";

export { CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL } from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

export type CreatorMarketplaceReleaseAdmission =
  | Readonly<{
      status: "accepted";
      releaseOrdinal: number;
    }>
  | Readonly<{
      status: "rejected";
      reason: "downgrade" | "equivocation";
      latestVersion: string;
    }>;

/**
 * Evaluates a new immutable release against the current package head. Equal SemVer precedence is
 * equivocation even when build metadata differs, because SemVer declares build metadata inert for
 * ordering and clients could otherwise receive competing payloads for the same effective version.
 */
export function admitCreatorMarketplaceRelease(
  nextVersion: string,
  latest: Readonly<{
    resourceVersion: string;
    releaseOrdinal: number;
  }> | null,
): CreatorMarketplaceReleaseAdmission {
  if (!isCreatorMarketplaceSemver(nextVersion)) {
    throw new TypeError("creator_marketplace_release_version_invalid");
  }
  if (!latest) return { status: "accepted", releaseOrdinal: 1 };
  const normalizedLatestVersion = normalizeCreatorMarketplaceLegacySemver(
    latest.resourceVersion,
  );
  if (
    !normalizedLatestVersion
    || !Number.isSafeInteger(latest.releaseOrdinal)
    || latest.releaseOrdinal < 1
    || latest.releaseOrdinal >= CREATOR_MARKETPLACE_MAX_RELEASE_ORDINAL
  ) {
    throw new Error("creator_marketplace_release_head_invalid");
  }

  const precedence = compareCreatorMarketplaceSemver(
    nextVersion,
    normalizedLatestVersion,
  );
  if (precedence === 0) {
    return {
      status: "rejected",
      reason: "equivocation",
      latestVersion: latest.resourceVersion,
    };
  }
  if (precedence < 0) {
    return {
      status: "rejected",
      reason: "downgrade",
      latestVersion: latest.resourceVersion,
    };
  }
  return {
    status: "accepted",
    releaseOrdinal: latest.releaseOrdinal + 1,
  };
}
