import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MAX_JSON_BYTES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  validateStudioBg3dGlb,
  type StudioBg3dGlbBudgetProfiles,
  type StudioBg3dGlbFailureCode,
  type StudioBg3dGlbValidationOptions,
} from "./studio-bg3d-glb-validation";
import {
  attestStudioBg3dKtx2TranscoderAssets,
  type StudioBg3dKtx2TranscoderCapability,
} from "./studio-bg3d-ktx2-transcoder-contract";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function pad(bytes: Uint8Array, byte: number): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.fill(byte);
  padded.set(bytes);
  return padded;
}

function assembleGlb(chunks: readonly { type: number; bytes: Uint8Array }[]): Uint8Array {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.byteLength, 0);
  const result = new Uint8Array(total);
  writeUint32(result, 0, 0x46546c67);
  writeUint32(result, 4, 2);
  writeUint32(result, 8, total);
  let offset = 12;
  for (const chunk of chunks) {
    writeUint32(result, offset, chunk.bytes.byteLength);
    writeUint32(result, offset + 4, chunk.type);
    result.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength;
  }
  return result;
}

function makeGlbFromJsonText(jsonText: string, bin?: Uint8Array): Uint8Array {
  const json = pad(new TextEncoder().encode(jsonText), 0x20);
  const chunks = [{ type: JSON_CHUNK, bytes: json }];
  if (bin) chunks.push({ type: BIN_CHUNK, bytes: pad(bin, 0) });
  return assembleGlb(chunks);
}

function makeGlb(root: Record<string, unknown>, bin?: Uint8Array): Uint8Array {
  return makeGlbFromJsonText(JSON.stringify(root), bin);
}

function pngHeader(width: number, height: number, byteLength = 32): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function validUastcKtx2(): Uint8Array {
  const headerBytes = 80;
  const levelIndexBytes = 24;
  const dfdOffset = headerBytes + levelIndexBytes;
  const dfdByteLength = 44;
  const levelOffset = 160; // KTX2 level data begins at a 16-byte boundary.
  const levelByteLength = 16;
  const bytes = new Uint8Array(levelOffset + levelByteLength);
  const view = new DataView(bytes.buffer);

  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(12, 0, true); // vkFormat: Basis Universal payload
  view.setUint32(16, 1, true); // typeSize
  view.setUint32(20, 4, true);
  view.setUint32(24, 4, true);
  view.setUint32(28, 0, true); // 2D texture
  view.setUint32(32, 0, true); // not an array texture
  view.setUint32(36, 1, true); // one face
  view.setUint32(40, 1, true); // one mip level
  view.setUint32(44, 0, true); // UASTC without supercompression
  view.setUint32(48, dfdOffset, true);
  view.setUint32(52, dfdByteLength, true);

  view.setBigUint64(80, BigInt(levelOffset), true);
  view.setBigUint64(88, BigInt(levelByteLength), true);
  view.setBigUint64(96, BigInt(levelByteLength), true);

  view.setUint32(dfdOffset, dfdByteLength, true);
  view.setUint32(dfdOffset + 4, 0, true); // Khronos vendor + basic descriptor type
  view.setUint16(dfdOffset + 8, 2, true);
  view.setUint16(dfdOffset + 10, 40, true);
  bytes[dfdOffset + 12] = 166; // KHR_DF_MODEL_UASTC
  bytes[dfdOffset + 13] = 1; // BT.709/sRGB primaries
  bytes[dfdOffset + 14] = 2; // sRGB transfer
  bytes[dfdOffset + 16] = 3; // 4x4 texel block, stored as dimension - 1
  bytes[dfdOffset + 17] = 3;
  bytes[dfdOffset + 20] = levelByteLength;
  bytes[dfdOffset + 30] = 127; // one UASTC sample spans the full 128-bit block
  bytes[dfdOffset + 31] = 0; // RGBA UASTC channel type
  view.setUint32(dfdOffset + 36, 0, true);
  view.setUint32(dfdOffset + 40, 0xffff_ffff, true);
  bytes.fill(0x5a, levelOffset);
  return bytes;
}

