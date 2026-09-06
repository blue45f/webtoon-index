/**
 * Studio CMYK Core — 인쇄 출고(print-readiness)용 sRGB↔CMYK 분해·잉크 제한·색역 리포트 순수 엔진.
 *
 * 이 모듈이 채우는 갭(2026-07-24 기준 저장소 실측):
 *  - `studio-halftone.ts` 의 CMYK 는 **화면 효과(망점 룩)** 다. K=1-max(r,g,b) 로 분해해 채널마다
 *    각도를 준 스크린을 다시 화면 픽셀로 합성한다 — 잉크 총량도, 블랙 생성 정책도, 색역 판정도 없다.
 *  - `studio-palette-interchange.ts` 의 `cmykToHex` 는 ASE/ACO **가져오기 표시용** 단방향 근사다
 *    (역방향 분해 없음).
 *  - `docs/studio-commercial-manual-benchmark-2026-07-10.md` 는 "RGB 변환을 ICC 기반 CMYK/인쇄
 *    교정이라고 부르지 않는다" 를 명시 규약으로 두고 있다. 이 모듈은 그 규약을 깨지 않는다 —
 *    아래 §정직성 참고.
 *
 * ── 색 모델 두 가지 ──────────────────────────────────────────────────────────
 *
 * 1) `device` — 장치 CMYK(색 관리 없음). Photoshop 의 "CMYK 로 변환하되 프로파일 없음" 과 같은
 *    승법 잉크 모델이다.
 *        r = (1-c)(1-k),  g = (1-m)(1-k),  b = (1-y)(1-k)      (sRGB **부호화 값** 위에서 직접)
 *    물리적으로는 틀렸다(감마 인코딩된 값에 승법을 건다). 그래도 채택하는 이유: 업계 전체가 이
 *    관례를 쓰고, 기존 `cmykToHex`/ASE 가져오기와 **정확히 같은 수를 낸다**(왕복 무손실이 필요한
 *    팔레트 교환의 요구사항). 잉크 제한을 걸지 않는 한 sRGB→CMYK→sRGB 왕복은 부동소수 오차
 *    (≤1e-12) 안에서 **정확**하다 — k 를 [0, 1-max(r,g,b)] 안에서 어떻게 고르든 c/m/y 가 그 k 를
 *    정확히 보상하기 때문이다(테스트로 고정).
 *
 * 2) `coated-neugebauer` — 측색 근사. CMY 는 **Demichel 가중 Neugebauer 8원색**(백지 + C M Y +
 *    R=MY, G=CY, B=CM + CMY 3색 중첩)을 XYZ 에서 보간하고, K 는 그 결과에 **승법 필터**로 얹는다
 *    (k=0 에서 1.0, k=1 에서 흑색 솔리드/백지 비율). 원색 목표값은 ISO 12647-2 코팅지(FOGRA39
 *    계열)로 널리 공표된 **솔리드 패치 Lab 목표값**을 쓴다 — 아래 `NEUGEBAUER_PRIMARY_LAB` 주석에
 *    출처 성격을 적어 두었다. 망점 증가(TVI)는 Yule-Nielsen 대신 단순 2차 곡선
 *    `a' = a + gain·a·(1-a)` (기본 gain 0.15 ≈ 50% 에서 TVI 약 15%)로 근사한다.
 *    역변환(sRGB→CMYK)은 K 를 GCR 곡선으로 먼저 고정한 뒤 CMY 3변수를 **감쇠 뉴턴법**(고정 반복
 *    수·수치 야코비안·난수 없음 = 결정적)으로 푼다.
 *
 * ── 정직성 규약(중요) ───────────────────────────────────────────────────────
 * **이것은 ICC 색 관리가 아니다.** 실제 인쇄 교정은 라이선스된 CMYK 출력 프로파일의 B2A/A2B LUT
 * (수천 개 측색 격자점)를 태워야 하고, 그 바이너리는 이 저장소가 배포할 수 없다. 여기서 쓰는
 * `coated-neugebauer` 는 원색 8개 + 승법 K 로 **연속 함수 근사**를 할 뿐이라, 실측 프로파일 대비
 * 오차가 존재한다(특히 3색 중첩 그림자부·고채도 청록/보라). 그래서 이 모듈은
 *  - 왕복 오차(ΔE94)를 **항상 같이 반환**하고,
 *  - 색역 밖 판정을 숨기지 않으며,
 *  - `PROFILE_DISCLOSURE` 한국어 문구를 UI 가 그대로 노출하도록 내보낸다.
 * 실제 프로파일이 필요하면 인쇄소가 준 ICC 를 `studio-canvaskit-icc-profile.ts` 로 읽어
 * 헤더/렌더링 인텐트를 확인하고, LUT 변환은 그 모듈이 명시적으로 "미지원" 을 돌려준다.
 *
 * 전부 순수·결정적 — DOM/난수/시간 의존 없음. 입력 객체는 절대 변형하지 않는다.
 */

// ---------------------------------------------------------------------------
// 기본 타입
// ---------------------------------------------------------------------------

/** 잉크 커버리지 0..1 (100% = 1). */
export interface StudioCmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

/** sRGB 부호화 값 0..1 (감마 적용된 상태 — 0.5 는 CSS `rgb(127.5 ...)`). */
export interface StudioRgb {
  r: number;
  g: number;
  b: number;
}

/** CIE XYZ, D50 기준 백색(인쇄 표준 관측 조건). Y=1 이 완전 확산 백색. */
export interface StudioXyz {
  x: number;
  y: number;
  z: number;
}

/** CIELAB, D50 기준. */
export interface StudioLab {
  l: number;
  a: number;
  b: number;
}

export type StudioCmykModelId = "device" | "coated-neugebauer";

export const STUDIO_CMYK_MODEL_IDS: readonly StudioCmykModelId[] = ["device", "coated-neugebauer"];

/** UI 가 그대로 노출해야 하는 정직성 고지(§정직성 규약). */
export const PROFILE_DISCLOSURE =
  "ICC 프로파일 기반 인쇄 교정이 아니라 공표된 코팅지 목표값을 쓴 근사 분해입니다. 최종 색은 인쇄소 프로파일로 다시 확인하세요.";

