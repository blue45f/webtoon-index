import { describe, expect, it } from "vitest";

import {
  EMPTY_FREEHAND_OBJECT_SNAP_LATCH,
  EMPTY_SMART_GUIDE_OVERLAY,
  SMART_GUIDE_EPSILON,
  SMART_SNAP_THRESHOLD,
  buildPointObjectSnapOverlay,
  buildSmartGuideOverlay,
  buildSmartGuideOverlayPreview,
  computeSmartSnap,
  planFreehandObjectSnapPoint,
  shouldApplyStrokeObjectSnap,
  shouldMutateStrokeWithObjectSnap,
  smartGuideOverlaysEqual,
  snapPointToObjectGuides,
  type GuideBox,
  type SmartGuideOverlay,
} from "./studio-smart-guides";

/** 테스트용 박스 빌더. */
const box = (id: string, x: number, y: number, width: number, height: number): GuideBox => ({
  id,
  x,
  y,
  width,
  height,
});

describe("computeSmartSnap — 엣지/센터 정렬", () => {
  it("다른 요소의 오른쪽 엣지에 왼쪽 엣지가 임계 이내면 스냅 오프셋을 낸다", () => {
    const moving = box("m", 103, 200, 50, 40);
    const result = computeSmartSnap(moving, [box("a", 0, 0, 100, 50)]);
    expect(result.x).toEqual({ delta: -3, dist: 3, kind: "edge" });
    expect(result.y).toBeNull();
  });

  it("센터-센터 정렬은 kind가 center다", () => {
    const moving = box("m", 110, 300, 80, 40); // 센터 x=150
    const result = computeSmartSnap(moving, [box("a", 100, 0, 100, 100)]); // 센터 x=150
    expect(result.x).toEqual({ delta: 0, dist: 0, kind: "center" });
    expect(result.y).toBeNull();
  });

  it("기본 임계(6px)를 넘으면 후보가 없다", () => {
    const moving = box("m", 107, 300, 50, 40); // 좌변-우변 거리 7
    const result = computeSmartSnap(moving, [box("a", 0, 0, 100, 50)]);
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
  });

  it("정확히 임계 거리(6px)면 스냅한다", () => {
    const moving = box("m", 106, 300, 50, 40);
    const result = computeSmartSnap(moving, [box("a", 0, 0, 100, 50)]);
    expect(result.x).toEqual({ delta: -6, dist: 6, kind: "edge" });
  });

  it("threshold 옵션으로 임계를 넓힐 수 있다", () => {
    const moving = box("m", 110, 300, 50, 40); // 거리 10
    expect(computeSmartSnap(moving, [box("a", 0, 0, 100, 50)]).x).toBeNull();
    const wide = computeSmartSnap(moving, [box("a", 0, 0, 100, 50)], { threshold: 12 });
    expect(wide.x).toEqual({ delta: -10, dist: 10, kind: "edge" });
  });

  it("여러 후보 중 가장 가까운 요소가 이긴다", () => {
    const moving = box("m", 104, 0, 50, 50);
    const result = computeSmartSnap(moving, [
      box("a", 0, 0, 100, 50), // 우변 100 vs 좌변 104 → 거리 4
      box("b", 156, 200, 40, 50), // 좌변 156 vs 우변 154 → 거리 2(다른 줄이라 간격 후보는 없음)
    ]);
    expect(result.x).toEqual({ delta: 2, dist: 2, kind: "edge" });
  });

  it("자기 자신(id 동일)과 비정상(NaN·음수 크기) 박스는 무시한다", () => {
    const moving = box("m", 103, 200, 50, 40);
    const result = computeSmartSnap(moving, [
      box("m", 100, 200, 50, 40), // 자기 자신
      box("n", Number.NaN, 200, 50, 40),
      box("neg", 100, 200, -50, 40),
    ]);
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
  });

  it("이동 박스 자체가 비정상이면 아무 후보도 내지 않는다", () => {
    const result = computeSmartSnap(box("m", Number.NaN, 0, 10, 10), [box("a", 0, 0, 100, 50)]);
    expect(result).toEqual({ x: null, y: null });
  });

  it("완전 일치를 찾으면 조기 종료해도 결과가 정확하다", () => {
    const moving = box("m", 100, 100, 100, 100);
    const others = [box("a", 100, 100, 100, 100)];
    for (let i = 0; i < 300; i++) others.push(box(`f${i}`, 1000 + i * 7, 1000 + i * 3, 40, 40));
    const result = computeSmartSnap(moving, others);
    expect(result.x).toEqual({ delta: 0, dist: 0, kind: "edge" });
    expect(result.y).toEqual({ delta: 0, dist: 0, kind: "edge" });
  });
});

