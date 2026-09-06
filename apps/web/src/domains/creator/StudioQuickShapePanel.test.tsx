// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioQuickShapePanel } from "./StudioQuickShapePanel";

import { useI18n } from "@/shared/lib/i18n";

beforeEach(() => {
  useI18n.getState().setLang("ko");
});

afterEach(cleanup);

describe("StudioQuickShapePanel", () => {
  it("꺼진 상태에서도 학습 경로를 노출하고 44px 터치 타깃으로 연다", () => {
    const onOpenTutorial = vi.fn();
    render(
      <StudioQuickShapePanel
        active={false}
        matchedKindLabel={null}
        onToggleActive={vi.fn()}
        onOpenTutorial={onOpenTutorial}
      />,
    );

    const tutorial = screen.getByRole("button", { name: "스마트 도형 튜토리얼 보기" });
    expect(tutorial.className).toContain("min-h-11");
    expect(tutorial.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(tutorial);
    expect(onOpenTutorial).toHaveBeenCalledOnce();
  });
});
