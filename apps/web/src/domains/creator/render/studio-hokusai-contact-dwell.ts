/**
 * Contact dwell recovery for zero-travel natural-media gestures.
 *
 * A natural-media carrier deposits dabs from *travel*, never from the mere fact that a stroke
 * started: `dabs_per_actual_radius` / `dabs_per_basic_radius` are distance driven, and only the
 * pencil preset carries a time driven `dabs_per_second`. The Hokusai canvas already pumps a short
 * idle tail inside `finishStroke`, but it stops as soon as the slow-tracking lag is resolved, which
 * for a stationary contact is immediately. A deliberate tap therefore composes zero pixels, the
 * canonical finish has no bounds to read, and the whole stroke falls back to its exact vector while
 * shouting an engine error at the artist.
 *
 * Pressing a pencil, a charcoal stick or a loaded brush onto paper and lifting it leaves a mark, so
 * the tap is a real gesture and not an error. This module plans the smallest deterministic input
 * that makes the carrier deposit that mark: the contact point is replayed as a bounded micro-orbit
 * whose radius is a fraction of the dab radius, so every preset accumulates distance (and pencil
 * additionally accumulates time) while the composed mark stays centred on the contact point.
 *
 * The plan is a pure function of the stroke's own admitted config and its observed samples, so the
 * recovery replays identically for the same seed. It is consumed only when a stroke composed no
 * pixels at all, so no stroke that already rendered can have its geometry changed by it.
 */

export const STUDIO_HOKUSAI_CONTACT_DWELL_POLICY_VERSION =
  "hokusai-contact-dwell-v1" as const;

/** One full revolution plus the closing sample, enough travel for every admitted preset. */
export const STUDIO_HOKUSAI_CONTACT_DWELL_STEPS = 16 as const;
/** ~8ms per step keeps the pencil's `dabs_per_second` contribution in a plausible tap duration. */
export const STUDIO_HOKUSAI_CONTACT_DWELL_STEP_MILLISECONDS = 8 as const;
/** Orbit radius as a fraction of the dab radius; keeps the composed mark a point, not a ring. */
export const STUDIO_HOKUSAI_CONTACT_DWELL_RADIUS_FACTOR = 0.25 as const;
/** Sub-pixel orbits are swallowed by tracking-noise coalescing, so never plan below this. */
export const STUDIO_HOKUSAI_CONTACT_DWELL_MIN_RADIUS_PIXELS = 0.75 as const;
/**
 * Contact weight for a pressureless input channel.
 *
 * A mouse (and the pointer-down frame of several stylus drivers) reports `pressure === 0` for the
 * whole gesture, and the live-brush protocol already substitutes 0.5 wherever a sample carries no
 * pressure at all. A dwell that trusted the literal zero would render nothing for every mouse tap,
 * so an all-zero stroke reuses that same canonical substitute instead of planning nothing.
 */
export const STUDIO_HOKUSAI_CONTACT_DWELL_PRESSURELESS_CONTACT = 0.5 as const;

export interface StudioHokusaiContactDwellSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeMilliseconds: number;
}

export interface StudioHokusaiContactDwellInput {
  /** Stroke-local samples already accepted by the engine, in arrival order. */
  readonly samples: readonly StudioHokusaiContactDwellSample[];
  readonly radiusPixels: number;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Plan the deterministic contact dwell for a stroke that composed no pixels, or `null` when the
 * stroke carries no usable contact at all — no samples, a non-finite position or time, or an
 * unusable surface/radius. A `null` plan deliberately leaves the caller on its exact-vector
 * fallback instead of guessing where the artist touched down.
 */
export function planStudioHokusaiContactDwell(
  input: StudioHokusaiContactDwellInput,
): readonly StudioHokusaiContactDwellSample[] | null {
  const contact = input.samples.at(-1);
  if (
    !contact
    || !Number.isFinite(contact.x)
    || !Number.isFinite(contact.y)
    || !Number.isFinite(contact.timeMilliseconds)
    || !Number.isFinite(input.radiusPixels)
    || input.radiusPixels <= 0
    || !Number.isFinite(input.surfaceWidth)
    || !Number.isFinite(input.surfaceHeight)
    || input.surfaceWidth <= 1
    || input.surfaceHeight <= 1
  ) return null;
  // The artist's own peak pressure owns the mark's weight, so a feather-light stylus tap stays
  // feather-light. Only a channel that reported no pressure anywhere falls back to the protocol's
  // canonical pressureless contact.
  let peak = 0;
  for (const sample of input.samples) {
    if (Number.isFinite(sample.pressure) && sample.pressure > peak) peak = sample.pressure;
  }
  const pressure = peak > 0
    ? Math.min(1, peak)
    : STUDIO_HOKUSAI_CONTACT_DWELL_PRESSURELESS_CONTACT;

  const orbit = Math.max(
    STUDIO_HOKUSAI_CONTACT_DWELL_MIN_RADIUS_PIXELS,
    input.radiusPixels * STUDIO_HOKUSAI_CONTACT_DWELL_RADIUS_FACTOR,
  );
  const maximumX = input.surfaceWidth - 1;
  const maximumY = input.surfaceHeight - 1;
  const tiltX = Number.isFinite(contact.tiltX) ? contact.tiltX : 0;
  const tiltY = Number.isFinite(contact.tiltY) ? contact.tiltY : 0;
  const samples: StudioHokusaiContactDwellSample[] = [];
  for (let step = 0; step <= STUDIO_HOKUSAI_CONTACT_DWELL_STEPS; step += 1) {
    const angle = (step / STUDIO_HOKUSAI_CONTACT_DWELL_STEPS) * Math.PI * 2;
    samples.push({
      x: clamp(contact.x + Math.cos(angle) * orbit, 0, maximumX),
      y: clamp(contact.y + Math.sin(angle) * orbit, 0, maximumY),
      pressure,
      tiltX,
      tiltY,
      timeMilliseconds:
        contact.timeMilliseconds
        + (step + 1) * STUDIO_HOKUSAI_CONTACT_DWELL_STEP_MILLISECONDS,
    });
  }
  return samples;
}
