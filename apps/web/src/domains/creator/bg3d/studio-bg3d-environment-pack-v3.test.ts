import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SAMPLE_BG3D_MODEL_ENTRIES,
  getStoredBg3dModelV12,
} from "./bg3d-model-library";
import { loadStudioBg3dBundledEnvironmentSource } from "./studio-bg3d-bundled-environment-loader";
import {
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
  getStudioBg3dEnvironmentAsset,
  getStudioBg3dEnvironmentAssetByHash,
  isStudioBg3dEnvironmentAssetId,
} from "./studio-bg3d-environment-catalog";
import { resolveStudioBg3dModelNormalizationScale } from "./studio-bg3d-model-runtime-admission";

const JSON_CHUNK_TYPE = 0x4e4f534a;
const MAX_ENVIRONMENT_BYTES = 5 * 1024 * 1024;
const MAX_MOBILE_NODES_AND_DRAWS = 256;
const MAX_MOBILE_TRIANGLES = 500_000;

interface GltfAccessor {
  readonly count: number;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

interface GltfPrimitive {
  readonly indices?: number;
  readonly attributes?: { readonly POSITION?: number };
}

interface GltfDocument {
  readonly asset?: { readonly version?: string; readonly generator?: string };
  readonly accessors?: readonly GltfAccessor[];
  readonly buffers?: readonly { readonly uri?: string }[];
  readonly images?: readonly { readonly uri?: string }[];
  readonly materials?: readonly {
    readonly name?: string;
    readonly pbrMetallicRoughness?: unknown;
  }[];
  readonly meshes?: readonly { readonly primitives?: readonly GltfPrimitive[] }[];
  readonly nodes?: readonly {
    readonly name?: string;
    readonly mesh?: number;
    readonly translation?: readonly number[];
    readonly extras?: Readonly<Record<string, unknown>>;
  }[];
  readonly extensionsRequired?: readonly string[];
}

interface ParsedEnvironmentGlb {
  readonly bytes: Uint8Array;
  readonly document: GltfDocument;
  readonly triangles: number;
}

const REQUIRED_NODE_TOKENS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "compact_apartment_interior.glb": ["Kitchen_", "Sofa_", "Bed_", "Dining"],
  "stylized_cafe_interior.glb": ["Cafe_Service", "Espresso", "CafeTable_", "Pendant_"],
  "urban_neon_alley.glb": ["Alley_Street", "FireEscape_", "UtilityPipe_", "NeonSign_"],
  "classroom_art_studio.glb": ["Easel_", "Stool_", "Sculpture_", "PaintJar_"],
  "fantasy_ruin_courtyard.glb": ["Ruin_CourtyardFloor", "Column_", "Arch_", "Fountain_"],
  "scifi_command_corridor.glb": ["Scifi_Deck", "Rib_", "Console_", "Hologram_"],
});

function publicAssetPath(url: string): string {
  return fileURLToPath(new URL(`../../../../public${url}`, import.meta.url));
}

function parseEnvironmentGlb(url: string): ParsedEnvironmentGlb {
  const bytes = new Uint8Array(readFileSync(publicAssetPath(url)));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(JSON_CHUNK_TYPE);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as GltfDocument;
  let triangles = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = accessorIndex === undefined
        ? 0
        : document.accessors?.[accessorIndex]?.count ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return { bytes, document, triangles };
}

