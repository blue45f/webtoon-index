/**
 * Studio Path Tracer — WGSL 메가커널 + 패커 (studio-pathtrace-wgsl)
 *
 * CPU 순수 코어(studio-pathtrace-*.ts)와 **같은 공식**을 WebGPU 컴퓨트로 옮긴 포트다.
 * 웨이브프론트가 아니라 픽셀당 스레드 1개의 메가커널이며, 디스패치 1회 = 샘플 1개다
 * (프로그레시브 누적은 호출부가 sampleIndex 를 올려가며 반복 디스패치).
 *
 * 드리프트 방지 설계
 *  - PCG 상수·워크그룹 크기·바인딩 인덱스·RR 범위·alpha 하한·톤맵 계수를 **TS 상수에서
 *    문자열 보간**한다. 즉 WGSL 쪽 숫자를 손으로 고칠 수 없다(정의상 동기화된다).
 *  - 각 WGSL 함수 위 주석에 대응 TS 함수명을 적었다.
 *  - 샘플러는 정수 해시라 CPU/GPU 가 **정확히 같은 u32** 를 만든다.
 *
 * 정직한 한계
 *  - **CPU↔GPU 비트 동일은 불가능하다.** CPU 코어는 f64 로 계산하고 f32 로 저장하는 반면
 *    WGSL 은 전 구간 f32 이며, sqrt/pow/역수 정밀도와 fma 계약도 백엔드마다 다르다.
 *    계약은 두 층으로 쪼갠다:
 *      (1) **같은 백엔드 안에서는 바이트 동일** — 시드·spp 가 같으면 타일 분할과 무관.
 *      (2) **CPU↔GPU 는 허용오차** — 채널당 ≤ 2/255, 평균 절대 오차 ≤ 0.5/255.
 *    (2)는 실제 WebGPU 디바이스가 필요하므로 node 테스트가 아니라 verify 스크립트 영역이다.
 *  - 이 파일의 테스트는 **구조 계약 + 패커 대조**만 검증한다. 셰이더를 실제로 컴파일·실행하지
 *    않는다(node 환경에 WebGPU 가 없다). "컴파일된다"를 주장하지 않는다.
 *  - 텍스처·투과·인스턴싱 없음은 CPU 코어와 동일(각 모듈 docstring 참조).
 */

import {
  STUDIO_PATHTRACE_MIN_ALPHA,
  STUDIO_PATHTRACE_LUMA,
} from "./studio-pathtrace-bsdf";
import { STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE } from "./studio-pathtrace-bvh";
import {
  STUDIO_PATHTRACE_AABB_TFAR_SCALE,
  STUDIO_PATHTRACE_INV_DIR_LIMIT,
} from "./studio-pathtrace-geometry";
import {
  STUDIO_PATHTRACE_RAY_EPSILON,
  STUDIO_PATHTRACE_RR_MAX,
  STUDIO_PATHTRACE_RR_MIN,
} from "./studio-pathtrace-integrator";
import {
  STUDIO_PATHTRACE_MIX_BOUNCE,
  STUDIO_PATHTRACE_MIX_DIMENSION,
  STUDIO_PATHTRACE_MIX_SAMPLE,
  STUDIO_PATHTRACE_PCG_INCREMENT,
  STUDIO_PATHTRACE_PCG_MULTIPLIER,
  STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER,
} from "./studio-pathtrace-sampler";

import type { StudioPathtraceIntegratorMode } from "./studio-pathtrace-integrator";
import type {
  StudioPathtraceEnvironment,
  StudioPathtraceLight,
  StudioPathtraceMaterial,
} from "./studio-pathtrace-scene";

// ---------------------------------------------------------------------------
// 디스패치 / 바인딩 상수 — studio-gpu-filter-kernels.ts 와 같은 전략
// ---------------------------------------------------------------------------

/** WGSL `@workgroup_size` 리터럴과 반드시 일치(구조 테스트가 대조). */
export const STUDIO_PATHTRACE_WORKGROUP_SIZE = 64;

/**
 * 1 디스패치 행이 담당하는 스레드 수 — WGSL 의 리터럴과 일치.
 * dispatchWorkgroups(x = ROW_THREADS/WORKGROUP_SIZE, y = ceil(pixels/ROW_THREADS)) 로
 * maxComputeWorkgroupsPerDimension(65535) 한계를 우회한다.
 */
export const STUDIO_PATHTRACE_DISPATCH_ROW_THREADS = 16384;

export const STUDIO_PATHTRACE_ENTRY_POINT = "pt_main";

export const STUDIO_PATHTRACE_BINDINGS = {
  uniform: 0,
  positions: 1,
  indices: 2,
  triMaterial: 3,
  nodeBounds: 4,
  nodeMeta: 5,
  triIndex: 6,
  materials: 7,
  lights: 8,
  accum: 9,
} as const;

export const STUDIO_PATHTRACE_MODE_CODE: Readonly<Record<StudioPathtraceIntegratorMode, number>> = {
  "nee-mis": 0,
  "naive-bsdf": 1,
};

export const STUDIO_PATHTRACE_ENV_CODE = { constant: 0, gradient: 1 } as const;
export const STUDIO_PATHTRACE_LIGHT_CODE = { point: 0, area: 1 } as const;

// ---------------------------------------------------------------------------
// 버퍼 레이아웃
// ---------------------------------------------------------------------------

export const STUDIO_PATHTRACE_UNIFORM_BYTES = 144;

/** uniform 바이트 오프셋 — WGSL `PtUniform` 멤버 순서에서 유도된다. */
export const STUDIO_PATHTRACE_UNIFORM_OFFSETS = {
  camPos: 0,
  width: 12,
  camRight: 16,
  height: 28,
  camUp: 32,
  sampleIndex: 44,
  camForward: 48,
  seed: 60,
  tanHalfFovY: 64,
  aspect: 68,
  maxBounces: 72,
  rrStartBounce: 76,
  lightCount: 80,
  materialCount: 84,
  mode: 88,
  samplesPerPixel: 92,
  envKind: 96,
  clampIndirect: 100,
  rrEnabled: 104,
  envA: 112,
  envB: 128,
} as const;

/** 머티리얼 1개 = vec4 × 3. */
export const STUDIO_PATHTRACE_MATERIAL_BYTES = 48;
export const STUDIO_PATHTRACE_MATERIAL_FLOATS = 12;
/** 광원 1개 = vec4 × 4. */
export const STUDIO_PATHTRACE_LIGHT_BYTES = 64;
export const STUDIO_PATHTRACE_LIGHT_FLOATS = 16;
/** 누적 버퍼 픽셀당 f32 4개(r, g, b, sampleCount). */
export const STUDIO_PATHTRACE_ACCUM_FLOATS_PER_PIXEL = 4;

