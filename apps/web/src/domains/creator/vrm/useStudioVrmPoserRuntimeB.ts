import {
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import * as THREE from "three";

/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  parseAvatarForgeState,
  serializeAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  solveStudioVrmFullBodyIk,
} from "./studio-vrm-full-body-ik";
import {
  canCommitStudioVrmIkResult,
  cloneStudioVrmIkConstraints,
  studioVrmSceneLocalPointToWorld,
} from "./studio-vrm-ik-constraints";
import {
  buildStudioVrmPersistentIkSignature,
} from "./studio-vrm-persistent-ik-signature";
import {
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  STUDIO_VRM_IK_NOT_CONVERGED_STATUS,
} from "./studio-vrm-poser-catalogs";
import {
  applyStudioVrmRotationPose,
  extractStudioVrmFingerRotations,
} from "./studio-vrm-poser-helpers";
import {
  serializeFullVrmState,
  stripFingerBones,
  applyPoserVisualState,
  type FullVrmState,
} from "./studio-vrm-poser-utils";
import {
  serializeVrmProps,
} from "./studio-vrm-props";
import {
  resolveStudioVrmFrameLoop,
} from "./studio-vrm-render-policy";
import {
  serializeSceneProps,
} from "./studio-vrm-scene-props";
import {
  commitStudioVrmFullStateHistoryTransaction,
  resetStudioVrmFullStateHistory,
  stepStudioVrmFullStateHistory,
} from "./studio-vrm-state-history";
import {
  STUDIO_VRM_USER_IK_CHAINS,
} from "./studio-vrm-user-ik";
import {
  serializeWardrobe,
} from "./studio-vrm-wardrobe";
import type {
  StudioVrmIkEffectorBone,
} from "./StudioVrmJointHandles";
import {
  isStudioVrmTexturePaintBrushProductBlocked,
  STUDIO_VRM_SURFACE_BRUSH_UNAVAILABLE_REASON,
} from "./StudioVrmPoserTypes";
import {
  applyRotationToVrm,
} from "./StudioVrmViewportUtils";

import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";

