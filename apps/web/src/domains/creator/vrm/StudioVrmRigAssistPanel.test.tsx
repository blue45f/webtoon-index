// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioVrmRigAssistPanel } from "./StudioVrmRigAssistPanel";

import type { ComponentProps } from "react";

afterEach(cleanup);

function renderPanel(overrides: Partial<ComponentProps<typeof StudioVrmRigAssistPanel>> = {}) {
  const props: ComponentProps<typeof StudioVrmRigAssistPanel> = {
    disabled: false,
    jointProfile: "neutral",
    fullBodyIk: false,
    footPlant: false,
    floorHeight: 0,
    rootYOffset: 0.15,
    translations: {
      version: 1,
      root: [0.25, 0, -0.5],
      hips: [0.1, -0.2, 0.3],
      spine: [0.02, 0.04, -0.06],
    },
    ikConstraints: [],
    onJointProfileChange: vi.fn(),
    onFullBodyIkChange: vi.fn(),
    onFootPlantChange: vi.fn(),
    onFloorHeightChange: vi.fn(),
    onResetTranslations: vi.fn(),
    onConstraintEnabledChange: vi.fn(),
    onConstraintLockedChange: vi.fn(),
    onConstraintRemove: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<StudioVrmRigAssistPanel {...props} />) };
}

describe("StudioVrmRigAssistPanel", () => {
  it("shows the non-medical drawing notice and all versioned profile choices", () => {
    renderPanel();
    expect(screen.getByText(/스타일화된 그림 참고용 프리셋/)).toBeTruthy();
    expect(screen.getByText(/의료 기능이 아닙니다/)).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByRole("option", { name: "제한된 연출" })).toBeTruthy();
  });

  it("emits controlled profile, assist, plant, and floor changes", () => {
    const { props, view } = renderPanel();
    fireEvent.change(screen.getByLabelText("관절 드로잉 프로필"), {
      target: { value: "limited" },
    });
    fireEvent.click(screen.getByLabelText("전신 IK 보조"));
    fireEvent.click(screen.getByLabelText("발 바닥 고정"));
    view.rerender(<StudioVrmRigAssistPanel {...props} footPlant />);
    fireEvent.change(screen.getByLabelText("발 고정 바닥 높이"), {
      target: { value: "-0.35" },
    });

    expect(props.onJointProfileChange).toHaveBeenCalledWith("limited");
    expect(props.onFullBodyIkChange).toHaveBeenCalledWith(true);
    expect(props.onFootPlantChange).toHaveBeenCalledWith(true);
    expect(props.onFloorHeightChange).toHaveBeenCalledWith(-0.35);
    fireEvent.click(screen.getByRole("button", { name: "이동 초기화" }));
    expect(props.onResetTranslations).toHaveBeenCalledTimes(1);
  });

  it("keeps the floor control disabled until planting is enabled and explains idle full-body assist", () => {
    const { view, props } = renderPanel({ fullBodyIk: true });
    expect((screen.getByLabelText("발 고정 바닥 높이") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/전신 이동은 활성 손·발/)).toBeTruthy();

    view.rerender(<StudioVrmRigAssistPanel {...props} fullBodyIk footPlant />);
    expect((screen.getByLabelText("발 고정 바닥 높이") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/전신 이동은 활성 손·발/)).toBeNull();
  });

  it("shows the canonical root, hips, and spine translations and one-commit notice", () => {
    renderPanel();
    expect(screen.getByText("0.25 / 0.15 / -0.50m")).toBeTruthy();
    expect(screen.getByText("0.10 / -0.20 / 0.30m")).toBeTruthy();
    expect(screen.getByText("0.02 / 0.04 / -0.06m")).toBeTruthy();
    expect(screen.getByText(/핸들을 놓을 때 포즈와 이동값을 한 번만 저장/)).toBeTruthy();
  });

  it("exposes persistent pin enable, lock, and explicit delete controls", () => {
    const { props } = renderPanel({
      ikConstraints: [{
        effector: "leftHand",
        enabled: true,
        locked: true,
        target: [-0.4, 1.2, 0.15],
        pole: [-0.7, 1.05, 0.3],
      }],
    });
    fireEvent.click(screen.getByLabelText("왼손 고정점 사용"));
    fireEvent.click(screen.getByLabelText("왼손 다른 포즈 편집 중 유지"));
    fireEvent.click(screen.getByRole("button", { name: "왼손 고정점 삭제" }));
    expect(props.onConstraintEnabledChange).toHaveBeenCalledWith("leftHand", false);
    expect(props.onConstraintLockedChange).toHaveBeenCalledWith("leftHand", false);
    expect(props.onConstraintRemove).toHaveBeenCalledWith("leftHand");
  });
});
