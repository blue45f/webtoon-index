import { deflateSync, inflateSync } from "node:zlib";

import { IDBFactory } from "fake-indexeddb";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultStudioVrmSceneDocument,
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
  type StudioVrmSurfacePaintSettings,
} from "./studio-vrm-scene-document";
import {
  createStudioVrmTexturePaintArtifact,
  decodeStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactDecoder,
} from "./studio-vrm-texture-paint-artifact";
import {
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME,
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION,
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
  getStudioVrmTexturePaintLibraryArtifact,
  saveStudioVrmTexturePaintLibraryArtifact,
} from "./studio-vrm-texture-paint-library";
import {
  persistStudioVrmTexturePaintRuntime,
  rehydrateStudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintPersistenceDependencies,
} from "./studio-vrm-texture-paint-persistence";
import {
  createStudioVrmTexturePaintRuntime,
  stampStudioVrmTexturePaintMaterialLocator,
  type StudioVrmTexturePaintCanvasFactory,
  type StudioVrmTexturePaintReadableImage,
  type StudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintRuntimeResult,
} from "./studio-vrm-texture-paint-runtime";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
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

class MemoryCanvas {
  width: number;
  height: number;
  frame: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.frame = new Uint8ClampedArray(width * height * 4);
  }

  readonly context = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: "srgb",
    }),
    putImageData: (imageData: ImageData) => {
      this.frame = Uint8ClampedArray.from(imageData.data);
    },
  };

  getContext(contextId: string) {
    return contextId === "2d" ? this.context : null;
  }

  close() {
    this.width = 0;
    this.height = 0;
  }
}

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

function concat(
  ...parts: readonly Uint8Array<ArrayBufferLike>[]
): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function chunk(
  type: string,
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(data.byteLength + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  output.set(ascii(type), 4);
  output.set(data, 8);
  view.setUint32(
    output.byteLength - 4,
    crc32(output.subarray(4, output.byteLength - 4)),
    false,
  );
  return output;
}

async function encodeValidRgbaPng(
  pixels: Uint8ClampedArray,
  dimensions: Readonly<{ width: number; height: number }>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<Blob> {
  if (options.signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
  const { width, height } = dimensions;
  const rowBytes = width * 4;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || pixels.byteLength !== rowBytes * height
  ) {
    throw new TypeError("invalid PNG fixture input");
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (rowBytes + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(
      pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
      targetOffset + 1,
    );
  }
  const bytes = concat(
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  );
  return new Blob([bytes], { type: "image/png" });
}

const decodeValidRgbaPng: StudioVrmTexturePaintArtifactDecoder = async (
  png,
  metadata,
  context,
) => {
  if (context.signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
  const bytes = new Uint8Array(await png.arrayBuffer());
  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const data = bytes.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0, false);
      height = header.getUint32(4, false);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (width !== metadata.width || height !== metadata.height || idat.length === 0) {
    throw new Error("invalid PNG fixture");
  }
  const inflated = inflateSync(concat(...idat));
  const rowBytes = width * 4;
  if (inflated.byteLength !== (rowBytes + 1) * height) {
    throw new Error("invalid PNG scanlines");
  }
  const pixels = new Uint8ClampedArray(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowBytes + 1);
    if (inflated[sourceOffset] !== 0) throw new Error("unsupported PNG filter");
    pixels.set(
      inflated.subarray(sourceOffset + 1, sourceOffset + rowBytes + 1),
      row * rowBytes,
    );
  }
  return { width, height, data: pixels };
};

function rgba(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(color, offset);
  }
  return pixels;
}

function readable(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): StudioVrmTexturePaintReadableImage {
  return { width, height, data: Uint8ClampedArray.from(pixels) };
}

function unwrap<T>(result: StudioVrmTexturePaintRuntimeResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function createCanvasHarness() {
  const canvases: MemoryCanvas[] = [];
  const createCanvas = vi.fn((width: number, height: number) => {
    const canvas = new MemoryCanvas(width, height);
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  }) satisfies StudioVrmTexturePaintCanvasFactory;
  return { canvases, createCanvas };
}

function createSharedMaterialRuntime(
  originalPixels: Uint8ClampedArray,
): Readonly<{
  runtime: StudioVrmTexturePaintRuntime;
  firstMesh: THREE.Mesh;
  firstMaterial: THREE.MeshBasicMaterial;
  secondMaterial: THREE.MeshBasicMaterial;
  source: THREE.Texture;
  canvases: MemoryCanvas[];
}> {
  const source = new THREE.Texture();
  source.name = "Roundtrip source";
  const firstMaterial = new THREE.MeshBasicMaterial({ map: source });
  const secondMaterial = new THREE.MeshBasicMaterial({ map: source });
  const firstMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), firstMaterial);
  const secondMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), secondMaterial);
  stampStudioVrmTexturePaintMaterialLocator(firstMaterial, 2);
  stampStudioVrmTexturePaintMaterialLocator(secondMaterial, 8);
  const scene = new THREE.Group();
  scene.add(firstMesh, secondMesh);
  const canvas = createCanvasHarness();
  const runtime = createStudioVrmTexturePaintRuntime(scene, {
    createCanvas: canvas.createCanvas,
    readTextureImage: (texture) => {
      if (texture !== source) throw new Error("unexpected source");
      return readable(4, 4, originalPixels);
    },
  });
  return {
    runtime,
    firstMesh,
    firstMaterial,
    secondMaterial,
    source,
    canvases: canvas.canvases,
  };
}

