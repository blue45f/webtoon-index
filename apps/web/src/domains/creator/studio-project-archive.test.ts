import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import { disposeSharedStudioBg3dValidationWorker } from "./bg3d/studio-bg3d-glb-validation-worker-client";
import { StudioBg3dValidationWorkerTestFixture } from "./bg3d/studio-bg3d-glb-validation-worker.test-fixture";
import { createStudioBg3dMeshoptCompressedTriangleGlbFixture } from "./bg3d/studio-bg3d-meshopt.test-fixture";
import {
  STUDIO_BG3D_GLB_MIME,
  createDefaultStudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import {
  buildStudioPackageArchiveBlob as buildStudioPackageArchiveBlobWithBackend,
} from "./studio-package-archive";
import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  collectStudioBg3dProjectArchivePlan,
  importStudioProjectArchive,
  resolveStudioProjectArchiveAttachment,
  STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX,
  STUDIO_PROJECT_ARCHIVE_MIME,
  STUDIO_PROJECT_ARCHIVE_VERSION,
  StudioProjectArchiveError,
  type StudioProjectArchiveAttachmentInput,
  type StudioProjectArchiveManifest,
} from "./studio-project-archive";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";
import { createNativePluralShared3dStageFixture } from "./studio-shared-3d-stage-test-fixture";
import { buildVrmPoseDataUrlMetadata } from "./vrm/studio-vrm-poser-utils";
import {
  STUDIO_VRM_SCENE_DOCUMENT_VERSION,
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

function installBg3dValidationWorker(): void {
  vi.stubGlobal("Worker", StudioBg3dValidationWorkerTestFixture);
}

afterEach(() => {
  disposeSharedStudioBg3dValidationWorker();
  vi.unstubAllGlobals();
});

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioPackageArchiveBlob(
  entries: Parameters<typeof buildStudioPackageArchiveBlobWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioPackageArchiveBlobWithBackend>[1]> = {},
): ReturnType<typeof buildStudioPackageArchiveBlobWithBackend> {
  return buildStudioPackageArchiveBlobWithBackend(entries, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function minimalPage(elements: unknown[] = [], bg = "#ffffff") {
  return { id: "page-1", elements, bg, bgGrad: null, canvasH: 1_080 };
}

function projectWith(elements: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    title: "기억 시장",
    description: "archive round trip",
    tagsText: "판타지",
    pagesList: [minimalPage(elements)],
    currentPageId: "page-1",
    webtoonTheme: "classic",
    panelGutter: 24,
    ...extra,
  };
}

function nestedObject(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

function pngBytes(seed = 1): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

const SURFACE_PNG_CRC_TABLE = (() => {
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

function surfacePngCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (SURFACE_PNG_CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function surfacePngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(encoder.encode(type), 4);
  result.set(data, 8);
  view.setUint32(
    result.byteLength - 4,
    surfacePngCrc32(result.subarray(4, result.byteLength - 4)),
    false,
  );
  return result;
}

function surfacePaintPngBytes(width: number, height: number, seed = 1): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    surfacePngChunk("IHDR", ihdr),
    surfacePngChunk("IDAT", Uint8Array.from([
      0x78, 0x9c, 0x63, 0x60, seed & 0xff, 0x02, 0, 0, 0x05, 0, 0x01,
    ])),
    surfacePngChunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function gifBytes(seed = 1): Uint8Array {
  return Uint8Array.from([...encoder.encode("GIF89a"), seed]);
}

function glbDocumentBytes(document: Record<string, unknown>): Uint8Array {
  const serialized = JSON.stringify(document);
  const encoded = encoder.encode(serialized);
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength);
  bytes.set(encoder.encode("glTF"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f_534a, true);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  return bytes;
}

function glbBytes(seed = 0, externalImage = false): Uint8Array {
  return glbDocumentBytes({
    asset: { version: "2.0" },
    extras: { seed },
    ...(externalImage ? { images: [{ uri: "external-texture.png" }] } : {}),
  });
}

function glbWithDuplicateJsonChunks(): Uint8Array {
  const encoded = encoder.encode(JSON.stringify({ asset: { version: "2.0" } }));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const chunkLength = 8 + jsonLength;
  const bytes = new Uint8Array(12 + chunkLength * 2);
  bytes.set(encoder.encode("glTF"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  for (const offset of [12, 12 + chunkLength]) {
    view.setUint32(offset, jsonLength, true);
    view.setUint32(offset + 4, 0x4e4f_534a, true);
    bytes.fill(0x20, offset + 8, offset + 8 + jsonLength);
    bytes.set(encoded, offset + 8);
  }
  return bytes;
}

function wavBytes(): Uint8Array {
  return Uint8Array.from([
    ...encoder.encode("RIFF"),
    4, 0, 0, 0,
    ...encoder.encode("WAVE"),
  ]);
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("not canonical JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function setUint16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 2).setUint16(0, value, true);
}

function setUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value, true);
}

function centralOffset(bytes: Uint8Array): number {
  const eocd = bytes.length - 22;
  expect(uint32(bytes, eocd)).toBe(EOCD_SIGNATURE);
  return uint32(bytes, eocd + 16);
}

function replaceEntryPath(bytes: Uint8Array, from: string, to: string): Uint8Array {
  if (encoder.encode(from).length !== encoder.encode(to).length) throw new Error("same byte length required");
  const output = bytes.slice();
  const fromBytes = encoder.encode(from);
  const toBytes = encoder.encode(to);
  const central = centralOffset(output);
  let cursor = 0;
  while (cursor < central) {
    expect(uint32(output, cursor)).toBe(LOCAL_SIGNATURE);
    const compressed = uint32(output, cursor + 18);
    const nameLength = uint16(output, cursor + 26);
    const extraLength = uint16(output, cursor + 28);
    const nameOffset = cursor + 30;
    if (decoder.decode(output.subarray(nameOffset, nameOffset + nameLength)) === from) {
      output.set(toBytes, nameOffset);
    }
    cursor = nameOffset + nameLength + extraLength + compressed;
  }
  cursor = central;
  const eocd = output.length - 22;
  while (cursor < eocd) {
    expect(uint32(output, cursor)).toBe(CENTRAL_SIGNATURE);
    const nameLength = uint16(output, cursor + 28);
    const extraLength = uint16(output, cursor + 30);
    const commentLength = uint16(output, cursor + 32);
    const nameOffset = cursor + 46;
    const name = output.subarray(nameOffset, nameOffset + nameLength);
    if (name.length === fromBytes.length && decoder.decode(name) === from) output.set(toBytes, nameOffset);
    cursor = nameOffset + nameLength + extraLength + commentLength;
  }
  return output;
}

function corruptEntryData(bytes: Uint8Array, path: string): Uint8Array {
  const output = bytes.slice();
  const central = centralOffset(output);
  let cursor = 0;
  while (cursor < central) {
    const compressed = uint32(output, cursor + 18);
    const nameLength = uint16(output, cursor + 26);
    const extraLength = uint16(output, cursor + 28);
    const nameOffset = cursor + 30;
    const name = decoder.decode(output.subarray(nameOffset, nameOffset + nameLength));
    const dataOffset = nameOffset + nameLength + extraLength;
    if (name === path) {
      output[dataOffset] = (output[dataOffset] ?? 0) ^ 0xff;
      return output;
    }
    cursor = dataOffset + compressed;
  }
  throw new Error(`entry not found: ${path}`);
}

function makeZipBombDeclaration(bytes: Uint8Array): Uint8Array {
  const output = bytes.slice();
  const central = centralOffset(output);
  setUint16(output, central + 10, 8);
  setUint32(output, central + 20, 1);
  setUint32(output, central + 24, 0x1000_0000);
  return output;
}

async function expectArchiveError(
  action: Promise<unknown>,
  code: StudioProjectArchiveError["code"]
): Promise<StudioProjectArchiveError> {
  try {
    await action;
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioProjectArchiveError);
    expect(cause).toMatchObject({ code });
    return cause as StudioProjectArchiveError;
  }
  throw new Error(`expected ${code}`);
}

interface ManualArchiveOptions {
  bytes: Uint8Array;
  declaredHash?: string;
  includeAttachment?: boolean;
  includeUnexpected?: boolean;
  declaredByteSize?: number;
}

async function manualRasterArchive(options: ManualArchiveOptions): Promise<Blob> {
  const actualHash = await sha256(options.bytes);
  const declaredHash = options.declaredHash ?? actualHash;
  const path = `assets/sha256/${declaredHash}.png`;
  const project = projectWith([], {});
  project.pagesList[0]!.bg = `${STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX}${declaredHash}`;
  const projectJson = canonicalJson(project);
  const projectBytes = encoder.encode(projectJson);
  const byteSize = options.declaredByteSize ?? options.bytes.length;
  const manifest: StudioProjectArchiveManifest = {
    schema: "toonspectrum.studio-project-archive",
    version: 1,
    project: {
      path: "project.json",
      mimeType: "application/json",
      byteSize: projectBytes.length,
      sha256: await sha256(projectBytes),
    },
    attachments: [{
      path,
      mimeType: "image/png",
      byteSize,
      sha256: declaredHash,
      kinds: ["raster"],
      documentReferences: [{ pointer: "/pagesList/0/bg", usage: "raster" }],
    }],
    totals: {
      entryCount: 3,
      attachmentCount: 1,
      attachmentBytes: byteSize,
      contentBytes: projectBytes.length + byteSize,
    },
  };
  const entries: Array<{ path: string; data: Uint8Array }> = [
    { path: "manifest.json", data: encoder.encode(canonicalJson(manifest)) },
    { path: "project.json", data: projectBytes },
  ];
  if (options.includeAttachment !== false) entries.push({ path, data: options.bytes });
  if (options.includeUnexpected) entries.push({ path: "unexpected.bin", data: Uint8Array.of(1) });
  return buildStudioPackageArchiveBlob(entries);
}

async function manualProjectOnlyArchive(project: unknown): Promise<Blob> {
  const projectJson = canonicalJson(project);
  const projectBytes = encoder.encode(projectJson);
  const manifest: StudioProjectArchiveManifest = {
    schema: "toonspectrum.studio-project-archive",
    version: 2,
    project: {
      path: "project.json",
      mimeType: "application/json",
      byteSize: projectBytes.byteLength,
      sha256: await sha256(projectBytes),
    },
    attachments: [],
    totals: {
      entryCount: 2,
      attachmentCount: 0,
      attachmentBytes: 0,
      contentBytes: projectBytes.byteLength,
    },
  };
  return buildStudioPackageArchiveBlob([
    { path: "manifest.json", data: encoder.encode(canonicalJson(manifest)) },
    { path: "project.json", data: projectBytes },
  ]);
}

function retainedProvenance() {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "private-op",
      kind: "image",
      task: "background-image",
      provider: "provider",
      model: "model",
      transport: "byok",
      promptVersion: 1,
      prompt: "비공개 원문 프롬프트",
      status: "succeeded",
      createdAt: "2026-07-10T00:00:00.000Z",
      references: [],
    },
    { retainRawPrompt: true }
  );
}

describe("studio-project-archive", () => {
  it("Shared Stage v1을 v2로 승격하고 attachment로 오인하지 않으며 deterministic 왕복한다", async () => {
    const shared3dStage = {
      kind: "toonspectrum.studio-shared-3d-stage" as const,
      version: 1 as const,
      authority: "page-background-with-linked-character-sources" as const,
      capturePolicy: "require-all-linked" as const,
      background: {
        bundleId: "bundle-archive-1",
        sourceHash: `sha256:${"a".repeat(64)}` as const,
      },
      characters: [{
        elementId: "character-archive-1",
        modelRuntimeKey: `character-archive-1:sha256:${"b".repeat(64)}`,
        sourceHash: `sha256:${"c".repeat(64)}` as const,
        hiddenByStage: true as const,
      }],
      dccSource: {
        sourceDocumentId: "dcc-document-archive-1",
        sourceStateHash: "state:archive-1",
        sourceWorkspaceHash: `sha256:${"d".repeat(64)}` as const,
        sourceBridgeSetHash: "bridge:archive-1",
        sourceCommandCount: 14,
        sourceBridgeCommandSequence: 9,
      },
    };
    const migrated = migrateStudioShared3dStageCollectionDocument(shared3dStage)!;
    const project = projectWith([], {
      pagesList: [{ ...minimalPage(), shared3dStage }],
    });

    const first = await buildStudioProjectArchive({ project });
    const second = await buildStudioProjectArchive({ project });
    expect(new Uint8Array(await first.blob.arrayBuffer()))
      .toEqual(new Uint8Array(await second.blob.arrayBuffer()));
    expect(first.manifest.attachments).toHaveLength(0);

    const imported = await importStudioProjectArchive(first.blob);
    expect(imported.canonicalProject.pagesList[0]?.shared3dStage).toEqual(migrated);
    expect(imported.project.pagesList[0]?.shared3dStage).toEqual(migrated);
    expect(imported.attachments).toHaveLength(0);
  });

  it("native v3 형제 장면·receipt·DCC 출처를 attachment 없이 정확히 왕복한다", async () => {
    const shared3dStage = createNativePluralShared3dStageFixture();
    const project = projectWith([], {
      pagesList: [{ ...minimalPage(), shared3dStage }],
    });

    const archive = await buildStudioProjectArchive({ project });
    expect(archive.manifest.attachments).toHaveLength(0);
    const imported = await importStudioProjectArchive(archive.blob);
    expect(imported.canonicalProject.pagesList[0]?.shared3dStage).toEqual(shared3dStage);
    expect(imported.project.pagesList[0]?.shared3dStage).toEqual(shared3dStage);
    expect(imported.attachments).toHaveLength(0);
  });

  it("historical plural v2 Shared Stage archive를 canonical v3로 승격한다", async () => {
    const current = createNativePluralShared3dStageFixture();
    const historical = { ...current, version: 2 as const };
    const migrated = migrateStudioShared3dStageCollectionDocument(historical)!;
    const project = projectWith([], {
      pagesList: [{ ...minimalPage(), shared3dStage: historical }],
    });

    const archive = await buildStudioProjectArchive({ project });
    const imported = await importStudioProjectArchive(archive.blob);

    expect(imported.canonicalProject.pagesList[0]?.shared3dStage).toEqual(migrated);
    expect(imported.project.pagesList[0]?.shared3dStage).toEqual(migrated);
    expect(imported.attachments).toHaveLength(0);
  });

  it("canonical project.json에서 래스터·마스크·참고 data URL을 한 해시로 중복 제거하고 안전하게 왕복한다", async () => {
    const image = pngBytes(7);
    const embedded = dataUrl("image/png", image);
    const result = await buildStudioProjectArchive({
      project: projectWith(
        [{
          id: "image-1",
          type: "image",
          src: embedded,
          maskSrc: embedded,
          referenceThumbnail: embedded,
          assetUrl: "https://assets.example.test/private?id=1",
        }],
        {
          deepseekApiKey: "must-not-survive",
          integration: {
            secret: "integration-secret-value",
            sessionToken: "session-token-value",
            providerKey: "provider-key-value",
          },
          aiProvenance: retainedProvenance(),
        }
      ),
    });

    expect(result.blob.type).toBe(STUDIO_PROJECT_ARCHIVE_MIME);
    expect(result.manifest.attachments).toHaveLength(1);
    expect(result.manifest.attachments[0]).toMatchObject({
      mimeType: "image/png",
      byteSize: image.length,
      kinds: ["raster", "mask", "reference"],
    });
    expect(result.manifest.attachments[0]!.path).toMatch(/^assets\/sha256\/[a-f0-9]{64}\.png$/u);
    expect(result.manifest.attachments[0]!.documentReferences.map(({ pointer }) => pointer)).toEqual([
      "/pagesList/0/elements/0/maskSrc",
      "/pagesList/0/elements/0/referenceThumbnail",
      "/pagesList/0/elements/0/src",
    ]);
    expect(result.canonicalProjectJson).not.toContain("data:image");
    expect(result.canonicalProjectJson).not.toContain("must-not-survive");
    expect(result.canonicalProjectJson).not.toContain("integration-secret-value");
    expect(result.canonicalProjectJson).not.toContain("session-token-value");
    expect(result.canonicalProjectJson).not.toContain("provider-key-value");
    expect(result.canonicalProjectJson).not.toContain("비공개 원문 프롬프트");
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "PRIVACY_FIELD_REMOVED",
      "EXTERNAL_PROJECT_DEPENDENCY",
    ]));
    expect(result.isSelfContained).toBe(false);

    const imported = await importStudioProjectArchive(result.blob);
    const element = imported.project.pagesList[0]!.elements[0] as Record<string, unknown>;
    expect(element.src).toBe(embedded);
    expect(element.maskSrc).toBe(embedded);
    expect(element.referenceThumbnail).toBe(embedded);
    expect(imported.attachments).toHaveLength(1);
    expect(imported.canonicalProject.pagesList[0]!.elements[0]).toMatchObject({
      src: expect.stringMatching(/^toonspectrum-asset:\/\/sha256\/[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(imported.project)).not.toContain("비공개 원문 프롬프트");
    expect(imported.diagnostics.map(({ code }) => code)).toContain("EXTERNAL_PROJECT_DEPENDENCY");
    expect(imported.isSelfContained).toBe(false);

    const referenceOnly = await importStudioProjectArchive(result.blob, { rehydrateDataUrls: false });
    const referencedElement = referenceOnly.project.pagesList[0]!.elements[0] as Record<string, unknown>;
    expect(referencedElement.src).toMatch(/^toonspectrum-asset:\/\/sha256\/[a-f0-9]{64}$/u);
    expect(resolveStudioProjectArchiveAttachment(referenceOnly.attachments, referencedElement.src)?.blob.type)
      .toBe("image/png");
  });

  it("VRM/GLB 동일 바이트와 glTF/OBJ/audio를 content-addressed로 보존하고 입력 순서와 무관한 ZIP을 만든다", async () => {
    const sharedGlb = glbBytes(9, true);
    const gltf = encoder.encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin" }] }));
    const obj = encoder.encode("mtllib material.mtl\no Cube\nv 0 0 0\nf 1 1 1\n");
    const audio = wavBytes();
    const project = projectWith([{
      id: "binary-links",
      type: "custom",
      vrm: "pending",
      glb: "pending",
      gltf: "pending",
      obj: "pending",
      audio: "pending",
    }]);
    const attachments: StudioProjectArchiveAttachmentInput[] = [
      {
        kind: "vrm",
        data: new Blob([sharedGlb.buffer as ArrayBuffer], { type: "model/gltf-binary" }),
        mimeType: "model/gltf-binary",
        documentReferences: [{ pointer: "/pagesList/0/elements/0/vrm", usage: "vrm" }],
      },
      {
        kind: "glb",
        data: sharedGlb,
        mimeType: "model/gltf-binary",
        documentReferences: [{ pointer: "/pagesList/0/elements/0/glb", usage: "glb" }],
      },
      {
        kind: "gltf",
        data: gltf,
        mimeType: "application/json",
        documentReferences: [{ pointer: "/pagesList/0/elements/0/gltf", usage: "gltf" }],
      },
      {
        kind: "obj",
        data: obj,
        mimeType: "text/plain",
        documentReferences: [{ pointer: "/pagesList/0/elements/0/obj", usage: "obj" }],
      },
      {
        kind: "audio",
        data: audio,
        mimeType: "audio/wav",
        documentReferences: [{ pointer: "/pagesList/0/elements/0/audio", usage: "audio" }],
      },
    ];

    const first = await buildStudioProjectArchive({ project, attachments });
    const second = await buildStudioProjectArchive({ project, attachments: [...attachments].reverse() });
    expect(new Uint8Array(await first.blob.arrayBuffer())).toEqual(new Uint8Array(await second.blob.arrayBuffer()));
    expect(first.manifest.attachments).toHaveLength(4);
    const model = first.manifest.attachments.find(({ kinds }) => kinds.includes("vrm"));
    expect(model).toMatchObject({ mimeType: "model/vrm", kinds: ["vrm", "glb"] });
    expect(model?.path.endsWith(".vrm")).toBe(true);
    expect(first.diagnostics.filter(({ code }) => code === "EXTERNAL_ATTACHMENT_DEPENDENCY")).toHaveLength(3);
    expect(first.isSelfContained).toBe(false);

    const imported = await importStudioProjectArchive(first.blob);
    expect(imported.attachments).toHaveLength(4);
    const links = imported.project.pagesList[0]!.elements[0] as Record<string, unknown>;
    for (const key of ["vrm", "glb", "gltf", "obj", "audio"]) {
      expect(links[key]).toMatch(/^toonspectrum-asset:\/\/sha256\/[a-f0-9]{64}$/u);
    }
    expect(imported.diagnostics.filter(({ code }) => code === "EXTERNAL_ATTACHMENT_DEPENDENCY")).toHaveLength(3);
  });

  it("generic glTF 내부의 연결되지 않은 asset URI를 self-contained로 오인하지 않는다", async () => {
    const nestedAssetUri = `${STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX}${"a".repeat(64)}`;
    const glb = glbDocumentBytes({
      asset: { version: "2.0" },
      images: [{ uri: nestedAssetUri }],
    });
    const project = projectWith([{
      id: "generic-glb",
      type: "custom",
      glb: "pending",
    }]);
    const built = await buildStudioProjectArchive({
      project,
      attachments: [{
        kind: "glb",
        data: glb,
        mimeType: STUDIO_BG3D_GLB_MIME,
        documentReferences: [{ pointer: "/pagesList/0/elements/0/glb", usage: "glb" }],
      }],
    });

    expect(built.isSelfContained).toBe(false);
    expect(built.diagnostics.map(({ code }) => code)).toContain("EXTERNAL_ATTACHMENT_DEPENDENCY");
    const imported = await importStudioProjectArchive(built.blob);
    expect(imported.isSelfContained).toBe(false);
    expect(imported.diagnostics.map(({ code }) => code)).toContain(
      "EXTERNAL_ATTACHMENT_DEPENDENCY"
    );
  });

  it("canonical 3D 장면의 sha256 필드를 바꾸지 않고 GLB archive 바이트와 무결성 연결한다", async () => {
    installBg3dValidationWorker();
    const glb = glbBytes(17);
    const glbHash = await sha256(glb);
    const scene = {
      ...createDefaultStudioBg3dSceneDocument(),
      attachments: [{
        id: "scene-model-1",
        name: "검증된 배경.glb",
        mime: STUDIO_BG3D_GLB_MIME,
        byteSize: glb.byteLength,
        hash: `sha256:${glbHash}`,
        rights: {
          status: "owned" as const,
          commercialUse: true,
          attributionRequired: false,
        },
        source: "upload" as const,
      }],
    };
    const pointer = "/pagesList/0/elements/0/bg3dScene/attachments/0/hash";
    const project = projectWith([{
      id: "bg3d-render-1",
      type: "image",
      src: "render-pending",
      bg3dScene: scene,
    }]);
    const attachment: StudioProjectArchiveAttachmentInput = {
      kind: "glb",
      data: glb,
      mimeType: STUDIO_BG3D_GLB_MIME,
      documentReferences: [{ pointer, usage: "glb", mode: "sha256-prefixed" }],
    };

    const built = await buildStudioProjectArchive({ project, attachments: [attachment] });
    expect(STUDIO_PROJECT_ARCHIVE_VERSION).toBe(2);
    expect(built.manifest.version).toBe(2);
    expect(built.manifest.attachments).toHaveLength(1);
    expect(built.manifest.attachments[0]?.documentReferences).toEqual([{
      pointer,
      usage: "glb",
      mode: "sha256-prefixed",
    }]);
    expect(built.canonicalProjectJson).toContain(`"hash":"sha256:${glbHash}"`);
    expect(built.canonicalProjectJson).not.toContain(`${STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX}${glbHash}`);
    expect(built.isSelfContained).toBe(true);

    const imported = await importStudioProjectArchive(built.blob);
    const importedElement = imported.project.pagesList[0]?.elements[0] as {
      bg3dScene: { attachments: Array<{ hash: string }> };
    };
    expect(importedElement.bg3dScene.attachments[0]?.hash).toBe(`sha256:${glbHash}`);
    expect(imported.attachments.get(glbHash)?.blob.type).toBe(STUDIO_BG3D_GLB_MIME);
    expect(new Uint8Array(await imported.attachments.get(glbHash)!.blob.arrayBuffer())).toEqual(glb);

    await expectArchiveError(
      buildStudioProjectArchive({ project }),
      "ATTACHMENT_MISSING"
    );

    const detachedManifest = structuredClone(built.manifest);
    detachedManifest.attachments[0]!.documentReferences = [];
    const detachedArchive = await buildStudioPackageArchiveBlob([
      { path: "manifest.json", data: encoder.encode(canonicalJson(detachedManifest)) },
      { path: "project.json", data: encoder.encode(built.canonicalProjectJson) },
      { path: detachedManifest.attachments[0]!.path, data: glb },
    ]);
    await expectArchiveError(
      importStudioProjectArchive(detachedArchive),
      "ATTACHMENT_MISSING"
    );

    const mismatchedProject = structuredClone(project);
    const mismatchedScene = (mismatchedProject.pagesList[0]!.elements[0] as {
      bg3dScene: { attachments: Array<{ hash: string }> };
    }).bg3dScene;
    mismatchedScene.attachments[0]!.hash = `sha256:${"f".repeat(64)}`;
    await expectArchiveError(
      buildStudioProjectArchive({ project: mismatchedProject, attachments: [attachment] }),
      "DOCUMENT_REFERENCE_MISMATCH"
    );
  });

  it("번들 BG3D attachment provenance를 archive와 복원 경계에서 그대로 보존한다", async () => {
    installBg3dValidationWorker();
    const glb = glbBytes(23);
    const glbHash = await sha256(glb);
    const pointer = "/pagesList/0/elements/0/bg3dScene/attachments/0/hash";
    const scene = {
      ...createDefaultStudioBg3dSceneDocument(),
      attachments: [{
        id: "bundled-environment-attachment",
        name: "hospital_emergency_nurse_station.glb",
        mime: STUDIO_BG3D_GLB_MIME,
        byteSize: glb.byteLength,
        hash: `sha256:${glbHash}`,
        rights: {
          status: "public-domain" as const,
          commercialUse: true,
          attributionRequired: false,
          licenseName: "CC0-1.0",
        },
        source: "bundled" as const,
      }],
    };
    const project = projectWith([{
      id: "bundled-bg3d-render",
      type: "image",
      src: "render-pending",
      bg3dScene: scene,
    }]);
    const built = await buildStudioProjectArchive({
      project,
      attachments: [{
        kind: "glb",
        data: glb,
        mimeType: STUDIO_BG3D_GLB_MIME,
        documentReferences: [{ pointer, usage: "glb", mode: "sha256-prefixed" }],
      }],
    });

    expect(collectStudioBg3dProjectArchivePlan(project).attachments[0]?.attachment.source)
      .toBe("bundled");
    const imported = await importStudioProjectArchive(built.blob);
    const restoredScene = (imported.project.pagesList[0]?.elements[0] as {
      bg3dScene: { attachments: Array<{ source: string; hash: string }> };
    }).bg3dScene;
    expect(restoredScene.attachments[0]).toMatchObject({
      source: "bundled",
      hash: `sha256:${glbHash}`,
    });
    expect(collectStudioBg3dProjectArchivePlan(imported.project)
      .attachments[0]?.attachment.source).toBe("bundled");
  });

  it("VRM 표면 페인팅 PNG를 exact hash pointer로 연결하고 누락·크기 위조를 거부한다", async () => {
    const png = surfacePaintPngBytes(2, 1, 17);
    const rawHash = await sha256(png);
    const scene = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      surfacePaint: {
        version: 1,
        textures: [{
          bindingKey: "hero-face-base-color",
          materialLocator: "gltf-material:0",
          textureSlot: "baseColor",
          hash: `sha256:${rawHash}`,
          mime: "image/png",
          byteSize: png.byteLength,
          width: 2,
          height: 1,
        }],
      },
    });
    const project = projectWith([{
      id: "painted-vrm",
      type: "image",
      src: "",
      vrmScene: scene,
    }]);
    const pointer = "/pagesList/0/elements/0/vrmScene/surfacePaint/textures/0/hash";
    const attachment: StudioProjectArchiveAttachmentInput = {
      kind: "raster",
      data: png,
      mimeType: "image/png",
      documentReferences: [{
        pointer,
        usage: "raster",
        mode: "sha256-prefixed",
      }],
    };

    await expectArchiveError(
      buildStudioProjectArchive({ project }),
      "ATTACHMENT_MISSING",
    );

    const built = await buildStudioProjectArchive({
      project,
      attachments: [attachment],
    });
    expect(built.manifest.attachments).toHaveLength(1);
    expect(built.manifest.attachments[0]).toMatchObject({
      sha256: rawHash,
      mimeType: "image/png",
      kinds: ["raster"],
      documentReferences: [{
        pointer,
        usage: "raster",
        mode: "sha256-prefixed",
      }],
    });
    const imported = await importStudioProjectArchive(built.blob);
    const importedScene = (imported.project.pagesList[0]?.elements[0] as {
      vrmScene: ReturnType<typeof createStudioVrmSceneDocument>;
    }).vrmScene;
    expect(importedScene.surfacePaint).toEqual(scene.surfacePaint);

    const wrongDimensions = normalizeStudioVrmSceneDocument({
      ...scene,
      surfacePaint: {
        version: 1,
        textures: [{ ...scene.surfacePaint.textures[0], width: 1 }],
      },
    });
    await expectArchiveError(
      buildStudioProjectArchive({
        project: projectWith([{
          id: "painted-vrm-wrong-size",
          type: "image",
          src: "",
          vrmScene: wrongDimensions,
        }]),
        attachments: [attachment],
      }),
      "DOCUMENT_REFERENCE_MISMATCH",
    );

    const crcTampered = png.slice();
    crcTampered[crcTampered.length - 1] ^= 0xff;
    const crcTamperedHash = await sha256(crcTampered);
    const crcTamperedScene = normalizeStudioVrmSceneDocument({
      ...scene,
      surfacePaint: {
        version: 1,
        textures: [{
          ...scene.surfacePaint.textures[0],
          hash: `sha256:${crcTamperedHash}`,
        }],
      },
    });
    await expectArchiveError(
      buildStudioProjectArchive({
        project: projectWith([{
          id: "painted-vrm-crc-tampered",
          type: "image",
          src: "",
          vrmScene: crcTamperedScene,
        }]),
        attachments: [{
          kind: "raster",
          data: crcTampered,
          mimeType: "image/png",
          documentReferences: [{
            pointer,
            usage: "raster",
            mode: "sha256-prefixed",
          }],
        }],
      }),
      "MIME_SIGNATURE_MISMATCH",
    );
  });

  it("required Meshopt GLB를 canonical 정책으로 archive build/import 왕복한다", async () => {
    installBg3dValidationWorker();
    const pointer = "/pagesList/0/elements/0/bg3dScene/attachments/0/hash";
    const archiveInputFor = async (glb: Uint8Array, id: string) => {
      const digest = await sha256(glb);
      const scene = {
        ...createDefaultStudioBg3dSceneDocument(),
        attachments: [{
          id,
          name: `${id}.glb`,
          mime: STUDIO_BG3D_GLB_MIME,
          byteSize: glb.byteLength,
          hash: `sha256:${digest}`,
          rights: {
            status: "owned" as const,
            commercialUse: true,
            attributionRequired: false,
          },
          source: "upload" as const,
        }],
      };
      return {
        digest,
        input: {
          project: projectWith([{
            id: `${id}-render`,
            type: "image",
            src: "render-pending",
            bg3dScene: scene,
          }]),
          attachments: [{
            kind: "glb" as const,
            data: glb,
            mimeType: STUDIO_BG3D_GLB_MIME,
            documentReferences: [{ pointer, usage: "glb" as const, mode: "sha256-prefixed" as const }],
          }],
        },
      };
    };

    const compressed = createStudioBg3dMeshoptCompressedTriangleGlbFixture();
    const { digest, input } = await archiveInputFor(compressed, "meshopt-triangle");
    const built = await buildStudioProjectArchive(input);
    const imported = await importStudioProjectArchive(built.blob);
    const importedScene = (imported.project.pagesList[0]?.elements[0] as {
      bg3dScene: { attachments: Array<{ hash: string }> };
    }).bg3dScene;

    expect(importedScene.attachments[0]?.hash).toBe(`sha256:${digest}`);
    expect(imported.attachments.get(digest)?.blob.type).toBe(STUDIO_BG3D_GLB_MIME);
    expect(new Uint8Array(await imported.attachments.get(digest)!.blob.arrayBuffer())).toEqual(compressed);

    const unsupported = glbDocumentBytes({
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_draco_mesh_compression"],
      extensionsRequired: ["KHR_draco_mesh_compression"],
    });
    const unsupportedInput = await archiveInputFor(unsupported, "unsupported-draco");
    await expectArchiveError(
      buildStudioProjectArchive(unsupportedInput.input),
      "MIME_SIGNATURE_MISMATCH",
    );
  });

  it("3D 장면의 GLB 해시를 다른 종류·MIME·크기의 attachment로 대체하지 못한다", async () => {
    const pointer = "/pagesList/0/elements/0/bg3dScene/attachments/0/hash";
    const sceneFor = (digest: string, byteSize: number) => ({
      ...createDefaultStudioBg3dSceneDocument(),
      attachments: [{
        id: "scene-model-guard",
        name: "무결성 모델.glb",
        mime: STUDIO_BG3D_GLB_MIME,
        byteSize,
        hash: `sha256:${digest}`,
        rights: { status: "owned" as const, commercialUse: true, attributionRequired: false },
        source: "upload" as const,
      }],
    });
    const projectFor = (scene: ReturnType<typeof sceneFor>) => projectWith([{
      id: "bg3d-integrity-guard",
      type: "image",
      src: "render-pending",
      bg3dScene: scene,
    }]);

    const glb = glbBytes(31);
    const glbHash = await sha256(glb);
    await expectArchiveError(
      buildStudioProjectArchive({
        project: projectFor(sceneFor(glbHash, glb.byteLength + 1)),
        attachments: [{
          kind: "glb",
          data: glb,
          mimeType: STUDIO_BG3D_GLB_MIME,
          documentReferences: [{ pointer, usage: "glb", mode: "sha256-prefixed" }],
        }],
      }),
      "DOCUMENT_REFERENCE_MISMATCH"
    );

    const png = pngBytes(32);
    const pngHash = await sha256(png);
    await expectArchiveError(
      buildStudioProjectArchive({
        project: projectFor(sceneFor(pngHash, png.byteLength)),
        attachments: [{
          kind: "raster",
          data: png,
          mimeType: "image/png",
          documentReferences: [{ pointer, usage: "raster", mode: "sha256-prefixed" }],
        }],
      }),
      "MIME_MISMATCH"
    );

    await expectArchiveError(
      buildStudioProjectArchive({
        project: projectFor(sceneFor(glbHash, glb.byteLength)),
        attachments: [{
          kind: "vrm",
          data: glb,
          mimeType: "model/vrm",
          documentReferences: [{ pointer, usage: "vrm", mode: "sha256-prefixed" }],
        }],
      }),
      "MIME_MISMATCH"
    );

    for (const unsafeGlb of [glbBytes(33, true), glbWithDuplicateJsonChunks()]) {
      const unsafeHash = await sha256(unsafeGlb);
      await expectArchiveError(
        buildStudioProjectArchive({
          project: projectFor(sceneFor(unsafeHash, unsafeGlb.byteLength)),
          attachments: [{
            kind: "glb",
            data: unsafeGlb,
            mimeType: STUDIO_BG3D_GLB_MIME,
            documentReferences: [{ pointer, usage: "glb", mode: "sha256-prefixed" }],
          }],
        }),
        "MIME_SIGNATURE_MISMATCH"
      );
    }

    const overSceneBudget = glbDocumentBytes({
      asset: { version: "2.0" },
      nodes: [{}, {}],
    });
    const overSceneBudgetHash = await sha256(overSceneBudget);
    const constrainedScene = {
      ...sceneFor(overSceneBudgetHash, overSceneBudget.byteLength),
      budgets: {
        ...createDefaultStudioBg3dSceneDocument().budgets,
        complexity: {
          ...createDefaultStudioBg3dSceneDocument().budgets.complexity,
          maxNodes: 1,
        },
      },
    };
    await expectArchiveError(buildStudioProjectArchive({
      project: projectFor(constrainedScene),
      attachments: [{
        kind: "glb",
        data: overSceneBudget,
        mimeType: STUDIO_BG3D_GLB_MIME,
        documentReferences: [{ pointer, usage: "glb", mode: "sha256-prefixed" }],
      }],
    }), "MIME_SIGNATURE_MISMATCH");
  });

  it("페이지와 마스터의 동일 GLB를 해시로 중복 제거한 deterministic archive 계획을 만든다", async () => {
    const firstHash = "1".repeat(64);
    const secondHash = "2".repeat(64);
    const scene = (id: string, hash: string, byteSize = 128) => ({
      ...createDefaultStudioBg3dSceneDocument(),
      attachments: [{
        id,
        name: `${id}.glb`,
        mime: STUDIO_BG3D_GLB_MIME,
        byteSize,
        hash: `sha256:${hash}`,
        rights: {
          status: "owned" as const,
          commercialUse: true,
          attributionRequired: false,
        },
        source: "upload" as const,
      }],
    });
    const sharedScene = scene("master-model", secondHash);
    const constrainedSharedScene = {
      ...sharedScene,
      budgets: {
        ...sharedScene.budgets,
        complexity: {
          ...sharedScene.budgets.complexity,
          maxAccessorElements: 10_000,
          maxDecodedGeometryBytes: 1_000_000,
          maxAnimations: 3,
          maxAnimationChannels: 30,
          maxAnimationKeyframes: 300,
          maxAnimationValues: 1_200,
          maxSkins: 2,
          maxJoints: 64,
          maxMorphTargets: 8,
        },
      },
    };
    const project = {
      ...projectWith(),
      pagesList: [
        minimalPage([{ id: "page-a", type: "image", src: "render-a", bg3dScene: scene("page-model-a", secondHash) }]),
        { ...minimalPage([{ id: "page-b", type: "image", src: "render-b", bg3dScene: scene("page-model-b", firstHash) }]), id: "page-2" },
      ],
      master: {
        elements: [{
          id: "master-a",
          type: "image",
          src: "render-master",
          bg3dScene: constrainedSharedScene,
        }],
      },
    };

    const plan = collectStudioBg3dProjectArchivePlan(project);

    expect(plan.attachments.map(({ sha256 }) => sha256)).toEqual([firstHash, secondHash]);
    expect(plan.attachments[1]?.documentReferences.map(({ pointer }) => pointer)).toEqual([
      "/master/elements/0/bg3dScene/attachments/0/hash",
      "/pagesList/0/elements/0/bg3dScene/attachments/0/hash",
    ]);
    expect(plan.attachments.every(({ documentReferences }) =>
      documentReferences.every((reference) => reference.mode === "sha256-prefixed")
    )).toBe(true);
    expect(plan.attachments[1]?.validationBudgets.mobile.complexity).toMatchObject({
      maxAccessorElements: 10_000,
      maxDecodedGeometryBytes: 1_000_000,
      maxAnimations: 3,
      maxAnimationChannels: 30,
      maxAnimationKeyframes: 300,
      maxAnimationValues: 1_200,
      maxSkins: 2,
      maxJoints: 64,
      maxMorphTargets: 8,
    });
    expect(plan.attachments[1]?.validationBudgets.desktop.complexity).toMatchObject({
      maxAccessorElements: 10_000,
      maxDecodedGeometryBytes: 1_000_000,
      maxAnimations: 3,
      maxAnimationChannels: 30,
      maxAnimationKeyframes: 300,
      maxAnimationValues: 1_200,
      maxSkins: 2,
      maxJoints: 64,
      maxMorphTargets: 8,
    });
    expect(plan.totalAttachmentBytes).toBe(256);
    expect(plan.referenceCount).toBe(3);
    expect(JSON.stringify(plan)).not.toContain("storageKey");

    const conflicting = structuredClone(project);
    const conflictingAttachment = ((conflicting.master as { elements: Array<{
      bg3dScene: { attachments: Array<{ byteSize: number }> };
    }> }).elements[0]!.bg3dScene.attachments[0]!);
    conflictingAttachment.byteSize = 129;
    expect(() => collectStudioBg3dProjectArchivePlan(conflicting)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_REFERENCE_CONFLICT" })
    );

    const rightsConflict = structuredClone(project);
    const rights = ((rightsConflict.master as { elements: Array<{
      bg3dScene: { attachments: Array<{ rights: Record<string, unknown> }> };
    }> }).elements[0]!.bg3dScene.attachments[0]!.rights);
    rights.status = "unknown";
    rights.commercialUse = false;
    expect(() => collectStudioBg3dProjectArchivePlan(rightsConflict)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_REFERENCE_CONFLICT" })
    );
    expect(() => collectStudioBg3dProjectArchivePlan(project, {
      limits: { maxAttachmentBytes: 127 },
    })).toThrow(expect.objectContaining({ code: "ATTACHMENT_SIZE_LIMIT" }));
  });

  it("연결되지 않은 attachment와 외부 프로젝트 의존성을 내용 노출 없는 diagnostic으로 남긴다", async () => {
    const result = await buildStudioProjectArchive({
      project: projectWith([], { referenceAssetUrl: "/external/reference.png" }),
      attachments: [{ kind: "audio", data: wavBytes(), mimeType: "audio/wav" }],
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ATTACHMENT_ORPHANED", severity: "warning" }),
      expect.objectContaining({ code: "EXTERNAL_PROJECT_DEPENDENCY", severity: "warning" }),
    ]));
    expect(JSON.stringify(result.diagnostics)).not.toContain("reference.png");

    for (const externalUrl of [
      "file:///Users/private/reference.png",
      "ftp://assets.example.test/reference.png",
      "ipfs://example-content/reference.png",
    ]) {
      const external = await buildStudioProjectArchive({
        project: projectWith([], { referenceAssetUrl: externalUrl }),
      });
      expect(external.isSelfContained).toBe(false);
      expect(external.diagnostics.map(({ code }) => code)).toContain(
        "EXTERNAL_PROJECT_DEPENDENCY"
      );
      expect(JSON.stringify(external.diagnostics)).not.toContain(externalUrl);
    }
  });

  it("legacy studio-project-file 입력을 v2 canonical 경계로 변환해 왕복한다", async () => {
    const built = await buildStudioProjectArchive({
      project: { version: "1.0", title: "과거", pages: [minimalPage()] },
    });
    const imported = await importStudioProjectArchive(built.blob);
    expect(imported.project).toMatchObject({ version: 2, title: "과거", currentPageId: "page-1" });
    expect(imported.manifest.attachments).toEqual([]);
  });

  it("레거시 PNG 3D fragment를 분리 장면으로 무손실 변환하고 미해결 모델 키는 거부한다", async () => {
    const raster = pngBytes(40);
    const primitivePayload = {
      tool: "bg3d",
      primitives: [{
        id: "legacy-box",
        kind: "box",
        position: [1, 0.5, 2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#123456",
      }],
      customModels: [],
      skyPresetId: "sunset",
    };
    const legacySrc = `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify(primitivePayload))}`;
    const legacyProject = {
      version: "1.0",
      title: "레거시 3D",
      pages: [minimalPage([{ id: "legacy-bg", type: "image", src: legacySrc }])],
    };

    const built = await buildStudioProjectArchive({ project: legacyProject });
    const imported = await importStudioProjectArchive(built.blob);
    const image = imported.project.pagesList[0]?.elements[0] as {
      src: string;
      bg3dScene: { nodes: Array<{ id: string; kind: string }> };
    };
    expect(image.src).toBe(dataUrl("image/png", raster));
    expect(image.src).not.toContain("#");
    expect(image.bg3dScene.nodes).toEqual([
      expect.objectContaining({ id: "legacy-box", kind: "primitive" }),
    ]);

    const unresolved = {
      ...primitivePayload,
      primitives: [],
      customModels: [{
        id: "legacy-model",
        modelId: "local-indexeddb-key",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }],
    };
    await expectArchiveError(buildStudioProjectArchive({
      project: {
        ...legacyProject,
        pages: [minimalPage([{
          id: "legacy-model-bg",
          type: "image",
          src: `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify(unresolved))}`,
        }])],
      },
    }), "PROJECT_INVALID");

    const clampedPrimitive = {
      ...primitivePayload,
      primitives: [{
        ...primitivePayload.primitives[0],
        position: [999_999, 0, 0],
        scale: [0, 1, 1],
      }],
    };
    await expectArchiveError(buildStudioProjectArchive({
      project: {
        ...legacyProject,
        pages: [minimalPage([{
          id: "legacy-clamped-bg",
          type: "image",
          src: `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify(clampedPrimitive))}`,
        }])],
      },
    }), "PROJECT_INVALID");
  });

  it("레거시 VRM 포저 PNG fragment를 정식 장면으로 변환하고 로컬 모델 의존성은 거부한다", async () => {
    const raster = pngBytes(43);
    const legacyPose = {
      tool: "vrm-poser",
      modelId: "avatar-a",
      modelName: "하린",
      yOffset: 0.12,
      bodyRotationY: 0.35,
      bones: { head: { rotation: [0.1, -0.2, 0.05] } },
      expressionWeights: { happy: 0.7 },
      fingerOverrides: {},
    };
    const legacySrc = `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify(legacyPose))}`;
    const project = {
      version: "1.0",
      title: "레거시 데생 인형",
      pages: [minimalPage([{ id: "legacy-vrm", type: "image", src: legacySrc }])],
    };

    const built = await buildStudioProjectArchive({ project });
    const imported = await importStudioProjectArchive(built.blob);
    const image = imported.project.pagesList[0]?.elements[0] as {
      src: string;
      vrmScene: {
        model: { source: string; id: string };
        pose: { yOffset: number; bodyRotationY: number };
        expressions: Record<string, number>;
      };
    };
    expect(image.src).toBe(dataUrl("image/png", raster));
    expect(image.src).not.toContain("#");
    expect(image.vrmScene).toMatchObject({
      model: { source: "bundled", id: "avatar-a" },
      pose: { yOffset: 0.12, bodyRotationY: 0.35 },
      expressions: { happy: 0.7 },
    });

    const currentMetadata = buildVrmPoseDataUrlMetadata({
      modelId: "avatar-a",
      bones: { head: { rotation: [0.2, -0.1, 0.04] } },
      yOffset: 0.18,
      poseTranslations: {
        version: 1,
        root: [0.3, 0, -0.15],
        hips: [0.08, -0.04, 0.02],
        spine: [-0.03, 0.06, 0.01],
      },
      bodyRotation: 0.42,
    }, "하린");
    const currentSrc = `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify(currentMetadata))}`;
    const currentImported = await importStudioProjectArchive((await buildStudioProjectArchive({
      project: {
        ...project,
        pages: [minimalPage([{ id: "current-vrm", type: "image", src: currentSrc }])],
      },
    })).blob);
    const currentImage = currentImported.project.pagesList[0]?.elements[0] as {
      src: string;
      vrmScene: {
        version: number;
        pose: {
          yOffset: number;
          translations: typeof currentMetadata.poseTranslations;
          bodyRotationY: number;
        };
      };
    };
    expect(currentImage.src).toBe(dataUrl("image/png", raster));
    expect(currentImage.vrmScene).toMatchObject({
      version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
      pose: {
        yOffset: 0.18,
        translations: currentMetadata.poseTranslations,
        bodyRotationY: 0.42,
      },
    });

    await expectArchiveError(buildStudioProjectArchive({
      project: {
        ...project,
        pages: [minimalPage([{
          id: "legacy-local-vrm",
          type: "image",
          src: `${dataUrl("image/png", raster)}#${encodeURIComponent(JSON.stringify({
            ...legacyPose,
            modelId: "local-indexeddb-model",
          }))}`,
        }])],
      },
    }), "PROJECT_INVALID");
  });

  it("기존 v1 manifest를 읽고 신규 writer는 mode가 명시된 v2만 출력한다", async () => {
    const legacy = await importStudioProjectArchive(await manualRasterArchive({
      bytes: pngBytes(41),
    }));
    expect(legacy.manifest.version).toBe(1);
    expect(legacy.manifest.attachments[0]?.documentReferences).toEqual([{
      pointer: "/pagesList/0/bg",
      usage: "raster",
    }]);

    const source = pngBytes(42);
    const pointer = "/pagesList/0/elements/0/src";
    const project = projectWith([{ id: "image-v2", type: "image", src: "pending" }]);
    const implicit: StudioProjectArchiveAttachmentInput = {
      kind: "raster",
      data: source,
      mimeType: "image/png",
      documentReferences: [{ pointer, usage: "raster" }],
    };
    const explicit: StudioProjectArchiveAttachmentInput = {
      ...implicit,
      documentReferences: [{ pointer, usage: "raster", mode: "asset-uri" }],
    };
    const first = await buildStudioProjectArchive({ project, attachments: [implicit, explicit] });
    const second = await buildStudioProjectArchive({ project, attachments: [explicit, implicit] });

    expect(first.manifest.version).toBe(2);
    expect(first.manifest.attachments[0]?.documentReferences).toEqual([{
      pointer,
      usage: "raster",
      mode: "asset-uri",
    }]);
    expect(new Uint8Array(await first.blob.arrayBuffer())).toEqual(
      new Uint8Array(await second.blob.arrayBuffer())
    );
  });

  it("해시와 schema가 맞아도 canonical이 아닌 project.json은 거부한다", async () => {
    const project = projectWith();
    const nonCanonicalProject = JSON.stringify(project, null, 2);
    const projectBytes = encoder.encode(nonCanonicalProject);
    const manifest: StudioProjectArchiveManifest = {
      schema: "toonspectrum.studio-project-archive",
      version: 1,
      project: {
        path: "project.json",
        mimeType: "application/json",
        byteSize: projectBytes.length,
        sha256: await sha256(projectBytes),
      },
      attachments: [],
      totals: {
        entryCount: 2,
        attachmentCount: 0,
        attachmentBytes: 0,
        contentBytes: projectBytes.length,
      },
    };
    const archive = await buildStudioPackageArchiveBlob([
      { path: "manifest.json", data: encoder.encode(canonicalJson(manifest)) },
      { path: "project.json", data: projectBytes },
    ]);
    await expectArchiveError(importStudioProjectArchive(archive), "CANONICAL_JSON_REQUIRED");
  });

  it("canonical ZIP이어도 비공개 키나 writer 기본값이 빠진 v2 project.json은 거부한다", async () => {
    await expectArchiveError(importStudioProjectArchive(await manualProjectOnlyArchive({
      ...projectWith(),
      apiKey: "must-not-be-retained",
    })), "PROJECT_INVALID");

    await expectArchiveError(importStudioProjectArchive(await manualProjectOnlyArchive({
      version: 2,
      pagesList: [minimalPage()],
    })), "PROJECT_INVALID");
  });

  it("현재 manifest의 strict VRM v1/v2 장면만 현재 버전으로 승격하고 다른 writer 차이는 허용하지 않는다", async () => {
    const currentScene = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      pose: {
        bones: {
          leftUpperArm: { rotation: [0.2, -0.4, 0.6] },
          rightUpperArm: { rotation: [0.2, 0.4, -0.6] },
        },
        yOffset: 0.1,
        bodyRotationY: -0.25,
        fingerOverrides: { leftIndexProximal: [0.1, 0.2, -0.3] },
      },
      expressions: { happy: 0.65 },
    });
    const legacyScene = JSON.parse(JSON.stringify(currentScene)) as Record<string, unknown>;
    delete legacyScene.rig;
    delete legacyScene.surfacePaint;
    delete legacyScene.lightingTone;
    delete (legacyScene.pose as Record<string, unknown>).translations;
    delete (legacyScene.pose as Record<string, unknown>).ikConstraints;
    legacyScene.version = 1;
    const legacyImage = {
      id: "legacy-vrm",
      type: "image",
      src: "",
      vrmScene: legacyScene,
    };

    const imported = await importStudioProjectArchive(
      await manualProjectOnlyArchive(projectWith([legacyImage])),
    );
    const promoted = (imported.project.pagesList[0]?.elements[0] as {
      vrmScene: ReturnType<typeof createStudioVrmSceneDocument>;
    }).vrmScene;
    expect(promoted.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(promoted.pose).toEqual(currentScene.pose);
    expect(promoted.expressions).toEqual(currentScene.expressions);
    expect(promoted.lightingTone).toBe("morning");
    expect(promoted.rig).toMatchObject({
      jointProfile: { id: "neutral" },
      fullBodyIk: false,
      footPlant: false,
      floorHeight: 0,
    });

    const versionTwoScene = JSON.parse(JSON.stringify(currentScene)) as Record<string, unknown>;
    delete versionTwoScene.surfacePaint;
    delete versionTwoScene.lightingTone;
    delete (versionTwoScene.pose as Record<string, unknown>).translations;
    delete (versionTwoScene.pose as Record<string, unknown>).ikConstraints;
    versionTwoScene.version = 2;
    const importedV2 = await importStudioProjectArchive(
      await manualProjectOnlyArchive(projectWith([{
        ...legacyImage,
        id: "legacy-vrm-v2",
        vrmScene: versionTwoScene,
      }])),
    );
    const promotedV2 = (importedV2.project.pagesList[0]?.elements[0] as {
      vrmScene: ReturnType<typeof createStudioVrmSceneDocument>;
    }).vrmScene;
    expect(promotedV2.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(promotedV2.rig).toEqual(currentScene.rig);
    expect(promotedV2.lightingTone).toBe("morning");
    expect(promotedV2.pose.translations).toEqual(currentScene.pose.translations);

    await expectArchiveError(importStudioProjectArchive(await manualProjectOnlyArchive({
      ...projectWith([{ ...legacyImage, vrmScene: { ...legacyScene, unknown: true } }]),
    })), "PROJECT_INVALID");
    await expectArchiveError(importStudioProjectArchive(await manualProjectOnlyArchive({
      version: 2,
      pagesList: [minimalPage([legacyImage])],
    })), "PROJECT_INVALID");
  });

  it("명시한 문서 참조가 없거나 서로 다른 attachment가 같은 위치를 차지하면 거부한다", async () => {
    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith([], {
        missingAsset: `${STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX}${"b".repeat(64)}`,
      }),
    }), "ATTACHMENT_MISSING");

    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith(),
      attachments: [{
        kind: "audio",
        data: wavBytes(),
        documentReferences: [{ pointer: "/pagesList/0/missing", usage: "audio" }],
      }],
    }), "DOCUMENT_REFERENCE_MISSING");

    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith([{ id: "x", type: "custom", asset: "pending" }]),
      attachments: [{
        kind: "audio",
        data: wavBytes(),
        documentReferences: [{
          pointer: "/pagesList/0/elements/0/asset",
          usage: "audio",
          mode: "replace-with-url",
        } as never],
      }],
    }), "DOCUMENT_REFERENCE_MISSING");

    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith([{ id: "x", type: "custom", asset: "pending" }]),
      attachments: [{
        kind: "raster",
        data: pngBytes(3),
        documentReferences: [{
          pointer: "/pagesList/0/elements/0/asset",
          usage: "raster",
          mode: "asset-uri",
          unexpected: true,
        } as never],
      }],
    }), "DOCUMENT_REFERENCE_MISSING");

    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith([{ id: "x", type: "custom", asset: "pending" }]),
      attachments: [
        {
          kind: "raster",
          data: pngBytes(1),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/asset", usage: "raster" }],
        },
        {
          kind: "raster",
          data: pngBytes(2),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/asset", usage: "raster" }],
        },
      ],
    }), "DOCUMENT_REFERENCE_CONFLICT");
  });

  it("손상된 래스터 data URL을 inline 문자열로 우회 보존하지 않는다", async () => {
    await expectArchiveError(buildStudioProjectArchive({
      project: projectWith([{ id: "bad", type: "image", src: "data:image/png;base64,%%%" }]),
    }), "MIME_SIGNATURE_MISMATCH");
  });

  it("attachment와 archive 브라우저 메모리 상한을 낮춰 강제할 수 있다", async () => {
    await expectArchiveError(buildStudioProjectArchive(
      { project: projectWith(), attachments: [{ kind: "raster", data: pngBytes() }] },
      { limits: { maxAttachmentBytes: 4 } }
    ), "ATTACHMENT_SIZE_LIMIT");

    const built = await buildStudioProjectArchive({ project: projectWith() });
    await expectArchiveError(buildStudioProjectArchive(
      { project: projectWith() },
      { limits: { maxArchiveBytes: 64 } }
    ), "ARCHIVE_SIZE_LIMIT");
    await expectArchiveError(importStudioProjectArchive(built.blob, {
      limits: { maxArchiveBytes: built.blob.size - 1 },
    }), "ARCHIVE_SIZE_LIMIT");

    const deepProject = projectWith([], { boundedUnknownMetadata: nestedObject(24) });
    const deepBuilt = await buildStudioProjectArchive({ project: deepProject });
    await expectArchiveError(importStudioProjectArchive(deepBuilt.blob, {
      limits: { maxDepth: 12 },
    }), "PROJECT_SIZE_LIMIT");
    await expectArchiveError(importStudioProjectArchive(deepBuilt.blob, {
      limits: { maxJsonNodes: 12 },
    }), "PROJECT_SIZE_LIMIT");
    expect(() => collectStudioBg3dProjectArchivePlan(deepProject, {
      limits: { maxDepth: 12 },
    })).toThrow(expect.objectContaining({ code: "PROJECT_SIZE_LIMIT" }));
    expect(() => collectStudioBg3dProjectArchivePlan(projectWith(), {
      limits: { maxProjectBytes: 32 },
    })).toThrow(expect.objectContaining({ code: "PROJECT_SIZE_LIMIT" }));
    await expectArchiveError(buildStudioProjectArchive(
      { project: projectWith() },
      { limits: { maxProjectBytes: 32 } }
    ), "PROJECT_SIZE_LIMIT");

    const wideArchive = await manualProjectOnlyArchive({
      ...projectWith(),
      boundedWideMetadata: Array.from({ length: 10_000 }, () => 0),
    });
    await expectArchiveError(importStudioProjectArchive(wideArchive, {
      limits: { maxJsonNodes: 12 },
    }), "PROJECT_SIZE_LIMIT");
  });

  it("path traversal, 중복 경로, 숨은 압축 폭탄 선언을 중앙 디렉터리 사용 전에 차단한다", async () => {
    const base = await buildStudioProjectArchive({ project: projectWith() });
    const baseBytes = new Uint8Array(await base.blob.arrayBuffer());
    await expectArchiveError(
      importStudioProjectArchive(replaceEntryPath(baseBytes, "project.json", "../evil.json")),
      "PATH_INVALID"
    );
    await expectArchiveError(importStudioProjectArchive(makeZipBombDeclaration(baseBytes)), "ZIP_BOMB");

    const twoAssets = await buildStudioProjectArchive({
      project: projectWith([{ id: "x", type: "custom", first: "a", second: "b" }]),
      attachments: [
        {
          kind: "raster",
          data: pngBytes(1),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/first", usage: "raster" }],
        },
        {
          kind: "raster",
          data: gifBytes(2),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/second", usage: "raster" }],
        },
      ],
    });
    const [first, second] = twoAssets.manifest.attachments;
    expect(first?.path.length).toBe(second?.path.length);
    await expectArchiveError(
      importStudioProjectArchive(replaceEntryPath(
        new Uint8Array(await twoAssets.blob.arrayBuffer()),
        second!.path,
        first!.path
      )),
      "DUPLICATE_PATH"
    );
  });

  it("CRC 손상과 attachment SHA-256 불일치를 각각 구분한다", async () => {
    const built = await buildStudioProjectArchive({
      project: projectWith([], { cover: dataUrl("image/png", pngBytes(3)) }),
    });
    const attachmentPath = built.manifest.attachments[0]!.path;
    await expectArchiveError(
      importStudioProjectArchive(corruptEntryData(new Uint8Array(await built.blob.arrayBuffer()), attachmentPath)),
      "CRC_MISMATCH"
    );

    const wrongHash = "a".repeat(64);
    await expectArchiveError(importStudioProjectArchive(await manualRasterArchive({
      bytes: pngBytes(4),
      declaredHash: wrongHash,
    })), "HASH_MISMATCH");
  });

  it("유효한 해시를 가진 잘못된 MIME 파일 서명과 manifest 크기 위조를 거부한다", async () => {
    await expectArchiveError(importStudioProjectArchive(await manualRasterArchive({
      bytes: encoder.encode("not-a-png"),
    })), "MIME_SIGNATURE_MISMATCH");

    const bytes = pngBytes(5);
    await expectArchiveError(importStudioProjectArchive(await manualRasterArchive({
      bytes,
      declaredByteSize: bytes.length + 1,
    })), "ATTACHMENT_SIZE_LIMIT");
  });

  it("manifest가 선언한 누락 attachment와 선언하지 않은 추가 파일을 구분한다", async () => {
    await expectArchiveError(importStudioProjectArchive(await manualRasterArchive({
      bytes: pngBytes(6),
      includeAttachment: false,
    })), "ATTACHMENT_MISSING");

    await expectArchiveError(importStudioProjectArchive(await manualRasterArchive({
      bytes: pngBytes(7),
      includeUnexpected: true,
    })), "UNEXPECTED_ENTRY");
  });

  it("가져오기 attachment 수 한도로 과도한 ZIP 항목을 조기에 차단한다", async () => {
    const built = await buildStudioProjectArchive({
      project: projectWith([{ id: "x", type: "custom", first: "a", second: "b" }]),
      attachments: [
        {
          kind: "raster",
          data: pngBytes(1),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/first", usage: "raster" }],
        },
        {
          kind: "raster",
          data: pngBytes(2),
          documentReferences: [{ pointer: "/pagesList/0/elements/0/second", usage: "raster" }],
        },
      ],
    });
    await expectArchiveError(importStudioProjectArchive(built.blob, {
      limits: { maxAttachments: 1 },
    }), "ZIP_ENTRY_COUNT_LIMIT");
  });
});
