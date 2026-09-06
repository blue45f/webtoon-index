/**
 * CPU stable-fluids reference for the living-ink engine.
 *
 * This module owns the deterministic CPU twin of the certified WGSL/GLSL living-ink kernels —
 * `createStudioLivingInkFluidReference` / `stepStudioLivingInkFluidReference` and the shared
 * release-velocity damping selector. The code moved here VERBATIM from
 * `studio-living-ink-wgsl-shaders.ts` (2026-08-14, bundle discipline): the settled-only bake
 * (`studio-living-ink-settled-bake-v1.ts`) runs this solver synchronously on the studio route, and
 * importing it through the shader library dragged all seventeen WGSL compute-kernel sources —
 * GPU-only text that can never execute on the route — into the eager studio chunk (~74 KB raw).
 * Splitting the solver into this leaf keeps the route import graph shader-free while the Worker
 * runtimes keep their single import surface: `studio-living-ink-wgsl-shaders.ts` re-exports every
 * binding below, so the two files still read as one certified library.
 *
 * Invariants preserved from the shader library header:
 * - Every tunable still comes from the exported TS helpers of
 *   `studio-living-ink-execution-protocol.ts` (never re-derived here), so this reference cannot
 *   drift from the uniforms the GPU backends upload.
 * - This module must stay free of WGSL kernel text; the route-side import-boundary test
 *   (`studio-living-ink-route-import-boundary.test.ts`) fails the build if shader sources or the
 *   shader library itself become statically reachable from the durable render surfaces again.
 */

import {
  STUDIO_LIVING_INK_FLUID_DEFAULTS,
  studioLivingInkCoarseVelocityGrid,
  studioLivingInkEvaporationMultiplier,
  studioLivingInkVelocityDamping,
  studioLivingInkVorticityStrength,
} from "./studio-living-ink-execution-protocol";

/**
 * Release is not Fix. It needs a much shorter momentum tail, however: the production fast-stroke
 * probe measured 32.31 px of post-release drift with the Fix-only 7/s extra rate. Treating that as
 * `v0 / 7` gives an initial residual velocity near 226 px/s. An additional 60/s release rate keeps
 * the conservative discrete integral (move first, then damp at 60 Hz for 120 ticks) below 6 px,
 * leaving margin under the 7 px preferred gate without changing any pigment/drying semantics.
 */
export const STUDIO_LIVING_INK_RELEASE_VELOCITY_DAMPING_RATE_PER_SECOND = 60 as const;

/** Shared WebGL2/WebGPU/reference velocity retention selector for one fixed simulation tick. */
export function studioLivingInkVelocityDampingForStep(
  flow: number,
  dt: number,
  fixing: boolean,
  velocitySettling: boolean,
): number {
  // Fix retains its reviewed 7/s path exactly, even if a malformed caller supplies both flags.
  if (fixing) return studioLivingInkVelocityDamping(flow, dt, true);
  const interactiveRetention = studioLivingInkVelocityDamping(flow, dt, false);
  return velocitySettling
    ? interactiveRetention
      * Math.exp(-dt * STUDIO_LIVING_INK_RELEASE_VELOCITY_DAMPING_RATE_PER_SECOND)
    : interactiveRetention;
}

/* ------------------------------------------------------------------------------------------------
 * CPU reference solver
 *
 * A deterministic, allocation-stable mirror of the WGSL kernels in
 * `studio-living-ink-wgsl-shaders.ts`, sharing the exact uniform helpers
 * (`studioLivingInkVelocityDamping`, `studioLivingInkVorticityStrength`, …) rather than re-deriving
 * constants. It is the oracle for tests/visual/living-ink-fluid-quality.test.ts — headless WebGPU is
 * not available in the Node suite — and the numeric model a planner can consult without a device.
 * ---------------------------------------------------------------------------------------------- */

export interface StudioLivingInkFluidReferenceField {
  readonly width: number;
  readonly height: number;
  readonly coarseWidth: number;
  readonly coarseHeight: number;
  readonly coarseScale: number;
  /** Coarse, interleaved (x, y) in uv units per second. */
  readonly velocity: Float32Array;
  readonly velocityScratch: Float32Array;
  readonly pressure: Float32Array;
  readonly pressureScratch: Float32Array;
  readonly divergence: Float32Array;
  readonly curl: Float32Array;
  /** Fine surface water. */
  readonly wet: Float32Array;
  readonly wetScratch: Float32Array;
  /** Fine pigment, interleaved RGBA optical density (a = opaque-white coverage). */
  readonly pigment: Float32Array;
  readonly pigmentScratch: Float32Array;
}

