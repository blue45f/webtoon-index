import { readFileSync } from "node:fs";

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  computeStudioVrmTextureFillMask,
  type StudioVrmTextureFillRequest,
  type StudioVrmTextureFillResult,
} from "./studio-vrm-texture-fill";
import {
  getCachedStudioVrmTextureGeometryIndex,
  getStudioVrmTextureGeometryIndex,
  type StudioVrmTextureGeometryIndex,
} from "./studio-vrm-texture-geometry-index";
import {
  applyStudioVrmTexturePaintOps,
  createStudioVrmTextureBuffer,
} from "./studio-vrm-texture-paint-ops";
import {
  createStudioVrmTexturePaintRuntime,
  estimateStudioVrmTexturePaintTargetResidentBytes,
  STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  stampStudioVrmTexturePaintMaterialLocator,
  type StudioVrmTextureFillRunner,
  type StudioVrmTexturePaintCanvasFactory,
  type StudioVrmTexturePaintGeometryPrecomputer,
  type StudioVrmTexturePaintImageReader,
  type StudioVrmTexturePaintRayHit,
  type StudioVrmTexturePaintReadableImage,
  type StudioVrmTexturePaintRuntimeResult,
} from "./studio-vrm-texture-paint-runtime";
import {
  planStudioVrmTextureStroke,
  type StudioVrmTextureStrokeSample,
  type StudioVrmTextureStrokeStyle,
} from "./studio-vrm-texture-stroke";

class MemoryCanvas {
  width: number;
  height: number;
  frame: Uint8ClampedArray;
  putCount = 0;
  putAttempts = 0;
  dirtyRects: Array<Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null> = [];
  closeCount = 0;
  failAllPuts = false;

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
    putImageData: (
      imageData: ImageData,
      _dx?: number,
      _dy?: number,
      dirtyX?: number,
      dirtyY?: number,
      dirtyWidth?: number,
      dirtyHeight?: number,
    ) => {
      this.putAttempts += 1;
      if (this.failAllPuts) throw new DOMException("Canvas context lost", "InvalidStateError");
      this.frame = Uint8ClampedArray.from(imageData.data);
      this.putCount += 1;
      this.dirtyRects.push(
        dirtyX !== undefined &&
        dirtyY !== undefined &&
        dirtyWidth !== undefined &&
        dirtyHeight !== undefined
          ? { x: dirtyX, y: dirtyY, width: dirtyWidth, height: dirtyHeight }
          : null,
      );
    },
  };

  getContext(contextId: string) {
    return contextId === "2d" ? this.context : null;
  }

  close() {
    this.closeCount += 1;
  }
}

const INK: StudioVrmTextureStrokeStyle = Object.freeze({
  kind: "ink",
  color: "#e23b2f",
  sizeTexels: 3,
  opacity: 1,
  blend: "normal",
  tuning: Object.freeze({ flow: 1, hardness: 1, minSize: 1 }),
});

function rgba(
  width: number,
  height: number,
  color: readonly [number, number, number, number] = [0, 0, 0, 0],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(color, offset);
  }
  return data;
}

function readable(
  width: number,
  height: number,
  data = rgba(width, height),
): StudioVrmTexturePaintReadableImage {
  return { width, height, data: Uint8ClampedArray.from(data) };
}

function unwrap<T>(result: StudioVrmTexturePaintRuntimeResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function expectFailure<T>(
  result: StudioVrmTexturePaintRuntimeResult<T>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failure");
  expect(result.error.code).toBe(code);
}

function hit(
  mesh: THREE.Mesh,
  u = 0.5,
  v = 0.5,
  materialIndex = 0,
  faceIndex?: number,
  point: THREE.Vector3 = new THREE.Vector3(u, v, 0),
): StudioVrmTexturePaintRayHit {
  return {
    object: mesh,
    uv: new THREE.Vector2(u, v),
    face: { materialIndex },
    ...(faceIndex === undefined ? {} : { faceIndex }),
    point,
  };
}

function canvasHarness() {
  const canvases: MemoryCanvas[] = [];
  const createCanvas = vi.fn((width: number, height: number) => {
    const canvas = new MemoryCanvas(width, height);
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  }) satisfies StudioVrmTexturePaintCanvasFactory;
  return { canvases, createCanvas };
}

function imageReader(
  images: ReadonlyMap<THREE.Texture, StudioVrmTexturePaintReadableImage>,
): StudioVrmTexturePaintImageReader {
  return vi.fn((texture: THREE.Texture) => {
    const image = images.get(texture);
    if (!image) throw new Error("Missing test image");
    return readable(image.width, image.height, image.data);
  });
}

function deferredImageReader() {
  let observedSignal: AbortSignal | null = null;
  let resolveRead: ((image: StudioVrmTexturePaintReadableImage) => void) | null = null;
  const reader = vi.fn((
    _texture: THREE.Texture,
    signal: AbortSignal,
  ) => new Promise<StudioVrmTexturePaintReadableImage>((resolve, reject) => {
    observedSignal = signal;
    resolveRead = resolve;
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Cancelled", "AbortError")),
      { once: true },
    );
  })) satisfies StudioVrmTexturePaintImageReader;
  return {
    reader,
    get signal(): AbortSignal | null {
      return observedSignal;
    },
    resolve(image: StudioVrmTexturePaintReadableImage): void {
      if (!resolveRead) throw new Error("Deferred image reader has not started");
      resolveRead(image);
    },
  };
}

function fillResultForPositions(
  width: number,
  height: number,
  positions: readonly number[],
  seedRgba: StudioVrmTextureFillResult["seedRgba"] = [0, 0, 0, 0],
): StudioVrmTextureFillResult {
  const bitMask = new Uint8Array(Math.ceil((width * height) / 8));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const position of positions) {
    bitMask[position >>> 3] = bitMask[position >>> 3]! | (1 << (position & 7));
    const x = position % width;
    const y = Math.floor(position / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    bitMask,
    bounds: positions.length === 0
      ? null
      : {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
    },
    matchedCount: positions.length,
    seedRgba,
  };
}