function persistenceDependencies(
  factory: IDBFactory,
): StudioVrmTexturePaintPersistenceDependencies {
  return {
    encodePng: encodeValidRgbaPng,
    createArtifact: createStudioVrmTexturePaintArtifact,
    saveArtifact: (artifact, options) => saveStudioVrmTexturePaintLibraryArtifact(
      artifact,
      { indexedDb: factory, signal: options?.signal },
    ),
    getArtifact: (hash, options) => getStudioVrmTexturePaintLibraryArtifact(
      hash,
      { indexedDb: factory, signal: options?.signal },
    ),
    decodeArtifact: (metadata, source, options) =>
      decodeStudioVrmTexturePaintArtifact(metadata, source, {
        signal: options?.signal,
        dependencies: { decode: decodeValidRgbaPng },
      }),
  };
}

async function openRawDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rawRecords(factory: IDBFactory): Promise<unknown[]> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
      "readonly",
    );
    const request = transaction
      .objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)
      .getAll();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putRawRecord(factory: IDBFactory, value: unknown): Promise<void> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
      "readwrite",
    );
    transaction
      .objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)
      .put(value);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function createPersistedFixture(factory: IDBFactory) {
  const originalPixels = rgba(4, 4, [17, 23, 31, 255]);
  const source = createSharedMaterialRuntime(originalPixels);
  unwrap(await source.runtime.beginStroke({
    pointerId: 91,
    hit: {
      object: source.firstMesh,
      uv: new THREE.Vector2(0.5, 0.5),
      face: { materialIndex: 0 },
      point: new THREE.Vector3(0, 0, 0),
    },
    style: {
      kind: "ink",
      color: "#e23b2f",
      sizeTexels: 3,
      opacity: 1,
      blend: "normal",
      tuning: { flow: 1, hardness: 1, minSize: 1 },
    },
  }));
  unwrap(source.runtime.commitStroke(91));
  const exportedBeforePersist = unwrap(source.runtime.exportPaintedTargets());
  expect(exportedBeforePersist).toHaveLength(1);
  const expectedPixels = exportedBeforePersist[0]!.pixels.slice();
  const deps = persistenceDependencies(factory);
  const settings = await persistStudioVrmTexturePaintRuntime(source.runtime, {
    dependencies: deps,
  });
  expect(unwrap(source.runtime.exportPaintedTargets())[0]!.pixels).toEqual(expectedPixels);
  return { deps, expectedPixels, originalPixels, settings, source };
}

function canonicalSceneSettings(
  settings: StudioVrmSurfacePaintSettings,
): StudioVrmSurfacePaintSettings {
  const serialized = serializeStudioVrmSceneDocument({
    ...createDefaultStudioVrmSceneDocument(),
    surfacePaint: settings,
  });
  expect(serialized).not.toBeNull();
  expect(serialized).not.toMatch(/(?:data:image|blob:|pixels|rgba)/iu);
  const parsed = serialized ? parseStudioVrmSceneDocument(serialized) : null;
  expect(parsed).not.toBeNull();
  if (!parsed) throw new Error("canonical scene");
  return parsed.surfacePaint;
}

