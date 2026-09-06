/**
 * Studio Light FX Engine
 * 포토샵/After Effects류 "광원 효과(Light FX)" — 앱에 없던 절차적 가산광을 모았다.
 *   lensFlare:  광원에 밝은 방사 코어 + 광원→화면중심 직선 위에 흩뿌린 2~3개의 옅은 고스트 디스크(고전적 렌즈 플레어).
 *   lightLeak:  광원 모서리/가장자리에서 가장 강하고 화면을 가로질러 옅어지는 부드러운 색 누출(필름 라이트 릭).
 *   sunburst:   광원에서 뻗어 나가는 방사 광선 — 밝기 = 방사 감쇠 * (0.5 + 0.5*각도 광선 패턴).
 *   glowStreak: 광원 가로줄을 관통하는 아나모픽 수평 스트릭(x로 넓고 y로 좁음) + 부드러운 코어.
 * 빛은 전부 SCREEN(가산) 합성으로 RGB 위에 얹되, intensity/100 과 픽셀 알파/255 양쪽으로 기여를 줄인다 —
 * 완전 투명(알파 0) 픽셀은 빛이 0이라 손대지 않는다(투명 영역 헤일로 없음). 알파(+3)는 절대 안 쓴다(읽기만).
 * 색은 hue→HSV로 만든 밝은 광색(코어는 화이트에 가깝게 터지고 hue는 감쇠부를 물들인다).
 * 전부 순수·결정적(Math.random/Date 없음) — 같은 입력은 항상 같은 출력이라 재현·단위 테스트 가능하다.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type LightType = "lensFlare" | "lightLeak" | "sunburst" | "glowStreak";

export type Light = {
  type: LightType; // 광원 종류(렌즈 플레어/라이트 릭/햇살/광선)
  intensity: number; // 0..100 가산광 세기(0이면 항등)
  x: number; // 0..100 광원 X(폭 대비 %)
  y: number; // 0..100 광원 Y(높이 대비 %)
  hue: number; // 0..360 광색 색상(HSV; 코어는 화이트에 가깝고 hue는 감쇠부를 물들임)
};

/** 항등(효과 없음) — intensity 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_LIGHT: Light = { type: "lensFlare", intensity: 0, x: 30, y: 30, hue: 45 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위(0=항등, 가산광 세기). */
export const LIGHT_INTENSITY_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 광원 X 슬라이더 한 칸 범위 — 0..100, 1 단위(폭 대비 %). */
export const LIGHT_X_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 광원 Y 슬라이더 한 칸 범위 — 0..100, 1 단위(높이 대비 %). */
export const LIGHT_Y_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 광색 색상(hue) 슬라이더 한 칸 범위 — 0..360, 1 단위(HSV). */
export const LIGHT_HUE_RANGE = { min: 0, max: 360, step: 1 } as const;

/** 광원 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const LIGHT_TYPES: { id: LightType; label: string }[] = [
  { id: "lensFlare", label: "렌즈 플레어" },
  { id: "lightLeak", label: "라이트 릭" },
  { id: "sunburst", label: "햇살" },
  { id: "glowStreak", label: "광선" },
];

// 유효 LightType 집합(외부 입력 검증용).
const LIGHT_TYPE_SET = new Set<LightType>(LIGHT_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 LightType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): LightType {
  return typeof raw === "string" && LIGHT_TYPE_SET.has(raw as LightType) ? (raw as LightType) : DEFAULT_LIGHT.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 LightType(아니면 기본 "lensFlare").
 */
export function normalizeLight(l?: Partial<Light> | null): Light {
  const src = l && typeof l === "object" ? l : {};
  return {
    type: normalizeType(src.type),
    intensity: clampTo(src.intensity, LIGHT_INTENSITY_RANGE.min, LIGHT_INTENSITY_RANGE.max, DEFAULT_LIGHT.intensity),
    x: clampTo(src.x, LIGHT_X_RANGE.min, LIGHT_X_RANGE.max, DEFAULT_LIGHT.x),
    y: clampTo(src.y, LIGHT_Y_RANGE.min, LIGHT_Y_RANGE.max, DEFAULT_LIGHT.y),
    hue: clampTo(src.hue, LIGHT_HUE_RANGE.min, LIGHT_HUE_RANGE.max, DEFAULT_LIGHT.hue),
  };
}

