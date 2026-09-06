export const STUDIO_EYEDROPPER_LOUPE_WIDTH = 152;
export const STUDIO_EYEDROPPER_LOUPE_HEIGHT = 176;
export const STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE = 112;

export type StudioEyedropperPointerAnchor = Readonly<{
  clientX: number;
  clientY: number;
  pointerType?: "mouse" | "pen" | "touch" | string;
}>;

export type StudioEyedropperLoupePlacement = Readonly<{
  left: number;
  top: number;
  side: "left" | "right" | "above" | "below";
}>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps the loupe off the pen/finger and entirely inside the visual viewport. */
export function placeStudioEyedropperLoupe(input: {
  pointer: StudioEyedropperPointerAnchor;
  viewport: Readonly<{ width: number; height: number }>;
  width?: number;
  height?: number;
  gap?: number;
  padding?: number;
}): StudioEyedropperLoupePlacement {
  const width = Math.max(1, input.width ?? STUDIO_EYEDROPPER_LOUPE_WIDTH);
  const height = Math.max(1, input.height ?? STUDIO_EYEDROPPER_LOUPE_HEIGHT);
  const viewportWidth = Math.max(1, input.viewport.width);
  const viewportHeight = Math.max(1, input.viewport.height);
  const gap = Math.max(0, input.gap ?? 18);
  const padding = Math.max(0, input.padding ?? 8);
  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const maxTop = Math.max(padding, viewportHeight - height - padding);
  const pointerX = Number.isFinite(input.pointer.clientX) ? input.pointer.clientX : 0;
  const pointerY = Number.isFinite(input.pointer.clientY) ? input.pointer.clientY : 0;
  const isTouch = input.pointer.pointerType === "touch";

  if (isTouch) {
    const centeredLeft = clamp(pointerX - width / 2, padding, maxLeft);
    if (pointerY - gap - height >= padding) {
      return { left: centeredLeft, top: pointerY - gap - height, side: "above" };
    }
    return {
      left: centeredLeft,
      top: clamp(pointerY + gap, padding, maxTop),
      side: "below",
    };
  }

  const top = clamp(pointerY - height / 2, padding, maxTop);
  if (pointerX + gap + width <= viewportWidth - padding) {
    return { left: pointerX + gap, top, side: "right" };
  }
  return {
    left: clamp(pointerX - gap - width, padding, maxLeft),
    top,
    side: "left",
  };
}

export function studioEyedropperLoupeCrosshair(input: {
  imageWidth: number;
  imageHeight: number;
  sampleX: number;
  sampleY: number;
  viewSize?: number;
}): Readonly<{ left: number; top: number; pixelSize: number }> {
  const viewSize = Math.max(1, input.viewSize ?? STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE);
  const imageWidth = Math.max(1, input.imageWidth);
  const imageHeight = Math.max(1, input.imageHeight);
  const scale = Math.min(viewSize / imageWidth, viewSize / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  return {
    left: (viewSize - renderedWidth) / 2 + (input.sampleX + 0.5) * scale,
    top: (viewSize - renderedHeight) / 2 + (input.sampleY + 0.5) * scale,
    pixelSize: Math.max(3, scale),
  };
}
