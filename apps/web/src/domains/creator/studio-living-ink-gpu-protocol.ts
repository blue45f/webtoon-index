/**
 * Provider-neutral GPU/Worker protocol for Living Ink.
 *
 * This is executable planning data, not a promise that uncompiled shaders ran. WebGPU providers
 * reuse the repository's stable-fluid WGSL kernels for velocity, curl and pressure projection;
 * Living Ink adds 2D wetness, mobile/fixed pigment, paper phase and display passes. WebGL2 follows
 * the same pass order through a GLSL ES 3.00 adapter. This file is a provider-neutral planning
 * model, not proof that every declared resource/knob exists in the current WebGL2 runtime. The
 * accepted RGBA8 frame plus operation journal is the visual save/replay authority. The CPU field
 * is a deterministic planning, validation and undo oracle; it is not a pixel-canonical renderer.
 */

import { STUDIO_SMOKE_KERNEL_IDS, type StudioSmokeKernelId } from "./studio-smoke-core";

import type {
  StudioLivingInkBounds,
  StudioLivingInkOperationReceipt,
} from "./studio-living-ink-field";

export const STUDIO_LIVING_INK_GPU_PROTOCOL_VERSION = 1 as const;

export const STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT = Object.freeze({
  targetFramesPerSecond: 60,
  targetFrameMilliseconds: 1_000 / 60,
  maximumCellUpdatesPerFrame: 720_000,
  maximumUploadBytesPerFrame: 8 * 1_024 * 1_024,
  maximumDirtyTilesPerPlan: 512,
  maximumPassesPerPlan: 8_192,
  dirtyTileSize: 64,
  maximumSimulationTicks: 16,
  /** A provider must fall back to a coarser velocity field rather than miss this bound silently. */
  overBudgetPolicy: "increase-coarse-scale-or-defer-settle",
} as const);

export type StudioLivingInkGpuBackend = "webgpu" | "webgl2";
export type StudioLivingInkGpuQuality = "interactive" | "settle";
export type StudioLivingInkDisplayMode =
  | "composite"
  | "mobile-pigment"
  | "fixed-pigment"
  | "water"
  | "flow";

export interface StudioLivingInkMaterialControls {
  readonly brushSizeCells: number;
  readonly flow: number;
  readonly bleed: number;
  readonly dryRate: number;
  readonly chromaticSeparation: number;
  readonly brushPigmentLoad: number;
  readonly capillaryCreep: number;
  readonly vorticity: number;
  readonly dryingEdgeDeposition: number;
  readonly wetOnWetMixing: number;
  readonly glazeOverFixed: number;
  readonly paperFiber: number;
  readonly paperTooth: number;
  readonly granulation: number;
  readonly edgeDarkening: number;
  readonly wetSheen: number;
  readonly vignette: number;
  readonly beerLambertDensity: number;
}

export interface StudioLivingInkInputPolicy {
  readonly toolMode:
    | "pressure-speed-pen"
    | "clean-water-brush"
    | "pigment-water-brush"
    | "white-gouache";
  readonly pointerSource: "pen" | "finger" | "mouse";
  readonly pressureSource: "hardware" | "force-touch" | "speed-simulated";
  readonly barrelMomentarySwap: "none" | "ink-water";
  readonly rejectPalm: boolean;
  readonly rejectSecondaryPointer: boolean;
}

export const DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS:
  StudioLivingInkMaterialControls = Object.freeze({
    brushSizeCells: 12,
    flow: 0.72,
    bleed: 0.56,
    dryRate: 0.18,
    chromaticSeparation: 0.08,
    brushPigmentLoad: 0.7,
    capillaryCreep: 0.34,
    vorticity: 0.18,
    dryingEdgeDeposition: 0.58,
    wetOnWetMixing: 0.72,
    glazeOverFixed: 0.16,
    paperFiber: 0.5,
    paperTooth: 0.56,
    granulation: 0.42,
    edgeDarkening: 0.54,
    wetSheen: 0.24,
    vignette: 0.12,
    beerLambertDensity: 0.82,
  });

export const DEFAULT_STUDIO_LIVING_INK_INPUT_POLICY:
  StudioLivingInkInputPolicy = Object.freeze({
    toolMode: "pressure-speed-pen",
    pointerSource: "pen",
    pressureSource: "hardware",
    barrelMomentarySwap: "ink-water",
    rejectPalm: true,
    rejectSecondaryPointer: true,
  });

