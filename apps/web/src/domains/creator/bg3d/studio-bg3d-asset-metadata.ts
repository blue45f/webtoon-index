/**
 * Renderer, storage, and transport-neutral metadata for locally imported 3D assets.
 *
 * The binary SHA-256 is the only asset identity. Local database row IDs, renderer object IDs,
 * marketplace URLs, and credentials must never enter this document.
 */

export const STUDIO_BG3D_ASSET_METADATA_VERSION = 2 as const;

export const STUDIO_BG3D_ASSET_METADATA_LIMITS = Object.freeze({
  assetsPerQuery: 4_096,
  nameCodePoints: 160,
  tags: 32,
  tagCodePoints: 48,
  collections: 32,
  collectionIdCodePoints: 64,
  collectionNameCodePoints: 80,
  rightsTextCodePoints: 160,
  searchCodePoints: 160,
  bytes: 100 * 1024 * 1024,
  triangles: 2_000_000,
  textures: 256,
} as const);

export const STUDIO_BG3D_ASSET_FORMATS = Object.freeze([
  "glb",
  "gltf",
  "obj",
  "fbx",
  "dae",
  "stl",
  "ply",
  "3ds",
] as const);

export type StudioBg3dAssetFormat = (typeof STUDIO_BG3D_ASSET_FORMATS)[number];
export type StudioBg3dAssetRightsStatus = "owned" | "licensed" | "public-domain" | "unknown";
export type StudioBg3dAssetSort = "recent" | "name" | "bytes" | "triangles";

export interface StudioBg3dAssetCollection {
  readonly id: string;
  readonly name: string;
}

/** A deliberately small receipt. It cannot contain a source URL, order ID, token, or secret. */
export interface StudioBg3dAssetRightsReceipt {
  readonly status: StudioBg3dAssetRightsStatus;
  readonly commercialUse: boolean;
  readonly teamShareAllowed: boolean;
  readonly provider?: string;
  readonly author?: string;
  readonly license?: string;
  /** Calendar date only. Precise purchase timestamps and transaction identifiers are excluded. */
  readonly purchaseOrDownloadDate?: string;
}

export interface StudioBg3dAssetMetadata {
  readonly version: typeof STUDIO_BG3D_ASSET_METADATA_VERSION;
  readonly contentHash: `sha256:${string}`;
  readonly name: string;
  readonly format: StudioBg3dAssetFormat;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly byteSize: number;
  /** null means the asset has not been profiled; numeric range facets exclude unknown values. */
  readonly triangles: number | null;
  /** null means the asset has not been profiled; numeric range facets exclude unknown values. */
  readonly textures: number | null;
  readonly favorite: boolean;
  readonly collections: readonly StudioBg3dAssetCollection[];
  readonly tags: readonly string[];
  readonly rights: StudioBg3dAssetRightsReceipt;
}

/**
 * V1 did not encode team redistribution permission and used singular/legacy metric field names.
 * The interface exists only to document the supported migration input; callers should store V2.
 */
export interface StudioBg3dAssetMetadataV1 {
  readonly version: 1;
  readonly contentHash: string;
  readonly name: string;
  readonly format: string;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly byteSize: number;
  readonly triangleCount?: number | null;
  readonly textureCount?: number | null;
  readonly favorite?: boolean;
  readonly collection?: StudioBg3dAssetCollection;
  readonly collections?: readonly StudioBg3dAssetCollection[];
  readonly tags?: readonly string[];
  readonly rights?: Omit<StudioBg3dAssetRightsReceipt, "teamShareAllowed"> & {
    readonly teamShareAllowed?: never;
  };
}

export interface StudioBg3dAssetNumericFacet {
  readonly min?: number;
  readonly max?: number;
}

