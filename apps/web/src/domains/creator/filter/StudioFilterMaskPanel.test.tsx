// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioFilterMaskPanel,
  type StudioFilterMaskPanelProps,
} from "./StudioFilterMaskPanel";

afterEach(cleanup);

function makeProps(
  overrides: Partial<StudioFilterMaskPanelProps> = {}
): StudioFilterMaskPanelProps {
  return {
    hasMask: false,
    enabled: true,
    hasActiveFilters: true,
    paintActive: false,
    paintMode: "reveal",
    radiusPx: 48,
    hardness: 0.6,
    strength: 1,
    maskThumbnailSrc: null,
    busy: false,
    onAddMask: vi.fn(),
    onDeleteMask: vi.fn(),
    onToggleEnabled: vi.fn(),
    onInvert: vi.fn(),
    onTogglePaintActive: vi.fn(),
    onPaintModeChange: vi.fn(),
    onRadiusChange: vi.fn(),
    onHardnessChange: vi.fn(),
    onStrengthChange: vi.fn(),
    ...overrides,
  };
}

describe("StudioFilterMaskPanel", () => {
  it("마스크가 없으면 추가 액션 2종만 보여주고 각각 reveal/conceal로 호출한다", () => {
    const props = makeProps();
    render(<StudioFilterMaskPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /마스크 추가/ }));
    expect(props.onAddMask).toHaveBeenCalledWith("reveal");
    fireEvent.click(screen.getByRole("button", { name: /원본으로 추가/ }));
    expect(props.onAddMask).toHaveBeenCalledWith("conceal");
    // 마스크가 없으면 브러시/삭제/반전 컨트롤은 아직 노출되지 않는다.
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /반전/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /마스크에 그리기/ })).toBeNull();
  });

  it("마스크가 있으면 켬/끔·반전·삭제·브러시 무장 토글을 노출하고 콜백을 전달한다", () => {
    const props = makeProps({ hasMask: true });
    render(<StudioFilterMaskPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "사용 중" }));
    expect(props.onToggleEnabled).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /반전/ }));
    expect(props.onInvert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /삭제/ }));
    expect(props.onDeleteMask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /마스크에 그리기/ }));
    expect(props.onTogglePaintActive).toHaveBeenCalledTimes(1);
  });

  it("enabled=false면 켬/끔 칩이 '꺼짐'으로 표시된다", () => {
    render(<StudioFilterMaskPanel {...makeProps({ hasMask: true, enabled: false })} />);
    expect(screen.getByRole("button", { name: "꺼짐" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("브러시 모드 칩이 필터 적용/원본 유지로 표기되고 onPaintModeChange를 호출한다", () => {
    const props = makeProps({ hasMask: true, paintMode: "reveal" });
    render(<StudioFilterMaskPanel {...props} />);

    const reveal = screen.getByRole("button", { name: /필터 적용/ });
    const conceal = screen.getByRole("button", { name: /원본 유지/ });
    expect(reveal.getAttribute("aria-pressed")).toBe("true");
    expect(conceal.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(conceal);
    expect(props.onPaintModeChange).toHaveBeenCalledWith("conceal");
  });

  it("크기/경도/강도 슬라이더가 범위 상수로 렌더되고 변경 콜백을 숫자로 전달한다", () => {
    const props = makeProps({ hasMask: true });
    render(<StudioFilterMaskPanel {...props} />);

    const radius = screen.getByLabelText(/브러시 크기/) as HTMLInputElement;
    expect(radius.min).toBe("6");
    expect(radius.max).toBe("240");
    fireEvent.change(radius, { target: { value: "120" } });
    expect(props.onRadiusChange).toHaveBeenCalledWith(120);

    fireEvent.change(screen.getByLabelText(/경도/), { target: { value: "0.3" } });
    expect(props.onHardnessChange).toHaveBeenCalledWith(0.3);

    fireEvent.change(screen.getByLabelText(/강도/), { target: { value: "0.5" } });
    expect(props.onStrengthChange).toHaveBeenCalledWith(0.5);
  });

  it("마스크 썸네일은 filterMaskSrc를 검은 배경 위에 그대로 얹는다", () => {
    const { container } = render(
      <StudioFilterMaskPanel
        {...makeProps({ hasMask: true, maskThumbnailSrc: "data:image/png;base64,thumb" })}
      />
    );
    const thumbnail = container.querySelector("img");
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.getAttribute("src")).toBe("data:image/png;base64,thumb");
  });

  it("상태 문구 — busy > 활성 필터 없음 안내 > 꺼짐 안내 순서로 보여준다", () => {
    const { rerender } = render(
      <StudioFilterMaskPanel {...makeProps({ hasMask: true, busy: true, hasActiveFilters: false })} />
    );
    expect(screen.getByRole("status").textContent).toContain("적용하는 중");

    rerender(
      <StudioFilterMaskPanel {...makeProps({ hasMask: true, hasActiveFilters: false })} />
    );
    expect(screen.getByRole("status").textContent).toContain("활성 필터·보정이 없어");

    rerender(
      <StudioFilterMaskPanel
        {...makeProps({ hasMask: true, hasActiveFilters: true, enabled: false })}
      />
    );
    expect(screen.getByRole("status").textContent).toContain("꺼져 있어요");
  });

  it("무장 상태에서는 드래그 안내 문구를 보여준다", () => {
    render(
      <StudioFilterMaskPanel {...makeProps({ hasMask: true, paintActive: true })} />
    );
    expect(screen.getByRole("status").textContent).toContain("이미지를 드래그해 칠하세요");
  });

  it("busy 중에는 중복 변경을 잠그고 활성 그리기 도구 종료만 허용한다", () => {
    const props = makeProps({ hasMask: true, paintActive: true, busy: true });
    render(<StudioFilterMaskPanel {...props} />);

    const region = screen.getByRole("region", { name: "필터 마스크" });
    const exitButton = screen.getByRole("button", { name: "필터 마스크 그리기 종료" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect((exitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(exitButton);
    expect(props.onTogglePaintActive).toHaveBeenCalledTimes(1);

    for (const name of ["사용 중", "반전", "삭제", "필터 적용", "원본 유지"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      screen.getAllByRole("slider").every((slider) => (slider as HTMLInputElement).disabled)
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "반전" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(props.onInvert).not.toHaveBeenCalled();
    expect(props.onDeleteMask).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("‘그리기 종료’");
  });

  it("busy 중 새 마스크 추가를 막고 터치 환경에서 44px 타깃 계약을 유지한다", () => {
    const props = makeProps({ busy: true });
    render(<StudioFilterMaskPanel {...props} />);

    const addButton = screen.getByRole("button", { name: /마스크 추가/ });
    const concealButton = screen.getByRole("button", { name: /원본으로 추가/ });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    expect((concealButton as HTMLButtonElement).disabled).toBe(true);
    expect(addButton.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(addButton);
    fireEvent.click(concealButton);
    expect(props.onAddMask).not.toHaveBeenCalled();
  });
});
