import { describe, expect, it } from "vitest";

import {
  STUDIO_LOCALIZATION_MQM_RULESET_VERSION,
  STUDIO_MQM_CRITICAL_AUTO_FAIL,
  STUDIO_MQM_DECLARED_SUBTYPE_TOTAL,
  STUDIO_MQM_DIMENSION_IDS,
  STUDIO_MQM_DIMENSIONS,
  STUDIO_MQM_LEGIBLE_SHRINK_RATIO,
  STUDIO_MQM_PASS_THRESHOLD,
  STUDIO_MQM_SAMPLE_MAX_WORDS,
  STUDIO_MQM_SAMPLE_MIN_WORDS,
  STUDIO_MQM_SEVERITY_WEIGHTS,
  STUDIO_MQM_SUBTYPES,
  STUDIO_MQM_WMT_2021,
  capStudioMqmErrorsPerSegment,
  countStudioMqmScoringUnits,
  detectStudioMqmTruncationErrors,
  normalizeStudioMqmError,
  scoreStudioMqmErrors,
  studioMqmDenominator,
  studioMqmDimension,
  studioMqmSubtype,
  studioMqmSubtypesOf,
  type StudioMqmErrorInput,
  type StudioMqmTruncationObservation,
} from "./studio-localization-mqm";

/** 단어 분모를 직접 만든다 — 텍스트를 세는 경로와 채점 경로를 분리해 테스트하기 위해. */
function words(count: number) {
  return studioMqmDenominator([Array.from({ length: count }, () => "w").join(" ")], "words");
}

function minor(n: number): StudioMqmErrorInput[] {
  return Array.from({ length: n }, (_, index) => ({
    dimension: "style" as const,
    severity: "minor" as const,
    cueId: `cue-${index}`,
  }));
}

