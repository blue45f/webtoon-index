import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  STUDIO_BG3D_STABLE_ID_PROFILE,
} from "./studio-bg3d-artifact-capture-v2";
import {
  createStudioBg3dBabylonCaptureExecutor,
  runStudioBg3dBabylonBoundedImport,
  type GlbBudgetFootprint,
  type StudioBg3dBabylonCapturePlan,
} from "./studio-bg3d-babylon-artifact-capture";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  normalizeStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type { StudioBg3dBabylonSpecialistExecutionContext } from "./studio-bg3d-babylon-specialist-runtime";
import type {
  StudioBg3dRuntimeAssetSnapshot,
  StudioBg3dSpecialistResult,
  StudioBg3dSpecialistRequest,
} from "./studio-bg3d-runtime-adapter";
import type { ISceneLoaderAsyncResult } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";

function context(
  request: StudioBg3dSpecialistRequest,
  options: {
    readonly assets?: readonly StudioBg3dRuntimeAssetSnapshot[];
    readonly document?: StudioBg3dSceneDocument;
    readonly signal?: AbortSignal;
  } = {},
): StudioBg3dBabylonSpecialistExecutionContext {
  const document = options.document ?? DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT;
  const canonicalDocumentJson = serializeStudioBg3dSceneDocument(document);
  if (!canonicalDocumentJson) throw new Error("Invalid test document.");
  return {
    backend: "webgl2",
    engine: { dispose() {} },
    epoch: 7,
    job: {
      id: "capture-test",
      request,
      signal: options.signal ?? new AbortController().signal,
      snapshot: {
        canonicalDocumentJson,
        assets: options.assets ?? [],
        totalAssetBytes: (options.assets ?? []).reduce((sum, asset) => sum + asset.byteSize, 0),
      },
    },
    scene: { dispose() {} },
    signal: options.signal ?? new AbortController().signal,
  };
}

function artifactRequest(
  artifacts: Extract<StudioBg3dSpecialistRequest, { kind: "artifact-capture-v2" }>["artifacts"],
): Extract<StudioBg3dSpecialistRequest, { kind: "artifact-capture-v2" }> {
  return {
    kind: "artifact-capture-v2",
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    width: 2,
    height: 2,
    artifacts,
  };
}

function createGlb(root: Record<string, unknown>): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(root));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  return bytes;
}

function createTriangleGlb(): Uint8Array {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const binaryByteLength = positions.byteLength + indices.byteLength;
  const binaryChunkLength = Math.ceil(binaryByteLength / 4) * 4;
  const root = {
    asset: { version: "2.0" },
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        max: [1, 1, 0],
        min: [0, 0, 0],
        type: "VEC3",
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        max: [2],
        min: [0],
        type: "SCALAR",
      },
    ],
    buffers: [{ byteLength: binaryByteLength }],
    bufferViews: [
      { buffer: 0, byteLength: positions.byteLength, byteOffset: 0, target: 34962 },
      {
        buffer: 0,
        byteLength: indices.byteLength,
        byteOffset: positions.byteLength,
        target: 34963,
      },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.3, 0.4, 0.9, 1] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(root));
  const jsonChunkLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(
    12 + 8 + jsonChunkLength + 8 + binaryChunkLength,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonChunkLength);
  bytes.set(encoded, 20);
  const binaryHeaderOffset = 20 + jsonChunkLength;
  view.setUint32(binaryHeaderOffset, binaryChunkLength, true);
  view.setUint32(binaryHeaderOffset + 4, 0x004e4942, true);
  const binaryOffset = binaryHeaderOffset + 8;
  bytes.set(new Uint8Array(positions.buffer), binaryOffset);
  bytes.set(new Uint8Array(indices.buffer), binaryOffset + positions.byteLength);
  return bytes;
}

