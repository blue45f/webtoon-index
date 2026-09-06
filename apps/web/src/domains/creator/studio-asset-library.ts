// 회원 커스텀 에셋 라이브러리의 공개 모델과 제품 포트.
// V12 제품 기본 권위는 SQLite manifest + OPFS SHA-256 CAS이며, 아래 IndexedDB 구현은
// 사용자가 명시적으로 선택하는 legacy import/test seam에서만 열린다.

import { STUDIO_ASSET_DATA_URL_MAX_CHARS } from "./studio-upload-image-safety";

export { STUDIO_ASSET_DATA_URL_MAX_CHARS } from "./studio-upload-image-safety";

const DB_NAME = "toonspectrum-studio-asset-library";
export const STUDIO_ASSET_LIBRARY_DB_VERSION = 2;
const STORE = "assets";
const CONTENT_HASH_INDEX = "contentHash";
export const STUDIO_ASSET_DATA_URL_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH = 8;
export const STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_CANDIDATES = 64;
export const STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS = 64 * 1024 * 1024;
export const STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES = 64 * 1024 * 1024;

const SHA256_HEX_LENGTH = 64;
const SHA256_CONTENT_HASH_PATTERN = /^sha256:([0-9a-f]{64})$/i;

export type StudioAssetContentHash = `sha256:${string}`;

export interface StudioAssetRightsMetadata {
  readonly sourceKind: "local-upload" | "ai-generated" | "3d-generated" | "imported" | "unknown";
  readonly sourceId: string | null;
  readonly licenseId: string;
  readonly licenseLabel: string;
  readonly licenseUrl: string | null;
  readonly attributionRequired: boolean | null;
  readonly attributionText: string;
  readonly rightsConfirmed: boolean;
}

export interface StudioAssetSaveInput {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  kind?: string;
  contentHash?: string;
  rights?: StudioAssetRightsMetadata;
}

export interface StudioAsset {
  id: string;
  name: string;
  dataUrl: string;
  /**
   * Decoded asset bytes의 안정적인 콘텐츠 식별자. 신규 저장분에는 항상 존재하지만,
   * DB v1 레거시 행과 해석할 수 없는 손상 행은 목록에서 일시적으로 없을 수 있다.
   */
  contentHash?: StudioAssetContentHash;
  width: number;
  height: number;
  createdAt: number;
  /**
   * 에셋 출처 종류. "ai" 면 생성형 AI(이미지 생성)로 만든 결과물 — 정책상 결과물에 AI 라벨/배지를
   * 표시해야 하므로 그리드 썸네일에 'AI' 배지를 노출한다. 업로드 등 일반 에셋은 생략(undefined).
   */
  kind?: string;
  /** V12 local manifest에 저장되는 엔진 독립 권리 메타데이터. */
  rights?: StudioAssetRightsMetadata;
}

export type StudioAssetWithContentHash = StudioAsset & {
  contentHash: StudioAssetContentHash;
};

export interface StudioAssetContentIdentityLookup {
  contentHash: unknown;
  assetId?: unknown;
  signal?: AbortSignal;
}

export type StudioAssetContentIdentityCandidateMap = ReadonlyMap<
  StudioAssetContentHash,
  readonly StudioAsset[]
>;

export interface StudioAssetLibraryPort {
  save(input: StudioAssetSaveInput): Promise<StudioAssetWithContentHash>;
  list(): Promise<StudioAsset[]>;
  /** Pure snapshot read for staged archive validation; must not reconcile refs or sweep storage. */
  listReadOnly?(): Promise<StudioAsset[]>;
  findByContentIdentities(
    lookups: readonly StudioAssetContentIdentityLookup[],
    signal?: AbortSignal,
  ): Promise<StudioAssetContentIdentityCandidateMap>;
  delete(id: string): Promise<void>;
  /** Compensation-only compare-and-delete for a row created by a failed archive import. */
  deleteIfIdentityMatches(id: string, contentHash: StudioAssetContentHash): Promise<boolean>;
  rename(id: string, newName: string): Promise<void>;
}

function createAssetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
}

// 파일명 → 표시 이름(확장자 제거).
export function normalizeAssetName(fileName: string): string {
  const normalized = fileName.trim().replace(/\.(png|jpe?g|gif|webp|svg|avif)$/i, "").trim();
  return normalized || "내 에셋";
}

