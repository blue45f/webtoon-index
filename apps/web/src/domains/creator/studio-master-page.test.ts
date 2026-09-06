// studio-master-page — 문서 마스터(공통 요소 레이어) 순수 로직 테스트.
// 직렬화 하위호환(빈 마스터=키 제거)·합성 순서(마스터 아래)·hideMaster 키 규약·
// 동일 참조 보존(메모이제이션 계약)을 회귀 가드한다.
import { describe, expect, it } from "vitest";

import {
  MASTER_EDIT_GHOST_OPACITY,
  composeMasterRenderElements,
  composePageElements,
  composeThumbPage,
  createEmptyDocumentMaster,
  normalizeDocumentMaster,
  normalizeMasterElement,
  resolveMasterCommitTarget,
  serializeDocumentMaster,
  togglePageHideMaster,
  withMasterElements,
  type DocumentMaster,
  type MasterElementLike,
} from "./studio-master-page";

type TestEl = MasterElementLike & {
  type?: string;
  x?: number;
  y?: number;
  text?: string;
};

function el(id: string, extra: Partial<TestEl> = {}): TestEl {
  return { id, type: "text", x: 10, y: 20, ...extra };
}

function masterOf(...elements: TestEl[]): DocumentMaster<TestEl> {
  return { elements };
}

describe("createEmptyDocumentMaster", () => {
  it("빈 elements 배열을 가진 마스터를 만든다", () => {
    expect(createEmptyDocumentMaster()).toEqual({ elements: [] });
  });

  it("호출마다 새 객체를 반환한다(공유 상태 없음)", () => {
    const a = createEmptyDocumentMaster();
    const b = createEmptyDocumentMaster();
    expect(a).not.toBe(b);
    expect(a.elements).not.toBe(b.elements);
  });
});

describe("normalizeMasterElement", () => {
  it("groupId 와 clipBelow 를 키째 제거한다(마스터 미지원 필드)", () => {
    const src = el("a", { groupId: "g1", clipBelow: true });
    const out = normalizeMasterElement(src);
    expect("groupId" in out).toBe(false);
    expect("clipBelow" in out).toBe(false);
  });

  it("나머지 필드는 그대로 보존하고 원본을 변경하지 않는다", () => {
    const src = el("a", { groupId: "g1", hidden: true, locked: true, text: "로고" });
    const out = normalizeMasterElement(src);
    expect(out).toMatchObject({ id: "a", hidden: true, locked: true, text: "로고", x: 10 });
    expect(out).not.toBe(src);
    expect(src.groupId).toBe("g1"); // 원본 불변
  });
});

describe("withMasterElements", () => {
  it("요소 배열을 정규화해 새 마스터로 교체한다", () => {
    const master = masterOf(el("old"));
    const next = withMasterElements(master, [el("a", { clipBelow: true }), el("b")]);
    expect(next.elements.map((e) => e.id)).toEqual(["a", "b"]);
    expect("clipBelow" in next.elements[0]).toBe(false);
  });

  it("원본 마스터/입력 배열을 변경하지 않고, 마스터의 다른 필드를 보존한다", () => {
    const master = { elements: [el("old")], future: "keep" } as DocumentMaster<TestEl> & {
      future: string;
    };
    const input = [el("a")];
    const next = withMasterElements(master, input);
    expect(master.elements.map((e) => e.id)).toEqual(["old"]);
    expect(next).not.toBe(master);
    expect((next as typeof master).future).toBe("keep"); // 미래 필드 스프레드 보존
    expect(next.elements).not.toBe(input);
  });
});

