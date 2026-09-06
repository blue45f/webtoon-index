import { describe, expect, it } from "vitest";

import {
  NODE_EDIT_DEFAULT_PRESSURE,
  beginNodeDrag,
  decimateStrokeHandles,
  hitTestNodeHandle,
  isNodeEditableKind,
  isPressureWidthBrush,
  updateNodeDragMove,
  updateNodeDragWidth,
  withPointMoved,
  withPressureEdited,
} from "./studio-node-edit";

/** 직선을 따라 n개 점을 spacing 간격으로 생성 — [0,0, spacing,0, 2*spacing,0, ...]. */
function straightLinePoints(n: number, spacing = 1): number[] {
  return Array.from({ length: n }, (_, i) => [i * spacing, 0]).flat();
}

describe("decimateStrokeHandles", () => {
  it("빈 points → []", () => {
    expect(decimateStrokeHandles([])).toEqual([]);
  });

  it("점 하나 → 그 점 하나", () => {
    const handles = decimateStrokeHandles([10, 20]);
    expect(handles).toEqual([{ pointIndex: 0, x: 10, y: 20 }]);
  });

  it("짧은 2점 스트로크 → 핸들 [0, 1]", () => {
    const points = [0, 0, 100, 0];
    const handles = decimateStrokeHandles(points);
    expect(handles.map((h) => h.pointIndex)).toEqual([0, 1]);
  });

  it("긴 스트로크(200점, 직선)는 minSpacingPx 를 지키고 첫/끝점을 항상 포함한다", () => {
    const points = straightLinePoints(200, 1);
    const handles = decimateStrokeHandles(points, { minSpacingPx: 26 });
    expect(handles[0]!.pointIndex).toBe(0);
    expect(handles.at(-1)!.pointIndex).toBe(199);
    for (let i = 1; i < handles.length - 1; i++) {
      const dist = Math.hypot(handles[i]!.x - handles[i - 1]!.x, handles[i]!.y - handles[i - 1]!.y);
      expect(dist).toBeGreaterThanOrEqual(26);
    }
  });

  it("500점 합성 스트로크는 maxHandles 를 절대 넘지 않는다", () => {
    // 점 사이 간격(100px)이 기본 minSpacingPx(26)보다 훨씬 커서 1단계에서 거의 전부 채택된 뒤
    // 2단계 캡으로 잘려나가는 경로를 검증한다.
    const points = straightLinePoints(500, 100);
    const handles = decimateStrokeHandles(points);
    expect(handles.length).toBeLessThanOrEqual(48);
    expect(handles.length).toBeGreaterThan(2);

    const capped = decimateStrokeHandles(points, { maxHandles: 10 });
    expect(capped.length).toBeLessThanOrEqual(10);
  });

  it("결과 pointIndex 는 항상 오름차순·중복 없음", () => {
    const points = straightLinePoints(500, 100);
    const handles = decimateStrokeHandles(points, { maxHandles: 10 });
    for (let i = 1; i < handles.length; i++) {
      expect(handles[i]!.pointIndex).toBeGreaterThan(handles[i - 1]!.pointIndex);
    }
  });
});

describe("hitTestNodeHandle", () => {
  const handles = [
    { pointIndex: 0, x: 0, y: 0 },
    { pointIndex: 1, x: 100, y: 0 },
    { pointIndex: 2, x: 102, y: 0 },
  ];

  it("허용 오차 안이면 가장 가까운 핸들의 pointIndex 를 반환한다", () => {
    expect(hitTestNodeHandle({ x: 2, y: 1 }, handles, 10)).toBe(0);
  });

  it("허용 오차 밖이면 null", () => {
    expect(hitTestNodeHandle({ x: 50, y: 50 }, handles, 5)).toBeNull();
  });

  it("빈 핸들 목록이면 null", () => {
    expect(hitTestNodeHandle({ x: 0, y: 0 }, [], 100)).toBeNull();
  });

  it("두 핸들이 모두 범위 안이면 더 가까운 쪽을 반환한다", () => {
    // (101,0) 은 index1(100,0, 거리1)과 index2(102,0, 거리1)... 좀 더 명확하게 101.7 사용
    expect(hitTestNodeHandle({ x: 101.7, y: 0 }, handles, 10)).toBe(2);
    expect(hitTestNodeHandle({ x: 100.3, y: 0 }, handles, 10)).toBe(1);
  });
});

describe("beginNodeDrag", () => {
  const points = [0, 0, 10, 20, 30, 40];

  it("범위 밖 pointIndex 면 null", () => {
    expect(beginNodeDrag(points, undefined, 5, "move", { x: 0, y: 0 })).toBeNull();
    expect(beginNodeDrag(points, undefined, -1, "move", { x: 0, y: 0 })).toBeNull();
  });

  it("pressures 가 undefined 면 pressureAt 폴백으로 startPressure 를 채운다", () => {
    const session = beginNodeDrag(points, undefined, 1, "width", { x: 5, y: 5 });
    expect(session).not.toBeNull();
    expect(session!.startPressure).toBe(NODE_EDIT_DEFAULT_PRESSURE);
    expect(session!.startX).toBe(10);
    expect(session!.startY).toBe(20);
  });

  it("pressures 가 있으면 해당 값을 스냅샷한다", () => {
    const session = beginNodeDrag(points, [0.1, 0.9, 0.4], 1, "width", { x: 5, y: 5 });
    expect(session!.startPressure).toBe(0.9);
  });
});

