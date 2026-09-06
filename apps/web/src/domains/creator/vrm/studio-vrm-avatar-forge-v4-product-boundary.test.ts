import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poser = readStudioVrmPoserImplementationSource();
// 2026-08-21 의도적 변경: 모델 로딩·라이브러리 파일 처리(beginModelLoad/loadModelFrom*/
// handleFileChange/handleDeleteEntry 등)가 StudioVrmPoser.tsx에서
// use-studio-vrm-model-loading.ts(포저가 소유하는 훅)로 분리됐다. 마커만 새 모듈로
// 옮기고 검증 대상은 그대로 유지한다.
const modelLoading = readFileSync(
  new URL("./use-studio-vrm-model-loading.ts", import.meta.url),
  "utf8",
);
const forge = readFileSync(new URL("./StudioVrmAvatarForge.tsx", import.meta.url), "utf8");
const projection = readFileSync(
  new URL("./StudioVrmWardrobePropsProjection.tsx", import.meta.url),
  "utf8",
);
const proportionFit = readFileSync(
  new URL("./studio-vrm-proportion-fit-transaction.ts", import.meta.url),
  "utf8",
);

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing source boundary: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("Avatar Forge v4 product integration boundary", () => {
  it("removes the legacy raw-body effect and delegates face scale to a rebuild-safe controller", () => {
    expect(forge).not.toContain("applyAvatarForgeBodyProportions");
    expect(forge).not.toContain("buildAvatarForgeBodyAdjustmentPlan");
    expect(forge).toContain("faceController.replace({");
    expect(forge).toContain("rigRevision,");
    expect(forge).toContain("useLayoutEffect(() => {");
  });

  it("creates the rig authority before pose restore and measures fit before reapplying pose", () => {
    const install = section(poser, "function installVrm(", "function handlePoseSelect(");
    expect(install.indexOf("initializeProportionRigRuntime(nextVrm);")).toBeLessThan(
      install.indexOf("const pending = pendingPoseDataRef.current;"),
    );

    expect(proportionFit.indexOf("measureStudioVrmWardrobeMetrics(vrm)")).toBeLessThan(
      proportionFit.indexOf("return reapplyAuthoredState();"),
    );
    expect(proportionFit.indexOf("measureVrmPropRigMetrics(vrm)")).toBeLessThan(
      proportionFit.indexOf("return reapplyAuthoredState();"),
    );
    expect(poser).toContain("createStudioVrmProportionFitTransaction(vrm, () => {");

    const apply = section(poser, "function applyProportionRigState(", "function clearCurrentVrm(");
    expect(apply.indexOf("avatarForgeFaceController.release();")).toBeLessThan(
      apply.indexOf("runtime.apply(proportions)"),
    );
    expect(apply).toContain("setWardrobeSurfaceReceipts({});");
    expect(apply).toContain("setWardrobeMetrics(measurements.wardrobe);");
    expect(apply).toContain("setPropRigMetrics(measurements.props ?? DEFAULT_VRM_PROP_RIG_METRICS);");
    expect(apply).toContain("if (!reloadRequired) {");
    expect(apply).not.toContain('if (!reloadRequired && result.recovery === "restored")');
  });

  it("rebinds every normalized-rig consumer and keeps one authorable body authority", () => {
    expect(poser).toContain("rigRevision={proportionRigRevision}");
    expect(poser).toContain('key={`${jointHandleSessionGeneration}:${proportionRigRevision}`}');
    expect(poser).toContain('key={`${proportionRigRevision}:${item.uid}`}');
    expect(poser).toContain('key={`${proportionRigRevision}:${slot}`}');
    expect(projection).toContain("[instance.bone, rigRevision, vrm]");
    expect(poser).not.toContain('aria-label="캐릭터 키 비율"');
    expect(poser).not.toContain('aria-label="캐릭터 체격 비율"');
    expect(poser).toContain("이전 문서의 장면 배율");
    expect(poser).toContain("새 체형 편집으로 전환");
  });

  it("fails capture closed on stale or unrecoverable proportion authority", () => {
    const insert = section(poser, "function handleInsert()", "if (!open) return null;");
    const forgeChange = section(poser, "function handleAvatarForgeChange(", "const onCaptureUpdate");
    expect(insert).toContain('proportionRigStatus === "reload-required"');
    expect(insert).toContain("proportionRigReceiptRef.current === captureProportionRigReceipt");
    expect(poser).toContain("proportionRigCaptureIsReady");
    expect(poser).toContain("proportionMetrics={proportionRigReceipt?.metrics ?? null}");
    expect(poser).toContain("눈 랜드마크 기반 모델 추정");
    expect(poser).toContain("모델 경계 기반 추정");
    expect(poser).toContain("avatarForgeFaceCaptureIsReady");
    expect(poser).toContain("captureVisualAuthorityRef.current = Object.freeze({");
    expect(poser).toContain("const shareFullState = shareVisualAuthority.fullState;");
    expect(poser).toContain(
      "const shareWardrobeState = parseWardrobeDocument(shareFullState.wardrobe).slots;",
    );
    expect(poser).toContain("const equip = shareWardrobeState[slot];");
    expect(poser).toContain("captureVisualAuthorityRef.current?.identity === shareVisualAuthority.identity");
    expect(poser).toContain("captureVisualAuthorityRef.current?.identity === captureVisualAuthority.identity");
    expect(poser).toContain("readVrmCaptureCameraIdentity() === shareCameraIdentity");
    expect(poser).toContain("readVrmCaptureCameraIdentity() === captureCameraIdentity");
    expect(insert).toContain("...captureVisualAuthority.fullState,");
    expect(poser).toContain("...shareFullState,");
    expect(poser).toContain("lightingTone,");
    expect(poser).toContain("setLightingTone(plan.lightingTone);");
    expect(poser).toContain("lightingTone: initialScene.lightingTone,");
    expect(poser).toContain("avatarForgeAuthorityIdentityRef.current !== shareAvatarForgeIdentity");
    expect(poser).toContain("avatarForgeFaceController.getSnapshot() !== shareFaceControllerSnapshot");
    expect(poser).toContain("avatarForgeAuthorityIdentityRef.current !== thumbnailAvatarForgeIdentity");
    expect(insert).toContain("avatarForgeAuthorityIdentityRef.current === captureAvatarForgeIdentity");
    expect(insert).toContain("avatarForgeFaceController.getSnapshot() === captureFaceControllerSnapshot");
    expect(forgeChange).toContain("isCapturing");
    expect(forgeChange).toContain("isSharingPose");
    expect(forgeChange).toContain("isThumbnailCapturing");
    expect(forgeChange).toContain('proportionRigStatus === "reload-required"');
  });

  it("freezes the camera and rejects live animation while any raster capture owns the viewport", () => {
    const share = section(
      poser,
      "async function handleSharePoseToServer()",
      "// Effect Event so the dispose runs on true unmount only.",
    );
    const insert = section(poser, "function handleInsert()", "if (!open) return null;");

    expect(poser).toContain(
      "const viewportCameraInteractionLocked =\n    isCapturing || isSharingPose || isThumbnailCapturing;",
    );
    expect(poser).toContain("&& !viewportCameraInteractionLocked");
    expect(poser).toContain("if (captureOperationRef.current !== null) return;");
    expect(share).toContain("if (webcamActive || idleAnimation) {");
    expect(share).toContain("webcamActiveRef.current || idleAnimationRef.current");
    expect(insert).toContain("if (webcamActive || idleAnimation) {");
    expect(insert).toContain("&& !webcamActiveRef.current");
    expect(insert).toContain("&& !idleAnimationRef.current");
    expect(poser).toContain("|| (!isSharingPose && (");
  });

  it("refuses a saved non-neutral silhouette when the model has no proportion runtime", () => {
    const restore = section(poser, "function commitFullStateRestore(", "const loadHandlers =");
    const apply = section(poser, "function applyProportionRigState(", "function clearCurrentVrm(");
    expect(restore).toContain("const requiresProportionRuntime = studioVrmProportionsRequireRuntime(");
    expect(restore).toContain("&& (hadProportionRuntime || requiresProportionRuntime)");
    expect(restore).toContain("저장된 관절 비율을 안전하게 재생할 수 없어 복원을 중단했습니다.");
    expect(restore).toContain('if (proportionOutcome === "recovered" && rollbackTransaction)');
    expect(restore).toContain("const reapplied = rollbackTransaction.reapply();");
    expect(restore).toContain('setProportionRigStatus("reload-required");');
    expect(apply).toContain("if (!studioVrmProportionValuesRequireRuntime(proportions)) {");
    expect(apply).toContain("transaction.reapply();");
  });

  it("moves undo and redo history only after the rig transaction commits", () => {
    const restoreHistory = section(
      poser,
      "const restoreHistoryStep = (direction: -1 | 1) => {",
      "const doUndo = () => {",
    );
    const restoreCall = restoreHistory.indexOf("const restored = h.commitFullStateRestore(");
    const rejection = restoreHistory.indexOf("if (!restored) {");
    const cursorCommit = restoreHistory.lastIndexOf(
      "fullStateHistoryRef.current = transition.history;",
    );

    expect(restoreCall).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(restoreCall);
    expect(restoreHistory.slice(rejection, cursorCommit)).toContain(
      "isRestoringRef.current = false;",
    );
    expect(cursorCommit).toBeGreaterThan(rejection);
  });

  it("serializes insert, thumbnail, and share readbacks through one capture owner", () => {
    const share = section(
      poser,
      "async function handleSharePoseToServer()",
      "// Effect Event so the dispose runs on true unmount only.",
    );
    const thumbnail = section(
      poser,
      "useEffect(() => {\n    if (\n      !open\n      || status !== \"ready\"",
      "function initializeProportionRigRuntime(",
    );
    const insert = section(poser, "function handleInsert()", "if (!open) return null;");

    expect(poser).toContain("const captureOperationRef = useRef<");
    expect(share).toContain('acquireVrmCaptureOperation("share")');
    expect(share).toContain('releaseVrmCaptureOperation("share")');
    expect(thumbnail).toContain('acquireVrmCaptureOperation("thumbnail")');
    expect(thumbnail).toContain('releaseVrmCaptureOperation("thumbnail")');
    expect(insert).toContain('acquireVrmCaptureOperation("insert")');
    expect(insert).toContain('releaseVrmCaptureOperation("insert")');
  });

  it("starts a newly selected model from identity scene scale instead of inheriting legacy scale", () => {
    const install = section(poser, "function installVrm(", "function handlePoseSelect(");
    const restore = section(poser, "function commitFullStateRestore(", "const loadHandlers =");
    expect(install).toContain("const freshBodyScale: BodyScale = { height: 1, width: 1 };");
    expect(install).toContain("setBodyScale(freshBodyScale);");
    expect(install).toContain("bodyScale: freshBodyScale,");
    expect(install).toContain("installingModel: true,");
    expect(install).toContain("const freshProportionOutcome = applyProportionRigState(");
    expect(install).toContain('freshProportionOutcome !== "committed"');
    expect(install).toContain('freshProportionOutcome !== "unavailable"');
    expect(install.indexOf("if (!restored) {")).toBeLessThan(
      install.indexOf("clearCurrentVrm();", install.indexOf("if (!restored) {")),
    );
    expect(restore).toContain(
      "options.installingModel ? { height: 1, width: 1 } : bodyScale",
    );
    expect(restore).toContain(
      "if (plan.bodyScale || options.installingModel) setBodyScale(restoredBodyScale);",
    );
    expect(restore).toContain("bodyScale: restoredBodyScale,");
    expect(restore).toContain("} else if (options.installingModel) {\n      setLighting(");
    expect(restore).toContain('} else if (options.installingModel) {\n      setEnvVariant("none");');
  });

  it("publishes a model atomically and preserves pending scene data until final success", () => {
    const install = section(poser, "function installVrm(", "function handlePoseSelect(");
    const urlLoad = section(modelLoading, "function loadModelFromUrl(", "function loadModelFromLibraryEntry(");
    const finalRepair = install.lastIndexOf("repairVrmTexturedNearBlackLitFactors(nextVrm);");
    const pendingCommit = install.indexOf("pendingPoseDataRef.current = null;");

    expect(install).toContain("const wasPublished = vrmRef.current === nextVrm;");
    expect(install).toContain("clearCurrentVrm();\n      if (!wasPublished) disposeVrm(nextVrm);");
    expect(pendingCommit).toBeGreaterThan(finalRepair);
    expect(urlLoad).not.toContain(
      "catch (installError: unknown) {\n          disposeVrm(loadedVrm);",
    );
    expect(install).toContain("const committedVrmGeneration = vrmInstallGenerationRef.current;");
    expect(install).toContain("pendingCameraRestoreFrameRef.current !== frame");
    expect(install).toContain("vrmRef.current !== nextVrm");
    expect(install).toContain(
      "vrmInstallGenerationRef.current !== committedVrmGeneration",
    );
  });
});
