/**
 * Studio Smoke Core — Eulerian 연기 솔버(stable fluids, MAC 격자, 순수 TS)
 *
 * ## 파이프라인 (stepStudioSmoke 한 번이 도는 순서)
 *  1. **semi-Lagrangian 이류**: 속도(u,v,w) → 스칼라(density, temperature).
 *     각 격자점에서 속도를 역추적(backtrace)해 이전 필드를 삼선형 보간한다.
 *  2. **소산(dissipation)**: density/temperature 에 (1 − rate·dt) 를 곱한다.
 *  3. **부력**: v(세로) 면에 f = (−α·density + β·(T − T_ambient)) 를 더한다. **+y 가 위**다.
 *  4. **와도 구속(vorticity confinement)**: ω=∇×u → N=∇|ω|/‖∇|ω|‖ → f=ε·h·(N×ω).
 *     1차 이류가 잡아먹는 소용돌이를 되살리는 보정항이다(물리적으로 정확한 항이 아님).
 *  5. **압력 투영**: 경계 적용 → 발산 → Jacobi K회 → 압력 그라디언트 차감 → 경계 재적용.
 *
 * ## 이산화 (전부 MAC staggered, ρ=1)
 *  - 발산  D[c] = (u[i+1]−u[i] + v[j+1]−v[j] + w[k+1]−w[k]) / h
 *  - 압력  s·(Σ_nb p[nb] − n·p[c]) = D[c],  s = dt/(ρ·h²)
 *          ⇒ Jacobi: p[c] ← (Σ_nb p[nb] − D[c]·h²/dt) / n
 *  - 보정  u[i] ← u[i] − (dt/ρ)·(p[c] − p[c−1])/h
 *  solid 이웃은 Neumann(∂p/∂n=0) — 라플라시안·발산 양쪽에서 그 면을 통째로 뺀다.
 *  open 경계는 Dirichlet p=0 — 바깥 고스트 압력 0 을 이웃으로 세어 넣는다.
 *  발산 스텐실과 압력 라플라시안이 정확히 수반이라, "투영 후 발산 감소" 측정이 정직하다.
 *
 * ## Jacobi 반복수 (기본 40) — **이 저장소에서 실측한 값**
 * 폐쇄 상자의 전 면에 결정적 백색잡음 속도(mulberry32 seed 1234, −1..1)를 넣고 투영한 뒤
 * 발산 잔차비(after/before). 백색잡음은 저주파 성분이 가득한 **최악 조건**이다 —
 * 실제 이류 뒤 속도장의 발산은 이보다 훨씬 고주파라 같은 K 에서 잔차가 더 낮게 나온다.
 *
 * | K            |   1  |   5  |  10  |  20  |  40  |  80  | 160  |
 * |--------------|------|------|------|------|------|------|------|
 * | 32³ RMS 비   | .405 | .147 | .096 | .065 | .043 | .028 | .017 |
 * | 48³ RMS 비   | .409 | .144 | .090 | .056 | .035 | .023 | .016 |
 * | 32³ L∞ 비    | .449 | .205 | .150 | .101 | .058 | .028 | .013 |
 * | 48³ L∞ 비    | .471 | .182 | .111 | .064 | .039 | .021 | .013 |
 *
 * 20→40 이 잔차를 약 0.62배, 40→80 이 또 0.65배로 줄인다. Jacobi 는 저주파 오차를
 * O(1/K) 로만 깎기 때문에 그 이상은 반복수를 두 배 써도 잔차가 3분의 1도 안 준다 —
 * 40이 "잔차/비용"의 무릎이다. 오프라인 베이크는 80~160 을 써도 되고, 파라미터로 열려 있다.
 * (숫자 재현: studio-smoke-core.test.ts 의 "Jacobi 반복수 단조 수렴" 케이스)
 *
 * ## 왜 Gauss-Seidel 이 아니라 Jacobi 인가 (수치가 아니라 계약 때문)
 * in-place GS 는 워크그룹 간 read-write 해저드라 WGSL 로 1:1 포팅이 불가능하고, red-black GS 는
 * 2 디스패치 + 다른 순회 순서라 CPU/GPU 가 '같은 수식'이 아니게 된다. 결정성(같은 입력 ⇒
 * 바이트 동일)과 CPU/GPU 미러링을 동시에 지키는 유일한 선택이 Jacobi 다. 또 매 solve 는
 * warm start 없이 p=0 에서 시작한다 — 결과가 (divergence, spec, K) 만의 함수가 되어
 * 프레임 순서에 따른 표류가 원천 차단된다.
 *
 * ## 실측 성능 (이 머신: Darwin arm64, node/V8 단일 스레드, K=40 · 와도 ε=8 · 굴뚝 경계)
 * | 해상도 | 셀 수     | 1스텝     | 초당 스텝 | 현실적 용도                    |
 * |--------|-----------|-----------|-----------|--------------------------------|
 * | 32³    |    32,768 |  33.1 ms  |  30       | 워커에서 저해상도 미리보기      |
 * | 48³    |   110,592 | 109.1 ms  |   9.2     | 표준 베이크(오프라인)           |
 * | 64³    |   262,144 | 252.9 ms  |   4.0     | 고품질 베이크(오프라인)         |
 * **정직하게**: 32³ 조차 메인 스레드에서 매 프레임 돌릴 물건이 **아니다**(30 step/s 는
 * 다른 일을 아무것도 안 할 때 이야기다). 워커 오프로드가 붙기 전까지는 "오프라인 베이크 →
 * 프레임 시퀀스 삽입" 흐름으로만 쓰는 게 맞다(통합 스펙 참고). 96³/128³ 은 이 추세대로면
 * 각각 초 단위/수 초 단위라 명시적 opt-in 뒤에 둔다(studio-smoke-grid 의 오프라인 게이트).
 *
 * ## 정직한 한계 (Blender/Mantaflow 패리티 아님)
 *  - **1차 semi-Lagrangian** 이라 수치 소산이 눈에 띈다. MacCormack/BFECC, FLIP/PIC 없음.
 *  - **질량은 일반 조건에서 보존되지 않고, 줄기만 하는 것도 아니다.** 역추적 사상이
 *    O(dt²) 만큼 부피를 안 지켜서 표류가 **양방향**이다 — 폐쇄 상자 20~30스텝 실측으로
 *    설정에 따라 −4.5% 도 +2% 도 나온다. "연기는 점점 옅어진다"고 가정하고 테스트를
 *    쓰면 거짓 실패한다. 보존이 tight 하게 성립하는 조건은 "발산 0 인 **균일** 속도장 +
 *    벽에서 떨어진 밀도" 뿐이다(실측 상대오차 4.1e-9). 부호까지 보장되는 진짜 정리는
 *    **최대치 원리**(삼선형은 볼록결합 ⇒ max 는 늘지 않고 값은 음수가 되지 않는다)와
 *    "벽을 통한 유출이 정확히 0"(경계 면 속도가 정확히 0)이다.
 *  - 고정 밀집 격자, 단일 상(phase), 연소/화염 화학 없음, 적응 시간스텝 없음.
 *  - 장애물은 셀 단위 계단(부분 셀 점유·움직이는 장애물 없음).
 *  - 와도 구속은 물리항이 아니라 소산 상쇄용 아트 디렉션 노브다. **ε 를 키우면 에너지를
 *    주입한다** — 실측 엔스트로피가 ε=0에서 664, ε=10에서 2.97e4, ε=20에서 4.51e5 로
 *    폭증한다. 큰 ε 는 그림이 아니라 발산으로 간다.
 *  - CFL 초과 시 조용히 뭉개지 않는다 — 결과에 maxCfl/cflClamped 를 실어 호출부가
 *    dt 를 줄이거나 서브스텝하도록 한다(자동 서브스텝은 결정성 계약상 넣지 않는다).
 *
 * Math.random/Date.now/performance.now 0건. Konva/DOM/React 의존 없음.
 */