export function createAssetRecord(
  input: StudioAssetSaveInput,
  id = createAssetId(),
  now = Date.now()
): StudioAsset {
  const contentHash = canonicalizeStudioAssetContentHash(input.contentHash);
  return {
    id,
    name: normalizeAssetName(input.name),
    dataUrl: input.dataUrl,
    ...(contentHash ? { contentHash } : {}),
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    createdAt: now,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.rights ? { rights: input.rights } : {}),
  };
}

/** `sha256:` 접두어를 포함한 64자리 SHA-256 식별자만 소문자로 정규화한다. */
export function canonicalizeStudioAssetContentHash(value: unknown): StudioAssetContentHash | null {
  if (typeof value !== "string") return null;
  const match = SHA256_CONTENT_HASH_PATTERN.exec(value.trim());
  if (!match || match[1].length !== SHA256_HEX_LENGTH) return null;
  return `sha256:${match[1].toLowerCase()}`;
}

function decodePercentEncodedPayload(payload: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const maximumCapacity = Math.min(
    STUDIO_ASSET_DATA_URL_MAX_DECODED_BYTES + 1,
    payload.length * 3
  );
  const bytes = new Uint8Array(maximumCapacity);
  let byteOffset = 0;
  let textStart = 0;

  const appendText = (end: number) => {
    if (end <= textStart) return;
    const text = payload.slice(textStart, end);
    const encoded = encoder.encodeInto(text, bytes.subarray(byteOffset));
    if (encoded.read !== text.length) {
      throw new TypeError("에셋 데이터 URL의 디코딩 크기가 제한을 초과했습니다.");
    }
    byteOffset += encoded.written;
    if (byteOffset > STUDIO_ASSET_DATA_URL_MAX_DECODED_BYTES) {
      throw new TypeError("에셋 데이터 URL의 디코딩 크기가 제한을 초과했습니다.");
    }
  };

  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== "%") continue;
    appendText(index);
    const encodedByte = payload.slice(index + 1, index + 3);
    if (!/^[0-9a-f]{2}$/i.test(encodedByte)) {
      throw new TypeError("에셋 데이터 URL의 퍼센트 인코딩이 올바르지 않습니다.");
    }
    if (byteOffset >= STUDIO_ASSET_DATA_URL_MAX_DECODED_BYTES) {
      throw new TypeError("에셋 데이터 URL의 디코딩 크기가 제한을 초과했습니다.");
    }
    bytes[byteOffset] = Number.parseInt(encodedByte, 16);
    byteOffset += 1;
    index += 2;
    textStart = index + 1;
  }

  appendText(payload.length);
  return bytes.subarray(0, byteOffset);
}

function decodeBase64Payload(payload: string): Uint8Array<ArrayBuffer> {
  let normalizedPayload: string;
  try {
    normalizedPayload = decodeURIComponent(payload).replace(/[\t\n\f\r ]/g, "");
  } catch {
    throw new TypeError("에셋 데이터 URL의 Base64 인코딩이 올바르지 않습니다.");
  }

  let decoded: string;
  try {
    decoded = globalThis.atob(normalizedPayload);
  } catch {
    throw new TypeError("에셋 데이터 URL의 Base64 인코딩이 올바르지 않습니다.");
  }

  const bytes = new Uint8Array(decoded.length);
  if (bytes.byteLength > STUDIO_ASSET_DATA_URL_MAX_DECODED_BYTES) {
    throw new TypeError("에셋 데이터 URL의 디코딩 크기가 제한을 초과했습니다.");
  }
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export interface DecodedStudioAssetDataUrl {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

export function decodeStudioAssetDataUrl(dataUrl: string): DecodedStudioAssetDataUrl {
  if (typeof dataUrl !== "string" || !/^data:/i.test(dataUrl)) {
    throw new TypeError("에셋 콘텐츠는 데이터 URL이어야 합니다.");
  }
  if (dataUrl.length > STUDIO_ASSET_DATA_URL_MAX_CHARS) {
    throw new TypeError("에셋 데이터 URL의 크기가 제한을 초과했습니다.");
  }
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 5) {
    throw new TypeError("에셋 데이터 URL 형식이 올바르지 않습니다.");
  }

  const metadata = dataUrl.slice(5, separatorIndex);
  const payload = dataUrl.slice(separatorIndex + 1);
  const declaredMime = metadata.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(declaredMime)) {
    throw new TypeError("에셋 MIME 형식이 올바르지 않습니다.");
  }
  const isBase64 = metadata
    .split(";")
    .slice(1)
    .some((token) => token.trim().toLowerCase() === "base64");
  return {
    bytes: isBase64 ? decodeBase64Payload(payload) : decodePercentEncodedPayload(payload),
    mimeType: declaredMime,
  };
}

