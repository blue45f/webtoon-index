import { describe, expect, it } from "vitest";

import {
  runStudioLocalizationQa,
  studioLocalizationQaCueIndex,
  studioLocalizationQaGroups,
} from "./studio-localization-qa";

import type { BubbleTextMeasurer } from "./studio-bubble-text-fit";
import type { DialoguePageLike } from "./studio-dialogue-batch";

/**
 * 결정적 측정기 — 글자 하나를 fontPx*0.6 폭으로 센다. 실제 캔버스와 값은 다르지만 이 테스트가
 * 검증하는 것은 조립(세 엔진이 같은 큐 위에서 합쳐지는가)이지 폭 자체가 아니다.
 */
const measurer: BubbleTextMeasurer = {
  measureWidth: (text, fontPx) => text.length * fontPx * 0.6,
};

function page(
  id: string,
  elements: readonly Record<string, unknown>[],
): DialoguePageLike {
  return { id, elements: elements as never };
}

function bubble(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    type: "bubble",
    text: "HELLO THERE.",
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    fontSize: 24,
    ...over,
  };
}

describe("runStudioLocalizationQa — 조립", () => {
  it("모든 대사 큐를 세고, 한 점수만 낸다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble(), bubble({ id: "b2", text: "FINE." })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.basis).toBe("studio-localization-qa");
    expect(report.checkedCueCount).toBe(2);
    expect(report.overflowCheckedCount).toBe(2);
    expect(report.cues.map((cue) => cue.id)).toEqual(["b1", "b2"]);
    expect(report.score.denominator.unit).toBe("characters");
    // 문자 분모는 ISO 가 허용하지만 임계값 99 는 단어 분모로만 교정돼 있다 — 결과가 그 사실을
    // 스스로 들고 다녀야 호출부가 "통과"를 과신하지 않는다.
    expect(report.score.denominator.thresholdCalibrated).toBe(false);
  });

  it("숨김·잠금 큐는 기본적으로 건너뛰고 그 수를 보고한다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble(), bubble({ id: "b2", text: "SHOUTING AT YOU.", hidden: true })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.checkedCueCount).toBe(1);
    expect(report.skippedCueCount).toBe(1);
    expect(report.cues.map((cue) => cue.id)).toEqual(["b1"]);
  });

  it("초안이 있으면 문서가 아니라 초안을 검사한다 — 적용 전에 막는 것이 요점이다", () => {
    const pages = [page("p1", [bubble({ text: "안녕하세요." })])];
    const draft = new Map([["b1", "hello there!!!!"]]);

    const applied = runStudioLocalizationQa(pages, measurer, { targetLocale: "en" });
    const preApply = runStudioLocalizationQa(pages, measurer, {
      targetLocale: "en",
      translations: draft,
    });

    expect(applied.cues[0]?.text).toBe("안녕하세요.");
    expect(preApply.cues[0]?.text).toBe("hello there!!!!");
    // 소문자 + 문장부호 연속이 초안에서만 잡힌다.
    expect(preApply.score.errors.length).toBeGreaterThan(applied.score.errors.length);
  });
});

describe("runStudioLocalizationQa — 넘침이 조판 줄을 문체 린터에 넘긴다", () => {
  it("레이아웃 규칙(관사 뒤 줄바꿈)이 실제로 실행된다", () => {
    // 폭이 좁아 "a" 뒤에서 끊기게 만든다.
    const report = runStudioLocalizationQa(
      [
        page("p1", [
          bubble({
            text: "I GAVE HER A WONDERFUL PRESENT",
            width: 150,
            height: 200,
            fontSize: 12,
          }),
        ]),
      ],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.cues[0]?.overflow).not.toBeNull();
    expect((report.cues[0]?.overflow?.lines.length ?? 0)).toBeGreaterThan(1);
    // 줄이 주어졌으므로 레이아웃 규칙이 "미실행"이 아니라 실행된 규칙 집합에 든다.
    expect(report.style.checkedRuleCount).toBeGreaterThan(0);
  });

  it("상자 치수가 없으면 넘침을 판정하지 않는다 — 상자를 가정하고 넘쳤다고 말하지 않는다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ width: 0, height: 0 })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.overflowCheckedCount).toBe(0);
    expect(report.cues[0]?.overflow).toBeNull();
    expect(report.overflow.total).toBe(0);
  });
});

