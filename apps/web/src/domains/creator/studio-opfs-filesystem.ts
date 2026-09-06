/**
 * Studio OPFS Filesystem — 대용량 이진 자산을 담을 저장소의 "구조적 파일시스템" 이음매.
 *
 * 왜 이 층이 따로 있나: 스튜디오의 보관함들(글꼴·브러시 팁·클립 썸네일·참고 이미지·3D GLB)은
 * 전부 localStorage 하나를 나눠 쓴다. localStorage는 문자열만 담으므로 바이너리는 base64로
 * 1.333배 부풀고, origin 전체가 5 MB 안팎의 한 우물이라 글꼴 보관함이 3 MB로 묶여 있다
 * (studio-custom-fonts.ts §용량 예산 참고). OPFS(Origin Private File System)는 바이트를 그대로
 * 담고 쿼터가 origin 저장소 전체(보통 수백 MB~수 GB)라 이 천장을 없앤다.
 *
 * 다만 OPFS를 직접 호출하는 코드는 헤드리스로 테스트할 수 없다. 그래서 이 모듈은
 *   - 좁은 구조적 인터페이스 StudioOpfsFileSystem 을 정의하고,
 *   - 진짜 OPFS 바인딩은 얇은 어댑터(createStudioOpfsNativeFileSystem)로,
 *   - 테스트는 인메모리 가짜(createStudioOpfsMemoryFileSystem)로,
 *   - V11 이전 자료의 명시적 import/test만 legacy localStorage 어댑터로
 * 각각 갈아끼운다. 제품 선택기는 OPFS를 자동 선택하고, 불가능하면 손실 가능성이 드러나는
 * memory-only 결과를 반환한다. localStorage는 제품 폴백 후보가 아니다.
 *
 * OPFS가 없는 브라우저에서도 편집은 계속할 수 있지만, 선택 결과의 `durability`와 `reason`이
 * 창을 닫으면 사라지는 상태를 명시한다. 영속 저장처럼 보이는 조용한 폴백은 허용하지 않는다.
 */

// ── 오류 ────────────────────────────────────────────────────────────────

export type StudioOpfsErrorCode =
  | "INVALID_PATH"
  | "NOT_SUPPORTED"
  | "QUOTA_EXCEEDED"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "REMOVE_FAILED"
  | "LIST_FAILED"
  | "CORRUPT_ENTRY"
  | "INTEGRITY_FAILED"
  | "HASH_UNAVAILABLE";

/** 저장소 계층이 던지는 유일한 오류 타입. message는 언제나 사용자에게 보여도 되는 한국어다. */
export class StudioOpfsError extends Error {
  readonly code: StudioOpfsErrorCode;
  override readonly cause?: unknown;

  constructor(code: StudioOpfsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "StudioOpfsError";
    this.code = code;
    this.cause = cause;
  }
}

export function isStudioOpfsError(value: unknown): value is StudioOpfsError {
  return value instanceof StudioOpfsError;
}

// ── 경로 규칙 ────────────────────────────────────────────────────────────

/**
 * 상대 경로만 허용한다. 세그먼트는 소문자 영숫자와 `.` `_` `-` 뿐이고, `.`/`..`는 금지한다.
 * 좁게 잡는 이유: 이 경로는 결국 OPFS 디렉터리 이름이 되므로, 플랫폼별 예약어·유니코드
 * 정규화 차이·경로 탈출을 애초에 만들지 않는 편이 어댑터 세 개를 각각 방어하는 것보다 싸다.
 */
const PATH_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/u;
export const STUDIO_OPFS_MAX_PATH_LENGTH = 200;

export function isValidStudioOpfsPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > STUDIO_OPFS_MAX_PATH_LENGTH) {
    return false;
  }
  const segments = path.split("/");
  if (segments.length > 4) return false;
  return segments.every(
    (segment) => segment !== "." && segment !== ".." && PATH_SEGMENT_RE.test(segment)
  );
}

function assertPath(path: string): string {
  if (!isValidStudioOpfsPath(path)) {
    throw new StudioOpfsError("INVALID_PATH", `저장 경로가 올바르지 않아요: ${String(path)}`);
  }
  return path;
}

// ── 구조적 인터페이스 ────────────────────────────────────────────────────

export type StudioOpfsFileSystemKind = "opfs" | "memory" | "local-storage";

