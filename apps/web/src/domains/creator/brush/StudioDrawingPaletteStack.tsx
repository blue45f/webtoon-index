/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- WAI-ARIA focusable separators are adjustable widgets with required pointer and keyboard input. */
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  consumeStudioInspectorFocusRequest,
  studioInspectorFocusSnapshot,
  subscribeStudioInspectorFocus,
  type StudioInspectorFocusTarget,
} from "../studio-inspector-focus";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  STUDIO_DRAWING_PALETTE_IDS,
  STUDIO_DRAWING_PALETTE_MAX_PERCENT,
  STUDIO_DRAWING_PALETTE_MIN_PERCENT,
  moveStudioDrawingPalette,
  normalizeStudioDrawingPaletteLayout,
  resizeStudioDrawingPalettes,
  toggleStudioDrawingPaletteLock,
  toggleStudioDrawingPalette,
  type StudioDrawingPaletteId,
  type StudioDrawingPaletteLayout,
  type StudioDrawingPaletteLockKind,
} from "./studio-drawing-palettes";
import {
  STUDIO_DRAWING_PALETTES,
  StudioDrawingPaletteOverlayPortal,
  paletteBody,
  studioDrawingPaletteOverlayId,
  useStudioDrawingPaletteOverlay,
  type StudioDrawingPaletteOverlay,
  type StudioDrawingPalettePresentation,
} from "./StudioDrawingPaletteOptions";

import { cn } from "@/shared/lib/utils";

export interface StudioDrawingPaletteStackProps {
  readonly layout: StudioDrawingPaletteLayout;
  readonly subTools: ReactNode;
  readonly toolProperties: ReactNode;
  readonly onLayoutChange: (layout: StudioDrawingPaletteLayout) => void;
  readonly onDraggingChange?: (dragging: boolean) => void;
  /**
   * Mobile properties sheets already expose tool switching in the thumb dock. When supplied,
   * only this palette is rendered on small screens while the full persisted dock returns at lg.
   */
  readonly mobilePrimaryPaletteId?: StudioDrawingPaletteId;
  readonly mobileHeaderAction?: ReactNode;
  /** Controlled presentation; omit it to let the transient palette-options action own the mode. */
  readonly presentation?: StudioDrawingPalettePresentation;
  readonly defaultPresentation?: StudioDrawingPalettePresentation;
  readonly onPresentationChange?: (presentation: StudioDrawingPalettePresentation) => void;
  /**
   * Increment when the owning workspace/account changes. An active splitter drag is discarded
   * synchronously so a release from the previous owner can never overwrite the next layout.
   */
  readonly cancelEpoch?: number;
  readonly className?: string;
}

export type { StudioDrawingPalettePresentation } from "./StudioDrawingPaletteOptions";
const SPLIT_KEYBOARD_STEP = 2;
const SPLIT_KEYBOARD_LARGE_STEP = 8;
const DOUBLE_TAP_MAX_DELAY_MS = 350;
const TAP_MAX_TRAVEL_PX = 8;
const DOUBLE_TAP_MAX_DISTANCE_PX = 24;
const DRAWING_PALETTE_FOCUS_TARGETS = {
  "palette.sub-tools": "sub-tools",
  "palette.tool-properties": "tool-properties",
  "tool.brush-studio": "tool-properties",
  "tool.brush-engines": "tool-properties",
  "brush.saved-library": "tool-properties",
} as const satisfies Partial<
  Record<StudioInspectorFocusTarget, StudioDrawingPaletteId>
>;

type DrawingPaletteFocusTarget = keyof typeof DRAWING_PALETTE_FOCUS_TARGETS;

function isDrawingPaletteFocusTarget(
  target: StudioInspectorFocusTarget,
): target is DrawingPaletteFocusTarget {
  return target in DRAWING_PALETTE_FOCUS_TARGETS;
}

function isPaletteOnlyFocusTarget(
  target: StudioInspectorFocusTarget,
): target is "palette.sub-tools" | "palette.tool-properties" {
  return target === "palette.sub-tools" || target === "palette.tool-properties";
}

interface ResizeTap {
  readonly at: number;
  readonly clientX: number;
  readonly clientY: number;
}

