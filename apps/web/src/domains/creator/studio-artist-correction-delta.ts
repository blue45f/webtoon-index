/**
 * Artist correction deltas for linked ink (NPR-006 / NPR-008).
 * 3D regenerate must not blindly wipe author 2D corrections — store as deltas and reproject.
 */

export const STUDIO_ARTIST_CORRECTION_DELTA_REVISION = 1 as const;

export type StudioToonPassKind =
  | "line"
  | "shadow"
  | "tone"
  | "depth"
  | "normal"
  | "object-id";

export interface StudioLinkedInkProvenance {
  readonly edgeId?: string;
  readonly faceId?: string;
  readonly objectId?: string;
  readonly confidence: number;
}

export interface StudioArtistStrokeDelta {
  readonly id: string;
  readonly pass: StudioToonPassKind;
  readonly shotId: string;
  /** Normalized canvas points in shot UV space [0,1]. */
  readonly points: readonly (readonly [number, number])[];
  readonly pressure: readonly number[];
  readonly provenance: StudioLinkedInkProvenance;
  /** Anchor in camera-projected space at creation time. */
  readonly creationCameraHash: string;
  readonly creationGeometryHash: string;
  readonly createdAt: number;
}

export interface StudioArtistCorrectionStore {
  readonly revision: typeof STUDIO_ARTIST_CORRECTION_DELTA_REVISION;
  readonly deltas: readonly StudioArtistStrokeDelta[];
}

export type StudioReprojectPolicy =
  | "preserve"
  | "reproject-uv"
  | "drop-if-orphaned";

export interface StudioReprojectContext {
  readonly shotId: string;
  readonly previousCameraHash: string;
  readonly nextCameraHash: string;
  readonly previousGeometryHash: string;
  readonly nextGeometryHash: string;
  /** Homography-ish 2x3 affine from previous UV to next UV (row-major). */
  readonly uvAffine?: readonly [number, number, number, number, number, number];
  readonly policy: StudioReprojectPolicy;
  readonly liveObjectIds?: ReadonlySet<string>;
}

export interface StudioReprojectResult {
  readonly store: StudioArtistCorrectionStore;
  readonly preservedIds: readonly string[];
  readonly reprojectedIds: readonly string[];
  readonly droppedIds: readonly string[];
}

export function createStudioArtistCorrectionStore(
  deltas: readonly StudioArtistStrokeDelta[] = [],
): StudioArtistCorrectionStore {
  return {
    revision: STUDIO_ARTIST_CORRECTION_DELTA_REVISION,
    deltas: [...deltas],
  };
}

export function appendStudioArtistCorrection(
  store: StudioArtistCorrectionStore,
  delta: StudioArtistStrokeDelta,
): StudioArtistCorrectionStore {
  return {
    ...store,
    deltas: [...store.deltas, delta],
  };
}

function applyAffine(
  p: readonly [number, number],
  m: readonly [number, number, number, number, number, number],
): [number, number] {
  return [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
}

/**
 * After 3D or camera mutation, reproject or preserve artist deltas per policy.
 * Default: preserve when geometry hash unchanged; reproject-uv when camera changes;
 * never wipe all deltas on regenerate.
 */
export function reprojectStudioArtistCorrections(
  store: StudioArtistCorrectionStore,
  ctx: StudioReprojectContext,
): StudioReprojectResult {
  const preserved: string[] = [];
  const reprojected: string[] = [];
  const dropped: string[] = [];
  const next: StudioArtistStrokeDelta[] = [];

  for (const delta of store.deltas) {
    if (delta.shotId !== ctx.shotId) {
      next.push(delta);
      preserved.push(delta.id);
      continue;
    }

    if (
      ctx.policy === "drop-if-orphaned"
      && delta.provenance.objectId
      && ctx.liveObjectIds
      && !ctx.liveObjectIds.has(delta.provenance.objectId)
    ) {
      dropped.push(delta.id);
      continue;
    }

    const geometryChanged =
      delta.creationGeometryHash !== ctx.nextGeometryHash
      && ctx.previousGeometryHash !== ctx.nextGeometryHash;
    const cameraChanged = ctx.previousCameraHash !== ctx.nextCameraHash;

    if (ctx.policy === "preserve" || (!geometryChanged && !cameraChanged)) {
      next.push(delta);
      preserved.push(delta.id);
      continue;
    }

    if (ctx.policy === "reproject-uv" && ctx.uvAffine && cameraChanged) {
      const points = delta.points.map((p) => applyAffine(p, ctx.uvAffine!));
      next.push({
        ...delta,
        points,
        creationCameraHash: ctx.nextCameraHash,
        creationGeometryHash: geometryChanged
          ? ctx.nextGeometryHash
          : delta.creationGeometryHash,
      });
      reprojected.push(delta.id);
      continue;
    }

    // Geometry changed without drop policy: still preserve strokes (do not wipe).
    next.push({
      ...delta,
      creationGeometryHash: geometryChanged
        ? ctx.nextGeometryHash
        : delta.creationGeometryHash,
      creationCameraHash: cameraChanged
        ? ctx.nextCameraHash
        : delta.creationCameraHash,
    });
    preserved.push(delta.id);
  }

  return {
    store: { revision: STUDIO_ARTIST_CORRECTION_DELTA_REVISION, deltas: next },
    preservedIds: preserved,
    reprojectedIds: reprojected,
    droppedIds: dropped,
  };
}

export function studioArtistCorrectionsForPass(
  store: StudioArtistCorrectionStore,
  shotId: string,
  pass: StudioToonPassKind,
): readonly StudioArtistStrokeDelta[] {
  return store.deltas.filter((d) => d.shotId === shotId && d.pass === pass);
}
