/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useEffect,
} from "react";

import {
  confirmStudioDestructiveAction,
} from "../studio-destructive-action-preview";
import {
  studioDeleteCustomPoseRequest,
  studioImportPosesRequest,
} from "../studio-destructive-command-catalog";

import {
  parseAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  parseCostumeState,
} from "./studio-vrm-costume";
import {
  applyStudioVrmCostumeState,
  collectStudioVrmCostumeMeshes,
} from "./studio-vrm-costume-runtime";
import {
  parseStudioVrmCustomPoseImport,
  serializeStudioVrmCustomPoseLibrary,
  serializeStudioVrmFullStateLibrary,
  STUDIO_VRM_CUSTOM_POSE_MAX_LABEL_LENGTH,
  STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH,
} from "./studio-vrm-creative-sqlite-repository";
import {
  cloneStudioVrmIkConstraints,
} from "./studio-vrm-ik-constraints";
import {
  buildStudioVrmPersistentIkSignature,
} from "./studio-vrm-persistent-ik-signature";
import {
  parseVrmPhysicsSettings,
  applyVrmSpringBonePhysics,
  settleVrmPhysics,
  countSpringBoneJoints,
} from "./studio-vrm-physics";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
  normalizeStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  extractStudioVrmFingerRotations,
  mergeStudioVrmFingerRotationsIntoBones,
} from "./studio-vrm-poser-helpers";
import {
  applyExpressionWeightsToVrm,
  applyPoseToVrm,
  applyVrmCustomColors,
  applyVrmMaterialFx,
  applyFullState,
  stripFingerBones,
  applyPoserVisualState,
  planFullStateRestore,
  createFullStateLoadHandlers,
  DEFAULT_VRM_MATERIAL_FX,
  type FullVrmState,
  type FullVrmStateInput,
} from "./studio-vrm-poser-utils";
import {
  SCENE_PROP_IDS,
} from "./studio-vrm-procedural-scene-props";
import {
  parseVrmProps,
} from "./studio-vrm-props";
import {
  parseSceneProps,
} from "./studio-vrm-scene-props";
import {
  shouldLoadSharedPoseLibrary,
} from "./studio-vrm-shared-pose-library";
import {
  mergeWardrobeCostumeVisibility,
  parseWardrobeDocument,
} from "./studio-vrm-wardrobe";
import {
  DEFAULT_VRM_CUSTOM_COLORS,
  type CustomPose,
} from "./StudioVrmPoserTypes";
import {
  applyRotationToVrm,
  createStudioVrmProportionPoseTransaction,
  studioVrmProportionsRequireRuntime,
} from "./StudioVrmViewportUtils";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type {
  VRM,
} from "@pixiv/three-vrm";
import type { MouseEvent as ReactMouseEvent } from "react";

