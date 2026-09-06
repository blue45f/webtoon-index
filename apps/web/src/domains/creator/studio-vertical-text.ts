/**
 * Studio Vertical Text — 한국어/일본어 만화용 **세로쓰기(縦組み) 조판 순수 코어**.
 *
 * 기존 `formatVerticalText`(studio-bubble-text-runtime.ts)는 "가로 문자열을 전치(transpose)해
 * 가로 렌더러에 그대로 먹이는" 근사였다. 열이 우→좌로 오는 것까지는 맞지만,
 *  (1) 열 간격이 "공백 2칸"이라 글꼴마다 달라지고,
 *  (2) 라틴/숫자가 한 글자씩 세로로 쌓여 단어를 읽을 수 없고,
 *  (3) 장음표(ー)·괄호류가 가로 모양 그대로 누워 있고,
 *  (4) 문장부호(、。)가 세로쓰기 위치(우상단)로 가지 않으며,
 *  (5) 줄바꿈(열 넘김)이 아예 없어 상자 높이를 넘겨도 그대로 흘러나간다.
 *
 * 이 모듈은 그 다섯 가지를 제대로 처리하는 **순수·결정적 레이아웃 엔진**이다. DOM/Konva/SVG를
 * 전혀 모르고, 글자 폭 측정만 `VerticalTextMeasurer` 포트로 주입받는다(studio-bubble-text-fit.ts의
 * `BubbleTextMeasurer`와 구조적으로 동일 — 같은 측정기 인스턴스를 그대로 넘길 수 있다).
 * 출력은 "어디에 무엇을 몇 도로 그릴지"만 담은 아이템 배열이라, Konva 노드로도 SVG `<text>`로도
 * 같은 좌표로 그려진다(캔버스 ↔ 내보내기 파리티).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §1. 회전/직립 규칙(rotation vs upright) — 왜 "치환"이 아니라 "회전"인가
 * ────────────────────────────────────────────────────────────────────────────
 * 유니코드 UAX #50(Unicode Vertical Text Layout)은 코드포인트마다 `Vertical_Orientation`
 * 값(U/R/Tu/Tr)을 정의한다. 정석 구현은 U/Tu는 직립, R/Tr은 90° 회전 + OpenType `vert`/`vrt2`
 * 피처로 세로 전용 글리프를 치환하는 것이다. 그런데 이 스튜디오의 렌더 경로는 Canvas 2D
 * (`Konva.Text`)와 SVG `<text>`뿐이고, **둘 다 OpenType `vert`/`vrt2` 피처를 켤 방법이 없다**
 * (`font-feature-settings`는 SVG 내보내기 결과물의 뷰어 구현에 좌우돼 결정적이지 않다).
 * 대안인 CJK 호환 형태(U+FE10–FE19, U+FE30–FE4F "PRESENTATION FORM FOR VERTICAL …") 치환은
 * 우리가 번들하는 웹폰트(Pretendard 등)에서 커버리지가 들쭉날쭉해 tofu(□)가 날 수 있다.
 *
 * 그래서 이 모듈은 **치환 테이블을 두지 않고, 모양이 달라져야 하는 글자는 전부 기하학적 90°
 * 회전으로 만든다**. 괄호류·대시류·장음표의 "세로 전용 글리프"는 정의상 가로 글리프를 90°
 * 돌린 모양과 대체로 일치한다. 다만 폰트별 광학 위치·전용 GSUB 글리프까지 같다는 뜻은 아니므로
 * 이 경로를 **결정적 기하 폴백**으로 명시한다. 반대로 한글·한자·가나처럼 정사각 글리프는
 * 회전하면 안 되므로 직립으로 남긴다.
 *
 * 분류는 코드포인트만 보는 **순수 함수** `classifyVerticalGlyph()` 하나로 끝난다(§2 표 참고).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §2. 규칙표(코드포인트 → 형태)
 * ────────────────────────────────────────────────────────────────────────────
 *  A. ROTATE(90° 시계방향) — 가로 모양을 눕혀야 세로쓰기 모양이 되는 것들
 *     A1. 라틴/그리스/키릴 문자와 ASCII 숫자, 그리고 그 사이를 잇는 ASCII 기호
 *         (U+0021–U+007E 중 §B에 없는 것 전부, U+00C0–U+024F, U+0370–U+04FF).
 *         연속 구간은 하나의 **회전 런**으로 묶어 단어가 통째로 읽히게 한다. 단, 독립된
 *         ASCII 숫자 1–4자리는 한 세로 셀 안에 가로로 맞추는 종중횡조(縦中横)로 배치한다.
 *     A2. 괄호·따옴표류: ()[]{}〈〉《》「」『』【】〔〕（）［］｛｝〖〗〘〙〚〛"" ''
 *         여는/닫는 약물은 Unicode Ps/Pi/Pe/Pf 역할을 보존해 **각각 독립 셀**로 분절한다.
 *         따라서 `」「`처럼 방향 역할이 반대인 인접 약물을 하나의 회전 런으로 합치지 않는다.
 *     A3. 획 모양 기호: ー(U+30FC) 〜(U+301C) ～(U+FF5E) ‐‑‒–—―(U+2010–2015) ─(U+2500)
 *         －(U+FF0D) -(U+002D) _(U+005F) ＿(U+FF3F) ￣(U+FFE3) …(U+2026) ‥(U+2025)
 *         ∥(U+2225) ＝(U+FF1D) =(U+003D)
 *         (UAX #50은 ー을 U로 두지만, 그건 폰트의 `vert`가 세로 글리프를 준다는 전제다.
 *          그 전제가 성립하지 않는 우리 환경에서는 회전이 유일하게 올바른 결과다.)
 *
 *  B. UPRIGHT(직립) — 그 외 전부(기본값). 명시적으로 확인한 주요 구간:
 *     한글 음절/자모, CJK 통합한자(+확장·호환), 히라가나/가타카나, CJK 기호(〆々〇 등),
 *     전각 영숫자(Ａ-Ｚ ０-９ — 전각은 정사각이라 직립이 맞다), 한글/CJK 문장부호 중 §C 밖의
 *     것(？！：；·「밖의 기호들), 이모지/기타 문자.
 *
 *  C. UPRIGHT-SHIFTED(직립 + 위치 보정) — 글리프는 안 돌리되 em 상자 안에서 자리를 옮긴다
 *     C1. 마침표/쉼표류 、(U+3001) 。(U+3002) ，(U+FF0C) ．(U+FF0E) ｡(U+FF61) ､(U+FF64)
 *         가로쓰기에서는 em 상자의 **좌하단**에 잉크가 있지만, 세로쓰기에서는 **우상단**에
 *         와야 한다. 그래서 (+0.5em, −0.5em) 만큼 옮긴다.
 *     C2. 작은 가나(ぁぃぅぇぉっゃゅょゎゕゖ / ァィゥェォッャュョヮヵヶ)와 장음 보조기호는
 *         세로쓰기에서 오른쪽 위로 살짝(+0.08em, −0.08em) 붙는 것이 관례다(JIS X 4051).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §3. 열 배치 / 줄바꿈 / 금칙
 * ────────────────────────────────────────────────────────────────────────────
 *  - 열은 **오른쪽에서 왼쪽**으로 쌓인다(index 0 = 가장 오른쪽 열).
 *  - 원문의 `\n`은 "새 열"이다(기존 formatVerticalText와 같은 해석 — 하위호환).
 *  - **줄바꿈은 세로축(열 길이)으로 측정한다.** 열 길이가 `maxColumnLength`(= 상자 높이)를
 *    넘으면 다음 열로 넘긴다. 직립 글자의 세로 전진량은 `fontSize + letterSpacing`,
 *    회전 런의 전진량은 **가로 폭 측정값**(그래서 measurer가 필요하다).
 *  - 금칙(kinsoku) 최소 규칙: `、。，．？！ゝ` 등 §VERTICAL_NO_BREAK_BEFORE는 열 첫머리에
 *    올 수 없고, 여는 괄호는 열 끝에 올 수 없다. 넘침 시 최대 32개 셀만 역탐색해 가장 가까운
 *    유효 break를 고른다. 유효 break가 없는 중첩 약물은 조용히 버리지 않고 해당 열에 매달아
 *    `overflow=true`로 드러낸다(무한 역추적 없음).
 *  - `blockAlign`은 가로쓰기의 `align`과 같은 의미를 세로축에 적용한다:
 *    start=위 맞춤 · center=가운데 · end=아래 맞춤(호출부가 el.align을 매핑한다).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §4. 좌표계
 * ────────────────────────────────────────────────────────────────────────────
 *  레이아웃 로컬 원점 (0,0) = 텍스트 블록의 **좌상단**. x는 오른쪽, y는 아래가 양수(Canvas/SVG).
 *  열 i의 중심선 x = `width - (i + 0.5) * columnAdvance` (i=0이 가장 오른쪽).
 *  아이템의 (x, y)는 "그 아이템을 그릴 노드의 원점"이며 rotation은 그 원점을 중심으로 돈다
 *  (Konva `Text{x,y,rotation}` / SVG `translate(x y) rotate(deg)`와 동일 규약).
 *   · upright/shifted: 노드는 폭 `glyphBox`, `align:"center"`로 열 중앙에 놓인다.
 *   · rotated: rotation=90 이라 노드의 로컬 +x가 월드 +y가 된다 → 런이 아래로 흐른다.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §5. 현재 범위 밖
 * ────────────────────────────────────────────────────────────────────────────
 *  - 루비(후리가나), 할주(割注), 세로 밑줄/방점.
 *  - 제품 Canvas/SVG 경로의 OpenType `vert`/`vrt2` 강제 활성화(엔진 PathIR 레인이 담당).
 */

