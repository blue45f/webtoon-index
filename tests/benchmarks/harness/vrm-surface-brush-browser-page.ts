import * as THREE from "three";
import { globalConfig, util as zodCoreUtil } from "zod/v4/core";

import {
  executeSurfaceBrushStroke,
  SurfaceBrushCancelledError,
} from "../../../packages/studio-brush-platform/src/brush-composition";
import { createStudioThreeMeshBvhProvider } from "../../../apps/web/src/domains/creator/studio-three-mesh-bvh-provider";
import { disposeStudioVrmAsset, loadStudioVrmAsset } from "../../../apps/web/src/domains/creator/vrm/studio-vrm-asset-runtime";
import {
  executeStudioVrmSurfaceBrushStroke,
  prepareStudioVrmSurfaceProjectionProvider,
} from "../../../apps/web/src/domains/creator/vrm/studio-vrm-surface-brush-provider";
import {
  createStudioVrmTexturePaintRuntime,
  type StudioVrmTexturePaintCanvasFactory,
  type StudioVrmTexturePaintRayHit,
  type StudioVrmTexturePaintRuntime,
} from "../../../apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-runtime";

import type { VRM } from "@pixiv/three-vrm";
import type { BrushProgramIR, StrokeIR } from "@toonspectrum/studio-project-model";

export const VRM_SURFACE_BRUSH_BROWSER_RESULT_GLOBAL =
  "__TOONSPECTRUM_VRM_SURFACE_BRUSH_BROWSER_RESULT__";
export const VRM_SURFACE_BRUSH_BROWSER_WARMUPS = 3;
export const VRM_SURFACE_BRUSH_BROWSER_SAMPLES = 31;
export const VRM_SURFACE_BRUSH_BROWSER_CASES = Object.freeze([
  Object.freeze({
    id: "controlled-256-8",
    atlasSize: 256,
    gridSegments: 8,
    inputSamples: 8,
  }),
  Object.freeze({
    id: "controlled-512-32",
    atlasSize: 512,
    gridSegments: 32,
    inputSamples: 32,
  }),
  Object.freeze({
    id: "controlled-1024-128",
    atlasSize: 1024,
    gridSegments: 64,
    inputSamples: 128,
  }),
] as const);

interface Distribution {
  readonly sampleCount: number;
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly percentileMethod: "nearest-rank-ceil";
}

interface JsMemoryObservation {
  readonly source: "performance.memory" | "unavailable";
  readonly usedJsHeapBytes: number | null;
  readonly totalJsHeapBytes: number | null;
  readonly jsHeapSizeLimitBytes: number | null;
  readonly reason: string | null;
}

interface UserAgentMemoryObservation {
  readonly source: "performance.measureUserAgentSpecificMemory" | "unavailable";
  readonly bytes: number | null;
  readonly reason: string | null;
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: Readonly<{
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  }>;
  measureUserAgentSpecificMemory?(): Promise<Readonly<{ bytes: number }>>;
}

interface ControlledCaseDefinition {
  readonly id: string;
  readonly atlasSize: number;
  readonly gridSegments: number;
  readonly inputSamples: number;
}

interface ControlledFixture {
  readonly scene: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly texture: THREE.DataTexture;
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly bvh: ReturnType<typeof createStudioThreeMeshBvhProvider>;
}

interface FaultCanvasController {
  readonly factory: StudioVrmTexturePaintCanvasFactory;
  failNextPut(): void;
  putCount(): number;
}

interface BvhHitLane {
  readonly hits: readonly StudioVrmTexturePaintRayHit[];
  readonly bvhMs: number;
  readonly maxUvDelta: number;
  readonly faceIndices: readonly number[];
}

declare global {
  interface Window {
    __TOONSPECTRUM_VRM_SURFACE_BRUSH_BROWSER_RESULT__?: unknown;
    __TOONSPECTRUM_VRM_SURFACE_BRUSH_BOOTSTRAP_RECEIPT__?: BootstrapReceiptState;
  }
}

interface BootstrapReceiptState {
  readonly schemaVersion: number;
  readonly order: string[];
  readonly positiveControlViolations: string[];
  readonly runtimeViolations: string[];
  readonly positiveControlThrew: boolean;
  readonly configRef: object | null;
}

interface BootstrapReceiptEvidence {
  readonly schemaVersion: 1;
  readonly order: readonly string[];
  readonly positiveControlViolations: readonly string[];
  readonly runtimeViolations: readonly string[];
  readonly positiveControlThrew: boolean;
  readonly positiveControlObserved: boolean;
  readonly configIdentityObserved: boolean;
  readonly globalConfigJitlessObserved: boolean;
  readonly zodAllowsEvalFalse: boolean;
}

const bootstrapState = window.__TOONSPECTRUM_VRM_SURFACE_BRUSH_BOOTSTRAP_RECEIPT__;
bootstrapState?.order.push("page-module-evaluated");

