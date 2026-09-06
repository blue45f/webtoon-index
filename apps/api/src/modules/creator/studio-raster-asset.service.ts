import { createHash, webcrypto } from "node:crypto";
import { inflateSync } from "node:zlib";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";

import {
  STUDIO_RASTER_ASSET_MAX_AXIS,
  STUDIO_RASTER_ASSET_MAX_BYTES,
  StudioRasterAssetManifestSchema,
  isStudioRasterAssetAdmissionOptedIn,
  isStudioRasterAssetReferenceStoredExactly,
  parseStudioRasterStoredReference,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";

import {
  STUDIO_RASTER_ASSET_REPOSITORY,
  StudioRasterAssetCleanupOwnershipError,
  StudioRasterAssetForbiddenError,
  StudioRasterAssetImmutableConflictError,
  StudioRasterAssetNotFoundError,
  StudioRasterAssetQuotaError,
  StudioRasterAssetReferencedError,
} from "./studio-raster-asset.repository";

import type { DrizzleStudioCrdtTransaction } from "./studio-crdt.repository";
import type {
  StudioRasterAssetContent,
  StudioRasterAssetCleanupReceipt,
  StudioRasterAssetRepository,
} from "./studio-raster-asset.repository";
import type {
  StudioRasterAssetReference,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import type {
  StudioRasterAssetManifest,
  StudioRasterStorageMediaType,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_KNOWN_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const PNG_ANIMATION_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);
const PNG_MAX_CHUNKS = 8_192;
const PNG_MAX_IDAT_CHUNKS = 4_096;
const RASTER_UPLOAD_MIME_TYPES = new Set([
  "application/octet-stream",
  "image/png",
]);

export const STUDIO_RASTER_ASSET_MAX_REFERENCES_PER_VALIDATION = 256;

export interface StudioRasterAssetUploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface StudioRasterAssetImageMetadata {
  mediaType: StudioRasterStorageMediaType;
  width: number;
  height: number;
}

export interface AdmittedStudioRasterAssetPayload extends StudioRasterAssetImageMetadata {
  payload: Uint8Array;
  sha256: string;
}

function bytesEqual(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[]
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function checkedDimensions(width: number, height: number): { width: number; height: number } {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > STUDIO_RASTER_ASSET_MAX_AXIS ||
    height > STUDIO_RASTER_ASSET_MAX_AXIS
  ) {
    throw new Error(`래스터 타일 크기는 1..${STUDIO_RASTER_ASSET_MAX_AXIS}px 범위여야 합니다.`);
  }
  return { width, height };
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunkName(bytes: Uint8Array, offset: number): string {
  const typeBytes = bytes.subarray(offset, offset + 4);
  if (
    typeBytes.byteLength !== 4 ||
    [...typeBytes].some((byte) => !(
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a)
    )) ||
    ((typeBytes[2] ?? 0) & 0x20) !== 0
  ) {
    throw new Error("PNG 블록 타입이 올바르지 않습니다.");
  }
  return String.fromCharCode(...typeBytes);
}

function validatePngColorHeader(
  bitDepth: number,
  colorType: number,
  compression: number,
  filter: number,
  interlace: number
): void {
  if (
    bitDepth !== 8 ||
    colorType !== 6 ||
    compression !== 0 ||
    filter !== 0 ||
    interlace !== 0
  ) {
    throw new Error("Canvas 호환 8-bit RGBA 비인터레이스 PNG만 사용할 수 있습니다.");
  }
}

function validatePngScanlines(
  chunks: readonly Uint8Array[],
  dimensions: { width: number; height: number },
  compressedByteLength: number
): void {
  const rowByteLength = dimensions.width * 4;
  const expectedByteLength = (rowByteLength + 1) * dimensions.height;
  const compressed = Buffer.allocUnsafe(compressedByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let scanlines: Buffer;
  try {
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedByteLength,
    }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (
      !Buffer.isBuffer(result.buffer) ||
      result.engine.bytesWritten !== compressed.byteLength
    ) {
      throw new Error("trailing zlib input");
    }
    scanlines = result.buffer;
  } catch {
    throw new Error("PNG IDAT zlib/Adler 무결성 검사가 실패했습니다.");
  }
  if (scanlines.byteLength !== expectedByteLength) {
    throw new Error("PNG IDAT의 디코딩된 픽셀 길이가 타일 크기와 일치하지 않습니다.");
  }
  for (let row = 0; row < dimensions.height; row += 1) {
    const filterType = scanlines[row * (rowByteLength + 1)];
    if (filterType === undefined || filterType > 4) {
      throw new Error("PNG 스캔라인 필터 바이트가 0..4 범위를 벗어났습니다.");
    }
  }
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 57 || !bytesEqual(bytes, 0, PNG_SIGNATURE)) {
    throw new Error("PNG 파일이 잘렸거나 시그니처가 올바르지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let colorType = -1;
  let dimensions: { width: number; height: number } | null = null;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let totalImageDataBytes = 0;
  const imageDataChunks: Uint8Array[] = [];
  const zlibHeader: number[] = [];

  while (offset < bytes.byteLength) {
    if (chunkIndex >= PNG_MAX_CHUNKS) {
      throw new Error("PNG 블록 수가 안전 한도를 넘었습니다.");
    }
    if (bytes.byteLength - offset < 12) throw new Error("PNG 블록 헤더가 잘렸습니다.");
    const chunkLength = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (
      chunkLength > STUDIO_RASTER_ASSET_MAX_BYTES ||
      dataEnd < dataOffset ||
      chunkEnd > bytes.byteLength
    ) {
      throw new Error("PNG 블록 경계가 올바르지 않습니다.");
    }
    const chunkType = pngChunkName(bytes, typeOffset);
    if (view.getUint32(dataEnd, false) !== pngCrc32(bytes.subarray(typeOffset, dataEnd))) {
      throw new Error(`PNG ${chunkType} 블록 무결성 검사가 실패했습니다.`);
    }
    if (PNG_ANIMATION_CHUNKS.has(chunkType)) {
      throw new Error("애니메이션 PNG는 래스터 CRDT 타일로 사용할 수 없습니다.");
    }
    if ((bytes[typeOffset]! & 0x20) === 0 && !PNG_KNOWN_CRITICAL_CHUNKS.has(chunkType)) {
      throw new Error(`지원하지 않는 PNG 필수 블록(${chunkType})이 있습니다.`);
    }

    if (chunkType === "IHDR") {
      if (chunkIndex !== 0 || chunkLength !== 13 || dimensions) {
        throw new Error("PNG IHDR 블록 순서 또는 길이가 올바르지 않습니다.");
      }
      dimensions = checkedDimensions(
        view.getUint32(dataOffset, false),
        view.getUint32(dataOffset + 4, false)
      );
      const bitDepth = bytes[dataOffset + 8]!;
      colorType = bytes[dataOffset + 9]!;
      validatePngColorHeader(
        bitDepth,
        colorType,
        bytes[dataOffset + 10]!,
        bytes[dataOffset + 11]!,
        bytes[dataOffset + 12]!
      );
    } else if (!dimensions) {
      throw new Error("PNG의 첫 블록은 IHDR이어야 합니다.");
    } else if (chunkType === "PLTE") {
      if (
        sawPalette ||
        sawImageData ||
        chunkLength < 3 ||
        chunkLength > 768 ||
        chunkLength % 3 !== 0 ||
        colorType === 0 ||
        colorType === 4
      ) {
        throw new Error("PNG PLTE 블록이 올바르지 않습니다.");
      }
      sawPalette = true;
    } else if (chunkType === "IDAT") {
      if (
        imageDataEnded ||
        chunkLength === 0 ||
        imageDataChunks.length >= PNG_MAX_IDAT_CHUNKS
      ) {
        throw new Error("PNG IDAT 블록이 비어 있거나 연속되지 않습니다.");
      }
      sawImageData = true;
      totalImageDataBytes += chunkLength;
      imageDataChunks.push(bytes.subarray(dataOffset, dataEnd));
      for (let index = dataOffset; index < dataEnd && zlibHeader.length < 2; index += 1) {
        zlibHeader.push(bytes[index]!);
      }
    } else if (sawImageData) {
      imageDataEnded = true;
    }

    if (chunkType === "IEND") {
      if (
        chunkLength !== 0 ||
        !sawImageData ||
        totalImageDataBytes < 2 ||
        chunkEnd !== bytes.byteLength
      ) {
        throw new Error("PNG IEND 경계 또는 이미지 데이터가 올바르지 않습니다.");
      }
      if (colorType === 3 && !sawPalette) {
        throw new Error("인덱스 PNG에는 PLTE 블록이 필요합니다.");
      }
      const [compressionMethod, flags] = zlibHeader;
      if (
        compressionMethod === undefined ||
        flags === undefined ||
        (compressionMethod & 0x0f) !== 8 ||
        (compressionMethod >> 4) > 7 ||
        ((compressionMethod << 8) + flags) % 31 !== 0 ||
        (flags & 0x20) !== 0
      ) {
        throw new Error("PNG IDAT의 zlib 헤더가 올바르지 않습니다.");
      }
      validatePngScanlines(imageDataChunks, dimensions, totalImageDataBytes);
      return dimensions;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }
  throw new Error("PNG IEND 블록이 없습니다.");
}

function sniffRasterMediaType(bytes: Uint8Array): StudioRasterStorageMediaType | null {
  if (bytesEqual(bytes, 0, PNG_SIGNATURE)) return "image/png";
  return null;
}

export function readStudioRasterAssetImageMetadata(
  declaredMimeType: string,
  bytes: Uint8Array
): StudioRasterAssetImageMetadata {
  if (!RASTER_UPLOAD_MIME_TYPES.has(declaredMimeType)) {
    throw new Error("완전히 검증 가능한 PNG 래스터 타일만 사용할 수 있습니다.");
  }
  const mediaType = sniffRasterMediaType(bytes);
  if (!mediaType) throw new Error("PNG 파일 시그니처가 필요합니다. WebP는 아직 지원하지 않습니다.");
  if (declaredMimeType !== "application/octet-stream" && declaredMimeType !== mediaType) {
    throw new Error("래스터 타일 MIME 형식과 실제 파일 내용이 다릅니다.");
  }
  const dimensions = readPngDimensions(bytes);
  return { mediaType, ...dimensions };
}

export function admitStudioRasterAssetPayload(
  declaredMimeType: string,
  input: Uint8Array
): AdmittedStudioRasterAssetPayload {
  if (input.byteLength < 1 || input.byteLength > STUDIO_RASTER_ASSET_MAX_BYTES) {
    throw new Error(
      `래스터 타일은 ${STUDIO_RASTER_ASSET_MAX_BYTES / 1_024 / 1_024}MB 이하만 사용할 수 있습니다.`
    );
  }
  const payload = new Uint8Array(input);
  const metadata = readStudioRasterAssetImageMetadata(declaredMimeType, payload);
  return {
    ...metadata,
    payload,
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
}

function sameReference(
  left: StudioRasterAssetReference,
  right: StudioRasterAssetReference
): boolean {
  return (
    left.assetId === right.assetId &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.mediaType === right.mediaType &&
    left.width === right.width &&
    left.height === right.height
  );
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  // WebCrypto keeps the digest off the JavaScript call stack. Reads still authenticate every
  // repository payload, but no longer repeat the upload-only PNG CRC + zlib scanline decoder.
  const digest = await webcrypto.subtle.digest("SHA-256", new Uint8Array(input));
  return Buffer.from(digest).toString("hex");
}

function storedPngHeaderMatchesManifest(
  manifest: StudioRasterAssetManifest,
  payload: Uint8Array
): boolean {
  if (
    payload.byteLength < 24 ||
    !bytesEqual(payload, 0, PNG_SIGNATURE) ||
    !bytesEqual(payload, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    return false;
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return (
    view.getUint32(8, false) === 13 &&
    view.getUint32(16, false) === manifest.width &&
    view.getUint32(20, false) === manifest.height
  );
}

async function assertStoredPayloadIntegrity(
  requestedAssetId: string,
  manifest: StudioRasterAssetManifest,
  payload: Uint8Array
): Promise<void> {
  if (
    !(payload instanceof Uint8Array) ||
    manifest.assetId !== requestedAssetId ||
    payload.byteLength !== manifest.byteLength ||
    !storedPngHeaderMatchesManifest(manifest, payload) ||
    await sha256Hex(payload) !== manifest.sha256
  ) {
    throw new Error("stored studio raster asset payload integrity mismatch");
  }
}

@Injectable()
export class StudioRasterAssetService {
  constructor(
    @Inject(STUDIO_RASTER_ASSET_REPOSITORY)
    private readonly repository: StudioRasterAssetRepository
  ) {}

  async upload(
    actorUserId: string,
    workId: string,
    assetId: string,
    file: StudioRasterAssetUploadFile | undefined
  ): Promise<StudioRasterAssetManifest> {
    if (!isStudioRasterAssetAdmissionOptedIn(
      process.env.STUDIO_RASTER_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "래스터 공동 편집 저장은 검증된 렌더러 인계가 준비될 때까지 비활성화되어 있습니다."
      );
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.byteLength) {
      throw new BadRequestException("업로드할 래스터 타일 파일이 필요합니다.");
    }
    if (file.size > STUDIO_RASTER_ASSET_MAX_BYTES) {
      throw new PayloadTooLargeException("래스터 타일 파일이 16MB 한도를 넘었습니다.");
    }
    let admitted: AdmittedStudioRasterAssetPayload;
    try {
      admitted = admitStudioRasterAssetPayload(file.mimetype, file.buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "래스터 타일 파일이 올바르지 않습니다."
      );
    }
    if (assetId !== admitted.sha256) {
      throw new BadRequestException("래스터 자산 ID와 파일 SHA-256이 일치하지 않습니다.");
    }
    return this.run(async () => StudioRasterAssetManifestSchema.parse(
      await this.repository.put(actorUserId, {
        workId,
        assetId,
        ...admitted,
      })
    ));
  }

  getManifest(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetManifest> {
    return this.run(async () => StudioRasterAssetManifestSchema.parse(
      await this.repository.getManifest(actorUserId, workId, assetId)
    ));
  }

  getContent(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetContent> {
    return this.run(async () => {
      const content = await this.repository.getContent(actorUserId, workId, assetId);
      const manifest = StudioRasterAssetManifestSchema.parse(content.manifest);
      await assertStoredPayloadIntegrity(assetId, manifest, content.payload);
      return { manifest, payload: content.payload };
    });
  }

  deleteUnreferencedUpload(
    actorUserId: string,
    receipt: StudioRasterAssetCleanupReceipt
  ): Promise<boolean> {
    return this.run(() => this.repository.deleteUnreferencedUpload(actorUserId, receipt));
  }

  /**
   * Admission seam for durable CRDT append: callers validate all newly introduced references
   * before writing the Yjs update. The only delete route shares the same per-work CRDT lock and
   * refuses every durably referenced identity, so this admission cannot race ordinary cleanup.
   */
  async assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioRasterAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    if (
      references.length > 0 &&
      !isStudioRasterAssetAdmissionOptedIn(
        process.env.STUDIO_RASTER_ASSET_ADMISSION
      )
    ) {
      throw new ForbiddenException(
        "래스터 공동 편집 참조는 검증된 렌더러 인계가 준비될 때까지 비활성화되어 있습니다."
      );
    }
    if (references.length > STUDIO_RASTER_ASSET_MAX_REFERENCES_PER_VALIDATION) {
      throw new BadRequestException("한 번에 검증할 래스터 자산 참조가 너무 많습니다.");
    }
    const expectedById = new Map<string, StudioRasterAssetReference>();
    try {
      for (const value of references) {
        const reference = parseStudioRasterStoredReference(value);
        const existing = expectedById.get(reference.assetId);
        if (existing && !sameReference(existing, reference)) {
          throw new Error("같은 래스터 자산 ID가 서로 다른 메타데이터를 가리킵니다.");
        }
        expectedById.set(reference.assetId, reference);
      }
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "래스터 자산 참조가 올바르지 않습니다."
      );
    }
    if (expectedById.size === 0) return;

    const assetIds = [...expectedById.keys()];
    const manifests = await this.run(() => transaction
      ? this.repository.getManifestsInTransaction(
          transaction,
          actorUserId,
          workId,
          assetIds
        )
      : this.repository.getManifests(actorUserId, workId, assetIds));
    const storedById = new Map(manifests.map((value) => {
      const manifest = StudioRasterAssetManifestSchema.parse(value);
      return [manifest.assetId, manifest] as const;
    }));
    for (const reference of expectedById.values()) {
      const stored = storedById.get(reference.assetId);
      if (!stored || !isStudioRasterAssetReferenceStoredExactly(stored, reference)) {
        throw new BadRequestException(
          "저장되지 않았거나 메타데이터가 다른 래스터 자산 참조가 있습니다."
        );
      }
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StudioRasterAssetNotFoundError) {
        throw new NotFoundException("래스터 타일 자산을 찾을 수 없습니다.");
      }
      if (error instanceof StudioRasterAssetForbiddenError) {
        throw new ForbiddenException(
          error.operation === "edit"
            ? "이 작품에 래스터 타일을 추가할 권한이 없습니다."
            : "이 작품의 래스터 타일을 볼 권한이 없습니다."
        );
      }
      if (error instanceof StudioRasterAssetCleanupOwnershipError) {
        throw new ForbiddenException("직접 업로드한 미사용 래스터 타일만 정리할 수 있습니다.");
      }
      if (error instanceof StudioRasterAssetReferencedError) {
        throw new ConflictException(
          "이미 팀 문서에 기록된 래스터 타일은 자동 정리할 수 없습니다."
        );
      }
      if (error instanceof StudioRasterAssetImmutableConflictError) {
        throw new ConflictException("내용 주소가 같은 래스터 자산의 불변 메타데이터가 다릅니다.");
      }
      if (error instanceof StudioRasterAssetQuotaError) {
        throw new PayloadTooLargeException(
          error.quota === "count"
            ? "작품의 래스터 타일 자산 수 한도를 넘었습니다."
            : "작품의 래스터 타일 저장 용량 2GiB 한도를 넘었습니다."
        );
      }
      throw error;
    }
  }
}
