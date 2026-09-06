import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeSharedStudioBg3dGeometryWorkerClient,
} from "./studio-bg3d-geometry-worker-client";
import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  type StudioBg3dGlbValidationBudget,
} from "./studio-bg3d-glb-validation";
import {
  STUDIO_BG3D_IMPORT_MAX_ANIMATION_DURATION_SECONDS,
  STUDIO_BG3D_IMPORT_MAX_ANIMATION_KEYFRAMES,
  STUDIO_BG3D_IMPORT_MAX_ANIMATION_TRACKS,
  STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS,
  STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIAL_SLOTS,
  STUDIO_BG3D_IMPORT_MAX_FILE_BYTES,
  STUDIO_BG3D_IMPORT_MAX_FILES,
  STUDIO_BG3D_IMPORT_MAX_INLINE_RESOURCE_BYTES,
  STUDIO_BG3D_IMPORT_MAX_NODES,
  STUDIO_BG3D_IMPORT_MAX_OBJ_MATERIAL_LIBRARIES,
  STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_REFERENCE_DIRECTIVES,
  STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_TOTAL_BYTES,
  STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES,
  STUDIO_BG3D_IMPORT_MAX_OUTPUT_TOTAL_BYTES,
  STUDIO_BG3D_IMPORT_MAX_VERTICES,
  StudioBg3dModelImportError,
  assertStudioBg3dPreExportBudgets,
  convertStudioBg3dModelFilesToGlb as convertStudioBg3dModelFilesToGlbWithBackend,
  planStudioBg3dModelImports,
  type StudioBg3dImportFile,
  type StudioBg3dModelImportOptions,
} from "./studio-bg3d-model-import";
import { disposeSharedStudioBg3dObjWorkerClient } from "./studio-bg3d-obj-worker-client";

import type { Bg3dModelUploadSource } from "./bg3d-model-library";
import type { Mesh, MeshStandardMaterial } from "three";

function convertStudioBg3dModelFilesToGlb(
  input: readonly StudioBg3dImportFile[],
  options: StudioBg3dModelImportOptions = {},
): ReturnType<typeof convertStudioBg3dModelFilesToGlbWithBackend> {
  return convertStudioBg3dModelFilesToGlbWithBackend(input, {
    executionBackend: "direct",
    ...options,
  });
}

function sourceFile(
  name: string,
  contents: BlobPart | Uint8Array<ArrayBufferLike> = new Uint8Array([1]),
  relativePath = "",
  type = "",
): StudioBg3dImportFile {
  const blobPart: BlobPart = contents instanceof Uint8Array
    ? new Uint8Array(contents).buffer
    : contents;
  const blob = new Blob([blobPart], { type });
  Object.defineProperties(blob, {
    name: { configurable: false, enumerable: true, value: name },
    webkitRelativePath: { configurable: false, enumerable: true, value: relativePath },
  });
  return blob as StudioBg3dImportFile;
}

function bigEndianUint32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = new TextEncoder().encode(type);
  const checksumInput = new Uint8Array(typeBytes.byteLength + data.byteLength);
  checksumInput.set(typeBytes);
  checksumInput.set(data, typeBytes.byteLength);
  return concatBytes([
    bigEndianUint32(data.byteLength),
    typeBytes,
    data,
    bigEndianUint32(crc32(checksumInput)),
  ]);
}

/** A generated 2x1 RGBA PNG containing red and green pixels, with no third-party asset bytes. */
function generatedPngFixture(): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 2, false);
  headerView.setUint32(4, 1, false);
  header.set([8, 6, 0, 0, 0], 8);
  const scanline = new Uint8Array([
    0,
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);
  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(scanline))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/** A deterministic 1x1 JFIF fixture whose single pixel contains no copyrightable content. */
function minimalJpegFixture(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from([
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////",
    "////////////////////////////////////////2wBDAf//////////////////////////////////",
    "////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QA",
    "FQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QA",
    "FBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEB",
    "PwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/a",
    "AAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAU",
    "EQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/",
    "EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==",
  ].join(""), "base64"));
}

function virtualFile(
  name: string,
  size: number,
  arrayBuffer: () => Promise<ArrayBuffer> = async () => new ArrayBuffer(Math.min(size, 1)),
): StudioBg3dImportFile {
  return {
    name,
    size,
    type: "",
    arrayBuffer,
  } as StudioBg3dImportFile;
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function mismatchedExtendedWebp(): Uint8Array<ArrayBuffer> {
  const vp8x = new Uint8Array(18);
  vp8x.set(new TextEncoder().encode("VP8X"));
  new DataView(vp8x.buffer).setUint32(4, 10, true);
  const vp8l = new Uint8Array(14);
  vp8l.set(new TextEncoder().encode("VP8L"));
  new DataView(vp8l.buffer).setUint32(4, 5, true);
  vp8l.set([0x2f, 0x01, 0x40, 0x00, 0x00], 8);
  const body = concatBytes([vp8x, vp8l]);
  const bytes = new Uint8Array(12 + body.byteLength);
  bytes.set(new TextEncoder().encode("RIFF"));
  new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(body, 12);
  return bytes;
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then(
      (buffer) => {
        this.result = buffer;
        this.onloadend?.();
      },
      () => this.onerror?.(),
    );
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then(
      (buffer) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.();
      },
      () => this.onerror?.(),
    );
  }
}

interface FixtureImageMetadata {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly height: number;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width: number;
}

function decodeFixtureImageMetadata(
  bytes: Uint8Array<ArrayBuffer>,
): FixtureImageMetadata {
  const isPng = bytes.byteLength >= 24 && [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ].every((value, index) => bytes[index] === value);
  if (isPng) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      bytes,
      height: view.getUint32(20, false),
      mimeType: "image/png",
      width: view.getUint32(16, false),
    };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sizeMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 1 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset] ?? 0;
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.byteLength) break;
      const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
      if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
      if (sizeMarkers.has(marker) && segmentLength >= 7) {
        return {
          bytes,
          height: ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0),
          mimeType: "image/jpeg",
          width: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        };
      }
      offset += segmentLength;
    }
  }
  throw new Error("Unsupported fixture image bytes");
}

/**
 * Three's loaders/exporter stay real in this harness. Only the browser image and canvas
 * primitives unavailable in Vitest's Node environment are represented. The canvas retains
 * the already-valid fixture encoding, equivalent to a lossless browser canvas export for PNG
 * and a deterministic no-op JPEG re-encode for the one-pixel fixture.
 */
