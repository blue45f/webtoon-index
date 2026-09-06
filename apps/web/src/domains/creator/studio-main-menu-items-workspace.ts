/**
 * §15.3 workspace groups — Window and Help.
 *
 * Window collects the panel/density/companion toggles that used to be mixed into
 * `보기`, plus the asset and reference entry points from `삽입`. Help keeps the
 * two rows it already had, including the locale-probe fallback that shipped with
 * the group.
 */

import {
  BookOpen,
  Command,
  LayoutGrid,
  LayoutTemplate,
  Layers,
  Maximize2,
  Minimize2,
  PanelTop,
  PictureInPicture2,
  SlidersHorizontal,
  Square,
} from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export function buildStudioWindowMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  const isPresentationSuppressed = state.presentationPanelsHidden === true;
  const visibleLeftPanelOpen = isPresentationSuppressed
    ? false
    : (state.visibleLeftPanelOpen ?? state.leftPanelOpen);
  const visibleRightPanelOpen = isPresentationSuppressed
    ? false
    : (state.visibleRightPanelOpen ?? state.rightPanelOpen);
  const isWorkspaceWideMode =
    state.canvasWideMode ?? (!visibleLeftPanelOpen && !visibleRightPanelOpen);

  return [
    {
      id: "density-focus",
      commandId: "window.density-focus",
      legacyPath: "view/density-focus",
      label: "슈퍼심플 레이아웃",
      icon: Minimize2,
      onSelect: () => {
        editor.setStudioUiDensity("focus");
        ui.collapseSidePanels();
      },
    },
    {
      id: "density-full",
      commandId: "window.density-full",
      legacyPath: "view/density-full",
      label: "전체 레이아웃",
      icon: LayoutGrid,
      separatorAfter: true,
      onSelect: () => {
        editor.setStudioUiDensity("full");
        // 슈퍼심플이 접은 패널까지 되돌려야 "전체"다. 밀도만 복원하면 접힌 상태에서 이
        // 항목은 아무 가시 변화가 없고, 사용자는 되돌아갈 길이 없다고 느낀다(실측: 접힌
        // 상태에서 클릭 2연타에도 bodyLen 314 그대로).
        ui.expandSidePanels();
      },
    },
    {
      id: "left-panel",
      commandId: "window.left-panel",
      legacyPath: "view/left-panel",
      label: state.leftPanelOpen ? "왼쪽 패널 숨기기" : "왼쪽 패널 보이기",
      icon: Layers,
      onSelect: () => {
        ui.toggleLeftPanel();
      },
    },
    {
      id: "right-panel",
      commandId: "window.right-panel",
      legacyPath: "view/right-panel",
      // 패널이 스스로를 "작업 패널"이라 부르므로(아래 wide 행의 문구와 동일)
      // 이 행도 같은 이름을 쓴다. 예전 이름 "속성 패널"은 카탈로그의 검색 별칭으로 남아 있다.
      label: state.rightPanelOpen ? "작업 패널 숨기기" : "작업 패널 보이기",
      icon: SlidersHorizontal,
      onSelect: () => {
        ui.toggleRightPanel();
      },
    },
    {
      id: "wide",
      commandId: "window.collapse-side-panels",
      legacyPath: "view/wide",
      label: isWorkspaceWideMode ? "패널 펼치기" : "패널 접어 넓게",
      checked: isWorkspaceWideMode,
      icon: Maximize2,
      ...(isPresentationSuppressed
        ? {
            disabled: true,
            unavailableReason: "전체화면·브라우저 맞춤에서는 작업 패널을 임시로 숨깁니다.",
          }
        : {}),
      onSelect: () => {
        if (isPresentationSuppressed) return;
        if (typeof ui.toggleCanvasWideMode === "function") {
          ui.toggleCanvasWideMode();
          return;
        }
        if (isWorkspaceWideMode) ui.expandSidePanels();
        else ui.collapseSidePanels();
      },
    },
    {
      id: "canvas-only",
      commandId: "window.canvas-only",
      legacyPath: "view/canvas-only",
      label: "캔버스만",
      icon: Square,
      shortcut: "`",
      separatorAfter: true,
      onSelect: () => {
        editor.enterCanvasOnlyMode();
      },
    },
    {
      id: "quick-access-palette",
      commandId: "window.quick-access-palette",
      legacyPath: "view/quick-access-palette",
      label: state.quickAccessPaletteLoading
        ? "빠른 액세스 불러오는 중…"
        : state.quickAccessPaletteOpen
          ? "빠른 액세스 팔레트 숨기기"
          : "빠른 액세스 팔레트 표시",
      icon: Command,
      shortcut: "⇧Q",
      checked: state.quickAccessPaletteOpen,
      disabled: state.quickAccessPaletteLoading,
      separatorAfter: true,
      onSelect: ui.toggleQuickAccessPalette,
    },
    {
      // §15.3 Window ▸ Action Bar — the persistent slotted command strip under the menubar
      // (CSP 커맨드 바). The strip itself lives in StudioMenubarContent and persists through
      // the workspace live layout; this row is the visibility toggle.
      id: "command-bar",
      commandId: "window.command-bar",
      label: state.commandBarVisible === false ? "명령 바 표시" : "명령 바 숨기기",
      icon: PanelTop,
      checked: state.commandBarVisible !== false,
      separatorAfter: true,
      ...(typeof ui.toggleCommandBar === "function"
        ? {}
        : {
            disabled: true,
            unavailableReason:
              "이 화면에는 명령 바 표시 전환이 아직 연결되지 않았습니다. 메뉴바의 명령 바 설정에서 표시를 바꿀 수 있어요.",
          }),
      onSelect: () => {
        ui.toggleCommandBar?.();
      },
    },
    {
      id: "template",
      commandId: "insert.template",
      legacyPath: "insert/template",
      label: "템플릿 · 에셋",
      icon: LayoutTemplate,
      onSelect: () => {
        ui.openAssetMenu();
      },
    },
    // "참고 이미지"(열기 전용) 행은 제거했다 — 같은 창을 토글하는 아래 행 하나만 남긴다.
    {
      id: "reference-window",
      commandId: "window.reference-panel",
      legacyPath: "view/reference-window",
      label: "참고 이미지 창",
      icon: PictureInPicture2,
      checked: state.referencePanelOpen,
      separatorAfter: true,
      onSelect: () => {
        ui.toggleReferencePanel();
      },
    },
    {
      id: "tools-companion",
      commandId: "window.tools-companion",
      legacyPath: "view/tools-companion",
      label: "멀티 디스플레이 작업공간…",
      icon: PictureInPicture2,
      separatorAfter: true,
      onSelect: () => {
        ui.openToolsCompanion();
      },
    },
    // 애플리케이션 설정의 두 번째 진입점(Edit ▸ Preferences 와 같은 대화상자)은
    // 제거했다 — 메뉴당 한 문 원칙. 단일 행은 편집 메뉴가 소유한다.
  ];
}

export interface StudioHelpMenuItemsInput extends StudioMainMenuItemContext {
  /** "도움말" when the active locale pack is Korean, otherwise "Help". */
  readonly helpGroupLabel: string;
}

export function buildStudioHelpMenuItems({
  editor,
  ui,
  helpGroupLabel,
}: StudioHelpMenuItemsInput): StudioMainMenuItem[] {
  const korean = helpGroupLabel === "도움말";
  return [
    {
      id: "feature-tutorials",
      commandId: "help.feature-tutorials",
      label: "사용법 · 기능 튜토리얼",
      ...(korean ? {} : { labelKey: "studio.mainMenu.item.view.feature-tutorials" }),
      icon: BookOpen,
      onSelect: () => {
        editor.openFeatureTutorial();
      },
    },
    {
      id: "shortcuts",
      commandId: "help.shortcuts",
      label: "단축키 · 기본 조작",
      ...(korean ? {} : { labelKey: "studio.mainMenu.item.view.shortcuts" }),
      icon: Command,
      shortcut: "?",
      onSelect: () => {
        ui.openShortcuts();
      },
    },
  ];
}