describe("MQM-Core 유형론 (§1–§2)", () => {
  it("차원은 7개이고 서브타입 선언 개수의 합은 38이다", () => {
    expect(STUDIO_MQM_DIMENSIONS).toHaveLength(7);
    expect(STUDIO_MQM_DIMENSION_IDS).toHaveLength(7);
    const total = STUDIO_MQM_DIMENSIONS.reduce(
      (sum, dimension) => sum + dimension.declaredSubtypeCount,
      0,
    );
    expect(total).toBe(STUDIO_MQM_DECLARED_SUBTYPE_TOTAL);
    expect(total).toBe(38);
  });

  it("차원별 선언 개수가 출처와 일치한다", () => {
    const declared = Object.fromEntries(
      STUDIO_MQM_DIMENSIONS.map((dimension) => [dimension.id, dimension.declaredSubtypeCount]),
    );
    expect(declared).toEqual({
      terminology: 3,
      accuracy: 7,
      "linguistic-conventions": 6,
      style: 7,
      "locale-conventions": 8,
      "audience-appropriateness": 2,
      "design-and-markup": 5,
    });
  });

  it("Design and markup 만 완전 카탈로그이고 5개 서브타입을 모두 담는다", () => {
    const complete = STUDIO_MQM_DIMENSIONS.filter((d) => d.subtypeCatalogComplete);
    expect(complete.map((d) => d.id)).toEqual(["design-and-markup"]);

    const markup = studioMqmSubtypesOf("design-and-markup");
    expect(markup).toHaveLength(5);
    expect(markup.map((subtype) => subtype.mqmName)).toEqual([
      "Layout",
      "Markup tag",
      "Truncation/text expansion",
      "Missing text",
      "Link",
    ]);
    // 완전 카탈로그는 선언 개수와 실제 개수가 같아야 한다.
    expect(markup).toHaveLength(studioMqmDimension("design-and-markup").declaredSubtypeCount);
  });

  it("부분 카탈로그 차원은 실린 개수가 선언 개수를 넘지 않는다 (없는 이름을 지어내지 않았다)", () => {
    for (const dimension of STUDIO_MQM_DIMENSIONS) {
      if (dimension.subtypeCatalogComplete) continue;
      expect(studioMqmSubtypesOf(dimension.id).length).toBeLessThanOrEqual(
        dimension.declaredSubtypeCount,
      );
    }
    // 이름이 확인되지 않은 다섯 차원은 비어 있다.
    expect(studioMqmSubtypesOf("terminology")).toHaveLength(0);
    expect(studioMqmSubtypesOf("linguistic-conventions")).toHaveLength(0);
    expect(studioMqmSubtypesOf("style")).toHaveLength(0);
    expect(studioMqmSubtypesOf("locale-conventions")).toHaveLength(0);
    expect(studioMqmSubtypesOf("audience-appropriateness")).toHaveLength(0);
  });

  it("Accuracy 는 Addition/Mistranslation/Omission 과 Mistranslation 의 자식 3개를 담는다", () => {
    const accuracy = studioMqmSubtypesOf("accuracy");
    expect(accuracy.map((subtype) => subtype.id)).toEqual([
      "addition",
      "mistranslation",
      "omission",
      "false-friend",
      "technical-relationship-misrepresentation",
      "mt-hallucination",
    ]);
    const children = accuracy.filter((subtype) => subtype.parent !== null);
    expect(children.map((subtype) => subtype.parent)).toEqual([
      "mistranslation",
      "mistranslation",
      "mistranslation",
    ]);
  });

  it("서브타입 id 는 유일하고 부모 참조는 실재하며 차원이 부모와 일치한다", () => {
    const ids = STUDIO_MQM_SUBTYPES.map((subtype) => subtype.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const subtype of STUDIO_MQM_SUBTYPES) {
      expect(STUDIO_MQM_DIMENSION_IDS).toContain(subtype.dimension);
      if (subtype.parent === null) continue;
      const parent = STUDIO_MQM_SUBTYPES.find((other) => other.id === subtype.parent);
      expect(parent).toBeDefined();
      expect(parent?.dimension).toBe(subtype.dimension);
    }
  });

  it("기계 판정 가능한 서브타입은 Truncation/text expansion 하나뿐이다", () => {
    const machineCheckable = STUDIO_MQM_SUBTYPES.filter((subtype) => subtype.machineCheckable);
    expect(machineCheckable.map((subtype) => subtype.id)).toEqual([
      "truncation-text-expansion",
    ]);
  });

  it("심각도 배수는 Neutral 0 / Minor 1 / Major 5 / Critical 25 다", () => {
    expect(STUDIO_MQM_SEVERITY_WEIGHTS).toEqual({
      neutral: 0,
      minor: 1,
      major: 5,
      critical: 25,
    });
    expect(STUDIO_MQM_PASS_THRESHOLD).toBe(99);
    expect(STUDIO_MQM_CRITICAL_AUTO_FAIL).toBe(true);
    expect(STUDIO_MQM_SAMPLE_MIN_WORDS).toBe(500);
    expect(STUDIO_MQM_SAMPLE_MAX_WORDS).toBe(20_000);
  });

  it("조회 헬퍼는 서브타입에서 차원을 유도한다", () => {
    expect(studioMqmSubtype("mt-hallucination").dimension).toBe("accuracy");
    expect(studioMqmSubtype("truncation-text-expansion").dimension).toBe("design-and-markup");
    expect(studioMqmDimension("locale-conventions").mqmName).toBe("Locale conventions");
  });
});

describe("오류 정규화 (§3)", () => {
  it("서브타입이 차원의 단일 소스다", () => {
    const error = normalizeStudioMqmError({ subtype: "omission", severity: "major" }, 0);
    expect(error.dimension).toBe("accuracy");
    expect(error.subtype).toBe("omission");
    expect(error.penalty).toBe(5);
  });

  it("서브타입 없이 차원만 줄 수 있다 (이름이 확인되지 않은 서브타입용)", () => {
    const error = normalizeStudioMqmError({ dimension: "terminology", severity: "minor" }, 3);
    expect(error.dimension).toBe("terminology");
    expect(error.subtype).toBeNull();
    expect(error.id).toBe("terminology:-:-:3");
  });

  it("id 는 주어지면 그대로, 없으면 결정적으로 파생한다", () => {
    expect(normalizeStudioMqmError({ subtype: "link", severity: "minor", id: "x" }, 0).id).toBe(
      "x",
    );
    const derived = normalizeStudioMqmError(
      { subtype: "link", severity: "minor", cueId: "c9" },
      7,
    );
    expect(derived.id).toBe("design-and-markup:link:c9:7");
  });

  it("ETW 는 심각도 배수에 곱해지고, 비유한·음수는 기본값 1로 되돌린다", () => {
    expect(normalizeStudioMqmError({ subtype: "layout", severity: "major", typeWeight: 0.1 }, 0).penalty).toBeCloseTo(0.5, 10);
    expect(normalizeStudioMqmError({ subtype: "layout", severity: "major", typeWeight: 0 }, 0).penalty).toBe(0);
    // 음수 가중치는 오류를 점수 상승으로 뒤집는다 — 막아야 한다.
    expect(normalizeStudioMqmError({ subtype: "layout", severity: "major", typeWeight: -3 }, 0).typeWeight).toBe(1);
    expect(normalizeStudioMqmError({ subtype: "layout", severity: "major", typeWeight: Number.NaN }, 0).typeWeight).toBe(1);
  });

  it("페이지·컷·메모를 정돈하고 결과를 freeze 한다", () => {
    const error = normalizeStudioMqmError(
      { subtype: "addition", severity: "minor", page: 2.7, panel: 0, note: "  띄어쓰기  " },
      0,
    );
    expect(error.page).toBe(2);
    expect(error.panel).toBeNull();
    expect(error.note).toBe("띄어쓰기");
    expect(Object.isFrozen(error)).toBe(true);
  });
});

