/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  pickNaturalIdlePose,
} from "../studio-pose-presets";

import {
  disposeStudioVrmAsset as disposeVrm,
} from "./studio-vrm-asset-runtime";
import {
  createAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import type {
  CostumeState,
} from "./studio-vrm-costume";
import {
  applyStudioVrmCostumeState,
  collectStudioVrmCostumeMeshes,
} from "./studio-vrm-costume-runtime";
import {
  DEFAULT_VRM_PHYSICS,
  applyVrmSpringBonePhysics,
  settleVrmPhysics,
  countSpringBoneJoints,
} from "./studio-vrm-physics";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  extractStudioVrmFingerRotations,
} from "./studio-vrm-poser-helpers";
import {
  applyVrmCustomColors,
  applyVrmMaterialFx,
  repairVrmTexturedNearBlackLitFactors,
  serializeFullVrmState,
  stripFingerBones,
  DEFAULT_VRM_MATERIAL_FX,
  type BodyScale,
} from "./studio-vrm-poser-utils";
import {
  DEFAULT_VRM_PROP_RIG_METRICS,
} from "./studio-vrm-prop-rig";
import {
  createStudioVrmProportionRigRuntime,
} from "./studio-vrm-proportion-rig-runtime";
import {
  createStudioVrmProportionVrmAdapter,
  measureStudioVrmProportionHeadLength,
} from "./studio-vrm-proportion-vrm-adapter";
import type {
  StudioVrmCameraSettings,
} from "./studio-vrm-scene-document";
import {
  DEFAULT_VRM_CUSTOM_COLORS,
} from "./StudioVrmPoserTypes";
import {
  applyRotationToVrm,
  createStudioVrmProportionPoseTransaction,
  studioVrmProportionValuesRequireRuntime,
} from "./StudioVrmViewportUtils";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type {
  VRM,
} from "@pixiv/three-vrm";