describe("VRM texture-paint persistence roundtrip", () => {
  it("roundtrips real PNG bytes through IndexedDB and scene metadata into a fresh runtime", async () => {
    const factory = new IDBFactory();
    const fixture = await createPersistedFixture(factory);

    expect(fixture.settings.textures).toHaveLength(2);
    expect(new Set(fixture.settings.textures.map((texture) => texture.hash)).size).toBe(1);
    expect(fixture.settings.textures.map((texture) => texture.materialLocator)).toEqual([
      "gltf-material:2",
      "gltf-material:8",
    ]);
    const stored = await rawRecords(factory);
    expect(stored).toHaveLength(1);
    expect((stored[0] as { png: Blob }).png).toBeInstanceOf(Blob);

    const existing = await getStudioVrmTexturePaintLibraryArtifact(
      fixture.settings.textures[0]!.hash,
      { indexedDb: factory },
    );
    const duplicateArtifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: fixture.settings.textures[1]!.bindingKey,
      source: existing.archiveEntry.data,
      expectedWidth: 4,
      expectedHeight: 4,
    });
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      duplicateArtifact,
      { indexedDb: factory },
    )).resolves.toMatchObject({ deduplicated: true });
    expect(await rawRecords(factory)).toHaveLength(1);

    const sceneSettings = canonicalSceneSettings(fixture.settings);
    const restored = createSharedMaterialRuntime(fixture.originalPixels);
    const decode = vi.fn(fixture.deps.decodeArtifact);
    const receipt = await rehydrateStudioVrmTexturePaintRuntime(
      restored.runtime,
      sceneSettings,
      {
        dependencies: {
          ...fixture.deps,
          decodeArtifact: decode,
        },
      },
    );

    expect(receipt).toEqual({ artifactCount: 1, bindingCount: 2 });
    expect(decode).toHaveBeenCalledOnce();
    expect(restored.firstMaterial.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(restored.secondMaterial.map).toBe(restored.firstMaterial.map);
    expect(restored.canvases).toHaveLength(1);
    expect(restored.canvases[0]!.frame).toEqual(fixture.expectedPixels);
    expect(restored.runtime.getSnapshot()).toMatchObject({
      targets: [{ bindingCount: 2, width: 4, height: 4 }],
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    const restoredExport = unwrap(restored.runtime.exportPaintedTargets());
    expect(restoredExport).toHaveLength(1);
    expect(restoredExport[0]!.pixels).toEqual(fixture.expectedPixels);
    expect(restoredExport[0]!.bindings).toHaveLength(2);

    restored.runtime.dispose();
    fixture.source.runtime.dispose();
  });

  it("fails closed for missing, tampered, and aborted restore without creating undo history", async () => {
    const factory = new IDBFactory();
    const fixture = await createPersistedFixture(factory);
    const sceneSettings = canonicalSceneSettings(fixture.settings);

    const missingRuntime = createSharedMaterialRuntime(fixture.originalPixels);
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      missingRuntime.runtime,
      sceneSettings,
      { dependencies: persistenceDependencies(new IDBFactory()) },
    )).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });
    expect(missingRuntime.runtime.getSnapshot()).toMatchObject({
      targets: [],
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    expect(missingRuntime.firstMaterial.map).toBe(missingRuntime.source);
    expect(missingRuntime.secondMaterial.map).toBe(missingRuntime.source);

    const [record] = await rawRecords(factory) as Array<{
      contentHash: string;
      receipt: unknown;
      png: Blob;
    }>;
    if (!record) throw new Error("stored record");
    const tamperedPixels = fixture.expectedPixels.slice();
    tamperedPixels[0] = (tamperedPixels[0]! + 1) % 256;
    await putRawRecord(factory, {
      ...record,
      png: await encodeValidRgbaPng(tamperedPixels, { width: 4, height: 4 }),
    });
    const tamperedRuntime = createSharedMaterialRuntime(fixture.originalPixels);
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      tamperedRuntime.runtime,
      sceneSettings,
      { dependencies: fixture.deps },
    )).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    expect(tamperedRuntime.runtime.getSnapshot()).toMatchObject({
      targets: [],
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    expect(tamperedRuntime.canvases).toHaveLength(0);

    const abortedRuntime = createSharedMaterialRuntime(fixture.originalPixels);
    const getArtifact = vi.fn(fixture.deps.getArtifact);
    const controller = new AbortController();
    controller.abort("test");
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      abortedRuntime.runtime,
      sceneSettings,
      {
        signal: controller.signal,
        dependencies: { ...fixture.deps, getArtifact },
      },
    )).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(getArtifact).not.toHaveBeenCalled();
    expect(abortedRuntime.runtime.getSnapshot()).toMatchObject({
      targets: [],
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    expect(abortedRuntime.canvases).toHaveLength(0);

    missingRuntime.runtime.dispose();
    tamperedRuntime.runtime.dispose();
    abortedRuntime.runtime.dispose();
    fixture.source.runtime.dispose();
  });
});