/** 데이터 URL 문자열이 아니라 디코딩된 원본 바이트를 SHA-256으로 식별한다. */
export async function hashStudioAssetDataUrl(dataUrl: string): Promise<StudioAssetContentHash> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("이 브라우저에서는 에셋 콘텐츠 해시를 계산할 수 없습니다.");
  }
  const digest = await subtle.digest("SHA-256", decodeStudioAssetDataUrl(dataUrl).bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function hasCanonicalStudioAssetContentHash(
  asset: StudioAsset,
): asset is StudioAssetWithContentHash {
  return typeof asset.contentHash === "string"
    && canonicalizeStudioAssetContentHash(asset.contentHash) === asset.contentHash;
}

/** 레거시 에셋에 콘텐츠 해시를 부여하되 원본 객체를 변경하거나 이미지 바이트를 별도 저장하지 않는다. */
export async function ensureStudioAssetContentHash(
  asset: StudioAsset
): Promise<StudioAssetWithContentHash> {
  if (hasCanonicalStudioAssetContentHash(asset)) return asset;
  const canonicalHash = canonicalizeStudioAssetContentHash(asset.contentHash);
  if (canonicalHash !== null) {
    return {
      ...asset,
      contentHash: canonicalHash,
    };
  }
  return {
    ...asset,
    contentHash: await hashStudioAssetDataUrl(asset.dataUrl),
  };
}

function isStudioAssetRecord(value: unknown): value is StudioAsset {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<keyof StudioAsset, unknown>>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.dataUrl === "string" &&
    typeof record.width === "number" &&
    Number.isFinite(record.width) &&
    typeof record.height === "number" &&
    Number.isFinite(record.height) &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    (record.kind === undefined || typeof record.kind === "string") &&
    (record.rights === undefined || (typeof record.rights === "object" && record.rights !== null)) &&
    (record.contentHash === undefined || typeof record.contentHash === "string")
  );
}

function safeCreatedAt(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function boundedUtf8ByteLength(value: string, maximumBytes: number): number | null {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || value.length > maximumBytes) {
    return null;
  }
  // Begin with the one-byte ASCII cost per UTF-16 code unit and add only the Unicode delta. This is
  // allocation-free even for a maximum-sized data URL and exactly models TextEncoder replacement
  // semantics for lone surrogates.
  let byteLength = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) continue;
    if (code <= 0x7ff) byteLength += 1;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 2;
        index += 1;
      } else {
        byteLength += 2;
      }
    } else {
      byteLength += 2;
    }
    if (byteLength > maximumBytes) return null;
  }
  return byteLength;
}

interface StudioAssetCandidateReturnBudget {
  remainingCandidates: number;
  remainingDataUrlChars: number;
  remainingDataUrlBytes: number;
}

function admitStudioAssetCandidate(
  candidate: StudioAsset,
  budget: StudioAssetCandidateReturnBudget
): boolean {
  if (
    candidate.id.length < 1
    || candidate.id.length > 512
    || candidate.dataUrl.length < 1
    || candidate.dataUrl.length > STUDIO_ASSET_DATA_URL_MAX_CHARS
    || candidate.dataUrl.length > budget.remainingDataUrlChars
    || budget.remainingCandidates <= 0
  ) return false;
  const dataUrlBytes = boundedUtf8ByteLength(
    candidate.dataUrl,
    budget.remainingDataUrlBytes
  );
  if (dataUrlBytes === null) return false;
  budget.remainingCandidates -= 1;
  budget.remainingDataUrlChars -= candidate.dataUrl.length;
  budget.remainingDataUrlBytes -= dataUrlBytes;
  return true;
}

interface StudioAssetHashBackfill {
  id: string;
  dataUrl: string;
  contentHash: StudioAssetContentHash;
}

async function persistAssetHashBackfills(
  db: IDBDatabase,
  backfills: readonly StudioAssetHashBackfill[]
): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(STORE);

  const reconcileCurrentRows = async () => {
    // Queue every read before yielding so the transaction cannot become inactive between rows.
    const currentRows = await Promise.all(
      backfills.map(({ id }) => requestResult<unknown>(store.get(id)))
    );
    currentRows.forEach((currentRow, index) => {
      if (!isStudioAssetRecord(currentRow)) return;
      const backfill = backfills[index];
      if (currentRow.dataUrl !== backfill.dataUrl) return;

      const currentHash = canonicalizeStudioAssetContentHash(currentRow.contentHash);
      if (currentHash && currentHash !== backfill.contentHash) return;
      if (currentRow.contentHash === backfill.contentHash) return;
      store.put({ ...currentRow, contentHash: backfill.contentHash });
    });
  };

  await Promise.all([reconcileCurrentRows(), done]);
}

