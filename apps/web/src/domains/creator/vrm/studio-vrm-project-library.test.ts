import { describe, expect, it, vi } from "vitest";

import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  importStudioProjectArchive,
  type ImportStudioProjectArchiveResult,
  type StudioProjectArchiveAttachmentInput,
} from "../studio-project-archive";

import { STUDIO_VRM_1_PUBLIC_LICENSE_URL } from "./studio-vrm-license-metadata";
import { createStudioVrmProjectArchiveUseContextReceipt } from "./studio-vrm-license-product-gate";
import {
  collectStudioVrmProjectArchiveReferences,
  installPreparedStudioVrmProjectArchiveImportAndApply,
  prepareStudioVrmProjectArchiveExport,
  prepareStudioVrmProjectArchiveUseContextAttestation,
  restoreStudioVrmProjectArchiveImport,
  type RestoreStudioVrmProjectArchiveImportResult,
  type StudioVrmProjectLibraryDependencies,
} from "./studio-vrm-project-library";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
  type StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";
import {
  VRM_VALIDATION_VERSION,
  hashVrmBlob,
  type VrmContentHash,
  type VrmStoredModelRecord,
  type VrmStoredModelWithContentIdentity,
} from "./vrm-library";

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function glbBytes(document: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return bytes;
}

function vrmBytes(seed = 1): Uint8Array {
  return glbBytes({
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        meta: {
          name: "Archive test",
          authors: ["Test Creator"],
          licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
          avatarPermission: "everyone",
          commercialUsage: "corporation",
          allowRedistribution: true,
          modification: "allowModificationRedistribution",
          creditNotation: "required",
        },
      },
    },
    extras: { seed },
  });
}

const ARCHIVE_USE_CONTEXT = createStudioVrmProjectArchiveUseContextReceipt({
  confirmedByUser: true,
  avatarPermissionBasis: "other",
  confirmedAttributionTexts: [
    "Archive test · Test Creator · VRM-Public-License-1.0 · https://vrm.dev/licenses/1.0/",
  ],
  excessivelyViolent: "absent",
  excessivelySexual: "absent",
  politicalOrReligious: "absent",
  antisocialOrHate: "absent",
});

function vrmBytesWithMeta(meta: Record<string, unknown> | null, seed = 1): Uint8Array {
  return glbBytes({
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        ...(meta === null ? {} : { meta }),
      },
    },
    extras: { seed },
  });
}

function nonVrmGlbBytes(seed = 1): Uint8Array {
  return glbBytes({ asset: { version: "2.0" }, extras: { seed } });
}

function blobFrom(bytes: Uint8Array, type = "model/gltf-binary"): Blob {
  const copy = bytes.slice();
  return new Blob([copy.buffer as ArrayBuffer], { type });
}

async function hashOf(blob: Blob): Promise<VrmContentHash> {
  return hashVrmBlob(blob);
}

function storedRecord(
  id: string,
  blob: Blob,
  hash: VrmContentHash,
  overrides: Partial<VrmStoredModelWithContentIdentity> = {},
): VrmStoredModelWithContentIdentity {
  return {
    id,
    name: "검증 모델",
    blob,
    thumbnail: null,
    createdAt: 1,
    updatedAt: 1,
    contentHash: hash,
    byteSize: blob.size,
    mimeType: "model/gltf-binary",
    validationVersion: VRM_VALIDATION_VERSION,
    ...overrides,
  };
}

function attachmentScene(
  hash: VrmContentHash,
  byteSize: number,
  name = "업로드 인형",
): StudioVrmSceneDocument {
  return createStudioVrmSceneDocument({
    source: "attachment",
    hash,
    byteSize,
    mime: "model/vrm",
    name,
  });
}

function bundledScene(): StudioVrmSceneDocument {
  return createStudioVrmSceneDocument({
    source: "bundled",
    id: "sample-vrm",
    name: "루미",
  });
}

