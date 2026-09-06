import { describe, expect, it } from "vitest";

import {
  resolveStudioRasterToolAvailability,
  resolveStudioRasterToolAvailabilityMatrix,
  STUDIO_RASTER_TOOL_IDS,
  STUDIO_RASTER_TOOL_SPECS,
} from "./studio-raster-tool-availability";

describe("Studio raster tool availability matrix", () => {
  it("keeps every shipped tool in one complete, ordered contract", () => {
    expect(resolveStudioRasterToolAvailabilityMatrix({}).map((entry) => entry.tool.id)).toEqual(
      STUDIO_RASTER_TOOL_IDS,
    );
    expect(Object.keys(STUDIO_RASTER_TOOL_SPECS)).toHaveLength(STUDIO_RASTER_TOOL_IDS.length);
  });

  it("lets filters create a visible-page merged copy without an attached ImageEl", () => {
    const availability = resolveStudioRasterToolAvailability("filter", {
      selectedType: "draw",
      exactRenderableVisibleCount: 3,
      hasPageBackground: true,
    });
    expect(availability.entry).toMatchObject({
      enabled: true,
      mode: "auto-merged-copy",
      action: {
        id: "create-editable-raster-copy",
        safety: "non-destructive-copy",
      },
    });
    expect(availability.apply.enabled).toBe(true);
  });

  it("prepares vector paint bucket below visible line art instead of asking for an upload", () => {
    expect(resolveStudioRasterToolAvailability("paint-bucket", {
      selectedType: "draw",
      visibleVectorDrawCount: 4,
    }).entry).toMatchObject({
      enabled: true,
      mode: "virtual-vector-fill",
      action: { safety: "non-destructive-copy" },
    });
  });

  it("auto-selects exactly one fill raster but asks when the target is ambiguous", () => {
    expect(resolveStudioRasterToolAvailability("paint-bucket", {
      visibleEditableRasterCount: 1,
    }).entry.mode).toBe("auto-select-raster");
    expect(resolveStudioRasterToolAvailability("paint-bucket", {
      visibleEditableRasterCount: 2,
    }).entry).toMatchObject({
      enabled: false,
      action: { id: "select-raster-layer" },
    });
  });

  it("keeps multiple eligible fill rasters ambiguous even when vector line art is visible", () => {
    expect(resolveStudioRasterToolAvailability("paint-bucket", {
      visibleEditableRasterCount: 2,
      visibleVectorDrawCount: 4,
    }).entry).toMatchObject({
      enabled: false,
      mode: "blocked",
      action: { id: "select-raster-layer" },
    });
  });

  it.each([
    "pixel-marquee",
    "pixel-lasso",
    "magic-wand",
    "history-brush",
    "layer-mask",
  ] as const)("offers an explicit non-destructive raster copy for %s", (tool) => {
    expect(resolveStudioRasterToolAvailability(tool, {
      selectedType: "text",
      exactRenderableVisibleCount: 2,
    }).entry).toMatchObject({
      enabled: false,
      mode: "needs-raster-copy",
      action: {
        id: "create-editable-raster-copy",
        label: "편집용 래스터 복사본 만들기",
        safety: "non-destructive-copy",
      },
    });
  });

  it.each([
    "smudge",
    "dodge-burn",
    "wet-mix",
    "liquify",
    "heal",
    "clone-stamp",
    "crop",
    "pixel-transform",
    "content-aware-fill",
    "puppet-warp",
  ] as const)(
    "lets %s prepare and enter from faithful vector-only page content",
    (tool) => {
      const availability = resolveStudioRasterToolAvailability(tool, {
        selectedType: "draw",
        exactRenderableVisibleCount: 2,
      });

      expect(availability.entry).toMatchObject({
        enabled: true,
        mode: "auto-merged-copy",
        action: {
          id: "create-editable-raster-copy",
          safety: "non-destructive-copy",
        },
      });
      if (tool === "heal" || tool === "clone-stamp") {
        expect(availability.apply.action?.id).toBe("pick-clone-source");
      } else if (tool === "pixel-transform" || tool === "content-aware-fill") {
        expect(availability.apply.action?.id).toBe("make-pixel-selection");
      } else if (tool === "puppet-warp") {
        expect(availability.apply.action?.id).toBe("move-puppet-pin");
      } else if (tool === "crop") {
        expect(availability.apply.action?.id).toBe("adjust-crop-area");
      } else {
        expect(availability.apply.enabled).toBe(true);
      }
    },
  );

  it("does not flatten unsupported fidelity silently", () => {
    const gate = resolveStudioRasterToolAvailability("liquify", {
      selectedType: "draw",
      exactRenderableVisibleCount: 2,
      unsupportedVisibleCount: 1,
    }).entry;
    expect(gate.enabled).toBe(false);
    expect(gate.action).toBeNull();
    expect(gate.reason).toContain("똑같이");
  });

  it("honors document, hidden, selected lock, animation and playback gates in that order", () => {
    expect(resolveStudioRasterToolAvailability("smudge", {
      documentMutationBlockedReason: "공동 문서가 잠겨 있습니다.",
      selectedType: "image",
    }).entry.action?.id).toBe("resolve-document-lock");
    expect(resolveStudioRasterToolAvailability("smudge", {
      selectedType: "image",
      selectedHidden: true,
    }).entry.action?.id).toBe("show-selected-layer");
    expect(resolveStudioRasterToolAvailability("smudge", {
      selectedType: "image",
      selectedMutationBlockedReason: "잠긴 레이어입니다.",
    }).entry.action?.id).toBe("unlock-selected-layer");
    expect(resolveStudioRasterToolAvailability("smudge", {
      selectedType: "image",
      selectedMutationBlockedReason: "원본 소재는 직접 편집할 수 없습니다.",
      selectedMutationRecovery: "copy",
    }).entry.action).toMatchObject({
      id: "create-selected-static-copy",
      safety: "non-destructive-copy",
    });
    expect(resolveStudioRasterToolAvailability("smudge", {
      selectedType: "image",
      selectedAnimated: true,
    }).entry.action).toMatchObject({
      id: "create-selected-static-copy",
      safety: "non-destructive-copy",
    });
    expect(resolveStudioRasterToolAvailability("smudge", {
      selectedType: "image",
      timelinePlaying: true,
    }).entry.action?.id).toBe("stop-timeline");
  });

  it("allows frame-animation to target an animated raster while keeping it selection-only", () => {
    expect(resolveStudioRasterToolAvailability("frame-animation", {
      selectedType: "image",
      selectedAnimated: true,
      timelinePlaying: true,
    }).entry.enabled).toBe(true);
    expect(resolveStudioRasterToolAvailability("frame-animation", {
      visibleEditableRasterCount: 1,
    }).entry).toMatchObject({
      enabled: false,
      action: { id: "select-only-raster-layer" },
    });
  });

  it("separates entering source-based tools from actually painting", () => {
    const clone = resolveStudioRasterToolAvailability("clone-stamp", {
      selectedType: "image",
      hasCloneSource: false,
    });
    expect(clone.entry.enabled).toBe(true);
    expect(clone.apply).toMatchObject({
      enabled: false,
      action: { id: "pick-clone-source" },
    });

    const history = resolveStudioRasterToolAvailability("history-brush", {
      selectedType: "image",
      hasHistorySource: false,
    });
    expect(history.entry.enabled).toBe(true);
    expect(history.apply.action?.id).toBe("pick-history-source");
  });

  it("describes transform, puppet and crop commit prerequisites without blocking tool entry", () => {
    expect(resolveStudioRasterToolAvailability("pixel-transform", {
      selectedType: "image",
    }).apply.action?.id).toBe("make-pixel-selection");
    expect(resolveStudioRasterToolAvailability("puppet-warp", {
      selectedType: "image",
    }).apply.action?.id).toBe("move-puppet-pin");
    expect(resolveStudioRasterToolAvailability("crop", {
      selectedType: "image",
    }).apply.action?.id).toBe("adjust-crop-area");
  });

  it("guides all-hidden and empty pages instead of leaving disabled controls unexplained", () => {
    expect(resolveStudioRasterToolAvailability("liquify", {
      hiddenContentCount: 2,
    }).entry.action?.id).toBe("show-hidden-layers");
    expect(resolveStudioRasterToolAvailability("liquify", {}).entry.action?.id).toBe("add-or-import-content");
  });
});
