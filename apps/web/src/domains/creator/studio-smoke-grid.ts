/**
 * Studio Smoke Grid — 유체·연기(Eulerian smoke) MAC 격자
 *
 * ## 무엇인가
 * 3D staggered MAC(Marker-And-Cell) 격자의 스펙·인덱서·필드 할당·solid 마스크를 담당한다.
 * 솔버(studio-smoke-core)와 렌더러(studio-smoke-render), WGSL 포트(studio-smoke-wgsl)가
 * 전부 이 모듈의 좌표 규약을 공유한다.
 *
 * ## 좌표 규약 (전 모듈 공통, 절대 어기지 말 것)
 *  - 격자 좌표 단위는 "셀"이다. 셀 (i,j,k)의 **중심**은 (i+0.5, j+0.5, k+0.5).
 *  - 스칼라(밀도·온도·압력·발산·와도)는 셀 중심에 산다 — 길이 nx·ny·nz.
 *  - 속도는 **면(face)** 에 산다:
 *      u : x면, 좌표 x=i (i=0..nx), y=j+0.5, z=k+0.5 → 길이 (nx+1)·ny·nz
 *      v : y면, 좌표 y=j (j=0..ny) → 길이 nx·(ny+1)·nz
 *      w : z면, 좌표 z=k (k=0..nz) → 길이 nx·ny·(nz+1)
 *  - **+y 가 위(up)** 다. 부력은 +y 로 뜬다.
 *  - h 는 셀 한 변의 월드 길이. 속도는 월드단위/초, dt 는 초.
 *
 * ## 왜 collocated 가 아니라 staggered 인가
 * collocated(모든 값을 셀 중심에) 격자의 중심차분 발산/압력 라플라시안은 서로 수반(adjoint)이
 * 아니라 압력 체커보드 모드를 만든다. 그 모드는 **같은 중심차분 발산 측정기에 보이지 않는다** —
 * 즉 "투영 후 발산이 줄었다"는 테스트가 스스로를 속인다. MAC 은 발산 스텐실과 압력
 * 라플라시안이 정확히 수반이라 투영이 실제로 잔차를 죽이고 측정이 정직해진다.
 *
 * ## 메모리 (estimateStudioSmokeMemoryBytes 가 계산하는 실제 값)
 * 셀당 f32 필드 11개(density·density0·temperature·temperature0·pressure·pressure0·
 * divergence·curlX·curlY·curlZ·curlMagnitude) + Uint8 solid 1개 = 45 B/cell,
 * 면 f32 6개(u,u0,v,v0,w,w0) = 24 B/face-cell. 정육면체 N³ 이면 **69·N³ + 24·N² 바이트**.
 *
 * | 해상도 | 셀 수     | 메모리      | CPU 1스텝     | 용도                    |
 * |--------|-----------|-------------|---------------|-------------------------|
 * | 32³    |    32,768 |   2.18 MiB  |  33.1 ms (실측) | 워커 저해상도 미리보기  |
 * | 48³    |   110,592 |   7.33 MiB  | 109.1 ms (실측) | 표준 베이크(기본값)     |
 * | 64³    |   262,144 |  17.34 MiB  | 252.9 ms (실측) | 고품질 베이크           |
 * | 96³    |   884,736 |  58.43 MiB  | 미측정(초 단위) | 오프라인 전용(opt-in)   |
 * | 128³   | 2,097,152 | 138.38 MiB  | 미측정(수 초)   | 오프라인 상한(opt-in)   |
 *
 * 메모리는 **계산값이 아니라 실제 할당량**이고 위 공식과 정확히 일치한다(테스트가 대조).
 * 1스텝 시간은 이 머신(Darwin arm64, node/V8 단일 스레드, Jacobi 40회 · 와도 ε=8)에서 잰
 * 실측이며 다른 기기의 보장이 아니다. 96³/128³ 은 실제로 재지 않았으므로 "미측정"으로
 * 둔다 — 추세 외삽을 실측인 척 적지 않는다.
 *
 * ## 오프라인 게이트
 * 64³(262,144셀) 초과는 `allowOffline: true` 를 명시해야 만들어진다. 워커 오프로드가 아직
 * 이 서브시스템 범위 밖이라, 96³ 이상을 UI 프리셋에 그냥 노출하면 메인 스레드가 200ms 넘게
 * 멈춘다. 128³(STUDIO_SMOKE_MAX_CELLS) 초과는 어떤 플래그로도 허용하지 않는다.
 *
 * ## 정직한 한계
 * 고정 밀집(dense) 격자다 — 희소/적응(VDB, adaptive octree) 격자가 아니라서 빈 공간도
 * 똑같이 메모리와 계산을 먹는다. 비정방(nx≠ny≠nz) 은 지원하지만 비등방 셀(hx≠hy≠hz)은
 * 지원하지 않는다(h 는 스칼라 하나).
 *
 * Konva/DOM/React 의존 없음 — node 테스트가 그대로 돌린다. 전부 순수·결정적.
 */

