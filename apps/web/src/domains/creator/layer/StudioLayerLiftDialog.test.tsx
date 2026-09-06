// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioLayerLiftDialog,
  type StudioLayerLiftDialogProps,
  type StudioLayerLiftReviewPreview,
} from "./StudioLayerLiftDialog";

const PREVIEW: StudioLayerLiftReviewPreview = {
  width: 4,
  height: 3,
  sourceSrc: "data:image/png;base64,source",
  compositeSrc: "data:image/png;base64,composite",
  maskSrc: "data:image/png;base64,mask",
  backgroundSrc: "data:image/png;base64,background",
  foregroundSrc: "data:image/png;base64,foreground",
  maskAlpha: new Uint8Array([
    0, 0, 255, 255,
    0, 255, 255, 255,
    0, 0, 255, 255,
  ]),
  confidenceScore: 0.88,
  confidenceBand: "high",
  backgroundRepairQuality: "review",
  diagnostics: [{
    id: "background-review",
    tone: "warning",
    message: "인물 뒤 배경 경계를 확인해 주세요.",
  }],
};

function props(
  patch: Partial<StudioLayerLiftDialogProps> = {},
): StudioLayerLiftDialogProps {
  return {
    open: true,
    activeKey: "layer-lift:test",
    sourceName: "episode-cut.png",
    sourceSrc: PREVIEW.sourceSrc,
    phase: "review",
    preview: PREVIEW,
    options: { threshold: 0.5, feather: 0.12 },
    onOptionsChange: vi.fn(),
    onAnalyze: vi.fn(),
    onCorrectionCommit: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...patch,
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: function* iterator() {
      yield {} as DOMRect;
    },
  } as DOMRectList);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    contextId: string,
  ) => contextId === "2d" ? {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    clearRect: vi.fn(),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    set globalCompositeOperation(_value: string) {},
    set strokeStyle(_value: string) {},
    set fillStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
  } as unknown as CanvasRenderingContext2D : null
  ) as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioLayerLiftDialog", () => {
  it("stays unmounted while closed", () => {
    render(<StudioLayerLiftDialog {...props({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("presents a labeled, local-first, non-destructive review flow", async () => {
    render(<StudioLayerLiftDialog {...props()} />);

    const dialog = screen.getByRole("dialog", { name: "컷 레이어 복원" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-studio-layer-lift-dialog")).toBe("true");
    expect(screen.getByText("로컬 Beta")).toBeTruthy();
    expect(screen.getByText(/원본을 보존하고 배경·전경 레이어/u)).toBeTruthy();
    expect(screen.getByText(/이미지 픽셀은 추론 서버에 업로드하지 않습니다/u)).toBeTruthy();
    expect(screen.getByRole("list", { name: "적용될 레이어 순서" }).children).toHaveLength(3);
    expect(screen.getByText("원본 백업")).toBeTruthy();
    expect(screen.getByText("분리 배경")).toBeTruthy();
    expect(screen.getByText("분리 전경")).toBeTruthy();
    expect(screen.getByText(/실행 취소 한 번/u)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "미리보기 다시 만들기" }),
    ));
  });

  it("switches preview tabs and exposes functional include/exclude correction controls", () => {
    render(<StudioLayerLiftDialog {...props()} />);

    fireEvent.click(screen.getByRole("tab", { name: "경계 보정" }));
    expect(screen.getByRole("tab", { name: "경계 보정" }).getAttribute("aria-selected"))
      .toBe("true");
    expect(screen.getByLabelText("전경에 포함할 영역을 칠하는 보정 캔버스")).toBeTruthy();
    expect(screen.getByRole("button", { name: /전경에 포함/u }).getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /전경에서 제외/u }));
    expect(screen.getByRole("button", { name: /전경에서 제외/u }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByLabelText("전경에서 제외할 영역을 칠하는 보정 캔버스")).toBeTruthy();
  });

  it("emits threshold and feather changes without triggering analysis per keystroke", () => {
    const onOptionsChange = vi.fn();
    const onAnalyze = vi.fn();
    render(
      <StudioLayerLiftDialog
        {...props({ onOptionsChange, onAnalyze })}
      />,
    );

    fireEvent.change(screen.getByLabelText("전경 임계값"), {
      target: { value: "0.61" },
    });
    fireEvent.change(screen.getByLabelText("경계 부드러움"), {
      target: { value: "0.2" },
    });
    expect(onOptionsChange).toHaveBeenNthCalledWith(1, {
      threshold: 0.61,
      feather: 0.12,
    });
    expect(onOptionsChange).toHaveBeenNthCalledWith(2, {
      threshold: 0.5,
      feather: 0.2,
    });
    expect(onAnalyze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "미리보기 다시 만들기" }));
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it("blocks apply with an explicit document reason and keeps dismissal available", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <StudioLayerLiftDialog
        {...props({
          mutationLocked: true,
          mutationLockReason: "저장된 팀 원고 지원은 다음 단계에서 연결됩니다.",
          onApply,
          onCancel,
        })}
      />,
    );

    expect(screen.getByText("저장된 팀 원고 지원은 다음 단계에서 연결됩니다.")).toBeTruthy();
    const apply = screen.getByRole("button", { name: "원본을 보존하고 레이어로 적용" });
    expect(apply).toHaveProperty("disabled", true);
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows honest analyzing and error recovery states", () => {
    const view = render(
      <StudioLayerLiftDialog
        {...props({
          phase: "analyzing",
          preview: null,
          progressLabel: "로컬 모델을 준비하고 있어요.",
        })}
      />,
    );

    expect(screen.getByText("인물·캐릭터 경계를 찾고 있어요")).toBeTruthy();
    expect(screen.getAllByText("로컬 모델을 준비하고 있어요.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "분석 시작" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "원본을 보존하고 레이어로 적용" }))
      .toHaveProperty("disabled", true);

    view.rerender(
      <StudioLayerLiftDialog
        {...props({
          phase: "error",
          preview: null,
          error: "이미지 픽셀을 읽을 수 없습니다.",
        })}
      />,
    );
    expect(screen.getByText("분석을 완료하지 못했습니다")).toBeTruthy();
    expect(screen.getAllByText("이미지 픽셀을 읽을 수 없습니다.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "분석 시작" })).toHaveProperty("disabled", false);
  });

  it("uses full-screen mobile geometry and 44px primary interactions", () => {
    render(<StudioLayerLiftDialog {...props()} />);

    const dialog = screen.getByRole("dialog", { name: "컷 레이어 복원" });
    expect(dialog.className).toContain("h-[100dvh]");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("sm:max-w-6xl");
    expect(dialog.parentElement?.className).toContain("safe-area-inset-left");
    const cancel = screen.getByRole("button", { name: "취소" });
    const apply = screen.getByRole("button", { name: "원본을 보존하고 레이어로 적용" });
    expect(cancel.className).toContain("min-h-11");
    expect(apply.className).toContain("min-h-11");
    expect(cancel.parentElement?.className).toContain("grid-cols-1");
    expect(cancel.parentElement?.className).toContain("min-[360px]");
  });
});
