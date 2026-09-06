import { createHash } from "node:crypto";

import {
  normalizeStudioBrushR8TextureGrainSource,
  STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS,
} from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import {
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";

import type { StudioWorkAssetContent } from "./studio-work-asset.repository";
import type { StudioBrushR8TextureGrainSource } from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import type { StudioWorkAssetManifest } from "../../../../web/src/shared/lib/studio-work-asset-contract";

/**
 * A single admission may bind many strokes to the same source, but it may never make the server
 * decode an unbounded set of distinct images. Decoding is intentionally serial, so this total
 * work budget also bounds peak decoded image memory to the per-image RGBA upload limit.
 */
export const STUDIO_R8_GRAIN_ADMISSION_MAX_TOTAL_ENCODED_BYTES = 64 * 1024 * 1024;
export const STUDIO_R8_GRAIN_ADMISSION_MAX_TOTAL_DECODED_BYTES =
  STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDecodedByteLength;

export interface StudioR8GrainDecodedPng {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorModel: string;
  readonly components: number;
  readonly channels: number;
  readonly alpha: boolean;
  /** image-js exposes its owned typed array; optional keeps injected test decoders minimal. */
  readonly data?: Uint8Array | Uint8ClampedArray | Uint16Array;
  getValueByIndex(index: number, channel: number): number;
}

export type StudioR8GrainPngDecoder = (
  bytes: Uint8Array
) => StudioR8GrainDecodedPng | Promise<StudioR8GrainDecodedPng>;

export interface StudioR8GrainAdmissionContent {
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  /**
   * Must be a private repository copy. The verifier scrubs the encoded payload after admission,
   * including every failure path.
   */
  readonly content: StudioWorkAssetContent;
}

export interface StudioR8GrainAdmissionOptions {
  readonly decodePng?: StudioR8GrainPngDecoder;
  /** Testable lower bounds only; callers cannot raise either production ceiling. */
  readonly maximumTotalEncodedBytes?: number;
  readonly maximumTotalDecodedBytes?: number;
}

type ImageJsModule = typeof import("image-js");

let imageJsModulePromise: Promise<ImageJsModule> | null = null;

async function defaultDecodePng(bytes: Uint8Array): Promise<StudioR8GrainDecodedPng> {
  // The repository's Node 24 baseline supports the CommonJS build's require(ESM) interop, while
  // Vitest/Vite preserve native import. Keeping this lazy avoids loading the decoder on ordinary
  // asset and CRDT requests.
  imageJsModulePromise ??= import("image-js");
  const { decodePng } = await imageJsModulePromise;
  // image-js intentionally marks its owned data array private in declarations even though the
  // runtime field is present and scrubbed below; the public channel access surface is identical.
  return decodePng(bytes) as unknown as StudioR8GrainDecodedPng;
}

function exactChannelValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("PNG 채널 값이 8-bit 범위를 벗어났습니다.");
  }
  return value;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedMaximum(value: number | undefined, hardMaximum: number): number {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("R8 브러시 에셋 검증 예산이 올바르지 않습니다.");
  }
  return Math.min(value, hardMaximum);
}

function checkedAdd(total: number, value: number, maximum: number, label: string): number {
  const next = total + value;
  if (!Number.isSafeInteger(next) || next > maximum) {
    throw new Error(`R8 브러시 에셋 ${label} 검증 예산을 초과했습니다.`);
  }
  return next;
}

function zeroDecodedImage(image: StudioR8GrainDecodedPng | null): void {
  if (!image?.data) return;
  image.data.fill(0);
}

