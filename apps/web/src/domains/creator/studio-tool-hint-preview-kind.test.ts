import { describe, expect, expectTypeOf, it } from "vitest";

import {
  STUDIO_TOOL_HINT_PREVIEW_KINDS,
  STUDIO_TOOL_HINT_PREVIEW_VARIANTS,
  isStudioToolHintPreviewVariant,
  studioToolHintPreviewCanonicalVariantFromRuntime,
  studioToolHintPreviewSpec,
  studioToolHintPreviewSpecFromRuntime,
  type StudioToolHintPreviewCanonicalVariant,
  type StudioToolHintPreviewFields,
  type StudioToolHintPreviewKind,
  type StudioToolHintPreviewSpec,
  type StudioToolHintPreviewVariant,
} from "./studio-tool-hint-preview-kind";

describe("Studio tool hint preview kind/variant contract", () => {
  it("keeps one exhaustive runtime catalog for every default preview", () => {
    const catalogKinds = Object.keys(
      STUDIO_TOOL_HINT_PREVIEW_VARIANTS
    ) as StudioToolHintPreviewKind[];

    expect(STUDIO_TOOL_HINT_PREVIEW_KINDS).toEqual(catalogKinds);
    expect(STUDIO_TOOL_HINT_PREVIEW_KINDS).toHaveLength(121);
    expect(STUDIO_TOOL_HINT_PREVIEW_KINDS).toContain("selection-replace");
    expect(STUDIO_TOOL_HINT_PREVIEW_VARIANTS["selection-replace"]).toEqual([]);
    expect(new Set(STUDIO_TOOL_HINT_PREVIEW_KINDS).size).toBe(
      STUDIO_TOOL_HINT_PREVIEW_KINDS.length
    );
    expect(
      Object.values(STUDIO_TOOL_HINT_PREVIEW_VARIANTS).filter(
        (variants) => variants.length > 0
      )
    ).toHaveLength(40);
    // 의도적 변경(2026-08-07): selection-layout에 flip-horizontal·flip-vertical 추가(179 → 181).
    expect(
      Object.values(STUDIO_TOOL_HINT_PREVIEW_VARIANTS).flat()
    ).toHaveLength(181);

    for (const kind of STUDIO_TOOL_HINT_PREVIEW_KINDS) {
      expect(studioToolHintPreviewSpec(kind)).toEqual({ kind });
    }
  });

  it("accepts every declared canonical variant and rejects cross-family values", () => {
    for (const kind of STUDIO_TOOL_HINT_PREVIEW_KINDS) {
      const variants = STUDIO_TOOL_HINT_PREVIEW_VARIANTS[kind];
      expect(new Set(variants).size, kind).toBe(variants.length);

      for (const variant of variants) {
        expect(isStudioToolHintPreviewVariant(kind, variant), `${kind}:${variant}`).toBe(true);
        expect(
          isStudioToolHintPreviewVariant(kind, `plugin/${kind}/${variant}`),
          `${kind}:plugin/${variant}`
        ).toBe(true);
      }
    }

    expect(isStudioToolHintPreviewVariant("shape", "zoom-in")).toBe(false);
    expect(isStudioToolHintPreviewVariant("zoom-view", "shape-picker-arrow")).toBe(false);
    expect(isStudioToolHintPreviewVariant("ink", "line")).toBe(false);
  });

  it("accepts namespaced canonical actions while keeping legacy aliases out of the type guard", () => {
    expect(
      isStudioToolHintPreviewVariant("camera-zoom", "VRM:Camera:Zoom_Out")
    ).toBe(true);
    expect(
      isStudioToolHintPreviewVariant("layer-lock", "plugin/layer/unlock-layer")
    ).toBe(false);
    expect(
      isStudioToolHintPreviewVariant("color-palette", "Studio:Palette_Family")
    ).toBe(true);
    expect(
      isStudioToolHintPreviewVariant("layer-lock", "plugin/layer/unlock")
    ).toBe(true);
  });

  it.each([
    ["zoom-view", "zoom-fit", "fit-width"],
    ["zoom-view", "persisted/view/zoom-fit", "fit-width"],
    ["layer-visibility", "show-layer", "show"],
    ["layer-visibility", "plugin/layer/hide-layer", "hide"],
    ["layer-lock", "lock-layer", "lock"],
    ["layer-lock", "plugin/layer/unlock-layer", "unlock"],
  ] as const)(
    "canonicalizes the legacy %s runtime value %s to %s",
    (kind, runtimeValue, canonicalVariant) => {
      expect(
        studioToolHintPreviewCanonicalVariantFromRuntime(kind, runtimeValue)
      ).toBe(canonicalVariant);
      expect(studioToolHintPreviewSpecFromRuntime(kind, runtimeValue)).toEqual({
        kind,
        variant: canonicalVariant,
      });
    }
  );

  it("prefers exact and longest canonical actions over shorter suffixes", () => {
    expect(
      studioToolHintPreviewCanonicalVariantFromRuntime(
        "layer-visibility",
        "layer/batch-show"
      )
    ).toBe("batch-show");
    expect(
      studioToolHintPreviewCanonicalVariantFromRuntime(
        "object-ground",
        "bg3d/object/origin-ground"
      )
    ).toBe("origin-ground");
    expect(
      studioToolHintPreviewCanonicalVariantFromRuntime(
        "fullscreen",
        "workspace/exit-fullscreen"
      )
    ).toBe("exit-fullscreen");
  });

  it("preserves precise inferred types for valid default and stateful specs", () => {
    const defaultInk = studioToolHintPreviewSpec("ink");
    const shapeArrow = studioToolHintPreviewSpec("shape", "shape-picker-arrow");
    const namespacedZoom = studioToolHintPreviewSpec(
      "zoom-view",
      "camera:zoom-out"
    );
    const paletteSwatch = studioToolHintPreviewSpec(
      "color-palette",
      "palette-swatch"
    );

    expectTypeOf(defaultInk).toEqualTypeOf<StudioToolHintPreviewSpec<"ink">>();
    expectTypeOf(shapeArrow).toEqualTypeOf<StudioToolHintPreviewSpec<"shape">>();
    expectTypeOf(namespacedZoom).toEqualTypeOf<
      StudioToolHintPreviewSpec<"zoom-view">
    >();
    expectTypeOf(paletteSwatch).toEqualTypeOf<
      StudioToolHintPreviewSpec<"color-palette">
    >();

    expectTypeOf<StudioToolHintPreviewCanonicalVariant<"pressure">>().toEqualTypeOf<
      "linear" | "soft" | "firm"
    >();
    expectTypeOf<Extract<
      "shape-picker-arrow",
      StudioToolHintPreviewVariant<"shape">
    >>().toEqualTypeOf<"shape-picker-arrow">();
    expectTypeOf<Extract<
      "zoom-in",
      StudioToolHintPreviewVariant<"shape">
    >>().toEqualTypeOf<never>();

    const pluginValue: string = "plugin/camera/zoom-out";
    if (isStudioToolHintPreviewVariant("camera-zoom", pluginValue)) {
      expectTypeOf(pluginValue).toMatchTypeOf<
        StudioToolHintPreviewVariant<"camera-zoom">
      >();
    }
  });

  it("rejects invalid kind/variant pairings during typecheck", () => {
    const compileTimeInvalidPairings = (): void => {
      // @ts-expect-error shape previews do not accept zoom actions.
      studioToolHintPreviewSpec("shape", "zoom-in");
      // @ts-expect-error default-only previews cannot receive semantic variants.
      studioToolHintPreviewSpec("ink", "line");
      // @ts-expect-error selection history accepts only undo or redo.
      studioToolHintPreviewSpec("selection-history", "clear");
      // @ts-expect-error palette previews cannot receive dynamic color values.
      studioToolHintPreviewSpec("color-palette", "#ff8844");
      // @ts-expect-error eyedropper uses the dedicated sample preview, not the palette family.
      studioToolHintPreviewSpec("color-palette", "eyedropper");
      // @ts-expect-error zoom-fit is a persisted ID alias; authored hints use fit-width.
      studioToolHintPreviewSpec("zoom-view", "zoom-fit");
      // @ts-expect-error unlock-layer is a legacy plugin alias; authored hints use unlock.
      studioToolHintPreviewSpec("layer-lock", "plugin/layer/unlock-layer");

      // @ts-expect-error remove belongs to brush-favorite, not zoom-view.
      const invalidSpec: StudioToolHintPreviewSpec = {
        kind: "zoom-view",
        variant: "remove",
      };
      // @ts-expect-error existing hint field names retain the same pairing contract.
      const invalidHintFields: StudioToolHintPreviewFields = {
        preview: "selection-history",
        previewVariant: "expand",
      };
      expect(invalidSpec).toBeUndefined();
      expect(invalidHintFields).toBeUndefined();
    };

    expect(compileTimeInvalidPairings).toBeTypeOf("function");
  });

  it("drops an invalid runtime pairing instead of leaking it to the renderer", () => {
    expect(studioToolHintPreviewSpecFromRuntime("shape", "pause")).toEqual({
      kind: "shape",
    });
    expect(
      studioToolHintPreviewSpecFromRuntime("camera-zoom", "plugin/camera/zoom-out")
    ).toEqual({
      kind: "camera-zoom",
      variant: "zoom-out",
    });
  });
});
