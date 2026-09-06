// @vitest-environment jsdom
// Interactive presentation tests for the thin auto-color hints product panel.
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  planStudioAutoColorHints,
  type StudioAutoColorHintRequest,
} from "./studio-auto-color-hints";
import {
  createStudioAutoColorHintsDemoRequest,
  summarizeStudioAutoColorHintPlan,
} from "./studio-auto-color-hints-summary";
import { StudioAutoColorHintsPanel } from "./StudioAutoColorHintsPanel";

function mockCanvas2dContext(context: CanvasRenderingContext2D | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d" ? context : null) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
}

afterEach(() => {
  cleanup();
});

describe("StudioAutoColorHintsPanel presentation", () => {
  it("explains plan-only safety and never claims silent pixel overwrite", () => {
    render(<StudioAutoColorHintsPanel />);

    expect(screen.getByTestId("studio-auto-color-hints-panel")).toBeTruthy();
    expect(
      screen.getByTestId("studio-auto-color-hints-panel").getAttribute(
        "data-studio-auto-color-hints-panel",
      ),
    ).toBe("true");
    expect(screen.getByRole("heading", { name: "자동 채색 힌트" })).toBeTruthy();
    expect(screen.getByText(/확인 후에만 고급 채우기 배치로 적용/)).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "계획 전용 — 픽셀 자동 적용 없음" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "힌트 계획 실행" })).toBeTruthy();
    expect(screen.getByText("스크리블 시드 색")).toBeTruthy();
    expect(document.body.textContent).not.toContain("자동으로 픽셀을 덮어씁니다");
  });

  it("runs the pure planner on the demo fixture and shows Korean summary metrics", async () => {
    const onPlan = vi.fn();
    render(<StudioAutoColorHintsPanel onPlan={onPlan} />);

    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));

    await waitFor(() => {
      expect(screen.getByText(/힌트 계획 준비됨|힌트 계획 차단/)).toBeTruthy();
    });

    expect(onPlan).toHaveBeenCalledTimes(1);
    const plan = onPlan.mock.calls[0]?.[0];
    const summary = summarizeStudioAutoColorHintPlan(plan);
    expect(screen.getByText("영역").parentElement?.textContent).toContain(
      String(summary.regionCount),
    );
    expect(screen.getByText("제안 연산").parentElement?.textContent).toContain(
      String(summary.operationCount),
    );
    expect(screen.getByText("충돌").parentElement?.textContent).toContain(
      String(summary.conflictCount),
    );
    expect(screen.getByText("권장 시드").parentElement?.textContent).toContain(
      String(summary.recommendationCount),
    );
    expect(screen.getByText(/데모 선화로 계산했습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "계획 복사" })).toBeTruthy();
  });

  it("accepts a parent request and custom onRun without rewriting pixels", async () => {
    const request = createStudioAutoColorHintsDemoRequest();
    const customPlan = planStudioAutoColorHints(request);
    const onRun = vi.fn(async (_req: StudioAutoColorHintRequest) => customPlan);

    render(<StudioAutoColorHintsPanel request={request} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));

    await waitFor(() => {
      expect(onRun).toHaveBeenCalledTimes(1);
    });
    expect(onRun.mock.calls[0]?.[0]).toBe(request);
    await waitFor(() => {
      expect(screen.getByText(/힌트 계획 준비됨/)).toBeTruthy();
    });
    expect(screen.queryByText(/데모 선화로 계산했습니다/)).toBeNull();
    expect(screen.getByRole("button", { name: "계획 복사" })).toBeTruthy();
  });

  it("surfaces planner errors without applying any fill", async () => {
    render(
      <StudioAutoColorHintsPanel
        onRun={() => {
          throw new Error("예산 초과 테스트");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("예산 초과 테스트");
    });
    expect(screen.queryByRole("button", { name: "계획 복사" })).toBeNull();
  });
});

