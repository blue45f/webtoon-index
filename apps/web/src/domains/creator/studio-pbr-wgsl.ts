/**
 * Studio PBR — WGSL 컴퓨트 커널 + uniform 패커
 *
 * studio-gpu-filter-kernels.ts 의 저작 규율을 그대로 따른다: WGSL 소스를 `/* wgsl *\/`
 * 템플릿 리터럴로 두고, workgroup 크기·바인딩 인덱스·uniform 오프셋을 TS 상수로 뽑아
 * 같은 모듈에 묶은 뒤, 구조 테스트가 WGSL 텍스트와 TS 상수의 일치를 대조한다.
 *
 * 【전부 컴퓨트, 전부 storage buffer】 텍스처 대신 storage buffer 를 쓰는 이유는
 * (a) 256B row-padding 정렬 문제가 없고 (b) 읽기/쓰기 레이아웃이 TS 참조 구현과 1:1로
 * 맞아떨어져 CPU 대조가 단순해지기 때문이다. 필터 런타임이 같은 선택을 했다.
 *
 * 【정직한 한계 — 반드시 읽을 것】
 *  1. **이 WGSL 은 node 테스트에서 컴파일되지 않는다.** 환경에 WebGPU 가 없다. 여기서
 *     검증되는 것은 "WGSL 텍스트와 TS 상수의 구조적 일치"까지이고, 실제 컴파일·수치
 *     일치는 브라우저 프로브에서만 확인할 수 있다.
 *  2. GPU/CPU **비트 동일을 주장하지 않는다.** 필터 LUT 경로는 정수 조회라 비트 동일이
 *     가능했지만, PBR 은 f32 초월함수(pow/sqrt/sin/cos) 범벅이라 불가능하다. 허용오차
 *     파리티만 성립한다.
 *  3. SH9 확산 투영 커널은 **일부러 없다.** 512×256 파노라마 투영이 CPU 로 약 9 ms 라
 *     GPU 리덕션(atomics/parallel reduce)의 복잡도를 정당화하지 못한다.
 *  4. 섀도우 깊이 **래스터** 패스도 없다. 이 서브시스템은 이미 존재하는 렌더러가 만든
 *     깊이 맵을 소비하는 쪽이고, 자체 래스터라이저를 세우지 않는다.
 */

// ---------------------------------------------------------------------------
// 디스패치·바인딩 상수 — WGSL 리터럴과 반드시 일치(구조 테스트가 대조)
// ---------------------------------------------------------------------------

/** 2D 커널의 `@workgroup_size(N, N)` 리터럴. */
export const STUDIO_PBR_WORKGROUP_SIZE_2D = 8;

/** 모든 커널이 공유하는 bind group 0 바인딩 인덱스(WGSL `@binding(n)` 과 일치). */
export const STUDIO_PBR_BINDINGS = {
  params: 0,
  source: 1,
  target: 2,
  aux: 3,
} as const;

export type StudioPbrKernelId =
  | "brdfLut"
  | "prefilterSpecular"
  | "ssao"
  | "ssaoBlur"
  | "bloomThreshold"
  | "bloomDownsample"
  | "bloomUpsample"
  | "deferredShade";

// --- uniform 레이아웃 ------------------------------------------------------

/** brdfLut: size(u32) · sampleCount(u32) · 패딩 8B. */
export const STUDIO_PBR_BRDF_LUT_UNIFORM_BYTES = 16;
export const STUDIO_PBR_BRDF_LUT_OFFSETS = { size: 0, sampleCount: 4 } as const;

/** prefilterSpecular: 소스/타깃 해상도 + roughness + 샘플 수. */
export const STUDIO_PBR_PREFILTER_UNIFORM_BYTES = 32;
export const STUDIO_PBR_PREFILTER_OFFSETS = {
  srcWidth: 0,
  srcHeight: 4,
  dstWidth: 8,
  dstHeight: 12,
  roughness: 16,
  sampleCount: 20,
} as const;

/** ssao: 해상도·샘플수·회전타일 + radius/bias/intensity/focal. */
export const STUDIO_PBR_SSAO_UNIFORM_BYTES = 48;
export const STUDIO_PBR_SSAO_OFFSETS = {
  width: 0,
  height: 4,
  sampleCount: 8,
  rotationSize: 12,
  radius: 16,
  bias: 20,
  intensity: 24,
  focalX: 28,
  focalY: 32,
} as const;