export function useStudioVrmPoserInstall(h: StudioVrmPoserHost): void {
  const {
    setStatus,
    setError,
    setModelName,
    vrm,
    setVrm,
    setActivePoseId,
    setCustomBones,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    ikConstraints,
    setIkConstraints,
    setIsViewportHandIkDragging,
    setActiveExpressionId,
    expressionWeights,
    setExpressionWeights,
    bodyRotation,
    setBodyRotation,
    setMannequinMode,
    setJointHandleInteracting,
    setJointHandleSessionGeneration,
    viewportApiRef,
    setActiveModelId,
    setInstalledModelId,
    modelLoadTargetIdRef,
    bodyScale,
    setBodyScale,
    setAvatarForgeState,
    avatarForgeFaceController,
    setProportionRigStatus,
    setProportionRigMessage,
    setProportionRigReceipt,
    setProportionRigRevision,
    setProportionHeadMeasurement,
    fingerEdits,
    setFingerEdits,
    lighting,
    customColors,
    setCustomColors,
    materialFx,
    setMaterialFx,
    lightingTone,
    setLightingTone,
    setVrmPropItems,
    setSelectedVrmPropUid,
    setCostumeState,
    setCostumeMeshes,
    setSelectedCostumeKey,
    setWardrobeState,
    setWardrobeMetrics,
    setWardrobeSurfaceReceipts,
    setPropRigMetrics,
    setWardrobeAutoHide,
    setVrmPhysics,
    setPhysicsPreview,
    setSpringJointCount,
    vrmRef,
    vrmInstallGenerationRef,
    proportionRigRuntimeRef,
    proportionRigReceiptRef,
    proportionHeadMeasurementRef,
    proportionPoseReapplyRef,
    wardrobeXpbdCaptureSyncRef,
    pendingCameraRestoreRef,
    pendingCameraRestoreFrameRef,
    jointIkTransactionRef,
    jointIkRevisionRef,
    persistentIkReconcileRevisionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    setPersistentIkReconciling,
    setCaptureSceneGeneration,
    resetFullStateHistory,
    pendingPoseDataRef,
    commitFullStateRestore,
  } = h;
  function initializeProportionRigRuntime(nextVrm: VRM) {
    const measurement = measureStudioVrmProportionHeadLength(nextVrm);
    proportionHeadMeasurementRef.current = measurement;
    setProportionHeadMeasurement(measurement);
    proportionRigReceiptRef.current = null;
    setProportionRigReceipt(null);
    if (!measurement) {
      proportionRigRuntimeRef.current = null;
      setProportionRigStatus("unavailable");
      setProportionRigMessage("머리와 신체의 기준 길이를 안전하게 계산하지 못했습니다.");
      return null;
    }

    const generation = vrmInstallGenerationRef.current;
    const created = createStudioVrmProportionRigRuntime(
      createStudioVrmProportionVrmAdapter({
        vrm: nextVrm,
        getCurrentModelGeneration: () => vrmInstallGenerationRef.current,
        reapplyAuthoredPose: () => proportionPoseReapplyRef.current?.() ?? false,
      }),
      {
        headLength: measurement.value,
        headMeasurement: {
          version: measurement.version,
          source: measurement.source,
          reliable: measurement.reliable,
        },
      },
    );
    if (!created.ok || generation !== vrmInstallGenerationRef.current) {
      proportionRigRuntimeRef.current = null;
      setProportionRigStatus("unavailable");
      setProportionRigMessage(
        created.ok
          ? "캐릭터가 교체되어 체형 리그 준비를 취소했습니다."
          : created.message,
      );
      return null;
    }
    proportionRigRuntimeRef.current = created.runtime;
    setProportionRigStatus("applying");
    setProportionRigMessage("");
    return created.runtime;
  }

  function applyProportionRigState(
    nextVrm: VRM,
    proportions: AvatarForgeState["proportions"],
    transaction: ReturnType<typeof createStudioVrmProportionPoseTransaction>,
  ) {
    const runtime = proportionRigRuntimeRef.current;
    if (!runtime) {
      // A neutral document can still use the ordinary pose renderer when this model cannot expose
      // a safe editable rig. A non-neutral document must remain untouched: replaying only its pose
      // here would present a different silhouette as though the restore had succeeded.
      if (!studioVrmProportionValuesRequireRuntime(proportions)) {
        transaction.reapply();
        const measurements = transaction.measurements();
        setWardrobeMetrics(measurements.wardrobe);
        setPropRigMetrics(measurements.props ?? DEFAULT_VRM_PROP_RIG_METRICS);
        setWardrobeSurfaceReceipts({});
      }
      return "unavailable" as const;
    }
    proportionPoseReapplyRef.current = transaction.reapply;
    avatarForgeFaceController.release();
    setProportionRigStatus("applying");
    const result = runtime.apply(proportions);
    if (!result.ok) {
      const reloadRequired = result.recovery === "reload-required";
      if (!reloadRequired) {
        // The face lease was released before every runtime attempt. Even a pre-mutation
        // `not-needed` rejection must publish a new rig/view generation so Avatar Forge rebinds
        // the previous face scale and persistent IK gets another reconciliation pass.
        setProportionRigRevision((revision: number) => revision + 1);
        setJointHandleSessionGeneration((generation: number) => generation + 1);
        setCaptureSceneGeneration((generation: number) => generation + 1);
      }
      setProportionRigStatus(reloadRequired ? "reload-required" : "ready");
      setProportionRigMessage(
        reloadRequired
          ? "리그를 안전한 상태로 되돌리지 못했습니다. 캐릭터를 다시 불러와 주세요."
          : "새 체형을 적용하지 못해 직전의 안전한 체형으로 되돌렸습니다.",
      );
      return reloadRequired ? "reload-required" as const : "recovered" as const;
    }
    if (vrmRef.current && vrmRef.current !== nextVrm) return "stale" as const;
    const measurements = transaction.measurements();
    if (!measurements.wardrobe || !measurements.props) {
      setProportionRigStatus("reload-required");
      setProportionRigMessage("새 리그의 의상·소품 맞춤 치수를 확인하지 못했습니다. 캐릭터를 다시 불러와 주세요.");
      return "reload-required" as const;
    }
    proportionRigReceiptRef.current = result;
    setProportionRigReceipt(result);
    setWardrobeMetrics(measurements.wardrobe);
    setPropRigMetrics(measurements.props);
    setWardrobeSurfaceReceipts({});
    setProportionRigRevision((revision: number) => revision + 1);
    setJointHandleSessionGeneration((generation: number) => generation + 1);
    setCaptureSceneGeneration((generation: number) => generation + 1);
    setProportionRigStatus("ready");
    setProportionRigMessage("");
    return "committed" as const;
  }

  function clearCurrentVrm() {
    if (pendingCameraRestoreFrameRef.current !== null) {
      cancelAnimationFrame(pendingCameraRestoreFrameRef.current);
      pendingCameraRestoreFrameRef.current = null;
    }
    setIsViewportHandIkDragging(false);
    jointIkRevisionRef.current += 1;
    jointIkTransactionRef.current = null;
    persistentIkReconcileRevisionRef.current += 1;
    persistentIkResolvedSignatureRef.current = "";
    pendingPersistentIkCommandRef.current = null;
    setPersistentIkReconciling(false);
    setIkConstraints([]);
    setJointHandleInteracting(false);
    setJointHandleSessionGeneration((generation: number) => generation + 1);
    avatarForgeFaceController.release();
    const proportionRuntime = proportionRigRuntimeRef.current;
    if (proportionRuntime && !proportionRuntime.disposed) proportionRuntime.dispose();
    proportionRigRuntimeRef.current = null;
    proportionRigReceiptRef.current = null;
    proportionHeadMeasurementRef.current = null;
    proportionPoseReapplyRef.current = null;
    vrmInstallGenerationRef.current += 1;
    setProportionRigStatus("empty");
    setProportionRigMessage("");
    setProportionRigReceipt(null);
    setProportionHeadMeasurement(null);
    setWardrobeMetrics(null);
    setPropRigMetrics(DEFAULT_VRM_PROP_RIG_METRICS);
    setWardrobeSurfaceReceipts({});
    wardrobeXpbdCaptureSyncRef.current.clear();
    if (vrmRef.current) {
      disposeVrm(vrmRef.current);
      vrmRef.current = null;
    }
    modelLoadTargetIdRef.current = null;
    setInstalledModelId(null);
    setVrm(null);
  }

  function installVrm(nextVrm: VRM, nextModelName: string, nextModelId: string) {
    let cameraToRestore: StudioVrmCameraSettings | null = null;
    try {
      resetFullStateHistory();
      clearCurrentVrm();
      initializeProportionRigRuntime(nextVrm);
      const pending = pendingPoseDataRef.current;
      vrmRef.current = nextVrm;
      setVrm(nextVrm);
      setModelName(nextModelName);
      setActiveModelId(nextModelId);
      setInstalledModelId(nextModelId);
      modelLoadTargetIdRef.current = nextModelId;
      if (pending) {

        const bones = pending.bones || {};
        const yOffset = typeof pending.yOffset === "number" ? pending.yOffset : 0;
        const expressionWeights = pending.expressionWeights || {};

        const pendingFull = serializeFullVrmState({
          modelId: nextModelId,
          poseId: pending.poseId,
          bones: bones,
          yOffset,
          poseTranslations: pending.poseTranslations,
          ikConstraints: pending.ikConstraints,
          bodyRotation: pending.bodyRotation,
          expressionId: pending.expressionId,
          expressionWeights,
          bodyScale: pending.bodyScale,
          fingerOverrides: pending.fingerOverrides,
          lighting: pending.lighting,
          lightingTone: pending.lightingTone,
          env: pending.env,
          costume: pending.costume,
          wardrobe: pending.wardrobe,
          props: pending.vrmProps,
          sceneProps: pending.sceneProps,
          physics: pending.physics,
          materialFx: pending.materialFx,
          avatarForge: pending.avatarForge,
          customColors: pending.customColors,
        });
        const restored = commitFullStateRestore(pendingFull, nextVrm, {
          installingModel: true,
        });
        if (!restored) {
          clearCurrentVrm();
          setStatus("error");
          return false;
        }
        setMannequinMode(pending.mannequin ?? false);
        cameraToRestore = pending.camera ?? pendingCameraRestoreRef.current;
      } else {
        // 스폰 기본 포즈: T-포즈 대신 캐릭터 id로 결정되는 자연 아이들 포즈를 적용한다.
        const spawnPose = pickNaturalIdlePose(nextModelId);
        const strippedSpawn = stripFingerBones(spawnPose.bones);
        const spawnFingers = extractStudioVrmFingerRotations(spawnPose.bones);
        setActivePoseId(spawnPose.id);
        setCustomBones(strippedSpawn);
        setFingerEdits(spawnFingers);
        setCustomYOffset(spawnPose.yOffset ?? 0);
        setPoseTranslations(cloneStudioVrmPoseTranslations(EMPTY_STUDIO_VRM_POSE_TRANSLATIONS));
        setActiveExpressionId("neutral");
        setExpressionWeights({});
        setBodyRotation(0);
        applyRotationToVrm(nextVrm, 0);
        const freshBodyScale: BodyScale = { height: 1, width: 1 };
        setBodyScale(freshBodyScale);
        setMannequinMode(false);
        setCustomColors({ ...DEFAULT_VRM_CUSTOM_COLORS });
        setMaterialFx(DEFAULT_VRM_MATERIAL_FX);
        setLightingTone("morning");
        const freshAvatarForge = createAvatarForgeState();
        setAvatarForgeState(freshAvatarForge);
        const proportionTransaction = createStudioVrmProportionPoseTransaction(nextVrm, {
          bones: strippedSpawn,
          yOffset: spawnPose.yOffset ?? 0,
          poseTranslations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
          fingerEdits: spawnFingers,
          bodyScale: freshBodyScale,
          bodyRotation: 0,
          expressionWeights: {},
        });
        const freshProportionOutcome = applyProportionRigState(
          nextVrm,
          freshAvatarForge.proportions,
          proportionTransaction,
        );
        if (
          freshProportionOutcome !== "committed"
          && freshProportionOutcome !== "unavailable"
        ) {
          clearCurrentVrm();
          setError(
            freshProportionOutcome === "reload-required"
              ? "새 캐릭터의 체형 리그를 안전하게 초기화하지 못했습니다. 모델을 다시 불러와 주세요."
              : "새 캐릭터의 관절·의상 기준을 확인하지 못해 불러오기를 중단했습니다.",
          );
          setStatus("error");
          return false;
        }
        applyVrmCustomColors(nextVrm, DEFAULT_VRM_CUSTOM_COLORS);
        applyVrmMaterialFx(nextVrm, DEFAULT_VRM_MATERIAL_FX);
        // Heal any load-race near-black lit×map collapses before the first ready frame.
        repairVrmTexturedNearBlackLitFactors(nextVrm);
        // 본 부착 소품·워드로브 초기화.
        setVrmPropItems([]);
        setSelectedVrmPropUid(null);
        setWardrobeState({});
        setWardrobeAutoHide(true);
        // 의상 메시 수집 + 상태 초기화 (머티리얼 clone 없이 목록만 — 원본 알베도 유지).
        const meshes = collectStudioVrmCostumeMeshes(nextVrm);
        setCostumeMeshes(meshes);
        const freshCostume: CostumeState = { hidden: [], recolor: {} };
        setCostumeState(freshCostume);
        setSelectedCostumeKey(null);
        applyStudioVrmCostumeState(meshes, freshCostume);
        // 물리 초기화 + 정착(머리카락/치마 자연 정착).
        setVrmPhysics(DEFAULT_VRM_PHYSICS);
        setPhysicsPreview(false);
        const joints = countSpringBoneJoints(nextVrm);
        setSpringJointCount(joints);
        if (joints > 0) {
          applyVrmSpringBonePhysics(nextVrm, DEFAULT_VRM_PHYSICS);
          settleVrmPhysics(nextVrm);
        }
      }
      // Final safety pass after any pending full-state restore path as well.
      repairVrmTexturedNearBlackLitFactors(nextVrm);
      if (pending) pendingPoseDataRef.current = null;
      pendingCameraRestoreRef.current = null;
      if (cameraToRestore) {
        const committedCamera = cameraToRestore;
        const committedVrmGeneration = vrmInstallGenerationRef.current;
        const frame = requestAnimationFrame(() => {
          if (pendingCameraRestoreFrameRef.current !== frame) return;
          pendingCameraRestoreFrameRef.current = null;
          if (
            vrmRef.current !== nextVrm
            || vrmInstallGenerationRef.current !== committedVrmGeneration
          ) return;
          viewportApiRef.current?.restoreCamera(committedCamera);
        });
        pendingCameraRestoreFrameRef.current = frame;
      }
      setStatus("ready");
      return true;
    } catch (installError: unknown) {
      const wasPublished = vrmRef.current === nextVrm;
      clearCurrentVrm();
      if (!wasPublished) disposeVrm(nextVrm);
      throw installError;
    }
  }


  const impl = h.__impl;
  if (impl) impl.applyProportionRigState = applyProportionRigState;
  if (impl) impl.clearCurrentVrm = clearCurrentVrm;
  if (impl) impl.installVrm = installVrm;
  Object.assign(h, {
    initializeProportionRigRuntime,
    applyProportionRigState,
    clearCurrentVrm,
    installVrm,
  });
}
