/**
 * Studio High-Bit — 정밀도 보존 누적 버퍼(accumulation surface).
 *
 * ── 문제 ────────────────────────────────────────────────────────────────
 * 스튜디오의 모든 픽셀 경로(브러시 dab, Konva 필터 체인, 레이어 병합 베이크, GPU 리드백)는
 * 매 연산마다 `Uint8ClampedArray` 로 되돌아온다. 8비트 왕복은 연산당 ±0.5 코드의 양자화
 * 오차를 남기고, **낮은 flow/불투명도에서는 오차가 증분보다 커져 값이 아예 멈춘다**
 * (예: 알파 0.002 로 흰 배경을 250회 어둡게 → 참값 94, 8비트 경로는 250에서 정지).
 *
 * ── 이 모듈의 계약 ──────────────────────────────────────────────────────
 *   1. 표면은 **선형광(linear light) · 프리멀티플라이드 알파**로만 저장한다.
 *      감마 부호화된 값에 알파를 곱하거나 행렬을 곱하는 것은 정의상 틀렸다.
 *   2. 8비트 변환은 **경계에서 딱 한 번**(입력 디코드 / 출력 인코드)만 일어난다.
 *   3. 저장 포맷은 float32 또는 uint16 고정소수점. 아래 근거 참조.
 *
 * ── 저장 포맷 선택 근거 (4000×6000 웹툰 원고 1장 = 24,000,000 px) ──────────
 *   RGBA8   :  96 MB — 현행. 정밀도 없음(누적 드리프트/스톨 발생).
 *   RGBA16  : 192 MB — 채택 기본값. 선형 고정소수점 1/65535.
 *   RGBA32F : 384 MB — 타일 스크래치 전용.
 *
 *   uint16 **선형** 저장은 8비트 코드 하나를 최소 ~19.9 조각으로 쪼갠다(가장 촘촘한 구간은
 *   sRGB EOTF 의 선형 구간, 코드당 Δlinear = (1/255)/12.92 = 3.035e-4, uint16 스텝 =
 *   1.526e-5). 즉 어디서든 8비트 대비 최소 19배 정밀하다. 포토샵의 15+1비트(감마 공간,
 *   코드당 128 조각)보다는 성기지만, 웹툰 원고 1장을 브라우저 탭에 올려야 한다는 제약에서
 *   384MB(float32) 는 실용적이지 않다 — 히스토리 스냅샷·레이어 다중 보유를 감안하면 더욱.
 *
 *   따라서 정책은 **역할별 분리**다:
 *     - 페이지/레이어 규모 표면 → uint16 (192 MB, 정밀도 ≥19×)
 *     - 타일 규모 스크래치(브러시 누적이 실제로 일어나는 곳) → float32
 *       (256×256 타일 = 1 MB. 드리프트가 가장 심한 곳에만 최고 정밀도를 준다.)
 *
 * 순수·결정적. DOM 의존 없음.
 */

import {
  clipStudioHighBitToGamut,
  convertStudioHighBitLinearGamut,
  type StudioHighBitGamut,
  type StudioHighBitGamutClipMode,
} from "./studio-highbit-colorspace";
import {
  clampStudioHighBitUnit,
  studioHighBitByteToLinear,
  studioHighBitLinearToSrgb,
} from "./studio-highbit-transfer";

export type StudioHighBitStorage = "float32" | "uint16";
export type StudioHighBitAlphaMode = "premultiplied" | "straight";
export type StudioHighBitSurfaceRole = "page" | "layer" | "tile" | "dab-scratch";

export const STUDIO_HIGHBIT_UINT16_MAX = 65535;
export const STUDIO_HIGHBIT_CHANNELS = 4;

/** 타일 규모의 기준 변(px). 브러시 누적 스크래치는 이 크기를 넘지 않는다고 본다. */
export const STUDIO_HIGHBIT_TILE_EDGE = 256;

export interface StudioHighBitSurface {
  readonly width: number;
  readonly height: number;
  readonly storage: StudioHighBitStorage;
  /** 저장된 값이 속한 **선형광** 개멋. */
  readonly gamut: StudioHighBitGamut;
  readonly alpha: StudioHighBitAlphaMode;
  readonly data: Float32Array | Uint16Array;
}

export interface StudioHighBitSurfaceOptions {
  readonly width: number;
  readonly height: number;
  readonly storage?: StudioHighBitStorage;
  readonly gamut?: StudioHighBitGamut;
  readonly alpha?: StudioHighBitAlphaMode;
}

function assertSurfaceShape(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new Error("고비트 표면: 폭/높이는 1 이상의 정수여야 합니다.");
  }
}

