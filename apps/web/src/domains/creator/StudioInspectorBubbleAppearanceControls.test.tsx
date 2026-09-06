// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { BUBBLE_VARIANTS } from "./studio-assets";
import {
  StudioInspectorBubbleAppearanceControls,
  type BubbleAppearancePatch,
  type StudioInspectorBubbleAppearanceControlsProps,
} from "./StudioInspectorBubbleAppearanceControls";

import type { BubbleStylePresetPatch } from "./lettering/StudioBubbleStylePresetPanel";
import type { BubbleEl } from "./studio-element-model";

vi.mock("./lettering/StudioBubbleVariantGlyph", () => ({
  StudioBubbleVariantGlyph: ({ variant }: { variant: string }) => (
    <span aria-hidden>{variant}</span>
  ),
}));

vi.mock("./StudioLazyColorPopover", () => ({
  LazyStudioColorPopover: ({
    onChange,
    onLoadRecentColors,
    onUseColor,
    label,
  }: {
    onChange: (color: string) => void;
    onLoadRecentColors: () => void;
    onUseColor: (color: string) => void;
    label: string;
  }) => (
    <div>
      <button type="button" onClick={() => onChange("#223344")}>
        {label}
      </button>
      <button type="button" onClick={onLoadRecentColors}>
        최근 색상 불러오기
      </button>
      <button type="button" onClick={() => onUseColor("#445566")}>
        최근 색상 기억
      </button>
    </div>
  ),
}));

vi.mock("./studio-page-lazy-ui", () => ({
  StudioBubbleStylePresetPanel: ({
    onApplyPreset,
  }: {
    onApplyPreset: (patch: BubbleStylePresetPatch) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onApplyPreset({
          fill: "#fff4cc",
          textFill: "#2a1b00",
          stroke: undefined,
          strokeWidth: undefined,
          strokeStyle: undefined,
          variant: "thought",
          starAmplitude: undefined,
          shadowColor: undefined,
          shadowBlur: undefined,
          shadowOffsetX: undefined,
          shadowOffsetY: undefined,
          shadowOpacity: undefined,
          font: "Pretendard",
        })
      }
    >
      스타일 프리셋 적용
    </button>
  ),
  StudioGradientEnginePanel: ({
    onChange,
  }: {
    onChange: (
      gradient: { type: "linear"; angle: number; stops: never[] } | null
    ) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onChange({ type: "linear", angle: 90, stops: [] })}
      >
        말풍선 그라데이션 적용
      </button>
      <button type="button" onClick={() => onChange(null)}>
        말풍선 그라데이션 지우기
      </button>
    </>
  ),
  StudioBubbleAutoShrinkPanel: ({
    effectiveFontSize,
    minFontSize,
    onMinFontSizeChange,
    onToggleEnabled,
  }: {
    effectiveFontSize: number | null;
    minFontSize: number;
    onMinFontSizeChange: (fontSize: number) => void;
    onToggleEnabled: (enabled: boolean) => void;
  }) => (
    <section aria-label={`자동 축소 ${minFontSize}/${effectiveFontSize ?? "none"}`}>
      <button type="button" onClick={() => onToggleEnabled(true)}>
        자동 축소 켜기
      </button>
      <button type="button" onClick={() => onMinFontSizeChange(14)}>
        최소 글자 14
      </button>
    </section>
  ),
}));

afterEach(cleanup);

const BUBBLE: BubbleEl = {
  id: "bubble-1",
  type: "bubble",
  variant: "speech",
  text: "안녕하세요",
  x: 100,
  y: 120,
  width: 280,
  height: 160,
  fill: "#ffffff",
  textFill: "#16100c",
  rotation: 0,
  fontSize: 24,
};

function appearanceProps(
  selected: BubbleEl = BUBBLE
): StudioInspectorBubbleAppearanceControlsProps {
  return {
    selected,
    recentColors: ["#112233"],
    webtoonTheme: "classic",
    onEnsureRecentColorsLoaded: vi.fn(),
    onPatch: vi.fn(),
    onRememberColor: vi.fn(),
  };
}

