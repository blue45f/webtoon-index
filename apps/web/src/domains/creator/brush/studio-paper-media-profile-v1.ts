/**
 * Studio Paper Media Profile v1 — 종이 프리셋 × 매체(브러시 패밀리)별 상호작용 프로파일.
 *
 * 기존 종이 스택과의 관계.
 * - `studio-paper-texture`는 128px seamless **타일**을 만들고 granulation 이득으로 변환한다.
 *   타일 경로는 캐시가 전제라서 "임의 문서 좌표 한 점"을 그 자리에서 싸게 묻기 어렵다.
 * - 이 모듈은 그 보완재다: **타일 없는 순수 스칼라 샘플러** `samplePaperHeightV1`이
 *   문서 좌표 (x, y)에서 종이 높이를 즉석 계산하고(샘플당 목표 < 200ns),
 *   `resolveStudioPaperMediaModulationV1`이 매체별 물리(피크 캐치 / 골 정착 / 직조 드러남 /
 *   미세 이빨)를 { depositScale, granulationScale, bleedScale } 3축으로 돌려준다.
 *   dab 플래너·건식 캐리어·R8 에셋 생성기가 텍셀/마크 단위로 직접 호출하는 용도다.
 *
 * 물리 근거(검증된 외부 레퍼런스 — 코드 복제 없음, 거동·파라미터만 재구현).
 * - **peak-catch(건식)**: Rebelle 실험판의 dry-brush 거동 — "낮은 수분 + 빠른 획은 종이
 *   요철의 봉우리에만 안료가 걸린다". 접촉 임계가 필압에 따라 내려가 강한 필압은 골까지
 *   메운다(왁스/목탄 실물과 동일).
 * - **valley-settle(수채·수묵)**: Curtis et al. 1997 granulation + inkwash(무라이선스,
 *   거동 참조) 표시 셰이더의 granulation 0.55 — 안료가 (1-height)에 비례해 골에 가라앉고
 *   absorbency가 번짐을 스케일한다.
 * - **weave-reveal(유화·아크릴)**: 얇게 편 물감이 직조 봉우리를 먼저 덮어 골이 드러나고,
 *   두꺼운 임파스토는 종이를 무시한다(dli/paint 임파스토 높이맵 관찰과 부합).
 * - **fiber permeability**: MoXi(Chu & Tai, SIGGRAPH 2005) 3층 종이 모델의 텍셀별 섬유
 *   투과율 개념을 fiberAnisotropy(방향성 섬유 결)로 옮겼다 — 번짐 게이트에 곱할 수 있는
 *   방향성 노이즈가 페더링의 근원이다.
 *
 * 설계 규칙(레포 공통).
 * - 순수·결정적: Math.random / Date.now / DOM / Konva / GPU 의존 없음. 모든 난수는
 *   `studioOssUnitHash` 시드 해시다. 같은 (preset, x, y, seed) → 항상 같은 출력.
 * - 프리셋·표는 전부 Object.freeze. 반환 변조 벡터도 freeze.
 * - 잘못된 입력은 조용히 통과시키지 않는다 — 알 수 없는 매체/비유한 필압은 항등
 *   변조({1, 0, 0})로 fail-closed 한다.
 */

import { studioOssUnitHash } from "../studio-oss-brush-kernels";

export const STUDIO_PAPER_MEDIA_PROFILE_VERSION_V1 = 1 as const;

const TAU = Math.PI * 2;
/** toothDepth 1이 만드는 (tooth-0.5) 진폭 배수. 1.6이면 h 범위가 [-0.3, 1.3]→클램프로 실물 같은 플래토가 생긴다. */
const STUDIO_PAPER_TOOTH_DEPTH_GAIN_V1 = 1.6;
/** fiberAnisotropy.strength 1이 만드는 최대 결 신장 배수(1 + 3 = 4×). */
const STUDIO_PAPER_FIBER_ELONGATION_GAIN_V1 = 3;
/** 두 번째 옥타브의 격자 위상을 분리하는 시드 간격. */
const STUDIO_PAPER_OCTAVE_SEED_STRIDE_V1 = 0x9e37;
/** 반점(fleck) 격자 전용 시드 소금. */
const STUDIO_PAPER_FLECK_SEED_SALT_V1 = 0x5f1e_cc01;
/** 시드 하위 16비트 → 직조 위상. 같은 시드 = 같은 낱장, 다른 시드 = 어긋난 직조. */
const STUDIO_PAPER_WEAVE_SEED_PHASE_V1 = TAU / 0x1_0000;
/** 두 직조 축의 위상을 분리하는 황금비 계수. */
const STUDIO_PAPER_WEAVE_PHASE_SPLIT_V1 = 0.618_033_988_749_895;

// ---------------------------------------------------------------------------
// 종이 프리셋 라이브러리
// ---------------------------------------------------------------------------

export type StudioPaperPresetIdV1 =
  | "watercolor-rough"
  | "watercolor-hot-press"
  | "kent"
  | "canvas-weave"
  | "newsprint"
  | "printmaking";

/** 초지기 발 방향의 섬유 결. strength 0이면 등방, 1이면 축 방향으로 4× 늘어난다. */
export interface StudioPaperFiberAnisotropyV1 {
  readonly strength: number;
  readonly axisRadians: number;
}

