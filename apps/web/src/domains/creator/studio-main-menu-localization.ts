import { localizeStudioFilterUnavailableReason } from "./filter/studio-filter-unavailable-reason-localization";

import type {
  StudioMainMenuGroup,
  StudioMainMenuItem,
} from "./studio-main-menu-model";

export type StudioMainMenuTranslate = (key: string) => string;

export interface StudioMainMenuLocalizationState {
  readonly sharedNonOwnerSave: boolean;
  readonly hasWorkId: boolean;
  readonly filterDisabled: boolean;
  readonly filterUnavailableReason: string | null;
  readonly canvasRotation: number;
  readonly pageSequenceOpen: boolean;
  readonly quickAccessPaletteOpen: boolean;
  readonly quickAccessPaletteLoading: boolean;
  readonly leftPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  /**
   * Menubar command bar visibility. Optional because it is absent on the
   * authored workspace layout until the strip has been toggled once, and the
   * item builder reads that absence as "visible" (`!== false`) — this module
   * must agree or the label would flip on a fresh workspace.
   */
  readonly commandBarVisible?: boolean;
  readonly lastFilterDraft: unknown | null;
}

type StudioMainMenuLocalizableItem = StudioMainMenuItem & {
  readonly labelKey?: string;
};

function localizeText(
  t: StudioMainMenuTranslate,
  fallback: string,
  key: string,
): string {
  const text = t(key);
  return text === key ? fallback : text;
}

/**
 * Locale key path for an item: `<group>/<item>` as the locale packs were
 * authored. Items the §15.3 regroup relocated carry `legacyPath`, so their keys
 * stay put even though the group around them changed.
 */
function localePath(groupId: string, item: StudioMainMenuLocalizableItem): string {
  return item.legacyPath ?? `${groupId}/${item.id}`;
}

function itemLabelKey(
  path: string,
  item: StudioMainMenuLocalizableItem,
  state: StudioMainMenuLocalizationState,
): string {
  if (item.labelKey) return item.labelKey;
  const baseKey = `studio.mainMenu.item.${path.replace("/", ".")}`;
  if (path === "file/save-draft" && state.sharedNonOwnerSave) return `${baseKey}.shared`;
  if (path === "file/publish" && state.hasWorkId) return `${baseKey}.has-work`;
  if (path === "view/page-sequence" && state.pageSequenceOpen) return `${baseKey}.open`;
  if (path === "view/quick-access-palette") {
    if (state.quickAccessPaletteLoading) return `${baseKey}.loading`;
    if (state.quickAccessPaletteOpen) return `${baseKey}.open`;
  }
  if (path === "view/left-panel" && state.leftPanelOpen) return `${baseKey}.open`;
  if (path === "view/right-panel" && state.rightPanelOpen) return `${baseKey}.open`;
  // Same two-key shape the panel rows use: the base key is the "show" wording and
  // `.open` the "hide" one. Without the branch a single key would localize both
  // states to one sentence, which reads as the wrong action half the time.
  if (path === "window/command-bar" && state.commandBarVisible !== false) {
    return `${baseKey}.open`;
  }
  if (path === "filter/last-filter") {
    return `${baseKey}.${state.lastFilterDraft ? "ready" : "empty"}`;
  }
  return baseKey;
}

function localizeItemLabel(
  path: string,
  item: StudioMainMenuLocalizableItem,
  state: StudioMainMenuLocalizationState,
  t: StudioMainMenuTranslate,
): string {
  const label = localizeText(t, item.label, itemLabelKey(path, item, state));
  // 한국어 팩의 기존 용어가 새 서버 초안 명칭을 되돌리지 않게 한다. 다른 언어의
  // 번역값과 공동 편집자의 `공동 저장`은 그대로 유지한다.
  if (path === "file/save-draft" && item.label === "초안 저장" && label === "임시저장") {
    return item.label;
  }
  // The Korean pack still phrases this checkbox row as the one-way action "창 열기".  The row is
  // now a real menuitemcheckbox, so a stable noun is clearer in both unchecked and checked states
  // and agrees with the command catalogue. Other locales keep their authored translation until
  // their packs adopt the state-neutral wording.
  if (
    path === "view/reference-window"
    && item.label === "참고 이미지 창"
    && label === "참고 이미지 창 열기"
  ) {
    return item.label;
  }
  if (path === "file/import-ora-cbz" && !/\bWILL\b/iu.test(label)) {
    const withWill = label.replace(
      /ORA\s*\/\s*CBZ/iu,
      (formats) => `${formats} / WILL`,
    );
    return withWill === label ? `${label} · WILL` : withWill;
  }
  if (path === "view/reset-rotation") {
    return label.replace("{angle}", String(state.canvasRotation));
  }
  return label;
}