/**
 * 활성 영역(파인 셀, 반열림 `[x0,x1)×[y0,y1)`). 생략하면 격자 전체.
 *
 * 공유 워시는 페이지의 모든 수묵 획의 합집합 크기로 자라므로, 획 하나를 정착시킬 때 격자 전체를
 * 쓸어내면 셀 수가 상한을 넘는 즉시 스텝이 0으로 꺼져 번짐·건조가 사라졌다(실측: 두 획이 몇 cm 만
 * 떨어져도 128×128 문서 px 를 넘음). 물·안료 패스는 획 주변 영역만 갱신하고, 값싼 coarse 속도
 * 패스는 그대로 전체를 돈다. 영역이 격자 전체면 결과는 예전과 바이트 단위로 같다.
 */
export interface StudioLivingInkFluidReferenceRegion {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface StudioLivingInkFluidReferenceOptions {
  readonly width: number;
  readonly height: number;
  readonly coarseBase?: number;
}

export function createStudioLivingInkFluidReference(
  options: StudioLivingInkFluidReferenceOptions,
): StudioLivingInkFluidReferenceField {
  const width = Math.max(2, Math.floor(options.width));
  const height = Math.max(2, Math.floor(options.height));
  const coarse = studioLivingInkCoarseVelocityGrid(width, height, options.coarseBase ?? 128);
  const fine = width * height;
  const coarseCells = coarse.width * coarse.height;
  return Object.freeze({
    width,
    height,
    coarseWidth: coarse.width,
    coarseHeight: coarse.height,
    coarseScale: coarse.scale,
    velocity: new Float32Array(coarseCells * 2),
    velocityScratch: new Float32Array(coarseCells * 2),
    pressure: new Float32Array(coarseCells),
    pressureScratch: new Float32Array(coarseCells),
    divergence: new Float32Array(coarseCells),
    curl: new Float32Array(coarseCells),
    wet: new Float32Array(fine),
    wetScratch: new Float32Array(fine),
    pigment: new Float32Array(fine * 4),
    pigmentScratch: new Float32Array(fine * 4),
  });
}

export interface StudioLivingInkFluidReferenceStepParams {
  readonly dt: number;
  readonly flow: number;
  readonly bleed: number;
  readonly dryRate: number;
  readonly chromaticSeparation: number;
  readonly vorticity: number;
  readonly capillaryCreep: number;
  readonly pressureIterations: number;
  readonly fixing?: boolean;
  /** Stops residual momentum at release without enabling fixation evaporation semantics. */
  readonly velocitySettling?: boolean;
  /**
   * Lab switches. Production always runs every pass; these exist so a quality gate can isolate one
   * mechanism and measure what it is actually worth (confinement vs. none, chromatographic
   * diffusion vs. chromatographic drift).
   */
  readonly confinement?: boolean;
  readonly transport?: boolean;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstepNumber(edge0: number, edge1: number, value: number): number {
  const t = clampNumber((value - edge0) / Math.max(1e-8, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

function sampleScalarBilinear(
  data: Float32Array,
  width: number,
  height: number,
  uvx: number,
  uvy: number,
): number {
  const px = clampNumber(uvx * width - 0.5, 0, width - 1);
  const py = clampNumber(uvy * height - 0.5, 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;
  const a = data[y0 * width + x0] ?? 0;
  const b = data[y0 * width + x1] ?? 0;
  const c = data[y1 * width + x0] ?? 0;
  const d = data[y1 * width + x1] ?? 0;
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function sampleVec2Bilinear(
  data: Float32Array,
  width: number,
  height: number,
  uvx: number,
  uvy: number,
  out: [number, number],
): [number, number] {
  const px = clampNumber(uvx * width - 0.5, 0, width - 1);
  const py = clampNumber(uvy * height - 0.5, 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;
  for (let channel = 0; channel < 2; channel += 1) {
    const a = data[(y0 * width + x0) * 2 + channel] ?? 0;
    const b = data[(y0 * width + x1) * 2 + channel] ?? 0;
    const c = data[(y1 * width + x0) * 2 + channel] ?? 0;
    const d = data[(y1 * width + x1) * 2 + channel] ?? 0;
    out[channel] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  return out;
}

function sampleRgbaChannelBilinear(
  data: Float32Array,
  width: number,
  height: number,
  uvx: number,
  uvy: number,
  channel: number,
): number {
  const px = clampNumber(uvx * width - 0.5, 0, width - 1);
  const py = clampNumber(uvy * height - 0.5, 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;
  const a = data[(y0 * width + x0) * 4 + channel] ?? 0;
  const b = data[(y0 * width + x1) * 4 + channel] ?? 0;
  const c = data[(y1 * width + x0) * 4 + channel] ?? 0;
  const d = data[(y1 * width + x1) * 4 + channel] ?? 0;
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** L2 norm of ∇·v over the coarse grid — the incompressibility residual. */
export function studioLivingInkReferenceDivergenceL2(
  field: StudioLivingInkFluidReferenceField,
): number {
  const { coarseWidth: w, coarseHeight: h, velocity } = field;
  let total = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const left = velocity[(y * w + clampIndex(x - 1, w)) * 2] ?? 0;
      const right = velocity[(y * w + clampIndex(x + 1, w)) * 2] ?? 0;
      const lower = velocity[(clampIndex(y - 1, h) * w + x) * 2 + 1] ?? 0;
      const upper = velocity[(clampIndex(y + 1, h) * w + x) * 2 + 1] ?? 0;
      const divergence = 0.5 * (right - left + upper - lower);
      total += divergence * divergence;
    }
  }
  return Math.sqrt(total);
}

/** Enstrophy ∑ω² — how much rotational energy the wash still carries. */
export function studioLivingInkReferenceEnstrophy(
  field: StudioLivingInkFluidReferenceField,
): number {
  const { coarseWidth: w, coarseHeight: h, velocity } = field;
  let total = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const leftY = velocity[(y * w + clampIndex(x - 1, w)) * 2 + 1] ?? 0;
      const rightY = velocity[(y * w + clampIndex(x + 1, w)) * 2 + 1] ?? 0;
      const lowerX = velocity[(clampIndex(y - 1, h) * w + x) * 2] ?? 0;
      const upperX = velocity[(clampIndex(y + 1, h) * w + x) * 2] ?? 0;
      const curl = 0.5 * ((rightY - leftY) - (upperX - lowerX));
      total += curl * curl;
    }
  }
  return total;
}

/** Angular momentum about the field centre — the visible "is it still spinning" quantity. */
export function studioLivingInkReferenceAngularMomentum(
  field: StudioLivingInkFluidReferenceField,
): number {
  const { coarseWidth: w, coarseHeight: h, velocity } = field;
  const centerX = (w - 1) / 2;
  const centerY = (h - 1) / 2;
  let total = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const rx = x - centerX;
      const ry = y - centerY;
      total += rx * (velocity[(y * w + x) * 2 + 1] ?? 0) - ry * (velocity[(y * w + x) * 2] ?? 0);
    }
  }
  return total;
}

/** Divergence → Jacobi → gradient subtract. Returns the residual before and after. */
export function projectStudioLivingInkReference(
  field: StudioLivingInkFluidReferenceField,
  iterations: number,
): Readonly<{ before: number; after: number }> {
  const { coarseWidth: w, coarseHeight: h, velocity, pressure, pressureScratch, divergence } = field;
  const before = studioLivingInkReferenceDivergenceL2(field);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const left = velocity[(y * w + clampIndex(x - 1, w)) * 2] ?? 0;
      const right = velocity[(y * w + clampIndex(x + 1, w)) * 2] ?? 0;
      const lower = velocity[(clampIndex(y - 1, h) * w + x) * 2 + 1] ?? 0;
      const upper = velocity[(clampIndex(y + 1, h) * w + x) * 2 + 1] ?? 0;
      divergence[y * w + x] = 0.5 * (right - left + upper - lower);
      pressure[y * w + x] = 0;
    }
  }
  let source = pressure;
  let target = pressureScratch;
  const sweeps = Math.max(0, Math.floor(iterations));
  for (let iteration = 0; iteration < sweeps; iteration += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const l = source[y * w + clampIndex(x - 1, w)] ?? 0;
        const r = source[y * w + clampIndex(x + 1, w)] ?? 0;
        const d = source[clampIndex(y - 1, h) * w + x] ?? 0;
        const uu = source[clampIndex(y + 1, h) * w + x] ?? 0;
        target[y * w + x] = (l + r + d + uu - (divergence[y * w + x] ?? 0)) * 0.25;
      }
    }
    const swap = source;
    source = target;
    target = swap;
  }
  if (source !== pressure) pressure.set(source);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const left = pressure[y * w + clampIndex(x - 1, w)] ?? 0;
      const right = pressure[y * w + clampIndex(x + 1, w)] ?? 0;
      const lower = pressure[clampIndex(y - 1, h) * w + x] ?? 0;
      const upper = pressure[clampIndex(y + 1, h) * w + x] ?? 0;
      const index = (y * w + x) * 2;
      const clamp = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp;
      velocity[index] = clampNumber(
        (velocity[index] ?? 0) - 0.5 * (right - left),
        -clamp,
        clamp,
      );
      velocity[index + 1] = clampNumber(
        (velocity[index + 1] ?? 0) - 0.5 * (upper - lower),
        -clamp,
        clamp,
      );
    }
  }
  return Object.freeze({ before, after: studioLivingInkReferenceDivergenceL2(field) });
}

