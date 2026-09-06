import { describe, expect, it } from "vitest";

import {
  DERIVED_KO_TO_EN_EXPANSION_PERCENT,
  LOCALIZATION_OVERFLOW_ACTIONS,
  MICROSOFT_PSEUDOLOCALIZATION_EXPANSION_PERCENT,
  MICROSOFT_PSEUDOLOCALIZATION_EXTREMES,
  VENDOR_EXPANSION_RULES,
  W3C_EXPANSION_BY_SOURCE_LENGTH,
  WIDTH_NORMALIZED_GLYPH_RATIO,
  estimateLocalizationExpansion,
  evaluateLocalizationOverflow,
  measureLocalizationEmBudget,
  reflowInheritedLineBreaks,
  summarizeLocalizationOverflow,
  type LocalizationOverflowInput,
} from "./studio-localization-overflow-gate";

import type { BubbleTextMeasurer } from "./studio-bubble-text-fit";

/**
 * 결정적 가짜 측정기 — 실제 폰트 굴곡 대신 **자형 폭 계급**만 흉내낸다.
 * 한글/한자/가나는 전각(1.0em), 라틴은 0.5em, 공백은 0.3em. 이 모듈이 검증해야 하는 성질이
 * "글자 수가 아니라 폭으로 예산을 잡는가"이므로, 폭이 스크립트에 따라 갈리는 것이 핵심이다.
 */
function scriptWidthMeasurer(): BubbleTextMeasurer {
  return {
    measureWidth(text, fontPx) {
      let em = 0;
      for (const ch of text) {
        if (/[぀-ヿ㐀-鿿가-힯]/.test(ch)) em += 1;
        else if (ch === " ") em += 0.3;
        else em += 0.5;
      }
      return em * fontPx;
    },
  };
}

const measurer = scriptWidthMeasurer();

/** 20px/행간 1.25 기준 공통 입력. 패딩은 좌우 12px, 상하 10+13=23px가 된다. */
function baseInput(overrides: Partial<LocalizationOverflowInput>): LocalizationOverflowInput {
  return {
    text: "안녕하세요",
    boxWidth: 160,
    boxHeight: 80,
    fontSize: 20,
    fontFamily: "Pretendard, sans-serif",
    fontStyle: "bold",
    lineHeight: 1.25,
    ...overrides,
  };
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/gu, "");
}

// ── 사다리 4단 ────────────────────────────────────────────────────────────────

