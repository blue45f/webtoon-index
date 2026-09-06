/**
 * Studio APNG Encoder — 브라우저가 인코딩한 정적 PNG 프레임들을 chunk 수준에서 APNG로 조립한다.
 *
 * 픽셀 재인코딩 없이 canvas.toBlob('image/png') 산출물을 그대로 쓴다: 각 프레임 PNG의 chunk를
 * 엄격 파싱(CRC 검증·fail-closed, studio-cbz-interchange의 acTL 검사 계약과 같은 결)한 뒤
 * acTL/fcTL/fdAT를 올바른 sequence 번호와 CRC32로 새로 조립한다. 같은 입력이면 항상 같은
 * 바이트를 만든다(결정적). 프레임 사이 협력적 양보(yieldToUi)와 isCancelled 폴링 취소를
 * 지원한다 — 취소 시 ApngEncodeCancelledError를 던지며 오케스트레이터
 * (studio-frame-anim-media-export)가 MotionExport 취소 규약으로 변환한다.
 */

export class ApngEncodeCancelledError extends Error {
  constructor() {
    super("APNG 내보내기를 취소했어요.");
    this.name = "ApngEncodeCancelledError";
  }
}

export function isApngEncodeCancelled(err: unknown): boolean {
  return err instanceof ApngEncodeCancelledError;
}

export interface ApngEncodeProgress {
  phase: "assemble";
  frameIndex: number;
  totalFrames: number;
  ratio: number; // 0..1 — 인코더 전체 기준
}

export interface ApngEncoderFrame {
  png: Uint8Array; // 브라우저 인코딩 정적 PNG(전체 파일 바이트)
  delayMs: number; // 노출 시간(ms) — fcTL delay_num/1000 으로 기록
}

export interface ApngEncodeOptions {
  frames: readonly ApngEncoderFrame[];
  /** true(기본)면 acTL num_plays=0(무한 반복)으로 기록한다. */
  loopForever?: boolean;
  onProgress?: (progress: ApngEncodeProgress) => void;
  isCancelled?: () => boolean;
  yieldToUi?: () => Promise<void>;
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_CHUNKS = 4096;
const APNG_DELAY_DENOMINATOR = 1000;
const APNG_MAX_DELAY_NUMERATOR = 65_535;
const PARSE_PROGRESS_SPAN = 0.4;

// ── CRC32(PNG 표준 다항식 0xEDB88320) ────────────────────────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ bytes[i]!) & 0xff]!;
  }
  return value;
}

/** PNG chunk CRC32 — type ASCII 4바이트 + data에 대한 표준 CRC32. 순수. */
export function pngChunkCrc32(type: string, data: Uint8Array): number {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) typeBytes[i] = type.charCodeAt(i) & 0xff;
  return (crc32Update(crc32Update(0xffffffff, typeBytes), data) ^ 0xffffffff) >>> 0;
}

// ── PNG chunk 파서(fail-closed) ─────────────────────────────────────

export interface PngChunkView {
  readonly type: string;
  readonly data: Uint8Array;
}

function ascii4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

const MALFORMED_PNG_MESSAGE = "PNG 프레임 데이터가 손상됐어요. 다시 시도해주세요.";

/**
 * 정적 PNG 파일을 chunk 목록으로 엄격 파싱한다 — 서명·IHDR 선두·IEND 종단·CRC 전수 검증,
 * 이미 애니메이션 chunk(acTL/fcTL/fdAT)를 가진 입력은 거부(fail-closed). 순수.
 */
