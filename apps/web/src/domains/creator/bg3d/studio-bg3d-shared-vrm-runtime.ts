import * as THREE from "three";

import {
  STUDIO_VRM_BASE_ROTATION_Y_KEY,
  loadStudioVrmAsset,
  type StudioVrmAssetLoadOptions,
  type StudioVrmMaterialVariant,
} from "../vrm/studio-vrm-asset-runtime";
import { resolveStudioVrmFingerAuthority } from "../vrm/studio-vrm-auto-grip-authority";
import { parseAvatarForgeState } from "../vrm/studio-vrm-avatar-forge";
import {
  applyBodyScale,
  applyExpressionWeightsToVrm,
  applyFingerRotations,
  applyPoseToVrm,
  applyVrmCustomColors,
  applyVrmMaterialFx,
  refineVrmGripFingerWrap,
  type FingerRotationMap,
  type PoseBoneMap,
  type VrmMaterialFx,
} from "../vrm/studio-vrm-poser-utils";
import {
  createAutoGripFingerOverrides,
  inspectAutoGripReadiness,
  scaleVrmPropRigMetrics,
  type VrmPropRigMetrics,
} from "../vrm/studio-vrm-prop-rig";
import { createStudioVrmProportionFitTransaction } from "../vrm/studio-vrm-proportion-fit-transaction";
import {
  createStudioVrmProportionRigRuntime,
  type StudioVrmProportionRigApplyResult,
  type StudioVrmProportionRigReceipt,
  type StudioVrmProportionRigRuntime,
} from "../vrm/studio-vrm-proportion-rig-runtime";
import {
  createStudioVrmProportionVrmAdapter,
  measureStudioVrmProportionHeadLength,
} from "../vrm/studio-vrm-proportion-vrm-adapter";
import { propDefById, type PropHandBone } from "../vrm/studio-vrm-props";
import { STUDIO_VRM_FINGER_BONES } from "../vrm/studio-vrm-scene-document";
import {
  getStoredVrmModelByHash,
  selectableSampleVrmUrl,
} from "../vrm/vrm-library";

import { applyStudioBg3dRuntimeAssetQuality } from "./studio-bg3d-runtime-asset-quality";

import type { StudioShared3dCharacterSource } from "../studio-shared-3d-scene-bridge";
import type { WardrobeMetrics } from "../vrm/studio-vrm-wardrobe";
import type { VRM } from "@pixiv/three-vrm";

export interface StudioBg3dLinkedVrmPreparedState {
  readonly identityKey: string;
  /** Identity of the exact model generation, proportion revision, and authored source state. */
  readonly preparedIdentityKey: string;
  /** Changes whenever the normalized humanoid is rebuilt for a new proportion authority. */
  readonly rigRevision: number;
  readonly receipt: StudioVrmProportionRigReceipt;
  /** Measured after proportion writes and normalized rebuild, before pose/bodyScale. */
  readonly wardrobeMetrics: WardrobeMetrics;
  /** Measured after proportion writes and normalized rebuild, before pose/bodyScale. */
  readonly propRigMetrics: VrmPropRigMetrics;
}

export type StudioBg3dLinkedVrmPrepareFailureCode =
  | "disposed"
  | "invalid-identity"
  | "model-generation-mismatch"
  | "proportion-runtime-failed"
  | "rest-measurement-unavailable";

export type StudioBg3dLinkedVrmPrepareResult =
  | {
      readonly ok: true;
      readonly prepared: StudioBg3dLinkedVrmPreparedState;
    }
  | {
      readonly ok: false;
      readonly code: StudioBg3dLinkedVrmPrepareFailureCode;
      readonly detail: string;
      readonly runtimeResult?: StudioVrmProportionRigApplyResult;
    };