function basisTextureGlb({
  fallback = true,
  required = false,
  ktx2 = validUastcKtx2(),
  rootOverrides = {},
  escapeBasisExtension = false,
}: {
  fallback?: boolean;
  required?: boolean;
  ktx2?: Uint8Array;
  rootOverrides?: Record<string, unknown>;
  escapeBasisExtension?: boolean;
} = {}): Uint8Array {
  const png = pngHeader(2, 3);
  const ktxOffset = fallback ? png.byteLength : 0;
  const bin = new Uint8Array(ktxOffset + ktx2.byteLength);
  if (fallback) bin.set(png);
  bin.set(ktx2, ktxOffset);

  const images = fallback
    ? [
        { bufferView: 0, mimeType: "image/png" },
        { bufferView: 1, mimeType: "image/ktx2" },
      ]
    : [{ bufferView: 0, mimeType: "image/ktx2" }];
  const bufferViews = fallback
    ? [
        { buffer: 0, byteOffset: 0, byteLength: png.byteLength },
        { buffer: 0, byteOffset: ktxOffset, byteLength: ktx2.byteLength },
      ]
    : [{ buffer: 0, byteOffset: 0, byteLength: ktx2.byteLength }];
  const basisSource = fallback ? 1 : 0;

  const root = validRoot({
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews,
    images,
    textures: [{
      ...(fallback ? { source: 0 } : {}),
      extensions: { KHR_texture_basisu: { source: basisSource } },
    }],
    extensionsUsed: ["KHR_texture_basisu"],
    ...(required ? { extensionsRequired: ["KHR_texture_basisu"] } : {}),
    ...rootOverrides,
  });
  const json = JSON.stringify(root);
  return makeGlbFromJsonText(
    escapeBasisExtension
      ? json.replaceAll("KHR_texture_basisu", "KHR\\u005ftexture\\u005fbasisu")
      : json,
    bin,
  );
}

function validRoot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "test" },
    buffers: [{ byteLength: 32 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 32 }],
    accessors: [{ count: 6, type: "VEC3", componentType: 5126 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }, { mesh: 0 }],
    materials: [{}],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    extensions: {
      KHR_lights_punctual: { lights: [{ type: "directional" }, { type: "point" }] },
    },
    ...overrides,
  };
}

function validGlb(overrides: Record<string, unknown> = {}, bin = pngHeader(2, 3)): Uint8Array {
  return makeGlb(validRoot(overrides), bin);
}

function meshoptGlb(
  extensionOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
  header = 0xa0,
): Uint8Array {
  const bin = new Uint8Array(8);
  bin[0] = header;
  return makeGlb({
    asset: { version: "2.0", generator: "meshopt-test" },
    extensionsUsed: ["EXT_meshopt_compression"],
    extensionsRequired: ["EXT_meshopt_compression"],
    buffers: [
      { byteLength: bin.byteLength },
      { byteLength: 36, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews: [{
      buffer: 1,
      byteOffset: 0,
      byteLength: 36,
      byteStride: 12,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: 0,
          byteLength: bin.byteLength,
          byteStride: 12,
          count: 3,
          mode: "ATTRIBUTES",
          filter: "NONE",
          ...extensionOverrides,
        },
      },
    }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...rootOverrides,
  }, bin);
}

function mixedOrdinaryAndMeshoptGlb(): Uint8Array {
  return meshoptGlb({}, {
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: 36,
        byteStride: 12,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: 0,
            byteLength: 8,
            byteStride: 12,
            count: 3,
            mode: "ATTRIBUTES",
            filter: "NONE",
          },
        },
      },
      { buffer: 0, byteOffset: 4, byteLength: 4 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 1, type: "SCALAR" },
    ],
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function profiles(
  desktop: {
    complexity?: Partial<StudioBg3dGlbBudgetProfiles["desktop"]["complexity"]>;
    textures?: Partial<StudioBg3dGlbBudgetProfiles["desktop"]["textures"]>;
  } = {},
): StudioBg3dGlbBudgetProfiles {
  const defaults = DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES;
  return {
    mobile: defaults.mobile,
    desktop: {
      complexity: { ...defaults.desktop.complexity, ...desktop.complexity },
      textures: { ...defaults.desktop.textures, ...desktop.textures },
    },
  };
}

async function optionsFor(
  bytes: Uint8Array,
  overrides: Partial<StudioBg3dGlbValidationOptions> = {},
): Promise<StudioBg3dGlbValidationOptions> {
  return {
    declared: {
      byteSize: bytes.byteLength,
      sha256: `sha256:${await sha256(bytes)}`,
      mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
    },
    cumulative: { usedBytes: 0, maximumBytes: STUDIO_BG3D_GLB_MAX_BYTES },
    profile: "desktop",
    budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
    supportedRequiredExtensions: [],
    ...overrides,
  };
}

async function validate(
  bytes: Uint8Array,
  overrides: Partial<StudioBg3dGlbValidationOptions> = {},
) {
  return validateStudioBg3dGlb(bytes, await optionsFor(bytes, overrides));
}

async function attestInstalledBasisTranscoder(): Promise<StudioBg3dKtx2TranscoderCapability> {
  const directory = path.resolve(
    process.cwd(),
    "node_modules/three/examples/jsm/libs/basis",
  );
  const capability = await attestStudioBg3dKtx2TranscoderAssets({
    javascript: Uint8Array.from(readFileSync(path.join(directory, "basis_transcoder.js"))),
    wasm: Uint8Array.from(readFileSync(path.join(directory, "basis_transcoder.wasm"))),
  });
  expect(capability).not.toBeNull();
  if (!capability) throw new Error("Pinned Three Basis transcoder integrity mismatch.");
  return capability;
}