describe("채점 분모 (§4)", () => {
  it("단어 분모만 임계값이 보정돼 있다고 표시한다", () => {
    expect(studioMqmDenominator(["a b c"], "words").thresholdCalibrated).toBe(true);
    expect(studioMqmDenominator(["a b c"], "characters").thresholdCalibrated).toBe(false);
    expect(studioMqmDenominator(["a b c"], "lines").thresholdCalibrated).toBe(false);
  });

  it("결과가 어떤 분모를 썼는지 명시한다", () => {
    const result = scoreStudioMqmErrors(minor(1), studioMqmDenominator(["가나다 라마바"], "characters"));
    expect(result.denominator).toEqual({
      unit: "characters",
      count: 6,
      thresholdCalibrated: false,
    });
  });

  it("단어 분모는 공백 분절이고, 한국어 어절은 세지만 중국어는 과소계상한다", () => {
    expect(countStudioMqmScoringUnits(["hello   brave  world"], "words")).toBe(3);
    expect(countStudioMqmScoringUnits(["오늘은 좋은 날이다"], "words")).toBe(3);
    // 중국어는 공백이 없어 문장 전체가 1 단어로 잡힌다 — ISO 5060 의 문자 분모가 필요한 이유.
    expect(countStudioMqmScoringUnits(["今天天气很好"], "words")).toBe(1);
    expect(countStudioMqmScoringUnits(["今天天气很好"], "characters")).toBe(6);
  });

  it("문자 분모는 공백을 빼고 자소 군집으로 센다", () => {
    expect(countStudioMqmScoringUnits(["a b\nc"], "characters")).toBe(3);
    // 서로게이트 페어·결합 이모지가 두 글자로 세지지 않는다.
    expect(countStudioMqmScoringUnits(["👨‍👩‍👧"], "characters")).toBe(1);
  });

  it("행 분모는 개행 기준 비어 있지 않은 줄을 센다", () => {
    expect(countStudioMqmScoringUnits(["첫 줄\n둘째 줄\n\n  \n넷째"], "lines")).toBe(3);
    expect(countStudioMqmScoringUnits(["a", "b\nc"], "lines")).toBe(3);
  });

  it("빈 입력과 빈 문자열은 0 이다", () => {
    for (const unit of ["words", "characters", "lines"] as const) {
      expect(countStudioMqmScoringUnits([], unit)).toBe(0);
      expect(countStudioMqmScoringUnits(["", "   "], unit)).toBe(0);
    }
  });
});