describe("normalizeDocumentMaster (unknown JSON → 마스터)", () => {
  it("undefined/null/원시값/배열이면 빈 마스터(과거 문서 하위호환)", () => {
    expect(normalizeDocumentMaster(undefined)).toEqual({ elements: [] });
    expect(normalizeDocumentMaster(null)).toEqual({ elements: [] });
    expect(normalizeDocumentMaster("master")).toEqual({ elements: [] });
    expect(normalizeDocumentMaster(42)).toEqual({ elements: [] });
    expect(normalizeDocumentMaster([{ id: "a" }])).toEqual({ elements: [] });
  });

  it("elements 가 배열이 아니면 빈 마스터", () => {
    expect(normalizeDocumentMaster({})).toEqual({ elements: [] });
    expect(normalizeDocumentMaster({ elements: "x" })).toEqual({ elements: [] });
  });

  it("id 가 없는/빈 문자열인/객체가 아닌 항목은 걸러낸다", () => {
    const out = normalizeDocumentMaster({
      elements: [{ id: "ok" }, { id: "" }, { id: 3 }, null, "junk", { text: "no-id" }],
    });
    expect(out.elements.map((e) => e.id)).toEqual(["ok"]);
  });

  it("유효 항목은 정규화(groupId/clipBelow 제거)해 보존한다", () => {
    const out = normalizeDocumentMaster({
      elements: [{ id: "a", groupId: "g", clipBelow: true, text: "워터마크" }],
    });
    expect(out.elements[0]).toEqual({ id: "a", text: "워터마크" });
  });
});

describe("serializeDocumentMaster (직렬화 하위호환)", () => {
  it("빈 마스터/null/undefined 는 undefined — JSON 에서 master 키가 떨어진다", () => {
    expect(serializeDocumentMaster(createEmptyDocumentMaster())).toBeUndefined();
    expect(serializeDocumentMaster(null)).toBeUndefined();
    expect(serializeDocumentMaster(undefined)).toBeUndefined();
    // 실제 페이로드에서 키가 사라지는지까지 고정(기존 문서와 바이트 동일 규약).
    expect(JSON.stringify({ master: serializeDocumentMaster(null) })).toBe("{}");
  });

  it("비어 있지 않으면 정규화된 elements 를 담아 반환한다", () => {
    const out = serializeDocumentMaster(masterOf(el("a", { groupId: "g" })));
    expect(out).toEqual({ elements: [{ id: "a", type: "text", x: 10, y: 20 }] });
  });

  it("serialize → JSON → normalize 라운드트립이 내용을 보존한다", () => {
    const master = masterOf(el("a", { text: "로고" }), el("b", { hidden: true }));
    const json = JSON.stringify({ master: serializeDocumentMaster(master) });
    const back = normalizeDocumentMaster((JSON.parse(json) as { master?: unknown }).master);
    expect(back.elements).toEqual(master.elements);
  });
});

describe("composeMasterRenderElements (페이지 합성용 목록)", () => {
  it("hidden 요소는 제외하고 locked/noClip 을 강제한다", () => {
    const out = composeMasterRenderElements(
      masterOf(el("a"), el("b", { hidden: true }), el("c", { locked: false, noClip: false }))
    );
    expect(out.map((e) => e.id)).toEqual(["a", "c"]);
    for (const item of out) {
      expect(item.locked).toBe(true);
      expect(item.noClip).toBe(true);
    }
  });

  it("groupId/clipBelow 를 제거하고 원본 마스터를 변경하지 않는다", () => {
    const master = masterOf(el("a", { groupId: "g", clipBelow: true }));
    const out = composeMasterRenderElements(master);
    expect("groupId" in out[0]).toBe(false);
    expect("clipBelow" in out[0]).toBe(false);
    expect(master.elements[0].groupId).toBe("g");
    expect(master.elements[0].locked).toBeUndefined();
  });

  it("빈/누락 마스터는 빈 배열", () => {
    expect(composeMasterRenderElements(createEmptyDocumentMaster())).toEqual([]);
    expect(composeMasterRenderElements(null)).toEqual([]);
    expect(composeMasterRenderElements(undefined)).toEqual([]);
  });
});