/** 글자 폭 측정 포트 — studio-bubble-text-fit.ts의 `BubbleTextMeasurer`와 구조적으로 동일. */
export interface VerticalTextMeasurer {
  measureWidth(text: string, fontPx: number, fontFamily: string, fontStyle: string): number;
}

/** 세로쓰기에서 한 글자가 취하는 형태. */
export type VerticalGlyphForm = "upright" | "rotated" | "shifted" | "tate-chu-yoko";

export interface VerticalGlyphClass {
  readonly form: VerticalGlyphForm;
  /** em 단위 가로 보정(오른쪽이 +). 문장부호/작은 가나의 세로 광학 위치에 사용한다. */
  readonly offsetX: number;
  /** em 단위 세로 보정(아래가 +). 문장부호/작은 가나의 세로 광학 위치에 사용한다. */
  readonly offsetY: number;
}

const UPRIGHT: VerticalGlyphClass = { form: "upright", offsetX: 0, offsetY: 0 };
const ROTATED: VerticalGlyphClass = { form: "rotated", offsetX: 0, offsetY: 0 };
/** 마침표/쉼표류 — 좌하단 잉크를 우상단으로(§2 C1). */
const SHIFTED_STOP: VerticalGlyphClass = { form: "shifted", offsetX: 0.5, offsetY: -0.5 };
/** 작은 가나 — 오른쪽 위로 살짝(§2 C2). */
const SHIFTED_SMALL_KANA: VerticalGlyphClass = { form: "shifted", offsetX: 0.08, offsetY: -0.08 };

