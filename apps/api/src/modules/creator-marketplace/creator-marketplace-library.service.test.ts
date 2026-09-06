import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  creatorMarketplacePackageIdentityPreimage,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";

import {
  CreatorMarketplaceLibraryAcquisitionRejectedError,
  CreatorMarketplaceLibraryIntegrityError,
} from "./creator-marketplace-library.repository-contract";
import { CreatorMarketplaceLibraryService } from "./creator-marketplace-library.service";

import type {
  CreatorMarketplaceCloudLibraryRepository,
  CreatorMarketplaceLibraryStoredRow,
} from "./creator-marketplace-library.repository-contract";

const publisherId = "123e4567-e89b-42d3-a456-426614174000";
const releaseId = "223e4567-e89b-42d3-a456-426614174000";
const libraryItemId = "323e4567-e89b-42d3-a456-426614174000";
const packageId = "publisher/brush/ink";

function packageDigest(): Uint8Array {
  return new Uint8Array(createHash("sha256").update(
    creatorMarketplacePackageIdentityPreimage(publisherId, packageId),
  ).digest());
}

function storedRow(
  overrides: Partial<CreatorMarketplaceLibraryStoredRow> = {},
): CreatorMarketplaceLibraryStoredRow {
  return {
    id: libraryItemId,
    userId: "member",
    packageKeyHash: packageDigest(),
    publisherId,
    packageId,
    kind: "brush",
    nameSnapshot: "Ink brush",
    addedFromReleaseId: releaseId,
    addedFromResourceVersion: "1.0.0",
    addedFromReleaseOrdinal: 1,
    addedFromManifestHash: "a".repeat(64),
    addedAt: new Date("2026-08-31T01:00:00.000Z"),
    archivedAt: null,
    lastConfirmedReleaseId: releaseId,
    lastConfirmedResourceVersion: "1.0.0",
    lastConfirmedReleaseOrdinal: 1,
    lastConfirmedManifestHash: "a".repeat(64),
    firstConfirmedAt: new Date("2026-08-31T01:01:00.000Z"),
    lastConfirmedAt: new Date("2026-08-31T01:01:00.000Z"),
    updatedAt: new Date("2026-08-31T01:01:00.000Z"),
    ...overrides,
  };
}

function repositoryMock(): CreatorMarketplaceCloudLibraryRepository {
  return {
    resolveAcquisitionTarget: vi.fn(),
    acquire: vi.fn(),
    confirmStudioInstall: vi.fn(),
    setArchived: vi.fn(),
    list: vi.fn(),
  };
}

