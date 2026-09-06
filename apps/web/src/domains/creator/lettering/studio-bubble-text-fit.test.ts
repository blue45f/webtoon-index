import { describe, expect, it } from "vitest";

import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  BUBBLE_LINE_HEIGHT_DEFAULTS,
  BUBBLE_LINE_HEIGHT_FALLBACK,
  bubbleHorizontalPadding,
  bubbleLetterSpacing,
  bubbleTextFitsInBox,
  bubbleVerticalPadding,
  createCanvasBubbleTextMeasurer,
  fitBubbleBoxHeightToText,
  fitBubbleFontSize,
  measureBubbleTextBlock,
  resolveBubbleFontFamily,
  resolveBubbleFontSize,
  resolveBubbleFontStyle,
  resolveBubbleLineHeight,
  withBubbleLetterSpacing,
  wrapBubbleTextLines,
  type BubbleTextMeasurer,
} from "./studio-bubble-text-fit";

// 결정적 가짜 측정기 — 글자당 fontPx*charFactor px로 렌더 폭을 근사한다(실제 폰트 굴곡과 무관하게
// "폭이 텍스트 길이·폰트 크기에 비례한다"는 성질만 있으면 이 모듈의 알고리즘을 검증하기 충분하다).
function fakeMeasurer(charFactor = 0.6): BubbleTextMeasurer {
  return {
    measureWidth(text, fontPx) {
      return text.length * fontPx * charFactor;
    },
  };
}

describe("bubbleHorizontalPadding / bubbleVerticalPadding", () => {
  it("StudioPage.tsx의 기존 bHPad/bVPadTop/bVPadBot 공식과 동일한 값을 낸다", () => {
    expect(bubbleHorizontalPadding(24)).toBe(Math.max(12, Math.round(24 * 0.6)));
    expect(bubbleVerticalPadding(24)).toEqual({
      top: Math.max(8, Math.round(24 * 0.48)),
      bottom: Math.max(10, Math.round(24 * 0.64)),
    });
  });

  it("작은 폰트에서는 하한(12/8/10px)에 클램프된다", () => {
    expect(bubbleHorizontalPadding(6)).toBe(12);
    expect(bubbleVerticalPadding(6)).toEqual({ top: 8, bottom: 10 });
  });
});

describe("wrapBubbleTextLines", () => {
  it("공백 단위로 그리디하게 줄바꿈한다", () => {
    const measurer = fakeMeasurer(1); // 1px/문자(공백 포함)/폰트px 로 계산을 단순화
    // 글자·공백 각 20px(폰트20*1) — "가 나"=3문자=60px, "가 나 다"=5문자=100px.
    // maxWidth=65면 "가 나"(60px)까지는 들어가고 "다"를 더하면 넘쳐 다음 줄로 밀린다.
    const lines = wrapBubbleTextLines("가 나 다 라", 65, 20, "sans-serif", "normal", measurer);
    expect(lines).toEqual(["가 나", "다 라"]);
  });

  it("명시적 줄바꿈(\\n)을 항상 존중한다", () => {
    const measurer = fakeMeasurer(0.1); // 폭 여유를 크게 둬 줄바꿈이 개행 문자에서만 일어나게 한다
    const lines = wrapBubbleTextLines("첫줄\n둘째줄", 1000, 20, "sans-serif", "normal", measurer);
    expect(lines).toEqual(["첫줄", "둘째줄"]);
  });

  it("연속 빈 줄(문단)을 보존한다", () => {
    const measurer = fakeMeasurer(0.1);
    const lines = wrapBubbleTextLines("가\n\n나", 1000, 20, "sans-serif", "normal", measurer);
    expect(lines).toEqual(["가", "", "나"]);
  });

  it("공백 없는 긴 단어는 글자 단위로 강제 분할한다", () => {
    const measurer = fakeMeasurer(1);
    // 각 글자 20px, maxWidth=45 → 2글자(40px)까지 들어가고 3번째 글자부터 다음 줄.
    const lines = wrapBubbleTextLines("가나다라마", 45, 20, "sans-serif", "normal", measurer);
    expect(lines.join("")).toBe("가나다라마"); // 글자 유실 없음
    expect(lines.every((line) => measurer.measureWidth(line, 20, "sans-serif", "normal") <= 45)).toBe(true);
  });
});

