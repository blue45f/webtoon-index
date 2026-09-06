import * as Y from "yjs";

import {
  createStudioRasterCompactionCheckpoint,
  type StudioRasterCompactionCheckpoint,
} from "./studio-crdt-raster-compaction";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES,
  STUDIO_RASTER_MAX_OPERATIONS,
  STUDIO_RASTER_MAX_SURFACE_TILES,
  STUDIO_RASTER_MAX_TOTAL_PATCHES,
  STUDIO_RASTER_MAX_UNDO_OPERATIONS,
  assertStudioRasterSurfaceSpec,
  canonicalStudioRasterJson,
  compareStudioRasterEventOrder,
  createStudioRasterOperationLog,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "./studio-crdt-raster-ops";

/**
 * Flat grow-only roots. Each immutable identity is one atomic canonical JSON value, so concurrent
 * appends converge as a set union instead of replacing a whole operation array through LWW.
 */
export const STUDIO_CRDT_RASTER_SURFACES_ROOT = "studio-raster-surfaces";
export const STUDIO_CRDT_RASTER_OPERATIONS_ROOT = "studio-raster-operations";
export const STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT = "studio-raster-undo-operations";
export const STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT = "studio-raster-undo-acks";
export const STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT = "studio-raster-checkpoints";
export const STUDIO_CRDT_RASTER_ROOT_NAMES = [
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
] as const;

/** Document-wide limits; per-surface limits remain part of the operation-log contract. */
export const STUDIO_CRDT_RASTER_MAX_SURFACES = STUDIO_RASTER_MAX_SURFACE_TILES;
export const STUDIO_CRDT_RASTER_MAX_CHECKPOINTS = STUDIO_RASTER_MAX_OPERATIONS;
export const STUDIO_CRDT_RASTER_MAX_REFERENCED_BYTES =
  STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES;

export type StudioCrdtRasterIdentityKind =
  | "operation"
  | "undo-operation"
  | "undo-acknowledgement"
  | "checkpoint";

export interface StudioCrdtRasterDocumentSnapshot {
  readonly surfaces: ReadonlyMap<string, StudioRasterSurfaceSpec>;
  readonly logs: ReadonlyMap<string, StudioRasterOperationLog>;
  readonly checkpoints: readonly StudioRasterCompactionCheckpoint[];
  readonly identityKinds: ReadonlyMap<string, StudioCrdtRasterIdentityKind>;
  readonly assets: ReadonlyMap<string, StudioRasterAssetReference>;
  readonly referencedBytes: number;
  readonly totalPatchCount: number;
}

export interface StudioCrdtRasterRootSnapshot {
  readonly surfaces: ReadonlyMap<string, unknown>;
  readonly operations: ReadonlyMap<string, unknown>;
  readonly undoOperations: ReadonlyMap<string, unknown>;
  readonly undoAcknowledgements: ReadonlyMap<string, unknown>;
  readonly checkpoints: ReadonlyMap<string, unknown>;
}

export interface StudioCrdtRasterAppendedActorEvent {
  readonly eventId: string;
  readonly kind: Exclude<StudioCrdtRasterIdentityKind, "checkpoint">;
  readonly actorId: string;
  readonly logicalClock: string;
}

export class StudioCrdtRasterDocumentContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioCrdtRasterDocumentContractError";
  }
}

/** Kept as a named assertion so the aggregate (not per-surface) boundary is unit-testable. */
export function assertStudioCrdtRasterGlobalPatchCount(totalPatchCount: number): void {
  if (
    !Number.isSafeInteger(totalPatchCount) ||
    totalPatchCount < 0 ||
    totalPatchCount > STUDIO_RASTER_MAX_TOTAL_PATCHES
  ) {
    fail("래스터 CRDT 문서 전역 타일 패치 수가 허용 한도를 초과했습니다.");
  }
}

