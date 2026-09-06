/**
 * OffscreenCanvas 래스터화 Worker 와이어 프로토콜.
 *
 * 이 모듈은 studio-image-filter-worker-protocol / studio-bg3d-lt-render-worker-protocol 이
 * 정착시킨 레포 관례를 그대로 따른다:
 *  - `*_PROTOCOL_VERSION` 상수 하나로 양쪽 메시지를 버전 게이팅한다.
 *  - 요청/응답은 `kind` 판별 유니온이고, 실패는 throw 가 아니라 타입이 있는 실패 메시지다.
 *  - 런타임 검증기(`is*Message`)가 exact-key + 치수 + byteLength + 소유권까지 확인한다.
 *  - transfer 목록은 프로토콜 모듈이 계산한다(클라이언트·Worker 가 각자 손으로 안 만든다).
 *
 * 소유권(zero-copy) 규칙 — 이 파일이 유일한 규범:
 *  1. 픽셀은 절대 structured clone 하지 않는다. RGBA 는 전용 `ArrayBuffer`, 디코드된 이미지는
 *     `ImageBitmap` 으로만 실린다. 둘 다 transferable 이다.
 *  2. transfer 목록에 오른 값은 postMessage 직후 **송신자 쪽에서 detach** 된다. 송신자는 그
 *     버퍼/비트맵을 다시 읽거나 쓰면 안 되고, 참조를 보관해서도 안 된다.
 *  3. 그래서 페이로드에 실리는 버퍼는 `adoptStudioOffscreenPixelBuffer()` 를 통과해야 한다.
 *     이 함수는 부분 view·SharedArrayBuffer 처럼 "남이 같이 보고 있는" 메모리를 전용 버퍼로
 *     복제해 소유권을 확정하고, 브랜드 타입으로 그 사실을 타입 시스템에 기록한다.
 *  4. `Blob` 은 transferable 이 아니지만 구조적 복제가 참조 카운트라 픽셀 복사가 없다 —
 *     인코딩 결과만 Blob 으로 돌려준다.
 */

export const STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION = 1 as const;

/** 주요 브라우저가 조용히 빈 캔버스를 내놓기 시작하는 한 변 한계(studio-export.MAX_CANVAS_DIM 과 동일). */
export const STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION = 16_384;
/** 64 MP = RGBA 256 MiB. 합성은 보조 표면을 더 잡으므로 이 위는 경계에서 거부한다. */
export const STUDIO_OFFSCREEN_RASTER_MAX_PIXELS = 64 * 1024 * 1024;
/** 한 잡이 그리는 소스 수 상한 — 페이지 요소가 아무리 많아도 메시지 크기를 유계로 만든다. */
export const STUDIO_OFFSCREEN_RASTER_MAX_SOURCES = 1_024;
/** 코얼레싱 키 길이 상한 — 키는 사람이 읽는 짧은 라벨이어야 한다. */
export const STUDIO_OFFSCREEN_RASTER_MAX_JOB_KEY_CHARS = 128;

export const STUDIO_OFFSCREEN_RASTER_ENCODE_MIMES = [
  "image/png",
  "image/webp",
  "image/jpeg",
] as const;

export type StudioOffscreenRasterEncodeMime = (typeof STUDIO_OFFSCREEN_RASTER_ENCODE_MIMES)[number];

export const STUDIO_OFFSCREEN_RASTER_FAILURE_CODES = [
  /** 메시지 형태가 계약과 다르다(어느 쪽에서든). */
  "protocol",
  /** 이 런타임에 선택된 OffscreenCanvas / 2D 컨텍스트가 없다. 호출자는 명시적 unavailable 로 처리한다. */
  "unsupported",
  /** 치수·픽셀 수·소스 수 예산 초과. */
  "oversized",
  /** 명시적 취소(abort 시그널 또는 cancel 메시지)가 비행 중에 도착했다. */
  "cancelled",
  /** 같은 jobKey 의 더 새로운 런이 중재에서 이겼다. */
  "superseded",
  /** 합성(draw/decode) 실패. */
  "raster-failed",
  /** convertToBlob 인코딩 실패. */
  "encode-failed",
  /** Worker 자체가 죽거나 생성되지 않았다. */
  "worker-failed",
  /** 유계 실행 마감이 지났다. */
  "timeout",
] as const;

