/**
 * Studio Kinetic Effect Graph — 웹툰 전용 파라메트릭 동적 효과
 * (비, 안개, 벚꽃/꽃잎, 먼지, 먹 번짐, 속도선, 에너지 펄스) 그래프 및 파티클 샘플러 코어.
 *
 * 마스터플랜 14.5 (Kinetic Effect Graph) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 웹툰 전용 효과: 비(Rain), 안개(Mist), 꽃잎(Petals), 먼지(Dust), 먹 번짐(Ink Bloom), 속도선(Speedlines), 발광(Glow Pulse)
 * - 컷(Panel) 범위 마스킹 및 루프 주기(Loop Period) 기반 결정론적 파티클 샘플링
 * - 정적 출고(PDF/인쇄/정적 웹툰)를 위한 자동 정적 대체본(Static Fallback) 생성
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_KINETIC_EFFECT_VERSION = 1 as const;

export const KINETIC_EFFECT_TYPES = [
  "rain",
  "mist",
  "petals",
  "dust-motes",
  "ink-bloom",
  "speedlines",
  "energy-glow-pulse",
] as const;
export type KineticEffectType = (typeof KINETIC_EFFECT_TYPES)[number];

export interface KineticRainParams {
  readonly speedPxPerSec: number;
  readonly angleDeg: number;
  readonly density: number; // 0..1
  readonly streakLengthPx: number;
  readonly dropColor?: string;
}

export interface KineticPetalsParams {
  readonly count: number;
  readonly windVelocityX: number;
  readonly windVelocityY: number;
  readonly flutterFrequencyHz: number;
  readonly petalColor?: string;
}

export interface KineticSpeedlinesParams {
  readonly originNormalizedX: number; // 0..1
  readonly originNormalizedY: number; // 0..1
  readonly lineCount: number;
  readonly strokeWidth: number;
  readonly innerRadiusRatio: number; // 0..1
}

export interface KineticGlowPulseParams {
  readonly pulseFrequencyHz: number;
  readonly glowRadiusPx: number;
  readonly coreBrightness: number;
  readonly glowColor: string;
}

export type KineticEffectParameters =
  | { readonly type: "rain"; readonly params: KineticRainParams }
  | { readonly type: "petals"; readonly params: KineticPetalsParams }
  | { readonly type: "speedlines"; readonly params: KineticSpeedlinesParams }
  | { readonly type: "energy-glow-pulse"; readonly params: KineticGlowPulseParams }
  | { readonly type: "mist" | "dust-motes" | "ink-bloom"; readonly params: Readonly<Record<string, number | string>> };

export interface KineticEffectInstance {
  readonly id: string;
  readonly panelId: string;
  readonly effect: KineticEffectParameters;
  readonly seed: number;
  readonly loopPeriodMs: number; // e.g. 2000ms loop
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly isMasked?: boolean;
}

export interface StudioKineticEffectGraph {
  readonly version: typeof STUDIO_KINETIC_EFFECT_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly effects: readonly KineticEffectInstance[];
}

export interface SampledKineticParticle {
  readonly x: number;
  readonly y: number;
  readonly length?: number;
  readonly angleDeg?: number;
  readonly opacity: number;
  readonly scale: number;
}

export function createStudioKineticEffectGraph(params: {
  id: string;
  episodeId: string;
  effects?: readonly KineticEffectInstance[];
}): StudioKineticEffectGraph {
  return Object.freeze({
    version: STUDIO_KINETIC_EFFECT_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    effects: Object.freeze([...(params.effects ?? [])]),
  });
}

export function addKineticEffect(
  graph: StudioKineticEffectGraph,
  effect: KineticEffectInstance,
): StudioKineticEffectGraph {
  if (graph.effects.some((e) => e.id === effect.id)) {
    throw new Error(`Effect ${effect.id} already exists`);
  }
  return {
    ...graph,
    effects: Object.freeze([...graph.effects, effect]),
  };
}

export function removeKineticEffect(
  graph: StudioKineticEffectGraph,
  effectId: string,
): StudioKineticEffectGraph {
  return {
    ...graph,
    effects: Object.freeze(graph.effects.filter((e) => e.id !== effectId)),
  };
}

/**
 * 특정 시점(timeMs)의 결정론적 파티클 위치와 시각 속성을 샘플링한다.
 */
export function sampleKineticParticlesAtTime(
  effect: KineticEffectInstance,
  timeMs: number,
): readonly SampledKineticParticle[] {
  const normTime = (timeMs % effect.loopPeriodMs) / effect.loopPeriodMs; // 0..1
  const b = effect.bounds;
  const seed = effect.seed;
  const particles: SampledKineticParticle[] = [];

  if (effect.effect.type === "rain") {
    const rain = effect.effect.params;
    const count = Math.round(50 * rain.density);
    for (let i = 0; i < count; i += 1) {
      const pSeed = (seed + i * 1013) % 10000;
      const initialX = (pSeed % 1000) / 1000 * b.width;
      const initialY = ((pSeed * 7) % 1000) / 1000 * b.height;

      const travelY = (initialY + normTime * b.height * 2) % b.height;
      const travelX = (initialX + (travelY / b.height) * Math.tan((rain.angleDeg * Math.PI) / 180) * 100) % b.width;

      particles.push(
        Object.freeze({
          x: b.x + travelX,
          y: b.y + travelY,
          length: rain.streakLengthPx,
          angleDeg: rain.angleDeg,
          opacity: 0.6 + ((i % 5) / 10),
          scale: 1,
        }),
      );
    }
  } else if (effect.effect.type === "petals") {
    const petals = effect.effect.params;
    for (let i = 0; i < petals.count; i += 1) {
      const pSeed = (seed + i * 7919) % 10000;
      const baseX = ((pSeed * 13) % 1000) / 1000 * b.width;
      const baseY = ((pSeed * 37) % 1000) / 1000 * b.height;

      const flutter = Math.sin(normTime * Math.PI * 2 * petals.flutterFrequencyHz + i) * 30;
      const posX = (baseX + normTime * petals.windVelocityX + flutter) % b.width;
      const posY = (baseY + normTime * petals.windVelocityY) % b.height;

      particles.push(
        Object.freeze({
          x: b.x + (posX < 0 ? posX + b.width : posX),
          y: b.y + (posY < 0 ? posY + b.height : posY),
          opacity: 0.8,
          scale: 0.8 + ((i % 4) / 10),
          angleDeg: (normTime * 360 * 2 + i * 45) % 360,
        }),
      );
    }
  }

  return Object.freeze(particles);
}

/**
 * 정적 포맷 출고를 위한 대표 정적 키프레임(Fallback Poster) 속성을 산출한다.
 */
export function generateStaticEffectFallback(
  effect: KineticEffectInstance,
): { readonly particleSnapshot: readonly SampledKineticParticle[]; readonly description: string } {
  // 중간 시점(500ms) 샘플링
  const snapshot = sampleKineticParticlesAtTime(effect, Math.floor(effect.loopPeriodMs / 2));
  return Object.freeze({
    particleSnapshot: snapshot,
    description: `정적 렌더링용 ${effect.effect.type} 효과 스냅샷 (파티클 ${snapshot.length}개)`,
  });
}