function advectVelocityReference(
  field: StudioLivingInkFluidReferenceField,
  dt: number,
  damping: number,
): void {
  const { coarseWidth: w, coarseHeight: h, velocity, velocityScratch, wet } = field;
  const { minimum, maximum } = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityWetGate;
  const clamp = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp;
  const sampled: [number, number] = [0, 0];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = (y * w + x) * 2;
      const uvx = (x + 0.5) / w;
      const uvy = (y + 0.5) / h;
      const originX = clampNumber(uvx - (velocity[index] ?? 0) * dt, 0, 1);
      const originY = clampNumber(uvy - (velocity[index + 1] ?? 0) * dt, 0, 1);
      sampleVec2Bilinear(velocity, w, h, originX, originY, sampled);
      const wetness = sampleScalarBilinear(wet, field.width, field.height, uvx, uvy);
      const gate = smoothstepNumber(minimum, maximum, wetness);
      velocityScratch[index] = clampNumber(sampled[0] * damping * gate, -clamp, clamp);
      velocityScratch[index + 1] = clampNumber(sampled[1] * damping * gate, -clamp, clamp);
    }
  }
  velocity.set(velocityScratch);
}

function confineVorticityReference(
  field: StudioLivingInkFluidReferenceField,
  dt: number,
  strength: number,
): void {
  const { coarseWidth: w, coarseHeight: h, velocity, velocityScratch, curl } = field;
  const clamp = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const leftY = velocity[(y * w + clampIndex(x - 1, w)) * 2 + 1] ?? 0;
      const rightY = velocity[(y * w + clampIndex(x + 1, w)) * 2 + 1] ?? 0;
      const lowerX = velocity[(clampIndex(y - 1, h) * w + x) * 2] ?? 0;
      const upperX = velocity[(clampIndex(y + 1, h) * w + x) * 2] ?? 0;
      curl[y * w + x] = 0.5 * ((rightY - leftY) - (upperX - lowerX));
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const centerCurl = curl[y * w + x] ?? 0;
      const left = Math.abs(curl[y * w + clampIndex(x - 1, w)] ?? 0);
      const right = Math.abs(curl[y * w + clampIndex(x + 1, w)] ?? 0);
      const lower = Math.abs(curl[clampIndex(y - 1, h) * w + x] ?? 0);
      const upper = Math.abs(curl[clampIndex(y + 1, h) * w + x] ?? 0);
      let ridgeX = upper - lower;
      let ridgeY = right - left;
      const length = Math.max(Math.hypot(ridgeX, ridgeY), 1e-5);
      ridgeX /= length;
      ridgeY /= length;
      const index = (y * w + x) * 2;
      velocityScratch[index] = clampNumber(
        (velocity[index] ?? 0) + ridgeX * centerCurl * strength * dt,
        -clamp,
        clamp,
      );
      velocityScratch[index + 1] = clampNumber(
        (velocity[index + 1] ?? 0) - ridgeY * centerCurl * strength * dt,
        -clamp,
        clamp,
      );
    }
  }
  velocity.set(velocityScratch);
}

