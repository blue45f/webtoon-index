/**
 * Studio Denoise — 결정적 합성 씬 하니스(정답 있는 검증용)
 *
 * 디노이저 품질은 "돌아갔다"가 아니라 **정답 대비 오차가 실제로 줄었는가**로만 증명할 수
 * 있다. 그러려면 ground truth 를 아는 장면이 필요하다. 이 모듈은 GPU 없이, 난수 시드만으로
 * 완전히 재현되는 경로 추적기 출력 흉내를 만든다.
 *
 * 노이즈 모델은 곱셈형 로그정규 — 실제 몬테카를로 추정치처럼 항상 양수이고 꼬리가 두꺼우며
 * 기댓값이 정답과 같다(불편):
 *     noisy = gt * exp(σ·g - σ²/2),  g ~ N(0,1)
 * σ 는 상대 노이즈 강도이며 spp 가 늘면 1/sqrt(spp) 로 줄어드는 것을 흉내낸다.
 *
 * 이 하니스는 경로 추적기 쪽에서도 디노이저 통합 회귀를 돌릴 때 그대로 재사용할 수 있다
 * (평범한 typed array 만 다루므로 브라우저/노드 어디서든 동작).
 */

import { STUDIO_DENOISE_COLOR_CHANNELS, type StudioDenoiseFrame } from "./studio-denoise-contract";

