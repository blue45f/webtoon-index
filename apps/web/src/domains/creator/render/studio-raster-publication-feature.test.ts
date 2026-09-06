
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

import {
  STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED,
  STUDIO_RASTER_PUBLICATION_EXPERIMENT_TOKEN,
  STUDIO_RASTER_VERIFIED_RENDERER_HANDOFF_MOUNTED,
  isStudioAutomaticRasterPublicationEnabled,
} from "./studio-raster-publication-feature";

describe("automatic raster publication feature gate", () => {
  it("keeps publication deployment-gated after mounting the verified renderer handoff", () => {
    expect(STUDIO_RASTER_VERIFIED_RENDERER_HANDOFF_MOUNTED).toBe(true);
    expect(STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED).toBe(false);
    expect(isStudioAutomaticRasterPublicationEnabled({
      experimentToken: STUDIO_RASTER_PUBLICATION_EXPERIMENT_TOKEN,
      rendererHandoffMounted: false,
    })).toBe(false);
  });

  it("requires both the exact experiment token and a mounted renderer handoff", () => {
    expect(isStudioAutomaticRasterPublicationEnabled({
      experimentToken: undefined,
      rendererHandoffMounted: true,
    })).toBe(false);
    expect(isStudioAutomaticRasterPublicationEnabled({
      experimentToken: "true",
      rendererHandoffMounted: true,
    })).toBe(false);
    expect(isStudioAutomaticRasterPublicationEnabled({
      experimentToken: STUDIO_RASTER_PUBLICATION_EXPERIMENT_TOKEN,
      rendererHandoffMounted: true,
    })).toBe(true);
  });

  it("guards both draw promotion and raster history publication in the editor wiring", () => {
    const pageSource = readStudioCuttoonEditorSource();
    const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
    const source = `${pageSource}\n${viewportSource}`;
    expect(source).toMatch(
      /STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED\s*&&\s*studioAuthUserId/u
    );
    expect(source).toMatch(
      /STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED\s*&&\s*!masterEditMode/u
    );
    expect(source).toContain("<StudioRasterCrdtSurface");
    expect(source).toContain("studioRasterHiddenOperationIds.has(el.id)");
    expect(source).toContain("authorizedAuthorityKey={studioRasterAuthorizedAuthorityKey}");
    expect(source).toContain("StudioRasterServerAuthorityCoordinator");
    expect(source).toContain("authorizedRasterLogSha256: studioRasterAuthorizedLogSha256");
    expect(source).toContain("return barrier(10_000)");
    expect(source).toContain("revokeStudioRasterHandoffRef.current()");
    expect(source).toContain("projectStudioRasterOverlayElements({");
    expect(source).toContain("resolveStudioRasterHandoffProjection({");
    expect(source.match(/readStudioAuthoritativeStageFrame\(\{/gu)).toHaveLength(3);
    // 마퀴 프리뷰는 임페러티브 Konva Rect 로 옮겨졌고, 게이트는 저빈도 활성 불리언만 본다.
    expect(source).toMatch(/marqueeActive\s*\|\|\s*userGuides\.length\s*>\s*0/u);
  });
});
