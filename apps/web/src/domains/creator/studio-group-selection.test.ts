
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import {
  EMPTY_GROUP_SELECTION,
  currentSelectionIds,
  expandSelectionIdsToGroupUnits,
  groupMemberIds,
  planAtomicSelectionAffineTransform,
  planAtomicSelectionTranslation,
  planGroupClickSelection,
  planGroupClickSelectionRelease,
  planGroupEnter,
  planGroupEscape,
  resolveClickUnit,
  selectionShapeForIds,
  type GroupSelectionGroupLike,
  type GroupSelectionItemLike,
  type GroupSelectionState,
} from "./studio-group-selection";

// z-order 배열 빌더 — "a" 또는 "a:g1"(그룹) 표기.
function items(spec: string[]): GroupSelectionItemLike[] {
  return spec.map((token) => {
    const [id, groupId] = token.split(":");
    return groupId ? { id: id!, groupId } : { id: id! };
  });
}

function groups(...ids: string[]): GroupSelectionGroupLike[] {
  return ids.map((id) => ({ id }));
}

function single(id: string): GroupSelectionState {
  return { selectedId: id, marqueeIds: [], activeGroupId: null };
}

function multi(ids: string[], activeGroupId: string | null = null): GroupSelectionState {
  return { selectedId: null, marqueeIds: ids, activeGroupId };
}

describe("selectionShapeForIds", () => {
  it("정규화: 0/1/2+ → 없음/단일/마퀴 (내비게이터 규약과 동일)", () => {
    expect(selectionShapeForIds([])).toEqual({ selectedId: null, marqueeIds: [] });
    expect(selectionShapeForIds(["a"])).toEqual({ selectedId: "a", marqueeIds: [] });
    expect(selectionShapeForIds(["a", "b"])).toEqual({ selectedId: null, marqueeIds: ["a", "b"] });
  });

  it("입력 배열을 변형하지 않고 새 배열을 반환한다", () => {
    const src = ["a", "b"];
    const out = selectionShapeForIds(src);
    expect(out.marqueeIds).not.toBe(src);
    expect(src).toEqual(["a", "b"]);
  });
});

describe("currentSelectionIds", () => {
  it("마퀴가 있으면 마퀴, 없으면 단일, 둘 다 없으면 빈 배열", () => {
    expect(currentSelectionIds(multi(["a", "b"]))).toEqual(["a", "b"]);
    expect(currentSelectionIds(single("a"))).toEqual(["a"]);
    expect(currentSelectionIds(EMPTY_GROUP_SELECTION)).toEqual([]);
  });
});

describe("groupMemberIds", () => {
  it("같은 groupId 멤버를 z-order 순서로 모은다", () => {
    const list = items(["a:g1", "b", "c:g1", "d:g1"]);
    expect(groupMemberIds(list, "g1")).toEqual(["a", "c", "d"]);
  });
});

describe("resolveClickUnit", () => {
  const list = items(["a:g1", "b:g1", "c", "d:g2", "e:g2"]);
  const known = new Set(["g1", "g2"]);

  it("그룹 밖에서 그룹 멤버 클릭 → 그룹 전체(진입 해제)", () => {
    expect(resolveClickUnit(list, known, "a", null)).toEqual({
      unit: ["a", "b"],
      nextActiveGroupId: null,
    });
  });

  it("무그룹 요소 클릭 → 단일(진입 해제)", () => {
    expect(resolveClickUnit(list, known, "c", null)).toEqual({
      unit: ["c"],
      nextActiveGroupId: null,
    });
  });

  it("진입 중 그 그룹의 자식 클릭 → 개별 자식(진입 유지)", () => {
    expect(resolveClickUnit(list, known, "b", "g1")).toEqual({
      unit: ["b"],
      nextActiveGroupId: "g1",
    });
  });

  it("진입 중 다른 그룹의 멤버 클릭 → 그 그룹 전체(진입 해제)", () => {
    expect(resolveClickUnit(list, known, "d", "g1")).toEqual({
      unit: ["d", "e"],
      nextActiveGroupId: null,
    });
  });

  it("삭제된(유령) 그룹 참조는 무그룹으로 취급 → 단일", () => {
    const orphan = items(["x:ghost", "y"]);
    expect(resolveClickUnit(orphan, new Set<string>(), "x", null)).toEqual({
      unit: ["x"],
      nextActiveGroupId: null,
    });
  });
});

