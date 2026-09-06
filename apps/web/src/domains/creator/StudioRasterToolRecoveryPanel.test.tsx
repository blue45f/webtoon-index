// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStudioRasterToolAvailability } from "./render/studio-raster-tool-availability";
import {
  StudioInspectorFilterLauncher,
  StudioInspectorPixelSelectionLauncher,
  StudioRasterToolRecoveryPanel,
  type StudioInspectorPixelSelectionToolId,
} from "./StudioRasterToolRecoveryPanel";

const preloadRasterRetouchRuntime = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);

vi.mock("./render/studio-raster-retouch-preload", () => ({
  preloadStudioRasterRetouchRuntime: preloadRasterRetouchRuntime,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioRasterToolRecoveryPanel", () => {
  it("offers the canonical non-destructive recovery for vector retouch targets", () => {
    const onRecover = vi.fn();
    const entry = resolveStudioRasterToolAvailability("liquify", {
      selectedType: "draw",
      visibleVectorDrawCount: 1,
      exactRenderableVisibleCount: 1,
    });

    render(<StudioRasterToolRecoveryPanel entries={[entry]} onRecover={onRecover} />);

    expect(screen.getByText("합성본 준비")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "페이지 합성본 준비 후 실행" }));
    expect(onRecover).toHaveBeenCalledWith({
      toolId: "liquify",
      action: entry.entry.action,
    });
  });

  it("exposes shared raster preparation as a cancellable busy recovery", () => {
    const onRecover = vi.fn();
    const entry = resolveStudioRasterToolAvailability("liquify", {
      selectedType: "draw",
      visibleVectorDrawCount: 1,
      exactRenderableVisibleCount: 1,
    });

    render(
      <StudioRasterToolRecoveryPanel
        entries={[entry]}
        busy
        onRecover={onRecover}
      />,
    );

    expect(
      screen.getByRole("region", { name: "픽셀 편집 준비" }).getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      screen.getByText(/Esc를 누르면 준비를 취소/u).getAttribute("role"),
    ).toBe("status");
    const recovery = screen.getByRole<HTMLButtonElement>("button", {
      name: "페이지 합성본 준비 후 실행",
    });
    expect(recovery.disabled).toBe(true);
    fireEvent.click(recovery);
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("prewarms vector-to-raster retouch and transform recovery intent without recovering", () => {
    const onRecover = vi.fn();
    const context = {
      selectedType: "draw",
      visibleVectorDrawCount: 1,
      exactRenderableVisibleCount: 1,
    } as const;
    const entries = [
      resolveStudioRasterToolAvailability("liquify", context),
      resolveStudioRasterToolAvailability("crop", context),
    ];

    render(<StudioRasterToolRecoveryPanel entries={entries} onRecover={onRecover} />);

    const recoveryButtons = screen.getAllByRole("button", {
      name: "페이지 합성본 준비 후 실행",
    });
    fireEvent.pointerEnter(recoveryButtons[0]!);
    fireEvent.pointerDown(recoveryButtons[0]!);
    fireEvent.focus(recoveryButtons[0]!);
    fireEvent.pointerEnter(recoveryButtons[1]!);
    fireEvent.pointerDown(recoveryButtons[1]!);
    fireEvent.focus(recoveryButtons[1]!);

    expect(preloadRasterRetouchRuntime).toHaveBeenCalledTimes(6);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(1, { liquify: true });
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(2, { liquify: true });
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(3, { liquify: true });
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(4);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(5);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(6);
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("launches every registered filter against a page composite without an image selection", () => {
    const onSelect = vi.fn();
    const availability = resolveStudioRasterToolAvailability("filter", {
      selectedType: "draw",
      visibleVectorDrawCount: 1,
      exactRenderableVisibleCount: 1,
    });

    render(
      <StudioInspectorFilterLauncher
        availability={availability}
        onRecover={vi.fn()}
        onSelect={onSelect}
      />,
    );

    const select = screen.getByRole("combobox", { name: "현재 페이지 합성본 필터 선택" });
    expect(select.querySelectorAll("option").length).toBeGreaterThan(5);
    fireEvent.change(select, { target: { value: "gaussian-blur" } });
    expect(onSelect).toHaveBeenCalledWith("gaussian-blur");
  });

  it("deduplicates one shared recovery action across related retouch tools", () => {
    const onRecover = vi.fn();
    const entries = ["pixel-marquee", "pixel-lasso", "magic-wand"].map((toolId) =>
      resolveStudioRasterToolAvailability(
        toolId as "pixel-marquee" | "pixel-lasso" | "magic-wand",
        {
          selectedType: "draw",
          visibleVectorDrawCount: 1,
          exactRenderableVisibleCount: 1,
        },
      ),
    );

    render(<StudioRasterToolRecoveryPanel entries={entries} onRecover={onRecover} />);

    const buttons = screen.getAllByRole("button", {
      name: /페이지 합성본 준비 후 실행/u,
    });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toContain("3개 도구용");
    fireEvent.click(buttons[0]!);
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it("keeps auto-prepared retouch actions individually addressable", () => {
    const onRecover = vi.fn();
    const entries = ["smudge", "dodge-burn", "wet-mix", "liquify"].map((toolId) =>
      resolveStudioRasterToolAvailability(
        toolId as "smudge" | "dodge-burn" | "wet-mix" | "liquify",
        {
          selectedType: "draw",
          visibleVectorDrawCount: 1,
          exactRenderableVisibleCount: 1,
        },
      ),
    );

    render(<StudioRasterToolRecoveryPanel entries={entries} onRecover={onRecover} />);

    const buttons = screen.getAllByRole("button", {
      name: "페이지 합성본 준비 후 실행",
    });
    expect(buttons).toHaveLength(entries.length);
    fireEvent.click(buttons[2]!);
    expect(onRecover).toHaveBeenCalledWith({
      toolId: "wet-mix",
      action: entries[2]!.entry.action,
    });
  });

  it("keeps a blocked filter reason and recovery action available to assistive technology", () => {
    const onRecover = vi.fn();
    const availability = resolveStudioRasterToolAvailability("filter", {});

    render(
      <StudioInspectorFilterLauncher
        availability={availability}
        onRecover={onRecover}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("편집할 표시 콘텐츠가 없습니다");
    fireEvent.click(screen.getByRole("button", { name: /콘텐츠 추가/u }));
    expect(onRecover).toHaveBeenCalledWith({
      toolId: "filter",
      action: availability.entry.action,
    });
  });
});

function SwitchingSelectionLauncher({
  busy = false,
  onPickTool,
}: {
  busy?: boolean;
  onPickTool: (tool: StudioInspectorPixelSelectionToolId) => void;
}) {
  const [activeTool, setActiveTool] =
    useState<StudioInspectorPixelSelectionToolId | null>(null);
  const availability = resolveStudioRasterToolAvailability("pixel-marquee", {
    selectedType: "draw",
    visibleVectorDrawCount: 1,
    exactRenderableVisibleCount: 1,
  });

  return (
    <StudioInspectorPixelSelectionLauncher
      availability={availability}
      activeTool={activeTool}
      busy={busy}
      onPickTool={(tool) => {
        setActiveTool(tool);
        onPickTool(tool);
      }}
      onRecover={vi.fn()}
    />
  );
}

describe("StudioInspectorPixelSelectionLauncher", () => {
  it("keeps every selection command selectable on a faithful vector-only page", () => {
    const onPickTool = vi.fn();

    render(<SwitchingSelectionLauncher onPickTool={onPickTool} />);

    const toolNames = [
      "사각 선택",
      "타원 선택",
      "원형 선택",
      "자유 올가미",
      "다각형 올가미",
      "선택 브러시",
      "마술봉",
      "색상 범위",
    ] as const;

    expect(screen.getByText("페이지 합성본 준비 후 실행")).toBeTruthy();
    for (const name of toolNames) {
      const button = screen.getByRole("button", { name });
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("false");
      expect(button.getAttribute("title")).toContain("페이지 합성본 준비 후 실행");
    }
  });

  it("preserves the latest active command across repeated tool changes without mutually disabling peers", () => {
    const onPickTool = vi.fn();

    render(<SwitchingSelectionLauncher busy onPickTool={onPickTool} />);

    const sequence = [
      "사각 선택",
      "타원 선택",
      "원형 선택",
      "자유 올가미",
      "다각형 올가미",
      "선택 브러시",
      "마술봉",
      "색상 범위",
      "사각 선택",
    ] as const;
    for (const name of sequence) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(button);
    }

    expect(onPickTool.mock.calls.map(([tool]) => tool)).toEqual([
      "rect",
      "ellipse",
      "circle",
      "lasso",
      "poly-lasso",
      "brush",
      "wand",
      "color-range",
      "rect",
    ]);
    expect(screen.getByRole("button", { name: "사각 선택" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByRole("button", { name: "색상 범위" }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(screen.getByRole("status").textContent).toContain("마지막에 고른 도구");
  });

  it("runs directly against a selected editable image", () => {
    const onPickTool = vi.fn();
    const availability = resolveStudioRasterToolAvailability("pixel-marquee", {
      selectedType: "image",
    });

    render(
      <StudioInspectorPixelSelectionLauncher
        availability={availability}
        activeTool="ellipse"
        onPickTool={onPickTool}
        onRecover={vi.fn()}
      />,
    );

    expect(screen.getByText("즉시 실행")).toBeTruthy();
    const ellipse = screen.getByRole("button", { name: "타원 선택" });
    expect(ellipse.getAttribute("aria-pressed")).toBe("true");
    expect(ellipse.getAttribute("title")).toContain("선택 이미지에서 바로 실행");
    fireEvent.click(screen.getByRole("button", { name: "원형 선택" }));
    expect(onPickTool).toHaveBeenCalledWith("circle");
  });

  it.each([
    [
      "empty page",
      resolveStudioRasterToolAvailability("pixel-marquee", {}),
      "편집할 표시 콘텐츠가 없습니다",
      "콘텐츠 추가",
    ],
    [
      "review lock",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        documentMutationBlockedReason: "검토 잠금을 해제한 뒤 변경할 수 있어요.",
        selectedType: "draw",
        exactRenderableVisibleCount: 1,
      }),
      "검토 잠금을 해제한 뒤 변경할 수 있어요.",
      "편집 잠금 확인",
    ],
    [
      "shared document",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        documentMutationBlockedReason: "공동 문서 편집 권한이 없어 변경할 수 없어요.",
        selectedType: "draw",
        exactRenderableVisibleCount: 1,
      }),
      "공동 문서 편집 권한이 없어 변경할 수 없어요.",
      "편집 잠금 확인",
    ],
    [
      "unsupported fidelity",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        selectedType: "draw",
        exactRenderableVisibleCount: 1,
        unsupportedVisibleCount: 1,
      }),
      "화면과 똑같이",
      null,
    ],
  ] as const)(
    "keeps the exact %s blocker focusable and explained",
    (_label, availability, reason, recoveryLabel) => {
      const onPickTool = vi.fn();

      render(
        <StudioInspectorPixelSelectionLauncher
          availability={availability}
          activeTool={null}
          onPickTool={onPickTool}
          onRecover={vi.fn()}
        />,
      );

      const rect = screen.getByRole("button", { name: "사각 선택" });
      expect(rect.hasAttribute("disabled")).toBe(false);
      expect(rect.getAttribute("aria-disabled")).toBe("true");
      expect(rect.getAttribute("title")).toContain(reason);
      expect(screen.getByRole("status").textContent).toContain(reason);
      fireEvent.click(rect);
      expect(onPickTool).not.toHaveBeenCalled();
      if (recoveryLabel) {
        expect(screen.getByRole("button", { name: recoveryLabel })).toBeTruthy();
      }
    },
  );
});
