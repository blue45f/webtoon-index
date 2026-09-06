/**
 * Spatial WebGPU filter kernels.
 *
 * These kernels extend the byte-LUT/color kernels with neighborhood operations while keeping
 * the CPU filter contract:
 *  - Gaussian blur decodes packed RGBA into premultiplied float4 storage, runs the CPU engine's
 *    three box radii as six separable passes, then unpremultiplies/blends while preserving the
 *    original alpha byte.
 *  - Morphology performs the same clamped-edge max/min operation over all four byte channels.
 *  - Convolution applies the normalized 3x3 matrix to RGB and preserves alpha.
 *
 * The executor uses `bufferLayout` to bind packed-u32 and float4 scratch buffers correctly.
 */

import {
  normalizeStudioConvolution,
  normalizeStudioMorphology,
} from "../studio-advanced-pixel-filters";

import {
  STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS,
  STUDIO_GPU_FILTER_WORKGROUP_SIZE,
} from "./studio-gpu-filter-kernels";

import type {
  StudioConvolution,
  StudioMorphology,
} from "../studio-advanced-pixel-filters";
import type { StudioGpuFilterShaderSource } from "./studio-gpu-filter-runtime";

export type StudioGpuSpatialFilterKernelId =
  | "gaussian-decode"
  | "gaussian-box-horizontal"
  | "gaussian-box-vertical"
  | "gaussian-resolve"
  | "morphology-horizontal"
  | "morphology-vertical"
  | "convolution-3x3";

export type StudioGpuSpatialBufferLayout =
  | "gaussian-decode"
  | "gaussian-box"
  | "gaussian-resolve"
  | "packed";

export interface StudioGpuSpatialFilterKernelSpec extends StudioGpuFilterShaderSource {
  readonly id: StudioGpuSpatialFilterKernelId;
  readonly bufferLayout: StudioGpuSpatialBufferLayout;
  readonly usesLut: false;
  readonly uniformByteLength: number;
}

export const STUDIO_GPU_SPATIAL_UNIFORM_BYTES = 32;
export const STUDIO_GPU_CONVOLUTION_UNIFORM_BYTES = 64;
export const STUDIO_GPU_GAUSSIAN_FLOAT_BYTES_PER_PIXEL = 16;

const INDEX_EXPR = `gid.y * ${STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS}u + gid.x`;

const WGSL_BYTE_HELPERS = /* wgsl */ `
fn studio_unpack(texel : u32) -> vec4<u32> {
  return vec4<u32>(
    texel & 0xffu,
    (texel >> 8u) & 0xffu,
    (texel >> 16u) & 0xffu,
    (texel >> 24u) & 0xffu,
  );
}

fn studio_quantize_byte(value : f32) -> u32 {
  return u32(clamp(round(value), 0.0, 255.0));
}

fn studio_repack(value : vec4<u32>) -> u32 {
  return value.x | (value.y << 8u) | (value.z << 16u) | (value.w << 24u);
}
`;

const WGSL_GAUSSIAN_DECODE = /* wgsl */ `
struct Params {
  pixel_count : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let rgba = studio_unpack(src[i]);
  let weight = f32(rgba.w) / 255.0;
  dst[i] = vec4<f32>(
    f32(rgba.x) * weight,
    f32(rgba.y) * weight,
    f32(rgba.z) * weight,
    weight,
  );
}
`;

const WGSL_GAUSSIAN_BOX = /* wgsl */ `
struct Params {
  pixel_count : u32,
  width : u32,
  height : u32,
  radius : u32,
  direction : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var<storage, read> src : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> dst : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;

@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let x = i % params.width;
  let y = i / params.width;
  let radius = i32(params.radius);
  var sum = vec4<f32>(0.0);
  for (var offset = -radius; offset <= radius; offset += 1) {
    var sample_x = i32(x);
    var sample_y = i32(y);
    if (params.direction == 0u) {
      sample_x = clamp(sample_x + offset, 0, i32(params.width) - 1);
    } else {
      sample_y = clamp(sample_y + offset, 0, i32(params.height) - 1);
    }
    let sample_index = u32(sample_y) * params.width + u32(sample_x);
    sum += src[sample_index];
  }
  dst[i] = sum / f32(params.radius * 2u + 1u);
}
`;

