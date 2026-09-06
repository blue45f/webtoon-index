/**
 * Studio GIF Encoder — 프레임 애니메이션 내보내기를 위한 순수 TypeScript GIF89a 인코더.
 *
 * 외부 의존성과 비결정 요소(Math.random/Date.now) 없이 median-cut ≤256색 양자화, 선택적
 * ordered(4×4 Bayer)/Floyd–Steinberg 디더링, LZW 압축, NETSCAPE2.0 무한 루프, 1비트 투명을
 * 지원한다. 같은 입력이면 항상 같은 바이트를 만든다(결정적). 긴 인코딩이 UI를 얼리지 않도록
 * 프레임 사이와 픽셀 예산 단위로 협력적 양보(yieldToUi)를 하고, isCancelled 폴링으로 취소를
 * 지원한다 — 취소 시 GifEncodeCancelledError를 던지며 오케스트레이터
 * (studio-frame-anim-media-export)가 MotionExport 취소 규약으로 변환한다.
 */

export type GifDitherMode = "floyd-steinberg" | "none" | "ordered";

export const GIF_DITHER_PRESETS = [
  { id: "none", label: "디더링 없음 (또렷한 색 경계)" },
  { id: "ordered", label: "패턴 디더링 (규칙적인 질감)" },
  { id: "floyd-steinberg", label: "플로이드-스타인버그 (부드러운 그라데이션)" },
] as const satisfies readonly { id: GifDitherMode; label: string }[];

export class GifEncodeCancelledError extends Error {
  constructor() {
    super("GIF 내보내기를 취소했어요.");
    this.name = "GifEncodeCancelledError";
  }
}

export function isGifEncodeCancelled(err: unknown): boolean {
  return err instanceof GifEncodeCancelledError;
}

export interface GifEncodeProgress {
  phase: "encode" | "quantize";
  frameIndex: number;
  totalFrames: number;
  ratio: number; // 0..1 — 인코더 전체 기준
}

export interface GifEncoderFrame {
  rgba: Uint8Array | Uint8ClampedArray; // width*height*4
  delayCs: number; // 노출 시간(centiseconds) — gifDelayCentiseconds로 변환
}

export interface GifEncodeOptions {
  width: number;
  height: number;
  frames: readonly GifEncoderFrame[];
  /** true(기본)면 NETSCAPE2.0 확장으로 무한 반복을 기록한다. */
  loopForever?: boolean;
  dither?: GifDitherMode;
  /** true(기본)면 alpha<128 픽셀을 1비트 투명 인덱스로 기록한다. */
  transparency?: boolean;
  /** 팔레트 총 슬롯 상한(투명 슬롯 포함) — 2..256, 기본 256. */
  maxColors?: number;
  onProgress?: (progress: GifEncodeProgress) => void;
  isCancelled?: () => boolean;
  yieldToUi?: () => Promise<void>;
}

const ALPHA_OPAQUE_THRESHOLD = 128;
const GIF_MIN_DELAY_CS = 2; // 1cs 이하는 브라우저가 10cs로 강제 해석하는 관행이 있어 하한 2cs
const GIF_MAX_DELAY_CS = 65_535;
const MAX_GIF_DIMENSION = 65_535;
const YIELD_PIXEL_BUDGET = 65_536;
const LZW_MAX_CODE = 4096;
const ORDERED_DITHER_STRENGTH = 24;
const QUANTIZE_PROGRESS_SPAN = 0.25;

// 4×4 Bayer 행렬 — ordered 디더링의 결정적 임계값 패턴.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** 프레임 노출 시간(ms) → GIF 지연(centiseconds). 하한 2cs·상한 65535cs 클램프. 순수. */
export function gifDelayCentiseconds(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return GIF_MIN_DELAY_CS;
  return Math.min(GIF_MAX_DELAY_CS, Math.max(GIF_MIN_DELAY_CS, Math.round(delayMs / 10)));
}

function defaultYieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clampByte(n: number): number {
  if (n <= 0) return 0;
  if (n >= 255) return 255;
  return Math.round(n);
}

// 협력적 양보 게이트 — cost 누적이 예산을 넘으면 한 번 양보하고 취소를 폴링한다.
class CoopGate {
  private pending = 0;