export interface StudioLivingInkGpuCapabilities {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly worker: boolean;
  readonly offscreenCanvas: boolean;
  readonly halfFloatRenderable: boolean;
  readonly maxTextureDimension2D: number;
}

export interface StudioLivingInkGpuRequest {
  readonly width: number;
  readonly height: number;
  readonly operationKind: "ink" | "water" | "fix" | "clear" | "advance";
  readonly dirtyBounds: StudioLivingInkBounds;
  readonly hasSelectionMask: boolean;
  readonly simulationTicks: number;
  readonly quality: StudioLivingInkGpuQuality;
  readonly material?: StudioLivingInkMaterialControls;
  readonly inputPolicy?: StudioLivingInkInputPolicy;
  readonly displayMode?: StudioLivingInkDisplayMode;
  /** Interactive providers may stop evolving fields that are wholly outside the viewport. */
  readonly visibilityStepping?: "visible-dirty-only" | "all-dirty";
}

export type StudioLivingInkGpuLogicalFormat =
  | "r8unorm"
  | "r16float"
  | "rg16float"
  | "rgba16float";

export interface StudioLivingInkGpuResource {
  readonly id:
    | "surface-water"
    | "paper-water"
    | "wetness"
    | "mobile-pigment"
    | "fixed-pigment"
    | "paper-response"
    | "selection-mask"
    | "velocity-a"
    | "velocity-b"
    | "pressure-a"
    | "pressure-b"
    | "divergence";
  readonly width: number;
  readonly height: number;
  readonly format: StudioLivingInkGpuLogicalFormat;
  readonly phase: "fine" | "coarse";
  readonly persistence: "transient" | "document";
}

export interface StudioLivingInkGpuRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StudioLivingInkKernelId =
  | "deposit-ink"
  | "inject-water"
  | "fix-mobile-pigment"
  | "clear-field"
  | "advect-wetness"
  | "advect-mobile-pigment"
  | "paper-absorb-fix-evaporate"
  | "resolve-beer-lambert-paper";

export interface StudioLivingInkGpuPass {
  readonly id: string;
  readonly kernel:
    | Readonly<{ family: "shared-stable-fluid"; id: StudioSmokeKernelId }>
    | Readonly<{ family: "living-ink"; id: StudioLivingInkKernelId }>;
  readonly backendShaderLanguage: "wgsl" | "glsl-es-300";
  readonly regions: readonly StudioLivingInkGpuRegion[];
  readonly estimatedCellUpdates: number;
  readonly reads: readonly StudioLivingInkGpuResource["id"][];
  readonly writes: readonly StudioLivingInkGpuResource["id"][];
  readonly maskPolicy: "none" | "selection-alpha";
}

export interface StudioLivingInkGpuFrameBatch {
  readonly frameIndex: number;
  readonly passes: readonly StudioLivingInkGpuPass[];
  readonly estimatedCellUpdates: number;
  readonly targetFrameMilliseconds: number;
}

export interface StudioLivingInkGpuPlan {
  readonly kind: "studio-living-ink-gpu-plan";
  readonly version: typeof STUDIO_LIVING_INK_GPU_PROTOCOL_VERSION;
  readonly backend: StudioLivingInkGpuBackend;
  readonly execution: "dedicated-worker-offscreen";
  readonly canonicalAuthority: "gpu-rgba8-frame-plus-operation-journal";
  /** The planner includes target WebGPU resources not yet certified in the WebGL2 executor. */
  readonly runtimeCoverage: "provider-must-certify-declared-passes";
  readonly shaderReuse: "studio-smoke-wgsl-stable-fluid";
  readonly quality: StudioLivingInkGpuQuality;
  readonly coarseVelocityScale: 2 | 4 | 8;
  readonly pressureIterations: number;
  readonly material: StudioLivingInkMaterialControls;
  readonly inputPolicy: StudioLivingInkInputPolicy;
  readonly displayMode: StudioLivingInkDisplayMode;
  readonly visibilityStepping: "visible-dirty-only" | "all-dirty";
  readonly dirtyRegions: readonly StudioLivingInkGpuRegion[];
  readonly resources: readonly StudioLivingInkGpuResource[];
  readonly passes: readonly StudioLivingInkGpuPass[];
  readonly frameBatches: readonly StudioLivingInkGpuFrameBatch[];
  readonly performanceContract: typeof STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT;
}

