/**
 * Live 2D↔3D bridge: shared set, multi-shot overrides, independent toon passes, dirty propagation.
 * Product IP: regenerate dirty passes only; preserve artist correction deltas.
 */

import {
  hashStudioHybridDccObjectTransform,
  normalizeStudioHybridDccObjectTransform,
  type StudioHybridDccObjectTransform,
} from "../hybrid-dcc/studio-hybrid-dcc-object-transform";
import {
  appendStudioArtistCorrection,
  createStudioArtistCorrectionStore,
  reprojectStudioArtistCorrections,
  type StudioArtistCorrectionStore,
  type StudioArtistStrokeDelta,
  type StudioToonPassKind,
} from "../studio-artist-correction-delta";
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_LIVE_2D3D_BRIDGE_REVISION = 2 as const;

export const STUDIO_TOON_PASS_KINDS = [
  "line",
  "shadow",
  "tone",
  "depth",
  "normal",
  "object-id",
] as const satisfies readonly StudioToonPassKind[];

export interface StudioShotOverride {
  readonly camera?: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly fov?: number;
  };
  readonly transform?: Readonly<Record<string, {
    readonly position?: readonly [number, number, number];
    readonly rotation?: readonly [number, number, number];
    readonly scale?: readonly [number, number, number];
  }>>;
  readonly visibility?: Readonly<Record<string, boolean>>;
  readonly material?: Readonly<Record<string, string>>;
  readonly characterPose?: Readonly<Record<string, string>>;
}

export interface StudioSharedSetObject {
  readonly id: string;
  readonly geometryHash: string;
  readonly visible: boolean;
  readonly materialId: string;
  /** Canonical base placement. Legacy bridge records without it are interpreted as identity. */
  readonly transform?: StudioHybridDccObjectTransform;
}

export interface StudioSharedSet {
  readonly id: string;
  readonly objects: readonly StudioSharedSetObject[];
  readonly setHash: string;
}

export interface StudioShotRecord {
  readonly id: string;
  readonly name: string;
  readonly overrides: StudioShotOverride;
  readonly passHashes: Readonly<Partial<Record<StudioToonPassKind, string>>>;
  readonly dirtyPasses: readonly StudioToonPassKind[];
}

export interface StudioLiveBridgeDocument {
  readonly revision: typeof STUDIO_LIVE_2D3D_BRIDGE_REVISION;
  readonly set: StudioSharedSet;
  readonly shots: readonly StudioShotRecord[];
  readonly artistCorrections: StudioArtistCorrectionStore;
  readonly commandSequence: number;
}