interface ResolvedFineBounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly full: boolean;
}

function resolveFineBounds(
  width: number,
  height: number,
  region: StudioLivingInkFluidReferenceRegion | undefined,
): ResolvedFineBounds {
  if (!region) return { x0: 0, y0: 0, x1: width, y1: height, full: true };
  const x0 = clampNumber(Math.floor(region.x0), 0, width);
  const y0 = clampNumber(Math.floor(region.y0), 0, height);
  const x1 = clampNumber(Math.ceil(region.x1), x0, width);
  const y1 = clampNumber(Math.ceil(region.y1), y0, height);
  return { x0, y0, x1, y1, full: x0 === 0 && y0 === 0 && x1 === width && y1 === height };
}

/** 스크래치 → 필드 복사. 영역 밖의 스크래치는 이전 스텝 값이라 절대 덮어쓰면 안 된다. */
function commitScratchRows(
  target: Float32Array,
  scratch: Float32Array,
  width: number,
  bounds: ResolvedFineBounds,
  channels: number,
): void {
  if (bounds.full) {
    target.set(scratch);
    return;
  }
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    const start = (y * width + bounds.x0) * channels;
    const end = (y * width + bounds.x1) * channels;
    target.set(scratch.subarray(start, end), start);
  }
}

function stepWetReference(
  field: StudioLivingInkFluidReferenceField,
  dt: number,
  creep: number,
  evaporation: number,
  region?: StudioLivingInkFluidReferenceRegion,
): void {
  const { width, height, wet, wetScratch, velocity, coarseWidth, coarseHeight } = field;
  const bounds = resolveFineBounds(width, height, region);
  const defaults = STUDIO_LIVING_INK_FLUID_DEFAULTS;
  const texelX = 1 / width;
  const texelY = 1 / height;
  const reachX = texelX * (1 + creep * defaults.creepReachGain);
  const reachY = texelY * (1 + creep * defaults.creepReachGain);
  const farX = reachX * defaults.creepFarReach;
  const farY = reachY * defaults.creepFarReach;
  const blend = clampNumber(creep * defaults.creepBlendGain, 0, defaults.creepBlendCeiling);
  const sampled: [number, number] = [0, 0];
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const uvx = (x + 0.5) * texelX;
      const uvy = (y + 0.5) * texelY;
      sampleVec2Bilinear(velocity, coarseWidth, coarseHeight, uvx, uvy, sampled);
      const originX = clampNumber(uvx - sampled[0] * dt * defaults.wetAdvectionScale, 0, 1);
      const originY = clampNumber(uvy - sampled[1] * dt * defaults.wetAdvectionScale, 0, 1);
      const center = sampleScalarBilinear(wet, width, height, originX, originY);
      const east = sampleScalarBilinear(wet, width, height, originX + reachX, originY);
      const west = sampleScalarBilinear(wet, width, height, originX - reachX, originY);
      const north = sampleScalarBilinear(wet, width, height, originX, originY + reachY);
      const south = sampleScalarBilinear(wet, width, height, originX, originY - reachY);
      const neighborhood = 0.25 * (east + west + north + south);
      const frontier = Math.max(
        Math.max(
          sampleScalarBilinear(wet, width, height, originX + farX, originY),
          sampleScalarBilinear(wet, width, height, originX - farX, originY),
        ),
        Math.max(
          sampleScalarBilinear(wet, width, height, originX, originY + farY),
          sampleScalarBilinear(wet, width, height, originX, originY - farY),
        ),
      );
      const frontAdvance = Math.max(0, frontier - center) * creep * defaults.frontAdvanceGain;
      const capillary = center + (neighborhood - center) * blend + frontAdvance;
      wetScratch[y * width + x] = clampNumber(capillary * evaporation, 0, defaults.wetCeiling);
    }
  }
  commitScratchRows(wet, wetScratch, width, bounds, 1);
}

