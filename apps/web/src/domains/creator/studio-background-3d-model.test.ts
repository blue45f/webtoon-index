import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveStudioBg3dAnimationTime } from "./bg3d/studio-bg3d-animation-time";
import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  validateStudioBg3dGlb,
} from "./bg3d/studio-bg3d-glb-validation";
import { DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE } from "./bg3d/studio-bg3d-scene-document";
import {
  applyBg3dFallbackMaterial,
  checkStudioBg3dThreeBudgets,
  cloneStudioBg3dThreeObject,
  cloneBgCustomModelInstances,
  computeAutoFitScale,
  createBgCustomModelInstance,
  createStudioBg3dEditableThreeClone,
  createStudioBg3dThreePoseController,
  createStudioBg3dThreeMorphController,
  disposeStudioBg3dThreeResources,
  duplicateBgCustomModelInstance,
  encodeBg3dSceneWithModelsHash,
  loadVerifiedStudioBg3dGlbWithThree,
  measureBg3dObjectSize,
  measureStudioBg3dThreeMetrics,
  parseBg3dSceneWithModelsFromDataUrl,
  isStudioBg3dThreeTwoBoneIkChainSupported,
  sampleStudioBg3dAnimationActionAtTime,
} from "./studio-background-3d-model";
import { createPrimitive, encodeBg3dSceneHash } from "./studio-background-3d-primitives";

import type { StudioBg3dGlbValidationSuccess } from "./bg3d/studio-bg3d-glb-validation";
import type { StudioBg3dParsedGlbMetrics, StudioBg3dSceneBudgets } from "./bg3d/studio-bg3d-scene-document";
import type { BgCustomModelInstance } from "./studio-background-3d-model";

const threeLoaderMocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  setKtx2Loader: vi.fn(),
  setMeshoptDecoder: vi.fn(),
  skeletonClone: vi.fn(),
}));
const ktx2RuntimeMocks = vi.hoisted(() => ({
  create: vi.fn(),
  hasDecodeFailure: vi.fn(),
  dispose: vi.fn(),
  loader: { kind: "attested-ktx2-loader" },
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class MockGltfLoader {
    setMeshoptDecoder(decoder: unknown) {
      threeLoaderMocks.setMeshoptDecoder(decoder);
      return this;
    }

    setKTX2Loader(loader: unknown) {
      threeLoaderMocks.setKtx2Loader(loader);
      return this;
    }

    parseAsync(data: ArrayBuffer | string, path: string) {
      return threeLoaderMocks.parseAsync(data, path);
    }
  },
}));

vi.mock("./bg3d/studio-bg3d-ktx2-renderer-runtime", () => ({
  createStudioBg3dKtx2RendererRuntime: ktx2RuntimeMocks.create,
}));

vi.mock("three/examples/jsm/utils/SkeletonUtils.js", () => ({
  clone: (root: THREE.Object3D) => threeLoaderMocks.skeletonClone(root),
}));

describe("studio-background-3d-model", () => {
  it("createBgCustomModelInstance spawns with identity scale and deterministic x-jitter that wraps every 5", () => {
    const at = (existingCount: number) => createBgCustomModelInstance("model-1", existingCount);

    expect(at(0).position).toEqual([0, 0, 0]);
    expect(at(1).position).toEqual([0.8, 0, 0]);
    expect(at(4).position).toEqual([3.2, 0, 0]);
    expect(at(5).position).toEqual([0, 0, 0]); // 5 % 5 === 0, wraps back
    expect(at(7).position).toEqual([1.6, 0, 0]);

    const inst = at(0);
    expect(inst.modelId).toBe("model-1");
    expect(inst.rotation).toEqual([0, 0, 0]);
    expect(inst.scale).toEqual([1, 1, 1]);
    expect(inst.id).toEqual(expect.any(String));
  });

  it("createBgCustomModelInstance accepts an explicit initial scale (e.g. from computeAutoFitScale) and defensively copies it", () => {
    const autoFitScale: [number, number, number] = [0.5, 0.5, 0.5];
    const inst = createBgCustomModelInstance("model-1", 0, autoFitScale);
    autoFitScale[0] = 999; // mutate the source after the fact

    expect(inst.scale).toEqual([0.5, 0.5, 0.5]);
  });

  it("duplicateBgCustomModelInstance keeps modelId/rotation/scale, assigns a new id, and offsets x/z by 0.4", () => {
    const original: BgCustomModelInstance = {
      id: "original-id",
      modelId: "model-42",
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [2, 2, 2],
    };
    const copy = duplicateBgCustomModelInstance(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.modelId).toBe(original.modelId);
    expect(copy.rotation).toEqual(original.rotation);
    expect(copy.scale).toEqual(original.scale);
    expect(copy.position).toEqual([1.4, 2, 3.4]);
  });

  it("cloneBgCustomModelInstances deep-clones tuples so mutating a clone never affects the original", () => {
    const originals: BgCustomModelInstance[] = [
      {
        id: "a",
        modelId: "model-1",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        constraints: {
          enabled: true,
          aims: [],
          twoBoneIks: [{
            upperJointKey: "skin-0:joint-0",
            middleJointKey: "skin-0:joint-1",
            endJointKey: "skin-0:joint-2",
            target: [1, 2, 3],
            poleTarget: [0, 1, 1],
            weight: 1,
          }],
        },
      },
    ];
    const cloned = cloneBgCustomModelInstances(originals);
    cloned[0].position[0] = 99;
    cloned[0].scale[1] = 42;
    (cloned[0].constraints?.twoBoneIks?.[0]?.target as [number, number, number])[0] = 99;

    expect(originals[0].position).toEqual([0, 0, 0]);
    expect(originals[0].scale).toEqual([1, 1, 1]);
    expect(cloned[0].id).toBe("a"); // id/modelId preserved for undo/redo snapshot identity
    expect(cloned[0].modelId).toBe("model-1");
    expect(originals[0].constraints?.twoBoneIks?.[0]?.target).toEqual([1, 2, 3]);
    expect(cloned[0].constraints?.twoBoneIks?.[0]?.target).toEqual([99, 2, 3]);
  });

  it("computeAutoFitScale scales the largest dimension to the target size (default 2, or a custom target)", () => {
    expect(computeAutoFitScale([1, 2, 4])).toBeCloseTo(0.5); // default target 2, max dim 4 -> 2/4
    expect(computeAutoFitScale([1, 2, 4], 10)).toBeCloseTo(2.5); // custom target 10 -> 10/4
    // 음수 치수도 절댓값 기준으로 최대 변을 잡는다.
    expect(computeAutoFitScale([-3, 2, 1])).toBeCloseTo(2 / 3);
  });

  it("computeAutoFitScale returns 1 (no-op) for degenerate or non-finite bounding size / target size", () => {
    expect(computeAutoFitScale([0, 0, 0])).toBe(1);
    expect(computeAutoFitScale([Number.NaN, 1, 1])).toBe(1);
    expect(computeAutoFitScale([Number.POSITIVE_INFINITY, 1, 1])).toBe(1);
    expect(computeAutoFitScale([1, 2, 4], 0)).toBe(1);
    expect(computeAutoFitScale([1, 2, 4], -5)).toBe(1);
  });

  it("measureBg3dObjectSize measures a mesh's world-axis-aligned bounding box size", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6)));

    const [x, y, z] = measureBg3dObjectSize(group);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(4);
    expect(z).toBeCloseTo(6);
  });

  it("measureBg3dObjectSize returns [0, 0, 0] for an object with no geometry", () => {
    expect(measureBg3dObjectSize(new THREE.Group())).toEqual([0, 0, 0]);
  });

  it("applyBg3dFallbackMaterial shares one neutral MeshStandardMaterial instance across every mesh and disposes the originals", () => {
    const group = new THREE.Group();
    const originalMaterial = new THREE.MeshPhongMaterial({ color: "#111111" });
    const meshA: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), originalMaterial);
    const meshB: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); // default material (no .mtl case)
    group.add(meshA, meshB);

    const disposeA = vi.spyOn(originalMaterial, "dispose");
    const disposeB = vi.spyOn(meshB.material as THREE.Material, "dispose");

    applyBg3dFallbackMaterial(group, "#334455");

    expect(meshA.material).toBe(meshB.material); // 하나의 공유 인스턴스
    expect((meshA.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("334455");
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  it("applyBg3dFallbackMaterial disposes every material in a multi-material mesh's array", () => {
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const disposeSpies = materials.map((m) => vi.spyOn(m, "dispose"));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);

    applyBg3dFallbackMaterial(mesh);

    expect(Array.isArray(mesh.material)).toBe(false); // 다중 머티리얼도 단일 공유 머티리얼로 교체
    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("encodeBg3dSceneWithModelsHash/parseBg3dSceneWithModelsFromDataUrl round-trips, stays backward-compatible with legacy hashes, and rejects malformed input", () => {
    const primitives = [createPrimitive("box", 0)];
    const customModels = [createBgCustomModelInstance("model-1", 0)];

    const hash = encodeBg3dSceneWithModelsHash(primitives, customModels);
    const restored = parseBg3dSceneWithModelsFromDataUrl(`data:image/png;base64,xyz#${hash}`);
    expect(restored?.primitives).toEqual(primitives);
    expect(restored?.customModels).toEqual(customModels);

    // 레거시(프리미티브 전용) 해시도 계속 파싱되어야 한다 — customModels는 빈 배열로 취급.
    const legacyHash = encodeBg3dSceneHash(primitives);
    const restoredLegacy = parseBg3dSceneWithModelsFromDataUrl(`data:image/png;base64,xyz#${legacyHash}`);
    expect(restoredLegacy?.primitives).toEqual(primitives);
    expect(restoredLegacy?.customModels).toEqual([]);

    // 잘못된 입력들은 전부 null.
    expect(parseBg3dSceneWithModelsFromDataUrl(undefined)).toBeNull();
    expect(parseBg3dSceneWithModelsFromDataUrl("data:image/png;base64,xyz")).toBeNull(); // '#' 없음
    expect(parseBg3dSceneWithModelsFromDataUrl("data:image/png;base64,xyz#not-json")).toBeNull();
    const foreignToolHash = encodeURIComponent(JSON.stringify({ tool: "vrm-poser", primitives: [] }));
    expect(parseBg3dSceneWithModelsFromDataUrl(`data:image/png;base64,xyz#${foreignToolHash}`)).toBeNull();
  });
});

const generousBudgets: StudioBg3dSceneBudgets = {
  complexity: {
    maxNodes: 10_000,
    maxTriangles: 10_000_000,
    maxDrawCalls: 10_000,
    maxMaterials: 10_000,
    maxLights: 1_000,
    maxAnimations: 1_000,
    maxAnimationChannels: 10_000,
    maxAnimationKeyframes: 10_000_000,
    maxAnimationValues: 100_000_000,
    maxSkins: 1_000,
    maxJoints: 10_000,
    maxMorphTargets: 10_000,
    maxAccessorElements: 100_000_000,
    maxDecodedGeometryBytes: 1_000_000_000,
    maxModelBytes: 100 * 1024 * 1024,
  },
  textures: {
    maxTextures: 10_000,
    maxTotalBytes: 1_000_000_000,
    maxDimension: 16_384,
  },
};

function minimalGlbBytes(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
  const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedJsonLength);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  return bytes;
}