function fail(message: string): never {
  throw new StudioCrdtRasterDocumentContractError(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseCanonicalJson(value: unknown): unknown | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return canonicalStudioRasterJson(parsed) === value ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns undefined for an absent root and null for a reserved root with the wrong Yjs type. */
function existingMapRoot(doc: Y.Doc, name: string): Y.Map<unknown> | null | undefined {
  if (!doc.share.has(name)) return undefined;
  try {
    // Remote top-level types arrive as an unmaterialized AbstractType until a typed getter claims
    // them. `getMap` is non-mutating once the root name is present and rejects an actual Y.Array.
    return doc.getMap<unknown>(name);
  } catch {
    return null;
  }
}

function requiredRootSet(doc: Y.Doc): {
  surfaces: Y.Map<unknown> | undefined;
  operations: Y.Map<unknown> | undefined;
  undoOperations: Y.Map<unknown> | undefined;
  undoAcknowledgements: Y.Map<unknown> | undefined;
  checkpoints: Y.Map<unknown> | undefined;
} | null {
  const surfaces = existingMapRoot(doc, STUDIO_CRDT_RASTER_SURFACES_ROOT);
  const operations = existingMapRoot(doc, STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
  const undoOperations = existingMapRoot(doc, STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT);
  const undoAcknowledgements = existingMapRoot(doc, STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT);
  const checkpoints = existingMapRoot(doc, STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT);
  if (
    surfaces === null || operations === null || undoOperations === null ||
    undoAcknowledgements === null || checkpoints === null
  ) return null;
  return { surfaces, operations, undoOperations, undoAcknowledgements, checkpoints };
}

function addAsset(
  assets: Map<string, StudioRasterAssetReference>,
  asset: StudioRasterAssetReference
): number {
  const existing = assets.get(asset.assetId);
  if (existing) {
    if (canonicalStudioRasterJson(existing) !== canonicalStudioRasterJson(asset)) {
      fail("같은 래스터 assetId가 서로 다른 불변 메타데이터를 가리킵니다.");
    }
    return 0;
  }
  assets.set(asset.assetId, asset);
  return asset.byteLength;
}

function sameOrderKey(
  left: { readonly logicalClock: string; readonly actorId: string; readonly eventId: string },
  right: { readonly logicalClock: string; readonly actorId: string; readonly eventId: string }
): boolean {
  return left.logicalClock === right.logicalClock &&
    left.actorId === right.actorId &&
    left.eventId === right.eventId;
}

function assertCheckpointMatchesLog(
  checkpoint: StudioRasterCompactionCheckpoint,
  log: StudioRasterOperationLog
): void {
  const operationKey = (operation: StudioRasterOperation) => ({
    ...operation.order,
    eventId: operation.operationId,
  });
  const undoKey = (operation: StudioRasterUndoOperation) => ({
    ...operation.order,
    eventId: operation.undoOperationId,
  });
  const acknowledgementKey = (acknowledgement: StudioRasterUndoAcknowledgement) => ({
    ...acknowledgement.order,
    eventId: acknowledgement.acknowledgementId,
  });
  const allKeys = [
    ...log.operations.map(operationKey),
    ...log.undoOperations.map(undoKey),
    ...log.undoAcknowledgements.map(acknowledgementKey),
  ];
  if (!allKeys.some((key) => sameOrderKey(key, checkpoint.through))) {
    fail("래스터 checkpoint 경계가 실제 이벤트와 일치하지 않습니다.");
  }
  const sealedOperationIds = log.operations
    .filter((operation) => (
      compareStudioRasterEventOrder(operationKey(operation), checkpoint.through) <= 0
    ))
    .map(({ operationId }) => operationId)
    .sort();
  const sealedUndoOperationIds = log.undoOperations
    .filter((operation) => compareStudioRasterEventOrder(undoKey(operation), checkpoint.through) <= 0)
    .map(({ undoOperationId }) => undoOperationId)
    .sort();
  const sealedUndoAcknowledgementIds = log.undoAcknowledgements
    .filter((acknowledgement) => (
      compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), checkpoint.through) <= 0
    ))
    .map(({ acknowledgementId }) => acknowledgementId)
    .sort();
  if (
    canonicalStudioRasterJson(sealedOperationIds) !==
      canonicalStudioRasterJson(checkpoint.sealedOperationIds) ||
    canonicalStudioRasterJson(sealedUndoOperationIds) !==
      canonicalStudioRasterJson(checkpoint.sealedUndoOperationIds) ||
    canonicalStudioRasterJson(sealedUndoAcknowledgementIds) !==
      canonicalStudioRasterJson(checkpoint.sealedUndoAcknowledgementIds)
  ) {
    fail("래스터 checkpoint 봉인 집합이 안정 prefix와 일치하지 않습니다.");
  }
  const sealedOperations = new Set(sealedOperationIds);
  const sealedUndos = new Set(sealedUndoOperationIds);
  if (
    log.undoOperations.some((operation) => (
      compareStudioRasterEventOrder(undoKey(operation), checkpoint.through) > 0 &&
      sealedOperations.has(operation.targetOperationId)
    )) ||
    log.undoAcknowledgements.some((acknowledgement) => (
      compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), checkpoint.through) > 0 &&
      sealedUndos.has(acknowledgement.undoOperationId)
    ))
  ) {
    fail("래스터 checkpoint가 닫히지 않은 undo horizon을 봉인합니다.");
  }
}

