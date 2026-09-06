import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkRevisionConflictError,
  WorkRevisionResponseContractError,
  createWork,
  getSharedAssetContent,
  getWorkRevisionComparison,
  getWorkRevision,
  listSharedAssetCatalog,
  listSharedAssetModerationQueue,
  moderateSharedAsset,
  listWorkRevisions,
  publishAsset,
  reportSharedAsset,
  restoreWorkRevision,
  updateWork,
} from "./creator-client";

import { CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES } from "@/shared/lib/creator-asset-contract";

const { apiGet, apiPatch, apiPost, createStudioSharedAssetPreview, toApiError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  createStudioSharedAssetPreview: vi.fn(async () => ({
    previewDataUrl: "data:image/webp;base64,cHJldmlldw==",
    previewWidth: 160,
    previewHeight: 120,
  })),
  toApiError: vi.fn(async () => new Error("안전한 API 오류")),
}));

vi.mock("@/src/domains/creator/studio-shared-asset-preview", () => ({
  createStudioSharedAssetPreview,
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: {
    delete: vi.fn(),
    get: apiGet,
    patch: apiPatch,
    post: apiPost,
  },
  isHttpError: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { httpError?: boolean }).httpError),
  toApiError,
}));

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_1X1.split(",")[1]!, "base64");
const PNG_HASH = createHash("sha256").update(PNG_BYTES).digest("hex");

function conflictError(currentRevision: unknown, extra: Record<string, unknown> = {}) {
  return {
    httpError: true,
    response: { status: 409 },
    data: {
      code: "creator_work_revision_conflict",
      currentRevision,
      ...extra,
    },
  };
}

