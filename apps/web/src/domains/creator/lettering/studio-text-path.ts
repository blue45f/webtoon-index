/**
 * Studio Curved / Path Text Engine
 * 웹툰 말풍선·효과음 텍스트를 아치·물결·원호를 따라 휘게 — Konva TextPath의 `data`로 쓸
 * SVG path 문자열을 로컬 좌표(baseline 기준)로 생성한다. 곡률 강도(curve 0..100)만 받아
 * 2차 베지어(Q/T) 또는 원호(A) 커맨드를 조립한다.
 * Konva 의존 없음 — StudioPage 텍스트 인스펙터와 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음)이며, width/fontSize가 0이어도 NaN/Infinity 없이 유한 좌표만 낸다.
 * (예외: `textPathAdvanceWidth`만 브라우저에서 공유 <canvas>로 실측하고, 캔버스가 없으면
 *  순수 추정치로 폴백한다 — 그 외 모든 함수는 DOM을 만지지 않는다.)
 *
 * ## 경로 길이 = 글자 예산 (D6)
 * Konva `TextPath`(와 SVG `<textPath>`)는 **경로 길이를 넘어가는 글자를 조용히 버린다**
 * (konva/lib/shapes/TextPath.js `_setTextData` — `_getPointAtLength`가 null이면 즉시 return).
 * 경로를 요소 박스 폭으로만 만들면 박스보다 긴 텍스트는 잘려나간다. 실측(Chromium+Pretendard
 * Bold, 기본 텍스트 요소 220×40, 한글 12자 = 415.2 px): 아치 6/12, 물결 6/12, 원 위 7/12.
 * 그래서 `buildTextPathData`는 네 번째 인자로 **필요한 최소 경로 길이**를 받아, 그 길이를
 * 담을 수 있을 때까지 현(chord)을 키운다(곡률 비율은 그대로 — 모양은 같고 크기만 커진다).
 */

// ---------------------------------------------------------------------------
// 모양 타입·라벨·기본값·범위
// ---------------------------------------------------------------------------

/** 텍스트가 따라갈 경로 모양 — none은 수평 직선, 나머지는 휘어짐. */
export type TextPathShape = "none" | "arcUp" | "arcDown" | "wave" | "circleUp" | "circleDown";

/** 인스펙터 셀렉터용 모양 목록 — id와 한글 라벨. */
export const TEXT_PATH_SHAPES: { id: TextPathShape; label: string }[] = [
  { id: "none", label: "직선" },
  { id: "arcUp", label: "아치 ▲" },
  { id: "arcDown", label: "아치 ▼" },
  { id: "wave", label: "물결" },
  { id: "circleUp", label: "원 위" },
  { id: "circleDown", label: "원 아래" },
];

/** 경로 설정 — 모양 + 휘어짐 강도(curve 0..100). */
export type TextPathConfig = { shape: TextPathShape; curve: number };

/** 기본 설정 — 직선(휨 없음), 곡률 중간값. */
export const DEFAULT_TEXT_PATH: TextPathConfig = { shape: "none", curve: 50 };

/** curve 슬라이더 범위 — 0(평탄)..100(최대 휨), 1 단위. */
export const TEXT_PATH_CURVE_RANGE: { min: number; max: number; step: number } = {
  min: 0,
  max: 100,
  step: 1,
};

// 유효 모양 집합(정규화에서 빠른 검증용).
const SHAPE_IDS = new Set<TextPathShape>(TEXT_PATH_SHAPES.map((s) => s.id));

// ---------------------------------------------------------------------------
// 정규화·평탄 판정·라벨
// ---------------------------------------------------------------------------

/** curve를 0..100으로 클램프(유한 숫자 아님은 기본값). */
function clampCurve(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TEXT_PATH.curve;
  if (value < TEXT_PATH_CURVE_RANGE.min) return TEXT_PATH_CURVE_RANGE.min;
  if (value > TEXT_PATH_CURVE_RANGE.max) return TEXT_PATH_CURVE_RANGE.max;
  return value;
}

/**
 * 외부 입력/저장본 안전장치 — 모양이 알려진 값이 아니면 "none", curve는 0..100 클램프.
 * 누락/무효 입력은 DEFAULT_TEXT_PATH로 메운다.
 */
