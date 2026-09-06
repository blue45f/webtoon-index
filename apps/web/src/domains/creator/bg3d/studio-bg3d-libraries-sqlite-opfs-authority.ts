/**
 * Shared V12 durable authority for the BG3D model, template, and asset-metadata libraries.
 *
 * Structured, canonical manifests live in the shared `studio-local-v12.db` KV table. Large model
 * and image payloads live in an OPFS SHA-256 CAS. This module deliberately has no IndexedDB or
 * localStorage fallback: product callers either obtain the durable authority or receive an
 * explicit error that the UI can surface as unsaved/session-only state.
 */

import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";
import { createStudioOpfsAssetStore } from "../studio-opfs-asset-store";
import { createStudioOpfsNativeFileSystem } from "../studio-opfs-filesystem";

import type { StudioLocalDatabase } from "../studio-local-database";
import type {
  StudioOpfsAssetRef,
  StudioOpfsAssetStore,
  StudioOpfsContentHash,
} from "../studio-opfs-asset-store";
import type { StudioOpfsStorageManagerLike } from "../studio-opfs-filesystem";

export const STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE =
  "studio-bg3d-libraries-v12";
export const STUDIO_BG3D_LIBRARIES_OPFS_ROOT =
  "toonspectrum-studio-bg3d-libraries-v12";
export const STUDIO_BG3D_LIBRARIES_LOCK_NAME =
  "toonspectrum-studio-bg3d-libraries-v12-write";

export const STUDIO_BG3D_LIBRARY_MANIFEST_KEYS = Object.freeze({
  models: "models-manifest-v1",
  templates: "templates-manifest-v1",
  metadata: "asset-metadata-manifest-v1",
} as const);

export type StudioBg3dLibraryManifestSlot = keyof typeof STUDIO_BG3D_LIBRARY_MANIFEST_KEYS;

export type StudioBg3dLibrariesAuthorityErrorCode =
  | "aborted"
  | "corrupt"
  | "storage-unavailable"
  | "transaction-failed";

export class StudioBg3dLibrariesAuthorityError extends Error {
  readonly code: StudioBg3dLibrariesAuthorityErrorCode;

  constructor(
    code: StudioBg3dLibrariesAuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioBg3dLibrariesAuthorityError";
    this.code = code;
  }
}

export type StudioBg3dLibrariesRunExclusive = <T>(task: () => Promise<T>) => Promise<T>;

export interface StudioBg3dLibrariesAuthorityOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly acquireAssetStore?: () => Promise<StudioOpfsAssetStore>;
  readonly runExclusive?: StudioBg3dLibrariesRunExclusive | null;
  readonly now?: () => number;
  /** A cleanup pass is skipped when the CAS index exceeds this bound. */
  readonly maxCleanupEntries?: number;
  /** Orphans younger than this are retained so an interrupted manifest commit can retry. */
  readonly orphanGraceMs?: number;
  /** Test-only seam for the deterministic in-memory OPFS adapter. Product defaults never set it. */
  readonly allowNonDurableAssetStoreForTests?: boolean;
}

export interface StudioBg3dLibraryBlobReceipt {
  readonly hash: StudioOpfsContentHash;
  readonly bytes: number;
  readonly mime: string;
}

export interface StudioBg3dLibraryMutationContext {
  readonly now: number;
  readonly currentRaw: string | null;
  putBlob(bytes: Uint8Array, mime: string): Promise<StudioBg3dLibraryBlobReceipt>;
  getBlob(receipt: StudioBg3dLibraryBlobReceipt): Promise<Uint8Array>;
}

export interface StudioBg3dLibraryMutationResult<T> {
  /** Strict canonical JSON validated by the domain adapter before returning it. */
  readonly nextRaw: string;
  /** Complete set of CAS hashes referenced by nextRaw. */
  readonly nextRefs: readonly StudioOpfsContentHash[];
  readonly result: T;
}

export interface StudioBg3dLibrariesAuthority {
  readManifest(slot: StudioBg3dLibraryManifestSlot): Promise<string | null>;
  readBlob(receipt: StudioBg3dLibraryBlobReceipt): Promise<Uint8Array>;
  mutate<T>(
    slot: StudioBg3dLibraryManifestSlot,
    currentRefs: (raw: string | null) => readonly StudioOpfsContentHash[],
    operation: (
      context: StudioBg3dLibraryMutationContext,
    ) => Promise<StudioBg3dLibraryMutationResult<T>>,
    signal?: AbortSignal,
  ): Promise<T>;
}

interface BrowserLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

