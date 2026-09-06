/**
 * Studio OPFS Asset Store — 대용량 이진 자산을 위한 내용주소(content-addressed) 저장소.
 *
 * 담는 것: 글꼴 바이너리, 브러시 팁 PNG, 클립 썸네일, 참고 이미지, 3D GLB.
 * 담지 않는 것: 구조화된 작은 레코드(브러시 설정·팔레트·환경설정). 그건 계속 localStorage가
 * 맞다 — 동기 읽기가 필요하고, 합쳐도 수백 KB이며, 이 저장소는 전부 async다.
 *
 * ── 내용주소 ────────────────────────────────────────────────────────────
 * 키는 `sha256:<64 hex>`이고, 언제나 **압축 전 원본 바이트**로 계산한다. 그래서
 *   - 같은 글꼴을 두 번 가져와도 파일은 하나다(중복 제거),
 *   - 코덱 정책이 바뀌어도 키는 변하지 않으며,
 *   - 참조는 값이 아니라 신원을 가리킨다(어느 보관함이 먼저 지워지든 다른 쪽이 안전하다).
 * 형식은 vrm-library.ts의 `sha256:${hex}` 관례를 그대로 따른다.
 *
 * ── 회수 정책: 참조 카운트가 아니라 mark-and-sweep ───────────────────────
 * 참조 카운트를 쓰지 않은 이유는 셋이다.
 *   1. 이 앱의 보관함들은 목록을 통째로 다시 쓴다(saveCustomFonts(전체 배열)). 자연스러운
 *      연산은 "소유자 X가 지금 참조하는 해시 집합은 이것"이지 +1/-1이 아니다.
 *   2. 카운트는 자가 치유가 안 된다. 감소 한 번을 놓치면 영원히 새고, 증가 한 번을 놓치면
 *      살아 있는 자산을 지운다 — 후자는 복구 불가능한 방향의 실패다.
 *   3. mark-and-sweep은 멱등하다. 언제 몇 번 돌려도 결과가 같고, 중단된 쓰기·다른 탭이
 *      만든 드리프트는 다음 sweep에서 스스로 교정된다.
 * 대가는 sweep이 O(항목 수)라는 것인데, 항목은 수백 단위이고 sweep은 매 쓰기가 아니라
 * 명시적 시점(쿼터 압박·유휴)에만 돈다.
 *
 * ── sweep이 살아 있는 blob을 지우지 않는다는 보장 ────────────────────────
 * 삭제 대상은 (a) 어떤 소유자도 참조하지 않고 **동시에** (b) 생성된 지 유예 시간
 * (기본 5분)이 지난 항목뿐이다. (b)가 필요한 이유: put()이 끝나고 소유자가 참조를 커밋하기
 * 전 사이에 sweep이 끼어들 수 있기 때문이다. 유예 창이 그 경합을 닫는다.
 */

import {
  compressStudioOpfsBytes,
  encodeStudioOpfsPayload,
  decompressStudioOpfsBytes,
  isStudioOpfsCodec,
  studioOpfsCompressionSupport,
  type StudioOpfsCodec,
  type StudioOpfsCompressionScope,
  type StudioOpfsCompressionSupport,
} from "./studio-opfs-compression";
import {
  formatStudioOpfsBytes,
  StudioOpfsError,
  type StudioOpfsFileSystem,
} from "./studio-opfs-filesystem";

// ── 모델 ────────────────────────────────────────────────────────────────

export type StudioOpfsContentHash = `sha256:${string}`;

const CONTENT_HASH_RE = /^sha256:([0-9a-f]{64})$/u;

export function isStudioOpfsContentHash(value: unknown): value is StudioOpfsContentHash {
  return typeof value === "string" && CONTENT_HASH_RE.test(value);
}

export function canonicalizeStudioOpfsContentHash(value: unknown): StudioOpfsContentHash | null {
  if (typeof value !== "string") return null;
  const match = CONTENT_HASH_RE.exec(value.trim().toLowerCase());
  return match ? (`sha256:${match[1]}` as StudioOpfsContentHash) : null;
}