/** intensity<=0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityLight(l: Light): boolean {
  return l.intensity <= 0;
}

// ---------------------------------------------------------------------------
// 색·합성 유틸 — hue→광색(HSV), SCREEN(가산) 블렌드
// ---------------------------------------------------------------------------

// 광색 채도/명도 — 코어는 화이트에 가깝게 터지되 감쇠 중간부가 hue로 물들도록 적당한 채도.
const LIGHT_SATURATION = 0.5;
const LIGHT_VALUE = 1;

/**
 * HSV(h 0..360, s·v 0..1) → 0..255 RGB(반올림 안 함, 가산 누적에 쓰는 실수값).
 * 표준 변환. s=0이면 회색(v*255). hue는 (((h%360)+360)%360)으로 안전 래핑.
 */
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((((h % 360) + 360) % 360) / 60) | 0; // 0..5 섹터
  const f = (((h % 360) + 360) % 360) / 60 - hh; // 섹터 내 보간 비율
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r: number;
  let g: number;
  let b: number;
  switch (hh) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default: // 5
      r = v;
      g = p;
      b = q;
      break;
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

// SCREEN(가산) 블렌드 한 채널 — 255 - (255-s)*(255-l)/255. s·l 모두 0..255.
function screen(s: number, l: number): number {
  return 255 - ((255 - s) * (255 - l)) / 255;
}

// 부드러운 0→1 보간(smoothstep). e0..e1 사이를 3t²-2t³로 매끄럽게.
function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  let t = (x - e0) / (e1 - e0);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 절차적 가산광(제자리 변형, SCREEN 블렌드, intensity·알파 스케일, 알파 보존)
// ---------------------------------------------------------------------------

/**
 * 한 픽셀에 광색×falloff×k 만큼의 빛을 SCREEN으로 얹는다(제자리). r/g/b만,
 * k = (intensity/100)*(alpha/255). falloff·k가 0이면 사실상 no-op이라 투명/비조명 픽셀은 불변.
 * 비유한 falloff(NaN/Infinity)는 0으로 막아 채널 오염을 방지. 알파(+3)는 읽기만, 절대 안 쓴다.
 */
function addLight(
  data: Uint8ClampedArray,
  i: number,
  falloff: number,
  k: number,
  lr: number,
  lg: number,
  lb: number
): void {
  // 비유한(NaN/Infinity) falloff·k·광색은 전부 막아 채널 오염을 방지한다.
  // (정규화를 안 거친 직접 applyLight 호출에서 intensity NaN→k NaN, hue NaN→광색 NaN이 들어와도
  //  Uint8ClampedArray가 NaN을 0으로 클램프해 픽셀을 검게 만드는 버그를 차단.)
  if (!Number.isFinite(falloff) || !Number.isFinite(k) || falloff <= 0 || k <= 0) return;
  if (!Number.isFinite(lr) || !Number.isFinite(lg) || !Number.isFinite(lb)) return;
  const f = falloff > 1 ? 1 : falloff;
  const g = f * k; // 0..1 — 이 픽셀에 실제로 더해질 광량 비율
  data[i] = screen(data[i]!, lr * g);
  data[i + 1] = screen(data[i + 1]!, lg * g);
  data[i + 2] = screen(data[i + 2]!, lb * g);
}

/**
 * 라이트 FX 제자리 적용 — 항등(intensity<=0)이면 no-op. 종류별로 분기한다.
 *
 *   lensFlare:  광원 밝은 방사 코어 + 광원→화면중심 직선 위 2~3개 옅은 고스트 디스크.
 *   lightLeak:  광원에서 거리·방향으로 부드럽게 감쇠하는 색 누출(모서리 누출 무드).
 *   sunburst:   방사 감쇠 * (0.5 + 0.5*각도 광선 패턴)으로 광선 다발을 낸다.
 *   glowStreak: 광원 가로줄을 관통하는 아나모픽 수평 스트릭 + 부드러운 코어.
 *
 * 모든 종류가 SCREEN 가산으로 r/g/b만 밝히고 알파(+3)는 보존한다(intensity·알파 스케일). 같은 입력=같은 출력(결정적).
 */
