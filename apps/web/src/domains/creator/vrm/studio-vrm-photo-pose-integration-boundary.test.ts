import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();
const scannerSource = readFileSync(
  new URL("./StudioVrmPhotoPoseScanner.tsx", import.meta.url),
  "utf8",
);

describe("studio VRM photo pose + hand integration boundary", () => {
  it("keeps candidate analysis side-effect free until the explicit apply callback", () => {
    expect(scannerSource).toContain("setCandidate({");
    expect(scannerSource).toContain("const applied = onApply({");
    expect(scannerSource).toContain("if (applied) setCandidate(null)");
    expect(scannerSource).not.toContain("setCustomBones");
    expect(scannerSource).not.toContain("setFingerEdits");
  });

  it("commits body and manual fingers as one full-state transaction", () => {
    expect(poserSource).toContain("createStudioVrmPhotoPoseApplyPlan({");
    expect(poserSource).toContain("fingerOverrides: plan.fingerEdits");
    expect(poserSource).toContain("commitStudioVrmFullStateHistoryTransaction(");
    expect(poserSource).toContain("setCustomBones(plan.bones)");
    expect(poserSource).toContain("setFingerEdits(plan.fingerEdits)");
    expect(poserSource).toContain("resolveStudioVrmFingerAuthority(");
    expect(poserSource).toContain("fingerEdits: nextEffectiveFingers");
  });

  it("routes locked persistent IK through the existing deferred authoritative command", () => {
    expect(poserSource).toContain("candidateAfter: after");
    expect(poserSource).toContain("inputSignature: candidateSignature");
    expect(poserSource).toContain("historyGeneration: fullStateHistoryRef.current.generation");
    expect(poserSource).toContain("setPersistentIkReconciling(true)");
  });
});
