import { describe, it, expect } from "vitest";

import {
  computeBubbleAnchorTail,
  resolveAnchorTargetPoint,
  computeAnchoredBubbleTailPatch,
  BUBBLE_ANCHOR_RATIO_RANGE,
  BUBBLE_ANCHOR_LENGTH_RANGE,
  type AnchorBubbleShape,
  type AnchorTargetBounds,
} from "./studio-bubble-anchor";

// 기준 말풍선: 회전 없음, 원점(0,0), 200×100.
const baseBubble = (over: Partial<AnchorBubbleShape> = {}): AnchorBubbleShape => ({
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  ...over,
});

describe("computeBubbleAnchorTail — 방향 판정(비회전)", () => {
  it("아래쪽 target → bottom, ratio≈0.5", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 100, y: 150 });
    expect(r).toEqual({ tailDirection: "bottom", tailXRatio: 0.5, tailHeight: 50 });
  });

  it("위쪽 target → top, ratio≈0.5", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 100, y: -50 });
    expect(r).toEqual({ tailDirection: "top", tailXRatio: 0.5, tailHeight: 50 });
  });

  it("왼쪽 target → left, ratio≈0.5", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: -10, y: 50 });
    expect(r).toEqual({ tailDirection: "left", tailXRatio: 0.5, tailHeight: 10 });
  });

  it("오른쪽 target → right, ratio≈0.5", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 210, y: 50 });
    expect(r).toEqual({ tailDirection: "right", tailXRatio: 0.5, tailHeight: 10 });
  });
});

describe("computeBubbleAnchorTail — 클램프", () => {
  it("ratio 는 0.15 아래로 내려가지 않는다(좌상단 근처 target)", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 8, y: -3 });
    expect(r?.tailDirection).toBe("top");
    expect(r?.tailXRatio).toBe(BUBBLE_ANCHOR_RATIO_RANGE.min);
  });

  it("ratio 는 0.85 위로 올라가지 않는다(우상단 근처 target)", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 195, y: -3 });
    expect(r?.tailDirection).toBe("top");
    expect(r?.tailXRatio).toBe(BUBBLE_ANCHOR_RATIO_RANGE.max);
  });

  it("length 는 8 밑으로 내려가지 않는다(말풍선과 겹치는 target)", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 100, y: 40 });
    expect(r).toEqual({ tailDirection: "top", tailXRatio: 0.5, tailHeight: BUBBLE_ANCHOR_LENGTH_RANGE.min });
  });

  it("length 는 150 위로 올라가지 않는다(아주 먼 target)", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: -1000, y: -200 });
    expect(r?.tailDirection).toBe("top");
    expect(r?.tailHeight).toBe(BUBBLE_ANCHOR_LENGTH_RANGE.max);
  });
});

describe("computeBubbleAnchorTail — 동률 우선순위", () => {
  it("bottom 과 right 가 동률이면 bottom 이 이긴다(원본 손잡이 핸들러의 if/else if 순서와 동일)", () => {
    // localX=220(w+20), localY=120(h+20) → dBot=20, dRight=20 동률.
    const r = computeBubbleAnchorTail(baseBubble(), { x: 220, y: 120 });
    expect(r?.tailDirection).toBe("bottom");
  });
});

describe("computeBubbleAnchorTail — 화자 방향 미러(tail)", () => {
  it("tail:'right' 는 bottom/top ratio 를 뒤집는다", () => {
    const target = { x: 60, y: 150 }; // → bottom, raw ratio 0.3
    const left = computeBubbleAnchorTail(baseBubble({ tail: "left" }), target);
    const right = computeBubbleAnchorTail(baseBubble({ tail: "right" }), target);
    expect(left?.tailXRatio).toBe(0.3);
    expect(right?.tailXRatio).toBe(0.7);
    expect(right?.tailDirection).toBe("bottom");
  });

  it("tail:'right' 는 left/right 방향에는 영향을 주지 않는다", () => {
    const target = { x: -10, y: 50 }; // → left
    const left = computeBubbleAnchorTail(baseBubble({ tail: "left" }), target);
    const right = computeBubbleAnchorTail(baseBubble({ tail: "right" }), target);
    expect(left?.tailXRatio).toBe(right?.tailXRatio);
    expect(left?.tailDirection).toBe("left");
    expect(right?.tailDirection).toBe("left");
  });
});

