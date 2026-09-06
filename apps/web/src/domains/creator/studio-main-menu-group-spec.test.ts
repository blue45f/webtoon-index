/**
 * V5 §15.3 coverage contract.
 *
 * The point of this file is that the menu and the coverage table cannot drift
 * apart. Every built menu item must be claimed by exactly one §15.3 row or
 * declared as an extra, and every claim must point at an item that exists — so
 * adding, moving or dropping a menu command without saying what it does to §15.3
 * coverage fails here rather than silently changing the audit's numbers.
 */

import { describe, expect, it, vi } from "vitest";

import { STUDIO_MENU_GROUP_SPEC } from "./studio-main-menu-group-spec";
import {
  STUDIO_MENU_GROUP_ORDER,
  studioMenuGroupSpec,
  studioMenuSpecClaimedItems,
  studioMenuSpecCoverageSummary,
  studioMenuSpecMissingRows,
} from "./studio-main-menu-group-spec-coverage";
import { buildStudioMainMenuGroups } from "./studio-main-menu-groups";

import type {
  StudioMainMenuBuilderState,
  StudioMainMenuEditAvailability,
  StudioMainMenuEditorActions,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";

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

function liveMenu() {
  const noop = () => vi.fn();
  const editor = new Proxy({} as StudioMainMenuEditorActions, {
    get: () => noop(),
  });
  const ui = new Proxy({} as StudioMainMenuUiActions, { get: () => noop() });
  return buildStudioMainMenuGroups({ state: BASE_STATE, editor, ui, t: (key) => key });
}

function liveItemIds(): string[] {
  return liveMenu().flatMap((group) =>
    group.items.map((item) => `${group.id}/${item.id}`),
  );
}

describe("§15.3 menu group spec", () => {
  it("declares all 17 §15.3 groups plus the product-only AI group, in menubar order", () => {
    expect(STUDIO_MENU_GROUP_SPEC.filter((group) => group.inV5Spec)).toHaveLength(17);
    expect(STUDIO_MENU_GROUP_SPEC.filter((group) => !group.inV5Spec).map((g) => g.id)).toEqual([
      "ai",
    ]);
    expect(STUDIO_MENU_GROUP_ORDER).toEqual([
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
    expect(
      STUDIO_MENU_GROUP_SPEC.map((group) => group.specName),
      "spec names are the §15.3 headings",
    ).toContain("Text & Balloon");
  });

  it("claims every live menu item exactly once, and claims nothing that does not exist", () => {
    const live = liveItemIds();
    const claimed = STUDIO_MENU_GROUP_SPEC.flatMap((group) =>
      studioMenuSpecClaimedItems(group.id),
    );

    expect(claimed.filter((id) => !live.includes(id)), "claims a missing item").toEqual([]);
    expect(live.filter((id) => !claimed.includes(id)), "unclaimed menu item").toEqual([]);
    expect(new Set(claimed).size, "an item claimed twice").toBe(claimed.length);
  });

  it("only ever claims items that belong to the claiming group", () => {
    for (const group of STUDIO_MENU_GROUP_SPEC) {
      for (const id of studioMenuSpecClaimedItems(group.id)) {
        expect(id.startsWith(`${group.id}/`), `${group.id} claims ${id}`).toBe(true);
      }
    }
  });

  it("renders every group that has an item and no group that does not", () => {
    const rendered = liveMenu().map((group) => group.id);
    const withItems = STUDIO_MENU_GROUP_SPEC.filter(
      (group) => studioMenuSpecClaimedItems(group.id).length > 0,
    ).map((group) => group.id);

    expect(rendered).toEqual(withItems);
    // Transform left the declared-but-unrendered list in Wave D; Animation and
    // Collaboration left it in Wave E, when the menu finally got a door onto the
    // timeline, the team panel and the review flow. No §15.3 group is empty now.
    expect(rendered).toContain("transform");
    expect(rendered).toContain("animation");
    expect(rendered).toContain("collaboration");
  });

  it("pins the measured §15.3 coverage so it cannot move without a decision", () => {
    // Audit baseline (docs/rewrite/ux-audit-v5.md §2.7): 5 of 17 groups, 12 absent.
    // Wave C reached 14 present / 19 partial / 102 absent; Wave D moved it again.
    // The filter-union wave (16 shipped filters that had no menubar row) moved
    // Filter ▸ Depth/Normal Effects from absent to partial: normal-map bakes a
    // normal map and god-rays casts volumetric light, but there is still no depth
    // input and no relighting, so it is not "present".
    // The command bar wave moved Window ▸ Action Bar from absent to partial: the
    // menubar strip is user-configurable (8 slots) with a visibility toggle, but
    // drag reordering and separators are still missing, so it is not "present".
    expect(studioMenuSpecCoverageSummary()).toEqual({
      specGroups: 17,
      groupsWithItems: 17,
      emptyGroupIds: [],
      specRows: 137,
      rowsPresent: 39,
      rowsPartial: 36,
      rowsAbsent: 62,
      // 2026-08-20: CSP 경계 효과(layer/border-effect)도 §15.3 행이 없어 extras(37 → 38).
      // 2026-08-27: View 중복이던 검수·미리보기 3종과 창 그룹의 앱 설정 두 번째
      // 진입점 extras 를 제거했다(40 → 36) — 단일 행은 Animation/Comic 그룹과
      // 편집 메뉴가 소유한다.
      // 2026-09-03: 현지화 QA(text/localization-qa)는 Localization Layout 행의 두 번째
      // 항목이라 extras 가 아니라 partial 행에 머문다(rowsPartial 36 그대로) — 로케일별
      // 폰트/박스 오버라이드가 남아 present 로 올리지 않는다.
      // 2026-09-06: 별도 사용자 매뉴얼 문(help/user-manual, #794)은 §15.3 행이 없어 extras(38 → 39).
      extras: 39,
    });
  });

  /**
   * Brush was the worst group in the audit — 0 of 10 — even though the preset
   * browser, dynamics editor, saved library and ABR importer all shipped. This
   * pins the door count so the group cannot silently regress to "reachable only
   * from the inspector", and pins the four rows that are genuine product gaps so
   * they are never closed with a menu row that leads nowhere.
   */
  it("gives the Brush group real doors and keeps its real gaps named", () => {
    const brush = studioMenuGroupSpec("brush");
    const covered = brush?.rows.filter((row) => row.coverage !== "absent") ?? [];
    expect(covered.map((row) => row.spec)).toEqual([
      "Preset Browser",
      "Brush Studio/Brush DNA",
      "Natural Media/Pigment",
      "Import SUT/ABR/MYB/KPP",
    ]);
    // Not routing gaps — the product has no such feature to route to.
    const absent = brush?.rows.filter((row) => row.coverage === "absent") ?? [];
    expect(absent.map((row) => row.spec)).toEqual([
      "Pressure/Tilt/Velocity",
      "Stabilizer",
      "Tip/Texture/Dual Tip",
      "Particle/Physics",
      "Fidelity Lab",
      "Team Preset Versioning",
    ]);
    expect(absent.every((row) => (row.note ?? "").trim().length > 0)).toBe(true);

    const items = liveMenu().find((group) => group.id === "brush")?.items ?? [];
    const ids = items.map((item) => item.id);
    for (const id of [
      "preset-browser",
      "brush-studio",
      "natural-media",
      "my-brushes",
      "import-pack",
    ]) {
      expect(ids, `Brush ▸ ${id}`).toContain(id);
    }
  });

  it("keeps the §15.3 shortfall list enumerable rather than folklore", () => {
    const missing = studioMenuSpecMissingRows();

    expect(missing).toContain("Layer ▸ Group/Folder");
    expect(missing).toContain("Transform ▸ Mesh Warp");
    // Wave E closed these, so they must no longer read as absent.
    expect(missing).not.toContain("Select ▸ Quick Mask");
    expect(missing).not.toContain("Animation ▸ Timeline");
    expect(missing).not.toContain("Collaboration ▸ Share/Permission");
    expect(missing).not.toContain("Comic & Story ▸ Animatic");
    expect(missing).toContain("Filter ▸ Filter Gallery");
    expect(missing).toContain("Animation ▸ State Machine");
    // Wave D closed these three partially, so they must no longer read as absent.
    expect(missing).not.toContain("Layer ▸ Mask/Clipping");
    expect(missing).not.toContain("Transform ▸ Scale/Rotate/Skew/Perspective");
    expect(missing).not.toContain("Filter ▸ Adjustment Layer");
    expect(missing).toHaveLength(studioMenuSpecCoverageSummary().rowsAbsent);
  });

  /**
   * §15 rule 4 (1–2–3) re-measurement for the five commands the audit measured as
   * failing (`docs/rewrite/ux-audit-v5.md` §2.2). A top-level menu item costs 2
   * actions: open the group, click the row. Anything not in the menu keeps the
   * cost the audit measured on its panel path.
   */
  it("re-measures the 1–2–3 rule failures against the new group structure", () => {
    const live = liveMenu();
    const commandIds = new Set(
      live.flatMap((group) => group.items.map((item) => item.commandId)),
    );
    const menuCost = (commandId: string): number | null =>
      commandIds.has(commandId) ? 2 : null;

    // Resolved by the regroup: these were only reachable through a right-panel tab
    // switch (+1 action) before Layer / Select / Canvas existed.
    expect(menuCost("layer.bring-front")).toBe(2);
    // Catalog id is still `edit.crop-layer`; only the menu group moved.
    expect(menuCost("edit.crop-layer")).toBe(2);
    expect(menuCost("select.all")).toBe(2);
    expect(menuCost("view.canvas-rulers")).toBe(2);

    // Wave D: the four rows the audit measured at 3+ actions. Each was already
    // implemented; what was missing was a host callback on the menu contract, so
    // the fix is a door onto the existing surface, not a second implementation.
    const wasFailing = [
      // 3 → 2 (tool rail y=1003, below the 1440×900 fold).
      { audit: "선택 후 변형", commandId: "transform.pixel-selection", via: "ui.activateTransformTool" },
      // >3 → 2 (우패널 속성 → 색보정 → 스크롤 → 섹션).
      { audit: "레벨(Levels)", commandId: "filter.levels", via: "ui.openImageAdjustments" },
      // >3 → 2. Distinct from `filter.color-curves`, the destructive dialog.
      { audit: "커브(Curves)", commandId: "filter.tone-curve", via: "ui.openImageAdjustments" },
      // 3 → 2 (선택 → 속성 탭 → 체크박스).
      { audit: "클리핑 마스크", commandId: "layer.clipping-mask", via: "editor.toggleClippingMask" },
    ] as const;
    for (const row of wasFailing) {
      expect(menuCost(row.commandId), row.audit).toBe(2);
      expect(row.via).not.toBe("");
    }
    // §2.2 measured 15 commands, 10 passing. With these four the menu answers 14;
    // "새 레이어" is the remaining panel-only path and already passed at 2.
    expect(live.find((group) => group.id === "transform")).toBeDefined();
  });

  it("gives every partial row a note saying what is missing", () => {
    for (const group of STUDIO_MENU_GROUP_SPEC) {
      for (const row of group.rows) {
        if (row.coverage === "partial") {
          expect(row.note?.trim(), `${group.specName} ▸ ${row.spec}`).toBeTruthy();
          expect(row.items.length, `${group.specName} ▸ ${row.spec}`).toBeGreaterThan(0);
        }
        if (row.coverage === "present") {
          expect(row.items.length, `${group.specName} ▸ ${row.spec}`).toBeGreaterThan(0);
        }
        if (row.coverage === "absent") {
          expect(row.items, `${group.specName} ▸ ${row.spec}`).toEqual([]);
        }
      }
      for (const extra of group.extras) {
        expect(extra.note.trim(), extra.item).not.toBe("");
      }
    }
  });
});
