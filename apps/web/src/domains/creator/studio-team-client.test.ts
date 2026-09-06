import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStudioTeam,
  getStudioTeamActivity,
  getStudioTeamInvitations,
  inviteStudioTeamMember,
  isStudioTeamInvitationStaleError,
  isStudioTeamResponseContractError,
  normalizeStudioTeamActivity,
  normalizeStudioTeamInvitationAcknowledgement,
  normalizeStudioTeamInvitations,
  normalizeStudioTeamSnapshot,
  removeStudioTeamMember,
  respondToStudioTeamInvitation,
  updateStudioTeamMemberRole,
} from "./studio-team-client";

const { apiDelete, apiGet, apiPatch, apiPost, toApiError } = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  toApiError: vi.fn(async (_error: unknown, fallback: string) => new Error(`안전 오류: ${fallback}`)),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: {
    delete: apiDelete,
    get: apiGet,
    patch: apiPatch,
    post: apiPost,
  },
  toApiError,
}));

function snapshot(workId = "work/한글") {
  return {
    workId,
    viewer: {
      userId: "owner-1",
      role: "owner",
      status: "active",
      capabilities: { view: true, comment: true, edit: true, manageMembers: true, respondInvite: false },
    },
    members: [
      {
        userId: "owner-1",
        name: "작가",
        image: "",
        role: "owner",
        status: "active",
        isOwner: true,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ],
  };
}

describe("studio team client", () => {
  beforeEach(() => {
    apiDelete.mockReset();
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    toApiError.mockClear();
  });

  it("작품 id를 인코딩해 팀 스냅샷을 불러온다", async () => {
    apiGet.mockResolvedValue(snapshot());
    const controller = new AbortController();

    const result = await getStudioTeam("work/한글", controller.signal);

    expect(apiGet).toHaveBeenCalledWith("/creator/works/work%2F%ED%95%9C%EA%B8%80/team", {
      signal: controller.signal,
    });
    expect(result.workId).toBe("work/한글");
    expect(result.viewer.capabilities.manageMembers).toBe(true);
  });

  it("초대함과 감사 기록 URL에 제한된 limit와 정확히 인코딩한 작품 id를 전달한다", async () => {
    apiGet.mockResolvedValue([]);
    const controller = new AbortController();

    await getStudioTeamInvitations(20, controller.signal);
    await getStudioTeamActivity("work/한글 그대로", 20, controller.signal);

    expect(apiGet).toHaveBeenNthCalledWith(1, "/creator/team/invitations", {
      params: { limit: 20 },
      signal: controller.signal,
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      "/creator/works/work%2F%ED%95%9C%EA%B8%80%20%EA%B7%B8%EB%8C%80%EB%A1%9C/team/activity",
      { params: { limit: 20 }, signal: controller.signal }
    );

    await getStudioTeamInvitations(999);
    await getStudioTeamActivity("work-1", -10);
    expect(apiGet).toHaveBeenNthCalledWith(3, "/creator/team/invitations", {
      params: { limit: 50 },
      signal: undefined,
    });
    expect(apiGet).toHaveBeenNthCalledWith(4, "/creator/works/work-1/team/activity", {
      params: { limit: 1 },
      signal: undefined,
    });
  });

  it("초대 payload와 역할 변경·삭제 URL을 정확히 전송한다", async () => {
    apiPost.mockResolvedValue(snapshot("work 1"));
    apiPatch.mockResolvedValue(snapshot("work 1"));
    apiDelete.mockResolvedValue(snapshot("work 1"));

    await inviteStudioTeamMember("work 1", { userId: "member/한글", role: "editor" });
    await updateStudioTeamMemberRole("work 1", "member/한글", "commenter");
    await removeStudioTeamMember("work 1", "member/한글");

    expect(apiPost).toHaveBeenCalledWith("/creator/works/work%201/team", {
      userId: "member/한글",
      role: "editor",
    });
    expect(apiPatch).toHaveBeenCalledWith(
      "/creator/works/work%201/team/members/member%2F%ED%95%9C%EA%B8%80",
      { role: "commenter" }
    );
    expect(apiDelete).toHaveBeenCalledWith(
      "/creator/works/work%201/team/members/member%2F%ED%95%9C%EA%B8%80"
    );
  });

  it("초대 응답 action을 전용 endpoint에 전달한다", async () => {
    apiPost
      .mockResolvedValueOnce({ workId: "work-1", role: "editor", status: "active" })
      .mockResolvedValueOnce({ workId: "work-1", role: "editor", status: "declined" });
    const invitationId = "11111111-1111-4111-8111-111111111111";

    await expect(respondToStudioTeamInvitation("work-1", "accept", invitationId)).resolves.toEqual({
      workId: "work-1",
      role: "editor",
      status: "active",
    });
    await expect(respondToStudioTeamInvitation("work-1", "decline", invitationId)).resolves.toEqual({
      workId: "work-1",
      role: "editor",
      status: "declined",
    });

    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/creator/works/work-1/team/invitations/respond",
      { action: "accept", invitationId }
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/creator/works/work-1/team/invitations/respond",
      { action: "decline", invitationId }
    );
  });

  it("이미 갱신된 초대의 409는 안전한 전용 오류로 분류해 재조회할 수 있게 한다", async () => {
    apiPost.mockRejectedValue({ response: { status: 409 } });

    const error = await respondToStudioTeamInvitation(
      "work-1",
      "accept",
      "11111111-1111-4111-8111-111111111111"
    ).catch((cause: unknown) => cause);

    expect(isStudioTeamInvitationStaleError(error)).toBe(true);
    expect(error).toMatchObject({
      message: "초대가 이미 갱신되었습니다. 최신 초대 목록을 다시 불러옵니다.",
    });
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("API 오류를 안전한 사용자 메시지로 변환한다", async () => {
    const cause = new Error("provider secret");
    apiPost.mockRejectedValue(cause);

    await expect(
      inviteStudioTeamMember("work-1", { userId: "member-1", role: "viewer" })
    ).rejects.toThrow("안전 오류: 팀원을 초대하지 못했습니다.");
    expect(toApiError).toHaveBeenCalledWith(cause, "팀원을 초대하지 못했습니다.");
  });

  it("목록 계약 오류를 빈 결과나 일반 API 오류로 바꾸지 않는다", async () => {
    apiGet.mockResolvedValueOnce({ invitations: [] }).mockResolvedValueOnce({ activity: [] });

    const invitationError = await getStudioTeamInvitations().catch((error: unknown) => error);
    const activityError = await getStudioTeamActivity("work-1").catch((error: unknown) => error);

    expect(isStudioTeamResponseContractError(invitationError)).toBe(true);
    expect(isStudioTeamResponseContractError(activityError)).toBe(true);
    expect(toApiError).not.toHaveBeenCalled();
  });
});

describe("normalizeStudioTeamInvitations", () => {
  it("알려진 역할·안전한 날짜·정확한 작품 id만 유지하고 작품별 최신 초대 하나로 제한한다", () => {
    const invitationId = "11111111-1111-4111-8111-111111111111";
    const normalized = normalizeStudioTeamInvitations(
      [
        {
          workId: " work/한글 그대로 ",
          workTitle: "  별빛 아래 우리  ",
          owner: { userId: "legacy-owner-1", name: "  하린  ", image: "https://private.example/avatar.png" },
          role: "editor",
          invitationId,
          invitedAt: "2026-07-12T10:30:00+09:00",
          secret: "버려야 함",
        },
        {
          workId: " work/한글 그대로 ",
          workTitle: "중복 작품",
          owner: { name: "하린" },
          role: "viewer",
          invitationId: "22222222-2222-4222-8222-222222222222",
          invitedAt: "2026-07-11T00:00:00.000Z",
        },
        {
          workId: "work-invalid-role",
          workTitle: "위험한 역할",
          owner: { name: "나리" },
          role: "owner",
          invitationId: "33333333-3333-4333-8333-333333333333",
          invitedAt: "2026-07-12T00:00:00.000Z",
        },
        {
          workId: "work-invalid-date",
          workTitle: "잘못된 날짜",
          owner: { name: "수아" },
          role: "commenter",
          invitationId: "44444444-4444-4444-8444-444444444444",
          invitedAt: "not-a-date",
        },
      ],
      20
    );

    expect(normalized).toEqual([
      {
        workId: " work/한글 그대로 ",
        workTitle: "별빛 아래 우리",
        owner: { name: "하린" },
        role: "editor",
        invitationId,
        invitedAt: "2026-07-12T01:30:00.000Z",
      },
    ]);
  });

  it("과도한 응답 배열과 요청 limit을 제한한다", () => {
    const candidates = Array.from({ length: 80 }, (_, index) => ({
      workId: `work-${index}`,
      workTitle: `작품 ${index}`,
      owner: { name: `작가 ${index}` },
      role: "viewer",
      invitationId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      invitedAt: "2026-07-12T00:00:00.000Z",
    }));

    expect(normalizeStudioTeamInvitations(candidates, 999)).toHaveLength(50);
    expect(normalizeStudioTeamInvitations(candidates, 2)).toHaveLength(2);
  });

  it("대문자 UUID 동의 식별자를 opaque 값으로 보존해 서버 exact equality를 깨지 않는다", () => {
    const invitationId = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    expect(
      normalizeStudioTeamInvitations([
        {
          workId: "work-uppercase-token",
          workTitle: "대문자 토큰 작품",
          owner: { name: "하린" },
          role: "editor",
          invitationId,
          invitedAt: "2026-07-12T00:00:00.000Z",
        },
      ])[0]?.invitationId
    ).toBe(invitationId);
  });

  it("배열이 아니거나 비어 있지 않은 배열의 모든 항목이 손상되면 계약 오류를 낸다", () => {
    expect(() => normalizeStudioTeamInvitations({ items: [] })).toThrow(
      "받은 팀 초대 응답 형식이 올바르지 않습니다"
    );
    expect(() => normalizeStudioTeamInvitations([null, { workId: "broken" }])).toThrow(
      "사용할 수 있는 항목이 없습니다"
    );
    expect(normalizeStudioTeamInvitations([])).toEqual([]);
  });
});

describe("normalizeStudioTeamActivity", () => {
  it("알려진 감사 동작·역할·상태만 유지하고 invitationId를 구조적으로 제거한다", () => {
    const token = "55555555-5555-4555-8555-555555555555";
    const normalized = normalizeStudioTeamActivity([
      {
        id: "activity-1",
        action: "role_change",
        actor: { userId: "owner-1", name: "서윤" },
        target: { userId: "editor-1", name: "민호" },
        before: { role: "viewer", status: "active" },
        after: { role: "editor", status: "active" },
        createdAt: "2026-07-12T11:00:00+09:00",
        invitationId: token,
      },
      {
        id: "activity-2",
        action: "teleport",
        actor: { userId: "owner-1", name: "서윤" },
        target: { userId: null, name: "알 수 없음" },
        before: null,
        after: { role: "admin", status: "pending" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      {
        id: "activity-3",
        action: "invite",
        actor: { userId: "owner-1", name: "서윤" },
        target: { userId: "member-1", name: "지우" },
        before: null,
        after: { role: "super-admin", status: "pending" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ]);

    expect(normalized).toEqual([
      {
        id: "activity-1",
        action: "role_change",
        actor: { userId: "owner-1", name: "서윤" },
        target: { userId: "editor-1", name: "민호" },
        before: { role: "viewer", status: "active" },
        after: { role: "editor", status: "active" },
        createdAt: "2026-07-12T02:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(normalized)).not.toContain(token);
    expect(normalized[0]).not.toHaveProperty("invitationId");
  });

  it("배열이 아니거나 모든 감사 항목이 손상되면 빈 기록으로 오인하지 않는다", () => {
    expect(() => normalizeStudioTeamActivity({ items: [] })).toThrow(
      "팀 변경 기록 응답 형식이 올바르지 않습니다"
    );
    expect(() => normalizeStudioTeamActivity([null, { action: "unknown" }])).toThrow(
      "사용할 수 있는 항목이 없습니다"
    );
    expect(normalizeStudioTeamActivity([])).toEqual([]);
  });
});

describe("normalizeStudioTeamInvitationAcknowledgement", () => {
  it("최소 응답의 작품·역할·요청별 상태만 유지한다", () => {
    expect(
      normalizeStudioTeamInvitationAcknowledgement(
        { workId: "work-1", role: "commenter", status: "active", members: ["비공개"] },
        "work-1",
        "accept"
      )
    ).toEqual({ workId: "work-1", role: "commenter", status: "active" });
    expect(
      normalizeStudioTeamInvitationAcknowledgement(
        { workId: "work-1", role: "viewer", status: "declined" },
        "work-1",
        "decline"
      )
    ).toEqual({ workId: "work-1", role: "viewer", status: "declined" });
  });

  it("다른 작품·소유자 역할·요청과 어긋난 상태를 거부한다", () => {
    expect(() =>
      normalizeStudioTeamInvitationAcknowledgement(
        { workId: "other", role: "editor", status: "active" },
        "work-1",
        "accept"
      )
    ).toThrow("응답 확인 형식");
    expect(() =>
      normalizeStudioTeamInvitationAcknowledgement(
        { workId: "work-1", role: "owner", status: "active" },
        "work-1",
        "accept"
      )
    ).toThrow("응답 확인 형식");
    expect(() =>
      normalizeStudioTeamInvitationAcknowledgement(
        { workId: "work-1", role: "editor", status: "declined" },
        "work-1",
        "accept"
      )
    ).toThrow("처리 상태가 요청과 일치하지 않습니다");
  });
});

describe("normalizeStudioTeamSnapshot", () => {
  it("알 수 없는 역할·상태를 권한 상승 없이 안전한 값으로 낮춘다", () => {
    const normalized = normalizeStudioTeamSnapshot(
      {
        workId: "요청-작품",
        viewer: {
          userId: "member-1",
          role: "super-admin",
          status: "mystery",
          capabilities: { manageMembers: "yes", edit: true, unknownFlag: true },
        },
        members: [
          {
            userId: "member-1",
            name: "",
            image: null,
            role: "super-admin",
            status: "mystery",
            isOwner: false,
          },
          {
            userId: "member-1",
            name: "중복",
            image: "https://example.com/avatar.png",
            role: "admin",
            status: "active",
            isOwner: false,
          },
          { role: "owner" },
        ],
      },
      "요청-작품"
    );

    expect(normalized.workId).toBe("요청-작품");
    expect(normalized.viewer).toMatchObject({
      role: "viewer",
      status: "declined",
      capabilities: {
        view: false,
        comment: false,
        edit: false,
        manageMembers: false,
        respondInvite: false,
      },
    });
    expect(normalized.members).toEqual([
      {
        userId: "member-1",
        name: "member-1",
        image: "",
        role: "viewer",
        status: "declined",
        isOwner: false,
      },
    ]);
  });

  it("다른 작품의 팀 응답은 현재 작품으로 재라벨링하지 않고 거부한다", () => {
    expect(() =>
      normalizeStudioTeamSnapshot(
        {
          workId: "other-work",
          viewer: {
            userId: "owner-1",
            role: "owner",
            status: "active",
            capabilities: { manageMembers: true },
          },
          members: [],
        },
        "requested-work"
      )
    ).toThrow("다른 작품의 팀 권한 응답");
  });

  it("viewer 식별자가 없는 응답은 거부한다", () => {
    expect(() =>
      normalizeStudioTeamSnapshot({ workId: "work-1", viewer: {}, members: [] }, "work-1")
    ).toThrow(
      "사용자 권한 정보를 확인하지 못했습니다"
    );
  });
});