const WGSL_GAUSSIAN_RESOLVE = /* wgsl */ `
struct Params {
  pixel_count : u32,
  strength : f32,
  _pad0 : u32,
  _pad1 : u32,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;
@group(0) @binding(3) var<storage, read> filtered : array<vec4<f32>>;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let original = studio_unpack(src[i]);
  let blurred = filtered[i];
  var restored = vec3<f32>(f32(original.x), f32(original.y), f32(original.z));
  if (blurred.w > 0.0001) {
    restored = blurred.xyz / blurred.w;
  }
  let original_rgb = vec3<f32>(f32(original.x), f32(original.y), f32(original.z));
  let rgb = original_rgb + (restored - original_rgb) * params.strength;
  dst[i] = studio_repack(vec4<u32>(
    studio_quantize_byte(rgb.x),
    studio_quantize_byte(rgb.y),
    studio_quantize_byte(rgb.z),
    original.w,
  ));
}
`;

const WGSL_MORPHOLOGY = /* wgsl */ `
struct Params {
  pixel_count : u32,
  width : u32,
  height : u32,
  radius : u32,
  direction : u32,
  mode : u32,
  _pad0 : u32,
  _pad1 : u32,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let x = i % params.width;
  let y = i / params.width;
  let radius = i32(params.radius);
  var result = select(vec4<u32>(0u), vec4<u32>(255u), params.mode == 1u);
  for (var offset = -radius; offset <= radius; offset += 1) {
    var sample_x = i32(x);
    var sample_y = i32(y);
    if (params.direction == 0u) {
      sample_x = clamp(sample_x + offset, 0, i32(params.width) - 1);
    } else {
      sample_y = clamp(sample_y + offset, 0, i32(params.height) - 1);
    }
    let sample_index = u32(sample_y) * params.width + u32(sample_x);
    let sample = studio_unpack(src[sample_index]);
    if (params.mode == 0u) {
      result = max(result, sample);
    } else {
      result = min(result, sample);
    }
  }
  dst[i] = studio_repack(result);
}
`;

const WGSL_CONVOLUTION = /* wgsl */ `
struct Params {
  pixel_count : u32,
  width : u32,
  height : u32,
  _pad0 : u32,
  row0 : vec4<f32>,
  row1 : vec4<f32>,
  row2 : vec4<f32>,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(${STUDIO_GPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let x = i % params.width;
  let y = i / params.width;
  var sum = vec3<f32>(0.0);
  for (var kernel_y = 0u; kernel_y < 3u; kernel_y += 1u) {
    var row = params.row0;
    if (kernel_y == 1u) {
      row = params.row1;
    } else if (kernel_y == 2u) {
      row = params.row2;
    }
    let sample_y = u32(clamp(i32(y) + i32(kernel_y) - 1, 0, i32(params.height) - 1));
    for (var kernel_x = 0u; kernel_x < 3u; kernel_x += 1u) {
      let sample_x = u32(clamp(i32(x) + i32(kernel_x) - 1, 0, i32(params.width) - 1));
      let rgba = studio_unpack(src[sample_y * params.width + sample_x]);
      sum += vec3<f32>(f32(rgba.x), f32(rgba.y), f32(rgba.z)) * row[kernel_x];
    }
  }
  let original = studio_unpack(src[i]);
  let rgb = sum / params.row0.w + vec3<f32>(params.row1.w);
  dst[i] = studio_repack(vec4<u32>(
    studio_quantize_byte(rgb.x),
    studio_quantize_byte(rgb.y),
    studio_quantize_byte(rgb.z),
    original.w,
  ));
}
`;

export const STUDIO_GPU_SPATIAL_FILTER_KERNELS: Record<
  StudioGpuSpatialFilterKernelId,
  StudioGpuSpatialFilterKernelSpec
> = {
  "gaussian-decode": {
    id: "gaussian-decode",
    shaderId: "studio-gpu-filter/gaussian-decode",
    wgsl: WGSL_GAUSSIAN_DECODE,
    entryPoint: "main",
    bufferLayout: "gaussian-decode",
    usesLut: false,
    uniformByteLength: 16,
  },
  "gaussian-box-horizontal": {
    id: "gaussian-box-horizontal",
    shaderId: "studio-gpu-filter/gaussian-box",
    wgsl: WGSL_GAUSSIAN_BOX,
    entryPoint: "main",
    bufferLayout: "gaussian-box",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_SPATIAL_UNIFORM_BYTES,
  },
  "gaussian-box-vertical": {
    id: "gaussian-box-vertical",
    shaderId: "studio-gpu-filter/gaussian-box",
    wgsl: WGSL_GAUSSIAN_BOX,
    entryPoint: "main",
    bufferLayout: "gaussian-box",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_SPATIAL_UNIFORM_BYTES,
  },
  "gaussian-resolve": {
    id: "gaussian-resolve",
    shaderId: "studio-gpu-filter/gaussian-resolve",
    wgsl: WGSL_GAUSSIAN_RESOLVE,
    entryPoint: "main",
    bufferLayout: "gaussian-resolve",
    usesLut: false,
    uniformByteLength: 16,
  },
  "morphology-horizontal": {
    id: "morphology-horizontal",
    shaderId: "studio-gpu-filter/morphology",
    wgsl: WGSL_MORPHOLOGY,
    entryPoint: "main",
    bufferLayout: "packed",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_SPATIAL_UNIFORM_BYTES,
  },
  "morphology-vertical": {
    id: "morphology-vertical",
    shaderId: "studio-gpu-filter/morphology",
    wgsl: WGSL_MORPHOLOGY,
    entryPoint: "main",
    bufferLayout: "packed",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_SPATIAL_UNIFORM_BYTES,
  },
  "convolution-3x3": {
    id: "convolution-3x3",
    shaderId: "studio-gpu-filter/convolution-3x3",
    wgsl: WGSL_CONVOLUTION,
    entryPoint: "main",
    bufferLayout: "packed",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_CONVOLUTION_UNIFORM_BYTES,
  },
};