export function createStudioHighBitSurface(
  options: StudioHighBitSurfaceOptions
): StudioHighBitSurface {
  const { width, height } = options;
  assertSurfaceShape(width, height);
  const storage = options.storage ?? "uint16";
  const length = width * height * STUDIO_HIGHBIT_CHANNELS;
  return {
    width,
    height,
    storage,
    gamut: options.gamut ?? "srgb",
    alpha: options.alpha ?? "premultiplied",
    data: storage === "float32" ? new Float32Array(length) : new Uint16Array(length),
  };
}

export function studioHighBitBytesPerPixel(storage: StudioHighBitStorage): number {
  return storage === "float32" ? 16 : 8;
}

export function estimateStudioHighBitSurfaceBytes(input: {
  readonly width: number;
  readonly height: number;
  readonly storage: StudioHighBitStorage;
}): number {
  return input.width * input.height * studioHighBitBytesPerPixel(input.storage);
}

/** 웹툰 원고 1장 기준 예산표 — 저장 포맷 결정 근거를 코드로 고정한다. */
export const STUDIO_HIGHBIT_PAGE_BUDGET = Object.freeze({
  width: 4000,
  height: 6000,
  legacyRgba8Bytes: 4000 * 6000 * 4,
  uint16Bytes: 4000 * 6000 * 8,
  float32Bytes: 4000 * 6000 * 16,
});

export interface StudioHighBitStorageRecommendation {
  readonly storage: StudioHighBitStorage;
  readonly estimatedBytes: number;
  readonly reason: string;
}

/**
 * 역할과 크기로 저장 포맷을 고른다.
 * 타일/dab 스크래치는 항상 float32(누적 드리프트가 실제로 발생하는 지점),
 * 그 외에는 uint16. 단 타일보다 작은 표면은 메모리가 무의미하므로 float32 로 올린다.
 */
export function recommendStudioHighBitStorage(input: {
  readonly width: number;
  readonly height: number;
  readonly role: StudioHighBitSurfaceRole;
}): StudioHighBitStorageRecommendation {
  const tilePixels = STUDIO_HIGHBIT_TILE_EDGE * STUDIO_HIGHBIT_TILE_EDGE;
  const pixels = input.width * input.height;
  const scratch = input.role === "tile" || input.role === "dab-scratch";
  const storage: StudioHighBitStorage = scratch || pixels <= tilePixels ? "float32" : "uint16";
  return {
    storage,
    estimatedBytes: estimateStudioHighBitSurfaceBytes({ ...input, storage }),
    reason: storage === "float32"
      ? "타일 규모 누적 스크래치 — 드리프트가 가장 큰 지점이라 부동소수 정밀도를 준다."
      : "페이지/레이어 규모 — uint16 선형 고정소수점으로 8비트 대비 ≥19× 정밀도를 유지하며 메모리를 절반으로 줄인다.",
  };
}

// ---------------------------------------------------------------------------
// 저장 인코딩
// ---------------------------------------------------------------------------

export function encodeStudioHighBitStorageValue(
  value: number,
  storage: StudioHighBitStorage
): number {
  const unit = clampStudioHighBitUnit(value);
  return storage === "float32" ? unit : Math.round(unit * STUDIO_HIGHBIT_UINT16_MAX);
}

export function decodeStudioHighBitStorageValue(
  raw: number,
  storage: StudioHighBitStorage
): number {
  return storage === "float32" ? raw : raw / STUDIO_HIGHBIT_UINT16_MAX;
}

// ---------------------------------------------------------------------------
// 프리멀티플라이 — 반드시 선형광에서만
// ---------------------------------------------------------------------------

/**
 * 스트레이트 → 프리멀티플라이드. 알파 0 은 색을 0 으로 만든다(NaN/유령색 금지).
 *
 * 회귀 방지 메모: 이 저장소는 과거 Three 캡처에서 **sRGB 인코딩·톤매핑 뒤에** 언프리멀티플라이를
 * 하다가 반투명 경계 색이 틀어진 적이 있다(`studio-bg3d-straight-alpha-output-pass.ts` 가
 * 언프리멀티플라이를 톤매핑·색공간 변환 **앞**으로 강제 주입하는 이유). 여기서도 같은 계약:
 * 프리멀티플라이/언프리멀티플라이는 선형광 도메인에서만 수행한다.
 */
export function premultiplyStudioHighBitRgb(
  rgb: readonly [number, number, number],
  alpha: number
): readonly [number, number, number] {
  if (!(alpha > 0)) return [0, 0, 0];
  return [rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha];
}

/** 프리멀티플라이드 → 스트레이트. 알파 0 은 검정(정의상 색 정보 없음). */
export function unpremultiplyStudioHighBitRgb(
  premultiplied: readonly [number, number, number],
  alpha: number
): readonly [number, number, number] {
  if (!(alpha > 0)) return [0, 0, 0];
  const inverse = 1 / alpha;
  return [premultiplied[0] * inverse, premultiplied[1] * inverse, premultiplied[2] * inverse];
}