export function useStudioVrmPoserPoseLibrary(h: StudioVrmPoserHost): void {
  const {
    open,
    status,
    setError,
    vrm,
    activePoseId,
    setActivePoseId,
    customBones,
    setCustomBones,
    customYOffset,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    setIkConstraints,
    rigJointProfile,
    fullBodyIkEnabled,
    footPlantEnabled,
    rigFloorHeight,
    lockedPoseBones,
    setActiveExpressionId,
    expressionWeights,
    setExpressionWeights,
    activePanelTab,
    bodyRotation,
    setBodyRotation,
    jointHandleInteracting,
    broadcastPreviewActive,
    activeModelId,
    bodyScale,
    setBodyScale,
    setAvatarForgeState,
    setProportionRigStatus,
    setProportionRigMessage,
    fingerEdits,
    setFingerEdits,
    setLighting,
    setEnvVariant,
    fullStateName,
    setFullStateName,
    savedFullStates,
    setSavedFullStates,
    setCustomColors,
    setMaterialFx,
    sharedPoseLibraryOpen,
    sharedPoseReloadToken,
    setLightingTone,
    setActiveProps,
    setPropAttachments,
    setSelectedPropId,
    savedPoses,
    setSavedPoses,
    creativeRepository,
    setVrmCreativePersistenceStatus,
    setVrmCreativePersistenceMessage,
    vrmCreativeMountedRef,
    vrmCreativeMutationGenerationRef,
    vrmCreativeMutationTailRef,
    vrmCreativeDirtyAuthoritiesRef,
    savedPosesRef,
    savedFullStatesRef,
    preserveExpression,
    setVrmPropItems,
    setCostumeState,
    setCostumeMeshes,
    setSelectedCostumeKey,
    setWardrobeState,
    setWardrobeMetrics,
    setWardrobeSurfaceReceipts,
    setPropRigMetrics,
    setWardrobeAutoHide,
    setVrmPhysics,
    vrmRef,
    proportionRigRuntimeRef,
    proportionPoseReapplyRef,
    jointIkTransactionRef,
    persistentIkReconcileRevisionRef,
    persistentIkResolvedSignatureRef,
    pendingPersistentIkCommandRef,
    setPersistentIkReconciling,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
    loadSharedPoseCatalog,
    cancelJointIkTransaction,
    captureFullState,
    effectiveFingerEdits,
    vrmCreativeReadOnly,
  } = h;
  function replaceSavedPoses(next: CustomPose[]): void {
    savedPosesRef.current = next;
    setSavedPoses(next);
  }

  function replaceSavedFullStates(next: Record<string, FullVrmState>): void {
    savedFullStatesRef.current = next;
    setSavedFullStates(next);
  }

  function enqueueVrmCreativePersistence(
    authority: "poses" | "full-states",
    operation: () => Promise<unknown>,
    successMessage: string,
  ): void {
    const generation = vrmCreativeMutationGenerationRef.current + 1;
    vrmCreativeMutationGenerationRef.current = generation;
    setVrmCreativePersistenceStatus("saving");
    setVrmCreativePersistenceMessage("SQLite/OPFS에 저장하는 중입니다.");
    const persisted = vrmCreativeMutationTailRef.current
      .catch(() => undefined)
      .then(operation);
    vrmCreativeMutationTailRef.current = persisted.then(() => undefined, () => undefined);
    void persisted.then(() => {
      vrmCreativeDirtyAuthoritiesRef.current.delete(authority);
      if (!vrmCreativeMountedRef.current || vrmCreativeMutationGenerationRef.current !== generation) {
        return;
      }
      if (vrmCreativeDirtyAuthoritiesRef.current.size > 0) {
        setVrmCreativePersistenceStatus("memory");
        setVrmCreativePersistenceMessage(
          "일부 VRM 창작 데이터는 현재 탭 메모리 임시 상태입니다. 새로고침하면 사라질 수 있습니다.",
        );
        return;
      }
      setVrmCreativePersistenceStatus("sqlite");
      setVrmCreativePersistenceMessage(successMessage);
    }).catch((caughtError: unknown) => {
      vrmCreativeDirtyAuthoritiesRef.current.add(authority);
      if (!vrmCreativeMountedRef.current || vrmCreativeMutationGenerationRef.current !== generation) {
        return;
      }
      setVrmCreativePersistenceStatus("memory");
      setVrmCreativePersistenceMessage(
        `SQLite/OPFS 저장에 실패해 변경을 현재 탭 메모리에만 유지합니다. 현재 탭 메모리 임시 · 새로고침 시 사라짐: ${
          caughtError instanceof Error ? caughtError.message : String(caughtError)
        }`,
      );
    });
  }

  function handleSavePose() {
    if (broadcastPreviewActive || vrmCreativeReadOnly) return;
    const label = globalThis.prompt("포즈 이름을 입력해 주세요:", `마이 포즈 ${savedPoses.length + 1}`);
    if (!label) return;
    const canonicalLabel = label.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!canonicalLabel || canonicalLabel.length > STUDIO_VRM_CUSTOM_POSE_MAX_LABEL_LENGTH) {
      alert(`포즈 이름은 ${STUDIO_VRM_CUSTOM_POSE_MAX_LABEL_LENGTH}자 이하여야 합니다.`);
      return;
    }
    const newPose: CustomPose = {
      id: `custom-${Date.now()}`,
      label: canonicalLabel,
      yOffset: customYOffset,
      bones: mergeStudioVrmFingerRotationsIntoBones(customBones, fingerEdits),
      poseTranslations: cloneStudioVrmPoseTranslations(poseTranslations),
      expressionWeights: { ...expressionWeights }
    };
    const next = [...savedPosesRef.current, newPose];
    try {
      serializeStudioVrmCustomPoseLibrary(next);
    } catch (caughtError) {
      alert(caughtError instanceof Error ? caughtError.message : "포즈 저장 한도를 초과했습니다.");
      return;
    }
    replaceSavedPoses(next);
    enqueueVrmCreativePersistence(
      "poses",
      () => creativeRepository.saveCustomPoses(next),
      `“${canonicalLabel}” 포즈를 SQLite/OPFS에 저장했습니다.`,
    );
  }

  function handleDeletePose(id: string, e: ReactMouseEvent<HTMLButtonElement>) {
    if (broadcastPreviewActive) return;
    e.stopPropagation();
    const poseLabel = savedPoses.find((p: CustomPose) => p.id === id)?.label;
    void (async () => {
      if (
        !(await confirmStudioDestructiveAction(studioDeleteCustomPoseRequest(poseLabel)))
      ) return;
      const next = savedPosesRef.current.filter((p: CustomPose) => p.id !== id);
      replaceSavedPoses(next);
      enqueueVrmCreativePersistence(
        "poses",
        () => creativeRepository.saveCustomPoses(next),
        "커스텀 포즈 삭제를 SQLite/OPFS에 저장했습니다.",
      );
      if (activePoseId === id) {
        setActivePoseId("default");
      }
    })().catch(() => {
      alert("포즈 삭제를 이 기기에 저장하지 못했습니다.");
    });
  }

  function handleCustomPoseSelect(pose: CustomPose) {
    setActivePoseId(pose.id);
    const stripped = stripFingerBones(pose.bones);
    const poseFingers = extractStudioVrmFingerRotations(pose.bones);
    const nextFingers = Object.keys(poseFingers).length > 0 ? poseFingers : fingerEdits;
    const nextTranslations = normalizeStudioVrmPoseTranslations(pose.poseTranslations)
      ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS;
    setCustomBones(stripped);
    if (nextFingers !== fingerEdits) setFingerEdits(nextFingers);
    setCustomYOffset(pose.yOffset);
    setPoseTranslations(cloneStudioVrmPoseTranslations(nextTranslations));
    if (vrmRef.current) {
      applyPoserVisualState(vrmRef.current, {
        bones: stripped,
        yOffset: pose.yOffset,
        poseTranslations: nextTranslations,
        fingerEdits: nextFingers,
        bodyScale,
      });
      if (preserveExpression) {
        applyExpressionWeightsToVrm(vrmRef.current, expressionWeights);
      } else if (pose.expressionWeights) {
        setExpressionWeights(pose.expressionWeights);
        applyExpressionWeightsToVrm(vrmRef.current, pose.expressionWeights);
      } else {
        setExpressionWeights({});
        setActiveExpressionId("neutral");
        applyExpressionWeightsToVrm(vrmRef.current, {});
      }
    }
  }

  function handleCopyPose() {
    try {
      const poseData = {
        yOffset: customYOffset,
        bones: customBones,
        poseTranslations: cloneStudioVrmPoseTranslations(poseTranslations),
        expressionWeights: expressionWeights,
      };
      const jsonStr = JSON.stringify(poseData, null, 2);
      navigator.clipboard.writeText(jsonStr)
        .then(() => {
          alert("현재 자세와 표정이 클립보드에 복사되었습니다.\n다른 캐릭터나 다른 컷의 캐릭터에 붙여넣기(Paste)할 수 있습니다.");
        })
        .catch(() => {
          sessionStorage.setItem("studio_pose_clipboard", jsonStr);
          alert("현재 자세와 표정이 로컬 저장소에 임시 복사되었습니다.");
        });
    } catch (_e) {
      alert("포즈 복사에 실패했습니다.");
    }
  }

  async function handlePastePose() {
    if (broadcastPreviewActive) return;
    try {
      let jsonStr = "";
      try {
        jsonStr = await navigator.clipboard.readText();
      } catch (_clipErr) {
        jsonStr = sessionStorage.getItem("studio_pose_clipboard") || "";
      }

      if (!jsonStr) {
        alert("클립보드 또는 로컬 저장소에 저장된 포즈 데이터가 없습니다.");
        return;
      }

      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== "object" || !parsed.bones) {
        alert("올바른 포즈 데이터 형식이 아닙니다.");
        return;
      }

      const pastedTranslations = normalizeStudioVrmPoseTranslations(parsed.poseTranslations)
        ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS;
      setCustomBones(parsed.bones);
      setCustomYOffset(parsed.yOffset ?? 0);
      setPoseTranslations(cloneStudioVrmPoseTranslations(pastedTranslations));

      if (!preserveExpression && parsed.expressionWeights) {
        setExpressionWeights(parsed.expressionWeights);
        if (vrmRef.current) {
          applyExpressionWeightsToVrm(vrmRef.current, parsed.expressionWeights);
        }
      } else if (vrmRef.current) {
        applyExpressionWeightsToVrm(vrmRef.current, expressionWeights);
      }

      if (vrmRef.current) {
        applyPoseToVrm(
          vrmRef.current,
          parsed.bones,
          parsed.yOffset ?? 0,
          pastedTranslations,
        );
      }

      alert("복사된 포즈를 성공적으로 붙여넣었습니다!");
    } catch (_e) {
      alert("포즈 붙여넣기에 실패했습니다. 데이터 형식을 확인해 주세요.");
    }
  }

  // 풀 스테이트 copy/paste + local save/load (새 기능)
  function handleCopyFullState() {
    try {
      const full = captureFullState();
      const json = JSON.stringify(full);
      navigator.clipboard.writeText(json).then(() => alert("전체 포저 상태 복사됨")).catch(() => { sessionStorage.setItem("studio_vrm_full_clip", json); alert("현재 탭에 전체 상태 저장"); });
    } catch { alert("전체 상태 복사 실패"); }
  }
  async function handlePasteFullState() {
    if (broadcastPreviewActive) return;
    try {
      let json = ""; try { json = await navigator.clipboard.readText(); } catch { json = sessionStorage.getItem("studio_vrm_full_clip") || ""; }
      if (!json) return alert("전체 상태 데이터 없음");
      const s = JSON.parse(json) as FullVrmStateInput;
      const restored = loadHandlers.handlePasteFullStateFromParsed(s);
      if (restored && s && (s.version === 2 || s.version === 3)) {
        alert("전체 상태 붙여넣기 OK");
      }
    } catch { alert("붙여넣기 실패"); }
  }
  function handleSaveFullLocal() {
    if (broadcastPreviewActive || vrmCreativeReadOnly) return;
    const name = (fullStateName || `full-${Date.now()}`)
      .normalize("NFKC")
      .trim()
      .replace(/\s+/gu, " ");
    if (!name) return;
    if (name.length > STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH) {
      alert(`전체 상태 이름은 ${STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH}자 이하여야 합니다.`);
      return;
    }
    const full = captureFullState();
    const next = { ...savedFullStatesRef.current, [name]: full };
    try {
      serializeStudioVrmFullStateLibrary(next);
    } catch (caughtError) {
      alert(caughtError instanceof Error ? caughtError.message : "전체 상태 저장 한도를 초과했습니다.");
      return;
    }
    replaceSavedFullStates(next);
    enqueueVrmCreativePersistence(
      "full-states",
      () => creativeRepository.saveFullStates(next),
      `“${name}” 전체 상태를 SQLite/OPFS에 저장했습니다.`,
    );
    setFullStateName("");
  }

  function handleDeleteFullLocal(name: string): void {
    if (broadcastPreviewActive || vrmCreativeReadOnly) return;
    const next = { ...savedFullStatesRef.current };
    if (!Object.prototype.hasOwnProperty.call(next, name)) return;
    delete next[name];
    replaceSavedFullStates(next);
    enqueueVrmCreativePersistence(
      "full-states",
      () => creativeRepository.saveFullStates(next),
      `“${name}” 전체 상태 삭제를 SQLite/OPFS에 저장했습니다.`,
    );
  }
  function commitFullStateRestore(
    s: FullVrmState,
    vrm: VRM | null,
    options: { trustPersistentIkPose?: boolean; installingModel?: boolean } = {},
  ) {
    cancelJointIkTransaction({
      forceInvalidate: true,
      restoreBaseline: false,
      status: jointHandleInteracting || jointIkTransactionRef.current
        ? "진행 중인 IK 이동을 취소하고 전체 포즈 상태를 복원했습니다."
        : undefined,
    });
    pendingPersistentIkCommandRef.current = null;
    const plan = planFullStateRestore(s);
    const restoredColors = plan.customColors ?? DEFAULT_VRM_CUSTOM_COLORS;
    const restoredCostume = parseCostumeState(plan.costume);
    const restoredWardrobeDocument = parseWardrobeDocument(plan.wardrobe);
    const restoredWardrobe = restoredWardrobeDocument.slots;
    const restoredWardrobeAutoHide = restoredWardrobeDocument.options.autoHideOriginal;
    const restoredPhysics = parseVrmPhysicsSettings(plan.physics);
    const restoredAvatarForge = parseAvatarForgeState(plan.avatarForge);
    const restoredBodyScale = plan.bodyScale ?? (
      options.installingModel ? { height: 1, width: 1 } : bodyScale
    );
    if (vrm) {
      const hadProportionRuntime = proportionRigRuntimeRef.current !== null;
      const requiresProportionRuntime = studioVrmProportionsRequireRuntime(
        restoredAvatarForge,
      );
      const rollbackTransaction = options.installingModel
        ? null
        : createStudioVrmProportionPoseTransaction(vrm, {
            bones: customBones,
            yOffset: customYOffset,
            poseTranslations,
            fingerEdits: effectiveFingerEdits,
            bodyScale,
            bodyRotation,
            expressionWeights,
          });
      const proportionTransaction = createStudioVrmProportionPoseTransaction(vrm, {
        bones: plan.strippedBones,
        yOffset: plan.yOffset,
        poseTranslations: plan.poseTranslations,
        fingerEdits: plan.fingerOverrides ?? {},
        bodyScale: restoredBodyScale,
        bodyRotation: plan.bodyRotation,
        expressionWeights: plan.expressionWeights,
      });
      const proportionOutcome = h.applyProportionRigState(
        vrm,
        restoredAvatarForge.proportions,
        proportionTransaction,
      );
      if (
        proportionOutcome !== "committed"
        && (hadProportionRuntime || requiresProportionRuntime)
      ) {
        if (proportionOutcome === "recovered" && rollbackTransaction) {
          proportionPoseReapplyRef.current = rollbackTransaction.reapply;
          const reapplied = rollbackTransaction.reapply();
          const measurements = rollbackTransaction.measurements();
          if (
            reapplied === false
            || !measurements.wardrobe
            || !measurements.props
          ) {
            setProportionRigStatus("reload-required");
            setProportionRigMessage(
              "직전 포즈와 의상 기준을 안전하게 복구하지 못했습니다. 캐릭터를 다시 불러와 주세요.",
            );
            setError("체형 복원 중 직전 화면 상태까지 되돌리지 못했습니다. 캐릭터를 다시 불러와 주세요.");
            return false;
          }
          setWardrobeMetrics(measurements.wardrobe);
          setPropRigMetrics(measurements.props);
          setWardrobeSurfaceReceipts({});
        }
        setError(
          requiresProportionRuntime && !hadProportionRuntime
            ? "이 VRM에서는 저장된 관절 비율을 안전하게 재생할 수 없어 복원을 중단했습니다."
            : "저장된 체형을 안전하게 복원하지 못해 직전 상태를 유지했습니다.",
        );
        return false;
      }
    }
    setCustomBones(plan.strippedBones);
    setCustomYOffset(plan.yOffset);
    setPoseTranslations(cloneStudioVrmPoseTranslations(plan.poseTranslations));
    setIkConstraints(cloneStudioVrmIkConstraints(plan.ikConstraints));
    setBodyRotation(plan.bodyRotation);
    setActivePoseId(s.poseId ?? "default");
    setActiveExpressionId(s.expressionId ?? "neutral");
    setExpressionWeights(plan.expressionWeights);
    if (plan.bodyScale || options.installingModel) setBodyScale(restoredBodyScale);
    if (plan.lighting) {
      setLighting(plan.lighting);
    } else if (options.installingModel) {
      setLighting({ intensity: 1.2, colorTemp: 0.5, directionDeg: 45 });
    }
    setLightingTone(plan.lightingTone);
    if (plan.env) {
      setEnvVariant(plan.env);
    } else if (options.installingModel) {
      setEnvVariant("none");
    }
    setFingerEdits(plan.fingerOverrides ?? {});
    // 의상·워드로브는 무조건 반영 — undo/redo에서 장착/숨김 변화도 되돌리고 이전 값이
    // 눌어붙지 않게 한다. 새 VRM 메시를 알아야 하는 자동 숨김은 아래 vrm 분기에서 합성한다.
    setWardrobeState(restoredWardrobe);
    setWardrobeAutoHide(restoredWardrobeAutoHide);
    setVrmPropItems(plan.propsItems);
    const restoredSceneProps = parseSceneProps(plan.sceneProps, SCENE_PROP_IDS);
    setActiveProps(restoredSceneProps.active);
    setPropAttachments(restoredSceneProps.attachments);
    setSelectedPropId(null);
    setVrmPhysics(restoredPhysics);
    // materialFx 는 별도 저장/공유 payload에 담기지만(poseMetadata.materialFx), FullVrmState 경로
    // (undo/redo·저장한 포즈 불러오기·공유 데이터URL 붙여넣기)에서 빠지면 재질 효과가 조용히
    // 사라진다 — plan에 실려 왔으면 항상 state로 복원한다(없으면 기본값으로 되돌려 이전 값이
    // 눌어붙지 않게 한다).
    setMaterialFx(plan.materialFx ?? DEFAULT_VRM_MATERIAL_FX);
    setCustomColors({ ...restoredColors });
    setAvatarForgeState(restoredAvatarForge);

    persistentIkReconcileRevisionRef.current += 1;
    setPersistentIkReconciling(false);
    persistentIkResolvedSignatureRef.current = options.trustPersistentIkPose
      ? buildStudioVrmPersistentIkSignature({
          modelId: activeModelId,
          bones: plan.strippedBones,
          fingerEdits: plan.fingerOverrides ?? {},
          yOffset: plan.yOffset,
          translations: plan.poseTranslations,
          bodyRotation: plan.bodyRotation,
          bodyScale: restoredBodyScale,
          proportions: restoredAvatarForge.proportions,
          constraints: plan.ikConstraints,
          lockedPoseBones,
          jointProfile: rigJointProfile,
          fullBodyIk: fullBodyIkEnabled,
          footPlant: footPlantEnabled,
          floorHeight: rigFloorHeight,
        })
      : "";

    if (vrm) {
      const meshes = collectStudioVrmCostumeMeshes(vrm);
      // costume은 사용자의 수동 편집만 소유하고, 워드로브 자동 숨김은 현재 전체 슬롯에서 매번
      // 파생한다. 이 둘을 state에 섞지 않아 equip/unequip가 수동 숨김을 되살리지 않는다.
      const effectiveCostume = mergeWardrobeCostumeVisibility(
        restoredCostume,
        restoredWardrobe,
        meshes,
        restoredWardrobeAutoHide,
      );
      setCostumeMeshes(meshes);
      setCostumeState(restoredCostume);
      setSelectedCostumeKey(null);
      applyStudioVrmCostumeState(meshes, effectiveCostume);
      applyFullState(vrm, s, {
        applyPose: (b, y, translations) => applyPoseToVrm(vrm, b, y, translations),
        applyExpr: (w) => applyExpressionWeightsToVrm(vrm, w),
        applyProps: (p) => setVrmPropItems(parseVrmProps(p).items),
        applySceneProps: (p) => {
          const next = parseSceneProps(p, SCENE_PROP_IDS);
          setActiveProps(next.active);
          setPropAttachments(next.attachments);
        },
        applyMaterialFx: (fx) => applyVrmMaterialFx(vrm, fx),
        applyCustomColors: (colors) => applyVrmCustomColors(vrm, colors),
      });
      if (countSpringBoneJoints(vrm) > 0) {
        applyVrmSpringBonePhysics(vrm, restoredPhysics);
        settleVrmPhysics(vrm);
      }
      applyRotationToVrm(vrm, plan.bodyRotation);
      if (!plan.customColors) applyVrmCustomColors(vrm, DEFAULT_VRM_CUSTOM_COLORS);
    } else {
      setCostumeState(restoredCostume);
      setSelectedCostumeKey(null);
    }
    return true;
  }

  // Use the exact same factory the tests use so handlers execute shipped code
  const loadHandlers = createFullStateLoadHandlers({
    savedFullStates,
    commitFullStateRestore,
    vrmRef,
    setActivePoseId,
    setCustomColors,
    alertFn: (m) => alert(m),
  });

  function handleLoadFullLocal(name: string) {
    loadHandlers.handleLoadFullLocal(name);
  }

  function handleExportPoses() {
    if (savedPoses.length === 0) return;
    try {
      const dataStr = JSON.stringify(savedPoses, null, 2);
      const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `toonspectrum_custom_poses_${Date.now()}.json`;
      const linkElement = document.createElement("a");
      linkElement.setAttribute("href", dataUri);
      linkElement.setAttribute("download", exportFileDefaultName);
      linkElement.click();
    } catch (_e) {
      alert("포즈 내보내기에 실패했습니다.");
    }
  }

  function handleImportPoses() {
    if (vrmCreativeReadOnly) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.files || target.files.length === 0) return;
      const file = target.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const contents = e.target?.result as string;
          const importNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // NOSONAR S2245 non-security identifier
          const imported = parseStudioVrmCustomPoseImport(
            contents,
            (index) => `custom-${importNonce}-${index.toString(36)}`,
          );
          if (imported.length === 0) {
            alert("가져올 수 있는 유효한 포즈 데이터가 없습니다.");
            return;
          }

          // 승인이 비동기라 아래 저장은 바깥 try/catch 밖에서 일어난다. 실패를 삼키면
          // "가져왔다고 했는데 다음 실행에 없는" 조용한 실패가 되므로 여기서 다시 잡는다.
          void (async () => {
            if (
              !(await confirmStudioDestructiveAction(
                studioImportPosesRequest(imported.length)
              ))
            ) return;
            const next = [...savedPosesRef.current, ...imported];
            serializeStudioVrmCustomPoseLibrary(next);
            replaceSavedPoses(next);
            enqueueVrmCreativePersistence(
              "poses",
              () => creativeRepository.saveCustomPoses(next),
              `커스텀 포즈 ${imported.length}개를 SQLite/OPFS에 저장했습니다.`,
            );
          })().catch((caughtError: unknown) => {
            alert(caughtError instanceof Error
              ? caughtError.message
              : "가져온 포즈를 검증하거나 저장하지 못했습니다.");
          });
        } catch (caughtError) {
          alert(caughtError instanceof Error
            ? caughtError.message
            : "파일 읽기 또는 파싱에 실패했습니다.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  useEffect(() => {
    if (!shouldLoadSharedPoseLibrary({
      editorOpen: open,
      posePanelActive: activePanelTab === "pose",
      libraryExpanded: sharedPoseLibraryOpen,
    })) return;

    void loadSharedPoseCatalog(0, false);

    return () => {
      cancelPendingSharedPoseCatalog();
      cancelPendingSharedPoseSelection();
    };
  }, [
    activePanelTab,
    open,
    sharedPoseLibraryOpen,
    sharedPoseReloadToken,
    loadSharedPoseCatalog,
    cancelPendingSharedPoseCatalog,
    cancelPendingSharedPoseSelection,
  ]);


  const impl = h.__impl;
  if (impl) impl.commitFullStateRestore = commitFullStateRestore;
  Object.assign(h, {
    replaceSavedPoses,
    replaceSavedFullStates,
    enqueueVrmCreativePersistence,
    handleSavePose,
    handleDeletePose,
    handleCustomPoseSelect,
    handleCopyPose,
    handlePastePose,
    handleCopyFullState,
    handlePasteFullState,
    handleSaveFullLocal,
    handleDeleteFullLocal,
    commitFullStateRestore,
    loadHandlers,
    handleLoadFullLocal,
    handleExportPoses,
    handleImportPoses,
  });
}
