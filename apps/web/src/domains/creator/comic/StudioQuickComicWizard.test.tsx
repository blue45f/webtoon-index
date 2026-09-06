// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQuickComicDraft } from "./studio-quick-comic-plan";
import { StudioQuickComicWizard } from "./StudioQuickComicWizard";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioQuickComicWizard", () => {
  it("opens one honest four-step dialog with scroll and mobile touch contracts", () => {
    render(<StudioQuickComicWizard onApply={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("data-studio-modal-owner")).toBe(
      "quick-comic"
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("1/4 · 컷 레이아웃")).toBeTruthy();
    expect(screen.getByText(/캐릭터 생성은/u)).toBeTruthy();
    expect(
      document.querySelector("[data-studio-quick-comic-scroll-body='true']")?.className
    ).toContain("overflow-y-auto");
    expect(screen.getByRole("button", { name: "이전" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "다음" }).className).toContain("min-h-11");
    expect(
      screen.getByRole("button", { name: "빠른 웹툰 조립 취소" }).className
    ).toContain("size-11");
  });

  it("walks through layout, no-scene, dialogue and applies one normalized assembly input", () => {
    const onApply = vi.fn();
    render(<StudioQuickComicWizard onApply={onApply} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(
      (screen.getByRole("radio", { name: /장면 없음/u }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText(/캐릭터나 3D 배경을 자동 생성하지 않습니다/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(screen.getByRole("textbox", { name: "웹툰 대사" }), {
      target: { value: "  민수: 안녕\n지영: 반가워  " },
    });
    expect(screen.getByText("인식된 대사").parentElement?.textContent).toContain("2개");

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("4/4 · 미리보기")).toBeTruthy();
    expect(screen.getByText("없음")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "페이지 적용" }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith({
      layoutId: createQuickComicDraft().layoutId,
      dialogueScript: "민수: 안녕\n지영: 반가워",
    });
  });

  it("selects a shipped scene and a real target frame without inventing a character builder", () => {
    const onApply = vi.fn();
    render(<StudioQuickComicWizard onApply={onApply} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("radio", { name: /고백 장면/u }));
    fireEvent.change(screen.getByRole("combobox", { name: "장면을 넣을 컷" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "페이지 적용" }));

    expect(onApply).toHaveBeenCalledWith({
      layoutId: createQuickComicDraft().layoutId,
      sceneTemplateId: "confession",
      sceneFrameIndex: 1,
    });
    expect(screen.queryByText(/캐릭터 빌더/u)).toBeNull();
  });

  it("supports Escape, Alt-arrow movement and traps Tab inside the sole dialog", () => {
    const onCancel = vi.fn();
    render(<StudioQuickComicWizard onApply={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "ArrowRight", altKey: true });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    fireEvent.keyDown(document, { key: "ArrowLeft", altKey: true });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");

    const next = screen.getByRole("button", { name: "다음" });
    next.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "빠른 웹툰 조립 취소" })
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("locks background interaction and restores focus and scrolling when unmounted", () => {
    const opener = document.createElement("button");
    opener.textContent = "열기";
    document.body.append(opener);
    opener.focus();
    const view = render(<StudioQuickComicWizard onApply={vi.fn()} onCancel={vi.fn()} />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(view.container.inert).toBe(true);
    view.unmount();

    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