async function expectFailure(
  bytes: Uint8Array,
  code: StudioBg3dGlbFailureCode,
  overrides: Partial<StudioBg3dGlbValidationOptions> = {},
): Promise<void> {
  const result = await validate(bytes, overrides);
  expect(result).toMatchObject({ ok: false, code });
  expect(result.message).toMatch(/[가-힣]/u);
}

describe("validateStudioBg3dGlb valid self-contained files", () => {
  it("verifies real SHA-256 and reports conservative instantiated metrics", async () => {
    const bytes = validGlb();
    const result = await validate(bytes);

    expect(result).toMatchObject({
      ok: true,
      code: "valid",
      profile: "desktop",
      cumulativeBytesAfter: bytes.byteLength,
      usesBasisTextures: false,
      requiresBasisTextures: false,
      metrics: {
        byteSize: bytes.byteLength,
        binByteSize: 32,
        nodes: 2,
        meshes: 1,
        meshPrimitives: 1,
        drawCalls: 2,
        triangles: 4,
        materials: 1,
        textures: 1,
        images: 1,
        imageBytes: 32,
        estimatedDecodedImageBytes: 24,
        maxImageDimension: 3,
        undeterminedImageDimensions: 0,
        lights: 2,
        animations: 0,
        animationChannels: 0,
        animationKeyframes: 0,
        animationValues: 0,
        skins: 0,
        joints: 0,
        morphTargets: 0,
        accessorElements: 6,
        estimatedDecodedGeometryBytes: 72,
      },
    });
    expect(result.ok && result.verifiedSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.ok && Object.isFrozen(result.metrics)).toBe(true);
  });

  it("accepts an offset Uint8Array view and an exact ArrayBuffer snapshot", async () => {
    const bytes = validGlb();
    const container = new Uint8Array(bytes.byteLength + 19);
    container.set(bytes, 7);
    const offsetView = container.subarray(7, 7 + bytes.byteLength);
    expect((await validate(offsetView)).ok).toBe(true);

    const arrayBuffer = Uint8Array.from(bytes).buffer;
    expect((await validateStudioBg3dGlb(arrayBuffer, await optionsFor(bytes))).ok).toBe(true);
  });

  it("returns canonical verified bytes that cannot be changed through the caller's source", async () => {
    const source = validGlb();
    const canonical = Uint8Array.from(source);
    const result = await validate(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifiedBytes).not.toBe(source);
    expect(result.verifiedBytes.buffer).not.toBe(source.buffer);

    source.fill(0);

    expect(result.verifiedBytes).toEqual(canonical);
    expect(new DataView(result.verifiedBytes.buffer).getUint32(0, true)).toBe(0x46546c67);
  });

  it("counts triangle strips and GPU instancing conservatively", async () => {
    const bytes = validGlb({
      accessors: [
        { count: 7, type: "VEC3", componentType: 5126 },
        { count: 4, type: "VEC3", componentType: 5126 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
      nodes: [
        {
          mesh: 0,
          extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1 } } },
        },
      ],
      materials: [],
    });
    const result = await validate(bytes);

    expect(result).toMatchObject({
      ok: true,
      metrics: { nodes: 1, drawCalls: 4, triangles: 20, materials: 1 },
    });
  });

  it("reports an embedded image with an unrecognized header without trusting dimensions", async () => {
    const bytes = validGlb({}, new Uint8Array(32));
    const result = await validate(bytes);

    expect(result).toMatchObject({
      ok: true,
      usesBasisTextures: false,
      requiresBasisTextures: false,
      metrics: {
        imageBytes: 32,
        estimatedDecodedImageBytes: 0,
        maxImageDimension: 0,
        undeterminedImageDimensions: 1,
      },
    });
  });
});

describe("validateStudioBg3dGlb metadata and integrity boundary", () => {
  it("rejects declared byte-size mismatch before invoking the digest", async () => {
    const bytes = validGlb();
    const digest = vi.fn(async () => new Uint8Array(32));
    const options = await optionsFor(bytes, {
      declared: { byteSize: bytes.byteLength + 1, sha256: "0".repeat(64) },
      digest,
    });
    const result = await validateStudioBg3dGlb(bytes, options);

    expect(result).toMatchObject({ ok: false, code: "byte-size-mismatch" });
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects files over the 100 MiB hard ceiling before copying or hashing", async () => {
    const bytes = new Uint8Array(STUDIO_BG3D_GLB_MAX_BYTES + 1);
    const digest = vi.fn(async () => new Uint8Array(32));
    const result = await validateStudioBg3dGlb(bytes, {
      declared: { byteSize: bytes.byteLength, sha256: "0".repeat(64) },
      cumulative: { usedBytes: 0, maximumBytes: bytes.byteLength },
      profile: "desktop",
      budgets: profiles({ complexity: { maxModelBytes: bytes.byteLength } }),
      digest,
    });

    expect(result).toMatchObject({ ok: false, code: "file-too-large" });
    expect(digest).not.toHaveBeenCalled();
  });

  it("enforces caller-selected cumulative and device model byte budgets", async () => {
    const bytes = validGlb();
    await expectFailure(bytes, "cumulative-byte-budget-exceeded", {
      cumulative: { usedBytes: 10, maximumBytes: bytes.byteLength + 9 },
    });
    await expectFailure(bytes, "model-byte-budget-exceeded", {
      budgets: profiles({ complexity: { maxModelBytes: bytes.byteLength - 1 } }),
    });
  });

  it("rejects a hash mismatch and sanitizes the message", async () => {
    const bytes = validGlb();
    const secretLikeValue = `https://example.invalid/private?token=${["sk", "redacted"].join("-")}`;
    const result = await validate(bytes, {
      declared: { byteSize: bytes.byteLength, sha256: "f".repeat(64) },
    });

    expect(result).toMatchObject({ ok: false, code: "hash-mismatch" });
    expect(result.message).not.toContain(secretLikeValue);
    expect(result.message).not.toMatch(/https?:|sk-/u);
  });

  it("returns stable failures for unavailable and malformed digest implementations", async () => {
    const bytes = validGlb();
    await expectFailure(bytes, "digest-failed", {
      digest: async () => {
        throw new Error("internal URL https://secret.invalid");
      },
    });
    await expectFailure(bytes, "digest-failed", { digest: async () => new Uint8Array(31) });
  });
});

