// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioMainMenu } from "./StudioMainMenu";
import { StudioToolHintPreferencesProvider } from "./StudioToolHint";

import type { StudioMainMenuGroup } from "./studio-main-menu-model";

import { useI18n } from "@/shared/lib/i18n";

const GROUPS: readonly StudioMainMenuGroup[] = [
  {
    id: "file",
    label: "파일",
    items: [{ id: "save", label: "초안 저장", onSelect: vi.fn() }],
  },
  {
    id: "edit",
    label: "편집",
    items: [{ id: "undo", label: "실행취소", onSelect: vi.fn() }],
  },
  {
    id: "filter",
    label: "필터",
    items: [{ id: "blur", label: "가우시안 블러", onSelect: vi.fn() }],
  },
];

beforeEach(() => {
  useI18n.getState().setLang("ko");
});

function renderMenu() {
  return render(
    <StudioToolHintPreferencesProvider
      mode="compact"
      touchHoldDelayMs={640}
      reduceMotion
    >
      <StudioMainMenu groups={GROUPS} />
    </StudioToolHintPreferencesProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("StudioMainMenu tooltips", () => {
  it("uses an English Help fallback when a locale pack has not shipped the new hint keys yet", () => {
    useI18n.getState().setLang("en");
    render(
      <StudioToolHintPreferencesProvider mode="compact" touchHoldDelayMs={640} reduceMotion>
        <StudioMainMenu
          groups={[
            {
              id: "help",
              label: "Help",
              items: [{ id: "shortcuts", label: "Shortcut help", onSelect: vi.fn() }],
            },
          ]}
        />
      </StudioToolHintPreferencesProvider>,
    );

    fireEvent.focus(screen.getByRole("menuitem", { name: "Help" }));
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Find step-by-step feature guides",
    );
    expect(screen.getByRole("tooltip").textContent).not.toContain("기능 사용법");
  });

  it("describes keyboard-focused top menus and keeps only the latest hint visible", () => {
    renderMenu();
    const file = screen.getByRole("menuitem", { name: "파일" });
    const edit = screen.getByRole("menuitem", { name: "편집" });

    fireEvent.focus(file);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toContain("원고를 저장·가져오기");
    expect(file.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.blur(file, { relatedTarget: edit });
    fireEvent.focus(edit, { relatedTarget: file });
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toContain("실행취소, 클립보드");
    expect(document.body.textContent).not.toContain("원고를 저장·가져오기");
  });

  it("honors the hover-intent delay and Escape dismissal contract", () => {
    vi.useFakeTimers();
    renderMenu();
    const filter = screen.getByRole("menuitem", { name: "필터" });

    fireEvent.mouseEnter(filter);
    act(() => vi.advanceTimersByTime(279));
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip").textContent).toContain("블러, 색조·채도·밝기");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not interrupt a normal touch tap with a transient tooltip", () => {
    vi.useFakeTimers();
    renderMenu();
    const file = screen.getByRole("menuitem", { name: "파일" });
    expect(file.className).toContain("pointer-coarse:h-11");

    fireEvent.pointerDown(file, { button: 0, pointerType: "touch", clientX: 12, clientY: 8 });
    act(() => vi.advanceTimersByTime(320));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerUp(file, { pointerType: "touch", clientX: 12, clientY: 8 });
    fireEvent.click(file);

    expect(screen.getByRole("menu", { name: "파일" })).not.toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "편집" }));
    act(() => vi.advanceTimersByTime(280));
    expect(screen.getByRole("menu", { name: "편집" })).not.toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("moves across top-level menus with ArrowLeft and ArrowRight, including open menus", () => {
    renderMenu();
    const file = screen.getByRole("menuitem", { name: "파일" });
    const edit = screen.getByRole("menuitem", { name: "편집" });
    const filter = screen.getByRole("menuitem", { name: "필터" });

    fireEvent.focus(file);
    fireEvent.keyDown(file, { key: "ArrowRight" });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(edit, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(file);
    fireEvent.keyDown(file, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(filter);

    fireEvent.click(file);
    const save = screen.getByRole("menuitem", { name: "초안 저장" });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: "ArrowRight" });

    expect(screen.queryByRole("menu", { name: "파일" })).toBeNull();
    expect(screen.getByRole("menu", { name: "편집" })).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "실행취소" })
    );
  });

  it("exposes exclusive color-vision choices as radio menuitems with exact coaches", () => {
    render(
      <StudioToolHintPreferencesProvider
        mode="compact"
        touchHoldDelayMs={640}
        reduceMotion
      >
        <StudioMainMenu
          groups={[
            {
              id: "view",
              label: "보기",
              items: [
                {
                  id: "color-original",
                  label: "색각 검수 · 원본",
                  checked: false,
                  selectionRole: "radio",
                  hintKey: "color-vision:none",
                  onSelect: vi.fn(),
                },
                {
                  id: "color-grayscale",
                  label: "색각 검수 · 흑백 명암",
                  checked: true,
                  selectionRole: "radio",
                  hintKey: "color-vision:grayscale",
                  disabled: true,
                  unavailableReason: "보기 변환이 잠겨 있습니다.",
                  onSelect: vi.fn(),
                },
              ],
            },
          ]}
        />
      </StudioToolHintPreferencesProvider>
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "보기" }));
    const choices = screen.getAllByRole("menuitemradio");
    expect(choices).toHaveLength(2);
    expect(choices[0]?.getAttribute("aria-checked")).toBe("false");
    expect(choices[1]?.getAttribute("aria-checked")).toBe("true");
    expect(choices[1]?.getAttribute("aria-disabled")).toBe("true");
    expect(choices[1]?.hasAttribute("disabled")).toBe(false);
    expect(choices[1]?.closest('[data-studio-tool-hint-target="true"]')).not.toBeNull();

    fireEvent.focus(choices[1]!);
    expect(screen.getByRole("tooltip").textContent).toContain("명암 대비");
    expect(screen.getByRole("tooltip").textContent).toContain("보기 변환이 잠겨 있습니다.");
  });

  it("keeps every disabled filter reason available to hover, focus, and assistive tech", () => {
    vi.useFakeTimers();
    const unavailableReason = "마스터 편집 중에는 페이지 필터를 적용할 수 없습니다.";
    render(
      <StudioToolHintPreferencesProvider
        mode="compact"
        touchHoldDelayMs={640}
        reduceMotion
      >
        <StudioMainMenu
          groups={[
            {
              id: "filter",
              label: "필터",
              items: [
                ["gaussian-blur", "가우시안 블러"],
                ["motion-blur", "모션 블러"],
                ["hue-saturation-brightness", "색조 / 채도 / 밝기"],
                ["brightness-contrast", "명도 / 대비"],
                ["color-curves", "색상 커브"],
              ].map(([id, label]) => ({
                id: id!,
                label: label!,
                disabled: true,
                unavailableReason,
                onSelect: vi.fn(),
              })),
            },
          ]}
        />
      </StudioToolHintPreferencesProvider>
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "필터" }));
    // The menubar trigger is a `menuitem` too now, so scope the count to the open panel.
    const filters = within(screen.getByRole("menu", { name: "필터" })).getAllByRole("menuitem");
    expect(filters).toHaveLength(5);

    for (const filter of filters) {
      expect(filter.getAttribute("aria-disabled")).toBe("true");
      expect((filter as HTMLButtonElement).disabled).toBe(false);
      const describedBy = filter.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(
        describedBy
          ?.split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      ).toContain(unavailableReason);

      fireEvent.focus(filter);
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(screen.getByRole("tooltip").textContent).toContain(unavailableReason);
    }

    fireEvent.blur(filters.at(-1)!, { relatedTarget: null });
    fireEvent.mouseLeave(filters.at(-1)!, { clientX: 999, clientY: 999 });
    act(() => vi.advanceTimersByTime(280));
    for (let reveal = 0; reveal < 3; reveal += 1) {
      fireEvent.mouseEnter(filters[0]!);
      act(() => vi.advanceTimersByTime(280));
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(screen.getByRole("tooltip").textContent).toContain(unavailableReason);
      fireEvent.mouseLeave(filters[0]!, { clientX: 999, clientY: 999 });
      act(() => vi.advanceTimersByTime(280));
      expect(screen.queryByRole("tooltip")).toBeNull();
    }
  });
});
