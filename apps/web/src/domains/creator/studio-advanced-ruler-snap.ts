/**
 * Studio Advanced Ruler Snap Dispatch
 *
 * One kind-agnostic entry point that projects a raw stroke sample onto whichever advanced ruler
 * owns snapping. It owns the per-stroke session lifecycle for every ruler kind: reuse the caller's
 * previous state while the same ruler keeps the stroke, lazily begin a session at the first
 * sample, and hand back the immutable follow-up state. The page shell only stores the opaque
 * state in a ref and forwards samples, so new ruler kinds never require page changes again.
 *
 * Positions are the only thing rewritten; pressure, tilt and timestamp attributes of the original
 * samples stay untouched by construction because callers pass bare `{x, y}` targets.
 */

import {
  beginStudioConcentricSnapSession,
  beginStudioParallelSnapSession,
  beginStudioRadialSnapSession,
  snapStudioConcentricPoint,
  snapStudioParallelPoint,
  snapStudioRadialPoint,
  type StudioConcentricSnapSession,
  type StudioParallelSnapSession,
  type StudioRadialSnapSession,
} from "./studio-advanced-ruler-guide-snap";
import {
  beginStudioCurveSnapSession,
  snapStudioCurvePoint,
  type StudioCurveSnapSession,
} from "./studio-curve-ruler";
import {
  beginStudioFisheyeSnapSession,
  snapStudioFisheyePoint,
  type StudioFisheyeSnapSession,
} from "./studio-fisheye-ruler";

import type { StudioAdvancedRuler } from "./studio-advanced-ruler-document";

export type StudioAdvancedRulerSnapState =
  | { type: "curve"; session: StudioCurveSnapSession }
  | { type: "fisheye"; session: StudioFisheyeSnapSession }
  | { type: "parallel"; session: StudioParallelSnapSession }
  | { type: "concentric"; session: StudioConcentricSnapSession }
  | { type: "radial"; session: StudioRadialSnapSession };

export interface StudioAdvancedRulerSnapResult {
  readonly state: StudioAdvancedRulerSnapState;
  readonly point: { readonly x: number; readonly y: number };
}

/**
 * Projects one stroke sample onto `ruler`. `state` is the result of the previous call for this
 * stroke (or `null` at stroke start); it is reused only while both the kind and the ruler id
 * still match, so switching the active ruler mid-stroke can never leak a stale session.
 */
export function snapStudioAdvancedRulerStrokePoint(
  state: StudioAdvancedRulerSnapState | null,
  ruler: StudioAdvancedRuler,
  start: { x: number; y: number },
  target: { x: number; y: number }
): StudioAdvancedRulerSnapResult | null {
  if (ruler.type === "curve") {
    const session = state?.type === "curve" && state.session.ruler.id === ruler.id
      ? state.session
      : beginStudioCurveSnapSession(ruler, start, {
          offsetMode: ruler.snapMode,
          offset: ruler.fixedOffset,
        });
    if (!session) return null;
    const transition = snapStudioCurvePoint(session, target);
    if (!transition) return null;
    return { state: { type: "curve", session: transition.session }, point: transition.point };
  }
  if (ruler.type === "fisheye") {
    const session = state?.type === "fisheye" && state.session.ruler.id === ruler.id
      ? state.session
      : beginStudioFisheyeSnapSession(ruler, start, target, {
          family: ruler.guideFamily,
        });
    if (!session) return null;
    const transition = snapStudioFisheyePoint(session, target);
    if (!transition) return null;
    return { state: { type: "fisheye", session: transition.session }, point: transition.point };
  }
  if (ruler.type === "parallel") {
    const session = state?.type === "parallel" && state.session.ruler.id === ruler.id
      ? state.session
      : beginStudioParallelSnapSession(ruler, start);
    if (!session) return null;
    const transition = snapStudioParallelPoint(session, target);
    if (!transition) return null;
    return { state: { type: "parallel", session: transition.session }, point: transition.point };
  }
  if (ruler.type === "concentric") {
    const session = state?.type === "concentric" && state.session.ruler.id === ruler.id
      ? state.session
      : beginStudioConcentricSnapSession(ruler, start);
    if (!session) return null;
    const transition = snapStudioConcentricPoint(session, target);
    if (!transition) return null;
    return { state: { type: "concentric", session: transition.session }, point: transition.point };
  }
  const session = state?.type === "radial" && state.session.ruler.id === ruler.id
    ? state.session
    : beginStudioRadialSnapSession(ruler, start);
  if (!session) return null;
  const transition = snapStudioRadialPoint(session, target);
  if (!transition) return null;
  return { state: { type: "radial", session: transition.session }, point: transition.point };
}
