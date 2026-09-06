/**
 * Studio Workbench Tabs — 컴패니언 창(어시스턴트 · AI 스위트)이 공유하는 접근성 탭 스트립.
 *
 * 왜 새로 만드는가 — 기존 자산으로는 계약을 채울 수 없다:
 *  - `StudioMenuSubtabs`(studio-chrome-ui.tsx)는 메뉴용 세그먼트 칩이다. role="tablist"/"tab"은
 *    내지만 aria-controls·안정 id·roving tabIndex·방향키가 전부 없고, `flex-wrap` 으로 줄바꿈한다.
 *    좁은 컴패니언 창에서는 탭이 여러 줄로 쌓여 본문 높이를 먹는다.
 *  - `StudioInspectorNavigator` 의 `moveTabFocus` 가 WAI-ARIA 방향키 의미를 정확히 구현하지만
 *    파일 지역 함수라 import 할 수 없다.
 * 이 모듈은 그 둘을 하나의 export 로 합칠 뿐, 새 토큰이나 새 모달 셸을 만들지 않는다.
 * 포커스 링·터치 타깃·이징은 studio-panel-ui 의 공용 토큰을 그대로 쓴다.
 */
import { useRef } from "react";

import { STUDIO_EASE, STUDIO_FOCUS_RING, STUDIO_TOUCH_TARGET } from "./studio-panel-ui";

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

/* eslint-disable react-refresh/only-export-components -- tab id helpers ship beside the strip they describe */

export interface StudioWorkbenchTab {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** 탭 버튼 id. 패널의 aria-labelledby 가 이 값을 가리킨다. */
export function studioWorkbenchTabId(idPrefix: string, tabId: string): string {
  return `${idPrefix}-tab-${tabId}`;
}

/** 탭 패널 id. 탭 버튼의 aria-controls 가 이 값을 가리킨다. */
export function studioWorkbenchTabPanelId(idPrefix: string, tabId: string): string {
  return `${idPrefix}-panel-${tabId}`;
}

/**
 * 패널 쪽에 그대로 스프레드하는 a11y 속성 묶음.
 * `<section {...studioWorkbenchTabPanelProps(prefix, activeId)}>` 한 줄로 탭↔패널을 잇는다.
 * tabIndex 0 은 포커스 가능한 자식이 없는 패널도 키보드로 스크롤할 수 있게 한다(WAI-ARIA 권고).
 */
export function studioWorkbenchTabPanelProps(
  idPrefix: string,
  tabId: string
): {
  readonly role: "tabpanel";
  readonly id: string;
  readonly "aria-labelledby": string;
  readonly tabIndex: 0;
} {
  return {
    role: "tabpanel",
    id: studioWorkbenchTabPanelId(idPrefix, tabId),
    "aria-labelledby": studioWorkbenchTabId(idPrefix, tabId),
    tabIndex: 0,
  };
}

export interface StudioWorkbenchTabStripProps {
  readonly tabs: readonly StudioWorkbenchTab[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly ariaLabel: string;
  readonly idPrefix: string;
  readonly className?: string;
}

/**
 * 가로 스크롤 탭 스트립. 줄바꿈하지 않는다 — 좁은 컴패니언 창에서 탭이 쌓이면 본문이 밀린다.
 * 방향키(순환)·Home/End 는 포커스와 선택을 함께 옮긴다(WAI-ARIA automatic activation).
 */
export function StudioWorkbenchTabStrip({
  tabs,
  activeId,
  onSelect,
  ariaLabel,
  idPrefix,
  className,
}: StudioWorkbenchTabStripProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  // activeId 가 카탈로그에 없으면(저장된 옛 탭 id 등) 첫 탭을 tabbable 로 남긴다.
  // 그렇지 않으면 모든 탭이 tabIndex -1 이 되어 스트립 전체가 키보드로 도달 불가능해진다.
  const tabbableIndex = activeIndex >= 0 ? activeIndex : 0;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (tabs.length === 0) return;

    event.preventDefault();
    // StudioPage 의 전역 방향키 nudge 가 같은 입력으로 선택 원고까지 움직이지 않게 막는다.
    // (StudioInspectorNavigator 가 같은 이유로 stopPropagation 한다.)
    event.stopPropagation();

    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;

    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    // 렌더 순서와 DOM 순서가 같으므로 인덱스로 바로 집는다(id 이스케이프 불필요).
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
      ':scope > button[role="tab"]'
    );
    buttons?.[nextIndex]?.focus();
    onSelect(nextTab.id);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex min-w-0 gap-1 overflow-x-auto pb-0.5",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            id={studioWorkbenchTabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={studioWorkbenchTabPanelId(idPrefix, tab.id)}
            tabIndex={index === tabbableIndex ? 0 : -1}
            // 좁은 컴패니언 창에서 라벨이 truncate 돼도 전체 이름이 남도록.
            title={tab.label}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5",
              "text-[0.72rem] font-semibold tracking-tight",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET,
              active
                ? "border-accent/50 bg-accent-soft text-fg"
                : "border-transparent bg-transparent text-fg-3 hover:bg-raised/90 hover:text-fg-2"
            )}
          >
            <Icon
              size={14}
              strokeWidth={1.85}
              aria-hidden
              className={active ? "text-accent" : undefined}
            />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
