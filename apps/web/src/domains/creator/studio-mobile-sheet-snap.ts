import type { CSSProperties } from "react";

export const STUDIO_MOBILE_SHEET_SNAPS = ["compact", "medium", "full"] as const;

/** Shared DOM relationship between the mobile page launcher and its lazy page-list sheet. */
export const STUDIO_MOBILE_PAGES_SHEET_ID = "studio-mobile-pages-sheet";

export type StudioMobileSheetSnap = (typeof STUDIO_MOBILE_SHEET_SNAPS)[number];

/**
 * Sheets that only hold a list open at `medium`. The brush settings sheet is different: it floats
 * over the very canvas the artist is judging, so it opens at `compact` and the grabber promotes it.
 * Measured at 360×640: `medium` leaves 126 canvas rows (19.7%), `compact` leaves 190 (29.7%).
 */
export const STUDIO_MOBILE_SHEET_DEFAULT_SNAP: StudioMobileSheetSnap = "medium";
export const STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP: StudioMobileSheetSnap = "compact";

const SNAP_INDEX = new Map<StudioMobileSheetSnap, number>(
  STUDIO_MOBILE_SHEET_SNAPS.map((snap, index) => [snap, index]),
);

const SNAP_HEIGHT_DVH: Readonly<Record<StudioMobileSheetSnap, number>> = {
  compact: 34,
  medium: 58,
  full: 88,
};

const SNAP_LABEL: Readonly<Record<StudioMobileSheetSnap, string>> = {
  compact: "작게",
  medium: "중간",
  full: "크게",
};

export function studioMobileSheetSnapLabel(snap: StudioMobileSheetSnap): string {
  return SNAP_LABEL[snap];
}

export function studioMobileSheetSnapValue(snap: StudioMobileSheetSnap): number {
  return SNAP_INDEX.get(snap) ?? 0;
}

export function expandStudioMobileSheetSnap(
  snap: StudioMobileSheetSnap,
): StudioMobileSheetSnap {
  const index = SNAP_INDEX.get(snap) ?? 0;
  return STUDIO_MOBILE_SHEET_SNAPS[Math.min(index + 1, STUDIO_MOBILE_SHEET_SNAPS.length - 1)]!;
}

export function collapseStudioMobileSheetSnap(
  snap: StudioMobileSheetSnap,
): StudioMobileSheetSnap | null {
  const index = SNAP_INDEX.get(snap) ?? 0;
  return index === 0 ? null : STUDIO_MOBILE_SHEET_SNAPS[index - 1]!;
}

/** A handle tap cycles all three sizes; closing remains an explicit X or compact-down gesture. */
export function nextStudioMobileSheetSnap(
  snap: StudioMobileSheetSnap,
): StudioMobileSheetSnap {
  const index = SNAP_INDEX.get(snap) ?? 0;
  return STUDIO_MOBILE_SHEET_SNAPS[(index + 1) % STUDIO_MOBILE_SHEET_SNAPS.length]!;
}

/**
 * Floor for the brush sheet's compact snap. 34dvh is only 218px on a 360×640 phone, which fits the
 * grabber, the title row and the size slider but clips 투명도 by 36px. Keeping a pixel floor lets
 * the smallest viewport show both primary sliders while every taller phone keeps the 34dvh ratio.
 */
export const STUDIO_MOBILE_DRAW_SHEET_COMPACT_MIN_HEIGHT = "16.5rem";

export function studioMobileSheetSizeStyle(
  snap: StudioMobileSheetSnap,
  keyboardInset: number,
  minimumHeight?: string,
): Pick<CSSProperties, "height" | "maxHeight"> {
  const safeKeyboardInset = Number.isFinite(keyboardInset)
    ? Math.max(0, Math.round(keyboardInset))
    : 0;
  const requested = minimumHeight
    ? `max(${SNAP_HEIGHT_DVH[snap]}dvh, ${minimumHeight})`
    : `${SNAP_HEIGHT_DVH[snap]}dvh`;
  const height = `min(${requested}, calc(100dvh - env(safe-area-inset-top) - 0.75rem - ${safeKeyboardInset}px))`;
  return { height, maxHeight: height };
}
