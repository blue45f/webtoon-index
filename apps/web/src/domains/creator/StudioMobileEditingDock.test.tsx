// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import {
  STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP,
  STUDIO_MOBILE_PAGES_SHEET_ID,
} from "./studio-mobile-sheet-snap";
import {
  StudioBrushLibraryPanel,
  StudioBrushStudio,
  StudioShapePickerGrid,
  StudioUnifiedBrushPicker,
  loadStudioBrushStudio,
} from "./studio-page-lazy-ui";
import {
  StudioMobileEditingDock,
  type StudioMobileEditingDockHandlers,
  type StudioMobileEditingDockProps,
} from "./StudioMobileEditingDock";
import { StudioMobileSheetHandle } from "./StudioMobileSheetHandle";

import type { NormalizedStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import type { StudioBrushSnapshot } from "./brush/studio-brush-library";
import type { StudioProDrawPrefs } from "./studio-pro-draw-prefs";
import type { StudioWorkspaceState } from "./studio-workspaces";

import { useI18n } from "@/shared/lib/i18n";

interface MockDockButtonProps {
  readonly "aria-controls"?: string;
  readonly "aria-expanded"?: boolean;
  readonly "aria-haspopup"?: "dialog";
  readonly "aria-label"?: string;
  readonly "aria-pressed"?: boolean;
  readonly "data-studio-mobile-comment-trigger"?: string;
  readonly "data-studio-mobile-tool"?: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly hintDescription?: string;
  readonly hintPreview?: string;
  readonly hintPreviewVariant?: string;
  readonly hintUnavailableReason?: string;
  readonly label: string;
  readonly onClick?: () => void;
  readonly onFocus?: (event: import("react").FocusEvent<HTMLButtonElement>) => void;
  readonly onPointerDown?: import("react").PointerEventHandler<HTMLButtonElement>;
  readonly onPointerEnter?: import("react").PointerEventHandler<HTMLButtonElement>;
  readonly title?: string;
}

const mobileInspectorPreload = vi.hoisted(() => ({
  drawingSurface: vi.fn(),
}));

vi.mock("./studio-inspector-aside-loader", () => ({
  preloadStudioInspectorDrawingSurface: mobileInspectorPreload.drawingSurface,
}));

vi.mock("./studio-chrome-ui", () => ({
  StudioContextActionButton: ({ label, disabled, onClick, title }: MockDockButtonProps) => (
    <button type="button" disabled={disabled} onClick={onClick} title={title}>{label}</button>
  ),
  StudioDockButton: ({
    "aria-controls": ariaControls,
    "aria-expanded": ariaExpanded,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
    "data-studio-mobile-tool": mobileTool,
    label,
    disabled,
    hintDescription,
    hintPreview,
    hintPreviewVariant,
    hintUnavailableReason,
    onClick,
    onFocus,
    title,
  }: MockDockButtonProps) => (
    <button
      type="button"
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel ?? label}
      aria-pressed={ariaPressed}
      data-hint-description={hintDescription}
      data-hint-preview={hintPreview}
      data-hint-preview-variant={hintPreviewVariant}
      data-hint-unavailable-reason={hintUnavailableReason}
      data-studio-mobile-tool={mobileTool}
      disabled={disabled}
      onClick={onClick}
      onFocus={onFocus}
      title={hintDescription ? undefined : title}
    >
      {label}
    </button>
  ),
  StudioDockNavButton: ({
    "aria-controls": ariaControls,
    "aria-expanded": ariaExpanded,
    "aria-haspopup": ariaHasPopup,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
    "data-studio-mobile-comment-trigger": mobileCommentTrigger,
    className,
    label,
    disabled,
    onClick,
    onFocus,
    onPointerDown,
    onPointerEnter,
    title,
  }: MockDockButtonProps) => (
    <button
      type="button"
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      aria-label={ariaLabel ?? label}
      aria-pressed={ariaPressed}
      className={className}
      data-studio-mobile-comment-trigger={mobileCommentTrigger}
      disabled={disabled}
      onClick={onClick}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      title={title}
    >
      {label}
    </button>
  ),
}));

vi.mock("./studio-page-lazy-ui", () => ({
  StudioBrushLibraryPanel: () => null,
  StudioBrushStudio: () => null,
  StudioShapePickerGrid: () => null,
  StudioUnifiedBrushPicker: () => (
    <section data-studio-unified-brush-picker="mobile">
      <div data-studio-brush-tray="true">
        <div role="listbox" aria-label="기본 프리셋 빠른 선택" />
        <span data-studio-open-brush-library="true" />
      </div>
    </section>
  ),
  loadStudioBrushStudio: vi.fn(async () => undefined),
}));

vi.mock("./StudioLineCorrectionControls", () => ({
  StudioLineCorrectionControls: () => null,
}));

vi.mock("./StudioSavedBrushShelf", () => ({
  StudioSavedBrushShelf: () => null,
}));

function createHandlers(): StudioMobileEditingDockHandlers {
  return {
    activateCanvasTool: vi.fn(),
    applyBuiltInBrushPreset: vi.fn(),
    applyBrushDefaultRestoreTransaction: vi.fn(),
    applyDynamicsPreset: vi.fn(),
    applySavedBrush: vi.fn(),
    dismissBrushManager: vi.fn(),
    dismissMobileHint: vi.fn(),
    duplicateSelected: vi.fn(),
    editSelectionText: vi.fn(),
    fitCanvasToWidth: vi.fn(),
    openBrushManager: vi.fn(),
    openInspectorRoute: vi.fn(),
    openStudioFilter: vi.fn(),
    queueBrushDelete: vi.fn(),
    redo: vi.fn(),
    removeSelected: vi.fn(),
    reorder: vi.fn(),
    restoreBrushDefaults: vi.fn(),
    toggleAdvancedFill: vi.fn(),
    toggleSelectionLock: vi.fn(),
    toggleStudioCommentPinPlacement: vi.fn(),
    undo: vi.fn(),
  };
}

