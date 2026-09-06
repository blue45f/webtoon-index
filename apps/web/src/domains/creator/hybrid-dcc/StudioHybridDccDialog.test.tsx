// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioHybridDccDialog } from "./StudioHybridDccDialog";

vi.mock("./StudioHybridDccPanel", () => ({
  StudioHybridDccPanel: ({
    onWorkbenchModeChange,
    workbenchMode,
  }: {
    onWorkbenchModeChange?: (mode: "shot") => void;
    workbenchMode?: string;
  }) => (
    <div>
      <button type="button">뷰포트 실행</button>
      <button type="button" onClick={() => onWorkbenchModeChange?.("shot")}>
        Shot 모드
      </button>
      <input aria-label="오브젝트 이름" />
      <output data-testid="workbench-mode">{workbenchMode}</output>
    </div>
  ),
}));

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    view: render(
      <StudioHybridDccDialog
        open
        onClose={onClose}
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    ),
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioHybridDccDialog", () => {
  it("keeps recovery loading inside the dismissible modal shell without mounting the editor", () => {
    const onClose = vi.fn();
    render(
      <StudioHybridDccDialog
        loading
        open
        onClose={onClose}
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(/3D 작업 복구본/u);
    expect(screen.queryByRole("button", { name: "뷰포트 실행" })).toBeNull();
    const closeButton = screen.getByRole("button", { name: "닫기" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(closeButton, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("owns initial focus, traps Tab, and keeps nested modal interaction authoritative", () => {
    const { onClose } = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "ToonSpectrum 전문 3D 제작" });
    const closeButton = screen.getByRole("button", { name: "닫기" });
    const lastControl = screen.getByRole("textbox", { name: "오브젝트 이름" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-studio-modal-owner")).toBe("hybrid-dcc");
    expect(document.activeElement).toBe(closeButton);

    lastControl.focus();
    fireEvent.keyDown(lastControl, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastControl);

    const nestedDialog = document.createElement("div");
    nestedDialog.setAttribute("role", "dialog");
    nestedDialog.setAttribute("aria-modal", "true");
    const nestedButton = document.createElement("button");
    nestedButton.textContent = "중첩 확인";
    nestedDialog.append(nestedButton);
    document.body.append(nestedDialog);
    nestedButton.focus();
    expect(document.activeElement).toBe(nestedButton);
    fireEvent.keyDown(nestedButton, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    nestedDialog.remove();

    fireEvent.keyDown(closeButton, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the route-owned workspace without a visual backdrop and controls its mode", () => {
    const onClose = vi.fn();
    const onWorkbenchModeChange = vi.fn();
    render(
      <StudioHybridDccDialog
        open
        onClose={onClose}
        onWorkbenchModeChange={onWorkbenchModeChange}
        presentation="workspace"
        workbenchMode="cad"
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "ToonSpectrum 전문 3D 제작" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector('[data-studio-modal-backdrop="true"]')).toBeNull();
    expect(document.querySelector('[data-studio-hybrid-dcc-presentation="workspace"]')).not.toBeNull();
    expect(screen.getByTestId("workbench-mode").textContent).toBe("cad");
    const backButton = screen.getByRole("button", { name: "캔버스로 돌아가기" });
    expect(document.activeElement).toBe(backButton);
    fireEvent.click(screen.getByRole("button", { name: "Shot 모드" }));
    expect(onWorkbenchModeChange).toHaveBeenCalledWith("shot");
    fireEvent.click(backButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("isolates background state, keeps the backdrop pointer-only, and restores the launcher", () => {
    const launcher = document.createElement("button");
    launcher.textContent = "3D Workbench 열기";
    launcher.setAttribute("aria-hidden", "false");
    document.body.append(launcher);
    launcher.focus();
    document.body.style.overflow = "clip";
    document.documentElement.style.overflow = "auto";

    const { onClose, view } = renderDialog();
    const backdrop = document.querySelector<HTMLButtonElement>(
      '[data-studio-modal-backdrop="true"]',
    );
    expect(backdrop).not.toBeNull();

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(launcher.hasAttribute("inert")).toBe(true);
    expect(launcher.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.hasAttribute("inert")).toBe(true);
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.tabIndex).toBe(-1);
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(
      <StudioHybridDccDialog
        open={false}
        onClose={onClose}
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    );

    expect(document.body.style.overflow).toBe("clip");
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(launcher.hasAttribute("inert")).toBe(false);
    expect(launcher.getAttribute("aria-hidden")).toBe("false");
    expect(view.container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(launcher);
    launcher.remove();
  });

  it("falls back to the Studio landmark when a route launcher disappears before mount", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.append(main);
    const removedLauncher = document.createElement("button");
    removedLauncher.textContent = "사라지는 메뉴 항목";
    document.body.append(removedLauncher);
    removedLauncher.focus();
    removedLauncher.remove();
    const view = render(
      <StudioHybridDccDialog
        open
        onClose={vi.fn()}
        returnFocus={removedLauncher}
        presentation="workspace"
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    );

    view.rerender(
      <StudioHybridDccDialog
        open={false}
        onClose={vi.fn()}
        returnFocus={removedLauncher}
        presentation="workspace"
        workspaceDocumentId="work-1:page-1"
        onWorkspaceChange={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(main);
    main.remove();
  });
});
