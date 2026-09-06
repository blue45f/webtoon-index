// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaKernelDabProgramPin,
} from "./studio-brush-dynamics";
import {
  studioBrushWatercolorProgramSetFrom,
  type StudioBrushEngineProgramSet,
} from "./studio-brush-engine-program-set";
import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "./studio-brush-library";
import {
  StudioBrushEngineStackPanel,
  StudioBrushSaveAsCustomControls,
  StudioBrushTraitImportControls,
  StudioBrushWatercolorProgramControls,
} from "./StudioBrushEngineMixer";

const putSpy = vi.fn(async (_brush: unknown) => undefined);
const notifySpy = vi.fn();

vi.mock("./studio-brush-library-sqlite-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-brush-library-sqlite-repository")>();
  return {
    ...actual,
    openProductBrushLibraryRepository: vi.fn(async () => ({
      authority: "sqlite" as const,
      repository: {
        put: putSpy,
      },
    })),
    notifyStudioBrushLibraryChanged: () => notifySpy(),
  };
});

afterEach(() => {
  cleanup();
  putSpy.mockClear();
  notifySpy.mockClear();
});

describe("StudioBrushEngineMixer", () => {
  it("renders the complete engine stack and authoring-time quality diagnosis", () => {
    const base = studioBrushDynamicsSettingsForBrushId("dry-media");
    expect(base).toBeTruthy();
    const settings = normalizeStudioBrushDynamicsSettings({
      ...base!,
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
    });
    render(
      <StudioBrushEngineStackPanel
        brushId="dry-media"
        settings={settings}
        enginePrograms={null}
      />,
    );
    expect(screen.getByText("드라이 미디어")).toBeTruthy();
    expect(screen.getByText("드라이 미디어 전용 커널")).toBeTruthy();
    expect(screen.getByText("품질 안정도")).toBeTruthy();
    expect(screen.getByText("조합 복잡도")).toBeTruthy();
    expect(screen.getByText("실시간 작업량")).toBeTruthy();
    expect(screen.getByText(/실제 팁 샘플과 레이어/u)).toBeTruthy();
  });

  it("imports one granular trait from the selected source brush", () => {
    const current = studioBrushDynamicsSettingsForBrushId("dry-media")!;
    const source = studioBrushDynamicsSettingsForBrushId("airbrush")!;
    const onSettingsChange = vi.fn();
    render(
      <StudioBrushTraitImportControls
        settings={current}
        onSettingsChange={onSettingsChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("소스 브러시"), {
      target: { value: "airbrush" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^펜촉/u }));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].tip).toEqual(source.tip);
    expect(screen.getByRole("status").textContent).toContain("가져왔어요");
  });

  it("applies a curated multi-source recipe and offers one-step restore", async () => {
    const current = studioBrushDynamicsSettingsForBrushId("dry-media")!;
    const sourceTip = studioBrushDynamicsSettingsForBrushId("hard-airbrush")!;
    const onSettingsChange = vi.fn();
    render(
      <StudioBrushTraitImportControls
        settings={current}
        onSettingsChange={onSettingsChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /웹툰 선화 하이브리드/u }));
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledTimes(1);
    });
    expect(onSettingsChange.mock.calls[0][0].tip).toEqual(sourceTip.tip);
    expect(screen.getByRole("status").textContent).toContain("3개 엔진 특성");

    fireEvent.click(screen.getByRole("button", { name: "직전 조합" }));
    expect(onSettingsChange).toHaveBeenCalledTimes(2);
    expect(onSettingsChange.mock.calls[1][0]).toEqual(current);
  });

  it("offers an actionable quality stabilizer for risky combinations", () => {
    const base = studioBrushDynamicsSettingsForBrushId("dry-media")!;
    const risky = normalizeStudioBrushDynamicsSettings({
      ...base,
      spacingRatio: 0.62,
      scatterRatio: 0.88,
    });
    const onSettingsChange = vi.fn();
    render(
      <StudioBrushTraitImportControls
        settings={risky}
        onSettingsChange={onSettingsChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "품질 자동 안정화" }));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange.mock.calls[0][0].spacingRatio).toBe(0.22);
    expect(onSettingsChange.mock.calls[0][0].scatterRatio).toBe(0.22);
    expect(screen.getByRole("status").textContent).toContain("보수적으로 안정화");
  });

  it("filters the source catalogue without removing the active selector", () => {
    const current = studioBrushDynamicsSettingsForBrushId("dry-media")!;
    render(
      <StudioBrushTraitImportControls
        settings={current}
        onSettingsChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("브러시 소스 검색"), {
      target: { value: "에어브러시" },
    });
    const select = screen.getByLabelText("소스 브러시") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(Array.from(select.options).some((option) => option.textContent?.includes("에어브러시")))
      .toBe(true);
  });

  it("emits mutually exclusive watercolor quick programs", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioBrushWatercolorProgramControls
        brushId="watercolor"
        programSet={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "과립 침전" }));
    expect(onChange).toHaveBeenCalledWith(
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "granulating-wash" }),
    );

    const conflicting: StudioBrushEngineProgramSet = {
      version: 1,
      watercolor: {
        wetEdgeBloomProgramId: "edge-bloom",
        livingInkBakeProgramId: "sumi-flow-bake",
      },
    };
    rerender(
      <StudioBrushWatercolorProgramControls
        brushId="watercolor"
        programSet={conflicting}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /동시 저장된 두 프로그램/u }));
    expect(onChange).toHaveBeenLastCalledWith(
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "edge-bloom" }),
    );
  });

  it("saves the current snapshot as a named custom brush into the product library", async () => {
    const settings = studioBrushDynamicsSettingsForBrushId("crayon");
    render(
      <StudioBrushSaveAsCustomControls
        snapshot={{
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          brushId: "crayon",
          ...(settings ? { brushDynamics: settings } : {}),
        }}
        baseBrushName="크레용"
      />,
    );
    const nameInput = screen.getByLabelText("새 브러시 이름") as HTMLInputElement;
    expect(nameInput.value).toBe("크레용 조합");
    fireEvent.change(nameInput, { target: { value: "내 크레용" } });
    fireEvent.click(screen.getByRole("button", { name: "내 브러시에 저장" }));
    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    });
    const saved = putSpy.mock.calls[0]?.[0] as
      | { name?: string; brushId?: string }
      | undefined;
    expect(saved?.name).toBe("내 크레용");
    expect(saved?.brushId).toBe("crayon");
    expect(notifySpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("저장했어요");
    });
  });
});
