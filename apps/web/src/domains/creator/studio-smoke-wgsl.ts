/**
 * Studio Smoke WGSL — CPU 코어(studio-smoke-core)의 WGSL 컴퓨트 미러 포트
 *
 * ## 정규(normative) 구현은 CPU 다
 * 저장되는 베이크는 항상 CPU 경로가 만든다. GPU 는 **미리보기 가속 경로**이고,
 * CPU 와 **바이트 동일하지 않다** — WGSL f32 는 fma 축약/재결합/초월함수 정밀도가
 * 구현 정의라 삼선형 누산과 Jacobi 합이 TS(f64 중간계산 → f32 저장) 경로와 비트 일치할 수
 * 없다. 이 계약이 없으면 "GPU 로 베이크 → CPU 로 재베이크 → 픽셀 다름" 회귀가 난다.
 *
 * ## 이 슬라이스에서 검증된 것 / 안 된 것 (정직하게)
 *  - **검증됨(node 계약 테스트)**: 엔트리포인트 집합이 CPU 커널 레지스트리와 1:1,
 *    `@workgroup_size` 리터럴 ↔ TS 상수, `@binding(n)` 선언 ↔ 바인딩 표, uniform
 *    바이트 오프셋 ↔ 패커, 디스패치 행 스레드 수 리터럴.
 *  - **검증 안 됨**: 실제 수치 결과. node 에 WebGPU 가 없어 셰이더를 컴파일·실행할 수
 *    없다. CPU↔GPU 수치 패리티는 브라우저 패리티 스크립트가 붙는 후속 슬라이스의 몫이며,
 *    그 전까지 이 포트를 "동작 검증됨"이라 부르면 안 된다.
 *
 * ## 디스패치 좌표계
 * `maxComputeWorkgroupsPerDimension`(보통 65535) 때문에 1D 로 200만 스레드를 못 쏜다.
 * studio-gpu-filter-kernels 와 동일한 2D row-threads 트릭을 쓴다:
 *   dispatchWorkgroups(x = ROW_THREADS/WORKGROUP_SIZE, y = ceil(threads/ROW_THREADS))
 *   선형 인덱스 = gid.y · ROW_THREADS + gid.x
 *
 * ## 버퍼 규약
 *  - 모든 필드는 `array<f32>` storage buffer(셀/면 배열 그대로).
 *  - solid 마스크는 `array<u32>`(셀당 1개, 0/1) — WGSL 에 u8 스토리지 타입이 없다.
 *  - uniform 은 64바이트 고정 레이아웃(STUDIO_SMOKE_UNIFORM_OFFSETS).
 */

import { STUDIO_SMOKE_KERNEL_IDS } from "./studio-smoke-core";
import { packStudioSmokeBoundaryMask } from "./studio-smoke-grid";

import type { StudioSmokeKernelId, StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeGridSpec } from "./studio-smoke-grid";

// ---------------------------------------------------------------------------
// 상수 — WGSL 리터럴과 반드시 일치(구조 테스트가 대조)
// ---------------------------------------------------------------------------

/** WGSL `@workgroup_size` 리터럴. */
export const STUDIO_SMOKE_WORKGROUP_SIZE = 64;
/** WGSL `16384u` 리터럴 — 디스패치 한 행이 담당하는 스레드 수. */
export const STUDIO_SMOKE_DISPATCH_ROW_THREADS = 16384;
/** 역추적 패딩(셀) — CPU STUDIO_SMOKE_TRACE_PADDING 과 같은 값이어야 한다. */
export const STUDIO_SMOKE_WGSL_TRACE_PADDING = 1;

/** uniform 바이트 오프셋(패커와 WGSL struct 필드 순서가 동시에 이 표를 따른다). */
export const STUDIO_SMOKE_UNIFORM_OFFSETS = {
  nx: 0,
  ny: 4,
  nz: 8,
  cellCount: 12,
  dt: 16,
  h: 20,
  invH: 24,
  threadCount: 28,
  buoyancyAlpha: 32,
  buoyancyBeta: 36,
  ambientTemperature: 40,
  vorticityEpsilon: 44,
  densityDissipation: 48,
  temperatureDissipation: 52,
  boundaryOpen: 56,
  pressureInvScale: 60,
} as const;

export const STUDIO_SMOKE_UNIFORM_BYTES = 64;

/**
 * 커널별 바인딩 표 — 배열 인덱스가 곧 `@binding(n)` 이다.
 * GPU 스텝 플래너가 이 이름들을 실제 버퍼에 매핑하고, 구조 테스트가 WGSL 선언과 대조한다.
 */
