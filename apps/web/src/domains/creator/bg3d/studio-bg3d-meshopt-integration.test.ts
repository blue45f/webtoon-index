import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { loadVerifiedStudioBg3dGlbWithThree } from "../studio-background-3d-model";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  validateStudioBg3dGlb,
} from "./studio-bg3d-glb-validation";
import { STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS } from "./studio-bg3d-meshopt";
import { createStudioBg3dMeshoptCompressedTriangleGlbFixture } from "./studio-bg3d-meshopt.test-fixture";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

describe("Meshopt verified GLB integration", () => {
  it("validates, decodes, and materializes a real compressed triangle through the production boundary", async () => {
    const bytes = createStudioBg3dMeshoptCompressedTriangleGlbFixture();
    const verification = await validateStudioBg3dGlb(bytes, {
      declared: {
        byteSize: bytes.byteLength,
        sha256: "0".repeat(64),
        mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
      },
      cumulative: { usedBytes: 0, maximumBytes: 100 * 1024 * 1024 },
      profile: "desktop",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      supportedRequiredExtensions: STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS,
      digest: async () => "0".repeat(64),
    });
    expect(verification).toMatchObject({
      ok: true,
      metrics: { triangles: 1, estimatedDecodedGeometryBytes: 36 },
    });
    if (!verification.ok) throw new Error("compressed fixture did not pass verification");

    const loaded = await loadVerifiedStudioBg3dGlbWithThree(
      verification,
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
    );

    expect(loaded).toMatchObject({ ok: true, metrics: { triangles: 1 } });
    if (!loaded.ok) throw new Error("compressed fixture did not load");
    const mesh = loaded.root.getObjectByProperty("isMesh", true) as THREE.Mesh | undefined;
    const positions = mesh?.geometry.getAttribute("position");
    expect(positions?.count).toBe(3);
    expect(Array.from({ length: positions?.count ?? 0 }, (_, index) => [
      positions?.getX(index),
      positions?.getY(index),
      positions?.getZ(index),
    ])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    loaded.dispose();
  });
});
