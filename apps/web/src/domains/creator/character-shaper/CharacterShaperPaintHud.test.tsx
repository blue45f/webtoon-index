// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterShaperPaintHud } from "./CharacterShaperPaintHud";

import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

afterEach(cleanup);

function makeHost(overrides: Record<string, unknown> = {}): StudioVrmPoserHost {
  return {
    texturePaintSettings: {
      tool: "surface-brush",
      brushKind: "ink",
      color: "#d85f48",
      sizeTexels: 48,
      opacity: 1,
      blend: "normal",
      fillScope: "contiguous",
      fillTolerance: 24,
      tuning: { flow: 1, hardness: 0.8, minSize: 0.2 },
    },
    texturePaintDisabledReason: "",
    texturePaintStatus: "상의 텍스처를 칠하는 중",
    texturePaintEyedropperActive: false,
    texturePaintStrokeActive: false,
    texturePaintSnapshot: { history: { undoCount: 2, redoCount: 1 }, targets: [], activeTargetId: "tops" },
    handleTexturePaintSettingsChange: vi.fn(),
    setTexturePaintEyedropperActive: vi.fn(),
    handleTexturePaintUndo: vi.fn(),
    handleTexturePaintRedo: vi.fn(),
    handleTexturePaintReset: vi.fn(),
    ...overrides,
  } as StudioVrmPoserHost;
}

function renderHud(overrides: Record<string, unknown> = {}) {
  const h = makeHost(overrides);
  const onExit = vi.fn();
  const view = render(<CharacterShaperPaintHud h={h} onExit={onExit} />);
  return { ...view, h, onExit };
}

describe("CharacterShaperPaintHud", () => {
  it("maps the four tools onto the runtime settings", () => {
    const { h } = renderHud();

    expect(screen.getByRole("button", { name: "브러시" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "지우개" }));
    expect(h.handleTexturePaintSettingsChange).toHaveBeenCalledWith({ tool: "surface-brush", blend: "erase" });

    fireEvent.click(screen.getByRole("button", { name: "채우기" }));
    expect(h.handleTexturePaintSettingsChange).toHaveBeenLastCalledWith({ tool: "fill" });

    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    expect(h.setTexturePaintEyedropperActive).toHaveBeenCalledTimes(1);
  });

  it("marks the eraser and the eyedropper as the active tool from host state", () => {
    const { unmount } = renderHud({
      texturePaintSettings: { ...makeHost().texturePaintSettings, blend: "erase" },
    });
    expect(screen.getByRole("button", { name: "지우개" }).getAttribute("aria-pressed")).toBe("true");
    unmount();

    renderHud({ texturePaintEyedropperActive: true });
    expect(screen.getByRole("button", { name: "스포이드" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("edits size, opacity and color through the runtime", () => {
    const { h } = renderHud();

    fireEvent.change(screen.getByRole("slider", { name: "브러시 굵기" }), { target: { value: "72" } });
    expect(h.handleTexturePaintSettingsChange).toHaveBeenCalledWith({ sizeTexels: 72 });

    fireEvent.change(screen.getByRole("slider", { name: "브러시 농도" }), { target: { value: "0.5" } });
    expect(h.handleTexturePaintSettingsChange).toHaveBeenLastCalledWith({ opacity: 0.5 });

    fireEvent.change(screen.getByLabelText("칠할 색"), { target: { value: "#123456" } });
    expect(h.handleTexturePaintSettingsChange).toHaveBeenLastCalledWith({ color: "#123456" });
  });

  it("resizes the brush with the [ and ] keys", () => {
    const { h } = renderHud();

    fireEvent.keyDown(document.body, { key: "]" });
    expect(h.handleTexturePaintSettingsChange).toHaveBeenLastCalledWith({ sizeTexels: 56 });

    fireEvent.keyDown(document.body, { key: "[" });
    expect(h.handleTexturePaintSettingsChange).toHaveBeenLastCalledWith({ sizeTexels: 40 });
  });

  it("undoes and redoes paint strokes, and disables what the history cannot do", () => {
    const { h, unmount } = renderHud();

    fireEvent.click(screen.getByRole("button", { name: "드로잉 되돌리기" }));
    expect(h.handleTexturePaintUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "드로잉 다시 실행" }));
    expect(h.handleTexturePaintRedo).toHaveBeenCalledTimes(1);
    unmount();

    renderHud({ texturePaintSnapshot: { history: { undoCount: 0, redoCount: 0 }, targets: [], activeTargetId: null } });
    expect((screen.getByRole("button", { name: "드로잉 되돌리기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "드로잉 다시 실행" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks once more before clearing the surface", () => {
    const { h } = renderHud();

    fireEvent.click(screen.getByRole("button", { name: "이 표면의 드로잉 전부 지우기" }));
    expect(h.handleTexturePaintReset).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "표면 드로잉 상태" }).textContent).toContain("한 번 더 누르면");

    fireEvent.click(screen.getByRole("button", { name: "이 표면의 드로잉 전부 지우기 확인" }));
    expect(h.handleTexturePaintReset).toHaveBeenCalledTimes(1);
  });

  it("exits back to the workshop", () => {
    const { onExit } = renderHud();
    fireEvent.click(screen.getByRole("button", { name: "표면 드로잉 끝내기" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows the runtime's reason and locks the tools when painting is unavailable", () => {
    const { h } = renderHud({ texturePaintDisabledReason: "이 모델에는 칠할 수 있는 표면이 없습니다." });

    expect(screen.getByRole("status", { name: "표면 드로잉 상태" }).textContent).toContain("이 모델에는 칠할 수 있는 표면이 없습니다.");
    expect((screen.getByRole("button", { name: "브러시" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: "브러시 굵기" }) as HTMLInputElement).disabled).toBe(true);

    fireEvent.keyDown(document.body, { key: "]" });
    expect(h.handleTexturePaintSettingsChange).not.toHaveBeenCalled();
  });

  it("keeps the status line honest while a stroke is still open", () => {
    renderHud({ texturePaintStrokeActive: true });
    expect((screen.getByRole("button", { name: "채우기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status", { name: "표면 드로잉 상태" }).textContent).toContain("상의 텍스처를 칠하는 중");
  });
});