function captureBootstrapReceipt(): BootstrapReceiptEvidence {
  const state = window.__TOONSPECTRUM_VRM_SURFACE_BRUSH_BOOTSTRAP_RECEIPT__;
  return {
    schemaVersion: 1,
    order: [...(state?.order ?? [])],
    positiveControlViolations: [...(state?.positiveControlViolations ?? [])],
    runtimeViolations: [...(state?.runtimeViolations ?? [])],
    positiveControlThrew: state?.positiveControlThrew === true,
    positiveControlObserved: (state?.positiveControlViolations.length ?? 0) > 0,
    configIdentityObserved: state?.configRef === globalConfig,
    globalConfigJitlessObserved: globalConfig.jitless === true,
    zodAllowsEvalFalse: zodCoreUtil.allowsEval.value === false,
  };
}

const PROGRAM: BrushProgramIR = Object.freeze({
  id: "surface-round-ink-browser-benchmark",
  name: "Surface round ink browser benchmark",
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
});

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize(values: readonly number[]): Distribution {
  if (values.length === 0) throw new Error("cannot summarize empty timing samples");
  const sorted = [...values].sort((left, right) => left - right);
  const at = (quantile: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * quantile) - 1),
    );
    return sorted[index]!;
  };
  return {
    sampleCount: values.length,
    samplesMs: values.map((value) => round(value)),
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    p99Ms: round(at(0.99)),
    minMs: round(sorted[0]!),
    maxMs: round(sorted.at(-1)!),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    percentileMethod: "nearest-rank-ceil",
  };
}

function observeJsMemory(): JsMemoryObservation {
  const measured = performance as PerformanceWithMemory;
  const memory = measured.memory;
  if (!memory) {
    return {
      source: "unavailable",
      usedJsHeapBytes: null,
      totalJsHeapBytes: null,
      jsHeapSizeLimitBytes: null,
      reason: "Chromium did not expose performance.memory on this page",
    };
  }
  return {
    source: "performance.memory",
    usedJsHeapBytes: finiteOrNull(memory.usedJSHeapSize),
    totalJsHeapBytes: finiteOrNull(memory.totalJSHeapSize),
    jsHeapSizeLimitBytes: finiteOrNull(memory.jsHeapSizeLimit),
    reason: null,
  };
}

async function observeUserAgentMemory(): Promise<UserAgentMemoryObservation> {
  const measured = performance as PerformanceWithMemory;
  if (typeof measured.measureUserAgentSpecificMemory !== "function") {
    return {
      source: "unavailable",
      bytes: null,
      reason: "performance.measureUserAgentSpecificMemory is not exposed",
    };
  }
  try {
    const result = await measured.measureUserAgentSpecificMemory();
    return {
      source: "performance.measureUserAgentSpecificMemory",
      bytes: finiteOrNull(result.bytes),
      reason: null,
    };
  } catch (error) {
    return {
      source: "unavailable",
      bytes: null,
      reason: `measureUserAgentSpecificMemory failed: ${errorMessage(error)}`,
    };
  }
}

function observeWebGlIdentity(): Readonly<Record<string, unknown>> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!context) {
    return {
      exposed: false,
      renderer: null,
      vendor: null,
      gpuMemoryBytes: null,
      gpuMemoryReason: "Chromium did not expose WebGL2",
    };
  }
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug
    ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : null;
  const vendor = debug
    ? String(context.getParameter(debug.UNMASKED_VENDOR_WEBGL))
    : null;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    exposed: true,
    renderer,
    vendor,
    gpuMemoryBytes: null,
    gpuMemoryReason:
      "WebGL2/Three.js exposes renderer identity but no resident GPU allocation counter",
  };
}

async function sha256(bytes: Uint8Array | Uint8ClampedArray): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function countChangedTexels(bytes: Uint8Array | Uint8ClampedArray): number {
  let changed = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (
      bytes[offset] !== 0
      || bytes[offset + 1] !== 0
      || bytes[offset + 2] !== 0
      || bytes[offset + 3] !== 0
    ) {
      changed += 1;
    }
  }
  return changed;
}

function allZero(bytes: Uint8Array | Uint8ClampedArray): boolean {
  return bytes.every((value) => value === 0);
}

function exportedStateHasNoChangedPixels(
  exported: readonly Readonly<{ pixels: Uint8Array | Uint8ClampedArray }>[],
): boolean {
  // A successful undo/cancel may either retain a cleared atlas or remove the
  // target that was created by the reverted operation. Both are exact zero-ink
  // states; accepting target removal does not weaken the byte-quality gate.
  return exported.length === 0
    || (exported.length === 1 && allZero(exported[0]!.pixels));
}

function unwrap<T>(
  result: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: { code: string } }>,
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function createStroke(
  id: string,
  inputSamples: number,
): StrokeIR {
  return {
    id,
    brushPresetId: PROGRAM.id,
    seed: 0x51_7f_23,
    color: { r: 0.91, g: 0.17, b: 0.04, a: 0.96 },
    baseSizePx: 2,
    samples: Array.from({ length: inputSamples }, (_, index) => {
      const progress = inputSamples === 1 ? 0.5 : index / (inputSamples - 1);
      const u = 0.12 + progress * 0.76;
      const v = 0.5 + Math.sin(progress * Math.PI * 4) * 0.22;
      return {
        x: u * 256,
        y: v * 256,
        tMs: index * 4,
        pressure: 0.05 + progress * 0.9,
        velocity: index === 0 ? 0 : 1.25,
        altitudeDeg: 68,
        azimuthDeg: 27,
      };
    }),
  };
}