/** 씨실·날실 직조(캔버스 천). 두 축 사인 곱이라 교차점이 봉우리/골로 번갈아 나온다. */
export interface StudioPaperWeaveV1 {
  readonly pitchX: number;
  readonly pitchY: number;
  readonly contrast: number;
}

/** 성긴 반점 — 신문지 재생 펄프 조각(+depth), 판화지 깊은 알갱이 골(−depth). */
export interface StudioPaperFleckV1 {
  readonly cellPx: number;
  readonly density: number;
  readonly depth: number;
}

export interface StudioPaperPresetV1 {
  readonly id: StudioPaperPresetIdV1;
  readonly nameKo: string;
  readonly descriptionKo: string;
  /** 최저 주파수 결 셀 하나가 차지하는 문서 px. 클수록 결이 굵다. */
  readonly toothScale: number;
  /** 0..1 — 결 깊이(높이 진폭). */
  readonly toothDepth: number;
  readonly fiberAnisotropy: StudioPaperFiberAnisotropyV1;
  readonly weave?: StudioPaperWeaveV1;
  readonly fleck?: StudioPaperFleckV1;
  /** 0..1 — 안료가 이 종이의 골을 타는 성향(granulation 결합 계수). */
  readonly granulationAffinity: number;
  /** 0..1 — 물·용매 흡수율. bleedScale의 원천. */
  readonly absorbency: number;
}

function freezeStudioPaperPresetV1(preset: StudioPaperPresetV1): StudioPaperPresetV1 {
  return Object.freeze({
    ...preset,
    fiberAnisotropy: Object.freeze({ ...preset.fiberAnisotropy }),
    ...(preset.weave ? { weave: Object.freeze({ ...preset.weave }) } : {}),
    ...(preset.fleck ? { fleck: Object.freeze({ ...preset.fleck }) } : {}),
  });
}

/**
 * 여섯 장의 절차적 종이. 흡수율은 기존 `PAPER_PHYSICS_PROFILES`의 대응 종이
 * (rough 0.78 / hot-press 0.42 / bristol 0.28 / newsprint 0.7)와 자리를 맞춰
 * 두 카탈로그가 같은 물리 언어를 쓰게 했다.
 */
export const STUDIO_PAPER_PRESETS_V1 = Object.freeze({
  "watercolor-rough": freezeStudioPaperPresetV1({
    id: "watercolor-rough",
    nameKo: "수채 황목",
    descriptionKo: "거친 펠트 결 + 가로 섬유 줄무늬. 과립·드라이브러시가 가장 강합니다.",
    toothScale: 12,
    toothDepth: 0.8,
    fiberAnisotropy: { strength: 0.45, axisRadians: 0 },
    granulationAffinity: 0.92,
    absorbency: 0.78,
  }),
  "watercolor-hot-press": freezeStudioPaperPresetV1({
    id: "watercolor-hot-press",
    nameKo: "수채 세목",
    descriptionKo: "롤러로 눌러 죽인 미세 결. 워시가 고르게 펴집니다.",
    toothScale: 4,
    toothDepth: 0.2,
    fiberAnisotropy: { strength: 0.15, axisRadians: 0 },
    granulationAffinity: 0.28,
    absorbency: 0.42,
  }),
  kent: freezeStudioPaperPresetV1({
    id: "kent",
    nameKo: "켄트지",
    descriptionKo: "매끈한 제도·소묘지. 연필 미세 이빨만 남습니다.",
    toothScale: 3,
    toothDepth: 0.14,
    fiberAnisotropy: { strength: 0.1, axisRadians: 0 },
    granulationAffinity: 0.2,
    absorbency: 0.3,
  }),
  "canvas-weave": freezeStudioPaperPresetV1({
    id: "canvas-weave",
    nameKo: "캔버스 직조",
    descriptionKo: "씨실·날실 2축 직조 + 젯소 프라이밍. 얇은 유화가 직조를 드러냅니다.",
    toothScale: 6,
    toothDepth: 0.4,
    fiberAnisotropy: { strength: 0.08, axisRadians: 0 },
    weave: { pitchX: 14, pitchY: 14, contrast: 0.5 },
    granulationAffinity: 0.6,
    absorbency: 0.24,
  }),
  newsprint: freezeStudioPaperPresetV1({
    id: "newsprint",
    nameKo: "신문지",
    descriptionKo: "기계 방향 섬유 결 + 재생 펄프 반점. 빠른 스케치용.",
    toothScale: 3.5,
    toothDepth: 0.24,
    fiberAnisotropy: { strength: 0.6, axisRadians: 0 },
    fleck: { cellPx: 3, density: 0.06, depth: 0.5 },
    granulationAffinity: 0.45,
    absorbency: 0.7,
  }),
  printmaking: freezeStudioPaperPresetV1({
    id: "printmaking",
    nameKo: "판화지",
    descriptionKo: "깊은 알갱이 이빨 + 성긴 골 반점. 목탄·콩테가 깊게 박힙니다.",
    toothScale: 8,
    toothDepth: 0.88,
    fiberAnisotropy: { strength: 0.12, axisRadians: 0 },
    fleck: { cellPx: 5, density: 0.1, depth: -0.6 },
    granulationAffinity: 0.85,
    absorbency: 0.62,
  }),
} as const satisfies Readonly<Record<StudioPaperPresetIdV1, StudioPaperPresetV1>>);