export type StudioOffscreenRasterFailureCode = (typeof STUDIO_OFFSCREEN_RASTER_FAILURE_CODES)[number];

// ── 소유권 브랜드 ────────────────────────────────────────────────────────────────

declare const studioOffscreenOwnedBrand: unique symbol;

/**
 * "이 ArrayBuffer 는 이 메시지가 단독 소유하며, post 되는 순간 송신자에서 detach 된다"는 표식.
 * `adoptStudioOffscreenPixelBuffer()` 만 이 타입을 만들 수 있으므로, 남과 공유 중인 버퍼가
 * 실수로 transfer 목록에 오르는 경로가 타입 레벨에서 막힌다.
 */
export type StudioOffscreenOwnedBuffer = ArrayBuffer & {
  readonly [studioOffscreenOwnedBrand]: "transfer-on-post";
};

/** 같은 규칙의 ImageBitmap 판 — transfer 후 송신자의 핸들은 사용 불가(닫힌 것과 같다). */
export type StudioOffscreenOwnedBitmap = ImageBitmap & {
  readonly [studioOffscreenOwnedBrand]: "transfer-on-post";
};

// ── 메시지 형태 ──────────────────────────────────────────────────────────────────

export interface StudioOffscreenRasterPlacement {
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
  /** 0..1 — Konva 요소 opacity 와 같은 의미. */
  readonly opacity: number;
  /** 도(degree). 배치 사각형의 중심을 기준으로 회전한다. */
  readonly rotation: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

export interface StudioOffscreenRasterPixelSource {
  readonly kind: "pixels";
  readonly width: number;
  readonly height: number;
  /** 촘촘히 패킹된 RGBA8. 이 메시지가 단독 소유한다. */
  readonly pixels: StudioOffscreenOwnedBuffer;
  readonly placement: StudioOffscreenRasterPlacement;
}

export interface StudioOffscreenRasterBitmapSource {
  readonly kind: "bitmap";
  readonly bitmap: StudioOffscreenOwnedBitmap;
  readonly placement: StudioOffscreenRasterPlacement;
}

export type StudioOffscreenRasterSource =
  | StudioOffscreenRasterPixelSource
  | StudioOffscreenRasterBitmapSource;

export interface StudioOffscreenRasterTarget {
  readonly width: number;
  readonly height: number;
  /** CSS 색 문자열. `null` 이면 투명 배경(PNG 알파 유지). */
  readonly background: string | null;
}

export type StudioOffscreenRasterOutput =
  | { readonly kind: "pixels" }
  | { readonly kind: "bitmap" }
  | {
      readonly kind: "encoded";
      readonly mime: StudioOffscreenRasterEncodeMime;
      /** 손실 포맷 품질 0..1. PNG 에서는 반드시 생략한다. */
      readonly quality?: number;
    };

export interface StudioOffscreenRasterRunMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "run";
  /** 전 세션에서 단조 증가. 중재의 유일한 기준. */
  readonly runId: number;
  /** 코얼레싱 단위(예: `thumbnail:page-3`). 같은 키의 새 요청이 옛 요청을 대체한다. */
  readonly jobKey: string;
  readonly target: StudioOffscreenRasterTarget;
  readonly sources: readonly StudioOffscreenRasterSource[];
  readonly output: StudioOffscreenRasterOutput;
}

export interface StudioOffscreenRasterCancelMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "cancel";
  readonly runId: number;
}

export type StudioOffscreenRasterRequestMessage =
  | StudioOffscreenRasterRunMessage
  | StudioOffscreenRasterCancelMessage;

export interface StudioOffscreenRasterReadyMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "ready";
}

export interface StudioOffscreenRasterUnavailableMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "unavailable";
  readonly code: "offscreen-canvas";
}

export type StudioOffscreenRasterResultPayload =
  | { readonly kind: "pixels"; readonly pixels: StudioOffscreenOwnedBuffer }
  | { readonly kind: "bitmap"; readonly bitmap: StudioOffscreenOwnedBitmap }
  | { readonly kind: "encoded"; readonly mime: StudioOffscreenRasterEncodeMime; readonly blob: Blob };

export interface StudioOffscreenRasterResultMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly runId: number;
  readonly width: number;
  readonly height: number;
  readonly payload: StudioOffscreenRasterResultPayload;
}

export interface StudioOffscreenRasterFailureMessage {
  readonly version: typeof STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION;
  readonly kind: "failure";
  readonly runId: number;
  readonly code: StudioOffscreenRasterFailureCode;
  readonly message: string;
}

export type StudioOffscreenRasterResponseMessage =
  | StudioOffscreenRasterReadyMessage
  | StudioOffscreenRasterUnavailableMessage
  | StudioOffscreenRasterResultMessage
  | StudioOffscreenRasterFailureMessage;

// ── 런타임 검증 ──────────────────────────────────────────────────────────────────

const PLACEMENT_KEYS = ["dx", "dy", "dw", "dh", "opacity", "rotation", "flipX", "flipY"] as const;
const PIXEL_SOURCE_KEYS = ["kind", "width", "height", "pixels", "placement"] as const;
const BITMAP_SOURCE_KEYS = ["kind", "bitmap", "placement"] as const;
const TARGET_KEYS = ["width", "height", "background"] as const;
const RUN_KEYS = ["version", "kind", "runId", "jobKey", "target", "sources", "output"] as const;
const CANCEL_KEYS = ["version", "kind", "runId"] as const;
const READY_KEYS = ["version", "kind"] as const;
const UNAVAILABLE_KEYS = ["version", "kind", "code"] as const;
const RESULT_KEYS = ["version", "kind", "runId", "width", "height", "payload"] as const;
const FAILURE_KEYS = ["version", "kind", "runId", "code", "message"] as const;

