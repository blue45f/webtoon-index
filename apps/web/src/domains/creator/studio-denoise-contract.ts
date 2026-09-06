/**
 * Studio Denoise — Monte-Carlo 렌더 출력 디노이저 입력 계약
 *
 * 이 파일은 **경로 추적기(path tracer)와 디노이저 사이의 유일한 결합점**이다.
 * 전부 평범한 typed array 이므로 GPU/CPU/워커 어디서 생성되든 그대로 넘길 수 있고,
 * 테스트에서는 GPU 없이 합성 버퍼로 재현할 수 있다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 버퍼 레이아웃 (전부 row-major, 원점 = 좌상단, 타이트 패킹, 패딩 없음)
 * ─────────────────────────────────────────────────────────────────────────────
 *   픽셀 인덱스      p = y * width + x            (0 ≤ x < width, 0 ≤ y < height)
 *   3채널 버퍼       buf[p * 3 + c],  c ∈ {0:R, 1:G, 2:B}   length = width*height*3
 *   1채널 버퍼       buf[p]                                  length = width*height
 *
 *   color   Float32Array(w*h*3)  선형 HDR 라디언스. **샘플 수로 이미 나눈 평균값**
 *                                (누적 합이 아니다). 알파/프리멀티플라이 없음. ≥ 0.
 *   albedo  Float32Array(w*h*3)  1차 히트 표면의 확산 알베도, [0,1]. 노이즈 없는
 *                                가이드여야 한다(= 텍스처 페치 값 그대로, 조명 제외).
 *   normal  Float32Array(w*h*3)  1차 히트 월드 공간 셰이딩 노멀, 단위벡터, [-1,1].
 *   depth   Float32Array(w*h)    1차 히트까지의 **선형 뷰 공간 거리**(카메라 원점 기준).
 *                                `<= 0` 또는 비유한 값 = 배경/미스 → 그 픽셀은 필터에서
 *                                제외되고 입력 색이 그대로 통과한다.
 *   sampleCount  number | Float32Array(w*h) | Uint32Array(w*h)
 *                                해당 픽셀 값이 **몇 개의 독립 추정치를 평균한 것인지**.
 *                                단일 프레임이면 spp, 시간 누적을 거쳤다면 누적 프레임 수
 *                                (studio-denoise-temporal 이 historyLength 를 그대로 넣는다).
 *                                momentLuma/2 와 짝을 이룰 때 반드시 그 모멘트가 굴려진
 *                                횟수와 같아야 분산이 "평균의 분산"으로 맞는다.
 *                                스칼라면 전 픽셀 공통.
 *   momentLuma / momentLuma2  Float32Array(w*h)  (선택)
 *                                시간 누적(studio-denoise-temporal)이 만든 휘도 1·2차
 *                                모멘트. 주어지면 공간 추정 대신 이 값으로 분산을 만든다.
 *
 * 미스 픽셀 규약: albedo=0, normal=(0,0,0), depth=0 을 쓰면 된다. 디노이저가 알아서
 * "유효하지 않음"으로 분류한다(정규화 실패 노멀도 마찬가지).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 최소 계약: color + width/height 만 있어도 동작한다(가이드가 없으면 분산만으로
 * 안내되는 à-trous 로 자연스럽게 열화). 가이드를 줄수록 엣지 보존이 좋아진다.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── 경로 추적기 통합 레시피 ─────────────────────────────────────────────────
 *  A. 정적 프로그레시브(카메라 고정, 샘플만 누적) — 가장 단순하고 권장 경로
 *     1. 매 프레임 누적 평균 color 와 1차 히트 가이드를 채워 StudioDenoiseFrame 을 만든다.
 *        (가이드는 첫 프레임에 한 번만 만들면 된다 — 카메라가 안 움직이니 변하지 않는다.)
 *     2. sampleCount 에 지금까지의 총 spp 를 넣는다.
 *     3. 표시 직전에만 `denoiseStudioFrame(frame)` 호출(또는 `denoiseStudioFrameOnGpu`).
 *        누적 버퍼 자체는 절대 디노이즈 결과로 덮어쓰지 않는다 — 디노이즈는 표시 전용
 *        후처리이고, 되먹이면 반복마다 과도하게 뭉개진다.
 *
 *  B. 인터랙티브(카메라가 움직임)
 *     1. 프레임마다 studio-denoise-temporal 의 `accumulateStudioDenoiseTemporal` 로 누적.
 *        모션이 있으면 `reprojection: Int32Array` 를 채워 넘긴다(모션벡터→정수 인덱스 변환은
 *        추적기 책임). 잔상이 신경쓰이면 `minAlpha: 0.2`.
 *     2. 그 결과 `.frame` 을 그대로 `denoiseStudioFrame` 에 넣는다(모멘트가 이미 채워져 있어
 *        공간 분산 추정보다 정확한 분산 가이드가 쓰인다).
 *
 *  C. GPU 고속 경로
 *     `denoiseStudioFrameOnGpu(frame, { runtime })` 가 **null** 을 돌려주면 선택한 GPU 작업은
 *     unavailable이다. 그 프레임은 마지막 정상 결과를 유지하고, CPU 참조 경로는 다음 작업
 *     전에 명시 선택해야 한다. 런타임은 프레임마다 재획득하지 말고
 *     `acquireStudioDenoiseGpuRuntime()` 결과를 보관해 재사용한다.
 *
 *  D. 적응 샘플링 되먹임(선택)
 *     결과의 `varianceInput` 이 큰 픽셀에 다음 프레임 샘플을 더 던지면 수렴이 빨라진다.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 계약 버전 — 레이아웃이 바뀌면 올린다(경로 추적기 쪽 어댑터가 검사할 수 있게). */
