/**
 * §15.3 Select — the selection *tools*, as opposed to Select All / Deselect.
 *
 * The regroup audit measured this group at 0 of 7 rows and noted the reason:
 * "선택 도구는 왼쪽 툴레일에만 있다". That was only half true. The rail carries
 * three of them (사각 M, 원형 ⇧M, 올가미 L — and the lasso button *cycles* into
 * the polygon variant rather than naming it), while 다각형·자동 선택·색 범위 have
 * no rail button at all and live behind the inspector's pixel-selection launcher,
 * and 퀵 마스크 is reachable only by pressing `Q`.
 *
 * So every row below is a door onto `activatePixelSelectionToolFromInspector`,
 * the single host function the rail, the launcher and the shortcuts all already
 * funnel into. Nothing new is armed, disarmed or invented here; the menu simply
 * stops being the one surface that cannot reach a selection tool.
 *
 * ## 2026-08-08 정직성 수선 (감사 D5·D6)
 *
 * **D6.** 브라우저 실측 결과 라디오 바인딩(`state.pixelSelectionTool === row.tool`)
 * 자체는 맞다 — 획을 하나 그은 문서에서 `M` 을 누르면 `사각 선택` 이 곧바로
 * `aria-checked="true"` 가 된다. 감사가 본 "항상 false" 는 **빈 문서**에서만 나오는
 * 현상이었다: 무장 대상이 될 래스터가 없으면 호스트가
 * `preparePixelMarqueeRasterTarget` 로 페이지를 래스터화하려다
 * "표시 요소가 없습니다" 로 실패하고 `pixelTool` 은 null 로 남는다. 즉 버그는
 * 체크 상태가 아니라 **활성처럼 보이는 행이 조용히 실패한다**는 점이었다.
 * 레이어 그룹은 같은 상황에서 `disabled` + 사유를 달아 정직하게 막는다. 여기서도
 * 같은 기준을 쓴다 — 게이트는 호스트가 이미 계산해 둔
 * `edit.cropLayerDisabled`(= `mutationLocked || !rasterRetouchTargetAvailable`),
 * 곧 Crop·리터치 레일·픽셀 선택이 공유하는 "편집 가능한 래스터를 확보할 수 있는가".
 *
 * **D5.** `Q` 는 죽어 있지 않았다. 페이지 마스터 핸들러가 퀵 마스크를 먼저 시도하되
 * `이미지 레이어 선택 + 미잠금` 일 때만 소비하고, 아니면 보기 리졸버로 흘러가
 * 색각 검수 흑백 명암이 켜졌다 — 같은 배지를 단 두 명령이 상태에 따라 갈리는
 * 조건부 디스패치. 이제 단독 `Q` 는 퀵 마스크만의 것이고 색각 검수는 `⌥Q` 로
 * 옮겼다(`studio-view-controls.ts`, `studio-main-menu-items-document.ts`).
 * 도달 조건 자체는 아래 `disabled` + 사유가 화면에 적는다.
 *
 * Rows §15.3 asks for that the product genuinely lacks — Semantic/Object Select,
 * Expand/Shrink/Feather/Smooth as commands, Save Selection, Selection HUD — stay
 * recorded as gaps in `studio-main-menu-group-spec.ts` rather than faked.
 */

import { Circle, Contrast, Lasso, Pipette, Spline, SquareDashed, Wand2 } from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";
import type { StudioPixelSelectionToolId } from "./studio-main-menu-surface-contract";

interface SelectToolRow {
  readonly id: string;
  readonly commandId: string;
  readonly tool: StudioPixelSelectionToolId;
  readonly label: string;
  readonly icon: StudioMainMenuItem["icon"];
  readonly shortcut?: string;
  readonly separatorAfter?: boolean;
}