interface GlbPrimitiveFixture {
  readonly elementCount: number;
  readonly mode: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function createPrimitiveModeGlb(
  primitiveFixtures: readonly GlbPrimitiveFixture[],
): Uint8Array {
  const binaryChunks: {
    readonly bytes: Uint8Array;
    readonly byteOffset: number;
    readonly target: 34962 | 34963;
  }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const primitives: Record<string, unknown>[] = [];
  let binaryByteLength = 0;

  const appendChunk = (
    bytes: Uint8Array,
    target: 34962 | 34963,
  ): number => {
    binaryByteLength = Math.ceil(binaryByteLength / 4) * 4;
    const byteOffset = binaryByteLength;
    const bufferView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteLength: bytes.byteLength,
      byteOffset,
      target,
    });
    binaryChunks.push({ bytes, byteOffset, target });
    binaryByteLength += bytes.byteLength;
    return bufferView;
  };

  for (const [primitiveIndex, fixture] of primitiveFixtures.entries()) {
    const positions = new Float32Array(fixture.elementCount * 3);
    const indices = new Uint16Array(fixture.elementCount);
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < fixture.elementCount; index += 1) {
      const x = index % 3;
      const y = Math.floor(index / 3);
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      indices[index] = index;
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const positionBufferView = appendChunk(
      new Uint8Array(positions.buffer),
      34962,
    );
    const indexBufferView = appendChunk(new Uint8Array(indices.buffer), 34963);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionBufferView,
      componentType: 5126,
      count: fixture.elementCount,
      max: [maxX, maxY, 0],
      min: [0, 0, 0],
      type: "VEC3",
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexBufferView,
      componentType: 5123,
      count: fixture.elementCount,
      max: [Math.max(0, fixture.elementCount - 1)],
      min: [0],
      type: "SCALAR",
    });
    primitives.push({
      attributes: { POSITION: positionAccessor },
      indices: indexAccessor,
      material: 0,
      mode: fixture.mode,
      name: `primitive-${primitiveIndex}`,
    });
  }

  const binaryChunkLength = Math.ceil(binaryByteLength / 4) * 4;
  const root = {
    asset: { version: "2.0" },
    accessors,
    buffers: [{ byteLength: binaryByteLength }],
    bufferViews,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.3, 0.4, 0.9, 1] } }],
    meshes: [{ primitives }],
    nodes: [{ mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(root));
  const jsonChunkLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(
    12 + 8 + jsonChunkLength + 8 + binaryChunkLength,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonChunkLength);
  bytes.set(encoded, 20);
  const binaryHeaderOffset = 20 + jsonChunkLength;
  view.setUint32(binaryHeaderOffset, binaryChunkLength, true);
  view.setUint32(binaryHeaderOffset + 4, 0x004e4942, true);
  const binaryOffset = binaryHeaderOffset + 8;
  for (const chunk of binaryChunks) {
    bytes.set(chunk.bytes, binaryOffset + chunk.byteOffset);
  }
  return bytes;
}

function modelDocument(bytes: Uint8Array): StudioBg3dSceneDocument {
  return normalizeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    attachments: [{
      id: "asset-1",
      name: "Verified model.glb",
      mime: "model/gltf-binary",
      byteSize: bytes.byteLength,
      hash: `sha256:${"a".repeat(64)}`,
      rights: {
        status: "owned",
        commercialUse: true,
        attributionRequired: false,
      },
      source: "upload",
    }],
    nodes: [{
      id: "model-1",
      name: "Model",
      kind: "model",
      attachmentId: "asset-1",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    }],
  });
}

function runtimeAsset(bytes: Uint8Array): StudioBg3dRuntimeAssetSnapshot {
  return {
    attachmentId: "asset-1",
    byteSize: bytes.byteLength,
    hash: `sha256:${"a".repeat(64)}`,
    readVerifiedBytes: () => Uint8Array.from(bytes),
  };
}