  constructor(
    private readonly yieldToUi: () => Promise<void>,
    private readonly isCancelled: () => boolean,
    private readonly budget = YIELD_PIXEL_BUDGET
  ) {}

  throwIfCancelled(): void {
    if (this.isCancelled()) throw new GifEncodeCancelledError();
  }

  checkpoint(cost: number): Promise<void> | null {
    this.pending += cost;
    if (this.pending < this.budget) return null;
    this.pending = 0;
    return this.pause();
  }

  async pause(): Promise<void> {
    this.throwIfCancelled();
    await this.yieldToUi();
    this.throwIfCancelled();
  }
}

// 가변 길이 바이트 버퍼 — number[] push보다 메모리 예측이 쉽다.
class ByteWriter {
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

  uint16le(value: number): void {
    this.byte(value & 0xff);
    this.byte((value >>> 8) & 0xff);
  }

  ascii(text: string): void {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i += 1) {
      this.buffer[this.used] = text.charCodeAt(i) & 0xff;
      this.used += 1;
    }
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.used);
  }
}

// ── median-cut 팔레트(결정적) ────────────────────────────────────────

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

interface HistogramEntry extends PaletteColor {
  key: number;
  count: number;
}

type RgbChannel = "b" | "g" | "r";

function widestChannel(entries: readonly HistogramEntry[]): { channel: RgbChannel; range: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const entry of entries) {
    if (entry.r < minR) minR = entry.r;
    if (entry.r > maxR) maxR = entry.r;
    if (entry.g < minG) minG = entry.g;
    if (entry.g > maxG) maxG = entry.g;
    if (entry.b < minB) minB = entry.b;
    if (entry.b > maxB) maxB = entry.b;
  }
  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;
  // 채널 우선순위 r→g→b 고정 — 동률에서도 결정적.
  if (rangeR >= rangeG && rangeR >= rangeB) return { channel: "r", range: rangeR };
  if (rangeG >= rangeB) return { channel: "g", range: rangeG };
  return { channel: "b", range: rangeB };
}

function buildPalette(histogram: Map<number, number>, maxColors: number): PaletteColor[] {
  if (histogram.size === 0) return [{ r: 0, g: 0, b: 0 }];
  const entries: HistogramEntry[] = [...histogram.entries()]
    .map(([key, count]) => ({
      key,
      r: (key >>> 16) & 0xff,
      g: (key >>> 8) & 0xff,
      b: key & 0xff,
      count,
    }))
    .sort((a, b) => a.key - b.key);
  if (entries.length <= maxColors) {
    return entries.map(({ r, g, b }) => ({ r, g, b }));
  }

  const boxes: HistogramEntry[][] = [entries];
  while (boxes.length < maxColors) {
    let bestBox = -1;
    let bestRange = 0;
    let bestChannel: RgbChannel = "r";
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]!;
      if (box.length < 2) continue;
      const { channel, range } = widestChannel(box);
      if (range > bestRange) {
        bestRange = range;
        bestBox = index;
        bestChannel = channel;
      }
    }
    if (bestBox === -1 || bestRange === 0) break;
    const sorted = [...boxes[bestBox]!].sort(
      (a, b) => a[bestChannel] - b[bestChannel] || a.key - b.key
    );
    const total = sorted.reduce((sum, entry) => sum + entry.count, 0);
    let cut = sorted.length - 1;
    let accumulated = 0;
    for (let i = 0; i < sorted.length - 1; i += 1) {
      accumulated += sorted[i]!.count;
      if (accumulated * 2 >= total) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(bestBox, 1, sorted.slice(0, cut), sorted.slice(cut));
  }

  const palette = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (const entry of box) {
      r += entry.r * entry.count;
      g += entry.g * entry.count;
      b += entry.b * entry.count;
      weight += entry.count;
    }
    return {
      r: Math.round(r / weight),
      g: Math.round(g / weight),
      b: Math.round(b / weight),
    };
  });
  palette.sort(
    (a, b) => ((a.r << 16) | (a.g << 8) | a.b) - ((b.r << 16) | (b.g << 8) | b.b)
  );
  // 평균이 겹친 상자는 병합 — 인덱스 공간만 아끼고 결과 픽셀은 동일하다.
  const unique: PaletteColor[] = [];
  for (const color of palette) {
    const prev = unique[unique.length - 1];
    if (!prev || prev.r !== color.r || prev.g !== color.g || prev.b !== color.b) {
      unique.push(color);
    }
  }
  return unique;
}