function localizeUnavailableReason(
  path: string,
  item: StudioMainMenuLocalizableItem,
  state: StudioMainMenuLocalizationState,
  t: StudioMainMenuTranslate,
): string | undefined {
  if (!item.unavailableReason) return undefined;
  // Layer adjustments sit in the Filter group but do not run the destructive filter
  // pipeline, so they must not inherit "필터를 적용할 수 없습니다" — their blocker is
  // always "no image layer selected".
  const layerAdjustment = path === "filter/levels" || path === "filter/tone-curve";
  if (!layerAdjustment && path.startsWith("filter/") && state.filterDisabled) {
    // 상태가 구체적인 사유를 들고 왔으면 **그 문장이 정본**이다. 정적 키
    // (`studio.mainMenu.item.filter.unavailable`)는 "왜 막혔는지 모를 때" 쓰는 일반 문구이고,
    // `localizeText`는 키가 팩에 있으면 fallback 인자를 통째로 버린다 — 즉 여기서 키를 먼저
    // 물으면 어렵게 계산한 사유("자동 줄바꿈 글상자를 …", "지우개 자국이 남은 레이어를 …")가
    // 매번 일반 문구로 덮여 사라진다. 실제로 그래서 51개 항목이 전부 같은 한 줄만 보여 줬다.
    // 다만 그 "정본"은 저자형 한국어라, 로케일 팩이 붙은 비한국어 화면에서는 메뉴 라벨만
    // 영어가 되고 사유만 한국어로 남았다(실측: en 로케일에서 "Required conditions: 마스터
    // 편집에서는 필터를 적용할 이미지 레이어를 선택하세요."). 계산된 사유를 버리지 않으면서
    // 로케일만 맞추려면 여기서 문장 표로 옮기는 수밖에 없다 — 팩에 키를 넣는 길은 75개 팩
    // 동수 계약(현재 팩당 1,323키) 때문에 막혀 있다(모듈 헤더 참고).
    if (state.filterUnavailableReason) {
      return localizeStudioFilterUnavailableReason(state.filterUnavailableReason, t);
    }
    return localizeText(
      t,
      "현재 편집 상태에서는 필터를 적용할 수 없습니다.",
      "studio.mainMenu.item.filter.unavailable",
    );
  }
  if (path === "filter/last-filter" && !state.lastFilterDraft) {
    return localizeText(
      t,
      item.unavailableReason,
      "studio.mainMenu.item.filter.last-filter.empty-unavailable",
    );
  }
  const key = path.startsWith("view/color-vision-")
    ? "studio.mainMenu.item.view.color-vision.unavailable"
    : `studio.mainMenu.item.${path.replace("/", ".")}.unavailable`;
  return localizeText(t, item.unavailableReason, key);
}

export function localizeStudioMainMenuGroups(
  groups: readonly StudioMainMenuGroup[],
  state: StudioMainMenuLocalizationState,
  t: StudioMainMenuTranslate,
): StudioMainMenuGroup[] {
  return groups.map((group) => ({
    ...group,
    label: localizeText(
      t,
      group.label,
      group.labelKey ?? `studio.mainMenu.group.${group.id}.label`,
    ),
    items: group.items.map((rawItem) => {
      const item = rawItem as StudioMainMenuLocalizableItem;
      const path = localePath(group.id, item);
      return {
        ...item,
        label: localizeItemLabel(path, item, state, t),
        unavailableReason: localizeUnavailableReason(path, item, state, t),
      };
    }),
  }));
}
