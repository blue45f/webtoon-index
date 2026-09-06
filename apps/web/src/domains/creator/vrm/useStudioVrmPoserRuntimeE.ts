/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useEffect,
} from "react";

import {
  planStudio3dInsertCaptureSize,
} from "../scene-3d/studio-3d-insert-capture-plan";

import {
  createStudioVrmAuthoredFingerSnapshot,
} from "./studio-vrm-auto-grip-authority";
import {
  serializeAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  serializeCostume,
  type CostumeState,
  type CostumeSlot,
} from "./studio-vrm-costume";
import {
  applyStudioVrmCostumeState,
} from "./studio-vrm-costume-runtime";
import {
  resolveStudioVrmInsertBackgroundMode,
} from "./studio-vrm-insert-background-mode";
import {
  parseVrmPhysicsSettings,
  DEFAULT_VRM_PHYSICS,
  applyVrmSpringBonePhysics,
  settleVrmPhysics,
  countSpringBoneJoints,
  type VrmPhysicsSettings,
} from "./studio-vrm-physics";
import {
  STUDIO_VRM_DIRECT_EDIT_BONES,
  bakeStudioVrmRuntimePose,
} from "./studio-vrm-pose-bake";
import {
  getErrorMessage,
  roundExportSize,
} from "./studio-vrm-poser-helpers";
import {
  stripFingerBones,
  buildVrmPoseDataUrlMetadata,
} from "./studio-vrm-poser-utils";
import { isStudioVrmPropSelectable } from "./studio-vrm-prop-quality-policy";
import {
  createPropInstance,
  serializeVrmProps,
  type PropInstance,
} from "./studio-vrm-props";
import {
  captureStudioVrmRgba,
  encodeStudioVrmCapturePngDataUrl,
} from "./studio-vrm-raster-capture";
import {
  createStudioVrmRigProfileSelection,
} from "./studio-vrm-rig-profile";
import {
  STUDIO_VRM_HUMANOID_BONES,
  STUDIO_VRM_MODEL_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_VERSION,
  normalizeStudioVrmSceneDocument,
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
  type StudioVrmPoseBoneMap,
  type StudioVrmSceneDocument,
  type StudioVrmSceneModel,
  type StudioVrmSurfacePaintSettings,
  type StudioVrmIkConstraint,
} from "./studio-vrm-scene-document";
import {
  serializeSceneProps,
} from "./studio-vrm-scene-props";
import {
  WARDROBE_SLOTS,
  WARDROBE_SLOT_LABELS,
  wardrobeItemById,
  selectableWardrobeSetById,
  applyWardrobeItemSelection,
  applyWardrobeSet,
  mergeWardrobeCostumeVisibility,
  serializeWardrobe,
  type WardrobeEquip,
  type WardrobeSlot,
  type WardrobeState,
} from "./studio-vrm-wardrobe";
import {
  STUDIO_VRM_CAPTURE_PNG_TIMEOUT_MS,
} from "./StudioVrmPoserTypes";
import {
  studioVrmProportionsRequireRuntime,
} from "./StudioVrmViewportUtils";
import type {
  StudioVrmWardrobeCaptureSync,
  StudioVrmWardrobeSurfaceReceipt,
} from "./StudioVrmWardrobePropsProjection";
import {
  canonicalizeVrmContentHash,
} from "./vrm-library";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { VrmLibraryEntry } from "./vrm-library";

