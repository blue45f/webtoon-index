/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";

import {
  isStudioHumanoidBoneName,
  type StudioHumanoidBoneName,
  type StudioPoseScope,
} from "../studio-humanoid-bones";

import {
  resolveStudioVrmFingerAuthority,
} from "./studio-vrm-auto-grip-authority";
import {
  parseAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR,
  createStudioVrmBroadcastPreviewPlan,
  planStudioVrmBroadcastFramebuffer,
  type StudioVrmBroadcastBlocker,
} from "./studio-vrm-broadcast-preview";
import {
  buildStudioVrmPersistentIkSignature,
} from "./studio-vrm-persistent-ik-signature";
import {
  applyStudioVrmPoseMaterial,
  captureStudioVrmPoseMaterial,
  type StudioVrmPoseMaterialApplyResult,
  type StudioVrmPoseMaterialCaptureOptions,
} from "./studio-vrm-pose-material-adapter";
import {
  serializeFullVrmState,
  applyPoserVisualState,
  type FullVrmState,
} from "./studio-vrm-poser-utils";
import {
  createAutoGripFingerOverrides,
} from "./studio-vrm-prop-rig";
import {
  propDefById,
} from "./studio-vrm-props";
import {
  appendStudioVrmFullStateHistory,
  commitStudioVrmFullStateHistoryTransaction,
} from "./studio-vrm-state-history";
import {
  restoreStudioVrmBroadcastImperativeState,
} from "./StudioVrmPoserTypes";

import type {
  StudioPoseMaterial,
} from "../studio-pose-material";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";

