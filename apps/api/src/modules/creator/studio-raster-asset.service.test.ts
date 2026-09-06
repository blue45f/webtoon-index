import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN } from "../../../../web/src/shared/lib/studio-raster-asset-contract";

import {
  StudioRasterAssetCleanupOwnershipError,
  StudioRasterAssetForbiddenError,
  StudioRasterAssetImmutableConflictError,
  StudioRasterAssetNotFoundError,
  StudioRasterAssetQuotaError,
  StudioRasterAssetReferencedError,
} from "./studio-raster-asset.repository";
import {
  STUDIO_RASTER_ASSET_MAX_REFERENCES_PER_VALIDATION,
  StudioRasterAssetService,
  admitStudioRasterAssetPayload,
  readStudioRasterAssetImageMetadata,
} from "./studio-raster-asset.service";

import type { DrizzleStudioCrdtTransaction } from "./studio-crdt.repository";
import type { StudioRasterAssetRepository } from "./studio-raster-asset.repository";
import type { StudioRasterAssetReference } from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import type { StudioRasterAssetManifest } from "../../../../web/src/shared/lib/studio-raster-asset-contract";

const { inflateSyncSpy } = vi.hoisted(() => ({
  inflateSyncSpy: vi.fn(),
}));

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    inflateSync: (...args: Parameters<typeof actual.inflateSync>) => {
      inflateSyncSpy();
      return actual.inflateSync(...args);
    },
  };
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const bytes = new Uint8Array(12 + data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.byteLength, false);
  bytes.set(typeBytes, 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(concat(typeBytes, data)), false);
  return bytes;
}

function pngBytes(
  width = 1,
  height = 1,
  extraChunks: readonly Uint8Array[] = [],
  options: {
    bitDepth?: number;
    colorType?: number;
    interlace?: number;
    rawScanlines?: Uint8Array;
    splitIdatAt?: number;
    compressedSuffix?: Uint8Array;
  } = {}
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([
    options.bitDepth ?? 8,
    options.colorType ?? 6,
    0,
    0,
    options.interlace ?? 0,
  ], 8);
  const rawScanlines = options.rawScanlines ?? new Uint8Array((width * 4 + 1) * height);
  const compressed = concat(
    new Uint8Array(deflateSync(rawScanlines)),
    options.compressedSuffix ?? new Uint8Array()
  );
  const splitAt = options.splitIdatAt ?? compressed.byteLength;
  const imageDataChunks = splitAt > 0 && splitAt < compressed.byteLength
    ? [
        pngChunk("IDAT", compressed.subarray(0, splitAt)),
        pngChunk("IDAT", compressed.subarray(splitAt)),
      ]
    : [pngChunk("IDAT", compressed)];
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    ...extraChunks,
    ...imageDataChunks,
    pngChunk("IEND", new Uint8Array())
  );
}

function webpSignature(): Uint8Array {
  return Uint8Array.of(
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50
  );
}

const repository = {
  deleteUnreferencedUpload: vi.fn(),
  put: vi.fn(),
  getManifest: vi.fn(),
  getManifests: vi.fn(),
  getManifestsInTransaction: vi.fn(),
  getContent: vi.fn(),
};

function service(): StudioRasterAssetService {
  return new StudioRasterAssetService(repository as unknown as StudioRasterAssetRepository);
}