export interface StudioBg3dLinkedVrmRuntimeOwner {
  readonly vrm: VRM;
  readonly modelRuntimeKey: string;
  readonly modelGeneration: string;
  readonly runtime: StudioVrmProportionRigRuntime;
  readonly disposed: boolean;
  readonly prepare: (
    source: StudioShared3dCharacterSource,
    identityKey: string,
    options?: Readonly<{ projectHandProps?: boolean }>,
  ) => StudioBg3dLinkedVrmPrepareResult;
  readonly dispose: () => StudioVrmProportionRigApplyResult;
}

export type StudioBg3dLinkedVrmRuntimeOwnerCreateResult =
  | { readonly ok: true; readonly owner: StudioBg3dLinkedVrmRuntimeOwner }
  | { readonly ok: false; readonly code: string; readonly detail: string };

let linkedVrmModelGeneration = 0;

function allocateLinkedVrmModelGeneration(modelRuntimeKey: string): string {
  if (linkedVrmModelGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Linked VRM model generation space exhausted.");
  }
  linkedVrmModelGeneration += 1;
  return `${modelRuntimeKey}:${linkedVrmModelGeneration}`;
}

function failPreparation(
  code: StudioBg3dLinkedVrmPrepareFailureCode,
  detail: string,
  runtimeResult?: StudioVrmProportionRigApplyResult,
): StudioBg3dLinkedVrmPrepareResult {
  return Object.freeze({
    ok: false as const,
    code,
    detail,
    ...(runtimeResult ? { runtimeResult } : {}),
  });
}

/**
 * Owns exactly one rest snapshot and normalized-rig lifecycle for one loaded shared VRM clone.
 * Source identities may change without reloading the model; equal proportion authorities reuse
 * the committed rest metrics while pose, fingers, legacy bodyScale, expressions and materials are
 * reapplied. A changed proportion authority runs the complete rebuild transaction first.
 */
