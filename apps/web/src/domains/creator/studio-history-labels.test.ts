// studio-history-labels 순수 모듈 테스트 — 스냅샷 diff 라벨(한국어)·점프 계획·표시 창.
// StudioPage 커밋 경로(요소 패치는 map 으로 새 배열, 무변화 요소는 참조 유지)를 그대로 흉내 낸다.
import { describe, expect, it } from "vitest";

import { createDefaultStudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";
import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";
import {
  HISTORY_INITIAL_LABEL,
  HISTORY_PANEL_MAX_VISIBLE,
  buildHistoryTimeline,
  describeHistoryStep,
  historyElementNoun,
  planHistoryJump,
  sliceHistoryForDisplay,
  type HistoryElementLike,
  type HistoryPageLike,
  type HistorySnapshot,
} from "./studio-history-labels";

function el(id: string, over: Partial<HistoryElementLike> = {}): HistoryElementLike {
  return { id, type: "text", x: 10, y: 20, width: 100, height: 40, text: "안녕", ...over };
}

function page(id: string, elements: HistoryElementLike[], over: Partial<HistoryPageLike> = {}): HistoryPageLike {
  return { id, elements, bg: "#ffffff", bgGrad: null, canvasH: 1080, ...over };
}

// StudioPage 의 patchEl 과 동일한 형태 — 대상만 새 객체, 나머지는 참조 유지.
function patchIn(els: readonly HistoryElementLike[], id: string, patch: Partial<HistoryElementLike>) {
  return els.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

function repage(snapshot: HistorySnapshot, pageId: string, over: Partial<HistoryPageLike>): HistorySnapshot {
  return snapshot.map((p) => (p.id === pageId ? { ...p, ...over } : p));
}

describe("historyElementNoun", () => {
  it("요소 타입을 레이어 목록과 같은 한국어 명칭으로 부른다", () => {
    expect(historyElementNoun(el("a", { type: "bubble" }))).toBe("말풍선");
    expect(historyElementNoun(el("a", { type: "image" }))).toBe("이미지");
    expect(historyElementNoun(el("a", { type: "frame" }))).toBe("패널");
    expect(historyElementNoun(el("a", { type: "focusLines" }))).toBe("집중선");
    expect(historyElementNoun(el("a", { type: "unknown-type" }))).toBe("요소");
  });

  it("draw 는 kind 로 그림/도형을 구분한다", () => {
    expect(historyElementNoun(el("a", { type: "draw", kind: "freehand" }))).toBe("그림");
    expect(historyElementNoun(el("a", { type: "draw" }))).toBe("그림");
    expect(historyElementNoun(el("a", { type: "draw", kind: "rect" }))).toBe("도형");
  });
});

describe("describeHistoryStep — 요소 추가/삭제", () => {
  it("첫 스냅샷은 처음 상태", () => {
    expect(describeHistoryStep(null, [page("p1", [])])).toBe(HISTORY_INITIAL_LABEL);
    expect(describeHistoryStep(undefined, [page("p1", [])])).toBe(HISTORY_INITIAL_LABEL);
  });

  it("텍스트 1개 추가 → '텍스트 추가'", () => {
    const before: HistorySnapshot = [page("p1", [])];
    const after = repage(before, "p1", { elements: [el("e1")] });
    expect(describeHistoryStep(before, after)).toBe("텍스트 추가");
  });

  it("같은 종류 여러 개 추가는 수를 센다 → '말풍선 2개 추가'", () => {
    const base = [el("e1")];
    const before: HistorySnapshot = [page("p1", base)];
    const after = repage(before, "p1", {
      elements: [...base, el("b1", { type: "bubble" }), el("b2", { type: "bubble" })],
    });
    expect(describeHistoryStep(before, after)).toBe("말풍선 2개 추가");
  });

  it("종류가 섞이면 '요소 N개 추가'", () => {
    const before: HistorySnapshot = [page("p1", [])];
    const after = repage(before, "p1", {
      elements: [el("e1"), el("e2", { type: "image" }), el("e3", { type: "sticker" })],
    });
    expect(describeHistoryStep(before, after)).toBe("요소 3개 추가");
  });

  it("삭제 → '스티커 삭제'", () => {
    const keep = el("e1");
    const before: HistorySnapshot = [page("p1", [keep, el("s1", { type: "sticker" })])];
    const after = repage(before, "p1", { elements: [keep] });
    expect(describeHistoryStep(before, after)).toBe("스티커 삭제");
  });

  it("추가와 삭제가 한 커밋이면 '요소 구성 변경'", () => {
    const before: HistorySnapshot = [page("p1", [el("e1")])];
    const after = repage(before, "p1", { elements: [el("e2", { type: "image" })] });
    expect(describeHistoryStep(before, after)).toBe("요소 구성 변경");
  });

  it("2개 이상 삭제 + 이미지 1개 추가면 '레이어 병합'", () => {
    const before: HistorySnapshot = [
      page("p1", [el("a", { type: "image" }), el("b", { type: "image" }), el("c")]),
    ];
    const after = repage(before, "p1", {
      elements: [el("c"), el("merged", { type: "image" })],
    });
    expect(describeHistoryStep(before, after)).toBe("레이어 병합");
  });

  it("3개 이상 삭제 + 이미지 1개 추가면 '보이는 레이어 병합'", () => {
    const before: HistorySnapshot = [
      page("p1", [
        el("a", { type: "image" }),
        el("b", { type: "image" }),
        el("c", { type: "image" }),
        el("d"),
      ]),
    ];
    const after = repage(before, "p1", {
      elements: [el("d"), el("flat", { type: "image" })],
    });
    expect(describeHistoryStep(before, after)).toBe("보이는 레이어 병합");
  });
});

describe("describeHistoryStep — 요소 패치(이동/크기/내용 등)", () => {
  const three = [el("e1"), el("e2", { type: "image" }), el("e3", { type: "sticker" })];

  it("여러 요소 x/y 이동 → '요소 3개 이동'", () => {
    const before: HistorySnapshot = [page("p1", three)];
    const moved = three.map((e) => ({ ...e, x: (e.x as number) + 5, y: (e.y as number) + 3 }));
    const after = repage(before, "p1", { elements: moved });
    expect(describeHistoryStep(before, after)).toBe("요소 3개 이동");
  });

  it("단일 요소 이동은 명칭으로 부른다 → '이미지 이동'", () => {
    const img = el("i1", { type: "image" });
    const before: HistorySnapshot = [page("p1", [img, el("t1")])];
    const after = repage(before, "p1", { elements: patchIn([img, el("t1")], "i1", { x: 99 }) });
    expect(describeHistoryStep(before, after)).toBe("이미지 이동");
  });

  it("그림(points) 평행이동은 이동, 형태 변화는 모양 수정", () => {
    const draw = el("d1", { type: "draw", x: undefined, y: undefined, width: undefined, height: undefined, text: undefined, points: [0, 0, 10, 10, 20, 5] });
    const before: HistorySnapshot = [page("p1", [draw])];
    const translated = repage(before, "p1", {
      elements: [{ ...draw, points: [4, 3, 14, 13, 24, 8] }],
    });
    expect(describeHistoryStep(before, translated)).toBe("그림 이동");
    const reshaped = repage(before, "p1", {
      elements: [{ ...draw, points: [0, 0, 10, 10, 40, 5] }],
    });
    expect(describeHistoryStep(before, reshaped)).toBe("그림 모양 수정");
  });

  it("크기(트랜스폼)는 x/y 가 함께 바뀌어도 크기 조절", () => {
    const img = el("i1", { type: "image" });
    const before: HistorySnapshot = [page("p1", [img])];
    const after = repage(before, "p1", {
      elements: [{ ...img, x: 5, y: 6, width: 200, height: 90 }],
    });
    expect(describeHistoryStep(before, after)).toBe("이미지 크기 조절");
  });

  it("회전 → '텍스트 회전'", () => {
    const t = el("t1", { rotation: 0 });
    const before: HistorySnapshot = [page("p1", [t])];
    const after = repage(before, "p1", { elements: [{ ...t, rotation: 45 }] });
    expect(describeHistoryStep(before, after)).toBe("텍스트 회전");
  });

  it("말풍선 대사 확정은 height 자동 확장이 있어도 내용 수정", () => {
    const b = el("b1", { type: "bubble", text: "이전 대사", height: 80 });
    const before: HistorySnapshot = [page("p1", [b])];
    const after = repage(before, "p1", { elements: [{ ...b, text: "새 대사", height: 120 }] });
    expect(describeHistoryStep(before, after)).toBe("말풍선 내용 수정");
  });

  it("표시/숨김·잠금 토글 라벨", () => {
    const t = el("t1");
    const before: HistorySnapshot = [page("p1", [t])];
    expect(describeHistoryStep(before, repage(before, "p1", { elements: [{ ...t, hidden: true }] }))).toBe(
      "텍스트 숨김"
    );
    const hiddenFirst: HistorySnapshot = [page("p1", [{ ...t, hidden: true }])];
    expect(
      describeHistoryStep(hiddenFirst, repage(hiddenFirst, "p1", { elements: [{ ...t, hidden: false }] }))
    ).toBe("텍스트 표시");
    expect(describeHistoryStep(before, repage(before, "p1", { elements: [{ ...t, locked: true }] }))).toBe(
      "텍스트 잠금"
    );
    const lockedFirst: HistorySnapshot = [page("p1", [{ ...t, locked: true }])];
    expect(
      describeHistoryStep(lockedFirst, repage(lockedFirst, "p1", { elements: [{ ...t, locked: false }] }))
    ).toBe("텍스트 잠금 해제");
  });

  it("불투명도·이름·기타 스타일 패치", () => {
    const t = el("t1", { opacity: 1 });
    const before: HistorySnapshot = [page("p1", [t])];
    expect(describeHistoryStep(before, repage(before, "p1", { elements: [{ ...t, opacity: 0.5 }] }))).toBe(
      "텍스트 불투명도 변경"
    );
    expect(describeHistoryStep(before, repage(before, "p1", { elements: [{ ...t, name: "제목" }] }))).toBe(
      "텍스트 이름 변경"
    );
    // 추적하지 않는 필드(fill 등)만 바뀌어 참조만 새것 → 스타일 변경.
    const styled = repage(before, "p1", { elements: [{ ...t, fill: "#ff0000" } as HistoryElementLike] });
    expect(describeHistoryStep(before, styled)).toBe("텍스트 스타일 변경");
  });

  it("래스터 픽셀 편집과 채우기 참조 지정 방향을 구분한다", () => {
    const image = el("i1", { type: "image", src: "before", fillReference: false });
    const before: HistorySnapshot = [page("p1", [image])];
    expect(
      describeHistoryStep(before, repage(before, "p1", { elements: [{ ...image, src: "after" }] })),
    ).toBe("이미지 픽셀 편집");
    const referenced: HistorySnapshot = [page("p1", [{ ...image, fillReference: true }])];
    expect(describeHistoryStep(before, referenced)).toBe("이미지 채우기 참조 지정");
    expect(
      describeHistoryStep(referenced, [page("p1", [{ ...image, fillReference: false }])]),
    ).toBe("이미지 채우기 참조 해제");
  });

  it("변화 종류가 섞이면 '요소 N개 편집'", () => {
    const a = el("a1");
    const b = el("b1", { type: "image" });
    const before: HistorySnapshot = [page("p1", [a, b])];
    const after = repage(before, "p1", {
      elements: [
        { ...a, x: 50 }, // 이동
        { ...b, width: 300 }, // 크기
      ],
    });
    expect(describeHistoryStep(before, after)).toBe("요소 2개 편집");
  });

  it("내용 동일·순서만 변경 → 레이어 순서 변경", () => {
    const a = el("a1");
    const b = el("b1", { type: "image" });
    const before: HistorySnapshot = [page("p1", [a, b])];
    const after = repage(before, "p1", { elements: [b, a] });
    expect(describeHistoryStep(before, after)).toBe("레이어 순서 변경");
  });
});

describe("describeHistoryStep — 페이지 속성/구조", () => {
  it("배경·캔버스 높이·색보정·페이지 정보", () => {
    const before: HistorySnapshot = [page("p1", [el("e1")])];
    expect(describeHistoryStep(before, repage(before, "p1", { bg: "#000000" }))).toBe("배경 변경");
    expect(describeHistoryStep(before, repage(before, "p1", { bgGrad: ["#fff", "#000"] }))).toBe("배경 변경");
    expect(describeHistoryStep(before, repage(before, "p1", { canvasH: 1440 }))).toBe("캔버스 높이 변경");
    expect(describeHistoryStep(before, repage(before, "p1", { grade: { brightness: 1.2 } }))).toBe("색보정 변경");
    expect(describeHistoryStep(before, repage(before, "p1", { name: "도입부" }))).toBe("페이지 정보 수정");
    expect(describeHistoryStep(before, repage(before, "p1", { note: "콘티 메모" }))).toBe("페이지 정보 수정");
  });

  it("그룹 만들기(그룹 배열+요소 groupId 동시 커밋)는 '그룹 변경' 하나로 접는다", () => {
    const a = el("a1");
    const b = el("b1");
    const before: HistorySnapshot = [page("p1", [a, b])];
    const after = repage(before, "p1", {
      groups: [{ id: "g1", name: "그룹 1" }],
      elements: [
        { ...a, groupId: "g1" },
        { ...b, groupId: "g1" },
      ],
    });
    expect(describeHistoryStep(before, after)).toBe("그룹 변경");
  });

  it("드로잉 가이드만 바뀐 히스토리를 실질 변경으로 표시한다", () => {
    const defaultGuide = createDefaultStudioDrawingAssistDocument({
      canvasWidth: STUDIO_CANVAS_WIDTH,
      canvasHeight: 1080,
    });
    const before: HistorySnapshot = [page("p1", [], { drawingAssist: defaultGuide })];
    const after = repage(before, "p1", {
      drawingAssist: {
        ...defaultGuide,
        perspective: {
          active: true,
          points: [{ id: "vp-a", x: 100, y: 200 }],
        },
      },
    });
    expect(describeHistoryStep(before, after)).toBe("드로잉 가이드 변경");
    expect(describeHistoryStep(before, [
      page("p1", [], { drawingAssist: structuredClone(defaultGuide) }),
    ])).toBe("변경 없음");
    expect(describeHistoryStep(
      [page("p1", [], { drawingAssist: undefined })],
      [page("p1", [], { drawingAssist: structuredClone(defaultGuide) })]
    )).toBe("변경 없음");
  });

  it("페이지 추가/삭제/순서 변경", () => {
    const p1 = page("p1", []);
    const p2 = page("p2", []);
    const p3 = page("p3", []);
    expect(describeHistoryStep([p1], [p1, p2])).toBe("페이지 추가");
    expect(describeHistoryStep([p1], [p1, p2, p3])).toBe("페이지 2개 추가");
    expect(describeHistoryStep([p1, p2], [p1])).toBe("페이지 삭제");
    expect(describeHistoryStep([p1, p2, p3], [p3, p1, p2])).toBe("페이지 순서 변경");
  });

  it("여러 페이지 일괄 적용 — 전체 색보정/배경, 대사 일괄 수정", () => {
    const p1 = page("p1", [el("a1", { type: "bubble", text: "안녕" })]);
    const p2 = page("p2", [el("a2", { type: "bubble", text: "안녕" })]);
    const before: HistorySnapshot = [p1, p2];

    const graded = before.map((p) => ({ ...p, grade: { brightness: 1.1 } }));
    expect(describeHistoryStep(before, graded)).toBe("전체 색보정 변경");

    const recolored = repage(
      repage(before, "p1", { bg: "#111111" }),
      "p2",
      { bg: "#111111" }
    );
    expect(describeHistoryStep(before, recolored)).toBe("전체 배경 변경");

    const replaced = before.map((p) => ({
      ...p,
      elements: p.elements.map((e) => ({ ...e, text: "잘 가" })),
    }));
    expect(describeHistoryStep(before, replaced)).toBe("대사 일괄 수정");

    const mixed = repage(
      repage(before, "p1", { bg: "#111111" }),
      "p2",
      { canvasH: 2000 }
    );
    expect(describeHistoryStep(before, mixed)).toBe("페이지 2개 편집");

    const defaultGuide = createDefaultStudioDrawingAssistDocument({
      canvasWidth: 800,
      canvasHeight: 1080,
    });
    const guidesBefore: HistorySnapshot = before.map((p) => ({
      ...p,
      drawingAssist: defaultGuide,
    }));
    const guidesAfter: HistorySnapshot = guidesBefore.map((p, index) => ({
      ...p,
      drawingAssist: {
        ...defaultGuide,
        perspective: {
          active: true,
          points: [{ id: `vp-${index}`, x: 100 + index, y: 200 }],
        },
      },
    }));
    expect(describeHistoryStep(guidesBefore, guidesAfter)).toBe("전체 드로잉 가이드 변경");
  });

  it("참조만 새것이고 내용이 같으면 변경 없음", () => {
    const p1 = page("p1", [el("e1")]);
    const before: HistorySnapshot = [p1];
    const after: HistorySnapshot = [{ ...p1 }];
    expect(describeHistoryStep(before, after)).toBe("변경 없음");
    expect(describeHistoryStep(before, before)).toBe("변경 없음");
    // 요소 배열 전체가 무변화로 재구성돼도(새 참조) 변화로 오인하지 않는다.
    const rebuilt = repage(before, "p1", { elements: p1.elements.map((e) => ({ ...e })) });
    expect(describeHistoryStep(before, rebuilt)).toBe("변경 없음");
  });
});

describe("buildHistoryTimeline", () => {
  it("index/ordinal 을 부여하고 인접 diff 라벨을 만든다(캐시 재호출에도 동일)", () => {
    const s0: HistorySnapshot = [page("p1", [])];
    const s1 = repage(s0, "p1", { elements: [el("e1")] });
    const s2 = repage(s1, "p1", { elements: patchIn(s1[0].elements, "e1", { x: 77 }) });
    const history = [s0, s1, s2];

    const first = buildHistoryTimeline(history);
    expect(first).toEqual([
      { index: 0, ordinal: 1, label: HISTORY_INITIAL_LABEL },
      { index: 1, ordinal: 2, label: "텍스트 추가" },
      { index: 2, ordinal: 3, label: "텍스트 이동" },
    ]);
    // 같은 참조로 다시 빌드해도(재렌더) 동일 결과 — WeakMap 메모 경로.
    expect(buildHistoryTimeline(history)).toEqual(first);
    // coalesce 로 최상단 스냅샷이 교체(새 참조)되면 라벨도 새로 계산된다.
    const s2b = repage(s1, "p1", { elements: patchIn(s1[0].elements, "e1", { hidden: true }) });
    expect(buildHistoryTimeline([s0, s1, s2b])[2].label).toBe("텍스트 숨김");
  });
});

describe("planHistoryJump", () => {
  it("과거로/미래로/제자리 방향과 반복 횟수를 계산한다", () => {
    expect(planHistoryJump(5, 2, 10)).toEqual({ targetIndex: 2, direction: "undo", steps: 3 });
    expect(planHistoryJump(2, 7, 10)).toEqual({ targetIndex: 7, direction: "redo", steps: 5 });
    expect(planHistoryJump(4, 4, 10)).toEqual({ targetIndex: 4, direction: "none", steps: 0 });
  });

  it("범위 밖 입력은 클램프한다", () => {
    expect(planHistoryJump(3, -5, 6)).toEqual({ targetIndex: 0, direction: "undo", steps: 3 });
    expect(planHistoryJump(3, 99, 6)).toEqual({ targetIndex: 5, direction: "redo", steps: 2 });
    // 현재 인덱스가 범위 밖이어도(방어) 클램프 후 계산.
    expect(planHistoryJump(99, 1, 4)).toEqual({ targetIndex: 1, direction: "undo", steps: 2 });
    expect(planHistoryJump(0, 0, 0)).toEqual({ targetIndex: 0, direction: "none", steps: 0 });
  });
});

describe("sliceHistoryForDisplay", () => {
  it("상한 이하는 그대로, 초과 시 최신 쪽을 남기고 숨긴 수를 알려준다", () => {
    const small = [1, 2, 3];
    expect(sliceHistoryForDisplay(small, 5)).toEqual({ visible: [1, 2, 3], hiddenCount: 0 });

    const many = Array.from({ length: 70 }, (_, i) => i);
    const { visible, hiddenCount } = sliceHistoryForDisplay(many);
    expect(HISTORY_PANEL_MAX_VISIBLE).toBe(60);
    expect(visible).toHaveLength(60);
    expect(visible[0]).toBe(10);
    expect(visible[59]).toBe(69);
    expect(hiddenCount).toBe(10);
  });
});