export function useStudioVrmPoserRuntimeE(h: StudioVrmPoserHost): void {
  const {
    open,
    onClose,
    onInsert,
    seedPropId,
    onSeedObjectInsertConsumed,
    objectInsertSeedKeyRef,
    setStatus,
    setError,
    modelName,
    customYOffset,
    poseTranslations,
    ikConstraints,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    expressionWeights,
    texturePaintPersistenceStatus,
    texturePaintPersistenceError,
    bodyRotation,
    mannequinMode,
    broadcastPreviewActive,
    viewportApiRef,
    isCapturing,
    setIsCapturing,
    isThumbnailCapturing,
    libraryEntries,
    activeModelId,
    bodyScale,
    avatarForgeState,
    avatarForgeFaceController,
    proportionRigStatus,
    fingerEdits,
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
    setVrmPropItems,
    setSelectedVrmPropUid,
    costumeState,
    setCostumeState,
    costumeMeshes,
    setSelectedCostumeKey,
    wardrobeState,
    setWardrobeState,
    setWardrobeSurfaceReceipts,
    wardrobeAutoHide,
    setWardrobeAutoHide,
    wardrobeFitReport,
    vrmPhysics,
    setVrmPhysics,
    physicsPreview,
    setPhysicsPreview,
    idleAnimation,
    webcamActive,
    webcamActiveRef,
    idleAnimationRef,
    dynamicPoseGenerationRef,
    vrmRef,
    proportionRigReceiptRef,
    avatarForgeAuthorityIdentityRef,
    captureVisualAuthorityRef,
    texturePaintRuntimeRef,
    texturePaintSnapshotRef,
    texturePaintMutationBlockedRef,
    wardrobeMutationBlockedRef,
    wardrobeAuthoredIdentityRef,
    wardrobeXpbdCaptureSyncRef,
    insertCaptureGenerationRef,
    insertCaptureFrameRef,
    insertCaptureAbortRef,
    captureRef,
    captureRequestRef,
    persistentIkResolvedSignatureRef,
    persistentIkCurrentSignatureRef,
    garmentEvaluationGenerationRef,
    garmentEvaluationReceiptRef,
    pendingPersistentIkCommandRef,
    acquireVrmCaptureOperation,
    releaseVrmCaptureOperation,
    readVrmCaptureCameraIdentity,
    acquireVrmCaptureHelperLease,
    currentPersistentIkSignature,
    persistentIkCaptureIsReady,
    avatarForgeFaceCaptureIsReady,
    texturePaintRestoreRequired,
    texturePaintSurfaceStrokeActive,
  } = h;

  function updateCostume(next: CostumeState) {
    setCostumeState(next);
    applyStudioVrmCostumeState(
      costumeMeshes,
      mergeWardrobeCostumeVisibility(next, wardrobeState, costumeMeshes, wardrobeAutoHide),
    );
  }

  function isCostumeAutoHidden(key: string): boolean {
    if (!wardrobeAutoHide || costumeState.hidden.includes(key)) return false;
    return mergeWardrobeCostumeVisibility(
      { hidden: [], recolor: {} },
      wardrobeState,
      costumeMeshes,
      true,
    ).hidden.includes(key);
  }

  function toggleCostumeMesh(key: string) {
    const hidden = costumeState.hidden.includes(key)
      ? costumeState.hidden.filter((k: string) => k !== key)
      : [...costumeState.hidden, key];
    updateCostume({ ...costumeState, hidden });
  }

  function recolorCostumeMesh(key: string, hex: string | null) {
    const recolor = { ...costumeState.recolor };
    if (hex) recolor[key] = hex.toLowerCase();
    else delete recolor[key];
    updateCostume({ ...costumeState, recolor });
  }

  function recolorCostumeSlot(slot: CostumeSlot, hex: string) {
    const recolor = { ...costumeState.recolor };
    for (const entry of costumeMeshes) {
      if (entry.slot === slot) recolor[entry.key] = hex.toLowerCase();
    }
    updateCostume({ ...costumeState, recolor });
  }

  function resetCostume() {
    updateCostume({ hidden: [], recolor: {} });
    setSelectedCostumeKey(null);
  }

  /* ── 실장착 워드로브 핸들러 ─────────────────────────────────────── */
  function equipWardrobeItem(slot: WardrobeSlot, itemId: string | null) {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    setWardrobeState((current: WardrobeState) => applyWardrobeItemSelection(current, slot, itemId));
  }

  function updateWardrobeEquip(slot: WardrobeSlot, patch: Partial<WardrobeEquip>) {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    setWardrobeState((prev: WardrobeState) => {
      const current = prev[slot];
      if (!current) return prev;
      return { ...prev, [slot]: { ...current, ...patch } };
    });
  }

  function handleWardrobeSurfaceReceipt(
    slot: WardrobeSlot,
    receipt: StudioVrmWardrobeSurfaceReceipt | null,
  ) {
    setWardrobeSurfaceReceipts((current: Partial<Record<WardrobeSlot, StudioVrmWardrobeSurfaceReceipt>>) => {
      if (!receipt) {
        if (!current[slot]) return current;
        const next = { ...current };
        delete next[slot];
        return next;
      }
      const previous = current[slot];
      if (previous?.signature === receipt.signature && previous.mode === receipt.mode) return current;
      return { ...current, [slot]: receipt };
    });
  }

  function handleWardrobeXpbdCaptureSyncChange(
    slot: WardrobeSlot,
    sync: StudioVrmWardrobeCaptureSync,
    active: boolean,
  ) {
    if (active) wardrobeXpbdCaptureSyncRef.current.set(slot, sync);
    else if (wardrobeXpbdCaptureSyncRef.current.get(slot) === sync) {
      wardrobeXpbdCaptureSyncRef.current.delete(slot);
    }
  }

  function equipWardrobeSetById(setId: string) {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    const set = selectableWardrobeSetById(setId);
    if (!set) return;
    const nextState = applyWardrobeSet(set);
    setWardrobeState(nextState);
  }

  function clearWardrobe() {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    setWardrobeState({});
  }

  function applyWardrobeFitSuggestions() {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    setWardrobeState((current: WardrobeState) => {
      const next: WardrobeState = { ...current };
      for (const slot of WARDROBE_SLOTS) {
        const equip = current[slot];
        const fit = wardrobeFitReport.slots[slot];
        if (!equip || !fit) continue;
        next[slot] = { ...equip, fit: fit.suggestedFit, fitMode: "manual" };
      }
      return next;
    });
  }

  function toggleWardrobeAutoHide() {
    if (wardrobeMutationBlockedRef.current || isCapturing) return;
    setWardrobeAutoHide((current: boolean) => !current);
  }

  /* ── 물리(스프링본) 핸들러 ──────────────────────────────────────── */
  function updatePhysics(patch: Partial<VrmPhysicsSettings>) {
    const next = parseVrmPhysicsSettings({ ...vrmPhysics, ...patch });
    setVrmPhysics(next);
    const current = vrmRef.current;
    if (current && countSpringBoneJoints(current) > 0) {
      applyVrmSpringBonePhysics(current, next);
      if (!physicsPreview) settleVrmPhysics(current);
    }
  }

  function resettlePhysics() {
    const current = vrmRef.current;
    if (current && countSpringBoneJoints(current) > 0) {
      applyVrmSpringBonePhysics(current, vrmPhysics);
      settleVrmPhysics(current);
    }
  }

  function resetPhysics() {
    setVrmPhysics(DEFAULT_VRM_PHYSICS);
    setPhysicsPreview(false);
    const current = vrmRef.current;
    if (current && countSpringBoneJoints(current) > 0) {
      applyVrmSpringBonePhysics(current, DEFAULT_VRM_PHYSICS);
      settleVrmPhysics(current);
    }
  }

  /* ── 본 부착 소품 핸들러 ────────────────────────────────────────── */
  function addVrmProp(propId: string) {
    if (!isStudioVrmPropSelectable(propId)) return;
    const instance = createPropInstance(propId);
    if (!instance) return;
    setVrmPropItems((prev: PropInstance[]) => [...prev, instance]);
    setSelectedVrmPropUid(instance.uid);
  }

  // Elements 3D rail one-shot seed: spawn prop once after open, then clear host seed state.
  useEffect(() => {
    if (!open) {
      objectInsertSeedKeyRef.current = null;
      return;
    }
    const propId = typeof seedPropId === "string" ? seedPropId.trim() : "";
    if (!propId) return;
    const key = `prop:${propId}`;
    if (objectInsertSeedKeyRef.current === key) return;
    objectInsertSeedKeyRef.current = key;
    addVrmProp(propId);
    onSeedObjectInsertConsumed?.();
  }, [open, seedPropId, onSeedObjectInsertConsumed]);

  function updateVrmProp(uid: string, patch: Partial<PropInstance>) {
    setVrmPropItems((prev: PropInstance[]) => prev.map((it: PropInstance) => (it.uid === uid ? { ...it, ...patch } : it)));
  }

  function removeVrmProp(uid: string) {
    setVrmPropItems((prev: PropInstance[]) => prev.filter((it: PropInstance) => it.uid !== uid));
    setSelectedVrmPropUid((cur: string | null) => (cur === uid ? null : cur));
  }

  function createCurrentSceneDocument(
    width: number,
    height: number,
    surfacePaint: StudioVrmSurfacePaintSettings = { version: 1, textures: [] },
  ): StudioVrmSceneDocument | null {
    const currentVrm = vrmRef.current;
    const currentEntry = libraryEntries.find((entry: VrmLibraryEntry) => entry.id === activeModelId) ?? null;
    const camera = viewportApiRef.current?.readCamera() ?? null;
    if (!currentVrm || !currentEntry || !camera) return null;

    let model: StudioVrmSceneModel;
    if (currentEntry.source === "sample") {
      model = { source: "bundled", id: currentEntry.id, name: currentEntry.name };
    } else if (
      canonicalizeVrmContentHash(currentEntry.contentHash)
      && currentEntry.byteSize
      && currentEntry.byteSize <= STUDIO_VRM_MODEL_MAX_BYTES
    ) {
      const contentHash = canonicalizeVrmContentHash(currentEntry.contentHash);
      if (!contentHash) return null;
      model = {
        source: "attachment",
        hash: contentHash,
        byteSize: currentEntry.byteSize,
        mime: "model/gltf-binary",
        name: currentEntry.name,
      };
    } else {
      setError("업로드한 VRM의 콘텐츠 해시를 확인하지 못했거나 휴대 가능한 프로젝트 자산 크기(96MB)를 넘었습니다.");
      return null;
    }

    const baked = bakeStudioVrmRuntimePose(currentVrm, STUDIO_VRM_DIRECT_EDIT_BONES);
    if (!baked) return null;
    const poseBones: StudioVrmPoseBoneMap = {};
    for (const boneName of STUDIO_VRM_HUMANOID_BONES) {
      const bone = baked.bones[boneName];
      if (!bone?.rotation) continue;
      poseBones[boneName] = {
        rotation: [bone.rotation[0], bone.rotation[1], bone.rotation[2]],
      };
    }
    const authoredFingers = createStudioVrmAuthoredFingerSnapshot(fingerEdits);
    const jointProfile = createStudioVrmRigProfileSelection(rigJointProfile);
    if (!jointProfile) return null;

    const normalized = normalizeStudioVrmSceneDocument({
      kind: "studio-vrm-scene",
      version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
      model,
      pose: {
        bones: poseBones,
        yOffset: customYOffset,
        translations: poseTranslations,
        bodyRotationY: bodyRotation,
        fingerOverrides: authoredFingers,
        ikConstraints,
      },
      expressions: expressionWeights,
      camera,
      appearance: {
        bodyScale,
        customColors,
        materialFx,
        mannequin: mannequinMode,
        avatarForge: serializeAvatarForgeState(avatarForgeState),
        costume: serializeCostume(costumeState) ?? null,
        wardrobe: serializeWardrobe(wardrobeState, { autoHideOriginal: wardrobeAutoHide }) ?? null,
      },
      rig: {
        version: 1,
        jointProfile,
        fullBodyIk: fullBodyIkEnabled,
        footPlant: footPlantEnabled,
        floorHeight: rigFloorHeight,
      },
      props: serializeVrmProps(vrmPropItems) ?? null,
      sceneProps: serializeSceneProps(activeProps, propAttachments) ?? null,
      lighting,
      lightingTone,
      physics: vrmPhysics,
      env: envVariant,
      render: {
        width,
        height,
        transparentBackground,
        backgroundColor: insertBackgroundColor,
      },
      surfacePaint,
    });
    const serialized = serializeStudioVrmSceneDocument(normalized);
    return serialized ? parseStudioVrmSceneDocument(serialized) : null;
  }

  function handleInsert() {
    if (broadcastPreviewActive || isCapturing || isSharingPose || isThumbnailCapturing) return;
    if (
      proportionRigStatus === "reload-required"
      || (
        studioVrmProportionsRequireRuntime(avatarForgeState)
        && (proportionRigStatus !== "ready" || !proportionRigReceiptRef.current)
      )
    ) {
      setError(
        proportionRigStatus === "reload-required"
          ? "체형 리그를 안전하게 확인할 수 없습니다. 캐릭터를 다시 불러온 뒤 추가해 주세요."
          : "현재 체형의 관절·의상·소품 계산이 끝난 뒤 다시 추가해 주세요.",
      );
      setStatus("ready");
      return;
    }
    const insertLibraryEntry = libraryEntries.find((entry: VrmLibraryEntry) => entry.id === activeModelId);
    if (insertLibraryEntry?.source === "memory") {
      setError(
        "현재 VRM은 SQLite/OPFS 저장 실패로 이 탭 메모리에만 있습니다. 새로고침 후 손실되지 않도록 저장소를 복구하고 다시 업로드한 뒤 프로젝트에 추가해 주세요.",
      );
      setStatus("ready");
      return;
    }
    if (texturePaintSurfaceStrokeActive) {
      setError("V12 UV 표면 획의 저장 또는 취소가 끝난 뒤 이 포즈를 추가해 주세요.");
      setStatus("ready");
      return;
    }
    const activeTexturePaintPointerId =
      texturePaintSnapshotRef.current?.activePointerId;
    if (typeof activeTexturePaintPointerId === "number") {
      setError("표면 페인트 획을 마친 뒤 이 포즈를 추가해 주세요.");
      setStatus("ready");
      return;
    }
    if (texturePaintPersistenceStatus === "restoring") {
      setError("저장된 표면 페인팅 복원이 끝난 뒤 이 포즈를 추가해 주세요.");
      setStatus("ready");
      return;
    }
    if (texturePaintPersistenceStatus === "error") {
      setError(
        texturePaintPersistenceError
        || "저장된 표면 페인팅 원본을 복원하지 못해 재편집 장면을 안전하게 저장할 수 없습니다.",
      );
      setStatus("ready");
      return;
    }
    if (texturePaintRestoreRequired && texturePaintPersistenceStatus !== "ready") {
      setError("저장된 표면 페인팅의 모델 준비가 끝난 뒤 이 포즈를 추가해 주세요.");
      setStatus("ready");
      return;
    }
    const insertBackground = resolveStudioVrmInsertBackgroundMode({
      transparent: transparentBackground,
      backgroundColor: insertBackgroundColor,
    });
    if (!insertBackground.ok) {
      setError(insertBackground.reason);
      setStatus(vrmRef.current ? "ready" : "error");
      return;
    }
    const currentCapture = captureRef.current;
    const currentVrm = vrmRef.current;
    const currentTexturePaintRuntime = texturePaintRuntimeRef.current;
    const captureTexturePaintRevision =
      currentTexturePaintRuntime?.getContentRevision() ?? 0;

    if (!currentCapture.gl || !currentCapture.scene || !currentCapture.camera || !currentVrm) {
      setError("캡처할 VRM 장면이 아직 준비되지 않았습니다.");
      setStatus(vrmRef.current ? "ready" : "error");
      return;
    }
    const captureXpbdSkirtSlots = WARDROBE_SLOTS.filter((slot) => {
      const equip = wardrobeState[slot];
      return equip && wardrobeItemById(equip.itemId)?.geometrySource === "xpbd-skirt-v1";
    });
    const captureXpbdSkirtSyncEntries = captureXpbdSkirtSlots.flatMap((slot) => {
      const sync = wardrobeXpbdCaptureSyncRef.current.get(slot);
      return sync ? [{ slot, sync }] : [];
    });
    if (captureXpbdSkirtSyncEntries.length !== captureXpbdSkirtSlots.length) {
      setError("천 물리 스커트의 최신 포즈 계산이 준비된 뒤 다시 추가해 주세요.");
      setStatus("ready");
      return;
    }
    if (!persistentIkCaptureIsReady()) {
      setError("손·발 고정점을 현재 포즈에 맞추는 중입니다. 보정 완료 후 다시 추가해 주세요.");
      setStatus("ready");
      return;
    }
    if (!avatarForgeFaceCaptureIsReady()) {
      setError("얼굴 조형이 현재 리그에 안전하게 반영된 뒤 다시 추가해 주세요.");
      setStatus("ready");
      return;
    }
    const hasLockedConstraint = ikConstraints.some((constraint: StudioVrmIkConstraint) => (
      constraint.enabled && constraint.locked
    ));
    if (webcamActive || idleAnimation) {
      setError("실시간 추적·대기 애니메이션을 끈 뒤 현재 포즈를 추가해 주세요.");
      setStatus("ready");
      return;
    }

    if (!acquireVrmCaptureOperation("insert")) {
      setError("다른 3D 캡처가 진행 중입니다. 완료된 뒤 다시 추가해 주세요.");
      setStatus("ready");
      return;
    }
    const captureVisualAuthority = captureVisualAuthorityRef.current;
    const captureCameraIdentity = readVrmCaptureCameraIdentity();
    if (!captureVisualAuthority || !captureCameraIdentity) {
      releaseVrmCaptureOperation("insert");
      setError("추가할 3D 화면과 카메라가 아직 준비되지 않았습니다.");
      setStatus("ready");
      return;
    }
    const capturePoseSignature = currentPersistentIkSignature();
    const captureDynamicPoseGeneration = dynamicPoseGenerationRef.current;
    const captureWardrobeAuthoredIdentity = wardrobeAuthoredIdentityRef.current;
    const captureGarmentEvaluationGeneration = garmentEvaluationGenerationRef.current;
    const captureGarmentEvaluationReceipt = garmentEvaluationReceiptRef.current;
    const captureProportionRigReceipt = proportionRigReceiptRef.current;
    const captureAvatarForgeIdentity = avatarForgeAuthorityIdentityRef.current;
    const captureFaceControllerSnapshot = avatarForgeFaceController.getSnapshot();
    const captureRequest = captureRequestRef.current + 1;
    captureRequestRef.current = captureRequest;
    const { camera, gl, scene } = currentCapture;
    const captureGeneration = insertCaptureGenerationRef.current + 1;
    insertCaptureGenerationRef.current = captureGeneration;
    insertCaptureAbortRef.current?.abort();
    const captureController = new AbortController();
    insertCaptureAbortRef.current = captureController;
    const wardrobeCaptureAuthorityIsCurrent = (): boolean => (
      wardrobeAuthoredIdentityRef.current === captureWardrobeAuthoredIdentity
      && garmentEvaluationGenerationRef.current === captureGarmentEvaluationGeneration
      && garmentEvaluationReceiptRef.current === captureGarmentEvaluationReceipt
      && (
        captureGarmentEvaluationReceipt === null
        || captureGarmentEvaluationReceipt.generation === captureGarmentEvaluationGeneration
      )
    );
    const xpbdSkirtCaptureAuthorityIsCurrent = (): boolean => (
      captureXpbdSkirtSyncEntries.every(({ slot, sync }) => (
        wardrobeXpbdCaptureSyncRef.current.get(slot) === sync
      ))
    );
    const capturePreconditionsAreCurrent = (): boolean => (
      captureGeneration === insertCaptureGenerationRef.current
      && captureRequest === captureRequestRef.current
      && vrmRef.current === currentVrm
      && captureRef.current.gl === gl
      && captureRef.current.scene === scene
      && captureRef.current.camera === camera
      && texturePaintRuntimeRef.current === currentTexturePaintRuntime
      && (currentTexturePaintRuntime?.getContentRevision() ?? 0)
        === captureTexturePaintRevision
      && persistentIkCurrentSignatureRef.current === capturePoseSignature
      && pendingPersistentIkCommandRef.current === null
      && dynamicPoseGenerationRef.current === captureDynamicPoseGeneration
      && proportionRigReceiptRef.current === captureProportionRigReceipt
      && avatarForgeAuthorityIdentityRef.current === captureAvatarForgeIdentity
      && avatarForgeFaceController.getSnapshot() === captureFaceControllerSnapshot
      && captureVisualAuthorityRef.current?.identity === captureVisualAuthority.identity
      && readVrmCaptureCameraIdentity() === captureCameraIdentity
      && wardrobeCaptureAuthorityIsCurrent()
      && xpbdSkirtCaptureAuthorityIsCurrent()
      && !webcamActiveRef.current
      && !idleAnimationRef.current
      && (!hasLockedConstraint
        || (
          persistentIkResolvedSignatureRef.current === capturePoseSignature
        ))
    );
    const reportWardrobeCaptureAuthorityMismatch = () => {
      if (
        !captureController.signal.aborted
        && !wardrobeCaptureAuthorityIsCurrent()
      ) {
        setError("캡처 중 의상 설정이 바뀌어 이미지를 추가하지 않았습니다. 현재 의상으로 다시 추가해 주세요.");
        setStatus("ready");
      }
    };
    const releaseCaptureMutationLocks = () => {
      if (
        captureGeneration === insertCaptureGenerationRef.current
        && captureRequest === captureRequestRef.current
      ) {
        texturePaintMutationBlockedRef.current = false;
        wardrobeMutationBlockedRef.current = false;
      }
    };
    texturePaintMutationBlockedRef.current = true;
    wardrobeMutationBlockedRef.current = true;
    setIsCapturing(true);
    setError("");
    insertCaptureFrameRef.current = requestAnimationFrame(() => {
      insertCaptureFrameRef.current = null;
      if (!capturePreconditionsAreCurrent()) {
        reportWardrobeCaptureAuthorityMismatch();
        if (insertCaptureAbortRef.current === captureController) {
          captureController.abort();
          insertCaptureAbortRef.current = null;
        }
        if (
          captureGeneration === insertCaptureGenerationRef.current
          && captureRequest === captureRequestRef.current
        ) {
          releaseCaptureMutationLocks();
          releaseVrmCaptureOperation("insert");
          setIsCapturing(false);
        }
        return;
      }

      void (async () => {
        let inserted = false;
        let releaseCaptureHelpers: (() => void) | null = null;
        const releaseLocalCapture = () => {
          releaseCaptureHelpers?.();
          releaseCaptureHelpers = null;
        };
        try {
          // PNG 인코딩·해시·SQLite/OPFS 저장은 여러 프레임이 걸릴 수 있다. 먼저 표면 텍스처를
          // 영속화한 뒤 전체 캡처 전제를 다시 검사하고 pose bake→scene→RGBA 캡처를 같은
          // 동기 구간에서 수행해 메타데이터와 실제 픽셀이 서로 다른 시점을 기록하지 않는다.
          const surfacePaint: StudioVrmSurfacePaintSettings = currentTexturePaintRuntime
            ? await import("./studio-vrm-texture-paint-persistence")
              .then(({ persistStudioVrmTexturePaintRuntime }) =>
                persistStudioVrmTexturePaintRuntime(
                  currentTexturePaintRuntime,
                  { signal: captureController.signal },
                )
              )
            : { version: 1, textures: [] };
          if (
            captureController.signal.aborted
            || !capturePreconditionsAreCurrent()
          ) {
            reportWardrobeCaptureAuthorityMismatch();
            return;
          }

          // 같은 설정은 물리 미리보기 여부와 무관하게 같은 정지 컷으로 재현되어야 한다.
          if (countSpringBoneJoints(currentVrm) > 0) {
            settleVrmPhysics(currentVrm);
          }
          currentVrm.update(0);
          // The capture owns one synchronous exact solve after the final raw-bone commit. The
          // returned receipt proves that the pixels below use this mounted viewport BufferGeometry.
          for (const { slot, sync } of captureXpbdSkirtSyncEntries) {
            const result = sync();
            if (!result.ok) {
              throw new Error(
                `${WARDROBE_SLOT_LABELS[slot]} 천 물리를 최신 포즈에 맞추지 못했습니다. 다시 시도해 주세요.`,
              );
            }
          }
          // Display size = the legacy logical export size (stable placement on the document);
          // the raster renders denser so the insert stays crisp at 100% zoom on HiDPI and
          // survives a moderate scale-up. Budget failures fall back to display-density capture.
          const { width: displayWidth, height: displayHeight } = roundExportSize(gl.domElement);
          const capturePlan = planStudio3dInsertCaptureSize({
            displayWidth,
            displayHeight,
            devicePixelRatio: globalThis.devicePixelRatio || 1,
          });
          const width = capturePlan?.width ?? displayWidth;
          const height = capturePlan?.height ?? displayHeight;
          const bakedPose = bakeStudioVrmRuntimePose(currentVrm);
          if (!bakedPose) {
            throw new Error("삽입할 VRM 자세를 회전 기반 데이터로 변환하지 못했습니다.");
          }
          const poseMetadata = buildVrmPoseDataUrlMetadata({
            ...captureVisualAuthority.fullState,
            bones: stripFingerBones(bakedPose.bones),
            yOffset: bakedPose.yOffset,
          }, modelName);
          const hashPayload = encodeURIComponent(JSON.stringify(poseMetadata));
          // Scene documents keep recording the logical viewport size — re-edit camera framing
          // depends only on the aspect, and this keeps parity with pre-HiDPI documents.
          const sceneDocument = createCurrentSceneDocument(
            displayWidth,
            displayHeight,
            surfacePaint,
          );
          if (!sceneDocument) {
            throw new Error("재편집 가능한 3D 데생 인형 장면을 만들지 못했습니다.");
          }
          releaseCaptureHelpers = acquireVrmCaptureHelperLease({
            subjectOnly: insertBackground.plan.subjectOnly,
          });
          const rgba = captureStudioVrmRgba(gl, scene, camera, { width, height }, {
            color: insertBackground.plan.backgroundColor,
            alpha: insertBackground.plan.captureAlpha,
          });
          releaseLocalCapture();
          const baseDataUrl = await encodeStudioVrmCapturePngDataUrl(
            rgba,
            { width, height },
            {
              signal: captureController.signal,
              timeoutMs: STUDIO_VRM_CAPTURE_PNG_TIMEOUT_MS,
            },
          );
          const fullDataUrl = `${baseDataUrl}#${hashPayload}`;
          if (
            captureController.signal.aborted
            || !capturePreconditionsAreCurrent()
          ) {
            reportWardrobeCaptureAuthorityMismatch();
            return;
          }

          const accepted = await onInsert({
            pngDataUrl: fullDataUrl,
            width,
            height,
            displayWidth,
            displayHeight,
            scene: sceneDocument,
          });
          if (
            captureGeneration !== insertCaptureGenerationRef.current
            || captureRequest !== captureRequestRef.current
            || vrmRef.current !== currentVrm
          ) {
            return;
          }
          if (accepted === false) {
            throw new Error("편집 중 문서가 바뀌어 캡처를 삽입하지 않았습니다. 현재 페이지에서 다시 시도해 주세요.");
          }
          inserted = true;
        } catch (caughtError: unknown) {
          if (
            captureGeneration === insertCaptureGenerationRef.current
            && captureRequest === captureRequestRef.current
          ) {
            setError(getErrorMessage(caughtError, "3D 데생 인형 캡처를 추가하지 못했습니다."));
            setStatus(vrmRef.current ? "ready" : "error");
          }
        } finally {
          releaseLocalCapture();
          if (insertCaptureAbortRef.current === captureController) {
            insertCaptureAbortRef.current = null;
          }
          if (
            captureGeneration === insertCaptureGenerationRef.current
            && captureRequest === captureRequestRef.current
          ) {
            releaseCaptureMutationLocks();
            releaseVrmCaptureOperation("insert");
            setIsCapturing(false);
          }
        }

        if (
          inserted
          && captureGeneration === insertCaptureGenerationRef.current
          && captureRequest === captureRequestRef.current
        ) {
          onClose();
        }
      })();
    });
  }


  Object.assign(h, {
    updateCostume,
    isCostumeAutoHidden,
    toggleCostumeMesh,
    recolorCostumeMesh,
    recolorCostumeSlot,
    resetCostume,
    equipWardrobeItem,
    updateWardrobeEquip,
    handleWardrobeSurfaceReceipt,
    handleWardrobeXpbdCaptureSyncChange,
    equipWardrobeSetById,
    clearWardrobe,
    applyWardrobeFitSuggestions,
    toggleWardrobeAutoHide,
    updatePhysics,
    resettlePhysics,
    resetPhysics,
    addVrmProp,
    updateVrmProp,
    removeVrmProp,
    createCurrentSceneDocument,
    handleInsert,
  });
}
