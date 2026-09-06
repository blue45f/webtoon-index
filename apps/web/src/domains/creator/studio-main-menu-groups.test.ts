import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMMAND_CATALOG,
  STUDIO_MENU_ITEM_INVENTORY,
} from "./studio-command-catalog";
import {
  buildStudioMainMenuGroups,
  type StudioMainMenuBuilderState,
  type StudioMainMenuEditAvailability,
  type StudioMainMenuEditorActions,
  type StudioMainMenuUiActions,
} from "./studio-main-menu-groups";

import type {
  StudioMainMenuGroup,
  StudioMainMenuItem,
} from "./studio-main-menu-model";
import type { CommandId } from "@toonspectrum/studio-command-registry";

const AVAILABLE_EDIT_ACTIONS: StudioMainMenuEditAvailability = {
  undoDisabled: false,
  redoDisabled: false,
  cutDisabled: false,
  copyDisabled: false,
  pasteDisabled: false,
  selectAllDisabled: false,
  deselectDisabled: false,
  invertSelectionDisabled: false,
  clearSelectionDisabled: false,
  duplicateDisabled: false,
  reorderDisabled: false,
  cropLayerDisabled: false,
};

const BASE_STATE: StudioMainMenuBuilderState = {
  sharedNonOwnerSave: false,
  saving: false,
  collaborationDocumentLocked: false,
  hasWorkId: false,
  projectArchiveBusy: false,
  interchangeImportBusy: false,
  psdImportBusy: false,
  edit: AVAILABLE_EDIT_ACTIONS,
  filterDisabled: false,
  filterUnavailableReason: null,
  viewTransformSuppressed: false,
  canvasFlipH: false,
  canvasRotation: 0,
  fullscreen: false,
  canvasRulersVisible: true,
  colorVisionMode: "none",
  referencePanelOpen: false,
  pageSequenceOpen: false,
  hasSavedView: false,
  perspectiveRulerActive: false,
  hasLocallyHiddenLayers: false,
  quickAccessPaletteOpen: false,
  quickAccessPaletteLoading: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  lastFilterDraft: null,
  clippingMaskActive: false,
  clippingMaskDisabled: false,
  imageLayerSelected: true,
  activeToolCommandId: "tool.pen",
  pixelSelectionTool: null,
  quickMaskActive: false,
  animationTimelineOpen: false,
  onionSkinEnabled: false,
  documentCommentsOpen: false,
  canvasGridVisible: false,
  vectorEraseToIntersection: false,
  masterEditMode: false,
  pixelArtEnabled: false,
};

function createEditorActions(): StudioMainMenuEditorActions {
  return {
    copyImageToClipboard: vi.fn(),
    save: vi.fn(),
    exportProject: vi.fn(),
    exportProjectArchive: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cutSelectedElements: vi.fn(),
    copySelectedElements: vi.fn(),
    pasteElements: vi.fn(),
    openImagePastePicker: vi.fn(),
    selectAll: vi.fn(),
    deselect: vi.fn(),
    invertSelection: vi.fn(),
    clearSelection: vi.fn(),
    duplicateSelected: vi.fn(),
    reorder: vi.fn(),
    openSelectedLayerCrop: vi.fn(),
    toggleClippingMask: vi.fn(),
    addText: vi.fn(),
    addPage: vi.fn(),
    toggleHorizontalCanvasView: vi.fn(),
    rotateCanvasView: vi.fn(),
    resetCanvasViewRotation: vi.fn(),
    fitCanvasToWidth: vi.fn(),
    setActualPixelView: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleCanvasRulers: vi.fn(),
    setColorVisionMode: vi.fn(),
    saveCurrentStudioView: vi.fn(),
    restoreSavedStudioView: vi.fn(),
    togglePerspectiveGuideView: vi.fn(),
    showAllLocallyHiddenLayers: vi.fn(),
    setStudioUiDensity: vi.fn(),
    enterCanvasOnlyMode: vi.fn(),
    openFeatureTutorial: vi.fn(),
    openStudioFilter: vi.fn(),
    toggleAdvancedFill: vi.fn(),
  };
}

