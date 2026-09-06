import { describe, expect, it } from "vitest";

import {
  STUDIO_MQM_DIMENSION_IDS,
  STUDIO_MQM_SUBTYPES,
  scoreStudioMqmErrors,
  studioMqmDenominator,
  studioMqmSubtype,
} from "./studio-localization-mqm";
import {
  STUDIO_LOCALIZATION_STYLE_RULES,
  STUDIO_LOCALIZATION_STYLE_RULESET_VERSION,
  isEnglishLocalizationTarget,
  lintStudioLocalizationStyle,
  studioLocalizationStyleFindingToMqmError,
  studioLocalizationStyleRule,
  type StudioLocalizationStyleFinding,
  type StudioLocalizationStyleLintOptions,
  type StudioLocalizationStyleRuleId,
  type StudioLocalizationStyleRuleSetting,
  type StudioLocalizationStyleUnit,
} from "./studio-localization-style-lint";

/**
 * 규칙 하나만 켜고 돌린다. 규칙끼리 겹쳐 발화하는 입력(`?!?!`은 순서 규칙과 연속 개수 규칙에
 * 동시에 걸린다)이 흔하므로, 규칙별 describe는 전부 이 헬퍼를 쓴다.
 */
function only(
  ruleId: StudioLocalizationStyleRuleId,
  unit: StudioLocalizationStyleUnit,
  options: Omit<StudioLocalizationStyleLintOptions, "rules"> = {},
): readonly StudioLocalizationStyleFinding[] {
  const rules: Partial<Record<StudioLocalizationStyleRuleId, StudioLocalizationStyleRuleSetting>> =
    {};
  for (const meta of STUDIO_LOCALIZATION_STYLE_RULES) rules[meta.id] = meta.id === ruleId;
  return lintStudioLocalizationStyle([unit], { ...options, rules }).findings;
}

function dialogue(text: string, extra: Partial<StudioLocalizationStyleUnit> = {}) {
  return { id: "u1", text, ...extra } satisfies StudioLocalizationStyleUnit;
}

function sfx(text: string, extra: Partial<StudioLocalizationStyleUnit> = {}) {
  return {
    id: "u1",
    text,
    kind: "sfx",
    ...extra,
  } satisfies StudioLocalizationStyleUnit;
}

function laidOut(lines: readonly string[], extra: Partial<StudioLocalizationStyleUnit> = {}) {
  return {
    id: "u1",
    text: lines.join(" "),
    lines,
    ...extra,
  } satisfies StudioLocalizationStyleUnit;
}