export const STUDIO_SMOKE_KERNEL_BINDINGS: Record<StudioSmokeKernelId, readonly string[]> = {
  advect_velocity: ["params", "u0", "v0", "w0", "u", "v", "w"],
  advect_scalar: ["params", "solid", "u", "v", "w", "src", "dst"],
  dissipate: ["params", "solid", "density", "temperature"],
  buoyancy: ["params", "solid", "density", "temperature", "v"],
  curl: ["params", "u", "v", "w", "curlX", "curlY", "curlZ", "curlMagnitude"],
  vorticity_force: ["params", "solid", "curlMagnitude", "curlX", "curlY", "curlZ"],
  vorticity_apply: ["params", "solid", "curlX", "curlY", "curlZ", "u", "v", "w"],
  boundary: ["params", "solid", "density", "temperature", "pressure", "u", "v", "w"],
  divergence: ["params", "solid", "u", "v", "w", "divergence"],
  pressure_jacobi: ["params", "solid", "divergence", "src", "dst"],
  subtract_gradient: ["params", "solid", "pressure", "u", "v", "w"],
};

// ---------------------------------------------------------------------------
// WGSL 텍스트 조립
// ---------------------------------------------------------------------------

const WGSL_PARAMS = /* wgsl */ `
struct SmokeParams {
  nx : u32,
  ny : u32,
  nz : u32,
  cell_count : u32,
  dt : f32,
  h : f32,
  inv_h : f32,
  thread_count : u32,
  buoyancy_alpha : f32,
  buoyancy_beta : f32,
  ambient_temperature : f32,
  vorticity_epsilon : f32,
  density_dissipation : f32,
  temperature_dissipation : f32,
  boundary_open : u32,
  pressure_inv_scale : f32,
}
`;

const WGSL_INDEX_HELPERS = /* wgsl */ `
fn smoke_cell_index(i : u32, j : u32, k : u32) -> u32 { return i + P.nx * (j + P.ny * k); }
fn smoke_u_index(i : u32, j : u32, k : u32) -> u32 { return i + (P.nx + 1u) * (j + P.ny * k); }
fn smoke_v_index(i : u32, j : u32, k : u32) -> u32 { return i + P.nx * (j + (P.ny + 1u) * k); }
fn smoke_w_index(i : u32, j : u32, k : u32) -> u32 { return i + P.nx * (j + P.ny * k); }
fn smoke_u_count() -> u32 { return (P.nx + 1u) * P.ny * P.nz; }
fn smoke_v_count() -> u32 { return P.nx * (P.ny + 1u) * P.nz; }
fn smoke_w_count() -> u32 { return P.nx * P.ny * (P.nz + 1u); }
fn smoke_is_open(bit : u32) -> bool { return (P.boundary_open & (1u << bit)) != 0u; }
fn smoke_clampi(value : i32, lo : i32, hi : i32) -> i32 {
  if (value < lo) { return lo; }
  if (value > hi) { return hi; }
  return value;
}
fn smoke_trace(value : f32, limit : f32) -> f32 {
  let pad = ${STUDIO_SMOKE_WGSL_TRACE_PADDING}.0;
  return clamp(value, -pad, limit + pad);
}
fn smoke_blend8(
  c000 : f32, c100 : f32, c010 : f32, c110 : f32,
  c001 : f32, c101 : f32, c011 : f32, c111 : f32,
  tx : f32, ty : f32, tz : f32,
) -> f32 {
  let x00 = c000 + (c100 - c000) * tx;
  let x10 = c010 + (c110 - c010) * tx;
  let x01 = c001 + (c101 - c001) * tx;
  let x11 = c011 + (c111 - c011) * tx;
  let y0 = x00 + (x10 - x00) * ty;
  let y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}
`;

// 셀 중심 스칼라 페치·샘플 — 경계 open 은 0, solid 는 반사(CPU fetchScalar 와 동일 규칙).
function wgslScalarSampler(name: string): string {
  return /* wgsl */ `
fn smoke_fetch_${name}(i : i32, j : i32, k : i32) -> f32 {
  var ii = i;
  if (ii < 0) { if (smoke_is_open(0u)) { return 0.0; } ii = 0; }
  else if (ii >= i32(P.nx)) { if (smoke_is_open(1u)) { return 0.0; } ii = i32(P.nx) - 1; }
  var jj = j;
  if (jj < 0) { if (smoke_is_open(2u)) { return 0.0; } jj = 0; }
  else if (jj >= i32(P.ny)) { if (smoke_is_open(3u)) { return 0.0; } jj = i32(P.ny) - 1; }
  var kk = k;
  if (kk < 0) { if (smoke_is_open(4u)) { return 0.0; } kk = 0; }
  else if (kk >= i32(P.nz)) { if (smoke_is_open(5u)) { return 0.0; } kk = i32(P.nz) - 1; }
  return ${name}[smoke_cell_index(u32(ii), u32(jj), u32(kk))];
}
fn smoke_sample_${name}(x : f32, y : f32, z : f32) -> f32 {
  let gx = x - 0.5; let gy = y - 0.5; let gz = z - 0.5;
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy)); let k0 = i32(floor(gz));
  return smoke_blend8(
    smoke_fetch_${name}(i0, j0, k0), smoke_fetch_${name}(i0 + 1, j0, k0),
    smoke_fetch_${name}(i0, j0 + 1, k0), smoke_fetch_${name}(i0 + 1, j0 + 1, k0),
    smoke_fetch_${name}(i0, j0, k0 + 1), smoke_fetch_${name}(i0 + 1, j0, k0 + 1),
    smoke_fetch_${name}(i0, j0 + 1, k0 + 1), smoke_fetch_${name}(i0 + 1, j0 + 1, k0 + 1),
    gx - f32(i0), gy - f32(j0), gz - f32(k0),
  );
}
`;
}

