import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Image, encodePng } from "image-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN,
  type StudioWorkAssetManifest,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";

import {
  StudioWorkAssetCleanupOwnershipError,
  StudioWorkAssetForbiddenError,
  StudioWorkAssetImmutableConflictError,
  StudioWorkAssetNotFoundError,
  StudioWorkAssetQuotaError,
  StudioWorkAssetReferencedError,
  StudioWorkAssetStorageReferenceConflictError,
  StudioWorkAssetStorageReferenceNotFoundError,
  StudioWorkAssetTypeConflictError,
} from "./studio-work-asset.repository";
import {
  admitStudioWorkAssetPayload,
  readStudioWorkAssetImageDimensions,
  StudioWorkAssetService,
} from "./studio-work-asset.service";

import type { DrizzleStudioCrdtTransaction } from "./studio-crdt.repository";
import type { StudioWorkAssetRepository } from "./studio-work-asset.repository";
import type { SupabaseObjectStoragePort } from "../../infrastructure/supabase-object-storage/supabase-object-storage.port";

const manifest: StudioWorkAssetManifest = {
  version: 1,
  assetId: "asset-1",
  elementType: "image",
  mimeType: "image/png",
  byteSize: 8,
  sha256: "4c4b6a3be1314ab86138bef4314dde022d62b81efafc9b14ff126b34a22e7f20",
  intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
  descriptor: {
    version: 1,
    element: {
      id: "asset-1",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
    },
  },
  updatedAt: "2026-07-16T00:00:00.000Z",
};

const repository = {
  assertCanEditWork: vi.fn(),
  assertCanStoreGeneratedObject: vi.fn(),
  findReusableStorageObject: vi.fn(),
  upsert: vi.fn(),
  upsertBatch: vi.fn(),
  getManifest: vi.fn(),
  getManifests: vi.fn(),
  getContents: vi.fn(),
  getManifestsInTransaction: vi.fn(),
  getContentsInTransaction: vi.fn(),
  getContent: vi.fn(),
  getStorageReference: vi.fn(),
  registerGeneratedStorageReference: vi.fn(),
  listGeneratedStorageReferencesForWorkDeletion: vi.fn(),
  beginGeneratedStorageReferenceDelete: vi.fn(),
  completeGeneratedStorageReferenceDelete: vi.fn(),
  deleteUnreferencedUpload: vi.fn(),
};

const objectStorage = {
  verifyPrivatePurposeBuckets: vi.fn(),
  uploadImmutable: vi.fn(),
  createSignedReadUrl: vi.fn(),
  deleteGeneratedObject: vi.fn(),
};

function service(
  storage: SupabaseObjectStoragePort = objectStorage as unknown as SupabaseObjectStoragePort,
): StudioWorkAssetService {
  return new StudioWorkAssetService(
    repository as unknown as StudioWorkAssetRepository,
    storage,
  );
}

function pngBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

