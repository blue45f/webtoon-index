import { describe, it, expect } from "vitest";

import { Studio3DCameraPerspectiveLens } from "./studio-3d-camera-perspective-lens";

describe("Studio3DCameraPerspectiveLens", () => {
  it("evaluates optical parameters for 12mm ultra-wide vs 200mm telephoto", () => {
    const lens = new Studio3DCameraPerspectiveLens();
    const ultraWide = lens.evaluateLensParameters("12mm-ultra-wide-fisheye");
    expect(ultraWide.fovDeg).toBeGreaterThan(120);
    expect(ultraWide.distortionCoeff).toBeLessThan(0); // Barrel distortion

    const telephoto = lens.evaluateLensParameters("200mm-telephoto-compression");
    expect(telephoto.fovDeg).toBeLessThan(15);
    expect(telephoto.distortionCoeff).toBeGreaterThan(0); // Pincushion compression
  });

  it("applies comic dynamic foreshortening on vertices close to camera", () => {
    const lens = new Studio3DCameraPerspectiveLens();
    lens.setForeshorteningFactor(2.5);

    const cameraPos = [0, 0, 0] as const;
    // Vertex at 0.5m (close fist) with reference distance 2.0m
    const closeFist = [0.2, 0.2, 0.5] as const;
    const foreshortened = lens.evaluateForeshortenedVertex(closeFist, cameraPos, 2.0);

    expect(foreshortened[0]).toBeGreaterThan(closeFist[0]); // Radial expansion in X
    expect(foreshortened[1]).toBeGreaterThan(closeFist[1]); // Radial expansion in Y
  });

  it("generates 2D vanishing points and guide lines for 2-point and 3-point modes", () => {
    const lens = new Studio3DCameraPerspectiveLens();
    lens.setGuideMode("2-point");

    const guides2P = lens.evaluatePerspectiveGuides(800, 1200, 45, -10);
    expect(guides2P.vanishingPoints.length).toBe(2);
    expect(guides2P.guideLines.length).toBe(12);

    lens.setGuideMode("3-point");
    const guides3P = lens.evaluatePerspectiveGuides(800, 1200, 45, -10);
    expect(guides3P.vanishingPoints.length).toBe(3);
    expect(guides3P.guideLines.length).toBe(18);
  });
});