const FAILURE_CODE_SET: ReadonlySet<string> = new Set(STUDIO_OFFSCREEN_RASTER_FAILURE_CODES);
const ENCODE_MIME_SET: ReadonlySet<string> = new Set(STUDIO_OFFSCREEN_RASTER_ENCODE_MIMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) return false;
  return required.every((key) => hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isRunId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFinite2(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDimension(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION;
}

/**
 * `instanceof ArrayBuffer` 는 SharedArrayBuffer 를 의도적으로 거부한다 — SAB 는 transferable 이
 * 아니라서 실리면 조용히 구조적 복제(=대용량 픽셀 복사)로 떨어진다.
 */
function isOwnedArrayBuffer(value: unknown, byteLength: number): value is StudioOffscreenOwnedBuffer {
  return value instanceof ArrayBuffer && value.byteLength === byteLength;
}

/**
 * ImageBitmap 판별. Worker/DOM 밖(Vitest node 환경)에는 생성자가 없으므로 생성자 → 태그 →
 * 구조(width/height/close) 순으로 좁힌다. 픽셀은 어차피 transfer 로만 오간다.
 */
export function isStudioOffscreenBitmapLike(value: unknown): value is ImageBitmap {
  if (!value || typeof value !== "object") return false;
  const BitmapConstructor = (globalThis as { ImageBitmap?: unknown }).ImageBitmap;
  if (typeof BitmapConstructor === "function" && value instanceof (BitmapConstructor as never)) {
    return true;
  }
  if (Object.prototype.toString.call(value) === "[object ImageBitmap]") return true;
  const candidate = value as { width?: unknown; height?: unknown; close?: unknown };
  return isDimension(candidate.width) && isDimension(candidate.height) && typeof candidate.close === "function";
}

function isBlobLike(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;
  const BlobConstructor = (globalThis as { Blob?: unknown }).Blob;
  if (typeof BlobConstructor === "function" && value instanceof (BlobConstructor as never)) return true;
  const candidate = value as { size?: unknown; type?: unknown; arrayBuffer?: unknown; slice?: unknown };
  return typeof candidate.size === "number"
    && candidate.size >= 0
    && typeof candidate.type === "string"
    && typeof candidate.arrayBuffer === "function"
    && typeof candidate.slice === "function";
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.byteLength < offset + expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

/** MIME 라벨이 아니라 컨테이너 magic으로 Worker 인코더의 실제 출력 형식을 판별한다. */
export function detectStudioOffscreenRasterEncodedMime(
  bytes: Uint8Array,
): StudioOffscreenRasterEncodeMime | null {
  if (
    bytes.byteLength >= 8
    && bytes[0] === 0x89
    && asciiAt(bytes, 1, "PNG")
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

/** 요청 MIME, Blob MIME, 실제 컨테이너가 모두 같은 경우에만 인코딩 성공으로 인정한다. */
export async function isStudioOffscreenRasterEncodedBlobExact(
  blob: unknown,
  expectedMime: StudioOffscreenRasterEncodeMime,
): Promise<boolean> {
  if (
    !ENCODE_MIME_SET.has(expectedMime)
    || !isBlobLike(blob)
    || blob.size <= 0
    || blob.type.trim().toLowerCase() !== expectedMime
  ) return false;
  try {
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    return detectStudioOffscreenRasterEncodedMime(header) === expectedMime;
  } catch {
    return false;
  }
}

function isPlacement(value: unknown): value is StudioOffscreenRasterPlacement {
  if (!isRecord(value) || !hasExactKeys(value, PLACEMENT_KEYS)) return false;
  return isFinite2(value.dx)
    && isFinite2(value.dy)
    && isFinite2(value.dw) && value.dw > 0 && value.dw <= STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION
    && isFinite2(value.dh) && value.dh > 0 && value.dh <= STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION
    && isFinite2(value.opacity) && value.opacity >= 0 && value.opacity <= 1
    && isFinite2(value.rotation)
    && typeof value.flipX === "boolean"
    && typeof value.flipY === "boolean";
}

function isSource(value: unknown): value is StudioOffscreenRasterSource {
  if (!isRecord(value)) return false;
  if (value.kind === "pixels") {
    if (!hasExactKeys(value, PIXEL_SOURCE_KEYS)) return false;
    if (!isDimension(value.width) || !isDimension(value.height)) return false;
    const pixels = value.width * value.height;
    if (!Number.isSafeInteger(pixels) || pixels > STUDIO_OFFSCREEN_RASTER_MAX_PIXELS) return false;
    return isOwnedArrayBuffer(value.pixels, pixels * 4) && isPlacement(value.placement);
  }
  if (value.kind === "bitmap") {
    return hasExactKeys(value, BITMAP_SOURCE_KEYS)
      && isStudioOffscreenBitmapLike(value.bitmap)
      && isPlacement(value.placement);
  }
  return false;
}

function isTarget(value: unknown): value is StudioOffscreenRasterTarget {
  if (!isRecord(value) || !hasExactKeys(value, TARGET_KEYS)) return false;
  if (!isDimension(value.width) || !isDimension(value.height)) return false;
  const pixels = value.width * value.height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_OFFSCREEN_RASTER_MAX_PIXELS) return false;
  return value.background === null
    || (typeof value.background === "string" && value.background.length > 0 && value.background.length <= 64);
}

function isOutput(value: unknown): value is StudioOffscreenRasterOutput {
  if (!isRecord(value)) return false;
  if (value.kind === "pixels" || value.kind === "bitmap") return hasExactKeys(value, ["kind"]);
  if (value.kind !== "encoded") return false;
  if (!hasExactKeys(value, ["kind", "mime"], ["quality"])) return false;
  if (typeof value.mime !== "string" || !ENCODE_MIME_SET.has(value.mime)) return false;
  if (!hasOwn(value, "quality")) return true;
  // PNG 는 무손실이라 quality 인자가 의미 없다 — 조용히 무시되는 대신 계약에서 거부한다.
  return value.mime !== "image/png" && isFinite2(value.quality) && value.quality > 0 && value.quality <= 1;
}

function isJobKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_OFFSCREEN_RASTER_MAX_JOB_KEY_CHARS;
}

export function isStudioOffscreenRasterRunMessage(
  value: unknown,
): value is StudioOffscreenRasterRunMessage {
  try {
    if (!isRecord(value) || !hasExactKeys(value, RUN_KEYS)) return false;
    if (
      value.version !== STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION
      || value.kind !== "run"
      || !isRunId(value.runId)
      || !isJobKey(value.jobKey)
      || !isTarget(value.target)
      || !isOutput(value.output)
      || !Array.isArray(value.sources)
      || value.sources.length === 0
      || value.sources.length > STUDIO_OFFSCREEN_RASTER_MAX_SOURCES
    ) return false;
    return value.sources.every((source) => isSource(source));
  } catch {
    return false;
  }
}

export function isStudioOffscreenRasterCancelMessage(
  value: unknown,
): value is StudioOffscreenRasterCancelMessage {
  try {
    return isRecord(value)
      && hasExactKeys(value, CANCEL_KEYS)
      && value.version === STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION
      && value.kind === "cancel"
      && isRunId(value.runId);
  } catch {
    return false;
  }
}

export function isStudioOffscreenRasterRequestMessage(
  value: unknown,
): value is StudioOffscreenRasterRequestMessage {
  return isStudioOffscreenRasterRunMessage(value) || isStudioOffscreenRasterCancelMessage(value);
}

function isResultPayload(value: unknown): value is StudioOffscreenRasterResultPayload {
  if (!isRecord(value)) return false;
  if (value.kind === "pixels") {
    return hasExactKeys(value, ["kind", "pixels"]) && value.pixels instanceof ArrayBuffer;
  }
  if (value.kind === "bitmap") {
    return hasExactKeys(value, ["kind", "bitmap"]) && isStudioOffscreenBitmapLike(value.bitmap);
  }
  if (value.kind !== "encoded") return false;
  return hasExactKeys(value, ["kind", "mime", "blob"])
    && typeof value.mime === "string"
    && ENCODE_MIME_SET.has(value.mime)
    && isBlobLike(value.blob)
    && value.blob.size > 0
    && value.blob.type.trim().toLowerCase() === value.mime;
}

export function isStudioOffscreenRasterResponseMessage(
  value: unknown,
): value is StudioOffscreenRasterResponseMessage {
  try {
    if (!isRecord(value) || value.version !== STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION) return false;
    if (value.kind === "ready") return hasExactKeys(value, READY_KEYS);
    if (value.kind === "unavailable") {
      return hasExactKeys(value, UNAVAILABLE_KEYS) && value.code === "offscreen-canvas";
    }
    if (value.kind === "failure") {
      return hasExactKeys(value, FAILURE_KEYS)
        && isRunId(value.runId)
        && typeof value.code === "string"
        && FAILURE_CODE_SET.has(value.code)
        && typeof value.message === "string";
    }
    if (value.kind !== "result" || !hasExactKeys(value, RESULT_KEYS)) return false;
    if (!isRunId(value.runId) || !isDimension(value.width) || !isDimension(value.height)) return false;
    if (!isResultPayload(value.payload)) return false;
    // 픽셀 출력은 결과 치수와 정확히 맞아야 한다(잘린 버퍼가 커밋되는 것을 막는다).
    return value.payload.kind !== "pixels"
      || value.payload.pixels.byteLength === value.width * value.height * 4;
  } catch {
    return false;
  }
}

// ── transfer 목록 계산 ───────────────────────────────────────────────────────────

function uniqueTransfers(candidates: readonly unknown[]): Transferable[] {
  const seen = new Set<unknown>();
  const transfers: Transferable[] = [];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || seen.has(candidate)) continue;
    // SharedArrayBuffer·Blob 처럼 transferable 이 아닌 값은 목록에 올리면 postMessage 가 던진다.
    if (!(candidate instanceof ArrayBuffer) && !isStudioOffscreenBitmapLike(candidate)) continue;
    seen.add(candidate);
    transfers.push(candidate as Transferable);
  }
  return transfers;
}

/**
 * 요청이 실어 보내는 모든 픽셀 저장소(ArrayBuffer·ImageBitmap)를 정확히 한 번씩 담는다.
 * 이 목록에 오른 값은 post 직후 호출자 쪽에서 detach 되므로 다시 만지면 안 된다.
 */
export function studioOffscreenRasterRequestTransfers(
  message: StudioOffscreenRasterRequestMessage,
): Transferable[] {
  if (message.kind !== "run") return [];
  return uniqueTransfers(
    message.sources.map((source) => (source.kind === "pixels" ? source.pixels : source.bitmap)),
  );
}

/** 응답 쪽 대칭 규칙. 인코딩 결과 Blob 은 transferable 이 아니므로 목록에 넣지 않는다. */
export function studioOffscreenRasterResponseTransfers(
  message: StudioOffscreenRasterResponseMessage,
): Transferable[] {
  if (message.kind !== "result") return [];
  if (message.payload.kind === "pixels") return uniqueTransfers([message.payload.pixels]);
  if (message.payload.kind === "bitmap") return uniqueTransfers([message.payload.bitmap]);
  return [];
}

// ── 소유권 확정 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * 픽셀 view 를 "이 메시지 단독 소유" 버퍼로 승격한다.
 *
 * 부분 view(byteOffset ≠ 0 또는 형제 view 공존)나 SharedArrayBuffer 백킹이면 전용
 * ArrayBuffer 로 복제한다 — 그대로 transfer 하면 무관한 바이트까지 Worker 로 새고 형제 view 가
 * 같이 detach 되기 때문이다(studio-image-filter-worker-client 의 동일 가드와 같은 이유).
 * 반환값을 넘긴 뒤에는 호출자가 원본 view 를 더 이상 신뢰하면 안 된다.
 */
export function adoptStudioOffscreenPixelBuffer(view: ArrayBufferView): StudioOffscreenOwnedBuffer {
  const buffer = view.buffer;
  const exclusive = buffer instanceof ArrayBuffer
    && view.byteOffset === 0
    && view.byteLength === buffer.byteLength;
  if (exclusive) return buffer as StudioOffscreenOwnedBuffer;
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(buffer as ArrayBufferLike, view.byteOffset, view.byteLength));
  return copy.buffer as StudioOffscreenOwnedBuffer;
}

/**
 * ImageBitmap 을 소유권 브랜드로 승격한다. 복제 수단이 없으므로 검증만 하고 통과시킨다 —
 * 호출자는 이 비트맵을 넘긴 뒤 `close()` 하거나 다시 그리면 안 된다(전송이 곧 이관이다).
 */
export function adoptStudioOffscreenBitmap(bitmap: ImageBitmap): StudioOffscreenOwnedBitmap {
  if (!isStudioOffscreenBitmapLike(bitmap)) {
    throw new TypeError("OffscreenCanvas 래스터 소스로 쓸 수 없는 비트맵입니다.");
  }
  return bitmap as StudioOffscreenOwnedBitmap;
}

/** 실패 메시지를 한 곳에서 만든다 — 코드/문구가 양쪽에서 갈라지지 않게. */
export function studioOffscreenRasterFailure(
  runId: number,
  code: StudioOffscreenRasterFailureCode,
  message: string,
): StudioOffscreenRasterFailureMessage {
  return {
    version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
    kind: "failure",
    runId,
    code,
    message,
  };
}