describe("computeSmartSnap — 균등 간격", () => {
  // 왼쪽 이웃(우변 100)·오른쪽 이웃(좌변 300) 사이, 폭 80 → 균등 gap 60, 목표 x=160.
  const left = box("l", 0, 0, 100, 100);
  const right = box("r", 300, 0, 100, 100);

  it("양옆 이웃과 gap이 같아지는 정중앙 위치로 스냅 후보를 낸다", () => {
    const moving = box("m", 157, 10, 80, 50);
    const result = computeSmartSnap(moving, [left, right]);
    expect(result.x).toEqual({ delta: 3, dist: 3, kind: "spacing" });
    expect(result.y).toBeNull();
  });

  it("더 가까운 정렬 후보가 있으면 정렬이 이긴다", () => {
    const moving = box("m", 157, 10, 80, 50);
    const result = computeSmartSnap(moving, [left, right, box("c", 158, 200, 80, 50)]); // 좌변 정렬 거리 1
    expect(result.x).toEqual({ delta: 1, dist: 1, kind: "edge" });
  });

  it("교차축으로 겹치지 않는 요소는 이웃이 아니다", () => {
    const moving = box("m", 157, 10, 80, 50);
    const farRight = box("r", 300, 500, 100, 100); // 세로로 다른 줄
    const result = computeSmartSnap(moving, [left, farRight]);
    expect(result.x).toBeNull();
  });

  it("이웃 사이 공간이 요소보다 좁으면 간격 후보를 내지 않는다", () => {
    // 두 이웃을 살짝 침범 중(허용치 내) — 공간 95 < 폭 102라 spacing이면 dist 0.5로 이겼을 상황.
    const moving = box("m", 97, 10, 102, 50);
    const result = computeSmartSnap(moving, [box("l", 0, 0, 100, 100), box("r", 195, 0, 100, 100)]);
    expect(result.x?.kind).not.toBe("spacing");
  });

  it("이동 요소를 덮는 큰 배경은 이웃에서 제외된다", () => {
    const moving = box("m", 157, 10, 80, 50);
    const backdrop = box("bg", -10, 0, 520, 200);
    const result = computeSmartSnap(moving, [backdrop, left, right]);
    expect(result.x).toEqual({ delta: 3, dist: 3, kind: "spacing" });
  });

  it("세로(위아래) 균등 간격도 지원한다", () => {
    const top = box("t", 0, 0, 100, 100);
    const bottom = box("b", 0, 300, 100, 100);
    const moving = box("m", 10, 158, 80, 80); // 목표 y=160
    const result = computeSmartSnap(moving, [top, bottom]);
    expect(result.y).toEqual({ delta: 2, dist: 2, kind: "spacing" });
    expect(result.x).toEqual({ delta: 0, dist: 0, kind: "center" }); // 센터 x=50 동일
  });
});

