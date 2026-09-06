import {
  createBgCustomModelInstance,
  StudioBg3dThreeOperationError,
  type BgCustomModelInstance,
} from "../studio-background-3d-model";
import {
  mergeStudioGeneric3dWorkflowMaps,
  normalizeStudioGeneric3dSourceFormat,
} from "../studio-generic-3d-workflow-metadata";

import {
  deriveStudioBg3dGlbValidationPolicy,
  type StudioBg3dResolvedDeviceQuality,
} from "./studio-bg3d-device-quality";
import {
  StudioBg3dStaleModalOperationError,
  studioBg3dModalOperationCoordinator,
  type StudioBg3dModalSession,
} from "./studio-bg3d-modal-operation-coordinator";
import {
  createStudioBg3dModelAttachment,
  deleteStoredBg3dModelV12 as deleteStoredBg3dModel,
  getStoredBg3dModelV12 as getStoredBg3dModel,
  importVerifiedBg3dModelsAtomicallyV12 as importVerifiedBg3dModelsAtomically,
  listBg3dModelLibraryEntriesV12 as listBg3dModelLibraryEntries,
  type Bg3dModelImportItem,
  type Bg3dModelLibraryEntry,
  type Bg3dVerifiedStoredRecord,
} from "./studio-bg3d-model-library-loader";
import {
  assertStudioBg3dModelAttachmentAdmission,
  calculateStudioBg3dPlacedModelBytes,
  StudioBg3dModelPlacementAdmissionError,
} from "./studio-bg3d-model-placement-admission";
import {
  admitAndCacheStudioBg3dModel as admitAndCacheModel,
  bindModelAttachment,
  withStudioGeneric3dWorkflowMetadata,
  type StudioBg3dModelRootCacheEntry as ModelRootCacheEntry,
} from "./studio-bg3d-model-runtime-admission";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
  type StudioBg3dModelAttachment,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  preflightAndDeleteStudioBg3dPersistedModel,
  type StudioBg3dSceneRemovalSuccess,
} from "./studio-bg3d-scene-removal";

import type { BgPrimitive } from "../studio-background-3d-primitives";
import type {
  StudioGeneric3dClassification,
  StudioGeneric3dSourceFormat,
} from "../studio-generic-3d-model-mode";
import type { StudioBg3dDestructiveMutationGuard } from "./studio-bg3d-destructive-mutation-guard";
import type { StudioBg3dKtx2Renderer } from "./studio-bg3d-ktx2-renderer-runtime";
import type { StudioBg3dImportProgress } from "./studio-bg3d-model-import";
import type { StudioBg3dPlacementSessionState } from "./studio-bg3d-placement-session";
import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";

/** Authoritative live scene the editor advances between an event and React's next render. */
interface StudioBg3dLiveSceneSnapshotRef {
  current: {
    primitives: BgPrimitive[];
    customModels: BgCustomModelInstance[];
    document: StudioBg3dSceneDocument;
  };
}

/**
 * Every editor local the model-library import/delete actions read, under the exact names the
 * original `StudioBackground3D` body used. Refs stay refs so reads and mutations keep identity.
 */
export interface StudioBg3dModelImportActionsContext {
  readonly attachmentByStorageModelIdRef: RefObject<Map<string, StudioBg3dModelAttachment>>;
  readonly captureInFlightRef: RefObject<boolean>;
  readonly destructiveMutationGuardRef: RefObject<StudioBg3dDestructiveMutationGuard>;
  readonly modalAssetSessionRef: RefObject<StudioBg3dModalSession | null>;
  readonly modelImportAbortRef: RefObject<AbortController | null>;
  readonly modelLoadPendingRef: RefObject<Map<string, Promise<ModelRootCacheEntry>>>;
  readonly modelRootCacheRef: RefObject<Map<string, ModelRootCacheEntry>>;
  readonly physicsRuntimeSourceRef: StudioBg3dLiveSceneSnapshotRef;
  readonly placementSessionRef: RefObject<StudioBg3dPlacementSessionState>;
  readonly sceneRestoreAbortRef: RefObject<AbortController | null>;
  readonly storageModelIdByAttachmentIdRef: RefObject<Map<string, string>>;