/** ssaoBlur: 해상도 + 반경 + 축(0=가로, 1=세로). */
export const STUDIO_PBR_SSAO_BLUR_UNIFORM_BYTES = 16;
export const STUDIO_PBR_SSAO_BLUR_OFFSETS = { width: 0, height: 4, radius: 8, axis: 12 } as const;

/** bloomThreshold: 해상도 + threshold/knee. */
export const STUDIO_PBR_BLOOM_THRESHOLD_UNIFORM_BYTES = 16;
export const STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS = { width: 0, height: 4, threshold: 8, knee: 12 } as const;

/** bloomDownsample / bloomUpsample 공용: 소스·타깃 해상도. */
export const STUDIO_PBR_BLOOM_RESAMPLE_UNIFORM_BYTES = 16;
export const STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS = {
  srcWidth: 0,
  srcHeight: 4,
  dstWidth: 8,
  dstHeight: 12,
} as const;

/** deferredShade: 해상도 + 라이트 방향/색 + 노출. */
export const STUDIO_PBR_DEFERRED_SHADE_UNIFORM_BYTES = 48;
export const STUDIO_PBR_DEFERRED_SHADE_OFFSETS = {
  width: 0,
  height: 4,
  lightDirection: 16,
  lightColor: 32,
} as const;

// ---------------------------------------------------------------------------
// 공용 WGSL — BRDF 수학(studio-pbr-brdf.ts 의 f32 미러)
// ---------------------------------------------------------------------------

export const STUDIO_PBR_WGSL_BRDF = /* wgsl */ `
const STUDIO_PBR_PI : f32 = 3.14159265359;
const STUDIO_PBR_MIN_ALPHA : f32 = 1e-4;

fn studio_pbr_roughness_to_alpha(roughness : f32) -> f32 {
  let r = clamp(roughness, 0.0, 1.0);
  return max(r * r, STUDIO_PBR_MIN_ALPHA);
}

fn studio_pbr_distribution_ggx(n_dot_h : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let c = clamp(n_dot_h, 0.0, 1.0);
  let d = c * c * (a2 - 1.0) + 1.0;
  return a2 / (STUDIO_PBR_PI * d * d);
}

fn studio_pbr_schlick_k_direct(roughness : f32) -> f32 {
  let k = clamp(roughness, 0.0, 1.0) + 1.0;
  return k * k / 8.0;
}

fn studio_pbr_schlick_k_ibl(roughness : f32) -> f32 {
  let r = clamp(roughness, 0.0, 1.0);
  return r * r / 2.0;
}

fn studio_pbr_geometry_schlick(n_dot_x : f32, k : f32) -> f32 {
  let c = clamp(n_dot_x, 0.0, 1.0);
  return c / (c * (1.0 - k) + k);
}

fn studio_pbr_geometry_smith(n_dot_v : f32, n_dot_l : f32, k : f32) -> f32 {
  return studio_pbr_geometry_schlick(n_dot_v, k) * studio_pbr_geometry_schlick(n_dot_l, k);
}

fn studio_pbr_visibility_correlated(n_dot_v : f32, n_dot_l : f32, alpha : f32) -> f32 {
  let v = clamp(n_dot_v, 0.0, 1.0);
  let l = clamp(n_dot_l, 0.0, 1.0);
  let a2 = alpha * alpha;
  let lambda_v = l * sqrt(v * v * (1.0 - a2) + a2);
  let lambda_l = v * sqrt(l * l * (1.0 - a2) + a2);
  let s = lambda_v + lambda_l;
  return select(0.0, 0.5 / s, s > 0.0);
}

fn studio_pbr_fresnel_schlick(v_dot_h : f32, f0 : vec3<f32>) -> vec3<f32> {
  let m = 1.0 - clamp(v_dot_h, 0.0, 1.0);
  let m5 = m * m * m * m * m;
  return f0 + (vec3<f32>(1.0) - f0) * m5;
}

fn studio_pbr_radical_inverse(index : u32) -> f32 {
  var bits : u32 = index;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn studio_pbr_hammersley(i : u32, n : u32) -> vec2<f32> {
  return vec2<f32>(f32(i) / f32(n), studio_pbr_radical_inverse(i));
}

fn studio_pbr_importance_sample_ggx(xi : vec2<f32>, alpha : f32, n : vec3<f32>) -> vec3<f32> {
  let a2 = alpha * alpha;
  let phi = 6.28318530718 * xi.x;
  let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
  let sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
  let h_tangent = vec3<f32>(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
  let sign_z = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (sign_z + n.z);
  let b = n.x * n.y * a;
  let tangent = vec3<f32>(1.0 + sign_z * n.x * n.x * a, sign_z * b, -sign_z * n.x);
  let bitangent = vec3<f32>(b, sign_z + n.y * n.y * a, -n.y);
  return normalize(tangent * h_tangent.x + bitangent * h_tangent.y + n * h_tangent.z);
}

fn studio_pbr_equirect_direction(x : u32, y : u32, w : u32, h : u32) -> vec3<f32> {
  let theta = (f32(y) + 0.5) / f32(h) * STUDIO_PBR_PI;
  let phi = (f32(x) + 0.5) / f32(w) * 6.28318530718 - STUDIO_PBR_PI;
  let sin_theta = sin(theta);
  return vec3<f32>(sin_theta * sin(phi), cos(theta), -sin_theta * cos(phi));
}

fn studio_pbr_direction_to_equirect_uv(d : vec3<f32>) -> vec2<f32> {
  let theta = acos(clamp(d.y, -1.0, 1.0));
  let phi = atan2(d.x, -d.z);
  return vec2<f32>((phi + STUDIO_PBR_PI) / 6.28318530718, theta / STUDIO_PBR_PI);
}
`;

