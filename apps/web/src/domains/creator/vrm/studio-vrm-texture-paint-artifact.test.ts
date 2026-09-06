import { describe, expect, it, vi } from "vitest";

import {
  buildStudioVrmTexturePaintArtifactBundle,
  canonicalStudioVrmTexturePaintArtifactManifestJson,
  createStudioVrmTexturePaintArtifact,
  decodeStudioVrmTexturePaintArtifact,
  rehydrateStudioVrmTexturePaintArtifactManifest,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
  studioVrmTexturePaintArtifactArchivePath,
  verifyStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
  type StudioVrmTexturePaintArtifactMetadata,
} from "./studio-vrm-texture-paint-artifact";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function ascii(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function pngChunk(
  type: string,
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(ascii(type), 4);
  result.set(data, 8);
  view.setUint32(result.byteLength - 4, crc32(result.subarray(4, result.byteLength - 4)), false);
  return result;
}

function concat(...parts: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function png(
  width = 1,
  height = 1,
  idat: Uint8Array<ArrayBufferLike> = Uint8Array.from(
    [0x78, 0x9c, 0x63, 0x60, 0, 2, 0, 0, 5, 0, 1],
  ),
): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat(
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  );
}

async function sha256(
  bytes: Uint8Array<ArrayBufferLike>,
): Promise<StudioVrmTexturePaintArtifactHash> {
  const owned = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", owned);
  return `sha256:${Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function cloneMetadata(
  metadata: StudioVrmTexturePaintArtifactMetadata,
  overrides: Partial<StudioVrmTexturePaintArtifactMetadata> = {},
): StudioVrmTexturePaintArtifactMetadata {
  return { ...metadata, ...overrides };
}

describe("studio-vrm-texture-paint-artifact", () => {
  it("creates deterministic canonical metadata and an archive-ready Blob from Uint8Array", async () => {
    const bytes = png(32, 16);
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/model-01/material-4/baseColor",
      source: bytes,
      expectedWidth: 32,
      expectedHeight: 16,
    });
    const contentHash = await sha256(bytes);

    expect(artifact.metadata).toEqual({
      schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
      kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
      bindingKey: "vrm/model-01/material-4/baseColor",
      contentHash,
      mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
      byteLength: bytes.byteLength,
      width: 32,
      height: 16,
    });
    expect(Object.keys(artifact.metadata)).toEqual([
      "schemaVersion",
      "kind",
      "bindingKey",
      "contentHash",
      "mimeType",
      "byteLength",
      "width",
      "height",
    ]);
    expect(artifact.archiveEntry).toMatchObject({
      path: `artifacts/vrm-texture-paint/${contentHash.slice("sha256:".length)}.png`,
      contentHash,
      mimeType: "image/png",
      byteLength: bytes.byteLength,
      width: 32,
      height: 16,
    });
    expect(artifact.archiveEntry.data).toBeInstanceOf(Blob);
    expect(artifact.archiveEntry.data.type).toBe("image/png");
    expect(new Uint8Array(await artifact.archiveEntry.data.arrayBuffer())).toEqual(bytes);
    expect("bytes" in artifact.metadata).toBe(false);
    expect("url" in artifact.metadata).toBe(false);
    expect(Object.isFrozen(artifact.metadata)).toBe(true);
  });

  it("keeps an immutable Blob source and accepts it without rewriting its MIME", async () => {
    const source = new Blob([png(2, 3)], { type: "image/png" });
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "avatar/a/material/b",
      source,
    });

    expect(artifact.archiveEntry.data).toBe(source);
    expect(artifact.metadata).toMatchObject({ width: 2, height: 3 });
  });

  it("snapshots mutable Uint8Array before asynchronous hashing", async () => {
    const source = png(4, 5);
    const original = Uint8Array.from(source);
    const pending = createStudioVrmTexturePaintArtifact({
      bindingKey: "avatar/a/material/base",
      source,
    });
    source.fill(0);
    const artifact = await pending;

    expect(new Uint8Array(await artifact.archiveEntry.data.arrayBuffer())).toEqual(original);
    expect(artifact.metadata.contentHash).toBe(await sha256(original));
  });

  it("rejects MIME spoofing, truncated files, and unsafe binding identifiers", async () => {
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: new Blob([png()], { type: "image/jpeg" }),
    })).rejects.toMatchObject({ code: "MIME_INVALID" });
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png().subarray(0, 40),
    })).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "../private/texture",
      source: png(),
    })).rejects.toMatchObject({ code: "BINDING_KEY_INVALID" });
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/\u202esecret/material",
      source: png(),
    })).rejects.toMatchObject({ code: "BINDING_KEY_INVALID" });
  });

  it("validates PNG signature, chunk CRC, complete IEND, and exact IHDR dimensions", async () => {
    const invalidSignature = png();
    invalidSignature[0] = 0;
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: invalidSignature,
    })).rejects.toMatchObject({ code: "PNG_INVALID" });

    const tamperedIhdr = png(4, 4);
    tamperedIhdr[19] = 8;
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: tamperedIhdr,
    })).rejects.toMatchObject({ code: "PNG_INVALID" });

    const truncatedIend = png().subarray(0, png().byteLength - 1);
    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: truncatedIend,
    })).rejects.toMatchObject({ code: "PNG_INVALID" });

    await expect(createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png(8, 9),
      expectedWidth: 8,
      expectedHeight: 10,
    })).rejects.toMatchObject({ code: "DIMENSION_MISMATCH" });
  });

  it("enforces individual byte, dimension, pixel, and aggregate budgets fail-closed", async () => {
    const bytes = png(4, 4);
    await expect(createStudioVrmTexturePaintArtifact(
      { bindingKey: "vrm/a/material/base", source: bytes },
      { limits: { maxArtifactBytes: bytes.byteLength - 1 } },
    )).rejects.toMatchObject({ code: "BYTE_LIMIT_EXCEEDED" });
    await expect(createStudioVrmTexturePaintArtifact(
      { bindingKey: "vrm/a/material/base", source: bytes },
      { limits: { maxWidth: 3 } },
    )).rejects.toMatchObject({ code: "DIMENSION_LIMIT_EXCEEDED" });
    await expect(createStudioVrmTexturePaintArtifact(
      { bindingKey: "vrm/a/material/base", source: bytes },
      { limits: { maxPixels: 15 } },
    )).rejects.toMatchObject({ code: "PIXEL_LIMIT_EXCEEDED" });
    await expect(buildStudioVrmTexturePaintArtifactBundle(
      [
        { bindingKey: "vrm/a/material/base", source: bytes },
        { bindingKey: "vrm/a/material/emissive", source: bytes },
      ],
      { limits: { maxAggregateBytes: bytes.byteLength * 2 - 1 } },
    )).rejects.toMatchObject({ code: "AGGREGATE_BYTE_LIMIT_EXCEEDED" });
    await expect(buildStudioVrmTexturePaintArtifactBundle(
      [
        { bindingKey: "vrm/a/material/base", source: bytes },
        { bindingKey: "vrm/a/material/emissive", source: png(4, 4, Uint8Array.of(1, 2, 3)) },
      ],
      { limits: { maxArtifacts: 1 } },
    )).rejects.toMatchObject({ code: "ARTIFACT_COUNT_LIMIT_EXCEEDED" });
    await expect(buildStudioVrmTexturePaintArtifactBundle(
      [
        { bindingKey: "vrm/a/material/base", source: bytes },
        {
          bindingKey: "vrm/a/material/emissive",
          source: png(4, 4, Uint8Array.from([0x78, 0x9c, 1, 2, 3])),
        },
      ],
      { limits: { maxAggregatePixels: 31 } },
    )).rejects.toMatchObject({ code: "AGGREGATE_PIXEL_LIMIT_EXCEEDED" });
    await expect(createStudioVrmTexturePaintArtifact(
      { bindingKey: "vrm/a/material/base", source: bytes },
      { limits: { maxWidth: 16_385 } },
    )).rejects.toMatchObject({ code: "LIMIT_INVALID" });
  });

  it("deduplicates the same bytes while retaining deterministic binding metadata", async () => {
    const bytes = png(7, 11);
    const bundle = await buildStudioVrmTexturePaintArtifactBundle([
      { bindingKey: "vrm/z/material/base", source: bytes },
      { bindingKey: "vrm/a/material/base", source: new Blob([bytes], { type: "image/png" }) },
      { bindingKey: "vrm/a/material/base", source: bytes },
    ]);

    expect(bundle.artifactCount).toBe(1);
    expect(bundle.archiveEntries).toHaveLength(1);
    expect(bundle.totalBytes).toBe(bytes.byteLength);
    expect(bundle.totalPixels).toBe(7 * 11);
    expect(bundle.manifest.bindings.map(({ bindingKey }) => bindingKey)).toEqual([
      "vrm/a/material/base",
      "vrm/z/material/base",
    ]);
    expect(new Set(bundle.manifest.bindings.map(({ contentHash }) => contentHash)).size).toBe(1);
    expect(canonicalStudioVrmTexturePaintArtifactManifestJson(bundle.manifest)).toBe(
      JSON.stringify(bundle.manifest),
    );
  });

  it("rejects one bindingKey that resolves to different content", async () => {
    await expect(buildStudioVrmTexturePaintArtifactBundle([
      { bindingKey: "vrm/a/material/base", source: png(2, 2) },
      {
        bindingKey: "vrm/a/material/base",
        source: png(2, 2, Uint8Array.from([0x78, 0x9c, 1, 2, 3])),
      },
    ])).rejects.toMatchObject({ code: "BINDING_CONFLICT" });
  });

  it("verifies persisted bytes and rejects tampered hashes and valid-but-different PNGs", async () => {
    const originalBytes = png(3, 3);
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: originalBytes,
    });
    const verified = await verifyStudioVrmTexturePaintArtifact(
      artifact.metadata,
      artifact.archiveEntry.data,
    );
    expect(verified.metadata).toEqual(artifact.metadata);

    await expect(verifyStudioVrmTexturePaintArtifact(
      cloneMetadata(artifact.metadata, { contentHash: `sha256:${"f".repeat(64)}` }),
      originalBytes,
    )).rejects.toMatchObject({ code: "HASH_MISMATCH" });

    const differentBytes = png(3, 3, Uint8Array.from([0x78, 0x9c, 9, 8, 7]));
    await expect(verifyStudioVrmTexturePaintArtifact(
      cloneMetadata(artifact.metadata, { byteLength: differentBytes.byteLength }),
      differentBytes,
    )).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("rehydrates each duplicate hash once and returns canonical archive entries", async () => {
    const bytes = png(12, 13);
    const built = await buildStudioVrmTexturePaintArtifactBundle([
      { bindingKey: "vrm/a/material/base", source: bytes },
      { bindingKey: "vrm/b/material/base", source: bytes },
    ]);
    const resolve = vi.fn(async (contentHash: StudioVrmTexturePaintArtifactHash) => {
      expect(contentHash).toBe(built.archiveEntries[0]?.contentHash);
      return new Blob([bytes], { type: "image/png" });
    });

    const restored = await rehydrateStudioVrmTexturePaintArtifactManifest(
      built.manifest,
      { resolve },
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(restored.manifest).toEqual(built.manifest);
    expect(restored.archiveEntries).toHaveLength(1);
    expect(restored.totalBytes).toBe(bytes.byteLength);
    expect(restored.totalPixels).toBe(12 * 13);
  });

  it("decodes only after verification into the exact transient RGBA8 runtime contract", async () => {
    const bytes = png(2, 3);
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: bytes,
    });
    const rgba = new Uint8ClampedArray(2 * 3 * 4).fill(17);
    const decode = vi.fn(() => ({ width: 2, height: 3, data: rgba }));

    const image = await decodeStudioVrmTexturePaintArtifact(
      artifact.metadata,
      artifact.archiveEntry.data,
      { dependencies: { decode } },
    );

    expect(decode).toHaveBeenCalledWith(
      artifact.archiveEntry.data,
      artifact.metadata,
      { signal: undefined },
    );
    expect(image).toEqual({ width: 2, height: 3, data: rgba });
    expect(image.data).toBe(rgba);
    expect(Object.isFrozen(image)).toBe(true);
  });

  it("reuses an internal immutable-Blob verification receipt but rechecks public lookalikes", async () => {
    const bytes = png(2, 2);
    const source = new Blob([bytes], { type: "image/png" });
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source,
    });
    expect(artifact.archiveEntry.data).toBe(source);
    const sourceRead = vi.spyOn(source, "arrayBuffer");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    sourceRead.mockClear();
    const decode = vi.fn(() => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    }));

    await decodeStudioVrmTexturePaintArtifact(
      artifact.metadata,
      artifact.archiveEntry.data,
      { dependencies: { decode } },
    );
    expect(sourceRead).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledOnce();

    const publicLookalike = new Blob([bytes], { type: "image/png" });
    await decodeStudioVrmTexturePaintArtifact(
      artifact.metadata,
      publicLookalike,
      { dependencies: { decode } },
    );
    expect(digest).toHaveBeenCalledOnce();
  });

  it("rejects decoder dimension/byte mismatches and never decodes tampered bytes", async () => {
    const bytes = png(2, 2);
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: bytes,
    });
    await expect(decodeStudioVrmTexturePaintArtifact(
      artifact.metadata,
      bytes,
      {
        dependencies: {
          decode: () => ({
            width: 2,
            height: 2,
            data: new Uint8ClampedArray(15),
          }),
        },
      },
    )).rejects.toMatchObject({ code: "DECODE_DIMENSION_MISMATCH" });

    const decode = vi.fn(() => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    }));
    const tampered = png(2, 2, Uint8Array.from([0x78, 0x9c, 9, 8, 7]));
    await expect(decodeStudioVrmTexturePaintArtifact(
      cloneMetadata(artifact.metadata, { byteLength: tampered.byteLength }),
      tampered,
      { dependencies: { decode } },
    )).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("quarantines a late injected decoder completion after abort", async () => {
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png(),
    });
    const controller = new AbortController();
    let finish: ((value: {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }) => void) | undefined;
    const decoded = new Promise<{
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }>((resolve) => {
      finish = resolve;
    });
    const pending = decodeStudioVrmTexturePaintArtifact(
      artifact.metadata,
      artifact.archiveEntry.data,
      {
        signal: controller.signal,
        dependencies: { decode: () => decoded },
      },
    );

    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED", name: "AbortError" });
    finish?.({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
    await Promise.resolve();
  });

  it("rejects duplicate/conflicting manifest bindings before consulting the resolver", async () => {
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png(),
    });
    const resolve = vi.fn(() => artifact.archiveEntry.data);
    const duplicateManifest = {
      schemaVersion: 1,
      kind: "toonspectrum/vrm-texture-paint-artifact-manifest",
      bindings: [artifact.metadata, artifact.metadata],
    };
    await expect(rehydrateStudioVrmTexturePaintArtifactManifest(
      duplicateManifest,
      { resolve },
    )).rejects.toMatchObject({ code: "BINDING_CONFLICT" });
    expect(resolve).not.toHaveBeenCalled();

    const conflictingHash = `sha256:${"a".repeat(64)}` as const;
    const conflictingManifest = {
      schemaVersion: 1,
      kind: "toonspectrum/vrm-texture-paint-artifact-manifest",
      bindings: [
        artifact.metadata,
        cloneMetadata(artifact.metadata, {
          bindingKey: "vrm/b/material/base",
          contentHash: conflictingHash,
        }),
        cloneMetadata(artifact.metadata, {
          bindingKey: "vrm/c/material/base",
          contentHash: conflictingHash,
          width: artifact.metadata.width + 1,
        }),
      ],
    };
    await expect(rehydrateStudioVrmTexturePaintArtifactManifest(
      conflictingManifest,
      { resolve },
    )).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed for missing artifacts, spoofed resolver MIME, and unsafe metadata accessors", async () => {
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png(),
    });
    const manifest = {
      schemaVersion: 1,
      kind: "toonspectrum/vrm-texture-paint-artifact-manifest",
      bindings: [artifact.metadata],
    };
    await expect(rehydrateStudioVrmTexturePaintArtifactManifest(
      manifest,
      { resolve: () => null },
    )).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });
    await expect(rehydrateStudioVrmTexturePaintArtifactManifest(
      manifest,
      { resolve: () => new Blob([png()], { type: "image/jpeg" }) },
    )).rejects.toMatchObject({ code: "MIME_INVALID" });

    const getter = vi.fn(() => artifact.metadata.contentHash);
    const maliciousMetadata = { ...artifact.metadata } as Record<string, unknown>;
    Object.defineProperty(maliciousMetadata, "contentHash", { enumerable: true, get: getter });
    await expect(verifyStudioVrmTexturePaintArtifact(
      maliciousMetadata,
      png(),
    )).rejects.toMatchObject({ code: "METADATA_INVALID" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("quarantines late resolver completion after abort with a typed AbortError", async () => {
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "vrm/a/material/base",
      source: png(),
    });
    const controller = new AbortController();
    let resolveArtifact: ((value: Blob) => void) | undefined;
    const pendingSource = new Promise<Blob>((resolve) => {
      resolveArtifact = resolve;
    });
    const pending = rehydrateStudioVrmTexturePaintArtifactManifest(
      {
        schemaVersion: 1,
        kind: "toonspectrum/vrm-texture-paint-artifact-manifest",
        bindings: [artifact.metadata],
      },
      { resolve: () => pendingSource },
      { signal: controller.signal },
    );

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED", name: "AbortError" });
    resolveArtifact?.(artifact.archiveEntry.data);
    await Promise.resolve();
  });

  it("rejects pre-aborted hashing before it creates an artifact", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createStudioVrmTexturePaintArtifact(
      { bindingKey: "vrm/a/material/base", source: png() },
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "ABORTED", name: "AbortError" });
  });

  it("derives archive paths only from strict lower-case SHA-256 identifiers", () => {
    const hash = `sha256:${"a".repeat(64)}` as const;
    expect(studioVrmTexturePaintArtifactArchivePath(hash)).toBe(
      `artifacts/vrm-texture-paint/${"a".repeat(64)}.png`,
    );
    expect(() => studioVrmTexturePaintArtifactArchivePath(
      `sha256:${"A".repeat(64)}` as StudioVrmTexturePaintArtifactHash,
    )).toThrow(expect.objectContaining({ code: "METADATA_INVALID" }));
  });
});
