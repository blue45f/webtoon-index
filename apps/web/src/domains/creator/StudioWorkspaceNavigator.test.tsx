// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioWorkspaceNavigator } from "./StudioWorkspaceNavigator";

function WorkspaceFixture({ modal = false }: { modal?: boolean }) {
  return (
    <div id="studio-app-shell" data-studio-editor="true">
      <StudioWorkspaceNavigator />
      <header id="studio-menubar" tabIndex={-1}>메뉴</header>
      <div id="studio-tool-belt" tabIndex={-1}>옵션</div>
      <div id="studio-tool-rail" tabIndex={-1}>도구</div>
      <main id="studio-canvas-workspace" tabIndex={-1}>캔버스</main>
      <aside id="studio-inspector" tabIndex={-1}>패널</aside>
      <footer id="studio-status-bar" tabIndex={-1}>상태</footer>
      {modal ? (
        <div role="dialog" aria-modal="true" tabIndex={-1}>모달</div>
      ) : null}
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StudioWorkspaceNavigator", () => {
  it("cycles visible Studio regions with F6 and Shift+F6", () => {
    render(<WorkspaceFixture />);

    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("studio-menubar");

    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("studio-tool-belt");

    fireEvent.keyDown(document, { key: "F6", shiftKey: true });
    expect(document.activeElement?.id).toBe("studio-menubar");
    expect(screen.getByRole("status").textContent).toContain("문서 메뉴");
  });

  it("does not escape an open modal", () => {
    render(<WorkspaceFixture modal />);
    const modal = screen.getByRole("dialog");
    modal.focus();

    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement).toBe(modal);
  });

  it("offers direct skip controls and records keyboard modality", () => {
    render(<WorkspaceFixture />);
    const canvasSkip = screen.getByRole("button", { name: "캔버스로 이동" });

    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.click(canvasSkip);

    expect(document.activeElement?.id).toBe("studio-canvas-workspace");
    expect(document.getElementById("studio-app-shell")?.dataset.studioInputModality).toBe(
      "keyboard",
    );
    expect(document.getElementById("studio-app-shell")?.dataset.studioActiveZone).toBe(
      "studio-canvas-workspace",
    );
  });
});