/** Array-valued facets use OR within the facet; distinct facets are intersected with AND. */
export interface StudioBg3dAssetFacets {
  readonly format?: readonly StudioBg3dAssetFormat[];
  readonly commercial?: boolean;
  readonly triangles?: StudioBg3dAssetNumericFacet;
  readonly textures?: StudioBg3dAssetNumericFacet;
  readonly bytes?: StudioBg3dAssetNumericFacet;
  readonly tags?: readonly string[];
  /** Collection IDs, not display names. */
  readonly collection?: readonly string[];
  readonly favorite?: boolean;
}

export interface StudioBg3dAssetQuery {
  readonly search?: string;
  readonly facets?: StudioBg3dAssetFacets;
  readonly sort?: StudioBg3dAssetSort;
}

const HASH_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/iu;
const COLLECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/u;
const FORBIDDEN_IDS = new Set(["constructor", "prototype", "__proto__"]);
const MARKUP_PATTERN = /[<>]/u;
const EXTERNAL_REFERENCE_PATTERN =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:blob|data|file|javascript):|\bwww\.)/iu;
const SENSITIVE_TEXT_PATTERN =
  /(?:\b(?:api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|client[-_\s]?secret|password|authorization)\b|\bbearer\s+[A-Za-z0-9._~-]{8,}|\b(?:sk|pk)-[A-Za-z0-9_-]{8,})/iu;
const RIGHTS_STATUSES = new Set<StudioBg3dAssetRightsStatus>([
  "owned",
  "licensed",
  "public-domain",
  "unknown",
]);
const ASSET_FORMATS = new Set<StudioBg3dAssetFormat>(STUDIO_BG3D_ASSET_FORMATS);
const ASSET_SORTS = new Set<StudioBg3dAssetSort>(["recent", "name", "bytes", "triangles"]);

export const DEFAULT_STUDIO_BG3D_ASSET_RIGHTS: StudioBg3dAssetRightsReceipt = Object.freeze({
  status: "unknown",
  commercialUse: false,
  teamShareAllowed: false,
});

const EMPTY_METADATA = Object.freeze([]) as readonly StudioBg3dAssetMetadata[];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnsafeControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      codePoint === 0x2060 ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

function normalizeText(value: unknown, maximumCodePoints: number): string | null {
  if (typeof value !== "string" || hasUnsafeControl(value)) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    Array.from(normalized).length > maximumCodePoints ||
    MARKUP_PATTERN.test(normalized) ||
    EXTERNAL_REFERENCE_PATTERN.test(normalized) ||
    SENSITIVE_TEXT_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function folded(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function compareText(left: string, right: string): number {
  const foldedLeft = folded(left);
  const foldedRight = folded(right);
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  return 0;
}

function normalizeFormat(value: unknown): StudioBg3dAssetFormat | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase() as StudioBg3dAssetFormat;
  return ASSET_FORMATS.has(candidate) ? candidate : null;
}

function normalizeSafeInteger(value: unknown, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function normalizeNullableMetric(value: unknown, maximum: number): number | null | undefined {
  if (value === null || value === undefined) return null;
  const normalized = normalizeSafeInteger(value, maximum);
  return normalized === null ? undefined : normalized;
}

function normalizeBoolean(value: unknown, defaultValue = false): boolean | null {
  if (value === undefined) return defaultValue;
  return typeof value === "boolean" ? value : null;
}

function normalizeCollectionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return COLLECTION_ID_PATTERN.test(normalized) && !FORBIDDEN_IDS.has(normalized.toLowerCase())
    ? normalized
    : null;
}

function normalizeCollections(value: unknown): readonly StudioBg3dAssetCollection[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.collections) return null;

  const byId = new Map<string, StudioBg3dAssetCollection>();
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = normalizeCollectionId(item.id);
    const name = normalizeText(item.name, STUDIO_BG3D_ASSET_METADATA_LIMITS.collectionNameCodePoints);
    if (!id || !name) return null;
    const previous = byId.get(id);
    if (previous && previous.name !== name) return null;
    if (!previous) byId.set(id, Object.freeze({ id, name }));
  }

  return Object.freeze([...byId.values()].sort((left, right) => compareText(left.id, right.id)));
}