// ---------------------------------------------------------------------------
// 커널 소스
// ---------------------------------------------------------------------------

const WGSL_BRDF_LUT = /* wgsl */ `
struct Params {
  size : u32,
  sample_count : u32,
  pad0 : u32,
  pad1 : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.size || gid.y >= params.size) { return; }
  let n_dot_v = max((f32(gid.x) + 0.5) / f32(params.size), 1e-4);
  let roughness = (f32(gid.y) + 0.5) / f32(params.size);
  let alpha = roughness * roughness;
  let view = vec3<f32>(sqrt(max(0.0, 1.0 - n_dot_v * n_dot_v)), 0.0, n_dot_v);
  let normal = vec3<f32>(0.0, 0.0, 1.0);
  let k = studio_pbr_schlick_k_ibl(roughness);
  var scale : f32 = 0.0;
  var bias : f32 = 0.0;
  for (var i : u32 = 0u; i < params.sample_count; i = i + 1u) {
    let xi = studio_pbr_hammersley(i, params.sample_count);
    let h = studio_pbr_importance_sample_ggx(xi, alpha, normal);
    let v_dot_h = dot(view, h);
    if (v_dot_h <= 0.0) { continue; }
    let l = 2.0 * v_dot_h * h - view;
    if (l.z <= 0.0 || h.z <= 0.0) { continue; }
    let g = studio_pbr_geometry_smith(n_dot_v, l.z, k);
    let g_vis = g * v_dot_h / (h.z * n_dot_v);
    let m = 1.0 - v_dot_h;
    let fc = m * m * m * m * m;
    scale = scale + (1.0 - fc) * g_vis;
    bias = bias + fc * g_vis;
  }
  let index = (gid.y * params.size + gid.x) * 2u;
  target[index] = scale / f32(params.sample_count);
  target[index + 1u] = bias / f32(params.sample_count);
}
`;