export function useStudioVrmPoserRuntimeB(h: StudioVrmPoserHost): void {
  const {
    open,
    initialScene,
    texturePaintSceneIdentity,
    status,
    vrm,
    activePoseId,
    setActivePoseId,
    customBones,
    setCustomBones,
    customYOffset,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    ikConstraints,
    setIkConstraints,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    showPoseBoneOverlay,
    viewportHandIkEnabled,
    isViewportHandIkDragging,
    setIsViewportHandIkDragging,
    activeExpressionId,
    expressionWeights,
    activePanelTab,
    activeCharacterSection,
    texturePaintSettings,
    texturePaintEyedropperActive,
    texturePaintRuntimeSceneIdentity,
    texturePaintSnapshot,
    texturePaintSurfaceToolSnapshot,
    texturePaintPersistenceStatus,
    texturePaintPersistenceError,
    texturePaintDevicePlan,
    bodyRotation,
    setBodyRotation,
    mannequinMode,
    jointHandleInteracting,
    setJointHandleInteracting,
    setJointHandleSessionGeneration,
    setJointHandleStatus,
    turntable,
    broadcastPreviewActive,
    viewportHinted,
    setViewportHinted,
    fullStateHistoryRef,
    isRestoringRef,
    canUndo,
    setCanUndo,
    canRedo,
    setCanRedo,
    isCapturing,
    isThumbnailCapturing,
    activeModelId,
    bodyScale,
    avatarForgeState,
    setAvatarForgeReferencePreview,
    avatarForgeReferencePreviewActive,
    fingerEdits,
    setFingerEdits,
    lighting,
    envVariant,
    transparentBackground,
    insertBackgroundColor,
    customColors,
    materialFx,
    isSharingPose,
    lightingTone,
    activeProps,
    propAttachments,
    vrmPropItems,
    costumeState,
    wardrobeState,
    wardrobeAutoHide,
    vrmPhysics,
    physicsPreview,
    idleAnimation,
    webcamActive,
    webcamLoading,
    vrmRef,
    captureVisualAuthorityRef,
    texturePaintSnapshotRef,
    texturePaintMutationBlockedRef,
    captureRef,
    jointIkTransactionRef,
    jointIkRevisionRef,
    persistentIkReconcileRevisionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    persistentIkReconciling,
    setPersistentIkReconciling,
    captureSceneGeneration,
    handleTexturePaintUndo,
    handleTexturePaintRedo,
    persistentIkCaptureIsReady,
    cancelJointIkTransaction,
  } = h;

  // 드래그 힌트는 모델이 준비되면 잠깐 보여 주고 일정 시간 뒤 자동으로 사라진다.
  useEffect(() => {
    if (!vrm || viewportHinted) return;
    const timer = setTimeout(() => setViewportHinted(true), 6000);
    return () => clearTimeout(timer);
  }, [vrm, viewportHinted]);

  // 캡처·공유·썸네일·웹캠 전환은 본 오버레이를 unmount한다. 네이티브 포인터 종료
  // fallback과 별개로 상위 Orbit 잠금도 즉시 해제해 어떤 전환 순서에서도 뷰포트가 남지 않는다.
  useEffect(() => {
    if (
      !vrm ||
      !showPoseBoneOverlay ||
      !viewportHandIkEnabled ||
      isCapturing ||
      isSharingPose ||
      isThumbnailCapturing ||
      webcamActive
    ) {
      setIsViewportHandIkDragging(false);
    }
  }, [
    isCapturing,
    isSharingPose,
    isThumbnailCapturing,
    showPoseBoneOverlay,
    viewportHandIkEnabled,
    vrm,
    webcamActive,
  ]);

  // 현재 편집 상태를 직렬화 가능한 전체 스냅샷으로 캡처(undo 히스토리/공유와 동일 포맷).
  const captureFullState = useCallback(
    (): FullVrmState =>
      serializeFullVrmState({
        modelId: activeModelId,
        poseId: activePoseId,
        expressionId: activeExpressionId,
        bones: customBones,
        yOffset: customYOffset,
        poseTranslations,
        ikConstraints,
        bodyRotation,
        expressionWeights,
        costume: costumeState,
        wardrobe: serializeWardrobe(wardrobeState, { autoHideOriginal: wardrobeAutoHide }),
        props: serializeVrmProps(vrmPropItems),
        sceneProps: serializeSceneProps(activeProps, propAttachments),
        physics: vrmPhysics,
        bodyScale,
        lighting,
        lightingTone,
        env: envVariant,
        fingerOverrides: fingerEdits,
        customColors,
        materialFx,
        avatarForge: serializeAvatarForgeState(avatarForgeState),
      }),
    [activeModelId, activePoseId, activeExpressionId, customBones, customYOffset, poseTranslations, ikConstraints, bodyRotation, expressionWeights, costumeState, wardrobeState, wardrobeAutoHide, vrmPropItems, activeProps, propAttachments, vrmPhysics, bodyScale, lighting, lightingTone, envVariant, fingerEdits, customColors, materialFx, avatarForgeState]
  );
  const captureVisualAuthorityIdentity = JSON.stringify({
    fullState: captureFullState(),
    lightingTone,
    mannequinMode,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    transparentBackground,
    insertBackgroundColor,
  });
  useLayoutEffect(() => {
    captureVisualAuthorityRef.current = Object.freeze({
      identity: captureVisualAuthorityIdentity,
      fullState: captureFullState(),
    });
  }, [captureFullState, captureVisualAuthorityIdentity]);

  // A pointer transaction owns the exact React-side pose/config it started from. Any preset,
  // restore, root/body edit, pin toggle, or lock change invalidates that ownership before a late
  // pointerup can overwrite the newer authoritative edit.
  useEffect(() => {
    const transaction = jointIkTransactionRef.current;
    if (!transaction) return;
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
    if (transaction.authoritativeSignature === signature) return;
    jointIkRevisionRef.current += 1;
    jointIkTransactionRef.current = null;
    if (transaction.vrm === vrmRef.current) {
      applyStudioVrmRotationPose(transaction.vrm, transaction.baseline, bodyScale);
    }
    setJointHandleInteracting(false);
    setJointHandleSessionGeneration((generation: number) => generation + 1);
    setJointHandleStatus("다른 포즈·리그 변경을 우선 적용하고 진행 중이던 IK 이동을 취소했습니다.");
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

  // Any authoritative FK/root/body edit must preserve enabled locked pins immediately. Waiting
  // until the next handle drag would leave the visible target and the actual effector divergent.
  useEffect(() => {
    const lockedConstraints: StudioVrmIkConstraint[] = ikConstraints.filter((constraint: StudioVrmIkConstraint) => (
      constraint.enabled && constraint.locked
    ));
    const inputSignature = buildStudioVrmPersistentIkSignature({
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
    const commitPendingCommand = (resolvedAfter: FullVrmState): void => {
      const pending = pendingPersistentIkCommandRef.current;
      if (
        !pending
        || pending.inputSignature !== inputSignature
        || pending.historyGeneration !== fullStateHistoryRef.current.generation
      ) return;
      pendingPersistentIkCommandRef.current = null;
      const nextHistory = commitStudioVrmFullStateHistoryTransaction(
        fullStateHistoryRef.current,
        pending.before,
        resolvedAfter,
        activeModelId,
      );
      fullStateHistoryRef.current = nextHistory;
      setCanUndo(nextHistory.index > 0);
      setCanRedo(nextHistory.index < nextHistory.entries.length - 1);
    };
    const rollbackPendingCommand = (message: string): void => {
      if (!vrm) {
        pendingPersistentIkCommandRef.current = null;
        setPersistentIkReconciling(false);
        setJointHandleStatus(message);
        return;
      }
      const pending = pendingPersistentIkCommandRef.current;
      if (!pending) {
        setPersistentIkReconciling(false);
        setJointHandleStatus(message);
        return;
      }
      pendingPersistentIkCommandRef.current = null;
      const rollbackBones = stripFingerBones(pending.before.bones);
      const rollbackFingers = pending.before.fingerOverrides ?? {};
      const rollbackTranslations = cloneStudioVrmPoseTranslations(pending.before.poseTranslations);
      const rollbackConstraints = cloneStudioVrmIkConstraints(pending.before.ikConstraints);
      persistentIkResolvedSignatureRef.current = buildStudioVrmPersistentIkSignature({
        modelId: activeModelId,
        bones: rollbackBones,
        fingerEdits: rollbackFingers,
        yOffset: pending.before.yOffset,
        translations: rollbackTranslations,
        bodyRotation: pending.before.bodyRotation,
        bodyScale: pending.before.bodyScale ?? bodyScale,
        proportions: parseAvatarForgeState(pending.before.avatarForge).proportions,
        constraints: rollbackConstraints,
        lockedPoseBones,
        jointProfile: rigJointProfile,
        fullBodyIk: fullBodyIkEnabled,
        footPlant: footPlantEnabled,
        floorHeight: rigFloorHeight,
      });
      setPersistentIkReconciling(false);
      setActivePoseId(pending.before.poseId ?? "default");
      setCustomBones(rollbackBones);
      setFingerEdits(rollbackFingers);
      setCustomYOffset(pending.before.yOffset);
      setPoseTranslations(rollbackTranslations);
      setIkConstraints(rollbackConstraints);
      setBodyRotation(pending.before.bodyRotation);
      applyPoserVisualState(vrm, {
        bones: rollbackBones,
        yOffset: pending.before.yOffset,
        poseTranslations: rollbackTranslations,
        fingerEdits: rollbackFingers,
        bodyScale: pending.before.bodyScale ?? bodyScale,
      });
      applyRotationToVrm(vrm, pending.before.bodyRotation);
      setJointHandleStatus(`${message} 변경 전 상태로 되돌렸습니다.`);
    };
    if (
      pendingPersistentIkCommandRef.current
      && pendingPersistentIkCommandRef.current.inputSignature !== inputSignature
    ) {
      rollbackPendingCommand("고정점 보정 중 다른 포즈 변경이 시작되어 먼저 하던 명령을 취소했습니다.");
      return;
    }
    if (
      !open
      || !vrm
      || lockedConstraints.length === 0
      || jointHandleInteracting
      || jointIkTransactionRef.current
      || webcamActive
      || idleAnimation
      || isCapturing
      || isSharingPose
      || isThumbnailCapturing
    ) {
      if (lockedConstraints.length === 0) {
        persistentIkResolvedSignatureRef.current = "";
        setPersistentIkReconciling(false);
      }
      return;
    }
    if (persistentIkResolvedSignatureRef.current === inputSignature) {
      const pending = pendingPersistentIkCommandRef.current;
      if (pending?.inputSignature === inputSignature) {
        commitPendingCommand(pending.candidateAfter);
      }
      setPersistentIkReconciling(false);
      return;
    }

    const revision = persistentIkReconcileRevisionRef.current + 1;
    persistentIkReconcileRevisionRef.current = revision;
    setPersistentIkReconciling(true);
    const frame = requestAnimationFrame(() => {
      if (
        persistentIkReconcileRevisionRef.current !== revision
        || jointIkTransactionRef.current
        || vrmRef.current !== vrm
      ) {
        setPersistentIkReconciling(false);
        return;
      }
      const coordinateScene = captureRef.current.scene;
      if (!coordinateScene) {
        // CaptureBridge가 scene generation을 올리면 이 effect가 다시 실행된다. 그 전까지는
        // 미해결 포즈를 캡처하거나 history에 넣지 않는다.
        setPersistentIkReconciling(true);
        setJointHandleStatus("고정점 장면 좌표를 준비하지 못해 포즈 변경을 보정하지 못했습니다.");
        return;
      }
      for (const constraint of lockedConstraints) {
        if (!(constraint.effector in STUDIO_VRM_USER_IK_CHAINS)) continue;
        const chain = STUDIO_VRM_USER_IK_CHAINS[constraint.effector];
        if ([chain.upper, chain.lower, chain.end].some((bone) => lockedPoseBones.includes(bone))) {
          rollbackPendingCommand("관절 잠금과 손·발 고정점 유지가 충돌합니다.");
          return;
        }
      }

      applyPoserVisualState(vrm, {
        bones: customBones,
        yOffset: customYOffset,
        poseTranslations,
        fingerEdits,
        bodyScale,
      });
      applyRotationToVrm(vrm, bodyRotation);
      const worldConstraints = lockedConstraints.map((constraint: StudioVrmIkConstraint) => {
        const target = studioVrmSceneLocalPointToWorld(coordinateScene, constraint.target);
        const pole = constraint.pole
          ? studioVrmSceneLocalPointToWorld(coordinateScene, constraint.pole)
          : null;
        return target && (!constraint.pole || pole)
          ? {
              effector: constraint.effector,
              targetWorld: new THREE.Vector3(target[0], target[1], target[2]),
              poleWorld: pole ? new THREE.Vector3(pole[0], pole[1], pole[2]) : undefined,
            }
          : null;
      });
      if (worldConstraints.some((constraint) => constraint === null)) {
        rollbackPendingCommand("저장된 손·발 고정점 좌표를 해석하지 못했습니다.");
        return;
      }
      const [primary, ...rest] = worldConstraints as Array<{
        effector: StudioVrmIkEffectorBone;
        targetWorld: THREE.Vector3;
        poleWorld?: THREE.Vector3;
      }>;
      if (!primary) {
        rollbackPendingCommand("유지할 손·발 고정점을 찾지 못했습니다.");
        return;
      }
      const result = solveStudioVrmFullBodyIk(vrm, {
        primary,
        lockedTargets: rest,
        baseTranslations: poseTranslations,
        jointProfile: rigJointProfile,
        fullBodyIk: fullBodyIkEnabled,
        footPlant: { enabled: footPlantEnabled, floorHeight: rigFloorHeight },
      });
      if (!result || persistentIkReconcileRevisionRef.current !== revision) {
        rollbackPendingCommand("현재 포즈에서 저장된 손·발 고정점을 함께 유지하지 못했습니다.");
        return;
      }
      if (!canCommitStudioVrmIkResult(result)) {
        rollbackPendingCommand(STUDIO_VRM_IK_NOT_CONVERGED_STATUS);
        return;
      }
      const nextBones = stripFingerBones(result.bones);
      const nextFingers = extractStudioVrmFingerRotations(result.bones);
      const nextTranslations = cloneStudioVrmPoseTranslations(result.translations);
      const outputSignature = buildStudioVrmPersistentIkSignature({
        modelId: activeModelId,
        bones: nextBones,
        fingerEdits: nextFingers,
        yOffset: result.yOffset,
        translations: nextTranslations,
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
      persistentIkResolvedSignatureRef.current = outputSignature;
      const pending = pendingPersistentIkCommandRef.current;
      if (pending?.inputSignature === inputSignature) {
        commitPendingCommand(serializeFullVrmState({
          ...pending.candidateAfter,
          bones: nextBones,
          fingerOverrides: nextFingers,
          yOffset: result.yOffset,
          poseTranslations: nextTranslations,
        }));
      }
      setPersistentIkReconciling(false);
      setCustomBones(nextBones);
      setFingerEdits(nextFingers);
      setCustomYOffset(result.yOffset);
      setPoseTranslations(nextTranslations);
      applyStudioVrmRotationPose(vrm, result, bodyScale);
      setJointHandleStatus(`고정점 ${lockedConstraints.length}개를 현재 포즈에 다시 맞췄습니다.`);
    });
    return () => {
      persistentIkReconcileRevisionRef.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [
    activeModelId,
    avatarForgeState.proportions,
    bodyRotation,
    bodyScale,
    captureSceneGeneration,
    customBones,
    customYOffset,
    fingerEdits,
    footPlantEnabled,
    fullBodyIkEnabled,
    idleAnimation,
    ikConstraints,
    isCapturing,
    isSharingPose,
    isThumbnailCapturing,
    jointHandleInteracting,
    lockedPoseBones,
    open,
    poseTranslations,
    rigFloorHeight,
    rigJointProfile,
    vrm,
    webcamActive,
  ]);

  const resetFullStateHistory = useCallback(() => {
    fullStateHistoryRef.current = resetStudioVrmFullStateHistory(fullStateHistoryRef.current);
    isRestoringRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const texturePaintModeSelected =
    activePanelTab === "character" && activeCharacterSection === "surface";
  const texturePaintSceneSyncRequired = Boolean(
    initialScene
    && texturePaintRuntimeSceneIdentity !== texturePaintSceneIdentity,
  );
  const texturePaintRestoreRequired =
    texturePaintSceneSyncRequired
    || (initialScene?.surfacePaint.textures.length ?? 0) > 0;
  const texturePaintDisabledReason = !vrm
    ? "표면을 칠할 VRM 모델을 먼저 불러오세요."
    : broadcastPreviewActive
      ? "방송 미리보기를 종료한 뒤 표면을 칠할 수 있습니다."
    : texturePaintSceneSyncRequired
      ? "새 장면의 표면 페인팅 런타임을 준비하는 중입니다."
      : texturePaintRestoreRequired && texturePaintPersistenceStatus === "idle"
      ? "저장된 표면 페인팅의 VRM 모델과 재질을 준비하는 중입니다."
    : texturePaintPersistenceStatus === "restoring"
      ? "저장된 표면 페인팅을 원본 재질에 복원하는 중입니다."
      : texturePaintPersistenceStatus === "error"
        ? texturePaintPersistenceError || "저장된 표면 페인팅을 복원하지 못했습니다."
    : webcamActive || webcamLoading
      ? "웹캠 트래킹을 멈춘 뒤 표면을 칠할 수 있습니다."
      : idleAnimation || physicsPreview
        ? "대기 애니메이션과 물리 미리보기를 멈춘 뒤 표면을 칠할 수 있습니다."
        : isCapturing || isSharingPose || isThumbnailCapturing
          ? "캡처·공유 처리가 끝난 뒤 표면을 칠할 수 있습니다."
          : persistentIkReconciling || jointHandleInteracting || isViewportHandIkDragging
            ? "포즈 계산과 관절 이동이 끝난 뒤 표면을 칠할 수 있습니다."
            : mannequinMode
              ? "중립 데생 인형 보기를 끄면 원래 텍스처를 칠할 수 있습니다."
              : "";
  const texturePaintInteractionEnabled =
    texturePaintModeSelected && texturePaintDisabledReason.length === 0;
  const texturePaintSampling = texturePaintSnapshot?.activeOperation === "sample";
  const texturePaintFilling = texturePaintSnapshot?.activeOperation === "fill";
  const texturePaintSurfaceStrokeActive = Boolean(
    texturePaintSurfaceToolSnapshot
    && ["collecting", "committing", "cancelling"].includes(
      texturePaintSurfaceToolSnapshot.status,
    ),
  );
  const texturePaintStrokeActive =
    texturePaintSurfaceStrokeActive
    || texturePaintSnapshot?.status === "loading"
    || texturePaintSnapshot?.status === "painting";
  const texturePaintTargetLabel = texturePaintSnapshot?.activeTarget
    ? `${texturePaintSnapshot.activeTarget.sourceName || "Base color"} · ${texturePaintSnapshot.activeTarget.width}×${texturePaintSnapshot.activeTarget.height}`
    : null;
  const texturePaintBudgetErrorStatus =
    texturePaintDevicePlan.tier === "constrained"
    && texturePaintSnapshot?.error?.code === "target-rgba-budget"
      ? "이 기기는 실행 취소 기록을 포함해 64 MiB 안에서 표면을 칠합니다. 텍스처를 줄이거나 데스크톱에서 편집해 주세요."
      : texturePaintDevicePlan.tier === "constrained"
        && texturePaintSnapshot?.error?.code === "aggregate-rgba-budget"
        ? "추가 텍스처가 이 기기의 64 MiB 상주 메모리 한도를 넘습니다. 현재 결과를 캡처한 뒤 모델을 다시 열어 다음 텍스처를 편집해 주세요."
        : "";
  const texturePaintBrushProductBlocked =
    isStudioVrmTexturePaintBrushProductBlocked(texturePaintSettings.tool);
  const texturePaintSurfaceStatus =
    texturePaintSettings.tool === "surface-brush"
    && texturePaintSurfaceToolSnapshot
    && texturePaintSurfaceToolSnapshot.status !== "ready"
      ? texturePaintSurfaceToolSnapshot.message
      : "";
  const texturePaintStatus = texturePaintDisabledReason
    || texturePaintBudgetErrorStatus
    || (texturePaintBrushProductBlocked ? STUDIO_VRM_SURFACE_BRUSH_UNAVAILABLE_REASON : "")
    || texturePaintSurfaceStatus
    || texturePaintSnapshot?.error?.message
    || texturePaintSnapshot?.guidance?.message
    || (texturePaintSnapshot?.status === "loading"
      ? texturePaintSampling
        ? "표면의 baseColor 채널에서 정확한 색상을 읽는 중입니다."
        : texturePaintFilling
          ? "ColorDrop 영역을 기기 안에서 계산하고 있습니다. 완료 전에는 원본을 변경하지 않습니다."
        : "텍스처를 안전한 편집 사본으로 준비하는 중입니다. 완료되면 ColorDrop과 스포이드를 사용할 수 있습니다."
      : texturePaintSnapshot?.status === "painting"
        ? "표면 작업을 안전하게 마무리하는 중입니다."
        : texturePaintEyedropperActive
          ? "스포이드가 준비됐습니다. 캐릭터 표면을 한 번 누르면 색상만 가져오고 ColorDrop으로 돌아갑니다."
        : texturePaintSnapshot?.activeTarget
          ? texturePaintSettings.tool === "surface-brush"
            ? "모델 표면을 드래그해 직접 그리세요. Ctrl/⌘+Z로 이 텍스처 획을 되돌릴 수 있습니다."
            : "표면을 한 번 눌러 ColorDrop으로 채우세요. Ctrl/⌘+Z로 이 채우기를 되돌릴 수 있습니다."
          : "뷰포트에서 옷·피부·머리 표면을 누르면 해당 텍스처를 선택합니다.");
  const viewportCanUndo =
    !broadcastPreviewActive
    && !texturePaintStrokeActive
    && (canUndo || (texturePaintModeSelected && (texturePaintSnapshot?.history.undoCount ?? 0) > 0));
  const viewportCanRedo =
    !broadcastPreviewActive
    && !texturePaintStrokeActive
    && (canRedo || (texturePaintModeSelected && (texturePaintSnapshot?.history.redoCount ?? 0) > 0));
  const viewportCameraInteractionLocked =
    isCapturing || isSharingPose || isThumbnailCapturing;

  const restoreHistoryStep = (direction: -1 | 1) => {
    if (
      pendingPersistentIkCommandRef.current
      || persistentIkReconciling
      || !persistentIkCaptureIsReady()
    ) {
      setJointHandleStatus("손·발 고정점 보정이 끝난 뒤 편집 기록을 복원해 주세요.");
      return;
    }
    if (jointHandleInteracting || jointIkTransactionRef.current) {
      cancelJointIkTransaction({
        status: "진행 중인 IK 이동을 취소한 뒤 편집 기록을 복원했습니다.",
      });
    }
    const currentVrm = vrmRef.current;
    if (!currentVrm) {
      resetFullStateHistory();
      return;
    }
    const transition = stepStudioVrmFullStateHistory(
      fullStateHistoryRef.current,
      direction,
      activeModelId,
    );
    const snap = transition.snapshot;
    if (!snap) {
      fullStateHistoryRef.current = transition.history;
      setCanUndo(transition.history.index > 0);
      setCanRedo(transition.history.index < transition.history.entries.length - 1);
      return;
    }
    isRestoringRef.current = true;
    const restored = h.commitFullStateRestore(snap, currentVrm, {
      trustPersistentIkPose: true,
    });
    if (!restored) {
      // The proportion transaction kept the previous viewport authoritative. Keep the history
      // cursor there too, and let the next real edit be recorded instead of consuming it as a
      // successful restore render.
      isRestoringRef.current = false;
      return;
    }
    fullStateHistoryRef.current = transition.history;
    setCanUndo(transition.history.index > 0);
    setCanRedo(transition.history.index < transition.history.entries.length - 1);
  };
  const doUndo = () => {
    if (avatarForgeReferencePreviewActive) {
      setAvatarForgeReferencePreview(null);
      return;
    }
    if (
      broadcastPreviewActive
      || texturePaintMutationBlockedRef.current
      || texturePaintSurfaceStrokeActive
      || typeof texturePaintSnapshotRef.current?.activePointerId === "number"
    ) return;
    if (
      texturePaintModeSelected
      && (texturePaintSnapshotRef.current?.history.undoCount ?? 0) > 0
    ) {
      handleTexturePaintUndo();
      return;
    }
    restoreHistoryStep(-1);
  };
  const doRedo = () => {
    if (avatarForgeReferencePreviewActive) {
      setAvatarForgeReferencePreview(null);
      return;
    }
    if (
      broadcastPreviewActive
      || texturePaintMutationBlockedRef.current
      || texturePaintSurfaceStrokeActive
      || typeof texturePaintSnapshotRef.current?.activePointerId === "number"
    ) return;
    if (
      texturePaintModeSelected
      && (texturePaintSnapshotRef.current?.history.redoCount ?? 0) > 0
    ) {
      handleTexturePaintRedo();
      return;
    }
    restoreHistoryStep(1);
  };

  const poseMaterialRuntimeDisabled =
    !vrm ||
    broadcastPreviewActive ||
    webcamActive ||
    webcamLoading ||
    idleAnimation ||
    isCapturing ||
    isSharingPose ||
    isThumbnailCapturing ||
    persistentIkReconciling ||
    jointHandleInteracting ||
    isViewportHandIkDragging;
  const vrmFrameLoop = resolveStudioVrmFrameLoop({
    webcamActive,
    idleAnimation,
    physicsPreview,
    turntable,
    viewportHandIkDragging: isViewportHandIkDragging,
    jointHandleInteracting,
    persistentIkReconciling,
    capturing: isCapturing,
    sharingPose: isSharingPose,
    thumbnailCapturing: isThumbnailCapturing,
  });

  Object.assign(h, {
    captureFullState,
    captureVisualAuthorityIdentity,
    resetFullStateHistory,
    texturePaintModeSelected,
    texturePaintSceneSyncRequired,
    texturePaintRestoreRequired,
    texturePaintDisabledReason,
    texturePaintInteractionEnabled,
    texturePaintSampling,
    texturePaintFilling,
    texturePaintSurfaceStrokeActive,
    texturePaintStrokeActive,
    texturePaintTargetLabel,
    texturePaintBudgetErrorStatus,
    texturePaintBrushProductBlocked,
    texturePaintStatus,
    viewportCanUndo,
    viewportCanRedo,
    viewportCameraInteractionLocked,
    restoreHistoryStep,
    doUndo,
    doRedo,
    poseMaterialRuntimeDisabled,
    vrmFrameLoop,
  });
}