describe("APT / PWPT / NPT / QS (§5)", () => {
  it("출처의 기준점: 100단어에 Minor 1건이면 QS 가 정확히 99, 즉 합격 경계다", () => {
    const result = scoreStudioMqmErrors(minor(1), words(100));
    expect(result.apt).toBe(1);
    expect(result.pwpt).toBe(0.01);
    expect(result.npt).toBe(10);
    expect(result.qualityScore).toBe(99);
    expect(result.verdict).toBe("pass");
    expect(result.failReason).toBeNull();
  });

  it("작업 예제: 1,000단어 · Minor 3 + Major 2 → APT 13, NPT 13, QS 98.7, 불합격", () => {
    const errors: StudioMqmErrorInput[] = [
      { subtype: "addition", severity: "minor", cueId: "c1" },
      { dimension: "style", severity: "minor", cueId: "c2" },
      { dimension: "linguistic-conventions", severity: "minor", cueId: "c3" },
      { subtype: "mistranslation", severity: "major", cueId: "c4" },
      { subtype: "omission", severity: "major", cueId: "c5" },
    ];
    const result = scoreStudioMqmErrors(errors, words(1000));

    expect(result.apt).toBe(3 * 1 + 2 * 5);
    expect(result.apt).toBe(13);
    expect(result.pwpt).toBe(0.013);
    expect(result.npt).toBe(13);
    expect(result.qualityScore).toBe(98.7);
    expect(result.verdict).toBe("fail");
    expect(result.failReason).toBe("below-threshold");
    expect(result.counts).toEqual({ neutral: 0, minor: 3, major: 2, critical: 0 });
  });

  it("NPT 는 PWPT × 1000 이고 QS 는 100 − PWPT × 100 이다", () => {
    const result = scoreStudioMqmErrors(minor(7), words(2000));
    expect(result.pwpt).toBe(0.0035);
    expect(result.npt).toBe(3.5);
    expect(result.qualityScore).toBe(99.65);
    expect(result.npt).toBeCloseTo((result.pwpt as number) * 1000, 10);
    expect(result.qualityScore).toBeCloseTo(100 - (result.pwpt as number) * 100, 10);
  });

  it("임계값 99 는 포함 경계다 — 99.0 은 합격, 98.9 는 불합격", () => {
    const pass = scoreStudioMqmErrors(minor(10), words(1000));
    expect(pass.qualityScore).toBe(99);
    expect(pass.verdict).toBe("pass");

    const fail = scoreStudioMqmErrors(minor(11), words(1000));
    expect(fail.qualityScore).toBe(98.9);
    expect(fail.verdict).toBe("fail");
    expect(fail.failReason).toBe("below-threshold");
  });

  it("Neutral 은 기록되지만 점수를 깎지 않는다", () => {
    const result = scoreStudioMqmErrors(
      [
        { dimension: "style", severity: "neutral", cueId: "c1" },
        { dimension: "style", severity: "neutral", cueId: "c2" },
      ],
      words(1000),
    );
    expect(result.apt).toBe(0);
    expect(result.qualityScore).toBe(100);
    expect(result.counts.neutral).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.verdict).toBe("pass");
  });

  it("오류가 없으면 만점 합격이다", () => {
    const result = scoreStudioMqmErrors([], words(1000));
    expect(result.apt).toBe(0);
    expect(result.qualityScore).toBe(100);
    expect(result.verdict).toBe("pass");
    expect(result.byDimension).toEqual([]);
  });

  it("ETW 가 APT 에 곱해진다", () => {
    const result = scoreStudioMqmErrors(
      [{ dimension: "linguistic-conventions", severity: "minor", typeWeight: 0.1, cueId: "c1" }],
      words(100),
    );
    expect(result.apt).toBe(0.1);
    expect(result.qualityScore).toBe(99.9);
    expect(result.verdict).toBe("pass");
  });

  it("차원별 집계가 APT 를 나눠 갖는다", () => {
    const result = scoreStudioMqmErrors(
      [
        { subtype: "mistranslation", severity: "major", cueId: "c1" },
        { subtype: "omission", severity: "minor", cueId: "c2" },
        { subtype: "layout", severity: "minor", cueId: "c3" },
      ],
      words(1000),
    );
    const accuracy = result.byDimension.find((row) => row.dimension === "accuracy");
    const markup = result.byDimension.find((row) => row.dimension === "design-and-markup");

    expect(accuracy?.errorCount).toBe(2);
    expect(accuracy?.penalty).toBe(6);
    expect(accuracy?.counts).toEqual({ neutral: 0, minor: 1, major: 1, critical: 0 });
    expect(markup?.penalty).toBe(1);
    expect(
      result.byDimension.reduce((sum, row) => sum + row.penalty, 0),
    ).toBe(result.apt);
    // 차원 순서는 카탈로그 순서를 따른다(정확성 → 디자인·마크업).
    expect(result.byDimension.map((row) => row.dimension)).toEqual([
      "accuracy",
      "design-and-markup",
    ]);
  });

  it("표본 크기 구간은 단어 분모에서만 판정하고 그 밖에서는 판단 불가(null)다", () => {
    expect(scoreStudioMqmErrors([], words(100)).sampleSize).toEqual({
      count: 100,
      min: 500,
      max: 20_000,
      inRange: false,
    });
    expect(scoreStudioMqmErrors([], words(500)).sampleSize.inRange).toBe(true);
    expect(scoreStudioMqmErrors([], words(20_000)).sampleSize.inRange).toBe(true);
    expect(scoreStudioMqmErrors([], words(20_001)).sampleSize.inRange).toBe(false);
    expect(
      scoreStudioMqmErrors([], studioMqmDenominator(["가나다"], "characters")).sampleSize.inRange,
    ).toBeNull();
  });

  it("분모가 0 이면 점수가 정의되지 않으므로 unscorable 이다 (만점 통과가 아니다)", () => {
    const empty = scoreStudioMqmErrors([], studioMqmDenominator([], "words"));
    expect(empty.verdict).toBe("unscorable");
    expect(empty.failReason).toBe("empty-denominator");
    expect(empty.pwpt).toBeNull();
    expect(empty.npt).toBeNull();
    expect(empty.qualityScore).toBeNull();
    expect(empty.apt).toBe(0);

    // 오류가 있어도 마찬가지로 점수를 낼 수 없다(0 으로 나눠 Infinity 를 내지 않는다).
    const withErrors = scoreStudioMqmErrors(minor(3), studioMqmDenominator([], "words"));
    expect(withErrors.verdict).toBe("unscorable");
    expect(withErrors.apt).toBe(3);
    expect(withErrors.qualityScore).toBeNull();
  });

  it("메타데이터를 싣고 결과 전체를 freeze 한다", () => {
    const result = scoreStudioMqmErrors(minor(1), words(1000));
    expect(result.basis).toBe("mqm-core");
    expect(result.rulesetVersion).toBe(STUDIO_LOCALIZATION_MQM_RULESET_VERSION);
    expect(result.passThreshold).toBe(99);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.errors)).toBe(true);
    expect(Object.isFrozen(result.counts)).toBe(true);
    expect(Object.isFrozen(result.byDimension)).toBe(true);
  });

  it("입력 배열을 변형하지 않고 같은 입력에 같은 결과를 낸다", () => {
    const errors: StudioMqmErrorInput[] = [
      { dimension: "style", severity: "minor", cueId: "b" },
      { subtype: "mistranslation", severity: "major", cueId: "a" },
    ];
    const snapshot = JSON.parse(JSON.stringify(errors));
    const first = scoreStudioMqmErrors(errors, words(1000));
    const second = scoreStudioMqmErrors(errors, words(1000));
    expect(errors).toEqual(snapshot);
    expect(first).toEqual(second);
    // 심각한 것부터 정렬된다.
    expect(first.errors.map((error) => error.severity)).toEqual(["major", "minor"]);
  });
});