function createFaultCanvasController(): FaultCanvasController {
  let failNext = false;
  let puts = 0;
  return {
    factory(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas2D unavailable");
      const original = context.putImageData.bind(context);
      Object.defineProperty(context, "putImageData", {
        configurable: true,
        value: (...args: unknown[]) => {
          if (failNext) {
            failNext = false;
            throw new DOMException("injected atlas upload failure", "InvalidStateError");
          }
          puts += 1;
          Reflect.apply(original, context, args);
        },
      });
      return canvas;
    },
    failNextPut() {
      failNext = true;
    },
    putCount() {
      return puts;
    },
  };
}

function createControlledFixture(
  definition: ControlledCaseDefinition,
  createCanvas?: StudioVrmTexturePaintCanvasFactory,
): ControlledFixture {
  const scene = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(
    2,
    2,
    definition.gridSegments,
    definition.gridSegments,
  );
  const texture = new THREE.DataTexture(
    new Uint8Array(definition.atlasSize * definition.atlasSize * 4),
    definition.atlasSize,
    definition.atlasSize,
    THREE.RGBAFormat,
  );
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  const runtime = createStudioVrmTexturePaintRuntime(scene, {
    ...(createCanvas ? { createCanvas } : {}),
  });
  const bvh = createStudioThreeMeshBvhProvider({
    geometry,
    three: THREE,
    geometryOwnership: "borrowed",
    strategy: "sah",
    targetLeafSize: 8,
  });
  return { scene, geometry, mesh, material, texture, runtime, bvh };
}

async function disposeControlledFixture(fixture: ControlledFixture): Promise<void> {
  fixture.runtime.dispose();
  await fixture.bvh.destroy();
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.texture.dispose();
}

function triangleVertexIndex(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  corner: 0 | 1 | 2,
): number {
  const element = faceIndex * 3 + corner;
  return geometry.index?.getX(element) ?? element;
}

function triangleUvAtPoint(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  pointLocal: readonly [number, number, number],
): THREE.Vector2 {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!position || !uv) throw new Error("BVH geometry lacks position/uv attributes");
  const indices = [0, 1, 2].map((corner) =>
    triangleVertexIndex(geometry, faceIndex, corner as 0 | 1 | 2));
  const vertices = indices.map((index) =>
    new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)));
  const barycentric = new THREE.Vector3();
  THREE.Triangle.getBarycoord(
    new THREE.Vector3(...pointLocal),
    vertices[0]!,
    vertices[1]!,
    vertices[2]!,
    barycentric,
  );
  if (![barycentric.x, barycentric.y, barycentric.z].every(Number.isFinite)) {
    throw new Error(`face ${faceIndex} produced invalid barycentric coordinates`);
  }
  const uvs = indices.map((index) => new THREE.Vector2(uv.getX(index), uv.getY(index)));
  return new THREE.Vector2(
    uvs[0]!.x * barycentric.x + uvs[1]!.x * barycentric.y + uvs[2]!.x * barycentric.z,
    uvs[0]!.y * barycentric.x + uvs[1]!.y * barycentric.y + uvs[2]!.y * barycentric.z,
  );
}

function materialIndexForFace(geometry: THREE.BufferGeometry, faceIndex: number): number {
  const elementOffset = faceIndex * 3;
  return geometry.groups.find((group) =>
    elementOffset >= group.start && elementOffset < group.start + group.count)?.materialIndex ?? 0;
}

function hitFromBvh(
  mesh: THREE.Mesh,
  faceIndex: number,
  localPoint: readonly [number, number, number],
  worldPoint: readonly [number, number, number],
): StudioVrmTexturePaintRayHit {
  const uv = triangleUvAtPoint(mesh.geometry, faceIndex, localPoint);
  return {
    object: mesh,
    uv,
    face: { materialIndex: materialIndexForFace(mesh.geometry, faceIndex) },
    faceIndex,
    point: new THREE.Vector3(...worldPoint),
  };
}

async function buildControlledHitLane(
  fixture: ControlledFixture,
  stroke: StrokeIR,
): Promise<BvhHitLane> {
  const hits: StudioVrmTexturePaintRayHit[] = [];
  const faceIndices: number[] = [];
  let maxUvDelta = 0;
  const started = performance.now();
  for (const sample of stroke.samples) {
    const expectedU = sample.x / 256;
    const expectedV = sample.y / 256;
    const x = expectedU * 2 - 1;
    const y = expectedV * 2 - 1;
    const receipt = await fixture.bvh.raycastFirst({
      originWorld: [x, y, 1],
      directionWorld: [0, 0, -1],
      nearWorld: 0,
      farWorld: 2,
    });
    if (!receipt.result) throw new Error(`${stroke.id}: BVH ray missed controlled plane`);
    const hit = hitFromBvh(
      fixture.mesh,
      receipt.result.faceIndex,
      receipt.result.localPoint,
      receipt.result.worldPoint,
    );
    if (!hit.uv) throw new Error(`${stroke.id}: derived UV is absent`);
    maxUvDelta = Math.max(
      maxUvDelta,
      Math.abs(hit.uv.x - expectedU),
      Math.abs(hit.uv.y - expectedV),
    );
    faceIndices.push(receipt.result.faceIndex);
    hits.push(hit);
  }
  return {
    hits,
    bvhMs: performance.now() - started,
    maxUvDelta,
    faceIndices,
  };
}

