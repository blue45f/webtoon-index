// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readStudioMainMenuViewport,
  resolveStudioMainMenuCoords,
  revealStudioMainMenuItem,
  studioMainMenuCoordsEqual,
} from "./studio-main-menu-viewport";
import mainMenuSource from "./StudioMainMenu.tsx?raw";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const normalViewport = { left: 0, top: 0, width: 1440, height: 900 };
const trigger = { left: 100, top: 10, bottom: 42, width: 64 };

function geometry(element: HTMLElement, top: number, height: number): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0, y: top, left: 0, right: 200, top, bottom: top + height,
    width: 200, height, toJSON: () => ({}),
  });
}

function scroller(rowTop: number, rowHeight = 30) {
  const menu = document.createElement("div");
  const item = document.createElement("button");
  menu.append(item);
  document.body.append(menu);
  Object.defineProperty(menu, "clientHeight", { value: 100 });
  Object.defineProperty(menu, "clientTop", { value: 1 });
  geometry(menu, 20, 102);
  geometry(item, rowTop, rowHeight);
  return { menu, item };
}

describe("Studio main menu viewport geometry", () => {
  it("preserves below-trigger placement when enough room exists", () => {
    const result = resolveStudioMainMenuCoords(trigger, normalViewport);
    expect(result).toEqual({ top: 48, left: 100, minWidth: 248, maxWidth: 1332, maxHeight: 840, side: "bottom" });
  });

  it("does not force a 240px panel into less available height", () => {
    const result = resolveStudioMainMenuCoords(trigger, { ...normalViewport, height: 180 });
    expect(result.side).toBe("bottom");
    expect(result.maxHeight).toBe(120);
  });

  it("flips upward near the bottom without assuming content height", () => {
    const result = resolveStudioMainMenuCoords({ ...trigger, top: 250, bottom: 282 }, { ...normalViewport, height: 300 });
    expect(result.side).toBe("top");
    expect(result.top).toBe(244);
    expect(result.maxHeight).toBe(232);
  });

  it("shrinks width and moves away from a narrow right edge", () => {
    const result = resolveStudioMainMenuCoords({ ...trigger, left: 180 }, { ...normalViewport, width: 200 });
    expect(result.left).toBe(8);
    expect(result.minWidth).toBe(184);
    expect(result.maxWidth).toBe(184);
  });

  it("contains natural menu width rather than only its minimum width", () => {
    const result = resolveStudioMainMenuCoords({ ...trigger, left: 900 }, normalViewport);
    expect(result.left + result.maxWidth).toBe(1432);
  });

  it("respects visual-viewport offsets during zoom/pan/keyboard changes", () => {
    const result = resolveStudioMainMenuCoords({ left: 400, top: 96, bottom: 128, width: 64 }, { left: 100, top: 80, width: 200, height: 160 });
    expect(result.left).toBe(108);
    expect(result.top).toBe(134);
    expect(result.maxHeight).toBe(94);
    expect(result.left + result.maxWidth).toBe(292);
  });

  it("retains a usable box when an offscreen trigger covers the viewport", () => {
    const result = resolveStudioMainMenuCoords({ ...trigger, top: -1000, bottom: 1000 }, normalViewport);
    expect(result.top).toBe(12);
    expect(result.maxHeight).toBe(876);
  });

  it.each([1, 10, 160, 320, 768, 1440])("keeps finite positive dimensions at %spx", (size) => {
    const result = resolveStudioMainMenuCoords(trigger, { left: 7, top: 19, width: size, height: size });
    expect(result.minWidth).toBeGreaterThan(0);
    expect(result.maxHeight).toBeGreaterThan(0);
    expect(result.left).toBeGreaterThanOrEqual(7);
    expect(result.left + result.maxWidth).toBeLessThanOrEqual(7 + size);
    const top = result.side === "top" ? result.top - result.maxHeight : result.top;
    expect(top).toBeGreaterThanOrEqual(19);
    expect(top + result.maxHeight).toBeLessThanOrEqual(19 + size);
  });

  it("does not let fractional rounding invert minimum and maximum width", () => {
    const result = resolveStudioMainMenuCoords(
      { left: 1152.9336945865928, top: -295.59672209229166, bottom: 185.25230483396552, width: 352.9458974268967 },
      { left: 365.62624926009505, top: 280.37131441774375, width: 1004.4070950948666, height: 198.28544456757857 },
    );
    expect(result.minWidth).toBeLessThanOrEqual(result.maxWidth);
  });

  it("normalizes non-finite measurements", () => {
    const result = resolveStudioMainMenuCoords({ left: NaN, top: Infinity, bottom: NaN, width: Infinity }, { left: NaN, top: Infinity, width: NaN, height: Infinity });
    for (const value of [result.top, result.left, result.minWidth, result.maxWidth, result.maxHeight]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("provides deterministic SSR fallback measurements", () => {
    expect(readStudioMainMenuViewport(null)).toEqual({ left: 0, top: 0, width: 1024, height: 768 });
  });

  it("compares every geometry field to avoid redundant updates", () => {
    const coords = resolveStudioMainMenuCoords(trigger, normalViewport);
    expect(studioMainMenuCoordsEqual(coords, { ...coords })).toBe(true);
    expect(studioMainMenuCoordsEqual(coords, { ...coords, maxHeight: 400 })).toBe(false);
    expect(studioMainMenuCoordsEqual(coords, { ...coords, side: "top" })).toBe(false);
  });
});

describe("Studio menu-local focus reveal", () => {
  it("reveals a lower row by scrolling only its menu", () => {
    const { menu, item } = scroller(200);
    revealStudioMainMenuItem(item, menu);
    expect(menu.scrollTop).toBe(113);
  });

  it("reveals an upper row without moving another ancestor", () => {
    const { menu, item } = scroller(0);
    menu.scrollTop = 100;
    revealStudioMainMenuItem(item, menu);
    expect(menu.scrollTop).toBe(75);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("does not move a fully visible row", () => {
    const { menu, item } = scroller(40);
    revealStudioMainMenuItem(item, menu);
    expect(menu.scrollTop).toBe(0);
  });

  it("aligns an oversized row to its leading edge", () => {
    const { menu, item } = scroller(200, 150);
    revealStudioMainMenuItem(item, menu);
    expect(menu.scrollTop).toBe(179);
  });

  it("ignores missing, foreign, or unlaid-out rows", () => {
    const { menu } = scroller(40);
    const other = document.createElement("button");
    revealStudioMainMenuItem(other, menu);
    revealStudioMainMenuItem(null, menu);
    revealStudioMainMenuItem(other, null);
    expect(menu.scrollTop).toBe(0);
  });

  it("wires viewport sizing, keyboard reveal and IME boundaries into the actual menu", () => {
    expect(mainMenuSource).toContain('from "./studio-main-menu-viewport"');
    expect(mainMenuSource).toContain('visualViewport?.addEventListener("resize", onReposition)');
    expect(mainMenuSource).toContain('visualViewport?.removeEventListener("scroll", onReposition)');
    expect(mainMenuSource).toContain("maxWidth: coords.maxWidth");
    expect(mainMenuSource).toContain('coords.side === "top" ? "translateY(-100%)"');
    expect(mainMenuSource).toContain("revealStudioMainMenuItem(itemRefs.current[nextIndex]");
    expect(mainMenuSource).toContain("event.nativeEvent.isComposing");
    expect(mainMenuSource).toContain('event.key === "ArrowUp" ? "last" : "first"');
    expect(mainMenuSource).toContain("pointer-coarse:min-h-11");
    expect(mainMenuSource).not.toContain("STUDIO_MAIN_MENU_MIN_HEIGHT");
  });
});