/** Plain [id, value][] entries per reserved raster root — everything parseStudioCrdtRasterDocumentRoots
 * needs, with no Y.Doc/Yjs dependency. Structured-clone-safe, so it can cross a postMessage boundary
 * to a Worker (or a Node worker_thread) unlike a live Y.Doc. */
export interface StudioCrdtRasterRawRoots {
  readonly surfaces: readonly (readonly [string, unknown])[];
  readonly operations: readonly (readonly [string, unknown])[];
  readonly undoOperations: readonly (readonly [string, unknown])[];
  readonly undoAcknowledgements: readonly (readonly [string, unknown])[];
  readonly checkpoints: readonly (readonly [string, unknown])[];
}

/**
 * Extracts plain entries from every reserved raster root — the only Y.Doc-touching step of the read
 * path. Cheap: just Y.Map iteration, no JSON parsing/validation (that's parseStudioCrdtRasterDocumentRoots).
 * Returns null if any reserved root exists with the wrong Yjs type (same contract as requiredRootSet).
 */
export function extractStudioCrdtRasterRawRoots(doc: Y.Doc): StudioCrdtRasterRawRoots | null {
  const roots = requiredRootSet(doc);
  if (!roots) return null;
  return {
    surfaces: [...(roots.surfaces ?? [])],
    operations: [...(roots.operations ?? [])],
    undoOperations: [...(roots.undoOperations ?? [])],
    undoAcknowledgements: [...(roots.undoAcknowledgements ?? [])],
    checkpoints: [...(roots.checkpoints ?? [])],
  };
}

/**
 * Parses the plain entries extracted from every reserved raster root and enforces exact schema plus
 * every per-surface and document-wide semantic budget. No Y.Doc/DOM dependency — this is the pure
 * core a Web Worker (or server-side code) can call directly given extractStudioCrdtRasterRawRoots'
 * output, without needing the originating Y.Doc.
 */