function projectWithScenes(
  pageScene: StudioVrmSceneDocument,
  masterScene?: StudioVrmSceneDocument,
) {
  return {
    version: 2 as const,
    title: "VRM archive",
    description: "",
    tagsText: "",
    pagesList: [
      {
        id: "page-1",
        elements: [
          { id: "vrm-page", type: "image", src: "", vrmScene: pageScene },
          { id: "bundled-page", type: "image", src: "", vrmScene: bundledScene() },
        ],
        bg: "#ffffff",
        bgGrad: null,
        canvasH: 1_080,
      },
    ],
    master: masterScene
      ? { elements: [{ id: "vrm-master", type: "image", src: "", vrmScene: masterScene }] }
      : undefined,
    currentPageId: "page-1",
    webtoonTheme: "classic" as const,
    panelGutter: 24,
  };
}

function savedRecordFactory(
  id: string,
  hash: VrmContentHash,
): StudioVrmProjectLibraryDependencies["saveVerifiedBlobWithDisposition"] {
  return async ({ blob, expectedHash }) => {
    expect(expectedHash).toBe(hash);
    return { record: storedRecord(id, blob, hash), created: true };
  };
}

function commitPrepared(
  prepared: RestoreStudioVrmProjectArchiveImportResult,
  dependencies: Partial<StudioVrmProjectLibraryDependencies>,
  apply: (project: ImportStudioProjectArchiveResult["project"]) => boolean = () => true,
) {
  return installPreparedStudioVrmProjectArchiveImportAndApply(
    prepared,
    prepared.project,
    apply,
    { didApply: (result) => result },
    dependencies,
  );
}

async function selfContainedArchive(
  project: ReturnType<typeof projectWithScenes>,
  record: VrmStoredModelRecord,
): Promise<ImportStudioProjectArchiveResult> {
  const prepared = await prepareStudioVrmProjectArchiveExport(project, {
    getStoredByContentHash: async () => record,
  }, ARCHIVE_USE_CONTEXT);
  expect(prepared.isComplete).toBe(true);
  const built = await buildStudioProjectArchive({
    project,
    attachments: prepared.attachments,
  });
  return importStudioProjectArchive(built.blob);
}

