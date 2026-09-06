import { describe, expect, it } from "vitest";

import {
  applyDialogueTranslations,
  buildTranslationPrompt,
  chunkDialogueItemsForTranslation,
  dialogueLocalesForPages,
  dialogueTranslationCoverage,
  localeLabel,
  parseTranslationResponse,
  switchDialogueLocale,
  DIALOGUE_LOCALE_PRESETS,
  SOURCE_LOCALE,
  type DialogueTranslatePageLike,
} from "./studio-dialogue-translate";

import type { DialogueBatchItem } from "./studio-dialogue-batch";

function item(over: Partial<DialogueBatchItem> = {}): DialogueBatchItem {
  return {
    id: "b1",
    pageId: "p1",
    pageIndex: 0,
    elType: "bubble",
    text: "안녕",
    hidden: false,
    locked: false,
    ...over,
  };
}

function makeItems(n: number, textLength = 4): DialogueBatchItem[] {
  return Array.from({ length: n }, (_, i) => item({ id: `b${i}`, text: "가".repeat(textLength) }));
}

function makePage(over: Partial<DialogueTranslatePageLike> = {}): DialogueTranslatePageLike {
  return {
    id: "p1",
    elements: [
      { id: "b1", type: "bubble", text: "안녕? 민수야" },
      { id: "t1", type: "text", text: "민수의 아침" },
      { id: "s1", type: "sticker", text: "💥" }, // 대사 요소가 아님 — 통계/전환 대상 제외 확인용.
    ],
    ...over,
  };
}

describe("localeLabel/DIALOGUE_LOCALE_PRESETS", () => {
  it("프리셋 코드는 한글 라벨을 반환한다", () => {
    expect(localeLabel("en")).toBe("영어");
    expect(localeLabel("ja")).toBe("일본어");
  });

  it("프리셋에 없는 코드는 코드 자체를 라벨로 되돌린다(자유 입력 지원)", () => {
    expect(localeLabel("pt-BR")).toBe("pt-BR");
  });

  it("프리셋 목록은 비어 있지 않다", () => {
    expect(DIALOGUE_LOCALE_PRESETS.length).toBeGreaterThan(0);
  });
});