/** Unicode/JIS 계열 여는 약물. 명시 집합 밖 Ps/Pi도 분류기에서 수용한다. */
const OPENING_PUNCTUATION = "([{（［｛｟〈《「『【〔〖〘〚“‘〝";
/** Unicode/JIS 계열 닫는 약물. 명시 집합 밖 Pe/Pf도 분류기에서 수용한다. */
const CLOSING_PUNCTUATION = ")]｝）］｠〉》」』】〕〗〙〛”’〞}";
/** §2 A2 — 괄호·따옴표류(회전). */
const ROTATED_BRACKETS = `${OPENING_PUNCTUATION}${CLOSING_PUNCTUATION}`;
/** §2 A3 — 획 모양 기호(회전). */
const ROTATED_STROKES = "ー〜～‐‑‒–—―─－-_＿￣…‥∥＝=";
/** §2 C1 — 우상단으로 옮기는 마침표/쉼표류. */
const SHIFTED_STOPS = "、。，．｡､";
/** §2 C2 — 작은 가나. */
const SMALL_KANA = "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ";
/** 셀 중심에 직립 배치하되 행두 금칙을 적용하는 전각 약물. ASCII는 UAX #50대로 회전한다. */
const CENTERED_SENTENCE_PUNCTUATION = "！？：；・･!?;:";

