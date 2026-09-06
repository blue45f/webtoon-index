import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  importStudioProjectArchive,
  type StudioProjectArchiveImportedAttachment,
  type StudioProjectArchiveManifest,
  type StudioProjectArchiveManifestAttachment,
} from "../studio-project-archive";

import {
  createDefaultStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
  type StudioVrmSceneDocument,
  type StudioVrmSurfacePaintTexture,
} from "./studio-vrm-scene-document";
import {
  createStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
} from "./studio-vrm-texture-paint-artifact";
import {
  auditStudioVrmTexturePaintJsonImport,
  auditStudioVrmTexturePaintProjectLibraryAvailability,
  collectStudioVrmTexturePaintProjectPlan,
  exportStudioVrmTexturePaintProjectLibrary,
  importStudioVrmTexturePaintProjectLibrary,
  inspectStudioVrmTexturePaintJsonExport,
  installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply,
  prepareStudioVrmTexturePaintProjectArchiveImport,
  prepareStudioVrmTexturePaintProjectArchiveExport,
  presentStudioVrmTexturePaintProjectArchiveExport,
  presentStudioVrmTexturePaintProjectArchiveImport,
  type StudioVrmTexturePaintProjectArtifactPlan,
  type StudioVrmTexturePaintProjectAtomicLibraryAdapter,
  type StudioVrmTexturePaintProjectLibraryAdapter,
  type StudioVrmTexturePaintProjectPlan,
} from "./studio-vrm-texture-paint-project-library";

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

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
  view.setUint32(
    result.byteLength - 4,
    crc32(result.subarray(4, result.byteLength - 4)),
    false,
  );
  return result;
}

