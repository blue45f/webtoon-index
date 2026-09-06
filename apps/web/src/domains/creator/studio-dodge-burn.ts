/**
 * Studio Dodge/Burn — 닷지·번·스펀지 브러시 순수 코어.
 * 포토샵의 암실 보정 삼형제를 재현한다: 닷지(dodge)는 지나간 자리를 밝게, 번(burn)은 어둡게,
 * 스펀지(sponge)는 채도를 올리거나 뺀다. 닷지/번은 톤 범위(어두운/중간/밝은 영역)별 가우시안
 * 가중으로 해당 톤만 집중 보정하고, 색조(Hue)는 HSL 왕복으로 보존한다.
 *
 * studio-smudge.ts 의 관례를 그대로 따른다:
 *   - 픽셀 공간(원본 자연 해상도) 좌표·in-place 변형·같은 참조 반환(smudgeStroke 계약).
 *   - 경로 리샘플은 resampleSmudgePath 재사용(중복 금지 — smudge 가 flood-fill/magic-wand
 *     헬퍼를 재사용하는 것과 동일 정신). RGB↔HSL 도 studio-selective-hsl.ts 것을 재사용한다.
 *   - 하드니스 감쇠는 stampHealCloneDab(studio-heal-clone.ts)과 동일한 선형 엣지 페더
 *     (edgeStart = radius*hardness 부터 radius 까지 1→0).
 *
 * DOM 의존성 없음 — 이 파일 전체가 순수·결정적이다(Math.random/Date.now 금지). 캔버스/Image
 * 오케스트레이션(이미지 로드 → getImageData → dodgeBurnStroke → PNG 재인코딩)은 호출부
 * (StudioPage 의 applyDodgeBurnStroke)가 담당한다 — applyLiquifyStroke 와 동일 분리.
 */
import { hslToRgb, rgbToHsl } from "./studio-selective-hsl";
import { resampleSmudgePath, type SmudgePixelPoint } from "./studio-smudge";

// 픽셀 공간(원본 자연 해상도) 좌표 — smudge 와 같은 개념이라 타입을 공유한다.
export type DodgeBurnPixelPoint = SmudgePixelPoint;

export type DodgeBurnMode = "dodge" | "burn" | "sponge";
export type DodgeBurnRange = "shadows" | "midtones" | "highlights";
export type DodgeBurnSpongeMode = "saturate" | "desaturate";

export type DodgeBurnSettings = {
  /** 브러시 반경(px, 자연 해상도). */
  radiusPx: number;
  /** 0..1 — 1=하드 엣지, 0=최대 페더(HEAL_CLONE_HARDNESS_RANGE 와 동일 규약). */
  hardness: number;
  /** 노출(%, 1..100) — 도장(dab) 1개당 보정 강도로 환산된다. */
  exposure: number;
  mode: DodgeBurnMode;
  /** 닷지/번의 톤 범위 — sponge 모드에선 무시된다(포토샵 스펀지도 범위 개념이 없다). */
  range: DodgeBurnRange;
  /** sponge 모드 하위 동작 — dodge/burn 모드에선 무시된다. */
  sponge: DodgeBurnSpongeMode;
};

// 표시 px 기준 범위 — HEAL_CLONE_RADIUS_RANGE 와 동일 관례(자연 해상도 환산은 호출자 몫).
export const DODGE_BURN_RADIUS_RANGE = { min: 6, max: 160, step: 1 } as const;
export const DODGE_BURN_RADIUS_DEFAULT = 32;
export const DODGE_BURN_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const DODGE_BURN_HARDNESS_DEFAULT = 0.5;
export const DODGE_BURN_EXPOSURE_RANGE = { min: 1, max: 100, step: 1 } as const;
export const DODGE_BURN_EXPOSURE_DEFAULT = 50;

/** 모드 선택 칩 목록 — HEAL_CLONE_MODES 와 동일 관례(패널이 id/라벨/설명으로 사용). */
export const DODGE_BURN_MODES: { id: DodgeBurnMode; label: string; tip: string }[] = [
  { id: "dodge", label: "닷지", tip: "지나간 자리를 밝게 보정합니다(암실 인화의 빛 가리기)." },
  { id: "burn", label: "번", tip: "지나간 자리를 어둡게 보정합니다(암실 인화의 추가 노광)." },
  { id: "sponge", label: "스펀지", tip: "지나간 자리의 채도를 올리거나 뺍니다." },
];

/** 톤 범위 선택 칩 목록 — 닷지/번에서만 쓰인다. */
export const DODGE_BURN_RANGES: { id: DodgeBurnRange; label: string; tip: string }[] = [
  { id: "shadows", label: "어두운 영역", tip: "그림자 톤을 집중 보정합니다." },
  { id: "midtones", label: "중간 영역", tip: "중간 톤을 집중 보정합니다(기본값)." },
  { id: "highlights", label: "밝은 영역", tip: "하이라이트 톤을 집중 보정합니다." },
];

