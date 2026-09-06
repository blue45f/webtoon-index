import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioSharedDocumentAccessError,
  StudioSharedDocumentCrdtSequenceConflictError,
  StudioSharedDocumentInputError,
  StudioSharedDocumentResponseContractError,
  StudioSharedDocumentRevisionConflictError,
  canEditStudioSharedDocument,
  getStudioSharedDocument,
  getStudioSharedDocumentMeta,
  isStudioSharedDocumentAccessError,
  isStudioSharedDocumentCrdtSequenceConflictError,
  isStudioSharedDocumentScopeCurrent,
  normalizeStudioSharedDocument,
  normalizeStudioSharedDocumentMeta,
  normalizeStudioSharedDocumentPatch,
  normalizeStudioSharedDocumentSaveResponse,
  updateStudioSharedDocument,
} from "./studio-shared-document-client";

const { apiGet, apiPatch, toApiError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  toApiError: vi.fn(async () => new Error("안전한 API 오류")),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: {
    get: apiGet,
    patch: apiPatch,
  },
  isHttpError: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { httpError?: boolean }).httpError),
  toApiError,
}));

function response(overrides: Record<string, unknown> = {}) {
  return {
    workId: "Shared/WORK 01",
    role: "editor",
    status: "active",
    capabilities: { view: true, edit: true },
    revision: 7,
    crdtServerSequence: "27",
    updatedAt: "2026-07-12T11:30:00+09:00",
    document: {
      titleId: null,
      title: "별빛 아래 우리",
      description: "공동 원고",
      cover: "data:image/webp;base64,cover",
      tags: ["로맨스", "성장"],
      format: "cuttoon",
      pages: ["data:image/png;base64,page"],
      doc: { width: 720, pagesList: [{ id: "page-1" }] },
      status: "draft",
      seriesId: "Series/Opaque 01",
      episodeNo: 3,
      challengeId: null,
      remixFromId: null,
    },
    ...overrides,
  };
}

function metaResponse(overrides: Record<string, unknown> = {}) {
  const { document: _document, ...meta } = response();
  return { ...meta, ...overrides };
}

function conflictError(currentRevision: unknown) {
  return {
    httpError: true,
    response: { status: 409 },
    data: {
      code: "creator_work_revision_conflict",
      currentRevision,
      snapshot: { privateNote: "never expose" },
    },
  };
}

function crdtConflictError(currentCrdtServerSequence: unknown) {
  return {
    httpError: true,
    response: { status: 409 },
    data: {
      code: "creator_crdt_sequence_conflict",
      currentCrdtServerSequence,
      requestedCrdtServerSequence: "private-request-value",
    },
  };
}

function accessError(status: 401 | 403 | 404) {
  return {
    httpError: true,
    response: { status },
    data: { code: "private-acl-code", privateNote: "never expose" },
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  toApiError.mockClear();
});