export function createStudioBg3dLinkedVrmRuntimeOwner(
  vrm: VRM,
  modelRuntimeKey: string,
): StudioBg3dLinkedVrmRuntimeOwnerCreateResult {
  if (!modelRuntimeKey) {
    return Object.freeze({
      ok: false as const,
      code: "invalid-model-runtime-key",
      detail: "The linked model runtime key is empty.",
    });
  }
  const headMeasurement = measureStudioVrmProportionHeadLength(vrm);
  if (!headMeasurement) {
    return Object.freeze({
      ok: false as const,
      code: "head-measurement-unavailable",
      detail: "The loaded VRM head length could not be measured safely.",
    });
  }

  const modelGeneration = allocateLinkedVrmModelGeneration(modelRuntimeKey);
  let observedGeneration = modelGeneration;
  let disposed = false;
  let poisoned = false;
  let reapplyAuthoredState: () => boolean | void = () => true;
  const adapter = createStudioVrmProportionVrmAdapter({
    vrm,
    getCurrentModelGeneration: () => observedGeneration,
    reapplyAuthoredPose: () => reapplyAuthoredState(),
  });
  const runtimeResult = createStudioVrmProportionRigRuntime(adapter, {
    headLength: headMeasurement.value,
    headMeasurement: {
      version: headMeasurement.version,
      source: headMeasurement.source,
      reliable: headMeasurement.reliable,
    },
  });
  if (!runtimeResult.ok) {
    return Object.freeze({
      ok: false as const,
      code: runtimeResult.code,
      detail: runtimeResult.message,
    });
  }

  const { runtime } = runtimeResult;
  let committedSignature: string | null = null;
  let committedReceipt: StudioVrmProportionRigReceipt | null = null;
  let committedWardrobeMetrics: WardrobeMetrics | null = null;
  let committedPropRigMetrics: VrmPropRigMetrics | null = null;

  const applyAuthoredState = (
    source: StudioShared3dCharacterSource,
    propRigMetrics: VrmPropRigMetrics,
    projectHandProps: boolean,
  ) => applyStudioBg3dLinkedCharacterState(vrm, source, {
    propRigMetrics: scaleVrmPropRigMetrics(
      propRigMetrics,
      source.scene.appearance.bodyScale,
    ),
    projectHandProps,
  });

  const makePrepared = (
    identityKey: string,
    receipt: StudioVrmProportionRigReceipt,
    wardrobeMetrics: WardrobeMetrics,
    propRigMetrics: VrmPropRigMetrics,
  ): StudioBg3dLinkedVrmPrepareResult => Object.freeze({
    ok: true as const,
    prepared: Object.freeze({
      identityKey,
      preparedIdentityKey: JSON.stringify([
        identityKey,
        modelGeneration,
        receipt.applyGeneration,
      ]),
      rigRevision: receipt.applyGeneration,
      receipt,
      wardrobeMetrics,
      propRigMetrics,
    }),
  });

  const owner: StudioBg3dLinkedVrmRuntimeOwner = {
    vrm,
    modelRuntimeKey,
    modelGeneration,
    runtime,
    get disposed() {
      return disposed;
    },
    prepare: (source, identityKey, options = {}) => {
      if (disposed || poisoned) {
        return failPreparation(
          "disposed",
          poisoned
            ? "The proportion runtime requires a fresh model generation."
            : "The linked VRM runtime owner is disposed.",
        );
      }
      if (!identityKey) {
        return failPreparation("invalid-identity", "The prepared source identity is empty.");
      }
      if (source.modelRuntimeKey !== modelRuntimeKey) {
        return failPreparation(
          "model-generation-mismatch",
          "The linked source no longer belongs to this loaded model generation.",
        );
      }

      const projectHandProps = options.projectHandProps !== false;
      const forge = parseAvatarForgeState(source.scene.appearance.avatarForge);
      const proportionSignature = JSON.stringify(forge.proportions);

      if (
        committedSignature === proportionSignature
        && committedReceipt
        && committedWardrobeMetrics
        && committedPropRigMetrics
      ) {
        const applyCurrentState = () => applyAuthoredState(
          source,
          committedPropRigMetrics!,
          projectHandProps,
        );
        if (!applyCurrentState()) {
          return failPreparation(
            "proportion-runtime-failed",
            "The canonical pose, fingers, or legacy body scale could not be reapplied.",
          );
        }
        reapplyAuthoredState = applyCurrentState;
        return makePrepared(
          identityKey,
          committedReceipt,
          committedWardrobeMetrics,
          committedPropRigMetrics,
        );
      }

      const previousReapply = reapplyAuthoredState;
      let fitTransaction: ReturnType<typeof createStudioVrmProportionFitTransaction> | null = null;
      const applyPreparedAuthoredState = () => {
        const measurements = fitTransaction?.measurements();
        if (!measurements?.wardrobe || !measurements.props) return false;
        return applyAuthoredState(source, measurements.props, projectHandProps);
      };
      fitTransaction = createStudioVrmProportionFitTransaction(
        vrm,
        applyPreparedAuthoredState,
      );
      reapplyAuthoredState = fitTransaction.reapply;
      const applied = runtime.apply(forge.proportions);
      if (!applied.ok) {
        reapplyAuthoredState = previousReapply;
        if (applied.recovery === "reload-required") poisoned = true;
        return failPreparation(
          "proportion-runtime-failed",
          applied.message,
          applied,
        );
      }
      const measurements = fitTransaction.measurements();
      if (!measurements.wardrobe || !measurements.props) {
        reapplyAuthoredState = previousReapply;
        poisoned = true;
        return failPreparation(
          "rest-measurement-unavailable",
          "The rebuilt rest rig did not produce complete wardrobe and prop measurements.",
          applied,
        );
      }

      committedSignature = proportionSignature;
      committedReceipt = applied;
      committedWardrobeMetrics = measurements.wardrobe;
      committedPropRigMetrics = measurements.props;
      reapplyAuthoredState = () => applyAuthoredState(
        source,
        measurements.props!,
        projectHandProps,
      );
      return makePrepared(
        identityKey,
        applied,
        measurements.wardrobe,
        measurements.props,
      );
    },
    dispose: () => {
      // The loaded clone is about to be released, so disposal needs only the neutral rest
      // lifecycle. Reapplying a prior source pose here could consume fit metrics from a different
      // committed proportion authority and needlessly make otherwise safe cleanup fail.
      reapplyAuthoredState = () => true;
      const result = runtime.dispose();
      disposed = true;
      observedGeneration = `${modelGeneration}:disposed`;
      reapplyAuthoredState = () => false;
      committedSignature = null;
      committedReceipt = null;
      committedWardrobeMetrics = null;
      committedPropRigMetrics = null;
      return result;
    },
  };
  return Object.freeze({ ok: true as const, owner: Object.freeze(owner) });
}

