import { describe, expect, it, vi } from "vitest";

import {
  createAssetRecord,
  ensureStudioAssetContentHash,
  type StudioAsset,
  type StudioAssetWithContentHash,
} from "./studio-asset-library";
import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  importStudioProjectArchive,
} from "./studio-project-archive";
import {
  DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
  type StudioReferenceBoardDocument,
} from "./studio-reference-board";
import {
  collectStudioReferenceBoardArchiveReferences,
  installPreparedStudioReferenceBoardArchiveImportAndApply,
  prepareStudioReferenceBoardArchiveImport,
  prepareStudioReferenceBoardArchiveExport,
  restoreStudioReferenceBoardArchiveImport,
} from "./studio-reference-board-archive";

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function pngBytes(seed = 1): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
}

async function contentHash(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const copy = bytes.slice();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function referenceBoard(sha256: `sha256:${string}`): StudioReferenceBoardDocument {
  return {
    version: 1,
    items: [
      {
        id: "back-reference",
        asset: {
          sha256,
          assetId: "stale-device-id",
          name: "동작 참고.png",
          mimeType: "image/png",
          width: 320,
          height: 180,
        },
        view: {
          ...DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
          centerX: 0.25,
          rotationDeg: -15,
        },
      },
      {
        id: "front-reference",
        asset: { sha256, name: "같은 이미지.png", mimeType: "image/png" },
        view: {
          ...DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
          centerX: 0.75,
          zoom: 2,
          flipX: true,
          opacity: 0.6,
        },
      },
    ],
  };
}

function projectWithBoard(board: StudioReferenceBoardDocument) {
  return {
    version: 2 as const,
    title: "reference archive",
    description: "",
    tagsText: "",
    pagesList: [{
      id: "page-1",
      elements: [],
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1_080,
    }],
    currentPageId: "page-1",
    webtoonTheme: "classic" as const,
    panelGutter: 24,
    referenceBoard: board,
  };
}

function localAsset(
  id: string,
  bytes: Uint8Array,
  hash?: `sha256:${string}`
): StudioAsset {
  return createAssetRecord({
    name: `${id}.png`,
    dataUrl: dataUrl("image/png", bytes),
    width: 320,
    height: 180,
    contentHash: hash,
  }, id, 1);
}

describe("studio reference-board archive bridge", () => {
  it("collects exact hash pointers in back-to-front item order", async () => {
    const hash = await contentHash(pngBytes());

    expect(collectStudioReferenceBoardArchiveReferences(projectWithBoard(referenceBoard(hash))))
      .toMatchObject([
        {
          sha256: hash,
          pointer: "/referenceBoard/items/0/asset/sha256",
          itemId: "back-reference",
          itemIndex: 0,
        },
        {
          sha256: hash,
          pointer: "/referenceBoard/items/1/asset/sha256",
          itemId: "front-reference",
          itemIndex: 1,
        },
      ]);
  });

  it("dedupes equal hashes into one verified reference attachment and round-trips self-contained", async () => {
    const bytes = pngBytes(7);
    const hash = await contentHash(bytes);
    const board = referenceBoard(hash);
    const project = projectWithBoard(board);
    const asset = localAsset("actual-local-id", bytes, hash);
    const prepared = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [asset],
    });

    expect(prepared).toMatchObject({ isComplete: true, missing: [], diagnostics: [] });
    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]?.documentReferences).toEqual([
      {
        pointer: "/referenceBoard/items/0/asset/sha256",
        usage: "reference",
        mode: "sha256-prefixed",
      },
      {
        pointer: "/referenceBoard/items/1/asset/sha256",
        usage: "reference",
        mode: "sha256-prefixed",
      },
    ]);

    const built = await buildStudioProjectArchive({ project, attachments: prepared.attachments });
    expect(built.isSelfContained).toBe(true);
    expect(built.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EXTERNAL_PROJECT_DEPENDENCY" }),
    ]));

    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    expect(imported.isSelfContained).toBe(true);
    const save = vi.fn(async (input: {
      name: string;
      dataUrl: string;
      width: number;
      height: number;
    }): Promise<StudioAssetWithContentHash> => ({
      id: "restored-local-id",
      ...input,
      contentHash: hash,
      createdAt: 2,
    }));
    const restored = await restoreStudioReferenceBoardArchiveImport(imported, {
      listAssets: async () => [],
      saveAsset: save,
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: "동작 참고.png",
      width: 320,
      height: 180,
    }));
    expect(restored.installed).toEqual([{ sha256: hash, assetId: "restored-local-id" }]);
    expect(restored.unresolved).toEqual([]);
    expect(restored.document.items.map(({ asset: descriptor }) => descriptor.assetId))
      .toEqual(["restored-local-id", "restored-local-id"]);
    expect(restored.document.items.map(({ view }) => view)).toEqual(board.items.map(({ view }) => view));
    expect(restored.document.items.map(({ asset: descriptor }) => descriptor.sha256))
      .toEqual([hash, hash]);
  });

  it("never trusts an assetId or stored hash when the actual bytes do not match", async () => {
    const expectedBytes = pngBytes(2);
    const differentBytes = pngBytes(3);
    const expectedHash = await contentHash(expectedBytes);
    const tampered = localAsset("stale-device-id", differentBytes, expectedHash);
    const prepared = await prepareStudioReferenceBoardArchiveExport(
      projectWithBoard(referenceBoard(expectedHash)),
      { listAssets: async () => [tampered] }
    );

    expect(prepared.attachments).toEqual([]);
    expect(prepared.isComplete).toBe(false);
    expect(prepared.missing).toEqual([expect.objectContaining({
      sha256: expectedHash,
      reason: "hash-mismatch",
    })]);
    expect(prepared.diagnostics).toEqual([expect.objectContaining({
      code: "ASSET_HASH_MISMATCH",
    })]);
  });

  it("marks a raw reference-board SHA-256 without attachment as an external project dependency", async () => {
    const hash = await contentHash(pngBytes(4));
    const built = await buildStudioProjectArchive({ project: projectWithBoard(referenceBoard(hash)) });

    expect(built.isSelfContained).toBe(false);
    expect(built.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "EXTERNAL_PROJECT_DEPENDENCY",
        pointer: "/referenceBoard/items/0/asset/sha256",
      }),
      expect.objectContaining({
        code: "EXTERNAL_PROJECT_DEPENDENCY",
        pointer: "/referenceBoard/items/1/asset/sha256",
      }),
    ]));

    const imported = await importStudioProjectArchive(built.blob);
    expect(imported.isSelfContained).toBe(false);
    expect(imported.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "EXTERNAL_PROJECT_DEPENDENCY",
        pointer: "/referenceBoard/items/0/asset/sha256",
      }),
    ]));
  });

  it("reuses a byte-verified local hash and does not save a duplicate on import", async () => {
    const bytes = pngBytes(8);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const source = localAsset("source", bytes, hash);
    const prepared = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [source],
    });
    const built = await buildStudioProjectArchive({ project, attachments: prepared.attachments });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const existing = localAsset("already-local", bytes, hash);
    const save = vi.fn(async () => {
      throw new Error("must not save");
    });

    const restored = await restoreStudioReferenceBoardArchiveImport(imported, {
      listAssets: async () => [existing],
      ensureContentHash: ensureStudioAssetContentHash,
      saveAsset: save,
    });

    expect(save).not.toHaveBeenCalled();
    expect(restored.installed).toEqual([]);
    expect(restored.reused).toEqual([{ sha256: hash, assetId: "already-local" }]);
    expect(restored.document.items.every(({ asset: descriptor }) =>
      descriptor.assetId === "already-local"
    )).toBe(true);
  });

  it("does not install an attachment whose authenticated usage is not reference", async () => {
    const bytes = pngBytes(9);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const built = await buildStudioProjectArchive({
      project,
      attachments: [{
        kind: "raster",
        data: bytes,
        mimeType: "image/png",
        documentReferences: [{
          pointer: "/referenceBoard/items/0/asset/sha256",
          usage: "raster",
          mode: "sha256-prefixed",
        }],
      }],
    });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const save = vi.fn();
    const restored = await restoreStudioReferenceBoardArchiveImport(imported, {
      listAssets: async () => [],
      saveAsset: save,
    });

    expect(save).not.toHaveBeenCalled();
    expect(restored.unresolved).toEqual([hash]);
    expect(restored.diagnostics).toEqual([expect.objectContaining({
      code: "ATTACHMENT_NOT_REFERENCE",
    })]);
  });

  it("keeps prepare read-only and compensates only the exact created row when apply rejects", async () => {
    const bytes = pngBytes(10);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const source = localAsset("source", bytes, hash);
    const exported = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [source],
    });
    const built = await buildStudioProjectArchive({ project, attachments: exported.attachments });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const save = vi.fn(async (input: Parameters<typeof createAssetRecord>[0]) => ({
      ...createAssetRecord(input, "created-by-import", 5),
      contentHash: hash,
    }));
    const compensate = vi.fn(async () => true);
    const listAssets = vi.fn(async () => [] as StudioAsset[]);
    const dependencies = {
      listAssets,
      saveAsset: save,
      deleteAssetIfIdentityMatches: compensate,
    };

    const prepared = await prepareStudioReferenceBoardArchiveImport(imported, dependencies);
    expect(listAssets).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(compensate).not.toHaveBeenCalled();

    const committed = await installPreparedStudioReferenceBoardArchiveImportAndApply(
      prepared,
      prepared.project,
      () => false,
      { didApply: (value) => value },
      dependencies,
    );
    expect(committed.applyResult).toBe(false);
    expect(listAssets).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(compensate).toHaveBeenCalledWith("created-by-import", hash);
    await expect(installPreparedStudioReferenceBoardArchiveImportAndApply(
      prepared,
      prepared.project,
      () => true,
      { didApply: (value) => value },
      dependencies,
    )).rejects.toThrow("현재 검증 세션");
  });

  it("compensates an exact created reference row when project apply throws", async () => {
    const bytes = pngBytes(11);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const source = localAsset("source", bytes, hash);
    const exported = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [source],
    });
    const built = await buildStudioProjectArchive({ project, attachments: exported.attachments });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const compensate = vi.fn(async () => true);
    const dependencies = {
      listAssets: async () => [],
      saveAsset: async (input: Parameters<typeof createAssetRecord>[0]) => ({
        ...createAssetRecord(input, "throw-created", 8),
        contentHash: hash,
      }),
      deleteAssetIfIdentityMatches: compensate,
    };
    const prepared = await prepareStudioReferenceBoardArchiveImport(imported, dependencies);

    await expect(installPreparedStudioReferenceBoardArchiveImportAndApply(
      prepared,
      prepared.project,
      () => {
        throw new Error("apply exploded");
      },
      { didApply: () => true },
      dependencies,
    )).rejects.toThrow("apply exploded");
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(compensate).toHaveBeenCalledWith("throw-created", hash);
  });

  it("never compensates a byte-verified shared reference row", async () => {
    const bytes = pngBytes(11);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const source = localAsset("source", bytes, hash);
    const exported = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [source],
    });
    const built = await buildStudioProjectArchive({ project, attachments: exported.attachments });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const existing = localAsset("shared-existing", bytes, hash);
    const compensate = vi.fn(async () => true);
    const prepared = await prepareStudioReferenceBoardArchiveImport(imported, {
      listAssets: async () => [existing],
    });

    await expect(installPreparedStudioReferenceBoardArchiveImportAndApply(
      prepared,
      prepared.project,
      () => {
        throw new Error("apply exploded");
      },
      { didApply: () => true },
      {
        listAssets: async () => [existing],
        deleteAssetIfIdentityMatches: compensate,
      },
    )).rejects.toThrow("apply exploded");
    expect(compensate).not.toHaveBeenCalled();
  });

  it("surfaces a failed exact compensation instead of claiming an atomic rollback", async () => {
    const bytes = pngBytes(12);
    const hash = await contentHash(bytes);
    const project = projectWithBoard(referenceBoard(hash));
    const source = localAsset("source", bytes, hash);
    const exported = await prepareStudioReferenceBoardArchiveExport(project, {
      listAssets: async () => [source],
    });
    const built = await buildStudioProjectArchive({ project, attachments: exported.attachments });
    const imported = await importStudioProjectArchive(built.blob, { rehydrateDataUrls: false });
    const dependencies = {
      listAssets: async () => [],
      saveAsset: async (input: Parameters<typeof createAssetRecord>[0]) => ({
        ...createAssetRecord(input, "changed-after-create", 9),
        contentHash: hash,
      }),
      deleteAssetIfIdentityMatches: async () => false,
    };
    const prepared = await prepareStudioReferenceBoardArchiveImport(imported, dependencies);

    await expect(installPreparedStudioReferenceBoardArchiveImportAndApply(
      prepared,
      prepared.project,
      () => false,
      { didApply: (value) => value },
      dependencies,
    )).rejects.toThrow("안전하게 되돌리지 못했습니다");
  });
});
