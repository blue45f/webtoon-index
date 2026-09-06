export interface StudioRailMoreViewport {
  readonly height: number;
  readonly left?: number;
  readonly top?: number;
  readonly width: number;
}

export interface StudioRailMoreTriggerRect {
  readonly bottom: number;
  readonly right: number;
}

export interface StudioRailMorePosition {
  readonly left: number;
  readonly top: number;
}

const STUDIO_RAIL_MORE_GAP_PX = 4;
const STUDIO_RAIL_MORE_MARGIN_PX = 8;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Aligns the popover's lower edge with the trigger when possible, then clamps the complete
 * measured surface into the current visual viewport. Keeping this math DOM-free lets short
 * viewports and a nearly-empty rail remain regression-testable without layout mocks.
 */
export function resolveStudioRailMorePosition(input: {
  readonly popoverHeight: number;
  readonly popoverWidth: number;
  readonly trigger: StudioRailMoreTriggerRect;
  readonly viewport: StudioRailMoreViewport;
}): StudioRailMorePosition {
  const viewportLeft = finiteOr(input.viewport.left, 0);
  const viewportTop = finiteOr(input.viewport.top, 0);
  const viewportWidth = Math.max(0, finiteOr(input.viewport.width, 0));
  const viewportHeight = Math.max(0, finiteOr(input.viewport.height, 0));
  const availableWidth = Math.max(0, viewportWidth - STUDIO_RAIL_MORE_MARGIN_PX * 2);
  const availableHeight = Math.max(0, viewportHeight - STUDIO_RAIL_MORE_MARGIN_PX * 2);
  const popoverWidth = clamp(finiteOr(input.popoverWidth, 0), 0, availableWidth);
  const popoverHeight = clamp(finiteOr(input.popoverHeight, 0), 0, availableHeight);
  const minimumLeft = viewportLeft + STUDIO_RAIL_MORE_MARGIN_PX;
  const maximumLeft = Math.max(
    minimumLeft,
    viewportLeft + viewportWidth - popoverWidth - STUDIO_RAIL_MORE_MARGIN_PX
  );
  const minimumTop = viewportTop + STUDIO_RAIL_MORE_MARGIN_PX;
  const maximumTop = Math.max(
    minimumTop,
    viewportTop + viewportHeight - popoverHeight - STUDIO_RAIL_MORE_MARGIN_PX
  );

  return {
    left: clamp(
      finiteOr(input.trigger.right, minimumLeft) + STUDIO_RAIL_MORE_GAP_PX,
      minimumLeft,
      maximumLeft
    ),
    top: clamp(
      finiteOr(input.trigger.bottom, minimumTop) - popoverHeight,
      minimumTop,
      maximumTop
    ),
  };
}