// ---------------------------------------------------------------------------
// 경계 모드
// ---------------------------------------------------------------------------

/**
 * 도메인 바깥면 처리:
 *  - "solid": 벽. 법선 속도 0(Neumann), 스칼라는 벽 너머를 자기 값으로 반사(질량 보존).
 *  - "open" : 유출구. 압력 Dirichlet p=0, 스칼라는 바깥을 0 으로 본다(질량이 빠져나간다).
 */
export type StudioSmokeBoundaryMode = "solid" | "open";

export interface StudioSmokeBoundaryModes {
  readonly xMin: StudioSmokeBoundaryMode;
  readonly xMax: StudioSmokeBoundaryMode;
  readonly yMin: StudioSmokeBoundaryMode;
  readonly yMax: StudioSmokeBoundaryMode;
  readonly zMin: StudioSmokeBoundaryMode;
  readonly zMax: StudioSmokeBoundaryMode;
}

/** 전면 폐쇄 상자 — 질량 보존 테스트의 기준 조건. */
export const STUDIO_SMOKE_CLOSED_BOUNDARY: StudioSmokeBoundaryModes = {
  xMin: "solid",
  xMax: "solid",
  yMin: "solid",
  yMax: "solid",
  zMin: "solid",
  zMax: "solid",
};

/** 연기 기둥 기본값 — 바닥/옆은 벽, 위만 열림(연기가 화면 위로 빠져나간다). */
export const STUDIO_SMOKE_CHIMNEY_BOUNDARY: StudioSmokeBoundaryModes = {
  ...STUDIO_SMOKE_CLOSED_BOUNDARY,
  yMax: "open",
};

/** 경계 모드 6면을 고정 순서로 나열 — WGSL 비트마스크 패킹과 순서가 같아야 한다. */
export const STUDIO_SMOKE_BOUNDARY_FACES = ["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"] as const;

export type StudioSmokeBoundaryFace = (typeof STUDIO_SMOKE_BOUNDARY_FACES)[number];

/** open 면을 비트마스크로 — 비트 순서는 STUDIO_SMOKE_BOUNDARY_FACES 와 동일. */
export function packStudioSmokeBoundaryMask(boundary: StudioSmokeBoundaryModes): number {
  let mask = 0;
  for (let bit = 0; bit < STUDIO_SMOKE_BOUNDARY_FACES.length; bit += 1) {
    if (boundary[STUDIO_SMOKE_BOUNDARY_FACES[bit]] === "open") mask |= 1 << bit;
  }
  return mask >>> 0;
}

// ---------------------------------------------------------------------------
// 격자 스펙
// ---------------------------------------------------------------------------

export interface StudioSmokeGridSpec {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** 셀 한 변의 월드 길이(>0). 등방(isotropic)만 지원한다. */
  readonly h: number;
  readonly boundary: StudioSmokeBoundaryModes;
}

export interface StudioSmokeGridSpecOptions {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly h?: number;
  readonly boundary?: StudioSmokeBoundaryModes;
  /** 64³ 초과 해상도를 만들 때 반드시 true — 오프라인 베이크 전용 게이트. */
  readonly allowOffline?: boolean;
}

/** 워커 없이 상호작용 가능한 상한(64³). 초과하면 allowOffline 이 필요하다. */
export const STUDIO_SMOKE_INTERACTIVE_MAX_CELLS = 64 * 64 * 64;
/** 절대 상한(128³). 어떤 플래그로도 넘을 수 없다. */
export const STUDIO_SMOKE_MAX_CELLS = 128 * 128 * 128;
/** 축당 최소 셀 수 — 중심차분 와도/그라디언트가 의미를 가지려면 2 이상이어야 한다. */
export const STUDIO_SMOKE_MIN_AXIS = 2;

