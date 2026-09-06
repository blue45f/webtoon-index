import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadVerifiedStudioBg3dGlbWithThree } from "../studio-background-3d-model";

import {
  SAMPLE_BG3D_MODEL_ENTRIES,
  admitStoredBg3dModelForRenderingV12,
  createStudioBg3dModelAttachment,
  getStoredBg3dModelV12,
  resolveStudioBg3dModelAttachmentSource,
} from "./bg3d-model-library";
import { STUDIO_BG3D_BUNDLED_ENVIRONMENT_LIBRARY_ENTRIES } from "./studio-bg3d-bundled-environment-library";
import {
  STUDIO_BG3D_ENVIRONMENT_ASSETS,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V4,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V5,
  getStudioBg3dEnvironmentAsset,
  getStudioBg3dEnvironmentAssetByHash,
  isStudioBg3dEnvironmentAssetId,
  type StudioBg3dEnvironmentAsset,
} from "./studio-bg3d-environment-catalog";
import { resolveStudioBg3dModelNormalizationScale } from "./studio-bg3d-model-runtime-admission";
import { measureStudioBg3dPhysicsModelLocalBounds } from "./studio-bg3d-physics-three";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const MAX_ENVIRONMENT_BYTES = 5_000_000;
const MAX_MOBILE_NODES = 256;
const MAX_MOBILE_DRAW_CALLS = 256;

interface GltfAccessor {
  readonly count: number;
  readonly min?: readonly number[];
}

interface GltfPrimitive {
  readonly indices?: number;
  readonly mode?: number;
  readonly attributes?: { readonly POSITION?: number };
}

interface GltfMaterial {
  readonly name?: string;
  readonly normalTexture?: { readonly index?: number };
  readonly pbrMetallicRoughness?: {
    readonly baseColorTexture?: { readonly index?: number };
    readonly metallicFactor?: number;
    readonly roughnessFactor?: number;
  };
  readonly extras?: Readonly<Record<string, unknown>>;
}

interface GltfDocument {
  readonly asset?: { readonly version?: string; readonly generator?: string };
  readonly accessors?: readonly GltfAccessor[];
  readonly buffers?: readonly { readonly byteLength?: number; readonly uri?: string }[];
  readonly bufferViews?: readonly {
    readonly buffer?: number;
    readonly byteOffset?: number;
    readonly byteLength?: number;
  }[];
  readonly images?: readonly {
    readonly bufferView?: number;
    readonly mimeType?: string;
    readonly name?: string;
    readonly uri?: string;
  }[];
  readonly textures?: readonly { readonly source?: number }[];
  readonly materials?: readonly GltfMaterial[];
  readonly meshes?: readonly { readonly primitives?: readonly GltfPrimitive[] }[];
  readonly nodes?: readonly {
    readonly name?: string;
    readonly mesh?: number;
    readonly matrix?: readonly number[];
    readonly rotation?: readonly number[];
    readonly scale?: readonly number[];
    readonly translation?: readonly number[];
    readonly extras?: Readonly<Record<string, unknown>>;
  }[];
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly scene?: number;
  readonly cameras?: readonly unknown[];
  readonly animations?: readonly unknown[];
  readonly skins?: readonly unknown[];
  readonly extensionsRequired?: readonly string[];
}

const EXPECTED_METRICS = Object.freeze({
  "korean_convenience_store_night.glb": {
    nodes: 21,
    meshes: 20,
    materials: 15,
    triangles: 74_536,
    runtimeBounds: {
      min: [-5.4, 0, -4],
      max: [5.4, 3.76, 4.95],
    },
    ground: "Store_Floor",
    tokens: [
      "Store_BrandSign",
      "Fridge_1_Cabinet",
      "Aisle_1_Base",
      "Checkout_Counter",
      "HotFood_Counter",
      "Window_EatingBar",
    ],
  },
  "seoul_subway_platform.glb": {
    nodes: 21,
    meshes: 20,
    materials: 10,
    triangles: 99_656,
    runtimeBounds: {
      min: [-7.925, -0.07, -10],
      max: [5.5, 4.49, 10],
    },
    ground: "Platform_Slab",
    tokens: [
      "Track_Bed",
      "ScreenDoorBay_1_Glass",
      "Tactile_Base",
      "Platform_Pillar_1",
      "Bench_1_Seat_1",
      "RouteMap_1_Panel",
      "DestinationBoard_Main",
    ],
  },
  "fantasy_alchemist_workshop_library.glb": {
    nodes: 27,
    meshes: 26,
    materials: 15,
    triangles: 76_244,
    runtimeBounds: {
      min: [-6, -0.107, -5],
      max: [6, 5.7, 5],
    },
    ground: "Workshop_Floor",
    tokens: [
      "Library_BackLeft_Back",
      "Alchemy_TableBase",
      "Cauldron_Bowl",
      "Retort_1_Bulb",
      "PotionRack_Shelf_1",
      "Ingredient_Workbench",
      "CrystalCluster_1_Core",
      "Chandelier_Ring",
    ],
  },
} as const);

