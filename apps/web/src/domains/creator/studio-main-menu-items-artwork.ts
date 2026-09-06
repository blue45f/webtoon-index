/**
 * §15.3 artwork groups — Select, Layer, Transform.
 *
 * Brush moved to `studio-main-menu-items-brush.ts` when its §15.3 rows landed:
 * four groups sharing one line budget would have made the drawing group's growth
 * everyone else's problem.
 *
 * Three of these are the groups the UX audit called out as structurally missing
 * (`docs/rewrite/ux-audit-v5.md` §2.7): selection and layer commands used to be
 * buried inside Edit, and drawing lived in a product-only `그리기` group. Every
 * relocated item keeps its original handler and carries `legacyPath` so locale
 * keys and disabled-reason copy do not move with it.
 *
 * Wave D adds the two rows the audit measured as 1–2–3 failures because the menu
 * had no path to them at all: Layer ▸ Mask/Clipping and Transform ▸ Scale/Rotate.
 * Both dispatch the handlers the inspector and the tool rail already use — the
 * menu opens a second door, it does not fork the behaviour.
 */

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Crop,
  ImagePlus,
  Lasso,
  Layers,
  LayoutGrid,
  Scaling,
  Square,
  SquareDashed,
  SquareStack,
  X,
} from "lucide-react";

import { requestStudioLayerBorderEffectPanelOpen } from "./layer/studio-layer-border-effect";
import { STUDIO_EDIT_MENU_COMMANDS } from "./studio-edit-controls";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