describe("planGroupClickSelection — 일반 클릭", () => {
  const list = items(["a:g1", "b:g1", "c", "d:g2", "e:g2"]);
  const gs = groups("g1", "g2");

  it("그룹 멤버 클릭 → 그룹 전체를 마퀴로 선택", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "a",
      current: EMPTY_GROUP_SELECTION,
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: null });
  });

  it("무그룹 요소 클릭 → 단일 선택", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "c",
      current: single("a"),
    });
    expect(next).toEqual({ selectedId: "c", marqueeIds: [], activeGroupId: null });
  });

  it("다른 그룹 멤버 클릭 → 이전 그룹 선택을 대체", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "d",
      current: multi(["a", "b"]),
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["d", "e"], activeGroupId: null });
  });

  // 이 케이스의 예전 기대는 "누르는 즉시 b 하나로 좁힌다"였다. 그 즉시 좁힘이 곧 결함 D4다 —
  // 다중 선택 중 하나를 눌러 끌면 그 하나만 움직였다. 좁히기는 사라지지 않고 "드래그 없이 뗌"으로
  // 미뤄지므로, 두 단계를 함께 검증해 기대를 약화가 아니라 강화한다.
  it("진입 중 자식 클릭 → 누름은 다중 선택을 유지하고 진입도 유지", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "b",
      current: multi(["a", "b"], "g1"),
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: "g1" });
  });

  it("진입 중 자식 클릭 → 드래그 없이 뗐을 때 개별 선택으로 좁히고 진입 유지", () => {
    const released = planGroupClickSelectionRelease({
      items: list,
      groups: gs,
      clickedId: "b",
      current: multi(["a", "b"], "g1"),
    });
    expect(released).toEqual({ selectedId: "b", marqueeIds: [], activeGroupId: "g1" });
  });

  it("단일 요소만 있는 그룹은 단일 선택으로 정규화된다", () => {
    const solo = items(["a:g1", "b"]);
    const next = planGroupClickSelection({
      items: solo,
      groups: groups("g1"),
      clickedId: "a",
      current: EMPTY_GROUP_SELECTION,
    });
    expect(next).toEqual({ selectedId: "a", marqueeIds: [], activeGroupId: null });
  });
});

/**
 * 결함 D4 회귀 방지 — 러버밴드로 3개를 고른 뒤 가운데 하나를 끌면 3개가 함께 움직여야 한다.
 * 브라우저에서 측정된 증상은 헤더가 "3개 선택"→"1개 선택"으로 바뀌고 델타가
 * [{0,0},{+90,+60},{0,0}] 였다. 캔버스 드래그는 누름 직후의 선택(marqueeIds)을 이동 단위로
 * 읽으므로, 누름이 선택을 하나로 접으면 나머지 둘은 제자리에 남는다.
 */
