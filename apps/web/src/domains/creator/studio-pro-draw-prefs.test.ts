import { describe, expect, it } from "vitest";

import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./brush/studio-brush-pack-id";
import { BRUSH_PRESETS } from "./studio-brush";
import {
  applyBrushPresetWithLocks,
  cycleStudioStabilizerStrength,
  DEFAULT_STUDIO_PRO_DRAW_PREFS,
  loadStudioProDrawPrefs,
  mutateStudioProDrawPrefs,
  normalizeStudioProDrawPrefs,
  rememberRecentBrushId,
  rememberStudioBrushLibraryView,
  saveStudioProDrawPrefs,
  STUDIO_BRUSH_LIBRARY_QUERY_LIMIT,
  STUDIO_BRUSH_LIBRARY_TAB_ID_LIMIT,
  STUDIO_FAVORITE_BRUSH_LIMIT,
  toggleFavoriteBrushId,
} from "./studio-pro-draw-prefs";

describe("studio pro draw prefs", () => {
  it("applies Procreate-style size and opacity locks when switching brushes", () => {
    const preset = { id: "marker", defaultWidth: 16, defaultOpacity: 0.6, defaultColor: "#112233" };
    const current = { strokeWidth: 4, brushOpacity: 0.9, color: "#abcdef" };

    expect(applyBrushPresetWithLocks(preset, { sizeLocked: false, opacityLocked: false }, current)).toEqual({
      brushId: "marker",
      strokeWidth: 16,
      brushOpacity: 0.6,
      color: "#abcdef",
    });
    expect(applyBrushPresetWithLocks(preset, { sizeLocked: true, opacityLocked: true }, current)).toEqual({
      brushId: "marker",
      strokeWidth: 4,
      brushOpacity: 0.9,
      color: "#abcdef",
    });
  });

  it("treats a special brush default color as preview metadata only", () => {
    expect(
      applyBrushPresetWithLocks(
        { id: "star-dust", defaultWidth: 18, defaultOpacity: 0.9, defaultColor: "#f8fafc" },
        { sizeLocked: false, opacityLocked: false },
        { strokeWidth: 6, brushOpacity: 1, color: "#7c3aed" }
      ).color
    ).toBe("#7c3aed");
  });

  it("keeps named eraser strength exact even when paint opacity is locked", () => {
    const current = { strokeWidth: 12, brushOpacity: 0.38, color: "#111111" };

    expect(
      applyBrushPresetWithLocks(
        { id: "standard-eraser", defaultWidth: 20, defaultOpacity: 1 },
        { sizeLocked: true, opacityLocked: true },
        current,
        { operation: "erase" },
      ),
    ).toMatchObject({
      brushId: "standard-eraser",
      strokeWidth: 12,
      brushOpacity: 1,
    });
    expect(
      applyBrushPresetWithLocks(
        { id: "kneaded-eraser", defaultWidth: 26, defaultOpacity: 0.38 },
        { sizeLocked: true, opacityLocked: true },
        { ...current, brushOpacity: 1 },
        { operation: "erase" },
      ),
    ).toMatchObject({
      brushId: "kneaded-eraser",
      strokeWidth: 12,
      brushOpacity: 0.38,
    });
  });

  it("remembers recent and favorite built-in brushes", () => {
    let prefs = normalizeStudioProDrawPrefs(null);
    prefs = rememberRecentBrushId(prefs, "pen");
    prefs = rememberRecentBrushId(prefs, "marker");
    prefs = rememberRecentBrushId(prefs, "pen");
    expect(prefs.recentBrushIds[0]).toBe("pen");
    expect(prefs.recentBrushIds[1]).toBe("marker");

    prefs = toggleFavoriteBrushId(prefs, "watercolor");
    expect(prefs.favoriteBrushIds).toContain("watercolor");
    prefs = toggleFavoriteBrushId(prefs, "watercolor");
    expect(prefs.favoriteBrushIds).not.toContain("watercolor");
  });

  it("keeps optional procedural pack identities in recent and favorites", () => {
    let prefs = normalizeStudioProDrawPrefs({
      recentBrushIds: ["heart-stamp", "unknown-pack-brush"],
      favoriteBrushIds: ["hair-fiber", "not-a-brush"],
    });

    expect(prefs.recentBrushIds).toEqual(["heart-stamp"]);
    expect(prefs.favoriteBrushIds).toEqual(["hair-fiber"]);

    prefs = rememberRecentBrushId(prefs, "checker-grid");
    prefs = toggleFavoriteBrushId(prefs, "footstep-stamp");
    expect(prefs.recentBrushIds[0]).toBe("checker-grid");
    expect(prefs.favoriteBrushIds).toContain("footstep-stamp");
  });

  it("cycles only through the low-latency stabilizer steps", () => {
    expect(cycleStudioStabilizerStrength(0)).toBe(1);
    expect(cycleStudioStabilizerStrength(1)).toBe(2);
    expect(cycleStudioStabilizerStrength(2)).toBe(3);
    expect(cycleStudioStabilizerStrength(3)).toBe(0);
    expect(cycleStudioStabilizerStrength(6)).toBe(0);
    expect(cycleStudioStabilizerStrength(10)).toBe(0);
  });

  it("round-trips through storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    expect(
      saveStudioProDrawPrefs(storage, {
        ...DEFAULT_STUDIO_PRO_DRAW_PREFS,
        sizeLocked: true,
        opacityLocked: false,
        recentBrushIds: ["pen", "gpen"],
        favoriteBrushIds: ["marker"],
      })
    ).toBe(true);
    expect(loadStudioProDrawPrefs(storage)).toMatchObject({
      sizeLocked: true,
      recentBrushIds: ["pen", "gpen"],
      favoriteBrushIds: ["marker"],
    });
  });

  it("keeps a large professional favorite collection instead of silently stopping at twelve", () => {
    let prefs = normalizeStudioProDrawPrefs(null);
    const brushIds = [
      "pen",
      "gpen",
      "marker",
      "watercolor",
      "highlighter",
      "pencil",
      "airbrush",
      "oil",
      "pastel",
      "charcoal",
      "chalk",
      "crayon",
      "liner",
    ];
    for (const brushId of brushIds) prefs = toggleFavoriteBrushId(prefs, brushId);

    expect(STUDIO_FAVORITE_BRUSH_LIMIT).toBeGreaterThanOrEqual(brushIds.length);
    expect(prefs.favoriteBrushIds).toEqual(brushIds);
  });

  it("allows every currently selectable core and procedural brush to be favorited", () => {
    let prefs = normalizeStudioProDrawPrefs(null);
    const everyCatalogId = [
      ...BRUSH_PRESETS.map((preset) => preset.id),
      ...STUDIO_BRUSH_PACK_CATALOG_IDS,
    ];
    for (const brushId of everyCatalogId) {
      prefs = toggleFavoriteBrushId(prefs, brushId);
    }

    expect(STUDIO_FAVORITE_BRUSH_LIMIT).toBe(everyCatalogId.length);
    expect(prefs.favoriteBrushIds).toEqual(everyCatalogId);
    expect(prefs.favoriteBrushIds).toContain("gpen");
  });

  it("merges a favorite intent with the latest storage snapshot from another Studio tab", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
    saveStudioProDrawPrefs(storage, {
      ...DEFAULT_STUDIO_PRO_DRAW_PREFS,
      sizeLocked: true,
      opacityLocked: false,
      recentBrushIds: ["marker"],
      favoriteBrushIds: ["watercolor"],
    });

    const staleTab = normalizeStudioProDrawPrefs({
      sizeLocked: false,
      opacityLocked: false,
      recentBrushIds: ["pen"],
      favoriteBrushIds: [],
    });
    const result = mutateStudioProDrawPrefs(
      storage,
      staleTab,
      (latest) => toggleFavoriteBrushId(latest, "gpen")
    );

    expect(result.persisted).toBe(true);
    expect(result.prefs).toEqual({
      ...DEFAULT_STUDIO_PRO_DRAW_PREFS,
      sizeLocked: true,
      opacityLocked: false,
      recentBrushIds: ["marker"],
      favoriteBrushIds: ["watercolor", "gpen"],
    });
    expect(loadStudioProDrawPrefs(storage)).toEqual(result.prefs);
  });

  it("keeps an in-memory favorite when storage is unavailable", () => {
    const current = normalizeStudioProDrawPrefs({
      favoriteBrushIds: ["watercolor"],
    });
    const result = mutateStudioProDrawPrefs(
      null,
      current,
      (latest) => toggleFavoriteBrushId(latest, "gpen")
    );

    expect(result.persisted).toBe(false);
    expect(result.prefs.favoriteBrushIds).toEqual(["watercolor", "gpen"]);
  });

  it("does not resurrect stale storage after a write failure and retries the complete state", () => {
    let failWrites = true;
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new DOMException("quota exceeded", "QuotaExceededError");
        map.set(key, value);
      },
    };
    map.set(
      "toonspectrum-studio-pro-draw-prefs:v1",
      JSON.stringify(normalizeStudioProDrawPrefs({ favoriteBrushIds: ["watercolor"] })),
    );

    const failed = mutateStudioProDrawPrefs(
      storage,
      normalizeStudioProDrawPrefs(null),
      (latest) => toggleFavoriteBrushId(latest, "gpen"),
    );
    expect(failed.persisted).toBe(false);
    expect(failed.prefs.favoriteBrushIds).toEqual(["watercolor", "gpen"]);

    failWrites = false;
    const recovered = mutateStudioProDrawPrefs(
      storage,
      failed.prefs,
      (latest) => rememberRecentBrushId(latest, "marker"),
      { preferCurrent: true },
    );
    expect(recovered.persisted).toBe(true);
    expect(recovered.prefs.favoriteBrushIds).toEqual(["watercolor", "gpen"]);
    expect(loadStudioProDrawPrefs(storage)).toEqual(recovered.prefs);
  });
});