import {
  packStudioSmokeBoundaryMask,
  studioSmokeCellCount,
  studioSmokeCellIndex,
  studioSmokeUIndex,
  studioSmokeVIndex,
  studioSmokeWIndex,
} from "./studio-smoke-grid";

import type { StudioSmokeGridSpec, StudioSmokeState } from "./studio-smoke-grid";

// ---------------------------------------------------------------------------
// 파라미터·결과
// ---------------------------------------------------------------------------

export interface StudioSmokeStepParams {
  /** 시간 스텝(초). CFL 은 max|v|·dt/h — 1 을 넘기면 결과에 경고가 실린다. */
  readonly dt: number;
  /** 밀도가 아래로 끌리는 세기(연기 무게). */
  readonly buoyancyAlpha: number;
  /** 온도가 위로 뜨는 세기. */
  readonly buoyancyBeta: number;
  /** 부력 기준 온도 — 이보다 뜨거우면 뜬다. */
  readonly ambientTemperature: number;
  /** 와도 구속 세기 ε(0 이면 끔). 크게 주면 에너지가 주입된다(위 한계 참고). */
  readonly vorticityEpsilon: number;
  /** 밀도 소산율(1/초). 0 이면 이류 소산만 남는다. */
  readonly densityDissipation: number;
  /** 온도 소산율(1/초) — 보통 밀도보다 크게 잡아 연기가 식게 한다. */
  readonly temperatureDissipation: number;
  /** Jacobi 반복수. 기본 40(위 표 참고). */
  readonly pressureIterations: number;
  /** true 면 결과에 투영 전후 발산을 실어준다(패스 2회 추가 비용). */
  readonly measureDivergence?: boolean;
}

export interface StudioSmokeDivergenceMeasure {
  /** fluid 셀 발산의 RMS(√평균제곱) — 해상도 간 비교 가능. */
  readonly rms: number;
  /** 발산 절대값 최대. */
  readonly linf: number;
  /** 측정에 포함된 fluid 셀 수. */
  readonly cells: number;
}

export interface StudioSmokeStepResult {
  /** 이 스텝 시작 시점의 max|v|·dt/h. */
  readonly maxCfl: number;
  /** 역추적 위치가 패딩 경계까지 밀려 클램프된 적이 있는가(무음 아티팩트 신호). */
  readonly cflClamped: boolean;
  /** 클램프된 역추적 샘플 수. */
  readonly clampedSamples: number;
  /** measureDivergence 가 true 일 때만 채워진다. */
  readonly divergenceBefore: StudioSmokeDivergenceMeasure | null;
  readonly divergenceAfter: StudioSmokeDivergenceMeasure | null;
}

/**
 * 역추적 위치를 도메인 밖으로 최대 몇 셀까지 허용할지. 이 밖은 클램프되며
 * cflClamped 로 보고된다(경계 근처에서 정보가 없어 값이 뭉개지는 지점).
 */
export const STUDIO_SMOKE_TRACE_PADDING = 1;

// open 경계 비트 — packStudioSmokeBoundaryMask 의 비트 순서와 같다.
const OPEN_X_MIN = 1;
const OPEN_X_MAX = 2;
const OPEN_Y_MIN = 4;
const OPEN_Y_MAX = 8;
const OPEN_Z_MIN = 16;
const OPEN_Z_MAX = 32;

// ---------------------------------------------------------------------------
// 샘플러
//
// 핫 루프는 `spec` 객체 대신 **원시값(nx,ny,nz,openMask)** 을 받는다. 스텝 하나가
// 수백만 번 부르는 자리라 객체 프로퍼티 로드와 문자열 비교("open") 가 그대로 비용이 된다.
// 실측(32³/48³/64³): spec 기반 73.4/233.7/568.4 ms → 원시값 기반 33.1/109.1/252.9 ms
// (2.2배). 수치 결과는 리팩터 전후 **바이트 동일**하다 — 순서·연산 형태를 안 바꿨다.
// 공개 API(sampleStudioSmoke*)는 spec 서명을 유지하고 안쪽으로 위임한다.
// ---------------------------------------------------------------------------

/**
 * 셀 중심 스칼라 페치. 도메인 밖은 경계 모드에 따라 갈린다:
 *  - open : 0 (바깥은 비어 있다 ⇒ 이류가 실제로 질량을 밖으로 내보낸다)
 *  - solid: 가장 가까운 셀 값으로 반사 (벽을 통해 질량이 새지 않는다)
 */
function fetchScalarRaw(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  openMask: number,
  i: number,
  j: number,
  k: number,
): number {
  let ii = i;
  if (ii < 0) {
    if ((openMask & OPEN_X_MIN) !== 0) return 0;
    ii = 0;
  } else if (ii >= nx) {
    if ((openMask & OPEN_X_MAX) !== 0) return 0;
    ii = nx - 1;
  }
  let jj = j;
  if (jj < 0) {
    if ((openMask & OPEN_Y_MIN) !== 0) return 0;
    jj = 0;
  } else if (jj >= ny) {
    if ((openMask & OPEN_Y_MAX) !== 0) return 0;
    jj = ny - 1;
  }
  let kk = k;
  if (kk < 0) {
    if ((openMask & OPEN_Z_MIN) !== 0) return 0;
    kk = 0;
  } else if (kk >= nz) {
    if ((openMask & OPEN_Z_MAX) !== 0) return 0;
    kk = nz - 1;
  }
  return field[ii + nx * (jj + ny * kk)];
}