describe("planGroupClickSelection — 다중 선택 멤버 누름(D4 회귀)", () => {
  const lines = items(["l1", "l2", "l3"]);
  const three = multi(["l1", "l2", "l3"]);

  it("무그룹 3개 선택 중 가운데를 Shift 없이 눌러도 선택 3개가 그대로 유지된다", () => {
    const next = planGroupClickSelection({
      items: lines,
      groups: [],
      clickedId: "l2",
      current: three,
    });
    expect(next).toEqual({
      selectedId: null,
      marqueeIds: ["l1", "l2", "l3"],
      activeGroupId: null,
    });
    // 반환값은 입력 배열을 재사용하지 않는다(호출부의 상태 변형 방지).
    expect(next.marqueeIds).not.toBe(three.marqueeIds);
  });

  it("드래그 없이 뗐을 때만 눌렀던 하나로 좁힌다", () => {
    const released = planGroupClickSelectionRelease({
      items: lines,
      groups: [],
      clickedId: "l2",
      current: three,
    });
    expect(released).toEqual({ selectedId: "l2", marqueeIds: [], activeGroupId: null });
  });

  it("선택 밖 요소를 누르면 유지하지 않고 즉시 그 요소로 대체한다", () => {
    const withOutsider = items(["l1", "l2", "l3", "l4"]);
    const next = planGroupClickSelection({
      items: withOutsider,
      groups: [],
      clickedId: "l4",
      current: three,
    });
    expect(next).toEqual({ selectedId: "l4", marqueeIds: [], activeGroupId: null });
    expect(
      planGroupClickSelectionRelease({
        items: withOutsider,
        groups: [],
        clickedId: "l4",
        current: three,
      })
    ).toBeNull();
  });

  it("단일 선택 상태에서 그 요소를 다시 눌러도 좁힐 게 없다(null)", () => {
    expect(
      planGroupClickSelectionRelease({
        items: lines,
        groups: [],
        clickedId: "l2",
        current: single("l2"),
      })
    ).toBeNull();
  });

  it("Shift 클릭은 유지 규칙을 타지 않는다 — 기존 토글 그대로", () => {
    const next = planGroupClickSelection({
      items: lines,
      groups: [],
      clickedId: "l2",
      current: three,
      additive: true,
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["l1", "l3"], activeGroupId: null });
    expect(
      planGroupClickSelectionRelease({
        items: lines,
        groups: [],
        clickedId: "l2",
        current: three,
        additive: true,
      })
    ).toBeNull();
  });

  it("혼합 선택(그룹 g1 + 낱개)에서 그룹 멤버를 누르면 전체를 유지하고, 뗐을 때 그룹 단위로 좁힌다", () => {
    const mixed = items(["a:g1", "b:g1", "c"]);
    const gs = groups("g1");
    const current = multi(["a", "b", "c"]);
    expect(
      planGroupClickSelection({ items: mixed, groups: gs, clickedId: "a", current })
    ).toEqual({ selectedId: null, marqueeIds: ["a", "b", "c"], activeGroupId: null });
    expect(
      planGroupClickSelectionRelease({ items: mixed, groups: gs, clickedId: "a", current })
    ).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: null });
  });

  it("선택이 곧 그룹 전체면(단위 == 선택) 유지·좁히기 모두 무의미하다", () => {
    const grouped = items(["a:g1", "b:g1"]);
    const gs = groups("g1");
    const current = multi(["a", "b"]);
    expect(
      planGroupClickSelection({ items: grouped, groups: gs, clickedId: "a", current })
    ).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: null });
    expect(
      planGroupClickSelectionRelease({ items: grouped, groups: gs, clickedId: "a", current })
    ).toBeNull();
  });

  it("유지된 선택은 원자 이동 계획을 그대로 통과시킨다 — 3개가 같은 델타로 움직인다", () => {
    const pressed = planGroupClickSelection({
      items: lines,
      groups: [],
      clickedId: "l2",
      current: three,
    });
    const docs = [
      { id: "l1", type: "draw", points: [191, 100, 200, 140] },
      { id: "l2", type: "draw", points: [241, 100, 250, 140] },
      { id: "l3", type: "draw", points: [291, 100, 300, 140] },
    ];
    const moved = planAtomicSelectionTranslation({
      items: docs,
      selectedIds: currentSelectionIds(pressed),
      deltaX: 90,
      deltaY: 60,
      isLocked: () => false,
    });
    expect(moved.map((item) => item.points?.[0])).toEqual([281, 331, 381]);
    expect(moved.map((item) => item.points?.[1])).toEqual([160, 160, 160]);
  });
});

