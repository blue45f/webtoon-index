import { describe, expect, it } from "vitest";

import {
  adjacentEditableDialogueItem,
  applyDialogueTextEdit,
  applyReplacePlanToPages,
  collectDialogueItems,
  countOccurrences,
  dialogueExcerpt,
  dialogueItemTypeLabel,
  filterDialogueItems,
  isDialogueElement,
  planDialogueReplace,
  replaceOccurrences,
  type DialogueElementLike,
  type DialoguePageLike,
} from "./studio-dialogue-batch";

import type { El } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";

// StudioPage El 실제 형태를 흉내낸 픽스처 — bubble/text 외 타입은 목록에서 제외돼야 한다.
function makePages(): DialoguePageLike[] {
  return [
    {
      id: "p1",
      elements: [
        { id: "f1", type: "frame" },
        { id: "b1", type: "bubble", variant: "speech", text: "안녕? 민수야" },
        { id: "t1", type: "text", text: "민수의 아침" },
        { id: "s1", type: "sticker", text: "💥" },
        { id: "b2", type: "bubble", variant: "thought", text: "민수... 왜 저래", locked: true },
      ],
    },
    {
      id: "p2",
      elements: [
        { id: "b3", type: "bubble", variant: "box", text: "다음 날\n민수네 집" },
        { id: "d1", type: "draw" },
        { id: "b4", type: "bubble", variant: "speech", text: "MINSU!", groupId: "g1" },
      ],
      groups: [{ id: "g1", name: "그룹 1", locked: true }],
    },
  ];
}

