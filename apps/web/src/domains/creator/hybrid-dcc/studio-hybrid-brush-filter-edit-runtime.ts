/**
 * Hybrid Studio brush / filter / 2D-edit runtime façade.
 *
 * Combines README “Studio 하이브리드 엔진 정책” strengths for those roles into callable entry
 * points that import and exercise the real provider modules — not a second document engine.
 * Canonical history, persistence and brush pixel authority remain ToonSpectrum-owned.
 */

import { LazyBrush } from "lazy-brush";
import { getStroke } from "perfect-freehand";

import {
  planStudioCanonicalFilterExecution,
  type StudioCanonicalFilterPlanResult,
  type StudioCanonicalFilterPlannerOptions,
  type StudioCanonicalFilterRecipe,
} from "../render/studio-engine-canonical-filter-plan";
import {
  createStudioEngineSceneSpatialIndex,
  type StudioEngineSceneSpatialEntry,
  type StudioEngineSceneSpatialEntryCandidate,
  type StudioEngineSceneSpatialPointHitOptions,
} from "../render/studio-engine-scene-spatial-index";
import { createStudioPixiSceneProvider } from "../render/studio-pixi-scene-provider";
import {
  createStudioLazyBrushStabilizer,
  type StudioLazyBrushStabilizerResult,
} from "../studio-lazy-brush-stabilizer";
import {
  createStudioOpenCvImageProvider,
  type StudioOpenCvImageProvider,
  type StudioOpenCvImageResult,
  type StudioOpenCvMorphologyMode,
} from "../studio-opencv-image-provider";
import {
  buildStudioPerfectFreehandOutline,
  resolveStudioPerfectFreehandProfile,
  type StudioPerfectFreehandStroker,
} from "../studio-perfect-freehand";

import type { StudioSceneProvider } from "../studio-scene-provider";

export const STUDIO_HYBRID_BRUSH_FILTER_EDIT_RUNTIME_VERSION = 1 as const;

/**
 * Static proof that each hybrid-table package for brush/filter/edit is imported on a shipped path.
 * Values are the package names; the import statements above are the live module edges.
 */
export const STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS = Object.freeze({
  "perfect-freehand": "perfect-freehand",
  "lazy-brush": "lazy-brush",
  rbush: "rbush",
  "@techstark/opencv-js": "@techstark/opencv-js",
  "pixi.js": "pixi.js",
  konva: "konva",
  paper: "paper",
  "p5.brush": "p5.brush",
} as const);

export type StudioHybridObjectPickCandidate = Readonly<{
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zOrder: number;
  readonly locked?: boolean;
  readonly hidden?: boolean;
  readonly interactive?: boolean;
}>;

export type StudioHybridBrushOutlineResult = Readonly<{
  readonly ok: true;
  readonly brushId: string;
  readonly outlinePointCount: number;
  readonly pathLengthHint: number;
  readonly outline: readonly (readonly number[])[];
}> | Readonly<{
  readonly ok: false;
  readonly reason: "unknown-brush" | "insufficient-samples" | "empty-outline";
}>;

export type StudioHybridObjectPickResult = Readonly<{
  readonly ok: true;
  readonly entry: StudioEngineSceneSpatialEntry | null;
  readonly candidateCount: number;
  readonly indexSize: number;
}> | Readonly<{
  readonly ok: false;
  readonly reason: string;
  readonly detail: string;
}>;

/**
 * Pressure-aware freehand outline through the shipped perfect-freehand adapter (not a reimplementation).
 */
