// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS,
  studioBrushEngineProgramSetFromOil,
} from "./studio-brush-engine-program-set";
import { studioBrushPresetById } from "./studio-draw-ux";
import { StudioBrushEngineProgramControls } from "./StudioBrushEngineProgramControls";

describe("StudioBrushEngineProgramControls", () => {
  afterEach(cleanup);

  it("describes the family boundary honestly for non-oil brushes", () => {
    render(
      <StudioBrushEngineProgramControls brushId="pen" programSet={null} onChange={vi.fn()} />,
    );
    expect(screen.getByText("이 브러시는 아직 조합할 엔진이 없습니다")).toBeTruthy();
  });

  it("shows the preset baseline and literal paint-order toggles", () => {
    render(
      <StudioBrushEngineProgramControls
        brushId="oil--impasto-ribbon"
        programSet={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("유화 · 임파스토(소모 없음)와 같은 조합")).toBeTruthy();
    expect(screen.getByRole("button", { name: /붓털 물리/u }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByRole("button", { name: /임파스토 릴리프/u }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByRole("button", { name: /물감 소모/u }).getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("exposes all eight combinations exactly once", () => {
    render(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={null}
        onChange={vi.fn()}
      />,
    );
    for (const name of [
      "기본 본체",
      "부드러운 강모",
      "마른 획",
      "두꺼운 능선",
      "자연 강모",
      "강모 임파스토",
      "건조 임파스토",
      "풀 피직스",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`, "u") })).toBeTruthy();
    }
    expect(screen.getByText("2³ 조합")).toBeTruthy();
  });

  it("applies a matrix recipe as a durable engine program set", () => {
    const onChange = vi.fn();
    render(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^건조 임파스토/u }));
    expect(onChange).toHaveBeenCalledWith(
      studioBrushEngineProgramSetFromOil({
        bristlePhysics: false,
        bristleLoadDynamics: true,
        impastoRelief: true,
      }),
    );
  });

  it("sends a set after a detailed toggle and names matching shipped presets", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioBrushEngineProgramControls
        brushId="oil--impasto-ribbon"
        programSet={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /물감 소모/u }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0];
    expect(next?.oil).toEqual({
      bristlePhysics: true,
      bristleLoadDynamics: true,
      impastoRelief: true,
    });

    rerender(
      <StudioBrushEngineProgramControls
        brushId="oil--impasto-ribbon"
        programSet={next}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("유화 붓와 같은 조합")).toBeTruthy();
    expect(screen.queryByText(/이 조합과 같은 프리셋은 없습니다/u)).toBeNull();
    expect(screen.getAllByText("변경됨")).toHaveLength(1);
  });

  it("calls only combinations absent from the shipped matrix custom", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioBrushEngineProgramControls
        brushId="brush--impasto-relief"
        programSet={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /물감 소모/u }));
    const next = onChange.mock.calls[0]![0];
    expect(next?.oil).toEqual({
      bristlePhysics: false,
      bristleLoadDynamics: true,
      impastoRelief: true,
    });

    rerender(
      <StudioBrushEngineProgramControls
        brushId="brush--impasto-relief"
        programSet={next}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("커스텀 조합")).toBeTruthy();
    expect(screen.getByText(/이 조합과 같은 프리셋은 없습니다/u)).toBeTruthy();
  });

  it("names fully enabled general-purpose paints by their own preset", () => {
    for (const [brushId, name] of [["oil", "유화 붓"], ["acrylic", "아크릴 물감"]] as const) {
      render(
        <StudioBrushEngineProgramControls brushId={brushId} programSet={null} onChange={vi.fn()} />,
      );
      expect(screen.getByText(`${name}와 같은 조합`), brushId).toBeTruthy();
      expect(screen.queryByText("커스텀 조합"), brushId).toBeNull();
      cleanup();
    }
  });

  it("never labels a catalogued matrix baseline as custom", () => {
    let checked = 0;
    for (const brushId of STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS) {
      if (!studioBrushPresetById(brushId)) continue;
      checked += 1;
      render(
        <StudioBrushEngineProgramControls brushId={brushId} programSet={null} onChange={vi.fn()} />,
      );
      expect(screen.queryByText("커스텀 조합"), brushId).toBeNull();
      cleanup();
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it("emits null when a toggle or matrix recipe returns to the id baseline", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={studioBrushEngineProgramSetFromOil({
          bristlePhysics: true,
          bristleLoadDynamics: false,
          impastoRelief: true,
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /임파스토 릴리프/u }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    onChange.mockClear();
    rerender(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={studioBrushEngineProgramSetFromOil({
          bristlePhysics: false,
          bristleLoadDynamics: true,
          impastoRelief: true,
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^부드러운 강모/u }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows preset restore only for changed combinations", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={null}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: /프리셋으로/u })).toBeNull();

    rerender(
      <StudioBrushEngineProgramControls
        brushId="oil--filbert-ribbon"
        programSet={studioBrushEngineProgramSetFromOil({
          bristlePhysics: false,
          bristleLoadDynamics: true,
          impastoRelief: false,
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /프리셋으로/u }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
