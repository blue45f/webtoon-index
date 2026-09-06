/**
 * Semantic raster CRDT contract.
 *
 * Raster bytes never live in the Yjs document. The document carries immutable operations whose
 * patches point at work-scoped, content-addressed assets. Replicas merge the immutable sets and
 * replay them in the same `(logicalClock, actorId, eventId)` order. This deliberately avoids a
 * byte-per-pixel LWW register: paint/erase/fill patches remain compositing instructions, while
 * destructive derived patches (filters, transforms, merge/flatten) are conditional replacements.
 * A derived operation is skipped atomically when any tile base hash no longer matches.
 */

export const STUDIO_RASTER_CRDT_VERSION = 1 as const;
export const STUDIO_RASTER_KERNEL = "toonspectrum-raster-v1" as const;

export const STUDIO_RASTER_MIN_TILE_SIZE = 128;
export const STUDIO_RASTER_MAX_TILE_SIZE = 1_024;
export const STUDIO_RASTER_MAX_SURFACE_DIMENSION = 131_072;
export const STUDIO_RASTER_MAX_SURFACE_TILES = 8_192;
export const STUDIO_RASTER_MAX_PATCHES_PER_OPERATION = 128;
export const STUDIO_RASTER_MAX_OPERATIONS = 50_000;
export const STUDIO_RASTER_MAX_UNDO_OPERATIONS = 100_000;
export const STUDIO_RASTER_MAX_TOTAL_PATCHES = 250_000;
export const STUDIO_RASTER_MAX_ASSET_BYTES = 16 * 1_024 * 1_024;
export const STUDIO_RASTER_MAX_OPERATION_REFERENCED_BYTES = 64 * 1_024 * 1_024;
export const STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES = 2 * 1_024 * 1_024 * 1_024;
export const STUDIO_RASTER_MAX_OPERATION_DESCRIPTOR_BYTES = 40 * 1_024;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DECIMAL_CLOCK_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64_DECIMAL = "18446744073709551615";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TEXT_ENCODER = new TextEncoder();
const MAX_ID_LENGTH = 160;

export const STUDIO_RASTER_INTENTS = [
  "paint",
  "erase",
  "fill",
  "clear",
  "selection-fill",
  "selection-clear",
  "filter",
  "selection-filter",
  "transform",
  "merge",
  "flatten",
] as const;

export type StudioRasterIntent = (typeof STUDIO_RASTER_INTENTS)[number];

/**
 * Immutable CRDT v1 read/validation compatibility list.
 *
 * Do not use this as the admission list for newly uploaded or published assets. New storage is
 * intentionally PNG-only and is governed by `studio-raster-asset-contract.ts`. Removing a codec
 * here would make already persisted v1 Yjs documents unreadable even when no new asset is written.
 */
export const STUDIO_RASTER_ASSET_MEDIA_TYPES = [
  "image/png",
  "image/webp",
  "application/x-toonspectrum-rgba-zstd",
  "application/x-toonspectrum-alpha-zstd",
] as const;

export type StudioRasterAssetMediaType = (typeof STUDIO_RASTER_ASSET_MEDIA_TYPES)[number];

export interface StudioRasterSurfaceSpec {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly surfaceId: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
}

/** An opaque work-scoped reference. It intentionally has no URL, path, src, or inline bytes. */
export interface StudioRasterAssetReference {
  readonly scope: "work";
  readonly assetId: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: StudioRasterAssetMediaType;
  readonly width: number;
  readonly height: number;
}

export interface StudioRasterTileRegion {
  /** Pixel offset inside the addressed tile. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioRasterCompositeEffect {
  readonly kind: "composite";
  readonly blendMode: "source-over" | "destination-out";
  readonly payload: StudioRasterAssetReference;
}

export interface StudioRasterReplaceEffect {
  readonly kind: "replace";
  /** Hash of the complete tile immediately before this operation is replayed. */
  readonly baseTileSha256: string;
  readonly payload: StudioRasterAssetReference;
}

export type StudioRasterTileEffect = StudioRasterCompositeEffect | StudioRasterReplaceEffect;