function sampleScalarRaw(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  openMask: number,
  x: number,
  y: number,
  z: number,
): number {
  const gx = x - 0.5;
  const gy = y - 0.5;
  const gz = z - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const k0 = Math.floor(gz);
  const tx = gx - i0;
  const ty = gy - j0;
  const tz = gz - k0;
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const k1 = k0 + 1;
  const a = fetchScalarRaw(field, nx, ny, nz, openMask, i0, j0, k0);
  const b = fetchScalarRaw(field, nx, ny, nz, openMask, i1, j0, k0);
  const c = fetchScalarRaw(field, nx, ny, nz, openMask, i0, j1, k0);
  const d = fetchScalarRaw(field, nx, ny, nz, openMask, i1, j1, k0);
  const e = fetchScalarRaw(field, nx, ny, nz, openMask, i0, j0, k1);
  const f = fetchScalarRaw(field, nx, ny, nz, openMask, i1, j0, k1);
  const g = fetchScalarRaw(field, nx, ny, nz, openMask, i0, j1, k1);
  const h = fetchScalarRaw(field, nx, ny, nz, openMask, i1, j1, k1);
  const x00 = a + (b - a) * tx;
  const x10 = c + (d - c) * tx;
  const x01 = e + (f - e) * tx;
  const x11 = g + (h - g) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

// 면 속도 페치는 항상 클램프(Neumann 근사). open 경계에서 바깥 속도를 0 으로 두면
// 유출구 바로 안쪽에 인위적 전단이 생겨 플룸이 꺾인다 — 가장 가까운 면 값을 잇는 편이 낫다.
function fetchURaw(u: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i > nx ? nx : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  return u[ii + (nx + 1) * (jj + ny * kk)];
}

function fetchVRaw(v: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j > ny ? ny : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  return v[ii + nx * (jj + (ny + 1) * kk)];
}

function fetchWRaw(w: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k > nz ? nz : k;
  return w[ii + nx * (jj + ny * kk)];
}

function sampleURaw(
  u: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number,
): number {
  const gy = y - 0.5;
  const gz = z - 0.5;
  const i0 = Math.floor(x);
  const j0 = Math.floor(gy);
  const k0 = Math.floor(gz);
  const tx = x - i0;
  const ty = gy - j0;
  const tz = gz - k0;
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const k1 = k0 + 1;
  const a = fetchURaw(u, nx, ny, nz, i0, j0, k0);
  const b = fetchURaw(u, nx, ny, nz, i1, j0, k0);
  const c = fetchURaw(u, nx, ny, nz, i0, j1, k0);
  const d = fetchURaw(u, nx, ny, nz, i1, j1, k0);
  const e = fetchURaw(u, nx, ny, nz, i0, j0, k1);
  const f = fetchURaw(u, nx, ny, nz, i1, j0, k1);
  const g = fetchURaw(u, nx, ny, nz, i0, j1, k1);
  const h = fetchURaw(u, nx, ny, nz, i1, j1, k1);
  const x00 = a + (b - a) * tx;
  const x10 = c + (d - c) * tx;
  const x01 = e + (f - e) * tx;
  const x11 = g + (h - g) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

function sampleVRaw(
  v: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number,
): number {
  const gx = x - 0.5;
  const gz = z - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(y);
  const k0 = Math.floor(gz);
  const tx = gx - i0;
  const ty = y - j0;
  const tz = gz - k0;
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const k1 = k0 + 1;
  const a = fetchVRaw(v, nx, ny, nz, i0, j0, k0);
  const b = fetchVRaw(v, nx, ny, nz, i1, j0, k0);
  const c = fetchVRaw(v, nx, ny, nz, i0, j1, k0);
  const d = fetchVRaw(v, nx, ny, nz, i1, j1, k0);
  const e = fetchVRaw(v, nx, ny, nz, i0, j0, k1);
  const f = fetchVRaw(v, nx, ny, nz, i1, j0, k1);
  const g = fetchVRaw(v, nx, ny, nz, i0, j1, k1);
  const h = fetchVRaw(v, nx, ny, nz, i1, j1, k1);
  const x00 = a + (b - a) * tx;
  const x10 = c + (d - c) * tx;
  const x01 = e + (f - e) * tx;
  const x11 = g + (h - g) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

function sampleWRaw(
  w: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number,
): number {
  const gx = x - 0.5;
  const gy = y - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const k0 = Math.floor(z);
  const tx = gx - i0;
  const ty = gy - j0;
  const tz = z - k0;
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const k1 = k0 + 1;
  const a = fetchWRaw(w, nx, ny, nz, i0, j0, k0);
  const b = fetchWRaw(w, nx, ny, nz, i1, j0, k0);
  const c = fetchWRaw(w, nx, ny, nz, i0, j1, k0);
  const d = fetchWRaw(w, nx, ny, nz, i1, j1, k0);
  const e = fetchWRaw(w, nx, ny, nz, i0, j0, k1);
  const f = fetchWRaw(w, nx, ny, nz, i1, j0, k1);
  const g = fetchWRaw(w, nx, ny, nz, i0, j1, k1);
  const h = fetchWRaw(w, nx, ny, nz, i1, j1, k1);
  const x00 = a + (b - a) * tx;
  const x10 = c + (d - c) * tx;
  const x01 = e + (f - e) * tx;
  const x11 = g + (h - g) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/** 셀 중심 스칼라 삼선형 샘플. (x,y,z)는 셀 단위, 셀 중심이 (i+0.5, j+0.5, k+0.5). */
export function sampleStudioSmokeScalar(
  spec: StudioSmokeGridSpec,
  field: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  return sampleScalarRaw(field, spec.nx, spec.ny, spec.nz, packStudioSmokeBoundaryMask(spec.boundary), x, y, z);
}

/** u(=x면) 성분 샘플. u 면은 x 가 정수, y/z 가 셀 중심. */
export function sampleStudioSmokeU(
  spec: StudioSmokeGridSpec,
  u: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  return sampleURaw(u, spec.nx, spec.ny, spec.nz, x, y, z);
}

/** v(=y면) 성분 샘플. */
export function sampleStudioSmokeV(
  spec: StudioSmokeGridSpec,
  v: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  return sampleVRaw(v, spec.nx, spec.ny, spec.nz, x, y, z);
}

/** w(=z면) 성분 샘플. */
export function sampleStudioSmokeW(
  spec: StudioSmokeGridSpec,
  w: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  return sampleWRaw(w, spec.nx, spec.ny, spec.nz, x, y, z);
}

// ---------------------------------------------------------------------------
// CFL
// ---------------------------------------------------------------------------

/** max|성분| 기준 CFL = max(|u|,|v|,|w|)·dt/h. 1 을 넘으면 역추적이 한 셀 이상 건너뛴다. */
export function measureStudioSmokeCfl(state: StudioSmokeState, dt: number): number {
  const { spec, fields } = state;
  let maxSpeed = 0;
  for (let index = 0; index < fields.u.length; index += 1) {
    const abs = Math.abs(fields.u[index]);
    if (abs > maxSpeed) maxSpeed = abs;
  }
  for (let index = 0; index < fields.v.length; index += 1) {
    const abs = Math.abs(fields.v[index]);
    if (abs > maxSpeed) maxSpeed = abs;
  }
  for (let index = 0; index < fields.w.length; index += 1) {
    const abs = Math.abs(fields.w[index]);
    if (abs > maxSpeed) maxSpeed = abs;
  }
  return (maxSpeed * dt) / spec.h;
}

// 역추적 위치를 [-PAD, n+PAD] 로 가두고, 실제로 갇혔으면 카운트한다.
// 모듈 스코프 카운터지만 각 이류 함수 진입에서 0 으로 리셋하고 즉시 반환값으로 회수한다
// (단일 스레드·동기 실행이므로 결정성에 영향 없음).
let traceClampCount = 0;

function clampTrace(value: number, limit: number): number {
  const hi = limit + STUDIO_SMOKE_TRACE_PADDING;
  if (value < -STUDIO_SMOKE_TRACE_PADDING) {
    traceClampCount += 1;
    return -STUDIO_SMOKE_TRACE_PADDING;
  }
  if (value > hi) {
    traceClampCount += 1;
    return hi;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 이류(semi-Lagrangian)
// ---------------------------------------------------------------------------

/**
 * 셀 중심 스칼라 이류. src 를 읽어 dst 에 쓴다(별개 배열이어야 한다).
 * 반환값 = 역추적이 패딩 경계로 클램프된 횟수.
 *
 * 셀 중심에서의 속도는 삼선형 보간이 **정확히** 두 면의 선형보간(t=0.5)으로 축약되므로
 * 일반 샘플러 대신 2점 lerp 를 직접 쓴다 — 결과는 비트 단위로 동일하고(테스트가 강제)
 * 페치 24회가 6회로 줄어든다.
 */
export function advectStudioSmokeScalar(
  state: StudioSmokeState,
  src: Float32Array,
  dst: Float32Array,
  dt: number,
): number {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const openMask = packStudioSmokeBoundaryMask(spec.boundary);
  const invH = 1 / spec.h;
  const { u, v, w, solid } = fields;
  const uStrideY = nx + 1;
  traceClampCount = 0;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowCell = nx * (j + ny * k);
      const rowU = uStrideY * (j + ny * k);
      const rowV = nx * (j + (ny + 1) * k);
      const rowVNext = nx * (j + 1 + (ny + 1) * k);
      const rowW = nx * (j + ny * k);
      const rowWNext = nx * (j + ny * (k + 1));
      for (let i = 0; i < nx; i += 1) {
        const cell = rowCell + i;
        if (solid[cell] !== 0) {
          dst[cell] = 0;
          continue;
        }
        const u0v = u[rowU + i];
        const u1v = u[rowU + i + 1];
        const v0v = v[rowV + i];
        const v1v = v[rowVNext + i];
        const w0v = w[rowW + i];
        const w1v = w[rowWNext + i];
        const vx = u0v + (u1v - u0v) * 0.5;
        const vy = v0v + (v1v - v0v) * 0.5;
        const vz = w0v + (w1v - w0v) * 0.5;
        const px = clampTrace(i + 0.5 - dt * vx * invH, nx);
        const py = clampTrace(j + 0.5 - dt * vy * invH, ny);
        const pz = clampTrace(k + 0.5 - dt * vz * invH, nz);
        dst[cell] = sampleScalarRaw(src, nx, ny, nz, openMask, px, py, pz);
      }
    }
  }
  return traceClampCount;
}

/**
 * 면 속도 이류. u0/v0/w0 를 소스로 읽어 u/v/w 에 쓴다 —
 * 호출 전에 u0.set(u) 등이 되어 있어야 한다(stepStudioSmoke 가 대신 해준다).
 */
export function advectStudioSmokeVelocity(state: StudioSmokeState, dt: number): number {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const invH = 1 / spec.h;
  const { u0, v0, w0 } = fields;
  traceClampCount = 0;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const y = j + 0.5;
      const z = k + 0.5;
      const row = (nx + 1) * (j + ny * k);
      for (let i = 0; i <= nx; i += 1) {
        // u 면에서 u 성분 샘플은 tx=ty=tz=0 이라 직접 읽기와 비트 동일하다.
        const px = clampTrace(i - dt * u0[row + i] * invH, nx);
        const py = clampTrace(y - dt * sampleVRaw(v0, nx, ny, nz, i, y, z) * invH, ny);
        const pz = clampTrace(z - dt * sampleWRaw(w0, nx, ny, nz, i, y, z) * invH, nz);
        fields.u[row + i] = sampleURaw(u0, nx, ny, nz, px, py, pz);
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      const z = k + 0.5;
      const row = nx * (j + (ny + 1) * k);
      for (let i = 0; i < nx; i += 1) {
        const x = i + 0.5;
        const px = clampTrace(x - dt * sampleURaw(u0, nx, ny, nz, x, j, z) * invH, nx);
        const py = clampTrace(j - dt * v0[row + i] * invH, ny);
        const pz = clampTrace(z - dt * sampleWRaw(w0, nx, ny, nz, x, j, z) * invH, nz);
        fields.v[row + i] = sampleVRaw(v0, nx, ny, nz, px, py, pz);
      }
    }
  }
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const y = j + 0.5;
      const row = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const x = i + 0.5;
        const px = clampTrace(x - dt * sampleURaw(u0, nx, ny, nz, x, y, k) * invH, nx);
        const py = clampTrace(y - dt * sampleVRaw(v0, nx, ny, nz, x, y, k) * invH, ny);
        const pz = clampTrace(k - dt * w0[row + i] * invH, nz);
        fields.w[row + i] = sampleWRaw(w0, nx, ny, nz, px, py, pz);
      }
    }
  }
  return traceClampCount;
}