const WGSL_PREFILTER_SPECULAR = /* wgsl */ `
struct Params {
  src_width : u32,
  src_height : u32,
  dst_width : u32,
  dst_height : u32,
  roughness : f32,
  sample_count : u32,
  pad0 : u32,
  pad1 : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

fn fetch_source(u : f32, v : f32) -> vec3<f32> {
  let w = i32(params.src_width);
  let h = i32(params.src_height);
  let fx = u * f32(w) - 0.5;
  let fy = v * f32(h) - 0.5;
  let x0 = i32(floor(fx));
  let y0 = i32(floor(fy));
  let tx = fx - f32(x0);
  let ty = fy - f32(y0);
  let x0w = ((x0 % w) + w) % w;
  let x1w = (((x0 + 1) % w) + w) % w;
  let y0c = clamp(y0, 0, h - 1);
  let y1c = clamp(y0 + 1, 0, h - 1);
  let i00 = u32((y0c * w + x0w) * 3);
  let i10 = u32((y0c * w + x1w) * 3);
  let i01 = u32((y1c * w + x0w) * 3);
  let i11 = u32((y1c * w + x1w) * 3);
  var out : vec3<f32> = vec3<f32>(0.0);
  for (var c : u32 = 0u; c < 3u; c = c + 1u) {
    let top = source[i00 + c] * (1.0 - tx) + source[i10 + c] * tx;
    let bottom = source[i01 + c] * (1.0 - tx) + source[i11 + c] * tx;
    let value = top * (1.0 - ty) + bottom * ty;
    if (c == 0u) { out.x = value; } else if (c == 1u) { out.y = value; } else { out.z = value; }
  }
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.dst_width || gid.y >= params.dst_height) { return; }
  let n = studio_pbr_equirect_direction(gid.x, gid.y, params.dst_width, params.dst_height);
  let out_index = (gid.y * params.dst_width + gid.x) * 3u;
  if (params.roughness <= 0.0) {
    let uv = studio_pbr_direction_to_equirect_uv(n);
    let c = fetch_source(uv.x, uv.y);
    target[out_index] = c.x;
    target[out_index + 1u] = c.y;
    target[out_index + 2u] = c.z;
    return;
  }
  let alpha = params.roughness * params.roughness;
  var accum : vec3<f32> = vec3<f32>(0.0);
  var weight_sum : f32 = 0.0;
  for (var i : u32 = 0u; i < params.sample_count; i = i + 1u) {
    let xi = studio_pbr_hammersley(i, params.sample_count);
    let h = studio_pbr_importance_sample_ggx(xi, alpha, n);
    let v_dot_h = dot(n, h);
    let l = 2.0 * v_dot_h * h - n;
    let n_dot_l = dot(n, l);
    if (n_dot_l <= 0.0) { continue; }
    let uv = studio_pbr_direction_to_equirect_uv(l);
    accum = accum + fetch_source(uv.x, uv.y) * n_dot_l;
    weight_sum = weight_sum + n_dot_l;
  }
  if (weight_sum > 0.0) {
    accum = accum / weight_sum;
  }
  target[out_index] = accum.x;
  target[out_index + 1u] = accum.y;
  target[out_index + 2u] = accum.z;
}
`;