export const STUDIO_DENOISE_CONTRACT_VERSION = 1;

/** color/albedo/normal 버퍼의 채널 수. */
export const STUDIO_DENOISE_COLOR_CHANNELS = 3;

/** 내부 signal/guide 버퍼의 vec4 스트라이드 (WGSL `array<vec4<f32>>` 와 동일). */
export const STUDIO_DENOISE_VEC4_STRIDE = 4;

/** 경로 추적기가 넘기는 한 프레임의 원시 출력. */
export interface StudioDenoiseFrame {
  readonly width: number;
  readonly height: number;
  /** 선형 HDR 라디언스 평균, w*h*3. */
  readonly color: Float32Array;
  /** 1차 히트 알베도 가이드, w*h*3. 생략 시 알베도 디모듈레이션이 꺼진다. */
  readonly albedo?: Float32Array;
  /** 1차 히트 월드 노멀 가이드, w*h*3. */
  readonly normal?: Float32Array;
  /** 1차 히트 선형 뷰 깊이, w*h. `<= 0` = 배경. */
  readonly depth?: Float32Array;
  /** 누적 spp (스칼라 또는 픽셀별). */
  readonly sampleCount?: number | Float32Array | Uint32Array;
  /** 휘도 1차 모멘트 E[L], w*h. momentLuma2 와 쌍으로만 유효. */
  readonly momentLuma?: Float32Array;
  /** 휘도 2차 모멘트 E[L²], w*h. */
  readonly momentLuma2?: Float32Array;
}

export interface StudioDenoiseIssue {
  readonly code: string;
  readonly message: string;
}

/** 구조적으로 쓸 수 없는 입력(길이 불일치 등)에서만 던진다. 수치적 degenerate 는 던지지 않는다. */
export class StudioDenoiseInputError extends Error {
  readonly issues: readonly StudioDenoiseIssue[];

  constructor(issues: readonly StudioDenoiseIssue[]) {
    super(`studio-denoise: 잘못된 입력 프레임 — ${issues.map((i) => i.code).join(", ")}`);
    this.name = "StudioDenoiseInputError";
    this.issues = issues;
  }
}

/** Rec.709 상대 휘도. */
export function studioDenoiseLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * 구조 검증. 빈 배열이면 `sanitizeStudioDenoiseFrame` 이 안전하게 동작한다.
 * NaN/Inf/0 spp 같은 수치적 degenerate 는 여기서 걸러지지 않는다(정규화 단계가 흡수).
 */