function findGroundNode(document: GltfDocument) {
  return document.nodes?.find((node) =>
    node.mesh !== undefined && /(?:Floor|Street|Deck)$/u.test(node.name ?? ""),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio BG3D Blender 5.2 environment pack", () => {
  it("contains six distinct CC0 catalog entries with exact immutable URL mappings", () => {
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3).toHaveLength(6);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3.map(({ id }) => id)).size).toBe(6);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3.map(({ fileName }) => fileName)).size).toBe(6);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3.map(({ theme }) => theme)).toEqual([
      "home",
      "hospitality",
      "urban",
      "education",
      "fantasy",
      "science-fiction",
    ]);
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V3) {
      expect(asset.url).toBe(`/assets/3d/environments/${asset.fileName}`);
      expect(asset.thumbnailUrl).toBe(
        `/assets/3d/environments/thumbnails/${asset.fileName.replace(/\.glb$/u, ".png")}`,
      );
      expect(asset.normalization).toBe("authored-metres");
      expect(asset.provenance).toMatchObject({
        author: "ToonSpectrum",
        license: "CC0-1.0",
        attributionRequired: false,
        commercialUse: true,
        externalResources: 0,
      });
      expect(getStudioBg3dEnvironmentAsset(asset.id)).toBe(asset);
      expect(getStudioBg3dEnvironmentAssetByHash(asset.sha256)).toBe(asset);
      expect(isStudioBg3dEnvironmentAssetId(asset.id)).toBe(true);
    }
  });

  it.each(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3)(
    "$fileName is substantial, mobile-admissible, self-contained, PBR, grounded, and reproducible",
    (asset) => {
      const { bytes, document, triangles } = parseEnvironmentGlb(asset.url);
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(bytes.byteLength).toBe(asset.byteSize);
      expect(`sha256:${digest}`).toBe(asset.sha256);
      expect(bytes.byteLength).toBeGreaterThan(1_000_000);
      expect(bytes.byteLength).toBeLessThan(MAX_ENVIRONMENT_BYTES);
      expect(document.asset?.version).toBe("2.0");
      expect(document.asset?.generator).toContain("Khronos glTF Blender I/O");
      expect(document.nodes?.length).toBeGreaterThanOrEqual(100);
      expect(document.nodes?.length).toBeLessThanOrEqual(MAX_MOBILE_NODES_AND_DRAWS);
      expect(document.meshes?.length).toBeGreaterThanOrEqual(99);
      expect(document.meshes?.length).toBeLessThanOrEqual(MAX_MOBILE_NODES_AND_DRAWS);
      expect(document.materials?.length).toBeGreaterThanOrEqual(8);
      expect(triangles).toBeGreaterThanOrEqual(40_000);
      expect(triangles).toBeLessThanOrEqual(MAX_MOBILE_TRIANGLES);
      expect(document.images ?? []).toEqual([]);
      expect((document.buffers ?? []).every((buffer) => buffer.uri === undefined)).toBe(true);
      expect(document.extensionsRequired ?? []).toEqual([]);
      expect(document.materials?.every((material) =>
        Boolean(material.name && material.pbrMetallicRoughness),
      )).toBe(true);

      const root = document.nodes?.find(({ name }) => name === `TS_ENV_${asset.fileName.replace(/\.glb$/u, "")}_Root`);
      expect(root?.extras).toMatchObject({
        asset_id: asset.id,
        asset_type: "studio-bg3d-environment",
        asset_author: "ToonSpectrum",
        asset_generator: "scripts/blender/generate_environment_pack_v3.py",
        asset_generator_version: "3.0.0-blender-5.2",
        asset_license: "CC0-1.0",
        units: "metres",
        ground_plane: "glTF-Y=0",
        ground_y_m: 0,
      });
      expect(String(root?.extras?.semantic_parts ?? "").split(",").length)
        .toBeGreaterThanOrEqual(6);

      const nodeNames = (document.nodes ?? []).flatMap(({ name }) => name ? [name] : []);
      for (const token of REQUIRED_NODE_TOKENS[asset.fileName]) {
        expect(nodeNames.some((name) => name.startsWith(token))).toBe(true);
      }
      const groundNode = findGroundNode(document);
      expect(groundNode?.mesh).toBeTypeOf("number");
      const groundPrimitive = groundNode?.mesh === undefined
        ? undefined
        : document.meshes?.[groundNode.mesh]?.primitives?.[0];
      const groundPositionAccessor = groundPrimitive?.attributes?.POSITION;
      const groundMinimum = groundPositionAccessor === undefined
        ? undefined
        : document.accessors?.[groundPositionAccessor]?.min?.[1];
      expect((groundNode?.translation?.[1] ?? 0) + (groundMinimum ?? Number.NaN))
        .toBeCloseTo(0, 5);

      const thumbnail = new Uint8Array(readFileSync(publicAssetPath(asset.thumbnailUrl)));
      const png = new DataView(thumbnail.buffer, thumbnail.byteOffset, thumbnail.byteLength);
      expect([...thumbnail.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.getUint32(16, false)).toBe(640);
      expect(png.getUint32(20, false)).toBe(400);
    },
  );

  it("coalesces default fetches and returns defensive byte clones before existing validation", async () => {
    const asset = STUDIO_BG3D_ENVIRONMENT_ASSETS_V3[0];
    const deployedBytes = new Uint8Array(readFileSync(publicAssetPath(asset.url)));
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(deployedBytes.byteLength),
        "content-type": "model/gltf-binary",
      }),
      arrayBuffer: async () => Uint8Array.from(deployedBytes).buffer as ArrayBuffer,
    }));
    vi.stubGlobal("fetch", fetcher);

    const [first, second] = await Promise.all([
      loadStudioBg3dBundledEnvironmentSource(asset.id),
      loadStudioBg3dBundledEnvironmentSource(asset.id),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(asset.url, {
      cache: "force-cache",
      credentials: "same-origin",
    });
    expect(first.bytes).not.toBe(second.bytes);
    expect(first.bytes).toEqual(deployedBytes);
    first.bytes[0] = 0;
    expect(second.bytes[0]).toBe(0x67);
  });

  it("drops a same-size SHA-mismatched source so a repaired deployment can retry", async () => {
    const asset = STUDIO_BG3D_ENVIRONMENT_ASSETS_V3[4];
    const deployedBytes = new Uint8Array(readFileSync(publicAssetPath(asset.url)));
    const corruptedBytes = Uint8Array.from(deployedBytes);
    corruptedBytes[corruptedBytes.length - 1] ^= 0x01;
    let responseBytes = corruptedBytes;
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(responseBytes.byteLength),
        "content-type": "model/gltf-binary",
      }),
      arrayBuffer: async () => Uint8Array.from(responseBytes).buffer as ArrayBuffer,
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(getStoredBg3dModelV12(asset.id, { executionBackend: "direct" })).rejects.toThrow();
    responseBytes = deployedBytes;
    const recovered = await getStoredBg3dModelV12(asset.id, { executionBackend: "direct" });
    expect(recovered?.contentHash).toBe(asset.sha256);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("publishes the environments as usable samples and preserves metres through insertion", async () => {
    expect(SAMPLE_BG3D_MODEL_ENTRIES).toEqual(expect.arrayContaining(
      STUDIO_BG3D_ENVIRONMENT_ASSETS_V3.map((asset) => expect.objectContaining({
        id: asset.id,
        name: asset.name,
        source: "sample",
        thumbnail: asset.thumbnailUrl,
        status: "verified",
        canUse: true,
        contentHash: asset.sha256,
        byteSize: asset.byteSize,
        commercialUse: true,
      })),
    ));
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V3) {
      expect(resolveStudioBg3dModelNormalizationScale(asset.id, asset.bounds)).toBe(1);
    }
    expect(resolveStudioBg3dModelNormalizationScale("uploaded-chair", [10, 2, 2]))
      .toBeCloseTo(0.2, 8);

    const { readStudioBg3dEditorSource } = await import("./read-studio-bg3d-editor-source");
    const editorSource = readStudioBg3dEditorSource();
    const panelSource = readFileSync(
      fileURLToPath(new URL("./StudioBg3dAssetLibraryPanel.tsx", import.meta.url)),
      "utf8",
    );
    expect(editorSource).toContain("createStudioBg3dModelAttachment(record)");
    expect(editorSource).not.toContain('{ source: "bundled" }');
    expect(editorSource).toContain("onAdd={addCustomModelToScene}");
    expect(panelSource).toContain('{ id: "environment", label: "환경" }');
    expect(panelSource).toContain("bundledEnvironment?.description");
  });
});