export function parsePngChunks(bytes: Uint8Array): PngChunkView[] {
  if (bytes.byteLength < PNG_SIGNATURE.length + 12) throw new Error(MALFORMED_PNG_MESSAGE);
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error(MALFORMED_PNG_MESSAGE);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunkView[] = [];
  let offset = PNG_SIGNATURE.length;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < bytes.byteLength) {
    if (chunks.length >= MAX_PNG_CHUNKS) throw new Error(MALFORMED_PNG_MESSAGE);
    if (offset + 12 > bytes.byteLength) throw new Error(MALFORMED_PNG_MESSAGE);
    const length = view.getUint32(offset, false);
    const type = ascii4(bytes, offset + 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error(MALFORMED_PNG_MESSAGE);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (!Number.isSafeInteger(dataEnd) || dataEnd + 4 > bytes.byteLength) {
      throw new Error(MALFORMED_PNG_MESSAGE);
    }
    const data = bytes.slice(dataStart, dataEnd);
    if (view.getUint32(dataEnd, false) !== pngChunkCrc32(type, data)) {
      throw new Error("PNG 프레임 CRC 검증에 실패했어요. 다시 시도해주세요.");
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      throw new Error("이미 애니메이션 정보를 가진 PNG는 프레임으로 쓸 수 없어요.");
    }
    if (chunks.length === 0 && (type !== "IHDR" || length !== 13)) {
      throw new Error(MALFORMED_PNG_MESSAGE);
    }
    chunks.push({ type, data });
    if (type === "IDAT") sawImageData ||= length > 0;
    offset = dataEnd + 4;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.byteLength) throw new Error(MALFORMED_PNG_MESSAGE);
      sawEnd = true;
      break;
    }
  }
  if (chunks.length === 0 || !sawImageData || !sawEnd) throw new Error(MALFORMED_PNG_MESSAGE);
  return chunks;
}

// ── APNG 조립 ───────────────────────────────────────────────────────

class PngByteWriter {
  private buffer = new Uint8Array(4096);
  private used = 0;

  private ensure(extra: number): void {
    if (this.used + extra <= this.buffer.length) return;
    let next = this.buffer.length * 2;
    while (next < this.used + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buffer.subarray(0, this.used));
    this.buffer = grown;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buffer[this.used] = value & 0xff;
    this.used += 1;
  }

  bytes(values: Uint8Array | readonly number[]): void {
    this.ensure(values.length);
    for (let i = 0; i < values.length; i += 1) {
      this.buffer[this.used + i] = (values[i] ?? 0) & 0xff;
    }
    this.used += values.length;
  }

  uint32be(value: number): void {
    this.byte((value >>> 24) & 0xff);
    this.byte((value >>> 16) & 0xff);
    this.byte((value >>> 8) & 0xff);
    this.byte(value & 0xff);
  }

  chunk(type: string, data: Uint8Array): void {
    this.uint32be(data.byteLength);
    for (let i = 0; i < 4; i += 1) this.byte(type.charCodeAt(i));
    this.bytes(data);
    this.uint32be(pngChunkCrc32(type, data));
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.used);
  }
}

function defaultYieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function apngDelayNumerator(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return 1;
  return Math.min(APNG_MAX_DELAY_NUMERATOR, Math.max(1, Math.round(delayMs)));
}

function buildFrameControl(
  sequence: number,
  width: number,
  height: number,
  delayMs: number
): Uint8Array {
  const data = new Uint8Array(26);
  const view = new DataView(data.buffer);
  view.setUint32(0, sequence, false);
  view.setUint32(4, width, false);
  view.setUint32(8, height, false);
  view.setUint32(12, 0, false); // x_offset
  view.setUint32(16, 0, false); // y_offset
  view.setUint16(20, apngDelayNumerator(delayMs), false);
  view.setUint16(22, APNG_DELAY_DENOMINATOR, false);
  data[24] = 0; // dispose_op: NONE — 다음 프레임이 전체를 SOURCE로 덮는다
  data[25] = 0; // blend_op: SOURCE
  return data;
}

/**
 * 정적 PNG 프레임들을 하나의 APNG로 조립한다. 첫 프레임의 chunk 순서를 보존하되 IHDR 직후에
 * acTL을, 첫 IDAT 직전에 fcTL(seq 0)을 끼워 넣고, 이후 프레임은 fcTL + (IDAT→fdAT 변환)로
 * 이어 붙인다. sequence 번호는 fcTL/fdAT가 하나의 이름공간을 0부터 공유한다(APNG 규격).
 */