// ---------------------------------------------------------------------------
// 부력
// ---------------------------------------------------------------------------

/**
 * 부력을 v(세로) 면에 더한다. f = −α·density + β·(T − T_ambient), **+y 가 위**.
 * 도메인 최상/최하 면(j=0, j=ny)은 건드리지 않는다 — 경계 처리·투영의 몫이다.
 */
export function applyStudioSmokeBuoyancy(state: StudioSmokeState, params: StudioSmokeStepParams): void {
  const { spec, fields } = state;
  const { dt, buoyancyAlpha: alpha, buoyancyBeta: beta, ambientTemperature: ambient } = params;
  if (alpha === 0 && beta === 0) return;
  const nx = spec.nx;
  const ny = spec.ny;
  const { density, temperature, solid } = fields;
  for (let k = 0; k < spec.nz; k += 1) {
    for (let j = 1; j < ny; j += 1) {
      const rowBelow = nx * (j - 1 + ny * k);
      const rowAbove = nx * (j + ny * k);
      const rowV = nx * (j + (ny + 1) * k);
      for (let i = 0; i < nx; i += 1) {
        const below = rowBelow + i;
        const above = rowAbove + i;
        if (solid[below] !== 0 || solid[above] !== 0) continue;
        const d = 0.5 * (density[below] + density[above]);
        const t = 0.5 * (temperature[below] + temperature[above]);
        fields.v[rowV + i] += dt * (-alpha * d + beta * (t - ambient));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 와도 구속
// ---------------------------------------------------------------------------

function cellVelXRaw(u: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  const base = ii + (nx + 1) * (jj + ny * kk);
  return 0.5 * (u[base] + u[base + 1]);
}

function cellVelYRaw(v: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  const base = ii + nx * (jj + (ny + 1) * kk);
  return 0.5 * (v[base] + v[base + nx]);
}

function cellVelZRaw(w: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  const base = ii + nx * (jj + ny * kk);
  return 0.5 * (w[base] + w[base + nx * ny]);
}

/** ω = ∇×u 를 셀 중심에서 중심차분으로 계산해 curlX/Y/Z + curlMagnitude 에 채운다. */
export function computeStudioSmokeCurl(state: StudioSmokeState): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const inv2h = 1 / (2 * spec.h);
  const { u, v, w } = fields;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const row = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const cell = row + i;
        const dwdy = (cellVelZRaw(w, nx, ny, nz, i, j + 1, k) - cellVelZRaw(w, nx, ny, nz, i, j - 1, k)) * inv2h;
        const dvdz = (cellVelYRaw(v, nx, ny, nz, i, j, k + 1) - cellVelYRaw(v, nx, ny, nz, i, j, k - 1)) * inv2h;
        const dudz = (cellVelXRaw(u, nx, ny, nz, i, j, k + 1) - cellVelXRaw(u, nx, ny, nz, i, j, k - 1)) * inv2h;
        const dwdx = (cellVelZRaw(w, nx, ny, nz, i + 1, j, k) - cellVelZRaw(w, nx, ny, nz, i - 1, j, k)) * inv2h;
        const dvdx = (cellVelYRaw(v, nx, ny, nz, i + 1, j, k) - cellVelYRaw(v, nx, ny, nz, i - 1, j, k)) * inv2h;
        const dudy = (cellVelXRaw(u, nx, ny, nz, i, j + 1, k) - cellVelXRaw(u, nx, ny, nz, i, j - 1, k)) * inv2h;
        const wx = dwdy - dvdz;
        const wy = dudz - dwdx;
        const wz = dvdx - dudy;
        fields.curlX[cell] = wx;
        fields.curlY[cell] = wy;
        fields.curlZ[cell] = wz;
        fields.curlMagnitude[cell] = Math.sqrt(wx * wx + wy * wy + wz * wz);
      }
    }
  }
}

