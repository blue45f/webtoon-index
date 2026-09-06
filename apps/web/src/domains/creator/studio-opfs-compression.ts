/**
 * Studio OPFS Compression — Compression Streams(`CompressionStream`/`DecompressionStream`)로
 * 저장 payload를 압축·복원하는 얇은 헬퍼.
 *
 * 이 레포는 이미 프로젝트 아카이브(.toonproject.zip)에서 DEFLATE를 직접 다룬다
 * (studio-zip-reader.ts는 `DecompressionStream("deflate-raw")`를 기본 어댑터로 쓴다).
 * 이 모듈은 같은 브라우저 API를 아카이브가 아니라 *상시 저장*에 쓴다.
 *
 * ── 무엇을 압축하고 무엇을 압축하지 않는가(실측 근거) ──────────────────────
 * 측정: 이 레포의 실제 payload 형태를 재현해 node zlib(level 6)로 잰 값이다.
 *
 *   브러시 라이브러리 120종 JSON   112 KB → 19.7 KB   (17.5%)   ← 압축한다
 *   팔레트 40개(색 48개)            24 KB → 10.0 KB   (41.8%)   ← 압축한다
 *   클립 40개(벡터 12요소)         499 KB → 201 KB    (40.3%)   ← 압축한다
 *   오토세이브 8페이지             744 KB → 299 KB    (40.2%)   ← 압축한다
 *   WOFF2 글꼴(base64 아님)        3.0 MB → 3.0 MB    (100%)    ← 압축하지 않는다
 *   PNG/JPEG 원본 바이트                  → 변화 없음  (~100%)   ← 압축하지 않는다
 *   GLB 2 MB                       2.0 MB → 2.0 MB    (99.8%)   ← 압축하지 않는다
 *
 * 즉 이득은 전부 *구조화된 텍스트*에서 나오고, 이미 압축된 컨테이너(WOFF2·PNG·JPEG·WebP·
 * GLB·zip)에서는 0이다. 그래서 기본 정책은 "MIME으로 먼저 거르고, 그래도 실제로 줄지
 * 않으면 identity로 되돌린다"이다 — 압축 때문에 오히려 커지는 경우를 저장하지 않는다.
 *
 * 참고: 글꼴을 base64 data URL로 localStorage에 넣으면 1.333배로 부푸는데, 그 문자열을
 * gzip하면 3.01 MB로 돌아온다(원본 대비 1.004배). 즉 **압축은 base64 오버헤드를 되돌릴 뿐**
 * 이고, 진짜 이득은 애초에 base64를 쓰지 않는 것(OPFS에 바이트 그대로)이다.
 */

import { StudioOpfsError } from "./studio-opfs-filesystem";

export type StudioOpfsCodec = "identity" | "gzip" | "deflate-raw";

export const STUDIO_OPFS_CODECS: readonly StudioOpfsCodec[] = ["identity", "gzip", "deflate-raw"];

export function isStudioOpfsCodec(value: unknown): value is StudioOpfsCodec {
  return typeof value === "string" && (STUDIO_OPFS_CODECS as readonly string[]).includes(value);
}

// ── 능력 탐지 ────────────────────────────────────────────────────────────

interface CompressionStreamCtor {
  new (format: string): { readable: ReadableStream<Uint8Array>; writable: WritableStream<unknown> };
}

export interface StudioOpfsCompressionScope {
  CompressionStream?: unknown;
  DecompressionStream?: unknown;
}

export interface StudioOpfsCompressionSupport {
  /** 압축·복원이 모두 가능한 코덱(identity는 언제나 포함). */
  codecs: StudioOpfsCodec[];
  supported(codec: StudioOpfsCodec): boolean;
}

function ctorOf(scope: StudioOpfsCompressionScope, name: "CompressionStream" | "DecompressionStream"):
  CompressionStreamCtor | null {
  const value = scope[name];
  return typeof value === "function" ? (value as CompressionStreamCtor) : null;
}

function canConstruct(ctor: CompressionStreamCtor | null, format: string): boolean {
  if (!ctor) return false;
  try {
    // 지원하지 않는 format은 생성자 자체가 TypeError를 던진다(Safari의 deflate-raw 등).
    void new ctor(format);
    return true;
  } catch {
    return false;
  }
}

/**
 * 코덱별 지원 여부를 *실제 생성자 호출*로 확인한다. 존재 검사만으로는 format 단위 편차를
 * 잡지 못한다(구형 Safari는 CompressionStream이 있으면서 "deflate-raw"만 거부했다).
 */
export function studioOpfsCompressionSupport(
  scope: StudioOpfsCompressionScope = globalThis as StudioOpfsCompressionScope
): StudioOpfsCompressionSupport {
  const compress = ctorOf(scope, "CompressionStream");
  const decompress = ctorOf(scope, "DecompressionStream");
  const codecs: StudioOpfsCodec[] = ["identity"];
  for (const codec of ["gzip", "deflate-raw"] as const) {
    if (canConstruct(compress, codec) && canConstruct(decompress, codec)) codecs.push(codec);
  }
  return { codecs, supported: (codec) => codecs.includes(codec) };
}

// ── 스트림 구동 ──────────────────────────────────────────────────────────

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function runTransform(
  bytes: Uint8Array,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<unknown> }
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // 쓰기와 읽기를 동시에 돌린다. 큰 payload에서 내부 큐가 차면 write 프라미스가 늦게
  // 해결될 뿐이고, 아래 read 루프가 큐를 비워 준다(먼저 await 하면 교착이다).
  const pump = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    // pump가 거부되면 read 루프도 거부되므로, 미처리 거부를 남기지 않도록 반드시 회수한다.
    await pump.catch(() => undefined);
  }
  await pump;
  return concat(chunks, total);
}