/**
 * Resolves the MToon material class for the renderer that will draw the character.
 *
 * This is where the WebGPU node material enters the graph: `@pixiv/three-vrm/nodes` statically
 * imports Three's WebGPU build, so it is reached only through the approved lazy entry and only
 * once a WebGPU session actually exists. A WebGL session never touches this branch.
 */
async function resolveMToonMaterialType(
  variant: StudioVrmMaterialVariant,
): Promise<StudioVrmAssetLoadOptions["mtoonMaterialType"]> {
  if (variant === "webgl-shader") return undefined;
  const { MToonNodeMaterial } = await import("./studio-bg3d-three-webgpu-entry");
  // `three/webgpu` re-exports Three's own `Material`, so the two `typeof Material` declarations
  // describe the same runtime class reached through different module identities.
  return MToonNodeMaterial as unknown as NonNullable<
    StudioVrmAssetLoadOptions["mtoonMaterialType"]
  >;
}

/**
 * Loads a linked character for the renderer that is actually about to draw it.
 *
 * `materialVariant` is not a preference. MToon's `ShaderMaterial` and its TSL node port compile on
 * exactly one backend each, so passing the wrong one produces a character that never appears.
 */
export async function loadStudioBg3dLinkedVrm(
  scene: StudioShared3dCharacterSource["scene"],
  options?: { readonly materialVariant?: StudioVrmMaterialVariant },
): Promise<VRM> {
  const mtoonMaterialType =
    await resolveMToonMaterialType(options?.materialVariant ?? "webgl-shader");
  if (scene.model.source === "bundled") {
    const url = selectableSampleVrmUrl(scene.model.id);
    if (!url) throw new Error("bundled-model-unavailable");
    return loadStudioVrmAsset(url, { mtoonMaterialType });
  }

  const stored = await getStoredVrmModelByHash(scene.model.hash);
  if (!stored) throw new Error("attachment-unavailable");
  const objectUrl = URL.createObjectURL(stored.blob);
  try {
    return await loadStudioVrmAsset(objectUrl, { mtoonMaterialType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function applyStudioBg3dLinkedCharacterState(
  vrm: VRM,
  source: StudioShared3dCharacterSource,
  options: Readonly<{
    propRigMetrics?: VrmPropRigMetrics;
    projectHandProps?: boolean;
  }> = {},
): boolean {
  const { scene } = source;
  const [stageX, stageY, stageZ] = source.stageTransform.position;
  const poseApplied = applyPoseToVrm(
    vrm,
    scene.pose.bones as PoseBoneMap,
    stageY,
    {
      ...scene.pose.translations,
      root: [stageX, 0, stageZ],
    },
  );
  if (!poseApplied) return false;

  const handProps = source.compatibility.appearanceProjection.handProps;
  const projectedProps = options.projectHandProps !== false && handProps.status === "supported"
    ? handProps.props.map((prop) => prop.instance)
    : [];
  const authoredFingers = scene.pose.fingerOverrides as FingerRotationMap;
  let effectiveFingers = authoredFingers;
  if (options.propRigMetrics) {
    const autoGripItems = projectedProps.filter((item) => item.rig?.autoFingerPose === true);
    if (autoGripItems.some((item) => (
      inspectAutoGripReadiness(
        item,
        projectedProps,
        propDefById,
        options.propRigMetrics,
      ).kind !== "ready"
    ))) return false;

    const autoGrip = createAutoGripFingerOverrides(
      projectedProps,
      propDefById,
      options.propRigMetrics,
    );
    const requiredHands = new Set<"left" | "right">();
    for (const item of autoGripItems) {
      if (item.bone === "leftHand") requiredHands.add("left");
      if (item.bone === "rightHand") requiredHands.add("right");
      const secondary = item.rig?.secondary;
      if (secondary?.enabled && secondary.influence > 0) {
        requiredHands.add(secondary.bone === "leftHand" ? "left" : "right");
      }
    }
    for (const hand of requiredHands) {
      const prefix = hand === "left" ? "left" : "right";
      const complete = STUDIO_VRM_FINGER_BONES
        .filter((bone) => bone.startsWith(prefix))
        .every((bone) => autoGrip[bone] !== undefined);
      if (!complete) return false;
    }
    effectiveFingers = resolveStudioVrmFingerAuthority(authoredFingers, autoGrip);
  } else if (projectedProps.some((item) => item.rig?.autoFingerPose === true)) {
    return false;
  }
  applyFingerRotations(vrm, effectiveFingers);
  // 자동그립 손가락이 접점까지 실제로 닿도록 컬을 정련한다(모델 손 크기 적응).
  const gripContactTargets = projectedProps
    .filter((item) => item.rig?.autoFingerPose === true)
    .map((item) => {
      const def = propDefById(item.propId);
      const side: "left" | "right" | null = item.bone === "leftHand"
        ? "left"
        : item.bone === "rightHand" ? "right" : null;
      if (!def?.grip || !side || !options.propRigMetrics) return null;
      const handNode = vrm.humanoid?.getNormalizedBoneNode(`${side}Hand`);
      if (!handNode) return null;
      const socket: PropHandBone = side === "left" ? "leftHand" : "rightHand";
      const socketWorldPoint = new THREE.Vector3(
        ...options.propRigMetrics.handSockets[socket].position,
      );
      handNode.localToWorld(socketWorldPoint);
      return {
        side,
        socketWorldPoint,
        gripRadius: def.grip.radius,
        goalBias: def.grip.kind === "flat" || def.grip.kind === "support" ? 0.012 : 0,
      };
    })
    .filter((target): target is NonNullable<typeof target> => target !== null);
  if (gripContactTargets.length > 0) {
    refineVrmGripFingerWrap(vrm, gripContactTargets);
  }
  applyBodyScale(vrm, scene.appearance.bodyScale);
  applyExpressionWeightsToVrm(vrm, { ...scene.expressions });
  applyVrmCustomColors(vrm, { ...scene.appearance.customColors });
  applyVrmMaterialFx(vrm, scene.appearance.materialFx as VrmMaterialFx);

  const baseRotationY = vrm.scene.userData[STUDIO_VRM_BASE_ROTATION_Y_KEY];
  vrm.scene.rotation.y =
    (typeof baseRotationY === "number" && Number.isFinite(baseRotationY) ? baseRotationY : 0) +
    source.stageTransform.rotationY;
  vrm.scene.name = `ToonSpectrumSharedCharacter:${source.elementId}`;
  vrm.scene.userData.studioShared3dCharacterElementId = source.elementId;
  applyStudioBg3dRuntimeAssetQuality(vrm.scene, {
    castShadow: true,
    receiveShadow: true,
    qualityBudget: 1,
  });
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // One bounded root proxy owns character selection. Internal face, hair and garment meshes stay
    // pass-through so transparent or oversized geometry cannot steal picks from the background.
    mesh.raycast = () => undefined;
  });
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  return true;
}