const ROTATED_BRACKET_SET: ReadonlySet<string> = new Set([...ROTATED_BRACKETS]);
const ROTATED_STROKE_SET: ReadonlySet<string> = new Set([...ROTATED_STROKES]);
const SHIFTED_STOP_SET: ReadonlySet<string> = new Set([...SHIFTED_STOPS]);
const SMALL_KANA_SET: ReadonlySet<string> = new Set([...SMALL_KANA]);
const OPENING_PUNCTUATION_SET: ReadonlySet<string> = new Set([...OPENING_PUNCTUATION]);
const CLOSING_PUNCTUATION_SET: ReadonlySet<string> = new Set([...CLOSING_PUNCTUATION]);
const CENTERED_SENTENCE_PUNCTUATION_SET: ReadonlySet<string> = new Set([
  ...CENTERED_SENTENCE_PUNCTUATION,
]);

/** 세로 조판에서 줄 경계와 광학 배치를 결정하는 Unicode 약물 역할. */
export type VerticalPunctuationRole =
  | "none"
  | "opening"
  | "closing"
  | "stop"
  | "small"
  | "centered"
  | "stroke";

const UNICODE_OPENING_PUNCTUATION = /^(?:\p{Ps}|\p{Pi})$/u;
const UNICODE_CLOSING_PUNCTUATION = /^(?:\p{Pe}|\p{Pf})$/u;

/**
 * 명시 JIS/CJK 집합을 우선하고 Unicode General_Category(Ps/Pi/Pe/Pf)를 보조로 쓰는 약물 분류.
 * 코드포인트 하나만 받으며 서로게이트 페어에도 결정적이다.
 */
export function classifyVerticalPunctuation(char: string): VerticalPunctuationRole {
  if (SHIFTED_STOP_SET.has(char)) return "stop";
  if (SMALL_KANA_SET.has(char)) return "small";
  if (OPENING_PUNCTUATION_SET.has(char) || UNICODE_OPENING_PUNCTUATION.test(char)) return "opening";
  if (CLOSING_PUNCTUATION_SET.has(char) || UNICODE_CLOSING_PUNCTUATION.test(char)) return "closing";
  if (CENTERED_SENTENCE_PUNCTUATION_SET.has(char)) return "centered";
  if (ROTATED_STROKE_SET.has(char)) return "stroke";
  return "none";
}

/** 열 첫머리에 올 수 없는 글자(행두 금칙). */
export const VERTICAL_NO_BREAK_BEFORE: ReadonlySet<string> = new Set([
  ...SHIFTED_STOPS,
  ...SMALL_KANA,
  ...CENTERED_SENTENCE_PUNCTUATION,
  ...CLOSING_PUNCTUATION,
  "ー", "…", "‥",
]);

/** 열 끝에 올 수 없는 글자(행말 금칙 — 여는 괄호류). */
export const VERTICAL_NO_BREAK_AFTER: ReadonlySet<string> = new Set([
  ...OPENING_PUNCTUATION,
]);

/** 동적 Unicode 약물까지 포함하는 행두 금칙 판정. */
export function isVerticalNoBreakBefore(char: string): boolean {
  const role = classifyVerticalPunctuation(char);
  return (
    VERTICAL_NO_BREAK_BEFORE.has(char)
    || role === "closing"
    || role === "stop"
    || role === "small"
    || role === "centered"
  );
}

/** 동적 Unicode 약물까지 포함하는 행말 금칙 판정. */
export function isVerticalNoBreakAfter(char: string): boolean {
  return VERTICAL_NO_BREAK_AFTER.has(char) || classifyVerticalPunctuation(char) === "opening";
}

/**
 * §2의 규칙표를 그대로 구현한 **순수 분류기**. 입력은 한 글자(코드포인트 하나 — 서로게이트
 * 페어를 포함한 문자열). 표에 없는 모든 것은 직립이 기본값이다.
 */
