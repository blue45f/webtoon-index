/**
 * Append-only live overlay for the stamp brush engine.
 *
 * The committed renderer can replay a whole stamp stroke with `drawStampStroke`, but doing that for
 * every growing pointer prefix clears the active layer and revisits every translucent dab. This
 * renderer retains one `StudioStampWalkerState` per active stroke and paints only source points that
 * have not been consumed yet. A full replay happens only when the viewport surface changes or a
 * settled FIFO prefix is released.
 */

import {
  beginStampWalker,
  drawStampStroke,
  stampStrokeDot,
  walkStampSegment,
  type StudioStampBrushStyle,
  type StudioStampWalkerState,
} from "../brush/studio-brush-stamp-engine";
import {
  acquireStudioLowLatencyCanvas2dContext,
  decideStudioNativeLiveSurfaceResolution,
  type StudioNativeLiveSurfaceResolutionDecision,
} from "../studio-low-latency-canvas";

import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";

interface SettledLiveStampStroke {
  readonly style: StudioStampBrushStyle;
  readonly points: readonly number[];
  readonly pressures: readonly number[];
}

function liveStampSurfaceResolution(
  surface: StudioLiveInkSurface
): StudioNativeLiveSurfaceResolutionDecision {
  return decideStudioNativeLiveSurfaceResolution({
    cssWidth: surface.width,
    cssHeight: surface.height,
    devicePixelRatio: typeof globalThis.devicePixelRatio === "number"
      ? globalThis.devicePixelRatio
      : 1,
  });
}

