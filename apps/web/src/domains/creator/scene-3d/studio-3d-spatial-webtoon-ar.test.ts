import { describe, it, expect } from "vitest";

import { Studio3DSpatialWebtoonArEngine } from "./studio-3d-spatial-webtoon-ar";

describe("Studio3DSpatialWebtoonArEngine", () => {
  it("initializes with tabletop diorama anchor and default light estimation", () => {
    const arEngine = new Studio3DSpatialWebtoonArEngine();
    expect(arEngine.getAnchor().orientation).toBe("horizontal-table");
    expect(arEngine.getAnchor().scale).toBe(0.1); // 1:10 diorama scale
    expect(arEngine.getLighting().intensityLumens).toBe(1000);
  });

  it("transforms 3D stage points into AR anchor world space accurately", () => {
    const arEngine = new Studio3DSpatialWebtoonArEngine({
      position: [1.0, 0.5, -2.0],
      scale: 0.2, // 1:5 scale
      rotationEulerDeg: [0, 0, 0],
    });

    // Stage origin [0, 0, 0] should map directly to anchor position
    const origin = arEngine.transformPointToArWorld([0, 0, 0]);
    expect(origin[0]).toBeCloseTo(1.0, 4);
    expect(origin[1]).toBeCloseTo(0.5, 4);
    expect(origin[2]).toBeCloseTo(-2.0, 4);

    // Stage point [10, 5, 0] scaled by 0.2 -> [2, 1, 0] + [1.0, 0.5, -2.0] -> [3.0, 1.5, -2.0]
    const transformed = arEngine.transformPointToArWorld([10, 5, 0]);
    expect(transformed[0]).toBeCloseTo(3.0, 4);
    expect(transformed[1]).toBeCloseTo(1.5, 4);
    expect(transformed[2]).toBeCloseTo(-2.0, 4);
  });

  it("generates shadow catcher ground geometry buffers", () => {
    const arEngine = new Studio3DSpatialWebtoonArEngine({
      position: [0, 0, 0],
      scale: 0.1,
    });

    const shadowMesh = arEngine.generateShadowCatcherBuffer();
    expect(shadowMesh.positions.length).toBe(12); // 4 vertices * 3
    expect(shadowMesh.uvs.length).toBe(8); // 4 vertices * 2
    expect(shadowMesh.indices.length).toBe(6); // 2 triangles * 3
  });

  it("creates USDZ QuickLook manifest with active scale parameters", () => {
    const arEngine = new Studio3DSpatialWebtoonArEngine({ scale: 0.05 });
    const manifest = arEngine.createUsdzQuickLookManifest("에피소드 1화 입체 디오라마", "blob:https://test");

    expect(manifest.title).toBe("에피소드 1화 입체 디오라마");
    expect(manifest.canonicalScale).toBe(0.05);
    expect(manifest.allowsContentScaling).toBe(true);
  });
});
