/**
 * Studio Smoke Render — 밀도/온도 볼륨을 2D 래스터로 굽는 정사영 레이마처
 *
 * ## 알고리즘
 * 카메라는 **정사영**이고 −z 에서 +z 를 본다. 출력 픽셀 하나가 격자의 (x, y) 한 지점을 잡고,
 * z=0 → z=nz 로 front-to-back 행진하며 Beer–Lambert 감쇠를 누적한다:
 *
 *   a  = 1 − exp(−σ · density · Δz · h)        (구간 흡수율)
 *   rgb += T · a · color,  alpha += T · a,  T *= (1 − a)
 *
 * color 는 "산란(밝은 연기)" + "방출(뜨거운 코어)" 두 항의 합이다:
 *   color = smokeColor · scatter · L  +  hotColor · emission · clamp01((T_cell − t0)/(t1 − t0))
 * 여기서 L 은 옵션 그림자 항(아래 참고), 없으면 1.
 *
 * 결과는 **premultiplied RGBA** 다 — Σw = alpha 이고 각 구간 color ≤ 255 이므로
 * 항상 `r,g,b ≤ round(alpha·255)` 가 성립한다(테스트가 전 픽셀에서 강제).
 * 출력 타입은 스튜디오 40여 개 필터가 공유하는 `StudioImageDataLike` 그대로다.
 *
 * ## 그림자 (shadowStrength > 0)
 * **단일 방향(+y, 위에서 아래) 1패스 근사**다. 셀 위에 쌓인 밀도의 누적 흡수만 보고
 * L[i,j,k] = L[i,j+1,k] · exp(−shadowStrength · h · density[i,j+1,k]) 를 위→아래로 쓸어담는다.
 * 다중 산란도, 임의 광원 방향도, 그림자 맵 재투영도 없다 — 연기 덩어리에 "위가 밝고
 * 아래가 어둡다"는 최소한의 입체감을 주는 용도다.
 *
 * ## 정직한 한계
 *  - 정사영 전용(원근 카메라·렌즈 없음), 회전 불가(항상 +z 를 향한 축정렬 뷰).
 *  - 단일 산란·단일 광원 방향, 위상함수(Henyey-Greenstein) 없음.
 *  - 볼륨 조명 계산이 CPU 한 방향 스윕이라 물리적 렌더러가 아니다.
 *  - 스텝이 균일 간격이라 얇은 고밀도 층은 samplesPerCell 을 올려야 제대로 잡힌다.
 *  - GPU 레이마치 경로 없음(이 서브시스템 범위 밖).
 *
 * 전부 순수·결정적. DOM/canvas 의존 없음 — node 테스트가 그대로 픽셀을 검사한다.
 */

import { studioSmokeCellIndex } from "./studio-smoke-grid";

import type { StudioImageDataLike } from "./studio-filters";
import type { StudioSmokeGridSpec, StudioSmokeState } from "./studio-smoke-grid";

export type StudioSmokeRgb = readonly [number, number, number];

export interface StudioSmokeRenderOptions {
  readonly width: number;
  readonly height: number;
  /** 셀 하나를 몇 번 샘플할지(≥1). 클수록 정확·느림. */
  readonly samplesPerCell?: number;
  /** 흡수 계수 σ. 클수록 진한 연기. */
  readonly absorption?: number;
  /** 산란(연기 밝기) 게인 0..1+. */
  readonly scatter?: number;
  /** 방출(뜨거운 코어) 게인 0..1+. */
  readonly emission?: number;
  readonly smokeColor?: StudioSmokeRgb;
  readonly hotColor?: StudioSmokeRgb;
  /** 방출 램프 구간 [t0, t1] — 온도가 t0 이하면 0, t1 이상이면 1. */
  readonly temperatureRange?: readonly [number, number];
  /** 0 이면 그림자 끔. >0 이면 위→아래 1패스 자기그림자. */
  readonly shadowStrength?: number;
  /** 1..4 — 픽셀당 √N×√N 서브샘플. */
  readonly supersample?: number;
}

export interface StudioSmokeRenderDefaults {
  readonly samplesPerCell: number;
  readonly absorption: number;
  readonly scatter: number;
  readonly emission: number;
  readonly smokeColor: StudioSmokeRgb;
  readonly hotColor: StudioSmokeRgb;
  readonly temperatureRange: readonly [number, number];
  readonly shadowStrength: number;
  readonly supersample: number;
}

export const DEFAULT_STUDIO_SMOKE_RENDER: StudioSmokeRenderDefaults = {
  samplesPerCell: 1,
  absorption: 1,
  scatter: 0.85,
  emission: 1,
  smokeColor: [232, 232, 238],
  hotColor: [255, 176, 92],
  temperatureRange: [0.2, 2],
  shadowStrength: 0,
  supersample: 1,
};

