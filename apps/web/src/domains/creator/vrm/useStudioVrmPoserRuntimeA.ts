/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";

import {
  STUDIO_STAMP_BRUSH_DEFAULTS,
} from "../brush/studio-brush-stamp-engine";
import {
  confirmStudioDestructiveAction,
} from "../studio-destructive-action-preview";
import {
  studioDeleteSharedPoseRequest,
} from "../studio-destructive-command-catalog";

import {
  deriveStudioVrmAvatarForgeFaceScale,
} from "./studio-vrm-avatar-forge-face-controller";
import {
  createStudioVrmGarmentEvaluationReceipt,
  inspectStudioVrmGarmentFit,
} from "./studio-vrm-garment-fit";
import {
  buildStudioVrmPersistentIkSignature,
  type StudioVrmPersistentIkSignatureInput,
} from "./studio-vrm-persistent-ik-signature";
import {
  CHARACTER_PANEL_SECTIONS,
  PANEL_TABS,
  type CharacterPanelSection,
  type PanelTab,
} from "./studio-vrm-poser-catalogs";
import {
  getErrorMessage,
} from "./studio-vrm-poser-helpers";
import {
  selectSharedPoseAssets,
} from "./studio-vrm-shared-pose-library";
import {
  createStudioVrmTexturePaintRuntime,
} from "./studio-vrm-texture-paint-runtime";
import {
  isStudioVrmTexturePaintBrushProductBlocked,
  normalizeCatalogNextOffset,
  type StudioVrmTexturePaintSettingsUpdate,
  type ViewportApi,
} from "./StudioVrmPoserTypes";
import {
  studioVrmProportionsRequireRuntime,
} from "./StudioVrmViewportUtils";
import {
  canonicalizeVrmContentHash,
} from "./vrm-library";

import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { StudioVrmTexturePaintPanelSettings } from "./StudioVrmTexturePaintPanel";
import type { VrmLibraryEntry } from "./vrm-library";
import type { MouseEvent as ReactMouseEvent } from "react";

import {
  listSharedAssetCatalog,
  deleteSharedAsset,
  getSharedAssetContent,
  markSharedAssetUsed,
  type SharedAssetCatalogItem,
} from "@/src/infrastructure/creator-client";