function stableHash(parts: readonly string[]): string {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(parts.join("|")))}`;
}

export function createStudioSharedSet(
  id: string,
  objects: readonly StudioSharedSetObject[],
): StudioSharedSet {
  const setHash = stableHash([
    id,
    ...objects.map((object) => (
      `${object.id}:${object.geometryHash}:${object.visible}:${object.materialId}:`
        + (object.transform ? hashStudioHybridDccObjectTransform(object.transform) : "identity-v0")
    )),
  ]);
  return { id, objects, setHash };
}

/** Updates base object placement, invalidating only dependent render passes. */
export function mutateStudioSharedObjectTransform(
  doc: StudioLiveBridgeDocument,
  objectId: string,
  value: StudioHybridDccObjectTransform,
): StudioLiveBridgeDocument {
  if (!doc.set.objects.some((object) => object.id === objectId)) {
    throw new Error(`shared object ${objectId} not found`);
  }
  const transform = normalizeStudioHybridDccObjectTransform(value);
  const objects = doc.set.objects.map((object) => (
    object.id === objectId ? { ...object, transform } : object
  ));
  const set = createStudioSharedSet(doc.set.id, objects);
  const shots = doc.shots.map((shot) => ({
    ...shot,
    dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
  }));
  return {
    ...doc,
    set,
    shots,
    commandSequence: doc.commandSequence + 1,
  };
}

/** Updates base scene visibility and invalidates every image pass that can contain the object. */
export function mutateStudioSharedObjectVisibility(
  doc: StudioLiveBridgeDocument,
  objectId: string,
  visible: boolean,
): StudioLiveBridgeDocument {
  if (typeof visible !== "boolean") throw new Error("shared object visibility must be boolean");
  const current = doc.set.objects.find((object) => object.id === objectId);
  if (!current) throw new Error(`shared object ${objectId} not found`);
  if (current.visible === visible) return doc;
  const set = createStudioSharedSet(
    doc.set.id,
    doc.set.objects.map((object) => object.id === objectId ? { ...object, visible } : object),
  );
  return {
    ...doc,
    set,
    shots: doc.shots.map((shot) => ({
      ...shot,
      dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
    })),
    commandSequence: doc.commandSequence + 1,
  };
}

export function createStudioLiveBridgeDocument(
  set: StudioSharedSet,
  shotIds: readonly string[],
): StudioLiveBridgeDocument {
  const shots: StudioShotRecord[] = shotIds.map((id, i) => ({
    id,
    name: `Shot ${i + 1}`,
    overrides: {},
    passHashes: {},
    dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
  }));
  return {
    revision: STUDIO_LIVE_2D3D_BRIDGE_REVISION,
    set,
    shots,
    artistCorrections: createStudioArtistCorrectionStore(),
    commandSequence: 0,
  };
}

export function applyStudioShotOverride(
  doc: StudioLiveBridgeDocument,
  shotId: string,
  override: StudioShotOverride,
): StudioLiveBridgeDocument {
  const shots = doc.shots.map((s) => {
    if (s.id !== shotId) return s;
    return {
      ...s,
      overrides: {
        camera: override.camera ?? s.overrides.camera,
        transform: { ...s.overrides.transform, ...override.transform },
        visibility: { ...s.overrides.visibility, ...override.visibility },
        material: { ...s.overrides.material, ...override.material },
        characterPose: { ...s.overrides.characterPose, ...override.characterPose },
      },
      dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
    };
  });
  return { ...doc, shots, commandSequence: doc.commandSequence + 1 };
}

/**
 * Mutate underlying 3D object geometry — dirties only shots that see the object
 * and only passes depending on geometry.
 */
export function mutateStudioSharedObjectGeometry(
  doc: StudioLiveBridgeDocument,
  objectId: string,
  nextGeometryHash: string,
): StudioLiveBridgeDocument {
  const objects = doc.set.objects.map((o) =>
    o.id === objectId ? { ...o, geometryHash: nextGeometryHash } : o,
  );
  const set = createStudioSharedSet(doc.set.id, objects);
  const geometryPasses: StudioToonPassKind[] = [
    "line",
    "shadow",
    "tone",
    "depth",
    "normal",
    "object-id",
  ];
  const previousGeometryHash = doc.set.objects.find((o) => o.id === objectId)?.geometryHash ?? "";

  const shots = doc.shots.map((shot) => {
    const hidden = shot.overrides.visibility?.[objectId] === false;
    if (hidden) return shot;
    const dirty = new Set([...shot.dirtyPasses, ...geometryPasses]);
    return {
      ...shot,
      dirtyPasses: [...dirty],
    };
  });

  let artistCorrections = doc.artistCorrections;
  for (const shot of shots) {
    const cameraHash = stableHash([
      shot.id,
      JSON.stringify(shot.overrides.camera ?? null),
    ]);
    const reproj = reprojectStudioArtistCorrections(artistCorrections, {
      shotId: shot.id,
      previousCameraHash: cameraHash,
      nextCameraHash: cameraHash,
      previousGeometryHash,
      nextGeometryHash,
      policy: "preserve",
      liveObjectIds: new Set(objects.map((o) => o.id)),
    });
    artistCorrections = reproj.store;
  }

  return {
    ...doc,
    set,
    shots,
    artistCorrections,
    commandSequence: doc.commandSequence + 1,
  };
}

export function generateStudioToonPass(
  doc: StudioLiveBridgeDocument,
  shotId: string,
  pass: StudioToonPassKind,
): StudioLiveBridgeDocument {
  const shots = doc.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    if (!shot.dirtyPasses.includes(pass) && shot.passHashes[pass]) {
      return shot;
    }
    const hash = stableHash([
      doc.set.setHash,
      shotId,
      pass,
      JSON.stringify(shot.overrides),
      String(doc.commandSequence),
    ]);
    const dirtyPasses = shot.dirtyPasses.filter((p) => p !== pass);
    return {
      ...shot,
      passHashes: { ...shot.passHashes, [pass]: hash },
      dirtyPasses,
    };
  });
  return { ...doc, shots, commandSequence: doc.commandSequence + 1 };
}

export function addStudioArtistDelta(
  doc: StudioLiveBridgeDocument,
  delta: StudioArtistStrokeDelta,
): StudioLiveBridgeDocument {
  return {
    ...doc,
    artistCorrections: appendStudioArtistCorrection(doc.artistCorrections, delta),
    commandSequence: doc.commandSequence + 1,
  };
}

export function studioLiveBridgeDirtySummary(doc: StudioLiveBridgeDocument): {
  readonly dirtyShotIds: readonly string[];
  readonly dirtyPassCount: number;
  readonly artistDeltaCount: number;
} {
  const dirtyShotIds = doc.shots
    .filter((s) => s.dirtyPasses.length > 0)
    .map((s) => s.id);
  const dirtyPassCount = doc.shots.reduce((n, s) => n + s.dirtyPasses.length, 0);
  return {
    dirtyShotIds,
    dirtyPassCount,
    artistDeltaCount: doc.artistCorrections.deltas.length,
  };
}

/** Shots that do not reference objectId (hidden) should stay clean on that object's geometry edit. */
export function studioShotSeesObject(
  shot: StudioShotRecord,
  objectId: string,
): boolean {
  return shot.overrides.visibility?.[objectId] !== false;
}