function assertExactStoredManifest(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  stored: StudioWorkAssetManifest
): void {
  const expected = source.asset;
  const expectedDecodedRgbaBytes = expected.width * expected.height * 4;
  if (
    stored.assetId !== expected.assetId
    || stored.elementType !== "image"
    || stored.descriptor.element.id !== expected.assetId
    || stored.descriptor.element.type !== "image"
    || stored.mimeType !== expected.mediaType
    || stored.byteSize !== expected.byteLength
    || stored.sha256 !== expected.encodedSha256.slice("sha256:".length)
    || !stored.intrinsicImage
    || stored.intrinsicImage.width !== expected.width
    || stored.intrinsicImage.height !== expected.height
    || stored.intrinsicImage.decodedRgbaBytes !== expectedDecodedRgbaBytes
    || expectedDecodedRgbaBytes > STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES
  ) {
    throw new Error("저장된 R8 브러시 PNG가 선언된 콘텐츠 계약과 정확히 일치하지 않습니다.");
  }
}

export function assertStudioR8GrainAdmissionManifest(
  sourceValue: unknown,
  stored: StudioWorkAssetManifest
): void {
  const source = normalizeStudioBrushR8TextureGrainSource(sourceValue);
  if (!source) throw new Error("R8 브러시 에셋 참조가 올바르지 않습니다.");
  assertExactStoredManifest(source, stored);
}

/**
 * Cheap preflight used before any binary column is selected. The returned normalized array is
 * stable and duplicate-free, and its declared encoded/decoded work fits the hard admission caps.
 */
export function assertStudioR8GrainAdmissionSourceBudget(
  sourceValues: readonly unknown[],
  options: Pick<
    StudioR8GrainAdmissionOptions,
    "maximumTotalEncodedBytes" | "maximumTotalDecodedBytes"
  > = {}
): readonly Readonly<StudioBrushR8TextureGrainSource>[] {
  const maximumTotalEncodedBytes = boundedMaximum(
    options.maximumTotalEncodedBytes,
    STUDIO_R8_GRAIN_ADMISSION_MAX_TOTAL_ENCODED_BYTES
  );
  const maximumTotalDecodedBytes = boundedMaximum(
    options.maximumTotalDecodedBytes,
    STUDIO_R8_GRAIN_ADMISSION_MAX_TOTAL_DECODED_BYTES
  );
  if (sourceValues.length > STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK) {
    throw new Error("한 작품에서 검증할 수 있는 R8 브러시 에셋이 너무 많습니다.");
  }

  const normalizedSources: Readonly<StudioBrushR8TextureGrainSource>[] = [];
  const seenAssetIds = new Set<string>();
  let totalEncodedBytes = 0;
  let totalDecodedBytes = 0;
  for (const sourceValue of sourceValues) {
    const source = normalizeStudioBrushR8TextureGrainSource(sourceValue);
    if (!source || seenAssetIds.has(source.asset.assetId)) {
      throw new Error("R8 브러시 에셋 검증 목록에 잘못되거나 중복된 ID가 있습니다.");
    }
    seenAssetIds.add(source.asset.assetId);
    totalEncodedBytes = checkedAdd(
      totalEncodedBytes,
      source.asset.byteLength,
      maximumTotalEncodedBytes,
      "인코딩 바이트"
    );
    totalDecodedBytes = checkedAdd(
      totalDecodedBytes,
      source.asset.width * source.asset.height,
      maximumTotalDecodedBytes,
      "디코딩 픽셀"
    );
    normalizedSources.push(source);
  }
  return normalizedSources;
}