describe("runStudioLocalizationQa — 넘침이 MQM 오류가 된다", () => {
  it("넘치는 대사는 truncation 서브타입 오류로 점수에 합류한다", () => {
    const report = runStudioLocalizationQa(
      [
        page("p1", [
          bubble({
            // 상자에 비해 압도적으로 긴 문장 — 축소·재조판으로도 해결되지 않는다.
            text: "THIS SENTENCE IS FAR TOO LONG FOR THE TINY BALLOON IT WAS PLACED INTO.",
            width: 60,
            height: 30,
            fontSize: 24,
          }),
        ]),
      ],
      measurer,
      { targetLocale: "en" },
    );

    const truncation = report.score.errors.filter(
      (error) => error.subtype === "truncation-text-expansion",
    );
    expect(truncation).toHaveLength(1);
    expect(truncation[0]?.dimension).toBe("design-and-markup");
    expect(truncation[0]?.severity).toBe("major");
    expect(report.overflow.worstAction).toBe("human");
    expect(report.overflow.humanReviewCount).toBe(1);
  });

  it("예측 게이트는 Critical 을 올리지 않는다 — 글자 손실은 렌더가 끝나야 확인된다", () => {
    const report = runStudioLocalizationQa(
      [
        page("p1", [
          bubble({ text: "WAY TOO MUCH TEXT TO EVER FIT HERE AT ALL.", width: 40, height: 20 }),
        ]),
      ],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.score.counts.critical).toBe(0);
    expect(report.score.errors.every((error) => error.evidence?.textLost === undefined)).toBe(true);
  });

  it("깨끗한 회차는 오류 0 · 통과", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "ALL GOOD.", width: 400, height: 200, fontSize: 14 })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.score.errors).toEqual([]);
    expect(report.score.verdict).toBe("pass");
    expect(report.score.qualityScore).toBe(100);
  });

  it("대사가 하나도 없으면 100점 통과가 아니라 unscorable 이다", () => {
    const report = runStudioLocalizationQa([page("p1", [])], measurer, { targetLocale: "en" });

    expect(report.checkedCueCount).toBe(0);
    expect(report.score.verdict).toBe("unscorable");
    expect(report.score.qualityScore).toBeNull();
  });
});

describe("runStudioLocalizationQa — 로케일", () => {
  it("영문이 아닌 대상 로케일은 문체 규칙을 통째로 건너뛴다(넘침은 계속 본다)", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "ALLES GROSS!!" })])],
      measurer,
      { targetLocale: "de" },
    );

    expect(report.style.skippedUnitCount).toBe(1);
    expect(report.style.findings).toEqual([]);
    // 넘침 판정은 언어와 무관하게 계속 돈다.
    expect(report.overflowCheckedCount).toBe(1);
  });
});

describe("studioLocalizationQaGroups", () => {
  it("MQM 카탈로그 순서로 묶고, 묶음의 오류 합이 전체와 같다", () => {
    const report = runStudioLocalizationQa(
      [
        page("p1", [
          bubble({ text: "WHY ARE YOU SHOUTING?!?!" }),
          bubble({
            id: "b2",
            text: "THIS SENTENCE IS FAR TOO LONG FOR THE TINY BALLOON IT WAS PLACED INTO.",
            width: 60,
            height: 30,
          }),
        ]),
      ],
      measurer,
      { targetLocale: "en" },
    );

    const groups = studioLocalizationQaGroups(report);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap((group) => group.errors)).toHaveLength(report.score.errors.length);
    // 묶음 penalty 합 = APT.
    const summed = groups.reduce((total, group) => total + group.rollup.penalty, 0);
    expect(summed).toBeCloseTo(report.score.apt, 6);
  });

  it("큐 색인이 모든 발견의 cueId 를 되짚을 수 있다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "WHAT?!?!" })])],
      measurer,
      { targetLocale: "en" },
    );

    const index = studioLocalizationQaCueIndex(report);
    for (const error of report.score.errors) {
      expect(error.cueId).not.toBeNull();
      expect(index.get(error.cueId as string)?.pageIndex).toBe(0);
    }
  });
});

describe("runStudioLocalizationQa — 입력 불변", () => {
  it("페이지·요소를 변형하지 않는다", () => {
    const pages = [page("p1", [bubble()])];
    const before = JSON.stringify(pages);

    runStudioLocalizationQa(pages, measurer, {
      targetLocale: "en",
      translations: new Map([["b1", "Changed."]]),
    });

    expect(JSON.stringify(pages)).toBe(before);
  });
});

