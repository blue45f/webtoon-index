import {
  canonicalizeBg3dModelHash,
  getStoredBg3dModelByHashV12 as getStoredBg3dModelByHash,
  isSafeBg3dModelStorageId,
  isVerifiedBg3dModelRecord,
  revalidateStoredBg3dModelForRendering,
  type Bg3dModelAdmissionOptions,
  type Bg3dVerifiedStoredRecord,
} from "./bg3d-model-library";
import {
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  type StudioBg3dGlbValidationSuccess,
} from "./studio-bg3d-glb-validation";

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const MAX_DOWNLOAD_NAME_CODE_POINTS = 116;
const SOURCE_FORMAT_SUFFIX = /\.(?:3ds|dae|fbx|glb|gltf|obj|ply|stl)$/iu;
const UNSAFE_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/gu;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export type StudioBg3dCanonicalGlbDownloadErrorCode =
  | "aborted"
  | "download-failed"
  | "download-unavailable"
  | "invalid-glb"
  | "invalid-request"
  | "record-mismatch"
  | "record-missing"
  | "validation-failed";

const ERROR_MESSAGES: Readonly<Record<StudioBg3dCanonicalGlbDownloadErrorCode, string>> =
  Object.freeze({
    aborted: "정규화 GLB 저장을 취소했습니다.",
    "download-failed": "정규화 GLB 파일 저장을 시작하지 못했습니다. 다시 시도해 주세요.",
    "download-unavailable": "이 브라우저에서는 로컬 GLB 파일 저장을 사용할 수 없습니다.",
    "invalid-glb": "재검증 결과가 완전한 GLB 2.0 파일이 아닙니다. 모델을 다시 등록해 주세요.",
    "invalid-request": "저장할 3D 모델의 식별 정보를 확인할 수 없습니다. 라이브러리를 새로고침해 주세요.",
    "record-mismatch": "화면의 3D 모델 정보와 로컬 검증 레코드가 달라졌습니다. 라이브러리를 새로고침해 주세요.",
    "record-missing": "검증된 GLB 원본을 로컬 라이브러리에서 찾지 못했습니다.",
    "validation-failed": "저장 전 GLB 안전 검사와 무결성 검증을 통과하지 못했습니다. 모델을 다시 등록해 주세요.",
  });

export class StudioBg3dCanonicalGlbDownloadError extends Error {
  readonly code: StudioBg3dCanonicalGlbDownloadErrorCode;

  constructor(code: StudioBg3dCanonicalGlbDownloadErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioBg3dCanonicalGlbDownloadError";
    this.code = code;
  }
}

export interface StudioBg3dCanonicalGlbDownloadRequest {
  /** Private local SQLite/OPFS row identity captured with the visible library entry. */
  readonly storageId: string;
  /** Canonical content identity captured with the same visible library entry. */
  readonly expectedContentHash: string;
  readonly expectedByteSize: number;
  readonly expectedName: string;
}

export interface StudioBg3dCanonicalGlbDownloadResult {
  readonly fileName: string;
  readonly contentHash: `sha256:${string}`;
  readonly byteSize: number;
}

export interface StudioBg3dCanonicalGlbDownloadDependencies {
  readonly getStoredByHash: (
    hash: string,
  ) => Promise<Bg3dVerifiedStoredRecord | null>;
  readonly revalidateStored: (
    record: unknown,
    options?: Bg3dModelAdmissionOptions,
  ) => Promise<StudioBg3dGlbValidationSuccess>;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly triggerDownload: (url: string, fileName: string) => void;
  readonly scheduleObjectUrlRevoke: (revoke: () => void) => void;
}

export interface StudioBg3dCanonicalGlbDownloadOptions extends Bg3dModelAdmissionOptions {
  readonly dependencies?: Partial<StudioBg3dCanonicalGlbDownloadDependencies>;
}