describe("creator client revision conflicts", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    createStudioSharedAssetPreview.mockClear();
    toApiError.mockClear();
  });

  it("update 409를 현재 revision만 가진 전용 충돌 오류로 변환한다", async () => {
    apiPatch.mockRejectedValue(conflictError(8, { snapshot: { privateNote: "secret" } }));

    const error = await updateWork("work/1", { title: "수정", baseRevision: 7 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkRevisionConflictError);
    expect((error as WorkRevisionConflictError).currentRevision).toBe(8);
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(apiPatch).toHaveBeenCalledWith("/creator/works/work%2F1", {
      title: "수정",
      baseRevision: 7,
    });
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("restore 409도 update와 같은 충돌 오류로 변환한다", async () => {
    apiPost.mockRejectedValue(conflictError(11));

    const error = await restoreWorkRevision("work-1", 3, 10)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkRevisionConflictError);
    expect((error as WorkRevisionConflictError).currentRevision).toBe(11);
    expect(apiPost).toHaveBeenCalledWith(
      "/creator/works/work-1/revisions/3/restore",
      { baseRevision: 10 }
    );
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("malformed 409 payload는 신뢰하지 않고 일반 안전 오류 경로로 보낸다", async () => {
    apiPatch.mockRejectedValue(conflictError("8", { providerSecret: "private" }));

    await expect(updateWork("work-1", { title: "수정", baseRevision: 7 }))
      .rejects.toThrow("안전한 API 오류");
    expect(toApiError).toHaveBeenCalledOnce();
  });

  it("create/update/restore mutation에 전달된 AbortSignal을 HTTP 요청까지 보존한다", async () => {
    const controller = new AbortController();
    const createInput = {
      title: "새 작품",
      description: "설명",
      tags: ["웹툰"],
      format: "cuttoon" as const,
      cover: "data:image/png;base64,cover",
      pages: ["data:image/png;base64,page"],
      doc: { pagesList: [] },
      status: "draft",
    };
    apiPost.mockResolvedValueOnce({ id: "created" });
    apiPatch.mockResolvedValueOnce({ id: "updated" });
    apiPost.mockResolvedValueOnce({ id: "restored" });

    await createWork(createInput, controller.signal);
    await updateWork("work/1", { title: "수정", baseRevision: 7 }, controller.signal);
    await restoreWorkRevision("work/1", 3, 7, controller.signal);

    expect(apiPost).toHaveBeenNthCalledWith(1, "/creator/works", createInput, {
      signal: controller.signal,
    });
    expect(apiPatch).toHaveBeenCalledWith(
      "/creator/works/work%2F1",
      { title: "수정", baseRevision: 7 },
      { signal: controller.signal }
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/creator/works/work%2F1/revisions/3/restore",
      { baseRevision: 7 },
      { signal: controller.signal }
    );
  });

  it("공유 에셋 업로드에도 AbortSignal을 전달해 멈춘 요청을 취소할 수 있다", async () => {
    const controller = new AbortController();
    const input = {
      name: "[3D_POSE] 테스트",
      dataUrl: "data:image/png;base64,pose",
      width: 360,
      height: 520,
      kind: "vrm_pose",
      license: "toonspectrum-standard" as const,
      rightsConfirmed: true as const,
    };
    apiPost.mockResolvedValue({ id: "shared-pose" });

    await publishAsset(input, controller.signal);

    expect(createStudioSharedAssetPreview).toHaveBeenCalledWith(input.dataUrl);
    expect(apiPost).toHaveBeenCalledWith("/creator/assets", {
      ...input,
      previewDataUrl: "data:image/webp;base64,cHJldmlldw==",
      previewWidth: 160,
      previewHeight: 120,
    }, {
      signal: controller.signal,
    });
  });

  it("원본 content 경로를 인코딩하고 응답 id·크기 계약을 검증한다", async () => {
    const controller = new AbortController();
    apiGet.mockResolvedValueOnce({
      id: "asset/a",
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash: PNG_HASH,
    });

    await expect(getSharedAssetContent("asset/a", controller.signal)).resolves.toMatchObject({
      id: "asset/a",
      width: 1,
      height: 1,
    });
    expect(apiGet).toHaveBeenCalledWith("/creator/assets/asset%2Fa/content", {
      signal: controller.signal,
    });

    apiGet.mockResolvedValueOnce({
      id: "wrong-id",
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
      contentHash: PNG_HASH,
    });
    await expect(getSharedAssetContent("asset/a")).rejects.toThrow("응답이 올바르지");
  });

  it("카탈로그 검색·페이지와 신고·검수 경로를 인코딩해 전송한다", async () => {
    const controller = new AbortController();
    const page = { items: [], limit: 20, offset: 40, hasMore: false, nextOffset: null };
    apiGet.mockResolvedValueOnce(page);
    apiPost.mockResolvedValueOnce({ reported: true, reportCount: 1 });
    apiPatch.mockResolvedValueOnce({ updated: true, status: "rejected" });

    await expect(listSharedAssetCatalog({
      limit: 20,
      offset: 40,
      search: "골목",
      license: "cc-by-4.0",
      sort: "popular",
    }, controller.signal)).resolves.toEqual(page);
    await reportSharedAsset("asset/a", { reason: "copyright", details: "권리 표기 확인" });
    await moderateSharedAsset("asset/a", { status: "rejected", note: "권리 확인 실패" });

    expect(apiGet).toHaveBeenCalledWith("/creator/assets/catalog", {
      params: {
      mine: undefined,
      limit: 20,
      offset: 40,
      search: "골목",
      tag: undefined,
      license: "cc-by-4.0",
      kind: undefined,
        sort: "popular",
      },
      signal: controller.signal,
    });
    expect(apiPost).toHaveBeenCalledWith("/creator/assets/asset%2Fa/report", {
      reason: "copyright",
      details: "권리 표기 확인",
    });
    expect(apiPatch).toHaveBeenCalledWith("/creator/assets/asset%2Fa/moderation", {
      status: "rejected",
      note: "권리 확인 실패",
    });
  });

  it("카탈로그에서 검증된 raster preview만 남기고 SVG·위장 MIME item은 제거한다", async () => {
    const valid = {
      id: "valid",
      name: "검증 에셋",
      description: "",
      tags: [],
      width: 1,
      height: 1,
      kind: "image",
      previewDataUrl: PNG_1X1,
      previewWidth: 1,
      previewHeight: 1,
      previewAvailable: true,
      downloads: 0,
      reportCount: 0,
      license: "cc-by-4.0",
      licenseLabel: "CC BY",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attributionRequired: true,
      commercialUse: true,
      attributionText: "작가",
      containsAi: false,
      moderationStatus: "published",
      author: { id: "author", name: "작가", avatar: "#fff" },
      isOwner: false,
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    apiGet.mockResolvedValue({
      items: [
        valid,
        { ...valid, id: "svg", previewDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
        { ...valid, id: "spoof", previewDataUrl: PNG_1X1.replace("image/png", "image/webp") },
      ],
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    await expect(listSharedAssetCatalog()).resolves.toMatchObject({
      items: [{ id: "valid" }],
    });
  });

  it("카탈로그 목록 전체 응답 크기 가드를 준수한다", async () => {
    const oversizedDescription = "x".repeat(CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES);
    apiGet.mockResolvedValueOnce({
      items: [
        {
          id: "oversized",
          name: "대용량 에셋",
          description: oversizedDescription,
          tags: [],
          width: 1,
          height: 1,
          kind: "image",
          previewDataUrl: PNG_1X1,
          previewWidth: 1,
          previewHeight: 1,
          previewAvailable: true,
          downloads: 0,
          reportCount: 0,
          license: "cc-by-4.0",
          licenseLabel: "CC BY",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          attributionRequired: true,
          commercialUse: true,
          attributionText: "작가",
          containsAi: false,
          moderationStatus: "published",
          author: { id: "author", name: "작가", avatar: "#fff" },
          isOwner: false,
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    await expect(listSharedAssetCatalog()).rejects.toThrow("카탈로그 응답이 너무 큽니다");
  });

  it("검수 큐도 목록 크기 가드를 공유한다", async () => {
    const oversizedString = "x".repeat(CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES);
    apiGet.mockResolvedValueOnce([
      {
        reportId: "report-1",
        reason: "copyright",
        details: oversizedString,
        reportStatus: "open",
        reportedAt: "2026-07-20T00:00:00.000Z",
        reporter: { id: "reporter", name: "신고자", avatar: "#64748b" },
        asset: {
          id: "report-asset",
          name: "검수",
          description: "",
          tags: [],
          width: 1,
          height: 1,
          kind: "image",
          previewDataUrl: PNG_1X1,
          previewWidth: 1,
          previewHeight: 1,
          previewAvailable: true,
          downloads: 0,
          reportCount: 0,
          license: "cc-by-4.0",
          licenseLabel: "CC BY",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          attributionRequired: true,
          commercialUse: true,
          attributionText: "작가",
          containsAi: false,
          moderationStatus: "published",
          author: { id: "author", name: "작가", avatar: "#fff" },
          isOwner: false,
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      },
    ]);

    await expect(listSharedAssetModerationQueue()).rejects.toThrow(
      "공유 에셋 목록 응답이 안전한 전송 크기를 초과했습니다"
    );
  });
});

describe("creator client revision response contracts", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    toApiError.mockClear();
  });

  it("목록의 revision·복원 출처·날짜를 검증하고 ISO 시각으로 정규화한다", async () => {
    apiGet.mockResolvedValue([
      {
        revision: 12,
        restoredFromRevision: null,
        createdAt: "2026-07-13T09:30:00+09:00",
        ignoredServerField: "forward-compatible",
      },
      {
        revision: 11,
        restoredFromRevision: 3,
        createdAt: "2026-07-12T00:00:00.123Z",
      },
    ]);

    await expect(listWorkRevisions("work/1", 20)).resolves.toEqual([
      {
        revision: 12,
        restoredFromRevision: null,
        createdAt: "2026-07-13T00:30:00.000Z",
      },
      {
        revision: 11,
        restoredFromRevision: 3,
        createdAt: "2026-07-12T00:00:00.123Z",
      },
    ]);
    expect(apiGet).toHaveBeenCalledWith("/creator/works/work%2F1/revisions", {
      params: { limit: 20 },
      signal: undefined,
    });
  });

  it.each([
    ["배열 아님", { revisions: [] }],
    ["항목 객체 아님", [null]],
    ["revision 0", [{ revision: 0, restoredFromRevision: null, createdAt: "2026-07-13T00:00:00.000Z" }]],
    ["revision 문자열", [{ revision: "1", restoredFromRevision: null, createdAt: "2026-07-13T00:00:00.000Z" }]],
    ["revision 상한 초과", [{ revision: 2_147_483_648, restoredFromRevision: null, createdAt: "2026-07-13T00:00:00.000Z" }]],
    ["복원 출처 누락", [{ revision: 1, createdAt: "2026-07-13T00:00:00.000Z" }]],
    ["복원 출처 문자열", [{ revision: 2, restoredFromRevision: "1", createdAt: "2026-07-13T00:00:00.000Z" }]],
    ["잘못된 날짜", [{ revision: 1, restoredFromRevision: null, createdAt: "not-an-iso-date" }]],
  ])("손상된 목록 응답(%s)은 부분 적용하지 않고 안전한 계약 오류로 닫는다", async (_label, payload) => {
    apiGet.mockResolvedValue(payload);

    const error = await listWorkRevisions("private-work").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkRevisionResponseContractError);
    expect(String(error)).toBe("WorkRevisionResponseContractError: 작품 버전 응답 형식이 올바르지 않습니다.");
    expect(error).not.toHaveProperty("cause");
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("상세 snapshot은 plain object만 허용하고 새 일반 객체로 반환한다", async () => {
    const snapshot = Object.assign(Object.create(null) as Record<string, unknown>, {
      title: "비공개 원고",
      doc: { pagesList: [{ id: "page-1" }] },
    });
    apiGet.mockResolvedValue({
      revision: 7,
      restoredFromRevision: 2,
      createdAt: "2026-07-13T00:00:00Z",
      snapshot,
      ignoredServerField: "not-projected",
    });

    const detail = await getWorkRevision("work/1", 7);

    expect(detail).toEqual({
      revision: 7,
      restoredFromRevision: 2,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot: {
        title: "비공개 원고",
        doc: { pagesList: [{ id: "page-1" }] },
      },
    });
    expect(Object.getPrototypeOf(detail.snapshot)).toBe(Object.prototype);
    expect(detail).not.toHaveProperty("ignoredServerField");
  });

  it("비교 getter는 allowlist snapshot만 반환하고 전용 경로·AbortSignal을 사용한다", async () => {
    const controller = new AbortController();
    const resourceToken = `toonspectrum:resource-sha256:v1:25:${"a".repeat(64)}`;
    apiGet.mockResolvedValue({
      revision: 7,
      restoredFromRevision: 2,
      createdAt: "2026-07-13T09:00:00+09:00",
      snapshot: {
        titleId: "title-1",
        title: "비공개 원고",
        description: "설명",
        tags: ["판타지"],
        format: "cuttoon",
        doc: { pagesList: [{ id: "page-1", src: resourceToken }] },
        status: "draft",
        seriesId: "series-1",
        episodeNo: 3,
        challengeId: null,
        remixFromId: null,
      },
    });

    await expect(
      getWorkRevisionComparison("work/1", 7, controller.signal)
    ).resolves.toEqual({
      revision: 7,
      restoredFromRevision: 2,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot: {
        titleId: "title-1",
        title: "비공개 원고",
        description: "설명",
        tags: ["판타지"],
        format: "cuttoon",
        doc: { pagesList: [{ id: "page-1", src: resourceToken }] },
        status: "draft",
        seriesId: "series-1",
        episodeNo: 3,
        challengeId: null,
        remixFromId: null,
      },
    });
    expect(apiGet).toHaveBeenCalledWith(
      "/creator/works/work%2F1/revisions/7/comparison",
      { signal: controller.signal }
    );
  });

  it.each([
    ["cover", { cover: "data:image/png;base64,private-cover" }],
    ["pages", { pages: ["data:image/png;base64,private-page"] }],
    ["서버 내부 필드", { ownerId: "private-owner" }],
  ])("비교 응답의 비허용 %s 필드는 안전 계약 오류로 거부한다", async (_label, extra) => {
    apiGet.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot: {
        titleId: null,
        title: "1화",
        description: "",
        tags: [],
        format: "cuttoon",
        doc: {},
        status: "draft",
        seriesId: null,
        episodeNo: null,
        challengeId: null,
        remixFromId: null,
        ...extra,
      },
    });

    const error = await getWorkRevisionComparison("private-work", 4).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(WorkRevisionResponseContractError);
    expect(String(error)).not.toContain("private-cover");
    expect(String(error)).not.toContain("private-page");
    expect(String(error)).not.toContain("private-owner");
    expect(error).not.toHaveProperty("cause");
  });

  it("비교 응답은 sparse tags와 snapshot accessor를 실행하지 않고 거부한다", async () => {
    const sparseTags = Array(1) as string[];
    const snapshot = {
      titleId: null,
      title: "1화",
      description: "",
      tags: sparseTags,
      format: "cuttoon",
      doc: {},
      status: "draft",
      seriesId: null,
      episodeNo: null,
      challengeId: null,
      remixFromId: null,
    };
    apiGet.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot,
    });
    await expect(getWorkRevisionComparison("private-work", 4)).rejects.toBeInstanceOf(
      WorkRevisionResponseContractError
    );

    const titleGetter = vi.fn(() => "비밀 제목");
    Object.defineProperty(snapshot, "title", { enumerable: true, get: titleGetter });
    apiGet.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot,
    });
    await expect(getWorkRevisionComparison("private-work", 4)).rejects.toBeInstanceOf(
      WorkRevisionResponseContractError
    );
    expect(titleGetter).not.toHaveBeenCalled();
  });

  it("비교 getter는 구버전 doc의 리소스·AI 비밀 원문을 downstream에 전달하지 않는다", async () => {
    const rawDataUrl = "data:image/png;base64,private-doc-image";
    const privatePrompt = "private-opt-in-prompt";
    const privateRequestId = "private-provider-request-id";
    apiGet.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot: {
        titleId: null,
        title: "1화",
        description: "",
        tags: [],
        format: "cuttoon",
        doc: {
          pagesList: [{ src: rawDataUrl, text: "작품 대사" }],
          aiProvenance: {
            operations: [
              {
                prompt: { sha256: "d".repeat(64), raw: privatePrompt },
                requestId: privateRequestId,
              },
            ],
          },
        },
        status: "draft",
        seriesId: null,
        episodeNo: null,
        challengeId: null,
        remixFromId: null,
      },
    });

    const response = await getWorkRevisionComparison("private-work", 4);

    expect(JSON.stringify(response)).not.toContain(rawDataUrl);
    expect(JSON.stringify(response)).not.toContain(privatePrompt);
    expect(JSON.stringify(response)).not.toContain(privateRequestId);
    expect(JSON.stringify(response)).not.toContain("d".repeat(64));
    expect(JSON.stringify(response)).toContain("0".repeat(64));
    expect(JSON.stringify(response)).toContain("작품 대사");
    expect(JSON.stringify(response)).toMatch(
      /toonspectrum:resource-sha256:v1:\d+:[0-9a-f]{64}/u
    );
  });

  it.each([
    ["누락", undefined],
    ["null", null],
    ["배열", [{ privateNote: "목록에 노출되면 안 되는 비밀" }]],
    ["class instance", new (class PrivateSnapshot { privateNote = "오류에 노출되면 안 되는 비밀"; })()],
  ])("상세의 손상된 snapshot(%s)은 payload를 보존하지 않는 안전한 오류를 낸다", async (_label, snapshot) => {
    apiGet.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot,
      providerSecret: "server-private-value",
    });

    const error = await getWorkRevision("private-work", 4).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkRevisionResponseContractError);
    expect(String(error)).not.toContain("server-private-value");
    expect(String(error)).not.toContain("비밀");
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("snapshot");
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("목록과 상세 조회에 전달된 AbortSignal을 HTTP 요청까지 보존한다", async () => {
    const controller = new AbortController();
    apiGet
      .mockResolvedValueOnce([
        { revision: 2, restoredFromRevision: null, createdAt: "2026-07-13T00:00:00.000Z" },
      ])
      .mockResolvedValueOnce({
        revision: 2,
        restoredFromRevision: null,
        createdAt: "2026-07-13T00:00:00.000Z",
        snapshot: {},
      });

    await listWorkRevisions("work/1", 10, controller.signal);
    await getWorkRevision("work/1", 2, controller.signal);

    expect(apiGet).toHaveBeenNthCalledWith(1, "/creator/works/work%2F1/revisions", {
      params: { limit: 10 },
      signal: controller.signal,
    });
    expect(apiGet).toHaveBeenNthCalledWith(2, "/creator/works/work%2F1/revisions/2", {
      signal: controller.signal,
    });
  });
});