export function parseStudioCrdtRasterDocumentRoots(
  roots: StudioCrdtRasterRawRoots
): StudioCrdtRasterDocumentSnapshot {
  const {
    surfaces: surfaceRoot,
    operations: operationRoot,
    undoOperations: undoRoot,
    undoAcknowledgements: acknowledgementRoot,
    checkpoints: checkpointRoot,
  } = roots;
  if (
    surfaceRoot.length > STUDIO_CRDT_RASTER_MAX_SURFACES ||
    operationRoot.length > STUDIO_RASTER_MAX_OPERATIONS ||
    undoRoot.length > STUDIO_RASTER_MAX_UNDO_OPERATIONS ||
    acknowledgementRoot.length > STUDIO_RASTER_MAX_UNDO_OPERATIONS ||
    checkpointRoot.length > STUDIO_CRDT_RASTER_MAX_CHECKPOINTS
  ) {
    fail("래스터 CRDT 문서 전역 root 수가 허용 한도를 초과했습니다.");
  }

  const surfaces = new Map<string, StudioRasterSurfaceSpec>();
  for (const [surfaceId, encoded] of surfaceRoot) {
    const parsed = parseCanonicalJson(encoded);
    try {
      assertStudioRasterSurfaceSpec(parsed, `surfaces[${surfaceId}]`);
    } catch {
      fail("래스터 surface root가 exact-schema 계약을 위반했습니다.");
    }
    if (parsed.surfaceId !== surfaceId) {
      fail("래스터 surface root key와 surfaceId가 일치하지 않습니다.");
    }
    surfaces.set(surfaceId, parsed);
  }

  type MutableLog = {
    operations: StudioRasterOperation[];
    undoOperations: StudioRasterUndoOperation[];
    undoAcknowledgements: StudioRasterUndoAcknowledgement[];
  };
  const mutableLogs = new Map<string, MutableLog>();
  for (const surfaceId of surfaces.keys()) {
    mutableLogs.set(surfaceId, { operations: [], undoOperations: [], undoAcknowledgements: [] });
  }
  const identityKinds = new Map<string, StudioCrdtRasterIdentityKind>();
  const registerIdentity = (eventId: string, kind: StudioCrdtRasterIdentityKind) => {
    if (identityKinds.has(eventId)) {
      fail("래스터 이벤트 UUID가 operation/undo/ack/checkpoint 전체에서 재사용되었습니다.");
    }
    identityKinds.set(eventId, kind);
  };
  const requiredMutableLog = (surfaceId: unknown): MutableLog => {
    if (typeof surfaceId !== "string") fail("래스터 이벤트 surfaceId가 올바르지 않습니다.");
    const log = mutableLogs.get(surfaceId);
    if (!log) fail("래스터 이벤트가 등록되지 않은 surface를 참조합니다.");
    return log;
  };

  for (const [operationId, encoded] of operationRoot) {
    const parsed = parseCanonicalJson(encoded);
    if (
      !hasExactKeys(parsed, ["surfaceId", "operation"]) ||
      !isPlainRecord(parsed.operation) ||
      parsed.operation.operationId !== operationId
    ) fail("래스터 operation root가 exact-schema 계약을 위반했습니다.");
    requiredMutableLog(parsed.surfaceId).operations.push(
      parsed.operation as unknown as StudioRasterOperation
    );
    registerIdentity(operationId, "operation");
  }
  for (const [undoOperationId, encoded] of undoRoot) {
    const parsed = parseCanonicalJson(encoded);
    if (
      !hasExactKeys(parsed, ["surfaceId", "undoOperation"]) ||
      !isPlainRecord(parsed.undoOperation) ||
      parsed.undoOperation.undoOperationId !== undoOperationId
    ) fail("래스터 undo root가 exact-schema 계약을 위반했습니다.");
    requiredMutableLog(parsed.surfaceId).undoOperations.push(
      parsed.undoOperation as unknown as StudioRasterUndoOperation
    );
    registerIdentity(undoOperationId, "undo-operation");
  }
  for (const [acknowledgementId, encoded] of acknowledgementRoot) {
    const parsed = parseCanonicalJson(encoded);
    if (
      !hasExactKeys(parsed, ["surfaceId", "acknowledgement"]) ||
      !isPlainRecord(parsed.acknowledgement) ||
      parsed.acknowledgement.acknowledgementId !== acknowledgementId
    ) fail("래스터 undo acknowledgement root가 exact-schema 계약을 위반했습니다.");
    requiredMutableLog(parsed.surfaceId).undoAcknowledgements.push(
      parsed.acknowledgement as unknown as StudioRasterUndoAcknowledgement
    );
    registerIdentity(acknowledgementId, "undo-acknowledgement");
  }

  const logs = new Map<string, StudioRasterOperationLog>();
  let totalPatchCount = 0;
  for (const [surfaceId, surface] of surfaces) {
    const mutable = mutableLogs.get(surfaceId)!;
    try {
      const log = createStudioRasterOperationLog({
        version: STUDIO_RASTER_CRDT_VERSION,
        surface,
        operations: mutable.operations,
        undoOperations: mutable.undoOperations,
        undoAcknowledgements: mutable.undoAcknowledgements,
      });
      logs.set(surfaceId, log);
      totalPatchCount += log.operations.reduce(
        (sum, operation) => sum + operation.patches.length,
        0
      );
    } catch {
      fail("래스터 이벤트 root가 exact-schema 계약을 위반했습니다.");
    }
  }
  assertStudioCrdtRasterGlobalPatchCount(totalPatchCount);

  const checkpoints: StudioRasterCompactionCheckpoint[] = [];
  for (const [checkpointId, encoded] of checkpointRoot) {
    const parsed = parseCanonicalJson(encoded);
    let checkpoint: StudioRasterCompactionCheckpoint;
    try {
      checkpoint = createStudioRasterCompactionCheckpoint(
        parsed as StudioRasterCompactionCheckpoint
      );
    } catch {
      fail("래스터 checkpoint root가 exact-schema 계약을 위반했습니다.");
    }
    if (
      checkpoint.checkpointId !== checkpointId ||
      canonicalStudioRasterJson(checkpoint) !== encoded
    ) fail("래스터 checkpoint root key/value가 canonical 계약을 위반했습니다.");
    const surface = surfaces.get(checkpoint.surface.surfaceId);
    if (!surface || canonicalStudioRasterJson(surface) !== canonicalStudioRasterJson(checkpoint.surface)) {
      fail("래스터 checkpoint가 등록되지 않았거나 다른 surface를 참조합니다.");
    }
    assertCheckpointMatchesLog(checkpoint, logs.get(checkpoint.surface.surfaceId)!);
    registerIdentity(checkpointId, "checkpoint");
    checkpoints.push(checkpoint);
  }

  const assets = new Map<string, StudioRasterAssetReference>();
  let referencedBytes = 0;
  for (const log of logs.values()) {
    for (const operation of log.operations) {
      for (const patch of operation.patches) {
        referencedBytes += addAsset(assets, patch.effect.payload);
        if (patch.selectionMask) referencedBytes += addAsset(assets, patch.selectionMask);
      }
    }
  }
  for (const checkpoint of checkpoints) {
    for (const tile of checkpoint.tiles) referencedBytes += addAsset(assets, tile.asset);
  }
  if (referencedBytes > STUDIO_CRDT_RASTER_MAX_REFERENCED_BYTES) {
    fail("래스터 CRDT 문서 전역 자산 참조 예산을 초과했습니다.");
  }
  return {
    surfaces,
    logs,
    checkpoints: checkpoints.sort((left, right) => (
      compareStudioRasterEventOrder(left.through, right.through) ||
      left.checkpointId.localeCompare(right.checkpointId)
    )),
    identityKinds,
    assets,
    referencedBytes,
    totalPatchCount,
  };
}

