import { describe, expect, it } from "vitest";

import {
  resolveStudioInspectorContextRoute,
  studioInspectorContextUsesImageTabs,
  type StudioInspectorContextSnapshot,
} from "./studio-inspector-context-route";

import type { StudioInspectorLayout } from "./studio-inspector-layout";

const layout = (image: StudioInspectorLayout["image"]): StudioInspectorLayout => ({
  primary: "properties",
  image,
  document: "canvas",
});

const context = (
  contentMode: StudioInspectorContextSnapshot["contentMode"],
  selectedType: string | null,
): StudioInspectorContextSnapshot => ({ contentMode, selectedType });

describe("studio inspector context route", () => {
  it("recognizes only selected image-capable contexts", () => {
    expect(studioInspectorContextUsesImageTabs(context("selection", "image"))).toBe(true);
    expect(studioInspectorContextUsesImageTabs(context("selection", "draw"))).toBe(true);
    expect(studioInspectorContextUsesImageTabs(context("selection", "text"))).toBe(false);
    expect(studioInspectorContextUsesImageTabs(context("drawing", "draw"))).toBe(false);
    expect(studioInspectorContextUsesImageTabs(null)).toBe(false);
  });

  it("starts a newly observed image context on Quick", () => {
    expect(
      resolveStudioInspectorContextRoute(layout("retouch"), null, context("selection", "image")),
    ).toEqual(layout("quick"));
  });

  it("resets after returning from a non-image context", () => {
    expect(
      resolveStudioInspectorContextRoute(
        layout("mask"),
        context("selection", "text"),
        context("selection", "image"),
      ),
    ).toEqual(layout("quick"));
  });

  it("resets when the image-capable selection kind changes", () => {
    expect(
      resolveStudioInspectorContextRoute(
        layout("transform"),
        context("selection", "image"),
        context("selection", "draw"),
      ),
    ).toEqual(layout("quick"));
  });

  it("preserves a specialist tab across same-kind image selections", () => {
    const current = layout("retouch");
    expect(
      resolveStudioInspectorContextRoute(
        current,
        context("selection", "image"),
        context("selection", "image"),
      ),
    ).toBe(current);
  });

  it("does not rewrite hidden image state while the next context cannot show it", () => {
    const current = layout("mask");
    expect(
      resolveStudioInspectorContextRoute(
        current,
        context("selection", "image"),
        context("selection", "bubble"),
      ),
    ).toBe(current);
  });

  it("keeps object identity when Quick is already selected", () => {
    const current = layout("quick");
    expect(
      resolveStudioInspectorContextRoute(current, null, context("selection", "image")),
    ).toBe(current);
  });
});