describe("studio VRM project library bridge", () => {
  it("collects exact page/master hash pointers, preserves order, and skips bundled models", async () => {
    const blob = blobFrom(vrmBytes());
    const hash = await hashOf(blob);
    const scene = attachmentScene(hash, blob.size);

    expect(collectStudioVrmProjectArchiveReferences(projectWithScenes(scene, scene))).toEqual([
      expect.objectContaining({
        hash,
        pointer: "/pagesList/0/elements/0/vrmScene/model/hash",
        scenePointer: "/pagesList/0/elements/0/vrmScene",
        scope: "page",
        pageIndex: 0,
        elementIndex: 0,
      }),
      expect.objectContaining({
        hash,
        pointer: "/master/elements/0/vrmScene/model/hash",
        scenePointer: "/master/elements/0/vrmScene",
        scope: "master",
        elementIndex: 0,
      }),
    ]);
  });

  it("dedupes a verified hash into one VRM attachment and installs it without writing a local id", async () => {
    const blob = blobFrom(vrmBytes(2));
    const hash = await hashOf(blob);
    const scene = attachmentScene(hash, blob.size, "주인공.vrm");
    const project = projectWithScenes(scene, scene);
    const record = storedRecord("source-device-id", blob, hash);

    const prepared = await prepareStudioVrmProjectArchiveExport(project, {
      getStoredByContentHash: async () => record,
    }, ARCHIVE_USE_CONTEXT);
    const attestation = await prepareStudioVrmProjectArchiveUseContextAttestation(project, {
      getStoredByContentHash: async () => record,
    });

    expect(prepared).toMatchObject({ isComplete: true, missing: [], diagnostics: [] });
    expect(attestation).toMatchObject({
      ok: true,
      modelCount: 1,
      permittedActorBases: ["author", "separately-licensed-person", "other"],
      exactAttributionTexts: ARCHIVE_USE_CONTEXT.attribution.exactTexts,
    });
    const missingExactCredit = await prepareStudioVrmProjectArchiveExport(
      project,
      { getStoredByContentHash: async () => record },
      createStudioVrmProjectArchiveUseContextReceipt({
        confirmedByUser: true,
        avatarPermissionBasis: "other",
        confirmedAttributionTexts: [],
        excessivelyViolent: "absent",
        excessivelySexual: "absent",
        politicalOrReligious: "absent",
        antisocialOrHate: "absent",
      }),
    );
    expect(missingExactCredit.missing[0]).toMatchObject({ reason: "license-restricted" });
    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]).toMatchObject({
      kind: "vrm",
      mimeType: "model/vrm",
      documentReferences: [
        {
          pointer: "/pagesList/0/elements/0/vrmScene/model/hash",
          usage: "vrm",
          mode: "sha256-prefixed",
        },
        {
          pointer: "/master/elements/0/vrmScene/model/hash",
          usage: "vrm",
          mode: "sha256-prefixed",
        },
      ],
    });

    const built = await buildStudioProjectArchive({ project, attachments: prepared.attachments });
    expect(built.isSelfContained).toBe(true);
    expect(built.manifest.attachments).toHaveLength(1);
    expect(built.manifest.attachments[0]).toMatchObject({
      sha256: hash.slice("sha256:".length),
      mimeType: "model/vrm",
      kinds: ["vrm"],
    });
    const imported = await importStudioProjectArchive(built.blob);
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("destination-device-id", hash),
    );
    const restored = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    expect(saveVerifiedBlobWithDisposition).not.toHaveBeenCalled();
    const committed = await commitPrepared(restored, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });

    expect(committed.installed).toEqual([{ hash, modelId: "destination-device-id" }]);
    expect(committed.reused).toEqual([]);
    expect(restored.unresolved).toEqual([]);
    expect(saveVerifiedBlobWithDisposition).toHaveBeenCalledOnce();
    expect(JSON.stringify(restored.project)).not.toContain("destination-device-id");
    expect(collectStudioVrmProjectArchiveReferences(restored.project).map(({ model }) => model))
      .toEqual([scene.model, scene.model]);
  });

  it("fail-closes archive redistribution when raw VRM metadata is missing or prohibits it", async () => {
    const cases = [
      vrmBytesWithMeta(null, 31),
      vrmBytesWithMeta({
        name: "No redistribution",
        authors: ["Creator"],
        licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
        avatarPermission: "everyone",
        allowRedistribution: false,
      }, 32),
    ];

    for (const bytes of cases) {
      const blob = blobFrom(bytes);
      const hash = await hashOf(blob);
      const prepared = await prepareStudioVrmProjectArchiveExport(
        projectWithScenes(attachmentScene(hash, blob.size)),
        { getStoredByContentHash: async () => storedRecord("restricted", blob, hash) },
        ARCHIVE_USE_CONTEXT,
      );

      expect(prepared.attachments).toEqual([]);
      expect(prepared.missing[0]).toMatchObject({ reason: "license-restricted" });
      expect(prepared.missing[0]?.policyReasons?.length).toBeGreaterThan(0);
      expect(prepared.diagnostics[0]).toMatchObject({
        code: "LOCAL_MODEL_LICENSE_RESTRICTED",
      });
      expect(prepared.isComplete).toBe(false);
    }
  });

  it("still permits authenticated archive import for local preview when rights are unknown", async () => {
    const blob = blobFrom(vrmBytesWithMeta(null, 33));
    const hash = await hashOf(blob);
    const project = projectWithScenes(attachmentScene(hash, blob.size));
    const built = await buildStudioProjectArchive({
      project,
      attachments: [{
        kind: "vrm",
        data: blob.slice(0, blob.size, "model/vrm"),
        mimeType: "model/vrm",
        documentReferences: [{
          pointer: "/pagesList/0/elements/0/vrmScene/model/hash",
          usage: "vrm",
          mode: "sha256-prefixed",
        }],
      }],
    });
    const imported = await importStudioProjectArchive(built.blob);
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("local-unknown-rights", hash),
    );
    const restored = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    expect(saveVerifiedBlobWithDisposition).not.toHaveBeenCalled();
    const committed = await commitPrepared(restored, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });

    expect(committed.installed).toEqual([{ hash, modelId: "local-unknown-rights" }]);
    expect(restored.diagnostics).toEqual([]);
    expect(saveVerifiedBlobWithDisposition).toHaveBeenCalledOnce();
  });

  it("reports missing, stale-hash, wrong-size, and non-VRM local rows without exporting bytes", async () => {
    const expectedBlob = blobFrom(vrmBytes(3));
    const otherBlob = blobFrom(vrmBytes(4));
    expect(otherBlob.size).toBe(expectedBlob.size);
    const expectedHash = await hashOf(expectedBlob);
    const scene = attachmentScene(expectedHash, expectedBlob.size);
    const project = projectWithScenes(scene);

    const missing = await prepareStudioVrmProjectArchiveExport(project, {
      getStoredByContentHash: async () => null,
    });
    expect(missing.missing).toEqual([expect.objectContaining({ reason: "not-found" })]);
    expect(missing.diagnostics[0]?.code).toBe("LOCAL_MODEL_NOT_FOUND");

    const staleHash = await prepareStudioVrmProjectArchiveExport(project, {
      getStoredByContentHash: async () => storedRecord(
        "tampered",
        otherBlob,
        expectedHash,
      ),
    });
    expect(staleHash.attachments).toEqual([]);
    expect(staleHash.missing[0]?.reason).toBe("hash-mismatch");

    const wrongSize = await prepareStudioVrmProjectArchiveExport(
      projectWithScenes(attachmentScene(expectedHash, expectedBlob.size + 4)),
      { getStoredByContentHash: async () => storedRecord("wrong-size", expectedBlob, expectedHash) },
    );
    expect(wrongSize.missing[0]?.reason).toBe("size-mismatch");

    const plainGlb = blobFrom(nonVrmGlbBytes());
    const plainHash = await hashOf(plainGlb);
    const invalidBytes = await prepareStudioVrmProjectArchiveExport(
      projectWithScenes(attachmentScene(plainHash, plainGlb.size)),
      { getStoredByContentHash: async () => storedRecord("plain-glb", plainGlb, plainHash) },
    );
    expect(invalidBytes.missing[0]?.reason).toBe("bytes-invalid");
    expect(invalidBytes.diagnostics[0]?.code).toBe("LOCAL_MODEL_BYTES_INVALID");
  });

  it("fails closed when a stored row claims a non-canonical verified MIME", async () => {
    const blob = blobFrom(vrmBytes(5));
    const hash = await hashOf(blob);
    const record = storedRecord("wrong-mime", blob, hash, { mimeType: "model/vrm" });
    const result = await prepareStudioVrmProjectArchiveExport(
      projectWithScenes(attachmentScene(hash, blob.size)),
      {
        getStoredByContentHash: async () => record,
        ensureStoredIdentity: async () => record,
      },
    );

    expect(result.attachments).toEqual([]);
    expect(result.missing[0]?.reason).toBe("mime-mismatch");
    expect(result.diagnostics[0]?.code).toBe("LOCAL_MODEL_MIME_MISMATCH");
  });

  it("reuses an already verified local hash only after archive coverage is authenticated", async () => {
    const blob = blobFrom(vrmBytes(6));
    const hash = await hashOf(blob);
    const scene = attachmentScene(hash, blob.size);
    const local = storedRecord("existing-local-id", blob, hash);
    const imported = await selfContainedArchive(projectWithScenes(scene), local);
    const saveVerifiedBlobWithDisposition = vi.fn(savedRecordFactory("unused-id", hash));
    const getStoredByContentHash = vi.fn(async () => local);
    const restored = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash,
      saveVerifiedBlobWithDisposition,
    });
    expect(getStoredByContentHash).not.toHaveBeenCalled();
    const committed = await commitPrepared(restored, {
      getStoredByContentHash,
      saveVerifiedBlobWithDisposition,
    });

    expect(getStoredByContentHash).toHaveBeenCalledTimes(1);
    expect(committed.reused).toEqual([{ hash, modelId: "existing-local-id" }]);
    expect(committed.installed).toEqual([]);
    expect(saveVerifiedBlobWithDisposition).not.toHaveBeenCalled();
  });

  it("ignores authenticated orphan VRM files and installs only hashes used by a scene", async () => {
    const usedBlob = blobFrom(vrmBytes(7));
    const orphanBlob = blobFrom(vrmBytes(8));
    const usedHash = await hashOf(usedBlob);
    const scene = attachmentScene(usedHash, usedBlob.size);
    const project = projectWithScenes(scene);
    const prepared = await prepareStudioVrmProjectArchiveExport(project, {
      getStoredByContentHash: async () => storedRecord("used", usedBlob, usedHash),
    }, ARCHIVE_USE_CONTEXT);
    const orphanInput: StudioProjectArchiveAttachmentInput = {
      kind: "vrm",
      data: orphanBlob,
      mimeType: "model/vrm",
    };
    const built = await buildStudioProjectArchive({
      project,
      attachments: [...prepared.attachments, orphanInput],
    });
    const imported = await importStudioProjectArchive(built.blob);
    expect(imported.attachments).toHaveLength(2);
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("used-installed", usedHash),
    );

    const restored = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    const committed = await commitPrepared(restored, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });

    expect(committed.installed).toEqual([{ hash: usedHash, modelId: "used-installed" }]);
    expect(saveVerifiedBlobWithDisposition).toHaveBeenCalledOnce();
  });

  it("rejects forged reference metadata, MIME, or bytes before saving", async () => {
    const blob = blobFrom(vrmBytes(9));
    const alternateBlob = blobFrom(vrmBytes(0));
    expect(alternateBlob.size).toBe(blob.size);
    const hash = await hashOf(blob);
    const scene = attachmentScene(hash, blob.size);
    const imported = await selfContainedArchive(
      projectWithScenes(scene),
      storedRecord("source", blob, hash),
    );
    const rawHash = hash.slice("sha256:".length);
    const original = imported.attachments.get(rawHash);
    expect(original).toBeDefined();
    if (!original) throw new Error("missing test attachment");
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("must-not-save", hash),
    );

    const withoutReference: ImportStudioProjectArchiveResult = {
      ...imported,
      attachments: new Map([[rawHash, {
        ...original,
        metadata: { ...original.metadata, documentReferences: [] },
      }]]),
    };
    const missingReference = await restoreStudioVrmProjectArchiveImport(withoutReference, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    expect(missingReference.diagnostics[0]?.code).toBe("ATTACHMENT_METADATA_MISMATCH");

    const wrongMime: ImportStudioProjectArchiveResult = {
      ...imported,
      attachments: new Map([[rawHash, {
        ...original,
        metadata: { ...original.metadata, mimeType: "model/gltf-binary" },
      }]]),
    };
    const rejectedMime = await restoreStudioVrmProjectArchiveImport(wrongMime, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    expect(rejectedMime.diagnostics[0]?.code).toBe("ATTACHMENT_MIME_MISMATCH");

    const wrongBytes: ImportStudioProjectArchiveResult = {
      ...imported,
      attachments: new Map([[rawHash, {
        metadata: original.metadata,
        blob: alternateBlob.slice(0, alternateBlob.size, "model/vrm"),
      }]]),
    };
    const rejectedBytes = await restoreStudioVrmProjectArchiveImport(wrongBytes, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
    });
    expect(rejectedBytes.diagnostics[0]?.code).toBe("ATTACHMENT_HASH_MISMATCH");
    expect(saveVerifiedBlobWithDisposition).not.toHaveBeenCalled();
  });

  it("rejects a caller result whose rehydrated and canonical VRM scenes differ", async () => {
    const blob = blobFrom(vrmBytes(11));
    const hash = await hashOf(blob);
    const scene = attachmentScene(hash, blob.size);
    const imported = await selfContainedArchive(
      projectWithScenes(scene),
      storedRecord("source", blob, hash),
    );
    const changedScene = normalizeStudioVrmSceneDocument({
      ...scene,
      pose: { ...scene.pose, bodyRotationY: 0.75 },
    });
    const mismatched: ImportStudioProjectArchiveResult = {
      ...imported,
      project: projectWithScenes(changedScene) as ImportStudioProjectArchiveResult["project"],
    };

    await expect(restoreStudioVrmProjectArchiveImport(mismatched, {
      getStoredByContentHash: async () => null,
    })).rejects.toMatchObject({
      code: "import-project-mismatch",
    });
  });

  it("compensates only the exact row created at commit when the final project apply is stale", async () => {
    const blob = blobFrom(vrmBytes(41));
    const hash = await hashOf(blob);
    const imported = await selfContainedArchive(
      projectWithScenes(attachmentScene(hash, blob.size)),
      storedRecord("source", blob, hash),
    );
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("created-by-this-import", hash),
    );
    const deleteStoredIfIdentityMatches = vi.fn(async () => true);
    const prepared = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
      deleteStoredIfIdentityMatches,
    });

    const committed = await commitPrepared(
      prepared,
      {
        getStoredByContentHash: async () => null,
        saveVerifiedBlobWithDisposition,
        deleteStoredIfIdentityMatches,
      },
      () => false,
    );

    expect(committed.applyResult).toBe(false);
    expect(committed.installed).toEqual([]);
    expect(deleteStoredIfIdentityMatches).toHaveBeenCalledOnce();
    expect(deleteStoredIfIdentityMatches).toHaveBeenCalledWith(
      "created-by-this-import",
      hash,
    );
    await expect(commitPrepared(prepared, {
      getStoredByContentHash: async () => null,
      saveVerifiedBlobWithDisposition,
      deleteStoredIfIdentityMatches,
    })).rejects.toMatchObject({ code: "import-plan-invalid" });
  });

  it("never compensates a row deduplicated by a concurrent/pre-existing hash owner", async () => {
    const blob = blobFrom(vrmBytes(42));
    const hash = await hashOf(blob);
    const imported = await selfContainedArchive(
      projectWithScenes(attachmentScene(hash, blob.size)),
      storedRecord("source", blob, hash),
    );
    const deduplicated = storedRecord("shared-existing-row", blob, hash);
    const saveVerifiedBlobWithDisposition = vi.fn(async () => ({
      record: deduplicated,
      created: false,
    }));
    const deleteStoredIfIdentityMatches = vi.fn(async () => true);
    const prepared = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
    });

    const committed = await commitPrepared(
      prepared,
      {
        getStoredByContentHash: async () => null,
        saveVerifiedBlobWithDisposition,
        deleteStoredIfIdentityMatches,
      },
      () => false,
    );

    expect(committed.reused).toEqual([{ hash, modelId: "shared-existing-row" }]);
    expect(deleteStoredIfIdentityMatches).not.toHaveBeenCalled();
  });

  it("compensates a newly created row when the downstream apply throws", async () => {
    const blob = blobFrom(vrmBytes(43));
    const hash = await hashOf(blob);
    const imported = await selfContainedArchive(
      projectWithScenes(attachmentScene(hash, blob.size)),
      storedRecord("source", blob, hash),
    );
    const saveVerifiedBlobWithDisposition = vi.fn(
      savedRecordFactory("created-before-throw", hash),
    );
    const deleteStoredIfIdentityMatches = vi.fn(async () => true);
    const prepared = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash: async () => null,
    });

    await expect(installPreparedStudioVrmProjectArchiveImportAndApply(
      prepared,
      prepared.project,
      () => {
        throw new Error("route closed");
      },
      { didApply: () => true },
      {
        getStoredByContentHash: async () => null,
        saveVerifiedBlobWithDisposition,
        deleteStoredIfIdentityMatches,
      },
    )).rejects.toThrow("route closed");
    expect(deleteStoredIfIdentityMatches).toHaveBeenCalledWith("created-before-throw", hash);
  });

  it("does no library I/O for projects that use bundled mannequins only", async () => {
    const getStoredByContentHash = vi.fn(async () => null);
    const exported = await prepareStudioVrmProjectArchiveExport(
      projectWithScenes(bundledScene()),
      { getStoredByContentHash },
    );
    expect(exported).toMatchObject({
      attachments: [],
      missing: [],
      diagnostics: [],
      isComplete: true,
    });
    expect(getStoredByContentHash).not.toHaveBeenCalled();

    const built = await buildStudioProjectArchive({ project: projectWithScenes(bundledScene()) });
    const imported = await importStudioProjectArchive(built.blob);
    const saveVerifiedBlobWithDisposition = vi.fn(savedRecordFactory(
      "unused",
      `sha256:${"0".repeat(64)}`,
    ));
    const restored = await restoreStudioVrmProjectArchiveImport(imported, {
      getStoredByContentHash,
      saveVerifiedBlobWithDisposition,
    });
    expect(restored.prepared).toEqual([]);
    expect(restored.reused).toEqual([]);
    expect(saveVerifiedBlobWithDisposition).not.toHaveBeenCalled();
  });
});
