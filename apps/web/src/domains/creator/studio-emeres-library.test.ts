import { describe, it, expect } from "vitest";

import {
  createEmeresLibraryItem,
  deleteEmeresLibraryItem,
  DEFAULT_EMERES_LIBRARY_ITEM_NAME,
  EMERES_LIBRARY_KEY,
  listEmeresLibraryItems,
  MAX_EMERES_LIBRARY_ITEMS,
  renameEmeresLibraryItem,
  saveEmeresLibraryItem,
  setEmeresLibraryItemCategory,
  type StudioEmeresLibraryItem,
} from "./studio-emeres-library";

import type { EmeresCategory } from "./studio-emeres-templates";

// 인메모리 가짜 저장소 (studio-brush-library.test.ts와 동일 패턴)
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    _map: map,
  };
}

const item = (id: string, createdAt = 1, extra: Partial<StudioEmeresLibraryItem> = {}): StudioEmeresLibraryItem => ({
  id,
  name: `틀 ${id}`,
  createdAt,
  updatedAt: createdAt,
  src: `data:image/webp;base64,${id}`,
  width: 400,
  height: 300,
  ...extra,
});

describe("createEmeresLibraryItem", () => {
  it("이름과 이미지로 저장 레코드를 만든다", () => {
    const created = createEmeresLibraryItem("내 스케치", { src: "data:image/webp;base64,abc", width: 400, height: 300 });
    expect(created.name).toBe("내 스케치");
    expect(created.src).toBe("data:image/webp;base64,abc");
    expect(created.width).toBe(400);
    expect(created.height).toBe(300);
    expect(typeof created.id).toBe("string");
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.category).toBeUndefined();
  });

  it("빈 이름/공백 이름은 DEFAULT_EMERES_LIBRARY_ITEM_NAME으로 대체한다", () => {
    const withEmpty = createEmeresLibraryItem("", { src: "data:image/webp;base64,abc", width: 10, height: 10 });
    expect(withEmpty.name).toBe(DEFAULT_EMERES_LIBRARY_ITEM_NAME);
    const withBlank = createEmeresLibraryItem("   ", { src: "data:image/webp;base64,abc", width: 10, height: 10 });
    expect(withBlank.name).toBe(DEFAULT_EMERES_LIBRARY_ITEM_NAME);
  });

  it("이름 앞뒤 공백을 다듬는다", () => {
    const created = createEmeresLibraryItem("  다듬기  ", { src: "data:image/webp;base64,abc", width: 10, height: 10 });
    expect(created.name).toBe("다듬기");
  });

  it("width/height를 정수로 반올림한다", () => {
    const created = createEmeresLibraryItem("소수", { src: "data:image/webp;base64,abc", width: 100.6, height: 50.2 });
    expect(created.width).toBe(101);
    expect(created.height).toBe(50);
  });

  it("src가 빈 문자열이면 던진다", () => {
    expect(() => createEmeresLibraryItem("이름", { src: "", width: 10, height: 10 })).toThrow();
  });

  it("width/height가 0 이하이면 던진다", () => {
    expect(() => createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 0, height: 10 })).toThrow();
    expect(() => createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 10, height: -5 })).toThrow();
  });

  it("width/height가 NaN/Infinity면 던진다", () => {
    expect(() =>
      createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: Number.NaN, height: 10 })
    ).toThrow();
    expect(() =>
      createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 10, height: Number.POSITIVE_INFINITY })
    ).toThrow();
  });

  it("반올림하면 0이 되는 아주 작은 양수 width/height는 던진다(반올림 전 값만 보고 통과시키지 않는다)", () => {
    expect(() =>
      createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 0.4, height: 10 })
    ).toThrow();
    expect(() =>
      createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 10, height: 0.49 })
    ).toThrow();
  });

  it("반올림해서 1 이상이 되는 경계값(0.5)은 통과시킨다", () => {
    const created = createEmeresLibraryItem("이름", { src: "data:image/webp;base64,abc", width: 0.5, height: 10 });
    expect(created.width).toBe(1);
  });
});