/** 스펀지 하위 동작 칩 목록. */
export const DODGE_BURN_SPONGE_MODES: { id: DodgeBurnSpongeMode; label: string; tip: string }[] = [
  { id: "saturate", label: "채도 올리기", tip: "지나간 자리의 색을 더 선명하게 만듭니다." },
  { id: "desaturate", label: "채도 빼기", tip: "지나간 자리의 색을 회색 쪽으로 뺍니다." },
];

// 리샘플 간격 = radiusPx * 이 비율(SMUDGE_STEP_RATIO 와 동일값 — 도장 겹침 밀도 통일).
const DODGE_BURN_STEP_RATIO = 0.35;
// 병적으로 긴 스트로크 방어 상한 — SMUDGE_MAX_RESAMPLED_POINTS 와 같은 정신.
const DODGE_BURN_MAX_DABS = 2000;
// 도장 1개당 최대 보정 비율(노출 100%·브러시 중심·톤 가중 1 기준). 도장이 STEP_RATIO 간격으로
// 겹쳐 누적되므로(반경당 ~3개) 1보다 훨씬 작아야 한 번 지나가는 스트로크가 즉시 클리핑되지
// 않는다 — 포토샵의 "여러 번 문지를수록 점점 진해지는" 에어브러시 누적 감각을 재현하는 상수.
const DODGE_BURN_DAB_GAIN = 0.16;

// 톤 범위 가중 가우시안 중심/폭 — 중간 영역은 L=0.5 에서 1, 어두운/밝은 영역은 양 끝에 치우친
// 중심을 쓴다(정확히 0/1 중심이면 반대쪽 절반이 사실상 전멸해 브러시가 "안 먹는" 느낌이 된다).
const DODGE_BURN_RANGE_CENTER: Record<DodgeBurnRange, number> = {
  shadows: 0.15,
  midtones: 0.5,
  highlights: 0.85,
};
const DODGE_BURN_RANGE_SIGMA = 0.22;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 톤 범위 가중(0..1) — HSL 명도 L(0..1)이 선택한 범위 중심에서 얼마나 가까운지의 가우시안.
 * 중간 영역은 L=0.5 에서 정확히 1. 순수, 결정적.
 */
export function dodgeBurnTonalWeight(lightness: number, range: DodgeBurnRange): number {
  const l = clamp01(lightness);
  const d = l - DODGE_BURN_RANGE_CENTER[range];
  return Math.exp(-(d * d) / (2 * DODGE_BURN_RANGE_SIGMA * DODGE_BURN_RANGE_SIGMA));
}

/**
 * 브러시 중심에서 dist 만큼 떨어진 픽셀의 감쇠(0..1) — stampHealCloneDab 과 동일한 선형 엣지
 * 페더: edgeStart = radius*hardness 까지 1, 그 밖은 radius 까지 1→0. radius 이상이면 0. 순수.
 */
export function dodgeBurnBrushFalloff(dist: number, radiusPx: number, hardness: number): number {
  const r = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
  if (r <= 0 || !Number.isFinite(dist) || dist > r) return 0;
  const edgeStart = r * clamp01(hardness);
  if (dist <= edgeStart) return 1;
  const span = Math.max(1e-6, r - edgeStart);
  return Math.max(0, 1 - (dist - edgeStart) / span);
}

/**
 * 도장(dab) 1개 적용 — data(RGBA, w*h*4)를 제자리에서 변형한다. 각 픽셀:
 *   1) RGB→HSL(studio-selective-hsl 재사용).
 *   2) amount = (exposure/100) * DODGE_BURN_DAB_GAIN * 브러시 감쇠 * (닷지/번이면 톤 가중).
 *   3) 닷지: L을 1 쪽으로 amount 비율만큼 보간(l + (1-l)*amount) — 절대 오버슈트하지 않는다.
 *      번: L을 0 쪽으로(l - l*amount). 색조 h·채도 s는 그대로 → 색이 뒤틀리지 않는다.
 *      스펀지: s ± amount(클램프 0..1). 무채색(s=0)은 건드리지 않는다 — h가 정의되지 않아
 *      채도를 올리면 존재하지 않던 빨강 색조가 발명되는 사고를 막는다(회색 보호,
 *      applySelectiveHsl 의 무채색 보호와 동일 정신).
 *   4) HSL→RGB 복원. 알파는 절대 바꾸지 않으며 완전 투명(a=0) 픽셀은 건너뛴다.
 * 이미지 경계 밖은 클램프된 박스로 안전하게 무시된다(크래시 없음). 순수, 결정적, 도장당 추가
 * 할당 없음(픽셀 루프는 지역 변수만 사용).
 */