function manifestFor(
  bytes: Uint8Array
): StudioRasterAssetManifest {
  const admitted = admitStudioRasterAssetPayload("image/png", bytes);
  return {
    version: 1,
    scope: "work",
    assetId: admitted.sha256,
    sha256: admitted.sha256,
    byteLength: admitted.payload.byteLength,
    mediaType: admitted.mediaType,
    width: admitted.width,
    height: admitted.height,
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function referenceFrom(manifest: StudioRasterAssetManifest): StudioRasterAssetReference {
  const { assetId, sha256, byteLength, mediaType, width, height } = manifest;
  return { scope: "work", assetId, sha256, byteLength, mediaType, width, height };
}

describe("studio raster asset binary admission", () => {
  it("validates a complete PNG container, copies bytes, and computes its content address", () => {
    const input = pngBytes(320, 240);
    const admitted = admitStudioRasterAssetPayload("application/octet-stream", input);
    expect(admitted).toMatchObject({
      mediaType: "image/png",
      width: 320,
      height: 240,
      sha256: createHash("sha256").update(input).digest("hex"),
    });
    expect(admitted.payload).toEqual(input);
    expect(admitted.payload).not.toBe(input);
    input[0] = 0;
    expect(admitted.payload[0]).toBe(0x89);
  });

  it("accepts split IDAT streams only after bounded full scanline decoding", () => {
    expect(readStudioRasterAssetImageMetadata(
      "image/png",
      pngBytes(640, 480, [], { splitIdatAt: 5 })
    )).toEqual({ mediaType: "image/png", width: 640, height: 480 });
  });

  it("rejects WebP, MIME spoofing, and every unsupported storage codec", () => {
    expect(() => admitStudioRasterAssetPayload("image/webp", webpSignature()))
      .toThrow(/PNG/u);
    expect(() => admitStudioRasterAssetPayload("application/octet-stream", webpSignature()))
      .toThrow(/WebP는 아직 지원하지 않습니다/u);
    expect(() => admitStudioRasterAssetPayload("application/zstd", Uint8Array.of(1, 2, 3)))
      .toThrow(/PNG/u);
    expect(() => admitStudioRasterAssetPayload("image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff)))
      .toThrow(/PNG/u);
  });

  it("rejects PNG CRC damage, animation, invalid zlib headers, and oversized dimensions", () => {
    const corrupt = pngBytes();
    corrupt[29] = corrupt[29]! ^ 1;
    expect(() => admitStudioRasterAssetPayload("image/png", corrupt)).toThrow(/무결성/u);
    const animationControl = new Uint8Array(8);
    new DataView(animationControl.buffer).setUint32(0, 1, false);
    new DataView(animationControl.buffer).setUint32(4, 0, false);
    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(1, 1, [pngChunk("acTL", animationControl)])
    )).toThrow(/애니메이션/u);
    const invalidZlib = pngBytes();
    const idatTypeOffset = invalidZlib.findIndex((value, index) => (
      value === 0x49 && bytesEqualForTest(invalidZlib, index, [0x49, 0x44, 0x41, 0x54])
    ));
    expect(idatTypeOffset).toBeGreaterThan(0);
    const dataOffset = idatTypeOffset + 4;
    const dataEnd = dataOffset + new DataView(invalidZlib.buffer).getUint32(
      idatTypeOffset - 4,
      false
    );
    invalidZlib[dataOffset] = 0;
    new DataView(invalidZlib.buffer).setUint32(
      dataEnd,
      crc32(invalidZlib.subarray(idatTypeOffset, dataEnd)),
      false
    );
    expect(() => admitStudioRasterAssetPayload("image/png", invalidZlib)).toThrow(/zlib/u);
    expect(() => admitStudioRasterAssetPayload("image/png", pngBytes(1_025, 1)))
      .toThrow(/1\.\.1024px/u);
  });

  it("rejects non-RGBA/interlaced headers, Adler damage, wrong output length, and bad filters", () => {
    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(1, 1, [], { colorType: 2 })
    )).toThrow(/8-bit RGBA/u);
    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(1, 1, [], { interlace: 1 })
    )).toThrow(/비인터레이스/u);

    const adlerDamage = pngBytes();
    const idatTypeOffset = adlerDamage.findIndex((value, index) => (
      value === 0x49 && bytesEqualForTest(adlerDamage, index, [0x49, 0x44, 0x41, 0x54])
    ));
    const idatDataOffset = idatTypeOffset + 4;
    const idatDataEnd = idatDataOffset + new DataView(adlerDamage.buffer).getUint32(
      idatTypeOffset - 4,
      false
    );
    adlerDamage[idatDataEnd - 1] = adlerDamage[idatDataEnd - 1]! ^ 1;
    new DataView(adlerDamage.buffer).setUint32(
      idatDataEnd,
      crc32(adlerDamage.subarray(idatTypeOffset, idatDataEnd)),
      false
    );
    expect(() => admitStudioRasterAssetPayload("image/png", adlerDamage))
      .toThrow(/zlib\/Adler/u);
    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(1, 1, [], { compressedSuffix: Uint8Array.of(9, 9, 9) })
    )).toThrow(/zlib\/Adler/u);

    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(2, 2, [], { rawScanlines: new Uint8Array(5) })
    )).toThrow(/픽셀 길이/u);
    const badFilterScanlines = new Uint8Array(5);
    badFilterScanlines[0] = 5;
    expect(() => admitStudioRasterAssetPayload(
      "image/png",
      pngBytes(1, 1, [], { rawScanlines: badFilterScanlines })
    )).toThrow(/필터 바이트/u);
  });
});