describe("Critical 자동 불합격 (§5)", () => {
  it("Critical 1건이면 QS 가 임계값을 넘어도 불합격이다", () => {
    // 100,000 단어에 Critical 1건 → QS 99.975 로 임계값을 넉넉히 넘는다.
    const result = scoreStudioMqmErrors(
      [{ subtype: "mt-hallucination", severity: "critical", cueId: "c1" }],
      words(100_000),
    );
    expect(result.apt).toBe(25);
    expect(result.qualityScore).toBe(99.975);
    expect(result.qualityScore as number).toBeGreaterThan(STUDIO_MQM_PASS_THRESHOLD);
    expect(result.verdict).toBe("fail");
    expect(result.failReason).toBe("critical-error");
    expect(result.counts.critical).toBe(1);
  });

  it("Critical 사유가 임계값 미달보다 우선한다", () => {
    const result = scoreStudioMqmErrors(
      [
        { subtype: "mistranslation", severity: "critical", cueId: "c1" },
        ...minor(50),
      ],
      words(1000),
    );
    expect(result.qualityScore as number).toBeLessThan(STUDIO_MQM_PASS_THRESHOLD);
    expect(result.failReason).toBe("critical-error");
  });

  it("Critical 이 ETW 0 이어서 점수를 전혀 깎지 않아도 여전히 자동 불합격이다", () => {
    const result = scoreStudioMqmErrors(
      [{ subtype: "omission", severity: "critical", typeWeight: 0, cueId: "c1" }],
      words(1000),
    );
    expect(result.apt).toBe(0);
    expect(result.qualityScore).toBe(100);
    expect(result.verdict).toBe("fail");
    expect(result.failReason).toBe("critical-error");
  });

  it("Critical 이 없으면 Major 가 아무리 많아도 사유는 임계값 미달이다", () => {
    const result = scoreStudioMqmErrors(
      Array.from({ length: 20 }, (_, index) => ({
        subtype: "mistranslation" as const,
        severity: "major" as const,
        cueId: `c${index}`,
      })),
      words(1000),
    );
    expect(result.counts.critical).toBe(0);
    expect(result.failReason).toBe("below-threshold");
  });
});

