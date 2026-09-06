// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeOutline } from "../studio-outline";

import {
  COMBO_LAYER_STYLE_PRESETS,
  LAYER_STYLE_PRESETS,
  layerStyleResetPatch,
} from "./studio-layer-styles";
import { StudioLayerStylePanel } from "./StudioLayerStylePanel";

type PanelProps = Parameters<typeof StudioLayerStylePanel>[0];

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    values: {},
    onPatch: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioLayerStylePanel — 레거시(outline 채널 없음)", () => {
  it("기존 헤더/5개 슬라이더만 렌더하고 이중 외곽선·콤보 UI는 없다", () => {
    render(<StudioLayerStylePanel {...baseProps()} />);
    expect(screen.getByText("레이어 스타일 (그림자·모서리)")).toBeTruthy();
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    expect(screen.queryByText("이중 외곽선 (스티커 테두리)")).toBeNull();
    for (const combo of COMBO_LAYER_STYLE_PRESETS) {
      expect(screen.queryByRole("button", { name: combo.label })).toBeNull();
    }
  });

  it("그림자 번짐 슬라이더 변경은 onPatch({ shadowBlur })를 호출한다", () => {
    const onPatch = vi.fn();
    render(<StudioLayerStylePanel {...baseProps({ onPatch })} />);
    fireEvent.change(screen.getAllByRole("slider")[0]!, { target: { value: "24" } });
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onPatch).toHaveBeenLastCalledWith({ shadowBlur: 24 });
  });

  it("프리셋 칩 클릭은 reset 위에 프리셋을 덮은 절대값 패치를 보낸다", () => {
    const onPatch = vi.fn();
    render(<StudioLayerStylePanel {...baseProps({ onPatch })} />);
    const preset = LAYER_STYLE_PRESETS.find((p) => p.id === "soft-shadow")!;
    fireEvent.click(screen.getByRole("button", { name: preset.label }));
    expect(onPatch).toHaveBeenLastCalledWith({ ...layerStyleResetPatch(), ...preset.patch });
  });

  it("호출부가 엘리먼트 전체를 values로 넘겨도 6키만 보고 pristine을 판정한다", () => {
    // 회귀: 이전에는 Object.values(values) 전체를 검사해 엘리먼트 캐스팅 시 "기본" 칩이
    // 절대 활성으로 보이지 않았다. 이제 LayerStylePatch 6키만 본다.
    const elementLike = { id: "el1", type: "image", x: 10 } as unknown as PanelProps["values"];
    render(<StudioLayerStylePanel {...baseProps({ values: elementLike })} />);
    const noneChip = screen.getByRole("button", { name: "기본" });
    expect(noneChip.className).toContain("border-accent");
  });

  it("스타일 값이 있으면 '기본' 칩은 비활성 표시다", () => {
    render(<StudioLayerStylePanel {...baseProps({ values: { shadowColor: "#000000", shadowBlur: 8 } })} />);
    const noneChip = screen.getByRole("button", { name: "기본" });
    expect(noneChip.className).not.toContain("border-accent");
  });

  it("원본으로 버튼은 onPatch(reset)만 호출한다(outline 콜백 없음이라 throw 없음)", () => {
    const onPatch = vi.fn();
    render(<StudioLayerStylePanel {...baseProps({ onPatch, values: { shadowBlur: 8 } })} />);
    fireEvent.click(screen.getByRole("button", { name: /원본으로/ }));
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onPatch).toHaveBeenLastCalledWith(layerStyleResetPatch());
  });
});