export function applyLight(img: StudioImageDataLike, l: Light): void {
  if (isIdentityLight(l)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const intensity = l.intensity / 100; // 0..1 세기
  const { r: lr, g: lg, b: lb } = hsvToRgb(l.hue, LIGHT_SATURATION, LIGHT_VALUE); // 광색(실수 0..255)
  // 광원 픽셀 위치(폭/높이 대비 %). 음수/초과는 normalize가 막지만 좌표 자체는 화면 밖일 수 있다(의도).
  const sx = (l.x / 100) * width;
  const sy = (l.y / 100) * height;

  switch (l.type) {
    case "lensFlare":
      applyLensFlare(data, width, height, sx, sy, intensity, lr, lg, lb);
      break;
    case "lightLeak":
      applyLightLeak(data, width, height, sx, sy, intensity, lr, lg, lb);
      break;
    case "sunburst":
      applySunburst(data, width, height, sx, sy, intensity, lr, lg, lb);
      break;
    case "glowStreak":
      applyGlowStreak(data, width, height, sx, sy, intensity, lr, lg, lb);
      break;
  }
}

// 화면 대각 길이(반경 정규화 기준) — 광원이 화면 밖이어도 안정적인 스케일.
function diagonalOf(width: number, height: number): number {
  const d = Math.sqrt(width * width + height * height);
  return d > 0 ? d : 1;
}

/**
 * 광원 픽셀 순회 공통 루프 — 각 픽셀에서 인덱스 i, 세기×알파 k(=intensity*alpha/255)를 구하고
 * 완전 투명/비조명(k<=0)은 건너뛴 뒤, 광원 기준 오프셋(dx=x-sx, dy=y-sy)으로 falloffAt를 호출해
 * 그 falloff를 addLight로 SCREEN 가산한다. 종류별로 다른 건 falloff 계산뿐이다.
 */
function forEachLitPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  intensity: number,
  lr: number,
  lg: number,
  lb: number,
  falloffAt: (x: number, y: number, dx: number, dy: number) => number
): void {
  for (let y = 0; y < height; y++) {
    const dy = y - sy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const k = intensity * (data[i + 3]! / 255); // 세기×알파
      if (k <= 0) continue; // 완전 투명 등은 손대지 않음
      const dx = x - sx;
      const falloff = falloffAt(x, y, dx, dy);
      addLight(data, i, falloff, k, lr, lg, lb);
    }
  }
}

/**
 * 렌즈 플레어 — 광원에 밝은 방사 코어(가까울수록 1) + 광원에서 화면중심 방향으로
 * 직선을 따라 흩뿌린 3개의 옅은 고스트 디스크. 각 디스크는 자기 중심에 가까울수록 밝다(부드러운 가우시안형).
 * 코어 반경/고스트 반경은 대각선에 비례. 픽셀별로 코어+고스트 falloff의 합을 SCREEN으로 얹는다.
 */
