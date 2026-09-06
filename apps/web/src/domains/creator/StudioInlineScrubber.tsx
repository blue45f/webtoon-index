import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * A one-target numeric control: drag across it to scrub, arrow keys to step.
 *
 * On-canvas surfaces cannot afford a track-and-thumb slider — a 160px track blows
 * the V5 §15 pointer-distance budgets (브러시 HUD 80px, 레이어 행 동작 120px) on its
 * own. A scrubber puts the whole range inside one 34–40px target, so the control
 * is reachable and the value is still adjustable in a single gesture.
 *
 * It is a real `role="slider"`: `aria-valuenow`/`aria-valuetext` are published and
 * every keyboard interaction a native range input supports works here, so the
 * WCAG gate does not regress relative to the docked sliders it stands in for.
 */
export interface StudioInlineScrubberProps {
  /** Accessible name. Rendered as `aria-label`, never visually. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Human-readable current value ("18px", "80%"). */
  valueText: string;
  /** Fires on every value change. With `onCommit` present this is the preview channel. */
  onChange: (next: number) => void;
  /**
   * Fires once when a gesture ends — pointer release/cancel, keyboard idle, or blur —
   * with the last previewed value.
   *
   * A host whose `onChange` pushes a document history entry records one undo step per
   * 1% otherwise: a single 100→87 drag measured at 13 undos to revert. Such hosts pass a
   * local preview setter as `onChange` and the real mutation here, so one gesture is one
   * undo step while `aria-valuenow` still tracks every intermediate value.
   */
  onCommit?: (next: number) => void;
  /**
   * Idle after the last arrow/page/home/end key that ends a *keyboard* gesture.
   * Pointer gestures have an unambiguous end (pointerup); a key run does not, so a short
   * idle is what "the user stopped adjusting" means here. Blur commits immediately.
   */
  keyboardIdleMs?: number;
  disabled?: boolean;
  className?: string;
  /** CSS px of pointer travel per `step`. */
  pixelsPerStep?: number;
  title?: string;
  children?: ReactNode;
  /** Extra DOM hook the distance gate queries. */
  surface?: string;
  /** Marks this as a layer-row inline action for the pointer-distance gate. */
  rowAction?: string;
  /**
   * `-1` inside composite widgets that own a roving tab stop (the layer tree
   * gives its rows the tab stop and keeps row controls pointer-first).
   */
  tabIndex?: 0 | -1;
}

const DEFAULT_PIXELS_PER_STEP = 3;
const DEFAULT_KEYBOARD_IDLE_MS = 400;

function quantize(value: number, min: number, max: number, step: number): number {
  if (!(step > 0)) return Math.min(max, Math.max(min, value));
  const steps = Math.round((value - min) / step);
  const snapped = min + steps * step;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}

export function StudioInlineScrubber({
  label,
  value,
  min,
  max,
  step,
  valueText,
  onChange,
  onCommit,
  keyboardIdleMs = DEFAULT_KEYBOARD_IDLE_MS,
  disabled = false,
  className,
  pixelsPerStep = DEFAULT_PIXELS_PER_STEP,
  title,
  children,
  surface,
  rowAction,
  tabIndex = 0,
}: StudioInlineScrubberProps) {
  const dragRef = useRef<{ pointerId: number; originX: number; originValue: number } | null>(null);
  // Last previewed value that still owes `onCommit` a call. Null means the gesture is settled,
  // so a trailing blur after a pointerup can never commit the same edit twice.
  const pendingRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimer = () => {
    if (idleTimerRef.current === null) return;
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  const flushGesture = () => {
    clearIdleTimer();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onCommit?.(pending);
  };

  // A pending timer must not outlive the row (filter/page switches unmount rows mid-gesture).
  // The un-flushed preview is simply dropped — committing from teardown would write a value the
  // user can no longer see.
  useEffect(() => clearIdleTimer, []);

  const commit = (next: number) => {
    const quantized = quantize(next, min, max, step);
    if (quantized === value) return;
    if (onCommit) pendingRef.current = quantized;
    onChange(quantized);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    // The canvas owns `pointerdown` for strokes and the layer row owns it for
    // selection. Both must stay out of a scrub.
    event.preventDefault();
    event.stopPropagation();
    // A keyboard run that has not idled out yet folds into this drag — still one commit.
    clearIdleTimer();
    dragRef.current = { pointerId: event.pointerId, originX: event.clientX, originValue: value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const travelled = event.clientX - drag.originX;
    commit(drag.originValue + (travelled / Math.max(1, pixelsPerStep)) * step);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    flushGesture();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const coarse = step * 10;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + step;
    else if (event.key === "PageDown") next = value - coarse;
    else if (event.key === "PageUp") next = value + coarse;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(next);
    if (!onCommit) return;
    // Held arrows auto-repeat; every repeat restarts the idle window so the whole run is one edit.
    clearIdleTimer();
    idleTimerRef.current = setTimeout(flushGesture, Math.max(0, keyboardIdleMs));
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : tabIndex}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      aria-orientation="horizontal"
      data-layer-row-control
      data-studio-inline-scrubber={surface ?? label}
      data-studio-layer-row-action={rowAction}
      title={title ?? `${label} · 드래그하거나 방향키로 조절`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onBlur={flushGesture}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        "select-none touch-none",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-ew-resize",
        className
      )}
    >
      {children}
    </div>
  );
}