export function applyDodgeBurnDab(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  center: DodgeBurnPixelPoint,
  settings: DodgeBurnSettings,
): void {
  const R = Number.isFinite(settings.radiusPx) ? Math.max(0, settings.radiusPx) : 0;
  const exposure = Number.isFinite(settings.exposure) ? settings.exposure : 0;
  if (R <= 0 || exposure <= 0 || w <= 0 || h <= 0) return;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;

  const gain = Math.min(1, exposure / 100) * DODGE_BURN_DAB_GAIN;
  if (gain <= 0) return;
  const { mode, range, sponge, hardness } = settings;

  const minX = clampInt(Math.floor(center.x - R), 0, w - 1);
  const maxX = clampInt(Math.ceil(center.x + R), 0, w - 1);
  const minY = clampInt(Math.floor(center.y - R), 0, h - 1);
  const maxY = clampInt(Math.ceil(center.y + R), 0, h - 1);
  if (minX > maxX || minY > maxY) return;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // dab 루프의 픽셀마다 Math.hypot 를 호출하지 않도록 제곱거리로 먼저 잘라낸다.
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy > R * R) continue;
      const falloff = dodgeBurnBrushFalloff(Math.sqrt(dx * dx + dy * dy), R, hardness);
      if (falloff <= 0) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] === 0) continue; // 완전 투명 — 보이지 않는 색을 보정하지 않는다.

      const hsl = rgbToHsl(data[idx]!, data[idx + 1]!, data[idx + 2]!);
      let nextS = hsl.s;
      let nextL = hsl.l;
      if (mode === "sponge") {
        if (hsl.s <= 0) continue; // 무채색 보호 — hue 미정의 픽셀에 채도를 발명하지 않는다.
        const amount = gain * falloff;
        nextS = clamp01(sponge === "saturate" ? hsl.s + amount : hsl.s - amount);
        if (nextS === hsl.s) continue;
      } else {
        const amount = gain * falloff * dodgeBurnTonalWeight(hsl.l, range);
        if (amount <= 0) continue;
        nextL = clamp01(mode === "dodge" ? hsl.l + (1 - hsl.l) * amount : hsl.l - hsl.l * amount);
        if (nextL === hsl.l) continue;
      }
      const rgb = hslToRgb(hsl.h, nextS, nextL);
      data[idx] = rgb.r;
      data[idx + 1] = rgb.g;
      data[idx + 2] = rgb.b;
      // 알파(idx+3)는 그대로.
    }
  }
}

/**
 * 스트로크 적용 — data 를 제자리에서 변형하고 같은 참조를 반환한다(smudgeStroke 계약과 동일 —
 * 호출부가 imageData.data 를 그대로 넘기고 그대로 쓴다).
 *
 * points 는 리샘플 전 원시 스트로크(자연 픽셀 좌표, 화면 반전이 이미 걷힌 상태 — 반전 처리는
 * wrapper 책임, smudgeStroke 와 동일 규약). smudge 와 달리 점 1개(탭)도 유효하다 — 포토샵
 * 닷지/번은 클릭 한 번으로도 도장 1개를 찍는다. points 가 비었거나 exposure <= 0 이면 무변화로
 * data 를 그대로 반환한다.
 *
 * 알고리즘: resampleSmudgePath 로 radius*0.35 간격 도장 위치를 얻은 뒤(상한
 * DODGE_BURN_MAX_DABS) 각 위치에 applyDodgeBurnDab 를 적용한다. 도장이 겹치며 누적되는 것이
 * 의도된 동작이다(같은 자리를 천천히 지날수록 진해지는 에어브러시 감각).
 */
export function dodgeBurnStroke(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  points: readonly DodgeBurnPixelPoint[],
  settings: DodgeBurnSettings,
): Uint8ClampedArray {
  if (points.length < 1 || w <= 0 || h <= 0) return data;
  const exposure = Number.isFinite(settings.exposure) ? settings.exposure : 0;
  if (exposure <= 0) return data;
  // sanitizePositive(studio-node-edit.ts)와 동일한 정신 — 비양수/NaN 반경은 최소 1px 로.
  const safeRadius = Number.isFinite(settings.radiusPx) ? Math.max(1, settings.radiusPx) : 1;
  const dabSettings: DodgeBurnSettings =
    settings.radiusPx === safeRadius ? settings : { ...settings, radiusPx: safeRadius };

  const step = safeRadius * DODGE_BURN_STEP_RATIO;
  const resampled = resampleSmudgePath(points, step).slice(0, DODGE_BURN_MAX_DABS);
  for (const p of resampled) applyDodgeBurnDab(data, w, h, p, dabSettings);
  return data;
}