const WGSL_SSAO = /* wgsl */ `
struct Params {
  width : u32,
  height : u32,
  sample_count : u32,
  rotation_size : u32,
  radius : f32,
  bias : f32,
  intensity : f32,
  focal_x : f32,
  focal_y : f32,
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

// source: [viewZ(px) ... , normal(px*3) ...] 를 이어붙인 단일 storage buffer.
// aux: [kernel(sample_count*3) ..., rotation(rotation_size²*2) ...].
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;
@group(0) @binding(3) var<storage, read> aux : array<f32>;

fn view_z(index : u32) -> f32 { return source[index]; }

fn view_normal(index : u32) -> vec3<f32> {
  let base = params.width * params.height + index * 3u;
  return vec3<f32>(source[base], source[base + 1u], source[base + 2u]);
}

fn smoothstep01(x : f32) -> f32 {
  let t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let pixel = gid.y * params.width + gid.x;
  let z = view_z(pixel);
  if (z <= 0.0) { target[pixel] = 1.0; return; }
  let ndc_x = (f32(gid.x) + 0.5) / f32(params.width) * 2.0 - 1.0;
  let ndc_y = 1.0 - (f32(gid.y) + 0.5) / f32(params.height) * 2.0;
  let p = vec3<f32>(ndc_x * z / params.focal_x, ndc_y * z / params.focal_y, -z);
  let n = normalize(view_normal(pixel));
  let r_index = ((gid.y % params.rotation_size) * params.rotation_size + (gid.x % params.rotation_size)) * 2u;
  let kernel_base = params.sample_count * 3u;
  let rot = vec3<f32>(aux[kernel_base + r_index], aux[kernel_base + r_index + 1u], 0.0);
  var t = rot - n * dot(rot, n);
  if (length(t) <= 1e-6) {
    t = normalize(vec3<f32>(n.z, 0.0, -n.x));
  } else {
    t = normalize(t);
  }
  let b = cross(n, t);
  var occlusion : f32 = 0.0;
  for (var i : u32 = 0u; i < params.sample_count; i = i + 1u) {
    let k = vec3<f32>(aux[i * 3u], aux[i * 3u + 1u], aux[i * 3u + 2u]);
    let s = p + (t * k.x + b * k.y + n * k.z) * params.radius;
    let sample_depth = -s.z;
    if (sample_depth <= 0.0) { continue; }
    let s_ndc_x = s.x * params.focal_x / sample_depth;
    let s_ndc_y = s.y * params.focal_y / sample_depth;
    let sx = i32(round((s_ndc_x + 1.0) * 0.5 * f32(params.width) - 0.5));
    let sy = i32(round((1.0 - s_ndc_y) * 0.5 * f32(params.height) - 0.5));
    if (sx < 0 || sy < 0 || sx >= i32(params.width) || sy >= i32(params.height)) { continue; }
    let scene_z = view_z(u32(sy) * params.width + u32(sx));
    if (scene_z <= 0.0) { continue; }
    if (scene_z + params.bias < sample_depth) {
      occlusion = occlusion + smoothstep01(params.radius / abs(z - scene_z));
    }
  }
  target[pixel] = clamp(1.0 - occlusion / f32(params.sample_count) * params.intensity, 0.0, 1.0);
}
`;

const WGSL_SSAO_BLUR = /* wgsl */ `
struct Params {
  width : u32,
  height : u32,
  radius : u32,
  axis : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let r = i32(params.radius);
  var sum : f32 = 0.0;
  for (var k : i32 = -r; k <= r; k = k + 1) {
    var sx = i32(gid.x);
    var sy = i32(gid.y);
    if (params.axis == 0u) {
      sx = clamp(sx + k, 0, i32(params.width) - 1);
    } else {
      sy = clamp(sy + k, 0, i32(params.height) - 1);
    }
    sum = sum + source[u32(sy) * params.width + u32(sx)];
  }
  target[gid.y * params.width + gid.x] = sum / f32(2 * r + 1);
}
`;

const WGSL_BLOOM_THRESHOLD = /* wgsl */ `
struct Params {
  width : u32,
  height : u32,
  threshold : f32,
  knee : f32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let index = (gid.y * params.width + gid.x) * 3u;
  let c = vec3<f32>(source[index], source[index + 1u], source[index + 2u]);
  let br = max(c.x, max(c.y, c.z));
  var weight : f32 = 0.0;
  if (br > 0.0) {
    let hard = br - params.threshold;
    if (params.knee <= 0.0) {
      weight = select(0.0, hard / br, hard > 0.0);
    } else {
      var soft = clamp(br - params.threshold + params.knee, 0.0, 2.0 * params.knee);
      soft = soft * soft / (4.0 * params.knee);
      let contribution = max(soft, hard);
      weight = select(0.0, contribution / br, contribution > 0.0);
    }
  }
  target[index] = c.x * weight;
  target[index + 1u] = c.y * weight;
  target[index + 2u] = c.z * weight;
}
`;