function createProps(
  overrides: Partial<StudioMobileEditingDockProps> = {},
): StudioMobileEditingDockProps {
  return {
    activeCatalogBrushId: "gpen",
    activeCatalogBrushName: "G펜",
    activeSavedBrushId: null,
    activeSurfaceReviewLocked: false,
    advancedFillActive: false,
    advancedFillUnsupportedReason: null,
    brush: "gpen",
    brushCatalogHandlers: {
      close: vi.fn(),
      selectBrushId: vi.fn(),
      toggle: vi.fn(),
      toggleFavorite: vi.fn(),
    },
    brushCatalogItems: [],
    brushCatalogOpen: false,
    brushDefaultRestore: {
      sourceName: "G펜",
      modifiedCount: 0,
      loading: false,
      available: true,
      undoAvailable: false,
    },
    brushDynamics: {} as NormalizedStudioBrushDynamicsSettings,
    brushManagerSheetRef: { current: null },
    brushOpacity: 1,
    collaborationDocumentLocked: false,
    commentPinArmed: false,
    color: "#111111",
    colorBlindPreview: "none",
    colorVisionSheetRef: { current: null },
    currentBrushSnapshot: {} as StudioBrushSnapshot,
    drawMode: "pen",
    drawShape: "rect",
    drawSheetRef: { current: null },
    eraseToIntersection: false,
    filterMutationLocked: false,
    filterPreparationBusy: false,
    filterTargetLabel: "현재 페이지 합성본",
    filterUnavailableReason: null,
    hi: 0,
    history: [[], []],
    isMobile: false,
    livingInk: {
      supported: false,
      physicalModeEnabled: false,
      onPhysicalModeEnabledChange: vi.fn(),
      state: "ready",
      mode: "ink",
      onModeChange: vi.fn(),
      scope: "all",
      onScopeChange: vi.fn(),
      selectionAvailable: false,
      busy: false,
      fixAvailable: false,
      onFix: vi.fn(),
      onClear: vi.fn(),
      material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
      materialLocked: false,
      onMaterialChange: vi.fn(),
    },
    marqueeIds: [],
    mobileBrushDockButtonRef: { current: null },
    mobileKeyboardInset: 0,
    mobileQuickActionsButton: <button type="button">빠른 작업</button>,
    mobileSheet: null,
    postCorrection: 0,
    preserveCorners: true,
    pressureCurve: 1,
    proDrawPrefs: {} as StudioProDrawPrefs,
    quickActionsOpen: false,
    savedBrushes: [],
    selected: null,
    selectionLocked: false,
    selectionTextEditLabel: null,
    setBrushDynamics: vi.fn(),
    setBrushOpacity: vi.fn(),
    setColor: vi.fn(),
    setColorBlindPreview: vi.fn(),
    setDrawMode: vi.fn(),
    setDrawShape: vi.fn(),
    setEraseToIntersection: vi.fn(),
    setMarqueeIds: vi.fn(),
    setMenu: vi.fn(),
    setMobileSheet: vi.fn(),
    setPostCorrection: vi.fn(),
    setPreserveCorners: vi.fn(),
    setPressureCurve: vi.fn(),
    setQuickStartOpen: vi.fn(),
    setSavedBrushes: vi.fn(),
    setSelectedId: vi.fn(),
    setShapeFill: vi.fn(),
    setStabilizer: vi.fn(),
    setStabilizerMode: vi.fn(),
    setStampTuning: vi.fn(),
    setStrokeWidth: vi.fn(),
    setTiltEnabled: vi.fn(),
    setTipAngle: vi.fn(),
    setTipRoundness: vi.fn(),
    setTool: vi.fn(),
    setUseVelocityPressure: vi.fn(),
    setVelocitySensitivity: vi.fn(),
    setZoom: vi.fn(),
    shapeFill: false,
    showMobileHint: false,
    stabilizer: 0,
    stabilizerMode: "standard",
    stableHandlers: createHandlers(),
    stampTuning: null,
    strokeWidth: 4,
    tiltEnabled: false,
    tipAngle: 0,
    tipRoundness: 1,
    tool: "draw",
    ui: {
      StudioBrushLibraryPanel,
      StudioBrushStudio,
      StudioMobileSheetHandle,
      StudioShapePickerGrid,
      StudioUnifiedBrushPicker,
      loadStudioBrushStudio,
    },
    useVelocityPressure: false,
    velocitySensitivity: 1,
    workspaceState: { mobileControlSide: "right" } as StudioWorkspaceState,
    zoom: 1,
    ...overrides,
  };
}

