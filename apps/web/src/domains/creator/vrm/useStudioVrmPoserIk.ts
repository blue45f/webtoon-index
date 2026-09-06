import * as THREE from "three";

/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  solveStudioVrmFullBodyIk,
  type StudioVrmFullBodyIkResult,
} from "./studio-vrm-full-body-ik";
import {
  canCommitStudioVrmIkResult,
  studioVrmSceneLocalPointToWorld,
  studioVrmWorldPointToSceneLocal,
  upsertStudioVrmIkConstraint,
} from "./studio-vrm-ik-constraints";
import {
  bakeStudioVrmRuntimePose,
} from "./studio-vrm-pose-bake";
import {
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  BONE_LABELS,
  STUDIO_VRM_IK_NOT_CONVERGED_STATUS,
} from "./studio-vrm-poser-catalogs";
import {
  applyStudioVrmRotationPose,
  categoryForStudioVrmJointHandle,
  createStudioVrmIkPole,
  extractStudioVrmFingerRotations,
} from "./studio-vrm-poser-helpers";
import {
  serializeFullVrmState,
  stripFingerBones,
} from "./studio-vrm-poser-utils";
import {
  commitStudioVrmFullStateHistoryTransaction,
} from "./studio-vrm-state-history";
import {
  solveStudioVrmUserIk,
  STUDIO_VRM_USER_IK_CHAINS,
  type StudioVrmUserIkResult,
} from "./studio-vrm-user-ik";
import type {
  StudioVrmIkEffectorBone,
  StudioVrmIkHandleControl,
  StudioVrmJointHandleBone,
  StudioVrmJointWorldPoint,
} from "./StudioVrmJointHandles";

import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";