function rgbaPng(
  width: number,
  height: number,
  values: readonly number[]
): Uint8Array {
  return encodePng(new Image(width, height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: Uint8Array.from(values),
  }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storageObject(
  purpose: "source" | "derived" | "export",
  bytes: Uint8Array,
  contentType = "image/png",
) {
  const digest = sha256(bytes);
  return {
    contractVersion: "toonspectrum.supabase-object-storage.v1" as const,
    purpose,
    digest: `sha256:${digest}` as const,
    objectPath: `sha256/${digest.slice(0, 2)}/${digest}` as const,
    byteLength: bytes.byteLength,
    contentType,
  };
}

function apngBytes(): Uint8Array {
  const base = pngBytes();
  const bytes = new Uint8Array(base.byteLength + 20);
  bytes.set(base.subarray(0, 33));
  const view = new DataView(bytes.buffer);
  view.setUint32(33, 8, false);
  bytes.set([0x61, 0x63, 0x54, 0x4c], 37);
  view.setUint32(41, 2, false);
  view.setUint32(45, 0, false);
  bytes.set(base.subarray(33), 53);
  return bytes;
}

function gifBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function jpegBytes(width = 1, height = 1): Uint8Array {
  return Uint8Array.of(
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x0b,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9
  );
}

function webpBytes(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 22, true);
  view.setUint32(16, 10, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set([
    widthMinusOne & 0xff,
    (widthMinusOne >> 8) & 0xff,
    (widthMinusOne >> 16) & 0xff,
  ], 24);
  bytes.set([
    heightMinusOne & 0xff,
    (heightMinusOne >> 8) & 0xff,
    (heightMinusOne >> 16) & 0xff,
  ], 27);
  return bytes;
}

function glb(document: Record<string, unknown>): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(raw.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(raw, 20);
  return bytes;
}

describe("studio work asset binary admission", () => {
  it("sniffs image bytes, canonicalizes MIME, hashes, and copies the caller buffer", () => {
    const bytes = pngBytes();
    const admitted = admitStudioWorkAssetPayload("image", "application/octet-stream", bytes);
    expect(admitted.mimeType).toBe("image/png");
    expect(admitted.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(admitted.payload).toEqual(bytes);
    expect(admitted.payload).not.toBe(bytes);
    expect(admitted.intrinsicImage).toEqual({ width: 1, height: 1, decodedRgbaBytes: 4 });
    bytes[0] = 0;
    expect(admitted.payload[0]).toBe(0x89);
  });

  it("rejects extension/MIME spoofing before persistence", () => {
    expect(() => admitStudioWorkAssetPayload("image", "image/jpeg", pngBytes()))
      .toThrow(/MIME/u);
    expect(() => admitStudioWorkAssetPayload("image", "image/svg+xml", new TextEncoder().encode("<svg/>")))
      .toThrow(/PNG/u);
  });

  it("reads bounded logical dimensions from every admitted static raster header", () => {
    expect(readStudioWorkAssetImageDimensions("image/png", pngBytes(320, 240)))
      .toEqual({ width: 320, height: 240 });
    expect(readStudioWorkAssetImageDimensions("image/jpeg", jpegBytes(800, 600)))
      .toEqual({ width: 800, height: 600 });
    expect(readStudioWorkAssetImageDimensions("image/webp", webpBytes(1024, 768)))
      .toEqual({ width: 1024, height: 768 });
  });

  it("rejects GIF, animated PNG, and animated WebP before decoder amplification", () => {
    expect(() => admitStudioWorkAssetPayload("image", "image/gif", gifBytes()))
      .toThrow(/GIF/u);
    expect(() => admitStudioWorkAssetPayload("image", "image/png", apngBytes()))
      .toThrow(/APNG/u);
    const animatedWebp = webpBytes();
    animatedWebp[20] = 0x02;
    expect(() => admitStudioWorkAssetPayload("image", "image/webp", animatedWebp))
      .toThrow(/움직이는 WebP/u);
  });

  it("rejects truncated, zero-sized, over-axis, and decompression-bomb dimensions", () => {
    expect(() => admitStudioWorkAssetPayload(
      "image",
      "image/png",
      pngBytes().subarray(0, 24)
    )).toThrow(/잘렸/u);
    expect(() => admitStudioWorkAssetPayload("image", "image/png", pngBytes(0, 10)))
      .toThrow(/이하/u);
    expect(() => admitStudioWorkAssetPayload("image", "image/png", pngBytes(16_385, 1)))
      .toThrow(/16,384px/u);
    expect(() => admitStudioWorkAssetPayload("image", "image/png", pngBytes(4_097, 4_097)))
      .toThrow(/16MP/u);
  });

  it("accepts embedded GLB and requires a real VRM extension for VRM assets", () => {
    const vrm = glb({
      asset: { version: "2.0" },
      extensionsUsed: ["VRMC_vrm"],
      extensions: { VRMC_vrm: { specVersion: "1.0" } },
    });
    expect(admitStudioWorkAssetPayload("vrm", "application/vrm", vrm).mimeType)
      .toBe("model/gltf-binary");
    expect(admitStudioWorkAssetPayload("background3d", "model/gltf-binary", vrm).mimeType)
      .toBe("model/gltf-binary");
    expect(() => admitStudioWorkAssetPayload(
      "vrm",
      "model/gltf-binary",
      glb({ asset: { version: "2.0" } })
    )).toThrow(/VRM/u);
  });

  it("rejects GLB files that could fetch external resources", () => {
    expect(() => admitStudioWorkAssetPayload(
      "background3d",
      "model/gltf-binary",
      glb({ asset: { version: "2.0" }, images: [{ uri: "https://private.example/texture.png" }] })
    )).toThrow(/외부 리소스/u);
  });
});

describe("StudioWorkAssetService", () => {
  beforeEach(() => {
    process.env.STUDIO_WORK_ASSET_ADMISSION =
      STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN;
    repository.assertCanEditWork.mockReset().mockResolvedValue(undefined);
    repository.assertCanStoreGeneratedObject.mockReset().mockResolvedValue(undefined);
    repository.findReusableStorageObject.mockReset().mockResolvedValue(null);
    repository.upsert.mockReset();
    repository.upsertBatch.mockReset();
    repository.getManifest.mockReset();
    repository.getManifests.mockReset();
    repository.getContents.mockReset();
    repository.getManifestsInTransaction.mockReset();
    repository.getContentsInTransaction.mockReset();
    repository.getContent.mockReset();
    repository.getStorageReference.mockReset();
    repository.registerGeneratedStorageReference.mockReset();
    repository.listGeneratedStorageReferencesForWorkDeletion
      .mockReset()
      .mockResolvedValue([]);
    repository.beginGeneratedStorageReferenceDelete.mockReset();
    repository.completeGeneratedStorageReferenceDelete.mockReset();
    repository.deleteUnreferencedUpload.mockReset();
    objectStorage.verifyPrivatePurposeBuckets.mockReset().mockResolvedValue({
      ready: true,
      privatePurposeBuckets: 3,
    });
    objectStorage.uploadImmutable.mockReset().mockImplementation(
      (input: { purpose: "source" | "derived" | "export"; bytes: Uint8Array; contentType: string }) =>
        Promise.resolve(storageObject(input.purpose, input.bytes, input.contentType)),
    );
    objectStorage.createSignedReadUrl.mockReset().mockImplementation(
      (input: { expiresInSeconds: number }) => Promise.resolve({
        url: "https://project.supabase.co/storage/v1/object/sign/source/path?token=abcdefghijklmnop",
        expiresAtEpochMs: Date.now() + input.expiresInSeconds * 1_000,
      }),
    );
    objectStorage.deleteGeneratedObject.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.STUDIO_WORK_ASSET_ADMISSION;
  });

  it("keeps every work-asset upload default-off without the exact server opt-in token", async () => {
    delete process.env.STUDIO_WORK_ASSET_ADMISSION;
    const bytes = Buffer.from(pngBytes());
    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      "{}",
      undefined
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(repository.upsertBatch).not.toHaveBeenCalled();
  });

  it("validates exact descriptor identity and never sends data URLs to the repository", async () => {
    repository.upsert.mockResolvedValue(manifest);
    const bytes = Buffer.from(pngBytes());
    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" }
    )).resolves.toEqual(manifest);
    expect(repository.upsert).toHaveBeenCalledWith("editor", expect.objectContaining({
      workId: "work-1",
      assetId: "asset-1",
      elementType: "image",
      mimeType: "image/png",
      descriptor: manifest.descriptor,
      storageObject: storageObject("source", bytes),
    }));
    expect(repository.assertCanEditWork).toHaveBeenCalledWith("editor", "work-1");
    expect(objectStorage.verifyPrivatePurposeBuckets).toHaveBeenCalledOnce();
    expect(objectStorage.uploadImmutable).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "source",
      contentType: "image/png",
      bytes: expect.any(Uint8Array),
      controlMetadata: expect.objectContaining({
        documentId: expect.stringMatching(/^work:[0-9a-f]{64}$/u),
        operationId: expect.stringMatching(/^source-upload:[0-9a-f]{64}$/u),
      }),
    }));

    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify({
        ...manifest.descriptor,
        element: { ...manifest.descriptor.element, src: "data:image/png;base64,private" },
      }),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.upsert).toHaveBeenCalledTimes(1);
  });

  it("fails closed before database persistence when private storage or upload integrity fails", async () => {
    const bytes = Buffer.from(pngBytes());
    objectStorage.verifyPrivatePurposeBuckets.mockRejectedValueOnce(new Error("bucket public"));
    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(objectStorage.uploadImmutable).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();

    objectStorage.uploadImmutable.mockResolvedValueOnce({
      ...storageObject("source", bytes),
      contentType: "image/jpeg",
    });
    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("reuses only an exact active immutable source object", async () => {
    const bytes = Buffer.from(pngBytes());
    const expected = storageObject("source", bytes);
    repository.findReusableStorageObject.mockResolvedValueOnce(expected);
    repository.upsert.mockResolvedValueOnce(manifest);

    await service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" },
    );

    expect(objectStorage.uploadImmutable).not.toHaveBeenCalled();
    expect(repository.upsert).toHaveBeenCalledWith(
      "editor",
      expect.objectContaining({ storageObject: expected }),
    );
  });

  it("registers generated objects against an authorized source and forbids source purpose", async () => {
    const bytes = Buffer.from(pngBytes());
    const object = storageObject("derived", bytes);
    const reference = {
      workId: "work-1",
      sourceAssetId: "asset-1",
      referenceId: "preview-1",
      object,
    };
    repository.registerGeneratedStorageReference.mockResolvedValueOnce(reference);

    await expect(service().uploadGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "derived",
      "preview-1",
      "image",
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" },
    )).resolves.toEqual(reference);
    expect(repository.assertCanStoreGeneratedObject).toHaveBeenCalledWith(
      "editor",
      "work-1",
      "asset-1",
    );
    expect(repository.registerGeneratedStorageReference).toHaveBeenCalledWith(
      "editor",
      reference,
      true,
    );

    await expect(service().uploadGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "source" as never,
      "preview-1",
      "image",
      { buffer: bytes, size: bytes.byteLength, mimetype: "image/png" },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("authorizes signed reads from the active DB reference and caps them at five minutes", async () => {
    const bytes = pngBytes();
    const reference = {
      workId: "work-1",
      sourceAssetId: "asset-1",
      referenceId: "asset-1",
      object: storageObject("source", bytes),
    };
    repository.getStorageReference.mockResolvedValue(reference);

    await expect(service().createSourceSignedReadUrl(
      "viewer",
      "work-1",
      "asset-1",
      "image",
      300,
    )).resolves.toMatchObject({ reference });
    expect(repository.getStorageReference).toHaveBeenCalledWith(
      "viewer",
      "work-1",
      "asset-1",
      "source",
      "asset-1",
      "image",
    );
    expect(objectStorage.createSignedReadUrl).toHaveBeenCalledWith({
      object: reference.object,
      expiresInSeconds: 300,
    });

    repository.getStorageReference.mockClear();
    await expect(service().createSourceSignedReadUrl(
      "viewer",
      "work-1",
      "asset-1",
      "image",
      301,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getStorageReference).not.toHaveBeenCalled();

    objectStorage.createSignedReadUrl.mockResolvedValueOnce({
      url: "https://project.supabase.co/storage/v1/object/sign/source/path?token=abcdefghijklmnop",
      expiresAtEpochMs: Date.now() + 600_000,
    });
    await expect(service().createSourceSignedReadUrl(
      "viewer",
      "work-1",
      "asset-1",
      "image",
      60,
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("keeps the optional Nest storage injection fail-closed when it is not configured", async () => {
    const reference = {
      workId: "work-1",
      sourceAssetId: "asset-1",
      referenceId: "asset-1",
      object: storageObject("source", pngBytes()),
    };
    repository.getStorageReference.mockResolvedValueOnce(reference);
    const withoutStorage = new StudioWorkAssetService(
      repository as unknown as StudioWorkAssetRepository,
    );

    await expect(withoutStorage.getSourceStorageReference(
      "viewer",
      "work-1",
      "asset-1",
      "image",
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("deletes only generated objects and finalizes the DB state after remote acknowledgement", async () => {
    const reference = {
      workId: "work-1",
      sourceAssetId: "asset-1",
      referenceId: "preview-1",
      object: storageObject("derived", pngBytes()),
    };
    const plan = {
      reference,
      deleteToken: "11111111-1111-4111-8111-111111111111",
      remoteDeleteRequired: true,
    };
    repository.beginGeneratedStorageReferenceDelete.mockResolvedValueOnce(plan);
    repository.completeGeneratedStorageReferenceDelete.mockResolvedValueOnce(undefined);

    await expect(service().deleteGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "derived",
      "preview-1",
      reference.object.digest,
    )).resolves.toEqual({ deleted: true, remoteObjectDeleted: true });
    expect(objectStorage.deleteGeneratedObject).toHaveBeenCalledWith({
      object: reference.object,
    });
    expect(repository.completeGeneratedStorageReferenceDelete).toHaveBeenCalledWith(plan);

    repository.beginGeneratedStorageReferenceDelete.mockResolvedValueOnce(plan);
    repository.completeGeneratedStorageReferenceDelete.mockClear();
    objectStorage.deleteGeneratedObject.mockRejectedValueOnce(new Error("timeout"));
    await expect(service().deleteGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "derived",
      "preview-1",
      reference.object.digest,
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.completeGeneratedStorageReferenceDelete).not.toHaveBeenCalled();

    repository.beginGeneratedStorageReferenceDelete.mockClear();
    await expect(service().deleteGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "source" as never,
      "asset-1",
      storageObject("source", pngBytes()).digest,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.beginGeneratedStorageReferenceDelete).not.toHaveBeenCalled();
  });

  it("removes only the DB reference when another generated reference retains the object", async () => {
    const reference = {
      workId: "work-1",
      sourceAssetId: "asset-1",
      referenceId: "preview-1",
      object: storageObject("export", pngBytes()),
    };
    repository.beginGeneratedStorageReferenceDelete.mockResolvedValueOnce({
      reference,
      deleteToken: null,
      remoteDeleteRequired: false,
    });

    await expect(service().deleteGeneratedObject(
      "editor",
      "work-1",
      "asset-1",
      "export",
      "preview-1",
      reference.object.digest,
    )).resolves.toEqual({ deleted: true, remoteObjectDeleted: false });
    expect(objectStorage.deleteGeneratedObject).not.toHaveBeenCalled();
    expect(repository.completeGeneratedStorageReferenceDelete).not.toHaveBeenCalled();
  });

  it("drains active and retryable generated references before work deletion", async () => {
    const sharedObject = storageObject("derived", pngBytes());
    const first = {
      workId: "work-delete",
      sourceAssetId: "asset-1",
      referenceId: "preview-a",
      object: sharedObject,
    };
    const last = { ...first, referenceId: "preview-b" };
    repository.listGeneratedStorageReferencesForWorkDeletion
      .mockResolvedValueOnce([first, last])
      .mockResolvedValueOnce([]);
    repository.beginGeneratedStorageReferenceDelete
      .mockResolvedValueOnce({
        reference: first,
        deleteToken: null,
        remoteDeleteRequired: false,
      })
      .mockResolvedValueOnce({
        reference: last,
        deleteToken: "22222222-2222-4222-8222-222222222222",
        remoteDeleteRequired: true,
      });
    repository.completeGeneratedStorageReferenceDelete.mockResolvedValueOnce(undefined);

    await expect(service().deleteGeneratedObjectsForWork(
      "owner",
      "work-delete",
      false,
    )).resolves.toBe(2);
    expect(repository.listGeneratedStorageReferencesForWorkDeletion)
      .toHaveBeenNthCalledWith(1, "owner", "work-delete", false);
    expect(repository.beginGeneratedStorageReferenceDelete).toHaveBeenNthCalledWith(
      2,
      "owner",
      {
        workId: "work-delete",
        sourceAssetId: "asset-1",
        purpose: "derived",
        referenceId: "preview-b",
        expectedDigest: sharedObject.digest,
      },
      false,
    );
    expect(objectStorage.verifyPrivatePurposeBuckets).toHaveBeenCalledOnce();
    expect(objectStorage.deleteGeneratedObject).toHaveBeenCalledOnce();
    expect(repository.completeGeneratedStorageReferenceDelete).toHaveBeenCalledOnce();
  });

  it("validates both role-bound PNGs before one ordered atomic repository batch", async () => {
    const backgroundBytes = pngBytes(2, 1);
    const foregroundBytes = pngBytes(1, 2);
    const batchId = "11111111-1111-4111-8111-111111111111";
    const metadata = {
      version: 1,
      batchId,
      assets: [
        {
          role: "background",
          assetId: "lift-background",
          descriptor: {
            ...manifest.descriptor,
            element: {
              ...manifest.descriptor.element,
              id: "lift-background",
              width: 2,
              height: 1,
            },
          },
          expectedSha256: sha256(backgroundBytes),
          byteSize: backgroundBytes.byteLength,
          width: 2,
          height: 1,
        },
        {
          role: "foreground",
          assetId: "lift-foreground",
          descriptor: {
            ...manifest.descriptor,
            element: {
              ...manifest.descriptor.element,
              id: "lift-foreground",
              width: 1,
              height: 2,
            },
          },
          expectedSha256: sha256(foregroundBytes),
          byteSize: foregroundBytes.byteLength,
          width: 1,
          height: 2,
        },
      ],
    };
    const stored = metadata.assets.map((entry) => ({
      version: 1 as const,
      assetId: entry.assetId,
      elementType: "image" as const,
      mimeType: "image/png" as const,
      byteSize: entry.byteSize,
      sha256: entry.expectedSha256,
      intrinsicImage: {
        width: entry.width,
        height: entry.height,
        decodedRgbaBytes: entry.width * entry.height * 4,
      },
      descriptor: entry.descriptor,
      updatedAt: "2026-07-16T00:00:00.000Z",
    }));
    repository.upsertBatch.mockResolvedValue(stored);
    const files = {
      background: [{
        buffer: Buffer.from(backgroundBytes),
        size: backgroundBytes.byteLength,
        mimetype: "image/png",
      }],
      foreground: [{
        buffer: Buffer.from(foregroundBytes),
        size: foregroundBytes.byteLength,
        mimetype: "image/png",
      }],
    };

    const first = await service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      JSON.stringify(metadata),
      files
    );
    const retry = await service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      JSON.stringify(metadata),
      files
    );

    expect(first).toEqual({
      version: 1,
      batchId,
      assets: [
        { role: "background", manifest: stored[0] },
        { role: "foreground", manifest: stored[1] },
      ],
    });
    expect(retry).toEqual(first);
    expect(repository.upsertBatch).toHaveBeenCalledTimes(2);
    for (const call of repository.upsertBatch.mock.calls) {
      expect(call[0]).toBe("editor");
      expect(call[1].map((write: { assetId: string }) => write.assetId)).toEqual([
        "lift-background",
        "lift-foreground",
      ]);
    }

    repository.upsertBatch.mockResolvedValueOnce([
      stored[0]!,
      {
        ...stored[1]!,
        descriptor: {
          ...stored[1]!.descriptor,
          element: {
            ...stored[1]!.descriptor.element,
            x: stored[1]!.descriptor.element.x + 1,
          },
        },
      },
    ]);
    await expect(service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      JSON.stringify(metadata),
      files
    )).rejects.toThrow(/receipt identity mismatch/u);
  });

  it("never starts persistence when either layer-lift PNG fails its exact binding", async () => {
    const backgroundBytes = pngBytes(1, 1);
    const foregroundBytes = pngBytes(1, 1);
    const metadata = {
      version: 1,
      batchId: "22222222-2222-4222-8222-222222222222",
      assets: [
        {
          role: "background",
          assetId: "lift-background",
          descriptor: {
            ...manifest.descriptor,
            element: { ...manifest.descriptor.element, id: "lift-background" },
          },
          expectedSha256: sha256(backgroundBytes),
          byteSize: backgroundBytes.byteLength,
          width: 1,
          height: 1,
        },
        {
          role: "foreground",
          assetId: "lift-foreground",
          descriptor: {
            ...manifest.descriptor,
            element: { ...manifest.descriptor.element, id: "lift-foreground" },
          },
          expectedSha256: "f".repeat(64),
          byteSize: foregroundBytes.byteLength,
          width: 1,
          height: 1,
        },
      ],
    };
    const files = {
      background: [{
        buffer: Buffer.from(backgroundBytes),
        size: backgroundBytes.byteLength,
        mimetype: "image/png",
      }],
      foreground: [{
        buffer: Buffer.from(foregroundBytes),
        size: foregroundBytes.byteLength,
        mimetype: "image/png",
      }],
    };

    await expect(service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      JSON.stringify(metadata),
      files
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.upsertBatch).not.toHaveBeenCalled();
  });

  it("rejects missing, extra, or non-PNG layer-lift multipart roles before persistence", async () => {
    const bytes = pngBytes();
    const entry = (role: "background" | "foreground", assetId: string) => ({
      role,
      assetId,
      descriptor: {
        ...manifest.descriptor,
        element: { ...manifest.descriptor.element, id: assetId },
      },
      expectedSha256: sha256(bytes),
      byteSize: bytes.byteLength,
      width: 1,
      height: 1,
    });
    const metadata = JSON.stringify({
      version: 1,
      batchId: "33333333-3333-4333-8333-333333333333",
      assets: [
        entry("background", "lift-background"),
        entry("foreground", "lift-foreground"),
      ],
    });
    const file = {
      buffer: Buffer.from(bytes),
      size: bytes.byteLength,
      mimetype: "image/png",
    };

    await expect(service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      metadata,
      { background: [file] }
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().uploadLayerLiftBatch(
      "editor",
      "work-1",
      metadata,
      {
        background: [file],
        foreground: [{ ...file, mimetype: "image/jpeg" }],
        extra: [file],
      } as never
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.upsertBatch).not.toHaveBeenCalled();
  });

  it("rejects missing or inconsistent multipart files", async () => {
    await expect(service().upload(
      "editor", "work-1", "asset-1", "image", JSON.stringify(manifest.descriptor), undefined
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().upload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      JSON.stringify(manifest.descriptor),
      { buffer: Buffer.from(pngBytes()), size: 999, mimetype: "image/png" }
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("revalidates at-rest payload size and SHA-256 before streaming", async () => {
    const payload = pngBytes(2, 2);
    const admitted = admitStudioWorkAssetPayload("image", "image/png", payload);
    const storedManifest = {
      ...manifest,
      byteSize: payload.byteLength,
      sha256: admitted.sha256,
      intrinsicImage: admitted.intrinsicImage,
    };
    repository.getContent.mockResolvedValue({ manifest: storedManifest, payload });
    await expect(service().getContent("viewer", "work-1", "asset-1", "image"))
      .resolves.toEqual({ manifest: storedManifest, payload });

    repository.getContent.mockResolvedValue({
      manifest: { ...storedManifest, sha256: "b".repeat(64) },
      payload,
    });
    await expect(service().getContent("viewer", "work-1", "asset-1", "image"))
      .rejects.toThrow(/integrity/u);
  });

  it("batch-validates authorized immutable identities for durable CRDT admission", async () => {
    repository.getManifests.mockResolvedValue([manifest]);
    await expect(service().assertReferencesStored("editor", "work-1", [
      { assetId: "asset-1", elementType: "image" },
      { assetId: "asset-1", elementType: "image" },
    ])).resolves.toBeUndefined();
    expect(repository.getManifests).toHaveBeenCalledWith(
      "editor",
      "work-1",
      ["asset-1"]
    );

    repository.getManifests.mockResolvedValue([]);
    await expect(service().assertReferencesStored("editor", "work-1", [
      { assetId: "asset-1", elementType: "image" },
    ])).rejects.toBeInstanceOf(BadRequestException);

    repository.getManifests.mockResolvedValue([{
      ...manifest,
      elementType: "vrm",
      mimeType: "model/gltf-binary",
      intrinsicImage: null,
      descriptor: {
        ...manifest.descriptor,
        element: { ...manifest.descriptor.element, type: "vrm" },
      },
    }]);
    await expect(service().assertReferencesStored("editor", "work-1", [
      { assetId: "asset-1", elementType: "image" },
    ])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("binds R8 CRDT references to the exact stored and decoded PNG identity", async () => {
    const encoded = rgbaPng(2, 1, [
      255, 0, 0, 40,
      0, 255, 0, 230,
    ]);
    const decoded = Uint8Array.of(40, 230);
    const storedManifest: StudioWorkAssetManifest = {
      ...manifest,
      assetId: "paper-r8",
      byteSize: encoded.byteLength,
      sha256: sha256(encoded),
      intrinsicImage: { width: 2, height: 1, decodedRgbaBytes: 8 },
      descriptor: {
        ...manifest.descriptor,
        element: {
          ...manifest.descriptor.element,
          id: "paper-r8",
          width: 2,
          height: 1,
        },
      },
    };
    const source = {
      kind: "r8-texture-v1",
      asset: {
        assetId: storedManifest.assetId,
        encodedSha256: `sha256:${storedManifest.sha256}`,
        decodedSha256: `sha256:${sha256(decoded)}`,
        byteLength: storedManifest.byteSize,
        mediaType: "image/png",
        width: storedManifest.intrinsicImage!.width,
        height: storedManifest.intrinsicImage!.height,
        channel: "alpha",
        encoding: "r8-unorm",
      },
    } as const;
    repository.getManifests.mockResolvedValue([storedManifest]);
    repository.getContents.mockResolvedValue([{
      manifest: storedManifest,
      payload: Uint8Array.from(encoded),
    }]);

    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [source, source],
    )).resolves.toBeUndefined();
    expect(repository.getContents).toHaveBeenCalledWith(
      "editor",
      "work-1",
      [storedManifest.assetId],
    );

    repository.getManifests.mockResolvedValueOnce([{
      ...storedManifest,
      intrinsicImage: { width: 3, height: 1, decodedRgbaBytes: 12 },
    }]);
    repository.getContents.mockClear();
    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [source],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getContents).not.toHaveBeenCalled();

    for (const mismatchedManifest of [
      { ...storedManifest, sha256: "a".repeat(64) },
      { ...storedManifest, byteSize: storedManifest.byteSize + 1 },
      {
        ...storedManifest,
        intrinsicImage: {
          ...storedManifest.intrinsicImage!,
          width: storedManifest.intrinsicImage!.width + 1,
          decodedRgbaBytes: (storedManifest.intrinsicImage!.width + 1)
            * storedManifest.intrinsicImage!.height
            * 4,
        },
      },
    ]) {
      repository.getContents.mockResolvedValueOnce([{
        manifest: mismatchedManifest,
        payload: Uint8Array.from(encoded),
      }]);
      await expect(service().assertR8GrainReferencesStored(
        "editor",
        "work-1",
        [source],
      )).rejects.toBeInstanceOf(BadRequestException);
    }

    const corrupted = Uint8Array.from(encoded);
    corrupted[corrupted.length - 1] ^= 1;
    repository.getContents.mockResolvedValueOnce([{
      manifest: storedManifest,
      payload: corrupted,
    }]);
    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [source],
    )).rejects.toBeInstanceOf(BadRequestException);

    repository.getContents.mockClear();
    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [
        source,
        {
          ...source,
          asset: {
            ...source.asset,
            decodedSha256: `sha256:${sha256(Uint8Array.of(41, 230))}`,
          },
        },
      ],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getContents).not.toHaveBeenCalled();
  });

  it("rejects aggregate R8 decode work before manifest or binary storage reads", async () => {
    const source = (assetId: string) => ({
      kind: "r8-texture-v1",
      asset: {
        assetId,
        encodedSha256: `sha256:${"a".repeat(64)}`,
        decodedSha256: `sha256:${"b".repeat(64)}`,
        byteLength: 40 * 1024 * 1024,
        mediaType: "image/png",
        width: 1,
        height: 1,
        channel: "alpha",
        encoding: "r8-unorm",
      },
    } as const);

    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [source("paper-budget-a"), source("paper-budget-b")]
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getManifests).not.toHaveBeenCalled();
    expect(repository.getContents).not.toHaveBeenCalled();
  });

  it("keeps new durable work-asset references default-off without the server opt-in token", async () => {
    delete process.env.STUDIO_WORK_ASSET_ADMISSION;
    await expect(service().assertReferencesStored("editor", "work-1", [
      { assetId: "asset-1", elementType: "image" },
    ])).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getManifests).not.toHaveBeenCalled();
  });

  it("reuses the active CRDT append transaction for storage admission", async () => {
    const transaction = {} as DrizzleStudioCrdtTransaction;
    repository.getManifestsInTransaction.mockResolvedValue([manifest]);

    await expect(service().assertReferencesStored(
      "editor",
      "work-1",
      [{ assetId: "asset-1", elementType: "image" }],
      transaction
    )).resolves.toBeUndefined();

    expect(repository.getManifestsInTransaction).toHaveBeenCalledWith(
      transaction,
      "editor",
      "work-1",
      ["asset-1"]
    );
    expect(repository.getManifests).not.toHaveBeenCalled();
  });

  it("reads and decodes R8 bytes inside the active CRDT append transaction", async () => {
    const transaction = {} as DrizzleStudioCrdtTransaction;
    const encoded = rgbaPng(1, 1, [10, 20, 30, 180]);
    const decoded = Uint8Array.of(180);
    const storedManifest: StudioWorkAssetManifest = {
      ...manifest,
      assetId: "paper-transaction",
      byteSize: encoded.byteLength,
      sha256: sha256(encoded),
      intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
      descriptor: {
        ...manifest.descriptor,
        element: {
          ...manifest.descriptor.element,
          id: "paper-transaction",
        },
      },
    };
    const source = {
      kind: "r8-texture-v1",
      asset: {
        assetId: storedManifest.assetId,
        encodedSha256: `sha256:${storedManifest.sha256}`,
        decodedSha256: `sha256:${sha256(decoded)}`,
        byteLength: encoded.byteLength,
        mediaType: "image/png",
        width: 1,
        height: 1,
        channel: "alpha",
        encoding: "r8-unorm",
      },
    } as const;
    repository.getManifestsInTransaction.mockResolvedValue([storedManifest]);
    repository.getContentsInTransaction.mockResolvedValue([{
      manifest: storedManifest,
      payload: Uint8Array.from(encoded),
    }]);

    await expect(service().assertR8GrainReferencesStored(
      "editor",
      "work-1",
      [source],
      transaction
    )).resolves.toBeUndefined();

    expect(repository.getContentsInTransaction).toHaveBeenCalledWith(
      transaction,
      "editor",
      "work-1",
      ["paper-transaction"]
    );
    expect(repository.getContents).not.toHaveBeenCalled();
    expect(repository.getManifestsInTransaction).toHaveBeenCalledWith(
      transaction,
      "editor",
      "work-1",
      ["paper-transaction"]
    );
  });

  it("forwards exact receipt-bound cleanup and returns its idempotent outcome", async () => {
    repository.deleteUnreferencedUpload.mockResolvedValue(true);
    await expect(service().deleteUnreferencedUpload(
      "editor",
      "work-1",
      "asset-1",
      "image",
      "a".repeat(64)
    )).resolves.toBe(true);
    expect(repository.deleteUnreferencedUpload).toHaveBeenCalledWith(
      "editor",
      "work-1",
      "asset-1",
      "image",
      "a".repeat(64)
    );
  });

  it.each([
    [new StudioWorkAssetNotFoundError(), NotFoundException],
    [new StudioWorkAssetForbiddenError("view"), ForbiddenException],
    [new StudioWorkAssetTypeConflictError(), ConflictException],
    [new StudioWorkAssetImmutableConflictError(), ConflictException],
    [new StudioWorkAssetCleanupOwnershipError(), ForbiddenException],
    [new StudioWorkAssetReferencedError(), ConflictException],
    [new StudioWorkAssetStorageReferenceNotFoundError(), NotFoundException],
    [new StudioWorkAssetStorageReferenceConflictError(), ConflictException],
    [new StudioWorkAssetQuotaError("bytes"), PayloadTooLargeException],
  ] as const)("maps repository boundary %s to a public HTTP error", async (error, expected) => {
    repository.getManifest.mockRejectedValue(error);
    await expect(service().getManifest("viewer", "work-1", "asset-1", "image"))
      .rejects.toBeInstanceOf(expected);
  });
});