export interface StudioRasterTilePatch {
  readonly tileX: number;
  readonly tileY: number;
  readonly region: StudioRasterTileRegion;
  readonly effect: StudioRasterTileEffect;
  /** Per-tile normalized selection alpha, required only for selection intents. */
  readonly selectionMask?: StudioRasterAssetReference;
}

export interface StudioRasterEventOrder {
  /** Unsigned decimal Lamport clock. It remains a string to avoid IEEE-754 truncation. */
  readonly logicalClock: string;
  readonly actorId: string;
}

export interface StudioRasterOperation {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly operationId: string;
  readonly order: StudioRasterEventOrder;
  readonly pageId: string;
  readonly layerId: string;
  readonly intent: StudioRasterIntent;
  readonly kernel: typeof STUDIO_RASTER_KERNEL;
  /** SHA-256 of canonical semantic tool parameters; raw prompts/settings are not CRDT payloads. */
  readonly semanticParametersSha256: string;
  /** Patch array order is immutable and is the order used within this operation. */
  readonly patches: readonly StudioRasterTilePatch[];
}

export interface StudioRasterUndoOperation {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly undoOperationId: string;
  readonly targetOperationId: string;
  readonly order: StudioRasterEventOrder;
}

/**
 * Restore only acknowledges the undo operation the actor has observed. A later/concurrent unseen
 * undo remains unacknowledged, so deletion wins without a mutable `deleted` boolean.
 */
export interface StudioRasterUndoAcknowledgement {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly acknowledgementId: string;
  readonly undoOperationId: string;
  readonly targetOperationId: string;
  readonly order: StudioRasterEventOrder;
}

export interface StudioRasterOperationLog {
  readonly version: typeof STUDIO_RASTER_CRDT_VERSION;
  readonly surface: StudioRasterSurfaceSpec;
  readonly operations: readonly StudioRasterOperation[];
  readonly undoOperations: readonly StudioRasterUndoOperation[];
  readonly undoAcknowledgements: readonly StudioRasterUndoAcknowledgement[];
}

export interface StudioRasterReplayTile {
  readonly surfaceId: string;
  readonly tileX: number;
  readonly tileY: number;
}

export interface StudioRasterReplayStep {
  readonly operation: StudioRasterOperation;
  readonly operationIndex: number;
  readonly patch: StudioRasterTilePatch;
  readonly patchIndex: number;
}

export interface StudioRasterReplayAdapter {
  /** Return null for the canonical transparent/absent tile. */
  readTileSha256(tile: StudioRasterReplayTile): string | null;
  applyPatch(step: StudioRasterReplayStep): void;
}

export interface StudioRasterReplayResult {
  readonly appliedOperationIds: readonly string[];
  readonly undoneOperationIds: readonly string[];
  readonly conflictedOperationIds: readonly string[];
  readonly appliedPatchCount: number;
}

export class StudioRasterContractError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "StudioRasterContractError";
    this.code = code;
    this.path = path;
  }
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
  required: readonly string[],
  optional: readonly string[],
  path: string
): asserts value is Record<string, unknown> {
  expectContract(isPlainRecord(value), "invalid_object", path, "plain object가 필요합니다.");
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  expectContract(
    required.every((key) => Object.hasOwn(value, key)),
    "missing_field",
    path,
    "필수 필드가 누락되었습니다."
  );
  expectContract(
    keys.every((key) => allowed.has(key)),
    "unknown_field",
    path,
    "허용되지 않은 필드가 포함되어 있습니다."
  );
}

function assertSafeId(value: unknown, path: string): asserts value is string {
  expectContract(
    typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(value),
    "invalid_id",
    path,
    "작업 범위 식별자가 올바르지 않습니다."
  );
}

function assertUuid(value: unknown, path: string): asserts value is string {
  expectContract(
    typeof value === "string" && UUID_PATTERN.test(value),
    "invalid_uuid",
    path,
    "UUID 식별자가 올바르지 않습니다."
  );
}

function assertSha256(value: unknown, path: string): asserts value is string {
  expectContract(
    typeof value === "string" && SHA256_PATTERN.test(value),
    "invalid_sha256",
    path,
    "소문자 SHA-256 해시가 필요합니다."
  );
}