function magAtRaw(mag: Float32Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  return mag[ii + nx * (jj + ny * kk)];
}

/**
 * 와도 구속력 계산 — curlX/Y/Z 를 **제자리에서 힘 벡터로 덮어쓴다**(추가 버퍼 없음).
 * computeStudioSmokeCurl 이 먼저 돌아야 한다. 각 셀은 자기 ω 를 먼저 읽고 쓰므로
 * in-place 가 안전하고, 이웃은 curlMagnitude(불변)만 참조한다 — GPU 에서도 같은 이유로
 * 힘 계산과 면 적용이 **별개 디스패치**여야 한다(면 적용은 이웃의 힘을 읽는다).
 */
export function computeStudioSmokeVorticityForce(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const inv2h = 1 / (2 * spec.h);
  const scale = params.vorticityEpsilon * spec.h;
  const mag = fields.curlMagnitude;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const row = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const cell = row + i;
        const wx = fields.curlX[cell];
        const wy = fields.curlY[cell];
        const wz = fields.curlZ[cell];
        const gx = (magAtRaw(mag, nx, ny, nz, i + 1, j, k) - magAtRaw(mag, nx, ny, nz, i - 1, j, k)) * inv2h;
        const gy = (magAtRaw(mag, nx, ny, nz, i, j + 1, k) - magAtRaw(mag, nx, ny, nz, i, j - 1, k)) * inv2h;
        const gz = (magAtRaw(mag, nx, ny, nz, i, j, k + 1) - magAtRaw(mag, nx, ny, nz, i, j, k - 1)) * inv2h;
        const norm = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (norm <= 1e-12 || fields.solid[cell] !== 0) {
          fields.curlX[cell] = 0;
          fields.curlY[cell] = 0;
          fields.curlZ[cell] = 0;
          continue;
        }
        const ndx = gx / norm;
        const ndy = gy / norm;
        const ndz = gz / norm;
        // f = ε·h·(N × ω)
        fields.curlX[cell] = scale * (ndy * wz - ndz * wy);
        fields.curlY[cell] = scale * (ndz * wx - ndx * wz);
        fields.curlZ[cell] = scale * (ndx * wy - ndy * wx);
      }
    }
  }
}

/**
 * curlX/Y/Z 에 들어 있는 힘 벡터를 면에 평균해 속도에 더한다.
 * computeStudioSmokeVorticityForce 다음에 와야 한다(이웃 셀의 힘을 읽는다).
 */
export function applyStudioSmokeVorticityForceToFaces(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const dt = params.dt;
  const { solid, curlX, curlY, curlZ } = fields;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowCell = nx * (j + ny * k);
      const rowU = (nx + 1) * (j + ny * k);
      for (let i = 1; i < nx; i += 1) {
        const left = rowCell + i - 1;
        const right = rowCell + i;
        if (solid[left] !== 0 || solid[right] !== 0) continue;
        fields.u[rowU + i] += dt * 0.5 * (curlX[left] + curlX[right]);
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 1; j < ny; j += 1) {
      const rowBelow = nx * (j - 1 + ny * k);
      const rowAbove = nx * (j + ny * k);
      const rowV = nx * (j + (ny + 1) * k);
      for (let i = 0; i < nx; i += 1) {
        const below = rowBelow + i;
        const above = rowAbove + i;
        if (solid[below] !== 0 || solid[above] !== 0) continue;
        fields.v[rowV + i] += dt * 0.5 * (curlY[below] + curlY[above]);
      }
    }
  }
  for (let k = 1; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowBack = nx * (j + ny * (k - 1));
      const rowFront = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const back = rowBack + i;
        const front = rowFront + i;
        if (solid[back] !== 0 || solid[front] !== 0) continue;
        fields.w[rowFront + i] += dt * 0.5 * (curlZ[back] + curlZ[front]);
      }
    }
  }
}

/**
 * 와도 구속 전체(힘 계산 → 면 적용). computeStudioSmokeCurl 이 먼저 돌아야 한다.
 * ε=0 이면 아무것도 하지 않는다(항등).
 */
export function applyStudioSmokeVorticityConfinement(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
): void {
  if (params.vorticityEpsilon === 0) return;
  computeStudioSmokeVorticityForce(state, params);
  applyStudioSmokeVorticityForceToFaces(state, params);
}

// ---------------------------------------------------------------------------
// 경계
// ---------------------------------------------------------------------------

/**
 * 경계 적용:
 *  - solid 셀의 density/temperature/pressure = 0
 *  - solid 면(도메인 solid 경계 + solid 셀에 접한 면)의 법선 속도 = 0
 * open 면은 손대지 않는다(유출 허용).
 */
