import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { executeStudioVrmSurfaceBrushStroke } from "./studio-vrm-surface-brush-provider";
import {
  createStudioVrmSurfaceBrushProgram,
  createStudioVrmSurfacePaintTool,
  inspectStudioVrmSurfaceBrushProgram,
  STUDIO_VRM_SURFACE_PAINT_CAPABILITIES,
  STUDIO_VRM_SURFACE_PAINT_FAILURE_POLICY,
  STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
  STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
  type StudioVrmSurfacePaintBrushSettings,
  type StudioVrmSurfacePaintPointerSample,
  type StudioVrmSurfacePaintToolSnapshot,
} from "./studio-vrm-surface-paint-tool";
import { getStudioVrmTextureGeometryIndex } from "./studio-vrm-texture-geometry-index";
import {
  createStudioVrmTexturePaintRuntime,
  STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  type StudioVrmTexturePaintCanvasFactory,
  type StudioVrmTexturePaintRayHit,
  type StudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintRuntimeResult,
} from "./studio-vrm-texture-paint-runtime";

import type { BrushProgramIR } from "@toonspectrum/studio-project-model";

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

interface Fixture {
  readonly scene: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly texture: THREE.DataTexture;
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly canvas: MemoryCanvas;
}

const SETTINGS: StudioVrmSurfacePaintBrushSettings = Object.freeze({
  color: "#e02040",
  sizeCssPixels: 8,
  opacity: 0.9,
  flow: 0.75,
  hardness: 0.8,
  minSize: 0.2,
});