describe("validateStudioBg3dGlb hostile and truncated containers", () => {
  it.each([
    ["truncated-header", new Uint8Array(19)],
    ["invalid-magic", (() => { const bytes = validGlb(); writeUint32(bytes, 0, 0); return bytes; })()],
    ["unsupported-version", (() => { const bytes = validGlb(); writeUint32(bytes, 4, 1); return bytes; })()],
    ["declared-length-mismatch", (() => { const bytes = validGlb(); writeUint32(bytes, 8, bytes.byteLength - 4); return bytes; })()],
    ["missing-json-chunk", (() => { const bytes = validGlb(); writeUint32(bytes, 16, BIN_CHUNK); return bytes; })()],
    ["invalid-chunk-alignment", (() => { const bytes = validGlb(); writeUint32(bytes, 12, 5); return bytes; })()],
    ["invalid-chunk-bounds", (() => { const bytes = validGlb(); writeUint32(bytes, 12, bytes.byteLength); return bytes; })()],
  ] as const)("returns %s without handing malformed bytes to a renderer", async (code, bytes) => {
    await expectFailure(bytes, code);
  });

  it("rejects duplicate and unknown chunks", async () => {
    const json = pad(new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } })), 0x20);
    await expectFailure(
      assembleGlb([{ type: JSON_CHUNK, bytes: json }, { type: JSON_CHUNK, bytes: json }]),
      "duplicate-json-chunk",
    );
    await expectFailure(
      assembleGlb([{ type: JSON_CHUNK, bytes: json }, { type: 0x12345678, bytes: new Uint8Array(4) }]),
      "unsupported-chunk-type",
    );
  });

  it("bounds JSON before decoding or parsing", async () => {
    const largeJson = pad(
      new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, extra: "x".repeat(STUDIO_BG3D_GLB_MAX_JSON_BYTES) })),
      0x20,
    );
    const bytes = assembleGlb([{ type: JSON_CHUNK, bytes: largeJson }]);
    await expectFailure(bytes, "json-chunk-too-large", {
      declared: { byteSize: bytes.byteLength, sha256: "0".repeat(64) },
      digest: async () => new Uint8Array(32),
    });
  });

  it("rejects malformed JSON and non-object glTF roots", async () => {
    const malformed = assembleGlb([{ type: JSON_CHUNK, bytes: pad(new TextEncoder().encode("{"), 0x20) }]);
    const arrayRoot = assembleGlb([{ type: JSON_CHUNK, bytes: pad(new TextEncoder().encode("[]"), 0x20) }]);
    await expectFailure(malformed, "invalid-json");
    await expectFailure(arrayRoot, "invalid-gltf-root");
  });

  it.each(["2.evil", "2.1", "2", "20", 2, null])(
    "requires the exact glTF asset.version 2.0 contract: %j",
    async (version) => {
      const bytes = makeGlb({ asset: { version } });
      await expectFailure(bytes, "invalid-gltf-root");
    },
  );
});