// 면 속도 페치·샘플 — 항상 클램프(CPU fetchU/V/W 와 동일).
function wgslFaceSampler(name: string, axis: "u" | "v" | "w"): string {
  const clampI = axis === "u" ? "i32(P.nx)" : "i32(P.nx) - 1";
  const clampJ = axis === "v" ? "i32(P.ny)" : "i32(P.ny) - 1";
  const clampK = axis === "w" ? "i32(P.nz)" : "i32(P.nz) - 1";
  const indexFn = axis === "u" ? "smoke_u_index" : axis === "v" ? "smoke_v_index" : "smoke_w_index";
  const offX = axis === "u" ? "x" : "x - 0.5";
  const offY = axis === "v" ? "y" : "y - 0.5";
  const offZ = axis === "w" ? "z" : "z - 0.5";
  return /* wgsl */ `
fn smoke_fetch_${name}(i : i32, j : i32, k : i32) -> f32 {
  let ii = smoke_clampi(i, 0, ${clampI});
  let jj = smoke_clampi(j, 0, ${clampJ});
  let kk = smoke_clampi(k, 0, ${clampK});
  return ${name}[${indexFn}(u32(ii), u32(jj), u32(kk))];
}
fn smoke_sample_${name}(x : f32, y : f32, z : f32) -> f32 {
  let gx = ${offX}; let gy = ${offY}; let gz = ${offZ};
  let i0 = i32(floor(gx)); let j0 = i32(floor(gy)); let k0 = i32(floor(gz));
  return smoke_blend8(
    smoke_fetch_${name}(i0, j0, k0), smoke_fetch_${name}(i0 + 1, j0, k0),
    smoke_fetch_${name}(i0, j0 + 1, k0), smoke_fetch_${name}(i0 + 1, j0 + 1, k0),
    smoke_fetch_${name}(i0, j0, k0 + 1), smoke_fetch_${name}(i0 + 1, j0, k0 + 1),
    smoke_fetch_${name}(i0, j0 + 1, k0 + 1), smoke_fetch_${name}(i0 + 1, j0 + 1, k0 + 1),
    gx - f32(i0), gy - f32(j0), gz - f32(k0),
  );
}
`;
}

// 셀 중심 속도(면 평균) — curl/enstrophy 용.
function wgslCellVelocity(): string {
  return /* wgsl */ `
fn smoke_cell_vel_x(i : i32, j : i32, k : i32) -> f32 {
  let ii = u32(smoke_clampi(i, 0, i32(P.nx) - 1));
  let jj = u32(smoke_clampi(j, 0, i32(P.ny) - 1));
  let kk = u32(smoke_clampi(k, 0, i32(P.nz) - 1));
  return 0.5 * (u[smoke_u_index(ii, jj, kk)] + u[smoke_u_index(ii + 1u, jj, kk)]);
}
fn smoke_cell_vel_y(i : i32, j : i32, k : i32) -> f32 {
  let ii = u32(smoke_clampi(i, 0, i32(P.nx) - 1));
  let jj = u32(smoke_clampi(j, 0, i32(P.ny) - 1));
  let kk = u32(smoke_clampi(k, 0, i32(P.nz) - 1));
  return 0.5 * (v[smoke_v_index(ii, jj, kk)] + v[smoke_v_index(ii, jj + 1u, kk)]);
}
fn smoke_cell_vel_z(i : i32, j : i32, k : i32) -> f32 {
  let ii = u32(smoke_clampi(i, 0, i32(P.nx) - 1));
  let jj = u32(smoke_clampi(j, 0, i32(P.ny) - 1));
  let kk = u32(smoke_clampi(k, 0, i32(P.nz) - 1));
  return 0.5 * (w[smoke_w_index(ii, jj, kk)] + w[smoke_w_index(ii, jj, kk + 1u)]);
}
`;
}

const WGSL_MAIN_PROLOGUE = /* wgsl */ `
@compute @workgroup_size(${STUDIO_SMOKE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let tid = gid.y * ${STUDIO_SMOKE_DISPATCH_ROW_THREADS}u + gid.x;
  if (tid >= P.thread_count) { return; }
`;

// --- 커널 소스 -------------------------------------------------------------