function assertInteger(value: unknown, minimum: number, maximum: number, path: string): asserts value is number {
  expectContract(
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "invalid_integer",
    path,
    `${minimum}..${maximum} 범위의 안전한 정수가 필요합니다.`
  );
}

function assertEventOrder(value: unknown, path: string): asserts value is StudioRasterEventOrder {
  assertExactKeys(value, ["logicalClock", "actorId"], [], path);
  expectContract(
    typeof value.logicalClock === "string" && DECIMAL_CLOCK_PATTERN.test(value.logicalClock)
      && (value.logicalClock.length < MAX_UINT64_DECIMAL.length
        || value.logicalClock <= MAX_UINT64_DECIMAL),
    "invalid_clock",
    `${path}.logicalClock`,
    "부호 없는 정규 십진 Lamport 시계가 필요합니다."
  );
  assertSafeId(value.actorId, `${path}.actorId`);
}

function assertSurface(value: unknown, path: string): asserts value is StudioRasterSurfaceSpec {
  assertExactKeys(value, ["version", "surfaceId", "width", "height", "tileSize"], [], path);
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertSafeId(value.surfaceId, `${path}.surfaceId`);
  assertInteger(value.width, 1, STUDIO_RASTER_MAX_SURFACE_DIMENSION, `${path}.width`);
  assertInteger(value.height, 1, STUDIO_RASTER_MAX_SURFACE_DIMENSION, `${path}.height`);
  assertInteger(value.tileSize, STUDIO_RASTER_MIN_TILE_SIZE, STUDIO_RASTER_MAX_TILE_SIZE, `${path}.tileSize`);
  expectContract(
    (value.tileSize & (value.tileSize - 1)) === 0,
    "invalid_tile_size",
    `${path}.tileSize`,
    "타일 크기는 2의 거듭제곱이어야 합니다."
  );
  const tileCount = Math.ceil(value.width / value.tileSize) * Math.ceil(value.height / value.tileSize);
  expectContract(
    tileCount <= STUDIO_RASTER_MAX_SURFACE_TILES,
    "surface_tile_limit",
    path,
    "표면 타일 수가 허용 한도를 초과했습니다."
  );
}

/** Validates the exact, transport-safe surface shape shared by browser and API code. */
export function assertStudioRasterSurfaceSpec(
  value: unknown,
  path = "surface"
): asserts value is StudioRasterSurfaceSpec {
  assertSurface(value, path);
}

export function assertStudioRasterAssetReference(
  value: unknown,
  path = "asset"
): asserts value is StudioRasterAssetReference {
  assertExactKeys(
    value,
    ["scope", "assetId", "sha256", "byteLength", "mediaType", "width", "height"],
    [],
    path
  );
  expectContract(value.scope === "work", "invalid_asset_scope", `${path}.scope`, "자산은 작업 범위여야 합니다.");
  assertSafeId(value.assetId, `${path}.assetId`);
  assertSha256(value.sha256, `${path}.sha256`);
  assertInteger(value.byteLength, 1, STUDIO_RASTER_MAX_ASSET_BYTES, `${path}.byteLength`);
  expectContract(
    (STUDIO_RASTER_ASSET_MEDIA_TYPES as readonly unknown[]).includes(value.mediaType),
    "invalid_media_type",
    `${path}.mediaType`,
    "지원하지 않는 타일 자산 형식입니다."
  );
  assertInteger(value.width, 1, STUDIO_RASTER_MAX_TILE_SIZE, `${path}.width`);
  assertInteger(value.height, 1, STUDIO_RASTER_MAX_TILE_SIZE, `${path}.height`);
}

function assertRegion(value: unknown, path: string): asserts value is StudioRasterTileRegion {
  assertExactKeys(value, ["x", "y", "width", "height"], [], path);
  assertInteger(value.x, 0, STUDIO_RASTER_MAX_TILE_SIZE - 1, `${path}.x`);
  assertInteger(value.y, 0, STUDIO_RASTER_MAX_TILE_SIZE - 1, `${path}.y`);
  assertInteger(value.width, 1, STUDIO_RASTER_MAX_TILE_SIZE, `${path}.width`);
  assertInteger(value.height, 1, STUDIO_RASTER_MAX_TILE_SIZE, `${path}.height`);
}