describe("fitBubbleFontSize", () => {
  // lineHeight는 필수 필드다(§ studio-bubble-text-fit.ts의 BubbleFontFitInput.lineHeight 참고) —
  // 호출부(StudioPage.tsx)의 실제 렌더 기본값(el.vertical ? 1.4 : webtoonTheme === "soft" ? 1.35 :
  // webtoonTheme === "vivid" ? 1.2 : 1.25)과 같은 소스를 공유해야 한다. 여기서는 "vivid" 테마 값을
  // 대표로 쓴다.
  const baseInput = {
    text: "짧은 대사",
    boxWidth: 260,
    boxHeight: 140,
    maxFontSize: 24,
    fontFamily: "Pretendard, sans-serif",
    lineHeight: 1.2,
  };

  it("텍스트가 짧으면 maxFontSize를 그대로 반환한다(탐색 없이 통과)", () => {
    const result = fitBubbleFontSize(baseInput, fakeMeasurer());
    expect(result.fontSize).toBe(24);
    expect(result.overflow).toBe(false);
  });

  it("텍스트가 길면 maxFontSize보다 작은 크기로 줄어든다", () => {
    const longText = "아주 길고 긴 대사가 여기 끝없이 이어지고 또 이어지고 계속 이어진다".repeat(3);
    const result = fitBubbleFontSize({ ...baseInput, text: longText }, fakeMeasurer());
    expect(result.fontSize).toBeLessThan(24);
    expect(result.fontSize).toBeGreaterThanOrEqual(BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT);
  });

  it("minFontSize에서도 안 맞으면 overflow:true와 함께 minFontSize를 반환한다", () => {
    const veryLongText = "끝나지 않는 아주 긴 대사 ".repeat(80);
    const result = fitBubbleFontSize(
      { ...baseInput, text: veryLongText, minFontSize: 12 },
      fakeMeasurer()
    );
    expect(result.fontSize).toBe(12);
    expect(result.overflow).toBe(true);
  });

  it("박스가 더 크면(여유가 많으면) 같은 텍스트에 대해 같거나 더 큰 폰트를 고른다(단조성)", () => {
    const text = "웹툰 대사가 이 정도로 길게 들어있는 말풍선 텍스트 예시입니다";
    const small = fitBubbleFontSize({ ...baseInput, text, boxWidth: 180, boxHeight: 100 }, fakeMeasurer());
    const big = fitBubbleFontSize({ ...baseInput, text, boxWidth: 400, boxHeight: 260 }, fakeMeasurer());
    expect(big.fontSize).toBeGreaterThanOrEqual(small.fontSize);
  });

  it("결정적이다 — 같은 입력은 항상 같은 결과", () => {
    const a = fitBubbleFontSize({ ...baseInput, text: "반복 테스트용 대사입니다" }, fakeMeasurer());
    const b = fitBubbleFontSize({ ...baseInput, text: "반복 테스트용 대사입니다" }, fakeMeasurer());
    expect(a).toEqual(b);
  });

  // 회귀 테스트 — lineHeight가 결과에 실제로 반영되는지 확인한다. 예전 버전은 이 필드가 선택값이고
  // 호출부가 생략하면 조용히 1.1로 폴백했는데, 1.1은 StudioPage.tsx의 실제 bubbleLineHeight
  // 기본값(테마/세로쓰기에 따라 1.2~1.4)보다 항상 작아 텍스트 블록 높이를 과소평가했다 — 폰트를
  // 충분히 줄이지 못해 "크기 고정"에서도 텍스트가 넘치는 회귀로 이어질 수 있었다. lineHeight를
  // 필수 필드로 바꿔 이 시나리오 자체가 타입 레벨에서 불가능해졌지만, 그와 별개로 값 자체가 결과
  // 산출에 실제로 쓰이는지는 이 테스트가 런타임으로 검증한다.
  it("lineHeight이 클수록(줄 간격이 넓을수록) 여러 줄에서 같거나 더 작은 폰트를 고른다", () => {
    const text = "웹툰 대사가 이 정도로 길게 들어있는 말풍선 텍스트 예시입니다 그리고 조금 더 길게 이어진다";
    const tight = fitBubbleFontSize({ ...baseInput, text, lineHeight: 1.0 }, fakeMeasurer());
    const loose = fitBubbleFontSize({ ...baseInput, text, lineHeight: 1.4 }, fakeMeasurer());
    expect(loose.fontSize).toBeLessThanOrEqual(tight.fontSize);
    expect(loose.fontSize).toBeLessThan(24); // 실제로 탐색이 개입했는지(둘 다 상한 그대로가 아닌지) 확인.
  });
});

