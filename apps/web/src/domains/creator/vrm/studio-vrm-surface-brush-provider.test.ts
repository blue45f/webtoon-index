import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  executeSurfaceBrushStroke,
  SurfaceBrushCancelledError,
} from "../../../../../../packages/studio-brush-platform/src/brush-composition";
import { createStudioThreeMeshBvhProvider } from "../studio-three-mesh-bvh-provider";

import {
  adaptThreeRaycastIntersection,
  executeStudioVrmSurfaceBrushStroke,
  prepareStudioVrmSurfaceProjectionProvider,
} from "./studio-vrm-surface-brush-provider";
import {
  canonicalizeStudioVrmSurfaceIslandId,
  createStudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintCanvasFactory,
  type StudioVrmTexturePaintRayHit,
  type StudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintRuntimeResult,
} from "./studio-vrm-texture-paint-runtime";

import type { BrushProgramIR, StrokeIR } from "@toonspectrum/studio-project-model";

class MemoryCanvas {
  width: number;
  height: number;
  frame: Uint8ClampedArray;
  putCount = 0;
  failNextPuts = 0;

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
      if (this.failNextPuts > 0) {
        this.failNextPuts -= 1;
        throw new DOMException("injected canvas upload failure", "InvalidStateError");
      }
      this.frame = Uint8ClampedArray.from(imageData.data);
      this.putCount += 1;
    },
  };

  getContext(contextId: string) {
    return contextId === "2d" ? this.context : null;
  }
}

interface SurfaceFixture {
  readonly scene: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly texture: THREE.DataTexture;
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly canvas: MemoryCanvas;
}

const PROGRAM: BrushProgramIR = {
  id: "surface-round-ink",
  name: "Surface round ink",
  stabilizer: { kind: "none", strength: 0, predictionMs: 0 },
  sizeDynamics: [{ input: "pressure", curve: [0, 1], min: 0.35, max: 1 }],
  flowDynamics: [{ input: "pressure", curve: [0, 1], min: 0.2, max: 1 }],
  geometry: {
    kind: "perfect-freehand",
    thinning: 0.75,
    smoothing: 0.5,
    streamline: 0.5,
    capStart: true,
    capEnd: true,
  },
  tip: {
    kind: "round",
    hardness: 0.8,
    spacingPct: 30,
    angleJitterDeg: 0,
  },
  mixing: { kind: "none", strength: 0 },
  output: { target: "raster-tiles", bake: "editable-proxy" },
  providerPreference: ["three-vrm-texture-paint"],
};

const POINTER_STYLE = Object.freeze({
  kind: "ink" as const,
  color: "#000000",
  sizeTexels: 2,
  opacity: 1,
  blend: "normal" as const,
});

function stroke(
  pressures: readonly number[] = [0.123456789, 0.987654321],
): StrokeIR {
  return {
    id: "surface-stroke-1",
    brushPresetId: PROGRAM.id,
    seed: 17,
    color: { r: 0.9, g: 0.15, b: 0.05, a: 0.95 },
    baseSizePx: 5,
    samples: pressures.map((pressure, index) => ({
      x: 12 + index * 12,
      y: 20 + index * 2,
      tMs: index * 8,
      pressure,
      velocity: index === 0 ? 0 : 1.5,
      altitudeDeg: 72,
      azimuthDeg: 25,
    })),
  };
}

function geometryWithTwoUvIslands(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 0, 0,
      2, 0, 0,
      2, 1, 0,
    ], 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([
      0.05, 0.05,
      0.45, 0.05,
      0.05, 0.45,
      0.55, 0.55,
      0.95, 0.55,
      0.95, 0.95,
    ], 2),
  );
  return geometry;
}

function createFixture(twoIslands = false): SurfaceFixture {
  const scene = new THREE.Group();
  const pixels = new Uint8Array(64 * 64 * 4);
  const texture = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat);
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = twoIslands
    ? geometryWithTwoUvIslands()
    : new THREE.PlaneGeometry(2, 2, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  let canvas: MemoryCanvas | null = null;
  const createCanvas = ((width: number, height: number) => {
    canvas = new MemoryCanvas(width, height);
    return canvas as unknown as HTMLCanvasElement;
  }) satisfies StudioVrmTexturePaintCanvasFactory;
  const runtime = createStudioVrmTexturePaintRuntime(scene, { createCanvas });
  // Canvas creation is lazy. Tests use this getter only after preparation.
  return {
    scene,
    mesh,
    material,
    texture,
    runtime,
    get canvas() {
      if (!canvas) throw new Error("surface target has not been prepared");
      return canvas;
    },
  };
}