function installThreeImageFixtureHarness(): { dispose(): void } {
  const nativeUrl = URL;
  const objectUrls = new Map<string, Blob>();

  class FixtureImageElement {
    readonly #listeners = new Map<string, Set<(event: Event) => void>>();
    #src = "";
    complete = false;
    crossOrigin: string | null = null;
    fixtureBytes = new Uint8Array(0);
    fixtureMimeType: FixtureImageMetadata["mimeType"] = "image/png";
    height = 0;
    width = 0;

    addEventListener(type: string, listener: (event: Event) => void): void {
      const listeners = this.#listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: Event) => void): void {
      this.#listeners.get(type)?.delete(listener);
    }

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      this.complete = false;
      const blob = objectUrls.get(value);
      void (blob ? blob.arrayBuffer() : Promise.reject(new Error("Unknown fixture object URL"))).then(
        (buffer) => {
          const decoded = decodeFixtureImageMetadata(new Uint8Array(buffer));
          this.fixtureBytes = decoded.bytes;
          this.fixtureMimeType = decoded.mimeType;
          this.height = decoded.height;
          this.width = decoded.width;
          this.complete = true;
          this.#dispatch("load");
        },
        () => this.#dispatch("error"),
      );
    }

    #dispatch(type: string): void {
      const event = { type } as Event;
      for (const listener of [...(this.#listeners.get(type) ?? [])]) {
        listener.call(this, event);
      }
    }
  }

  class FixtureCanvasElement {
    #image: FixtureImageElement | null = null;
    height = 1;
    width = 1;

    getContext(type: string): object | null {
      if (type !== "2d") return null;
      return {
        drawImage: (image: FixtureImageElement) => {
          this.#image = image;
        },
        scale() {},
        translate() {},
      };
    }

    toBlob(callback: (blob: Blob | null) => void, mimeType = "image/png"): void {
      const image = this.#image;
      queueMicrotask(() => {
        callback(image ? new Blob([image.fixtureBytes], { type: mimeType }) : null);
      });
    }
  }

  class FixtureUrl extends nativeUrl {
    static createObjectURL(blob: Blob): string {
      const url = nativeUrl.createObjectURL(blob);
      objectUrls.set(url, blob);
      return url;
    }

    static revokeObjectURL(url: string): void {
      objectUrls.delete(url);
      nativeUrl.revokeObjectURL(url);
    }
  }

  vi.stubGlobal("document", {
    createElement(name: string) {
      if (name !== "canvas") throw new Error(`Unexpected fixture element: ${name}`);
      return new FixtureCanvasElement();
    },
    createElementNS(_namespace: string, name: string) {
      if (name !== "img") throw new Error(`Unexpected fixture namespaced element: ${name}`);
      return new FixtureImageElement();
    },
  });
  vi.stubGlobal("FileReader", TestFileReader);
  vi.stubGlobal("HTMLCanvasElement", FixtureCanvasElement);
  vi.stubGlobal("HTMLImageElement", FixtureImageElement);
  vi.stubGlobal("ProgressEvent", class {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    readonly type: string;

    constructor(
      type: string,
      init: { lengthComputable?: boolean; loaded?: number; total?: number } = {},
    ) {
      this.type = type;
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  });
  vi.stubGlobal("URL", FixtureUrl);
  vi.stubGlobal("self", globalThis);

  return {
    dispose() {
      for (const url of objectUrls.keys()) nativeUrl.revokeObjectURL(url);
      objectUrls.clear();
    },
  };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function littleEndianUint16(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function littleEndianUint32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function littleEndianFloat32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function nullTerminatedAscii(value: string): Uint8Array<ArrayBuffer> {
  return concatBytes([new TextEncoder().encode(value), new Uint8Array([0])]);
}

function tdsChunk(id: number, ...payload: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concatBytes(payload);
  return concatBytes([
    littleEndianUint16(id),
    littleEndianUint32(body.byteLength + 6),
    body,
  ]);
}

/** A generated, public-domain-by-construction 3DS triangle containing no vendor asset bytes. */
function minimal3dsTriangle(): Uint8Array<ArrayBuffer> {
  const points = tdsChunk(
    0x4110,
    littleEndianUint16(3),
    littleEndianFloat32(0), littleEndianFloat32(0), littleEndianFloat32(0),
    littleEndianFloat32(1), littleEndianFloat32(0), littleEndianFloat32(0),
    littleEndianFloat32(0), littleEndianFloat32(1), littleEndianFloat32(0),
  );
  const faces = tdsChunk(
    0x4120,
    littleEndianUint16(1),
    littleEndianUint16(0),
    littleEndianUint16(1),
    littleEndianUint16(2),
    littleEndianUint16(0),
  );
  const triangleObject = tdsChunk(0x4100, points, faces);
  const namedObject = tdsChunk(0x4000, nullTerminatedAscii("Triangle"), triangleObject);
  const meshData = tdsChunk(0x3d3d, namedObject);
  const version = tdsChunk(0x0002, littleEndianUint32(3));
  return tdsChunk(0x4d4d, version, meshData);
}

async function expectCanonicalTriangleGlb(
  converted: Bg3dModelUploadSource,
  expectedName: string,
): Promise<void> {
  const buffer = await converted.arrayBuffer();
  const view = new DataView(buffer);

  expect(converted).toMatchObject({
    name: expectedName,
    type: "model/gltf-binary",
    size: buffer.byteLength,
  });
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(buffer.byteLength);

  const jsonChunkLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const jsonChunkEnd = 20 + jsonChunkLength;
  expect(jsonChunkEnd + 8).toBeLessThanOrEqual(buffer.byteLength);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonChunkLength)).trim(),
  ) as {
    accessors?: Array<{ count?: number; type?: string }>;
    asset?: { version?: string };
    buffers?: unknown[];
    meshes?: Array<{
      primitives?: Array<{ attributes?: { POSITION?: number } }>;
    }>;
    nodes?: unknown[];
    scenes?: unknown[];
  };
  expect(json).toMatchObject({ asset: { version: "2.0" } });
  expect(json.buffers?.length).toBeGreaterThanOrEqual(1);
  expect(json.meshes?.length).toBeGreaterThanOrEqual(1);
  expect(json.nodes?.length).toBeGreaterThanOrEqual(1);
  expect(json.scenes?.length).toBeGreaterThanOrEqual(1);
  const binChunkLength = view.getUint32(jsonChunkEnd, true);
  expect(binChunkLength).toBeGreaterThan(0);
  expect(view.getUint32(jsonChunkEnd + 4, true)).toBe(0x004e4942);
  expect(jsonChunkEnd + 8 + binChunkLength).toBe(buffer.byteLength);
  const positionAccessorIndex = json.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION;
  expect(positionAccessorIndex).toEqual(expect.any(Number));
  expect(json.accessors?.[positionAccessorIndex ?? -1]).toMatchObject({
    count: 3,
    type: "VEC3",
  });

  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  expect(meshes.length).toBeGreaterThanOrEqual(1);
  expect(meshes.reduce(
    (total, mesh) => total + (mesh.geometry.getAttribute("position")?.count ?? 0),
    0,
  )).toBeGreaterThanOrEqual(3);
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.dispose();
    }
  }
}

interface TexturedCanonicalGlbJson {
  readonly accessors?: ReadonlyArray<{ count?: number; type?: string }>;
  readonly bufferViews?: ReadonlyArray<{ byteLength?: number; byteOffset?: number }>;
  readonly buffers?: ReadonlyArray<{ byteLength?: number; uri?: string }>;
  readonly images?: ReadonlyArray<{ bufferView?: number; mimeType?: string; uri?: string }>;
  readonly materials?: ReadonlyArray<{
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: readonly number[];
      baseColorTexture?: { index?: number };
    };
  }>;
  readonly meshes?: ReadonlyArray<{
    primitives?: ReadonlyArray<{
      attributes?: { POSITION?: number; TEXCOORD_0?: number };
      material?: number;
    }>;
  }>;
  readonly textures?: ReadonlyArray<{ source?: number }>;
}

function inspectTexturedCanonicalGlb(
  buffer: ArrayBuffer,
  expectedMimeType: "image/jpeg" | "image/png",
): { imageBytes: Uint8Array<ArrayBuffer>; json: TexturedCanonicalGlbJson } {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(buffer.byteLength);

  const jsonChunkLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonChunkLength)).trim(),
  ) as TexturedCanonicalGlbJson;
  const binHeaderOffset = 20 + jsonChunkLength;
  expect(view.getUint32(binHeaderOffset + 4, true)).toBe(0x004e4942);
  const binOffset = binHeaderOffset + 8;
  const image = json.images?.[0];
  const imageBufferViewIndex = image?.bufferView;
  const imageBufferView = imageBufferViewIndex === undefined
    ? undefined
    : json.bufferViews?.[imageBufferViewIndex];

  expect(json.buffers).toHaveLength(1);
  expect(json.buffers?.[0]?.uri).toBeUndefined();
  expect(json.images).toHaveLength(1);
  expect(image).toMatchObject({ mimeType: expectedMimeType });
  expect(image?.uri).toBeUndefined();
  expect(imageBufferViewIndex).toEqual(expect.any(Number));
  expect(imageBufferView?.byteLength).toEqual(expect.any(Number));
  expect(json.textures).toEqual([expect.objectContaining({ source: 0 })]);
  expect(json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture).toMatchObject({ index: 0 });
  expect(json.meshes?.[0]?.primitives?.[0]?.material).toBe(0);

  const imageByteOffset = imageBufferView?.byteOffset ?? 0;
  const imageByteLength = imageBufferView?.byteLength ?? 0;
  return {
    imageBytes: new Uint8Array(buffer.slice(
      binOffset + imageByteOffset,
      binOffset + imageByteOffset + imageByteLength,
    )),
    json,
  };
}

function expectPaddedEmbeddedImage(
  embedded: Uint8Array<ArrayBuffer>,
  fixture: Uint8Array<ArrayBuffer>,
): void {
  expect(embedded.subarray(0, fixture.byteLength)).toEqual(fixture);
  expect(embedded.byteLength - fixture.byteLength).toBeGreaterThanOrEqual(0);
  expect(embedded.byteLength - fixture.byteLength).toBeLessThanOrEqual(3);
  expect([...embedded.subarray(fixture.byteLength)]).toEqual(
    Array.from({ length: embedded.byteLength - fixture.byteLength }, () => 0),
  );
}

async function expectReloadedTexturedTriangle(
  buffer: ArrayBuffer,
  expected: {
    readonly height: number;
    readonly imageBytes: Uint8Array<ArrayBuffer>;
    readonly materialName: string;
    readonly mimeType: "image/jpeg" | "image/png";
    readonly width: number;
  },
): Promise<void> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  let mesh: Mesh | undefined;
  gltf.scene.traverse((object) => {
    const candidate = object as Mesh;
    if (!mesh && candidate.isMesh) mesh = candidate;
  });
  expect(mesh).toBeDefined();
  if (!mesh) return;

  const material = (
    Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  ) as MeshStandardMaterial;
  const map = material.map;
  try {
    expect(mesh.geometry.getAttribute("position")?.count).toBe(3);
    expect(mesh.geometry.getAttribute("uv")?.count).toBe(3);
    expect(material.isMeshStandardMaterial).toBe(true);
    expect(material.name).toBe(expected.materialName);
    expect(map).not.toBeNull();
    if (!map) return;
    const image = map.image as {
      readonly fixtureBytes: Uint8Array<ArrayBuffer>;
      readonly fixtureMimeType: string;
      readonly height: number;
      readonly width: number;
    };
    expect(map.userData.mimeType).toBe(expected.mimeType);
    expect(image).toMatchObject({
      fixtureMimeType: expected.mimeType,
      height: expected.height,
      width: expected.width,
    });
    expect(image.fixtureBytes).toEqual(expected.imageBytes);
  } finally {
    mesh.geometry.dispose();
    map?.dispose();
    for (const candidate of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      candidate.dispose();
    }
  }
}