const WGSL_ADVECT_VELOCITY = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> u0 : array<f32>;
@group(0) @binding(2) var<storage, read> v0 : array<f32>;
@group(0) @binding(3) var<storage, read> w0 : array<f32>;
@group(0) @binding(4) var<storage, read_write> u : array<f32>;
@group(0) @binding(5) var<storage, read_write> v : array<f32>;
@group(0) @binding(6) var<storage, read_write> w : array<f32>;
${WGSL_INDEX_HELPERS}
${wgslFaceSampler("u0", "u")}
${wgslFaceSampler("v0", "v")}
${wgslFaceSampler("w0", "w")}
${WGSL_MAIN_PROLOGUE}
  let uc = smoke_u_count();
  let vc = smoke_v_count();
  var x = 0.0; var y = 0.0; var z = 0.0;
  var slot = 0u;
  var local = tid;
  if (tid < uc) {
    slot = 0u;
    let plane = (P.nx + 1u) * P.ny;
    let k = local / plane; let rest = local % plane;
    let j = rest / (P.nx + 1u); let i = rest % (P.nx + 1u);
    x = f32(i); y = f32(j) + 0.5; z = f32(k) + 0.5;
  } else if (tid < uc + vc) {
    slot = 1u;
    local = tid - uc;
    let plane = P.nx * (P.ny + 1u);
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    x = f32(i) + 0.5; y = f32(j); z = f32(k) + 0.5;
  } else {
    slot = 2u;
    local = tid - uc - vc;
    let plane = P.nx * P.ny;
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    x = f32(i) + 0.5; y = f32(j) + 0.5; z = f32(k);
  }
  let px = smoke_trace(x - P.dt * smoke_sample_u0(x, y, z) * P.inv_h, f32(P.nx));
  let py = smoke_trace(y - P.dt * smoke_sample_v0(x, y, z) * P.inv_h, f32(P.ny));
  let pz = smoke_trace(z - P.dt * smoke_sample_w0(x, y, z) * P.inv_h, f32(P.nz));
  if (slot == 0u) { u[local] = smoke_sample_u0(px, py, pz); }
  else if (slot == 1u) { v[local] = smoke_sample_v0(px, py, pz); }
  else { w[local] = smoke_sample_w0(px, py, pz); }
}
`;

const WGSL_ADVECT_SCALAR = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> u : array<f32>;
@group(0) @binding(3) var<storage, read> v : array<f32>;
@group(0) @binding(4) var<storage, read> w : array<f32>;
@group(0) @binding(5) var<storage, read> src : array<f32>;
@group(0) @binding(6) var<storage, read_write> dst : array<f32>;
${WGSL_INDEX_HELPERS}
${wgslFaceSampler("u", "u")}
${wgslFaceSampler("v", "v")}
${wgslFaceSampler("w", "w")}
${wgslScalarSampler("src")}
${WGSL_MAIN_PROLOGUE}
  if (solid[tid] != 0u) { dst[tid] = 0.0; return; }
  let plane = P.nx * P.ny;
  let k = tid / plane; let rest = tid % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  let x = f32(i) + 0.5; let y = f32(j) + 0.5; let z = f32(k) + 0.5;
  let px = smoke_trace(x - P.dt * smoke_sample_u(x, y, z) * P.inv_h, f32(P.nx));
  let py = smoke_trace(y - P.dt * smoke_sample_v(x, y, z) * P.inv_h, f32(P.ny));
  let pz = smoke_trace(z - P.dt * smoke_sample_w(x, y, z) * P.inv_h, f32(P.nz));
  dst[tid] = smoke_sample_src(px, py, pz);
}
`;

const WGSL_DISSIPATE = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read_write> density : array<f32>;
@group(0) @binding(3) var<storage, read_write> temperature : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  if (solid[tid] != 0u) { density[tid] = 0.0; temperature[tid] = 0.0; return; }
  let df = max(0.0, 1.0 - P.density_dissipation * P.dt);
  let tf = max(0.0, 1.0 - P.temperature_dissipation * P.dt);
  density[tid] = density[tid] * df;
  temperature[tid] = temperature[tid] * tf;
}
`;

const WGSL_BUOYANCY = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> density : array<f32>;
@group(0) @binding(3) var<storage, read> temperature : array<f32>;
@group(0) @binding(4) var<storage, read_write> v : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  let plane = P.nx * (P.ny + 1u);
  let k = tid / plane; let rest = tid % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  if (j == 0u || j >= P.ny) { return; }
  let below = smoke_cell_index(i, j - 1u, k);
  let above = smoke_cell_index(i, j, k);
  if (solid[below] != 0u || solid[above] != 0u) { return; }
  let d = 0.5 * (density[below] + density[above]);
  let t = 0.5 * (temperature[below] + temperature[above]);
  let force = -P.buoyancy_alpha * d + P.buoyancy_beta * (t - P.ambient_temperature);
  v[tid] = v[tid] + P.dt * force;
}
`;

