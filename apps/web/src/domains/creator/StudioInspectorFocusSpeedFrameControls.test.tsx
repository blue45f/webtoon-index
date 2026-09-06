// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioInspectorFocusSpeedFrameControls,
  type StudioInspectorFocusSpeedFrameControlsProps,
} from "./StudioInspectorFocusSpeedFrameControls";

import type { FocusLinesEl, FrameEl, SpeedLinesEl } from "./studio-element-model";

vi.mock("./studio-page-lazy-ui", () => ({
  StudioContinuityMetadataEditor: ({
    onChange,
  }: {
    onChange: (value: { location: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ location: "학교 옥상" })}>
      연속성 업데이트
    </button>
  ),
  StudioPanelSplitPanel: ({
    active,
    gutterPx,
    hint,
    onToggle,
    onGutterChange,
  }: {
    active: boolean;
    gutterPx: number;
    hint?: string | null;
    onToggle: () => void;
    onGutterChange: (value: number) => void;
  }) => (
    <section aria-label="자유선 분할 테스트 표면">
      <button type="button" onClick={onToggle}>
        {active ? "자유선 분할 끄기" : "자유선 분할 켜기"}
      </button>
      <label>
        자유선 여백
        <input
          type="range"
          value={gutterPx}
          onChange={(event) => onGutterChange(Number(event.currentTarget.value))}
        />
      </label>
      {hint ? <p role="status">{hint}</p> : null}
    </section>
  ),
}));

afterEach(cleanup);

const FOCUS_LINES: FocusLinesEl = {
  id: "focus-1",
  type: "focusLines",
  x: 0,
  y: 0,
  width: 800,
  height: 1_200,
  lineCount: 80,
  innerRadius: 100,
  outerRadius: 400,
  stroke: "#000000",
  strokeWidth: 2.5,
  noise: 20,
  rotation: 0,
  centerXRatio: 0.5,
  centerYRatio: 0.5,
};

const SPEED_LINES: SpeedLinesEl = {
  id: "speed-1",
  type: "speedLines",
  x: 0,
  y: 0,
  width: 800,
  height: 1_200,
  lineCount: 50,
  direction: "horizontal",
  stroke: "#000000",
  strokeWidth: 2.5,
  rotation: 0,
};

const FRAME: FrameEl = {
  id: "frame-1",
  type: "frame",
  x: 0,
  y: 0,
  width: 720,
  height: 480,
};

function controlProps(
  selected: FocusLinesEl | SpeedLinesEl | FrameEl
): StudioInspectorFocusSpeedFrameControlsProps {
  return {
    selected,
    panelGutter: 24,
    panelSplitActive: false,
    panelSplitHint: null,
    panelSplitRatio: 50,
    onPanelGutterChange: vi.fn(),
    onPanelSplitRatioChange: vi.fn(),
    onPatch: vi.fn(),
    onSplitFrame: vi.fn(),
    onTogglePanelSplit: vi.fn(),
  };
}