describe("normalizeStudioSharedDocument", () => {
  it("opaque id와 문서 내용을 보존하고 날짜·권한을 안전하게 정규화한다", () => {
    const normalized = normalizeStudioSharedDocument(response(), "Shared/WORK 01");

    expect(normalized).toEqual({
      workId: "Shared/WORK 01",
      role: "editor",
      status: "active",
      capabilities: { view: true, edit: true },
      access: "edit",
      revision: 7,
      crdtServerSequence: "27",
      updatedAt: "2026-07-12T02:30:00.000Z",
      document: {
        titleId: null,
        title: "별빛 아래 우리",
        description: "공동 원고",
        cover: "data:image/webp;base64,cover",
        tags: ["로맨스", "성장"],
        format: "cuttoon",
        pages: ["data:image/png;base64,page"],
        doc: { width: 720, pagesList: [{ id: "page-1" }] },
        status: "draft",
        seriesId: "Series/Opaque 01",
        episodeNo: 3,
        challengeId: null,
        remixFromId: null,
      },
    });
    expect(canEditStudioSharedDocument(normalized)).toBe(true);
  });

  it("full envelope·capability·content의 exact own-key 계약만 수용한다", () => {
    expect(() =>
      normalizeStudioSharedDocument(
        { ...response(), ignoredSecret: "drop-me" },
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 응답 필드가 올바르지 않습니다.");
    expect(() =>
      normalizeStudioSharedDocument(
        response({ capabilities: { view: true, edit: true, manageMembers: true } }),
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 접근 권한 형식이 올바르지 않습니다.");

    const valid = response();
    expect(() =>
      normalizeStudioSharedDocument(
        response({
          document: {
            ...(valid.document as Record<string, unknown>),
            privateToken: "drop-me",
          },
        }),
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 내용 형식이 올바르지 않습니다.");
  });

  it("plain/null prototype만 허용하고 document.doc 내부 확장 키는 보존한다", () => {
    const nullPrototypeEnvelope = Object.assign(Object.create(null), response());
    const normalized = normalizeStudioSharedDocument(
      nullPrototypeEnvelope,
      "Shared/WORK 01"
    );
    expect(normalized.document.doc).toEqual({ width: 720, pagesList: [{ id: "page-1" }] });

    const inheritedEnvelope = Object.assign(
      Object.create({ workId: "Shared/WORK 01" }),
      response()
    );
    expect(() =>
      normalizeStudioSharedDocument(inheritedEnvelope, "Shared/WORK 01")
    ).toThrow("공동 문서 응답 필드가 올바르지 않습니다.");

    const inheritedCapabilities = Object.assign(
      Object.create({ token: "inherited" }),
      { view: true, edit: true }
    );
    expect(() =>
      normalizeStudioSharedDocument(
        response({ capabilities: inheritedCapabilities }),
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 접근 권한 형식이 올바르지 않습니다.");
  });

  it.each([
    ["owner", true, "edit"],
    ["admin", true, "edit"],
    ["editor", false, "view"],
    ["commenter", true, "comment"],
    ["viewer", true, "view"],
  ] as const)("%s 역할과 capability를 교차 검증한다", (role, edit, access) => {
    const normalized = normalizeStudioSharedDocument(
      response({ role, capabilities: { view: true, edit } }),
      "Shared/WORK 01"
    );

    expect(normalized.access).toBe(access);
    expect(normalized.capabilities.edit).toBe(access === "edit");
    expect(canEditStudioSharedDocument(normalized)).toBe(access === "edit");
  });

  it.each([
    ["다른 작품", response({ workId: "work-else" })],
    ["알 수 없는 역할", response({ role: "super-admin" })],
    ["비활성 상태", response({ status: "pending" })],
    ["열람 불가", response({ capabilities: { view: false, edit: false } })],
    ["잘못된 revision", response({ revision: 0 })],
    ["잘못된 날짜", response({ updatedAt: "not-a-date" })],
    ["배열 문서", response({ document: [] })],
  ])("%s 응답을 계약 오류로 거부한다", (_label, payload) => {
    expect(() => normalizeStudioSharedDocument(payload, "Shared/WORK 01")).toThrow(
      StudioSharedDocumentResponseContractError
    );
  });

  it.each([
    ["긴 제목", { title: "가".repeat(121) }],
    ["긴 설명", { description: "가".repeat(2_001) }],
    ["태그 수", { tags: Array.from({ length: 9 }, () => "태그") }],
    ["태그 타입", { tags: ["태그", 1] }],
    ["형식", { format: "psd" }],
    ["페이지 수", { pages: Array.from({ length: 201 }, () => "page") }],
    ["doc 배열", { doc: [] }],
    ["게시 상태", { status: "hidden" }],
    ["회차", { episodeNo: 0 }],
    ["관계 id", { challengeId: " ".repeat(2) }],
  ])("문서의 %s 위반을 전체 응답 오류로 처리한다", (_label, documentPatch) => {
    const valid = response();
    expect(() =>
      normalizeStudioSharedDocument(
        response({
          document: {
            ...(valid.document as Record<string, unknown>),
            ...documentPatch,
          },
        }),
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 내용에 잘못된 필드가 있습니다.");
  });
});

describe("normalizeStudioSharedDocumentMeta", () => {
  it.each([
    ["owner", true, "edit", true],
    ["admin", true, "edit", true],
    ["editor", true, "edit", true],
    ["commenter", true, "comment", false],
    ["viewer", true, "view", false],
    ["editor", false, "view", false],
  ] as const)(
    "%s 역할과 capability를 교차 검증해 편집 권한을 낮춘다",
    (role, edit, access, normalizedEdit) => {
      const normalized = normalizeStudioSharedDocumentMeta(
        metaResponse({ role, capabilities: { view: true, edit } }),
        "Shared/WORK 01"
      );

      expect(normalized).toEqual({
        workId: "Shared/WORK 01",
        role,
        status: "active",
        capabilities: { view: true, edit: normalizedEdit },
        access,
        revision: 7,
        crdtServerSequence: "27",
        updatedAt: "2026-07-12T02:30:00.000Z",
      });
      expect(canEditStudioSharedDocument(normalized)).toBe(normalizedEdit);
      expect("document" in normalized).toBe(false);
    }
  );

  it("다른 작품과 잘못된 역할·상태·권한·revision·날짜를 fail-closed 처리한다", () => {
    for (const payload of [
      metaResponse({ workId: "work-else" }),
      metaResponse({ role: "super-admin" }),
      metaResponse({ status: "pending" }),
      metaResponse({ capabilities: { view: false, edit: false } }),
      metaResponse({ capabilities: { view: true, edit: "true" } }),
      metaResponse({ revision: 0 }),
      metaResponse({ updatedAt: "not-a-date" }),
      null,
      [],
    ]) {
      expect(() => normalizeStudioSharedDocumentMeta(payload, "Shared/WORK 01")).toThrow(
        StudioSharedDocumentResponseContractError
      );
    }
  });

  it("meta envelope와 capabilities의 exact own-key 계약만 수용한다", () => {
    for (const extra of [
      { document: response().document },
      { cover: "private-cover" },
      { pages: ["private-page"] },
      { owner: { name: "작가" } },
      { userId: "private-user" },
      { token: "private-token" },
    ]) {
      expect(() =>
        normalizeStudioSharedDocumentMeta(
          { ...metaResponse(), ...extra },
          "Shared/WORK 01"
        )
      ).toThrow("공동 문서 메타 응답 필드가 올바르지 않습니다.");
    }
    expect(() =>
      normalizeStudioSharedDocumentMeta(
        metaResponse({ capabilities: { view: true, edit: true, manageMembers: true } }),
        "Shared/WORK 01"
      )
    ).toThrow("공동 문서 접근 권한 형식이 올바르지 않습니다.");

    const inherited = Object.assign(Object.create({ token: "inherited" }), metaResponse());
    expect(() =>
      normalizeStudioSharedDocumentMeta(inherited, "Shared/WORK 01")
    ).toThrow("공동 문서 메타 응답 필드가 올바르지 않습니다.");
  });
});

describe("normalizeStudioSharedDocumentPatch", () => {
  it("허용된 변경 필드만 복사하고 제목을 서버와 같은 규칙으로 정리한다", () => {
    const tags = ["로맨스"];
    const pages = ["page-1"];
    const patch = normalizeStudioSharedDocumentPatch({
      baseRevision: 7,
      crdtServerSequence: "27",
      title: "  수정 제목  ",
      description: "설명 ",
      tags,
      titleId: null,
      cover: "cover",
      pages,
      doc: { pagesList: [] },
      status: "draft",
    });

    expect(patch).toEqual({
      baseRevision: 7,
      crdtServerSequence: "27",
      title: "수정 제목",
      description: "설명 ",
      tags: ["로맨스"],
      titleId: null,
      cover: "cover",
      pages: ["page-1"],
      doc: { pagesList: [] },
      status: "draft",
    });
    expect(patch.tags).not.toBe(tags);
    expect(patch.pages).not.toBe(pages);
  });

  it.each([
    ["입력 객체", null],
    ["revision", { baseRevision: 0, crdtServerSequence: "27", title: "제목" }],
    ["CRDT 순번 누락", { baseRevision: 7, title: "제목" }],
    ["CRDT 순번 초과", { baseRevision: 7, crdtServerSequence: "9223372036854775808", title: "제목" }],
    ["빈 변경", { baseRevision: 7, crdtServerSequence: "27" }],
    ["빈 제목", { baseRevision: 7, crdtServerSequence: "27", title: "   " }],
    ["긴 설명", { baseRevision: 7, crdtServerSequence: "27", description: "가".repeat(2_001) }],
    ["긴 태그", { baseRevision: 7, crdtServerSequence: "27", tags: ["가".repeat(25)] }],
    ["페이지 수", { baseRevision: 7, crdtServerSequence: "27", pages: Array.from({ length: 201 }, () => "page") }],
    ["doc 배열", { baseRevision: 7, crdtServerSequence: "27", doc: [] }],
    ["doc 클래스", { baseRevision: 7, crdtServerSequence: "27", doc: new Date() }],
    ["format 전환", { baseRevision: 7, crdtServerSequence: "27", title: "제목", format: "upload" }],
    ["unknown 필드", { baseRevision: 7, crdtServerSequence: "27", title: "제목", seriesId: "owner-only" }],
  ])("잘못된 %s을 전송 전에 차단한다", (_label, input) => {
    expect(() => normalizeStudioSharedDocumentPatch(input)).toThrow(
      StudioSharedDocumentInputError
    );
  });
});

describe("shared document requests", () => {
  it("GET은 opaque id를 경로에서만 인코딩하고 응답 작품을 교차 확인한다", async () => {
    const controller = new AbortController();
    apiGet.mockResolvedValue(response());

    await expect(getStudioSharedDocument("Shared/WORK 01", controller.signal)).resolves.toMatchObject({
      workId: "Shared/WORK 01",
      revision: 7,
    });
    expect(apiGet).toHaveBeenCalledWith(
      "/creator/works/Shared%2FWORK%2001/team/document",
      { signal: controller.signal }
    );
  });

  it("meta GET은 opaque id를 인코딩한 최소 경로와 AbortSignal을 사용한다", async () => {
    const controller = new AbortController();
    apiGet.mockResolvedValue(metaResponse());

    await expect(
      getStudioSharedDocumentMeta("Shared/WORK 01", controller.signal)
    ).resolves.toEqual({
      workId: "Shared/WORK 01",
      role: "editor",
      status: "active",
      capabilities: { view: true, edit: true },
      access: "edit",
      revision: 7,
      crdtServerSequence: "27",
      updatedAt: "2026-07-12T02:30:00.000Z",
    });
    expect(apiGet).toHaveBeenCalledWith(
      "/creator/works/Shared%2FWORK%2001/team/document/meta",
      { signal: controller.signal }
    );
  });

  it("meta의 손상 응답은 계약 오류, API 실패는 안전한 오류로 구분한다", async () => {
    apiGet.mockResolvedValueOnce(metaResponse({ revision: 0 }));
    await expect(getStudioSharedDocumentMeta("Shared/WORK 01")).rejects.toBeInstanceOf(
      StudioSharedDocumentResponseContractError
    );
    expect(toApiError).not.toHaveBeenCalled();

    apiGet.mockRejectedValueOnce(new Error("raw meta failure"));
    await expect(getStudioSharedDocumentMeta("Shared/WORK 01")).rejects.toThrow(
      "안전한 API 오류"
    );
    expect(toApiError).toHaveBeenCalledWith(
      expect.any(Error),
      "공동 문서 권한 정보를 불러오지 못했습니다."
    );
  });

  it("PATCH는 정규화한 payload와 AbortSignal을 보내고 새 revision만 수용한다", async () => {
    const controller = new AbortController();
    apiPatch.mockResolvedValue({
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T12:00:00+09:00",
    });

    await expect(
      updateStudioSharedDocument(
        "Shared/WORK 01",
        "editor",
        { baseRevision: 7, crdtServerSequence: "27", title: "  새 제목 " },
        controller.signal
      )
    ).resolves.toEqual({
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T03:00:00.000Z",
    });
    expect(apiPatch).toHaveBeenCalledWith(
      "/creator/works/Shared%2FWORK%2001/team/document",
      { baseRevision: 7, crdtServerSequence: "27", title: "새 제목" },
      { signal: controller.signal }
    );
  });

  it("PATCH 저장 확인은 exact own-key와 plain/null prototype만 수용한다", () => {
    const saved = {
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T12:00:00+09:00",
    };
    expect(() =>
      normalizeStudioSharedDocumentSaveResponse(
        { ...saved, extra: "drop" },
        "Shared/WORK 01",
        7
      )
    ).toThrow("공동 문서 저장 확인 형식이 올바르지 않습니다.");

    const inherited = Object.assign(Object.create({ token: "inherited" }), saved);
    expect(() =>
      normalizeStudioSharedDocumentSaveResponse(inherited, "Shared/WORK 01", 7)
    ).toThrow("공동 문서 저장 확인 형식이 올바르지 않습니다.");

    const nullPrototype = Object.assign(Object.create(null), saved);
    expect(
      normalizeStudioSharedDocumentSaveResponse(nullPrototype, "Shared/WORK 01", 7)
    ).toEqual({
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T03:00:00.000Z",
    });
  });

  it("409 충돌은 현재 revision만 가진 전용 오류로 변환한다", async () => {
    apiPatch.mockRejectedValue(conflictError(9));

    const error = await updateStudioSharedDocument("Shared/WORK 01", "editor", {
      baseRevision: 7,
      crdtServerSequence: "27",
      title: "수정",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StudioSharedDocumentRevisionConflictError);
    expect((error as StudioSharedDocumentRevisionConflictError).currentRevision).toBe(9);
    expect(JSON.stringify(error)).not.toContain("privateNote");
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("CRDT sequence 409를 현재 decimal 순번만 가진 전용 오류로 변환한다", async () => {
    apiPatch.mockRejectedValue(crdtConflictError("28"));

    const error = await updateStudioSharedDocument("Shared/WORK 01", "editor", {
      baseRevision: 7,
      crdtServerSequence: "27",
      title: "수정",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StudioSharedDocumentCrdtSequenceConflictError);
    expect(isStudioSharedDocumentCrdtSequenceConflictError(error)).toBe(true);
    expect(
      (error as StudioSharedDocumentCrdtSequenceConflictError).currentCrdtServerSequence
    ).toBe("28");
    expect(JSON.stringify(error)).not.toContain("private-request-value");
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("손상된 409와 일반 API 오류는 안전한 오류 경로로 보낸다", async () => {
    apiPatch.mockRejectedValue(conflictError("9"));
    await expect(
      updateStudioSharedDocument("Shared/WORK 01", "editor", {
        baseRevision: 7,
        crdtServerSequence: "27",
        title: "수정",
      })
    ).rejects.toThrow("안전한 API 오류");

    apiGet.mockRejectedValue(new Error("raw"));
    await expect(getStudioSharedDocument("Shared/WORK 01")).rejects.toThrow("안전한 API 오류");
    expect(toApiError).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404] as const)(
    "%i 접근 실패를 fail-closed 전용 오류로 보존한다",
    async (status) => {
      apiGet.mockRejectedValueOnce(accessError(status));
      const metaError = await getStudioSharedDocumentMeta("Shared/WORK 01").catch(
        (cause: unknown) => cause
      );
      expect(metaError).toBeInstanceOf(StudioSharedDocumentAccessError);
      expect(isStudioSharedDocumentAccessError(metaError)).toBe(true);
      expect((metaError as StudioSharedDocumentAccessError).status).toBe(status);
      expect(JSON.stringify(metaError)).not.toContain("privateNote");

      apiPatch.mockRejectedValueOnce(accessError(status));
      await expect(
        updateStudioSharedDocument("Shared/WORK 01", "editor", {
          baseRevision: 7,
          crdtServerSequence: "27",
          title: "수정",
        })
      ).rejects.toBeInstanceOf(StudioSharedDocumentAccessError);
    }
  );

  it("잘못된 작품 식별자는 네트워크 요청 전에 차단한다", async () => {
    await expect(getStudioSharedDocument("   ")).rejects.toBeInstanceOf(
      StudioSharedDocumentInputError
    );
    await expect(getStudioSharedDocumentMeta("   ")).rejects.toBeInstanceOf(
      StudioSharedDocumentInputError
    );
    await expect(
      updateStudioSharedDocument("", "editor", {
        baseRevision: 7,
        crdtServerSequence: "27",
        title: "수정",
      })
    ).rejects.toBeInstanceOf(StudioSharedDocumentInputError);
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("공동 편집자는 owner-only 게시 상태와 catalog 연결을 네트워크 payload에서 제거한다", async () => {
    apiPatch.mockResolvedValue({
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T12:00:00+09:00",
    });

    await updateStudioSharedDocument("Shared/WORK 01", "admin", {
      baseRevision: 7,
      crdtServerSequence: "27",
      title: "공동 수정",
      titleId: "catalog-owner-only",
      status: "published",
    });

    expect(apiPatch).toHaveBeenCalledWith(
      "/creator/works/Shared%2FWORK%2001/team/document",
      { baseRevision: 7, crdtServerSequence: "27", title: "공동 수정" },
      { signal: undefined }
    );
  });

  it("소유자는 게시 상태와 catalog 연결을 저장할 수 있다", async () => {
    apiPatch.mockResolvedValue({
      workId: "Shared/WORK 01",
      revision: 8,
      updatedAt: "2026-07-12T12:00:00+09:00",
    });

    await updateStudioSharedDocument("Shared/WORK 01", "owner", {
      baseRevision: 7,
      crdtServerSequence: "27",
      titleId: "catalog-1",
      status: "published",
    });

    expect(apiPatch).toHaveBeenCalledWith(
      "/creator/works/Shared%2FWORK%2001/team/document",
      {
        baseRevision: 7,
        crdtServerSequence: "27",
        titleId: "catalog-1",
        status: "published",
      },
      { signal: undefined }
    );
  });
});

describe("save acknowledgement and request scope", () => {
  it.each([
    ["다른 작품", { workId: "else", revision: 8, updatedAt: "2026-07-12T00:00:00Z" }],
    ["같거나 낮은 revision", { workId: "work-1", revision: 7, updatedAt: "2026-07-12T00:00:00Z" }],
    ["건너뛴 revision", { workId: "work-1", revision: 9, updatedAt: "2026-07-12T00:00:00Z" }],
    ["잘못된 날짜", { workId: "work-1", revision: 8, updatedAt: "invalid" }],
  ])("%s 저장 확인을 거부한다", (_label, payload) => {
    expect(() => normalizeStudioSharedDocumentSaveResponse(payload, "work-1", 7)).toThrow(
      StudioSharedDocumentResponseContractError
    );
  });

  it("잘못된 기준 revision으로는 저장 확인을 수용하지 않는다", () => {
    expect(() =>
      normalizeStudioSharedDocumentSaveResponse(
        { workId: "work-1", revision: 1, updatedAt: "2026-07-12T00:00:00Z" },
        "work-1",
        0
      )
    ).toThrow(StudioSharedDocumentResponseContractError);
  });

  it("계정 또는 작품이 바뀐 오래된 비동기 응답을 판별한다", () => {
    const request = { authScopeKey: "account-a", workId: "work-1" };
    expect(
      isStudioSharedDocumentScopeCurrent(request, {
        authScopeKey: "account-a",
        workId: "work-1",
      })
    ).toBe(true);
    expect(
      isStudioSharedDocumentScopeCurrent(request, {
        authScopeKey: "account-b",
        workId: "work-1",
      })
    ).toBe(false);
    expect(
      isStudioSharedDocumentScopeCurrent(request, {
        authScopeKey: "account-a",
        workId: "work-2",
      })
    ).toBe(false);
    expect(
      isStudioSharedDocumentScopeCurrent(request, { authScopeKey: null, workId: null })
    ).toBe(false);
  });
});
