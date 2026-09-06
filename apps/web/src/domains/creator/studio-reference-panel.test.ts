import { describe, expect, it } from "vitest";

import {
  clampReferencePanelRect,
  defaultReferencePanelRect,
  deserializeReferencePanelSettings,
  dragReferencePanelRect,
  filterReferenceAssetsByName,
  REFERENCE_PANEL_DEFAULT_HEIGHT,
  REFERENCE_PANEL_DEFAULT_WIDTH,
  REFERENCE_PANEL_EDGE_MARGIN,
  REFERENCE_PANEL_MIN_HEIGHT,
  REFERENCE_PANEL_MIN_WIDTH,
  REFERENCE_PANEL_TOP_OFFSET,
  resetReferencePanelSize,
  resizeReferencePanelRect,
  resolvePinnedAsset,
  serializeReferencePanelSettings,
  type ReferencePanelSettings,
} from "./studio-reference-panel";

import type { StudioAsset } from "./studio-asset-library";

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset-1",
    name: "테스트 에셋",
    dataUrl: "data:image/png;base64,AAAA",
    width: 100,
    height: 100,
    createdAt: 1,
    ...overrides,
  };
}

describe("defaultReferencePanelRect", () => {
  it("stays within viewport bounds on a large viewport (1440x900)", () => {
    const rect = defaultReferencePanelRect(1440, 900);
    expect(rect.x).toBeGreaterThanOrEqual(REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1440 - REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.y).toBeGreaterThanOrEqual(REFERENCE_PANEL_TOP_OFFSET);
    expect(rect.y + rect.height).toBeLessThanOrEqual(900 - REFERENCE_PANEL_EDGE_MARGIN);
  });

  it("stays within viewport bounds on a small viewport (360x640)", () => {
    const rect = defaultReferencePanelRect(360, 640);
    expect(rect.x).toBeGreaterThanOrEqual(REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.x + rect.width).toBeLessThanOrEqual(360 - REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.y).toBeGreaterThanOrEqual(REFERENCE_PANEL_TOP_OFFSET);
    expect(rect.y + rect.height).toBeLessThanOrEqual(640 - REFERENCE_PANEL_EDGE_MARGIN);
  });
});

describe("clampReferencePanelRect", () => {
  it("shrinks an oversized rect to fit a small viewport without negative dims", () => {
    const rect = clampReferencePanelRect({ x: 0, y: 0, width: 2000, height: 2000 }, 360, 640);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(360 - REFERENCE_PANEL_EDGE_MARGIN + 0.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(640 - REFERENCE_PANEL_EDGE_MARGIN + 0.001);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });
});

describe("dragReferencePanelRect", () => {
  const startRect = { x: 200, y: 200, width: 300, height: 260 };

  it("clamps to EDGE_MARGIN/TOP_OFFSET when moved fully off the left/top edge", () => {
    const rect = dragReferencePanelRect(startRect, { x: 0, y: 0 }, { x: -5000, y: -5000 }, 1440, 900);
    expect(rect.x).toBe(REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.y).toBe(REFERENCE_PANEL_TOP_OFFSET);
    expect(rect.width).toBe(startRect.width);
    expect(rect.height).toBe(startRect.height);
  });

  it("clamps so the whole rect stays visible when moved off the right/bottom edge", () => {
    const rect = dragReferencePanelRect(startRect, { x: 0, y: 0 }, { x: 5000, y: 5000 }, 1440, 900);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1440 - REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.y + rect.height).toBeLessThanOrEqual(900 - REFERENCE_PANEL_EDGE_MARGIN);
  });
});

describe("resizeReferencePanelRect", () => {
  const startRect = { x: 1000, y: 100, width: 300, height: 260 };

  it("stops exactly at the right/bottom edge when growing past it (x/y unchanged)", () => {
    const rect = resizeReferencePanelRect(startRect, { x: 0, y: 0 }, { x: 5000, y: 5000 }, 1440, 900);
    expect(rect.x).toBe(startRect.x);
    expect(rect.y).toBe(startRect.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1440 - REFERENCE_PANEL_EDGE_MARGIN);
    expect(rect.y + rect.height).toBeLessThanOrEqual(900 - REFERENCE_PANEL_EDGE_MARGIN);
  });

  it("floors at MIN_WIDTH/MIN_HEIGHT when shrinking below the minimum", () => {
    const rect = resizeReferencePanelRect(startRect, { x: 0, y: 0 }, { x: -5000, y: -5000 }, 1440, 900);
    expect(rect.width).toBe(REFERENCE_PANEL_MIN_WIDTH);
    expect(rect.height).toBe(REFERENCE_PANEL_MIN_HEIGHT);
    expect(rect.x).toBe(startRect.x);
    expect(rect.y).toBe(startRect.y);
  });
});