describe("studio-dialogue-batch 목록화", () => {
  it("isDialogueElement 는 문자열 text 를 가진 bubble/text 만 통과시킨다", () => {
    expect(isDialogueElement({ id: "a", type: "bubble", text: "hi" })).toBe(true);
    expect(isDialogueElement({ id: "a", type: "text", text: "" })).toBe(true);
    expect(isDialogueElement({ id: "a", type: "sticker", text: "💥" })).toBe(false);
    expect(isDialogueElement({ id: "a", type: "frame" })).toBe(false);
    expect(isDialogueElement({ id: "a", type: "bubble" })).toBe(false);
  });

  it("collectDialogueItems 는 페이지·요소 순서를 유지하며 bubble/text 만 모은다", () => {
    const items = collectDialogueItems(makePages());
    expect(items.map((i) => i.id)).toEqual(["b1", "t1", "b2", "b3", "b4"]);
    expect(items[0]).toMatchObject({ pageId: "p1", pageIndex: 0, elType: "bubble", variant: "speech" });
    expect(items[1]).toMatchObject({ elType: "text", variant: undefined });
    expect(items[3]).toMatchObject({ pageId: "p2", pageIndex: 1 });
  });

  it("페이지 안에서는 컷의 y/x와 요소의 y/x를 실제 읽기 순서로 사용한다", () => {
    const items = collectDialogueItems([
      {
        id: "p1",
        elements: [
          // z-order는 의도적으로 읽기 순서와 반대로 둔다.
          { id: "right-bottom", type: "bubble", text: "4", x: 360, y: 380, width: 80, height: 40 },
          { id: "frame-bottom", type: "frame", x: 0, y: 300, width: 500, height: 300 },
          { id: "left-top-second", type: "text", text: "2", x: 80, y: 120, width: 80 },
          { id: "frame-right", type: "frame", x: 260, y: 0, width: 240, height: 260 },
          { id: "right-top", type: "bubble", text: "3", x: 320, y: 80, width: 80, height: 40 },
          { id: "frame-left", type: "frame", x: 0, y: 0, width: 240, height: 260 },
          { id: "left-top-first", type: "bubble", text: "1", x: 40, y: 40, width: 80, height: 40 },
        ],
      },
      {
        id: "p2",
        elements: [{ id: "next-page", type: "bubble", text: "5", x: 0, y: 0 }],
      },
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "left-top-first",
      "left-top-second",
      "right-top",
      "right-bottom",
      "next-page",
    ]);
  });

  it("명시 frameId/order를 해당 컷 안에서 우선하고 동률은 위치와 원래 index로 안정 정렬한다", () => {
    const items = collectDialogueItems([
      {
        id: "p1",
        elements: [
          { id: "frame", type: "frame", x: 0, y: 0, width: 300, height: 300 },
          { id: "source-second", type: "bubble", text: "동률2", x: 90, y: 80, order: 2 },
          { id: "explicit-first", type: "text", text: "우선", x: 250, y: 250, order: 1 },
          { id: "source-first", type: "bubble", text: "동률1", x: 90, y: 80, order: 2 },
          { id: "spatial-only", type: "bubble", text: "공간", x: 10, y: 10 },
          { id: "linked", type: "text", text: "연결", x: 900, y: 900, frameId: "frame", order: 0 },
        ],
      },
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "linked",
      "explicit-first",
      "source-second",
      "source-first",
      "spatial-only",
    ]);
  });

  it("collectDialogueItems 는 유효 잠금/숨김(그룹 포함)을 계산한다", () => {
    const items = collectDialogueItems(makePages());
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("b2")?.locked).toBe(true); // 요소 자체 잠금
    expect(byId.get("b4")?.locked).toBe(true); // 소속 그룹 잠금
    expect(byId.get("b1")?.locked).toBe(false);
    expect(byId.get("b1")?.hidden).toBe(false);
  });

  it("dialogueItemTypeLabel 은 말풍선 종류 라벨을 BUBBLE_VARIANTS 와 일치시킨다", () => {
    expect(dialogueItemTypeLabel({ elType: "bubble", variant: "speech" })).toBe("말풍선·말하기");
    expect(dialogueItemTypeLabel({ elType: "bubble", variant: "thought" })).toBe("말풍선·생각");
    expect(dialogueItemTypeLabel({ elType: "bubble", variant: "box" })).toBe("말풍선·내레이션");
    expect(dialogueItemTypeLabel({ elType: "bubble", variant: "없는종류" })).toBe("말풍선");
    expect(dialogueItemTypeLabel({ elType: "text", variant: undefined })).toBe("텍스트");
  });

  it("dialogueExcerpt 는 개행을 접고 길면 말줄임한다", () => {
    expect(dialogueExcerpt("다음 날\n민수네 집")).toBe("다음 날 / 민수네 집");
    expect(dialogueExcerpt("가나다라마바사", 5)).toBe("가나다라…");
    expect(dialogueExcerpt("  공백  ")).toBe("공백");
  });

  it("filterDialogueItems 는 본문·종류 라벨을 대소문자 무시로 검색한다", () => {
    const items = collectDialogueItems(makePages());
    expect(filterDialogueItems(items, "민수").map((i) => i.id)).toEqual(["b1", "t1", "b2", "b3"]);
    expect(filterDialogueItems(items, "minsu").map((i) => i.id)).toEqual(["b4"]);
    expect(filterDialogueItems(items, "내레이션").map((i) => i.id)).toEqual(["b3"]);
    expect(filterDialogueItems(items, "  ").map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(filterDialogueItems(items, "없는대사")).toEqual([]);
  });

  it("adjacentEditableDialogueItem 은 현재 읽기 순서에서 잠긴 대사를 건너뛴다", () => {
    const items = collectDialogueItems(makePages());
    expect(adjacentEditableDialogueItem(items, "t1", "next")?.id).toBe("b3");
    expect(adjacentEditableDialogueItem(items, "b3", "previous")?.id).toBe("t1");
    expect(adjacentEditableDialogueItem(items, "b3", "next")).toBeNull();
    expect(adjacentEditableDialogueItem(items, "missing", "next")).toBeNull();
  });
});