describe("updateNodeDragMove", () => {
  it("포인터를 (dx,dy) 만큼 옮기면 핸들도 정확히 (dx,dy) 만큼 이동한다(점프 없음)", () => {
    const points = [0, 0, 50, 50, 200, 10];
    for (const pointIndex of [0, 1, 2]) {
      const session = beginNodeDrag(points, undefined, pointIndex, "move", { x: 300, y: 300 })!;
      const next = updateNodeDragMove(session, { x: 305, y: 290 });
      expect(next.x).toBeCloseTo(session.startX + 5, 6);
      expect(next.y).toBeCloseTo(session.startY - 10, 6);
    }
  });
});

describe("updateNodeDragWidth", () => {
  const points = [0, 0, 10, 0];

  it("위로 끌면(pointer.y < startPointerY) 필압이 증가한다", () => {
    const session = beginNodeDrag(points, [0.5], 0, "width", { x: 0, y: 100 })!;
    const p = updateNodeDragWidth(session, { x: 0, y: 60 }, 140);
    expect(p).toBeGreaterThan(0.5);
  });

  it("아래로 끌면(pointer.y > startPointerY) 필압이 감소한다", () => {
    const session = beginNodeDrag(points, [0.5], 0, "width", { x: 0, y: 100 })!;
    const p = updateNodeDragWidth(session, { x: 0, y: 140 }, 140);
    expect(p).toBeLessThan(0.5);
  });

  it("극단적으로 끌어도 결과는 항상 [0,1] 로 클램프된다", () => {
    const session = beginNodeDrag(points, [0.5], 0, "width", { x: 0, y: 100 })!;
    expect(updateNodeDragWidth(session, { x: 0, y: -1e6 }, 140)).toBe(1);
    expect(updateNodeDragWidth(session, { x: 0, y: 1e6 }, 140)).toBe(0);
  });
});

describe("withPointMoved", () => {
  it("해당 (x,y) 쌍만 교체한다", () => {
    const points = [0, 0, 10, 10, 20, 20];
    const next = withPointMoved(points, 1, 99, 88);
    expect(next).toEqual([0, 0, 99, 88, 20, 20]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const points = [0, 0, 10, 10, 20, 20];
    const copy = points.slice();
    const next = withPointMoved(points, 1, 99, 88);
    expect(points).toEqual(copy);
    expect(next).not.toBe(points);
  });

  it("범위 밖 인덱스면 변경 없는 복사본을 반환한다", () => {
    const points = [0, 0, 10, 10];
    const next = withPointMoved(points, 5, 1, 1);
    expect(next).toEqual(points);
    expect(next).not.toBe(points);
  });
});

describe("withPressureEdited", () => {
  it("undefined 입력은 pointCount 만큼 기본값으로 채운 뒤 대상 인덱스를 교체한다", () => {
    const result = withPressureEdited(undefined, 3, 1, 0.9);
    expect(result).toEqual([NODE_EDIT_DEFAULT_PRESSURE, 0.9, NODE_EDIT_DEFAULT_PRESSURE]);
  });

  it("pointCount 보다 짧은 입력은 부족한 꼬리를 채운 뒤 교체한다", () => {
    const result = withPressureEdited([0.2], 3, 2, 0.7);
    expect(result).toEqual([0.2, NODE_EDIT_DEFAULT_PRESSURE, 0.7]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const pressures = [0.1, 0.2, 0.3];
    const copy = pressures.slice();
    withPressureEdited(pressures, 3, 0, 0.9);
    expect(pressures).toEqual(copy);
  });

  it("결과 길이는 항상 pointCount 와 같다", () => {
    expect(withPressureEdited([0.1, 0.2, 0.3, 0.4], 2, 0, 0.5)).toHaveLength(2);
    expect(withPressureEdited([], 5, 0, 0.5)).toHaveLength(5);
  });
});

describe("isNodeEditableKind", () => {
  it("undefined/freehand 는 true", () => {
    expect(isNodeEditableKind(undefined)).toBe(true);
    expect(isNodeEditableKind("freehand")).toBe(true);
  });

  it("도형 kind 는 false", () => {
    expect(isNodeEditableKind("rect")).toBe(false);
    expect(isNodeEditableKind("ellipse")).toBe(false);
    expect(isNodeEditableKind("line")).toBe(false);
    expect(isNodeEditableKind("star")).toBe(false);
  });
});

describe("isPressureWidthBrush", () => {
  it("pen/gpen/marker/watercolor(pen 모드)는 true", () => {
    expect(isPressureWidthBrush("pen", "pen")).toBe(true);
    expect(isPressureWidthBrush(undefined, "pen")).toBe(true);
    expect(isPressureWidthBrush("gpen", "pen")).toBe(true);
    expect(isPressureWidthBrush("marker", "pen")).toBe(true);
    expect(isPressureWidthBrush("watercolor", "pen")).toBe(true);
  });

  it("brush/pencil/highlighter/screentone(pen 모드)는 false", () => {
    expect(isPressureWidthBrush("brush", "pen")).toBe(false);
    expect(isPressureWidthBrush("pencil", "pen")).toBe(false);
    expect(isPressureWidthBrush("highlighter", "pen")).toBe(false);
    expect(isPressureWidthBrush("screentone", "pen")).toBe(false);
  });

  it("mode 가 eraser 면 브러시와 무관하게 true", () => {
    expect(isPressureWidthBrush("brush", "eraser")).toBe(true);
    expect(isPressureWidthBrush("pencil", "eraser")).toBe(true);
    expect(isPressureWidthBrush("highlighter", "eraser")).toBe(true);
    expect(isPressureWidthBrush("screentone", "eraser")).toBe(true);
    expect(isPressureWidthBrush(undefined, "eraser")).toBe(true);
  });
});