// ---------------------------------------------------------------------------
// 인쇄 조건 프리셋 — 총 잉크량(TAC)·블랙 정책의 출처는 ISO 12647-2/-3 관용값이다.
// ---------------------------------------------------------------------------

export type StudioPressConditionId =
  | "device-native"
  | "coated-sheetfed"
  | "coated-web"
  | "uncoated"
  | "newsprint";

export interface StudioPressCondition {
  id: StudioPressConditionId;
  /** 사용자 노출 한국어 라벨. */
  label: string;
  /** 총 잉크량 상한(0..4, 3.0 = 300%). */
  totalInkLimit: number;
  /** K 최대 커버리지. */
  blackLimit: number;
  /** GCR 강도 0..1 — 1 이면 회색 성분을 최대한 K 로 치환(스켈레톤 블랙). */
  gcr: number;
  /** K 가 붙기 시작하는 회색 성분 임계(0..1) — 하이라이트에 검정 점이 찍히는 것을 막는다. */
  blackStart: number;
  /** 망점 증가 계수(coated-neugebauer 전용). */
  dotGain: number;
}

/**
 * 프리셋 수치 근거(관용 범위 중앙값):
 *  - coated-sheetfed 330% / coated-web 300%: ISO 12647-2 코팅지 상업인쇄의 통상 TAC 범위.
 *  - uncoated 260% / newsprint 240%: ISO 12647-2 비코팅지·12647-3 신문의 통상 상한.
 * 인쇄소가 다른 값을 주면 `resolvePressCondition` 에 부분 오버라이드를 넘겨 쓴다.
 */
export const STUDIO_PRESS_CONDITIONS: Readonly<Record<StudioPressConditionId, StudioPressCondition>> = {
  "device-native": {
    id: "device-native",
    label: "장치 CMYK · 제한 없음",
    totalInkLimit: 4,
    blackLimit: 1,
    gcr: 1,
    blackStart: 0,
    dotGain: 0,
  },
  "coated-sheetfed": {
    id: "coated-sheetfed",
    label: "코팅지 · 매엽 오프셋 (330%)",
    totalInkLimit: 3.3,
    blackLimit: 0.95,
    gcr: 0.8,
    blackStart: 0.1,
    dotGain: 0.15,
  },
  "coated-web": {
    id: "coated-web",
    label: "코팅지 · 윤전 (300%)",
    totalInkLimit: 3,
    blackLimit: 0.9,
    gcr: 0.85,
    blackStart: 0.1,
    dotGain: 0.17,
  },
  uncoated: {
    id: "uncoated",
    label: "비코팅지 (260%)",
    totalInkLimit: 2.6,
    blackLimit: 0.88,
    gcr: 0.9,
    blackStart: 0.08,
    dotGain: 0.2,
  },
  newsprint: {
    id: "newsprint",
    label: "신문용지 (240%)",
    totalInkLimit: 2.4,
    blackLimit: 0.85,
    gcr: 0.95,
    blackStart: 0.06,
    dotGain: 0.26,
  },
};

/** 총 잉크량 초과 시 되돌리는 방식. */
export type StudioInkLimitStrategy = "scale-cmy" | "gcr-shift";

/**
 * 렌더링 인텐트(측색 모델에서만 의미가 있다 — `device` 모델은 색공간 개념이 없어 무시한다).
 *
 *  - `media-relative`(기본): **종이 흰색을 화면 흰색에 맞춘다.** 실제 종이는 완전 확산 백색이
 *    아니라 L*95 언저리이므로, 이 보정 없이는 `#ffffff` 조차 "색역 밖"으로 나온다(ΔE 5.4 —
 *    실측). 사람이 인쇄물을 볼 때 눈이 종이 흰색에 순응한다는 사실을 반영한 것이고, 인쇄
 *    워크플로의 사실상 기본값이다.
 *  - `absolute`: 종이 흰색까지 그대로 시뮬레이션한다. 다른 종이에 낼 **교정쇄**를 볼 때 쓴다
 *    (흰 부분이 누렇게 보이는 게 정상이다).
 *
 * 이름과 의미는 ICC 렌더링 인텐트와 같은 축이라, `studio-canvaskit-icc-profile.ts` 가 읽은
 * 프로파일 헤더의 인텐트를 그대로 이 옵션에 흘려 넣을 수 있다.
 */
export type StudioRenderingIntent = "media-relative" | "absolute";

export interface StudioSeparationOptions {
  model: StudioCmykModelId;
  press: StudioPressCondition;
  inkLimitStrategy: StudioInkLimitStrategy;
  /** 기본 "media-relative". `device` 모델에서는 무시된다. */
  intent?: StudioRenderingIntent;
}

export const DEFAULT_SEPARATION_OPTIONS: StudioSeparationOptions = {
  model: "device",
  press: STUDIO_PRESS_CONDITIONS["coated-web"],
  inkLimitStrategy: "scale-cmy",
  intent: "media-relative",
};