export function classifyVerticalGlyph(char: string): VerticalGlyphClass {
  const code = char.codePointAt(0);
  if (code === undefined) return UPRIGHT;

  // C1/C2 — 위치만 보정하는 직립 글자(회전 판정보다 먼저: 、。는 ASCII가 아니지만 명시 집합).
  if (SHIFTED_STOP_SET.has(char)) return SHIFTED_STOP;
  if (SMALL_KANA_SET.has(char)) return SHIFTED_SMALL_KANA;

  // A2/A3 — 명시 회전 집합.
  const punctuation = classifyVerticalPunctuation(char);
  if (punctuation === "opening" || punctuation === "closing" || ROTATED_BRACKET_SET.has(char)) {
    return ROTATED;
  }
  if (ROTATED_STROKE_SET.has(char)) return ROTATED;

  // A1 — 라틴/그리스/키릴 + 그 사이의 ASCII 기호. 전각 영숫자(U+FF01~)는 정사각이라 제외한다.
  if (code >= 0x21 && code <= 0x7e) return ROTATED;
  if (code >= 0x00c0 && code <= 0x024f) return ROTATED; // Latin-1 Supplement 문자 ~ Latin Extended-B
  if (code >= 0x0370 && code <= 0x04ff) return ROTATED; // Greek + Cyrillic

  return UPRIGHT;
}

// ── 레이아웃 ────────────────────────────────────────────────────────────────

export type VerticalBlockAlign = "start" | "center" | "end";

export interface VerticalTextLayoutInput {
  readonly text: string;
  readonly fontSize: number;
  /** 열 간격 배수(가로쓰기 lineHeight와 같은 의미 — 열 전진량 = fontSize × lineHeight). */
  readonly lineHeight: number;
  /** 글자 사이 추가 간격(px) — 세로쓰기에서는 **세로 방향** 간격이 된다. */
  readonly letterSpacing?: number;
  readonly fontFamily: string;
  readonly fontStyle?: string;
  /** 열 하나가 쓸 수 있는 최대 길이(px). 미지정/0 이하이면 자동 열 넘김을 하지 않는다. */
  readonly maxColumnLength?: number;
  /** 열 안에서 내용 정렬(가로쓰기 align의 세로축 대응). 기본 start. */
  readonly blockAlign?: VerticalBlockAlign;
}

export interface VerticalTextItem {
  readonly form: VerticalGlyphForm;
  /** Unicode/JIS 약물 역할. 일반 글자와 종중횡조는 `none`. */
  readonly punctuation: VerticalPunctuationRole;
  /** upright는 글자들을 "\n"으로 이어 하나의 노드로 그린다(런 병합). 나머지는 원문 그대로. */
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: 0 | 90;
  /** 이 아이템이 열에서 차지하는 길이(px). */
  readonly length: number;
  /** upright 런에서 글자 하나의 세로 전진량(px) — 렌더러가 lineHeight로 환산해 쓴다. */
  readonly glyphAdvance: number;
  /** 縦中横의 가로 압축 비율. 그 외 form은 항상 1. */
  readonly horizontalScale: number;
}

export interface VerticalTextColumn {
  /** 0 = 가장 오른쪽 열. */
  readonly index: number;
  readonly centerX: number;
  readonly length: number;
  readonly items: readonly VerticalTextItem[];
}

export interface VerticalTextLayout {
  readonly columns: readonly VerticalTextColumn[];
  /** 블록 전체 폭(px) = 열 수 × 열 전진량. */
  readonly width: number;
  /** 가장 긴 열의 길이(px). */
  readonly height: number;
  readonly columnAdvance: number;
  /** maxColumnLength가 있는데도 한 아이템이 홀로 그 길이를 넘겨 흘러넘친 경우 true. */
  readonly overflow: boolean;
}

/** 분류가 같은 연속 구간(런). rotated는 measurer로 폭을 재고, upright는 글자 수로 계산한다. */
interface VerticalRun {
  readonly form: VerticalGlyphForm;
  readonly chars: readonly string[];
}

/** 코드포인트 단위로 쪼갠다(서로게이트 페어·이모지 안전 — 기존 문자열 인덱싱 버그 수정). */
export function toVerticalGlyphs(text: string): string[] {
  return [...text];
}

/**
 * 연속 구간을 런으로 묶는다. 광학/금칙 역할이 있는 약물은 같은 `rotated`/`upright` 형식이어도
 * 항상 1글자 런으로 격리한다. 라틴 내부 하이픈·장음 같은 stroke만 읽기 흐름 보존을 위해 병합한다.
 */