describe("StudioInspectorFocusSpeedFrameControls", () => {
  it("집중선 프리셋과 range·color·초점 위치 변경을 patch callback으로 전달한다", () => {
    const props = controlProps(FOCUS_LINES);
    render(<StudioInspectorFocusSpeedFrameControls {...props} />);

    expect(screen.getByText("집중선 설정")).toBeTruthy();
    expect(screen.queryByText("속도선 설정")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "강렬한 스릴러" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      lineCount: 160,
      innerRadius: 80,
      outerRadius: 500,
      noise: 40,
      strokeWidth: 4.5,
    });

    fireEvent.change(screen.getByRole("slider", { name: /^선 개수/u }), {
      target: { value: "125" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ lineCount: 125 });

    fireEvent.change(screen.getByLabelText("선 색상"), { target: { value: "#ff3300" } });
    expect(props.onPatch).toHaveBeenLastCalledWith({ stroke: "#ff3300" });

    fireEvent.change(screen.getByRole("slider", { name: /^초점 가로 위치/u }), {
      target: { value: "0.75" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ centerXRatio: 0.75 });
  });

  it("속도선 프리셋·방향·range·color 변경을 독립적으로 전달한다", () => {
    const props = controlProps(SPEED_LINES);
    render(<StudioInspectorFocusSpeedFrameControls {...props} />);

    expect(screen.getByText("속도선 설정")).toBeTruthy();
    expect(screen.queryByText("집중선 설정")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "세로 낙하" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      direction: "vertical",
      lineCount: 60,
      strokeWidth: 3.5,
    });

    fireEvent.click(screen.getByRole("button", { name: "세로" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({ direction: "vertical" });

    fireEvent.change(screen.getByRole("slider", { name: /^선 두께/u }), {
      target: { value: "6.5" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ strokeWidth: 6.5 });

    fireEvent.change(screen.getByLabelText("선 색상"), { target: { value: "#3366ff" } });
    expect(props.onPatch).toHaveBeenLastCalledWith({ stroke: "#3366ff" });
  });

  it("프레임 메타 생성·분할 비율·방향 split·자유선 callback을 부모에 위임한다", () => {
    const props = {
      ...controlProps(FRAME),
      panelSplitHint: "프레임 안에서 선을 끝내 주세요.",
    };
    render(<StudioInspectorFocusSpeedFrameControls {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "이 컷에 이야기 메타 추가" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      storyBeat: { type: "transition", summary: "" },
    });

    fireEvent.change(screen.getByRole("slider", { name: "분할 비율" }), {
      target: { value: "65" },
    });
    expect(props.onPanelSplitRatioChange).toHaveBeenCalledWith(65);

    fireEvent.click(screen.getByRole("button", { name: "세로로 분할" }));
    fireEvent.click(screen.getByRole("button", { name: "가로로 분할" }));
    expect(props.onSplitFrame).toHaveBeenNthCalledWith(1, "vertical");
    expect(props.onSplitFrame).toHaveBeenNthCalledWith(2, "horizontal");

    fireEvent.click(screen.getByRole("button", { name: "자유선 분할 켜기" }));
    expect(props.onTogglePanelSplit).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("slider", { name: "자유선 여백" }), {
      target: { value: "32" },
    });
    expect(props.onPanelGutterChange).toHaveBeenCalledWith(32);
    expect(screen.getByRole("status").textContent).toBe("프레임 안에서 선을 끝내 주세요.");
  });

  it("프레임 story metadata·AI provenance·연속성 편집과 제거를 보존한다", () => {
    const selected: FrameEl = {
      ...FRAME,
      storyBeat: {
        type: "setup",
        summary: "주인공이 학교에 도착한다.",
        continuity: { location: "교문" },
        textAiProvenance: {
          provider: "Z.ai",
          model: "glm-5.2",
          transport: "server",
          promptVersion: 1,
          createdAt: "2026-07-19T00:00:00.000Z",
          usage: { totalTokens: 1_234 },
          failover: {
            attemptedProvider: "zai",
            attemptedModel: "glm-5.2",
            actualProvider: "deepseek",
            actualModel: "deepseek-chat",
            reason: "billing_quota_exhausted",
          },
        },
      },
    };
    const props = controlProps(selected);
    render(<StudioInspectorFocusSpeedFrameControls {...props} />);

    expect(screen.getByText(/Z\.ai \/ glm-5\.2/u)).toBeTruthy();
    expect(screen.getByText(/1,234 tokens/u)).toBeTruthy();
    expect(screen.getByText(/DeepSeek에 자동 전환/u)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("서사 역할"), { target: { value: "climax" } });
    expect(props.onPatch).toHaveBeenLastCalledWith({
      storyBeat: { ...selected.storyBeat, type: "climax" },
    });

    const longSummary = "가".repeat(260);
    fireEvent.change(screen.getByLabelText("장면 변화 요약"), {
      target: { value: longSummary },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({
      storyBeat: { ...selected.storyBeat, summary: "가".repeat(240) },
    });

    fireEvent.click(screen.getByRole("button", { name: "연속성 업데이트" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      storyBeat: { ...selected.storyBeat, continuity: { location: "학교 옥상" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "메타 제거" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({ storyBeat: undefined });
  });

  it("프레임 배경색과 테두리 on/off·색상·두께·스타일을 patch한다", () => {
    const selected: FrameEl = {
      ...FRAME,
      bgColor: "#ffffff",
      stroke: "#16100c",
      strokeWidth: 3,
      dashStyle: "solid",
    };
    const props = controlProps(selected);
    render(<StudioInspectorFocusSpeedFrameControls {...props} />);

    fireEvent.change(screen.getByLabelText("배경색"), { target: { value: "#ffeecc" } });
    expect(props.onPatch).toHaveBeenLastCalledWith({ bgColor: "#ffeecc" });

    fireEvent.click(screen.getByLabelText("패널 테두리 커스텀"));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      stroke: undefined,
      strokeWidth: undefined,
    });

    fireEvent.change(screen.getByLabelText("테두리 색상"), {
      target: { value: "#334455" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ stroke: "#334455" });

    fireEvent.change(screen.getByRole("slider", { name: /^테두리 두께/u }), {
      target: { value: "7.5" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ strokeWidth: 7.5 });

    fireEvent.click(screen.getByRole("button", { name: "점선" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({ dashStyle: "dashed" });
  });
});