const WGSL_CURL = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> u : array<f32>;
@group(0) @binding(2) var<storage, read> v : array<f32>;
@group(0) @binding(3) var<storage, read> w : array<f32>;
@group(0) @binding(4) var<storage, read_write> curlX : array<f32>;
@group(0) @binding(5) var<storage, read_write> curlY : array<f32>;
@group(0) @binding(6) var<storage, read_write> curlZ : array<f32>;
@group(0) @binding(7) var<storage, read_write> curlMagnitude : array<f32>;
${WGSL_INDEX_HELPERS}
${wgslCellVelocity()}
${WGSL_MAIN_PROLOGUE}
  let plane = P.nx * P.ny;
  let k = i32(tid / plane); let rest = tid % plane;
  let j = i32(rest / P.nx); let i = i32(rest % P.nx);
  let inv2h = 1.0 / (2.0 * P.h);
  let dwdy = (smoke_cell_vel_z(i, j + 1, k) - smoke_cell_vel_z(i, j - 1, k)) * inv2h;
  let dvdz = (smoke_cell_vel_y(i, j, k + 1) - smoke_cell_vel_y(i, j, k - 1)) * inv2h;
  let dudz = (smoke_cell_vel_x(i, j, k + 1) - smoke_cell_vel_x(i, j, k - 1)) * inv2h;
  let dwdx = (smoke_cell_vel_z(i + 1, j, k) - smoke_cell_vel_z(i - 1, j, k)) * inv2h;
  let dvdx = (smoke_cell_vel_y(i + 1, j, k) - smoke_cell_vel_y(i - 1, j, k)) * inv2h;
  let dudy = (smoke_cell_vel_x(i, j + 1, k) - smoke_cell_vel_x(i, j - 1, k)) * inv2h;
  let wx = dwdy - dvdz;
  let wy = dudz - dwdx;
  let wz = dvdx - dudy;
  curlX[tid] = wx;
  curlY[tid] = wy;
  curlZ[tid] = wz;
  curlMagnitude[tid] = sqrt(wx * wx + wy * wy + wz * wz);
}
`;

const WGSL_VORTICITY_FORCE = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> curlMagnitude : array<f32>;
@group(0) @binding(3) var<storage, read_write> curlX : array<f32>;
@group(0) @binding(4) var<storage, read_write> curlY : array<f32>;
@group(0) @binding(5) var<storage, read_write> curlZ : array<f32>;
${WGSL_INDEX_HELPERS}
fn smoke_mag_at(i : i32, j : i32, k : i32) -> f32 {
  let ii = u32(smoke_clampi(i, 0, i32(P.nx) - 1));
  let jj = u32(smoke_clampi(j, 0, i32(P.ny) - 1));
  let kk = u32(smoke_clampi(k, 0, i32(P.nz) - 1));
  return curlMagnitude[smoke_cell_index(ii, jj, kk)];
}
${WGSL_MAIN_PROLOGUE}
  let plane = P.nx * P.ny;
  let k = i32(tid / plane); let rest = tid % plane;
  let j = i32(rest / P.nx); let i = i32(rest % P.nx);
  let wx = curlX[tid]; let wy = curlY[tid]; let wz = curlZ[tid];
  let inv2h = 1.0 / (2.0 * P.h);
  let gx = (smoke_mag_at(i + 1, j, k) - smoke_mag_at(i - 1, j, k)) * inv2h;
  let gy = (smoke_mag_at(i, j + 1, k) - smoke_mag_at(i, j - 1, k)) * inv2h;
  let gz = (smoke_mag_at(i, j, k + 1) - smoke_mag_at(i, j, k - 1)) * inv2h;
  let norm = sqrt(gx * gx + gy * gy + gz * gz);
  if (norm <= 1e-12 || solid[tid] != 0u) {
    curlX[tid] = 0.0; curlY[tid] = 0.0; curlZ[tid] = 0.0;
    return;
  }
  let nx = gx / norm; let ny = gy / norm; let nz = gz / norm;
  let scale = P.vorticity_epsilon * P.h;
  curlX[tid] = scale * (ny * wz - nz * wy);
  curlY[tid] = scale * (nz * wx - nx * wz);
  curlZ[tid] = scale * (nx * wy - ny * wx);
}
`;

