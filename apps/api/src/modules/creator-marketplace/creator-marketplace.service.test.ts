import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

import {
  creatorMarketplacePublisherGateKey,
} from "./creator-marketplace-publish-gate";
import {
  CreatorMarketplaceOrphanReportDismissRejectedError,
  CreatorMarketplaceResourceDuplicateError,
  CreatorMarketplaceResourceReleaseRejectedError,
  CreatorMarketplaceResourceRelistRejectedError,
  CreatorMarketplaceResourceReportRejectedError,
} from "./creator-marketplace.repository-contract";
import { CreatorMarketplaceService } from "./creator-marketplace.service";

import type {
  CreatorMarketplacePublishGate,
  CreatorMarketplacePublishLease,
} from "./creator-marketplace-publish-gate";
import type { PublishCreatorMarketplaceResourceDto } from "./creator-marketplace.dto";
import type {
  CreatorMarketplaceResourceRepository,
  CreatorMarketplaceResourceStoredRow,
  CreatorMarketplaceLifecycleStoredRow,
} from "./creator-marketplace.repository-contract";
import type {
  CreatorMarketplaceResourceManifest,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

function digest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeCreatorMarketplaceJson(value))
    .digest("hex");
}

function manifest(): CreatorMarketplaceResourceManifest {
  const definition = {
    snapshot: {
      renderer: "perfect-freehand",
      dynamics: { size: 0.8, opacity: 1 },
    },
  };
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: "brush" as const,
    runtime: "studio-brush-v1" as const,
    definition,
  };
  return {
    schemaVersion: 1,
    packageId: "original/brush/ink-starter",
    name: "오리지널 잉크 스타터",
    description: "작가가 직접 만든 portable brush JSON",
    kind: "brush",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["잉크"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: "brush/ink-starter",
      kind: "brush",
      name: "잉크 스타터",
      delivery: {
        mode: "portable-json",
        mediaType: "application/vnd.toonspectrum.brush+json",
        payload,
        byteSize: creatorMarketplaceJsonByteSize(payload),
        sha256: digest(payload),
      },
    }],
  };
}

function storedRow(
  input: CreatorMarketplaceResourceManifest = manifest(),
  overrides: Partial<CreatorMarketplaceResourceStoredRow> = {}
): CreatorMarketplaceResourceStoredRow {
  return {
    id: randomUUID(),
    publisherId: "publisher-1",
    publisherName: "테스트 작가",
    publisherAvatar: "#334155",
    manifest: input,
    manifestHash: digest(input),
    manifestByteSize: creatorMarketplaceJsonByteSize(input),
    createdAt: new Date("2026-07-27T01:02:03.000Z"),
    updatedAt: new Date("2026-07-27T01:02:03.000Z"),
    ...overrides,
  };
}

function lifecycleRow(
  input: CreatorMarketplaceResourceManifest = manifest(),
  overrides: Partial<CreatorMarketplaceLifecycleStoredRow> = {}
): CreatorMarketplaceLifecycleStoredRow {
  return {
    ...storedRow(input),
    releaseOrdinal: 1,
    hidden: false,
    delistedAt: null,
    packageState: "active",
    packageRevision: 0,
    packageHiddenAt: null,
    ...overrides,
  };
}

