import { describe, it, expect } from "vitest";

import { Studio3DSpatialWebtoonVrEngine } from "./studio-3d-spatial-webtoon-vr";

describe("Studio3DSpatialWebtoonVrEngine", () => {
  it("generates curved amphitheater layout correctly with smooth arc angles", () => {
    const vrEngine = new Studio3DSpatialWebtoonVrEngine("curved-amphitheater");
    const panels = vrEngine.generateLayout(5);

    expect(panels.length).toBe(5);
    expect(panels[0].position[2]).toBeLessThan(0); // Forward in VR space
    expect(panels[2].position[0]).toBeCloseTo(0, 1); // Center panel at x ~ 0
    expect(panels[0].curvatureDeg).toBe(12);
  });

  it("generates descending vertical spiral tunnel layout for scroll webtoons", () => {
    const vrEngine = new Studio3DSpatialWebtoonVrEngine("vertical-tunnel");
    const panels = vrEngine.generateLayout(4);

    expect(panels.length).toBe(4);
    // Y coordinates should descend monotonically
    expect(panels[0].position[1]).toBeGreaterThan(panels[1].position[1]);
    expect(panels[1].position[1]).toBeGreaterThan(panels[2].position[1]);
    expect(panels[2].position[1]).toBeGreaterThan(panels[3].position[1]);
  });

  it("calculates parabolic teleportation arc hitting the floor", () => {
    const vrEngine = new Studio3DSpatialWebtoonVrEngine();
    // Aiming slightly downward-forward from 1.2m hand height
    const arc = vrEngine.calculateTeleportArc([0, 1.2, 0], [0, -0.2, -0.98], 6.0);

    expect(arc.isValidHit).toBe(true);
    expect(arc.hitPosition[1]).toBe(0); // Hit ground plane
    expect(arc.hitPosition[2]).toBeLessThan(0); // In front of user
    expect(arc.trajectoryPoints.length).toBeGreaterThan(5);
  });

  it("handles snap turn and comfort vignetting", () => {
    const vrEngine = new Studio3DSpatialWebtoonVrEngine("curved-amphitheater", {
      snapTurnStepDeg: 45,
      comfortVignetteEnabled: true,
    });

    vrEngine.performSnapTurn(1); // Turn right by +45 deg
    expect(vrEngine.getViewer().headRotationEulerDeg[1]).toBe(45);
    expect(vrEngine.getViewer().comfortVignetteIntensity).toBeGreaterThan(0);
  });

  it("calculates comfortable focus viewing pose directly facing any panel", () => {
    const vrEngine = new Studio3DSpatialWebtoonVrEngine("curved-amphitheater");
    vrEngine.generateLayout(3);

    const focusPose = vrEngine.getFocusPoseForPanel(0);
    expect(focusPose.standingPosition[1]).toBe(0);
    expect(focusPose.lookAtTarget).toEqual(vrEngine.getPanels()[0].position);
  });
});