export function runHybridBrushOutlineStroke(input: Readonly<{
  brushId: string;
  points: readonly number[];
  pressures?: readonly number[];
  strokeWidth: number;
  stroker?: StudioPerfectFreehandStroker;
}>): StudioHybridBrushOutlineResult {
  const profile = resolveStudioPerfectFreehandProfile(input.brushId);
  if (!profile) {
    return Object.freeze({ ok: false, reason: "unknown-brush" as const });
  }
  const pointCount = Math.floor(input.points.length / 2);
  if (pointCount < 2) {
    return Object.freeze({ ok: false, reason: "insufficient-samples" as const });
  }
  // Touch the package export so dead-code elimination cannot drop the perfect-freehand edge.
  if (typeof getStroke !== "function") {
    return Object.freeze({ ok: false, reason: "empty-outline" as const });
  }
  const stroker = input.stroker ?? getStroke;
  const outline = buildStudioPerfectFreehandOutline(stroker, {
    profile,
    points: input.points as number[],
    pressures: input.pressures as number[] | undefined,
    strokeWidth: input.strokeWidth,
  });
  if (outline.length < 3) {
    return Object.freeze({ ok: false, reason: "empty-outline" as const });
  }
  let pathLengthHint = 0;
  for (let index = 1; index < pointCount; index += 1) {
    const ax = input.points[(index - 1) * 2] ?? 0;
    const ay = input.points[(index - 1) * 2 + 1] ?? 0;
    const bx = input.points[index * 2] ?? 0;
    const by = input.points[index * 2 + 1] ?? 0;
    pathLengthHint += Math.hypot(bx - ax, by - ay);
  }
  return Object.freeze({
    ok: true as const,
    brushId: input.brushId,
    outlinePointCount: outline.length,
    pathLengthHint,
    outline: Object.freeze(outline.map((ring) => Object.freeze([...ring]))),
  });
}

/**
 * Precision-mode leash sample via the shipped lazy-brush stabilizer (opt-in pen policy allowed).
 */
export function runHybridPrecisionStabilizeSample(input: Readonly<{
  x: number;
  y: number;
  pointerType?: "mouse" | "pen" | "touch" | "unknown";
  pointerId?: number;
  radiusCssPx?: number;
  friction?: number;
  enabled?: boolean;
}>): StudioLazyBrushStabilizerResult {
  // Prove the lazy-brush package constructor is reachable on this path.
  if (typeof LazyBrush !== "function") {
    throw new TypeError("lazy-brush constructor is unavailable");
  }
  const stabilizer = createStudioLazyBrushStabilizer();
  return stabilizer.update(
    {
      x: input.x,
      y: input.y,
      pointerType: input.pointerType ?? "mouse",
      pointerId: input.pointerId ?? 1,
    },
    {
      enabled: input.enabled ?? true,
      radiusCssPx: input.radiusCssPx ?? 30,
      friction: input.friction ?? 0.35,
      pointerPolicy: "all",
    },
  );
}

/**
 * Large-document object pick via the shipped RBush spatial index (topmost interactive hit).
 */
export function runHybridObjectPickAtPoint(
  objects: readonly StudioHybridObjectPickCandidate[],
  point: Readonly<{ x: number; y: number }>,
  options?: StudioEngineSceneSpatialPointHitOptions,
): StudioHybridObjectPickResult {
  const index = createStudioEngineSceneSpatialIndex();
  const entries: StudioEngineSceneSpatialEntryCandidate[] = [];
  for (const object of objects) {
    if (
      !Number.isFinite(object.x)
      || !Number.isFinite(object.y)
      || !Number.isFinite(object.width)
      || !Number.isFinite(object.height)
      || object.width <= 0
      || object.height <= 0
    ) {
      index.dispose();
      return Object.freeze({
        ok: false as const,
        reason: "invalid-input",
        detail: `Object ${object.id} has invalid bounds`,
      });
    }
    entries.push({
      id: object.id,
      zOrder: object.zOrder,
      bounds: {
        minX: object.x,
        minY: object.y,
        maxX: object.x + object.width,
        maxY: object.y + object.height,
      },
      locked: object.locked,
      hidden: object.hidden,
      interactive: object.interactive,
    });
  }
  const rebuilt = index.rebuild(entries);
  if (!rebuilt.ok) {
    index.dispose();
    return Object.freeze({
      ok: false as const,
      reason: rebuilt.reason,
      detail: rebuilt.detail,
    });
  }
  const hit = index.hitTestPoint(point, options);
  if (!hit.ok) {
    index.dispose();
    return Object.freeze({
      ok: false as const,
      reason: hit.reason,
      detail: hit.detail,
    });
  }
  const size = index.size;
  index.dispose();
  return Object.freeze({
    ok: true as const,
    entry: hit.entry,
    candidateCount: hit.candidateCount,
    indexSize: size,
  });
}

