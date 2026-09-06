import { createHash } from "node:crypto";

import { Mesh } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  validateStudioBg3dGlb,
} from "../bg3d/studio-bg3d-glb-validation";
import { readStudioVrmExportGlb } from "../vrm/studio-vrm-export-glb-container";

import { STUDIO_LIFT3D_LIMITS } from "./studio-lift3d-contract";
import { buildStudioLift3dDepthField } from "./studio-lift3d-depth";
import { encodeStudioLift3dGlb } from "./studio-lift3d-glb";
import { extractStudioLift3dMask, resampleStudioLift3dImage } from "./studio-lift3d-mask";
import { buildStudioLift3dGeometry, type StudioLift3dGeometry } from "./studio-lift3d-mesh";
import { computeStudioLift3dNormals } from "./studio-lift3d-render-buffers";
import { discImage, encodeTestPng } from "./studio-lift3d.test-fixture";

function liftedDiscGeometry(size = 48): StudioLift3dGeometry {
  const grid = resampleStudioLift3dImage(discImage(size), size);
  const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
  const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 1 });
  const built = buildStudioLift3dGeometry(mask, depth, {
    mode: "inflate",
    depthScale: 0.3,
    targetHeight: 1.7,
  });
  if (!built.ok) throw new Error(`fixture geometry failed: ${built.detail}`);
  return built.value;
}

const texturePng = encodeTestPng(discImage(32));


describe("Studio Lift 3D GLB 인코더", () => {
  it("텍스처가 붙은 GLB 2.0 컨테이너를 낸다", () => {
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(), {
      name: "테스트 캐릭터",
      texture: { mimeType: "image/png", bytes: texturePng },
      alphaMode: "MASK",
    });

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const parsed = readStudioVrmExportGlb(encoded.value.bytes);
    const json = parsed.json as Record<string, unknown>;
    const meshes = json.meshes as { primitives: { attributes: Record<string, number> }[] }[];

    expect(meshes[0]!.primitives[0]!.attributes).toEqual({
      POSITION: 0,
      NORMAL: 1,
      TEXCOORD_0: 2,
    });
    expect(json.images).toEqual([
      expect.objectContaining({ bufferView: 4, mimeType: "image/png" }),
    ]);
    expect(encoded.value.mimeType).toBe("model/gltf-binary");
    expect(encoded.value.metrics.triangleCount).toBeGreaterThan(0);
  });

  it("저장 이름은 저장소의 GLB 이름 규칙을 그대로 따른다", () => {
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(32), { name: "../위험한 이름/x" });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.fileName).toBe("위험한 이름 x.glb");
  });

  it("Windows 예약 이름과 서로게이트 쌍을 자체 구현처럼 흘리지 않는다", () => {
    // 이 두 가지가 자체 sanitizer 를 버리고 공용 규칙을 쓰기로 한 이유다.
    const reserved = encodeStudioLift3dGlb(liftedDiscGeometry(32), { name: "con" });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.value.fileName).not.toBe("con.glb");

    const astral = encodeStudioLift3dGlb(liftedDiscGeometry(32), { name: "𝔘".repeat(200) });
    expect(astral.ok).toBe(true);
    if (!astral.ok) return;
    // 코드 단위로 자르면 짝 없는 서로게이트가 남는다.
    expect(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u.test(astral.value.fileName)).toBe(false);
  });

  it("KHR_materials_unlit 을 required 가 아니라 used 로만 선언한다", () => {
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(32), { name: "unlit" });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const json = readStudioVrmExportGlb(encoded.value.bytes).json;
    expect(json.extensionsUsed).toEqual(["KHR_materials_unlit"]);
    expect(json.extensionsRequired).toBeUndefined();
  });

  it("같은 입력이면 바이트까지 같은 파일을 낸다", () => {
    const geometry = liftedDiscGeometry(32);
    const options = { name: "결정론", texture: { mimeType: "image/png" as const, bytes: texturePng } };
    const first = encodeStudioLift3dGlb(geometry, options);
    const second = encodeStudioLift3dGlb(geometry, options);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Array.from(first.value.bytes)).toEqual(Array.from(second.value.bytes));
  });

  it("텍스처가 한도를 넘으면 형상만 내보내고 그 사실을 알린다", () => {
    const oversized = new Uint8Array(STUDIO_LIFT3D_LIMITS.maxTextureBytes + 1);
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(32), {
      name: "큰 텍스처",
      texture: { mimeType: "image/png", bytes: oversized },
    });

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.warnings.map((warning) => warning.code)).toContain("texture-omitted");
    expect(readStudioVrmExportGlb(encoded.value.bytes).json.images).toBeUndefined();
  });

  it("법선이 단위 벡터다", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = computeStudioLift3dNormals(positions, new Uint32Array([0, 1, 2]));

    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1, 6);
    }
    // +Z 를 향하는 CCW 삼각형.
    expect(normals[2]).toBeCloseTo(1, 6);
  });

  it("three 의 GLTFLoader 가 그대로 읽어 들인다", async () => {
    // 우리 검증기만 통과하고 실제 로더에서 깨지는 accessor/bufferView 실수를 잡는다.
    // 노드에는 이미지 디코더가 없으므로 텍스처 없는 파일로 지오메트리 경로만 확인한다.
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(48), { name: "로더 검증" });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const bytes = encoded.value.bytes;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(buffer, "", resolve, reject);
    });

    const meshes: Mesh[] = [];
    gltf.scene.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    expect(meshes).toHaveLength(1);
    const geometry = meshes[0]!.geometry;
    expect(geometry.attributes.uv?.count).toBe(geometry.attributes.position?.count);
    expect(geometry.index?.count ?? 0).toBeGreaterThan(0);
    expect((geometry.index?.count ?? 0) % 3).toBe(0);
  });

  it("이 앱 자신의 모델 가져오기 게이트를 통과한다", async () => {
    const encoded = encodeStudioLift3dGlb(liftedDiscGeometry(48), {
      name: "가져오기 검증",
      texture: { mimeType: "image/png", bytes: texturePng },
      alphaMode: "MASK",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const result = await validateStudioBg3dGlb(encoded.value.bytes, {
      declared: {
        byteSize: encoded.value.bytes.byteLength,
        sha256: createHash("sha256").update(encoded.value.bytes).digest("hex"),
        mimeType: "model/gltf-binary",
      },
      cumulative: { usedBytes: 0, maximumBytes: 200 * 1024 * 1024 },
      profile: "desktop",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      digest: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
    });

    expect(result.ok).toBe(true);
  });
});