describe("studio-dialogue-batch 치환 코어", () => {
  it("countOccurrences 는 비중첩 매치를 대소문자 옵션대로 센다", () => {
    expect(countOccurrences("Aa aa AA", "aa")).toBe(3);
    expect(countOccurrences("Aa aa AA", "aa", true)).toBe(1);
    expect(countOccurrences("aaa", "aa")).toBe(1); // 비중첩(표준 찾아바꾸기 의미론)
    expect(countOccurrences("무엇이든", "")).toBe(0);
  });

  it("replaceOccurrences 는 정규식 메타문자를 리터럴로 다룬다", () => {
    expect(replaceOccurrences("왜? 진짜?", "?", "!").text).toBe("왜! 진짜!");
    expect(replaceOccurrences("a.b a.b", "a.b", "x").text).toBe("x x");
    expect(replaceOccurrences("(웃음)", "(웃음)", "(폭소)").text).toBe("(폭소)");
  });

  it("replaceOccurrences 는 바꾸기 문자열의 $ 패턴을 해석하지 않는다", () => {
    expect(replaceOccurrences("가격", "가격", "$&100").text).toBe("$&100");
    expect(replaceOccurrences("x", "x", "$1").text).toBe("$1");
  });
});

describe("planDialogueReplace", () => {
  it("전체 페이지에서 잠긴 요소를 제외하고 계획을 만든다", () => {
    const plan = planDialogueReplace(makePages(), "민수", "지영");
    expect(plan.pages.map((p) => p.pageId)).toEqual(["p1", "p2"]);
    expect(plan.pages[0].patches.map((p) => p.id)).toEqual(["b1", "t1"]); // b2 는 잠김
    expect(plan.pages[1].patches.map((p) => p.id)).toEqual(["b3"]); // b4 는 그룹 잠김(+대상 텍스트 없음)
    expect(plan.totalCount).toBe(3);
    expect(plan.elementCount).toBe(3);
    expect(plan.pageCount).toBe(2);
    expect(plan.lockedSkipped).toBe(1); // b2 만 매치 보유 + 잠김 (b4 는 "민수" 미포함)
    expect(plan.pages[0].patches[0]).toEqual({
      id: "b1",
      text: "안녕? 지영야",
      prevText: "안녕? 민수야",
      count: 1,
    });
  });

  it("includeLocked 면 잠긴 요소도 계획에 포함한다", () => {
    const plan = planDialogueReplace(makePages(), "민수", "지영", { includeLocked: true });
    expect(plan.pages[0].patches.map((p) => p.id)).toEqual(["b1", "t1", "b2"]);
    expect(plan.lockedSkipped).toBe(0);
  });

  it("scope=current 는 기준 페이지만 대상으로 한다", () => {
    const plan = planDialogueReplace(makePages(), "민수", "지영", {
      scope: "current",
      currentPageId: "p2",
    });
    expect(plan.pages.map((p) => p.pageId)).toEqual(["p2"]);
    expect(plan.totalCount).toBe(1);
    // 기준 페이지 미지정이면 빈 계획(결정적)
    expect(planDialogueReplace(makePages(), "민수", "지영", { scope: "current" }).totalCount).toBe(0);
  });

  it("대소문자 구분 옵션이 매치를 바꾼다", () => {
    const pages = makePages();
    // 기본(무시): MINSU 매치 — 하지만 b4 는 그룹 잠김이라 skip 집계로 빠진다.
    const defaults = planDialogueReplace(pages, "minsu", "JY");
    expect(defaults.totalCount).toBe(0);
    expect(defaults.lockedSkipped).toBe(1);
    const insensitive = planDialogueReplace(pages, "minsu", "JY", { includeLocked: true });
    expect(insensitive.totalCount).toBe(1);
    const sensitive = planDialogueReplace(pages, "minsu", "JY", {
      caseSensitive: true,
      includeLocked: true,
    });
    expect(sensitive.totalCount).toBe(0);
  });

  it("빈 찾기·무매치·동일결과 치환은 빈 계획을 준다", () => {
    expect(planDialogueReplace(makePages(), "", "x").pages).toEqual([]);
    expect(planDialogueReplace(makePages(), "없는대사", "x").totalCount).toBe(0);
    // 찾기=바꾸기 → 결과 텍스트 동일 → 패치 없음
    expect(planDialogueReplace(makePages(), "민수", "민수").totalCount).toBe(0);
  });
});