describe("StudioAutoColorHintsPanel module boundary", () => {
  it("stays a leaf: no StudioPage / document mutation imports", () => {
    // jsdom env: prefer dirname over `new URL(..., import.meta.url)` (scheme can be non-file).
    const source = readFileSync(
      path.join(import.meta.dirname, "StudioAutoColorHintsPanel.tsx"),
      "utf8"
    );
    expect(source).not.toContain("./StudioPage");
    expect(source).not.toContain("./StudioInspectorAside");
    expect(source).not.toContain("patchEl");
    expect(source).not.toContain("setPages");
    expect(source).toContain("planStudioAutoColorHints");
    expect(source).toContain("summarizeStudioAutoColorHintPlan");
    // Explicit apply goes through the pure batch bridge; no StudioPage/worker fill glue.
    expect(source).toContain("applyStudioAutoColorHintsAdvancedFillBatch");
    expect(source).not.toContain("applyAdvancedFillPreview");
    expect(source).not.toContain("runStudioAdvancedFill");
    expect(source).toContain('data-studio-auto-color-scribble="true"');
  });

  it("arms canvas scribble and ingests one-shot seed hits with the active palette color", async () => {
    const onArmed = vi.fn();
    const onConsumed = vi.fn();
    render(
      <StudioAutoColorHintsPanel
        onScribbleCanvasArmedChange={onArmed}
        canvasSeedHit={{ x: 12, y: 8, nonce: 1 }}
        onCanvasSeedHitConsumed={onConsumed}
      />,
    );
    const arm = screen.getByRole("button", { name: /캔버스에 시드 찍기/ });
    expect(arm.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(arm);
    expect(onArmed).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(onConsumed).toHaveBeenCalled();
      expect(screen.getByText(/시드 1개/)).toBeTruthy();
    });
  });

  it("blocks a new canvas arm while busy but keeps the armed exit action available", async () => {
    const onArmed = vi.fn();
    let finishRun: ((plan: ReturnType<typeof planStudioAutoColorHints>) => void) | undefined;
    const onRun = vi.fn(
      () =>
        new Promise<ReturnType<typeof planStudioAutoColorHints>>((resolve) => {
          finishRun = resolve;
        }),
    );
    const { rerender } = render(
      <StudioAutoColorHintsPanel
        onRun={onRun}
        scribbleCanvasArmed={false}
        onScribbleCanvasArmedChange={onArmed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(
      (
        screen.getByRole("button", {
          name: /캔버스에 시드 찍기/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <StudioAutoColorHintsPanel
        onRun={onRun}
        scribbleCanvasArmed
        onScribbleCanvasArmedChange={onArmed}
      />,
    );
    const exit = screen.getByRole("button", { name: /캔버스에 시드 찍기/ });
    expect((exit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(exit);
    expect(onArmed).toHaveBeenLastCalledWith(false);

    finishRun?.(planStudioAutoColorHints(createStudioAutoColorHintsDemoRequest()));
  });

  it("ingests a freehand stroke seed batch in one pass", async () => {
    const onConsumed = vi.fn();
    render(
      <StudioAutoColorHintsPanel
        canvasSeedHits={[
          { x: 1, y: 2, nonce: 10 },
          { x: 5, y: 6, nonce: 11 },
          { x: 9, y: 10, nonce: 12 },
        ]}
        onCanvasSeedHitConsumed={onConsumed}
      />,
    );
    await waitFor(() => {
      expect(onConsumed).toHaveBeenCalled();
      expect(screen.getByText(/시드 3개/)).toBeTruthy();
    });
  });

  it("exposes scribble palette and apply only when onApplyResult is provided", async () => {
    const onApplyResult = vi.fn();
    // jsdom often lacks a real 2d context; pin the encode/document patch contract.
    const fakeContext = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      putImageData: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };
    const getContext = mockCanvas2dContext(
      fakeContext as unknown as CanvasRenderingContext2D,
    );
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,cW9p");
    render(<StudioAutoColorHintsPanel onApplyResult={onApplyResult} />);
    expect(screen.getByText("스크리블 시드 색")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "선택 레이어에 적용" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));
    await waitFor(() => {
      expect(screen.getByText(/힌트 계획 준비됨/)).toBeTruthy();
    });
    const applyButton = screen.getByRole("button", { name: "선택 레이어에 적용" });
    // Surface plan metrics so failures show whether canApply should be true.
    expect(screen.getByText("제안 연산").parentElement?.textContent).toMatch(/[1-9]/);
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    // Demo plan with one seed is ready — apply paints and reports PNG to parent.
    fireEvent.click(applyButton);
    await waitFor(() => {
      if (screen.queryByRole("alert")) {
        throw new Error(`apply error: ${screen.getByRole("alert").textContent}`);
      }
      expect(onApplyResult).toHaveBeenCalled();
    });
    const dataUrl = onApplyResult.mock.calls[0]?.[0];
    expect(dataUrl).toBe("data:image/png;base64,cW9p");
    expect(toDataURL).toHaveBeenCalled();
    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  it("applies ready plans to a new transparent paint layer when requested", async () => {
    const onApplyNewLayer = vi.fn();
    const fakeContext = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      putImageData: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };
    const getContext = mockCanvas2dContext(
      fakeContext as unknown as CanvasRenderingContext2D,
    );
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,bmV3");
    render(
      <StudioAutoColorHintsPanel
        onApplyResult={vi.fn()}
        onApplyNewLayer={onApplyNewLayer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "힌트 계획 실행" }));
    await waitFor(() => {
      expect(screen.getByText(/힌트 계획 준비됨/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: /새 채색 레이어/ }));
    fireEvent.click(screen.getByRole("button", { name: "새 채색 레이어에 적용" }));
    await waitFor(() => {
      expect(onApplyNewLayer).toHaveBeenCalled();
    });
    expect(onApplyNewLayer.mock.calls[0]?.[0]).toMatchObject({
      dataUrl: "data:image/png;base64,bmV3",
      name: "채색",
    });
    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  it("exports pure demo + summary entry points used by the panel", () => {
    expect(typeof createStudioAutoColorHintsDemoRequest).toBe("function");
    expect(typeof summarizeStudioAutoColorHintPlan).toBe("function");
    expect(typeof planStudioAutoColorHints).toBe("function");
    expect(typeof StudioAutoColorHintsPanel).toBe("function");
  });
});