export interface StudioPathtraceUniformInput {
  readonly camPos: readonly [number, number, number];
  readonly camRight: readonly [number, number, number];
  readonly camUp: readonly [number, number, number];
  readonly camForward: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly sampleIndex: number;
  readonly seed: number;
  readonly tanHalfFovY: number;
  readonly aspect: number;
  readonly maxBounces: number;
  readonly rrStartBounce: number;
  readonly rrEnabled: boolean;
  readonly lightCount: number;
  readonly materialCount: number;
  readonly mode: StudioPathtraceIntegratorMode;
  readonly samplesPerPixel: number;
  readonly clampIndirect: number;
  readonly environment: StudioPathtraceEnvironment;
}

/** uniform 버퍼를 굽는다(std140 호환 배치). */
export function packStudioPathtraceUniform(input: StudioPathtraceUniformInput): ArrayBuffer {
  const buffer = new ArrayBuffer(STUDIO_PATHTRACE_UNIFORM_BYTES);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  const o = STUDIO_PATHTRACE_UNIFORM_OFFSETS;
  f32[o.camPos / 4] = input.camPos[0];
  f32[o.camPos / 4 + 1] = input.camPos[1];
  f32[o.camPos / 4 + 2] = input.camPos[2];
  u32[o.width / 4] = input.width >>> 0;
  f32[o.camRight / 4] = input.camRight[0];
  f32[o.camRight / 4 + 1] = input.camRight[1];
  f32[o.camRight / 4 + 2] = input.camRight[2];
  u32[o.height / 4] = input.height >>> 0;
  f32[o.camUp / 4] = input.camUp[0];
  f32[o.camUp / 4 + 1] = input.camUp[1];
  f32[o.camUp / 4 + 2] = input.camUp[2];
  u32[o.sampleIndex / 4] = input.sampleIndex >>> 0;
  f32[o.camForward / 4] = input.camForward[0];
  f32[o.camForward / 4 + 1] = input.camForward[1];
  f32[o.camForward / 4 + 2] = input.camForward[2];
  u32[o.seed / 4] = input.seed >>> 0;
  f32[o.tanHalfFovY / 4] = input.tanHalfFovY;
  f32[o.aspect / 4] = input.aspect;
  u32[o.maxBounces / 4] = input.maxBounces >>> 0;
  u32[o.rrStartBounce / 4] = input.rrStartBounce >>> 0;
  u32[o.lightCount / 4] = input.lightCount >>> 0;
  u32[o.materialCount / 4] = input.materialCount >>> 0;
  u32[o.mode / 4] = STUDIO_PATHTRACE_MODE_CODE[input.mode];
  u32[o.samplesPerPixel / 4] = input.samplesPerPixel >>> 0;
  const env = input.environment;
  u32[o.envKind / 4] = env.kind === "gradient"
    ? STUDIO_PATHTRACE_ENV_CODE.gradient
    : STUDIO_PATHTRACE_ENV_CODE.constant;
  f32[o.clampIndirect / 4] = input.clampIndirect;
  u32[o.rrEnabled / 4] = input.rrEnabled ? 1 : 0;
  if (env.kind === "constant") {
    f32[o.envA / 4] = env.radianceLinear[0];
    f32[o.envA / 4 + 1] = env.radianceLinear[1];
    f32[o.envA / 4 + 2] = env.radianceLinear[2];
    f32[o.envB / 4] = env.radianceLinear[0];
    f32[o.envB / 4 + 1] = env.radianceLinear[1];
    f32[o.envB / 4 + 2] = env.radianceLinear[2];
  } else {
    f32[o.envA / 4] = env.zenithLinear[0];
    f32[o.envA / 4 + 1] = env.zenithLinear[1];
    f32[o.envA / 4 + 2] = env.zenithLinear[2];
    f32[o.envB / 4] = env.horizonLinear[0];
    f32[o.envB / 4 + 1] = env.horizonLinear[1];
    f32[o.envB / 4 + 2] = env.horizonLinear[2];
  }
  return buffer;
}

/** 머티리얼 배열 → storage 버퍼(머티리얼당 12 f32). */
export function packStudioPathtraceMaterials(
  materials: readonly StudioPathtraceMaterial[],
): Float32Array {
  const out = new Float32Array(Math.max(1, materials.length) * STUDIO_PATHTRACE_MATERIAL_FLOATS);
  for (let i = 0; i < materials.length; i += 1) {
    const m = materials[i];
    const b = i * STUDIO_PATHTRACE_MATERIAL_FLOATS;
    out[b] = m.baseColorLinear[0];
    out[b + 1] = m.baseColorLinear[1];
    out[b + 2] = m.baseColorLinear[2];
    out[b + 3] = m.roughness;
    out[b + 4] = m.emissiveLinear[0];
    out[b + 5] = m.emissiveLinear[1];
    out[b + 6] = m.emissiveLinear[2];
    out[b + 7] = m.metallic;
    out[b + 8] = m.ior;
    out[b + 9] = 0;
    out[b + 10] = 0;
    out[b + 11] = 0;
  }
  return out;
}

/**
 * 광원 배열 → storage 버퍼(광원당 16 f32).
 * v0 = origin.xyz + kind, v1 = edgeU.xyz + radius, v2 = edgeV.xyz + twoSided,
 * v3 = emissive.xyz + area(면적 광원만; 포인트는 0).
 * `area` 를 미리 구워두면 셰이더가 매 NEE 마다 cross/length 를 다시 하지 않는다.
 */
export function packStudioPathtraceLights(lights: readonly StudioPathtraceLight[]): Float32Array {
  const out = new Float32Array(Math.max(1, lights.length) * STUDIO_PATHTRACE_LIGHT_FLOATS);
  for (let i = 0; i < lights.length; i += 1) {
    const l = lights[i];
    const b = i * STUDIO_PATHTRACE_LIGHT_FLOATS;
    if (l.kind === "point") {
      out[b] = l.positionWorld[0];
      out[b + 1] = l.positionWorld[1];
      out[b + 2] = l.positionWorld[2];
      out[b + 3] = STUDIO_PATHTRACE_LIGHT_CODE.point;
      out[b + 7] = l.radius;
      out[b + 12] = l.intensityLinear[0];
      out[b + 13] = l.intensityLinear[1];
      out[b + 14] = l.intensityLinear[2];
      out[b + 15] = 0;
    } else {
      out[b] = l.origin[0];
      out[b + 1] = l.origin[1];
      out[b + 2] = l.origin[2];
      out[b + 3] = STUDIO_PATHTRACE_LIGHT_CODE.area;
      out[b + 4] = l.edgeU[0];
      out[b + 5] = l.edgeU[1];
      out[b + 6] = l.edgeU[2];
      out[b + 7] = 0;
      out[b + 8] = l.edgeV[0];
      out[b + 9] = l.edgeV[1];
      out[b + 10] = l.edgeV[2];
      out[b + 11] = l.twoSided ? 1 : 0;
      out[b + 12] = l.emissiveLinear[0];
      out[b + 13] = l.emissiveLinear[1];
      out[b + 14] = l.emissiveLinear[2];
      const cx = l.edgeU[1] * l.edgeV[2] - l.edgeU[2] * l.edgeV[1];
      const cy = l.edgeU[2] * l.edgeV[0] - l.edgeU[0] * l.edgeV[2];
      const cz = l.edgeU[0] * l.edgeV[1] - l.edgeU[1] * l.edgeV[0];
      out[b + 15] = Math.hypot(cx, cy, cz);
    }
  }
  return out;
}

