import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SAMPLE_BG3D_MODEL_ENTRIES,
  createStudioBg3dModelAttachment,
  getStoredBg3dModelV12,
  resolveStudioBg3dModelAttachmentSource,
} from "./bg3d-model-library";
import { loadStudioBg3dBundledEnvironmentSource } from "./studio-bg3d-bundled-environment-loader";
import {
  STUDIO_BG3D_ENVIRONMENT_ASSETS,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V4,
  STUDIO_BG3D_ENVIRONMENT_ASSETS_V5,
  getStudioBg3dEnvironmentAsset,
  getStudioBg3dEnvironmentAssetByHash,
  isStudioBg3dEnvironmentAssetId,
} from "./studio-bg3d-environment-catalog";
import { resolveStudioBg3dModelNormalizationScale } from "./studio-bg3d-model-runtime-admission";

const JSON_CHUNK_TYPE = 0x4e4f534a;
const MAX_ENVIRONMENT_BYTES = 5 * 1024 * 1024;

interface GltfAccessor {
  readonly count: number;
  readonly min?: readonly number[];
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

const EXPECTED_METRICS = Object.freeze({
  "hospital_emergency_nurse_station.glb": {
    nodes: 188,
    meshes: 187,
    materials: 13,
    triangles: 60_920,
    ground: "Hospital_Floor",
    tokens: ["NurseStation_", "EmergencyBed_", "VitalMonitor_", "IVStand_"],
  },
  "korean_school_rooftop.glb": {
    nodes: 204,
    meshes: 203,
    materials: 12,
    triangles: 53_000,
    ground: "SchoolRooftop_Deck",
    tokens: ["Fence_", "Stairwell_", "WaterTank_", "HVAC_", "SolarPanel_"],
  },
  "hanok_market_courtyard.glb": {
    nodes: 245,
    meshes: 244,
    materials: 14,
    triangles: 76_944,
    ground: "HanokMarket_Courtyard",
    tokens: ["Hanok_Back_", "MarketStall_", "Lantern_", "OnggiJar_"],
  },
} as const);

function publicAssetPath(url: string): string {
  return fileURLToPath(new URL(`../../../../public${url}`, import.meta.url));
}

function parseEnvironmentGlb(url: string) {
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
      triangles += accessorIndex === undefined
        ? 0
        : Math.floor((document.accessors?.[accessorIndex]?.count ?? 0) / 3);
    }
  }
  return { bytes, document, triangles };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio BG3D Blender 5.2 Wave 4 environment pack", () => {
  it("extends the six legacy assets with three stable, selectable CC0 catalog entries", () => {
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V3).toHaveLength(6);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V4).toHaveLength(3);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS).toEqual([
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V4,
      ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V5,
    ]);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS).toHaveLength(12);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ id }) => id)).size).toBe(12);
    expect(new Set(STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ fileName }) => fileName)).size).toBe(12);
    expect(STUDIO_BG3D_ENVIRONMENT_ASSETS_V4.map(({ theme }) => theme)).toEqual([
      "healthcare",
      "education",
      "heritage",
    ]);
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V4) {
      expect(asset.url).toBe(`/assets/3d/environments/${asset.fileName}`);
      expect(asset.thumbnailUrl).toBe(
        `/assets/3d/environments/thumbnails/${asset.fileName.replace(/\.glb$/u, ".png")}`,
      );
      expect(asset.normalization).toBe("authored-metres");
      expect(asset.provenance).toMatchObject({
        generator: "scripts/blender/generate_environment_pack_v4.py",
        blenderVersion: "5.2",
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

  it.each(STUDIO_BG3D_ENVIRONMENT_ASSETS_V4)(
    "$fileName has exact immutable bytes and stays within the 40k–120k mobile scene budget",
    (asset) => {
      const expected = EXPECTED_METRICS[
        asset.fileName as keyof typeof EXPECTED_METRICS
      ];
      const { bytes, document, triangles } = parseEnvironmentGlb(asset.url);
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(bytes.byteLength).toBe(asset.byteSize);
      expect(`sha256:${digest}`).toBe(asset.sha256);
      expect(bytes.byteLength).toBeGreaterThan(1_000_000);
      expect(bytes.byteLength).toBeLessThan(MAX_ENVIRONMENT_BYTES);
      expect(document.asset?.version).toBe("2.0");
      expect(document.asset?.generator).toContain("Khronos glTF Blender I/O");
      expect(document.nodes).toHaveLength(expected.nodes);
      expect(document.meshes).toHaveLength(expected.meshes);
      expect(document.materials).toHaveLength(expected.materials);
      expect(triangles).toBe(expected.triangles);
      expect(triangles).toBeGreaterThanOrEqual(40_000);
      expect(triangles).toBeLessThanOrEqual(120_000);
      expect(document.images ?? []).toEqual([]);
      expect((document.buffers ?? []).every(({ uri }) => uri === undefined)).toBe(true);
      expect(document.extensionsRequired ?? []).toEqual([]);
      expect(document.materials?.every((candidate) =>
        Boolean(candidate.name && candidate.pbrMetallicRoughness),
      )).toBe(true);

      const rootName = `TS_ENV_${asset.fileName.replace(/\.glb$/u, "")}_Root`;
      const root = document.nodes?.find(({ name }) => name === rootName);
      expect(root?.extras).toMatchObject({
        asset_id: asset.id,
        asset_type: "studio-bg3d-environment",
        asset_author: "ToonSpectrum",
        asset_generator: "scripts/blender/generate_environment_pack_v4.py",
        asset_generator_version: "4.0.0-blender-5.2",
        asset_license: "CC0-1.0",
        units: "metres",
        ground_plane: "glTF-Y=0",
        ground_y_m: 0,
      });
      expect(String(root?.extras?.semantic_parts ?? "").split(",").length)
        .toBeGreaterThanOrEqual(9);

      const nodeNames = (document.nodes ?? []).flatMap(({ name }) => name ? [name] : []);
      expect(nodeNames).toContain(expected.ground);
      for (const token of expected.tokens) {
        expect(nodeNames.some((name) => name.startsWith(token))).toBe(true);
      }
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
      const png = new DataView(thumbnail.buffer, thumbnail.byteOffset, thumbnail.byteLength);
      expect([...thumbnail.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.getUint32(16, false)).toBe(640);
      expect(png.getUint32(20, false)).toBe(400);
    },
  );

  it("maps every new catalog URL through the shared defensive GLB loader", async () => {
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V4) {
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
      const loaded = await loadStudioBg3dBundledEnvironmentSource(asset.id, { fetcher });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith(asset.url, {
        cache: "force-cache",
        credentials: "same-origin",
      });
      expect(loaded.asset).toBe(asset);
      expect(loaded.bytes.byteLength).toBe(deployedBytes.byteLength);
      expect(createHash("sha256").update(loaded.bytes).digest("hex"))
        .toBe(asset.sha256.replace(/^sha256:/u, ""));
      // 참조 비교는 Object.is 로 직접 한다 — `.not.toBe` 는 참조가 다르면 "toEqual 을
      // 쓰라"는 힌트 메시지를 위해 딥 비교를 수행하는데, 수 MB 바이트 배열에서는 그
      // 비교만 자산당 10초+ 라 이 테스트가 CI 의 30초 타임아웃으로 죽는 원인이었다.
      expect(Object.is(loaded.bytes, deployedBytes)).toBe(false);
    }
  });

  it("publishes all twelve samples at authored metres and centralizes bundled attachment provenance", async () => {
    expect(SAMPLE_BG3D_MODEL_ENTRIES).toHaveLength(12);
    expect(SAMPLE_BG3D_MODEL_ENTRIES.map(({ id }) => id)).toEqual(
      STUDIO_BG3D_ENVIRONMENT_ASSETS.map(({ id }) => id),
    );
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V4) {
      expect(resolveStudioBg3dModelNormalizationScale(asset.id, asset.bounds)).toBe(1);
      expect(resolveStudioBg3dModelAttachmentSource(asset.id)).toBe("bundled");
    }
    expect(resolveStudioBg3dModelAttachmentSource("uploaded-local-room")).toBe("local-library");

    const asset = STUDIO_BG3D_ENVIRONMENT_ASSETS_V4[0];
    const deployedBytes = new Uint8Array(readFileSync(publicAssetPath(asset.url)));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(deployedBytes.byteLength),
        "content-type": "model/gltf-binary",
      }),
      arrayBuffer: async () => Uint8Array.from(deployedBytes).buffer as ArrayBuffer,
    })));
    const record = await getStoredBg3dModelV12(asset.id, { executionBackend: "direct" });
    expect(record).not.toBeNull();
    const bundled = createStudioBg3dModelAttachment(record!, {
      attachmentId: "wave4-hospital-attachment",
    });
    expect(bundled.source).toBe("bundled");
    expect(createStudioBg3dModelAttachment({ ...record!, id: "uploaded-hospital-copy" }, {
      attachmentId: "wave4-local-attachment",
    }).source).toBe("local-library");
    expect(createStudioBg3dModelAttachment(record!, {
      attachmentId: "wave4-explicit-upload",
      source: "upload",
    }).source).toBe("upload");

    const { readStudioBg3dEditorSource } = await import("./read-studio-bg3d-editor-source");
    const editorSource = readStudioBg3dEditorSource();
    const legacyRestoreStart = editorSource.indexOf(
      "const parsed = parseBg3dSceneWithModelsFromDataUrl(initialDataUrl);",
    );
    const legacyRestoreEnd = editorSource.indexOf(
      "}, [open, initialDataUrl, initialScene, modelRenderer]);",
      legacyRestoreStart,
    );
    const legacyRestore = editorSource.slice(legacyRestoreStart, legacyRestoreEnd);
    expect(legacyRestoreStart).toBeGreaterThanOrEqual(0);
    expect(legacyRestore).toContain("createStudioBg3dModelAttachment(record)");
    expect(legacyRestore).not.toContain("source:");
  });

  it("keeps the reproducible generator safe for background or MCP-hosted Blender sessions", () => {
    const generator = readFileSync(
      fileURLToPath(new URL("../../../../../../scripts/blender/generate_environment_pack_v4.py", import.meta.url)),
      "utf8",
    );
    for (const asset of STUDIO_BG3D_ENVIRONMENT_ASSETS_V4) {
      expect(generator).toContain(asset.fileName.replace(/\.glb$/u, ""));
    }
    expect(generator).toContain("def clear_scene():");
    expect(generator).toContain("bpy.data.objects.remove(obj, do_unlink=True)");
    expect(generator).toContain('export_format="GLB"');
    expect(generator).toContain('export_yup=True');
    expect(generator).not.toContain("bpy.ops.wm.read_factory_settings");
    expect(generator).not.toContain("bpy.ops.wm.read_homefile");
  });
});