export interface StudioOpfsAssetEntry {
  hash: StudioOpfsContentHash;
  /** 저장 경로. 확장자가 코덱을 드러내므로 색인이 사라져도 재구성할 수 있다. */
  path: string;
  /** 압축 전 원본 바이트 수(= 해시 대상). */
  bytes: number;
  /** 실제로 디스크에 있는 바이트 수. */
  storedBytes: number;
  codec: StudioOpfsCodec;
  mime: string;
  createdAt: number;
  lastAccessAt: number;
}

export interface StudioOpfsAssetRef {
  hash: StudioOpfsContentHash;
  bytes: number;
  mime: string;
}

export interface StudioOpfsPutResult {
  ref: StudioOpfsAssetRef;
  entry: StudioOpfsAssetEntry;
  /** 같은 내용이 이미 있어서 새로 쓰지 않았으면 true. */
  deduped: boolean;
}

export interface StudioOpfsSweepResult {
  /** 삭제한 항목. */
  removed: StudioOpfsAssetEntry[];
  /** 참조가 없지만 유예 시간이 남아 보류한 항목. */
  retainedInGrace: StudioOpfsAssetEntry[];
  /** 참조가 살아 있어 건드리지 않은 항목 수. */
  referenced: number;
  freedBytes: number;
}

const BLOB_DIR = "blobs";
const INDEX_PATH = "index.json";
const INDEX_VERSION = 1;

const CODEC_EXTENSION: Record<StudioOpfsCodec, string> = {
  identity: "bin",
  gzip: "gz",
  "deflate-raw": "dfl",
};

const EXTENSION_CODEC: Record<string, StudioOpfsCodec> = {
  bin: "identity",
  gz: "gzip",
  dfl: "deflate-raw",
};

function blobPath(hash: StudioOpfsContentHash, codec: StudioOpfsCodec): string {
  return `${BLOB_DIR}/${hash.slice("sha256:".length)}.${CODEC_EXTENSION[codec]}`;
}

// ── 색인 파일 ────────────────────────────────────────────────────────────

interface StudioOpfsIndexFile {
  version: number;
  entries: StudioOpfsAssetEntry[];
  owners: Array<{ owner: string; hashes: StudioOpfsContentHash[]; updatedAt: number }>;
}

interface StudioOpfsIndexState {
  entries: Map<StudioOpfsContentHash, StudioOpfsAssetEntry>;
  owners: Map<string, { hashes: Set<StudioOpfsContentHash>; updatedAt: number }>;
}

function emptyIndex(): StudioOpfsIndexState {
  return { entries: new Map(), owners: new Map() };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeEntry(value: unknown): StudioOpfsAssetEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const hash = canonicalizeStudioOpfsContentHash(record.hash);
  if (!hash || record.hash !== hash) return null;
  const codec = isStudioOpfsCodec(record.codec) ? record.codec : null;
  if (!codec) return null;
  const canonicalPath = blobPath(hash, codec);
  if (
    record.path !== canonicalPath
    || !isNonNegativeSafeInteger(record.bytes)
    || !isNonNegativeSafeInteger(record.storedBytes)
    || !isNonNegativeSafeInteger(record.createdAt)
    || !isNonNegativeSafeInteger(record.lastAccessAt)
    || record.lastAccessAt < record.createdAt
    || typeof record.mime !== "string"
    || record.mime.trim() !== record.mime
    || record.mime.length < 1
    || record.mime.length > 1_024
  ) return null;
  return {
    hash,
    path: canonicalPath,
    bytes: record.bytes,
    storedBytes: record.storedBytes,
    codec,
    mime: record.mime,
    createdAt: record.createdAt,
    lastAccessAt: record.lastAccessAt,
  };
}

