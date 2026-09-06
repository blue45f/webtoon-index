/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useEffect,
  type ChangeEvent,
} from "react";
import * as THREE from "three";

import {
  POSER_FINGER_BONES,
  type StudioExpressionPreset,
} from "../studio-pose-presets";

import {
  resolveStudioVrmFingerAuthority,
} from "./studio-vrm-auto-grip-authority";
import {
  parseAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  applyStudioVrmCostumeState,
} from "./studio-vrm-costume-runtime";
import {
  createStudioVrmExpressionApplyPlan,
} from "./studio-vrm-expression-apply";
import {
  cloneStudioVrmIkConstraints,
  mirrorStudioVrmIkConstraints,
} from "./studio-vrm-ik-constraints";
import {
  clampStudioVrmJointRotation,
} from "./studio-vrm-joint-limits";
import {
  buildStudioVrmPersistentIkSignature,
} from "./studio-vrm-persistent-ik-signature";
import {
  createStudioVrmPhotoPoseApplyPlan,
} from "./studio-vrm-photo-pose-apply";
import {
  settleVrmPhysics,
  countSpringBoneJoints,
} from "./studio-vrm-physics";
import {
  createStudioVrmPoseApplyPlan,
} from "./studio-vrm-pose-apply";
import {
  STUDIO_VRM_DIRECT_EDIT_BONES,
  bakeStudioVrmRuntimePose,
} from "./studio-vrm-pose-bake";
import {
  clampStudioVrmJointDegrees,
  mirrorStudioVrmFingerRotations,
  mirrorStudioVrmPoseBones,
  straightenStudioVrmUpperBody,
  type StudioVrmPoseMirrorScope,
} from "./studio-vrm-pose-editing";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
  mirrorStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  BONE_CATEGORIES,
  type ExpressionAction,
} from "./studio-vrm-poser-catalogs";
import {
  extractStudioVrmFingerRotations,
  findPose,
  findPoseById,
} from "./studio-vrm-poser-helpers";
import type {
  StudioVrmFingerName,
} from "./studio-vrm-finger-curl";
import {
  createStudioVrmFingerCurlPose,
  createStudioVrmHandPose,
  type StudioVrmHandPoseType,
} from "./studio-vrm-hand-poses";
import {
  applyExpressionWeightsToVrm,
  d,
  getPoseBoneRotation,
  serializeFullVrmState,
  stripFingerBones,
  applyPoserVisualState,
  type PoseBoneMap,
  type FingerRotationMap,
} from "./studio-vrm-poser-utils";
import {
  findStudioVrmLightingQuickPreset,
} from "./studio-vrm-poser-ux";
import {
  applyVrmTwoBoneGrip,
} from "./studio-vrm-prop-ik";
import {
  createAutoGripFingerOverrides,
} from "./studio-vrm-prop-rig";
import {
  propDefById,
} from "./studio-vrm-props";
import type {
  StudioVrmIkConstraint,
} from "./studio-vrm-scene-document";
import {
  commitStudioVrmFullStateHistoryTransaction,
} from "./studio-vrm-state-history";
import {
  STUDIO_VRM_USER_IK_CHAINS,
} from "./studio-vrm-user-ik";
import {
  mergeWardrobeCostumeVisibility,
} from "./studio-vrm-wardrobe";
import type {
  StudioVrmPhotoPoseApplyPayload,
} from "./StudioVrmPhotoPoseScanner";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { CustomPose } from "./StudioVrmPoserTypes";
import type {
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

export function useStudioVrmPoserPoseEdit(h: StudioVrmPoserHost): void {
  const {
    dialogRef,
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
    setActiveCategory,
    jointLimitsEnabled,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    setLockedPoseBones,
    setSelectedViewportPoseBone,
    viewportHandIkEnabled,
    setIsViewportHandIkDragging,
    setActiveExpressionId,
    expressionWeights,
    setExpressionWeights,
    recentPreferencesRuntime,
    bodyRotation,
    setBodyRotation,
    jointHandleInteracting,
    setJointHandleStatus,
    setTurntable,
    fullStateHistoryRef,
    setCanUndo,
    setCanRedo,
    activeModelId,
    bodyScale,
    fingerEdits,
    setFingerEdits,
    setLighting,
    setLightingTone,
    savedPoses,
    preserveExpression,
    vrmPropItems,
    costumeState,
    costumeMeshes,
    wardrobeState,
    effectivePropRigMetrics,
    wardrobeAutoHide,
    physicsPreview,
    vrmRef,
    jointIkTransactionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    setPersistentIkReconciling,
    persistentIkCaptureIsReady,
    cancelJointIkTransaction,
    captureFullState,
    poseMaterialRuntimeDisabled,
    handleCustomPoseSelect,
  } = h;
  function handlePoseSelect(poseId: string) {
    const pose = findPose(poseId);
    const strippedBones = stripFingerBones(pose.bones);
    const poseFingers = extractStudioVrmFingerRotations(pose.bones);
    const nextYOffset = pose.yOffset ?? 0;
    const nextTranslations = cloneStudioVrmPoseTranslations(EMPTY_STUDIO_VRM_POSE_TRANSLATIONS);
    const before = captureFullState();
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: customBones,
      currentFingerEdits: fingerEdits,
      incomingBones: strippedBones,
      ...(Object.keys(poseFingers).length > 0 ? { incomingFingerEdits: poseFingers } : {}),
      lockedBones: lockedPoseBones,
      isBoneAvailable: (bone) => {
        const humanoid = vrmRef.current?.humanoid;
        if (!humanoid) return true;
        return Boolean(humanoid.getNormalizedBoneNode(bone));
      },
      clampRotation: jointLimitsEnabled
        ? (bone, axisIndex, radians) => d(clampStudioVrmJointDegrees(
            bone,
            axisIndex,
            THREE.MathUtils.radToDeg(radians),
          ))
        : undefined,
    });
    const after = serializeFullVrmState({
      ...before,
      poseId,
      bones: plan.bones,
      fingerOverrides: plan.fingerEdits,
      yOffset: nextYOffset,
      poseTranslations: nextTranslations,
      ...(preserveExpression
        ? {}
        : { expressionId: "neutral", expressionWeights: {} }),
    });
    const nextHistory = commitStudioVrmFullStateHistoryTransaction(
      fullStateHistoryRef.current,
      before,
      after,
      activeModelId,
    );
    fullStateHistoryRef.current = nextHistory;
    setCanUndo(nextHistory.index > 0);
    setCanRedo(nextHistory.index < nextHistory.entries.length - 1);

    setActivePoseId(poseId);
    setCustomBones(plan.bones);
    setFingerEdits(plan.fingerEdits);
    setCustomYOffset(nextYOffset);
    setPoseTranslations(nextTranslations);
    if (!preserveExpression) {
      setExpressionWeights({});
      setActiveExpressionId("neutral");
    }
    // `saveStudioVrmRecentPoses` remains only as an explicit legacy import/test seam in the pure
    // UX module. The product path records this selection through SQLite/OPFS.
    recentPreferencesRuntime.rememberPose(poseId);
    if (vrmRef.current) {
      applyPoserVisualState(vrmRef.current, {
        bones: plan.bones,
        yOffset: nextYOffset,
        poseTranslations: nextTranslations,
        fingerEdits: plan.fingerEdits,
        bodyScale,
      });
      applyExpressionWeightsToVrm(
        vrmRef.current,
        preserveExpression ? expressionWeights : {},
      );
    }
    const appliedCount = plan.appliedBodyBones.length + plan.appliedFingerBones.length;
    if (plan.skippedLocked.length > 0) {
      setJointHandleStatus(
        appliedCount > 0
          ? `잠긴 관절 ${plan.skippedLocked.length}개는 유지하고 포즈를 적용했어요.`
          : `잠긴 관절 ${plan.skippedLocked.length}개는 유지하고, 적용할 관절이 없어 높이만 반영했어요.`,
      );
    } else if (appliedCount === 0 && plan.skippedMissing.length + plan.skippedInvalid.length > 0) {
      setJointHandleStatus("적용할 수 있는 관절이 없어 높이만 반영했어요.");
    }
  }

  function handleResetActivePose(): void {
    if (activePoseId.startsWith("custom-")) {
      const savedPose = savedPoses.find((pose: CustomPose) => pose.id === activePoseId);
      if (savedPose) handleCustomPoseSelect(savedPose);
      return;
    }
    const preset = findPoseById(activePoseId);
    if (preset) handlePoseSelect(preset.id);
  }

  function rememberCharacterSelection(modelId: string) {
    recentPreferencesRuntime.rememberCharacter(modelId);
  }

  function handlePhotoPoseApply(payload: StudioVrmPhotoPoseApplyPayload) {
    const currentVrm = vrmRef.current;
    if (
      !currentVrm
      || poseMaterialRuntimeDisabled
      || pendingPersistentIkCommandRef.current
      || jointIkTransactionRef.current
      || !persistentIkCaptureIsReady()
    ) return false;

    const before = captureFullState();
    const plan = createStudioVrmPhotoPoseApplyPlan({
      currentBones: customBones,
      currentFingerEdits: fingerEdits,
      scannedBones: payload.bones,
      scannedFingerEdits: payload.fingerEdits,
      lockedBones: lockedPoseBones,
      isBoneAvailable: (bone) => Boolean(currentVrm.humanoid?.getNormalizedBoneNode(bone)),
      clampRotation: jointLimitsEnabled
        ? (bone, axisIndex, radians) => d(clampStudioVrmJointDegrees(
            bone,
            axisIndex,
            THREE.MathUtils.radToDeg(radians),
          ))
        : undefined,
    });
    if (plan.appliedBodyBones.length === 0 && plan.appliedFingerBones.length === 0) {
      setJointHandleStatus("사진에서 적용할 수 있는 잠금 해제 관절을 찾지 못했습니다.");
      return false;
    }

    const poseId = "photo-scan";
    const after = serializeFullVrmState({
      ...before,
      poseId,
      bones: plan.bones,
      fingerOverrides: plan.fingerEdits,
    });
    const candidateSignature = buildStudioVrmPersistentIkSignature({
      modelId: activeModelId,
      bones: plan.bones,
      fingerEdits: plan.fingerEdits,
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
    setCustomBones(plan.bones);
    setFingerEdits(plan.fingerEdits);
    const nextEffectiveFingers = resolveStudioVrmFingerAuthority(
      plan.fingerEdits,
      createAutoGripFingerOverrides(
        vrmPropItems,
        propDefById,
        effectivePropRigMetrics,
      ),
    );
    applyPoserVisualState(currentVrm, {
      bones: plan.bones,
      yOffset: customYOffset,
      poseTranslations,
      fingerEdits: nextEffectiveFingers,
      bodyScale,
    });
    setJointHandleStatus(
      `사진 포즈 관절 ${plan.appliedBodyBones.length}개${
        payload.detectedHandSides.length > 0
          ? ` · 손가락 ${plan.appliedFingerBones.length}개`
          : ""
      }를 적용했습니다.`,
    );
    return true;
  }

  function applyLightingQuickPreset(presetId: string) {
    const preset = findStudioVrmLightingQuickPreset(presetId);
    setLighting({
      intensity: preset.intensity,
      colorTemp: preset.colorTemp,
      directionDeg: preset.directionDeg,
    });
    if (preset.tone) setLightingTone(preset.tone);
  }

  // 포즈 좌우 반전 — 전체뿐 아니라 팔/다리만 교환해 포즈 믹서처럼 사용할 수 있다.
  // 회전은 lock-aware plan으로 잠긴 관절을 유지하고, 이동/IK 제약은 기존처럼 미러한다.
  function handleMirrorPose(scope: StudioVrmPoseMirrorScope = "all") {
    if (!vrm) return;
    const mirroredBones = mirrorStudioVrmPoseBones(customBones, scope);
    const mirroredFingers = mirrorStudioVrmFingerRotations(fingerEdits, scope);
    const mirroredTranslations = mirrorStudioVrmPoseTranslations(poseTranslations, scope);
    const mirroredConstraints = mirrorStudioVrmIkConstraints(ikConstraints, scope);
    const before = captureFullState();
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: customBones,
      currentFingerEdits: fingerEdits,
      incomingBones: mirroredBones,
      incomingFingerEdits: mirroredFingers,
      lockedBones: lockedPoseBones,
      isBoneAvailable: (bone) => {
        const humanoid = vrmRef.current?.humanoid;
        if (!humanoid) return true;
        return Boolean(humanoid.getNormalizedBoneNode(bone));
      },
      clampRotation: jointLimitsEnabled
        ? (bone, axisIndex, radians) => d(clampStudioVrmJointDegrees(
            bone,
            axisIndex,
            THREE.MathUtils.radToDeg(radians),
          ))
        : undefined,
    });
    const after = serializeFullVrmState({
      ...before,
      bones: plan.bones,
      fingerOverrides: plan.fingerEdits,
      poseTranslations: mirroredTranslations,
      ikConstraints: mirroredConstraints,
    });
    const nextHistory = commitStudioVrmFullStateHistoryTransaction(
      fullStateHistoryRef.current,
      before,
      after,
      activeModelId,
    );
    fullStateHistoryRef.current = nextHistory;
    setCanUndo(nextHistory.index > 0);
    setCanRedo(nextHistory.index < nextHistory.entries.length - 1);

    setCustomBones(plan.bones);
    setFingerEdits(plan.fingerEdits);
    setPoseTranslations(mirroredTranslations);
    setIkConstraints(mirroredConstraints);
    if (vrmRef.current) {
      applyPoserVisualState(vrmRef.current, {
        bones: plan.bones,
        yOffset: customYOffset,
        poseTranslations: mirroredTranslations,
        fingerEdits: plan.fingerEdits,
        bodyScale,
      });
    }
    if (plan.skippedLocked.length > 0) {
      setJointHandleStatus(
        `잠긴 관절 ${plan.skippedLocked.length}개는 유지하고 좌우 반전을 적용했어요.`,
      );
    }
  }

  function commitIkConstraintSettings(
    nextConstraints: readonly StudioVrmIkConstraint[],
    statusMessage: string,
  ) {
    cancelJointIkTransaction({ restoreBaseline: false });
    const before = captureFullState();
    const canonical = cloneStudioVrmIkConstraints(nextConstraints);
    const after = serializeFullVrmState({ ...before, ikConstraints: canonical });
    const candidateSignature = buildStudioVrmPersistentIkSignature({
      modelId: activeModelId,
      bones: before.bones,
      fingerEdits: before.fingerOverrides ?? {},
      yOffset: before.yOffset,
      translations: before.poseTranslations,
      bodyRotation: before.bodyRotation,
      bodyScale: before.bodyScale ?? bodyScale,
      proportions: parseAvatarForgeState(before.avatarForge).proportions,
      constraints: canonical,
      lockedPoseBones,
      jointProfile: rigJointProfile,
      fullBodyIk: fullBodyIkEnabled,
      footPlant: footPlantEnabled,
      floorHeight: rigFloorHeight,
    });
    if (
      canonical.some((constraint) => constraint.enabled && constraint.locked)
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
    setIkConstraints(canonical);
    setJointHandleStatus(statusMessage);
  }

  function handleStraightenUpperBody() {
    if (!vrm) return;
    const straightenedBones = straightenStudioVrmUpperBody(customBones);
    const before = captureFullState();
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: customBones,
      currentFingerEdits: fingerEdits,
      incomingBones: straightenedBones,
      lockedBones: lockedPoseBones,
      isBoneAvailable: (bone) => {
        const humanoid = vrmRef.current?.humanoid;
        if (!humanoid) return true;
        return Boolean(humanoid.getNormalizedBoneNode(bone));
      },
      clampRotation: jointLimitsEnabled
        ? (bone, axisIndex, radians) => d(clampStudioVrmJointDegrees(
            bone,
            axisIndex,
            THREE.MathUtils.radToDeg(radians),
          ))
        : undefined,
    });
    const after = serializeFullVrmState({
      ...before,
      bones: plan.bones,
      fingerOverrides: plan.fingerEdits,
    });
    const nextHistory = commitStudioVrmFullStateHistoryTransaction(
      fullStateHistoryRef.current,
      before,
      after,
      activeModelId,
    );
    fullStateHistoryRef.current = nextHistory;
    setCanUndo(nextHistory.index > 0);
    setCanRedo(nextHistory.index < nextHistory.entries.length - 1);

    setCustomBones(plan.bones);
    setFingerEdits(plan.fingerEdits);
    if (vrmRef.current) {
      applyPoserVisualState(vrmRef.current, {
        bones: plan.bones,
        yOffset: customYOffset,
        poseTranslations,
        fingerEdits: plan.fingerEdits,
        bodyScale,
      });
    }
    if (plan.skippedLocked.length > 0) {
      setJointHandleStatus(
        `잠긴 관절 ${plan.skippedLocked.length}개는 유지하고 상체를 곧게 펴 적용했어요.`,
      );
    }
  }

  function togglePoseBoneLock(boneName: VRMHumanBoneName) {
    if (jointHandleInteracting || jointIkTransactionRef.current) {
      cancelJointIkTransaction({ status: "진행 중인 IK 이동을 취소하고 관절 잠금을 변경했습니다." });
    }
    if (!lockedPoseBones.includes(boneName)) {
      const conflictsWithPin = ikConstraints.some((constraint: StudioVrmIkConstraint) => {
        if (!constraint.enabled || !constraint.locked) return false;
        const chain = STUDIO_VRM_USER_IK_CHAINS[constraint.effector];
        return [chain.upper, chain.lower, chain.end].includes(boneName);
      });
      if (conflictsWithPin) {
        setJointHandleStatus("이 관절은 유지 중인 손·발 고정점이 사용합니다. 먼저 고정점 유지를 해제해 주세요.");
        return;
      }
    }
    setLockedPoseBones((current: string[]) =>
      current.includes(boneName)
        ? current.filter((candidate: string) => candidate !== boneName)
        : [...current, boneName]
    );
  }

  function selectViewportPoseBone(boneName: VRMHumanBoneName) {
    setSelectedViewportPoseBone(boneName);
    const category = BONE_CATEGORIES.find((candidate) => candidate.bones.includes(boneName));
    if (category) setActiveCategory(category.id);
    requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector(`[data-vrm-pose-bone="${boneName}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleViewportHandIkDrag(
    boneName: VRMHumanBoneName,
    target: readonly [number, number, number],
    phase: "start" | "move" | "end",
  ) {
    const currentVrm = vrmRef.current;
    if (
      !currentVrm ||
      !viewportHandIkEnabled ||
      (boneName !== "leftHand" && boneName !== "rightHand") ||
      target.some((value) => !Number.isFinite(value) || Math.abs(value) > 100)
    ) {
      if (phase === "end") setIsViewportHandIkDragging(false);
      return;
    }
    const side = boneName === "leftHand" ? "left" : "right";
    const chain = [
      `${side}UpperArm`,
      `${side}LowerArm`,
      `${side}Hand`,
    ] as const satisfies readonly VRMHumanBoneName[];
    if (chain.some((chainBone) => lockedPoseBones.includes(chainBone))) {
      if (phase === "end") setIsViewportHandIkDragging(false);
      return;
    }
    if (phase === "start") {
      setIsViewportHandIkDragging(true);
      setTurntable(false);
    }
    const applied = applyVrmTwoBoneGrip(
      currentVrm,
      side,
      new THREE.Vector3(target[0], target[1], target[2]),
      1,
    );
    if (phase !== "end") return;
    setIsViewportHandIkDragging(false);
    if (!applied) return;

    const nextBones: PoseBoneMap = { ...customBones };
    for (const chainBone of chain) {
      const node = currentVrm.humanoid?.getNormalizedBoneNode(chainBone);
      if (!node) continue;
      const euler = new THREE.Euler().setFromQuaternion(node.quaternion, "XYZ");
      const rawDegrees = [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg);
      const rotation = rawDegrees.map((degrees, axisIndex) => (
        THREE.MathUtils.degToRad(
          jointLimitsEnabled
            ? clampStudioVrmJointDegrees(chainBone, axisIndex, degrees)
            : degrees,
        )
      )) as [number, number, number];
      nextBones[chainBone] = { rotation };
    }
    setCustomBones(nextBones);
    setActivePoseId("visual-hand-ik");
    applyPoserVisualState(currentVrm, {
      bones: nextBones,
      yOffset: customYOffset,
      poseTranslations,
      fingerEdits,
      bodyScale,
    });
  }

  function handleBoneRotationChange(boneName: string, axisIndex: number, degrees: number) {
    if (!vrm) return;
    const key = boneName as VRMHumanBoneName;
    if (lockedPoseBones.includes(key)) return;
    const safeDegrees = jointLimitsEnabled
      ? clampStudioVrmJointDegrees(key, axisIndex, degrees)
      : degrees;
    const radians = d(safeDegrees);
    const baked = bakeStudioVrmRuntimePose(vrm, STUDIO_VRM_DIRECT_EDIT_BONES);
    const bakedRotation = baked?.bones[key]?.rotation;
    setActivePoseId("manual-pose");
    if (POSER_FINGER_BONES.includes(key)) {
      // Single source of truth: fingers go to fingerEdits only
      setFingerEdits((prev: FingerRotationMap) => {
        const current = prev[key]
          ? [...prev[key]] as [number, number, number]
          : bakedRotation
            ? [...bakedRotation] as [number, number, number]
            : [0, 0, 0];
        current[axisIndex] = radians;
        return {
          ...prev,
          [key]: jointLimitsEnabled ? clampStudioVrmJointRotation(key, current) : current,
        };
      });
      return;
    }
    setCustomBones((prev: PoseBoneMap) => {
      const base = baked ? stripFingerBones(baked.bones) : prev;
      const current = bakedRotation
        ? [...bakedRotation] as [number, number, number]
        : [...getPoseBoneRotation(base[key])] as [number, number, number];
      current[axisIndex] = radians;
      return {
        ...base,
        [key]: {
          rotation: jointLimitsEnabled ? clampStudioVrmJointRotation(key, current) : current,
        },
      };
    });
  }

  function handleYOffsetChange(value: number) {
    setCustomYOffset(value);
  }

  /** Preserve authored state on the other hand, missing bones and locked joints. */
  function applyFingerPosePatch(patch: FingerRotationMap) {
    const humanoid = vrmRef.current?.humanoid;
    const applicable: FingerRotationMap = {};
    for (const [name, rotation] of Object.entries(patch)) {
      const bone = name as VRMHumanBoneName;
      if (!rotation || lockedPoseBones.includes(bone)) continue;
      if (humanoid && !humanoid.getNormalizedBoneNode(bone)) continue;
      applicable[bone] = jointLimitsEnabled
        ? clampStudioVrmJointRotation(bone, rotation)
        : rotation;
    }
    if (Object.keys(applicable).length === 0) return;
    setFingerEdits((prev: FingerRotationMap) => ({ ...prev, ...applicable }));
  }

  /** Coupled joint flexion; a selected finger never overwrites the other fingers. */
  function updateFingerCurl(side: 'left' | 'right', curlDeg: number, finger?: StudioVrmFingerName) {
    applyFingerPosePatch(createStudioVrmFingerCurlPose(side, curlDeg, finger));
  }

  function applyHandPosePreset(side: 'left' | 'right', poseType: StudioVrmHandPoseType) {
    applyFingerPosePatch(createStudioVrmHandPose(side, poseType));
  }

  function handleExpressionSelect(action: ExpressionAction) {
    setActiveExpressionId(action.id);
    const newWeights: Record<string, number> = {};
    if (action.name) {
      newWeights[action.name] = 1.0;
    }
    setExpressionWeights(newWeights);
    if (vrmRef.current) {
      applyExpressionWeightsToVrm(vrmRef.current, newWeights);
    }
  }

  // 표정 프리셋(조합) 원클릭 적용 — VRM 표준 blendshape 가중치 믹스를 한 번에 입힌다.
  // 모델에 없는 표정 이름은 applyExpressionWeightsToVrm이 건너뛴다.
  function handleExpressionPresetSelect(preset: StudioExpressionPreset) {
    const expressionId = `preset:${preset.id}`;
    const before = captureFullState();
    const plan = createStudioVrmExpressionApplyPlan({
      current: expressionWeights,
      incoming: preset.weights,
    });
    const nextWeights = { ...plan.weights };
    const after = serializeFullVrmState({
      ...before,
      expressionId,
      expressionWeights: nextWeights,
    });
    const nextHistory = commitStudioVrmFullStateHistoryTransaction(
      fullStateHistoryRef.current,
      before,
      after,
      activeModelId,
    );
    fullStateHistoryRef.current = nextHistory;
    setCanUndo(nextHistory.index > 0);
    setCanRedo(nextHistory.index < nextHistory.entries.length - 1);

    setActiveExpressionId(expressionId);
    setExpressionWeights(nextWeights);
    if (vrmRef.current) {
      applyExpressionWeightsToVrm(vrmRef.current, nextWeights);
    }
  }

  function updateExpressionWeight(name: string, value: number) {
    setExpressionWeights((prev: Record<string, number>) => {
      const next = { ...prev, [name]: value };
      if (value <= 0) {
        delete next[name];
      }

      if (vrmRef.current) {
        applyExpressionWeightsToVrm(vrmRef.current, next);
      }

      const activeKeys = Object.entries(next).filter(([_, val]) => val > 0);
      if (activeKeys.length === 0) {
        setActiveExpressionId("neutral");
      } else if (activeKeys.length === 1 && activeKeys[0][1] === 1.0) {
        setActiveExpressionId(activeKeys[0][0]);
      } else {
        setActiveExpressionId("custom");
      }

      return next;
    });
  }

  function handleBodyRotationChange(event: ChangeEvent<HTMLInputElement>) {
    setBodyRotation(d(Number(event.currentTarget.value)));
  }

  // 미리보기를 끄면 흔들림을 즉시 정착시켜 정지 프레임으로 되돌린다.
  useEffect(() => {
    if (physicsPreview) return;
    const current = vrmRef.current;
    if (current && countSpringBoneJoints(current) > 0) {
      settleVrmPhysics(current);
    }
  }, [physicsPreview]);

  /* ── 의상 토글/리컬러 핸들러 ─────────────────────────────────────── */
  useEffect(() => {
    applyStudioVrmCostumeState(
      costumeMeshes,
      mergeWardrobeCostumeVisibility(
        costumeState,
        wardrobeState,
        costumeMeshes,
        wardrobeAutoHide,
      ),
    );
  }, [costumeMeshes, costumeState, wardrobeAutoHide, wardrobeState]);

  const impl = h.__impl;
  if (impl) impl.rememberCharacterSelection = rememberCharacterSelection;
  Object.assign(h, {
    handlePoseSelect,
    handleResetActivePose,
    rememberCharacterSelection,
    handlePhotoPoseApply,
    applyLightingQuickPreset,
    handleMirrorPose,
    commitIkConstraintSettings,
    handleStraightenUpperBody,
    togglePoseBoneLock,
    selectViewportPoseBone,
    handleViewportHandIkDrag,
    handleBoneRotationChange,
    handleYOffsetChange,
    updateFingerCurl,
    applyHandPosePreset,
    handleExpressionSelect,
    handleExpressionPresetSelect,
    updateExpressionWeight,
    handleBodyRotationChange,
  });
}