export function normalizeTextPath(c?: Partial<TextPathConfig> | null): TextPathConfig {
  if (!c || typeof c !== "object") return { ...DEFAULT_TEXT_PATH };
  const shape = SHAPE_IDS.has(c.shape as TextPathShape) ? (c.shape as TextPathShape) : "none";
  return { shape, curve: clampCurve(c.curve) };
}

/** 직선(휨 없음) 설정인지 — shape가 "none"이면 경로 효과를 끈다. */
export function isFlatTextPath(c: TextPathConfig): boolean {
  return c.shape === "none";
}

/** 모양 id → 한글 라벨(미상은 "직선"). */
export function textPathShapeLabel(shape: TextPathShape): string {
  return TEXT_PATH_SHAPES.find((s) => s.id === shape)?.label ?? "직선";
}

// ---------------------------------------------------------------------------
// SVG path data 빌드
// ---------------------------------------------------------------------------

// 좌표 소수 둘째 자리까지(불필요한 0 제거) — path 문자열을 짧고 결정적으로.
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // -0을 0으로 정규화하고 소수 2자리에서 끊은 뒤 꼬리 0/소수점 제거.
  const rounded = Math.round(n * 100) / 100 + 0;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

/** 음수·0·무한대를 1 이상의 유한 폭으로 — 나눗셈/호 계산 0 가드. */
function safeWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return width;
}

/** 음수·0·무한대를 1 이상의 유한 글자 크기로 — baseY/진폭 0 가드. */
function safeFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 1;
  return fontSize;
}

/** curve(0..100)를 0..1 비율로 — 휨 강도 계수. */
function curveRatio(curve: number): number {
  const c = clampCurve(curve);
  return c / 100;
}

/**
 * 모양별 기하 — path 문자열 생성기(`geometryToPathData`)와 길이 계산기(`geometryLength`)가
 * 같은 값을 보게 하려는 중간 표현. 둘이 각자 공식을 들고 있으면 조용히 어긋난다.
 */
type TextPathGeometry =
  | { kind: "line"; width: number; y: number }
  | { kind: "quad"; width: number; baseY: number; ctrlY: number }
  | { kind: "wave"; width: number; baseY: number; amp: number }
  | { kind: "arc"; width: number; baseY: number; radius: number; sweep: 0 | 1 };

/**
 * 곡률 편차가 이 값보다 작으면 직선으로 낸다.
 * (1) `fmt`가 소수 2자리로 끊으므로 이보다 작은 휨은 어차피 문자열에서 사라진다.
 * (2) 더 중요한 이유 — 퇴화한(제어점이 두 끝점과 일직선인) 2차 베지어는 Konva의 닫힌형
 *     호 길이 공식(BezierFunctions.getQuadraticArcLength)에서 자릿수 상쇄를 일으킨다.
 *     특히 `T`가 만드는 반사 제어점은 부동소수 오차 때문에 A가 0이 아닌 극소값이 되고,
 *     그 결과 pathLength가 실제보다 짧게(심하면 NaN으로) 나와 글자가 다시 잘린다.
 *     실측(Chromium): "M 0 14 Q 30.82 14 61.64 14 T 123.28 14"의 Konva pathLength = 117.64
 *     (기하학적 정답 123.28). 그래서 퇴화 구간은 애초에 만들지 않는다.
 */
const FLAT_EPSILON = 0.01;

/**
 * (모양, 곡률, 현 폭, 글자 크기) → 기하. 폭이 커져도 곡률 **비율**은 그대로라
 * 아치/원호는 모양이 같은 채로 확대되고, 물결만 진폭(글자 크기 기준)이 고정이라 완만해진다.
 */
