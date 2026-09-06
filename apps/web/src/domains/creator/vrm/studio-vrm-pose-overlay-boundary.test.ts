import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { formatStudioDestructivePreview } from "../studio-destructive-action-preview";
import {
  studioSharePoseConsentRequest,
  studioVrmPoseShareUseContextConsentRequest,
} from "../studio-destructive-command-catalog";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const source = [
  readFileSync(new URL("./StudioVrmPoserTypes.ts", import.meta.url), "utf8"),
  readFileSync(new URL("./StudioVrmPoseBoneOverlay.tsx", import.meta.url), "utf8"),
  readStudioVrmPoserImplementationSource(),
].join("\n");
const studioPageSource = readStudioPageCompositionSource();
const studioLazyPanelStackSource = readFileSync(
  new URL("../StudioThreeDPreviewPanelStack.tsx", import.meta.url),
  "utf8"
);
const destructiveCatalogSource = readFileSync(
  new URL("../studio-destructive-command-catalog.ts", import.meta.url),
  "utf8"
);

describe("Studio VRM visual pose bone boundary", () => {
  it("renders ephemeral normalized-bone markers that never enter captures", () => {
    expect(source).toContain("const VIEWPORT_POSE_BONES");
    expect(source).toContain("getNormalizedBoneNode(boneName)");
    expect(source).toContain('depthTest={false}');
    expect(source).toContain('depthWrite={false}');
    expect(source).toContain(
      "vrm && showPoseBoneOverlay && !texturePaintModeSelected && !isCapturing && !isSharingPose && !isThumbnailCapturing && !webcamActive",
    );
    expect(source).toContain("const releaseCaptureHelpers = acquireVrmCaptureHelperLease()");
    expect(source).toContain("await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))");
  });

  it("connects a clicked 3D marker to the matching bounded manual-pose card", () => {
    expect(source).toContain("onSelect(boneName)");
    expect(source).toContain("function selectViewportPoseBone(boneName: VRMHumanBoneName)");
    expect(source).toContain("candidate.bones.includes(boneName)");
    expect(source).toContain('id={`vrm-manual-bone-${boneName}`}');
    expect(source).toContain("data-vrm-pose-bone={boneName}");
    expect(source).toContain("selectedViewportPoseBone === boneName");
    expect(source).toContain("locked={lockedBones.includes(boneName)}");
  });

  it("uses a camera-facing pointer plane for hand IK and commits rotations once at drag end", () => {
    expect(source).toContain("dragPlaneRef.current.setFromNormalAndCoplanarPoint(");
    expect(source).toContain("event.ray.intersectPlane(dragPlaneRef.current");
    expect(source).toContain("function handleViewportHandIkDrag(");
    expect(source).toContain("applyVrmTwoBoneGrip(");
    expect(source).toContain('if (phase !== "end") return;');
    expect(source).toContain("setCustomBones(nextBones)");
    const orbitControlsStart = source.indexOf("<OrbitControls");
    const orbitControlsEnd = source.indexOf("</Canvas>", orbitControlsStart);
    const orbitControls = source.slice(orbitControlsStart, orbitControlsEnd);
    expect(orbitControlsStart).toBeGreaterThanOrEqual(0);
    expect(orbitControlsEnd).toBeGreaterThan(orbitControlsStart);
    expect(orbitControls).toContain("!isViewportHandIkDragging");
    expect(orbitControls).toContain("!jointHandleInteracting");
    expect(orbitControls).toContain("!texturePaintStrokeActive");
    expect(orbitControls).toContain("enableRotate={!texturePaintInteractionEnabled}");
    expect(source).toContain("onPointerCancel={(event) => {");
    expect(source).toContain("const pointerTarget = event.currentTarget as unknown as");
    expect(source).toContain("pointerTarget.setPointerCapture(event.pointerId)");
    expect(source).toContain("pointerCaptureTarget.releasePointerCapture(pointerId)");
    expect(source).toContain("onLostPointerCapture={(event) => {");
    expect(source).toContain('window.addEventListener("pointerup", finishMatchingPointer)');
    expect(source).toContain('window.addEventListener("pointercancel", finishMatchingPointer)');
    expect(source).toContain('window.addEventListener("blur", finishOnWindowBlur)');
    expect(source).toContain('gl.domElement.addEventListener("lostpointercapture", finishMatchingPointer)');
    expect(source).toContain("if (!draggingRef.current) return;");
    expect(source).toContain("finishDragRef.current(target)");
    expect(source).toContain("setIsViewportHandIkDragging(false)");
  });

  it("previews bounded full-body multi-chain output and commits translations only on release", () => {
    const previewStart = source.indexOf("function previewJointHandleIk(");
    const commitStart = source.indexOf("function handleJointHandleIkCommit(");
    const rollbackStart = source.indexOf("function handleJointHandleIkRollback(");
    const previewSource = source.slice(previewStart, commitStart);
    const commitSource = source.slice(commitStart, rollbackStart);

    expect(previewSource).toContain("solveStudioVrmFullBodyIk(currentVrm");
    expect(previewSource).toContain("baseTranslations: transaction.baseline.translations");
    expect(previewSource).toContain('(["leftFoot", "rightFoot"] as const).flatMap');
    expect(previewSource).toContain("양발 고정에 참여하는 다리에 잠긴 관절이 있습니다");
    expect(previewSource).toContain("applyStudioVrmRotationPose(currentVrm");
    const convergenceGuard = previewSource.indexOf("if (!canCommitStudioVrmIkResult(result))");
    const latestPreview = previewSource.indexOf("transaction.latest = result");
    expect(convergenceGuard).toBeGreaterThan(-1);
    expect(latestPreview).toBeGreaterThan(convergenceGuard);
    expect(previewSource.slice(convergenceGuard, latestPreview)).toContain(
      "applyStudioVrmRotationPose(currentVrm, transaction.baseline, bodyScale)",
    );
    expect(previewSource.slice(convergenceGuard, latestPreview)).toContain("transaction.latest = null");
    expect(previewSource).not.toContain("setPoseTranslations(");
    expect(previewSource).not.toContain("setCustomBones(");
    expect(commitSource).toContain("if (result && !canCommitStudioVrmIkResult(result))");
    expect(commitSource).toContain("restoreBaseline: true");
    expect(commitSource).toContain("status: STUDIO_VRM_IK_NOT_CONVERGED_STATUS");
    expect(commitSource).toContain("setCustomBones(nextBones)");
    expect(commitSource).toContain("setPoseTranslations(cloneStudioVrmPoseTranslations(nextTranslations))");
    expect(commitSource).toContain("constraints.length");
    expect(commitSource).toContain("transaction.control !== control");
    expect(commitSource).toContain("transaction.targetWorld.x");
    expect(commitSource).toContain("commitStudioVrmFullStateHistoryTransaction(");
    expect(commitSource.match(/commitStudioVrmFullStateHistoryTransaction\(/g)).toHaveLength(1);
    expect(commitSource).toContain('control: "pole"');
    expect(source).toContain("enabledStudioVrmIkPolesSceneLocal(ikConstraints)");
    expect(source).toContain("onPolePreview={previewJointHandlePole}");
    expect(source).toContain("onPoleCommit={handleJointHandlePoleCommit}");
    expect(source).toContain('aria-label="IK 핸들 이동 방식"');
    expect(source).toContain('aria-label="IK 핸들 축 제한"');
    expect(source).toContain("min-h-11 min-w-11");
  });

  it("rolls persistent locked-pin reconciliation back when the full-body solver does not converge", () => {
    const solver = source.indexOf("const result = solveStudioVrmFullBodyIk(vrm, {");
    const publish = source.indexOf("const nextBones = stripFingerBones(result.bones);", solver);
    expect(solver).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(solver);
    const admission = source.slice(solver, publish);
    const convergence = admission.indexOf("if (!canCommitStudioVrmIkResult(result))");

    expect(convergence).toBeGreaterThan(-1);
    expect(admission.slice(convergence)).toContain(
      "rollbackPendingCommand(STUDIO_VRM_IK_NOT_CONVERGED_STATUS)"
    );
    expect(admission).not.toContain("persistentIkResolvedSignatureRef.current =");
    expect(admission).not.toContain("commitPendingCommand(");
  });

  it("keeps the poser open when the editor rejects an obsolete insertion ticket", () => {
    expect(source).toContain("onInsert: (result: StudioVrmPoserInsertResult) =>");
    expect(source).toContain("const accepted = await onInsert({");
    expect(source).toContain("pngDataUrl: fullDataUrl,");
    expect(source).toContain("scene: sceneDocument,");
    expect(source).toContain("if (accepted === false) {");
    expect(studioPageSource).toContain(
      "insertVrmResult: (result) => applyStudioVrmInsertResult({"
    );
    expect(studioLazyPanelStackSource).toContain("onInsert={insertVrmResult}");
  });

  it("bounds server sharing and releases local capture helpers before upload", () => {
    const shareStart = source.indexOf("async function handleSharePoseToServer()");
    const shareEnd = source.indexOf("\n  // Effect Event", shareStart);
    const shareSource = source.slice(shareStart, shareEnd);
    const disclosureIndex = shareSource.indexOf(
      "prepareStudioVrmRenderedPoseMarketplaceAttestation(",
    );
    const useContextConsentIndex = shareSource.indexOf(
      "studioVrmPoseShareUseContextConsentRequest(shareUseContextDisclosure)",
      disclosureIndex,
    );
    const receiptIndex = shareSource.indexOf(
      "createStudioVrmRenderedPoseUseContextReceipt({",
      useContextConsentIndex,
    );
    const plannerIndex = shareSource.indexOf("planStudioVrmRenderedPoseMarketplaceShare(");
    const plannerGuardIndex = shareSource.indexOf("if (!sharePlan.ok)", plannerIndex);
    const promptIndex = shareSource.indexOf("globalThis.prompt(", plannerGuardIndex);
    const consentIndex = shareSource.indexOf("studioSharePoseConsentRequest({", promptIndex);
    const captureLeaseIndex = shareSource.indexOf('acquireVrmCaptureOperation("share")', consentIndex);
    const readbackIndex = shareSource.indexOf("const rgba = captureStudioVrmRgba(gl, scene, camera, { width, height });");
    const releaseIndex = shareSource.indexOf("releaseLocalCapture();", readbackIndex);
    const encodeIndex = shareSource.indexOf("await encodeStudioVrmCapturePngDataUrl(", releaseIndex);
    const uploadIndex = shareSource.indexOf("await publishAsset({", releaseIndex);
    const uploadEnd = shareSource.indexOf("}, controller.signal)", uploadIndex);
    const uploadSource = shareSource.slice(uploadIndex, uploadEnd);

    expect(source).toContain("const STUDIO_VRM_SHARE_TIMEOUT_MS = 30_000");
    expect(source).toContain("const sharePoseAbortRef = useRef<AbortController | null>(null)");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("}, controller.signal)");
    // 권리 확인 문구는 파괴/게시 승인 카탈로그가 소유하고, 포저는 그 요청을 거쳐서만
    // 업로드에 진입한다. 문구가 코드에서 사라지면 두 검사 중 하나가 반드시 깨진다.
    expect(shareSource).toContain("const shareLibraryEntry = activeLibraryEntry");
    expect(shareSource).toContain("const shareLicenseAuthority = readStudioVrmAssetLicenseAuthority(currentVrm)");
    expect(shareSource).toContain(
      "readStudioVrmAssetLicenseAuthority(currentVrm) === shareLicenseAuthority",
    );
    expect(shareSource).toContain("const shareUseContextDisclosure = {");
    expect(shareSource).toContain("} satisfies StudioVrmPoseShareUseContextDisclosure;");
    expect(shareSource).toContain(
      "studioVrmPoseShareUseContextConsentRequest(shareUseContextDisclosure)",
    );
    expect(shareSource).toContain("confirmedByUser: true,\n      ...shareUseContextDisclosure,");
    expect(shareSource).toContain('avatarPermissionBasis: "other"');
    expect(shareSource).toContain('publisherKind: "corporation"');
    expect(shareSource).toContain("confirmedAttributionText: shareAttestation.attributionText");
    expect(shareSource).toContain("containsModifiedModel: true");
    expect(shareSource).toContain('excessivelyViolent: "absent"');
    expect(shareSource).toContain('excessivelySexual: "absent"');
    expect(shareSource).toContain('politicalOrReligious: "absent"');
    expect(shareSource).toContain('antisocialOrHate: "absent"');
    expect(shareSource).toContain('shareAlike: "not-satisfied"');
    expect(shareSource).not.toContain("containsViolentContent: false");
    expect(shareSource).not.toContain("containsSexualContent: false");
    expect(shareSource).toContain("STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT");
    expect(disclosureIndex).toBeGreaterThan(-1);
    expect(useContextConsentIndex).toBeGreaterThan(disclosureIndex);
    expect(receiptIndex).toBeGreaterThan(useContextConsentIndex);
    expect(plannerIndex).toBeGreaterThan(receiptIndex);
    expect(plannerGuardIndex).toBeGreaterThan(plannerIndex);
    expect(promptIndex).toBeGreaterThan(plannerGuardIndex);
    expect(consentIndex).toBeGreaterThan(promptIndex);
    expect(captureLeaseIndex).toBeGreaterThan(consentIndex);
    expect(shareSource).toContain("licenseLabel: creatorAssetLicenseOf(sharePlan.license).label");
    expect(shareSource).toContain("attributionText: sharePlan.attributionText");
    expect(destructiveCatalogSource).toContain("방금 확인한 이용 맥락을 기준으로");
    expect(destructiveCatalogSource).toContain("필수 크레딧");
    expect(uploadSource).toContain("license: sharePlan.license");
    expect(uploadSource).toContain("attributionText: sharePlan.attributionText");
    expect(uploadSource).toContain("rightsConfirmed: sharePlan.rightsConfirmed");
    expect(uploadSource).not.toContain('license: "toonspectrum-standard"');
    expect(uploadSource).not.toContain("rightsConfirmed: true");
    expect(shareSource).toContain('containsAi: false');
    expect(shareSource).toContain('tags: ["VRM", "3D 데생 인형", "포즈"]');
    expect(source).not.toContain("preserveDrawingBuffer: true");
    expect(source).not.toContain('gl.domElement.toDataURL("image/png")');
    expect(source).toContain('{isSharingPose ? "공유 취소" : "포즈 서버에 공유"}');
    expect(readbackIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(readbackIndex);
    expect(encodeIndex).toBeGreaterThan(releaseIndex);
    expect(uploadIndex).toBeGreaterThan(encodeIndex);
  });

  it("keeps the share receipt bound to the exact active model and retains authority-only hydration", () => {
    const shareStart = source.indexOf("async function handleSharePoseToServer()");
    const shareEnd = source.indexOf("\n  // Effect Event", shareStart);
    const shareSource = source.slice(shareStart, shareEnd);
    const publishIndex = shareSource.indexOf("await publishAsset({");
    const lastAuthorityCheck = shareSource.lastIndexOf(
      "!shareLicenseAuthorityIsCurrent()",
      publishIndex,
    );
    const hydrationStart = source.indexOf("const handleVisibleVrmThumbnailWindow = useCallback(");
    const hydrationEnd = source.indexOf("\n\n  useEffect(() =>", hydrationStart);
    const hydrationSource = source.slice(hydrationStart, hydrationEnd);

    expect(shareSource).toContain("!shareLibraryEntry.contentHash");
    expect(shareSource).toContain("activeModelIdRef.current === shareLibraryEntry.id");
    expect(shareSource).toContain("modelLoadTargetIdRef.current === shareLibraryEntry.id");
    expect(shareSource).toContain("vrmRef.current === currentVrm");
    expect(shareSource).toContain("currentEntry.source === shareLibraryEntry.source");
    expect(shareSource).toContain("currentEntry.contentHash === shareLibraryEntry.contentHash");
    expect(shareSource).toContain(
      "currentEntry.licenseAuthority === shareLibraryEntry.licenseAuthority",
    );
    expect(shareSource.match(/shareLicenseAuthorityIsCurrent\(\)/gu)?.length ?? 0)
      .toBeGreaterThanOrEqual(5);
    expect(lastAuthorityCheck).toBeGreaterThan(-1);
    expect(lastAuthorityCheck).toBeLessThan(publishIndex);
    expect(hydrationSource).toContain("const visible = hydratedById.get(entry.id)");
    expect(hydrationSource).toContain("if (visible) return visible;");
    expect(hydrationSource).not.toContain(
      "visible.thumbnail === entry.thumbnail ? entry : visible",
    );
  });

  it("shows bounded plain platform-license consent, exact credit, and explicit attestations", () => {
    const ccByCredit = "Pose model · Model Creator · CC_BY";
    const attestationPreview = formatStudioDestructivePreview(
      studioVrmPoseShareUseContextConsentRequest({
        avatarPermissionBasis: "other",
        publisherKind: "corporation",
        confirmedAttributionText: ccByCredit,
        containsModifiedModel: true,
        excessivelyViolent: "absent",
        excessivelySexual: "absent",
        politicalOrReligious: "absent",
        antisocialOrHate: "absent",
        shareAlike: "not-satisfied",
      }),
    );
    expect(attestationPreview).toContain(
      "나는 이 아바타의 저작자도, 별도 이용 허락을 받은 사람도 아닙니다",
    );
    expect(attestationPreview).toContain(
      "ToonSpectrum 플랫폼 게시이며 게시 주체는 법인(corporation)으로 평가됩니다",
    );
    expect(attestationPreview).toContain("현재 렌더에는 개조된 모델 표현이 포함됩니다");
    expect(attestationPreview).toContain("과도한 폭력: 해당하지 않음");
    expect(attestationPreview).toContain("과도한 성적 표현: 해당하지 않음");
    expect(attestationPreview).toContain("정치·종교적 이용: 해당하지 않음");
    expect(attestationPreview).toContain("반사회적·혐오 이용: 해당하지 않음");
    expect(attestationPreview).toContain(
      "별도의 동일조건변경허락(share-alike) 이행을 주장하지 않습니다",
    );
    expect(attestationPreview).toContain(
      `게시할 크레딧(변경 없이 게시): ${ccByCredit}`,
    );
    const ccByPreview = formatStudioDestructivePreview(studioSharePoseConsentRequest({
      poseTitle: "영웅 포즈",
      licenseLabel: "CC BY 4.0",
      attributionText: ccByCredit,
    }));
    expect(ccByPreview).toContain("CC BY 4.0 조건을 검토했습니다");
    expect(ccByPreview).toContain(`필수 크레딧 “${ccByCredit}”을 변경하지 않고`);
    expect(ccByPreview).toContain("개조된 VRM 렌더 포즈");

    const cc0Preview = formatStudioDestructivePreview(
      studioVrmPoseShareUseContextConsentRequest({
        avatarPermissionBasis: "other",
        publisherKind: "corporation",
        confirmedAttributionText: "",
        containsModifiedModel: true,
        excessivelyViolent: "absent",
        excessivelySexual: "absent",
        politicalOrReligious: "absent",
        antisocialOrHate: "absent",
        shareAlike: "not-satisfied",
      }),
    );
    expect(cc0Preview).toContain("별도 크레딧을 요구하지 않습니다");

    const hostilePreview = formatStudioDestructivePreview(
      studioVrmPoseShareUseContextConsentRequest({
        avatarPermissionBasis: "other",
        publisherKind: "corporation",
        confirmedAttributionText: `작가\u0000\n\u202e${"다".repeat(300)}`,
        containsModifiedModel: true,
        excessivelyViolent: "absent",
        excessivelySexual: "absent",
        politicalOrReligious: "absent",
        antisocialOrHate: "absent",
        shareAlike: "not-satisfied",
      }),
    );
    expect(hostilePreview).not.toContain("\n\u202e");
    expect(hostilePreview).not.toContain("\u0000");
    expect(hostilePreview).not.toContain("다".repeat(161));
    expect(Array.from(hostilePreview).length).toBeLessThan(700);
    expect(destructiveCatalogSource).not.toContain(
      "ToonSpectrum 표준 사용권으로 공유할 권한",
    );
  });

  it("cancels stale insert encodes and captures independently of the default framebuffer", () => {
    expect(source).toContain("const insertCaptureAbortRef = useRef<AbortController | null>(null)");
    expect(source).toContain("insertCaptureAbortRef.current?.abort()");
    expect(source).toContain("const rgba = captureStudioVrmRgba(gl, scene, camera, { width, height })");
    expect(source).toContain("signal: captureController.signal");
    expect(source).toContain("captureRef.current.camera !== camera");
    expect(source).toContain("if (insertCaptureAbortRef.current === captureController)");
  });
});
