import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_RAIL_TOOL_ORDER,
  DEFAULT_STUDIO_SHOW_ALIGNMENT_GUIDES,
  DEFAULT_STUDIO_SNAP_TO_PIXEL_GRID,
  defaultStudioAppSettings,
  formatStudioShortcutChord,
  hideStudioRailTool,
  listStudioShortcutConflicts,
  matchStudioShortcut,
  moveStudioRailTool,
  normalizeStudioAppSettings,
  normalizeStudioRailVisibleIds,
  normalizeStudioShortcutChordKey,
  parseStudioShortcutChord,
  showStudioRailTool,
  studioRailHiddenIds,
  STUDIO_APP_SETTINGS_TABS,
  STUDIO_RAIL_TOOL_CATALOG,
  STUDIO_SHORTCUT_ACTIONS,
} from "./studio-app-settings";

describe("studio-app-settings", () => {
  it("defaults include all settings tabs and full rail order", () => {
    expect(STUDIO_APP_SETTINGS_TABS).toEqual([
      "general",
      "shortcuts",
      "mouse",
      "touch",
      "toolbar",
      "grids",
      "other",
    ]);
    const d = defaultStudioAppSettings();
    expect(d.toolbar.visibleIds).toEqual(DEFAULT_STUDIO_RAIL_TOOL_ORDER);
    expect(Object.keys(d.shortcuts).length).toBe(STUDIO_SHORTCUT_ACTIONS.length);
    expect(d.shortcuts["toggle-chrome"]).toBe("`");
    expect(d.shortcuts["flip-canvas"]).toBe("H");
    expect(STUDIO_RAIL_TOOL_CATALOG.find(({ id }) => id === "hand")?.defaultShortcut).toBe("Space");
    expect(STUDIO_RAIL_TOOL_CATALOG.find(({ id }) => id === "zoom-fit")).toMatchObject({
      label: "너비에 맞춤",
      defaultShortcut: "Home",
    });
    expect(d.general.toolHintMode).toBe("rich");
    expect(d.general.showStrokeGuide).toBe(false);
    expect(d.touch.toolHintHoldMs).toBe(480);
    expect(d.mouse.wheel).toBe("zoom");
    expect(d.touch.oneFingerDrag).toBe("draw");
    expect(d.grids.showCanvasRulers).toBe(false);
    expect(d.grids.snapToPixelGrid).toBe(DEFAULT_STUDIO_SNAP_TO_PIXEL_GRID);
    expect(d.grids.showAlignmentGuides).toBe(DEFAULT_STUDIO_SHOW_ALIGNMENT_GUIDES);
  });

  it("migrates legacy settings to a visible stroke guide and preserves an explicit opt-out", () => {
    expect(normalizeStudioAppSettings({ general: {} }).general.showStrokeGuide).toBe(false);
    expect(
      normalizeStudioAppSettings({
        general: { showStrokeGuide: false },
      }).general.showStrokeGuide
    ).toBe(false);
  });

  it("keeps the new selection, retouch, and view tools aligned across both catalogs", () => {
    const expected = [
      { railId: "blend", actionId: "tool-blend", label: "문지르기", shortcut: "N" },
      { railId: "liquify", actionId: "tool-liquify", label: "리퀴파이", shortcut: "J" },
      { railId: "marquee-circle", actionId: "tool-marquee-circle", label: "원형 선택", shortcut: "Shift+M" },
      { railId: "crop", actionId: "tool-crop", label: "자르기", shortcut: "C" },
      { railId: "comment", actionId: "tool-comment", label: "위치 댓글", shortcut: "Alt+C" },
      { railId: "zoom", actionId: "tool-zoom", label: "보기 확대·축소", shortcut: "Z" },
      { railId: "rotate-view", actionId: "tool-rotate-view", label: "보기 회전", shortcut: "R" },
    ] as const;
    const defaults = defaultStudioAppSettings();

    expect(new Set(STUDIO_RAIL_TOOL_CATALOG.map(({ id }) => id)).size).toBe(
      STUDIO_RAIL_TOOL_CATALOG.length
    );
    expect(new Set(STUDIO_SHORTCUT_ACTIONS.map(({ id }) => id)).size).toBe(
      STUDIO_SHORTCUT_ACTIONS.length
    );
    expect(
      DEFAULT_STUDIO_RAIL_TOOL_ORDER.filter((id) =>
        expected.some(({ railId }) => railId === id)
      )
    ).toEqual(expected.map(({ railId }) => railId));

    for (const item of expected) {
      expect(STUDIO_RAIL_TOOL_CATALOG.find(({ id }) => id === item.railId)).toMatchObject({
        label: item.label,
        defaultShortcut: item.shortcut,
      });
      expect(STUDIO_SHORTCUT_ACTIONS.find(({ id }) => id === item.actionId)).toMatchObject({
        label: item.label,
        defaultKeys: item.shortcut,
      });
      expect(defaults.shortcuts[item.actionId]).toBe(item.shortcut);
    }

    expect(
      matchStudioShortcut(defaults.shortcuts["tool-marquee-circle"], {
        key: "m",
        shiftKey: true,
      })
    ).toBe(true);
    expect(
      matchStudioShortcut(defaults.shortcuts["tool-marquee-circle"], {
        key: "m",
        shiftKey: false,
      })
    ).toBe(false);
    expect(STUDIO_RAIL_TOOL_CATALOG.find(({ id }) => id === "text")?.defaultShortcut).toBe("T");
    expect(STUDIO_RAIL_TOOL_CATALOG.find(({ id }) => id === "bubble")?.defaultShortcut).toBe("T");
    expect(STUDIO_SHORTCUT_ACTIONS.find(({ id }) => id === "tool-lettering")).toMatchObject({
      label: "레터링(텍스트·말풍선)",
      defaultKeys: "T",
    });
    expect(defaults.shortcuts["tool-lettering"]).toBe("T");
    expect(
      matchStudioShortcut(defaults.shortcuts["tool-comment"], {
        key: "ç",
        code: "KeyC",
        altKey: true,
      })
    ).toBe(true);
    expect(matchStudioShortcut("B", { key: "x", code: "KeyB" })).toBe(false);
  });

  it("adds new shortcut defaults when normalizing a legacy shortcut payload", () => {
    const normalized = normalizeStudioAppSettings({
      shortcuts: { "tool-pen": "K" },
    });

    expect(normalized.shortcuts).toMatchObject({
      "tool-pen": "K",
      "tool-marquee-circle": "Shift+M",
      "tool-crop": "C",
      "tool-comment": "Alt+C",
      "tool-blend": "N",
      "tool-liquify": "J",
      "tool-lettering": "T",
      "tool-zoom": "Z",
      "tool-rotate-view": "R",
    });
  });

  it("normalizes broken payloads without throwing", () => {
    const n = normalizeStudioAppSettings({
      general: { densityMode: "nope", toolHintMode: "cinema", showToolHints: "x" },
      toolbar: { visibleIds: ["pen", "pen", "ghost", "eraser"] },
      grids: { pixelGridSize: 47 },
      other: { pressureCurve: 99 },
      shortcuts: { "tool-pen": " P " },
    });
    expect(n.general.densityMode).toBe("full");
    expect(n.general.toolHintMode).toBe("rich");
    expect(n.toolbar.visibleIds).toEqual(["pen", "eraser"]);
    expect(n.grids.pixelGridSize).toBe(50);
    expect(n.grids.showCanvasRulers).toBe(false);
    expect(
      normalizeStudioAppSettings({ grids: { showCanvasRulers: true } }).grids
        .showCanvasRulers
    ).toBe(true);
    expect(n.other.pressureCurve).toBe(2.5);
    expect(n.shortcuts["tool-pen"]).toBe("P");
    expect(normalizeStudioAppSettings({ shortcuts: { "toggle-chrome": "Tab" } }).shortcuts["toggle-chrome"]).toBe("`");
  });

  it("migrates legacy tool-hint settings and clamps the touch hold delay", () => {
    expect(normalizeStudioAppSettings({ general: { showToolHints: false } }).general.toolHintMode).toBe(
      "off"
    );
    expect(
      normalizeStudioAppSettings({
        general: { toolHintMode: "compact" },
        touch: { toolHintHoldMs: 111 },
      }).general.toolHintMode
    ).toBe("compact");
    expect(normalizeStudioAppSettings({ touch: { toolHintHoldMs: 111 } }).touch.toolHintHoldMs).toBe(
      300
    );
    expect(normalizeStudioAppSettings({ touch: { toolHintHoldMs: 999 } }).touch.toolHintHoldMs).toBe(
      900
    );
  });

  it("rail hide/show/move preserve at least one tool", () => {
    const only = hideStudioRailTool(["pen"], "pen");
    expect(only).toEqual(DEFAULT_STUDIO_RAIL_TOOL_ORDER);
    let list = normalizeStudioRailVisibleIds(["select", "pen", "eraser"]);
    list = moveStudioRailTool(list, "pen", -1);
    expect(list[0]).toBe("pen");
    list = hideStudioRailTool(list, "eraser");
    expect(list).not.toContain("eraser");
    expect(studioRailHiddenIds(list)).toContain("eraser");
    list = showStudioRailTool(list, "eraser");
    expect(list.at(-1)).toBe("eraser");
  });

  it("shortcut chords parse and match events", () => {
    expect(parseStudioShortcutChord("Mod+Shift+Z")).toEqual({
      key: "Z",
      mod: true,
      shift: true,
      alt: false,
    });
    expect(
      matchStudioShortcut("B", { key: "b", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(true);
    expect(
      matchStudioShortcut("Mod+D", { key: "d", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(true);
    expect(
      matchStudioShortcut("Mod+D", { key: "d", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(false);
    expect(formatStudioShortcutChord("Mod+Shift+I")).toContain("⌘");
  });

  it("remaps canvas flip without retaining a hidden hard-coded H binding", () => {
    const shortcuts = { ...defaultStudioAppSettings().shortcuts, "flip-canvas": "K" };
    expect(matchStudioShortcut(shortcuts["flip-canvas"], { key: "k", code: "KeyK" })).toBe(true);
    expect(matchStudioShortcut(shortcuts["flip-canvas"], { key: "h", code: "KeyH" })).toBe(false);
  });

  it("exposes configured chord conflicts so dispatch priority can remain deterministic", () => {
    const shortcuts = {
      ...defaultStudioAppSettings().shortcuts,
      "tool-pen": "K",
      "flip-canvas": "K",
    };
    const matches = STUDIO_SHORTCUT_ACTIONS
      .filter(({ id }) => matchStudioShortcut(shortcuts[id], { key: "k", code: "KeyK" }))
      .map(({ id }) => id);
    expect(matches).toEqual(["tool-pen", "flip-canvas"]);
  });

  it("listStudioShortcutConflicts maps multi-bound chords and skips empty/unbound", () => {
    expect(listStudioShortcutConflicts(defaultStudioAppSettings().shortcuts).size).toBe(1);

    const shortcuts = {
      ...defaultStudioAppSettings().shortcuts,
      "tool-pen": "K",
      "flip-canvas": "k",
      "tool-eraser": "",
      "swap-colors": "  ",
      "toggle-chrome": "Mod+Shift+z",
      redo: "mod+shift+Z",
    };
    const conflicts = listStudioShortcutConflicts(shortcuts);
    expect(conflicts.get("K")).toEqual(["tool-pen", "flip-canvas"]);
    expect(conflicts.get("Mod+Shift+Z")).toEqual(["redo", "toggle-chrome"]);
    expect(conflicts.has("E")).toBe(false);
    expect(normalizeStudioShortcutChordKey("BracketLeft")).toBe("[");
    expect(normalizeStudioShortcutChordKey("")).toBeNull();
  });

  it("matches Backquote / Space physical codes for registry chords", () => {
    expect(matchStudioShortcut("`", { code: "Backquote" })).toBe(true);
    expect(matchStudioShortcut("`", { key: "`" })).toBe(true);
    expect(matchStudioShortcut("Space", { code: "Space" })).toBe(true);
  });
});