describe("planGroupClickSelection — Shift 가산", () => {
  const list = items(["a:g1", "b:g1", "c", "d:g2", "e:g2"]);
  const gs = groups("g1", "g2");

  it("그룹 단위로 추가(z-order 유지)", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "d",
      current: multi(["a", "b"]),
      additive: true,
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["a", "b", "d", "e"], activeGroupId: null });
  });

  it("이미 전부 선택된 그룹을 Shift 클릭 → 그룹 단위 제거", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "d",
      current: multi(["a", "b", "d", "e"]),
      additive: true,
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: null });
  });

  it("단일 선택에 무그룹 요소를 Shift 추가 → 마퀴로 승격", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "c",
      current: single("a"),
      additive: true,
    });
    // "a"는 g1 소속이지만 가산의 기준은 현재 선택 집합이다 — 클릭 대상 c(무그룹)만 단위.
    expect(next).toEqual({ selectedId: null, marqueeIds: ["a", "c"], activeGroupId: null });
  });

  it("가산 결과가 1개면 단일로 정규화", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "c",
      current: single("c"),
      additive: true,
    });
    expect(next).toEqual({ selectedId: null, marqueeIds: [], activeGroupId: null });
  });

  it("가산 선택은 진입 상태를 해제한다(최상위 작업)", () => {
    const next = planGroupClickSelection({
      items: list,
      groups: gs,
      clickedId: "d",
      current: multi(["a"], "g1"),
      additive: true,
    });
    expect(next.activeGroupId).toBeNull();
  });
});

describe("planGroupEnter — 더블클릭 진입", () => {
  const list = items(["a:g1", "b:g1", "c"]);
  const gs = groups("g1");

  it("그룹 멤버 더블클릭 → 진입 + 개별 자식 선택", () => {
    expect(planGroupEnter({ items: list, groups: gs, clickedId: "a" })).toEqual({
      selectedId: "a",
      marqueeIds: [],
      activeGroupId: "g1",
    });
  });

  it("무그룹 요소 더블클릭 → 진입 없이 단일 선택", () => {
    expect(planGroupEnter({ items: list, groups: gs, clickedId: "c" })).toEqual({
      selectedId: "c",
      marqueeIds: [],
      activeGroupId: null,
    });
  });
});

describe("planGroupEscape — 한 단계 위로", () => {
  const list = items(["a:g1", "b:g1", "c"]);

  it("진입 중이면 진입 해제 + 그룹 전체 재선택", () => {
    expect(
      planGroupEscape({ items: list, current: { selectedId: "a", marqueeIds: [], activeGroupId: "g1" } })
    ).toEqual({ selectedId: null, marqueeIds: ["a", "b"], activeGroupId: null });
  });

  it("진입 상태가 아니면 null(호출부가 기본 Escape 처리)", () => {
    expect(planGroupEscape({ items: list, current: single("c") })).toBeNull();
  });
});