export const STUDIO_PAPER_PRESET_IDS_V1 = Object.freeze(
  Object.keys(STUDIO_PAPER_PRESETS_V1) as readonly StudioPaperPresetIdV1[],
);

export function isStudioPaperPresetIdV1(value: unknown): value is StudioPaperPresetIdV1 {
  return typeof value === "string" && Object.hasOwn(STUDIO_PAPER_PRESETS_V1, value);
}

/** 미지의 id를 안전한 프리셋으로 정규화한다. 기본은 중립적인 켄트지다. */
export function getStudioPaperPresetV1(id: unknown): StudioPaperPresetV1 {
  return isStudioPaperPresetIdV1(id) ? STUDIO_PAPER_PRESETS_V1[id] : STUDIO_PAPER_PRESETS_V1.kent;
}

// ---------------------------------------------------------------------------
// 순수 스칼라 높이 샘플러
// ---------------------------------------------------------------------------

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 샘플러 상수 — 프리셋당 한 번만 파생해 WeakMap에 담는다(순수 메모이제이션).
 * 삼각함수·나눗셈을 샘플 루프 밖으로 끌어내는 것이 200ns/샘플 예산의 핵심이다.
 */
interface StudioPaperSamplerConstantsV1 {
  readonly cosAxis: number;
  readonly sinAxis: number;
  readonly fiberCompression: number;
  readonly invToothScale: number;
  readonly depthGain: number;
  readonly weaveFrequencyX: number;
  readonly weaveFrequencyY: number;
  readonly weaveHalfContrast: number;
  readonly fleckInvCell: number;
  readonly fleckDensity: number;
  readonly fleckDepth: number;
}

const samplerConstantsCacheV1 = new WeakMap<object, StudioPaperSamplerConstantsV1>();

function resolveStudioPaperSamplerConstantsV1(
  preset: StudioPaperPresetV1,
): StudioPaperSamplerConstantsV1 {
  const cached = samplerConstantsCacheV1.get(preset);
  if (cached) return cached;
  const axisRadians = finiteNumber(preset.fiberAnisotropy?.axisRadians, 0);
  const strength = clamp01(finiteNumber(preset.fiberAnisotropy?.strength, 0));
  const toothScale = clamp(finiteNumber(preset.toothScale, 8), 0.5, 512);
  const toothDepth = clamp01(finiteNumber(preset.toothDepth, 0.5));
  const pitchX = clamp(finiteNumber(preset.weave?.pitchX, 0), 2, 4096);
  const pitchY = clamp(finiteNumber(preset.weave?.pitchY, 0), 2, 4096);
  const weaveContrast = clamp01(finiteNumber(preset.weave?.contrast, 0));
  const fleckCell = clamp(finiteNumber(preset.fleck?.cellPx, 0), 1, 512);
  const constants: StudioPaperSamplerConstantsV1 = Object.freeze({
    cosAxis: Math.cos(axisRadians),
    sinAxis: Math.sin(axisRadians),
    fiberCompression: 1 / (1 + STUDIO_PAPER_FIBER_ELONGATION_GAIN_V1 * strength),
    invToothScale: 1 / toothScale,
    depthGain: toothDepth * STUDIO_PAPER_TOOTH_DEPTH_GAIN_V1,
    weaveFrequencyX: preset.weave ? TAU / pitchX : 0,
    weaveFrequencyY: preset.weave ? TAU / pitchY : 0,
    weaveHalfContrast: preset.weave ? weaveContrast * 0.5 : 0,
    fleckInvCell: preset.fleck ? 1 / fleckCell : 0,
    fleckDensity: preset.fleck ? clamp01(finiteNumber(preset.fleck.density, 0)) : 0,
    fleckDepth: preset.fleck ? clamp(finiteNumber(preset.fleck.depth, 0), -1, 1) : 0,
  });
  samplerConstantsCacheV1.set(preset, constants);
  return constants;
}

/**
 * 주기 없는 격자 값 노이즈 한 옥타브. 격자 해시는 레포 표준 `studioOssUnitHash`
 * (seed, ix, iy)이며 C2 보간(6t⁵−15t⁴+10t³)으로 기울기까지 매끈하다.
 */