describe("validateStudioBg3dGlb self-contained resource policy", () => {
  it.each([
    "scene.bin",
    "https://example.invalid/scene.bin?token=secret",
    "data:application/octet-stream;base64,AA==",
    "blob:https://example.invalid/private",
    "file:///Users/private/scene.bin",
  ])("rejects every external buffer URI without echoing it: %s", async (uri) => {
    const bytes = makeGlb({ asset: { version: "2.0" }, buffers: [{ byteLength: 1, uri }] });
    const result = await validate(bytes);

    expect(result).toMatchObject({ ok: false, code: "external-resource-uri" });
    expect(result.message).not.toContain(uri);
    expect(result.message).not.toMatch(/https?:|blob:|data:|file:/u);
  });

  it("rejects external image URIs and missing embedded BIN data", async () => {
    await expectFailure(
      makeGlb({ asset: { version: "2.0" }, images: [{ uri: "texture.png" }] }),
      "external-resource-uri",
    );
    await expectFailure(
      makeGlb({ asset: { version: "2.0" }, buffers: [{ byteLength: 32 }] }),
      "missing-bin-chunk",
    );
  });

  it("requires callers to explicitly allow renderer-supported required extensions", async () => {
    const bytes = validGlb({
      extensionsUsed: ["KHR_draco_mesh_compression"],
      extensionsRequired: ["KHR_draco_mesh_compression"],
    });
    await expectFailure(bytes, "unsupported-required-extension");
    expect((await validate(bytes, { supportedRequiredExtensions: ["KHR_draco_mesh_compression"] })).ok).toBe(true);
  });

  it("accepts optional KHR_texture_basisu UASTC with a core PNG fallback", async () => {
    const bytes = basisTextureGlb();
    const result = await validate(bytes);

    expect(result).toMatchObject({
      ok: true,
      usesBasisTextures: true,
      requiresBasisTextures: false,
      metrics: {
        textures: 1,
        images: 2,
        imageBytes: 208,
        estimatedDecodedImageBytes: 88,
        maxImageDimension: 4,
        undeterminedImageDimensions: 0,
      },
    });
  });

  it("requires both renderer support and a same-realm transcoder attestation for required Basis", async () => {
    const bytes = basisTextureGlb({ fallback: false, required: true });

    await expectFailure(bytes, "unsupported-required-extension");
    await expectFailure(bytes, "unsupported-required-extension", {
      supportedRequiredExtensions: ["KHR_texture_basisu"],
    });
    const basisTranscoderCapability = await attestInstalledBasisTranscoder();
    const result = await validate(bytes, {
      supportedRequiredExtensions: ["KHR_texture_basisu"],
      basisTranscoderCapability,
      basisPayloadPreflight: async () => true,
    });
    expect(result).toMatchObject({
      ok: true,
      usesBasisTextures: true,
      requiresBasisTextures: true,
      metrics: {
        textures: 1,
        images: 1,
        imageBytes: 176,
        estimatedDecodedImageBytes: 64,
        maxImageDimension: 4,
      },
    });

    await expectFailure(bytes, "unsupported-required-extension", {
      supportedRequiredExtensions: ["KHR_texture_basisu"],
      basisTranscoderCapability: Object.freeze({ ...basisTranscoderCapability }),
      basisPayloadPreflight: async () => true,
    });
  });

  it("resolves Basis from parsed evidence when every extension spelling uses JSON escapes", async () => {
    const bytes = basisTextureGlb({
      fallback: false,
      required: true,
      escapeBasisExtension: true,
    });
    const capability = await attestInstalledBasisTranscoder();
    const preflight = vi.fn(async () => true);
    const provider = vi.fn(async () => ({ capability, preflight }));

    const result = await validate(bytes, {
      supportedRequiredExtensions: ["KHR_texture_basisu"],
      basisRuntimeProvider: provider,
    });
    expect(result.ok).toBe(true);
    expect(provider).toHaveBeenCalledOnce();
    expect(preflight).toHaveBeenCalledOnce();
  });

  it("does not initialize Basis for unrelated raw strings and fails optional provider loss closed", async () => {
    const capability = await attestInstalledBasisTranscoder();
    const unrelatedProvider = vi.fn(async () => ({
      capability,
      preflight: async () => true,
    }));
    const unrelated = await validate(validGlb({
      asset: { version: "2.0", generator: "literal KHR_texture_basisu is not extension evidence" },
    }), {
      basisRuntimeProvider: unrelatedProvider,
    });
    expect(unrelated.ok).toBe(true);
    expect(unrelatedProvider).not.toHaveBeenCalled();

    await expectFailure(
      basisTextureGlb({ escapeBasisExtension: true }),
      "basis-transcode-failed",
      { basisRuntimeProvider: async () => null },
    );
  });

  it("pretranscodes each Basis payload copy and fails closed on decoder rejection", async () => {
    const bytes = basisTextureGlb();
    let observedInfo: unknown;
    const success = await validate(bytes, {
      basisPayloadPreflight: async (payload, info) => {
        observedInfo = info;
        payload[0] = 0;
        return true;
      },
    });
    expect(success.ok).toBe(true);
    expect(observedInfo).toEqual({
      width: 4,
      height: 4,
      levelCount: 1,
      estimatedDecodedBytes: 64,
      colorModel: "uastc",
      supercompression: "none",
    });

    await expectFailure(bytes, "basis-transcode-failed", {
      basisPayloadPreflight: async () => false,
    });
    await expectFailure(bytes, "basis-transcode-failed", {
      basisPayloadPreflight: async () => {
        throw new Error("decoder detail must not cross the trust boundary");
      },
    });
  });

  it("rejects malformed KTX2 bytes even when a valid core fallback exists", async () => {
    const malformed = validUastcKtx2();
    malformed[0] = 0;
    await expectFailure(basisTextureGlb({ ktx2: malformed }), "invalid-image");
  });

  it.each([
    [
      "an out-of-bounds Basis source",
      { textures: [{ source: 0, extensions: { KHR_texture_basisu: { source: 2 } } }] },
    ],
    [
      "a PNG selected as the Basis source",
      { textures: [{ source: 0, extensions: { KHR_texture_basisu: { source: 0 } } }] },
    ],
    [
      "a KTX2 image selected through the core texture source",
      { textures: [{ source: 1, extensions: { KHR_texture_basisu: { source: 1 } } }] },
    ],
    [
      "a Basis texture without extensionsUsed declaration",
      { extensionsUsed: undefined },
    ],
  ])("rejects %s", async (_label, rootOverrides) => {
    await expectFailure(basisTextureGlb({ rootOverrides }), "invalid-image");
  });

  it("rejects an optional Basis texture without a portable core fallback", async () => {
    await expectFailure(basisTextureGlb({ fallback: false }), "invalid-image");
  });

  it("rejects an embedded KTX2 image that no Basis texture references", async () => {
    const bytes = basisTextureGlb({
      rootOverrides: {
        textures: [{ source: 0 }],
        extensionsUsed: undefined,
      },
    });
    await expectFailure(bytes, "invalid-image");
  });

  it("validates extension-set and sampler references before renderer admission", async () => {
    const basisTranscoderCapability = await attestInstalledBasisTranscoder();
    await expectFailure(basisTextureGlb({
      rootOverrides: { extensionsUsed: ["KHR_texture_basisu", "KHR_texture_basisu"] },
    }), "invalid-gltf-root");
    await expectFailure(basisTextureGlb({
      required: true,
      rootOverrides: { extensionsRequired: ["KHR_texture_basisu", "KHR_texture_basisu"] },
    }), "invalid-gltf-root", {
      supportedRequiredExtensions: ["KHR_texture_basisu"],
      basisTranscoderCapability,
      basisPayloadPreflight: async () => true,
    });
    await expectFailure(basisTextureGlb({
      rootOverrides: {
        extensionsRequired: ["KHR_draco_mesh_compression"],
      },
    }), "invalid-gltf-root", {
      supportedRequiredExtensions: ["KHR_draco_mesh_compression"],
    });
    await expectFailure(basisTextureGlb({
      rootOverrides: {
        textures: [{
          source: 0,
          sampler: 0,
          extensions: { KHR_texture_basisu: { source: 1 } },
        }],
      },
    }), "invalid-gltf-root");

    const validSampler = await validate(basisTextureGlb({
      rootOverrides: {
        samplers: [{}],
        textures: [{
          source: 0,
          sampler: 0,
          extensions: { KHR_texture_basisu: { source: 1 } },
        }],
      },
    }));
    expect(validSampler.ok).toBe(true);
  });

  it("requires a core PNG/JPEG fallback rather than an extension-only image format", async () => {
    await expectFailure(basisTextureGlb({
      rootOverrides: {
        images: [
          { bufferView: 0, mimeType: "image/webp" },
          { bufferView: 1, mimeType: "image/ktx2" },
        ],
      },
    }), "invalid-image");
  });

  it("rejects out-of-bounds buffer views before reading image bytes", async () => {
    const bytes = validGlb({
      bufferViews: [{ buffer: 0, byteOffset: 16, byteLength: 32 }],
    });
    await expectFailure(bytes, "invalid-buffer-view");
  });

  it("admits structurally bounded Meshopt views only through an explicit renderer allowlist", async () => {
    const bytes = meshoptGlb();
    await expectFailure(bytes, "unsupported-required-extension");

    const result = await validate(bytes, {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
    });

    expect(result).toMatchObject({
      ok: true,
      metrics: {
        triangles: 1,
        accessorElements: 3,
        estimatedDecodedGeometryBytes: 36,
      },
    });
  });

  it.each([
    [{ count: 4 }, 0xa0],
    [{ byteOffset: 4, byteLength: 8 }, 0xa0],
    [{ byteStride: 6 }, 0xa0],
    [{ mode: "TRIANGLES", count: 3, byteStride: 12 }, 0xe1],
    [{ mode: "INDICES", byteStride: 2, filter: "QUATERNION", count: 18 }, 0xd1],
    [{}, 0xff],
  ])("rejects malformed Meshopt layout or bitstream headers before renderer decode", async (extension, header) => {
    await expectFailure(meshoptGlb(extension, {}, header), "invalid-buffer-view", {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
    });
  });

  it("charges Meshopt's logical output size against the existing decoded-geometry budget", async () => {
    await expectFailure(meshoptGlb(), "geometry-memory-budget-exceeded", {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
      budgets: profiles({ complexity: { maxDecodedGeometryBytes: 35 } }),
    });
  });

  it("adds ordinary accessor allocations to Meshopt output for mixed models", async () => {
    const bytes = mixedOrdinaryAndMeshoptGlb();
    const result = await validate(bytes, {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
    });
    expect(result).toMatchObject({
      ok: true,
      metrics: { estimatedDecodedGeometryBytes: 40 },
    });
    await expectFailure(bytes, "geometry-memory-budget-exceeded", {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
      budgets: profiles({ complexity: { maxDecodedGeometryBytes: 39 } }),
    });
  });

  it("rejects compressed image buffer views because image signatures cannot be preflighted safely", async () => {
    const bytes = meshoptGlb({}, {
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
    });
    await expectFailure(bytes, "invalid-image", {
      supportedRequiredExtensions: ["EXT_meshopt_compression"],
    });
  });
});