describe("CreatorMarketplaceService", () => {
  const repository = {
    list: vi.fn<CreatorMarketplaceResourceRepository["list"]>(),
    listOwnedHeads: vi.fn<CreatorMarketplaceResourceRepository["listOwnedHeads"]>(),
    findHistoryAnchor:
      vi.fn<CreatorMarketplaceResourceRepository["findHistoryAnchor"]>(),
    listPublicHistory:
      vi.fn<CreatorMarketplaceResourceRepository["listPublicHistory"]>(),
    findOwnedPackageHead:
      vi.fn<CreatorMarketplaceResourceRepository["findOwnedPackageHead"]>(),
    listOwnedPackageHistory:
      vi.fn<CreatorMarketplaceResourceRepository["listOwnedPackageHistory"]>(),
    findById: vi.fn<CreatorMarketplaceResourceRepository["findById"]>(),
    findIdentityById:
      vi.fn<CreatorMarketplaceResourceRepository["findIdentityById"]>(),
    publish: vi.fn<CreatorMarketplaceResourceRepository["publish"]>(),
    deleteOwned: vi.fn<CreatorMarketplaceResourceRepository["deleteOwned"]>(),
    relistOwned: vi.fn<CreatorMarketplaceResourceRepository["relistOwned"]>(),
    report: vi.fn<CreatorMarketplaceResourceRepository["report"]>(),
    listModeration: vi.fn<CreatorMarketplaceResourceRepository["listModeration"]>(),
    moderate: vi.fn<CreatorMarketplaceResourceRepository["moderate"]>(),
    dismissOrphanReport:
      vi.fn<CreatorMarketplaceResourceRepository["dismissOrphanReport"]>(),
  };
  const lease: CreatorMarketplacePublishLease = {
    publisherKeyHash: new Uint8Array(32).fill(7),
    token: "test-creator-marketplace-publish-lease-token",
    fence: "1",
    expiresAt: new Date("2026-07-27T01:02:33.000Z"),
  };
  const publishGate = {
    acquire: vi.fn<CreatorMarketplacePublishGate["acquire"]>(),
    release: vi.fn<CreatorMarketplacePublishGate["release"]>(),
  };
  let service: CreatorMarketplaceService;

  beforeEach(() => {
    vi.clearAllMocks();
    publishGate.acquire.mockResolvedValue({
      status: "acquired",
      lease,
    });
    publishGate.release.mockResolvedValue(true);
    service = new CreatorMarketplaceService(repository, publishGate);
  });

  it("portable JSON 실제 콘텐츠를 보존해 게시하고 rights 확인 내부 필드는 응답에서 제거한다", async () => {
    const input = manifest();
    const publisherId = `publisher-${randomUUID()}`;
    repository.publish.mockImplementation(async (write) =>
      storedRow(write.manifest, {
        id: write.id,
        publisherId: write.publisherId,
        manifestHash: write.manifestHash,
        manifestByteSize: write.manifestByteSize,
      })
    );

    const result = await service.publish(
      publisherId,
      input as PublishCreatorMarketplaceResourceDto
    );

    expect(result.entries[0]?.delivery).toMatchObject({
      mode: "portable-json",
      payload: input.entries[0]?.delivery.mode === "portable-json"
        ? input.entries[0].delivery.payload
        : {},
    });
    expect(result).not.toHaveProperty("rightsConfirmed");
    expect(repository.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: input,
        manifestHash: digest(input),
        manifestByteSize: creatorMarketplaceJsonByteSize(input),
      })
    );
    expect(publishGate.acquire).toHaveBeenCalledWith(
      creatorMarketplacePublisherGateKey(publisherId)
    );
  });

  it("항목 콘텐츠 hash 불일치를 fail-closed로 거절한다", async () => {
    const input = manifest();
    const invalid = structuredClone(input);
    const delivery = invalid.entries[0]!.delivery;
    if (delivery.mode !== "builtin-ref") delivery.sha256 = "0".repeat(64);

    await expect(
      service.publish(
        `publisher-${randomUUID()}`,
        invalid as PublishCreatorMarketplaceResourceDto
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(publishGate.acquire).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("builtin-ref도 canonical runtimeRef digest가 일치해야 게시한다", async () => {
    const valid = manifest();
    valid.kind = "template";
    valid.packageId = "original/template/webtoon-basic";
    valid.entries[0]!.kind = "template";
    valid.entries[0]!.id = "template/webtoon-basic";
    const runtimeRef = "studio-scene-template:webtoon-basic";
    valid.entries[0]!.delivery = {
      mode: "builtin-ref",
      runtimeRef,
      byteSize: 0,
      sha256: digest({ mode: "builtin-ref", runtimeRef }),
    };
    repository.publish.mockImplementation(async (write) =>
      storedRow(write.manifest, {
        id: write.id,
        publisherId: write.publisherId,
        manifestHash: write.manifestHash,
        manifestByteSize: write.manifestByteSize,
      })
    );

    await expect(
      service.publish(
        `publisher-${randomUUID()}`,
        valid as PublishCreatorMarketplaceResourceDto
      )
    ).resolves.toMatchObject({
      entries: [{ delivery: { mode: "builtin-ref", runtimeRef } }],
    });

    valid.entries[0]!.delivery = {
      ...valid.entries[0]!.delivery,
      runtimeRef: "studio-scene-template:tampered",
    };
    await expect(
      service.publish(
        `publisher-${randomUUID()}`,
        valid as PublishCreatorMarketplaceResourceDto
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("동일 패키지 버전/manifest 충돌을 409로 변환한다", async () => {
    repository.publish.mockRejectedValue(new CreatorMarketplaceResourceDuplicateError());

    await expect(
      service.publish(
        `publisher-${randomUUID()}`,
        manifest() as PublishCreatorMarketplaceResourceDto
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ["equivocation", "creator_marketplace_resource_version_equivocation"],
    ["downgrade", "creator_marketplace_resource_version_downgrade"],
    ["moderated", "creator_marketplace_package_moderated"],
  ] as const)(
    "%s release 거절을 구분 가능한 409 계약으로 변환한다",
    async (reason, code) => {
      repository.publish.mockRejectedValue(
        new CreatorMarketplaceResourceReleaseRejectedError(reason, "2.0.0"),
      );

      const error = await service
        .publish(
          `publisher-${randomUUID()}`,
          manifest() as PublishCreatorMarketplaceResourceDto,
        )
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code });
      expect(JSON.stringify((error as ConflictException).getResponse())).toContain("2.0.0");
    },
  );

  it("게시 mutation을 사용자별 시간당 20회로 제한한다", async () => {
    const publisherId = `rate-${randomUUID()}`;
    repository.publish.mockImplementation(async (write) =>
      storedRow(write.manifest, {
        id: write.id,
        publisherId: write.publisherId,
        manifestHash: write.manifestHash,
        manifestByteSize: write.manifestByteSize,
      })
    );

    for (let index = 0; index < 20; index += 1) {
      const input = manifest();
      input.packageId = `original/brush/rate-${index}`;
      input.resourceVersion = `1.0.${index}`;
      await service.publish(publisherId, input as PublishCreatorMarketplaceResourceDto);
    }

    publishGate.acquire.mockResolvedValueOnce({ status: "rate_limited" });
    const error = await service
      .publish(publisherId, manifest() as PublishCreatorMarketplaceResourceDto)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(repository.publish).toHaveBeenCalledTimes(20);
    expect(publishGate.release).toHaveBeenCalledTimes(20);
  });

  it("분산 gate 저장소가 없으면 resource write 전에 fail-closed 한다", async () => {
    publishGate.acquire.mockRejectedValueOnce(
      new Error("postgres connection secret detail")
    );

    const error = await service
      .publish(
        `publisher-${randomUUID()}`,
        manifest() as PublishCreatorMarketplaceResourceDto
      )
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({ status: 503 });
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain(
      "postgres connection secret detail"
    );
    expect(repository.publish).not.toHaveBeenCalled();
    expect(publishGate.release).not.toHaveBeenCalled();
  });

  it("저장소 실패는 비밀 메시지 없이 bounded reason code만 운영 로그에 남긴다", async () => {
    const logger = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const repositoryError = Object.assign(
      new Error("postgresql://runtime:production-secret@database.example/market"),
      { code: "42501" },
    );
    repository.list.mockRejectedValueOnce(repositoryError);

    try {
      await expect(service.list({ limit: 1 })).rejects.toMatchObject({
        status: 503,
      });
      expect(logger).toHaveBeenCalledWith({
        event: "creator-marketplace.operation.failed",
        operation: "list",
        reasonCode: "42501",
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        "production-secret",
      );

      logger.mockClear();
      const attackerControlledError = Object.assign(
        new Error("another production secret"),
        {
          code: "production-secret",
          name: "another-production-secret",
        },
      );
      repository.list.mockRejectedValueOnce(attackerControlledError);
      await expect(service.list({ limit: 1 })).rejects.toMatchObject({
        status: 503,
      });
      expect(logger).toHaveBeenCalledWith({
        event: "creator-marketplace.operation.failed",
        operation: "list",
        reasonCode: "Error",
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        "production-secret",
      );
    } finally {
      logger.mockRestore();
    }
  });

  it("commit 뒤 release 장애는 성공을 모호하게 만들지 않고 짧은 lease 만료에 맡긴다", async () => {
    const input = manifest();
    repository.publish.mockImplementation(async (write) =>
      storedRow(write.manifest, {
        id: write.id,
        publisherId: write.publisherId,
        manifestHash: write.manifestHash,
        manifestByteSize: write.manifestByteSize,
      })
    );
    publishGate.release.mockRejectedValueOnce(new Error("release unavailable"));

    await expect(
      service.publish(
        `publisher-${randomUUID()}`,
        input as PublishCreatorMarketplaceResourceDto
      )
    ).resolves.toMatchObject({ packageId: input.packageId });
    expect(publishGate.release).toHaveBeenCalledOnce();
  });

  it("keyset cursor를 발급하고 다음 요청에서 정확한 createdAt/id 경계로 복원한다", async () => {
    const first = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174001",
      createdAt: new Date("2026-07-27T03:00:00.000Z"),
    });
    const second = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174002",
      createdAt: new Date("2026-07-27T02:00:00.000Z"),
    });
    const sentinel = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174003",
      createdAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    repository.list.mockResolvedValueOnce([first, second, sentinel]);

    const page = await service.list({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    repository.list.mockResolvedValueOnce([]);
    await service.list({ limit: 2, cursor: page.nextCursor! });

    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: {
          sort: "newest",
          createdAt: second.createdAt,
          id: second.id,
        },
        sort: "newest",
      })
    );
  });

  it("관련도 점수·createdAt·id 경계를 cursor에 보존하고 다른 검색에는 재사용하지 않는다", async () => {
    const first = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174011",
      relevanceScore: 1200,
      createdAt: new Date("2026-07-27T03:00:00.000Z"),
    });
    const second = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174012",
      relevanceScore: 800,
      createdAt: new Date("2026-07-27T02:00:00.000Z"),
    });
    const sentinel = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174013",
      relevanceScore: 400,
      createdAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    repository.list.mockResolvedValueOnce([first, second, sentinel]);

    const page = await service.list({
      limit: 2,
      search: "잉크",
      sort: "relevance",
    });
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    repository.list.mockClear();
    repository.list.mockResolvedValueOnce([]);
    await service.list({
      limit: 2,
      search: "잉크",
      sort: "relevance",
      cursor: page.nextCursor!,
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      search: "잉크",
      sort: "relevance",
      cursor: {
        sort: "relevance",
        relevanceScore: 800,
        createdAt: second.createdAt,
        id: second.id,
      },
    }));

    repository.list.mockClear();
    await expect(service.list({
      limit: 2,
      search: "다른 검색",
      sort: "relevance",
      cursor: page.nextCursor!,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("검색에는 관련도순, 비검색 목록에는 최신순을 기본값으로 사용한다", async () => {
    repository.list.mockResolvedValue([]);

    await service.list({ limit: 10, search: "잉크" });
    expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({
      search: "잉크",
      sort: "relevance",
    }));

    await service.list({ limit: 10 });
    expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: "newest",
    }));
  });

  it("서비스 직접 호출에서도 검색어 없는 관련도순을 DB 전에 거절한다", async () => {
    await expect(service.list({ limit: 10, sort: "relevance" }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("변조되거나 비정상인 cursor를 DB 조회 전에 거절한다", async () => {
    const malformed = Buffer.from(JSON.stringify({
      version: 1,
      createdAt: "not-a-date",
      id: "not-an-id",
    })).toString("base64url");

    await expect(service.list({ limit: 10, cursor: malformed }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it.each(["entry", "manifest-hash", "manifest-size"] as const)(
    "DB에서 읽은 %s 무결성 변조를 공개 record로 투영하지 않는다",
    async (corruption) => {
      const row = storedRow();
      if (corruption === "entry") {
        const delivery = row.manifest.entries[0]!.delivery;
        if (delivery.mode !== "builtin-ref") delivery.sha256 = "f".repeat(64);
        row.manifestHash = digest(row.manifest);
        row.manifestByteSize = creatorMarketplaceJsonByteSize(row.manifest);
      } else if (corruption === "manifest-hash") {
        row.manifestHash = "e".repeat(64);
      } else {
        row.manifestByteSize += 1;
      }
      repository.list.mockResolvedValueOnce([row]);

      await expect(service.list({ limit: 10 })).rejects.toMatchObject({
        status: 503,
      });
    }
  );

  it("cursor v3는 public/owner visibility scope를 분리하고 v2 cursor를 fail-closed한다", async () => {
    const first = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174031",
      createdAt: new Date("2026-07-27T03:00:00.123Z"),
    });
    const sentinel = storedRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174030",
      createdAt: new Date("2026-07-27T02:00:00.123Z"),
    });
    repository.list.mockResolvedValueOnce([first, sentinel]);
    const publicPage = await service.list({ limit: 1 });
    expect(publicPage.nextCursor).not.toBeNull();

    await expect(service.listOwnedHeads("publisher-1", {
      limit: 1,
      cursor: publicPage.nextCursor!,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.listOwnedHeads).not.toHaveBeenCalled();

    const envelope = JSON.parse(
      Buffer.from(publicPage.nextCursor!, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    envelope.version = 2;
    const versionTwoCursor = Buffer.from(
      JSON.stringify(envelope),
      "utf8"
    ).toString("base64url");
    await expect(service.list({
      limit: 1,
      cursor: versionTwoCursor,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("공개 package history는 delisted anchor를 표시하되 listed release id만 반환한다", async () => {
    const anchorManifest = { ...manifest(), resourceVersion: "2.0.0" };
    const anchor = lifecycleRow(anchorManifest, {
      id: "123e4567-e89b-42d3-a456-426614174041",
      releaseOrdinal: 2,
      delistedAt: new Date("2026-07-29T00:00:00.000Z"),
    });
    const listed = lifecycleRow(manifest(), {
      id: "123e4567-e89b-42d3-a456-426614174040",
      releaseOrdinal: 1,
    });
    repository.findHistoryAnchor.mockResolvedValue(anchor);
    repository.listPublicHistory.mockResolvedValue([listed]);

    await expect(service.history(anchor.id, { limit: 20 })).resolves.toMatchObject({
      packageId: anchor.manifest.packageId,
      anchor: {
        id: anchor.id,
        resourceVersion: "2.0.0",
        listed: false,
      },
      items: [{ id: listed.id, releaseOrdinal: 1, selected: false }],
      nextCursor: null,
    });
    expect(repository.listPublicHistory).toHaveBeenCalledWith({
      publisherId: anchor.publisherId,
      packageId: anchor.manifest.packageId,
      limit: 20,
      cursor: null,
    });

    repository.findHistoryAnchor.mockResolvedValueOnce(null);
    await expect(service.history(randomUUID(), { limit: 20 }))
      .rejects.toBeInstanceOf(NotFoundException);

    repository.findHistoryAnchor.mockResolvedValueOnce(anchor);
    repository.listPublicHistory.mockResolvedValueOnce([{
      ...listed,
      hidden: true,
    }]);
    await expect(service.history(anchor.id, { limit: 20 })).rejects.toMatchObject({
      status: 503,
    });
  });

  it.each([
    "absolute head가 owner-delisted인 패키지",
    "publisher가 비활성인 패키지",
  ])("%s의 과거 UUID public history는 404로 닫는다", async () => {
    repository.findHistoryAnchor.mockResolvedValueOnce(null);
    const historicalId = randomUUID();

    await expect(service.history(historicalId, { limit: 20 }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.listPublicHistory).not.toHaveBeenCalled();
  });

  it("owner heads/history는 hidden·delisted head를 보존하고 ordinal cursor를 사용한다", async () => {
    const headManifest = {
      ...manifest(),
      resourceVersion: "3.0.0",
      releaseNotes: "관리자 검토 중",
    };
    const head = lifecycleRow(headManifest, {
      releaseOrdinal: 3,
      hidden: true,
      delistedAt: new Date("2026-07-29T00:00:00.000Z"),
      packageState: "hidden",
      packageRevision: 1,
      packageHiddenAt: new Date("2026-07-28T00:00:00.000Z"),
    });
    const older = lifecycleRow(manifest(), { releaseOrdinal: 2 });
    repository.listOwnedHeads.mockResolvedValue([head]);

    await expect(service.listOwnedHeads(head.publisherId, { limit: 20 }))
      .resolves.toMatchObject({
        items: [{
          resource: { id: head.id, isOwner: true, releaseNotes: "관리자 검토 중" },
          releaseOrdinal: 3,
          hidden: true,
          delistedAt: "2026-07-29T00:00:00.000Z",
        }],
      });

    repository.findOwnedPackageHead.mockResolvedValue(head);
    repository.listOwnedPackageHistory.mockResolvedValue([head, older]);
    const page = await service.listOwnedHistory(head.publisherId, {
      packageId: head.manifest.packageId,
      limit: 1,
    });
    expect(page).toMatchObject({
      items: [{ releaseOrdinal: 3, hidden: true }],
      hasMore: true,
      nextCursor: 3,
    });
    expect(repository.listOwnedPackageHistory).toHaveBeenCalledWith({
      publisherId: head.publisherId,
      packageId: head.manifest.packageId,
      limit: 1,
      cursor: null,
    });

    repository.findOwnedPackageHead.mockResolvedValueOnce(null);
    await expect(service.listOwnedHistory("other-publisher", {
      packageId: head.manifest.packageId,
      limit: 20,
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("head relist는 changed/no-op receipt와 404/409 상태를 안정적으로 매핑한다", async () => {
    const id = randomUUID();
    repository.relistOwned.mockResolvedValueOnce({ id, changed: true });
    await expect(service.relistOwned("publisher", id)).resolves.toEqual({
      relisted: true,
      changed: true,
      id,
      delistedAt: null,
    });
    repository.relistOwned.mockResolvedValueOnce({ id, changed: false });
    await expect(service.relistOwned("publisher", id)).resolves.toMatchObject({
      changed: false,
    });
    repository.relistOwned.mockResolvedValueOnce(null);
    await expect(service.relistOwned("foreign", id)).rejects.toBeInstanceOf(
      NotFoundException
    );

    for (const reason of ["non-head", "moderated"] as const) {
      repository.relistOwned.mockRejectedValueOnce(
        new CreatorMarketplaceResourceRelistRejectedError(reason)
      );
      const error = await service.relistOwned("publisher", id).catch(
        (cause: unknown) => cause
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: reason === "non-head"
          ? "creator_marketplace_relist_non_head"
          : "creator_marketplace_relist_moderated",
      });
    }
  });

  it("소유자 delist만 repository에 위임하고 존재하지 않는 행은 404로 숨긴다", async () => {
    repository.deleteOwned.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const id = randomUUID();

    await expect(service.deleteOwned("publisher", id)).resolves.toEqual({ delisted: true });
    await expect(service.deleteOwned("publisher", id)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("단건 조회는 공개 record를 돌려주고 뷰어가 배급자면 isOwner를 표시한다", async () => {
    const row = storedRow();
    repository.findById.mockResolvedValueOnce(row);

    await expect(service.getById(row.id)).resolves.toMatchObject({
      id: row.id,
      packageId: "original/brush/ink-starter",
      isOwner: false,
      access: "free",
    });
    repository.findById.mockResolvedValueOnce(row);
    await expect(service.getById(row.id, { viewerId: row.publisherId })).resolves.toMatchObject({
      isOwner: true,
    });
  });

  it.each([
    ["active", "active", null, null, "listed"],
    ["active", "active", null, new Date("2026-07-29T00:00:00.000Z"), "owner-delisted"],
    ["active", "active", new Date("2026-07-28T00:00:00.000Z"), null, "owner-delisted"],
    ["hidden", "active", null, null, "moderator-hidden"],
    ["active", "suspended", null, null, "publisher-unavailable"],
  ] as const)(
    "exact identity는 %s package의 payload 없는 availability를 반환한다",
    async (
      packageState,
      publisherStatus,
      releaseDelistedAt,
      currentHeadDelistedAt,
      availability,
    ) => {
      const id = randomUUID();
      repository.findIdentityById.mockResolvedValueOnce({
        id,
        publisherId: "publisher-1",
        packageId: "original/brush/ink-starter",
        kind: "brush",
        releaseDelistedAt,
        currentHeadDelistedAt,
        packageState,
        publisherStatus,
      });

      await expect(service.getIdentity(id)).resolves.toEqual({
        id,
        publisherId: "publisher-1",
        packageId: "original/brush/ink-starter",
        kind: "brush",
        availability,
      });
    },
  );

  it("exact identity가 없는 UUID는 다른 visibility 정보를 추측하지 않고 404로 닫는다", async () => {
    repository.findIdentityById.mockResolvedValueOnce(null);

    await expect(service.getIdentity(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("0021 legacy SemVer 원문/hash는 읽되 같은 spelling의 신규 게시는 거절한다", async () => {
    const legacy = manifest();
    legacy.resourceVersion = "1.0.0-01";
    legacy.minimumStudioVersion = "0.1.0-002";
    const row = storedRow(legacy);
    repository.findById.mockResolvedValueOnce(row);

    await expect(service.getById(row.id)).resolves.toMatchObject({
      resourceVersion: "1.0.0-01",
      minimumStudioVersion: "0.1.0-002",
      manifestHash: digest(legacy),
    });
    await expect(service.publish(
      `publisher-${randomUUID()}`,
      legacy as PublishCreatorMarketplaceResourceDto
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(publishGate.acquire).not.toHaveBeenCalled();
  });

  it("owner-delisted exact UUID는 404로 숨기되 repository가 반환한 listed historical UUID는 공개한다", async () => {
    const listedHistorical = storedRow();
    repository.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(listedHistorical);

    await expect(service.getById(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.getById(listedHistorical.id)).resolves.toMatchObject({
      id: listedHistorical.id,
      packageId: listedHistorical.manifest.packageId,
    });
  });

  it("신고 주체 원문 대신 고정 digest로 DB admission과 release uniqueness를 요청한다", async () => {
    const reporterId = `reporter-${randomUUID()}`;
    const resourceId = randomUUID();
    const reportId = randomUUID();
    repository.report.mockResolvedValue({ reportId, createdAt: new Date() });

    await expect(service.report(reporterId, resourceId, {
      reason: "copyright",
      details: "권리자 확인이 필요합니다.",
    })).resolves.toEqual({ reported: true, reportId, status: "open" });

    expect(repository.report).toHaveBeenCalledWith(expect.objectContaining({
      resourceId,
      reporterId,
      reporterKeyHash: expect.any(Uint8Array),
      reason: "copyright",
      details: "권리자 확인이 필요합니다.",
    }));
    const input = repository.report.mock.calls[0]?.[0];
    expect(input?.reporterKeyHash).toHaveLength(32);
    expect(Buffer.from(input!.reporterKeyHash).toString("utf8")).not.toContain(
      reporterId
    );
  });

  it.each([
    ["not-found", 404, "creator_marketplace_report_target_not_found"],
    ["self-report", 400, "creator_marketplace_self_report_forbidden"],
    ["duplicate", 409, "creator_marketplace_report_duplicate"],
    ["rate-limited", 429, "creator_marketplace_report_rate_limited"],
  ] as const)("%s 신고 거절을 안정적인 HTTP 계약으로 변환한다", async (reason, status, code) => {
    repository.report.mockRejectedValueOnce(
      new CreatorMarketplaceResourceReportRejectedError(reason)
    );

    const error = await service.report("reporter", randomUUID(), {
      reason: "spam",
      details: "",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
  });

  it("검수 queue를 bounded page로 투영하고 삭제된 계정·리소스 증거를 보존한다", async () => {
    const resourceId = randomUUID();
    const evidence = {
      schemaVersion: 1 as const,
      resourceId,
      packageId: "original/brush/reported",
      name: "신고된 브러시",
      kind: "brush" as const,
      resourceVersion: "1.0.0",
      license: "toonspectrum-standard" as const,
      manifestHash: "a".repeat(64),
      manifestByteSize: 1_024,
      releaseCreatedAt: "2026-07-27T01:02:03.000Z",
    };
    repository.listModeration.mockResolvedValue([{
      reportId: randomUUID(),
      reason: "unsafe",
      details: "검토 필요",
      status: "open",
      resolutionNote: "",
      reporterId: null,
      reporterName: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date("2026-07-28T01:02:03.000Z"),
      evidence,
      currentResourceId: null,
      currentResourceHidden: null,
      currentResourceDelistedAt: null,
      currentPackagePublisherId: null,
      currentPackageId: null,
      currentPackageState: null,
      currentPackageRevision: null,
      currentPackageHiddenAt: null,
      currentPackageHeadId: null,
      currentPackageHeadDelistedAt: null,
      currentPackagePublisherStatus: null,
    }]);

    await expect(service.listModeration({
      status: "open",
      limit: 20,
      offset: 0,
    })).resolves.toMatchObject({
      items: [{
        reporter: { id: null, name: "탈퇴한 신고 회원" },
        evidence,
        currentResource: null,
      }],
      status: "open",
      hasMore: false,
      nextOffset: null,
    });
  });

  it("orphan report dismiss는 동일 snapshot 종결 수를 반환하고 attached/closed를 409로 숨긴다", async () => {
    const reportId = randomUUID();
    repository.dismissOrphanReport.mockResolvedValueOnce({
      reportId,
      dismissedReportCount: 3,
    });
    await expect(service.dismissOrphanReport("admin", reportId, {
      action: "dismiss",
      note: "원 게시자 계정 삭제",
    })).resolves.toEqual({
      dismissed: true,
      reportId,
      dismissedReportCount: 3,
    });
    expect(repository.dismissOrphanReport).toHaveBeenCalledWith({
      reportId,
      reviewerId: "admin",
      note: "원 게시자 계정 삭제",
    });

    for (const reason of ["attached", "closed"] as const) {
      repository.dismissOrphanReport.mockRejectedValueOnce(
        new CreatorMarketplaceOrphanReportDismissRejectedError(reason)
      );
      await expect(service.dismissOrphanReport("admin", reportId, {
        action: "dismiss",
        note: "종결",
      })).rejects.toBeInstanceOf(ConflictException);
    }
    repository.dismissOrphanReport.mockResolvedValueOnce(null);
    await expect(service.dismissOrphanReport("admin", reportId, {
      action: "dismiss",
      note: "종결",
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    [{ currentPackageHeadDelistedAt: new Date("2026-08-31T02:00:00.000Z") }, "owner-delisted"],
    [{ currentPackagePublisherStatus: "suspended" }, "publisher-unavailable"],
  ] as const)(
    "moderation queue는 reported historical row 대신 absolute package %s 가용성을 투영한다",
    async (override, reason) => {
      const historicalId = randomUUID();
      const headId = randomUUID();
      const reportId = randomUUID();
      repository.listModeration.mockResolvedValueOnce([{
        reportId,
        reason: "misleading",
        details: "과거 릴리스 신고",
        status: "open",
        resolutionNote: "",
        reporterId: "reporter-1",
        reporterName: "신고자",
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date("2026-08-31T01:00:00.000Z"),
        evidence: {
          schemaVersion: 1,
          resourceId: historicalId,
          packageId: "original/brush/reported",
          name: "신고된 브러시",
          kind: "brush",
          resourceVersion: "1.0.0",
          license: "toonspectrum-standard",
          manifestHash: "a".repeat(64),
          manifestByteSize: 1_024,
          releaseCreatedAt: "2026-08-30T01:00:00.000Z",
        },
        packagePublisherIdSnapshot: "publisher-1",
        packageIdSnapshot: "original/brush/reported",
        packageModerationRevision: 0,
        packageReportEpoch: null,
        currentResourceId: historicalId,
        currentResourceHidden: false,
        currentResourceDelistedAt: null,
        currentPackagePublisherId: "publisher-1",
        currentPackageId: "original/brush/reported",
        currentPackageState: "active",
        currentPackageRevision: 0,
        currentPackageHiddenAt: null,
        currentPackageHeadId: headId,
        currentPackageHeadDelistedAt: null,
        currentPackagePublisherStatus: "active",
        ...override,
      }]);

      await expect(service.listModeration({
        status: "open",
        limit: 20,
        offset: 0,
      })).resolves.toMatchObject({
        items: [{
          currentResource: { id: historicalId, delistedAt: null },
          currentPackage: {
            moderationTargetId: headId,
            availability: { state: "unavailable", reason },
          },
        }],
      });
    },
  );

  it("관리자 hide/restore 결과에서 소유자 delist 상태를 별도로 보존한다", async () => {
    repository.moderate.mockResolvedValueOnce({
      publisherId: "publisher-1",
      packageId: "original/brush/ink-starter",
      packageState: "hidden",
      packageRevision: 1,
      packageHiddenAt: new Date("2026-07-30T00:00:00.000Z"),
      changed: true,
      decisionId: "123e4567-e89b-42d3-a456-426614174077",
      hidden: true,
      delisted: true,
      reviewedReportCount: 2,
    });
    const resourceId = randomUUID();
    const sourceReportId = randomUUID();

    await expect(service.moderate("admin", resourceId, {
      action: "hide",
      sourceReportId,
      note: "침해 확인",
    })).resolves.toEqual({
      moderated: true,
      scope: "package",
      action: "hide",
      changed: true,
      hidden: true,
      delisted: true,
      reviewedReportCount: 2,
      decisionId: "123e4567-e89b-42d3-a456-426614174077",
      package: {
        publisherId: "publisher-1",
        packageId: "original/brush/ink-starter",
        moderation: {
          state: "hidden",
          revision: 1,
          hiddenAt: "2026-07-30T00:00:00.000Z",
        },
      },
    });
    expect(repository.moderate).toHaveBeenCalledWith({
      resourceId,
      reviewerId: "admin",
      action: "hide",
      sourceReportId,
      note: "침해 확인",
    });

    repository.moderate.mockResolvedValueOnce(null);
    await expect(service.moderate("admin", randomUUID(), {
      action: "restore",
      note: "오탐 확인",
    })).rejects.toBeInstanceOf(NotFoundException);
  });
});