function bytesEqualForTest(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[]
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

describe("StudioRasterAssetService", () => {
  beforeEach(() => {
    process.env.STUDIO_RASTER_ASSET_ADMISSION =
      STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN;
    inflateSyncSpy.mockClear();
    repository.put.mockReset();
    repository.getManifest.mockReset();
    repository.getManifests.mockReset();
    repository.getManifestsInTransaction.mockReset();
    repository.getContent.mockReset();
    repository.deleteUnreferencedUpload.mockReset();
  });

  afterEach(() => {
    delete process.env.STUDIO_RASTER_ASSET_ADMISSION;
  });

  it("keeps upload and new CRDT reference admission closed without the exact server opt-in", async () => {
    delete process.env.STUDIO_RASTER_ASSET_ADMISSION;
    const bytes = pngBytes();
    const manifest = manifestFor(bytes);
    const reference = referenceFrom(manifest);

    await expect(service().upload(
      "editor",
      "work-1",
      manifest.assetId,
      { buffer: Buffer.from(bytes), size: bytes.byteLength, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service().assertReferencesStored(
      "editor",
      "work-1",
      [reference]
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.put).not.toHaveBeenCalled();
    expect(repository.getManifests).not.toHaveBeenCalled();
  });

  it("requires assetId to equal the uploaded bytes and persists canonical metadata", async () => {
    const bytes = pngBytes(16, 8);
    const manifest = manifestFor(bytes);
    repository.put.mockResolvedValue(manifest);
    inflateSyncSpy.mockClear();
    await expect(service().upload(
      "editor",
      "work-1",
      manifest.assetId,
      { buffer: Buffer.from(bytes), size: bytes.byteLength, mimetype: "image/png" }
    )).resolves.toEqual(manifest);
    expect(repository.put).toHaveBeenCalledWith("editor", {
      workId: "work-1",
      assetId: manifest.assetId,
      sha256: manifest.sha256,
      mediaType: "image/png",
      width: 16,
      height: 8,
      payload: expect.any(Uint8Array),
    });
    expect(inflateSyncSpy).toHaveBeenCalledTimes(1);

    await expect(service().upload(
      "editor",
      "work-1",
      "b".repeat(64),
      { buffer: Buffer.from(bytes), size: bytes.byteLength, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.put).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, inconsistent, and over-limit multipart payloads", async () => {
    await expect(service().upload("editor", "work-1", "a".repeat(64), undefined))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service().upload(
      "editor",
      "work-1",
      "a".repeat(64),
      { buffer: Buffer.from(pngBytes()), size: 1, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(BadRequestException);
    const oversized = Buffer.alloc(16 * 1_024 * 1_024 + 1);
    await expect(service().upload(
      "editor",
      "work-1",
      "a".repeat(64),
      { buffer: oversized, size: oversized.byteLength, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it("authenticates repeated immutable reads without repeating PNG decompression", async () => {
    const bytes = pngBytes(8, 4);
    const manifest = manifestFor(bytes);
    repository.getContent.mockResolvedValue({ manifest, payload: bytes });
    inflateSyncSpy.mockClear();
    const rasterAssets = service();

    await expect(rasterAssets.getContent("viewer", "work-1", manifest.assetId))
      .resolves.toEqual({ manifest, payload: bytes });
    await expect(rasterAssets.getContent("viewer", "work-1", manifest.assetId))
      .resolves.toEqual({ manifest, payload: bytes });
    expect(repository.getContent).toHaveBeenCalledTimes(2);
    expect(inflateSyncSpy).not.toHaveBeenCalled();
  });

  it("fails closed for tampered bytes and mismatched persisted identity metadata", async () => {
    const bytes = pngBytes(8, 4);
    const manifest = manifestFor(bytes);
    const tampered = new Uint8Array(bytes);
    tampered[tampered.byteLength - 1] = tampered[tampered.byteLength - 1]! ^ 1;

    repository.getContent.mockResolvedValue({ manifest, payload: tampered });
    await expect(service().getContent("viewer", "work-1", manifest.assetId))
      .rejects.toThrow(/integrity/u);

    repository.getContent.mockResolvedValue({
      manifest: { ...manifest, width: 7 },
      payload: bytes,
    });
    await expect(service().getContent("viewer", "work-1", manifest.assetId))
      .rejects.toThrow(/integrity/u);

    repository.getContent.mockResolvedValue({ manifest, payload: bytes });
    await expect(service().getContent("viewer", "work-1", "b".repeat(64)))
      .rejects.toThrow(/integrity/u);
  });

  it("preserves repository authorization before any content can be returned", async () => {
    repository.getContent.mockRejectedValue(new StudioRasterAssetForbiddenError("view"));

    await expect(service().getContent("outsider", "work-1", "a".repeat(64)))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getContent).toHaveBeenCalledWith(
      "outsider",
      "work-1",
      "a".repeat(64)
    );
    expect(inflateSyncSpy).not.toHaveBeenCalled();
  });

  it("forwards an exact receipt to the narrow orphan-compensation boundary", async () => {
    const bytes = pngBytes(4, 2);
    const manifest = manifestFor(bytes);
    const receipt = { workId: "work-1", ...referenceFrom(manifest) };
    repository.deleteUnreferencedUpload.mockResolvedValue(true);

    await expect(service().deleteUnreferencedUpload("editor", receipt)).resolves.toBe(true);
    expect(repository.deleteUnreferencedUpload).toHaveBeenCalledWith("editor", receipt);
  });

  it("batch-validates exact stored references before a durable CRDT append", async () => {
    const bytes = pngBytes(4, 2);
    const manifest = manifestFor(bytes);
    const reference = referenceFrom(manifest);
    repository.getManifests.mockResolvedValue([manifest]);
    await expect(service().assertReferencesStored(
      "editor",
      "work-1",
      [reference, structuredClone(reference)]
    )).resolves.toBeUndefined();
    expect(repository.getManifests).toHaveBeenCalledWith(
      "editor",
      "work-1",
      [manifest.assetId]
    );

    repository.getManifests.mockResolvedValue([]);
    await expect(service().assertReferencesStored("editor", "work-1", [reference]))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service().assertReferencesStored("editor", "work-1", [{
      ...reference,
      assetId: "not-a-content-address",
    }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("reuses the active CRDT append transaction for raster admission", async () => {
    const bytes = pngBytes(4, 2);
    const manifest = manifestFor(bytes);
    const reference = referenceFrom(manifest);
    const transaction = {} as DrizzleStudioCrdtTransaction;
    repository.getManifestsInTransaction.mockResolvedValue([manifest]);

    await expect(service().assertReferencesStored(
      "editor",
      "work-1",
      [reference],
      transaction
    )).resolves.toBeUndefined();

    expect(repository.getManifestsInTransaction).toHaveBeenCalledWith(
      transaction,
      "editor",
      "work-1",
      [manifest.assetId]
    );
    expect(repository.getManifests).not.toHaveBeenCalled();
  });

  it("rejects conflicting duplicate IDs and overlarge validation batches before storage access", async () => {
    const bytes = pngBytes();
    const manifest = manifestFor(bytes);
    const reference = referenceFrom(manifest);
    await expect(service().assertReferencesStored("editor", "work-1", [
      reference,
      { ...reference, width: 2 },
    ])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().assertReferencesStored(
      "editor",
      "work-1",
      Array.from(
        { length: STUDIO_RASTER_ASSET_MAX_REFERENCES_PER_VALIDATION + 1 },
        () => reference
      )
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getManifests).not.toHaveBeenCalled();
  });

  it.each([
    [new StudioRasterAssetNotFoundError(), NotFoundException],
    [new StudioRasterAssetForbiddenError("view"), ForbiddenException],
    [new StudioRasterAssetImmutableConflictError(), ConflictException],
    [new StudioRasterAssetQuotaError("bytes"), PayloadTooLargeException],
    [new StudioRasterAssetCleanupOwnershipError(), ForbiddenException],
    [new StudioRasterAssetReferencedError(), ConflictException],
  ] as const)("maps repository boundary %s to a public HTTP error", async (error, expected) => {
    repository.getManifest.mockRejectedValue(error);
    await expect(service().getManifest("viewer", "work-1", "a".repeat(64)))
      .rejects.toBeInstanceOf(expected);
  });
});