describe("composePageElements (마스터+페이지 합성 순서)", () => {
  const page = { id: "p1", elements: [el("p-a"), el("p-b")] };

  it("마스터 요소가 앞(아래), 페이지 요소가 뒤(위)", () => {
    const out = composePageElements(masterOf(el("m-1")), page);
    expect(out.map((e) => e.id)).toEqual(["m-1", "p-a", "p-b"]);
  });

  it("마스터가 비면 페이지 elements 를 동일 참조로 반환한다(메모이제이션 보존)", () => {
    expect(composePageElements(createEmptyDocumentMaster(), page)).toBe(page.elements);
    expect(composePageElements(null, page)).toBe(page.elements);
  });

  it("page.hideMaster 면 마스터가 있어도 페이지 elements 동일 참조", () => {
    const hiddenPage = { ...page, hideMaster: true };
    expect(composePageElements(masterOf(el("m-1")), hiddenPage)).toBe(hiddenPage.elements);
  });

  it("마스터 요소가 전부 hidden 이면 페이지 elements 동일 참조", () => {
    const allHidden = masterOf(el("m-1", { hidden: true }));
    expect(composePageElements(allHidden, page)).toBe(page.elements);
  });

  it("페이지 elements 원본을 변경하지 않는다", () => {
    composePageElements(masterOf(el("m-1")), page);
    expect(page.elements.map((e) => e.id)).toEqual(["p-a", "p-b"]);
  });
});

describe("composeThumbPage (썸네일용 합성 페이지)", () => {
  const page = { id: "p1", elements: [el("p-a")], bg: "#fff", canvasH: 1080 };

  it("합성할 것이 없으면 원본 page 동일 참조(썸네일 재렌더 무영향)", () => {
    expect(composeThumbPage(createEmptyDocumentMaster(), page)).toBe(page);
    expect(composeThumbPage(null, page)).toBe(page);
    expect(composeThumbPage(masterOf(el("m", { hidden: true })), page)).toBe(page);
    const hiddenPage = { ...page, hideMaster: true };
    expect(composeThumbPage(masterOf(el("m")), hiddenPage)).toBe(hiddenPage);
  });

  it("마스터가 있으면 elements 앞에 붙인 사본 페이지를 만든다(다른 필드 보존)", () => {
    const out = composeThumbPage(masterOf(el("m-1")), page);
    expect(out).not.toBe(page);
    expect(out.elements.map((e) => e.id)).toEqual(["m-1", "p-a"]);
    expect(out.bg).toBe("#fff");
    expect(out.canvasH).toBe(1080);
    expect(page.elements.map((e) => e.id)).toEqual(["p-a"]); // 원본 불변
  });
});

describe("togglePageHideMaster (페이지별 숨김 키 규약)", () => {
  const pages = [
    { id: "p1", elements: [] as TestEl[] },
    { id: "p2", elements: [] as TestEl[] },
  ];

  it("켜기: 대상 페이지에만 hideMaster: true", () => {
    const out = togglePageHideMaster(pages, "p2");
    expect((out[1] as { hideMaster?: boolean }).hideMaster).toBe(true);
    expect("hideMaster" in out[0]).toBe(false);
  });

  it("끄기: false 저장이 아니라 키 자체를 제거한다(레거시 직렬화 형태 유지)", () => {
    const on = togglePageHideMaster(pages, "p1");
    const off = togglePageHideMaster(on, "p1");
    expect("hideMaster" in off[0]).toBe(false);
    expect(JSON.stringify(off[0])).toBe(JSON.stringify(pages[0]));
  });

  it("대상 외 페이지는 동일 참조 유지(변경 페이지만 새 객체)", () => {
    const out = togglePageHideMaster(pages, "p1");
    expect(out[1]).toBe(pages[1]);
    expect(out[0]).not.toBe(pages[0]);
    expect(pages[0]).not.toHaveProperty("hideMaster"); // 원본 불변
  });

  it("없는 pageId 면 내용 변화 없음", () => {
    const out = togglePageHideMaster(pages, "nope");
    expect(out).toEqual(pages);
  });
});

describe("마스터 편집 모드 규약", () => {
  it("resolveMasterCommitTarget: 편집 모드=master, 평시=page", () => {
    expect(resolveMasterCommitTarget(true)).toBe("master");
    expect(resolveMasterCommitTarget(false)).toBe("page");
  });

  it("고스트 불투명도는 참고용 반투명(0 초과 1 미만)", () => {
    expect(MASTER_EDIT_GHOST_OPACITY).toBeGreaterThan(0);
    expect(MASTER_EDIT_GHOST_OPACITY).toBeLessThan(1);
  });
});
