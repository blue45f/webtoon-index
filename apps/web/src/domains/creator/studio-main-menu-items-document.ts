/**
 * §15.3 document groups — File, Edit, View, Canvas.
 *
 * Behaviour is carried over verbatim from the pre-regroup catalogue; only the
 * group an item lives in changed. Items that moved carry `legacyPath` so their
 * translation keys and disabled-reason copy stay byte-identical across the 75
 * shipped locale packs.
 */

import {
  Bookmark,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  Download,
  FileUp,
  Files,
  FlipHorizontal2,
  Folder,
  GanttChartSquare,
  History as HistoryIcon,
  ImagePlus,
  Maximize2,
  Minimize2,
  Minus,
  Package,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  ScanLine,
  Scissors,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Triangle,
  Undo2,
  Upload,
} from "lucide-react";

import { STUDIO_EDIT_MENU_COMMANDS } from "./studio-edit-controls";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export function buildStudioFileMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  // CSP / PowerPoint: save & open first, then export/share (not export-first).
  return [
    {
      id: "save-draft",
      commandId: "file.save-draft",
      label: state.sharedNonOwnerSave ? "공동 저장" : "초안 저장",
      icon: Bookmark,
      shortcut: "⌘S",
      disabled: state.saving || state.collaborationDocumentLocked,
      onSelect: () => {
        void editor.save("draft");
      },
    },
    {
      id: "publish",
      commandId: "file.publish",
      label: state.hasWorkId ? "수정 게시" : "게시",
      icon: Upload,
      disabled:
        state.saving
        || state.collaborationDocumentLocked
        || state.sharedNonOwnerSave,
      separatorAfter: true,
      onSelect: () => {
        void editor.save("published");
      },
    },
    {
      id: "import-json",
      commandId: "file.import-project",
      label: "프로젝트 가져오기…",
      icon: FileUp,
      disabled: state.collaborationDocumentLocked,
      onSelect: () => {
        ui.requestProjectImport();
      },
    },
    {
      id: "import-psd",
      commandId: "file.import-psd",
      label: "PSD 가져오기…",
      icon: FileUp,
      disabled: state.psdImportBusy || state.collaborationDocumentLocked,
      onSelect: () => {
        ui.requestPsdImport();
      },
    },
    {
      id: "import-ora-cbz",
      commandId: "file.import-interchange",
      label: "ORA · CBZ · WILL 가져오기…",
      icon: Package,
      disabled: state.interchangeImportBusy || state.collaborationDocumentLocked,
      separatorAfter: true,
      onSelect: () => {
        ui.requestInterchangeImport();
      },
    },
    {
      id: "project",
      commandId: "file.project-tools",
      label: "프로젝트 센터…",
      icon: Folder,
      separatorAfter: true,
      onSelect: () => {
        ui.openProjectTools();
      },
    },
    {
      id: "export",
      commandId: "file.export",
      label: "내보내기 / 다운로드",
      icon: Download,
      onSelect: () => {
        ui.openExportDownload();
      },
    },
    {
      id: "copy-image",
      commandId: "file.copy-image-to-clipboard",
      label: "이미지를 클립보드로",
      icon: Copy,
      separatorAfter: true,
      onSelect: () => {
        void editor.copyImageToClipboard();
      },
    },
    {
      id: "export-json",
      commandId: "file.export-backup",
      label: "백업 (.json)",
      icon: Download,
      onSelect: () => {
        editor.exportProject();
      },
    },
    {
      id: "export-archive",
      commandId: "file.export-archive",
      label: "아카이브 백업",
      icon: Package,
      disabled: state.projectArchiveBusy,
      onSelect: () => {
        void editor.exportProjectArchive();
      },
    },
  ];
}