function advectPigmentReference(
  field: StudioLivingInkFluidReferenceField,
  params: StudioLivingInkFluidReferenceStepParams,
  chroma: readonly [number, number, number],
  region?: StudioLivingInkFluidReferenceRegion,
): void {
  const { width, height, pigment, pigmentScratch, wet, velocity, coarseWidth, coarseHeight } = field;
  const bounds = resolveFineBounds(width, height, region);
  const defaults = STUDIO_LIVING_INK_FLUID_DEFAULTS;
  const texelX = 1 / width;
  const texelY = 1 / height;
  const separation = clampNumber(params.chromaticSeparation, 0, 1);
  const sampled: [number, number] = [0, 0];
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const cell = y * width + x;
      const base = cell * 4;
      const mobility = smoothstepNumber(
        defaults.pigmentWetGate.minimum,
        defaults.pigmentWetGate.maximum,
        wet[cell] ?? 0,
      );
      if (mobility < 0.001) {
        for (let channel = 0; channel < 4; channel += 1) {
          pigmentScratch[base + channel] = pigment[base + channel] ?? 0;
        }
        continue;
      }
      const uvx = (x + 0.5) * texelX;
      const uvy = (y + 0.5) * texelY;
      sampleVec2Bilinear(velocity, coarseWidth, coarseHeight, uvx, uvy, sampled);
      const wetGradientX = 0.5 * (
        sampleScalarBilinear(wet, width, height, uvx + texelX, uvy)
        - sampleScalarBilinear(wet, width, height, uvx - texelX, uvy)
      );
      const wetGradientY = 0.5 * (
        sampleScalarBilinear(wet, width, height, uvx, uvy + texelY)
        - sampleScalarBilinear(wet, width, height, uvx, uvy - texelY)
      );
      const gradientLength = Math.max(1e-8, Math.hypot(wetGradientX + 1e-6, wetGradientY + 1e-6));
      const capillary = (defaults.pigmentCapillaryBase + params.capillaryCreep * defaults.pigmentCapillaryGain)
        * mobility;
      const originX = clampNumber(
        uvx - sampled[0] * params.dt * mobility + ((wetGradientX + 1e-6) / gradientLength) * texelX * capillary,
        0,
        1,
      );
      const originY = clampNumber(
        uvy - sampled[1] * params.dt * mobility + ((wetGradientY + 1e-6) / gradientLength) * texelY * capillary,
        0,
        1,
      );
      const separationX = sampled[0] + wetGradientX * 4 + 1e-5;
      const separationY = sampled[1] + wetGradientY * 4 + 1e-5;
      const separationLength = Math.max(1e-8, Math.hypot(separationX, separationY));
      const shift = separation * mobility * params.dt * defaults.chromaShiftScale;
      const shiftX = (separationX / separationLength) * texelX * shift;
      const shiftY = (separationY / separationLength) * texelY * shift;
      const red = sampleRgbaChannelBilinear(
        pigment,
        width,
        height,
        clampNumber(originX - shiftX * chroma[0], 0, 1),
        clampNumber(originY - shiftY * chroma[0], 0, 1),
        0,
      );
      const green = sampleRgbaChannelBilinear(
        pigment,
        width,
        height,
        clampNumber(originX - shiftX * chroma[1] * defaults.chromaGreenShiftScale, 0, 1),
        clampNumber(originY - shiftY * chroma[1] * defaults.chromaGreenShiftScale, 0, 1),
        1,
      );
      const blue = sampleRgbaChannelBilinear(
        pigment,
        width,
        height,
        clampNumber(originX + shiftX * chroma[2] * defaults.chromaBlueShiftScale, 0, 1),
        clampNumber(originY + shiftY * chroma[2] * defaults.chromaBlueShiftScale, 0, 1),
        2,
      );
      const white = sampleRgbaChannelBilinear(pigment, width, height, originX, originY, 3);
      const transportBlend = clampNumber(
        mobility * params.dt
          * (defaults.pigmentTransportBase + params.bleed * defaults.pigmentTransportBleedGain),
        0,
        defaults.pigmentTransportCeiling,
      );
      const transported = [red, green, blue, white];
      for (let channel = 0; channel < 4; channel += 1) {
        const current = pigment[base + channel] ?? 0;
        pigmentScratch[base + channel] = current
          + ((transported[channel] ?? 0) - current) * transportBlend;
      }
    }
  }
  commitScratchRows(pigment, pigmentScratch, width, bounds, 4);
}

