import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS,
  STUDIO_BG3D_KTX2_EXTENSION,
  STUDIO_BG3D_MESHOPT_EXTENSION,
  resolveStudioBg3dMeshoptWorkerCount,
} from "./studio-bg3d-meshopt";

describe("studio-bg3d-meshopt", () => {
  it("exposes the immutable required-extension allowlist implemented by the viewport", () => {
    expect(STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS).toEqual([
      STUDIO_BG3D_MESHOPT_EXTENSION,
      STUDIO_BG3D_KTX2_EXTENSION,
    ]);
    expect(Object.isFrozen(STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS)).toBe(true);
  });

  it("bounds decoder workers by capability and logical CPU availability", () => {
    expect(resolveStudioBg3dMeshoptWorkerCount({
      hardwareConcurrency: 16,
      workerAvailable: true,
      blobWorkerAvailable: true,
    })).toBe(2);
    expect(resolveStudioBg3dMeshoptWorkerCount({
      hardwareConcurrency: 4,
      workerAvailable: true,
      blobWorkerAvailable: true,
    })).toBe(1);
    expect(resolveStudioBg3dMeshoptWorkerCount({
      hardwareConcurrency: 2,
      workerAvailable: true,
      blobWorkerAvailable: true,
    })).toBe(0);
    expect(resolveStudioBg3dMeshoptWorkerCount({
      hardwareConcurrency: 16,
      workerAvailable: false,
      blobWorkerAvailable: true,
    })).toBe(0);
    expect(resolveStudioBg3dMeshoptWorkerCount({
      hardwareConcurrency: Number.NaN,
      workerAvailable: true,
      blobWorkerAvailable: true,
    })).toBe(0);
  });
});