function dbError() {
  return new Error("이 브라우저에서는 에셋 라이브러리 저장소를 사용할 수 없습니다.");
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? dbError());
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? dbError());
    transaction.onabort = () => reject(transaction.error ?? dbError());
  });
}

function openLegacyDatabase(indexedDb: IDBFactory | null) {
  if (!indexedDb) return Promise.reject(dbError());
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, STUDIO_ASSET_LIBRARY_DB_VERSION);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE)
          ? request.transaction?.objectStore(STORE) ?? null
          : db.createObjectStore(STORE, { keyPath: "id" });
        if (!store) throw dbError();
        if (!store.indexNames.contains(CONTENT_HASH_INDEX)) {
          store.createIndex(CONTENT_HASH_INDEX, "contentHash", { unique: false });
        }
      } catch (error) {
        try {
          request.transaction?.abort();
        } catch {
          // An already-aborted versionchange transaction needs no further action.
        }
        fail(error instanceof Error ? error : dbError());
      }
    };
    request.onblocked = () => fail(new Error("에셋 라이브러리 업그레이드가 다른 탭에 의해 차단되었습니다."));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? dbError());
  });
}

async function withLegacyDatabase<T>(
  indexedDb: IDBFactory | null,
  callback: (db: IDBDatabase) => Promise<T>,
) {
  const db = await openLegacyDatabase(indexedDb);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

async function legacySaveAsset(
  indexedDb: IDBFactory | null,
  input: StudioAssetSaveInput,
): Promise<StudioAssetWithContentHash> {
  const record = await ensureStudioAssetContentHash(createAssetRecord(input));
  await withLegacyDatabase(indexedDb, async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    // `save` is creation-only. A generated-id collision must never overwrite a pre-existing row,
    // because failed-import compensation is allowed to remove only the row this call created.
    const existing = await requestResult<unknown>(store.get(record.id));
    if (existing !== undefined) {
      tx.abort();
      await done.catch(() => undefined);
      throw new Error("생성된 에셋 ID가 기존 행과 충돌했습니다.");
    }
    store.put(record);
    await done;
  });
  return record;
}

async function legacyListAssets(indexedDb: IDBFactory | null): Promise<StudioAsset[]> {
  return withLegacyDatabase(indexedDb, async (db) => {
    const tx = db.transaction(STORE, "readonly");
    const done = transactionDone(tx);
    const storedRecords = await requestResult<unknown[]>(tx.objectStore(STORE).getAll());
    await done;
    const records = storedRecords.filter(isStudioAssetRecord);
    const ensured: Array<{
      asset: StudioAsset;
      backfill: StudioAssetHashBackfill | null;
    }> = [];
    // Hash one legacy image at a time so a large library does not retain multiple decoded buffers.
    for (const record of records) {
      try {
        const asset = await ensureStudioAssetContentHash(record);
        ensured.push({
          asset,
          backfill: asset.contentHash !== record.contentHash
            ? { id: record.id, dataUrl: record.dataUrl, contentHash: asset.contentHash }
            : null,
        });
      } catch {
        ensured.push({ asset: record, backfill: null });
      }
    }

    const backfills = ensured.flatMap(({ backfill }) => (backfill ? [backfill] : []));
    if (backfills.length > 0) {
      try {
        await persistAssetHashBackfills(db, backfills);
      } catch {
        // Hashes are already available to the caller. A quota/race/write failure must not hide valid rows.
      }
    }

    return ensured
      .map(({ asset }) => asset)
      .sort((a, b) => safeCreatedAt(b.createdAt) - safeCreatedAt(a.createdAt));
  });
}

/**
 * Reference/companion처럼 이미 콘텐츠 식별자를 아는 경로를 위한 bounded batch 조회다.
 *
 * 전체 object store를 복제하지 않는다. device-local id 후보는 한 트랜잭션에서 정확 조회하고,
 * 아직 해석되지 않은 최대 32개 SHA-256은 v2 `contentHash` 비고유 인덱스에서 직접 조회한다.
 * 해시 후보는 id fallback보다 먼저 반환하되 호출자가 실제 바이트 SHA-256을 다시 검증한다.
 * 해시가 없는 v1 레거시 행은 정확한 id 힌트가 있을 때만 안전하게 반환한다.
 */