export function useStudioVrmPoserIk(h: StudioVrmPoserHost): void {
  const {
    status,
    vrm,
    setActivePoseId,
    setCustomBones,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    ikConstraints,
    setIkConstraints,
    setActiveCategory,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    setSelectedJointHandle,
    setSelectedIkPole,
    jointHandleInteracting,
    setJointHandleInteracting,
    setJointHandleSessionGeneration,
    setJointHandleStatus,
    fullStateHistoryRef,
    setCanUndo,
    setCanRedo,
    isCapturing,
    activeModelId,
    bodyScale,
    fingerEdits,
    setFingerEdits,
    idleAnimation,
    webcamActive,
    vrmRef,
    captureRef,
    manualPoseDetailsRef,
    jointIkTransactionRef,
    jointIkRevisionRef,
    persistentIkResolvedSignatureRef,
    setPersistentIkReconciling,
    handlePanelTabChange,
    currentPersistentIkSignature,
  } = h;
  function handleJointHandleSelect(bone: StudioVrmJointHandleBone) {
    setSelectedIkPole(null);
    setSelectedJointHandle(bone);
    const category = categoryForStudioVrmJointHandle(bone);
    if (category) setActiveCategory(category);
    handlePanelTabChange("pose");
    if (manualPoseDetailsRef.current) manualPoseDetailsRef.current.open = true;
    requestAnimationFrame(() => {
      document.getElementById(`vrm-manual-bone-${bone}`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }

  function handleJointHandlePoleSelect(effector: StudioVrmIkEffectorBone) {
    setSelectedJointHandle(effector);
    setSelectedIkPole(effector);
    setActiveCategory(categoryForStudioVrmJointHandle(effector) ?? "torso");
    handlePanelTabChange("pose");
    setJointHandleStatus(
      `${BONE_LABELS[effector] ?? effector} IK 폴 선택 · 팔꿈치·무릎이 향할 방향을 조절합니다.`,
    );
  }

  function cancelJointIkTransaction(options: {
    forceInvalidate?: boolean;
    restoreBaseline?: boolean;
    remountHandles?: boolean;
    status?: string;
  } = {}) {
    const {
      forceInvalidate = false,
      restoreBaseline = true,
      remountHandles = true,
      status: nextStatus,
    } = options;
    const transaction = jointIkTransactionRef.current;
    if (!forceInvalidate && !transaction && !jointHandleInteracting) {
      if (nextStatus !== undefined) setJointHandleStatus(nextStatus);
      return;
    }
    jointIkRevisionRef.current += 1;
    jointIkTransactionRef.current = null;
    if (restoreBaseline && transaction?.vrm === vrmRef.current) {
      applyStudioVrmRotationPose(transaction.vrm, transaction.baseline, bodyScale);
    }
    setJointHandleInteracting(false);
    if (remountHandles) {
      // Child handles own pointer capture/drag refs. Remounting invalidates an in-flight pointer-up
      // after undo, model/config changes, or reset so it cannot recreate and commit stale preview.
      setJointHandleSessionGeneration((generation: number) => generation + 1);
    }
    if (nextStatus !== undefined) setJointHandleStatus(nextStatus);
  }

  function previewJointHandleIk(
    effector: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint,
    options: {
      control?: StudioVrmIkHandleControl;
      poleWorld?: StudioVrmJointWorldPoint;
    } = {},
  ): StudioVrmUserIkResult | StudioVrmFullBodyIkResult | null {
    const currentVrm = vrmRef.current;
    const coordinateScene = captureRef.current.scene;
    if (!currentVrm || !coordinateScene || webcamActive || idleAnimation || isCapturing) {
      setJointHandleStatus("실시간 추적·대기 애니메이션·캡처 중에는 관절 핸들을 편집할 수 없습니다.");
      return null;
    }
    const control = options.control ?? "target";
    const targetLocal = studioVrmWorldPointToSceneLocal(coordinateScene, worldPosition);
    const canonicalTarget = targetLocal
      ? studioVrmSceneLocalPointToWorld(coordinateScene, targetLocal)
      : null;
    const poleLocal = options.poleWorld
      ? studioVrmWorldPointToSceneLocal(coordinateScene, options.poleWorld)
      : null;
    const canonicalPole = poleLocal
      ? studioVrmSceneLocalPointToWorld(coordinateScene, poleLocal)
      : null;
    if (!canonicalTarget || (options.poleWorld && !canonicalPole)) {
      const activeTransaction = jointIkTransactionRef.current;
      if (activeTransaction?.vrm === currentVrm) {
        applyStudioVrmRotationPose(currentVrm, activeTransaction.baseline, bodyScale);
        activeTransaction.latest = null;
      }
      setJointHandleStatus("IK 목표 또는 폴 좌표가 장면 안전 범위를 벗어나 시작 자세로 되돌렸습니다.");
      return null;
    }
    const targetWorld = new THREE.Vector3(
      canonicalTarget[0],
      canonicalTarget[1],
      canonicalTarget[2],
    );
    const poleWorldOverride = canonicalPole
      ? new THREE.Vector3(canonicalPole[0], canonicalPole[1], canonicalPole[2])
      : undefined;
    const chain = STUDIO_VRM_USER_IK_CHAINS[effector];
    if ([chain.upper, chain.lower, chain.end].some((boneName) => lockedPoseBones.includes(boneName))) {
      setJointHandleStatus("잠긴 관절이 포함된 손·발 체인은 IK로 움직일 수 없습니다. 먼저 해당 관절의 잠금을 해제해 주세요.");
      return null;
    }
    if (footPlantEnabled) {
      const plantedLegBones = (["leftFoot", "rightFoot"] as const).flatMap((plantedFoot) => {
        const plantedChain = STUDIO_VRM_USER_IK_CHAINS[plantedFoot];
        return [plantedChain.upper, plantedChain.lower, plantedChain.end];
      });
      if (plantedLegBones.some((boneName) => lockedPoseBones.includes(boneName))) {
        setJointHandleStatus("양발 고정에 참여하는 다리에 잠긴 관절이 있습니다. 다리 잠금을 해제하거나 양발 고정을 꺼 주세요.");
        return null;
      }
    }

    let transaction = jointIkTransactionRef.current;
    if (
      !transaction
      || transaction.vrm !== currentVrm
      || transaction.coordinateScene !== coordinateScene
      || transaction.effector !== effector
      || transaction.control !== control
      || transaction.revision !== jointIkRevisionRef.current
    ) {
      if (transaction) {
        applyStudioVrmRotationPose(transaction.vrm, transaction.baseline, bodyScale);
      }
      const baseline = bakeStudioVrmRuntimePose(currentVrm);
      if (!baseline) {
        setJointHandleStatus("이 캐릭터의 현재 관절 자세를 읽지 못했습니다.");
        return null;
      }
      transaction = {
        vrm: currentVrm,
        coordinateScene,
        effector,
        control,
        revision: jointIkRevisionRef.current,
        authoritativeSignature: currentPersistentIkSignature(),
        baseline: {
          ...baseline,
          translations: cloneStudioVrmPoseTranslations(poseTranslations),
        },
        targetWorld: targetWorld.clone(),
        poleWorld: poleWorldOverride ?? (() => {
          const persistedPole = ikConstraints.find((constraint: StudioVrmIkConstraint) => (
            constraint.effector === effector && constraint.enabled
          ))?.pole;
          const worldPole = persistedPole
            ? studioVrmSceneLocalPointToWorld(coordinateScene, persistedPole)
            : null;
          return worldPole
            ? new THREE.Vector3(worldPole[0], worldPole[1], worldPole[2])
            : createStudioVrmIkPole(currentVrm, effector);
        })(),
        latest: null,
      };
      jointIkTransactionRef.current = transaction;
    } else {
      // 매 move를 직전 preview가 아닌 같은 시작 자세에서 다시 풀어 누적 오차와 관절 뒤집힘을 막는다.
      applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale);
      transaction.targetWorld.copy(targetWorld);
      if (poleWorldOverride) transaction.poleWorld = poleWorldOverride;
    }

    const lockedTargets: Array<{
      effector: StudioVrmIkEffectorBone;
      targetWorld: THREE.Vector3;
      poleWorld?: THREE.Vector3;
    }> = [];
    const otherConstraints: StudioVrmIkConstraint[] = ikConstraints;
    for (const constraint of otherConstraints) {
      if (!constraint.enabled || !constraint.locked || constraint.effector === effector) continue;
      if (!(constraint.effector in STUDIO_VRM_USER_IK_CHAINS)) continue;
      const lockedChain = STUDIO_VRM_USER_IK_CHAINS[constraint.effector];
      if (
        [lockedChain.upper, lockedChain.lower, lockedChain.end]
          .some((boneName) => lockedPoseBones.includes(boneName))
      ) {
        applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale);
        transaction.latest = null;
        setJointHandleStatus("유지 중인 고정점 체인에 잠긴 관절이 있습니다. 관절 잠금 또는 고정점 유지를 해제해 주세요.");
        return null;
      }
      const target = studioVrmSceneLocalPointToWorld(coordinateScene, constraint.target);
      const pole = constraint.pole
        ? studioVrmSceneLocalPointToWorld(coordinateScene, constraint.pole)
        : null;
      if (!target || (constraint.pole && !pole)) {
        applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale);
        transaction.latest = null;
        setJointHandleStatus("유지 중인 고정점의 장면 좌표를 해석하지 못해 IK 계산을 중단했습니다.");
        return null;
      }
      lockedTargets.push({
        effector: constraint.effector,
        targetWorld: new THREE.Vector3(target[0], target[1], target[2]),
        poleWorld: pole ? new THREE.Vector3(pole[0], pole[1], pole[2]) : undefined,
      });
    }
    const result = fullBodyIkEnabled || footPlantEnabled || lockedTargets.length > 0
      ? solveStudioVrmFullBodyIk(currentVrm, {
          primary: {
            effector,
            targetWorld,
            poleWorld: transaction.poleWorld,
          },
          baseTranslations: transaction.baseline.translations,
          jointProfile: rigJointProfile,
          fullBodyIk: fullBodyIkEnabled,
          footPlant: {
            enabled: footPlantEnabled,
            floorHeight: rigFloorHeight,
          },
          lockedTargets,
        })
      : solveStudioVrmUserIk(currentVrm, {
          effector,
          targetWorld,
          poleWorld: transaction.poleWorld,
          jointProfile: rigJointProfile,
          fullBodyIk: false,
          footPlant: false,
        });
    if (!result) {
      applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale);
      transaction.latest = null;
      setJointHandleStatus("선택한 손·발의 IK 체인을 계산하지 못했습니다. 모델의 휴머노이드 본 구성을 확인해 주세요.");
      return null;
    }
    if (!canCommitStudioVrmIkResult(result)) {
      applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale);
      transaction.latest = null;
      setJointHandleStatus(STUDIO_VRM_IK_NOT_CONVERGED_STATUS);
      return null;
    }

    transaction.latest = result;
    applyStudioVrmRotationPose(currentVrm, {
      ...result,
      translations: "translations" in result
        ? result.translations
        : transaction.baseline.translations,
    }, bodyScale);
    setJointHandleStatus(
      "constraints" in result
        ? result.constraints.length > 1
          ? `다중 체인 ${result.constraints.length}개를 ${result.iterations}회 반복 계산 중 · 양발 고정과 활성 ${STUDIO_VRM_USER_IK_CHAINS[effector].kind === "hand" ? "손" : "발"} 목표를 함께 유지합니다.`
          : "전신 이동과 활성 IK 체인을 함께 미리 보는 중입니다."
        : result.clamped
        ? "목표가 팔·다리 길이를 벗어나 도달 가능한 최대 위치에서 미리 보는 중입니다."
        : result.limited
          ? "관절 보호 범위 안으로 부드럽게 제한해 미리 보는 중입니다."
          : "IK 자세 미리보기 · 놓으면 한 번만 포즈에 적용됩니다.",
    );
    return result;
  }

  function handleJointHandleIkCommit(
    effector: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint,
    control: StudioVrmIkHandleControl = "target",
  ) {
    let transaction = jointIkTransactionRef.current;
    if (
      !transaction
      || transaction.effector !== effector
      || transaction.control !== control
      || !transaction.latest
    ) {
      if (control === "pole") {
        previewJointHandlePole(effector, worldPosition);
      } else {
        previewJointHandleIk(effector, worldPosition);
      }
      transaction = jointIkTransactionRef.current;
    }
    const result = transaction?.latest;
    const currentVrm = vrmRef.current;
    if (result && !canCommitStudioVrmIkResult(result)) {
      cancelJointIkTransaction({
        restoreBaseline: true,
        remountHandles: false,
        status: STUDIO_VRM_IK_NOT_CONVERGED_STATUS,
      });
      return;
    }
    if (
      !result
      || !currentVrm
      || transaction?.vrm !== currentVrm
      || transaction.coordinateScene !== captureRef.current.scene
      || transaction.revision !== jointIkRevisionRef.current
    ) {
      cancelJointIkTransaction({ remountHandles: false });
      return;
    }

    const nextFingers = extractStudioVrmFingerRotations(result.bones);
    const nextBones = stripFingerBones(result.bones);
    const nextTranslations = "translations" in result
      ? result.translations
      : transaction.baseline.translations;
    const persistedTargetWorld = "constraints" in result
      ? result.constraints.find(
          (constraint: { effector: StudioVrmIkEffectorBone; targetWorld: readonly [number, number, number] }) =>
            constraint.effector === effector,
        )?.targetWorld
      : ([
          transaction.targetWorld.x,
          transaction.targetWorld.y,
          transaction.targetWorld.z,
        ] as const);
    const targetLocal = persistedTargetWorld
      ? studioVrmWorldPointToSceneLocal(transaction.coordinateScene, persistedTargetWorld)
      : null;
    const poleLocal = transaction.poleWorld
      ? studioVrmWorldPointToSceneLocal(transaction.coordinateScene, transaction.poleWorld)
      : null;
    if (!targetLocal || (transaction.poleWorld && !poleLocal)) {
      cancelJointIkTransaction({ remountHandles: false });
      setJointHandleStatus("IK 목표를 장면 좌표로 저장하지 못했습니다.");
      return;
    }
    const existingConstraint = ikConstraints.find((constraint: StudioVrmIkConstraint) => constraint.effector === effector);
    const nextConstraints = upsertStudioVrmIkConstraint(ikConstraints, {
      effector,
      enabled: true,
      locked: existingConstraint?.locked ?? true,
      target: targetLocal,
      pole: poleLocal,
    });
    const before = h.captureFullState();
    const after = serializeFullVrmState({
      ...before,
      poseId: "manual-ik",
      bones: nextBones,
      fingerOverrides: nextFingers,
      yOffset: result.yOffset,
      poseTranslations: nextTranslations,
      ikConstraints: nextConstraints,
    });
    persistentIkResolvedSignatureRef.current = currentPersistentIkSignature({
      bones: nextBones,
      fingerEdits: nextFingers,
      yOffset: result.yOffset,
      translations: nextTranslations,
      constraints: nextConstraints,
    });
    setPersistentIkReconciling(false);
    const nextHistory = commitStudioVrmFullStateHistoryTransaction(
      fullStateHistoryRef.current,
      before,
      after,
      activeModelId,
    );
    fullStateHistoryRef.current = nextHistory;
    setCanUndo(nextHistory.index > 0);
    setCanRedo(nextHistory.index < nextHistory.entries.length - 1);
    jointIkRevisionRef.current += 1;
    jointIkTransactionRef.current = null;
    setActivePoseId("manual-ik");
    setCustomBones(nextBones);
    setFingerEdits(nextFingers);
    setCustomYOffset(result.yOffset);
    setPoseTranslations(cloneStudioVrmPoseTranslations(nextTranslations));
    setIkConstraints(nextConstraints);
    setSelectedJointHandle(effector);
    setSelectedIkPole(control === "pole" ? effector : null);
    setJointHandleInteracting(false);
    applyStudioVrmRotationPose(currentVrm, {
      ...result,
      translations: nextTranslations,
    }, bodyScale);
    setJointHandleStatus(
      `${BONE_LABELS[effector] ?? effector} IK ${control === "pole" ? "폴 방향" : "목표"} 적용 완료${"constraints" in result ? ` · ${result.constraints.length}개 체인 동시 반영` : ""}${result.clamped ? " · 도달/이동 범위에서 제한됨" : result.limited ? " · 관절 범위에서 제한됨" : ""}`,
    );
  }

  function previewJointHandlePole(
    effector: StudioVrmIkEffectorBone,
    poleWorld: StudioVrmJointWorldPoint,
  ): StudioVrmUserIkResult | StudioVrmFullBodyIkResult | null {
    const coordinateScene = captureRef.current.scene;
    const constraint = ikConstraints.find((candidate: StudioVrmIkConstraint) => (
      candidate.effector === effector && candidate.enabled
    ));
    const targetWorld = coordinateScene && constraint
      ? studioVrmSceneLocalPointToWorld(coordinateScene, constraint.target)
      : null;
    if (!targetWorld) {
      setJointHandleStatus("활성 IK 목표를 찾지 못해 폴 방향을 이동할 수 없습니다.");
      return null;
    }
    return previewJointHandleIk(effector, targetWorld, {
      control: "pole",
      poleWorld,
    });
  }

  function handleJointHandlePoleCommit(
    effector: StudioVrmIkEffectorBone,
    poleWorld: StudioVrmJointWorldPoint,
  ) {
    handleJointHandleIkCommit(effector, poleWorld, "pole");
  }

  function handleJointHandleIkRollback(effector: StudioVrmIkEffectorBone) {
    const transaction = jointIkTransactionRef.current;
    if (transaction?.effector === effector) {
      cancelJointIkTransaction({
        remountHandles: false,
        status: "IK 이동을 취소하고 시작 자세로 되돌렸습니다.",
      });
    }
    setJointHandleInteracting(false);
  }

  function handleBakeCurrentPoseForManualEditing() {
    const currentVrm = vrmRef.current;
    if (!currentVrm || webcamActive || idleAnimation || isCapturing) return;
    const baked = bakeStudioVrmRuntimePose(currentVrm);
    if (!baked) {
      setJointHandleStatus("현재 자세를 관절 편집값으로 변환하지 못했습니다.");
      return;
    }
    setActivePoseId("manual-pose");
    setCustomBones(stripFingerBones(baked.bones));
    setFingerEdits(extractStudioVrmFingerRotations(baked.bones));
    setCustomYOffset(baked.yOffset);
    applyStudioVrmRotationPose(currentVrm, {
      ...baked,
      translations: poseTranslations,
    }, bodyScale);
    setJointHandleStatus("현재 보이는 자세를 회전 기반 관절 편집값으로 동기화했습니다.");
  }

  Object.assign(h, {
    handleJointHandleSelect,
    handleJointHandlePoleSelect,
    cancelJointIkTransaction,
    previewJointHandleIk,
    handleJointHandleIkCommit,
    previewJointHandlePole,
    handleJointHandlePoleCommit,
    handleJointHandleIkRollback,
    handleBakeCurrentPoseForManualEditing,
  });
}