function studioPaperLatticeNoiseV1(gx: number, gy: number, seed: number): number {
  const cellX = Math.floor(gx);
  const cellY = Math.floor(gy);
  const rawTx = gx - cellX;
  const rawTy = gy - cellY;
  const tx = rawTx * rawTx * rawTx * (rawTx * (rawTx * 6 - 15) + 10);
  const ty = rawTy * rawTy * rawTy * (rawTy * (rawTy * 6 - 15) + 10);
  const n00 = studioOssUnitHash(seed, cellX, cellY);
  const n10 = studioOssUnitHash(seed, cellX + 1, cellY);
  const n01 = studioOssUnitHash(seed, cellX, cellY + 1);
  const n11 = studioOssUnitHash(seed, cellX + 1, cellY + 1);
  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * 문서 좌표 (x, y)의 종이 높이 [0, 1]. 순수·결정적 — 같은 (preset, x, y, seed)는 항상
 * 같은 값이고 타일·캐시 없이 임의 좌표를 즉석에서 묻는다.
 *
 * 구성: 2옥타브 값 노이즈(섬유 축으로 신장) + 선택적 직조 변조 + 선택적 반점.
 * 비용은 격자 해시 8회 + (직조 시) sin 2회 + (반점 시) 해시 1회 — 스칼라 200ns/샘플 예산.
 */
export function samplePaperHeightV1(
  preset: StudioPaperPresetV1,
  x: number,
  y: number,
  seed: number,
): number {
  const constants = resolveStudioPaperSamplerConstantsV1(preset);
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const safeSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  // 섬유 축 좌표계로 회전한 뒤 축 방향만 압축한다 = 결이 축 방향으로 늘어난다.
  const fiberU =
    (safeX * constants.cosAxis + safeY * constants.sinAxis)
    * constants.fiberCompression
    * constants.invToothScale;
  const fiberV =
    (safeY * constants.cosAxis - safeX * constants.sinAxis) * constants.invToothScale;
  const octaveA = studioPaperLatticeNoiseV1(fiberU, fiberV, safeSeed);
  const octaveB = studioPaperLatticeNoiseV1(
    fiberU * 2 + 37.19,
    fiberV * 2 + 11.53,
    safeSeed + STUDIO_PAPER_OCTAVE_SEED_STRIDE_V1,
  );
  let height =
    0.5
    + (octaveA * (2 / 3) + octaveB * (1 / 3) - 0.5) * constants.depthGain;
  if (constants.weaveHalfContrast > 0) {
    // 직조는 베틀 좌표(문서축) 고정이고 시드는 위상만 민다 — 같은 시드 = 같은 낱장.
    const weavePhase = (safeSeed & 0xffff) * STUDIO_PAPER_WEAVE_SEED_PHASE_V1;
    height +=
      constants.weaveHalfContrast
      * Math.sin(safeX * constants.weaveFrequencyX + weavePhase)
      * Math.sin(
        safeY * constants.weaveFrequencyY
          + weavePhase * STUDIO_PAPER_WEAVE_PHASE_SPLIT_V1,
      );
  }
  if (constants.fleckDensity > 0 && constants.fleckDepth !== 0) {
    const fleckCellX = Math.floor(safeX * constants.fleckInvCell);
    const fleckCellY = Math.floor(safeY * constants.fleckInvCell);
    const fleckRoll = studioOssUnitHash(
      safeSeed ^ STUDIO_PAPER_FLECK_SEED_SALT_V1,
      fleckCellX,
      fleckCellY,
    );
    if (fleckRoll < constants.fleckDensity) {
      height += constants.fleckDepth * (1 - fleckRoll / constants.fleckDensity);
    }
  }
  return height <= 0 ? 0 : height >= 1 ? 1 : height;
}

// ---------------------------------------------------------------------------
// 매체별 상호작용 프로파일
// ---------------------------------------------------------------------------

export type StudioPaperMediaInteractionModeV1 =
  | "peak-catch"
  | "valley-settle"
  | "weave-reveal"
  | "neutral-light";

export type StudioPaperMediumV1 =
  | "crayon"
  | "chalk"
  | "charcoal"
  | "pastel"
  | "pencil"
  | "dry-media"
  | "watercolor"
  | "ink-wash"
  | "oil"
  | "acrylic"
  | "marker"
  | "airbrush";

/**
 * 매체 하나가 종이 높이를 읽는 방식. 모드별로 쓰는 항이 다르며 안 쓰는 항은 0이다.
 *
 * - `peak-catch`: 접촉 임계 = mix(light, heavy, pressure^curve). 임계 위 높이만
 *   smoothstep으로 안료를 받는다 — 저필압은 봉우리만(드라이브러시), 고필압은 골까지.
 * - `valley-settle`: granulation ∝ (1-height)·affinity, 번짐 ∝ absorbency.
 * - `weave-reveal`: coverage *= mix(1, height, thinness·reveal) — 얇을수록 직조가 비친다.
 * - `neutral-light`: ±depositDepth의 아주 미세한 이빨만.
 */
export interface StudioPaperMediaInteractionProfileV1 {
  readonly medium: StudioPaperMediumV1;
  readonly mode: StudioPaperMediaInteractionModeV1;
  /** peak-catch: 필압 0의 접촉 임계(봉우리만 닿는 높이). */
  readonly contactThresholdLight: number;
  /** peak-catch: 필압 1의 접촉 임계(골까지 잠기는 높이). */
  readonly contactThresholdHeavy: number;
  /** peak-catch: smoothstep 반폭. */
  readonly contactFeather: number;
  /** 임계·번짐 보간에 걸리는 필압 감마. */
  readonly pressureCurve: number;
  /** granulationScale 이득(프리셋 affinity에 곱). */
  readonly granulationGain: number;
  /** valley-settle 침착 편향 / neutral-light 이빨 깊이. */
  readonly depositDepth: number;
  /** bleedScale 이득(프리셋 absorbency에 곱). */
  readonly bleedGain: number;
  /** weave-reveal: thinness가 종이를 드러내는 정도. */
  readonly thinnessReveal: number;
}

function freezeStudioPaperMediaInteractionProfileV1(
  profile: StudioPaperMediaInteractionProfileV1,
): StudioPaperMediaInteractionProfileV1 {
  return Object.freeze({ ...profile });
}

/**
 * 12개 매체 상호작용 표. 건식 계열은 임계·페더가 실물 경도 순서를 따른다 —
 * 연필(단단한 심)은 임계가 높고 페더가 좁아 고필압에도 골을 다 못 메우고,
 * 파스텔(무른 가루)은 임계가 낮고 페더가 넓어 일찍 골에 스며든다.
 */
export const STUDIO_PAPER_MEDIA_INTERACTION_V1 = Object.freeze({
  crayon: freezeStudioPaperMediaInteractionProfileV1({
    medium: "crayon",
    mode: "peak-catch",
    contactThresholdLight: 0.82,
    contactThresholdHeavy: 0.06,
    contactFeather: 0.12,
    pressureCurve: 0.7,
    granulationGain: 0.8,
    depositDepth: 0,
    bleedGain: 0.04,
    thinnessReveal: 0,
  }),
  chalk: freezeStudioPaperMediaInteractionProfileV1({
    medium: "chalk",
    mode: "peak-catch",
    contactThresholdLight: 0.76,
    contactThresholdHeavy: 0.1,
    contactFeather: 0.18,
    pressureCurve: 0.8,
    granulationGain: 0.95,
    depositDepth: 0,
    bleedGain: 0.08,
    thinnessReveal: 0,
  }),
  charcoal: freezeStudioPaperMediaInteractionProfileV1({
    medium: "charcoal",
    mode: "peak-catch",
    contactThresholdLight: 0.78,
    contactThresholdHeavy: 0.08,
    contactFeather: 0.16,
    pressureCurve: 0.75,
    granulationGain: 1,
    depositDepth: 0,
    bleedGain: 0.06,
    thinnessReveal: 0,
  }),
  pastel: freezeStudioPaperMediaInteractionProfileV1({
    medium: "pastel",
    mode: "peak-catch",
    contactThresholdLight: 0.72,
    contactThresholdHeavy: 0.08,
    contactFeather: 0.2,
    pressureCurve: 0.78,
    granulationGain: 0.9,
    depositDepth: 0,
    bleedGain: 0.08,
    thinnessReveal: 0,
  }),
  pencil: freezeStudioPaperMediaInteractionProfileV1({
    medium: "pencil",
    mode: "peak-catch",
    contactThresholdLight: 0.84,
    contactThresholdHeavy: 0.18,
    contactFeather: 0.1,
    pressureCurve: 0.85,
    granulationGain: 0.7,
    depositDepth: 0,
    bleedGain: 0.02,
    thinnessReveal: 0,
  }),
  "dry-media": freezeStudioPaperMediaInteractionProfileV1({
    medium: "dry-media",
    mode: "peak-catch",
    contactThresholdLight: 0.8,
    contactThresholdHeavy: 0.08,
    contactFeather: 0.15,
    pressureCurve: 0.75,
    granulationGain: 0.9,
    depositDepth: 0,
    bleedGain: 0.05,
    thinnessReveal: 0,
  }),
  watercolor: freezeStudioPaperMediaInteractionProfileV1({
    medium: "watercolor",
    mode: "valley-settle",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 0.85,
    granulationGain: 1,
    depositDepth: 0.9,
    bleedGain: 1,
    thinnessReveal: 0,
  }),
  "ink-wash": freezeStudioPaperMediaInteractionProfileV1({
    medium: "ink-wash",
    mode: "valley-settle",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 0.85,
    granulationGain: 0.78,
    depositDepth: 0.72,
    bleedGain: 0.92,
    thinnessReveal: 0,
  }),
  oil: freezeStudioPaperMediaInteractionProfileV1({
    medium: "oil",
    mode: "weave-reveal",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 0.8,
    granulationGain: 0.5,
    depositDepth: 0,
    bleedGain: 0.1,
    thinnessReveal: 0.85,
  }),
  acrylic: freezeStudioPaperMediaInteractionProfileV1({
    medium: "acrylic",
    mode: "weave-reveal",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 0.8,
    granulationGain: 0.45,
    depositDepth: 0,
    bleedGain: 0.18,
    thinnessReveal: 0.7,
  }),
  marker: freezeStudioPaperMediaInteractionProfileV1({
    medium: "marker",
    mode: "neutral-light",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 1,
    granulationGain: 0.1,
    depositDepth: 0.06,
    bleedGain: 0.32,
    thinnessReveal: 0,
  }),
  airbrush: freezeStudioPaperMediaInteractionProfileV1({
    medium: "airbrush",
    mode: "neutral-light",
    contactThresholdLight: 0,
    contactThresholdHeavy: 0,
    contactFeather: 0,
    pressureCurve: 1,
    granulationGain: 0.05,
    depositDepth: 0.035,
    bleedGain: 0.1,
    thinnessReveal: 0,
  }),
} as const satisfies Readonly<
  Record<StudioPaperMediumV1, StudioPaperMediaInteractionProfileV1>
>);

export function isStudioPaperMediumV1(value: unknown): value is StudioPaperMediumV1 {
  return typeof value === "string" && Object.hasOwn(STUDIO_PAPER_MEDIA_INTERACTION_V1, value);
}

// ---------------------------------------------------------------------------
// 변조 벡터 해석
// ---------------------------------------------------------------------------

export interface StudioPaperMediaModulationInputV1 {
  readonly medium: StudioPaperMediumV1;
  readonly preset: StudioPaperPresetV1;
  /** 0..1 캐노니컬 필압. 비유한 값은 항등으로 fail-closed. */
  readonly pressure: number;
  /** 0..1 물감 얇기(weave-reveal 전용). 생략하면 1 - pressure. */
  readonly thinness?: number;
  readonly x: number;
  readonly y: number;
  readonly seed: number;
}

/**
 * 변조 벡터 계약 범위.
 * - depositScale ∈ [0, 1.5] — dab/마크 알파에 곱한다. peak-catch·weave-reveal은 [0, 1],
 *   valley-settle은 1 ± depositDepth·affinity/2, neutral-light는 1 ± depositDepth.
 * - granulationScale ∈ [0, 1] — 골 정착 강도(granulation 설정)에 곱한다.
 * - bleedScale ∈ [0, 1] — 습식 번짐 반경/게이트에 곱한다.
 */
export interface StudioPaperMediaModulationV1 {
  readonly depositScale: number;
  readonly granulationScale: number;
  readonly bleedScale: number;
}

export const STUDIO_PAPER_MEDIA_MODULATION_BOUNDS_V1 = Object.freeze({
  depositScale: Object.freeze({ min: 0, max: 1.5 }),
  granulationScale: Object.freeze({ min: 0, max: 1 }),
  bleedScale: Object.freeze({ min: 0, max: 1 }),
});

/** 알 수 없는 매체·잘못된 입력의 fail-closed 항등 — 종이를 전혀 타지 않는다. */
export const STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1: StudioPaperMediaModulationV1 =
  Object.freeze({ depositScale: 1, granulationScale: 0, bleedScale: 0 });

function smoothstepUnit(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * depositScale 수학의 단일 소스 — 오브젝트 경로(resolveStudioPaperMediaModulationV1)와
 * 스칼라 핫패스(resolveStudioPaperDepositScaleV1)가 같은 식을 공유하므로 두 경로가
 * 바이트 단위로 갈라질 수 없다 (2026-08-14 스탬프 dab 당 할당 제거).
 */
function paperDepositScaleForModeV1(
  profile: StudioPaperMediaInteractionProfileV1,
  pressure: number,
  affinity: number,
  height: number,
  flood: number,
  thinnessInput: number | undefined,
): number {
  switch (profile.mode) {
    case "peak-catch": {
      const contactThreshold =
        profile.contactThresholdLight
        + (profile.contactThresholdHeavy - profile.contactThresholdLight) * flood;
      return smoothstepUnit(
        contactThreshold - profile.contactFeather,
        contactThreshold + profile.contactFeather,
        height,
      );
    }
    case "valley-settle": {
      const valley = 1 - height;
      // h 평균이 0.5라 (valley - 0.5) 편향은 평균적으로 안료량을 보존한다.
      return clamp(
        1 + profile.depositDepth * affinity * (valley - 0.5),
        STUDIO_PAPER_MEDIA_MODULATION_BOUNDS_V1.depositScale.min,
        STUDIO_PAPER_MEDIA_MODULATION_BOUNDS_V1.depositScale.max,
      );
    }
    case "weave-reveal": {
      const thinness = clamp01(finiteNumber(thinnessInput, 1 - pressure));
      const reveal = thinness * profile.thinnessReveal;
      // coverage *= mix(1, height, reveal) — 두꺼운 임파스토(reveal→0)는 종이를 무시한다.
      return 1 + reveal * (height - 1);
    }
    case "neutral-light":
      return 1 + profile.depositDepth * (height - 0.5) * 2;
  }
}

/**
 * 호출 측이 **직접 샘플한 높이**에 대한 depositScale.
 *
 * `resolveStudioPaperDepositScaleV1`은 높이 샘플링과 모드 수학을 함께 소유한다. substrate-v2
 * 런타임은 같은 모드 수학을 **자기가 샘플한 높이**에 걸어야 한다 — v2 필드는 서로 통약불가능한
 * 두 타일 조회로 de-tiling 되어 있어 `samplePaperHeightV1`이 표현할 수 없다. 커널을 여기서
 * 노출해 두면 peak-catch / valley-settle / weave-reveal 사본이 트리에 두 벌 생기지 않는다 —
 * 침착 수학의 단일 권위는 이 파일 하나다.
 *
 * 검증되지 않은 입력은 `resolveStudioPaperDepositScaleV1`과 동일하게 항등(1)으로 fail-closed.
 */
export function resolveStudioPaperDepositScaleForHeightV1(
  medium: unknown,
  pressure: number,
  affinity: number,
  height: number,
  thinness?: number,
): number {
  if (
    !isStudioPaperMediumV1(medium)
    || !Number.isFinite(pressure)
    || !Number.isFinite(height)
  ) {
    return STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1.depositScale;
  }
  const profile = STUDIO_PAPER_MEDIA_INTERACTION_V1[medium];
  const clampedPressure = clamp01(pressure);
  const flood = Math.pow(clampedPressure, profile.pressureCurve);
  return paperDepositScaleForModeV1(
    profile,
    clampedPressure,
    clamp01(finiteNumber(affinity, 0)),
    clamp01(height),
    flood,
    thinness,
  );
}

/**
 * dab/텍셀 핫패스용 스칼라 fast path — `resolveStudioPaperMediaModulationV1(...).depositScale`
 * 과 항상 정확히 같은 값을 돌려주지만 입력/결과 객체를 만들지 않는다(할당 0, freeze 0).
 * 스탬프 플래너는 dab 당 depositScale 하나만 소비하므로 이 경로를 쓴다. 검증되지 않은
 * 입력은 오브젝트 경로와 동일하게 항등(1)으로 fail-closed 한다.
 */
export function resolveStudioPaperDepositScaleV1(
  medium: unknown,
  preset: StudioPaperPresetV1,
  pressure: number,
  x: number,
  y: number,
  seed: number,
  thinness?: number,
): number {
  if (
    !isStudioPaperMediumV1(medium)
    || typeof preset !== "object"
    || preset === null
    || !Number.isFinite(pressure)
  ) {
    return STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1.depositScale;
  }
  const profile = STUDIO_PAPER_MEDIA_INTERACTION_V1[medium];
  const clampedPressure = clamp01(pressure);
  const affinity = clamp01(finiteNumber(preset.granulationAffinity, 0));
  const height = samplePaperHeightV1(preset, x, y, seed);
  const flood = Math.pow(clampedPressure, profile.pressureCurve);
  return paperDepositScaleForModeV1(
    profile,
    clampedPressure,
    affinity,
    height,
    flood,
    thinness,
  );
}

/**
 * (매체, 종이, 필압, 문서 좌표) → { depositScale, granulationScale, bleedScale }.
 *
 * 순수·결정적. 높이는 `samplePaperHeightV1` 한 번만 읽으므로 dab/텍셀 핫패스에서
 * 호출해도 비용이 상수다. 반환 벡터는 frozen이며 범위는
 * `STUDIO_PAPER_MEDIA_MODULATION_BOUNDS_V1`을 절대 벗어나지 않는다.
 */
export function resolveStudioPaperMediaModulationV1(
  input: StudioPaperMediaModulationInputV1,
): StudioPaperMediaModulationV1 {
  if (
    typeof input !== "object"
    || input === null
    || !isStudioPaperMediumV1(input.medium)
    || typeof input.preset !== "object"
    || input.preset === null
    || !Number.isFinite(input.pressure)
  ) {
    return STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1;
  }
  const profile = STUDIO_PAPER_MEDIA_INTERACTION_V1[input.medium];
  const pressure = clamp01(input.pressure);
  const affinity = clamp01(finiteNumber(input.preset.granulationAffinity, 0));
  const absorbency = clamp01(finiteNumber(input.preset.absorbency, 0));
  const height = samplePaperHeightV1(input.preset, input.x, input.y, input.seed);
  const flood = Math.pow(pressure, profile.pressureCurve);

  const depositScale = paperDepositScaleForModeV1(
    profile,
    pressure,
    affinity,
    height,
    flood,
    input.thinness,
  );
  switch (profile.mode) {
    case "peak-catch": {
      return Object.freeze({
        depositScale,
        // 고필압이 골을 메우면 이빨 질감도 함께 잦아든다(0.8 하한은 완전 소실 방지).
        granulationScale: clamp01(profile.granulationGain * affinity * (1 - 0.8 * flood)),
        bleedScale: clamp01(profile.bleedGain * absorbency),
      });
    }
    case "valley-settle": {
      const valley = 1 - height;
      return Object.freeze({
        depositScale,
        granulationScale: clamp01(profile.granulationGain * affinity * valley),
        // 물이 많고(필압↑) 골일수록(웅덩이) 더 번진다.
        bleedScale: clamp01(
          profile.bleedGain * absorbency * (0.35 + 0.65 * flood) * (0.85 + 0.3 * valley),
        ),
      });
    }
    case "weave-reveal": {
      const thinness = clamp01(
        finiteNumber(input.thinness, 1 - pressure),
      );
      const reveal = thinness * profile.thinnessReveal;
      return Object.freeze({
        depositScale,
        granulationScale: clamp01(profile.granulationGain * affinity * reveal),
        bleedScale: clamp01(profile.bleedGain * absorbency * (0.25 + 0.75 * flood)),
      });
    }
    case "neutral-light": {
      return Object.freeze({
        depositScale,
        granulationScale: clamp01(profile.granulationGain * affinity),
        bleedScale: clamp01(profile.bleedGain * absorbency * (0.4 + 0.6 * flood)),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 브러시 렌더 패밀리 기본값
// ---------------------------------------------------------------------------

/**
 * `studio-brush`의 StudioBrushRenderFamily와 같은 문자열 집합의 로컬 미러.
 * 이 워크스트림은 기존 파일을 수정하지 않으므로 배선 시 import 타입으로 교체하면 된다.
 */
export type StudioPaperBrushRenderFamilyV1 =
  | "dry-media"
  | "pastel"
  | "pencil"
  | "watercolor"
  | "brush"
  | "oil"
  | "calligraphy"
  | "airbrush"
  | "pen"
  | "gpen"
  | "perfect"
  | "marker"
  | "highlighter"
  | "neon"
  | "glow"
  | "glitter"
  | "ink-particle"
  | "screentone"
  | "stamp"
  | "pixel";

/**
 * 문서가 종이를 고정하지 않았을 때 패밀리별로 가장 잘 맞는 기본 낱장.
 * 수채→황목(과립), 유화→캔버스 직조(weave-reveal), 건식→판화지(깊은 이빨),
 * 연필·선화 계열→켄트지(미세 이빨), 잉크 파티클→신문지(스케치 무드).
 */
export const STUDIO_PAPER_DEFAULT_PRESET_BY_BRUSH_FAMILY_V1 = Object.freeze({
  "dry-media": "printmaking",
  pastel: "printmaking",
  pencil: "kent",
  watercolor: "watercolor-rough",
  brush: "watercolor-hot-press",
  oil: "canvas-weave",
  calligraphy: "watercolor-hot-press",
  airbrush: "kent",
  pen: "kent",
  gpen: "kent",
  perfect: "kent",
  marker: "kent",
  highlighter: "kent",
  neon: "kent",
  glow: "kent",
  glitter: "kent",
  "ink-particle": "newsprint",
  screentone: "kent",
  stamp: "kent",
  pixel: "kent",
} as const satisfies Readonly<
  Record<StudioPaperBrushRenderFamilyV1, StudioPaperPresetIdV1>
>);

/**
 * 패밀리 → 상호작용 매체. null = 종이를 타지 않는 도구(기존
 * `STUDIO_PAPER_BRUSH_RESPONSE`의 항등 패밀리와 동일 정책 — 픽셀·톤·스탬프는 항등 유지).
 * marker/airbrush/highlighter는 기존 표에선 항등이지만 이 v1은 아주 미세한
 * neutral-light 이빨을 새로 제공한다(배선 시 opt-in).
 */
export const STUDIO_PAPER_MEDIUM_BY_BRUSH_FAMILY_V1 = Object.freeze({
  "dry-media": "dry-media",
  pastel: "pastel",
  pencil: "pencil",
  watercolor: "watercolor",
  brush: "ink-wash",
  oil: "oil",
  calligraphy: "ink-wash",
  airbrush: "airbrush",
  pen: null,
  gpen: null,
  perfect: null,
  marker: "marker",
  highlighter: "marker",
  neon: null,
  glow: null,
  glitter: null,
  "ink-particle": null,
  screentone: null,
  stamp: null,
  pixel: null,
} as const satisfies Readonly<
  Record<StudioPaperBrushRenderFamilyV1, StudioPaperMediumV1 | null>
>);

export function resolveStudioPaperMediumForBrushFamilyV1(
  family: unknown,
): StudioPaperMediumV1 | null {
  if (
    typeof family !== "string"
    || !Object.hasOwn(STUDIO_PAPER_MEDIUM_BY_BRUSH_FAMILY_V1, family)
  ) {
    return null;
  }
  return STUDIO_PAPER_MEDIUM_BY_BRUSH_FAMILY_V1[
    family as StudioPaperBrushRenderFamilyV1
  ];
}

/** 패밀리의 기본 종이. 미지의 패밀리는 중립적인 켄트지로 정규화한다. */
export function resolveStudioDefaultPaperPresetForBrushFamilyV1(
  family: unknown,
): StudioPaperPresetV1 {
  if (
    typeof family !== "string"
    || !Object.hasOwn(STUDIO_PAPER_DEFAULT_PRESET_BY_BRUSH_FAMILY_V1, family)
  ) {
    return STUDIO_PAPER_PRESETS_V1.kent;
  }
  return STUDIO_PAPER_PRESETS_V1[
    STUDIO_PAPER_DEFAULT_PRESET_BY_BRUSH_FAMILY_V1[
      family as StudioPaperBrushRenderFamilyV1
    ]
  ];
}

export interface StudioPaperMediaModulationForBrushFamilyInputV1 {
  readonly family: StudioPaperBrushRenderFamilyV1 | string;
  readonly pressure: number;
  readonly thinness?: number;
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  /** 문서가 종이를 고정했으면 그 프리셋. 생략하면 패밀리 기본 낱장. */
  readonly preset?: StudioPaperPresetV1;
}

/**
 * 배선용 단일 진입점 — 패밀리에서 매체·기본 종이를 풀고 변조 벡터를 돌려준다.
 * 종이를 타지 않는 패밀리(null 매체)는 정확한 항등이다.
 */
export function resolveStudioPaperMediaModulationForBrushFamilyV1(
  input: StudioPaperMediaModulationForBrushFamilyInputV1,
): StudioPaperMediaModulationV1 {
  const medium = resolveStudioPaperMediumForBrushFamilyV1(input?.family);
  if (!medium) return STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1;
  const preset = input.preset ?? resolveStudioDefaultPaperPresetForBrushFamilyV1(input.family);
  return resolveStudioPaperMediaModulationV1({
    medium,
    preset,
    pressure: input.pressure,
    ...(typeof input.thinness === "number" ? { thinness: input.thinness } : {}),
    x: input.x,
    y: input.y,
    seed: input.seed,
  });
}
