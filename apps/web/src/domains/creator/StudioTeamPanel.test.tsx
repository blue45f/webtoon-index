import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StudioTeamInvitationStaleError,
  isStudioTeamRequestScopeCurrent,
  nextStudioTeamInboxFocusTarget,
  removeAcknowledgedStudioTeamInvitation,
  shouldReloadStudioTeamInvitation,
  shouldRequestStudioTeamActivity,
  type StudioTeamActivityItem,
  type StudioTeamInvitationSummary,
  type StudioTeamSnapshot,
} from "./studio-team-client";
import {
  StudioTeamPanel,
  StudioTeamPanelView,
  type StudioTeamPanelViewProps,
} from "./StudioTeamPanel";

import type {
  StudioDraftCollaborationIdentity,
  StudioDraftCollaborationReadiness,
} from "./studio-draft-collaboration";

const noop = () => {
  // Node SSR 회귀 테스트에서는 이벤트를 실행하지 않는다.
};

function teamSnapshot(overrides: Partial<StudioTeamSnapshot["viewer"]> = {}): StudioTeamSnapshot {
  return {
    workId: "work-1",
    viewer: {
      userId: "owner-1",
      role: "owner",
      status: "active",
      capabilities: { view: true, comment: true, edit: true, manageMembers: true, respondInvite: false },
      ...overrides,
    },
    members: [
      {
        userId: "owner-1",
        name: "서윤",
        image: "",
        role: "owner",
        status: "active",
        isOwner: true,
      },
      {
        userId: "editor/1",
        name: "민호",
        image: "",
        role: "editor",
        status: "active",
        isOwner: false,
      },
    ],
  };
}

function teamInvitation(): StudioTeamInvitationSummary {
  return {
    workId: "invited/work-1",
    workTitle: "별빛 아래 우리",
    owner: { name: "하린" },
    role: "editor",
    invitationId: "11111111-1111-4111-8111-111111111111",
    invitedAt: "2026-07-12T01:30:00.000Z",
  };
}

function teamActivity(): StudioTeamActivityItem {
  return {
    id: "activity-1",
    action: "role_change",
    actor: { userId: "owner-1", name: "서윤" },
    target: { userId: "editor/1", name: "민호" },
    before: { role: "viewer", status: "active" },
    after: { role: "editor", status: "active" },
    createdAt: "2026-07-12T02:00:00.000Z",
  };
}

function draftIdentity(
  overrides: Partial<StudioDraftCollaborationIdentity> = {}
): StudioDraftCollaborationIdentity {
  return {
    version: 1,
    draftDocumentId: "draft_11111111-1111-4111-8111-111111111111",
    documentScopeKey: "autosave:new-work",
    ownerScopeKey: "account-a",
    createdAt: "2026-07-12T01:00:00.000Z",
    lastOpenedAt: "2026-07-12T01:00:00.000Z",
    expiresAt: "2026-08-11T01:00:00.000Z",
    persistence: "persistent",
    ...overrides,
  };
}

function draftReadiness(
  overrides: Partial<Extract<StudioDraftCollaborationReadiness, { status: "local" }>> = {}
): StudioDraftCollaborationReadiness {
  return { status: "local", identity: draftIdentity(), ...overrides };
}

function renderView(overrides: Partial<StudioTeamPanelViewProps> = {}): string {
  const props: StudioTeamPanelViewProps = {
    actionError: null,
    busyAction: null,
    confirmRemoveUserId: null,
    activity: [],
    activityError: null,
    activityLoading: false,
    inviteRole: "editor",
    inviteUserId: "",
    invitations: [],
    invitationsError: null,
    invitationsLoading: false,
    inboxFocusTarget: null,
    loadError: null,
    loading: false,
    loggedIn: true,
    notice: null,
    snapshot: teamSnapshot(),
    workId: "work-1",
    onActivityOpenChange: noop,
    onActivityRefresh: noop,
    onInboxFocusHandled: noop,
    onInboxInvitationRespond: noop,
    onInvitationRespond: noop,
    onInvite: noop,
    onInviteRoleChange: noop,
    onInviteUserIdChange: noop,
    onRemoveCancel: noop,
    onRemoveConfirm: noop,
    onRemoveRequest: noop,
    onInvitationsRetry: noop,
    onRetry: noop,
    onRoleChange: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioTeamPanelView {...props} />);
}