export const STUDIO_SMOKE_ABSORPTION_RANGE = { min: 0, max: 20, step: 0.1 } as const;
export const STUDIO_SMOKE_SCATTER_RANGE = { min: 0, max: 2, step: 0.05 } as const;
export const STUDIO_SMOKE_EMISSION_RANGE = { min: 0, max: 4, step: 0.05 } as const;
export const STUDIO_SMOKE_SHADOW_RANGE = { min: 0, max: 8, step: 0.1 } as const;
export const STUDIO_SMOKE_SUPERSAMPLE_RANGE = { min: 1, max: 4, step: 1 } as const;
export const STUDIO_SMOKE_SAMPLES_PER_CELL_RANGE = { min: 1, max: 8, step: 1 } as const;

/** 광선 투과율이 이 아래로 떨어지면 남은 구간을 건너뛴다(고정 상수 ⇒ 결정적). */
export const STUDIO_SMOKE_TRANSMITTANCE_CUTOFF = 1e-4;

function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function normalizeRgb(raw: unknown, fallback: StudioSmokeRgb): StudioSmokeRgb {
  if (!Array.isArray(raw)) return fallback;
  return [
    clampTo(raw[0], 0, 255, fallback[0]),
    clampTo(raw[1], 0, 255, fallback[1]),
    clampTo(raw[2], 0, 255, fallback[2]),
  ];
}

interface ResolvedRenderOptions extends StudioSmokeRenderDefaults {
  readonly width: number;
  readonly height: number;
}

/** 렌더 옵션 정규화 — 범위 클램프 + 비유한값 방어. width/height 는 1 이상 정수. */
export function normalizeStudioSmokeRenderOptions(options: StudioSmokeRenderOptions): ResolvedRenderOptions {
  const t = Array.isArray(options.temperatureRange) ? options.temperatureRange : undefined;
  const t0 = clampTo(t?.[0], -1e4, 1e4, DEFAULT_STUDIO_SMOKE_RENDER.temperatureRange[0]);
  const t1raw = clampTo(t?.[1], -1e4, 1e4, DEFAULT_STUDIO_SMOKE_RENDER.temperatureRange[1]);
  return {
    width: Math.max(1, Math.floor(clampTo(options.width, 1, 8192, 1))),
    height: Math.max(1, Math.floor(clampTo(options.height, 1, 8192, 1))),
    samplesPerCell: Math.round(
      clampTo(
        options.samplesPerCell,
        STUDIO_SMOKE_SAMPLES_PER_CELL_RANGE.min,
        STUDIO_SMOKE_SAMPLES_PER_CELL_RANGE.max,
        DEFAULT_STUDIO_SMOKE_RENDER.samplesPerCell,
      ),
    ),
    absorption: clampTo(
      options.absorption,
      STUDIO_SMOKE_ABSORPTION_RANGE.min,
      STUDIO_SMOKE_ABSORPTION_RANGE.max,
      DEFAULT_STUDIO_SMOKE_RENDER.absorption,
    ),
    scatter: clampTo(
      options.scatter,
      STUDIO_SMOKE_SCATTER_RANGE.min,
      STUDIO_SMOKE_SCATTER_RANGE.max,
      DEFAULT_STUDIO_SMOKE_RENDER.scatter,
    ),
    emission: clampTo(
      options.emission,
      STUDIO_SMOKE_EMISSION_RANGE.min,
      STUDIO_SMOKE_EMISSION_RANGE.max,
      DEFAULT_STUDIO_SMOKE_RENDER.emission,
    ),
    smokeColor: normalizeRgb(options.smokeColor, DEFAULT_STUDIO_SMOKE_RENDER.smokeColor),
    hotColor: normalizeRgb(options.hotColor, DEFAULT_STUDIO_SMOKE_RENDER.hotColor),
    // t1 은 t0 보다 반드시 커야 램프가 성립한다(같으면 0 나눗셈).
    temperatureRange: [t0, t1raw > t0 ? t1raw : t0 + 1e-6],
    shadowStrength: clampTo(
      options.shadowStrength,
      STUDIO_SMOKE_SHADOW_RANGE.min,
      STUDIO_SMOKE_SHADOW_RANGE.max,
      DEFAULT_STUDIO_SMOKE_RENDER.shadowStrength,
    ),
    supersample: Math.round(
      clampTo(
        options.supersample,
        STUDIO_SMOKE_SUPERSAMPLE_RANGE.min,
        STUDIO_SMOKE_SUPERSAMPLE_RANGE.max,
        DEFAULT_STUDIO_SMOKE_RENDER.supersample,
      ),
    ),
  };
}

// 렌더 전용 페치 — 도메인 밖은 **항상 0**(경계 모드와 무관). 벽 너머로 값을 반사하면
// 상자 바깥에 없는 연기가 비쳐 보인다.
function fetchRender(spec: StudioSmokeGridSpec, field: Float32Array, i: number, j: number, k: number): number {
  if (i < 0 || i >= spec.nx || j < 0 || j >= spec.ny || k < 0 || k >= spec.nz) return 0;
  return field[i + spec.nx * (j + spec.ny * k)];
}

