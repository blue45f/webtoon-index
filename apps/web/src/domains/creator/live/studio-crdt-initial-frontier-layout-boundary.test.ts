import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const source = readStudioPageCompositionSource();

describe("Studio initial CRDT frontier layout boundary", () => {
  it("projects the authoritative frontier before the first editable canvas paint", () => {
    const applyFrontierIndex = source.indexOf("const applyFrontier = (");
    expect(applyFrontierIndex).toBeGreaterThan(-1);

    const hookPrefix = source.slice(Math.max(0, applyFrontierIndex - 220), applyFrontierIndex);
    expect(hookPrefix).toContain("useLayoutEffect(() => {");
    expect(hookPrefix).not.toContain("useEffect(() => {");

    const nextLayoutEffectIndex = source.indexOf(
      "\n  useLayoutEffect(() => {",
      applyFrontierIndex,
    );
    expect(nextLayoutEffectIndex).toBeGreaterThan(applyFrontierIndex);
    const reconciliationEffect = source.slice(applyFrontierIndex, nextLayoutEffectIndex);
    expect(reconciliationEffect).toContain("applyFrontier({");
    expect(reconciliationEffect).toContain(
      "setStudioCrdtReconciledDocument(studioCrdtDocument)",
    );
  });
});
