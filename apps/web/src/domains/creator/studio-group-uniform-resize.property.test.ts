import { describe, expect, it } from "vitest";

import {
  planStudioGroupUniformResize,
  type StudioGroupUniformResizeBounds,
  type StudioGroupUniformResizeInput,
} from "./studio-group-uniform-resize";

import type { El } from "./studio-element-model";

const FIXED_SEED = 0x5a17c0de;
const PROPERTY_CASE_COUNT = 84;
const POSITIVE_SCALE_MATRIX = [0.0625, 0.2, 0.5, 1, 1.75, 4, 16] as const;

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function between(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

function expectClose(actual: number, expected: number): void {
  expect(actual).toBeCloseTo(expected, 8);
}

function expectNumberArrayClose(
  actual: readonly number[],
  expected: readonly number[]
): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expectClose(actual[index], expected[index]);
  }
}

function transformedPosition(
  x: number,
  y: number,
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number
): { x: number; y: number } {
  return {
    x: target.x + (x - source.x) * scale,
    y: target.y + (y - source.y) * scale,
  };
}

function transformedDocumentPoints(
  points: readonly number[],
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number
): number[] {
  return points.map((value, index) =>
    index % 2 === 0
      ? target.x + (value - source.x) * scale
      : target.y + (value - source.y) * scale
  );
}

function plan(
  items: readonly El[],
  sourceBounds: StudioGroupUniformResizeBounds,
  targetBounds: StudioGroupUniformResizeBounds,
  overrides: Partial<
    Omit<
      StudioGroupUniformResizeInput,
      "items" | "sourceBounds" | "targetBounds"
    >
  > = {}
): El[] {
  return planStudioGroupUniformResize({
    items,
    selectedIds: items.map((item) => item.id),
    sourceBounds,
    targetBounds,
    isLocked: () => false,
    ...overrides,
  });
}