export function validateStudioDenoiseFrame(frame: StudioDenoiseFrame): StudioDenoiseIssue[] {
  const issues: StudioDenoiseIssue[] = [];
  const { width, height } = frame;

  if (!isNonNegativeInteger(width) || !isNonNegativeInteger(height)) {
    issues.push({
      code: "dimensions",
      message: `width/height 는 0 이상의 정수여야 한다 (받은 값: ${String(width)}x${String(height)})`,
    });
    return issues;
  }

  const pixels = width * height;
  const rgbLength = pixels * STUDIO_DENOISE_COLOR_CHANNELS;

  const expectRgb = (name: string, buffer: Float32Array | undefined): void => {
    if (buffer && buffer.length !== rgbLength) {
      issues.push({
        code: `${name}-length`,
        message: `${name} 길이는 width*height*3 (=${rgbLength}) 여야 한다 (받은 값: ${buffer.length})`,
      });
    }
  };
  const expectScalarField = (
    name: string,
    buffer: Float32Array | Uint32Array | undefined,
  ): void => {
    if (buffer && buffer.length !== pixels) {
      issues.push({
        code: `${name}-length`,
        message: `${name} 길이는 width*height (=${pixels}) 여야 한다 (받은 값: ${buffer.length})`,
      });
    }
  };

  if (!(frame.color instanceof Float32Array)) {
    issues.push({ code: "color-type", message: "color 는 Float32Array 여야 한다" });
  } else if (frame.color.length !== rgbLength) {
    issues.push({
      code: "color-length",
      message: `color 길이는 width*height*3 (=${rgbLength}) 여야 한다 (받은 값: ${frame.color.length})`,
    });
  }

  expectRgb("albedo", frame.albedo);
  expectRgb("normal", frame.normal);
  expectScalarField("depth", frame.depth);
  expectScalarField("momentLuma", frame.momentLuma);
  expectScalarField("momentLuma2", frame.momentLuma2);

  // 스칼라 sampleCount 의 NaN/음수는 구조 오류가 아니라 수치적 degenerate 다 —
  // 정규화 단계에서 0(=정보 없음)으로 흡수하고 여기서는 길이만 본다.
  const spp = frame.sampleCount;
  if (typeof spp !== "number" && spp) {
    expectScalarField("sampleCount", spp);
  }

  if ((frame.momentLuma && !frame.momentLuma2) || (!frame.momentLuma && frame.momentLuma2)) {
    issues.push({
      code: "moments-pair",
      message: "momentLuma 와 momentLuma2 는 반드시 함께 제공해야 한다",
    });
  }

  return issues;
}

/** 정규화·복구된 프레임. 모든 버퍼가 유한하고 길이가 맞으며 즉시 필터링 가능하다. */
export interface StudioDenoiseSanitizedFrame {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  /** 유한·비음수로 복구된 선형 HDR 색. */
  readonly color: Float32Array;
  /** [0,1] 로 클램프된 알베도. 알베도 미제공 시 전부 1. */
  readonly albedo: Float32Array;
  /** 단위 길이 노멀. 복구 불가 시 (0,0,1). */
  readonly normal: Float32Array;
  /** 유한·비음수 깊이. 깊이 미제공 시 전부 1. */
  readonly depth: Float32Array;
  /** 1 = 셰이딩된 표면, 0 = 배경/미스(필터 제외, 원본 통과). */
  readonly valid: Uint8Array;
  /** 픽셀별 spp (≥ 0). */
  readonly sampleCount: Float32Array;
  /** 모멘트로부터 만든 평균의 분산. 모멘트 미제공 시 null. */
  readonly momentVariance: Float32Array | null;
  /** 입력에 알베도 가이드가 실제로 있었는지 (디모듈레이션 가능 여부). */
  readonly hasAlbedo: boolean;
  readonly hasNormal: boolean;
  readonly hasDepth: boolean;
  /** 복구 통계 — 경로 추적기 버그(NaN 누출 등) 조기 발견용. */
  readonly repairs: StudioDenoiseRepairStats;
}

