// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAGE_GRADE } from "./studio-page-grade";
import {
  StudioInspectorDrawColorControls,
  StudioInspectorPageGradeSurface,
  StudioInspectorPublishPanel,
} from "./StudioInspectorUtilityPanels";

afterEach(() => cleanup());

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StudioInspectorPublishPanel>> = {},
) {
  const props: React.ComponentProps<typeof StudioInspectorPublishPanel> = {
    active: true,
    autoFocusTitle: false,
    description: "",
    pendingSaveIntent: "draft",
    readOnly: false,
    saving: false,
    tags: "",
    title: "",
    titleInputRef: createRef<HTMLInputElement>(),
    onContinuePendingSave: vi.fn(),
    onDescriptionChange: vi.fn(),
    onTagsChange: vi.fn(),
    onTitleChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<StudioInspectorPublishPanel {...props} />) };
}

describe("StudioInspectorPublishPanel", () => {
  it("exposes neutral, visible, API-aligned metadata labels and limits", () => {
    renderPanel();

    expect(screen.getByRole("tabpanel", { name: "작품 정보" })).not.toBeNull();
    const title = screen.getByRole("textbox", { name: "작품 제목 (필수)" });
    const description = screen.getByRole("textbox", { name: "게시용 설명" });
    const tags = screen.getByRole("textbox", { name: "게시용 태그" });

    expect(title.hasAttribute("required")).toBe(true);
    expect(title.getAttribute("aria-required")).toBe("true");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("maxlength")).toBe("120");
    expect(description.getAttribute("maxlength")).toBe("2000");
    expect(title.getAttribute("aria-describedby")).toBeTruthy();
    expect(description.getAttribute("aria-describedby")).toBeTruthy();
    expect(tags.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("게시용 정보 (선택)")).not.toBeNull();
    expect(screen.getByText(/최대 8개 · 태그당 24자/u)).not.toBeNull();
  });

  it("continues the exact pending draft or publish intent from the metadata form", () => {
    const continueDraft = vi.fn();
    const { rerender, props } = renderPanel({
      title: "1화",
      onContinuePendingSave: continueDraft,
    });

    fireEvent.submit(screen.getByRole("tabpanel", { name: "작품 정보" }));
    expect(continueDraft).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "초안 저장 계속" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    rerender(
      <StudioInspectorPublishPanel
        {...props}
        pendingSaveIntent="published"
        onContinuePendingSave={continueDraft}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "게시 계속" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("focuses the required title when the mobile metadata sheet becomes active", () => {
    const { rerender, props } = renderPanel();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    rerender(
      <StudioInspectorPublishPanel
        {...props}
        autoFocusTitle
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "작품 제목 (필수)" }),
    );
  });

  it("keeps an invalid tag list visible and blocks accidental continuation", () => {
    const continueSave = vi.fn();
    renderPanel({
      title: "1화",
      tags: "1 2 3 4 5 6 7 8 9",
      onContinuePendingSave: continueSave,
    });

    expect(
      screen.getByRole("textbox", { name: "게시용 태그" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText(/9개 입력됨 · 최대 8개/u)).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "초안 저장 계속" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByRole("tabpanel", { name: "작품 정보" }));
    expect(continueSave).not.toHaveBeenCalled();
  });

  it("surfaces imported title and description values that already exceed input limits", () => {
    renderPanel({
      title: "a".repeat(121),
      description: "a".repeat(2_001),
    });

    expect(
      screen.getByRole("textbox", { name: "작품 제목 (필수)" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByRole("textbox", { name: "게시용 설명" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText(/121\/120자 · 120자 이하/u)).not.toBeNull();
    expect(screen.getByText(/2,001\/2,000자 · 입력 제한 이하/u)).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "초안 저장 계속" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps every metadata field and the pending action read-only for a viewer", () => {
    renderPanel({ readOnly: true, title: "열람 전용 작품" });

    expect(
      (screen.getByRole("textbox", { name: "작품 제목 (필수)" }) as HTMLInputElement).readOnly,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "게시용 설명" }) as HTMLTextAreaElement).readOnly,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "게시용 태그" }) as HTMLInputElement).readOnly,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "초안 저장 계속" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("StudioInspectorPageGradeSurface", () => {
  it("keeps aria-expanded and aria-controls complete in both disclosure directions", () => {
    const onExpandedChange = vi.fn();
    const baseProps: React.ComponentProps<typeof StudioInspectorPageGradeSurface> = {
      active: true,
      expanded: false,
      grade: DEFAULT_PAGE_GRADE,
      gradeActive: false,
      gate: { disabled: false },
      onApplyPreset: vi.fn(),
      onExpandedChange,
      onPatch: vi.fn(),
      onReset: vi.fn(),
    };
    const view = render(<StudioInspectorPageGradeSurface {...baseProps} />);

    const collapsed = screen.getByRole("button", { name: /페이지 색보정/u });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
    const contentId = collapsed.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    expect((document.getElementById(contentId!) as HTMLElement).hidden).toBe(true);
    fireEvent.click(collapsed);
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    view.rerender(
      <StudioInspectorPageGradeSurface {...baseProps} expanded />,
    );
    const expanded = screen.getByRole("button", { name: "접기" });
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    expect(expanded.getAttribute("aria-controls")).toBe(contentId);
    expect((document.getElementById(contentId!) as HTMLElement).hidden).toBe(false);
    fireEvent.click(expanded);
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("renders StudioInspectorDrawColorControls and toggles intermediate color palette", () => {
    const onColorChange = vi.fn();
    render(
      <StudioInspectorDrawColorControls
        color="#fcd5b5"
        eyedropperActive={false}
        onColorChange={onColorChange}
        onEyedropperToggle={vi.fn()}
      />,
    );

    const toggleBtn = screen.getByRole("button", { name: "중간색 (CSP)" });
    expect(screen.queryByText("중간색 (Intermediate Color)")).toBeNull();

    fireEvent.click(toggleBtn);
    expect(screen.getByText("중간색 (Intermediate Color)")).toBeDefined();
  });

  it("toggles approximate and history color palettes from StudioInspectorDrawColorControls", () => {
    render(
      <StudioInspectorDrawColorControls
        color="#fcd5b5"
        eyedropperActive={false}
        onColorChange={vi.fn()}
        onEyedropperToggle={vi.fn()}
      />,
    );

    const approxBtn = screen.getByRole("button", { name: "근사색 (CSP)" });
    expect(screen.queryByText("근사색 (Approximate Color)")).toBeNull();

    fireEvent.click(approxBtn);
    expect(screen.getByText("근사색 (Approximate Color)")).toBeDefined();

    const historyBtn = screen.getByRole("button", { name: "히스토리 (CSP)" });
    fireEvent.click(historyBtn);
    expect(screen.getByText("컬러 히스토리 (Color History)")).toBeDefined();
  });
});