function createElementMatrix(
  random: () => number,
  source: StudioGroupUniformResizeBounds
): El[] {
  const documentX = (ratio: number) => source.x + source.width * ratio;
  const documentY = (ratio: number) => source.y + source.height * ratio;
  const boxWidth = source.width * between(random, 0.06, 0.24);
  const boxHeight = source.height * between(random, 0.08, 0.32);
  const bubbleWidth = source.width * between(random, 0.18, 0.42);
  const bubbleHeight = source.height * between(random, 0.16, 0.38);
  const frameWidth = source.width * between(random, 0.32, 0.72);
  const frameHeight = source.height * between(random, 0.28, 0.68);

  const outside: Extract<El, { type: "image" }> = {
    id: "outside",
    type: "image",
    src: "data:image/png;base64,AA==",
    x: source.x + source.width * 3,
    y: source.y - source.height * 2,
    width: boxWidth,
    height: boxHeight,
    rotation: 31,
    skewX: -6,
    skewY: 9,
  };
  const bubble: Extract<El, { type: "bubble" }> = {
    id: "bubble",
    type: "bubble",
    variant: "speech",
    text: "property",
    x: documentX(0.08),
    y: documentY(0.12),
    width: bubbleWidth,
    height: bubbleHeight,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: -17,
    fontSize: 21,
    autoShrinkText: true,
    autoShrinkMinFontSize: 9,
    lineHeight: 1.32,
    strokeWidth: 3.25,
    tailHeight: bubbleHeight * 0.35,
    tailBase: bubbleWidth * 0.18,
    tailBend: -0.42,
    tailXRatio: 0.61,
    tailAnchorPoint: {
      x: documentX(1.15),
      y: documentY(0.72),
    },
    shadowBlur: 8,
    shadowOffsetX: 3,
    shadowOffsetY: 5,
    customShapePoints: [
      0,
      0,
      bubbleWidth,
      0,
      bubbleWidth,
      bubbleHeight,
      0,
      bubbleHeight,
    ],
    extraTails: [
      {
        direction: "bottom",
        ratio: 0.68,
        length: bubbleHeight * 0.4,
        base: bubbleWidth * 0.12,
        side: "right",
        bend: 0.23,
      },
    ],
  };
  const draw: Extract<El, { type: "draw" }> = {
    id: "draw",
    type: "draw",
    points: [
      documentX(-0.08),
      documentY(0.05),
      documentX(0.25),
      documentY(0.4),
      documentX(0.72),
      documentY(0.83),
      documentX(1.09),
      documentY(1.12),
    ],
    stroke: "#222222",
    strokeWidth: between(random, 0.25, 18),
    sampleSpacing: 1.75,
    shapeParams: {
      starPoints: 7,
      starInnerRatio: 0.43,
      polygonSides: 8,
      cornerRadius: 5.5,
    },
    symmetry: {
      type: "radial",
      centerX: documentX(0.44),
      centerY: documentY(0.58),
      radialCount: 9,
    },
  };
  const speed: Extract<El, { type: "speedLines" }> = {
    id: "speed",
    type: "speedLines",
    x: documentX(0.34),
    y: documentY(0.28),
    width: boxWidth * 1.3,
    height: boxHeight * 0.9,
    lineCount: 27,
    direction: "horizontal",
    stroke: "#333333",
    strokeWidth: 1.75,
    noise: 4.5,
    rotation: -23,
  };
  const image: Extract<El, { type: "image" }> = {
    id: "image",
    type: "image",
    src: "data:image/png;base64,AA==",
    x: documentX(0.48),
    y: documentY(0.17),
    width: boxWidth,
    height: boxHeight,
    rotation: 29,
    skewX: 12,
    skewY: -8,
    cornerRadius: 7.5,
    shadowBlur: 11,
    shadowOffsetX: 4,
    shadowOffsetY: -3,
    pixelate: 6,
  };
  const frame: Extract<El, { type: "frame" }> = {
    id: "frame",
    type: "frame",
    x: documentX(0.14),
    y: documentY(0.21),
    width: frameWidth,
    height: frameHeight,
    strokeWidth: 5.5,
    points: [
      0,
      0,
      frameWidth,
      frameHeight * 0.04,
      frameWidth * 0.94,
      frameHeight,
      frameWidth * 0.03,
      frameHeight * 0.91,
    ],
  };
  const text: Extract<El, { type: "text" }> = {
    id: "text",
    type: "text",
    text: "matrix",
    x: documentX(0.63),
    y: documentY(0.55),
    width: boxWidth * 1.8,
    fontSize: between(random, 7, 42),
    fill: "#111111",
    rotation: 14,
    skewX: -11,
    skewY: 7,
    strokeWidth: 2.25,
    letterSpacing: -1.4,
    lineHeight: 1.45,
    shadowBlur: 9,
    shadowOffsetX: 3,
    shadowOffsetY: 4,
  };
  const focus: Extract<El, { type: "focusLines" }> = {
    id: "focus",
    type: "focusLines",
    x: documentX(0.06),
    y: documentY(0.08),
    width: source.width * 0.76,
    height: source.height * 0.74,
    lineCount: 64,
    innerRadius: source.width * 0.07,
    outerRadius: source.width * 0.31,
    stroke: "#000000",
    strokeWidth: 2.5,
    noise: 7.25,
    rotation: 37,
  };
  const sticker: Extract<El, { type: "sticker" }> = {
    id: "sticker",
    type: "sticker",
    text: "쾅",
    x: documentX(0.82),
    y: documentY(0.76),
    fontSize: between(random, 12, 56),
    rotation: -32,
    skewX: 5,
    skewY: -13,
  };

  return [outside, bubble, draw, speed, image, frame, text, focus, sticker];
}

function expectAtomicNoOp(original: readonly El[], result: readonly El[]): void {
  expect(result).not.toBe(original);
  expect(result).toHaveLength(original.length);
  result.forEach((item, index) => {
    expect(item).toBe(original[index]);
  });
}

