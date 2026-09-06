import { createHash, randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";


import {
  InvalidCreatorMarketplaceListQueryError,
  acquireCreatorMarketplaceCloudLibraryRelease,
  confirmCreatorMarketplaceStudioInstall,
  createCreatorMarketplaceBuiltinDelivery,
  createCreatorMarketplacePortableDelivery,
  deleteCreatorMarketplaceResource,
  dismissOrphanedReport,
  getCreatorMarketplaceResource,
  getCreatorMarketplaceResourceHistory,
  getCreatorMarketplaceResourceIdentity,
  listCreatorMarketplaceOwnedHeads,
  listCreatorMarketplaceOwnedHistory,
  listCreatorMarketplaceModerationQueue,
  listCreatorMarketplaceCloudLibrary,
  listCreatorMarketplaceResources,
  listMyCreatorMarketplaceResources,
  moderateCreatorMarketplaceResource,
  normalizeCreatorMarketplaceListParams,
  publishCreatorMarketplaceResource,
  relistCreatorMarketplaceResource,
  reportCreatorMarketplaceResource,
  resolveCreatorMarketplaceCloudLibraryAcquisitionTarget,
  setCreatorMarketplaceCloudLibraryArchived,
} from "./creator-marketplace-client";
import { creatorMarketplaceReportErrorCode } from "./creator-marketplace-report-error";
import { NotFoundError } from "./use-api-resource";

import type {
  CreatorMarketplaceResourceManifest,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "@/shared/lib/creator-marketplace-resource-contract";

const { apiDelete, apiGet, apiPatch, apiPost, getApiErrorMessage, toApiError } = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  getApiErrorMessage: vi.fn(async (error: unknown, fallback: string) => {
    if (error && typeof error === "object" && "data" in error) {
      const message = (error as { data?: { message?: unknown } }).data?.message;
      if (typeof message === "string") return message;
    }
    return fallback;
  }),
  toApiError: vi.fn(async (error: unknown, fallback: string) =>
    new Error(fallback, { cause: error })
  ),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: {
    delete: apiDelete,
    get: apiGet,
    patch: apiPatch,
    post: apiPost,
  },
  getApiErrorMessage,
  toApiError,
}));

async function manifest(): Promise<CreatorMarketplaceResourceManifest> {
  const delivery = await createCreatorMarketplacePortableDelivery("filter", {
    engine: "studio-filter-stack-v1",
    values: {
      pipeline: ["levels", "halftone"],
      strength: 0.65,
    },
  });
  return {
    schemaVersion: 1,
    packageId: "original/filter/webtoon-finish",
    name: "웹툰 마감 필터",
    description: "portable JSON 필터",
    kind: "filter",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["마감"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["webgpu", "webgl2"] },
    entries: [{
      id: "filter/webtoon-finish",
      kind: "filter",
      name: "웹툰 마감",
      delivery,
    }],
  };
}

function record(input: CreatorMarketplaceResourceManifest): CreatorMarketplaceResourceRecord {
  const {
    rightsConfirmed: _rightsConfirmed,
    ...publicManifest
  } = input;
  return {
    ...publicManifest,
    id: randomUUID(),
    manifestHash: createHash("sha256")
      .update(canonicalizeCreatorMarketplaceJson(input))
      .digest("hex"),
    manifestByteSize: creatorMarketplaceJsonByteSize(input),
    publisher: { id: "author", name: "작가", avatar: null },
    createdAt: "2026-07-27T01:00:00.000Z",
    updatedAt: "2026-07-27T01:00:00.000Z",
    isOwner: true,
    access: "free",
  };
}

