export const STUDIO_CANVAS_RULER_THICKNESS = 22;
export const STUDIO_CANVAS_RULER_DRAG_THRESHOLD = 4;
export const STUDIO_CANVAS_RULER_MAX_TICKS = 4_096;

export type StudioCanvasRulerAxis = "x" | "y";

export interface StudioCanvasRulerTick {
  readonly documentPosition: number;
  readonly screenPosition: number;
  readonly major: boolean;
  readonly label: string | null;
}

export interface StudioCanvasRulerRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function normalizeStudioCanvasRulerScale(scale: number): number | null {
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function normalizeStudioCanvasRulerDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(4, Math.max(1, dpr));
}

export function studioCanvasRulerBackingPixels(
  cssPixels: number,
  dpr: number
): number {
  if (!Number.isFinite(cssPixels) || cssPixels <= 0) return 1;
  return Math.max(1, Math.round(cssPixels * normalizeStudioCanvasRulerDpr(dpr)));
}

/** Aligns a one-device-pixel stroke to its physical pixel centre. */
export function snapStudioCanvasRulerDevicePixel(
  cssPosition: number,
  dpr: number
): number {
  const ratio = normalizeStudioCanvasRulerDpr(dpr);
  if (!Number.isFinite(cssPosition)) return 0.5 / ratio;
  return (Math.round(cssPosition * ratio) + 0.5) / ratio;
}

export function studioCanvasRulerMajorStep(scale: number): number | null {
  const safeScale = normalizeStudioCanvasRulerScale(scale);
  if (!safeScale) return null;
  const rawDocumentStep = 48 / safeScale;
  const magnitude = 10 ** Math.floor(Math.log10(rawDocumentStep));
  const normalized = rawDocumentStep / magnitude;
  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function formatTickLabel(position: number, majorStep: number): string {
  if (majorStep >= 1) return `${Math.round(position)}`;
  const precision = Math.min(3, Math.max(1, Math.ceil(-Math.log10(majorStep))));
  return position.toFixed(precision).replace(/\.?0+$/u, "");
}

export function createStudioCanvasRulerTicks(input: {
  readonly viewportPixels: number;
  readonly scrollPixels: number;
  readonly scale: number;
  readonly documentExtent: number;
}): StudioCanvasRulerTick[] {
  const scale = normalizeStudioCanvasRulerScale(input.scale);
  if (
    !scale
    || !Number.isFinite(input.viewportPixels)
    || input.viewportPixels <= 0
    || !Number.isFinite(input.documentExtent)
    || input.documentExtent < 0
  ) {
    return [];
  }
  const scrollPixels = Number.isFinite(input.scrollPixels)
    ? input.scrollPixels
    : 0;
  const majorStep = studioCanvasRulerMajorStep(scale);
  if (!majorStep) return [];
  const minorStep = majorStep / 5;
  const firstIndex = Math.max(
    0,
    Math.floor(scrollPixels / scale / minorStep) - 1
  );
  const lastDocumentPosition = Math.min(
    input.documentExtent,
    (scrollPixels + input.viewportPixels) / scale + minorStep
  );
  const lastIndex = Math.ceil(lastDocumentPosition / minorStep);
  const ticks: StudioCanvasRulerTick[] = [];

  for (
    let index = firstIndex;
    index <= lastIndex && ticks.length < STUDIO_CANVAS_RULER_MAX_TICKS;
    index += 1
  ) {
    const documentPosition = index * minorStep;
    if (documentPosition < 0 || documentPosition > input.documentExtent) continue;
    const screenPosition = documentPosition * scale - scrollPixels;
    if (
      screenPosition < -minorStep * scale
      || screenPosition > input.viewportPixels + minorStep * scale
    ) {
      continue;
    }
    const major = index % 5 === 0;
    ticks.push({
      documentPosition,
      screenPosition,
      major,
      label: major ? formatTickLabel(documentPosition, majorStep) : null,
    });
  }
  return ticks;
}

export function studioCanvasRulerDocumentCoordinate(input: {
  readonly clientCoordinate: number;
  readonly rulerStart: number;
  readonly scrollPixels: number;
  readonly scale: number;
  readonly documentExtent: number;
}): number | null {
  const scale = normalizeStudioCanvasRulerScale(input.scale);
  if (
    !scale
    || !Number.isFinite(input.clientCoordinate)
    || !Number.isFinite(input.rulerStart)
    || !Number.isFinite(input.documentExtent)
    || input.documentExtent < 0
  ) {
    return null;
  }
  const scrollPixels = Number.isFinite(input.scrollPixels)
    ? input.scrollPixels
    : 0;
  const coordinate =
    (input.clientCoordinate - input.rulerStart + scrollPixels) / scale;
  if (!Number.isFinite(coordinate)) return null;
  return Math.min(input.documentExtent, Math.max(0, coordinate));
}

export function shouldStartStudioCanvasRulerGuideDrag(
  axis: StudioCanvasRulerAxis,
  pointer: { readonly clientX: number; readonly clientY: number },
  rect: StudioCanvasRulerRect,
  threshold = STUDIO_CANVAS_RULER_DRAG_THRESHOLD
): boolean {
  if (
    !Number.isFinite(pointer.clientX)
    || !Number.isFinite(pointer.clientY)
    || !Object.values(rect).every(Number.isFinite)
  ) {
    return false;
  }
  const safeThreshold =
    Number.isFinite(threshold) && threshold >= 0
      ? threshold
      : STUDIO_CANVAS_RULER_DRAG_THRESHOLD;
  return axis === "x"
    ? pointer.clientY >= rect.bottom + safeThreshold
    : pointer.clientX >= rect.right + safeThreshold;
}