function diffusePigmentReference(
  field: StudioLivingInkFluidReferenceField,
  params: StudioLivingInkFluidReferenceStepParams,
  chroma: readonly [number, number, number],
  region?: StudioLivingInkFluidReferenceRegion,
): void {
  const { width, height, pigment, pigmentScratch, wet } = field;
  const bounds = resolveFineBounds(width, height, region);
  const defaults = STUDIO_LIVING_INK_FLUID_DEFAULTS;
  const rates = [chroma[0], chroma[1], chroma[2], defaults.pigmentWhiteChannelGain];
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const cell = y * width + x;
      const base = cell * 4;
      const mobility = smoothstepNumber(
        defaults.pigmentWetGate.minimum,
        defaults.pigmentWetGate.maximum,
        wet[cell] ?? 0,
      );
      const diffusion = Math.min(
        defaults.pigmentDiffusionCeiling,
        params.bleed * mobility * params.dt * defaults.pigmentDiffusionDtScale,
      );
      const west = (y * width + clampIndex(x - 1, width)) * 4;
      const east = (y * width + clampIndex(x + 1, width)) * 4;
      const south = (clampIndex(y - 1, height) * width + x) * 4;
      const north = (clampIndex(y + 1, height) * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const rate = Math.min(defaults.pigmentChannelCeiling, diffusion * (rates[channel] ?? 1));
        const neighbours = 0.25 * (
          (pigment[west + channel] ?? 0)
          + (pigment[east + channel] ?? 0)
          + (pigment[south + channel] ?? 0)
          + (pigment[north + channel] ?? 0)
        );
        const current = pigment[base + channel] ?? 0;
        pigmentScratch[base + channel] = current + (neighbours - current) * rate;
      }
    }
  }
  commitScratchRows(pigment, pigmentScratch, width, bounds, 4);
}

