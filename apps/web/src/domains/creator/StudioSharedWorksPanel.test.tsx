import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  StudioSharedWorksPanel,
  StudioSharedWorksPanelView,
  type StudioSharedWorksPanelViewProps,
} from "./StudioSharedWorksPanel";

import type { StudioSharedWork } from "./studio-shared-works-client";

const noop = () => {
  // SSR 회귀 테스트에서는 이벤트를 실행하지 않는다.
};

function work(overrides: Partial<StudioSharedWork> = {}): StudioSharedWork {
  return {
    workId: "shared/work 1",
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
      respondInvite: false,
    },
    access: "edit",
    updatedAt: "2026-07-12T02:00:00.000Z",
    ...overrides,
  };
}

function renderView(overrides: Partial<StudioSharedWorksPanelViewProps> = {}): string {
  const props: StudioSharedWorksPanelViewProps = {
    loggedIn: true,
    works: [work()],
    loading: false,
    loadingMore: false,
    error: null,
    loadMoreError: null,
    hasMore: false,
    paginationComplete: false,
    currentWorkId: null,
    onLoadMore: noop,
    onRetry: noop,
    ...overrides,
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <StudioSharedWorksPanelView {...props} />
    </MemoryRouter>
  );
}

describe("StudioSharedWorksPanelView", () => {
  it("역할·소유자·수정 시각·저장 가능 여부와 URL-safe 열기 링크를 표시한다", () => {
    const html = renderView();

    expect(html).toContain("팀 작품");
    expect(html).toContain("별빛 아래 우리");
    expect(html).toContain("하린 · 작품 소유자");
    expect(html).toContain("편집자");
    expect(html).toContain("공동 저장 가능");
    expect(html).toContain("편집으로 열기");
    expect(html).toContain('href="/studio?id=shared%2Fwork+1"');
    expect(html).toContain('aria-label="별빛 아래 우리, 편집자, 편집으로 열기"');
  });

  it("열람자와 검토자에게 서버 저장 불가를 숨기지 않고 알린다", () => {
    const html = renderView({
      works: [
        work({
          workId: "viewer-work",
          title: "열람 원고",
          role: "viewer",
          access: "view",
          capabilities: {
            view: true,
            comment: false,
            edit: false,
            manageMembers: false,
            respondInvite: false,
          },
        }),
        work({
          workId: "comment-work",
          title: "검토 원고",
          role: "commenter",
          access: "comment",
          capabilities: {
            view: true,
            comment: true,
            edit: false,
            manageMembers: false,
            respondInvite: false,
          },
        }),
      ],
    });

    expect(html).toContain("읽기 전용 · 서버 저장 불가");
    expect(html).toContain("읽기 전용으로 열기");
    expect(html).toContain("검토 전용 · 서버 저장 불가");
    expect(html).toContain("검토로 열기");
  });

  it("작품 format에 따라 cuttoon과 upload 편집기로 정확히 라우팅한다", () => {
    const html = renderView({
      works: [
        work({ workId: "cuttoon-work", format: "cuttoon" }),
        work({ workId: "upload/work 1", format: "upload", title: "업로드 원고" }),
      ],
    });

    expect(html).toContain('href="/studio?id=cuttoon-work"');
    expect(html).toContain('href="/studio?id=upload%2Fwork+1&amp;mode=upload"');
    expect(html).toContain("컷툰");
    expect(html).toContain("이미지 업로드");
  });

  it("현재 읽기 전용 작품은 재이동 링크 대신 현재 작업과 제한 안내를 제공한다", () => {
    const current = work({
      role: "viewer",
      access: "view",
      capabilities: {
        view: true,
        comment: false,
        edit: false,
        manageMembers: false,
        respondInvite: false,
      },
    });
    const html = renderView({ works: [current], currentWorkId: current.workId });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain("현재 작업");
    expect(html).toContain("이 작품은 서버 저장이 제한됩니다");
    expect(html).toContain("서버 원본은");
    expect(html).not.toContain('href="/studio?id=shared%2Fwork+1"');
  });

  it("44px 새로고침 타깃과 높이가 제한된 독립 스크롤 목록을 제공한다", () => {
    const html = renderView({ works: [work(), work({ workId: "work-2" })] });

    expect(html).toContain('aria-label="팀 작품 새로고침"');
    expect(html).toContain("size-11");
    expect(html).toContain("max-h-[min(18rem,42dvh)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("[scrollbar-gutter:stable]");
    expect(html).toContain("[content-visibility:auto]");
    expect(html.match(/min-h-\[5\.25rem\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("50개 이후를 여는 44px 더보기·진행·복구·완료 포커스 상태를 제공한다", () => {
    const ready = renderView({ hasMore: true });
    expect(ready).toContain('aria-label="팀 작품 더 불러오기"');
    expect(ready).toContain("작품 더 불러오기");
    expect(ready).toContain("min-h-11");

    const loading = renderView({ hasMore: true, loadingMore: true });
    expect(loading).toContain('aria-label="팀 작품 더 불러오는 중"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("더 불러오는 중");

    const failed = renderView({
      hasMore: true,
      loadMoreError: "다음 작품을 불러오지 못했습니다.",
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("다시 불러오기");

    const complete = renderView({ paginationComplete: true });
    expect(complete).toContain("모든 팀 작품을 불러왔습니다.");
    expect(complete).toContain('tabindex="-1"');
    expect(complete).toContain('aria-live="polite"');
  });

  it("로딩·오류·빈 상태에 설명과 복구 경로가 있다", () => {
    const loading = renderView({ works: [], loading: true });
    expect(loading).toContain('aria-label="팀 작품 불러오는 중"');
    expect(loading).toContain('aria-busy="true"');

    const error = renderView({ works: [], error: "네트워크 연결을 확인해 주세요." });
    expect(error).toContain('role="alert"');
    expect(error).toContain("팀 작품을 열지 못했어요");
    expect(error).toContain("다시 시도");

    const empty = renderView({ works: [] });
    expect(empty).toContain("참여 중인 팀 작품이 없어요");
    expect(empty).toContain("팀 초대를 수락하면");
  });

  it("로그아웃 상태에서 계정 연결 이유를 설명하고 새로고침을 비활성화한다", () => {
    const html = renderView({ loggedIn: false, works: [] });

    expect(html).toContain("로그인이 필요해요");
    expect(html).toContain("disabled");
    expect(html).toContain("초대를 수락한 계정");
  });
});

describe("StudioSharedWorksPanel shell", () => {
  it("닫힌 상위 surface에서는 렌더링과 요청 준비를 생략한다", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StudioSharedWorksPanel
          authScopeKey="account-a"
          loggedIn
          open={false}
          currentWorkId={null}
        />
      </MemoryRouter>
    );
    expect(html).toBe("");
  });

  it("인증 준비 전에도 안정적인 로그인 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StudioSharedWorksPanel authScopeKey={null} loggedIn open currentWorkId={null} />
      </MemoryRouter>
    );
    expect(html).toContain("로그인이 필요해요");
  });
});