// The dock's labels come from the locale packs now, so the locale has to be explicit: jsdom
// reports `en-US`, and these assertions are written against the Korean source copy.
beforeEach(() => {
  useI18n.getState().setLang("ko");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioMobileEditingDock", () => {
  it("does not mount mobile dock chrome on a desktop surface", () => {
    const view = render(<StudioMobileEditingDock {...createProps()} />);

    expect(view.container.innerHTML).toBe("");
    expect(screen.queryByRole("navigation", { name: "스튜디오 모바일 도구막대" })).toBeNull();
  });

  it("dismisses the quick-start surface whenever a mobile editing sheet is active", () => {
    const setQuickStartOpen = vi.fn();

    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          setQuickStartOpen,
        })}
      />,
    );

    expect(setQuickStartOpen).toHaveBeenCalledOnce();
    expect(setQuickStartOpen).toHaveBeenCalledWith(false);
  });

  it("preserves dock rows, safe-area placement, and history disabled semantics", () => {
    const props = createProps({ isMobile: true, mobileKeyboardInset: 18 });
    const view = render(<StudioMobileEditingDock {...props} />);
    let dock = screen.getByRole("navigation", { name: "스튜디오 모바일 도구막대" });

    expect(dock.getAttribute("data-studio-mobile-editing-dock")).toBe("true");
    expect(dock.className).toContain("env(safe-area-inset-bottom)");
    expect(dock.style.bottom).toBe("18px");
    expect(dock.getAttribute("data-studio-mobile-dock-expanded")).toBe("false");
    const drawingToolbar = within(dock).getByRole("toolbar", { name: "드로잉 도구" });
    expect(drawingToolbar).toBeTruthy();
    const workspaceToggle = within(dock).getByRole<HTMLButtonElement>("button", {
      name: "작업 메뉴",
    });
    expect(workspaceToggle.closest('[data-studio-mobile-dock-scroll="primary"]')).toBeNull();
    expect(drawingToolbar.parentElement?.className).toContain("overflow-hidden");
    expect(drawingToolbar.parentElement?.nextElementSibling).toBe(workspaceToggle);
    expect(workspaceToggle.getAttribute("aria-controls")).toBe("studio-mobile-workspace-tools");
    expect(workspaceToggle.getAttribute("aria-expanded")).toBe("false");
    expect(workspaceToggle.textContent).toBe("작업 메뉴");
    expect(workspaceToggle.getAttribute("aria-label")).toContain(
      workspaceToggle.textContent,
    );
    expect(workspaceToggle.className).toContain("min-h-11");
    expect(workspaceToggle.className).toContain("min-w-11");
    expect(workspaceToggle.className).toContain("flex-none");
    expect(workspaceToggle.className).not.toContain("absolute");
    expect(dock.querySelector("#studio-mobile-workspace-tools")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(workspaceToggle);
    expect(dock.getAttribute("data-studio-mobile-dock-expanded")).toBe("true");
    const workspaceToolbar = within(dock).getByRole("toolbar", { name: "작업 공간" });
    expect(workspaceToolbar).toBeTruthy();
    expect(
      within(workspaceToolbar).getByRole("button", {
        name: "작업 패널",
      }).textContent,
    ).toBe("작업 패널");
    const workspacePanelButton = within(workspaceToolbar).getByRole("button", {
      name: "작업 패널",
    });
    expect(workspacePanelButton.getAttribute("aria-label")).toContain(
      workspacePanelButton.textContent,
    );
    const expandedWorkspaceToggle = within(dock).getByRole("button", {
      name: "접기 · 작업 메뉴",
    });
    expect(expandedWorkspaceToggle.getAttribute("aria-expanded")).toBe("true");
    expect(expandedWorkspaceToggle.getAttribute("aria-label")).toContain(
      expandedWorkspaceToggle.textContent,
    );
    expect(expandedWorkspaceToggle.getAttribute("title")).toBe(
      expandedWorkspaceToggle.getAttribute("aria-label"),
    );
    fireEvent.click(within(dock).getByRole("button", { name: "선택" }));
    expect(dock.getAttribute("data-studio-mobile-dock-expanded")).toBe("false");
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "실행취소" }).disabled).toBe(true);
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "다시실행" }).disabled).toBe(false);
    expect(within(dock).getByRole("button", { name: "실행취소" }).getAttribute("data-hint-description")).toContain("한 단계 되돌립니다");
    expect(within(dock).getByRole("button", { name: "다시실행" }).getAttribute("data-hint-description")).toContain("다시 적용");
    expect(dock.querySelector("button button")).toBeNull();

    view.rerender(<StudioMobileEditingDock {...createProps({ isMobile: true, hi: 1 })} />);
    dock = screen.getByRole("navigation", { name: "스튜디오 모바일 도구막대" });
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "실행취소" }).disabled).toBe(false);
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "다시실행" }).disabled).toBe(true);
    expect(within(dock).getByRole("button", { name: "실행취소" }).getAttribute("data-hint-description")).toContain("한 단계 되돌립니다");
    expect(within(dock).getByRole("button", { name: "다시실행" }).getAttribute("data-hint-description")).toContain("다시 적용");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, collaborationDocumentLocked: true })}
      />,
    );
    dock = screen.getByRole("navigation", { name: "스튜디오 모바일 도구막대" });
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "실행취소" }).disabled).toBe(true);
    expect(within(dock).getByRole<HTMLButtonElement>("button", { name: "다시실행" }).disabled).toBe(true);
    expect(within(dock).getByRole("button", { name: "실행취소" }).getAttribute("data-hint-unavailable-reason")).toContain("문서 잠금");
    expect(within(dock).getByRole("button", { name: "다시실행" }).getAttribute("data-hint-unavailable-reason")).toContain("문서 잠금");
  });

  it("opens tool properties first from the Panel launcher while drawing without a selection", () => {
    const stableHandlers = createHandlers();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: null,
          tool: "draw",
          stableHandlers,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "작업 메뉴" }),
    );
    const workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const panelLauncher = within(workspace).getByRole("button", {
      name: "작업 패널",
    });
    expect(panelLauncher.textContent).toBe("작업 패널");
    expect(
      panelLauncher.getAttribute("aria-haspopup"),
      panelLauncher.outerHTML,
    ).toBe("dialog");
    expect(panelLauncher.getAttribute("aria-expanded")).toBe("false");
    expect(panelLauncher.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(panelLauncher);
    expect(stableHandlers.openInspectorRoute).toHaveBeenLastCalledWith(
      { primary: "properties" },
      "props",
    );

    vi.mocked(stableHandlers.openInspectorRoute).mockClear();
    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: null,
          tool: "select",
          stableHandlers,
        })}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "작업 공간" })).getByRole(
        "button",
        { name: "작업 패널" },
      ),
    );
    expect(stableHandlers.openInspectorRoute).toHaveBeenLastCalledWith(
      { primary: "layers" },
      "props",
    );
  });

  it("distinguishes page management from the quick-start new-work action", () => {
    const setMobileSheet = vi.fn();
    const setQuickStartOpen = vi.fn();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          setMobileSheet,
          setQuickStartOpen,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    let workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const pages = within(workspace).getByRole("button", { name: "페이지 목록 열기" });
    expect(pages.textContent).toBe("페이지");
    expect(pages.getAttribute("aria-controls")).toBe(STUDIO_MOBILE_PAGES_SHEET_ID);
    expect(pages.getAttribute("aria-haspopup")).toBe("dialog");
    expect(pages.getAttribute("aria-expanded")).toBe("false");
    expect(pages.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(pages);
    expect(setMobileSheet).toHaveBeenCalledWith(expect.any(Function));

    const newWork = within(workspace).getByRole("button", {
      name: "빠른 시작 · 새 작업 열기",
    });
    expect(newWork.textContent).toBe("새 작업");
    expect(newWork.getAttribute("aria-haspopup")).toBe("dialog");
    expect(within(workspace).queryByRole("button", { name: "추가" })).toBeNull();
    fireEvent.click(newWork);
    expect(setMobileSheet).toHaveBeenLastCalledWith(null);
    expect(setQuickStartOpen).toHaveBeenCalledWith(true);

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "pages",
          setMobileSheet,
          setQuickStartOpen,
        })}
      />,
    );
    workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const closePages = within(workspace).getByRole("button", { name: "페이지 목록 닫기" });
    expect(closePages.getAttribute("aria-expanded")).toBe("true");
  });

  it("warms the inspector and drawing palettes from both mobile panel intent paths", () => {
    mobileInspectorPreload.drawingSurface.mockClear();
    render(<StudioMobileEditingDock {...createProps({ isMobile: true })} />);

    const workspaceToggle = screen.getByRole("button", {
      name: "작업 메뉴",
    });
    fireEvent.pointerEnter(workspaceToggle);
    fireEvent.pointerDown(workspaceToggle);
    fireEvent.focus(workspaceToggle);

    expect(mobileInspectorPreload.drawingSurface).toHaveBeenCalledTimes(3);

    fireEvent.click(workspaceToggle);
    const workButton = within(
      screen.getByRole("toolbar", { name: "작업 공간" }),
    ).getByRole("button", { name: "작업 패널" });
    fireEvent.pointerEnter(workButton);
    fireEvent.pointerDown(workButton);
    fireEvent.focus(workButton);

    expect(mobileInspectorPreload.drawingSurface).toHaveBeenCalledTimes(6);
  });

  it("signals horizontally hidden tools without overlaying the scroll lane", () => {
    render(<StudioMobileEditingDock {...createProps({ isMobile: true })} />);

    const drawingTools = screen.getByRole("toolbar", { name: "드로잉 도구" });
    const scroller = drawingTools.closest<HTMLDivElement>(
      '[data-studio-mobile-dock-scroll="primary"]',
    );
    const host = scroller?.closest<HTMLElement>(
      '[data-studio-mobile-scroll-host="primary"]',
    );
    expect(scroller).not.toBeNull();
    expect(host).not.toBeNull();
    expect(drawingTools.getAttribute("aria-describedby")).toBe(
      host?.querySelector("[data-studio-mobile-scroll-status]")?.id,
    );
    expect(host?.querySelectorAll("[data-studio-mobile-scroll-cue]")).toHaveLength(2);
    expect(
      host?.querySelector('[data-studio-mobile-scroll-cue="primary-after"]')?.className,
    ).toContain("pointer-events-none");

    Object.defineProperties(scroller!, {
      clientWidth: { configurable: true, value: 378 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 492 },
    });
    fireEvent.scroll(scroller!);
    expect(scroller?.getAttribute("data-studio-mobile-overflow")).toBe("after");
    expect(host?.style.getPropertyValue("--studio-mobile-scroll-after")).toBe("1");
    expect(host?.style.getPropertyValue("--studio-mobile-scroll-before")).toBe("0");
    expect(host?.querySelector("[data-studio-mobile-scroll-status]")?.textContent).toContain(
      "오른쪽에 도구가 더 있습니다",
    );

    scroller!.scrollLeft = 114;
    fireEvent.scroll(scroller!);
    expect(scroller?.getAttribute("data-studio-mobile-overflow")).toBe("before");
    expect(host?.style.getPropertyValue("--studio-mobile-scroll-after")).toBe("0");
    expect(host?.style.getPropertyValue("--studio-mobile-scroll-before")).toBe("1");
  });

  it("keeps the comment first and pins the quick menu beside it for a left-hand layout", () => {
    const stableHandlers = createHandlers();
    const setMobileSheet = vi.fn();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          collaborationDocumentLocked: true,
          setMobileSheet,
          stableHandlers,
          workspaceState: { mobileControlSide: "left" } as StudioWorkspaceState,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    const workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const comment = within(workspace).getByRole<HTMLButtonElement>("button", {
      name: "캔버스 위치 댓글",
    });
    const scrollLane = workspace.querySelector('[data-studio-mobile-dock-scroll="secondary"]');
    const panelLauncher = within(scrollLane as HTMLElement).getByRole("button", {
      name: "작업 패널",
    });
    const quickSlot = workspace.querySelector('[data-studio-mobile-quick-actions-slot="left"]');
    expect(workspace.getAttribute("data-studio-mobile-control-side")).toBe("left");
    expect(scrollLane?.className).toContain("overflow-x-auto");
    expect(workspace.firstElementChild).toBe(comment);
    expect(workspace.children.item(1)).toBe(quickSlot);
    expect(scrollLane?.firstElementChild).toBe(panelLauncher);
    expect(within(quickSlot as HTMLElement).getByRole("button", { name: "빠른 작업" })).not.toBeNull();
    expect(quickSlot?.className).toContain("size-11");
    expect(comment.className).toContain("min-h-11");
    expect(comment.className).toContain("min-w-11");
    expect(comment.getAttribute("data-studio-mobile-comment-trigger")).toBe("true");
    expect(comment.getAttribute("aria-pressed")).toBe("false");
    expect(comment.title).toBe("캔버스 위치 댓글");
    expect(comment.disabled).toBe(false);

    fireEvent.click(comment);
    expect(setMobileSheet).toHaveBeenCalledWith(null);
    expect(stableHandlers.toggleStudioCommentPinPlacement).toHaveBeenCalledOnce();

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          commentPinArmed: true,
          setMobileSheet,
          stableHandlers,
        })}
      />,
    );
    const cancel = within(
      screen.getByRole("toolbar", { name: "작업 공간" }),
    ).getByRole<HTMLButtonElement>("button", { name: "댓글 위치 선택 취소" });
    expect(cancel.textContent).toBe("취소");
    expect(cancel.getAttribute("aria-pressed")).toBe("true");
    expect(cancel.title).toBe("댓글 위치 선택 취소");

    fireEvent.click(cancel);
    expect(stableHandlers.toggleStudioCommentPinPlacement).toHaveBeenCalledTimes(2);
  });

  it("pins the quick menu to the opposite edge for a right-hand layout without moving the first comment action", () => {
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          workspaceState: { mobileControlSide: "right" } as StudioWorkspaceState,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    const workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const comment = within(workspace).getByRole("button", { name: "캔버스 위치 댓글" });
    const quickSlot = workspace.querySelector('[data-studio-mobile-quick-actions-slot="right"]');
    const scrollLane = workspace.querySelector('[data-studio-mobile-dock-scroll="secondary"]');
    const panelLauncher = within(scrollLane as HTMLElement).getByRole("button", {
      name: "작업 패널",
    });

    expect(workspace.getAttribute("data-studio-mobile-control-side")).toBe("right");
    expect(workspace.firstElementChild).toBe(comment);
    expect(workspace.lastElementChild).toBe(quickSlot);
    expect(scrollLane?.firstElementChild).toBe(panelLauncher);
    expect(
      scrollLane?.closest('[data-studio-mobile-scroll-host="secondary"]')?.nextElementSibling,
    ).toBe(quickSlot);
    expect(within(quickSlot as HTMLElement).getByRole("button", { name: "빠른 작업" })).not.toBeNull();
    expect(quickSlot?.className).toContain("size-11");
  });

  it("exposes CSP erase-to-intersection toggle in the mobile eraser draw sheet", () => {
    const setEraseToIntersection = vi.fn();
    const setDrawMode = vi.fn();
    const setTool = vi.fn();
    const stableHandlers = createHandlers();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          tool: "draw",
          drawMode: "eraser",
          mobileSheet: "draw",
          eraseToIntersection: false,
          setEraseToIntersection,
          setDrawMode,
          setTool,
          stableHandlers,
        })}
      />,
    );

    expect(document.querySelector('[data-studio-mobile-erase-to-intersection="true"]')).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "교점까지 지우기" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("data-studio-erase-to-intersection")).toBe("true");
    toggle.click();
    expect(setTool).not.toHaveBeenCalled();
    expect(setDrawMode).not.toHaveBeenCalled();
    expect(stableHandlers.activateCanvasTool).not.toHaveBeenCalled();
    expect(setEraseToIntersection).toHaveBeenCalledOnce();
    const updater = setEraseToIntersection.mock.calls[0]?.[0];
    expect(typeof updater).toBe("function");
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          tool: "draw",
          drawMode: "eraser",
          mobileSheet: "draw",
          eraseToIntersection: true,
          setEraseToIntersection,
          setDrawMode,
          setTool,
          stableHandlers,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "교점까지 지우기" }).getAttribute("aria-pressed")).toBe(
      "true"
    );

    // Pen mode must not show the scissors control.
    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          tool: "draw",
          drawMode: "pen",
          mobileSheet: "draw",
          eraseToIntersection: false,
          setEraseToIntersection,
        })}
      />,
    );
    expect(document.querySelector('[data-studio-mobile-erase-to-intersection="true"]')).toBeNull();
  });

  it("preserves the draw and brush-manager dialog contracts through stable handlers", () => {
    const stableHandlers = createHandlers();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, mobileSheet: "draw", stableHandlers })}
      />,
    );

    const drawSheet = screen.getByRole("dialog", { name: "브러시 설정" });
    expect(drawSheet.getAttribute("data-studio-sheet-id")).toBe("draw");
    expect(drawSheet.getAttribute("aria-modal")).toBe("false");
    // The brush sheet floats over the canvas the artist is judging, so it must open at the
    // smallest snap. Opening at `medium` left 126 canvas rows (19.7%) on a 360×640 viewport.
    expect(drawSheet.getAttribute("data-studio-sheet-snap")).toBe("compact");
    expect(STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP).toBe("compact");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileKeyboardInset: 22,
          mobileSheet: "brushes",
          stableHandlers,
        })}
      />,
    );

    const brushManager = screen.getByRole("dialog", { name: "내 브러시 관리" });
    expect(brushManager.getAttribute("data-studio-sheet-id")).toBe("brushes");
    expect(brushManager.getAttribute("aria-modal")).toBe("true");
    expect(brushManager.getAttribute("data-studio-sheet-snap")).toBe("medium");
    expect(brushManager.style.bottom).toBe("22px");
    within(brushManager).getByRole("button", { name: "브러시 관리 닫기" }).click();
    expect(stableHandlers.dismissBrushManager).toHaveBeenCalledOnce();
  });

  it("exposes the shared Living Ink Water, Fix, and Clear controls in the mobile brush sheet", () => {
    const onModeChange = vi.fn();
    const onFix = vi.fn();
    const onClear = vi.fn();

    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          livingInk: {
            ...createProps().livingInk,
            supported: true,
            physicalModeEnabled: true,
            fixAvailable: true,
            onModeChange,
            onFix,
            onClear,
          },
        })}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "브러시 설정" });
    const livingInk = within(sheet).getByRole("region", {
      name: "수채 번짐 빠른 도구",
    });
    expect(livingInk.getAttribute("data-studio-mobile-living-ink")).toBe("true");
    expect(document.querySelectorAll('[data-studio-living-ink-controls="true"]')).toHaveLength(1);

    within(livingInk).getByRole("button", { name: "수채 번짐 물" }).click();
    within(livingInk).getByRole("button", { name: "수채 번짐 정착" }).click();
    within(livingInk).getByRole("button", { name: "수채 번짐 지우기" }).click();

    expect(onModeChange).toHaveBeenCalledWith("water");
    expect(onFix).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("uses one touch-safe selected-brush restore action for modified, loading, unavailable, and undo states", () => {
    const stableHandlers = createHandlers();
    const setBrushOpacity = vi.fn();
    const setStrokeWidth = vi.fn();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          brushDefaultRestore: {
            sourceName: "내 G펜",
            modifiedCount: 6,
            loading: false,
            available: true,
            undoAvailable: false,
          },
          setBrushOpacity,
          setStrokeWidth,
          stableHandlers,
        })}
      />,
    );

    const drawSheet = screen.getByRole("dialog", { name: "브러시 설정" });
    const restoreSurface = drawSheet.querySelector(
      '[data-studio-mobile-brush-default-restore="true"]',
    );
    const modifiedRestore = within(drawSheet).getByRole<HTMLButtonElement>(
      "button",
      { name: "내 G펜 기본값으로 복원, 변경된 설정 6개" },
    );
    expect(restoreSurface?.getAttribute("data-studio-brush-preset-modified")).toBe(
      "true",
    );
    expect(
      restoreSurface?.getAttribute("data-studio-brush-preset-modified-count"),
    ).toBe("6");
    expect(modifiedRestore.className).toContain("min-h-11");
    expect(modifiedRestore.textContent).toContain("기본값 복원");
    expect(
      within(drawSheet).getByRole<HTMLInputElement>("slider", {
        name: "브러시 투명도 슬라이더",
      }).step,
    ).toBe("1");
    expect(
      within(drawSheet).getByRole<HTMLInputElement>("spinbutton", {
        name: "브러시 투명도 숫자",
      }).step,
    ).toBe("1");
    expect(within(drawSheet).queryByRole("button", {
      name: "브러시 굵기 기본값으로 초기화",
    })).toBeNull();
    expect(within(drawSheet).queryByRole("button", {
      name: "브러시 투명도 100퍼센트로 초기화",
    })).toBeNull();

    fireEvent.click(modifiedRestore);
    expect(stableHandlers.restoreBrushDefaults).toHaveBeenCalledOnce();
    expect(setStrokeWidth).not.toHaveBeenCalled();
    expect(setBrushOpacity).not.toHaveBeenCalled();

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          brushDefaultRestore: {
            sourceName: "내 G펜",
            modifiedCount: 0,
            loading: true,
            available: false,
            undoAvailable: false,
          },
          stableHandlers,
        })}
      />,
    );
    const loadingRestore = screen.getByRole<HTMLButtonElement>("button", {
      name: "내 G펜 기본값을 불러오는 중",
    });
    expect(loadingRestore.disabled).toBe(true);
    expect(loadingRestore.getAttribute("aria-busy")).toBe("true");
    expect(loadingRestore.textContent).toContain("확인 중");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          brushDefaultRestore: {
            sourceName: "내 G펜",
            modifiedCount: 0,
            loading: false,
            available: false,
            undoAvailable: false,
          },
          stableHandlers,
        })}
      />,
    );
    const unavailableRestore = screen.getByRole<HTMLButtonElement>("button", {
      name: "내 G펜 기본값 없음, 브러시를 다시 선택하세요",
    });
    expect(unavailableRestore.disabled).toBe(true);
    expect(unavailableRestore.textContent).toContain("기준 없음");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          brushDefaultRestore: {
            sourceName: "내 G펜",
            modifiedCount: 0,
            loading: false,
            available: true,
            undoAvailable: true,
          },
          stableHandlers,
        })}
      />,
    );
    const undoRestore = screen.getByRole<HTMLButtonElement>("button", {
      name: "내 G펜 기본값 복원 되돌리기",
    });
    expect(undoRestore.disabled).toBe(false);
    expect(undoRestore.textContent).toContain("복원 되돌리기");
    fireEvent.click(undoRestore);
    expect(stableHandlers.restoreBrushDefaults).toHaveBeenCalledTimes(2);

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          brushDefaultRestore: {
            sourceName: "내 G펜",
            modifiedCount: 0,
            loading: false,
            available: true,
            undoAvailable: false,
          },
          stableHandlers,
        })}
      />,
    );
    const cleanRestore = screen.getByRole<HTMLButtonElement>("button", {
      name: "내 G펜 기본값, 변경된 설정 없음",
    });
    expect(cleanRestore.disabled).toBe(true);
    expect(cleanRestore.textContent).toContain("기본값");

    for (const drawMode of ["shape", "pixel", "eraser"] as const) {
      view.rerender(
        <StudioMobileEditingDock
          {...createProps({
            isMobile: true,
            mobileSheet: "draw",
            drawMode,
            brushDefaultRestore: {
              sourceName: "내 G펜",
              modifiedCount: 6,
              loading: false,
              available: true,
              undoAvailable: false,
            },
            stableHandlers,
          })}
        />,
      );
      expect(document.querySelector(
        '[data-studio-mobile-brush-default-restore="true"]',
      )).toBeNull();
    }
  });

  it("reserves a shrinkable mobile lane for brush chips beside the catalog exit", () => {
    render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, mobileSheet: "draw" })}
      />,
    );

    const drawSheet = screen.getByRole("dialog", { name: "브러시 설정" });
    const layout = drawSheet.querySelector<HTMLElement>(
      '[data-studio-mobile-unified-brush-layout="true"]',
    );
    expect(layout).not.toBeNull();
    expect(layout?.classList.contains("min-w-0")).toBe(true);
    expect(layout?.className).toContain(
      "[&_[data-studio-brush-tray=true]>[role=listbox]]:flex-1",
    );
    expect(layout?.className).toContain(
      "[&_[data-studio-brush-tray=true]>[role=listbox]]:min-w-0",
    );
    expect(
      layout?.querySelector('[data-studio-brush-tray="true"] > [role="listbox"]'),
    ).not.toBeNull();
  });

  it("keeps launcher focus but suppresses the first rich hint for any draw tool after dismissing settings", () => {
    const onFocusWithin = vi.fn();
    const setMobileSheet = vi.fn();
    const view = render(
      <div onFocus={onFocusWithin}>
        <StudioMobileEditingDock
          {...createProps({
            isMobile: true,
            mobileSheet: "draw",
            setMobileSheet,
          })}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "브러시 설정 닫기" }));
    expect(setMobileSheet).toHaveBeenCalledWith(null);

    view.rerender(
      <div onFocus={onFocusWithin}>
        <StudioMobileEditingDock
          {...createProps({
            isMobile: true,
            mobileSheet: null,
            setMobileSheet,
          })}
        />
      </div>,
    );
    const launcher = screen.getByRole("button", { name: "펜" });
    launcher.focus();
    expect(document.activeElement).toBe(launcher);
    expect(onFocusWithin).not.toHaveBeenCalled();

    launcher.blur();
    launcher.focus();
    expect(onFocusWithin).toHaveBeenCalledOnce();
  });

  it("announces each mobile draw control's next settings-sheet action", () => {
    const view = render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, tool: "select", drawMode: "pen" })}
      />,
    );
    const drawingTools = () => within(
      screen.getByRole("toolbar", { name: "드로잉 도구" }),
    );

    const inactivePen = drawingTools().getByRole("button", { name: "펜" });
    expect(inactivePen.getAttribute("data-hint-preview")).toBe("ink");
    expect(inactivePen.getAttribute("aria-expanded")).toBeNull();
    expect(inactivePen.getAttribute("aria-controls")).toBeNull();

    const inactiveShape = drawingTools().getByRole("button", { name: "도형" });
    expect(inactiveShape.getAttribute("data-hint-preview")).toBe("shape");
    expect(inactiveShape.getAttribute("data-hint-preview-variant")).toBe("rect");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, tool: "draw", drawMode: "pen", mobileSheet: null })}
      />,
    );
    const closedPen = drawingTools().getByRole("button", { name: "펜" });
    expect(closedPen.getAttribute("aria-expanded")).toBe("false");
    expect(closedPen.getAttribute("aria-controls")).toBe("studio-mobile-draw-settings");
    expect(closedPen.getAttribute("data-hint-preview")).toBe("draw-settings");
    expect(closedPen.getAttribute("data-hint-preview-variant")).toBe("expand");
    expect(closedPen.getAttribute("data-hint-description")).toContain("설정을 열어");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, tool: "draw", drawMode: "pen", mobileSheet: "draw" })}
      />,
    );
    const openPen = drawingTools().getByRole("button", { name: "펜" });
    expect(openPen.getAttribute("aria-expanded")).toBe("true");
    expect(openPen.getAttribute("data-hint-preview-variant")).toBe("collapse");
    expect(openPen.getAttribute("data-hint-description")).toContain("설정을 닫고");

    const openBrush = drawingTools().getByRole("button", { name: "브러시 설정 (굵기·색·프리셋)" });
    expect(openBrush.getAttribute("aria-expanded")).toBe("true");
    expect(openBrush.getAttribute("aria-controls")).toBe("studio-mobile-draw-settings");
    expect(openBrush.getAttribute("data-hint-preview-variant")).toBe("collapse");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, tool: "draw", drawMode: "shape", mobileSheet: null })}
      />,
    );
    const closedShape = drawingTools().getByRole("button", { name: "도형" });
    expect(closedShape.getAttribute("aria-expanded")).toBe("false");
    expect(closedShape.getAttribute("aria-controls")).toBe("studio-mobile-draw-settings");
    expect(closedShape.getAttribute("data-hint-preview")).toBe("draw-settings");
    expect(closedShape.getAttribute("data-hint-preview-variant")).toBe("expand");

    const closedBrush = drawingTools().getByRole("button", { name: "브러시 설정 (굵기·색·프리셋)" });
    expect(closedBrush.getAttribute("aria-expanded")).toBe("false");
    expect(closedBrush.getAttribute("data-hint-preview-variant")).toBe("expand");

    expect(document.getElementById("studio-mobile-draw-settings")).not.toBeNull();
  });

  it("exposes all color-vision coaches from the actual mobile dock", () => {
    const setColorBlindPreview = vi.fn();
    const setMobileSheet = vi.fn();
    const view = render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, setColorBlindPreview, setMobileSheet })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "색각·명암 검수" }));
    expect(setMobileSheet).toHaveBeenCalledOnce();

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "color-vision",
          setColorBlindPreview,
          setMobileSheet,
        })}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "색각 검수" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-studio-mobile-sheet")).toBe("true");
    expect(dialog.getAttribute("data-studio-shortcut-boundary")).toBe("true");
    expect(dialog.tabIndex).toBe(-1);
    expect(within(dialog).getAllByRole("radio")).toHaveLength(5);

    fireEvent.click(within(dialog).getByRole("radio", { name: "흑백 명암 미리보기" }));
    expect(setColorBlindPreview).toHaveBeenCalledWith("grayscale");

    fireEvent.click(within(dialog).getByRole("button", { name: "색각 검수 닫기" }));
    expect(setMobileSheet).toHaveBeenLastCalledWith(null);
    view.rerender(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, setColorBlindPreview, setMobileSheet })}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "색각 검수" })).toBeNull();
  });

  it("cycles draw sheet sizes, clamps keyboard resize at compact, and closes explicitly", () => {
    const setMobileSheet = vi.fn();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileKeyboardInset: 19.6,
          mobileSheet: "draw",
          setMobileSheet,
        })}
      />,
    );

    const drawSheet = screen.getByRole("dialog", { name: "브러시 설정" });
    const handle = screen.getByRole("slider", { name: /브러시 설정 크기 조절/ });
    expect(
      drawSheet.style.getPropertyValue("--studio-draw-sheet-reserved-bottom"),
    ).toContain("20px");
    expect(
      drawSheet.style.getPropertyValue("--studio-draw-sheet-reserved-bottom"),
    ).toContain("72px");
    // Opens compact so the canvas under it stays judgeable; the grabber promotes from there.
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    expect(drawSheet.getAttribute("data-studio-sheet-snap")).toBe("compact");

    fireEvent.click(handle);
    expect(drawSheet.getAttribute("data-studio-sheet-snap")).toBe("medium");
    expect(handle.getAttribute("aria-valuenow")).toBe("1");

    fireEvent.click(handle);
    expect(drawSheet.getAttribute("data-studio-sheet-snap")).toBe("full");
    expect(
      drawSheet.style.getPropertyValue("--studio-draw-sheet-height"),
    ).toContain("min(88dvh");
    expect(
      drawSheet.style.getPropertyValue("--studio-draw-sheet-height"),
    ).toContain("--studio-canvas-bottom-inset");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(drawSheet.getAttribute("data-studio-sheet-snap")).toBe("compact");
    expect(setMobileSheet).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(handle, { key: "ArrowDown" })).toBe(false);
    expect(setMobileSheet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "브러시 설정 닫기" }));
    expect(setMobileSheet).toHaveBeenCalledWith(null);
  });

  it("isolates and visually clears the draw sheet while the full brush catalog is open", () => {
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          brushCatalogOpen: false,
          isMobile: true,
          mobileSheet: "draw",
        })}
      />,
    );

    const drawSheet = screen.getByRole("dialog", { name: "브러시 설정" });
    expect(drawSheet.hasAttribute("inert")).toBe(false);
    expect(drawSheet.getAttribute("aria-hidden")).toBeNull();
    expect(drawSheet.getAttribute("aria-modal")).toBe("false");
    expect(drawSheet.getAttribute("tabindex")).toBe("-1");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          brushCatalogOpen: true,
          isMobile: true,
          mobileSheet: "draw",
        })}
      />,
    );

    const isolatedSheet = document.querySelector<HTMLElement>('[data-studio-sheet-id="draw"]');
    expect(isolatedSheet?.hasAttribute("inert")).toBe(true);
    expect(isolatedSheet?.getAttribute("aria-hidden")).toBe("true");
    expect(isolatedSheet?.getAttribute("role")).toBeNull();
    expect(isolatedSheet?.getAttribute("aria-label")).toBeNull();
    expect(isolatedSheet?.getAttribute("aria-modal")).toBeNull();
    expect(isolatedSheet?.getAttribute("tabindex")).toBeNull();
    expect(isolatedSheet?.className).toContain("pointer-events-none");
    expect(isolatedSheet?.className).toContain("opacity-0");

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          brushCatalogOpen: false,
          isMobile: true,
          mobileSheet: null,
        })}
      />,
    );

    const dormantSheet = document.querySelector<HTMLElement>('[data-studio-sheet-id="draw"]');
    expect(screen.queryByRole("dialog", { name: "브러시 설정" })).toBeNull();
    expect(dormantSheet?.hasAttribute("inert")).toBe(true);
    expect(dormantSheet?.getAttribute("aria-hidden")).toBe("true");
    expect(dormantSheet?.getAttribute("role")).toBeNull();
    expect(dormantSheet?.getAttribute("aria-label")).toBeNull();
    expect(dormantSheet?.getAttribute("tabindex")).toBeNull();
  });

  it("uses the same three snap levels for the mobile brush manager", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileKeyboardInset: Number.NaN,
          mobileSheet: "brushes",
          stableHandlers,
        })}
      />,
    );

    const brushManager = screen.getByRole("dialog", { name: "내 브러시 관리" });
    const handle = screen.getByRole("slider", { name: /내 브러시 관리 크기 조절/ });
    expect(brushManager.style.bottom).toBe("0px");
    expect(brushManager.getAttribute("data-studio-sheet-snap")).toBe("medium");

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(brushManager.getAttribute("data-studio-sheet-snap")).toBe("full");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(brushManager.getAttribute("data-studio-sheet-snap")).toBe("compact");

    expect(fireEvent.keyDown(handle, { key: "ArrowDown" })).toBe(false);
    expect(stableHandlers.dismissBrushManager).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "브러시 관리 닫기" }));
    expect(stableHandlers.dismissBrushManager).toHaveBeenCalledOnce();
  });

  it("delegates selection toolbar actions without moving controller state into the dock", () => {
    const stableHandlers = createHandlers();
    const setMarqueeIds = vi.fn();
    const setMobileSheet = vi.fn();
    const setSelectedId = vi.fn();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
          setMarqueeIds,
          setMobileSheet,
          setSelectedId,
          stableHandlers,
        })}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" });
    within(toolbar).getByRole("button", { name: "속성" }).click();
    within(toolbar).getByRole("button", { name: "복제" }).click();
    within(toolbar).getByRole("button", { name: "앞으로" }).click();
    within(toolbar).getByRole("button", { name: "뒤로" }).click();
    within(toolbar).getByRole("button", { name: "삭제" }).click();
    within(toolbar).getByRole("button", { name: "해제" }).click();

    expect(stableHandlers.openInspectorRoute).toHaveBeenCalledWith({ primary: "properties" }, "props");
    expect(setMobileSheet).toHaveBeenCalledWith("props");
    expect(stableHandlers.duplicateSelected).toHaveBeenCalledOnce();
    expect(stableHandlers.reorder).toHaveBeenNthCalledWith(1, "front");
    expect(stableHandlers.reorder).toHaveBeenNthCalledWith(2, "back");
    expect(stableHandlers.removeSelected).toHaveBeenCalledOnce();
    expect(setSelectedId).toHaveBeenCalledWith(null);
    expect(setMarqueeIds).toHaveBeenCalledWith([]);
  });

  /**
   * 모바일에는 상단 선택 레인이 없다. 레인에만 있던 잠금이 여기서도 빠지면 모바일에서는
   * 요소를 고정할 방법이 사라진다 — 그래서 이 바가 유일한 빠른 경로다.
   */
  it("carries the lock command the removed top lane used to own", () => {
    const stableHandlers = createHandlers();
    const { rerender } = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
          selectionLocked: false,
          stableHandlers,
        })}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" });
    // 44px 터치 타깃은 공용 `StudioContextActionButton`(min-h-11 min-w-14)이 보장한다 —
    // 이 파일에서는 그 버튼이 목이라 기하 대신 배선만 확인하고, 실측은 브라우저에서 한다.
    const lock = within(toolbar).getByRole("button", { name: "잠금" });
    lock.click();
    expect(stableHandlers.toggleSelectionLock).toHaveBeenCalledOnce();

    // 잠긴 뒤에는 라벨이 실제로 일어날 일을 가리켜야 한다.
    rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
          selectionLocked: true,
          stableHandlers,
        })}
      />,
    );
    const relocked = screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" });
    expect(within(relocked).getByRole("button", { name: "잠금 해제" })).toBeTruthy();
    expect(within(relocked).queryByRole("button", { name: "잠금" })).toBeNull();
  });

  /**
   * 대사 편집은 말풍선·글자에서만 뜻이 있다. 더블탭으로도 편집에 들어가지만 보이지 않는
   * 제스처라, 데스크톱 선택 옵션 바와 같은 라벨로 발견 가능한 자리를 하나 둔다.
   */
  it("exposes lettering edit only for elements that can be edited", () => {
    const stableHandlers = createHandlers();
    const { rerender } = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "bubble-1", type: "bubble" } as StudioMobileEditingDockProps["selected"],
          selectionTextEditLabel: "대사 편집",
          stableHandlers,
        })}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" });
    const edit = within(toolbar).getByRole("button", { name: "대사 편집" });
    expect(edit.title).toContain("더블탭");
    edit.click();
    expect(stableHandlers.editSelectionText).toHaveBeenCalledOnce();

    // 잠금·검수 잠금이면 컨트롤러가 라벨을 null 로 내리고, 그러면 항목 자체가 사라진다.
    rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "bubble-1", type: "bubble" } as StudioMobileEditingDockProps["selected"],
          selectionTextEditLabel: null,
          stableHandlers,
        })}
      />,
    );
    expect(
      within(screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" })).queryByRole("button", {
        name: "대사 편집",
      }),
    ).toBeNull();
  });

  it("offers all five page-composite filters for a selected draw element", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "draw-1", type: "draw" } as StudioMobileEditingDockProps["selected"],
          stableHandlers,
        })}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" });
    const filter = within(toolbar).getByRole<HTMLSelectElement>("combobox", {
      name: "현재 페이지 합성본 필터 선택",
    });
    expect(within(filter).getAllByRole("option")).toHaveLength(6);
    expect(within(toolbar).queryByRole("button", { name: "채우기" })).toBeNull();
    expect(filter.closest("label")?.className).toContain("min-h-11");
    expect(filter.title).toContain("현재 페이지 합성본");
  });

  it("keeps the page-composite filter shortcut for non-drawing selections", () => {
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "frame-1", type: "frame" } as StudioMobileEditingDockProps["selected"],
        })}
      />,
    );

    const filter =
      within(screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" })).getByRole(
        "combobox",
        { name: "현재 페이지 합성본 필터 선택" },
      ) as HTMLSelectElement;
    expect(filter.disabled).toBe(false);
  });

  it("keeps page filters reachable from the expanded workspace without a selection", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, selected: null, stableHandlers })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    const workspace = screen.getByRole("toolbar", { name: "작업 공간" });
    const filter = within(workspace).getByRole<HTMLSelectElement>("combobox", {
      name: "현재 페이지 합성본 필터 선택",
    });
    expect(filter.disabled).toBe(false);
    expect(filter.closest("label")?.className).toContain("min-h-11");
    expect(filter.closest("label")?.className).toContain("min-w-14");

    fireEvent.change(filter, { target: { value: "gaussian-blur" } });
    expect(stableHandlers.openStudioFilter).toHaveBeenCalledWith("gaussian-blur");
  });

  it("distinguishes filter preparation from edit locks in mobile guidance", () => {
    const view = render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          filterPreparationBusy: true,
          filterTargetLabel: "현재 페이지 합성본",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 메뉴" }));
    let unavailableFilter = within(
      screen.getByRole("toolbar", { name: "작업 공간" }),
    ).getByRole<HTMLButtonElement>("button", {
      name: "현재 페이지 합성본 필터를 사용할 수 없음",
    });
    expect(unavailableFilter.getAttribute("aria-disabled")).toBe("true");
    expect(unavailableFilter.getAttribute("aria-busy")).toBe("true");
    expect(unavailableFilter.title).toBe("현재 페이지 합성본: 필터 미리보기를 준비하는 중입니다.");
    expect(unavailableFilter.tabIndex).toBe(0);

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          filterMutationLocked: true,
          filterTargetLabel: "선택 이미지",
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
        })}
      />,
    );
    unavailableFilter = within(
      screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" }),
    ).getByRole<HTMLButtonElement>("button", { name: "선택 이미지 필터를 사용할 수 없음" });
    expect(unavailableFilter.getAttribute("aria-disabled")).toBe("true");
    expect(unavailableFilter.getAttribute("aria-busy")).toBe("false");
    expect(unavailableFilter.title).toBe("선택 이미지: 편집 잠금을 해제한 뒤 필터를 적용하세요.");
    expect(unavailableFilter.getAttribute("aria-describedby")).not.toBeNull();

    view.rerender(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          filterUnavailableReason: "저장이 끝난 뒤 필터를 적용하세요.",
        })}
      />,
    );
    unavailableFilter = within(
      screen.getByRole("toolbar", { name: "작업 공간" }),
    ).getByRole<HTMLButtonElement>("button", {
      name: "현재 페이지 합성본 필터를 사용할 수 없음",
    });
    expect(unavailableFilter.title).toBe("현재 페이지 합성본: 저장이 끝난 뒤 필터를 적용하세요.");
    expect(unavailableFilter.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("routes every mobile filter kind through the stable handler", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          filterTargetLabel: "선택 이미지",
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
          stableHandlers,
        })}
      />,
    );

    const filter = within(
      screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" }),
    ).getByRole<HTMLSelectElement>("combobox", { name: "선택 이미지 필터 선택" });
    const kinds = [
      "gaussian-blur",
      "motion-blur",
      "hue-saturation-brightness",
      "brightness-contrast",
      "color-curves",
    ] as const;
    kinds.forEach((kind) => fireEvent.change(filter, { target: { value: kind } }));

    expect(stableHandlers.openStudioFilter).toHaveBeenCalledTimes(5);
    kinds.forEach((kind, index) => {
      expect(stableHandlers.openStudioFilter).toHaveBeenNthCalledWith(index + 1, kind);
    });
  });

  it("keeps contextual fill clickable and exposes recovery guidance for an unsupported image", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: { id: "image-1", type: "image" } as StudioMobileEditingDockProps["selected"],
          advancedFillUnsupportedReason: "잠긴 레이어는 채울 수 없어요.",
          stableHandlers,
        })}
      />,
    );

    const fill = within(
      screen.getByRole("toolbar", { name: "선택 항목 빠른 작업" }),
    ).getByRole<HTMLButtonElement>("button", { name: "채우기" });
    expect(fill.disabled).toBe(false);
    expect(fill.title).toContain("잠긴 레이어는 채울 수 없어요.");
    expect(fill.title).toContain("조건을 확인");

    fireEvent.click(fill);
    expect(stableHandlers.toggleAdvancedFill).toHaveBeenCalledOnce();
  });

  it("keeps fill in the primary mobile drawing toolbar without requiring a selection", () => {
    const stableHandlers = createHandlers();
    const setMenu = vi.fn();
    const setMobileSheet = vi.fn();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          selected: null,
          advancedFillUnsupportedReason: "래스터 이미지 레이어를 먼저 선택하세요.",
          setMenu,
          setMobileSheet,
          stableHandlers,
        })}
      />,
    );

    const fill = within(
      screen.getByRole("toolbar", { name: "드로잉 도구" }),
    ).getByRole<HTMLButtonElement>("button", { name: "채우기" });
    expect(fill.disabled).toBe(false);
    expect(fill.getAttribute("data-hint-description")).toContain(
      "래스터 이미지 레이어를 먼저 선택하세요.",
    );
    expect(fill.getAttribute("data-hint-description")).toContain("안전한 단일 래스터 후보");

    fireEvent.click(fill);
    expect(setMenu).toHaveBeenCalledWith(null);
    expect(setMobileSheet).toHaveBeenCalledWith(null);
    expect(stableHandlers.toggleAdvancedFill).toHaveBeenCalledOnce();
  });

  it("presents fill as the only pressed canvas owner while its internal selection target is armed", () => {
    render(
      <StudioMobileEditingDock
        {...createProps({
          advancedFillActive: true,
          isMobile: true,
          tool: "select",
        })}
      />,
    );

    const drawingToolbar = screen.getByRole("toolbar", { name: "드로잉 도구" });
    expect(
      within(drawingToolbar).getByRole("button", { name: "선택" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      within(drawingToolbar).getByRole("button", { name: "채우기" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it.each([
    [{ tool: "select" as const, drawMode: "pen" as const, advancedFillActive: false }, "선택"],
    [{ tool: "draw" as const, drawMode: "pen" as const, advancedFillActive: false }, "펜"],
    [{ tool: "draw" as const, drawMode: "pixel" as const, advancedFillActive: false }, "픽셀"],
    [{ tool: "draw" as const, drawMode: "eraser" as const, advancedFillActive: false }, "지우개"],
    [{ tool: "draw" as const, drawMode: "shape" as const, advancedFillActive: false }, "도형"],
    [{ tool: "select" as const, drawMode: "pen" as const, advancedFillActive: true }, "채우기"],
  ])("exposes exactly one pressed primary canvas owner for %s", (state, expectedLabel) => {
    render(<StudioMobileEditingDock {...createProps({ ...state, isMobile: true })} />);

    const toolbar = screen.getByRole("toolbar", { name: "드로잉 도구" });
    const pressed = [...toolbar.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')];
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.getAttribute("aria-label") ?? pressed[0]?.textContent).toContain(expectedLabel);
  });

  it("routes primary tool changes through the exclusive canvas transition owner", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, tool: "select", stableHandlers })}
      />,
    );
    const toolbar = within(screen.getByRole("toolbar", { name: "드로잉 도구" }));

    fireEvent.click(toolbar.getByRole("button", { name: "펜" }));
    fireEvent.click(toolbar.getByRole("button", { name: "픽셀" }));
    fireEvent.click(toolbar.getByRole("button", { name: "지우개" }));
    fireEvent.click(toolbar.getByRole("button", { name: "도형" }));
    fireEvent.click(toolbar.getByRole("button", { name: "선택" }));

    expect(stableHandlers.activateCanvasTool).toHaveBeenNthCalledWith(1, "draw", "pen");
    expect(stableHandlers.activateCanvasTool).toHaveBeenNthCalledWith(2, "draw", "pixel");
    expect(stableHandlers.activateCanvasTool).toHaveBeenNthCalledWith(3, "draw", "eraser");
    expect(stableHandlers.activateCanvasTool).toHaveBeenNthCalledWith(4, "draw", "shape");
    expect(stableHandlers.activateCanvasTool).toHaveBeenNthCalledWith(5, "select");
  });

  it("opens brush settings without turning selection into a drawing tool", () => {
    const stableHandlers = createHandlers();
    const setDrawMode = vi.fn();
    const setMenu = vi.fn();
    const setMobileSheet = vi.fn();
    const setTool = vi.fn();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          tool: "select",
          stableHandlers,
          setDrawMode,
          setMenu,
          setMobileSheet,
          setTool,
        })}
      />,
    );

    const settings = screen.getByRole("button", {
      name: "브러시 설정 (굵기·색·프리셋)",
    });
    expect(settings.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(settings);

    expect(setTool).not.toHaveBeenCalled();
    expect(setDrawMode).not.toHaveBeenCalled();
    expect(stableHandlers.activateCanvasTool).not.toHaveBeenCalled();
    expect(setMenu).toHaveBeenCalledWith(null);
    expect(setMobileSheet).toHaveBeenCalledOnce();
    const updater = setMobileSheet.mock.calls[0]?.[0];
    expect(typeof updater).toBe("function");
    expect(updater(null)).toBe("draw");
    expect(updater("draw")).toBeNull();
  });

  it("keeps the first-use coach close action at the 44px mobile target minimum", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({ isMobile: true, showMobileHint: true, stableHandlers })}
      />,
    );

    const close = screen.getByRole<HTMLButtonElement>("button", { name: "안내 닫기" });
    expect(close.className).toContain("size-11");

    fireEvent.click(close);
    expect(stableHandlers.dismissMobileHint).toHaveBeenCalledOnce();
  });

  it("puts brush size and opacity above the presets so a compact sheet still exposes them", () => {
    render(
      <StudioMobileEditingDock {...createProps({ isMobile: true, mobileSheet: "draw" })} />,
    );

    const sheet = screen.getByRole("dialog", { name: "브러시 설정" });
    const size = within(sheet).getByLabelText("브러시 굵기 슬라이더");
    const opacity = within(sheet).getByLabelText("브러시 투명도 슬라이더");
    const modeSwitch = within(sheet).getByRole("group", { name: "그리기 모드" });

    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    // Size/opacity were below the preset shelf, the catalog picker and the swatch grid, so on a
    // 360×640 viewport they sat off the bottom of the sheet at every snap.
    expect(size.compareDocumentPosition(opacity) & follows).toBe(follows);
    expect(opacity.compareDocumentPosition(modeSwitch) & follows).toBe(follows);
  });

  it("shows the named kneaded eraser identity and low-density opacity on mobile", () => {
    const stableHandlers = createHandlers();
    render(
      <StudioMobileEditingDock
        {...createProps({
          isMobile: true,
          mobileSheet: "draw",
          drawMode: "eraser",
          brush: "kneaded-eraser",
          activeCatalogBrushId: "kneaded-eraser",
          activeCatalogBrushName: "떡지우개(저농도)",
          brushOpacity: 0.38,
          strokeWidth: 26,
          stableHandlers,
        })}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "브러시 설정" });
    expect(within(sheet).getByText("떡지우개(저농도) 설정")).toBeTruthy();
    expect(
      within(sheet).getByLabelText<HTMLInputElement>("지우기 강도 슬라이더").value,
    ).toBe("38");

    fireEvent.click(within(sheet).getByRole("button", { name: "지우개" }));
    expect(stableHandlers.activateCanvasTool).not.toHaveBeenCalled();
  });

  it("renders the drawing tool row in the active locale instead of hardcoded Korean", () => {
    useI18n.getState().setLang("en");
    render(<StudioMobileEditingDock {...createProps({ isMobile: true })} />);

    const toolbar = screen.getByRole("toolbar", { name: "Drawing tools" });
    expect(screen.getByRole("navigation", { name: "Studio mobile toolbar" })).toBeTruthy();
    for (const name of ["Select", "Pen", "Pixel", "Eraser", "Fill", "Shape"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeTruthy();
    }
    expect(
      within(toolbar).getByRole("button", { name: "Eraser" })
        .getAttribute("data-studio-mobile-tool"),
    ).toBe("eraser");
    expect(within(toolbar).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(within(toolbar).getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(
      within(toolbar).getByRole("button", { name: "Brush settings (size, color, presets)" }),
    ).toBeTruthy();

    // No Hangul may survive anywhere in the tool row once a non-Korean locale is active.
    expect(toolbar.textContent ?? "").not.toMatch(/[가-힣]/u);
    for (const element of toolbar.querySelectorAll("[aria-label]")) {
      expect(element.getAttribute("aria-label") ?? "").not.toMatch(/[가-힣]/u);
    }
  });
});
