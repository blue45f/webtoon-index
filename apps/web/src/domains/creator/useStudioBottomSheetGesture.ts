import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";

const DEFAULT_DISMISS_DISTANCE = 84;
const DEFAULT_DISMISS_VELOCITY = 0.62;
const DEFAULT_DRAG_SLOP = 6;
const DEFAULT_RESET_DURATION = 180;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface InlineStyleSnapshot {
  transform: string;
  transition: string;
  willChange: string;
}

interface ActiveDrag {
  handle: StudioBottomSheetGestureHandle;
  maxTravel: number;
  pointerId: number;
  snapshot: InlineStyleSnapshot;
  startTime: number;
  startY: number;
}

interface PendingReset {
  snapshot: InlineStyleSnapshot;
  timer: ReturnType<typeof setTimeout>;
}

export interface StudioBottomSheetGestureHandle {
  releasePointerCapture?: (pointerId: number) => void;
  setPointerCapture: (pointerId: number) => void;
}

export interface StudioBottomSheetPointerEvent {
  button: number;
  clientY: number;
  currentTarget: StudioBottomSheetGestureHandle;
  isPrimary: boolean;
  pointerId: number;
  preventDefault: () => void;
  timeStamp: number;
}

export interface StudioBottomSheetClickEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface StudioBottomSheetGestureControllerOptions {
  dismissDistance?: number;
  dismissVelocity?: number;
  dragSlop?: number;
  onActivate?: () => void;
  onCollapse?: () => void;
  onDismiss: () => void;
  onExpand?: () => void;
  reducedMotion?: boolean;
  resetDuration?: number;
  sheet: HTMLElement;
}

export interface StudioBottomSheetGestureController {
  dispose: () => void;
  handleClick: (event: StudioBottomSheetClickEvent) => void;
  handleLostPointerCapture: (event: Pick<StudioBottomSheetPointerEvent, "pointerId">) => void;
  handlePointerCancel: (event: StudioBottomSheetPointerEvent) => void;
  handlePointerDown: (event: StudioBottomSheetPointerEvent) => void;
  handlePointerMove: (event: StudioBottomSheetPointerEvent) => void;
  handlePointerUp: (event: StudioBottomSheetPointerEvent) => void;
}

export interface StudioBottomSheetHandleProps {
  "aria-label": string;
  "aria-roledescription": string;
  "data-studio-sheet-drag-handle": "true";
  onClick: MouseEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  style: CSSProperties;
  type: "button";
}