async function admittedFootprint(bytes: Uint8Array): Promise<GlbBudgetFootprint> {
  let footprint: GlbBudgetFootprint | undefined;
  const execute = createStudioBg3dBabylonCaptureExecutor(async (_context, plan) => {
    footprint = plan.assets[0]?.footprint;
    return { rgba: new Uint8Array(16) };
  });
  await execute(context(
    artifactRequest([
      { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
    ]),
    {
      assets: [runtimeAsset(bytes)],
      document: modelDocument(bytes),
    },
  ));
  if (!footprint) throw new Error("Expected one admitted GLB footprint.");
  return footprint;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fakeScene(): Scene {
  return {
    animationGroups: [],
    cameras: [],
    geometries: [],
    lights: [],
    materials: [],
    meshes: [],
    morphTargetManagers: [],
    multiMaterials: [],
    particleSystems: [],
    skeletons: [],
    spriteManagers: [],
    textures: [],
    transformNodes: [],
  } as unknown as Scene;
}

function emptyImportedResult(): ISceneLoaderAsyncResult {
  return {
    animationGroups: [],
    geometries: [],
    lights: [],
    meshes: [],
    particleSystems: [],
    skeletons: [],
    spriteManagers: [],
    transformNodes: [],
  };
}

function preflight(
  overrides: Partial<GlbBudgetFootprint> = {},
): GlbBudgetFootprint {
  return {
    accessorElements: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    animations: 0,
    decodedGeometryBytes: 0,
    drawCalls: 0,
    joints: 0,
    lights: 0,
    materialSlots: overrides.materialSlots ?? overrides.materials ?? 0,
    materials: 0,
    morphTargets: 0,
    nodes: 0,
    skins: 0,
    textures: 0,
    triangles: 0,
    ...overrides,
  };
}

function disposableResource<T extends object>(properties: T): T & {
  readonly dispose: ReturnType<typeof vi.fn>;
} {
  return Object.assign(properties, { dispose: vi.fn() });
}

function triangleImportFixture(subMeshCount = 1) {
  const scene = fakeScene();
  const positionData = new Float32Array(9);
  const indexData = new Uint16Array([0, 1, 2]);
  const vertexDataBuffer = { capacity: positionData.byteLength };
  const indexDataBuffer = { capacity: indexData.byteLength };
  const vertexBuffer = {
    getBuffer: () => vertexDataBuffer,
    getData: () => positionData,
    getSize: () => 3,
  };
  const geometry = disposableResource({
    getIndexBuffer: () => indexDataBuffer,
    getIndices: () => indexData,
    getTotalIndices: () => indexData.length,
    getTotalVertices: () => 3,
    getVertexBuffer: () => vertexBuffer,
    getVerticesData: () => positionData,
    getVerticesDataKinds: () => ["position"],
  });
  const material = disposableResource({
    fillMode: 0,
    getActiveTextures: () => [],
    getClassName: () => "StandardMaterial",
  });
  const root = disposableResource({
    geometry: null,
    getTotalIndices: () => 0,
    getTotalVertices: () => 0,
    material: null,
    morphTargetManager: null,
    parent: null,
    skeleton: null,
    subMeshes: [],
  });
  const mesh = disposableResource({
    _internalMetadata: {
      gltf: {
        pointers: ["/meshes/0/primitives/0", "/nodes/0"],
      },
    },
    geometry,
    getTotalIndices: () => indexData.length,
    getTotalVertices: () => 3,
    material,
    morphTargetManager: null,
    parent: root,
    skeleton: null,
    subMeshes: Array.from({ length: subMeshCount }, () => ({})),
  });
  const attach = () => {
    scene.meshes.push(
      root as unknown as Scene["meshes"][number],
      mesh as unknown as Scene["meshes"][number],
    );
    scene.geometries.push(geometry as unknown as Scene["geometries"][number]);
    scene.materials.push(material as unknown as Scene["materials"][number]);
  };
  const imported: ISceneLoaderAsyncResult = {
    ...emptyImportedResult(),
    geometries: [geometry as unknown as ISceneLoaderAsyncResult["geometries"][number]],
    meshes: [
      root as unknown as ISceneLoaderAsyncResult["meshes"][number],
      mesh as unknown as ISceneLoaderAsyncResult["meshes"][number],
    ],
  };
  return { attach, geometry, imported, material, mesh, root, scene };
}

describe("Studio Babylon beauty/depth/normal capture executor", () => {
  it("keeps runtime metrics cheap and does not parse or render the scene", async () => {
    const render = vi.fn();
    const execute = createStudioBg3dBabylonCaptureExecutor(render);

    await expect(execute(context({ kind: "runtime-metrics" }))).resolves.toEqual({
      kind: "metrics",
      values: {
        backend: "webgl2",
        capture: "beauty-depth-normal-stable-id-v2",
        engine: "babylon",
        epoch: 7,
        initialized: true,
      },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("renders one canonical scene and emits truthful beauty/depth artifacts in request order", async () => {
    const rgba = Uint8Array.from([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);
    const depth = Float32Array.from([0, 0.25, 0.5, 1]);
    let received: StudioBg3dBabylonCapturePlan | undefined;
    const execute = createStudioBg3dBabylonCaptureExecutor(async (_context, plan) => {
      received = plan;
      return { rgba, depth };
    });

    const result = await execute(context(artifactRequest([
      { kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
      { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
    ]))) as StudioBg3dSpecialistResult;

    expect(received).toMatchObject({
      assets: [],
      backend: "webgl2",
      width: 2,
      height: 2,
      includeBeauty: true,
      includeDepth: true,
      includeMaterialId: false,
      includeNormal: false,
      includeObjectId: false,
    });
    expect(result).toMatchObject({
      kind: "studio-bg3d-artifact-capture",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
      width: 2,
      height: 2,
      artifacts: [
        {
          kind: "depth",
          profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
          data: depth,
        },
        {
          kind: "beauty",
          profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
          data: rgba,
        },
      ],
    });
    rgba[0] = 255;
    depth[0] = 1;
    expect(result.kind === "studio-bg3d-artifact-capture" && result.artifacts[0]?.data[0])
      .toBe(0);
    expect(result.kind === "studio-bg3d-artifact-capture" && result.artifacts[1]?.data[0])
      .toBe(1);
  });

  it("emits a canonical normal artifact from one renderer-owned frame", async () => {
    const normal = Uint8Array.from([
      128, 128,
      255, 128,
      128, 255,
      0, 128,
    ]);
    let received: StudioBg3dBabylonCapturePlan | undefined;
    const execute = createStudioBg3dBabylonCaptureExecutor(async (_context, plan) => {
      received = plan;
      return {
        rgba: new Uint8Array(16),
        normal,
      };
    });

    const result = await execute(context(artifactRequest([
      { kind: "normal", profile: STUDIO_BG3D_NORMAL_PROFILE },
    ]))) as StudioBg3dSpecialistResult;

    expect(received).toMatchObject({
      includeDepth: false,
      includeNormal: true,
    });
    expect(result).toMatchObject({
      kind: "studio-bg3d-artifact-capture",
      artifacts: [{
        kind: "normal",
        profile: STUDIO_BG3D_NORMAL_PROFILE,
        coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
        packing: STUDIO_BG3D_NORMAL_PACKING,
        data: normal,
      }],
    });
    normal[0] = 0;
    expect(
      result.kind === "studio-bg3d-artifact-capture" &&
      result.artifacts[0]?.data[0],
    ).toBe(128);
  });

  it("emits canonical object and material IDs with independent stable legends", async () => {
    const objectData = Uint32Array.from([0, 1, 1, 0]);
    const materialData = Uint32Array.from([0, 2, 1, 0]);
    const objectLegend = Object.freeze([
      Object.freeze({ id: 1, stableId: "obj/node~a", label: "Object A" }),
    ]);
    const materialLegend = Object.freeze([
      Object.freeze({ id: 1, stableId: "mat/node~a/primitive", label: "Material A" }),
      Object.freeze({ id: 2, stableId: "mat/node~b/primitive", label: "Material B" }),
    ]);
    let received: StudioBg3dBabylonCapturePlan | undefined;
    const execute = createStudioBg3dBabylonCaptureExecutor(async (_context, plan) => {
      received = plan;
      return {
        objectId: { data: objectData, legend: objectLegend },
        materialId: { data: materialData, legend: materialLegend },
      };
    });

    const result = await execute(context(artifactRequest([
      { kind: "material-id", profile: STUDIO_BG3D_STABLE_ID_PROFILE },
      { kind: "object-id", profile: STUDIO_BG3D_STABLE_ID_PROFILE },
    ]))) as StudioBg3dSpecialistResult;

    expect(received).toMatchObject({
      includeBeauty: false,
      includeMaterialId: true,
      includeObjectId: true,
      includeDepth: false,
      includeNormal: false,
    });
    expect(result).toMatchObject({
      kind: "studio-bg3d-artifact-capture",
      artifacts: [
        {
          kind: "material-id",
          profile: STUDIO_BG3D_STABLE_ID_PROFILE,
          data: materialData,
          legend: materialLegend,
        },
        {
          kind: "object-id",
          profile: STUDIO_BG3D_STABLE_ID_PROFILE,
          data: objectData,
          legend: objectLegend,
        },
      ],
    });
    objectData[1] = 99;
    materialData[1] = 99;
    expect(
      result.kind === "studio-bg3d-artifact-capture" &&
      result.artifacts[0]?.data[1],
    ).toBe(2);
    expect(
      result.kind === "studio-bg3d-artifact-capture" &&
      result.artifacts[1]?.data[1],
    ).toBe(1);
  });

  it("requires RGBA only when beauty is part of the requested artifact set", async () => {
    const withoutBeauty = createStudioBg3dBabylonCaptureExecutor(async () => ({
      objectId: {
        data: Uint32Array.from([0, 1, 1, 0]),
        legend: [{ id: 1, stableId: "obj/line", label: "Line" }],
      },
    }));
    await expect(withoutBeauty(context(artifactRequest([
      { kind: "object-id", profile: STUDIO_BG3D_STABLE_ID_PROFILE },
    ])))).resolves.toMatchObject({
      kind: "studio-bg3d-artifact-capture",
      artifacts: [{ kind: "object-id" }],
    });

    const missingBeauty = createStudioBg3dBabylonCaptureExecutor(async () => ({}));
    await expect(missingBeauty(context(artifactRequest([
      { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
    ])))).rejects.toMatchObject({ code: "capture-failed" });
  });

  it("loads only defensive copies of exact verified GLB snapshots", async () => {
    const bytes = createGlb({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{}],
    });
    const original = Uint8Array.from(bytes);
    let admittedBytes: Uint8Array | undefined;
    const render = vi.fn(async (_context, plan: StudioBg3dBabylonCapturePlan) => {
      admittedBytes = plan.assets[0]?.bytes;
      return {
        rgba: new Uint8Array(16),
        depth: new Float32Array(4),
      };
    });
    const execute = createStudioBg3dBabylonCaptureExecutor(render);
    await execute(context(
      artifactRequest([
        { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
        { kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
      ]),
      {
        assets: [runtimeAsset(original)],
        document: modelDocument(original),
      },
    ));

    expect(render).toHaveBeenCalledOnce();
    expect(admittedBytes).toEqual(bytes);
    expect(admittedBytes).not.toBe(original);
    original.fill(0);
    expect(admittedBytes?.[0]).toBe(0x67);
  });

  it("fails closed before rendering unsupported artifacts and scene semantics", async () => {
    const render = vi.fn();
    const execute = createStudioBg3dBabylonCaptureExecutor(render);

    await expect(execute(context(artifactRequest([
      { kind: "emission", profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE },
    ])))).rejects.toMatchObject({ code: "unsupported-artifact" });

    const orthographic = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      camera: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
        projection: "orthographic",
      },
    });
    await expect(execute(context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      { document: orthographic },
    ))).rejects.toMatchObject({ code: "unsupported-scene-feature" });
    expect(render).not.toHaveBeenCalled();
  });

  it("rejects self-externalizing or decoder-dependent GLBs before Babylon sees bytes", async () => {
    const render = vi.fn();
    const execute = createStudioBg3dBabylonCaptureExecutor(render);
    const external = createGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 8, uri: "https://example.invalid/model.bin" }],
      scene: 0,
      scenes: [{}],
    });
    await expect(execute(context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      {
        assets: [runtimeAsset(external)],
        document: modelDocument(external),
      },
    ))).rejects.toMatchObject({ code: "unsafe-glb" });

    const nestedExternal = createGlb({
      asset: { version: "2.0" },
      extensions: {
        VENDOR_payload: {
          nested: { uri: "data:application/octet-stream;base64,AA==" },
        },
      },
      scene: 0,
      scenes: [{}],
    });
    await expect(execute(context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      {
        assets: [runtimeAsset(nestedExternal)],
        document: modelDocument(nestedExternal),
      },
    ))).rejects.toMatchObject({ code: "unsafe-glb" });

    const decoderBacked = createGlb({
      asset: { version: "2.0" },
      extensionsRequired: ["KHR_draco_mesh_compression"],
      scene: 0,
      scenes: [{}],
    });
    await expect(execute(context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      {
        assets: [runtimeAsset(decoderBacked)],
        document: modelDocument(decoderBacked),
      },
    ))).rejects.toMatchObject({ code: "unsupported-scene-feature" });

    const unbudgetedTexture = createGlb({
      asset: { version: "2.0" },
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      scene: 0,
      scenes: [{}],
    });
    await expect(execute(context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      {
        assets: [runtimeAsset(unbudgetedTexture)],
        document: modelDocument(unbudgetedTexture),
      },
    ))).rejects.toMatchObject({ code: "unsupported-scene-feature" });
    expect(render).not.toHaveBeenCalled();
  });

  it("propagates abort without invoking the renderer", async () => {
    const controller = new AbortController();
    controller.abort();
    const render = vi.fn();
    const execute = createStudioBg3dBabylonCaptureExecutor(render);
    const executionContext = context(
      artifactRequest([{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }]),
      { signal: controller.signal },
    );

    await expect(execute(executionContext)).rejects.toMatchObject({ code: "aborted" });
    expect(render).not.toHaveBeenCalled();
  });
});

