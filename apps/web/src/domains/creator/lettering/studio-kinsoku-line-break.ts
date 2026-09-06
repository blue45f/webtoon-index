/**
 * Studio Kinsoku Line Break — 가로쓰기 레터링의 **금칙처리(禁則処理)와 랙 균형**.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 이 저장소에는 금칙 규칙이 이미 두 군데 있었다.
 *  · `studio-vertical-text.ts` — 세로쓰기 열 조판. JIS X 4051 계열 규칙표를 제대로 갖췄고
 *    Unicode General_Category(Ps/Pi/Pe/Pf)까지 동적으로 본다.
 *  · `render/studio-canvaskit-adapter.ts` — 셰이핑 폴백 엔진의 최소 규칙(문자열 하나).
 *
 * 그런데 **정작 화면에 가장 많이 보이는 경로인 가로쓰기 말풍선 워드랩**
 * (`studio-bubble-text-fit.wrapBubbleTextLines`)에는 금칙이 아예 없었다. 그 결과 대사가
 * 다음처럼 끊길 수 있었다:
 *
 *      정말 그럴 리가 없잖아…      정말 그럴 리가 없잖아…?!
 *      ?!                    →     (금칙 적용 후)
 *
 * 줄 첫머리에 홀로 남은 `?!`·`」`·`…`는 아마추어 조판의 가장 눈에 띄는 신호다. 상용 웹툰
 * 레터링 도구는 예외 없이 이걸 막는다.
 *
 * 이 모듈은 **세 번째 규칙표를 만들지 않는다**. 행두/행말 금칙 판정은 세로쓰기 모듈의
 * `isVerticalNoBreakBefore`/`isVerticalNoBreakAfter`에 위임하고, 그 표가 일본어 조판
 * 중심이라 빠뜨린 **한국어 가로쓰기용 약물만 보충**한다(아래 KOREAN_* 상수). 금칙 대상
 * 글자는 쓰기 방향과 무관하므로 두 방향이 같은 판정을 공유하는 것이 맞다.
 *
 * §1. 행두 금칙 — 줄 첫머리에 올 수 없는 글자(닫는 괄호·구두점·반복부호·작은 가나).
 * §2. 행말 금칙 — 줄 끝에 올 수 없는 글자(여는 괄호·통화 기호 등 접두 기호).
 * §3. 追い出し(밀어내기) — 금칙 위반 시 줄바꿈 지점을 **앞으로** 물린다. 뒤로 미루는
 *     追い込み(밀어넣기)는 줄이 상자 폭을 넘기므로 말풍선에서는 쓰지 않는다.
 * §4. 랙 균형(rag balancing) — 그리디 워드랩이 만드는 "길게-길게-짧게" 계단을 없앤다.
 *
 * 랙 균형의 안전성(중요): 이 모듈의 균형 알고리즘은 **줄 수를 절대 바꾸지 않는다**.
 * 같은 줄 수를 유지하는 가장 좁은 폭을 이진 탐색해서 그 폭으로 다시 워드랩할 뿐이다
 * (CSS `text-wrap: balance`가 쓰는 것과 같은 성질). 줄 수가 불변이므로 말풍선 블록 높이
 * (= 줄 수 × fontSize × lineHeight)도 불변이고, 따라서 자동 축소 이진 탐색의 단조성
 * 가정도, 높이 자동 확장 결과도 한 픽셀도 달라지지 않는다. 바뀌는 것은 줄바꿈 위치뿐이다.
 *
 * 전부 순수·결정적이며 폭 측정은 호출부가 주입한다(브라우저 API 의존 없음).
 */

import { isVerticalNoBreakAfter, isVerticalNoBreakBefore } from "../studio-vertical-text";

// ── §0. 자소 군집 분할 ────────────────────────────────────────────────────────