export interface StudioDenoiseRepairStats {
  /** NaN/Inf 를 0 으로 바꾼 색 성분 개수. */
  readonly nonFiniteColor: number;
  /** 음수를 0 으로 클램프한 색 성분 개수. */
  readonly negativeColor: number;
  /** 길이 0 이라 (0,0,1) 로 대체한 노멀 개수. */
  readonly degenerateNormal: number;
  /** 비유한/비양수라 배경으로 분류한 깊이 개수. */
  readonly invalidDepth: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * 입력을 필터가 신뢰할 수 있는 형태로 정규화한다.
 * 구조 오류(길이 불일치)만 던지고, 수치적 쓰레기(NaN/Inf/음수/영벡터 노멀/0 spp)는
 * 전부 흡수한다 — 경로 추적기가 초기 프레임에서 그런 값을 내보내도 죽지 않아야 한다.
 */
export function sanitizeStudioDenoiseFrame(
  frame: StudioDenoiseFrame,
): StudioDenoiseSanitizedFrame {
  const issues = validateStudioDenoiseFrame(frame);
  if (issues.length > 0) throw new StudioDenoiseInputError(issues);

  const width = frame.width;
  const height = frame.height;
  const pixelCount = width * height;
  const rgbLength = pixelCount * STUDIO_DENOISE_COLOR_CHANNELS;

  const color = new Float32Array(rgbLength);
  const albedo = new Float32Array(rgbLength);
  const normal = new Float32Array(rgbLength);
  const depth = new Float32Array(pixelCount);
  const valid = new Uint8Array(pixelCount);
  const sampleCount = new Float32Array(pixelCount);

  let nonFiniteColor = 0;
  let negativeColor = 0;
  let degenerateNormal = 0;
  let invalidDepth = 0;

  const srcColor = frame.color;
  for (let i = 0; i < rgbLength; i += 1) {
    const raw = srcColor[i];
    if (!Number.isFinite(raw)) {
      nonFiniteColor += 1;
      color[i] = 0;
      continue;
    }
    if (raw < 0) {
      negativeColor += 1;
      color[i] = 0;
      continue;
    }
    color[i] = raw;
  }

  const hasAlbedo = !!frame.albedo;
  if (frame.albedo) {
    const src = frame.albedo;
    for (let i = 0; i < rgbLength; i += 1) {
      const raw = finiteOrZero(src[i]);
      albedo[i] = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    }
  } else {
    albedo.fill(1);
  }

  const hasNormal = !!frame.normal;
  if (frame.normal) {
    const src = frame.normal;
    for (let p = 0; p < pixelCount; p += 1) {
      const base = p * 3;
      const nx = finiteOrZero(src[base]);
      const ny = finiteOrZero(src[base + 1]);
      const nz = finiteOrZero(src[base + 2]);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-8) {
        normal[base] = nx / len;
        normal[base + 1] = ny / len;
        normal[base + 2] = nz / len;
      } else {
        degenerateNormal += 1;
        normal[base] = 0;
        normal[base + 1] = 0;
        normal[base + 2] = 1;
      }
    }
  } else {
    for (let p = 0; p < pixelCount; p += 1) normal[p * 3 + 2] = 1;
  }

  const hasDepth = !!frame.depth;
  if (frame.depth) {
    const src = frame.depth;
    for (let p = 0; p < pixelCount; p += 1) {
      const raw = src[p];
      if (Number.isFinite(raw) && raw > 0) {
        depth[p] = raw;
        valid[p] = 1;
      } else {
        invalidDepth += 1;
        depth[p] = 0;
        valid[p] = 0;
      }
    }
  } else {
    depth.fill(1);
    valid.fill(1);
  }

  const spp = frame.sampleCount;
  if (typeof spp === "number") {
    const v = Number.isFinite(spp) && spp > 0 ? spp : 0;
    sampleCount.fill(v);
  } else if (spp) {
    for (let p = 0; p < pixelCount; p += 1) {
      const v = spp[p];
      sampleCount[p] = Number.isFinite(v) && v > 0 ? v : 0;
    }
  } else {
    sampleCount.fill(1);
  }

  let momentVariance: Float32Array | null = null;
  const m1 = frame.momentLuma;
  const m2 = frame.momentLuma2;
  if (m1 && m2) {
    momentVariance = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p += 1) {
      const a = finiteOrZero(m1[p]);
      const b = finiteOrZero(m2[p]);
      // 표본 분산 → 평균의 분산은 spp 로 나눈다. spp 0 은 "정보 없음"이라 1 로 취급.
      const sampleVariance = Math.max(0, b - a * a);
      momentVariance[p] = sampleVariance / Math.max(1, sampleCount[p]);
    }
  }

  return {
    width,
    height,
    pixelCount,
    color,
    albedo,
    normal,
    depth,
    valid,
    sampleCount,
    momentVariance,
    hasAlbedo,
    hasNormal,
    hasDepth,
    repairs: { nonFiniteColor, negativeColor, degenerateNormal, invalidDepth },
  };
}