describe("Truncation/text expansion 기계 판정 (§6)", () => {
  const base: StudioMqmTruncationObservation = { cueId: "cue-1", fits: true };

  it("렌더가 글자를 버렸으면 Critical — 회차가 자동 불합격이 된다", () => {
    const errors = detectStudioMqmTruncationErrors([
      { ...base, fits: false, textLost: true, page: 3, panel: 2 },
    ]);
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error?.severity).toBe("critical");
    expect(error?.subtype).toBe("truncation-text-expansion");
    expect(error?.page).toBe(3);
    expect(error?.panel).toBe(2);
    expect(error?.id).toBe("truncation:cue-1");

    const scored = scoreStudioMqmErrors(errors, words(5000));
    expect(scored.verdict).toBe("fail");
    expect(scored.failReason).toBe("critical-error");
    expect(scored.byDimension[0]?.dimension).toBe("design-and-markup");
  });

  it("들어가지 않으면 Major", () => {
    const [error] = detectStudioMqmTruncationErrors([{ ...base, fits: false }]);
    expect(error?.severity).toBe("major");
    expect(error?.evidence).toMatchObject({ fits: false });
  });

  it("가독 하한 아래로 줄여야 들어가면 Minor", () => {
    const [error] = detectStudioMqmTruncationErrors([{ ...base, fits: true, shrinkRatio: 0.62 }]);
    expect(error?.severity).toBe("minor");
    expect(error?.note).toContain("62%");
    expect(error?.evidence).toMatchObject({ fits: true, shrinkRatio: 0.62 });
  });

  it("가독 하한은 포함 경계다 — 정확히 0.8 이면 오류가 아니다", () => {
    expect(STUDIO_MQM_LEGIBLE_SHRINK_RATIO).toBe(0.8);
    expect(
      detectStudioMqmTruncationErrors([{ ...base, shrinkRatio: STUDIO_MQM_LEGIBLE_SHRINK_RATIO }]),
    ).toEqual([]);
    expect(detectStudioMqmTruncationErrors([{ ...base, shrinkRatio: 0.7999 }])).toHaveLength(1);
  });

  it("가독 하한을 갈아끼울 수 있고, 잘못된 값은 기본값으로 되돌린다", () => {
    const observation = { ...base, shrinkRatio: 0.7 };
    expect(detectStudioMqmTruncationErrors([observation], { legibleShrinkRatio: 0.5 })).toEqual([]);
    expect(
      detectStudioMqmTruncationErrors([observation], { legibleShrinkRatio: Number.NaN }),
    ).toHaveLength(1);
    expect(detectStudioMqmTruncationErrors([observation], { legibleShrinkRatio: 0 })).toHaveLength(
      1,
    );
  });

  it("잘 맞는 말풍선은 오류를 만들지 않는다", () => {
    expect(
      detectStudioMqmTruncationErrors([
        { ...base, fits: true },
        { ...base, cueId: "cue-2", fits: true, shrinkRatio: 1 },
        { ...base, cueId: "cue-3", fits: true, textLost: false },
      ]),
    ).toEqual([]);
    expect(detectStudioMqmTruncationErrors([])).toEqual([]);
  });

  it("팽창률만으로는 오류가 되지 않고 증거로만 실린다 — 상자가 크면 팽창해도 멀쩡하다", () => {
    expect(detectStudioMqmTruncationErrors([{ ...base, fits: true, expansionRatio: 1.9 }])).toEqual(
      [],
    );
    const [error] = detectStudioMqmTruncationErrors([
      { ...base, fits: false, expansionRatio: 1.4 },
    ]);
    expect(error?.severity).toBe("major");
    expect(error?.evidence).toMatchObject({ expansionRatio: 1.4 });
  });

  it("심각도 사다리를 관측치별로 독립 적용하고 결정적으로 나열한다", () => {
    const errors = detectStudioMqmTruncationErrors([
      { cueId: "a", fits: true, shrinkRatio: 0.5 },
      { cueId: "b", fits: false },
      { cueId: "c", fits: true },
      { cueId: "d", fits: false, textLost: true },
    ]);
    expect(errors.map((error) => [error.cueId, error.severity])).toEqual([
      ["a", "minor"],
      ["b", "major"],
      ["d", "critical"],
    ]);
    expect(Object.isFrozen(errors)).toBe(true);
  });

  it("textLost 가 fits 판정을 덮어쓴다 — 손실이 확인되면 그것이 최상위 사유다", () => {
    const [error] = detectStudioMqmTruncationErrors([
      { cueId: "a", fits: true, textLost: true, shrinkRatio: 0.9 },
    ]);
    expect(error?.severity).toBe("critical");
  });
});