describe("computeBubbleAnchorTail — 회전", () => {
  it("90° 회전된 말풍선: 캔버스 좌표 target 이 로컬로 올바르게 역회전되어 bottom 을 겨냥한다", () => {
    // 로컬 기준 설계: (localX=120, localY=130) → bottom, ratio=0.6, length=30.
    // 이 로컬 점을 rotation=90°, origin=(50,20) 인 말풍선의 정회전으로 캔버스 좌표로 옮기면
    // canvasX = localX*cos90 - localY*sin90 + x = -130 + 50 = -80
    // canvasY = localX*sin90 + localY*cos90 + y =  120 + 20 = 140
    const bubble = baseBubble({ x: 50, y: 20, rotation: 90 });
    const r = computeBubbleAnchorTail(bubble, { x: -80, y: 140 });
    expect(r).toEqual({ tailDirection: "bottom", tailXRatio: 0.6, tailHeight: 30 });
  });

  it("회전 0°(기본값)와 rotation 명시 0 은 같은 결과를 낸다", () => {
    const target = { x: 100, y: 150 };
    const a = computeBubbleAnchorTail(baseBubble(), target);
    const b = computeBubbleAnchorTail(baseBubble({ rotation: 0 }), target);
    expect(a).toEqual(b);
  });
});

describe("computeBubbleAnchorTail — 비정상 입력", () => {
  it("width <= 0 → null", () => {
    expect(computeBubbleAnchorTail(baseBubble({ width: 0 }), { x: 5, y: 5 })).toBeNull();
    expect(computeBubbleAnchorTail(baseBubble({ width: -10 }), { x: 5, y: 5 })).toBeNull();
  });

  it("height <= 0 → null", () => {
    expect(computeBubbleAnchorTail(baseBubble({ height: 0 }), { x: 5, y: 5 })).toBeNull();
  });

  it("target 이 NaN/Infinity 면 null", () => {
    expect(computeBubbleAnchorTail(baseBubble(), { x: Number.NaN, y: 5 })).toBeNull();
    expect(computeBubbleAnchorTail(baseBubble(), { x: Number.POSITIVE_INFINITY, y: 5 })).toBeNull();
  });

  it("말풍선 x/y/rotation 이 비유한이면 null", () => {
    expect(computeBubbleAnchorTail(baseBubble({ x: Number.NaN }), { x: 5, y: 5 })).toBeNull();
    expect(computeBubbleAnchorTail(baseBubble({ rotation: Number.NaN }), { x: 5, y: 5 })).toBeNull();
  });

  it("결과가 있으면 NaN 이 새어나가지 않는다", () => {
    const r = computeBubbleAnchorTail(baseBubble(), { x: 100, y: 150 });
    expect(Number.isFinite(r?.tailXRatio)).toBe(true);
    expect(Number.isFinite(r?.tailHeight)).toBe(true);
  });
});

describe("resolveAnchorTargetPoint", () => {
  const stubBounds = (id: string): AnchorTargetBounds | null =>
    id === "char-1" ? { x: 40, y: 60, w: 20, h: 40 } : null;

  it("tailAnchorPoint 만 있으면 그대로 반환", () => {
    const p = resolveAnchorTargetPoint({ tailAnchorPoint: { x: 1, y: 2 } }, () => null);
    expect(p).toEqual({ x: 1, y: 2 });
  });

  it("tailAnchorId 만 있으면 대상 bounds 의 중심점을 반환", () => {
    const p = resolveAnchorTargetPoint({ tailAnchorId: "char-1" }, stubBounds);
    expect(p).toEqual({ x: 50, y: 80 }); // 40+20/2, 60+40/2
  });

  it("tailAnchorId 가 가리키는 대상이 없으면 null", () => {
    const p = resolveAnchorTargetPoint({ tailAnchorId: "missing" }, stubBounds);
    expect(p).toBeNull();
  });

  it("tailAnchorId 와 tailAnchorPoint 가 둘 다 있으면 tailAnchorId 가 우선", () => {
    const p = resolveAnchorTargetPoint({ tailAnchorId: "char-1", tailAnchorPoint: { x: 999, y: 999 } }, stubBounds);
    expect(p).toEqual({ x: 50, y: 80 });
  });

  it("둘 다 없으면 null", () => {
    expect(resolveAnchorTargetPoint({}, stubBounds)).toBeNull();
  });
});

