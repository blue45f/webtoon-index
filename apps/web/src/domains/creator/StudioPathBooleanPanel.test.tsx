// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPathBooleanPanel, type StudioPathBooleanPanelProps } from "./StudioPathBooleanPanel";

afterEach(cleanup);

const OP_LABELS = ["합치기", "빼기", "교차", "제외"];

function props(overrides: Partial<StudioPathBooleanPanelProps> = {}): StudioPathBooleanPanelProps {
  return {
    busy: false,
    unavailableReason: null,
    onApply: vi.fn(),
    ...overrides,
  };
}

describe("StudioPathBooleanPanel", () => {
  it("4개 연산 버튼을 렌더하고 클릭 시 해당 op 로 onApply 를 호출한다", () => {
    const onApply = vi.fn();
    render(<StudioPathBooleanPanel {...props({ onApply })} />);
    for (const label of OP_LABELS) {
      expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith("subtract");
  });

  it("unavailableReason 이 있으면 버튼을 잠그고 사유를 보여준다", () => {
    const onApply = vi.fn();
    const reason = "캔버스에서 도형 2개를 함께 선택하세요(드래그 선택).";
    render(<StudioPathBooleanPanel {...props({ onApply, unavailableReason: reason })} />);
    for (const label of OP_LABELS) {
      expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(true);
    }
    expect(screen.getByRole("status").textContent).toContain(reason);
    fireEvent.click(screen.getByRole("button", { name: "합치기" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("busy 면 버튼을 잠그고 진행 문구를 보여준다", () => {
    render(<StudioPathBooleanPanel {...props({ busy: true })} />);
    expect(screen.getByRole("button", { name: "교차" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("도형을 결합하는 중...");
  });
});