export function applyStudioSmokeBoundaries(state: StudioSmokeState): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const cells = studioSmokeCellCount(spec);
  const { solid } = fields;
  for (let cell = 0; cell < cells; cell += 1) {
    if (solid[cell] !== 0) {
      fields.density[cell] = 0;
      fields.temperature[cell] = 0;
      fields.pressure[cell] = 0;
    }
  }
  const xMinSolid = spec.boundary.xMin === "solid";
  const xMaxSolid = spec.boundary.xMax === "solid";
  const yMinSolid = spec.boundary.yMin === "solid";
  const yMaxSolid = spec.boundary.yMax === "solid";
  const zMinSolid = spec.boundary.zMin === "solid";
  const zMaxSolid = spec.boundary.zMax === "solid";

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowCell = nx * (j + ny * k);
      const rowU = (nx + 1) * (j + ny * k);
      for (let i = 0; i <= nx; i += 1) {
        const negSolid = i === 0 ? xMinSolid : solid[rowCell + i - 1] !== 0;
        const posSolid = i === nx ? xMaxSolid : solid[rowCell + i] !== 0;
        if (negSolid || posSolid) fields.u[rowU + i] = 0;
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      const rowV = nx * (j + (ny + 1) * k);
      const rowBelow = nx * (j - 1 + ny * k);
      const rowAbove = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const negSolid = j === 0 ? yMinSolid : solid[rowBelow + i] !== 0;
        const posSolid = j === ny ? yMaxSolid : solid[rowAbove + i] !== 0;
        if (negSolid || posSolid) fields.v[rowV + i] = 0;
      }
    }
  }
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowW = nx * (j + ny * k);
      const rowBack = nx * (j + ny * (k - 1));
      const rowFront = nx * (j + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const negSolid = k === 0 ? zMinSolid : solid[rowBack + i] !== 0;
        const posSolid = k === nz ? zMaxSolid : solid[rowFront + i] !== 0;
        if (negSolid || posSolid) fields.w[rowW + i] = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 압력 투영
// ---------------------------------------------------------------------------

/** D[c] = (Δu + Δv + Δw)/h. solid 셀은 0. fields.divergence 에 쓴다. */
export function computeStudioSmokeDivergence(state: StudioSmokeState): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const invH = 1 / spec.h;
  const { u, v, w, solid } = fields;
  for (let k = 0; k < spec.nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowCell = nx * (j + ny * k);
      const rowU = (nx + 1) * (j + ny * k);
      const rowV = nx * (j + (ny + 1) * k);
      const rowVNext = nx * (j + 1 + (ny + 1) * k);
      const rowW = nx * (j + ny * k);
      const rowWNext = nx * (j + ny * (k + 1));
      for (let i = 0; i < nx; i += 1) {
        const cell = rowCell + i;
        if (solid[cell] !== 0) {
          fields.divergence[cell] = 0;
          continue;
        }
        const du = u[rowU + i + 1] - u[rowU + i];
        const dv = v[rowVNext + i] - v[rowV + i];
        const dw = w[rowWNext + i] - w[rowW + i];
        fields.divergence[cell] = (du + dv + dw) * invH;
      }
    }
  }
}

/** 도메인에 Dirichlet(p=0) 조건이 하나라도 있는가 — 없으면 압력계가 특이(상수 자유도)다. */
export function hasStudioSmokeDirichlet(spec: StudioSmokeGridSpec): boolean {
  return packStudioSmokeBoundaryMask(spec.boundary) !== 0;
}

function jacobiSweep(
  spec: StudioSmokeGridSpec,
  solid: Uint8Array,
  divergence: Float32Array,
  src: Float32Array,
  dst: Float32Array,
  invScale: number,
): void {
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const strideZ = nx * ny;
  const openMask = packStudioSmokeBoundaryMask(spec.boundary);
  const xMinOpen = (openMask & OPEN_X_MIN) !== 0;
  const xMaxOpen = (openMask & OPEN_X_MAX) !== 0;
  const yMinOpen = (openMask & OPEN_Y_MIN) !== 0;
  const yMaxOpen = (openMask & OPEN_Y_MAX) !== 0;
  const zMinOpen = (openMask & OPEN_Z_MIN) !== 0;
  const zMaxOpen = (openMask & OPEN_Z_MAX) !== 0;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const row = nx * j + strideZ * k;
      for (let i = 0; i < nx; i += 1) {
        const cell = row + i;
        if (solid[cell] !== 0) {
          dst[cell] = 0;
          continue;
        }
        let sum = 0;
        let count = 0;
        if (i > 0) {
          const nb = cell - 1;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (xMinOpen) {
          count += 1;
        }
        if (i < nx - 1) {
          const nb = cell + 1;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (xMaxOpen) {
          count += 1;
        }
        if (j > 0) {
          const nb = cell - nx;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (yMinOpen) {
          count += 1;
        }
        if (j < ny - 1) {
          const nb = cell + nx;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (yMaxOpen) {
          count += 1;
        }
        if (k > 0) {
          const nb = cell - strideZ;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (zMinOpen) {
          count += 1;
        }
        if (k < nz - 1) {
          const nb = cell + strideZ;
          if (solid[nb] === 0) {
            sum += src[nb];
            count += 1;
          }
        } else if (zMaxOpen) {
          count += 1;
        }
        dst[cell] = count === 0 ? 0 : (sum - divergence[cell] * invScale) / count;
      }
    }
  }
}

/**
 * Jacobi 압력 solve. **warm start 없음** — 매 호출 p=0 에서 시작하므로 결과는
 * (divergence, spec, iterations, dt, h) 만의 함수다. 순수 Neumann(개구부 없음)일 때는
 * 해가 상수만큼 불정이라, 고정 순회 순서로 평균 압력을 빼서 대표해를 하나로 고정한다.
 */
export function solveStudioSmokePressureJacobi(state: StudioSmokeState, params: StudioSmokeStepParams): void {
  const { spec, fields } = state;
  const iterations = Math.max(0, Math.floor(params.pressureIterations));
  const invScale = (spec.h * spec.h) / params.dt;
  fields.pressure.fill(0);
  fields.pressure0.fill(0);

  let src = fields.pressure0;
  let dst = fields.pressure;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    jacobiSweep(spec, fields.solid, fields.divergence, src, dst, invScale);
    const swap = src;
    src = dst;
    dst = swap;
  }
  // 마지막 결과는 src 에 있다(스왑 이후). fields.pressure 가 아니면 옮겨 담는다.
  if (src !== fields.pressure) fields.pressure.set(src);

  if (!hasStudioSmokeDirichlet(spec)) {
    let sum = 0;
    let count = 0;
    for (let cell = 0; cell < fields.pressure.length; cell += 1) {
      if (fields.solid[cell] !== 0) continue;
      sum += fields.pressure[cell];
      count += 1;
    }
    if (count > 0) {
      const mean = sum / count;
      for (let cell = 0; cell < fields.pressure.length; cell += 1) {
        if (fields.solid[cell] !== 0) continue;
        fields.pressure[cell] -= mean;
      }
    }
  }
}

/** u ← u − (dt/ρ)·∇p/h. solid 면은 정확히 0, open 면은 바깥 압력 0 으로 보정한다. */
export function subtractStudioSmokePressureGradient(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
): void {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const scale = params.dt / spec.h;
  const pressure = fields.pressure;
  const solid = fields.solid;
  const openMask = packStudioSmokeBoundaryMask(spec.boundary);
  const xMinOpen = (openMask & OPEN_X_MIN) !== 0;
  const xMaxOpen = (openMask & OPEN_X_MAX) !== 0;
  const yMinOpen = (openMask & OPEN_Y_MIN) !== 0;
  const yMaxOpen = (openMask & OPEN_Y_MAX) !== 0;
  const zMinOpen = (openMask & OPEN_Z_MIN) !== 0;
  const zMaxOpen = (openMask & OPEN_Z_MAX) !== 0;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowCell = nx * (j + ny * k);
      const rowU = (nx + 1) * (j + ny * k);
      for (let i = 0; i <= nx; i += 1) {
        const face = rowU + i;
        if (i === 0) {
          const cell = rowCell;
          if (xMinOpen && solid[cell] === 0) fields.u[face] -= scale * pressure[cell];
          else fields.u[face] = 0;
        } else if (i === nx) {
          const cell = rowCell + nx - 1;
          if (xMaxOpen && solid[cell] === 0) fields.u[face] -= scale * (0 - pressure[cell]);
          else fields.u[face] = 0;
        } else {
          const left = rowCell + i - 1;
          const right = rowCell + i;
          if (solid[left] !== 0 || solid[right] !== 0) fields.u[face] = 0;
          else fields.u[face] -= scale * (pressure[right] - pressure[left]);
        }
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      const rowV = nx * (j + (ny + 1) * k);
      const rowBelow = nx * (j - 1 + ny * k);
      const rowAbove = nx * (j + ny * k);
      const rowFirst = nx * (0 + ny * k);
      const rowLast = nx * (ny - 1 + ny * k);
      for (let i = 0; i < nx; i += 1) {
        const face = rowV + i;
        if (j === 0) {
          const cell = rowFirst + i;
          if (yMinOpen && solid[cell] === 0) fields.v[face] -= scale * pressure[cell];
          else fields.v[face] = 0;
        } else if (j === ny) {
          const cell = rowLast + i;
          if (yMaxOpen && solid[cell] === 0) fields.v[face] -= scale * (0 - pressure[cell]);
          else fields.v[face] = 0;
        } else {
          const below = rowBelow + i;
          const above = rowAbove + i;
          if (solid[below] !== 0 || solid[above] !== 0) fields.v[face] = 0;
          else fields.v[face] -= scale * (pressure[above] - pressure[below]);
        }
      }
    }
  }
  const strideZ = nx * ny;
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const rowW = nx * j + strideZ * k;
      const rowBack = nx * j + strideZ * (k - 1);
      const rowFront = nx * j + strideZ * k;
      const rowFirst = nx * j;
      const rowLast = nx * j + strideZ * (nz - 1);
      for (let i = 0; i < nx; i += 1) {
        const face = rowW + i;
        if (k === 0) {
          const cell = rowFirst + i;
          if (zMinOpen && solid[cell] === 0) fields.w[face] -= scale * pressure[cell];
          else fields.w[face] = 0;
        } else if (k === nz) {
          const cell = rowLast + i;
          if (zMaxOpen && solid[cell] === 0) fields.w[face] -= scale * (0 - pressure[cell]);
          else fields.w[face] = 0;
        } else {
          const back = rowBack + i;
          const front = rowFront + i;
          if (solid[back] !== 0 || solid[front] !== 0) fields.w[face] = 0;
          else fields.w[face] -= scale * (pressure[front] - pressure[back]);
        }
      }
    }
  }
}