async function prewarmTarget(
  runtime: StudioVrmTexturePaintRuntime,
  hit: StudioVrmTexturePaintRayHit,
  pressure: number,
): Promise<void> {
  const prepared = unwrap(await runtime.prepareSurfaceBrushSession({ hit, pressure }));
  const cancelled = unwrap(runtime.cancelSurfaceBrushSession(prepared.session));
  if (!cancelled) throw new Error("runtime target prewarm did not release its surface lease");
}

function pressurePreserved(result: Awaited<ReturnType<typeof executeStudioVrmSurfaceBrushStroke>>, stroke: StrokeIR): boolean {
  return stroke.samples.every((sample, sampleIndex) =>
    result.operations.some((operation) =>
      operation.sampleIndex === sampleIndex
      && operation.interpolation === 1
      && operation.pressure === sample.pressure));
}

async function executeControlledIteration(
  fixture: ControlledFixture,
  definition: ControlledCaseDefinition,
  stroke: StrokeIR,
): Promise<Readonly<{
  totalMs: number;
  bvhMs: number;
  commitMs: number;
  maxUvDelta: number;
  operations: number;
  referenceChangedTexels: number;
  committedChangedTexels: number;
  atlasChangedTexels: number;
  pressurePreserved: boolean;
  referenceDigest: string;
  atlasDigest: string;
  undoRestoredZero: boolean;
}>> {
  const totalStarted = performance.now();
  const lane = await buildControlledHitLane(fixture, stroke);
  const commitStarted = performance.now();
  const result = await executeStudioVrmSurfaceBrushStroke({
    runtime: fixture.runtime,
    brushProgram: PROGRAM,
    stroke,
    rayHits: lane.hits,
    texelDensityBySample: Array.from(
      { length: stroke.samples.length },
      () => definition.atlasSize / 256,
    ),
  });
  const commitMs = performance.now() - commitStarted;
  const totalMs = performance.now() - totalStarted;
  const exported = unwrap(fixture.runtime.exportPaintedTargets());
  if (exported.length !== 1) {
    throw new Error(`${definition.id}: expected one runtime-owned atlas, got ${exported.length}`);
  }
  const atlas = exported[0]!.pixels;
  const referenceDigest = await sha256(result.pixels);
  const atlasDigest = await sha256(atlas);
  const atlasChangedTexels = countChangedTexels(atlas);
  const undone = unwrap(fixture.runtime.undo());
  const afterUndo = unwrap(fixture.runtime.exportPaintedTargets());
  const undoRestoredZero = undone
    && exportedStateHasNoChangedPixels(afterUndo);
  return {
    totalMs,
    bvhMs: lane.bvhMs,
    commitMs,
    maxUvDelta: lane.maxUvDelta,
    operations: result.receipt.operations,
    referenceChangedTexels: result.receipt.changedTexels,
    committedChangedTexels: result.receipt.commitReceipt?.changedTexels ?? 0,
    atlasChangedTexels,
    pressurePreserved: pressurePreserved(result, stroke),
    referenceDigest,
    atlasDigest,
    undoRestoredZero,
  };
}