function normalizedPressure(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.5;
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detachedStyle(style: StudioStampBrushStyle): StudioStampBrushStyle {
  return { ...style };
}

export class StudioLiveStampOverlayRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private dpr = 1;
  private resolutionDecision: StudioNativeLiveSurfaceResolutionDecision | null = null;

  private active = false;
  private style: StudioStampBrushStyle | null = null;
  private activePoints: number[] = [];
  private activePressures: number[] = [];
  /** Number of source pairs already inspected from the caller's growing raw prefix. */
  private consumedSourcePoints = 0;
  private walker: StudioStampWalkerState | null = null;

  private settled: SettledLiveStampStroke[] = [];

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.context = canvas ? acquireStudioLowLatencyCanvas2dContext(canvas) : null;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    const previous = this.surface;
    this.surface = surface;
    const changed =
      !previous || !surface ||
      previous.left !== surface.left || previous.top !== surface.top ||
      previous.width !== surface.width || previous.height !== surface.height ||
      previous.documentScale !== surface.documentScale ||
      previous.documentWidth !== surface.documentWidth ||
      previous.flipX !== surface.flipX;
    if (!changed) return;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
  }

  get isActive(): boolean {
    return this.active;
  }

  get hasSettledStrokes(): boolean {
    return this.settled.length > 0;
  }

  get settledStrokeCount(): number {
    return this.settled.length;
  }

  /** False means the exact retained stamp renderer must own the visible draft. */
  get isNativeSurfaceReady(): boolean {
    return this.context !== null
      && this.surface !== null
      && this.resolutionDecision?.ok === true;
  }

  get surfaceResolutionDecision(): StudioNativeLiveSurfaceResolutionDecision | null {
    return this.resolutionDecision;
  }

  begin(
    inputStyle: StudioStampBrushStyle,
    xInput: number,
    yInput: number,
    pressureInput: number
  ): boolean {
    if (!this.context || !this.surface || !this.isNativeSurfaceReady) return false;
    const x = finiteCoordinate(xInput);
    const y = finiteCoordinate(yInput);
    if (x === null || y === null) return false;

    // A caller should normally close the previous stroke. Fail visibly and without leaving its
    // orphan pixels if a replacement begin arrives after a cancelled/lost pointer session.
    if (this.active) {
      this.resetActiveState();
      this.replay();
    }

    const style = detachedStyle(inputStyle);
    const pressure = normalizedPressure(pressureInput);
    const walker = beginStampWalker(x, y, pressure);
    // The first dot consumes deterministic jitter index zero. Every later segment must continue at
    // one, exactly as `drawStampStroke` does for committed replay.
    walker.stampIndex = 1;

    this.active = true;
    this.style = style;
    this.activePoints = [x, y];
    this.activePressures = [pressure];
    this.consumedSourcePoints = 1;
    this.walker = walker;
    this.drawFirstPoint(style, x, y, pressure);
    return true;
  }

  /**
   * Consumes only the unseen suffix of a growing raw accepted-point prefix.
   *
   * The caller owns sampling/stabilization. No whole-prefix smoothing or pressure resampling is
   * performed here: once a dab has been painted, a later source point cannot change it.
   */
  appendFrom(points: readonly number[], pressures: readonly number[] | undefined): void {
    const style = this.style;
    const walker = this.walker;
    if (!this.active || !style || !walker || !this.context || !this.surface) return;

    const total = Math.floor(points.length / 2);
    if (total <= this.consumedSourcePoints) return;
    const context = this.prepared();
    if (!context) return;
    try {
      for (let sourceIndex = this.consumedSourcePoints; sourceIndex < total; sourceIndex += 1) {
        const x = finiteCoordinate(points[sourceIndex * 2]);
        const y = finiteCoordinate(points[sourceIndex * 2 + 1]);
        if (x === null || y === null) continue;
        const pressure = normalizedPressure(pressures?.[sourceIndex]);
        walkStampSegment(context, style, walker, x, y, pressure);
        this.activePoints.push(x, y);
        this.activePressures.push(pressure);
      }
    } finally {
      context.restore();
    }
    // Invalid source pairs are intentionally considered consumed as well. Re-reading them on every
    // frame would not make them drawable and could duplicate later valid suffixes.
    this.consumedSourcePoints = total;
  }

  /** Moves the completed active stroke into the FIFO retained until the main-surface draw receipt. */
  end(): void {
    if (this.active && this.style && this.activePoints.length >= 2) {
      this.settled.push({
        style: this.style,
        points: this.activePoints,
        pressures: this.activePressures,
      });
    }
    this.resetActiveState();
  }

  releaseSettledPrefix(count: number): number {
    const requested = count === Number.POSITIVE_INFINITY
      ? this.settled.length
      : Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 0;
    const released = Math.min(requested, this.settled.length);
    if (released === 0) return 0;
    this.settled = this.settled.slice(released);
    this.replay();
    return released;
  }

  clearSettled(): number {
    return this.releaseSettledPrefix(this.settled.length);
  }

  /** Cancels only the active stroke and atomically restores retained settled strokes. */
  resetActive(): boolean {
    if (!this.active) return false;
    this.resetActiveState();
    this.replay();
    return true;
  }

  clear(): void {
    this.resetActiveState();
    this.settled = [];
    this.clearRect();
  }

  private resetActiveState(): void {
    this.active = false;
    this.style = null;
    this.activePoints = [];
    this.activePressures = [];
    this.consumedSourcePoints = 0;
    this.walker = null;
  }

  private drawFirstPoint(
    style: StudioStampBrushStyle,
    x: number,
    y: number,
    pressure: number
  ): void {
    const context = this.prepared();
    if (!context) return;
    try {
      stampStrokeDot(context, style, x, y, pressure);
    } finally {
      context.restore();
    }
  }

  private drawStroke(stroke: SettledLiveStampStroke): void {
    if (stroke.points.length < 2) return;
    const context = this.prepared();
    if (!context) return;
    try {
      drawStampStroke(context, stroke.style, stroke.points, stroke.pressures);
    } finally {
      context.restore();
    }
  }

  /** Full replay is deliberately limited to viewport/surface/FIFO lifecycle changes. */
  private replay(): void {
    this.clearRect();
    for (const stroke of this.settled) this.drawStroke(stroke);
    if (!this.active || !this.style || this.activePoints.length < 2) return;
    this.drawStroke({
      style: this.style,
      points: this.activePoints,
      pressures: this.activePressures,
    });
  }

  /** save + document-to-backing transform. The caller must restore the returned context. */
  private prepared(): CanvasRenderingContext2D | null {
    const context = this.context;
    const surface = this.surface;
    if (!context || !surface || !this.isNativeSurfaceReady) return null;
    const k = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -k,
        0,
        0,
        k,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr
      );
    } else {
      context.setTransform(k, 0, 0, k, -surface.left * this.dpr, -surface.top * this.dpr);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalCompositeOperation = "source-over";
    return context;
  }

  private applySurface(): void {
    const canvas = this.canvas;
    const surface = this.surface;
    if (!canvas || !surface) {
      this.resolutionDecision = null;
      return;
    }
    const decision = liveStampSurfaceResolution(surface);
    this.resolutionDecision = decision;
    if (!decision.ok) {
      this.dpr = 1;
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
      this.resetActiveState();
      return;
    }
    this.dpr = decision.devicePixelRatio;
    if (canvas.width !== decision.backingWidth) canvas.width = decision.backingWidth;
    if (canvas.height !== decision.backingHeight) canvas.height = decision.backingHeight;
  }

  private clearRect(): void {
    const context = this.context;
    const canvas = this.canvas;
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }
}
