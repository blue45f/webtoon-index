import { describe, it, expect } from "vitest";

import {
  PANEL_SPLIT_MAX_GUTTER_PX,
  PANEL_SPLIT_MIN_AREA_PX2,
  PANEL_SPLIT_MIN_SIDE_PX,
  beginPanelSplitDrag,
  clampPanelSplitGutter,
  frameAbsolutePolygon,
  frameShapeFromPolygon,
  planPanelSplit,
  polygonAreaAbs,
  previewPanelSplit,
  type FrameLikeShape,
} from "./studio-panel-split";

describe("clampPanelSplitGutter", () => {
  it("음수/NaN 은 0으로 클램프한다", () => {
    expect(clampPanelSplitGutter(-5)).toBe(0);
    expect(clampPanelSplitGutter(NaN)).toBe(0);
  });

  it("상한을 넘으면 PANEL_SPLIT_MAX_GUTTER_PX 로 클램프한다", () => {
    expect(clampPanelSplitGutter(PANEL_SPLIT_MAX_GUTTER_PX + 40)).toBe(PANEL_SPLIT_MAX_GUTTER_PX);
  });

  it("범위 안이면 그대로 통과한다", () => {
    expect(clampPanelSplitGutter(24)).toBe(24);
    expect(clampPanelSplitGutter(0)).toBe(0);
  });
});

describe("frameAbsolutePolygon", () => {
  it("사각형 프레임 → 4모서리 시계방향(좌상→우상→우하→좌하)", () => {
    const frame: FrameLikeShape = { x: 10, y: 20, width: 100, height: 50 };
    expect(frameAbsolutePolygon(frame)).toEqual([10, 20, 110, 20, 110, 70, 10, 70]);
  });

  it("기존 points(사선 쿼드)가 있으면 el.x/y 를 더해 절대화한다", () => {
    const frame: FrameLikeShape = {
      x: 5,
      y: 5,
      width: 200,
      height: 100,
      points: [20, 0, 200, 0, 180, 100, 0, 100],
    };
    expect(frameAbsolutePolygon(frame)).toEqual([25, 5, 205, 5, 185, 105, 5, 105]);
  });

  it("points.length < 6 이면 사각형으로 폴백한다(렌더러와 동일 임계치)", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 50, height: 30, points: [1, 2, 3, 4] };
    expect(frameAbsolutePolygon(frame)).toEqual([0, 0, 50, 0, 50, 30, 0, 30]);
  });
});

describe("previewPanelSplit — 기본 교차", () => {
  it("세로 직선이 사각형 중앙을 지나면 두 유효한 절반으로 나뉜다(세로 cutSegment)", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 200 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 150, y: -50 }, b: { x: 150, y: 250 } },
      gutterPx: 0,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(true);
    expect(preview!.cutSegment[0]).toBeCloseTo(150, 6);
    expect(preview!.cutSegment[2]).toBeCloseTo(150, 6);
    const areaA = polygonAreaAbs(preview!.polyA!);
    const areaB = polygonAreaAbs(preview!.polyB!);
    expect(areaA).toBeCloseTo(30000, 1); // gutterPx:0 → 300×200 의 정확히 절반씩
    expect(areaB).toBeCloseTo(30000, 1);
  });

  it("가로 직선이 사각형 중앙을 지나면 두 유효한 절반으로 나뉜다(가로 cutSegment)", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 200 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: -50, y: 100 }, b: { x: 350, y: 100 } },
      gutterPx: 0,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(true);
    expect(preview!.cutSegment[1]).toBeCloseTo(100, 6);
    expect(preview!.cutSegment[3]).toBeCloseTo(100, 6);
  });

  it("대각선 직선도 두 유효한 조각으로 나누고(비사각형) points 가 채워진다", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 300 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 0, y: 100 }, b: { x: 300, y: 200 } },
      gutterPx: 10,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(true);
    const shapeA = frameShapeFromPolygon(preview!.polyA!);
    const shapeB = frameShapeFromPolygon(preview!.polyB!);
    expect(shapeA.points).toBeDefined();
    expect(shapeB.points).toBeDefined();
  });

  it("선이 프레임을 벗어나면(교차 없음) null", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 100, height: 100 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 200, y: -50 }, b: { x: 200, y: 150 } },
      gutterPx: 0,
    });
    expect(preview).toBeNull();
  });

  it("선이 모서리 하나만 스치면(교차 <2) null", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 100, height: 100 };
    // y = -x 를 지나는 직선 — 정사각형(x,y>=0)은 원점(0,0)에서만 접한다.
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: -50, y: 50 }, b: { x: 50, y: -50 } },
      gutterPx: 0,
    });
    expect(preview).toBeNull();
  });

  it("드래그 길이 0(a===b) 이면 null", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 100, height: 100 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 10, y: 10 }, b: { x: 10, y: 10 } },
      gutterPx: 0,
    });
    expect(preview).toBeNull();
  });

  it("여백이 결과 크기를 최소 기준 아래로 만들면 valid:false(cutSegment 는 유지)", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 40, height: 40 };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 20, y: -10 }, b: { x: 20, y: 50 } },
      gutterPx: 60,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(false);
    expect(preview!.polyA).toBeNull();
    expect(preview!.polyB).toBeNull();
    expect(preview!.cutSegment[0]).toBeCloseTo(20, 6);
    expect(preview!.cutSegment[2]).toBeCloseTo(20, 6);
  });

  it("이미 사선(points)이 있는 프레임도 다시 자를 수 있다", () => {
    const frame: FrameLikeShape = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      points: [20, 0, 200, 0, 180, 100, 0, 100],
    };
    const preview = previewPanelSplit({
      frame,
      line: { a: { x: 100, y: -50 }, b: { x: 100, y: 150 } },
      gutterPx: 8,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(true);
    expect(preview!.polyA!.length).toBeGreaterThanOrEqual(6);
    expect(preview!.polyB!.length).toBeGreaterThanOrEqual(6);
  });
});