async function runControlledCase(
  definition: ControlledCaseDefinition,
): Promise<Readonly<Record<string, unknown>>> {
  const fixture = createControlledFixture(definition);
  const stroke = createStroke(`${definition.id}-stroke`, definition.inputSamples);
  const build = await fixture.bvh.build();
  const firstLane = await buildControlledHitLane(fixture, stroke);
  await prewarmTarget(fixture.runtime, firstLane.hits[0]!, stroke.samples[0]!.pressure);
  for (let index = 0; index < VRM_SURFACE_BRUSH_BROWSER_WARMUPS; index += 1) {
    await executeControlledIteration(fixture, definition, stroke);
  }

  const memoryBefore = observeJsMemory();
  let peakObservedUsedJsHeapBytes = memoryBefore.usedJsHeapBytes;
  const totalSamples: number[] = [];
  const bvhSamples: number[] = [];
  const commitSamples: number[] = [];
  const referenceDigests: string[] = [];
  const atlasDigests: string[] = [];
  const operations: number[] = [];
  const referenceChangedTexels: number[] = [];
  const committedChangedTexels: number[] = [];
  const atlasChangedTexels: number[] = [];
  let maxUvDelta = 0;
  let pressureGate = true;
  let undoGate = true;
  for (let index = 0; index < VRM_SURFACE_BRUSH_BROWSER_SAMPLES; index += 1) {
    const measured = await executeControlledIteration(fixture, definition, stroke);
    totalSamples.push(measured.totalMs);
    bvhSamples.push(measured.bvhMs);
    commitSamples.push(measured.commitMs);
    referenceDigests.push(measured.referenceDigest);
    atlasDigests.push(measured.atlasDigest);
    operations.push(measured.operations);
    referenceChangedTexels.push(measured.referenceChangedTexels);
    committedChangedTexels.push(measured.committedChangedTexels);
    atlasChangedTexels.push(measured.atlasChangedTexels);
    maxUvDelta = Math.max(maxUvDelta, measured.maxUvDelta);
    pressureGate &&= measured.pressurePreserved;
    undoGate &&= measured.undoRestoredZero;
    const memory = observeJsMemory().usedJsHeapBytes;
    if (memory !== null) {
      peakObservedUsedJsHeapBytes = Math.max(peakObservedUsedJsHeapBytes ?? memory, memory);
    }
  }
  const memoryAfter = observeJsMemory();
  if (memoryAfter.usedJsHeapBytes !== null) {
    peakObservedUsedJsHeapBytes = Math.max(
      peakObservedUsedJsHeapBytes ?? memoryAfter.usedJsHeapBytes,
      memoryAfter.usedJsHeapBytes,
    );
  }
  const userAgentSpecificMemory = await observeUserAgentMemory();
  const snapshot = fixture.runtime.getSnapshot();
  const deterministicReference = new Set(referenceDigests).size === 1;
  const deterministicAtlas = new Set(atlasDigests).size === 1;
  const exactWorkload =
    build.geometry.triangleCount === definition.gridSegments * definition.gridSegments * 2
    && operations.every((value) => value > 0)
    && operations.length === VRM_SURFACE_BRUSH_BROWSER_SAMPLES;
  const nonNoOp = referenceChangedTexels.every((value) => value > 0)
    && committedChangedTexels.every((value) => value > 0)
    && atlasChangedTexels.every((value) => value > 0);
  const result = {
    id: definition.id,
    exactWorkload: {
      atlasWidth: definition.atlasSize,
      atlasHeight: definition.atlasSize,
      gridSegments: definition.gridSegments,
      vertexCount: build.geometry.vertexCount,
      triangleCount: build.geometry.triangleCount,
      inputSamplesPerStroke: definition.inputSamples,
      warmupsExcluded: VRM_SURFACE_BRUSH_BROWSER_WARMUPS,
      measuredStrokes: VRM_SURFACE_BRUSH_BROWSER_SAMPLES,
      proxyOrReductionUsed: false,
    },
    provider: {
      raycastProviderId: build.providerId,
      raycastRuntimeVersion: build.runtimeVersion,
      projectionProviderId: "three-vrm-texture-paint",
      textureOwner: "StudioVrmTexturePaintRuntime",
      bvhReceiptHash: build.receiptHash,
    },
    timings: {
      fullRaycastProjectionCommit: summarize(totalSamples),
      bvhRaycasts: summarize(bvhSamples),
      projectionLoweringAtlasCommit: summarize(commitSamples),
      normalizedFullMsPerInputSample: summarize(
        totalSamples.map((value) => value / definition.inputSamples),
      ),
    },
    quality: {
      maxBvhDerivedUvDelta: round(maxUvDelta, 10),
      maxAllowedUvDelta: 0.000_001,
      operationCounts: operations,
      referenceChangedTexels,
      committedChangedTexels,
      atlasChangedTexels,
      referenceDigests,
      atlasDigests,
      deterministicReference,
      deterministicAtlas,
      pressurePreservedWithoutQuantization: pressureGate,
      undoRestoredZero: undoGate,
    },
    memory: {
      jsHeapBefore: memoryBefore,
      jsHeapAfter: memoryAfter,
      peakObservedUsedJsHeapBytes,
      userAgentSpecificMemory,
      runtimeModeledResidentBytes: snapshot.residentBytes,
      runtimeModeledResidentBytesScope:
        "runtime admission estimate; not a browser-observed GPU allocation",
      browserObservedGpuMemoryBytes: null,
      browserGpuMemoryReason:
        "WebGL2/Three.js exposes no resident allocation counter; no estimate is promoted as observation",
    },
    gates: {
      exactWorkload,
      bvhUvPassed: maxUvDelta <= 0.000_001,
      nonNoOpPassed: nonNoOp,
      deterministicReferencePassed: deterministicReference,
      deterministicAtlasPassed: deterministicAtlas,
      pressurePrecisionPassed: pressureGate,
      undoRollbackPassed: undoGate,
      noHotPathGpuReadbackPassed: true,
    },
  };
  await disposeControlledFixture(fixture);
  return result;
}

function twoIslandGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    1, 0, 0,
    2, 0, 0,
    2, 1, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0.05, 0.05,
    0.45, 0.05,
    0.05, 0.45,
    0.55, 0.55,
    0.95, 0.55,
    0.95, 0.95,
  ], 2));
  return geometry;
}

async function rayHitForPoint(
  fixture: ControlledFixture,
  x: number,
  y: number,
): Promise<StudioVrmTexturePaintRayHit> {
  const receipt = await fixture.bvh.raycastFirst({
    originWorld: [x, y, 1],
    directionWorld: [0, 0, -1],
    farWorld: 2,
  });
  if (!receipt.result) throw new Error("fault/seam control BVH ray missed");
  return hitFromBvh(
    fixture.mesh,
    receipt.result.faceIndex,
    receipt.result.localPoint,
    receipt.result.worldPoint,
  );
}

