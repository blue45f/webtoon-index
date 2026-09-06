/** Geometry for a body-portalled menu; all values use layout CSS pixels. */
export interface StudioMainMenuViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioMainMenuCoords {
  readonly top: number;
  readonly left: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly side: "top" | "bottom";
}

interface TriggerRect {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readStudioMainMenuViewport(
  view: Window | null = typeof window === "undefined" ? null : window,
): StudioMainMenuViewport {
  return {
    left: view?.visualViewport?.offsetLeft ?? 0,
    top: view?.visualViewport?.offsetTop ?? 0,
    width: view?.visualViewport?.width ?? view?.innerWidth ?? 1024,
    height: view?.visualViewport?.height ?? view?.innerHeight ?? 768,
  };
}

/**
 * Prefer the familiar below-trigger placement. Flip upwards only when below
 * has less than a useful 240px and above offers more room. 240px is a preference,
 * NEVER a floor that can push the menu past a keyboard or a short viewport.
 * Top placement uses translateY(-100%), so short menus stay attached to the
 * trigger without measuring their content or reserving an empty 240px box.
 */
export function resolveStudioMainMenuCoords(
  trigger: TriggerRect,
  viewport: StudioMainMenuViewport,
): StudioMainMenuCoords {
  const width = Math.max(1, finite(viewport.width, 1024));
  const height = Math.max(1, finite(viewport.height, 768));
  const x = finite(viewport.left, 0);
  const y = finite(viewport.top, 0);
  const marginX = Math.min(8, width / 4);
  const marginY = Math.min(12, height / 4);
  const leftEdge = x + marginX;
  const rightEdge = x + width - marginX;
  const topEdge = y + marginY;
  const bottomEdge = y + height - marginY;
  const preferredWidth = Math.min(rightEdge - leftEdge, Math.max(248, finite(trigger.width, 0) + 48));
  const left = clamp(finite(trigger.left, leftEdge), leftEdge, rightEdge - preferredWidth);
  const maxWidth = rightEdge - left;
  // Subtracting fractional viewport offsets can lose an ulp; min must not exceed max.
  const minWidth = Math.min(preferredWidth, maxWidth);
  const belowTop = clamp(finite(trigger.bottom, topEdge) + 6, topEdge, bottomEdge);
  const aboveBottom = clamp(finite(trigger.top, topEdge) - 6, topEdge, bottomEdge);
  const below = bottomEdge - belowTop;
  const above = aboveBottom - topEdge;
  const side = below < 240 && above > below ? "top" : "bottom";
  // An oversized/offscreen trigger can cover the entire visible viewport.
  // Keep commands reachable by using the safe viewport, not a zero-height box.
  if (below === 0 && above === 0) {
    return { top: topEdge, left, minWidth, maxWidth, maxHeight: bottomEdge - topEdge, side: "bottom" };
  }
  return {
    top: side === "top" ? aboveBottom : belowTop,
    left,
    minWidth,
    maxWidth,
    maxHeight: side === "top" ? above : below,
    side,
  };
}

export function studioMainMenuCoordsEqual(a: StudioMainMenuCoords, b: StudioMainMenuCoords): boolean {
  return a.top === b.top && a.left === b.left && a.minWidth === b.minWidth
    && a.maxWidth === b.maxWidth && a.maxHeight === b.maxHeight && a.side === b.side;
}

/** Reveal only within the menu. scrollIntoView could also move the canvas/page. */
export function revealStudioMainMenuItem(
  item: HTMLElement | null,
  menu: HTMLElement | null,
): void {
  if (!item || !menu || !menu.contains(item) || menu.clientHeight <= 0) return;
  const bounds = menu.getBoundingClientRect();
  const row = item.getBoundingClientRect();
  const padding = Math.min(4, Math.max(0, (menu.clientHeight - row.height) / 2));
  const top = bounds.top + menu.clientTop + padding;
  const bottom = bounds.top + menu.clientTop + menu.clientHeight - padding;
  const delta = row.top < top || row.height > bottom - top
    ? row.top - top
    : row.bottom > bottom ? row.bottom - bottom : 0;
  if (delta !== 0) menu.scrollTop += delta;
}