function assertAxis(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < STUDIO_SMOKE_MIN_AXIS) {
    throw new RangeError(`studio-smoke: ${name} 는 ${STUDIO_SMOKE_MIN_AXIS} 이상의 정수여야 한다(받은 값: ${value})`);
  }
  return value;
}

/** 격자 스펙 생성 — 축/셀크기/셀수 상한을 전부 검증한다(무음 클램프 없음). */
export function createStudioSmokeGridSpec(options: StudioSmokeGridSpecOptions): StudioSmokeGridSpec {
  const nx = assertAxis(options.nx, "nx");
  const ny = assertAxis(options.ny, "ny");
  const nz = assertAxis(options.nz, "nz");
  const h = options.h ?? 1;
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError(`studio-smoke: h 는 0 보다 큰 유한값이어야 한다(받은 값: ${h})`);
  }
  const cells = nx * ny * nz;
  if (cells > STUDIO_SMOKE_MAX_CELLS) {
    throw new RangeError(
      `studio-smoke: 셀 수 ${cells} 가 절대 상한 ${STUDIO_SMOKE_MAX_CELLS}(128³)를 넘었다 — 허용하지 않는다`,
    );
  }
  if (cells > STUDIO_SMOKE_INTERACTIVE_MAX_CELLS && options.allowOffline !== true) {
    throw new RangeError(
      `studio-smoke: 셀 수 ${cells} 는 오프라인 전용(> ${STUDIO_SMOKE_INTERACTIVE_MAX_CELLS}) — allowOffline: true 가 필요하다`,
    );
  }
  return { nx, ny, nz, h, boundary: options.boundary ?? STUDIO_SMOKE_CHIMNEY_BOUNDARY };
}

// ---------------------------------------------------------------------------
// 인덱서 — 전부 인라인 가능한 순수 산술
// ---------------------------------------------------------------------------

export function studioSmokeCellCount(spec: StudioSmokeGridSpec): number {
  return spec.nx * spec.ny * spec.nz;
}
export function studioSmokeUCount(spec: StudioSmokeGridSpec): number {
  return (spec.nx + 1) * spec.ny * spec.nz;
}
export function studioSmokeVCount(spec: StudioSmokeGridSpec): number {
  return spec.nx * (spec.ny + 1) * spec.nz;
}
export function studioSmokeWCount(spec: StudioSmokeGridSpec): number {
  return spec.nx * spec.ny * (spec.nz + 1);
}

/** 셀 중심 인덱스. i∈[0,nx), j∈[0,ny), k∈[0,nz) — 범위 검사는 호출부 책임(핫패스). */
export function studioSmokeCellIndex(spec: StudioSmokeGridSpec, i: number, j: number, k: number): number {
  return i + spec.nx * (j + spec.ny * k);
}
/** u 면 인덱스. i∈[0,nx]. */
export function studioSmokeUIndex(spec: StudioSmokeGridSpec, i: number, j: number, k: number): number {
  return i + (spec.nx + 1) * (j + spec.ny * k);
}
/** v 면 인덱스. j∈[0,ny]. */
export function studioSmokeVIndex(spec: StudioSmokeGridSpec, i: number, j: number, k: number): number {
  return i + spec.nx * (j + (spec.ny + 1) * k);
}
/** w 면 인덱스. k∈[0,nz]. */
export function studioSmokeWIndex(spec: StudioSmokeGridSpec, i: number, j: number, k: number): number {
  return i + spec.nx * (j + spec.ny * k);
}

// ---------------------------------------------------------------------------
// 필드
// ---------------------------------------------------------------------------

export interface StudioSmokeFields {
  /** x 면 속도(현재) — (nx+1)·ny·nz */
  readonly u: Float32Array;
  /** x 면 속도(이류 소스 복사본) */
  readonly u0: Float32Array;
  readonly v: Float32Array;
  readonly v0: Float32Array;
  readonly w: Float32Array;
  readonly w0: Float32Array;
  readonly density: Float32Array;
  readonly density0: Float32Array;
  readonly temperature: Float32Array;
  readonly temperature0: Float32Array;
  readonly pressure: Float32Array;
  readonly pressure0: Float32Array;
  readonly divergence: Float32Array;
  readonly curlX: Float32Array;
  readonly curlY: Float32Array;
  readonly curlZ: Float32Array;
  readonly curlMagnitude: Float32Array;
  /** 1 = solid(장애물), 0 = fluid. 셀 중심 해상도. */
  readonly solid: Uint8Array;
}