/** HDR 필터 도메인. 자세한 근거는 studio-denoise-atrous.ts 헤더 참고. */
export type StudioDenoiseHdrDomain = "linear" | "log1p";

export interface StudioDenoiseFireflyOptions {
  readonly enabled?: boolean;
  /** 이웃 평균 + sigmas*표준편차 를 상한으로 쓴다. */
  readonly sigmas?: number;
  /** 이웃 평균 대비 최소 배율 — 이보다 낮으면 아무리 통계적으로 튀어도 건드리지 않는다. */
  readonly minRatio?: number;
  /** 절대 휘도 하한 — 거의 검은 영역의 미세 요동을 파이어플라이로 오인하지 않게. */
  readonly minLuminance?: number;
  /** 이웃 반경(픽셀). 1 = 3x3. */
  readonly radius?: number;
}

export interface StudioDenoiseOptions {
  /** à-trous 반복 수. 레벨 i 의 stepwidth 는 2^i. */
  readonly levels?: number;
  /** 휘도 엣지 스토핑 σ_l. */
  readonly sigmaLuma?: number;
  /** 노멀 엣지 스토핑 지수 σ_n (`max(0,dot)^σ_n`). */
  readonly sigmaNormal?: number;
  /** 깊이 엣지 스토핑 σ_z (깊이 기울기 배수). */
  readonly sigmaDepth?: number;
  /** 알베도 엣지 스토핑 σ_a (L1 거리 스케일). */
  readonly sigmaAlbedo?: number;
  /** 휘도 가중치 분모의 하한 — 완전 수렴 영역에서 0 분모를 막는다. */
  readonly epsLuma?: number;
  /** 깊이 가중치의 상대 허용 오차(중심 깊이 대비). */
  readonly depthEpsilon?: number;
  /** 알베도로 조명을 분리(디모듈레이션)한 뒤 필터링할지. */
  readonly demodulateAlbedo?: boolean;
  /** 디모듈레이션 시 알베도 하한 — 0 알베도에서 폭발 방지. */
  readonly albedoFloor?: number;
  /** 필터 도메인. */
  readonly hdrDomain?: StudioDenoiseHdrDomain;
  readonly firefly?: StudioDenoiseFireflyOptions;
  /** 휘도(분산) 엣지 스토핑 사용 여부. false 면 순수 기하 가이드 필터가 된다. */
  readonly useLuminanceWeight?: boolean;
  /** 공간 분산 추정 창 반경. 2 = 5x5. */
  readonly varianceRadius?: number;
  /** spp 변조 기준값 — 이 spp 에서 스케일 1. */
  readonly sampleCountReference?: number;
  /** spp 변조 클램프 [min,max]. */
  readonly sampleCountScaleRange?: readonly [number, number];
}

export interface StudioDenoiseResolvedOptions {
  readonly levels: number;
  readonly sigmaLuma: number;
  readonly sigmaNormal: number;
  readonly sigmaDepth: number;
  readonly sigmaAlbedo: number;
  readonly epsLuma: number;
  readonly depthEpsilon: number;
  readonly demodulateAlbedo: boolean;
  readonly albedoFloor: number;
  readonly hdrDomain: StudioDenoiseHdrDomain;
  readonly fireflyEnabled: boolean;
  readonly fireflySigmas: number;
  readonly fireflyMinRatio: number;
  readonly fireflyMinLuminance: number;
  readonly fireflyRadius: number;
  readonly useLuminanceWeight: boolean;
  readonly varianceRadius: number;
  readonly sampleCountReference: number;
  readonly sampleCountScaleMin: number;
  readonly sampleCountScaleMax: number;
}

