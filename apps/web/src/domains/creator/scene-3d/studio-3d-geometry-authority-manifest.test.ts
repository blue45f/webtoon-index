import { describe, it, expect } from "vitest";

import { evaluateFormatCompatibility } from "./studio-3d-geometry-authority-manifest";

describe("evaluateFormatCompatibility", () => {
  it("evaluates glTF/GLB grade A compatibility", () => {
    const report = evaluateFormatCompatibility("glb");
    expect(report.grade).toBe("A");
    expect(report.preservedFeatures).toContain("PBR Materials");
    expect(report.preservedFeatures).toContain("Skinning");
  });

  it("evaluates VRM grade A compatibility with rights warning", () => {
    const report = evaluateFormatCompatibility("vrm");
    expect(report.grade).toBe("A");
    expect(report.preservedFeatures).toContain("Humanoid Bone Mapping");
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("evaluates STEP B-Rep CAD compatibility", () => {
    const report = evaluateFormatCompatibility("step");
    expect(report.grade).toBe("A");
    expect(report.preservedFeatures).toContain("Exact B-Rep Surfaces");
    expect(report.bakedFeatures).toContain("Tessellated Render Mesh");
  });

  it("evaluates proprietary SKP/BLEND bridge requirements", () => {
    const skp = evaluateFormatCompatibility("skp");
    expect(skp.grade).toBe("C");
    expect(skp.warnings[0]).toContain("bridge plugin");

    const blend = evaluateFormatCompatibility("blend");
    expect(blend.grade).toBe("C");
    expect(blend.warnings[0]).toContain("Blender Add-on Bridge");
  });
});