describe("planAtomicSelectionTranslation — 그룹 드래그 원자 계획", () => {
  type Movable =
    | { id: string; type: "image"; x: number; y: number; locked?: boolean; groupId?: string }
    | { id: string; type: "draw"; points: number[]; locked?: boolean; groupId?: string }
    | { id: string; type: "meta"; locked?: boolean; groupId?: string };

  it("좌표형 요소와 선화를 같은 delta로 옮기고 선택 밖 참조를 보존한다", () => {
    const coordinate: Movable = { id: "image", type: "image", x: 10, y: 20 };
    const draw: Movable = { id: "ink", type: "draw", points: [1, 2, 5, 8] };
    const outside: Movable = { id: "outside", type: "image", x: 100, y: 120 };
    const next = planAtomicSelectionTranslation({
      items: [coordinate, draw, outside],
      selectedIds: ["image", "ink"],
      deltaX: 7,
      deltaY: -3,
      isLocked: () => false,
    });

    expect(next).toEqual([
      { id: "image", type: "image", x: 17, y: 17 },
      { id: "ink", type: "draw", points: [8, -1, 12, 5] },
      outside,
    ]);
    expect(next[2]).toBe(outside);
  });

  it("그룹 메타가 unlocked여도 child 하나가 잠기면 일부만 옮기지 않고 전체를 fail-closed 한다", () => {
    const group = { id: "mixed-lock-group", locked: false };
    const locked: Movable = {
      id: "locked",
      type: "image",
      x: 2,
      y: 3,
      locked: true,
      groupId: group.id,
    };
    const free: Movable = {
      id: "free",
      type: "draw",
      points: [4, 5, 6, 7],
      groupId: group.id,
    };
    const items = [locked, free];
    const next = planAtomicSelectionTranslation({
      items,
      selectedIds: ["locked", "free"],
      deltaX: 10,
      deltaY: 20,
      isLocked: (item) =>
        item.locked === true || (item.groupId === group.id && group.locked),
    });

    expect(next).not.toBe(items);
    expect(next).toEqual(items);
    expect(next[0]).toBe(locked);
    expect(next[1]).toBe(free);
  });

  it("선택 멤버가 사라졌거나 이동 기하가 없으면 전체를 fail-closed 한다", () => {
    const free: Movable = { id: "free", type: "image", x: 2, y: 3 };
    const unsupported: Movable = { id: "meta", type: "meta" };

    const missing = planAtomicSelectionTranslation({
      items: [free],
      selectedIds: ["free", "missing"],
      deltaX: 10,
      deltaY: 20,
      isLocked: () => false,
    });
    const invalid = planAtomicSelectionTranslation({
      items: [free, unsupported],
      selectedIds: ["free", "meta"],
      deltaX: 10,
      deltaY: 20,
      isLocked: () => false,
    });

    expect(missing[0]).toBe(free);
    expect(invalid[0]).toBe(free);
    expect(invalid[1]).toBe(unsupported);
  });

  it("0 delta는 빈 undo 후보를 만들지 않도록 모든 요소 참조를 보존한다", () => {
    const source: Movable[] = [
      { id: "image", type: "image", x: 10, y: 20 },
      { id: "ink", type: "draw", points: [1, 2] },
    ];
    const next = planAtomicSelectionTranslation({
      items: source,
      selectedIds: ["image", "ink"],
      deltaX: 0,
      deltaY: 0,
      isLocked: () => false,
    });

    expect(next).not.toBe(source);
    expect(next[0]).toBe(source[0]);
    expect(next[1]).toBe(source[1]);
  });
});

describe("expandSelectionIdsToGroupUnits — 마퀴/우클릭 그룹 단위 확장", () => {
  const list = [
    { id: "a", groupId: "g" },
    { id: "b", groupId: "g" },
    { id: "c" },
    { id: "d", groupId: "ghost" },
  ];
  const knownGroups = [{ id: "g" }];

  it("그룹 밖에서는 자식 하나만 hit돼도 전체 그룹을 z-order로 선택한다", () => {
    expect(
      expandSelectionIdsToGroupUnits(list, knownGroups, ["b", "c"], null)
    ).toEqual(["a", "b", "c"]);
  });

  it("그룹 내부 편집 중에는 해당 그룹 자식을 개별 선택으로 유지한다", () => {
    expect(expandSelectionIdsToGroupUnits(list, knownGroups, ["b"], "g")).toEqual([
      "b",
    ]);
  });

  it("유령 그룹과 알 수 없는 hit id는 단일/무시로 결정론적으로 처리한다", () => {
    expect(
      expandSelectionIdsToGroupUnits(list, knownGroups, ["unknown", "d", "d"], null)
    ).toEqual(["d"]);
  });
});