// ---------------------------------------------------------------------------
// 픽셀 접근 (항상 스트레이트 선형광 float 로 주고받는다)
// ---------------------------------------------------------------------------

export type StudioHighBitRgba = readonly [number, number, number, number];

function pixelOffset(surface: StudioHighBitSurface, x: number, y: number): number {
  return (y * surface.width + x) * STUDIO_HIGHBIT_CHANNELS;
}

function inBounds(surface: StudioHighBitSurface, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x < surface.width && y < surface.height;
}

/** 스트레이트 선형광 RGBA 로 읽는다(표면이 프리멀티면 나눗셈까지 수행). */
export function readStudioHighBitPixel(
  surface: StudioHighBitSurface,
  x: number,
  y: number
): StudioHighBitRgba {
  if (!inBounds(surface, x, y)) return [0, 0, 0, 0];
  const offset = pixelOffset(surface, x, y);
  const storage = surface.storage;
  const red = decodeStudioHighBitStorageValue(surface.data[offset]!, storage);
  const green = decodeStudioHighBitStorageValue(surface.data[offset + 1]!, storage);
  const blue = decodeStudioHighBitStorageValue(surface.data[offset + 2]!, storage);
  const alpha = decodeStudioHighBitStorageValue(surface.data[offset + 3]!, storage);
  if (surface.alpha === "straight") return [red, green, blue, alpha];
  const straight = unpremultiplyStudioHighBitRgb([red, green, blue], alpha);
  return [straight[0], straight[1], straight[2], alpha];
}

/** 프리멀티플라이드 선형광 RGBA 를 그대로 읽는다(합성 내부 루프용). */
export function readStudioHighBitPremultiplied(
  surface: StudioHighBitSurface,
  x: number,
  y: number
): StudioHighBitRgba {
  if (!inBounds(surface, x, y)) return [0, 0, 0, 0];
  const offset = pixelOffset(surface, x, y);
  const storage = surface.storage;
  const red = decodeStudioHighBitStorageValue(surface.data[offset]!, storage);
  const green = decodeStudioHighBitStorageValue(surface.data[offset + 1]!, storage);
  const blue = decodeStudioHighBitStorageValue(surface.data[offset + 2]!, storage);
  const alpha = decodeStudioHighBitStorageValue(surface.data[offset + 3]!, storage);
  if (surface.alpha === "premultiplied") return [red, green, blue, alpha];
  const premultiplied = premultiplyStudioHighBitRgb([red, green, blue], alpha);
  return [premultiplied[0], premultiplied[1], premultiplied[2], alpha];
}

/** 스트레이트 선형광 RGBA 를 쓴다(표면이 프리멀티면 곱셈까지 수행). */
export function writeStudioHighBitPixel(
  surface: StudioHighBitSurface,
  x: number,
  y: number,
  rgba: StudioHighBitRgba
): void {
  if (!inBounds(surface, x, y)) return;
  const alpha = clampStudioHighBitUnit(rgba[3]);
  const color: readonly [number, number, number] = surface.alpha === "premultiplied"
    ? premultiplyStudioHighBitRgb([rgba[0], rgba[1], rgba[2]], alpha)
    : [rgba[0], rgba[1], rgba[2]];
  writeStudioHighBitPremultiplied(surface, x, y, [color[0], color[1], color[2], alpha]);
}

/** 이미 프리멀티플라이드인 선형광 RGBA 를 그대로 쓴다. */
export function writeStudioHighBitPremultiplied(
  surface: StudioHighBitSurface,
  x: number,
  y: number,
  rgba: StudioHighBitRgba
): void {
  if (!inBounds(surface, x, y)) return;
  const offset = pixelOffset(surface, x, y);
  const storage = surface.storage;
  surface.data[offset] = encodeStudioHighBitStorageValue(rgba[0], storage);
  surface.data[offset + 1] = encodeStudioHighBitStorageValue(rgba[1], storage);
  surface.data[offset + 2] = encodeStudioHighBitStorageValue(rgba[2], storage);
  surface.data[offset + 3] = encodeStudioHighBitStorageValue(rgba[3], storage);
}

// ---------------------------------------------------------------------------
// 8비트 경계 변환
// ---------------------------------------------------------------------------

export interface StudioHighBitDecodeOptions {
  readonly width: number;
  readonly height: number;
  /** 바이트가 부호화된 개멋(기본 sRGB). Display P3 캔버스에서 읽었다면 "display-p3". */
  readonly sourceGamut?: StudioHighBitGamut;
  readonly storage?: StudioHighBitStorage;
  /** 표면이 유지할 작업 개멋(기본 sRGB). */
  readonly gamut?: StudioHighBitGamut;
}