describe("evaluateLocalizationOverflow — 사다리", () => {
  it("① 그대로 들어가면 fits 를 돌려주고 아무것도 바꾸지 않는다", () => {
    const input = baseInput({ text: "안녕하세요" }); // 5em=100px ≤ 안쪽폭 136px, 1줄
    const verdict = evaluateLocalizationOverflow(input, measurer);

    expect(verdict.action).toBe("fits");
    expect(verdict.fits).toBe(true);
    expect(verdict.requiresHumanReview).toBe(false);
    expect(verdict.text).toBe(input.text);
    expect(verdict.fontSize).toBe(input.fontSize);
    expect(verdict.boxHeight).toBe(input.boxHeight);
    expect(verdict.lines).toEqual(["안녕하세요"]);
  });

  it("② 원문에서 딸려온 강제 줄바꿈만 풀면 들어가는 경우 rebreak 를 처방한다", () => {
    // 강제 줄바꿈 3줄(75px)은 안 들어가지만, 다시 흘려 2줄(50px)이 되면 들어가는 높이.
    const input = baseInput({ text: "정말\n그럴 리가\n없잖아", boxWidth: 160, boxHeight: 90 });
    const verdict = evaluateLocalizationOverflow(input, measurer);

    expect(verdict.action).toBe("rebreak");
    expect(verdict.fits).toBe(true);
    expect(verdict.fontSize).toBe(20); // 폰트는 건드리지 않는다
    expect(verdict.boxHeight).toBe(90); // 상자도 건드리지 않는다
    expect(verdict.text).toBe("정말 그럴 리가 없잖아");
    expect(verdict.lines).toEqual(["정말 그럴 리가", "없잖아"]);
    // 글자는 하나도 잃지 않는다.
    expect(withoutWhitespace(verdict.text)).toBe(withoutWhitespace(input.text));

    const rungs = verdict.ladder.map((rung) => `${rung.action}:${rung.resolved}`);
    expect(rungs).toEqual(["fits:false", "rebreak:true"]);
  });

  it("③ 다시 끊을 여지가 없으면 폰트를 줄여 shrink 를 처방한다", () => {
    // 강제 줄바꿈 없음 → rebreak 불가. 20px에서는 2줄이 필요한데 1줄만 들어가는 높이.
    const input = baseInput({ text: "정말 그럴 리가 없잖아 진짜로", boxWidth: 240, boxHeight: 70 });
    const verdict = evaluateLocalizationOverflow(input, measurer);

    expect(verdict.action).toBe("shrink");
    expect(verdict.fits).toBe(true);
    expect(verdict.fontSize).toBeLessThan(20);
    expect(verdict.fontSize).toBeGreaterThanOrEqual(16); // 기본 하한 = 저자 크기의 0.8배
    expect(verdict.text).toBe(input.text); // 문자열은 그대로
    expect(verdict.boxHeight).toBe(70); // 상자도 그대로

    const rebreak = verdict.ladder.find((rung) => rung.action === "rebreak");
    expect(rebreak?.applicable).toBe(false);
    expect(rebreak?.reason).toContain("강제 줄바꿈이 없어");
  });

  it("④ 어떤 자동 수선으로도 안 되면 human 으로 올리고, 절대 잘라내라고 하지 않는다", () => {
    const input = baseInput({
      text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이 벌어진 거야",
      boxWidth: 160,
      boxHeight: 70,
    });
    const verdict = evaluateLocalizationOverflow(input, measurer);

    expect(verdict.action).toBe("human");
    expect(verdict.requiresHumanReview).toBe(true);
    expect(verdict.fits).toBe(false);
    // 사람에게 넘기더라도 문자열은 온전하다 — 자동 절단이 없다는 증거.
    expect(verdict.text).toBe(input.text);
    expect(verdict.notes.join(" ")).toContain("자르지 말 것");

    const shrink = verdict.ladder.find((rung) => rung.action === "shrink");
    expect(shrink).toMatchObject({ applicable: true, resolved: false });
    const enlarge = verdict.ladder.find((rung) => rung.action === "enlarge");
    expect(enlarge).toMatchObject({ applicable: false, resolved: false });
    expect(enlarge?.reason).toContain("maxBoxHeight");
    // 확대 단은 못 썼어도 "얼마나 필요한지"는 사람에게 알려 준다.
    expect(enlarge?.boxHeight).toBeGreaterThan(input.boxHeight);
  });

  it("④' 확대 여유를 주면 사람에게 올리는 대신 말풍선을 키운다", () => {
    const input = baseInput({
      text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이 벌어진 거야",
      boxWidth: 160,
      boxHeight: 70,
    });
    const verdict = evaluateLocalizationOverflow(input, measurer, { maxBoxHeight: 2000 });

    expect(verdict.action).toBe("enlarge");
    expect(verdict.fits).toBe(true);
    expect(verdict.fontSize).toBe(20); // 저자 크기를 지킨다
    expect(verdict.boxHeight).toBeGreaterThan(70);
    expect(verdict.text).toBe(input.text);
  });

  it("확대 여유가 필요한 높이보다 작으면 확대 단이 실패하고 사람에게 간다", () => {
    const input = baseInput({
      text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이 벌어진 거야",
      boxWidth: 160,
      boxHeight: 70,
    });
    const verdict = evaluateLocalizationOverflow(input, measurer, { maxBoxHeight: 75 });

    expect(verdict.action).toBe("human");
    const enlarge = verdict.ladder.find((rung) => rung.action === "enlarge");
    expect(enlarge).toMatchObject({ applicable: true, resolved: false });
    expect(enlarge?.reason).toContain("허용 여유 75px");
  });

  it("축소 하한 비율은 정책으로 조절된다 — 완화하면 같은 입력이 shrink 로 해결된다", () => {
    const input = baseInput({
      text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이 벌어진 거야",
      boxWidth: 160,
      boxHeight: 70,
    });
    expect(evaluateLocalizationOverflow(input, measurer).action).toBe("human");
    const relaxed = evaluateLocalizationOverflow(input, measurer, { minFontScale: 0.4 });
    expect(relaxed.action).toBe("shrink");
    expect(relaxed.fontSize).toBeGreaterThanOrEqual(10);
    expect(relaxed.fontSize).toBeLessThan(20);
  });

  it("allowReflow:false 면 다시 끊기 단을 건너뛰고 축소로 내려간다", () => {
    const input = baseInput({ text: "정말\n그럴 리가\n없잖아", boxWidth: 160, boxHeight: 90 });
    const verdict = evaluateLocalizationOverflow(input, measurer, { allowReflow: false });

    expect(verdict.action).not.toBe("rebreak");
    const rebreak = verdict.ladder.find((rung) => rung.action === "rebreak");
    expect(rebreak).toMatchObject({ applicable: false, resolved: false });
    expect(rebreak?.reason).toContain("정책이");
  });
});