/** Declaration order is the menubar order; ids are globally unique. */
const SELECT_TOOL_ROWS: readonly SelectToolRow[] = [
  {
    id: "marquee-rect",
    commandId: "tool.marquee-rect",
    tool: "rect",
    label: "사각 선택",
    icon: SquareDashed,
    shortcut: "M",
  },
  {
    id: "marquee-ellipse",
    commandId: "tool.marquee-ellipse",
    tool: "circle",
    label: "원형 선택",
    icon: Circle,
    shortcut: "⇧M",
  },
  {
    id: "lasso",
    commandId: "tool.lasso",
    tool: "lasso",
    label: "올가미",
    icon: Lasso,
    shortcut: "L",
  },
  {
    id: "poly-lasso",
    commandId: "tool.poly-lasso",
    tool: "poly-lasso",
    label: "다각형 올가미",
    icon: Spline,
    separatorAfter: true,
  },
  {
    id: "magic-wand",
    commandId: "tool.magic-wand",
    tool: "wand",
    label: "자동 선택 (마술봉)",
    icon: Wand2,
  },
  {
    id: "color-range",
    commandId: "tool.color-range",
    tool: "color-range",
    label: "색 범위 선택",
    icon: Pipette,
    separatorAfter: true,
  },
];

// 무장 가능 여부는 새 상태를 발명하지 않고 `edit.cropLayerDisabled` 로 읽는다.
// 그 값은 페이지에서 `mutationLocked || !rasterRetouchTargetAvailable` 로 계산되고,
// `rasterRetouchTargetAvailable` 이 곧 "선택/유일 이미지가 있거나, 보이는 페이지
// 내용을 편집 가능한 래스터로 만들 수 있다" 다 — 픽셀 선택이 실패하는 지점과 같다.
const PIXEL_SELECTION_UNAVAILABLE_REASON =
  "픽셀 선택은 편집 가능한 이미지가 필요합니다. 이미지 레이어를 추가·선택하거나 먼저 펜, 도형 또는 텍스트를 그리세요.";
const QUICK_MASK_UNAVAILABLE_REASON =
  "퀵 마스크는 편집 가능한 이미지 레이어 위에서 칠합니다. 이미지 레이어를 먼저 선택하고 편집 잠금을 해제하세요.";

/**
 * Select tool rows. Radio semantics: arming one disarms the rest, and picking the
 * armed one again turns it off — the host's own toggle behaviour, surfaced.
 *
 * 무장할 수 없는 상태에서는 레이어 그룹과 같은 기준으로 `disabled` + 사유를 단다.
 * 활성처럼 보이는 라디오를 눌러 놓고 라이브 리전으로만 실패를 말하지 않는다.
 */
export function buildStudioSelectToolMenuItems({
  state,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  const pixelSelectionBlocked = state.edit.cropLayerDisabled;
  const items: StudioMainMenuItem[] = SELECT_TOOL_ROWS.map((row) => {
    const armed = state.pixelSelectionTool === row.tool;
    // 이미 무장된 행은 끄는 길이 남아 있어야 하므로 막지 않는다.
    const blocked = pixelSelectionBlocked && !armed;
    return {
      id: row.id,
      commandId: row.commandId,
      label: row.label,
      icon: row.icon,
      ...(row.shortcut === undefined ? {} : { shortcut: row.shortcut }),
      checked: armed,
      selectionRole: "radio" as const,
      disabled: blocked,
      ...(blocked ? { unavailableReason: PIXEL_SELECTION_UNAVAILABLE_REASON } : {}),
      ...(row.separatorAfter === undefined ? {} : { separatorAfter: row.separatorAfter }),
      onSelect: () => {
        ui.activatePixelSelectionTool(row.tool);
      },
    };
  });

  // `enterQuickMask()` 는 선택 이미지가 없거나 잠겨 있으면 아무 말 없이 return 한다.
  // 그 조건을 그대로 화면에 적는다: 이미지 레이어 선택 + 래스터 편집 가능.
  const quickMaskBlocked = !state.quickMaskActive
    && (!state.imageLayerSelected || state.edit.cropLayerDisabled);
  items.push({
    id: "quick-mask",
    commandId: "select.quick-mask",
    label: state.quickMaskActive ? "퀵 마스크 끝내고 선택 만들기" : "퀵 마스크로 칠하기",
    icon: Contrast,
    // 단독 `Q` 는 이제 이 명령만의 것이다 — 색각 검수 흑백 명암은 `⌥Q` 로 옮겼다.
    shortcut: "Q",
    checked: state.quickMaskActive,
    selectionRole: "checkbox",
    disabled: quickMaskBlocked,
    ...(quickMaskBlocked ? { unavailableReason: QUICK_MASK_UNAVAILABLE_REASON } : {}),
    separatorAfter: true,
    onSelect: () => {
      if (state.quickMaskActive) ui.commitQuickMask();
      else ui.enterQuickMask();
    },
  });

  return items;
}