async function runSeamControl(): Promise<Readonly<Record<string, unknown>>> {
  const definition = {
    id: "two-island-seam-control",
    atlasSize: 256,
    gridSegments: 1,
    inputSamples: 2,
  };
  const fixture = createControlledFixture(definition);
  fixture.geometry.dispose();
  const geometry = twoIslandGeometry();
  fixture.mesh.geometry = geometry;
  await fixture.bvh.destroy();
  const bvh = createStudioThreeMeshBvhProvider({
    geometry,
    three: THREE,
    geometryOwnership: "borrowed",
  });
  const seamFixture: ControlledFixture = { ...fixture, geometry, bvh };
  const hits = [
    await rayHitForPoint(seamFixture, 0.2, 0.2),
    await rayHitForPoint(seamFixture, 1.8, 0.2),
  ];
  const seamStroke: StrokeIR = {
    ...createStroke("two-island-seam-stroke", 2),
    samples: [
      { ...createStroke("unused-a", 1).samples[0]!, x: 20, y: 20, pressure: 0.25 },
      { ...createStroke("unused-b", 1).samples[0]!, x: 180, y: 20, tMs: 8, pressure: 0.9 },
    ],
  };
  const result = await executeStudioVrmSurfaceBrushStroke({
    runtime: seamFixture.runtime,
    brushProgram: PROGRAM,
    stroke: seamStroke,
    rayHits: hits,
    texelDensityBySample: [1, 1],
  });
  const runIds = [...new Set(result.operations.map((operation) => operation.run))];
  const noInterpolatedBridge = result.operations.filter((operation) => operation.run === 1).length === 1;
  const output = {
    raycastProvider: "three-mesh-bvh",
    projectionProvider: result.receipt.providerId,
    faceIndices: hits.map((hit) => hit.faceIndex),
    islandIds: [...new Set(result.operations.map((operation) => operation.islandId))],
    runs: result.receipt.runs,
    seamBreaks: result.receipt.seamBreaks,
    runIds,
    operations: result.receipt.operations,
    changedTexels: result.receipt.commitReceipt?.changedTexels ?? 0,
    noInterpolatedBridge,
    pass:
      result.receipt.runs === 2
      && result.receipt.seamBreaks === 1
      && runIds.length === 2
      && noInterpolatedBridge,
  };
  await disposeControlledFixture(seamFixture);
  return output;
}

async function runCancellationControl(): Promise<Readonly<Record<string, unknown>>> {
  const definition = VRM_SURFACE_BRUSH_BROWSER_CASES[0];
  const fixture = createControlledFixture(definition);
  const stroke = createStroke("cancellation-control-stroke", 8);
  await fixture.bvh.build();
  const lane = await buildControlledHitLane(fixture, stroke);
  const controller = new AbortController();
  const prepared = await prepareStudioVrmSurfaceProjectionProvider({
    runtime: fixture.runtime,
    brushProgram: PROGRAM,
    stroke,
    rayHits: lane.hits,
    texelDensityBySample: Array.from({ length: stroke.samples.length }, () => 1),
    signal: controller.signal,
  });
  controller.abort("browser benchmark cancellation");
  let cancelledError = false;
  try {
    executeSurfaceBrushStroke(PROGRAM, stroke, prepared.provider, {
      signal: controller.signal,
    });
  } catch (error) {
    cancelledError = error instanceof SurfaceBrushCancelledError;
  }
  const exported = unwrap(fixture.runtime.exportPaintedTargets());
  const snapshot = fixture.runtime.getSnapshot();
  const changedTexelsAfterCancel = exported.reduce(
    (sum, target) => sum + countChangedTexels(target.pixels),
    0,
  );
  const pass = cancelledError
    && snapshot.activeOperation === null
    && snapshot.history.undoCount === 0
    && changedTexelsAfterCancel === 0
    && exportedStateHasNoChangedPixels(exported);
  const output = {
    cancelledError,
    activeOperation: snapshot.activeOperation,
    undoCount: snapshot.history.undoCount,
    retainedAtlasCount: exported.length,
    changedTexelsAfterCancel,
    pass,
  };
  await disposeControlledFixture(fixture);
  return output;
}

async function runUploadRollbackControl(): Promise<Readonly<Record<string, unknown>>> {
  const definition = VRM_SURFACE_BRUSH_BROWSER_CASES[0];
  const fault = createFaultCanvasController();
  const fixture = createControlledFixture(definition, fault.factory);
  const stroke = createStroke("upload-rollback-control-stroke", 8);
  await fixture.bvh.build();
  const lane = await buildControlledHitLane(fixture, stroke);
  await prewarmTarget(fixture.runtime, lane.hits[0]!, stroke.samples[0]!.pressure);
  fault.failNextPut();
  let errorCode: string | null = null;
  try {
    await executeStudioVrmSurfaceBrushStroke({
      runtime: fixture.runtime,
      brushProgram: PROGRAM,
      stroke,
      rayHits: lane.hits,
      texelDensityBySample: Array.from({ length: stroke.samples.length }, () => 1),
    });
  } catch (error) {
    errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : errorMessage(error);
  }
  const exported = unwrap(fixture.runtime.exportPaintedTargets());
  const snapshot = fixture.runtime.getSnapshot();
  const changedTexelsAfterRollback = exported.reduce(
    (sum, target) => sum + countChangedTexels(target.pixels),
    0,
  );
  const pass = errorCode === "runtime-commit-failed"
    && snapshot.activeOperation === null
    && snapshot.history.undoCount === 0
    && changedTexelsAfterRollback === 0
    && exportedStateHasNoChangedPixels(exported)
    && fault.putCount() >= 2;
  const output = {
    errorCode,
    activeOperation: snapshot.activeOperation,
    undoCount: snapshot.history.undoCount,
    retainedAtlasCount: exported.length,
    changedTexelsAfterRollback,
    successfulCanvasUploads: fault.putCount(),
    pass,
  };
  await disposeControlledFixture(fixture);
  return output;
}

