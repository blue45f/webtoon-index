// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createStudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import { StudioInspectorEmptyCoachSection } from "./StudioInspectorEmptyCoachSection";
import { StudioInspectorUnselectedImageTools } from "./StudioInspectorUnselectedImageTools";

import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";

const TAB_A11Y = createStudioInspectorTabA11y("entry-focus");

afterEach(cleanup);

function EntryFocusHarness() {
  const [imageToolsVisible, setImageToolsVisible] = useState(false);
  const inspectorLayout = {
    primary: "properties",
    document: "canvas",
    image: "quick",
  } as const;
  const model = {
    activateCanvasTool: () => undefined,
    announceDrawingShortcut: () => undefined,
    changeInspectorLayout: () => undefined,
    disarmAllPixelTools: () => undefined,
    inspectorContentMode: "empty",
    inspectorLayout,
    openFeatureTutorial: () => undefined,
    setUnselectedImageToolsVisible: setImageToolsVisible,
    setEyedropperActive: () => undefined,
    setTool: () => undefined,
    unselectedImageToolsVisible: imageToolsVisible,
    imageInspectorRouteWithoutImageSelection: imageToolsVisible,
    activeImageInspectorTab: "quick",
    shouldMountImageInspectorTab: () => false,
  } as unknown as StudioInspectorAsideModel;

  return (
    <>
      <StudioInspectorEmptyCoachSection model={model} />
      <StudioInspectorUnselectedImageTools model={model} tabA11y={TAB_A11Y} />
    </>
  );
}

describe("Studio inspector entry focus", () => {
  it("moves focus into image preparation and restores it to the returning entry", async () => {
    render(<EntryFocusHarness />);

    const imageEntry = screen.getByRole("button", {
      name: "이미지 편집 · 전문 도구 열기",
    });
    imageEntry.focus();
    fireEvent.click(imageEntry);

    const preparationHeading = screen.getByText("이미지 편집 대상 준비");
    await waitFor(() => {
      expect(document.activeElement).toBe(preparationHeading);
    });

    fireEvent.click(screen.getByRole("button", { name: "시작 안내" }));

    const restoredEntry = screen.getByRole("button", {
      name: "이미지 편집 · 전문 도구 열기",
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(restoredEntry);
    });
  });
});