function geometryWithTwoUvIslands(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // Product VRM primitives are indexed. Keep the fixture on that admitted geometry path so its
  // per-face world/UV density is available; unclassified non-indexed input must remain fail-closed.
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
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

function createFixture(): Fixture {
  const scene = new THREE.Group();
  const texture = new THREE.DataTexture(
    new Uint8Array(64 * 64 * 4),
    64,
    64,
    THREE.RGBAFormat,
  );
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = geometryWithTwoUvIslands();
  // The product runtime consumes a Worker-prewarmed cache at pointerdown. Prime that same cache
  // synchronously in the unit fixture so admission does not depend on an ambient Worker race.
  if (!getStudioVrmTextureGeometryIndex(geometry, {
    uvAttribute: "uv",
    maxTriangles: STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  })) {
    throw new Error("surface-paint fixture geometry index is unavailable");
  }
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  let canvas: MemoryCanvas | null = null;
  const createCanvas = ((width: number, height: number) => {
    canvas = new MemoryCanvas(width, height);
    return canvas as unknown as HTMLCanvasElement;
  }) satisfies StudioVrmTexturePaintCanvasFactory;
  const runtime = createStudioVrmTexturePaintRuntime(scene, { createCanvas });
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

function hit(
  mesh: THREE.Mesh,
  u: number,
  v: number,
  faceIndex: number,
  world: THREE.Vector3,
): StudioVrmTexturePaintRayHit {
  return {
    object: mesh,
    uv: new THREE.Vector2(u, v),
    face: { materialIndex: 0 },
    faceIndex,
    point: world,
  };
}

function pointerSample(
  pointerId: number,
  phase: StudioVrmSurfacePaintPointerSample["phase"],
  options: Readonly<{
    x: number;
    y: number;
    timeStamp: number;
    pressure: number;
    tiltX: number;
    tiltY: number;
    hit: StudioVrmTexturePaintRayHit;
  }>,
): StudioVrmSurfacePaintPointerSample {
  return {
    pointerId,
    pointerType: "pen",
    clientX: options.x,
    clientY: options.y,
    timeStamp: options.timeStamp,
    pressure: options.pressure,
    tiltX: options.tiltX,
    tiltY: options.tiltY,
    phase,
    hit: options.hit,
    worldUnitsPerCssPixel: 0.01,
  };
}

function strokeSamples(fixture: Fixture, pointerId = 7) {
  const firstHit = hit(
    fixture.mesh,
    0.2,
    0.2,
    0,
    new THREE.Vector3(0.2, 0.2, 0),
  );
  const secondHit = hit(
    fixture.mesh,
    0.8,
    0.8,
    1,
    new THREE.Vector3(1.8, 0.2, 0),
  );
  return [
    pointerSample(pointerId, "down", {
      x: 12,
      y: 20,
      timeStamp: 100,
      pressure: 0.123456789,
      tiltX: 20,
      tiltY: 10,
      hit: firstHit,
    }),
    pointerSample(pointerId, "move", {
      x: 24,
      y: 22,
      timeStamp: 108,
      pressure: 0.987654321,
      tiltX: -30,
      tiltY: 40,
      hit: secondHit,
    }),
    pointerSample(pointerId, "up", {
      x: 24.25,
      y: 22.1,
      timeStamp: 110,
      pressure: 0.75,
      tiltX: -25,
      tiltY: 35,
      hit: secondHit,
    }),
  ] as const;
}

function unwrap<T>(result: StudioVrmTexturePaintRuntimeResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function alphaCount(pixels: Uint8Array | Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0) count += 1;
  }
  return count;
}

function disposeFixture(fixture: Fixture): void {
  fixture.runtime.dispose();
  fixture.mesh.geometry.dispose();
  fixture.material.dispose();
  fixture.texture.dispose();
}

describe("Studio VRM V12 surface-paint product tool", () => {
  it("keeps round/no-mixing supported and names every unproved semantic", () => {
    const supported = createStudioVrmSurfaceBrushProgram(SETTINGS);
    expect(inspectStudioVrmSurfaceBrushProgram(supported).supported).toBe(true);
    expect(STUDIO_VRM_SURFACE_PAINT_CAPABILITIES).toMatchObject({
      providerId: "three-vrm-texture-paint",
      tip: { round: "supported", stamp: "unsupported", image: "unsupported" },
      mixing: { none: "supported", smudge: "unsupported", wet: "unsupported" },
      failurePolicy: {
        automaticAlternateBrushSelectionAllowed: false,
        sourceState: "preserved",
        lastCommit: "preserved",
        nextOperation: "select-provider-or-tool",
      },
      hotPathGpuReadback: false,
    });
    expect(STUDIO_VRM_SURFACE_PAINT_CAPABILITIES).not.toHaveProperty("fallback");
    expect(STUDIO_VRM_SURFACE_PAINT_FAILURE_POLICY).toMatchObject({
      automaticAlternateBrushSelectionAllowed: false,
      nextOperation: "select-provider-or-tool",
    });

    for (const tip of ["stamp", "image"] as const) {
      const program: BrushProgramIR = { ...supported, tip: { ...supported.tip, kind: tip } };
      expect(inspectStudioVrmSurfaceBrushProgram(program)).toMatchObject({
        supported: false,
        errorCode: "unsupported-tip",
      });
    }
    for (const mixing of ["smudge", "wet"] as const) {
      const program: BrushProgramIR = {
        ...supported,
        mixing: { kind: mixing, strength: 0.5 },
      };
      expect(inspectStudioVrmSurfaceBrushProgram(program)).toMatchObject({
        supported: false,
        errorCode: "unsupported-mixing",
      });
    }
  });

  it("fails closed with explicit receipts and never replaces the selected surface tool", async () => {
    const fixture = createFixture();
    const samples = strokeSamples(fixture);
    const tool = createStudioVrmSurfacePaintTool();

    const unavailable = tool.begin({
      runtime: null,
      settings: SETTINGS,
      sample: samples[0],
    });
    expect(unavailable).toMatchObject({
      ok: false,
      status: "unavailable",
      reason: "runtime-unavailable",
      selectedToolId: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
      selectedProviderId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
      sourceState: "preserved",
      lastCommit: null,
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    expect(unavailable).not.toHaveProperty("route");

    const invalid = tool.begin({
      runtime: fixture.runtime,
      settings: { ...SETTINGS, sizeCssPixels: Number.NaN },
      sample: samples[0],
    });
    expect(invalid).toMatchObject({
      ok: false,
      status: "rejected",
      reason: "invalid-input",
      sourceState: "preserved",
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    expect(invalid).not.toHaveProperty("route");

    const missingFaceIndex = tool.begin({
      runtime: fixture.runtime,
      settings: SETTINGS,
      sample: {
        ...samples[0],
        hit: { ...samples[0].hit, faceIndex: null },
      },
    });
    expect(missingFaceIndex).toMatchObject({
      ok: false,
      status: "rejected",
      reason: "unsupported-face-index",
      sourceState: "preserved",
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    expect(missingFaceIndex).not.toHaveProperty("route");

    expect(tool.begin({ runtime: fixture.runtime, settings: SETTINGS, sample: samples[0] }))
      .toMatchObject({ ok: true, status: "accepted", route: "surface-brush" });
    const collectingSnapshot = tool.getSnapshot();
    const busy = tool.begin({
      runtime: fixture.runtime,
      settings: SETTINGS,
      sample: { ...samples[0], pointerId: samples[0].pointerId + 1 },
    });
    expect(busy).toMatchObject({
      ok: false,
      status: "unavailable",
      reason: "busy",
      sourceState: "preserved",
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    expect(busy).not.toHaveProperty("route");
    expect(tool.getSnapshot()).toBe(collectingSnapshot);
    expect(tool.cancel("pointer-cancel", samples[0].pointerId)).toBe(true);

    const prepared = unwrap(await fixture.runtime.prepareSurfaceBrushSession({
      hit: samples[0].hit,
      pressure: samples[0].pressure,
    }));
    const runtimeBusy = tool.begin({
      runtime: fixture.runtime,
      settings: SETTINGS,
      sample: samples[0],
    });
    expect(runtimeBusy).toMatchObject({
      ok: false,
      status: "unavailable",
      reason: "busy",
      sourceState: "preserved",
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    unwrap(fixture.runtime.cancelSurfaceBrushSession(prepared.session));

    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    tool.dispose();
    const disposed = tool.begin({
      runtime: fixture.runtime,
      settings: SETTINGS,
      sample: samples[0],
    });
    expect(disposed).toMatchObject({
      ok: false,
      status: "unavailable",
      reason: "tool-disposed",
      sourceState: "preserved",
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    disposeFixture(fixture);
  });

  it("commits one seam-safe atlas transaction and replays deterministically after undo", async () => {
    const fixture = createFixture();
    const commit = vi.spyOn(fixture.runtime, "commitSurfaceBrushSession");
    const snapshots: StudioVrmSurfacePaintToolSnapshot[] = [];
    const tool = createStudioVrmSurfacePaintTool({
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    const samples = strokeSamples(fixture);

    expect(tool.begin({ runtime: fixture.runtime, settings: SETTINGS, sample: samples[0] }))
      .toEqual({
        ok: true,
        status: "accepted",
        route: "surface-brush",
        selectedToolId: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
        selectedProviderId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
      });
    expect(tool.append(samples[1])).toBe(true);
    expect(tool.append(samples[2])).toBe(true);
    const first = await tool.finish(samples[0].pointerId);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(String(first.error));

    expect(commit).toHaveBeenCalledOnce();
    expect(first.execution.receipt).toMatchObject({
      committed: true,
      inputSamples: 3,
      runs: 2,
      seamBreaks: 1,
    });
    expect(first.stroke.samples.map((sample) => sample.pressure)).toEqual([
      0.123456789,
      0.987654321,
      0.75,
    ]);
    expect(first.stroke.samples[0]?.altitudeDeg).toBeCloseTo(90 - Math.hypot(20, 10), 10);
    expect(first.stroke.samples[1]?.azimuthDeg).not.toBe(0);
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(1);
    const firstPixels = Uint8Array.from(
      unwrap(fixture.runtime.exportPaintedTargets())[0]!.pixels,
    );
    expect(alphaCount(firstPixels)).toBeGreaterThan(0);
    expect(snapshots.at(-1)).toMatchObject({
      status: "ready",
      lastCommit: { runs: 2, seamBreaks: 1 },
    });

    expect(unwrap(fixture.runtime.undo())).toBe(true);
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);

    expect(tool.begin({ runtime: fixture.runtime, settings: SETTINGS, sample: samples[0] }))
      .toEqual({
        ok: true,
        status: "accepted",
        route: "surface-brush",
        selectedToolId: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
        selectedProviderId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
      });
    tool.append(samples[1]);
    tool.append(samples[2]);
    const second = await tool.finish(samples[0].pointerId);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(String(second.error));
    const secondPixels = Uint8Array.from(
      unwrap(fixture.runtime.exportPaintedTargets())[0]!.pixels,
    );

    expect(commit).toHaveBeenCalledTimes(2);
    expect(second.execution.operations).toEqual(first.execution.operations);
    expect(secondPixels).toEqual(firstPixels);
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(1);

    const lastGood = tool.getSnapshot().lastCommit;
    const rejected = tool.begin({
      runtime: fixture.runtime,
      settings: { ...SETTINGS, color: "not-a-color" },
      sample: samples[0],
    });
    expect(rejected).toMatchObject({
      ok: false,
      status: "rejected",
      reason: "invalid-input",
      sourceState: "preserved",
      lastCommit: lastGood,
      alternateBrushSelected: false,
      nextOperation: "select-provider-or-tool",
    });
    expect(tool.getSnapshot().lastCommit).toBe(lastGood);
    expect(Uint8Array.from(unwrap(fixture.runtime.exportPaintedTargets())[0]!.pixels))
      .toEqual(secondPixels);
    tool.dispose();
    disposeFixture(fixture);
  });

  it("aborts an in-flight transaction on pointer leave without reporting a commit", async () => {
    const fixture = createFixture();
    const executeStroke: typeof executeStudioVrmSurfaceBrushStroke = (input) =>
      new Promise((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(new Error("injected abort")),
          { once: true },
        );
      });
    const tool = createStudioVrmSurfacePaintTool({ executeStroke });
    const samples = strokeSamples(fixture);

    tool.begin({ runtime: fixture.runtime, settings: SETTINGS, sample: samples[0] });
    tool.append(samples[1]);
    const finishing = tool.finish(samples[0].pointerId);
    expect(tool.cancel("pointer-leave", samples[0].pointerId)).toBe(true);
    expect(tool.getSnapshot().status).toBe("cancelling");
    const result = await finishing;

    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(tool.getSnapshot()).toMatchObject({
      status: "ready",
      activePointerId: null,
      lastCommit: null,
    });
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    tool.dispose();
    disposeFixture(fixture);
  });

  it("surfaces upload failure after the runtime rolls pixels and history back", async () => {
    const fixture = createFixture();
    const samples = strokeSamples(fixture);
    const prepared = unwrap(await fixture.runtime.prepareSurfaceBrushSession({
      hit: samples[0].hit,
      pressure: samples[0].pressure,
    }));
    unwrap(fixture.runtime.cancelSurfaceBrushSession(prepared.session));
    fixture.canvas.failNextPuts = 1;
    const tool = createStudioVrmSurfacePaintTool();

    tool.begin({ runtime: fixture.runtime, settings: SETTINGS, sample: samples[0] });
    tool.append(samples[1]);
    tool.append(samples[2]);
    const result = await tool.finish(samples[0].pointerId);

    expect(result.ok).toBe(false);
    expect(tool.getSnapshot()).toMatchObject({ status: "error", errorCode: "upload" });
    expect(fixture.runtime.getSnapshot().activeOperation).toBeNull();
    expect(fixture.runtime.getSnapshot().history.undoCount).toBe(0);
    expect(unwrap(fixture.runtime.exportPaintedTargets())).toEqual([]);
    expect(alphaCount(fixture.canvas.frame)).toBe(0);
    tool.dispose();
    disposeFixture(fixture);
  });
});