function createUiActions(): StudioMainMenuUiActions {
  return {
    openExportDownload: vi.fn(),
    requestProjectImport: vi.fn(),
    requestInterchangeImport: vi.fn(),
    requestPsdImport: vi.fn(),
    openProjectTools: vi.fn(),
    toggleHistoryPanel: vi.fn(),
    openAppSettings: vi.fn(),
    openStudioMenu: vi.fn(),
    openAssetMenu: vi.fn(),
    requestImageInsert: vi.fn(),
    openMannequinPoser: vi.fn(),
    openVrmPoser: vi.fn(),
    openCharacterShaper: vi.fn(),
    openBackground3d: vi.fn(),
    openReferencePanel: vi.fn(),
    stepZoom: vi.fn(),
    toggleReferencePanel: vi.fn(),
    togglePageSequence: vi.fn(),
    openProductionInsights: vi.fn(),
    toggleAnimationTimeline: vi.fn(),
    openScrollPreview: vi.fn(),
    openStoryboardGrid: vi.fn(),
    collapseSidePanels: vi.fn(),
    expandSidePanels: vi.fn(),
    openToolsCompanion: vi.fn(),
    toggleQuickAccessPalette: vi.fn(),
    toggleLeftPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    openShortcuts: vi.fn(),
    selectDrawMode: vi.fn(),
    enableSmartShape: vi.fn(),
    activateTransformTool: vi.fn(),
    openImageAdjustments: vi.fn(),
    openLayerMask: vi.fn(),
    openBrushPresetBrowser: vi.fn(),
    openBrushStudio: vi.fn(),
    openBrushLibrary: vi.fn(),
    requestBrushPackImport: vi.fn(),
    openNaturalMediaBrushes: vi.fn(),
    activatePixelSelectionTool: vi.fn(),
    enterQuickMask: vi.fn(),
    commitQuickMask: vi.fn(),
    openFrameAnimation: vi.fn(),
    toggleOnionSkin: vi.fn(),
    openAnimaticTimeline: vi.fn(),
    openTeamPanel: vi.fn(),
    toggleDocumentComments: vi.fn(),
    openPageReview: vi.fn(),
    openCheckpoints: vi.fn(),
    openWriterRoom: vi.fn(),
    openContinuityCheck: vi.fn(),
    openProductionBible: vi.fn(),
    openQuickStart: vi.fn(),
    openPublishPackage: vi.fn(),
    openPublishPreflight: vi.fn(),
    openAssetRightsAudit: vi.fn(),
    openAutoActions: vi.fn(),
    openCanvasNavigator: vi.fn(),
    openCanvasSettings: vi.fn(),
    toggleCanvasGrid: vi.fn(),
    toggleVectorEraseToIntersection: vi.fn(),
    openDialogueBatch: vi.fn(),
    openDialogueTranslate: vi.fn(),
    openLocalizationQa: vi.fn(),
    togglePixelArtMode: vi.fn(),
    insertDefaultStickyNote: vi.fn(),
    enableSilkSymmetry: vi.fn(),
    openSculptWorkbench: vi.fn(),
    startEphemeralWhiteboard: vi.fn(),
  };
}

type StateOverrides = Partial<Omit<StudioMainMenuBuilderState, "edit">> & {
  edit?: Partial<StudioMainMenuEditAvailability>;
};

function buildMenu(
  stateOverrides: StateOverrides = {},
  translate: (key: string) => string = (key) => key,
) {
  const editor = createEditorActions();
  const ui = createUiActions();
  const state: StudioMainMenuBuilderState = {
    ...BASE_STATE,
    ...stateOverrides,
    edit: {
      ...AVAILABLE_EDIT_ACTIONS,
      ...stateOverrides.edit,
    },
  };
  const groups = buildStudioMainMenuGroups({
    state,
    editor,
    ui,
    t: translate,
  });
  return { editor, groups, ui };
}