export async function compressStudioOpfsBytes(
  bytes: Uint8Array,
  codec: StudioOpfsCodec,
  scope: StudioOpfsCompressionScope = globalThis as StudioOpfsCompressionScope
): Promise<Uint8Array> {
  if (codec === "identity") return Uint8Array.from(bytes);
  const ctor = ctorOf(scope, "CompressionStream");
  if (!ctor) {
    throw new StudioOpfsError("NOT_SUPPORTED", "이 브라우저는 저장 압축을 지원하지 않아요.");
  }
  try {
    return await runTransform(bytes, new ctor(codec));
  } catch (error) {
    throw new StudioOpfsError("WRITE_FAILED", "자산을 압축하지 못했어요.", error);
  }
}

export async function decompressStudioOpfsBytes(
  bytes: Uint8Array,
  codec: StudioOpfsCodec,
  scope: StudioOpfsCompressionScope = globalThis as StudioOpfsCompressionScope
): Promise<Uint8Array> {
  if (codec === "identity") return Uint8Array.from(bytes);
  const ctor = ctorOf(scope, "DecompressionStream");
  if (!ctor) {
    throw new StudioOpfsError(
      "NOT_SUPPORTED",
      "이 브라우저는 압축 해제를 지원하지 않아 저장된 자산을 열 수 없어요."
    );
  }
  try {
    return await runTransform(bytes, new ctor(codec));
  } catch (error) {
    throw new StudioOpfsError("CORRUPT_ENTRY", "저장된 자산의 압축을 풀지 못했어요.", error);
  }
}

// ── 코덱 선택 정책 ───────────────────────────────────────────────────────

/** 이미 압축된 컨테이너. 여기에 gzip을 한 겹 더 씌우면 CPU만 쓰고 크기는 그대로다. */
const PRECOMPRESSED_MIME = [
  "font/woff",
  "font/woff2",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "video/",
  "audio/",
  "application/zip",
  "application/gzip",
  "application/x-7z-compressed",
  "model/gltf-binary",
] as const;

export function isStudioOpfsPrecompressedMime(mime: string): boolean {
  const normalized = String(mime ?? "").toLowerCase().trim();
  return PRECOMPRESSED_MIME.some((prefix) => normalized.startsWith(prefix));
}

/** 이보다 작은 payload는 gzip 헤더·트레일러(18 B)와 CPU가 이득보다 크다. */
export const STUDIO_OPFS_MIN_COMPRESS_BYTES = 1_024;

/** 압축 결과가 원본의 이 비율보다 크면 identity로 되돌린다(= 최소 10% 이득 요구). */
export const STUDIO_OPFS_MIN_COMPRESSION_GAIN = 0.9;

export function chooseStudioOpfsCodec(
  mime: string,
  byteLength: number,
  support: StudioOpfsCompressionSupport
): StudioOpfsCodec {
  if (byteLength < STUDIO_OPFS_MIN_COMPRESS_BYTES) return "identity";
  if (isStudioOpfsPrecompressedMime(mime)) return "identity";
  // gzip을 우선한다: deflate-raw보다 18 B 크지만, 파일이 그 자체로 식별 가능해
  // 진단·수동 복구(터미널 gunzip)가 가능하다. 저장 규모에서 18 B는 무의미하다.
  if (support.supported("gzip")) return "gzip";
  if (support.supported("deflate-raw")) return "deflate-raw";
  return "identity";
}

export interface StudioOpfsEncodedPayload {
  codec: StudioOpfsCodec;
  bytes: Uint8Array;
  /** storedBytes / originalBytes. 1보다 작을수록 이득. */
  ratio: number;
}

/**
 * 정책대로 압축하되, 실제로 줄지 않으면 identity로 되돌린다.
 * "압축했더니 더 커졌다"를 저장하지 않는 유일한 방어선이다(고엔트로피 입력의 gzip은
 * 원본보다 커질 수 있다).
 */
export async function encodeStudioOpfsPayload(
  bytes: Uint8Array,
  mime: string,
  support: StudioOpfsCompressionSupport,
  scope: StudioOpfsCompressionScope = globalThis as StudioOpfsCompressionScope
): Promise<StudioOpfsEncodedPayload> {
  const codec = chooseStudioOpfsCodec(mime, bytes.byteLength, support);
  if (codec === "identity") return { codec: "identity", bytes: Uint8Array.from(bytes), ratio: 1 };
  let compressed: Uint8Array;
  try {
    compressed = await compressStudioOpfsBytes(bytes, codec, scope);
  } catch {
    // 압축 실패는 저장 실패가 아니다 — 원본을 그대로 담는다.
    return { codec: "identity", bytes: Uint8Array.from(bytes), ratio: 1 };
  }
  if (compressed.byteLength > bytes.byteLength * STUDIO_OPFS_MIN_COMPRESSION_GAIN) {
    return { codec: "identity", bytes: Uint8Array.from(bytes), ratio: 1 };
  }
  return { codec, bytes: compressed, ratio: compressed.byteLength / bytes.byteLength };
}

/** 절약한 바이트 비율(0~1). 표시용. */
export function studioOpfsCompressionSaving(originalBytes: number, storedBytes: number): number {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
  return Math.max(0, 1 - storedBytes / originalBytes);
}

/** "112 KB → 19.7 KB (82% 절약)" 같은 한국어 요약. */
export function describeStudioOpfsCompression(originalBytes: number, storedBytes: number): string {
  const saved = Math.round(studioOpfsCompressionSaving(originalBytes, storedBytes) * 100);
  return saved > 0 ? `${saved}% 절약` : "압축 이득 없음";
}