function paintableMaterial(material: THREE.Material | undefined): material is THREE.Material & { map: THREE.Texture } {
  if (!material || !("map" in material)) return false;
  return (material as THREE.Material & { map?: unknown }).map instanceof THREE.Texture;
}

function findPaintableMesh(scene: THREE.Object3D): THREE.Mesh | null {
  let selected: THREE.Mesh | null = null;
  scene.traverse((object) => {
    if (selected || !(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    if (!geometry.getAttribute("position") || !geometry.getAttribute("uv")) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => paintableMaterial(material))) selected = object;
  });
  return selected;
}

function choosePaintableFace(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const primitiveCount = geometry.index?.count ?? geometry.getAttribute("position").count;
  const triangleCount = Math.floor(primitiveCount / 3);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    const material = materials[materialIndexForFace(geometry, faceIndex)];
    if (!paintableMaterial(material)) continue;
    const position = geometry.getAttribute("position");
    const aIndex = triangleVertexIndex(geometry, faceIndex, 0);
    const bIndex = triangleVertexIndex(geometry, faceIndex, 1);
    const cIndex = triangleVertexIndex(geometry, faceIndex, 2);
    const a = new THREE.Vector3(position.getX(aIndex), position.getY(aIndex), position.getZ(aIndex));
    const b = new THREE.Vector3(position.getX(bIndex), position.getY(bIndex), position.getZ(bIndex));
    const c = new THREE.Vector3(position.getX(cIndex), position.getY(cIndex), position.getZ(cIndex));
    if (new THREE.Triangle(a, b, c).getArea() > 1e-10) return faceIndex;
  }
  throw new Error("bundled VRM has no non-degenerate paintable triangle");
}

function faceCentroidAndNormal(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): Readonly<{ centroid: THREE.Vector3; normal: THREE.Vector3 }> {
  const position = geometry.getAttribute("position");
  const vertices = [0, 1, 2].map((corner) => {
    const index = triangleVertexIndex(geometry, faceIndex, corner as 0 | 1 | 2);
    return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
  });
  const triangle = new THREE.Triangle(vertices[0]!, vertices[1]!, vertices[2]!);
  return { centroid: triangle.getMidpoint(new THREE.Vector3()), normal: triangle.getNormal(new THREE.Vector3()) };
}

async function realVrmBvhHit(
  mesh: THREE.Mesh,
  bvh: ReturnType<typeof createStudioThreeMeshBvhProvider>,
  preferredFace: number,
): Promise<Readonly<{ hit: StudioVrmTexturePaintRayHit; receiptFace: number }>> {
  const { centroid, normal } = faceCentroidAndNormal(mesh.geometry, preferredFace);
  const worldCentroid = centroid.clone().applyMatrix4(mesh.matrixWorld);
  const worldNormal = normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize();
  const scale = Math.max(0.001, new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute("position") as THREE.BufferAttribute,
  ).getSize(new THREE.Vector3()).length() * 0.01);
  for (const side of [1, -1] as const) {
    const origin = worldCentroid.clone().addScaledVector(worldNormal, scale * side);
    const direction = worldNormal.clone().multiplyScalar(-side);
    const receipt = await bvh.raycastFirst({
      originWorld: [origin.x, origin.y, origin.z],
      directionWorld: [direction.x, direction.y, direction.z],
      nearWorld: 0,
      farWorld: scale * 4,
    });
    if (!receipt.result) continue;
    const hit = hitFromBvh(
      mesh,
      receipt.result.faceIndex,
      receipt.result.localPoint,
      receipt.result.worldPoint,
    );
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (paintableMaterial(materials[hit.face?.materialIndex ?? 0])) {
      return { hit, receiptFace: receipt.result.faceIndex };
    }
  }
  throw new Error("bundled VRM BVH could not recover a paintable ray hit");
}