export interface StudioSmokeState {
  readonly spec: StudioSmokeGridSpec;
  readonly fields: StudioSmokeFields;
}

/** 셀당 f32 필드 개수(11) — 메모리 추정과 문서 표의 단일 출처. */
export const STUDIO_SMOKE_CELL_FLOAT_FIELDS = 11;
/** 면 f32 필드 개수(6) = u,u0,v,v0,w,w0. */
export const STUDIO_SMOKE_FACE_FLOAT_FIELDS = 6;

/**
 * 필드 전체가 차지하는 바이트 — 실제 할당과 정확히 일치한다(추정이 아니라 계산).
 * 정육면체 N³ 이면 69·N³ + 24·N².
 */
export function estimateStudioSmokeMemoryBytes(spec: StudioSmokeGridSpec): number {
  const cells = studioSmokeCellCount(spec);
  const faces = studioSmokeUCount(spec) + studioSmokeVCount(spec) + studioSmokeWCount(spec);
  return cells * (STUDIO_SMOKE_CELL_FLOAT_FIELDS * 4 + 1) + faces * 2 * 4;
}

export function createStudioSmokeFields(spec: StudioSmokeGridSpec): StudioSmokeFields {
  const cells = studioSmokeCellCount(spec);
  const uCount = studioSmokeUCount(spec);
  const vCount = studioSmokeVCount(spec);
  const wCount = studioSmokeWCount(spec);
  return {
    u: new Float32Array(uCount),
    u0: new Float32Array(uCount),
    v: new Float32Array(vCount),
    v0: new Float32Array(vCount),
    w: new Float32Array(wCount),
    w0: new Float32Array(wCount),
    density: new Float32Array(cells),
    density0: new Float32Array(cells),
    temperature: new Float32Array(cells),
    temperature0: new Float32Array(cells),
    pressure: new Float32Array(cells),
    pressure0: new Float32Array(cells),
    divergence: new Float32Array(cells),
    curlX: new Float32Array(cells),
    curlY: new Float32Array(cells),
    curlZ: new Float32Array(cells),
    curlMagnitude: new Float32Array(cells),
    solid: new Uint8Array(cells),
  };
}

export function createStudioSmokeState(options: StudioSmokeGridSpecOptions): StudioSmokeState {
  const spec = createStudioSmokeGridSpec(options);
  return { spec, fields: createStudioSmokeFields(spec) };
}

/** solid 마스크를 제외한 전 필드를 0 으로 — 같은 격자를 재사용해 재현 실행할 때 쓴다. */
export function resetStudioSmokeFields(fields: StudioSmokeFields): void {
  fields.u.fill(0);
  fields.u0.fill(0);
  fields.v.fill(0);
  fields.v0.fill(0);
  fields.w.fill(0);
  fields.w0.fill(0);
  fields.density.fill(0);
  fields.density0.fill(0);
  fields.temperature.fill(0);
  fields.temperature0.fill(0);
  fields.pressure.fill(0);
  fields.pressure0.fill(0);
  fields.divergence.fill(0);
  fields.curlX.fill(0);
  fields.curlY.fill(0);
  fields.curlZ.fill(0);
  fields.curlMagnitude.fill(0);
}

// ---------------------------------------------------------------------------
// solid 마스크 빌더 — 전부 셀 단위(부분 점유 없음). 결정적.
// ---------------------------------------------------------------------------

