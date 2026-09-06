
import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();

function handlerBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const brace = source.indexOf("{", start);
  expect(brace).toBeGreaterThan(start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace, i + 1);
    }
  }
  throw new Error(`unclosed handler body for ${signature}`);
}

describe("studio VRM lock-aware pose/expression apply integration boundary", () => {
  it("imports lock-aware pose and expression apply planners", () => {
    expect(poserSource).toContain('from "./studio-vrm-pose-apply"');
    expect(poserSource).toContain('from "./studio-vrm-expression-apply"');
    expect(poserSource).toContain("createStudioVrmPoseApplyPlan");
    expect(poserSource).toContain("createStudioVrmExpressionApplyPlan");
  });

  it("wires pose select through pose apply plan + immediate full-state history", () => {
    const body = handlerBody(poserSource, "function handlePoseSelect(poseId: string)");
    expect(body).toContain("const before = captureFullState()");
    expect(body).toContain("createStudioVrmPoseApplyPlan({");
    expect(body).toContain("incomingBones: strippedBones");
    expect(body).toContain("lockedBones: lockedPoseBones");
    expect(body).toContain("commitStudioVrmFullStateHistoryTransaction(");
    expect(body).toContain("setCustomBones(plan.bones)");
    expect(body).toContain("setFingerEdits(plan.fingerEdits)");
    expect(body).toContain("잠긴 관절 ${plan.skippedLocked.length}개는 유지하고 포즈를 적용했어요.");
  });

  it("wires mirror and straighten through lock-aware pose apply + history", () => {
    const mirrorBody = handlerBody(
      poserSource,
      "function handleMirrorPose(scope: StudioVrmPoseMirrorScope = \"all\")",
    );
    expect(mirrorBody).toContain("createStudioVrmPoseApplyPlan({");
    expect(mirrorBody).toContain("incomingBones: mirroredBones");
    expect(mirrorBody).toContain("incomingFingerEdits: mirroredFingers");
    expect(mirrorBody).toContain("commitStudioVrmFullStateHistoryTransaction(");
    expect(mirrorBody).toContain("mirrorStudioVrmPoseTranslations");
    expect(mirrorBody).toContain("mirrorStudioVrmIkConstraints");

    const straightenBody = handlerBody(
      poserSource,
      "function handleStraightenUpperBody()",
    );
    expect(straightenBody).toContain("createStudioVrmPoseApplyPlan({");
    expect(straightenBody).toContain("incomingBones: straightenedBones");
    expect(straightenBody).toContain("commitStudioVrmFullStateHistoryTransaction(");
  });

  it("wires expression preset select through expression apply plan + history", () => {
    const body = handlerBody(
      poserSource,
      "function handleExpressionPresetSelect(preset: StudioExpressionPreset)",
    );
    expect(body).toContain("const before = captureFullState()");
    expect(body).toContain("createStudioVrmExpressionApplyPlan({");
    expect(body).toContain("incoming: preset.weights");
    expect(body).toContain("commitStudioVrmFullStateHistoryTransaction(");
    expect(body).toContain("expressionId");
    expect(body).toContain("setExpressionWeights(nextWeights)");
    expect(body).toContain("applyExpressionWeightsToVrm");
  });
});
