import { describe, expect, it, vi } from "vitest";

import {
  synchronizeStudioCommunityMarketplaceInstalledPack,
  type StudioCommunityMarketplaceCloudSyncDependencies,
} from "./studio-community-marketplace-cloud-sync";

import type { StudioCreatorPackDefinition } from "./studio-creator-pack-catalog";
import type {
  CreatorMarketplaceStudioInstallConfirmationReceipt,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

const releaseId = "123e4567-e89b-42d3-a456-426614174000";
const libraryItemId = "223e4567-e89b-42d3-a456-426614174000";
const manifestHash = "a".repeat(64);
const logicalPackId = `community:${"b".repeat(64)}`;

function fixtures(kind: CreatorMarketplaceResourceRecord["kind"] = "brush") {
  const record = {
    id: releaseId,
    packageId: `community/${kind}/fixture`,
    kind,
    manifestHash,
    publisher: { id: "publisher-1", name: "Publisher", avatar: null },
  } as CreatorMarketplaceResourceRecord;
  const pack = {
    metadata: {
      id: logicalPackId,
      kind,
      packageFingerprint: manifestHash,
      creator: { id: "publisher-1" },
    },
    marketplaceSource: {
      schema: "creator-marketplace-resource-v1",
      releaseId,
      publisherId: "publisher-1",
      packageId: record.packageId,
    },
  } as StudioCreatorPackDefinition;
  return { record, pack };
}

function confirmationReceipt(
  overrides: Partial<CreatorMarketplaceStudioInstallConfirmationReceipt> = {},
): CreatorMarketplaceStudioInstallConfirmationReceipt {
  return {
    operation: "confirm-studio-install",
    changed: true,
    membership: "active",
    libraryScope: "account",
    libraryItemId,
    logicalPackId,
    updatedAt: "2026-08-31T01:00:01.000Z",
    acknowledgement: {
      releaseId,
      manifestHash,
    },
    confirmation: {
      scope: "account-ever",
      releaseId,
      resourceVersion: "1.0.0",
      releaseOrdinal: 1,
      manifestHash,
      confirmedAt: "2026-08-31T01:00:01.000Z",
    },
    ...overrides,
  };
}

function dependencies(
  options: {
    confirmation?: CreatorMarketplaceStudioInstallConfirmationReceipt;
  } = {},
): StudioCommunityMarketplaceCloudSyncDependencies & {
  confirm: ReturnType<typeof vi.fn>;
} {
  return {
    confirm: vi.fn(async () => options.confirmation ?? confirmationReceipt()),
  };
}

describe("Studio community marketplace account sync", () => {
  it("atomically confirms the exact durable local install without a head-only acquire", async () => {
    const { record, pack } = fixtures();
    const signal = new AbortController().signal;
    const deps = dependencies();

    await expect(synchronizeStudioCommunityMarketplaceInstalledPack(
      record,
      pack,
      { dependencies: deps, signal },
    )).resolves.toMatchObject({ status: "synchronized", changed: true });

    expect(deps.confirm).toHaveBeenCalledWith(releaseId, {
      schemaVersion: 1,
      logicalPackId,
      packageFingerprint: manifestHash,
    }, signal);
  });

  it("rejects a confirmation for a different logical pack, release, or manifest", async () => {
    const { record, pack } = fixtures();
    const deps = dependencies({
      confirmation: confirmationReceipt({
        logicalPackId: `community:${"c".repeat(64)}`,
        acknowledgement: {
          releaseId: "323e4567-e89b-42d3-a456-426614174000",
          manifestHash,
        },
        confirmation: {
          ...confirmationReceipt().confirmation,
          releaseId: "323e4567-e89b-42d3-a456-426614174000",
        },
      }),
    });

    await expect(synchronizeStudioCommunityMarketplaceInstalledPack(
      record,
      pack,
      { dependencies: deps },
    )).rejects.toThrow("설치 확인 증거");
  });

  it("historical exact acknowledgement를 수락하고 더 최신 account-ever confirmation을 유지한다", async () => {
    const { record, pack } = fixtures();
    const deps = dependencies({
      confirmation: confirmationReceipt({
        changed: false,
        confirmation: {
          ...confirmationReceipt().confirmation,
          releaseId: "423e4567-e89b-42d3-a456-426614174000",
          resourceVersion: "2.0.0",
          releaseOrdinal: 2,
          manifestHash: "d".repeat(64),
        },
      }),
    });

    await expect(synchronizeStudioCommunityMarketplaceInstalledPack(
      record,
      pack,
      { dependencies: deps },
    )).resolves.toMatchObject({
      status: "synchronized",
      changed: false,
      message: expect.stringContaining("더 최신 버전"),
    });
  });

  it("never mutates the account library for non-confirmable resource kinds", async () => {
    const { record, pack } = fixtures("template");
    const deps = dependencies();

    await expect(synchronizeStudioCommunityMarketplaceInstalledPack(
      record,
      pack,
      { dependencies: deps },
    )).resolves.toMatchObject({ status: "not-confirmable" });
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});
