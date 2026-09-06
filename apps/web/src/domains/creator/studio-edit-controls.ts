/**
 * Pure Edit-menu contracts shared by StudioPage, keyboard routing, and tests.
 * These helpers only describe UI commands; document mutations remain in StudioPage.
 */

export const STUDIO_EDIT_MENU_COMMANDS = {
  undo: {
    id: "undo",
    label: "실행취소",
    labelKey: "studio.mainMenu.edit.command.undo",
    shortcut: "⌘Z",
  },
  redo: {
    id: "redo",
    label: "다시실행",
    labelKey: "studio.mainMenu.edit.command.redo",
    shortcut: "⌘⇧Z",
  },
  cut: {
    id: "cut",
    label: "잘라내기",
    labelKey: "studio.mainMenu.edit.command.cut",
    shortcut: "⌘X",
  },
  copy: {
    id: "copy",
    label: "복사",
    labelKey: "studio.mainMenu.edit.command.copy",
    shortcut: "⌘C",
  },
  paste: {
    id: "paste",
    label: "붙여넣기",
    labelKey: "studio.mainMenu.edit.command.paste",
    shortcut: "⌘V",
  },
  "paste-in-place": {
    id: "paste-in-place",
    label: "현재 위치에 붙여넣기",
    labelKey: "studio.mainMenu.edit.command.paste-in-place",
    shortcut: "⌘⇧V",
  },
  "paste-file": {
    id: "paste-file",
    label: "이미지 파일 붙여넣기…",
    labelKey: "studio.mainMenu.edit.command.paste-file",
  },
  "select-all": {
    id: "select-all",
    label: "모두 선택",
    labelKey: "studio.mainMenu.edit.command.select-all",
    shortcut: "⌘A",
  },
  deselect: {
    id: "deselect",
    label: "선택 해제",
    labelKey: "studio.mainMenu.edit.command.deselect",
    shortcut: "⌘D",
  },
  "invert-selection": {
    id: "invert-selection",
    label: "선택 반전",
    labelKey: "studio.mainMenu.edit.command.invert-selection",
    shortcut: "⌘⇧I",
  },
  "clear-selection": {
    id: "clear-selection",
    label: "선택 제거",
    labelKey: "studio.mainMenu.edit.command.clear-selection",
    shortcut: "Delete",
  },
  duplicate: {
    id: "duplicate",
    label: "복제",
    labelKey: "studio.mainMenu.edit.command.duplicate",
    shortcut: "⌘J",
  },
  "bring-front": {
    id: "bring-front",
    label: "레이어 · 맨 위로",
    labelKey: "studio.mainMenu.edit.command.bring-front",
    shortcut: "⌘⇧]",
  },
  "bring-forward": {
    id: "bring-forward",
    label: "레이어 · 위로",
    labelKey: "studio.mainMenu.edit.command.bring-forward",
    shortcut: "⌘]",
  },
  // Photoshop·클립스튜디오·일러스트레이터와 같은 배치: ⌘[ = 한 칸 뒤로, ⌘⇧[ = 맨 뒤로.
  // 바로 위 bring-front/bring-forward 쌍과 대칭이어야 한다(이전에는 뒤로 쌍만 뒤집혀 있었다).
  "send-back": {
    id: "send-back",
    label: "레이어 · 맨 뒤로",
    labelKey: "studio.mainMenu.edit.command.send-back",
    shortcut: "⌘⇧[",
  },
  "send-backward": {
    id: "send-backward",
    label: "레이어 · 뒤로",
    labelKey: "studio.mainMenu.edit.command.send-backward",
    shortcut: "⌘[",
  },
  "crop-layer": {
    id: "crop-layer",
    label: "레이어 자르기…",
    labelKey: "studio.mainMenu.edit.command.crop-layer",
  },
  history: { id: "history", label: "작업 내역", labelKey: "studio.mainMenu.edit.command.history" },
  "pen-pressure": { id: "pen-pressure", label: "펜 압력 설정…", labelKey: "studio.mainMenu.edit.command.pen-pressure" },
  "app-settings": { id: "app-settings", label: "애플리케이션 설정…", labelKey: "studio.mainMenu.edit.command.app-settings" },
} as const;

export type StudioEditMenuCommandId = keyof typeof STUDIO_EDIT_MENU_COMMANDS;

/** Canonical production order. Layer ordering is flat until the menu supports APG submenus. */
export const STUDIO_EDIT_MENU_COMMAND_ORDER: readonly StudioEditMenuCommandId[] = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "paste-in-place",
  "paste-file",
  "select-all",
  "deselect",
  "invert-selection",
  "clear-selection",
  "duplicate",
  "bring-front",
  "bring-forward",
  "send-back",
  "send-backward",
  "crop-layer",
  "history",
  "pen-pressure",
  "app-settings",
];

