import { describe, expect, it, vi } from "vitest";

import {
  collectStudioBg3dProjectArchivePlan,
  type ImportStudioProjectArchiveResult,
  type StudioProjectArchiveImportedAttachment,
  type StudioProjectArchiveManifest,
} from "../studio-project-archive";

import {
  buildStudioProjectArchiveWithVerifiedBg3dModels,
  installPreparedStudioBg3dProjectArchiveModelsAndApply,
  installStudioBg3dProjectArchiveModelsAndApply,
  prepareStudioBg3dProjectArchiveImport,
  prepareStudioBg3dProjectArchiveAttachments,
  StudioBg3dProjectLibraryError,
  type StudioBg3dProjectLibraryDependencies,
} from "./studio-bg3d-project-library";
import {
  STUDIO_BG3D_GLB_MIME,
  createDefaultStudioBg3dSceneDocument,
  type StudioBg3dAttachmentRights,
} from "./studio-bg3d-scene-document";

import type {
  Bg3dModelAtomicImportDispositionV12,
  Bg3dModelImportItem,
  Bg3dVerifiedStoredRecord,
} from "./bg3d-model-library";
import type { StudioProjectFile } from "../studio-project-file";

const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);
const RIGHTS: StudioBg3dAttachmentRights = {
  status: "owned",
  commercialUse: true,
  attributionRequired: false,
};

function scene(id: string, hash: string, byteSize = 32) {
  return {
    ...createDefaultStudioBg3dSceneDocument(),
    attachments: [{
      id,
      name: `${id}.glb`,
      mime: STUDIO_BG3D_GLB_MIME,
      byteSize,
      hash: `sha256:${hash}`,
      rights: RIGHTS,
      source: "local-library" as const,
    }],
  };
}

function projectWithHashes(hashes: readonly string[]) {
  return {
    version: 2,
    title: "3D archive bridge",
    pagesList: [{
      id: "page-1",
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1_080,
      elements: hashes.map((hash, index) => ({
        id: `image-${index}`,
        type: "image",
        src: `render-${index}`,
        bg3dScene: scene(`scene-model-${index}`, hash),
      })),
    }],
    currentPageId: "page-1",
  };
}

const METRICS = Object.freeze({
  byteSize: 32,
  jsonByteSize: 12,
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
});

function storedRecord(
  hash: string,
  privateId = `private-db-${hash.slice(0, 4)}`,
  name = hash === HASH_B ? "scene-model-1" : "scene-model-0",
): Bg3dVerifiedStoredRecord {
  return {
    id: privateId,
    storageVersion: 2,
    name,
    format: "glb",
    blob: new Blob([new Uint8Array(32).fill(99)], { type: STUDIO_BG3D_GLB_MIME }),
    thumbnail: null,
    createdAt: 1,
    updatedAt: 1,
    contentHash: `sha256:${hash}`,
    byteSize: 32,
    mime: STUDIO_BG3D_GLB_MIME,
    validationVersion: 1,
    validatedAt: 1,
    validatorProfile: "desktop",
    validatorMetrics: METRICS,
    rights: RIGHTS,
  };
}

function exportDependencies(records: ReadonlyMap<string, Bg3dVerifiedStoredRecord>) {
  const verifiedByHash = new Map<string, Uint8Array>();
  const getStoredByHash = vi.fn(async (hash: string) => records.get(hash) ?? null);
  const revalidateStored = vi.fn<StudioBg3dProjectLibraryDependencies["revalidateStored"]>(async (
    value,
    options = {},
  ) => {
    const record = value as Bg3dVerifiedStoredRecord;
    const verifiedBytes = new Uint8Array(record.byteSize).fill(7);
    verifiedByHash.set(record.contentHash, verifiedBytes);
    return {
      ok: true as const,
      code: "valid" as const,
      message: "검증됨",
      profile: "desktop" as const,
      verifiedSha256: record.contentHash,
      verifiedBytes,
      cumulativeBytesAfter: (options.cumulativeUsedBytes ?? 0) + record.byteSize,
      usesBasisTextures: false,
      requiresBasisTextures: false,
      metrics: record.validatorMetrics,
    };
  });
  return { getStoredByHash, revalidateStored, verifiedByHash };
}

function manifestForProject(): StudioProjectArchiveManifest {
  return {
    schema: "toonspectrum.studio-project-archive",
    version: 2,
    project: {
      path: "project.json",
      mimeType: "application/json",
      byteSize: 1,
      sha256: "a".repeat(64),
    },
    attachments: [],
    totals: { entryCount: 2, attachmentCount: 0, attachmentBytes: 0, contentBytes: 1 },
  };
}