describe("planAtomicSelectionAffineTransform — 혼합 그룹 전체 변형", () => {
  type AffineItem =
    | {
        id: string;
        type: "image";
        x: number;
        y: number;
        width: number;
        height: number;
        locked?: boolean;
      }
    | { id: string; type: "draw"; points: number[]; locked?: boolean }
    | { id: string; type: "meta"; locked?: boolean };

  const sourceBounds = { x: 10, y: 20, width: 40, height: 20 };

  it("object box와 draw points를 같은 translation+scale로 한 번에 변환한다", () => {
    const outside: AffineItem = {
      id: "outside",
      type: "image",
      x: 100,
      y: 120,
      width: 30,
      height: 40,
    };
    const result = planAtomicSelectionAffineTransform({
      items: [
        { id: "box", type: "image", x: 10, y: 20, width: 10, height: 5 },
        { id: "ink", type: "draw", points: [20, 25, 30, 35] },
        outside,
      ],
      selectedIds: ["box", "ink"],
      sourceBounds,
      translateX: 5,
      translateY: -10,
      scaleX: 2,
      scaleY: 3,
      isLocked: () => false,
    });

    expect(result).toEqual({
      kind: "applied",
      orderedSelectedIds: ["box", "ink"],
      items: [
        { id: "box", type: "image", x: 15, y: 10, width: 20, height: 15 },
        { id: "ink", type: "draw", points: [35, 25, 55, 55] },
        outside,
      ],
    });
    expect(result.items[2]).toBe(outside);
  });

  it("선택 멤버 하나라도 잠기면 unlocked 멤버까지 포함해 전체를 fail-closed no-op한다", () => {
    const free: AffineItem = {
      id: "free",
      type: "image",
      x: 10,
      y: 20,
      width: 10,
      height: 5,
    };
    const locked: AffineItem = {
      id: "locked",
      type: "draw",
      points: [20, 25, 30, 35],
      locked: true,
    };
    const result = planAtomicSelectionAffineTransform({
      items: [free, locked],
      selectedIds: ["free", "locked"],
      sourceBounds,
      translateX: 10,
      translateY: 10,
      scaleX: 2,
      scaleY: 2,
      isLocked: (item) => item.locked === true,
    });

    expect(result).toEqual({
      kind: "no-op",
      reason: "locked-selection-member",
      items: [free, locked],
      orderedSelectedIds: ["free", "locked"],
    });
    expect(result.items[0]).toBe(free);
    expect(result.items[1]).toBe(locked);
  });

  it("0 크기 source bounds 축은 이동은 허용하지만 해당 축의 scale은 no-op한다", () => {
    const pointBox: AffineItem = {
      id: "point-box",
      type: "image",
      x: 10,
      y: 20,
      width: 0,
      height: 0,
    };
    const scaled = planAtomicSelectionAffineTransform({
      items: [pointBox],
      selectedIds: ["point-box"],
      sourceBounds: { x: 10, y: 20, width: 0, height: 0 },
      translateX: 0,
      translateY: 0,
      scaleX: 2,
      scaleY: 1,
      isLocked: () => false,
    });
    const translated = planAtomicSelectionAffineTransform({
      items: [pointBox],
      selectedIds: ["point-box"],
      sourceBounds: { x: 10, y: 20, width: 0, height: 0 },
      translateX: 4,
      translateY: -6,
      scaleX: 1,
      scaleY: 1,
      isLocked: () => false,
    });

    expect(scaled).toMatchObject({
      kind: "no-op",
      reason: "zero-size-source-bounds",
    });
    expect(translated).toEqual({
      kind: "applied",
      orderedSelectedIds: ["point-box"],
      items: [
        {
          id: "point-box",
          type: "image",
          x: 14,
          y: 14,
          width: 0,
          height: 0,
        },
      ],
    });
  });

  it("음수 scale은 draw 좌표를 반전하고 object box는 양수 크기의 canonical box로 만든다", () => {
    const result = planAtomicSelectionAffineTransform({
      items: [
        { id: "box", type: "image", x: 12, y: 22, width: 6, height: 4 },
        { id: "ink", type: "draw", points: [12, 22, 18, 26] },
      ],
      selectedIds: ["box", "ink"],
      sourceBounds,
      translateX: 30,
      translateY: 0,
      scaleX: -2,
      scaleY: -0.5,
      isLocked: () => false,
    });

    expect(result).toEqual({
      kind: "applied",
      orderedSelectedIds: ["box", "ink"],
      items: [
        { id: "box", type: "image", x: 24, y: 17, width: 12, height: 2 },
        { id: "ink", type: "draw", points: [36, 19, 24, 17] },
      ],
    });
  });

  it("selectedIds 순서·중복과 무관하게 items z-order의 동일 결과를 만든다", () => {
    const source: AffineItem[] = [
      { id: "box", type: "image", x: 10, y: 20, width: 10, height: 5 },
      { id: "ink", type: "draw", points: [20, 25, 30, 35] },
    ];
    const plan = (selectedIds: readonly string[]) =>
      planAtomicSelectionAffineTransform({
        items: source,
        selectedIds,
        sourceBounds,
        translateX: 8,
        translateY: -3,
        scaleX: 1.5,
        scaleY: 0.5,
        isLocked: () => false,
      });

    const forward = plan(["box", "ink"]);
    const reverseWithDuplicate = plan(["ink", "box", "ink"]);

    expect(reverseWithDuplicate).toEqual(forward);
    expect(forward.orderedSelectedIds).toEqual(["box", "ink"]);
  });

  it("지원하지 않는 멤버가 섞이면 일부만 변형하지 않는다", () => {
    const box: AffineItem = {
      id: "box",
      type: "image",
      x: 10,
      y: 20,
      width: 10,
      height: 5,
    };
    const meta: AffineItem = { id: "meta", type: "meta" };
    const result = planAtomicSelectionAffineTransform({
      items: [box, meta],
      selectedIds: ["box", "meta"],
      sourceBounds,
      translateX: 1,
      translateY: 1,
      scaleX: 2,
      scaleY: 2,
      isLocked: () => false,
    });

    expect(result).toEqual({
      kind: "no-op",
      reason: "unsupported-member-geometry",
      items: [box, meta],
      orderedSelectedIds: ["box", "meta"],
    });
  });
});