describe("allcaps-dialogue", () => {
  it("소문자 구간을 잡고 대문자 제안을 붙인다", () => {
    const found = only("allcaps-dialogue", dialogue("I'm HERE"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("m");
    expect(found[0].start).toBe(2);
    expect(found[0].end).toBe(3);
    expect(found[0].suggestion).toBe("M");
    expect(found[0].spanBasis).toBe("text");
    expect(found[0].line).toBeNull();
  });

  it("떨어져 있는 소문자 구간을 각각 보고한다", () => {
    const found = only("allcaps-dialogue", dialogue("go HOME now"));
    expect(found.map((f) => f.excerpt)).toEqual(["go", "now"]);
  });

  it("라틴 확장 소문자도 잡는다 — 대문자 낱말 속에 섞인 é 까지", () => {
    const found = only("allcaps-dialogue", dialogue("CAFé café"));
    expect(found.map((f) => f.excerpt)).toEqual(["é", "café"]);
    expect(found.map((f) => f.suggestion)).toEqual(["É", "CAFÉ"]);
  });

  // ── 발화하면 안 되는 경우 ──
  it("전부 대문자면 발화하지 않는다", () => {
    expect(only("allcaps-dialogue", dialogue("I'M HERE, OKAY?!"))).toHaveLength(0);
  });

  it("대소문자가 없는 문자(한글·숫자·구두점)에는 발화하지 않는다", () => {
    expect(only("allcaps-dialogue", dialogue("정말 그럴 리가 없잖아…?! 3.14"))).toHaveLength(0);
  });

  it("그림 안 글자(in-art)는 혼합 대소문자가 정상이므로 발화하지 않는다", () => {
    expect(only("allcaps-dialogue", dialogue("Open Daily", { kind: "in-art" }))).toHaveLength(0);
  });

  it("효과음은 이 규칙의 대상이 아니다", () => {
    expect(only("allcaps-dialogue", sfx("bang"))).toHaveLength(0);
  });
});

describe("ellipsis-three-dots", () => {
  it("점 두 개를 잡는다", () => {
    const found = only("ellipsis-three-dots", dialogue("WAIT.."));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("..");
    expect(found[0].message).toContain("2개");
    expect(found[0].suggestion).toBe("…");
  });

  it("점 네 개를 잡는다", () => {
    expect(only("ellipsis-three-dots", dialogue("WAIT....")).map((f) => f.message)).toEqual([
      expect.stringContaining("4개"),
    ]);
  });

  it("말줄임표 글자를 겹쳐 쓴 경우를 잡는다", () => {
    const found = only("ellipsis-three-dots", dialogue("WAIT……"));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("6개");
  });

  it("말줄임표 글자와 마침표가 섞인 경우를 잡는다", () => {
    expect(only("ellipsis-three-dots", dialogue("WAIT.…"))).toHaveLength(1);
  });

  it("requireEllipsisCharacter를 켜면 ASCII 세 점도 지적한다", () => {
    const found = only("ellipsis-three-dots", dialogue("WAIT..."), {
      requireEllipsisCharacter: true,
    });
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("...");
    expect(found[0].suggestion).toBe("…");
  });

  // ── 발화하면 안 되는 경우 ──
  it("말줄임표 글자 하나는 통과한다", () => {
    expect(only("ellipsis-three-dots", dialogue("WAIT…"))).toHaveLength(0);
  });

  it("ASCII 세 점은 기본적으로 통과한다", () => {
    expect(only("ellipsis-three-dots", dialogue("WAIT..."))).toHaveLength(0);
  });

  it("requireEllipsisCharacter를 켜도 말줄임표 글자는 통과한다", () => {
    expect(
      only("ellipsis-three-dots", dialogue("WAIT…"), {
        requireEllipsisCharacter: true,
      }),
    ).toHaveLength(0);
  });

  it("문장 끝 마침표와 약어 마침표는 말줄임표가 아니다", () => {
    expect(only("ellipsis-three-dots", dialogue("MR. KIM SAID SO."))).toHaveLength(0);
  });
});

describe("interrobang-order", () => {
  it("뒤집힌 !? 를 잡는다", () => {
    const found = only("interrobang-order", dialogue("WHAT!?"));
    expect(found).toHaveLength(1);
    expect(found[0].start).toBe(4);
    expect(found[0].end).toBe(6);
    expect(found[0].suggestion).toBe("?!");
  });

  it("겹쳐 나오면 !? 부분마다 보고한다", () => {
    expect(only("interrobang-order", dialogue("WHAT!?!?"))).toHaveLength(2);
  });

  // ── 발화하면 안 되는 경우 ──
  it("올바른 ?! 는 통과한다", () => {
    expect(only("interrobang-order", dialogue("WHAT?!"))).toHaveLength(0);
  });

  it("같은 부호끼리 반복된 경우는 이 규칙의 대상이 아니다", () => {
    expect(only("interrobang-order", dialogue("WHAT!! HUH??"))).toHaveLength(0);
  });
});

describe("punctuation-run-limit", () => {
  it("네 개 연속이면 잡고 세 개로 자른 제안을 준다", () => {
    const found = only("punctuation-run-limit", dialogue("NO????"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("????");
    expect(found[0].suggestion).toBe("???");
  });

  it("물음표와 느낌표가 섞여도 연속 개수로 센다", () => {
    expect(only("punctuation-run-limit", dialogue("NO?!?!")).map((f) => f.excerpt)).toEqual([
      "?!?!",
    ]);
  });

  // ── 발화하면 안 되는 경우 ──
  it("세 개까지는 통과한다", () => {
    expect(only("punctuation-run-limit", dialogue("NO!!! WHAT??? HUH?!"))).toHaveLength(0);
  });

  it("사이에 글자가 끼면 연속이 아니다", () => {
    expect(only("punctuation-run-limit", dialogue("NO?? WAY?? HUH??"))).toHaveLength(0);
  });
});

describe("banned-source-locale-mark", () => {
  it("CJK 마침표를 major로 잡는다", () => {
    const found = only("banned-source-locale-mark", dialogue("I'M FINE。"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("。");
    expect(found[0].severity).toBe("major");
    expect(found[0].mqm).toEqual({
      dimension: "locale-conventions",
      subtype: null,
    });
  });

  it("한국어 채팅 기호 ㅠㅠ 와 ^^ 를 잡는다", () => {
    expect(only("banned-source-locale-mark", dialogue("SORRY ㅠㅠ")).map((f) => f.excerpt)).toEqual(
      ["ㅠㅠ"],
    );
    expect(only("banned-source-locale-mark", dialogue("THANKS ^^")).map((f) => f.excerpt)).toEqual([
      "^^",
    ]);
  });

  it("두 형태의 물결표와 CJK 따옴표를 잡는다", () => {
    expect(only("banned-source-locale-mark", dialogue("HEY~ HEY〜")).map((f) => f.excerpt)).toEqual(
      ["~", "〜"],
    );
    expect(only("banned-source-locale-mark", dialogue("「HI」")).map((f) => f.excerpt)).toEqual([
      "「",
      "」",
    ]);
  });

  it("allowCharacters로 특정 글자를 면제할 수 있다", () => {
    expect(
      only("banned-source-locale-mark", dialogue("HEY~"), {
        allowCharacters: ["~"],
      }),
    ).toHaveLength(0);
  });

  // ── 발화하면 안 되는 경우 ──
  it("깨끗한 영문 대사에는 발화하지 않는다", () => {
    expect(only("banned-source-locale-mark", dialogue("I'M FINE, THANKS."))).toHaveLength(0);
  });

  it("캐럿 하나는 채팅 기호가 아니다", () => {
    expect(only("banned-source-locale-mark", dialogue("2^3"))).toHaveLength(0);
  });

  it("전각 물결표 U+FF5E는 출처에 없어 일부러 빠져 있다(현재 동작 고정)", () => {
    expect(only("banned-source-locale-mark", dialogue("HEY～"))).toHaveLength(0);
  });
});

describe("banned-dialogue-mark", () => {
  it("세미콜론과 꺾쇠를 잡는다", () => {
    expect(only("banned-dialogue-mark", dialogue("GO; NOW")).map((f) => f.excerpt)).toEqual([";"]);
    expect(only("banned-dialogue-mark", dialogue("<HELLO>")).map((f) => f.excerpt)).toEqual([
      "<",
      ">",
    ]);
  });

  it("이모지를 잡고 ZWJ 결합 시퀀스는 하나로 센다", () => {
    const found = only("banned-dialogue-mark", dialogue("BYE \u{1F468}‍\u{1F469}‍\u{1F467}"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("\u{1F468}‍\u{1F469}‍\u{1F467}");
  });

  it("문장 안 콜론은 잡는다", () => {
    expect(only("banned-dialogue-mark", dialogue("LISTEN: NO.")).map((f) => f.excerpt)).toEqual([
      ":",
    ]);
  });

  it("Blambot 외국어 꺾쇠를 쓰는 작품은 allowCharacters로 면제한다", () => {
    expect(
      only("banned-dialogue-mark", dialogue("<HELLO>"), {
        allowCharacters: ["<", ">"],
      }),
    ).toHaveLength(0);
  });

  // ── 발화하면 안 되는 경우 ──
  it("시각 표기의 콜론은 통과한다(같은 가이드가 12시간제 시각을 요구한다)", () => {
    expect(only("banned-dialogue-mark", dialogue("MEET ME AT 3:30 PM."))).toHaveLength(0);
  });

  it("텍스트 표시 기본 기호(™)는 이모지로 보지 않는다", () => {
    expect(only("banned-dialogue-mark", dialogue("BRAND™ IS HERE."))).toHaveLength(0);
  });

  it("깨끗한 영문 대사에는 발화하지 않는다", () => {
    expect(only("banned-dialogue-mark", dialogue("I'M FINE, THANKS."))).toHaveLength(0);
  });
});

describe("sentence-final-punctuation", () => {
  it("구두점 없이 끝나면 마지막 낱말을 지적한다", () => {
    const found = only("sentence-final-punctuation", dialogue("HELLO WORLD"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("WORLD");
    expect(found[0].start).toBe(6);
    expect(found[0].end).toBe(11);
    expect(found[0].suggestion).toBe("WORLD.");
  });

  it("쉼표로 끝나는 것은 문장 끝이 아니다", () => {
    expect(only("sentence-final-punctuation", dialogue("HELLO,"))).toHaveLength(1);
  });

  it("줄바꿈이 있어도 마지막 낱말 기준으로 본다", () => {
    const found = only("sentence-final-punctuation", dialogue("HELLO\nWORLD"));
    expect(found[0].start).toBe(6);
  });

  // ── 발화하면 안 되는 경우 ──
  it("마침표·물음표·느낌표·말줄임표로 끝나면 통과한다", () => {
    for (const text of ["HELLO.", "WHAT?", "NO!", "WHAT?!", "WAIT…", "WAIT..."]) {
      expect(only("sentence-final-punctuation", dialogue(text))).toHaveLength(0);
    }
  });

  it("닫는 따옴표·괄호는 벗겨 내고 판정한다", () => {
    expect(only("sentence-final-punctuation", dialogue('HE SAID "GO."'))).toHaveLength(0);
    expect(only("sentence-final-punctuation", dialogue("(REALLY?)"))).toHaveLength(0);
  });

  it("Blambot 말끊김 대시로 끝나면 통과한다", () => {
    expect(only("sentence-final-punctuation", dialogue("I DIDN'T--"))).toHaveLength(0);
    expect(only("sentence-final-punctuation", dialogue("I DIDN'T—"))).toHaveLength(0);
  });

  it("빈 문자열·공백만 있는 대사에는 발화하지 않는다", () => {
    expect(only("sentence-final-punctuation", dialogue(""))).toHaveLength(0);
    expect(only("sentence-final-punctuation", dialogue("   \n "))).toHaveLength(0);
  });

  it("효과음은 이 규칙의 대상이 아니다", () => {
    expect(only("sentence-final-punctuation", sfx("BANG"))).toHaveLength(0);
  });
});

describe("sfx-single-word", () => {
  it("두 단어 효과음을 잡고 첫 단어를 제안한다", () => {
    const found = only("sfx-single-word", sfx("LEAN IN"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("LEAN IN");
    expect(found[0].suggestion).toBe("LEAN");
    expect(found[0].message).toContain("2단어");
  });

  it("세 단어여도 발견은 하나다", () => {
    const found = only("sfx-single-word", sfx("GET OUT NOW"));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("3단어");
  });

  // ── 발화하면 안 되는 경우 ──
  it("한 단어 효과음은 통과한다", () => {
    expect(only("sfx-single-word", sfx("  KRAKOOM  "))).toHaveLength(0);
    expect(only("sfx-single-word", sfx("BA-DUMP"))).toHaveLength(0);
  });

  it("대사는 이 규칙의 대상이 아니다", () => {
    expect(only("sfx-single-word", dialogue("LEAN IN"))).toHaveLength(0);
  });
});

describe("sfx-root-form", () => {
  it("-ing 형태를 원형으로 되돌리라고 지적한다", () => {
    const found = only("sfx-root-form", sfx("JUMPING"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("JUMPING");
    expect(found[0].suggestion).toBe("JUMP");
  });

  it("-ed 형태도 잡는다", () => {
    expect(only("sfx-root-form", sfx("CRASHED")).map((f) => f.suggestion)).toEqual(["CRASH"]);
  });

  it("붙은 구두점을 떼고 낱말만 본다", () => {
    const found = only("sfx-root-form", sfx("JUMPING!"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("JUMPING");
    expect(found[0].end).toBe(7);
  });

  // ── 발화하면 안 되는 경우 ──
  it("자음군 어간의 정당한 효과음은 통과한다(어간 모음 가드)", () => {
    for (const text of ["SHRED", "SPED", "SLED", "FLED", "CLING", "STING", "SWING", "SPRING"]) {
      expect(only("sfx-root-form", sfx(text))).toHaveLength(0);
    }
  });

  it("어간이 너무 짧으면 통과한다", () => {
    for (const text of ["RING", "PING", "DING", "WED", "FED"]) {
      expect(only("sfx-root-form", sfx(text))).toHaveLength(0);
    }
  });

  it("접미사가 아예 없으면 통과한다", () => {
    for (const text of ["BANG", "KRAKOOM", "THUD", "WHOOSH"]) {
      expect(only("sfx-root-form", sfx(text))).toHaveLength(0);
    }
  });

  it("알려진 오탐을 현재 동작으로 고정해 둔다(휴리스틱임을 문서화)", () => {
    // 어간 KACH / SPE 가 모음을 포함해 가드를 통과한다. 작품 단위로 이 규칙만 끌 수 있다.
    expect(only("sfx-root-form", sfx("KACHING"))).toHaveLength(1);
    expect(only("sfx-root-form", sfx("SPEED"))).toHaveLength(1);
    expect(
      lintStudioLocalizationStyle([sfx("KACHING")], {
        rules: { "sfx-root-form": false },
      }).findings,
    ).toHaveLength(0);
  });
});

describe("sfx-standalone-punctuation", () => {
  it("단독 효과음의 끝 구두점을 떼라고 지적한다", () => {
    const found = only("sfx-standalone-punctuation", sfx("BANG!"));
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toBe("!");
    expect(found[0].suggestion).toBe("BANG");
  });

  it("연속된 끝 구두점을 한 덩어리로 잡는다", () => {
    expect(only("sfx-standalone-punctuation", sfx("BANG?!")).map((f) => f.excerpt)).toEqual(["?!"]);
  });

  // ── 발화하면 안 되는 경우 ──
  it("구두점이 없으면 통과한다", () => {
    expect(only("sfx-standalone-punctuation", sfx("BANG"))).toHaveLength(0);
  });

  it("말풍선에 혼자 있지 않으면 대상이 아니다", () => {
    expect(
      only("sfx-standalone-punctuation", sfx("BANG!", { aloneInBalloon: false })),
    ).toHaveLength(0);
  });

  it("대사는 이 규칙의 대상이 아니다", () => {
    expect(only("sfx-standalone-punctuation", dialogue("BANG!"))).toHaveLength(0);
  });
});

describe("line-break-after-article", () => {
  it("관사로 끝나는 줄을 잡고 오프셋은 lines 기준으로 준다", () => {
    const found = only("line-break-after-article", laidOut(["I SAW A", "DOG."]));
    expect(found).toHaveLength(1);
    expect(found[0].spanBasis).toBe("lines");
    expect(found[0].line).toBe(0);
    expect(found[0].excerpt).toBe("A");
    expect(found[0].start).toBe(6);
    expect(found[0].end).toBe(7);
    expect(found[0].mqm).toEqual({
      dimension: "design-and-markup",
      subtype: "layout",
    });
  });

  it("an / the 도 잡고 여러 줄에서 각각 보고한다", () => {
    const found = only("line-break-after-article", laidOut(["I ATE AN", "APPLE AND THE", "PIE."]));
    expect(found.map((f) => [f.line, f.excerpt])).toEqual([
      [0, "AN"],
      [1, "THE"],
    ]);
  });

  // ── 발화하면 안 되는 경우 ──
  it("관사로 시작하는 낱말(THEY)은 관사가 아니다", () => {
    expect(only("line-break-after-article", laidOut(["THEY WENT", "HOME."]))).toHaveLength(0);
  });

  it("마지막 줄이 관사로 끝나도 뒤에 줄이 없으므로 발화하지 않는다", () => {
    expect(only("line-break-after-article", laidOut(["DOG", "AND A"]))).toHaveLength(0);
  });

  it("한 줄짜리에는 발화하지 않는다", () => {
    expect(only("line-break-after-article", laidOut(["I SAW A DOG."]))).toHaveLength(0);
  });

  it("조판 결과가 없으면 실행 자체를 하지 않는다", () => {
    const result = lintStudioLocalizationStyle([dialogue("I SAW A DOG.")], {
      rules: { "line-break-after-article": true },
    });
    expect(result.findings.filter((f) => f.ruleId === "line-break-after-article")).toHaveLength(0);
  });
});

describe("line-break-before-hyphen", () => {
  it("하이픈으로 시작하는 줄을 major로 잡는다", () => {
    const found = only("line-break-before-hyphen", laidOut(["SELF", "-DESTRUCT"]));
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(1);
    expect(found[0].severity).toBe("major");
    expect(found[0].start).toBe(5);
    expect(found[0].end).toBe(6);
  });

  it("줄 앞 공백이 있어도 오프셋을 맞춰 잡는다", () => {
    const found = only("line-break-before-hyphen", laidOut(["SELF", "  -DESTRUCT"]));
    expect(found).toHaveLength(1);
    expect(found[0].start).toBe(7);
  });

  // ── 발화하면 안 되는 경우 ──
  it("하이픈이 앞줄 끝에 남은 올바른 분철은 통과한다", () => {
    expect(only("line-break-before-hyphen", laidOut(["SELF-", "DESTRUCT"]))).toHaveLength(0);
  });

  it("이중대시로 시작하는 줄은 말끊김 표기라 통과한다", () => {
    expect(only("line-break-before-hyphen", laidOut(["WAIT", "--NO!"]))).toHaveLength(0);
  });

  it("앞줄이 구두점으로 끝나면 그 하이픈은 분철이 아니다", () => {
    expect(only("line-break-before-hyphen", laidOut(["WAIT.", "-NO"]))).toHaveLength(0);
  });

  it("첫 줄이 하이픈으로 시작하는 것은 앞줄이 없으므로 대상이 아니다", () => {
    expect(only("line-break-before-hyphen", laidOut(["-NO", "WAY."]))).toHaveLength(0);
  });

  it("하이픈 뒤에 글자가 없으면 분철이 아니다", () => {
    expect(only("line-break-before-hyphen", laidOut(["SELF", "- "]))).toHaveLength(0);
  });
});

describe("balloon-silhouette-hourglass", () => {
  it("가운데가 잘록한 줄을 잡는다", () => {
    const found = only("balloon-silhouette-hourglass", laidOut(["ABCD", "AB", "ABCD"]));
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(1);
    expect(found[0].excerpt).toBe("AB");
  });

  it("잘록한 지점마다 보고한다", () => {
    const found = only(
      "balloon-silhouette-hourglass",
      laidOut(["ABCDE", "AB", "ABCDE", "A", "ABCDE"]),
    );
    expect(found.map((f) => f.line)).toEqual([1, 3]);
  });

  it("주입한 폭 측정기를 쓴다", () => {
    // 글자 수로는 평평하지만 px 폭으로는 가운데가 좁은 경우.
    const widths: Record<string, number> = { AAA: 30, III: 9, BBB: 30 };
    const found = only("balloon-silhouette-hourglass", laidOut(["AAA", "III", "BBB"]), {
      measureLineWidth: (line) => widths[line] ?? line.length,
    });
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(1);
  });

  it("허용치를 주면 얕은 잘록함은 넘어간다", () => {
    expect(
      only("balloon-silhouette-hourglass", laidOut(["ABCD", "ABC", "ABCD"]), {
        silhouetteTolerance: 1,
      }),
    ).toHaveLength(0);
  });

  // ── 발화하면 안 되는 경우 ──
  it("다이아몬드(가운데가 가장 긴 모양)는 통과한다", () => {
    expect(only("balloon-silhouette-hourglass", laidOut(["AB", "ABCDEF", "AB"]))).toHaveLength(0);
  });

  it("한 방향으로 좁아지는 모양은 통과한다", () => {
    expect(only("balloon-silhouette-hourglass", laidOut(["ABCD", "ABC", "AB"]))).toHaveLength(0);
    expect(only("balloon-silhouette-hourglass", laidOut(["AB", "ABC", "ABCD"]))).toHaveLength(0);
  });

  it("폭이 같으면 통과한다", () => {
    expect(only("balloon-silhouette-hourglass", laidOut(["ABC", "ABC", "ABC"]))).toHaveLength(0);
  });

  it("두 줄 이하에는 발화하지 않는다", () => {
    expect(only("balloon-silhouette-hourglass", laidOut(["ABCD", "AB"]))).toHaveLength(0);
  });
});

describe("규칙 카탈로그와 MQM 좌표", () => {
  it("규칙 id는 중복되지 않는다", () => {
    const ids = STUDIO_LOCALIZATION_STYLE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 규칙이 MQM 차원을 갖는다", () => {
    for (const rule of STUDIO_LOCALIZATION_STYLE_RULES) {
      expect(rule.mqm.dimension.length).toBeGreaterThan(0);
    }
  });

  it("레이아웃 규칙만 출처에 이름이 실린 하위유형 Layout 을 쓴다", () => {
    for (const rule of STUDIO_LOCALIZATION_STYLE_RULES) {
      if (rule.requiresLayout) {
        expect(rule.mqm).toEqual({
          dimension: "design-and-markup",
          subtype: "layout",
        });
      } else {
        // 나머지 차원의 하위유형 이름은 1차 출처에 없어 일부러 비워 뒀다.
        expect(rule.mqm.subtype).toBeNull();
      }
    }
  });

  it("발견은 카탈로그의 MQM 좌표를 그대로 들고 나온다", () => {
    expect(only("allcaps-dialogue", dialogue("go"))[0].mqm).toEqual({
      dimension: "style",
      subtype: null,
    });
    expect(only("ellipsis-three-dots", dialogue("WAIT.."))[0].mqm).toEqual({
      dimension: "linguistic-conventions",
      subtype: null,
    });
  });

  it("id로 규칙 메타데이터를 찾을 수 있다", () => {
    expect(studioLocalizationStyleRule("allcaps-dialogue")?.label).toBe("대사 대문자");
    expect(studioLocalizationStyleRule("nope" as StudioLocalizationStyleRuleId)).toBeUndefined();
  });
});

describe("집계와 토글", () => {
  it("심각도별 개수와 룰셋 버전을 함께 낸다", () => {
    const result = lintStudioLocalizationStyle([dialogue("go。")]);
    expect(result.basis).toBe("webtoon-en-lettering-guide");
    expect(result.rulesetVersion).toBe(STUDIO_LOCALIZATION_STYLE_RULESET_VERSION);
    expect(result.counts.minor).toBeGreaterThan(0);
    expect(result.counts.major).toBe(1); // 원문 로케일 기호
    expect(result.counts.critical).toBe(0);
    expect(result.counts.neutral).toBe(0);
  });

  it("실행/통과/미실행 규칙 수가 카탈로그 전체와 맞아떨어진다", () => {
    const result = lintStudioLocalizationStyle([dialogue("HELLO.")]);
    expect(result.checkedRuleCount + result.skippedRuleCount).toBe(
      STUDIO_LOCALIZATION_STYLE_RULES.length,
    );
    expect(result.passedRuleCount).toBe(result.checkedRuleCount);
    expect(result.findings).toHaveLength(0);
  });

  it("조판 결과가 없으면 레이아웃 규칙 세 개가 미실행으로 집계된다", () => {
    const withLines = lintStudioLocalizationStyle([laidOut(["HELLO", "WORLD."])]);
    const withoutLines = lintStudioLocalizationStyle([dialogue("HELLO WORLD.")]);
    expect(withLines.checkedRuleCount - withoutLines.checkedRuleCount).toBe(3);
  });

  it("규칙을 전부 끄면 발견이 없고 전부 미실행으로 잡힌다", () => {
    const rules: Partial<
      Record<StudioLocalizationStyleRuleId, StudioLocalizationStyleRuleSetting>
    > = {};
    for (const meta of STUDIO_LOCALIZATION_STYLE_RULES) rules[meta.id] = false;
    const result = lintStudioLocalizationStyle([dialogue("go。!?????")], {
      rules,
    });
    expect(result.findings).toHaveLength(0);
    expect(result.checkedRuleCount).toBe(0);
    expect(result.skippedRuleCount).toBe(STUDIO_LOCALIZATION_STYLE_RULES.length);
  });

  it("규칙별로 심각도를 덮을 수 있다", () => {
    const result = lintStudioLocalizationStyle([dialogue("go")], {
      rules: { "allcaps-dialogue": { severity: "critical" } },
    });
    const allcaps = result.findings.filter((f) => f.ruleId === "allcaps-dialogue");
    expect(allcaps).toHaveLength(1);
    expect(allcaps[0].severity).toBe("critical");
  });

  it("심각도만 덮어도 규칙은 켜진 상태를 유지한다", () => {
    const result = lintStudioLocalizationStyle([dialogue("go")], {
      rules: { "allcaps-dialogue": { enabled: true, severity: "neutral" } },
    });
    expect(result.counts.neutral).toBe(1);
  });

  it("발견은 문서 순서(단위 순 → 카탈로그 순 → 오프셋 순)로 나온다", () => {
    const result = lintStudioLocalizationStyle([
      { id: "a", text: "go WAIT.." },
      { id: "b", text: "no WAIT!?" },
    ]);
    expect(result.findings.map((f) => f.unitId)).toEqual([
      ...result.findings.filter((f) => f.unitId === "a").map(() => "a"),
      ...result.findings.filter((f) => f.unitId === "b").map(() => "b"),
    ]);
    const first = result.findings.filter((f) => f.unitId === "a").map((f) => f.ruleId);
    expect(first.indexOf("allcaps-dialogue")).toBeLessThan(first.indexOf("ellipsis-three-dots"));
  });
});

describe("로케일 게이트와 순수성", () => {
  it("영문 로케일 판정", () => {
    expect(isEnglishLocalizationTarget(undefined)).toBe(true);
    expect(isEnglishLocalizationTarget("")).toBe(true);
    expect(isEnglishLocalizationTarget("en")).toBe(true);
    expect(isEnglishLocalizationTarget("en-US")).toBe(true);
    expect(isEnglishLocalizationTarget("EN_GB")).toBe(true);
    expect(isEnglishLocalizationTarget("ko")).toBe(false);
    expect(isEnglishLocalizationTarget("eng")).toBe(false);
    expect(isEnglishLocalizationTarget("fr-CA")).toBe(false);
  });

  it("영문이 아닌 단위는 통째로 건너뛴다", () => {
    const result = lintStudioLocalizationStyle([
      dialogue("bonjour tout le monde", { targetLocale: "fr" }),
    ]);
    expect(result.findings).toHaveLength(0);
    expect(result.skippedUnitCount).toBe(1);
  });

  it("입력을 변형하지 않는다", () => {
    const unit = Object.freeze({
      id: "u1",
      text: "go WAIT..",
      lines: Object.freeze(["ABCD", "AB", "ABCD"]),
    }) satisfies StudioLocalizationStyleUnit;
    const units = Object.freeze([unit]);
    const snapshot = JSON.parse(JSON.stringify(units)) as unknown;
    lintStudioLocalizationStyle(units);
    expect(JSON.parse(JSON.stringify(units))).toEqual(snapshot);
  });

  it("같은 입력에 같은 결과를 낸다", () => {
    const units = [dialogue("go WAIT..。"), sfx("JUMPING!")];
    expect(lintStudioLocalizationStyle(units)).toEqual(lintStudioLocalizationStyle(units));
  });

  it("빈 입력에도 안전하다", () => {
    const result = lintStudioLocalizationStyle([]);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedRuleCount).toBe(0);
    expect(result.skippedRuleCount).toBe(STUDIO_LOCALIZATION_STYLE_RULES.length);
  });

  it("빈 문자열 단위는 텍스트 규칙을 돌리지 않는다", () => {
    const result = lintStudioLocalizationStyle([dialogue("   ")]);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedRuleCount).toBe(0);
  });
});

describe("MQM 모듈과의 접합", () => {
  it("모든 규칙의 차원 id 가 MQM 카탈로그에 실재한다", () => {
    for (const rule of STUDIO_LOCALIZATION_STYLE_RULES) {
      expect(STUDIO_MQM_DIMENSION_IDS).toContain(rule.mqm.dimension);
    }
  });

  it("서브타입을 쓰는 규칙은 그 서브타입이 같은 차원에 속한다", () => {
    const known = new Set(STUDIO_MQM_SUBTYPES.map((subtype) => subtype.id));
    for (const rule of STUDIO_LOCALIZATION_STYLE_RULES) {
      if (rule.mqm.subtype === null) continue;
      expect(known.has(rule.mqm.subtype)).toBe(true);
      expect(studioMqmSubtype(rule.mqm.subtype).dimension).toBe(rule.mqm.dimension);
    }
  });

  it("서브타입이 있는 발견은 서브타입만 넘긴다(MQM 입력 유니온이 둘 다 주는 것을 막는다)", () => {
    const finding = only("line-break-after-article", laidOut(["I SAW A", "DOG."]))[0];
    const error = studioLocalizationStyleFindingToMqmError(finding);
    expect(error).toMatchObject({ subtype: "layout", severity: "minor", cueId: "u1" });
    expect("dimension" in error).toBe(false);
  });

  it("서브타입이 없는 발견은 차원만 넘긴다", () => {
    const finding = only("banned-source-locale-mark", dialogue("FINE。"))[0];
    const error = studioLocalizationStyleFindingToMqmError(finding);
    expect(error).toMatchObject({ dimension: "locale-conventions", severity: "major" });
    expect("subtype" in error).toBe(false);
  });

  it("증거에 규칙 id 와 스팬을 실어 보낸다", () => {
    const finding = only("interrobang-order", dialogue("WHAT!?"))[0];
    const error = studioLocalizationStyleFindingToMqmError(finding);
    expect(error.evidence).toEqual({
      ruleId: "interrobang-order",
      spanBasis: "text",
      start: 4,
      end: 6,
      excerpt: "!?",
    });
  });

  it("페이지/컷 번호를 발견과 MQM 오류에 그대로 흘려보낸다", () => {
    const finding = only("interrobang-order", dialogue("WHAT!?", { page: 3, panel: 2 }))[0];
    expect([finding.page, finding.panel]).toEqual([3, 2]);
    expect(studioLocalizationStyleFindingToMqmError(finding)).toMatchObject({ page: 3, panel: 2 });
  });

  it("0·음수 페이지 번호는 '모름'으로 떨어뜨린다", () => {
    const finding = only("interrobang-order", dialogue("WHAT!?", { page: 0, panel: -1 }))[0];
    expect([finding.page, finding.panel]).toEqual([null, null]);
  });

  it("페이지 정보가 없으면 null 이다", () => {
    const finding = only("interrobang-order", dialogue("WHAT!?"))[0];
    expect([finding.page, finding.panel]).toEqual([null, null]);
  });

  it("변환한 발견을 MQM 채점기가 실제로 받아 점수를 낸다", () => {
    const findings = lintStudioLocalizationStyle([dialogue("go。", { page: 1 })]).findings;
    expect(findings.length).toBeGreaterThan(0);
    const scored = scoreStudioMqmErrors(
      findings.map(studioLocalizationStyleFindingToMqmError),
      // 웹툰 원고는 단어 분모가 성립하지 않으므로 MQM 모듈이 권하는 문자 분모를 쓴다.
      studioMqmDenominator(["go。"], "characters"),
    );
    // major(5) 하나가 반드시 섞여 있으므로 APT 는 5 이상이고 품질 점수는 100 미만이다.
    expect(scored.errors.length).toBe(findings.length);
    expect(scored.apt).toBeGreaterThanOrEqual(5);
    expect(scored.counts.major).toBe(1);
    expect(scored.qualityScore).toBeLessThan(100);
    expect(scored.byDimension.map((rollup) => rollup.dimension)).toContain("locale-conventions");
  });
});
