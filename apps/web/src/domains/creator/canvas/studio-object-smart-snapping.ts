/**
 * Studio Object Smart Snapping & Equal Spacing Guides
 *
 * CLIP STUDIO PAINT Ver.4.0.0 Parity:
 * - Smart Snapping (스마트 정렬 스냅):
 *   - Snaps moving objects (speech bubbles, panels, stickers, text, shapes) to:
 *     - Edges (left, right, top, bottom) of reference objects
 *     - Centers (horizontal center, vertical center) of reference objects
 *   - Equal Spacing Snapping (등간격 분배 스냅):
 *     - Detects when an object is positioned at identical intervals between adjacent objects.
 *   - Generates visual guide lines for rendering alignment crosshairs / extension lines.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface BoundingBox2D {
  readonly id: string;
  readonly x: number; // left
  readonly y: number; // top
  readonly width: number;
  readonly height: number;
}

export interface AlignmentGuideLine {
  readonly orientation: "horizontal" | "vertical";
  readonly position: number; // Y for horizontal, X for vertical
  readonly start: number;
  readonly end: number;
  readonly kind: "edge" | "center" | "spacing";
  readonly gapSize?: number;
}

export interface SmartSnapResult {
  readonly snappedX: number;
  readonly snappedY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly guides: readonly AlignmentGuideLine[];
}

export interface SmartSnapOptions {
  readonly snapThresholdPx?: number; // default: 8px
  readonly enableEqualSpacing?: boolean; // default: true
}

/**
 * Calculates smart snapping and alignment guides for an active moving box against reference boxes.
 */
export function computeSmartSnapping(
  activeBox: BoundingBox2D,
  referenceBoxes: readonly BoundingBox2D[],
  options: SmartSnapOptions = {},
): SmartSnapResult {
  const threshold = options.snapThresholdPx ?? 8;
  const enableSpacing = options.enableEqualSpacing ?? true;

  const activeLeft = activeBox.x;
  const activeRight = activeBox.x + activeBox.width;
  const activeCenterX = activeBox.x + activeBox.width / 2;

  const activeTop = activeBox.y;
  const activeBottom = activeBox.y + activeBox.height;
  const activeCenterY = activeBox.y + activeBox.height / 2;

  let bestDeltaX = 0;
  let minDiffX = threshold + 1;
  const guides: AlignmentGuideLine[] = [];

  let bestDeltaY = 0;
  let minDiffY = threshold + 1;

  // Filter out the active box itself
  const others = referenceBoxes.filter((b) => b.id !== activeBox.id);

  // 1. Edge & Center Snapping on X axis
  for (const ref of others) {
    const refLeft = ref.x;
    const refRight = ref.x + ref.width;
    const refCenterX = ref.x + ref.width / 2;

    const xPairs = [
      { active: activeLeft, ref: refLeft, kind: "edge" as const },
      { active: activeRight, ref: refRight, kind: "edge" as const },
      { active: activeLeft, ref: refRight, kind: "edge" as const },
      { active: activeRight, ref: refLeft, kind: "edge" as const },
      { active: activeCenterX, ref: refCenterX, kind: "center" as const },
    ];

    for (const pair of xPairs) {
      const diff = pair.ref - pair.active;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < minDiffX) {
        minDiffX = Math.abs(diff);
        bestDeltaX = diff;
        guides.push({
          orientation: "vertical",
          position: pair.ref,
          start: Math.min(activeTop, ref.y),
          end: Math.max(activeBottom, ref.y + ref.height),
          kind: pair.kind,
        });
      }
    }
  }

  // 2. Edge & Center Snapping on Y axis
  for (const ref of others) {
    const refTop = ref.y;
    const refBottom = ref.y + ref.height;
    const refCenterY = ref.y + ref.height / 2;

    const yPairs = [
      { active: activeTop, ref: refTop, kind: "edge" as const },
      { active: activeBottom, ref: refBottom, kind: "edge" as const },
      { active: activeTop, ref: refBottom, kind: "edge" as const },
      { active: activeBottom, ref: refTop, kind: "edge" as const },
      { active: activeCenterY, ref: refCenterY, kind: "center" as const },
    ];

    for (const pair of yPairs) {
      const diff = pair.ref - pair.active;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < minDiffY) {
        minDiffY = Math.abs(diff);
        bestDeltaY = diff;
        guides.push({
          orientation: "horizontal",
          position: pair.ref,
          start: Math.min(activeLeft, ref.x),
          end: Math.max(activeRight, ref.x + ref.width),
          kind: pair.kind,
        });
      }
    }
  }

  // 3. Equal Spacing Snapping (등간격 분배 가이드)
  if (enableSpacing && others.length >= 2) {
    // Sort boxes horizontally to check intervals
    const sortedX = [...others].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sortedX.length - 1; i++) {
      const b1 = sortedX[i];
      const b2 = sortedX[i + 1];
      const existingGap = b2.x - (b1.x + b1.width);

      if (existingGap > 0) {
        // Check if activeBox placed after b2 with same gap: b2.right + existingGap
        const targetX = b2.x + b2.width + existingGap;
        const diff = targetX - activeLeft;
        if (Math.abs(diff) <= threshold && Math.abs(diff) < minDiffX) {
          bestDeltaX = diff;
          guides.push({
            orientation: "vertical",
            position: targetX,
            start: activeTop,
            end: activeBottom,
            kind: "spacing",
            gapSize: Math.round(existingGap),
          });
        }
      }
    }
  }

  return Object.freeze({
    snappedX: Math.round(activeBox.x + bestDeltaX),
    snappedY: Math.round(activeBox.y + bestDeltaY),
    deltaX: Math.round(bestDeltaX),
    deltaY: Math.round(bestDeltaY),
    guides: Object.freeze(guides),
  });
}