export function useStudioVrmPoserRuntimeA(h: StudioVrmPoserHost): void {
  const {
    open,
    initialScene,
    texturePaintSceneIdentity,
    vrm,
    setActivePoseId,
    customBones,
    customYOffset,
    poseTranslations,
    ikConstraints,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    activePanelTab,
    setActivePanelTab,
    activeCharacterSection,
    setActiveCharacterSection,
    setTexturePaintSettings,
    setTexturePaintEyedropperActive,
    texturePaintRuntime,
    setTexturePaintRuntime,
    texturePaintRuntimeSceneIdentity,
    setTexturePaintRuntimeSceneIdentity,
    setTexturePaintSnapshot,
    setTexturePaintPersistenceStatus,
    setTexturePaintPersistenceError,
    texturePaintRestoreRetryToken,
    texturePaintDevicePlan,
    bodyRotation,
    setMannequinMode,
    setTurntable,
    setViewResetNonce,
    setViewportHinted,
    viewportApiRef,
    libraryEntries,
    activeModelId,
    installedModelId,
    bodyScale,
    avatarForgeState,
    setAvatarForgeReferencePreview,
    avatarForgeReferencePreviewActive,
    avatarForgeFaceController,
    proportionRigStatus,
    fingerEdits,
    setSharedPoses,
    sharedPosesStatus,
    setSharedPosesStatus,
    setSharedPoseReloadToken,
    sharedPoseNextOffset,
    setSharedPoseNextOffset,
    sharedPoseHasMore,
    setSharedPoseHasMore,
    setSharedPoseSelectionAssetId,
    wardrobeState,
    wardrobeMetrics,
    wardrobeAuthoredIdentity,
    idleAnimation,
    webcamActive,
    webcamActiveRef,
    idleAnimationRef,
    dynamicPoseGenerationRef,
    dynamicPoseStateRef,
    proportionRigReceiptRef,
    avatarForgeCommittedStateRef,
    proportionRigRevisionRef,
    texturePaintRuntimeRef,
    texturePaintSnapshotRef,
    texturePaintInvalidateRef,
    texturePaintRestoreGenerationRef,
    texturePaintRestoreAbortRef,
    texturePaintMutationBlockedRef,
    wardrobeMutationBlockedRef,
    wardrobeAuthoredIdentityRef,
    insertCaptureGenerationRef,
    insertCaptureFrameRef,
    insertCaptureAbortRef,
    sharePoseAbortRef,
    captureOperationRef,
    sharedPoseListRequestRef,
    sharedPoseSelectionRequestRef,
    sharedPoseCatalogAbortRef,
    sharedPoseSelectAbortRef,
    panelScrollRef,
    persistentIkResolvedSignatureRef,
    persistentIkCurrentSignatureRef,
    garmentEvaluationGenerationRef,
    garmentEvaluationReceiptRef,
    groundShadowRef,
    envRootRef,
    captureHelperLeaseCountRef,
  } = h;
  const acquireVrmCaptureOperation = useCallback((
    operation: "insert" | "thumbnail" | "share",
  ): boolean => {
    if (captureOperationRef.current !== null) return false;
    captureOperationRef.current = operation;
    return true;
  }, []);

  const releaseVrmCaptureOperation = useCallback((
    operation: "insert" | "thumbnail" | "share",
  ): void => {
    if (captureOperationRef.current === operation) {
      captureOperationRef.current = null;
    }
  }, []);

  const readVrmCaptureCameraIdentity = useCallback((): string | null => {
    const camera = viewportApiRef.current?.readCamera() ?? null;
    return camera ? JSON.stringify(camera) : null;
  }, []);

  const acquireVrmCaptureHelperLease = useCallback((options?: {
    readonly subjectOnly?: boolean;
  }): (() => void) => {
    const subjectOnly = options?.subjectOnly !== false;
    captureHelperLeaseCountRef.current += 1;
    if (groundShadowRef.current) groundShadowRef.current.visible = false;
    if (subjectOnly && envRootRef.current) envRootRef.current.visible = false;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      captureHelperLeaseCountRef.current = Math.max(0, captureHelperLeaseCountRef.current - 1);
      if (captureHelperLeaseCountRef.current === 0) {
        if (groundShadowRef.current) groundShadowRef.current.visible = true;
        // Env is always visible in the interactive viewport; only capture temporarily hides it.
        if (envRootRef.current) envRootRef.current.visible = true;
      }
    };
  }, []);

  useEffect(() => {
    texturePaintRuntimeRef.current = null;
    texturePaintSnapshotRef.current = null;
    setTexturePaintRuntime(null);
    setTexturePaintRuntimeSceneIdentity(null);
    setTexturePaintSnapshot(null);
    if (!vrm) return;

    const runtime = createStudioVrmTexturePaintRuntime(
      vrm.scene,
      texturePaintDevicePlan.runtimeOptions,
    );
    texturePaintRuntimeRef.current = runtime;
    setTexturePaintRuntime(runtime);
    setTexturePaintRuntimeSceneIdentity(texturePaintSceneIdentity);
    const initialSnapshot = runtime.getSnapshot();
    texturePaintSnapshotRef.current = initialSnapshot;
    setTexturePaintSnapshot(initialSnapshot);
    const unsubscribe = runtime.subscribe((snapshot) => {
      texturePaintSnapshotRef.current = snapshot;
      setTexturePaintSnapshot(snapshot);
      texturePaintInvalidateRef.current?.();
    });

    return () => {
      unsubscribe();
      if (texturePaintRuntimeRef.current === runtime) {
        texturePaintRuntimeRef.current = null;
        texturePaintSnapshotRef.current = null;
      }
      runtime.dispose();
    };
  }, [texturePaintDevicePlan, texturePaintSceneIdentity, vrm]);

  // 라이브러리 썸네일처럼 모델의 본질과 무관한 필드가 바뀌어도 복원을 취소하지 않는다.
  // active id는 로드 시작 때 먼저 바뀌므로 실제로 install된 VRM id까지 함께 확인해 이전
  // 런타임에 새 scene의 표면 텍스처를 적용하는 협업/원격 갱신 race도 막는다.
  const activeTexturePaintRestoreEntry =
    libraryEntries.find((entry: VrmLibraryEntry) => entry.id === activeModelId) ?? null;
  const texturePaintRestoreModelMatches = Boolean(
    initialScene
    && installedModelId === activeModelId
    && (
      initialScene.model.source === "bundled"
        ? activeTexturePaintRestoreEntry?.source === "sample"
          && activeTexturePaintRestoreEntry.id === initialScene.model.id
        : activeTexturePaintRestoreEntry?.source === "sqlite-opfs"
          && canonicalizeVrmContentHash(activeTexturePaintRestoreEntry.contentHash)
            === initialScene.model.hash
    ),
  );

  useEffect(() => {
    texturePaintRestoreGenerationRef.current += 1;
    const generation = texturePaintRestoreGenerationRef.current;
    texturePaintRestoreAbortRef.current?.abort();
    texturePaintRestoreAbortRef.current = null;
    setTexturePaintPersistenceError("");

    if (
      !open
      || !initialScene
      || !texturePaintRuntime
      || !vrm
      || texturePaintRuntimeSceneIdentity !== texturePaintSceneIdentity
    ) {
      setTexturePaintPersistenceStatus(initialScene ? "idle" : "ready");
      return;
    }
    if (initialScene.surfacePaint.textures.length === 0) {
      setTexturePaintPersistenceStatus("ready");
      return;
    }
    if (!texturePaintRestoreModelMatches) {
      setTexturePaintPersistenceStatus("idle");
      return;
    }

    const controller = new AbortController();
    texturePaintRestoreAbortRef.current = controller;
    setTexturePaintPersistenceStatus("restoring");
    void import("./studio-vrm-texture-paint-persistence")
      .then(({ rehydrateStudioVrmTexturePaintRuntime }) =>
        rehydrateStudioVrmTexturePaintRuntime(
          texturePaintRuntime,
          initialScene.surfacePaint,
          { signal: controller.signal },
        )
      )
      .then(() => {
        if (
          controller.signal.aborted
          || generation !== texturePaintRestoreGenerationRef.current
          || texturePaintRuntimeRef.current !== texturePaintRuntime
        ) return;
        setTexturePaintPersistenceStatus("ready");
        texturePaintInvalidateRef.current?.();
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted
          || generation !== texturePaintRestoreGenerationRef.current
          || texturePaintRuntimeRef.current !== texturePaintRuntime
        ) return;
        setTexturePaintPersistenceStatus("error");
        setTexturePaintPersistenceError(getErrorMessage(
          cause,
          "저장된 표면 페인팅 원본을 복원하지 못했습니다.",
        ));
      });

    return () => {
      controller.abort();
      if (texturePaintRestoreAbortRef.current === controller) {
        texturePaintRestoreAbortRef.current = null;
      }
    };
  }, [
    initialScene,
    open,
    texturePaintRuntime,
    texturePaintRestoreModelMatches,
    texturePaintRestoreRetryToken,
    vrm,
    texturePaintRuntimeSceneIdentity,
    texturePaintSceneIdentity,
  ]);

  const cancelPendingInsertCapture = useCallback((): void => {
    insertCaptureGenerationRef.current += 1;
    insertCaptureAbortRef.current?.abort();
    insertCaptureAbortRef.current = null;
    texturePaintMutationBlockedRef.current = false;
    wardrobeMutationBlockedRef.current = false;
    if (insertCaptureFrameRef.current !== null) {
      cancelAnimationFrame(insertCaptureFrameRef.current);
      insertCaptureFrameRef.current = null;
    }
    releaseVrmCaptureOperation("insert");
  }, [releaseVrmCaptureOperation]);

  const cancelPendingPoseShare = useCallback((): void => {
    const controller = sharePoseAbortRef.current;
    if (controller && !controller.signal.aborted) controller.abort();
  }, []);

  const cancelPendingSharedPoseCatalog = useCallback((): void => {
    sharedPoseListRequestRef.current += 1;
    const controller = sharedPoseCatalogAbortRef.current;
    if (controller && !controller.signal.aborted) controller.abort();
    sharedPoseCatalogAbortRef.current = null;
  }, []);

  const cancelPendingSharedPoseSelection = useCallback((): void => {
    sharedPoseSelectionRequestRef.current += 1;
    const controller = sharedPoseSelectAbortRef.current;
    if (controller && !controller.signal.aborted) controller.abort();
    sharedPoseSelectAbortRef.current = null;
    setSharedPoseSelectionAssetId(null);
  }, []);

  const loadSharedPoseCatalog = useCallback(async (offset = 0, append = false): Promise<void> => {
    const controller = new AbortController();
    const requestId = sharedPoseListRequestRef.current + 1;
    sharedPoseListRequestRef.current = requestId;
    sharedPoseCatalogAbortRef.current = controller;
    const expectedOffset = Math.max(0, offset);
    if (!append) {
      setSharedPoses([]);
      setSharedPoseHasMore(false);
      setSharedPoseNextOffset(null);
    }
    setSharedPosesStatus("loading");

    try {
      const page = await listSharedAssetCatalog({
        kind: "vrm_pose",
        limit: 20,
        offset: expectedOffset,
      }, controller.signal);

      if (controller.signal.aborted || sharedPoseListRequestRef.current !== requestId) return;
      const items = selectSharedPoseAssets(page.items);
      setSharedPoses((current: SharedAssetCatalogItem[]) => append
        ? [...current.filter((item: SharedAssetCatalogItem) => !items.some((next) => next.id === item.id)), ...items]
        : items);
      setSharedPoseHasMore(page.hasMore);
      setSharedPoseNextOffset(normalizeCatalogNextOffset(expectedOffset, page));
      setSharedPosesStatus("idle");
    } catch {
      if (controller.signal.aborted || sharedPoseListRequestRef.current !== requestId) return;
      // The remote library is optional. Keep local poser usable and surface a retry affordance.
      setSharedPoseHasMore(false);
      setSharedPoseNextOffset(null);
      setSharedPosesStatus("error");
    } finally {
      if (sharedPoseCatalogAbortRef.current === controller) {
        sharedPoseCatalogAbortRef.current = null;
      }
    }
  }, []);

  async function loadMoreSharedPoses(): Promise<void> {
    if (!sharedPoseNextOffset || !sharedPoseHasMore || sharedPosesStatus === "loading") return;
    await loadSharedPoseCatalog(sharedPoseNextOffset, true);
  }

  async function handleSelectSharedPose(asset: SharedAssetCatalogItem): Promise<void> {
    cancelPendingSharedPoseSelection();
    setSharedPoseSelectionAssetId(asset.id);
    const requestId = sharedPoseSelectionRequestRef.current + 1;
    sharedPoseSelectionRequestRef.current = requestId;
    const controller = new AbortController();
    sharedPoseSelectAbortRef.current = controller;
    const generation = sharedPoseSelectionRequestRef.current;

    try {
      const content = await getSharedAssetContent(asset.id, controller.signal);
      if (
        controller.signal.aborted ||
        sharedPoseSelectionRequestRef.current !== requestId ||
        generation !== requestId ||
        content.kind !== "vrm_pose" ||
        content.id !== asset.id
      ) {
        return;
      }

      const ok = h.loadHandlers.handleSelectSharedPose(content);
      if (!ok) return;
      if (
        controller.signal.aborted ||
        sharedPoseSelectionRequestRef.current !== requestId ||
        generation !== requestId
      ) return;
      setActivePoseId(`shared-${asset.id}`);
      setSharedPoseSelectionAssetId(null);
      void markSharedAssetUsed(asset.id);
      alert(`공유된 포즈 '${asset.name.replace("[3D_POSE] ", "")}'를 적용했습니다.`);
    } catch (caughtError: unknown) {
      if (
        controller.signal.aborted ||
        sharedPoseSelectionRequestRef.current !== requestId ||
        generation !== requestId
      ) return;
      console.error(caughtError);
      alert("공유 포즈를 불러오지 못했습니다.");
    } finally {
      if (sharedPoseSelectAbortRef.current === controller) {
        sharedPoseSelectAbortRef.current = null;
        setSharedPoseSelectionAssetId((current: string | null) => (current === asset.id ? null : current));
      }
    }
  }

  async function handleDeleteSharedPose(asset: SharedAssetCatalogItem, e: ReactMouseEvent<HTMLButtonElement>): Promise<void> {
    e.stopPropagation();
    if (
      !(await confirmStudioDestructiveAction(
        studioDeleteSharedPoseRequest(asset.name.replace("[3D_POSE] ", ""))
      ))
    ) {
      return;
    }
    cancelPendingSharedPoseSelection();
    try {
      await deleteSharedAsset(asset.id);
      alert("공유된 포즈가 성공적으로 삭제되었습니다.");
      setSharedPoseReloadToken((token: number) => token + 1);
      setSharedPoseHasMore(false);
      setSharedPoseNextOffset(null);
    } catch (err) {
      console.error(err);
      alert("삭제에 실패했습니다.");
    }
  }

  const handlePanelTabChange = useCallback((tab: PanelTab) => {
    setActivePanelTab(tab);
    if (tab !== "character") setAvatarForgeReferencePreview(null);
    if (tab !== "character") setTexturePaintEyedropperActive(false);
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
  }, []);

  const handleCharacterSectionChange = (section: CharacterPanelSection) => {
    setActiveCharacterSection(section);
    if (section !== "forge") setAvatarForgeReferencePreview(null);
    if (section !== "surface") setTexturePaintEyedropperActive(false);
    if (section === "surface") {
      setTurntable(false);
      setMannequinMode(false);
    }
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
  };

  // 탭 키보드 내비게이션(WAI-ARIA Tabs 패턴): 좌우 방향키 + Home/End. 포커스는 탭 버튼에 둔다.
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = PANEL_TABS.findIndex((t) => t.id === activePanelTab);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % PANEL_TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + PANEL_TABS.length) % PANEL_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PANEL_TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = PANEL_TABS[next];
    handlePanelTabChange(nextTab.id);
    document.getElementById(`vrm-tab-${nextTab.id}`)?.focus();
  };

  const handleCharacterTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = CHARACTER_PANEL_SECTIONS.findIndex((section) => section.id === activeCharacterSection);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % CHARACTER_PANEL_SECTIONS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + CHARACTER_PANEL_SECTIONS.length) % CHARACTER_PANEL_SECTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = CHARACTER_PANEL_SECTIONS.length - 1;
    else return;
    e.preventDefault();
    const nextSection = CHARACTER_PANEL_SECTIONS[next];
    handleCharacterSectionChange(nextSection.id);
    document.getElementById(`vrm-character-subtab-${nextSection.id}`)?.focus();
  };

  const handleViewportReady = useCallback((api: ViewportApi | null) => {
    viewportApiRef.current = api;
  }, []);

  const handleTexturePaintInvalidateReady = useCallback(
    (requestFrame: (() => void) | null) => {
      texturePaintInvalidateRef.current = requestFrame;
    },
    [],
  );

  const handleTexturePaintSettingsChange = useCallback(
    (update: StudioVrmTexturePaintSettingsUpdate) => {
      if (
        update.tool !== undefined
        && isStudioVrmTexturePaintBrushProductBlocked(update.tool)
      ) return;
      if (update.tool !== undefined) setTexturePaintEyedropperActive(false);
      setTexturePaintSettings((current: StudioVrmTexturePaintPanelSettings) => {
        const brushKind = update.brushKind ?? current.brushKind;
        const brushChanged =
          update.brushKind !== undefined && update.brushKind !== current.brushKind;
        const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[brushKind as keyof typeof STUDIO_STAMP_BRUSH_DEFAULTS];
        const tuning = brushChanged
          ? {
              flow: defaults.flow,
              hardness: defaults.hardness,
              minSize: defaults.minSizeRatio,
              ...update.tuning,
            }
          : {
              ...current.tuning,
              ...update.tuning,
            };
        return {
          ...current,
          ...update,
          brushKind,
          tuning,
        };
      });
    },
    [],
  );

  const handleTexturePaintColorSampled = useCallback((color: string) => {
    setTexturePaintSettings((current: StudioVrmTexturePaintPanelSettings) => ({ ...current, color }));
  }, []);

  const handleTexturePaintUndo = useCallback(() => {
    if (texturePaintMutationBlockedRef.current) return;
    const result = texturePaintRuntimeRef.current?.undo();
    if (result?.ok && result.value) texturePaintInvalidateRef.current?.();
  }, []);

  const handleTexturePaintRedo = useCallback(() => {
    if (texturePaintMutationBlockedRef.current) return;
    const result = texturePaintRuntimeRef.current?.redo();
    if (result?.ok && result.value) texturePaintInvalidateRef.current?.();
  }, []);

  const handleTexturePaintReset = useCallback(() => {
    if (texturePaintMutationBlockedRef.current) return;
    const result = texturePaintRuntimeRef.current?.resetActiveTarget();
    if (result?.ok && result.value) texturePaintInvalidateRef.current?.();
  }, []);

  const cancelActiveTexturePaintStroke = useCallback(() => {
    const pointerId = texturePaintSnapshotRef.current?.activePointerId;
    if (typeof pointerId !== "number") return;
    const result = texturePaintRuntimeRef.current?.cancelStroke(pointerId);
    if (result?.ok && result.value) texturePaintInvalidateRef.current?.();
  }, []);

  const zoomViewport = useCallback((factor: number) => {
    if (captureOperationRef.current !== null) return;
    viewportApiRef.current?.zoomBy(factor);
    setViewportHinted(true);
  }, []);

  const handleViewReset = useCallback(() => {
    if (captureOperationRef.current !== null) return;
    setViewResetNonce((n: number) => n + 1);
    setViewportHinted(true);
  }, []);

  const currentPersistentIkSignature = useCallback((overrides: Partial<Pick<
    StudioVrmPersistentIkSignatureInput,
    "bones" | "fingerEdits" | "yOffset" | "translations" | "constraints" | "proportions"
  >> = {}): string => {
    return buildStudioVrmPersistentIkSignature({
      modelId: activeModelId,
      bones: overrides.bones ?? customBones,
      fingerEdits: overrides.fingerEdits ?? fingerEdits,
      yOffset: overrides.yOffset ?? customYOffset,
      translations: overrides.translations ?? poseTranslations,
      bodyRotation,
      bodyScale,
      proportions: overrides.proportions ?? avatarForgeState.proportions,
      constraints: overrides.constraints ?? ikConstraints,
      lockedPoseBones,
      jointProfile: rigJointProfile,
      fullBodyIk: fullBodyIkEnabled,
      footPlant: footPlantEnabled,
      floorHeight: rigFloorHeight,
    });
  }, [
    activeModelId,
    avatarForgeState.proportions,
    bodyRotation,
    bodyScale,
    customBones,
    customYOffset,
    fingerEdits,
    footPlantEnabled,
    fullBodyIkEnabled,
    ikConstraints,
    lockedPoseBones,
    poseTranslations,
    rigFloorHeight,
    rigJointProfile,
  ]);
  useLayoutEffect(() => {
    persistentIkCurrentSignatureRef.current = currentPersistentIkSignature();
  }, [currentPersistentIkSignature]);
  useLayoutEffect(() => {
    garmentEvaluationGenerationRef.current += 1;
    wardrobeAuthoredIdentityRef.current = wardrobeAuthoredIdentity;
    garmentEvaluationReceiptRef.current = createStudioVrmGarmentEvaluationReceipt({
      modelId: activeModelId,
      poseSignature: currentPersistentIkSignature(),
      generation: garmentEvaluationGenerationRef.current,
      report: inspectStudioVrmGarmentFit(wardrobeState, wardrobeMetrics),
    });
  }, [
    activeModelId,
    currentPersistentIkSignature,
    wardrobeAuthoredIdentity,
    wardrobeMetrics,
    wardrobeState,
  ]);
  useLayoutEffect(() => {
    const previous = dynamicPoseStateRef.current;
    if (
      previous.webcamActive !== webcamActive
      || previous.idleAnimation !== idleAnimation
    ) {
      dynamicPoseGenerationRef.current += 1;
      dynamicPoseStateRef.current = { webcamActive, idleAnimation };
    }
    webcamActiveRef.current = webcamActive;
    idleAnimationRef.current = idleAnimation;
  }, [idleAnimation, webcamActive]);

  const persistentIkCaptureIsReady = useCallback((): boolean => {
    const hasLockedConstraint = ikConstraints.some((constraint: StudioVrmIkConstraint) => (
      constraint.enabled && constraint.locked
    ));
    return !hasLockedConstraint
      || persistentIkResolvedSignatureRef.current === currentPersistentIkSignature();
  }, [currentPersistentIkSignature, ikConstraints]);

  const proportionRigCaptureIsReady = useCallback((): boolean => {
    if (proportionRigStatus === "reload-required" || proportionRigStatus === "applying") {
      return false;
    }
    return !studioVrmProportionsRequireRuntime(avatarForgeState)
      || (proportionRigStatus === "ready" && proportionRigReceiptRef.current !== null);
  }, [avatarForgeState, proportionRigStatus]);

  const avatarForgeFaceCaptureIsReady = useCallback((): boolean => {
    if (avatarForgeReferencePreviewActive) return false;
    const snapshot = avatarForgeFaceController.getSnapshot();
    const expectedScale = deriveStudioVrmAvatarForgeFaceScale(
      avatarForgeCommittedStateRef.current.face,
    );
    return snapshot.status === "applied"
      && snapshot.failure === null
      && snapshot.rigRevision === proportionRigRevisionRef.current
      && snapshot.nodeCount > 0
      && snapshot.scale !== null
      && snapshot.scale.every((value: number, index: number) => value === expectedScale[index]);
  }, [avatarForgeFaceController, avatarForgeReferencePreviewActive]);


  Object.assign(h, {
    acquireVrmCaptureOperation,
    releaseVrmCaptureOperation,
    readVrmCaptureCameraIdentity,
    acquireVrmCaptureHelperLease,
    activeTexturePaintRestoreEntry,
    texturePaintRestoreModelMatches,
    cancelPendingInsertCapture,
    cancelPendingPoseShare,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
    loadSharedPoseCatalog,
    loadMoreSharedPoses,
    handleSelectSharedPose,
    handleDeleteSharedPose,
    handlePanelTabChange,
    handleCharacterSectionChange,
    handleTabKeyDown,
    handleCharacterTabKeyDown,
    handleViewportReady,
    handleTexturePaintInvalidateReady,
    handleTexturePaintSettingsChange,
    handleTexturePaintColorSampled,
    handleTexturePaintUndo,
    handleTexturePaintRedo,
    handleTexturePaintReset,
    cancelActiveTexturePaintStroke,
    zoomViewport,
    handleViewReset,
    currentPersistentIkSignature,
    persistentIkCaptureIsReady,
    proportionRigCaptureIsReady,
    avatarForgeFaceCaptureIsReady,
  });
}