function applyLensFlare(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  intensity: number,
  lr: number,
  lg: number,
  lb: number
): void {
  const diag = diagonalOf(width, height);
  const cx = width / 2;
  const cy = height / 2;
  // 화면 중심으로 향하는 직선 위에 고스트 배치(고전적 플레어). 광원이 정확히 중심이면 가로 방향 폴백.
  let dirX = cx - sx;
  let dirY = cy - sy;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || (dirX === 0 && dirY === 0)) {
    dirX = 1;
    dirY = 0;
  }
  const coreR = diag * 0.22; // 메인 코어 반경
  const coreR2 = coreR * coreR;
  // 고스트: 광원→중심 보간 t(0=광원, 1=중심) 위치에 반경·세기 다르게.
  const ghosts: { t: number; r: number; w: number }[] = [
    { t: 0.45, r: diag * 0.05, w: 0.5 },
    { t: 0.8, r: diag * 0.09, w: 0.35 },
    { t: 1.15, r: diag * 0.06, w: 0.45 },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const k = intensity * (data[i + 3]! / 255); // 세기×알파
      if (k <= 0) continue; // 완전 투명 등은 손대지 않음
      // 메인 코어 — 광원에서의 거리 기반 부드러운 방사 감쇠.
      const dxc = x - sx;
      const dyc = y - sy;
      const distC2 = dxc * dxc + dyc * dyc;
      let falloff = distC2 < coreR2 ? Math.pow(1 - distC2 / coreR2, 1.6) : 0;
      // 고스트 디스크 합산.
      for (let gi = 0; gi < ghosts.length; gi++) {
        const gst = ghosts[gi]!;
        const gx = sx + dirX * gst.t;
        const gy = sy + dirY * gst.t;
        const gr2 = gst.r * gst.r;
        const gdx = x - gx;
        const gdy = y - gy;
        const gd2 = gdx * gdx + gdy * gdy;
        if (gd2 < gr2) falloff += gst.w * Math.pow(1 - gd2 / gr2, 1.6);
      }
      addLight(data, i, falloff, k, lr, lg, lb);
    }
  }
}

/**
 * 라이트 릭 — 광원에서 멀어질수록 부드럽게 사라지는 색 누출(필름 모서리 누출).
 * falloff = smoothstep(1→0, 정규화 거리)에 방향 가중(광원 쪽 가장자리에서 더 강함)을 곱한다.
 * 대각선 0.9배 거리에서 거의 사라지도록 정규화. 부드럽고 넓게 번지는 색 워시.
 */
function applyLightLeak(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  intensity: number,
  lr: number,
  lg: number,
  lb: number
): void {
  const diag = diagonalOf(width, height);
  const reach = diag * 0.9; // 누출이 거의 사라지는 거리
  forEachLitPixel(data, width, height, sx, sy, intensity, lr, lg, lb, (_x, _y, dx, dy) => {
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 광원 근처는 1, reach 부근에서 0으로 부드럽게.
    return 1 - smoothstep(0, reach, dist);
  });
}

// 광선 다발 수(sunburst) — 각도 패턴 주기. 짝수여도 무방.
const SUNBURST_RAYS = 12;

/**
 * 햇살 — 광원에서 뻗는 방사 광선. 밝기 = 방사 감쇠 * (0.5 + 0.5*각도 광선 패턴).
 * 각도 패턴 = (cos(rays*θ)+1)/2 의 매끈한 봉우리(0..1). 방사 감쇠는 대각선 0.85배에서 사라진다.
 * 코어(광원 근처)는 광선과 무관하게 밝아 자연스럽게 터진다.
 */
function applySunburst(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  intensity: number,
  lr: number,
  lg: number,
  lb: number
): void {
  const diag = diagonalOf(width, height);
  const reach = diag * 0.85; // 광선이 사라지는 거리
  const coreR = diag * 0.06; // 광선 무관 밝은 코어 반경
  forEachLitPixel(data, width, height, sx, sy, intensity, lr, lg, lb, (_x, _y, dx, dy) => {
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 방사 감쇠(광원 1 → reach 0).
    const radial = 1 - smoothstep(0, reach, dist);
    // 각도 광선 패턴(0..1) — 광원 정점에서는 각도가 불안정하므로 코어로 가린다.
    const ang = Math.atan2(dy, dx);
    const ray = (Math.cos(SUNBURST_RAYS * ang) + 1) / 2; // 0..1
    // 광선 변조 밝기 + 코어 보강.
    const core = dist < coreR ? 1 - dist / coreR : 0;
    return radial * (0.5 + 0.5 * ray) + core;
  });
}

/**
 * 광선 스트릭 — 광원 가로줄을 관통하는 아나모픽 수평 스트릭(x로 넓고 y로 좁음) + 부드러운 코어.
 * 세로 감쇠는 좁은 가우시안(σy 작음), 가로 감쇠는 넓은 가우시안(σx 큼)이라 가로로 길게 늘어진 빛줄기를 만든다.
 * 추가로 광원 근처 둥근 코어를 보강해 중심이 자연스럽게 터진다.
 */