describe("chunkDialogueItemsForTranslation", () => {
  it("빈 배열은 빈 청크 목록을 반환한다", () => {
    expect(chunkDialogueItemsForTranslation([])).toEqual([]);
  });

  it("정확히 maxItems 개면 청크 1개, 하나 더 넘으면 청크 2개(항목수 경계)", () => {
    const exact = chunkDialogueItemsForTranslation(makeItems(40), { maxChars: 999999 });
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(40);

    const overflow = chunkDialogueItemsForTranslation(makeItems(41), { maxChars: 999999 });
    expect(overflow).toHaveLength(2);
    expect(overflow[0]).toHaveLength(40);
    expect(overflow[1]).toHaveLength(1);
  });

  it("항목당 text 가 길면 항목수보다 먼저 문자수 상한에서 잘린다", () => {
    // 항목 3개, 각 3000자, maxChars=6000 → 2개까지는 담기고(6000, 경계는 허용) 3번째부터 새 청크.
    const items = makeItems(3, 3000);
    const chunks = chunkDialogueItemsForTranslation(items, { maxItems: 40, maxChars: 6000 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(1);
  });

  it("청크를 이어 붙이면 원본 아이템 순서·내용이 그대로 보존된다", () => {
    const items = makeItems(85);
    const chunks = chunkDialogueItemsForTranslation(items);
    expect(chunks.flat()).toEqual(items);
  });

  it("한 항목의 텍스트 자체가 maxChars 보다 길어도 그 항목만으로 청크를 만든다(더 쪼개지 않음)", () => {
    const huge = item({ id: "huge", text: "가".repeat(10000) });
    const chunks = chunkDialogueItemsForTranslation([huge], { maxChars: 6000 });
    expect(chunks).toEqual([[huge]]);
  });

  it("maxItems 가 0 이하로 들어와도 빈 청크를 만들지 않는다(최소 1로 방어)", () => {
    const items = makeItems(3);
    const zero = chunkDialogueItemsForTranslation(items, { maxItems: 0 });
    expect(zero.every((c) => c.length > 0)).toBe(true);
    expect(zero.flat()).toEqual(items);

    const negative = chunkDialogueItemsForTranslation(items, { maxItems: -5 });
    expect(negative.every((c) => c.length > 0)).toBe(true);
    expect(negative.flat()).toEqual(items);
  });
});

describe("buildTranslationPrompt", () => {
  it("시스템 프롬프트에 대상 언어 라벨이 포함된다", () => {
    const { system } = buildTranslationPrompt([{ id: "a", text: "hi" }], "영어", "");
    expect(system).toContain("영어");
  });

  it("glossary 가 있으면 시스템 프롬프트에 포함되고, 빈 문자열이면 생략된다", () => {
    const withGlossary = buildTranslationPrompt([{ id: "a", text: "hi" }], "영어", "민수: Minsu");
    expect(withGlossary.system).toContain("민수: Minsu");

    const withoutGlossary = buildTranslationPrompt([{ id: "a", text: "hi" }], "영어", "   ");
    expect(withoutGlossary.system).not.toContain("용어집");
  });

  it("유저 메시지는 각 항목의 id/text 를 담은 유효한 JSON 배열이다", () => {
    const items = [
      { id: "a", text: "안녕" },
      { id: "b", text: "잘가" },
    ];
    const { user } = buildTranslationPrompt(items, "일본어", "");
    expect(JSON.parse(user)).toEqual(items);
  });
});

describe("parseTranslationResponse", () => {
  it("정상 JSON 배열을 전부 매핑한다", () => {
    const raw = '[{"id":"a","text":"hello"},{"id":"b","text":"bye"}]';
    const result = parseTranslationResponse(raw, ["a", "b"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.translations.get("a")).toBe("hello");
      expect(result.translations.get("b")).toBe("bye");
    }
  });

  it("코드펜스로 감싼 응답도 배열만 뽑아 파싱한다", () => {
    const raw = '여기 번역 결과예요:\n```json\n[{"id":"a","text":"hello"}]\n```\n확인해주세요.';
    const result = parseTranslationResponse(raw, ["a"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.translations.get("a")).toBe("hello");
  });

  it("요청하지 않은 id 는 환각으로 간주해 무시한다", () => {
    const raw = '[{"id":"a","text":"hello"},{"id":"ghost","text":"???"}]';
    const result = parseTranslationResponse(raw, ["a"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.translations.has("a")).toBe(true);
      expect(result.translations.has("ghost")).toBe(false);
    }
  });

  it("배열 자체가 없는 텍스트는 ok:false", () => {
    const result = parseTranslationResponse("죄송하지만 번역할 수 없습니다.", ["a"]);
    expect(result.ok).toBe(false);
  });

  it("부분(일부 id만) 응답도 ok:true 이고, 나머지는 Map 에 없다", () => {
    const raw = '[{"id":"a","text":"hello"}]';
    const result = parseTranslationResponse(raw, ["a", "b"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.translations.get("a")).toBe("hello");
      expect(result.translations.has("b")).toBe(false);
    }
  });

  it("깨진 JSON 배열(짝이 안 맞음)은 ok:false", () => {
    const result = parseTranslationResponse('[{"id":"a","text":"hello"}', ["a"]);
    expect(result.ok).toBe(false);
  });
});

describe("applyDialogueTranslations", () => {
  it("신규 병합 시 SOURCE_LOCALE 을 el.text 로 자동 시딩한다", () => {
    const pages = [makePage()];
    const next = applyDialogueTranslations(pages, [{ id: "b1", pageId: "p1", text: "Hi Minsu" }], "en");
    expect(next[0].dialogueI18n?.b1).toEqual({ source: "안녕? 민수야", en: "Hi Minsu" });
  });

  it("이미 SOURCE_LOCALE 이 있으면 재시딩하지 않는다(최초 스냅샷 보존)", () => {
    const pages: DialogueTranslatePageLike[] = [
      { ...makePage(), dialogueI18n: { b1: { source: "원본 스냅샷" } } },
    ];
    const next = applyDialogueTranslations(pages, [{ id: "b1", pageId: "p1", text: "Hi" }], "en");
    expect(next[0].dialogueI18n?.b1.source).toBe("원본 스냅샷");
    expect(next[0].dialogueI18n?.b1.en).toBe("Hi");
  });

  it("대상 없는 페이지는 참조 동일(no-op)을 유지한다", () => {
    const pages = [makePage()];
    const next = applyDialogueTranslations(pages, [{ id: "nope", pageId: "다른페이지", text: "x" }], "en");
    expect(next).toBe(pages);
  });

  it("결과가 비어 있으면 즉시 참조 동일을 반환한다", () => {
    const pages = [makePage()];
    expect(applyDialogueTranslations(pages, [], "en")).toBe(pages);
  });

  it("여러 로케일을 반복 적용해도 기존 로케일 데이터가 보존된다(병합이지 교체가 아님)", () => {
    const pages = [makePage()];
    const afterEn = applyDialogueTranslations(pages, [{ id: "b1", pageId: "p1", text: "Hi" }], "en");
    const afterJa = applyDialogueTranslations(afterEn, [{ id: "b1", pageId: "p1", text: "こんにちは" }], "ja");
    expect(afterJa[0].dialogueI18n?.b1).toEqual({
      source: "안녕? 민수야",
      en: "Hi",
      ja: "こんにちは",
    });
  });

  it("동일한 번역을 재적용하면(실질 변경 없음) 참조가 유지된다", () => {
    const pages = [makePage()];
    const once = applyDialogueTranslations(pages, [{ id: "b1", pageId: "p1", text: "Hi" }], "en");
    const twice = applyDialogueTranslations(once, [{ id: "b1", pageId: "p1", text: "Hi" }], "en");
    expect(twice).toBe(once);
  });
});

describe("switchDialogueLocale", () => {
  it("번역이 있는 요소만 el.text 를 바꾸고, 없는 요소는 그대로 둔다", () => {
    const pages: DialogueTranslatePageLike[] = [
      {
        ...makePage(),
        dialogueI18n: { b1: { source: "안녕? 민수야", en: "Hi Minsu" } }, // t1 은 번역 없음.
      },
    ];
    const next = switchDialogueLocale(pages, "en");
    const b1 = next[0].elements.find((e) => e.id === "b1");
    const t1 = next[0].elements.find((e) => e.id === "t1");
    expect(b1?.text).toBe("Hi Minsu");
    expect(t1?.text).toBe("민수의 아침"); // 번역 없는 요소는 원문 그대로.
  });

  it("SOURCE_LOCALE 로 전환하면 원문이 복원된다", () => {
    const pages: DialogueTranslatePageLike[] = [
      {
        ...makePage({ elements: [{ id: "b1", type: "bubble", text: "Hi Minsu" }] }),
        dialogueI18n: { b1: { source: "안녕? 민수야", en: "Hi Minsu" } },
      },
    ];
    const next = switchDialogueLocale(pages, SOURCE_LOCALE);
    expect(next[0].elements[0].text).toBe("안녕? 민수야");
  });

  it("존재하지 않는 로케일을 지정하면 전체 참조 동일(no-op)을 반환한다", () => {
    const pages: DialogueTranslatePageLike[] = [
      { ...makePage(), dialogueI18n: { b1: { source: "안녕? 민수야", en: "Hi Minsu" } } },
    ];
    expect(switchDialogueLocale(pages, "zz")).toBe(pages);
  });

  it("dialogueI18n 이 아예 없는 페이지는 참조 동일을 유지한다", () => {
    const pages = [makePage()];
    expect(switchDialogueLocale(pages, "en")).toBe(pages);
  });
});

describe("dialogueLocalesForPages / dialogueTranslationCoverage", () => {
  it("빈 문서는 빈 배열/0 커버리지를 반환한다", () => {
    expect(dialogueLocalesForPages([])).toEqual([]);
    expect(dialogueTranslationCoverage([], "en")).toEqual({ total: 0, translated: 0 });
  });

  it("등장 순서대로 로케일 코드를 모으고(SOURCE_LOCALE 제외), 여러 페이지에 흩어진 커버리지를 합산한다", () => {
    const pages: DialogueTranslatePageLike[] = [
      { ...makePage(), dialogueI18n: { b1: { source: "안녕", ja: "こんにちは" } } },
      {
        ...makePage({ id: "p2", elements: [{ id: "b2", type: "bubble", text: "잘가" }] }),
        dialogueI18n: { b2: { source: "잘가", en: "Bye", ja: "さようなら" } },
      },
    ];
    expect(dialogueLocalesForPages(pages)).toEqual(["ja", "en"]);
    // p1: b1(대사 있음, ja 번역 있음) + t1(대사, 번역 없음) = total 2, translated 1.
    // p2: b2(대사, ja 번역 있음) = total 1, translated 1.
    expect(dialogueTranslationCoverage(pages, "ja")).toEqual({ total: 3, translated: 2 });
  });
});
