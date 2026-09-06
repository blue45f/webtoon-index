// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_BRUSH_SIZE_RANGE } from "./brush/studio-draw-ux";
import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";
import { StudioBrushSizePresetGrid } from "./StudioInspectorAside";

const asideSource = readStudioInspectorAsideSurface();

describe("StudioBrushSizePresetGrid", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the clickable preset grid clamped to STUDIO_BRUSH_SIZE_RANGE", () => {
    render(
      <StudioBrushSizePresetGrid activeSize={8} recentSizes={[]} onCommit={() => {}} />
    );

    expect(screen.getByRole("group", { name: "브러시 크기 프리셋" })).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    // 1/2/3/5/8/10/15/20/30/50/80 — 100은 max(80)로 클램프된 뒤 80과 합쳐져 버튼이 겹치지 않는다.
    expect(buttons.length).toBe(11);
    for (const button of buttons) {
      const size = Number(button.textContent);
      expect(size).toBeGreaterThanOrEqual(STUDIO_BRUSH_SIZE_RANGE.min);
      expect(size).toBeLessThanOrEqual(STUDIO_BRUSH_SIZE_RANGE.max);
    }
  });

  it("commits the clicked preset size through onCommit", () => {
    const onCommit = vi.fn();
    render(
      <StudioBrushSizePresetGrid activeSize={8} recentSizes={[]} onCommit={onCommit} />
    );

    fireEvent.click(screen.getByRole("button", { name: "브러시 크기 30px" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it("highlights only the active size via aria-pressed", () => {
    render(
      <StudioBrushSizePresetGrid activeSize={15} recentSizes={[]} onCommit={() => {}} />
    );

    const pressed = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBe(1);
    expect(pressed[0]?.getAttribute("aria-label")).toBe("브러시 크기 15px");
  });

  it("keeps every preset a real keyboard-focusable <button>", () => {
    render(
      <StudioBrushSizePresetGrid activeSize={8} recentSizes={[]} onCommit={() => {}} />
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.hasAttribute("aria-pressed")).toBe(true);
    }
  });

  it("shows up to 4 distinct recent sizes, clamped and deduplicated against presets", () => {
    render(
      <StudioBrushSizePresetGrid
        activeSize={13}
        recentSizes={[13, 400, 27, 13, 42, 61, 77]}
        onCommit={() => {}}
      />
    );

    // 400은 80으로 클램프된 뒤 프리셋(80)과 중복이라 제외. 13/27/42/61 네 개만 남는다.
    for (const size of [13, 27, 42, 61]) {
      expect(
        screen.getByRole("button", { name: `최근 브러시 크기 ${size}px` })
      ).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "최근 브러시 크기 77px" })).toBeNull();
    expect(screen.queryByRole("button", { name: "최근 브러시 크기 80px" })).toBeNull();
    expect(screen.queryByRole("button", { name: "최근 브러시 크기 400px" })).toBeNull();

    // 활성 강조는 최근 칩에도 똑같이 적용된다.
    const recent13 = screen.getByRole("button", { name: "최근 브러시 크기 13px" });
    expect(recent13.getAttribute("aria-pressed")).toBe("true");
  });

  it("commits recent chips through the same onCommit path", () => {
    const onCommit = vi.fn();
    render(
      <StudioBrushSizePresetGrid activeSize={8} recentSizes={[13]} onCommit={onCommit} />
    );

    fireEvent.click(screen.getByRole("button", { name: "최근 브러시 크기 13px" }));
    expect(onCommit).toHaveBeenCalledWith(13);
  });
});

describe("StudioInspectorAside — 크기 프리셋 그리드 배선", () => {
  it("mounts the grid beside the size slider and clamps commits to the brush range", () => {
    expect(asideSource).toContain("<StudioBrushSizePresetGrid");
    expect(asideSource).toContain("onCommit={commitBrushSizePreset}");
    expect(asideSource).toContain("activeSize={strokeWidth}");
    // 커밋은 adjustStudioBrushSize(클램프+반올림)를 지나 strokeWidth 하나만 갱신한다.
    expect(asideSource).toContain("const next = adjustStudioBrushSize(size, 0);");
    expect(asideSource).toContain("setStrokeWidth(next);");
  });

  it("records slider and grid commits as component-state recents without persistence", () => {
    expect(asideSource).toContain(
      "onPointerUp={(e) => rememberRecentBrushSize(Number(e.currentTarget.value))}"
    );
    expect(asideSource).toContain(
      "const [recentBrushSizes, setRecentBrushSizes] = useState<readonly number[]>([]);"
    );
    expect(asideSource).not.toContain("recentBrushSizes\", JSON.stringify");
  });
});

describe("StudioInspectorAside — CSP 경계 효과 배선", () => {
  it("mounts the border-effect panel inside the layers tabpanel for image layers only", () => {
    expect(asideSource).toContain("<StudioLayerBorderEffectPanel");
    expect(asideSource).toContain("{selected?.type === \"image\" ? (");
    expect(asideSource).toContain("value={selected.borderEffect}");
  });

  it("commits through the shared patchEl layer-property seam (no new page closures)", () => {
    expect(asideSource).toContain(
      "onChange={(next) => patchEl(selected.id, { borderEffect: next } as Partial<El>)}"
    );
  });

  it("listens for the menu open event and routes to the layers tab", () => {
    expect(asideSource).toContain("STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT");
    expect(asideSource).toContain(
      "window.addEventListener(STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT, openLayerBorderEffectPanel)"
    );
    expect(asideSource).toContain(
      "window.removeEventListener(STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT, openLayerBorderEffectPanel)"
    );
  });
});
