import { describe, expect, it } from "vitest";

import { calculateContrastRatio } from "../studio-color-harmony-engine";

import {
  auditBubbleTextLegibility,
  isWcagLargeText,
  wcagContrastThreshold,
  type BubbleLegibilityInput,
} from "./studio-bubble-legibility-contrast";

/**
 * 판정이 나오려면 크기가 반드시 있어야 하므로, 대부분의 케이스가 공유할 기준 입력을 둔다.
 * 16px = 12pt → WCAG large scale 미만(일반 글자).
 */
const base: BubbleLegibilityInput = {
  textColor: "#000000",
  backdropColor: "#ffffff",
  fontSizePx: 16,
};

describe("§3 WCAG 임계값 선택", () => {
  it("large scale 하한은 일반 18pt(24px) / 굵은 14pt(18.666…px)다 [WCAG-LG][CSS-U]", () => {
    expect(isWcagLargeText(24, false)).toBe(true);
    expect(isWcagLargeText(23.99, false)).toBe(false);
    expect(isWcagLargeText(14 * (96 / 72), true)).toBe(true);
    expect(isWcagLargeText(18.6, true)).toBe(false);
    // 같은 18.7px 이라도 굵기에 따라 large 여부가 갈린다.
    expect(isWcagLargeText(18.7, true)).toBe(true);
    expect(isWcagLargeText(18.7, false)).toBe(false);
  });

  it("임계값은 AA 4.5/3, AAA 7/4.5 다 [WCAG-143][WCAG-146]", () => {
    expect(wcagContrastThreshold("AA", "normal")).toBe(4.5);
    expect(wcagContrastThreshold("AA", "large")).toBe(3);
    expect(wcagContrastThreshold("AAA", "normal")).toBe(7);
    expect(wcagContrastThreshold("AAA", "large")).toBe(4.5);
  });
});

describe("pass / fail", () => {
  it("흰 말풍선의 검은 대사는 AA 를 통과한다(21:1)", () => {
    const report = auditBubbleTextLegibility(base);
    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(21);
    expect(report.threshold).toBe(4.5);
    expect(report.successCriterion).toBe("1.4.3");
    expect(report.textScale).toBe("normal");
    expect(report.reason).toBeNull();
  });

  it("흰 말풍선의 연회색 대사는 AA 일반 글자에서 떨어진다(#777777 = 4.48)", () => {
    const report = auditBubbleTextLegibility({ ...base, textColor: "#777777" });
    expect(report.verdict).toBe("fail");
    expect(report.ratio).toBe(4.48);
    expect(report.threshold).toBe(4.5);
  });

  it("같은 회색도 조금만 더 어두우면 통과한다(#767676 = 4.54)", () => {
    const report = auditBubbleTextLegibility({ ...base, textColor: "#767676" });
    expect(report.verdict).toBe("pass");
    expect(report.ratio).toBe(4.54);
  });

  it("글자색과 말풍선색이 같으면 1:1 로 떨어진다", () => {
    const report = auditBubbleTextLegibility({ ...base, textColor: "#ffffff" });
    expect(report.verdict).toBe("fail");
    expect(report.ratio).toBe(1);
  });

  it("#RGB 축약형과 대문자 표기를 정규화해 같은 결과를 낸다", () => {
    const short = auditBubbleTextLegibility({ ...base, textColor: "#000", backdropColor: "#FFF" });
    expect(short.verdict).toBe("pass");
    expect(short.ratio).toBe(21);
  });

  it("비율은 재사용하는 계산기와 정확히 같은 값이다(색 과학 이중 구현 금지)", () => {
    const report = auditBubbleTextLegibility({ ...base, textColor: "#8c8c8c" });
    expect(report.ratio).toBe(calculateContrastRatio("#8c8c8c", "#ffffff"));
  });
});