/**
 * Parses all reserved raster roots without mutating the Y.Doc and enforces exact schema plus every
 * per-surface and document-wide semantic budget. Thin composition of the two pieces above — kept for
 * every existing synchronous caller (server-side code, local-write preflights); callers that can
 * tolerate an async boundary should prefer extractStudioCrdtRasterRawRoots + a Worker-backed call to
 * parseStudioCrdtRasterDocumentRoots instead, since the latter is the actual CPU-heavy step.
 */
export function readStudioCrdtRasterDocument(
  doc: Y.Doc
): StudioCrdtRasterDocumentSnapshot {
  const roots = extractStudioCrdtRasterRawRoots(doc);
  if (!roots) fail("래스터 CRDT reserved root는 Y.Map이어야 합니다.");
  return parseStudioCrdtRasterDocumentRoots(roots);
}

export function hasValidStudioCrdtRasterDocument(doc: Y.Doc): boolean {
  try {
    readStudioCrdtRasterDocument(doc);
    return true;
  } catch {
    return false;
  }
}

/** Captures raw immutable values before applying an untrusted Yjs delta. */
export function snapshotStudioCrdtRasterRoots(
  doc: Y.Doc
): StudioCrdtRasterRootSnapshot | null {
  const roots = requiredRootSet(doc);
  if (!roots) return null;
  return {
    surfaces: new Map(roots.surfaces ?? []),
    operations: new Map(roots.operations ?? []),
    undoOperations: new Map(roots.undoOperations ?? []),
    undoAcknowledgements: new Map(roots.undoAcknowledgements ?? []),
    checkpoints: new Map(roots.checkpoints ?? []),
  };
}