function publicAssetPath(url: string): string {
  return fileURLToPath(new URL(`../../../../public${url}`, import.meta.url));
}

function parseEnvironmentGlb(asset: StudioBg3dEnvironmentAsset) {
  const bytes = new Uint8Array(readFileSync(publicAssetPath(asset.url)));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(GLB_JSON_CHUNK);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as GltfDocument;
  const binaryHeaderOffset = 20 + jsonLength;
  expect(view.getUint32(binaryHeaderOffset + 4, true)).toBe(GLB_BINARY_CHUNK);
  const binaryByteLength = view.getUint32(binaryHeaderOffset, true);
  const binaryOffset = binaryHeaderOffset + 8;
  expect(binaryOffset + binaryByteLength).toBeLessThanOrEqual(bytes.byteLength);
  let triangles = 0;
  let drawCalls = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      expect(primitive.mode ?? 4).toBe(4);
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      triangles += accessorIndex === undefined
        ? 0
        : Math.floor((document.accessors?.[accessorIndex]?.count ?? 0) / 3);
      drawCalls += 1;
    }
  }
  return { bytes, document, triangles, drawCalls, binaryOffset };
}

async function loadEnvironmentScene(asset: StudioBg3dEnvironmentAsset): Promise<THREE.Group> {
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
    width: 128,
    height: 128,
    close() {},
  }) as unknown as ImageBitmap));
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const bytes = new Uint8Array(readFileSync(publicAssetPath(asset.url)));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return (await new GLTFLoader().parseAsync(buffer, "")).scene;
}

function disposeEnvironmentScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standardMaterial = material as THREE.MeshStandardMaterial;
      standardMaterial.map?.dispose();
      standardMaterial.normalMap?.dispose();
      standardMaterial.dispose();
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio BG3D Blender 5.2 Wave 5 environment pack", () => {
  it("adds three missing production settings without replacing the nine legacy environments", () => {
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3).toHaveLength(6);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V4).toHaveLength(3);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V5).toHaveLength(3);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS).toEqual([
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V4,
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V5,
    ]);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS).toHaveLength(12);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ id }) => id)).size).toBe(12);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ fileName }) => fileName)).size).toBe(12);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ sha256 }) => sha256)).size).toBe(12);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.map(({ theme }) => theme)).toEqual([
      "retail",
      "transit",
      "fantasy",
    ]);
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V5) {
      expect(asset.url).toBe(`/assets/3d/environments/${asset.fileName}`);
      expect(asset.thumbnailUrl).toBe(
        `/assets/3d/environments/thumbnails/${asset.fileName.replace(/\.glb$/u, ".png")}`,
      );
      expect(asset.normalization).toBe("authored-metres");
      expect(asset.provenance).toEqual(expect.objectContaining({
        origin: "original-procedural",
        author: "ToonSpectrum",
        generator: "scripts/blender/generate_environment_pack_v5.py",
        blenderVersion: "5.2",
        license: "CC0-1.0",
        attributionRequired: false,
        commercialUse: true,
        externalResources: 0,
      }));
      expect(getStudioBg3dEnvironmentAsset(asset.id)).toBe(asset);
      expect(getStudioBg3dEnvironmentAssetByHash(asset.sha256)).toBe(asset);
      expect(isStudioBg3dEnvironmentAssetId(asset.id)).toBe(true);
      expect(resolveStudioBg3dModelNormalizationScale(asset.id, asset.bounds)).toBe(1);
      expect(resolveStudioBg3dModelAttachmentSource(asset.id)).toBe("bundled");
    }
  });

  it.each(STUDIO_BG3D_ENVIRONMENT_ASSETS_V5)(
    "$fileName has immutable bytes, embedded 128px PBR detail, and mobile-safe scene structure",
    (asset) => {
      const expected = EXPECTED_METRICS[asset.fileName as keyof typeof EXPECTED_METRICS];
      const { bytes, document, triangles, drawCalls, binaryOffset } = parseEnvironmentGlb(asset);
      expect(bytes.byteLength).toBe(asset.byteSize);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(asset.sha256);
      expect(bytes.byteLength).toBeGreaterThan(2_000_000);
      expect(bytes.byteLength).toBeLessThan(MAX_ENVIRONMENT_BYTES);
      expect(document.asset?.version).toBe("2.0");
      expect(document.asset?.generator).toContain("Khronos glTF Blender I/O");
      expect(document.nodes).toHaveLength(expected.nodes);
      expect(document.meshes).toHaveLength(expected.meshes);
      expect(document.materials).toHaveLength(expected.materials);
      expect(triangles).toBe(expected.triangles);
      expect(triangles).toBeGreaterThanOrEqual(50_000);
      expect(triangles).toBeLessThanOrEqual(120_000);
      expect(expected.nodes).toBeLessThanOrEqual(MAX_MOBILE_NODES);
      expect(drawCalls).toBe(expected.meshes);
      expect(drawCalls).toBeLessThanOrEqual(MAX_MOBILE_DRAW_CALLS);
      expect(document.cameras ?? []).toEqual([]);
      expect(document.animations ?? []).toEqual([]);
      expect(document.skins ?? []).toEqual([]);
      expect(document.extensionsRequired ?? []).toEqual([]);
      expect((document.buffers ?? []).every(({ uri }) => uri === undefined)).toBe(true);
      expect(document.images).toHaveLength(2);
      expect(document.textures).toHaveLength(2);
      expect((document.images ?? []).every(({ uri }) => uri === undefined)).toBe(true);

      for (const image of document.images ?? []) {
        expect(image.mimeType).toBe("image/png");
        expect(image.name).toMatch(/_(?:Color|Normal)128$/u);
        expect(image.bufferView).toEqual(expect.any(Number));
        const bufferView = document.bufferViews?.[image.bufferView!];
        expect(bufferView?.buffer ?? 0).toBe(0);
        const imageOffset = binaryOffset + (bufferView?.byteOffset ?? 0);
        const imageLength = bufferView?.byteLength ?? 0;
        const imageBytes = bytes.subarray(imageOffset, imageOffset + imageLength);
        expect([...imageBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        const png = new DataView(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
        expect(png.getUint32(16, false)).toBe(128);
        expect(png.getUint32(20, false)).toBe(128);
      }

      expect(document.materials?.every((material) =>
        Boolean(material.name && material.pbrMetallicRoughness)
        && material.extras?.toonspectrum_pbr === true
        && material.extras?.toonspectrum_mtoon_compatible === true,
      )).toBe(true);
      const detailedMaterial = document.materials?.find((material) =>
        material.normalTexture?.index === 0
        && material.pbrMetallicRoughness?.baseColorTexture?.index === 1,
      );
      expect(detailedMaterial?.extras).toMatchObject({
        embedded_texture_count: 2,
        embedded_texture_dimension: 128,
      });

      const rootName = `TS_ENV_${asset.fileName.replace(/\.glb$/u, "")}_Root`;
      const root = document.nodes?.find(({ name }) => name === rootName);
      expect(root?.extras).toMatchObject({
        asset_id: asset.id,
        asset_type: "studio-bg3d-environment",
        asset_author: "ToonSpectrum",
        asset_generator: "scripts/blender/generate_environment_pack_v5.py",
        asset_generator_version: "5.0.0-blender-5.2",
        asset_license: "CC0-1.0",
        asset_license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
        units: "metres",
        ground_plane: "glTF-Y=0",
        ground_y_m: 0,
        nominal_width_m: asset.bounds[0],
        nominal_height_m: asset.bounds[1],
        nominal_depth_m: asset.bounds[2],
        embedded_texture_count: 2,
        embedded_texture_max_dimension: 128,
      });
      expect(String(root?.extras?.semantic_parts ?? "").split(",").length)
        .toBeGreaterThanOrEqual(9);

      const nodeNames = (document.nodes ?? []).flatMap(({ name }) => name ? [name] : []);
      expect(nodeNames).toContain(expected.ground);
      for (const token of expected.tokens) expect(nodeNames).toContain(token);
      const groundNode = document.nodes?.find(({ name }) => name === expected.ground);
      const groundPrimitive = groundNode?.mesh === undefined
        ? undefined
        : document.meshes?.[groundNode.mesh]?.primitives?.[0];
      const positionAccessor = groundPrimitive?.attributes?.POSITION;
      const localGroundMinimum = positionAccessor === undefined
        ? Number.NaN
        : document.accessors?.[positionAccessor]?.min?.[1] ?? Number.NaN;
      expect((groundNode?.translation?.[1] ?? 0) + localGroundMinimum).toBeCloseTo(0, 5);

      const thumbnail = new Uint8Array(readFileSync(publicAssetPath(asset.thumbnailUrl)));
      const thumbnailView = new DataView(
        thumbnail.buffer,
        thumbnail.byteOffset,
        thumbnail.byteLength,
      );
      expect([...thumbnail.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(thumbnailView.getUint32(16, false)).toBe(640);
      expect(thumbnailView.getUint32(20, false)).toBe(400);
    },
  );

  it.each(STUDIO_BG3D_ENVIRONMENT_ASSETS_V5)(
    "$fileName bakes consolidated transforms so runtime and precise bounds agree",
    async (asset) => {
      const expected = EXPECTED_METRICS[asset.fileName as keyof typeof EXPECTED_METRICS];
      const { document } = parseEnvironmentGlb(asset);
      const batchNodes = (document.nodes ?? []).filter(({ name }) => name?.includes("_Batch_"));
      expect(batchNodes.length).toBeGreaterThanOrEqual(8);
      for (const node of batchNodes) {
        expect(node.matrix).toBeUndefined();
        expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
        expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
      }

      const scene = await loadEnvironmentScene(asset);
      try {
        const runtimeBounds = new THREE.Box3().setFromObject(scene);
        const preciseBounds = new THREE.Box3().setFromObject(scene, true);
        for (const axis of ["x", "y", "z"] as const) {
          expect(runtimeBounds.min[axis]).toBeCloseTo(preciseBounds.min[axis], 5);
          expect(runtimeBounds.max[axis]).toBeCloseTo(preciseBounds.max[axis], 5);
        }
        expect(runtimeBounds.min.toArray()).toEqual(expect.arrayContaining(
          expected.runtimeBounds.min.map((value) => expect.closeTo(value, 4)),
        ));
        expect(runtimeBounds.max.toArray()).toEqual(expect.arrayContaining(
          expected.runtimeBounds.max.map((value) => expect.closeTo(value, 4)),
        ));

        const physicsBounds = measureStudioBg3dPhysicsModelLocalBounds(scene);
        expect(physicsBounds).not.toBeNull();
        const runtimeCenter = runtimeBounds.getCenter(new THREE.Vector3());
        const runtimeHalfExtents = runtimeBounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        physicsBounds?.center.forEach((value, index) => {
          expect(value).toBeCloseTo(runtimeCenter.getComponent(index), 5);
        });
        physicsBounds?.halfExtents.forEach((value, index) => {
          expect(value).toBeCloseTo(runtimeHalfExtents.getComponent(index), 5);
        });
      } finally {
        disposeEnvironmentScene(scene);
      }
    },
  );

  it("passes all three real binaries through strict mobile verification and bundled attachment creation", async () => {
    const bytesByUrl = new Map<string, Uint8Array>(STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.map((asset) => [
      asset.url,
      new Uint8Array(readFileSync(publicAssetPath(asset.url))),
    ] as const));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const bytes = bytesByUrl.get(String(input));
      if (!bytes) return {
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "content-length": String(bytes.byteLength),
          "content-type": "model/gltf-binary",
        }),
        arrayBuffer: async () => Uint8Array.from(bytes).buffer as ArrayBuffer,
      };
    });
    vi.stubGlobal("fetch", fetcher);

    for (const [index, asset] of STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.entries()) {
      const expected = EXPECTED_METRICS[asset.fileName as keyof typeof EXPECTED_METRICS];
      const record = await getStoredBg3dModelV12(asset.id, { executionBackend: "direct" });
      expect(record).not.toBeNull();
      expect(record).toMatchObject({
        id: asset.id,
        storageVersion: 2,
        format: "glb",
        contentHash: asset.sha256,
        byteSize: asset.byteSize,
        validatorProfile: "mobile",
        validatorMetrics: {
          nodes: expected.nodes,
          meshes: expected.meshes,
          meshPrimitives: expected.meshes,
          drawCalls: expected.meshes,
          triangles: expected.triangles,
          materials: expected.materials,
          textures: 2,
          images: 2,
          maxImageDimension: 128,
        },
        rights: {
          status: "public-domain",
          commercialUse: true,
          attributionRequired: false,
        },
      });
      expect(record!.validatorMetrics.nodes).toBeLessThanOrEqual(MAX_MOBILE_NODES);
      expect(record!.validatorMetrics.drawCalls).toBeLessThanOrEqual(MAX_MOBILE_DRAW_CALLS);
      const attachment = createStudioBg3dModelAttachment(record!, {
        attachmentId: `wave5-bundled-${index + 1}`,
      });
      expect(attachment).toMatchObject({
        id: `wave5-bundled-${index + 1}`,
        source: "bundled",
        hash: asset.sha256,
        byteSize: asset.byteSize,
      });

      vi.stubGlobal("self", globalThis);
      vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
        width: 128,
        height: 128,
        close() {},
      }) as unknown as ImageBitmap));
      const verified = await admitStoredBg3dModelForRenderingV12(asset.id, {
        profile: "mobile",
        executionBackend: "direct",
      });
      const loaded = await loadVerifiedStudioBg3dGlbWithThree(
        verified,
        DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
      );
      expect(loaded).toMatchObject({
        ok: true,
        code: "loaded",
        metrics: {
          // GLTFLoader adds its Scene wrapper around the authored glTF nodes.
          nodes: expected.nodes + 1,
          drawCalls: expected.meshes,
          triangles: expected.triangles,
        },
      });
      if (loaded.ok) loaded.dispose();
    }
    const bundledAssetCalls = fetcher.mock.calls.filter(([input]) =>
      STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.some((asset) => String(input) === asset.url),
    );
    expect(bundledAssetCalls).toHaveLength(3);
    for (const [index, asset] of STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.entries()) {
      expect(bundledAssetCalls[index]).toEqual([asset.url, {
        cache: "force-cache",
        credentials: "same-origin",
      }]);
    }
  });

  it("projects all twelve bundled cards independently of local OPFS availability", () => {
    expect(SAMPLE_BG3D_MODEL_ENTRIES).toHaveLength(12);
    expect(STUDIO_BG3D_BUNDLED_ENVIRONMENT_LIBRARY_ENTRIES).toHaveLength(12);
    expect(STUDIO_BG3D_BUNDLED_ENVIRONMENT_LIBRARY_ENTRIES.map(({ id }) => id)).toEqual(
      STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ id }) => id),
    );
    expect(STUDIO_BG3D_BUNDLED_ENVIRONMENT_LIBRARY_ENTRIES.slice(-3)).toEqual(
      STUDIO_BG3D_ENVIRONMENT_ASSETS_V5.map((asset) => expect.objectContaining({
        id: asset.id,
        source: "sample",
        status: "verified",
        canUse: true,
        contentHash: asset.sha256,
        byteSize: asset.byteSize,
        commercialUse: true,
      })),
    );
  });

  it("keeps the Blender generator scene-safe and documents exact CC0 provenance", () => {
    const generator = readFileSync(
      fileURLToPath(new URL("../../../../../../scripts/blender/generate_environment_pack_v5.py",
        import.meta.url,
      )),
      "utf8",
    );
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V5) {
      expect(generator).toContain(asset.fileName.replace(/\.glb$/u, ""));
    }
    expect(generator).toContain("def clear_scene():");
    expect(generator).toContain("def consolidate_repeated_meshes(");
    expect(generator).toContain(
      "bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)",
    );
    expect(generator).toContain("bpy.data.objects.remove(obj, do_unlink=True)");
    expect(generator).toContain("image.pack()");
    expect(generator).toContain('export_format="GLB"');
    expect(generator).toContain('export_extras=True');
    expect(generator).toContain('export_yup=True');
    expect(generator).not.toContain("bpy.ops.wm.read_factory_settings");
    expect(generator).not.toContain("bpy.ops.wm.read_homefile");

    const licenses = readFileSync(
      fileURLToPath(new URL("../../../../public/assets/3d/ENVIRONMENT_LICENSES.md", import.meta.url)),
      "utf8",
    );
    expect(licenses).toContain("generate_environment_pack_v5.py");
    expect(licenses).toContain("embedded 128×128 detail maps");
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V5) {
      expect(licenses).toContain(asset.id);
      expect(licenses).toContain(asset.fileName);
      expect(licenses).toContain(asset.sha256.replace(/^sha256:/u, ""));
      expect(licenses).toContain(asset.byteSize.toLocaleString("en-US"));
    }
  });
});
