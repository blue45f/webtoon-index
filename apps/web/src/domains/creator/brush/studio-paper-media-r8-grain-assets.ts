/**
 * W7 종이 프리셋 → R8 그레인 에셋 파리티 (2026-08-13 brush quality wave, F1).
 *
 * 여섯 장의 절차적 종이(studio-paper-media-profile-v1)를 256×256 R8 타일로 구워 검증된 R8
 * 레지스트리(studio-brush-r8-grain-runtime) 하이드레이션 규약 그대로 등록할 수 있게 한다.
 * 목적은 에셋 레인(R8 종이 침착)이 dab 플래너와 **같은 W7 높이 필드**를 소비하는 것이다.
 *
 * 계약.
 * - 순수·결정적: 같은 프리셋은 항상 같은 바이트·같은 해시다(bake 캐시는 순수 메모이제이션).
 *   Math.random / Date.now / DOM 의존 없음 — jsdom 없이도 굽는다.
 * - 텍셀 = `samplePaperHeightV1` 높이(밝음=봉우리, 어두움=골). R8 샘플러 규약(어두운 텍셀 =
 *   침착 감소)과 자연 정렬이라 건식 peak-catch 와 같은 방향으로 읽힌다.
 * - seamless: 비주기 높이 필드를 4-탭 토러스 크로스페이드로 이어 반복 경계에 이음매가 없다.
 * - 인코딩: 무필터 스캔라인 + stored-deflate 그레이스케일 PNG 를 결정적으로 직접 인코딩한다.
 *   계약의 `encodedSha256`/`byteLength` 가 실제 인코딩 바이트를 가리키므로 나중에 에셋
 *   스토리지에 그대로 영속화할 수 있다(디코드 결과 = 정확히 baked R8 바이트).
 * - 등록은 명시 호출로만 일어난다 — 이 모듈은 어떤 기본값에도 배선하지 않는다(F1 계약).
 */

import { sha256HexPortable } from "../studio-sha256";

import { hydrateStudioBrushR8GrainAsset } from "./studio-brush-r8-grain-runtime";
import {
  STUDIO_PAPER_PRESET_IDS_V1,
  getStudioPaperPresetV1,
  samplePaperHeightV1,
} from "./studio-paper-media-profile-v1";

import type { StudioBrushR8TextureGrainSource } from "./studio-brush-r8-grain-asset-contract";
import type {
  StudioBrushR8GrainHydrationResult,
  StudioBrushR8GrainRegistry,
} from "./studio-brush-r8-grain-runtime";
import type { StudioPaperPresetIdV1 } from "./studio-paper-media-profile-v1";

export const STUDIO_PAPER_MEDIA_R8_GRAIN_VERSION_V1 = 1 as const;

/** 타일 한 변(px). R8 디코드 길이 = 256 × 256 = 65 536 바이트. */
export const STUDIO_PAPER_MEDIA_R8_TILE_SIZE_V1 = 256;

/** 에셋 id 접두 — `studio-paper-media-v1.{presetId}.{size}`. */
export const STUDIO_PAPER_MEDIA_R8_ASSET_ID_PREFIX_V1 = "studio-paper-media-v1";