function normalizeTags(value: unknown): readonly string[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.tags) return null;

  const byFoldedTag = new Map<string, string>();
  for (const item of value) {
    const tag = normalizeText(item, STUDIO_BG3D_ASSET_METADATA_LIMITS.tagCodePoints);
    if (!tag) return null;
    const key = folded(tag);
    if (!byFoldedTag.has(key)) byFoldedTag.set(key, tag);
  }
  return Object.freeze([...byFoldedTag.values()].sort(compareText));
}

function normalizeCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1900 || year > 9_999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

function defaultRights(): StudioBg3dAssetRightsReceipt {
  return DEFAULT_STUDIO_BG3D_ASSET_RIGHTS;
}

function normalizeRights(
  value: unknown,
  options: { readonly forceTeamShareDenied: boolean },
): StudioBg3dAssetRightsReceipt {
  if (value === undefined || value === null) return defaultRights();
  if (!isRecord(value) || typeof value.status !== "string" || !RIGHTS_STATUSES.has(value.status as StudioBg3dAssetRightsStatus)) {
    return defaultRights();
  }

  const status = value.status as StudioBg3dAssetRightsStatus;
  if (status === "unknown") return defaultRights();

  const commercialUse = normalizeBoolean(value.commercialUse);
  const requestedTeamShare = normalizeBoolean(value.teamShareAllowed);
  if (commercialUse === null || requestedTeamShare === null) return defaultRights();

  const optionalText = (key: "provider" | "author" | "license"): string | null | undefined => {
    if (value[key] === undefined) return undefined;
    return normalizeText(value[key], STUDIO_BG3D_ASSET_METADATA_LIMITS.rightsTextCodePoints);
  };
  const provider = optionalText("provider");
  const author = optionalText("author");
  const license = optionalText("license");
  if (provider === null || author === null || license === null) return defaultRights();
  if (status === "licensed" && !license) return defaultRights();

  let purchaseOrDownloadDate: string | undefined;
  if (value.purchaseOrDownloadDate !== undefined) {
    const normalizedDate = normalizeCalendarDate(value.purchaseOrDownloadDate);
    if (!normalizedDate) return defaultRights();
    purchaseOrDownloadDate = normalizedDate;
  }

  return Object.freeze({
    status,
    commercialUse,
    teamShareAllowed: options.forceTeamShareDenied ? false : requestedTeamShare,
    ...(provider ? { provider } : {}),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    ...(purchaseOrDownloadDate ? { purchaseOrDownloadDate } : {}),
  });
}