function importedResultFor(project: unknown): ImportStudioProjectArchiveResult {
  const plan = collectStudioBg3dProjectArchivePlan(project);
  const attachmentMap = new Map<string, StudioProjectArchiveImportedAttachment>();
  for (const planned of plan.attachments) {
    attachmentMap.set(planned.sha256, {
      metadata: {
        path: `assets/sha256/${planned.sha256}.glb`,
        mimeType: STUDIO_BG3D_GLB_MIME,
        byteSize: planned.byteSize,
        sha256: planned.sha256,
        kinds: ["glb"],
        documentReferences: planned.documentReferences.map((reference) => ({ ...reference })),
      },
      blob: new Blob([new Uint8Array(planned.byteSize).fill(3)], {
        type: STUDIO_BG3D_GLB_MIME,
      }),
    });
  }
  const manifest = manifestForProject();
  manifest.attachments = [...attachmentMap.values()].map(({ metadata }) => metadata);
  manifest.totals = {
    entryCount: manifest.attachments.length + 2,
    attachmentCount: manifest.attachments.length,
    attachmentBytes: plan.totalAttachmentBytes,
    contentBytes: plan.totalAttachmentBytes + 1,
  };
  return {
    project: plan.project,
    canonicalProject: plan.project,
    manifest,
    attachments: attachmentMap,
    isSelfContained: true,
    diagnostics: [],
  };
}