function preExportBudget(
  complexity: Partial<StudioBg3dGlbValidationBudget["complexity"]> = {},
  textures: Partial<StudioBg3dGlbValidationBudget["textures"]> = {},
): StudioBg3dGlbValidationBudget {
  return {
    complexity: {
      ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop.complexity,
      maxModelBytes: 512 * 1024 * 1024,
      ...complexity,
    },
    textures: {
      ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop.textures,
      maxTotalBytes: 512 * 1024 * 1024,
      ...textures,
    },
  };
}

afterEach(() => {
  disposeSharedStudioBg3dGeometryWorkerClient();
  disposeSharedStudioBg3dObjWorkerClient();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("planStudioBg3dModelImports", () => {
  it("keeps format loaders and the GLB exporter behind analyzable dynamic imports", () => {
    const source = readFileSync(new URL("./studio-bg3d-model-import.ts", import.meta.url), "utf8");
    const objRuntimeSource = readFileSync(
      new URL("./studio-bg3d-obj-worker-runtime.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/^import .*three\/examples\/jsm\/(?:loaders|exporters)\//gmu);
    for (const runtime of [
      "loaders/GLTFLoader.js",
      "exporters/GLTFExporter.js",
    ]) {
      expect(source).toContain(`import("three/examples/jsm/${runtime}")`);
    }
    expect(source).not.toContain("loaders/OBJLoader.js");
    expect(source).not.toContain("loaders/MTLLoader.js");
    expect(objRuntimeSource).toContain('import("three/examples/jsm/loaders/OBJLoader.js")');
    expect(objRuntimeSource).not.toContain("loaders/MTLLoader.js");
  });

  it("plans all standard primary formats while retaining bounded companion resources", () => {
    const files = [
      sourceFile("room.gltf", "{}", "set/room.gltf"),
      sourceFile("room.bin", new Uint8Array([1, 2]), "set/room.bin"),
      sourceFile("albedo.png", new Uint8Array([3]), "set/textures/albedo.png"),
      sourceFile("chair.obj", "v 0 0 0", "set/chair.obj"),
      sourceFile("chair.mtl", "newmtl material", "set/chair.mtl"),
      sourceFile("actor.fbx", new Uint8Array([4]), "set/actor.fbx"),
      sourceFile("prop.glb", new Uint8Array([5]), "set/prop.glb"),
      sourceFile("legacy.dae", "<COLLADA />", "set/legacy.dae"),
      sourceFile("scan.stl", "solid scan", "set/scan.stl"),
      sourceFile("cloud.ply", "ply", "set/cloud.ply"),
      sourceFile("archive.3ds", new Uint8Array([6]), "set/archive.3ds"),
      sourceFile("LICENSE.txt", "license", "set/LICENSE.txt"),
    ];

    const plan = planStudioBg3dModelImports(files);

    expect(plan.items.map(({ format, primaryPath }) => [format, primaryPath])).toEqual([
      ["gltf", "set/room.gltf"],
      ["obj", "set/chair.obj"],
      ["fbx", "set/actor.fbx"],
      ["glb", "set/prop.glb"],
      ["dae", "set/legacy.dae"],
      ["stl", "set/scan.stl"],
      ["ply", "set/cloud.ply"],
      ["3ds", "set/archive.3ds"],
    ]);
    expect([...plan.resources.keys()]).toEqual([
      "set/room.gltf",
      "set/room.bin",
      "set/textures/albedo.png",
      "set/chair.obj",
      "set/chair.mtl",
      "set/actor.fbx",
      "set/prop.glb",
      "set/legacy.dae",
      "set/scan.stl",
      "set/cloud.ply",
      "set/archive.3ds",
    ]);
    expect(plan.ignoredFiles).toEqual(["set/LICENSE.txt"]);
    expect(plan.totalBytes).toBe(
      files.filter((file) => file.name !== "LICENSE.txt").reduce((sum, file) => sum + file.size, 0),
    );
  });

  it("ignores empty or oversized unrelated directory files without charging import bytes", () => {
    const model = sourceFile("room.glb", new Uint8Array([1]), "set/room.glb");
    const emptyReadme = virtualFile("README.md", 0);
    const hugeLicense = virtualFile("LICENSE.txt", STUDIO_BG3D_IMPORT_MAX_FILE_BYTES + 1);

    const plan = planStudioBg3dModelImports([model, emptyReadme, hugeLicense]);

    expect(plan.items).toHaveLength(1);
    expect(plan.ignoredFiles).toEqual(["README.md", "LICENSE.txt"]);
    expect(plan.totalBytes).toBe(model.size);
  });

  it("rejects case-folded collisions and traversal paths before reading bytes", () => {
    expect(() => planStudioBg3dModelImports([
      sourceFile("model.glb", new Uint8Array([1]), "Assets/Model.glb"),
      sourceFile("model.glb", new Uint8Array([2]), "assets/model.glb"),
    ])).toThrowError(expect.objectContaining<Partial<StudioBg3dModelImportError>>({
      code: "duplicate-resource",
    }));

    expect(() => planStudioBg3dModelImports([
      sourceFile("model.gltf", "{}", "models/../model.gltf"),
    ])).toThrowError(expect.objectContaining<Partial<StudioBg3dModelImportError>>({
      code: "invalid-path",
    }));
  });

  it("enforces file-count and per-file byte limits before materializing content", () => {
    const tooMany = Array.from(
      { length: STUDIO_BG3D_IMPORT_MAX_FILES + 1 },
      (_, index) => virtualFile(`model-${index}.glb`, 1),
    );
    expect(() => planStudioBg3dModelImports(tooMany)).toThrowError(
      expect.objectContaining({ code: "too-many-files" }),
    );
    expect(() => planStudioBg3dModelImports([
      virtualFile("huge.glb", STUDIO_BG3D_IMPORT_MAX_FILE_BYTES + 1),
    ])).toThrowError(expect.objectContaining({ code: "file-too-large" }));
  });
});

describe("convertStudioBg3dModelFilesToGlb", () => {
  it("enforces every active-profile light, rig, morph, and unique-texture boundary", async () => {
    const {
      Bone,
      BufferGeometry,
      DirectionalLight,
      Float32BufferAttribute,
      Group,
      MeshStandardMaterial,
      Skeleton,
      SkinnedMesh,
      Texture,
    } = await import("three");
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    geometry.morphAttributes.position = [new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0.25,
    ], 3)];
    const texture = new Texture({ width: 4, height: 2 });
    texture.generateMipmaps = false;
    const material = new MeshStandardMaterial({
      alphaMap: texture,
      map: texture,
    });
    const skinnedMesh = new SkinnedMesh(geometry, material);
    const rootBone = new Bone();
    const childBone = new Bone();
    rootBone.add(childBone);
    skinnedMesh.add(rootBone);
    skinnedMesh.bind(new Skeleton([rootBone, childBone]));
    root.add(skinnedMesh, new DirectionalLight());

    const exact: StudioBg3dGlbValidationBudget = {
      complexity: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop.complexity,
        maxJoints: 2,
        maxLights: 1,
        maxModelBytes: 1024 * 1024,
        maxMorphTargets: 1,
        maxSkins: 1,
      },
      textures: {
        maxDimension: 4,
        maxTextures: 1,
        maxTotalBytes: 32,
      },
    };
    const candidate = { root, animations: [] };

    try {
      expect(() => assertStudioBg3dPreExportBudgets(candidate, undefined, exact))
        .not.toThrow();
      for (const [budget, code] of [
        [{
          ...exact,
          complexity: { ...exact.complexity, maxLights: 0 },
        }, "light-budget-exceeded"],
        [{
          ...exact,
          complexity: { ...exact.complexity, maxSkins: 0 },
        }, "skin-count-budget-exceeded"],
        [{
          ...exact,
          complexity: { ...exact.complexity, maxJoints: 1 },
        }, "joint-count-budget-exceeded"],
        [{
          ...exact,
          complexity: { ...exact.complexity, maxMorphTargets: 0 },
        }, "morph-target-budget-exceeded"],
        [{
          ...exact,
          textures: { ...exact.textures, maxTextures: 0 },
        }, "texture-count-budget-exceeded"],
        [{
          ...exact,
          textures: { ...exact.textures, maxDimension: 3 },
        }, "texture-dimension-budget-exceeded"],
        [{
          ...exact,
          textures: { ...exact.textures, maxTotalBytes: 31 },
        }, "texture-byte-budget-exceeded"],
      ] as const) {
        expect(() => assertStudioBg3dPreExportBudgets(candidate, undefined, budget))
          .toThrowError(expect.objectContaining({ code }));
      }
    } finally {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    }
  });

  it("rejects shared-skeleton skins and multi-group morph primitives before exporter entry", async () => {
    const {
      Bone,
      BufferGeometry,
      Float32BufferAttribute,
      Group,
      Mesh,
      MeshBasicMaterial,
      Skeleton,
      SkinnedMesh,
    } = await import("three");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const parseAsync = vi.spyOn(GLTFExporter.prototype, "parseAsync");
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    const material = new MeshBasicMaterial();
    const skeletonRoot = new Bone();
    const skeletonChild = new Bone();
    skeletonRoot.add(skeletonChild);
    const skeleton = new Skeleton([skeletonRoot, skeletonChild]);
    const first = new SkinnedMesh(geometry, material);
    const second = new SkinnedMesh(geometry, material);
    first.add(skeletonRoot);
    first.bind(skeleton);
    second.bind(skeleton);
    root.add(first, second);

    const morphGeometry = new BufferGeometry();
    morphGeometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ], 3));
    morphGeometry.morphAttributes.position = [new Float32BufferAttribute([
      0, 0, 0.1,
      1, 0, 0.1,
      0, 1, 0.1,
      1, 0, 0.1,
      1, 1, 0.1,
      0, 1, 0.1,
    ], 3)];
    morphGeometry.addGroup(0, 3, 0);
    morphGeometry.addGroup(3, 3, 1);
    const morphMaterials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const morphMesh = new Mesh(morphGeometry, morphMaterials);

    try {
      expect(() => assertStudioBg3dPreExportBudgets(
        { root, animations: [] },
        undefined,
        preExportBudget({ maxJoints: 4, maxSkins: 1 }),
      )).toThrowError(expect.objectContaining({ code: "skin-count-budget-exceeded" }));
      expect(() => assertStudioBg3dPreExportBudgets(
        { root, animations: [] },
        undefined,
        preExportBudget({ maxJoints: 3, maxSkins: 2 }),
      )).toThrowError(expect.objectContaining({ code: "joint-count-budget-exceeded" }));

      expect(() => assertStudioBg3dPreExportBudgets(
        { root: morphMesh, animations: [] },
        undefined,
        preExportBudget({ maxMorphTargets: 1 }),
      )).toThrowError(expect.objectContaining({ code: "morph-target-budget-exceeded" }));
      expect(parseAsync).not.toHaveBeenCalled();
    } finally {
      geometry.dispose();
      material.dispose();
      morphGeometry.dispose();
      for (const candidate of morphMaterials) candidate.dispose();
    }
  });

  it("measures an export base image even when a tiny manual mipmap is present", async () => {
    const {
      BufferGeometry,
      Float32BufferAttribute,
      Mesh,
      MeshBasicMaterial,
      Texture,
    } = await import("three");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const parseAsync = vi.spyOn(GLTFExporter.prototype, "parseAsync");
    const texture = new Texture({ width: 4_096, height: 4_096 });
    texture.mipmaps = [{
      data: new Uint8Array(4),
      height: 1,
      width: 1,
    }];
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(geometry, material);

    try {
      expect(() => assertStudioBg3dPreExportBudgets(
        { root: mesh, animations: [] },
        undefined,
        preExportBudget({}, {
          maxDimension: 64,
          maxTextures: 1,
        }),
      )).toThrowError(expect.objectContaining({
        code: "texture-dimension-budget-exceeded",
      }));
      expect(() => assertStudioBg3dPreExportBudgets(
        { root: mesh, animations: [] },
        undefined,
        preExportBudget({}, {
          maxDimension: 4_096,
          maxTextures: 1,
          maxTotalBytes: 1024,
        }),
      )).toThrowError(expect.objectContaining({
        code: "texture-byte-budget-exceeded",
      }));
      expect(() => assertStudioBg3dPreExportBudgets(
        { root: mesh, animations: [] },
        undefined,
        preExportBudget({ maxModelBytes: 1024 * 1024 }, {
          maxDimension: 4_096,
          maxTextures: 1,
        }),
      )).toThrowError(expect.objectContaining({
        code: "model-byte-budget-exceeded",
      }));
      expect(parseAsync).not.toHaveBeenCalled();
    } finally {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    }
  });

  it("bounds serializable custom-extension metadata without invoking getters before exporter entry", async () => {
    const { Group } = await import("three");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const parseAsync = vi.spyOn(GLTFExporter.prototype, "parseAsync");
    const metadataBudget = preExportBudget({ maxModelBytes: 8 * 1024 });
    const gltfWithLargeExtras = sourceFile("metadata.gltf", JSON.stringify({
      asset: { version: "2.0" },
      nodes: [{
        extras: {
          payload: "x".repeat(16 * 1024),
        },
      }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    }));

    await expect(convertStudioBg3dModelFilesToGlb([gltfWithLargeExtras], {
      budgets: {
        desktop: metadataBudget,
        mobile: metadataBudget,
      },
      profile: "desktop",
    })).rejects.toMatchObject({ code: "model-byte-budget-exceeded" });

    const root = new Group();
    root.userData = {
      gltfExtensions: {
        EXT_large_payload: {
          payload: "가".repeat(3 * 1024),
        },
      },
    };

    expect(() => assertStudioBg3dPreExportBudgets(
      { root, animations: [] },
      undefined,
      metadataBudget,
    )).toThrowError(expect.objectContaining({ code: "model-byte-budget-exceeded" }));

    const getter = vi.fn(() => "must-not-run");
    const hostileUserData = {};
    Object.defineProperty(hostileUserData, "payload", {
      enumerable: true,
      get: getter,
    });
    root.userData = hostileUserData;
    expect(() => assertStudioBg3dPreExportBudgets(
      { root, animations: [] },
      undefined,
      preExportBudget(),
    )).toThrowError(expect.objectContaining({ code: "parse-failed" }));
    expect(getter).not.toHaveBeenCalled();

    const cyclicUserData: { self?: unknown } = {};
    cyclicUserData.self = cyclicUserData;
    root.userData = cyclicUserData;
    expect(() => assertStudioBg3dPreExportBudgets(
      { root, animations: [] },
      undefined,
      preExportBudget(),
    )).toThrowError(expect.objectContaining({ code: "parse-failed" }));
    expect(parseAsync).not.toHaveBeenCalled();
  });

  it("rejects combined geometry and animation accessor or decoded-byte totals before exporter entry", async () => {
    const {
      BufferGeometry,
      Float32BufferAttribute,
      Group,
      Mesh,
      MeshBasicMaterial,
      NumberKeyframeTrack,
      AnimationClip,
    } = await import("three");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const parseAsync = vi.spyOn(GLTFExporter.prototype, "parseAsync");
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    const material = new MeshBasicMaterial();
    root.add(new Mesh(geometry, material));
    const animation = new AnimationClip("move", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);

    try {
      expect(() => assertStudioBg3dPreExportBudgets(
        { root, animations: [animation] },
        undefined,
        preExportBudget({
          maxAccessorElements: 5,
          maxDecodedGeometryBytes: 1024,
        }),
      )).toThrowError(expect.objectContaining({ code: "geometry-memory-too-large" }));
      expect(() => assertStudioBg3dPreExportBudgets(
        { root, animations: [animation] },
        undefined,
        preExportBudget({
          maxAccessorElements: 1024,
          maxDecodedGeometryBytes: 40,
        }),
      )).toThrowError(expect.objectContaining({ code: "geometry-memory-too-large" }));
      expect(parseAsync).not.toHaveBeenCalled();
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });

  it("enforces the conservative pre-export model-byte estimate at its exact boundary", async () => {
    const { Group } = await import("three");
    const candidate = { root: new Group(), animations: [] };
    const exactEstimate = 4_608;
    const budget = (maxModelBytes: number): StudioBg3dGlbValidationBudget => ({
      complexity: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop.complexity,
        maxModelBytes,
      },
      textures: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop.textures,
      },
    });

    expect(() => assertStudioBg3dPreExportBudgets(
      candidate,
      undefined,
      budget(exactEstimate),
    )).not.toThrow();
    expect(() => assertStudioBg3dPreExportBudgets(
      candidate,
      undefined,
      budget(exactEstimate - 1),
    )).toThrowError(expect.objectContaining({
      code: "model-byte-budget-exceeded",
    }));
  });

  it("never calls GLTFExporter.parseAsync or exporting progress after mobile preflight rejects", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const parseAsync = vi.spyOn(GLTFExporter.prototype, "parseAsync");
    const progress = vi.fn();
    const mobile = {
      complexity: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile.complexity,
        maxModelBytes: 0,
      },
      textures: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile.textures,
      },
    };
    const obj = sourceFile("mobile-preflight.obj", [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    await expect(convertStudioBg3dModelFilesToGlb([obj], {
      profile: "mobile",
      budgets: {
        mobile,
        desktop: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.desktop,
      },
      onProgress: progress,
    })).rejects.toMatchObject({
      code: "model-byte-budget-exceeded",
    });
    expect(parseAsync).not.toHaveBeenCalled();
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual([
      "planning",
      "reading",
      "parsing",
    ]);
  });

  it("bounds material and animation work before the GLB exporter is entered", async () => {
    const {
      AnimationClip,
      BufferGeometry,
      Float32BufferAttribute,
      Group,
      Mesh,
      MeshBasicMaterial,
      NumberKeyframeTrack,
    } = await import("three");
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    const material = new MeshBasicMaterial();
    root.add(new Mesh(geometry, material));
    const animation = new AnimationClip("blink", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);

    try {
      expect(() => assertStudioBg3dPreExportBudgets({
        root,
        animations: [animation],
      })).not.toThrow();
    } finally {
      geometry.dispose();
      material.dispose();
    }

    const source = readFileSync(new URL("./studio-bg3d-model-import.ts", import.meta.url), "utf8");
    const conversion = source.slice(
      source.indexOf("async function convertPlanItem("),
      source.indexOf("export async function convertStudioBg3dModelFilesToGlb("),
    );
    const preExportAdmission = conversion.indexOf(
      "assertStudioBg3dPreExportBudgets(parsed, signal, preExportBudget)",
    );
    const exporterInvocation = conversion.indexOf(
      "exportParsedImportToGlb(parsed, item.primaryPath, signal)",
    );
    expect(preExportAdmission).toBeGreaterThanOrEqual(0);
    expect(exporterInvocation).toBeGreaterThan(preExportAdmission);
  });

  it("rejects a mobile-profile OBJ before export while the desktop profile converts it", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const materialCount =
      DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile.complexity.maxMaterials + 1;
    const obj = sourceFile("profiled.obj", [
      "mtllib profiled.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      ...Array.from(
        { length: materialCount },
        (_, index) => `usemtl material-${index}\nf 1 2 3`,
      ),
    ].join("\n"));
    const mtl = sourceFile(
      "profiled.mtl",
      Array.from(
        { length: materialCount },
        (_, index) => `newmtl material-${index}\nKd 0.5 0.5 0.5`,
      ).join("\n"),
    );
    const desktopStages: string[] = [];

    const [desktop] = await convertStudioBg3dModelFilesToGlb([obj, mtl], {
      profile: "desktop",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      onProgress: ({ stage }) => desktopStages.push(stage),
    });

    expect(desktop?.name).toBe("profiled.glb");
    expect(desktopStages).toContain("exporting");

    const mobileStages: string[] = [];
    await expect(convertStudioBg3dModelFilesToGlb([obj, mtl], {
      profile: "mobile",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      onProgress: ({ stage }) => mobileStages.push(stage),
    })).rejects.toMatchObject({
      code: "material-budget-exceeded",
    });
    expect(mobileStages).toContain("parsing");
    expect(mobileStages).not.toContain("exporting");
  });

  it("rejects excessive OBJ/MTL material sets before conversion", async () => {
    const {
      BufferGeometry,
      Float32BufferAttribute,
      Group,
      Mesh,
      MeshBasicMaterial,
    } = await import("three");
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    const materials = Array.from(
      { length: STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS + 1 },
      () => new MeshBasicMaterial(),
    );
    root.add(new Mesh(geometry, materials));

    try {
      expect(() => assertStudioBg3dPreExportBudgets({ root, animations: [] }))
        .toThrowError(expect.objectContaining({ code: "material-budget-exceeded" }));
    } finally {
      geometry.dispose();
      for (const material of materials) material.dispose();
    }
  });

  it("rejects excessive or malformed animation data before conversion", async () => {
    const { Group } = await import("three");
    const root = new Group();
    const track = (times: Float32Array, values: Float32Array) => ({
      name: ".position[x]",
      times,
      values,
    });
    const clip = (overrides: Record<string, unknown> = {}) => ({
      name: "motion",
      duration: 1,
      tracks: [track(new Float32Array([0, 1]), new Float32Array([0, 1]))],
      ...overrides,
    });

    expect(() => assertStudioBg3dPreExportBudgets({
      root,
      animations: [clip({
        tracks: Array.from(
          { length: STUDIO_BG3D_IMPORT_MAX_ANIMATION_TRACKS + 1 },
          () => track(new Float32Array(), new Float32Array()),
        ),
      }) as never],
    })).toThrowError(expect.objectContaining({ code: "animation-budget-exceeded" }));

    const tooManyTimes = new Float32Array(STUDIO_BG3D_IMPORT_MAX_ANIMATION_KEYFRAMES + 1);
    expect(() => assertStudioBg3dPreExportBudgets({
      root,
      animations: [clip({
        tracks: [track(tooManyTimes, tooManyTimes)],
      }) as never],
    })).toThrowError(expect.objectContaining({ code: "animation-budget-exceeded" }));

    expect(() => assertStudioBg3dPreExportBudgets({
      root,
      animations: [clip({
        duration: STUDIO_BG3D_IMPORT_MAX_ANIMATION_DURATION_SECONDS + 1,
      }) as never],
    })).toThrowError(expect.objectContaining({ code: "animation-budget-exceeded" }));

    expect(() => assertStudioBg3dPreExportBudgets({
      root,
      animations: [clip({
        tracks: [track(new Float32Array([1, 0]), new Float32Array([0, 1]))],
      }) as never],
    })).toThrowError(expect.objectContaining({ code: "animation-budget-exceeded" }));
  });

  it("passes GLB through to the existing validation boundary and reports deterministic progress", async () => {
    const file = sourceFile("prop.glb", new Uint8Array([1, 2, 3, 4]));
    const progress = vi.fn();

    const converted = await convertStudioBg3dModelFilesToGlb([file], { onProgress: progress });

    expect(converted).toEqual([file]);
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { stage: "planning", completedModels: 0, totalModels: 1, sourceName: "" },
      { stage: "reading", completedModels: 0, totalModels: 1, sourceName: "prop.glb" },
      { stage: "ready", completedModels: 1, totalModels: 1, sourceName: "prop.glb" },
    ]);
  });

  it("fails closed on an incomplete profile policy before source materialization", async () => {
    const read = vi.fn(async () => new ArrayBuffer(1));
    const file = virtualFile("profile-required.obj", 1, read);

    await expect(convertStudioBg3dModelFilesToGlb([file], {
      profile: "mobile",
    })).rejects.toMatchObject({ code: "parse-failed" });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects network references, missing local resources, and unsupported required extensions", async () => {
    const gltf = (root: object) => sourceFile("scene.gltf", JSON.stringify({
      asset: { version: "2.0" },
      scenes: [{ nodes: [] }],
      scene: 0,
      ...root,
    }));

    await expect(convertStudioBg3dModelFilesToGlb([
      gltf({ buffers: [{ byteLength: 4, uri: "https://example.com/model.bin" }] }),
    ])).rejects.toMatchObject({ code: "unsafe-resource-uri" });

    await expect(convertStudioBg3dModelFilesToGlb([
      gltf({ buffers: [{ byteLength: 4, uri: "model.bin" }] }),
    ])).rejects.toMatchObject({ code: "missing-resource" });

    for (const extension of [
      "KHR_draco_mesh_compression",
      "EXT_meshopt_compression",
      "KHR_meshopt_compression",
    ]) {
      await expect(convertStudioBg3dModelFilesToGlb([
        gltf({ extensionsRequired: [extension] }),
      ])).rejects.toMatchObject({ code: "unsupported-extension" });
    }
  });

  it("rejects network textures declared by a selected OBJ material library", async () => {
    const obj = sourceFile("chair.obj", [
      "mtllib chair.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl unsafe",
      "f 1 2 3",
    ].join("\n"));
    const mtl = sourceFile("chair.mtl", [
      "newmtl unsafe",
      "map_Kd https://example.com/texture.png",
    ].join("\n"));

    await expect(convertStudioBg3dModelFilesToGlb([obj, mtl])).rejects.toMatchObject({
      code: "unsafe-resource-uri",
    });
  });

  it("rejects repeated OBJ mtllib directives before reading the repeated companion", async () => {
    const readMaterial = vi.fn(async () => new TextEncoder().encode("newmtl safe").buffer);
    const repeated = Array.from(
      { length: STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_REFERENCE_DIRECTIVES + 1 },
      () => "mtllib repeated.mtl",
    );
    const obj = sourceFile("repeated.obj", [
      ...repeated,
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));
    const mtl = virtualFile("repeated.mtl", 11, readMaterial);

    await expect(convertStudioBg3dModelFilesToGlb([obj, mtl])).rejects.toMatchObject({
      code: "material-budget-exceeded",
    });
    expect(readMaterial).not.toHaveBeenCalled();
  });

  it("rejects cumulative MTL bytes before materializing any companion", async () => {
    const readFirst = vi.fn(async () => new ArrayBuffer(0));
    const readSecond = vi.fn(async () => new ArrayBuffer(0));
    const firstBytes = Math.floor(STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_TOTAL_BYTES / 2) + 1;
    const secondBytes = STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_TOTAL_BYTES - firstBytes + 1;
    const obj = sourceFile("bounded.obj", [
      "mtllib first.mtl",
      "mtllib second.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    await expect(convertStudioBg3dModelFilesToGlb([
      obj,
      virtualFile("first.mtl", firstBytes, readFirst),
      virtualFile("second.mtl", secondBytes, readSecond),
    ])).rejects.toMatchObject({ code: "material-budget-exceeded" });
    expect(readFirst).not.toHaveBeenCalled();
    expect(readSecond).not.toHaveBeenCalled();
  });

  it("canonicalizes case-folded MTL references and reads one material library once", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const obj = sourceFile("dedupe.obj", [
      "mtllib material.mtl",
      "mtllib MATERIAL.MTL",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl safe",
      "f 1 2 3",
    ].join("\n"));
    const mtl = sourceFile("material.mtl", [
      "newmtl safe",
      "Kd 0.5 0.5 0.5",
    ].join("\n"));
    const readMaterial = vi.spyOn(mtl, "arrayBuffer");

    const [converted] = await convertStudioBg3dModelFilesToGlb([obj, mtl]);
    expect(converted?.name).toBe("dedupe.glb");
    expect(readMaterial).toHaveBeenCalledTimes(1);
  });

  it("caps unique MTL libraries before parser allocation", async () => {
    const references = Array.from(
      { length: STUDIO_BG3D_IMPORT_MAX_OBJ_MATERIAL_LIBRARIES + 1 },
      (_, index) => `mtllib material-${index}.mtl`,
    );
    const obj = sourceFile("many-materials.obj", [
      ...references,
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    await expect(convertStudioBg3dModelFilesToGlb([obj])).rejects.toMatchObject({
      code: "material-budget-exceeded",
    });
  });

  it("preflights MTL material and texture-slot directives before Worker parsing", async () => {
    const objFor = (library: string) => sourceFile(`${library}.obj`, [
      `mtllib ${library}.mtl`,
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));
    const excessiveMaterials = sourceFile(
      "materials.mtl",
      Array.from(
        { length: STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS + 1 },
        (_, index) => `newmtl material-${index}`,
      ).join("\n"),
    );
    await expect(convertStudioBg3dModelFilesToGlb([
      objFor("materials"),
      excessiveMaterials,
    ])).rejects.toMatchObject({ code: "material-budget-exceeded" });

    const excessiveTextures = sourceFile("textures.mtl", [
      "newmtl material",
      ...Array.from(
        { length: STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIAL_SLOTS + 1 },
        () => "map_Kd missing.png",
      ),
    ].join("\n"));
    await expect(convertStudioBg3dModelFilesToGlb([
      objFor("textures"),
      excessiveTextures,
    ])).rejects.toMatchObject({ code: "material-budget-exceeded" });
  });

  it("rejects optional, undeclared, and malformed Meshopt buffer views before Three parses them", async () => {
    const gltf = (extensionPayload: unknown, extension = "EXT_meshopt_compression") => sourceFile(
      "scene.gltf",
      JSON.stringify({
        asset: { version: "2.0" },
        scenes: [{ nodes: [] }],
        scene: 0,
        bufferViews: [{
          buffer: 0,
          byteLength: 4,
          extensions: { [extension]: extensionPayload },
        }],
      }),
    );

    for (const file of [
      gltf({
        buffer: 0,
        byteOffset: 0,
        byteLength: 1,
        byteStride: 4,
        count: 1,
        mode: "ATTRIBUTES",
      }),
      gltf(null),
      gltf({}, "KHR_meshopt_compression"),
    ]) {
      const stages: string[] = [];
      await expect(convertStudioBg3dModelFilesToGlb([file], {
        onProgress: ({ stage }) => stages.push(stage),
      })).rejects.toMatchObject({ code: "unsupported-extension" });
      expect(stages).toEqual(["planning", "reading", "parsing"]);
    }
  });

  it("rejects malformed glTF extension and buffer-view containers at the JSON boundary", async () => {
    const gltf = (root: object) => sourceFile("scene.gltf", JSON.stringify({
      asset: { version: "2.0" },
      scenes: [{ nodes: [] }],
      scene: 0,
      ...root,
    }));

    for (const file of [
      gltf({ extensionsRequired: {} }),
      gltf({ bufferViews: {} }),
      gltf({ bufferViews: [{ extensions: [] }] }),
    ]) {
      await expect(convertStudioBg3dModelFilesToGlb([file])).rejects.toMatchObject({
        code: "parse-failed",
      });
    }
  });

  it("fails closed on traversal even when normalization would stay inside the selected files", async () => {
    const gltf = sourceFile("scene.gltf", JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4, uri: "folder/../mesh.bin" }],
      scene: 0,
      scenes: [{ nodes: [] }],
    }));

    await expect(convertStudioBg3dModelFilesToGlb([
      gltf,
      sourceFile("mesh.bin", new Uint8Array(4)),
    ])).rejects.toMatchObject({ code: "unsafe-resource-uri" });
  });

  it("rejects oversized inline data and explosive inline image dimensions before Three loads", async () => {
    const oversizedPayload = "A".repeat(
      Math.ceil((STUDIO_BG3D_IMPORT_MAX_INLINE_RESOURCE_BYTES + 1) / 3) * 4,
    );
    const oversized = sourceFile("oversized.gltf", JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{
        byteLength: 1,
        uri: `data:application/octet-stream;base64,${oversizedPayload}`,
      }],
      scene: 0,
      scenes: [{ nodes: [] }],
    }));
    await expect(convertStudioBg3dModelFilesToGlb([oversized])).rejects.toMatchObject({
      code: "inline-resource-too-large",
    });

    const image = Buffer.from(pngHeader(8_193, 1)).toString("base64");
    const oversizedImage = sourceFile("oversized-image.gltf", JSON.stringify({
      asset: { version: "2.0" },
      images: [{ uri: `data:image/png;base64,${image}` }],
      scene: 0,
      scenes: [{ nodes: [] }],
    }));
    await expect(convertStudioBg3dModelFilesToGlb([oversizedImage])).rejects.toMatchObject({
      code: "image-dimension-too-large",
    });
  });

  it("rejects VP8X/payload dimension mismatch for linked and inline WebP textures", async () => {
    const mismatch = mismatchedExtendedWebp();
    const obj = sourceFile("triangle.obj", [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));
    await expect(convertStudioBg3dModelFilesToGlb([
      obj,
      sourceFile("mismatch.webp", mismatch, "mismatch.webp", "image/webp"),
    ])).rejects.toMatchObject({ code: "invalid-image" });

    const inline = Buffer.from(mismatch).toString("base64");
    const gltf = sourceFile("mismatch.gltf", JSON.stringify({
      asset: { version: "2.0" },
      images: [{ uri: `data:image/webp;base64,${inline}` }],
      scene: 0,
      scenes: [{ nodes: [] }],
    }));
    await expect(convertStudioBg3dModelFilesToGlb([gltf])).rejects.toMatchObject({
      code: "invalid-image",
    });
  });

  it("rejects declared glTF vertices and OBJ hierarchy nodes before parser allocation", async () => {
    const gltf = sourceFile("too-many-vertices.gltf", JSON.stringify({
      accessors: [{ count: STUDIO_BG3D_IMPORT_MAX_VERTICES + 1 }],
      asset: { version: "2.0" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    }));
    await expect(convertStudioBg3dModelFilesToGlb([gltf])).rejects.toMatchObject({
      code: "vertex-budget-exceeded",
    });

    const obj = sourceFile("deep.obj", Array.from(
      { length: STUDIO_BG3D_IMPORT_MAX_NODES + 1 },
      (_, index) => `o node-${index}`,
    ).join("\n"));
    await expect(convertStudioBg3dModelFilesToGlb([obj])).rejects.toMatchObject({
      code: "node-budget-exceeded",
    });
  });

  it("honors cancellation before files are read", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(convertStudioBg3dModelFilesToGlb([
      sourceFile("prop.glb", new Uint8Array([1, 2, 3, 4])),
    ], { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects oversized or cumulatively explosive companion textures before Three decodes them", async () => {
    const obj = sourceFile("triangle.obj", [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));
    await expect(convertStudioBg3dModelFilesToGlb([
      obj,
      sourceFile("oversized.png", pngHeader(8_193, 1)),
    ])).rejects.toMatchObject({ code: "image-dimension-too-large" });

    await expect(convertStudioBg3dModelFilesToGlb([
      obj,
      sourceFile("texture-a.png", pngHeader(6_000, 6_000)),
      sourceFile("texture-b.png", pngHeader(6_000, 6_000)),
    ])).rejects.toMatchObject({ code: "image-memory-too-large" });
  });

  it("caps cumulative GLB output at the downstream library default without reading pass-through files", async () => {
    const overHalf = Math.floor(STUDIO_BG3D_IMPORT_MAX_OUTPUT_TOTAL_BYTES / 2) + 1;
    const firstRead = vi.fn(async () => new ArrayBuffer(1));
    const secondRead = vi.fn(async () => new ArrayBuffer(1));
    const first = virtualFile("first.glb", overHalf, firstRead);
    const second = virtualFile("second.glb", overHalf, secondRead);

    await expect(convertStudioBg3dModelFilesToGlb([first, second])).rejects.toMatchObject({
      code: "output-total-too-large",
    });
    expect(firstRead).not.toHaveBeenCalled();
    expect(secondRead).not.toHaveBeenCalled();
  });

  it("observes cancellation immediately after an in-flight source read settles", async () => {
    const controller = new AbortController();
    let resolveRead: ((buffer: ArrayBuffer) => void) | undefined;
    const arrayBuffer = vi.fn(() => new Promise<ArrayBuffer>((resolve) => {
      resolveRead = resolve;
    }));
    const file = sourceFile("delayed.gltf", new Uint8Array([0x7b, 0x7d]));
    Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });
    const pending = convertStudioBg3dModelFilesToGlb([file], { signal: controller.signal });
    const observed = pending.catch((error: unknown) => error);

    await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
    controller.abort();
    resolveRead?.(new Uint8Array([0x7b, 0x7d]).buffer);

    await expect(observed).resolves.toMatchObject({ code: "aborted" });
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it("cancels at the parse-to-export boundary before materializing output", async () => {
    const controller = new AbortController();
    const stages: string[] = [];
    const obj = sourceFile("cancel-before-export.obj", [
      "o triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    const pending = convertStudioBg3dModelFilesToGlb([obj], {
      signal: controller.signal,
      onProgress(progress) {
        stages.push(progress.stage);
        if (progress.stage === "exporting") controller.abort();
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(stages).toEqual(["planning", "reading", "parsing", "exporting"]);
  });

  it("does not resolve a batch when cancellation is requested from the final ready callback", async () => {
    const controller = new AbortController();
    const file = sourceFile("ready.glb", new Uint8Array([1, 2, 3, 4]));

    const pending = convertStudioBg3dModelFilesToGlb([file], {
      signal: controller.signal,
      onProgress(progress) {
        if (progress.stage === "ready") controller.abort();
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("converts a real OBJ mesh into a self-contained GLB container", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const obj = sourceFile("triangle.obj", [
      "o triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    const [converted] = await convertStudioBg3dModelFilesToGlb([obj]);
    const buffer = await converted.arrayBuffer();
    const view = new DataView(buffer);

    expect(converted).toMatchObject({
      name: "triangle.glb",
      type: "model/gltf-binary",
      size: buffer.byteLength,
    });
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(buffer.byteLength);
  });

  it("preserves a selected companion MTL material while canonicalizing OBJ to GLB", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const obj = sourceFile("triangle.obj", [
      "mtllib triangle.mtl",
      "o triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl webtoon-red",
      "f 1 2 3",
    ].join("\n"));
    const mtl = sourceFile("triangle.mtl", [
      "newmtl webtoon-red",
      "Kd 1 0 0",
    ].join("\n"));

    const [converted] = await convertStudioBg3dModelFilesToGlb([obj, mtl]);
    const buffer = await converted.arrayBuffer();
    const view = new DataView(buffer);
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, jsonChunkLength)).trim(),
    ) as {
      materials?: Array<{
        name?: string;
        pbrMetallicRoughness?: { baseColorFactor?: number[] };
      }>;
    };

    expect(jsonChunkType).toBe(0x4e4f534a);
    expect(json.materials).toContainEqual(expect.objectContaining({
      name: "webtoon-red",
      pbrMetallicRoughness: expect.objectContaining({
        baseColorFactor: [1, 0, 0, 1],
      }),
    }));
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Use MeshStandardMaterial or MeshBasicMaterial"),
    );
  });

  it("resolves an OBJ material library inside the selected package without basename guessing", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const obj = sourceFile("triangle.obj", [
      "mtllib ../materials/triangle.mtl",
      "o triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl webtoon-blue",
      "f 1 2 3",
    ].join("\n"), "package/models/triangle.obj");
    const mtl = sourceFile(
      "triangle.mtl",
      "newmtl webtoon-blue\nKd 0 0 1",
      "package/materials/triangle.mtl",
    );

    const [converted] = await convertStudioBg3dModelFilesToGlb([obj, mtl]);
    const buffer = await converted.arrayBuffer();
    const jsonChunkLength = new DataView(buffer).getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, jsonChunkLength)).trim(),
    ) as { materials?: Array<{ name?: string }> };

    expect(json.materials).toContainEqual(expect.objectContaining({ name: "webtoon-blue" }));
  });

  it("embeds and reloads a real OBJ, MTL, and PNG companion set as a textured GLB", async () => {
    const harness = installThreeImageFixtureHarness();
    const png = generatedPngFixture();
    const obj = sourceFile("triangle.obj", [
      "mtllib triangle.mtl",
      "o textured-triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "usemtl webtoon-checker",
      "f 1/1 2/2 3/3",
    ].join("\n"), "models/triangle.obj");
    const mtl = sourceFile("triangle.mtl", [
      "newmtl webtoon-checker",
      "Kd 1 1 1",
      "map_Kd textures/checker.png",
    ].join("\n"), "models/triangle.mtl");
    const texture = sourceFile(
      "checker.png",
      png,
      "models/textures/checker.png",
      "image/png",
    );

    try {
      const [converted] = await convertStudioBg3dModelFilesToGlb([obj, mtl, texture]);
      const buffer = await converted.arrayBuffer();
      const { imageBytes, json } = inspectTexturedCanonicalGlb(buffer, "image/png");
      const primitive = json.meshes?.[0]?.primitives?.[0];
      const positionAccessor = primitive?.attributes?.POSITION;
      const uvAccessor = primitive?.attributes?.TEXCOORD_0;

      expect(converted).toMatchObject({ name: "triangle.glb", type: "model/gltf-binary" });
      expect(json.materials?.[0]?.name).toBe("webtoon-checker");
      expect(json.accessors?.[positionAccessor ?? -1]).toMatchObject({ count: 3, type: "VEC3" });
      expect(json.accessors?.[uvAccessor ?? -1]).toMatchObject({ count: 3, type: "VEC2" });
      expectPaddedEmbeddedImage(imageBytes, png);
      await expectReloadedTexturedTriangle(buffer, {
        height: 1,
        imageBytes,
        materialName: "webtoon-checker",
        mimeType: "image/png",
        width: 2,
      });
    } finally {
      harness.dispose();
    }
  });

  it("embeds an inline glTF buffer into the canonical GLB output", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("ProgressEvent", class {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;
      readonly type: string;

      constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
        this.type = type;
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    });
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const uri = `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString("base64")}`;
    const gltf = sourceFile("inline.gltf", JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: positions.byteLength, uri }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [{
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }));

    const [converted] = await convertStudioBg3dModelFilesToGlb([gltf]);
    const buffer = await converted.arrayBuffer();

    expect(converted.name).toBe("inline.glb");
    expect(new DataView(buffer).getUint32(0, true)).toBe(0x46546c67);
  });

  it("embeds external glTF BIN and JPEG companions and reloads their texture contract", async () => {
    const harness = installThreeImageFixtureHarness();
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
    ]);
    const geometryBytes = concatBytes([
      new Uint8Array(positions.buffer),
      new Uint8Array(uvs.buffer),
    ]);
    const jpeg = minimalJpegFixture();
    const gltf = sourceFile("scene.gltf", JSON.stringify({
      asset: { generator: "ToonSpectrum deterministic fixture", version: "2.0" },
      buffers: [{ byteLength: geometryBytes.byteLength, uri: "scene.bin" }],
      bufferViews: [
        { buffer: 0, byteLength: positions.byteLength, byteOffset: 0 },
        { buffer: 0, byteLength: uvs.byteLength, byteOffset: positions.byteLength },
      ],
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
          componentType: 5126,
          count: 3,
          max: [1, 1],
          min: [0, 0],
          type: "VEC2",
        },
      ],
      images: [{ uri: "textures/albedo.jpg" }],
      textures: [{ source: 0 }],
      materials: [{
        name: "webtoon-jpeg",
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.5, 0.75, 1],
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          material: 0,
          mode: 4,
        }],
      }],
      nodes: [{ mesh: 0, name: "textured-triangle" }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }), "package/scene.gltf", "model/gltf+json");
    const bin = sourceFile("scene.bin", geometryBytes, "package/scene.bin");
    const texture = sourceFile(
      "albedo.jpg",
      jpeg,
      "package/textures/albedo.jpg",
      "image/jpeg",
    );

    try {
      const [converted] = await convertStudioBg3dModelFilesToGlb([gltf, bin, texture]);
      const buffer = await converted.arrayBuffer();
      const { imageBytes, json } = inspectTexturedCanonicalGlb(buffer, "image/jpeg");
      const primitive = json.meshes?.[0]?.primitives?.[0];
      const positionAccessor = primitive?.attributes?.POSITION;
      const uvAccessor = primitive?.attributes?.TEXCOORD_0;

      expect(converted).toMatchObject({ name: "scene.glb", type: "model/gltf-binary" });
      expect(json.materials?.[0]).toMatchObject({
        name: "webtoon-jpeg",
        pbrMetallicRoughness: { baseColorFactor: [0.25, 0.5, 0.75, 1] },
      });
      expect(json.accessors?.[positionAccessor ?? -1]).toMatchObject({ count: 3, type: "VEC3" });
      expect(json.accessors?.[uvAccessor ?? -1]).toMatchObject({ count: 3, type: "VEC2" });
      expectPaddedEmbeddedImage(imageBytes, jpeg);
      await expectReloadedTexturedTriangle(buffer, {
        height: 1,
        imageBytes,
        materialName: "webtoon-jpeg",
        mimeType: "image/jpeg",
        width: 1,
      });
    } finally {
      harness.dispose();
    }
  });

  it("resolves companion resources relative to the primary model before same-named root files", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("ProgressEvent", class {
      readonly lengthComputable = false;
      readonly loaded = 0;
      readonly total = 0;
      readonly type: string;

      constructor(type: string) {
        this.type = type;
      }
    });
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const gltf = sourceFile("scene.gltf", JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: positions.byteLength, uri: "data.bin" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }), "models/scene.gltf");
    const wrongRootResource = sourceFile("data.bin", new Uint8Array(4), "data.bin");
    const correctSiblingResource = sourceFile(
      "data.bin",
      new Uint8Array(positions.buffer),
      "models/data.bin",
    );

    const [converted] = await convertStudioBg3dModelFilesToGlb([
      gltf,
      wrongRootResource,
      correctSiblingResource,
    ]);

    expect(converted.name).toBe("scene.glb");
    expect(new DataView(await converted.arrayBuffer()).getUint32(0, true)).toBe(0x46546c67);
  });

  it("converts a real ASCII STL mesh through the same canonical GLB boundary", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const stl = sourceFile("triangle.stl", [
      "solid triangle",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "vertex 0 1 0",
      "endloop",
      "endfacet",
      "endsolid triangle",
    ].join("\n"));

    const [converted] = await convertStudioBg3dModelFilesToGlb([stl]);
    const buffer = await converted.arrayBuffer();

    expect(converted.name).toBe("triangle.glb");
    expect(new DataView(buffer).getUint32(0, true)).toBe(0x46546c67);
  });

  it("fails closed when the selected geometry Worker is unavailable and permits a separate direct task", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("Worker", undefined);
    const small = sourceFile("small.stl", [
      "solid triangle",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "vertex 0 1 0",
      "endloop",
      "endfacet",
      "endsolid triangle",
    ].join("\n"));
    const large = sourceFile(
      "large.stl",
      new Uint8Array(STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES + 1),
    );

    await expect(convertStudioBg3dModelFilesToGlbWithBackend([small])).rejects.toMatchObject({
      code: "worker-required",
    });
    await expect(convertStudioBg3dModelFilesToGlbWithBackend([small], {
      executionBackend: "direct",
    })).resolves.toHaveLength(1);
    await expect(convertStudioBg3dModelFilesToGlb([large])).rejects.toMatchObject({
      code: "worker-required",
    });
  });

  it("keeps OBJ Worker absence terminal and bounds the separately selected direct backend", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("Worker", undefined);
    const small = sourceFile("small.obj", [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));
    const obj = sourceFile("large.obj", [
      `#${"x".repeat(STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES)}`,
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
    ].join("\n"));

    await expect(convertStudioBg3dModelFilesToGlbWithBackend([small])).rejects.toMatchObject({
      code: "worker-required",
    });
    await expect(convertStudioBg3dModelFilesToGlbWithBackend([small], {
      executionBackend: "direct",
    })).resolves.toHaveLength(1);
    await expect(convertStudioBg3dModelFilesToGlbWithBackend([obj], {
      executionBackend: "direct",
    })).rejects.toMatchObject({
      code: "worker-required",
    });
  });

  it("parses a generated ASCII FBX mesh and reloads its canonical GLB with Three", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const fbx = sourceFile("triangle.fbx", [
      "; FBX 7.4.0 project file",
      "FBXHeaderExtension:  {",
      "\tFBXHeaderVersion: 1003",
      "\tFBXVersion: 7400",
      "}",
      "Objects:  {",
      "\tGeometry: 1, \"Geometry::Triangle\", \"Mesh\" {",
      "\t\tVertices: *9 {",
      "\t\t\ta: 0,0,0,1,0,0,0,1,0",
      "\t\t}",
      "\t\tPolygonVertexIndex: *3 {",
      "\t\t\ta: 0,1,-3",
      "\t\t}",
      "\t}",
      "\tModel: 2, \"Model::Triangle\", \"Mesh\" {",
      "\t\tVersion: 232",
      "\t}",
      "}",
      "Connections:  {",
      "\tC: \"OO\",1,2",
      "\tC: \"OO\",2,0",
      "}",
    ].join("\n"));

    const [converted] = await convertStudioBg3dModelFilesToGlb([fbx]);

    await expectCanonicalTriangleGlb(converted, "triangle.glb");
  });

  it("parses a generated Collada mesh and reloads its canonical GLB with Three", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const { createRequire } = await import("node:module");
    const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
      JSDOM: new () => {
        window: {
          DOMParser: typeof DOMParser;
          close(): void;
        };
      };
    };
    const dom = new JSDOM();
    vi.stubGlobal("DOMParser", dom.window.DOMParser);
    const dae = sourceFile("triangle.dae", [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<COLLADA xmlns=\"http://www.collada.org/2005/11/COLLADASchema\" version=\"1.4.1\">",
      "  <asset>",
      "    <created>2026-01-01T00:00:00Z</created>",
      "    <modified>2026-01-01T00:00:00Z</modified>",
      "    <unit meter=\"1\" name=\"meter\"/>",
      "    <up_axis>Y_UP</up_axis>",
      "  </asset>",
      "  <library_geometries>",
      "    <geometry id=\"triangle-geometry\" name=\"Triangle\">",
      "      <mesh>",
      "        <source id=\"triangle-positions\">",
      "          <float_array id=\"triangle-positions-array\" count=\"9\">0 0 0 1 0 0 0 1 0</float_array>",
      "          <technique_common>",
      "            <accessor source=\"#triangle-positions-array\" count=\"3\" stride=\"3\">",
      "              <param name=\"X\" type=\"float\"/><param name=\"Y\" type=\"float\"/><param name=\"Z\" type=\"float\"/>",
      "            </accessor>",
      "          </technique_common>",
      "        </source>",
      "        <vertices id=\"triangle-vertices\"><input semantic=\"POSITION\" source=\"#triangle-positions\"/></vertices>",
      "        <triangles count=\"1\"><input semantic=\"VERTEX\" source=\"#triangle-vertices\" offset=\"0\"/><p>0 1 2</p></triangles>",
      "      </mesh>",
      "    </geometry>",
      "  </library_geometries>",
      "  <library_visual_scenes>",
      "    <visual_scene id=\"Scene\" name=\"Scene\"><node id=\"Triangle\" name=\"Triangle\"><instance_geometry url=\"#triangle-geometry\"/></node></visual_scene>",
      "  </library_visual_scenes>",
      "  <scene><instance_visual_scene url=\"#Scene\"/></scene>",
      "</COLLADA>",
    ].join("\n"));

    try {
      const [converted] = await convertStudioBg3dModelFilesToGlb([dae]);
      await expectCanonicalTriangleGlb(converted, "triangle.glb");
    } finally {
      dom.window.close();
    }
  });

  it("parses a generated ASCII PLY face and reloads its canonical GLB with Three", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const ply = sourceFile("triangle.ply", [
      "ply",
      "format ascii 1.0",
      "comment generated triangle fixture",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "element face 1",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "3 0 1 2",
    ].join("\n"));

    const [converted] = await convertStudioBg3dModelFilesToGlb([ply]);

    await expectCanonicalTriangleGlb(converted, "triangle.glb");
  });

  it("parses a generated binary 3DS mesh and reloads its canonical GLB with Three", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const tds = sourceFile("triangle.3ds", minimal3dsTriangle());

    const [converted] = await convertStudioBg3dModelFilesToGlb([tds]);

    await expectCanonicalTriangleGlb(converted, "triangle.glb");
  });
});
