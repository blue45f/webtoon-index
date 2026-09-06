// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAnimaticTimelineDialog } from "./StudioAnimaticTimelineDialog";

beforeEach(() => {
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1_200,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 900,
  });
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  window.sessionStorage.clear();
});

const PAGES = [
  {
    id: "page-1",
    name: "오프닝",
    canvasH: 1_200,
    elements: [
      {
        id: "frame-1",
        type: "frame",
        x: 0,
        y: 0,
        width: 720,
        height: 500,
      },
    ],
  },
] as const;

describe("StudioAnimaticTimelineDialog", () => {
  it("keeps the local animatic out of the DOM until explicitly opened", () => {
    render(
      <StudioAnimaticTimelineDialog
        open={false}
        isMobile={false}
        workScope="work-a"
        pages={PAGES}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "웹툰 애니매틱" })).toBeNull();
  });

  it("opens desktop as a persistent movable and bottom-dockable panel", () => {
    const onClose = vi.fn();
    render(
      <StudioAnimaticTimelineDialog
        open
        isMobile={false}
        workScope="work-a"
        pages={PAGES}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "웹툰 애니매틱" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("data-studio-floating-surface")).toBe("true");
    expect(dialog.getAttribute("data-studio-animatic-dialog")).toBe("true");
    expect(dialog.getAttribute("data-studio-animatic-presentation")).toBe("desktop");
    expect(dialog.getAttribute("data-dock-edge")).toBe("bottom");
    expect(screen.getByRole("region", {
      name: "웹툰 애니매틱 타임라인",
    })).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "웹툰 애니매틱 이동",
    })).toBeTruthy();
    expect(screen.queryByRole("button", {
      name: "애니매틱 배경 닫기",
    })).toBeNull();
    expect(document.body.style.overflow).toBe("");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retains the bounded modal sheet and backdrop dismissal on mobile", () => {
    const onClose = vi.fn();
    render(
      <StudioAnimaticTimelineDialog
        open
        isMobile
        workScope="work-a"
        pages={PAGES}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "웹툰 애니매틱" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-studio-floating-surface")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("region", {
      name: "웹툰 애니매틱 타임라인",
    }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {
      name: "애니매틱 배경 닫기",
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
