// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPOSITE_PRESETS } from "../studio-background-3d-composites";
import {
  BG_SCENE_TEMPLATE_CATEGORIES,
  BG_SCENE_TEMPLATE_CATEGORY_LABELS,
  BG_SCENE_TEMPLATES,
} from "../studio-background-3d-scene-templates";

import { StudioBg3dSceneTemplatePanel } from "./StudioBg3dSceneTemplatePanel";

import type {
  StudioBg3dSceneTemplatePanelProps,
  StudioBg3dTemplateInstanceSummary,
} from "./StudioBg3dSceneTemplatePanel";

afterEach(cleanup);

function summary(
  id: string,
  patch: Partial<StudioBg3dTemplateInstanceSummary> = {},
): StudioBg3dTemplateInstanceSummary {
  return {
    id,
    label: `템플릿 ${id}`,
    sourceKind: "catalog",
    nodeCount: 4,
    lockedNodeCount: 0,
    selected: false,
    resetAvailable: true,
    sourceAvailable: true,
    ...patch,
  };
}

function defaultProps(): StudioBg3dSceneTemplatePanelProps {
  return {
    templates: BG_SCENE_TEMPLATES,
    templateCategories: BG_SCENE_TEMPLATE_CATEGORIES,
    templateCategoryLabels: BG_SCENE_TEMPLATE_CATEGORY_LABELS,
    compositePresets: COMPOSITE_PRESETS,
    activeCategory: null,
    onCategoryChange: vi.fn(),
    onAddTemplate: vi.fn(),
    templateInstances: [],
    organizationDisabledReason: null,
    onSelectTemplateInstance: vi.fn(),
    onSelectAllTemplateInstances: vi.fn(),
    onGroundTemplateInstance: vi.fn(),
    onArrangeAllTemplateInstances: vi.fn(),
    onResetTemplateInstance: vi.fn(),
    onResetAllTemplateInstances: vi.fn(),
    onDeleteTemplateInstance: vi.fn(),
    onDeleteAllTemplateInstances: vi.fn(),
  };
}

function renderPanel(overrides: Partial<StudioBg3dSceneTemplatePanelProps> = {}) {
  const props = { ...defaultProps(), ...overrides };
  return { props, ...render(<StudioBg3dSceneTemplatePanel {...props} />) };
}