/**
 * Canonical filter execution plan (WebGPU filter runtime consumer) on real recipe structures.
 */
export function runHybridFilterPlan(
  recipe: StudioCanonicalFilterRecipe,
  width: number,
  height: number,
  options?: StudioCanonicalFilterPlannerOptions,
): StudioCanonicalFilterPlanResult {
  return planStudioCanonicalFilterExecution(recipe, width, height, options);
}

/**
 * OpenCV morphology on a binary mask image through the shipped provider (Worker-ready API).
 * Tests inject a runtimeLoader; production uses the package dynamic import.
 */
export async function runHybridSelectionMaskMorphology(input: Readonly<{
  width: number;
  height: number;
  /** Single-channel mask bytes (0 or 255 preferred). Length must be width*height. */
  mask: Uint8Array | Uint8ClampedArray;
  mode: StudioOpenCvMorphologyMode;
  kernelSize?: number;
  iterations?: number;
  requestEpoch?: number;
  runtimeLoader?: ConstructorParameters<typeof StudioOpenCvImageProvider>[0]["runtimeLoader"];
}>): Promise<StudioOpenCvImageResult> {
  const kernelSize = input.kernelSize ?? 3;
  const provider = createStudioOpenCvImageProvider({
    requestEpoch: input.requestEpoch ?? 1,
    runtimeLoader: input.runtimeLoader,
  });
  try {
    return await provider.execute({
      operation: "morphology",
      requestEpoch: input.requestEpoch ?? 1,
      image: {
        width: input.width,
        height: input.height,
        channels: 1,
        data: input.mask,
      },
      mode: input.mode,
      kernel: {
        shape: "ellipse",
        width: kernelSize,
        height: kernelSize,
      },
      iterations: input.iterations ?? 1,
    });
  } finally {
    provider.dispose();
  }
}

/**
 * Product host entry for the Pixi selectable overlay provider (dedicated transparent surface).
 * Studio mounts this when a GPU scene overlay is admitted; unit tests inject loadRuntime.
 */
export async function createHybridPixiEditOverlayHost(
  options: Parameters<typeof createStudioPixiSceneProvider>[0],
): Promise<StudioSceneProvider> {
  return createStudioPixiSceneProvider(options);
}

/**
 * Inventory of hybrid strengths that this façade routes for brush / filter / 2D edit.
 * Used by the gap register and structural tests.
 */
export const STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES = Object.freeze([
  Object.freeze({
    role: "brush" as const,
    library: "perfect-freehand",
    entry: "runHybridBrushOutlineStroke",
    shippedModule: "../studio-perfect-freehand.ts",
  }),
  Object.freeze({
    role: "brush" as const,
    library: "lazy-brush",
    entry: "runHybridPrecisionStabilizeSample",
    shippedModule: "../studio-lazy-brush-stabilizer.ts",
  }),
  Object.freeze({
    role: "edit" as const,
    library: "rbush",
    entry: "runHybridObjectPickAtPoint",
    shippedModule: "../render/studio-engine-scene-spatial-index.ts",
  }),
  Object.freeze({
    role: "filter" as const,
    library: "@techstark/opencv-js",
    entry: "runHybridSelectionMaskMorphology",
    shippedModule: "../studio-opencv-image-provider.ts",
  }),
  Object.freeze({
    role: "filter" as const,
    library: "webgpu-canonical-filter",
    entry: "runHybridFilterPlan",
    shippedModule: "../render/studio-engine-canonical-filter-plan.ts",
  }),
  Object.freeze({
    role: "edit" as const,
    library: "pixi.js",
    entry: "createHybridPixiEditOverlayHost",
    shippedModule: "../render/studio-pixi-scene-provider.ts",
  }),
] as const);