export interface StudioOpfsFileSystem {
  readonly kind: StudioOpfsFileSystemKind;
  /** 없는 파일은 null. 읽기 자체가 실패하면 StudioOpfsError("READ_FAILED"). */
  read(path: string): Promise<Uint8Array | null>;
  /**
   * 원자적 쓰기. 성공하면 전체가, 실패하면 이전 내용이 남는다(부분 기록 없음).
   * OPFS는 createWritable()이 스왑 파일에 쓰고 close()에서 교체하므로 이 계약이 공짜로 성립하고,
   * 가짜/폴백 어댑터도 같은 계약을 흉내 낸다 — 중단된 마이그레이션 테스트가 기대는 지점이다.
   */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** 지웠으면 true, 원래 없었으면 false. */
  remove(path: string): Promise<boolean>;
  /** prefix로 시작하는 경로들(정렬됨). prefix는 `blobs/`처럼 디렉터리 경계로 준다. */
  list(prefix?: string): Promise<string[]>;
  /** 저장된 바이트 수(압축 후 실제 크기). 없으면 null. */
  size(path: string): Promise<number | null>;
}

// ── 인메모리 가짜 ────────────────────────────────────────────────────────

export interface StudioOpfsMemoryFileSystemOptions {
  /** N번째 write 호출(1-based)부터 실패시킨다. 중단·크래시 시나리오 재현용. */
  failWriteAfter?: number;
  /** N번째 read 호출(1-based)부터 실패시킨다. */
  failReadAfter?: number;
}

export interface StudioOpfsMemoryFileSystem extends StudioOpfsFileSystem {
  readonly kind: "memory";
  /** 지금까지의 호출 횟수. 마이그레이션이 중복 쓰기를 하지 않는지 세는 데 쓴다. */
  readonly counts: { read: number; write: number; remove: number; list: number };
  /** 테스트 검사용 스냅샷(경로 → 바이트 사본). */
  snapshot(): Map<string, Uint8Array>;
  /** 주입한 실패를 해제하고 카운터를 0으로. "크래시 후 재시작"을 표현한다. */
  restart(options?: StudioOpfsMemoryFileSystemOptions): void;
}