describe("fitBubbleFontSize — 세로쓰기", () => {
  // 세로쓰기는 판정 축이 뒤바뀐다: 열은 **상자 높이**로 끊고, 그렇게 나온 열 수 × 열 간격이
  // **상자 폭** 안에 들어오는지로 맞는지를 정한다(모듈 docstring 참고).
  const verticalInput = {
    boxWidth: 120,
    boxHeight: 200,
    maxFontSize: 24,
    fontFamily: "Pretendard, sans-serif",
    lineHeight: 1.4,
    vertical: true as const,
  };

  it("가로쓰기 경로를 바꾸지 않는다 — vertical 미설정/false는 완전히 동일한 결과", () => {
    const text = "웹툰 대사가 이 정도로 길게 들어있는 말풍선 텍스트 예시입니다";
    const legacy = fitBubbleFontSize(
      { text, boxWidth: 260, boxHeight: 140, maxFontSize: 24, fontFamily: "Pretendard, sans-serif", lineHeight: 1.2 },
      fakeMeasurer()
    );
    const explicitFalse = fitBubbleFontSize(
      {
        text,
        boxWidth: 260,
        boxHeight: 140,
        maxFontSize: 24,
        fontFamily: "Pretendard, sans-serif",
        lineHeight: 1.2,
        vertical: false,
      },
      fakeMeasurer()
    );
    expect(explicitFalse).toEqual(legacy);
  });

  it("짧은 대사는 상한 폰트를 그대로 쓰고 열 배열을 돌려준다", () => {
    const result = fitBubbleFontSize({ ...verticalInput, text: "가나다" }, fakeMeasurer());
    expect(result.fontSize).toBe(24);
    expect(result.overflow).toBe(false);
    expect(result.lines).toEqual(["가나다"]);
  });

  it("열이 늘어 상자 폭을 넘기면 폰트를 줄인다(세로축으로 끊고 가로로 판정)", () => {
    const text = "세로쓰기 대사가 길어지면 열이 자꾸 늘어난다".repeat(2);
    const result = fitBubbleFontSize({ ...verticalInput, text }, fakeMeasurer());
    expect(result.fontSize).toBeLessThan(24);
    expect(result.fontSize).toBeGreaterThanOrEqual(BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT);
  });

  it("좁고 낮은 상자에서는 하한까지 줄여도 못 맞춰 overflow를 보고한다", () => {
    const result = fitBubbleFontSize(
      { ...verticalInput, boxWidth: 60, boxHeight: 60, minFontSize: 12, text: "세로쓰기 대사".repeat(10) },
      fakeMeasurer()
    );
    expect(result.fontSize).toBe(12);
    expect(result.overflow).toBe(true);
  });

  it("같은 대사라도 상자가 넓어지면 같거나 더 큰 폰트를 고른다(단조성)", () => {
    const text = "세로쓰기 자동 축소 단조성 확인용 대사입니다";
    const narrow = fitBubbleFontSize({ ...verticalInput, boxWidth: 90, boxHeight: 160, text }, fakeMeasurer());
    const wide = fitBubbleFontSize({ ...verticalInput, boxWidth: 260, boxHeight: 320, text }, fakeMeasurer());
    expect(wide.fontSize).toBeGreaterThanOrEqual(narrow.fontSize);
  });

  it("결정적이다 — 같은 입력은 항상 같은 결과", () => {
    const text = "가나다ABC라마。";
    const a = fitBubbleFontSize({ ...verticalInput, text }, fakeMeasurer());
    const b = fitBubbleFontSize({ ...verticalInput, text }, fakeMeasurer());
    expect(a).toEqual(b);
  });

  it("자간이 커지면 열이 빨리 차서 같거나 더 작은 폰트를 고른다", () => {
    const text = "세로쓰기 자간에 따른 자동 축소 확인 대사";
    const tight = fitBubbleFontSize({ ...verticalInput, text, letterSpacing: 0 }, fakeMeasurer());
    const loose = fitBubbleFontSize({ ...verticalInput, text, letterSpacing: 8 }, fakeMeasurer());
    expect(loose.fontSize).toBeLessThanOrEqual(tight.fontSize);
  });
});