describe("previewPanelSplit — 여백 정확성(겹침 방지)", () => {
  it("세로 직선 절단 시 두 결과의 x축 간격이 정확히 gutterPx 다", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 200 };
    const gutter = 20;
    const plan = planPanelSplit({
      frame,
      line: { a: { x: 150, y: -50 }, b: { x: 150, y: 250 } },
      gutterPx: gutter,
    });
    expect(plan).not.toBeNull();
    const [left, right] = [plan!.shapeA, plan!.shapeB].sort((s1, s2) => s1.x - s2.x);
    expect(right.x - (left.x + left.width)).toBeCloseTo(gutter, 1);
  });

  it("가로 직선 절단 시 두 결과의 y축 간격이 정확히 gutterPx 다", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 200 };
    const gutter = 20;
    const plan = planPanelSplit({
      frame,
      line: { a: { x: -50, y: 100 }, b: { x: 350, y: 100 } },
      gutterPx: gutter,
    });
    expect(plan).not.toBeNull();
    const [top, bottom] = [plan!.shapeA, plan!.shapeB].sort((s1, s2) => s1.y - s2.y);
    expect(bottom.y - (top.y + top.height)).toBeCloseTo(gutter, 1);
  });

  it("대각선 절단 — 두 조각이 겹치지 않고 대략 여백 스트립만큼만 넓이가 줄어든다", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 300 };
    const gutter = 10;
    const line = { a: { x: 0, y: 100 }, b: { x: 300, y: 200 } };
    const preview = previewPanelSplit({ frame, line, gutterPx: gutter });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(true);
    const areaA = polygonAreaAbs(preview!.polyA!);
    const areaB = polygonAreaAbs(preview!.polyB!);
    const cutLen = Math.hypot(
      preview!.cutSegment[2] - preview!.cutSegment[0],
      preview!.cutSegment[3] - preview!.cutSegment[1]
    );
    // 사선 절단은 절단 변의 두 끝점을 같은 벡터로 평행 이동하므로(양쪽 인접 변까지 함께 변형),
    // 제거되는 넓이가 edgeLength×half 를 축 기준(가로/세로) 절단만큼 정확히 따르진 않는다
    // (등주부등식 보정항). 그래도 겹치면(부호 반전 버그) 제거량이 0 이하이거나 음수가 되므로,
    // "대략 gutter×cutLen 규모로, 분명히 줄었다"는 느슨한 범위로 겹침 유무를 검증한다.
    const removedStrip = cutLen * gutter;
    const originalArea = 300 * 300;
    const actualRemoved = originalArea - (areaA + areaB);
    expect(actualRemoved).toBeGreaterThan(removedStrip * 0.5);
    expect(actualRemoved).toBeLessThan(removedStrip * 1.5);
  });
});

describe("frameShapeFromPolygon", () => {
  it("축정렬 사각형 폴리곤 → points: undefined", () => {
    const shape = frameShapeFromPolygon([10, 20, 110, 20, 110, 70, 10, 70]);
    expect(shape).toEqual({ x: 10, y: 20, width: 100, height: 50, points: undefined });
  });

  it("비사각형 폴리곤 → points 가 채워지고, 절대화하면 원본 폴리곤을 재현한다(왕복)", () => {
    const original = [0, 0, 300, 0, 300, 100, 0, 200]; // 사다리꼴
    const shape = frameShapeFromPolygon(original);
    expect(shape.points).toBeDefined();
    const roundTripped = frameAbsolutePolygon({
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      points: shape.points,
    });
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i]).toBeCloseTo(original[i], 1);
    }
  });
});

describe("planPanelSplit", () => {
  it("유효한 분할이면 두 FrameShape 를 반환하고, points 키는 undefined 여도 항상 존재한다", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 300, height: 200 };
    const plan = planPanelSplit({
      frame,
      line: { a: { x: 150, y: -50 }, b: { x: 150, y: 250 } },
      gutterPx: 10,
    });
    expect(plan).not.toBeNull();
    expect("points" in plan!.shapeA).toBe(true);
    expect("points" in plan!.shapeB).toBe(true);
    expect(plan!.shapeA.points).toBeUndefined();
    expect(plan!.shapeB.points).toBeUndefined();
  });

  it("previewPanelSplit 이 null 이거나 invalid 면 null", () => {
    const frame: FrameLikeShape = { x: 0, y: 0, width: 100, height: 100 };
    expect(
      planPanelSplit({ frame, line: { a: { x: 10, y: 10 }, b: { x: 10, y: 10 } }, gutterPx: 0 })
    ).toBeNull();
    expect(
      planPanelSplit({
        frame: { x: 0, y: 0, width: 40, height: 40 },
        line: { a: { x: 20, y: -10 }, b: { x: 20, y: 50 } },
        gutterPx: 60,
      })
    ).toBeNull();
  });
});

describe("beginPanelSplitDrag", () => {
  it("targetFrameId·start 스냅샷을 담은 세션을 만든다", () => {
    const session = beginPanelSplitDrag("frame-1", { x: 12, y: 34 });
    expect(session).toEqual({ targetFrameId: "frame-1", start: { x: 12, y: 34 } });
  });
});

describe("상수", () => {
  it("최소 크기 기준값이 정의돼 있다", () => {
    expect(PANEL_SPLIT_MIN_SIDE_PX).toBeGreaterThan(0);
    expect(PANEL_SPLIT_MIN_AREA_PX2).toBeGreaterThan(0);
  });
});
