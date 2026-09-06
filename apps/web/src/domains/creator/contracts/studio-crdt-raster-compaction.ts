/**
 * Stable-prefix compaction for the semantic raster CRDT.
 *
 * This module does not rasterize pixels. A trusted coordinator first replays the stable prefix,
 * uploads sparse non-transparent tile snapshots, and supplies their manifest hash. Compaction then
 * verifies replica frontiers, closes the undo horizon, seals exact event identities, and returns an
 * immutable checkpoint plus a valid suffix log. Missing tiles in a checkpoint mean transparent.
 */

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES,
  STUDIO_RASTER_MAX_OPERATIONS,
  STUDIO_RASTER_MAX_SURFACE_TILES,
  STUDIO_RASTER_MAX_UNDO_OPERATIONS,
  assertStudioRasterAssetReference,
  assertStudioRasterOperationLog,
  assertStudioRasterSurfaceSpec,
  canonicalStudioRasterJson,
  compareStudioRasterEventOrder,
  createStudioRasterOperationLog,
  StudioRasterContractError,
  type StudioRasterAssetReference,
  type StudioRasterEventOrder,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
} from "./studio-crdt-raster-ops";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DECIMAL_CLOCK_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64_DECIMAL = "18446744073709551615";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REPLICA_COUNT = 64;
const MAX_ID_LENGTH = 160;

export interface StudioRasterCompactionOrderKey extends StudioRasterEventOrder {
  readonly eventId: string;
}

export interface StudioRasterReplicaFrontier {
  readonly replicaId: string;
  /** Replica certifies it has durably observed every event through this total-order key. */
  readonly through: StudioRasterCompactionOrderKey;
}

export interface StudioRasterCompactionStabilityProof {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly proofId: string;
  /** Explicit policy boundary: future undo may not target operations at/before this key. */
  readonly undoHorizonClosedThrough: StudioRasterCompactionOrderKey;
  readonly replicaFrontiers: readonly StudioRasterReplicaFrontier[];
}

export interface StudioRasterCheckpointTile {
  readonly tileX: number;
  readonly tileY: number;
  /** Complete post-replay tile; width/height equal the actual edge-tile dimensions. */
  readonly asset: StudioRasterAssetReference;
}

export interface StudioRasterCompactionCheckpoint {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly checkpointId: string;
  readonly proofId: string;
  readonly surface: StudioRasterSurfaceSpec;
  readonly through: StudioRasterCompactionOrderKey;
  readonly tileManifestSha256: string;
  readonly tiles: readonly StudioRasterCheckpointTile[];
  readonly sealedOperationIds: readonly string[];
  readonly sealedUndoOperationIds: readonly string[];
  readonly sealedUndoAcknowledgementIds: readonly string[];
}

export interface StudioRasterCompactionInput {
  readonly checkpointId: string;
  readonly through: StudioRasterCompactionOrderKey;
  /** Trusted membership list supplied by the coordinator, not by the untrusted CRDT payload. */
  readonly requiredReplicaIds: readonly string[];
  readonly stabilityProof: StudioRasterCompactionStabilityProof;
  readonly tileManifestSha256: string;
  readonly tiles: readonly StudioRasterCheckpointTile[];
}

export interface StudioRasterCompactionResult {
  readonly checkpoint: StudioRasterCompactionCheckpoint;
  readonly tail: StudioRasterOperationLog;
}

function fail(code: string, path: string, message: string): never {
  throw new StudioRasterContractError(code, path, message);
}