describe("listEmeresLibraryItems", () => {
  it("저장소 없으면 빈 배열", () => {
    expect(listEmeresLibraryItems(null)).toEqual([]);
    expect(listEmeresLibraryItems(undefined)).toEqual([]);
  });

  it("빈/깨진 JSON은 빈 배열", () => {
    expect(listEmeresLibraryItems(fakeStorage())).toEqual([]);
    expect(listEmeresLibraryItems(fakeStorage({ [EMERES_LIBRARY_KEY]: "{not json" }))).toEqual([]);
    expect(listEmeresLibraryItems(fakeStorage({ [EMERES_LIBRARY_KEY]: '{"a":1}' }))).toEqual([]); // 배열 아님
  });

  it("형식이 맞는 항목만 통과시킨다", () => {
    const s = fakeStorage({
      [EMERES_LIBRARY_KEY]: JSON.stringify([item("a"), { id: "x" }, item("b"), { ...item("c"), src: "" }]),
    });
    expect(listEmeresLibraryItems(s).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("유효하지 않은 category 값을 가진 항목은 걸러낸다", () => {
    const s = fakeStorage({
      [EMERES_LIBRARY_KEY]: JSON.stringify([item("a", 1, { category: "존재하지않는카테고리" as unknown as EmeresCategory }), item("b")]),
    });
    expect(listEmeresLibraryItems(s).map((i) => i.id)).toEqual(["b"]);
  });

  it("유효한 category가 있는 항목은 통과시킨다", () => {
    const s = fakeStorage({ [EMERES_LIBRARY_KEY]: JSON.stringify([item("a", 1, { category: "감정" })]) });
    expect(listEmeresLibraryItems(s)[0]?.category).toBe("감정");
  });

  it("width/height가 NaN·0·음수인 손상된 항목은 걸러낸다(createEmeresLibraryItem은 이런 값을 절대 만들지 않지만, 수동 편집 등으로 저장소에 직접 들어올 수 있다)", () => {
    const s = fakeStorage({
      [EMERES_LIBRARY_KEY]: JSON.stringify([
        item("nan", 1, { width: Number.NaN }),
        item("zero", 2, { width: 0 }),
        item("neg", 3, { height: -10 }),
        item("infinite", 4, { width: Number.POSITIVE_INFINITY }),
        item("ok", 5),
      ]),
    });
    expect(listEmeresLibraryItems(s).map((i) => i.id)).toEqual(["ok"]);
  });
});

describe("saveEmeresLibraryItem", () => {
  it("맨 앞에 추가한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    const next = saveEmeresLibraryItem(s, item("b"));
    expect(next.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("같은 id는 교체하며 맨 앞으로", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1));
    saveEmeresLibraryItem(s, item("b", 1));
    const next = saveEmeresLibraryItem(s, item("a", 2));
    expect(next.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next[0]?.createdAt).toBe(2);
  });

  it(`최대 ${MAX_EMERES_LIBRARY_ITEMS}개로 제한`, () => {
    const s = fakeStorage();
    let result: StudioEmeresLibraryItem[] = [];
    for (let i = 0; i < MAX_EMERES_LIBRARY_ITEMS + 5; i++) result = saveEmeresLibraryItem(s, item(`x${i}`, i));
    expect(result).toHaveLength(MAX_EMERES_LIBRARY_ITEMS);
    expect(result[0]?.id).toBe(`x${MAX_EMERES_LIBRARY_ITEMS + 4}`);
  });

  it("저장소에 영속된다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    expect(listEmeresLibraryItems(s).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("renameEmeresLibraryItem", () => {
  it("배열 순서를 유지하며 updatedAt을 갱신한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1));
    saveEmeresLibraryItem(s, item("b", 2));
    const before = listEmeresLibraryItems(s).find((i) => i.id === "b")?.updatedAt ?? 0;
    const next = renameEmeresLibraryItem(s, "b", "새 이름");
    expect(next.map((i) => i.id)).toEqual(["b", "a"]); // 순서 유지(맨 앞으로 옮기지 않음)
    const renamed = next.find((i) => i.id === "b");
    expect(renamed?.name).toBe("새 이름");
    expect(renamed?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("빈 이름은 무시한다(원본 목록 그대로)", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    const next = renameEmeresLibraryItem(s, "a", "   ");
    expect(next.find((i) => i.id === "a")?.name).toBe("틀 a");
  });

  it("없는 id는 무시한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    const next = renameEmeresLibraryItem(s, "zzz", "새 이름");
    expect(next.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("setEmeresLibraryItemCategory", () => {
  it("유효한 카테고리를 설정하고 순서를 유지한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1));
    saveEmeresLibraryItem(s, item("b", 2));
    const next = setEmeresLibraryItemCategory(s, "b", "액션");
    expect(next.map((i) => i.id)).toEqual(["b", "a"]); // 순서 유지
    expect(next.find((i) => i.id === "b")?.category).toBe("액션");
  });

  it("undefined로 카테고리를 해제한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1, { category: "일상" }));
    const next = setEmeresLibraryItemCategory(s, "a", undefined);
    expect(next.find((i) => i.id === "a")?.category).toBeUndefined();
  });

  it("유효하지 않은 카테고리 값은 무시한다(원본 목록 그대로)", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1, { category: "관계" }));
    const next = setEmeresLibraryItemCategory(s, "a", "없는카테고리" as unknown as EmeresCategory);
    expect(next.find((i) => i.id === "a")?.category).toBe("관계"); // 변경되지 않음
  });

  it("없는 id는 무시한다(목록 내용은 그대로)", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    const next = setEmeresLibraryItemCategory(s, "zzz", "감정");
    expect(next.map((i) => i.id)).toEqual(["a"]);
    expect(next[0]?.category).toBeUndefined();
  });

  it("updatedAt을 갱신한다", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a", 1));
    const before = listEmeresLibraryItems(s)[0]?.updatedAt ?? 0;
    const next = setEmeresLibraryItemCategory(s, "a", "감정");
    expect(next[0]?.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("deleteEmeresLibraryItem", () => {
  it("id로 삭제", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    saveEmeresLibraryItem(s, item("b"));
    const next = deleteEmeresLibraryItem(s, "a");
    expect(next.map((i) => i.id)).toEqual(["b"]);
    expect(listEmeresLibraryItems(s).map((i) => i.id)).toEqual(["b"]);
  });

  it("없는 id는 그대로", () => {
    const s = fakeStorage();
    saveEmeresLibraryItem(s, item("a"));
    expect(deleteEmeresLibraryItem(s, "zzz").map((i) => i.id)).toEqual(["a"]);
  });

  it("저장소 없어도 던지지 않는다", () => {
    expect(deleteEmeresLibraryItem(null, "a")).toEqual([]);
  });
});
