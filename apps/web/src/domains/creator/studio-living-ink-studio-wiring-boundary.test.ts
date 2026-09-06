import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();

describe("Living Ink Studio wiring boundary", () => {
  it("revokes a loading coordinator when explicit physical mode is turned off", () => {
    const start = studioPageSource.indexOf("if (!livingInkPhysicalModeEnabled)");
    const end = studioPageSource.indexOf("const freshPlan =", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const disabledBranch = studioPageSource.slice(start, end);
    expect(disabledBranch).toContain("livingInkAuthorityVerificationAbortRef.current?.abort();");
    expect(disabledBranch).toContain("void livingInkCoordinatorRef.current.dispose();");
    expect(disabledBranch).toContain('setLivingInkState("unavailable")');
    expect(disabledBranch).not.toContain("verifyStudioLivingInkCanonicalImageAuthority");
    expect(disabledBranch).not.toContain("livingInkCoordinatorRef.current.activate");
  });

  it("uses the same effective scope for pointer admission, actions, and displayed controls", () => {
    const pointerStart = studioPageSource.indexOf("function beginStudioLivingInkStroke");
    const pointerEnd = studioPageSource.indexOf(
      "function appendStudioLivingInkAuthoritativeSuffix",
      pointerStart,
    );
    const actionStart = studioPageSource.indexOf("async function applyStudioLivingInkAction");
    const actionEnd = studioPageSource.indexOf("function applyStudioLivingInkFix", actionStart);
    expect(pointerStart).toBeGreaterThan(-1);
    expect(pointerEnd).toBeGreaterThan(pointerStart);
    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);

    const pointer = studioPageSource.slice(pointerStart, pointerEnd);
    const action = studioPageSource.slice(actionStart, actionEnd);
    expect(pointer).toContain("studioLivingInkEffectiveScope(");
    expect(action).toContain("studioLivingInkEffectiveScope(");
    expect(action).toContain("scope,");
    expect(action).not.toContain("scope: livingInkScope");
    expect(studioPageSource).toContain("scope: livingInkEffectiveScope,");
  });

  it("returns to an unselected, whole-layer drawing context after canonical handoff", () => {
    const start = studioPageSource.indexOf("async function finishStudioLivingInkStroke");
    const end = studioPageSource.indexOf("async function finishStudioHokusaiLiveStroke", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const handoff = studioPageSource.slice(start, end);
    expect(handoff).toContain("setSelectedId(null);");
    expect(handoff).toContain('setLivingInkScope("all");');
    expect(handoff).not.toContain("setSelectedId(transaction.transaction.selectionId)");
  });
});