function parseIndex(raw: Uint8Array | null): StudioOpfsIndexState {
  if (raw === null) return emptyIndex();
  if (raw.byteLength === 0) {
    throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 색인이 비어 있어 안전하게 열 수 없어요.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (cause) {
    throw new StudioOpfsError(
      "CORRUPT_ENTRY",
      "OPFS 자산 색인 JSON이 손상되어 안전하게 열 수 없어요.",
      cause,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 색인 구조가 손상됐어요.");
  }
  const file = parsed as Partial<StudioOpfsIndexFile>;
  if (file.version !== INDEX_VERSION) {
    throw new StudioOpfsError("CORRUPT_ENTRY", "지원하지 않는 OPFS 자산 색인 버전이에요.");
  }
  if (!Array.isArray(file.entries) || !Array.isArray(file.owners)) {
    throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 색인 목록이 손상됐어요.");
  }
  const state = emptyIndex();
  for (const value of file.entries) {
    const entry = normalizeEntry(value);
    if (!entry || state.entries.has(entry.hash)) {
      throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 색인 항목이 손상됐어요.");
    }
    state.entries.set(entry.hash, entry);
  }
  for (const value of file.owners) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 owner 색인이 손상됐어요.");
    }
    const record = value as Record<string, unknown>;
    const owner = typeof record.owner === "string" ? record.owner.trim() : "";
    if (record.owner !== owner || !owner || state.owners.has(owner) || !Array.isArray(record.hashes)) {
      throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 owner 색인이 손상됐어요.");
    }
    const hashes = new Set<StudioOpfsContentHash>();
    for (const candidate of record.hashes) {
      const hash = canonicalizeStudioOpfsContentHash(candidate);
      if (candidate !== hash || !hash || hashes.has(hash)) {
        throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 owner 참조가 손상됐어요.");
      }
      hashes.add(hash);
    }
    if (!isNonNegativeSafeInteger(record.updatedAt)) {
      throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 owner 갱신 시각이 손상됐어요.");
    }
    state.owners.set(owner, { hashes, updatedAt: record.updatedAt });
  }
  return state;
}