const WGSL_BLOOM_DOWNSAMPLE = /* wgsl */ `
struct Params {
  src_width : u32,
  src_height : u32,
  dst_width : u32,
  dst_height : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

fn fetch(x : i32, y : i32) -> vec3<f32> {
  let cx = clamp(x, 0, i32(params.src_width) - 1);
  let cy = clamp(y, 0, i32(params.src_height) - 1);
  let i = u32(cy * i32(params.src_width) + cx) * 3u;
  return vec3<f32>(source[i], source[i + 1u], source[i + 2u]);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.dst_width || gid.y >= params.dst_height) { return; }
  let sx = i32(gid.x) * 2;
  let sy = i32(gid.y) * 2;
  var accum : vec3<f32> = fetch(sx, sy) * 0.125;
  accum = accum + (fetch(sx - 1, sy - 1) + fetch(sx + 1, sy - 1) + fetch(sx - 1, sy + 1) + fetch(sx + 1, sy + 1)) * 0.125;
  accum = accum + (fetch(sx - 2, sy - 2) + fetch(sx + 2, sy - 2) + fetch(sx - 2, sy + 2) + fetch(sx + 2, sy + 2)) * 0.03125;
  accum = accum + (fetch(sx, sy - 2) + fetch(sx - 2, sy) + fetch(sx + 2, sy) + fetch(sx, sy + 2)) * 0.0625;
  let out_index = (gid.y * params.dst_width + gid.x) * 3u;
  target[out_index] = accum.x;
  target[out_index + 1u] = accum.y;
  target[out_index + 2u] = accum.z;
}
`;

const WGSL_BLOOM_UPSAMPLE = /* wgsl */ `
struct Params {
  src_width : u32,
  src_height : u32,
  dst_width : u32,
  dst_height : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

fn fetch(x : i32, y : i32) -> vec3<f32> {
  let cx = clamp(x, 0, i32(params.src_width) - 1);
  let cy = clamp(y, 0, i32(params.src_height) - 1);
  let i = u32(cy * i32(params.src_width) + cx) * 3u;
  return vec3<f32>(source[i], source[i + 1u], source[i + 2u]);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.dst_width || gid.y >= params.dst_height) { return; }
  let sx = i32(gid.x * params.src_width / params.dst_width);
  let sy = i32(gid.y * params.src_height / params.dst_height);
  var accum : vec3<f32> = fetch(sx, sy) * 0.25;
  accum = accum + (fetch(sx, sy - 1) + fetch(sx - 1, sy) + fetch(sx + 1, sy) + fetch(sx, sy + 1)) * 0.125;
  accum = accum + (fetch(sx - 1, sy - 1) + fetch(sx + 1, sy - 1) + fetch(sx - 1, sy + 1) + fetch(sx + 1, sy + 1)) * 0.0625;
  let out_index = (gid.y * params.dst_width + gid.x) * 3u;
  target[out_index] = accum.x;
  target[out_index + 1u] = accum.y;
  target[out_index + 2u] = accum.z;
}
`;

const WGSL_DEFERRED_SHADE = /* wgsl */ `
struct Params {
  width : u32,
  height : u32,
  pad0 : u32,
  pad1 : u32,
  light_direction : vec4<f32>,
  light_color : vec4<f32>,
};

// source G-buffer(픽셀당 12 f32): baseColor.rgb, normal.xyz, view.xyz, metallic, roughness, occlusion.
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> source : array<f32>;
@group(0) @binding(2) var<storage, read_write> target : array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let pixel = gid.y * params.width + gid.x;
  let g = pixel * 12u;
  let base_color = vec3<f32>(source[g], source[g + 1u], source[g + 2u]);
  let n = normalize(vec3<f32>(source[g + 3u], source[g + 4u], source[g + 5u]));
  let v = normalize(vec3<f32>(source[g + 6u], source[g + 7u], source[g + 8u]));
  let metallic = clamp(source[g + 9u], 0.0, 1.0);
  let roughness = clamp(source[g + 10u], 0.0, 1.0);
  let occlusion = clamp(source[g + 11u], 0.0, 1.0);
  let l = normalize(-params.light_direction.xyz);
  let n_dot_l = clamp(dot(n, l), 0.0, 1.0);
  let n_dot_v = clamp(dot(n, v), 0.0, 1.0);
  var color : vec3<f32> = vec3<f32>(0.0);
  if (n_dot_l > 0.0 && n_dot_v > 0.0) {
    let h = normalize(v + l);
    let alpha = studio_pbr_roughness_to_alpha(roughness);
    let d = studio_pbr_distribution_ggx(clamp(dot(n, h), 0.0, 1.0), alpha);
    let vis = studio_pbr_visibility_correlated(n_dot_v, n_dot_l, alpha);
    let f0 = mix(vec3<f32>(0.04), base_color, metallic);
    let f = studio_pbr_fresnel_schlick(clamp(dot(v, h), 0.0, 1.0), f0);
    let spec = d * vis * f;
    let k_d = (vec3<f32>(1.0) - f) * (1.0 - metallic);
    let diffuse = k_d * base_color / STUDIO_PBR_PI;
    color = (diffuse + spec) * params.light_color.rgb * n_dot_l;
  }
  color = color * occlusion;
  let out_index = pixel * 3u;
  target[out_index] = color.x;
  target[out_index + 1u] = color.y;
  target[out_index + 2u] = color.z;
}
`;

