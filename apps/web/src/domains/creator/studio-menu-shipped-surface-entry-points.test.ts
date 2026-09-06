/**
 * Wave E contract: every row that claims to open a shipped surface must open it.
 *
 * The failure mode this guards is specific and was the whole reason Animation,
 * Collaboration and half of Comic & Story read as "absent" in the §15.3 audit: a
 * feature ships, its only door is a panel button or a mobile-only belt, and the
 * menubar quietly has no path to it. Closing that with a menu row is worth
 * nothing if the row dispatches the wrong handler — or nothing at all.
 *
 * So each case below builds the live catalogue, selects a row, and asserts which
 * host callback fired. Nothing is asserted about the surface itself; that is the
 * host's contract, and `studio-main-menu-surface-bindings.ts` is what pins the
 * callback to a handler the page already publishes.
 */

import { describe, expect, it, vi } from "vitest";

import { buildStudioMainMenuGroups } from "./studio-main-menu-groups";

import type {
  StudioMainMenuBuilderState,
  StudioMainMenuEditAvailability,
  StudioMainMenuEditorActions,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";

const EDIT_AVAILABLE: StudioMainMenuEditAvailability = {
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
  edit: EDIT_AVAILABLE,
  pixelArtEnabled: false,
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
};

type UiCalls = Record<string, ReturnType<typeof vi.fn>>;

function buildMenu(state: Partial<StudioMainMenuBuilderState> = {}) {
  const ui: UiCalls = {};
  const uiProxy = new Proxy({} as StudioMainMenuUiActions, {
    get: (_target, key: string) => {
      ui[key] ??= vi.fn();
      return ui[key];
    },
  });
  const editor = new Proxy({} as StudioMainMenuEditorActions, {
    get: () => vi.fn(),
  });
  const groups = buildStudioMainMenuGroups({
    state: { ...BASE_STATE, ...state },
    editor,
    ui: uiProxy,
    t: (key) => key,
  });
  return { groups, ui };
}

function item(
  groups: ReturnType<typeof buildMenu>["groups"],
  groupId: string,
  itemId: string,
) {
  const found = groups
    .find((group) => group.id === groupId)
    ?.items.find((row) => row.id === itemId);
  if (!found) throw new Error(`menu row ${groupId}/${itemId} does not exist`);
  return found;
}

/** `<group>/<item>` → the `ui` callback selecting it must invoke. */
const SURFACE_ROWS: readonly (readonly [string, string, string])[] = [
  ["file", "quick-start", "openQuickStart"],
  ["file", "checkpoints", "openCheckpoints"],
  ["file", "publish-preflight", "openPublishPreflight"],
  ["file", "publish-package", "openPublishPackage"],
  ["file", "rights-manifest", "openAssetRightsAudit"],
  ["edit", "auto-actions", "openAutoActions"],
  ["view", "navigator", "openCanvasNavigator"],
  ["canvas", "canvas-settings", "openCanvasSettings"],
  ["canvas", "grid", "toggleCanvasGrid"],
  ["vector", "erase-to-intersection", "toggleVectorEraseToIntersection"],
  ["text", "dialogue-batch", "openDialogueBatch"],
  ["text", "dialogue-translate", "openDialogueTranslate"],
  ["text", "localization-qa", "openLocalizationQa"],
  ["comic", "writer-room", "openWriterRoom"],
  ["comic", "storyboard", "openStoryboardGrid"],
  ["comic", "story-bible", "openProductionBible"],
  ["comic", "continuity", "openContinuityCheck"],
  ["comic", "scroll-preview", "openScrollPreview"],
  ["comic", "animatic", "openAnimaticTimeline"],
  ["animation", "timeline", "toggleAnimationTimeline"],
  ["animation", "frame-anim", "openFrameAnimation"],
  ["animation", "onion-skin", "toggleOnionSkin"],
  ["collaboration", "team", "openTeamPanel"],
  ["collaboration", "comments", "toggleDocumentComments"],
  ["collaboration", "page-review", "openPageReview"],
];

describe("§15.3 rows that open an already-shipped surface", () => {
  it.each(SURFACE_ROWS)("%s ▸ %s dispatches ui.%s", (groupId, itemId, action) => {
    const { groups, ui } = buildMenu();

    item(groups, groupId, itemId).onSelect();

    expect(ui[action], `${groupId}/${itemId} must call ui.${action}`).toHaveBeenCalledTimes(1);
    for (const [name, spy] of Object.entries(ui)) {
      if (name !== action) expect(spy, `${name} must not fire`).not.toHaveBeenCalled();
    }
  });

  /** The tone library was always a valid `openStudioMenu` target; nothing used it. */
  it("routes the tone and underlay rows through the existing panel opener", () => {
    const { groups, ui } = buildMenu();

    item(groups, "comic", "tone").onSelect();
    item(groups, "view", "underlay").onSelect();

    expect(ui.openStudioMenu?.mock.calls).toEqual([["tone"], ["emeres"]]);
  });
});

describe("§15.3 Select tool rows", () => {
  const TOOLS: readonly (readonly [string, string])[] = [
    ["marquee-rect", "rect"],
    ["marquee-ellipse", "circle"],
    ["lasso", "lasso"],
    ["poly-lasso", "poly-lasso"],
    ["magic-wand", "wand"],
    ["color-range", "color-range"],
  ];

  it.each(TOOLS)("%s arms the %s pixel-selection tool", (itemId, tool) => {
    const { groups, ui } = buildMenu();

    item(groups, "select", itemId).onSelect();

    expect(ui.activatePixelSelectionTool).toHaveBeenCalledExactlyOnceWith(tool);
  });

  it("marks the armed tool, and only that tool, as the selected radio row", () => {
    const { groups } = buildMenu({ pixelSelectionTool: "circle" });
    const checked = groups
      .find((group) => group.id === "select")
      ?.items.filter((row) => row.checked)
      .map((row) => row.id);

    expect(checked).toEqual(["marquee-ellipse"]);
    expect(item(groups, "select", "marquee-rect").selectionRole).toBe("radio");
  });

  /**
   * `Q` is the only door Quick Mask had, and it enters or commits depending on
   * the session. The row has to carry that whole toggle, not just the entry.
   */
  it("enters quick mask when idle and commits it when painting", () => {
    const idle = buildMenu();
    item(idle.groups, "select", "quick-mask").onSelect();
    expect(idle.ui.enterQuickMask).toHaveBeenCalledTimes(1);
    expect(idle.ui.commitQuickMask).toBeUndefined();

    const painting = buildMenu({ quickMaskActive: true });
    const row = item(painting.groups, "select", "quick-mask");
    row.onSelect();
    expect(painting.ui.commitQuickMask).toHaveBeenCalledTimes(1);
    expect(painting.ui.enterQuickMask).toBeUndefined();
    expect(row.checked).toBe(true);
    expect(row.label).toContain("선택 만들기");
  });
});

describe("§15.3 rows that must respect host state", () => {
  it("suspends the timeline and page review during master-page editing", () => {
    const { groups } = buildMenu({ masterEditMode: true });

    expect(item(groups, "animation", "timeline").disabled).toBe(true);
    expect(item(groups, "animation", "timeline").unavailableReason).toBeTruthy();
    expect(item(groups, "collaboration", "page-review").disabled).toBe(true);
  });

  it("reflects open/closed state on the rows that toggle a surface", () => {
    const open = buildMenu({
      animationTimelineOpen: true,
      documentCommentsOpen: true,
      onionSkinEnabled: true,
      canvasGridVisible: true,
      vectorEraseToIntersection: true,
    });

    expect(item(open.groups, "animation", "timeline").checked).toBe(true);
    expect(item(open.groups, "animation", "timeline").label).toContain("닫기");
    expect(item(open.groups, "collaboration", "comments").checked).toBe(true);
    expect(item(open.groups, "animation", "onion-skin").checked).toBe(true);
    expect(item(open.groups, "canvas", "grid").checked).toBe(true);
    expect(item(open.groups, "vector", "erase-to-intersection").checked).toBe(true);
  });
});