export interface StudioPaperMediaR8GrainBakeV1 {
  readonly presetId: StudioPaperPresetIdV1;
  /** 레지스트리 hydrate 에 그대로 넘길 수 있는 정규화 가능 소스 참조. */
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  /** 타이트하게 패킹된 R8 바이트(호출마다 새 사본 — 레지스트리가 소유권을 가져도 안전). */
  readonly decodedBytes: Uint8Array;
  /** 결정적 그레이스케일 PNG 인코딩(호출마다 새 사본) — encodedSha256 의 원본 바이트. */
  readonly encodedBytes: Uint8Array;
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** 낱장 시드 — FNV-1a(`studio-paper-media-r8-v1:{presetId}`). 프리셋마다 고정된 한 장. */
function paperTileSeed(presetId: string): number {
  const key = `studio-paper-media-r8-v1:${presetId}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// 결정적 그레이스케일 PNG 인코더 (bit depth 8, color type 0, stored deflate)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFLATE_STORED_BLOCK_MAX = 65_535;

let crc32TableCache: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crc32TableCache) return crc32TableCache;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crc32TableCache = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    a = (a + bytes[index]!) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32BigEndian(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

/** type + data 를 하나의 PNG 청크(길이·CRC 포함)로 직렬화한다. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BigEndian(chunk, 0, data.length);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  writeUint32BigEndian(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

/** 무압축(stored) deflate 블록들을 zlib 스트림으로 감싼다 — 어떤 환경에서도 같은 바이트. */
function zlibStoredStream(raw: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(raw.length / DEFLATE_STORED_BLOCK_MAX));
  const stream = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  stream[0] = 0x78; // CMF: deflate, 32K window
  stream[1] = 0x01; // FLG: no dict, fastest (checksum-valid)
  let offset = 2;
  for (let block = 0; block < blockCount; block += 1) {
    const start = block * DEFLATE_STORED_BLOCK_MAX;
    const slice = raw.subarray(start, Math.min(start + DEFLATE_STORED_BLOCK_MAX, raw.length));
    stream[offset] = block === blockCount - 1 ? 0x01 : 0x00; // BFINAL | BTYPE=00
    stream[offset + 1] = slice.length & 0xff;
    stream[offset + 2] = (slice.length >>> 8) & 0xff;
    stream[offset + 3] = ~slice.length & 0xff;
    stream[offset + 4] = (~slice.length >>> 8) & 0xff;
    stream.set(slice, offset + 5);
    offset += 5 + slice.length;
  }
  writeUint32BigEndian(stream, offset, adler32(raw));
  return stream;
}

/** 8-bit 그레이스케일(R8) 바이트를 결정적 PNG 로 인코딩한다(필터 0 스캔라인). */
export function encodeStudioPaperMediaR8PngV1(
  width: number,
  height: number,
  bytes: Uint8Array,
): Uint8Array {
  if (
    !Number.isSafeInteger(width) || width <= 0
    || !Number.isSafeInteger(height) || height <= 0
    || bytes.length !== width * height
  ) {
    throw new Error(
      `encodeStudioPaperMediaR8PngV1: ${width}x${height} needs ${width * height} bytes, got ${bytes.length}`,
    );
  }
  const ihdr = new Uint8Array(13);
  writeUint32BigEndian(ihdr, 0, width);
  writeUint32BigEndian(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter type 0 (None)
    raw.set(bytes.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunks = [
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStoredStream(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

// ---------------------------------------------------------------------------
// W7 높이 필드 → seamless R8 타일 bake
// ---------------------------------------------------------------------------

/**
 * 비주기 W7 높이 필드의 표준 타일화 — 4-탭 토러스 크로스페이드.
 * t(x,y) = Σ h(x−iS, y−jS)·w — x=0 과 x=S 가 같은 값으로 이어져 반복 경계가 사라진다.
 * 대비가 가장자리로 갈수록 다소 눌리는 것은 크로스페이드의 알려진 비용이며, 이빨 분산은
 * 테스트가 하한을 고정한다(질감 우선 계약).
 */
function bakeSeamlessHeightTile(
  presetId: StudioPaperPresetIdV1,
  size: number,
): Uint8Array {
  const preset = getStudioPaperPresetV1(presetId);
  const seed = paperTileSeed(presetId);
  const bytes = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5;
    const fy = py / size;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const fx = px / size;
      const h00 = samplePaperHeightV1(preset, px, py, seed);
      const h10 = samplePaperHeightV1(preset, px - size, py, seed);
      const h01 = samplePaperHeightV1(preset, px, py - size, seed);
      const h11 = samplePaperHeightV1(preset, px - size, py - size, seed);
      const height =
        h00 * (1 - fx) * (1 - fy)
        + h10 * fx * (1 - fy)
        + h01 * (1 - fx) * fy
        + h11 * fx * fy;
      bytes[y * size + x] = Math.round(clamp01(height) * 255);
    }
  }
  return bytes;
}

interface BakedTileCacheEntry {
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly decodedBytes: Uint8Array;
  readonly encodedBytes: Uint8Array;
}

/** (presetId 6종 × 고정 크기)의 순수 메모이제이션 — 재호출 시 재굽지 않는다. */
const bakedTileCacheV1 = new Map<StudioPaperPresetIdV1, BakedTileCacheEntry>();

/**
 * W7 프리셋 한 장을 256×256 R8 타일로 굽고, R8 에셋 계약을 만족하는 소스 참조와 함께
 * 돌려준다. 반환 바이트는 호출마다 새 사본이라 하이드레이션/전송이 캐시를 오염시킬 수 없다.
 */
export function bakeStudioPaperMediaR8GrainTileV1(
  presetId: StudioPaperPresetIdV1,
): StudioPaperMediaR8GrainBakeV1 {
  const cached = bakedTileCacheV1.get(presetId);
  if (cached) {
    return Object.freeze({
      presetId,
      source: cached.source,
      decodedBytes: cached.decodedBytes.slice(),
      encodedBytes: cached.encodedBytes.slice(),
    });
  }
  const size = STUDIO_PAPER_MEDIA_R8_TILE_SIZE_V1;
  const decodedBytes = bakeSeamlessHeightTile(presetId, size);
  const encodedBytes = encodeStudioPaperMediaR8PngV1(size, size, decodedBytes);
  const source: StudioBrushR8TextureGrainSource = Object.freeze({
    kind: "r8-texture-v1" as const,
    asset: Object.freeze({
      assetId: `${STUDIO_PAPER_MEDIA_R8_ASSET_ID_PREFIX_V1}.${presetId}.${size}`,
      encodedSha256: `sha256:${sha256HexPortable(encodedBytes)}`,
      decodedSha256: `sha256:${sha256HexPortable(decodedBytes)}`,
      byteLength: encodedBytes.length,
      mediaType: "image/png" as const,
      width: size,
      height: size,
      channel: "luminance" as const,
      encoding: "r8-unorm" as const,
    }),
  });
  bakedTileCacheV1.set(presetId, { source, decodedBytes, encodedBytes });
  return Object.freeze({
    presetId,
    source,
    decodedBytes: decodedBytes.slice(),
    encodedBytes: encodedBytes.slice(),
  });
}

export interface StudioPaperMediaR8GrainRegistrationV1 {
  readonly presetId: StudioPaperPresetIdV1;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly result: StudioBrushR8GrainHydrationResult;
}

/**
 * 여섯 W7 프리셋 타일을 R8 레지스트리에 등록한다(기본은 공유 레지스트리). 결과는 프리셋
 * 순서 그대로의 영수증 목록이다. 어떤 기본값도 바꾸지 않는다 — 소비자는 돌려받은 source 를
 * 명시적으로 브러시 grain 설정에 연결해야만 이 타일을 읽게 된다.
 */
export function registerStudioPaperMediaR8GrainPresetTilesV1(
  registry?: StudioBrushR8GrainRegistry,
): readonly StudioPaperMediaR8GrainRegistrationV1[] {
  return Object.freeze(STUDIO_PAPER_PRESET_IDS_V1.map((presetId) => {
    const baked = bakeStudioPaperMediaR8GrainTileV1(presetId);
    const result = registry
      ? registry.hydrate(baked.source, baked.decodedBytes)
      : hydrateStudioBrushR8GrainAsset(baked.source, baked.decodedBytes);
    return Object.freeze({ presetId, source: baked.source, result });
  }));
}