describe("buildSmartGuideOverlay — 정렬 선분", () => {
  it("맞은 엣지에 두 요소를 잇는 수직 선분을 만든다", () => {
    const moved = box("m", 100, 200, 50, 40);
    const overlay = buildSmartGuideOverlay(moved, [box("a", 0, 0, 100, 50)]);
    expect(overlay.segments).toEqual([{ axis: "v", pos: 100, from: 0, to: 240, kind: "edge" }]);
    expect(overlay.spacings).toEqual([]);
  });

  it("같은 기준선에 맞은 여러 요소를 한 선분으로 병합한다", () => {
    const moved = box("m", 100, 200, 50, 40);
    const overlay = buildSmartGuideOverlay(moved, [
      box("a", 0, 0, 100, 50), // 우변 100, y 0~50
      box("b", 100, 500, 80, 60), // 좌변 100, y 500~560
    ]);
    expect(overlay.segments).toEqual([{ axis: "v", pos: 100, from: 0, to: 560, kind: "edge" }]);
  });

  it("센터끼리만 맞으면 kind가 center다", () => {
    const moved = box("m", 110, 300, 80, 40); // 센터 x=150
    const overlay = buildSmartGuideOverlay(moved, [box("a", 100, 0, 100, 100)]);
    expect(overlay.segments).toEqual([{ axis: "v", pos: 150, from: 0, to: 340, kind: "center" }]);
  });

  it("허용 오차(기본 0.5px) 이내만 선분으로 인정한다", () => {
    const near = buildSmartGuideOverlay(box("m", 100.4, 200, 50, 40), [box("a", 0, 0, 100, 50)]);
    expect(near.segments).toHaveLength(1);
    const far = buildSmartGuideOverlay(box("m", 100.8, 200, 50, 40), [box("a", 0, 0, 100, 50)]);
    expect(far.segments).toHaveLength(0);
  });

  it("0폭 요소는 좌·중·우가 겹쳐도 선분 하나로 합친다", () => {
    const moved = box("m", 100, 0, 0, 50);
    const overlay = buildSmartGuideOverlay(moved, [box("a", 0, 100, 100, 60)]);
    expect(overlay.segments).toEqual([{ axis: "v", pos: 100, from: 0, to: 160, kind: "edge" }]);
  });

  it("아무것도 맞지 않으면 공용 빈 오버레이 참조를 돌려준다", () => {
    const overlay = buildSmartGuideOverlay(box("m", 400, 400, 50, 50), [box("a", 0, 0, 100, 50)]);
    expect(overlay).toBe(EMPTY_SMART_GUIDE_OVERLAY);
  });
});

describe("buildSmartGuideOverlay — 균등 간격 배지", () => {
  const left = box("l", 0, 0, 100, 100);
  const right = box("r", 300, 0, 100, 100);

  it("양쪽 gap이 같으면 간격 구간 두 개와 gap 값을 만든다", () => {
    const overlay = buildSmartGuideOverlay(box("m", 160, 10, 80, 50), [left, right]);
    expect(overlay.spacings).toEqual([
      {
        axis: "x",
        gap: 60,
        at: 35, // 공통 겹침 y 10~60의 중앙
        spans: [
          { from: 100, to: 160 },
          { from: 240, to: 300 },
        ],
      },
    ]);
  });

  it("gap이 다르면 배지를 만들지 않는다", () => {
    const overlay = buildSmartGuideOverlay(box("m", 150, 10, 80, 50), [left, right]); // 50 vs 70
    expect(overlay.spacings).toEqual([]);
  });

  it("맞닿은 gap 0도 균등으로 인정한다", () => {
    const overlay = buildSmartGuideOverlay(box("m", 100, 10, 100, 50), [left, box("r", 200, 0, 100, 100)]);
    expect(overlay.spacings).toHaveLength(1);
    expect(overlay.spacings[0].gap).toBe(0);
  });
});

