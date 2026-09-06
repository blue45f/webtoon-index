import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();
// 2026-08-21 의도적 변경: 순수 헬퍼(studioVrmTexturePaintSceneIdentity 포함)가
// StudioVrmPoser.tsx에서 studio-vrm-poser-helpers.ts로 분리됐다. 마커만 옮기고
// 검증 대상(장면 아이덴티티는 surfacePaint 만 본다)은 그대로 유지한다.
const poserHelpersSource = readFileSync(
  new URL("./studio-vrm-poser-helpers.ts", import.meta.url),
  "utf8",
);
const projectArchiveSource = readFileSync(
  new URL("../studio-project-archive-orchestration-runtime.ts", import.meta.url),
  "utf8",
);

function requiredIndex(source: string, token: string, from = 0): number {
  const index = source.indexOf(token, from);
  if (index < 0) {
    throw new Error(`Expected source token was not found: ${token}`);
  }
  return index;
}

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = requiredIndex(source, startToken);
  const end = requiredIndex(source, endToken, start + startToken.length);
  return source.slice(start, end);
}

describe("Studio VRM texture-paint wiring boundary", () => {
  it("restores only after the active model matches and keeps idle/error fail-closed states", () => {
    const modelIdentityStart = requiredIndex(
      poserSource,
      "const activeTexturePaintRestoreEntry =",
    );
    const modelIdentityEnd = requiredIndex(
      poserSource,
      "texturePaintRestoreGenerationRef.current += 1;",
      modelIdentityStart,
    );
    const modelIdentity = poserSource.slice(modelIdentityStart, modelIdentityEnd);
    const restoreEffect = sourceBetween(
      poserSource,
      "texturePaintRestoreGenerationRef.current += 1;",
      "const cancelPendingInsertCapture =",
    );
    const mismatchGate = requiredIndex(
      restoreEffect,
      "if (!texturePaintRestoreModelMatches)",
    );
    const mismatchIdle = requiredIndex(
      restoreEffect,
      'setTexturePaintPersistenceStatus("idle")',
      mismatchGate,
    );
    const restoring = requiredIndex(
      restoreEffect,
      'setTexturePaintPersistenceStatus("restoring")',
      mismatchIdle,
    );
    const persistenceImport = requiredIndex(
      restoreEffect,
      'import("./studio-vrm-texture-paint-persistence")',
      restoring,
    );
    const rehydrate = requiredIndex(
      restoreEffect,
      "rehydrateStudioVrmTexturePaintRuntime(",
      persistenceImport,
    );
    const ready = requiredIndex(
      restoreEffect,
      'setTexturePaintPersistenceStatus("ready")',
      rehydrate,
    );
    const error = requiredIndex(
      restoreEffect,
      'setTexturePaintPersistenceStatus("error")',
      ready,
    );

    expect(modelIdentity).toContain("installedModelId === activeModelId");
    expect(modelIdentity).toContain(
      'initialScene.model.source === "bundled"',
    );
    expect(modelIdentity).toContain(
      "activeTexturePaintRestoreEntry.id === initialScene.model.id",
    );
    expect(modelIdentity).toContain(
      "canonicalizeVrmContentHash(activeTexturePaintRestoreEntry.contentHash)",
    );
    expect(restoreEffect.slice(rehydrate, ready)).toContain(
      "initialScene.surfacePaint",
    );
    expect(mismatchGate).toBeLessThan(mismatchIdle);
    expect(mismatchIdle).toBeLessThan(restoring);
    expect(restoring).toBeLessThan(persistenceImport);
    expect(persistenceImport).toBeLessThan(rehydrate);
    expect(rehydrate).toBeLessThan(ready);
    expect(ready).toBeLessThan(error);
  });

  it("reloads changed scene models, keeps thumbnails behind restoration, and exposes retry", () => {
    expect(poserSource).toContain("}, [initialSceneModelIdentity, open]);");
    expect(poserSource).toContain("setInstalledModelId(null);");
    expect(poserSource).toContain("setInstalledModelId(nextModelId);");

    const thumbnailEffect = sourceBetween(
      poserSource,
      'texturePaintPersistenceStatus !== "ready"',
      "function clearCurrentVrm()",
    );
    expect(thumbnailEffect).toContain("activeLibraryEntry.thumbnail");
    expect(thumbnailEffect).toContain("saveVrmThumbnail(");

    expect(poserSource).toContain("setTexturePaintRestoreRetryToken((token: number) => token + 1)");
    expect(poserSource).toContain("onRetryRestore={() => {");
  });

  it("blocks insert for unfinished restoration and persists paint before scene capture", () => {
    const insertHandler = sourceBetween(
      poserSource,
      "function handleInsert()",
      "if (!open) return null;",
    );
    const restoringGate = requiredIndex(
      insertHandler,
      'texturePaintPersistenceStatus === "restoring"',
    );
    const errorGate = requiredIndex(
      insertHandler,
      'texturePaintPersistenceStatus === "error"',
      restoringGate,
    );
    const idleGate = requiredIndex(
      insertHandler,
      'texturePaintPersistenceStatus !== "ready"',
      errorGate,
    );
    const captureState = requiredIndex(
      insertHandler,
      "const currentCapture = captureRef.current",
      idleGate,
    );
    const persistenceImport = requiredIndex(
      insertHandler,
      'import("./studio-vrm-texture-paint-persistence")',
      captureState,
    );
    const persist = requiredIndex(
      insertHandler,
      "persistStudioVrmTexturePaintRuntime(",
      persistenceImport,
    );
    const captureRevalidation = requiredIndex(
      insertHandler,
      "!capturePreconditionsAreCurrent()",
      persist,
    );
    const bakedPose = requiredIndex(
      insertHandler,
      "const bakedPose = bakeStudioVrmRuntimePose(",
      captureRevalidation,
    );
    const sceneDocument = requiredIndex(
      insertHandler,
      "const sceneDocument = createCurrentSceneDocument(",
      bakedPose,
    );
    const rgbaCapture = requiredIndex(
      insertHandler,
      "captureStudioVrmRgba(",
      sceneDocument,
    );
    const insert = requiredIndex(insertHandler, "const accepted = await onInsert(", rgbaCapture);

    expect(insertHandler.slice(errorGate, idleGate)).toContain(
      "texturePaintPersistenceError",
    );
    expect(insertHandler.slice(errorGate, captureState)).toContain(
      "texturePaintRestoreRequired",
    );
    expect(insertHandler.slice(persist, sceneDocument)).toContain(
      "captureController.signal",
    );
    expect(persist).toBeLessThan(captureRevalidation);
    expect(captureRevalidation).toBeLessThan(bakedPose);
    expect(insertHandler.slice(sceneDocument, rgbaCapture)).toContain(
      "surfacePaint",
    );
    expect(restoringGate).toBeLessThan(errorGate);
    expect(errorGate).toBeLessThan(idleGate);
    expect(idleGate).toBeLessThan(captureState);
    expect(persistenceImport).toBeLessThan(persist);
    expect(persist).toBeLessThan(sceneDocument);
    expect(sceneDocument).toBeLessThan(rgbaCapture);
    expect(rgbaCapture).toBeLessThan(insert);
  });

  it("locks every paint mutation and validates the live runtime content revision during capture", () => {
    const insertHandler = sourceBetween(
      poserSource,
      "function handleInsert()",
      "if (!open) return null;",
    );
    const revisionSnapshot = requiredIndex(
      insertHandler,
      "currentTexturePaintRuntime?.getContentRevision() ?? 0",
    );
    const revisionGate = requiredIndex(
      insertHandler,
      "currentTexturePaintRuntime?.getContentRevision() ?? 0",
      revisionSnapshot + 1,
    );
    const lock = requiredIndex(
      insertHandler,
      "texturePaintMutationBlockedRef.current = true;",
      revisionGate,
    );
    const persistence = requiredIndex(
      insertHandler,
      "persistStudioVrmTexturePaintRuntime(",
      lock,
    );
    const screenshot = requiredIndex(insertHandler, "captureStudioVrmRgba(", persistence);

    expect(revisionSnapshot).toBeLessThan(revisionGate);
    expect(revisionGate).toBeLessThan(lock);
    expect(lock).toBeLessThan(persistence);
    expect(persistence).toBeLessThan(screenshot);
    expect(insertHandler).toContain("releaseCaptureMutationLocks();");

    const undo = sourceBetween(
      poserSource,
      "const handleTexturePaintUndo =",
      "const handleTexturePaintRedo =",
    );
    const redo = sourceBetween(
      poserSource,
      "const handleTexturePaintRedo =",
      "const handleTexturePaintReset =",
    );
    const reset = sourceBetween(
      poserSource,
      "const handleTexturePaintReset =",
      "const cancelActiveTexturePaintStroke =",
    );
    expect(undo).toContain("texturePaintMutationBlockedRef.current");
    expect(redo).toContain("texturePaintMutationBlockedRef.current");
    expect(reset).toContain("texturePaintMutationBlockedRef.current");

    const pointerHandlers = sourceBetween(
      poserSource,
      "const beginTexturePaint =",
      "const finishTexturePaint =",
    );
    expect(pointerHandlers.match(/texturePaintMutationBlockedRef\.current/gu))
      .toHaveLength(3);
  });

  it("recreates paint runtime only when canonical initial surface-paint identity changes", () => {
    const identityHelper = sourceBetween(
      poserHelpersSource,
      "function studioVrmTexturePaintSceneIdentity(",
      "export const EXPORT_HEIGHT",
    );
    expect(identityHelper).toContain("JSON.stringify(scene.surfacePaint)");
    expect(identityHelper).not.toContain("scene.model");
    expect(poserSource).toContain(
      "}, [texturePaintDevicePlan, texturePaintSceneIdentity, vrm]);",
    );

    const restoreEffect = sourceBetween(
      poserSource,
      "texturePaintRestoreGenerationRef.current += 1;",
      "const cancelPendingInsertCapture =",
    );
    const identityGate = requiredIndex(
      restoreEffect,
      "texturePaintRuntimeSceneIdentity !== texturePaintSceneIdentity",
    );
    const emptySceneReady = requiredIndex(
      restoreEffect,
      "initialScene.surfacePaint.textures.length === 0",
      identityGate,
    );
    expect(identityGate).toBeLessThan(emptySceneReady);

    const interactionGate = sourceBetween(
      poserSource,
      "const texturePaintSceneSyncRequired =",
      "const texturePaintInteractionEnabled =",
    );
    expect(interactionGate).toContain(
      "texturePaintRuntimeSceneIdentity !== texturePaintSceneIdentity",
    );
    expect(interactionGate).toContain("texturePaintSceneSyncRequired");
  });

  it("prepares verified paint PNG attachments before building the archive", () => {
    const archiveExport = sourceBetween(
      projectArchiveSource,
      "async function handleExportProjectArchive()",
      "function handleImportProject(",
    );
    const paintExport = requiredIndex(
      archiveExport,
      "prepareStudioVrmTexturePaintProjectArchiveExport({",
    );
    const archiveBuild = requiredIndex(
      archiveExport,
      "buildStudioProjectArchiveWithVerifiedBg3dModels({",
      paintExport,
    );
    const paintAttachments = requiredIndex(
      archiveExport,
      "...texturePaintAttachments",
      archiveBuild,
    );

    expect(archiveExport.slice(paintExport, archiveBuild)).toContain(
      "canonicalProject: project",
    );
    expect(archiveExport.slice(paintExport, archiveBuild)).toContain(
      "limits: isMobile ? MOBILE_PROJECT_ARCHIVE_LIMITS : undefined",
    );
    expect(archiveBuild).toBeLessThan(paintAttachments);
  });

  it("restores archive paint PNGs to the local library before applying the project", () => {
    const archiveImport = sourceBetween(
      projectArchiveSource,
      "async function handleImportProjectArchive(",
      "    } finally {",
    );
    const archiveRead = requiredIndex(archiveImport, "importStudioProjectArchive(file");
    const vrmRestore = requiredIndex(
      archiveImport,
      "restoreStudioVrmProjectArchiveImport(",
      archiveRead,
    );
    const paintPrepare = requiredIndex(
      archiveImport,
      "prepareStudioVrmTexturePaintProjectArchiveImport({",
      vrmRestore,
    );
    const postRestoreMutationGate = requiredIndex(
      archiveImport,
      "if (!canApplyStudioMutation(mutationTicket)) return;",
      paintPrepare,
    );
    const paintInstall = requiredIndex(
      archiveImport,
      "installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(",
      postRestoreMutationGate,
    );
    const projectApply = requiredIndex(
      archiveImport,
      "applyStudioProjectSnapshotWithPreparedDocuments(",
      paintInstall,
    );
    const presentation = requiredIndex(
      archiveImport,
      "presentStudioVrmTexturePaintProjectArchiveImport({",
      projectApply,
    );
    const statusUpdate = requiredIndex(
      archiveImport,
      "setProjectArchiveStatus(texturePaintArchivePresentation.notice)",
      presentation,
    );

    const prepareArguments = archiveImport.slice(paintPrepare, postRestoreMutationGate);
    expect(prepareArguments).toContain("project: preparedVrmModels.project");
    expect(prepareArguments).toContain(
      "canonicalProject: preparedVrmModels.canonicalProject",
    );
    expect(prepareArguments).toContain("manifest: result.manifest");
    expect(prepareArguments).toContain("attachments: result.attachments");
    expect(archiveRead).toBeLessThan(vrmRestore);
    expect(vrmRestore).toBeLessThan(paintPrepare);
    expect(paintPrepare).toBeLessThan(postRestoreMutationGate);
    expect(postRestoreMutationGate).toBeLessThan(paintInstall);
    expect(paintInstall).toBeLessThan(projectApply);
    expect(projectApply).toBeLessThan(presentation);
    expect(presentation).toBeLessThan(statusUpdate);
  });

  it("awaits the JSON paint inspection facade before download and publishes its notice afterward", () => {
    const jsonExport = sourceBetween(
      projectArchiveSource,
      "async function handleExportProject()",
      "async function handleExportProjectArchive()",
    );
    const inspection = requiredIndex(
      jsonExport,
      "inspectStudioVrmTexturePaintJsonExport(",
    );
    const download = requiredIndex(
      jsonExport,
      "link.click()",
      inspection,
    );
    const notice = requiredIndex(
      jsonExport,
      "if (texturePaintNotice) setProjectArchiveStatus(texturePaintNotice)",
      download,
    );

    expect(inspection).toBeLessThan(download);
    expect(download).toBeLessThan(notice);
  });
});
