// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_MAIN_MENU_PRESENTATION_ORDER } from "./studio-main-menu-presentation";
import {
  StudioMenubarContent,
  resolveStudioMenubarLaneOverflow,
  type StudioMenubarContentProps,
} from "./StudioMenubarContent";
import { createHandlers, createProps } from "./StudioMenubarContent.test-fixture";
import { StudioToolHintPreferencesProvider } from "./StudioToolHint";

import { useI18n } from "@/shared/lib/i18n";

const {
  preloadStudioAssetMenuPanel,
  preloadStudioExportMenuPanel,
  mainMenuTriggerClicks,
} = vi.hoisted(() => ({
  preloadStudioAssetMenuPanel: vi.fn(),
  preloadStudioExportMenuPanel: vi.fn(),
  mainMenuTriggerClicks: [] as string[],
}));

vi.mock("./studio-page-lazy-ui", () => ({
  StudioExportMenuPanel: ({ onCopyToClipboard }: { onCopyToClipboard: () => void }) => (
    <div data-studio-export-menu-panel="true">
      <button type="button" onClick={onCopyToClipboard}>내보내기 복사</button>
    </div>
  ),
  StudioMainMenu: ({ groups }: { groups: readonly { id: string; label: string; }[] }) => (
    <nav aria-label="데스크톱 앱 메뉴" data-studio-main-menu="true">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          data-studio-main-menu-trigger={group.id}
          onClick={() => mainMenuTriggerClicks.push(group.id)}
        >
          {group.label}
        </button>
      ))}
    </nav>
  ),
  preloadStudioAssetMenuPanel,
  preloadStudioExportMenuPanel,
}));

/** §15.3 ships 17 top-level groups (+ transform); the audit measured every one of them. */
const MENU_GROUP_IDS = [
  "file", "edit", "view", "canvas", "layer", "select", "transform", "brush", "filter",
  "vector", "text", "comic", "animation", "3d", "collaboration", "window", "ai", "help",
] as const;

/**
 * The ten workflow titles (IA audit 2026-09-05): related catalogue groups fold into
 * task-oriented menus, AI remains visible, and Help is pinned last.
 */
const PRESENTED_MENU_GROUP_IDS = [...STUDIO_MAIN_MENU_PRESENTATION_ORDER] as const;

function createMenuGroups(): StudioMenubarContentProps["studioMainMenuGroups"] {
  return MENU_GROUP_IDS.map((id) => ({ id, label: id.toUpperCase(), items: [] }));
}

/**
 * jsdom has no layout, so the lane geometry the overflow measurement reads is stubbed:
 * a 600px-wide lane whose trigger row runs to 1800px. Everything past 600px is exactly
 * what a real browser clips out of the scroll viewport.
 */
function stubMenubarGeometry(
  container: HTMLElement,
  { laneWidth = 600, triggerPitch = 100, triggerWidth = 90 } = {},
): { lane: HTMLElement; triggers: HTMLElement[]; } {
  const lane = container.querySelector<HTMLElement>('[data-studio-menubar-primary="true"]');
  if (!lane) throw new Error("menubar lane missing");
  const triggers = [
    ...lane.querySelectorAll<HTMLElement>("[data-studio-main-menu-trigger]"),
  ];
  const contentWidth = triggers.length * triggerPitch;
  Object.defineProperty(lane, "clientWidth", { value: laneWidth, configurable: true });
  Object.defineProperty(lane, "scrollWidth", { value: contentWidth, configurable: true });
  Object.defineProperty(lane, "scrollLeft", { value: 0, configurable: true, writable: true });
  lane.getBoundingClientRect = () =>
    ({ left: 0, right: laneWidth, width: laneWidth, top: 0, bottom: 44, height: 44 }) as DOMRect;
  triggers.forEach((trigger, index) => {
    const left = index * triggerPitch;
    trigger.getBoundingClientRect = () =>
      ({
        left,
        right: left + triggerWidth,
        width: triggerWidth,
        top: 0,
        bottom: 32,
        height: 32,
      }) as DOMRect;
    trigger.scrollIntoView = vi.fn();
  });
  return { lane, triggers };
}

vi.mock("./StudioWorkspaceMenuGate", () => ({
  StudioWorkspaceMenuGate: () => <button type="button">작업공간</button>,
}));