export interface StudioPbrKernelSource {
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: string;
  readonly uniformByteLength: number;
  /** 이 커널이 실제로 선언한 바인딩 이름들. */
  readonly bindings: readonly (keyof typeof STUDIO_PBR_BINDINGS)[];
}

/** 커널 카탈로그 — 공용 BRDF 텍스트가 필요한 커널은 앞에 이어붙인다. */
export const STUDIO_PBR_KERNELS: Record<StudioPbrKernelId, StudioPbrKernelSource> = {
  brdfLut: {
    shaderId: "studio-pbr-brdf-lut",
    wgsl: `${STUDIO_PBR_WGSL_BRDF}\n${WGSL_BRDF_LUT}`,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_BRDF_LUT_UNIFORM_BYTES,
    bindings: ["params", "target"],
  },
  prefilterSpecular: {
    shaderId: "studio-pbr-prefilter-specular",
    wgsl: `${STUDIO_PBR_WGSL_BRDF}\n${WGSL_PREFILTER_SPECULAR}`,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_PREFILTER_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
  ssao: {
    shaderId: "studio-pbr-ssao",
    wgsl: WGSL_SSAO,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_SSAO_UNIFORM_BYTES,
    bindings: ["params", "source", "target", "aux"],
  },
  ssaoBlur: {
    shaderId: "studio-pbr-ssao-blur",
    wgsl: WGSL_SSAO_BLUR,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_SSAO_BLUR_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
  bloomThreshold: {
    shaderId: "studio-pbr-bloom-threshold",
    wgsl: WGSL_BLOOM_THRESHOLD,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_BLOOM_THRESHOLD_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
  bloomDownsample: {
    shaderId: "studio-pbr-bloom-downsample",
    wgsl: WGSL_BLOOM_DOWNSAMPLE,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_BLOOM_RESAMPLE_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
  bloomUpsample: {
    shaderId: "studio-pbr-bloom-upsample",
    wgsl: WGSL_BLOOM_UPSAMPLE,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_BLOOM_RESAMPLE_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
  deferredShade: {
    shaderId: "studio-pbr-deferred-shade",
    wgsl: `${STUDIO_PBR_WGSL_BRDF}\n${WGSL_DEFERRED_SHADE}`,
    entryPoint: "main",
    uniformByteLength: STUDIO_PBR_DEFERRED_SHADE_UNIFORM_BYTES,
    bindings: ["params", "source", "target"],
  },
};

// ---------------------------------------------------------------------------
// uniform 패커 — 오프셋 상수와 1:1
// ---------------------------------------------------------------------------

function buffer(byteLength: number): { readonly data: ArrayBuffer; readonly view: DataView } {
  const data = new ArrayBuffer(byteLength);
  return { data, view: new DataView(data) };
}

export function packStudioPbrBrdfLutParams(size: number, sampleCount: number): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_BRDF_LUT_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_BRDF_LUT_OFFSETS.size, size, true);
  view.setUint32(STUDIO_PBR_BRDF_LUT_OFFSETS.sampleCount, sampleCount, true);
  return data;
}

export interface StudioPbrPrefilterUniform {
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly dstWidth: number;
  readonly dstHeight: number;
  readonly roughness: number;
  readonly sampleCount: number;
}

export function packStudioPbrPrefilterParams(uniform: StudioPbrPrefilterUniform): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_PREFILTER_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_PREFILTER_OFFSETS.srcWidth, uniform.srcWidth, true);
  view.setUint32(STUDIO_PBR_PREFILTER_OFFSETS.srcHeight, uniform.srcHeight, true);
  view.setUint32(STUDIO_PBR_PREFILTER_OFFSETS.dstWidth, uniform.dstWidth, true);
  view.setUint32(STUDIO_PBR_PREFILTER_OFFSETS.dstHeight, uniform.dstHeight, true);
  view.setFloat32(STUDIO_PBR_PREFILTER_OFFSETS.roughness, uniform.roughness, true);
  view.setUint32(STUDIO_PBR_PREFILTER_OFFSETS.sampleCount, uniform.sampleCount, true);
  return data;
}

export interface StudioPbrSsaoUniform {
  readonly width: number;
  readonly height: number;
  readonly sampleCount: number;
  readonly rotationSize: number;
  readonly radius: number;
  readonly bias: number;
  readonly intensity: number;
  readonly focalX: number;
  readonly focalY: number;
}

export function packStudioPbrSsaoParams(uniform: StudioPbrSsaoUniform): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_SSAO_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_SSAO_OFFSETS.width, uniform.width, true);
  view.setUint32(STUDIO_PBR_SSAO_OFFSETS.height, uniform.height, true);
  view.setUint32(STUDIO_PBR_SSAO_OFFSETS.sampleCount, uniform.sampleCount, true);
  view.setUint32(STUDIO_PBR_SSAO_OFFSETS.rotationSize, uniform.rotationSize, true);
  view.setFloat32(STUDIO_PBR_SSAO_OFFSETS.radius, uniform.radius, true);
  view.setFloat32(STUDIO_PBR_SSAO_OFFSETS.bias, uniform.bias, true);
  view.setFloat32(STUDIO_PBR_SSAO_OFFSETS.intensity, uniform.intensity, true);
  view.setFloat32(STUDIO_PBR_SSAO_OFFSETS.focalX, uniform.focalX, true);
  view.setFloat32(STUDIO_PBR_SSAO_OFFSETS.focalY, uniform.focalY, true);
  return data;
}