export const STUDIO_DENOISE_DEFAULT_OPTIONS: StudioDenoiseResolvedOptions = {
  levels: 5,
  sigmaLuma: 4,
  sigmaNormal: 64,
  sigmaDepth: 1,
  sigmaAlbedo: 0.25,
  epsLuma: 1e-6,
  depthEpsilon: 0.01,
  demodulateAlbedo: true,
  albedoFloor: 0.02,
  hdrDomain: "log1p",
  fireflyEnabled: true,
  fireflySigmas: 3,
  // 3.0 은 측정으로 고른 값이다. 2.0 이면 σ_rel≈0.35 의 정상 노이즈에서 2% 픽셀이 오탐되어
  // 깨끗한 씬 RMSE 가 4.7% 나빠지는 반면, 3.0 은 오탐 0.1% (RMSE 비용 0.4%) 이면서 실제
  // 파이어플라이 제거 성능은 동일했다.
  fireflyMinRatio: 3,
  fireflyMinLuminance: 1e-4,
  fireflyRadius: 1,
  useLuminanceWeight: true,
  varianceRadius: 2,
  sampleCountReference: 16,
  sampleCountScaleMin: 0.25,
  sampleCountScaleMax: 4,
};

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function integerInRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 옵션 정규화 — CPU/GPU 경로가 완전히 같은 상수를 쓰도록 단일 진입점으로 둔다. */
export function resolveStudioDenoiseOptions(
  options?: StudioDenoiseOptions,
): StudioDenoiseResolvedOptions {
  const d = STUDIO_DENOISE_DEFAULT_OPTIONS;
  if (!options) return d;
  const firefly = options.firefly;
  const range = options.sampleCountScaleRange;
  const scaleMin = positive(range?.[0], d.sampleCountScaleMin);
  const scaleMax = positive(range?.[1], d.sampleCountScaleMax);
  return {
    levels: integerInRange(options.levels, d.levels, 0, 12),
    sigmaLuma: positive(options.sigmaLuma, d.sigmaLuma),
    sigmaNormal: positive(options.sigmaNormal, d.sigmaNormal),
    sigmaDepth: positive(options.sigmaDepth, d.sigmaDepth),
    sigmaAlbedo: positive(options.sigmaAlbedo, d.sigmaAlbedo),
    epsLuma: positive(options.epsLuma, d.epsLuma),
    depthEpsilon: positive(options.depthEpsilon, d.depthEpsilon),
    demodulateAlbedo: options.demodulateAlbedo ?? d.demodulateAlbedo,
    albedoFloor: positive(options.albedoFloor, d.albedoFloor),
    hdrDomain: options.hdrDomain === "linear" ? "linear" : d.hdrDomain,
    fireflyEnabled: firefly?.enabled ?? d.fireflyEnabled,
    fireflySigmas: nonNegative(firefly?.sigmas, d.fireflySigmas),
    fireflyMinRatio: positive(firefly?.minRatio, d.fireflyMinRatio),
    fireflyMinLuminance: nonNegative(firefly?.minLuminance, d.fireflyMinLuminance),
    fireflyRadius: integerInRange(firefly?.radius, d.fireflyRadius, 1, 4),
    useLuminanceWeight: options.useLuminanceWeight ?? d.useLuminanceWeight,
    varianceRadius: integerInRange(options.varianceRadius, d.varianceRadius, 0, 6),
    sampleCountReference: positive(options.sampleCountReference, d.sampleCountReference),
    sampleCountScaleMin: Math.min(scaleMin, scaleMax),
    sampleCountScaleMax: Math.max(scaleMin, scaleMax),
  };
}

export interface StudioDenoiseStats {
  /** 파이어플라이로 판정되어 클램프된 픽셀 수. */
  readonly fireflyClamped: number;
  /** 실제로 필터링된(유효) 픽셀 수. */
  readonly filteredPixels: number;
  /** 배경/미스로 통과된 픽셀 수. */
  readonly passthroughPixels: number;
  readonly levels: number;
  readonly repairs: StudioDenoiseRepairStats;
  /** 필터가 실행된 경로. */
  readonly backend: "cpu" | "gpu";
}

export interface StudioDenoiseResult {
  readonly width: number;
  readonly height: number;
  /** 디노이즈된 선형 HDR 색, w*h*3. 입력과 같은 레이아웃. */
  readonly color: Float32Array;
  /**
   * 필터 후 가이드 분산(필터 도메인, spp 변조 포함), w*h.
   * 디버그 오버레이/적응 샘플링 재투입용.
   */
  readonly variance: Float32Array;
  /** 필터 전 가이드 분산(같은 스케일) — 수렴도 판정에 쓴다. */
  readonly varianceInput: Float32Array;
  readonly stats: StudioDenoiseStats;
}