describe("StudioInspectorBubbleAppearanceControls", () => {
  it("외형 patch 계약에서 식별자·내용·기하 필드를 제외한다", () => {
    type ForbiddenKey = Extract<
      keyof BubbleAppearancePatch,
      "id" | "type" | "text" | "x" | "y" | "width" | "height" | "rotation"
    >;

    expectTypeOf<ForbiddenKey>().toEqualTypeOf<never>();
  });

  it("모양과 스타일 프리셋을 controlled patch로 전달한다", () => {
    const props = appearanceProps();
    render(<StudioInspectorBubbleAppearanceControls {...props} />);

    const alternate = BUBBLE_VARIANTS.find((variant) => variant.id !== BUBBLE.variant);
    if (!alternate) throw new Error("alternate bubble variant fixture missing");
    fireEvent.click(screen.getByTitle(`${alternate.label} — ${alternate.hint}`));
    expect(props.onPatch).toHaveBeenLastCalledWith({ variant: alternate.id });

    fireEvent.click(screen.getByRole("button", { name: "스타일 프리셋 적용" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      fill: "#fff4cc",
      textFill: "#2a1b00",
      stroke: undefined,
      strokeWidth: undefined,
      strokeStyle: undefined,
      variant: "thought",
      starAmplitude: undefined,
      shadowColor: undefined,
      shadowBlur: undefined,
      shadowOffsetX: undefined,
      shadowOffsetY: undefined,
      shadowOpacity: undefined,
      font: "Pretendard",
    });
  });

  it("배경 투명·색상·최근 색상·그라데이션 동작을 보존한다", () => {
    const props = appearanceProps();
    const { rerender } = render(<StudioInspectorBubbleAppearanceControls {...props} />);

    fireEvent.click(screen.getByLabelText("말풍선 배경 투명"));
    expect(props.onPatch).toHaveBeenLastCalledWith({ fill: "transparent" });

    fireEvent.click(screen.getByRole("button", { name: "말풍선 색상" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({ fill: "#223344" });
    fireEvent.click(screen.getByRole("button", { name: "최근 색상 불러오기" }));
    fireEvent.click(screen.getByRole("button", { name: "최근 색상 기억" }));
    expect(props.onEnsureRecentColorsLoaded).toHaveBeenCalledOnce();
    expect(props.onRememberColor).toHaveBeenCalledWith("#445566");

    fireEvent.click(screen.getByRole("button", { name: "말풍선 그라데이션 적용" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      gradient: { type: "linear", angle: 90, stops: [] },
    });
    fireEvent.click(screen.getByRole("button", { name: "말풍선 그라데이션 지우기" }));
    expect(props.onPatch).toHaveBeenLastCalledWith({ gradient: undefined });

    rerender(
      <StudioInspectorBubbleAppearanceControls
        {...props}
        selected={{ ...BUBBLE, fill: "transparent" }}
      />
    );
    fireEvent.click(screen.getByLabelText("말풍선 배경 투명"));
    expect(props.onPatch).toHaveBeenLastCalledWith({ fill: "#ffffff" });
    expect(screen.queryByRole("button", { name: "말풍선 색상" })).toBeNull();
  });

  it("테두리와 자동 글자 축소 설정을 부모에 위임한다", () => {
    const props = appearanceProps();
    const { rerender } = render(<StudioInspectorBubbleAppearanceControls {...props} />);

    fireEvent.click(screen.getByLabelText("말풍선 테두리 커스텀"));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      stroke: "#16100c",
      strokeWidth: 3,
    });

    rerender(
      <StudioInspectorBubbleAppearanceControls
        {...props}
        selected={{ ...BUBBLE, stroke: "#123456", strokeWidth: 4 }}
      />
    );
    fireEvent.change(screen.getByLabelText("테두리 색상"), {
      target: { value: "#654321" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ stroke: "#654321" });
    fireEvent.change(screen.getByRole("slider", { name: "테두리 두께" }), {
      target: { value: "6.5" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ strokeWidth: 6.5 });
    fireEvent.click(screen.getByLabelText("말풍선 테두리 커스텀"));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      stroke: undefined,
      strokeWidth: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "자동 축소 켜기" }));
    fireEvent.click(screen.getByRole("button", { name: "최소 글자 14" }));
    expect(props.onPatch).toHaveBeenNthCalledWith(
      vi.mocked(props.onPatch).mock.calls.length - 1,
      { autoShrinkText: true }
    );
    expect(props.onPatch).toHaveBeenLastCalledWith({ autoShrinkMinFontSize: 14 });
  });

  it("그림자 기본값과 세부 값을 하나의 외형 patch 경계로 전달한다", () => {
    const props = appearanceProps();
    const { rerender } = render(<StudioInspectorBubbleAppearanceControls {...props} />);

    fireEvent.click(screen.getByLabelText("말풍선 그림자 사용"));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      shadowColor: "#000000",
      shadowBlur: 6,
      shadowOffsetX: 2,
      shadowOffsetY: 3,
      shadowOpacity: 0.15,
    });

    rerender(
      <StudioInspectorBubbleAppearanceControls
        {...props}
        selected={{
          ...BUBBLE,
          shadowColor: "#111111",
          shadowBlur: 8,
          shadowOffsetX: 1,
          shadowOffsetY: 4,
          shadowOpacity: 0.25,
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("그림자 색상"), {
      target: { value: "#222222" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ shadowColor: "#222222" });
    fireEvent.change(screen.getByRole("slider", { name: "흐림 정도 (Blur)" }), {
      target: { value: "12" },
    });
    expect(props.onPatch).toHaveBeenLastCalledWith({ shadowBlur: 12 });
    fireEvent.change(screen.getByRole("slider", { name: "가로 오프셋 (X)" }), {
      target: { value: "-4" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "세로 오프셋 (Y)" }), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "불투명도" }), {
      target: { value: "0.5" },
    });
    expect(props.onPatch).toHaveBeenNthCalledWith(
      vi.mocked(props.onPatch).mock.calls.length - 2,
      { shadowOffsetX: -4 }
    );
    expect(props.onPatch).toHaveBeenNthCalledWith(
      vi.mocked(props.onPatch).mock.calls.length - 1,
      { shadowOffsetY: 7 }
    );
    expect(props.onPatch).toHaveBeenLastCalledWith({ shadowOpacity: 0.5 });
    fireEvent.click(screen.getByLabelText("말풍선 그림자 사용"));
    expect(props.onPatch).toHaveBeenLastCalledWith({
      shadowColor: undefined,
      shadowBlur: undefined,
      shadowOffsetX: undefined,
      shadowOffsetY: undefined,
      shadowOpacity: undefined,
    });
  });
});