const WGSL_VORTICITY_APPLY = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> curlX : array<f32>;
@group(0) @binding(3) var<storage, read> curlY : array<f32>;
@group(0) @binding(4) var<storage, read> curlZ : array<f32>;
@group(0) @binding(5) var<storage, read_write> u : array<f32>;
@group(0) @binding(6) var<storage, read_write> v : array<f32>;
@group(0) @binding(7) var<storage, read_write> w : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  let uc = smoke_u_count();
  let vc = smoke_v_count();
  if (tid < uc) {
    let plane = (P.nx + 1u) * P.ny;
    let k = tid / plane; let rest = tid % plane;
    let j = rest / (P.nx + 1u); let i = rest % (P.nx + 1u);
    if (i == 0u || i >= P.nx) { return; }
    let left = smoke_cell_index(i - 1u, j, k);
    let right = smoke_cell_index(i, j, k);
    if (solid[left] != 0u || solid[right] != 0u) { return; }
    u[tid] = u[tid] + P.dt * 0.5 * (curlX[left] + curlX[right]);
  } else if (tid < uc + vc) {
    let local = tid - uc;
    let plane = P.nx * (P.ny + 1u);
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    if (j == 0u || j >= P.ny) { return; }
    let below = smoke_cell_index(i, j - 1u, k);
    let above = smoke_cell_index(i, j, k);
    if (solid[below] != 0u || solid[above] != 0u) { return; }
    v[local] = v[local] + P.dt * 0.5 * (curlY[below] + curlY[above]);
  } else {
    let local = tid - uc - vc;
    let plane = P.nx * P.ny;
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    if (k == 0u || k >= P.nz) { return; }
    let back = smoke_cell_index(i, j, k - 1u);
    let front = smoke_cell_index(i, j, k);
    if (solid[back] != 0u || solid[front] != 0u) { return; }
    w[local] = w[local] + P.dt * 0.5 * (curlZ[back] + curlZ[front]);
  }
}
`;

const WGSL_BOUNDARY = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read_write> density : array<f32>;
@group(0) @binding(3) var<storage, read_write> temperature : array<f32>;
@group(0) @binding(4) var<storage, read_write> pressure : array<f32>;
@group(0) @binding(5) var<storage, read_write> u : array<f32>;
@group(0) @binding(6) var<storage, read_write> v : array<f32>;
@group(0) @binding(7) var<storage, read_write> w : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  let cc = P.cell_count;
  let uc = smoke_u_count();
  let vc = smoke_v_count();
  if (tid < cc) {
    if (solid[tid] != 0u) { density[tid] = 0.0; temperature[tid] = 0.0; pressure[tid] = 0.0; }
    return;
  }
  if (tid < cc + uc) {
    let local = tid - cc;
    let plane = (P.nx + 1u) * P.ny;
    let k = local / plane; let rest = local % plane;
    let j = rest / (P.nx + 1u); let i = rest % (P.nx + 1u);
    var neg = false; var pos = false;
    if (i == 0u) { neg = !smoke_is_open(0u); } else { neg = solid[smoke_cell_index(i - 1u, j, k)] != 0u; }
    if (i == P.nx) { pos = !smoke_is_open(1u); } else { pos = solid[smoke_cell_index(i, j, k)] != 0u; }
    if (neg || pos) { u[local] = 0.0; }
    return;
  }
  if (tid < cc + uc + vc) {
    let local = tid - cc - uc;
    let plane = P.nx * (P.ny + 1u);
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    var neg = false; var pos = false;
    if (j == 0u) { neg = !smoke_is_open(2u); } else { neg = solid[smoke_cell_index(i, j - 1u, k)] != 0u; }
    if (j == P.ny) { pos = !smoke_is_open(3u); } else { pos = solid[smoke_cell_index(i, j, k)] != 0u; }
    if (neg || pos) { v[local] = 0.0; }
    return;
  }
  let local = tid - cc - uc - vc;
  let plane = P.nx * P.ny;
  let k = local / plane; let rest = local % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  var neg = false; var pos = false;
  if (k == 0u) { neg = !smoke_is_open(4u); } else { neg = solid[smoke_cell_index(i, j, k - 1u)] != 0u; }
  if (k == P.nz) { pos = !smoke_is_open(5u); } else { pos = solid[smoke_cell_index(i, j, k)] != 0u; }
  if (neg || pos) { w[local] = 0.0; }
}
`;