/** Select — lifted out of Edit. §15.3 Select. */
export function buildStudioSelectMenuItems({
  state,
  editor,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      ...STUDIO_EDIT_MENU_COMMANDS["select-all"],
      commandId: "select.all",
      legacyPath: "edit/select-all",
      icon: LayoutGrid,
      disabled: state.edit.selectAllDisabled,
      onSelect: () => {
        editor.selectAll();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS.deselect,
      commandId: "select.deselect",
      legacyPath: "edit/deselect",
      icon: X,
      disabled: state.edit.deselectDisabled,
      onSelect: () => {
        editor.deselect();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["invert-selection"],
      commandId: "select.invert",
      legacyPath: "edit/invert-selection",
      icon: Lasso,
      disabled: state.edit.invertSelectionDisabled,
      onSelect: () => {
        editor.invertSelection();
      },
    },
  ];
}

/**
 * Layer — order commands and the layer-scoped crop lifted out of Edit, raster
 * insert lifted out of Insert, local visibility reset lifted out of View.
 */
export function buildStudioLayerMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "image",
      commandId: "insert.image",
      legacyPath: "insert/image",
      label: "이미지…",
      icon: ImagePlus,
      separatorAfter: true,
      onSelect: () => {
        ui.requestImageInsert();
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["bring-front"],
      commandId: "layer.bring-front",
      legacyPath: "edit/bring-front",
      icon: ArrowUpToLine,
      disabled: state.edit.reorderDisabled,
      onSelect: () => {
        editor.reorder("front");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["bring-forward"],
      commandId: "layer.bring-forward",
      legacyPath: "edit/bring-forward",
      icon: ChevronUp,
      disabled: state.edit.reorderDisabled,
      onSelect: () => {
        editor.reorder("forward");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["send-back"],
      commandId: "layer.send-back",
      legacyPath: "edit/send-back",
      icon: ArrowDownToLine,
      disabled: state.edit.reorderDisabled,
      onSelect: () => {
        editor.reorder("back");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["send-backward"],
      commandId: "layer.send-backward",
      legacyPath: "edit/send-backward",
      icon: ChevronDown,
      disabled: state.edit.reorderDisabled,
      separatorAfter: true,
      onSelect: () => {
        editor.reorder("backward");
      },
    },
    {
      ...STUDIO_EDIT_MENU_COMMANDS["crop-layer"],
      commandId: "edit.crop-layer",
      legacyPath: "edit/crop-layer",
      icon: Crop,
      disabled: state.edit.cropLayerDisabled,
      onSelect: () => {
        editor.openSelectedLayerCrop();
      },
    },
    // §15.3 Layer ▸ Mask/Clipping. Until Wave D the only door was the inspector
    // 속성 탭 checkbox, which the audit measured at 3 actions (§2.2).
    {
      id: "clipping-mask",
      commandId: "layer.clipping-mask",
      label: "아래 레이어에 클리핑",
      icon: SquareStack,
      checked: state.clippingMaskActive,
      selectionRole: "checkbox",
      disabled: state.clippingMaskDisabled,
      unavailableReason: state.clippingMaskDisabled
        ? "클리핑할 레이어 하나를 먼저 선택하세요."
        : undefined,
      onSelect: () => {
        editor.toggleClippingMask();
      },
    },
    {
      id: "mask",
      commandId: "layer.mask",
      label: "레이어 마스크 편집…",
      icon: SquareDashed,
      disabled: !state.imageLayerSelected,
      unavailableReason: state.imageLayerSelected
        ? undefined
        : "마스크를 편집할 이미지 레이어를 먼저 선택하세요.",
      onSelect: () => {
        ui.openLayerMask();
      },
    },
    // CSP 경계 효과(fuchi) — 레이어 탭의 경계 효과 패널을 연다. 호스트 ui 계약을
    // 늘리는 대신 studio-companion-add-text와 같은 창 이벤트 브리지를 쓰고, 발신기는
    // 순수 카탈로그 경계(브라우저 전역 금지)를 지키러 layer 모듈에 산다(2026-08-20).
    {
      id: "border-effect",
      commandId: "layer.border-effect",
      label: "경계 효과…",
      icon: Square,
      disabled: !state.imageLayerSelected,
      unavailableReason: state.imageLayerSelected
        ? undefined
        : "경계 효과를 적용할 이미지 레이어를 먼저 선택하세요.",
      separatorAfter: true,
      // 힌트 id는 전역 유일 + 콜론 네임스페이스 — 메뉴 소스 드리프트 가드의 항목 id 리터럴
      // 스캔(`\bid: "[a-z0-9-]+"`)에 잡히지 않게 항목 id 문법 밖에 둔다.
      hint: {
        id: "menu:layer-border-effect",
        title: "레이어 경계 효과",
        description:
          "선택한 이미지 레이어의 실루엣을 따라 비파괴 테두리(CSP 경계 효과)를 켜고 굵기·색을 조절합니다.",
        tip: "레이어 탭 아래쪽 '경계 효과' 패널에서 바깥/안쪽/중앙을 고를 수 있어요.",
      },
      onSelect: () => {
        // 우패널이 접혀 있으면 aside 가 CSS 로 숨겨져 이벤트가 무의미해진다 — 먼저 편다.
        ui.openLayerPanel?.();
        requestStudioLayerBorderEffectPanelOpen();
      },
    },
    {
      id: "reset-local-visibility",
      commandId: "layer.show-locally-hidden",
      legacyPath: "view/reset-local-visibility",
      label: "나만 숨긴 레이어 모두 표시",
      icon: Layers,
      disabled: !state.hasLocallyHiddenLayers,
      onSelect: () => {
        editor.showAllLocallyHiddenLayers();
      },
    },
  ];
}

/**
 * Transform — §15.3 declared the group from the start, but every transform door
 * was a tool-rail button, and the audit measured 19 of the rail's 34 buttons
 * below the fold at 1440×900 (`docs/rewrite/ux-audit-v5.md` §2.2). One menu row
 * into the host's existing free-transform entry point is what makes it 2 actions.
 */
export function buildStudioTransformMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "pixel-transform",
      commandId: "transform.pixel-selection",
      label: "선택 변형",
      icon: Scaling,
      onSelect: () => {
        ui.activateTransformTool();
      },
    },
  ];
}