// 저자 언어를 못박는다(형제 스튜디오 스위트와 같은 관용구). jsdom 의 navigator.language 는
// en-US 라 고정하지 않으면 이 파일의 한글 접근명이 전부 영어 팩으로 해석된다.
beforeEach(() => {
  useI18n.setState({ lang: "ko" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  mainMenuTriggerClicks.length = 0;
});

describe("resolveStudioMenubarLaneOverflow", () => {
  const lane = { left: 0, right: 600, scrollLeft: 0, scrollWidth: 1_200, clientWidth: 600 };

  it("reports the groups clipped by either edge of the scroll viewport", () => {
    expect(
      resolveStudioMenubarLaneOverflow(lane, [
        { id: "file", left: -40, right: 20 },
        { id: "edit", left: 30, right: 100 },
        { id: "ai", left: 560, right: 640 },
        { id: "help", left: 700, right: 780 },
      ])
    ).toEqual({ scrollable: true, hiddenGroupIds: ["file", "ai", "help"] });
  });

  it("ignores triggers the layout has not rendered (mobile hides the whole nav)", () => {
    expect(
      resolveStudioMenubarLaneOverflow(lane, [
        { id: "file", left: 0, right: 0 },
        { id: "help", left: 0, right: 0 },
      ]).hiddenGroupIds
    ).toEqual([]);
  });

  it("treats sub-pixel rounding as fitting so the cue cannot flicker", () => {
    expect(
      resolveStudioMenubarLaneOverflow(lane, [{ id: "help", left: 0.4, right: 600.4 }])
        .hiddenGroupIds
    ).toEqual([]);
  });

  it("drops the continuation cue once the lane is scrolled to its end", () => {
    expect(
      resolveStudioMenubarLaneOverflow({ ...lane, scrollLeft: 600 }, []).scrollable
    ).toBe(false);
    expect(
      resolveStudioMenubarLaneOverflow({ ...lane, scrollWidth: 600 }, []).scrollable
    ).toBe(false);
  });

  it("reports nothing while the lane is unmeasured", () => {
    expect(
      resolveStudioMenubarLaneOverflow(
        { left: 0, right: 0, scrollLeft: 0, scrollWidth: 0, clientWidth: 0 },
        [{ id: "file", left: 0, right: 60 }]
      )
    ).toEqual({ scrollable: false, hiddenGroupIds: ["file"] });
  });
});

describe("StudioMenubarContent menu presentation", () => {
  it("presents the ten-title workflow menubar with AI visible and Help last", () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );

    expect(
      [
        ...container.querySelectorAll<HTMLElement>("[data-studio-main-menu-trigger]"),
      ].map((trigger) => trigger.dataset.studioMainMenuTrigger)
    ).toEqual(PRESENTED_MENU_GROUP_IDS);
  });

  it("keeps the lane observer subscribed when unrelated props rerender with the same menu catalogue", () => {
    let resizeObserverCount = 0;
    class StableResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        resizeObserverCount += 1;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StableResizeObserver);

    try {
      const studioMainMenuGroups = createMenuGroups();
      const props = createProps({ studioMainMenuGroups });
      const { rerender } = render(<StudioMenubarContent {...props} />);
      expect(resizeObserverCount).toBe(1);

      rerender(
        <StudioMenubarContent
          {...props}
          title="같은 메뉴 카탈로그의 새 문서 제목"
        />
      );
      expect(resizeObserverCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
describe("StudioMenubarContent", () => {
  it("waits for watermark readiness before toggling export controls", async () => {
    const stableHandlers = createHandlers();
    const setExportMenuOpen = vi.fn();
    const setProjectActionsOpen = vi.fn();
    let resolveWatermark!: (value: Awaited<ReturnType<
      typeof stableHandlers.ensureWatermarkLoaded
    >>) => void;
    const watermarkReady = new Promise<Awaited<ReturnType<
      typeof stableHandlers.ensureWatermarkLoaded
    >>>((resolve) => {
      resolveWatermark = resolve;
    });
    vi.mocked(stableHandlers.ensureWatermarkLoaded).mockReturnValue(watermarkReady);
    render(
      <StudioMenubarContent
        {...createProps({
          exportMenuOpen: true,
          setExportMenuOpen,
          setProjectActionsOpen,
          stableHandlers,
        })}
      />
    );

    const trigger = screen.getByRole("button", { name: "내보내기 옵션" });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    fireEvent.click(trigger);

    expect(preloadStudioExportMenuPanel).toHaveBeenCalledTimes(3);
    expect(stableHandlers.ensureWatermarkLoaded).toHaveBeenCalledOnce();
    expect(setProjectActionsOpen).not.toHaveBeenCalled();
    expect(setExportMenuOpen).not.toHaveBeenCalled();

    resolveWatermark(createProps().watermark);
    await waitFor(() => expect(setProjectActionsOpen).toHaveBeenCalledWith(false));
    expect(setExportMenuOpen).toHaveBeenCalledWith(expect.any(Function));
    expect(vi.mocked(setExportMenuOpen).mock.calls.at(-1)?.[0]).toBeTypeOf("function");
    expect((vi.mocked(setExportMenuOpen).mock.calls.at(-1)?.[0] as (open: boolean) => boolean)(true)).toBe(false);

    const portal = document.body.querySelector('[data-studio-export-menu-panel="true"]');
    expect(portal).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "내보내기 복사" }));
    expect(stableHandlers.handleCopyToClipboard).toHaveBeenCalledOnce();
  });

  it("keeps project actions portalled and closes after delegated one-shot commands", () => {
    vi.useFakeTimers();
    const stableHandlers = createHandlers();
    const setProjectActionsOpen = vi.fn();
    const projectActionsRef = { current: null };
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          projectActionsRef,
          setProjectActionsOpen,
          stableHandlers,
        })}
      />
    );

    expect(document.body.querySelector('[data-studio-project-actions-menu="true"]')).not.toBeNull();
    expect(projectActionsRef.current).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "백업 (.json)" }));
    expect(stableHandlers.handleExportProject).toHaveBeenCalledOnce();
    expect(setProjectActionsOpen).not.toHaveBeenCalledWith(false);

    vi.runAllTimers();
    expect(setProjectActionsOpen).toHaveBeenCalledWith(false);
  });

  it("opens the reusable scene snapshot library from project actions", () => {
    const setSceneSnapshotOpen = vi.fn();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          setSceneSnapshotOpen,
        })}
      />
    );

    const trigger = screen.getByRole("button", { name: "장면 스냅샷" });
    expect(trigger.className).toContain("min-h-11");
    fireEvent.click(trigger);
    expect(setSceneSnapshotOpen).toHaveBeenCalledWith(true);
  });

  it("opens the local animatic timeline from project actions", () => {
    const setAnimaticTimelineOpen = vi.fn();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          setAnimaticTimelineOpen,
        })}
      />,
    );

    const trigger = screen.getByRole("button", { name: "애니매틱" });
    expect(trigger.className).toContain("min-h-11");
    fireEvent.click(trigger);
    expect(setAnimaticTimelineOpen).toHaveBeenCalledWith(true);
  });

  it("opens the production bible from project actions without crowding the main toolbar", () => {
    const setProductionBibleOpen = vi.fn();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          setProductionBibleOpen,
        })}
      />
    );

    const trigger = screen.getByRole("button", { name: "제작 바이블" });
    expect(trigger.className).toContain("min-h-11");
    fireEvent.click(trigger);
    expect(setProductionBibleOpen).toHaveBeenCalledWith(true);
  });

  it("opens Hybrid DCC workspace from project actions", () => {
    const setHybridDccOpen = vi.fn();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          setHybridDccOpen,
        })}
      />
    );

    const trigger = screen.getByRole("button", { name: /Hybrid DCC/i });
    expect(trigger.getAttribute("data-studio-hybrid-dcc-open")).toBe("true");
    fireEvent.click(trigger);
    expect(setHybridDccOpen).toHaveBeenCalledWith(true);
  });

  /**
   * 회귀 계약 — 아래 7종은 툴벨트에만 트리거가 있었고, 벨트 호스트는 데스크톱 `lg:hidden` +
   * 모바일 몰입 `max-lg:hidden`이 겹쳐 1600 / 900 / 430 전 구간에서 display:none 이었다.
   * (docs/perf/heavy-feature-findings.md §4-1) 다시 벨트 단독 소유로 돌아가면 여기서 깨진다.
   */
  it("restores every belt-only review surface as a clickable project action", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMenubarContent
        {...createProps({ projectActionsOpen: true, stableHandlers })}
      />
    );

    const expectations = [
      ["anim-timeline", "다중 레이어 타임라인", stableHandlers.toggleAnimationTimeline],
      ["timelapse", "타임랩스 녹화", stableHandlers.openTimelapse],
      ["storyboard-grid", "스토리보드 그리드 보기", stableHandlers.openStoryboardGrid],
      ["scroll-preview", "세로 스크롤 미리보기", stableHandlers.openScrollPreview],
      ["continuity", "마감·품질 검사", stableHandlers.openContinuityCheck],
      ["comments", "문서 댓글", stableHandlers.toggleDocumentComments],
      ["page-review", "페이지 검토와 편집 잠금", stableHandlers.openPageReview],
    ] as const;

    for (const [actionId, accessibleName, handler] of expectations) {
      const trigger = screen.getByRole<HTMLButtonElement>("button", { name: accessibleName });
      expect(trigger.getAttribute("data-studio-project-action")).toBe(actionId);
      // 벨트와 달리 이 호스트에는 뷰포트 게이트가 없다 — 실제로 눌린다.
      expect(trigger.disabled).toBe(false);
      expect(trigger.closest("[hidden]")).toBeNull();
      fireEvent.click(trigger);
      expect(handler).toHaveBeenCalledOnce();
    }
  });

  it("keeps history-scrubbing surfaces disabled during master edit and shows the unresolved comment count", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          masterEditMode: true,
          openStudioCommentCount: 3,
          pageEditLocked: true,
          stableHandlers,
        })}
      />
    );

    const disabledState = (name: string) =>
      screen.getByRole<HTMLButtonElement>("button", { name }).disabled;

    expect(disabledState("다중 레이어 타임라인")).toBe(true);
    expect(disabledState("타임랩스 녹화")).toBe(true);
    // 히스토리와 무관한 검수 표면은 마스터 편집 중에도 열려 있어야 한다.
    expect(disabledState("스토리보드 그리드 보기")).toBe(false);
    expect(disabledState("문서 댓글, 열림 3개")).toBe(false);
    expect(disabledState("페이지 검토, 현재 편집 잠금")).toBe(false);
  });

  it("locks the comment entry point when the shared document forbids even viewing", () => {
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          collaborationDocumentLocked: true,
          collaborationLockMessage: () => "문서가 잠겨 있어요",
          sharedDocument: {
            capabilities: { view: false },
          } as unknown as StudioMenubarContentProps["sharedDocument"],
        })}
      />
    );

    const trigger = screen.getByRole<HTMLButtonElement>("button", { name: "문서 댓글" });
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("title")).toBe("문서가 잠겨 있어요");
  });

  it("opens the placed-asset rights ledger from project actions", () => {
    const setAssetRightsAuditOpen = vi.fn();
    render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          setAssetRightsAuditOpen,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "에셋 권리 감사" }));
    expect(setAssetRightsAuditOpen).toHaveBeenCalledWith(true);
  });

  it("ref-clicks root import inputs and turns the busy control into an explicit cancel action", () => {
    // File inputs live on StudioPage root (data-studio-document-import-inputs), not in menubar.
    const stableHandlers = createHandlers();
    const interchangeImportInputRef = {
      current: { click: vi.fn() } as unknown as HTMLInputElement,
    };
    const view = render(
      <StudioMenubarContent
        {...createProps({
          projectActionsOpen: true,
          interchangeImportInputRef,
          stableHandlers,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "ORA · CBZ · WILL" }));
    expect(interchangeImportInputRef.current.click).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("OpenRaster, CBZ 또는 WILL v1 가져오기")).toBeNull();

    view.rerender(
      <StudioMenubarContent
        {...createProps({
          interchangeImportBusy: true,
          interchangeImportInputRef,
          projectActionsOpen: true,
          stableHandlers,
        })}
      />
    );
    expect(screen.getByRole("button", { name: "PSD 가져오기" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "문서 검사 취소" }));
    expect(stableHandlers.cancelInterchangeImport).toHaveBeenCalledOnce();

    view.rerender(
      <StudioMenubarContent
        {...createProps({
          psdImportBusy: true,
          interchangeImportInputRef,
          projectActionsOpen: true,
          stableHandlers,
        })}
      />
    );
    expect(screen.getByRole("button", { name: "ORA · CBZ · WILL" }))
      .toHaveProperty("disabled", true);
  });

  it("delegates mobile immersive and save actions without taking controller state", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMenubarContent
        {...createProps({ isMobile: true, stableHandlers })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "전체 화면 드로잉" }));
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "게시하기" }));

    expect(stableHandlers.changeMobileImmersiveMode).toHaveBeenCalledWith(true);
    expect(stableHandlers.handleSave).toHaveBeenNthCalledWith(1, "draft");
    expect(stableHandlers.handleSave).toHaveBeenNthCalledWith(2, "published");
  });

  it("keeps every windowed action touchable while exposing the primary lane at 320px", () => {
    const stableHandlers = { ...createHandlers(), togglePageSequence: vi.fn() };
    render(<StudioMenubarContent {...createProps({ isMobile: true, stableHandlers })} />);

    // 모바일 폭(≤429px) 전체에서 아이콘 전용 44px 로 접힌다 — 359px 경계로는 360~430px 창모드에서
    // 액션 클러스터가 레인을 넘쳐 게시 버튼이 잘렸다(`verify:studio-mobile-top`).
    for (const name of ["전체 화면 드로잉", "초안 저장", "게시하기"] as const) {
      const action = screen.getByRole("button", { name });
      expect(action.className).toContain("max-[429px]:size-11");
      const label = [...action.querySelectorAll("span")].find((span) =>
        span.textContent?.includes(name === "전체 화면 드로잉" ? "전체화면" : name),
      );
      expect(label?.className).toContain("max-[429px]:sr-only");
    }

    expect(screen.getByRole("button", { name: "프로젝트 센터" }).className)
      .toContain("min-w-11");
    // 페이지·다운로드는 하단 도크의 드로잉 행이 소유한다 — 메뉴바 사본은 모바일에서 숨긴다.
    for (const name of [/페이지 목록/u, /현재 페이지$/u]) {
      const duplicate = screen.getByRole("button", { name, hidden: true });
      expect(duplicate.className).toContain("hidden");
    }
    expect(screen.getByRole("button", { name: "내보내기 옵션" }).className).toContain("min-w-11");
  });

  it("switches the mobile immersive coach from entering to exiting", () => {
    const view = render(
      <StudioToolHintPreferencesProvider mode="compact" touchHoldDelayMs={640} reduceMotion>
        <StudioMenubarContent {...createProps({ isMobile: true })} />
      </StudioToolHintPreferencesProvider>
    );

    fireEvent.focus(screen.getByRole("button", { name: "전체 화면 드로잉" }));
    expect(screen.getByRole("tooltip").textContent).toContain("캔버스 작업에 집중");

    view.rerender(
      <StudioToolHintPreferencesProvider mode="compact" touchHoldDelayMs={640} reduceMotion>
        <StudioMenubarContent
          {...createProps({ isMobile: true, mobileImmersive: true })}
        />
      </StudioToolHintPreferencesProvider>
    );
    fireEvent.focus(screen.getByRole("button", { name: "전체 화면 드로잉 종료" }));
    expect(screen.getByRole("tooltip").textContent).toContain("일반 작업 화면으로 돌아갑니다");
  });

  it("keeps the immersive pill compact: document context is sr-only, actions stay reachable", () => {
    render(
      <StudioMenubarContent
        {...createProps({ isMobile: true, mobileImmersive: true })}
      />
    );

    // 몰입 필은 콘텐츠 폭 기반이라 제목 스팬이 flex-1 로 눌리며 마지막 버튼을 잘라선 안 된다.
    // 문서 맥락은 보조기술 전용으로만 남긴다.
    const context = screen.getByText("테스트 원고 · 첫 장면");
    expect(context.className).toContain("sr-only");
    expect(context.className).not.toContain("flex-1");
    const exit = screen.getByRole("button", { name: "전체 화면 드로잉 종료" });
    const draft = screen.getByRole("button", { name: "초안 저장" });
    const publish = screen.getByRole("button", { name: "게시하기" });
    expect(exit).toBeTruthy();
    expect(draft).toBeTruthy();
    expect(publish).toBeTruthy();
    // Sticky canvas ring was painting over the draft button in the compact pill.
    expect(exit.className).not.toContain("sticky");
    expect(exit.className).not.toContain("shadow-[0_0_0_4px");
    const actions = exit.closest("[data-studio-menubar-actions=\"true\"]");
    expect(actions?.className).toContain("gap-1");
    expect(actions?.className).not.toContain("gap-0.5");
  });

  /**
   * D9 회귀 계약 — 이 큐는 예전에 `xl:hidden` 이었다. 즉 "데스크톱이면 다 보인다"를
   * 가정했는데, §15.3 이 그룹을 17개(+transform)로 늘린 뒤로는 1920px 에서도 마지막
   * 그룹이 잘린다(브라우저 실측: 1280 6개, 1440 3개, 1600 5개, 1920 1개 도달 불가).
   * 폭 게이트가 다시 들어오면 여기서 깨진다.
   */
  it("never gates the overflow cue on a width breakpoint", () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );

    const cue = container.querySelector<HTMLElement>(
      '[data-studio-menubar-overflow-cue="true"]'
    );
    expect(cue).not.toBeNull();
    expect(cue?.className).not.toMatch(/\b(?:sm|md|lg|xl|2xl):hidden\b/);
    expect(cue?.className).not.toMatch(/\bmax-(?:sm|md|lg|xl|2xl):hidden\b/);
    // 미측정 상태의 기본값은 "넘치지 않음"이라 큐는 꺼져 있다.
    expect(cue?.getAttribute("data-overflowing")).toBe("false");
  });

  it("turns the cue on only while measured content remains to the right", async () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );
    const { lane } = stubMenubarGeometry(container);
    fireEvent.scroll(lane);

    const cue = container.querySelector<HTMLElement>(
      '[data-studio-menubar-overflow-cue="true"]'
    );
    await waitFor(() => {
      expect(cue?.getAttribute("data-overflowing")).toBe("true");
    });
    expect(cue?.className).toContain("opacity-100");

    // 끝까지 스크롤하면 더 볼 내용이 없으므로 페이드는 스스로 꺼진다.
    Object.defineProperty(lane, "scrollLeft", { value: 1_200, configurable: true });
    fireEvent.scroll(lane);
    await waitFor(() => {
      expect(cue?.getAttribute("data-overflowing")).toBe("false");
    });
  });

  it("exposes every clipped menu group through a keyboard-reachable overflow menu", async () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );
    const { triggers } = stubMenubarGeometry(container);
    // 18개 카탈로그 그룹이 12개 타이틀로 표시된다(삽입·도구 복합 메뉴).
    expect(triggers).toHaveLength(PRESENTED_MENU_GROUP_IDS.length);
    fireEvent.scroll(container.querySelector('[data-studio-menubar-primary="true"]')!);

    // 600px 레인 안에 온전히 들어오는 건 앞 6개뿐 — 나머지 6개가 잘린다.
    const clipped = PRESENTED_MENU_GROUP_IDS.slice(6);
    const overflowTrigger = await screen.findByRole("button", {
      name: `가려진 메뉴 ${clipped.length}개`,
    });
    expect(overflowTrigger.getAttribute("data-studio-menubar-overflow-menu")).toBe("true");
    expect(overflowTrigger.getAttribute("aria-haspopup")).toBe("menu");
    // 스크롤 레인 밖의 형제라야 자기 자신이 함께 잘리지 않는다.
    expect(overflowTrigger.closest('[data-studio-menubar-primary="true"]')).toBeNull();

    fireEvent.click(overflowTrigger);
    expect(overflowTrigger.getAttribute("aria-expanded")).toBe("true");
    const panel = document.body.querySelector<HTMLElement>(
      '[data-studio-menubar-overflow-panel="true"]'
    );
    expect(panel?.getAttribute("role")).toBe("menu");
    for (const id of clipped) {
      expect(
        panel?.querySelector(`[data-studio-menubar-overflow-item="${id}"]`)
      ).not.toBeNull();
    }
    // 열자마자 첫 항목이 포커스를 받는다 — 마우스 없이도 목록을 탐색할 수 있다.
    expect(document.activeElement?.getAttribute("data-studio-menubar-overflow-item"))
      .toBe(clipped[0]);
  });

  it("reveals a clipped group by scrolling it in and pressing its real menubar trigger", async () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );
    const { triggers } = stubMenubarGeometry(container);
    fireEvent.scroll(container.querySelector('[data-studio-menubar-primary="true"]')!);

    fireEvent.click(await screen.findByRole("button", { name: /^가려진 메뉴 \d+개$/ }));
    const helpEntry = document.body.querySelector<HTMLButtonElement>(
      '[data-studio-menubar-overflow-item="help"]'
    );
    expect(helpEntry).not.toBeNull();
    fireEvent.click(helpEntry!);

    const helpTrigger = triggers.find(
      (trigger) => trigger.getAttribute("data-studio-main-menu-trigger") === "help"
    )!;
    expect(helpTrigger.getAttribute("data-studio-main-menu-trigger")).toBe("help");
    expect(helpTrigger.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "center",
    });
    // 드롭다운 구현을 복제하지 않고 원래 트리거를 누른다.
    expect(mainMenuTriggerClicks).toEqual(["help"]);
    expect(
      document.body.querySelector('[data-studio-menubar-overflow-panel="true"]')
    ).toBeNull();
  });

  it("finishes the reveal when focus lands on a half-clipped menubar control", () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );
    // 마지막 트리거가 레인의 오른쪽 경계를 걸치도록 레인 폭을 트리거 수에서 잡는다 — 제시되는
    // 메뉴 제목 수가 바뀌어도(IA 개편) 이 테스트가 고정 인덱스 때문에 깨지지 않게.
    const triggerCount = container.querySelectorAll("[data-studio-main-menu-trigger]").length;
    const { triggers } = stubMenubarGeometry(container, {
      laneWidth: (triggerCount - 1) * 50 + 45,
      triggerPitch: 50,
      triggerWidth: 90,
    });
    const straddling = triggers[triggerCount - 1]!; // left (n-1)*50, right +90 → 경계(+45)에 걸친다
    fireEvent.focusIn(straddling);
    expect(straddling.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });

    // 이미 온전히 보이는 컨트롤은 건드리지 않는다(불필요한 스크롤 점프 금지).
    const visible = triggers[2]!;
    fireEvent.focusIn(visible);
    expect(visible.scrollIntoView).not.toHaveBeenCalled();
  });

  it("hides the overflow control entirely when nothing is clipped", async () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );
    const { lane } = stubMenubarGeometry(container, { laneWidth: 4_000 });
    fireEvent.scroll(lane);

    await waitFor(() => {
      expect(
        container.querySelector('[data-studio-menubar-overflow-cue="true"]')
          ?.getAttribute("data-overflowing")
      ).toBe("false");
    });
    expect(container.querySelector('[data-studio-menubar-overflow-menu="true"]')).toBeNull();
  });

  /**
   * 헤더 좌측이 0px 로 짜부라지면서 "작업공간" 배지가 File 트리거 위에 겹쳐 `세션ile`
   * 로 보이던 결함(브라우저 실측 겹침 31~55px). `min-w-0` 은 이 레인이 자기 min-content
   * 아래로 내려가도 좋다는 선언이라 자식이 형제 위에 그려진다.
   */
  it("never lets the document-context lane collapse below its own content", () => {
    const { container } = render(<StudioMenubarContent {...createProps()} />);

    const lane = container.querySelector<HTMLElement>('[data-studio-menubar-primary="true"]');
    const contextLane = lane?.firstElementChild as HTMLElement | null;
    expect(contextLane?.querySelector("h1")).not.toBeNull();
    expect(contextLane?.className).not.toContain("min-w-0");
    // 제목만 줄어들며 압력을 흡수한다.
    expect(contextLane?.querySelector("h1")?.className).toContain("truncate");

    const insertShortcuts = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="삽입 바로가기"]'
    );
    expect(insertShortcuts?.className).not.toContain("min-w-0");
    expect(insertShortcuts?.className).toContain("shrink-0");
  });

  it("keeps the workspace trigger lane out of the history cluster while the menubar scrolls", () => {
    const { container } = render(<StudioMenubarContent {...createProps()} />);

    const workspace = screen.getByRole("button", { name: "작업공간" });
    const documentLane = workspace.parentElement;
    const primaryLane = container.querySelector('[data-studio-menubar-primary="true"]');

    expect(primaryLane?.className).toContain("overflow-x-auto");
    expect(documentLane?.className).toContain("min-w-max");
    expect(documentLane?.className).toContain("shrink-0");
    expect(documentLane?.className).not.toMatch(/(?:^|\s)shrink(?:\s|$)/u);
  });

  it("preloads the asset surface before delegating the desktop insert shortcut", () => {
    const setMenu = vi.fn();
    render(<StudioMenubarContent {...createProps({ setMenu })} />);

    fireEvent.click(screen.getByRole("button", { name: "템플릿·에셋" }));

    expect(preloadStudioAssetMenuPanel).toHaveBeenCalledOnce();
    expect(setMenu).toHaveBeenCalledWith("template");
  });

  it("exposes one authoritative desktop history cluster and delegates its commands", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMenubarContent
        {...createProps({
          historyPanelOpen: true,
          redoDisabled: false,
          stableHandlers,
          undoDisabled: false,
        })}
      />
    );

    // §15.3 Window ▸ Action Bar: the fixed cluster became a slotted command strip, but the
    // history authority stays a fixed control inside it.
    const group = screen.getByRole("group", { name: "빠른 명령 바" });
    expect(group.getAttribute("data-studio-menubar-command-bar")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "실행취소" }));
    fireEvent.click(screen.getByRole("button", { name: "다시실행" }));
    fireEvent.click(screen.getByRole("button", { name: "작업 내역" }));


    expect(stableHandlers.undo).toHaveBeenCalledOnce();
    expect(stableHandlers.redo).toHaveBeenCalledOnce();
    expect(stableHandlers.toggleHistoryPanel).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "작업 내역" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("renders the default command bar slots and routes them through the existing handlers", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMenubarContent
        {...createProps({ redoDisabled: false, stableHandlers, undoDisabled: false })}
      />
    );

    const bar = screen.getByRole("group", { name: "빠른 명령 바" });
    const slots = [...bar.querySelectorAll<HTMLButtonElement>("[data-studio-command-bar-slot]")];
    expect(slots.map((slot) => slot.getAttribute("data-studio-command-bar-command"))).toEqual([
      "undo",
      "redo",
      "save",
      "export-open",
      "zoom-fit",
    ]);

    // 슬롯 3의 저장 명령은 액션 레인의 "초안 저장"과 이름이 겹치므로 슬롯 번호로 갈린다.
    fireEvent.click(within(bar).getByRole("button", { name: "슬롯 3: 초안 저장" }));
    expect(stableHandlers.handleSave).toHaveBeenCalledWith("draft");

    // zoom-fit stays honestly disabled until the host provides the handler.
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "화면 폭 맞춤" }).disabled
    ).toBe(true);
  });

  /**
   * X-01 회귀 계약 — 커맨드 바가 메뉴 레인 안에 있으면 8 슬롯이 가로폭을 먹어 1600px 에서도
   * 상위 메뉴 3개가 오버플로로 밀린다(`verify:studio-icons` 2xl chevron 계약 실패).
   * 이 스트립은 오버플로 실측기가 재는 레인 밖, 자기 줄에 있어야 한다.
   */
  it("keeps the command strip on its own row, outside the measured menu lane", () => {
    const { container } = render(
      <StudioMenubarContent {...createProps({ studioMainMenuGroups: createMenuGroups() })} />
    );

    const bar = screen.getByRole("group", { name: "빠른 명령 바" });
    const lane = container.querySelector<HTMLElement>('[data-studio-menubar-primary="true"]');
    expect(lane).not.toBeNull();
    expect(lane?.contains(bar)).toBe(false);
    expect(bar.closest('[data-studio-menubar-primary="true"]')).toBeNull();
    // 실측기는 레인 안의 트리거만 본다 — 스트립 버튼이 그 안에 섞이면 안 된다.
    expect(lane?.querySelectorAll("[data-studio-command-bar-slot]")).toHaveLength(0);
    // 폭을 다투지 않으므로 `shrink-0`/`flex-1` 같은 가로 예산 토큰이 없어야 한다.
    expect(bar.className).not.toMatch(/(?:^|\s)(?:shrink-0|flex-1)(?:\s|$)/u);
    // 자기 줄임을 드러내는 구분선 — 메뉴 행과 시각적으로 갈라진다.
    expect(bar.className).toContain("border-t");
    // 두 행은 하나의 세로 스택이다.
    const rows = container.querySelector<HTMLElement>('[data-studio-menubar-rows="true"]');
    expect(rows?.className).toContain("flex-col");
    expect(rows?.contains(bar)).toBe(true);
    expect(rows?.contains(lane!)).toBe(true);
  });

  /**
   * 한 화면에 같은 접근명이 둘이면 스크린리더도 자동화도 갈라내지 못한다
   * (`verify:studio-menus` 의 strict mode 위반이 정확히 이것이었다).
   */
  it("never lets a slot share an accessible name with a fixed menubar control", () => {
    render(
      <StudioMenubarContent
        {...createProps({
          liveWorkspaceLayout: {
            commandBar: {
              version: 1,
              visible: true,
              // 중복 명령(undo 두 번)까지 포함해 유일성을 확인한다.
              slots: [
                "undo",
                "undo",
                "save",
                "export-open",
                "download",
                "assets",
                "bubbles",
                "project",
              ],
            },
          } as unknown as StudioMenubarContentProps["liveWorkspaceLayout"],
        })}
      />
    );

    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "")
      .filter((name) => name.length > 0);
    expect(new Set(names).size).toBe(names.length);

    // 스트립이 유일한 주인인 명령은 첫 슬롯에서 정식 이름을 지킨다
    // (`verify-studio-lifecycle` 은 button[aria-label="실행취소"] 로 되돌리기를 찾는다).
    expect(
      screen.getByRole("button", { name: "실행취소" })
        .getAttribute("data-studio-command-bar-slot")
    ).toBe("0");
    expect(screen.getByRole("button", { name: "슬롯 2: 실행취소" })).toBeTruthy();
    // 고정 컨트롤과 겹치는 명령은 전부 슬롯 번호로 한정된다.
    for (const name of [
      "슬롯 3: 초안 저장",
      "슬롯 4: 내보내기 옵션",
      "슬롯 5: 현재 페이지 다운로드",
      "슬롯 6: 템플릿·에셋",
      "슬롯 7: 말풍선",
      "슬롯 8: 프로젝트 센터",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // 고정 컨트롤 쪽은 정식 이름을 그대로 유지한다.
    expect(
      screen.getByRole("button", { name: "내보내기 옵션" })
        .hasAttribute("data-studio-command-bar-command")
    ).toBe(false);
  });

  it("takes slot names, the settings dialog, and its hint from the locale pack", async () => {
    useI18n.setState({ lang: "en" });
    render(<StudioMenubarContent {...createProps()} />);

    expect(screen.getByRole("group", { name: "Quick command bar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slot 4: Export options" })).toBeTruthy();

    const settings = screen.getByRole("button", { name: "Command bar settings" });
    fireEvent.click(settings);
    expect(
      screen.getByRole("dialog", { name: "Command bar settings" })
    ).toBeTruthy();
    expect(screen.getByLabelText("Command slot 6")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close command bar settings" })).toBeTruthy();
    expect(screen.getByText("Show command slots")).toBeTruthy();
    expect(screen.getByText("Reset to the default layout")).toBeTruthy();
  });

  it("delegates the zoom-fit slot once the host wires the optional handler", () => {
    const stableHandlers = { ...createHandlers(), zoomToFit: vi.fn() };
    render(<StudioMenubarContent {...createProps({ stableHandlers })} />);

    const zoomFit = screen.getByRole<HTMLButtonElement>("button", {
      name: "화면 폭 맞춤",
    });
    expect(zoomFit.disabled).toBe(false);
    fireEvent.click(zoomFit);
    expect(stableHandlers.zoomToFit).toHaveBeenCalledOnce();
  });

  it("persists slot customization through the workspace live layout without touching docks", () => {
    const stableHandlers = createHandlers();
    const liveWorkspaceLayout = {
      desktop: {
        leftPanelOpen: false,
        rightPanelOpen: true,
        leftPanelWidth: 200,
        rightPanelWidth: 320,
      },
    } as unknown as StudioMenubarContentProps["liveWorkspaceLayout"];
    render(
      <StudioMenubarContent
        {...createProps({ liveWorkspaceLayout, stableHandlers })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "명령 바 설정" }));
    const panel = document.body.querySelector('[data-studio-command-bar-settings-panel="true"]');
    expect(panel).not.toBeNull();

    fireEvent.change(screen.getByLabelText("명령 슬롯 6"), {
      target: { value: "download" },
    });

    expect(stableHandlers.persistStudioWorkspaceState).toHaveBeenCalledOnce();
    const persisted = vi.mocked(stableHandlers.persistStudioWorkspaceState).mock
      .calls[0]?.[0] as StudioMenubarContentProps["workspaceState"];
    expect(persisted.liveLayout.commandBar?.slots).toEqual([
      "undo",
      "redo",
      "save",
      "export-open",
      "zoom-fit",
      "download",
      null,
      null,
    ]);
    // Authored-form invariant: the strip only rides on the live layout — the authored dock
    // geometry it was handed goes back out unchanged.
    expect(persisted.liveLayout.desktop).toEqual({
      leftPanelOpen: false,
      rightPanelOpen: true,
      leftPanelWidth: 200,
      rightPanelWidth: 320,
    });
  });

  it("keeps history and the slot editor reachable while the slot strip is hidden", () => {
    const liveWorkspaceLayout = {
      commandBar: {
        version: 1,
        visible: false,
        slots: ["undo", "redo", "save", "export-open", "zoom-fit", null, null, null],
      },
    } as unknown as StudioMenubarContentProps["liveWorkspaceLayout"];
    render(<StudioMenubarContent {...createProps({ liveWorkspaceLayout })} />);

    const bar = screen.getByRole("group", { name: "빠른 명령 바" });
    expect(bar.querySelectorAll("[data-studio-command-bar-slot]")).toHaveLength(0);
    // The way back can never be customized away.
    expect(screen.getByRole("button", { name: "작업 내역" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "명령 바 설정" })).toBeTruthy();
  });

  it("routes meaningful top actions through the exclusive rich-tooltip channel", () => {
    render(
      <StudioMenubarContent
        {...createProps({
          redoDisabled: false,
          undoDisabled: false,
        })}
      />
    );

    for (const name of [
      "실행취소",
      "다시실행",
      "슬롯 3: 초안 저장",
      "슬롯 4: 내보내기 옵션",
      "화면 폭 맞춤",
      "작업 내역",
      "명령 바 설정",
      "템플릿·에셋",
      "말풍선",
      "다운로드 2× PNG · 현재 페이지",
      "내보내기 옵션",
      "프로젝트 센터",
      "초안 저장",
      "게시하기",
    ]) {
      for (const control of screen.getAllByRole("button", { name })) {
        expect(control.closest('[data-studio-tool-hint-target="true"]')).not.toBeNull();
        expect(control.getAttribute("title")).toBeNull();
      }
    }
  });
});