describe("validateStudioBg3dGlb commercial profile budgets", () => {
  it.each([
    ["node-budget-exceeded", profiles({ complexity: { maxNodes: 1 } })],
    ["triangle-budget-exceeded", profiles({ complexity: { maxTriangles: 3 } })],
    ["draw-call-budget-exceeded", profiles({ complexity: { maxDrawCalls: 1 } })],
    ["light-budget-exceeded", profiles({ complexity: { maxLights: 1 } })],
    ["texture-byte-budget-exceeded", profiles({ textures: { maxTotalBytes: 31 } })],
    ["texture-dimension-budget-exceeded", profiles({ textures: { maxDimension: 2 } })],
  ] as const)("enforces %s", async (code, budgets) => {
    await expectFailure(validGlb(), code, { budgets });
  });

  it("enforces material and texture count budgets", async () => {
    const materialHeavy = validGlb({
      materials: [{}, {}],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    });
    await expectFailure(materialHeavy, "material-budget-exceeded", {
      budgets: profiles({ complexity: { maxMaterials: 1 } }),
    });

    const textureHeavy = validGlb({ textures: [{ source: 0 }, { source: 0 }] });
    await expectFailure(textureHeavy, "texture-count-budget-exceeded", {
      budgets: profiles({ textures: { maxTextures: 1 } }),
    });
  });

  it("rejects a tiny compressed image that declares a decoded-memory bomb", async () => {
    const bytes = validGlb({}, pngHeader(10_000, 10_000));
    const result = await validate(bytes, {
      budgets: profiles({
        textures: {
          maxDimension: 20_000,
          maxTotalBytes: 100 * 1024 * 1024,
        },
      }),
    });

    expect(result).toMatchObject({ ok: false, code: "texture-byte-budget-exceeded" });
  });

  it("rejects decoded RGBA estimates that overflow safe integer arithmetic", async () => {
    const bytes = validGlb({}, pngHeader(0xffffffff, 0xffffffff));
    await expectFailure(bytes, "arithmetic-overflow", {
      budgets: profiles({
        textures: {
          maxDimension: Number.MAX_SAFE_INTEGER,
          maxTotalBytes: Number.MAX_SAFE_INTEGER,
        },
      }),
    });
  });

  it("uses the selected mobile profile rather than silently falling back to desktop", async () => {
    const bytes = validGlb();
    const budgets: StudioBg3dGlbBudgetProfiles = {
      mobile: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile.complexity,
          maxDrawCalls: 1,
        },
      },
      desktop: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop,
    };
    await expectFailure(bytes, "draw-call-budget-exceeded", { profile: "mobile", budgets });
  });

  it("measures animation, skin, joint, and morph work before renderer parsing", async () => {
    const bytes = validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 2, type: "SCALAR", componentType: 5126 },
        { count: 2, type: "VEC3", componentType: 5126 },
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 2, type: "SCALAR", componentType: 5126 },
        { count: 6, type: "VEC4", componentType: 5126 },
        { count: 2, type: "MAT4", componentType: 5126 },
      ],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0 },
          material: 0,
          targets: [{ POSITION: 3 }],
        }],
      }],
      nodes: [{ mesh: 0, skin: 0 }, {}, {}],
      skins: [{ joints: [1, 2], skeleton: 1, inverseBindMatrices: 6 }],
      animations: [{
        samplers: [
          { input: 1, output: 2 },
          { input: 1, output: 4 },
          { input: 1, output: 5, interpolation: "CUBICSPLINE" },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: "translation" } },
          { sampler: 1, target: { node: 0, path: "weights" } },
          { sampler: 2, target: { node: 0, path: "rotation" } },
        ],
      }],
    });
    const result = await validate(bytes);

    expect(result).toMatchObject({
      ok: true,
      metrics: {
        animations: 1,
        animationChannels: 3,
        animationKeyframes: 6,
        // 2 VEC3 values + 2 morph weights + 6 cubic-spline VEC4 values.
        animationValues: 32,
        skins: 1,
        joints: 2,
        morphTargets: 1,
      },
    });
  });

  it.each([
    ["animation-count-budget-exceeded", { maxAnimations: 0 }],
    ["animation-channel-budget-exceeded", { maxAnimationChannels: 0 }],
    ["animation-keyframe-budget-exceeded", { maxAnimationKeyframes: 1 }],
    ["animation-value-budget-exceeded", { maxAnimationValues: 5 }],
  ] as const)("enforces %s", async (code, complexity) => {
    const bytes = validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 2, type: "SCALAR", componentType: 5126 },
        { count: 2, type: "VEC3", componentType: 5126 },
      ],
      animations: [{
        samplers: [{ input: 1, output: 2 }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      }],
    });
    await expectFailure(bytes, code, { budgets: profiles({ complexity }) });
  });

  it.each([
    ["skin-count-budget-exceeded", { maxSkins: 0 }],
    ["joint-count-budget-exceeded", { maxJoints: 1 }],
  ] as const)("enforces %s", async (code, complexity) => {
    const bytes = validGlb({
      nodes: [{ mesh: 0, skin: 0 }, {}, {}],
      skins: [{ joints: [1, 2] }],
    });
    await expectFailure(bytes, code, { budgets: profiles({ complexity }) });
  });

  it("enforces the morph target budget", async () => {
    const bytes = validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 6, type: "VEC3", componentType: 5126 },
      ],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0 },
          material: 0,
          targets: [{ POSITION: 1 }],
        }],
      }],
    });
    await expectFailure(bytes, "morph-target-budget-exceeded", {
      budgets: profiles({ complexity: { maxMorphTargets: 0 } }),
    });
  });

  it("rejects malformed animation and skin graphs with sanitized failures", async () => {
    await expectFailure(validGlb({
      animations: [{ samplers: [], channels: [] }],
    }), "invalid-animation");
    await expectFailure(validGlb({
      nodes: [{ mesh: 0, skin: 0 }],
      skins: [{ joints: [99] }],
    }), "invalid-skin");
  });

  it("rejects animation value overflow and mismatched inverse-bind cardinality", async () => {
    await expectFailure(validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: Number.MAX_SAFE_INTEGER, type: "SCALAR", componentType: 5126 },
        { count: Number.MAX_SAFE_INTEGER, type: "VEC3", componentType: 5126 },
      ],
      animations: [{
        samplers: [{ input: 1, output: 2 }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      }],
    }), "arithmetic-overflow");

    await expectFailure(validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 3, type: "MAT4", componentType: 5126 },
      ],
      nodes: [{ mesh: 0, skin: 0 }, {}, {}],
      skins: [{ joints: [1, 2], inverseBindMatrices: 1 }],
    }), "invalid-skin");
  });
});