function nearestPaletteIndex(
  palette: readonly PaletteColor[],
  r: number,
  g: number,
  b: number,
  cache: Map<number, number>
): number {
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index]!;
    const dr = color.r - r;
    const dg = color.g - g;
    const db = color.b - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  cache.set(key, best);
  return best;
}

// ── 프레임 → 팔레트 인덱스 매핑(디더링 포함) ─────────────────────────

async function mapFrameToIndices(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly PaletteColor[],
  transparentIndex: number | null,
  dither: GifDitherMode,
  cache: Map<number, number>,
  gate: CoopGate
): Promise<Uint8Array> {
  const indices = new Uint8Array(width * height);
  if (dither === "floyd-steinberg") {
    let errors = new Float64Array(width * 3);
    for (let y = 0; y < height; y += 1) {
      const nextErrors = new Float64Array(width * 3);
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const pixel = y * width + x;
        if (transparentIndex !== null && (rgba[offset + 3] ?? 0) < ALPHA_OPAQUE_THRESHOLD) {
          indices[pixel] = transparentIndex;
          continue; // 투명 픽셀은 오차를 전파하지 않는다 — 경계 얼룩 방지
        }
        const r = clampByte((rgba[offset] ?? 0) + (errors[x * 3] ?? 0));
        const g = clampByte((rgba[offset + 1] ?? 0) + (errors[x * 3 + 1] ?? 0));
        const b = clampByte((rgba[offset + 2] ?? 0) + (errors[x * 3 + 2] ?? 0));
        const index = nearestPaletteIndex(palette, r, g, b, cache);
        indices[pixel] = index;
        const color = palette[index]!;
        const errR = r - color.r;
        const errG = g - color.g;
        const errB = b - color.b;
        if (x + 1 < width) {
          errors[(x + 1) * 3] = (errors[(x + 1) * 3] ?? 0) + (errR * 7) / 16;
          errors[(x + 1) * 3 + 1] = (errors[(x + 1) * 3 + 1] ?? 0) + (errG * 7) / 16;
          errors[(x + 1) * 3 + 2] = (errors[(x + 1) * 3 + 2] ?? 0) + (errB * 7) / 16;
        }
        if (x > 0) {
          nextErrors[(x - 1) * 3] = (nextErrors[(x - 1) * 3] ?? 0) + (errR * 3) / 16;
          nextErrors[(x - 1) * 3 + 1] = (nextErrors[(x - 1) * 3 + 1] ?? 0) + (errG * 3) / 16;
          nextErrors[(x - 1) * 3 + 2] = (nextErrors[(x - 1) * 3 + 2] ?? 0) + (errB * 3) / 16;
        }
        nextErrors[x * 3] = (nextErrors[x * 3] ?? 0) + (errR * 5) / 16;
        nextErrors[x * 3 + 1] = (nextErrors[x * 3 + 1] ?? 0) + (errG * 5) / 16;
        nextErrors[x * 3 + 2] = (nextErrors[x * 3 + 2] ?? 0) + (errB * 5) / 16;
        if (x + 1 < width) {
          nextErrors[(x + 1) * 3] = (nextErrors[(x + 1) * 3] ?? 0) + errR / 16;
          nextErrors[(x + 1) * 3 + 1] = (nextErrors[(x + 1) * 3 + 1] ?? 0) + errG / 16;
          nextErrors[(x + 1) * 3 + 2] = (nextErrors[(x + 1) * 3 + 2] ?? 0) + errB / 16;
        }
      }
      errors = nextErrors;
      const paused = gate.checkpoint(width);
      if (paused) await paused;
    }
    return indices;
  }

  for (let y = 0; y < height; y += 1) {
    const bayerRow = BAYER_4X4[y & 3]!;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const pixel = y * width + x;
      if (transparentIndex !== null && (rgba[offset + 3] ?? 0) < ALPHA_OPAQUE_THRESHOLD) {
        indices[pixel] = transparentIndex;
        continue;
      }
      let r = rgba[offset] ?? 0;
      let g = rgba[offset + 1] ?? 0;
      let b = rgba[offset + 2] ?? 0;
      if (dither === "ordered") {
        const shift = ORDERED_DITHER_STRENGTH * (((bayerRow[x & 3]! + 0.5) / 16) - 0.5);
        r = clampByte(r + shift);
        g = clampByte(g + shift);
        b = clampByte(b + shift);
      }
      indices[pixel] = nearestPaletteIndex(palette, r, g, b, cache);
    }
    const paused = gate.checkpoint(width);
    if (paused) await paused;
  }
  return indices;
}