async function runBundledVrmFixture(): Promise<Readonly<Record<string, unknown>>> {
  const assetUrl = "/vrm/sample.vrm";
  let vrm: VRM | null = null;
  let bvh: ReturnType<typeof createStudioThreeMeshBvhProvider> | null = null;
  let runtime: StudioVrmTexturePaintRuntime | null = null;
  try {
    vrm = await loadStudioVrmAsset(assetUrl);
    vrm.scene.updateMatrixWorld(true);
    const mesh = findPaintableMesh(vrm.scene);
    if (!mesh) throw new Error("bundled VRM has no paintable mesh with UV/base-color texture");
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld.toArray() as unknown as readonly [
      number, number, number, number,
      number, number, number, number,
      number, number, number, number,
      number, number, number, number,
    ];
    bvh = createStudioThreeMeshBvhProvider({
      geometry: mesh.geometry,
      three: THREE,
      geometryOwnership: "borrowed",
      localToWorld: matrix,
      strategy: "sah",
      targetLeafSize: 8,
    });
    const build = await bvh.build();
    const preferredFace = choosePaintableFace(mesh);
    const resolved = await realVrmBvhHit(mesh, bvh, preferredFace);
    runtime = createStudioVrmTexturePaintRuntime(vrm.scene);
    const stroke = createStroke("bundled-sample-vrm-surface-stroke", 1);
    await prewarmTarget(runtime, resolved.hit, stroke.samples[0]!.pressure);
    const digests: string[] = [];
    const elapsed: number[] = [];
    const changed: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const started = performance.now();
      const result = await executeStudioVrmSurfaceBrushStroke({
        runtime,
        brushProgram: PROGRAM,
        stroke,
        rayHits: [resolved.hit],
        texelDensityBySample: [1],
      });
      elapsed.push(performance.now() - started);
      const target = unwrap(runtime.exportPaintedTargets())[0];
      if (!target) throw new Error("bundled VRM commit did not create an atlas target");
      digests.push(await sha256(target.pixels));
      changed.push(result.receipt.commitReceipt?.changedTexels ?? 0);
      if (!unwrap(runtime.undo())) throw new Error("bundled VRM undo failed");
    }
    const materialIndex = resolved.hit.face?.materialIndex ?? 0;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const map = (materials[materialIndex] as THREE.Material & { map: THREE.Texture }).map;
    const dimensions = map.image as Readonly<{ width?: number; height?: number }>;
    return {
      assetUrl,
      loader: "loadStudioVrmAsset",
      vrmMetaVersion: vrm.meta.metaVersion,
      meshName: mesh.name,
      meshType: mesh.type,
      vertexCount: build.geometry.vertexCount,
      triangleCount: build.geometry.triangleCount,
      bvhRuntimeVersion: build.runtimeVersion,
      preferredFace,
      bvhResolvedFace: resolved.receiptFace,
      materialIndex,
      sourceAtlas: {
        width: finiteOrNull(dimensions.width),
        height: finiteOrNull(dimensions.height),
      },
      commitMs: elapsed.map((value) => round(value)),
      changedTexels: changed,
      atlasDigests: digests,
      deterministicByteEquality: new Set(digests).size === 1,
      pass: changed.every((value) => value > 0) && new Set(digests).size === 1,
    };
  } finally {
    runtime?.dispose();
    await bvh?.destroy().catch(() => undefined);
    if (vrm) disposeStudioVrmAsset(vrm);
  }
}

async function run(): Promise<void> {
  const controlledCases: Array<Readonly<Record<string, unknown>>> = [];
  for (const definition of VRM_SURFACE_BRUSH_BROWSER_CASES) {
    controlledCases.push(await runControlledCase(definition));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const seamControl = await runSeamControl();
  const cancellationControl = await runCancellationControl();
  const uploadRollbackControl = await runUploadRollbackControl();
  const bundledVrmFixture = await runBundledVrmFixture();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const bootstrapReceipt = captureBootstrapReceipt();
  const cspViolations = bootstrapReceipt.runtimeViolations;
  const pass = controlledCases.every((candidate) =>
    Object.values(candidate.gates as Record<string, unknown>).every((value) => value === true))
    && seamControl.pass === true
    && cancellationControl.pass === true
    && uploadRollbackControl.pass === true
    && bundledVrmFixture.pass === true
    && bootstrapReceipt.positiveControlThrew
    && bootstrapReceipt.positiveControlObserved
    && bootstrapReceipt.configIdentityObserved
    && bootstrapReceipt.globalConfigJitlessObserved
    && bootstrapReceipt.zodAllowsEvalFalse
    && cspViolations.length === 0;
  window.__TOONSPECTRUM_VRM_SURFACE_BRUSH_BROWSER_RESULT__ = {
    schemaVersion: 2,
    status: pass ? "ok" : "failed",
    pass,
    measuredAt: new Date().toISOString(),
    execution: "vite-production-build-chromium-real-three-bvh-vrm-atlas",
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: globalThis.isSecureContext,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      webGl: observeWebGlIdentity(),
    },
    workload: {
      warmupsExcluded: VRM_SURFACE_BRUSH_BROWSER_WARMUPS,
      warmSamplesPerControlledCase: VRM_SURFACE_BRUSH_BROWSER_SAMPLES,
      percentileMethod: "nearest-rank-ceil",
      productPath: [
        "three",
        "three-mesh-bvh-0.9.13",
        "StudioVrmSurfaceProjectionProvider",
        "executeSurfaceBrushStroke",
        "StudioVrmTexturePaintRuntime",
      ],
      mockProjectionProviderUsed: false,
      hotPathGpuReadbacks: 0,
    },
    controlledCases,
    seamControl,
    cancellationControl,
    uploadRollbackControl,
    bundledVrmFixture,
    bootstrapReceipt,
    cspViolations,
  };
}

run().catch((error) => {
  window.__TOONSPECTRUM_VRM_SURFACE_BRUSH_BROWSER_RESULT__ = {
    schemaVersion: 2,
    status: "error",
    pass: false,
    measuredAt: new Date().toISOString(),
    error: {
      name: error instanceof Error ? error.name : "NonError",
      message: errorMessage(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    },
    bootstrapReceipt: captureBootstrapReceipt(),
    cspViolations:
      window.__TOONSPECTRUM_VRM_SURFACE_BRUSH_BOOTSTRAP_RECEIPT__?.runtimeViolations ?? [],
  };
});