describe("createCanvasBubbleTextMeasurer", () => {
  // vitest.config.ts는 environment:"node"라 document가 정의돼 있지 않다 — 즉 이 스위트 안에서는
  // 항상 SSR/캔버스 미지원 폴백 경로("글자당 fontPx*0.55px" 근사)만 결정적으로 탄다. 실제 브라우저
  // ctx.measureText 경로는 이 테스트로 검증되지 않는다(런타임 전용, §docstring 참고).
  it("document가 없는 환경(SSR/노드 테스트)에서는 글자당 fontPx*0.55 근사로 폴백한다", () => {
    const measurer = createCanvasBubbleTextMeasurer();
    expect(measurer.measureWidth("abcd", 20, "sans-serif", "normal")).toBeCloseTo(4 * 20 * 0.55);
    expect(measurer.measureWidth("", 20, "sans-serif", "normal")).toBe(0);
  });
});

// ── 2026-08 브라우저 감사 회귀 계약 ──────────────────────────────────────────
//
// 결함의 뿌리는 "말풍선 기본 행간·글꼴 두께·패딩이 경로마다 달랐던 것"이었다:
//   렌더 1.25/1.35/1.4 · commitEditText 1.1 · fitBubbleToText 1.2.
// 아래 스위트는 그 기본값이 **한 곳에서만** 나오고, 그 값으로 잡은 상자에 대사가 실제로 다
// 들어간다는 것을 고정한다.

describe("resolveBubbleLineHeight (행간 단일 소스)", () => {
  it("테마·세로쓰기 조합별 기본값을 렌더가 쓰는 값 그대로 돌려준다", () => {
    expect(resolveBubbleLineHeight({ theme: "classic" })).toBe(1.25);
    expect(resolveBubbleLineHeight({ theme: "soft" })).toBe(1.35);
    expect(resolveBubbleLineHeight({ theme: "vivid" })).toBe(1.2);
    // 세로쓰기는 테마보다 우선한다(열 간격 기본 1.4).
    expect(resolveBubbleLineHeight({ theme: "vivid", vertical: true })).toBe(1.4);
  });

  it("요소가 지정한 행간이 언제나 우선한다", () => {
    expect(resolveBubbleLineHeight({ lineHeight: 1.8, theme: "soft", vertical: true })).toBe(1.8);
  });

  it("테마를 모르면 표의 최댓값으로 폴백한다 — 과소평가는 글자를 잃지만 과대평가는 안 잃는다", () => {
    expect(resolveBubbleLineHeight({})).toBe(BUBBLE_LINE_HEIGHT_FALLBACK);
    expect(BUBBLE_LINE_HEIGHT_FALLBACK).toBe(
      Math.max(...Object.values(BUBBLE_LINE_HEIGHT_DEFAULTS))
    );
    // 회귀 방지: 예전 commitEditText(1.1)/fitBubbleToText(1.2)는 실제 어떤 조합보다도 작았다.
    for (const value of Object.values(BUBBLE_LINE_HEIGHT_DEFAULTS)) {
      expect(value).toBeGreaterThan(1.1);
    }
  });

  it("글꼴 두께 기본값은 렌더와 같은 bold — 측정만 normal이면 더 좁게 접힌다", () => {
    expect(resolveBubbleFontStyle(undefined)).toBe("bold");
    expect(resolveBubbleFontStyle("italic")).toBe("italic");
    expect(resolveBubbleFontSize(undefined)).toBe(24);
    expect(resolveBubbleFontSize(0)).toBe(24);
    expect(resolveBubbleFontFamily(undefined)).toContain("Pretendard");
  });

  it("자간은 vivid만 0, 나머지 테마는 0.3", () => {
    expect(bubbleLetterSpacing("vivid")).toBe(0);
    expect(bubbleLetterSpacing("classic")).toBe(0.3);
    expect(bubbleLetterSpacing("soft")).toBe(0.3);
    expect(bubbleLetterSpacing(undefined)).toBe(0.3);
  });
});