describe("큰 글자 임계값", () => {
  // #8c8c8c on #ffffff = 3.36 → 일반 글자(4.5)에는 미달, 큰 글자(3)에는 충족.
  const grey = { ...base, textColor: "#8c8c8c" };

  it("23px 일반 굵기는 일반 글자로 보고 떨어진다", () => {
    const report = auditBubbleTextLegibility({ ...grey, fontSizePx: 23 });
    expect(report.textScale).toBe("normal");
    expect(report.threshold).toBe(4.5);
    expect(report.verdict).toBe("fail");
  });

  it("24px(=18pt) 일반 굵기는 큰 글자로 보고 통과한다", () => {
    const report = auditBubbleTextLegibility({ ...grey, fontSizePx: 24 });
    expect(report.textScale).toBe("large");
    expect(report.threshold).toBe(3);
    expect(report.verdict).toBe("pass");
  });

  it("19px 은 굵을 때만 큰 글자다 — fontWeight 700 과 fontStyle \"bold\" 둘 다 인정한다", () => {
    expect(auditBubbleTextLegibility({ ...grey, fontSizePx: 19 }).textScale).toBe("normal");
    expect(
      auditBubbleTextLegibility({ ...grey, fontSizePx: 19, fontWeight: 700 }).textScale,
    ).toBe("large");
    expect(
      auditBubbleTextLegibility({ ...grey, fontSizePx: 19, fontStyle: "bold" }).textScale,
    ).toBe("large");
    expect(
      auditBubbleTextLegibility({ ...grey, fontSizePx: 19, fontStyle: "bold italic" }).textScale,
    ).toBe("large");
    // italic 만으로는 굵은 글씨가 아니다.
    expect(
      auditBubbleTextLegibility({ ...grey, fontSizePx: 19, fontStyle: "italic" }).textScale,
    ).toBe("normal");
    // 600 은 CSS 의 bold(700) 미만이라 굵지 않다고 본다(더 엄격한 임계값 쪽 = 안전한 방향).
    expect(
      auditBubbleTextLegibility({ ...grey, fontSizePx: 19, fontWeight: 600 }).textScale,
    ).toBe("normal");
    // 수치 굵기가 있으면 문자열보다 우선한다.
    expect(
      auditBubbleTextLegibility({
        ...grey,
        fontSizePx: 19,
        fontWeight: 400,
        fontStyle: "bold",
      }).textScale,
    ).toBe("normal");
  });

  it("AAA 는 더 높은 임계값을 쓴다", () => {
    // #767676 on white = 4.54 → AA 일반은 통과, AAA 일반(7)은 미달, AAA 큰 글자(4.5)는 통과.
    const aaa = { ...base, textColor: "#767676", level: "AAA" as const };
    const normal = auditBubbleTextLegibility(aaa);
    expect(normal.verdict).toBe("fail");
    expect(normal.threshold).toBe(7);
    expect(normal.successCriterion).toBe("1.4.6");

    const large = auditBubbleTextLegibility({ ...aaa, fontSizePx: 24 });
    expect(large.verdict).toBe("pass");
    expect(large.threshold).toBe(4.5);
  });
});