describe("runStudioLocalizationQa — §2.5 용어집 충돌", () => {
  const rules = [{ sourceTerm: "마왕", targetTerm: "Demon Lord" }];

  it("원문을 모르면 한 큐도 대 보지 않는다 — 0 건을 '통과'로 읽으면 안 된다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "The dark one rises." })])],
      measurer,
      { targetLocale: "en", sourceLocale: "ko", glossaryRules: rules },
    );

    expect(report.glossaryCheckedCueCount).toBe(0);
    expect(report.score.errors.filter((e) => e.dimension === "terminology")).toHaveLength(0);
  });

  it("규칙이 지정한 대역어가 번역문에 없으면 Terminology 오류를 싣는다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "The dark one rises." })])],
      measurer,
      {
        targetLocale: "en",
        sourceLocale: "ko",
        glossaryRules: rules,
        sourceTextFor: (id) => (id === "b1" ? "마왕이 깨어난다." : undefined),
      },
    );

    expect(report.glossaryCheckedCueCount).toBe(1);
    const terminology = report.score.errors.filter((e) => e.dimension === "terminology");
    expect(terminology).toHaveLength(1);
    // 서브타입 카탈로그가 미완이라 이름을 지어내지 않는다 — 차원만 싣는다.
    expect(terminology[0].subtype).toBeNull();
    expect(terminology[0].severity).toBe("major");
    expect(terminology[0].cueId).toBe("b1");
    expect(terminology[0].page).toBe(1);
  });

  it("대역어가 번역문에 있으면 오류가 없다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "The Demon Lord rises." })])],
      measurer,
      {
        targetLocale: "en",
        sourceLocale: "ko",
        glossaryRules: rules,
        sourceTextFor: () => "마왕이 깨어난다.",
      },
    );

    expect(report.glossaryCheckedCueCount).toBe(1);
    expect(report.score.errors.filter((e) => e.dimension === "terminology")).toHaveLength(0);
  });

  it("심각도는 정책값이라 호출부가 갈아 끼울 수 있다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ text: "The dark one rises." })])],
      measurer,
      {
        targetLocale: "en",
        sourceLocale: "ko",
        glossaryRules: rules,
        sourceTextFor: () => "마왕이 깨어난다.",
        glossarySeverity: { missingTarget: "critical" },
      },
    );

    expect(report.score.errors.find((e) => e.dimension === "terminology")?.severity).toBe(
      "critical",
    );
  });
});

describe("runStudioLocalizationQa — 말풍선 명도 대비", () => {
  it("흰 바탕에 연회색 대사를 실패로 짚는다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ fill: "#ffffff", textFill: "#cccccc" })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.cues[0].legibility?.verdict).toBe("fail");
    expect(report.legibilityCheckedCueCount).toBe(1);
    expect(report.legibilityFailCueCount).toBe(1);
    // 대비는 번역 품질이 아니다 — MQM 점수에는 들어가지 않는다.
    expect(report.score.errors).toHaveLength(0);
  });

  it("검은 대사와 흰 말풍선은 통과한다", () => {
    const report = runStudioLocalizationQa(
      [page("p1", [bubble({ fill: "#ffffff", textFill: "#000000" })])],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.cues[0].legibility?.verdict).toBe("pass");
    expect(report.legibilityFailCueCount).toBe(0);
  });

  it("그라데이션 말풍선은 판정하지 않는다 — fill 은 화면에 없는 색이다", () => {
    const report = runStudioLocalizationQa(
      [
        page("p1", [
          bubble({ fill: "#ffffff", textFill: "#cccccc", gradient: { stops: [] } }),
        ]),
      ],
      measurer,
      { targetLocale: "en" },
    );

    expect(report.cues[0].legibility?.verdict).toBe("indeterminate");
    // "안 쟀다"가 아니라 "재려 했지만 판정 불가" — 검사한 큐 수에 들어가지 않는다.
    expect(report.legibilityCheckedCueCount).toBe(0);
    expect(report.legibilityFailCueCount).toBe(0);
  });

  it("AAA 를 요구하면 AA 만 넘긴 조합이 실패가 된다", () => {
    // 말풍선 기본 글자 크기는 24px = WCAG 큰 글자이므로 임계값은 AA 3.0 / AAA 4.5 다.
    // #898989 대 흰색은 3.5:1 — 그 사이에 정확히 놓인다.
    const pages = [page("p1", [bubble({ fill: "#ffffff", textFill: "#898989" })])];

    const aa = runStudioLocalizationQa(pages, measurer, { targetLocale: "en" });
    expect(aa.cues[0].legibility?.ratio).toBe(3.5);
    expect(aa.cues[0].legibility?.threshold).toBe(3);
    expect(aa.cues[0].legibility?.verdict).toBe("pass");
    expect(
      runStudioLocalizationQa(pages, measurer, {
        targetLocale: "en",
        legibilityLevel: "AAA",
      }).cues[0].legibility?.verdict,
    ).toBe("fail");
  });
});
