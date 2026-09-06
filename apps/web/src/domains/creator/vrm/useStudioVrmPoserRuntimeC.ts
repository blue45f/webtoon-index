/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  EXTRA_POSE_PRESETS,
  NATURAL_IDLE_POSES,
} from "../studio-pose-presets";

import {
  parseAvatarForgeState,
  serializeAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  resolveStudioVrmAvatarReferenceAppearanceState,
} from "./studio-vrm-avatar-reference-product";
import {
  cloneStudioVrmIkConstraints,
} from "./studio-vrm-ik-constraints";
import {
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import type {
  CharacterPanelSection,
  PanelTab,
} from "./studio-vrm-poser-catalogs";
import {
  findCameraPreset,
  getAvailableExpressionActions,
} from "./studio-vrm-poser-helpers";
import {
  hasVrmMToonMaterial,
  POSE_PRESETS,
  serializeFullVrmState,
  buildFullVrmStateFromSharedDataUrl,
  normalizeFullVrmModelId,
  type PoseBoneMap,
  type FingerRotationMap,
  type BodyScale,
  type LightingParams,
  type EnvVariant,
  type VrmMaterialFx,
} from "./studio-vrm-poser-utils";
import {
  filterStudioVrmPosesByBucket,
  filterStudioVrmPosesByQuery,
  type StudioVrmPoseListItem,
} from "./studio-vrm-poser-ux";
import {
  STUDIO_VRM_FINGER_BONES,
  STUDIO_VRM_HUMANOID_BONES,
  type StudioVrmCameraSettings,
  type StudioVrmIkConstraint,
  type StudioVrmPoseTranslations,
} from "./studio-vrm-scene-document";
import {
  commitStudioVrmFullStateHistoryTransaction,
} from "./studio-vrm-state-history";
import type {
  StudioVrmAvatarReferenceSelection,
} from "./StudioVrmAvatarReferenceRecommendationsPanel";
import type {
  LightingTone,
} from "./StudioVrmLighting";
import type {
  CaptureState,
  CustomPose,
} from "./StudioVrmPoserTypes";
import {
  createStudioVrmProportionPoseTransaction,
} from "./StudioVrmViewportUtils";
import {
  useStudioVrmWebcamSession,
} from "./use-studio-vrm-webcam-session";

import type { TrackingCalibration } from "./studio-vrm-tracking-calibration";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { VrmLibraryEntry } from "./vrm-library";
import type {
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

export interface PendingPoseData {
    poseId?: string;
    bones?: PoseBoneMap;
    yOffset?: number;
    poseTranslations?: StudioVrmPoseTranslations;
    ikConstraints?: readonly StudioVrmIkConstraint[];
    bodyRotation?: number;
    expressionId?: string;
    expressionWeights?: Record<string, number>;
    customColors?: Record<string, string>;
    materialFx?: VrmMaterialFx;
    modelId?: string;
    modelHash?: string;
    modelName?: string;
    vrmProps?: unknown;
    sceneProps?: unknown;
    costume?: unknown;
    wardrobe?: unknown;
    physics?: unknown;
    // new high-level state for restore on load
    bodyScale?: BodyScale;
    fingerOverrides?: FingerRotationMap;
    lighting?: LightingParams;
    lightingTone?: LightingTone;
    env?: EnvVariant;
    avatarForge?: unknown;
    camera?: StudioVrmCameraSettings;
    mannequin?: boolean;
  }

export function useStudioVrmPoserRuntimeC(h: StudioVrmPoserHost): void {
  const {
    open,
    initialDataUrl,
    initialScene,
    status,
    setError,
    modelName,
    vrm,
    customBones,
    setCustomBones,
    customYOffset,
    poseTranslations,
    ikConstraints,
    setRigJointProfile,
    setFullBodyIkEnabled,
    setFootPlantEnabled,
    setRigFloorHeight,
    expressionWeights,
    setExpressionWeights,
    activeCameraId,
    setActiveCameraId,
    activePanelTab,
    activeCharacterSection,
    avatarForgeReferenceSurfaceActive,
    avatarForgeReferenceCatalogue,
    poseQuery,
    poseBucket,
    recentPoseState,
    bodyRotation,
    setMannequinMode,
    jointHandleInteracting,
    setJointHandleStatus,
    broadcastPreviewActive,
    fullStateHistoryRef,
    setCanUndo,
    setCanRedo,
    isCapturing,
    isThumbnailCapturing,
    libraryEntries,
    activeModelId,
    setActiveModelId,
    bodyScale,
    setBodyScale,
    avatarForgeState,
    setAvatarForgeState,
    setAvatarForgeReferencePreview,
    avatarForgeReferenceAuthorityIdentity,
    proportionRigStatus,
    fingerEdits,
    lighting,
    setTransparentBackground,
    setInsertBackgroundColor,
    setSavedFullStates,
    customColors,
    materialFx,
    isSharingPose,
    lightingTone,
    savedPoses,
    setSavedPoses,
    creativeRepository,
    trackingCalibrationRepository,
    vrmCreativePersistenceStatus,
    setVrmCreativePersistenceStatus,
    setVrmCreativePersistenceMessage,
    vrmCreativeMountedRef,
    vrmCreativeMutationGenerationRef,
    vrmCreativeDirtyAuthoritiesRef,
    savedPosesRef,
    savedFullStatesRef,
    setWardrobeMetrics,
    setPropRigMetrics,
    webcamActive,
    setWebcamActive,
    setWebcamLoading,
    setWebcamError,
    setWebcamErrorStage,
    setFaceDetected,
    trackingOptions,
    setBrowserPermissionState,
    calibrating,
    setCalibrating,
    calibrationCountdown,
    setCalibrationCountdown,
    setCalibrationProgress,
    setCalibrated,
    setCalibrationPersistenceStatus,
    setCalibrationPersistenceMessage,
    setFaceLostLong,
    videoRef,
    streamRef,
    landmarkerRef,
    poseLandmarkerRef,
    handLandmarkerRef,
    channelSmootherRef,
    blinkStabilizerRef,
    qualityRef,
    calibrationRef,
    calibrationSamplerRef,
    calibrationPersistenceMountedRef,
    calibrationPersistenceGenerationRef,
    faceLostFramesRef,
    faceLostLongRef,
    lastChannelsRef,
    lastPoseBonesRef,
    lastFingersRef,
    frameIndexRef,
    webcamActiveRef,
    trackingDataRef,
    vrmRef,
    proportionRigRuntimeRef,
    proportionPoseReapplyRef,
    captureRef,
    pendingCameraRestoreRef,
    jointIkTransactionRef,
    persistentIkReconcileRevisionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    persistentIkReconciling,
    setPersistentIkReconciling,
    setCaptureSceneGeneration,
    cancelJointIkTransaction,
    captureFullState,
    resetFullStateHistory,
    effectiveFingerEdits,
  } = h;

  function avatarForgeReferenceInteractionBlocked(): boolean {
    return !avatarForgeReferenceSurfaceActive
      || !vrm
      || broadcastPreviewActive
      || isCapturing
      || isSharingPose
      || isThumbnailCapturing
      || persistentIkReconciling
      || proportionRigStatus === "applying"
      || proportionRigStatus === "reload-required";
  }

  function resolveAvatarForgeReferenceSelection(
    selection: StudioVrmAvatarReferenceSelection,
  ): AvatarForgeState | null {
    return resolveStudioVrmAvatarReferenceAppearanceState({
      current: avatarForgeState,
      selection,
      catalogue: avatarForgeReferenceCatalogue.catalogue,
    });
  }

  function handleAvatarForgeReferencePreview(
    selection: StudioVrmAvatarReferenceSelection,
  ): void {
    if (avatarForgeReferenceInteractionBlocked()) return;
    const nextState = resolveAvatarForgeReferenceSelection(selection);
    if (!nextState) {
      setAvatarForgeReferencePreview(null);
      setError("검증된 참고 이미지 추천 기준을 확인하지 못해 미리 보기를 시작하지 않았습니다.");
      return;
    }
    setAvatarForgeReferencePreview({
      modelId: activeModelId,
      authorityIdentity: avatarForgeReferenceAuthorityIdentity,
      catalogueRevision: selection.receipt.catalogueRevision,
      presetId: selection.presetId,
      state: nextState,
    });
    setError("");
  }

  function handleAvatarForgeReferenceApply(
    selection: StudioVrmAvatarReferenceSelection,
  ): void {
    if (avatarForgeReferenceInteractionBlocked()) return;
    const nextState = resolveAvatarForgeReferenceSelection(selection);
    if (!nextState) {
      setAvatarForgeReferencePreview(null);
      setError("추천 출처가 현재 프리셋 기준과 일치하지 않아 아바타를 변경하지 않았습니다.");
      return;
    }

    const before = captureFullState();
    const after = serializeFullVrmState({
      ...before,
      avatarForge: serializeAvatarForgeState(nextState),
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
    setAvatarForgeReferencePreview(null);
    setAvatarForgeState(nextState);
    setError("");
  }

  function handleAvatarForgeChange(rawState: AvatarForgeState) {
    if (
      broadcastPreviewActive
      || isCapturing
      || isSharingPose
      || isThumbnailCapturing
      || proportionRigStatus === "applying"
      || proportionRigStatus === "reload-required"
    ) return;
    setAvatarForgeReferencePreview(null);
    const nextState = parseAvatarForgeState(rawState);
    const proportionsChanged = JSON.stringify(nextState.proportions)
      !== JSON.stringify(avatarForgeState.proportions);
    if (!proportionsChanged) {
      setAvatarForgeState(nextState);
      return;
    }

    const currentVrm = vrmRef.current;
    const runtime = proportionRigRuntimeRef.current;
    if (!currentVrm || !runtime) {
      setAvatarForgeState({
        ...nextState,
        body: avatarForgeState.body,
        proportions: avatarForgeState.proportions,
        ...(avatarForgeState.legacyHipWidth === undefined
          ? { legacyHipWidth: undefined }
          : { legacyHipWidth: avatarForgeState.legacyHipWidth }),
      });
      setError("이 VRM은 안전한 관절 비율 편집을 지원하지 않습니다. 헤어와 얼굴 편집은 계속 사용할 수 있습니다.");
      return;
    }
    cancelJointIkTransaction({
      forceInvalidate: true,
      restoreBaseline: false,
      status: jointHandleInteracting || jointIkTransactionRef.current
        ? "체형이 바뀌어 진행 중인 IK 이동을 취소했습니다."
        : undefined,
    });
    pendingPersistentIkCommandRef.current = null;
    persistentIkReconcileRevisionRef.current += 1;
    persistentIkResolvedSignatureRef.current = "";
    setPersistentIkReconciling(true);
    const identityBodyScale: BodyScale = { height: 1, width: 1 };
    const transaction = createStudioVrmProportionPoseTransaction(currentVrm, {
      bones: customBones,
      yOffset: customYOffset,
      poseTranslations,
      fingerEdits: effectiveFingerEdits,
      bodyScale: identityBodyScale,
      bodyRotation,
      expressionWeights,
    });
    const outcome = h.applyProportionRigState(currentVrm, nextState.proportions, transaction);
    if (outcome === "committed") {
      setBodyScale(identityBodyScale);
      setAvatarForgeState(nextState);
      setPersistentIkReconciling(false);
      setJointHandleStatus("새 체형에 맞춰 관절·의상·소품 기준을 다시 계산했습니다.");
      setError("");
      return;
    }

    if (outcome === "recovered") {
      const recovery = createStudioVrmProportionPoseTransaction(currentVrm, {
        bones: customBones,
        yOffset: customYOffset,
        poseTranslations,
        fingerEdits: effectiveFingerEdits,
        bodyScale,
        bodyRotation,
        expressionWeights,
      });
      proportionPoseReapplyRef.current = recovery.reapply;
      recovery.reapply();
      const measurements = recovery.measurements();
      if (measurements.wardrobe) setWardrobeMetrics(measurements.wardrobe);
      if (measurements.props) setPropRigMetrics(measurements.props);
    }
    setPersistentIkReconciling(false);
    setError(
      outcome === "reload-required"
        ? "체형 리그를 안전하게 복구하지 못했습니다. 캐릭터를 다시 불러와 주세요."
        : "새 체형을 적용하지 못해 직전 체형을 유지했습니다.",
    );
  }

  const onCaptureUpdate = useCallback((state: CaptureState, cleanupGl?: import("three").WebGLRenderer | null) => {
    if (cleanupGl) {
      if (captureRef.current.gl === cleanupGl) {
        captureRef.current = { camera: null, gl: null, scene: null };
        setCaptureSceneGeneration((generation: number) => generation + 1);
      }
    } else {
      const previous = captureRef.current;
      captureRef.current = state;
      if (
        previous.camera !== state.camera
        || previous.gl !== state.gl
        || previous.scene !== state.scene
      ) {
        setCaptureSceneGeneration((generation: number) => generation + 1);
      }
    }
  }, []);
  const activeCamera = findCameraPreset(activeCameraId);
  // 포즈 검색 + 상황 버킷(최근/서기/액션/앉기/감정/손짓) — 상용 포즈 팔레트 탐색 속도용.
  const allPoseListItems: StudioVrmPoseListItem[] = [
    ...POSE_PRESETS.map((pose) => ({ id: pose.id, label: pose.label, tone: pose.tone })),
    ...NATURAL_IDLE_POSES.map((pose) => ({ id: pose.id, label: pose.label, tone: pose.tone })),
    ...EXTRA_POSE_PRESETS.map((pose) => ({ id: pose.id, label: pose.label, tone: pose.tone })),
    ...savedPoses.map((pose: CustomPose) => ({ id: pose.id, label: pose.label, tone: "사용자 저장" })),
  ];
  const bucketedPoseIds = new Set(
    filterStudioVrmPosesByBucket(allPoseListItems, poseBucket, recentPoseState.ids).map((item) => item.id)
  );
  const poseQ = poseQuery.trim().toLowerCase();
  const poseMatches = (p: { id: string; label: string; tone?: string }) => {
    if (poseBucket !== "all" && !bucketedPoseIds.has(p.id)) return false;
    if (!poseQ) return true;
    return filterStudioVrmPosesByQuery([p], poseQuery).length > 0;
  };
  const poseResultCount =
    POSE_PRESETS.filter(poseMatches).length +
    NATURAL_IDLE_POSES.filter(poseMatches).length +
    EXTRA_POSE_PRESETS.filter(poseMatches).length +
    savedPoses.filter(poseMatches).length;
  // 비활성 탭 섹션은 hidden 속성으로 숨겨 마운트는 유지(웹캠 video 등 ref 보존).
  // hidden 속성은 space-y 유틸의 :not([hidden]) 선택자에서 제외돼 간격도 자연 정리된다.
  const hideOnTab = (tab: PanelTab) => activePanelTab !== tab;
  const hideOnCharacterSection = (section: CharacterPanelSection) =>
    activePanelTab !== "character" || activeCharacterSection !== section;
  const libraryEntryById = new Map(libraryEntries.map((entry: VrmLibraryEntry) => [entry.id, entry] as const));
  const availableExpressionActions = getAvailableExpressionActions(vrm);
  const hasMToonMaterial = vrm ? hasVrmMToonMaterial(vrm) : false;
  const activeLibraryEntry = libraryEntryById.get(activeModelId) ?? null;
  const displayModelName = vrm ? modelName : "";

  const pendingPoseDataRef = useRef<PendingPoseData | null>(null);
  const initialSceneModelIdentity = initialScene
    ? initialScene.model.source === "bundled"
      ? `bundled:${initialScene.model.id}`
      : `attachment:${initialScene.model.hash}`
    : "";

  useEffect(() => {
    if (open && initialScene) {
      setRigJointProfile(initialScene.rig.jointProfile.id);
      setFullBodyIkEnabled(initialScene.rig.fullBodyIk);
      setFootPlantEnabled(initialScene.rig.footPlant);
      setRigFloorHeight(initialScene.rig.floorHeight);
      const poseBones: PoseBoneMap = {};
      for (const boneName of STUDIO_VRM_HUMANOID_BONES) {
        const bone = initialScene.pose.bones[boneName];
        if (!bone) continue;
        poseBones[boneName] = {
          rotation: [bone.rotation[0], bone.rotation[1], bone.rotation[2]],
        };
      }
      const fingerOverrides: FingerRotationMap = {};
      for (const boneName of STUDIO_VRM_FINGER_BONES) {
        const rotation = initialScene.pose.fingerOverrides[boneName];
        if (!rotation) continue;
        fingerOverrides[boneName] = [rotation[0], rotation[1], rotation[2]];
      }
      const poseData: PendingPoseData = {
        bones: poseBones,
        yOffset: initialScene.pose.yOffset,
        poseTranslations: cloneStudioVrmPoseTranslations(initialScene.pose.translations),
        ikConstraints: cloneStudioVrmIkConstraints(initialScene.pose.ikConstraints),
        bodyRotation: initialScene.pose.bodyRotationY,
        expressionWeights: { ...initialScene.expressions },
        customColors: { ...initialScene.appearance.customColors },
        materialFx: { ...initialScene.appearance.materialFx },
        modelId: initialScene.model.source === "bundled" ? initialScene.model.id : undefined,
        modelHash: initialScene.model.source === "attachment" ? initialScene.model.hash : undefined,
        modelName: initialScene.model.name,
        vrmProps: initialScene.props,
        sceneProps: initialScene.sceneProps,
        costume: initialScene.appearance.costume,
        wardrobe: initialScene.appearance.wardrobe,
        physics: initialScene.physics,
        bodyScale: { ...initialScene.appearance.bodyScale },
        fingerOverrides,
        lighting: { ...initialScene.lighting },
        lightingTone: initialScene.lightingTone,
        env: initialScene.env,
        avatarForge: initialScene.appearance.avatarForge,
        camera: initialScene.camera,
        mannequin: initialScene.appearance.mannequin,
      };
      pendingPoseDataRef.current = poseData;
      pendingCameraRestoreRef.current = initialScene.camera;
      setTransparentBackground(initialScene.render.transparentBackground);
      setInsertBackgroundColor(initialScene.render.backgroundColor);
      setMannequinMode(initialScene.appearance.mannequin);
      setActiveCameraId("custom");
      if (poseData.modelId) setActiveModelId(poseData.modelId);
    } else if (open && initialDataUrl) {
      try {
        const full = buildFullVrmStateFromSharedDataUrl(initialDataUrl);
        if (!full) throw new Error("Invalid VRM pose metadata");
        const poseData: PendingPoseData = {
          poseId: full.poseId,
          bones: full.bones,
          yOffset: full.yOffset,
          poseTranslations: full.poseTranslations,
          ikConstraints: full.ikConstraints,
          bodyRotation: full.bodyRotation,
          expressionId: full.expressionId,
          expressionWeights: full.expressionWeights,
          customColors: full.customColors,
          materialFx: full.materialFx,
          modelId: full.modelId,
          vrmProps: full.props,
          sceneProps: full.sceneProps,
          costume: full.costume,
          wardrobe: full.wardrobe,
          physics: full.physics,
          bodyScale: full.bodyScale,
          fingerOverrides: full.fingerOverrides,
          lighting: full.lighting,
          lightingTone: full.lightingTone,
          env: full.env,
          avatarForge: full.avatarForge,
        };
        const pendingModelId = normalizeFullVrmModelId(poseData.modelId);
        pendingPoseDataRef.current = { ...poseData, modelId: pendingModelId };
        if (pendingModelId) setActiveModelId(pendingModelId);
      } catch (e) {
        console.error("Failed to parse initial data URL", e);
      }
    } else if (!open) {
      pendingPoseDataRef.current = null;
      pendingCameraRestoreRef.current = null;
      resetFullStateHistory();
    }
  }, [open, initialDataUrl, initialScene, resetFullStateHistory]);

  useEffect(() => {
    vrmCreativeMountedRef.current = true;
    const hydrationGeneration = vrmCreativeMutationGenerationRef.current;
    void Promise.all([
      creativeRepository.loadCustomPoses(),
      creativeRepository.loadFullStates(),
    ]).then(([poses, fullStates]) => {
      if (
        !vrmCreativeMountedRef.current
        || vrmCreativeMutationGenerationRef.current !== hydrationGeneration
      ) return;
      savedPosesRef.current = poses;
      savedFullStatesRef.current = fullStates;
      vrmCreativeDirtyAuthoritiesRef.current.clear();
      setSavedPoses(poses);
      setSavedFullStates(fullStates);
      setVrmCreativePersistenceStatus("sqlite");
      setVrmCreativePersistenceMessage("");
    }).catch((caughtError: unknown) => {
      if (
        !vrmCreativeMountedRef.current
        || vrmCreativeMutationGenerationRef.current !== hydrationGeneration
      ) return;
      setVrmCreativePersistenceStatus("read-error");
      setVrmCreativePersistenceMessage(
        `SQLite/OPFS 포즈 데이터를 검증해 불러오지 못했습니다. 기존 원문 보호를 위해 저장을 막았습니다: ${
          caughtError instanceof Error ? caughtError.message : String(caughtError)
        }`,
      );
    });

    return () => {
      vrmCreativeMountedRef.current = false;
      vrmCreativeMutationGenerationRef.current += 1;
    };
  }, [creativeRepository]);

  useEffect(() => {
    calibrationPersistenceMountedRef.current = true;
    const generation = ++calibrationPersistenceGenerationRef.current;
    setCalibrationPersistenceStatus("loading");
    setCalibrationPersistenceMessage("");
    void trackingCalibrationRepository.load().then((storedCalibration: TrackingCalibration | null) => {
      if (
        !calibrationPersistenceMountedRef.current
        || calibrationPersistenceGenerationRef.current !== generation
      ) return;
      calibrationRef.current = storedCalibration;
      setCalibrated(storedCalibration !== null);
      setCalibrationPersistenceStatus("sqlite");
    }).catch((caughtError: unknown) => {
      if (
        !calibrationPersistenceMountedRef.current
        || calibrationPersistenceGenerationRef.current !== generation
      ) return;
      setCalibrationPersistenceStatus("read-error");
      setCalibrationPersistenceMessage(
        `SQLite/OPFS 캘리브레이션을 검증해 불러오지 못했습니다: ${
          caughtError instanceof Error ? caughtError.message : String(caughtError)
        }`,
      );
    });
    return () => {
      calibrationPersistenceMountedRef.current = false;
      calibrationPersistenceGenerationRef.current += 1;
    };
  }, [trackingCalibrationRepository]);

  // Check camera permission state on mount or when webcam status changes
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions || !navigator.permissions.query) {
      setBrowserPermissionState("unsupported");
      return;
    }

    let active = true;
    const checkPermission = async () => {
      try {
        const res = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (active) {
          setBrowserPermissionState(res.state);
        }
        res.onchange = () => {
          if (active) {
            setBrowserPermissionState(res.state);
          }
        };
      } catch (e) {
        console.warn("Permissions API not supported for camera:", e);
        if (active) {
          setBrowserPermissionState("unsupported");
        }
      }
    };

    checkPermission();
    return () => {
      active = false;
    };
  }, [webcamActive]);

  // 정면 캘리브레이션 시작 — 3초 카운트다운 후 샘플러 가동(완료는 트래킹 루프가 감지).
  const handleStartCalibration = () => {
    calibrationSamplerRef.current = null;
    setCalibrationProgress(0);
    setCalibrationCountdown(3);
    setCalibrating(true);
  };

  const handleClearCalibration = () => {
    calibrationRef.current = null;
    setCalibrated(false);
    const generation = ++calibrationPersistenceGenerationRef.current;
    setCalibrationPersistenceStatus("saving");
    setCalibrationPersistenceMessage("");
    void trackingCalibrationRepository.clear().then(() => {
      if (
        !calibrationPersistenceMountedRef.current
        || calibrationPersistenceGenerationRef.current !== generation
      ) return;
      setCalibrationPersistenceStatus("sqlite");
    }).catch((caughtError: unknown) => {
      if (
        !calibrationPersistenceMountedRef.current
        || calibrationPersistenceGenerationRef.current !== generation
      ) return;
      setCalibrationPersistenceStatus("read-error");
      setCalibrationPersistenceMessage(
        `SQLite/OPFS 캘리브레이션 삭제에 실패했습니다. 새로고침하면 이전 값이 복원될 수 있습니다: ${
          caughtError instanceof Error ? caughtError.message : String(caughtError)
        }`,
      );
    });
  };

  const handleCapturePose = () => {
    if (!trackingDataRef.current) return;
    const data = trackingDataRef.current;

    setCustomBones((prev: PoseBoneMap) => {
      const next = { ...prev };
      Object.entries(data.bones as Record<string, [number, number, number]>).forEach(([boneName, rot]) => {
        next[boneName as VRMHumanBoneName] = {
          rotation: [rot[0], rot[1], rot[2]] as const,
        };
      });
      return next;
    });

    setExpressionWeights((prev: Record<string, number>) => {
      const next = { ...prev };
      Object.entries(data.expressions).forEach(([name, val]) => {
        next[name] = val as number;
      });
      return next;
    });

    setWebcamActive(false);
  };

  // 웹캠 트래킹 세션(getUserMedia + MediaPipe rVFC 루프 + 캘리브레이션) —
  // use-studio-vrm-webcam-session 이 소유한다. 동작은 동일하고 상태는 여기 남는다.
  useStudioVrmWebcamSession({
    blinkStabilizerRef,
    calibrating,
    calibrationCountdown,
    calibrationPersistenceGenerationRef,
    calibrationPersistenceMountedRef,
    calibrationRef,
    calibrationSamplerRef,
    channelSmootherRef,
    faceLostFramesRef,
    faceLostLongRef,
    frameIndexRef,
    handLandmarkerRef,
    landmarkerRef,
    lastChannelsRef,
    lastFingersRef,
    lastPoseBonesRef,
    poseLandmarkerRef,
    qualityRef,
    setBrowserPermissionState,
    setCalibrated,
    setCalibrating,
    setCalibrationCountdown,
    setCalibrationPersistenceMessage,
    setCalibrationPersistenceStatus,
    setCalibrationProgress,
    setFaceDetected,
    setFaceLostLong,
    setWebcamActive,
    setWebcamError,
    setWebcamErrorStage,
    setWebcamLoading,
    streamRef,
    trackingCalibrationRepository,
    trackingDataRef,
    trackingOptions,
    videoRef,
    webcamActive,
    webcamActiveRef,
  });

  const vrmCreativeReadOnly = vrmCreativePersistenceStatus === "hydrating"
    || vrmCreativePersistenceStatus === "read-error";


  Object.assign(h, {
    avatarForgeReferenceInteractionBlocked,
    resolveAvatarForgeReferenceSelection,
    handleAvatarForgeReferencePreview,
    handleAvatarForgeReferenceApply,
    handleAvatarForgeChange,
    onCaptureUpdate,
    activeCamera,
    allPoseListItems,
    bucketedPoseIds,
    poseQ,
    poseMatches,
    poseResultCount,
    hideOnTab,
    hideOnCharacterSection,
    libraryEntryById,
    availableExpressionActions,
    hasMToonMaterial,
    activeLibraryEntry,
    displayModelName,
    pendingPoseDataRef,
    initialSceneModelIdentity,
    handleStartCalibration,
    handleClearCalibration,
    handleCapturePose,
    vrmCreativeReadOnly,
  });
}