/** maxComputeWorkgroupsPerDimension 안에서 픽셀 수를 덮는 디스패치 크기. */
export function planStudioPathtraceDispatch(pixelCount: number): { x: number; y: number } {
  const rows = Math.max(1, Math.ceil(pixelCount / STUDIO_PATHTRACE_DISPATCH_ROW_THREADS));
  return {
    x: STUDIO_PATHTRACE_DISPATCH_ROW_THREADS / STUDIO_PATHTRACE_WORKGROUP_SIZE,
    y: rows,
  };
}

/** GPU 누적 버퍼(4 f32/px) → CPU 필름 형식으로 접기. 필름은 가산 갱신된다. */
export function mergeStudioPathtraceGpuAccum(
  accum: Float32Array,
  filmAccum: Float32Array,
  filmSampleCount: Uint32Array,
): void {
  const pixels = filmSampleCount.length;
  for (let p = 0; p < pixels; p += 1) {
    const b = p * STUDIO_PATHTRACE_ACCUM_FLOATS_PER_PIXEL;
    filmAccum[p * 3] += accum[b];
    filmAccum[p * 3 + 1] += accum[b + 1];
    filmAccum[p * 3 + 2] += accum[b + 2];
    filmSampleCount[p] += Math.round(accum[b + 3]);
  }
}

// ---------------------------------------------------------------------------
// WGSL 소스 — 숫자는 전부 위 TS 상수에서 보간된다.
// ---------------------------------------------------------------------------

