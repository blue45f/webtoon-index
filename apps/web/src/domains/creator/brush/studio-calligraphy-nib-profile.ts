/**
 * Per-brush calligraphy nib profiles.
 *
 * `buildCalligraphySegments` projects an elliptical nib onto the travel normal, so the width of a
 * calligraphy stroke is entirely decided by two numbers: the nib's long-axis angle and its
 * roundness (minor/major). Those two numbers used to reach the renderer from ONE place — the tip
 * controls in the Draw inspector — and `planStudioDrawPointerStart` attached them only when the
 * selected brush id was literally `"calligraphy"`. Every other brush in the family therefore fell
 * back to `DEFAULT_CALLIGRAPHY_SETTINGS` (45°, roundness 0.32), and 45° is precisely the angle at
 * which a chisel is symmetric about the horizontal and vertical axes: a measured horizontal and a
 * measured vertical stroke came out the same width (ratio 1.00) for `fountain-pen`,
 * `parallel-pen` and `brush-pen`, while the tool-controlled `calligraphy` brush measured 0.61.
 *
 * A nib is a property of the pen, not of a global slider. This table gives each family member the
 * nib it is sold as, and leaves `calligraphy` — the brush whose whole purpose is a user-adjustable
 * tip — under inspector control.
 */

import type { CalligraphyTipSettings } from "../studio-brush";

export interface StudioCalligraphyNibProfile extends CalligraphyTipSettings {
  readonly id: string;
}

/**
 * Angles are the direction of the nib's LONG axis, matching `buildCalligraphySegments`:
 * travel parallel to that axis projects to `roundness`, travel across it projects to 1.
 */
const STUDIO_CALLIGRAPHY_NIB_PROFILES: Readonly<
  Record<string, StudioCalligraphyNibProfile>
> = {
  // Broad-edge italic nib. The edge is held flat, so uprights carry the full width of the nib and
  // horizontals reduce to its thickness — the defining behaviour of gothic/italic lettering and
  // the reason this brush exists next to `calligraphy`.
  "parallel-pen": { id: "parallel-pen", tiltEnabled: true, angleDeg: 0, roundness: 0.16 },
  // Oblique fountain nib: a real slant, but a writing tool rather than a lettering chisel, so the
  // contrast stays legible at small sizes instead of dropping strokes.
  "fountain-pen": { id: "fountain-pen", tiltEnabled: true, angleDeg: 30, roundness: 0.5 },
  // A hair brush is round in section; its character is pressure and taper, not a flat edge.
  "brush-pen": { id: "brush-pen", tiltEnabled: true, angleDeg: 0, roundness: 0.92 },
};

/** The nib a brush is sold with, or `null` when the tip is under inspector control. */
export function resolveStudioCalligraphyNibProfile(
  brushId: unknown,
): StudioCalligraphyNibProfile | null {
  return typeof brushId === "string"
    ? STUDIO_CALLIGRAPHY_NIB_PROFILES[brushId] ?? null
    : null;
}

/**
 * Tip settings a calligraphy-family stroke should be authored with.
 *
 * `inspectorTip` wins only for the brush that exposes the tip controls; every other member keeps
 * its own nib so two different pens cannot silently become the same pen.
 */
export function resolveStudioCalligraphyAuthoringTip(
  brushId: unknown,
  inspectorTip: CalligraphyTipSettings,
): CalligraphyTipSettings | undefined {
  if (brushId === "calligraphy") return { ...inspectorTip };
  const profile = resolveStudioCalligraphyNibProfile(brushId);
  if (!profile) return undefined;
  return {
    tiltEnabled: profile.tiltEnabled,
    angleDeg: profile.angleDeg,
    roundness: profile.roundness,
  };
}

/**
 * Tip settings a stored stroke should be RENDERED with.
 *
 * Documents authored before the nib table existed carry no `brushTip`, and re-opening one must not
 * show a different pen than the catalogue advertises. Canvas and SVG both resolve through here so
 * the two renderers cannot disagree.
 */
export function resolveStudioCalligraphyRenderTip(
  brushId: unknown,
  storedTip: CalligraphyTipSettings | undefined,
): CalligraphyTipSettings | undefined {
  if (storedTip) return storedTip;
  const profile = resolveStudioCalligraphyNibProfile(brushId);
  if (!profile) return undefined;
  return {
    tiltEnabled: profile.tiltEnabled,
    angleDeg: profile.angleDeg,
    roundness: profile.roundness,
  };
}
