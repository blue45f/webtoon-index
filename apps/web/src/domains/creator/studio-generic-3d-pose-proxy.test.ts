import { describe, expect, it } from "vitest";

import { createStudioGeneric3dGlbManifest } from "./studio-generic-3d-model-mode";
import {
  createStudioGeneric3dPoseProxies,
  createStudioGeneric3dProxyTransformCommand,
} from "./studio-generic-3d-pose-proxy";

import type { StudioBg3dGlbValidationSuccess } from "./bg3d/studio-bg3d-glb-validation";

function validation(patch: Partial<StudioBg3dGlbValidationSuccess["metrics"]> = {}): StudioBg3dGlbValidationSuccess {
  const metrics = {
    byteSize: 4_096,
    jsonByteSize: 512,
    binByteSize: 3_564,
    nodes: 1,
    meshes: 1,
    meshPrimitives: 1,
    drawCalls: 1,
    triangles: 12,
    materials: 1,
    textures: 0,
    images: 0,
    imageBytes: 0,
    estimatedDecodedImageBytes: 0,
    maxImageDimension: 0,
    undeterminedImageDimensions: 0,
    lights: 0,
    animations: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    skins: 0,
    joints: 0,
    morphTargets: 0,
    accessorElements: 36,
    estimatedDecodedGeometryBytes: 1_024,
    ...patch,
  };
  return {
    ok: true,
    code: "valid",
    message: "검증 완료",
    profile: "desktop",
    verifiedSha256: `sha256:${"b".repeat(64)}`,
    verifiedBytes: new Uint8Array(metrics.byteSize),
    cumulativeBytesAfter: metrics.byteSize,
    usesBasisTextures: false,
    requiresBasisTextures: false,
    metrics,
  };
}

describe("generic 3D pose proxy plan", () => {
  it("always exposes a root transform and honest guide-only proxies for a monolithic static mesh", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "chair.glb",
      validation: validation(),
    });
    const proxies = createStudioGeneric3dPoseProxies({ manifest });

    expect(proxies[0]).toMatchObject({
      role: "root",
      operation: "root-transform",
      canApply: true,
    });
    expect(proxies.find((item) => item.role === "head")).toMatchObject({
      kind: "guide",
      operation: "guide-only",
      canApply: false,
      deformsMesh: false,
    });

    const rootCommand = createStudioGeneric3dProxyTransformCommand({
      proxy: proxies[0]!,
      transform: {
        translation: [1, 2, 3],
        rotationDegrees: [10, 20, 30],
        scale: [2, 2, 2],
      },
    });
    expect(rootCommand).toMatchObject({
      target: "model-root",
      translation: [1, 2, 3],
      scale: [2, 2, 2],
    });
    expect(createStudioGeneric3dProxyTransformCommand({
      proxy: proxies.find((item) => item.role === "head")!,
      transform: {
        translation: [1, 2, 3],
        rotationDegrees: [10, 20, 30],
        scale: [2, 2, 2],
      },
    })).toBeNull();
  });

  it("maps separately renderable static nodes to cautious part transforms", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "segmented-character.glb",
      validation: validation({ nodes: 4, meshes: 4 }),
      parts: 4,
    });
    const proxies = createStudioGeneric3dPoseProxies({
      manifest,
      nodes: [
        { key: "body", name: "Body", hasRenderable: true },
        { key: "left-arm", name: "Left Arm", hasRenderable: true },
        { key: "right-arm", name: "Right Arm", hasRenderable: true },
        { key: "bag", name: "Bag", hasRenderable: true },
      ],
    });
    const leftArm = proxies.find((item) => item.role === "left-arm")!;
    const bag = proxies.find((item) => item.targetKey === "bag")!;

    expect(leftArm).toMatchObject({
      kind: "node",
      operation: "node-transform",
      targetKey: "left-arm",
      canApply: true,
      deformsMesh: false,
    });
    expect(bag.role).toBe("custom");
    expect(createStudioGeneric3dProxyTransformCommand({
      proxy: leftArm,
      transform: {
        translation: [0.25, 0, 0],
        rotationDegrees: [0, 25, 0],
        scale: [1, 1, 1],
      },
    })).toMatchObject({ target: "node", targetKey: "left-arm" });
  });

  it("maps skinned bones and limits their command to rotation", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "hero-character.glb",
      validation: validation({ nodes: 20, meshes: 2, skins: 1, joints: 16 }),
      bones: 16,
      skinnedMeshes: 2,
      parts: 2,
    });
    const proxies = createStudioGeneric3dPoseProxies({
      manifest,
      nodes: [
        { key: "hips", name: "Hips", isBone: true },
        { key: "head", name: "Head", parentKey: "hips", isBone: true },
        { key: "arm-l", name: "LeftArm", parentKey: "hips", isBone: true },
        { key: "arm-r", name: "RightArm", parentKey: "hips", isBone: true },
      ],
    });
    const leftArm = proxies.find((item) => item.role === "left-arm")!;

    expect(leftArm).toMatchObject({
      kind: "bone",
      operation: "bone-rotate",
      targetKey: "arm-l",
      canApply: true,
      deformsMesh: true,
    });
    expect(createStudioGeneric3dProxyTransformCommand({
      proxy: leftArm,
      transform: {
        translation: [5, 5, 5],
        rotationDegrees: [20, 30, 40],
        scale: [3, 3, 3],
      },
    })).toEqual({
      target: "bone",
      targetKey: "arm-l",
      translation: [0, 0, 0],
      rotationDegrees: [20, 30, 40],
      scale: [1, 1, 1],
      deformsMesh: true,
    });
  });

  it("fails closed for non-finite transform input", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "prop.glb",
      validation: validation(),
    });
    const root = createStudioGeneric3dPoseProxies({ manifest })[0]!;
    expect(createStudioGeneric3dProxyTransformCommand({
      proxy: root,
      transform: {
        translation: [Number.NaN, 0, 0],
        rotationDegrees: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })).toBeNull();
  });
});