function textPathGeometry(
  shape: TextPathShape,
  ratio: number,
  w: number,
  fs: number,
): TextPathGeometry {
  // none은 글자 크기 높이의 수평 직선(baseline 한 줄).
  if (shape === "none") return { kind: "line", width: w, y: fs };

  // 휜 모양들의 baseline y — 위로 휠 여유를 두려 글자 크기보다 약간 아래.
  const baseY = fs * 1.4;

  if (shape === "wave") {
    // 진폭 amp — 글자 크기에 비례. Q로 첫 반파, T로 매끈하게 이어 반대 반파.
    const amp = ratio * fs * 1.2;
    if (amp < FLAT_EPSILON) return { kind: "line", width: w, y: baseY };
    return { kind: "wave", width: w, baseY, amp };
  }

  // 활(bow) 깊이 — 폭에 비례, curve로 강도. arcUp은 위(−), arcDown은 아래(+).
  const bow = ratio * w * 0.45;
  // 곡률 0 — 휠 새그가 없으니 직선으로 안전 폴백(원호는 반지름 발산도 함께 막는다).
  if (bow < FLAT_EPSILON) return { kind: "line", width: w, y: baseY };

  if (shape === "arcUp" || shape === "arcDown") {
    return { kind: "quad", width: w, baseY, ctrlY: shape === "arcUp" ? baseY - bow : baseY + bow };
  }

  // circleUp / circleDown — 같은 두 끝점을 잇는 원호(A). 활 깊이로 반지름을 역산한다.
  // 현(chord)=w, 새그(sag)=bow일 때 반지름 r = (chord^2/4 + sag^2) / (2*sag).
  // curve가 작으면 bow가 작아 r이 매우 커지고(거의 직선), 크면 r이 작아 더 둥글다.
  const half = w / 2;
  return {
    kind: "arc",
    width: w,
    baseY,
    radius: (half * half + bow * bow) / (2 * bow),
    // large-arc-flag=0(짧은 호), sweep-flag로 위/아래 곡률 방향을 가른다.
    // SVG y축은 아래로 증가 — sweep=1은 시계방향(위로 볼록), sweep=0은 아래로 볼록.
    sweep: shape === "circleUp" ? 1 : 0,
  };
}

/** 기하 → SVG path data 문자열(로컬 좌표, baseline 기준). */
function geometryToPathData(g: TextPathGeometry): string {
  if (g.kind === "line") return `M 0 ${fmt(g.y)} L ${fmt(g.width)} ${fmt(g.y)}`;
  if (g.kind === "quad") {
    return `M 0 ${fmt(g.baseY)} Q ${fmt(g.width / 2)} ${fmt(g.ctrlY)} ${fmt(g.width)} ${fmt(g.baseY)}`;
  }
  if (g.kind === "wave") {
    return (
      `M 0 ${fmt(g.baseY)} Q ${fmt(g.width / 4)} ${fmt(g.baseY - g.amp)} ${fmt(g.width / 2)} ${fmt(g.baseY)}`
      + ` T ${fmt(g.width)} ${fmt(g.baseY)}`
    );
  }
  return `M 0 ${fmt(g.baseY)} A ${fmt(g.radius)} ${fmt(g.radius)} 0 0 ${g.sweep} ${fmt(g.width)} ${fmt(g.baseY)}`;
}

// 2차 베지어를 잘게 쪼개 폴리라인 길이로 근사. 폴리라인은 항상 실제 호보다 **짧으므로**
// 여기서 나오는 값을 예산으로 쓰면 경로를 필요보다 조금 길게 잡는다(= 글자가 잘리지 않는 쪽).
const QUAD_SAMPLES = 64;