describe("StudioLayerStylePanel — outline 채널(콤보 프리셋 + 이중 외곽선)", () => {
  function outlineProps(overrides: Partial<PanelProps> = {}): PanelProps {
    return baseProps({
      outline: normalizeOutline({ color: "#ffffff", width: 6, opacity: 100 }),
      onOutlineChange: vi.fn(),
      ...overrides,
    });
  }

  it("헤더가 테두리를 포함하고, 콤보 칩 3종과 이중 외곽선 컨트롤(슬라이더 +2)을 렌더한다", () => {
    render(<StudioLayerStylePanel {...outlineProps()} />);
    expect(screen.getByText("레이어 스타일 (그림자·모서리·테두리)")).toBeTruthy();
    expect(screen.getByText("이중 외곽선 (스티커 테두리)")).toBeTruthy();
    expect(screen.getAllByRole("slider")).toHaveLength(7);
    for (const combo of COMBO_LAYER_STYLE_PRESETS) {
      expect(screen.getByRole("button", { name: combo.label })).toBeTruthy();
    }
  });

  it("스티커 콤보 클릭은 그림자 절대값 패치와 테두리 교체를 함께 보낸다", () => {
    const onPatch = vi.fn();
    const onOutlineChange = vi.fn();
    render(<StudioLayerStylePanel {...outlineProps({ onPatch, onOutlineChange })} />);
    const combo = COMBO_LAYER_STYLE_PRESETS.find((p) => p.id === "sticker-outline-shadow")!;
    fireEvent.click(screen.getByRole("button", { name: combo.label }));
    expect(onPatch).toHaveBeenLastCalledWith({ ...layerStyleResetPatch(), ...combo.layer });
    expect(onOutlineChange).toHaveBeenLastCalledWith(combo.outline);
  });

  it("이중 테두리 콤보는 그림자를 비우고 2차 링이 든 테두리를 세팅한다", () => {
    const onPatch = vi.fn();
    const onOutlineChange = vi.fn();
    render(<StudioLayerStylePanel {...outlineProps({ onPatch, onOutlineChange })} />);
    const combo = COMBO_LAYER_STYLE_PRESETS.find((p) => p.id === "double-outline")!;
    fireEvent.click(screen.getByRole("button", { name: combo.label }));
    expect(onPatch).toHaveBeenLastCalledWith(layerStyleResetPatch());
    expect(onOutlineChange).toHaveBeenLastCalledWith(combo.outline);
    expect(combo.outline.secondWidth).toBeGreaterThan(0);
  });

  it("바깥 굵기 슬라이더는 현재 테두리 위에 secondWidth를 덮은 정규화 값을 보낸다", () => {
    const onOutlineChange = vi.fn();
    const outline = normalizeOutline({ color: "#ffffff", width: 6, opacity: 100 });
    render(<StudioLayerStylePanel {...outlineProps({ outline, onOutlineChange })} />);
    // 슬라이더 순서: 번짐/가로/세로/농도/모서리/안쪽 굵기/바깥 굵기.
    fireEvent.change(screen.getAllByRole("slider")[6]!, { target: { value: "3" } });
    expect(onOutlineChange).toHaveBeenLastCalledWith(normalizeOutline({ ...outline, secondWidth: 3 }));
    // 정규화가 secondColor 폴백(검정)까지 채운다.
    expect(onOutlineChange.mock.lastCall![0].secondColor).toBe("#000000");
  });

  it("안쪽 굵기 슬라이더는 width만 패치한다", () => {
    const onOutlineChange = vi.fn();
    const outline = normalizeOutline({ color: "#ff4f9a", width: 6, opacity: 100 });
    render(<StudioLayerStylePanel {...outlineProps({ outline, onOutlineChange })} />);
    fireEvent.change(screen.getAllByRole("slider")[5]!, { target: { value: "12" } });
    expect(onOutlineChange).toHaveBeenLastCalledWith(normalizeOutline({ ...outline, width: 12 }));
  });

  it("원본으로/기본 칩은 그림자 reset과 함께 테두리도 제거한다", () => {
    const onPatch = vi.fn();
    const onOutlineChange = vi.fn();
    render(<StudioLayerStylePanel {...outlineProps({ onPatch, onOutlineChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /원본으로/ }));
    expect(onPatch).toHaveBeenLastCalledWith(layerStyleResetPatch());
    expect(onOutlineChange).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(screen.getByRole("button", { name: "기본" }));
    expect(onOutlineChange).toHaveBeenCalledTimes(2);
    expect(onOutlineChange).toHaveBeenLastCalledWith(undefined);
  });

  it("outline 채널이 있으면 테두리가 활성인 동안 '기본' 칩은 pristine이 아니다", () => {
    render(<StudioLayerStylePanel {...outlineProps({ values: {} })} />);
    expect(screen.getByRole("button", { name: "기본" }).className).not.toContain("border-accent");
    cleanup();
    // 테두리가 항등이고 스타일도 비어 있으면 pristine.
    render(
      <StudioLayerStylePanel {...outlineProps({ values: {}, outline: undefined })} />
    );
    expect(screen.getByRole("button", { name: "기본" }).className).toContain("border-accent");
  });
});