export type StudioLivingInkGpuPlanResult =
  | Readonly<{ ok: true; value: StudioLivingInkGpuPlan }>
  | Readonly<{
      ok: false;
      reason:
        | "invalid-request"
        | "execution-boundary-unavailable"
        | "gpu-backend-unavailable"
        | "texture-limit"
        | "dirty-region-budget"
        | "pass-budget";
      detail: string;
    }>;

export const STUDIO_LIVING_INK_SHARED_SMOKE_KERNEL_IDS = Object.freeze([
  "advect_velocity",
  "advect_scalar",
  "curl",
  "vorticity_force",
  "vorticity_apply",
  "boundary",
  "divergence",
  "pressure_jacobi",
  "subtract_gradient",
] as const satisfies readonly StudioSmokeKernelId[]);

function failed(
  reason: Exclude<StudioLivingInkGpuPlanResult, { ok: true }>["reason"],
  detail: string,
): StudioLivingInkGpuPlanResult {
  return Object.freeze({ ok: false, reason, detail });
}

function validBounds(bounds: StudioLivingInkBounds, width: number, height: number): boolean {
  return Number.isSafeInteger(bounds.x)
    && Number.isSafeInteger(bounds.y)
    && Number.isSafeInteger(bounds.width)
    && Number.isSafeInteger(bounds.height)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width > 0
    && bounds.height > 0
    && bounds.x + bounds.width <= width
    && bounds.y + bounds.height <= height;
}

function validMaterial(value: StudioLivingInkMaterialControls): boolean {
  if (!Number.isFinite(value.brushSizeCells) || value.brushSizeCells < 0.25 || value.brushSizeCells > 192) {
    return false;
  }
  return Object.entries(value).every(([key, channel]) => key === "brushSizeCells"
    || (typeof channel === "number" && Number.isFinite(channel) && channel >= 0 && channel <= 1));
}

function validInputPolicy(value: StudioLivingInkInputPolicy): boolean {
  return ["pressure-speed-pen", "clean-water-brush", "pigment-water-brush", "white-gouache"]
    .includes(value.toolMode)
    && ["pen", "finger", "mouse"].includes(value.pointerSource)
    && ["hardware", "force-touch", "speed-simulated"].includes(value.pressureSource)
    && (value.barrelMomentarySwap === "none" || value.barrelMomentarySwap === "ink-water")
    && typeof value.rejectPalm === "boolean"
    && typeof value.rejectSecondaryPointer === "boolean";
}

function selectBackend(
  capabilities: StudioLivingInkGpuCapabilities,
): StudioLivingInkGpuBackend | null {
  if (capabilities.webgpu && capabilities.halfFloatRenderable) return "webgpu";
  if (capabilities.webgl2 && capabilities.halfFloatRenderable) return "webgl2";
  return null;
}

function adaptiveCoarseScale(
  width: number,
  height: number,
  dirtyArea: number,
  quality: StudioLivingInkGpuQuality,
): 2 | 4 | 8 {
  const fieldArea = width * height;
  if (quality === "settle" && fieldArea <= 1_048_576 && dirtyArea <= 262_144) return 2;
  if (fieldArea <= 4_194_304 && dirtyArea <= 1_048_576) return 4;
  return 8;
}

function clippedExpandedBounds(
  bounds: StudioLivingInkBounds,
  width: number,
  height: number,
  halo: number,
): StudioLivingInkBounds {
  const x = Math.max(0, bounds.x - halo);
  const y = Math.max(0, bounds.y - halo);
  const right = Math.min(width, bounds.x + bounds.width + halo);
  const bottom = Math.min(height, bounds.y + bounds.height + halo);
  return Object.freeze({ x, y, width: right - x, height: bottom - y });
}

function tileRegions(bounds: StudioLivingInkBounds): readonly StudioLivingInkGpuRegion[] {
  const tile = STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.dirtyTileSize;
  const regions: StudioLivingInkGpuRegion[] = [];
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  for (let y = bounds.y; y < bottom; y += tile) {
    for (let x = bounds.x; x < right; x += tile) {
      regions.push(Object.freeze({
        x,
        y,
        width: Math.min(tile, right - x),
        height: Math.min(tile, bottom - y),
      }));
    }
  }
  return Object.freeze(regions);
}

function regionWork(regions: readonly StudioLivingInkGpuRegion[]): number {
  return regions.reduce((total, region) => total + region.width * region.height, 0);
}

