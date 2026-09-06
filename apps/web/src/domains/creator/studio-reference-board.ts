/**
 * Project-owned reference-board content.
 *
 * The document deliberately excludes panel geometry, open/closed state, picker search text and the
 * currently selected item. Those are device-local workspace concerns. The `items` array is the
 * only z-order authority: index 0 is the back-most reference and the last item is front-most.
 *
 * Binary data never crosses this boundary. A reference is identified by a canonical SHA-256
 * descriptor and may carry bounded display/resolution hints; the asset library or project archive
 * resolves the actual bytes separately.
 */

export const STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION = 1 as const;
export const STUDIO_REFERENCE_BOARD_MAX_ITEMS = 32;
export const STUDIO_REFERENCE_BOARD_MAX_SERIALIZED_BYTES = 32 * 1_024;
export const STUDIO_REFERENCE_BOARD_MIN_ZOOM = 0.05;
export const STUDIO_REFERENCE_BOARD_MAX_ZOOM = 32;
export const STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION = 100_000;

const MAX_NORMALIZE_SCAN_ITEMS = STUDIO_REFERENCE_BOARD_MAX_ITEMS * 8;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_NAME_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;
const SHA256_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/iu;
const IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
const UNSAFE_SCHEME_PATTERN = /^(?:blob|data|javascript):/iu;

const ROOT_REQUIRED_KEYS = ["version", "items"] as const;
const ITEM_REQUIRED_KEYS = ["id", "asset", "view"] as const;
const ASSET_REQUIRED_KEYS = ["sha256"] as const;
const ASSET_OPTIONAL_KEYS = ["assetId", "name", "mimeType", "width", "height"] as const;
const VIEW_REQUIRED_KEYS = [
  "centerX",
  "centerY",
  "zoom",
  "rotationDeg",
  "flipX",
  "flipY",
  "opacity",
  "grayscale",
] as const;

export type StudioReferenceBoardSha256 = `sha256:${string}`;

export interface StudioReferenceBoardAssetDescriptor {
  /** Canonical lowercase `sha256:<64 hex characters>` content identity. */
  sha256: StudioReferenceBoardSha256;
  /** Optional device-local lookup hint. SHA-256 remains authoritative. */
  assetId?: string;
  /** Optional, bounded display label. */
  name?: string;
  /** Optional canonical image MIME hint; imported bytes must still be independently verified. */
  mimeType?: string;
  /** Optional intrinsic pixel dimensions. They are either both present or both absent. */
  width?: number;
  height?: number;
}

export interface StudioReferenceBoardItemView {
  /** Item center in board viewport coordinates, normalized to the inclusive 0…1 range. */
  centerX: number;
  centerY: number;
  zoom: number;
  /** Canonical rotation in the half-open -180°…180° range. */
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  grayscale: boolean;
}

export interface StudioReferenceBoardItem {
  id: string;
  asset: StudioReferenceBoardAssetDescriptor;
  view: StudioReferenceBoardItemView;
}

export interface StudioReferenceBoardDocument {
  version: typeof STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION;
  /** Back-to-front z-order. */
  items: StudioReferenceBoardItem[];
}

export interface StudioReferenceBoardItemPatch {
  asset?: Partial<StudioReferenceBoardAssetDescriptor>;
  view?: Partial<StudioReferenceBoardItemView>;
}

export const DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW = Object.freeze({
  centerX: 0.5,
  centerY: 0.5,
  zoom: 1,
  rotationDeg: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  grayscale: false,
}) satisfies Readonly<StudioReferenceBoardItemView>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedUnit(value: unknown, fallback: number): number {
  return clamp(finiteNumber(value, fallback), 0, 1);
}

function normalizedZoom(value: unknown, fallback: number): number {
  return clamp(
    finiteNumber(value, fallback),
    STUDIO_REFERENCE_BOARD_MIN_ZOOM,
    STUDIO_REFERENCE_BOARD_MAX_ZOOM
  );
}

export function normalizeStudioReferenceBoardRotation(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function isSafeText(value: unknown, maximumLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    UNSAFE_SCHEME_PATTERN.test(value)
  ) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function isSafeIdentifier(value: unknown): value is string {
  return isSafeText(value, MAX_IDENTIFIER_LENGTH)
    && value !== "__proto__"
    && value !== "constructor"
    && value !== "prototype";
}

function normalizedOptionalText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return isSafeText(normalized, maximumLength) ? normalized : undefined;
}