describe("StudioBg3dSceneTemplatePanel organizer", () => {
  it("explains the provenance boundary when no tagged template instance exists", () => {
    renderPanel();

    expect(screen.getByText("추가된 템플릿 정리")).toBeTruthy();
    expect(screen.getByText("0개 묶음")).toBeTruthy();
    expect(screen.getByText(/새 씬 템플릿이나 내 템플릿을 추가하면/u)).toBeTruthy();
  });

  it("selects, grounds, and resets one complete template instance", () => {
    const view = renderPanel({
      templateInstances: [summary("one", { selected: true })],
    });
    const organizer = screen.getByLabelText("추가된 템플릿 묶음");

    fireEvent.click(within(organizer).getByRole("button", { name: "묶음 선택" }));
    fireEvent.click(within(organizer).getByRole("button", { name: "바닥 접지" }));
    fireEvent.click(within(organizer).getByRole("button", { name: "원래 배치" }));

    expect(view.props.onSelectTemplateInstance).toHaveBeenCalledWith("one");
    expect(view.props.onGroundTemplateInstance).toHaveBeenCalledWith("one");
    expect(view.props.onResetTemplateInstance).toHaveBeenCalledWith("one");
    expect(screen.getByText("묶음 선택됨")).toBeTruthy();
  });

  it("runs all-instance selection, spacing, and reset commands", () => {
    const view = renderPanel({
      templateInstances: [summary("one"), summary("two", { sourceKind: "user" })],
    });
    const allActions = screen.getByRole("group", { name: "모든 템플릿 정리" });

    fireEvent.click(within(allActions).getByRole("button", { name: "전체 선택" }));
    fireEvent.click(within(allActions).getByRole("button", { name: "바닥 · 간격 정돈" }));
    fireEvent.click(within(allActions).getByRole("button", { name: "전체 원래 배치" }));

    expect(view.props.onSelectAllTemplateInstances).toHaveBeenCalledOnce();
    expect(view.props.onArrangeAllTemplateInstances).toHaveBeenCalledOnce();
    expect(view.props.onResetAllTemplateInstances).toHaveBeenCalledOnce();
    expect(screen.getByText("내 템플릿 · 오브젝트 4개")).toBeTruthy();
  });

  it("requires a second explicit click before deleting one or every instance", () => {
    const view = renderPanel({ templateInstances: [summary("one")] });
    const organizer = screen.getByLabelText("추가된 템플릿 묶음");

    fireEvent.click(within(organizer).getByRole("button", { name: "묶음 삭제" }));
    expect(view.props.onDeleteTemplateInstance).not.toHaveBeenCalled();
    fireEvent.click(within(organizer).getByRole("button", { name: "묶음 삭제 확인" }));
    expect(view.props.onDeleteTemplateInstance).toHaveBeenCalledWith("one");

    const allActions = screen.getByRole("group", { name: "모든 템플릿 정리" });
    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제" }));
    expect(view.props.onDeleteAllTemplateInstances).not.toHaveBeenCalled();
    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제 확인" }));
    expect(view.props.onDeleteAllTemplateInstances).toHaveBeenCalledOnce();
  });

  it("requires a fresh delete-all confirmation when template membership changes", () => {
    const view = renderPanel({ templateInstances: [summary("one")] });
    let allActions = screen.getByRole("group", { name: "모든 템플릿 정리" });

    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제" }));
    expect(within(allActions).getByRole("button", { name: "전체 삭제 확인" })).toBeTruthy();

    view.rerender(
      <StudioBg3dSceneTemplatePanel
        {...view.props}
        templateInstances={[summary("one"), summary("two")]}
      />,
    );
    allActions = screen.getByRole("group", { name: "모든 템플릿 정리" });
    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제" }));
    expect(view.props.onDeleteAllTemplateInstances).not.toHaveBeenCalled();
    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제 확인" }));
    expect(view.props.onDeleteAllTemplateInstances).toHaveBeenCalledOnce();
  });

  it("does not carry delete-all confirmation through an empty instance set", () => {
    const view = renderPanel({ templateInstances: [summary("one")] });
    const allActions = screen.getByRole("group", { name: "모든 템플릿 정리" });

    fireEvent.click(within(allActions).getByRole("button", { name: "전체 삭제" }));
    view.rerender(
      <StudioBg3dSceneTemplatePanel {...view.props} templateInstances={[]} />,
    );
    view.rerender(
      <StudioBg3dSceneTemplatePanel
        {...view.props}
        templateInstances={[summary("later")]}
      />,
    );

    const laterActions = screen.getByRole("group", { name: "모든 템플릿 정리" });
    fireEvent.click(within(laterActions).getByRole("button", { name: "전체 삭제" }));
    expect(view.props.onDeleteAllTemplateInstances).not.toHaveBeenCalled();
    expect(within(laterActions).getByRole("button", { name: "전체 삭제 확인" })).toBeTruthy();
  });

  it("disables mutations while another editor operation owns the scene", () => {
    renderPanel({
      templateInstances: [summary("one")],
      organizationDisabledReason: "장면 작업이 끝난 뒤 정리해 주세요.",
    });

    expect(screen.getByRole("status").textContent).toContain("장면 작업이 끝난 뒤");
    for (const button of [
      screen.getByRole("button", { name: "전체 선택" }),
      screen.getByRole("button", { name: "바닥 · 간격 정돈" }),
      screen.getByRole("button", { name: "묶음 선택" }),
      screen.getByRole("button", { name: "바닥 접지" }),
    ]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("explains why reset is unavailable for missing sources or locked nodes", () => {
    renderPanel({
      templateInstances: [
        summary("missing", { sourceAvailable: false, resetAvailable: false }),
        summary("locked", { lockedNodeCount: 2, resetAvailable: false }),
      ],
    });
    const organizer = screen.getByLabelText("추가된 템플릿 묶음");
    const resetButtons = within(organizer).getAllByRole("button", { name: "원래 배치" });

    expect((resetButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect(resetButtons[0]?.getAttribute("title")).toContain("원본을 찾을 수 없어");
    expect((resetButtons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(resetButtons[1]?.getAttribute("title")).toContain("잠긴 객체 2개");
    const arrangeAll = screen.getByRole("button", { name: "바닥 · 간격 정돈" });
    expect((arrangeAll as HTMLButtonElement).disabled).toBe(true);
    expect(arrangeAll.getAttribute("title")).toContain("잠긴 템플릿 객체");
  });
});
