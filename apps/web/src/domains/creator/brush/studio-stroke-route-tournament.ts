
import { selectFilterLane } from "../studio-renderer-tournament-runtime";

import {
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY,
  type StudioStrokeSurfaceRouteKind,
} from "./studio-stroke-surface-route";

import type { RemoteKillSwitch, WinnerCache } from "@toonspectrum/studio-engine-registry";

/**
 * V12 §5 tournament consumption, stroke-surface seam — pure selector only.
 *
 * The product filter island selects exactly one provider and treats a killed
 * selection as unavailable. This module retains tournament ordering only as
 * evidence over the stroke-surface provider universe. The shadow planner
 * (studio-surface-plan-shadow.ts) consumes it observation-only.
 * It is deliberately not an execution or pointer-down admission API: product
 * strokes select one provider from brush/document capability before any begin
 * call, and a failure never advances through this projected list.
 *
 * Observation contract:
 * - killed providers leave the candidate evidence; if all are killed the
 *   observation is explicitly unavailable and no provider is restored;
 * - a cached winner for this bucket/device is promoted within the evidence;
 * - pristine tournament state (empty cache, nothing killed) returns the input
 *   order byte-identically.
 *
 * Buckets are derived deterministically from stroke workload traits (point
 * count, brush family, canvas scale) so wins generalize across strokes of the
 * same shape of work instead of leaking across unlike workloads.
 *
 * Hot-path contract: pure functions only. No I/O, no awaits, no module state.
 */

/* ------------------------------------------------------------------ */
/* Provider identity — shared with the shadow planner registry          */
/* ------------------------------------------------------------------ */

const ROUTE_PROVIDER_PREFIX = "stroke-route-";

/**
 * Provider id under which a stroke-surface lane races in the tournament and
 * kill switch. Matches the shadow planner's registry ids (`stroke-route-*`)
 * so winner/kill state written against the shadow's provider space projects
 * onto this evidence set without translation.
 */
export function studioStrokeRouteProviderId(
  kind: StudioStrokeSurfaceRouteKind,
): string {
  return `${ROUTE_PROVIDER_PREFIX}${kind}`;
}

/* ------------------------------------------------------------------ */
/* Workload traits → deterministic tournament bucket                    */
/* ------------------------------------------------------------------ */

/** Observable stroke workload characteristics a bucket is derived from. */
export interface StudioStrokeRouteWorkloadTraits {
  /** Sampled pointer points in the stroke (estimate at selection time). */
  readonly pointCount: number;
  /** Brush family/category identity (free-form; normalized for the bucket). */
  readonly brushFamily: string;
  /** Canvas (stage) scale the stroke renders at. */
  readonly canvasScale: number;
}

export type StudioStrokeRoutePointBand = "micro" | "short" | "long" | "marathon";

export type StudioStrokeRouteScaleBand = "sub" | "base" | "zoomed";

/**
 * Point-count band. Total and deterministic: non-finite or negative counts
 * clamp to zero (micro) instead of producing an unstable bucket.
 */
export function studioStrokeRoutePointBand(
  pointCount: number,
): StudioStrokeRoutePointBand {
  const count = Number.isFinite(pointCount) && pointCount > 0 ? pointCount : 0;
  if (count <= 16) return "micro";
  if (count <= 128) return "short";
  if (count <= 1024) return "long";
  return "marathon";
}

/**
 * Canvas-scale band. Degenerate scales (non-finite, zero, negative) map to
 * the base band — a broken viewport read must not mint a fresh bucket.
 */
export function studioStrokeRouteScaleBand(
  canvasScale: number,
): StudioStrokeRouteScaleBand {
  if (!Number.isFinite(canvasScale) || canvasScale <= 0) return "base";
  if (canvasScale < 0.5) return "sub";
  if (canvasScale < 2) return "base";
  return "zoomed";
}