export interface StudioEditAvailabilityInput {
  historyIndex: number;
  historyLength: number;
  /**
   * 통합 실행취소 저널의 다음 ⌘Z 대상이 사이드카 편집(캐릭터 바이블·Writer Room)인가.
   *
   * 이 문서들은 `pagesHistory` 스냅샷에 들어가지 않는다. `historyIndex` 만 보면 방금 고친
   * 로그라인이 "되돌릴 편집 작업이 아직 없습니다"로 보여, 실제로 동작하는 ⌘Z 를 메뉴가
   * 막아 버린다.
   */
  sidecarUndoAvailable?: boolean;
  /** 위와 대칭 — 다음 ⇧⌘Z 대상이 사이드카 편집인가. */
  sidecarRedoAvailable?: boolean;
  /** 미확정(지연 커밋) 오버레이 획이 있어 ⌘Z 로 되돌릴 수 있는가. */
  pendingCommitAvailable?: boolean;
  /** 방금 ⌘Z 로 되돌린 미확정 오버레이 획이 있어 ⇧⌘Z 로 다시 적용할 수 있는가. */
  pendingUndoneAvailable?: boolean;
  documentEmpty: boolean;
  hasElementSelection: boolean;
  hasSingleElementSelection: boolean;
  /** A usable pixel mask, not merely an armed marquee/lasso tool. */
  hasPixelSelection: boolean;
  /** Pixel tool or mask exists and can be dismissed without mutating the document. */
  hasPixelEditing: boolean;
  pixelBusy: boolean;
  selectedImage: boolean;
  /**
   * Same gate as openSelectedLayerCrop and the left rail: a selected/sole editable image, or
   * visible page content that can be prepared as an editable raster copy before Crop opens.
   */
  rasterRetouchTargetAvailable: boolean;
  /** Temporary capture/playback state where even read-only selection must not inspect transient data. */
  interactionLocked: boolean;
  mutationLocked: boolean;
  selectedContentMutationLocked: boolean;
  masterEditMode: boolean;
}

export interface StudioEditAvailability {
  undoDisabled: boolean;
  redoDisabled: boolean;
  cutDisabled: boolean;
  copyDisabled: boolean;
  pasteDisabled: boolean;
  selectAllDisabled: boolean;
  deselectDisabled: boolean;
  invertSelectionDisabled: boolean;
  clearSelectionDisabled: boolean;
  duplicateDisabled: boolean;
  reorderDisabled: boolean;
  cropLayerDisabled: boolean;
}

/**
 * One availability matrix keeps menu affordances aligned with the handlers. Read-only commands
 * (copy, select, deselect, settings) stay available while document mutations are locked.
 */
export function resolveStudioEditAvailability(
  input: StudioEditAvailabilityInput
): StudioEditAvailability {
  const hasAnySelection = input.hasElementSelection || input.hasPixelSelection;
  const historyLocked = input.mutationLocked || input.masterEditMode;
  return {
    undoDisabled:
      historyLocked
      || (input.historyIndex <= 0 && !input.sidecarUndoAvailable && !input.pendingCommitAvailable),
    redoDisabled:
      historyLocked
      || (input.historyIndex >= input.historyLength - 1
        && !input.sidecarRedoAvailable
        && !input.pendingUndoneAvailable),
    cutDisabled: input.mutationLocked || !input.hasElementSelection,
    copyDisabled: input.interactionLocked || !input.hasElementSelection,
    pasteDisabled: input.mutationLocked,
    selectAllDisabled: input.interactionLocked || input.documentEmpty,
    deselectDisabled:
      input.interactionLocked || (!input.hasElementSelection && !input.hasPixelEditing),
    invertSelectionDisabled:
      input.interactionLocked || !input.selectedImage || !input.hasPixelSelection,
    clearSelectionDisabled:
      input.mutationLocked ||
      !hasAnySelection ||
      (input.hasPixelSelection && (input.pixelBusy || input.selectedContentMutationLocked)),
    duplicateDisabled: input.mutationLocked || !input.hasElementSelection,
    // 그룹/다중 선택도 PPT/Figma처럼 하나의 z-order 단위로 이동할 수 있다.
    reorderDisabled: input.mutationLocked || !input.hasElementSelection,
    // Align with openSelectedLayerCrop → ensureOrPrepareRasterRetouchTarget and the rail button.
    // Vector-only pages remain reachable because Crop can prepare one editable page composite.
    cropLayerDisabled: input.mutationLocked || !input.rasterRetouchTargetAvailable,
  };
}

