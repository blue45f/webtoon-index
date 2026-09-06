// StudioQuickActionsMenu는 실제 제스처 기하를 studio-quick-actions.test.ts에 위임한다.
// 여기서는 node 환경의 정적 렌더로 메뉴·비활성 상태·구성 시트의 모바일 접근성 계약을 검증한다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
  QUICK_ACTION_SLOTS,
} from "./studio-quick-actions";
import {
  StudioQuickActionsCustomizationSheet,
  StudioQuickActionsMenu,
} from "./StudioQuickActionsMenu";

import type { StudioQuickActionsMenuProps } from "./StudioQuickActionsMenu";

const noop = () => {
  // 정적 렌더 테스트에서는 콜백을 실행하지 않는다.
};

function renderMenu(overrides: Partial<StudioQuickActionsMenuProps> = {}): string {
  const props: StudioQuickActionsMenuProps = {
    open: true,
    anchor: { x: 195, y: 360 },
    preferences: DEFAULT_STUDIO_QUICK_ACTIONS,
    disabledActions: [],
    onExecute: noop,
    onPreferencesChange: noop,
    onClose: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioQuickActionsMenu {...props} />);
}

function containsNestedButton(html: string): boolean {
  return /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/.test(html);
}

describe("StudioQuickActionsMenu semantics", () => {
  it("renders nothing while closed", () => {
    expect(renderMenu({ open: false })).toBe("");
  });

  it("renders six distinct radial menuitems with action and slot labels", () => {
    const html = renderMenu();

    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="캔버스 퀵 액션"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(6);
    for (const slot of QUICK_ACTION_SLOTS) {
      expect(html).toContain(`data-quick-action-slot="${slot}"`);
    }
    expect(html).toContain("되돌리기");
    expect(html).toContain("오른쪽 위 슬롯");
    expect(html).toContain("왼쪽 아래 슬롯");
    expect(html.match(/h-16/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('aria-label="퀵 액션 드래그 선택"');
    expect(html).toContain("size-16");
    expect(html).toContain('aria-label="퀵 액션 구성 열기"');
    expect(html).toContain("min-h-11");
    expect(containsNestedButton(html)).toBe(false);
  });

  it("exposes disabled actions by accessible and visible labels", () => {
    const html = renderMenu({ disabledActions: ["undo", "pen"] });

    expect(html).toContain('aria-label="위 슬롯: 되돌리기 (사용 불가)"');
    expect(html).toContain('aria-label="아래 슬롯: 펜 (사용 불가)"');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(/>사용 불가</g)).toHaveLength(2);
  });
});

describe("StudioQuickActionsCustomizationSheet", () => {
  it("renders six labeled 44px selects with every action available to every slot", () => {
    const html = renderToStaticMarkup(
      <StudioQuickActionsCustomizationSheet
        preferences={DEFAULT_STUDIO_QUICK_ACTIONS}
        onPreferencesChange={noop}
        onDone={noop}
      />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("같은 작업을 여러 방향에 둘 수도 있어요.");
    expect(html.match(/<select\b/g)).toHaveLength(6);
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(7);
    expect(html.match(/<option\b/g)).toHaveLength(
      QUICK_ACTION_SLOTS.length * QUICK_ACTION_IDS.length
    );
    for (const slot of QUICK_ACTION_SLOTS) {
      expect(html).toContain(`data-quick-action-slot="${slot}"`);
    }
    expect(html).toContain('aria-label="위 슬롯 액션"');
    expect(html).toContain('aria-label="퀵 액션 구성 닫기"');
    expect(containsNestedButton(html)).toBe(false);
  });
});