function sampleRender(
  spec: StudioSmokeGridSpec,
  field: Float32Array,
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
  const x00 =
    fetchRender(spec, field, i0, j0, k0) +
    (fetchRender(spec, field, i1, j0, k0) - fetchRender(spec, field, i0, j0, k0)) * tx;
  const x10 =
    fetchRender(spec, field, i0, j1, k0) +
    (fetchRender(spec, field, i1, j1, k0) - fetchRender(spec, field, i0, j1, k0)) * tx;
  const x01 =
    fetchRender(spec, field, i0, j0, k1) +
    (fetchRender(spec, field, i1, j0, k1) - fetchRender(spec, field, i0, j0, k1)) * tx;
  const x11 =
    fetchRender(spec, field, i0, j1, k1) +
    (fetchRender(spec, field, i1, j1, k1) - fetchRender(spec, field, i0, j1, k1)) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * 위(+y)에서 내려오는 빛의 셀별 투과율 L∈(0,1]. 최상단 층은 1 이고,
 * 아래로 내려가며 바로 위 셀의 밀도만큼 지수 감쇠한다(1패스 근사).
 */
export function computeStudioSmokeShadowField(state: StudioSmokeState, shadowStrength: number): Float32Array {
  const { spec, fields } = state;
  const light = new Float32Array(spec.nx * spec.ny * spec.nz);
  for (let k = 0; k < spec.nz; k += 1) {
    for (let i = 0; i < spec.nx; i += 1) {
      let transmittance = 1;
      for (let j = spec.ny - 1; j >= 0; j -= 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        light[cell] = transmittance;
        transmittance *= Math.exp(-shadowStrength * spec.h * fields.density[cell]);
      }
    }
  }
  return light;
}

/**
 * 볼륨을 정사영으로 레이마치해 premultiplied RGBA 래스터를 만든다.
 * 이미지 좌표는 왼쪽 위가 원점이고 **위쪽이 격자의 +y** 다(연기가 위로 뜨는 화면 방향).
 */
export function renderStudioSmokeVolume(
  state: StudioSmokeState,
  options: StudioSmokeRenderOptions,
): StudioImageDataLike {
  const { spec, fields } = state;
  const resolved = normalizeStudioSmokeRenderOptions(options);
  const { width, height, supersample } = resolved;
  const data = new Uint8ClampedArray(width * height * 4);

  const light = resolved.shadowStrength > 0 ? computeStudioSmokeShadowField(state, resolved.shadowStrength) : null;
  const stepZ = 1 / resolved.samplesPerCell;
  const stepWorld = stepZ * spec.h;
  const steps = spec.nz * resolved.samplesPerCell;
  const [t0, t1] = resolved.temperatureRange;
  const invTemperatureSpan = 1 / (t1 - t0);
  const [smokeR, smokeG, smokeB] = resolved.smokeColor;
  const [hotR, hotG, hotB] = resolved.hotColor;
  const subCount = supersample * supersample;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const fx = (px + (sx + 0.5) / supersample) / width;
          const fy = (py + (sy + 0.5) / supersample) / height;
          const gx = fx * spec.nx;
          // 화면 위쪽 = 격자 +y 이므로 세로를 뒤집는다.
          const gy = (1 - fy) * spec.ny;

          let transmittance = 1;
          let rayR = 0;
          let rayG = 0;
          let rayB = 0;
          let rayA = 0;

          for (let s = 0; s < steps; s += 1) {
            if (transmittance < STUDIO_SMOKE_TRANSMITTANCE_CUTOFF) break;
            const gz = (s + 0.5) * stepZ;
            const density = sampleRender(spec, fields.density, gx, gy, gz);
            if (density <= 0) continue;
            const absorbed = 1 - Math.exp(-resolved.absorption * density * stepWorld);
            if (absorbed <= 0) continue;
            const temperature = sampleRender(spec, fields.temperature, gx, gy, gz);
            let heat = (temperature - t0) * invTemperatureSpan;
            heat = heat < 0 ? 0 : heat > 1 ? 1 : heat;
            const lit = light === null ? 1 : sampleRender(spec, light, gx, gy, gz);
            const scatterGain = resolved.scatter * lit;
            const emitGain = resolved.emission * heat;
            let colR = smokeR * scatterGain + hotR * emitGain;
            let colG = smokeG * scatterGain + hotG * emitGain;
            let colB = smokeB * scatterGain + hotB * emitGain;
            colR = colR > 255 ? 255 : colR;
            colG = colG > 255 ? 255 : colG;
            colB = colB > 255 ? 255 : colB;
            const weight = transmittance * absorbed;
            rayR += weight * colR;
            rayG += weight * colG;
            rayB += weight * colB;
            rayA += weight;
            transmittance *= 1 - absorbed;
          }

          accR += rayR;
          accG += rayG;
          accB += rayB;
          accA += rayA;
        }
      }

      const index = (py * width + px) * 4;
      data[index] = accR / subCount;
      data[index + 1] = accG / subCount;
      data[index + 2] = accB / subCount;
      data[index + 3] = (accA / subCount) * 255;
    }
  }

  return { data, width, height };
}