/** mulberry32 — 32bit 시드 PRNG. 결정적이고 플랫폼 독립적이다. */
export function createStudioDenoiseRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller 표준정규 샘플러(결정적). */
export function createStudioDenoiseGaussian(seed: number): () => number {
  const random = createStudioDenoiseRandom(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const u1 = Math.max(random(), 1e-12);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export interface StudioDenoiseSceneOptions {
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  /** 픽셀당 샘플 수. 노이즈 강도가 1/sqrt(spp) 로 줄어든다. */
  readonly sampleCount?: number;
  /** spp=1 기준 상대 노이즈 강도. */
  readonly noiseSigma?: number;
}

export interface StudioDenoiseScene {
  readonly frame: StudioDenoiseFrame;
  /** 노이즈 없는 정답 색(같은 레이아웃). */
  readonly groundTruth: Float32Array;
  readonly width: number;
  readonly height: number;
}

interface SurfaceSample {
  readonly albedo: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  readonly depth: number;
  /** 노이즈 없는 조명(라디언스 계수). */
  readonly illumination: number;
  /** true 면 이 픽셀에는 노이즈를 넣지 않는다(수렴 영역 모사). */
  readonly converged?: boolean;
}

type SurfaceFn = (x: number, y: number, width: number, height: number) => SurfaceSample;

function buildScene(options: StudioDenoiseSceneOptions | undefined, surface: SurfaceFn): StudioDenoiseScene {
  const width = options?.width ?? 64;
  const height = options?.height ?? 64;
  const seed = options?.seed ?? 1;
  const sampleCount = Math.max(1, options?.sampleCount ?? 16);
  const baseSigma = options?.noiseSigma ?? 1.2;
  const sigma = baseSigma / Math.sqrt(sampleCount);
  const gaussian = createStudioDenoiseGaussian(seed);

  const pixels = width * height;
  const rgb = pixels * STUDIO_DENOISE_COLOR_CHANNELS;
  const color = new Float32Array(rgb);
  const groundTruth = new Float32Array(rgb);
  const albedo = new Float32Array(rgb);
  const normal = new Float32Array(rgb);
  const depth = new Float32Array(pixels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const b = p * 3;
      const s = surface(x, y, width, height);
      albedo[b] = s.albedo[0];
      albedo[b + 1] = s.albedo[1];
      albedo[b + 2] = s.albedo[2];
      normal[b] = s.normal[0];
      normal[b + 1] = s.normal[1];
      normal[b + 2] = s.normal[2];
      depth[p] = s.depth;

      // 조명 노이즈는 채널 공통(경로 추적에서 한 경로가 RGB 를 함께 실어온다).
      const noise = s.converged ? 1 : Math.exp(sigma * gaussian() - (sigma * sigma) / 2);
      for (let c = 0; c < 3; c += 1) {
        const truth = s.albedo[c] * s.illumination;
        groundTruth[b + c] = truth;
        color[b + c] = truth * noise;
      }
    }
  }

  return {
    width,
    height,
    groundTruth,
    frame: { width, height, color, albedo, normal, depth, sampleCount },
  };
}

const MATERIAL_A = {
  albedo: [0.82, 0.24, 0.18] as const,
  normal: [0, 0, 1] as const,
  depth: 5,
};
const MATERIAL_B = {
  albedo: [0.18, 0.42, 0.88] as const,
  normal: [0.7071067811865476, 0, 0.7071067811865476] as const,
  depth: 9,
};

/**
 * 재질 분할 씬 — 화면 중앙에 알베도·노멀·깊이가 **동시에** 불연속인 하드 엣지가 있고,
 * 조명은 양쪽 모두 부드러운 저주파 그라디언트다. 엣지 보존과 오차 감소를 동시에 잰다.
 */
export function createStudioDenoiseMaterialSplitScene(
  options?: StudioDenoiseSceneOptions,
): StudioDenoiseScene {
  return buildScene(options, (x, y, width, height) => {
    const left = x < width / 2;
    const material = left ? MATERIAL_A : MATERIAL_B;
    const u = x / Math.max(1, width - 1);
    const v = y / Math.max(1, height - 1);
    // 부드러운 저주파 조명 — 필터가 복원할 수 있어야 하는 신호.
    const illumination = left ? 0.55 + 0.3 * Math.sin(2.2 * v) : 0.9 + 0.35 * Math.cos(1.7 * u + 0.6 * v);
    return { ...material, illumination };
  });
}

export interface StudioDenoiseHighlightSceneOptions extends StudioDenoiseSceneOptions {
  /** 배경 조명. */
  readonly background?: number;
  /** 하이라이트 디스크 조명. */
  readonly highlight?: number;
  /** 디스크 반지름(픽셀). */
  readonly radius?: number;
  /** 심을 파이어플라이 목록(조명 스케일). */
  readonly fireflies?: readonly { readonly x: number; readonly y: number; readonly illumination: number }[];
}

/**
 * 하이라이트 + 파이어플라이 씬 — 기하는 완전히 평평하다(알베도·노멀·깊이 동일).
 * 따라서 밝은 원반을 지켜주는 것은 오직 분산 인지 휘도 게이트뿐이고, 파이어플라이를
 * 죽이는 것은 오직 이상치 클램프뿐이다. 두 기능을 서로 격리해서 증명하기 위한 구성.
 */
export function createStudioDenoiseHighlightScene(
  options?: StudioDenoiseHighlightSceneOptions,
): StudioDenoiseScene {
  const background = options?.background ?? 0.06;
  const highlight = options?.highlight ?? 6;
  const radius = options?.radius ?? 7;
  const fireflies = options?.fireflies ?? [];
  const scene = buildScene(options, (x, y, width, height) => {
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const dx = x - cx;
    const dy = y - cy;
    const inside = dx * dx + dy * dy <= radius * radius;
    return {
      albedo: [0.6, 0.6, 0.6] as const,
      normal: [0, 0, 1] as const,
      depth: 4,
      illumination: inside ? highlight : background,
    };
  });

  // 파이어플라이는 노이즈 생성 이후에 덮어쓴다 — 시드 소비 순서를 바꾸지 않기 위해서다.
  for (const spike of fireflies) {
    const p = spike.y * scene.width + spike.x;
    const b = p * 3;
    for (let c = 0; c < 3; c += 1) {
      scene.frame.color[b + c] = 0.6 * spike.illumination;
    }
  }
  return scene;
}

export interface StudioDenoiseVarianceSplitSceneOptions extends StudioDenoiseSceneOptions {
  /** 오른쪽 절반(수렴 영역)에 남길 잔여 상대 노이즈. */
  readonly convergedSigma?: number;
}

/**
 * 분산 분할 씬 — 기하·알베도·정답 조명이 **전 화면 동일**하고, 왼쪽 절반만 노이즈가 크다.
 * "수렴한 영역은 덜 바뀌어야 한다"를 신호 차이가 아니라 오직 분산 차이로만 검증한다.
 */
export function createStudioDenoiseVarianceSplitScene(
  options?: StudioDenoiseVarianceSplitSceneOptions,
): StudioDenoiseScene {
  const width = options?.width ?? 64;
  const height = options?.height ?? 64;
  const seed = options?.seed ?? 7;
  const sampleCount = Math.max(1, options?.sampleCount ?? 16);
  const noisySigma = (options?.noiseSigma ?? 1.6) / Math.sqrt(sampleCount);
  const convergedSigma = options?.convergedSigma ?? 0.002;
  const gaussian = createStudioDenoiseGaussian(seed);

  const pixels = width * height;
  const rgb = pixels * STUDIO_DENOISE_COLOR_CHANNELS;
  const color = new Float32Array(rgb);
  const groundTruth = new Float32Array(rgb);
  const albedo = new Float32Array(rgb);
  const normal = new Float32Array(rgb);
  const depth = new Float32Array(pixels);
  const illumination = 0.75;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const b = p * 3;
      const sigma = x < width / 2 ? noisySigma : convergedSigma;
      const noise = Math.exp(sigma * gaussian() - (sigma * sigma) / 2);
      depth[p] = 6;
      normal[b + 2] = 1;
      for (let c = 0; c < 3; c += 1) {
        albedo[b + c] = 0.55;
        const truth = 0.55 * illumination;
        groundTruth[b + c] = truth;
        color[b + c] = truth * noise;
      }
    }
  }

  return {
    width,
    height,
    groundTruth,
    frame: { width, height, color, albedo, normal, depth, sampleCount },
  };
}

/** 전체 RMSE. */
export function studioDenoiseRmse(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / Math.max(1, a.length));
}

/** 픽셀 인덱스 범위를 지정한 RMSE(반쪽 비교용). */
export function studioDenoiseRmseWhere(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  predicate: (x: number, y: number) => boolean,
): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!predicate(x, y)) continue;
      const b0 = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const d = a[b0 + c] - b[b0 + c];
        sum += d * d;
        count += 1;
      }
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

/** 평균 밝기(에너지 보존 확인용). */
export function studioDenoiseMean(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i];
  return sum / Math.max(1, buffer.length);
}

/** 참조용 순수 가우시안 블러(엣지 스토핑이 실제로 작동하는지 대조군). */
export function studioDenoiseReferenceBlur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(source.length);
  const sigma = Math.max(1, radius / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const b = (y * width + x) * 3;
      let weight = 0;
      const sums = [0, 0, 0];
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          const qb = (yy * width + xx) * 3;
          sums[0] += w * source[qb];
          sums[1] += w * source[qb + 1];
          sums[2] += w * source[qb + 2];
          weight += w;
        }
      }
      for (let c = 0; c < 3; c += 1) out[b + c] = sums[c] / Math.max(weight, 1e-8);
    }
  }
  return out;
}