describe("smartGuideOverlaysEqual — 상태 참조 유지용 동등 비교", () => {
  const overlayA = (): SmartGuideOverlay => ({
    segments: [{ axis: "v", pos: 100, from: 0, to: 240, kind: "edge" }],
    spacings: [
      {
        axis: "x",
        gap: 60,
        at: 35,
        spans: [
          { from: 100, to: 160 },
          { from: 240, to: 300 },
        ],
      },
    ],
  });

  it("내용이 같으면(참조 달라도) true", () => {
    expect(smartGuideOverlaysEqual(overlayA(), overlayA())).toBe(true);
    expect(smartGuideOverlaysEqual(EMPTY_SMART_GUIDE_OVERLAY, { segments: [], spacings: [] })).toBe(true);
  });

  it("선분 좌표·간격 값이 다르면 false", () => {
    const changedSegment = overlayA();
    changedSegment.segments[0].to = 300;
    expect(smartGuideOverlaysEqual(overlayA(), changedSegment)).toBe(false);
    const changedGap = overlayA();
    changedGap.spacings[0].gap = 61;
    expect(smartGuideOverlaysEqual(overlayA(), changedGap)).toBe(false);
  });
});

describe("성능 — 수백 개 요소 O(n) 스캔", () => {
  it("요소 600개 × 100프레임을 여유 있게 처리한다(스냅 결과도 정확)", () => {
    const others: GuideBox[] = [];
    for (let i = 0; i < 600; i++) others.push(box(`o${i}`, (i % 30) * 200 + 2000, Math.floor(i / 30) * 150, 120, 90));
    others.push(box("target", 0, 0, 100, 50)); // 우변 100
    const moving = box("m", 103, 10, 50, 40);
    const started = performance.now();
    let result = computeSmartSnap(moving, others);
    for (let frame = 0; frame < 99; frame++) result = computeSmartSnap(moving, others);
    const elapsed = performance.now() - started;
    expect(result.x).toEqual({ delta: -3, dist: 3, kind: "edge" });
    expect(elapsed).toBeLessThan(1000); // 프레임당 10ms(≈60fps 여유)의 매우 느슨한 상한
  });
});

describe("스냅 → 오버레이 연동(통합 시나리오)", () => {
  it("computeSmartSnap의 delta를 적용한 위치로 오버레이를 만들면 선분이 나온다", () => {
    const moving = box("m", 103, 200, 50, 40);
    const others = [box("a", 0, 0, 100, 50)];
    const snap = computeSmartSnap(moving, others, { threshold: SMART_SNAP_THRESHOLD });
    expect(snap.x).not.toBeNull();
    const moved = { ...moving, x: moving.x + (snap.x?.delta ?? 0) };
    const overlay = buildSmartGuideOverlay(moved, others, { epsilon: SMART_GUIDE_EPSILON });
    expect(overlay.segments).toEqual([{ axis: "v", pos: 100, from: 0, to: 240, kind: "edge" }]);
  });
});

