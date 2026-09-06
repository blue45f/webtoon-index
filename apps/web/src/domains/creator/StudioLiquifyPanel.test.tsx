// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioLiquifyPanel, type StudioLiquifyPanelProps } from "./StudioLiquifyPanel";

function props(overrides: Partial<StudioLiquifyPanelProps> = {}): StudioLiquifyPanelProps {
  return {
    active: false,
    radius: 80,
    strength: 50,
    onToggleActive: vi.fn(),
    onRadiusChange: vi.fn(),
    onStrengthChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioLiquifyPanel", () => {
  it("기존 호출부는 Push 기본 모드와 설명을 유지하며 미연결 모드 선택기를 숨긴다", () => {
    render(<StudioLiquifyPanel {...props()} />);
    expect(screen.getByRole("heading", { name: "형태 밀어 변형 · 리퀴파이 · 밀기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "밀어서 왜곡하기 켜기" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "리퀴파이 왜곡 방식" })).toBeNull();
  });

  it("연결된 모드 선택기는 다섯 모드를 노출하고 한 번의 클릭으로 정확한 모드를 전달한다", () => {
    const onModeChange = vi.fn();
    render(<StudioLiquifyPanel {...props({ mode: "pinch", onModeChange })} />);

    const group = screen.getByRole("group", { name: "왜곡 방식" });
    expect(group.querySelectorAll("button")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "오므리기" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "반시계 회전" }));
    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("twirl-counterclockwise");
  });

  it("현재 모드에 맞는 동작·상태 문구를 제공하고 busy 동안 조작을 잠근다", () => {
    render(<StudioLiquifyPanel {...props({ active: true, busy: true, mode: "bloat", onModeChange: vi.fn() })} />);
    expect(screen.getByRole("heading", { name: "형태 밀어 변형 · 리퀴파이 · 부풀리기" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("형태 변형 한 획");
    expect((screen.getByRole("button", { name: "바깥으로 부풀리기 끄기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "밀기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: /브러시 크기/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: /강도/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("비정상 런타임 mode 값은 안전하게 Push로 표현한다", () => {
    render(<StudioLiquifyPanel {...props({ mode: "corrupt" as StudioLiquifyPanelProps["mode"] })} />);
    expect(screen.getByRole("heading", { name: "형태 밀어 변형 · 리퀴파이 · 밀기" })).toBeTruthy();
  });

  it("연결된 고급 설정만 점진적으로 노출하고 필압 최소 크기의 의존 상태를 설명한다", () => {
    const onHardnessChange = vi.fn();
    const onMinimumRadiusChange = vi.fn();
    const onTogglePressureRadius = vi.fn();
    render(<StudioLiquifyPanel {...props({
      hardness: 65,
      minimumRadius: 25,
      pressureAffectsRadius: false,
      onHardnessChange,
      onMinimumRadiusChange,
      onTogglePressureRadius,
    })} />);

    expect(screen.getByText("세부 조절")).toBeTruthy();
    fireEvent.click(screen.getByText("세부 조절"));
    const hardness = screen.getByRole("slider", { name: /경도/ });
    const minimumRadius = screen.getByRole("slider", { name: /최소 크기/ }) as HTMLInputElement;
    expect((hardness as HTMLInputElement).value).toBe("65");
    expect(minimumRadius.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "필압으로 크기 조절 켜기" }));
    expect(onTogglePressureRadius).toHaveBeenCalledOnce();
  });

  it("누적 변위 세션이 연결된 경우에만 복원과 스무딩 작업을 제공한다", () => {
    const onReconstruct = vi.fn();
    const onSmooth = vi.fn();
    render(<StudioLiquifyPanel {...props({ onReconstruct, onSmooth })} />);
    fireEvent.click(screen.getByText("세부 조절"));

    fireEvent.click(screen.getByRole("button", { name: /원형 복원/ }));
    fireEvent.click(screen.getByRole("button", { name: /변위 매끄럽게/ }));
    expect(onReconstruct).toHaveBeenCalledOnce();
    expect(onSmooth).toHaveBeenCalledOnce();
  });
});
