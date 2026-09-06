import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_INSPECTOR_LAYOUT,
  STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY,
  filterStudioInspectorActions,
  loadStudioInspectorLayout,
  navigateStudioInspector,
  normalizeStudioInspectorLayout,
  saveStudioInspectorLayout,
  studioInspectorActions,
} from "./studio-inspector-layout";

describe("studio inspector layout", () => {
  it("normalizes every route axis independently", () => {
    expect(
      normalizeStudioInspectorLayout({
        primary: "layers",
        image: "fill",
        document: "navigator",
      })
    ).toEqual({ primary: "layers", image: "fill", document: "navigator" });

    expect(
      normalizeStudioInspectorLayout({
        primary: "unknown",
        image: "nope",
        document: "grade",
      })
    ).toEqual({
      ...DEFAULT_STUDIO_INSPECTOR_LAYOUT,
      document: "grade",
    });
  });

  it("loads, saves and fails closed when workspace storage is unavailable", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    saveStudioInspectorLayout(storage, {
      primary: "document",
      image: "mask",
      document: "grade",
    });
    expect(values.has(STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY)).toBe(true);
    expect(loadStudioInspectorLayout(storage)).toEqual({
      primary: "document",
      image: "mask",
      document: "grade",
    });

    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStudioInspectorLayout(blocked)).toEqual(
      DEFAULT_STUDIO_INSPECTOR_LAYOUT
    );
    expect(() =>
      saveStudioInspectorLayout(blocked, DEFAULT_STUDIO_INSPECTOR_LAYOUT)
    ).not.toThrow();
  });

  it("moves one route without discarding remembered contextual panels", () => {
    const current = {
      primary: "document" as const,
      image: "retouch" as const,
      document: "grade" as const,
    };

    expect(
      navigateStudioInspector(current, {
        primary: "properties",
        image: "fill",
      })
    ).toEqual({ primary: "properties", image: "fill", document: "grade" });
    expect(navigateStudioInspector(current, { primary: "layers" })).toEqual({
      primary: "layers",
      image: "retouch",
      document: "grade",
    });
    expect(
      navigateStudioInspector(
        { primary: "properties", image: "quick", document: "navigator" },
        { primary: "document" },
      ),
    ).toEqual({ primary: "document", image: "quick", document: "navigator" });
  });

  it("exposes image-only professional tools and searches Korean or English aliases", () => {
    const imageActions = studioInspectorActions({
      hasSelection: true,
      selectedType: "image",
      drawing: false,
    });
    const textActions = studioInspectorActions({
      hasSelection: true,
      selectedType: "text",
      drawing: false,
    });
    const drawActions = studioInspectorActions({
      hasSelection: true,
      selectedType: "draw",
      drawing: false,
    });

    expect(imageActions.map((action) => action.id)).toContain("image-fill");
    expect(textActions.map((action) => action.id)).not.toContain("image-fill");
    expect(drawActions.map((action) => action.id)).toContain("image-fill");
    expect(drawActions.map((action) => action.id)).toContain("image-transform");
    expect(drawActions.map((action) => action.id)).toContain("image-mask");
    expect(drawActions.map((action) => action.id)).toContain("image-retouch");
    expect(drawActions).toContainEqual(
      expect.objectContaining({
        id: "selection-layout",
        focusTarget: "selection.geometry",
      }),
    );
    expect(filterStudioInspectorActions(imageActions, "참조 채우기")).toEqual([
      expect.objectContaining({ id: "image-fill" }),
    ]);
    expect(filterStudioInspectorActions(imageActions, "crop warp")).toEqual([
      expect.objectContaining({ id: "image-transform" }),
    ]);
    expect(filterStudioInspectorActions(imageActions, "없는 메뉴")).toEqual([]);
  });

  it("routes leaf-property searches to a focusable inspector target", () => {
    const textActions = studioInspectorActions({
      hasSelection: true,
      selectedType: "text",
      drawing: false,
    });
    const pageActions = studioInspectorActions({
      hasSelection: false,
      selectedType: null,
      drawing: false,
    });

    // 자간·행간은 문단 섹션 한 곳에만 있다(감사 §5.8) — 검색도 그 한 곳으로 안내한다.
    expect(filterStudioInspectorActions(textActions, "자간")).toEqual([
      expect.objectContaining({
        id: "text-align",
        focusTarget: "element.text-align",
        path: "대상 › 글자 › 문단",
      }),
    ]);
    expect(filterStudioInspectorActions(textActions, "글꼴")).toEqual([
      expect.objectContaining({
        id: "typography",
        focusTarget: "element.typography",
        path: "대상 › 글자 › 글꼴",
      }),
    ]);
    expect(textActions).toContainEqual(
      expect.objectContaining({
        id: "selection-layout",
        focusTarget: "selection.geometry",
      }),
    );
    expect(filterStudioInspectorActions(pageActions, "스냅")).toEqual([
      expect.objectContaining({
        id: "canvas-guides",
        focusTarget: "canvas.guide-lines",
      }),
    ]);
  });

  it("does not advertise the text-only fill section for speech bubbles", () => {
    const bubbleActions = studioInspectorActions({
      hasSelection: true,
      selectedType: "bubble",
      drawing: false,
    });
    const bubbleActionIds = bubbleActions.map((action) => action.id);

    expect(bubbleActionIds).not.toContain("text-fill");
    expect(bubbleActionIds).toContain("typography");
    expect(bubbleActionIds).toContain("text-align");
    expect(filterStudioInspectorActions(bubbleActions, "글자 채우기")).toEqual([]);
  });

  it("does not advertise targets that are unmounted for multi-select or shape tools", () => {
    const multiSelectionActions = studioInspectorActions({
      hasSelection: true,
      selectedType: null,
      drawing: false,
    });
    expect(multiSelectionActions.map((action) => action.id)).not.toContain(
      "selection-order-align",
    );
    expect(multiSelectionActions.map((action) => action.id)).toContain(
      "selection-layout",
    );

    const shapeDrawingActions = studioInspectorActions({
      hasSelection: false,
      selectedType: null,
      drawing: true,
      drawingToolPropertiesAvailable: false,
    });
    expect(shapeDrawingActions.map((action) => action.id)).not.toContain(
      "brush-studio",
    );
    expect(shapeDrawingActions.map((action) => action.id)).not.toContain(
      "brush-engines",
    );
    expect(shapeDrawingActions.map((action) => action.id)).toContain(
      "drawing-properties",
    );
  });
});