describe("StudioTeamPanel shell and first-use states", () => {
  it("로그아웃 상태에서 인증 안내와 접근 가능한 dialog 구조를 제공한다", () => {
    const html = renderToStaticMarkup(
      <StudioTeamPanel authScopeKey={null} loggedIn={false} open workId="work-1" onClose={noop} />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('aria-label="팀 작업 공간 닫기"');
    expect(html).toContain("로그인이 필요해요");
    expect(html).toContain("size-11");
    expect(html).toContain("팀 작업 공간");
    expect(html).toContain("서버 권한");
  });

  it("저장되지 않은 원고에서 저장 선행 조건과 받은 초대 로딩 상태를 함께 설명한다", () => {
    const html = renderToStaticMarkup(
      <StudioTeamPanel authScopeKey="account-a" loggedIn open workId={null} onClose={noop} />
    );

    expect(html).toContain("작품을 먼저 저장해 주세요");
    expect(html).toContain("현재 원고는 아직 서버에 저장되지 않았어요");
    expect(html).toContain("내 팀 초대");
    expect(html).toContain('aria-label="받은 팀 초대 불러오는 중"');
    expect(html).not.toContain("사용자 ID");
  });

  it("모바일 시트가 하단 도구막대 위에서 독립 스크롤하고 데스크톱 우측 패널로 전환된다", () => {
    const html = renderToStaticMarkup(
      <StudioTeamPanel authScopeKey={null} loggedIn={false} open workId="work-1" onClose={noop} />
    );

    expect(html).toContain("bottom-[calc(7rem+env(safe-area-inset-bottom))]");
    expect(html).toContain("z-[90]");
    expect(html).toContain("w-[100dvw]");
    expect(html).toContain("max-h-[min(72dvh,calc(100dvh-7.75rem-env(safe-area-inset-top)))]");
    expect(html).toContain("sm:inset-y-0");
    expect(html).toContain("sm:w-[26rem]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });

  it("닫힌 상태에서는 dialog를 렌더링하지 않는다", () => {
    const html = renderToStaticMarkup(
      <StudioTeamPanel authScopeKey="account-a" loggedIn open={false} workId="work-1" onClose={noop} />
    );
    expect(html).toBe("");
  });
});

describe("StudioTeamPanelView unsaved invitation inbox", () => {
  it("안정적인 로컬 초안 ID와 lazy 서버 생성 상태를 저장 전부터 안내한다", () => {
    const html = renderView({
      workId: null,
      snapshot: null,
      draftCollaboration: draftReadiness(),
      onDraftShareRequest: noop,
    });

    expect(html).toContain('data-studio-draft-collaboration-state="local"');
    expect(html).toContain("저장 전 협업을 준비할 수 있어요");
    expect(html).toContain("초안 11111111");
    expect(html).toContain("작업실을 여는 것만으로 서버 리소스를 만들지 않습니다");
    expect(html).toContain("서버 작업실과 초대는 아직 생성되지 않았습니다");
    expect(html).toContain("공유 링크 만들기");
    expect(html).not.toContain("작품을 먼저 저장해 주세요");
  });

  it("임시 작업실 준비 중·완료·메모리 전용 상태를 과장 없이 구분한다", () => {
    const provisioningHtml = renderView({
      workId: null,
      snapshot: null,
      draftCollaboration: {
        status: "provisioning",
        identity: draftIdentity(),
        intent: "share-link",
      },
      onDraftShareRequest: noop,
    });
    expect(provisioningHtml).toContain('data-studio-draft-collaboration-state="provisioning"');
    expect(provisioningHtml).toContain("공유 링크 준비 중");
    expect(provisioningHtml).toContain("disabled");

    const readyHtml = renderView({
      workId: null,
      snapshot: null,
      draftCollaboration: {
        status: "ready",
        identity: draftIdentity(),
        room: {
          version: 1,
          roomId: "draft-room_22222222-2222-4222-8222-222222222222",
          provisionalWorkId: "work-1",
          draftDocumentId: "draft_11111111-1111-4111-8111-111111111111",
          ownerScopeKey: "account-a",
          graphRevision: 1,
          provisionedAt: "2026-07-12T01:30:00.000Z",
          expiresAt: "2026-07-19T01:30:00.000Z",
        },
      },
      onDraftShareRequest: noop,
    });
    expect(readyHtml).toContain('data-studio-draft-collaboration-state="ready"');
    expect(readyHtml).toContain("임시 협업 작업실이 준비됐어요");
    expect(readyHtml).toContain("임시 작업실 만료 예정");
    expect(readyHtml).not.toContain("공유 링크 만들기");

    const memoryOnlyHtml = renderView({
      workId: null,
      snapshot: null,
      draftCollaboration: draftReadiness({
        identity: draftIdentity({ persistence: "memory-only" }),
      }),
    });
    expect(memoryOnlyHtml).toContain("이 탭을 닫으면 초안 협업 ID가 바뀔 수 있습니다");
  });

  it("로딩·오류·빈 초대 상태에 각각 이해 가능한 안내와 복구 경로가 있다", () => {
    const loadingHtml = renderView({
      workId: null,
      snapshot: null,
      invitationsLoading: true,
    });
    expect(loadingHtml).toContain('aria-label="받은 팀 초대 불러오는 중"');

    const errorHtml = renderView({
      workId: null,
      snapshot: null,
      invitationsError: "네트워크 연결을 확인해 주세요.",
    });
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("초대 목록을 열지 못했어요");
    expect(errorHtml).toContain("다시 시도");

    const emptyHtml = renderView({ workId: null, snapshot: null });
    expect(emptyHtml).toContain("도착한 초대가 없어요");
    expect(emptyHtml).toContain("새 초대를 받으면");
  });

  it("작품·소유자·역할·시간과 44px 수락/거절 컨트롤을 표시하되 초대 식별자는 노출하지 않는다", () => {
    const invitation = teamInvitation();
    const html = renderView({
      workId: null,
      snapshot: null,
      invitations: [invitation],
    });

    expect(html).toContain("별빛 아래 우리");
    expect(html).toContain("하린 · 작품 소유자");
    expect(html).toContain("편집자");
    expect(html).toContain('aria-label="별빛 아래 우리 팀 초대 수락"');
    expect(html).toContain('aria-label="별빛 아래 우리 팀 초대 거절"');
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(invitation.invitationId);
    expect(html).not.toContain("<img");
  });

  it("초대 처리 중인 버튼을 보조 기술에 알리고 안정적인 포커스 대상으로 유지한다", () => {
    const invitation = teamInvitation();
    const html = renderView({
      workId: null,
      snapshot: null,
      invitations: [invitation],
      busyAction: `inbox:${invitation.workId}:accept`,
    });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="별빛 아래 우리 팀 초대 수락 처리 중"');
    expect(html).toContain('aria-label="별빛 아래 우리 팀 초대 거절"');
  });
});

describe("StudioTeamPanelView permissions", () => {
  it("응답 대기 중인 사용자는 초대를 수락하거나 거절할 수 있다", () => {
    const pending = teamSnapshot({
      userId: "pending-1",
      role: "commenter",
      status: "pending",
      capabilities: { view: false, comment: false, edit: false, manageMembers: false, respondInvite: true },
      invitationId: "11111111-1111-4111-8111-111111111111",
    });
    pending.members.push({
      userId: "pending-1",
      name: "지우",
      image: "",
      role: "commenter",
      status: "pending",
      isOwner: false,
    });

    const html = renderView({ snapshot: pending });

    expect(html).toContain("팀 초대가 도착했어요");
    expect(html).toContain("검토자 권한");
    expect(html).toContain("초대 수락");
    expect(html).toContain("초대 거절");
    expect(html).not.toContain('data-team-manage-controls="true"');
    expect(html).toContain("소유자와 내 정보");
    expect(html).toContain("전체 팀 명단은 소유자와 관리자에게만 표시됩니다");
  });

  it("manageMembers 권한이 있는 소유자·관리자에게만 초대와 역할 관리 UI를 제공한다", () => {
    const html = renderView({ activity: [teamActivity()] });

    expect(html).toContain("팀원 초대");
    expect(html).toContain('id="studio-team-invite-user-id"');
    expect(html).toContain("가입한 사용자의 ID로 초대합니다");
    expect(html).toContain('<strong class="font-semibold text-fg-2">편집자</strong>');
    expect(html).toContain("원고를 읽고 공동 저장합니다");
    expect(html).toContain('data-team-manage-controls="true"');
    expect(html).toContain('data-team-members-heading="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="민호 역할"');
    expect(html).toContain('aria-label="민호 팀에서 내보내기"');
    expect(html).not.toContain('aria-label="서윤 팀에서 내보내기"');
    expect(html).toContain('data-team-activity="manager-only"');
    expect(html).toContain("최근 팀 변경 기록");
    expect(html).toContain("역할 변경");
    expect(html).toContain("열람자 · 참여 중");
    expect(html).toContain("편집자 · 참여 중");
    expect(html).toContain('aria-label="팀 변경 기록 새로고침"');
    expect(html).toContain("로그인 세션과 작품 권한을 확인한 팀 서버를 우선");
    expect(html).not.toContain("위 같이 보기는 같은 출처 로컬 탭 전용");
    expect(html.match(/group-open:rotate-180/g)?.length).toBe(2);
  });

  it("서버가 구형 이미지 URL을 포함해도 팀원은 이니셜만 표시한다", () => {
    const snapshot = teamSnapshot();
    snapshot.members[1].image = "https://private.example/member-avatar.png";
    const html = renderView({ snapshot });

    expect(html).toContain(">민<");
    expect(html).not.toContain("private.example");
    expect(html).not.toContain("<img");
  });

  it("관리 권한이 없는 편집자에게 초대·변경·삭제 컨트롤을 노출하지 않는다", () => {
    const editor = teamSnapshot({
      userId: "editor/1",
      role: "editor",
      status: "active",
      capabilities: { view: false, comment: false, edit: false, manageMembers: false, respondInvite: false },
    });

    const html = renderView({ snapshot: editor });

    expect(html).not.toContain("팀원 초대");
    expect(html).not.toContain("studio-team-invite-user-id");
    expect(html).not.toContain('data-team-manage-controls="true"');
    expect(html).not.toContain("팀에서 내보내기");
    expect(html).toContain("내 역할 · 편집자");
    expect(html).toContain("소유자와 내 정보");
    expect(html).toContain("역할별 서버 권한 안내");
    expect(html).not.toContain('data-team-activity="manager-only"');
    expect(html).not.toContain("최근 팀 변경 기록");
  });

  it("active 관리자에게 manageMembers capability가 있으면 멤버 관리 UI를 제공한다", () => {
    const admin = teamSnapshot({
      userId: "admin-1",
      role: "admin",
      status: "active",
      capabilities: { view: false, comment: false, edit: false, manageMembers: true, respondInvite: false },
    });

    const html = renderView({ snapshot: admin });

    expect(html).toContain("팀원 초대");
    expect(html).toContain('data-team-manage-controls="true"');
    expect(html).toContain("내 역할 · 관리자");
  });

  it("관리 capability가 있어도 편집자 역할이면 권한 상승 컨트롤을 방어적으로 숨긴다", () => {
    const suspicious = teamSnapshot({
      userId: "editor/1",
      role: "editor",
      status: "active",
      capabilities: { view: false, comment: false, edit: false, manageMembers: true, respondInvite: false },
    });

    const html = renderView({ snapshot: suspicious });

    expect(html).not.toContain("팀원 초대");
    expect(html).not.toContain('data-team-manage-controls="true"');
    expect(html).not.toContain('data-team-activity="manager-only"');
  });

  it("로딩·오류·빈 멤버 상태에 각각 안내와 복구 경로가 있다", () => {
    expect(renderView({ loading: true })).toContain('aria-label="팀 작업 공간 불러오는 중"');
    const errorHtml = renderView({ loadError: "네트워크 연결을 확인하세요.", snapshot: null });
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('data-team-retry="true"');
    expect(errorHtml).toContain("다시 시도");

    const emptyHtml = renderView({ snapshot: { ...teamSnapshot(), members: [] } });
    expect(emptyHtml).toContain("표시할 팀원이 없어요");
    expect(emptyHtml).toContain("첫 팀원을 추가");
  });

  it("저장된 서버 권한만 표시하며 존재하지 않는 접속 상태를 주장하지 않는다", () => {
    const html = renderView();
    expect(html).toContain("revision 공동 저장까지 서버 권한에 연결되었습니다");
    expect(html).not.toContain("온라인");
    expect(html).not.toContain("접속 중");
    expect(html).not.toContain("실시간");
  });
});

describe("StudioTeamPanel request and state decisions", () => {
  const managerDecision = {
    open: true,
    loggedIn: true,
    authScopeKey: "account-a",
    workId: "work-1",
    canManageMembers: true,
    loadedScope: null,
    requestScope: null,
  } as const;

  it("관리자가 변경 기록을 처음 펼칠 때 한 번만 요청하고 비관리자는 요청하지 않는다", () => {
    expect(shouldRequestStudioTeamActivity(managerDecision)).toBe(true);
    expect(
      shouldRequestStudioTeamActivity({
        ...managerDecision,
        requestScope: { authScopeKey: "account-a", workId: "work-1" },
      })
    ).toBe(false);
    expect(
      shouldRequestStudioTeamActivity({
        ...managerDecision,
        loadedScope: { authScopeKey: "account-a", workId: "work-1" },
      })
    ).toBe(false);
    expect(
      shouldRequestStudioTeamActivity({ ...managerDecision, canManageMembers: false })
    ).toBe(false);
  });

  it("작품 또는 계정 범위가 바뀌면 이전 비동기 응답을 현재 상태에 적용하지 않는다", () => {
    const requestScope = { authScopeKey: "account-a", workId: "work-1" };
    expect(
      isStudioTeamRequestScopeCurrent(requestScope, {
        authScopeKey: "account-a",
        workId: "work-1",
      })
    ).toBe(true);
    expect(
      isStudioTeamRequestScopeCurrent(requestScope, {
        authScopeKey: "account-b",
        workId: "work-1",
      })
    ).toBe(false);
    expect(
      isStudioTeamRequestScopeCurrent(requestScope, {
        authScopeKey: "account-a",
        workId: "work-2",
      })
    ).toBe(false);
    expect(
      isStudioTeamRequestScopeCurrent(requestScope, { authScopeKey: null, workId: "work-1" })
    ).toBe(false);
  });

  it("409 초대 충돌만 자동 재조회 대상으로 분류한다", () => {
    expect(shouldReloadStudioTeamInvitation(new StudioTeamInvitationStaleError())).toBe(true);
    expect(shouldReloadStudioTeamInvitation(new Error("network"))).toBe(false);
  });

  it("성공한 초대 카드 하나만 제거하고 다음 카드 또는 새로고침으로 포커스를 보낸다", () => {
    const first = teamInvitation();
    const second: StudioTeamInvitationSummary = {
      ...teamInvitation(),
      workId: "work-2",
      workTitle: "두 번째 작품",
      invitationId: "22222222-2222-4222-8222-222222222222",
    };
    const invitations = [first, second];

    expect(removeAcknowledgedStudioTeamInvitation(invitations, first)).toEqual([second]);
    expect(
      removeAcknowledgedStudioTeamInvitation(invitations, {
        workId: first.workId,
        invitationId: "33333333-3333-4333-8333-333333333333",
      })
    ).toEqual(invitations);
    expect(nextStudioTeamInboxFocusTarget(invitations, first)).toEqual({
      kind: "invitation",
      workId: second.workId,
    });
    expect(nextStudioTeamInboxFocusTarget([first], first)).toEqual({ kind: "refresh" });
  });
});