  readonly deviceQuality: StudioBg3dResolvedDeviceQuality;
  readonly genericModelClassifications: ReadonlyMap<string, StudioGeneric3dClassification>;
  readonly isRestoringScene: boolean;
  readonly modelRenderer: StudioBg3dKtx2Renderer | null;
  readonly sceneBaseDocument: StudioBg3dSceneDocument;

  readonly setCustomModels: Dispatch<SetStateAction<BgCustomModelInstance[]>>;
  readonly setDeletingModelId: Dispatch<SetStateAction<string | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setGenericModelClassifications: Dispatch<
    SetStateAction<ReadonlyMap<string, StudioGeneric3dClassification>>
  >;
  readonly setGenericModelSourceFormats: Dispatch<
    SetStateAction<ReadonlyMap<string, StudioGeneric3dSourceFormat>>
  >;
  readonly setIsUploadingModel: Dispatch<SetStateAction<boolean>>;
  readonly setModelImportProgress: Dispatch<SetStateAction<StudioBg3dImportProgress | null>>;
  readonly setModelLibrary: Dispatch<SetStateAction<Bg3dModelLibraryEntry[]>>;
  readonly setModelLibraryStatus: Dispatch<
    SetStateAction<"idle" | "loading" | "ready" | "degraded" | "error">
  >;
  readonly setRefTick: Dispatch<SetStateAction<number>>;
  readonly setSelectedIds: Dispatch<SetStateAction<Set<string>>>;

  readonly canAdmitSceneNodes: (additionalNodeCount: number) => boolean;
  readonly cancelCustomModelPlacement: (message?: string) => void;
  readonly commitSceneEntityRemoval: (
    plan: StudioBg3dSceneRemovalSuccess,
    options?: { readonly resetHistory?: boolean },
  ) => void;
  readonly invalidateModelThumbnailCaptures: () => Promise<void> | null;
  readonly isModalAssetSessionCurrent: (session: StudioBg3dModalSession) => boolean;
  readonly startModelThumbnailCaptureBatch: (
    records: readonly Bg3dVerifiedStoredRecord[],
    session: StudioBg3dModalSession,
  ) => void;
}

/** The two model-library actions the asset library panel drives, bound to one editor context. */
export interface StudioBg3dModelImportActions {
  readonly handleUploadModelFiles: (
    event: ChangeEvent<HTMLInputElement>,
    rights: NonNullable<Bg3dModelImportItem["rights"]>,
  ) => Promise<void>;
  readonly handleDeleteModelFromLibrary: (id: string) => Promise<void>;
}

/**
 * Binds the verified-import and persistent-delete actions to one explicit editor context. Nothing
 * runs until an action is invoked, so both keep the "read the live render scope at event time"
 * semantics the inline handlers had.
 */
