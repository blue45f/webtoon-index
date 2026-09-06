import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { STUDIO_COLOR_VISION_HINTS } from "./studio-color-vision-coach";
import { catalogShortcutIndex } from "./studio-command-catalog";
import { buildStudioSelectToolMenuItems } from "./studio-main-menu-items-selection";
import { resolveStudioViewShortcut } from "./studio-view-controls";

import type {
  StudioMainMenuBuilderState,
  StudioMainMenuEditAvailability,
  StudioMainMenuEditorActions,
  StudioMainMenuItemContext,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

/**
 * §15.3 Select 그룹의 "광고와 실제" 계약 (감사 D5·D6, 2026-08-08 브라우저 실측).
 *
 * D6 — 감사는 `선택` 라디오 7행이 **항상** `aria-checked="false"` 라고 봤고 원인을
 * `disarmAllPixelTools()` 잔류로 추정했다. 실측 결과 그 가설은 **틀렸다**: 획을 하나
 * 그은 문서에서 `M` 을 누르면 `사각 선택` 이 즉시 `aria-checked="true"` 가 된다.
 * 실제 결함은 빈 문서에서 **활성처럼 보이는 행이 조용히 실패**한다는 점이었다.
 * 그래서 이 파일은 (a) 체크 바인딩이 상태를 따라간다, (b) 무장 불가일 때는 레이어
 * 그룹과 같은 기준으로 `disabled` + 사유를 단다 — 둘 다 고정한다.
 *
 * D5 — 단독 `Q` 는 퀵 마스크만의 화음이다. 색각 검수 흑백 명암은 `⌥Q` 로 옮겼다.
 * 메뉴 배지·보기 리졸버·명령 카탈로그·단축키 도움말 네 곳이 같은 말을 하는지 본다.
 */

const AVAILABLE_EDIT: StudioMainMenuEditAvailability = {
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
  edit: AVAILABLE_EDIT,
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

type StateOverrides = Partial<Omit<StudioMainMenuBuilderState, "edit">> & {
  edit?: Partial<StudioMainMenuEditAvailability>;
};

function buildSelectItems(overrides: StateOverrides = {}): StudioMainMenuItem[] {
  const { edit, ...rest } = overrides;
  const context: StudioMainMenuItemContext = {
    state: { ...BASE_STATE, ...rest, edit: { ...AVAILABLE_EDIT, ...edit } },
    // Select 그룹은 editor 액션을 쓰지 않는다 — 접근하면 즉시 드러나도록 프록시로 둔다.
    editor: new Proxy({} as StudioMainMenuEditorActions, {
      get(_target, property) {
        throw new Error(`select 그룹이 editor.${String(property)} 를 호출했다`);
      },
    }),
    ui: {
      activatePixelSelectionTool: vi.fn(),
      enterQuickMask: vi.fn(),
      commitQuickMask: vi.fn(),
    } as unknown as StudioMainMenuUiActions,
  };
  return buildStudioSelectToolMenuItems(context);
}

function itemById(items: readonly StudioMainMenuItem[], id: string): StudioMainMenuItem {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`select 메뉴에 ${id} 행이 없다`);
  return found;
}

const TOOL_ROW_IDS = [
  "marquee-rect",
  "marquee-ellipse",
  "lasso",
  "poly-lasso",
  "magic-wand",
  "color-range",
] as const;

describe("select 그룹 — 픽셀 선택 행의 정직성 (D6)", () => {
  it("래스터 대상을 확보할 수 있으면 7행 모두 활성이다", () => {
    const items = buildSelectItems();
    for (const id of TOOL_ROW_IDS) {
      expect(itemById(items, id).disabled, id).toBeFalsy();
    }
    expect(itemById(items, "quick-mask").disabled).toBeFalsy();
  });

  it("무장할 래스터가 없으면 레이어 그룹처럼 사유와 함께 비활성화한다", () => {
    // 빈 문서 = 호스트의 rasterRetouchTargetAvailable false = edit.cropLayerDisabled true.
    // 감사가 본 상태: 라디오가 활성처럼 보이는데 눌러도 라이브 리전 안내만 나왔다.
    const items = buildSelectItems({ edit: { cropLayerDisabled: true } });
    for (const id of TOOL_ROW_IDS) {
      const row = itemById(items, id);
      expect(row.disabled, id).toBe(true);
      expect(row.unavailableReason ?? "", id).not.toBe("");
    }
  });

  it("이미 무장된 도구는 막지 않는다 — 끄는 길이 남아야 한다", () => {
    const items = buildSelectItems({
      pixelSelectionTool: "rect",
      edit: { cropLayerDisabled: true },
    });
    expect(itemById(items, "marquee-rect").disabled).toBeFalsy();
    expect(itemById(items, "lasso").disabled).toBe(true);
  });

  it("라디오 체크는 무장된 도구를 따라간다 (감사 가설과 달리 바인딩은 정상)", () => {
    const items = buildSelectItems({ pixelSelectionTool: "circle" });
    expect(itemById(items, "marquee-ellipse").checked).toBe(true);
    expect(itemById(items, "marquee-rect").checked).toBe(false);
    expect(items.filter((item) => item.checked === true)).toHaveLength(1);
  });

  it("퀵 마스크는 이미지 레이어가 없으면 사유와 함께 비활성이다", () => {
    const blocked = buildSelectItems({ imageLayerSelected: false });
    expect(itemById(blocked, "quick-mask").disabled).toBe(true);
    expect(itemById(blocked, "quick-mask").unavailableReason ?? "").not.toBe("");

    const locked = buildSelectItems({ edit: { cropLayerDisabled: true } });
    expect(itemById(locked, "quick-mask").disabled).toBe(true);

    // 세션이 이미 열려 있으면 "끝내고 선택 만들기" 로 나가는 길은 항상 열려 있다.
    const active = buildSelectItems({ quickMaskActive: true, imageLayerSelected: false });
    expect(itemById(active, "quick-mask").disabled).toBeFalsy();
    expect(itemById(active, "quick-mask").checked).toBe(true);
  });
});

describe("`Q` 는 퀵 마스크 하나만 광고한다 (D5)", () => {
  const read = (file: string): string =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

  it("선택 메뉴는 퀵 마스크에 `Q` 배지를 유지한다", () => {
    expect(itemById(buildSelectItems(), "quick-mask").shortcut).toBe("Q");
  });

  it("보기 메뉴의 색각 검수 흑백 명암은 `⌥Q` 로 광고한다", () => {
    const source = read("studio-main-menu-items-document.ts");
    expect(source).toContain('mode: "grayscale" as const, shortcut: "⌥Q"');
    expect(source).not.toMatch(/shortcut: "Q"/u);
  });

  it("보기 리졸버는 단독 `Q` 를 삼키지 않고 `⌥Q` 로만 흑백 명암을 켠다", () => {
    expect(resolveStudioViewShortcut({ code: "KeyQ" })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", shiftKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true })).toBe("toggle-grayscale");
  });

  it("명령 카탈로그에서 `Q` 를 주장하는 명령은 퀵 마스크뿐이다", () => {
    expect(catalogShortcutIndex().get("Q")).toEqual(["select.quick-mask"]);
    expect(catalogShortcutIndex().get("⌥Q")).toEqual(["view.color-vision-grayscale"]);
  });

  it("색각 검수 힌트와 색각 토글의 aria-keyshortcuts 도 `⌥Q` 로 같이 말한다", () => {
    // 감사 D5 의 잔가지: 메뉴 배지만 고치면 툴팁·스크린리더가 여전히 `Q` 를 읽어 준다.
    expect(STUDIO_COLOR_VISION_HINTS.grayscale.shortcut).toBe("⌥Q");
    const toggle = read("StudioColorBlindPreviewToggle.tsx");
    expect(toggle).toContain('aria-keyshortcuts={mode === "grayscale" ? "Alt+Q" : undefined}');
  });

  it("단축키 도움말도 `Q` 를 퀵 마스크에만 붙인다", () => {
    const source = read("StudioShortcutsHelp.tsx");
    const qRows = [
      ...source.matchAll(/keys: "Q",\s*\n\s*labelKey: "([A-Za-z0-9.]+)"/gu),
    ].map((match) => match[1]);
    expect(qRows).toEqual(["studio.shortcuts.row.edit.quickMask"]);
  });
});