// ── LZW(GIF variant) ────────────────────────────────────────────────

async function lzwEncode(
  indices: Uint8Array,
  minCodeSize: number,
  out: ByteWriter,
  gate: CoopGate
): Promise<void> {
  out.byte(minCodeSize);

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dictionary = new Map<number, number>();
  let bitBuffer = 0;
  let bitCount = 0;
  const block = new Uint8Array(255);
  let blockLength = 0;

  const flushBlock = (): void => {
    if (blockLength === 0) return;
    out.byte(blockLength);
    for (let i = 0; i < blockLength; i += 1) out.byte(block[i]!);
    blockLength = 0;
  };
  const emitByte = (value: number): void => {
    block[blockLength] = value;
    blockLength += 1;
    if (blockLength === 255) flushBlock();
  };
  const emitCode = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      emitByte(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  emitCode(clearCode);
  if (indices.length === 0) {
    emitCode(eoiCode);
  } else {
    let prefix = indices[0]!;
    for (let i = 1; i < indices.length; i += 1) {
      const pixel = indices[i]!;
      const key = (prefix << 8) | pixel;
      const found = dictionary.get(key);
      if (found !== undefined) {
        prefix = found;
      } else {
        emitCode(prefix);
        // 규범적 GIF-LZW: 코드 크기 상승은 "방금 코드를 낸 뒤", 등록 전 nextCode 기준으로
        // 판정해야 디코더(코드를 읽으며 한 스텝 늦게 등록)와 비트 폭이 일치한다.
        if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize += 1;
        if (nextCode < LZW_MAX_CODE) {
          dictionary.set(key, nextCode);
          nextCode += 1;
        } else {
          // 테이블 포화 — clear로 리셋해 디코더와 동기화한다.
          emitCode(clearCode);
          dictionary = new Map<number, number>();
          codeSize = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }
        prefix = pixel;
      }
      if ((i & 0x0fff) === 0) {
        const paused = gate.checkpoint(0x1000);
        if (paused) await paused;
      }
    }
    emitCode(prefix);
    // 디코더는 마지막 데이터 코드에서도 사전 등록을 하므로 EOI 직전에 같은 판정을 미러링한다.
    if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize += 1;
    emitCode(eoiCode);
  }

  if (bitCount > 0) emitByte(bitBuffer & 0xff);
  flushBlock();
  out.byte(0); // block terminator
}

// ── GIF89a 인코딩 본체 ───────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export async function encodeGif(options: GifEncodeOptions): Promise<Uint8Array<ArrayBuffer>> {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_GIF_DIMENSION ||
    height > MAX_GIF_DIMENSION
  ) {
    throw new Error("GIF로 내보낼 수 있는 크기가 아니에요.");
  }
  const frames = options.frames;
  if (frames.length === 0) throw new Error("내보낼 프레임이 없어요.");
  const pixelBytes = width * height * 4;
  for (const frame of frames) {
    if (frame.rgba.length !== pixelBytes) {
      throw new Error("프레임 픽셀 데이터가 크기와 맞지 않아요. 다시 시도해주세요.");
    }
  }
  const maxColors = Math.min(256, Math.max(2, Math.round(options.maxColors ?? 256)));
  const transparencyWanted = options.transparency ?? true;
  const dither = options.dither ?? "none";
  const loopForever = options.loopForever ?? true;
  const isCancelled = options.isCancelled ?? (() => false);
  const yieldToUi = options.yieldToUi ?? defaultYieldToUi;
  const gate = new CoopGate(yieldToUi, isCancelled);
  const totalFrames = frames.length;
  const report = (phase: GifEncodeProgress["phase"], frameIndex: number, ratio: number): void => {
    options.onProgress?.({ phase, frameIndex, totalFrames, ratio: clamp01(ratio) });
  };

  // 1) 전 프레임 공통 히스토그램 → 전역 팔레트(median-cut).
  const histogram = new Map<number, number>();
  let hasTransparency = false;
  for (let f = 0; f < totalFrames; f += 1) {
    await gate.pause(); // 프레임 사이 항상 양보 + 취소 폴링
    const rgba = frames[f]!.rgba;
    for (let y = 0; y < height; y += 1) {
      let offset = y * width * 4;
      for (let x = 0; x < width; x += 1, offset += 4) {
        if (transparencyWanted && (rgba[offset + 3] ?? 0) < ALPHA_OPAQUE_THRESHOLD) {
          hasTransparency = true;
          continue;
        }
        const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
      }
      const paused = gate.checkpoint(width);
      if (paused) await paused;
    }
    report("quantize", f, QUANTIZE_PROGRESS_SPAN * ((f + 1) / totalFrames));
  }

  const usesTransparency = transparencyWanted && hasTransparency;
  const paletteTarget = usesTransparency ? Math.max(2, maxColors - 1) : maxColors;
  const palette = buildPalette(histogram, paletteTarget);
  const transparentIndex = usesTransparency ? palette.length : null;
  const tableLength = palette.length + (usesTransparency ? 1 : 0);
  const sizeBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, tableLength))));
  const tableSize = 1 << sizeBits;
  const minCodeSize = Math.max(2, sizeBits);

  // 2) 컨테이너 헤더.
  const out = new ByteWriter();
  out.ascii("GIF89a");
  out.uint16le(width);
  out.uint16le(height);
  out.byte(0xf0 | (sizeBits - 1)); // GCT 있음 · color resolution 7 · sort 0
  out.byte(0); // background color index
  out.byte(0); // pixel aspect ratio
  for (let i = 0; i < tableSize; i += 1) {
    const color = palette[i];
    out.byte(color?.r ?? 0);
    out.byte(color?.g ?? 0);
    out.byte(color?.b ?? 0);
  }
  if (loopForever) {
    out.byte(0x21);
    out.byte(0xff);
    out.byte(0x0b);
    out.ascii("NETSCAPE2.0");
    out.byte(0x03);
    out.byte(0x01);
    out.uint16le(0); // 0 = 무한 반복
    out.byte(0);
  }

  // 3) 프레임별 GCE + 이미지 + LZW.
  const cache = new Map<number, number>();
  for (let f = 0; f < totalFrames; f += 1) {
    await gate.pause();
    const frame = frames[f]!;
    const indices = await mapFrameToIndices(
      frame.rgba,
      width,
      height,
      palette,
      transparentIndex,
      dither,
      cache,
      gate
    );

    out.byte(0x21);
    out.byte(0xf9);
    out.byte(0x04);
    const disposal = usesTransparency ? 2 : 1; // 투명 프레임은 배경 복원으로 잔상 방지
    out.byte((disposal << 2) | (transparentIndex !== null ? 1 : 0));
    out.uint16le(Math.min(GIF_MAX_DELAY_CS, Math.max(0, Math.round(frame.delayCs))));
    out.byte(transparentIndex ?? 0);
    out.byte(0);

    out.byte(0x2c);
    out.uint16le(0);
    out.uint16le(0);
    out.uint16le(width);
    out.uint16le(height);
    out.byte(0); // 로컬 색상표 없음 · 비인터레이스

    await lzwEncode(indices, minCodeSize, out, gate);
    report("encode", f, QUANTIZE_PROGRESS_SPAN + (1 - QUANTIZE_PROGRESS_SPAN) * ((f + 1) / totalFrames));
  }

  out.byte(0x3b); // trailer
  gate.throwIfCancelled();
  return out.toUint8Array();
}