export interface StudioEditShortcutEvent {
  code?: string;
  key?: string;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export type StudioEditShortcut =
  | "cut"
  | "copy"
  | "paste-in-place"
  | "select-all"
  | "deselect"
  | "invert-selection"
  | "duplicate"
  | "bring-front"
  | "bring-forward"
  | "send-back"
  | "send-backward";

function editEventCode(event: StudioEditShortcutEvent): string {
  if (event.code) return event.code;
  const key = event.key?.toLowerCase();
  if (key === "x") return "KeyX";
  if (key === "c") return "KeyC";
  if (key === "v") return "KeyV";
  if (key === "a") return "KeyA";
  if (key === "d") return "KeyD";
  if (key === "i") return "KeyI";
  if (key === "j") return "KeyJ";
  if (key === "[" || key === "{") return "BracketLeft";
  if (key === "]" || key === "}") return "BracketRight";
  return "";
}

/** Resolve only commands that must be handled on keydown. Plain paste remains a native paste event. */
export function resolveStudioEditShortcut(
  event: StudioEditShortcutEvent
): StudioEditShortcut | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.altKey ||
    (!event.metaKey && !event.ctrlKey)
  ) {
    return null;
  }

  const code = editEventCode(event);
  if (code === "KeyX" && !event.shiftKey) return "cut";
  if (code === "KeyC" && !event.shiftKey) return "copy";
  if (code === "KeyV" && event.shiftKey) return "paste-in-place";
  if (code === "KeyA" && !event.shiftKey) return "select-all";
  if (code === "KeyD" && !event.shiftKey) return "deselect";
  if (code === "KeyI" && event.shiftKey) return "invert-selection";
  if (code === "KeyJ" && !event.shiftKey) return "duplicate";
  // 두 브래킷 쌍은 반드시 대칭이다 — ⇧ 가 "맨 끝까지", 무수식이 "한 칸".
  if (code === "BracketRight") return event.shiftKey ? "bring-front" : "bring-forward";
  if (code === "BracketLeft") return event.shiftKey ? "send-back" : "send-backward";
  return null;
}

export interface StudioEditEventGuardInput {
  defaultPrevented?: boolean;
  composing?: boolean;
  typing?: boolean;
  editing?: boolean;
  insideShortcutBoundary?: boolean;
  modalOpen?: boolean;
  timelapseCapturing?: boolean;
  /**
   * The event is ⌘Z / ⌘⇧Z.
   *
   * History is the one command an artist expects to work from wherever their hands are. A panel
   * that claims its own shortcut scope — the layer navigator, the menu bar — should stop `B`, `E`
   * and `Delete` from reaching the document, but swallowing undo makes the app feel broken: two
   * independent audits measured ⌘Z doing nothing at all, once with focus in the layer panel and
   * once right after a filter dialog handed focus back to its menu trigger.
   *
   * This deliberately does NOT reach past `typing`/`editing` (there ⌘Z means "undo my text") or
   * past `modalOpen` (a modal's first frame must not let undo hit the document behind it).
   */
  undoRedoIntent?: boolean;
}

/** Shared by keydown and paste so neither can mutate the canvas behind menus, fields, or modals. */
export function shouldHandleStudioEditEvent(input: StudioEditEventGuardInput): boolean {
  const boundaryBlocks = Boolean(input.insideShortcutBoundary) && !input.undoRedoIntent;
  return !(
    input.defaultPrevented ||
    input.composing ||
    input.typing ||
    input.editing ||
    boundaryBlocks ||
    input.modalOpen ||
    input.timelapseCapturing
  );
}

/** True for the history chord, whichever platform modifier the artist used. */
export function isStudioUndoRedoChord(event: {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  return typeof event.key === "string" && event.key.toLowerCase() === "z";
}

export interface StudioPasteScopeInput {
  mutationAllowed: boolean;
  reviewLocked: boolean;
  targetPageId: string;
  currentPageId: string;
  targetMasterEditMode: boolean;
  currentMasterEditMode: boolean;
}

/** Re-check every non-document UI scope after an async clipboard or image decode boundary. */
export function isStudioPasteScopeCurrent(input: StudioPasteScopeInput): boolean {
  return input.mutationAllowed &&
    !input.reviewLocked &&
    input.targetPageId === input.currentPageId &&
    input.targetMasterEditMode === input.currentMasterEditMode;
}
