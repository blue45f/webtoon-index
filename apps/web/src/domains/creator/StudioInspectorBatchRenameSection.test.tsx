// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auditStudioInspectorDensity } from "./studio-inspector-dom-density";
import { StudioInspectorBatchRenameSection } from "./StudioInspectorBatchRenameSection";

import type { El, ImageEl } from "./studio-element-model";

function image(id: string, name: string, y: number, locked = false): ImageEl {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 0,
    y,
    width: 40,
    height: 20,
    rotation: 0,
    name,
    locked,
  } as ImageEl;
}

afterEach(cleanup);

describe("StudioInspectorBatchRenameSection", () => {
  it("exposes a real Inspector disclosure contract and expands on demand", () => {
    const { container } = render(
      <StudioInspectorBatchRenameSection
        elements={[image("a", "A", 0), image("b", "B", 20)]}
        selectedIds={["a", "b"]}
        groups={[]}
        commit={vi.fn(() => true)}
        announce={vi.fn()}
      />,
    );
    const section = container.querySelector('[data-inspector-section="selection.batch-rename"]');
    const toggle = screen.getByRole("button", { name: /^일괄 이름 변경/u });

    expect(section?.getAttribute("data-inspector-section-open")).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(section?.getAttribute("data-inspector-section-open")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("이름 형식")).toBeTruthy();
  });

  it("previews layer order and commits the complete rename exactly once", () => {
    const commit = vi.fn((_next: El[]) => true);
    const announce = vi.fn();
    render(
      <StudioInspectorBatchRenameSection
        elements={[image("bottom", "배경", 100), image("top", "효과", 0)]}
        selectedIds={["bottom", "top"]}
        groups={[]}
        commit={commit}
        announce={announce}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^일괄 이름 변경/u }));
    expect(screen.getByText("효과")).toBeTruthy();
    expect(screen.getByText("이미지 01")).toBeTruthy();
    expect(screen.getByText("배경")).toBeTruthy();
    expect(screen.getByText("이미지 02")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "2개 이름 적용" }));
    expect(commit).toHaveBeenCalledTimes(1);
    const next = commit.mock.calls[0]![0];
    expect(next.map((element) => [element.id, element.name])).toEqual([
      ["bottom", "이미지 02"],
      ["top", "이미지 01"],
    ]);
    expect(announce).toHaveBeenCalledWith("2개 레이어 이름 변경");
    expect(screen.getByText("2개 레이어 이름 변경 완료")).toBeTruthy();
  });

  it("switches to replacement mode and exposes a case-sensitive option", () => {
    const commit = vi.fn(() => true);
    render(
      <StudioInspectorBatchRenameSection
        elements={[image("a", "Panel A", 0), image("b", "panel B", 20)]}
        selectedIds={["a", "b"]}
        groups={[]}
        commit={commit}
        announce={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^일괄 이름 변경/u }));
    fireEvent.click(screen.getByRole("button", { name: "찾기·바꾸기" }));
    fireEvent.change(screen.getByLabelText("찾을 문자열"), { target: { value: "panel" } });
    fireEvent.change(screen.getByLabelText("바꿀 문자열"), { target: { value: "컷" } });

    expect(screen.getByText("컷 A")).toBeTruthy();
    expect(screen.getByText("컷 B")).toBeTruthy();
    expect((screen.getByLabelText("대소문자 구분") as HTMLInputElement).checked).toBe(false);
  });

  it("fails closed for a locked member and explains why", () => {
    render(
      <StudioInspectorBatchRenameSection
        elements={[image("a", "A", 0), image("b", "B", 20, true)]}
        selectedIds={["a", "b"]}
        groups={[]}
        commit={vi.fn(() => true)}
        announce={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^일괄 이름 변경/u }));
    const apply = screen.getByRole("button", { name: "2개 이름 적용" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText(/잠긴 레이어가 포함/u)).toBeTruthy();
  });

  it("classifies every interactive control and keeps identities unique", () => {
    const { container } = render(
      <StudioInspectorBatchRenameSection
        elements={[image("a", "A", 0), image("b", "B", 20)]}
        selectedIds={["a", "b"]}
        groups={[]}
        commit={vi.fn(() => true)}
        announce={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^일괄 이름 변경/u }));
    const audit = auditStudioInspectorDensity(container);
    const ids = [...container.querySelectorAll("[data-inspector-control-id]")].map((element) =>
      element.getAttribute("data-inspector-control-id"),
    );

    expect(audit.count.unclassified).toBe(0);
    expect(audit.violations).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
