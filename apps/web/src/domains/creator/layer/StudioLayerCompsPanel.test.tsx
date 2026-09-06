// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureLayerComp } from "./studio-layer-comps";
import { StudioLayerCompsPanel } from "./StudioLayerCompsPanel";

describe("StudioLayerCompsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleLayers = [
    { id: "layer-lineart", visible: true, opacity: 1 },
    { id: "layer-colors", visible: true, opacity: 0.9 },
    { id: "layer-text", visible: false, opacity: 1 },
  ];

  it("renders empty state when no comps exist", () => {
    render(
      <StudioLayerCompsPanel
        layers={sampleLayers}
        comps={[]}
        onApplyComp={vi.fn()}
        onCompsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("저장된 레이어 콤프가 없습니다.")).toBeDefined();
  });

  it("allows capturing a new layer comp", () => {
    const onCompsChange = vi.fn();
    render(
      <StudioLayerCompsPanel
        layers={sampleLayers}
        comps={[]}
        onApplyComp={vi.fn()}
        onCompsChange={onCompsChange}
      />,
    );

    fireEvent.click(screen.getByText("새 콤프"));
    const input = screen.getByPlaceholderText(/콤프 이름/i);
    fireEvent.change(input, { target: { value: "선화전용" } });
    fireEvent.click(screen.getByText("저장"));

    expect(onCompsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "선화전용",
        }),
      ]),
    );
  });

  it("calls onApplyComp when applying a comp", () => {
    const onApplyComp = vi.fn();
    const comp1 = captureLayerComp("완성본", sampleLayers, "comp-1");

    render(
      <StudioLayerCompsPanel
        layers={sampleLayers}
        comps={[comp1]}
        activeCompId={null}
        onApplyComp={onApplyComp}
        onCompsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("적용"));
    expect(onApplyComp).toHaveBeenCalledWith(comp1);
  });

  it("triggers batch export plan callback", () => {
    const onBatchExportPlan = vi.fn();
    const comp1 = captureLayerComp("완성본", sampleLayers, "comp-1");

    render(
      <StudioLayerCompsPanel
        layers={sampleLayers}
        comps={[comp1]}
        onApplyComp={vi.fn()}
        onCompsChange={vi.fn()}
        onBatchExportPlan={onBatchExportPlan}
      />,
    );

    fireEvent.click(screen.getByText("콤프 일괄 내보내기"));
    expect(onBatchExportPlan).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          compId: "comp-1",
          fileName: "webtoon_cut_완성본.png",
        }),
      ]),
    );
  });
});
