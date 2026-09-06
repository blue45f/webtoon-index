// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioRetouchQuickGuide } from "./StudioRetouchQuickGuide";

afterEach(cleanup);

describe("StudioRetouchQuickGuide", () => {
  it("준비·활성·반영·차단 상태를 하나의 접근 가능한 status로 구분한다", () => {
    const view = render(<StudioRetouchQuickGuide toolId="smudge" active={false} />);
    expect(screen.getByRole("status").textContent).toContain("준비됨");
    expect(screen.getByRole("status").getAttribute("data-studio-retouch-state")).toBe("ready");

    view.rerender(<StudioRetouchQuickGuide toolId="smudge" active />);
    expect(screen.getByRole("status").textContent).toContain("도구 켜짐");

    view.rerender(<StudioRetouchQuickGuide toolId="smudge" active busy />);
    expect(screen.getByRole("status").textContent).toContain("반영 중");
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");

    view.rerender(
      <StudioRetouchQuickGuide
        toolId="smudge"
        active={false}
        disabled
        disabledReason="검토 잠금을 해제하세요."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("대상 준비 필요");
    expect(screen.getByRole("status").textContent).toContain("검토 잠금을 해제하세요");
  });

  it("세로 공간을 늘리지 않다가 필요할 때 정확한 3단계와 자동 복사 안내를 펼친다", () => {
    render(<StudioRetouchQuickGuide toolId="wet-mix" active={false} />);

    const details = screen.getByText("처음이라면 · 3단계").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("처음이라면 · 3단계"));

    const list = screen.getByRole("list", { name: "물감 섞어 칠하기 첫 사용 3단계" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list.textContent).toContain("벡터 선·도형");
    expect(list.textContent).toContain("편집용 이미지 복사본");
    expect(list.textContent).toContain("⌘Z");
  });

  it("짧은 안내에서 같은 도구의 상세 튜토리얼로 한 번에 이동한다", () => {
    const onOpenTutorial = vi.fn();
    render(
      <StudioRetouchQuickGuide
        toolId="liquify"
        active={false}
        onOpenTutorial={onOpenTutorial}
      />,
    );

    fireEvent.click(screen.getByText("처음이라면 · 3단계"));
    const button = screen.getByRole("button", { name: "형태 밀어 변형 상세 튜토리얼 열기" });
    expect(button.className).toContain("min-h-11");
    fireEvent.click(button);
    expect(onOpenTutorial).toHaveBeenCalledOnce();
  });
});