describe("WMT 2021 운영 변형 (§7)", () => {
  it("상수가 출처와 일치한다", () => {
    expect(STUDIO_MQM_WMT_2021).toEqual({
      minorFluencyPunctuationTypeWeight: 0.1,
      maxErrorsPerSegment: 5,
    });
  });

  it("세그먼트당 5건으로 자르고, 잘리는 것은 가장 가벼운 오류다", () => {
    const errors: StudioMqmErrorInput[] = [
      ...Array.from({ length: 6 }, (_, index) => ({
        dimension: "style" as const,
        severity: "minor" as const,
        cueId: "same",
        id: `m${index}`,
      })),
      { subtype: "mistranslation", severity: "major", cueId: "same", id: "major-1" },
    ];
    const capped = capStudioMqmErrorsPerSegment(errors);
    expect(capped).toHaveLength(5);
    expect(capped.map((error) => error.id)).toContain("major-1");
    expect(capped.filter((error) => error.severity === "minor")).toHaveLength(4);
    // 입력 순서를 보존한다.
    expect(capped.map((error) => error.id)).toEqual(["m0", "m1", "m2", "m3", "major-1"]);
  });

  it("세그먼트가 다르면 각각 상한을 갖는다", () => {
    const errors: StudioMqmErrorInput[] = [
      ...Array.from({ length: 6 }, (_, index) => ({
        dimension: "style" as const,
        severity: "minor" as const,
        cueId: "a",
        id: `a${index}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        dimension: "style" as const,
        severity: "minor" as const,
        cueId: "b",
        id: `b${index}`,
      })),
    ];
    expect(capStudioMqmErrorsPerSegment(errors)).toHaveLength(10);
  });

  it("cueId 가 없는 오류는 세그먼트에 속하지 않으므로 상한을 적용하지 않는다", () => {
    const errors: StudioMqmErrorInput[] = Array.from({ length: 9 }, (_, index) => ({
      dimension: "style" as const,
      severity: "minor" as const,
      id: `n${index}`,
    }));
    expect(capStudioMqmErrorsPerSegment(errors)).toHaveLength(9);
  });

  it("상한 아래면 입력을 그대로 돌려주고, 잘못된 상한은 무시한다", () => {
    const errors = minor(3).map((error, index) => ({ ...error, cueId: "same", id: `x${index}` }));
    expect(capStudioMqmErrorsPerSegment(errors)).toHaveLength(3);
    expect(capStudioMqmErrorsPerSegment(errors, Number.NaN)).toHaveLength(3);
    expect(capStudioMqmErrorsPerSegment(errors, -1)).toHaveLength(3);
    expect(capStudioMqmErrorsPerSegment(errors, 0)).toHaveLength(0);
  });

  it("상한을 적용한 결과가 그대로 채점기에 들어간다", () => {
    const errors: StudioMqmErrorInput[] = Array.from({ length: 8 }, (_, index) => ({
      dimension: "style" as const,
      severity: "minor" as const,
      cueId: "same",
      id: `m${index}`,
    }));
    const uncapped = scoreStudioMqmErrors(errors, words(1000));
    const capped = scoreStudioMqmErrors(capStudioMqmErrorsPerSegment(errors), words(1000));
    expect(uncapped.apt).toBe(8);
    expect(capped.apt).toBe(5);
    expect(capped.qualityScore).toBe(99.5);
  });
});