describe("CreatorMarketplaceLibraryService", () => {
  it("historical UUID에서 absolute current head acquisition target을 package identity로 투영한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.resolveAcquisitionTarget).mockResolvedValue({
      requestReleaseId: releaseId,
      publisherId,
      packageId,
      kind: "brush",
      packageState: "active",
      publisherStatus: "active",
      requestReleaseDelistedAt: null,
      currentHeadId: "423e4567-e89b-42d3-a456-426614174000",
      currentHeadKind: "brush",
      currentHeadResourceVersion: "2.0.0",
      currentHeadDelistedAt: null,
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    await expect(service.resolveAcquisitionTarget("member", releaseId)).resolves
      .toMatchObject({
        state: "available",
        requestReleaseId: releaseId,
        publisherId,
        packageId,
        currentHead: {
          id: "423e4567-e89b-42d3-a456-426614174000",
          resourceVersion: "2.0.0",
        },
      });
  });

  it.each([
    [{ packageState: "hidden" as const }, "moderated"],
    [{ requestReleaseDelistedAt: new Date("2026-08-31T02:00:00.000Z") }, "owner-delisted"],
    [{ currentHeadDelistedAt: new Date("2026-08-31T02:00:00.000Z") }, "owner-delisted"],
    [{ publisherStatus: "disabled" }, "publisher-unavailable"],
  ])("acquisition target unavailable state를 %s로 정직하게 제한한다", async (override, reason) => {
    const repository = repositoryMock();
    vi.mocked(repository.resolveAcquisitionTarget).mockResolvedValue({
      requestReleaseId: releaseId,
      publisherId,
      packageId,
      kind: "brush",
      packageState: "active",
      publisherStatus: "active",
      requestReleaseDelistedAt: null,
      currentHeadId: "423e4567-e89b-42d3-a456-426614174000",
      currentHeadKind: "brush",
      currentHeadResourceVersion: "2.0.0",
      currentHeadDelistedAt: null,
      ...override,
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    await expect(service.resolveAcquisitionTarget("member", releaseId)).resolves
      .toMatchObject({ state: "unavailable", reason });
  });

  it("공개 absolute head로만 account-ever update availability를 계산한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.list).mockResolvedValue({
      rows: [storedRow()],
      catalogHeads: [{
        id: "423e4567-e89b-42d3-a456-426614174000",
        publisherId,
        packageId,
        name: "Ink brush 2",
        kind: "brush",
        resourceVersion: "1.1.0",
        minimumStudioVersion: "1.0.0",
        releaseOrdinal: 2,
        manifestHash: "b".repeat(64),
        hidden: false,
        delistedAt: null,
        publisherStatus: "active",
      }],
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    const page = await service.list("member", { limit: 50, view: "active" });

    expect(page.items[0]).toMatchObject({
      membership: "active",
      confirmation: { state: "confirmed", scope: "account-ever" },
      catalog: { state: "available", head: { releaseOrdinal: 2 } },
      updateState: "account-confirmed-update-available",
    });
  });

  it("hidden absolute head를 old-head fallback 없이 catalog unavailable로 표시한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.list).mockResolvedValue({
      rows: [storedRow()],
      catalogHeads: [{
        id: "423e4567-e89b-42d3-a456-426614174000",
        publisherId,
        packageId,
        name: "Ink brush 2",
        kind: "brush",
        resourceVersion: "1.1.0",
        minimumStudioVersion: "1.0.0",
        releaseOrdinal: 2,
        manifestHash: "b".repeat(64),
        hidden: true,
        delistedAt: null,
        publisherStatus: "active",
      }],
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    const page = await service.list("member", { limit: 50, view: "active" });

    expect(page.items[0]).toMatchObject({
      catalog: { state: "unavailable", reason: "moderated" },
      updateState: "catalog-unavailable",
    });
  });

  it("keyset cursor를 계정 + view + logicalPackId fingerprint에 묶는다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.list).mockResolvedValue({
      rows: [storedRow(), storedRow({
        id: "523e4567-e89b-42d3-a456-426614174000",
        addedAt: new Date("2026-08-30T01:00:00.000Z"),
      })],
      catalogHeads: [],
    });
    const service = new CreatorMarketplaceLibraryService(repository);
    const first = await service.list("member", { limit: 1, view: "active" });
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    await expect(service.list("member", {
      limit: 1,
      view: "archived",
      cursor: first.nextCursor!,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list("another-member", {
      limit: 1,
      view: "active",
      cursor: first.nextCursor!,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("confirmation은 archive를 풀지 않고 membership과 evidence scope를 분리한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.confirmStudioInstall).mockResolvedValue({
      row: storedRow({
        archivedAt: new Date("2026-08-31T01:02:00.000Z"),
        updatedAt: new Date("2026-08-31T01:02:00.000Z"),
      }),
      changed: false,
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    const receipt = await service.confirmStudioInstall("member", releaseId, {
      schemaVersion: 1,
      logicalPackId: `community:${"c".repeat(64)}`,
      packageFingerprint: "a".repeat(64),
    });

    expect(receipt).toMatchObject({
      changed: false,
      membership: "archived",
      libraryScope: "account",
      confirmation: { scope: "account-ever" },
    });
    expect("installed" in receipt).toBe(false);
  });

  it("historical exact 요청을 acknowledgement하고 account-ever 최신 확인은 뒤로 낮추지 않는다", async () => {
    const repository = repositoryMock();
    const newerReleaseId = "423e4567-e89b-42d3-a456-426614174000";
    vi.mocked(repository.confirmStudioInstall).mockResolvedValue({
      row: storedRow({
        lastConfirmedReleaseId: newerReleaseId,
        lastConfirmedResourceVersion: "2.0.0",
        lastConfirmedReleaseOrdinal: 2,
        lastConfirmedManifestHash: "b".repeat(64),
      }),
      changed: false,
    });
    const service = new CreatorMarketplaceLibraryService(repository);

    await expect(service.confirmStudioInstall("member", releaseId, {
      schemaVersion: 1,
      logicalPackId: `community:${"c".repeat(64)}`,
      packageFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({
      changed: false,
      acknowledgement: {
        releaseId,
        manifestHash: "a".repeat(64),
      },
      confirmation: {
        releaseId: newerReleaseId,
        releaseOrdinal: 2,
        manifestHash: "b".repeat(64),
      },
    });
  });

  it("logical pack / manifest 불일치는 충돌 응답으로 매핑한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.confirmStudioInstall).mockRejectedValue(
      new CreatorMarketplaceLibraryIntegrityError("manifest-hash-mismatch"),
    );
    const service = new CreatorMarketplaceLibraryService(repository);

    await expect(service.confirmStudioInstall("member", releaseId, {
      schemaVersion: 1,
      logicalPackId: `community:${"c".repeat(64)}`,
      packageFingerprint: "a".repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("visible historical release도 acquire current-head 계약으로 거절한다", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.acquire).mockRejectedValue(
      new CreatorMarketplaceLibraryAcquisitionRejectedError("superseded"),
    );
    const service = new CreatorMarketplaceLibraryService(repository);

    await expect(service.acquire("member", releaseId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