export function segmentVerticalRuns(text: string): VerticalRun[] {
  const runs: VerticalRun[] = [];
  let current: { form: VerticalGlyphForm; chars: string[] } | null = null;
  for (const char of toVerticalGlyphs(text)) {
    const { form } = classifyVerticalGlyph(char);
    const punctuation = classifyVerticalPunctuation(char);
    if (form === "shifted" || (punctuation !== "none" && punctuation !== "stroke")) {
      if (current) runs.push(current);
      current = null;
      runs.push({ form, chars: [char] });
      continue;
    }
    if (current && current.form === form) {
      current.chars.push(char);
      continue;
    }
    if (current) runs.push(current);
    current = { form, chars: [char] };
  }
  if (current) runs.push(current);
  return runs.map((run) => {
    if (
      run.form === "rotated"
      && run.chars.length >= 1
      && run.chars.length <= 4
      && run.chars.every((char) => /^[0-9]$/u.test(char))
    ) {
      return { form: "tate-chu-yoko" as const, chars: run.chars };
    }
    return run;
  });
}

/** 배치 도중의 열 — 아직 x가 정해지지 않았다(열 수를 알아야 x를 계산할 수 있다). */
interface PendingItem {
  readonly form: VerticalGlyphForm;
  readonly text: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly length: number;
  readonly glyphAdvance: number;
  readonly horizontalScale: number;
  /** 렌더 병합과 금칙 판정용 약물 역할. */
  readonly punctuation: VerticalPunctuationRole;
  /** 금칙 판정용 — 이 아이템의 첫 글자와 마지막 글자. */
  readonly firstChar: string;
  readonly lastChar: string;
}

function pendingLength(items: readonly PendingItem[]): number {
  let total = 0;
  for (const item of items) total += item.length;
  return total;
}

/** 금칙 역탐색은 입력 길이와 무관하게 이 셀 수에서 끝난다. */
export const VERTICAL_KINSOKU_BACKTRACK_LIMIT = 32;

/**
 * 회전 런을 열 길이 안에 들어가도록 글자 단위로 강제 분할한다(가로쓰기 hardBreakWord의 세로판).
 * 마지막 조각은 "아직 안 찬 나머지"이므로 호출부가 이어 붙일 수 있다.
 */