/**
 * 사용자가 "한 글자"로 인식하는 단위(grapheme cluster)로 나눈다.
 *
 * 코드포인트 단위(`[...text]`)로 나누면 ZWJ 이모지(👨‍👩‍👧), 국기, 결합 문자가 중간에서
 * 쪼개져 렌더가 깨진다. 웹툰 대사에 이모지가 흔하지는 않지만, 강제 분할이 깨진 글자를
 * 만드는 것은 어떤 빈도에서도 허용할 수 없는 종류의 결함이다.
 *
 * `Intl.Segmenter`가 없는 엔진에서는 서로게이트 페어만 보존하는 코드포인트 분할로
 * 폴백한다(`studio-workspaces.ts`의 이름 자르기와 같은 관례).
 */
export function segmentGraphemes(text: string): string[] {
  if (text.length === 0) return [];
  if (typeof Intl.Segmenter !== "function") return Array.from(text);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

// ── §1·§2. 한국어 가로쓰기 보충 규칙표 ────────────────────────────────────────

/**
 * 행두 금칙 보충 — 세로쓰기 표(일본어 조판 기준)가 다루지 않는 한국어/라틴 약물.
 *
 * 세로쓰기 표는 마침표·쉼표를 **전각**(`、。，．｡､`)으로만 갖고 있는데, 한국어 웹툰 대사는
 * 압도적으로 ASCII `.` `,`를 쓴다. 말줄임을 `…` 대신 `...`로 치는 관행까지 감안하면 이
 * 두 글자가 실제로 가장 자주 위반되는 금칙이다.
 *
 * `'`와 `"`(ASCII 곧은 따옴표)는 **일부러 뺐다** — 여는 쪽인지 닫는 쪽인지 문자만 보고는
 * 알 수 없어서, 금칙으로 잡으면 `'말했다`처럼 정당한 줄 첫머리까지 막는다.
 */
export const KOREAN_NO_LINE_START = ".,·ㆍ‧~〜～%‰℃°′″㎏㎝㎞㎖㎠";
export const KOREAN_NO_LINE_START_SET: ReadonlySet<string> = new Set([...KOREAN_NO_LINE_START]);

/**
 * 행말 금칙 보충 — 뒤에 오는 수/단어에 붙어야 하는 접두 기호. `₩`로 줄이 끝나고 다음 줄이
 * `5,000`으로 시작하면 금액이 두 조각으로 읽힌다.
 */
export const KOREAN_NO_LINE_END = "₩$£¥€#№";
export const KOREAN_NO_LINE_END_SET: ReadonlySet<string> = new Set([...KOREAN_NO_LINE_END]);

/**
 * 행두 금칙 판정 — 이 자소로 줄이 **시작**될 수 없으면 true.
 *
 * 자소 군집을 받으므로 첫 코드포인트로 판정한다(결합 문자가 붙은 약물도 같은 역할이다).
 */
export function isKinsokuNoLineStart(grapheme: string | undefined): boolean {
  if (!grapheme) return false;
  const first = firstCodePoint(grapheme);
  return KOREAN_NO_LINE_START_SET.has(first) || isVerticalNoBreakBefore(first);
}

/** 행말 금칙 판정 — 이 자소로 줄이 **끝날** 수 없으면 true. */
export function isKinsokuNoLineEnd(grapheme: string | undefined): boolean {
  if (!grapheme) return false;
  const first = firstCodePoint(grapheme);
  return KOREAN_NO_LINE_END_SET.has(first) || isVerticalNoBreakAfter(first);
}

function firstCodePoint(grapheme: string): string {
  const code = grapheme.codePointAt(0);
  return code === undefined ? grapheme : String.fromCodePoint(code);
}

/**
 * `before`와 `after` 사이에서 줄을 끊어도 되는가.
 *
 * 문단 경계(둘 중 하나가 없음)는 항상 허용이다 — 금칙은 **줄 사이**의 규칙이지 문단
 * 시작/끝을 막는 규칙이 아니다.
 */
export function isKinsokuBreakAllowed(before: string | undefined, after: string | undefined): boolean {
  if (before === undefined || after === undefined) return true;
  return !isKinsokuNoLineEnd(before) && !isKinsokuNoLineStart(after);
}

// ── §3. 追い出し(밀어내기) ────────────────────────────────────────────────────

/**
 * 금칙 위반 시 줄바꿈 지점을 앞으로 물릴 수 있는 최대 자소 수.
 *
 * 무제한 물리면 `……………!?` 같은 약물 연타에서 줄 하나가 통째로 비워질 수 있다. JIS X 4051
 * 의 실무 관례대로 유한한 예산을 두고, 예산 안에서 합법 지점을 못 찾으면 원래 지점을 쓴다
 * (보기 나쁜 줄바꿈 하나가, 상자를 넘치거나 빈 줄을 만드는 것보다는 낫다).
 */
export const KINSOKU_MAX_RETREAT = 4;

/**
 * `desiredIndex`(그 인덱스 **앞에서** 끊는다) 를 금칙에 걸리지 않는 가장 가까운 앞쪽
 * 지점으로 물린다. `minIndex`(보통 줄 시작 + 1) 아래로는 내려가지 않는다 — 줄에 자소가
 * 하나도 안 남으면 진행이 멈춘다.
 *
 * 예산 안에 합법 지점이 없으면 `desiredIndex`를 그대로 돌려준다(위 KINSOKU_MAX_RETREAT 주석).
 */
export function retreatToLegalBreak(
  graphemes: readonly string[],
  desiredIndex: number,
  minIndex: number,
): number {
  const floor = Math.max(1, minIndex);
  if (desiredIndex <= floor) return desiredIndex;
  const limit = Math.max(floor, desiredIndex - KINSOKU_MAX_RETREAT);
  for (let index = desiredIndex; index >= limit; index -= 1) {
    if (isKinsokuBreakAllowed(graphemes[index - 1], graphemes[index])) return index;
  }
  return desiredIndex;
}

// ── §4. 랙 균형 ───────────────────────────────────────────────────────────────

/** 랙 균형 이진 탐색의 폭 해상도(px). 1px보다 잘게 나눠도 조판이 달라지지 않는다. */
const BALANCE_WIDTH_EPSILON = 1;

/**
 * 줄 수를 유지하는 **가장 좁은 폭**을 찾아 그 폭의 워드랩 결과를 돌려준다.
 *
 * 그리디 워드랩은 첫 줄을 최대한 채우므로 마지막 줄만 짧아지는 계단형 랙을 만든다
 * (`길게 / 길게 / 짧` — 말풍선 안에서는 아래가 텅 빈 것처럼 보인다). 폭을 좁히면 줄이
 * 고르게 나뉘고, **줄 수가 늘기 직전까지** 좁힌 폭이 가장 균형 잡힌 배치다.
 *
 * 단조성: 폭이 좁아질수록 그리디 워드랩의 줄 수는 단조 비감소한다. 따라서
 * "줄 수 ≤ 목표"인 최소 폭을 표준 경계 이진 탐색으로 찾을 수 있다.
 *
 * 줄 수 불변이 이 함수의 **계약**이다(모듈 docstring 참고). 탐색 결과가 목표 줄 수와
 * 다르면(병적 입력에서 단조성이 깨진 경우) 원본을 그대로 돌려준다.
 *
 * @param wrapAtWidth 주어진 폭으로 워드랩한 줄 배열을 돌려주는 순수 함수.
 * @param maxWidth    원래 사용 가능 폭(px). 여기서 나온 결과가 기준선이다.
 */
export function balanceRaggedLines(
  wrapAtWidth: (width: number) => string[],
  maxWidth: number,
): string[] {
  const baseline = wrapAtWidth(maxWidth);
  if (baseline.length <= 1) return baseline;

  // hi 는 항상 "목표 줄 수 이하"를 만족하는 폭, lo 는 항상 그렇지 않은 폭(또는 하한 후보).
  let lo = 0;
  let hi = maxWidth;
  while (hi - lo > BALANCE_WIDTH_EPSILON) {
    const mid = (lo + hi) / 2;
    if (wrapAtWidth(mid).length <= baseline.length) hi = mid;
    else lo = mid;
  }
  const balanced = wrapAtWidth(hi);
  return balanced.length === baseline.length ? balanced : baseline;
}