describe("studio BG3D project-library bridge", () => {
  it("hash 하나라도 없으면 검증·builder를 시작하지 않고 고정 오류로 실패한다", async () => {
    const project = projectWithHashes([HASH_A, HASH_B]);
    const first = storedRecord(HASH_A);
    const exportDeps = exportDependencies(new Map([[HASH_A, first]]));
    const buildArchive = vi.fn<StudioBg3dProjectLibraryDependencies["buildArchive"]>();

    await expect(buildStudioProjectArchiveWithVerifiedBg3dModels(
      { project },
      {},
      { ...exportDeps, buildArchive },
    )).rejects.toEqual(expect.objectContaining<Partial<StudioBg3dProjectLibraryError>>({
      code: "export-model-missing",
      message: "프로젝트의 3D 모델을 로컬 검증 라이브러리에서 찾을 수 없습니다.",
    }));
    expect(exportDeps.getStoredByHash).toHaveBeenCalledTimes(2);
    expect(exportDeps.revalidateStored).not.toHaveBeenCalled();
    expect(buildArchive).not.toHaveBeenCalled();
  });

  it("raw Blob 대신 validator-owned bytes와 원래 integrity reference만 내보내고 저장 id를 노출하지 않는다", async () => {
    const project = projectWithHashes([HASH_A]);
    const record = storedRecord(HASH_A, "private-indexed-db-row");
    const exportDeps = exportDependencies(new Map([[HASH_A, record]]));
    const planned = collectStudioBg3dProjectArchivePlan(project).attachments[0]!;

    const attachments = await prepareStudioBg3dProjectArchiveAttachments(project, {}, exportDeps);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: "glb",
      mimeType: STUDIO_BG3D_GLB_MIME,
      documentReferences: planned.documentReferences,
    });
    expect(attachments[0]!.data).toBe(exportDeps.verifiedByHash.get(`sha256:${HASH_A}`));
    expect(attachments[0]!.data).not.toBe(record.blob);
    expect(JSON.stringify(attachments)).not.toContain(record.id);
    expect(exportDeps.revalidateStored).toHaveBeenCalledWith(record, expect.objectContaining({
      profile: "desktop",
      budgets: planned.validationBudgets,
      cumulativeUsedBytes: 0,
      maximumCumulativeBytes: 32,
    }));
  });

  it("로컬 파일명은 장면 별칭과 달라도 허용하고 rights·크기·MIME 불일치는 검증 전에 막는다", async () => {
    const project = projectWithHashes([HASH_A]);
    const renamedRecord = storedRecord(HASH_A, "private-row", "다른 로컬 파일 이름");
    const renamedDeps = exportDependencies(new Map([[HASH_A, renamedRecord]]));

    await expect(prepareStudioBg3dProjectArchiveAttachments(project, {}, renamedDeps))
      .resolves.toHaveLength(1);
    expect(renamedDeps.revalidateStored).toHaveBeenCalledOnce();

    const rightsMismatch = {
      ...renamedRecord,
      rights: { ...RIGHTS, commercialUse: false },
    } satisfies Bg3dVerifiedStoredRecord;
    const mismatchDeps = exportDependencies(new Map([[HASH_A, rightsMismatch]]));

    await expect(prepareStudioBg3dProjectArchiveAttachments(project, {}, mismatchDeps))
      .rejects.toMatchObject({ code: "export-model-mismatch" });
    expect(mismatchDeps.revalidateStored).not.toHaveBeenCalled();
  });

  it("비동기 검증 중 caller 프로젝트가 바뀌어도 최초 canonical snapshot만 builder에 전달한다", async () => {
    const project = projectWithHashes([HASH_A]);
    const record = storedRecord(HASH_A);
    const exportDeps = exportDependencies(new Map([[HASH_A, record]]));
    const buildArchive = vi.fn<StudioBg3dProjectLibraryDependencies["buildArchive"]>(async (input) => {
      const planned = collectStudioBg3dProjectArchivePlan(input.project).attachments[0]!;
      expect(planned.attachment.rights).toEqual(RIGHTS);
      return {} as Awaited<ReturnType<StudioBg3dProjectLibraryDependencies["buildArchive"]>>;
    });

    const pending = buildStudioProjectArchiveWithVerifiedBg3dModels(
      { project },
      {},
      { ...exportDeps, buildArchive },
    );
    const mutableAttachment = project.pagesList[0]!.elements[0]!.bg3dScene.attachments[0]!;
    mutableAttachment.rights = { ...RIGHTS, commercialUse: false };

    await expect(pending).resolves.toEqual({});
    expect(buildArchive).toHaveBeenCalledOnce();
  });

  it("import attachment가 없으면 atomic import와 apply를 모두 호출하지 않는다", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A]));
    result.attachments = new Map();
    const importAtomically = vi.fn();
    const apply = vi.fn();

    await expect(installStudioBg3dProjectArchiveModelsAndApply(
      result,
      apply,
      {},
      { importAtomically },
    )).rejects.toMatchObject({ code: "import-attachment-missing" });
    expect(importAtomically).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("모든 GLB를 한 batch로 정확히 한 번 저장하고 성공 뒤에만 프로젝트를 적용한다", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A, HASH_B]));
    const callOrder: string[] = [];
    const committed = [storedRecord(HASH_A), storedRecord(HASH_B)];
    const importAtomically = vi.fn<StudioBg3dProjectLibraryDependencies["importAtomically"]>(async (items) => {
      callOrder.push("atomic");
      expect(items).toHaveLength(2);
      const importItems = items.filter((item): item is Bg3dModelImportItem => "file" in item);
      expect(importItems).toHaveLength(items.length);
      expect(importItems.map((item) => item.expectedSha256)).toEqual([
        `sha256:${HASH_A}`,
        `sha256:${HASH_B}`,
      ]);
      expect(importItems.map((item) => item.rights)).toEqual([RIGHTS, RIGHTS]);
      expect(importItems.every((item) =>
        item.file.size === 32
        && item.file.type === STUDIO_BG3D_GLB_MIME
        && item.file.name.endsWith(".glb")
      )).toBe(true);
      return committed;
    });
    const apply = vi.fn(async (project, originalResult) => {
      callOrder.push("apply");
      expect(project).not.toBe(result.project);
      expect(project).toStrictEqual(result.project);
      expect(originalResult).toBe(result);
      return "applied" as const;
    });

    const installed = await installStudioBg3dProjectArchiveModelsAndApply(
      result,
      apply,
      {},
      { importAtomically },
    );

    expect(importAtomically).toHaveBeenCalledTimes(1);
    expect(importAtomically).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      cumulativeUsedBytes: 0,
      maximumCumulativeBytes: 64,
    }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["atomic", "apply"]);
    expect(installed).toEqual({ records: committed, applyResult: "applied" });
  });

  it("atomic import가 실패하면 프로젝트를 적용하지 않는다", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A]));
    const importAtomically = vi.fn(async () => {
      throw new Error("storage rejected");
    });
    const apply = vi.fn();

    await expect(installStudioBg3dProjectArchiveModelsAndApply(
      result,
      apply,
      {},
      { importAtomically },
    )).rejects.toThrow("storage rejected");
    expect(importAtomically).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("3D 장면이 없는 프로젝트는 IndexedDB를 건드리지 않고 바로 적용한다", async () => {
    const result = importedResultFor(projectWithHashes([]));
    const importAtomically = vi.fn();
    const apply = vi.fn(() => 7);

    const installed = await installStudioBg3dProjectArchiveModelsAndApply(
      result,
      apply,
      {},
      { importAtomically },
    );

    expect(importAtomically).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledOnce();
    expect(installed).toEqual({ records: [], applyResult: 7 });
  });

  it("인증 프로젝트와 적용 프로젝트의 3D 장면이 다르면 empty-plan 우회 없이 거부한다", async () => {
    const result = importedResultFor(projectWithHashes([]));
    result.project = collectStudioBg3dProjectArchivePlan(projectWithHashes([HASH_A])).project;
    const importAtomically = vi.fn();
    const apply = vi.fn();

    await expect(installStudioBg3dProjectArchiveModelsAndApply(
      result,
      apply,
      {},
      { importAtomically },
    )).rejects.toMatchObject({ code: "import-project-mismatch" });
    expect(importAtomically).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("atomic import 대기 중 원본이 바뀌어도 진입 시점 rehydrated snapshot만 적용한다", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A]));
    let release: ((records: Bg3dVerifiedStoredRecord[]) => void) | undefined;
    const importAtomically = vi.fn<StudioBg3dProjectLibraryDependencies["importAtomically"]>(() =>
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const applied: StudioProjectFile[] = [];
    const pending = installStudioBg3dProjectArchiveModelsAndApply(
      result,
      (project) => applied.push(project),
      {},
      { importAtomically },
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    result.project.pagesList[0]!.elements = [];
    release?.([storedRecord(HASH_A)]);

    await expect(pending).resolves.toMatchObject({ records: [expect.any(Object)] });
    expect(applied).toHaveLength(1);
    expect(collectStudioBg3dProjectArchivePlan(applied[0]).attachments).toHaveLength(1);
  });

  it("manifest metadata 또는 reference가 장면 계획과 다르면 atomic import 전 실패한다", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A]));
    const imported = result.attachments.get(HASH_A)!;
    imported.metadata.documentReferences = [];
    const importAtomically = vi.fn();

    await expect(installStudioBg3dProjectArchiveModelsAndApply(
      result,
      vi.fn(),
      {},
      { importAtomically },
    )).rejects.toMatchObject({ code: "import-attachment-mismatch" });
    expect(importAtomically).not.toHaveBeenCalled();
  });

  it.each(["rejects", "throws", "compensation-fails"] as const)(
    "prepare는 쓰지 않고 apply가 %s이면 exact created BG3D batch만 보상한다",
    async (failure) => {
      const result = importedResultFor(projectWithHashes([HASH_A]));
      const created = storedRecord(HASH_A, "created-bg3d-row");
      const disposition: Bg3dModelAtomicImportDispositionV12 = Object.freeze({
        kind: "toonspectrum-bg3d-model-atomic-import",
        version: 1,
        manifestRevision: 7,
        records: Object.freeze([created]),
        created: Object.freeze([{ id: created.id, contentHash: created.contentHash }]),
        removedDeletions: Object.freeze([]),
      });
      const importWithDisposition = vi.fn(async () => disposition);
      const compensate = vi.fn(async (receipt: Bg3dModelAtomicImportDispositionV12) => {
        expect(receipt).toBe(disposition);
        return failure !== "compensation-fails";
      });
      const prepared = prepareStudioBg3dProjectArchiveImport(result, {}, {
        importAtomicallyWithDisposition: importWithDisposition,
        compensateImported: compensate,
      });
      expect(importWithDisposition).not.toHaveBeenCalled();

      const commit = installPreparedStudioBg3dProjectArchiveModelsAndApply(
        prepared,
        prepared.project,
        () => {
          if (failure === "throws") throw new Error("apply exploded");
          return false;
        },
        { didApply: (value) => value !== false },
      );
      if (failure === "throws") await expect(commit).rejects.toThrow("apply exploded");
      else if (failure === "compensation-fails") {
        await expect(commit).rejects.toThrow("안전하게 되돌리지 못했습니다");
      } else await expect(commit).resolves.toEqual({ records: [], applyResult: false });
      expect(importWithDisposition).toHaveBeenCalledTimes(1);
      expect(compensate).toHaveBeenCalledTimes(1);
      await expect(installPreparedStudioBg3dProjectArchiveModelsAndApply(
        prepared,
        prepared.project,
        () => true,
        { didApply: (value) => value },
      )).rejects.toMatchObject({ code: "import-project-mismatch" });
    },
  );

  it("ticket-style apply rejection preserves a deduplicated BG3D row", async () => {
    const result = importedResultFor(projectWithHashes([HASH_A]));
    const reused = storedRecord(HASH_A, "shared-bg3d-row");
    const disposition: Bg3dModelAtomicImportDispositionV12 = Object.freeze({
      kind: "toonspectrum-bg3d-model-atomic-import",
      version: 1,
      manifestRevision: 9,
      records: Object.freeze([reused]),
      created: Object.freeze([]),
      removedDeletions: Object.freeze([]),
    });
    const compensate = vi.fn(async () => true);
    const prepared = prepareStudioBg3dProjectArchiveImport(result, {}, {
      importAtomicallyWithDisposition: vi.fn(async () => disposition),
      compensateImported: compensate,
    });

    await expect(installPreparedStudioBg3dProjectArchiveModelsAndApply(
      prepared,
      prepared.project,
      () => false,
      { didApply: (value) => value },
    )).resolves.toEqual({ records: [], applyResult: false });
    expect(compensate).not.toHaveBeenCalled();
  });
});