/** W3C three-box Gaussian approximation used by `studio-blur.ts`. */
export function studioGpuGaussianBoxRadii(sigma: number): [number, number, number] {
  const boundedSigma = Math.min(40, Math.max(0, Number.isFinite(sigma) ? sigma : 0));
  if (boundedSigma === 0) return [0, 0, 0];
  const passes = 3;
  const wIdeal = Math.sqrt((12 * boundedSigma * boundedSigma) / passes + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl -= 1;
  if (wl < 1) wl = 1;
  const wu = wl + 2;
  const mIdeal = (
    12 * boundedSigma * boundedSigma
    - passes * wl * wl
    - 4 * passes * wl
    - 3 * passes
  ) / (-4 * wl - 4);
  const m = Math.max(0, Math.min(passes, Math.round(mIdeal)));
  const rl = (wl - 1) / 2;
  const ru = (wu - 1) / 2;
  return [m > 0 ? rl : ru, m > 1 ? rl : ru, m > 2 ? rl : ru];
}

export function packStudioGpuSpatialParams(input: {
  width: number;
  height: number;
  radius: number;
  direction: "horizontal" | "vertical";
  mode?: StudioMorphology["mode"];
}): ArrayBuffer {
  const uniform = new ArrayBuffer(STUDIO_GPU_SPATIAL_UNIFORM_BYTES);
  const view = new DataView(uniform);
  view.setUint32(4, Math.max(0, Math.floor(input.width)) >>> 0, true);
  view.setUint32(8, Math.max(0, Math.floor(input.height)) >>> 0, true);
  view.setUint32(12, Math.max(0, Math.floor(input.radius)) >>> 0, true);
  view.setUint32(16, input.direction === "vertical" ? 1 : 0, true);
  view.setUint32(20, input.mode === "erode" ? 1 : 0, true);
  return uniform;
}

export function packStudioGpuGaussianResolveParams(strength: number): ArrayBuffer {
  const uniform = new ArrayBuffer(16);
  const normalized = Number.isFinite(strength)
    ? Math.min(1, Math.max(0, strength / 100))
    : 0;
  new DataView(uniform).setFloat32(4, normalized, true);
  return uniform;
}

export function packStudioGpuMorphologyParams(
  width: number,
  height: number,
  value: StudioMorphology,
  direction: "horizontal" | "vertical",
): ArrayBuffer {
  const normalized = normalizeStudioMorphology(value);
  return packStudioGpuSpatialParams({
    width,
    height,
    radius: normalized.radius,
    direction,
    mode: normalized.mode,
  });
}

export function packStudioGpuConvolutionParams(
  width: number,
  height: number,
  value: StudioConvolution,
): ArrayBuffer {
  const normalized = normalizeStudioConvolution(value);
  const uniform = new ArrayBuffer(STUDIO_GPU_CONVOLUTION_UNIFORM_BYTES);
  const view = new DataView(uniform);
  view.setUint32(4, Math.max(0, Math.floor(width)) >>> 0, true);
  view.setUint32(8, Math.max(0, Math.floor(height)) >>> 0, true);
  for (let row = 0; row < 3; row += 1) {
    const offset = 16 + row * 16;
    for (let column = 0; column < 3; column += 1) {
      view.setFloat32(offset + column * 4, normalized.kernel[row * 3 + column]!, true);
    }
  }
  view.setFloat32(28, normalized.divisor, true);
  view.setFloat32(44, normalized.bias, true);
  return uniform;
}