function mapPreserves(
  before: ReadonlyMap<string, unknown>,
  after: Y.Map<unknown> | undefined
): boolean {
  for (const [key, value] of before) {
    if (!after || after.get(key) !== value) return false;
  }
  return true;
}

/** Existing identities may never disappear or change value; new identities are set-union appends. */
export function preservesStudioCrdtRasterRoots(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): boolean {
  if (!snapshot) return false;
  const roots = requiredRootSet(doc);
  if (!roots) return false;
  return mapPreserves(snapshot.surfaces, roots.surfaces) &&
    mapPreserves(snapshot.operations, roots.operations) &&
    mapPreserves(snapshot.undoOperations, roots.undoOperations) &&
    mapPreserves(snapshot.undoAcknowledgements, roots.undoAcknowledgements) &&
    mapPreserves(snapshot.checkpoints, roots.checkpoints);
}

/**
 * Extracts only events whose immutable root identity did not exist at the durable validation
 * boundary. A merged/offline update may legitimately retransmit events authored by other users;
 * those existing identities are deliberately excluded from actor binding.
 *
 * This parser is fail-closed: both the before snapshot and the resulting document must satisfy the
 * complete raster contract before any event is returned.
 */
function inspectStudioCrdtRasterAppendedActorEvents(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): {
  readonly appended: readonly StudioCrdtRasterAppendedActorEvent[];
  readonly durableMaximumClock: string;
} {
  if (!snapshot) fail("래스터 actor 검증을 위한 durable root snapshot이 올바르지 않습니다.");
  const parsed = readStudioCrdtRasterDocument(doc);
  const appended: StudioCrdtRasterAppendedActorEvent[] = [];
  let durableMaximumClock = "0";
  const inspect = (
    event: {
      readonly order: { readonly actorId: string; readonly logicalClock: string };
    },
    eventId: string,
    kind: StudioCrdtRasterAppendedActorEvent["kind"],
    existed: boolean
  ) => {
    if (existed) {
      const clock = event.order.logicalClock;
      if (
        clock.length > durableMaximumClock.length ||
        (clock.length === durableMaximumClock.length && clock > durableMaximumClock)
      ) {
        durableMaximumClock = clock;
      }
      return;
    }
    appended.push({
      eventId,
      kind,
      actorId: event.order.actorId,
      logicalClock: event.order.logicalClock,
    });
  };
  for (const log of parsed.logs.values()) {
    for (const operation of log.operations) {
      inspect(
        operation,
        operation.operationId,
        "operation",
        snapshot.operations.has(operation.operationId)
      );
    }
    for (const undoOperation of log.undoOperations) {
      inspect(
        undoOperation,
        undoOperation.undoOperationId,
        "undo-operation",
        snapshot.undoOperations.has(undoOperation.undoOperationId)
      );
    }
    for (const acknowledgement of log.undoAcknowledgements) {
      inspect(
        acknowledgement,
        acknowledgement.acknowledgementId,
        "undo-acknowledgement",
        snapshot.undoAcknowledgements.has(acknowledgement.acknowledgementId)
      );
    }
  }
  return {
    appended: appended.sort((left, right) => (
      left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0
    )),
    durableMaximumClock,
  };
}

export function appendedStudioCrdtRasterActorEvents(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): readonly StudioCrdtRasterAppendedActorEvent[] {
  return inspectStudioCrdtRasterAppendedActorEvents(snapshot, doc).appended;
}