export function useStudioVrmPoserBroadcast(h: StudioVrmPoserHost): void {
  const {
    open,
    onClose,
    dialogRef,
    closeButtonRef,
    status,
    vrm,
    activePoseId,
    setActivePoseId,
    customBones,
    setCustomBones,
    customYOffset,
    poseTranslations,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    isViewportHandIkDragging,
    texturePaintPersistenceStatus,
    bodyRotation,
    jointHandleInteracting,
    turntable,
    broadcastBackgroundId,
    broadcastPreviewReceipt,
    setBroadcastPreviewReceipt,
    setBroadcastPreviewError,
    setBroadcastCanvasDpr,
    broadcastPreviewActive,
    viewportApiRef,
    broadcastViewportHostRef,
    broadcastExitButtonRef,
    broadcastPreviousFocusRef,
    broadcastCameraLeaseRef,
    broadcastFocusFrameRef,
    broadcastMutationLockSnapshotRef,
    fullStateHistoryRef,
    isRestoringRef,
    setCanUndo,
    setCanRedo,
    isCapturing,
    isThumbnailCapturing,
    isLoadingLibraryPage,
    libraryStatus,
    activeModelId,
    isUploading,
    deletingModelId,
    bodyScale,
    proportionRigStatus,
    fingerEdits,
    setFingerEdits,
    isSharingPose,
    sharedPosesStatus,
    sharedPoseSelectionAssetId,
    vrmCreativePersistenceStatus,
    vrmPropItems,
    effectivePropRigMetrics,
    webcamActive,
    webcamLoading,
    calibrating,
    calibrationPersistenceStatus,
    vrmRef,
    texturePaintSnapshotRef,
    texturePaintMutationBlockedRef,
    wardrobeMutationBlockedRef,
    sharePoseAbortRef,
    captureOperationRef,
    captureRef,
    jointIkTransactionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    persistentIkReconciling,
    setPersistentIkReconciling,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
    cancelActiveTexturePaintStroke,
    persistentIkCaptureIsReady,
    captureFullState,
    texturePaintStrokeActive,
    doUndo,
    doRedo,
    poseMaterialRuntimeDisabled,
  } = h;

  function currentBroadcastPreviewBlockers(): StudioVrmBroadcastBlocker[] {
    const blockers: StudioVrmBroadcastBlocker[] = [];
    if (!vrm) blockers.push("model-unavailable");
    if (
      status !== "ready"
      || !captureRef.current.gl
      || !captureRef.current.scene
      || !captureRef.current.camera
      || !viewportApiRef.current
    ) blockers.push("model-loading");
    if (
      isUploading
      || deletingModelId !== null
      || isLoadingLibraryPage
      || libraryStatus === "loading"
      || sharedPosesStatus === "loading"
    ) blockers.push("asset-mutation");
    if (
      isCapturing
      || isSharingPose
      || isThumbnailCapturing
      || captureOperationRef.current !== null
    ) blockers.push("capture");
    if (
      vrmCreativePersistenceStatus === "saving"
      || calibrationPersistenceStatus === "saving"
    ) blockers.push("creative-persistence");
    if (
      texturePaintStrokeActive
      || typeof texturePaintSnapshotRef.current?.activePointerId === "number"
      || texturePaintPersistenceStatus === "restoring"
    ) blockers.push("texture-paint");
    if (
      persistentIkReconciling
      || pendingPersistentIkCommandRef.current !== null
      || jointHandleInteracting
      || jointIkTransactionRef.current !== null
      || isViewportHandIkDragging
      || sharedPoseSelectionAssetId !== null
      || proportionRigStatus === "applying"
      || proportionRigStatus === "reload-required"
    ) blockers.push("pose-transaction");
    if (turntable) blockers.push("camera-motion");
    if (webcamActive || webcamLoading || calibrating) blockers.push("tracking-transition");
    return blockers;
  }

  const broadcastPreviewAvailability = createStudioVrmBroadcastPreviewPlan({
    backgroundId: broadcastBackgroundId,
    blockers: currentBroadcastPreviewBlockers(),
  });
  const broadcastPreviewDisabledReason = broadcastPreviewAvailability.ok
    ? null
    : broadcastPreviewAvailability.reason;

  function finishBroadcastPreview(options: Readonly<{ restoreFocus: boolean }>) {
    const cameraRestored = restoreStudioVrmBroadcastImperativeState({
      cameraLeaseRef: broadcastCameraLeaseRef,
      mutationLockSnapshotRef: broadcastMutationLockSnapshotRef,
      texturePaintMutationBlockedRef,
      wardrobeMutationBlockedRef,
    });
    setBroadcastPreviewReceipt(null);
    setBroadcastCanvasDpr(STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR);
    if (!cameraRestored) {
      setBroadcastPreviewError(
        "기존 3D 카메라 구도를 복원하지 못했습니다. 편집기를 닫았다가 다시 열어 주세요.",
      );
    }

    if (broadcastFocusFrameRef.current !== null) {
      cancelAnimationFrame(broadcastFocusFrameRef.current);
      broadcastFocusFrameRef.current = null;
    }
    if (options.restoreFocus) {
      broadcastFocusFrameRef.current = requestAnimationFrame(() => {
        broadcastFocusFrameRef.current = null;
        const previousFocus = broadcastPreviousFocusRef.current;
        const dialogEl = dialogRef.current instanceof HTMLElement ? dialogRef.current : null;
        const fallback = dialogEl?.querySelector('[data-studio-vrm-broadcast-enter="true"]') ?? null;
        if (previousFocus?.isConnected && previousFocus.getClientRects().length > 0) {
          previousFocus.focus({ preventScroll: true });
        } else {
          fallback?.focus({ preventScroll: true });
        }
        broadcastPreviousFocusRef.current = null;
      });
    } else {
      broadcastPreviousFocusRef.current = null;
    }
  }

  function handleBroadcastPreviewStart() {
    const plan = createStudioVrmBroadcastPreviewPlan({
      backgroundId: broadcastBackgroundId,
      blockers: currentBroadcastPreviewBlockers(),
    });
    if (!plan.ok) {
      setBroadcastPreviewError(plan.reason);
      return;
    }
    const viewportApi = viewportApiRef.current;
    const cameraSnapshot = viewportApi?.readCamera() ?? null;
    if (!viewportApi || !cameraSnapshot) {
      setBroadcastPreviewError("현재 카메라 구도를 확인한 뒤 방송 화면을 열 수 있습니다.");
      return;
    }
    const framebufferPreflight = planStudioVrmBroadcastFramebuffer({
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      requestedDpr: window.devicePixelRatio,
    });
    if (!framebufferPreflight.ok) {
      setBroadcastPreviewError(framebufferPreflight.reason);
      return;
    }

    broadcastPreviousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    broadcastCameraLeaseRef.current = Object.freeze({
      settings: cameraSnapshot,
      restoreCamera: viewportApi.restoreCamera,
    });
    broadcastMutationLockSnapshotRef.current = Object.freeze({
      texturePaint: texturePaintMutationBlockedRef.current,
      wardrobe: wardrobeMutationBlockedRef.current,
    });
    texturePaintMutationBlockedRef.current = true;
    wardrobeMutationBlockedRef.current = true;
    setBroadcastCanvasDpr(framebufferPreflight.receipt.dpr);
    setBroadcastPreviewError("");
    setBroadcastPreviewReceipt(plan.receipt);
  }

  function handleBroadcastPreviewRuntimeError(message: string) {
    setBroadcastPreviewError(message);
    finishBroadcastPreview({ restoreFocus: true });
  }

  const requestBroadcastPreviewExit = useEffectEvent(() => {
    finishBroadcastPreview({ restoreFocus: true });
  });

  const reportBroadcastPreviewRuntimeError = useEffectEvent((message: string) => {
    handleBroadcastPreviewRuntimeError(message);
  });

  const updateBroadcastFramebufferAdmission = useEffectEvent((
    cssWidth: number,
    cssHeight: number,
  ) => {
    if (!broadcastPreviewReceipt) return;
    const framebufferPlan = planStudioVrmBroadcastFramebuffer({
      cssWidth,
      cssHeight,
      requestedDpr: window.devicePixelRatio,
    });
    if (!framebufferPlan.ok) {
      reportBroadcastPreviewRuntimeError(framebufferPlan.reason);
      return;
    }
    setBroadcastCanvasDpr((current: number) => (
      current === framebufferPlan.receipt.dpr ? current : framebufferPlan.receipt.dpr
    ));
  });

  useLayoutEffect(() => {
    if (!broadcastPreviewActive) return;
    const host = broadcastViewportHostRef.current;
    if (!host || typeof ResizeObserver !== "function") {
      reportBroadcastPreviewRuntimeError(
        "방송 뷰포트의 실제 크기를 안전하게 관찰할 수 없습니다.",
      );
      return;
    }

    const initialRect = host.getBoundingClientRect();
    updateBroadcastFramebufferAdmission(initialRect.width, initialRect.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === host);
      if (!entry) return;
      updateBroadcastFramebufferAdmission(
        entry.contentRect.width,
        entry.contentRect.height,
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [broadcastPreviewActive]);

  useEffect(() => {
    if (!broadcastPreviewActive) return;
    const focusFrame = requestAnimationFrame(() => {
      broadcastExitButtonRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [broadcastPreviewActive]);

  useLayoutEffect(() => {
    return () => {
      if (broadcastFocusFrameRef.current !== null) {
        cancelAnimationFrame(broadcastFocusFrameRef.current);
      }
      restoreStudioVrmBroadcastImperativeState({
        cameraLeaseRef: broadcastCameraLeaseRef,
        mutationLockSnapshotRef: broadcastMutationLockSnapshotRef,
        texturePaintMutationBlockedRef,
        wardrobeMutationBlockedRef,
      });
    };
  }, []);

  function portableLockedPoseBones(): StudioHumanoidBoneName[] {
    return lockedPoseBones.filter(
      (boneName: string): boneName is StudioHumanoidBoneName => isStudioHumanoidBoneName(boneName)
    );
  }

  function handleCapturePoseMaterial(
    options: StudioVrmPoseMaterialCaptureOptions,
  ): StudioPoseMaterial | null {
    const currentVrm = vrmRef.current;
    if (!currentVrm || poseMaterialRuntimeDisabled) return null;
    return captureStudioVrmPoseMaterial(currentVrm, options);
  }

  function handleApplyPoseMaterial(
    material: StudioPoseMaterial,
    scope: StudioPoseScope,
    strength?: number,
  ): StudioVrmPoseMaterialApplyResult | null {
    const currentVrm = vrmRef.current;
    if (!currentVrm || poseMaterialRuntimeDisabled) return null;

    const before = captureFullState();
    const result = applyStudioVrmPoseMaterial(currentVrm, material, {
      scope,
      lockedBones: portableLockedPoseBones(),
      ...(strength !== undefined ? { strength } : {}),
      bones: customBones,
      fingerEdits,
    });
    if (!result || result.appliedBones.length === 0) return result;

    const poseId = `pose-material:${result.materialId}`;
    const after = serializeFullVrmState({
      ...before,
      poseId,
      bones: result.bones,
      fingerOverrides: result.fingerEdits,
    });
    const candidateSignature = buildStudioVrmPersistentIkSignature({
      modelId: activeModelId,
      bones: result.bones,
      fingerEdits: result.fingerEdits,
      yOffset: after.yOffset,
      translations: after.poseTranslations,
      bodyRotation: after.bodyRotation,
      bodyScale: after.bodyScale ?? bodyScale,
      proportions: parseAvatarForgeState(after.avatarForge).proportions,
      constraints: after.ikConstraints,
      lockedPoseBones,
      jointProfile: rigJointProfile,
      fullBodyIk: fullBodyIkEnabled,
      footPlant: footPlantEnabled,
      floorHeight: rigFloorHeight,
    });
    if (
      after.ikConstraints.some((constraint) => constraint.enabled && constraint.locked)
      && persistentIkResolvedSignatureRef.current !== candidateSignature
    ) {
      pendingPersistentIkCommandRef.current = {
        before,
        candidateAfter: after,
        inputSignature: candidateSignature,
        historyGeneration: fullStateHistoryRef.current.generation,
      };
      setPersistentIkReconciling(true);
    } else {
      const nextHistory = commitStudioVrmFullStateHistoryTransaction(
        fullStateHistoryRef.current,
        before,
        after,
        activeModelId,
      );
      fullStateHistoryRef.current = nextHistory;
      setCanUndo(nextHistory.index > 0);
      setCanRedo(nextHistory.index < nextHistory.entries.length - 1);
    }

    setActivePoseId(poseId);
    setCustomBones(result.bones);
    setFingerEdits(result.fingerEdits);
    const nextEffectiveFingers = resolveStudioVrmFingerAuthority(
      result.fingerEdits,
      createAutoGripFingerOverrides(
        vrmPropItems,
        propDefById,
        effectivePropRigMetrics,
      ),
    );
    applyPoserVisualState(currentVrm, {
      bones: result.bones,
      yOffset: customYOffset,
      poseTranslations,
      fingerEdits: nextEffectiveFingers,
      bodyScale,
    });
    return result;
  }

  function handlePoseMaterialProvenanceInvalidated(materialId: string): void {
    if (activePoseId === `pose-material:${materialId}`) {
      setActivePoseId("manual-pose");
    }
  }

  // 편집이 멈추면(디바운스) 스냅샷을 히스토리에 적재. 복원 중 변경은 건너뛴다.
  useEffect(() => {
    if (
      !vrm
      || pendingPersistentIkCommandRef.current
      || persistentIkReconciling
      || !persistentIkCaptureIsReady()
    ) return;
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    const historyGeneration = fullStateHistoryRef.current.generation;
    const timer = setTimeout(() => {
      const snap = JSON.parse(JSON.stringify(captureFullState())) as FullVrmState;
      const currentHistory = fullStateHistoryRef.current;
      const nextHistory = appendStudioVrmFullStateHistory(
        currentHistory,
        snap,
        historyGeneration,
        activeModelId,
      );
      if (nextHistory === currentHistory) return;
      fullStateHistoryRef.current = nextHistory;
      setCanUndo(nextHistory.index > 0);
      setCanRedo(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [
    activeModelId,
    captureFullState,
    persistentIkCaptureIsReady,
    persistentIkReconciling,
    vrm,
  ]);

  // 키보드 핸들러가 항상 최신 undo/redo를 호출하도록 ref 동기화(렌더 후).
  const undoRef = useRef(doUndo);
  const redoRef = useRef(doRedo);
  useEffect(() => {
    undoRef.current = doUndo;
    redoRef.current = doRedo;
  });

  // 모달이 열린 동안 배경 스크롤을 잠그고, 첫 포커스를 명시하며 닫힐 때 진입점으로 돌려준다.
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `calc(${previousPaddingRight || "0px"} + ${scrollbarWidth}px)`;
    }
    const focusFrame = requestAnimationFrame(() => {
      (closeButtonRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [
    open,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
  ]);

  // 키보드 단축키: Esc 닫기, Tab 포커스 트랩, ⌘/Ctrl+Z 되돌리기,
  // ⌘/Ctrl+Shift+Z(또는 +Y) 다시 실행. 모달 뒤 전역 ⌘K 팔레트는 열지 않는다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const dialog = dialogRef.current;
      const topElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      const dialogIsTopmost = !!dialog && (!topElement || topElement === dialog || dialog.contains(topElement));
      if (e.key === "Escape") {
        if (e.defaultPrevented || !dialogIsTopmost) return;
        e.preventDefault();
        e.stopPropagation();
        if (broadcastPreviewActive) {
          requestBroadcastPreviewExit();
          return;
        }
        if (isCapturing) return;
        cancelActiveTexturePaintStroke();
        sharePoseAbortRef.current?.abort();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialog && dialogIsTopmost) {
        if (broadcastPreviewActive) {
          e.preventDefault();
          broadcastExitButtonRef.current?.focus({ preventScroll: true });
          return;
        }
        if (!(dialog instanceof HTMLElement)) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
        if (focusable.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialog.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (broadcastPreviewActive) {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (typing || !(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      } else if (key === "y") {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [broadcastPreviewActive, cancelActiveTexturePaintStroke, isCapturing, open, onClose, texturePaintStrokeActive]);

  // 자연 포즈도 모든 손가락을 저작값으로 포함하므로 자동 그립이 켜진 손에서는 소품
  // 접촉 결과를 최종 권위로 둔다. 자동 그립을 끄면 가려졌던 저작값이 즉시 복원된다.
  const effectiveFingerEdits = resolveStudioVrmFingerAuthority(
    fingerEdits,
    createAutoGripFingerOverrides(vrmPropItems, propDefById, effectivePropRigMetrics),
  );

  Object.assign(h, {
    currentBroadcastPreviewBlockers,
    broadcastPreviewAvailability,
    broadcastPreviewDisabledReason,
    finishBroadcastPreview,
    handleBroadcastPreviewStart,
    handleBroadcastPreviewRuntimeError,
    requestBroadcastPreviewExit,
    reportBroadcastPreviewRuntimeError,
    updateBroadcastFramebufferAdmission,
    portableLockedPoseBones,
    handleCapturePoseMaterial,
    handleApplyPoseMaterial,
    handlePoseMaterialProvenanceInvalidated,
    undoRef,
    redoRef,
    effectiveFingerEdits,
  });
}