describe("planStudioGroupUniformResize deterministic properties", () => {
  it("고정 seed의 양수 scale·translation·원점 행렬에서 모든 지원 기하를 같은 affine 규칙으로 변환한다", () => {
    const random = deterministicRandom(FIXED_SEED);

    for (let caseIndex = 0; caseIndex < PROPERTY_CASE_COUNT; caseIndex += 1) {
      const source: StudioGroupUniformResizeBounds = {
        x: between(random, -900, 900),
        y: between(random, -700, 700),
        width: between(random, 24, 1_400),
        height: between(random, 24, 1_100),
      };
      const requestedScale =
        POSITIVE_SCALE_MATRIX[caseIndex % POSITIVE_SCALE_MATRIX.length];
      const candidateTargetX = between(random, -1_200, 1_200);
      const target: StudioGroupUniformResizeBounds = {
        x:
          requestedScale === 1
            ? source.x + (candidateTargetX < source.x ? -37 : 37)
            : candidateTargetX,
        y: between(random, -1_000, 1_000),
        width: source.width * requestedScale,
        height: source.height * requestedScale,
      };

      const items = createElementMatrix(random, source);
      const originalSnapshot = structuredClone(items);
      const originalReferences = [...items];
      const selectedIds = items
        .filter((item) => item.id !== "outside")
        .map((item) => item.id)
        .reverse();
      const result = plan(items, source, target, { selectedIds });
      const scale =
        (target.width / source.width + target.height / source.height) / 2;

      expect(items).toEqual(originalSnapshot);
      expect(result.map((item) => item.id)).toEqual(
        items.map((item) => item.id)
      );
      expect(result[0]).toBe(items[0]);
      for (let index = 1; index < result.length; index += 1) {
        expect(result[index]).not.toBe(originalReferences[index]);
      }

      const originalBubble = items[1] as Extract<El, { type: "bubble" }>;
      const resizedBubble = result[1] as Extract<El, { type: "bubble" }>;
      const bubblePosition = transformedPosition(
        originalBubble.x,
        originalBubble.y,
        source,
        target,
        scale
      );
      expectClose(resizedBubble.x, bubblePosition.x);
      expectClose(resizedBubble.y, bubblePosition.y);
      expectClose(resizedBubble.width, originalBubble.width * scale);
      expectClose(resizedBubble.height, originalBubble.height * scale);
      expectClose(
        resizedBubble.fontSize ?? 0,
        (originalBubble.fontSize ?? 0) * scale
      );
      expectClose(
        resizedBubble.autoShrinkMinFontSize ?? 0,
        (originalBubble.autoShrinkMinFontSize ?? 0) * scale
      );
      expectNumberArrayClose(
        resizedBubble.customShapePoints ?? [],
        (originalBubble.customShapePoints ?? []).map((value) => value * scale)
      );
      expectClose(
        resizedBubble.tailHeight ?? 0,
        (originalBubble.tailHeight ?? 0) * scale
      );
      expectClose(
        resizedBubble.tailBase ?? 0,
        (originalBubble.tailBase ?? 0) * scale
      );
      expectClose(
        resizedBubble.extraTails?.[0]?.length ?? 0,
        (originalBubble.extraTails?.[0]?.length ?? 0) * scale
      );
      expectClose(
        resizedBubble.extraTails?.[0]?.base ?? 0,
        (originalBubble.extraTails?.[0]?.base ?? 0) * scale
      );
      expect(resizedBubble.rotation).toBe(originalBubble.rotation);
      expect(resizedBubble.lineHeight).toBe(originalBubble.lineHeight);
      expect(resizedBubble.tailBend).toBe(originalBubble.tailBend);
      expect(resizedBubble.tailXRatio).toBe(originalBubble.tailXRatio);
      expect(resizedBubble.tailAnchorPoint).toBe(
        originalBubble.tailAnchorPoint
      );
      expect(resizedBubble.extraTails?.[0]?.ratio).toBe(
        originalBubble.extraTails?.[0]?.ratio
      );
      expect(resizedBubble.extraTails?.[0]?.bend).toBe(
        originalBubble.extraTails?.[0]?.bend
      );
      expect(resizedBubble.strokeWidth).toBe(originalBubble.strokeWidth);
      expect(resizedBubble.shadowBlur).toBe(originalBubble.shadowBlur);
      expect(resizedBubble.shadowOffsetX).toBe(originalBubble.shadowOffsetX);
      expect(resizedBubble.shadowOffsetY).toBe(originalBubble.shadowOffsetY);

      const originalDraw = items[2] as Extract<El, { type: "draw" }>;
      const resizedDraw = result[2] as Extract<El, { type: "draw" }>;
      expectNumberArrayClose(
        resizedDraw.points,
        transformedDocumentPoints(
          originalDraw.points,
          source,
          target,
          scale
        )
      );
      expect(resizedDraw.strokeWidth).toBe(originalDraw.strokeWidth);
      expect(resizedDraw.sampleSpacing).toBe(originalDraw.sampleSpacing);
      expectClose(
        resizedDraw.shapeParams?.cornerRadius ?? 0,
        (originalDraw.shapeParams?.cornerRadius ?? 0) * scale
      );
      expect(resizedDraw.shapeParams?.starPoints).toBe(
        originalDraw.shapeParams?.starPoints
      );
      expect(resizedDraw.shapeParams?.starInnerRatio).toBe(
        originalDraw.shapeParams?.starInnerRatio
      );
      expect(resizedDraw.shapeParams?.polygonSides).toBe(
        originalDraw.shapeParams?.polygonSides
      );
      const expectedSymmetryCenter = transformedPosition(
        originalDraw.symmetry?.centerX ?? 0,
        originalDraw.symmetry?.centerY ?? 0,
        source,
        target,
        scale
      );
      expectClose(
        resizedDraw.symmetry?.centerX ?? 0,
        expectedSymmetryCenter.x
      );
      expectClose(
        resizedDraw.symmetry?.centerY ?? 0,
        expectedSymmetryCenter.y
      );
      expect(resizedDraw.symmetry?.type).toBe(originalDraw.symmetry?.type);
      expect(resizedDraw.symmetry?.radialCount).toBe(
        originalDraw.symmetry?.radialCount
      );

      const originalSpeed = items[3] as Extract<El, { type: "speedLines" }>;
      const resizedSpeed = result[3] as Extract<El, { type: "speedLines" }>;
      const speedPosition = transformedPosition(
        originalSpeed.x,
        originalSpeed.y,
        source,
        target,
        scale
      );
      expectClose(resizedSpeed.x, speedPosition.x);
      expectClose(resizedSpeed.y, speedPosition.y);
      expectClose(resizedSpeed.width, originalSpeed.width * scale);
      expectClose(resizedSpeed.height, originalSpeed.height * scale);
      expect(resizedSpeed.strokeWidth).toBe(originalSpeed.strokeWidth);
      expectClose(
        resizedSpeed.noise ?? 0,
        (originalSpeed.noise ?? 0) * scale
      );
      expect(resizedSpeed.rotation).toBe(originalSpeed.rotation);

      const originalImage = items[4] as Extract<El, { type: "image" }>;
      const resizedImage = result[4] as Extract<El, { type: "image" }>;
      const imagePosition = transformedPosition(
        originalImage.x,
        originalImage.y,
        source,
        target,
        scale
      );
      expectClose(resizedImage.x, imagePosition.x);
      expectClose(resizedImage.y, imagePosition.y);
      expectClose(resizedImage.width, originalImage.width * scale);
      expectClose(resizedImage.height, originalImage.height * scale);
      expect(resizedImage.rotation).toBe(originalImage.rotation);
      expect(resizedImage.skewX).toBe(originalImage.skewX);
      expect(resizedImage.skewY).toBe(originalImage.skewY);
      expectClose(
        resizedImage.cornerRadius ?? 0,
        (originalImage.cornerRadius ?? 0) * scale
      );
      expect(resizedImage.shadowBlur).toBe(originalImage.shadowBlur);
      expect(resizedImage.shadowOffsetX).toBe(originalImage.shadowOffsetX);
      expect(resizedImage.shadowOffsetY).toBe(originalImage.shadowOffsetY);
      expect(resizedImage.pixelate).toBe(originalImage.pixelate);

      const originalFrame = items[5] as Extract<El, { type: "frame" }>;
      const resizedFrame = result[5] as Extract<El, { type: "frame" }>;
      const framePosition = transformedPosition(
        originalFrame.x,
        originalFrame.y,
        source,
        target,
        scale
      );
      expectClose(resizedFrame.x, framePosition.x);
      expectClose(resizedFrame.y, framePosition.y);
      expectClose(resizedFrame.width, originalFrame.width * scale);
      expectClose(resizedFrame.height, originalFrame.height * scale);
      expectNumberArrayClose(
        resizedFrame.points ?? [],
        (originalFrame.points ?? []).map((value) => value * scale)
      );
      expect(resizedFrame.strokeWidth).toBe(originalFrame.strokeWidth);

      const originalText = items[6] as Extract<El, { type: "text" }>;
      const resizedText = result[6] as Extract<El, { type: "text" }>;
      const textPosition = transformedPosition(
        originalText.x,
        originalText.y,
        source,
        target,
        scale
      );
      expectClose(resizedText.x, textPosition.x);
      expectClose(resizedText.y, textPosition.y);
      expectClose(resizedText.width, originalText.width * scale);
      expectClose(resizedText.fontSize, originalText.fontSize * scale);
      expect(resizedText.rotation).toBe(originalText.rotation);
      expect(resizedText.skewX).toBe(originalText.skewX);
      expect(resizedText.skewY).toBe(originalText.skewY);
      expect(resizedText.strokeWidth).toBe(originalText.strokeWidth);
      expectClose(
        resizedText.letterSpacing ?? 0,
        (originalText.letterSpacing ?? 0) * scale
      );
      expect(resizedText.lineHeight).toBe(originalText.lineHeight);
      expect(resizedText.shadowBlur).toBe(originalText.shadowBlur);
      expect(resizedText.shadowOffsetX).toBe(originalText.shadowOffsetX);
      expect(resizedText.shadowOffsetY).toBe(originalText.shadowOffsetY);

      const originalFocus = items[7] as Extract<El, { type: "focusLines" }>;
      const resizedFocus = result[7] as Extract<El, { type: "focusLines" }>;
      const focusPosition = transformedPosition(
        originalFocus.x,
        originalFocus.y,
        source,
        target,
        scale
      );
      expectClose(resizedFocus.x, focusPosition.x);
      expectClose(resizedFocus.y, focusPosition.y);
      expectClose(resizedFocus.width, originalFocus.width * scale);
      expectClose(resizedFocus.height, originalFocus.height * scale);
      expectClose(
        resizedFocus.innerRadius,
        originalFocus.innerRadius * scale
      );
      expectClose(
        resizedFocus.outerRadius,
        originalFocus.outerRadius * scale
      );
      expect(resizedFocus.strokeWidth).toBe(originalFocus.strokeWidth);
      expectClose(resizedFocus.noise, originalFocus.noise * scale);
      expect(resizedFocus.rotation).toBe(originalFocus.rotation);

      const originalSticker = items[8] as Extract<El, { type: "sticker" }>;
      const resizedSticker = result[8] as Extract<El, { type: "sticker" }>;
      const stickerPosition = transformedPosition(
        originalSticker.x,
        originalSticker.y,
        source,
        target,
        scale
      );
      expectClose(resizedSticker.x, stickerPosition.x);
      expectClose(resizedSticker.y, stickerPosition.y);
      expectClose(resizedSticker.fontSize, originalSticker.fontSize * scale);
      expect(resizedSticker.rotation).toBe(originalSticker.rotation);
      expect(resizedSticker.skewX).toBe(originalSticker.skewX);
      expect(resizedSticker.skewY).toBe(originalSticker.skewY);
    }
  });

  it("draw 선폭 정책과 procedural line 선폭 정책을 양수 scale 행렬에서 구분한다", () => {
    const source: StudioGroupUniformResizeBounds = {
      x: -80,
      y: 45,
      width: 320,
      height: 180,
    };
    const draw: Extract<El, { type: "draw" }> = {
      id: "draw",
      type: "draw",
      points: [-80, 45, 240, 225],
      stroke: "#111111",
      strokeWidth: 6,
      sampleSpacing: 2.5,
    };
    const focus: Extract<El, { type: "focusLines" }> = {
      id: "focus",
      type: "focusLines",
      x: -80,
      y: 45,
      width: 320,
      height: 180,
      lineCount: 40,
      innerRadius: 30,
      outerRadius: 120,
      stroke: "#111111",
      strokeWidth: 3,
      noise: 2,
      rotation: 0,
    };
    const speed: Extract<El, { type: "speedLines" }> = {
      id: "speed",
      type: "speedLines",
      x: -20,
      y: 70,
      width: 90,
      height: 60,
      lineCount: 24,
      direction: "vertical",
      stroke: "#111111",
      strokeWidth: 2,
      noise: 5,
      rotation: 0,
    };
    const items: El[] = [draw, focus, speed];

    for (const scale of [0.125, 0.5, 1.5, 3, 9]) {
      const target = {
        x: 130,
        y: -250,
        width: source.width * scale,
        height: source.height * scale,
      };
      const preserved = plan(items, source, target);
      const scaled = plan(items, source, target, {
        strokeWidthPolicy: "scale",
      });

      expect(
        (preserved[0] as Extract<El, { type: "draw" }>).strokeWidth
      ).toBe(draw.strokeWidth);
      expect(
        (preserved[0] as Extract<El, { type: "draw" }>).sampleSpacing
      ).toBe(draw.sampleSpacing);
      expectClose(
        (scaled[0] as Extract<El, { type: "draw" }>).strokeWidth,
        draw.strokeWidth * scale
      );
      expectClose(
        (scaled[0] as Extract<El, { type: "draw" }>).sampleSpacing ?? 0,
        (draw.sampleSpacing ?? 0) * scale
      );
      for (const result of [preserved]) {
        expect(
          (result[1] as Extract<El, { type: "focusLines" }>).strokeWidth
        ).toBe(focus.strokeWidth);
        expect(
          (result[2] as Extract<El, { type: "speedLines" }>).strokeWidth
        ).toBe(speed.strokeWidth);
      }
      for (const result of [scaled]) {
        expectClose(
          (result[1] as Extract<El, { type: "focusLines" }>).strokeWidth,
          focus.strokeWidth * scale
        );
        expectClose(
          (result[2] as Extract<El, { type: "speedLines" }>).strokeWidth,
          speed.strokeWidth * scale
        );
      }
    }
  });

  it("identity는 다양한 원점·크기에서 선택과 정책에 관계없이 모든 내부 참조를 보존한다", () => {
    const random = deterministicRandom(FIXED_SEED ^ 0x1357_9bdf);

    for (let caseIndex = 0; caseIndex < 32; caseIndex += 1) {
      const source: StudioGroupUniformResizeBounds = {
        x: between(random, -10_000, 10_000),
        y: between(random, -10_000, 10_000),
        width: between(random, 1, 5_000),
        height: between(random, 1, 5_000),
      };
      const items = createElementMatrix(random, source);
      const snapshot = structuredClone(items);
      const result = plan(items, source, { ...source }, {
        strokeWidthPolicy: caseIndex % 2 === 0 ? "preserve" : "scale",
      });

      expect(items).toEqual(snapshot);
      expectAtomicNoOp(items, result);
    }
  });

  it("비균일·퇴화·음수·비유한 bounds 행렬은 전체 선택을 원자적으로 fail-close한다", () => {
    const source: StudioGroupUniformResizeBounds = {
      x: 10,
      y: -20,
      width: 240,
      height: 160,
    };
    const target: StudioGroupUniformResizeBounds = {
      x: -90,
      y: 80,
      width: 480,
      height: 320,
    };
    const items = createElementMatrix(deterministicRandom(0x51afe), source);
    const cases: Array<{
      sourceBounds: StudioGroupUniformResizeBounds;
      targetBounds: StudioGroupUniformResizeBounds;
    }> = [
      {
        sourceBounds: source,
        targetBounds: { ...target, height: target.height * 1.01 },
      },
      {
        sourceBounds: { ...source, width: 0 },
        targetBounds: target,
      },
      {
        sourceBounds: { ...source, height: -1 },
        targetBounds: target,
      },
      {
        sourceBounds: { ...source, x: Number.NaN },
        targetBounds: target,
      },
      {
        sourceBounds: { ...source, width: Number.POSITIVE_INFINITY },
        targetBounds: target,
      },
      {
        sourceBounds: source,
        targetBounds: { ...target, width: 0 },
      },
      {
        sourceBounds: source,
        targetBounds: { ...target, height: -320 },
      },
      {
        sourceBounds: source,
        targetBounds: { ...target, y: Number.NaN },
      },
      {
        sourceBounds: source,
        targetBounds: { ...target, height: Number.NEGATIVE_INFINITY },
      },
    ];

    for (const invalid of cases) {
      const snapshot = structuredClone(items);
      const result = plan(
        items,
        invalid.sourceBounds,
        invalid.targetBounds
      );
      expect(items).toEqual(snapshot);
      expectAtomicNoOp(items, result);
    }
  });

  it("선택 멤버별 NaN/Infinity 기하 행렬은 유효 멤버까지 포함해 전체를 fail-close한다", () => {
    const source: StudioGroupUniformResizeBounds = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    };
    const target: StudioGroupUniformResizeBounds = {
      x: 25,
      y: -40,
      width: 400,
      height: 200,
    };
    const valid: Extract<El, { type: "image" }> = {
      id: "valid",
      type: "image",
      src: "data:image/png;base64,AA==",
      x: 10,
      y: 20,
      width: 40,
      height: 30,
      rotation: 0,
    };
    const metricDraw: Extract<El, { type: "draw" }> = {
      id: "metric-draw",
      type: "draw",
      points: [0, 0, 20, 20],
      stroke: "#111111",
      strokeWidth: 2,
      sampleSpacing: 1,
      shapeParams: {
        starPoints: 5,
        starInnerRatio: 0.5,
        polygonSides: 6,
        cornerRadius: 4,
      },
      symmetry: {
        type: "radial",
        centerX: 50,
        centerY: 40,
        radialCount: 6,
      },
    };
    const metricImage: Extract<El, { type: "image" }> = {
      id: "metric-image",
      type: "image",
      src: "data:image/png;base64,AA==",
      x: 10,
      y: 10,
      width: 40,
      height: 30,
      rotation: 0,
      cornerRadius: 5,
    };
    const metricText: Extract<El, { type: "text" }> = {
      id: "metric-text",
      type: "text",
      text: "metric",
      x: 10,
      y: 10,
      width: 60,
      fontSize: 20,
      fill: "#111111",
      rotation: 0,
      strokeWidth: 2,
      letterSpacing: 1,
      lineHeight: 1.3,
    };
    const metricBubble: Extract<El, { type: "bubble" }> = {
      id: "metric-bubble",
      type: "bubble",
      variant: "speech",
      text: "metric",
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      fill: "#ffffff",
      textFill: "#111111",
      rotation: 0,
      fontSize: 20,
      lineHeight: 1.2,
      autoShrinkText: true,
      autoShrinkMinFontSize: 10,
      strokeWidth: 2,
      tailHeight: 20,
      tailBase: 12,
    };
    const invalidMembers: El[] = [
      {
        id: "invalid-draw",
        type: "draw",
        points: [0, 0, Number.NaN, 20],
        stroke: "#111111",
        strokeWidth: 2,
      },
      {
        ...metricDraw,
        id: "invalid-draw-sample-spacing",
        sampleSpacing: Number.NaN,
      },
      {
        ...metricDraw,
        id: "invalid-draw-corner-radius",
        shapeParams: {
          ...metricDraw.shapeParams!,
          cornerRadius: Number.POSITIVE_INFINITY,
        },
      },
      {
        ...metricDraw,
        id: "invalid-draw-symmetry",
        symmetry: {
          ...metricDraw.symmetry!,
          centerY: Number.NaN,
        },
      },
      {
        id: "invalid-image",
        type: "image",
        src: "data:image/png;base64,AA==",
        x: Number.POSITIVE_INFINITY,
        y: 0,
        width: 20,
        height: 10,
        rotation: 0,
      },
      {
        ...metricImage,
        id: "invalid-image-corner-radius",
        cornerRadius: Number.NaN,
      },
      {
        id: "invalid-text",
        type: "text",
        text: "bad",
        x: 0,
        y: 0,
        width: 40,
        fontSize: Number.NaN,
        fill: "#111111",
        rotation: 0,
      },
      {
        ...metricText,
        id: "invalid-text-letter-spacing",
        letterSpacing: Number.NaN,
      },
      {
        ...metricText,
        id: "invalid-text-line-height",
        lineHeight: 0,
      },
      {
        ...metricText,
        id: "invalid-text-stroke-width",
        strokeWidth: Number.NEGATIVE_INFINITY,
      },
      {
        id: "invalid-sticker",
        type: "sticker",
        text: "bad",
        x: 0,
        y: 0,
        fontSize: 20,
        rotation: Number.NEGATIVE_INFINITY,
      },
      {
        id: "invalid-bubble",
        type: "bubble",
        variant: "speech",
        text: "bad",
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        fill: "#ffffff",
        textFill: "#111111",
        rotation: 0,
        extraTails: [
          {
            direction: "bottom",
            ratio: 0.5,
            length: Number.NaN,
            base: 10,
            side: "right",
          },
        ],
      },
      {
        ...metricBubble,
        id: "invalid-bubble-font-size",
        fontSize: Number.NaN,
      },
      {
        ...metricBubble,
        id: "invalid-bubble-line-height",
        lineHeight: Number.POSITIVE_INFINITY,
      },
      {
        ...metricBubble,
        id: "invalid-bubble-auto-shrink-min",
        autoShrinkMinFontSize: 0,
      },
      {
        ...metricBubble,
        id: "invalid-bubble-tail-height",
        tailHeight: -1,
      },
      {
        ...metricBubble,
        id: "invalid-bubble-stroke-width",
        strokeWidth: Number.NaN,
      },
      {
        id: "invalid-frame",
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        points: [0, 0, 100, 0, Number.POSITIVE_INFINITY, 60],
      },
      {
        id: "invalid-frame-stroke",
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        strokeWidth: -1,
      },
      {
        id: "invalid-focus",
        type: "focusLines",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        lineCount: 20,
        innerRadius: 10,
        outerRadius: 40,
        stroke: "#111111",
        strokeWidth: 2,
        noise: Number.NaN,
        rotation: 0,
      },
      {
        id: "invalid-speed",
        type: "speedLines",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        lineCount: 20,
        direction: "horizontal",
        stroke: "#111111",
        strokeWidth: Number.POSITIVE_INFINITY,
        rotation: 0,
      },
    ];

    for (const invalid of invalidMembers) {
      const items: El[] = [valid, invalid];
      const snapshot = structuredClone(items);
      const result = plan(items, source, target);

      expect(items).toEqual(snapshot);
      expectAtomicNoOp(items, result);
    }
  });
});