function applyGlowStreak(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  intensity: number,
  lr: number,
  lg: number,
  lb: number
): void {
  const diag = diagonalOf(width, height);
  const sigmaX = diag * 0.5; // 가로로 넓은 퍼짐
  const sigmaY = Math.max(1, height * 0.04); // 세로로 좁은 퍼짐(아나모픽)
  const coreR = diag * 0.05; // 둥근 코어 반경
  const twoSx2 = 2 * sigmaX * sigmaX;
  const twoSy2 = 2 * sigmaY * sigmaY;
  for (let y = 0; y < height; y++) {
    const dy = y - sy;
    const yTerm = (dy * dy) / twoSy2; // 행마다 고정인 세로 항
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const k = intensity * (data[i + 3]! / 255);
      if (k <= 0) continue;
      const dx = x - sx;
      // 아나모픽 스트릭 = exp(-(dx²/2σx²) - (dy²/2σy²)).
      const streak = Math.exp(-((dx * dx) / twoSx2) - yTerm);
      // 둥근 코어 보강.
      const dist = Math.sqrt(dx * dx + dy * dy);
      const core = dist < coreR ? 1 - dist / coreR : 0;
      const falloff = streak + core;
      addLight(data, i, falloff, k, lr, lg, lb);
    }
  }
}

// ---------------------------------------------------------------------------
// 라이트 FX 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 광원 조합.
// 모든 value는 normalizeLight를 통과(intensity·x·y 0..100, hue 0..360, type 유효).
// ---------------------------------------------------------------------------

export type LightPreset = { id: string; label: string; tip: string; value: Light };

export const LIGHT_PRESETS: LightPreset[] = [
  {
    id: "lens-flare",
    label: "렌즈 플레어",
    tip: "광원에서 번지는 밝은 코어와 고스트로 카메라 렌즈 플레어를 연출합니다.",
    value: normalizeLight({ type: "lensFlare", intensity: 65, x: 72, y: 24, hue: 45 }),
  },
  {
    id: "sunburst-warm",
    label: "햇살",
    tip: "따뜻한 방사 광선으로 창문이나 하늘에서 쏟아지는 햇살을 표현합니다.",
    value: normalizeLight({ type: "sunburst", intensity: 70, x: 30, y: 18, hue: 42 }),
  },
  {
    id: "light-leak",
    label: "라이트 릭",
    tip: "마젠타·틸 빛이 모서리에서 새어 드는 필름 라이트 릭 무드를 더합니다.",
    value: normalizeLight({ type: "lightLeak", intensity: 55, x: 92, y: 88, hue: 315 }),
  },
  {
    id: "glow-streak",
    label: "광선 스트릭",
    tip: "가로로 길게 늘어진 아나모픽 빛줄기로 시네마틱 글로우를 만듭니다.",
    value: normalizeLight({ type: "glowStreak", intensity: 60, x: 50, y: 38, hue: 205 }),
  },
  {
    id: "golden-hour",
    label: "골든아워",
    tip: "황금빛 누출로 해 질 녘 골든아워의 포근한 빛을 감쌉니다.",
    value: normalizeLight({ type: "lightLeak", intensity: 50, x: 8, y: 16, hue: 38 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeLight로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 ltType(string)과
 * ltIntensity·ltX·ltY·ltHue(각 number)를 읽어 normalizeLight로 안전 변환 후 applyLight.
 * 항등(intensity 0)이거나 attrs가 비면 no-op.
 */
export function lightKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const l = normalizeLight({
    type: typeof attrs.ltType === "string" ? (attrs.ltType as LightType) : undefined,
    intensity: attrNumber(attrs.ltIntensity),
    x: attrNumber(attrs.ltX),
    y: attrNumber(attrs.ltY),
    hue: attrNumber(attrs.ltHue),
  });
  if (isIdentityLight(l)) return;
  applyLight(imageData, l);
}
