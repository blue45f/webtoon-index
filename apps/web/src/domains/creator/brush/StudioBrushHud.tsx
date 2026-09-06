import { Eraser, PenTool } from "lucide-react";
import { memo, useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import {
  planStudioBrushHudPlacement,
  stepStudioBrushHudTether,
  STUDIO_BRUSH_HUD_COARSE_GEOMETRY,
  STUDIO_BRUSH_HUD_FINE_GEOMETRY,
  STUDIO_BRUSH_HUD_TETHER_INITIAL,
  studioBrushHudExtentPx,
  studioOnCanvasSafeArea,
  type StudioBrushHudGeometry,
  type StudioBrushHudPlacement,
  type StudioBrushHudTetherState,
  type StudioPointerHandedness,
  type StudioSurfaceRect,
} from "../studio-oncanvas-command-surfaces";
import { StudioInlineScrubber } from "../StudioInlineScrubber";

import { STUDIO_BRUSH_SIZE_RANGE } from "./studio-draw-ux";

import { cn } from "@/shared/lib/utils";

/** Popovers, docks and dialogs the HUD refuses to sit under. */
const OBSTACLE_SELECTOR = [
  "[data-studio-draw-options-dock]",
  "[data-studio-tool-popover]",
  "[data-studio-point-comment-composer]",
  "[data-studio-color-wheel]",
  "[data-studio-presence-dock]",
  '[role="dialog"]',
].join(",");

const OBSTACLE_REFRESH_MS = 250;

export interface StudioBrushHudHandlers {
  onStrokeWidthChange: (next: number) => void;
  onOpacityChange: (next: number) => void;
  onOpenColorWheel: (clientX: number, clientY: number) => void;
  onToggleEraser: () => void;
}

export interface StudioBrushHudProps {
  /** Drawing tool active and the canvas is accepting ink. */
  visible: boolean;
  strokeWidth: number;
  /** 0–1. */
  brushOpacity: number;
  color: string;
  eraserActive: boolean;
  handedness: StudioPointerHandedness;
  /** The scrollable canvas host. Defines "over the canvas" and the safe area. */
  canvasHostRef: RefObject<HTMLDivElement | null>;
  stableHandlers: StudioBrushHudHandlers;
}

function viewportRect(): StudioSurfaceRect {
  const visual = globalThis.visualViewport;
  return {
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
    width: visual?.width ?? globalThis.innerWidth ?? 0,
    height: visual?.height ?? globalThis.innerHeight ?? 0,
  };
}

function domRectToSurfaceRect(rect: DOMRect): StudioSurfaceRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Cursor-tethered brush HUD — 크기 · 불투명도 · 색 · 펜/지우개 within 80px of the nib.
 *
 * The audit's headline number was that the nearest interactive control of any
 * kind sat 388px from the canvas centre, brush size 423px and opacity 555px. All
 * three of those commands now ride the cursor.
 *
 * **Not React state.** Position updates run entirely through `style.transform`
 * inside one rAF per pointer frame; the component only re-renders when a *value*
 * changes (size, opacity, colour, tool). That is the same contract
 * `studio-scroll-viewport-store` holds for panning, and the runtime commit gate
 * (`studio-hot-path-commit-budget`) is what proves it: a HUD that published the
 * cursor through `useState` would re-render the editor shell once per pointer
 * sample and blow the stroke budget.
 *
 * Occlusion avoidance has two halves. The drawing hand covers the quadrant below
 * the pen tip on its own side, so the placement order is
 * `위 → 반대손 → 같은손 → 아래` (`planStudioBrushHudPlacement`). Popups are
 * measured, not guessed: their live client rects go in as obstacles every
 * ~250ms, and a side that would be covered loses.
 */
export const StudioBrushHud = memo(function StudioBrushHud({
  visible,
  strokeWidth,
  brushOpacity,
  color,
  eraserActive,
  handedness,
  canvasHostRef,
  stableHandlers,
}: StudioBrushHudProps) {
  const hudRef = useRef<HTMLDivElement | null>(null);
  const tetherRef = useRef<StudioBrushHudTetherState>(STUDIO_BRUSH_HUD_TETHER_INITIAL);
  const placementRef = useRef<StudioBrushHudPlacement | null>(null);
  const handednessRef = useRef(handedness);
  handednessRef.current = handedness;

  useEffect(() => {
    if (!visible) return;
    const node = hudRef.current;
    const host = canvasHostRef.current;
    if (!node || !host) return;

    const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
    const geometry: StudioBrushHudGeometry = coarse
      ? STUDIO_BRUSH_HUD_COARSE_GEOMETRY
      : STUDIO_BRUSH_HUD_FINE_GEOMETRY;

    let frame = 0;
    let obstacles: readonly StudioSurfaceRect[] = [];
    let obstaclesAt = 0;
    let disposed = false;

    const refreshObstacles = () => {
      const now = performance.now();
      if (now - obstaclesAt < OBSTACLE_REFRESH_MS) return;
      obstaclesAt = now;
      const found: StudioSurfaceRect[] = [];
      for (const element of Array.from(document.querySelectorAll(OBSTACLE_SELECTOR))) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) found.push(domRectToSurfaceRect(rect));
      }
      obstacles = found;
    };

    const hide = () => {
      node.style.visibility = "hidden";
      node.style.pointerEvents = "none";
    };

    const paint = () => {
      frame = 0;
      if (disposed) return;
      const state = tetherRef.current;
      if (state.phase === "idle" || state.phase === "drawing" || state.anchor === null) {
        hide();
        return;
      }
      const anchor = state.anchor;
      const hostRect = host.getBoundingClientRect();
      if (!(hostRect.width > 0) || !(hostRect.height > 0)) {
        hide();
        return;
      }
      refreshObstacles();
      const placement = planStudioBrushHudPlacement({
        anchor,
        safeArea: studioOnCanvasSafeArea(domRectToSurfaceRect(hostRect), viewportRect()),
        handedness: handednessRef.current,
        geometry,
        obstacles,
      });
      placementRef.current = placement;
      node.style.visibility = "visible";
      node.style.pointerEvents = "auto";
      node.style.transform = `translate3d(${Math.round(placement.rect.left)}px, ${Math.round(placement.rect.top)}px, 0)`;
      node.dataset.studioBrushHudSide = placement.side;
      node.dataset.studioBrushHudWithinBudget = placement.withinBudget ? "true" : "false";
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = globalThis.requestAnimationFrame(paint);
    };

    const insideHud = (target: EventTarget | null): boolean =>
      target instanceof Node && node.contains(target);

    /**
     * Hit-test by DOM containment, not by the host's rectangle.
     *
     * On narrow layouts Studio floats panels *over* the canvas host, so a point
     * inside the host rect is often a panel. Containment answers the question
     * that actually matters — "is the pointer on the canvas?" — and costs no
     * layout read, which matters on a per-frame listener.
     */
    const overCanvas = (target: EventTarget | null): boolean =>
      target instanceof Node && host.contains(target);

    const onPointerMove = (event: PointerEvent) => {
      tetherRef.current = stepStudioBrushHudTether(tetherRef.current, {
        type: "pointer",
        point: { x: event.clientX, y: event.clientY },
        overCanvas: overCanvas(event.target),
        hudRect: placementRef.current?.rect ?? null,
      });
      schedule();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (insideHud(event.target)) return;
      tetherRef.current = stepStudioBrushHudTether(tetherRef.current, { type: "stroke-start" });
      schedule();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (insideHud(event.target)) return;
      const point = { x: event.clientX, y: event.clientY };
      tetherRef.current = stepStudioBrushHudTether(tetherRef.current, {
        type: "stroke-end",
        point: overCanvas(event.target) ? point : null,
      });
      schedule();
    };

    const onDismiss = () => {
      tetherRef.current = stepStudioBrushHudTether(tetherRef.current, { type: "dismiss" });
      placementRef.current = null;
      schedule();
    };

    const passive = { passive: true, capture: true } as const;
    globalThis.addEventListener("pointermove", onPointerMove, passive);
    globalThis.addEventListener("pointerdown", onPointerDown, passive);
    globalThis.addEventListener("pointerup", onPointerUp, passive);
    globalThis.addEventListener("pointercancel", onPointerUp, passive);
    globalThis.addEventListener("blur", onDismiss);
    globalThis.addEventListener("resize", schedule, { passive: true });
    globalThis.addEventListener("scroll", schedule, passive);

    hide();
    return () => {
      disposed = true;
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("pointermove", onPointerMove, passive);
      globalThis.removeEventListener("pointerdown", onPointerDown, passive);
      globalThis.removeEventListener("pointerup", onPointerUp, passive);
      globalThis.removeEventListener("pointercancel", onPointerUp, passive);
      globalThis.removeEventListener("blur", onDismiss);
      globalThis.removeEventListener("resize", schedule);
      globalThis.removeEventListener("scroll", schedule, passive);
      tetherRef.current = STUDIO_BRUSH_HUD_TETHER_INITIAL;
      placementRef.current = null;
    };
  }, [visible, canvasHostRef]);

  if (!visible || typeof globalThis.document === "undefined") return null;

  const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
  const geometry = coarse ? STUDIO_BRUSH_HUD_COARSE_GEOMETRY : STUDIO_BRUSH_HUD_FINE_GEOMETRY;
  const extent = studioBrushHudExtentPx(geometry);
  const opacityPercent = Math.round(brushOpacity * 100);
  const cellClass = cn(
    "flex flex-col items-center justify-center rounded-lg bg-raised/70 text-fg-2 transition-colors",
    "hover:bg-raised hover:text-fg",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cool"
  );

  return createPortal(
    <div
      ref={hudRef}
      data-studio-brush-hud="true"
      data-studio-shortcut-boundary="true"
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="브러시 HUD"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: extent,
        height: extent,
        transform: "translate3d(-9999px, -9999px, 0)",
        visibility: "hidden",
        gap: geometry.gapPx,
        gridTemplateColumns: `repeat(2, ${geometry.cellPx}px)`,
        gridTemplateRows: `repeat(2, ${geometry.cellPx}px)`,
      }}
      className="z-[48] grid rounded-xl bg-panel/95 shadow-[0_0_0_1px_oklch(0.38_0.01_66),0_10px_30px_oklch(0.06_0.02_70/0.45)] backdrop-blur-md"
    >
      <StudioInlineScrubber
        surface="brush-size"
        label="브러시 크기"
        value={strokeWidth}
        min={STUDIO_BRUSH_SIZE_RANGE.min}
        max={STUDIO_BRUSH_SIZE_RANGE.max}
        step={1}
        valueText={`${strokeWidth}px`}
        onChange={stableHandlers.onStrokeWidthChange}
        className={cn(cellClass, "gap-0 leading-none")}
      >
        <span
          aria-hidden
          className="rounded-full bg-fg-2"
          style={{
            width: Math.max(3, Math.min(14, strokeWidth / 3)),
            height: Math.max(3, Math.min(14, strokeWidth / 3)),
          }}
        />
        <span aria-hidden className="mt-0.5 text-[0.55rem] font-bold tabular-nums text-fg-3">
          {strokeWidth}
        </span>
      </StudioInlineScrubber>
      <StudioInlineScrubber
        surface="brush-opacity"
        label="브러시 불투명도"
        value={opacityPercent}
        min={5}
        max={100}
        step={1}
        valueText={`${opacityPercent}%`}
        onChange={(next) => stableHandlers.onOpacityChange(next / 100)}
        className={cn(cellClass, "gap-0 leading-none")}
      >
        <span
          aria-hidden
          className="size-3 rounded-sm bg-fg-2"
          style={{ opacity: Math.max(0.08, brushOpacity) }}
        />
        <span aria-hidden className="mt-0.5 text-[0.55rem] font-bold tabular-nums text-fg-3">
          {opacityPercent}
        </span>
      </StudioInlineScrubber>
      <button
        type="button"
        data-studio-brush-hud-cell="color"
        aria-label={`색 선택 · 현재 ${color}`}
        title="색 선택"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          stableHandlers.onOpenColorWheel(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );
        }}
        className={cellClass}
      >
        <span
          aria-hidden
          className="size-4 rounded-full shadow-[0_0_0_1px_oklch(0.97_0.01_85/0.35)]"
          style={{ backgroundColor: color }}
        />
      </button>
      <button
        type="button"
        data-studio-brush-hud-cell="eraser"
        aria-pressed={eraserActive}
        aria-label={eraserActive ? "펜으로 전환" : "지우개로 전환"}
        title={eraserActive ? "펜 (B)" : "지우개 (E)"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          stableHandlers.onToggleEraser();
        }}
        className={cn(cellClass, eraserActive && "bg-accent text-on-accent hover:bg-accent")}
      >
        {eraserActive ? <Eraser size={14} /> : <PenTool size={14} />}
      </button>
    </div>,
    document.body
  );
});
