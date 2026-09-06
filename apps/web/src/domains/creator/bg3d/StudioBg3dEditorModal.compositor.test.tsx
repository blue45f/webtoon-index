// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dEditorModal } from "./StudioBg3dEditorModal";

vi.mock("./studio-bg3d-editor-runtime-bindings", () => ({}));
vi.mock("./StudioBg3dEditorViewport", () => ({ StudioBg3dEditorViewport: () => null }));
vi.mock("./StudioBg3dEditorSidebar", () => ({ StudioBg3dEditorSidebar: () => null }));
afterEach(() => cleanup());

function host(overrides: Record<string, unknown> = {}) {
  return {
    Boxes: () => null,
    X: () => null,
    CONTROL_BUTTON: "control",
    ICON_BUTTON: "icon-control",
    cx: (...parts: string[]) => parts.join(" "),
    open: true,
    webXrRendererLifetimeRetained: false,
    modalDialogRef: createRef<HTMLDivElement>(),
    isBatchRenderingShots: false,
    shotBatchProgress: null,
    shotBatchAbortRef: createRef<AbortController>(),
    isCapturing: false,
    deletingModelId: null,
    webXrSessionState: { status: "idle" },
    requestUserClose: vi.fn(),
    ...overrides,
  };
}

describe("BG3D modal compositor boundary", () => {
  it("uses a dense readable scrim rather than sampling the underlying full-screen GPU canvas", () => {
    render(createElement(StudioBg3dEditorModal, { h: host() }));
    const dialog = screen.getByRole("dialog", { name: "3D 장면 스튜디오" });
    expect(dialog.className).toContain("bg-[oklch(0.08_0.01_70/0.94)]");
    expect(dialog.className).not.toContain("backdrop-blur");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps the keyboard-focusable close action and its original dismissal handler", () => {
    const h = host();
    render(createElement(StudioBg3dEditorModal, { h }));
    const close = screen.getByRole("button", { name: /^닫기$/ });
    expect(close.getAttribute("data-bg3d-initial-focus")).toBe("true");
    fireEvent.click(close);
    expect(h.requestUserClose).toHaveBeenCalledOnce();
  });

  it("does not dismiss or expose scene editing while a capture owns the scene", () => {
    const h = host({ isCapturing: true });
    render(createElement(StudioBg3dEditorModal, { h }));
    const close = screen.getByRole("button", { name: /^닫기$/ }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    expect(h.requestUserClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").querySelector('[aria-busy="true"]')?.hasAttribute("inert"))
      .toBe(true);
  });

  it("retains a hidden inert XR owner without retaining an accessible dialog", () => {
    const h = host({ open: false, webXrRendererLifetimeRetained: true });
    const view = render(createElement(StudioBg3dEditorModal, { h }));
    const root = view.container.firstElementChild;
    expect(root?.hasAttribute("hidden")).toBe(true);
    expect(root?.hasAttribute("inert")).toBe(true);
    expect(root?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(createElement(StudioBg3dEditorModal, { h: host({ open: false }) }));
    expect(view.container.childNodes).toHaveLength(0);
  });
});