function rayHit(
  mesh: THREE.Mesh,
  u: number,
  v: number,
  faceIndex: number | undefined,
  world = new THREE.Vector3(u, v, 0),
): StudioVrmTexturePaintRayHit {
  return {
    object: mesh,
    uv: new THREE.Vector2(u, v),
    face: { materialIndex: 0 },
    ...(faceIndex === undefined ? {} : { faceIndex }),
    point: world,
  };
}

function unwrap<T>(result: StudioVrmTexturePaintRuntimeResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function disposeFixture(fixture: SurfaceFixture): void {
  fixture.runtime.dispose();
  fixture.mesh.geometry.dispose();
  fixture.material.dispose();
  fixture.texture.dispose();
}

function nonZeroAlphaCount(pixels: Uint8Array | Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0) count += 1;
  }
  return count;
}

describe("Studio VRM SurfaceProjectionProvider product bridge", () => {
  it("canonicalizes numeric and textual island ids without collisions", () => {
    expect(canonicalizeStudioVrmSurfaceIslandId(1)).toBe("number:1");
    expect(canonicalizeStudioVrmSurfaceIslandId("1")).toBe("string:1");
    expect(canonicalizeStudioVrmSurfaceIslandId(-0)).toBe("number:-0");
    expect(canonicalizeStudioVrmSurfaceIslandId(Number.NaN)).toBeNull();
    expect(canonicalizeStudioVrmSurfaceIslandId("")).toBeNull();
  });

  it("consumes an installed Three Raycaster hit verified by the real BVH provider", async () => {
    const fixture = createFixture();
    fixture.scene.updateMatrixWorld(true);
    const origin = new THREE.Vector3(0.2, 0.1, 2);
    const direction = new THREE.Vector3(0, 0, -1);
    const raycaster = new THREE.Raycaster(origin, direction, 0, 10);
    const intersection = raycaster.intersectObject(fixture.mesh, false)[0];
    expect(intersection).toBeDefined();
    const bvh = createStudioThreeMeshBvhProvider({
      geometry: fixture.mesh.geometry,
      three: THREE,
      geometryOwnership: "borrowed",
    });
    const bvhHit = await bvh.raycastFirst({
      originWorld: [origin.x, origin.y, origin.z],
      directionWorld: [direction.x, direction.y, direction.z],
      farWorld: 10,
    });
    expect(bvhHit.result?.faceIndex).toBe(intersection!.faceIndex);
    expect(bvhHit.result?.worldPoint).toEqual([
      intersection!.point.x,
      intersection!.point.y,
      intersection!.point.z,
    ]);

    const result = await executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: stroke([0.625]),
      rayHits: [adaptThreeRaycastIntersection(intersection!)],
      texelDensityBySample: [1],
    });
    expect(result.receipt.projectedSamples).toBe(1);
    expect(result.operations[0]?.triangleId).toContain(
      `face:${String(intersection!.faceIndex)}`,
    );
    expect(nonZeroAlphaCount(unwrap(fixture.runtime.exportPaintedTargets())[0]!.pixels))
      .toBeGreaterThan(0);
    await bvh.destroy();
    disposeFixture(fixture);
  });

  it("exposes real triangle/island/seam metadata and holds one primary surface owner", async () => {
    const fixture = createFixture(true);
    const inputStroke = stroke();
    const first = rayHit(fixture.mesh, 0.2, 0.2, 0, new THREE.Vector3(0.2, 0.2, 0));
    const second = rayHit(fixture.mesh, 0.8, 0.8, 1, new THREE.Vector3(1.8, 0.2, 0));
    const prepared = await prepareStudioVrmSurfaceProjectionProvider({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [first, second],
      texelDensityBySample: [1.25, 1.25],
    });

    expect(fixture.runtime.getSnapshot().activeOperation).toBe("surface-brush");
    const firstProjection = prepared.provider.projectSample(inputStroke.samples[0]!, {
      sampleIndex: 0,
      strokeId: inputStroke.id,
      brushProgramId: PROGRAM.id,
    });
    const secondProjection = prepared.provider.projectSample(inputStroke.samples[1]!, {
      sampleIndex: 1,
      strokeId: inputStroke.id,
      brushProgramId: PROGRAM.id,
    });
    expect(firstProjection?.triangleId).toContain("face:0");
    expect(secondProjection?.triangleId).toContain("face:1");
    expect(secondProjection?.islandId).not.toBe(firstProjection?.islandId);
    expect(secondProjection?.seamBefore).toBe(true);
    expect(secondProjection?.world).toEqual({ x: 1.8, y: 0.2, z: 0 });
    const pointerAttempt = await fixture.runtime.beginStroke({
      pointerId: 8,
      hit: first,
      style: POINTER_STYLE,
    });
    expect(pointerAttempt).toMatchObject({ ok: false, error: { code: "pointer-active" } });

    prepared.cancel();
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("commits non-neutral atlas pixels, preserves pressure precision, and is deterministic", async () => {
    const fixture = createFixture();
    const inputStroke = stroke();
    const hits = [
      rayHit(fixture.mesh, 0.35, 0.45, 0),
      rayHit(fixture.mesh, 0.55, 0.48, 0),
    ];
    const first = await executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: hits,
    });

    expect(first.receipt.committed).toBe(true);
    expect(first.receipt.commitReceipt?.changedTexels).toBeGreaterThan(0);
    expect(first.operations.find((operation) => operation.sampleIndex === 0)?.pressure)
      .toBe(inputStroke.samples[0]!.pressure);
    expect(first.operations.at(-1)?.pressure).toBe(inputStroke.samples[1]!.pressure);
    const firstExport = unwrap(fixture.runtime.exportPaintedTargets());
    expect(firstExport).toHaveLength(1);
    expect(nonZeroAlphaCount(firstExport[0]!.pixels)).toBeGreaterThan(0);
    expect(fixture.canvas.putCount).toBeGreaterThanOrEqual(2);

    expect(unwrap(fixture.runtime.undo())).toBe(true);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    const second = await executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: hits,
    });
    const secondExport = unwrap(fixture.runtime.exportPaintedTargets());
    expect(second.operations).toEqual(first.operations);
    expect(second.pixels).toEqual(first.pixels);
    expect(secondExport[0]!.pixels).toEqual(firstExport[0]!.pixels);
    disposeFixture(fixture);
  });

  it("splits disconnected UV islands without drawing an interpolated seam bridge", async () => {
    const fixture = createFixture(true);
    const result = await executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: stroke(),
      rayHits: [
        rayHit(fixture.mesh, 0.2, 0.2, 0, new THREE.Vector3(0.2, 0.2, 0)),
        rayHit(fixture.mesh, 0.8, 0.8, 1, new THREE.Vector3(1.8, 0.2, 0)),
      ],
      texelDensityBySample: [1, 1],
    });

    expect(result.receipt.seamBreaks).toBe(1);
    expect(result.receipt.runs).toBe(2);
    expect(new Set(result.operations.map((operation) => operation.run))).toEqual(new Set([0, 1]));
    expect(result.warnings.some((warning) => warning.includes("provider marked seamBefore")))
      .toBe(true);
    expect(result.operations.filter((operation) => operation.run === 1)).toHaveLength(1);
    disposeFixture(fixture);
  });

  it("rejects the removed second ray-hit lane instead of retrying a miss", async () => {
    const fixture = createFixture();
    const inputStroke = stroke();
    const first = rayHit(fixture.mesh, 0.25, 0.4, 0);
    const second = rayHit(fixture.mesh, 0.65, 0.4, 0);
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [first, null],
      fallbackRayHits: [null, second],
      texelDensityBySample: [1, 1],
    } as unknown as Parameters<typeof executeStudioVrmSurfaceBrushStroke>[0]))
      .rejects.toMatchObject({ code: "automatic-fallback-forbidden" });
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("cancels a prepared real provider without retaining pixels or history", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const inputStroke = stroke();
    const prepared = await prepareStudioVrmSurfaceProjectionProvider({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [
        rayHit(fixture.mesh, 0.3, 0.4, 0),
        rayHit(fixture.mesh, 0.5, 0.4, 0),
      ],
      texelDensityBySample: [1, 1],
      signal: controller.signal,
    });
    controller.abort("test cancellation");

    expect(() => executeSurfaceBrushStroke(
      PROGRAM,
      inputStroke,
      prepared.provider,
      { signal: controller.signal },
    )).toThrow(SurfaceBrushCancelledError);
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("rolls all texels back when the runtime-owned dirty upload fails", async () => {
    const fixture = createFixture();
    const inputStroke = stroke();
    const hits = [
      rayHit(fixture.mesh, 0.3, 0.4, 0),
      rayHit(fixture.mesh, 0.6, 0.4, 0),
    ];
    const preflight = unwrap(await fixture.runtime.prepareSurfaceBrushSession({
      hit: hits[0]!,
      pressure: inputStroke.samples[0]!.pressure,
    }));
    unwrap(fixture.runtime.cancelSurfaceBrushSession(preflight.session));
    fixture.canvas.failNextPuts = 1;

    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: hits,
      texelDensityBySample: [1, 1],
    })).rejects.toMatchObject({ code: "runtime-commit-failed" });
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    expect(nonZeroAlphaCount(fixture.canvas.frame)).toBe(0);
    disposeFixture(fixture);
  });

  it("fails explicitly when triangle identity or a measured tap density is unavailable", async () => {
    const fixture = createFixture();
    const inputStroke = stroke([0.5]);
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 0.5, 0.5, undefined)],
    })).rejects.toMatchObject({ code: "triangle-index-missing", sampleIndex: 0 });
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 0.5, 0.5, 0)],
    })).rejects.toMatchObject({ code: "texel-density-unavailable", sampleIndex: 0 });
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("rejects NaN UV and density overflow without leaving an active lease", async () => {
    const fixture = createFixture();
    const inputStroke = stroke([0.5]);
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, Number.NaN, 0.5, 0)],
      texelDensityBySample: [1],
    })).rejects.toMatchObject({ code: "runtime-prepare-failed" });
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 0.5, 0.5, 0)],
      texelDensityBySample: [Number.POSITIVE_INFINITY],
    })).rejects.toMatchObject({ code: "texel-density-unavailable" });
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 0.5, 0.5, 0)],
      texelDensityBySample: [1e9],
    })).rejects.toThrow(/radius must be finite/iu);
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("rejects cross-texture provider hits and cancels the original target lease", async () => {
    const first = createFixture();
    const secondPixels = new Uint8Array(64 * 64 * 4);
    const secondTexture = new THREE.DataTexture(secondPixels, 64, 64, THREE.RGBAFormat);
    secondTexture.flipY = false;
    const secondMaterial = new THREE.MeshBasicMaterial({ map: secondTexture });
    const secondMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), secondMaterial);
    first.scene.add(secondMesh);
    const inputStroke = stroke();

    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: first.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [
        rayHit(first.mesh, 0.3, 0.4, 0),
        rayHit(secondMesh, 0.6, 0.4, 0),
      ],
      texelDensityBySample: [1, 1],
    })).rejects.toMatchObject({ code: "runtime-projection-failed", sampleIndex: 1 });
    expect(first.runtime.getSnapshot().activeOperation).toBeNull();
    expect(unwrap(first.runtime.exportPaintedTargets())).toEqual([]);

    secondMesh.geometry.dispose();
    secondMaterial.dispose();
    secondTexture.dispose();
    disposeFixture(first);
  });

  it("quarantines unsupported stamp tips while releasing the real provider session", async () => {
    const fixture = createFixture();
    const inputStroke = stroke([0.7]);
    const stampProgram: BrushProgramIR = {
      ...PROGRAM,
      tip: { ...PROGRAM.tip, kind: "stamp", imageAssetId: "asset/stamp" },
    };
    await expect(executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: stampProgram,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 0.5, 0.5, 0)],
      texelDensityBySample: [1],
    })).rejects.toThrow(/provider-specific stamp sampler/iu);
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    disposeFixture(fixture);
  });

  it("normalizes repeat-wrapped ray UVs through the existing sampler contract", async () => {
    const fixture = createFixture();
    fixture.texture.wrapS = THREE.RepeatWrapping;
    const inputStroke = stroke([0.6]);
    const prepared = await prepareStudioVrmSurfaceProjectionProvider({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke: inputStroke,
      rayHits: [rayHit(fixture.mesh, 1.25, 0.5, 0)],
      texelDensityBySample: [1],
    });
    const projection = prepared.provider.projectSample(inputStroke.samples[0]!, {
      sampleIndex: 0,
      strokeId: inputStroke.id,
      brushProgramId: PROGRAM.id,
    });
    expect(projection?.u).toBeCloseTo(0.25, 12);
    expect(prepared.warnings).toContain(
      "surface.adapter.primary.sample[0]: sampler wrap normalized the ray-hit UV",
    );
    prepared.cancel();
    disposeFixture(fixture);
  });
});