function extractR8(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  image: StudioR8GrainDecodedPng
): Uint8Array {
  if (
    image.bitDepth !== 8
    || image.width !== source.asset.width
    || image.height !== source.asset.height
  ) {
    throw new Error("R8 브러시 PNG의 비트 깊이 또는 고유 크기가 선언과 다릅니다.");
  }

  const pixels = source.asset.width * source.asset.height;
  const output = new Uint8Array(pixels);
  if (source.asset.channel === "alpha") {
    if (
      !image.alpha
      || image.channels !== image.components + 1
      || (image.colorModel !== "GREYA" && image.colorModel !== "RGBA")
    ) {
      throw new Error("alpha R8 브러시 PNG에 실제 알파 채널이 없습니다.");
    }
    const alphaChannel = image.channels - 1;
    for (let index = 0; index < pixels; index += 1) {
      output[index] = exactChannelValue(image.getValueByIndex(index, alphaChannel));
    }
    return output;
  }

  if (
    image.components === 1
    && (image.colorModel === "GREY" || image.colorModel === "GREYA")
  ) {
    for (let index = 0; index < pixels; index += 1) {
      output[index] = exactChannelValue(image.getValueByIndex(index, 0));
    }
    return output;
  }
  if (
    image.components !== 3
    || (image.colorModel !== "RGB" && image.colorModel !== "RGBA")
  ) {
    throw new Error("luminance R8 브러시 PNG의 색상 모델이 지원되지 않습니다.");
  }
  for (let index = 0; index < pixels; index += 1) {
    const red = exactChannelValue(image.getValueByIndex(index, 0));
    const green = exactChannelValue(image.getValueByIndex(index, 1));
    const blue = exactChannelValue(image.getValueByIndex(index, 2));
    // Fixed integer BT.709. This is byte-identical to the browser hydrator.
    output[index] = (54 * red + 183 * green + 19 * blue + 128) >> 8;
  }
  return output;
}

async function assertDecodedIdentity(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  payload: Uint8Array,
  decodePng: StudioR8GrainPngDecoder
): Promise<void> {
  let image: StudioR8GrainDecodedPng | null = null;
  let decodedR8: Uint8Array | null = null;
  try {
    try {
      image = await decodePng(payload);
    } catch (cause) {
      throw new Error("R8 브러시 PNG를 디코드하지 못했습니다.", { cause });
    }
    decodedR8 = extractR8(source, image);
    if (sha256Hex(decodedR8) !== source.asset.decodedSha256.slice("sha256:".length)) {
      throw new Error("R8 브러시 PNG의 디코딩 결과 해시가 선언과 다릅니다.");
    }
  } finally {
    decodedR8?.fill(0);
    zeroDecodedImage(image);
  }
}

/**
 * Revalidates exact at-rest PNG bytes before their identity may enter the durable CRDT frontier.
 * Metadata/budget checks and encoded hashes complete before any decoder is invoked; distinct
 * images then decode serially. Every owned encoded/decoded temporary buffer is zeroed on success
 * and failure.
 */
export async function assertStudioR8GrainAdmissionContents(
  values: readonly StudioR8GrainAdmissionContent[],
  options: StudioR8GrainAdmissionOptions = {}
): Promise<void> {
  const decodePng = options.decodePng ?? defaultDecodePng;

  try {
    const normalizedSources = assertStudioR8GrainAdmissionSourceBudget(
      values.map(({ source }) => source),
      options
    );
    const normalizedValues: {
      source: Readonly<StudioBrushR8TextureGrainSource>;
      content: StudioWorkAssetContent;
    }[] = [];
    for (const [index, value] of values.entries()) {
      const source = normalizedSources[index]!;
      assertExactStoredManifest(source, value.content.manifest);
      if (value.content.payload.byteLength !== source.asset.byteLength) {
        throw new Error("저장된 R8 브러시 PNG가 선언된 콘텐츠 계약과 정확히 일치하지 않습니다.");
      }
      normalizedValues.push({ source, content: value.content });
    }

    // Hash work is also bounded by the aggregate encoded-byte budget above.
    for (const { source, content } of normalizedValues) {
      const expectedHash = source.asset.encodedSha256.slice("sha256:".length);
      if (
        sha256Hex(content.payload) !== expectedHash
        || content.manifest.sha256 !== expectedHash
      ) {
        throw new Error("저장된 R8 브러시 PNG의 인코딩 해시가 선언과 다릅니다.");
      }
    }

    // Do not Promise.all: one decoded RGBA image plus one compact R8 plane is the peak footprint.
    for (const { source, content } of normalizedValues) {
      await assertDecodedIdentity(source, content.payload, decodePng);
    }
  } finally {
    for (const { content } of values) content.payload.fill(0);
  }
}
