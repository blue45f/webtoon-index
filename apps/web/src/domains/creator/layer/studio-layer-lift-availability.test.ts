import { describe, expect, it } from "vitest";

import {
  inspectStudioLayerLiftAvailability,
  type StudioLayerLiftAvailabilityInput,
  type StudioLayerLiftUnavailableCode,
} from "./studio-layer-lift-availability";

import type { El } from "../studio-element-model";

const INLINE_PNG = "data:image/png;base64,AA==";

function image(overrides: Partial<Extract<El, { type: "image" }>> = {}): Extract<
  El,
  { type: "image" }
> {
  return {
    id: "source",
    type: "image",
    name: "Imported cut",
    src: INLINE_PNG,
    x: 12.25,
    y: -8.5,
    width: 320.4,
    height: 480.6,
    rotation: 17,
    flipped: true,
    flippedY: false,
    skewX: 4,
    skewY: -3,
    ...overrides,
  };
}

function input(
  source: El = image(),
  overrides: Partial<StudioLayerLiftAvailabilityInput> = {},
): StudioLayerLiftAvailabilityInput {
  return {
    elements: [source],
    groups: [],
    selectedIds: [source.id],
    ...overrides,
  };
}

function expectUnavailable(
  result: ReturnType<typeof inspectStudioLayerLiftAvailability>,
  code: StudioLayerLiftUnavailableCode,
): void {
  expect(result).toMatchObject({ available: false, code });
}

describe("studio layer-lift availability", () => {
  it("describes one static ImageEl and preserves authored placement outside the raster", () => {
    const result = inspectStudioLayerLiftAvailability(input(image({
      brightness: 0.2,
      blendMode: "normal",
      opacity: 1,
    })));

    expect(result).toMatchObject({
      available: true,
      sourceId: "source",
      sourceName: "Imported cut",
      sourceMimeType: "image/png",
      readbackRequirement: "inline",
      rasterWidth: 320,
      rasterHeight: 481,
      pixelCount: 320 * 481,
      filtersWillBeBaked: true,
      placement: {
        x: 12.25,
        y: -8.5,
        width: 320.4,
        height: 480.6,
        rotation: 17,
        flipped: true,
        flippedY: false,
        skewX: 4,
        skewY: -3,
      },
    });
    if (!result.available) throw new Error(result.message);
    expect(result.sourceFingerprint).toMatch(
      /^studio-layer-lift-source-v1:[0-9a-f]{16}$/u,
    );
  });

  it("requires exactly one existing image selection", () => {
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image(), { selectedIds: [] })),
      "selection-empty",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image(), {
        selectedIds: ["source", "other"],
      })),
      "selection-multiple",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image(), {
        selectedIds: ["missing"],
      })),
      "selection-missing",
    );
    const text: El = {
      id: "text",
      type: "text",
      text: "대사",
      x: 0,
      y: 0,
      width: 100,
      fontSize: 24,
      fill: "#000000",
      rotation: 0,
    };
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(text)),
      "selection-not-image",
    );
  });

  it("fails closed for document ambiguity, locks, groups, and clipping dependencies", () => {
    const duplicate = image({ name: "duplicate" });
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image(), {
        elements: [image(), duplicate],
      })),
      "document-duplicate-id",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ hidden: true }))),
      "source-hidden",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ locked: true }))),
      "source-locked",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ groupId: "group" }))),
      "source-grouped",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ clipBelow: true }))),
      "source-clipping-dependent",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image(), {
        elements: [
          image(),
          {
            id: "front",
            type: "image",
            src: INLINE_PNG,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
            clipBelow: true,
          },
        ],
      })),
      "source-clipping-dependent",
    );
  });

  it("fails closed for masks, animation, linked 3D, opacity, blend, and layer styles", () => {
    const cases: Array<{
      expected: StudioLayerLiftUnavailableCode;
      source: Extract<El, { type: "image" }>;
    }> = [
      {
        source: image({ maskSrc: INLINE_PNG, maskEnabled: false }),
        expected: "source-mask-dependent",
      },
      {
        source: image({ filterMaskSrc: INLINE_PNG, filterMaskEnabled: false }),
        expected: "source-mask-dependent",
      },
      {
        source: image({ frames: [] }),
        expected: "source-animation",
      },
      {
        source: image({ src: "data:image/gif;base64,AA==" }),
        expected: "source-animation",
      },
      {
        source: image({ bg3dLtBundleId: "scene" }),
        expected: "source-3d",
      },
      {
        source: image({ opacity: 0.999 }),
        expected: "source-opacity",
      },
      {
        source: image({ blendMode: "multiply" }),
        expected: "source-blend-mode",
      },
      {
        source: image({ shadowColor: "#000000" }),
        expected: "source-layer-style",
      },
      {
        source: image({ cornerRadius: 1 }),
        expected: "source-layer-style",
      },
    ];

    for (const testCase of cases) {
      expectUnavailable(
        inspectStudioLayerLiftAvailability(input(testCase.source)),
        testCase.expected,
      );
    }
  });

  it("reports invalid placement, raster budgets, and unreadable formats separately", () => {
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ x: Number.NaN }))),
      "source-invalid-placement",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({ width: 8_193 }))),
      "source-raster-budget-exceeded",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({
        src: "data:image/svg+xml,<svg/>",
      }))),
      "source-format-unsupported",
    );
    expectUnavailable(
      inspectStudioLayerLiftAvailability(input(image({
        src: "work-asset://image/source",
      }), { readableSource: null })),
      "source-unreadable",
    );
  });

  it("accepts an exact hydrated render source without replacing authored identity", () => {
    const source = image({ src: "work-asset://image/source" });
    const result = inspectStudioLayerLiftAvailability(input(source, {
      readableSource: {
        sourceId: source.id,
        src: "blob:https://studio.test/admitted-source",
        mimeType: "image/webp",
      },
    }));

    expect(result).toMatchObject({
      available: true,
      sourceId: source.id,
      readableSource: "blob:https://studio.test/admitted-source",
      sourceMimeType: "image/webp",
      readbackRequirement: "same-origin",
    });
  });

  it("marks an external raster as requiring a CORS readback probe", () => {
    const result = inspectStudioLayerLiftAvailability(input(image({
      src: "https://cdn.example.test/panel.webp?rev=2",
    })));

    expect(result).toMatchObject({
      available: true,
      sourceMimeType: "image/webp",
      readbackRequirement: "cors-probe",
    });
  });
});