function actualTileDimension(fullDimension: number, tileSize: number, tileIndex: number): number {
  return Math.min(tileSize, fullDimension - tileIndex * tileSize);
}

function assertPatch(
  value: unknown,
  surface: StudioRasterSurfaceSpec,
  intent: StudioRasterIntent,
  path: string
): asserts value is StudioRasterTilePatch {
  assertExactKeys(value, ["tileX", "tileY", "region", "effect"], ["selectionMask"], path);
  const columns = Math.ceil(surface.width / surface.tileSize);
  const rows = Math.ceil(surface.height / surface.tileSize);
  assertInteger(value.tileX, 0, columns - 1, `${path}.tileX`);
  assertInteger(value.tileY, 0, rows - 1, `${path}.tileY`);
  assertRegion(value.region, `${path}.region`);
  const tileWidth = actualTileDimension(surface.width, surface.tileSize, value.tileX);
  const tileHeight = actualTileDimension(surface.height, surface.tileSize, value.tileY);
  expectContract(
    value.region.x + value.region.width <= tileWidth && value.region.y + value.region.height <= tileHeight,
    "patch_out_of_bounds",
    `${path}.region`,
    "패치가 타일 경계를 벗어났습니다."
  );

  assertExactKeys(value.effect, ["kind"], ["blendMode", "baseTileSha256", "payload"], `${path}.effect`);
  expectContract(Object.hasOwn(value.effect, "payload"), "missing_field", `${path}.effect.payload`, "패치 자산이 필요합니다.");
  assertStudioRasterAssetReference(value.effect.payload, `${path}.effect.payload`);
  expectContract(
    value.effect.payload.width === value.region.width && value.effect.payload.height === value.region.height,
    "asset_dimension_mismatch",
    `${path}.effect.payload`,
    "패치 자산 크기는 패치 영역과 일치해야 합니다."
  );
  if (value.effect.kind === "composite") {
    assertExactKeys(value.effect, ["kind", "blendMode", "payload"], [], `${path}.effect`);
    expectContract(
      value.effect.blendMode === "source-over" || value.effect.blendMode === "destination-out",
      "invalid_blend_mode",
      `${path}.effect.blendMode`,
      "결정적 합성 모드가 필요합니다."
    );
  } else if (value.effect.kind === "replace") {
    assertExactKeys(value.effect, ["kind", "baseTileSha256", "payload"], [], `${path}.effect`);
    assertSha256(value.effect.baseTileSha256, `${path}.effect.baseTileSha256`);
  } else {
    fail("invalid_effect", `${path}.effect.kind`, "지원하지 않는 타일 효과입니다.");
  }

  const selectionIntent = intent.startsWith("selection-");
  expectContract(
    selectionIntent === Object.hasOwn(value, "selectionMask"),
    "selection_mask_contract",
    `${path}.selectionMask`,
    selectionIntent ? "선택 편집에는 타일 선택 마스크가 필요합니다." : "선택 편집 외 작업에는 선택 마스크를 넣을 수 없습니다."
  );
  if (selectionIntent) {
    assertStudioRasterAssetReference(value.selectionMask, `${path}.selectionMask`);
    expectContract(
      value.selectionMask.width === value.region.width && value.selectionMask.height === value.region.height,
      "asset_dimension_mismatch",
      `${path}.selectionMask`,
      "선택 마스크 크기는 패치 영역과 일치해야 합니다."
    );
  }

  const effect = value.effect as unknown as StudioRasterTileEffect;
  const requiresReplace = intent === "filter" || intent === "selection-filter" || intent === "transform" || intent === "merge" || intent === "flatten";
  expectContract(
    requiresReplace ? effect.kind === "replace" : effect.kind === "composite",
    "intent_effect_mismatch",
    `${path}.effect.kind`,
    requiresReplace ? "파괴적 파생 편집은 base hash가 있는 replace 패치여야 합니다." : "이 편집은 재생 가능한 composite 패치여야 합니다."
  );
  if (effect.kind === "composite") {
    const expectsErase = intent === "erase" || intent === "clear" || intent === "selection-clear";
    expectContract(
      effect.blendMode === (expectsErase ? "destination-out" : "source-over"),
      "intent_blend_mismatch",
      `${path}.effect.blendMode`,
      "편집 의미와 합성 모드가 일치하지 않습니다."
    );
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_number", "value", "유한한 JSON 숫자가 필요합니다.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  fail("invalid_json", "value", "정규 JSON 값만 직렬화할 수 있습니다.");
}

export function canonicalStudioRasterJson(value: unknown): string {
  return stableJson(value);
}

function uniqueReferencedAssets(operation: StudioRasterOperation): StudioRasterAssetReference[] {
  const byId = new Map<string, StudioRasterAssetReference>();
  const add = (asset: StudioRasterAssetReference, path: string) => {
    const existing = byId.get(asset.assetId);
    if (existing && stableJson(existing) !== stableJson(asset)) {
      fail("asset_identity_conflict", path, "같은 assetId가 서로 다른 내용 해시나 메타데이터를 가리킵니다.");
    }
    byId.set(asset.assetId, asset);
  };
  operation.patches.forEach((patch, index) => {
    add(patch.effect.payload, `operation.patches[${index}].effect.payload`);
    if (patch.selectionMask) add(patch.selectionMask, `operation.patches[${index}].selectionMask`);
  });
  return [...byId.values()];
}

export function assertStudioRasterOperation(
  value: unknown,
  surface: StudioRasterSurfaceSpec,
  path = "operation"
): asserts value is StudioRasterOperation {
  assertExactKeys(
    value,
    ["version", "operationId", "order", "pageId", "layerId", "intent", "kernel", "semanticParametersSha256", "patches"],
    [],
    path
  );
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertUuid(value.operationId, `${path}.operationId`);
  assertEventOrder(value.order, `${path}.order`);
  assertSafeId(value.pageId, `${path}.pageId`);
  assertSafeId(value.layerId, `${path}.layerId`);
  expectContract(
    (STUDIO_RASTER_INTENTS as readonly unknown[]).includes(value.intent),
    "invalid_intent",
    `${path}.intent`,
    "지원하지 않는 래스터 편집 의미입니다."
  );
  expectContract(value.kernel === STUDIO_RASTER_KERNEL, "invalid_kernel", `${path}.kernel`, "결정적 래스터 커널 버전이 일치하지 않습니다.");
  assertSha256(value.semanticParametersSha256, `${path}.semanticParametersSha256`);
  expectContract(
    Array.isArray(value.patches) && value.patches.length > 0 && value.patches.length <= STUDIO_RASTER_MAX_PATCHES_PER_OPERATION,
    "patch_count_limit",
    `${path}.patches`,
    "작업별 패치 수가 허용 범위를 벗어났습니다."
  );
  value.patches.forEach((patch, index) => assertPatch(patch, surface, value.intent as StudioRasterIntent, `${path}.patches[${index}]`));
  const replaceBaseByTile = new Map<string, string>();
  (value.patches as StudioRasterTilePatch[]).forEach((patch) => {
    if (patch.effect.kind !== "replace") return;
    const tile = `${patch.tileX}:${patch.tileY}`;
    const previous = replaceBaseByTile.get(tile);
    expectContract(
      previous === undefined || previous === patch.effect.baseTileSha256,
      "replace_base_conflict",
      `${path}.patches`,
      "한 작업 안의 동일 타일 replace 패치는 같은 base hash를 사용해야 합니다."
    );
    replaceBaseByTile.set(tile, patch.effect.baseTileSha256);
  });
  const descriptorBytes = TEXT_ENCODER.encode(stableJson(value)).byteLength;
  expectContract(
    descriptorBytes <= STUDIO_RASTER_MAX_OPERATION_DESCRIPTOR_BYTES,
    "operation_descriptor_limit",
    path,
    "작업 설명자가 CRDT 업데이트 예산을 초과했습니다."
  );
  const referencedBytes = uniqueReferencedAssets(value as unknown as StudioRasterOperation)
    .reduce((sum, asset) => sum + asset.byteLength, 0);
  expectContract(
    referencedBytes <= STUDIO_RASTER_MAX_OPERATION_REFERENCED_BYTES,
    "operation_asset_budget",
    path,
    "작업이 참조하는 고유 자산 바이트가 허용 한도를 초과했습니다."
  );
}

function eventTuple(event: { readonly order: StudioRasterEventOrder }, eventId: string) {
  return { logicalClock: event.order.logicalClock, actorId: event.order.actorId, eventId };
}

function compareDecimalClock(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareStudioRasterEventOrder(
  left: { readonly logicalClock: string; readonly actorId: string; readonly eventId: string },
  right: { readonly logicalClock: string; readonly actorId: string; readonly eventId: string }
): number {
  const clock = compareDecimalClock(left.logicalClock, right.logicalClock);
  if (clock !== 0) return clock;
  if (left.actorId !== right.actorId) return left.actorId < right.actorId ? -1 : 1;
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
}

export function compareStudioRasterOperations(left: StudioRasterOperation, right: StudioRasterOperation): number {
  return compareStudioRasterEventOrder(
    eventTuple(left, left.operationId),
    eventTuple(right, right.operationId)
  );
}

function assertUndoOperation(value: unknown, path: string): asserts value is StudioRasterUndoOperation {
  assertExactKeys(value, ["version", "undoOperationId", "targetOperationId", "order"], [], path);
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertUuid(value.undoOperationId, `${path}.undoOperationId`);
  assertUuid(value.targetOperationId, `${path}.targetOperationId`);
  assertEventOrder(value.order, `${path}.order`);
}

function assertUndoAcknowledgement(value: unknown, path: string): asserts value is StudioRasterUndoAcknowledgement {
  assertExactKeys(value, ["version", "acknowledgementId", "undoOperationId", "targetOperationId", "order"], [], path);
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertUuid(value.acknowledgementId, `${path}.acknowledgementId`);
  assertUuid(value.undoOperationId, `${path}.undoOperationId`);
  assertUuid(value.targetOperationId, `${path}.targetOperationId`);
  assertEventOrder(value.order, `${path}.order`);
}

function assertUnique<T>(items: readonly T[], id: (item: T) => string, path: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    const value = id(item);
    expectContract(!ids.has(value), "duplicate_id", path, `중복 식별자 ${value}가 있습니다.`);
    ids.add(value);
  }
}

export function assertStudioRasterOperationLog(
  value: unknown,
  path = "log"
): asserts value is StudioRasterOperationLog {
  assertExactKeys(value, ["version", "surface", "operations", "undoOperations", "undoAcknowledgements"], [], path);
  expectContract(value.version === STUDIO_RASTER_CRDT_VERSION, "invalid_version", `${path}.version`, "지원하지 않는 버전입니다.");
  assertSurface(value.surface, `${path}.surface`);
  expectContract(Array.isArray(value.operations) && value.operations.length <= STUDIO_RASTER_MAX_OPERATIONS, "operation_count_limit", `${path}.operations`, "작업 수가 허용 한도를 초과했습니다.");
  expectContract(Array.isArray(value.undoOperations) && value.undoOperations.length <= STUDIO_RASTER_MAX_UNDO_OPERATIONS, "undo_count_limit", `${path}.undoOperations`, "실행 취소 작업 수가 허용 한도를 초과했습니다.");
  expectContract(Array.isArray(value.undoAcknowledgements) && value.undoAcknowledgements.length <= STUDIO_RASTER_MAX_UNDO_OPERATIONS, "undo_ack_count_limit", `${path}.undoAcknowledgements`, "복원 확인 수가 허용 한도를 초과했습니다.");

  value.operations.forEach((operation, index) => assertStudioRasterOperation(operation, value.surface as StudioRasterSurfaceSpec, `${path}.operations[${index}]`));
  value.undoOperations.forEach((operation, index) => assertUndoOperation(operation, `${path}.undoOperations[${index}]`));
  value.undoAcknowledgements.forEach((acknowledgement, index) => assertUndoAcknowledgement(acknowledgement, `${path}.undoAcknowledgements[${index}]`));

  const operations = value.operations as StudioRasterOperation[];
  const undoOperations = value.undoOperations as StudioRasterUndoOperation[];
  const acknowledgements = value.undoAcknowledgements as StudioRasterUndoAcknowledgement[];
  assertUnique(operations, (operation) => operation.operationId, `${path}.operations`);
  assertUnique(undoOperations, (operation) => operation.undoOperationId, `${path}.undoOperations`);
  assertUnique(acknowledgements, (acknowledgement) => acknowledgement.acknowledgementId, `${path}.undoAcknowledgements`);
  assertUnique(
    [
      ...operations.map((operation) => ({ eventId: operation.operationId })),
      ...undoOperations.map((operation) => ({ eventId: operation.undoOperationId })),
      ...acknowledgements.map((acknowledgement) => ({ eventId: acknowledgement.acknowledgementId })),
    ],
    (event) => event.eventId,
    `${path}.events`
  );

  const patchCount = operations.reduce((sum, operation) => sum + operation.patches.length, 0);
  expectContract(patchCount <= STUDIO_RASTER_MAX_TOTAL_PATCHES, "total_patch_limit", `${path}.operations`, "전체 타일 패치 수가 허용 한도를 초과했습니다.");
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const undoById = new Map(undoOperations.map((operation) => [operation.undoOperationId, operation]));

  for (const undo of undoOperations) {
    const target = operationById.get(undo.targetOperationId);
    expectContract(Boolean(target), "orphan_undo", `${path}.undoOperations`, "대상 작업이 없는 실행 취소가 있습니다.");
    expectContract(undo.order.actorId === target!.order.actorId, "undo_owner_mismatch", `${path}.undoOperations`, "작업 작성자만 실행 취소할 수 있습니다.");
    expectContract(
      compareStudioRasterEventOrder(eventTuple(undo, undo.undoOperationId), eventTuple(target!, target!.operationId)) > 0,
      "undo_order_invalid",
      `${path}.undoOperations`,
      "실행 취소는 대상 작업 뒤에 정렬되어야 합니다."
    );
  }
  for (const acknowledgement of acknowledgements) {
    const undo = undoById.get(acknowledgement.undoOperationId);
    expectContract(Boolean(undo), "orphan_undo_ack", `${path}.undoAcknowledgements`, "대상 실행 취소가 없는 복원 확인이 있습니다.");
    expectContract(acknowledgement.targetOperationId === undo!.targetOperationId, "undo_ack_target_mismatch", `${path}.undoAcknowledgements`, "복원 확인의 작업 대상이 일치하지 않습니다.");
    expectContract(acknowledgement.order.actorId === undo!.order.actorId, "undo_ack_owner_mismatch", `${path}.undoAcknowledgements`, "작업 작성자만 실행 취소를 복원할 수 있습니다.");
    expectContract(
      compareStudioRasterEventOrder(eventTuple(acknowledgement, acknowledgement.acknowledgementId), eventTuple(undo!, undo!.undoOperationId)) > 0,
      "undo_ack_order_invalid",
      `${path}.undoAcknowledgements`,
      "복원 확인은 대상 실행 취소 뒤에 정렬되어야 합니다."
    );
  }

  const assetsById = new Map<string, StudioRasterAssetReference>();
  let totalAssetBytes = 0;
  for (const operation of operations) {
    for (const asset of uniqueReferencedAssets(operation)) {
      const existing = assetsById.get(asset.assetId);
      if (existing) {
        expectContract(stableJson(existing) === stableJson(asset), "asset_identity_conflict", `${path}.operations`, "같은 assetId가 문서에서 다른 자산을 가리킵니다.");
      } else {
        assetsById.set(asset.assetId, asset);
        totalAssetBytes += asset.byteLength;
      }
    }
  }
  expectContract(totalAssetBytes <= STUDIO_RASTER_MAX_DOCUMENT_REFERENCED_BYTES, "document_asset_budget", `${path}.operations`, "문서가 참조하는 고유 자산 바이트가 허용 한도를 초과했습니다.");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sortedLog(log: StudioRasterOperationLog): StudioRasterOperationLog {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: log.surface,
    operations: [...log.operations].sort(compareStudioRasterOperations),
    undoOperations: [...log.undoOperations].sort((left, right) => compareStudioRasterEventOrder(
      eventTuple(left, left.undoOperationId),
      eventTuple(right, right.undoOperationId)
    )),
    undoAcknowledgements: [...log.undoAcknowledgements].sort((left, right) => compareStudioRasterEventOrder(
      eventTuple(left, left.acknowledgementId),
      eventTuple(right, right.acknowledgementId)
    )),
  };
}

export function createStudioRasterOperationLog(value: StudioRasterOperationLog): StudioRasterOperationLog {
  assertStudioRasterOperationLog(value);
  return deepFreeze(sortedLog(cloneJson(value)));
}

function mergeImmutableById<T>(
  groups: readonly (readonly T[])[],
  idOf: (value: T) => string,
  path: string
): T[] {
  const merged = new Map<string, T>();
  for (const group of groups) {
    for (const value of group) {
      const id = idOf(value);
      const existing = merged.get(id);
      if (existing && stableJson(existing) !== stableJson(value)) {
        fail("immutable_identity_conflict", path, `불변 이벤트 ${id}의 내용이 복제본마다 다릅니다.`);
      }
      merged.set(id, value);
    }
  }
  return [...merged.values()];
}

/** Set union with immutable-identity checks. Result order is independent from replica input order. */
export function mergeStudioRasterOperationLogs(
  replicas: readonly StudioRasterOperationLog[]
): StudioRasterOperationLog {
  expectContract(replicas.length > 0, "empty_merge", "replicas", "병합할 복제본이 없습니다.");
  replicas.forEach((replica, index) => assertStudioRasterOperationLog(replica, `replicas[${index}]`));
  const surfaceJson = stableJson(replicas[0]!.surface);
  expectContract(
    replicas.every((replica) => stableJson(replica.surface) === surfaceJson),
    "surface_mismatch",
    "replicas",
    "서로 다른 래스터 표면은 병합할 수 없습니다."
  );
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: replicas[0]!.surface,
    operations: mergeImmutableById(replicas.map((replica) => replica.operations), (value) => value.operationId, "operations"),
    undoOperations: mergeImmutableById(replicas.map((replica) => replica.undoOperations), (value) => value.undoOperationId, "undoOperations"),
    undoAcknowledgements: mergeImmutableById(replicas.map((replica) => replica.undoAcknowledgements), (value) => value.acknowledgementId, "undoAcknowledgements"),
  });
}

