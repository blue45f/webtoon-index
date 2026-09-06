import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const source = [
  readFileSync(new URL("./StudioVrmPoserTypes.ts", import.meta.url), "utf8"),
  readStudioVrmPoserImplementationSource(),
].join("\n");

describe("Studio VRM full-body editor integration boundary", () => {
  it("invalidates an active IK transaction before history restore and stale pointer release", () => {
    const restoreStart = source.indexOf("const restoreHistoryStep =");
    const cancel = source.indexOf("cancelJointIkTransaction({", restoreStart);
    const restore = source.indexOf("commitFullStateRestore(snap, currentVrm, {", restoreStart);

    expect(restoreStart).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(restoreStart);
    expect(restore).toBeGreaterThan(cancel);
    expect(source.slice(restore, restore + 160)).toContain("trustPersistentIkPose: true");
    expect(source).toContain("transaction.revision !== jointIkRevisionRef.current");
    expect(source).toContain('key={`${jointHandleSessionGeneration}:${proportionRigRevision}`}');
    expect(source).toContain("jointIkTransactionRef.current = null;");
  });

  it("keeps full-body translations in custom pose save, copy, select, and paste paths", () => {
    expect(source).toContain(
      "poseTranslations: cloneStudioVrmPoseTranslations(poseTranslations),",
    );
    expect(source).toContain(
      "normalizeStudioVrmPoseTranslations(pose.poseTranslations)",
    );
    expect(source).toContain(
      "normalizeStudioVrmPoseTranslations(parsed.poseTranslations)",
    );
    expect(source).toContain("poseTranslations: nextTranslations,");
    expect(source).toContain("pastedTranslations,");
  });

  it("commits locked-pin commands only after reconciliation and never records the unresolved pose", () => {
    expect(source).toContain("type PendingStudioVrmPersistentIkCommand = {");
    expect(source.match(/pendingPersistentIkCommandRef\.current = \{/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("candidateAfter: after,");
    expect(source).toContain("commitPendingCommand(serializeFullVrmState({");
    expect(source).toContain("...pending.candidateAfter,");
    expect(source).toContain("pendingPersistentIkCommandRef.current.inputSignature !== inputSignature");

    const historyEffect = source.indexOf("// 편집이 멈추면(디바운스)");
    const pendingGuard = source.indexOf("pendingPersistentIkCommandRef.current", historyEffect);
    const append = source.indexOf("appendStudioVrmFullStateHistory(", historyEffect);
    expect(historyEffect).toBeGreaterThan(-1);
    expect(pendingGuard).toBeGreaterThan(historyEffect);
    expect(append).toBeGreaterThan(pendingGuard);
  });

  it("retries after the Canvas scene mounts and preserves one body rotation field on shared restore", () => {
    expect(source).toContain("setCaptureSceneGeneration((generation: number) => generation + 1)");
    expect(source).toContain("captureSceneGeneration,");
    expect(source).toContain("bodyRotation: initialScene.pose.bodyRotationY,");
    expect(source).not.toContain("pending.bodyRotationY");
    expect(source).toContain("forceInvalidate: true,");
  });

  it("aborts deferred insert/share capture when the persistent pose changes before readback", () => {
    expect(source).toContain(
      "const sharePoseSignature = persistentIkCurrentSignatureRef.current;",
    );
    expect(source).toContain("const capturePoseSignature = currentPersistentIkSignature();");
    expect(source).toContain(
      "persistentIkCurrentSignatureRef.current !== sharePoseSignature",
    );
    expect(source).toContain(
      "persistentIkCurrentSignatureRef.current === capturePoseSignature",
    );
    expect(source).toContain("capturePreconditionsAreCurrent()");
    expect(source).toContain("pendingPersistentIkCommandRef.current !== null");
    expect(source).toContain("if (webcamActive || idleAnimation) {");
    expect(source).toContain("webcamActiveRef.current || idleAnimationRef.current");
    expect(source).toContain("&& !webcamActiveRef.current");
    expect(source).toContain("&& !idleAnimationRef.current");
    expect(source).toContain("dynamicPoseGenerationRef.current !== shareDynamicPoseGeneration");
    expect(source).toContain("dynamicPoseGenerationRef.current === captureDynamicPoseGeneration");
  });
});
