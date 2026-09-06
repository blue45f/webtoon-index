// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EXTENDED_BLEND_MODES } from "./studio-extended-blend";
import {
  StudioExtendedBlendPanel,
  type StudioExtendedBlendPanelProps,
} from "./StudioExtendedBlendPanel";

afterEach(cleanup);

function renderPanel(overrides: Partial<StudioExtendedBlendPanelProps> = {}) {
  const props: StudioExtendedBlendPanelProps = {
    mode: "linear-dodge",
    opacity: 1,
    onModeChange: vi.fn(),
    onOpacityChange: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  };
  render(<StudioExtendedBlendPanel {...props} />);
  return props;
}

describe("StudioExtendedBlendPanel", () => {
  it("10개 모드 칩을 한글 라벨로 모두 렌더링한다", () => {
    renderPanel();
    for (const label of [
      "선형 닷지(더하기)",
      "선형 번",
      "비비드 라이트",
      "선형 라이트",
      "핀 라이트",
      "하드 믹스",
      "어두운 색상",
      "밝은 색상",
      "빼기",
      "나누기",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(EXTENDED_BLEND_MODES).toHaveLength(10);
  });

  it("선택 모드 칩만 aria-pressed 이고, 다른 칩 클릭 시 onModeChange 를 부른다", () => {
    const props = renderPanel({ mode: "pin-light" });
    expect(
      screen.getByRole("button", { name: "핀 라이트" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "선형 번" }).getAttribute("aria-pressed")
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "선형 번" }));
    expect(props.onModeChange).toHaveBeenCalledWith("linear-burn");
  });

  it("불투명도 슬라이더가 % readout 을 보여주고 변경 시 onOpacityChange 를 부른다", () => {
    const props = renderPanel({ opacity: 0.6 });
    expect(screen.getByText("60%")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.35" } });
    expect(props.onOpacityChange).toHaveBeenCalledWith(0.35);
  });

  it("병합 버튼 클릭 시 onApply 를 부른다", () => {
    const props = renderPanel();
    const apply = screen.getByRole("button", { name: "아래 레이어와 병합" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it("busy 면 모든 컨트롤을 잠그고 진행 문구를 보여준다", () => {
    const props = renderPanel({ busy: true });
    expect(screen.getByRole("status").textContent).toContain("병합하는 중");
    const apply = screen.getByRole("button", { name: "아래 레이어와 병합" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    const chip = screen.getByRole("button", { name: "나누기" });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(apply);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("unavailableReason 이 있으면 병합만 잠그고 사유를 보여준다(모드 선택은 가능)", () => {
    const reason = "이미지 요소와 그 아래 이미지 요소를 선택해야 합니다.";
    const props = renderPanel({ unavailableReason: reason });
    expect(screen.getByRole("status").textContent).toBe(reason);
    const apply = screen.getByRole("button", { name: "아래 레이어와 병합" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(apply);
    expect(props.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "하드 믹스" }));
    expect(props.onModeChange).toHaveBeenCalledWith("hard-mix");
  });

  it("previewDataUrl 이 있으면 미리보기 썸네일을 보여주고 없으면 숨긴다", () => {
    renderPanel({ previewDataUrl: "data:image/png;base64,AAAA" });
    const preview = screen.getByAltText("확장 블렌드 미리보기") as HTMLImageElement;
    expect(preview.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    cleanup();
    renderPanel();
    expect(screen.queryByAltText("확장 블렌드 미리보기")).toBeNull();
  });
});