/**
 * One fixed simulation tick, in the same pass order the GPU runtime dispatches:
 * advect velocity → curl/confinement → projection → water → pigment transport → pigment diffusion.
 */
export function stepStudioLivingInkFluidReference(
  field: StudioLivingInkFluidReferenceField,
  params: StudioLivingInkFluidReferenceStepParams,
  region?: StudioLivingInkFluidReferenceRegion,
): Readonly<{ divergenceBefore: number; divergenceAfter: number }> {
  const fixing = params.fixing === true;
  const velocitySettling = params.velocitySettling === true;
  const chroma = studioLivingInkReferenceChroma(params.chromaticSeparation);
  advectVelocityReference(
    field,
    params.dt,
    studioLivingInkVelocityDampingForStep(
      params.flow,
      params.dt,
      fixing,
      velocitySettling,
    ),
  );
  if (params.confinement !== false) {
    confineVorticityReference(
      field,
      params.dt,
      studioLivingInkVorticityStrength(params.vorticity),
    );
  }
  const projection = projectStudioLivingInkReference(field, params.pressureIterations);
  stepWetReference(
    field,
    params.dt,
    clampNumber(params.capillaryCreep, 0, 1),
    studioLivingInkEvaporationMultiplier(params.dryRate, params.dt, fixing),
    region,
  );
  if (params.transport !== false) advectPigmentReference(field, params, chroma, region);
  diffusePigmentReference(field, params, chroma, region);
  return Object.freeze({
    divergenceBefore: projection.before,
    divergenceAfter: projection.after,
  });
}

/**
 * InkWash §06 chromatography multipliers, duplicated here as a dependency-free local so the shader
 * library does not import the CPU field module (which would create a cycle through the runtime).
 * `studio-living-ink-field.ts` owns the canonical coefficients and its unit test pins this parity.
 */
export function studioLivingInkReferenceChroma(
  chromaticSeparation: number,
): readonly [number, number, number] {
  const chroma = clampNumber(chromaticSeparation, 0, 1);
  return Object.freeze([
    1 + 0.85 * chroma,
    1 + 0.15 * chroma,
    Math.max(0.25, 1 - 0.65 * chroma),
  ]);
}