export function packStudioPbrSsaoBlurParams(
  width: number,
  height: number,
  radius: number,
  axis: 0 | 1,
): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_SSAO_BLUR_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.width, width, true);
  view.setUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.height, height, true);
  view.setUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.radius, radius, true);
  view.setUint32(STUDIO_PBR_SSAO_BLUR_OFFSETS.axis, axis, true);
  return data;
}

export function packStudioPbrBloomThresholdParams(
  width: number,
  height: number,
  threshold: number,
  knee: number,
): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_BLOOM_THRESHOLD_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.width, width, true);
  view.setUint32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.height, height, true);
  view.setFloat32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.threshold, threshold, true);
  view.setFloat32(STUDIO_PBR_BLOOM_THRESHOLD_OFFSETS.knee, knee, true);
  return data;
}

export function packStudioPbrBloomResampleParams(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_BLOOM_RESAMPLE_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.srcWidth, srcWidth, true);
  view.setUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.srcHeight, srcHeight, true);
  view.setUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.dstWidth, dstWidth, true);
  view.setUint32(STUDIO_PBR_BLOOM_RESAMPLE_OFFSETS.dstHeight, dstHeight, true);
  return data;
}

export interface StudioPbrDeferredShadeUniform {
  readonly width: number;
  readonly height: number;
  readonly lightDirection: readonly [number, number, number];
  readonly lightColor: readonly [number, number, number];
}

export function packStudioPbrDeferredShadeParams(uniform: StudioPbrDeferredShadeUniform): ArrayBuffer {
  const { data, view } = buffer(STUDIO_PBR_DEFERRED_SHADE_UNIFORM_BYTES);
  view.setUint32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.width, uniform.width, true);
  view.setUint32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.height, uniform.height, true);
  for (let i = 0; i < 3; i += 1) {
    view.setFloat32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightDirection + i * 4, uniform.lightDirection[i], true);
    view.setFloat32(STUDIO_PBR_DEFERRED_SHADE_OFFSETS.lightColor + i * 4, uniform.lightColor[i], true);
  }
  return data;
}

/** 2D 디스패치 워크그룹 수 — ceil(size / WORKGROUP_SIZE_2D). */
export function studioPbrDispatch2d(width: number, height: number): readonly [number, number] {
  const n = STUDIO_PBR_WORKGROUP_SIZE_2D;
  return [Math.ceil(width / n), Math.ceil(height / n)];
}
