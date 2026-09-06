import { describe, expect, it, vi } from "vitest";

import {
  StudioBg3dCanonicalGlbDownloadError,
  canonicalStudioBg3dGlbFileName,
  downloadCanonicalStudioBg3dGlb,
  type StudioBg3dCanonicalGlbDownloadDependencies,
} from "./studio-bg3d-canonical-glb-download";

import type { Bg3dVerifiedStoredRecord } from "./bg3d-model-library";
import type {
  StudioBg3dGlbMetrics,
  StudioBg3dGlbValidationSuccess,
} from "./studio-bg3d-glb-validation";

const CONTENT_HASH = `sha256:${"a".repeat(64)}` as const;

function canonicalGlbBytes(): Uint8Array {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const paddedJsonBytes = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedJsonBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedJsonBytes, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return bytes;
}

function metrics(byteSize: number): StudioBg3dGlbMetrics {
  return {
    byteSize,
    jsonByteSize: byteSize - 20,
    binByteSize: 0,
    nodes: 0,
    meshes: 0,
    meshPrimitives: 0,
    drawCalls: 0,
    triangles: 0,
    materials: 0,
    textures: 0,
    images: 0,
    imageBytes: 0,
    estimatedDecodedImageBytes: 0,
    maxImageDimension: 0,
    undeterminedImageDimensions: 0,
    lights: 0,
    animations: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    skins: 0,
    joints: 0,
    morphTargets: 0,
    accessorElements: 0,
    estimatedDecodedGeometryBytes: 0,
  };
}

function verifiedRecord(bytes = canonicalGlbBytes()): Bg3dVerifiedStoredRecord {
  const validatorMetrics = metrics(bytes.byteLength);
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  return {
    id: "bg3d-storage-model-1",
    storageVersion: 2,
    name: "서울 거리 배경",
    format: "glb",
    blob: new Blob([blobBuffer], { type: "model/gltf-binary" }),
    thumbnail: null,
    createdAt: 1,
    updatedAt: 1,
    contentHash: CONTENT_HASH,
    byteSize: bytes.byteLength,
    mime: "model/gltf-binary",
    validationVersion: 1,
    validatedAt: 1,
    validatorProfile: "desktop",
    validatorMetrics,
    rights: {
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
    },
  };
}

function validation(record: Bg3dVerifiedStoredRecord, bytes = canonicalGlbBytes()): StudioBg3dGlbValidationSuccess {
  return {
    ok: true,
    code: "valid",
    message: "검증 완료",
    profile: "desktop",
    verifiedSha256: record.contentHash,
    verifiedBytes: bytes,
    cumulativeBytesAfter: bytes.byteLength,
    usesBasisTextures: false,
    requiresBasisTextures: false,
    metrics: metrics(bytes.byteLength),
  };
}

function request(record = verifiedRecord()) {
  return {
    storageId: record.id,
    expectedContentHash: record.contentHash,
    expectedByteSize: record.byteSize,
    expectedName: record.name,
  };
}

function dependencies(
  record = verifiedRecord(),
  patch: Partial<StudioBg3dCanonicalGlbDownloadDependencies> = {},
): StudioBg3dCanonicalGlbDownloadDependencies {
  return {
    getStoredByHash: vi.fn(async () => record),
    revalidateStored: vi.fn(async () => validation(record)),
    createObjectUrl: vi.fn(() => "blob:canonical-glb"),
    revokeObjectUrl: vi.fn(),
    triggerDownload: vi.fn(),
    scheduleObjectUrlRevoke: vi.fn((revoke) => revoke()),
    ...patch,
  };
}

function expectDownloadError(
  cause: unknown,
  code: StudioBg3dCanonicalGlbDownloadError["code"],
): void {
  expect(cause).toBeInstanceOf(StudioBg3dCanonicalGlbDownloadError);
  expect((cause as StudioBg3dCanonicalGlbDownloadError).code).toBe(code);
}

describe("canonicalStudioBg3dGlbFileName", () => {
  it("removes source-format suffixes and unsafe path characters instead of relabeling originals", () => {
    expect(canonicalStudioBg3dGlbFileName("서울/골목.OBJ")).toBe("서울 골목.glb");
    expect(canonicalStudioBg3dGlbFileName("character.fbx")).toBe("character.glb");
    expect(canonicalStudioBg3dGlbFileName("CON")).toBe("3D 모델 CON.glb");
    expect(canonicalStudioBg3dGlbFileName("  <>  ")).toBe("3D 모델.glb");
  });
});