function deferredFillRunner() {
  let resolveRun:
    | ((value: Awaited<ReturnType<StudioVrmTextureFillRunner>>) => void)
    | null = null;
  let rejectRun: ((reason?: unknown) => void) | null = null;
  let observedRequest: StudioVrmTextureFillRequest | null = null;
  let observedSignal: AbortSignal | undefined;
  const runner = vi.fn<StudioVrmTextureFillRunner>((request, options) => {
    observedRequest = request;
    observedSignal = options?.signal;
    return new Promise((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
  });
  return {
    runner,
    get request(): StudioVrmTextureFillRequest | null {
      return observedRequest;
    },
    get signal(): AbortSignal | undefined {
      return observedSignal;
    },
    resolve(result: StudioVrmTextureFillResult): void {
      if (!resolveRun) throw new Error("Deferred fill runner has not started");
      resolveRun({ execution: "worker", result });
    },
    reject(error: unknown): void {
      if (!rejectRun) throw new Error("Deferred fill runner has not started");
      rejectRun(error);
    },
  };
}

function meshWithMap(texture: THREE.Texture) {
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  return { material, mesh };
}

function connectedLargeGeometry(triangleCount = 4_097): THREE.BufferGeometry {
  const positions = new Float32Array(triangleCount * 9);
  const uvs = new Float32Array(triangleCount * 6);
  const writeTriangle = (
    faceIndex: number,
    vertices: readonly [
      number, number, number,
      number, number, number,
      number, number, number,
    ],
    textureCoordinates: readonly [number, number, number, number, number, number],
  ) => {
    positions.set(vertices, faceIndex * 9);
    uvs.set(textureCoordinates, faceIndex * 6);
  };
  writeTriangle(
    0,
    [0, 0, 0, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 0, 1, 1],
  );
  writeTriangle(
    1,
    [0, 0, 0, 1, 1, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1],
  );
  for (let faceIndex = 2; faceIndex < triangleCount; faceIndex += 1) {
    const x = faceIndex * 2;
    writeTriangle(
      faceIndex,
      [x, 0, 0, x + 1, 0, 0, x, 1, 0],
      [0, 0, 1, 0, 0, 1],
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

describe("Studio VRM texture-paint runtime", () => {
  it("fails closed when a frozen custom material rejects a stable locator stamp", () => {
    const material = new THREE.MeshBasicMaterial();
    Object.freeze(material.userData);

    expect(() => stampStudioVrmTexturePaintMaterialLocator(material, 2)).not.toThrow();
    expect(stampStudioVrmTexturePaintMaterialLocator(material, 2)).toBeNull();
  });

  it("leaves texture bytes, dirty uploads, revision, and Undo untouched for the legacy brush", async () => {
    const source = new THREE.Texture();
    source.flipY = false;
    const sourcePixels = rgba(8, 8, [17, 23, 31, 255]);
    const sourcePixelsBefore = sourcePixels.slice();
    const scene = new THREE.Group();
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const reader = imageReader(new Map([[source, readable(8, 8, sourcePixels)]]));
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: reader,
    });
    const beginStroke = vi.spyOn(runtime, "beginStroke");
    const contentRevisionBefore = runtime.getContentRevision();
    const textureVersionBefore = source.version;
    const snapshotBefore = runtime.getSnapshot();
    const exportedBefore = unwrap(runtime.exportPaintedTargets());

    const attemptProductBrush = async (tool: "surface-brush" | "brush") => {
      if (tool === "brush") return;
      unwrap(await runtime.beginStroke({ pointerId: 91, hit: hit(mesh), style: INK }));
      unwrap(runtime.commitStroke(91));
    };

    await attemptProductBrush("brush");

    expect(beginStroke).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(canvas.createCanvas).not.toHaveBeenCalled();
    expect(canvas.canvases).toEqual([]);
    expect(material.map).toBe(source);
    expect(source.version).toBe(textureVersionBefore);
    expect(sourcePixels).toEqual(sourcePixelsBefore);
    expect(runtime.getContentRevision()).toBe(contentRevisionBefore);
    expect(runtime.getSnapshot()).toEqual(snapshotBefore);
    expect(runtime.getSnapshot().history).toMatchObject({
      undoCount: 0,
      redoCount: 0,
      retainedBytes: 0,
    });
    expect(unwrap(runtime.exportPaintedTargets())).toEqual(exportedBefore);
  });

  describe("base-color eyedropper", () => {
    it("samples an unprepared source without creating a target, history, or content revision", async () => {
      const source = new THREE.Texture();
      source.name = "Palette";
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const pixels = Uint8ClampedArray.from([
        10, 20, 30, 40,
        50, 60, 70, 80,
        90, 100, 110, 120,
        130, 140, 150, 160,
      ]);
      const canvas = canvasHarness();
      const reader = imageReader(new Map([[source, readable(2, 2, pixels)]]));
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: reader,
      });
      const revisionBefore = runtime.getContentRevision();

      const sampled = unwrap(await runtime.sampleBaseColor({
        hit: hit(mesh, 0.25, 0.25),
      }));

      expect(sampled).toEqual({
        color: "#0a141e",
        rgba: { r: 10, g: 20, b: 30, a: 40 },
        texel: { x: 0, y: 0 },
        sourceTextureUuid: source.uuid,
        sourceName: "Palette",
        targetId: null,
      });
      expect(reader).toHaveBeenCalledOnce();
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(material.map).toBe(source);
      expect(runtime.getContentRevision()).toBe(revisionBefore);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "idle",
        activeTarget: null,
        activeTargetId: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: null,
      });
      expect(unwrap(runtime.exportPaintedTargets())).toEqual([]);
    });

    it("samples the latest prepared editable pixels without changing history or revision", async () => {
      const source = new THREE.Texture();
      source.name = "Coat";
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      const binding = stampStudioVrmTexturePaintMaterialLocator(material, 5);
      if (!binding) throw new Error("binding");
      scene.add(mesh);
      const original = rgba(2, 2, [1, 2, 3, 255]);
      const painted = Uint8ClampedArray.from([
        7, 8, 9, 10,
        21, 22, 23, 24,
        31, 32, 33, 34,
        41, 42, 43, 44,
      ]);
      const canvas = canvasHarness();
      const reader = imageReader(new Map([[source, readable(2, 2, original)]]));
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: reader,
      });
      unwrap(await runtime.rehydrateTarget({
        binding,
        image: readable(2, 2, painted),
      }));
      const revisionBefore = runtime.getContentRevision();
      const historyBefore = runtime.getSnapshot().history;

      const sampled = unwrap(await runtime.sampleBaseColor({
        hit: hit(mesh, 0.25, 0.25),
      }));

      expect(sampled).toMatchObject({
        color: "#070809",
        rgba: { r: 7, g: 8, b: 9, a: 10 },
        texel: { x: 0, y: 0 },
        targetId: `vrm-texture:${source.uuid}`,
      });
      expect(reader).toHaveBeenCalledOnce();
      expect(canvas.canvases[0]?.frame).toEqual(painted);
      expect(runtime.getContentRevision()).toBe(revisionBefore);
      expect(runtime.getSnapshot().history).toEqual(historyBefore);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "ready",
        activeTargetId: `vrm-texture:${source.uuid}`,
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: null,
      });
    });

    it("uses uv1 when the base-color texture selects channel one", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      source.channel = 1;
      const scene = new THREE.Group();
      const { mesh } = meshWithMap(source);
      scene.add(mesh);
      const pixels = Uint8ClampedArray.from([
        11, 12, 13, 14,
        21, 22, 23, 24,
        31, 32, 33, 34,
        41, 42, 43, 44,
      ]);
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        readTextureImage: imageReader(new Map([[source, readable(2, 2, pixels)]])),
      });

      const sampled = unwrap(await runtime.sampleBaseColor({
        hit: {
          object: mesh,
          uv: new THREE.Vector2(0.75, 0.75),
          uv1: new THREE.Vector2(0.25, 0.25),
          face: { materialIndex: 0 },
        },
      }));

      expect(sampled).toMatchObject({
        color: "#0b0c0d",
        rgba: { r: 11, g: 12, b: 13, a: 14 },
        texel: { x: 0, y: 0 },
      });
    });

    it("applies the texture matrix before independent repeat-U and mirrored-V wrapping", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      source.wrapS = THREE.RepeatWrapping;
      source.wrapT = THREE.MirroredRepeatWrapping;
      source.matrixAutoUpdate = false;
      source.matrix.set(
        1, 0, 0.5,
        0, 1, 0,
        0, 0, 1,
      );
      const scene = new THREE.Group();
      const { mesh } = meshWithMap(source);
      scene.add(mesh);
      const pixels = Uint8ClampedArray.from([
        10, 20, 30, 40,
        50, 60, 70, 80,
        90, 100, 110, 120,
        130, 140, 150, 160,
      ]);
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        readTextureImage: imageReader(new Map([[source, readable(2, 2, pixels)]])),
      });

      const sampled = unwrap(await runtime.sampleBaseColor({
        hit: hit(mesh, 0.75, 1.25),
      }));

      expect(sampled).toMatchObject({
        color: "#5a646e",
        rgba: { r: 90, g: 100, b: 110, a: 120 },
        texel: { x: 0, y: 1 },
      });
    });

    it("normalizes flipY source rows before resolving the sampled texel", async () => {
      const source = new THREE.Texture();
      source.flipY = true;
      const scene = new THREE.Group();
      const { mesh } = meshWithMap(source);
      scene.add(mesh);
      const pixels = Uint8ClampedArray.from([
        200, 10, 20, 255,
        20, 30, 220, 128,
      ]);
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        readTextureImage: imageReader(new Map([[source, readable(1, 2, pixels)]])),
      });

      const sampled = unwrap(await runtime.sampleBaseColor({
        hit: hit(mesh, 0.5, 0.25),
      }));

      expect(sampled).toMatchObject({
        color: "#141edc",
        rgba: { r: 20, g: 30, b: 220, a: 128 },
        texel: { x: 0, y: 0 },
      });
    });

    it("fails closed for pre-aborted and in-flight aborted source reads", async () => {
      const preAbortedSource = new THREE.Texture();
      preAbortedSource.flipY = false;
      const preAbortedScene = new THREE.Group();
      const preAbortedMesh = meshWithMap(preAbortedSource);
      preAbortedScene.add(preAbortedMesh.mesh);
      const preAbortedReader = vi.fn(() => readable(2, 2));
      const preAbortedRuntime = createStudioVrmTexturePaintRuntime(preAbortedScene, {
        readTextureImage: preAbortedReader,
      });
      const preAbortedController = new AbortController();
      preAbortedController.abort();

      expectFailure(await preAbortedRuntime.sampleBaseColor({
        hit: hit(preAbortedMesh.mesh),
        signal: preAbortedController.signal,
      }), "source-read-aborted");
      expect(preAbortedReader).not.toHaveBeenCalled();

      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const deferred = deferredImageReader();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        readTextureImage: deferred.reader,
      });
      const controller = new AbortController();
      const pending = runtime.sampleBaseColor({
        hit: hit(mesh),
        signal: controller.signal,
      });
      expect(runtime.getSnapshot()).toMatchObject({ status: "loading", activePointerId: null });

      controller.abort();

      expectFailure(await pending, "source-read-aborted");
      expect(deferred.signal?.aborted).toBe(true);
      expect(material.map).toBe(source);
      expect(runtime.getContentRevision()).toBe(0);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "idle",
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: { code: "source-read-aborted" },
      });
    });

    const staleMutations: ReadonlyArray<readonly [
      string,
      (context: {
        readonly material: THREE.MeshBasicMaterial;
        readonly source: THREE.Texture;
      }) => void,
    ]> = [
      [
        "material map",
        ({ material }) => {
          material.map = new THREE.Texture();
        },
      ],
      [
        "texture transform",
        ({ source }) => {
          source.offset.set(0.25, 0.125);
        },
      ],
      [
        "image identity",
        ({ source }) => {
          source.image = { width: 2, height: 2, generation: 2 };
        },
      ],
      [
        "texture version",
        ({ source }) => {
          source.needsUpdate = true;
        },
      ],
      [
        "sampler flags",
        ({ source }) => {
          source.wrapS = THREE.RepeatWrapping;
          source.flipY = true;
        },
      ],
    ];

    it.each(staleMutations)(
      "rejects a stale asynchronous sample after %s changes",
      async (_label, mutate) => {
        const source = new THREE.Texture();
        source.flipY = false;
        const scene = new THREE.Group();
        const { material, mesh } = meshWithMap(source);
        scene.add(mesh);
        const deferred = deferredImageReader();
        const runtime = createStudioVrmTexturePaintRuntime(scene, {
          readTextureImage: deferred.reader,
        });
        const pending = runtime.sampleBaseColor({
          hit: hit(mesh, 0.25, 0.25),
        });

        mutate({ material, source });
        deferred.resolve(readable(2, 2, rgba(2, 2, [9, 8, 7, 255])));

        expectFailure(await pending, "source-changed");
        expect(runtime.getContentRevision()).toBe(0);
        expect(runtime.getSnapshot()).toMatchObject({
          status: "idle",
          activeTarget: null,
          targets: [],
          history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
          error: { code: "source-changed" },
        });
      },
    );

    it("serializes mutations behind sampling and aborts the reader on dispose", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const deferred = deferredImageReader();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        readTextureImage: deferred.reader,
      });
      const pending = runtime.sampleBaseColor({ hit: hit(mesh) });

      expect(runtime.getSnapshot()).toMatchObject({ status: "loading" });
      expectFailure(runtime.exportPaintedTargets(), "pointer-active");
      expectFailure(runtime.undo(), "pointer-active");
      expectFailure(runtime.redo(), "pointer-active");
      expectFailure(runtime.resetActiveTarget(), "pointer-active");
      expectFailure(await runtime.beginStroke({
        pointerId: 90,
        hit: hit(mesh),
        style: INK,
      }), "pointer-active");

      runtime.dispose();

      expect(deferred.signal?.aborted).toBe(true);
      expectFailure(await pending, "disposed");
      expect(material.map).toBe(source);
      expect(runtime.getContentRevision()).toBe(0);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "disposed",
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
      });
    });
  });

  describe("base-color ColorDrop", () => {
    it("fills a prepared contiguous selection, preserves alpha, and records one atomic undo step", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      const binding = stampStudioVrmTexturePaintMaterialLocator(material, 0);
      if (!binding) throw new Error("binding");
      scene.add(mesh);
      const original = Uint8ClampedArray.from([
        1, 2, 3, 10,
        250, 200, 150, 20,
        90, 80, 70, 30,
        0, 255, 0, 40,
      ]);
      const canvas = canvasHarness();
      const reader = imageReader(new Map([[source, readable(2, 2, original)]]));
      const runTextureFill = vi.fn<StudioVrmTextureFillRunner>(async (request) => ({
        execution: "worker",
        result: computeStudioVrmTextureFillMask(request),
      }));
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: reader,
        runTextureFill,
      });
      unwrap(await runtime.rehydrateTarget({
        binding,
        image: readable(2, 2, original),
      }));
      const revisionBefore = runtime.getContentRevision();

      expect(unwrap(await runtime.fillBaseColor({
        hit: hit(mesh, 0.25, 0.25),
        color: "#a1b2c3",
        tolerance: 255,
        scope: "contiguous",
      }))).toBe(true);

      expect(reader).toHaveBeenCalledOnce();
      expect(runTextureFill).toHaveBeenCalledOnce();
      expect(runTextureFill.mock.calls[0]?.[0]).toMatchObject({
        width: 2,
        height: 2,
        seed: { x: 0, y: 0 },
        tolerance: 255,
        scope: "contiguous",
      });
      const filled = Uint8ClampedArray.from(original);
      for (let offset = 0; offset < filled.length; offset += 4) {
        filled.set([0xa1, 0xb2, 0xc3], offset);
      }
      expect(canvas.canvases[0]?.frame).toEqual(filled);
      expect([
        canvas.canvases[0]?.frame[3],
        canvas.canvases[0]?.frame[7],
        canvas.canvases[0]?.frame[11],
        canvas.canvases[0]?.frame[15],
      ]).toEqual([10, 20, 30, 40]);
      expect(canvas.canvases[0]?.dirtyRects.at(-1)).toEqual({
        x: 0,
        y: 0,
        width: 2,
        height: 2,
      });
      const historyAfterFill = runtime.getSnapshot().history;
      expect(historyAfterFill).toMatchObject({
        undoCount: 1,
        redoCount: 0,
      });
      expect(historyAfterFill.retainedBytes).toBeGreaterThan(0);
      expect(runtime.getContentRevision()).toBe(revisionBefore + 1);

      expect(unwrap(runtime.undo())).toBe(true);
      expect(canvas.canvases[0]?.frame).toEqual(original);
      expect(runtime.getSnapshot().history).toMatchObject({
        undoCount: 0,
        redoCount: 1,
        retainedBytes: historyAfterFill.retainedBytes,
      });
      expect(unwrap(runtime.redo())).toBe(true);
      expect(canvas.canvases[0]?.frame).toEqual(filled);
      expect(runtime.getSnapshot().history).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        retainedBytes: historyAfterFill.retainedBytes,
      });
      expect(runtime.getContentRevision()).toBe(revisionBefore + 3);
    });

    it("fills non-contiguous matches across the whole material", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const original = Uint8ClampedArray.from([
        10, 20, 30, 101,
        70, 80, 90, 102,
        100, 110, 120, 103,
        10, 20, 30, 101,
      ]);
      const canvas = canvasHarness();
      const runTextureFill = vi.fn<StudioVrmTextureFillRunner>(async (request) => ({
        execution: "worker",
        result: computeStudioVrmTextureFillMask(request),
      }));
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2, original)]])),
        runTextureFill,
      });

      expect(unwrap(await runtime.fillBaseColor({
        hit: hit(mesh, 0.25, 0.25),
        color: "#112233",
        tolerance: 0,
        scope: "whole-material",
      }))).toBe(true);

      expect(runTextureFill.mock.calls[0]?.[0]).toMatchObject({
        seed: { x: 0, y: 0 },
        tolerance: 0,
        scope: "whole-material",
      });
      expect(canvas.canvases[0]?.frame).toEqual(Uint8ClampedArray.from([
        0x11, 0x22, 0x33, 101,
        70, 80, 90, 102,
        100, 110, 120, 103,
        0x11, 0x22, 0x33, 101,
      ]));
      expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
      expect(runtime.getSnapshot()).toMatchObject({
        activeOperation: null,
        history: { undoCount: 1, redoCount: 0 },
        targets: [expect.objectContaining({ width: 2, height: 2 })],
      });
    });

    it("keeps an unprepared source unbound until Worker success and gates every competing mutation", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      const binding = stampStudioVrmTexturePaintMaterialLocator(material, 3);
      if (!binding) throw new Error("binding");
      scene.add(mesh);
      const canvas = canvasHarness();
      const deferred = deferredFillRunner();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[
          source,
          readable(2, 2, rgba(2, 2, [10, 20, 30, 255])),
        ]])),
        runTextureFill: deferred.runner,
      });
      const pending = runtime.fillBaseColor({
        hit: hit(mesh, 0.25, 0.25),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      });
      await vi.waitFor(() => expect(deferred.runner).toHaveBeenCalledOnce());

      expect(deferred.request).toMatchObject({
        width: 2,
        height: 2,
        seed: { x: 0, y: 0 },
      });
      expect(material.map).toBe(source);
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(runtime.getSnapshot()).toMatchObject({
        status: "loading",
        activeOperation: "fill",
        activePointerId: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
      });
      expectFailure(runtime.exportPaintedTargets(), "pointer-active");
      expectFailure(runtime.undo(), "pointer-active");
      expectFailure(runtime.redo(), "pointer-active");
      expectFailure(runtime.resetActiveTarget(), "pointer-active");
      expectFailure(await runtime.sampleBaseColor({ hit: hit(mesh) }), "pointer-active");
      expectFailure(await runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#ffffff",
        tolerance: 0,
        scope: "contiguous",
      }), "pointer-active");
      expectFailure(await runtime.beginStroke({
        pointerId: 501,
        hit: hit(mesh),
        style: INK,
      }), "pointer-active");
      expectFailure(await runtime.rehydrateTarget({
        binding,
        image: readable(2, 2),
      }), "pointer-active");

      deferred.resolve(fillResultForPositions(2, 2, [0], [10, 20, 30, 255]));

      expect(unwrap(await pending)).toBe(true);
      expect(canvas.createCanvas).toHaveBeenCalledOnce();
      expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "ready",
        activeOperation: null,
        activePointerId: null,
        history: { undoCount: 1, redoCount: 0 },
        error: null,
      });
    });

    it("does not allocate, bind, revise, or record history for an RGB no-op", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const canvas = canvasHarness();
      const runTextureFill = vi.fn<StudioVrmTextureFillRunner>(async () => ({
        execution: "worker",
        result: fillResultForPositions(2, 2, [0, 1, 2, 3], [0x11, 0x22, 0x33, 77]),
      }));
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[
          source,
          readable(2, 2, rgba(2, 2, [0x11, 0x22, 0x33, 77])),
        ]])),
        runTextureFill,
      });

      expect(unwrap(await runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#112233",
        tolerance: 32,
        scope: "contiguous",
      }))).toBe(false);

      expect(runTextureFill).toHaveBeenCalledOnce();
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(material.map).toBe(source);
      expect(runtime.getContentRevision()).toBe(0);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "idle",
        activeOperation: null,
        activeTarget: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: null,
      });
    });

    it.each([
      [
        "unavailable",
        () => new DOMException("Worker unavailable", "NotSupportedError"),
        "fill-worker-unavailable",
      ],
      [
        "runtime failure",
        () => new Error("Worker crashed"),
        "fill-worker-failed",
      ],
    ] as const)(
      "fails closed on Worker %s without creating an unprepared target",
      async (_label, createError, expectedCode) => {
        const source = new THREE.Texture();
        source.flipY = false;
        const scene = new THREE.Group();
        const { material, mesh } = meshWithMap(source);
        scene.add(mesh);
        const canvas = canvasHarness();
        const runTextureFill = vi.fn<StudioVrmTextureFillRunner>(async () => {
          throw createError();
        });
        const runtime = createStudioVrmTexturePaintRuntime(scene, {
          createCanvas: canvas.createCanvas,
          readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
          runTextureFill,
        });

        expectFailure(await runtime.fillBaseColor({
          hit: hit(mesh),
          color: "#abcdef",
          tolerance: 0,
          scope: "contiguous",
        }), expectedCode);
        expect(runTextureFill).toHaveBeenCalledOnce();
        expect(canvas.createCanvas).not.toHaveBeenCalled();
        expect(material.map).toBe(source);
        expect(runtime.getSnapshot()).toMatchObject({
          status: "idle",
          activeOperation: null,
          targets: [],
          history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
          error: { code: expectedCode },
        });
      },
    );

    it("propagates caller abort to the Worker and releases the fill gate", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const canvas = canvasHarness();
      const deferred = deferredFillRunner();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
        runTextureFill: deferred.runner,
      });
      const controller = new AbortController();
      const pending = runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(deferred.runner).toHaveBeenCalledOnce());

      controller.abort();
      expect(deferred.signal?.aborted).toBe(true);
      deferred.reject(new DOMException("Cancelled", "AbortError"));

      expectFailure(await pending, "source-read-aborted");
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(material.map).toBe(source);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "idle",
        activeOperation: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0 },
      });
    });

    it("aborts a non-cooperative Worker on dispose and quarantines its late success", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const canvas = canvasHarness();
      const deferred = deferredFillRunner();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
        runTextureFill: deferred.runner,
      });
      const pending = runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      });
      await vi.waitFor(() => expect(deferred.runner).toHaveBeenCalledOnce());

      runtime.dispose();
      expect(deferred.signal?.aborted).toBe(true);
      deferred.resolve(fillResultForPositions(2, 2, [0]));

      expectFailure(await pending, "disposed");
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(material.map).toBe(source);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "disposed",
        activeOperation: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0 },
      });
    });

    it("keeps a disposed snapshot clean when a cooperative Worker rejects on abort", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const deferred = deferredFillRunner();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvasHarness().createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
        runTextureFill: deferred.runner,
      });
      const pending = runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      });
      await vi.waitFor(() => expect(deferred.runner).toHaveBeenCalledOnce());

      runtime.dispose();
      deferred.reject(new DOMException("Cancelled", "AbortError"));

      expectFailure(await pending, "disposed");
      expect(material.map).toBe(source);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "disposed",
        activeOperation: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: null,
      });
    });

    it("rejects stale material identity and content revision after Worker completion", async () => {
      const staleSource = new THREE.Texture();
      staleSource.flipY = false;
      const staleScene = new THREE.Group();
      const staleTarget = meshWithMap(staleSource);
      staleScene.add(staleTarget.mesh);
      const staleCanvas = canvasHarness();
      const staleDeferred = deferredFillRunner();
      const staleRuntime = createStudioVrmTexturePaintRuntime(staleScene, {
        createCanvas: staleCanvas.createCanvas,
        readTextureImage: imageReader(new Map([[staleSource, readable(2, 2)]])),
        runTextureFill: staleDeferred.runner,
      });
      const stalePending = staleRuntime.fillBaseColor({
        hit: hit(staleTarget.mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      });
      await vi.waitFor(() => expect(staleDeferred.runner).toHaveBeenCalledOnce());
      const replacement = new THREE.Texture();
      staleTarget.material.map = replacement;
      staleDeferred.resolve(fillResultForPositions(2, 2, [0]));

      expectFailure(await stalePending, "source-changed");
      expect(staleCanvas.createCanvas).not.toHaveBeenCalled();
      expect(staleTarget.material.map).toBe(replacement);
      expect(staleRuntime.getSnapshot()).toMatchObject({
        targets: [],
        history: { undoCount: 0, redoCount: 0 },
      });

      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      const binding = stampStudioVrmTexturePaintMaterialLocator(material, 9);
      if (!binding) throw new Error("binding");
      scene.add(mesh);
      const original = rgba(2, 2, [5, 6, 7, 200]);
      const canvas = canvasHarness();
      const deferred = deferredFillRunner();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2, original)]])),
        runTextureFill: deferred.runner,
      });
      unwrap(await runtime.rehydrateTarget({
        binding,
        image: readable(2, 2, original),
      }));
      const frameBefore = Uint8ClampedArray.from(canvas.canvases[0]!.frame);
      const pending = runtime.fillBaseColor({
        hit: hit(mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      });
      await vi.waitFor(() => expect(deferred.runner).toHaveBeenCalledOnce());
      const internal = runtime as unknown as { contentRevision: number };
      internal.contentRevision += 1;
      deferred.resolve(fillResultForPositions(2, 2, [0]));

      expectFailure(await pending, "source-changed");
      expect(canvas.canvases[0]?.frame).toEqual(frameBefore);
      expect(runtime.getSnapshot()).toMatchObject({
        activeOperation: null,
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: { code: "source-changed" },
      });
    });

    it("enforces transient and atomic history budgets before any target mutation", async () => {
      const transientSource = new THREE.Texture();
      transientSource.flipY = false;
      transientSource.image = { width: 4, height: 4 };
      const transientScene = new THREE.Group();
      const transientTarget = meshWithMap(transientSource);
      transientScene.add(transientTarget.mesh);
      const transientReader = vi.fn(() => readable(4, 4));
      const transientRunner = vi.fn<StudioVrmTextureFillRunner>(async () => ({
        execution: "worker",
        result: fillResultForPositions(4, 4, [0]),
      }));
      const transientCanvas = canvasHarness();
      const transientRuntime = createStudioVrmTexturePaintRuntime(transientScene, {
        createCanvas: transientCanvas.createCanvas,
        maxAggregateResidentBytes: 1,
        readTextureImage: transientReader,
        runTextureFill: transientRunner,
      });

      expectFailure(await transientRuntime.fillBaseColor({
        hit: hit(transientTarget.mesh),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      }), "fill-memory-budget");
      expect(transientReader).not.toHaveBeenCalled();
      expect(transientRunner).not.toHaveBeenCalled();
      expect(transientCanvas.createCanvas).not.toHaveBeenCalled();
      expect(transientTarget.material.map).toBe(transientSource);

      const historySource = new THREE.Texture();
      historySource.flipY = false;
      const historyScene = new THREE.Group();
      const historyTarget = meshWithMap(historySource);
      historyScene.add(historyTarget.mesh);
      const historyCanvas = canvasHarness();
      const historyRuntime = createStudioVrmTexturePaintRuntime(historyScene, {
        createCanvas: historyCanvas.createCanvas,
        maxHistoryBytes: 1,
        readTextureImage: imageReader(new Map([[historySource, readable(2, 2)]])),
        runTextureFill: vi.fn(async () => ({
          execution: "worker" as const,
          result: fillResultForPositions(2, 2, [0]),
        })),
      });

      expectFailure(await historyRuntime.fillBaseColor({
        hit: hit(historyTarget.mesh, 0.25, 0.25),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      }), "history-budget");
      expect(historyCanvas.createCanvas).not.toHaveBeenCalled();
      expect(historyTarget.material.map).toBe(historySource);
      expect(historyRuntime.getSnapshot()).toMatchObject({
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
      });
    });

    it.each([
      {
        label: "mask byte length",
        result: {
          ...fillResultForPositions(2, 2, [0]),
          bitMask: new Uint8Array(2),
        },
      },
      {
        label: "matched count",
        result: {
          ...fillResultForPositions(2, 2, [0]),
          matchedCount: 2,
        },
      },
      {
        label: "out-of-range bounds",
        result: {
          ...fillResultForPositions(2, 2, [0]),
          bounds: { x: 1, y: 0, width: 2, height: 1 },
        },
      },
      {
        label: "missing seed RGBA tuple",
        result: {
          ...fillResultForPositions(2, 2, [0]),
          seedRgba: undefined,
        } as unknown as StudioVrmTextureFillResult,
      },
      {
        label: "set bit outside declared bounds",
        result: {
          ...fillResultForPositions(2, 2, [0, 3]),
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          matchedCount: 1,
        },
      },
      {
        label: "padding bit past the texture end",
        result: {
          ...fillResultForPositions(2, 2, [0]),
          bitMask: Uint8Array.of(0b1000_0001),
        },
      },
    ] satisfies ReadonlyArray<{
      readonly label: string;
      readonly result: StudioVrmTextureFillResult;
    }>)("rejects malformed Worker $label without binding a target", async ({ result }) => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      const canvas = canvasHarness();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
        runTextureFill: vi.fn(async () => ({
          execution: "worker" as const,
          result,
        })),
      });

      expectFailure(await runtime.fillBaseColor({
        hit: hit(mesh, 0.25, 0.25),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      }), "fill-worker-failed");
      expect(canvas.createCanvas).not.toHaveBeenCalled();
      expect(material.map).toBe(source);
      expect(runtime.getSnapshot()).toMatchObject({
        activeOperation: null,
        targets: [],
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
        error: { code: "fill-worker-failed" },
      });
    });

    it("rolls back a custom material map setter that stores the painted map before throwing", async () => {
      const source = new THREE.Texture();
      source.flipY = false;
      const scene = new THREE.Group();
      const { material, mesh } = meshWithMap(source);
      scene.add(mesh);
      let backingMap: THREE.Texture | null = source;
      let throwAfterNextAssignment = true;
      Object.defineProperty(material, "map", {
        configurable: true,
        get: () => backingMap,
        set: (next: THREE.Texture | null) => {
          backingMap = next;
          if (throwAfterNextAssignment) {
            throwAfterNextAssignment = false;
            throw new Error("hostile map setter");
          }
        },
      });
      const canvas = canvasHarness();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(2, 2)]])),
        runTextureFill: vi.fn(async () => ({
          execution: "worker" as const,
          result: fillResultForPositions(2, 2, [0]),
        })),
      });

      expectFailure(await runtime.fillBaseColor({
        hit: hit(mesh, 0.25, 0.25),
        color: "#abcdef",
        tolerance: 0,
        scope: "contiguous",
      }), "source-changed");

      expect(material.map).toBe(source);
      expect(backingMap).toBe(source);
      expect(canvas.canvases[0]?.closeCount).toBe(1);
      expect(runtime.getSnapshot()).toMatchObject({
        targets: [],
        aggregateRgbaBytes: 0,
        aggregateTargetResidentBytes: 0,
        history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
      });
    });
  });

  it("exports only changed targets with stable sorted glTF bindings and exact RGBA", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.name = "Shared";
    const first = meshWithMap(source);
    const second = meshWithMap(source);
    stampStudioVrmTexturePaintMaterialLocator(first.material, 8);
    stampStudioVrmTexturePaintMaterialLocator(second.material, 2);
    scene.add(first.mesh, second.mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(8, 8)]])),
    });

    expect(unwrap(runtime.exportPaintedTargets())).toEqual([]);
    unwrap(await runtime.beginStroke({
      pointerId: 61,
      hit: hit(first.mesh, 0.4, 0.6),
      style: INK,
    }));
    unwrap(runtime.commitStroke(61));

    const exported = unwrap(runtime.exportPaintedTargets());
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      width: 8,
      height: 8,
      bindings: [
        {
          bindingKey: "gltf-material-2-baseColor",
          materialLocator: "gltf-material:2",
          textureSlot: "baseColor",
        },
        {
          bindingKey: "gltf-material-8-baseColor",
          materialLocator: "gltf-material:8",
          textureSlot: "baseColor",
        },
      ],
    });
    expect(exported[0]!.pixels).toEqual(canvas.canvases[0]!.frame);
    exported[0]!.pixels.fill(0);
    expect(canvas.canvases[0]!.frame.some((channel) => channel > 0)).toBe(true);

    unwrap(runtime.undo());
    expect(unwrap(runtime.exportPaintedTargets())).toEqual([]);
  });

  it("rehydrates persisted pixels by stable material locator without creating undo history", async () => {
    const source = new THREE.Texture();
    const original = rgba(8, 8, [17, 23, 31, 255]);
    const painted = rgba(8, 8, [210, 90, 40, 255]);
    const scene = new THREE.Group();
    const { material, mesh } = meshWithMap(source);
    const binding = stampStudioVrmTexturePaintMaterialLocator(material, 4);
    if (!binding) throw new Error("binding");
    const persistedBinding = {
      ...binding,
      bindingKey: "hero-face-base-color",
    };
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(8, 8, original)]])),
    });

    const restored = unwrap(await runtime.rehydrateTarget({
      binding: persistedBinding,
      image: readable(8, 8, painted),
    }));
    expect(restored).toMatchObject({
      status: "ready",
      activeTarget: { bindingCount: 1, width: 8, height: 8 },
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    expect(canvas.canvases[0]!.frame).toEqual(painted);
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(unwrap(runtime.exportPaintedTargets())[0]?.pixels).toEqual(painted);

    const conflicting = painted.slice();
    conflicting[0] = 0;
    expectFailure(await runtime.rehydrateTarget({
      binding: persistedBinding,
      image: readable(8, 8, conflicting),
    }), "binding-conflict");
    expect(canvas.canvases[0]!.frame).toEqual(painted);
  });

  it("fails closed when persisted paint names a missing or aborted binding", async () => {
    const source = new THREE.Texture();
    const scene = new THREE.Group();
    const { material, mesh } = meshWithMap(source);
    const binding = stampStudioVrmTexturePaintMaterialLocator(material, 1);
    if (!binding) throw new Error("binding");
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(4, 4)]])),
    });

    expectFailure(await runtime.rehydrateTarget({
      binding: {
        bindingKey: "gltf-material-9-baseColor",
        materialLocator: "gltf-material:9",
        textureSlot: "baseColor",
      },
      image: readable(4, 4),
    }), "binding-missing");

    const controller = new AbortController();
    controller.abort();
    expectFailure(await runtime.rehydrateTarget({
      binding,
      image: readable(4, 4),
      signal: controller.signal,
    }), "source-read-aborted");
    expect(material.map).toBe(source);
    expect(canvas.canvases).toHaveLength(0);
  });

  it("rejects an ambiguous loader locator instead of restoring into an arbitrary material", async () => {
    const scene = new THREE.Group();
    const firstSource = new THREE.Texture();
    const secondSource = new THREE.Texture();
    const first = meshWithMap(firstSource);
    const second = meshWithMap(secondSource);
    const binding = stampStudioVrmTexturePaintMaterialLocator(first.material, 3);
    stampStudioVrmTexturePaintMaterialLocator(second.material, 3);
    if (!binding) throw new Error("binding");
    scene.add(first.mesh, second.mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([
        [firstSource, readable(4, 4)],
        [secondSource, readable(4, 4)],
      ])),
    });

    expectFailure(await runtime.rehydrateTarget({
      binding,
      image: readable(4, 4),
    }), "binding-conflict");
    expect(first.material.map).toBe(firstSource);
    expect(second.material.map).toBe(secondSource);
    expect(canvas.canvases).toHaveLength(0);
  });

  it("rebinds every shared base-color material, preserves sampling, and restores conditionally", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.name = "Face";
    source.flipY = false;
    source.wrapS = THREE.RepeatWrapping;
    source.wrapT = THREE.MirroredRepeatWrapping;
    source.magFilter = THREE.NearestFilter;
    source.minFilter = THREE.NearestMipmapNearestFilter;
    source.anisotropy = 8;
    source.colorSpace = THREE.SRGBColorSpace;
    source.offset.set(0.17, 0.23);
    source.repeat.set(1.5, 0.75);
    source.center.set(0.5, 0.5);
    source.rotation = 0.3;
    source.updateMatrix();

    const first = meshWithMap(source);
    const second = meshWithMap(source);
    const unrelatedSource = new THREE.Texture();
    const unrelated = meshWithMap(unrelatedSource);
    scene.add(first.mesh, second.mesh, unrelated.mesh);

    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(8, 8, rgba(8, 8, [9, 18, 27, 255]))]])),
    });

    const snapshot = unwrap(await runtime.beginStroke({
      pointerId: 7,
      hit: hit(first.mesh),
      pressure: 0.8,
      style: INK,
    }));
    const painted = first.material.map;

    expect(painted).toBeInstanceOf(THREE.CanvasTexture);
    expect(second.material.map).toBe(painted);
    expect(unrelated.material.map).toBe(unrelatedSource);
    expect(painted).not.toBe(source);
    expect(painted).toMatchObject({
      flipY: false,
      wrapS: source.wrapS,
      wrapT: source.wrapT,
      magFilter: source.magFilter,
      minFilter: source.minFilter,
      anisotropy: source.anisotropy,
      colorSpace: source.colorSpace,
      channel: source.channel,
    });
    expect(painted?.offset.equals(source.offset)).toBe(true);
    expect(painted?.repeat.equals(source.repeat)).toBe(true);
    expect(painted?.center.equals(source.center)).toBe(true);
    expect(painted?.matrix.equals(source.matrix)).toBe(true);
    expect(snapshot.activeTarget).toEqual({
      id: `vrm-texture:${source.uuid}`,
      sourceName: "Face",
      width: 8,
      height: 8,
      bindingCount: 2,
      valid: true,
      invalidReason: null,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.activeTarget)).toBe(true);
    expect(canvases[0]!.dirtyRects.at(-1)).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });

    const paintedTexture = painted as THREE.CanvasTexture;
    const dispose = vi.spyOn(paintedTexture, "dispose");
    const externalReplacement = new THREE.Texture();
    second.material.map = externalReplacement;
    runtime.dispose();

    expect(first.material.map).toBe(source);
    expect(second.material.map).toBe(externalReplacement);
    expect(unrelated.material.map).toBe(unrelatedSource);
    expect(dispose).toHaveBeenCalledOnce();
    expect(canvases[0]).toMatchObject({ width: 0, height: 0, closeCount: 1 });
    expect(runtime.getSnapshot()).toMatchObject({
      status: "disposed",
      activeTarget: null,
      activeTargetId: null,
      targets: [],
    });
  });

  it("copies only a bounded dirty rectangle into the canvas during an ordinary dab", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 70,
      hit: hit(mesh, 0.5, 0.5),
      style: INK,
    }));

    const dirty = canvas.canvases[0]!.dirtyRects.at(-1);
    expect(dirty).not.toBeNull();
    expect(dirty?.width).toBeLessThan(32);
    expect(dirty?.height).toBeLessThan(32);
    unwrap(runtime.cancelStroke(70));
  });

  it("advances the live content revision for pointer moves that do not publish React snapshots", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
    });

    const initialRevision = runtime.getContentRevision();
    unwrap(await runtime.beginStroke({
      pointerId: 702,
      hit: hit(mesh, 0.15, 0.15),
      style: INK,
    }));
    const revisionAfterBegin = runtime.getContentRevision();
    expect(revisionAfterBegin).toBeGreaterThan(initialRevision);

    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    unwrap(runtime.moveStroke({
      pointerId: 702,
      hit: hit(mesh, 0.85, 0.85),
    }));
    expect(runtime.getContentRevision()).toBeGreaterThan(revisionAfterBegin);
    expect(listener).not.toHaveBeenCalled();

    const revisionAfterMove = runtime.getContentRevision();
    unwrap(runtime.cancelStroke(702));
    expect(runtime.getContentRevision()).toBeGreaterThan(revisionAfterMove);
    unsubscribe();
  });

  it("keeps the geometry-island id stable before and after an asynchronous target read", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 701,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 701,
      hit: hit(mesh, 0.9, 0.9, 0, 0),
    }));

    const centerAlpha = canvas.canvases[0]!.frame[(16 * 32 + 16) * 4 + 3]!;
    expect(centerAlpha).toBeGreaterThan(0);
    unwrap(runtime.cancelStroke(701));
  });

  it("fails closed to face-specific islands when geometry classification is unavailable", async () => {
    const paintAcrossMissingGeometryIndex = async (includeFaceIndex: boolean) => {
      const scene = new THREE.Group();
      const source = new THREE.Texture();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
          2, 0, 0,
          3, 0, 0,
          2, 1, 0,
        ], 3),
      );
      const material = new THREE.MeshBasicMaterial({ map: source });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      const canvas = canvasHarness();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
      });

      unwrap(await runtime.beginStroke({
        pointerId: 702,
        hit: hit(mesh, 0.1, 0.1, 0, includeFaceIndex ? 0 : undefined),
        style: { ...INK, sizeTexels: 2 },
      }));
      unwrap(runtime.moveStroke({
        pointerId: 702,
        hit: hit(mesh, 0.9, 0.9, 0, includeFaceIndex ? 1 : undefined),
      }));
      const centerAlpha = canvas.canvases[0]!.frame[(16 * 32 + 16) * 4 + 3]!;
      unwrap(runtime.cancelStroke(702));
      runtime.dispose();
      geometry.dispose();
      material.dispose();
      return centerAlpha;
    };

    expect(await paintAcrossMissingGeometryIndex(true)).toBe(0);
    expect(await paintAcrossMissingGeometryIndex(false)).toBeGreaterThan(0);
  });

  it("prewarms uv and uv1 sequentially with only one topology job resident at a time", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh, material } = meshWithMap(source);
    const uv = mesh.geometry.getAttribute("uv");
    mesh.geometry.setAttribute("uv1", uv.clone());
    scene.add(mesh);
    let activeJobs = 0;
    let peakActiveJobs = 0;
    const releases: Array<() => void> = [];
    const uvAttributes: string[] = [];
    const precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer = vi.fn(
      (geometry, options) => {
        const index = getStudioVrmTextureGeometryIndex(geometry, options);
        if (!index) return Promise.reject(new Error("Expected admitted geometry"));
        activeJobs += 1;
        peakActiveJobs = Math.max(peakActiveJobs, activeJobs);
        uvAttributes.push(options.uvAttribute ?? "uv");
        return new Promise<StudioVrmTextureGeometryIndex>((resolve) => {
          releases.push(() => {
            activeJobs -= 1;
            resolve(index);
          });
        });
      },
    );
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      precomputeGeometryIndex,
    });

    await vi.waitFor(() => expect(precomputeGeometryIndex).toHaveBeenCalledTimes(1));
    expect(precomputeGeometryIndex).toHaveBeenNthCalledWith(
      1,
      mesh.geometry,
      expect.objectContaining({ executionBackend: "worker" }),
    );
    expect(uvAttributes).toEqual(["uv"]);
    expect(activeJobs).toBe(1);
    releases[0]?.();
    await vi.waitFor(() => expect(precomputeGeometryIndex).toHaveBeenCalledTimes(2));
    expect(uvAttributes).toEqual(["uv", "uv1"]);
    expect(activeJobs).toBe(1);
    expect(peakActiveJobs).toBe(1);
    releases[1]?.();
    await vi.waitFor(() => expect(activeJobs).toBe(0));
    runtime.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });

  it("keeps large pointer input cache-only while prewarm is pending and aborts it on dispose", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const geometry = connectedLargeGeometry();
    const material = new THREE.MeshBasicMaterial({ map: source });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const canvas = canvasHarness();
    let observedSignal: AbortSignal | undefined;
    const precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer = vi.fn(
      (_geometry, options) =>
        new Promise<StudioVrmTextureGeometryIndex>((_resolve, reject) => {
          observedSignal = options.signal;
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Disposed", "AbortError")),
            { once: true },
          );
        }),
    );
    const positionRead = vi.spyOn(geometry.getAttribute("position"), "getX");
    const uvRead = vi.spyOn(geometry.getAttribute("uv"), "getX");
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
      precomputeGeometryIndex,
    });

    await vi.waitFor(() => expect(precomputeGeometryIndex).toHaveBeenCalledOnce());
    positionRead.mockClear();
    uvRead.mockClear();
    unwrap(await runtime.beginStroke({
      pointerId: 704,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 704,
      hit: hit(mesh, 0.9, 0.9, 0, 1),
    }));

    expect(canvas.canvases[0]!.frame[(16 * 32 + 16) * 4 + 3]).toBe(0);
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();
    unwrap(runtime.cancelStroke(704));
    runtime.dispose();
    expect(observedSignal?.aborted).toBe(true);
    await Promise.resolve();
    geometry.dispose();
    material.dispose();
  });

  it("uses a large prewarmed cache for islands and density, then quarantines stale geometry", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.image = { width: 64, height: 64 };
    const geometry = connectedLargeGeometry();
    const material = new THREE.MeshBasicMaterial({ map: source });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const canvas = canvasHarness();
    const precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer = vi.fn(
      async (candidate, options) => {
        const index = getStudioVrmTextureGeometryIndex(candidate, options);
        if (!index) throw new Error("Expected admitted geometry");
        return index;
      },
    );
    const positionRead = vi.spyOn(geometry.getAttribute("position"), "getX");
    const uvRead = vi.spyOn(geometry.getAttribute("uv"), "getX");
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(64, 64)]])),
      precomputeGeometryIndex,
    });
    const cacheOptions = {
      maxTriangles: STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
      uvAttribute: "uv",
    } as const;

    await vi.waitFor(() => {
      expect(getCachedStudioVrmTextureGeometryIndex(geometry, cacheOptions)).not.toBeNull();
    });
    positionRead.mockClear();
    uvRead.mockClear();

    unwrap(await runtime.beginStroke({
      pointerId: 705,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 705,
      hit: hit(mesh, 0.9, 0.9, 0, 1),
    }));
    expect(canvas.canvases[0]!.frame[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(0);
    unwrap(runtime.cancelStroke(705));

    unwrap(await runtime.beginStroke({
      pointerId: 706,
      hit: hit(mesh, 0.1, 0.1, 0, 0, new THREE.Vector3(0, 0, 0)),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 706,
      hit: hit(mesh, 0.9, 0.9, 0, 1, new THREE.Vector3(0.001, 0, 0)),
    }));
    expect(canvas.canvases[0]!.frame[(32 * 64 + 32) * 4 + 3]).toBe(0);
    unwrap(runtime.cancelStroke(706));
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();

    geometry.getAttribute("uv").needsUpdate = true;
    expect(getCachedStudioVrmTextureGeometryIndex(geometry, cacheOptions)).toBeNull();
    positionRead.mockClear();
    uvRead.mockClear();
    unwrap(await runtime.beginStroke({
      pointerId: 707,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 707,
      hit: hit(mesh, 0.9, 0.9, 0, 1),
    }));
    expect(canvas.canvases[0]!.frame[(32 * 64 + 32) * 4 + 3]).toBe(0);
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();
    unwrap(runtime.cancelStroke(707));
    runtime.dispose();
    geometry.dispose();
    material.dispose();
  });

  it("fails a large prewarm closed without scanning on pointer input", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const geometry = connectedLargeGeometry();
    const material = new THREE.MeshBasicMaterial({ map: source });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const canvas = canvasHarness();
    const precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer = vi.fn(
      async () => {
        throw new Error("Worker unavailable");
      },
    );
    const positionRead = vi.spyOn(geometry.getAttribute("position"), "getX");
    const uvRead = vi.spyOn(geometry.getAttribute("uv"), "getX");
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
      precomputeGeometryIndex,
    });

    await vi.waitFor(() => expect(precomputeGeometryIndex).toHaveBeenCalledOnce());
    positionRead.mockClear();
    uvRead.mockClear();
    unwrap(await runtime.beginStroke({
      pointerId: 708,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 708,
      hit: hit(mesh, 0.9, 0.9, 0, 1),
    }));
    expect(canvas.canvases[0]!.frame[(16 * 32 + 16) * 4 + 3]).toBe(0);
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();
    unwrap(runtime.cancelStroke(708));
    runtime.dispose();
    geometry.dispose();
    material.dispose();
  });

  it("keeps face-local painting without synchronous topology when Worker prewarm fails", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh, material } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer = vi.fn(
      async () => {
        throw new Error("Worker unavailable");
      },
    );
    const positionRead = vi.spyOn(mesh.geometry.getAttribute("position"), "getX");
    const uvRead = vi.spyOn(mesh.geometry.getAttribute("uv"), "getX");
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(32, 32)]])),
      precomputeGeometryIndex,
    });

    await vi.waitFor(() => expect(precomputeGeometryIndex).toHaveBeenCalledOnce());
    positionRead.mockClear();
    uvRead.mockClear();
    unwrap(await runtime.beginStroke({
      pointerId: 709,
      hit: hit(mesh, 0.1, 0.1, 0, 0),
      style: { ...INK, sizeTexels: 2 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 709,
      hit: hit(mesh, 0.9, 0.9, 0, 0),
    }));
    expect(canvas.canvases[0]!.frame[(16 * 32 + 16) * 4 + 3]).toBeGreaterThan(0);
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();
    unwrap(runtime.cancelStroke(709));
    runtime.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });

  it("uses texture-matrix area when enriching face samples with world texel density", async () => {
    const paintVerticalStroke = async (repeatX: number) => {
      const scene = new THREE.Group();
      const source = new THREE.Texture();
      source.image = { width: 64, height: 64 };
      source.repeat.set(repeatX, 1);
      source.center.set(0.5, 0.5);
      const { mesh } = meshWithMap(source);
      expect(getStudioVrmTextureGeometryIndex(mesh.geometry, {
        maxTriangles: STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
      })).not.toBeNull();
      scene.add(mesh);
      const canvas = canvasHarness();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(64, 64)]])),
      });

      unwrap(await runtime.beginStroke({
        pointerId: 703,
        hit: hit(mesh, 0.5, 0.1, 0, 0, new THREE.Vector3(0, 0, 0)),
        style: { ...INK, sizeTexels: 3 },
      }));
      unwrap(runtime.moveStroke({
        pointerId: 703,
        hit: hit(mesh, 0.5, 0.9, 0, 0, new THREE.Vector3(0.001, 0, 0)),
      }));
      let centerAlpha = 0;
      for (let y = 28; y <= 36; y += 1) {
        for (let x = 28; x <= 36; x += 1) {
          centerAlpha = Math.max(
            centerAlpha,
            canvas.canvases[0]!.frame[(y * 64 + x) * 4 + 3]!,
          );
        }
      }
      unwrap(runtime.cancelStroke(703));
      runtime.dispose();
      return centerAlpha;
    };

    // 보통 matrix(det=1)는 월드 이동 대비 큰 UV 점프를 심으로 끊는다.
    expect(await paintVerticalStroke(1)).toBe(0);
    // 퇴화 matrix(det=0)는 밀도를 만들 수 없어 안전한 legacy 거리 임계값을 쓴다.
    expect(await paintVerticalStroke(0)).toBeGreaterThan(0);
  });

  it("matches one canonical batch plan across long pending and active move streams", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const size = { width: 96, height: 96 } as const;
    const original = rgba(size.width, size.height);
    const canvas = canvasHarness();
    let resolveRead: ((image: StudioVrmTexturePaintReadableImage) => void) | null = null;
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: () =>
        new Promise<StudioVrmTexturePaintReadableImage>((resolve) => {
          resolveRead = resolve;
        }),
    });
    const strokeStyle: StudioVrmTextureStrokeStyle = {
      kind: "pencil",
      color: "#4263eb",
      sizeTexels: 7,
      opacity: 0.72,
      blend: "normal",
      tuning: { flow: 0.61, hardness: 0.82, minSize: 0.14 },
    };
    const samples = Array.from({ length: 180 }, (_, index) => {
      const progress = index / 179;
      return {
        uv: {
          u: 0.06 + progress * 0.88,
          v: 0.5 + Math.sin(index * 0.19) * 0.22,
        },
        pressure: 0.08 + ((index * 17) % 89) / 100,
      } satisfies StudioVrmTextureStrokeSample;
    });
    const pointerId = 704;
    const completion = runtime.beginStroke({
      pointerId,
      hit: hit(mesh, samples[0]!.uv.u, samples[0]!.uv.v),
      pressure: samples[0]!.pressure,
      style: strokeStyle,
      planOptions: { seed: 321 },
    });

    // Target read가 끝나기 전 입력도 유실·중복 없이 walker로 한 번만 전달되어야 한다.
    for (const sample of samples.slice(1, 70)) {
      expect(unwrap(runtime.moveStroke({
        pointerId,
        hit: hit(mesh, sample.uv.u, sample.uv.v),
        pressure: sample.pressure,
      }))).toBe(true);
    }
    const finishRead = resolveRead as
      | ((image: StudioVrmTexturePaintReadableImage) => void)
      | null;
    if (!finishRead) throw new Error("reader did not start");
    finishRead(readable(size.width, size.height, original));
    unwrap(await completion);

    for (const sample of samples.slice(70)) {
      expect(unwrap(runtime.moveStroke({
        pointerId,
        hit: hit(mesh, sample.uv.u, sample.uv.v),
        pressure: sample.pressure,
      }))).toBe(true);
    }
    expect(unwrap(runtime.commitStroke(pointerId))).toBe(true);

    const canonicalPlan = planStudioVrmTextureStroke(
      strokeStyle,
      samples,
      size,
      {
        seed: 321,
        wrapU: "clamp",
        wrapV: "clamp",
        flipV: false,
      },
    );
    const expected = createStudioVrmTextureBuffer(size);
    if (!expected) throw new Error("expected buffer");
    applyStudioVrmTexturePaintOps(expected, size, canonicalPlan.ops, {
      wrapU: "clamp",
      wrapV: "clamp",
      originalPixels: original,
    });

    expect(canvas.canvases[0]!.frame).toEqual(expected);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "ready",
      activePointerId: null,
      history: { undoCount: 1, redoCount: 0 },
    });
  });

  it("keeps active strokes suffix-only without retaining the full sample prefix", () => {
    const source = readFileSync(
      new URL("./studio-vrm-texture-paint-runtime.ts", import.meta.url),
      "utf8",
    );
    const activeStart = source.indexOf("interface ActiveStroke {");
    const activeEnd = source.indexOf("interface PendingColorSample", activeStart);
    const applyStart = source.indexOf("private applyIncrementalSample(");
    const applyEnd = source.indexOf("private rollbackActiveStroke(", applyStart);

    expect(activeStart).toBeGreaterThan(-1);
    expect(activeEnd).toBeGreaterThan(activeStart);
    expect(applyStart).toBeGreaterThan(-1);
    expect(applyEnd).toBeGreaterThan(applyStart);
    expect(source.slice(activeStart, activeEnd)).toContain(
      "readonly walker: StudioVrmTextureStrokeWalker",
    );
    expect(source.slice(activeStart, activeEnd)).not.toContain(
      "readonly samples: StudioVrmTextureStrokeSample[]",
    );
    expect(source.slice(applyStart, applyEnd)).toContain("stroke.walker.append(sample)");
    expect(source.slice(applyStart, applyEnd)).not.toContain("planStudioVrmTextureStroke(");
  });

  it("rejects pointer mismatches without stealing or completing the owned stroke", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(8, 8)]])),
    });

    unwrap(await runtime.beginStroke({ pointerId: 11, hit: hit(mesh), style: INK }));
    const beforeMismatch = canvases[0]!.frame.slice();
    expectFailure(runtime.moveStroke({ pointerId: 12, hit: hit(mesh, 0.8, 0.8) }), "pointer-mismatch");
    expectFailure(runtime.commitStroke(12), "pointer-mismatch");
    expectFailure(runtime.cancelStroke(12), "pointer-mismatch");

    expect(runtime.getSnapshot()).toMatchObject({
      status: "painting",
      activePointerId: 11,
    });
    expect(canvases[0]!.frame).toEqual(beforeMismatch);
    expect(material.map).not.toBe(source);
    expect(unwrap(runtime.cancelStroke(11))).toBe(true);
    expect(unwrap(runtime.cancelStroke(11))).toBe(false);
  });

  it("rolls an incremental stroke back exactly on cancel and never adds history", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const original = rgba(12, 12, [14, 28, 42, 255]);
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(12, 12, original)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 3,
      hit: hit(mesh, 0.15, 0.2),
      pressure: 0.2,
      style: { ...INK, sizeTexels: 5 },
    }));
    unwrap(runtime.moveStroke({ pointerId: 3, hit: hit(mesh, 0.8, 0.75), pressure: 1 }));
    expect(canvases[0]!.frame).not.toEqual(original);

    expect(unwrap(runtime.cancelStroke(3))).toBe(true);
    expect(canvases[0]!.frame).toEqual(original);
    expect(runtime.getSnapshot().history).toMatchObject({
      undoCount: 0,
      redoCount: 0,
      retainedBytes: 0,
    });
  });

  it("undoes and redoes an exact tile-recorded delta", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const original = rgba(16, 16, [32, 48, 64, 255]);
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(16, 16, original)]])),
      undoTileSize: 8,
    });

    unwrap(await runtime.beginStroke({
      pointerId: 4,
      hit: hit(mesh, 0.2, 0.25),
      style: { ...INK, color: "#f2c94c", sizeTexels: 5 },
    }));
    unwrap(runtime.moveStroke({ pointerId: 4, hit: hit(mesh, 0.75, 0.7), pressure: 0.7 }));
    unwrap(runtime.commitStroke(4));
    const painted = canvases[0]!.frame.slice();
    expect(painted).not.toEqual(original);
    expect(runtime.getSnapshot().history.undoCount).toBe(1);

    expect(unwrap(runtime.undo())).toBe(true);
    expect(canvases[0]!.frame).toEqual(original);
    expect(runtime.getSnapshot().history).toMatchObject({ undoCount: 0, redoCount: 1 });

    expect(unwrap(runtime.redo())).toBe(true);
    expect(canvases[0]!.frame).toEqual(painted);
    expect(runtime.getSnapshot().history).toMatchObject({ undoCount: 1, redoCount: 0 });
  });

  it("commits a long sparse diagonal below a budget that rejects its union rectangle", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const size = 512;
    const original = rgba(size, size, [7, 11, 13, 255]);
    const canvas = canvasHarness();
    const maxHistoryBytes = 128 * 1024;
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([
        [source, readable(size, size, original)],
      ])),
      maxHistoryBytes,
      undoTileSize: 16,
    });

    unwrap(await runtime.beginStroke({
      pointerId: 401,
      hit: hit(mesh, 0.01, 0.01),
      style: { ...INK, sizeTexels: 3 },
    }));
    unwrap(runtime.moveStroke({
      pointerId: 401,
      hit: hit(mesh, 0.99, 0.99),
    }));
    expect(unwrap(runtime.commitStroke(401))).toBe(true);
    const painted = canvas.canvases[0]!.frame.slice();
    const history = runtime.getSnapshot().history;

    expect(history).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(history.retainedBytes).toBeLessThanOrEqual(maxHistoryBytes);
    expect(size * size * 4 * 2).toBeGreaterThan(maxHistoryBytes);
    expect(painted).not.toEqual(original);

    expect(unwrap(runtime.undo())).toBe(true);
    expect(canvas.canvases[0]!.frame).toEqual(original);
    expect(unwrap(runtime.redo())).toBe(true);
    expect(canvas.canvases[0]!.frame).toEqual(painted);
  });

  it("evicts the oldest committed deltas by count while preserving the reachable undo floor", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(12, 12)]])),
      maxHistoryEntries: 2,
      maxHistoryBytes: 1024 * 1024,
      undoTileSize: 8,
    });

    const states: Uint8ClampedArray[] = [];
    for (const [index, stroke] of [
      { u: 0.15, color: "#ff0000" },
      { u: 0.5, color: "#00ff00" },
      { u: 0.85, color: "#0000ff" },
    ].entries()) {
      unwrap(await runtime.beginStroke({
        pointerId: index + 1,
        hit: hit(mesh, stroke.u, 0.5),
        style: { ...INK, color: stroke.color, sizeTexels: 2 },
      }));
      unwrap(runtime.commitStroke(index + 1));
      states.push(canvases[0]!.frame.slice());
    }

    expect(runtime.getSnapshot().history).toMatchObject({ undoCount: 2, redoCount: 0 });
    expect(unwrap(runtime.undo())).toBe(true);
    expect(canvases[0]!.frame).toEqual(states[1]);
    expect(unwrap(runtime.undo())).toBe(true);
    expect(canvases[0]!.frame).toEqual(states[0]);
    expect(unwrap(runtime.undo())).toBe(false);
    expect(unwrap(runtime.redo())).toBe(true);
    expect(unwrap(runtime.redo())).toBe(true);
    expect(canvases[0]!.frame).toEqual(states[2]);
  });

  it("rolls over oldest history before active COW allocation without locking later strokes", async () => {
    const cappedScene = new THREE.Group();
    const cappedSource = new THREE.Texture();
    const cappedMesh = meshWithMap(cappedSource);
    cappedScene.add(cappedMesh.mesh);
    const cappedCanvas = canvasHarness();
    const cappedRuntime = createStudioVrmTexturePaintRuntime(cappedScene, {
      createCanvas: cappedCanvas.createCanvas,
      readTextureImage: imageReader(new Map([[cappedSource, readable(12, 12)]])),
      maxHistoryEntries: 50,
      maxHistoryBytes: 1024,
      undoTileSize: 8,
    });

    const committedFrames: Uint8ClampedArray[] = [];
    for (let index = 0; index < 20; index += 1) {
      const u = 0.1 + (index % 5) * 0.2;
      unwrap(await cappedRuntime.beginStroke({
        pointerId: index + 1,
        hit: hit(cappedMesh.mesh, u, 0.5),
        style: {
          ...INK,
          color: index % 2 === 0 ? "#ff0000" : "#0000ff",
          sizeTexels: 2,
        },
      }));
      unwrap(cappedRuntime.commitStroke(index + 1));
      committedFrames.push(cappedCanvas.canvases[0]!.frame.slice());
    }
    expect(cappedRuntime.getSnapshot().history.undoCount).toBeGreaterThan(0);
    expect(cappedRuntime.getSnapshot().history.undoCount).toBeLessThan(20);
    expect(cappedRuntime.getSnapshot().history.redoCount).toBe(0);
    expect(cappedRuntime.getSnapshot().history.retainedBytes).toBeLessThanOrEqual(1024);
    expect(unwrap(cappedRuntime.undo())).toBe(true);
    expect(cappedCanvas.canvases[0]!.frame).toEqual(committedFrames.at(-2));
    expect(unwrap(cappedRuntime.redo())).toBe(true);
    expect(cappedCanvas.canvases[0]!.frame).toEqual(committedFrames.at(-1));

    const rejectScene = new THREE.Group();
    const rejectSource = new THREE.Texture();
    const rejectMesh = meshWithMap(rejectSource);
    rejectScene.add(rejectMesh.mesh);
    const original = rgba(8, 8, [31, 47, 63, 255]);
    const rejectCanvas = canvasHarness();
    const rejectRuntime = createStudioVrmTexturePaintRuntime(rejectScene, {
      createCanvas: rejectCanvas.createCanvas,
      readTextureImage: imageReader(new Map([[rejectSource, readable(8, 8, original)]])),
      maxHistoryBytes: 16,
      undoTileSize: 8,
    });
    expectFailure(await rejectRuntime.beginStroke({
      pointerId: 9,
      hit: hit(rejectMesh.mesh),
      style: { ...INK, sizeTexels: 5 },
    }), "history-budget");
    expect(unwrap(rejectRuntime.commitStroke(9))).toBe(false);
    expect(rejectCanvas.canvases[0]!.frame).toEqual(original);
    expect(rejectRuntime.getSnapshot().history).toMatchObject({
      undoCount: 0,
      redoCount: 0,
      retainedBytes: 0,
    });
  });

  it("rejects per-target and aggregate RGBA budget overages before rebinding", async () => {
    const perTargetScene = new THREE.Group();
    const perTargetSource = new THREE.Texture();
    const perTarget = meshWithMap(perTargetSource);
    perTargetScene.add(perTarget.mesh);
    const perTargetCanvases = canvasHarness();
    const perTargetRuntime = createStudioVrmTexturePaintRuntime(perTargetScene, {
      createCanvas: perTargetCanvases.createCanvas,
      readTextureImage: imageReader(new Map([[perTargetSource, readable(4, 4)]])),
      maxTargetRgbaBytes: 63,
    });

    expectFailure(await perTargetRuntime.beginStroke({
      pointerId: 1,
      hit: hit(perTarget.mesh),
      style: INK,
    }), "target-rgba-budget");
    expect(perTarget.material.map).toBe(perTargetSource);
    expect(perTargetCanvases.canvases).toHaveLength(0);

    const aggregateScene = new THREE.Group();
    const firstSource = new THREE.Texture();
    const secondSource = new THREE.Texture();
    const first = meshWithMap(firstSource);
    const second = meshWithMap(secondSource);
    aggregateScene.add(first.mesh, second.mesh);
    const aggregateCanvases = canvasHarness();
    const aggregateRuntime = createStudioVrmTexturePaintRuntime(aggregateScene, {
      createCanvas: aggregateCanvases.createCanvas,
      readTextureImage: imageReader(new Map([
        [firstSource, readable(4, 4)],
        [secondSource, readable(4, 4)],
      ])),
      maxTargetRgbaBytes: 64,
      maxAggregateRgbaBytes: 64,
    });

    unwrap(await aggregateRuntime.beginStroke({
      pointerId: 2,
      hit: hit(first.mesh),
      style: INK,
    }));
    unwrap(aggregateRuntime.commitStroke(2));
    expectFailure(await aggregateRuntime.beginStroke({
      pointerId: 3,
      hit: hit(second.mesh),
      style: INK,
    }), "aggregate-rgba-budget");
    expect(second.material.map).toBe(secondSource);
    expect(aggregateRuntime.getSnapshot()).toMatchObject({
      aggregateRgbaBytes: 64,
      targets: [expect.objectContaining({ sourceTextureUuid: firstSource.uuid })],
    });
    expect(aggregateCanvases.canvases).toHaveLength(1);
  });

  it("rejects a known oversized source before reader, Canvas, or GPU allocation", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.image = { width: 2_048, height: 2_048 };
    const target = meshWithMap(source);
    scene.add(target.mesh);
    const canvas = canvasHarness();
    const reader = vi.fn(() => readable(1, 1));
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: reader,
      maxTargetResidentBytes: 56 * 1024 * 1024,
      maxAggregateResidentBytes: 64 * 1024 * 1024,
      maxHistoryBytes: 8 * 1024 * 1024,
    });

    expect(estimateStudioVrmTexturePaintTargetResidentBytes({
      width: 2_048,
      height: 2_048,
    })).toBe(64 * 1024 * 1024);
    expectFailure(await runtime.beginStroke({
      pointerId: 4,
      hit: hit(target.mesh),
      style: INK,
    }), "target-rgba-budget");
    expect(reader).not.toHaveBeenCalled();
    expect(canvas.createCanvas).not.toHaveBeenCalled();
    expect(target.material.map).toBe(source);
    expect(runtime.getSnapshot()).toMatchObject({
      aggregateTargetResidentBytes: 0,
      residentBytes: 0,
      targets: [],
    });
  });

  it("caps synchronous geometry indexing and exposes the face-local fallback guidance", async () => {
    const overScene = new THREE.Group();
    const overSource = new THREE.Texture();
    const overTarget = meshWithMap(overSource);
    overScene.add(overTarget.mesh);
    const overCanvas = canvasHarness();
    const overRuntime = createStudioVrmTexturePaintRuntime(overScene, {
      createCanvas: overCanvas.createCanvas,
      readTextureImage: imageReader(new Map([[overSource, readable(8, 8)]])),
      maxGeometryIndexTriangles: 1,
    });

    const overSnapshot = unwrap(await overRuntime.beginStroke({
      pointerId: 5,
      hit: hit(overTarget.mesh, 0.5, 0.5, 0, 0),
      style: INK,
    }));
    expect(overSnapshot.guidance).toMatchObject({
      code: "geometry-triangle-budget",
      triangleCount: 2,
      maxTriangles: 1,
    });
    expect(Object.isFrozen(overSnapshot.guidance)).toBe(true);
    expect(unwrap(overRuntime.cancelStroke(5))).toBe(true);
    expect(overRuntime.clearError().guidance).toBeNull();

    const boundaryScene = new THREE.Group();
    const boundarySource = new THREE.Texture();
    const boundaryTarget = meshWithMap(boundarySource);
    boundaryScene.add(boundaryTarget.mesh);
    const boundaryCanvas = canvasHarness();
    const boundaryRuntime = createStudioVrmTexturePaintRuntime(boundaryScene, {
      createCanvas: boundaryCanvas.createCanvas,
      readTextureImage: imageReader(new Map([[boundarySource, readable(8, 8)]])),
      maxGeometryIndexTriangles: 2,
    });
    const boundarySnapshot = unwrap(await boundaryRuntime.beginStroke({
      pointerId: 6,
      hit: hit(boundaryTarget.mesh, 0.5, 0.5, 0, 0),
      style: INK,
    }));
    expect(boundarySnapshot.guidance).toBeNull();
    expect(unwrap(boundaryRuntime.cancelStroke(6))).toBe(true);
  });

  it("resets the selected target to its captured source and removes only its history", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.name = "Coat";
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    const original = rgba(10, 10, [77, 88, 99, 255]);
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(10, 10, original)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 5,
      hit: hit(mesh),
      style: { ...INK, color: "#ffffff", sizeTexels: 6 },
    }));
    unwrap(runtime.commitStroke(5));
    const paintedTexture = material.map;
    expect(canvases[0]!.frame).not.toEqual(original);
    expect(runtime.getSnapshot().history.undoCount).toBe(1);

    expect(unwrap(runtime.resetActiveTarget())).toBe(true);
    expect(canvases[0]!.frame).toEqual(original);
    expect(material.map).toBe(paintedTexture);
    expect(runtime.getSnapshot()).toMatchObject({
      activeTarget: {
        sourceName: "Coat",
        width: 10,
        height: 10,
      },
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
    });
    expect(unwrap(runtime.undo())).toBe(false);
  });

  it("aborts a cancelled source read and auto-commits one early completion exactly once", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    const resolvers: Array<(image: StudioVrmTexturePaintReadableImage) => void> = [];
    const signals: AbortSignal[] = [];
    const reader = vi.fn((
      _texture: THREE.Texture,
      signal: AbortSignal,
    ) => new Promise<StudioVrmTexturePaintReadableImage>((resolve, reject) => {
      signals.push(signal);
      resolvers.push(resolve);
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      );
    }));
    const { canvases, createCanvas } = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas,
      readTextureImage: reader,
    });

    const cancelledBegin = runtime.beginStroke({
      pointerId: 21,
      hit: hit(mesh, 0.2, 0.2),
      style: INK,
    });
    expect(runtime.getSnapshot()).toMatchObject({ status: "loading", activePointerId: 21 });
    expect(unwrap(runtime.cancelStroke(21))).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
    expectFailure(await cancelledBegin, "stale-completion");
    expect(material.map).toBe(source);

    const committedBegin = runtime.beginStroke({
      pointerId: 22,
      hit: hit(mesh, 0.2, 0.2),
      pressure: 0.1,
      style: { ...INK, sizeTexels: 5 },
    });
    unwrap(runtime.moveStroke({ pointerId: 22, hit: hit(mesh, 0.8, 0.8), pressure: 1 }));
    expect(unwrap(runtime.commitStroke(22))).toBe(true);
    expect(unwrap(runtime.commitStroke(22))).toBe(false);

    resolvers[1]!(readable(12, 12));
    const completion = unwrap(await committedBegin);
    expect(completion).toMatchObject({
      status: "ready",
      activePointerId: null,
      history: { undoCount: 1, redoCount: 0 },
    });
    expect(material.map).not.toBe(source);
    expect(canvases).toHaveLength(1);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(unwrap(runtime.commitStroke(22))).toBe(false);
  });

  it("can still cancel and abort a pending read after pointerup requested an early commit", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    let observedSignal: AbortSignal | null = null;
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      readTextureImage: (_texture, signal) => new Promise((_, reject) => {
        observedSignal = signal;
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
    });

    const completion = runtime.beginStroke({
      pointerId: 23,
      hit: hit(mesh),
      style: INK,
    });
    expect(unwrap(runtime.commitStroke(23))).toBe(true);
    expect(unwrap(runtime.cancelStroke(23))).toBe(true);

    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    expectFailure(await completion, "stale-completion");
    expect(material.map).toBe(source);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "idle",
      activePointerId: null,
      history: { undoCount: 0, redoCount: 0 },
    });
  });

  it("bounds non-cooperative stale reads per source and across the runtime", async () => {
    const scene = new THREE.Group();
    const sources = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    const meshes = sources.map((source) => meshWithMap(source));
    scene.add(...meshes.map(({ mesh }) => mesh));
    const resolvers: Array<(image: StudioVrmTexturePaintReadableImage) => void> = [];
    const signals: AbortSignal[] = [];
    const reader = vi.fn((
      _texture: THREE.Texture,
      signal: AbortSignal,
    ) => new Promise<StudioVrmTexturePaintReadableImage>((resolve) => {
      signals.push(signal);
      resolvers.push(resolve);
    }));
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      maxConcurrentReads: 2,
      readTextureImage: reader,
    });

    const firstBegin = runtime.beginStroke({
      pointerId: 41,
      hit: hit(meshes[0]!.mesh),
      style: INK,
    });
    expect(unwrap(runtime.cancelStroke(41))).toBe(true);
    expectFailure(await runtime.beginStroke({
      pointerId: 42,
      hit: hit(meshes[0]!.mesh),
      style: INK,
    }), "source-read-active");

    const secondBegin = runtime.beginStroke({
      pointerId: 43,
      hit: hit(meshes[1]!.mesh),
      style: INK,
    });
    expect(unwrap(runtime.cancelStroke(43))).toBe(true);
    expectFailure(await runtime.beginStroke({
      pointerId: 44,
      hit: hit(meshes[2]!.mesh),
      style: INK,
    }), "read-concurrency-budget");

    expect(reader).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    resolvers[0]!(readable(8, 8));
    resolvers[1]!(readable(8, 8));
    expectFailure(await firstBegin, "stale-completion");
    expectFailure(await secondBegin, "stale-completion");
    expect(canvas.canvases).toHaveLength(0);
  });

  it("aborts an unsettled reader when the runtime is disposed", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const observedSignals: AbortSignal[] = [];
    const reader = vi.fn((
      _texture: THREE.Texture,
      signal: AbortSignal,
    ) => new Promise<StudioVrmTexturePaintReadableImage>((_resolve, reject) => {
      observedSignals.push(signal);
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Disposed", "AbortError")),
        { once: true },
      );
    }));
    const runtime = createStudioVrmTexturePaintRuntime(scene, { readTextureImage: reader });
    const completion = runtime.beginStroke({
      pointerId: 45,
      hit: hit(mesh),
      style: INK,
    });

    runtime.dispose();
    expect(observedSignals[0]?.aborted).toBe(true);
    expectFailure(await completion, "stale-completion");
    expect(runtime.getSnapshot()).toMatchObject({ status: "disposed", targets: [] });
  });

  it("does not bind shared materials when the originating map changes during an asynchronous read", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const origin = meshWithMap(source);
    const shared = meshWithMap(source);
    scene.add(origin.mesh, shared.mesh);
    let resolveImage: ((image: StudioVrmTexturePaintReadableImage) => void) | null = null;
    const reader = vi.fn(() => new Promise<StudioVrmTexturePaintReadableImage>((resolve) => {
      resolveImage = resolve;
    }));
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: reader,
    });

    const completion = runtime.beginStroke({
      pointerId: 31,
      hit: hit(origin.mesh),
      style: INK,
    });
    const externalReplacement = new THREE.Texture();
    origin.material.map = externalReplacement;
    const finishRead = resolveImage as
      | ((image: StudioVrmTexturePaintReadableImage) => void)
      | null;
    expect(finishRead).not.toBeNull();
    finishRead?.(readable(8, 8));

    expectFailure(await completion, "source-changed");
    expect(origin.material.map).toBe(externalReplacement);
    expect(shared.material.map).toBe(source);
    expect(canvas.canvases).toHaveLength(0);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "idle",
      targets: [],
      aggregateRgbaBytes: 0,
    });
  });

  it("uses pressure in the paint plan and does not notify subscribers for successful moves", async () => {
    const paintWithPressure = async (pressure: number) => {
      const scene = new THREE.Group();
      const source = new THREE.Texture();
      const { mesh } = meshWithMap(source);
      scene.add(mesh);
      const canvas = canvasHarness();
      const runtime = createStudioVrmTexturePaintRuntime(scene, {
        createCanvas: canvas.createCanvas,
        readTextureImage: imageReader(new Map([[source, readable(16, 16)]])),
      });
      const listener = vi.fn();
      runtime.subscribe(listener);
      unwrap(await runtime.beginStroke({
        pointerId: 1,
        hit: hit(mesh, 0.25, 0.5),
        pressure,
        style: {
          ...INK,
          sizeTexels: 8,
          tuning: { flow: 1, hardness: 1, minSize: 0 },
        },
      }));
      listener.mockClear();
      unwrap(runtime.moveStroke({ pointerId: 1, hit: hit(mesh, 0.75, 0.5), pressure }));
      expect(listener).not.toHaveBeenCalled();
      return canvas.canvases[0]!.frame;
    };

    const low = await paintWithPressure(0);
    const high = await paintWithPressure(1);
    const alphaCoverage = (pixels: Uint8ClampedArray) => {
      let covered = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset]! > 0) covered += 1;
      }
      return covered;
    };
    expect(alphaCoverage(high)).toBeGreaterThan(alphaCoverage(low));
  });

  it("coalesces duplicate samples and enforces a hard per-stroke sample cap", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      maxStrokeSamples: 3,
      readTextureImage: imageReader(new Map([[source, readable(24, 24)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 51,
      hit: hit(mesh, 0.1, 0.1),
      pressure: 0.5,
      style: INK,
    }));
    const putsAfterBegin = canvas.canvases[0]!.putCount;
    expect(unwrap(runtime.moveStroke({
      pointerId: 51,
      hit: hit(mesh, 0.1, 0.1),
      pressure: 0.5,
    }))).toBe(false);
    expect(canvas.canvases[0]!.putCount).toBe(putsAfterBegin);

    expect(unwrap(runtime.moveStroke({
      pointerId: 51,
      hit: hit(mesh, 0.35, 0.35),
      pressure: 0.6,
    }))).toBe(true);
    expect(unwrap(runtime.moveStroke({
      pointerId: 51,
      hit: hit(mesh, 0.6, 0.6),
      pressure: 0.7,
    }))).toBe(true);
    expectFailure(runtime.moveStroke({
      pointerId: 51,
      hit: hit(mesh, 0.85, 0.85),
      pressure: 0.8,
    }), "stroke-sample-budget");
    expect(runtime.getSnapshot()).toMatchObject({ status: "painting", activePointerId: 51 });
    expect(unwrap(runtime.commitStroke(51))).toBe(true);
    expect(runtime.getSnapshot().history.undoCount).toBe(1);
  });

  it("releases a failed target and can rebuild it safely from the original texture", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { material, mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(12, 12)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 61,
      hit: hit(mesh, 0.4, 0.4),
      style: { ...INK, sizeTexels: 5 },
    }));
    expect(material.map).not.toBe(source);
    canvas.canvases[0]!.failAllPuts = true;

    expectFailure(runtime.cancelStroke(61), "target-invalid");
    expect(material.map).toBe(source);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "idle",
      activePointerId: null,
      activeTarget: null,
      aggregateRgbaBytes: 0,
      history: { undoCount: 0, redoCount: 0, retainedBytes: 0 },
      targets: [],
      error: { code: "target-invalid" },
    });
    expect(canvas.canvases[0]!.closeCount).toBeGreaterThan(0);

    unwrap(await runtime.beginStroke({
      pointerId: 62,
      hit: hit(mesh, 0.4, 0.4),
      style: INK,
    }));
    expect(material.map).not.toBe(source);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "painting",
      activePointerId: 62,
      targets: [expect.objectContaining({ valid: true })],
    });
    unwrap(runtime.cancelStroke(62));
  });

  it("paints repeat-U and mirrored-V edges with their independent sampler modes", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    source.flipY = false;
    source.wrapS = THREE.RepeatWrapping;
    source.wrapT = THREE.MirroredRepeatWrapping;
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const runtime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(8, 8)]])),
    });

    unwrap(await runtime.beginStroke({
      pointerId: 71,
      hit: hit(mesh, 0.02, 1.02),
      style: { ...INK, sizeTexels: 6 },
    }));
    const frame = canvas.canvases[0]!.frame;
    const alphaAt = (x: number, y: number) => frame[(y * 8 + x) * 4 + 3]!;
    expect(alphaAt(7, 7)).toBeGreaterThan(0);
    expect(alphaAt(0, 0)).toBe(0);
    unwrap(runtime.cancelStroke(71));
  });

  it("exposes frozen error state, clears it explicitly, and fails closed on unsafe sources", async () => {
    const scene = new THREE.Group();
    const source = new THREE.Texture();
    const { mesh } = meshWithMap(source);
    scene.add(mesh);
    const canvas = canvasHarness();
    const unreadableRuntime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: vi.fn(async () => {
        throw new DOMException("The canvas has been tainted", "SecurityError");
      }),
    });

    expectFailure(await unreadableRuntime.beginStroke({
      pointerId: 1,
      hit: hit(mesh),
      style: INK,
    }), "source-unreadable");
    const failed = unreadableRuntime.getSnapshot();
    expect(failed.status).toBe("idle");
    expect(failed.error).toMatchObject({
      code: "source-unreadable",
      message: "텍스처를 읽을 수 없습니다. CORS 설정을 확인하세요.",
    });
    expect(Object.isFrozen(failed.error)).toBe(true);
    expect(unreadableRuntime.clearError().error).toBeNull();

    const compressedScene = new THREE.Group();
    const compressed = new THREE.CompressedTexture([], 4, 4);
    const compressedMesh = meshWithMap(compressed);
    compressedScene.add(compressedMesh.mesh);
    const compressedReader = vi.fn(() => readable(4, 4));
    const compressedRuntime = createStudioVrmTexturePaintRuntime(compressedScene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: compressedReader,
    });
    expectFailure(await compressedRuntime.beginStroke({
      pointerId: 2,
      hit: hit(compressedMesh.mesh),
      style: INK,
    }), "source-compressed");
    expect(compressedReader).not.toHaveBeenCalled();
    expect(compressedMesh.material.map).toBe(compressed);

    const invalidScene = new THREE.Group();
    const invalidSource = new THREE.Texture();
    const invalidMesh = meshWithMap(invalidSource);
    invalidScene.add(invalidMesh.mesh);
    const invalidRuntime = createStudioVrmTexturePaintRuntime(invalidScene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: () => ({
        width: 4,
        height: 4,
        data: new Uint8ClampedArray(7),
      }),
    });
    expectFailure(await invalidRuntime.beginStroke({
      pointerId: 3,
      hit: hit(invalidMesh.mesh),
      style: INK,
    }), "invalid-dimensions");
    expect(invalidMesh.material.map).toBe(invalidSource);

    const noUvRuntime = createStudioVrmTexturePaintRuntime(scene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: imageReader(new Map([[source, readable(4, 4)]])),
    });
    expectFailure(await noUvRuntime.beginStroke({
      pointerId: 4,
      hit: { object: mesh, face: { materialIndex: 0 } },
      style: INK,
    }), "uv-missing");

    const noMapScene = new THREE.Group();
    const noMapMaterial = new THREE.MeshBasicMaterial({ map: null });
    const noMapMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), noMapMaterial);
    noMapScene.add(noMapMesh);
    const noMapReader = vi.fn(() => readable(4, 4));
    const noMapRuntime = createStudioVrmTexturePaintRuntime(noMapScene, {
      createCanvas: canvas.createCanvas,
      readTextureImage: noMapReader,
    });
    expectFailure(await noMapRuntime.beginStroke({
      pointerId: 5,
      hit: hit(noMapMesh),
      style: INK,
    }), "map-missing");
    expect(noMapReader).not.toHaveBeenCalled();
  });
});