function f32Literal(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function buildStudioPathtraceWgsl(): string {
  const stack = STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE;
  return `// studio-pathtrace-wgsl.ts 가 TS 상수에서 생성한다 — 손으로 숫자를 고치지 말 것.
const PT_PCG_MULT: u32 = ${STUDIO_PATHTRACE_PCG_MULTIPLIER}u;
const PT_PCG_INC: u32 = ${STUDIO_PATHTRACE_PCG_INCREMENT}u;
const PT_PCG_OUT: u32 = ${STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER}u;
const PT_MIX_SAMPLE: u32 = ${STUDIO_PATHTRACE_MIX_SAMPLE}u;
const PT_MIX_BOUNCE: u32 = ${STUDIO_PATHTRACE_MIX_BOUNCE}u;
const PT_MIX_DIM: u32 = ${STUDIO_PATHTRACE_MIX_DIMENSION}u;
const PT_MIN_ALPHA: f32 = ${f32Literal(STUDIO_PATHTRACE_MIN_ALPHA)};
const PT_EPS: f32 = ${f32Literal(STUDIO_PATHTRACE_RAY_EPSILON)};
const PT_RR_MIN: f32 = ${f32Literal(STUDIO_PATHTRACE_RR_MIN)};
const PT_RR_MAX: f32 = ${f32Literal(STUDIO_PATHTRACE_RR_MAX)};
const PT_TFAR_SCALE: f32 = ${f32Literal(STUDIO_PATHTRACE_AABB_TFAR_SCALE)};
const PT_INV_LIMIT: f32 = ${f32Literal(STUDIO_PATHTRACE_INV_DIR_LIMIT)};
const PT_LUMA: vec3<f32> = vec3<f32>(${f32Literal(STUDIO_PATHTRACE_LUMA[0])}, ${f32Literal(STUDIO_PATHTRACE_LUMA[1])}, ${f32Literal(STUDIO_PATHTRACE_LUMA[2])});
const PT_ROW_THREADS: u32 = ${STUDIO_PATHTRACE_DISPATCH_ROW_THREADS}u;
const PT_STACK: u32 = ${stack}u;
const PT_PI: f32 = 3.14159265358979323846;
const PT_MODE_NEE_MIS: u32 = ${STUDIO_PATHTRACE_MODE_CODE["nee-mis"]}u;
const PT_ENV_GRADIENT: u32 = ${STUDIO_PATHTRACE_ENV_CODE.gradient}u;
const PT_LIGHT_AREA: f32 = ${f32Literal(STUDIO_PATHTRACE_LIGHT_CODE.area)};
const PT_DIM_JITTER_X: u32 = 0u;
const PT_DIM_JITTER_Y: u32 = 1u;
const PT_DIM_LIGHT_SELECT: u32 = 2u;
const PT_DIM_LIGHT_U: u32 = 3u;
const PT_DIM_LIGHT_V: u32 = 4u;
const PT_DIM_BSDF_LOBE: u32 = 5u;
const PT_DIM_BSDF_U: u32 = 6u;
const PT_DIM_BSDF_V: u32 = 7u;
const PT_DIM_RR: u32 = 8u;

struct PtUniform {
  camPos: vec3<f32>,
  width: u32,
  camRight: vec3<f32>,
  height: u32,
  camUp: vec3<f32>,
  sampleIndex: u32,
  camForward: vec3<f32>,
  seed: u32,
  tanHalfFovY: f32,
  aspect: f32,
  maxBounces: u32,
  rrStartBounce: u32,
  lightCount: u32,
  materialCount: u32,
  mode: u32,
  samplesPerPixel: u32,
  envKind: u32,
  clampIndirect: f32,
  rrEnabled: u32,
  pad0: u32,
  envA: vec4<f32>,
  envB: vec4<f32>,
}

@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.uniform}) var<uniform> pt_u: PtUniform;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.positions}) var<storage, read> pt_positions: array<f32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.indices}) var<storage, read> pt_indices: array<u32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.triMaterial}) var<storage, read> pt_tri_material: array<u32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.nodeBounds}) var<storage, read> pt_node_bounds: array<f32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.nodeMeta}) var<storage, read> pt_node_meta: array<u32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.triIndex}) var<storage, read> pt_tri_index: array<u32>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.materials}) var<storage, read> pt_materials: array<vec4<f32>>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.lights}) var<storage, read> pt_lights: array<vec4<f32>>;
@group(0) @binding(${STUDIO_PATHTRACE_BINDINGS.accum}) var<storage, read_write> pt_accum: array<f32>;

// TS: studioPathtracePcgHash
fn pt_pcg_hash(input: u32) -> u32 {
  let state: u32 = input * PT_PCG_MULT + PT_PCG_INC;
  let shifted: u32 = ((state >> ((state >> 28u) + 4u)) ^ state);
  let word: u32 = shifted * PT_PCG_OUT;
  return (word >> 22u) ^ word;
}

// TS: studioPathtraceHash
fn pt_hash(pixel: u32, samp: u32, bounce: u32, dim: u32, seed: u32) -> u32 {
  var h: u32 = pt_pcg_hash(seed ^ pixel);
  h = pt_pcg_hash(h ^ (samp * PT_MIX_SAMPLE));
  h = pt_pcg_hash(h ^ (bounce * PT_MIX_BOUNCE));
  h = pt_pcg_hash(h ^ (dim * PT_MIX_DIM));
  return h;
}

// TS: studioPathtraceRandom01
fn pt_rand01(pixel: u32, samp: u32, bounce: u32, dim: u32, seed: u32) -> f32 {
  return f32(pt_hash(pixel, samp, bounce, dim, seed)) * 2.3283064365386963e-10;
}

// TS: studioPathtraceStrataPerAxis
fn pt_strata(spp: u32) -> u32 {
  return max(1u, u32(floor(sqrt(f32(max(1u, spp))))));
}

// TS: sampleStudioPathtraceUniformDisk
fn pt_sample_disk(u1: f32, u2: f32) -> vec2<f32> {
  let a: f32 = 2.0 * u1 - 1.0;
  let b: f32 = 2.0 * u2 - 1.0;
  if (a == 0.0 && b == 0.0) { return vec2<f32>(0.0, 0.0); }
  var r: f32 = 0.0;
  var phi: f32 = 0.0;
  if (a * a > b * b) {
    r = a;
    phi = (PT_PI / 4.0) * (b / a);
  } else {
    r = b;
    phi = PT_PI / 2.0 - (PT_PI / 4.0) * (a / b);
  }
  return vec2<f32>(r * cos(phi), r * sin(phi));
}

// TS: sampleStudioPathtraceCosineHemisphere
fn pt_sample_cosine(u1: f32, u2: f32) -> vec3<f32> {
  let d: vec2<f32> = pt_sample_disk(u1, u2);
  return vec3<f32>(d.x, d.y, sqrt(max(0.0, 1.0 - d.x * d.x - d.y * d.y)));
}

// TS: sampleStudioPathtraceGgxVndf (Heitz 2018)
fn pt_sample_ggx_vndf(wo: vec3<f32>, alpha: f32, u1: f32, u2: f32) -> vec3<f32> {
  var vh: vec3<f32> = vec3<f32>(alpha * wo.x, alpha * wo.y, wo.z);
  let vlen: f32 = length(vh);
  if (vlen > 0.0) { vh = vh / vlen; } else { vh = vec3<f32>(0.0, 0.0, 1.0); }
  let lensq: f32 = vh.x * vh.x + vh.y * vh.y;
  var t1: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);
  if (lensq > 0.0) { t1 = vec3<f32>(-vh.y, vh.x, 0.0) * inverseSqrt(lensq); }
  let t2: vec3<f32> = cross(vh, t1);
  let r: f32 = sqrt(u1);
  let phi: f32 = 2.0 * PT_PI * u2;
  let p1: f32 = r * cos(phi);
  var p2: f32 = r * sin(phi);
  let s: f32 = 0.5 * (1.0 + vh.z);
  p2 = (1.0 - s) * sqrt(max(0.0, 1.0 - p1 * p1)) + s * p2;
  let nz: f32 = sqrt(max(0.0, 1.0 - p1 * p1 - p2 * p2));
  let nh: vec3<f32> = p1 * t1 + p2 * t2 + nz * vh;
  return normalize(vec3<f32>(alpha * nh.x, alpha * nh.y, max(1e-9, nh.z)));
}

// TS: buildStudioPathtraceOnb (Duff et al.)
fn pt_onb_tangent(n: vec3<f32>) -> vec3<f32> {
  var sgn: f32 = 1.0;
  if (n.z < 0.0) { sgn = -1.0; }
  let a: f32 = -1.0 / (sgn + n.z);
  return vec3<f32>(1.0 + sgn * n.x * n.x * a, sgn * n.x * n.y * a, -sgn * n.x);
}

fn pt_onb_bitangent(n: vec3<f32>) -> vec3<f32> {
  var sgn: f32 = 1.0;
  if (n.z < 0.0) { sgn = -1.0; }
  let a: f32 = -1.0 / (sgn + n.z);
  return vec3<f32>(n.x * n.y * a, sgn + n.y * n.y * a, -n.y);
}

// TS: studioPathtraceAlphaFromRoughness
fn pt_alpha(roughness: f32) -> f32 {
  let r: f32 = clamp(roughness, 0.0, 1.0);
  return max(PT_MIN_ALPHA, r * r);
}

// TS: studioPathtraceDistributionGgx
fn pt_d_ggx(cos_h: f32, alpha: f32) -> f32 {
  if (cos_h <= 0.0) { return 0.0; }
  let a2: f32 = alpha * alpha;
  let d: f32 = cos_h * cos_h * (a2 - 1.0) + 1.0;
  return a2 / (PT_PI * d * d);
}

// TS: studioPathtraceSmithG2 (height-correlated)
fn pt_g2(cos_o: f32, cos_i: f32, alpha: f32) -> f32 {
  if (cos_o <= 0.0 || cos_i <= 0.0) { return 0.0; }
  let a2: f32 = alpha * alpha;
  let lo: f32 = cos_i * sqrt(a2 + (1.0 - a2) * cos_o * cos_o);
  let li: f32 = cos_o * sqrt(a2 + (1.0 - a2) * cos_i * cos_i);
  let denom: f32 = lo + li;
  if (denom <= 0.0) { return 0.0; }
  return (2.0 * cos_o * cos_i) / denom;
}

// TS: studioPathtraceSmithG1
fn pt_g1(cos_o: f32, alpha: f32) -> f32 {
  if (cos_o <= 0.0) { return 0.0; }
  let a2: f32 = alpha * alpha;
  return (2.0 * cos_o) / (cos_o + sqrt(a2 + (1.0 - a2) * cos_o * cos_o));
}

struct PtMaterial {
  base: vec3<f32>,
  roughness: f32,
  emissive: vec3<f32>,
  metallic: f32,
  ior: f32,
}

fn pt_load_material(index: u32) -> PtMaterial {
  let v0: vec4<f32> = pt_materials[index * 3u];
  let v1: vec4<f32> = pt_materials[index * 3u + 1u];
  let v2: vec4<f32> = pt_materials[index * 3u + 2u];
  var m: PtMaterial;
  m.base = v0.xyz;
  m.roughness = v0.w;
  m.emissive = v1.xyz;
  m.metallic = v1.w;
  m.ior = v2.x;
  return m;
}

struct PtTerms {
  f0: vec3<f32>,
  diffuse: vec3<f32>,
  alpha: f32,
  spec_enabled: bool,
}

// TS: deriveMaterialTerms + studioPathtraceDielectricF0
fn pt_terms(m: PtMaterial) -> PtTerms {
  let metal: f32 = clamp(m.metallic, 0.0, 1.0);
  let k: f32 = (m.ior - 1.0) / (m.ior + 1.0);
  let dielectric: f32 = k * k;
  var t: PtTerms;
  t.f0 = vec3<f32>(dielectric) * (1.0 - metal) + m.base * metal;
  t.diffuse = m.base * (1.0 - metal);
  t.alpha = pt_alpha(m.roughness);
  t.spec_enabled = t.f0.x > 0.0 || t.f0.y > 0.0 || t.f0.z > 0.0;
  return t;
}

fn pt_pow5(x: f32) -> f32 {
  let x2: f32 = x * x;
  return x2 * x2 * x;
}

// TS: studioPathtraceSpecularLobeProbability
fn pt_spec_prob(m: PtMaterial, cos_o: f32) -> f32 {
  let t: PtTerms = pt_terms(m);
  if (!t.spec_enabled) { return 0.0; }
  let f0lum: f32 = dot(t.f0, PT_LUMA);
  let c: f32 = clamp(cos_o, 0.0, 1.0);
  let fr: f32 = f0lum + (1.0 - f0lum) * pt_pow5(1.0 - c);
  let dw: f32 = dot(t.diffuse, PT_LUMA);
  let denom: f32 = fr + dw;
  if (denom <= 0.0) { return 0.0; }
  return fr / denom;
}

// TS: evalStudioPathtraceBsdf
fn pt_eval_bsdf(m: PtMaterial, wo: vec3<f32>, wi: vec3<f32>) -> vec3<f32> {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return vec3<f32>(0.0); }
  let t: PtTerms = pt_terms(m);
  var fres: vec3<f32> = vec3<f32>(0.0);
  var spec: vec3<f32> = vec3<f32>(0.0);
  if (t.spec_enabled) {
    let hv: vec3<f32> = wo + wi;
    let hlen: f32 = length(hv);
    if (hlen > 0.0) {
      let h: vec3<f32> = hv / hlen;
      let dot_wo_h: f32 = dot(wo, h);
      if (dot_wo_h > 0.0) {
        let schlick: f32 = pt_pow5(1.0 - min(1.0, dot_wo_h));
        fres = t.f0 + (vec3<f32>(1.0) - t.f0) * schlick;
        let d: f32 = pt_d_ggx(h.z, t.alpha);
        let g: f32 = pt_g2(wo.z, wi.z, t.alpha);
        spec = fres * (d * g / (4.0 * wo.z * wi.z));
      }
    }
  }
  return t.diffuse * (1.0 / PT_PI) * (vec3<f32>(1.0) - fres) + spec;
}

// TS: pdfStudioPathtraceBsdf
fn pt_pdf_bsdf(m: PtMaterial, wo: vec3<f32>, wi: vec3<f32>) -> f32 {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  let p_spec: f32 = pt_spec_prob(m, wo.z);
  let alpha: f32 = pt_alpha(m.roughness);
  let pdf_diffuse: f32 = wi.z / PT_PI;
  var pdf_spec: f32 = 0.0;
  if (p_spec > 0.0) {
    let hv: vec3<f32> = wo + wi;
    let hlen: f32 = length(hv);
    if (hlen > 0.0) {
      let h: vec3<f32> = hv / hlen;
      if (dot(wo, h) > 0.0) {
        pdf_spec = (pt_g1(wo.z, alpha) * pt_d_ggx(h.z, alpha)) / (4.0 * wo.z);
      }
    }
  }
  return p_spec * pdf_spec + (1.0 - p_spec) * pdf_diffuse;
}

struct PtBsdfSample {
  wi: vec3<f32>,
  f: vec3<f32>,
  pdf: f32,
  valid: bool,
}

// TS: sampleStudioPathtraceBsdf
fn pt_sample_bsdf(m: PtMaterial, wo: vec3<f32>, u_lobe: f32, u1: f32, u2: f32) -> PtBsdfSample {
  var s: PtBsdfSample;
  s.wi = vec3<f32>(0.0, 0.0, 1.0);
  s.f = vec3<f32>(0.0);
  s.pdf = 0.0;
  s.valid = false;
  if (wo.z <= 0.0) { return s; }
  let p_spec: f32 = pt_spec_prob(m, wo.z);
  let alpha: f32 = pt_alpha(m.roughness);
  var wi: vec3<f32>;
  if (u_lobe < p_spec) {
    let h: vec3<f32> = pt_sample_ggx_vndf(wo, alpha, u1, u2);
    wi = 2.0 * dot(wo, h) * h - wo;
  } else {
    wi = pt_sample_cosine(u1, u2);
  }
  if (wi.z <= 0.0) { return s; }
  let pdf: f32 = pt_pdf_bsdf(m, wo, wi);
  if (pdf <= 0.0) { return s; }
  s.wi = wi;
  s.f = pt_eval_bsdf(m, wo, wi);
  s.pdf = pdf;
  s.valid = true;
  return s;
}

struct PtRay {
  o: vec3<f32>,
  d: vec3<f32>,
  inv: vec3<f32>,
  kx: u32,
  ky: u32,
  kz: u32,
  s: vec3<f32>,
}

fn pt_axis(v: vec3<f32>, a: u32) -> f32 {
  if (a == 0u) { return v.x; }
  if (a == 1u) { return v.y; }
  return v.z;
}

// TS: setStudioPathtraceRay
fn pt_make_ray(o: vec3<f32>, d: vec3<f32>) -> PtRay {
  var r: PtRay;
  r.o = o;
  r.d = d;
  // TS: saturateInverse — ±Inf 를 포화시켜 0 * Inf = NaN 으로 히트가 사라지는 것을 막는다.
  r.inv = clamp(vec3<f32>(1.0 / d.x, 1.0 / d.y, 1.0 / d.z), vec3<f32>(-PT_INV_LIMIT), vec3<f32>(PT_INV_LIMIT));
  let a: vec3<f32> = abs(d);
  var kz: u32 = 0u;
  if (a.y > a.x) { kz = 1u; }
  if (a.z > pt_axis(a, kz)) { kz = 2u; }
  var kx: u32 = kz + 1u;
  if (kx == 3u) { kx = 0u; }
  var ky: u32 = kx + 1u;
  if (ky == 3u) { ky = 0u; }
  let dkz: f32 = pt_axis(d, kz);
  if (dkz < 0.0) {
    let tmp: u32 = kx;
    kx = ky;
    ky = tmp;
  }
  r.kx = kx;
  r.ky = ky;
  r.kz = kz;
  r.s = vec3<f32>(pt_axis(d, kx) / dkz, pt_axis(d, ky) / dkz, 1.0 / dkz);
  return r;
}

// TS: intersectStudioPathtraceAabb
fn pt_hit_aabb(r: PtRay, lo: vec3<f32>, hi: vec3<f32>, t_min: f32, t_max: f32) -> f32 {
  let t1: vec3<f32> = (lo - r.o) * r.inv;
  let t2: vec3<f32> = (hi - r.o) * r.inv;
  let near: vec3<f32> = min(t1, t2);
  let far: vec3<f32> = max(t1, t2);
  let entry: f32 = max(max(near.x, max(near.y, near.z)), t_min);
  let exit: f32 = min(min(far.x, min(far.y, far.z)) * PT_TFAR_SCALE, t_max);
  if (entry <= exit) { return entry; }
  return -1.0;
}

struct PtTriHit {
  t: f32,
  u: f32,
  v: f32,
}

// TS: intersectStudioPathtraceTriangle (Woop watertight)
fn pt_hit_triangle(r: PtRay, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, t_min: f32, t_max: f32) -> PtTriHit {
  var out: PtTriHit;
  out.t = -1.0;
  out.u = 0.0;
  out.v = 0.0;
  let pa: vec3<f32> = a - r.o;
  let pb: vec3<f32> = b - r.o;
  let pc: vec3<f32> = c - r.o;
  let akz: f32 = pt_axis(pa, r.kz);
  let bkz: f32 = pt_axis(pb, r.kz);
  let ckz: f32 = pt_axis(pc, r.kz);
  let ax: f32 = pt_axis(pa, r.kx) - r.s.x * akz;
  let ay: f32 = pt_axis(pa, r.ky) - r.s.y * akz;
  let bx: f32 = pt_axis(pb, r.kx) - r.s.x * bkz;
  let by: f32 = pt_axis(pb, r.ky) - r.s.y * bkz;
  let cx: f32 = pt_axis(pc, r.kx) - r.s.x * ckz;
  let cy: f32 = pt_axis(pc, r.ky) - r.s.y * ckz;
  let eu: f32 = cx * by - cy * bx;
  let ev: f32 = ax * cy - ay * cx;
  let ew: f32 = bx * ay - by * ax;
  if ((eu < 0.0 || ev < 0.0 || ew < 0.0) && (eu > 0.0 || ev > 0.0 || ew > 0.0)) { return out; }
  let det: f32 = eu + ev + ew;
  if (det == 0.0) { return out; }
  let t_scaled: f32 = eu * (r.s.z * akz) + ev * (r.s.z * bkz) + ew * (r.s.z * ckz);
  var det_sign: f32 = 1.0;
  if (det < 0.0) { det_sign = -1.0; }
  let abs_det: f32 = det * det_sign;
  let t_signed: f32 = t_scaled * det_sign;
  if (t_signed <= t_min * abs_det || t_signed >= t_max * abs_det) { return out; }
  let inv_det: f32 = 1.0 / det;
  out.t = t_scaled * inv_det;
  out.u = ev * inv_det;
  out.v = ew * inv_det;
  return out;
}

fn pt_vertex(index: u32) -> vec3<f32> {
  return vec3<f32>(pt_positions[index * 3u], pt_positions[index * 3u + 1u], pt_positions[index * 3u + 2u]);
}

fn pt_node_lo(node: u32) -> vec3<f32> {
  return vec3<f32>(pt_node_bounds[node * 6u], pt_node_bounds[node * 6u + 1u], pt_node_bounds[node * 6u + 2u]);
}

fn pt_node_hi(node: u32) -> vec3<f32> {
  return vec3<f32>(pt_node_bounds[node * 6u + 3u], pt_node_bounds[node * 6u + 4u], pt_node_bounds[node * 6u + 5u]);
}

struct PtSceneHit {
  t: f32,
  tri: u32,
  u: f32,
  v: f32,
  hit: bool,
}

// TS: intersectStudioPathtraceBvh (front-to-back 정렬 순회)
fn pt_trace_closest(r: PtRay, t_min: f32, t_max: f32) -> PtSceneHit {
  var res: PtSceneHit;
  res.t = -1.0;
  res.tri = 0u;
  res.u = 0.0;
  res.v = 0.0;
  res.hit = false;
  var stack_node: array<u32, ${stack}>;
  var stack_t: array<f32, ${stack}>;
  var sp: u32 = 0u;
  var best: f32 = t_max;
  let root_t: f32 = pt_hit_aabb(r, pt_node_lo(0u), pt_node_hi(0u), t_min, best);
  if (root_t < 0.0) { return res; }
  stack_node[0] = 0u;
  stack_t[0] = root_t;
  sp = 1u;
  while (sp > 0u) {
    sp = sp - 1u;
    let node: u32 = stack_node[sp];
    if (stack_t[sp] >= best) { continue; }
    let count: u32 = pt_node_meta[node * 2u + 1u];
    if (count > 0u) {
      let first: u32 = pt_node_meta[node * 2u];
      for (var i: u32 = 0u; i < count; i = i + 1u) {
        let tri: u32 = pt_tri_index[first + i];
        let h: PtTriHit = pt_hit_triangle(
          r,
          pt_vertex(pt_indices[tri * 3u]),
          pt_vertex(pt_indices[tri * 3u + 1u]),
          pt_vertex(pt_indices[tri * 3u + 2u]),
          t_min,
          best
        );
        if (h.t >= 0.0) {
          best = h.t;
          res.t = h.t;
          res.tri = tri;
          res.u = h.u;
          res.v = h.v;
          res.hit = true;
        }
      }
      continue;
    }
    let left: u32 = pt_node_meta[node * 2u];
    let right: u32 = left + 1u;
    let tl: f32 = pt_hit_aabb(r, pt_node_lo(left), pt_node_hi(left), t_min, best);
    let tr: f32 = pt_hit_aabb(r, pt_node_lo(right), pt_node_hi(right), t_min, best);
    if (tl >= 0.0 && tr >= 0.0) {
      var near_node: u32 = left;
      var near_t: f32 = tl;
      var far_node: u32 = right;
      var far_t: f32 = tr;
      if (tr < tl) {
        near_node = right;
        near_t = tr;
        far_node = left;
        far_t = tl;
      }
      stack_node[sp] = far_node;
      stack_t[sp] = far_t;
      sp = sp + 1u;
      stack_node[sp] = near_node;
      stack_t[sp] = near_t;
      sp = sp + 1u;
    } else if (tl >= 0.0) {
      stack_node[sp] = left;
      stack_t[sp] = tl;
      sp = sp + 1u;
    } else if (tr >= 0.0) {
      stack_node[sp] = right;
      stack_t[sp] = tr;
      sp = sp + 1u;
    }
  }
  return res;
}

// TS: occludedStudioPathtraceBvh
fn pt_trace_occluded(r: PtRay, t_min: f32, t_max: f32) -> bool {
  var stack_node: array<u32, ${stack}>;
  var sp: u32 = 0u;
  if (pt_hit_aabb(r, pt_node_lo(0u), pt_node_hi(0u), t_min, t_max) < 0.0) { return false; }
  stack_node[0] = 0u;
  sp = 1u;
  while (sp > 0u) {
    sp = sp - 1u;
    let node: u32 = stack_node[sp];
    let count: u32 = pt_node_meta[node * 2u + 1u];
    if (count > 0u) {
      let first: u32 = pt_node_meta[node * 2u];
      for (var i: u32 = 0u; i < count; i = i + 1u) {
        let tri: u32 = pt_tri_index[first + i];
        let h: PtTriHit = pt_hit_triangle(
          r,
          pt_vertex(pt_indices[tri * 3u]),
          pt_vertex(pt_indices[tri * 3u + 1u]),
          pt_vertex(pt_indices[tri * 3u + 2u]),
          t_min,
          t_max
        );
        if (h.t >= 0.0) { return true; }
      }
      continue;
    }
    let left: u32 = pt_node_meta[node * 2u];
    let right: u32 = left + 1u;
    if (pt_hit_aabb(r, pt_node_lo(left), pt_node_hi(left), t_min, t_max) >= 0.0) {
      stack_node[sp] = left;
      sp = sp + 1u;
    }
    if (pt_hit_aabb(r, pt_node_lo(right), pt_node_hi(right), t_min, t_max) >= 0.0) {
      stack_node[sp] = right;
      sp = sp + 1u;
    }
  }
  return false;
}

// TS: intersectStudioPathtraceParallelogram
fn pt_hit_parallelogram(r: PtRay, origin: vec3<f32>, eu: vec3<f32>, ev: vec3<f32>, t_min: f32, t_max: f32) -> f32 {
  let p: vec3<f32> = cross(r.d, ev);
  let det: f32 = dot(eu, p);
  if (det == 0.0) { return -1.0; }
  let inv_det: f32 = 1.0 / det;
  let tv: vec3<f32> = r.o - origin;
  let s: f32 = dot(tv, p) * inv_det;
  if (s < 0.0 || s > 1.0) { return -1.0; }
  let q: vec3<f32> = cross(tv, eu);
  let tt: f32 = dot(r.d, q) * inv_det;
  if (tt < 0.0 || tt > 1.0) { return -1.0; }
  let hit: f32 = dot(ev, q) * inv_det;
  if (hit <= t_min || hit >= t_max) { return -1.0; }
  return hit;
}

// TS: evalStudioPathtraceEnvironment
fn pt_env(d: vec3<f32>) -> vec3<f32> {
  if (pt_u.envKind == PT_ENV_GRADIENT) {
    let t: f32 = clamp(0.5 * (d.y + 1.0), 0.0, 1.0);
    return pt_u.envB.xyz * (1.0 - t) + pt_u.envA.xyz * t;
  }
  return pt_u.envA.xyz;
}

// TS: studioPathtracePowerHeuristic
fn pt_power_heuristic(a: f32, b: f32) -> f32 {
  let a2: f32 = a * a;
  let b2: f32 = b * b;
  let denom: f32 = a2 + b2;
  if (denom <= 0.0) { return 0.0; }
  return a2 / denom;
}

// TS: generateStudioPathtraceCameraRay + studioPathtraceStratifiedPixelSample
fn pt_camera_ray(pixel: u32, samp: u32) -> PtRay {
  let strata: u32 = pt_strata(pt_u.samplesPerPixel);
  let cells: u32 = strata * strata;
  let cell: u32 = samp % cells;
  let cx: f32 = f32(cell % strata);
  let cy: f32 = f32(cell / strata);
  let jx: f32 = pt_rand01(pixel, samp, 0u, PT_DIM_JITTER_X, pt_u.seed);
  let jy: f32 = pt_rand01(pixel, samp, 0u, PT_DIM_JITTER_Y, pt_u.seed);
  let ju: f32 = (cx + jx) / f32(strata);
  let jv: f32 = (cy + jy) / f32(strata);
  let px: f32 = f32(pixel % pt_u.width);
  let py: f32 = f32(pixel / pt_u.width);
  let sx: f32 = ((2.0 * (px + ju)) / f32(pt_u.width) - 1.0) * pt_u.tanHalfFovY * pt_u.aspect;
  let sy: f32 = (1.0 - (2.0 * (py + jv)) / f32(pt_u.height)) * pt_u.tanHalfFovY;
  let dir: vec3<f32> = normalize(pt_u.camForward + pt_u.camRight * sx + pt_u.camUp * sy);
  return pt_make_ray(pt_u.camPos, dir);
}

// TS: traceStudioPathtraceRadiance
fn pt_trace_radiance(pixel: u32, samp: u32) -> vec3<f32> {
  var ray: PtRay = pt_camera_ray(pixel, samp);
  var throughput: vec3<f32> = vec3<f32>(1.0);
  var radiance: vec3<f32> = vec3<f32>(0.0);
  var prev_pdf: f32 = 0.0;
  var camera_segment: bool = true;
  let use_nee: bool = pt_u.mode == PT_MODE_NEE_MIS && pt_u.lightCount > 0u;

  for (var bounce: u32 = 0u; bounce <= pt_u.maxBounces; bounce = bounce + 1u) {
    let sh: PtSceneHit = pt_trace_closest(ray, PT_EPS, 1e30);
    var t_geo: f32 = 1e30;
    if (sh.hit) { t_geo = sh.t; }

    // 면적 광원 해석적 교차(BVH 밖).
    var light_index: u32 = 0u;
    var light_t: f32 = 1e30;
    var found_light: bool = false;
    for (var li: u32 = 0u; li < pt_u.lightCount; li = li + 1u) {
      let v0: vec4<f32> = pt_lights[li * 4u];
      if (v0.w != PT_LIGHT_AREA) { continue; }
      let lt: f32 = pt_hit_parallelogram(ray, v0.xyz, pt_lights[li * 4u + 1u].xyz, pt_lights[li * 4u + 2u].xyz, PT_EPS, t_geo);
      if (lt >= 0.0 && lt < light_t) {
        light_t = lt;
        light_index = li;
        found_light = true;
      }
    }

    if (found_light) {
      let v0: vec4<f32> = pt_lights[light_index * 4u];
      let v1: vec4<f32> = pt_lights[light_index * 4u + 1u];
      let v2: vec4<f32> = pt_lights[light_index * 4u + 2u];
      let v3: vec4<f32> = pt_lights[light_index * 4u + 3u];
      let ln: vec3<f32> = normalize(cross(v1.xyz, v2.xyz));
      let cos_raw: f32 = -dot(ray.d, ln);
      var facing: f32 = cos_raw;
      if (v2.w > 0.5) { facing = abs(cos_raw); }
      if (facing > 0.0 && v3.w > 0.0) {
        var weight: f32 = 1.0;
        if (use_nee && !camera_segment) {
          let pdf_light: f32 = (light_t * light_t) / (facing * v3.w * f32(pt_u.lightCount));
          weight = pt_power_heuristic(prev_pdf, pdf_light);
        }
        var contrib: vec3<f32> = throughput * v3.xyz * weight;
        if (pt_u.clampIndirect > 0.0 && !camera_segment) {
          let m: f32 = max(contrib.x, max(contrib.y, contrib.z));
          if (m > pt_u.clampIndirect) { contrib = contrib * (pt_u.clampIndirect / m); }
        }
        radiance = radiance + contrib;
      }
      break;
    }

    if (!sh.hit) {
      radiance = radiance + throughput * pt_env(ray.d);
      break;
    }

    let i0: u32 = pt_indices[sh.tri * 3u];
    let i1: u32 = pt_indices[sh.tri * 3u + 1u];
    let i2: u32 = pt_indices[sh.tri * 3u + 2u];
    let a: vec3<f32> = pt_vertex(i0);
    let b: vec3<f32> = pt_vertex(i1);
    let c: vec3<f32> = pt_vertex(i2);
    let p: vec3<f32> = ray.o + ray.d * sh.t;
    var ng: vec3<f32> = normalize(cross(b - a, c - a));
    if (dot(ray.d, ng) > 0.0) { ng = -ng; }
    // 셰이딩 노멀 보간은 GPU 경로에서 생략한다(노멀 버퍼 미바인딩 — 정직한 한계).
    var ns: vec3<f32> = ng;

    let m: PtMaterial = pt_load_material(pt_tri_material[sh.tri]);
    radiance = radiance + throughput * m.emissive;
    if (bounce == pt_u.maxBounces) { break; }

    let tangent: vec3<f32> = pt_onb_tangent(ns);
    let bitangent: vec3<f32> = pt_onb_bitangent(ns);
    let wo: vec3<f32> = vec3<f32>(-dot(ray.d, tangent), -dot(ray.d, bitangent), -dot(ray.d, ns));
    if (wo.z <= 0.0) { break; }
    let origin: vec3<f32> = p + ng * PT_EPS;

    if (use_nee) {
      let u_sel: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_LIGHT_SELECT, pt_u.seed);
      var li: u32 = u32(floor(u_sel * f32(pt_u.lightCount)));
      if (li >= pt_u.lightCount) { li = pt_u.lightCount - 1u; }
      let u1: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_LIGHT_U, pt_u.seed);
      let u2: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_LIGHT_V, pt_u.seed);
      let v0: vec4<f32> = pt_lights[li * 4u];
      let v1: vec4<f32> = pt_lights[li * 4u + 1u];
      let v2: vec4<f32> = pt_lights[li * 4u + 2u];
      let v3: vec4<f32> = pt_lights[li * 4u + 3u];
      let is_area: bool = v0.w == PT_LIGHT_AREA;
      var target: vec3<f32> = v0.xyz;
      var emit: vec3<f32> = v3.xyz;
      if (is_area) {
        target = v0.xyz + v1.xyz * u1 + v2.xyz * u2;
      } else if (v1.w > 0.0) {
        let zc: f32 = 1.0 - 2.0 * u1;
        let rc: f32 = sqrt(max(0.0, 1.0 - zc * zc));
        let phi: f32 = 2.0 * PT_PI * u2;
        target = v0.xyz + v1.w * vec3<f32>(rc * cos(phi), rc * sin(phi), zc);
      }
      let to_light: vec3<f32> = target - origin;
      let dist: f32 = length(to_light);
      if (dist > 0.0) {
        let wl: vec3<f32> = to_light / dist;
        let cos_surf: f32 = dot(wl, ns);
        if (cos_surf > 0.0) {
          var geom: f32 = 0.0;
          var pdf_light: f32 = 0.0;
          if (is_area) {
            let ln: vec3<f32> = normalize(cross(v1.xyz, v2.xyz));
            let cos_raw: f32 = -dot(wl, ln);
            var cos_light: f32 = cos_raw;
            if (v2.w > 0.5) { cos_light = abs(cos_raw); }
            if (cos_light > 0.0 && v3.w > 0.0) {
              pdf_light = (dist * dist) / (cos_light * v3.w * f32(pt_u.lightCount));
              geom = 1.0 / pdf_light;
            }
          } else {
            // 균등 광원 선택(1/lightCount)의 역수 — CPU 인테그레이터와 같은 보정.
            geom = f32(pt_u.lightCount) / (dist * dist);
          }
          if (geom > 0.0) {
            let shadow: PtRay = pt_make_ray(origin, wl);
            if (!pt_trace_occluded(shadow, PT_EPS, dist - PT_EPS)) {
              let wi: vec3<f32> = vec3<f32>(dot(wl, tangent), dot(wl, bitangent), cos_surf);
              let f: vec3<f32> = pt_eval_bsdf(m, wo, wi);
              var weight: f32 = 1.0;
              if (is_area) {
                weight = pt_power_heuristic(pdf_light, pt_pdf_bsdf(m, wo, wi));
              }
              var contrib: vec3<f32> = throughput * f * emit * (cos_surf * geom * weight);
              if (pt_u.clampIndirect > 0.0 && bounce > 0u) {
                let mx: f32 = max(contrib.x, max(contrib.y, contrib.z));
                if (mx > pt_u.clampIndirect) { contrib = contrib * (pt_u.clampIndirect / mx); }
              }
              radiance = radiance + contrib;
            }
          }
        }
      }
    }

    let u_lobe: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_BSDF_LOBE, pt_u.seed);
    let bu: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_BSDF_U, pt_u.seed);
    let bv: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_BSDF_V, pt_u.seed);
    let bs: PtBsdfSample = pt_sample_bsdf(m, wo, u_lobe, bu, bv);
    if (!bs.valid) { break; }
    throughput = throughput * bs.f * (bs.wi.z / bs.pdf);
    if (throughput.x <= 0.0 && throughput.y <= 0.0 && throughput.z <= 0.0) { break; }
    let world_dir: vec3<f32> = tangent * bs.wi.x + bitangent * bs.wi.y + ns * bs.wi.z;
    ray = pt_make_ray(origin, world_dir);
    prev_pdf = bs.pdf;
    camera_segment = false;

    if (pt_u.rrEnabled == 1u && bounce >= pt_u.rrStartBounce) {
      let q: f32 = clamp(max(throughput.x, max(throughput.y, throughput.z)), PT_RR_MIN, PT_RR_MAX);
      let u_rr: f32 = pt_rand01(pixel, samp, bounce, PT_DIM_RR, pt_u.seed);
      if (u_rr >= q) { break; }
      throughput = throughput / q;
    }
  }
  return radiance;
}

@compute @workgroup_size(${STUDIO_PATHTRACE_WORKGROUP_SIZE})
fn ${STUDIO_PATHTRACE_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index: u32 = gid.y * PT_ROW_THREADS + gid.x;
  let total: u32 = pt_u.width * pt_u.height;
  if (index >= total) { return; }
  let value: vec3<f32> = pt_trace_radiance(index, pt_u.sampleIndex);
  let base: u32 = index * 4u;
  pt_accum[base] = pt_accum[base] + value.x;
  pt_accum[base + 1u] = pt_accum[base + 1u] + value.y;
  pt_accum[base + 2u] = pt_accum[base + 2u] + value.z;
  pt_accum[base + 3u] = pt_accum[base + 3u] + 1.0;
}
`;
}

/** 메가커널 WGSL 소스(모듈 로드 시 1회 생성). */
export const STUDIO_PATHTRACE_WGSL: string = buildStudioPathtraceWgsl();

export interface StudioPathtraceShaderSource {
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: string;
}

export const STUDIO_PATHTRACE_SHADER: StudioPathtraceShaderSource = {
  shaderId: "studio-pathtrace-megakernel-v1",
  wgsl: STUDIO_PATHTRACE_WGSL,
  entryPoint: STUDIO_PATHTRACE_ENTRY_POINT,
};