/**
 * 경계 적용 → 발산 계산 → Jacobi → 그라디언트 차감 → 경계 재적용.
 *
 * **맨 앞의 경계 적용은 생략하면 안 된다.** 압력 라플라시안은 solid 면을 스텐실에서
 * 빼는데(Neumann), 그 면의 속도가 0 이 아닌 상태로 발산을 재면 "보정할 수 없는 면이
 * 만든 발산"이 우변에 들어가 선형계가 **비정합(inconsistent)** 해진다. 그러면 Jacobi 를
 * 아무리 돌려도 잔차가 어떤 바닥값에서 멈춘다 — 실측으로 K=160 까지 올려도 잔차비가
 * 0.178 에서 정체했고, 이 한 줄을 앞에 놓자 같은 K 에서 0.017 로 떨어졌다.
 * 순서 자체가 수렴의 전제다.
 */
export function projectStudioSmoke(state: StudioSmokeState, params: StudioSmokeStepParams): void {
  applyStudioSmokeBoundaries(state);
  computeStudioSmokeDivergence(state);
  solveStudioSmokePressureJacobi(state, params);
  subtractStudioSmokePressureGradient(state, params);
  applyStudioSmokeBoundaries(state);
}

// ---------------------------------------------------------------------------
// 계측 헬퍼 — 전부 읽기 전용·고정 순회(리덕션 재정렬 금지)
// ---------------------------------------------------------------------------

/** 현재 속도장의 발산 RMS/L∞ 를 fields 를 건드리지 않고 측정한다. */
export function measureStudioSmokeDivergence(state: StudioSmokeState): StudioSmokeDivergenceMeasure {
  const { spec, fields } = state;
  const invH = 1 / spec.h;
  let sumSquares = 0;
  let linf = 0;
  let cells = 0;
  for (let k = 0; k < spec.nz; k += 1) {
    for (let j = 0; j < spec.ny; j += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        if (fields.solid[cell] !== 0) continue;
        const du = fields.u[studioSmokeUIndex(spec, i + 1, j, k)] - fields.u[studioSmokeUIndex(spec, i, j, k)];
        const dv = fields.v[studioSmokeVIndex(spec, i, j + 1, k)] - fields.v[studioSmokeVIndex(spec, i, j, k)];
        const dw = fields.w[studioSmokeWIndex(spec, i, j, k + 1)] - fields.w[studioSmokeWIndex(spec, i, j, k)];
        const div = (du + dv + dw) * invH;
        sumSquares += div * div;
        const abs = Math.abs(div);
        if (abs > linf) linf = abs;
        cells += 1;
      }
    }
  }
  return { rms: cells === 0 ? 0 : Math.sqrt(sumSquares / cells), linf, cells };
}

/** 총 밀도(질량 대용). fluid 셀만 합산한다. */
export function measureStudioSmokeMass(state: StudioSmokeState): number {
  const { fields } = state;
  let mass = 0;
  for (let cell = 0; cell < fields.density.length; cell += 1) {
    if (fields.solid[cell] !== 0) continue;
    mass += fields.density[cell];
  }
  return mass;
}

export interface StudioSmokeCentroid {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mass: number;
}

/** 밀도 무게중심(셀 단위 좌표). 질량 0 이면 전부 0 을 돌려준다. */
export function measureStudioSmokeDensityCentroid(state: StudioSmokeState): StudioSmokeCentroid {
  const { spec, fields } = state;
  let mass = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let k = 0; k < spec.nz; k += 1) {
    for (let j = 0; j < spec.ny; j += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        if (fields.solid[cell] !== 0) continue;
        const density = fields.density[cell];
        if (density === 0) continue;
        mass += density;
        mx += density * (i + 0.5);
        my += density * (j + 0.5);
        mz += density * (k + 0.5);
      }
    }
  }
  if (mass === 0) return { x: 0, y: 0, z: 0, mass: 0 };
  return { x: mx / mass, y: my / mass, z: mz / mass, mass };
}