describe("buildSmartGuideOverlayPreview — 스냅 OFF 비파괴 정렬선", () => {
  it("실제 박스를 바꾸지 않고 제안 위치의 ghost box와 정렬선을 만든다", () => {
    const actual = Object.freeze(box("m", 103, 200, 50, 40));
    const others = [box("a", 0, 0, 100, 50)];
    const suggested = computeSmartSnap(actual, others);
    const preview = buildSmartGuideOverlayPreview(actual, others, suggested);

    expect(actual).toEqual(box("m", 103, 200, 50, 40));
    expect(preview).not.toBeNull();
    expect(preview?.actualBox).toEqual(actual);
    expect(preview?.actualBox).not.toBe(actual);
    expect(preview?.previewBox).toEqual(box("m", 100, 200, 50, 40));
    expect(preview?.suggestedDelta).toEqual({ x: -3, y: 0 });
    expect(preview?.hasSuggestion).toBe(true);
    expect(preview?.overlay.segments).toEqual([
      { axis: "v", pos: 100, from: 0, to: 240, kind: "edge" },
    ]);
  });

  it("기존 수동 delta 적용 파이프라인과 같은 preview overlay를 낸다", () => {
    const actual = box("m", 103, 200, 50, 40);
    const others = [box("a", 0, 0, 100, 50)];
    const suggested = computeSmartSnap(actual, others);
    const manualBox = {
      ...actual,
      x: actual.x + (suggested.x?.delta ?? 0),
      y: actual.y + (suggested.y?.delta ?? 0),
    };
    const preview = buildSmartGuideOverlayPreview(actual, others, suggested);

    expect(preview?.previewBox).toEqual(manualBox);
    expect(preview?.overlay).toEqual(buildSmartGuideOverlay(manualBox, others));
  });

  it("균등 간격 후보도 실제 x를 유지하면서 ghost 간격 배지로 변환한다", () => {
    const actual = box("m", 157, 10, 80, 50);
    const others = [
      box("l", 0, 0, 100, 100),
      box("r", 300, 0, 100, 100),
    ];
    const suggested = computeSmartSnap(actual, others);
    const preview = buildSmartGuideOverlayPreview(actual, others, suggested);

    expect(actual.x).toBe(157);
    expect(preview?.actualBox.x).toBe(157);
    expect(preview?.previewBox.x).toBe(160);
    expect(preview?.overlay.spacings).toEqual([
      {
        axis: "x",
        gap: 60,
        at: 35,
        spans: [
          { from: 100, to: 160 },
          { from: 240, to: 300 },
        ],
      },
    ]);
  });

  it("delta 0인 이미 정렬된 후보도 표시 대상으로 유지한다", () => {
    const actual = box("m", 100, 200, 50, 40);
    const others = [box("a", 0, 0, 100, 50)];
    const suggested = computeSmartSnap(actual, others);
    const preview = buildSmartGuideOverlayPreview(actual, others, suggested);

    expect(suggested.x).toEqual({ delta: 0, dist: 0, kind: "edge" });
    expect(preview?.hasSuggestion).toBe(true);
    expect(preview?.suggestedDelta.x).toBe(0);
    expect(preview?.overlay.segments.some(
      (segment) => segment.axis === "v" && segment.pos === 100
    )).toBe(true);
  });

  it("후보가 없으면 분리된 실제/preview box와 공용 빈 overlay를 반환한다", () => {
    const actual = box("m", 400, 400, 50, 50);
    const suggested = computeSmartSnap(actual, [box("a", 0, 0, 100, 50)]);
    const preview = buildSmartGuideOverlayPreview(actual, [], suggested);

    expect(preview?.actualBox).toEqual(actual);
    expect(preview?.previewBox).toEqual(actual);
    expect(preview?.actualBox).not.toBe(actual);
    expect(preview?.previewBox).not.toBe(actual);
    expect(preview?.hasSuggestion).toBe(false);
    expect(preview?.suggestedDelta).toEqual({ x: 0, y: 0 });
    expect(preview?.overlay).toBe(EMPTY_SMART_GUIDE_OVERLAY);
  });

  it("오염된 후보는 축별로 무시하고 비정상 실제 박스는 fail-closed한다", () => {
    const actual = box("m", 103, 203, 50, 40);
    const others = [box("a", 0, 0, 100, 200)];
    const preview = buildSmartGuideOverlayPreview(actual, others, {
      x: { delta: Number.NaN, dist: 3, kind: "edge" },
      y: { delta: -3, dist: 3, kind: "edge" },
    });

    expect(preview?.previewBox).toEqual(box("m", 103, 200, 50, 40));
    expect(preview?.suggestedDelta).toEqual({ x: 0, y: -3 });
    expect(preview?.overlay.segments.every((segment) => segment.axis === "h")).toBe(true);
    expect(buildSmartGuideOverlayPreview(
      box("bad", Number.NaN, 0, 10, 10),
      others,
      { x: null, y: null }
    )).toBeNull();
  });
});