function hardBreakRotatedRun(
  chars: readonly string[],
  maxLength: number,
  measure: (text: string) => number
): string[] {
  const out: string[] = [];
  let current = "";
  for (const char of chars) {
    const candidate = current + char;
    if (current.length > 0 && measure(candidate) > maxLength) {
      out.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out;
}

/**
 * 세로쓰기 레이아웃 — 모듈 상단 §3/§4 규약 그대로. 전부 순수(같은 입력 → 같은 출력).
 */
export function layoutVerticalText(
  input: VerticalTextLayoutInput,
  measurer: VerticalTextMeasurer
): VerticalTextLayout {
  const fontSize = Math.max(1, input.fontSize);
  const letterSpacing = input.letterSpacing ?? 0;
  const fontStyle = input.fontStyle ?? "bold";
  const columnAdvance = fontSize * Math.max(0.01, input.lineHeight);
  const maxColumnLength =
    input.maxColumnLength !== undefined && input.maxColumnLength > 0 ? input.maxColumnLength : Infinity;
  const blockAlign = input.blockAlign ?? "start";
  const measure = (text: string) => measurer.measureWidth(text, fontSize, input.fontFamily, fontStyle);

  const columns: PendingItem[][] = [];
  let overflow = false;

  for (const paragraph of input.text.split("\n")) {
    // 원문의 각 줄이 하나의 열로 시작한다(넘치면 아래에서 열이 더 늘어난다).
    let column: PendingItem[] = [];
    const flush = () => {
      columns.push(column);
      column = [];
    };

    const push = (item: PendingItem) => {
      if (item.length > maxColumnLength) {
        // 한 아이템이 홀로 열보다 길다 — 더 쪼갤 수 없으므로 그대로 두고 정직하게 표시한다.
        overflow = true;
        if (column.length > 0) flush();
        column.push(item);
        flush();
        return;
      }
      if (pendingLength(column) + item.length <= maxColumnLength) {
        column.push(item);
        return;
      }
      // 열 넘김 — 가장 가까운 유효 경계를 제한적으로 역탐색한다. suffix 첫 글자가 행두
      // 금칙이거나 prefix 마지막 글자가 행말 금칙이면 한 셀 더 뒤로 간다. 인접 `」「`와
      // 닫는 약물 연쇄를 글자 단위로 다룰 수 있는 이유가 약물이 독립 PendingItem이기 때문이다.
      const combined = [...column, item];
      const minimumBreak = Math.max(1, column.length - VERTICAL_KINSOKU_BACKTRACK_LIMIT);
      let breakAt: number | null = null;
      for (let candidate = column.length; candidate >= minimumBreak; candidate -= 1) {
        const before = combined[candidate - 1];
        const after = combined[candidate];
        if (!before || !after) continue;
        if (isVerticalNoBreakAfter(before.lastChar)) continue;
        if (isVerticalNoBreakBefore(after.firstChar)) continue;
        if (pendingLength(combined.slice(candidate)) > maxColumnLength) continue;
        breakAt = candidate;
        break;
      }

      if (breakAt !== null) {
        column = combined.slice(0, breakAt);
        flush();
        column.push(...combined.slice(breakAt));
        return;
      }

      // 중첩 괄호처럼 제한 안에서 유효 break가 존재하지 않으면 약물을 버리거나 무한
      // backtrack하지 않는다. 해당 열에 매달고 overflow를 표면화한다.
      column.push(item);
      overflow = true;
    };

    for (const run of segmentVerticalRuns(paragraph)) {
      if (run.form === "shifted") {
        const char = run.chars[0]!;
        const { offsetX, offsetY } = classifyVerticalGlyph(char);
        push({
          form: "shifted",
          text: char,
          offsetX,
          offsetY,
          length: fontSize + letterSpacing,
          glyphAdvance: fontSize + letterSpacing,
          horizontalScale: 1,
          punctuation: classifyVerticalPunctuation(char),
          firstChar: char,
          lastChar: char,
        });
        continue;
      }
      if (run.form === "upright") {
        // 직립 런은 글자 단위로 열을 넘길 수 있으므로 한 글자씩 넣는다(렌더 직전에 다시 병합).
        for (const char of run.chars) {
          push({
            form: "upright",
            text: char,
            offsetX: 0,
            offsetY: 0,
            length: fontSize + letterSpacing,
            glyphAdvance: fontSize + letterSpacing,
            horizontalScale: 1,
            punctuation: classifyVerticalPunctuation(char),
            firstChar: char,
            lastChar: char,
          });
        }
        continue;
      }
      if (run.form === "tate-chu-yoko") {
        const runText = run.chars.join("");
        const measured = Math.max(1, measure(runText));
        push({
          form: "tate-chu-yoko",
          text: runText,
          offsetX: 0,
          offsetY: 0,
          length: fontSize + letterSpacing,
          glyphAdvance: fontSize + letterSpacing,
          horizontalScale: Math.min(1, fontSize / measured),
          punctuation: "none",
          firstChar: run.chars[0]!,
          lastChar: run.chars[run.chars.length - 1]!,
        });
        continue;
      }
      // 회전 런 — 단어가 통째로 읽히도록 원자적으로 넣되, 열보다 길면 강제 분할한다.
      const runText = run.chars.join("");
      const runLength = measure(runText) + letterSpacing;
      if (runLength <= maxColumnLength) {
        push({
          form: "rotated",
          text: runText,
          offsetX: 0,
          offsetY: 0,
          length: runLength,
          glyphAdvance: runLength,
          horizontalScale: 1,
          punctuation: classifyVerticalPunctuation(run.chars[0]!),
          firstChar: run.chars[0]!,
          lastChar: run.chars[run.chars.length - 1]!,
        });
        continue;
      }
      for (const piece of hardBreakRotatedRun(run.chars, maxColumnLength - letterSpacing, measure)) {
        if (piece.length === 0) continue;
        push({
          form: "rotated",
          text: piece,
          offsetX: 0,
          offsetY: 0,
          length: measure(piece) + letterSpacing,
          glyphAdvance: measure(piece) + letterSpacing,
          horizontalScale: 1,
          punctuation: classifyVerticalPunctuation(piece[0]!),
          firstChar: piece[0]!,
          lastChar: piece[piece.length - 1]!,
        });
      }
    }
    flush();
  }

  const columnCount = Math.max(1, columns.length);
  const width = columnCount * columnAdvance;
  const height = columns.reduce((max, items) => Math.max(max, pendingLength(items)), 0);

  const laidOut: VerticalTextColumn[] = columns.map((items, index) => {
    const centerX = width - (index + 0.5) * columnAdvance;
    const columnLength = pendingLength(items);
    const slack = Math.max(0, height - columnLength);
    const startY = blockAlign === "center" ? slack / 2 : blockAlign === "end" ? slack : 0;
    let cursor = startY;
    const merged: VerticalTextItem[] = [];
    for (const item of items) {
      const previous = merged[merged.length - 1];
      if (
        item.form === "upright"
        && previous?.form === "upright"
        && item.punctuation === "none"
        && previous.punctuation === "none"
        && previous.glyphAdvance === item.glyphAdvance
      ) {
        // 연속 직립 글자는 하나의 노드로 병합한다(노드 수 절감 — 렌더러가 "\n"으로 쌓아 그린다).
        merged[merged.length - 1] = {
          ...previous,
          text: `${previous.text}\n${item.text}`,
          length: previous.length + item.length,
        };
        cursor += item.length;
        continue;
      }
      merged.push({
        form: item.form,
        punctuation: item.punctuation,
        text: item.text,
        x: centerX - fontSize / 2 + item.offsetX * fontSize,
        y: cursor + item.offsetY * fontSize,
        rotation: item.form === "rotated" ? 90 : 0,
        length: item.length,
        glyphAdvance: item.glyphAdvance,
        horizontalScale: item.horizontalScale,
      });
      cursor += item.length;
    }
    return { index, centerX, length: columnLength, items: merged };
  });

  return {
    columns: laidOut,
    width,
    height,
    columnAdvance,
    overflow,
  };
}

/**
 * 가로쓰기 `align` → 세로쓰기 열 정렬. 가로쓰기에서 align이 "줄을 상자 안에서 어디에 붙일지"를
 * 정하듯, 세로쓰기에서는 "열을 블록 안에서 위/가운데/아래 어디에 붙일지"가 같은 역할을 한다
 * (CSS 논리 속성의 inline 축 정렬과 같은 대응 — 가로쓰기 inline 축=가로, 세로쓰기 inline 축=세로).
 */
export function verticalBlockAlign(align: "left" | "center" | "right" | undefined): VerticalBlockAlign {
  return align === "center" ? "center" : align === "right" ? "end" : "start";
}

/**
 * 아이템 하나를 그릴 때 쓸 Konva/SVG 공통 텍스트 지오메트리 — 두 렌더러가 같은 값을 쓰도록
 * 한 곳에서만 계산한다.
 *  · upright/shifted: 폭 `boxWidth`짜리 가운데 정렬 상자에 글자를 "\n"으로 쌓고, 열 방향
 *    전진량을 `lineHeight` 배수로 환산한다(자간이 있으면 1보다 커진다).
 *  · tate-chu-yoko: 역비율 폭 상자를 `scaleX`로 압축해 시각 폭을 정확히 1em으로 맞춘다.
 *  · rotated: 한 줄짜리 노드를 90° 돌린다(로컬 +x가 월드 +y가 되어 런이 아래로 흐른다).
 */
export function verticalTextItemGeometry(
  item: VerticalTextItem,
  fontSize: number
): { boxWidth: number; lineHeight: number; scaleX: number } {
  const scaleX =
    item.form === "tate-chu-yoko"
      ? Math.max(0.01, Math.min(1, item.horizontalScale))
      : 1;
  return {
    // Konva/SVG scale from the item's left edge. An inverse-width box keeps
    // the scaled visual width exactly one em and therefore centered at item.x.
    boxWidth: Math.max(1, fontSize) / scaleX,
    lineHeight:
      item.form === "rotated" || item.form === "tate-chu-yoko"
        ? 1
        : Math.max(0.01, item.glyphAdvance / Math.max(1, fontSize)),
    scaleX,
  };
}

/**
 * 자동 축소(auto-fit)가 쓰는 **세로축 측정** — 블록의 폭/높이만 필요할 때의 얇은 래퍼.
 * 세로쓰기에서 "줄 수"에 해당하는 것은 열 수이고, 상자 높이가 열 길이를 제한한다.
 */
export function measureVerticalTextBlock(
  input: VerticalTextLayoutInput,
  measurer: VerticalTextMeasurer
): { width: number; height: number; columnCount: number; overflow: boolean } {
  const layout = layoutVerticalText(input, measurer);
  return {
    width: layout.width,
    height: layout.height,
    columnCount: layout.columns.length,
    overflow: layout.overflow,
  };
}
