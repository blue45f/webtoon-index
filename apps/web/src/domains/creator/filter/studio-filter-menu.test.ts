import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_LABELS,
  STUDIO_FILTER_MENU_KINDS,
  cloneStudioFilterDraft,
  createStudioFilterDraft,
  projectStudioFilterPreview,
  studioFilterDraftToPatch,
  type StudioFilterDraft,
} from "./studio-filter-menu";
import {
  STUDIO_FILTER_PACK_KINDS,
  isStudioFilterPackKind,
} from "./studio-filter-pack";

describe("studio filter menu", () => {
  it("creates Magma-compatible blur defaults and clamps authored patches", () => {
    expect(createStudioFilterDraft("gaussian-blur", {})).toEqual({
      kind: "gaussian-blur",
      radius: 10,
    });
    expect(
      studioFilterDraftToPatch({ kind: "gaussian-blur", radius: 999 }),
    ).toEqual({
      blurFx: { type: "gaussian", strength: 100, radius: 40, angle: 0 },
    });
  });

  it("round-trips motion direction through the engine's unsigned angle field", () => {
    const patch = studioFilterDraftToPatch({
      kind: "motion-blur",
      distance: 12,
      angle: -45,
    });
    expect(patch.blurFx).toEqual({
      type: "motion",
      strength: 100,
      radius: 12,
      angle: 315,
    });
    expect(createStudioFilterDraft("motion-blur", patch)).toEqual({
      kind: "motion-blur",
      distance: 12,
      angle: -45,
    });
  });

  it("maps percentage controls to the existing HSB and contrast document fields", () => {
    expect(
      studioFilterDraftToPatch({
        kind: "hue-saturation-brightness",
        hue: 25,
        saturation: -30,
        brightness: 40,
      }),
    ).toEqual({ hue: 25, saturation: -0.3, brightness: 0.4 });

    expect(
      studioFilterDraftToPatch({
        kind: "brightness-contrast",
        brightness: 0,
        contrast: 0,
      }),
    ).toEqual({ brightness: undefined, contrast: undefined });
  });

  it("clamps brightness and contrast to the renderer's exact shared-document range", () => {
    expect(studioFilterDraftToPatch({
      kind: "hue-saturation-brightness",
      hue: 0,
      saturation: 0,
      brightness: 81,
    })).toMatchObject({ brightness: 0.8 });
    expect(studioFilterDraftToPatch({
      kind: "brightness-contrast",
      brightness: -81,
      contrast: 81,
    })).toMatchObject({ brightness: -0.8, contrast: 80 });
    expect(createStudioFilterDraft("brightness-contrast", {
      brightness: 1,
      contrast: -100,
    })).toMatchObject({ brightness: 80, contrast: -80 });
  });

  it("removes identity curves and preserves adjusted RGB channel curves", () => {
    const identity = studioFilterDraftToPatch(
      createStudioFilterDraft("color-curves", {}),
    );
    expect(identity).toEqual({ curve: undefined, curveCh: undefined });

    const adjusted: StudioFilterDraft = {
      kind: "color-curves",
      curve: [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ],
      curveCh: {
        r: [
          { x: 0, y: 12 },
          { x: 255, y: 255 },
        ],
      },
    };
    expect(studioFilterDraftToPatch(adjusted).curveCh?.r?.[0]).toEqual({
      x: 0,
      y: 12,
    });
  });

  it("clones curve drafts without sharing nested control points", () => {
    const source = createStudioFilterDraft("color-curves", {}) as Extract<
      StudioFilterDraft,
      { kind: "color-curves" }
    >;
    const cloned = cloneStudioFilterDraft(source) as typeof source;
    cloned.curve[0]!.y = 42;
    expect(source.curve[0]!.y).toBe(0);
  });

  it("registers every filter-pack kind alongside the five core filters", () => {
    expect(STUDIO_FILTER_MENU_KINDS).toHaveLength(5 + STUDIO_FILTER_PACK_KINDS.length);
    for (const kind of STUDIO_FILTER_PACK_KINDS) {
      expect(STUDIO_FILTER_MENU_KINDS).toContain(kind);
      expect(STUDIO_FILTER_LABELS[kind]!.length).toBeGreaterThan(0);
    }
    expect(new Set(STUDIO_FILTER_MENU_KINDS).size).toBe(STUDIO_FILTER_MENU_KINDS.length);
  });

  it("routes filter-pack kinds through the shared draft lifecycle", () => {
    for (const kind of STUDIO_FILTER_PACK_KINDS) {
      expect(isStudioFilterPackKind(kind)).toBe(true);
      const draft = createStudioFilterDraft(kind, {});
      expect(draft.kind).toBe(kind);
      const cloned = cloneStudioFilterDraft(draft);
      expect(cloned).toEqual(draft);
      expect(cloned).not.toBe(draft);
      const patch = studioFilterDraftToPatch(draft);
      expect(Object.keys(patch).length).toBeGreaterThan(0);
    }
  });

  it("projects a preview onto one image without mutating authored elements", () => {
    const elements = [
      { id: "image-1", type: "image", brightness: 0 },
      { id: "image-2", type: "image", brightness: 0 },
      { id: "text-1", type: "text", brightness: 0 },
    ];
    const projected = projectStudioFilterPreview(elements, {
      elementId: "image-1",
      patch: { brightness: 0.5 },
    });

    expect(projected[0]).toMatchObject({ id: "image-1", brightness: 0.5 });
    expect(projected[1]).toBe(elements[1]);
    expect(projected[2]).toBe(elements[2]);
    expect(elements[0]!.brightness).toBe(0);
  });
});