describe("withBubbleLetterSpacing", () => {
  it("Konva.Text `_getTextWidth`와 같은 (글자수-1)×자간 규약을 쓴다", () => {
    const spaced = withBubbleLetterSpacing(fakeMeasurer(1), 2);
    // "가나다" = 3글자 → 3×20×1 + (3-1)×2 = 64
    expect(spaced.measureWidth("가나다", 20, "sans-serif", "bold")).toBe(64);
    expect(spaced.measureWidth("", 20, "sans-serif", "bold")).toBe(0);
  });

  it("자간이 0/미지정이면 원본 측정기를 그대로 돌려준다(하위호환)", () => {
    const base = fakeMeasurer(1);
    expect(withBubbleLetterSpacing(base, 0)).toBe(base);
    expect(withBubbleLetterSpacing(base, undefined)).toBe(base);
  });
});

describe("fitBubbleBoxHeightToText (높이 자동 확장)", () => {
  // 한글 완성형은 전각(≈1.0em) — 예전 studio-fit의 0.62em 가정이 1.6배 낙관적이었던 지점.
  const fullWidth = fakeMeasurer(1);
  const base = {
    boxWidth: 300,
    fontSize: 24,
    fontFamily: "Pretendard, sans-serif",
    fontStyle: "bold",
    lineHeight: 1.35,
    letterSpacing: 0.3,
  };

  it("돌려준 높이는 자동 축소와 **같은 판정**을 통과한다(두 기능이 서로 모순되지 않는다)", () => {
    for (const text of ["짧음", "가".repeat(103), "한 줄\n두 줄\n세 줄", "대사 ".repeat(40)]) {
      const height = fitBubbleBoxHeightToText({ ...base, text }, fullWidth);
      expect(
        bubbleTextFitsInBox({ ...base, text, boxHeight: height }, base.fontSize, fullWidth)
      ).toBe(true);
    }
  });

  it("103자 한글 대사는 한 줄도 잘리지 않을 만큼 높이를 키운다", () => {
    const text = "가".repeat(103);
    const height = fitBubbleBoxHeightToText({ ...base, text }, fullWidth);
    const { blockHeight, lines } = measureBubbleTextBlock({ ...base, text }, fullWidth);
    expect(lines.length).toBeGreaterThan(8); // 감사 측정: 필요 9줄 / 표시 8줄이었다
    expect(height - bubbleVerticalPadding(24).top - bubbleVerticalPadding(24).bottom)
      .toBeGreaterThanOrEqual(blockHeight);
  });

  it("minHeight를 주면 수동으로 키운 크기를 줄이지 않는다", () => {
    const height = fitBubbleBoxHeightToText({ ...base, text: "짧음", minHeight: 900 }, fullWidth);
    expect(height).toBe(900);
  });

  it("대사가 길수록 단조 증가한다", () => {
    const short = fitBubbleBoxHeightToText({ ...base, text: "가".repeat(10) }, fullWidth);
    const long = fitBubbleBoxHeightToText({ ...base, text: "가".repeat(200) }, fullWidth);
    expect(long).toBeGreaterThan(short);
  });

  it("세로쓰기는 열이 상자 폭 안에 들어올 때까지 높이를 키운다", () => {
    const text = "세로쓰기 대사를 길게 적어 열이 여러 개로 늘어나게 만든다";
    const input = { ...base, boxWidth: 120, text, vertical: true, lineHeight: 1.4 };
    const height = fitBubbleBoxHeightToText(input, fullWidth);
    expect(bubbleTextFitsInBox({ ...input, boxHeight: height }, base.fontSize, fullWidth)).toBe(true);
    // 한 칸 낮추면 더 이상 안 들어간다 — 최소 높이를 찾았다는 뜻.
    expect(bubbleTextFitsInBox({ ...input, boxHeight: height - 1 }, base.fontSize, fullWidth)).toBe(false);
  });
});
