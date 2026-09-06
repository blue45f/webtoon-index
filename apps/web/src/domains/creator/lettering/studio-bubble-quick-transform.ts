/**
 * Studio Bubble Quick Transform
 *
 * 인스펙터의 1-click 말풍선 변형을 위한 순수 코어. 요소의 중심을 유지한 크기 변형과
 * 꼬리/커스텀 외곽선 반전을 하나의 patch로 계산한다. DOM·Konva·저장소·서버 의존성이 없다.
 */
import { normalizeCustomShapePoints } from "./studio-bubble-custom-shape";
import { normalizeExtraTails } from "./studio-bubble-path";

import type { BubbleEl } from "../studio-element-model";

export type BubbleQuickTransformAction =
  | "widen"
  | "narrow"
  | "heighten"
  | "shorten"
  | "flip-horizontal"
  | "flip-vertical";

export const BUBBLE_QUICK_TRANSFORM_SCALE_UP = 1.12;
export const BUBBLE_QUICK_TRANSFORM_SCALE_DOWN = 0.88;
export const BUBBLE_QUICK_TRANSFORM_MIN_WIDTH = 60;
export const BUBBLE_QUICK_TRANSFORM_MIN_HEIGHT = 50;
export const BUBBLE_QUICK_TRANSFORM_MAX_SIZE = 8192;

export type BubbleQuickTransformSource = Pick<
  BubbleEl,
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "variant"
  | "tail"
  | "tailDirection"
  | "tailXRatio"
  | "tailBend"
  | "tailAnchorId"
  | "tailAnchorPoint"
  | "extraTails"
  | "customShapePoints"
>;

export type BubbleQuickTransformPatch = Partial<
  Pick<
    BubbleEl,
    | "x"
    | "y"
    | "width"
    | "height"
    | "tail"
    | "tailDirection"
    | "tailXRatio"
    | "tailBend"
    | "extraTails"
    | "customShapePoints"
  >
>;

export interface BubbleQuickTransformResult {
  action: BubbleQuickTransformAction;
  changed: boolean;
  outcome: "applied" | "anchored-tail" | "invalid-geometry" | "size-limit" | "unchanged";
  patch: BubbleQuickTransformPatch;
}

const roundGeometry = (value: number): number => Math.round(value * 100) / 100;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function isFiniteGeometry(source: BubbleQuickTransformSource): boolean {
  return [source.x, source.y, source.width, source.height, source.rotation].every(Number.isFinite) &&
    source.width > 0 &&
    source.height > 0;
}

