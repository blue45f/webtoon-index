import { describe, expect, it } from "vitest";

import {
  applyBubbleQuickTransform,
  bubbleQuickTransformUnavailableReason,
  BUBBLE_QUICK_TRANSFORM_MAX_SIZE,
  BUBBLE_QUICK_TRANSFORM_MIN_HEIGHT,
  BUBBLE_QUICK_TRANSFORM_MIN_WIDTH,
  type BubbleQuickTransformSource,
} from "./studio-bubble-quick-transform";

const SOURCE: BubbleQuickTransformSource = {
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  rotation: 0,
  variant: "speech",
  tail: "left",
  tailDirection: "bottom",
  tailXRatio: 0.2,
  tailBend: 0.4,
};

describe("applyBubbleQuickTransform resize", () => {
  it("가로 넓히기는 시각 중심을 유지하고 커스텀 외곽선 x 좌표를 함께 크게 한다", () => {
    const source = { ...SOURCE, customShapePoints: [0, 0, 100, 0, 100, 60, 0, 60] };
    const result = applyBubbleQuickTransform(source, "widen");

    expect(result).toEqual({
      action: "widen",
      changed: true,
      outcome: "applied",
      patch: {
        x: 4,
        y: 20,
        width: 112,
        height: 60,
        customShapePoints: [0, 0, 112, 0, 112, 60, 0, 60],
      },
    });
    expect(source.customShapePoints).toEqual([0, 0, 100, 0, 100, 60, 0, 60]);
  });

  it("회전된 말풍선의 높이를 늘려도 캔버스 상 중심이 유지된다", () => {
    const result = applyBubbleQuickTransform({ ...SOURCE, rotation: 90 }, "heighten");
    expect(result.patch).toMatchObject({ x: 13.6, y: 20, width: 100, height: 67.2 });
  });

  it("좁히기/낮추기는 최소 크기, 넓히기/높이기는 최대 크기에서 no-op이다", () => {
    expect(
      applyBubbleQuickTransform({ ...SOURCE, width: BUBBLE_QUICK_TRANSFORM_MIN_WIDTH }, "narrow")
    ).toEqual({ action: "narrow", changed: false, outcome: "size-limit", patch: {} });
    expect(
      applyBubbleQuickTransform({ ...SOURCE, height: BUBBLE_QUICK_TRANSFORM_MIN_HEIGHT }, "shorten")
    ).toEqual({ action: "shorten", changed: false, outcome: "size-limit", patch: {} });
    expect(
      applyBubbleQuickTransform({ ...SOURCE, width: BUBBLE_QUICK_TRANSFORM_MAX_SIZE }, "widen")
    ).toEqual({ action: "widen", changed: false, outcome: "size-limit", patch: {} });
    expect(
      applyBubbleQuickTransform({ ...SOURCE, height: BUBBLE_QUICK_TRANSFORM_MAX_SIZE }, "heighten")
    ).toEqual({ action: "heighten", changed: false, outcome: "size-limit", patch: {} });
  });

  it("NaN/Infinity/음수 기하는 patch를 만들지 않는다", () => {
    expect(applyBubbleQuickTransform({ ...SOURCE, x: Number.NaN }, "widen").outcome).toBe(
      "invalid-geometry"
    );
    expect(applyBubbleQuickTransform({ ...SOURCE, height: Number.POSITIVE_INFINITY }, "shorten").outcome).toBe(
      "invalid-geometry"
    );
    expect(applyBubbleQuickTransform({ ...SOURCE, width: -1 }, "widen").outcome).toBe(
      "invalid-geometry"
    );
  });
});