/** 시작점 (0, p0y) → 제어점 (cx, cy) → 끝점 (p2x, p2y) 2차 베지어의 폴리라인 길이. */
function quadLength(p0y: number, cx: number, cy: number, p2x: number, p2y: number): number {
  let prevX = 0;
  let prevY = p0y;
  let total = 0;
  for (let i = 1; i <= QUAD_SAMPLES; i += 1) {
    const t = i / QUAD_SAMPLES;
    const u = 1 - t;
    const x = 2 * u * t * cx + t * t * p2x;
    const y = u * u * p0y + 2 * u * t * cy + t * t * p2y;
    total += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return total;
}

/** 기하의 경로 길이(px) — Konva `TextPath.pathLength`가 재는 것과 같은 양. */
function geometryLength(g: TextPathGeometry): number {
  if (g.kind === "line") return g.width;
  if (g.kind === "quad") return quadLength(g.baseY, g.width / 2, g.ctrlY, g.width, g.baseY);
  if (g.kind === "wave") {
    // T는 직전 제어점을 끝점 기준으로 반사한 제어점을 쓴다 → (3w/4, baseY+amp).
    // 길이는 평행이동 불변이라 두 번째 반파도 원점으로 옮겨(−w/2) 같은 헬퍼로 잰다.
    const half = g.width / 2;
    return (
      quadLength(g.baseY, g.width / 4, g.baseY - g.amp, half, g.baseY)
      + quadLength(g.baseY, g.width / 4, g.baseY + g.amp, half, g.baseY)
    );
  }
  // 짧은 원호 — 중심각 2·asin(반현/r). bow < half(=w/2)라 r > half가 보장돼 asin이 정의된다.
  const half = g.width / 2;
  if (g.radius <= 0 || half <= 0) return g.width;
  return 2 * g.radius * Math.asin(Math.min(1, half / g.radius));
}

/**
 * 실측/추정 오차(캔버스 measureText ↔ Konva 내부 글자별 합, fmt의 소수 2자리 반올림,
 * Konva 자체 길이 근사)를 흡수하는 여유. 조금 길어진 경로 끝은 눈에 띄지 않지만,
 * 1 px이라도 짧으면 마지막 글자가 통째로 사라진다 — 비대칭 위험이라 넉넉한 쪽으로 둔다.
 */
const PATH_LENGTH_SAFETY = 1.02;
const PATH_LENGTH_SLACK_PX = 1;

// 이분 탐색 횟수 — 폭 범위가 아무리 넓어도 40회면 부동소수 정밀도까지 좁혀진다.
const CHORD_SOLVE_STEPS = 40;

/**
 * 경로 길이가 `required` 이상이 되는 가장 작은 현(chord) 폭을 찾는다.
 * 길이는 폭에 대해 단조 증가하고 항상 `length(w) >= w`이므로 [baseWidth, required] 구간에
 * 해가 존재한다(모양별 공식이 달라도 성립 — 물결만 폭에 비선형이라 이분 탐색으로 통일).
 */
function solveChordWidth(
  shape: TextPathShape,
  ratio: number,
  fs: number,
  baseWidth: number,
  required: number,
): number {
  if (geometryLength(textPathGeometry(shape, ratio, baseWidth, fs)) >= required) return baseWidth;
  let lo = baseWidth;
  let hi = Math.max(baseWidth, required);
  for (let i = 0; i < CHORD_SOLVE_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (geometryLength(textPathGeometry(shape, ratio, mid, fs)) >= required) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * 입력(설정·박스 폭·글자 크기·최소 길이)을 실제로 그릴 기하 하나로 확정한다.
 * path 문자열과 길이가 같은 기하에서 나오도록 두 공개 함수가 공유한다.
 */
function resolveGeometry(
  config: TextPathConfig,
  width: number,
  fontSize: number,
  minPathLength?: number,
): TextPathGeometry {
  const { shape } = normalizeTextPath(config);
  const w = safeWidth(width);
  const fs = safeFontSize(fontSize);
  const ratio = curveRatio(config.curve);
  const required =
    typeof minPathLength === "number" && Number.isFinite(minPathLength) && minPathLength > 0
      ? minPathLength * PATH_LENGTH_SAFETY + PATH_LENGTH_SLACK_PX
      : 0;
  const chord = required > 0 ? solveChordWidth(shape, ratio, fs, w, required) : w;
  return textPathGeometry(shape, ratio, chord, fs);
}

/**
 * 모양별 SVG path data 문자열(로컬 좌표, baseline 기준)을 만든다.
 * width=텍스트 영역 폭, fontSize=글자 크기. curve(0..100)로 휨 정도를 키운다.
 *
 *   none:       "M 0 <fontSize> L <width> <fontSize>" — 수평 직선.
 *   arcUp:      위로 볼록 2차 베지어 — 중간 제어점 y를 baseY 위로(작게) 당긴다.
 *   arcDown:    아래로 볼록 — 중간 제어점 y를 baseY 아래로(크게) 민다.
 *   wave:       물결 — Q…T로 한 골 한 마루(진폭 amp).
 *   circleUp:   원 위쪽 호 — A 커맨드, curve가 클수록 반지름이 작아 더 둥글게.
 *   circleDown: 원 아래쪽 호 — sweep을 뒤집어 아래로 굽힌다.
 *
 * `minPathLength`(px)를 주면 경로 길이가 그 값 이상이 되도록 현 폭을 키운다 — 텍스트 실측 폭을
 * 넣으면 글자가 잘리지 않는다(§경로 길이 = 글자 예산). 박스 폭만으로 이미 충분하면 폭은
 * 그대로라 짧은 텍스트의 path 문자열은 인자를 주기 전과 완전히 동일하다.
 *
 * width/fontSize가 0/음수/비유한이어도 1 이상으로 가드해 NaN/Infinity 없는 좌표만 낸다.
 */
export function buildTextPathData(
  config: TextPathConfig,
  width: number,
  fontSize: number,
  minPathLength?: number,
): string {
  return geometryToPathData(resolveGeometry(config, width, fontSize, minPathLength));
}

/** `buildTextPathData`가 낸 경로의 길이(px) — 테스트/진단용. */
export function textPathLength(
  config: TextPathConfig,
  width: number,
  fontSize: number,
  minPathLength?: number,
): number {
  return geometryLength(resolveGeometry(config, width, fontSize, minPathLength));
}

// ---------------------------------------------------------------------------
// 텍스트 진행 폭(advance width) — 경로 길이 예산의 입력값
// ---------------------------------------------------------------------------

/** 곡선 텍스트 한 줄이 소비할 폭을 재는 데 필요한 서식. Konva Text/TextPath 속성과 1:1. */
export interface TextPathTextInput {
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontStyle?: string;
  letterSpacing?: number;
}

/**
 * 전각(1 em)으로 봐야 하는 코드포인트 — 한글·한자·가나·전각 기호. 라틴보다 훨씬 넓어서
 * 라틴 기준으로 추정하면 한글 문장이 통째로 잘린다(D6 감사의 "한글은 전각" 지적).
 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) // 한글 자모
    || (cp >= 0x2e80 && cp <= 0x303e) // CJK 부수·강희 부수·CJK 기호
    || (cp >= 0x3041 && cp <= 0x33ff) // 가나·한글 호환 자모·CJK 호환
    || (cp >= 0x3400 && cp <= 0x4dbf) // CJK 확장 A
    || (cp >= 0x4e00 && cp <= 0x9fff) // CJK 통합 한자
    || (cp >= 0xa960 && cp <= 0xa97f) // 한글 자모 확장 A
    || (cp >= 0xac00 && cp <= 0xd7a3) // 한글 음절
    || (cp >= 0xd7b0 && cp <= 0xd7ff) // 한글 자모 확장 B
    || (cp >= 0xf900 && cp <= 0xfaff) // CJK 호환 한자
    || (cp >= 0xfe30 && cp <= 0xfe4f) // CJK 호환 형태
    || (cp >= 0xff00 && cp <= 0xff60) // 전각 라틴
    || (cp >= 0xffe0 && cp <= 0xffe6) // 전각 기호
  );
}

/** 코드포인트 하나의 진행 폭(em 배수) — 실측이 불가능할 때 쓰는 **상한** 추정. */
function glyphEmWidth(cp: number): number {
  if (cp > 0xffff) return 1.2; // 이모지 등 보조 평면 — 전각보다도 넓은 경우가 흔하다.
  if (isWideCodePoint(cp)) return 1;
  if (cp === 0x20 || cp === 0x09) return 0.4; // 공백/탭
  if (cp === 0x0a || cp === 0x0d) return 0; // 줄바꿈은 TextPath에서 폭을 만들지 않는다.
  return 0.75; // 라틴·숫자·기호 상한(볼드 대문자 기준으로도 넉넉).
}

/**
 * 캔버스 없이 계산하는 진행 폭 추정치(px) — SSR/워커/jsdom 폴백.
 * 실측보다 **크게** 나오도록 계수를 잡았다(짧으면 글자가 사라지고, 길면 경로 끝이 남을 뿐).
 */
export function estimateTextPathAdvanceWidth(input: TextPathTextInput): number {
  const fs = safeFontSize(input.fontSize);
  const letterSpacing = Number.isFinite(input.letterSpacing) ? (input.letterSpacing ?? 0) : 0;
  let total = 0;
  let count = 0;
  for (const char of input.text ?? "") {
    total += glyphEmWidth(char.codePointAt(0) ?? 0) * fs;
    count += 1;
  }
  // Konva는 글자마다 letterSpacing을 한 번씩 더한다(마지막 글자 포함) — 같은 규칙으로 센다.
  return total + count * Math.max(0, letterSpacing);
}

// 재사용 오프스크린 캔버스 — 곡선 텍스트 노드가 리렌더될 때마다 캔버스를 새로 만들지 않는다
// (studio-bubble-text-fit.ts의 공유 measure 컨텍스트와 같은 관례).
let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureContext !== undefined) return sharedMeasureContext;
  sharedMeasureContext = null;
  try {
    if (typeof document !== "undefined") {
      sharedMeasureContext = document.createElement("canvas").getContext("2d");
    }
  } catch {
    sharedMeasureContext = null;
  }
  return sharedMeasureContext;
}

/**
 * 곡선 텍스트가 소비하는 진행 폭(px). 브라우저에서는 Konva와 같은 폰트 문자열로 캔버스
 * measureText를 써서 실측하고, 캔버스가 없으면 `estimateTextPathAdvanceWidth`로 폴백한다.
 * 여기 값을 `buildTextPathData`의 `minPathLength`로 넘기면 글자가 잘리지 않는다.
 */
export function textPathAdvanceWidth(input: TextPathTextInput): number {
  const text = input.text ?? "";
  if (!text) return 0;
  const fs = safeFontSize(input.fontSize);
  const letterSpacing = Number.isFinite(input.letterSpacing) ? (input.letterSpacing ?? 0) : 0;
  const ctx = measureContext();
  if (ctx) {
    // Konva Text._getContextFont와 같은 조립 순서: "<style> <size>px <family>".
    ctx.font = `${input.fontStyle ?? "normal"} ${fs}px ${input.fontFamily ?? "sans-serif"}`;
    const measured = ctx.measureText(text).width;
    if (Number.isFinite(measured) && measured > 0) {
      return measured + [...text].length * Math.max(0, letterSpacing);
    }
  }
  return estimateTextPathAdvanceWidth({ ...input, fontSize: fs, letterSpacing });
}

// ---------------------------------------------------------------------------
// 곡선 텍스트 프리셋 — 첫 항목은 직선(none), 나머지는 자주 쓰는 휨 모양·강도.
// 모든 value는 normalizeTextPath를 통과(알려진 shape, curve 0..100).
// ---------------------------------------------------------------------------

export type TextPathPreset = { id: string; label: string; tip: string; value: TextPathConfig };

export const TEXT_PATH_PRESETS: TextPathPreset[] = [
  {
    id: "straight",
    label: "직선",
    tip: "휘지 않는 기본 수평선 — 경로 효과를 끕니다.",
    value: { shape: "none", curve: 50 },
  },
  {
    id: "arch",
    label: "아치",
    tip: "글자를 위로 볼록한 아치 모양으로 둥글게 띄웁니다.",
    value: { shape: "arcUp", curve: 70 },
  },
  {
    id: "arch-deep",
    label: "깊은 아치",
    tip: "곡률을 최대로 키워 가파른 무지개형 아치를 만듭니다.",
    value: { shape: "arcUp", curve: 100 },
  },
  {
    id: "valley",
    label: "골짜기",
    tip: "글자를 아래로 볼록한 골짜기 모양으로 처지게 합니다.",
    value: { shape: "arcDown", curve: 70 },
  },
  {
    id: "wave",
    label: "물결",
    tip: "한 골 한 마루로 출렁이는 물결을 따라 글자를 흐르게 합니다.",
    value: { shape: "wave", curve: 60 },
  },
  {
    id: "circle-up",
    label: "원형 위",
    tip: "큰 원의 위쪽 호를 따라 글자를 둥글게 감습니다.",
    value: { shape: "circleUp", curve: 60 },
  },
];
