// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioFrameAnimationPanel,
  type StudioFrameAnimationPanelProps,
} from "./StudioFrameAnimationPanel";

function baseProps(
  overrides: Partial<StudioFrameAnimationPanelProps> = {}
): StudioFrameAnimationPanelProps {
  return {
    element: {
      id: "el-1",
      src: "data:image/png;base64,",
      width: 320,
      height: 240,
      rotation: 0,
      frames: [
        { id: "f1", src: "data:image/png;base64,a" },
        { id: "f2", src: "data:image/png;base64,b" },
      ],
      frameFps: 12,
      frameLoop: true,
      activeFrameId: "f1",
    },
    title: "테스트 작품",
    onClose: vi.fn(),
    onFramesChange: vi.fn(),
    onSettingsChange: vi.fn(),
    onActiveFrameChange: vi.fn(),
    onCaptureFrame: vi.fn(),
    onRemoveAnimation: vi.fn(),
    onionSkin: { enabled: false, prevCount: 1, nextCount: 1, opacity: 0.35, tint: true },
    onOnionSkinChange: vi.fn(),
    ...overrides,
  };
}

function openExportAccordion(): void {
  fireEvent.click(screen.getByRole("button", { name: /애니메이션 내보내기 \(WebM · GIF · APNG\)/u }));
}

afterEach(cleanup);

describe("StudioFrameAnimationPanel 내보내기 포맷 선택", () => {
  it("기본 WebM 포맷은 반복 횟수를 보여주고 GIF 전용 옵션은 숨긴다", () => {
    render(<StudioFrameAnimationPanel {...baseProps()} />);
    openExportAccordion();

    expect(screen.getByLabelText("포맷")).toHaveProperty("value", "webm");
    expect(screen.getByLabelText("반복 횟수")).toBeTruthy();
    expect(screen.queryByLabelText(/디더링/u)).toBeNull();
    expect(screen.queryByLabelText("투명 배경으로 내보내기")).toBeNull();
    expect(screen.getByRole("button", { name: "영상 내보내기" })).toBeTruthy();
    // jsdom에는 MediaRecorder가 없다 — WebM 미지원 안내가 GIF/APNG 대안을 알려준다.
    expect(screen.getByText(/GIF나 APNG 포맷을 선택하면 계속 내보낼 수 있어요/u)).toBeTruthy();
  });

  it("GIF 포맷은 디더링·투명 배경을 보여주고 반복 횟수(무한 반복 고정)를 숨긴다", () => {
    render(<StudioFrameAnimationPanel {...baseProps()} />);
    openExportAccordion();

    fireEvent.change(screen.getByLabelText("포맷"), { target: { value: "gif" } });

    expect(screen.getByLabelText(/디더링/u)).toBeTruthy();
    expect(screen.getByLabelText("투명 배경으로 내보내기")).toBeTruthy();
    expect(screen.queryByLabelText("반복 횟수")).toBeNull();
    expect(screen.getByText(/무한 반복으로 저장돼요/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "GIF 내보내기" })).toBeTruthy();

    // 투명 배경을 켜면 배경색 선택이 사라진다.
    expect(screen.getByText(/^배경색$/u)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("투명 배경으로 내보내기"));
    expect(screen.queryByText(/^배경색$/u)).toBeNull();
  });

  it("APNG 포맷은 디더링 없이 투명 배경 옵션과 APNG 버튼을 보여준다", () => {
    render(<StudioFrameAnimationPanel {...baseProps()} />);
    openExportAccordion();

    fireEvent.change(screen.getByLabelText("포맷"), { target: { value: "apng" } });

    expect(screen.queryByLabelText(/디더링/u)).toBeNull();
    expect(screen.getByLabelText("투명 배경으로 내보내기")).toBeTruthy();
    expect(screen.getByRole("button", { name: "APNG 내보내기" })).toBeTruthy();
    expect(screen.getByText(/무한 반복으로 저장돼요/u)).toBeTruthy();
  });

  it("프레임이 1장뿐이면 포맷과 무관하게 내보내기 안내만 보여준다", () => {
    const props = baseProps();
    props.element = {
      ...props.element,
      frames: [{ id: "f1", src: "data:image/png;base64,a" }],
      activeFrameId: "f1",
    };
    render(<StudioFrameAnimationPanel {...props} />);
    openExportAccordion();

    expect(screen.getByText("프레임이 2장 이상일 때 애니메이션을 내보낼 수 있어요.")).toBeTruthy();
    expect(screen.queryByLabelText("포맷")).toBeNull();
  });
});
