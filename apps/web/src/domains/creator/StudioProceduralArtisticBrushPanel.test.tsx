// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioProceduralArtisticBrushPanel,
  type StudioProceduralArtisticBrushPanelProps,
} from "./StudioProceduralArtisticBrushPanel";

afterEach(cleanup);

function props(
  overrides: Partial<StudioProceduralArtisticBrushPanelProps> = {},
): StudioProceduralArtisticBrushPanelProps {
  return {
    technique: "flow-field",
    color: "#202124",
    density: 60,
    angle: 45,
    weight: 2,
    strength: 0.8,
    seed: 42,
    capabilityStatus: "ready",
    onTechniqueChange: vi.fn(),
    onColorChange: vi.fn(),
    onDensityChange: vi.fn(),
    onAngleChange: vi.fn(),
    onWeightChange: vi.fn(),
    onStrengthChange: vi.fn(),
    onSeedChange: vi.fn(),
    onGenerate: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("StudioProceduralArtisticBrushPanel", () => {
  it("exposes a labelled, settled-raster product surface and ready status", () => {
    render(<StudioProceduralArtisticBrushPanel {...props()} />);

    const panel = screen.getByRole("region", {
      name: "절차적 질감 생성기",
    });
    expect(panel.getAttribute("aria-busy")).toBe("false");
    expect(
      within(panel).getByText(/설정한 기법과 시드로 결정적 질감/),
    ).toBeTruthy();
    const techniqueGroup = within(panel).getByRole("group", {
      name: "질감 기법",
    });
    const techniques = within(techniqueGroup).getAllByRole("radio");
    expect(techniques.map((radio) => ({
      name: radio.getAttribute("aria-label"),
      value: (radio as HTMLInputElement).value,
    }))).toEqual([
      { name: "흐름장", value: "flow-field" },
      { name: "해칭", value: "hatch" },
      { name: "매스", value: "mass" },
      { name: "수채 채움", value: "watercolor-fill" },
      { name: "플랫 워시", value: "flat-wash" },
    ]);
    const watercolor = within(techniqueGroup).getByRole("radio", {
      name: "수채 채움",
    });
    const watercolorDescription = document.getElementById(
      watercolor.getAttribute("aria-describedby") ?? "",
    );
    expect(watercolorDescription?.textContent).toContain(
      "가장자리 번짐이 살아 있는 수채 면",
    );
    expect(
      watercolor.closest("label")?.querySelector(".lucide-droplets"),
    ).toBeTruthy();
    expect(
      within(techniqueGroup)
        .getByRole("radio", { name: "플랫 워시" })
        .closest("label")
        ?.querySelector(".lucide-paint-bucket"),
    ).toBeTruthy();
    expect(within(panel).getByRole("status").textContent).toContain(
      "결정적 질감을 생성할 준비",
    );
    expect(
      (within(panel).getByRole("button", {
        name: "질감 생성",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("emits controlled technique changes and exposes only relevant controls", () => {
    const onTechniqueChange = vi.fn();
    const shared = props({ onTechniqueChange });
    const view = render(
      <StudioProceduralArtisticBrushPanel {...shared} />,
    );

    expect(screen.queryByText("선 방향")).toBeNull();
    expect(screen.getByText("선 굵기")).toBeTruthy();
    expect(screen.getByText("효과 강도")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "해칭" }));
    expect(onTechniqueChange).toHaveBeenCalledWith("hatch");
    fireEvent.click(screen.getByRole("radio", { name: "수채 채움" }));
    expect(onTechniqueChange).toHaveBeenCalledWith("watercolor-fill");
    fireEvent.click(screen.getByRole("radio", { name: "플랫 워시" }));
    expect(onTechniqueChange).toHaveBeenCalledWith("flat-wash");

    view.rerender(
      <StudioProceduralArtisticBrushPanel {...shared} technique="hatch" />,
    );
    expect(screen.getByText("선 방향")).toBeTruthy();
    expect(screen.getByText("선 굵기")).toBeTruthy();
    expect(screen.queryByText("효과 강도")).toBeNull();

    view.rerender(
      <StudioProceduralArtisticBrushPanel {...shared} technique="mass" />,
    );
    expect(screen.queryByText("선 방향")).toBeNull();
    expect(screen.queryByText("선 굵기")).toBeNull();
    expect(screen.getByText("효과 강도")).toBeTruthy();
    expect(screen.getByText("입자 밀도")).toBeTruthy();

    view.rerender(
      <StudioProceduralArtisticBrushPanel
        {...shared}
        technique="watercolor-fill"
      />,
    );
    expect(screen.getByText("종이 질감")).toBeTruthy();
    expect(screen.getByText("번짐 방향")).toBeTruthy();
    expect(screen.getByText("번짐 강도")).toBeTruthy();
    expect(screen.queryByText("선 굵기")).toBeNull();
    expect(
      within(screen.getByLabelText("수채 채움 세부 설정"))
        .getAllByRole("slider"),
    ).toHaveLength(3);

    view.rerender(
      <StudioProceduralArtisticBrushPanel
        {...shared}
        technique="flat-wash"
      />,
    );
    expect(screen.getByText("불투명도")).toBeTruthy();
    expect(screen.queryByText("종이 질감")).toBeNull();
    expect(screen.queryByText("선 굵기")).toBeNull();
    expect(screen.queryByText("번짐 방향")).toBeNull();
    expect(screen.queryByText("번짐 강도")).toBeNull();
    expect(screen.queryByText("채움 밀도")).toBeNull();
    expect(
      within(screen.getByLabelText("플랫 워시 세부 설정"))
        .getAllByRole("slider"),
    ).toHaveLength(1);
  });

  it("emits color, seed, and technique-specific numeric changes", () => {
    const configured = props();
    render(<StudioProceduralArtisticBrushPanel {...configured} technique="hatch" />);

    fireEvent.change(screen.getByLabelText("질감 색상 코드"), {
      target: { value: "#336699" },
    });
    fireEvent.change(screen.getByLabelText("결정적 반복 시드"), {
      target: { value: "20260729" },
    });

    const settings = screen.getByLabelText("해칭 세부 설정");
    const sliders = within(settings).getAllByRole("slider");
    fireEvent.change(sliders[0]!, { target: { value: "74" } });
    fireEvent.change(sliders[1]!, { target: { value: "-30" } });
    fireEvent.change(sliders[2]!, { target: { value: "3.5" } });

    expect(configured.onColorChange).toHaveBeenCalledWith("#336699");
    expect(configured.onSeedChange).toHaveBeenCalledWith(20_260_729);
    expect(configured.onDensityChange).toHaveBeenCalledWith(74);
    expect(configured.onAngleChange).toHaveBeenCalledWith(-30);
    expect(configured.onWeightChange).toHaveBeenCalledWith(3.5);
  });

  it("emits watercolor texture and bleed values, and flat-wash opacity only", () => {
    const configured = props();
    const view = render(
      <StudioProceduralArtisticBrushPanel
        {...configured}
        technique="watercolor-fill"
      />,
    );

    const watercolorSliders = within(
      screen.getByLabelText("수채 채움 세부 설정"),
    ).getAllByRole("slider");
    expect(watercolorSliders).toHaveLength(3);
    fireEvent.change(watercolorSliders[0]!, { target: { value: "82" } });
    fireEvent.change(watercolorSliders[1]!, { target: { value: "-55" } });
    fireEvent.change(watercolorSliders[2]!, { target: { value: "0.63" } });
    expect(configured.onDensityChange).toHaveBeenLastCalledWith(82);
    expect(configured.onAngleChange).toHaveBeenLastCalledWith(-55);
    expect(configured.onStrengthChange).toHaveBeenLastCalledWith(0.63);
    expect(configured.onWeightChange).not.toHaveBeenCalled();

    view.rerender(
      <StudioProceduralArtisticBrushPanel
        {...configured}
        technique="flat-wash"
      />,
    );
    const flatWashSliders = within(
      screen.getByLabelText("플랫 워시 세부 설정"),
    ).getAllByRole("slider");
    expect(flatWashSliders).toHaveLength(1);
    fireEvent.change(flatWashSliders[0]!, { target: { value: "0.46" } });
    expect(configured.onStrengthChange).toHaveBeenLastCalledWith(0.46);
    expect(configured.onDensityChange).toHaveBeenCalledTimes(1);
    expect(configured.onAngleChange).toHaveBeenCalledTimes(1);
    expect(configured.onWeightChange).not.toHaveBeenCalled();
  });

  it("keeps generation fail-closed while capability is checking or unavailable", () => {
    const checking = props({
      capabilityStatus: "checking",
      capabilityMessage: "GPU 기능 확인 중",
    });
    const view = render(
      <StudioProceduralArtisticBrushPanel {...checking} />,
    );

    expect(screen.getByRole("status").textContent).toContain("GPU 기능 확인 중");
    expect(
      (screen.getByRole("button", {
        name: "질감 생성",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", {
        name: "흐름장",
      }) as HTMLInputElement).disabled,
    ).toBe(true);

    view.rerender(
      <StudioProceduralArtisticBrushPanel
        {...checking}
        capabilityStatus="unavailable"
        capabilityMessage="WebGL2를 사용할 수 없습니다."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "WebGL2를 사용할 수 없습니다.",
    );
    expect(
      (screen.getByRole("button", {
        name: "질감 생성",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("announces errors and offers cancellation without unlocking busy controls", () => {
    const onCancel = vi.fn();
    render(
      <StudioProceduralArtisticBrushPanel
        {...props({
          busy: true,
          error: "렌더링 응답이 중단되었습니다.",
          onCancel,
        })}
      />,
    );

    const panel = screen.getByRole("region", {
      name: "절차적 질감 생성기",
    });
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "렌더링 응답이 중단되었습니다.",
    );
    expect(
      (screen.getByRole("button", {
        name: "생성 중…",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", {
        name: "흐름장",
      }) as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "생성 취소" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("uses a responsive two-column radio grid and 44px interaction targets", () => {
    render(<StudioProceduralArtisticBrushPanel {...props()} />);

    const techniqueGroup = screen.getByRole("group", {
      name: "질감 기법",
    });
    const techniqueGrid = techniqueGroup.querySelector(
      "[data-studio-procedural-artistic-brush-techniques]",
    );
    expect(techniqueGrid?.className).toContain("grid-cols-2");
    const techniques = within(techniqueGroup).getAllByRole("radio");
    expect(techniques).toHaveLength(5);
    expect(new Set(
      techniques.map((radio) => (radio as HTMLInputElement).name),
    ).size).toBe(1);
    for (const radio of techniques) {
      expect(radio.closest("label")?.className).toContain("min-h-11");
    }
    const sharedControls =
      screen.getByLabelText("질감 색상 코드").closest("label")?.parentElement;
    expect(sharedControls?.className).toContain(
      "max-[340px]:grid-cols-1",
    );
    expect(
      screen.getByRole("button", { name: "질감 생성" }).className,
    ).toContain("min-h-11");
    expect(
      screen.getByLabelText("결정적 반복 시드").className,
    ).toContain("min-h-11");
  });
});