describe("applyBubbleQuickTransform flip", () => {
  it("좌우 반전은 외곽선과 세로 변 꼬리의 위치·휘어짐·추가 꼬리를 같이 반전한다", () => {
    const result = applyBubbleQuickTransform(
      {
        ...SOURCE,
        customShapePoints: [0, 0, 100, 0, 20, 60],
        extraTails: [
          { direction: "top", ratio: 0.3, length: 20, base: 12, side: "left", bend: -0.5 },
        ],
      },
      "flip-horizontal"
    );

    expect(result).toEqual({
      action: "flip-horizontal",
      changed: true,
      outcome: "applied",
      patch: {
        tailDirection: "bottom",
        tailXRatio: 0.8,
        tailBend: -0.4,
        extraTails: [
          { direction: "top", ratio: 0.7, length: 20, base: 12, side: "right", bend: 0.5 },
        ],
        customShapePoints: [100, 0, 0, 0, 80, 60],
      },
    });
  });

  it("상하 반전은 왼쪽/오른쪽 꼬리의 세로 비율과 외곽선 y 좌표를 반전한다", () => {
    const result = applyBubbleQuickTransform(
      {
        ...SOURCE,
        tailDirection: "left",
        customShapePoints: [0, 0, 100, 0, 20, 60],
      },
      "flip-vertical"
    );
    expect(result.patch).toEqual({
      tailDirection: "left",
      tailXRatio: 0.8,
      tailBend: -0.4,
      customShapePoints: [0, 60, 100, 60, 20, 0],
    });
  });

  it("반전할 축에 직교하는 꼬리는 방향만 바꾸고 비율은 보존한다", () => {
    const result = applyBubbleQuickTransform(
      { ...SOURCE, tailDirection: "left", tailXRatio: 0.25 },
      "flip-horizontal"
    );
    expect(result.patch).toEqual({ tailDirection: "right" });
  });

  it("생각 말풍선의 구름방울 위치도 해당 축으로 같이 반전한다", () => {
    const result = applyBubbleQuickTransform(
      { ...SOURCE, variant: "thought", tail: undefined },
      "flip-horizontal"
    );
    expect(result.patch).toMatchObject({ tail: "right", tailDirection: "bottom", tailXRatio: 0.8 });
  });

  it("꼬리가 없고 커스텀 외곽선도 없는 대칭 도형은 unchanged이다", () => {
    expect(applyBubbleQuickTransform({ ...SOURCE, tail: "none" }, "flip-horizontal")).toEqual({
      action: "flip-horizontal",
      changed: false,
      outcome: "unchanged",
      patch: {},
    });
  });

  it("자동 부착된 꼬리는 다음 commit에서 다시 계산되므로 반전을 안전하게 보류한다", () => {
    expect(
      applyBubbleQuickTransform({ ...SOURCE, tailAnchorId: "speaker-1" }, "flip-horizontal")
    ).toEqual({ action: "flip-horizontal", changed: false, outcome: "anchored-tail", patch: {} });
    expect(
      applyBubbleQuickTransform({ ...SOURCE, tailAnchorPoint: { x: 10, y: 20 } }, "flip-vertical")
    ).toEqual({ action: "flip-vertical", changed: false, outcome: "anchored-tail", patch: {} });
  });
});

describe("bubbleQuickTransformUnavailableReason", () => {
  it("크기 한계, 대칭 반전, 자동 부착을 서로 다른 사용자 사유로 설명한다", () => {
    expect(
      bubbleQuickTransformUnavailableReason(
        { ...SOURCE, width: BUBBLE_QUICK_TRANSFORM_MIN_WIDTH },
        "narrow"
      )
    ).toContain("최소 너비 60px");
    expect(
      bubbleQuickTransformUnavailableReason({ ...SOURCE, tail: "none" }, "flip-horizontal")
    ).toContain("반전할 비대칭");
    expect(
      bubbleQuickTransformUnavailableReason(
        { ...SOURCE, tailAnchorId: "speaker-1" },
        "flip-horizontal"
      )
    ).toContain("자동 부착");
    expect(bubbleQuickTransformUnavailableReason(SOURCE, "widen")).toBeNull();
  });
});