function resizeAroundVisualCenter(
  source: BubbleQuickTransformSource,
  nextWidth: number,
  nextHeight: number
): BubbleQuickTransformPatch {
  const localDx = (source.width - nextWidth) / 2;
  const localDy = (source.height - nextHeight) / 2;
  const radians = (source.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const patch: BubbleQuickTransformPatch = {
    x: roundGeometry(source.x + localDx * cos - localDy * sin),
    y: roundGeometry(source.y + localDx * sin + localDy * cos),
    width: nextWidth,
    height: nextHeight,
  };
  const points = normalizeCustomShapePoints(source.customShapePoints);
  if (points) {
    const scaleX = nextWidth / source.width;
    const scaleY = nextHeight / source.height;
    patch.customShapePoints = points.map((value, index) =>
      roundGeometry(value * (index % 2 === 0 ? scaleX : scaleY))
    );
  }
  return patch;
}

function mirroredDirection(
  direction: NonNullable<BubbleEl["tailDirection"]>,
  axis: "horizontal" | "vertical"
): NonNullable<BubbleEl["tailDirection"]> {
  if (axis === "horizontal") {
    if (direction === "left") return "right";
    if (direction === "right") return "left";
    return direction;
  }
  if (direction === "top") return "bottom";
  if (direction === "bottom") return "top";
  return direction;
}

function shouldMirrorRatio(
  direction: NonNullable<BubbleEl["tailDirection"]>,
  axis: "horizontal" | "vertical"
): boolean {
  return axis === "horizontal"
    ? direction === "top" || direction === "bottom"
    : direction === "left" || direction === "right";
}

function flipTailSide(side: "left" | "right" | "center"): "left" | "right" | "center" {
  return side === "left" ? "right" : side === "right" ? "left" : "center";
}

function flipPatch(
  source: BubbleQuickTransformSource,
  axis: "horizontal" | "vertical"
): BubbleQuickTransformPatch {
  const patch: BubbleQuickTransformPatch = {};
  const direction = source.tailDirection ?? "bottom";
  const ratioMirrored = shouldMirrorRatio(direction, axis);

  if (source.tail !== "none") {
    patch.tailDirection = mirroredDirection(direction, axis);
    if (ratioMirrored) {
      const ratio = Number.isFinite(source.tailXRatio) ? source.tailXRatio! : 0.35;
      patch.tailXRatio = roundGeometry(1 - clamp01(ratio));
    }
    if (source.tailBend !== undefined && Number.isFinite(source.tailBend) && ratioMirrored) {
      patch.tailBend = roundGeometry(-source.tailBend);
    }

    // thought 변형은 작은 구름방울의 축 위치를 tail(left/right)로 계산하므로 해당 축에서만 반전한다.
    if (source.variant === "thought" && ratioMirrored) {
      patch.tail = (source.tail ?? "left") === "right" ? "left" : "right";
    }
  }

  const extraTails = normalizeExtraTails(source.extraTails);
  if (extraTails.length) {
    patch.extraTails = extraTails.map((tail) => {
      const mirrorAlongSegment = shouldMirrorRatio(tail.direction, axis);
      return {
        ...tail,
        direction: mirroredDirection(tail.direction, axis),
        ratio: mirrorAlongSegment ? roundGeometry(1 - clamp01(tail.ratio)) : tail.ratio,
        side: mirrorAlongSegment ? flipTailSide(tail.side) : tail.side,
        bend:
          tail.bend === undefined || !mirrorAlongSegment
            ? tail.bend
            : roundGeometry(-tail.bend),
      };
    });
  }

  const points = normalizeCustomShapePoints(source.customShapePoints);
  if (points) {
    patch.customShapePoints = points.map((value, index) => {
      if (axis === "horizontal" && index % 2 === 0) return roundGeometry(source.width - value);
      if (axis === "vertical" && index % 2 === 1) return roundGeometry(source.height - value);
      return value;
    });
  }
  return patch;
}

/** 말풍선 하나에 1-click 변형을 계산한다. patch가 비어 있으면 호출자는 히스토리를 만들지 않는다. */
export function applyBubbleQuickTransform(
  source: BubbleQuickTransformSource,
  action: BubbleQuickTransformAction
): BubbleQuickTransformResult {
  if (!isFiniteGeometry(source)) return { action, changed: false, outcome: "invalid-geometry", patch: {} };

  if (action === "flip-horizontal" || action === "flip-vertical") {
    if (source.tailAnchorId || source.tailAnchorPoint) {
      return { action, changed: false, outcome: "anchored-tail", patch: {} };
    }
    const patch = flipPatch(source, action === "flip-horizontal" ? "horizontal" : "vertical");
    const changed = Object.keys(patch).length > 0;
    return { action, changed, outcome: changed ? "applied" : "unchanged", patch };
  }

  const horizontal = action === "widen" || action === "narrow";
  const growing = action === "widen" || action === "heighten";
  const currentSize = horizontal ? source.width : source.height;
  const minimumSize = horizontal ? BUBBLE_QUICK_TRANSFORM_MIN_WIDTH : BUBBLE_QUICK_TRANSFORM_MIN_HEIGHT;
  if (
    (growing && currentSize >= BUBBLE_QUICK_TRANSFORM_MAX_SIZE) ||
    (!growing && currentSize <= minimumSize)
  ) {
    return { action, changed: false, outcome: "size-limit", patch: {} };
  }
  const factor = growing ? BUBBLE_QUICK_TRANSFORM_SCALE_UP : BUBBLE_QUICK_TRANSFORM_SCALE_DOWN;
  const requested = roundGeometry(currentSize * factor);
  const nextSize = Math.min(
    BUBBLE_QUICK_TRANSFORM_MAX_SIZE,
    Math.max(minimumSize, requested)
  );
  if (nextSize === currentSize) return { action, changed: false, outcome: "size-limit", patch: {} };
  const patch = resizeAroundVisualCenter(
    source,
    horizontal ? nextSize : source.width,
    horizontal ? source.height : nextSize
  );
  return { action, changed: true, outcome: "applied", patch };
}

/** UI가 무반응 버튼을 노출하지 않도록 action별 적용 불가 사유를 제공한다. */
export function bubbleQuickTransformUnavailableReason(
  source: BubbleQuickTransformSource,
  action: BubbleQuickTransformAction
): string | null {
  const result = applyBubbleQuickTransform(source, action);
  if (result.changed) return null;
  if (result.outcome === "anchored-tail") {
    return "꼬리 자동 부착 상태입니다. 좌우·상하 반전은 해제 후 사용할 수 있습니다.";
  }
  if (result.outcome === "invalid-geometry") return "현재 말풍선 형상을 먼저 복구하세요.";
  if (result.outcome === "unchanged") return "반전할 비대칭 외곽선이나 꼬리가 없습니다.";
  if (result.outcome === "size-limit") {
    if (action === "narrow") return `최소 너비 ${BUBBLE_QUICK_TRANSFORM_MIN_WIDTH}px입니다.`;
    if (action === "shorten") return `최소 높이 ${BUBBLE_QUICK_TRANSFORM_MIN_HEIGHT}px입니다.`;
    return `최대 크기 ${BUBBLE_QUICK_TRANSFORM_MAX_SIZE}px입니다.`;
  }
  return null;
}