export function createStudioOpfsMemoryFileSystem(
  options: StudioOpfsMemoryFileSystemOptions = {}
): StudioOpfsMemoryFileSystem {
  const files = new Map<string, Uint8Array>();
  let failWriteAfter = options.failWriteAfter ?? Number.POSITIVE_INFINITY;
  let failReadAfter = options.failReadAfter ?? Number.POSITIVE_INFINITY;
  const counts = { read: 0, write: 0, remove: 0, list: 0 };

  return {
    kind: "memory",
    counts,
    async read(path) {
      assertPath(path);
      counts.read += 1;
      if (counts.read >= failReadAfter) {
        throw new StudioOpfsError("READ_FAILED", "저장소 읽기가 중단됐어요.");
      }
      const found = files.get(path);
      return found ? Uint8Array.from(found) : null;
    },
    async write(path, bytes) {
      assertPath(path);
      counts.write += 1;
      // 실패는 맵을 건드리기 *전에* 던진다 — 부분 기록 없음(원자적 쓰기 계약).
      if (counts.write >= failWriteAfter) {
        throw new StudioOpfsError("WRITE_FAILED", "저장소 쓰기가 중단됐어요.");
      }
      files.set(path, Uint8Array.from(bytes));
    },
    async remove(path) {
      assertPath(path);
      counts.remove += 1;
      return files.delete(path);
    },
    async list(prefix = "") {
      counts.list += 1;
      return [...files.keys()].filter((path) => path.startsWith(prefix)).sort();
    },
    async size(path) {
      assertPath(path);
      return files.get(path)?.byteLength ?? null;
    },
    snapshot() {
      return new Map([...files].map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
    },
    restart(next = {}) {
      failWriteAfter = next.failWriteAfter ?? Number.POSITIVE_INFINITY;
      failReadAfter = next.failReadAfter ?? Number.POSITIVE_INFINITY;
      counts.read = 0;
      counts.write = 0;
      counts.remove = 0;
      counts.list = 0;
    },
  };
}

// ── 진짜 OPFS 어댑터 ─────────────────────────────────────────────────────
// lib.dom의 FileSystem*Handle을 직접 참조하지 않고 필요한 최소 형태만 선언한다
// (테스트가 가짜 핸들을 넘길 수 있고, 브라우저별 타입 편차에도 흔들리지 않는다).

export interface StudioOpfsWritableLike {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}

export interface StudioOpfsFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StudioOpfsFileHandleLike {
  getFile(): Promise<StudioOpfsFileLike>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<StudioOpfsWritableLike>;
}

export interface StudioOpfsDirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<StudioOpfsDirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<StudioOpfsFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

export interface StudioOpfsStorageManagerLike {
  getDirectory(): Promise<StudioOpfsDirectoryHandleLike>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

/** 브라우저가 파일이 없을 때 던지는 오류인지. 이름으로만 판별한다(생성자는 환경마다 다르다). */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

function splitPath(path: string): { dirs: string[]; file: string } {
  const segments = assertPath(path).split("/");
  const file = segments.pop() as string;
  return { dirs: segments, file };
}

/**
 * OPFS 루트 아래 rootName 디렉터리를 이 저장소의 샌드박스로 쓴다. 다른 기능(체크포인트
 * IndexedDB 등)과 이름공간이 겹치지 않도록 반드시 하위 디렉터리를 판다.
 */
export function createStudioOpfsNativeFileSystem(
  storageManager: StudioOpfsStorageManagerLike,
  rootName = "toonspectrum-studio-assets"
): StudioOpfsFileSystem {
  let rootPromise: Promise<StudioOpfsDirectoryHandleLike> | null = null;

  async function root(): Promise<StudioOpfsDirectoryHandleLike> {
    rootPromise ??= (async () => {
      const base = await storageManager.getDirectory();
      return base.getDirectoryHandle(rootName, { create: true });
    })();
    try {
      return await rootPromise;
    } catch (error) {
      rootPromise = null;
      throw new StudioOpfsError("NOT_SUPPORTED", "이 브라우저에서 저장소를 열 수 없어요.", error);
    }
  }

  async function directory(
    dirs: readonly string[],
    create: boolean
  ): Promise<StudioOpfsDirectoryHandleLike | null> {
    let handle = await root();
    for (const name of dirs) {
      try {
        handle = await handle.getDirectoryHandle(name, { create });
      } catch (error) {
        if (!create && isNotFound(error)) return null;
        throw error;
      }
    }
    return handle;
  }

  async function fileHandle(
    path: string,
    create: boolean
  ): Promise<StudioOpfsFileHandleLike | null> {
    const { dirs, file } = splitPath(path);
    const dir = await directory(dirs, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(file, { create });
    } catch (error) {
      if (!create && isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    kind: "opfs",
    async read(path) {
      try {
        const handle = await fileHandle(path, false);
        if (!handle) return null;
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        if (isStudioOpfsError(error)) throw error;
        if (isNotFound(error)) return null;
        throw new StudioOpfsError("READ_FAILED", "저장된 자산을 읽지 못했어요.", error);
      }
    },
    async write(path, bytes) {
      try {
        const handle = await fileHandle(path, true);
        if (!handle) throw new StudioOpfsError("WRITE_FAILED", "저장 위치를 만들지 못했어요.");
        // createWritable()은 스왑 파일에 쓰고 close()에서 교체한다 — close() 전에 죽으면
        // 원본이 그대로 남으므로 이 write는 원자적이다(부분 파일이 생기지 않는다).
        const writable = await handle.createWritable();
        try {
          const payload = new Uint8Array(bytes.byteLength);
          payload.set(bytes);
          await writable.write(payload.buffer);
        } catch (error) {
          await writable.close().catch(() => undefined);
          throw error;
        }
        await writable.close();
      } catch (error) {
        if (isStudioOpfsError(error)) throw error;
        throw new StudioOpfsError(
          isQuotaError(error) ? "QUOTA_EXCEEDED" : "WRITE_FAILED",
          isQuotaError(error)
            ? "저장 공간이 부족해 자산을 저장하지 못했어요."
            : "자산을 저장하지 못했어요.",
          error
        );
      }
    },
    async remove(path) {
      const { dirs, file } = splitPath(path);
      try {
        const dir = await directory(dirs, false);
        if (!dir) return false;
        await dir.removeEntry(file);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        if (isStudioOpfsError(error)) throw error;
        throw new StudioOpfsError("REMOVE_FAILED", "자산을 지우지 못했어요.", error);
      }
    },
    async list(prefix = "") {
      try {
        const found: string[] = [];
        await walk(await root(), "", found);
        return found.filter((path) => path.startsWith(prefix)).sort();
      } catch (error) {
        if (isStudioOpfsError(error)) throw error;
        throw new StudioOpfsError("LIST_FAILED", "저장된 자산 목록을 읽지 못했어요.", error);
      }
    },
    async size(path) {
      const handle = await fileHandle(path, false);
      if (!handle) return null;
      try {
        return (await handle.getFile()).size;
      } catch {
        return null;
      }
    },
  };

  /** 디렉터리를 두 단계까지만 훑는다(경로 규칙이 4세그먼트를 넘지 않게 막아 둔다). */
  async function walk(
    dir: StudioOpfsDirectoryHandleLike,
    prefix: string,
    out: string[],
    depth = 0
  ): Promise<void> {
    if (depth > 3) return;
    for await (const name of dir.keys()) {
      const path = prefix ? `${prefix}/${name}` : name;
      // 파일인지 디렉터리인지 keys()만으로는 모른다. 파일 핸들 획득을 먼저 시도하고,
      // 실패하면 디렉터리로 간주해 내려간다(TypeMismatchError 등 이름이 환경마다 달라서
      // 이름 비교 대신 시도-실패로 판별한다).
      try {
        await dir.getFileHandle(name);
        out.push(path);
      } catch {
        try {
          await walk(await dir.getDirectoryHandle(name), path, out, depth + 1);
        } catch {
          // 읽을 수 없는 항목은 목록에서 조용히 빠진다 — 목록 실패가 스튜디오를 막으면 안 된다.
        }
      }
    }
  }
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "QuotaExceededError" || name === "NS_ERROR_FILE_NO_DEVICE_SPACE";
}

// ── 명시적 legacy/import-test localStorage 어댑터 ────────────────────────

export interface StudioOpfsLegacyLocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** @deprecated V11 자료 import codec의 타입 호환성만을 위한 별칭. 제품 선택에 사용하지 않는다. */
export type StudioOpfsLocalStorageLike = StudioOpfsLegacyLocalStorageLike;

export interface StudioOpfsLegacyLocalStorageFileSystemOptions {
  keyPrefix?: string;
  /**
   * 명시적 legacy import/test 어댑터가 쓸 수 있는 원본 바이트 총량. 기본 1.5 MB
   * (base64로 약 2 MB 문자). 이 값은 제품 저장 용량이 아니다.
   */
  maxTotalBytes?: number;
}

export const STUDIO_OPFS_LEGACY_LOCAL_STORAGE_MAX_TOTAL_BYTES = 1_500_000;

const B64_CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + B64_CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * V11 이전 자료를 명시적으로 읽는 import 또는 테스트 전용 어댑터. 제품 부팅/능력 탐지에서
 * 자동 선택하지 않는다. 상한을 넘으면 조용히 자르지 않고 숫자를 밝힌 한국어로 거절한다.
 */
export function createStudioOpfsLegacyLocalStorageFileSystem(
  storage: StudioOpfsLegacyLocalStorageLike,
  options: StudioOpfsLegacyLocalStorageFileSystemOptions = {}
): StudioOpfsFileSystem {
  const keyPrefix = options.keyPrefix ?? "toonspectrum-studio-opfs-legacy:";
  const indexKey = `${keyPrefix}__paths`;
  const maxTotalBytes =
    options.maxTotalBytes ?? STUDIO_OPFS_LEGACY_LOCAL_STORAGE_MAX_TOTAL_BYTES;

  function readIndex(): string[] {
    try {
      const raw = storage.getItem(indexKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  function writeIndex(paths: readonly string[]): void {
    storage.setItem(indexKey, JSON.stringify([...paths].sort()));
  }

  function readBytes(path: string): Uint8Array | null {
    const raw = storage.getItem(keyPrefix + path);
    if (raw === null) return null;
    try {
      return fromBase64(raw);
    } catch {
      return null;
    }
  }

  function totalBytes(except: string): number {
    return readIndex().reduce(
      (sum, path) => (path === except ? sum : sum + (readBytes(path)?.byteLength ?? 0)),
      0
    );
  }

  return {
    kind: "local-storage",
    async read(path) {
      assertPath(path);
      return readBytes(path);
    },
    async write(path, bytes) {
      assertPath(path);
      const used = totalBytes(path);
      if (used + bytes.byteLength > maxTotalBytes) {
        throw new StudioOpfsError(
          "QUOTA_EXCEEDED",
          `이 브라우저는 대용량 저장소(OPFS)를 지원하지 않아 자산 보관함이 `
            + `${formatStudioOpfsBytes(maxTotalBytes)}로 제한돼요(현재 `
            + `${formatStudioOpfsBytes(used)} 사용). `
            + `${formatStudioOpfsBytes(bytes.byteLength)}를 더 담을 수 없어요. `
            + "최신 브라우저에서 열거나, 쓰지 않는 자산을 정리해주세요."
        );
      }
      // localStorage.setItem은 키 단위로 원자적이라 부분 기록이 생기지 않는다.
      try {
        storage.setItem(keyPrefix + path, toBase64(bytes));
      } catch (error) {
        throw new StudioOpfsError(
          "QUOTA_EXCEEDED",
          "브라우저 저장 공간이 가득 차 자산을 저장하지 못했어요. 쓰지 않는 자산을 정리해주세요.",
          error
        );
      }
      const paths = readIndex();
      if (!paths.includes(path)) writeIndex([...paths, path]);
    },
    async remove(path) {
      assertPath(path);
      const existed = storage.getItem(keyPrefix + path) !== null;
      storage.removeItem(keyPrefix + path);
      const paths = readIndex();
      if (paths.includes(path)) writeIndex(paths.filter((value) => value !== path));
      return existed;
    },
    async list(prefix = "") {
      return readIndex()
        .filter((path) => path.startsWith(prefix))
        .sort();
    },
    async size(path) {
      assertPath(path);
      return readBytes(path)?.byteLength ?? null;
    },
  };
}

// ── 능력 탐지 + 팩토리 ───────────────────────────────────────────────────

export interface StudioOpfsStorageManagerProbeLike {
  getDirectory?: unknown;
  estimate?: unknown;
}

export interface StudioOpfsFileSystemProbeScope {
  navigator?: { storage?: StudioOpfsStorageManagerProbeLike };
}

export type StudioOpfsFileSystemSelection =
  | {
      readonly fs: StudioOpfsFileSystem;
      readonly kind: "opfs";
      readonly durability: "durable";
      /** 왜 이 어댑터가 선택됐는지. 진단 패널에 그대로 띄울 수 있는 한국어. */
      readonly reason: string;
      readonly cause: null;
    }
  | {
      readonly fs: StudioOpfsMemoryFileSystem;
      readonly kind: "memory";
      readonly durability: "memory-only";
      /** 영속 저장이 불가능하므로 탭 종료 시 손실됨을 반드시 밝힌다. */
      readonly reason: string;
      readonly cause: unknown;
    };

/**
 * 실제로 디렉터리를 열어 보고 고른다. `getDirectory`가 함수로 존재해도 시크릿 모드·
 * 샌드박스 iframe에서는 호출이 던지기 때문에, 존재 검사만으로는 폴백 판단이 틀린다.
 */
export async function selectStudioOpfsFileSystem(
  scope: StudioOpfsFileSystemProbeScope = globalThis as StudioOpfsFileSystemProbeScope,
  options: { rootName?: string } = {}
): Promise<StudioOpfsFileSystemSelection> {
  const manager = scope.navigator?.storage;
  let unavailableCause: unknown = new StudioOpfsError(
    "NOT_SUPPORTED",
    "이 브라우저는 OPFS를 지원하지 않아요.",
  );
  if (manager && typeof manager.getDirectory === "function") {
    const native = createStudioOpfsNativeFileSystem(
      manager as StudioOpfsStorageManagerLike,
      options.rootName
    );
    try {
      await native.list();
      return {
        fs: native,
        kind: "opfs",
        durability: "durable",
        reason: "OPFS를 사용해요. 자산 보관함을 이 기기에 영구 저장합니다.",
        cause: null,
      };
    } catch (cause) {
      unavailableCause = cause;
    }
  }

  return {
    fs: createStudioOpfsMemoryFileSystem(),
    kind: "memory",
    durability: "memory-only",
    reason:
      "OPFS 영구 저장소를 열 수 없어 이번 탭 메모리에서만 자산을 유지해요. "
      + "창을 닫거나 새로고침하면 사라집니다.",
    cause: unavailableCause,
  };
}

// ── 표시 유틸 ────────────────────────────────────────────────────────────

/** studio-custom-fonts.ts formatCustomFontBytes와 같은 10진 눈금·한국어 로케일. */
export function formatStudioOpfsBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "용량 미확인";
  if (value < 1_000) return `${Math.round(value).toLocaleString("ko-KR")} B`;
  if (value < 1_000_000) {
    return `${(value / 1_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KB`;
  }
  if (value < 1_000_000_000) {
    return `${(value / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MB`;
  }
  return `${(value / 1_000_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} GB`;
}