describe("creator marketplace client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("실제 portable JSON payload의 canonical 크기·SHA-256을 생성한다", async () => {
    const left = await createCreatorMarketplacePortableDelivery("brush", {
      snapshot: {
        z: 2,
        a: { y: true, x: 1 },
      },
    });
    const right = await createCreatorMarketplacePortableDelivery("brush", {
      snapshot: {
        a: { x: 1, y: true },
        z: 2,
      },
    });

    expect(left.mode).toBe("portable-json");
    expect(left.payload).toMatchObject({
      schemaVersion: 1,
      resourceKind: "brush",
      runtime: "studio-brush-v1",
      definition: { snapshot: { z: 2 } },
    });
    expect(left.sha256).toBe(right.sha256);
    expect(left.byteSize).toBe(right.byteSize);
  });

  it("목록 필터를 API 계약대로 정규화하고 의미가 달라지는 값은 거절한다", () => {
    expect(normalizeCreatorMarketplaceListParams({
      search: "  잉크  ",
      tag: "  수채화  ",
      kind: "brush",
      license: "cc0-1.0",
      publisher: "123E4567-E89B-42D3-A456-426614174000",
      sort: " relevance " as never,
    })).toMatchObject({
      search: "잉크",
      tag: "수채화",
      kind: "brush",
      license: "cc0-1.0",
      publisher: "123e4567-e89b-42d3-a456-426614174000",
      sort: "relevance",
    });

    for (const [field, params] of [
      ["search", {
        search: "s".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS + 1),
      }],
      ["tag", {
        tag: "t".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS + 1),
      }],
      ["kind", { kind: "unknown" }],
      ["license", { license: "commercial" }],
      ["publisher", { publisher: "not-a-uuid" }],
      ["sort", { sort: "popular" }],
    ] as const) {
      try {
        normalizeCreatorMarketplaceListParams(params as never);
        throw new Error("expected invalid query");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCreatorMarketplaceListQueryError);
        expect((error as InvalidCreatorMarketplaceListQueryError).field).toBe(field);
      }
    }

    expect(() => normalizeCreatorMarketplaceListParams({ sort: "relevance" }))
      .toThrow(InvalidCreatorMarketplaceListQueryError);
  });

  it("invalid list filters fail before the network chunk can issue an unfiltered request", async () => {
    await expect(listCreatorMarketplaceResources({
      search: "s".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS + 1),
    })).rejects.toBeInstanceOf(InvalidCreatorMarketplaceListQueryError);

    expect(apiGet).not.toHaveBeenCalled();
  });

  it("2D/3D는 portable binary 대신 procedural-recipe delivery를 만든다", async () => {
    await expect(
      createCreatorMarketplacePortableDelivery("asset", {
        recipeId: "rounded-rect",
        parameters: { paletteRef: "builtin/palette/noir" },
      })
    ).resolves.toMatchObject({
      mode: "procedural-recipe",
      mediaType: "application/vnd.toonspectrum.asset+json",
    });
  });

  it("builtin-ref도 canonical runtimeRef digest를 생성한다", async () => {
    const left = await createCreatorMarketplaceBuiltinDelivery(
      "template",
      "studio-scene-template:webtoon-basic"
    );
    const right = await createCreatorMarketplaceBuiltinDelivery(
      "template",
      "studio-scene-template:webtoon-basic"
    );
    const changed = await createCreatorMarketplaceBuiltinDelivery(
      "template",
      "studio-scene-template:webtoon-action"
    );

    expect(left).toMatchObject({
      mode: "builtin-ref",
      runtimeRef: "studio-scene-template:webtoon-basic",
      byteSize: 0,
    });
    expect(left.sha256).toBe(right.sha256);
    expect(left.sha256).not.toBe(changed.sha256);
  });

  it("브라우저 SubtleCrypto와 Node가 같은 canonical SHA-256을 만든다", async () => {
    const delivery = await createCreatorMarketplacePortableDelivery("palette", {
      colors: ["#111827", "#ef4444", "#f8fafc"],
    });
    const expected = createHash("sha256")
      .update(canonicalizeCreatorMarketplaceJson(delivery.payload))
      .digest("hex");

    expect(delivery.sha256).toBe(expected);
  });

  it("잘못된 built-in prefix와 종류별 definition을 client 경계에서 거절한다", async () => {
    await expect(
      createCreatorMarketplaceBuiltinDelivery("template", "studio-asset:wrong")
    ).rejects.toThrow("built-in");
    await expect(
      createCreatorMarketplacePortableDelivery("filter", {
        engine: "studio-filter-stack-v1",
        values: {},
      })
    ).rejects.toThrow();
  });

  it("공개/내 목록의 cursor·필터·AbortSignal을 API에 전달하고 응답을 검증한다", async () => {
    const controller = new AbortController();
    apiGet.mockResolvedValue({ items: [], limit: 12, hasMore: false, nextCursor: null });

    await listCreatorMarketplaceResources({
      limit: 12,
      cursor: "cursor_1",
      tag: "  수채화  ",
      kind: "brush",
      license: "cc0-1.0",
      publisher: "123E4567-E89B-42D3-A456-426614174000",
      sort: "newest",
    }, controller.signal);
    await listMyCreatorMarketplaceResources({
      search: "  잉크  ",
      sort: "relevance",
    }, controller.signal);

    expect(apiGet).toHaveBeenNthCalledWith(1, "/creator/marketplace/resources", {
      params: {
        limit: 12,
        cursor: "cursor_1",
        search: undefined,
        tag: "수채화",
        kind: "brush",
        license: "cc0-1.0",
        publisher: "123e4567-e89b-42d3-a456-426614174000",
        sort: "newest",
      },
      signal: controller.signal,
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      "/creator/marketplace/resources/mine",
      expect.objectContaining({
        params: expect.objectContaining({ search: "잉크", sort: "relevance" }),
        signal: controller.signal,
      })
    );
  });

  it("게시 payload와 반환 record 모두 strict contract로 검증하고 실제 콘텐츠를 보존한다", async () => {
    const input = await manifest();
    const response = record(input);
    apiPost.mockResolvedValue(response);

    await expect(publishCreatorMarketplaceResource(input)).resolves.toMatchObject({
      entries: [{
        delivery: {
          mode: "portable-json",
          payload: {
            schemaVersion: 1,
            resourceKind: "filter",
            runtime: "studio-filter-v1",
            definition: {
              engine: "studio-filter-stack-v1",
              values: {
                pipeline: ["levels", "halftone"],
                strength: 0.65,
              },
            },
          },
        },
      }],
    });
    expect(apiPost).toHaveBeenCalledWith(
      "/creator/marketplace/resources",
      input,
      { signal: undefined }
    );

    apiPost.mockResolvedValue({ ...response, leaked: true });
    await expect(publishCreatorMarketplaceResource(input)).rejects.toThrow();
  });

  it("delist id를 인코딩하고 네트워크 오류를 안전한 메시지로 변환한다", async () => {
    apiDelete.mockResolvedValue(undefined);
    await deleteCreatorMarketplaceResource("123e4567-e89b-42d3-a456-426614174000");
    expect(apiDelete).toHaveBeenCalledWith(
      "/creator/marketplace/resources/123e4567-e89b-42d3-a456-426614174000"
    );

    apiDelete.mockRejectedValue(new Error("private upstream"));
    await expect(deleteCreatorMarketplaceResource("id/with/slash"))
      .rejects.toThrow("공유 리소스를 마켓 목록에서 내리지 못했습니다.");
  });

  it("단건 조회는 record를 검증해 돌려주고 404는 NotFoundError로 흐름 제어한다", async () => {
    const input = await manifest();
    const response = record(input);
    const id = response.id;
    apiGet.mockResolvedValueOnce(response).mockRejectedValueOnce({
      response: { status: 404 },
    });

    await expect(getCreatorMarketplaceResource(id)).resolves.toMatchObject({
      id,
      packageId: "original/filter/webtoon-finish",
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      `/creator/marketplace/resources/${id}`,
      { signal: undefined }
    );

    await expect(getCreatorMarketplaceResource(id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("단건 조회의 5xx는 일반 에러 메시지로 변환한다", async () => {
    toApiError.mockImplementationOnce(
      async (_error: unknown, fallback: string) => new Error(fallback)
    );
    apiGet.mockRejectedValueOnce({ response: { status: 503 } });

    await expect(getCreatorMarketplaceResource(randomUUID())).rejects.toThrow(
      "공유 리소스를 불러오지 못했습니다."
    );
  });

  it("exact identity는 정적 경로와 strict payload를 사용하고 404를 보존한다", async () => {
    const id = randomUUID();
    const identity = {
      id,
      publisherId: "publisher-1",
      packageId: "original/filter/webtoon-finish",
      kind: "filter" as const,
      availability: "owner-delisted" as const,
    };
    const signal = new AbortController().signal;
    apiGet.mockResolvedValueOnce(identity);

    await expect(getCreatorMarketplaceResourceIdentity(id, signal)).resolves.toEqual(identity);
    expect(apiGet).toHaveBeenLastCalledWith(
      `/creator/marketplace/resources/identity/${id}`,
      { signal },
    );

    apiGet.mockResolvedValueOnce({ ...identity, manifestHash: "b".repeat(64) });
    await expect(getCreatorMarketplaceResourceIdentity(id)).rejects.toThrow();
    apiGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(getCreatorMarketplaceResourceIdentity(id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const calls = apiGet.mock.calls.length;
    await expect(getCreatorMarketplaceResourceIdentity("not-a-uuid")).rejects.toThrow();
    expect(apiGet).toHaveBeenCalledTimes(calls);
  });

  it("신고 payload와 응답을 strict 검증하고 중복 코드를 보존한다", async () => {
    const resourceId = randomUUID();
    const reportId = randomUUID();
    apiPost.mockResolvedValueOnce({ reported: true, reportId, status: "open" });

    await expect(reportCreatorMarketplaceResource(resourceId, {
      reason: "misleading",
      details: "  실제 패키지 설명과 다릅니다.  ",
    })).resolves.toEqual({ reported: true, reportId, status: "open" });
    expect(apiPost).toHaveBeenLastCalledWith(
      `/creator/marketplace/resources/${resourceId}/report`,
      { reason: "misleading", details: "실제 패키지 설명과 다릅니다." },
      { signal: undefined },
    );

    apiPost.mockResolvedValueOnce({
      reported: true,
      reportId,
      status: "open",
      leaked: true,
    });
    await expect(reportCreatorMarketplaceResource(resourceId, {
      reason: "other",
    })).rejects.toThrow();

    apiPost.mockRejectedValueOnce({
      data: {
        code: "creator_marketplace_report_duplicate",
        message: "현재 패키지 릴리스 주기에서 이미 신고했습니다.",
      },
    });
    const duplicate = await reportCreatorMarketplaceResource(resourceId, {
      reason: "spam",
    }).catch((error: unknown) => error);
    expect(duplicate).toBeInstanceOf(Error);
    expect(creatorMarketplaceReportErrorCode(duplicate))
      .toBe("creator_marketplace_report_duplicate");
    expect((duplicate as Error).message)
      .toBe("현재 패키지 릴리스 주기에서 이미 신고했습니다.");
  });

  it("검수 목록과 hide/restore/dismiss 액션을 strict 계약으로 왕복한다", async () => {
    const resourceId = randomUUID();
    const reportId = randomUUID();
    const queuePage = {
      items: [{
        reportId,
        reason: "unsafe",
        details: "위험한 외부 안내가 있습니다.",
        status: "open",
        resolutionNote: "",
        reporter: { id: "reporter-1", name: "신고자" },
        reviewedBy: null,
        reviewedAt: null,
        createdAt: "2026-08-31T01:00:00.000Z",
        evidence: {
          schemaVersion: 1,
          resourceId,
          packageId: "original/brush/unsafe",
          name: "검수 브러시",
          kind: "brush",
          resourceVersion: "1.0.0",
          license: "toonspectrum-standard",
          manifestHash: "a".repeat(64),
          manifestByteSize: 512,
          releaseCreatedAt: "2026-08-30T01:00:00.000Z",
        },
        currentResource: { id: resourceId, hidden: false, delistedAt: null },
        currentPackage: {
          publisherId: "publisher-1",
          packageId: "original/brush/unsafe",
          moderationTargetId: resourceId,
          moderation: { state: "active", revision: 0, hiddenAt: null },
          availability: {
            state: "available",
            currentHead: { id: resourceId },
          },
        },
      }],
      status: "open",
      limit: 10,
      offset: 20,
      hasMore: true,
      nextOffset: 30,
    } as const;
    apiGet.mockResolvedValueOnce(queuePage);

    await expect(listCreatorMarketplaceModerationQueue({
      status: "open",
      limit: 10,
      offset: 20,
    })).resolves.toEqual(queuePage);
    expect(apiGet).toHaveBeenLastCalledWith(
      "/creator/marketplace/resources/moderation",
      { params: { status: "open", limit: 10, offset: 20 }, signal: undefined },
    );

    apiPatch.mockResolvedValueOnce({
      moderated: true,
      scope: "package",
      action: "hide",
      changed: true,
      hidden: true,
      delisted: false,
      reviewedReportCount: 2,
      decisionId: randomUUID(),
      package: {
        publisherId: "publisher-1",
        packageId: "original/brush/unsafe",
        moderation: {
          state: "hidden",
          revision: 1,
          hiddenAt: "2026-08-31T02:00:00.000Z",
        },
      },
    });
    await expect(moderateCreatorMarketplaceResource(resourceId, {
      action: "hide",
      sourceReportId: reportId,
      note: "  외부 링크 검증 전까지 숨김 처리  ",
    })).resolves.toMatchObject({ action: "hide", reviewedReportCount: 2 });
    expect(apiPatch).toHaveBeenLastCalledWith(
      `/creator/marketplace/resources/${resourceId}/moderation`,
      {
        action: "hide",
        sourceReportId: reportId,
        note: "외부 링크 검증 전까지 숨김 처리",
      },
      { signal: undefined },
    );

    apiGet.mockResolvedValueOnce({ ...queuePage, privateLeak: true });
    await expect(listCreatorMarketplaceModerationQueue({ limit: 10, offset: 20 }))
      .rejects.toThrow();
    await expect(moderateCreatorMarketplaceResource(resourceId, {
      action: "dismiss",
      note: "   ",
    })).rejects.toThrow();
    expect(apiPatch).toHaveBeenCalledTimes(1);
  });

  it("원본 릴리스가 없는 신고는 report id 전용 dismiss 계약으로만 종결한다", async () => {
    const reportId = randomUUID();
    apiPatch.mockResolvedValueOnce({
      dismissed: true,
      reportId,
      dismissedReportCount: 1,
    });

    await expect(dismissOrphanedReport(
      reportId,
      "  원본 행이 없어 보존 증거를 확인한 뒤 신고만 종결  ",
    )).resolves.toEqual({
      dismissed: true,
      reportId,
      dismissedReportCount: 1,
    });
    expect(apiPatch).toHaveBeenLastCalledWith(
      `/creator/marketplace/resources/moderation/reports/${reportId}`,
      {
        action: "dismiss",
        note: "원본 행이 없어 보존 증거를 확인한 뒤 신고만 종결",
      },
      { signal: undefined },
    );

    apiPatch.mockResolvedValueOnce({
      dismissed: true,
      reportId,
      dismissedReportCount: 1,
      leaked: true,
    });
    await expect(dismissOrphanedReport(reportId, "증거 확인 완료"))
      .rejects.toThrow();

    await expect(dismissOrphanedReport(reportId, "   ")).rejects.toThrow();
    expect(apiPatch).toHaveBeenCalledTimes(2);
  });

  it("public/owned release history와 owned heads를 정적 라우트에서 strict 검증한다", async () => {
    const input = await manifest();
    const ownedResource = record(input);
    const release = {
      resource: ownedResource,
      releaseOrdinal: 2,
      hidden: false,
      delistedAt: null,
      packageModeration: { state: "active", revision: 0, hiddenAt: null },
    };
    const controller = new AbortController();
    apiGet
      .mockResolvedValueOnce({
        items: [release],
        limit: 10,
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        packageId: ownedResource.packageId,
        items: [release],
        limit: 10,
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        packageId: ownedResource.packageId,
        anchor: {
          id: ownedResource.id,
          resourceVersion: ownedResource.resourceVersion,
          listed: true,
        },
        items: [{
          id: ownedResource.id,
          releaseOrdinal: 2,
          name: ownedResource.name,
          resourceVersion: ownedResource.resourceVersion,
          minimumStudioVersion: ownedResource.minimumStudioVersion,
          manifestHash: ownedResource.manifestHash,
          createdAt: ownedResource.createdAt,
          selected: true,
        }],
        limit: 10,
        hasMore: false,
        nextCursor: null,
      });

    await expect(listCreatorMarketplaceOwnedHeads({
      limit: 10,
      search: "  웹툰  ",
      sort: "relevance",
    }, controller.signal)).resolves.toMatchObject({ items: [release] });
    await expect(listCreatorMarketplaceOwnedHistory({
      packageId: ownedResource.packageId,
      limit: 10,
      cursor: 3,
    }, controller.signal)).resolves.toMatchObject({ packageId: ownedResource.packageId });
    await expect(getCreatorMarketplaceResourceHistory(ownedResource.id, {
      limit: 10,
      cursor: 3,
    }, controller.signal)).resolves.toMatchObject({
      anchor: { id: ownedResource.id, listed: true },
    });

    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      "/creator/marketplace/resources/mine/heads",
      {
        params: {
          limit: 10,
          cursor: undefined,
          search: "웹툰",
          tag: undefined,
          kind: undefined,
          license: undefined,
          sort: "relevance",
        },
        signal: controller.signal,
      },
    );
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      "/creator/marketplace/resources/mine/history",
      {
        params: { packageId: ownedResource.packageId, limit: 10, cursor: 3 },
        signal: controller.signal,
      },
    );
    expect(apiGet).toHaveBeenNthCalledWith(
      3,
      `/creator/marketplace/resources/history/${ownedResource.id}`,
      { params: { limit: 10, cursor: 3 }, signal: controller.signal },
    );

    apiGet.mockResolvedValueOnce({
      items: [release],
      limit: 10,
      hasMore: false,
      nextCursor: null,
      leaked: true,
    });
    await expect(listCreatorMarketplaceOwnedHeads({ limit: 10 })).rejects.toThrow();
  });

  it("history query bounds/package ids fail before fetch and relist parses its receipt", async () => {
    const id = randomUUID();
    apiPost.mockResolvedValueOnce({
      relisted: true,
      changed: true,
      id,
      delistedAt: null,
    });
    await expect(relistCreatorMarketplaceResource(id)).resolves.toEqual({
      relisted: true,
      changed: true,
      id,
      delistedAt: null,
    });
    expect(apiPost).toHaveBeenLastCalledWith(
      `/creator/marketplace/resources/${id}/relist`,
      undefined,
      { signal: undefined },
    );

    const getCalls = apiGet.mock.calls.length;
    await expect(getCreatorMarketplaceResourceHistory("not-a-uuid"))
      .rejects.toThrow();
    await expect(getCreatorMarketplaceResourceHistory(id, { cursor: 0 }))
      .rejects.toThrow();
    await expect(listCreatorMarketplaceOwnedHistory({
      packageId: "invalid package id",
      limit: 10,
    })).rejects.toThrow();
    await expect(listCreatorMarketplaceOwnedHeads({ limit: 21 }))
      .rejects.toThrow();
    expect(apiGet).toHaveBeenCalledTimes(getCalls);

    apiGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(listCreatorMarketplaceOwnedHistory({
      packageId: "community/brush/not-yet-published",
      limit: 1,
    })).rejects.toBeInstanceOf(NotFoundError);

    apiPost.mockResolvedValueOnce({
      relisted: true,
      changed: false,
      id,
      delistedAt: null,
      extra: true,
    });
    await expect(relistCreatorMarketplaceResource(id)).rejects.toThrow();
  });

  it("계정 라이브러리 조회·취득·설치 확인·보관을 private strict 계약으로 왕복한다", async () => {
    const releaseId = randomUUID();
    const libraryItemId = randomUUID();
    const logicalPackId = `community:${"a".repeat(64)}`;
    const signal = new AbortController().signal;
    const updatedAt = "2026-08-31T03:00:00.000Z";
    const libraryPage = {
      items: [{
        id: libraryItemId,
        logicalPackId,
        packageId: "original/brush/cloud-ink",
        name: "클라우드 잉크",
        kind: "brush",
        membership: "active",
        addedFrom: {
          releaseId,
          resourceVersion: "1.0.0",
          releaseOrdinal: 1,
          manifestHash: "b".repeat(64),
        },
        addedAt: updatedAt,
        archivedAt: null,
        confirmation: { state: "none" },
        catalog: {
          state: "available",
          head: {
            id: releaseId,
            name: "클라우드 잉크",
            kind: "brush",
            resourceVersion: "1.0.0",
            minimumStudioVersion: "1.0.0",
            releaseOrdinal: 1,
            manifestHash: "b".repeat(64),
          },
        },
        updateState: "no-account-confirmation",
      }],
      limit: 1,
      hasMore: false,
      nextCursor: null,
    } as const;
    apiGet.mockResolvedValueOnce(libraryPage);

    await expect(listCreatorMarketplaceCloudLibrary({
      view: "all",
      limit: 1,
      logicalPackId,
    }, signal)).resolves.toEqual(libraryPage);
    expect(apiGet).toHaveBeenLastCalledWith(
      "/creator/marketplace/library",
      {
        params: {
          view: "all",
          limit: 1,
          cursor: undefined,
          logicalPackId,
        },
        signal,
      },
    );

    apiPost.mockResolvedValueOnce({
      operation: "acquire",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId,
      logicalPackId,
      updatedAt,
    });
    await expect(acquireCreatorMarketplaceCloudLibraryRelease(releaseId, signal))
      .resolves.toMatchObject({ operation: "acquire", libraryScope: "account" });

    const acquisitionTarget = {
      state: "available" as const,
      requestReleaseId: releaseId,
      publisherId: "publisher-1",
      packageId: "publisher/brush/ink",
      kind: "brush" as const,
      logicalPackId,
      currentHead: {
        id: "423e4567-e89b-42d3-a456-426614174000",
        resourceVersion: "2.0.0",
      },
    };
    apiGet.mockResolvedValueOnce(acquisitionTarget);
    await expect(resolveCreatorMarketplaceCloudLibraryAcquisitionTarget(
      releaseId,
      signal,
    )).resolves.toEqual(acquisitionTarget);
    expect(apiGet).toHaveBeenLastCalledWith(
      `/creator/marketplace/library/acquisition-target/${releaseId}`,
      { signal },
    );

    const confirmationInput = {
      schemaVersion: 1 as const,
      logicalPackId,
      packageFingerprint: "b".repeat(64),
    };
    apiPost.mockResolvedValueOnce({
      operation: "confirm-studio-install",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId,
      logicalPackId,
      updatedAt,
      acknowledgement: {
        releaseId,
        manifestHash: "b".repeat(64),
      },
      confirmation: {
        scope: "account-ever",
        releaseId,
        resourceVersion: "1.0.0",
        releaseOrdinal: 1,
        manifestHash: "b".repeat(64),
        confirmedAt: updatedAt,
      },
    });
    await expect(confirmCreatorMarketplaceStudioInstall(
      releaseId,
      confirmationInput,
      signal,
    )).resolves.toMatchObject({
      operation: "confirm-studio-install",
      confirmation: { scope: "account-ever" },
    });
    expect(apiPost).toHaveBeenLastCalledWith(
      `/creator/marketplace/library/install-confirmations/${releaseId}`,
      confirmationInput,
      { signal },
    );

    apiPatch.mockResolvedValueOnce({
      operation: "set-archive",
      changed: true,
      membership: "archived",
      libraryScope: "account",
      libraryItemId,
      logicalPackId,
      updatedAt,
    });
    await expect(setCreatorMarketplaceCloudLibraryArchived(
      libraryItemId,
      true,
      signal,
    )).resolves.toMatchObject({ operation: "set-archive", membership: "archived" });

    apiGet.mockResolvedValueOnce({ ...libraryPage, leaked: true });
    await expect(listCreatorMarketplaceCloudLibrary({ limit: 1 })).rejects.toThrow();
  });
});
