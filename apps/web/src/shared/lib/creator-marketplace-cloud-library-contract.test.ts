import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "../../domains/creator/studio-sha256";

import {
  ConfirmCreatorMarketplaceStudioInstallSchema,
  CreatorMarketplaceAcquisitionTargetSchema,
  CreatorMarketplaceCloudLibraryItemSchema,
  CreatorMarketplaceStudioInstallConfirmationReceiptSchema,
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
  creatorMarketplacePackageIdentityPreimage,
} from "./creator-marketplace-cloud-library-contract";
import { creatorMarketplaceStudioPackId } from "./creator-marketplace-package-identity";

const publisherId = "123e4567-e89b-42d3-a456-426614174000";
const releaseId = "223e4567-e89b-42d3-a456-426614174000";
const libraryItemId = "323e4567-e89b-42d3-a456-426614174000";
const packageId = "publisher/brush/ink";
const hash = "a".repeat(64);

describe("creator marketplace cloud library contract", () => {
  it("publisher + NUL + package identity를 Studio logical pack id와 정확히 공유한다", () => {
    const preimage = creatorMarketplacePackageIdentityPreimage(publisherId, packageId);
    expect(new TextDecoder().decode(preimage)).toBe(`${publisherId}\0${packageId}`);
    const nodeHex = createHash("sha256").update(preimage).digest("hex");
    const browserHex = sha256HexPortable(preimage);
    expect(nodeHex).toBe(browserHex);
    expect(creatorMarketplaceLogicalPackIdFromPackageKeyHex(nodeHex)).toBe(
      creatorMarketplaceStudioPackId({
        packageId,
        publisher: { id: publisherId },
      }),
    );
    expect(() => creatorMarketplacePackageIdentityPreimage(
      "publisher\0spoof",
      packageId,
    )).toThrow();
  });

  it("설치 확인 요청을 strict, bounded fingerprint 계약으로 제한한다", () => {
    const input = {
      schemaVersion: 1 as const,
      logicalPackId: creatorMarketplaceLogicalPackIdFromPackageKeyHex(
        createHash("sha256").update(
          creatorMarketplacePackageIdentityPreimage(publisherId, packageId),
        ).digest("hex"),
      ),
      packageFingerprint: hash,
    };
    expect(ConfirmCreatorMarketplaceStudioInstallSchema.parse(input)).toEqual(input);
    expect(ConfirmCreatorMarketplaceStudioInstallSchema.safeParse({
      ...input,
      installedAt: new Date().toISOString(),
    }).success).toBe(false);
  });

  it("cloud acquisition target은 exact package identity와 현재 head 또는 제한된 사유만 노출한다", () => {
    const logicalPackId = creatorMarketplaceStudioPackId({
      packageId,
      publisher: { id: publisherId },
    });
    const target = {
      state: "available" as const,
      requestReleaseId: releaseId,
      publisherId,
      packageId,
      kind: "brush" as const,
      logicalPackId,
      currentHead: {
        id: "423e4567-e89b-42d3-a456-426614174000",
        resourceVersion: "2.0.0",
      },
    };

    expect(CreatorMarketplaceAcquisitionTargetSchema.parse(target)).toEqual(target);
    expect(CreatorMarketplaceAcquisitionTargetSchema.safeParse({
      ...target,
      manifestHash: hash,
    }).success).toBe(false);
    expect(CreatorMarketplaceAcquisitionTargetSchema.safeParse({
      ...target,
      state: "unavailable",
      currentHead: undefined,
      reason: "removed",
    }).success).toBe(false);
  });

  it("account-ever confirmation을 현재 기기 installed 상태로 오해할 필드를 허용하지 않는다", () => {
    const receipt = CreatorMarketplaceStudioInstallConfirmationReceiptSchema.parse({
      operation: "confirm-studio-install",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId,
      logicalPackId: creatorMarketplaceStudioPackId({
        packageId,
        publisher: { id: publisherId },
      }),
      updatedAt: "2026-08-31T01:00:00.000Z",
      acknowledgement: {
        releaseId,
        manifestHash: hash,
      },
      confirmation: {
        scope: "account-ever",
        releaseId,
        resourceVersion: "1.0.0",
        releaseOrdinal: 1,
        manifestHash: hash,
        confirmedAt: "2026-08-31T01:00:00.000Z",
      },
    });
    expect(receipt.libraryScope).toBe("account");
    expect(receipt.confirmation.scope).toBe("account-ever");
    expect("installed" in receipt).toBe(false);
    expect(CreatorMarketplaceStudioInstallConfirmationReceiptSchema.safeParse({
      ...receipt,
      acknowledgement: {
        releaseId,
        manifestHash: "f".repeat(64),
      },
    }).success).toBe(false);
    expect(CreatorMarketplaceStudioInstallConfirmationReceiptSchema.safeParse({
      ...receipt,
      installed: true,
    }).success).toBe(false);
  });

  it("membership, catalog, update state 조합을 일관되게 검증한다", () => {
    const item = {
      id: libraryItemId,
      logicalPackId: creatorMarketplaceStudioPackId({
        packageId,
        publisher: { id: publisherId },
      }),
      packageId,
      name: "Ink brush",
      kind: "brush" as const,
      membership: "active" as const,
      addedFrom: {
        releaseId,
        resourceVersion: "1.0.0",
        releaseOrdinal: 1,
        manifestHash: hash,
      },
      addedAt: "2026-08-31T01:00:00.000Z",
      archivedAt: null,
      confirmation: {
        state: "confirmed" as const,
        scope: "account-ever" as const,
        releaseId,
        resourceVersion: "1.0.0",
        releaseOrdinal: 1,
        manifestHash: hash,
        firstConfirmedAt: "2026-08-31T01:00:00.000Z",
        lastConfirmedAt: "2026-08-31T01:00:00.000Z",
      },
      catalog: {
        state: "available" as const,
        head: {
          id: "423e4567-e89b-42d3-a456-426614174000",
          name: "Ink brush",
          kind: "brush" as const,
          resourceVersion: "1.1.0",
          minimumStudioVersion: "1.0.0",
          releaseOrdinal: 2,
          manifestHash: "b".repeat(64),
        },
      },
      updateState: "account-confirmed-update-available" as const,
    };
    expect(CreatorMarketplaceCloudLibraryItemSchema.parse(item)).toEqual(item);
    expect(CreatorMarketplaceCloudLibraryItemSchema.safeParse({
      ...item,
      membership: "archived",
    }).success).toBe(false);
    expect(CreatorMarketplaceCloudLibraryItemSchema.safeParse({
      ...item,
      updateState: "account-confirmed-current-head",
    }).success).toBe(false);
    expect(CreatorMarketplaceCloudLibraryItemSchema.safeParse({
      ...item,
      confirmation: {
        ...item.confirmation,
        releaseOrdinal: 3,
      },
    }).success).toBe(false);
    expect(CreatorMarketplaceCloudLibraryItemSchema.safeParse({
      ...item,
      catalog: {
        state: "available",
        head: {
          ...item.catalog.head,
          id: releaseId,
          resourceVersion: "1.0.0",
          releaseOrdinal: 1,
          manifestHash: "c".repeat(64),
        },
      },
      updateState: "account-confirmed-current-head",
    }).success).toBe(false);
  });
});