export function studioRasterUndoneOperationIds(log: StudioRasterOperationLog): ReadonlySet<string> {
  assertStudioRasterOperationLog(log);
  const acknowledgedUndoIds = new Set(log.undoAcknowledgements.map((acknowledgement) => acknowledgement.undoOperationId));
  return new Set(
    log.undoOperations
      .filter((undo) => !acknowledgedUndoIds.has(undo.undoOperationId))
      .map((undo) => undo.targetOperationId)
  );
}

/**
 * Replays active immutable operations. All replace preconditions are checked before any patch in
 * that operation is applied, preventing a multi-tile filter/transform from partially committing.
 */
export function replayStudioRasterOperationLog(
  value: StudioRasterOperationLog,
  adapter: StudioRasterReplayAdapter
): StudioRasterReplayResult {
  const log = createStudioRasterOperationLog(value);
  const undone = studioRasterUndoneOperationIds(log);
  const appliedOperationIds: string[] = [];
  const conflictedOperationIds: string[] = [];
  let appliedPatchCount = 0;

  log.operations.forEach((operation, operationIndex) => {
    if (undone.has(operation.operationId)) return;
    const tileHashes = new Map<string, string | null>();
    const hasBaseConflict = operation.patches.some((patch) => {
      if (patch.effect.kind !== "replace") return false;
      const tile = `${patch.tileX}:${patch.tileY}`;
      if (!tileHashes.has(tile)) {
        tileHashes.set(tile, adapter.readTileSha256({
          surfaceId: log.surface.surfaceId,
          tileX: patch.tileX,
          tileY: patch.tileY,
        }));
      }
      return tileHashes.get(tile) !== patch.effect.baseTileSha256;
    });
    if (hasBaseConflict) {
      conflictedOperationIds.push(operation.operationId);
      return;
    }
    operation.patches.forEach((patch, patchIndex) => {
      adapter.applyPatch({ operation, operationIndex, patch, patchIndex });
      appliedPatchCount += 1;
    });
    appliedOperationIds.push(operation.operationId);
  });

  return deepFreeze({
    appliedOperationIds,
    undoneOperationIds: [...undone].sort(),
    conflictedOperationIds,
    appliedPatchCount,
  });
}