// ── 잘라내기 금지 불변식 ──────────────────────────────────────────────────────

describe("잘라내기 금지 불변식", () => {
  const fixtures: readonly LocalizationOverflowInput[] = [
    baseInput({ text: "안녕하세요" }),
    baseInput({ text: "정말\n그럴 리가\n없잖아", boxHeight: 90 }),
    baseInput({ text: "정말 그럴 리가 없잖아 진짜로", boxWidth: 240, boxHeight: 70 }),
    baseInput({ text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이", boxHeight: 60 }),
    baseInput({ text: "", boxHeight: 60 }),
    baseInput({ text: "ThisIsOneVeryLongUnbreakableRomanizedSfxWordThatCannotWrap", boxWidth: 90, boxHeight: 50 }),
  ];

  it("어떤 입력에서도 권고는 공개된 5가지뿐이고 잘라내기는 없다", () => {
    expect([...LOCALIZATION_OVERFLOW_ACTIONS]).toEqual(["fits", "rebreak", "shrink", "enlarge", "human"]);
    for (const input of fixtures) {
      const verdict = evaluateLocalizationOverflow(input, measurer);
      expect(LOCALIZATION_OVERFLOW_ACTIONS).toContain(verdict.action);
    }
  });

  it("어떤 권고도 공백 아닌 글자를 하나도 버리지 않는다", () => {
    for (const input of fixtures) {
      for (const policy of [{}, { maxBoxHeight: 2000 }, { minFontScale: 0.4 }]) {
        const verdict = evaluateLocalizationOverflow(input, measurer, policy);
        expect(withoutWhitespace(verdict.text)).toBe(withoutWhitespace(input.text));
      }
    }
  });

  it("해결하지 못한 판정은 반드시 사람에게 올라간다(조용한 통과가 없다)", () => {
    for (const input of fixtures) {
      const verdict = evaluateLocalizationOverflow(input, measurer);
      expect(verdict.fits || verdict.requiresHumanReview).toBe(true);
      expect(verdict.requiresHumanReview).toBe(verdict.action === "human");
    }
  });

  it("입력 객체를 변형하지 않는다", () => {
    const input = baseInput({ text: "정말\n그럴 리가\n없잖아", boxHeight: 90 });
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    evaluateLocalizationOverflow(input, measurer, { maxBoxHeight: 500 });
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

// ── em 예산 ───────────────────────────────────────────────────────────────────

describe("measureLocalizationEmBudget — 글자 수가 아니라 em 폭으로 센다", () => {
  const common = {
    boxWidth: 160,
    boxHeight: 80,
    fontSize: 20,
    fontFamily: "Pretendard, sans-serif",
    fontStyle: "bold",
    lineHeight: 1.25,
  };

  it("같은 글자 수라도 전각/라틴이면 수요가 다르다", () => {
    const hangul = measureLocalizationEmBudget({ ...common, text: "안녕하세요" }, measurer);
    const latin = measureLocalizationEmBudget({ ...common, text: "hello" }, measurer);

    expect(hangul.emDemand).toBeCloseTo(5, 6);
    expect(latin.emDemand).toBeCloseTo(2.5, 6);
    expect(hangul.emDemand).toBeCloseTo(latin.emDemand * 2, 6);
  });

  it("용량은 안쪽 폭(em) × 행간으로 잡은 줄 슬롯 수다", () => {
    const budget = measureLocalizationEmBudget({ ...common, text: "안녕하세요" }, measurer);
    expect(budget.emPerLine).toBeCloseTo((160 - 24) / 20, 6); // 좌우 패딩 12px씩
    expect(budget.lineSlots).toBeCloseTo((80 - 23) / (20 * 1.25), 6); // 상하 패딩 10+13
    expect(budget.emCapacity).toBeCloseTo(budget.emPerLine * budget.lineSlots, 6);
    expect(budget.fillRatio).toBeCloseTo(budget.emDemand / budget.emCapacity, 6);
  });

  it("강제 줄바꿈 수가 최소 줄 수로 잡힌다", () => {
    const budget = measureLocalizationEmBudget({ ...common, text: "가\n나\n다" }, measurer);
    expect(budget.minimumLines).toBe(3);
  });

  it("세로쓰기에서는 폭/높이 역할이 뒤바뀐다", () => {
    const horizontal = measureLocalizationEmBudget({ ...common, text: "안녕하세요" }, measurer);
    const vertical = measureLocalizationEmBudget({ ...common, text: "안녕하세요", vertical: true }, measurer);
    expect(vertical.emPerLine).toBeCloseTo((80 - 23) / 20, 6);
    expect(vertical.lineSlots).toBeCloseTo((160 - 24) / (20 * 1.25), 6);
    expect(vertical.emPerLine).not.toBeCloseTo(horizontal.emPerLine, 6);
  });
});

// ── 확장률 자료 ───────────────────────────────────────────────────────────────

describe("확장률 자료의 정직성", () => {
  it("W3C 길이별 표를 인쇄된 그대로 담는다", () => {
    expect(
      W3C_EXPANSION_BY_SOURCE_LENGTH.map((row) => [row.maxSourceChars, row.minPercent, row.maxPercent])
    ).toEqual([
      [10, 200, 300],
      [20, 180, 200],
      [30, 160, 180],
      [50, 140, 160],
      [70, 151, 170],
      [Number.POSITIVE_INFINITY, 130, 130],
    ]);
  });

  it("51–70자 행은 단조성이 깨져 오타로 표시되지만 값을 고쳐 담지는 않는다", () => {
    const flagged = W3C_EXPANSION_BY_SOURCE_LENGTH.filter((row) => row.suspectedSourceTypo === true);
    expect(flagged).toHaveLength(1);
    const row = flagged[0]!;
    expect(row.maxSourceChars).toBe(70);
    expect([row.minPercent, row.maxPercent]).toEqual([151, 170]); // 인쇄값 그대로
    expect(row.monotoneAlternative).toEqual({ minPercent: 131, maxPercent: 140 }); // 대안은 병기만
    // 실제로 단조성이 깨져 있다는 사실 자체를 고정한다(위 행 140–160보다 크다).
    const previous = W3C_EXPANSION_BY_SOURCE_LENGTH[3]!;
    expect(row.minPercent).toBeGreaterThan(previous.minPercent);
  });

  it("폭 정규화 비율은 한/중 글자를 영어 2글자 폭으로 본 눈금 그대로다", () => {
    expect(WIDTH_NORMALIZED_GLYPH_RATIO).toEqual({ ko: 0.8, zh: 1.2, pt: 2.6, fr: 2.6, de: 2.8, it: 3.0 });
  });

  it("벤더 경험칙과 pseudolocalization 참고값을 인쇄된 그대로 고정한다", () => {
    expect(VENDOR_EXPANSION_RULES.map((rule) => [rule.from, rule.to, rule.minPercent, rule.maxPercent])).toEqual([
      ["en", "de", 120, 135], // EN→DE +20~35%
      ["en", "ko", 85, 90], //   EN→KO −10~15%
      ["en", "ja", 50, 90], //   EN→JA −10~50%
    ]);
    expect(MICROSOFT_PSEUDOLOCALIZATION_EXPANSION_PERCENT).toBe(140); // +40%
    expect(MICROSOFT_PSEUDOLOCALIZATION_EXTREMES).toEqual({ minPercent: 200, maxPercent: 400 });
  });

  it("EN→유럽어는 길이별 표(published)로 추정한다", () => {
    const short = estimateLocalizationExpansion({ sourceText: "OK", sourceLocale: "en", targetLocale: "de" });
    expect(short.provenance).toBe("published");
    expect(short.band).toEqual({ minPercent: 200, maxPercent: 300 });
    expect(short.suspectedSourceTypo).toBe(false);

    const sixty = estimateLocalizationExpansion({
      sourceText: "x".repeat(60),
      sourceLocale: "en-US",
      targetLocale: "de-DE",
    });
    expect(sixty.band).toEqual({ minPercent: 151, maxPercent: 170 });
    expect(sixty.suspectedSourceTypo).toBe(true);
    expect(sixty.monotoneAlternative).toEqual({ minPercent: 131, maxPercent: 140 });
  });

  it("KO→EN 은 파생값으로만 제공되고 그 사실이 표시된다", () => {
    const estimate = estimateLocalizationExpansion({
      sourceText: "안녕하세요",
      sourceLocale: "ko-KR",
      targetLocale: "en",
    });
    expect(estimate.provenance).toBe("derived");
    expect(estimate.band).toEqual({
      minPercent: DERIVED_KO_TO_EN_EXPANSION_PERCENT,
      maxPercent: DERIVED_KO_TO_EN_EXPANSION_PERCENT,
    });
    expect(estimate.basis).toContain("파생값");
  });

  it("JA→EN 은 공개 표가 없어 숫자를 만들지 않는다", () => {
    const estimate = estimateLocalizationExpansion({
      sourceText: "こんにちは",
      sourceLocale: "ja",
      targetLocale: "en",
    });
    expect(estimate.provenance).toBe("unpublished");
    expect(estimate.band).toBeNull();
    expect(estimate.basis).toContain("미공개");
  });

  it("경험칙이 있는 쌍은 경험칙을, 없는 쌍은 미공개를 돌려준다", () => {
    expect(estimateLocalizationExpansion({ sourceText: "hi", sourceLocale: "en", targetLocale: "ko" }).band).toEqual({
      minPercent: 85,
      maxPercent: 90,
    });
    expect(
      estimateLocalizationExpansion({ sourceText: "bonjour", sourceLocale: "fr", targetLocale: "ja" }).provenance
    ).toBe("unpublished");
    // 번역 메모리의 센티널 로케일("source")을 그대로 넘기면 어떤 표에도 걸리지 않는다.
    expect(
      estimateLocalizationExpansion({ sourceText: "hi", sourceLocale: "source", targetLocale: "en" }).provenance
    ).toBe("unpublished");
  });

  it("판정 결과에 미공개/파생 여부와 실측 확장률이 함께 실린다", () => {
    const verdict = evaluateLocalizationOverflow(
      baseInput({ text: "안녕하세요", sourceText: "안녕", sourceLocale: "ko", targetLocale: "en" }),
      measurer
    );
    expect(verdict.expansion.provenance).toBe("derived");
    expect(verdict.observedExpansionPercent).toBeCloseTo(250, 6); // 2em → 5em
    expect(verdict.beyondPredictedBand).toBe(true); // 파생 추정 125%를 크게 넘는다
    expect(verdict.notes.join(" ")).toContain("파생값");
  });

  it("원문이 없으면 실측 확장률은 null 이다", () => {
    const verdict = evaluateLocalizationOverflow(baseInput({ text: "안녕하세요" }), measurer);
    expect(verdict.observedExpansionPercent).toBeNull();
    expect(verdict.beyondPredictedBand).toBe(false);
  });
});

// ── 다시 흘리기 규칙 ──────────────────────────────────────────────────────────

describe("reflowInheritedLineBreaks", () => {
  it("한국어는 줄바꿈 자리에 공백을 되살린다(어절 경계였으므로)", () => {
    expect(reflowInheritedLineBreaks("정말\n그럴 리가\n없잖아")).toBe("정말 그럴 리가 없잖아");
  });

  it("표의문자·가나 경계에는 공백을 넣지 않는다", () => {
    expect(reflowInheritedLineBreaks("こんに\nちは")).toBe("こんにちは");
    expect(reflowInheritedLineBreaks("今日\n晴れ")).toBe("今日晴れ");
  });

  it("빈 줄과 양끝 공백을 정리하되 글자는 버리지 않는다", () => {
    const input = "  첫줄  \n\n둘째줄 ";
    const out = reflowInheritedLineBreaks(input);
    expect(out).toBe("첫줄 둘째줄");
    expect(withoutWhitespace(out)).toBe(withoutWhitespace(input));
  });

  it("줄바꿈이 없으면 그대로 돌려준다", () => {
    expect(reflowInheritedLineBreaks("변화 없음")).toBe("변화 없음");
  });
});

// ── 조판 품질 부가 정보 ───────────────────────────────────────────────────────

describe("조판 품질 부가 정보", () => {
  it("행두 금칙 위반을 세어 알려 준다(맞춤 판정과는 별개)", () => {
    // 안쪽 폭 100px = 전각 5자. 6번째 글자인 말줄임표가 다음 줄 첫머리로 밀린다.
    const verdict = evaluateLocalizationOverflow(
      baseInput({ text: "가나다라마…", boxWidth: 124, boxHeight: 120 }),
      measurer
    );
    expect(verdict.action).toBe("fits");
    expect(verdict.lines).toEqual(["가나다라마", "…"]);
    expect(verdict.kinsokuViolations).toBe(1);
  });

  it("랙 균형 대안은 줄 수를 바꾸지 않는다(맞춤 판정을 흔들지 않는다)", () => {
    const verdict = evaluateLocalizationOverflow(
      baseInput({ text: "정말 그럴 리가 없잖아 진짜로", boxWidth: 240, boxHeight: 200 }),
      measurer
    );
    expect(verdict.balancedLines).not.toBeNull();
    expect(verdict.balancedLines).toHaveLength(verdict.lines.length);
  });

  it("세로쓰기에서는 랙 균형 대안을 내지 않는다", () => {
    const verdict = evaluateLocalizationOverflow(
      baseInput({ text: "안녕", boxWidth: 200, boxHeight: 300, vertical: true }),
      measurer
    );
    expect(verdict.action).toBe("fits");
    expect(verdict.balancedLines).toBeNull();
    expect(verdict.kinsokuViolations).toBe(0);
  });
});

// ── 집계 ──────────────────────────────────────────────────────────────────────

describe("summarizeLocalizationOverflow", () => {
  it("권고를 세고 가장 심각한 것을 고른다", () => {
    const verdicts = [
      evaluateLocalizationOverflow(baseInput({ text: "안녕하세요" }), measurer),
      evaluateLocalizationOverflow(baseInput({ text: "정말\n그럴 리가\n없잖아", boxHeight: 90 }), measurer),
      evaluateLocalizationOverflow(
        baseInput({ text: "정말 그럴 리가 없잖아 진짜로 믿을 수가 없어 도대체 무슨 일이", boxHeight: 60 }),
        measurer
      ),
    ];
    const summary = summarizeLocalizationOverflow(verdicts);

    expect(summary.total).toBe(3);
    expect(summary.counts.fits).toBe(1);
    expect(summary.counts.rebreak).toBe(1);
    expect(summary.counts.human).toBe(1);
    expect(summary.worstAction).toBe("human");
    expect(summary.humanReviewCount).toBe(1);
  });

  it("빈 입력은 fits 로 집계된다", () => {
    expect(summarizeLocalizationOverflow([])).toEqual({
      total: 0,
      counts: { fits: 0, rebreak: 0, shrink: 0, enlarge: 0, human: 0 },
      worstAction: "fits",
      humanReviewCount: 0,
    });
  });
});