describe("적용 헬퍼(순수·참조 보존)", () => {
  it("applyReplacePlanToPages 는 계획대로 바꾸고 안 바뀐 참조를 유지한다", () => {
    const pages = makePages();
    const plan = planDialogueReplace(pages, "민수", "지영");
    const next = applyReplacePlanToPages(pages, plan);
    expect(next).not.toBe(pages);
    const nextItems = collectDialogueItems([...next]);
    expect(nextItems.find((i) => i.id === "b1")?.text).toBe("안녕? 지영야");
    expect(nextItems.find((i) => i.id === "b3")?.text).toBe("다음 날\n지영네 집");
    expect(nextItems.find((i) => i.id === "b2")?.text).toBe("민수... 왜 저래"); // 잠김 보존
    // 참조 보존: 바뀐 페이지 안에서도 무관 요소는 동일 참조
    expect(next[0].elements[0]).toBe(pages[0].elements[0]);
    expect(next[0].elements[4]).toBe(pages[0].elements[4]);
    // 입력 불변
    expect(collectDialogueItems(pages).find((i) => i.id === "b1")?.text).toBe("안녕? 민수야");
  });

  it("applyReplacePlanToPages 는 빈 계획이면 입력 배열을 그대로 반환한다", () => {
    const pages = makePages();
    expect(applyReplacePlanToPages(pages, planDialogueReplace(pages, "", "x"))).toBe(pages);
    expect(applyReplacePlanToPages(pages, planDialogueReplace(pages, "없는대사", "x"))).toBe(pages);
  });

  it("applyDialogueTextEdit 는 대상 요소만 새로 만든다", () => {
    const pages = makePages();
    const next = applyDialogueTextEdit(pages, "p1", "b1", "반가워!");
    expect(next).not.toBe(pages);
    expect(next[1]).toBe(pages[1]); // 다른 페이지 참조 유지
    const item = collectDialogueItems([...next]).find((i) => i.id === "b1");
    expect(item?.text).toBe("반가워!");
    // 원본 요소의 나머지 필드 보존(spread)
    const el = next[0].elements.find((e) => e.id === "b1");
    expect(el?.variant).toBe("speech");
  });

  it("applyDialogueTextEdit 는 무변경·비대사·미존재 대상이면 입력을 그대로 반환한다", () => {
    const pages = makePages();
    expect(applyDialogueTextEdit(pages, "p1", "b1", "안녕? 민수야")).toBe(pages); // 동일 텍스트
    expect(applyDialogueTextEdit(pages, "p1", "f1", "x")).toBe(pages); // frame 은 비대사
    expect(applyDialogueTextEdit(pages, "p1", "없는id", "x")).toBe(pages);
    expect(applyDialogueTextEdit(pages, "없는페이지", "b1", "x")).toBe(pages);
  });
});

describe("StudioPage 통합 계약(컴파일 타임)", () => {
  // StudioPage 의 실제 PageState 형태(비공개 인터페이스)를 미러링 — El/LayerGroup 은 진짜 타입.
  type PageStateLike = {
    id: string;
    elements: El[];
    bg: string;
    bgGrad: string[] | null;
    canvasH: number;
    groups?: LayerGroup[];
  };

  it("El[]/PageState 가 Like 타입으로 대입되고 적용 결과를 되돌려 캐스팅할 수 있다", () => {
    // El → DialogueElementLike 대입 가능성(통합에서 pages 를 그대로 넘기는 전제).
    const elements: readonly DialogueElementLike[] = [] as El[];
    const pagesLike: PageStateLike[] = [];
    const asDialoguePages: readonly DialoguePageLike[] = pagesLike;
    // 통합 스니펫과 동일한 왕복: plan 계산 → 적용 → PageState 로 다운캐스트.
    const plan = planDialogueReplace(asDialoguePages, "찾기", "바꾸기");
    const next = applyReplacePlanToPages(asDialoguePages, plan) as PageStateLike[];
    const edited = applyDialogueTextEdit(asDialoguePages, "p", "e", "t") as PageStateLike[];
    expect(elements).toEqual([]);
    expect(next).toEqual([]);
    expect(edited).toEqual([]);
  });
});