function frameSizedRegionGroups(
  regions: readonly StudioLivingInkGpuRegion[],
): readonly (readonly StudioLivingInkGpuRegion[])[] {
  const groups: Array<readonly StudioLivingInkGpuRegion[]> = [];
  let current: StudioLivingInkGpuRegion[] = [];
  let currentWork = 0;
  for (const region of regions) {
    const work = region.width * region.height;
    if (
      current.length > 0
      && currentWork + work
        > STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumCellUpdatesPerFrame
    ) {
      groups.push(Object.freeze(current));
      current = [];
      currentWork = 0;
    }
    current.push(region);
    currentWork += work;
  }
  if (current.length > 0) groups.push(Object.freeze(current));
  return Object.freeze(groups);
}

function livingPass(
  backend: StudioLivingInkGpuBackend,
  index: number,
  kernel: StudioLivingInkKernelId,
  regions: readonly StudioLivingInkGpuRegion[],
  reads: readonly StudioLivingInkGpuResource["id"][],
  writes: readonly StudioLivingInkGpuResource["id"][],
  masked: boolean,
): StudioLivingInkGpuPass {
  return Object.freeze({
    id: `living-ink/${index}/${kernel}`,
    kernel: Object.freeze({ family: "living-ink", id: kernel }),
    backendShaderLanguage: backend === "webgpu" ? "wgsl" : "glsl-es-300",
    regions,
    estimatedCellUpdates: regionWork(regions),
    reads: Object.freeze(reads),
    writes: Object.freeze(writes),
    maskPolicy: masked ? "selection-alpha" : "none",
  });
}

function sharedPass(
  backend: StudioLivingInkGpuBackend,
  index: number,
  kernel: StudioSmokeKernelId,
  regions: readonly StudioLivingInkGpuRegion[],
  reads: readonly StudioLivingInkGpuResource["id"][],
  writes: readonly StudioLivingInkGpuResource["id"][],
): StudioLivingInkGpuPass {
  if (!STUDIO_SMOKE_KERNEL_IDS.includes(kernel)) {
    throw new Error(`Unknown first-party stable-fluid kernel: ${kernel}`);
  }
  return Object.freeze({
    id: `living-ink/${index}/shared-${kernel}`,
    kernel: Object.freeze({ family: "shared-stable-fluid", id: kernel }),
    backendShaderLanguage: backend === "webgpu" ? "wgsl" : "glsl-es-300",
    regions,
    estimatedCellUpdates: regionWork(regions),
    reads: Object.freeze(reads),
    writes: Object.freeze(writes),
    maskPolicy: "none",
  });
}

function resources(
  width: number,
  height: number,
  coarseScale: 2 | 4 | 8,
): readonly StudioLivingInkGpuResource[] {
  const coarseWidth = Math.ceil(width / coarseScale);
  const coarseHeight = Math.ceil(height / coarseScale);
  const resource = (
    id: StudioLivingInkGpuResource["id"],
    format: StudioLivingInkGpuLogicalFormat,
    phase: "fine" | "coarse",
    persistence: "transient" | "document",
  ): StudioLivingInkGpuResource => Object.freeze({
    id,
    width: phase === "fine" ? width : coarseWidth,
    height: phase === "fine" ? height : coarseHeight,
    format,
    phase,
    persistence,
  });
  return Object.freeze([
    resource("surface-water", "r16float", "fine", "document"),
    resource("paper-water", "r16float", "fine", "document"),
    resource("wetness", "r16float", "fine", "document"),
    resource("mobile-pigment", "rgba16float", "fine", "document"),
    resource("fixed-pigment", "rgba16float", "fine", "document"),
    resource("paper-response", "rgba16float", "fine", "document"),
    resource("selection-mask", "r8unorm", "fine", "transient"),
    resource("velocity-a", "rg16float", "coarse", "transient"),
    resource("velocity-b", "rg16float", "coarse", "transient"),
    resource("pressure-a", "r16float", "coarse", "transient"),
    resource("pressure-b", "r16float", "coarse", "transient"),
    resource("divergence", "r16float", "coarse", "transient"),
  ]);
}

function operationKernel(kind: StudioLivingInkGpuRequest["operationKind"]): StudioLivingInkKernelId | null {
  if (kind === "ink") return "deposit-ink";
  if (kind === "water") return "inject-water";
  if (kind === "fix") return "fix-mobile-pigment";
  if (kind === "clear") return "clear-field";
  return null;
}