export async function assembleApng(options: ApngEncodeOptions): Promise<Uint8Array<ArrayBuffer>> {
  const frames = options.frames;
  if (frames.length === 0) throw new Error("내보낼 프레임이 없어요.");
  const loopForever = options.loopForever ?? true;
  const isCancelled = options.isCancelled ?? (() => false);
  const yieldToUi = options.yieldToUi ?? defaultYieldToUi;
  const totalFrames = frames.length;
  const throwIfCancelled = (): void => {
    if (isCancelled()) throw new ApngEncodeCancelledError();
  };
  const report = (frameIndex: number, ratio: number): void => {
    options.onProgress?.({ phase: "assemble", frameIndex, totalFrames, ratio: clamp01(ratio) });
  };

  // 1) 프레임별 chunk 파싱(협력적 양보 + 취소 폴링).
  const parsed: PngChunkView[][] = [];
  for (let f = 0; f < totalFrames; f += 1) {
    throwIfCancelled();
    parsed.push(parsePngChunks(frames[f]!.png));
    report(f, PARSE_PROGRESS_SPAN * ((f + 1) / totalFrames));
    await yieldToUi();
    throwIfCancelled();
  }

  // 2) 모든 프레임의 IHDR가 동일해야 chunk 수준 병합이 안전하다(같은 캔버스 → 항상 동일).
  const firstHeader = parsed[0]![0]!;
  for (let f = 1; f < totalFrames; f += 1) {
    const header = parsed[f]![0]!;
    if (
      header.data.length !== firstHeader.data.length ||
      header.data.some((byte, index) => byte !== firstHeader.data[index])
    ) {
      throw new Error("프레임 PNG 형식이 서로 달라 APNG로 합칠 수 없어요. 다시 시도해주세요.");
    }
  }
  const headerView = new DataView(
    firstHeader.data.buffer,
    firstHeader.data.byteOffset,
    firstHeader.data.byteLength
  );
  const width = headerView.getUint32(0, false);
  const height = headerView.getUint32(4, false);

  // 3) 조립.
  const out = new PngByteWriter();
  out.bytes(PNG_SIGNATURE);
  out.chunk("IHDR", firstHeader.data);

  const animationControl = new Uint8Array(8);
  const animationView = new DataView(animationControl.buffer);
  animationView.setUint32(0, totalFrames, false);
  animationView.setUint32(4, loopForever ? 0 : 1, false);
  out.chunk("acTL", animationControl);

  let sequence = 0;
  let wroteFirstFrameControl = false;
  for (const chunk of parsed[0]!.slice(1)) {
    if (chunk.type === "IEND") continue;
    if (chunk.type === "IDAT" && !wroteFirstFrameControl) {
      out.chunk("fcTL", buildFrameControl(sequence, width, height, frames[0]!.delayMs));
      sequence += 1;
      wroteFirstFrameControl = true;
    }
    out.chunk(chunk.type, chunk.data);
  }
  report(0, PARSE_PROGRESS_SPAN + (1 - PARSE_PROGRESS_SPAN) / totalFrames);

  for (let f = 1; f < totalFrames; f += 1) {
    throwIfCancelled();
    out.chunk("fcTL", buildFrameControl(sequence, width, height, frames[f]!.delayMs));
    sequence += 1;
    for (const chunk of parsed[f]!) {
      if (chunk.type !== "IDAT") continue; // 이후 프레임에서는 픽셀 데이터만 취한다
      const frameData = new Uint8Array(4 + chunk.data.byteLength);
      new DataView(frameData.buffer).setUint32(0, sequence, false);
      frameData.set(chunk.data, 4);
      out.chunk("fdAT", frameData);
      sequence += 1;
    }
    report(f, PARSE_PROGRESS_SPAN + (1 - PARSE_PROGRESS_SPAN) * ((f + 1) / totalFrames));
    await yieldToUi();
    throwIfCancelled();
  }

  out.chunk("IEND", new Uint8Array(0));
  return out.toUint8Array();
}