/**
 * Normalizes a brush family for bucket use: lowercased, trimmed, and every
 * run of characters outside [a-z0-9-] collapsed to a single dash so the
 * bucket separator (`|`) can never be injected. Empty input reads "unknown".
 */
export function studioStrokeRouteBrushFamilyKey(brushFamily: string): string {
  const normalized = brushFamily
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "unknown";
}

export const STUDIO_STROKE_ROUTE_TOURNAMENT_BUCKET_PREFIX = "studio-stroke-route";

/**
 * Deterministic winner-cache bucket for a stroke workload. Same traits ⇒ same
 * bucket, always; unlike workloads (different brush family, point band, or
 * scale band) never share tournament conclusions.
 */
export function studioStrokeRouteBucket(
  traits: StudioStrokeRouteWorkloadTraits,
): string {
  return [
    STUDIO_STROKE_ROUTE_TOURNAMENT_BUCKET_PREFIX,
    studioStrokeRouteBrushFamilyKey(traits.brushFamily),
    `pts:${studioStrokeRoutePointBand(traits.pointCount)}`,
    `scale:${studioStrokeRouteScaleBand(traits.canvasScale)}`,
  ].join("|");
}

/* ------------------------------------------------------------------ */
/* Pure route observation — no execution authority                       */
/* ------------------------------------------------------------------ */

/**
 * Already-hydrated in-memory tournament state. Structurally satisfied by
 * StudioRendererTournamentRuntime, so callers may pass the shared runtime
 * directly as the state.
 */
export interface StudioStrokeRouteTournamentState {
  readonly deviceHash: string;
  readonly winnerCache: WinnerCache;
  readonly killSwitch: RemoteKillSwitch;
}

export interface SelectStudioStrokeRouteInput {
  /** Candidate stroke surfaces in admitted evidence order. */
  readonly lanes: readonly StudioStrokeSurfaceRouteKind[];
  readonly traits: StudioStrokeRouteWorkloadTraits;
  readonly state: StudioStrokeRouteTournamentState;
}

export interface SelectStudioStrokeRouteResult {
  /** Bucket the selection was resolved against (derived from the traits). */
  bucket: string;
  /** Reordered evidence; empty when every candidate provider is killed. */
  lanes: StudioStrokeSurfaceRouteKind[];
  /** Lanes whose providers are currently killed. */
  killedLanes: StudioStrokeSurfaceRouteKind[];
  /** Lane the winner cache moved (or confirmed) at the head, if any. */
  promotedLane: StudioStrokeSurfaceRouteKind | null;
  /** Explicit fail-closed observation when every candidate provider is killed. */
  unavailableReason: "all-providers-killed" | null;
}

/**
 * Pure observation of tournament state over stroke-surface candidates — the
 * exact selectFilterLane semantics on this provider space:
 * 1. killed providers leave the evidence. If all are killed the result is
 *    empty and reports `all-providers-killed`;
 * 2. a cached winner for this workload bucket/device moves its lane to the
 *    head; a killed or absent winner promotes nothing;
 * 3. pristine state (empty cache, no kills) returns the input order unchanged.
 * No I/O and no awaits. This result is never pointer-down authority.
 */
export function selectStudioStrokeRoute(
  input: SelectStudioStrokeRouteInput,
): SelectStudioStrokeRouteResult {
  const bucket = studioStrokeRouteBucket(input.traits);
  const selection = selectFilterLane<StudioStrokeSurfaceRouteKind>({
    lanes: input.lanes,
    bucket,
    deviceHash: input.state.deviceHash,
    winnerCache: input.state.winnerCache,
    killSwitch: input.state.killSwitch,
    laneProviderId: studioStrokeRouteProviderId,
  });
  return { bucket, ...selection };
}

/**
 * Full observation universe in historical priority order. This is shadow
 * evidence input, not an executable provider order or retry chain.
 */
export const STUDIO_STROKE_ROUTE_TOURNAMENT_LANES: readonly StudioStrokeSurfaceRouteKind[] =
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY;