interface UseStudioBottomSheetGestureOptions
  extends Omit<StudioBottomSheetGestureControllerOptions, "reducedMotion" | "sheet"> {
  activeKey: string | null;
  ariaLabel?: string;
  /** Slider keyboard collapse can clamp at its minimum while pointer collapse still dismisses. */
  onKeyboardCollapse?: () => void;
  reducedMotion?: boolean;
  sheetRef: RefObject<HTMLElement | null>;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function eventTime(event: StudioBottomSheetPointerEvent): number {
  return Number.isFinite(event.timeStamp) && event.timeStamp >= 0
    ? event.timeStamp
    : globalThis.performance?.now?.() ?? Date.now();
}

function snapshotStyle(sheet: HTMLElement): InlineStyleSnapshot {
  return {
    transform: sheet.style.transform,
    transition: sheet.style.transition,
    willChange: sheet.style.willChange,
  };
}

function restoreStyle(sheet: HTMLElement, snapshot: InlineStyleSnapshot): void {
  sheet.style.transform = snapshot.transform;
  sheet.style.transition = snapshot.transition;
  sheet.style.willChange = snapshot.willChange;
}

function prefersReducedMotion(sheet: HTMLElement): boolean {
  return sheet.ownerDocument.defaultView?.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

function releasePointer(handle: StudioBottomSheetGestureHandle, pointerId: number): void {
  try {
    handle.releasePointerCapture?.(pointerId);
  } catch {
    // Capture may already have been released by the browser during pointercancel/unmount.
  }
}

/**
 * Imperative gesture core used by the React hook and deterministic Node tests. Pointer movement
 * writes directly to the sheet's compositor transform, so a drag never schedules React renders.
 */
export function createStudioBottomSheetGestureController({
  dismissDistance: dismissDistanceOption,
  dismissVelocity: dismissVelocityOption,
  dragSlop: dragSlopOption,
  onActivate,
  onCollapse,
  onDismiss,
  onExpand,
  reducedMotion: reducedMotionOption,
  resetDuration: resetDurationOption,
  sheet,
}: StudioBottomSheetGestureControllerOptions): StudioBottomSheetGestureController {
  const dismissDistance = finitePositive(dismissDistanceOption, DEFAULT_DISMISS_DISTANCE);
  const dismissVelocity = finitePositive(dismissVelocityOption, DEFAULT_DISMISS_VELOCITY);
  const dragSlop = finitePositive(dragSlopOption, DEFAULT_DRAG_SLOP);
  const resetDuration = finitePositive(resetDurationOption, DEFAULT_RESET_DURATION);
  const reducedMotion = reducedMotionOption ?? prefersReducedMotion(sheet);
  let activeDrag: ActiveDrag | null = null;
  let dismissed = false;
  let disposed = false;
  let pendingReset: PendingReset | null = null;
  let suppressNextClick = false;

  const finishPendingReset = () => {
    if (!pendingReset) return;
    clearTimeout(pendingReset.timer);
    restoreStyle(sheet, pendingReset.snapshot);
    pendingReset = null;
  };

  const restoreDrag = (drag: ActiveDrag, animate: boolean) => {
    finishPendingReset();
    if (!animate || reducedMotion) {
      restoreStyle(sheet, drag.snapshot);
      return;
    }

    sheet.style.transition = `transform ${resetDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    sheet.style.transform = drag.snapshot.transform || "translate3d(0, 0, 0)";
    sheet.style.willChange = "transform";
    const snapshot = drag.snapshot;
    const timer = setTimeout(() => {
      restoreStyle(sheet, snapshot);
      if (pendingReset?.timer === timer) pendingReset = null;
    }, resetDuration);
    pendingReset = { snapshot, timer };
  };

  const finishDrag = (
    event: StudioBottomSheetPointerEvent,
    reason: "cancel" | "release",
  ) => {
    const drag = activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const endY = Number.isFinite(event.clientY) ? event.clientY : drag.startY;
    const distance = endY - drag.startY;
    drag.maxTravel = Math.max(drag.maxTravel, Math.abs(endY - drag.startY));
    const elapsed = Math.max(1, eventTime(event) - drag.startTime);
    const velocity = Math.abs(distance) / elapsed;
    const wasDragged = drag.maxTravel >= dragSlop;
    const shouldStep =
      reason === "release" &&
      wasDragged &&
      (Math.abs(distance) >= dismissDistance || velocity >= dismissVelocity);
    const shouldDismiss = shouldStep && distance > 0 && !onCollapse;

    activeDrag = null;
    releasePointer(drag.handle, drag.pointerId);
    // Pointer Events synthesize a click after pointerup. Consume it whenever the pointer actually
    // dragged, including a sub-threshold snap-back, or the semantic handle button would close it.
    suppressNextClick = reason === "release" && wasDragged;
    restoreDrag(drag, !shouldStep);
    if (shouldStep && distance < 0 && !disposed) onExpand?.();
    if (shouldStep && distance > 0 && onCollapse && !disposed) onCollapse();
    if (shouldDismiss && !dismissed && !disposed) {
      dismissed = true;
      onDismiss();
    }
  };

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      const drag = activeDrag;
      activeDrag = null;
      if (drag) {
        releasePointer(drag.handle, drag.pointerId);
        restoreStyle(sheet, drag.snapshot);
      }
      finishPendingReset();
      suppressNextClick = false;
    },
    handleClick(event) {
      if (disposed) return;
      if (suppressNextClick || dismissed) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (onActivate) onActivate();
      else {
        dismissed = true;
        onDismiss();
      }
    },
    handleLostPointerCapture(event) {
      const drag = activeDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      activeDrag = null;
      // A lost capture/cancel path does not synthesize a click. Leaving suppression armed here
      // would swallow the user's next intentional keyboard or pointer activation.
      suppressNextClick = false;
      restoreDrag(drag, true);
    },
    handlePointerCancel(event) {
      finishDrag(event, "cancel");
    },
    handlePointerDown(event) {
      if (
        disposed ||
        dismissed ||
        activeDrag ||
        !event.isPrimary ||
        event.button !== 0 ||
        !Number.isFinite(event.clientY) ||
        !Number.isFinite(event.pointerId)
      ) {
        return;
      }
      finishPendingReset();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      const snapshot = snapshotStyle(sheet);
      activeDrag = {
        handle: event.currentTarget,
        maxTravel: 0,
        pointerId: event.pointerId,
        snapshot,
        startTime: eventTime(event),
        startY: event.clientY,
      };
      sheet.style.transition = "none";
      sheet.style.willChange = "transform";
      event.preventDefault();
    },
    handlePointerMove(event) {
      const drag = activeDrag;
      if (!drag || drag.pointerId !== event.pointerId || !Number.isFinite(event.clientY)) return;
      const rawDistance = event.clientY - drag.startY;
      drag.maxTravel = Math.max(drag.maxTravel, Math.abs(rawDistance));
      const distance = rawDistance < 0 && !onExpand ? 0 : rawDistance;
      sheet.style.transform = `translate3d(0, ${distance.toFixed(2)}px, 0)`;
      event.preventDefault();
    },
    handlePointerUp(event) {
      finishDrag(event, "release");
    },
  };
}

/**
 * Adds a compositor-only swipe-to-dismiss gesture to one active mobile sheet. Spread handleProps
 * onto a dedicated 44px-high button; the rest of the scrollable sheet keeps native touch action.
 */
export function useStudioBottomSheetGesture({
  activeKey,
  ariaLabel = "아래로 밀거나 눌러 시트 닫기",
  dismissDistance,
  dismissVelocity,
  dragSlop,
  onActivate,
  onCollapse,
  onDismiss,
  onExpand,
  onKeyboardCollapse,
  reducedMotion,
  resetDuration,
  sheetRef,
}: UseStudioBottomSheetGestureOptions): { handleProps: StudioBottomSheetHandleProps } {
  const controllerRef = useRef<StudioBottomSheetGestureController | null>(null);
  const dismissRef = useRef(onDismiss);
  const activateRef = useRef(onActivate);
  const collapseRef = useRef(onCollapse);
  const keyboardCollapseRef = useRef(onKeyboardCollapse ?? onCollapse);
  const expandRef = useRef(onExpand);
  dismissRef.current = onDismiss;
  activateRef.current = onActivate;
  collapseRef.current = onCollapse;
  keyboardCollapseRef.current = onKeyboardCollapse ?? onCollapse;
  expandRef.current = onExpand;
  const activateEnabled = onActivate !== undefined;
  const collapseEnabled = onCollapse !== undefined;
  const keyboardCollapseEnabled = onKeyboardCollapse !== undefined || collapseEnabled;
  const expandEnabled = onExpand !== undefined;

  function ensureController(): StudioBottomSheetGestureController | null {
    if (controllerRef.current || !activeKey) return controllerRef.current;
    const sheet = sheetRef.current;
    if (!sheet) return null;
    controllerRef.current = createStudioBottomSheetGestureController({
      dismissDistance,
      dismissVelocity,
      dragSlop,
      onActivate: activateEnabled ? () => activateRef.current?.() : undefined,
      onCollapse: collapseEnabled ? () => collapseRef.current?.() : undefined,
      onDismiss: () => dismissRef.current(),
      onExpand: expandEnabled ? () => expandRef.current?.() : undefined,
      reducedMotion,
      resetDuration,
      sheet,
    });
    return controllerRef.current;
  }

  useLayoutEffect(() => {
    if (activeKey) {
      const sheet = sheetRef.current;
      if (sheet) {
        controllerRef.current = createStudioBottomSheetGestureController({
          dismissDistance,
          dismissVelocity,
          dragSlop,
          onActivate: activateEnabled ? () => activateRef.current?.() : undefined,
          onCollapse: collapseEnabled ? () => collapseRef.current?.() : undefined,
          onDismiss: () => dismissRef.current(),
          onExpand: expandEnabled ? () => expandRef.current?.() : undefined,
          reducedMotion,
          resetDuration,
          sheet,
        });
      }
    }
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [
    activeKey,
    dismissDistance,
    dismissVelocity,
    dragSlop,
    activateEnabled,
    collapseEnabled,
    expandEnabled,
    reducedMotion,
    resetDuration,
    sheetRef,
  ]);

  return {
    handleProps: {
      "aria-label": ariaLabel,
      "aria-roledescription": "드래그 핸들",
      "data-studio-sheet-drag-handle": "true",
      // Enter/Space/assistive-tech activation may dispatch click without pointerdown, so the
      // conditional-mount fallback must also provision a controller on the semantic click path.
      onClick: (event) => ensureController()?.handleClick(event),
      onKeyDown: (event) => {
        if (event.key === "ArrowUp" && expandEnabled) {
          event.preventDefault();
          expandRef.current?.();
        } else if (event.key === "ArrowDown" && keyboardCollapseEnabled) {
          event.preventDefault();
          keyboardCollapseRef.current?.();
        }
      },
      onLostPointerCapture: (event) => controllerRef.current?.handleLostPointerCapture(event),
      onPointerCancel: (event) => controllerRef.current?.handlePointerCancel(event),
      onPointerDown: (event) => {
        // A conditionally mounted sheet can attach its parent ref after the child's first layout
        // pass. Lazily provision the same controller on first activation as a no-render fallback,
        // while the effect cleanup above still owns disposal.
        ensureController()?.handlePointerDown(event);
      },
      onPointerMove: (event) => controllerRef.current?.handlePointerMove(event),
      onPointerUp: (event) => controllerRef.current?.handlePointerUp(event),
      style: { touchAction: "none" },
      type: "button",
    },
  };
}