function verifiedResult(
  bytes: Uint8Array = minimalGlbBytes(),
  usesBasisTextures = false,
  requiresBasisTextures = usesBasisTextures,
): StudioBg3dGlbValidationSuccess {
  return {
    ok: true,
    code: "valid",
    message: "검증 완료",
    profile: "desktop",
    verifiedSha256: `sha256:${"0".repeat(64)}`,
    verifiedBytes: bytes,
    cumulativeBytesAfter: bytes.byteLength,
    usesBasisTextures,
    requiresBasisTextures,
    metrics: {
      byteSize: bytes.byteLength,
      jsonByteSize: 0,
      binByteSize: 0,
      nodes: 0,
      meshes: 0,
      meshPrimitives: 0,
      drawCalls: 0,
      triangles: 0,
      materials: 0,
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
      accessorElements: 0,
      estimatedDecodedGeometryBytes: 0,
    },
  };
}

function parsedGltf(root: THREE.Object3D) {
  return {
    scene: root,
    scenes: [root],
    animations: [],
    cameras: [],
    asset: { version: "2.0" },
    parser: {},
    userData: {},
  };
}

function triangleGeometry(triangleCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(triangleCount * 3 * 3), 3)
  );
  return geometry;
}

describe("verified GLB Three.js safety boundary", () => {
  beforeEach(() => {
    threeLoaderMocks.parseAsync.mockReset();
    threeLoaderMocks.setKtx2Loader.mockReset();
    threeLoaderMocks.setMeshoptDecoder.mockReset();
    threeLoaderMocks.skeletonClone.mockReset();
    ktx2RuntimeMocks.create.mockReset();
    ktx2RuntimeMocks.hasDecodeFailure.mockReset();
    ktx2RuntimeMocks.dispose.mockReset();
    ktx2RuntimeMocks.hasDecodeFailure.mockReturnValue(false);
    ktx2RuntimeMocks.create.mockResolvedValue({
      loader: ktx2RuntimeMocks.loader,
      transcoderId: "three@0.184.0/basis_transcoder",
      workerLimit: 1,
      hasDecodeFailure: ktx2RuntimeMocks.hasDecodeFailure,
      dispose: ktx2RuntimeMocks.dispose,
    });
  });

  it("counts instantiated/grouped scene work while deduplicating shared materials and shader-uniform textures", () => {
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    const materialA = new THREE.MeshBasicMaterial({ map: texture });
    const materialB = new THREE.ShaderMaterial({ uniforms: { paint: { value: texture } } });
    const geometry = triangleGeometry(4);
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(6, 6, 1);

    const instanced = new THREE.InstancedMesh(geometry, [materialA, materialB], 3);
    const ordinary = new THREE.Mesh(geometry, materialA);
    const root = new THREE.Group();
    root.add(instanced, ordinary, new THREE.PointLight());

    const result = measureStudioBg3dThreeMetrics(root);

    expect(result).toEqual({
      ok: true,
      metrics: {
        nodes: 4,
        triangles: 16,
        drawCalls: 3,
        materials: 2,
        lights: 1,
        animations: 0,
        animationChannels: 0,
        animationKeyframes: 0,
        animationValues: 0,
        skins: 0,
        joints: 0,
        morphTargets: 0,
        accessorElements: 12,
        estimatedDecodedGeometryBytes: 144,
        textures: 1,
        textureBytes: 64,
        maxTextureDimension: 4,
      },
    });
  });

  it("counts Line, LineSegments, and Points draw calls with drawRange/material groups but no triangles", () => {
    const geometry = triangleGeometry(2);
    geometry.setDrawRange(1, 4);
    geometry.addGroup(0, 2, 0);
    geometry.addGroup(2, 2, 1);
    geometry.addGroup(4, 2, 0);
    const materialA = new THREE.LineBasicMaterial();
    const materialB = new THREE.PointsMaterial();
    const root = new THREE.Group();
    root.add(
      new THREE.Line(geometry, materialA),
      new THREE.LineSegments(geometry, [materialA, materialB]),
      new THREE.Points(geometry, [materialA, materialB])
    );

    const result = measureStudioBg3dThreeMetrics(root);

    expect(result).toEqual({
      ok: true,
      metrics: {
        nodes: 4,
        triangles: 0,
        drawCalls: 7,
        materials: 2,
        lights: 0,
        animations: 0,
        animationChannels: 0,
        animationKeyframes: 0,
        animationValues: 0,
        skins: 0,
        joints: 0,
        morphTargets: 0,
        accessorElements: 6,
        estimatedDecodedGeometryBytes: 72,
        textures: 0,
        textureBytes: 0,
        maxTextureDimension: 0,
      },
    });
  });

  it("counts unique skins, joint references, morph targets, and Three animation sampler work", () => {
    const geometry = triangleGeometry(1);
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    ];
    geometry.morphAttributes.normal = [
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    ];
    const material = new THREE.MeshBasicMaterial();
    const rootBone = new THREE.Bone();
    const childBone = new THREE.Bone();
    rootBone.add(childBone);
    const skeleton = new THREE.Skeleton([rootBone, childBone]);
    const firstMesh = new THREE.SkinnedMesh(geometry, material);
    const secondMesh = new THREE.SkinnedMesh(geometry, material);
    firstMesh.bind(skeleton);
    secondMesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(rootBone, firstMesh, secondMesh);

    const move = new THREE.VectorKeyframeTrack(
      "actor.position",
      [0, 1, 2],
      [0, 0, 0, 1, 1, 1, 2, 2, 2],
    );
    const turn = new THREE.QuaternionKeyframeTrack(
      "actor.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0.707, 0, 0.707],
    );
    const expression = new THREE.NumberKeyframeTrack(
      "actor.morphTargetInfluences[0]",
      [0, 0.5, 1],
      [0, 1, 0],
    );
    const animations = [
      new THREE.AnimationClip("body", 2, [move, turn]),
      new THREE.AnimationClip("expression", 1, [expression]),
    ];

    const result = measureStudioBg3dThreeMetrics(root, animations);

    expect(result).toMatchObject({
      ok: true,
      metrics: {
        animations: 2,
        animationChannels: 3,
        animationKeyframes: 8,
        animationValues: 20,
        skins: 1,
        joints: 2,
        morphTargets: 2,
        accessorElements: 33,
        estimatedDecodedGeometryBytes: 420,
      },
    });
  });

  it("fails closed for malformed animation sampler cardinality", () => {
    const track = new THREE.NumberKeyframeTrack("actor.value", [0, 1], [0, 1]);
    Object.defineProperty(track, "values", { value: new Float32Array([0, 0.5, 1]) });
    const clip = new THREE.AnimationClip("malformed", 1, [track]);

    expect(measureStudioBg3dThreeMetrics(new THREE.Group(), [clip])).toMatchObject({
      ok: false,
      code: "unsafe-scene-metrics",
    });
  });

  it("fails closed when a line/point material group range would overflow safe arithmetic", () => {
    const geometry = triangleGeometry(2);
    geometry.addGroup(Number.MAX_SAFE_INTEGER, 1, 0);
    const root = new THREE.Points(geometry, [new THREE.PointsMaterial()]);

    expect(measureStudioBg3dThreeMetrics(root)).toMatchObject({
      ok: false,
      code: "unsafe-scene-metrics",
    });
  });

  it("uses decoded natural image dimensions rather than a smaller display size for texture memory", () => {
    const image = { width: 2, height: 2, naturalWidth: 8, naturalHeight: 4 };
    const texture = new THREE.Texture(image);
    texture.generateMipmaps = false;
    const root = new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: texture }));

    const result = measureStudioBg3dThreeMetrics(root);

    expect(result.ok && result.metrics.textureBytes).toBe(8 * 4 * 4);
    expect(result.ok && result.metrics.maxTextureDimension).toBe(8);
  });

  it("includes the full automatic integer mip chain so a 4000px RGBA texture exceeds a 64MiB budget", () => {
    const texture = new THREE.Texture({ width: 4_000, height: 4_000 });
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const root = new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: texture }));

    const result = measureStudioBg3dThreeMetrics(root);

    expect(4_000 * 4_000 * 4).toBeLessThan(64 * 1024 * 1024);
    expect(result.ok && result.metrics.textureBytes).toBe(85_332_856);
    expect(result.ok && checkStudioBg3dThreeBudgets(result.metrics, {
      ...generousBudgets,
      textures: { ...generousBudgets.textures, maxTotalBytes: 64 * 1024 * 1024 },
    })?.code).toBe("texture-byte-budget-exceeded");
  });

  it("does not allocate an automatic mip chain when its mip filter is unused or generation is disabled", () => {
    const nonMipmapFilter = new THREE.Texture({ width: 4_000, height: 4_000 });
    nonMipmapFilter.generateMipmaps = true;
    nonMipmapFilter.minFilter = THREE.LinearFilter;
    const generationDisabled = new THREE.Texture({ width: 4_000, height: 4_000 });
    generationDisabled.generateMipmaps = false;
    generationDisabled.minFilter = THREE.LinearMipmapLinearFilter;

    const nonMipmapResult = measureStudioBg3dThreeMetrics(
      new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: nonMipmapFilter }))
    );
    const disabledResult = measureStudioBg3dThreeMetrics(
      new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: generationDisabled }))
    );

    expect(nonMipmapResult.ok && nonMipmapResult.metrics.textureBytes).toBe(64_000_000);
    expect(disabledResult.ok && disabledResult.metrics.textureBytes).toBe(64_000_000);
  });

  it("treats an explicit mipmap array as the complete GPU chain without also counting source or auto levels", () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 4_000, 4_000);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.mipmaps = [
      { data: new Uint8Array(64), width: 4, height: 4 },
      { data: new Uint8Array(16), width: 2, height: 2 },
      { data: new Uint8Array(4), width: 1, height: 1 },
    ];
    const root = new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: texture }));

    const result = measureStudioBg3dThreeMetrics(root);

    expect(result.ok && result.metrics.textureBytes).toBe(84);
    expect(result.ok && result.metrics.maxTextureDimension).toBe(4);
  });

  it("fails closed when an automatic mip-chain sum would overflow safe integer arithmetic", () => {
    const texture = new THREE.Texture({ width: 45_000_000, height: 45_000_000 });
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const root = new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial({ map: texture }));

    expect(measureStudioBg3dThreeMetrics(root)).toMatchObject({
      ok: false,
      code: "unsafe-scene-metrics",
    });
  });

  it("accepts exact metric limits and returns the stable code for every exceeded post-parse budget", () => {
    const metrics: StudioBg3dParsedGlbMetrics = {
      nodes: 2,
      triangles: 3,
      drawCalls: 4,
      materials: 5,
      lights: 1,
      animations: 1,
      animationChannels: 2,
      animationKeyframes: 3,
      animationValues: 4,
      skins: 1,
      joints: 2,
      morphTargets: 1,
      accessorElements: 6,
      estimatedDecodedGeometryBytes: 24,
      textures: 2,
      textureBytes: 128,
      maxTextureDimension: 64,
    };
    const exact: StudioBg3dSceneBudgets = {
      complexity: {
        maxNodes: 2,
        maxTriangles: 3,
        maxDrawCalls: 4,
        maxMaterials: 5,
        maxLights: 1,
        maxAnimations: 1,
        maxAnimationChannels: 2,
        maxAnimationKeyframes: 3,
        maxAnimationValues: 4,
        maxSkins: 1,
        maxJoints: 2,
        maxMorphTargets: 1,
        maxAccessorElements: 6,
        maxDecodedGeometryBytes: 24,
        maxModelBytes: 20,
      },
      textures: { maxTextures: 2, maxTotalBytes: 128, maxDimension: 64 },
    };

    expect(checkStudioBg3dThreeBudgets(metrics, exact)).toBeNull();
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxNodes: 1 },
    })?.code).toBe("node-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxTriangles: 2 },
    })?.code).toBe("triangle-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxDrawCalls: 3 },
    })?.code).toBe("draw-call-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxMaterials: 4 },
    })?.code).toBe("material-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxLights: 0 },
    })?.code).toBe("light-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxAnimations: 0 },
    })?.code).toBe("animation-count-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxAnimationChannels: 1 },
    })?.code).toBe("animation-channel-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxAnimationKeyframes: 2 },
    })?.code).toBe("animation-keyframe-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxAnimationValues: 3 },
    })?.code).toBe("animation-value-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxSkins: 0 },
    })?.code).toBe("skin-count-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxJoints: 1 },
    })?.code).toBe("joint-count-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxMorphTargets: 0 },
    })?.code).toBe("morph-target-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxAccessorElements: 5 },
    })?.code).toBe("accessor-element-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, complexity: { ...exact.complexity, maxDecodedGeometryBytes: 23 },
    })?.code).toBe("geometry-memory-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, textures: { ...exact.textures, maxTextures: 1 },
    })?.code).toBe("texture-count-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, textures: { ...exact.textures, maxTotalBytes: 127 },
    })?.code).toBe("texture-byte-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets(metrics, {
      ...exact, textures: { ...exact.textures, maxDimension: 63 },
    })?.code).toBe("texture-dimension-budget-exceeded");
    expect(checkStudioBg3dThreeBudgets({ nodes: 0 } as StudioBg3dParsedGlbMetrics, exact)?.code)
      .toBe("unsafe-scene-metrics");
  });

  it("disposes every unique geometry, material, material/uniform/target texture, bone texture, target, and ImageBitmap once", () => {
    const geometry = triangleGeometry(1);
    const dataTexture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const close = vi.fn();
    const bitmap = {
      width: 2,
      height: 2,
      close,
      [Symbol.toStringTag]: "ImageBitmap",
    } as unknown as ImageBitmap;
    const bitmapTexture = new THREE.Texture(bitmap);
    const renderTarget = new THREE.WebGLRenderTarget(2, 2);
    const materialA = new THREE.MeshBasicMaterial({ map: dataTexture });
    const materialB = new THREE.ShaderMaterial({
      uniforms: {
        bitmap: { value: bitmapTexture },
        target: { value: renderTarget },
        sharedAgain: { value: dataTexture },
      },
    });
    const skeleton = new THREE.Skeleton([new THREE.Bone()]).computeBoneTexture();
    const boneTexture = skeleton.boneTexture as THREE.DataTexture;
    const skinned = new THREE.SkinnedMesh(geometry, materialA);
    skinned.bind(skeleton);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, materialA), new THREE.Mesh(geometry, materialB), skinned);

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialADispose = vi.spyOn(materialA, "dispose");
    const materialBDispose = vi.spyOn(materialB, "dispose");
    const textureDisposes = [dataTexture, bitmapTexture, renderTarget.texture, boneTexture]
      .map((texture) => vi.spyOn(texture, "dispose"));
    const targetDispose = vi.spyOn(renderTarget, "dispose");

    const summary = disposeStudioBg3dThreeResources(root);

    expect(summary).toEqual({ geometries: 1, materials: 2, textures: 4, renderTargets: 1, imageBitmaps: 1 });
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialADispose).toHaveBeenCalledTimes(1);
    expect(materialBDispose).toHaveBeenCalledTimes(1);
    for (const dispose of textureDisposes) expect(dispose).toHaveBeenCalledTimes(1);
    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses ordinary clone for static content and SkeletonUtils.clone for skinned content", async () => {
    const staticRoot = new THREE.Group();
    staticRoot.add(new THREE.Mesh(triangleGeometry(1), new THREE.MeshBasicMaterial()));

    const staticClone = await cloneStudioBg3dThreeObject(staticRoot);
    expect(staticClone).not.toBe(staticRoot);
    expect(threeLoaderMocks.skeletonClone).not.toHaveBeenCalled();

    const skinnedRoot = new THREE.Group();
    skinnedRoot.add(new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial()));
    const skeletonClone = new THREE.Group();
    threeLoaderMocks.skeletonClone.mockReturnValue(skeletonClone);

    await expect(cloneStudioBg3dThreeObject(skinnedRoot)).resolves.toBe(skeletonClone);
    expect(threeLoaderMocks.skeletonClone).toHaveBeenCalledOnce();
    expect(threeLoaderMocks.skeletonClone).toHaveBeenCalledWith(skinnedRoot);

    threeLoaderMocks.skeletonClone.mockImplementationOnce(() => {
      throw new Error("private-node-name: clone detail");
    });
    let safeError: unknown;
    try {
      await cloneStudioBg3dThreeObject(skinnedRoot);
    } catch (error) {
      safeError = error;
    }
    expect(safeError).toMatchObject({
      name: "StudioBg3dThreeOperationError",
      code: "clone-failed",
      message: "3D 모델 인스턴스를 복제하지 못했습니다. 모델을 다시 불러와 주세요.",
    });
    expect((safeError as Error).message).not.toContain("private-node-name");
  });

  it("addresses joints by stable skin/joint ordinals and applies pose offsets without accumulation", () => {
    const hips = new THREE.Bone();
    hips.name = "Hips";
    hips.quaternion.setFromEuler(new THREE.Euler(0, 0.2, 0));
    const arm = new THREE.Bone();
    arm.name = "Arm";
    hips.add(arm);
    const skeleton = new THREE.Skeleton([hips, arm]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(hips);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);

    const controller = createStudioBg3dThreePoseController(root);
    const rest = arm.quaternion.clone();
    const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const pose = {
      enabled: true,
      weight: 1,
      joints: [{
        jointKey: "skin-0:joint-1",
        rotationOffset: [offset.x, offset.y, offset.z, offset.w] as const,
      }],
    };

    expect(controller.joints).toEqual([
      {
        key: "skin-0:joint-0",
        canonicalKey: "skin-0:joint-0",
        name: "Hips",
        skinIndex: 0,
        jointIndex: 0,
        parentKey: null,
        restPosition: [0, 0, 0],
      },
      {
        key: "skin-0:joint-1",
        canonicalKey: "skin-0:joint-1",
        name: "Arm",
        skinIndex: 0,
        jointIndex: 1,
        parentKey: "skin-0:joint-0",
        restPosition: [0, 0, 0],
      },
    ]);
    controller.applyFromRestPose(pose);
    const once = arm.quaternion.clone();
    expect(once.angleTo(rest.clone().multiply(offset))).toBeLessThan(1e-8);

    controller.applyFromRestPose(pose);
    expect(arm.quaternion.angleTo(once)).toBeLessThan(1e-8);

    controller.applyFromRestPose({ ...pose, enabled: false });
    expect(arm.quaternion.angleTo(rest)).toBeLessThan(1e-8);
  });

  it("applies non-destructive model-local aim constraints after pose and removes them exactly", () => {
    const bone = new THREE.Bone();
    bone.name = "Look";
    const skeleton = new THREE.Skeleton([bone]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.position.set(3, 2, -4);
    root.rotation.y = 0.4;
    root.add(mesh);
    const controller = createStudioBg3dThreePoseController(root);
    const rest = bone.quaternion.clone();
    const constraints = {
      enabled: true,
      aims: [{
        jointKey: "skin-0:joint-0",
        target: [5, 0, 0] as const,
        axis: "+z" as const,
        weight: 1,
      }],
      twoBoneIks: [],
    };

    controller.applyConstraints(constraints);
    const aimed = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.quaternion).normalize();
    expect(aimed.x).toBeCloseTo(1, 6);
    expect(aimed.y).toBeCloseTo(0, 6);
    expect(aimed.z).toBeCloseTo(0, 6);
    const once = bone.quaternion.clone();

    controller.removeAppliedPoseOffsets();
    expect(bone.quaternion.angleTo(rest)).toBeLessThan(1e-8);
    controller.applyConstraints(constraints);
    expect(bone.quaternion.angleTo(once)).toBeLessThan(1e-8);
    controller.removeAppliedPoseOffsets();
    controller.applyConstraints({ ...constraints, enabled: false });
    expect(bone.quaternion.angleTo(rest)).toBeLessThan(1e-8);
  });

  it("solves model-local two-bone IK after authored pose without frame accumulation", () => {
    const upper = new THREE.Bone();
    upper.name = "Upper";
    const middle = new THREE.Bone();
    middle.name = "Middle";
    middle.position.set(1, 0, 0);
    const end = new THREE.Bone();
    end.name = "End";
    end.position.set(1, 0, 0);
    upper.add(middle);
    middle.add(end);
    const skeleton = new THREE.Skeleton([upper, middle, end]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(upper);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.position.set(3, 2, -4);
    root.rotation.set(0.2, 0.45, -0.1);
    root.add(mesh);
    const controller = createStudioBg3dThreePoseController(root);
    const restUpper = upper.quaternion.clone();
    const restMiddle = middle.quaternion.clone();
    const poseOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.2));
    const pose = {
      enabled: true,
      weight: 0.6,
      joints: [{
        jointKey: "skin-0:joint-0",
        rotationOffset: [poseOffset.x, poseOffset.y, poseOffset.z, poseOffset.w] as const,
      }],
    };
    const target = [1, 1, 0] as const;
    const poleTarget = [0, 0, 1] as const;
    const constraints = {
      enabled: true,
      aims: [{
        jointKey: "skin-0:joint-0",
        target: [-2, 0, 0] as const,
        axis: "+x" as const,
        weight: 1,
      }],
      twoBoneIks: [{
        upperJointKey: "skin-0:joint-0",
        middleJointKey: "skin-0:joint-1",
        endJointKey: "skin-0:joint-2",
        target,
        poleTarget,
        weight: 1,
      }],
    };

    expect(controller.joints.map((joint) => joint.parentKey)).toEqual([
      null,
      "skin-0:joint-0",
      "skin-0:joint-1",
    ]);
    expect(controller.joints[2]?.restPosition[0]).toBeCloseTo(2, 8);
    expect(controller.joints[2]?.restPosition[1]).toBeCloseTo(0, 8);
    expect(controller.joints[2]?.restPosition[2]).toBeCloseTo(0, 8);
    controller.applyToCurrentPose(pose);
    controller.applyConstraints(constraints);
    root.updateWorldMatrix(true, true);
    const solvedLocal = end.getWorldPosition(new THREE.Vector3())
      .applyMatrix4(root.matrixWorld.clone().invert());
    expect(solvedLocal.distanceTo(new THREE.Vector3(...target))).toBeLessThan(1e-6);
    const onceUpper = upper.quaternion.clone();
    const onceMiddle = middle.quaternion.clone();
    const bakedPose = controller.captureConstraintBakePose();
    expect(bakedPose).toMatchObject({ enabled: true, weight: 1 });
    expect(bakedPose?.joints.map(({ jointKey }) => jointKey)).toEqual([
      "skin-0:joint-0",
      "skin-0:joint-1",
    ]);
    controller.removeAppliedPoseOffsets();
    controller.applyToCurrentPose(bakedPose ?? undefined);
    root.updateWorldMatrix(true, true);
    expect(upper.quaternion.angleTo(onceUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(onceMiddle)).toBeLessThan(1e-8);
    expect(end.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert())
      .distanceTo(new THREE.Vector3(...target))).toBeLessThan(1e-6);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      controller.applyFromRestPose(bakedPose ?? undefined);
    }
    expect(upper.quaternion.angleTo(onceUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(onceMiddle)).toBeLessThan(1e-8);

    for (let iteration = 0; iteration < 100; iteration += 1) {
      controller.removeAppliedPoseOffsets();
      controller.applyToCurrentPose(pose);
      controller.applyConstraints(constraints);
    }
    expect(upper.quaternion.angleTo(onceUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(onceMiddle)).toBeLessThan(1e-8);
    expect(target).toEqual([1, 1, 0]);
    expect(poleTarget).toEqual([0, 0, 1]);

    controller.removeAppliedPoseOffsets();
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);

    const partialConstraints = {
      ...constraints,
      aims: [],
      twoBoneIks: [{ ...constraints.twoBoneIks[0], weight: 0.35 }],
    };
    controller.applyConstraints(partialConstraints);
    const partialUpper = upper.quaternion.clone();
    const partialMiddle = middle.quaternion.clone();
    for (let iteration = 0; iteration < 100; iteration += 1) {
      controller.removeAppliedPoseOffsets();
      controller.applyConstraints(partialConstraints);
    }
    expect(upper.quaternion.angleTo(partialUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(partialMiddle)).toBeLessThan(1e-8);
    controller.removeAppliedPoseOffsets();

    controller.applyConstraints({
      ...constraints,
      aims: [],
      twoBoneIks: [{ ...constraints.twoBoneIks[0], weight: 0 }],
    });
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);
  });

  it("solves nested non-overlapping IK chains ancestor-first regardless of stored order", () => {
    const parentUpper = new THREE.Bone();
    parentUpper.name = "ParentUpper";
    const parentMiddle = new THREE.Bone();
    parentMiddle.name = "ParentMiddle";
    parentMiddle.position.x = 1;
    const parentEnd = new THREE.Bone();
    parentEnd.name = "ParentEnd";
    parentEnd.position.x = 1;
    const childUpper = new THREE.Bone();
    childUpper.name = "ChildUpper";
    const childMiddle = new THREE.Bone();
    childMiddle.name = "ChildMiddle";
    childMiddle.position.x = 1;
    const childEnd = new THREE.Bone();
    childEnd.name = "ChildEnd";
    childEnd.position.x = 1;
    parentUpper.add(parentMiddle);
    parentMiddle.add(parentEnd);
    parentEnd.add(childUpper);
    childUpper.add(childMiddle);
    childMiddle.add(childEnd);
    const skeleton = new THREE.Skeleton([
      parentUpper,
      parentMiddle,
      parentEnd,
      childUpper,
      childMiddle,
      childEnd,
    ]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(parentUpper);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.position.set(3, -2, 4);
    root.rotation.set(0.2, -0.35, 0.15);
    root.add(mesh);
    const controller = createStudioBg3dThreePoseController(root);
    const parentTarget = [1, 1, 0] as const;
    const childTarget = [2, 2, 0.4] as const;
    const parentConstraint = {
      upperJointKey: "skin-0:joint-0",
      middleJointKey: "skin-0:joint-1",
      endJointKey: "skin-0:joint-2",
      target: parentTarget,
      poleTarget: [0, 0, 1] as const,
      weight: 1,
    };
    const childConstraint = {
      upperJointKey: "skin-0:joint-3",
      middleJointKey: "skin-0:joint-4",
      endJointKey: "skin-0:joint-5",
      target: childTarget,
      poleTarget: [1, 1, 1] as const,
      weight: 1,
    };
    const inverseRoot = new THREE.Matrix4();
    const sampleSolvedPose = (
      twoBoneIks: readonly (typeof parentConstraint | typeof childConstraint)[],
    ) => {
      controller.applyConstraints({ enabled: true, aims: [], twoBoneIks });
      root.updateWorldMatrix(true, true);
      inverseRoot.copy(root.matrixWorld).invert();
      const parentEndLocal = parentEnd.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
      const childEndLocal = childEnd.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
      const rotations = [
        parentUpper.quaternion.clone(),
        parentMiddle.quaternion.clone(),
        childUpper.quaternion.clone(),
        childMiddle.quaternion.clone(),
      ];
      controller.removeAppliedPoseOffsets();
      return { parentEndLocal, childEndLocal, rotations };
    };

    const descendantFirst = sampleSolvedPose([childConstraint, parentConstraint]);
    const ancestorFirst = sampleSolvedPose([parentConstraint, childConstraint]);

    for (const solved of [descendantFirst, ancestorFirst]) {
      expect(solved.parentEndLocal.distanceTo(new THREE.Vector3(...parentTarget))).toBeLessThan(1e-6);
      expect(solved.childEndLocal.distanceTo(new THREE.Vector3(...childTarget))).toBeLessThan(1e-6);
    }
    for (let index = 0; index < descendantFirst.rotations.length; index += 1) {
      expect(descendantFirst.rotations[index]!.angleTo(ancestorFirst.rotations[index]!))
        .toBeLessThan(1e-8);
    }
  });

  it("rejects non-uniform roots and invalid IK ancestry without mutating the chain", () => {
    const upper = new THREE.Bone();
    const middle = new THREE.Bone();
    middle.position.x = 1;
    const end = new THREE.Bone();
    end.position.x = 1;
    upper.add(middle);
    middle.add(end);
    const skeleton = new THREE.Skeleton([upper, middle, end]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(upper);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);
    const controller = createStudioBg3dThreePoseController(root);
    const restUpper = upper.quaternion.clone();
    const restMiddle = middle.quaternion.clone();
    const validConstraint = {
      enabled: true,
      aims: [],
      twoBoneIks: [{
        upperJointKey: "skin-0:joint-0",
        middleJointKey: "skin-0:joint-1",
        endJointKey: "skin-0:joint-2",
        target: [1, 1, 0] as const,
        poleTarget: [0, 0, 1] as const,
        weight: 1,
      }],
    };

    const chainSupport = (instanceWorldMatrix: THREE.Matrix4) =>
      isStudioBg3dThreeTwoBoneIkChainSupported({
        root,
        instanceWorldMatrix,
        upperJointKey: "skin-0:joint-0",
        middleJointKey: "skin-0:joint-1",
        endJointKey: "skin-0:joint-2",
      });
    expect(chainSupport(new THREE.Matrix4().makeScale(2, 2, 2))).toBe(true);
    expect(chainSupport(new THREE.Matrix4().makeScale(2, 1, 1))).toBe(false);
    expect(chainSupport(new THREE.Matrix4().makeScale(-1, 1, 1))).toBe(false);

    root.scale.set(2, 1, 1);
    controller.applyConstraints(validConstraint);
    expect(controller.captureConstraintBakePose()).toBeNull();
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);

    root.scale.set(0.001, 0.001009, 0.001);
    controller.applyConstraints(validConstraint);
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);

    root.scale.set(-1, 1, 1);
    controller.applyConstraints(validConstraint);
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);

    root.matrixAutoUpdate = false;
    root.matrix.set(
      1, 0.5, 0, 0,
      0, Math.sqrt(0.75), 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    controller.applyConstraints(validConstraint);
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);

    root.matrixAutoUpdate = true;
    root.scale.set(1, 1, 1);
    controller.applyConstraints({
      ...validConstraint,
      twoBoneIks: [{
        ...validConstraint.twoBoneIks[0],
        middleJointKey: "skin-0:joint-2",
        endJointKey: "skin-0:joint-1",
      }],
    });
    expect(controller.captureConstraintBakePose()).toBeNull();
    expect(upper.quaternion.angleTo(restUpper)).toBeLessThan(1e-8);
    expect(middle.quaternion.angleTo(restMiddle)).toBeLessThan(1e-8);
  });

  it("keeps an IK target fixed when an aim constraint also targets a chain ancestor", () => {
    const shoulder = new THREE.Bone();
    const upper = new THREE.Bone();
    const middle = new THREE.Bone();
    middle.position.x = 1;
    const end = new THREE.Bone();
    end.position.x = 1;
    shoulder.add(upper);
    upper.add(middle);
    middle.add(end);
    const skeleton = new THREE.Skeleton([shoulder, upper, middle, end]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(shoulder);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);
    const controller = createStudioBg3dThreePoseController(root);
    const shoulderRest = shoulder.quaternion.clone();
    const aim = {
      jointKey: "skin-0:joint-0",
      target: [-1, 0, 0] as const,
      axis: "+x" as const,
      weight: 1,
    };

    controller.applyConstraints({ enabled: true, aims: [aim], twoBoneIks: [] });
    expect(shoulder.quaternion.angleTo(shoulderRest)).toBeGreaterThan(1);
    controller.removeAppliedPoseOffsets();

    const target = new THREE.Vector3(1, 1, 0);
    controller.applyConstraints({
      enabled: true,
      aims: [aim],
      twoBoneIks: [{
        upperJointKey: "skin-0:joint-1",
        middleJointKey: "skin-0:joint-2",
        endJointKey: "skin-0:joint-3",
        target: [1, 1, 0],
        poleTarget: [0, 0, 1],
        weight: 1,
      }],
    });
    root.updateWorldMatrix(true, true);
    expect(end.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6);
    expect(shoulder.quaternion.angleTo(shoulderRest)).toBeLessThan(1e-8);
  });

  it("preserves external bone writes and removes shared-skin procedural rotations exactly", () => {
    const sharedBone = new THREE.Bone();
    const firstSkeleton = new THREE.Skeleton([sharedBone]);
    const secondSkeleton = new THREE.Skeleton([sharedBone]);
    const firstMesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    const secondMesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    firstMesh.add(sharedBone);
    firstMesh.bind(firstSkeleton);
    secondMesh.bind(secondSkeleton);
    const root = new THREE.Group();
    root.add(firstMesh, secondMesh);
    const controller = createStudioBg3dThreePoseController(root);
    const rest = sharedBone.quaternion.clone();
    expect(controller.joints.map((joint) => joint.canonicalKey)).toEqual([
      "skin-0:joint-0",
      "skin-0:joint-0",
    ]);
    const x = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0, 0));
    const y = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0));
    const pose = {
      enabled: true,
      weight: 1,
      joints: [
        { jointKey: "skin-0:joint-0", rotationOffset: [x.x, x.y, x.z, x.w] as const },
        { jointKey: "skin-1:joint-0", rotationOffset: [y.x, y.y, y.z, y.w] as const },
      ],
    };
    const aimConstraint = {
      enabled: true,
      aims: [{
        jointKey: "skin-0:joint-0",
        target: [1, 1, 0] as const,
        axis: "+x" as const,
        weight: 0.5,
      }],
      twoBoneIks: [],
    };

    controller.applyToCurrentPose(pose);
    controller.applyConstraints(aimConstraint);
    expect(sharedBone.quaternion.angleTo(rest)).toBeGreaterThan(0.5);
    expect(controller.captureConstraintBakePose()?.joints.map(({ jointKey }) => jointKey))
      .toEqual(["skin-0:joint-0"]);
    controller.removeAppliedPoseOffsets();
    expect(sharedBone.quaternion.angleTo(rest)).toBeLessThan(1e-8);

    controller.applyToCurrentPose(pose);
    controller.applyConstraints(aimConstraint);
    const external = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.4, 0.1));
    sharedBone.quaternion.copy(external);
    expect(controller.captureConstraintBakePose()).toBeNull();
    controller.removeAppliedPoseOffsets();
    expect(sharedBone.quaternion.angleTo(external)).toBeLessThan(1e-7);

    controller.applyToCurrentPose(pose);
    controller.removeAppliedPoseOffsets();
    expect(sharedBone.quaternion.angleTo(external)).toBeLessThan(1e-7);
  });

  it("samples a real AnimationMixer across the ping-pong boundary without double reflection", () => {
    const root = new THREE.Group();
    const actor = new THREE.Object3D();
    actor.name = "Actor";
    root.add(actor);
    const clip = new THREE.AnimationClip("move", 1, [
      new THREE.NumberKeyframeTrack("Actor.position[x]", [0, 1], [0, 10]),
    ]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.play();

    const sampleAt = (elapsedSeconds: number) => sampleStudioBg3dAnimationActionAtTime(
      mixer,
      action,
      resolveStudioBg3dAnimationTime({
        baseTimeSeconds: 0,
        elapsedSeconds,
        timeScale: 1,
        durationSeconds: 1,
        loop: "ping-pong",
      }),
    );

    expect(sampleAt(0.75)).toBeCloseTo(0.75);
    expect(actor.position.x).toBeCloseTo(7.5);
    expect(sampleAt(1)).toBe(1);
    expect(actor.position.x).toBeCloseTo(10);
    expect(sampleAt(1.25)).toBeCloseTo(0.75);
    expect(actor.position.x).toBeCloseTo(7.5);
    expect(action.paused).toBe(true);
    expect(mixer.time).toBe(0);
  });

  it("resamples a paused action at a nonzero absolute time without snapping to frame zero", () => {
    const root = new THREE.Group();
    const actor = new THREE.Object3D();
    actor.name = "Actor";
    root.add(actor);
    const clip = new THREE.AnimationClip("move", 1, [
      new THREE.NumberKeyframeTrack("Actor.position[x]", [0, 1], [0, 10]),
    ]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.play();

    sampleStudioBg3dAnimationActionAtTime(mixer, action, 0.6);
    expect(actor.position.x).toBeCloseTo(6);
    sampleStudioBg3dAnimationActionAtTime(mixer, action, 0.6);

    expect(actor.position.x).toBeCloseTo(6);
    expect(action.time).toBeCloseTo(0.6);
    expect(action.paused).toBe(true);
  });

  it("reapplies a pose over consecutive real mixer samples without frame-zero snap or accumulation", () => {
    const arm = new THREE.Bone();
    arm.name = "Arm";
    const skeleton = new THREE.Skeleton([arm]);
    const mesh = new THREE.SkinnedMesh(triangleGeometry(1), new THREE.MeshBasicMaterial());
    mesh.add(arm);
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);
    const identity = new THREE.Quaternion();
    const animatedEnd = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const clip = new THREE.AnimationClip("turn", 1, [
      new THREE.QuaternionKeyframeTrack(
        "Arm.quaternion",
        [0, 1],
        [
          identity.x, identity.y, identity.z, identity.w,
          animatedEnd.x, animatedEnd.y, animatedEnd.z, animatedEnd.w,
        ],
      ),
    ]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.play();
    const controller = createStudioBg3dThreePoseController(root);
    const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, 0, 0));
    const pose = {
      enabled: true,
      weight: 1,
      joints: [{
        jointKey: "skin-0:joint-0",
        rotationOffset: [offset.x, offset.y, offset.z, offset.w] as const,
      }],
    };
    const sampleWithPose = (timeSeconds: number) => {
      controller.removeAppliedPoseOffsets();
      sampleStudioBg3dAnimationActionAtTime(mixer, action, timeSeconds);
      controller.applyToCurrentPose(pose);
    };

    sampleWithPose(0.5);
    const expectedHalf = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, Math.PI / 4, 0))
      .multiply(offset);
    const first = arm.quaternion.clone();
    expect(first.angleTo(expectedHalf)).toBeLessThan(1e-7);

    sampleWithPose(0.5);
    expect(arm.quaternion.angleTo(first)).toBeLessThan(1e-7);

    sampleWithPose(0.75);
    const expectedLater = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, Math.PI * 0.375, 0))
      .multiply(offset);
    expect(arm.quaternion.angleTo(expectedLater)).toBeLessThan(1e-7);
    expect(arm.quaternion.angleTo(offset)).toBeGreaterThan(0.5);
  });

  it("addresses named morph targets by stable mesh/target ordinals and layers bounded offsets", () => {
    const geometry = triangleGeometry(1);
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    ];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMorphTargets();
    mesh.morphTargetDictionary = { Smile: 0, Blink: 1 };
    if (!mesh.morphTargetInfluences) throw new Error("morph fixture must initialize influences");
    mesh.morphTargetInfluences[0] = 0.1;
    mesh.morphTargetInfluences[1] = 0;
    const root = new THREE.Group();
    root.add(mesh);

    const controller = createStudioBg3dThreeMorphController(root);
    expect(controller.targets).toEqual([
      { key: "mesh-0:target-0", name: "Smile", meshIndex: 0, targetIndex: 0 },
      { key: "mesh-0:target-1", name: "Blink", meshIndex: 0, targetIndex: 1 },
    ]);

    const morph = {
      enabled: true,
      weight: 0.5,
      targets: [{ targetKey: "mesh-0:target-0", weightOffset: 0.8 }],
    };
    controller.applyFromRestWeights(morph);
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.5);
    controller.applyFromRestWeights(morph);
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.5);

    controller.removeAppliedWeightOffsets();
    mesh.morphTargetInfluences[0] = 0.8;
    controller.applyToCurrentWeights({ ...morph, weight: 1 });
    expect(mesh.morphTargetInfluences[0]).toBe(1);
    controller.applyFromRestWeights({ ...morph, enabled: false });
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.1);
  });

  it("isolates editable instance materials while keeping geometry and textures cache-owned", async () => {
    const geometry = triangleGeometry(1);
    const texture = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: "#808080",
      map: texture,
      opacity: 0.8,
      roughness: 0.9,
      metalness: 0.1,
    });
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(geometry, sourceMaterial),
      new THREE.Mesh(geometry, sourceMaterial),
    );

    const editable = await createStudioBg3dEditableThreeClone(root);
    const meshes: THREE.Mesh[] = [];
    editable.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    const firstMaterial = meshes[0].material as THREE.MeshStandardMaterial;
    const secondMaterial = meshes[1].material as THREE.MeshStandardMaterial;
    const materialDispose = vi.spyOn(firstMaterial, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    expect(editable.materialCount).toBe(1);
    expect(firstMaterial).toBe(secondMaterial);
    expect(firstMaterial).not.toBe(sourceMaterial);
    expect(firstMaterial.map).toBe(texture);
    expect(meshes[0].geometry).toBe(geometry);

    editable.applyMaterialOverride({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      colorMode: "replace",
      color: "#ff0000",
      colorStrength: 1,
      opacityMultiplier: 0.5,
      roughness: 0.25,
      metalness: 0.75,
      emissiveColor: "#001122",
      emissiveIntensity: 2,
      wireframe: true,
      doubleSided: true,
    });

    expect(firstMaterial.color.getHexString()).toBe("ff0000");
    expect(firstMaterial.opacity).toBeCloseTo(0.4);
    expect(firstMaterial.transparent).toBe(true);
    expect(firstMaterial.roughness).toBe(0.25);
    expect(firstMaterial.metalness).toBe(0.75);
    expect(firstMaterial.emissive.getHexString()).toBe("001122");
    expect(firstMaterial.emissiveIntensity).toBe(2);
    expect(firstMaterial.wireframe).toBe(true);
    expect(firstMaterial.side).toBe(THREE.DoubleSide);
    expect(sourceMaterial.color.getHexString()).toBe("808080");
    expect(sourceMaterial.opacity).toBe(0.8);

    editable.applyMaterialOverride(undefined);
    expect(firstMaterial.color.getHexString()).toBe("808080");
    expect(firstMaterial.opacity).toBe(0.8);
    expect(firstMaterial.roughness).toBe(0.9);
    expect(firstMaterial.map).toBe(texture);

    editable.dispose();
    editable.dispose();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).not.toHaveBeenCalled();
  });

  it("accepts the validator-owned success snapshot without reusing the caller's source bytes", async () => {
    const source = minimalGlbBytes();
    const validated = await validateStudioBg3dGlb(source, {
      declared: {
        byteSize: source.byteLength,
        sha256: "0".repeat(64),
        mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
      },
      cumulative: { usedBytes: 0, maximumBytes: 100 * 1024 * 1024 },
      profile: "desktop",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      digest: async () => "0".repeat(64),
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error("test GLB fixture must pass the validator");
    expect(validated.verifiedBytes).not.toBe(source);
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(new THREE.Group()));

    const loaded = await loadVerifiedStudioBg3dGlbWithThree(validated, generousBudgets);

    expect(loaded).toMatchObject({ ok: true, code: "loaded" });
    if (loaded.ok) loaded.dispose();
  });

  it("parses only an immediate defensive ArrayBuffer copy with an empty base path and never calls URL/fetch", async () => {
    const geometry = triangleGeometry(1);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    let parsedBuffer: ArrayBuffer | null = null;
    let parsedPath: string | null = null;
    threeLoaderMocks.parseAsync.mockImplementation(async (data: ArrayBuffer | string, path: string) => {
      parsedBuffer = data as ArrayBuffer;
      parsedPath = path;
      return parsedGltf(root);
    });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const fetch = vi.spyOn(globalThis, "fetch");
    const verified = verifiedResult();
    const originalBuffer = verified.verifiedBytes.buffer;
    const mutationIndex = verified.verifiedBytes.byteLength - 1;
    const originalByte = verified.verifiedBytes[mutationIndex];

    try {
      const pending = loadVerifiedStudioBg3dGlbWithThree(verified, generousBudgets);
      verified.verifiedBytes[mutationIndex] = originalByte ^ 0xff;
      const result = await pending;

      expect(result.ok).toBe(true);
      expect(parsedPath).toBe("");
      expect(parsedBuffer).toBeInstanceOf(ArrayBuffer);
      expect(parsedBuffer).not.toBe(originalBuffer);
      expect(new Uint8Array(parsedBuffer as unknown as ArrayBuffer)[mutationIndex]).toBe(originalByte);
      expect(createObjectUrl).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      if (result.ok) {
        result.dispose();
        result.dispose();
      }
      expect(geometryDispose).toHaveBeenCalledTimes(1);
      expect(materialDispose).toHaveBeenCalledTimes(1);
    } finally {
      createObjectUrl.mockRestore();
      fetch.mockRestore();
    }
  });

  it("disposes the success-time parser resource snapshot without leaking removed owned or touching later app resources", async () => {
    const ownedGeometry = triangleGeometry(1);
    const ownedTexture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const ownedMaterial = new THREE.MeshBasicMaterial({ map: ownedTexture });
    const ownedMesh = new THREE.Mesh(ownedGeometry, ownedMaterial);
    const root = new THREE.Group();
    root.add(ownedMesh);
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(root));
    const ownedDisposes = [
      vi.spyOn(ownedGeometry, "dispose"),
      vi.spyOn(ownedMaterial, "dispose"),
      vi.spyOn(ownedTexture, "dispose"),
    ];

    const loaded = await loadVerifiedStudioBg3dGlbWithThree(verifiedResult(), generousBudgets);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("test GLB must load");

    const externalGeometry = triangleGeometry(1);
    const externalTexture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const externalMaterial = new THREE.MeshBasicMaterial({ map: externalTexture });
    const externalMesh = new THREE.Mesh(externalGeometry, externalMaterial);
    const externalDisposes = [
      vi.spyOn(externalGeometry, "dispose"),
      vi.spyOn(externalMaterial, "dispose"),
      vi.spyOn(externalTexture, "dispose"),
    ];
    root.remove(ownedMesh);
    root.add(externalMesh);

    expect(loaded.dispose()).toEqual({
      geometries: 1,
      materials: 1,
      textures: 1,
      renderTargets: 0,
      imageBitmaps: 0,
    });
    loaded.dispose();

    for (const dispose of ownedDisposes) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of externalDisposes) expect(dispose).not.toHaveBeenCalled();
  });

  it("rejects JSON glTF/OBJ bytes before the loader and never exposes parser-controlled error strings", async () => {
    const jsonGltf = verifiedResult(new TextEncoder().encode('{"asset":{"version":"2.0"}}'));
    const obj = verifiedResult(new TextEncoder().encode("o private-file-name\nv 0 0 0"));

    await expect(loadVerifiedStudioBg3dGlbWithThree(jsonGltf, generousBudgets)).resolves.toMatchObject({
      ok: false,
      code: "invalid-verified-glb",
    });
    await expect(loadVerifiedStudioBg3dGlbWithThree(obj, generousBudgets)).resolves.toMatchObject({
      ok: false,
      code: "invalid-verified-glb",
    });
    expect(threeLoaderMocks.parseAsync).not.toHaveBeenCalled();

    threeLoaderMocks.parseAsync.mockRejectedValueOnce(new Error("private-file-name.glb: malicious parser detail"));
    const failed = await loadVerifiedStudioBg3dGlbWithThree(verifiedResult(), generousBudgets);
    expect(failed).toMatchObject({ ok: false, code: "parse-failed" });
    expect(failed.message).not.toContain("private-file-name");
    expect(failed.message).not.toContain("malicious parser detail");
  });

  it("requires an active renderer before requesting the lazy KTX2 runtime", async () => {
    const failed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true),
      generousBudgets,
    );

    expect(failed).toMatchObject({ ok: false, code: "ktx2-renderer-unavailable" });
    expect(ktx2RuntimeMocks.create).not.toHaveBeenCalled();
    expect(threeLoaderMocks.parseAsync).not.toHaveBeenCalled();
  });

  it("uses the standards-defined core image fallback for optional Basis textures", async () => {
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(new THREE.Group()));

    const loaded = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true, false),
      generousBudgets,
    );

    expect(loaded).toMatchObject({ ok: true, textureRuntime: "standard" });
    expect(ktx2RuntimeMocks.create).not.toHaveBeenCalled();
    expect(threeLoaderMocks.setKtx2Loader).not.toHaveBeenCalled();
    if (loaded.ok) loaded.dispose();
  });

  it("attaches the lazy KTX2 loader only for parsed Basis evidence and disposes it after parsing", async () => {
    const renderer = { isWebGLRenderer: true } as unknown as THREE.WebGLRenderer;
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(new THREE.Group()));

    const loaded = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true),
      generousBudgets,
      { renderer },
    );

    expect(ktx2RuntimeMocks.create).toHaveBeenCalledWith({ renderer });
    expect(threeLoaderMocks.setKtx2Loader).toHaveBeenCalledWith(ktx2RuntimeMocks.loader);
    expect(ktx2RuntimeMocks.dispose).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({
      ok: true,
      textureRuntime: "ktx2-basis",
    });
    if (loaded.ok) loaded.dispose();
  });

  it("reports sanitized KTX2 setup/decode failures and always tears down the decoder runtime", async () => {
    const renderer = { isWebGLRenderer: true } as unknown as THREE.WebGLRenderer;
    ktx2RuntimeMocks.create.mockRejectedValueOnce(new Error("private-runtime-path"));
    const setupFailed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true),
      generousBudgets,
      { renderer },
    );
    expect(setupFailed).toMatchObject({ ok: false, code: "ktx2-runtime-unavailable" });
    expect(setupFailed.message).not.toContain("private-runtime-path");
    expect(threeLoaderMocks.parseAsync).not.toHaveBeenCalled();

    ktx2RuntimeMocks.create.mockRejectedValueOnce({ code: "renderer-unavailable" });
    const rendererFailed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true),
      generousBudgets,
      { renderer },
    );
    expect(rendererFailed).toMatchObject({ ok: false, code: "ktx2-renderer-unavailable" });

    ktx2RuntimeMocks.hasDecodeFailure.mockReturnValueOnce(true);
    threeLoaderMocks.parseAsync.mockRejectedValueOnce(new Error("private-texture-name.ktx2"));
    const decodeFailed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true),
      generousBudgets,
      { renderer },
    );
    expect(decodeFailed).toMatchObject({ ok: false, code: "ktx2-decode-failed" });
    expect(decodeFailed.message).not.toContain("private-texture-name");
    expect(ktx2RuntimeMocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects and disposes a partial scene when Three swallows a KTX2 texture error", async () => {
    const renderer = { isWebGLRenderer: true } as unknown as THREE.WebGLRenderer;
    const geometry = triangleGeometry(1);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    ktx2RuntimeMocks.hasDecodeFailure.mockReturnValue(true);
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(root));

    const failed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true, true),
      generousBudgets,
      { renderer },
    );

    expect(failed).toMatchObject({ ok: false, code: "ktx2-decode-failed" });
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(ktx2RuntimeMocks.dispose).toHaveBeenCalledOnce();
  });

  it("classifies an unrelated parser rejection separately from KTX2 decode failure", async () => {
    const renderer = { isWebGLRenderer: true } as unknown as THREE.WebGLRenderer;
    threeLoaderMocks.parseAsync.mockRejectedValueOnce(new Error("private-parser-detail"));

    const failed = await loadVerifiedStudioBg3dGlbWithThree(
      verifiedResult(minimalGlbBytes(), true, true),
      generousBudgets,
      { renderer },
    );

    expect(failed).toMatchObject({ ok: false, code: "parse-failed" });
    expect(failed.message).not.toContain("private-parser-detail");
    expect(ktx2RuntimeMocks.dispose).toHaveBeenCalledOnce();
  });

  it("disposes the parsed roots immediately when post-parse metrics exceed the selected budget", async () => {
    const geometry = triangleGeometry(1);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    threeLoaderMocks.parseAsync.mockResolvedValue(parsedGltf(root));

    const failed = await loadVerifiedStudioBg3dGlbWithThree(verifiedResult(), {
      ...generousBudgets,
      complexity: { ...generousBudgets.complexity, maxTriangles: 0 },
    });

    expect(failed).toMatchObject({ ok: false, code: "triangle-budget-exceeded" });
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("enforces the scene model-byte budget before dynamically parsing", async () => {
    const failed = await loadVerifiedStudioBg3dGlbWithThree(verifiedResult(), {
      ...generousBudgets,
      complexity: { ...generousBudgets.complexity, maxModelBytes: 19 },
    });

    expect(failed).toMatchObject({ ok: false, code: "model-byte-budget-exceeded" });
    expect(threeLoaderMocks.parseAsync).not.toHaveBeenCalled();
  });
});
