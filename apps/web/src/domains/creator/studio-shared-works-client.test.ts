import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_SHARED_WORKS_PATH,
  StudioSharedWorksResponseContractError,
  canSaveStudioSharedWork,
  getStudioSharedWorks,
  isStudioSharedWorksScopeCurrent,
  mergeStudioSharedWorks,
  normalizeStudioSharedWorks,
  normalizeStudioSharedWorksPage,
  sharedWorkAccess,
  type StudioSharedWork,
} from "./studio-shared-works-client";

import { api } from "@/src/infrastructure/api";


function sharedWork(overrides: Record<string, unknown> = {}) {
  return {
    workId: "work-1",
    title: "별빛 아래 우리",
    format: "cuttoon",
    owner: { name: "하린" },
    role: "editor",
    status: "active",
    capabilities: {
      view: true,
      comment: true,
      edit: true,
      manageMembers: false,
    },
    updatedAt: "2026-07-12T02:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeStudioSharedWorks", () => {
  it("역할과 capability를 교차 검증해 편집·검토·열람 모드를 만든다", () => {
    const result = normalizeStudioSharedWorks([
      sharedWork(),
      sharedWork({
        workId: "work-2",
        role: "commenter",
        capabilities: { view: true, comment: true, edit: false, manageMembers: false },
      }),
      sharedWork({
        workId: "work-3",
        role: "viewer",
        capabilities: { view: true, comment: false, edit: false, manageMembers: false },
      }),
    ]);

    expect(result.map((work) => work.access)).toEqual(["edit", "comment", "view"]);
    expect(canSaveStudioSharedWork(result[0])).toBe(true);
    expect(canSaveStudioSharedWork(result[1])).toBe(false);
    expect(canSaveStudioSharedWork(result[2])).toBe(false);
    expect(result[0].capabilities.respondInvite).toBe(false);
  });

  it("서버 capability가 넓어져도 viewer/commenter를 편집자로 올리지 않는다", () => {
    const broad = { view: true, comment: true, edit: true, manageMembers: true };
    const result = normalizeStudioSharedWorks([
      sharedWork({ workId: "viewer", role: "viewer", capabilities: broad }),
      sharedWork({ workId: "commenter", role: "commenter", capabilities: broad }),
    ]);

    expect(result.map((work) => work.access)).toEqual(["view", "comment"]);
    expect(
      sharedWorkAccess("viewer", "active", {
        view: true,
        comment: true,
        edit: true,
        manageMembers: true,
        respondInvite: false,
      })
    ).toBe("view");
  });

  it("비활성·열람 불가·손상 항목과 중복을 버리고 opaque id를 보존한다", () => {
    const opaqueId = "Shared/WORK 01";
    const result = normalizeStudioSharedWorks([
      sharedWork({ workId: opaqueId }),
      sharedWork({ workId: opaqueId, title: "중복" }),
      sharedWork({ workId: "pending", status: "pending" }),
      sharedWork({ workId: "no-view", capabilities: { view: false, edit: true } }),
      { nope: true },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].workId).toBe(opaqueId);
    expect(result[0].title).toBe("별빛 아래 우리");
  });

  it("최대 스캔·반환 수를 제한하고 날짜와 텍스트를 정규화한다", () => {
    const payload = Array.from({ length: 80 }, (_, index) =>
      sharedWork({
        workId: `work-${index}`,
        title: index === 0 ? "  " : `작품 ${index}`,
        owner: { name: ` 작가 ${index} ` },
        updatedAt: "2026-07-12T11:00:00+09:00",
      })
    );
    const result = normalizeStudioSharedWorks(payload, 500);

    expect(result).toHaveLength(50);
    expect(result[0]).toMatchObject({
      title: "제목 없는 작품",
      owner: { name: "작가 0" },
      updatedAt: "2026-07-12T02:00:00.000Z",
    });
  });

  it("최상위 계약이나 비어 있지 않은 전체 손상을 오류로 구분한다", () => {
    expect(() => normalizeStudioSharedWorks({ works: [] })).toThrow(
      StudioSharedWorksResponseContractError
    );
    expect(() => normalizeStudioSharedWorks([{ nope: true }])).toThrow(
      "공유 작품 응답에 열 수 있는 항목이 없습니다."
    );
    expect(normalizeStudioSharedWorks([])).toEqual([]);
  });
});

describe("getStudioSharedWorks", () => {
  it("분리된 팀 작품 경로에 서버 상한과 opaque cursor를 전달한다", async () => {
    const request = vi.spyOn(api, "get").mockResolvedValue({
      items: [sharedWork()],
      nextCursor: "next_cursor",
    });

    await expect(
      getStudioSharedWorks({ limit: 99, cursor: "current_cursor" })
    ).resolves.toEqual({
      items: [expect.objectContaining({ workId: "work-1" })],
      nextCursor: "next_cursor",
    });
    expect(request).toHaveBeenCalledWith(STUDIO_SHARED_WORKS_PATH, {
      params: { limit: 50, cursor: "current_cursor" },
      signal: undefined,
    });
  });

  it("페이지 envelope와 cursor를 strict 검증하고 같은 cursor 반복을 차단한다", () => {
    expect(
      normalizeStudioSharedWorksPage({ items: [sharedWork()], nextCursor: "opaque_CURSOR-1" })
    ).toMatchObject({ items: [{ workId: "work-1" }], nextCursor: "opaque_CURSOR-1" });
    expect(() => normalizeStudioSharedWorksPage([sharedWork()])).toThrow(
      StudioSharedWorksResponseContractError
    );
    expect(() =>
      normalizeStudioSharedWorksPage({ items: [sharedWork()], nextCursor: "cursor=" })
    ).toThrow("다음 페이지 정보를");
    expect(() =>
      normalizeStudioSharedWorksPage(
        { items: [sharedWork()], nextCursor: "same_cursor" },
        20,
        "same_cursor"
      )
    ).toThrow("같은 위치를 반복");

    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [sharedWork()],
        nextCursor: null,
        hidden: true,
      })
    ).toThrow("페이지 응답 형식");
    const inheritedCursor = Object.create({ nextCursor: null }) as Record<string, unknown>;
    inheritedCursor.items = [sharedWork()];
    expect(() => normalizeStudioSharedWorksPage(inheritedCursor)).toThrow("페이지 응답 형식");
    expect(() => normalizeStudioSharedWorksPage({ items: [sharedWork()] })).toThrow(
      "페이지 응답 형식"
    );
  });

  it("작품·owner·capabilities도 exact allowlist로 확장 필드 유출을 차단한다", () => {
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [sharedWork({ cover: "private-large-cover" })],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [sharedWork({ owner: { name: "하린", id: "private-owner-id" } })],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [
          sharedWork({
            capabilities: {
              view: true,
              comment: true,
              edit: true,
              manageMembers: false,
              respondInvite: true,
            },
          }),
        ],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [sharedWork({ title: 42 })],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [sharedWork({ format: "legacy" })],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
    const { format: _format, ...missingFormat } = sharedWork();
    expect(() =>
      normalizeStudioSharedWorksPage({ items: [missingFormat], nextCursor: null })
    ).toThrow("열 수 있는 항목");
    expect(() =>
      normalizeStudioSharedWorksPage({
        items: [
          sharedWork({
            capabilities: {
              view: "true",
              comment: true,
              edit: true,
              manageMembers: false,
            },
          }),
        ],
        nextCursor: null,
      })
    ).toThrow("열 수 있는 항목");
  });

  it("다음 페이지를 기존 순서 뒤에 중복 없이 합친다", () => {
    const first = normalizeStudioSharedWorks([
      sharedWork({ workId: "work-3" }),
      sharedWork({ workId: "work-2" }),
    ]);
    const second = normalizeStudioSharedWorks([
      sharedWork({ workId: "work-2", title: "중복 최신값" }),
      sharedWork({ workId: "work-1" }),
    ]);

    expect(mergeStudioSharedWorks(first, second).map(({ workId }) => workId)).toEqual([
      "work-3",
      "work-2",
      "work-1",
    ]);
  });

  it("계정 scope가 바뀐 오래된 응답을 거부할 수 있다", () => {
    expect(
      isStudioSharedWorksScopeCurrent(
        { authScopeKey: "account-a" },
        { authScopeKey: "account-a" }
      )
    ).toBe(true);
    expect(
      isStudioSharedWorksScopeCurrent(
        { authScopeKey: "account-a" },
        { authScopeKey: "account-b" }
      )
    ).toBe(false);
    expect(
      isStudioSharedWorksScopeCurrent({ authScopeKey: "account-a" }, { authScopeKey: null })
    ).toBe(false);
  });
});

it("StudioSharedWork의 저장 판정은 정규화된 access만 따른다", () => {
  const work = normalizeStudioSharedWorks([sharedWork()])[0] as StudioSharedWork;
  expect(canSaveStudioSharedWork(work)).toBe(true);
  expect(canSaveStudioSharedWork({ ...work, access: "view" })).toBe(false);
});

describe("getStudioSharedWorks", () => {
  it("cursor가 빈 문자열이거나 undefined일 때 params에서 cursor를 제거하여 400 Bad Request를 방지한다", async () => {
    const apiGet = vi.spyOn(api, "get").mockResolvedValue({
      items: [sharedWork()],
      nextCursor: null,
    });

    await getStudioSharedWorks({ cursor: "  " });
    expect(apiGet).toHaveBeenCalledWith(STUDIO_SHARED_WORKS_PATH, {
      params: { limit: 20 },
      signal: undefined,
    });

    await getStudioSharedWorks({ cursor: "cursor_abc" });
    expect(apiGet).toHaveBeenLastCalledWith(STUDIO_SHARED_WORKS_PATH, {
      params: { limit: 20, cursor: "cursor_abc" },
      signal: undefined,
    });
  });
});
