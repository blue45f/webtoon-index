import { describe, expect, it, vi } from "vitest";

import {
  DISABLED_STUDIO_RASTER_HANDOFF_BASE_KEY,
  projectStudioRasterOverlayElements,
  resolveStudioRasterHandoffProjection,
} from "./studio-raster-publication-projection";

describe("studio raster publication projection fast path", () => {
  it("does not project scene elements while automatic raster publication is disabled", () => {
    const project = vi.fn(() => [{ id: "draw-1" }]);

    const first = projectStudioRasterOverlayElements({ enabled: false, project });
    const second = projectStudioRasterOverlayElements({ enabled: false, project });

    expect(project).not.toHaveBeenCalled();
    expect(first).toEqual([]);
    expect(second).toBe(first);
  });

  it("does not calculate a visible rect or serialize a base key while publication is disabled", () => {
    const projectVisibleDocumentRect = vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 }));
    const createHandoffBaseKey = vi.fn(() => "expensive-canonical-key");

    const projection = resolveStudioRasterHandoffProjection({
      enabled: false,
      projectVisibleDocumentRect,
      createHandoffBaseKey,
    });

    expect(projectVisibleDocumentRect).not.toHaveBeenCalled();
    expect(createHandoffBaseKey).not.toHaveBeenCalled();
    expect(projection).toEqual({
      visibleDocumentRect: null,
      handoffBaseKey: DISABLED_STUDIO_RASTER_HANDOFF_BASE_KEY,
    });
  });

  it("preserves the verified enabled publication projection", () => {
    const overlayElements = [{ id: "draw-1" }];
    const visibleDocumentRect = { x: 1, y: 2, width: 3, height: 4 };
    const project = vi.fn(() => overlayElements);
    const projectVisibleDocumentRect = vi.fn(() => visibleDocumentRect);
    const createHandoffBaseKey = vi.fn(() => "canonical-key");

    expect(projectStudioRasterOverlayElements({ enabled: true, project })).toBe(overlayElements);
    expect(resolveStudioRasterHandoffProjection({
      enabled: true,
      projectVisibleDocumentRect,
      createHandoffBaseKey,
    })).toEqual({
      visibleDocumentRect,
      handoffBaseKey: "canonical-key",
    });
    expect(project).toHaveBeenCalledOnce();
    expect(projectVisibleDocumentRect).toHaveBeenCalledOnce();
    expect(createHandoffBaseKey).toHaveBeenCalledOnce();
  });
});
