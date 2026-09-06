export interface CanvasImageElement {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface CanvasImagePlacementPoint {
  x: number;
  y: number;
}

export interface CanvasImagePlacementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Context-aware placement used by asset/template insertion.
 *
 * Without this option the legacy document-center behavior is retained for
 * call sites that intentionally create full-page render layers. Interactive
 * insertions pass an anchor and bounds so the result stays inside the chosen
 * frame/current document while preserving its aspect ratio.
 */
export interface CanvasImagePlacement {
  anchor?: CanvasImagePlacementPoint;
  bounds?: CanvasImagePlacementBounds;
  inset?: number;
  maxScale?: number;
}

interface CanvasImageElementInput {
  id: string;
  src: string;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  horizontalInset?: number;
  minY?: number;
  placement?: CanvasImagePlacement;
}

const ASSET_CASCADE_PATTERN: readonly CanvasImagePlacementPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 2, y: 2 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -2, y: 2 },
  { x: 2, y: -2 },
  { x: -2, y: -2 },
  { x: 0, y: 2 },
];

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Figma/Canva-style repeated-insert offset that avoids perfect stacking. */
export function cascadeCanvasPlacementAnchor(
  anchor: CanvasImagePlacementPoint,
  sequence: number,
  step = 18
): CanvasImagePlacementPoint {
  const safeSequence = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;
  const pattern = ASSET_CASCADE_PATTERN[safeSequence % ASSET_CASCADE_PATTERN.length]!;
  const cycleOffset = Math.floor(safeSequence / ASSET_CASCADE_PATTERN.length) * 5;
  const safeStep = finitePositive(step, 18);
  return {
    x: finiteNumber(anchor.x, 0) + (pattern.x + cycleOffset) * safeStep,
    y: finiteNumber(anchor.y, 0) + (pattern.y + cycleOffset) * safeStep,
  };
}

export function createCanvasImageElement({
  id,
  src,
  canvasWidth,
  canvasHeight,
  sourceWidth,
  sourceHeight,
  horizontalInset = 120,
  minY = 40,
  placement,
}: CanvasImageElementInput): CanvasImageElement {
  const safeCanvasWidth = Math.max(1, finitePositive(canvasWidth, 1));
  const safeCanvasHeight = Math.max(1, finitePositive(canvasHeight, 1));
  const safeSourceWidth = finitePositive(sourceWidth, 1);
  const safeSourceHeight = finitePositive(sourceHeight, 1);

  if (placement) {
    const requestedBounds = placement.bounds ?? {
      x: 0,
      y: 0,
      width: safeCanvasWidth,
      height: safeCanvasHeight,
    };
    const rawLeft = finiteNumber(requestedBounds.x, 0);
    const rawTop = finiteNumber(requestedBounds.y, 0);
    const rawRight = rawLeft + finitePositive(requestedBounds.width, safeCanvasWidth);
    const rawBottom = rawTop + finitePositive(requestedBounds.height, safeCanvasHeight);
    let boundsLeft = clamp(rawLeft, 0, safeCanvasWidth);
    let boundsTop = clamp(rawTop, 0, safeCanvasHeight);
    let boundsRight = clamp(rawRight, 0, safeCanvasWidth);
    let boundsBottom = clamp(rawBottom, 0, safeCanvasHeight);
    // Corrupt/off-document target geometry must never place the result outside the document.
    // Falling back to the whole canvas is more useful than manufacturing a 1px off-edge target.
    if (boundsRight <= boundsLeft || boundsBottom <= boundsTop) {
      boundsLeft = 0;
      boundsTop = 0;
      boundsRight = safeCanvasWidth;
      boundsBottom = safeCanvasHeight;
    }
    const requestedInset = Math.max(0, finiteNumber(placement.inset ?? 0, 0));
    const inset = Math.min(
      requestedInset,
      Math.max(0, (boundsRight - boundsLeft - 1) / 2),
      Math.max(0, (boundsBottom - boundsTop - 1) / 2)
    );
    const innerLeft = boundsLeft + inset;
    const innerTop = boundsTop + inset;
    const innerRight = boundsRight - inset;
    const innerBottom = boundsBottom - inset;
    const maxWidth = Math.max(1, innerRight - innerLeft);
    const maxHeight = Math.max(1, innerBottom - innerTop);
    const maxScale = finitePositive(placement.maxScale ?? 1, 1);
    const fit = Math.min(maxScale, maxWidth / safeSourceWidth, maxHeight / safeSourceHeight);
    const width = Math.max(1, Math.min(Math.round(safeSourceWidth * fit), Math.floor(maxWidth)));
    const height = Math.max(1, Math.min(Math.round(safeSourceHeight * fit), Math.floor(maxHeight)));
    const defaultAnchor = {
      x: boundsLeft + (boundsRight - boundsLeft) / 2,
      y: boundsTop + (boundsBottom - boundsTop) / 2,
    };
    const anchor = placement.anchor ?? defaultAnchor;
    const x = clamp(
      Math.round(finiteNumber(anchor.x, defaultAnchor.x) - width / 2),
      innerLeft,
      innerRight - width
    );
    const y = clamp(
      Math.round(finiteNumber(anchor.y, defaultAnchor.y) - height / 2),
      innerTop,
      innerBottom - height
    );

    return {
      id,
      type: "image",
      src,
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
      rotation: 0,
    };
  }

  const maxWidth = Math.max(1, canvasWidth - horizontalInset);
  const fit = Math.min(1, maxWidth / safeSourceWidth);
  const width = Math.round(safeSourceWidth * fit);
  const height = Math.round(safeSourceHeight * fit);

  return {
    id,
    type: "image",
    src,
    x: Math.round((canvasWidth - width) / 2),
    y: Math.max(minY, Math.round(canvasHeight / 2 - height / 2)),
    width,
    height,
    rotation: 0,
  };
}