const WGSL_DIVERGENCE = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> u : array<f32>;
@group(0) @binding(3) var<storage, read> v : array<f32>;
@group(0) @binding(4) var<storage, read> w : array<f32>;
@group(0) @binding(5) var<storage, read_write> divergence : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  if (solid[tid] != 0u) { divergence[tid] = 0.0; return; }
  let plane = P.nx * P.ny;
  let k = tid / plane; let rest = tid % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  let du = u[smoke_u_index(i + 1u, j, k)] - u[smoke_u_index(i, j, k)];
  let dv = v[smoke_v_index(i, j + 1u, k)] - v[smoke_v_index(i, j, k)];
  let dw = w[smoke_w_index(i, j, k + 1u)] - w[smoke_w_index(i, j, k)];
  divergence[tid] = (du + dv + dw) * P.inv_h;
}
`;

const WGSL_PRESSURE_JACOBI = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> divergence : array<f32>;
@group(0) @binding(3) var<storage, read> src : array<f32>;
@group(0) @binding(4) var<storage, read_write> dst : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  if (solid[tid] != 0u) { dst[tid] = 0.0; return; }
  let plane = P.nx * P.ny;
  let k = tid / plane; let rest = tid % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  var sum = 0.0;
  var count = 0.0;
  if (i > 0u) { let nb = tid - 1u; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(0u)) { count = count + 1.0; }
  if (i < P.nx - 1u) { let nb = tid + 1u; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(1u)) { count = count + 1.0; }
  if (j > 0u) { let nb = tid - P.nx; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(2u)) { count = count + 1.0; }
  if (j < P.ny - 1u) { let nb = tid + P.nx; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(3u)) { count = count + 1.0; }
  if (k > 0u) { let nb = tid - plane; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(4u)) { count = count + 1.0; }
  if (k < P.nz - 1u) { let nb = tid + plane; if (solid[nb] == 0u) { sum = sum + src[nb]; count = count + 1.0; } }
  else if (smoke_is_open(5u)) { count = count + 1.0; }
  if (count == 0.0) { dst[tid] = 0.0; return; }
  dst[tid] = (sum - divergence[tid] * P.pressure_inv_scale) / count;
}
`;

const WGSL_SUBTRACT_GRADIENT = /* wgsl */ `${WGSL_PARAMS}
@group(0) @binding(0) var<uniform> P : SmokeParams;
@group(0) @binding(1) var<storage, read> solid : array<u32>;
@group(0) @binding(2) var<storage, read> pressure : array<f32>;
@group(0) @binding(3) var<storage, read_write> u : array<f32>;
@group(0) @binding(4) var<storage, read_write> v : array<f32>;
@group(0) @binding(5) var<storage, read_write> w : array<f32>;
${WGSL_INDEX_HELPERS}
${WGSL_MAIN_PROLOGUE}
  let uc = smoke_u_count();
  let vc = smoke_v_count();
  let scale = P.dt / P.h;
  if (tid < uc) {
    let plane = (P.nx + 1u) * P.ny;
    let k = tid / plane; let rest = tid % plane;
    let j = rest / (P.nx + 1u); let i = rest % (P.nx + 1u);
    if (i == 0u) {
      let cell = smoke_cell_index(0u, j, k);
      if (smoke_is_open(0u) && solid[cell] == 0u) { u[tid] = u[tid] - scale * pressure[cell]; }
      else { u[tid] = 0.0; }
    } else if (i == P.nx) {
      let cell = smoke_cell_index(P.nx - 1u, j, k);
      if (smoke_is_open(1u) && solid[cell] == 0u) { u[tid] = u[tid] - scale * (0.0 - pressure[cell]); }
      else { u[tid] = 0.0; }
    } else {
      let left = smoke_cell_index(i - 1u, j, k);
      let right = smoke_cell_index(i, j, k);
      if (solid[left] != 0u || solid[right] != 0u) { u[tid] = 0.0; }
      else { u[tid] = u[tid] - scale * (pressure[right] - pressure[left]); }
    }
    return;
  }
  if (tid < uc + vc) {
    let local = tid - uc;
    let plane = P.nx * (P.ny + 1u);
    let k = local / plane; let rest = local % plane;
    let j = rest / P.nx; let i = rest % P.nx;
    if (j == 0u) {
      let cell = smoke_cell_index(i, 0u, k);
      if (smoke_is_open(2u) && solid[cell] == 0u) { v[local] = v[local] - scale * pressure[cell]; }
      else { v[local] = 0.0; }
    } else if (j == P.ny) {
      let cell = smoke_cell_index(i, P.ny - 1u, k);
      if (smoke_is_open(3u) && solid[cell] == 0u) { v[local] = v[local] - scale * (0.0 - pressure[cell]); }
      else { v[local] = 0.0; }
    } else {
      let below = smoke_cell_index(i, j - 1u, k);
      let above = smoke_cell_index(i, j, k);
      if (solid[below] != 0u || solid[above] != 0u) { v[local] = 0.0; }
      else { v[local] = v[local] - scale * (pressure[above] - pressure[below]); }
    }
    return;
  }
  let local = tid - uc - vc;
  let plane = P.nx * P.ny;
  let k = local / plane; let rest = local % plane;
  let j = rest / P.nx; let i = rest % P.nx;
  if (k == 0u) {
    let cell = smoke_cell_index(i, j, 0u);
    if (smoke_is_open(4u) && solid[cell] == 0u) { w[local] = w[local] - scale * pressure[cell]; }
    else { w[local] = 0.0; }
  } else if (k == P.nz) {
    let cell = smoke_cell_index(i, j, P.nz - 1u);
    if (smoke_is_open(5u) && solid[cell] == 0u) { w[local] = w[local] - scale * (0.0 - pressure[cell]); }
    else { w[local] = 0.0; }
  } else {
    let back = smoke_cell_index(i, j, k - 1u);
    let front = smoke_cell_index(i, j, k);
    if (solid[back] != 0u || solid[front] != 0u) { w[local] = 0.0; }
    else { w[local] = w[local] - scale * (pressure[front] - pressure[back]); }
  }
}
`;

