import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT,
  DEFAULT_STUDIO_INSPECTOR_FLOATING_LAYOUT,
  DEFAULT_STUDIO_PAGE_LIST_FLOATING_LAYOUT,
  loadStudioDetachablePanelState,
  saveStudioDetachablePanelState,
  studioDetachablePanelSessionKey,
} from "./studio-detachable-panels";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("studio detachable panels", () => {
  it("keeps same-tab attached mode explicit and failure safe", () => {
    const storage = memoryStorage();
    expect(loadStudioDetachablePanelState("page-list", storage)).toBe(false);
    expect(saveStudioDetachablePanelState("page-list", true, storage)).toBe(true);
    expect(loadStudioDetachablePanelState("page-list", storage)).toBe(true);
    expect(saveStudioDetachablePanelState("page-list", false, storage)).toBe(true);
    expect(loadStudioDetachablePanelState("page-list", storage)).toBe(false);
    expect(studioDetachablePanelSessionKey("inspector")).toContain("inspector");
  });

  it("ships reachable defaults for the expanded desktop surfaces", () => {
    for (const layout of [
      DEFAULT_STUDIO_PAGE_LIST_FLOATING_LAYOUT,
      DEFAULT_STUDIO_INSPECTOR_FLOATING_LAYOUT,
      DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT,
    ]) {
      expect(layout.version).toBe(2);
      expect(layout.dock).toBe("free");
      expect(layout.width).toBeGreaterThanOrEqual(320);
      expect(layout.height).toBeGreaterThanOrEqual(600);
      expect(layout.positionLocked).toBe(false);
      expect(layout.sizeLocked).toBe(false);
    }
  });
});