function expectContract(
  condition: boolean,
  code: string,
  path: string,
  message: string
): asserts condition {
  if (!condition) fail(code, path, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  path: string
): asserts value is Record<string, unknown> {
  expectContract(isPlainRecord(value), "invalid_object", path, "plain object가 필요합니다.");
  const actual = Object.keys(value);
  expectContract(
    actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    "invalid_shape",
    path,
    "필드 집합이 compaction 계약과 일치하지 않습니다."
  );
}

function assertSafeId(value: unknown, path: string): asserts value is string {
  expectContract(
    typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(value),
    "invalid_id",
    path,
    "안전한 작업 범위 식별자가 필요합니다."
  );
}

function assertUuid(value: unknown, path: string): asserts value is string {
  expectContract(typeof value === "string" && UUID_PATTERN.test(value), "invalid_uuid", path, "UUID가 필요합니다.");
}

function assertSha256(value: unknown, path: string): asserts value is string {
  expectContract(typeof value === "string" && SHA256_PATTERN.test(value), "invalid_sha256", path, "소문자 SHA-256이 필요합니다.");
}

function assertOrderKey(value: unknown, path: string): asserts value is StudioRasterCompactionOrderKey {
  assertExactKeys(value, ["logicalClock", "actorId", "eventId"], path);
  expectContract(
    typeof value.logicalClock === "string" && DECIMAL_CLOCK_PATTERN.test(value.logicalClock)
      && (value.logicalClock.length < MAX_UINT64_DECIMAL.length
        || value.logicalClock <= MAX_UINT64_DECIMAL),
    "invalid_clock",
    `${path}.logicalClock`,
    "정규 십진 Lamport 시계가 필요합니다."
  );
  assertSafeId(value.actorId, `${path}.actorId`);
  assertUuid(value.eventId, `${path}.eventId`);
}

function sameOrderKey(left: StudioRasterCompactionOrderKey, right: StudioRasterCompactionOrderKey): boolean {
  return left.logicalClock === right.logicalClock && left.actorId === right.actorId && left.eventId === right.eventId;
}

function operationKey(operation: StudioRasterOperationLog["operations"][number]): StudioRasterCompactionOrderKey {
  return { ...operation.order, eventId: operation.operationId };
}

function undoKey(operation: StudioRasterOperationLog["undoOperations"][number]): StudioRasterCompactionOrderKey {
  return { ...operation.order, eventId: operation.undoOperationId };
}

function acknowledgementKey(
  acknowledgement: StudioRasterOperationLog["undoAcknowledgements"][number]
): StudioRasterCompactionOrderKey {
  return { ...acknowledgement.order, eventId: acknowledgement.acknowledgementId };
}

function assertStabilityProof(
  value: unknown,
  through: StudioRasterCompactionOrderKey,
  requiredReplicaIds: readonly string[],
  path: string
): asserts value is StudioRasterCompactionStabilityProof {
  assertExactKeys(value, ["version", "proofId", "undoHorizonClosedThrough", "replicaFrontiers"], path);
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertUuid(value.proofId, `${path}.proofId`);
  assertOrderKey(value.undoHorizonClosedThrough, `${path}.undoHorizonClosedThrough`);
  expectContract(
    sameOrderKey(value.undoHorizonClosedThrough, through),
    "undo_horizon_mismatch",
    `${path}.undoHorizonClosedThrough`,
    "실행 취소 종료 경계는 compaction 경계와 같아야 합니다."
  );
  expectContract(
    Array.isArray(value.replicaFrontiers) && value.replicaFrontiers.length > 0 && value.replicaFrontiers.length <= MAX_REPLICA_COUNT,
    "replica_frontier_limit",
    `${path}.replicaFrontiers`,
    "복제본 frontier 수가 허용 범위를 벗어났습니다."
  );
  const frontiers = new Map<string, StudioRasterCompactionOrderKey>();
  value.replicaFrontiers.forEach((frontier, index) => {
    const frontierPath = `${path}.replicaFrontiers[${index}]`;
    assertExactKeys(frontier, ["replicaId", "through"], frontierPath);
    assertSafeId(frontier.replicaId, `${frontierPath}.replicaId`);
    assertOrderKey(frontier.through, `${frontierPath}.through`);
    expectContract(!frontiers.has(frontier.replicaId), "duplicate_replica", `${path}.replicaFrontiers`, "중복 복제본 frontier가 있습니다.");
    frontiers.set(frontier.replicaId, frontier.through);
  });
  for (const replicaId of requiredReplicaIds) {
    const frontier = frontiers.get(replicaId);
    expectContract(Boolean(frontier), "missing_replica_frontier", `${path}.replicaFrontiers`, `필수 복제본 ${replicaId}의 안정성 증명이 없습니다.`);
    expectContract(
      compareStudioRasterEventOrder(frontier!, through) >= 0,
      "unstable_replica_frontier",
      `${path}.replicaFrontiers`,
      `복제본 ${replicaId}가 compaction 경계에 도달하지 않았습니다.`
    );
  }
}

function actualTileDimension(fullDimension: number, tileSize: number, tileIndex: number): number {
  return Math.min(tileSize, fullDimension - tileIndex * tileSize);
}

function assertCheckpointTiles(
  value: unknown,
  surface: StudioRasterSurfaceSpec,
  path: string
): asserts value is readonly StudioRasterCheckpointTile[] {
  expectContract(Array.isArray(value) && value.length <= STUDIO_RASTER_MAX_SURFACE_TILES, "checkpoint_tile_limit", path, "checkpoint 타일 수가 허용 한도를 초과했습니다.");
  const columns = Math.ceil(surface.width / surface.tileSize);
  const rows = Math.ceil(surface.height / surface.tileSize);
  const addresses = new Set<string>();
  const assets = new Map<string, StudioRasterAssetReference>();
  let totalBytes = 0;
  value.forEach((tile, index) => {
    const tilePath = `${path}[${index}]`;
    assertExactKeys(tile, ["tileX", "tileY", "asset"], tilePath);
    expectContract(typeof tile.tileX === "number" && Number.isSafeInteger(tile.tileX) && tile.tileX >= 0 && tile.tileX < columns, "invalid_tile_address", `${tilePath}.tileX`, "타일 X 주소가 범위를 벗어났습니다.");
    expectContract(typeof tile.tileY === "number" && Number.isSafeInteger(tile.tileY) && tile.tileY >= 0 && tile.tileY < rows, "invalid_tile_address", `${tilePath}.tileY`, "타일 Y 주소가 범위를 벗어났습니다.");
    const address = `${tile.tileX}:${tile.tileY}`;
    expectContract(!addresses.has(address), "duplicate_checkpoint_tile", path, `중복 checkpoint 타일 ${address}가 있습니다.`);
    addresses.add(address);
    assertStudioRasterAssetReference(tile.asset, `${tilePath}.asset`);
    expectContract(
      tile.asset.width === actualTileDimension(surface.width, surface.tileSize, tile.tileX)
        && tile.asset.height === actualTileDimension(surface.height, surface.tileSize, tile.tileY),
      "checkpoint_tile_dimension_mismatch",
      `${tilePath}.asset`,
      "checkpoint 자산은 가장자리까지 포함한 전체 타일 크기여야 합니다."
    );
    const existing = assets.get(tile.asset.assetId);
    if (existing) {
      expectContract(
        canonicalStudioRasterJson(existing) === canonicalStudioRasterJson(tile.asset),
        "asset_identity_conflict",
        `${tilePath}.asset`,
        "같은 checkpoint assetId가 다른 내용을 가리킵니다."
      );
    } else {
      assets.set(tile.asset.assetId, tile.asset);
      totalBytes += tile.asset.byteLength;
    }
  });
  expectContract(
    totalBytes <= STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES,
    "checkpoint_asset_budget",
    path,
    "checkpoint 자산 바이트 예산을 초과했습니다."
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sortedUniqueUuidList(value: unknown, maximum: number, path: string): string[] {
  expectContract(
    Array.isArray(value) && value.length <= maximum,
    "sealed_event_limit",
    path,
    "봉인 이벤트 수가 허용 범위를 벗어났습니다."
  );
  const result = value.map((eventId, index) => {
    assertUuid(eventId, `${path}[${index}]`);
    return eventId;
  });
  expectContract(
    new Set(result).size === result.length,
    "duplicate_sealed_event",
    path,
    "봉인 이벤트 ID가 중복되었습니다."
  );
  return result.sort();
}

/**
 * Validates and canonicalizes an already-produced immutable checkpoint.
 *
 * Stability proof membership is deliberately absent from the serialized checkpoint; only the
 * trusted coordinator can validate that proof when it creates the checkpoint. Consumers can still
 * validate every retained identity, tile, surface and ordering invariant without trusting JSON.
 */
export function createStudioRasterCompactionCheckpoint(
  value: StudioRasterCompactionCheckpoint
): StudioRasterCompactionCheckpoint {
  assertExactKeys(
    value,
    [
      "version",
      "checkpointId",
      "proofId",
      "surface",
      "through",
      "tileManifestSha256",
      "tiles",
      "sealedOperationIds",
      "sealedUndoOperationIds",
      "sealedUndoAcknowledgementIds",
    ],
    "checkpoint"
  );
  expectContract(
    value.version === STUDIO_RASTER_CRDT_VERSION,
    "invalid_version",
    "checkpoint.version",
    "지원하지 않는 버전입니다."
  );
  assertUuid(value.checkpointId, "checkpoint.checkpointId");
  assertUuid(value.proofId, "checkpoint.proofId");
  assertStudioRasterSurfaceSpec(value.surface, "checkpoint.surface");
  assertOrderKey(value.through, "checkpoint.through");
  assertSha256(value.tileManifestSha256, "checkpoint.tileManifestSha256");
  assertCheckpointTiles(value.tiles, value.surface, "checkpoint.tiles");

  const sealedOperationIds = sortedUniqueUuidList(
    value.sealedOperationIds,
    STUDIO_RASTER_MAX_OPERATIONS,
    "checkpoint.sealedOperationIds"
  );
  const sealedUndoOperationIds = sortedUniqueUuidList(
    value.sealedUndoOperationIds,
    STUDIO_RASTER_MAX_UNDO_OPERATIONS,
    "checkpoint.sealedUndoOperationIds"
  );
  const sealedUndoAcknowledgementIds = sortedUniqueUuidList(
    value.sealedUndoAcknowledgementIds,
    STUDIO_RASTER_MAX_UNDO_OPERATIONS,
    "checkpoint.sealedUndoAcknowledgementIds"
  );
  const allSealedIds = [
    ...sealedOperationIds,
    ...sealedUndoOperationIds,
    ...sealedUndoAcknowledgementIds,
  ];
  expectContract(
    new Set(allSealedIds).size === allSealedIds.length,
    "duplicate_sealed_event",
    "checkpoint",
    "봉인 이벤트 UUID가 종류를 넘어 중복되었습니다."
  );
  expectContract(
    allSealedIds.includes(value.through.eventId),
    "unknown_compaction_frontier",
    "checkpoint.through.eventId",
    "checkpoint 경계 이벤트가 봉인 집합에 없습니다."
  );

  const tiles = [...value.tiles]
    .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX)
    .map((tile) => ({ ...tile, asset: { ...tile.asset } }));
  return deepFreeze({
    version: STUDIO_RASTER_CRDT_VERSION,
    checkpointId: value.checkpointId,
    proofId: value.proofId,
    surface: { ...value.surface },
    through: { ...value.through },
    tileManifestSha256: value.tileManifestSha256,
    tiles,
    sealedOperationIds,
    sealedUndoOperationIds,
    sealedUndoAcknowledgementIds,
  });
}

/**
 * Seals a stable prefix. `requiredReplicaIds` must come from trusted membership/lease state.
 * A future protocol validator must reject undo targeting checkpoint.sealedOperationIds; accepting
 * such a late undo would cross the explicitly closed undo horizon.
 */
export function compactStudioRasterOperationLog(
  value: StudioRasterOperationLog,
  input: StudioRasterCompactionInput
): StudioRasterCompactionResult {
  assertStudioRasterOperationLog(value);
  assertExactKeys(
    input,
    ["checkpointId", "through", "requiredReplicaIds", "stabilityProof", "tileManifestSha256", "tiles"],
    "input"
  );
  assertUuid(input.checkpointId, "input.checkpointId");
  assertOrderKey(input.through, "input.through");
  assertSha256(input.tileManifestSha256, "input.tileManifestSha256");
  expectContract(
    Array.isArray(input.requiredReplicaIds) && input.requiredReplicaIds.length > 0 && input.requiredReplicaIds.length <= MAX_REPLICA_COUNT,
    "required_replica_limit",
    "input.requiredReplicaIds",
    "필수 복제본 목록이 허용 범위를 벗어났습니다."
  );
  const requiredReplicaIds = new Set<string>();
  input.requiredReplicaIds.forEach((replicaId, index) => {
    assertSafeId(replicaId, `input.requiredReplicaIds[${index}]`);
    expectContract(!requiredReplicaIds.has(replicaId), "duplicate_replica", "input.requiredReplicaIds", "필수 복제본이 중복되었습니다.");
    requiredReplicaIds.add(replicaId);
  });
  assertStabilityProof(input.stabilityProof, input.through, [...requiredReplicaIds], "input.stabilityProof");
  assertCheckpointTiles(input.tiles, value.surface, "input.tiles");

  const sorted = createStudioRasterOperationLog(value);
  const sealedOperations = sorted.operations.filter((operation) => compareStudioRasterEventOrder(operationKey(operation), input.through) <= 0);
  const tailOperations = sorted.operations.filter((operation) => compareStudioRasterEventOrder(operationKey(operation), input.through) > 0);
  expectContract(sealedOperations.length > 0, "empty_compaction_prefix", "input.through", "경계까지 봉인할 래스터 작업이 없습니다.");
  expectContract(
    [
      ...sorted.operations.map(operationKey),
      ...sorted.undoOperations.map(undoKey),
      ...sorted.undoAcknowledgements.map(acknowledgementKey),
    ].some((key) => sameOrderKey(key, input.through)),
    "unknown_compaction_frontier",
    "input.through",
    "compaction 경계는 실제 이벤트를 가리켜야 합니다."
  );

  const sealedUndoOperations = sorted.undoOperations.filter((operation) => compareStudioRasterEventOrder(undoKey(operation), input.through) <= 0);
  const tailUndoOperations = sorted.undoOperations.filter((operation) => compareStudioRasterEventOrder(undoKey(operation), input.through) > 0);
  const sealedAcknowledgements = sorted.undoAcknowledgements.filter((acknowledgement) => compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), input.through) <= 0);
  const tailAcknowledgements = sorted.undoAcknowledgements.filter((acknowledgement) => compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), input.through) > 0);
  const sealedOperationIds = new Set(sealedOperations.map((operation) => operation.operationId));
  const sealedUndoIds = new Set(sealedUndoOperations.map((operation) => operation.undoOperationId));
  expectContract(
    tailUndoOperations.every((operation) => !sealedOperationIds.has(operation.targetOperationId)),
    "undo_crosses_compaction_horizon",
    "input.through",
    "경계 뒤 실행 취소가 봉인된 작업을 대상으로 합니다. 경계를 더 뒤로 이동하세요."
  );
  expectContract(
    tailAcknowledgements.every((acknowledgement) => !sealedUndoIds.has(acknowledgement.undoOperationId)),
    "undo_ack_crosses_compaction_horizon",
    "input.through",
    "경계 뒤 복원 확인이 봉인된 실행 취소를 대상으로 합니다. 경계를 더 뒤로 이동하세요."
  );

  const tail = createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: sorted.surface,
    operations: tailOperations,
    undoOperations: tailUndoOperations,
    undoAcknowledgements: tailAcknowledgements,
  });
  const tiles = [...input.tiles]
    .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX)
    .map((tile) => ({ ...tile, asset: { ...tile.asset } }));
  const checkpoint: StudioRasterCompactionCheckpoint = {
    version: STUDIO_RASTER_CRDT_VERSION,
    checkpointId: input.checkpointId,
    proofId: input.stabilityProof.proofId,
    surface: { ...sorted.surface },
    through: { ...input.through },
    tileManifestSha256: input.tileManifestSha256,
    tiles,
    sealedOperationIds: sealedOperations.map((operation) => operation.operationId).sort(),
    sealedUndoOperationIds: sealedUndoOperations.map((operation) => operation.undoOperationId).sort(),
    sealedUndoAcknowledgementIds: sealedAcknowledgements.map((acknowledgement) => acknowledgement.acknowledgementId).sort(),
  };
  return deepFreeze({ checkpoint, tail });
}