describe("indeterminate — 불투명 단색이 아닌 입력은 전부 판정 거부", () => {
  const expectIndeterminate = (input: BubbleLegibilityInput, reason: string) => {
    const report = auditBubbleTextLegibility(input);
    expect(report.verdict).toBe("indeterminate");
    expect(report.reason).toBe(reason);
    return report;
  };

  it("글자색이 비었다", () => {
    expectIndeterminate({ ...base, textColor: undefined }, "text-color-missing");
    expectIndeterminate({ ...base, textColor: null }, "text-color-missing");
    expectIndeterminate({ ...base, textColor: "" }, "text-color-missing");
    expectIndeterminate({ ...base, textColor: "   " }, "text-color-missing");
    expectIndeterminate(
      { ...base, textColor: 123 as unknown as string },
      "text-color-missing",
    );
  });

  it("배경(말풍선)이 없다 — 그림 위 자유 텍스트", () => {
    expectIndeterminate({ ...base, backdropColor: undefined }, "backdrop-missing");
    expectIndeterminate({ ...base, backdropColor: null }, "backdrop-missing");
  });

  it("반투명 표기는 반투명으로 분류한다", () => {
    expectIndeterminate(
      { ...base, textColor: "rgba(255,255,255,0.9)" },
      "text-color-translucent",
    );
    expectIndeterminate({ ...base, textColor: "#ffffff80" }, "text-color-translucent");
    expectIndeterminate({ ...base, textColor: "#fff8" }, "text-color-translucent");
    expectIndeterminate({ ...base, textColor: "transparent" }, "text-color-translucent");
    expectIndeterminate({ ...base, textColor: "hsla(0,0%,100%,0.5)" }, "text-color-translucent");
    expectIndeterminate(
      { ...base, backdropColor: "rgba(0,0,0,0.4)" },
      "backdrop-translucent",
    );
    expectIndeterminate({ ...base, backdropColor: "#00000080" }, "backdrop-translucent");
  });

  it("알파가 완전 불투명인 헥스는 알파를 떼고 정상 판정한다", () => {
    const long = auditBubbleTextLegibility({
      ...base,
      textColor: "#000000ff",
      backdropColor: "#ffffffff",
    });
    expect(long.verdict).toBe("pass");
    expect(long.ratio).toBe(21);

    const short = auditBubbleTextLegibility({
      ...base,
      textColor: "#000f",
      backdropColor: "#ffff",
    });
    expect(short.verdict).toBe("pass");
    expect(short.ratio).toBe(21);
  });

  it("이 엔진이 해석하지 않는 색 문법은 전부 unparsed 다", () => {
    expectIndeterminate({ ...base, textColor: "white" }, "text-color-unparsed");
    expectIndeterminate({ ...base, textColor: "rgb(0,0,0)" }, "text-color-unparsed");
    expectIndeterminate({ ...base, textColor: "hsl(0,0%,0%)" }, "text-color-unparsed");
    expectIndeterminate({ ...base, textColor: "var(--fg)" }, "text-color-unparsed");
    expectIndeterminate({ ...base, textColor: "#12345" }, "text-color-unparsed");
    expectIndeterminate(
      { ...base, backdropColor: "linear-gradient(#fff,#000)" },
      "backdrop-unparsed",
    );
    expectIndeterminate({ ...base, backdropColor: "none" }, "backdrop-unparsed");
  });

  it("그라데이션 플래그는 색보다 먼저 본다 — fill 이 멀쩡한 헥스여도 판정하지 않는다", () => {
    expectIndeterminate(
      { ...base, backdropColor: "#ffffff", backdropIsGradient: true },
      "backdrop-not-solid",
    );
    expectIndeterminate(
      { ...base, textColor: "#000000", textIsGradient: true },
      "text-fill-not-solid",
    );
    // false 는 플래그가 없는 것과 같다.
    expect(
      auditBubbleTextLegibility({ ...base, backdropIsGradient: false, textIsGradient: false })
        .verdict,
    ).toBe("pass");
  });

  it("외곽선이 있으면 판정하지 않고 성분 비율만 참고로 노출한다", () => {
    const report = auditBubbleTextLegibility({
      ...base,
      textColor: "#ffffff",
      backdropColor: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 3,
    });
    expect(report.verdict).toBe("indeterminate");
    expect(report.reason).toBe("outlined-text");
    expect(report.outlineRatios).toEqual({ textVsStroke: 21, strokeVsBackdrop: 21 });
    // 참고 수치는 판정이 아니다 — pass 로 승격되지 않는다.
    expect(report.ratio).toBeNull();
    expect(report.threshold).toBeNull();
  });

  it("외곽선 색이 있는데 두께가 미설정이면 보수적으로 외곽선이 있는 것으로 본다", () => {
    const report = auditBubbleTextLegibility({ ...base, strokeColor: "#ff0000" });
    expect(report.reason).toBe("outlined-text");
  });

  it("외곽선 두께가 명시적으로 0 이하이면 외곽선 없음으로 보고 정상 판정한다", () => {
    expect(
      auditBubbleTextLegibility({ ...base, strokeColor: "#ff0000", strokeWidth: 0 }).verdict,
    ).toBe("pass");
    expect(
      auditBubbleTextLegibility({ ...base, strokeColor: "#ff0000", strokeWidth: -2 }).verdict,
    ).toBe("pass");
    // 색이 없으면 두께만 있어도 외곽선이 아니다.
    expect(auditBubbleTextLegibility({ ...base, strokeWidth: 4 }).verdict).toBe("pass");
  });

  it("외곽선 색을 파싱하지 못해도 판정은 여전히 거부하고, 성분 비율만 null 이 된다", () => {
    const report = auditBubbleTextLegibility({
      ...base,
      strokeColor: "rgba(0,0,0,0.5)",
      strokeWidth: 2,
    });
    expect(report.reason).toBe("outlined-text");
    expect(report.outlineRatios).toEqual({ textVsStroke: null, strokeVsBackdrop: null });
  });

  it("글자 크기를 모르면 임계값을 고를 수 없어 판정하지 않는다", () => {
    expectIndeterminate({ ...base, fontSizePx: undefined }, "font-size-unknown");
    expectIndeterminate({ ...base, fontSizePx: 0 }, "font-size-unknown");
    expectIndeterminate({ ...base, fontSizePx: -12 }, "font-size-unknown");
    expectIndeterminate({ ...base, fontSizePx: Number.NaN }, "font-size-unknown");
    expectIndeterminate({ ...base, fontSizePx: Number.POSITIVE_INFINITY }, "font-size-unknown");
  });

  it("비율이 임계값과 반올림 경계에서 겹치면 판정하지 않는다", () => {
    // #000000 on #595959 의 실제 비율은 2.998 로 3 에 **미달**하지만 소수 둘째 자리로는 3.00 이다.
    // 여기서 pass 를 내면 정확히 이 파일이 막으려는 거짓 통과가 된다.
    const boundaryLarge = auditBubbleTextLegibility({
      textColor: "#000000",
      backdropColor: "#595959",
      fontSizePx: 24,
    });
    expect(boundaryLarge.verdict).toBe("indeterminate");
    expect(boundaryLarge.reason).toBe("ratio-at-rounding-boundary");
    // 경계 케이스는 계산까지는 갔으므로 비율/임계값을 그대로 보여준다.
    expect(boundaryLarge.ratio).toBe(3);
    expect(boundaryLarge.threshold).toBe(3);
    expect(boundaryLarge.textScale).toBe("large");

    // AA 일반 경계(4.50) — 실제 값은 4.503 으로 충족이지만 반올림만으로는 단정할 수 없다.
    const boundaryNormal = auditBubbleTextLegibility({
      textColor: "#020202",
      backdropColor: "#757575",
      fontSizePx: 16,
    });
    expect(boundaryNormal.reason).toBe("ratio-at-rounding-boundary");
    expect(boundaryNormal.ratio).toBe(4.5);

    // AAA 일반 경계(7.00).
    const boundaryAaa = auditBubbleTextLegibility({
      textColor: "#595959",
      backdropColor: "#ffffff",
      fontSizePx: 16,
      level: "AAA",
    });
    expect(boundaryAaa.reason).toBe("ratio-at-rounding-boundary");
    expect(boundaryAaa.ratio).toBe(7);
    expect(boundaryAaa.threshold).toBe(7);
  });

  it("경계 바로 옆 한 칸은 확정적으로 판정한다", () => {
    expect(auditBubbleTextLegibility({ ...base, textColor: "#777777" }).ratio).toBe(4.48);
    expect(auditBubbleTextLegibility({ ...base, textColor: "#777777" }).verdict).toBe("fail");
    expect(auditBubbleTextLegibility({ ...base, textColor: "#767676" }).verdict).toBe("pass");
  });
});

