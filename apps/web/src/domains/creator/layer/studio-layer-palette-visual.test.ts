import { describe, expect, it } from "vitest";

import {
  buildStudioLayerPaletteStatuses,
  resolveStudioLayerSemanticKind,
  STUDIO_LAYER_SEMANTIC_KIND_LABELS,
  visibleStudioLayerPaletteStatuses,
} from "./studio-layer-palette-visual";

describe("studio layer palette semantic kind", () => {
  it("maps familiar layer categories and keeps explicit 3D projection authoritative", () => {
    expect(resolveStudioLayerSemanticKind({ type: "image" })).toBe("raster");
    expect(resolveStudioLayerSemanticKind({ type: "draw" })).toBe("vector");
    expect(resolveStudioLayerSemanticKind({ type: "text" })).toBe("text");
    expect(resolveStudioLayerSemanticKind({ type: "bubble" })).toBe("bubble");
    expect(
      resolveStudioLayerSemanticKind({
        type: "image",
        semanticKind: "three-d",
      })
    ).toBe("three-d");
    expect(STUDIO_LAYER_SEMANTIC_KIND_LABELS["three-d"]).toBe("3D");
  });

  it("puts drawing-safety state ahead of secondary metadata", () => {
    const statuses = buildStudioLayerPaletteStatuses({
      effectivelyHidden: true,
      effectivelyLocked: true,
      fillReference: true,
      masked: true,
      maskEnabled: false,
      clipBelow: true,
      alphaLocked: true,
      aiGenerated: true,
      animated: true,
    });

    expect(statuses.slice(0, 5)).toEqual([
      { kind: "hidden", label: "숨김" },
      { kind: "locked", label: "잠김" },
      { kind: "reference", label: "채우기 참조 레이어" },
      { kind: "mask-disabled", label: "레이어 마스크 꺼짐" },
      { kind: "clipping", label: "아래 레이어에 클리핑" },
    ]);
    expect(visibleStudioLayerPaletteStatuses(statuses)).toMatchObject({
      visible: statuses.slice(0, 5),
      hiddenCount: 3,
    });
  });

  it("does not duplicate local and document visibility state", () => {
    expect(
      buildStudioLayerPaletteStatuses({
        locallyHidden: true,
        effectivelyHidden: true,
      })
    ).toEqual([{ kind: "local-hidden", label: "이 기기에서만 숨김" }]);
  });

  it("clamps malformed visual caps instead of creating an unbounded row", () => {
    const statuses = buildStudioLayerPaletteStatuses({
      effectivelyHidden: true,
      effectivelyLocked: true,
      fillReference: true,
      masked: true,
      clipBelow: true,
      alphaLocked: true,
      aiGenerated: true,
      animated: true,
    });
    expect(visibleStudioLayerPaletteStatuses(statuses, Number.POSITIVE_INFINITY))
      .toMatchObject({ visible: statuses.slice(0, 1), hiddenCount: 7 });
    expect(visibleStudioLayerPaletteStatuses(statuses, 100)).toMatchObject({
      visible: statuses.slice(0, 8),
      hiddenCount: 0,
    });
  });
});