async function legacyFindStudioAssetCandidatesByContentIdentities(
  indexedDb: IDBFactory | null,
  lookups: readonly StudioAssetContentIdentityLookup[],
  signal?: AbortSignal
): Promise<StudioAssetContentIdentityCandidateMap> {
  if (signal?.aborted) return new Map();
  const assetIdsByHash = new Map<StudioAssetContentHash, string[]>();
  for (const lookup of lookups.slice(0, 32)) {
    const contentHash = canonicalizeStudioAssetContentHash(lookup.contentHash);
    if (!contentHash || lookup.signal?.aborted) continue;
    const assetId = typeof lookup.assetId === "string"
      && lookup.assetId.length > 0
      && lookup.assetId.length <= 512
      ? lookup.assetId
      : null;
    const ids = assetIdsByHash.get(contentHash) ?? [];
    if (assetId && !ids.includes(assetId)) ids.push(assetId);
    assetIdsByHash.set(contentHash, ids);
  }
  if (assetIdsByHash.size === 0) return new Map();

  return withLegacyDatabase(indexedDb, async (db) => {
    const exactIds = [...new Set([...assetIdsByHash.values()].flat())];
    const exactAssets = new Map<string, StudioAsset>();
    if (exactIds.length > 0) {
      const tx = db.transaction(STORE, "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore(STORE);
      const [rows] = await Promise.all([
        Promise.all(exactIds.map((id) => requestResult<unknown>(store.get(id)))),
        done,
      ]);
      rows.forEach((row, index) => {
        if (isStudioAssetRecord(row)) exactAssets.set(exactIds[index], row);
      });
    }
    if (signal?.aborted) return new Map();

    const idFallbacksByHash = new Map<StudioAssetContentHash, readonly StudioAsset[]>();
    for (const [contentHash, ids] of assetIdsByHash) {
      const idCandidates = ids.flatMap((id) => {
        const candidate = exactAssets.get(id);
        return candidate ? [candidate] : [];
      });
      if (idCandidates.length === 0) continue;
      idFallbacksByHash.set(contentHash, idCandidates);
    }

    const indexedCandidatesByHash = new Map<StudioAssetContentHash, readonly StudioAsset[]>();
    await (async () => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const done = transactionDone(tx);
        const index = tx.objectStore(STORE).index(CONTENT_HASH_INDEX);
        const hashes = [...assetIdsByHash.keys()];
        const [rows] = await Promise.all([
          Promise.all(hashes.map((hash) => requestResult<unknown[]>(index.getAll(
            hash,
            STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH
          )))),
          done,
        ]);
        rows.forEach((hashRows, rowIndex) => {
          const hash = hashes[rowIndex];
          if (!hash) return;
          indexedCandidatesByHash.set(hash, hashRows.filter((row): row is StudioAsset => (
            isStudioAssetRecord(row)
            && canonicalizeStudioAssetContentHash(row.contentHash) === hash
          )));
        });
      } catch {
        // A missing/corrupt index fails closed to exact-id rows; never copy the full object store.
      }
    })();
    if (signal?.aborted) return new Map();

    const candidates = new Map<StudioAssetContentHash, readonly StudioAsset[]>();
    const budget: StudioAssetCandidateReturnBudget = {
      remainingCandidates: STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_CANDIDATES,
      remainingDataUrlChars: STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS,
      remainingDataUrlBytes: STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES,
    };
    for (const contentHash of assetIdsByHash.keys()) {
      const seenIds = new Set<string>();
      const boundedCandidates: StudioAsset[] = [];
      const appendCandidate = (candidate: StudioAsset) => {
        if (
          boundedCandidates.length >= STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH
          || seenIds.has(candidate.id)
        ) return;
        seenIds.add(candidate.id);
        if (admitStudioAssetCandidate(candidate, budget)) boundedCandidates.push(candidate);
      };
      for (const candidate of indexedCandidatesByHash.get(contentHash) ?? []) {
        appendCandidate(candidate);
      }
      const idCandidates = idFallbacksByHash.get(contentHash) ?? [];
      for (const candidate of idCandidates) appendCandidate(candidate);
      candidates.set(contentHash, boundedCandidates);
    }
    return candidates;
  });
}

