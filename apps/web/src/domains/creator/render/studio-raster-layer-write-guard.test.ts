import { describe, expect, it } from "vitest";

import { canPublishStudioRasterLayer } from "./studio-raster-layer-write-guard";

import type { PageState } from "../studio-page-state";

function page(overrides: Partial<PageState> = {}): PageState {
  return {
    id: "page-1",
    elements: [{
      id: "stroke-1",
      type: "draw",
      points: [0, 0, 10, 10],
      stroke: "#111111",
      strokeWidth: 6,
      groupId: "ink",
    }],
    groups: [{ id: "ink", name: "선화" }],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_080,
    ...overrides,
  };
}

function writable(overrides: Partial<Parameters<typeof canPublishStudioRasterLayer>[0]> = {}) {
  return canPublishStudioRasterLayer({
    page: page(),
    pageId: "page-1",
    operationId: "stroke-1",
    layerId: "ink",
    ...overrides,
  });
}

describe("studio raster layer write guard", () => {
  it("admits an unchanged draw source in an existing unlocked group", () => {
    expect(writable()).toBe(true);
  });

  it("rejects element and group locks before any raster upload", () => {
    expect(writable({
      page: page({ elements: [{ ...page().elements[0]!, locked: true }] }),
    })).toBe(false);
    expect(writable({
      page: page({ groups: [{ id: "ink", name: "선화", locked: true }] }),
    })).toBe(false);
  });

  it("rejects stale page, operation, layer, and deleted-group projections", () => {
    expect(writable({ pageId: "page-other" })).toBe(false);
    expect(writable({ operationId: "stroke-other" })).toBe(false);
    expect(writable({ layerId: "colors" })).toBe(false);
    expect(writable({ page: page({ groups: [] }) })).toBe(false);
    expect(writable({ page: null })).toBe(false);
  });

  it("admits a root-layer draw without requiring a synthetic group", () => {
    expect(writable({
      page: page({ elements: [{ ...page().elements[0]!, groupId: undefined }] }),
      layerId: "page-root",
    })).toBe(true);
  });
});