describe("resetReferencePanelSize", () => {
  it("keeps x/y and restores default width/height", () => {
    const rect = resetReferencePanelSize({ x: 123, y: 234, width: 500, height: 500 }, 1440, 900);
    expect(rect.x).toBe(123);
    expect(rect.y).toBe(234);
    expect(rect.width).toBe(REFERENCE_PANEL_DEFAULT_WIDTH);
    expect(rect.height).toBe(REFERENCE_PANEL_DEFAULT_HEIGHT);
  });
});

describe("deserializeReferencePanelSettings", () => {
  const viewportW = 1440;
  const viewportH = 900;

  it("falls back to defaults for null input", () => {
    const result = deserializeReferencePanelSettings(null, viewportW, viewportH);
    expect(result).toEqual(defaultReferencePanelRectSettings(viewportW, viewportH));
  });

  it("falls back to defaults for a non-JSON string", () => {
    const result = deserializeReferencePanelSettings("not json {{{", viewportW, viewportH);
    expect(result).toEqual(defaultReferencePanelRectSettings(viewportW, viewportH));
  });

  it("falls back to defaults for JSON that is not an object", () => {
    const result = deserializeReferencePanelSettings("42", viewportW, viewportH);
    expect(result).toEqual(defaultReferencePanelRectSettings(viewportW, viewportH));
  });

  it("falls back to defaults for wrong version", () => {
    const result = deserializeReferencePanelSettings(
      JSON.stringify({ v: 999, x: 10, y: 10, width: 300, height: 260, assetId: "a", flipped: true }),
      viewportW,
      viewportH
    );
    expect(result).toEqual(defaultReferencePanelRectSettings(viewportW, viewportH));
  });

  it("falls back per-field for partially-missing/garbage fields without throwing", () => {
    expect(() =>
      deserializeReferencePanelSettings(JSON.stringify({ v: 1, x: "abc", y: 150, width: 300, height: 260 }), viewportW, viewportH)
    ).not.toThrow();
    const result = deserializeReferencePanelSettings(
      JSON.stringify({ v: 1, x: "abc", y: 150, width: 300, height: 260 }),
      viewportW,
      viewportH
    );
    // x falls back to the default's x, y is honored (150 is within [TOP_OFFSET, maxY] so it isn't clamped).
    const fallback = defaultReferencePanelRectSettings(viewportW, viewportH);
    expect(result.x).toBe(fallback.x);
    expect(result.y).toBe(150);
    expect(result.width).toBe(300);
    expect(result.height).toBe(260);
    expect(result.assetId).toBeNull();
    expect(result.flipped).toBe(false);
  });

  it("round-trips through serialize -> deserialize for a viewport that doesn't force clamping", () => {
    const settings: ReferencePanelSettings = { x: 40, y: 120, width: 320, height: 280, assetId: "asset-9", flipped: true };
    const raw = serializeReferencePanelSettings(settings);
    const result = deserializeReferencePanelSettings(raw, viewportW, viewportH);
    expect(result).toEqual(settings);
  });
});

function defaultReferencePanelRectSettings(viewportW: number, viewportH: number): ReferencePanelSettings {
  return { ...defaultReferencePanelRect(viewportW, viewportH), assetId: null, flipped: false };
}

describe("resolvePinnedAsset", () => {
  const assets = [makeAsset({ id: "a1" }), makeAsset({ id: "a2", name: "다른 에셋" })];

  it("returns the matching asset when found", () => {
    expect(resolvePinnedAsset(assets, "a2")?.id).toBe("a2");
  });

  it("returns null when not found", () => {
    expect(resolvePinnedAsset(assets, "missing")).toBeNull();
  });

  it("returns null when assetId is null", () => {
    expect(resolvePinnedAsset(assets, null)).toBeNull();
  });
});

describe("filterReferenceAssetsByName", () => {
  const assets = [makeAsset({ id: "a1", name: "고양이 스케치" }), makeAsset({ id: "a2", name: "Background Ref" })];

  it("returns all assets for an empty query", () => {
    expect(filterReferenceAssetsByName(assets, "")).toEqual(assets);
    expect(filterReferenceAssetsByName(assets, "   ")).toEqual(assets);
  });

  it("matches case-insensitively by substring", () => {
    expect(filterReferenceAssetsByName(assets, "background")).toEqual([assets[1]]);
    expect(filterReferenceAssetsByName(assets, "BACK")).toEqual([assets[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterReferenceAssetsByName(assets, "존재하지않음")).toEqual([]);
  });
});