describe("downloadCanonicalStudioBg3dGlb", () => {
  it("re-resolves one canonical record, revalidates it, downloads validator-owned bytes, and revokes the URL", async () => {
    const record = verifiedRecord();
    const verifiedBytes = canonicalGlbBytes();
    const captureBlob = vi.fn((blob: Blob) => {
      expect(blob.type).toBe("model/gltf-binary");
      expect(blob.size).toBe(record.byteSize);
      return "blob:canonical-glb";
    });
    const deps = dependencies(record, {
      revalidateStored: vi.fn(async () => validation(record, verifiedBytes)),
      createObjectUrl: captureBlob,
    });

    const result = await downloadCanonicalStudioBg3dGlb(request(record), {
      dependencies: deps,
    });

    expect(deps.getStoredByHash).toHaveBeenCalledWith(CONTENT_HASH);
    expect(deps.revalidateStored).toHaveBeenCalledWith(record, {});
    expect(captureBlob).toHaveBeenCalledOnce();
    expect(deps.triggerDownload).toHaveBeenCalledWith(
      "blob:canonical-glb",
      "서울 거리 배경.glb",
    );
    expect(deps.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(deps.revokeObjectUrl).toHaveBeenCalledWith("blob:canonical-glb");
    expect(result).toEqual({
      fileName: "서울 거리 배경.glb",
      contentHash: CONTENT_HASH,
      byteSize: record.byteSize,
    });
  });

  it("keeps the object URL alive until a later-task cleanup is scheduled", async () => {
    const record = verifiedRecord();
    let deferredRevoke: (() => void) | null = null;
    const deps = dependencies(record, {
      scheduleObjectUrlRevoke: vi.fn((revoke) => {
        deferredRevoke = revoke;
      }),
    });

    await downloadCanonicalStudioBg3dGlb(request(record), { dependencies: deps });

    expect(deps.triggerDownload).toHaveBeenCalledOnce();
    expect(deps.revokeObjectUrl).not.toHaveBeenCalled();
    expect(deferredRevoke).not.toBeNull();
    deferredRevoke!();
    expect(deps.revokeObjectUrl).toHaveBeenCalledWith("blob:canonical-glb");
  });

  it("rejects non-canonical request identities before reading IndexedDB", async () => {
    const record = verifiedRecord();
    const deps = dependencies(record);

    await expect(downloadCanonicalStudioBg3dGlb({
      ...request(record),
      expectedContentHash: CONTENT_HASH.toUpperCase(),
    }, { dependencies: deps })).rejects.toSatisfy((cause: unknown) => {
      expectDownloadError(cause, "invalid-request");
      return true;
    });
    expect(deps.getStoredByHash).not.toHaveBeenCalled();
  });

  it("fails closed when the verified row changed identity, size, name, or canonical format", async () => {
    const record = verifiedRecord();
    const mismatches: unknown[] = [
      { ...record, id: "bg3d-storage-other" },
      { ...record, name: "바뀐 이름" },
      { ...record, byteSize: record.byteSize + 4 },
      { ...record, format: "obj" },
    ];

    for (const mismatch of mismatches) {
      const deps = dependencies(record, {
        getStoredByHash: vi.fn(async () => mismatch as Bg3dVerifiedStoredRecord),
      });
      await expect(downloadCanonicalStudioBg3dGlb(request(record), {
        dependencies: deps,
      })).rejects.toSatisfy((cause: unknown) => {
        expectDownloadError(cause, "record-mismatch");
        return true;
      });
      expect(deps.revalidateStored).not.toHaveBeenCalled();
      expect(deps.createObjectUrl).not.toHaveBeenCalled();
    }
  });

  it("never creates a URL when full revalidation fails or returns a non-GLB snapshot", async () => {
    const record = verifiedRecord();
    const rejected = dependencies(record, {
      revalidateStored: vi.fn(async () => {
        throw new Error("worker validation failed");
      }),
    });
    await expect(downloadCanonicalStudioBg3dGlb(request(record), {
      dependencies: rejected,
    })).rejects.toSatisfy((cause: unknown) => {
      expectDownloadError(cause, "validation-failed");
      return true;
    });
    expect(rejected.createObjectUrl).not.toHaveBeenCalled();

    const badHeader = canonicalGlbBytes();
    badHeader[0] = 0;
    const invalid = dependencies(record, {
      revalidateStored: vi.fn(async () => validation(record, badHeader)),
    });
    await expect(downloadCanonicalStudioBg3dGlb(request(record), {
      dependencies: invalid,
    })).rejects.toSatisfy((cause: unknown) => {
      expectDownloadError(cause, "invalid-glb");
      return true;
    });
    expect(invalid.createObjectUrl).not.toHaveBeenCalled();
  });

  it("revokes its object URL even when the browser download trigger throws", async () => {
    const record = verifiedRecord();
    const deps = dependencies(record, {
      triggerDownload: vi.fn(() => {
        throw new Error("click blocked");
      }),
    });

    await expect(downloadCanonicalStudioBg3dGlb(request(record), {
      dependencies: deps,
    })).rejects.toSatisfy((cause: unknown) => {
      expectDownloadError(cause, "download-failed");
      return true;
    });
    expect(deps.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(deps.revokeObjectUrl).toHaveBeenCalledWith("blob:canonical-glb");
    expect(deps.scheduleObjectUrlRevoke).not.toHaveBeenCalled();
  });

  it("honors aborts between IndexedDB lookup and revalidation without creating a URL", async () => {
    const controller = new AbortController();
    const record = verifiedRecord();
    const deps = dependencies(record, {
      getStoredByHash: vi.fn(async () => {
        controller.abort("user-cancelled");
        return record;
      }),
    });

    await expect(downloadCanonicalStudioBg3dGlb(request(record), {
      dependencies: deps,
      signal: controller.signal,
    })).rejects.toSatisfy((cause: unknown) => {
      expectDownloadError(cause, "aborted");
      return true;
    });
    expect(deps.revalidateStored).not.toHaveBeenCalled();
    expect(deps.createObjectUrl).not.toHaveBeenCalled();
  });
});
