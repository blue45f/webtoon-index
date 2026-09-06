import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseStudioProjectFile } from "./studio-project-file";
import { studioRevisionCurrentLocation } from "./studio-revision-compare-location";
import { diffStudioProjectRevisions } from "./studio-revision-diff";
import {
  StudioRevisionCompareView,
  type StudioRevisionCompareViewProps,
} from "./StudioRevisionCompareView";

import type { StudioServerRevisionComparison } from "./studio-server-revision-comparison";

const noop = () => {
  // Static rendering does not invoke event handlers.
};

function project(title: string, text: string, x = 0) {
  return parseStudioProjectFile({
    version: 2,
    title,
    pagesList: [{
      id: "page-1",
      name: "첫 만남",
      elements: [{ id: "dialogue-1", type: "text", text, x }],
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1800,
    }],
  });
}

function comparison(): StudioServerRevisionComparison {
  const target = project("비공개 초안", "절대 표시하면 안 되는 대사", 0);
  const server = project("현재 화", "안녕", 0);
  const local = project("현재 화", "안녕!", 20);
  return {
    targetRevision: 2,
    baseRevision: 4,
    localToTarget: diffStudioProjectRevisions(local, target),
    serverToLocal: diffStudioProjectRevisions(server, local),
    publicationImpact: { statusChange: null, changedRelations: [] },
    pageLabels: { "page-1": "첫 만남" },
  };
}

function renderView(overrides: Partial<StudioRevisionCompareViewProps> = {}): string {
  const props: StudioRevisionCompareViewProps = {
    targetRevision: 2,
    baseRevision: 4,
    comparison: comparison(),
    loading: false,
    error: null,
    restoring: false,
    confirmingRestore: false,
    pageLabels: { "page-1": "첫 만남" },
    canNavigateChange: () => true,
    onBack: noop,
    onRetry: noop,
    onRequestRestore: noop,
    onCancelRestore: noop,
    onConfirmRestore: noop,
    onNavigateChange: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioRevisionCompareView {...props} />);
}

describe("StudioRevisionCompareView", () => {
  it("navigates a pending reparent from the element's current page", () => {
    expect(studioRevisionCurrentLocation({
      kind: "element-reparented",
      scope: "element",
      pageId: "target-page",
      previousPageId: "current-page",
      elementId: "element-1",
      elementType: "text",
    })).toEqual({ pageId: "current-page", elementId: "element-1" });
  });

  it("shows a responsive, touch-safe loading state without promising raw value inspection", () => {
    const html = renderView({ comparison: null, loading: true });
    expect(html).toContain("두 버전을 안전하게 비교하는 중");
    expect(html).toContain("비공개 AI 프롬프트는 비교 결과에 표시하지 않아요");
    expect(html).toContain("size-11");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
  });

  it("allows restore when local already matches the target but the server baseline does not", () => {
    const target = project("과거 화", "과거 대사");
    const server = project("현재 화", "현재 대사");
    const alreadyTargetLocal = project("과거 화", "과거 대사");
    const review: StudioServerRevisionComparison = {
      targetRevision: 2,
      baseRevision: 4,
      localToTarget: diffStudioProjectRevisions(alreadyTargetLocal, target),
      serverToLocal: diffStudioProjectRevisions(server, alreadyTargetLocal),
      publicationImpact: { statusChange: null, changedRelations: [] },
      pageLabels: { "page-1": "첫 만남" },
    };
    const html = renderView({ comparison: review });
    const labelIndex = html.indexOf("이 버전 복원");
    const buttonStart = html.lastIndexOf("<button", labelIndex);
    const restoreButtonStartTag = html.slice(buttonStart, html.indexOf(">", buttonStart) + 1);

    expect(review.localToTarget.hasChanges).toBe(false);
    expect(review.serverToLocal.hasChanges).toBe(true);
    expect(restoreButtonStartTag).not.toMatch(/\sdisabled(?:=|>)/u);
  });

  it("separates unsaved-local risk, semantic totals, and navigable page details", () => {
    const html = renderView();
    expect(html).toContain("서버 r4 이후 로컬 변경");
    expect(html).toContain("브라우저 복구 지점으로 자동 보관");
    expect(html).toContain("의미 있는 변경");
    expect(html).toContain("첫 만남");
    expect(html).toContain("위치로 이동");
    expect(html).toContain("민감 데이터 비노출 비교");
    expect(html).not.toContain("절대 표시하면 안 되는 대사");
    expect(html).not.toContain("안녕!");
  });

  it("labels directional changes as what restore will do, not the reverse comparison", () => {
    const target = parseStudioProjectFile({
      version: 2,
      title: "과거 화",
      pagesList: [{
        id: "page-1",
        name: "첫 만남",
        elements: [{ id: "dialogue-1", type: "text", text: "복원", x: 10 }],
        bg: "#ffffff",
        bgGrad: null,
        canvasH: 1800,
      }],
    });
    const local = parseStudioProjectFile({
      version: 2,
      title: "현재 화",
      pagesList: [
        {
          id: "page-1",
          name: "첫 만남",
          elements: [{ id: "dialogue-1", type: "text", text: "현재", x: 50 }],
          bg: "#ffffff",
          bgGrad: null,
          canvasH: 1800,
        },
        {
          id: "page-2",
          name: "삭제될 페이지",
          elements: [],
          bg: "#ffffff",
          bgGrad: null,
          canvasH: 1800,
        },
      ],
    });
    const restoreDirection: StudioServerRevisionComparison = {
      targetRevision: 2,
      baseRevision: 4,
      localToTarget: diffStudioProjectRevisions(local, target),
      serverToLocal: diffStudioProjectRevisions(local, local),
      publicationImpact: { statusChange: null, changedRelations: [] },
      pageLabels: { "page-1": "첫 만남", "page-2": "삭제될 페이지" },
    };
    const html = renderView({ comparison: restoreDirection });

    expect(html).toContain("페이지 삭제");
    expect(html).not.toContain("페이지 추가");
    expect(html).toContain("가로 위치 50 → 10");
    expect(html).not.toContain("가로 위치 10 → 50");
  });

  it("uses an explicit two-step restore confirmation with optimistic revision copy", () => {
    const html = renderView({ confirmingRestore: true });
    expect(html).toContain("정말 서버 버전 r2를 현재 버전으로 복원할까요");
    expect(html).toContain("기준 버전이 r4에서 바뀌면 서버가 복원을 거부");
    expect(html).toContain("r2 복원 확정");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("window.confirm");
  });

  it("warns explicitly when restore would unpublish or relink the work", () => {
    const risky = comparison();
    risky.publicationImpact = {
      statusChange: { before: "published", after: "draft" },
      changedRelations: ["seriesId", "episodeNo"],
    };
    const html = renderView({ comparison: risky });
    expect(html).toContain("공개 상태: 공개 → 초안");
    expect(html).toContain("현재 공개 중인 작품이 비공개 초안으로 전환");
    expect(html).toContain("시리즈 연결");
    expect(html).toContain("회차 번호");
  });

  it("keeps comparison errors recoverable", () => {
    const html = renderView({
      comparison: null,
      error: "서버 revision이 변경됐어요.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("서버 revision이 변경됐어요");
    expect(html).toContain("다시 비교");
  });
});