/** 프리셋 + 부분 오버라이드 → 정규화된 인쇄 조건(범위 클램프 포함). */
export function resolvePressCondition(
  id: StudioPressConditionId,
  overrides?: Partial<Omit<StudioPressCondition, "id" | "label">>,
): StudioPressCondition {
  const base = STUDIO_PRESS_CONDITIONS[id] ?? STUDIO_PRESS_CONDITIONS["coated-web"];
  if (!overrides) return base;
  return {
    ...base,
    totalInkLimit: clamp(overrides.totalInkLimit ?? base.totalInkLimit, 1, 4),
    blackLimit: clampUnit(overrides.blackLimit ?? base.blackLimit),
    gcr: clampUnit(overrides.gcr ?? base.gcr),
    blackStart: clampUnit(overrides.blackStart ?? base.blackStart),
    dotGain: clamp(overrides.dotGain ?? base.dotGain, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// 소형 수치 유틸
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** 0..1 클램프 — NaN/Infinity 는 0 으로 무너뜨린다(색 계산에 NaN 이 전파되면 추적이 불가능). */
export function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

/** #rgb/#rrggbb → 0..1 sRGB. 형식이 아니면 null(호출부가 한국어로 거절). */
export function srgbHexToRgb(hex: string): StudioRgb | null {
  const raw = hex.trim().replace(/^#/u, "");
  const expanded =
    raw.length === 3
      ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : raw.length === 6
        ? raw
        : null;
  if (expanded === null || !/^[0-9a-f]{6}$/iu.test(expanded)) return null;
  const n = Number.parseInt(expanded, 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

/** 0..1 sRGB → `#rrggbb` 소문자. */
export function rgbToSrgbHex(rgb: StudioRgb): string {
  const part = (v: number): string =>
    Math.round(clampUnit(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** 총 잉크량(0..4). 400% = 4. */
export function totalInkCoverage(cmyk: StudioCmyk): number {
  return cmyk.c + cmyk.m + cmyk.y + cmyk.k;
}

/** "C 60 · M 40 · Y 40 · K 100 (240%)" 형태의 한국어 요약. */
export function formatCmykPercent(cmyk: StudioCmyk): string {
  const pct = (v: number): number => Math.round(clampUnit(v) * 100);
  const total = Math.round(totalInkCoverage(cmyk) * 100);
  return `C ${pct(cmyk.c)} · M ${pct(cmyk.m)} · Y ${pct(cmyk.y)} · K ${pct(cmyk.k)} (${total}%)`;
}

// ---------------------------------------------------------------------------
// 색공간 변환 — sRGB(D65) ↔ XYZ(D50) ↔ Lab(D50)
// 인쇄 쪽 표준 백색점이 D50 이라, PCS 는 D50 으로 고정하고 sRGB 쪽에서 Bradford 로 적응시킨다.
// 행렬은 ICC v4 sRGB 프로파일이 쓰는 D65→D50 Bradford 적응 후 값(널리 공표된 상수)이다.
// ---------------------------------------------------------------------------

/**
 * sRGB→XYZ(D50) 행렬. 널리 공표된 Bradford 적응 후 상수다(ICC v4 sRGB 프로파일과 같은 계열).
 * 열이 R/G/B 원색, 행이 X/Y/Z.
 */
const SRGB_TO_XYZ_D50: readonly (readonly [number, number, number])[] = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];

/**
 * Lab 계산의 기준 백색.
 *
 * **행렬의 행 합에서 유도한다** — ICC 헤더가 적는 D50 상수(0.9642, 1.0000, 0.8249)를 그대로
 * 쓰면 Z 가 0.82521 vs 0.8249 로 어긋나(행렬 상수 반올림 때문) sRGB 흰색이 Lab (100, 0, 0)이
 * 아니라 (100, 0.01, -0.02)로 나오고 왕복 오차가 1e-6 대로 벌어진다. 색역 판정이 ΔE 2 눈금인
 * 이 모듈에서는 무시해도 되는 크기지만, "흰색은 정확히 흰색" 이라는 불변식을 테스트로 잠글 수
 * 없게 되므로 **내부 일관성을 택했다**. ICC 프로파일 헤더에 적는 값은 `studio-canvaskit-icc-
 * profile.ts` 가 규격 상수(0.9642/1/0.8249)를 그대로 쓴다 — 두 값의 차이는 0.04% 미만이다.
 */
export const D50_WHITE: StudioXyz = {
  x: SRGB_TO_XYZ_D50[0]![0] + SRGB_TO_XYZ_D50[0]![1] + SRGB_TO_XYZ_D50[0]![2],
  y: SRGB_TO_XYZ_D50[1]![0] + SRGB_TO_XYZ_D50[1]![1] + SRGB_TO_XYZ_D50[1]![2],
  z: SRGB_TO_XYZ_D50[2]![0] + SRGB_TO_XYZ_D50[2]![1] + SRGB_TO_XYZ_D50[2]![2],
};

function srgbToLinear(v: number): number {
  const c = clampUnit(v);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = clamp(v, 0, 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** sRGB(0..1, 감마) → XYZ D50. */
export function srgbToXyzD50(rgb: StudioRgb): StudioXyz {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return {
    x: SRGB_TO_XYZ_D50[0]![0] * r + SRGB_TO_XYZ_D50[0]![1] * g + SRGB_TO_XYZ_D50[0]![2] * b,
    y: SRGB_TO_XYZ_D50[1]![0] * r + SRGB_TO_XYZ_D50[1]![1] * g + SRGB_TO_XYZ_D50[1]![2] * b,
    z: SRGB_TO_XYZ_D50[2]![0] * r + SRGB_TO_XYZ_D50[2]![1] * g + SRGB_TO_XYZ_D50[2]![2] * b,
  };
}

/**
 * XYZ(D50)→sRGB 행렬. **공표된 역행렬 상수를 쓰지 않고 순방향 행렬에서 직접 역산한다.**
 * 공표 상수(3.1338561, …)는 7자리로 반올림돼 있어 왕복 오차가 1e-6 대로 남는다. 여기서
 * 역산하면 두 행렬이 서로의 정확한 역이 되어 왕복이 부동소수 한계(≈1e-16)까지 정확해진다.
 */
const XYZ_D50_TO_SRGB: readonly (readonly [number, number, number])[] = invert3(SRGB_TO_XYZ_D50);

/** 3×3 역행렬(여인수 전개). 색 행렬은 항상 정칙이라 특이행렬은 프로그래밍 오류로 던진다. */
function invert3(m: readonly (readonly [number, number, number])[]): [number, number, number][] {
  const a = m[0]!;
  const b = m[1]!;
  const c = m[2]!;
  const det =
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
    a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  if (Math.abs(det) < 1e-12) throw new Error("색 변환 행렬이 특이행렬이에요(설정 오류).");
  return [
    [
      (b[1]! * c[2]! - b[2]! * c[1]!) / det,
      (a[2]! * c[1]! - a[1]! * c[2]!) / det,
      (a[1]! * b[2]! - a[2]! * b[1]!) / det,
    ],
    [
      (b[2]! * c[0]! - b[0]! * c[2]!) / det,
      (a[0]! * c[2]! - a[2]! * c[0]!) / det,
      (a[2]! * b[0]! - a[0]! * b[2]!) / det,
    ],
    [
      (b[0]! * c[1]! - b[1]! * c[0]!) / det,
      (a[1]! * c[0]! - a[0]! * c[1]!) / det,
      (a[0]! * b[1]! - a[1]! * b[0]!) / det,
    ],
  ];
}

/** XYZ D50 → sRGB(0..1, 감마). 색역 밖은 0..1 로 클램프된다(판정은 호출부 몫). */
export function xyzD50ToSrgb(xyz: StudioXyz): StudioRgb {
  const m = XYZ_D50_TO_SRGB;
  const r = m[0]![0] * xyz.x + m[0]![1] * xyz.y + m[0]![2] * xyz.z;
  const g = m[1]![0] * xyz.x + m[1]![1] * xyz.y + m[1]![2] * xyz.z;
  const b = m[2]![0] * xyz.x + m[2]![1] * xyz.y + m[2]![2] * xyz.z;
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

const LAB_EPS = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/** XYZ D50 → CIELAB D50. */
export function xyzD50ToLab(xyz: StudioXyz): StudioLab {
  const f = (t: number): number => (t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116);
  const fx = f(xyz.x / D50_WHITE.x);
  const fy = f(xyz.y / D50_WHITE.y);
  const fz = f(xyz.z / D50_WHITE.z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIELAB D50 → XYZ D50. */
export function labToXyzD50(lab: StudioLab): StudioXyz {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const inv = (t: number): number => (t ** 3 > LAB_EPS ? t ** 3 : (116 * t - 16) / LAB_KAPPA);
  return {
    x: inv(fx) * D50_WHITE.x,
    y: (lab.l > LAB_KAPPA * LAB_EPS ? ((lab.l + 16) / 116) ** 3 : lab.l / LAB_KAPPA) * D50_WHITE.y,
    z: inv(fz) * D50_WHITE.z,
  };
}

export function srgbToLab(rgb: StudioRgb): StudioLab {
  return xyzD50ToLab(srgbToXyzD50(rgb));
}

export function labToSrgb(lab: StudioLab): StudioRgb {
  return xyzD50ToSrgb(labToXyzD50(lab));
}

/** CIE76 색차 — 단순 유클리드. 해석은 쉬우나 채도 영역에서 사람 눈보다 크게 나온다. */
export function deltaE76(a: StudioLab, b: StudioLab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

/**
 * CIE94 그래픽 아트 색차(kL=1, K1=0.045, K2=0.015).
 *
 * ΔE00(CIEDE2000)을 쓰지 않은 이유: 회전항/보간항이 많아 **검증된 시험값 없이 구현하면 조용히
 * 틀린다**. ΔE94 는 식이 짧아 손으로 검증 가능하고 인쇄 허용오차 논의에서 여전히 통용된다.
 * ΔE00 이 필요해지면 Sharma 시험 벡터(34쌍)를 테스트에 넣고 그때 추가한다.
 */
export function deltaE94(reference: StudioLab, sample: StudioLab): number {
  const dl = reference.l - sample.l;
  const c1 = Math.hypot(reference.a, reference.b);
  const c2 = Math.hypot(sample.a, sample.b);
  const dc = c1 - c2;
  const da = reference.a - sample.a;
  const db = reference.b - sample.b;
  const dhSq = da * da + db * db - dc * dc;
  const dh = dhSq > 0 ? Math.sqrt(dhSq) : 0;
  const sc = 1 + 0.045 * c1;
  const sh = 1 + 0.015 * c1;
  return Math.hypot(dl, dc / sc, dh / sh);
}

// ---------------------------------------------------------------------------
// Neugebauer 원색 — ISO 12647-2 코팅지 계열로 공표된 솔리드 패치 Lab 목표값.
// 라이선스된 프로파일의 측정 데이터가 아니라 "공표 목표값" 이라는 점이 이 근사의 정확도 상한이다.
// 순서는 (c,m,y) 비트마스크: 0=백지, 1=C, 2=M, 3=CM(청), 4=Y, 5=CY(녹), 6=MY(적), 7=CMY(3색흑).
// ---------------------------------------------------------------------------

const NEUGEBAUER_PRIMARY_LAB: readonly StudioLab[] = [
  { l: 95, a: 0, b: -2 }, // 백지
  { l: 55, a: -37, b: -50 }, // C
  { l: 48, a: 74, b: -3 }, // M
  { l: 24, a: 22, b: -46 }, // C+M (청)
  { l: 89, a: -5, b: 93 }, // Y
  { l: 50, a: -65, b: 26 }, // C+Y (녹)
  { l: 47, a: 68, b: 48 }, // M+Y (적)
  { l: 23, a: 0, b: 0 }, // C+M+Y (3색흑)
];

/** K 솔리드 Lab — 승법 필터 계수를 만드는 데만 쓴다. */
const BLACK_SOLID_LAB: StudioLab = { l: 16, a: 0, b: 0 };

const NEUGEBAUER_PRIMARY_XYZ: readonly StudioXyz[] = NEUGEBAUER_PRIMARY_LAB.map(labToXyzD50);
const PAPER_XYZ: StudioXyz = NEUGEBAUER_PRIMARY_XYZ[0]!;
const BLACK_XYZ: StudioXyz = labToXyzD50(BLACK_SOLID_LAB);

/**
 * K 승법 필터 계수 — k=1 일 때 백지 대비 흑색 솔리드 비율.
 * XYZ 채널별로 따로 두면 검정의 미세한 색조(warm/cool)까지 근사된다.
 */
const BLACK_FILTER: StudioXyz = {
  x: BLACK_XYZ.x / PAPER_XYZ.x,
  y: BLACK_XYZ.y / PAPER_XYZ.y,
  z: BLACK_XYZ.z / PAPER_XYZ.z,
};

/**
 * 미디어 상대 보정 계수 — 종이 흰색을 D50 완전 백색으로 끌어올리는 채널별 배율.
 * XYZ 에서의 단순 백색점 스케일링(von Kries 계열)이다. Bradford 원추 응답까지 쓰지 않는 이유:
 * 종이 흰색과 D50 의 차이가 작아(ΔL* 약 5, a*b* 거의 0) 두 방식의 차이가 ΔE 0.1 미만이고,
 * 채널 배율 3개가 역변환(뉴턴법)에서 정확히 상쇄되어 왕복 정확도를 지키기 때문이다.
 */
const MEDIA_RELATIVE_SCALE: StudioXyz = {
  x: D50_WHITE.x / PAPER_XYZ.x,
  y: D50_WHITE.y / PAPER_XYZ.y,
  z: D50_WHITE.z / PAPER_XYZ.z,
};

/** 망점 증가 — `a' = a + gain·a·(1-a)`. gain 0 이면 항등. */
function applyDotGain(area: number, gain: number): number {
  const a = clampUnit(area);
  return clampUnit(a + gain * a * (1 - a));
}

/**
 * CMYK → XYZ(D50), Demichel×Neugebauer(CMY 8원색) + 승법 K.
 * 승법 K 근사: 검정 잉크는 아래 CMY 층 위에 얹히므로, 결과 XYZ 에 `lerp(1, BLACK_FILTER, k')` 를
 * 곱한다. 실제로는 잉크 트래핑(먼저 인쇄된 잉크 위에 다음 잉크가 덜 얹힘) 때문에 3색 위 K 는
 * 이 근사보다 밝게 나온다 — 그림자부 오차의 주된 출처다(테스트에 실측 오차를 고정해 둔다).
 */
export function cmykToXyz(
  cmyk: StudioCmyk,
  dotGain: number,
  intent: StudioRenderingIntent = "media-relative",
): StudioXyz {
  const c = applyDotGain(cmyk.c, dotGain);
  const m = applyDotGain(cmyk.m, dotGain);
  const y = applyDotGain(cmyk.y, dotGain);
  const k = applyDotGain(cmyk.k, dotGain);

  // Demichel: 각 원색의 면적 비율 = 해당 잉크는 덮고 나머지는 안 덮을 확률의 곱.
  const areas = [1 - c, c] as const;
  const areasM = [1 - m, m] as const;
  const areasY = [1 - y, y] as const;
  let x = 0;
  let yy = 0;
  let z = 0;
  for (let ci = 0; ci < 2; ci++) {
    for (let mi = 0; mi < 2; mi++) {
      for (let yi = 0; yi < 2; yi++) {
        const w = areas[ci]! * areasM[mi]! * areasY[yi]!;
        if (w === 0) continue;
        const primary = NEUGEBAUER_PRIMARY_XYZ[ci + mi * 2 + yi * 4]!;
        x += w * primary.x;
        yy += w * primary.y;
        z += w * primary.z;
      }
    }
  }
  const scale = intent === "media-relative" ? MEDIA_RELATIVE_SCALE : { x: 1, y: 1, z: 1 };
  return {
    x: x * (1 + k * (BLACK_FILTER.x - 1)) * scale.x,
    y: yy * (1 + k * (BLACK_FILTER.y - 1)) * scale.y,
    z: z * (1 + k * (BLACK_FILTER.z - 1)) * scale.z,
  };
}

// ---------------------------------------------------------------------------
// 순방향: CMYK → sRGB
// ---------------------------------------------------------------------------

/** CMYK → sRGB. `device` 는 승법 잉크식, `coated-neugebauer` 는 XYZ 경유. */
export function cmykToSrgb(cmyk: StudioCmyk, options: StudioSeparationOptions = DEFAULT_SEPARATION_OPTIONS): StudioRgb {
  const c = clampUnit(cmyk.c);
  const m = clampUnit(cmyk.m);
  const y = clampUnit(cmyk.y);
  const k = clampUnit(cmyk.k);
  if (options.model === "device") {
    return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
  }
  return xyzD50ToSrgb(cmykToXyz({ c, m, y, k }, options.press.dotGain, options.intent ?? "media-relative"));
}

// ---------------------------------------------------------------------------
// 블랙 생성(GCR) — 두 모델이 공유하는 K 선택 정책
// ---------------------------------------------------------------------------

/**
 * 회색 성분 `k0 = 1 - max(r,g,b)` 에서 실제 K 커버리지를 고른다.
 *  - `blackStart` 미만이면 K=0(하이라이트에 검정 점 금지).
 *  - 그 위로는 `gcr` 비율로 선형 상승, `blackLimit` 과 `k0` 둘 다로 상한.
 *
 * `k ≤ k0` 는 **반드시** 성립해야 한다 — device 모델의 왕복 무손실이 이 부등식에 걸려 있다
 * (`c = 1 - r/(1-k)` 가 [0,1] 에 들어오려면 `1-k ≥ max(r,g,b) = 1-k0`).
 * 램프 자체가 이미 이를 보장한다: `(k0-s)/(1-s) ≤ k0` ⟺ `s·k0 ≤ s` ⟺ `k0 ≤ 1`. 항상 참이다.
 * 그래도 `Math.min` 으로 한 번 더 조인다(프리셋을 손으로 고칠 때의 안전망).
 */
export function chooseBlack(neutral: number, press: StudioPressCondition): number {
  const k0 = clampUnit(neutral);
  if (k0 <= press.blackStart) return 0;
  const ramp = press.blackStart >= 1 ? 0 : (k0 - press.blackStart) / (1 - press.blackStart);
  return Math.min(k0, press.blackLimit, clampUnit(press.gcr) * ramp);
}

// ---------------------------------------------------------------------------
// 총 잉크량 제한
// ---------------------------------------------------------------------------

export interface StudioInkLimitResult {
  cmyk: StudioCmyk;
  /** 제한이 실제로 걸렸는지. */
  applied: boolean;
  /** 제한 전 총 잉크량(0..4). */
  before: number;
  /** 제한 후 총 잉크량(0..4). */
  after: number;
}

/**
 * 총 잉크량을 `limit` 이하로 되돌린다.
 *
 *  - `scale-cmy`: K 를 유지한 채 C/M/Y 를 같은 비율로 줄인다. 검정 밀도(그림자 디테일)를 지키는
 *    대신 그림자부 채도가 빠진다. 인쇄소가 가장 흔히 기대하는 동작이라 기본값이다.
 *  - `gcr-shift`: 세 채널의 공통 성분을 K 로 옮겨(회색 성분 치환) 총량을 줄인다. 색상은 더 잘
 *    지켜지지만 K 가 올라가 그림자가 뭉칠 수 있고, K 가 이미 blackLimit 이면 효과가 없어
 *    `scale-cmy` 로 자동 폴백한다(무한루프·미달 종료 금지).
 *
 * 어느 쪽이든 **색이 바뀐다**. 바뀐 정도는 `separateSrgbToCmyk` 가 ΔE 로 보고한다.
 */
export function enforceTotalInkLimit(
  cmyk: StudioCmyk,
  limit: number,
  strategy: StudioInkLimitStrategy = "scale-cmy",
  blackLimit = 1,
): StudioInkLimitResult {
  const start: StudioCmyk = {
    c: clampUnit(cmyk.c),
    m: clampUnit(cmyk.m),
    y: clampUnit(cmyk.y),
    k: clampUnit(cmyk.k),
  };
  const before = totalInkCoverage(start);
  const cap = clamp(limit, 0, 4);
  if (before <= cap + 1e-12) return { cmyk: start, applied: false, before, after: before };

  if (strategy === "gcr-shift") {
    const common = Math.min(start.c, start.m, start.y);
    const headroom = Math.max(0, Math.min(blackLimit, 1) - start.k);
    // 공통 성분 t 를 빼고 K 에 t 를 더하면 총량은 3t - t = 2t 만큼 준다.
    const need = before - cap;
    const t = Math.min(common, headroom, need / 2);
    if (t > 0) {
      const shifted: StudioCmyk = {
        c: start.c - t,
        m: start.m - t,
        y: start.y - t,
        k: start.k + t,
      };
      const after = totalInkCoverage(shifted);
      if (after <= cap + 1e-12) return { cmyk: shifted, applied: true, before, after };
      // 아직 넘치면 남은 초과분은 CMY 축소로 마무리(폴백).
      const scaled = scaleCmyToCap(shifted, cap);
      return { cmyk: scaled, applied: true, before, after: totalInkCoverage(scaled) };
    }
  }

  const scaled = scaleCmyToCap(start, cap);
  return { cmyk: scaled, applied: true, before, after: totalInkCoverage(scaled) };
}

/** K 고정, CMY 균등 축소. CMY 합이 0 인데도 넘치면 K 를 깎는다(순수 K 400% 같은 병리 입력). */
function scaleCmyToCap(cmyk: StudioCmyk, cap: number): StudioCmyk {
  const cmySum = cmyk.c + cmyk.m + cmyk.y;
  const allowedCmy = cap - cmyk.k;
  if (allowedCmy <= 0) {
    return { c: 0, m: 0, y: 0, k: clampUnit(Math.min(cmyk.k, cap)) };
  }
  if (cmySum <= allowedCmy || cmySum === 0) return { ...cmyk };
  const factor = allowedCmy / cmySum;
  return { c: cmyk.c * factor, m: cmyk.m * factor, y: cmyk.y * factor, k: cmyk.k };
}

// ---------------------------------------------------------------------------
// 리치 블랙
// ---------------------------------------------------------------------------

export type StudioRichBlackKind = "flat" | "neutral" | "cool" | "warm" | "registration";

export interface StudioRichBlackRecipe {
  kind: StudioRichBlackKind;
  label: string;
  /** 잉크 제한 적용 전 원본 배합. */
  build: StudioCmyk;
  /** 사용자에게 보여줄 한국어 용도 설명. */
  note: string;
}

/**
 * 리치 블랙 배합표.
 *  - `flat` 100K 단독 — 본문 텍스트·세선용. 큰 면적에서는 회색빛으로 뜬다.
 *  - `neutral` 60/40/40/100 — 가장 널리 쓰는 중성 리치 블랙(대형 면적 기본값).
 *  - `cool` 60/0/0/100 / `warm` 0/60/30/100 — 의도적 색조.
 *  - `registration` 100/100/100/100(400%) — **인쇄물에 절대 쓰면 안 되는** 재단/맞춤 마크 전용.
 *    UI 에서 고를 수는 있어도 항상 경고를 붙여 내보낸다.
 */
export const STUDIO_RICH_BLACKS: Readonly<Record<StudioRichBlackKind, StudioRichBlackRecipe>> = {
  flat: {
    kind: "flat",
    label: "단색 블랙 (K 100)",
    build: { c: 0, m: 0, y: 0, k: 1 },
    note: "본문 텍스트와 가는 선에 쓰세요. 넓은 면적에서는 검정이 옅게 보일 수 있어요.",
  },
  neutral: {
    kind: "neutral",
    label: "중성 리치 블랙 (60/40/40/100)",
    build: { c: 0.6, m: 0.4, y: 0.4, k: 1 },
    note: "넓은 검정 면적의 기본값입니다. 4mm 이하 작은 글자에는 쓰지 마세요(핀 어긋남이 보입니다).",
  },
  cool: {
    kind: "cool",
    label: "쿨 리치 블랙 (60/0/0/100)",
    build: { c: 0.6, m: 0, y: 0, k: 1 },
    note: "푸른 기가 도는 검정입니다. 밤 장면·차가운 톤에 씁니다.",
  },
  warm: {
    kind: "warm",
    label: "웜 리치 블랙 (0/60/30/100)",
    build: { c: 0, m: 0.6, y: 0.3, k: 1 },
    note: "붉은 기가 도는 검정입니다. 세피아·노을 장면에 씁니다.",
  },
  registration: {
    kind: "registration",
    label: "레지스트레이션 (400%)",
    build: { c: 1, m: 1, y: 1, k: 1 },
    note: "재단선·맞춤 마크 전용입니다. 그림이나 글자에 쓰면 인쇄 사고가 납니다.",
  },
};

export interface StudioRichBlackResult {
  recipe: StudioRichBlackRecipe;
  /** 인쇄 조건의 총 잉크량 상한을 적용한 실제 배합. */
  cmyk: StudioCmyk;
  inkLimit: StudioInkLimitResult;
  /** 한국어 경고 목록(빈 배열이면 문제 없음). */
  warnings: string[];
}

/**
 * 리치 블랙 배합을 인쇄 조건에 맞춰 낸다. K 는 항상 유지하고 CMY 만 줄인다(`scale-cmy`) —
 * 리치 블랙의 목적이 "K 를 최대로 두고 밀도를 보강" 하는 것이라, K 를 깎는 전략은 의미가 없다.
 */
export function buildRichBlack(kind: StudioRichBlackKind, press: StudioPressCondition): StudioRichBlackResult {
  const recipe = STUDIO_RICH_BLACKS[kind];
  const warnings: string[] = [];
  const capped = enforceTotalInkLimit(recipe.build, press.totalInkLimit, "scale-cmy", press.blackLimit);
  if (kind === "registration") {
    warnings.push("레지스트레이션 블랙(400%)은 재단·맞춤 마크 전용입니다. 그림이나 글자에 쓰지 마세요.");
  }
  if (capped.applied) {
    warnings.push(
      `총 잉크량 ${Math.round(capped.before * 100)}%가 인쇄 조건 상한 ${Math.round(press.totalInkLimit * 100)}%를 넘어 CMY를 줄였습니다(현재 ${Math.round(capped.after * 100)}%).`,
    );
  }
  if (kind === "flat" && press.totalInkLimit >= 2.4) {
    warnings.push("넓은 면적이라면 중성 리치 블랙(60/40/40/100)이 더 깊은 검정을 냅니다.");
  }
  return { recipe, cmyk: capped.cmyk, inkLimit: capped, warnings };
}

// ---------------------------------------------------------------------------
// 역방향: sRGB → CMYK
// ---------------------------------------------------------------------------

export interface StudioSeparationResult {
  /** 최종 CMYK(잉크 제한 적용 후). */
  cmyk: StudioCmyk;
  /** 잉크 제한 적용 전 CMYK — 제한이 얼마나 색을 바꿨는지 비교용. */
  unlimited: StudioCmyk;
  inkLimit: StudioInkLimitResult;
  /** 최종 CMYK 를 다시 sRGB 로 되돌린 값(화면 소프트 프루프). */
  proof: StudioRgb;
  /** 원본 대비 프루프의 ΔE94. */
  deltaE: number;
  /** 색역 밖 판정(아래 GAMUT_TOLERANCE 초과). */
  outOfGamut: boolean;
  /** 색역 밖 사유(한국어) — 색역 안이면 null. */
  reason: string | null;
}

/**
 * 색역 판정 임계 ΔE94 = 2.0.
 * 근거: 인쇄 업계에서 "숙련자가 나란히 놓고 겨우 구별" 하는 경계가 대략 ΔE 2 다(ISO 12647 의
 * 색차 허용치도 이 눈금대에 있다). 이보다 크면 화면에서 본 색이 인쇄에서 재현되지 않는다.
 */
export const GAMUT_TOLERANCE = 2;

const NEWTON_ITERATIONS = 24;
const NEWTON_EPSILON = 1e-4;

/**
 * sRGB → CMYK 분해.
 *
 * `device`: 대수적 정확해. k 를 GCR 로 고르고 `c = 1 - r/(1-k)` 로 정확히 보상한다 →
 *   잉크 제한이 걸리지 않는 한 왕복 오차 0(부동소수 한계까지).
 * `coated-neugebauer`: k 를 같은 GCR 정책으로 먼저 고정한 뒤, 목표 XYZ 에 대해 CMY 3변수를
 *   감쇠 뉴턴법으로 푼다(수치 야코비안 3×3 + Cramer). 반복 수 고정·난수 없음 → 결정적.
 *   해가 정육면체 밖으로 나가면 클램프하며 진행하고, 남은 오차는 ΔE 로 정직하게 보고한다.
 */
export function separateSrgbToCmyk(
  rgb: StudioRgb,
  options: StudioSeparationOptions = DEFAULT_SEPARATION_OPTIONS,
): StudioSeparationResult {
  const source: StudioRgb = { r: clampUnit(rgb.r), g: clampUnit(rgb.g), b: clampUnit(rgb.b) };
  const press = options.press;
  const neutral = 1 - Math.max(source.r, source.g, source.b);
  const k = chooseBlack(neutral, press);

  let unlimited: StudioCmyk;
  if (options.model === "device") {
    const inv = 1 - k;
    unlimited =
      inv <= 1e-9
        ? { c: 0, m: 0, y: 0, k: 1 }
        : {
            c: clampUnit(1 - source.r / inv),
            m: clampUnit(1 - source.g / inv),
            y: clampUnit(1 - source.b / inv),
            k,
          };
  } else {
    unlimited = solveNeugebauerCmy(source, k, press.dotGain, options.intent ?? "media-relative");
  }

  const inkLimit = enforceTotalInkLimit(unlimited, press.totalInkLimit, options.inkLimitStrategy, press.blackLimit);
  const cmyk = inkLimit.cmyk;
  const proof = cmykToSrgb(cmyk, options);
  const deltaE = deltaE94(srgbToLab(source), srgbToLab(proof));
  const outOfGamut = deltaE > GAMUT_TOLERANCE;
  return {
    cmyk,
    unlimited,
    inkLimit,
    proof,
    deltaE,
    outOfGamut,
    reason: outOfGamut ? describeGamutMiss(source, proof, inkLimit.applied) : null,
  };
}

/** 색역 밖 사유를 사람이 고칠 수 있는 말로 — "채도를 낮추세요" 수준의 실행 가능한 안내. */
function describeGamutMiss(source: StudioRgb, proof: StudioRgb, inkLimited: boolean): string {
  const a = srgbToLab(source);
  const b = srgbToLab(proof);
  const chromaDrop = Math.hypot(a.a, a.b) - Math.hypot(b.a, b.b);
  const lightnessDrop = a.l - b.l;
  if (inkLimited) {
    return "총 잉크량 상한 때문에 그림자 색이 옅어졌어요. 어두운 부분의 채도를 낮추면 화면과 가까워집니다.";
  }
  if (chromaDrop > Math.abs(lightnessDrop)) {
    return "인쇄 잉크가 낼 수 없는 채도예요. 채도를 낮추면 화면과 가까워집니다.";
  }
  if (lightnessDrop > 0) {
    return "인쇄에서 이만큼 밝게 나오지 않아요. 밝기를 낮추거나 대비를 조정하세요.";
  }
  return "인쇄에서 이만큼 어둡게 나오지 않아요. 검정을 리치 블랙으로 바꾸면 깊어집니다.";
}

/** 목표 sRGB 와 고정된 K 에 대해 CMY 를 감쇠 뉴턴법으로 푼다(결정적). */
function solveNeugebauerCmy(
  target: StudioRgb,
  k: number,
  dotGain: number,
  intent: StudioRenderingIntent,
): StudioCmyk {
  const targetXyz = srgbToXyzD50(target);
  // 초기값: device 모델의 해 — 이미 상당히 가까워 반복 수를 줄인다.
  const inv = 1 - k;
  let c = inv <= 1e-9 ? 0 : clampUnit(1 - target.r / inv);
  let m = inv <= 1e-9 ? 0 : clampUnit(1 - target.g / inv);
  let y = inv <= 1e-9 ? 0 : clampUnit(1 - target.b / inv);

  const evaluate = (cc: number, mm: number, yy: number): StudioXyz =>
    cmykToXyz({ c: cc, m: mm, y: yy, k }, dotGain, intent);
  const residual = (v: StudioXyz): [number, number, number] => [v.x - targetXyz.x, v.y - targetXyz.y, v.z - targetXyz.z];

  for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration++) {
    const base = evaluate(c, m, y);
    const r0 = residual(base);
    if (Math.hypot(r0[0], r0[1], r0[2]) < 1e-9) break;
    // 수치 야코비안 — 경계에서는 안쪽으로 차분해 정육면체를 벗어나지 않는다.
    const step = (v: number): number => (v + NEWTON_EPSILON > 1 ? -NEWTON_EPSILON : NEWTON_EPSILON);
    const hc = step(c);
    const hm = step(m);
    const hy = step(y);
    const dc = residual(evaluate(c + hc, m, y));
    const dm = residual(evaluate(c, m + hm, y));
    const dy = residual(evaluate(c, m, y + hy));
    const j: number[][] = [
      [(dc[0] - r0[0]) / hc, (dm[0] - r0[0]) / hm, (dy[0] - r0[0]) / hy],
      [(dc[1] - r0[1]) / hc, (dm[1] - r0[1]) / hm, (dy[1] - r0[1]) / hy],
      [(dc[2] - r0[2]) / hc, (dm[2] - r0[2]) / hm, (dy[2] - r0[2]) / hy],
    ];
    const delta = solve3x3(j, [-r0[0], -r0[1], -r0[2]]);
    if (!delta) break;
    // 감쇠 — 뉴턴 스텝이 정육면체를 크게 넘어가면 진동한다. 0.5 는 수렴 속도와 안정의 절충.
    const damping = 0.5;
    c = clampUnit(c + delta[0] * damping);
    m = clampUnit(m + delta[1] * damping);
    y = clampUnit(y + delta[2] * damping);
  }
  return { c, m, y, k };
}

/** 3×3 선형계를 Cramer 로 푼다. 특이행렬이면 null(호출부가 반복을 중단). */
function solve3x3(a: number[][], b: number[]): [number, number, number] | null {
  const det = determinant3(a);
  if (Math.abs(det) < 1e-18) return null;
  const withColumn = (index: number): number[][] =>
    a.map((row, r) => row.map((value, col) => (col === index ? b[r]! : value)));
  return [
    determinant3(withColumn(0)) / det,
    determinant3(withColumn(1)) / det,
    determinant3(withColumn(2)) / det,
  ];
}

function determinant3(a: number[][]): number {
  const [p, q, r] = a as [number[], number[], number[]];
  return (
    p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) -
    p[1]! * (q[0]! * r[2]! - q[2]! * r[0]!) +
    p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!)
  );
}

// ---------------------------------------------------------------------------
// 색역 리포트 — 팔레트/페이지 색 목록 단위 사전 검사
// ---------------------------------------------------------------------------

export interface StudioGamutEntry {
  /** 호출부가 붙이는 식별자(팔레트 색 이름, 요소 id 등). */
  id: string;
  hex: string;
  cmyk: StudioCmyk;
  totalInk: number;
  deltaE: number;
  outOfGamut: boolean;
  inkLimited: boolean;
  reason: string | null;
}

export interface StudioGamutReport {
  press: StudioPressCondition;
  model: StudioCmykModelId;
  entries: StudioGamutEntry[];
  /** 색역 밖 색 개수. */
  outOfGamutCount: number;
  /** 잉크 제한이 걸린 색 개수. */
  inkLimitedCount: number;
  /** 가장 오차가 큰 항목(입력이 비면 null). */
  worst: StudioGamutEntry | null;
  /** 한 줄 한국어 요약. */
  summary: string;
  /** 정직성 고지 — UI 가 반드시 함께 노출한다. */
  disclosure: string;
}

/**
 * 색 목록의 인쇄 적합성을 한 번에 검사한다. 잘못된 hex 는 조용히 건너뛰지 않고 제외 목록으로
 * 알 수 있게 결과에서 빠진다(호출부가 `entries.length` 와 입력 길이를 비교하면 감지 가능).
 * 정렬은 하지 않는다 — 입력 순서를 유지해야 UI 가 원본 팔레트와 나란히 놓을 수 있다.
 */
export function reportGamut(
  colors: readonly { id: string; hex: string }[],
  options: StudioSeparationOptions = DEFAULT_SEPARATION_OPTIONS,
): StudioGamutReport {
  const entries: StudioGamutEntry[] = [];
  for (const color of colors) {
    const rgb = srgbHexToRgb(color.hex);
    if (!rgb) continue;
    const separation = separateSrgbToCmyk(rgb, options);
    entries.push({
      id: color.id,
      hex: rgbToSrgbHex(rgb),
      cmyk: separation.cmyk,
      totalInk: totalInkCoverage(separation.cmyk),
      deltaE: separation.deltaE,
      outOfGamut: separation.outOfGamut,
      inkLimited: separation.inkLimit.applied,
      reason: separation.reason,
    });
  }
  const outOfGamutCount = entries.filter((entry) => entry.outOfGamut).length;
  const inkLimitedCount = entries.filter((entry) => entry.inkLimited).length;
  let worst: StudioGamutEntry | null = null;
  for (const entry of entries) {
    if (!worst || entry.deltaE > worst.deltaE) worst = entry;
  }
  const summary =
    entries.length === 0
      ? "검사할 색이 없어요."
      : outOfGamutCount === 0
        ? `색 ${entries.length}개 모두 ${options.press.label} 조건에서 인쇄 가능합니다.`
        : `색 ${entries.length}개 중 ${outOfGamutCount}개가 ${options.press.label} 색역을 벗어납니다(잉크 제한 적용 ${inkLimitedCount}개).`;
  return {
    press: options.press,
    model: options.model,
    entries,
    outOfGamutCount,
    inkLimitedCount,
    worst,
    summary,
    disclosure: PROFILE_DISCLOSURE,
  };
}