describe("회귀 — 헥스 전용 계산기의 조용한 #000000 폴백", () => {
  it("반투명 흰 글자를 흰 말풍선에 얹으면 21:1 통과가 아니라 판정 거부다", () => {
    // 계산기를 직접 부르면 rgba() 가 #000000 으로 폴백해 만점이 나온다 — 거짓 통과의 실물.
    expect(calculateContrastRatio("rgba(255,255,255,0.9)", "#ffffff")).toBe(21);

    const report = auditBubbleTextLegibility({
      textColor: "rgba(255,255,255,0.9)",
      backdropColor: "#ffffff",
      fontSizePx: 16,
    });
    expect(report.verdict).not.toBe("pass");
    expect(report.reason).toBe("text-color-translucent");
    expect(report.ratio).toBeNull();
  });

  it("named color 도 마찬가지로 통과시키지 않는다", () => {
    expect(calculateContrastRatio("white", "#ffffff")).toBe(21);
    expect(auditBubbleTextLegibility({ ...base, textColor: "white" }).verdict).toBe(
      "indeterminate",
    );
  });
});

describe("결과 객체 계약", () => {
  it("보고서는 동결되어 있고 level 은 언제나 채워진다", () => {
    const pass = auditBubbleTextLegibility(base);
    expect(Object.isFrozen(pass)).toBe(true);
    expect(pass.level).toBe("AA");

    const indeterminate = auditBubbleTextLegibility({ ...base, textColor: undefined });
    expect(Object.isFrozen(indeterminate)).toBe(true);
    expect(indeterminate.level).toBe("AA");
    expect(auditBubbleTextLegibility({ ...base, textColor: null, level: "AAA" }).level).toBe(
      "AAA",
    );
  });

  it("같은 입력에 대해 결정적이다", () => {
    const input = { ...base, textColor: "#3366cc", fontSizePx: 21, fontStyle: "bold" };
    expect(auditBubbleTextLegibility(input)).toEqual(auditBubbleTextLegibility(input));
  });
});
