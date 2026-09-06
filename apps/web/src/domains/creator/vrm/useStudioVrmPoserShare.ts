/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  confirmStudioDestructiveAction,
} from "../studio-destructive-action-preview";
import {
  studioSharePoseConsentRequest,
  studioVrmPoseShareUseContextConsentRequest,
  type StudioVrmPoseShareUseContextDisclosure,
} from "../studio-destructive-command-catalog";

import {
  readStudioVrmAssetLicenseAuthority,
} from "./studio-vrm-asset-runtime";
import {
  createStudioVrmRenderedPoseUseContextReceipt,
  planStudioVrmRenderedPoseMarketplaceShare,
  prepareStudioVrmRenderedPoseMarketplaceAttestation,
  STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
} from "./studio-vrm-license-product-gate";
import {
  settleVrmPhysics,
  countSpringBoneJoints,
} from "./studio-vrm-physics";
import {
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
import {
  captureStudioVrmRgba,
  encodeStudioVrmCapturePngDataUrl,
} from "./studio-vrm-raster-capture";
import {
  WARDROBE_SLOTS,
  WARDROBE_SLOT_LABELS,
  wardrobeItemById,
  parseWardrobeDocument,
} from "./studio-vrm-wardrobe";
import {
  STUDIO_VRM_CAPTURE_PNG_TIMEOUT_MS,
  STUDIO_VRM_SHARE_TIMEOUT_MS,
} from "./StudioVrmPoserTypes";

import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { VrmLibraryEntry } from "./vrm-library";
import type {
  VRM,
} from "@pixiv/three-vrm";

import {
  creatorAssetLicenseOf,
} from "@/shared/lib/creator-asset-contract";
import {
  publishAsset,
} from "@/src/infrastructure/creator-client";

export function useStudioVrmPoserShare(h: StudioVrmPoserHost): void {
  const {
    setError,
    modelName,
    setJointHandleStatus,
    broadcastPreviewActive,
    isCapturing,
    isThumbnailCapturing,
    libraryEntriesRef,
    installedModelId,
    activeModelIdRef,
    modelLoadTargetIdRef,
    avatarForgeFaceController,
    isSharingPose,
    setIsSharingPose,
    setSharedPoseReloadToken,
    idleAnimation,
    webcamActive,
    webcamActiveRef,
    idleAnimationRef,
    dynamicPoseGenerationRef,
    vrmRef,
    proportionRigReceiptRef,
    avatarForgeAuthorityIdentityRef,
    captureVisualAuthorityRef,
    wardrobeXpbdCaptureSyncRef,
    sharePoseAbortRef,
    captureRef,
    persistentIkResolvedSignatureRef,
    persistentIkCurrentSignatureRef,
    pendingPersistentIkCommandRef,
    acquireVrmCaptureOperation,
    releaseVrmCaptureOperation,
    readVrmCaptureCameraIdentity,
    acquireVrmCaptureHelperLease,
    cancelPendingPoseShare,
    persistentIkCaptureIsReady,
    proportionRigCaptureIsReady,
    avatarForgeFaceCaptureIsReady,
    activeLibraryEntry,
  } = h;
  async function handleSharePoseToServer() {
    if (broadcastPreviewActive) return;
    if (isSharingPose) {
      cancelPendingPoseShare();
      return;
    }
    if (isCapturing || isThumbnailCapturing) {
      alert("진행 중인 캡처가 끝난 뒤 포즈를 공유해 주세요.");
      return;
    }

    const currentCapture = captureRef.current;
    const currentVrm = vrmRef.current;

    if (!currentCapture.gl || !currentCapture.scene || !currentCapture.camera || !currentVrm) {
      alert("공유할 VRM 장면이 아직 준비되지 않았습니다.");
      return;
    }
    if (!persistentIkCaptureIsReady()) {
      setJointHandleStatus("손·발 고정점을 현재 포즈에 맞추는 중입니다. 완료 후 다시 공유해 주세요.");
      return;
    }
    if (!proportionRigCaptureIsReady()) {
      setError("현재 체형의 관절·의상·소품 계산이 끝난 뒤 다시 공유해 주세요.");
      return;
    }
    if (!avatarForgeFaceCaptureIsReady()) {
      setError("얼굴 조형이 현재 리그에 안전하게 반영된 뒤 다시 공유해 주세요.");
      return;
    }
    if (webcamActive || idleAnimation) {
      setJointHandleStatus("실시간 추적·대기 애니메이션을 끈 뒤 현재 포즈를 공유해 주세요.");
      return;
    }

    const shareLibraryEntry = activeLibraryEntry;
    if (
      !shareLibraryEntry
      || !shareLibraryEntry.contentHash
      || !shareLibraryEntry.licenseAuthority
      || activeModelIdRef.current !== shareLibraryEntry.id
      || installedModelId !== shareLibraryEntry.id
      || modelLoadTargetIdRef.current !== shareLibraryEntry.id
    ) {
      setError("현재 렌더링 중인 VRM과 이용 조건 영수증을 연결할 수 없습니다. 모델을 다시 선택한 뒤 공유해 주세요.");
      return;
    }
    const shareLicenseAuthority = readStudioVrmAssetLicenseAuthority(currentVrm);
    if (!shareLicenseAuthority) {
      setError("현재 렌더링 중인 VRM에서 검증된 이용 조건 영수증을 찾을 수 없습니다. 모델을 다시 선택한 뒤 공유해 주세요.");
      return;
    }
    const shareLicenseAuthorityIsCurrent = (): boolean => {
      const currentEntry = libraryEntriesRef.current.find(
        (entry: VrmLibraryEntry) => entry.id === shareLibraryEntry.id,
      );
      return Boolean(
        currentEntry
        && activeModelIdRef.current === shareLibraryEntry.id
        && modelLoadTargetIdRef.current === shareLibraryEntry.id
        && vrmRef.current === currentVrm
        && currentEntry.source === shareLibraryEntry.source
        && currentEntry.contentHash === shareLibraryEntry.contentHash
        && currentEntry.licenseAuthority === shareLibraryEntry.licenseAuthority
        && readStudioVrmAssetLicenseAuthority(currentVrm) === shareLicenseAuthority
      );
    };
    if (!shareLicenseAuthorityIsCurrent()) {
      setError("공유 권한을 확인하는 동안 활성 VRM이 바뀌었습니다. 현재 모델에서 다시 공유해 주세요.");
      return;
    }
    const shareAttestation = prepareStudioVrmRenderedPoseMarketplaceAttestation(
      shareLicenseAuthority,
    );
    if (!shareAttestation.ok) {
      setError(shareAttestation.message);
      return;
    }
    if (!shareAttestation.permittedActorBases.includes("other")) {
      setError("이 VRM은 저작자 또는 별도 이용 허락을 받은 사용자만 공유할 수 있습니다. 현재 간편 확인 경로에서는 안전하게 공유를 진행할 수 없습니다.");
      return;
    }
    const shareUseContextDisclosure = {
      avatarPermissionBasis: "other",
      publisherKind: "corporation",
      confirmedAttributionText: shareAttestation.attributionText,
      containsModifiedModel: true,
      excessivelyViolent: "absent",
      excessivelySexual: "absent",
      politicalOrReligious: "absent",
      antisocialOrHate: "absent",
      shareAlike: "not-satisfied",
    } satisfies StudioVrmPoseShareUseContextDisclosure;
    if (!(await confirmStudioDestructiveAction(
      studioVrmPoseShareUseContextConsentRequest(shareUseContextDisclosure),
    ))) return;
    if (!shareLicenseAuthorityIsCurrent()) {
      setError("이용 맥락을 확인하는 동안 활성 VRM 또는 이용 조건 영수증이 바뀌었습니다. 현재 모델에서 다시 공유해 주세요.");
      return;
    }
    const shareUseContextReceipt = createStudioVrmRenderedPoseUseContextReceipt({
      confirmedByUser: true,
      ...shareUseContextDisclosure,
    });
    const sharePlan = planStudioVrmRenderedPoseMarketplaceShare(
      shareLicenseAuthority,
      {
        useContextReceipt: shareUseContextReceipt,
        toonspectrumRenderedPoseGrant: STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
      },
    );
    if (!sharePlan.ok) {
      setError([sharePlan.message, ...sharePlan.reasons].join("\n"));
      return;
    }
    if (!shareLicenseAuthorityIsCurrent()) {
      setError("공유 권한을 계획하는 동안 활성 VRM이 바뀌었습니다. 현재 모델에서 다시 공유해 주세요.");
      return;
    }

    const title = globalThis.prompt("서버에 공유할 포즈의 이름을 입력해주세요 (최대 30자):");
    if (!title) return;

    if (title.length > 30) {
      alert("이름은 최대 30자까지 가능합니다.");
      return;
    }
    if (!shareLicenseAuthorityIsCurrent()) {
      setError("공유 권한을 확인하는 동안 활성 VRM이 바뀌었습니다. 현재 모델에서 다시 공유해 주세요.");
      return;
    }
    if (!(await confirmStudioDestructiveAction(studioSharePoseConsentRequest({
      poseTitle: title,
      licenseLabel: creatorAssetLicenseOf(sharePlan.license).label,
      attributionText: sharePlan.attributionText,
    })))) return;
    if (!shareLicenseAuthorityIsCurrent()) {
      setError("동의하는 동안 활성 VRM 또는 이용 조건 영수증이 바뀌었습니다. 현재 모델에서 다시 공유해 주세요.");
      return;
    }

    const shareVisualAuthority = captureVisualAuthorityRef.current;
    const shareCameraIdentity = readVrmCaptureCameraIdentity();
    if (!shareVisualAuthority || !shareCameraIdentity) {
      alert("공유할 3D 화면과 카메라가 아직 준비되지 않았습니다.");
      return;
    }
    const name = `[3D_POSE] ${title}`;
    const shareFullState = shareVisualAuthority.fullState;
    const sharePoseSignature = persistentIkCurrentSignatureRef.current;
    const shareHasLockedConstraint = shareFullState.ikConstraints?.some((constraint: StudioVrmIkConstraint) => (
      constraint.enabled && constraint.locked
    )) ?? false;
    const shareDynamicPoseGeneration = dynamicPoseGenerationRef.current;
    const shareProportionRigReceipt = proportionRigReceiptRef.current;
    const shareAvatarForgeIdentity = avatarForgeAuthorityIdentityRef.current;
    const shareFaceControllerSnapshot = avatarForgeFaceController.getSnapshot();
    const shareWardrobeState = parseWardrobeDocument(shareFullState.wardrobe).slots;
    const shareXpbdSkirtSlots = WARDROBE_SLOTS.filter((slot) => {
      const equip = shareWardrobeState[slot];
      return equip && wardrobeItemById(equip.itemId)?.geometrySource === "xpbd-skirt-v1";
    });
    const shareXpbdSkirtSyncEntries = shareXpbdSkirtSlots.flatMap((slot) => {
      const sync = wardrobeXpbdCaptureSyncRef.current.get(slot);
      return sync ? [{ slot, sync }] : [];
    });
    if (shareXpbdSkirtSyncEntries.length !== shareXpbdSkirtSlots.length) {
      setError("천 물리 스커트의 최신 포즈 계산이 준비된 뒤 다시 공유해 주세요.");
      return;
    }
    const shareVisualAuthorityIsCurrent = (): boolean => (
      captureVisualAuthorityRef.current?.identity === shareVisualAuthority.identity
      && readVrmCaptureCameraIdentity() === shareCameraIdentity
    );
    const shareXpbdSkirtAuthorityIsCurrent = (): boolean => (
      shareXpbdSkirtSyncEntries.every(({ slot, sync }) => (
        wardrobeXpbdCaptureSyncRef.current.get(slot) === sync
      ))
    );
    if (!avatarForgeFaceCaptureIsReady()) {
      setError("확인하는 동안 얼굴 조형 상태가 바뀌었습니다. 현재 화면에서 다시 공유해 주세요.");
      return;
    }
    if (webcamActiveRef.current || idleAnimationRef.current) {
      setJointHandleStatus("확인하는 동안 실시간 포즈가 바뀌었습니다. 추적·대기 애니메이션을 끄고 다시 공유해 주세요.");
      return;
    }
    if (!acquireVrmCaptureOperation("share")) {
      alert("다른 3D 캡처가 진행 중입니다. 완료된 뒤 다시 공유해 주세요.");
      return;
    }

    cancelPendingPoseShare();
    const controller = new AbortController();
    sharePoseAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STUDIO_VRM_SHARE_TIMEOUT_MS);
    setIsSharingPose(true);
    let releaseCaptureHelpers: (() => void) | null = acquireVrmCaptureHelperLease();
    const releaseLocalCapture = () => {
      releaseCaptureHelpers?.();
      releaseCaptureHelpers = null;
    };
    try {
      const { camera, gl, scene } = currentCapture;
      // Give React/R3F one committed paint so ephemeral bone/IK helpers are absent from the
      // explicitly rendered sharing frame. The direct Three visibility lease hides the shadow
      // synchronously as a second line of defence.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (
        vrmRef.current !== currentVrm ||
        captureRef.current.gl !== gl ||
        captureRef.current.scene !== scene ||
        captureRef.current.camera !== camera ||
        persistentIkCurrentSignatureRef.current !== sharePoseSignature ||
        pendingPersistentIkCommandRef.current !== null ||
        dynamicPoseGenerationRef.current !== shareDynamicPoseGeneration ||
        proportionRigReceiptRef.current !== shareProportionRigReceipt ||
        avatarForgeAuthorityIdentityRef.current !== shareAvatarForgeIdentity ||
        avatarForgeFaceController.getSnapshot() !== shareFaceControllerSnapshot ||
        !shareLicenseAuthorityIsCurrent() ||
        !shareVisualAuthorityIsCurrent() ||
        !shareXpbdSkirtAuthorityIsCurrent() ||
        webcamActiveRef.current ||
        idleAnimationRef.current ||
        (shareHasLockedConstraint
          && persistentIkResolvedSignatureRef.current !== sharePoseSignature)
      ) {
        throw new Error("공유 캡처 장면이 변경되었습니다.");
      }
      if (countSpringBoneJoints(currentVrm) > 0) {
        settleVrmPhysics(currentVrm);
      }
      currentVrm.update(0);
      for (const { slot, sync } of shareXpbdSkirtSyncEntries) {
        const result = sync();
        if (!result.ok) {
          throw new Error(
            `${WARDROBE_SLOT_LABELS[slot]} 천 물리를 최신 포즈에 맞추지 못했습니다. 다시 시도해 주세요.`,
          );
        }
      }
      const { width, height } = roundExportSize(gl.domElement);
      const bakedPose = bakeStudioVrmRuntimePose(currentVrm);
      if (!bakedPose) throw new Error("공유할 VRM 자세를 회전 기반 데이터로 변환하지 못했습니다.");
      const poseMetadata = buildVrmPoseDataUrlMetadata({
        ...shareFullState,
        bones: stripFingerBones(bakedPose.bones),
        yOffset: bakedPose.yOffset,
      }, modelName);
      if (
        !shareLicenseAuthorityIsCurrent()
        || !shareVisualAuthorityIsCurrent()
        || !shareXpbdSkirtAuthorityIsCurrent()
      ) {
        throw new Error("공유 캡처 장면이 변경되었습니다.");
      }
      const rgba = captureStudioVrmRgba(gl, scene, camera, { width, height });
      const hashPayload = encodeURIComponent(JSON.stringify(poseMetadata));
      // Raw GPU readback is complete. Restore capture-only helpers before Worker compression or
      // network I/O so slow encoding/upload cannot keep the interactive viewport altered.
      releaseLocalCapture();
      const baseDataUrl = await encodeStudioVrmCapturePngDataUrl(
        rgba,
        { width, height },
        { signal: controller.signal, timeoutMs: STUDIO_VRM_CAPTURE_PNG_TIMEOUT_MS },
      );
      const fullDataUrl = `${baseDataUrl}#${hashPayload}`;

      if (
        controller.signal.aborted
        || persistentIkCurrentSignatureRef.current !== sharePoseSignature
        || pendingPersistentIkCommandRef.current !== null
        || dynamicPoseGenerationRef.current !== shareDynamicPoseGeneration
        || webcamActiveRef.current
        || idleAnimationRef.current
        || !shareLicenseAuthorityIsCurrent()
        || !shareVisualAuthorityIsCurrent()
        || !shareXpbdSkirtAuthorityIsCurrent()
      ) return;
      await publishAsset({
        name,
        description: `${modelName || "VRM 캐릭터"}의 재편집 가능한 3D 데생 포즈`,
        tags: ["VRM", "3D 데생 인형", "포즈"],
        dataUrl: fullDataUrl,
        width,
        height,
        kind: "vrm_pose",
        license: sharePlan.license,
        attributionText: sharePlan.attributionText,
        containsAi: false,
        rightsConfirmed: sharePlan.rightsConfirmed,
      }, controller.signal);

      alert("포즈가 성공적으로 서버에 공유되었습니다!");
      setSharedPoseReloadToken((token: number) => token + 1);
    } catch (e) {
      if (controller.signal.aborted) {
        if (timedOut) {
          alert("포즈 공유가 30초 안에 완료되지 않아 중단했습니다. 공유 목록을 확인한 뒤 다시 시도해 주세요.");
        }
        return;
      }
      console.error(e);
      alert(getErrorMessage(e, "포즈 공유에 실패했습니다."));
    } finally {
      window.clearTimeout(timeoutId);
      releaseLocalCapture();
      if (sharePoseAbortRef.current === controller) {
        sharePoseAbortRef.current = null;
        setIsSharingPose(false);
      }
      releaseVrmCaptureOperation("share");
    }
  }

  Object.assign(h, {
    handleSharePoseToServer,
  });
}