export function buildStudioEditMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      ...STUDIO_EDIT_MENU_COMMANDS.undo,
      commandId: "edit.undo",
      icon: Undo2,
      disabled: state.edit.undoDisabled,
      onSelect: () => {
        editor.undo();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.redo,
      commandId: "edit.redo",
      icon: Redo2,
      disabled: state.edit.redoDisabled,
      separatorAfter: true,
      onSelect: () => {
        editor.redo();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.cut,
      commandId: "edit.cut",
      icon: Scissors,
      disabled: state.edit.cutDisabled,
      onSelect: () => {
        editor.cutSelectedElements();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.copy,
      commandId: "edit.copy",
      icon: Copy,
      disabled: state.edit.copyDisabled,
      onSelect: () => {
        editor.copySelectedElements();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.paste,
      commandId: "edit.paste",
      icon: ClipboardPaste,
      disabled: state.edit.pasteDisabled,
      onSelect: () => {
        void editor.pasteElements("cascade");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["paste-in-place"],
      commandId: "edit.paste-in-place",
      icon: ClipboardCheck,
      disabled: state.edit.pasteDisabled,
      onSelect: () => {
        void editor.pasteElements("in-place");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["paste-file"],
      commandId: "edit.paste-file",
      icon: ImagePlus,
      disabled: state.edit.pasteDisabled,
      separatorAfter: true,
      onSelect: () => {
        editor.openImagePastePicker();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["clear-selection"],
      commandId: "edit.clear-selection",
      icon: Trash2,
      danger: true,
      disabled: state.edit.clearSelectionDisabled,
      onSelect: () => {
        editor.clearSelection();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.duplicate,
      commandId: "edit.duplicate",
      icon: Files,
      disabled: state.edit.duplicateDisabled,
      separatorAfter: true,
      onSelect: () => {
        editor.duplicateSelected();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.history,
      commandId: "edit.history",
      icon: HistoryIcon,
      separatorAfter: true,
      onSelect: () => {
        ui.toggleHistoryPanel();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["pen-pressure"],
      commandId: "edit.pen-pressure",
      icon: SlidersHorizontal,
      onSelect: () => {
        ui.openAppSettings("other");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["app-settings"],
      commandId: "window.app-settings",
      icon: Settings2,
      onSelect: () => {
        ui.openAppSettings("general");
      },
    },
  ];
}

export function buildStudioViewMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "zoom-in",
      commandId: "view.zoom-in",
      label: "확대",
      icon: Plus,
      shortcut: "=",
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        ui.stepZoom(1);
      },
    },
    {
      id: "zoom-out",
      commandId: "view.zoom-out",
      label: "축소",
      icon: Minus,
      shortcut: "-",
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        ui.stepZoom(-1);
      },
    },
    {
      id: "flip-horizontal",
      commandId: "view.flip-horizontal",
      label: "수평 반전",
      icon: FlipHorizontal2,
      shortcut: "H",
      checked: state.canvasFlipH,
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.toggleHorizontalCanvasView();
      },
    },
    {
      id: "rotate-left",
      commandId: "view.rotate-left",
      label: "왼쪽으로 90° 회전",
      icon: RotateCcw,
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.rotateCanvasView("left");
      },
    },
    {
      id: "rotate-right",
      commandId: "view.rotate-right",
      label: "오른쪽으로 90° 회전",
      icon: RotateCw,
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.rotateCanvasView("right");
      },
    },
    {
      id: "reset-rotation",
      commandId: "view.reset-rotation",
      label: `보기 회전 초기화 (${state.canvasRotation}°)`,
      icon: HistoryIcon,
      disabled: state.viewTransformSuppressed || state.canvasRotation === 0,
      separatorAfter: true,
      onSelect: () => {
        editor.resetCanvasViewRotation();
      },
    },
    {
      id: "fit",
      commandId: "view.fit-width",
      label: "화면에 맞게 조정",
      icon: ScanLine,
      shortcut: "Home",
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.fitCanvasToWidth();
      },
    },
    {
      id: "actual-pixels",
      commandId: "view.actual-pixels",
      label: "실제 픽셀 (100%)",
      icon: Maximize2,
      shortcut: "End",
      disabled: state.viewTransformSuppressed,
      separatorAfter: true,
      onSelect: () => {
        editor.setActualPixelView();
      },
    },
    {
      id: "fullscreen",
      commandId: "view.fullscreen",
      label: "전체화면",
      icon: state.fullscreen ? Minimize2 : Maximize2,
      shortcut: "F11",
      checked: state.fullscreen,
      disabled: state.viewTransformSuppressed,
      separatorAfter: true,
      onSelect: () => {
        editor.toggleFullscreen();
      },
    },
    // 흑백 명암은 `Q` 가 아니라 `⌥Q` 다. 단독 `Q` 는 퀵 마스크가 가져갔고(conflict
    // `q-quickmask-vs-grayscale`), 두 메뉴 행이 같은 배지를 달고 선택 상태에 따라
    // 서로 다른 명령을 실행하던 상태를 끊는다. `⇧Q` 는 빠른 액세스 팔레트가 쓴다.
    ...(
      [
        { id: "original", label: "색각 검수 · 원본", mode: "none" as const },
        { id: "grayscale", label: "색각 검수 · 흑백 명암", mode: "grayscale" as const, shortcut: "⌥Q" },
        { id: "protanopia", label: "색각 검수 · 1형 적록", mode: "protanopia" as const },
        { id: "deuteranopia", label: "색각 검수 · 2형 적록", mode: "deuteranopia" as const },
        { id: "tritanopia", label: "색각 검수 · 3형 청황", mode: "tritanopia" as const },
      ] as const
    ).map(({ id, label, mode, ...shortcut }) => ({
      id: `color-vision-${id}`,
      commandId: `view.color-vision-${id}`,
      label,
      icon: Palette,
      hintKey: `color-vision:${mode}` as const,
      ...shortcut,
      checked: state.colorVisionMode === mode,
      selectionRole: "radio" as const,
      disabled: state.viewTransformSuppressed,
      unavailableReason: state.viewTransformSuppressed
        ? "보기 변환이 잠긴 동안에는 색각 검수 모드를 바꿀 수 없습니다."
        : undefined,
      separatorAfter: mode === "tritanopia",
      onSelect: () => {
        editor.setColorVisionMode(mode);
      },
    })),
    {
      id: "save-current-view",
      commandId: "view.save-current-view",
      label: "현재 보기 저장",
      icon: Bookmark,
      shortcut: "⇧S",
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.saveCurrentStudioView();
      },
    },
    {
      id: "restore-view",
      commandId: "view.restore-view",
      label: "보기 복원",
      icon: HistoryIcon,
      shortcut: "⇧Z",
      disabled: state.viewTransformSuppressed || !state.hasSavedView,
      separatorAfter: true,
      onSelect: () => {
        editor.restoreSavedStudioView();
      },
    },
    // 검수·미리보기 3종(타임라인·세로 스크롤·스토리보드)은 View에서 제거했다 —
    // 같은 핸들러의 문이 Animation ▸ 타임라인, Comic ▸ 스토리보드/세로 스크롤,
    // 그리고 "프로젝트 센터" 시트(터치 경로)에 이미 있어 메뉴당 한 문 원칙을 따른다.
    {
      id: "production-insights",
      commandId: "view.production-insights",
      label: "제작 인사이트…",
      icon: GanttChartSquare,
      onSelect: () => {
        ui.openProductionInsights();
      },
    },
  ];
}

/** Canvas — overlays that sit on the artboard. Both items moved out of View. */
export function buildStudioCanvasMenuItems({
  state,
  editor,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "canvas-rulers",
      commandId: "view.canvas-rulers",
      legacyPath: "view/canvas-rulers",
      label: "캔버스 px 눈금자",
      icon: Ruler,
      shortcut: "⌥⌘R",
      checked: state.canvasRulersVisible,
      onSelect: () => {
        editor.toggleCanvasRulers();
      },
    },
    {
      id: "perspective-guide",
      commandId: "view.perspective-guide",
      legacyPath: "view/perspective-guide",
      label: "원근 도우미 보기",
      icon: Triangle,
      shortcut: "⇧G",
      checked: state.perspectiveRulerActive,
      disabled: state.viewTransformSuppressed,
      onSelect: () => {
        editor.togglePerspectiveGuideView();
      },
    },
  ];
}