async function legacyDeleteAsset(indexedDb: IDBFactory | null, id: string): Promise<void> {
  await withLegacyDatabase(indexedDb, async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(id);
    await done;
  });
}

async function legacyDeleteAssetIfIdentityMatches(
  indexedDb: IDBFactory | null,
  id: string,
  contentHash: StudioAssetContentHash,
): Promise<boolean> {
  return withLegacyDatabase(indexedDb, async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const candidate = await requestResult<unknown>(store.get(id));
    const matches = isStudioAssetRecord(candidate)
      && canonicalizeStudioAssetContentHash(candidate.contentHash) === contentHash;
    if (matches) store.delete(id);
    await done;
    return matches;
  });
}

async function legacyRenameAsset(
  indexedDb: IDBFactory | null,
  id: string,
  newName: string,
): Promise<void> {
  await withLegacyDatabase(indexedDb, async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const asset = await requestResult<StudioAsset>(store.get(id));
    if (!asset) throw new Error("에셋을 찾을 수 없습니다.");
    asset.name = normalizeAssetName(newName);
    store.put(asset);
    await transactionDone(tx);
  });
}

export interface LegacyIndexedDbStudioAssetLibraryOptions {
  /** Explicit legacy seam. Omitting this never probes ambient IndexedDB. */
  readonly indexedDB: IDBFactory | null;
}

/**
 * Pre-V12 IndexedDB reader/writer retained only for an explicit user-directed import or tests.
 * Product boot and the exported no-argument functions below never instantiate this adapter.
 */
export function createLegacyIndexedDbStudioAssetLibrary(
  options: LegacyIndexedDbStudioAssetLibraryOptions,
): StudioAssetLibraryPort {
  const indexedDb = options.indexedDB;
  return {
    save: (input) => legacySaveAsset(indexedDb, input),
    list: () => legacyListAssets(indexedDb),
    findByContentIdentities: (lookups, signal) =>
      legacyFindStudioAssetCandidatesByContentIdentities(indexedDb, lookups, signal),
    delete: (id) => legacyDeleteAsset(indexedDb, id),
    deleteIfIdentityMatches: (id, contentHash) =>
      legacyDeleteAssetIfIdentityMatches(indexedDb, id, contentHash),
    rename: (id, newName) => legacyRenameAsset(indexedDb, id, newName),
  };
}

let productPortOverride: StudioAssetLibraryPort | null = null;

/** Test-only dependency seam; passing null restores the SQLite/OPFS product default. */
export function installStudioAssetLibraryPortForTest(
  port: StudioAssetLibraryPort | null,
): void {
  productPortOverride = port;
}

async function productPort(): Promise<StudioAssetLibraryPort> {
  if (productPortOverride) return productPortOverride;
  const module = await import("./studio-asset-library-sqlite-opfs-repository");
  return module.getProductStudioAssetLibraryRepository();
}

export async function saveAsset(
  input: StudioAssetSaveInput,
): Promise<StudioAssetWithContentHash> {
  return (await productPort()).save(input);
}

export async function listAssets(): Promise<StudioAsset[]> {
  return (await productPort()).list();
}

export async function listAssetsReadOnly(): Promise<StudioAsset[]> {
  const port = await productPort();
  return port.listReadOnly ? port.listReadOnly() : port.list();
}

export async function findStudioAssetCandidatesByContentIdentities(
  lookups: readonly StudioAssetContentIdentityLookup[],
  signal?: AbortSignal,
): Promise<StudioAssetContentIdentityCandidateMap> {
  return (await productPort()).findByContentIdentities(lookups, signal);
}

export async function findStudioAssetCandidatesByContentIdentity(
  lookup: StudioAssetContentIdentityLookup,
): Promise<StudioAsset[]> {
  const contentHash = canonicalizeStudioAssetContentHash(lookup.contentHash);
  if (!contentHash || lookup.signal?.aborted) return [];
  const candidates = await findStudioAssetCandidatesByContentIdentities(
    [lookup],
    lookup.signal,
  );
  return [...(candidates.get(contentHash) ?? [])];
}

export async function deleteAsset(id: string): Promise<void> {
  return (await productPort()).delete(id);
}

export async function deleteAssetIfIdentityMatches(
  id: string,
  value: string,
): Promise<boolean> {
  const contentHash = canonicalizeStudioAssetContentHash(value);
  if (!contentHash) return false;
  return (await productPort()).deleteIfIdentityMatches(id, contentHash);
}

export async function renameAsset(id: string, newName: string): Promise<void> {
  return (await productPort()).rename(id, newName);
}