function serializeIndex(state: StudioOpfsIndexState): Uint8Array {
  const file: StudioOpfsIndexFile = {
    version: INDEX_VERSION,
    entries: [...state.entries.values()].sort((a, b) => a.hash.localeCompare(b.hash)),
    owners: [...state.owners.entries()]
      .map(([owner, value]) => ({
        owner,
        hashes: [...value.hashes].sort(),
        updatedAt: value.updatedAt,
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner)),
  };
  return new TextEncoder().encode(JSON.stringify(file));
}

// ── 해시 이음매 ──────────────────────────────────────────────────────────

export type StudioOpfsDigest = (bytes: Uint8Array) => Promise<ArrayBuffer>;

/**
 * SubtleCrypto.digest는 `ArrayBuffer` 뷰만 받는다(SharedArrayBuffer 뷰 불가). 뷰가 버퍼
 * 전체를 덮고 있으면 그대로 넘기고(복사 0), 부분 뷰일 때만 복사한다.
 */
function toDigestSource(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return new Uint8Array(bytes).buffer;
}

export function browserStudioOpfsDigest(): StudioOpfsDigest | null {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  return (bytes) => subtle.digest("SHA-256", toDigestSource(bytes));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ── 쿼터 ────────────────────────────────────────────────────────────────

export type StudioOpfsQuotaLevel = "ok" | "warn" | "critical" | "unknown";

export interface StudioOpfsQuotaEstimate {
  usage: number | null;
  quota: number | null;
  available: number | null;
  usedRatio: number | null;
  level: StudioOpfsQuotaLevel;
  /** level이 ok/unknown이면 null. 그 외에는 숫자를 밝힌 한국어 안내. */
  message: string | null;
}

/** 쿼터를 다 쓰기 전에 남겨 둘 여유. 이 밑으로 내려가면 새 자산을 거절한다. */
export const STUDIO_OPFS_QUOTA_RESERVE_BYTES = 10_000_000;
export const STUDIO_OPFS_QUOTA_WARN_RATIO = 0.8;
export const STUDIO_OPFS_QUOTA_CRITICAL_RATIO = 0.95;
export const STUDIO_OPFS_QUOTA_WARN_AVAILABLE_BYTES = 100_000_000;

export interface StudioOpfsStorageEstimator {
  estimate(): Promise<{ usage?: number; quota?: number }>;
}

export function studioOpfsQuotaLevel(available: number, usedRatio: number): StudioOpfsQuotaLevel {
  if (usedRatio >= STUDIO_OPFS_QUOTA_CRITICAL_RATIO || available <= STUDIO_OPFS_QUOTA_RESERVE_BYTES) {
    return "critical";
  }
  if (usedRatio >= STUDIO_OPFS_QUOTA_WARN_RATIO || available < STUDIO_OPFS_QUOTA_WARN_AVAILABLE_BYTES) {
    return "warn";
  }
  return "ok";
}

function quotaMessage(
  level: StudioOpfsQuotaLevel,
  usage: number,
  quota: number,
  available: number
): string | null {
  if (level === "ok" || level === "unknown") return null;
  const percent = Math.round((usage / quota) * 100);
  const head =
    `저장 공간을 ${formatStudioOpfsBytes(quota)} 중 ${formatStudioOpfsBytes(usage)}`
    + `(${percent}%) 쓰고 있어요. 남은 공간은 ${formatStudioOpfsBytes(available)}예요.`;
  return level === "critical"
    ? `${head} 새 글꼴·이미지를 더 담기 어려워요. 쓰지 않는 자산을 정리해주세요.`
    : `${head} 곧 가득 찰 수 있으니 쓰지 않는 자산을 정리해두면 좋아요.`;
}

/**
 * `navigator.storage.estimate()`로 남은 용량을 본다. 값이 없거나 브라우저가 반올림해
 * 주더라도(사생활 보호를 위해 흔하다) 거짓말하지 않고 unknown으로 남긴다.
 */
export async function estimateStudioOpfsQuota(
  estimator: StudioOpfsStorageEstimator | null | undefined
): Promise<StudioOpfsQuotaEstimate> {
  const unknown: StudioOpfsQuotaEstimate = {
    usage: null,
    quota: null,
    available: null,
    usedRatio: null,
    level: "unknown",
    message: null,
  };
  if (!estimator || typeof estimator.estimate !== "function") return unknown;
  let raw: { usage?: number; quota?: number };
  try {
    raw = await estimator.estimate();
  } catch {
    return unknown;
  }
  const usage = typeof raw?.usage === "number" && Number.isFinite(raw.usage) ? raw.usage : null;
  const quota = typeof raw?.quota === "number" && Number.isFinite(raw.quota) ? raw.quota : null;
  if (usage === null || quota === null || quota <= 0) return unknown;
  const available = Math.max(0, quota - usage);
  const usedRatio = usage / quota;
  const level = studioOpfsQuotaLevel(available, usedRatio);
  return { usage, quota, available, usedRatio, level, message: quotaMessage(level, usage, quota, available) };
}

// ── 직렬화 큐 ────────────────────────────────────────────────────────────

/**
 * 색인은 통째로 다시 쓰이므로 read-modify-write가 겹치면 갱신이 사라진다. 모든 변경 연산을
 * 한 줄로 세워 그 창을 없앤다. 제품 OPFS는 여기에 origin-wide Web Lock을
 * 추가로 주입해 독립된 탭/인스턴스도 같은 순서를 공유한다.
 */
function createSequencer(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

// ── 저장소 ──────────────────────────────────────────────────────────────

export interface StudioOpfsAssetStoreOptions {
  fs: StudioOpfsFileSystem;
  digest?: StudioOpfsDigest | null;
  estimator?: StudioOpfsStorageEstimator | null;
  compressionScope?: StudioOpfsCompressionScope;
  compressionSupport?: StudioOpfsCompressionSupport;
  now?: () => number;
  /** sweep이 참조 없는 신규 blob을 보호하는 창. 기본 5분. */
  graceMs?: number;
  /** 독립 store/탭 간 index read-modify-write를 직렬화하는 제품 Web Lock seam. */
  mutationRunExclusive?: StudioOpfsAssetStoreRunExclusive | null;
}

export type StudioOpfsAssetStoreRunExclusive = <T>(task: () => Promise<T>) => Promise<T>;

export interface StudioOpfsPutOptions {
  mime?: string;
  /** 정책을 무시하고 코덱을 강제한다(테스트·특수 경로용). */
  codec?: StudioOpfsCodec;
}

export interface StudioOpfsGetOptions {
  /** 읽은 바이트를 다시 해싱해 내용주소와 일치하는지 확인한다. 기본 false(길이만 검증). */
  verify?: boolean;
}

export interface StudioOpfsSweepOptions {
  graceMs?: number;
  /** 계산만 하고 지우지 않는다. */
  dryRun?: boolean;
}

export interface StudioOpfsAssetStore {
  readonly kind: StudioOpfsFileSystem["kind"];
  put(bytes: Uint8Array, options?: StudioOpfsPutOptions): Promise<StudioOpfsPutResult>;
  get(hash: string, options?: StudioOpfsGetOptions): Promise<Uint8Array | null>;
  has(hash: string): Promise<boolean>;
  stat(hash: string): Promise<StudioOpfsAssetEntry | null>;
  /** 참조 여부와 무관하게 지운다. 보관함이 "이 자산을 확실히 버린다"고 말할 때만 쓴다. */
  delete(hash: string): Promise<boolean>;
  list(): Promise<StudioOpfsAssetEntry[]>;
  /** 소유자가 지금 참조하는 해시 집합을 통째로 교체한다(멱등). */
  setOwnerRefs(owner: string, hashes: readonly string[]): Promise<StudioOpfsContentHash[]>;
  ownerRefs(owner: string): Promise<StudioOpfsContentHash[]>;
  owners(): Promise<string[]>;
  sweep(options?: StudioOpfsSweepOptions): Promise<StudioOpfsSweepResult>;
  /** 디스크를 정본으로 삼아 색인을 다시 만든다. 소유자 참조는 보존한다. */
  rebuildIndex(): Promise<StudioOpfsAssetEntry[]>;
  estimateQuota(): Promise<StudioOpfsQuotaEstimate>;
  totalStoredBytes(): Promise<number>;
}

export function createStudioOpfsAssetStore(
  options: StudioOpfsAssetStoreOptions
): StudioOpfsAssetStore {
  const { fs } = options;
  const digest = options.digest ?? browserStudioOpfsDigest();
  const now = options.now ?? (() => Date.now());
  const graceMs = options.graceMs ?? 300_000;
  const compressionScope = options.compressionScope ?? (globalThis as StudioOpfsCompressionScope);
  const support = options.compressionSupport ?? studioOpfsCompressionSupport(compressionScope);
  const sequence = createSequencer();
  let cached: StudioOpfsIndexState | null = null;

  async function loadIndex(fresh = false): Promise<StudioOpfsIndexState> {
    if (!fresh && cached) return cached;
    cached = parseIndex(await fs.read(INDEX_PATH));
    return cached;
  }

  async function saveIndex(state: StudioOpfsIndexState): Promise<void> {
    await fs.write(INDEX_PATH, serializeIndex(state));
    cached = state;
  }

  function mutate<T>(task: () => Promise<T>): Promise<T> {
    return sequence(async () => {
      const runExclusive = options.mutationRunExclusive;
      const freshTask = async () => {
        // The lock may have waited behind another tab. Discard the instance snapshot only after
        // entering it, so every mutation read-modify-writes the latest durable index.
        cached = null;
        return await task();
      };
      return runExclusive ? await runExclusive(freshTask) : await freshTask();
    });
  }

  function timestampNow(): number {
    const value = now();
    if (!isNonNegativeSafeInteger(value)) {
      throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 갱신 시각이 올바르지 않아요.");
    }
    return value;
  }

  async function hashOf(bytes: Uint8Array): Promise<StudioOpfsContentHash> {
    if (!digest) {
      throw new StudioOpfsError(
        "HASH_UNAVAILABLE",
        "이 브라우저에서는 자산 식별자를 계산할 수 없어 저장할 수 없어요."
      );
    }
    return `sha256:${toHex(await digest(bytes))}` as StudioOpfsContentHash;
  }

  async function assertQuota(incomingBytes: number): Promise<void> {
    const estimate = await estimateStudioOpfsQuota(options.estimator ?? null);
    if (estimate.available === null) return;
    if (estimate.available < incomingBytes + STUDIO_OPFS_QUOTA_RESERVE_BYTES) {
      throw new StudioOpfsError(
        "QUOTA_EXCEEDED",
        `저장 공간이 ${formatStudioOpfsBytes(estimate.available)}밖에 남지 않아 `
          + `${formatStudioOpfsBytes(incomingBytes)}를 담을 수 없어요. `
          + "쓰지 않는 글꼴·이미지를 정리한 뒤 다시 시도해주세요."
      );
    }
  }

  return {
    kind: fs.kind,

    put(bytes, putOptions = {}) {
      return mutate(async () => {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
          throw new StudioOpfsError("CORRUPT_ENTRY", "빈 자산은 저장할 수 없어요.");
        }
        const mime = putOptions.mime?.trim() || "application/octet-stream";
        if (mime.length > 1_024) {
          throw new StudioOpfsError("CORRUPT_ENTRY", "OPFS 자산 MIME 원장이 너무 길어요.");
        }
        const hash = await hashOf(bytes);
        const state = await loadIndex();
        const existing = state.entries.get(hash);
        if (existing) {
          // 이미 같은 내용이 있다 — 파일도 색인도 그대로 두고 접근 시각만 올린다.
          const touched: StudioOpfsAssetEntry = {
            ...existing,
            lastAccessAt: Math.max(existing.createdAt, timestampNow()),
          };
          state.entries.set(hash, touched);
          await saveIndex(state);
          return {
            ref: { hash, bytes: touched.bytes, mime: touched.mime },
            entry: touched,
            deduped: true,
          };
        }

        const encoded = putOptions.codec
          ? {
              codec: putOptions.codec,
              bytes: await compressStudioOpfsBytes(bytes, putOptions.codec, compressionScope),
              ratio: 1,
            }
          : await encodeStudioOpfsPayload(bytes, mime, support, compressionScope);

        await assertQuota(encoded.bytes.byteLength);

        const path = blobPath(hash, encoded.codec);
        await fs.write(path, encoded.bytes);
        const timestamp = timestampNow();
        const entry: StudioOpfsAssetEntry = {
          hash,
          path,
          bytes: bytes.byteLength,
          storedBytes: encoded.bytes.byteLength,
          codec: encoded.codec,
          mime,
          createdAt: timestamp,
          lastAccessAt: timestamp,
        };
        state.entries.set(hash, entry);
        await saveIndex(state);
        return { ref: { hash, bytes: entry.bytes, mime }, entry, deduped: false };
      });
    },

    async get(hash, getOptions = {}) {
      const key = canonicalizeStudioOpfsContentHash(hash);
      if (!key) return null;
      const state = await loadIndex();
      const entry = state.entries.get(key);
      if (!entry) return null;
      const stored = await fs.read(entry.path);
      if (!stored) return null;
      const plain = await decompressStudioOpfsBytes(stored, entry.codec, compressionScope);
      if (plain.byteLength !== entry.bytes) {
        throw new StudioOpfsError(
          "INTEGRITY_FAILED",
          "저장된 자산이 손상됐어요. 파일을 다시 가져와주세요."
        );
      }
      if (getOptions.verify && (await hashOf(plain)) !== key) {
        throw new StudioOpfsError(
          "INTEGRITY_FAILED",
          "저장된 자산의 내용이 원본과 달라요. 파일을 다시 가져와주세요."
        );
      }
      return plain;
    },

    async has(hash) {
      const key = canonicalizeStudioOpfsContentHash(hash);
      if (!key) return false;
      return (await loadIndex()).entries.has(key);
    },

    async stat(hash) {
      const key = canonicalizeStudioOpfsContentHash(hash);
      if (!key) return null;
      const entry = (await loadIndex()).entries.get(key);
      return entry ? { ...entry } : null;
    },

    delete(hash) {
      return mutate(async () => {
        const key = canonicalizeStudioOpfsContentHash(hash);
        if (!key) return false;
        const state = await loadIndex();
        const entry = state.entries.get(key);
        if (!entry) return false;
        await fs.remove(entry.path);
        state.entries.delete(key);
        await saveIndex(state);
        return true;
      });
    },

    async list() {
      return [...(await loadIndex()).entries.values()].map((entry) => ({ ...entry }));
    },

    setOwnerRefs(owner, hashes) {
      return mutate(async () => {
        const name = String(owner ?? "").trim();
        if (!name) {
          throw new StudioOpfsError("CORRUPT_ENTRY", "자산 소유자 이름이 비어 있어요.");
        }
        const normalized: StudioOpfsContentHash[] = [];
        const seen = new Set<StudioOpfsContentHash>();
        for (const candidate of hashes) {
          const hash = canonicalizeStudioOpfsContentHash(candidate);
          if (hash && !seen.has(hash)) {
            seen.add(hash);
            normalized.push(hash);
          }
        }
        const state = await loadIndex();
        state.owners.set(name, { hashes: seen, updatedAt: timestampNow() });
        await saveIndex(state);
        return normalized;
      });
    },

    async ownerRefs(owner) {
      // ownerRefs -> setOwnerRefs is a logical RMW protected by the product owner Web Lock. Its
      // first read must observe the tab that held that lock immediately before this one.
      const record = (await loadIndex(true)).owners.get(String(owner ?? "").trim());
      return record ? [...record.hashes] : [];
    },

    async owners() {
      return [...(await loadIndex()).owners.keys()].sort();
    },

    sweep(sweepOptions = {}) {
      return mutate(async () => {
        const grace = sweepOptions.graceMs ?? graceMs;
        const at = timestampNow();
        const state = await loadIndex();
        const referenced = new Set<StudioOpfsContentHash>();
        for (const record of state.owners.values()) {
          for (const hash of record.hashes) referenced.add(hash);
        }
        const removed: StudioOpfsAssetEntry[] = [];
        const retainedInGrace: StudioOpfsAssetEntry[] = [];
        for (const entry of [...state.entries.values()]) {
          if (referenced.has(entry.hash)) continue;
          if (at - entry.createdAt < grace) {
            retainedInGrace.push({ ...entry });
            continue;
          }
          removed.push({ ...entry });
        }
        if (!sweepOptions.dryRun) {
          for (const entry of removed) {
            await fs.remove(entry.path);
            state.entries.delete(entry.hash);
          }
          if (removed.length > 0) await saveIndex(state);
        }
        return {
          removed,
          retainedInGrace,
          referenced: referenced.size,
          freedBytes: removed.reduce((sum, entry) => sum + entry.storedBytes, 0),
        };
      });
    },

    rebuildIndex() {
      return mutate(async () => {
        const state = await loadIndex();
        const rebuilt: StudioOpfsIndexState = { entries: new Map(), owners: state.owners };
        const paths = await fs.list(`${BLOB_DIR}/`);
        for (const path of paths) {
          const fileName = path.slice(BLOB_DIR.length + 1);
          const dot = fileName.lastIndexOf(".");
          if (dot <= 0) continue;
          const hash = canonicalizeStudioOpfsContentHash(`sha256:${fileName.slice(0, dot)}`);
          const codec = EXTENSION_CODEC[fileName.slice(dot + 1)];
          if (!hash || !codec) continue;
          const previous = state.entries.get(hash);
          if (previous && previous.path === path) {
            rebuilt.entries.set(hash, previous);
            continue;
          }
          // 색인에 없던 파일(다른 탭이 만든 것, 중단된 색인 쓰기의 잔재)을 입양한다.
          // 원본 길이는 실제로 풀어 봐야 알 수 있고, MIME은 알 수 없으므로 정직하게 octet-stream.
          const storedBytes = (await fs.size(path)) ?? 0;
          let bytes = storedBytes;
          try {
            const stored = await fs.read(path);
            if (stored) bytes = (await decompressStudioOpfsBytes(stored, codec, compressionScope)).byteLength;
          } catch {
            continue; // 풀 수 없는 파일은 입양하지 않는다(다음 sweep이 손대지도 않는다).
          }
          const timestamp = timestampNow();
          rebuilt.entries.set(hash, {
            hash,
            path,
            bytes,
            storedBytes,
            codec,
            mime: previous?.mime ?? "application/octet-stream",
            createdAt: previous?.createdAt ?? timestamp,
            lastAccessAt: previous?.lastAccessAt ?? timestamp,
          });
        }
        await saveIndex(rebuilt);
        return [...rebuilt.entries.values()].map((entry) => ({ ...entry }));
      });
    },

    estimateQuota() {
      return estimateStudioOpfsQuota(options.estimator ?? null);
    },

    async totalStoredBytes() {
      let total = 0;
      for (const entry of (await loadIndex()).entries.values()) total += entry.storedBytes;
      return total;
    },
  };
}