export function canonicalizeStudioBg3dAssetContentHash(
  value: unknown,
): `sha256:${string}` | null {
  if (typeof value !== "string") return null;
  const match = HASH_PATTERN.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function normalizeMetadataRecord(
  raw: Record<string, unknown>,
  sourceVersion: 1 | typeof STUDIO_BG3D_ASSET_METADATA_VERSION,
): StudioBg3dAssetMetadata | null {
  const contentHash = canonicalizeStudioBg3dAssetContentHash(raw.contentHash);
  const name = normalizeText(raw.name, STUDIO_BG3D_ASSET_METADATA_LIMITS.nameCodePoints);
  const format = normalizeFormat(raw.format);
  const createdAt = normalizeSafeInteger(raw.createdAt, Number.MAX_SAFE_INTEGER);
  const updatedAt = normalizeSafeInteger(
    sourceVersion === 1 && raw.updatedAt === undefined ? raw.createdAt : raw.updatedAt,
    Number.MAX_SAFE_INTEGER,
  );
  const byteSize = normalizeSafeInteger(raw.byteSize, STUDIO_BG3D_ASSET_METADATA_LIMITS.bytes);
  const triangles = normalizeNullableMetric(
    sourceVersion === 1 ? raw.triangleCount : raw.triangles,
    STUDIO_BG3D_ASSET_METADATA_LIMITS.triangles,
  );
  const textures = normalizeNullableMetric(
    sourceVersion === 1 ? raw.textureCount : raw.textures,
    STUDIO_BG3D_ASSET_METADATA_LIMITS.textures,
  );
  const favorite = normalizeBoolean(raw.favorite);
  const collectionsSource = sourceVersion === 1 && raw.collections === undefined && raw.collection !== undefined
    ? [raw.collection]
    : raw.collections;
  const collections = normalizeCollections(collectionsSource);
  const tags = normalizeTags(raw.tags);

  if (
    !contentHash ||
    !name ||
    !format ||
    createdAt === null ||
    updatedAt === null ||
    updatedAt < createdAt ||
    byteSize === null ||
    triangles === undefined ||
    textures === undefined ||
    favorite === null ||
    !collections ||
    !tags
  ) {
    return null;
  }

  return Object.freeze({
    version: STUDIO_BG3D_ASSET_METADATA_VERSION,
    contentHash,
    name,
    format,
    createdAt,
    updatedAt,
    byteSize,
    triangles,
    textures,
    favorite,
    collections,
    tags,
    rights: normalizeRights(raw.rights, { forceTeamShareDenied: sourceVersion === 1 }),
  });
}

/** Accepts only the current schema. Unknown versions and malformed required fields return null. */
export function normalizeStudioBg3dAssetMetadata(raw: unknown): StudioBg3dAssetMetadata | null {
  try {
    if (!isRecord(raw) || raw.version !== STUDIO_BG3D_ASSET_METADATA_VERSION) return null;
    return normalizeMetadataRecord(raw, STUDIO_BG3D_ASSET_METADATA_VERSION);
  } catch {
    return null;
  }
}

/** Migrates the explicitly supported V1 schema or re-normalizes V2; every other version fails closed. */
export function migrateStudioBg3dAssetMetadata(raw: unknown): StudioBg3dAssetMetadata | null {
  try {
    if (!isRecord(raw)) return null;
    if (raw.version === STUDIO_BG3D_ASSET_METADATA_VERSION) {
      return normalizeMetadataRecord(raw, STUDIO_BG3D_ASSET_METADATA_VERSION);
    }
    if (raw.version === 1) return normalizeMetadataRecord(raw, 1);
    return null;
  } catch {
    return null;
  }
}

function metadataFingerprint(metadata: StudioBg3dAssetMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * Normalizes, freezes, and de-duplicates a bounded list by content hash. Identical duplicates
 * collapse to one row; conflicting duplicates are both omitted so input order cannot elevate rights.
 */
export function normalizeStudioBg3dAssetMetadataCollection(
  values: unknown,
): readonly StudioBg3dAssetMetadata[] {
  if (
    !Array.isArray(values) ||
    values.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery
  ) {
    return EMPTY_METADATA;
  }

  const order: string[] = [];
  const byHash = new Map<string, { metadata: StudioBg3dAssetMetadata; fingerprint: string } | null>();
  for (const value of values) {
    const metadata = migrateStudioBg3dAssetMetadata(value);
    if (!metadata) continue;
    const previous = byHash.get(metadata.contentHash);
    const fingerprint = metadataFingerprint(metadata);
    if (previous === undefined) {
      order.push(metadata.contentHash);
      byHash.set(metadata.contentHash, { metadata, fingerprint });
    } else if (previous !== null && previous.fingerprint !== fingerprint) {
      byHash.set(metadata.contentHash, null);
    }
  }

  return Object.freeze(
    order.flatMap((hash) => {
      const entry = byHash.get(hash);
      return entry ? [entry.metadata] : [];
    }),
  );
}

function normalizeRange(value: unknown, maximum: number): StudioBg3dAssetNumericFacet | null {
  if (!isRecord(value)) return null;
  if (value.min === undefined && value.max === undefined) return Object.freeze({});
  const min = value.min === undefined ? undefined : normalizeSafeInteger(value.min, maximum);
  const max = value.max === undefined ? undefined : normalizeSafeInteger(value.max, maximum);
  if (min === null || max === null || (min !== undefined && max !== undefined && min > max)) return null;
  return Object.freeze({ ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
}

function normalizeFormatFacet(value: unknown): readonly StudioBg3dAssetFormat[] | null {
  if (!Array.isArray(value) || value.length > STUDIO_BG3D_ASSET_FORMATS.length) return null;
  const formats = new Set<StudioBg3dAssetFormat>();
  for (const item of value) {
    const format = normalizeFormat(item);
    if (!format) return null;
    formats.add(format);
  }
  return Object.freeze([...formats].sort(compareText));
}

function normalizeCollectionFacet(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.collections) return null;
  const ids = new Set<string>();
  for (const item of value) {
    const id = normalizeCollectionId(item);
    if (!id) return null;
    ids.add(id);
  }
  return Object.freeze([...ids].sort(compareText));
}

function normalizeFacets(value: unknown): StudioBg3dAssetFacets | null {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) return null;

  const format = value.format === undefined ? undefined : normalizeFormatFacet(value.format);
  const commercial = value.commercial === undefined ? undefined : normalizeBoolean(value.commercial);
  const triangles = value.triangles === undefined
    ? undefined
    : normalizeRange(value.triangles, STUDIO_BG3D_ASSET_METADATA_LIMITS.triangles);
  const textures = value.textures === undefined
    ? undefined
    : normalizeRange(value.textures, STUDIO_BG3D_ASSET_METADATA_LIMITS.textures);
  const bytes = value.bytes === undefined
    ? undefined
    : normalizeRange(value.bytes, STUDIO_BG3D_ASSET_METADATA_LIMITS.bytes);
  const tags = value.tags === undefined ? undefined : normalizeTags(value.tags);
  const collection = value.collection === undefined
    ? undefined
    : normalizeCollectionFacet(value.collection);
  const favorite = value.favorite === undefined ? undefined : normalizeBoolean(value.favorite);

  if (
    format === null ||
    commercial === null ||
    triangles === null ||
    textures === null ||
    bytes === null ||
    tags === null ||
    collection === null ||
    favorite === null
  ) {
    return null;
  }

  return Object.freeze({
    ...(format ? { format } : {}),
    ...(commercial !== undefined ? { commercial } : {}),
    ...(triangles ? { triangles } : {}),
    ...(textures ? { textures } : {}),
    ...(bytes ? { bytes } : {}),
    ...(tags ? { tags } : {}),
    ...(collection ? { collection } : {}),
    ...(favorite !== undefined ? { favorite } : {}),
  });
}

function inRange(value: number | null, range: StudioBg3dAssetNumericFacet | undefined): boolean {
  if (!range) return true;
  if (value === null) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

function matchesSearch(metadata: StudioBg3dAssetMetadata, searchTerms: readonly string[]): boolean {
  if (searchTerms.length === 0) return true;
  const haystack = folded([
    metadata.name,
    metadata.format,
    ...metadata.tags,
    ...metadata.collections.flatMap(({ id, name }) => [id, name]),
    metadata.rights.provider ?? "",
    metadata.rights.author ?? "",
    metadata.rights.license ?? "",
  ].join("\n"));
  return searchTerms.every((term) => haystack.includes(term));
}

function filterNormalizedMetadata(
  metadata: readonly StudioBg3dAssetMetadata[],
  facets: StudioBg3dAssetFacets,
  searchTerms: readonly string[],
): readonly StudioBg3dAssetMetadata[] {
  return Object.freeze(metadata.filter((item) => {
    if (facets.format?.length && !facets.format.includes(item.format)) return false;
    if (facets.commercial !== undefined && item.rights.commercialUse !== facets.commercial) return false;
    if (!inRange(item.triangles, facets.triangles)) return false;
    if (!inRange(item.textures, facets.textures)) return false;
    if (!inRange(item.byteSize, facets.bytes)) return false;
    if (facets.tags?.length && !facets.tags.some((tag) => item.tags.some((itemTag) => folded(itemTag) === folded(tag)))) {
      return false;
    }
    if (
      facets.collection?.length &&
      !facets.collection.some((id) => item.collections.some((collection) => collection.id === id))
    ) {
      return false;
    }
    if (facets.favorite !== undefined && item.favorite !== facets.favorite) return false;
    return matchesSearch(item, searchTerms);
  }));
}

function normalizeSearchTerms(value: unknown): readonly string[] | null {
  if (value === undefined || value === "") return Object.freeze([]);
  const search = normalizeText(value, STUDIO_BG3D_ASSET_METADATA_LIMITS.searchCodePoints);
  if (!search) return null;
  return Object.freeze([...new Set(search.split(" ").map(folded).filter(Boolean))]);
}

function compareDescending(left: number, right: number): number {
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareDescending(left, right);
}

function sortNormalizedMetadata(
  metadata: readonly StudioBg3dAssetMetadata[],
  sort: StudioBg3dAssetSort,
): readonly StudioBg3dAssetMetadata[] {
  const decorated = metadata.map((item, index) => ({ item, index }));
  decorated.sort((left, right) => {
    let comparison = 0;
    switch (sort) {
      case "recent":
        comparison = compareDescending(left.item.updatedAt, right.item.updatedAt);
        break;
      case "name":
        comparison = compareText(left.item.name, right.item.name);
        break;
      case "bytes":
        comparison = compareDescending(left.item.byteSize, right.item.byteSize);
        break;
      case "triangles":
        comparison = compareNullableDescending(left.item.triangles, right.item.triangles);
        break;
    }
    return comparison || left.index - right.index;
  });
  return Object.freeze(decorated.map(({ item }) => item));
}

export function filterStudioBg3dAssetMetadata(
  values: readonly unknown[],
  facets: StudioBg3dAssetFacets | undefined = undefined,
  search: string | undefined = undefined,
): readonly StudioBg3dAssetMetadata[] {
  const normalized = normalizeStudioBg3dAssetMetadataCollection(values);
  const normalizedFacets = normalizeFacets(facets);
  const searchTerms = normalizeSearchTerms(search);
  if (!normalizedFacets || !searchTerms) return EMPTY_METADATA;
  return filterNormalizedMetadata(normalized, normalizedFacets, searchTerms);
}

export function sortStudioBg3dAssetMetadata(
  values: readonly unknown[],
  sort: StudioBg3dAssetSort = "recent",
): readonly StudioBg3dAssetMetadata[] {
  if (!ASSET_SORTS.has(sort)) return EMPTY_METADATA;
  return sortNormalizedMetadata(normalizeStudioBg3dAssetMetadataCollection(values), sort);
}

export function queryStudioBg3dAssetMetadata(
  values: readonly unknown[],
  query: StudioBg3dAssetQuery | undefined = undefined,
): readonly StudioBg3dAssetMetadata[] {
  if (query !== undefined && !isRecord(query)) return EMPTY_METADATA;
  const rawQuery = query as Record<string, unknown> | undefined;
  const sort = rawQuery?.sort === undefined ? "recent" : rawQuery.sort;
  if (typeof sort !== "string" || !ASSET_SORTS.has(sort as StudioBg3dAssetSort)) return EMPTY_METADATA;
  const facets = normalizeFacets(rawQuery?.facets);
  const searchTerms = normalizeSearchTerms(rawQuery?.search);
  if (!facets || !searchTerms) return EMPTY_METADATA;
  const normalized = normalizeStudioBg3dAssetMetadataCollection(values);
  return sortNormalizedMetadata(
    filterNormalizedMetadata(normalized, facets, searchTerms),
    sort as StudioBg3dAssetSort,
  );
}