function buildFrameBatches(
  passes: readonly StudioLivingInkGpuPass[],
): readonly StudioLivingInkGpuFrameBatch[] {
  const batches: StudioLivingInkGpuFrameBatch[] = [];
  let current: StudioLivingInkGpuPass[] = [];
  let currentWork = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(Object.freeze({
      frameIndex: batches.length,
      passes: Object.freeze(current),
      estimatedCellUpdates: currentWork,
      targetFrameMilliseconds: STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.targetFrameMilliseconds,
    }));
    current = [];
    currentWork = 0;
  };
  for (const pass of passes) {
    if (
      current.length > 0
      && currentWork + pass.estimatedCellUpdates
        > STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumCellUpdatesPerFrame
    ) flush();
    current.push(pass);
    currentWork += pass.estimatedCellUpdates;
  }
  flush();
  return Object.freeze(batches);
}

export function planStudioLivingInkGpuPasses(
  request: StudioLivingInkGpuRequest,
  capabilities: StudioLivingInkGpuCapabilities,
): StudioLivingInkGpuPlanResult {
  if (
    !Number.isSafeInteger(request.width)
    || !Number.isSafeInteger(request.height)
    || request.width <= 0
    || request.height <= 0
    || !validBounds(request.dirtyBounds, request.width, request.height)
    || !Number.isSafeInteger(request.simulationTicks)
    || request.simulationTicks < 0
    || request.simulationTicks > STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumSimulationTicks
    || (request.quality !== "interactive" && request.quality !== "settle")
    || (request.material !== undefined && !validMaterial(request.material))
    || (request.inputPolicy !== undefined && !validInputPolicy(request.inputPolicy))
    || (
      request.displayMode !== undefined
      && !["composite", "mobile-pigment", "fixed-pigment", "water", "flow"]
        .includes(request.displayMode)
    )
    || (
      request.visibilityStepping !== undefined
      && request.visibilityStepping !== "visible-dirty-only"
      && request.visibilityStepping !== "all-dirty"
    )
  ) return failed("invalid-request", "Living Ink GPU request is malformed or over the tick budget.");
  if (!capabilities.worker || !capabilities.offscreenCanvas) {
    return failed(
      "execution-boundary-unavailable",
      "Living Ink GPU work must run in a dedicated Worker with OffscreenCanvas.",
    );
  }
  if (
    request.width > capabilities.maxTextureDimension2D
    || request.height > capabilities.maxTextureDimension2D
  ) return failed("texture-limit", "Living Ink field exceeds the device texture limit.");
  const backend = selectBackend(capabilities);
  if (!backend) return failed("gpu-backend-unavailable", "Neither WebGPU nor WebGL2 half-float rendering is available.");

  const dirtyArea = request.dirtyBounds.width * request.dirtyBounds.height;
  const coarseScale = adaptiveCoarseScale(
    request.width,
    request.height,
    dirtyArea,
    request.quality,
  );
  const halo = Math.max(2, request.simulationTicks * coarseScale);
  const expanded = clippedExpandedBounds(
    request.dirtyBounds,
    request.width,
    request.height,
    halo,
  );
  const regions = tileRegions(expanded);
  if (regions.length > STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumDirtyTilesPerPlan) {
    return failed("dirty-region-budget", "Dirty region exceeds the phone tile budget; defer settle work.");
  }
  const pressureIterations = request.quality === "interactive" ? 8 : 16;
  const passes: StudioLivingInkGpuPass[] = [];
  const pushLiving = (
    kernel: StudioLivingInkKernelId,
    reads: readonly StudioLivingInkGpuResource["id"][],
    writes: readonly StudioLivingInkGpuResource["id"][],
    masked = false,
  ): void => {
    for (const group of frameSizedRegionGroups(regions)) {
      passes.push(livingPass(backend, passes.length, kernel, group, reads, writes, masked));
    }
  };
  const pushShared = (
    kernel: StudioSmokeKernelId,
    reads: readonly StudioLivingInkGpuResource["id"][],
    writes: readonly StudioLivingInkGpuResource["id"][],
  ): void => {
    for (const group of frameSizedRegionGroups(regions)) {
      passes.push(sharedPass(backend, passes.length, kernel, group, reads, writes));
    }
  };

  const firstKernel = operationKernel(request.operationKind);
  if (firstKernel) {
    const writes: StudioLivingInkGpuResource["id"][] = request.operationKind === "fix"
      ? ["mobile-pigment", "fixed-pigment", "surface-water", "paper-water", "wetness"]
      : request.operationKind === "clear"
        ? ["mobile-pigment", "fixed-pigment", "surface-water", "paper-water", "wetness"]
        : request.operationKind === "water"
          ? ["surface-water", "wetness"]
          : ["surface-water", "wetness", "mobile-pigment"];
    pushLiving(firstKernel, request.hasSelectionMask ? ["selection-mask"] : [], writes, request.hasSelectionMask);
  }

  for (let tick = 0; tick < request.simulationTicks; tick += 1) {
    pushShared("advect_velocity", ["velocity-a"], ["velocity-b"]);
    pushShared("curl", ["velocity-b"], ["divergence"]);
    pushShared("vorticity_force", ["velocity-b", "divergence"], ["velocity-a"]);
    pushShared("vorticity_apply", ["velocity-a", "velocity-b"], ["velocity-b"]);
    pushShared("boundary", ["velocity-b"], ["velocity-b"]);
    pushShared("divergence", ["velocity-b"], ["divergence"]);
    for (let iteration = 0; iteration < pressureIterations; iteration += 1) {
      pushShared(
        "pressure_jacobi",
        ["divergence", iteration % 2 === 0 ? "pressure-a" : "pressure-b"],
        [iteration % 2 === 0 ? "pressure-b" : "pressure-a"],
      );
    }
    pushShared(
      "subtract_gradient",
      ["velocity-b", pressureIterations % 2 === 0 ? "pressure-a" : "pressure-b"],
      ["velocity-a"],
    );
    pushLiving("advect-wetness", ["velocity-a", "surface-water", "wetness"], ["surface-water", "wetness"]);
    pushLiving("advect-mobile-pigment", ["velocity-a", "wetness", "mobile-pigment"], ["mobile-pigment"]);
    pushLiving(
      "paper-absorb-fix-evaporate",
      ["paper-response", "surface-water", "paper-water", "wetness", "mobile-pigment", "fixed-pigment"],
      ["surface-water", "paper-water", "wetness", "mobile-pigment", "fixed-pigment"],
    );
  }
  pushLiving(
    "resolve-beer-lambert-paper",
    ["paper-response", "wetness", "mobile-pigment", "fixed-pigment"],
    [],
  );
  if (passes.length > STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumPassesPerPlan) {
    return failed("pass-budget", "Living Ink pass plan exceeds the bounded protocol budget.");
  }
  const frameBatches = buildFrameBatches(passes);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      kind: "studio-living-ink-gpu-plan",
      version: STUDIO_LIVING_INK_GPU_PROTOCOL_VERSION,
      backend,
      execution: "dedicated-worker-offscreen",
      canonicalAuthority: "gpu-rgba8-frame-plus-operation-journal",
      runtimeCoverage: "provider-must-certify-declared-passes",
      shaderReuse: "studio-smoke-wgsl-stable-fluid",
      quality: request.quality,
      coarseVelocityScale: coarseScale,
      pressureIterations,
      material: Object.freeze({
        ...(request.material ?? DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS),
      }),
      inputPolicy: Object.freeze({
        ...(request.inputPolicy ?? DEFAULT_STUDIO_LIVING_INK_INPUT_POLICY),
      }),
      displayMode: request.displayMode ?? "composite",
      visibilityStepping: request.visibilityStepping ?? "visible-dirty-only",
      dirtyRegions: regions,
      resources: resources(request.width, request.height, coarseScale),
      passes: Object.freeze(passes),
      frameBatches,
      performanceContract: STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT,
    }),
  });
}

/** Bridges an applied CPU operation to the GPU dirty-region protocol without re-reading marks. */
export function studioLivingInkGpuRequestFromReceipt(
  receipt: StudioLivingInkOperationReceipt,
  width: number,
  height: number,
  options: Readonly<{
    hasSelectionMask: boolean;
    simulationTicks: number;
    quality: StudioLivingInkGpuQuality;
    material?: StudioLivingInkMaterialControls;
    inputPolicy?: StudioLivingInkInputPolicy;
    displayMode?: StudioLivingInkDisplayMode;
    visibilityStepping?: "visible-dirty-only" | "all-dirty";
  }>,
): StudioLivingInkGpuRequest | null {
  if (!receipt.dirtyBounds) return null;
  return Object.freeze({
    width,
    height,
    operationKind: receipt.operationKind,
    dirtyBounds: receipt.dirtyBounds,
    hasSelectionMask: options.hasSelectionMask,
    simulationTicks: options.simulationTicks,
    quality: options.quality,
    material: options.material,
    inputPolicy: options.inputPolicy,
    displayMode: options.displayMode,
    visibilityStepping: options.visibilityStepping,
  });
}