/**
 * `ImageData` 호환 스트레이트 RGBA 바이트 → 고비트 표면.
 * sRGB EOTF 디코드 → (필요 시) 개멋 변환 → 프리멀티플라이 순서다.
 */
export function studioHighBitSurfaceFromBytes(
  bytes: ArrayLike<number>,
  options: StudioHighBitDecodeOptions
): StudioHighBitSurface {
  const { width, height } = options;
  assertSurfaceShape(width, height);
  const expected = width * height * STUDIO_HIGHBIT_CHANNELS;
  if (bytes.length !== expected) {
    throw new Error("고비트 표면: 입력 바이트 길이가 폭×높이×4 와 다릅니다.");
  }
  const sourceGamut = options.sourceGamut ?? "srgb";
  const targetGamut = options.gamut ?? "srgb";
  const surface = createStudioHighBitSurface({
    width,
    height,
    storage: options.storage ?? "uint16",
    gamut: targetGamut,
    alpha: "premultiplied",
  });
  for (let index = 0; index < expected; index += STUDIO_HIGHBIT_CHANNELS) {
    const alpha = bytes[index + 3]! / 255;
    let linear: readonly [number, number, number] = [
      studioHighBitByteToLinear(bytes[index]!),
      studioHighBitByteToLinear(bytes[index + 1]!),
      studioHighBitByteToLinear(bytes[index + 2]!),
    ];
    if (sourceGamut !== targetGamut) {
      linear = convertStudioHighBitLinearGamut(linear, sourceGamut, targetGamut);
    }
    const premultiplied = premultiplyStudioHighBitRgb(linear, alpha);
    const storage = surface.storage;
    surface.data[index] = encodeStudioHighBitStorageValue(premultiplied[0], storage);
    surface.data[index + 1] = encodeStudioHighBitStorageValue(premultiplied[1], storage);
    surface.data[index + 2] = encodeStudioHighBitStorageValue(premultiplied[2], storage);
    surface.data[index + 3] = encodeStudioHighBitStorageValue(alpha, storage);
  }
  return surface;
}

/**
 * 최종 8비트 양자화기. 부호화(0..1) 값과 픽셀 좌표·채널을 받아 0..255 정수를 돌려준다.
 * 기본은 단순 반올림, 디더링은 `studio-highbit-dither` 가 이 형태로 주입한다.
 */
export type StudioHighBitQuantizer = (
  encoded: number,
  x: number,
  y: number,
  channel: number
) => number;

export const roundStudioHighBitQuantizer: StudioHighBitQuantizer = (encoded) =>
  Math.max(0, Math.min(255, Math.round(clampStudioHighBitUnit(encoded) * 255)));

export interface StudioHighBitEncodeOptions {
  /** 출력 바이트가 놓일 개멋(기본 sRGB). Display P3 캔버스로 내보내면 "display-p3". */
  readonly targetGamut?: StudioHighBitGamut;
  readonly clip?: StudioHighBitGamutClipMode;
  readonly quantizer?: StudioHighBitQuantizer;
}

/**
 * 고비트 표면 → `ImageData` 호환 스트레이트 RGBA 바이트.
 * 언프리멀티플라이(선형) → 개멋 변환(선형) → 개멋 클리핑 → OETF → 양자화 순서다.
 * 알파는 감마 곡선을 타지 않는다(캔버스 알파 바이트는 선형 규약).
 */
export function studioHighBitSurfaceToBytes(
  surface: StudioHighBitSurface,
  options: StudioHighBitEncodeOptions = {}
): Uint8ClampedArray {
  const targetGamut = options.targetGamut ?? "srgb";
  const clip = options.clip ?? "clamp";
  const quantize = options.quantizer ?? roundStudioHighBitQuantizer;
  const out = new Uint8ClampedArray(surface.width * surface.height * STUDIO_HIGHBIT_CHANNELS);
  for (let y = 0; y < surface.height; y += 1) {
    for (let x = 0; x < surface.width; x += 1) {
      const offset = pixelOffset(surface, x, y);
      const straight = readStudioHighBitPixel(surface, x, y);
      let linear: readonly [number, number, number] = [straight[0], straight[1], straight[2]];
      if (surface.gamut !== targetGamut) {
        linear = convertStudioHighBitLinearGamut(linear, surface.gamut, targetGamut);
      }
      const clipped = clipStudioHighBitToGamut(linear, clip);
      out[offset] = quantize(studioHighBitLinearToSrgb(clipped[0]), x, y, 0);
      out[offset + 1] = quantize(studioHighBitLinearToSrgb(clipped[1]), x, y, 1);
      out[offset + 2] = quantize(studioHighBitLinearToSrgb(clipped[2]), x, y, 2);
      out[offset + 3] = quantize(clampStudioHighBitUnit(straight[3]), x, y, 3);
    }
  }
  return out;
}