/**
 * Returns the immutable asset manifests introduced by truly new operations only. Retransmitted
 * durable operations are excluded, while references reused by several new patches are returned
 * once in stable asset-id order. Client checkpoints are rejected at a separate trust boundary.
 */
export function appendedStudioCrdtRasterAssetReferences(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): readonly StudioRasterAssetReference[] {
  if (!snapshot) fail("래스터 자산 검증을 위한 durable root snapshot이 올바르지 않습니다.");
  const parsed = readStudioCrdtRasterDocument(doc);
  const assets = new Map<string, StudioRasterAssetReference>();
  const add = (reference: StudioRasterAssetReference) => {
    const existing = assets.get(reference.assetId);
    if (
      existing &&
      canonicalStudioRasterJson(existing) !== canonicalStudioRasterJson(reference)
    ) {
      fail("새 래스터 작업이 같은 assetId에 서로 다른 메타데이터를 사용합니다.");
    }
    assets.set(reference.assetId, reference);
  };
  for (const log of parsed.logs.values()) {
    for (const operation of log.operations) {
      if (snapshot.operations.has(operation.operationId)) continue;
      for (const patch of operation.patches) {
        add(patch.effect.payload);
        if (patch.selectionMask) add(patch.selectionMask);
      }
    }
  }
  return [...assets.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

/** Binds every truly new raster event to the authenticated user performing the durable append. */
export function assertStudioCrdtRasterAppendedEventActors(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc,
  actorUserId: string
): void {
  const appended = appendedStudioCrdtRasterActorEvents(snapshot, doc);
  if (appended.some(({ actorId }) => actorId !== actorUserId)) {
    fail("새 래스터 이벤트 actorId가 인증된 사용자와 일치하지 않습니다.");
  }
}

/**
 * Bounds an offline batch's Lamport advance by the number of immutable events it actually adds.
 * Legitimate batches may contain clocks `durableMax + 1 .. durableMax + N`; a single forged event
 * cannot jump to uint64 max and permanently sort every later collaborator behind itself.
 */
export function assertStudioCrdtRasterAppendedEventAdmission(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc,
  actorUserId: string
): void {
  const inspected = inspectStudioCrdtRasterAppendedActorEvents(snapshot, doc);
  if (inspected.appended.some(({ actorId }) => actorId !== actorUserId)) {
    fail("새 래스터 이벤트 actorId가 인증된 사용자와 일치하지 않습니다.");
  }
  const maximumAcceptedClock = addStudioRasterClockAdvance(
    inspected.durableMaximumClock,
    inspected.appended.length
  );
  if (
    inspected.appended.some(({ logicalClock }) => (
      logicalClock.length > maximumAcceptedClock.length ||
      (logicalClock.length === maximumAcceptedClock.length && logicalClock > maximumAcceptedClock)
    ))
  ) {
    fail("새 래스터 이벤트 Lamport clock이 durable frontier를 비정상적으로 건너뜁니다.");
  }
}

/**
 * Once a trusted server checkpoint closes a surface prefix, future client events must sort after
 * that horizon and may not undo an identity the checkpoint sealed. This is what makes the
 * server-durable frontier a real compaction fence rather than an advisory rendering hint.
 */
export function assertStudioCrdtRasterAppendedEventsAfterCheckpointHorizon(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): void {
  if (!snapshot) fail("래스터 checkpoint horizon 검증을 위한 durable root snapshot이 올바르지 않습니다.");
  const parsed = readStudioCrdtRasterDocument(doc);
  for (const [surfaceId, log] of parsed.logs) {
    const checkpoint = parsed.checkpoints
      .filter((candidate) => candidate.surface.surfaceId === surfaceId)
      .sort((left, right) => compareStudioRasterEventOrder(left.through, right.through))
      .at(-1);
    if (!checkpoint) continue;
    const assertAfter = (
      order: { readonly logicalClock: string; readonly actorId: string },
      eventId: string
    ) => {
      if (compareStudioRasterEventOrder({ ...order, eventId }, checkpoint.through) <= 0) {
        fail("새 래스터 이벤트가 서버 checkpoint의 닫힌 정렬 경계를 침범합니다.");
      }
    };
    for (const operation of log.operations) {
      if (snapshot.operations.has(operation.operationId)) continue;
      assertAfter(operation.order, operation.operationId);
    }
    for (const undoOperation of log.undoOperations) {
      if (snapshot.undoOperations.has(undoOperation.undoOperationId)) continue;
      assertAfter(undoOperation.order, undoOperation.undoOperationId);
      if (checkpoint.sealedOperationIds.includes(undoOperation.targetOperationId)) {
        fail("새 래스터 실행 취소가 서버 checkpoint에 봉인된 작업을 대상으로 합니다.");
      }
    }
    for (const acknowledgement of log.undoAcknowledgements) {
      if (snapshot.undoAcknowledgements.has(acknowledgement.acknowledgementId)) continue;
      assertAfter(acknowledgement.order, acknowledgement.acknowledgementId);
      if (checkpoint.sealedUndoOperationIds.includes(acknowledgement.undoOperationId)) {
        fail("새 래스터 복원 확인이 서버 checkpoint에 봉인된 실행 취소를 대상으로 합니다.");
      }
    }
  }
}

const MAX_STUDIO_RASTER_CLOCK = "18446744073709551615";

/** Adds a small validated event count without requiring an ES2020 BigInt runtime. */
function addStudioRasterClockAdvance(clock: string, advance: number): string {
  if (advance <= 0) return clock;
  const digits = clock.split("").map((digit) => digit.charCodeAt(0) - 48);
  let carry = advance;
  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const sum = digits[index]! + carry;
    digits[index] = sum % 10;
    carry = Math.floor(sum / 10);
  }
  while (carry > 0) {
    digits.unshift(carry % 10);
    carry = Math.floor(carry / 10);
  }
  const result = digits.join("");
  return result.length > MAX_STUDIO_RASTER_CLOCK.length ||
    (result.length === MAX_STUDIO_RASTER_CLOCK.length && result > MAX_STUDIO_RASTER_CLOCK)
    ? MAX_STUDIO_RASTER_CLOCK
    : result;
}

function mapConflictsWithSnapshot(
  before: ReadonlyMap<string, unknown>,
  candidate: Y.Map<unknown> | undefined
): boolean {
  for (const [key, value] of candidate ?? []) {
    if (before.has(key) && before.get(key) !== value) return true;
  }
  return false;
}

/**
 * Detects a concurrent immutable-ID collision even when Yjs total ordering makes the candidate
 * assignment lose and therefore leaves the visible merged map unchanged. Descendant rewrites that
 * cannot materialize without their base are still caught by the normal before/after preservation
 * check when they win.
 */
export function conflictsWithStudioCrdtRasterRootSnapshot(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  candidate: Y.Doc
): boolean {
  if (!snapshot) return true;
  const roots = requiredRootSet(candidate);
  if (!roots) return false;
  return mapConflictsWithSnapshot(snapshot.surfaces, roots.surfaces) ||
    mapConflictsWithSnapshot(snapshot.operations, roots.operations) ||
    mapConflictsWithSnapshot(snapshot.undoOperations, roots.undoOperations) ||
    mapConflictsWithSnapshot(snapshot.undoAcknowledgements, roots.undoAcknowledgements) ||
    mapConflictsWithSnapshot(snapshot.checkpoints, roots.checkpoints);
}

/**
 * Client updates may read/retransmit existing checkpoints but may not mint a new one. Serialized
 * checkpoints retain only a proof ID, not the trusted membership/frontier evidence needed to make
 * them authoritative; creation is reserved for a future coordinator endpoint.
 */
export function appendsStudioCrdtRasterCheckpoint(
  snapshot: StudioCrdtRasterRootSnapshot | null,
  doc: Y.Doc
): boolean {
  if (!snapshot) return true;
  const roots = requiredRootSet(doc);
  if (!roots) return true;
  for (const checkpointId of roots.checkpoints?.keys() ?? []) {
    if (!snapshot.checkpoints.has(checkpointId)) return true;
  }
  return false;
}