export interface StudioSmokeBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** 축정렬 박스 안의 셀을 solid(또는 solid=false 로 지정 시 fluid)로. 좌표는 셀 단위. */
export function fillStudioSmokeSolidBox(
  state: StudioSmokeState,
  box: StudioSmokeBox,
  solid = true,
): number {
  const { spec, fields } = state;
  const value = solid ? 1 : 0;
  const i0 = Math.max(0, Math.ceil(box.minX - 0.5));
  const i1 = Math.min(spec.nx - 1, Math.floor(box.maxX - 0.5));
  const j0 = Math.max(0, Math.ceil(box.minY - 0.5));
  const j1 = Math.min(spec.ny - 1, Math.floor(box.maxY - 0.5));
  const k0 = Math.max(0, Math.ceil(box.minZ - 0.5));
  const k1 = Math.min(spec.nz - 1, Math.floor(box.maxZ - 0.5));
  let touched = 0;
  for (let k = k0; k <= k1; k += 1) {
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        fields.solid[studioSmokeCellIndex(spec, i, j, k)] = value;
        touched += 1;
      }
    }
  }
  return touched;
}

/** 구 안의 셀(중심 거리 ≤ radius)을 solid 로. 좌표·반지름은 셀 단위. */
export function fillStudioSmokeSolidSphere(
  state: StudioSmokeState,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  solid = true,
): number {
  const { spec, fields } = state;
  const value = solid ? 1 : 0;
  const r2 = radius * radius;
  let touched = 0;
  for (let k = 0; k < spec.nz; k += 1) {
    const dz = k + 0.5 - cz;
    for (let j = 0; j < spec.ny; j += 1) {
      const dy = j + 0.5 - cy;
      for (let i = 0; i < spec.nx; i += 1) {
        const dx = i + 0.5 - cx;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          fields.solid[studioSmokeCellIndex(spec, i, j, k)] = value;
          touched += 1;
        }
      }
    }
  }
  return touched;
}

export type StudioSmokeAxis = "x" | "y" | "z";

/**
 * 축에 수직인 평면 슬래브(두께 thickness 셀)를 solid 로 — 바닥판/칸막이용.
 * `from` 은 슬래브 시작 좌표(셀 단위).
 */
export function fillStudioSmokeSolidSlab(
  state: StudioSmokeState,
  axis: StudioSmokeAxis,
  from: number,
  thickness: number,
  solid = true,
): number {
  const { spec } = state;
  const to = from + Math.max(0, thickness);
  const box: StudioSmokeBox =
    axis === "x"
      ? { minX: from, maxX: to, minY: 0, maxY: spec.ny, minZ: 0, maxZ: spec.nz }
      : axis === "y"
        ? { minX: 0, maxX: spec.nx, minY: from, maxY: to, minZ: 0, maxZ: spec.nz }
        : { minX: 0, maxX: spec.nx, minY: 0, maxY: spec.ny, minZ: from, maxZ: to };
  return fillStudioSmokeSolidBox(state, box, solid);
}

/** solid 셀 개수 — 마스크 빌더 검증·경계 테스트에서 쓴다. */
export function countStudioSmokeSolidCells(state: StudioSmokeState): number {
  let count = 0;
  for (let index = 0; index < state.fields.solid.length; index += 1) {
    if (state.fields.solid[index] !== 0) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 해상도 프리셋
// ---------------------------------------------------------------------------

export interface StudioSmokeResolutionPreset {
  readonly id: string;
  readonly label: string;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** true 면 createStudioSmokeGridSpec 에 allowOffline 이 필요하다(UI 프리셋에 노출 금지). */
  readonly offline: boolean;
}

/**
 * 해상도 프리셋 — offline: true 는 워커 오프로드가 붙기 전까지 UI 에 노출하지 않는다.
 * ny 를 x/z 보다 크게 잡은 "기둥" 프리셋이 웹툰 연기에는 더 쓸모 있어 별도로 둔다.
 */
export const STUDIO_SMOKE_RESOLUTIONS: readonly StudioSmokeResolutionPreset[] = [
  { id: "draft", label: "초안 32³", nx: 32, ny: 32, nz: 32, offline: false },
  { id: "standard", label: "표준 48³", nx: 48, ny: 48, nz: 48, offline: false },
  { id: "column", label: "기둥 32×64×32", nx: 32, ny: 64, nz: 32, offline: false },
  { id: "high", label: "고품질 64³", nx: 64, ny: 64, nz: 64, offline: false },
  { id: "offline96", label: "오프라인 96³", nx: 96, ny: 96, nz: 96, offline: true },
  { id: "offline128", label: "오프라인 128³", nx: 128, ny: 128, nz: 128, offline: true },
];