describe("stroke/shape object snap — point placement", () => {
  it("snaps a freehand tip to a neighboring right edge within threshold", () => {
    const others = [box("a", 0, 0, 100, 80)];
    const snap = snapPointToObjectGuides(103, 40, others, { threshold: 6 });
    expect(snap).toEqual({
      x: 100,
      y: 40,
      snappedX: true,
      snappedY: true, // center y of a is 40
      guideX: 100,
      guideY: 40,
      kindX: "edge",
      kindY: "center",
    });
  });

  it("does not invent a snap outside the threshold", () => {
    const snap = snapPointToObjectGuides(120, 200, [box("a", 0, 0, 100, 50)], { threshold: 6 });
    expect(snap.snappedX).toBe(false);
    expect(snap.snappedY).toBe(false);
    expect(snap.x).toBe(120);
    expect(snap.y).toBe(200);
  });

  it("consults freehand/shape guides when snap or alignment guides are on", () => {
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: true,
      kind: "freehand",
      sampleIndex: 0,
    })).toBe(true);
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: false,
      showAlignmentGuides: true,
      kind: "freehand",
      sampleIndex: 3,
    })).toBe(true);
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: false,
      showAlignmentGuides: false,
      kind: "freehand",
      sampleIndex: 3,
    })).toBe(false);
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: true,
      kind: "line",
      sampleIndex: 3,
    })).toBe(true);
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: true,
      mode: "eraser",
      kind: "line",
      sampleIndex: 0,
    })).toBe(false);
    expect(shouldApplyStrokeObjectSnap({
      snapEnabled: true,
      kind: "line",
      sampleIndex: 0,
      directionalRulerActive: true,
    })).toBe(false);
  });

  it("mutates stroke coordinates only when the snap master is on", () => {
    expect(shouldMutateStrokeWithObjectSnap({ snapEnabled: true })).toBe(true);
    expect(shouldMutateStrokeWithObjectSnap({ snapEnabled: false })).toBe(false);
  });

  it("latches freehand mid samples to the acquired edge and refuses guide hopping", () => {
    // Two vertical edges 8px apart; capture threshold 6, hold factor 1.75 → hold radius 10.5.
    const others = [box("left", 0, 0, 100, 80), box("right", 108, 0, 40, 80)];
    const origin = planFreehandObjectSnapPoint({
      x: 103,
      y: 40,
      others,
      latch: EMPTY_FREEHAND_OBJECT_SNAP_LATCH,
      threshold: 6,
      holdFactor: 1.75,
    });
    expect(origin.x).toBe(100);
    expect(origin.latch.guideX).toBe(100);

    // Closer to the right edge (108) raw, but still within hold radius of latched 100 → stick.
    const mid = planFreehandObjectSnapPoint({
      x: 106,
      y: 55,
      others,
      latch: origin.latch,
      threshold: 6,
      holdFactor: 1.75,
    });
    expect(mid.x).toBe(100);
    expect(mid.latch.guideX).toBe(100);
    expect(mid.snappedX).toBe(true);

    // Pull past hold radius → release and return raw (not auto-hop to 108 unless capture allows).
    const released = planFreehandObjectSnapPoint({
      x: 112,
      y: 55,
      others,
      latch: origin.latch,
      threshold: 6,
      holdFactor: 1.75,
    });
    // |112-100|=12 > 10.5 hold; |112-108|=4 ≤ 6 capture → re-acquire right edge.
    expect(released.x).toBe(108);
    expect(released.latch.guideX).toBe(108);
  });

  it("builds an overlay for a snapped tip without spacing badges", () => {
    const others = [box("a", 0, 0, 100, 80)];
    const snap = snapPointToObjectGuides(100, 40, others);
    const overlay = buildPointObjectSnapOverlay(snap.x, snap.y, others, snap);
    expect(overlay.spacings).toEqual([]);
    expect(overlay.segments.some((segment) => segment.axis === "v" && segment.pos === 100)).toBe(true);
  });
});