/**
 * 순수 함수만으로는 D4가 다시 살아나는 걸 못 막는다 — 좁히기를 "드래그 없는 뗌"으로 미룬 이상,
 * 그 뗌을 실제로 받아 주는 배선이 사라지면 다중 선택이 영영 안 좁혀진다. 배선 계약을 소스로 고정한다.
 * (같은 도메인의 `studio-group-convenience-boundary.test.ts` 가 쓰는 것과 동일한 소스 계약 패턴.)
 */
describe("캔버스 배선 계약 — 뗌 단계 좁히기", () => {
  const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

  it("Stage 의 click/tap 이 planGroupClickSelectionRelease 로 간다", () => {
    expect(viewportSource).toContain("planGroupClickSelectionRelease");
    expect(viewportSource).toContain("onClick={narrowCanvasSelectionOnRelease}");
    expect(viewportSource).toContain("onTap={narrowCanvasSelectionOnRelease}");
  });

  it("누름 경로는 그대로 planGroupClickSelection(=selectElementFromCanvas)에 남아 있다", () => {
    expect(viewportSource).toContain("onMouseDown={onSelect}");
    expect(viewportSource).toContain("onTap={onSelect}");
  });
});

describe("무그룹 문서 하위호환", () => {
  it("그룹이 하나도 없으면 항상 단일 선택으로 동작(회귀 방지)", () => {
    const list = items(["a", "b", "c"]);
    const next = planGroupClickSelection({
      items: list,
      groups: [],
      clickedId: "b",
      current: single("a"),
    });
    expect(next).toEqual({ selectedId: "b", marqueeIds: [], activeGroupId: null });
  });
});