function concat(
  ...parts: readonly Uint8Array<ArrayBufferLike>[]
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
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

async function artifact(
  bindingKey: string,
  width: number,
  height: number,
  idat?: Uint8Array<ArrayBufferLike>,
): Promise<StudioVrmTexturePaintArtifact> {
  return createStudioVrmTexturePaintArtifact({
    bindingKey,
    source: png(width, height, idat),
    expectedWidth: width,
    expectedHeight: height,
  });
}

function texture(
  value: StudioVrmTexturePaintArtifact,
  bindingKey: string,
  materialLocator: string,
): StudioVrmSurfacePaintTexture {
  return {
    bindingKey,
    materialLocator,
    textureSlot: "baseColor",
    hash: value.metadata.contentHash,
    mime: "image/png",
    byteSize: value.metadata.byteLength,
    width: value.metadata.width,
    height: value.metadata.height,
  };
}

function scene(
  textures: readonly StudioVrmSurfacePaintTexture[],
  expressions: Readonly<Record<string, number>> = {},
): StudioVrmSceneDocument {
  return normalizeStudioVrmSceneDocument({
    ...createDefaultStudioVrmSceneDocument(),
    expressions,
    surfacePaint: { version: 1, textures },
  });
}

function image(id: string, vrmScene: unknown): Record<string, unknown> {
  return { id, type: "image", src: "", vrmScene };
}

function project(
  pageElements: readonly unknown[],
  masterElements: readonly unknown[] = [],
): Record<string, unknown> {
  return {
    version: 2,
    title: "표면 페인팅",
    pagesList: [{
      id: "page-1",
      elements: pageElements,
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 2400,
    }],
    master: { elements: masterElements },
  };
}

function manifestFor(
  plan: StudioVrmTexturePaintProjectPlan,
): StudioProjectArchiveManifest {
  const attachments: StudioProjectArchiveManifestAttachment[] = plan.artifacts.map((item) => ({
    path: `assets/sha256/${item.contentHash.slice("sha256:".length)}.png`,
    mimeType: "image/png",
    byteSize: item.byteLength,
    sha256: item.contentHash.slice("sha256:".length),
    kinds: ["raster"],
    documentReferences: [...item.documentReferences],
  }));
  const attachmentBytes = attachments.reduce((total, item) => total + item.byteSize, 0);
  return {
    schema: "toonspectrum.studio-project-archive",
    version: 2,
    project: {
      path: "project.json",
      mimeType: "application/json",
      byteSize: 2,
      sha256: "0".repeat(64),
    },
    attachments,
    totals: {
      entryCount: attachments.length + 2,
      attachmentCount: attachments.length,
      attachmentBytes,
      contentBytes: attachmentBytes + 2,
    },
  };
}

function importedAttachments(
  plan: StudioVrmTexturePaintProjectPlan,
  byHash: ReadonlyMap<StudioVrmTexturePaintArtifactHash, StudioVrmTexturePaintArtifact>,
): ReadonlyMap<string, StudioProjectArchiveImportedAttachment> {
  const manifest = manifestFor(plan);
  return new Map(manifest.attachments.map((metadata) => {
    const contentHash = `sha256:${metadata.sha256}` as StudioVrmTexturePaintArtifactHash;
    const value = byHash.get(contentHash);
    if (!value) throw new Error("Missing test artifact");
    return [metadata.sha256, { metadata, blob: value.archiveEntry.data }];
  }));
}

function mutableManifestAttachment(
  plan: StudioVrmTexturePaintProjectArtifactPlan,
): StudioProjectArchiveManifestAttachment {
  return {
    path: `assets/sha256/${plan.contentHash.slice("sha256:".length)}.png`,
    mimeType: "image/png",
    byteSize: plan.byteLength,
    sha256: plan.contentHash.slice("sha256:".length),
    kinds: ["raster"],
    documentReferences: plan.documentReferences.map((reference) => ({ ...reference })),
  };
}

describe("studio VRM texture-paint project library bridge", () => {
  it("collects exact page/master RFC 6901 pointers and deduplicates every shared hash", async () => {
    const shared = await artifact("shared", 2, 3);
    const unique = await artifact("unique", 4, 5, Uint8Array.from([0x78, 0x9c, 1, 2, 3]));
    const pageScene = scene([
      texture(unique, "unique-page", "gltf-material:2"),
      texture(shared, "shared-page", "gltf-material:1"),
    ]);
    const masterScene = scene([
      texture(shared, "shared-master", "scene-path:Avatar/Shared/Material"),
    ]);
    const value = project(
      [image("page-image", pageScene), { id: "text", type: "text" }],
      [image("master-image", masterScene)],
    );

    const plan = await collectStudioVrmTexturePaintProjectPlan(value);
    expect(plan.sceneFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(plan.artifacts).toHaveLength(2);
    expect(plan.referenceCount).toBe(3);
    expect(plan.totalBytes).toBe(shared.metadata.byteLength + unique.metadata.byteLength);

    const sharedPlan = plan.artifacts.find(
      (item) => item.contentHash === shared.metadata.contentHash,
    );
    expect(sharedPlan?.references.map(({ pointer }) => pointer)).toEqual([
      "/master/elements/0/vrmScene/surfacePaint/textures/0/hash",
      "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash",
    ]);
    expect(sharedPlan?.documentReferences).toEqual([
      {
        pointer: "/master/elements/0/vrmScene/surfacePaint/textures/0/hash",
        usage: "raster",
        mode: "sha256-prefixed",
      },
      {
        pointer: "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash",
        usage: "raster",
        mode: "sha256-prefixed",
      },
    ]);
  });

  it("fails closed when one shared hash declares conflicting byte or dimension metadata", async () => {
    const value = await artifact("shared", 2, 2);
    const first = texture(value, "first", "gltf-material:0");
    const conflict = { ...texture(value, "second", "gltf-material:1"), width: 3 };
    const raw = project(
      [image("first", scene([first]))],
      [image("second", scene([conflict]))],
    );

    await expect(collectStudioVrmTexturePaintProjectPlan(raw)).rejects.toMatchObject({
      code: "SURFACE_PAINT_METADATA_CONFLICT",
    });
  });

  it("requires strict v6 scenes and matching full-scene fingerprints", async () => {
    const value = await artifact("strict", 2, 2);
    const currentScene = scene([texture(value, "strict", "gltf-material:0")]);
    const legacy = JSON.parse(JSON.stringify(currentScene)) as Record<string, unknown>;
    delete legacy.surfacePaint;
    delete legacy.lightingTone;
    legacy.version = 4;
    const legacyProject = project([image("legacy", legacy)]);
    await expect(collectStudioVrmTexturePaintProjectPlan(legacyProject)).rejects.toMatchObject({
      code: "SCENE_INVALID",
    });

    const source = project([image("current", currentScene)]);
    const differentCanonical = project([
      image("current", scene(currentScene.surfacePaint.textures, { happy: 1 })),
    ]);
    await expect(exportStudioVrmTexturePaintProjectLibrary({
      project: source,
      canonicalProject: differentCanonical,
      library: { resolve: () => value.archiveEntry.data },
    })).rejects.toMatchObject({ code: "CANONICAL_SCENE_FINGERPRINT_MISMATCH" });
  });

  it("audits local availability without archive export, artifact verification, or duplicate planning", async () => {
    const value = await artifact("availability-ready", 2, 3);
    const raw = project([image("ready", scene([
      texture(value, "availability-ready", "gltf-material:0"),
    ]))]);
    const digestText = vi.fn(async () => "a".repeat(64));
    const verifyArtifact = vi.fn(async () => {
      throw new Error("availability audit must not verify or export PNG bytes");
    });
    const resolve = vi.fn(() => value.archiveEntry.data);

    const result = await auditStudioVrmTexturePaintProjectLibraryAvailability({
      project: raw,
      canonicalProject: raw,
      library: { resolve },
      dependencies: { digestText, verifyArtifact },
    });

    expect(result).toMatchObject({
      status: "ready",
      artifactCount: 1,
      checkedCount: 1,
      diagnostics: [],
    });
    expect(digestText).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(verifyArtifact).not.toHaveBeenCalled();
  });

  it("distinguishes missing local artifacts from an unavailable local library", async () => {
    const value = await artifact("availability-state", 2, 2);
    const raw = project([image("availability", scene([
      texture(value, "availability-state", "gltf-material:0"),
    ]))]);

    await expect(auditStudioVrmTexturePaintProjectLibraryAvailability({
      project: raw,
      canonicalProject: raw,
      library: { resolve: () => null },
    })).resolves.toMatchObject({
      status: "unresolved",
      artifactCount: 1,
      checkedCount: 1,
      diagnostics: [{
        code: "LIBRARY_ARTIFACT_MISSING",
        contentHash: value.metadata.contentHash,
      }],
    });

    await expect(auditStudioVrmTexturePaintProjectLibraryAvailability({
      project: raw,
      canonicalProject: raw,
      library: {
        resolve: () => {
          throw new Error("storage access denied");
        },
      },
    })).resolves.toMatchObject({
      status: "unavailable",
      artifactCount: 1,
      checkedCount: 0,
      diagnostics: [{
        code: "LIBRARY_UNAVAILABLE",
        contentHash: value.metadata.contentHash,
      }],
    });

    await expect(auditStudioVrmTexturePaintProjectLibraryAvailability({
      project: raw,
      canonicalProject: raw,
      dependencies: { libraryOptions: { indexedDb: null } },
    })).resolves.toMatchObject({
      status: "unavailable",
      artifactCount: 1,
      checkedCount: 0,
      diagnostics: [{ code: "LIBRARY_UNAVAILABLE" }],
    });
  });

  it("exports one verified raster attachment with complete sha256-prefixed pointer coverage", async () => {
    const value = await artifact("export", 3, 4);
    const pageScene = scene([texture(value, "page", "gltf-material:0")]);
    const masterScene = scene([texture(value, "master", "gltf-material:1")]);
    const raw = project(
      [image("page", pageScene)],
      [image("master", masterScene)],
    );
    const resolve = vi.fn(() => value.archiveEntry.data);

    const result = await exportStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      library: { resolve },
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready export");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      kind: "raster",
      mimeType: "image/png",
      documentReferences: [
        {
          pointer: "/master/elements/0/vrmScene/surfacePaint/textures/0/hash",
          usage: "raster",
          mode: "sha256-prefixed",
        },
        {
          pointer: "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash",
          usage: "raster",
          mode: "sha256-prefixed",
        },
      ],
    });
    expect(result.attachments[0]?.data).toBe(value.archiveEntry.data);
  });

  it("applies device archive ceilings before resolving any surface-paint PNG bytes", async () => {
    const first = await artifact("preflight-first", 2, 2);
    const second = await artifact(
      "preflight-second",
      3,
      3,
      Uint8Array.from([0x78, 0x9c, 2, 4, 6, 8]),
    );
    const resolve = vi.fn(() => first.archiveEntry.data);
    const oversizedProject = project([image("oversized", scene([{
      ...texture(first, "preflight-first", "gltf-material:0"),
      byteSize: 40_000_000,
    }]))]);
    await expect(exportStudioVrmTexturePaintProjectLibrary({
      project: oversizedProject,
      canonicalProject: oversizedProject,
      library: { resolve },
      limits: {
        maxAttachmentBytes: 32_000_000,
        maxTotalAttachmentBytes: 64_000_000,
        maxAttachments: 2,
      },
    })).rejects.toMatchObject({ code: "PROJECT_LIMIT_EXCEEDED" });

    const aggregateProject = project([image("aggregate", scene([
      {
        ...texture(first, "preflight-first", "gltf-material:0"),
        byteSize: 20_000_000,
      },
      {
        ...texture(second, "preflight-second", "gltf-material:1"),
        byteSize: 20_000_000,
      },
    ]))]);
    await expect(exportStudioVrmTexturePaintProjectLibrary({
      project: aggregateProject,
      canonicalProject: aggregateProject,
      library: { resolve },
      limits: {
        maxAttachmentBytes: 32_000_000,
        maxTotalAttachmentBytes: 32_000_000,
        maxAttachments: 2,
      },
    })).rejects.toMatchObject({ code: "PROJECT_LIMIT_EXCEEDED" });

    const countProject = project([image("count", scene([
      texture(first, "preflight-first", "gltf-material:0"),
      texture(second, "preflight-second", "gltf-material:1"),
    ]))]);
    await expect(exportStudioVrmTexturePaintProjectLibrary({
      project: countProject,
      canonicalProject: countProject,
      library: { resolve },
      limits: { maxAttachments: 1 },
    })).rejects.toMatchObject({ code: "PROJECT_LIMIT_EXCEEDED" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns complete unresolved diagnostics and never emits a partial export", async () => {
    const available = await artifact("available", 2, 2);
    const missing = await artifact("missing", 3, 3, Uint8Array.from([0x78, 0x9c, 4, 5, 6]));
    const raw = project([image("both", scene([
      texture(available, "available", "gltf-material:0"),
      texture(missing, "missing", "gltf-material:1"),
    ]))]);

    const result = await exportStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      library: {
        resolve: (hash) => hash === available.metadata.contentHash
          ? available.archiveEntry.data
          : null,
      },
    });

    expect(result).toMatchObject({
      status: "unresolved",
      attachments: [],
      diagnostics: [{
        code: "LIBRARY_ARTIFACT_MISSING",
        contentHash: missing.metadata.contentHash,
      }],
    });
  });

  it("authenticates all archive bytes before installing and verifies the installed receipt again", async () => {
    const value = await artifact("install", 5, 6);
    const raw = project([image("install", scene([
      texture(value, "install", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const manifest = manifestFor(plan);
    const imported = importedAttachments(
      plan,
      new Map([[value.metadata.contentHash, value]]),
    );
    let installedBlob: Blob | null = null;
    const library: StudioVrmTexturePaintProjectLibraryAdapter = {
      resolve: vi.fn(() => installedBlob),
      install: vi.fn((artifactValue) => {
        installedBlob = artifactValue.archiveEntry.data;
        return "installed" as const;
      }),
    };

    const result = await importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest,
      attachments: imported,
      library,
    });

    expect(result).toMatchObject({ status: "ready", installed: 1, reused: 0 });
    expect(library.install).toHaveBeenCalledTimes(1);
    expect(library.resolve).toHaveBeenCalledTimes(2);
  });

  it("reuses a fully reverified local artifact without writing IndexedDB", async () => {
    const value = await artifact("reuse", 2, 7);
    const raw = project([image("reuse", scene([
      texture(value, "reuse", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const install = vi.fn(() => "installed" as const);
    const library: StudioVrmTexturePaintProjectLibraryAdapter = {
      resolve: () => value.archiveEntry.data,
      install,
    };

    const result = await importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest: manifestFor(plan),
      attachments: importedAttachments(
        plan,
        new Map([[value.metadata.contentHash, value]]),
      ),
      library,
    });

    expect(result).toMatchObject({ status: "ready", installed: 0, reused: 1 });
    expect(install).not.toHaveBeenCalled();
  });

  it.each([
    ["kind", { kinds: ["mask"] }],
    ["MIME", { mimeType: "image/jpeg", path: "assets/sha256/invalid.jpg" }],
    ["size", { byteSize: 999 }],
    ["mode", {
      documentReferences: [{
        pointer: "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash",
        usage: "raster",
        mode: "asset-uri",
      }],
    }],
  ])("fails closed on archive %s metadata conflicts", async (_name, override) => {
    const value = await artifact("metadata", 2, 2);
    const raw = project([image("metadata", scene([
      texture(value, "metadata", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const entry = { ...mutableManifestAttachment(plan.artifacts[0]!), ...override };
    const manifest = { ...manifestFor(plan), attachments: [entry] } as StudioProjectArchiveManifest;
    const attachments = new Map([[
      value.metadata.contentHash.slice("sha256:".length),
      { metadata: entry, blob: value.archiveEntry.data },
    ]]) as ReadonlyMap<string, StudioProjectArchiveImportedAttachment>;

    await expect(importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest,
      attachments,
      library: { resolve: () => null, install: () => "installed" },
    })).rejects.toMatchObject({ code: "ARCHIVE_METADATA_CONFLICT" });
  });

  it("accepts hash dedupe with additional non-surface raster/mask references and kinds", async () => {
    const value = await artifact("shared-archive-asset", 2, 2);
    const raw = project([image("shared", scene([
      texture(value, "shared-archive-asset", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const base = mutableManifestAttachment(plan.artifacts[0]!);
    const metadata: StudioProjectArchiveManifestAttachment = {
      ...base,
      kinds: ["raster", "mask"],
      documentReferences: [
        {
          pointer: "/pagesList/0/elements/0/maskSrc",
          usage: "mask",
          mode: "asset-uri",
        },
        {
          pointer: "/pagesList/0/elements/0/src",
          usage: "raster",
          mode: "asset-uri",
        },
        ...base.documentReferences,
      ],
    };
    const manifest = { ...manifestFor(plan), attachments: [metadata] };
    const attachments = new Map([[
      metadata.sha256,
      { metadata, blob: value.archiveEntry.data },
    ]]);

    await expect(importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest,
      attachments,
      library: {
        resolve: () => value.archiveEntry.data,
        install: () => "installed",
      },
    })).resolves.toMatchObject({ status: "ready", installed: 0, reused: 1 });
  });

  it("binds each surface pointer to its exact manifest hash and rejects swapped ownership", async () => {
    const first = await artifact("first", 2, 2);
    const second = await artifact("second", 3, 3, Uint8Array.from([0x78, 0x9c, 7, 8, 9]));
    const raw = project([image("both", scene([
      texture(first, "first", "gltf-material:0"),
      texture(second, "second", "gltf-material:1"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const manifest = manifestFor(plan);
    const swapped = {
      ...manifest,
      attachments: manifest.attachments.map((entry, index) => ({
        ...entry,
        documentReferences: manifest.attachments[1 - index]!.documentReferences,
      })),
    };

    await expect(importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest: swapped,
      attachments: importedAttachments(
        plan,
        new Map([
          [first.metadata.contentHash, first],
          [second.metadata.contentHash, second],
        ]),
      ),
      library: { resolve: () => null, install: () => "installed" },
    })).rejects.toMatchObject({ code: "ARCHIVE_METADATA_CONFLICT" });
  });

  it("reports missing archive hashes before any library mutation", async () => {
    const value = await artifact("missing-import", 2, 2);
    const raw = project([image("missing", scene([
      texture(value, "missing-import", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const install = vi.fn(() => "installed" as const);

    const result = await importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest: { ...manifestFor(plan), attachments: [] },
      attachments: new Map(),
      library: { resolve: () => null, install },
    });

    expect(result).toMatchObject({
      status: "unresolved",
      installed: 0,
      reused: 0,
      diagnostics: [{
        code: "ARCHIVE_ATTACHMENT_MISSING",
        contentHash: value.metadata.contentHash,
      }],
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("rejects tampered PNG bytes before touching the local library", async () => {
    const value = await artifact("tampered", 2, 2);
    const replacement = await artifact(
      "replacement",
      2,
      2,
      Uint8Array.from([0x78, 0x9c, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
    );
    const raw = project([image("tampered", scene([
      texture(value, "tampered", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const metadata = manifestFor(plan).attachments[0]!;
    const install = vi.fn(() => "installed" as const);

    await expect(importStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      manifest: manifestFor(plan),
      attachments: new Map([[
        metadata.sha256,
        { metadata, blob: replacement.archiveEntry.data },
      ]]),
      library: { resolve: () => null, install },
    })).rejects.toMatchObject({ code: "ARTIFACT_VERIFICATION_FAILED" });
    expect(install).not.toHaveBeenCalled();
  });

  it("uses the default IndexedDB adapter to install, reuse, and export verified PNGs", async () => {
    const factory = new IDBFactory();
    const value = await artifact("default-library", 3, 2);
    const raw = project([image("default", scene([
      texture(value, "default-library", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const bridge = {
      project: raw,
      canonicalProject: raw,
      dependencies: { libraryOptions: { indexedDb: factory } },
    } as const;

    const installed = await importStudioVrmTexturePaintProjectLibrary({
      ...bridge,
      manifest: manifestFor(plan),
      attachments: importedAttachments(
        plan,
        new Map([[value.metadata.contentHash, value]]),
      ),
    });
    expect(installed).toMatchObject({ status: "ready", installed: 1, reused: 0 });

    const reused = await importStudioVrmTexturePaintProjectLibrary({
      ...bridge,
      manifest: manifestFor(plan),
      attachments: importedAttachments(
        plan,
        new Map([[value.metadata.contentHash, value]]),
      ),
    });
    expect(reused).toMatchObject({ status: "ready", installed: 0, reused: 1 });

    const exported = await exportStudioVrmTexturePaintProjectLibrary(bridge);
    expect(exported).toMatchObject({ status: "ready", attachments: [{ kind: "raster" }] });
  });

  it.each(["rejects", "throws", "compensation-fails"] as const)(
    "keeps staged prepare read-only and exactly compensates created PNGs when apply %s",
    async (failure) => {
      const value = await artifact(`atomic-${failure}`, 2, 2);
      const raw = project([image(`atomic-${failure}`, scene([
        texture(value, `atomic-${failure}`, "gltf-material:0"),
      ]))]);
      const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
      const stored = new Map<StudioVrmTexturePaintArtifactHash, Blob>();
      const install = vi.fn(async (candidate: StudioVrmTexturePaintArtifact) => {
        stored.set(candidate.metadata.contentHash, candidate.archiveEntry.data);
        return {
          disposition: "installed" as const,
          creationReceipt: {
            schema: "toonspectrum.vrm-texture-paint-library-creation" as const,
            version: 1 as const,
            authority: "legacy-indexeddb" as const,
            contentHash: candidate.metadata.contentHash,
          },
          mutationGeneration: null,
        };
      });
      const compensate = vi.fn(async (receipts: readonly { readonly contentHash: string }[]) => {
        receipts.forEach((receipt) => stored.delete(
          receipt.contentHash as StudioVrmTexturePaintArtifactHash,
        ));
        return failure !== "compensation-fails";
      });
      const library: StudioVrmTexturePaintProjectAtomicLibraryAdapter = {
        resolve: (hash) => stored.get(hash) ?? null,
        installWithCreationReceipt: install,
        compensateCreated: compensate,
      };
      const prepared = await prepareStudioVrmTexturePaintProjectArchiveImport({
        project: raw,
        canonicalProject: raw,
        manifest: manifestFor(plan),
        attachments: importedAttachments(
          plan,
          new Map([[value.metadata.contentHash, value]]),
        ),
        library,
      });
      expect(install).not.toHaveBeenCalled();
      expect(stored.size).toBe(0);

      const commit = installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
        prepared,
        prepared.project,
        () => {
          if (failure === "throws") throw new Error("apply exploded");
          return false;
        },
        { didApply: (result) => result !== false },
      );
      if (failure === "throws") await expect(commit).rejects.toThrow("apply exploded");
      else if (failure === "compensation-fails") {
        await expect(commit).rejects.toThrow("안전한 보상을 완료하지 못했습니다");
      } else await expect(commit).resolves.toMatchObject({ applyResult: false });
      expect(install).toHaveBeenCalledTimes(1);
      expect(compensate).toHaveBeenCalledTimes(1);
      expect(stored.size).toBe(0);
      await expect(installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
        prepared,
        prepared.project,
        () => true,
        { didApply: (result) => result },
      )).rejects.toMatchObject({ code: "LIBRARY_INSTALL_FAILED" });
    },
  );

  it("compensates a created PNG even when caller cancellation arrives after its durable install", async () => {
    const value = await artifact("atomic-abort-after-install", 2, 2);
    const raw = project([image("atomic-abort-after-install", scene([
      texture(value, "atomic-abort-after-install", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const controller = new AbortController();
    const stored = new Map<StudioVrmTexturePaintArtifactHash, Blob>();
    const compensate = vi.fn(async (
      receipts: readonly { readonly contentHash: string }[],
      _generations: readonly number[],
      context: { readonly signal?: AbortSignal },
    ) => {
      expect(context.signal).toBeUndefined();
      receipts.forEach((receipt) => stored.delete(
        receipt.contentHash as StudioVrmTexturePaintArtifactHash,
      ));
      return true;
    });
    const library: StudioVrmTexturePaintProjectAtomicLibraryAdapter = {
      resolve: (hash) => stored.get(hash) ?? null,
      installWithCreationReceipt: async (candidate) => {
        stored.set(candidate.metadata.contentHash, candidate.archiveEntry.data);
        controller.abort();
        return {
          disposition: "installed",
          creationReceipt: {
            schema: "toonspectrum.vrm-texture-paint-library-creation",
            version: 1,
            authority: "legacy-indexeddb",
            contentHash: candidate.metadata.contentHash,
          },
          mutationGeneration: null,
        };
      },
      compensateCreated: compensate,
    };
    const prepared = await prepareStudioVrmTexturePaintProjectArchiveImport({
      project: raw,
      canonicalProject: raw,
      manifest: manifestFor(plan),
      attachments: importedAttachments(plan, new Map([[value.metadata.contentHash, value]])),
      library,
      signal: controller.signal,
    });

    await expect(installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
      prepared,
      prepared.project,
      () => true,
      { didApply: (result) => result },
    )).rejects.toMatchObject({ code: "ABORTED" });
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
  });

  it("preserves a verified shared PNG on rejected apply and never calls compensation", async () => {
    const value = await artifact("atomic-reuse", 2, 2);
    const raw = project([image("atomic-reuse", scene([
      texture(value, "atomic-reuse", "gltf-material:0"),
    ]))]);
    const plan = await collectStudioVrmTexturePaintProjectPlan(raw);
    const install = vi.fn();
    const compensate = vi.fn(async () => true);
    const prepared = await prepareStudioVrmTexturePaintProjectArchiveImport({
      project: raw,
      canonicalProject: raw,
      manifest: manifestFor(plan),
      attachments: importedAttachments(plan, new Map([[value.metadata.contentHash, value]])),
      library: {
        resolve: () => value.archiveEntry.data,
        installWithCreationReceipt: install,
        compensateCreated: compensate,
      },
    });
    await expect(installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
      prepared,
      prepared.project,
      () => false,
      { didApply: (result) => result },
    )).resolves.toMatchObject({ applyResult: false, installed: 0, reused: 1 });
    expect(install).not.toHaveBeenCalled();
    expect(compensate).not.toHaveBeenCalled();
  });

  it("atomically consumes a prepared capability before concurrent fingerprint awaits", async () => {
    const value = await artifact("concurrent-one-shot", 2, 2);
    const raw = project([image("concurrent-one-shot", scene([
      texture(value, "concurrent-one-shot", "gltf-material:0"),
    ]))]);
    let releaseDigest: (() => void) | undefined;
    let blockNextDigest = false;
    const digestText = vi.fn(async () => {
      if (blockNextDigest) {
        blockNextDigest = false;
        await new Promise<void>((resolve) => {
          releaseDigest = resolve;
        });
      }
      return "a".repeat(64);
    });
    const initialPlan = await collectStudioVrmTexturePaintProjectPlan(raw, {
      dependencies: { digestText },
    });
    const stored = new Map<StudioVrmTexturePaintArtifactHash, Blob>();
    const install = vi.fn(async (candidate: StudioVrmTexturePaintArtifact) => {
      stored.set(candidate.metadata.contentHash, candidate.archiveEntry.data);
      return {
        disposition: "installed" as const,
        creationReceipt: {
          schema: "toonspectrum.vrm-texture-paint-library-creation" as const,
          version: 1 as const,
          authority: "legacy-indexeddb" as const,
          contentHash: candidate.metadata.contentHash,
        },
        mutationGeneration: null,
      };
    });
    const library: StudioVrmTexturePaintProjectAtomicLibraryAdapter = {
      resolve: (hash) => stored.get(hash) ?? null,
      installWithCreationReceipt: install,
      compensateCreated: async () => true,
    };
    const prepared = await prepareStudioVrmTexturePaintProjectArchiveImport({
      project: raw,
      canonicalProject: raw,
      manifest: manifestFor(initialPlan),
      attachments: importedAttachments(
        initialPlan,
        new Map([[value.metadata.contentHash, value]]),
      ),
      library,
      dependencies: { digestText },
    });
    blockNextDigest = true;
    const first = installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
      prepared,
      prepared.project,
      () => true,
      { didApply: (result) => result },
    );
    await vi.waitFor(() => expect(releaseDigest).toBeTypeOf("function"));
    await expect(installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(
      prepared,
      prepared.project,
      () => true,
      { didApply: (result) => result },
    )).rejects.toMatchObject({ code: "LIBRARY_INSTALL_FAILED" });
    releaseDigest?.();
    await expect(first).resolves.toMatchObject({ applyResult: true, installed: 1 });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("round-trips through the real project archive and installs its authenticated PNG", async () => {
    const value = await artifact("archive-roundtrip", 4, 3);
    const element = image("archive", scene([
      texture(value, "archive-roundtrip", "gltf-material:0"),
    ]));
    const encoded = globalThis.btoa(String.fromCharCode(
      ...new Uint8Array(await value.archiveEntry.data.arrayBuffer()),
    ));
    element.src = `data:image/png;base64,${encoded}`;
    element.maskSrc = `data:image/png;base64,${encoded}`;
    const raw = project([element]);
    const exported = await exportStudioVrmTexturePaintProjectLibrary({
      project: raw,
      canonicalProject: raw,
      library: { resolve: () => value.archiveEntry.data },
    });
    if (exported.status !== "ready") throw new Error("Expected ready export");

    const built = await buildStudioProjectArchive({
      project: raw,
      attachments: exported.attachments,
    });
    expect(built.manifest.attachments).toEqual([
      expect.objectContaining({
        mimeType: "image/png",
        kinds: ["raster", "mask"],
        sha256: value.metadata.contentHash.slice("sha256:".length),
        documentReferences: expect.arrayContaining([
          {
            pointer: "/pagesList/0/elements/0/maskSrc",
            usage: "mask",
            mode: "asset-uri",
          },
          {
            pointer: "/pagesList/0/elements/0/src",
            usage: "raster",
            mode: "asset-uri",
          },
          {
            pointer: "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash",
            usage: "raster",
            mode: "sha256-prefixed",
          },
        ]),
      }),
    ]);

    const imported = await importStudioProjectArchive(built.blob, {
      rehydrateDataUrls: false,
    });
    const factory = new IDBFactory();
    const restored = await importStudioVrmTexturePaintProjectLibrary({
      project: imported.project,
      canonicalProject: imported.canonicalProject,
      manifest: imported.manifest,
      attachments: imported.attachments,
      dependencies: { libraryOptions: { indexedDb: factory } },
    });
    expect(restored).toMatchObject({ status: "ready", installed: 1, reused: 0 });

    await expect(exportStudioVrmTexturePaintProjectLibrary({
      project: imported.project,
      canonicalProject: imported.canonicalProject,
      dependencies: { libraryOptions: { indexedDb: factory } },
    })).resolves.toMatchObject({ status: "ready", attachments: [{ kind: "raster" }] });
  });

  it("presents JSON export portability only when surface-paint receipts exist", async () => {
    await expect(
      inspectStudioVrmTexturePaintJsonExport(project([])),
    ).resolves.toBeNull();

    const first = await artifact("json-export-first", 2, 2);
    const second = await artifact(
      "json-export-second",
      3,
      3,
      Uint8Array.from([0x78, 0x9c, 4, 5, 6]),
    );
    await expect(inspectStudioVrmTexturePaintJsonExport(project([
      image("json-export", scene([
        texture(first, "json-export-first", "gltf-material:0"),
        texture(second, "json-export-second", "gltf-material:1"),
      ])),
    ]))).resolves.toEqual({
      tone: "warn",
      text: expect.stringMatching(
        /VRM 표면 페인팅 PNG 2개의 SHA-256 영수증.*\.toonproject\.zip/u,
      ),
    });

    await expect(inspectStudioVrmTexturePaintJsonExport({ invalid: true })).resolves.toEqual({
      tone: "warn",
      text: expect.stringMatching(
        /영수증을 검사하지 못했습니다.*\.toonproject\.zip/u,
      ),
    });
  });

  it("presents deterministic ready and fail-closed unavailable states for JSON imports", async () => {
    await expect(
      auditStudioVrmTexturePaintJsonImport(project([])),
    ).resolves.toEqual({ notice: null, alertSuffix: "" });

    const factory = new IDBFactory();
    const value = await artifact("json-import-missing", 2, 2);
    vi.stubGlobal("indexedDB", factory);
    try {
      const presentation = await auditStudioVrmTexturePaintJsonImport(project([
        image("json-import-missing", scene([
          texture(value, "json-import-missing", "gltf-material:0"),
        ])),
      ]));
      expect(presentation).toEqual({
        notice: {
          tone: "warn",
          text: expect.stringMatching(/로컬 저장소를 확인할 수 없습니다.*\.toonproject\.zip/u),
        },
        alertSuffix: expect.stringMatching(/로컬 저장소를 확인할 수 없어.*archive/u),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns authenticated archive attachments and refuses non-portable exports", async () => {
    const value = await artifact("archive-export-facade", 3, 2);
    const raw = project([image("archive-export-facade", scene([
      texture(value, "archive-export-facade", "gltf-material:0"),
    ]))]);

    await expect(prepareStudioVrmTexturePaintProjectArchiveExport({
      project: raw,
      canonicalProject: raw,
      library: { resolve: () => value.archiveEntry.data },
    })).resolves.toEqual([
      expect.objectContaining({
        kind: "raster",
        data: value.archiveEntry.data,
        mimeType: "image/png",
      }),
    ]);

    await expect(prepareStudioVrmTexturePaintProjectArchiveExport({
      project: raw,
      canonicalProject: raw,
      library: { resolve: () => null },
    })).rejects.toThrow(
      "VRM 표면 페인팅 PNG 1개를 이 기기의 검증 저장소에서 찾지 못해 휴대 가능한 archive를 만들지 않았습니다.",
    );
  });

  it("summarizes fully portable and partially unresolved archive imports", async () => {
    const value = await artifact("archive-import-presentation", 1, 1);
    const ready = presentStudioVrmTexturePaintProjectArchiveImport({
      isSelfContained: true,
      attachmentCount: 9,
      warningCount: 0,
      referenceInstalled: 2,
      referenceReused: 1,
      referenceUnresolved: 0,
      vrmInstalled: 1,
      vrmReused: 2,
      vrmUnresolved: 0,
      background3dInstalled: 3,
      texturePaint: {
        status: "ready",
        sceneFingerprint: value.metadata.contentHash,
        installed: 4,
        reused: 5,
        diagnostics: [],
      },
    });
    expect(ready).toEqual({
      fullyResolved: true,
      notice: {
        tone: "good",
        text: expect.stringMatching(
          /자산 9개.*참고 이미지 2개 설치·1개 재사용.*VRM 1개 설치·2개 재사용.*표면 페인팅 PNG 4개 설치·5개 재사용.*3D 배경 모델 3개/u,
        ),
      },
    });

    const unresolved = presentStudioVrmTexturePaintProjectArchiveImport({
      isSelfContained: false,
      attachmentCount: 1,
      warningCount: 2,
      referenceInstalled: 0,
      referenceReused: 0,
      referenceUnresolved: 3,
      vrmInstalled: 0,
      vrmReused: 0,
      vrmUnresolved: 4,
      background3dInstalled: 0,
      texturePaint: {
        status: "unresolved",
        sceneFingerprint: value.metadata.contentHash,
        installed: 0,
        reused: 0,
        diagnostics: [{
          severity: "error",
          code: "LIBRARY_ARTIFACT_MISSING",
          message: "missing",
          contentHash: value.metadata.contentHash,
          pointers: ["/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash"],
        }],
      },
    });
    expect(unresolved).toEqual({
      fullyResolved: false,
      notice: {
        tone: "warn",
        text: expect.stringMatching(
          /외부 종속성 경고 2건.*미해결 참고 이미지 3개.*미해결 VRM 4개.*미해결 VRM 표면 페인팅 1개/u,
        ),
      },
    });
  });

  it("summarizes portable and dependency-bound archive exports outside Studio's initial route", () => {
    expect(presentStudioVrmTexturePaintProjectArchiveExport({
      isSelfContained: true,
      attachmentCount: 7,
      warningCount: 0,
      missingReferenceCount: 0,
      missingVrmCount: 0,
    })).toEqual({
      tone: "good",
      text: expect.stringMatching(/중복 제거 자산 7개.*무결성 검증형 archive/u),
    });

    expect(presentStudioVrmTexturePaintProjectArchiveExport({
      isSelfContained: false,
      attachmentCount: 3,
      warningCount: 2,
      missingReferenceCount: 4,
      missingVrmCount: 5,
    })).toEqual({
      tone: "warn",
      text: expect.stringMatching(
        /외부 종속성 경고 2건.*참고 이미지 원본 4개.*업로드 VRM 원본 5개/u,
      ),
    });
  });
});