export function canonicalizeStudioReferenceBoardSha256(
  value: unknown
): StudioReferenceBoardSha256 | null {
  if (typeof value !== "string") return null;
  const match = SHA256_PATTERN.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function normalizedMimeType(value: unknown): string | undefined {
  const normalized = normalizedOptionalText(value, MAX_MIME_TYPE_LENGTH)?.toLowerCase();
  return normalized && IMAGE_MIME_TYPE_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizedDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return clamp(Math.round(value), 1, STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION);
}

/** Reads only own enumerable data properties and never invokes getters. */
function tolerantDataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return {};
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor && descriptor.enumerable) {
        result[key] = descriptor.value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Reads a bounded dense/sparse array without invoking accessor-backed entries. */
function tolerantArrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const result: unknown[] = [];
  try {
    const scanLength = Math.min(value.length, MAX_NORMALIZE_SCAN_ITEMS);
    for (let index = 0; index < scanLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor && "value" in descriptor && descriptor.enumerable) {
        result.push(descriptor.value);
      }
    }
  } catch {
    return [];
  }
  return result;
}

function strictDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
      || requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
      return null;
    }
    for (const key of ownKeys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function strictArrayValues(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length > STUDIO_REFERENCE_BOARD_MAX_ITEMS) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== length + 1
      || !ownKeys.includes("length")
      || ownKeys.some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= length;
      })
    ) {
      return null;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function normalizeAssetDescriptor(value: unknown): StudioReferenceBoardAssetDescriptor | null {
  const source = tolerantDataRecord(value);
  const sha256 = canonicalizeStudioReferenceBoardSha256(source.sha256 ?? source.hash);
  if (!sha256) return null;

  const assetId = normalizedOptionalText(source.assetId, MAX_IDENTIFIER_LENGTH);
  const name = normalizedOptionalText(source.name, MAX_NAME_LENGTH);
  const mimeType = normalizedMimeType(source.mimeType ?? source.mediaType);
  const width = normalizedDimension(source.width);
  const height = normalizedDimension(source.height);
  const dimensions = width !== undefined && height !== undefined ? { width, height } : {};

  return {
    sha256,
    ...(assetId && isSafeIdentifier(assetId) ? { assetId } : {}),
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...dimensions,
  };
}

function normalizeItemView(value: unknown): StudioReferenceBoardItemView {
  const source = tolerantDataRecord(value);
  return {
    centerX: normalizedUnit(source.centerX ?? source.x, DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW.centerX),
    centerY: normalizedUnit(source.centerY ?? source.y, DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW.centerY),
    zoom: normalizedZoom(source.zoom, DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW.zoom),
    rotationDeg: normalizeStudioReferenceBoardRotation(source.rotationDeg ?? source.rotation),
    flipX: source.flipX === true || source.flipped === true,
    flipY: source.flipY === true,
    opacity: normalizedUnit(source.opacity, DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW.opacity),
    grayscale: source.grayscale === true,
  };
}

function normalizeItem(value: unknown): StudioReferenceBoardItem | null {
  const source = tolerantDataRecord(value);
  if (!isSafeIdentifier(source.id)) return null;
  const assetSource = Object.hasOwn(source, "asset") ? source.asset : source;
  const asset = normalizeAssetDescriptor(assetSource);
  if (!asset) return null;
  const viewSource = Object.hasOwn(source, "view") ? source.view : source;
  return { id: source.id, asset, view: normalizeItemView(viewSource) };
}

function strictAssetDescriptor(value: unknown): StudioReferenceBoardAssetDescriptor | null {
  const source = strictDataRecord(value, ASSET_REQUIRED_KEYS, ASSET_OPTIONAL_KEYS);
  if (!source) return null;
  const sha256 = canonicalizeStudioReferenceBoardSha256(source.sha256);
  if (sha256 === null || source.sha256 !== sha256) return null;

  const hasAssetId = Object.hasOwn(source, "assetId");
  const hasName = Object.hasOwn(source, "name");
  const hasMimeType = Object.hasOwn(source, "mimeType");
  if (hasAssetId && !isSafeIdentifier(source.assetId)) return null;
  if (hasName && !isSafeText(source.name, MAX_NAME_LENGTH)) return null;
  if (
    hasMimeType
    && (typeof source.mimeType !== "string" || normalizedMimeType(source.mimeType) !== source.mimeType)
  ) {
    return null;
  }
  const hasWidth = Object.hasOwn(source, "width");
  const hasHeight = Object.hasOwn(source, "height");
  if (hasWidth !== hasHeight) return null;
  if (
    hasWidth
    && (
      typeof source.width !== "number"
      || !Number.isSafeInteger(source.width)
      || source.width <= 0
      || source.width > STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION
      || typeof source.height !== "number"
      || !Number.isSafeInteger(source.height)
      || source.height <= 0
      || source.height > STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION
    )
  ) {
    return null;
  }

  return {
    sha256,
    ...(hasAssetId && typeof source.assetId === "string" ? { assetId: source.assetId } : {}),
    ...(hasName && typeof source.name === "string" ? { name: source.name } : {}),
    ...(hasMimeType && typeof source.mimeType === "string" ? { mimeType: source.mimeType } : {}),
    ...(typeof source.width === "number" && typeof source.height === "number"
      ? { width: source.width, height: source.height }
      : {}),
  };
}

function strictItemView(value: unknown): StudioReferenceBoardItemView | null {
  const source = strictDataRecord(value, VIEW_REQUIRED_KEYS);
  if (!source) return null;
  if (
    typeof source.centerX !== "number" || !Number.isFinite(source.centerX)
    || source.centerX < 0 || source.centerX > 1
    || typeof source.centerY !== "number" || !Number.isFinite(source.centerY)
    || source.centerY < 0 || source.centerY > 1
    || typeof source.zoom !== "number" || !Number.isFinite(source.zoom)
    || source.zoom < STUDIO_REFERENCE_BOARD_MIN_ZOOM
    || source.zoom > STUDIO_REFERENCE_BOARD_MAX_ZOOM
    || typeof source.rotationDeg !== "number" || !Number.isFinite(source.rotationDeg)
    || source.rotationDeg < -180 || source.rotationDeg >= 180
    || Object.is(source.rotationDeg, -0)
    || typeof source.flipX !== "boolean"
    || typeof source.flipY !== "boolean"
    || typeof source.opacity !== "number" || !Number.isFinite(source.opacity)
    || source.opacity < 0 || source.opacity > 1
    || typeof source.grayscale !== "boolean"
  ) {
    return null;
  }
  return {
    centerX: source.centerX,
    centerY: source.centerY,
    zoom: source.zoom,
    rotationDeg: source.rotationDeg,
    flipX: source.flipX,
    flipY: source.flipY,
    opacity: source.opacity,
    grayscale: source.grayscale,
  };
}

function strictItem(value: unknown): StudioReferenceBoardItem | null {
  const source = strictDataRecord(value, ITEM_REQUIRED_KEYS);
  if (!source || !isSafeIdentifier(source.id)) return null;
  const asset = strictAssetDescriptor(source.asset);
  const view = strictItemView(source.view);
  return asset && view ? { id: source.id, asset, view } : null;
}

export function createDefaultStudioReferenceBoardDocument(): StudioReferenceBoardDocument {
  return { version: STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION, items: [] };
}

export function createStudioReferenceBoardItem(value: unknown): StudioReferenceBoardItem | null {
  return normalizeItem(value);
}

export function createStudioReferenceBoardDocument(
  items: readonly StudioReferenceBoardItem[] = []
): StudioReferenceBoardDocument {
  return normalizeStudioReferenceBoardDocument({
    version: STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION,
    items,
  });
}

/**
 * Tolerant hydration for legacy/local data. Invalid references are dropped, duplicate item IDs keep
 * their first occurrence, transforms are clamped, and raw/uppercase SHA-256 values are canonicalized.
 */
export function normalizeStudioReferenceBoardDocument(
  value: unknown
): StudioReferenceBoardDocument {
  const source = tolerantDataRecord(value);
  if (
    Object.hasOwn(source, "version")
    && source.version !== STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION
  ) {
    return createDefaultStudioReferenceBoardDocument();
  }
  const rawItems = Object.hasOwn(source, "items") ? source.items : source.references;
  const items: StudioReferenceBoardItem[] = [];
  const itemIds = new Set<string>();
  for (const candidate of tolerantArrayValues(rawItems)) {
    if (items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS) break;
    const item = normalizeItem(candidate);
    if (!item || itemIds.has(item.id)) continue;
    itemIds.add(item.id);
    items.push(item);
  }
  return { version: STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION, items };
}

/** Strict import/shared-document boundary. It accepts canonical v1 data only. */
export function parseStudioReferenceBoardDocument(
  value: unknown
): StudioReferenceBoardDocument | null {
  const source = strictDataRecord(value, ROOT_REQUIRED_KEYS);
  if (!source || source.version !== STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION) return null;
  const rawItems = strictArrayValues(source.items);
  if (!rawItems) return null;

  const itemIds = new Set<string>();
  const items: StudioReferenceBoardItem[] = [];
  for (const candidate of rawItems) {
    const item = strictItem(candidate);
    if (!item || itemIds.has(item.id)) return null;
    itemIds.add(item.id);
    items.push(item);
  }
  const parsed: StudioReferenceBoardDocument = {
    version: STUDIO_REFERENCE_BOARD_DOCUMENT_VERSION,
    items,
  };
  if (
    new TextEncoder().encode(JSON.stringify(parsed)).byteLength
    > STUDIO_REFERENCE_BOARD_MAX_SERIALIZED_BYTES
  ) {
    return null;
  }
  return parsed;
}

export function studioReferenceBoardHasContent(value: unknown): boolean {
  return normalizeStudioReferenceBoardDocument(value).items.length > 0;
}

function optionalFieldsEqual(
  left: StudioReferenceBoardAssetDescriptor,
  right: StudioReferenceBoardAssetDescriptor
): boolean {
  return left.sha256 === right.sha256
    && left.assetId === right.assetId
    && left.name === right.name
    && left.mimeType === right.mimeType
    && left.width === right.width
    && left.height === right.height;
}

function itemViewsEqual(
  left: StudioReferenceBoardItemView,
  right: StudioReferenceBoardItemView
): boolean {
  return left.centerX === right.centerX
    && left.centerY === right.centerY
    && left.zoom === right.zoom
    && left.rotationDeg === right.rotationDeg
    && left.flipX === right.flipX
    && left.flipY === right.flipY
    && left.opacity === right.opacity
    && left.grayscale === right.grayscale;
}

function itemsEqual(left: StudioReferenceBoardItem, right: StudioReferenceBoardItem): boolean {
  return left.id === right.id
    && optionalFieldsEqual(left.asset, right.asset)
    && itemViewsEqual(left.view, right.view);
}

export function areStudioReferenceBoardDocumentsEqual(
  left: StudioReferenceBoardDocument,
  right: StudioReferenceBoardDocument
): boolean {
  return left.version === right.version
    && left.items.length === right.items.length
    && left.items.every((item, index) => {
      const other = right.items[index];
      return other !== undefined && itemsEqual(item, other);
    });
}

function boundedTargetIndex(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return clamp(Math.trunc(value), 0, maximum);
}

export function addStudioReferenceBoardItem(
  document: StudioReferenceBoardDocument,
  value: unknown,
  targetIndex = document.items.length
): StudioReferenceBoardDocument {
  if (document.items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS) return document;
  const item = normalizeItem(value);
  if (!item || document.items.some((candidate) => candidate.id === item.id)) return document;
  const items = document.items.slice();
  items.splice(boundedTargetIndex(targetIndex, items.length), 0, item);
  return { ...document, items };
}

export function removeStudioReferenceBoardItem(
  document: StudioReferenceBoardDocument,
  itemId: string
): StudioReferenceBoardDocument {
  const index = document.items.findIndex((item) => item.id === itemId);
  if (index < 0) return document;
  return {
    ...document,
    items: [...document.items.slice(0, index), ...document.items.slice(index + 1)],
  };
}

export function reorderStudioReferenceBoardItem(
  document: StudioReferenceBoardDocument,
  itemId: string,
  targetIndex: number
): StudioReferenceBoardDocument {
  const currentIndex = document.items.findIndex((item) => item.id === itemId);
  if (currentIndex < 0) return document;
  const items = document.items.slice();
  const [item] = items.splice(currentIndex, 1);
  if (!item) return document;
  const nextIndex = boundedTargetIndex(targetIndex, items.length);
  if (nextIndex === currentIndex) return document;
  items.splice(nextIndex, 0, item);
  return { ...document, items };
}

export function updateStudioReferenceBoardItem(
  document: StudioReferenceBoardDocument,
  itemId: string,
  patch: StudioReferenceBoardItemPatch
): StudioReferenceBoardDocument {
  const index = document.items.findIndex((item) => item.id === itemId);
  if (index < 0) return document;
  const current = document.items[index];
  if (!current) return document;
  const patchRecord = tolerantDataRecord(patch);
  const assetPatch = tolerantDataRecord(patchRecord.asset);
  const viewPatch = tolerantDataRecord(patchRecord.view);
  const next = normalizeItem({
    id: current.id,
    asset: { ...current.asset, ...assetPatch },
    view: { ...current.view, ...viewPatch },
  });
  if (!next || itemsEqual(current, next)) return document;
  const items = document.items.slice();
  items[index] = next;
  return { ...document, items };
}