function authorityError(
  code: StudioBg3dLibrariesAuthorityErrorCode,
  message: string,
  cause?: unknown,
): StudioBg3dLibrariesAuthorityError {
  return new StudioBg3dLibrariesAuthorityError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw authorityError("aborted", "BG3D 로컬 라이브러리 작업이 취소되었습니다.", signal.reason);
  }
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw authorityError("transaction-failed", "BG3D 라이브러리 저장 시각이 올바르지 않습니다.");
  }
  return value;
}

function normalizeRefs(values: readonly string[]): StudioOpfsContentHash[] {
  const refs = new Set<StudioOpfsContentHash>();
  for (const value of values) {
    if (/^sha256:[0-9a-f]{64}$/u.test(value)) refs.add(value as StudioOpfsContentHash);
    else throw authorityError("corrupt", "BG3D manifest의 CAS 참조가 올바르지 않습니다.");
  }
  return [...refs].sort();
}

function ownerFor(slot: StudioBg3dLibraryManifestSlot): string {
  return `${STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE}:${slot}`;
}

function createInRealmSequencer(): StudioBg3dLibrariesRunExclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

function browserRunExclusive(): StudioBg3dLibrariesRunExclusive | null {
  const manager = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { locks?: BrowserLockManagerLike }).locks;
  if (!manager || typeof manager.request !== "function") return null;
  return <T>(task: () => Promise<T>) => manager.request(
    STUDIO_BG3D_LIBRARIES_LOCK_NAME,
    { mode: "exclusive" },
    task,
  );
}

let productAssetStore: Promise<StudioOpfsAssetStore> | null = null;

function acquireProductAssetStore(): Promise<StudioOpfsAssetStore> {
  productAssetStore ??= Promise.resolve().then(() => {
    const storage = typeof navigator === "undefined" ? null : navigator.storage;
    if (!storage || typeof storage.getDirectory !== "function") {
      throw authorityError(
        "storage-unavailable",
        "OPFS를 사용할 수 없어 BG3D 모델과 썸네일을 영구 저장할 수 없습니다.",
      );
    }
    return createStudioOpfsAssetStore({
      fs: createStudioOpfsNativeFileSystem(
        storage as unknown as StudioOpfsStorageManagerLike,
        STUDIO_BG3D_LIBRARIES_OPFS_ROOT,
      ),
      estimator: storage,
    });
  });
  return productAssetStore;
}

function assertReceipt(
  receipt: StudioOpfsAssetRef,
  expectedBytes: number,
  expectedMime: string,
): StudioBg3dLibraryBlobReceipt {
  if (
    receipt.bytes !== expectedBytes ||
    receipt.mime !== expectedMime ||
    !/^sha256:[0-9a-f]{64}$/u.test(receipt.hash)
  ) {
    throw authorityError("corrupt", "BG3D CAS 영수증이 저장 요청과 일치하지 않습니다.");
  }
  return Object.freeze({ hash: receipt.hash, bytes: receipt.bytes, mime: receipt.mime });
}