function downloadError(
  code: StudioBg3dCanonicalGlbDownloadErrorCode,
  cause?: unknown,
): StudioBg3dCanonicalGlbDownloadError {
  return new StudioBg3dCanonicalGlbDownloadError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw downloadError("aborted", signal.reason);
}

function defaultCreateObjectUrl(blob: Blob): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw downloadError("download-unavailable");
  }
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

function defaultTriggerDownload(url: string, fileName: string): void {
  if (typeof document === "undefined" || !document.body) {
    throw downloadError("download-unavailable");
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function defaultScheduleObjectUrlRevoke(revoke: () => void): void {
  globalThis.setTimeout(revoke, 1_000);
}

const DEFAULT_DEPENDENCIES: StudioBg3dCanonicalGlbDownloadDependencies = Object.freeze({
  getStoredByHash: getStoredBg3dModelByHash,
  revalidateStored: revalidateStoredBg3dModelForRendering,
  createObjectUrl: defaultCreateObjectUrl,
  revokeObjectUrl: defaultRevokeObjectUrl,
  triggerDownload: defaultTriggerDownload,
  scheduleObjectUrlRevoke: defaultScheduleObjectUrlRevoke,
});

function resolveDependencies(
  overrides?: Partial<StudioBg3dCanonicalGlbDownloadDependencies>,
): StudioBg3dCanonicalGlbDownloadDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function normalizedExpectedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  return normalized && normalized === value ? normalized : null;
}

function validateRequest(request: StudioBg3dCanonicalGlbDownloadRequest): {
  readonly contentHash: `sha256:${string}`;
  readonly expectedName: string;
} {
  if (!request || typeof request !== "object" || !isSafeBg3dModelStorageId(request.storageId)) {
    throw downloadError("invalid-request");
  }
  const contentHash = canonicalizeBg3dModelHash(request.expectedContentHash);
  const expectedName = normalizedExpectedName(request.expectedName);
  if (
    !contentHash ||
    request.expectedContentHash !== contentHash ||
    !Number.isSafeInteger(request.expectedByteSize) ||
    request.expectedByteSize < GLB_HEADER_BYTES ||
    request.expectedByteSize > STUDIO_BG3D_GLB_MAX_BYTES ||
    !expectedName
  ) {
    throw downloadError("invalid-request");
  }
  return { contentHash, expectedName };
}

function recordMatchesRequest(
  record: unknown,
  request: StudioBg3dCanonicalGlbDownloadRequest,
  contentHash: `sha256:${string}`,
  expectedName: string,
): record is Bg3dVerifiedStoredRecord {
  return isVerifiedBg3dModelRecord(record)
    && record.id === request.storageId
    && record.name === expectedName
    && record.contentHash === contentHash
    && record.byteSize === request.expectedByteSize
    && record.blob.size === request.expectedByteSize
    && record.format === "glb"
    && record.mime === STUDIO_BG3D_GLB_MIME_TYPE
    && record.blob.type === STUDIO_BG3D_GLB_MIME_TYPE;
}

function assertCanonicalGlbSnapshot(
  validation: StudioBg3dGlbValidationSuccess,
  contentHash: `sha256:${string}`,
  byteSize: number,
): Uint8Array {
  const bytes = validation?.verifiedBytes;
  if (
    validation?.ok !== true ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== byteSize ||
    validation.verifiedSha256 !== contentHash ||
    validation.metrics?.byteSize !== byteSize ||
    bytes.byteLength < GLB_HEADER_BYTES
  ) {
    throw downloadError("record-mismatch");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw downloadError("invalid-glb");
  }
  return Uint8Array.from(bytes);
}

export function canonicalStudioBg3dGlbFileName(name: string): string {
  const normalized = typeof name === "string"
    ? name.normalize("NFKC").trim().replace(SOURCE_FORMAT_SUFFIX, "")
    : "";
  const withoutControls = Array.from(normalized, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  const safe = withoutControls
    .replace(UNSAFE_FILE_NAME_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[. ]+|[. ]+$/gu, "")
    .trim();
  let base = Array.from(safe).slice(0, MAX_DOWNLOAD_NAME_CODE_POINTS).join("").trim();
  if (!base) base = "3D 모델";
  if (WINDOWS_RESERVED_NAME.test(base)) base = `3D 모델 ${base}`;
  return `${base}.glb`;
}

/**
 * Downloads only the validator-owned snapshot of an already verified V2 local-library GLB.
 * Original FBX/OBJ/etc. source bytes are never exposed or relabeled as GLB by this boundary.
 */
export async function downloadCanonicalStudioBg3dGlb(
  request: StudioBg3dCanonicalGlbDownloadRequest,
  options: StudioBg3dCanonicalGlbDownloadOptions = {},
): Promise<StudioBg3dCanonicalGlbDownloadResult> {
  throwIfAborted(options.signal);
  const { contentHash, expectedName } = validateRequest(request);
  const dependencies = resolveDependencies(options.dependencies);
  let record: Bg3dVerifiedStoredRecord | null;
  try {
    record = await dependencies.getStoredByHash(contentHash);
  } catch (cause) {
    throwIfAborted(options.signal);
    throw downloadError("record-missing", cause);
  }
  throwIfAborted(options.signal);
  if (!record) throw downloadError("record-missing");
  if (!recordMatchesRequest(record, request, contentHash, expectedName)) {
    throw downloadError("record-mismatch");
  }

  const { dependencies: _dependencies, ...admissionOptions } = options;
  let validation: StudioBg3dGlbValidationSuccess;
  try {
    validation = await dependencies.revalidateStored(record, admissionOptions);
  } catch (cause) {
    throwIfAborted(options.signal);
    throw downloadError("validation-failed", cause);
  }
  throwIfAborted(options.signal);
  const verifiedBytes = assertCanonicalGlbSnapshot(
    validation,
    contentHash,
    request.expectedByteSize,
  );
  // `Uint8Array.buffer` is typed as ArrayBufferLike and may be backed by shared memory in a
  // hostile injected runtime. Give Blob an exclusively owned, ordinary ArrayBuffer snapshot.
  const downloadBuffer = new ArrayBuffer(verifiedBytes.byteLength);
  new Uint8Array(downloadBuffer).set(verifiedBytes);
  const blob = new Blob([downloadBuffer], { type: STUDIO_BG3D_GLB_MIME_TYPE });
  if (blob.size !== request.expectedByteSize || blob.type !== STUDIO_BG3D_GLB_MIME_TYPE) {
    throw downloadError("record-mismatch");
  }
  const fileName = canonicalStudioBg3dGlbFileName(record.name);

  let objectUrl: string;
  try {
    objectUrl = dependencies.createObjectUrl(blob);
  } catch (cause) {
    if (cause instanceof StudioBg3dCanonicalGlbDownloadError) throw cause;
    throw downloadError("download-unavailable", cause);
  }
  if (typeof objectUrl !== "string" || !objectUrl.startsWith("blob:")) {
    throw downloadError("download-unavailable");
  }
  const revoke = () => {
    try {
      dependencies.revokeObjectUrl(objectUrl);
    } catch {
      // The browser may already have released the URL. Cleanup remains best-effort.
    }
  };
  try {
    throwIfAborted(options.signal);
    dependencies.triggerDownload(objectUrl, fileName);
  } catch (cause) {
    revoke();
    if (cause instanceof StudioBg3dCanonicalGlbDownloadError && cause.code === "aborted") {
      throw cause;
    }
    throw downloadError("download-failed", cause);
  }
  try {
    // A click schedules the actual download in a later browser task. Keep the Blob URL alive across
    // that boundary; revoking in the same microtask can cancel Safari/Firefox downloads.
    dependencies.scheduleObjectUrlRevoke(revoke);
  } catch {
    revoke();
  }

  return Object.freeze({
    fileName,
    contentHash,
    byteSize: request.expectedByteSize,
  });
}