/** Gaussian deposit into the reference field, mirroring the `splat` kernel. */
export function depositStudioLivingInkReference(
  field: StudioLivingInkFluidReferenceField,
  mark: Readonly<{
    x: number;
    y: number;
    radius: number;
    amount: number;
    color?: readonly [number, number, number];
    wet?: number;
  }>,
): void {
  const { width, height, pigment, wet } = field;
  const radius = Math.max(0.5, mark.radius);
  const r2 = radius * radius;
  const color = mark.color ?? [0.15, 0.12, 0.1];
  const water = mark.wet ?? 0;
  const left = Math.max(0, Math.floor(mark.x - radius * 2));
  const right = Math.min(width - 1, Math.ceil(mark.x + radius * 2));
  const bottom = Math.max(0, Math.floor(mark.y - radius * 2));
  const top = Math.min(height - 1, Math.ceil(mark.y + radius * 2));
  for (let y = bottom; y <= top; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - mark.x;
      const dy = y + 0.5 - mark.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 * 4) continue;
      const weight = Math.exp(-d2 / Math.max(r2, 1e-4)) * mark.amount;
      const cell = y * width + x;
      pigment[cell * 4] = (pigment[cell * 4] ?? 0) + color[0] * weight;
      pigment[cell * 4 + 1] = (pigment[cell * 4 + 1] ?? 0) + color[1] * weight;
      pigment[cell * 4 + 2] = (pigment[cell * 4 + 2] ?? 0) + color[2] * weight;
      wet[cell] = (wet[cell] ?? 0) + water * weight;
    }
  }
}

/**
 * Injects an outward capillary impulse — the deliberately *divergent* field a dwell water mark
 * creates (the GLSL deposit shader's `radialVector` splat, and what a wet brush physically does
 * when it adds water to paper). Pressure projection removes divergence by construction, so this is
 * the initial condition a gate needs in order to notice that over-solving the Poisson equation
 * suppresses the capillary outflow and leaves the pigment piled in the middle of the dab.
 */
export function seedStudioLivingInkReferenceRadialImpulse(
  field: StudioLivingInkFluidReferenceField,
  strength: number,
): void {
  const { coarseWidth: w, coarseHeight: h, velocity } = field;
  const centerX = (w - 1) / 2;
  const centerY = (h - 1) / 2;
  const radius = Math.max(1.5, Math.min(w, h) * 0.12);
  const clamp = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.max(1e-3, Math.hypot(dx, dy));
      const falloff = Math.exp(-(distance * distance) / (radius * radius));
      const index = (y * w + x) * 2;
      velocity[index] = clampNumber((dx / distance) * strength * falloff, -clamp, clamp);
      velocity[index + 1] = clampNumber((dy / distance) * strength * falloff, -clamp, clamp);
    }
  }
}

/**
 * Mean pigment density over an annulus about the field centre, in the same core/rim geometry the
 * browser probe uses for `isolatedBloomRimMinusCenterDarkness`.
 */
export function studioLivingInkReferenceAnnulusDensity(
  field: StudioLivingInkFluidReferenceField,
  minimumRadius: number,
  maximumRadius: number,
): number {
  const { width, height, pigment } = field;
  const centerX = width / 2;
  const centerY = height / 2;
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distance < minimumRadius || distance >= maximumRadius) continue;
      const cell = (y * width + x) * 4;
      total += (pigment[cell] ?? 0) + (pigment[cell + 1] ?? 0) + (pigment[cell + 2] ?? 0);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

/** Injects a rigid-body vortex into the coarse velocity field (quality-gate initial condition). */
export function seedStudioLivingInkReferenceVortex(
  field: StudioLivingInkFluidReferenceField,
  strength: number,
): void {
  const { coarseWidth: w, coarseHeight: h, velocity } = field;
  const centerX = (w - 1) / 2;
  const centerY = (h - 1) / 2;
  const radius = Math.max(1, Math.min(w, h) * 0.35);
  const clamp = STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityClamp;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy);
      const falloff = Math.exp(-(distance * distance) / (2 * radius * radius));
      const index = (y * w + x) * 2;
      velocity[index] = clampNumber(-dy * strength * falloff, -clamp, clamp);
      velocity[index + 1] = clampNumber(dx * strength * falloff, -clamp, clamp);
    }
  }
}