describe("validateStudioBg3dGlb accessor allocation boundary", () => {
  it("rejects malformed, out-of-range, and undersized interleaved accessors", async () => {
    await expectFailure(validGlb({
      accessors: [{ count: 6 }],
    }), "invalid-accessor");

    await expectFailure(validGlb({
      accessors: [{
        bufferView: 0,
        count: 3,
        type: "VEC3",
        componentType: 5126,
      }],
    }), "invalid-accessor");

    await expectFailure(validGlb({
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 32, byteStride: 8 }],
      accessors: [{
        bufferView: 0,
        count: 2,
        type: "VEC3",
        componentType: 5126,
      }],
    }), "invalid-accessor");
  });

  it("accepts a bounded interleaved accessor and accounts for its decoded allocation", async () => {
    const result = await validate(validGlb({
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 32, byteStride: 16 }],
      accessors: [{
        bufferView: 0,
        count: 2,
        type: "VEC3",
        componentType: 5126,
      }],
    }));

    expect(result).toMatchObject({
      ok: true,
      metrics: {
        accessorElements: 2,
        estimatedDecodedGeometryBytes: 24,
      },
    });
  });

  it("uses glTF matrix column alignment and validates sparse index/value ranges", async () => {
    await expectFailure(validGlb({
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 9 }],
      accessors: [{
        bufferView: 0,
        count: 1,
        type: "MAT3",
        componentType: 5121,
      }],
    }), "invalid-accessor");

    await expectFailure(validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        {
          count: 10,
          type: "SCALAR",
          componentType: 5126,
          sparse: {
            count: 2,
            indices: { bufferView: 0, byteOffset: 31, componentType: 5123 },
            values: { bufferView: 0, byteOffset: 0 },
          },
        },
      ],
    }), "invalid-accessor");
  });

  it("blocks sparse/zero-initialized accessor allocation bombs independently of file size", async () => {
    const bytes = validGlb({
      accessors: [
        { count: 6, type: "VEC3", componentType: 5126 },
        { count: 1_000_000, type: "VEC4", componentType: 5126 },
      ],
    });
    await expectFailure(bytes, "accessor-element-budget-exceeded", {
      budgets: profiles({ complexity: { maxAccessorElements: 100 } }),
    });
    await expectFailure(bytes, "geometry-memory-budget-exceeded", {
      budgets: profiles({
        complexity: {
          maxAccessorElements: 2_000_000,
          maxDecodedGeometryBytes: 1_000_000,
        },
      }),
    });
  });
});