function menuItem(
  groups: readonly StudioMainMenuGroup[],
  groupId: string,
  itemId: string,
): StudioMainMenuItem {
  const group = groups.find((candidate) => candidate.id === groupId);
  const item = group?.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Missing menu item: ${groupId}/${itemId}`);
  return item;
}

describe("buildStudioMainMenuGroups", () => {
  it("keeps the new Help group localized by reusing the established item keys", () => {
    const english = buildMenu({}, (key) => ({
      "studio.mainMenu.item.view.feature-tutorials": "Feature tutorials",
      "studio.mainMenu.item.view.shortcuts": "Shortcut help",
    }[key] ?? key)).groups;
    const korean = buildMenu({}, (key) => ({
      "studio.mainMenu.item.view.feature-tutorials": "기능 튜토리얼",
      "studio.mainMenu.item.view.shortcuts": "단축키 도움말",
    }[key] ?? key)).groups;

    expect(english.find((group) => group.id === "help")?.label).toBe("Help");
    // Groups the §15.3 regroup introduced have no shipped group-label key yet, so
    // they fall back to English rather than showing Korean to everyone.
    expect(english.find((group) => group.id === "layer")?.label).toBe("Layer");
    expect(english.find((group) => group.id === "window")?.label).toBe("Window");
    expect(korean.find((group) => group.id === "layer")?.label).toBe("레이어");
    expect(menuItem(english, "help", "feature-tutorials").label).toBe("Feature tutorials");
    expect(menuItem(english, "help", "shortcuts").label).toBe("Shortcut help");
    expect(korean.find((group) => group.id === "help")?.label).toBe("도움말");
    expect(menuItem(korean, "help", "feature-tutorials").label).toBe("사용법 · 기능 튜토리얼");
    expect(menuItem(korean, "help", "shortcuts").label).toBe("단축키 · 기본 조작");
  });

  it("preserves the complete group and item order", () => {
    const { groups } = buildMenu();

    expect(groups.map((group) => group.id)).toEqual([
      "file",
      "edit",
      "view",
      "canvas",
      "layer",
      "select",
      "transform",
      "brush",
      "filter",
      "vector",
      "text",
      "comic",
      "animation",
      "3d",
      "collaboration",
      "window",
      "ai",
      "help",
    ]);
    // Item order is pinned once, in `STUDIO_MENU_ITEM_INVENTORY`. Repeating the
    // whole list here made the two copies drift every time a §15.3 row landed,
    // so this asserts the grouping instead: each group's items, in order, are
    // exactly the inventory's entries for that group, in order.
    const inventoryByGroup = new Map<string, string[]>();
    for (const qualified of STUDIO_MENU_ITEM_INVENTORY) {
      const [group = "", item = ""] = qualified.split("/");
      inventoryByGroup.set(group, [...(inventoryByGroup.get(group) ?? []), item]);
    }
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual(
      groups.map((group) => inventoryByGroup.get(group.id) ?? []),
    );
  });

  it("keeps every menu item id globally unique (audit finding menu-item-id-collision)", () => {
    const { groups } = buildMenu();
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));

    expect(new Set(ids).size).toBe(ids.length);
    // Preferences 는 편집 메뉴 단일 행만 남는다 — 창 그룹의 두 번째 진입점은 제거됐다.
    expect(menuItem(groups, "edit", "app-settings").label).toBe("애플리케이션 설정…");
    const windowIds = groups.find((group) => group.id === "window")?.items.map(
      (item) => item.id,
    );
    expect(windowIds).not.toContain("app-settings-window");
  });

  it("keeps relocated items on the locale keys the 75 shipped packs were authored against", () => {
    const dictionary = {
      "studio.mainMenu.item.view.left-panel.open": "Hide left panel",
      "studio.mainMenu.item.view.canvas-rulers": "Canvas rulers",
      "studio.mainMenu.item.view.reset-local-visibility": "Show layers I hid",
      "studio.mainMenu.item.view.page-sequence.open": "Close page sequence",
      "studio.mainMenu.item.insert.bg3d": "3D background",
      "studio.mainMenu.item.insert.page": "New page",
      "studio.mainMenu.item.draw.pen": "Pen",
      "studio.mainMenu.edit.command.select-all": "Select all",
      "studio.mainMenu.edit.command.bring-front": "Bring to front",
      "studio.mainMenu.group.draw.label": "Brush",
    } as const;
    const { groups } = buildMenu(
      { leftPanelOpen: true, pageSequenceOpen: true },
      (key) => (dictionary as Record<string, string>)[key] ?? key,
    );

    expect(menuItem(groups, "window", "left-panel").label).toBe("Hide left panel");
    expect(menuItem(groups, "canvas", "canvas-rulers").label).toBe("Canvas rulers");
    expect(menuItem(groups, "layer", "reset-local-visibility").label).toBe("Show layers I hid");
    expect(menuItem(groups, "comic", "page-sequence").label).toBe("Close page sequence");
    expect(menuItem(groups, "3d", "bg3d").label).toBe("3D background");
    expect(menuItem(groups, "comic", "page").label).toBe("New page");
    expect(menuItem(groups, "brush", "pen").label).toBe("Pen");
    expect(menuItem(groups, "select", "select-all").label).toBe("Select all");
    expect(menuItem(groups, "layer", "bring-front").label).toBe("Bring to front");
    // The Brush group reuses the shipped `draw` group-label key.
    expect(groups.find((group) => group.id === "brush")?.label).toBe("Brush");
  });

  it("keeps relocated items on the disabled-reason copy they were authored with", () => {
    const { groups } = buildMenu({
      collaborationDocumentLocked: true,
      hasLocallyHiddenLayers: false,
      viewTransformSuppressed: false,
      edit: Object.fromEntries(
        Object.keys(AVAILABLE_EDIT_ACTIONS).map((key) => [key, true]),
      ) as unknown as StudioMainMenuEditAvailability,
    });

    expect(menuItem(groups, "select", "select-all").unavailableReason).toBe(
      "현재 페이지에 선택할 요소가 없거나 상호작용이 잠겨 있습니다.",
    );
    expect(menuItem(groups, "layer", "send-backward").unavailableReason).toBe(
      "순서를 바꿀 요소 하나를 선택하고 문서 편집 잠금을 해제하세요.",
    );
    expect(menuItem(groups, "layer", "crop-layer").unavailableReason).toBe(
      "편집 가능한 이미지 레이어가 필요합니다.",
    );
    expect(menuItem(groups, "layer", "reset-local-visibility").unavailableReason).toBe(
      "나만 숨긴 레이어가 없습니다.",
    );
    expect(menuItem(groups, "comic", "page").unavailableReason).toBe(
      "현재 문서가 협업 잠금 상태라 새 페이지를 추가할 수 없습니다.",
    );
  });

  it("points every menu item at a command that exists in the catalog", () => {
    const { groups } = buildMenu();
    const known = new Set(STUDIO_COMMAND_CATALOG.map((entry) => entry.id));
    const items = groups.flatMap((group) =>
      group.items.map((item) => ({ id: `${group.id}/${item.id}`, commandId: item.commandId })),
    );

    expect(items.filter((item) => !item.commandId)).toEqual([]);
    expect(
      items.filter((item) => item.commandId && !known.has(item.commandId as CommandId)),
    ).toEqual([]);
    expect(items).toHaveLength(STUDIO_MENU_ITEM_INVENTORY.length);
    expect(items.map((item) => item.id)).toEqual([...STUDIO_MENU_ITEM_INVENTORY]);
  });

  it("projects document, collaboration, edit, and view state without changing semantics", () => {
    const lastFilterDraft = { kind: "gaussian-blur" as const, radius: 12 };
    const { groups } = buildMenu({
      sharedNonOwnerSave: true,
      saving: true,
      collaborationDocumentLocked: true,
      hasWorkId: true,
      projectArchiveBusy: true,
      interchangeImportBusy: true,
      psdImportBusy: true,
      edit: Object.fromEntries(
        Object.keys(AVAILABLE_EDIT_ACTIONS).map((key) => [key, true]),
      ) as unknown as StudioMainMenuEditAvailability,
      filterDisabled: true,
      filterUnavailableReason: "저장이 끝난 뒤 필터를 적용하세요.",
      viewTransformSuppressed: true,
      canvasFlipH: true,
      canvasRotation: 90,
      fullscreen: true,
      canvasRulersVisible: false,
      colorVisionMode: "deuteranopia",
      referencePanelOpen: true,
      pageSequenceOpen: true,
      hasSavedView: true,
      perspectiveRulerActive: true,
      hasLocallyHiddenLayers: true,
      quickAccessPaletteOpen: true,
      quickAccessPaletteLoading: true,
      leftPanelOpen: false,
      rightPanelOpen: false,
      lastFilterDraft,
    });

    expect(menuItem(groups, "file", "save-draft")).toMatchObject({
      label: "공동 저장",
      disabled: true,
    });
    expect(menuItem(groups, "file", "publish")).toMatchObject({
      label: "수정 게시",
      disabled: true,
    });
    expect(menuItem(groups, "file", "export-archive").disabled).toBe(true);
    expect(menuItem(groups, "file", "import-psd").disabled).toBe(true);
    expect(menuItem(groups, "file", "import-ora-cbz").disabled).toBe(true);
    expect(menuItem(groups, "comic", "page").disabled).toBe(true);

    for (const [groupId, itemId] of [
      ["edit", "undo"],
      ["edit", "redo"],
      ["edit", "cut"],
      ["edit", "copy"],
      ["edit", "paste"],
      ["edit", "paste-in-place"],
      ["edit", "paste-file"],
      ["edit", "clear-selection"],
      ["edit", "duplicate"],
      ["select", "select-all"],
      ["select", "deselect"],
      ["select", "invert-selection"],
      ["layer", "bring-front"],
      ["layer", "bring-forward"],
      ["layer", "send-back"],
      ["layer", "send-backward"],
      ["layer", "crop-layer"],
    ] as const) {
      expect(menuItem(groups, groupId, itemId).disabled, itemId).toBe(true);
    }

    expect(menuItem(groups, "view", "flip-horizontal")).toMatchObject({
      checked: true,
      disabled: true,
    });
    expect(menuItem(groups, "view", "fullscreen")).toMatchObject({
      checked: true,
      disabled: true,
    });
    expect(menuItem(groups, "canvas", "canvas-rulers")).toMatchObject({
      label: "캔버스 px 눈금자",
      checked: false,
      shortcut: "⌥⌘R",
    });
    expect(menuItem(groups, "view", "color-vision-deuteranopia")).toMatchObject({
      checked: true,
      disabled: true,
      selectionRole: "radio",
      hintKey: "color-vision:deuteranopia",
    });
    expect(menuItem(groups, "view", "color-vision-original").checked).toBe(false);
    for (const [id, previewVariant] of [
      ["original", "none"],
      ["grayscale", "grayscale"],
      ["protanopia", "protanopia"],
      ["deuteranopia", "deuteranopia"],
      ["tritanopia", "tritanopia"],
    ] as const) {
      expect(menuItem(groups, "view", `color-vision-${id}`)).toMatchObject({
        selectionRole: "radio",
        hintKey: `color-vision:${previewVariant}`,
      });
    }
    expect(menuItem(groups, "window", "reference-window").checked).toBe(true);
    expect(menuItem(groups, "comic", "page-sequence")).toMatchObject({
      label: "페이지 시퀀스 닫기",
      checked: true,
    });
    expect(menuItem(groups, "view", "reset-rotation")).toMatchObject({
      label: "보기 회전 초기화 (90°)",
      disabled: true,
    });
    expect(menuItem(groups, "view", "restore-view").disabled).toBe(true);
    expect(menuItem(groups, "canvas", "perspective-guide").checked).toBe(true);
    expect(menuItem(groups, "layer", "reset-local-visibility").disabled).toBe(false);
    expect(menuItem(groups, "window", "quick-access-palette")).toMatchObject({
      label: "빠른 액세스 불러오는 중…",
      shortcut: "⇧Q",
      checked: true,
      disabled: true,
    });
    expect(menuItem(groups, "window", "left-panel").label).toBe("왼쪽 패널 보이기");
    // 계약 변경(2026-09-04). PR #517 이 패널 헤더·aria 라벨만 "작업 패널"로 바꾸고
    // 이 행과 명령 카탈로그는 "속성 패널"에 남겨 두는 바람에, 통합 검색이 화면에 보이는
    // 이름으로는 이 패널을 찾지 못했다("작업 패널" 0건 / "속성 패널" 2건). 이름이 갈라진
    // 쪽은 메뉴·명령이므로 여기 pin 을 화면 이름으로 옮긴다. 예전 이름은
    // `studio-command-catalog.ts` 의 `window.right-panel` 검색 별칭으로 계속 잡힌다.
    expect(menuItem(groups, "window", "right-panel").label).toBe("작업 패널 보이기");
    expect(menuItem(groups, "filter", "last-filter")).toMatchObject({
      label: "마지막 필터 다시 열기",
      disabled: true,
      unavailableReason: "저장이 끝난 뒤 필터를 적용하세요.",
    });
    expect(menuItem(groups, "filter", "color-curves")).toMatchObject({
      disabled: true,
      unavailableReason: "저장이 끝난 뒤 필터를 적용하세요.",
    });
  });

  it("gives every disabled command an actionable unavailable reason", () => {
    const { groups } = buildMenu({
      sharedNonOwnerSave: true,
      saving: true,
      collaborationDocumentLocked: true,
      projectArchiveBusy: true,
      interchangeImportBusy: true,
      psdImportBusy: true,
      edit: Object.fromEntries(
        Object.keys(AVAILABLE_EDIT_ACTIONS).map((key) => [key, true]),
      ) as unknown as StudioMainMenuEditAvailability,
      filterDisabled: true,
      filterUnavailableReason: "현재 문서 검사가 끝난 뒤 필터를 적용하세요.",
      viewTransformSuppressed: true,
      quickAccessPaletteLoading: true,
    });
    const disabledItems = groups.flatMap((group) =>
      group.items
        .filter((item) => item.disabled)
        .map((item) => ({ groupId: group.id, item }))
    );

    expect(disabledItems.length).toBeGreaterThan(20);
    for (const { groupId, item } of disabledItems) {
      expect(
        item.unavailableReason?.trim(),
        `${groupId}/${item.id} should explain why it is unavailable`,
      ).toBeTruthy();
    }
    expect(menuItem(groups, "file", "publish").unavailableReason).toContain(
      "협업 잠금"
    );
    expect(menuItem(groups, "select", "invert-selection").unavailableReason).toContain(
      "픽셀 선택"
    );
    expect(menuItem(groups, "view", "restore-view").unavailableReason).toContain(
      "보기 변환"
    );
  });

  it("검수·미리보기 3종은 Animation/Comic 의 단일 행이 주입된 ui 액션으로 보낸다", () => {
    // View 중복 행은 제거됐다 — 메뉴당 한 문 원칙. 여기서 어긋나면 메뉴에는 보이지만
    // 아무것도 열지 않는, 도달성 테스트가 잡지 못하는 종류의 회귀가 된다(버튼은 가시하니까).
    const { groups, ui } = buildMenu();

    menuItem(groups, "animation", "timeline").onSelect();
    menuItem(groups, "comic", "scroll-preview").onSelect();
    menuItem(groups, "comic", "storyboard").onSelect();

    expect(ui.toggleAnimationTimeline).toHaveBeenCalledOnce();
    expect(ui.openScrollPreview).toHaveBeenCalledOnce();
    expect(ui.openStoryboardGrid).toHaveBeenCalledOnce();
  });

  it("보기 메뉴에는 검수·미리보기 중복 행이 다시 생기지 않는다", () => {
    const { groups } = buildMenu();
    const viewIds = (groups.find((group) => group.id === "view")?.items ?? []).map(
      (item) => item.id,
    );
    expect(viewIds).not.toContain("anim-timeline");
    expect(viewIds).not.toContain("vertical-scroll-preview");
    expect(viewIds).not.toContain("storyboard-grid");
  });

  it("마스터 편집 중에는 타임라인 항목이 벨트와 같은 이유로 잠긴다", () => {
    const { groups } = buildMenu({ masterEditMode: true });
    const timeline = menuItem(groups, "animation", "timeline");

    expect(timeline.disabled).toBe(true);
    expect(timeline.unavailableReason).toContain("마스터 편집");
    // 나머지 둘은 히스토리 스크러빙을 쓰지 않으므로 잠기지 않는다.
    expect(menuItem(groups, "comic", "scroll-preview").disabled).toBeFalsy();
    expect(menuItem(groups, "comic", "storyboard").disabled).toBeFalsy();
  });

  it("타임라인 항목은 열림 상태를 체크 표시로 반영한다", () => {
    expect(menuItem(buildMenu().groups, "animation", "timeline").checked).toBe(false);
    expect(
      menuItem(buildMenu({ animationTimelineOpen: true }).groups, "animation", "timeline")
        .checked,
    ).toBe(true);
  });

  it("routes file, edit, layer, and drawing commands to their injected owners", () => {
    const { editor, groups, ui } = buildMenu();

    menuItem(groups, "file", "export").onSelect();
    menuItem(groups, "file", "save-draft").onSelect();
    menuItem(groups, "file", "publish").onSelect();
    menuItem(groups, "file", "import-json").onSelect();
    menuItem(groups, "file", "import-psd").onSelect();
    menuItem(groups, "file", "import-ora-cbz").onSelect();
    menuItem(groups, "edit", "paste").onSelect();
    menuItem(groups, "edit", "paste-in-place").onSelect();
    menuItem(groups, "layer", "bring-forward").onSelect();
    menuItem(groups, "edit", "pen-pressure").onSelect();
    menuItem(groups, "window", "template").onSelect();
    menuItem(groups, "vector", "elements").onSelect();
    menuItem(groups, "text", "text").onSelect();
    menuItem(groups, "comic", "page").onSelect();
    menuItem(groups, "brush", "pen").onSelect();
    menuItem(groups, "brush", "smart-shape").onSelect();
    menuItem(groups, "brush", "fill").onSelect();
    menuItem(groups, "ai", "ai-assist").onSelect();

    expect(ui.openExportDownload).toHaveBeenCalledOnce();
    expect(editor.save).toHaveBeenNthCalledWith(1, "draft");
    expect(editor.save).toHaveBeenNthCalledWith(2, "published");
    expect(ui.requestProjectImport).toHaveBeenCalledOnce();
    expect(ui.requestPsdImport).toHaveBeenCalledOnce();
    expect(ui.requestInterchangeImport).toHaveBeenCalledOnce();
    expect(editor.pasteElements).toHaveBeenNthCalledWith(1, "cascade");
    expect(editor.pasteElements).toHaveBeenNthCalledWith(2, "in-place");
    expect(editor.reorder).toHaveBeenCalledWith("forward");
    expect(ui.openAppSettings).toHaveBeenCalledWith("other");
    expect(ui.openAssetMenu).toHaveBeenCalledOnce();
    expect(ui.openStudioMenu).toHaveBeenCalledWith("elements");
    expect(editor.addText).toHaveBeenCalledOnce();
    expect(editor.addPage).toHaveBeenCalledOnce();
    expect(ui.selectDrawMode).toHaveBeenCalledWith("pen");
    expect(ui.enableSmartShape).toHaveBeenCalledOnce();
    expect(editor.toggleAdvancedFill).toHaveBeenCalledOnce();
    expect(ui.openStudioMenu).toHaveBeenCalledWith("aiAssist");
  });

  it("routes view and filter commands, including compound focus layout behavior", () => {
    const lastFilterDraft = { kind: "motion-blur" as const, distance: 8, angle: -30 };
    const { editor, groups, ui } = buildMenu({ lastFilterDraft });

    menuItem(groups, "view", "zoom-in").onSelect();
    menuItem(groups, "view", "zoom-out").onSelect();
    menuItem(groups, "view", "rotate-left").onSelect();
    menuItem(groups, "canvas", "canvas-rulers").onSelect();
    menuItem(groups, "view", "color-vision-tritanopia").onSelect();
    menuItem(groups, "window", "density-focus").onSelect();
    menuItem(groups, "window", "density-full").onSelect();
    menuItem(groups, "window", "tools-companion").onSelect();
    menuItem(groups, "window", "quick-access-palette").onSelect();
    menuItem(groups, "help", "feature-tutorials").onSelect();
    menuItem(groups, "help", "shortcuts").onSelect();
    menuItem(groups, "edit", "app-settings").onSelect();
    menuItem(groups, "filter", "last-filter").onSelect();
    menuItem(groups, "filter", "gaussian-blur").onSelect();

    expect(ui.stepZoom).toHaveBeenNthCalledWith(1, 1);
    expect(ui.stepZoom).toHaveBeenNthCalledWith(2, -1);
    expect(editor.rotateCanvasView).toHaveBeenCalledWith("left");
    expect(editor.toggleCanvasRulers).toHaveBeenCalledOnce();
    expect(editor.setColorVisionMode).toHaveBeenCalledWith("tritanopia");
    expect(editor.setStudioUiDensity).toHaveBeenNthCalledWith(1, "focus");
    expect(ui.collapseSidePanels).toHaveBeenCalledOnce();
    expect(editor.setStudioUiDensity).toHaveBeenNthCalledWith(2, "full");
    // 전체 레이아웃 must undo what 슈퍼심플 collapsed — density alone leaves the panels shut
    // and the menu item measurably did nothing from the collapsed state.
    expect(ui.expandSidePanels).toHaveBeenCalledOnce();
    expect(menuItem(groups, "window", "tools-companion").label).toBe(
      "멀티 디스플레이 작업공간…"
    );
    expect(ui.openToolsCompanion).toHaveBeenCalledOnce();
    expect(ui.toggleQuickAccessPalette).toHaveBeenCalledOnce();
    expect(editor.openFeatureTutorial).toHaveBeenCalledOnce();
    expect(ui.openShortcuts).toHaveBeenCalledOnce();
    expect(ui.openAppSettings).toHaveBeenCalledWith("general");
    expect(editor.openStudioFilter).toHaveBeenNthCalledWith(
      1,
      "motion-blur",
      lastFilterDraft,
    );
    expect(editor.openStudioFilter).toHaveBeenNthCalledWith(2, "gaussian-blur");
    expect(
      vi.mocked(editor.setStudioUiDensity).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(ui.collapseSidePanels).mock.invocationCallOrder[0]);
  });
});