describe("Studio Babylon bounded GLB import boundary", () => {
  it("measures and admits a real Babylon 9.19 GLB scene delta", async () => {
    const [{ NullEngine }, { Scene: BabylonScene }] = await Promise.all([
      import("@babylonjs/core/Engines/nullEngine"),
      import("@babylonjs/core/scene"),
    ]);
    const engine = new NullEngine();
    const scene = new BabylonScene(engine);
    try {
      const result = await runStudioBg3dBabylonBoundedImport({
        bytes: createTriangleGlb(),
        budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        name: "real-triangle.glb",
        preflight: preflight({
          accessorElements: 6,
          decodedGeometryBytes: 42,
          drawCalls: 1,
          materials: 1,
          nodes: 1,
          triangles: 1,
        }),
        scene,
        signal: new AbortController().signal,
      });

      expect(result.receipt).toMatchObject({
        accessorElements: 6,
        decodedGeometryBytes: 42,
        drawCalls: 1,
        geometries: 1,
        materials: 1,
        meshes: 1,
        nodes: 1,
        runtimeNodes: 2,
        textures: 0,
        triangles: 1,
      });
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("admits a real multi-primitive GLB with logical nodes and draw-mode material slots", async () => {
    const bytes = createPrimitiveModeGlb([
      { elementCount: 2, mode: 1 },
      { elementCount: 5, mode: 5 },
      { elementCount: 4, mode: 6 },
    ]);
    const footprint = await admittedFootprint(bytes);
    expect(footprint).toMatchObject({
      accessorElements: 22,
      decodedGeometryBytes: 154,
      drawCalls: 3,
      materialSlots: 3,
      materials: 1,
      nodes: 1,
      triangles: 5,
    });

    const [{ NullEngine }, { Scene: BabylonScene }] = await Promise.all([
      import("@babylonjs/core/Engines/nullEngine"),
      import("@babylonjs/core/scene"),
    ]);
    const engine = new NullEngine();
    const scene = new BabylonScene(engine);
    try {
      const result = await runStudioBg3dBabylonBoundedImport({
        bytes,
        budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        name: "multi-mode.glb",
        preflight: footprint,
        scene,
        signal: new AbortController().signal,
      });

      expect(result.receipt).toMatchObject({
        accessorElements: 22,
        drawCalls: 3,
        geometries: 3,
        materials: 3,
        meshes: 3,
        nodes: 1,
        runtimeNodes: 5,
        triangles: 5,
      });
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("admits an exact public scene-delta receipt within preflight and document budgets", async () => {
    const fixture = triangleImportFixture();
    const importMesh = vi.fn(async () => {
      fixture.attach();
      return fixture.imported;
    });

    const result = await runStudioBg3dBabylonBoundedImport({
      bytes: new Uint8Array([1, 2, 3]),
      budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
      importMesh,
      name: "bounded.glb",
      preflight: preflight({
        accessorElements: 6,
        decodedGeometryBytes: 42,
        drawCalls: 1,
        materials: 1,
        nodes: 1,
        triangles: 1,
      }),
      scene: fixture.scene,
      signal: new AbortController().signal,
    });

    expect(importMesh).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      fixture.scene,
      {
        meshNames: null,
        name: "bounded.glb",
        pluginExtension: ".glb",
        rootUrl: "",
      },
    );
    expect(result.imported).toBe(fixture.imported);
    expect(result.receipt).toMatchObject({
      accessorElements: 6,
      decodedGeometryBytes: 42,
      drawCalls: 1,
      geometries: 1,
      materials: 1,
      meshes: 1,
      nodes: 1,
      runtimeNodes: 2,
      triangles: 1,
    });
    expect(fixture.root.dispose).not.toHaveBeenCalled();
    expect(fixture.geometry.dispose).not.toHaveBeenCalled();
  });

  it("fails closed and disposes the whole import delta when Babylon amplifies draw resources", async () => {
    const fixture = triangleImportFixture(2);
    const importMesh = vi.fn(async () => {
      fixture.attach();
      return fixture.imported;
    });

    await expect(runStudioBg3dBabylonBoundedImport({
      bytes: new Uint8Array([1, 2, 3]),
      budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
      importMesh,
      name: "amplified.glb",
      preflight: preflight({
        accessorElements: 6,
        decodedGeometryBytes: 42,
        drawCalls: 1,
        materials: 1,
        nodes: 1,
        triangles: 1,
      }),
      scene: fixture.scene,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "resource-budget-exceeded" });

    expect(fixture.root.dispose).toHaveBeenCalledOnce();
    expect(fixture.mesh.dispose).toHaveBeenCalledOnce();
    expect(fixture.geometry.dispose).toHaveBeenCalledOnce();
    expect(fixture.material.dispose).toHaveBeenCalledOnce();
  });

  it("disposes every late mesh dependency exactly once when abort wins before import resolve", async () => {
    const scene = fakeScene();
    const pendingImport = deferred<ISceneLoaderAsyncResult>();
    const importMesh = vi.fn(() => pendingImport.promise);
    const controller = new AbortController();
    const pending = runStudioBg3dBabylonBoundedImport({
      bytes: new Uint8Array([1, 2, 3]),
      budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
      importMesh,
      name: "late-abort.glb",
      preflight: preflight(),
      scene,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(importMesh).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });

    const texture = disposableResource({});
    const material = disposableResource({
      getActiveTextures: () => [texture],
      getClassName: () => "StandardMaterial",
    });
    const geometry = disposableResource({});
    const skeleton = disposableResource({ bones: [] });
    const morphTargetManager = disposableResource({});
    const root = disposableResource({
      geometry: null,
      getTotalVertices: () => 0,
      material: null,
      morphTargetManager: null,
      parent: null,
      skeleton: null,
    });
    const mesh = disposableResource({
      geometry,
      getTotalVertices: () => 3,
      material,
      morphTargetManager,
      parent: root,
      skeleton,
    });
    const animationGroup = disposableResource({});
    const transformNode = disposableResource({});
    const light = disposableResource({});
    const particleSystem = disposableResource({});
    const spriteManager = disposableResource({});
    scene.meshes.push(
      root as unknown as Scene["meshes"][number],
      mesh as unknown as Scene["meshes"][number],
    );
    scene.geometries.push(geometry as unknown as Scene["geometries"][number]);
    scene.materials.push(material as unknown as Scene["materials"][number]);
    scene.textures.push(texture as unknown as Scene["textures"][number]);
    scene.skeletons.push(skeleton as unknown as Scene["skeletons"][number]);
    scene.morphTargetManagers.push(
      morphTargetManager as unknown as Scene["morphTargetManagers"][number],
    );
    scene.animationGroups.push(
      animationGroup as unknown as Scene["animationGroups"][number],
    );
    scene.transformNodes.push(
      transformNode as unknown as Scene["transformNodes"][number],
    );
    scene.lights.push(light as unknown as Scene["lights"][number]);
    scene.particleSystems.push(
      particleSystem as unknown as Scene["particleSystems"][number],
    );
    scene.spriteManagers?.push(
      spriteManager as unknown as NonNullable<Scene["spriteManagers"]>[number],
    );
    pendingImport.resolve({
      ...emptyImportedResult(),
      animationGroups: [
        animationGroup as unknown as ISceneLoaderAsyncResult["animationGroups"][number],
      ],
      geometries: [
        geometry as unknown as ISceneLoaderAsyncResult["geometries"][number],
      ],
      lights: [light as unknown as ISceneLoaderAsyncResult["lights"][number]],
      meshes: [
        root as unknown as ISceneLoaderAsyncResult["meshes"][number],
        mesh as unknown as ISceneLoaderAsyncResult["meshes"][number],
      ],
      particleSystems: [
        particleSystem as unknown as ISceneLoaderAsyncResult["particleSystems"][number],
      ],
      skeletons: [
        skeleton as unknown as ISceneLoaderAsyncResult["skeletons"][number],
      ],
      spriteManagers: [
        spriteManager as unknown as ISceneLoaderAsyncResult["spriteManagers"][number],
      ],
      transformNodes: [
        transformNode as unknown as ISceneLoaderAsyncResult["transformNodes"][number],
      ],
    });

    await vi.waitFor(() => expect(mesh.dispose).toHaveBeenCalledOnce());
    for (const resource of [
      root,
      mesh,
      geometry,
      material,
      texture,
      skeleton,
      morphTargetManager,
      animationGroup,
      transformNode,
      light,
      particleSystem,
      spriteManager,
    ]) {
      expect(resource.dispose).toHaveBeenCalledOnce();
    }
  });

  it("cleans partial scene resources on timeout and does not dispose twice after late reject", async () => {
    vi.useFakeTimers();
    try {
      const scene = fakeScene();
      const pendingImport = deferred<ISceneLoaderAsyncResult>();
      const importMesh = vi.fn(() => pendingImport.promise);
      const partialGeometry = disposableResource({});
      const pending = runStudioBg3dBabylonBoundedImport({
        bytes: new Uint8Array([1, 2, 3]),
        budgets: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        importMesh,
        name: "late-timeout.glb",
        preflight: preflight(),
        scene,
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(importMesh).toHaveBeenCalledOnce();
      scene.geometries.push(
        partialGeometry as unknown as Scene["geometries"][number],
      );
      const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
      expect(partialGeometry.dispose).toHaveBeenCalledOnce();

      pendingImport.reject(new Error("late parser rejection"));
      await vi.advanceTimersByTimeAsync(0);
      expect(partialGeometry.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
