/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

import {
  disposeStudioVrmAsset as disposeVrm,
} from "./studio-vrm-asset-runtime";
import {
  buildStudioVrmPersistentIkSignature,
} from "./studio-vrm-persistent-ik-signature";
import {
  DEFAULT_VRM_PHYSICS,
} from "./studio-vrm-physics";
import {
  createCharacterThumbnail,
  getErrorMessage,
  roundThumbnailCaptureSize,
} from "./studio-vrm-poser-helpers";
import {
  DEFAULT_VRM_PROP_RIG_METRICS,
} from "./studio-vrm-prop-rig";
import {
  captureStudioVrmRgba,
} from "./studio-vrm-raster-capture";
import {
  useStudioVrmModelLoading,
} from "./use-studio-vrm-model-loading";
import {
  hydrateVrmLibraryThumbnailWindow,
  memoryVrmLibraryEntry,
  queryUploadedVrmLibraryEntriesPage,
  SAMPLE_VRM_ID,
  SAMPLE_VRM_ENTRIES,
  saveVrmThumbnail,
  type VrmLibraryEntry,
} from "./vrm-library";

import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { PendingPoseData } from "./useStudioVrmPoserRuntimeC";

export function useStudioVrmPoserRuntimeD(h: StudioVrmPoserHost): void {
  const {
    open,
    status,
    setStatus,
    setError,
    vrm,
    customBones,
    customYOffset,
    poseTranslations,
    ikConstraints,
    rigJointProfile,
    setRigJointProfile,
    fullBodyIkEnabled,
    setFullBodyIkEnabled,
    footPlantEnabled,
    setFootPlantEnabled,
    rigFloorHeight,
    setRigFloorHeight,
    lockedPoseBones,
    setIsViewportHandIkDragging,
    setActiveCameraId,
    setTexturePaintEyedropperActive,
    texturePaintPersistenceStatus,
    bodyRotation,
    setMannequinMode,
    setSelectedJointHandle,
    setSelectedIkPole,
    setIkHandleDragMode,
    setIkHandleAxisLock,
    setJointHandleInteracting,
    setJointHandleStatus,
    broadcastPreviewReceipt,
    setBroadcastPreviewReceipt,
    setBroadcastPreviewError,
    broadcastPreviewActive,
    isCapturing,
    setIsCapturing,
    setIsThumbnailCapturing,
    libraryEntries,
    setLibraryEntries,
    libraryNextCursor,
    setLibraryNextCursor,
    isLoadingLibraryPage,
    setIsLoadingLibraryPage,
    memoryVrmModelsRef,
    thumbnailWindowKeyRef,
    thumbnailWindowAbortRef,
    setLibraryStatus,
    setLibraryError,
    activeModelId,
    setActiveModelId,
    activeModelIdRef,
    modelLoadTargetIdRef,
    setIsUploading,
    setDeletingModelId,
    bodyScale,
    avatarForgeState,
    avatarForgeFaceController,
    fingerEdits,
    isSharingPose,
    setIsSharingPose,
    setActiveProps,
    setPropAttachments,
    setSelectedPropId,
    setVrmPropItems,
    setSelectedVrmPropUid,
    setCostumeState,
    setCostumeMeshes,
    setSelectedCostumeKey,
    setWardrobeState,
    setWardrobeMetrics,
    setPropRigMetrics,
    setWardrobeAutoHide,
    setVrmPhysics,
    setPhysicsPreview,
    setSpringJointCount,
    vrmRef,
    vrmInstallGenerationRef,
    proportionRigRuntimeRef,
    proportionRigReceiptRef,
    proportionPoseReapplyRef,
    avatarForgeAuthorityIdentityRef,
    captureVisualAuthorityRef,
    loadRequestRef,
    thumbnailRequestRef,
    captureOperationRef,
    captureRef,
    captureRequestRef,
    jointIkTransactionRef,
    persistentIkResolvedSignatureRef,
    persistentIkReconciling,
    groundShadowRef,
    envRootRef,
    captureHelperLeaseCountRef,
    acquireVrmCaptureOperation,
    releaseVrmCaptureOperation,
    acquireVrmCaptureHelperLease,
    cancelPendingInsertCapture,
    cancelPendingPoseShare,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
    proportionRigCaptureIsReady,
    avatarForgeFaceCaptureIsReady,
    captureVisualAuthorityIdentity,
    resetFullStateHistory,
    finishBroadcastPreview,
    activeLibraryEntry,
    pendingPoseDataRef,
    initialSceneModelIdentity,
  } = h;

  // Effect Event so the dispose runs on true unmount only. With the cancel* callbacks as deps, any
  // identity churn re-fires this cleanup, bumping loadRequestRef while modelLoadTargetIdRef still
  // reads "in progress" — the open effect then skips the reload and the poser sits on
  // status="loading" forever.
  const disposeVrmOnUnmount = useEffectEvent(() => {
    cancelPendingInsertCapture();
    cancelPendingPoseShare();
    cancelPendingSharedPoseCatalog();
    cancelPendingSharedPoseSelection();
    thumbnailRequestRef.current += 1;
    thumbnailWindowAbortRef.current?.abort();
    thumbnailWindowAbortRef.current = null;
    thumbnailWindowKeyRef.current = "";
    jointIkTransactionRef.current = null;
    loadRequestRef.current += 1;
    modelLoadTargetIdRef.current = null;
    avatarForgeFaceController.release();
    const proportionRuntime = proportionRigRuntimeRef.current;
    if (proportionRuntime && !proportionRuntime.disposed) proportionRuntime.dispose();
    proportionRigRuntimeRef.current = null;
    proportionRigReceiptRef.current = null;
    proportionPoseReapplyRef.current = null;
    vrmInstallGenerationRef.current += 1;
    if (vrmRef.current) {
      disposeVrm(vrmRef.current);
      vrmRef.current = null;
    }
  });

  useEffect(() => {
    return () => disposeVrmOnUnmount();
  }, []);

  const clearCurrentVrmOnClose = useEffectEvent(() => {
    h.clearCurrentVrm();
  });

  useEffect(() => {
    if (open) return;
    if (broadcastPreviewReceipt) {
      finishBroadcastPreview({ restoreFocus: false });
    }
    cancelPendingInsertCapture();
    cancelPendingPoseShare();
    cancelPendingSharedPoseCatalog();
    cancelPendingSharedPoseSelection();
    captureRequestRef.current += 1;
    jointIkTransactionRef.current = null;
    loadRequestRef.current += 1;
    thumbnailRequestRef.current += 1;
    thumbnailWindowAbortRef.current?.abort();
    thumbnailWindowAbortRef.current = null;
    thumbnailWindowKeyRef.current = "";
    captureHelperLeaseCountRef.current = 0;
    modelLoadTargetIdRef.current = null;
    if (groundShadowRef.current) groundShadowRef.current.visible = true;
    if (envRootRef.current) envRootRef.current.visible = true;
    clearCurrentVrmOnClose();
    captureRef.current = { camera: null, gl: null, scene: null };
    setStatus("empty");
    setError("");
    setIsCapturing(false);
    setIsThumbnailCapturing(false);
    setIsSharingPose(false);
    setBroadcastPreviewReceipt(null);
    setBroadcastPreviewError("");
    captureOperationRef.current = null;
    setTexturePaintEyedropperActive(false);
    setIsViewportHandIkDragging(false);
    setJointHandleInteracting(false);
    setJointHandleStatus("");
    setSelectedJointHandle(null);
    setSelectedIkPole(null);
    setIkHandleDragMode("screen");
    setIkHandleAxisLock("free");
    setRigJointProfile("neutral");
    setFullBodyIkEnabled(false);
    setFootPlantEnabled(false);
    setRigFloorHeight(0);
    setMannequinMode(false);
    setActiveCameraId("front");
    setActiveProps([]);
    setPropAttachments({});
    setSelectedPropId(null);
    setVrmPropItems([]);
    setSelectedVrmPropUid(null);
    setCostumeState({ hidden: [], recolor: {} });
    setCostumeMeshes([]);
    setSelectedCostumeKey(null);
    setWardrobeState({});
    setWardrobeAutoHide(true);
    setWardrobeMetrics(null);
    setPropRigMetrics(DEFAULT_VRM_PROP_RIG_METRICS);
    setVrmPhysics(DEFAULT_VRM_PHYSICS);
    setPhysicsPreview(false);
    setSpringJointCount(0);
  }, [
    broadcastPreviewReceipt,
    open,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
    cancelPendingPoseShare,
    cancelPendingInsertCapture,
  ]);

  // 모델 로딩·라이브러리 파일 처리는 use-studio-vrm-model-loading 이 소유한다.
  // 설치(installVrm)와 요청 카운터·상태는 여기 남고 컨텍스트로만 주입된다.
  const {
    handleDeleteEntry,
    handleFileChange,
    handleGeneratedVrmFile,
    handleSampleLoad,
    loadModelFromLibraryEntry,
  } = useStudioVrmModelLoading({
    activeModelId,
    activeModelIdRef,
    broadcastPreviewActive,
    clearCurrentVrm: h.clearCurrentVrm,
    installVrm: h.installVrm,
    libraryEntries,
    loadRequestRef,
    memoryVrmModelsRef,
    modelLoadTargetIdRef,
    rememberCharacterSelection: h.rememberCharacterSelection,
    resetFullStateHistory,
    setActiveModelId,
    setDeletingModelId,
    setError,
    setIsUploading,
    setLibraryEntries,
    setLibraryError,
    setLibraryNextCursor,
    setLibraryStatus,
    setStatus,
    thumbnailRequestRef,
  });

  const loadModelRef = useRef(loadModelFromLibraryEntry);
  loadModelRef.current = loadModelFromLibraryEntry;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();
    setLibraryStatus("loading");
    setLibraryError("");

    const resolveTargetEntry = (
      entries: VrmLibraryEntry[],
      pending: PendingPoseData | null
    ): VrmLibraryEntry | null => {
      if (pending?.modelHash) {
        return entries.find((entry) => entry.contentHash === pending.modelHash) ?? null;
      }
      if (pending?.modelId) {
        return entries.find((entry) => entry.id === pending.modelId) ?? null;
      }
      if (pending?.modelName) {
        return entries.find((entry) => entry.name === pending.modelName) ?? null;
      }
      return entries.find((entry) => entry.id === activeModelIdRef.current) ?? entries[0] ?? null;
    };

    const loadResolvedEntry = (entries: VrmLibraryEntry[]): void => {
      const targetEntry = resolveTargetEntry(entries, pendingPoseDataRef.current);
      if (!targetEntry) {
        setStatus("error");
        setLibraryStatus("error");
        setLibraryError("이 장면이 사용하는 VRM 모델을 찾지 못했습니다. 프로젝트 모델 attachment를 먼저 복원해 주세요.");
        return;
      }
      // Skip only when this model is actually installed. A matching target id alone is not
      // enough — a cancelled in-flight load leaves the id set with vrmRef null, which would
      // strand the poser on "loading".
      if (modelLoadTargetIdRef.current === targetEntry.id && vrmRef.current) return;
      loadModelRef.current(targetEntry);
    };

    // Kick the sample load whenever nothing is installed yet (covers Strict Mode remount).
    if (
      pendingPoseDataRef.current === null
      && activeModelIdRef.current === SAMPLE_VRM_ID
      && !vrmRef.current
    ) {
      loadModelRef.current(SAMPLE_VRM_ENTRIES[0]);
    }

    void (async () => {
      try {
        const firstPage = await queryUploadedVrmLibraryEntriesPage({
          signal: controller.signal,
        });
        const entries: VrmLibraryEntry[] = [...SAMPLE_VRM_ENTRIES];
        const appendUnique = (entry: VrmLibraryEntry) => {
          if (entries.some((candidate) => (
            candidate.id === entry.id ||
            (candidate.contentHash && candidate.contentHash === entry.contentHash)
          ))) return;
          entries.push(entry);
        };
        for (const entry of firstPage?.items ?? []) appendUnique(entry);
        for (const record of memoryVrmModelsRef.current.values()) {
          appendUnique(memoryVrmLibraryEntry(record));
        }

        const pending = pendingPoseDataRef.current;
        const findRequestedEntry = (candidates: readonly VrmLibraryEntry[]) => {
          if (pending?.modelHash) {
            return candidates.find((entry) => entry.contentHash === pending.modelHash) ?? null;
          }
          if (pending?.modelId) {
            return candidates.find((entry) => entry.id === pending.modelId) ?? null;
          }
          if (pending?.modelName) {
            return candidates.find((entry) => entry.name === pending.modelName) ?? null;
          }
          return candidates.find((entry) => entry.id === activeModelIdRef.current) ?? null;
        };
        let targetEntry = findRequestedEntry(entries);
        let cursor = firstPage?.nextCursor ?? null;
        const seenCursors = new Set<string>();
        while (!targetEntry && cursor && !seenCursors.has(cursor)) {
          seenCursors.add(cursor);
          const page = await queryUploadedVrmLibraryEntriesPage({
            cursor,
            signal: controller.signal,
          });
          if (!page) break;
          targetEntry = findRequestedEntry(page.items);
          if (targetEntry && !entries.some((entry) => entry.id === targetEntry!.id)) {
            appendUnique(targetEntry);
          }
          cursor = page.nextCursor;
        }

        if (cancelled) return;
        setLibraryEntries(entries);
        setLibraryNextCursor(firstPage?.nextCursor ?? null);
        setLibraryStatus("ready");
        loadResolvedEntry(entries);
      } catch (caughtError: unknown) {
        if (cancelled) return;
        setLibraryEntries(SAMPLE_VRM_ENTRIES);
        setLibraryNextCursor(null);
        setLibraryStatus("error");
        setLibraryError(getErrorMessage(caughtError, "저장된 VRM 라이브러리를 불러오지 못했습니다."));
        loadResolvedEntry(SAMPLE_VRM_ENTRIES);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      // Let the next pass start a fresh load after a Strict Mode remount.
      loadRequestRef.current += 1;
      modelLoadTargetIdRef.current = null;
    };
  }, [initialSceneModelIdentity, open]);

  const handleLoadMoreVrmLibrary = useCallback(async () => {
    if (!open || !libraryNextCursor || isLoadingLibraryPage) return;
    setIsLoadingLibraryPage(true);
    setLibraryError("");
    try {
      const page = await queryUploadedVrmLibraryEntriesPage({
        cursor: libraryNextCursor,
      });
      if (!page) {
        const refreshed = await queryUploadedVrmLibraryEntriesPage();
        const memoryEntries = [...memoryVrmModelsRef.current.values()].map(
          memoryVrmLibraryEntry,
        );
        setLibraryEntries((current: VrmLibraryEntry[]) => {
          const next = [...SAMPLE_VRM_ENTRIES, ...(refreshed?.items ?? [])];
          const retainedActive = current.find(
            (entry: VrmLibraryEntry) => entry.id === activeModelIdRef.current,
          );
          for (const entry of [...(retainedActive ? [retainedActive] : []), ...memoryEntries]) {
            if (next.some((candidate) => (
              candidate.id === entry.id ||
              (candidate.contentHash && candidate.contentHash === entry.contentHash)
            ))) continue;
            next.push(entry);
          }
          return next;
        });
        setLibraryNextCursor(refreshed?.nextCursor ?? null);
        setLibraryStatus("error");
        setLibraryError("다른 작업에서 VRM 라이브러리가 변경되어 첫 페이지부터 안전하게 다시 불러왔습니다.");
        return;
      }
      setLibraryEntries((current: VrmLibraryEntry[]) => {
        const next = [...current];
        for (const entry of page.items) {
          if (next.some((candidate) => (
            candidate.id === entry.id ||
            (candidate.contentHash && candidate.contentHash === entry.contentHash)
          ))) continue;
          next.push(entry);
        }
        return next;
      });
      setLibraryNextCursor(page.nextCursor);
      setLibraryStatus("ready");
    } catch (caughtError: unknown) {
      setLibraryStatus("error");
      setLibraryError(getErrorMessage(caughtError, "저장된 VRM 다음 페이지를 불러오지 못했습니다."));
    } finally {
      setIsLoadingLibraryPage(false);
    }
  }, [isLoadingLibraryPage, libraryNextCursor, open]);

  async function handleRetryVrmLibraryRefresh() {
    if (!open || isLoadingLibraryPage) return;
    setIsLoadingLibraryPage(true);
    setLibraryStatus("loading");
    setLibraryError("");
    try {
      const firstPage = await queryUploadedVrmLibraryEntriesPage();
      const next = [...SAMPLE_VRM_ENTRIES, ...(firstPage?.items ?? [])];
      const retainedActive = libraryEntries.find(
        (entry: VrmLibraryEntry) => entry.id === activeModelIdRef.current,
      );
      const memoryEntries = [...memoryVrmModelsRef.current.values()].map(
        memoryVrmLibraryEntry,
      );
      for (const entry of [...(retainedActive ? [retainedActive] : []), ...memoryEntries]) {
        if (next.some((candidate) => (
          candidate.id === entry.id
          || (candidate.contentHash && candidate.contentHash === entry.contentHash)
        ))) continue;
        next.push(entry);
      }
      setLibraryEntries(next);
      setLibraryNextCursor(firstPage?.nextCursor ?? null);
      setLibraryStatus("ready");
    } catch (caughtError: unknown) {
      // Keep both the current catalog and cursor authoritative until a first-page read succeeds.
      setLibraryStatus("error");
      setLibraryError(getErrorMessage(
        caughtError,
        "VRM 라이브러리를 다시 불러오지 못했습니다. 현재 목록을 유지하고 있습니다.",
      ));
    } finally {
      setIsLoadingLibraryPage(false);
    }
  }

  const handleVisibleVrmThumbnailWindow = useCallback(
    (visibleEntries: readonly VrmLibraryEntry[]) => {
      const windowEntries = visibleEntries.slice(-12);
      const windowKey = windowEntries
        .map((entry) => `${entry.id}:${entry.updatedAt}`)
        .join("\u0000");
      if (thumbnailWindowKeyRef.current === windowKey) return;
      thumbnailWindowKeyRef.current = windowKey;
      thumbnailWindowAbortRef.current?.abort();
      const controller = new AbortController();
      thumbnailWindowAbortRef.current = controller;

      void hydrateVrmLibraryThumbnailWindow(windowEntries, {
        signal: controller.signal,
      }).then((hydrated) => {
        if (controller.signal.aborted || thumbnailWindowAbortRef.current !== controller) return;
        const hydratedById = new Map(hydrated.map((entry) => [entry.id, entry] as const));
        setLibraryEntries((current: VrmLibraryEntry[]) => current.map((entry: VrmLibraryEntry) => {
          const visible = hydratedById.get(entry.id);
          if (visible) return visible;
          const isBundledStaticThumbnail = entry.source === "sample"
            && entry.thumbnail?.startsWith("/vrm/thumbnails/");
          if (
            entry.source === "memory" ||
            entry.id === activeModelIdRef.current ||
            entry.thumbnail === null ||
            isBundledStaticThumbnail
          ) return entry;
          return { ...entry, thumbnail: null };
        }));
      }).catch((caughtError: unknown) => {
        if (controller.signal.aborted || thumbnailWindowAbortRef.current !== controller) return;
        setLibraryStatus("error");
        setLibraryError(getErrorMessage(caughtError, "표시 중인 VRM 썸네일을 불러오지 못했습니다."));
      });
    },
    [],
  );

  useEffect(() => {
    if (
      !open
      || status !== "ready"
      || broadcastPreviewActive
      || texturePaintPersistenceStatus !== "ready"
      || !vrm
      || !activeLibraryEntry
      || activeLibraryEntry.thumbnail
      || !proportionRigCaptureIsReady()
      || !avatarForgeFaceCaptureIsReady()
      || isCapturing
      || isSharingPose
    ) return;
    const hasLockedConstraint = ikConstraints.some((constraint: StudioVrmIkConstraint) => (
      constraint.enabled && constraint.locked
    ));
    const signature = buildStudioVrmPersistentIkSignature({
      modelId: activeModelId,
      bones: customBones,
      fingerEdits,
      yOffset: customYOffset,
      translations: poseTranslations,
      bodyRotation,
      bodyScale,
      proportions: avatarForgeState.proportions,
      constraints: ikConstraints,
      lockedPoseBones,
      jointProfile: rigJointProfile,
      fullBodyIk: fullBodyIkEnabled,
      footPlant: footPlantEnabled,
      floorHeight: rigFloorHeight,
    });
    if (
      hasLockedConstraint
      && (persistentIkReconciling || persistentIkResolvedSignatureRef.current !== signature)
    ) return;

    const requestId = thumbnailRequestRef.current + 1;
    thumbnailRequestRef.current = requestId;
    const thumbnailProportionRigReceipt = proportionRigReceiptRef.current;
    const thumbnailAvatarForgeIdentity = avatarForgeAuthorityIdentityRef.current;
    const thumbnailFaceControllerSnapshot = avatarForgeFaceController.getSnapshot();
    const thumbnailVisualAuthority = captureVisualAuthorityRef.current;
    if (!thumbnailVisualAuthority) return;
    if (!acquireVrmCaptureOperation("thumbnail")) return;
    const releaseCaptureHelpers = acquireVrmCaptureHelperLease();
    let finished = false;
    let secondFrame: number | null = null;
    setIsThumbnailCapturing(true);
    const finish = () => {
      if (finished) return;
      finished = true;
      releaseCaptureHelpers();
      releaseVrmCaptureOperation("thumbnail");
      setIsThumbnailCapturing(false);
    };
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        try {
          if (
            requestId !== thumbnailRequestRef.current
            || proportionRigReceiptRef.current !== thumbnailProportionRigReceipt
            || avatarForgeAuthorityIdentityRef.current !== thumbnailAvatarForgeIdentity
            || avatarForgeFaceController.getSnapshot() !== thumbnailFaceControllerSnapshot
            || captureVisualAuthorityRef.current?.identity !== thumbnailVisualAuthority.identity
          ) return;

          const currentCapture = captureRef.current;
          if (!currentCapture.gl || !currentCapture.scene || !currentCapture.camera) return;

          const { width, height } = roundThumbnailCaptureSize(currentCapture.gl.domElement);
          const rgba = captureStudioVrmRgba(
            currentCapture.gl,
            currentCapture.scene,
            currentCapture.camera,
            { width, height },
          );
          const thumbnail = createCharacterThumbnail(rgba, width, height);
          if (!thumbnail) return;

          setLibraryEntries((entries: VrmLibraryEntry[]) => entries.map((entry: VrmLibraryEntry) => (entry.id === activeLibraryEntry.id ? { ...entry, thumbnail } : entry)));
          if (activeLibraryEntry.source === "memory") {
            const memoryModel = memoryVrmModelsRef.current.get(activeLibraryEntry.id);
            if (memoryModel) {
              memoryVrmModelsRef.current.set(activeLibraryEntry.id, {
                ...memoryModel,
                thumbnail,
                updatedAt: Date.now(),
              });
            }
            return;
          }
          saveVrmThumbnail(activeLibraryEntry.id, thumbnail).catch((caughtError: unknown) => {
            setLibraryError(getErrorMessage(caughtError, "썸네일을 저장하지 못했습니다."));
          });
        } catch (caughtError) {
          setLibraryError(getErrorMessage(caughtError, "썸네일을 만들지 못했습니다."));
        } finally {
          finish();
        }
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
      finish();
    };
  }, [
    activeModelId,
    activeLibraryEntry,
    acquireVrmCaptureHelperLease,
    acquireVrmCaptureOperation,
    avatarForgeFaceCaptureIsReady,
    avatarForgeFaceController,
    avatarForgeState.proportions,
    bodyRotation,
    bodyScale,
    broadcastPreviewActive,
    captureVisualAuthorityIdentity,
    customBones,
    customYOffset,
    fingerEdits,
    footPlantEnabled,
    fullBodyIkEnabled,
    ikConstraints,
    isCapturing,
    isSharingPose,
    lockedPoseBones,
    open,
    persistentIkReconciling,
    poseTranslations,
    proportionRigCaptureIsReady,
    releaseVrmCaptureOperation,
    rigFloorHeight,
    rigJointProfile,
    status,
    texturePaintPersistenceStatus,
    vrm,
  ]);


  Object.assign(h, {
    disposeVrmOnUnmount,
    clearCurrentVrmOnClose,
    handleDeleteEntry,
    handleFileChange,
    handleGeneratedVrmFile,
    handleSampleLoad,
    loadModelFromLibraryEntry,
    loadModelRef,
    handleLoadMoreVrmLibrary,
    handleRetryVrmLibraryRefresh,
    handleVisibleVrmThumbnailWindow,
  });
}
