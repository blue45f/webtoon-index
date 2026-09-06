import {
  CREATOR_MARKETPLACE_LOGICAL_PACK_ID_PATTERN,
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
  creatorMarketplacePackageIdentityPreimage,
} from "./creator-marketplace-cloud-library-contract";
import { sha256HexPortable } from "./sha256-portable";

export const CREATOR_MARKETPLACE_STUDIO_PACK_ID_PATTERN =
  CREATOR_MARKETPLACE_LOGICAL_PACK_ID_PATTERN;

/**
 * Maps every immutable release row for one publisher/package pair to the same local Studio slot.
 *
 * `record.id` deliberately does not participate: it identifies one server release, whereas the
 * installed pack must survive from 1.0.0 to 1.1.0 so Studio can update rather than duplicate it.
 */
export function creatorMarketplaceStudioPackId(
  record: Readonly<{
    packageId: string;
    publisher: Readonly<{
      id: string;
      name?: string;
      avatar?: string | null;
    }>;
  }>,
): string {
  return creatorMarketplaceLogicalPackIdFromPackageKeyHex(
    sha256HexPortable(
      creatorMarketplacePackageIdentityPreimage(
        record.publisher.id,
        record.packageId,
      ),
    ),
  );
}

export function isCreatorMarketplaceStudioPackId(value: string): boolean {
  return CREATOR_MARKETPLACE_STUDIO_PACK_ID_PATTERN.test(value);
}