describe("computeAnchoredBubbleTailPatch", () => {
  const stubBounds = (id: string): AnchorTargetBounds | null =>
    id === "char-1" ? { x: 0, y: 100, w: 200, h: 100 } : null; // 중심 (100,150) → bottom

  it("id 해석 + 계산을 한 번에 수행한다", () => {
    const bubble = { ...baseBubble(), tailAnchorId: "char-1" };
    const r = computeAnchoredBubbleTailPatch(bubble, stubBounds);
    expect(r).toEqual({ tailDirection: "bottom", tailXRatio: 0.5, tailHeight: 50 });
  });

  it("대상을 찾을 수 없으면 null", () => {
    const bubble = { ...baseBubble(), tailAnchorId: "missing" };
    expect(computeAnchoredBubbleTailPatch(bubble, stubBounds)).toBeNull();
  });
});

describe("교차검증: 손잡이 드래그 공식과의 동치성(회전 0)", () => {
  // StudioPage.tsx ~9316-9350 의 원본 손잡이 공식을 그대로 재구현(수입 없이 독립 재현) —
  // computeBubbleAnchorTail 이 이 공식과 항상 같은 결과를 내야 "손잡이로 끈 것과 동일"이 성립한다.
  function manualHandlerFormula(
    w: number,
    h: number,
    tailDir: "left" | "right",
    dx: number,
    dy: number
  ): { direction: "bottom" | "top" | "left" | "right"; ratio: number; length: number } {
    const dTop = Math.abs(dy);
    const dBot = Math.abs(dy - h);
    const dLeft = Math.abs(dx);
    const dRight = Math.abs(dx - w);
    const minDist = Math.min(dTop, dBot, dLeft, dRight);

    let newDir: "bottom" | "top" | "left" | "right";
    let ratio: number;
    let len: number;
    if (minDist === dBot) {
      newDir = "bottom";
      ratio = Math.max(0.15, Math.min(0.85, dx / w));
      len = Math.max(8, Math.min(150, dy - h));
    } else if (minDist === dTop) {
      newDir = "top";
      ratio = Math.max(0.15, Math.min(0.85, dx / w));
      len = Math.max(8, Math.min(150, -dy));
    } else if (minDist === dLeft) {
      newDir = "left";
      ratio = Math.max(0.15, Math.min(0.85, dy / h));
      len = Math.max(8, Math.min(150, -dx));
    } else {
      newDir = "right";
      ratio = Math.max(0.15, Math.min(0.85, dy / h));
      len = Math.max(8, Math.min(150, dx - w));
    }
    if (tailDir === "right" && (newDir === "bottom" || newDir === "top")) {
      ratio = 1 - ratio;
    }
    return { direction: newDir, ratio: Math.round(ratio * 100) / 100, length: Math.round(len) };
  }

  const points: Array<{ x: number; y: number }> = [
    { x: 100, y: 150 },
    { x: 100, y: -50 },
    { x: -10, y: 50 },
    { x: 210, y: 50 },
    { x: 60, y: 150 },
    { x: 8, y: -3 },
    { x: 195, y: -3 },
    { x: 220, y: 120 },
  ];

  it.each(points)("target (%o) 은 손잡이 공식과 동일한 결과를 낸다", (target) => {
    for (const tailDir of ["left", "right"] as const) {
      const bubble = baseBubble({ tail: tailDir });
      const actual = computeBubbleAnchorTail(bubble, target);
      const expected = manualHandlerFormula(200, 100, tailDir, target.x, target.y);
      expect(actual).toEqual({
        tailDirection: expected.direction,
        tailXRatio: expected.ratio,
        tailHeight: expected.length,
      });
    }
  });
});
