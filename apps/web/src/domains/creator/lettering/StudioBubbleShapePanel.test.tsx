// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBubbleShapePanel, type StudioBubbleShapePanelProps } from "./StudioBubbleShapePanel";

afterEach(cleanup);

function props(overrides: Partial<StudioBubbleShapePanelProps> = {}): StudioBubbleShapePanelProps {
  return {
    active: false,
    hasCustomShape: false,
    pointCount: 0,
    selectedPointIndex: null,
    onAddPoint: vi.fn(),
    onConvert: vi.fn(),
    onQuickTransform: vi.fn(),
    onRemovePoint: vi.fn(),
    onRevert: vi.fn(),
    onToggleEdit: vi.fn(),
    ...overrides,
  };
}

describe("StudioBubbleShapePanel quick transforms", () => {
  it("두 줄의 모바일 터치 버튼으로 6개 변형을 한 번에 전달한다", () => {
    const panelProps = props();
    render(<StudioBubbleShapePanel {...panelProps} />);

    const expected = [
      ["말풍선 가로 넓히기 (12%)", "widen"],
      ["말풍선 가로 좁히기 (12%)", "narrow"],
      ["말풍선 세로 높이기 (12%)", "heighten"],
      ["말풍선 세로 낮추기 (12%)", "shorten"],
      ["말풍선 외곽선과 꼬리를 좌우 반전", "flip-horizontal"],
      ["말풍선 외곽선과 꼬리를 상하 반전", "flip-vertical"],
    ] as const;
    for (const [name, action] of expected) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("min-h-11");
      fireEvent.click(button);
      expect(panelProps.onQuickTransform).toHaveBeenLastCalledWith(action);
    }
    expect(panelProps.onQuickTransform).toHaveBeenCalledTimes(6);
  });

  it("잠금 상태에서 모든 변형을 막고 자동 부착 꼬리는 반전만 이유와 함께 막는다", () => {
    const { rerender } = render(
      <StudioBubbleShapePanel {...props({ quickTransformDisabled: true })} />
    );
    expect(screen.getAllByRole("button", { name: /말풍선/ }).every((button) => button.hasAttribute("disabled"))).toBe(
      true
    );

    rerender(<StudioBubbleShapePanel {...props({ quickTransformFlipDisabled: true })} />);
    expect(screen.getByRole("button", { name: /좌우 반전 — 꼬리 자동 부착/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /상하 반전 — 꼬리 자동 부착/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /가로 넓히기/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("좌우·상하 반전은 해제 후");
  });

  it("double 말풍선은 커스텀 조각만 숨기고 빠른 변형은 보존한다", () => {
    render(<StudioBubbleShapePanel {...props({ canCustomize: false })} />);
    expect(screen.getByRole("region", { name: "말풍선 빠른 변형" })).toBeTruthy();
    expect(screen.queryByText("커스텀 모양")).toBeNull();
    expect(screen.queryByRole("button", { name: "커스텀 모양으로 전환" })).toBeNull();
  });

  it("크기 한계와 대칭 반전을 action별로 비활성화하고 이유를 보여준다", () => {
    render(
      <StudioBubbleShapePanel
        {...props({
          quickTransformUnavailableReasons: {
            narrow: "최소 너비 60px입니다.",
            "flip-horizontal": "반전할 비대칭 외곽선이나 꼬리가 없습니다.",
          },
        })}
      />
    );

    expect(screen.getByRole("button", { name: /가로 좁히기.*최소 너비/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /좌우 반전.*반전할 비대칭/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /가로 넓히기/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("최소 너비 60px");
    expect(screen.getByRole("status").textContent).toContain("반전할 비대칭");
  });

  it("기존 점 추가·삭제 안내를 그대로 유지한다", () => {
    render(<StudioBubbleShapePanel {...props({ active: true, hasCustomShape: true, pointCount: 8 })} />);
    expect(screen.getByText(/Shift\+외곽선 클릭/)).toBeTruthy();
    expect(screen.getByText(/Alt\+점 클릭/)).toBeTruthy();
    expect(screen.getByText(/Delete로 삭제/)).toBeTruthy();
  });

  it("키보드 없이 점을 추가하고 선택 점을 삭제하는 44px 터치 액션을 제공한다", () => {
    const panelProps = props({ active: true, hasCustomShape: true, pointCount: 8, selectedPointIndex: 2 });
    render(<StudioBubbleShapePanel {...panelProps} />);

    const add = screen.getByRole("button", { name: "선택한 3번 점 다음 선분에 점 추가" });
    const remove = screen.getByRole("button", { name: "선택한 3번 외곽선 점 삭제" });
    expect(add.className).toContain("min-h-11");
    expect(remove.className).toContain("min-h-11");
    fireEvent.click(add);
    fireEvent.click(remove);
    expect(panelProps.onAddPoint).toHaveBeenCalledOnce();
    expect(panelProps.onRemovePoint).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("3번 점 선택됨");
  });

  it("점 미선택 시 가장 긴 선분 추가를 안내하고 삭제는 막는다", () => {
    const panelProps = props({ active: true, hasCustomShape: true, pointCount: 8 });
    render(<StudioBubbleShapePanel {...panelProps} />);
    expect(screen.getByRole("button", { name: "가장 긴 외곽선 선분에 점 추가" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "삭제할 외곽선 점을 먼저 선택" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("가장 긴 선분의 중점");
  });

  it("최소 3점이거나 잠금 상태면 수정 액션을 안전하게 막는다", () => {
    const { rerender } = render(
      <StudioBubbleShapePanel
        {...props({ active: true, hasCustomShape: true, pointCount: 3, selectedPointIndex: 1 })}
      />
    );
    expect(screen.getByRole("button", { name: /선택한 2번 외곽선 점 삭제/ }).hasAttribute("disabled")).toBe(true);

    rerender(
      <StudioBubbleShapePanel
        {...props({
          active: true,
          hasCustomShape: true,
          pointActionsDisabled: true,
          pointCount: 8,
          selectedPointIndex: 1,
        })}
      />
    );
    expect(screen.getByRole("button", { name: /선택한 2번 점 다음/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /선택한 2번 외곽선 점 삭제/ }).hasAttribute("disabled")).toBe(true);
  });
});