type PaletteSectionStyle = CSSProperties & {
  "--studio-drawing-palette-size": string;
};

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function paletteCollapsed(
  values: StudioDrawingPaletteLayout["collapsed"],
  id: StudioDrawingPaletteId,
): boolean {
  return values[id];
}

function joinKoreanLabels(first: string, second: string): string {
  const lastCodePoint = first.codePointAt(first.length - 1);
  const hasFinalConsonant =
    lastCodePoint !== undefined &&
    lastCodePoint >= 0xac00 &&
    lastCodePoint <= 0xd7a3 &&
    (lastCodePoint - 0xac00) % 28 !== 0;
  return `${first}${hasFinalConsonant ? "과" : "와"} ${second}`;
}

/** CLIP-familiar, controlled drawing palette dock for ordering and split interaction. */
export function StudioDrawingPaletteStack({
  layout,
  subTools,
  toolProperties,
  onLayoutChange,
  onDraggingChange,
  mobilePrimaryPaletteId,
  mobileHeaderAction,
  presentation: controlledPresentation,
  defaultPresentation = "full",
  onPresentationChange,
  cancelEpoch,
  className,
}: StudioDrawingPaletteStackProps) {
  const normalizedLayout = normalizeStudioDrawingPaletteLayout(layout);
  const stackId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<StudioDrawingPaletteId, HTMLElement | null>>>({});
  const collapseButtonRefs =
    useRef<Partial<Record<StudioDrawingPaletteId, HTMLButtonElement | null>>>({});
  const iconTriggerRefs =
    useRef<Partial<Record<StudioDrawingPaletteId, HTMLButtonElement | null>>>({});
  const lastAutoOpenedFocusTokenRef = useRef(0);
  const focusedBodyRef = useRef<StudioDrawingPaletteId | null>(null);
  const previousCollapsedRef = useRef<StudioDrawingPaletteLayout["collapsed"]>(
    normalizedLayout.collapsed,
  );
  const activeDragCleanupRef =
    useRef<
      ((
        updateDraggingState?: boolean,
        restoreLayout?: StudioDrawingPaletteLayout,
      ) => void) | null
    >(null);
  const previousCancelEpochRef = useRef(cancelEpoch);
  const lastTapRef = useRef<ResizeTap | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uncontrolledPresentation, setUncontrolledPresentation] =
    useState<StudioDrawingPalettePresentation>(defaultPresentation);
  const paletteOverlay = useStudioDrawingPaletteOverlay();
  const dismissPaletteOverlay = paletteOverlay.dismiss;
  const openPaletteOverlay = paletteOverlay.open;
  const presentation = controlledPresentation ?? uncontrolledPresentation;
  const pendingFocusRequest = useSyncExternalStore(
    subscribeStudioInspectorFocus,
    studioInspectorFocusSnapshot,
    () => null,
  );
  const openIds = normalizedLayout.order.filter((id) =>
    mobilePrimaryPaletteId
      ? id === mobilePrimaryPaletteId
      : !paletteCollapsed(normalizedLayout.collapsed, id),
  );
  const bothOpen = openIds.length === 2;
  const firstOpenId = openIds[0] ?? null;
  const secondOpenId = openIds[1] ?? null;
  const emit = useCallback((next: StudioDrawingPaletteLayout): void => {
    onLayoutChange(normalizeStudioDrawingPaletteLayout(next));
  }, [onLayoutChange]);

  useEffect(() => {
    if (controlledPresentation === undefined) {
      setUncontrolledPresentation(defaultPresentation);
    }
    dismissPaletteOverlay();
  }, [controlledPresentation, defaultPresentation, dismissPaletteOverlay]);

  useEffect(() => {
    if (!pendingFocusRequest) return;
    if (!isDrawingPaletteFocusTarget(pendingFocusRequest.target)) return;
    const requestedPaletteId = DRAWING_PALETTE_FOCUS_TARGETS[pendingFocusRequest.target];
    if (lastAutoOpenedFocusTokenRef.current === pendingFocusRequest.token) return;
    lastAutoOpenedFocusTokenRef.current = pendingFocusRequest.token;
    const paletteOnlyRequest = isPaletteOnlyFocusTarget(pendingFocusRequest.target);

    if (presentation === "icon-popup") {
      if (
        paletteOverlay.openOverlay?.kind === "palette" &&
        paletteOverlay.openOverlay.id === requestedPaletteId
      ) {
        if (paletteOnlyRequest) {
          consumeStudioInspectorFocusRequest(
            pendingFocusRequest.target,
            pendingFocusRequest.token,
          );
        }
        return;
      }
      const trigger = iconTriggerRefs.current[requestedPaletteId];
      if (!trigger) return;
      openPaletteOverlay(
        { kind: "palette", id: requestedPaletteId },
        trigger,
      );
      if (paletteOnlyRequest) {
        consumeStudioInspectorFocusRequest(
          pendingFocusRequest.target,
          pendingFocusRequest.token,
        );
      }
      return;
    }

    if (
      !mobilePrimaryPaletteId &&
      normalizedLayout.collapsed[requestedPaletteId]
    ) {
      emit(toggleStudioDrawingPalette(normalizedLayout, requestedPaletteId));
    }
    if (paletteOnlyRequest) {
      consumeStudioInspectorFocusRequest(
        pendingFocusRequest.target,
        pendingFocusRequest.token,
      );
    }
  }, [
    mobilePrimaryPaletteId,
    normalizedLayout,
    emit,
    openPaletteOverlay,
    paletteOverlay.openOverlay,
    pendingFocusRequest,
    presentation,
  ]);

  useEffect(() => {
    const previouslyCollapsed = previousCollapsedRef.current;
    for (const id of normalizedLayout.order) {
      if (!normalizedLayout.collapsed[id] || previouslyCollapsed[id]) continue;
      if (focusedBodyRef.current !== id) continue;
      focusedBodyRef.current = null;
      collapseButtonRefs.current[id]?.focus({ preventScroll: true });
    }
    previousCollapsedRef.current = normalizedLayout.collapsed;
  }, [normalizedLayout.collapsed, normalizedLayout.order]);

  useEffect(() => {
    if (!dragging || typeof document === "undefined") return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  useLayoutEffect(() => {
    if (Object.is(previousCancelEpochRef.current, cancelEpoch)) return;
    previousCancelEpochRef.current = cancelEpoch;
    activeDragCleanupRef.current?.(true, normalizedLayout);
    paletteOverlay.dismiss();
  }, [cancelEpoch, normalizedLayout, paletteOverlay]);

  useLayoutEffect(
    () => () => {
      const cancelActiveDrag = activeDragCleanupRef.current;
      activeDragCleanupRef.current = null;
      cancelActiveDrag?.(false);
    },
    [],
  );

  function changePresentation(
    nextPresentation: StudioDrawingPalettePresentation,
  ): void {
    if (controlledPresentation === undefined) {
      setUncontrolledPresentation(nextPresentation);
    }
    onPresentationChange?.(nextPresentation);
    paletteOverlay.dismiss();
  }

  function toggleLock(
    id: StudioDrawingPaletteId,
    kind: StudioDrawingPaletteLockKind,
  ): void {
    emit(toggleStudioDrawingPaletteLock(normalizedLayout, id, kind));
  }

  function resetSplit(firstId: StudioDrawingPaletteId): void {
    emit(
      resizeStudioDrawingPalettes(
        normalizedLayout,
        firstId,
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes[firstId],
      ),
    );
  }

  function handleSplitKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    firstId: StudioDrawingPaletteId,
  ): void {
    if (
      STUDIO_DRAWING_PALETTE_IDS.some(
        (id) => normalizedLayout.locks[id].height,
      )
    ) {
      return;
    }
    const current = normalizedLayout.sizes[firstId];
    const step = event.shiftKey
      ? SPLIT_KEYBOARD_LARGE_STEP
      : SPLIT_KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === "ArrowUp") next = current - step;
    else if (event.key === "ArrowDown") next = current + step;
    else if (event.key === "Home") next = STUDIO_DRAWING_PALETTE_MIN_PERCENT;
    else if (event.key === "End") next = STUDIO_DRAWING_PALETTE_MAX_PERCENT;
    else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      resetSplit(firstId);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    emit(resizeStudioDrawingPalettes(normalizedLayout, firstId, next));
  }

  function handleSplitPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    firstId: StudioDrawingPaletteId,
    secondId: StudioDrawingPaletteId,
  ): void {
    if (
      normalizedLayout.locks[firstId].height ||
      normalizedLayout.locks[secondId].height ||
      event.isPrimary === false ||
      (typeof event.button === "number" && event.button !== 0)
    ) {
      return;
    }

    activeDragCleanupRef.current?.();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const pointerType = event.pointerType || "mouse";
    const startX = finiteCoordinate(event.clientX);
    const startY = finiteCoordinate(event.clientY);
    let latestX = startX;
    let latestY = startY;
    const startLayout = normalizedLayout;
    const startPercent = startLayout.sizes[firstId];
    const measuredPaletteHeight =
      (sectionRefs.current[firstId]?.getBoundingClientRect().height ?? 0) +
      (sectionRefs.current[secondId]?.getBoundingClientRect().height ?? 0);
    const rootHeight = rootRef.current?.getBoundingClientRect().height ?? 0;
    const availableHeight = Math.max(
      1,
      measuredPaletteHeight > 0 ? measuredPaletteHeight : rootHeight,
    );
    let frame: number | null = null;
    let finished = false;

    const layoutAt = (clientY: number): StudioDrawingPaletteLayout => {
      const deltaPercent = ((clientY - startY) / availableHeight) * 100;
      return resizeStudioDrawingPalettes(
        startLayout,
        firstId,
        startPercent + deltaPercent,
      );
    };
    const paintPreview = (previewLayout: StudioDrawingPaletteLayout): void => {
      for (const id of [firstId, secondId]) {
        sectionRefs.current[id]?.style.setProperty(
          "--studio-drawing-palette-size",
          `${previewLayout.sizes[id]}%`,
        );
      }
      const previewPercent = Math.round(previewLayout.sizes[firstId]);
      target.setAttribute("aria-valuenow", String(previewPercent));
      target.setAttribute(
        "aria-valuetext",
        `${STUDIO_DRAWING_PALETTES[firstId].label} ${previewPercent}%, ${STUDIO_DRAWING_PALETTES[secondId].label} ${Math.round(100 - previewPercent)}%`,
      );
    };
    const restoreControlledLayout = (
      controlledLayout: StudioDrawingPaletteLayout,
    ): void => {
      for (const id of [firstId, secondId]) {
        sectionRefs.current[id]?.style.setProperty(
          "--studio-drawing-palette-size",
          `${controlledLayout.sizes[id]}%`,
        );
      }
      const controlledOpenIds = controlledLayout.order.filter(
        (id) => !paletteCollapsed(controlledLayout.collapsed, id),
      );
      const controlledFirstId = controlledOpenIds[0];
      const controlledSecondId = controlledOpenIds[1];
      if (!controlledFirstId || !controlledSecondId) return;
      const controlledPercent = Math.round(
        controlledLayout.sizes[controlledFirstId],
      );
      target.setAttribute("aria-valuenow", String(controlledPercent));
      target.setAttribute(
        "aria-valuetext",
        `${STUDIO_DRAWING_PALETTES[controlledFirstId].label} ${controlledPercent}%, ${STUDIO_DRAWING_PALETTES[controlledSecondId].label} ${Math.round(100 - controlledPercent)}%`,
      );
    };
    const applyLatestPreview = (): void => {
      frame = null;
      if (finished) return;
      paintPreview(layoutAt(latestY));
    };

    if (pointerType === "mouse") lastTapRef.current = null;
    target.focus({ preventScroll: true });
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      latestX = finiteCoordinate(moveEvent.clientX);
      latestY = finiteCoordinate(moveEvent.clientY);
      if (frame !== null) return;
      if (typeof globalThis.requestAnimationFrame === "function") {
        frame = globalThis.requestAnimationFrame(applyLatestPreview);
      } else {
        applyLatestPreview();
      }
    };
    const teardown = (
      updateDraggingState: boolean,
      restoreLayout: StudioDrawingPaletteLayout,
    ): boolean => {
      if (finished) return false;
      finished = true;
      if (frame !== null) {
        globalThis.cancelAnimationFrame?.(frame);
        frame = null;
      }
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
      globalThis.removeEventListener("pointercancel", onPointerCancel);
      globalThis.removeEventListener("blur", onBlur);
      target.removeEventListener("lostpointercapture", onLostPointerCapture);
      try {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture is optional in older embedded browsers.
      }
      restoreControlledLayout(restoreLayout);
      if (updateDraggingState) setDragging(false);
      onDraggingChange?.(false);
      if (activeDragCleanupRef.current === cancel) {
        activeDragCleanupRef.current = null;
      }
      return true;
    };
    const cancel = (
      updateDraggingState = true,
      restoreLayout: StudioDrawingPaletteLayout = startLayout,
    ): void => {
      lastTapRef.current = null;
      teardown(updateDraggingState, restoreLayout);
    };
    const onPointerUp = (finishEvent: PointerEvent): void => {
      if (finishEvent.pointerId !== pointerId || finished) return;

      // Quick drags can be coalesced straight into pointerup. The release sample is authoritative.
      latestX = finiteCoordinate(finishEvent.clientX);
      latestY = finiteCoordinate(finishEvent.clientY);
      let committedLayout = layoutAt(latestY);
      let immediateReset = false;

      if (pointerType !== "mouse") {
        const travel = Math.hypot(latestX - startX, latestY - startY);
        if (travel <= TAP_MAX_TRAVEL_PX) {
          const now = Date.now();
          const previous = lastTapRef.current;
          immediateReset = Boolean(
            previous &&
              now - previous.at <= DOUBLE_TAP_MAX_DELAY_MS &&
              Math.hypot(
                latestX - previous.clientX,
                latestY - previous.clientY,
              ) <= DOUBLE_TAP_MAX_DISTANCE_PX,
          );
          if (immediateReset) {
            lastTapRef.current = null;
            committedLayout = resizeStudioDrawingPalettes(
              startLayout,
              firstId,
              DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes[firstId],
            );
          } else {
            lastTapRef.current = {
              at: now,
              clientX: latestX,
              clientY: latestY,
            };
          }
        } else {
          lastTapRef.current = null;
        }
      }

      paintPreview(committedLayout);
      if (!teardown(true, startLayout)) return;
      if (
        immediateReset ||
        committedLayout.sizes[firstId] !== startLayout.sizes[firstId]
      ) {
        emit(committedLayout);
      }
    };
    const onPointerCancel = (finishEvent: PointerEvent): void => {
      if (finishEvent.pointerId !== pointerId) return;
      cancel();
    };
    const onBlur = () => cancel();
    const onLostPointerCapture = () => cancel();
    activeDragCleanupRef.current = cancel;

    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Global listeners keep mouse, pen, and touch resizing functional without capture support.
    }
    globalThis.addEventListener("pointermove", onMove, { passive: true });
    globalThis.addEventListener("pointerup", onPointerUp, { passive: true });
    globalThis.addEventListener("pointercancel", onPointerCancel, { passive: true });
    globalThis.addEventListener("blur", onBlur);
    target.addEventListener("lostpointercapture", onLostPointerCapture);
    setDragging(true);
    onDraggingChange?.(true);
  }

  if (presentation === "icon-popup") {
    return (
      <>
        <div
          ref={rootRef}
          data-studio-drawing-palette-stack={true}
          data-studio-drawing-palette-presentation="icon-popup"
          data-studio-drawing-palette-dragging="false"
          className={cn(
            "flex min-w-0 shrink-0 items-center gap-1 overflow-visible rounded-xl border border-line bg-panel/80 p-1",
            "lg:flex-col lg:items-stretch lg:rounded-none lg:border-x-0",
            className,
          )}
        >
          {normalizedLayout.order.map((id) => {
            const definition = STUDIO_DRAWING_PALETTES[id];
            const Icon = definition.Icon;
            const overlay: StudioDrawingPaletteOverlay = {
              kind: "palette",
              id,
            };
            const popupId = studioDrawingPaletteOverlayId(stackId, overlay);
            const expanded =
              paletteOverlay.openOverlay?.kind === "palette" &&
              paletteOverlay.openOverlay.id === id;
            return (
              <button
                key={id}
                ref={(node) => {
                  iconTriggerRefs.current[id] = node;
                  paletteOverlay.setTrigger(overlay, node);
                }}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={expanded}
                aria-controls={popupId}
                aria-label={`${definition.label} 팝업 ${expanded ? "닫기" : "열기"}`}
                title={`${definition.label} — ${definition.description}`}
                data-studio-drawing-palette-icon-trigger={id}
                data-position-locked={
                  normalizedLayout.locks[id].position ? "true" : "false"
                }
                data-height-locked={
                  normalizedLayout.locks[id].height ? "true" : "false"
                }
                onClick={(event) =>
                  paletteOverlay.toggle(overlay, event.currentTarget)
                }
                className={cn(
                  "relative grid size-11 shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-raised hover:text-fg lg:size-9",
                  "lg:flex lg:h-11 lg:w-full lg:items-center lg:justify-start lg:gap-2 lg:px-2.5 lg:text-left",
                  expanded && "bg-accent-soft text-accent",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                )}
              >
                <Icon size={17} strokeWidth={1.8} className="shrink-0" aria-hidden />
                <span className="hidden min-w-0 flex-1 lg:block">
                  <span className="block text-[0.68rem] font-bold leading-tight text-fg">
                    {definition.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.58rem] font-medium leading-tight text-fg-3">
                    {definition.description}
                  </span>
                </span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={cn(
                    "hidden shrink-0 text-fg-3 lg:block",
                    expanded && "rotate-90 text-accent",
                    STUDIO_EASE,
                  )}
                />
                {normalizedLayout.locks[id].position ||
                normalizedLayout.locks[id].height ? (
                  <span
                    aria-hidden
                    className="absolute bottom-1 right-1 size-1.5 rounded-full bg-accent"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <StudioDrawingPaletteOverlayPortal
          controller={paletteOverlay}
          stackId={stackId}
          layout={normalizedLayout}
          presentation={presentation}
          subTools={subTools}
          toolProperties={toolProperties}
          onLockToggle={toggleLock}
          onPresentationChange={changePresentation}
        />
      </>
    );
  }

  return (
    <>
      <div
        ref={rootRef}
        data-studio-drawing-palette-stack="true"
        data-studio-drawing-palette-presentation="full"
        data-studio-drawing-palette-dragging={dragging ? "true" : "false"}
        className={cn(
          "flex min-w-0 flex-col gap-2",
          "lg:min-h-0 lg:flex-1 lg:gap-0 lg:overflow-hidden",
          className,
        )}
      >
      {normalizedLayout.order.map((id, index) => {
        const definition = STUDIO_DRAWING_PALETTES[id];
        const Icon = definition.Icon;
        const collapsed = mobilePrimaryPaletteId
          ? id !== mobilePrimaryPaletteId
          : paletteCollapsed(normalizedLayout.collapsed, id);
        const onlyOpenPalette = openIds.length === 1 && !collapsed;
        const previousId = normalizedLayout.order[index - 1];
        const nextId = normalizedLayout.order[index + 1];
        const moveUpDisabled =
          !previousId ||
          normalizedLayout.locks[id].position ||
          normalizedLayout.locks[previousId].position;
        const moveDownDisabled =
          !nextId ||
          normalizedLayout.locks[id].position ||
          normalizedLayout.locks[nextId].position;
        const optionsOverlay: StudioDrawingPaletteOverlay = {
          kind: "options",
          id,
        };
        const optionsOpen =
          paletteOverlay.openOverlay?.kind === "options" &&
          paletteOverlay.openOverlay.id === id;
        const contentId = `${stackId}-${id}-content`;
        const titleId = `${stackId}-${id}-title`;
        const style: PaletteSectionStyle = {
          "--studio-drawing-palette-size": `${normalizedLayout.sizes[id]}%`,
        };
        return (
          <section
            key={id}
            ref={(node) => {
              sectionRefs.current[id] = node;
            }}
            aria-labelledby={titleId}
            data-studio-drawing-palette={id}
            data-studio-drawing-palette-collapsed={collapsed ? "true" : "false"}
            data-position-locked={
              normalizedLayout.locks[id].position ? "true" : "false"
            }
            data-height-locked={
              normalizedLayout.locks[id].height ? "true" : "false"
            }
            style={style}
            className={cn(
              "flex min-w-0 flex-none flex-col rounded-xl border border-line bg-panel/70 shadow-sm",
              "lg:rounded-none lg:border-x-0 lg:border-t-0 lg:shadow-none",
              mobilePrimaryPaletteId &&
                id !== mobilePrimaryPaletteId &&
                "hidden lg:flex",
              !collapsed &&
                (onlyOpenPalette
                  ? "lg:min-h-0 lg:flex-1"
                  : "lg:min-h-0 lg:flex-[0_1_var(--studio-drawing-palette-size)]"),
              collapsed && "shrink-0",
            )}
          >
            <header
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1 border-b border-line/70 px-1.5 lg:min-h-9",
                mobilePrimaryPaletteId &&
                  "sticky top-0 z-10 bg-panel/95 backdrop-blur lg:static lg:z-auto lg:bg-transparent lg:backdrop-blur-none",
              )}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-lg text-accent"
              >
                <Icon size={15} strokeWidth={1.8} />
              </span>
              <h2
                id={titleId}
                className="min-w-0 flex-1 truncate text-[0.7rem] font-bold text-fg"
              >
                {definition.label}
              </h2>
              {mobilePrimaryPaletteId === id && mobileHeaderAction ? (
                <div className="shrink-0 lg:hidden">{mobileHeaderAction}</div>
              ) : null}
              <div
                role="group"
                aria-label={`${definition.label} 팔레트 배치`}
                className={cn(
                  "flex shrink-0 items-center gap-0.5",
                  mobilePrimaryPaletteId && "hidden lg:flex",
                )}
              >
                <button
                  type="button"
                  disabled={moveUpDisabled}
                  onClick={() =>
                    emit(moveStudioDrawingPalette(normalizedLayout, id, "up"))
                  }
                  aria-label={`${definition.label} 위로 이동`}
                  title="팔레트를 위로 이동"
                  className={cn(
                    "grid size-11 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 lg:size-8",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                  )}
                >
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={moveDownDisabled}
                  onClick={() =>
                    emit(moveStudioDrawingPalette(normalizedLayout, id, "down"))
                  }
                  aria-label={`${definition.label} 아래로 이동`}
                  title="팔레트를 아래로 이동"
                  className={cn(
                    "grid size-11 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 lg:size-8",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                  )}
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
                <button
                  ref={(node) => {
                    paletteOverlay.setTrigger(optionsOverlay, node);
                  }}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={optionsOpen}
                  aria-controls={studioDrawingPaletteOverlayId(
                    stackId,
                    optionsOverlay,
                  )}
                  onClick={(event) =>
                    paletteOverlay.toggle(optionsOverlay, event.currentTarget)
                  }
                  aria-label={`${definition.label} 팔레트 옵션`}
                  title="위치·높이 잠금 및 표시 방식"
                  className={cn(
                    "grid size-11 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg lg:size-8",
                    optionsOpen && "bg-accent-soft text-accent",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                  )}
                >
                  <MoreHorizontal size={15} aria-hidden />
                </button>
                <button
                  ref={(node) => {
                    collapseButtonRefs.current[id] = node;
                  }}
                  type="button"
                  aria-expanded={!collapsed}
                  aria-controls={contentId}
                  onClick={() =>
                    emit(toggleStudioDrawingPalette(normalizedLayout, id))
                  }
                  aria-label={`${definition.label} ${collapsed ? "펼치기" : "접기"}`}
                  title={`${definition.label} ${collapsed ? "펼치기" : "접기"}`}
                  className={cn(
                    "grid size-11 place-items-center rounded-lg text-fg-2 hover:bg-raised hover:text-fg lg:size-8",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                  )}
                >
                  {collapsed ? (
                    <ChevronRight size={15} aria-hidden />
                  ) : (
                    <ChevronDown size={15} aria-hidden />
                  )}
                </button>
              </div>
            </header>
            <div
              id={contentId}
              hidden={collapsed}
              data-studio-drawing-palette-scroll="true"
              onFocusCapture={() => {
                focusedBodyRef.current = id;
              }}
              onBlurCapture={(event) => {
                const related = event.relatedTarget;
                if (
                  related instanceof Node &&
                  event.currentTarget.contains(related)
                ) {
                  return;
                }
                if (focusedBodyRef.current === id) focusedBodyRef.current = null;
              }}
              className="min-w-0 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-gutter:stable]"
            >
              {collapsed ? null : (
                <>{paletteBody(id, subTools, toolProperties)}</>
              )}
            </div>
          </section>
        );
      }).reduce<ReactNode[]>((nodes, section, index) => {
        nodes.push(section);
        if (
          index === 0 &&
          bothOpen &&
          firstOpenId &&
          secondOpenId
        ) {
          const firstDefinition = STUDIO_DRAWING_PALETTES[firstOpenId];
          const secondDefinition = STUDIO_DRAWING_PALETTES[secondOpenId];
          const currentPercent = normalizedLayout.sizes[firstOpenId];
          const splitHeightLocked =
            normalizedLayout.locks[firstOpenId].height ||
            normalizedLayout.locks[secondOpenId].height;
          nodes.push(
            <div
              key="palette-splitter"
              role="separator"
              aria-label={`${joinKoreanLabels(firstDefinition.label, secondDefinition.label)} 크기 조절`}
              aria-orientation="horizontal"
              aria-valuemin={STUDIO_DRAWING_PALETTE_MIN_PERCENT}
              aria-valuemax={STUDIO_DRAWING_PALETTE_MAX_PERCENT}
              aria-valuenow={Math.round(currentPercent)}
              aria-valuetext={`${firstDefinition.label} ${Math.round(currentPercent)}%, ${secondDefinition.label} ${Math.round(100 - currentPercent)}%`}
              aria-keyshortcuts={
                splitHeightLocked
                  ? undefined
                  : "ArrowUp ArrowDown Home End Enter"
              }
              aria-disabled={splitHeightLocked}
              tabIndex={splitHeightLocked ? -1 : 0}
              data-studio-drawing-palette-splitter="true"
              data-dragging={dragging ? "true" : "false"}
              data-height-locked={splitHeightLocked ? "true" : "false"}
              onPointerDown={(event) =>
                splitHeightLocked
                  ? undefined
                  : handleSplitPointerDown(event, firstOpenId, secondOpenId)
              }
              onKeyDown={(event) =>
                splitHeightLocked
                  ? undefined
                  : handleSplitKeyDown(event, firstOpenId)
              }
              onDoubleClick={() => {
                if (!splitHeightLocked) resetSplit(firstOpenId);
              }}
              title={
                splitHeightLocked
                  ? "팔레트 높이 잠금을 해제하면 크기를 조절할 수 있습니다"
                  : "위·아래로 드래그 · 방향키로 조절 · Enter/더블클릭/더블탭으로 기본 비율"
              }
              className={cn(
                "group relative z-10 hidden h-2 shrink-0 touch-none cursor-row-resize select-none place-items-center border-0 bg-transparent p-0",
                "before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2 before:content-['']",
                "lg:grid",
                splitHeightLocked && "cursor-not-allowed",
                STUDIO_EASE,
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1 w-14 rounded-full border border-line bg-raised transition-[width,background-color,border-color] motion-reduce:transition-none",
                  splitHeightLocked
                    ? "border-accent/45 bg-accent-soft"
                    : dragging
                    ? "w-20 border-accent bg-accent"
                    : "group-hover:w-20 group-hover:border-accent/60 group-hover:bg-accent-soft group-focus-visible:w-20 group-focus-visible:border-accent group-focus-visible:bg-accent-soft",
                )}
              />
            </div>,
          );
        }
        return nodes;
        }, [])}
      </div>
      <StudioDrawingPaletteOverlayPortal
        controller={paletteOverlay}
        stackId={stackId}
        layout={normalizedLayout}
        presentation={presentation}
        subTools={subTools}
        toolProperties={toolProperties}
        onLockToggle={toggleLock}
        onPresentationChange={changePresentation}
      />
    </>
  );
}
