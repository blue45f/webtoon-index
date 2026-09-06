import { describe, expect, it } from "vitest";

import {
  BUBBLE_MERGE_MAX_COUNT,
  bubbleMergeUnavailableReason,
  bubbleSilhouetteLocalPolygon,
  mergeStudioBubbles,
} from "./studio-bubble-merge";

import type { BubbleEl, El } from "../studio-element-model";

function bubble(id: string, x: number, y: number, extra?: Partial<BubbleEl>): BubbleEl {
  return {
    id,
    type: "bubble",
    variant: "speech",
    text: "가",
    x,
    y,
    width: 120,
    height: 80,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
    ...extra,
  };
}

const rect: El = {
  id: "r1",
  type: "rect",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  fill: "#000000",
} as unknown as El;

describe("bubbleMergeUnavailableReason", () => {
  it("말풍선이 아닌 요소가 섞이면 거부", () => {
    expect(bubbleMergeUnavailableReason([bubble("a", 0, 0), rect])).toMatch(/말풍선만/);
  });

  it("2개 미만이면 거부", () => {
    expect(bubbleMergeUnavailableReason([bubble("a", 0, 0)])).toMatch(/2개 이상/);
  });

  it("최대치를 넘으면 거부", () => {
    const many = Array.from({ length: BUBBLE_MERGE_MAX_COUNT + 1 }, (_, i) => bubble(`b${i}`, i, 0));
    expect(bubbleMergeUnavailableReason(many)).toMatch(/최대/);
  });

  it("말풍선 2~6개면 통과(null)", () => {
    expect(bubbleMergeUnavailableReason([bubble("a", 0, 0), bubble("b", 10, 0)])).toBeNull();
  });
});

describe("bubbleSilhouetteLocalPolygon", () => {
  it("유효한 닫힌 폴리곤(≥6 좌표, 짝수 길이)을 만든다", () => {
    const poly = bubbleSilhouetteLocalPolygon(bubble("a", 0, 0), "classic");
    expect(poly.length).toBeGreaterThanOrEqual(6);
    expect(poly.length % 2).toBe(0);
  });

  it("커스텀 모양이 있으면 그 점 배열을 그대로 쓴다", () => {
    const custom = [0, 0, 100, 0, 100, 100, 0, 100];
    const poly = bubbleSilhouetteLocalPolygon(bubble("a", 0, 0, { customShapePoints: custom }), "classic");
    expect(poly).toEqual(custom);
  });
});

describe("mergeStudioBubbles", () => {
  it("겹친 말풍선 2개는 하나로 병합되고 생존자는 첫 번째(맨 뒤)", async () => {
    const a = bubble("a", 0, 0, { width: 120, height: 100 });
    const b = bubble("b", 60, 0, { width: 120, height: 100 }); // a 와 x축으로 겹침
    const result = await mergeStudioBubbles([a, b], "classic");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorId).toBe("a");
      expect(result.removedIds).toEqual(["b"]);
      expect(result.patch.customShapePoints?.length ?? 0).toBeGreaterThanOrEqual(6);
    }
  });

  it("서로 겹치지 않는 말풍선은 병합 실패 사유를 돌려준다", async () => {
    const a = bubble("a", 0, 0);
    const b = bubble("b", 900, 900); // 멀리 떨어짐
    const result = await mergeStudioBubbles([a, b], "classic");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/겹치지 않는/);
  });

  it("게이트 위반(1개)은 실패 사유", async () => {
    const result = await mergeStudioBubbles([bubble("a", 0, 0)], "classic");
    expect(result.ok).toBe(false);
  });
});
