import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
  creatorMarketplacePackageIdentityPreimage,
} from "./creator-marketplace-cloud-library-contract";
import { creatorMarketplaceStudioPackId } from "./creator-marketplace-package-identity";
import { sha256HexPortable } from "./sha256-portable";

describe("creator marketplace Studio pack identity", () => {
  it("keeps immutable releases in one install slot and isolates publishers", () => {
    const firstRelease = creatorMarketplaceStudioPackId({
      packageId: "community/brush/ink",
      publisher: { id: "artist-a", name: "A", avatar: null },
    });
    const nextRelease = creatorMarketplaceStudioPackId({
      packageId: "community/brush/ink",
      publisher: { id: "artist-a", name: "renamed", avatar: "https://example.test/a.png" },
    });
    const otherPublisher = creatorMarketplaceStudioPackId({
      packageId: "community/brush/ink",
      publisher: { id: "artist-b", name: "B", avatar: null },
    });

    expect(firstRelease).toMatch(/^community:[0-9a-f]{64}$/u);
    expect(nextRelease).toBe(firstRelease);
    expect(otherPublisher).not.toBe(firstRelease);
  });

  it("matches the Node/API vector without importing a frontend module from lib", () => {
    const publisherId = "123e4567-e89b-42d3-a456-426614174000";
    const packageId = "community/brush/v2-fixture";
    const preimage = creatorMarketplacePackageIdentityPreimage(publisherId, packageId);
    const nodeHex = createHash("sha256").update(preimage).digest("hex");

    expect(sha256HexPortable(preimage)).toBe(nodeHex);
    expect(creatorMarketplaceStudioPackId({
      packageId,
      publisher: { id: publisherId },
    })).toBe(creatorMarketplaceLogicalPackIdFromPackageKeyHex(nodeHex));
    expect(readFileSync(
      new URL("./creator-marketplace-package-identity.ts", import.meta.url),
      "utf8",
    )).not.toMatch(/(?:@\/src|\.\.\/src)\//u);
  });
});