/** 엔스트로피 Σ|ω|² — 와도 구속이 소용돌이를 실제로 살리는지 재는 지표. */
export function measureStudioSmokeEnstrophy(state: StudioSmokeState): number {
  const { spec, fields } = state;
  const nx = spec.nx;
  const ny = spec.ny;
  const nz = spec.nz;
  const inv2h = 1 / (2 * spec.h);
  const { u, v, w } = fields;
  let total = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (fields.solid[studioSmokeCellIndex(spec, i, j, k)] !== 0) continue;
        const wx =
          (cellVelZRaw(w, nx, ny, nz, i, j + 1, k) - cellVelZRaw(w, nx, ny, nz, i, j - 1, k)) * inv2h -
          (cellVelYRaw(v, nx, ny, nz, i, j, k + 1) - cellVelYRaw(v, nx, ny, nz, i, j, k - 1)) * inv2h;
        const wy =
          (cellVelXRaw(u, nx, ny, nz, i, j, k + 1) - cellVelXRaw(u, nx, ny, nz, i, j, k - 1)) * inv2h -
          (cellVelZRaw(w, nx, ny, nz, i + 1, j, k) - cellVelZRaw(w, nx, ny, nz, i - 1, j, k)) * inv2h;
        const wz =
          (cellVelYRaw(v, nx, ny, nz, i + 1, j, k) - cellVelYRaw(v, nx, ny, nz, i - 1, j, k)) * inv2h -
          (cellVelXRaw(u, nx, ny, nz, i, j + 1, k) - cellVelXRaw(u, nx, ny, nz, i, j - 1, k)) * inv2h;
        total += wx * wx + wy * wy + wz * wz;
      }
    }
  }
  return total;
}

/** fluid 셀 밀도 최대값 — 이류의 최대치 원리(볼록결합) 검증용. */
export function measureStudioSmokeMaxDensity(state: StudioSmokeState): number {
  const { fields } = state;
  let max = 0;
  for (let cell = 0; cell < fields.density.length; cell += 1) {
    if (fields.solid[cell] !== 0) continue;
    if (fields.density[cell] > max) max = fields.density[cell];
  }
  return max;
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

function applyDissipation(field: Float32Array, solid: Uint8Array, rate: number, dt: number): void {
  if (rate <= 0) return;
  const factor = Math.max(0, 1 - rate * dt);
  for (let cell = 0; cell < field.length; cell += 1) {
    if (solid[cell] !== 0) {
      field[cell] = 0;
      continue;
    }
    field[cell] *= factor;
  }
}

/**
 * 한 시뮬레이션 스텝. 이미터는 이 함수 **바깥**에서 먼저 주입해야 한다
 * (studio-smoke-emitter 의 advanceStudioSmokeFrame 이 그 조합을 제공한다).
 */
export function stepStudioSmoke(state: StudioSmokeState, params: StudioSmokeStepParams): StudioSmokeStepResult {
  const { fields } = state;
  const dt = params.dt;
  const maxCfl = measureStudioSmokeCfl(state, dt);
  const divergenceBefore = params.measureDivergence === true ? measureStudioSmokeDivergence(state) : null;

  fields.u0.set(fields.u);
  fields.v0.set(fields.v);
  fields.w0.set(fields.w);
  let clamped = advectStudioSmokeVelocity(state, dt);

  fields.density0.set(fields.density);
  clamped += advectStudioSmokeScalar(state, fields.density0, fields.density, dt);
  fields.temperature0.set(fields.temperature);
  clamped += advectStudioSmokeScalar(state, fields.temperature0, fields.temperature, dt);

  applyDissipation(fields.density, fields.solid, params.densityDissipation, dt);
  applyDissipation(fields.temperature, fields.solid, params.temperatureDissipation, dt);

  applyStudioSmokeBuoyancy(state, params);
  if (params.vorticityEpsilon !== 0) {
    computeStudioSmokeCurl(state);
    applyStudioSmokeVorticityConfinement(state, params);
  }
  // projectStudioSmoke 가 맨 앞에서 경계를 적용하므로 여기서 또 부르지 않는다.
  projectStudioSmoke(state, params);

  const divergenceAfter = params.measureDivergence === true ? measureStudioSmokeDivergence(state) : null;
  return {
    maxCfl,
    cflClamped: clamped > 0,
    clampedSamples: clamped,
    divergenceBefore,
    divergenceAfter,
  };
}

// ---------------------------------------------------------------------------
// 커널 레지스트리 — WGSL 포트와의 드리프트 가드가 이 키 집합을 대조한다
// ---------------------------------------------------------------------------

/**
 * 한 스텝을 이루는 커널의 정규(normative) 목록·**실행 순서**.
 * WGSL 포트(studio-smoke-wgsl)와 GPU 스텝 플래너(studio-smoke-gpu-solver)가
 * 이 배열과 정확히 같은 키·같은 순서를 재현해야 한다(계약 테스트가 강제).
 */
export const STUDIO_SMOKE_KERNEL_IDS = [
  "advect_velocity",
  "advect_scalar",
  "dissipate",
  "buoyancy",
  "curl",
  "vorticity_force",
  "vorticity_apply",
  "boundary",
  "divergence",
  "pressure_jacobi",
  "subtract_gradient",
] as const;

export type StudioSmokeKernelId = (typeof STUDIO_SMOKE_KERNEL_IDS)[number];

export type StudioSmokeCpuKernel = (state: StudioSmokeState, params: StudioSmokeStepParams) => void;

/** CPU 정규 구현 — GPU 포트가 미러링해야 할 대상. */
export const STUDIO_SMOKE_CPU_KERNELS: Record<StudioSmokeKernelId, StudioSmokeCpuKernel> = {
  advect_velocity: (state, params) => {
    state.fields.u0.set(state.fields.u);
    state.fields.v0.set(state.fields.v);
    state.fields.w0.set(state.fields.w);
    advectStudioSmokeVelocity(state, params.dt);
  },
  advect_scalar: (state, params) => {
    state.fields.density0.set(state.fields.density);
    advectStudioSmokeScalar(state, state.fields.density0, state.fields.density, params.dt);
    state.fields.temperature0.set(state.fields.temperature);
    advectStudioSmokeScalar(state, state.fields.temperature0, state.fields.temperature, params.dt);
  },
  dissipate: (state, params) => {
    applyDissipation(state.fields.density, state.fields.solid, params.densityDissipation, params.dt);
    applyDissipation(state.fields.temperature, state.fields.solid, params.temperatureDissipation, params.dt);
  },
  buoyancy: applyStudioSmokeBuoyancy,
  curl: (state) => computeStudioSmokeCurl(state),
  vorticity_force: computeStudioSmokeVorticityForce,
  vorticity_apply: applyStudioSmokeVorticityForceToFaces,
  boundary: (state) => applyStudioSmokeBoundaries(state),
  divergence: (state) => computeStudioSmokeDivergence(state),
  pressure_jacobi: solveStudioSmokePressureJacobi,
  subtract_gradient: subtractStudioSmokePressureGradient,
};