// ---------------------------------------------------------------------------
// 셰이더 레지스트리
// ---------------------------------------------------------------------------

export interface StudioSmokeShaderSource {
  /** 파이프라인 캐시 키 — 같은 id 는 셰이더 모듈/파이프라인을 재사용한다. */
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: string;
}

function shader(id: StudioSmokeKernelId, wgsl: string): StudioSmokeShaderSource {
  return { shaderId: `studio-smoke/${id}`, wgsl, entryPoint: "main" };
}

/** CPU 커널 레지스트리(STUDIO_SMOKE_KERNEL_IDS)와 1:1 대응하는 WGSL 포트. */
export const STUDIO_SMOKE_WGSL_KERNELS: Record<StudioSmokeKernelId, StudioSmokeShaderSource> = {
  advect_velocity: shader("advect_velocity", WGSL_ADVECT_VELOCITY),
  advect_scalar: shader("advect_scalar", WGSL_ADVECT_SCALAR),
  dissipate: shader("dissipate", WGSL_DISSIPATE),
  buoyancy: shader("buoyancy", WGSL_BUOYANCY),
  curl: shader("curl", WGSL_CURL),
  vorticity_force: shader("vorticity_force", WGSL_VORTICITY_FORCE),
  vorticity_apply: shader("vorticity_apply", WGSL_VORTICITY_APPLY),
  boundary: shader("boundary", WGSL_BOUNDARY),
  divergence: shader("divergence", WGSL_DIVERGENCE),
  pressure_jacobi: shader("pressure_jacobi", WGSL_PRESSURE_JACOBI),
  subtract_gradient: shader("subtract_gradient", WGSL_SUBTRACT_GRADIENT),
};

/** 드리프트 가드용 — 레지스트리가 실제로 커버하는 커널 id 목록(정렬됨). */
export const STUDIO_SMOKE_WGSL_KERNEL_IDS: readonly StudioSmokeKernelId[] = [...STUDIO_SMOKE_KERNEL_IDS].sort();

// ---------------------------------------------------------------------------
// uniform 패커
// ---------------------------------------------------------------------------

/**
 * 64바이트 uniform 을 채운다. `threadCount` 는 커널마다 다르므로 인자로 받는다
 * (패스별로 patchStudioSmokeThreadCount 로 덮어써도 된다).
 */
export function packStudioSmokeUniform(
  spec: StudioSmokeGridSpec,
  params: StudioSmokeStepParams,
  threadCount: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(STUDIO_SMOKE_UNIFORM_BYTES);
  const view = new DataView(buffer);
  const O = STUDIO_SMOKE_UNIFORM_OFFSETS;
  view.setUint32(O.nx, spec.nx, true);
  view.setUint32(O.ny, spec.ny, true);
  view.setUint32(O.nz, spec.nz, true);
  view.setUint32(O.cellCount, spec.nx * spec.ny * spec.nz, true);
  view.setFloat32(O.dt, params.dt, true);
  view.setFloat32(O.h, spec.h, true);
  view.setFloat32(O.invH, 1 / spec.h, true);
  view.setUint32(O.threadCount, Math.max(0, Math.floor(threadCount)), true);
  view.setFloat32(O.buoyancyAlpha, params.buoyancyAlpha, true);
  view.setFloat32(O.buoyancyBeta, params.buoyancyBeta, true);
  view.setFloat32(O.ambientTemperature, params.ambientTemperature, true);
  view.setFloat32(O.vorticityEpsilon, params.vorticityEpsilon, true);
  view.setFloat32(O.densityDissipation, params.densityDissipation, true);
  view.setFloat32(O.temperatureDissipation, params.temperatureDissipation, true);
  view.setUint32(O.boundaryOpen, packStudioSmokeBoundaryMask(spec.boundary), true);
  view.setFloat32(O.pressureInvScale, (spec.h * spec.h) / params.dt, true);
  return buffer;
}

/** 이미 만든 uniform 의 threadCount 만 갈아끼운다(패스마다 버퍼를 새로 만들지 않기 위해). */
export function patchStudioSmokeThreadCount(uniform: ArrayBuffer, threadCount: number): ArrayBuffer {
  new DataView(uniform).setUint32(
    STUDIO_SMOKE_UNIFORM_OFFSETS.threadCount,
    Math.max(0, Math.floor(threadCount)),
    true,
  );
  return uniform;
}

/** solid(Uint8) → WGSL storage 용 Uint32 마스크. */
export function packStudioSmokeSolidMask(solid: Uint8Array): Uint32Array {
  const packed = new Uint32Array(solid.length);
  for (let index = 0; index < solid.length; index += 1) packed[index] = solid[index] === 0 ? 0 : 1;
  return packed;
}