describe("brush library view persistence", () => {
  it("starts with no preference so each lane opens at its own default tab", () => {
    const fresh = normalizeStudioProDrawPrefs(null);
    expect(fresh.brushLibraryView.paint).toEqual({ tab: "", query: "", viewMode: "stroke" });
    expect(fresh.brushLibraryView.erase).toEqual({ tab: "", query: "", viewMode: "stroke" });
  });

  it("keeps paint and erase places apart", () => {
    const afterPaint = rememberStudioBrushLibraryView(
      normalizeStudioProDrawPrefs(null),
      "paint",
      { tab: "texture", query: "\uc218\ucc44" },
    );
    const afterBoth = rememberStudioBrushLibraryView(afterPaint, "erase", { tab: "all" });
    expect(afterBoth.brushLibraryView.paint).toEqual({
      tab: "texture",
      query: "\uc218\ucc44",
      viewMode: "stroke",
    });
    expect(afterBoth.brushLibraryView.erase.tab).toBe("all");
    expect(afterBoth.brushLibraryView.erase.query).toBe("");
  });

  it("returns the same object when nothing moved, so no durable write is queued", () => {
    const parked = rememberStudioBrushLibraryView(
      normalizeStudioProDrawPrefs(null),
      "paint",
      { tab: "line", query: "g", viewMode: "tile" },
    );
    expect(rememberStudioBrushLibraryView(parked, "paint", { tab: "line", query: "g", viewMode: "tile" }))
      .toBe(parked);
  });

  /**
   * A tab id that no longer exists is not corruption — the catalogue reorganises its categories,
   * and the sheet falls back to its operation default. Rejecting unknown ids here would instead
   * turn every future rename into a storage migration.
   */
  it("preserves an unknown tab id rather than treating a renamed category as malformed", () => {
    // "engines"/"pro" 는 재질 축 개편(2026-08) 에서 삭제된 실제 탭 id 다. 저장돼 있던 값이 그대로
    // 복원되고, 시트가 조용히 기본 탭으로 떨어지는 것이 의도된 동작이다(검증을 추가하지 말 것).
    for (const removedTab of ["engines", "pro"]) {
      const restored = normalizeStudioProDrawPrefs({
        brushLibraryView: { paint: { tab: removedTab, query: "", viewMode: "stroke" } },
      });
      expect(restored.brushLibraryView.paint.tab).toBe(removedTab);
    }
  });

  it("bounds and cleans restored text so storage cannot seed the search box with junk", () => {
    const restored = normalizeStudioProDrawPrefs({
      brushLibraryView: {
        paint: {
          tab: "x".repeat(STUDIO_BRUSH_LIBRARY_TAB_ID_LIMIT + 40),
          query: `${"y".repeat(STUDIO_BRUSH_LIBRARY_QUERY_LIMIT + 40)}\u0000\u001b`,
          viewMode: "hologram",
        },
      },
    });
    expect(restored.brushLibraryView.paint.tab).toHaveLength(STUDIO_BRUSH_LIBRARY_TAB_ID_LIMIT);
    expect(restored.brushLibraryView.paint.query).toHaveLength(STUDIO_BRUSH_LIBRARY_QUERY_LIMIT);
    expect(
      [...restored.brushLibraryView.paint.query].every((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f;
      }),
    ).toBe(true);
    expect(restored.brushLibraryView.paint.viewMode).toBe("stroke");
  });

  it("survives a storage round trip", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
    const parked = rememberStudioBrushLibraryView(
      normalizeStudioProDrawPrefs(null),
      "paint",
      { tab: "marker", query: "neon", viewMode: "text" },
    );
    expect(saveStudioProDrawPrefs(storage, parked)).toBe(true);
    expect(loadStudioProDrawPrefs(storage).brushLibraryView.paint).toEqual({
      tab: "marker",
      query: "neon",
      viewMode: "text",
    });
  });
});