export function createStudioBg3dLibrariesAuthority(
  options: StudioBg3dLibrariesAuthorityOptions = {},
): StudioBg3dLibrariesAuthority {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const acquireAssetStore = options.acquireAssetStore ?? acquireProductAssetStore;
  const crossRealmExclusive = options.runExclusive === undefined
    ? browserRunExclusive()
    : options.runExclusive;
  const inRealmExclusive = createInRealmSequencer();
  const now = options.now ?? Date.now;
  const maxCleanupEntries = options.maxCleanupEntries ?? 2_048;
  const orphanGraceMs = options.orphanGraceMs ?? 300_000;

  if (!Number.isSafeInteger(maxCleanupEntries) || maxCleanupEntries < 1) {
    throw new RangeError("maxCleanupEntries must be a positive safe integer");
  }
  if (!Number.isSafeInteger(orphanGraceMs) || orphanGraceMs < 0) {
    throw new RangeError("orphanGraceMs must be a non-negative safe integer");
  }

  async function resources(): Promise<{
    readonly database: StudioLocalDatabase;
    readonly assets: StudioOpfsAssetStore;
  }> {
    try {
      const [database, assets] = await Promise.all([acquireDatabase(), acquireAssetStore()]);
      if (
        !options.allowNonDurableAssetStoreForTests &&
        (assets.kind === "memory" || assets.kind === "local-storage")
      ) {
        throw authorityError(
          "storage-unavailable",
          "BG3D 제품 라이브러리는 OPFS가 아니면 영구 저장 완료로 표시하지 않습니다.",
        );
      }
      return { database, assets };
    } catch (cause) {
      if (cause instanceof StudioBg3dLibrariesAuthorityError) throw cause;
      throw authorityError(
        "storage-unavailable",
        "공유 V12 SQLite/OPFS BG3D 라이브러리를 열지 못했습니다.",
        cause,
      );
    }
  }

  async function verifiedBlob(
    assets: StudioOpfsAssetStore,
    receipt: StudioBg3dLibraryBlobReceipt,
  ): Promise<Uint8Array> {
    if (
      !/^sha256:[0-9a-f]{64}$/u.test(receipt.hash) ||
      !Number.isSafeInteger(receipt.bytes) ||
      receipt.bytes <= 0 ||
      typeof receipt.mime !== "string" ||
      receipt.mime.trim() !== receipt.mime ||
      receipt.mime.length === 0
    ) {
      throw authorityError("corrupt", "BG3D manifest의 CAS 영수증이 손상되었습니다.");
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await assets.get(receipt.hash, { verify: true });
    } catch (cause) {
      throw authorityError("corrupt", "BG3D CAS 바이트의 SHA-256 검증에 실패했습니다.", cause);
    }
    if (!bytes || bytes.byteLength !== receipt.bytes) {
      throw authorityError("corrupt", "BG3D manifest가 참조하는 CAS 바이트가 없거나 잘렸습니다.");
    }
    const stat = await assets.stat(receipt.hash);
    if (!stat || stat.bytes !== receipt.bytes || stat.mime !== receipt.mime) {
      throw authorityError("corrupt", "BG3D CAS 크기 또는 MIME 원장이 manifest와 다릅니다.");
    }
    return bytes;
  }

  const authority: StudioBg3dLibrariesAuthority = {
    async readManifest(slot: StudioBg3dLibraryManifestSlot) {
      const { database } = await resources();
      try {
        return await database.kvGet(
          STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
          STUDIO_BG3D_LIBRARY_MANIFEST_KEYS[slot],
        );
      } catch (cause) {
        throw authorityError("transaction-failed", "BG3D SQLite manifest를 읽지 못했습니다.", cause);
      }
    },

    async readBlob(receipt: StudioBg3dLibraryBlobReceipt) {
      const { assets } = await resources();
      return verifiedBlob(assets, receipt);
    },

    mutate<T>(
      slot: StudioBg3dLibraryManifestSlot,
      currentRefs: (raw: string | null) => readonly StudioOpfsContentHash[],
      operation: (
        context: StudioBg3dLibraryMutationContext,
      ) => Promise<StudioBg3dLibraryMutationResult<T>>,
      signal?: AbortSignal,
    ) {
      if (!crossRealmExclusive) {
        return Promise.reject(authorityError(
          "storage-unavailable",
          "Web Locks가 없어 BG3D SQLite/OPFS manifest를 안전하게 갱신할 수 없습니다.",
        ));
      }
      return inRealmExclusive(() => crossRealmExclusive(async () => {
        throwIfAborted(signal);
        const { database, assets } = await resources();
        let currentRaw: string | null;
        try {
          currentRaw = await database.kvGet(
            STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
            STUDIO_BG3D_LIBRARY_MANIFEST_KEYS[slot],
          );
        } catch (cause) {
          throw authorityError("transaction-failed", "BG3D SQLite manifest를 읽지 못했습니다.", cause);
        }
        throwIfAborted(signal);
        const oldRefs = normalizeRefs(currentRefs(currentRaw));
        const context: StudioBg3dLibraryMutationContext = Object.freeze({
          now: safeNow(now),
          currentRaw,
          async putBlob(bytes: Uint8Array, mime: string) {
            throwIfAborted(signal);
            if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
              typeof mime !== "string" || mime.trim() !== mime || mime.length === 0) {
              throw authorityError("corrupt", "BG3D CAS 저장 요청이 올바르지 않습니다.");
            }
            const stored = await assets.put(Uint8Array.from(bytes), { mime, codec: "identity" });
            const receipt = assertReceipt(stored.ref, bytes.byteLength, mime);
            await verifiedBlob(assets, receipt);
            return receipt;
          },
          getBlob: (receipt: StudioBg3dLibraryBlobReceipt) => verifiedBlob(assets, receipt),
        });
        const mutation = await operation(context);
        throwIfAborted(signal);
        if (typeof mutation.nextRaw !== "string" || mutation.nextRaw.length === 0) {
          throw authorityError("corrupt", "BG3D 다음 manifest가 비어 있습니다.");
        }
        const nextRefs = normalizeRefs(mutation.nextRefs);
        const unionRefs = normalizeRefs([...oldRefs, ...nextRefs]);
        const owner = ownerFor(slot);
        const manifestKey = STUDIO_BG3D_LIBRARY_MANIFEST_KEYS[slot];
        const publicationFailure = (cause: unknown) => authorityError(
          "transaction-failed",
          "BG3D CAS 기록 뒤 SQLite manifest 최종 커밋에 실패했습니다.",
          cause,
        );
        const setReconciledOwnerRefs = async (
          refs: readonly StudioOpfsContentHash[],
          cause: unknown,
          message: string,
        ): Promise<void> => {
          try {
            await assets.setOwnerRefs(owner, refs);
          } catch (reconciliationCause) {
            throw authorityError(
              "transaction-failed",
              message,
              new AggregateError(
                [cause, reconciliationCause],
                "BG3D manifest 커밋 오류와 CAS owner 재조정 오류가 함께 발생했습니다.",
              ),
            );
          }
        };
        const readDurablePublicationState = async (
          cause: unknown,
        ): Promise<"candidate" | "old" | "third"> => {
          let durableRaw: string | null;
          try {
            durableRaw = await database.kvGet(
              STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
              manifestKey,
            );
          } catch (reconciliationCause) {
            throw authorityError(
              "transaction-failed",
              "BG3D SQLite manifest 커밋 결과를 재확인하지 못했습니다.",
              new AggregateError(
                [cause, reconciliationCause],
                "BG3D manifest 커밋 응답과 재확인 읽기가 함께 실패했습니다.",
              ),
            );
          }
          // Candidate wins the equality tie for a canonical no-op mutation. In that case both
          // interpretations expose the same durable manifest, so returning its disposition is safe.
          if (durableRaw === mutation.nextRaw) return "candidate";
          if (durableRaw === currentRaw) return "old";
          return "third";
        };

        try {
          // Preserve both sides while the SQLite commit is still reversible. This closes deletion
          // races without exposing a newly referenced blob before its bytes have been verified.
          await assets.setOwnerRefs(owner, unionRefs);
        } catch (cause) {
          await setReconciledOwnerRefs(
            oldRefs,
            cause,
            "BG3D manifest 게시 전 CAS owner를 이전 상태로 복구하지 못했습니다.",
          );
          if (cause instanceof StudioBg3dLibrariesAuthorityError) throw cause;
          throw publicationFailure(cause);
        }

        try {
          throwIfAborted(signal);
        } catch (cause) {
          await setReconciledOwnerRefs(
            oldRefs,
            cause,
            "취소된 BG3D manifest의 CAS owner를 이전 상태로 복구하지 못했습니다.",
          );
          throw cause;
        }

        try {
          await database.kvSet(
            STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
            manifestKey,
            mutation.nextRaw,
          );
        } catch (cause) {
          // Do not trust the exception class as proof of commit outcome. A Worker/database adapter
          // can surface a generic error after its durable autocommit. Exact readback is the only
          // authority for deciding whether callers must receive the mutation disposition.
          const state = await readDurablePublicationState(cause);
          if (state === "candidate") {
            // The root commit completed before the error surfaced. Continue and return the exact
            // disposition so a higher-level failed project apply can compensate created rows.
          } else if (state === "old") {
            await setReconciledOwnerRefs(
              oldRefs,
              cause,
              "미커밋 BG3D manifest의 CAS owner를 이전 상태로 복구하지 못했습니다.",
            );
            throw publicationFailure(cause);
          } else {
            // A third durable value cannot be attributed to this operation. The union was already
            // installed, so preserve both sides and fail closed without collecting either set.
            throw publicationFailure(cause);
          }
        }

        try {
          // The candidate manifest is durable; contraction is cleanup of the conservative union.
          await assets.setOwnerRefs(owner, nextRefs);
        } catch {
          // Root kvSet is already known durable (resolved, or exact-candidate readback). Contraction
          // is leak-only cleanup: both its pre-call union and commit-before-throw nextRefs retain all
          // candidate blobs. Do not risk losing the exact mutation disposition on a diagnostic read.
        }

        // Cleanup is deliberately bounded. A suspiciously large index is left untouched for a
        // diagnostic/manual recovery pass rather than turning one foreground mutation into an
        // unbounded scan.
        try {
          const entries = await assets.list();
          if (entries.length <= maxCleanupEntries) {
            await assets.sweep({ graceMs: orphanGraceMs });
          }
        } catch {
          // Manifest durability wins. An orphan is recoverable; deleting a live blob is not.
        }
        return mutation.result;
      }));
    },
  };
  return Object.freeze(authority);
}

let sharedProductAuthority: StudioBg3dLibrariesAuthority | null = null;

export function getStudioBg3dLibrariesAuthority(): StudioBg3dLibrariesAuthority {
  sharedProductAuthority ??= createStudioBg3dLibrariesAuthority();
  return sharedProductAuthority;
}
