/**
 * Marker-family nib footprints.
 *
 * The catalogue sells four markers, and a marker is defined by its nib: a chisel wedge for the
 * sketch/copic/broad markers and a bullet dome for a felt pen. The runtime carried none of that.
 * `marker`, `felt-tip`, `marker-bold` and `alcohol-marker` were declared in
 * `studio-brush-runtime-contract.ts` with `canonicalId: "pen"`, `tip: "round"`, `texture: "none"`
 * and reached the canvas through the same round causal-ink dab as a ballpoint — only wider and
 * more transparent. A 770 px measurement showed exactly that: a perfectly uniform round grey bar
 * whose horizontal and vertical widths matched to 1 %.
 *
 * A nib is a *paint-time footprint*, not a plan change. The dab centres, radii and pressure
 * response `planStudioCausalInk` produces are untouched — every geometry, replay, export and
 * pressure contract keeps its exact numbers — and only the shape stamped at each centre changes.
 * Brushes with no entry here keep the round dab, so pens are bit-identical by construction.
 */

export interface StudioMarkerNibProfile {
  readonly id: string;
  /** Minor/major axis of the wedge. 1 is the round dab the engine used to stamp everywhere. */
  readonly aspect: number;
  /** Orientation of the nib's long axis in canvas space; a marker does not rotate with travel. */
  readonly angleDeg: number;
}

const STUDIO_MARKER_NIB_PROFILES: Readonly<Record<string, StudioMarkerNibProfile>> = {
  // Sketch marker: the classic wedge held at a shallow angle, thin on the diagonal it is drawn
  // along and broad across it.
  marker: { id: "marker", aspect: 0.62, angleDeg: -35 },
  // Broad chisel for filling areas — the widest nib in the family, so the flattest wedge.
  "marker-bold": { id: "marker-bold", aspect: 0.5, angleDeg: -35 },
  // Alcohol/copic chisel: slightly rounder than the broad marker, same working angle.
  "alcohol-marker": { id: "alcohol-marker", aspect: 0.58, angleDeg: -35 },
  // A felt pen is a bullet tip: domed, very nearly round, with just enough ovality to keep an
  // outline from reading as a machine-drawn tube.
  "felt-tip": { id: "felt-tip", aspect: 0.88, angleDeg: -35 },
};

export function resolveStudioMarkerNibProfile(
  brushId: unknown,
): StudioMarkerNibProfile | null {
  return typeof brushId === "string"
    ? STUDIO_MARKER_NIB_PROFILES[brushId] ?? null
    : null;
}

/** Paint-time nib footprint consumed by the causal-ink rasteriser. */
export interface StudioCausalInkNib {
  readonly aspect: number;
  readonly angleRad: number;
}

export function resolveStudioCausalInkNib(brushId: unknown): StudioCausalInkNib | undefined {
  const profile = resolveStudioMarkerNibProfile(brushId);
  return profile
    ? { aspect: profile.aspect, angleRad: (profile.angleDeg * Math.PI) / 180 }
    : undefined;
}