export function createStudioBg3dModelImportActions(
  ctx: StudioBg3dModelImportActionsContext,
): StudioBg3dModelImportActions {
  const {
    attachmentByStorageModelIdRef,
    canAdmitSceneNodes,
    cancelCustomModelPlacement,
    captureInFlightRef,
    commitSceneEntityRemoval,
    destructiveMutationGuardRef,
    deviceQuality,
    genericModelClassifications,
    invalidateModelThumbnailCaptures,
    isModalAssetSessionCurrent,
    isRestoringScene,
    modalAssetSessionRef,
    modelImportAbortRef,
    modelLoadPendingRef,
    modelRenderer,
    modelRootCacheRef,
    physicsRuntimeSourceRef,
    placementSessionRef,
    sceneBaseDocument,
    sceneRestoreAbortRef,
    setCustomModels,
    setDeletingModelId,
    setError,
    setGenericModelClassifications,
    setGenericModelSourceFormats,
    setIsUploadingModel,
    setModelImportProgress,
    setModelLibrary,
    setModelLibraryStatus,
    setRefTick,
    setSelectedIds,
    startModelThumbnailCaptureBatch,
    storageModelIdByAttachmentIdRef,
  } = ctx;

  async function handleUploadModelFiles(
    event: ChangeEvent<HTMLInputElement>,
    rights: NonNullable<Bg3dModelImportItem["rights"]>,
  ) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = ""; // StudioVrmPoser.tsx handleFileChange와 동일 — 같은 파일 재선택 허용
    if (files.length === 0) return;
    if (placementSessionRef.current.phase === "preview") cancelCustomModelPlacement();
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;

    // A new import supersedes only thumbnail post-processing. Verified model import itself proceeds
    // even while another non-thumbnail capture owns the renderer and may leave placeholders.
    invalidateModelThumbnailCaptures();
    modelImportAbortRef.current?.abort();
    const importController = new AbortController();
    modelImportAbortRef.current = importController;
    setIsUploadingModel(true);
    setError(null);
    const uploadOwnedCacheEntries = new Map<string, ModelRootCacheEntry>();
    let uploadCommitted = false;
    let thumbnailCandidates: readonly Bg3dVerifiedStoredRecord[] = [];
    let plannedSourceFormats: readonly StudioGeneric3dSourceFormat[] = [];
    let modelImportRuntime: typeof import("./studio-bg3d-model-import") | null = null;
    const cleanupUncommittedUploadCache = () => {
      const liveStorageIds = new Set(
        physicsRuntimeSourceRef.current.customModels.map((model) => model.modelId),
      );
      for (const [storageId, ownedEntry] of uploadOwnedCacheEntries) {
        if (liveStorageIds.has(storageId)) continue;
        if (modelRootCacheRef.current.get(storageId) !== ownedEntry) continue;
        ownedEntry.dispose();
        modelRootCacheRef.current.delete(storageId);
      }
      uploadOwnedCacheEntries.clear();
    };
    try {
      const policy = deriveStudioBg3dGlbValidationPolicy(sceneBaseDocument, deviceQuality);
      modelImportRuntime = await import("./studio-bg3d-model-import");
      const loadedModelImportRuntime = modelImportRuntime;
      if (!isModalAssetSessionCurrent(session)) throw new StudioBg3dStaleModalOperationError();
      if (importController.signal.aborted) {
        throw new modelImportRuntime.StudioBg3dModelImportError("aborted");
      }
      const importPlan = modelImportRuntime.planStudioBg3dModelImports(files);
      if (!canAdmitSceneNodes(importPlan.items.length)) {
        throw new modelImportRuntime.StudioBg3dModelImportError("node-budget-exceeded");
      }
      const hasSelectedMtl = [...importPlan.resources.keys()].some((path) =>
        path.toLocaleLowerCase("en-US").endsWith(".mtl")
      );
      plannedSourceFormats = Object.freeze(importPlan.items.map((item) => {
        if (item.format === "gltf") return "gltf";
        if (item.format === "obj") return hasSelectedMtl ? "obj-mtl" : "obj";
        return "glb";
      }));
      const canonicalInputs = await modelImportRuntime.convertStudioBg3dModelFilesToGlb(files, {
        executionBackend: "worker",
        profile: policy.profile,
        budgets: policy.budgets,
        signal: importController.signal,
        onProgress: (progress) => {
          studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
            setModelImportProgress(progress);
          });
        },
      });
      if (!isModalAssetSessionCurrent(session)) throw new StudioBg3dStaleModalOperationError();
      const imported = await importVerifiedBg3dModelsAtomically(
        canonicalInputs.map((file) => ({ file, rights })),
        {
          executionBackend: "worker",
          profile: policy.profile,
          budgets: policy.budgets,
          signal: importController.signal,
        },
      );
      const saved: Bg3dVerifiedStoredRecord[] = [];
      for (const importedRecord of imported) {
        if (!isModalAssetSessionCurrent(session)) {
          throw new StudioBg3dStaleModalOperationError();
        }
        const storedRecord = await getStoredBg3dModel(importedRecord.id);
        if (
          !storedRecord ||
          storedRecord.contentHash !== importedRecord.contentHash ||
          storedRecord.byteSize !== importedRecord.byteSize
        ) {
          throw new Error("stored-record-mismatch");
        }
        saved.push(storedRecord);
      }
      await studioBg3dModalOperationCoordinator.runSceneMutation(
        session,
        async (lease) => {
          lease.throwIfRevoked();
          const libraryEntries = await listBg3dModelLibraryEntries();
          lease.throwIfRevoked();
          const liveScene = physicsRuntimeSourceRef.current;
          const liveModels = liveScene.customModels;
          const nodeLimit = Math.min(
            STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
            liveScene.document.budgets.complexity.maxNodes,
          );
          if (liveScene.primitives.length + liveModels.length > nodeLimit - saved.length) {
            throw new loadedModelImportRuntime.StudioBg3dModelImportError("node-budget-exceeded");
          }
          assertStudioBg3dModelAttachmentAdmission({
            models: liveModels,
            attachments: attachmentByStorageModelIdRef.current,
            candidateAttachments: saved.map((record) => ({
              hash: record.contentHash,
              byteSize: record.byteSize,
            })),
            maximumAttachments: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
            maximumCumulativeBytes: liveScene.document.budgets.complexity.maxModelBytes,
          });
          const stagedAttachments = new Map<string, StudioBg3dModelAttachment>();
          let cumulativeUsedBytes = calculateStudioBg3dPlacedModelBytes(
            liveModels,
            attachmentByStorageModelIdRef.current,
          );
          const countedHashes = new Set(
            liveModels.flatMap((model) => {
              const attachment = attachmentByStorageModelIdRef.current.get(model.modelId);
              return attachment ? [attachment.hash] : [];
            }),
          );
          for (let index = 0; index < saved.length; index += 1) {
            const record = saved[index]!;
            const existing = attachmentByStorageModelIdRef.current.get(record.id);
            const sourceFormat =
              normalizeStudioGeneric3dSourceFormat(plannedSourceFormats[index] ?? "glb") ?? "glb";
            const attachment = withStudioGeneric3dWorkflowMetadata(
              existing ?? await createStudioBg3dModelAttachment(record),
              {
                sourceFormat,
                classification: genericModelClassifications.get(record.id) ?? null,
              },
            );
            await admitAndCacheModel({
              record,
              document: sceneBaseDocument,
              quality: deviceQuality,
              cumulativeUsedBytes,
              renderer: modelRenderer,
              cache: modelRootCacheRef.current,
              pending: modelLoadPendingRef.current,
              isActive: () => isModalAssetSessionCurrent(session) && lease.isCurrent(),
              signal: lease.signal,
              onCacheEntryCreated: (storageId, cacheEntry) => {
                uploadOwnedCacheEntries.set(storageId, cacheEntry);
              },
            });
            stagedAttachments.set(record.id, attachment);
            if (!countedHashes.has(record.contentHash)) {
              countedHashes.add(record.contentHash);
              cumulativeUsedBytes += record.byteSize;
            }
          }

          // 모든 업로드가 검증·파싱된 뒤에 임시 Map에서 충돌까지 검사하고, 그 다음에만 실제 매핑과
          // 배치 배열을 한 번에 commit한다.
          const nextAttachmentByStorageId = new Map(attachmentByStorageModelIdRef.current);
          const nextStorageIdByAttachment = new Map(storageModelIdByAttachmentIdRef.current);
          for (const record of saved) {
            const attachment = stagedAttachments.get(record.id);
            if (!attachment || !bindModelAttachment({
              attachmentByStorageModelId: nextAttachmentByStorageId,
              storageModelIdByAttachmentId: nextStorageIdByAttachment,
            }, record, attachment)) {
              throw new Error("attachment-binding");
            }
          }
          return {
            libraryEntries,
            nextAttachmentByStorageId,
            nextStorageIdByAttachment,
            placements: saved.map((record, index) =>
              createBgCustomModelInstance(record.id, liveModels.length + index)
            ),
          };
        },
        ({
          libraryEntries,
          nextAttachmentByStorageId,
          nextStorageIdByAttachment,
          placements,
        }) => {
          const current = physicsRuntimeSourceRef.current;
          const nodeLimit = Math.min(
            STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
            current.document.budgets.complexity.maxNodes,
          );
          if (current.primitives.length + current.customModels.length > nodeLimit - placements.length) {
            throw new loadedModelImportRuntime.StudioBg3dModelImportError("node-budget-exceeded");
          }
          const candidateAttachments = placements.map((placement) => {
            const attachment = nextAttachmentByStorageId.get(placement.modelId);
            if (!attachment) throw new Error("attachment-binding");
            return attachment;
          });
          assertStudioBg3dModelAttachmentAdmission({
            models: current.customModels,
            attachments: nextAttachmentByStorageId,
            candidateAttachments,
            maximumAttachments: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
            maximumCumulativeBytes: current.document.budgets.complexity.maxModelBytes,
          });
          attachmentByStorageModelIdRef.current.clear();
          storageModelIdByAttachmentIdRef.current.clear();
          for (const [id, attachment] of nextAttachmentByStorageId) {
            attachmentByStorageModelIdRef.current.set(id, attachment);
          }
          for (const [attachmentId, id] of nextStorageIdByAttachment) {
            storageModelIdByAttachmentIdRef.current.set(attachmentId, id);
          }
          setModelLibrary(libraryEntries);
          const importedFormats = new Map<string, StudioGeneric3dSourceFormat>();
          for (let index = 0; index < saved.length; index += 1) {
            importedFormats.set(
              saved[index]!.id,
              normalizeStudioGeneric3dSourceFormat(plannedSourceFormats[index] ?? "glb") ?? "glb",
            );
          }
          setGenericModelSourceFormats((previous) =>
            mergeStudioGeneric3dWorkflowMaps(previous, importedFormats),
          );
          if (placements.length > 0) {
            const nextCustomModels = [...current.customModels, ...placements];
            physicsRuntimeSourceRef.current = {
              ...current,
              customModels: nextCustomModels,
            };
            setCustomModels(nextCustomModels);
            setSelectedIds(new Set([placements[placements.length - 1].id]));
            setRefTick((n) => n + 1);
          }
          uploadCommitted = true;
        },
      );
      thumbnailCandidates = saved;
    } catch (importFailure) {
      // 저장은 atomic import가 책임지고, 화면 배치는 별도 all-or-none이다. 이번 시도에서 처음 로드한
      // 캐시만 되돌려 기존 장면 인스턴스가 공유 중인 자원은 건드리지 않는다.
      if (!isModalAssetSessionCurrent(session)) return;
      setError(
        modelImportRuntime && importFailure instanceof modelImportRuntime.StudioBg3dModelImportError
          ? importFailure.message
          : importFailure instanceof StudioBg3dModelPlacementAdmissionError
            ? importFailure.message
          : importFailure instanceof StudioBg3dThreeOperationError
            ? importFailure.message
          : importController.signal.aborted
            ? "3D 모델 가져오기를 취소했습니다. 장면과 라이브러리는 변경하지 않았습니다."
            : "선택한 모델 중 하나가 변환·안전 검사 또는 기기 복잡도 기준을 통과하지 못해 아무 모델도 배치하지 않았습니다."
      );
      try {
        const entries = await listBg3dModelLibraryEntries();
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setModelLibrary(entries);
        });
      } catch {
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setModelLibraryStatus("error");
        });
      }
    } finally {
      if (!uploadCommitted) cleanupUncommittedUploadCache();
      if (modelImportAbortRef.current === importController) modelImportAbortRef.current = null;
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setModelImportProgress(null);
        setIsUploadingModel(false);
      });
    }
    if (uploadCommitted && thumbnailCandidates.length > 0) {
      startModelThumbnailCaptureBatch(thumbnailCandidates, session);
    }
  }

  async function handleDeleteModelFromLibrary(id: string) {
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    if (isRestoringScene || sceneRestoreAbortRef.current !== null) return;
    if (placementSessionRef.current.phase === "preview") cancelCustomModelPlacement();
    const thumbnailLeaseReleased = invalidateModelThumbnailCaptures();
    if (thumbnailLeaseReleased) await thumbnailLeaseReleased;
    if (!isModalAssetSessionCurrent(session) || captureInFlightRef.current) return;
    const destructiveLease = destructiveMutationGuardRef.current.begin();
    if (!destructiveLease) return;
    let removalPreflightFailed = false;
    setDeletingModelId(id);
    try {
      const mutation = await studioBg3dModalOperationCoordinator.runSceneMutation(
        session,
        async (lease) => {
          lease.throwIfRevoked();
          const attachment = attachmentByStorageModelIdRef.current.get(id);
          const plan = await preflightAndDeleteStudioBg3dPersistedModel({
            snapshot: physicsRuntimeSourceRef.current,
            storageModelId: id,
            ...(attachment ? { attachmentId: attachment.id } : {}),
            deletePersistedModel: (storageModelId) =>
              deleteStoredBg3dModel(storageModelId, { signal: lease.signal }),
          });
          // A committed deletion is authoritative; reconcile it or replay its durable journal.
          if (!plan.ok) {
            removalPreflightFailed = true;
            throw new Error("scene-removal-preflight-failed");
          }
          return { attachment, plan };
        },
        ({ attachment, plan }) => {
          commitSceneEntityRemoval(plan, { resetHistory: true });
          attachmentByStorageModelIdRef.current.delete(id);
          if (attachment) storageModelIdByAttachmentIdRef.current.delete(attachment.id);
          const cacheEntry = modelRootCacheRef.current.get(id);
          modelRootCacheRef.current.delete(id);
          if (cacheEntry) requestAnimationFrame(() => cacheEntry.dispose());
          setSelectedIds((current) => new Set(
            [...current].filter((selectedId) => !plan.removedEntityIds.has(selectedId)),
          ));
          setGenericModelSourceFormats((previous) => {
            if (!previous.has(id)) return previous;
            const next = new Map(previous);
            next.delete(id);
            return next;
          });
          setGenericModelClassifications((previous) => {
            if (!previous.has(id)) return previous;
            const next = new Map(previous);
            next.delete(id);
            return next;
          });
          setRefTick((n) => n + 1);
        },
        // IndexedDB deletion is an irreversible destructive boundary. Keep the lease comfortably
        // above the browser transaction watchdog so ordinary timer pressure cannot report a
        // committed delete as an abandoned scene operation.
        {
          timeoutMs: 10 * 60_000,
          authoritativePersistence: true,
        },
      );
      if (mutation.status === "stale") return;
      const entries = await listBg3dModelLibraryEntries();
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setModelLibrary(entries);
      });
    } catch {
      if (!isModalAssetSessionCurrent(session)) return;
      setError(removalPreflightFailed
        ? "자식 객체의 월드 변환을 보존할 수 없어 모델 원본 삭제를 시작하지 않았습니다."
        : "3D 모델을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      destructiveMutationGuardRef.current.finish(destructiveLease);
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setDeletingModelId(null);
      });
    }
  }

  return { handleDeleteModelFromLibrary, handleUploadModelFiles };
}
