/**
 * Adaptive viewport clipping for the Konva Stage.
 *
 * The editor lays the Stage out as `document × effectiveScale`. At high magnification that is a
 * multi-megapixel backing store *per Konva Layer*, and every time it is reallocated the main thread
 * stops: `docs/perf/canvas-findings.md` §B measured a 6.9s zoom-settle freeze at 500%, and §B-4
 * measured the same cost re-billed to the next pan as a single 3.2s stall.
 *
 * Sizing the Stage to the visible viewport removes that allocation (-97% backing store), but it is
 * not free: the scene has to be redrawn on every scroll frame, which turns a pan that was riding on
 * already-rasterized pixels into a steady ~15-30fps redraw. At the magnifications artists actually
 * work at, that trade is a *loss*.
 *
 * So the clip is adaptive, and the threshold is measured rather than guessed.
 *
 * ## Measurement (`tests/benchmarks/harness/viewport-clip-threshold-sweep.ts`)
 *
 * Apple M2 Max, 12 cores, macOS darwin/arm64, headless Chromium (Playwright), 1440×1100 viewport,
 * DPR 1, production `dist/` served by `vite preview`, 924×1386 document, 12 seeded strokes,
 * 40-move hand-tool pan at each stop. Raw data:
 * `tests/benchmarks/results/viewport-clip-threshold-sweep.json` (2026-08-08).
 *
 * | zoom | Stage box (Mpx/canvas) | document-sized p95 / worst / dropped | clipped p95 / worst / dropped |
 * | ---- | ---------------------- | ------------------------------------ | ----------------------------- |
 * | 100% |  1.28 |   16.67 /   83.3 /   8 | 66.66 / 66.67 /  66 |
 * | 120% |  1.84 |  116.66 /  133.3 /  19 | 66.67 / 66.67 /  93 |
 * | 143% |  2.63 |  233.32 /  233.3 /  39 | 66.67 / 66.67 / 120 |
 * | 172% |  3.77 |   16.67 /  383.3 /  43 | 66.67 / 66.67 / 123 |
 * | 205% |  5.41 |  449.98 /  466.7 /  79 | 66.67 / 66.67 / 123 |
 * | 246% |  7.75 |  716.64 /  716.7 / 126 | 66.67 / 66.67 / 123 |
 * | 294% | 11.10 | 1049.96 / 1050.0 / 186 | 66.67 / 66.67 / 123 |
 * | 353% | 15.92 | 1566.60 / 1583.3 / 281 | 66.67 / 66.67 / 120 |
 * | 500% | 32.02 |   16.67 / 3216.5 / 192 | 66.67 / 66.67 / 120 |
 *
 * Read it as two competing failure modes. The document-sized Stage keeps a 60fps p50 and pays for
 * it in one long stall whose length grows with the Stage area. The clipped Stage never stalls but
 * drops frames uniformly.
 *
 * ## Where the threshold actually sits
 *
 * The table above is the *prototype's* clip — the bare visible box, 0.93 Mpx. The shipped clip
 * carries the overscan documented below, so it costs more per frame and the crossover moves. The
 * same harness re-run in `CLIP_SWEEP_MODE=product` against the built change
 * (`tests/benchmarks/results/viewport-clip-product-after.json`, 2026-08-08) measures the shipped
 * clip at a flat **p95 83.3 / worst 83-100ms, 161-166 dropped** for a 40-move pan, at every
 * magnification where it is armed. Against the document-sized column that gives:
 *
 * | zoom | document-sized worst / dropped | shipped clip worst / dropped | pan verdict       |
 * | ---- | ------------------------------ | ---------------------------- | ----------------- |
 * | 205% |   466.7 /  79                  |  83.3 / 160                  | document-sized    |
 * | 246% |   716.7 / 126                  |  83.3 / 160                  | mixed             |
 * | 294% |  1050.0 / 186                  |  83.3 / 160                  | clip, on both     |
 * | 500% |  3216.5 / 192                  |  83.3 / 160                  | clip, on both     |
 *
 * ## Why the threshold is set at 246% and not at 294%
 *
 * On the pan axis alone the first unambiguous win is 294%. But pan is not the only gesture that
 * pays for a document-sized Stage — the *zoom settle* pays first and pays worse, because reaching a
 * magnification reallocates on the way. Measured with `canvas-interaction-perf.ts`
 * (`CANVAS_PERF_SCENARIOS=zoom`), a wheel zoom from the fit view freezes the settle window for:
 *
 * | wheel dose      | CPU 1x  | CPU 4x   |
 * | --------------- | ------- | -------- |
 * | 5 notches (246%)| 1,850ms | 7,166ms  |
 * | 20 notches (500%)| 6,883ms | 28,549ms |
 *
 * A 1.9s (7.2s throttled) hard freeze at 246% is a categorically worse failure than the ~30 extra
 * dropped frames a clipped 40-move pan costs there, so the threshold is set to cover it. Below
 * ~240% nothing changes: the Stage is laid out exactly as it shipped before, which is what keeps
 * the 100-200% band the artist actually works in bit-for-bit unchanged.
 */

/** Arm the clip above this many backing-store pixels per scene canvas (device pixels). */
export const STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS = 7_500_000;

/**
 * Release the clip below this many backing-store pixels per scene canvas (device pixels).
 *
 * Release sits just below 5.41 Mpx (205%) — for the sweep's document and viewport that is a ~198%
 * release against a ~242% arm, so zooming back down hands the artist a document-sized Stage again
 * before entering the 100-200% band that must stay untouched.
 *
 * The dead band is deliberately wider than one wheel notch: a notch multiplies the zoom by ~1.2,
 * so it multiplies the Stage *area* by 1.44, while arm/release differ by 1.5×. One notch therefore
 * can never cross both thresholds, and the state cannot oscillate as the artist rocks the wheel
 * back and forth at the boundary. A continuously varying input — dragging a panel divider changes
 * the fit scale smoothly — has to move the area by more than 50% before the decision flips back.
 */
export const STUDIO_STAGE_VIEWPORT_CLIP_RELEASE_PIXELS = 5_000_000;

/**
 * Extra CSS pixels drawn beyond each edge of the visible viewport.
 *
 * Two jobs. (1) Scrolling is composited: the canvas moves with the scrolled content before the
 * scroll listener can reposition and redraw it, so with no margin the leading edge would expose an
 * unpainted strip on every frame the redraw misses. (2) The wheel-zoom CSS preview
 * (`StudioPage.tsx`, `activeHost.style.transform`) scales the Stage together with the zoom host for
 * up to 170ms before committing; a zoom-*out* preview reveals more document than the clip covers,
 * and the margin absorbs the leading edge of it.
 *
 * The size is a measured compromise, not a guess. Redraw cost is linear in clip area: on the sweep
 * host a 128px margin made the window 1216×1344 (1.63 Mpx) and the pan p50 collapsed to 100ms with
 * 220 dropped frames, while 64px makes it 1088×1216 (1.32 Mpx) and the pan holds an 83.3ms worst
 * frame with ~160 dropped. (Raw data for the 64px reading is
 * `tests/benchmarks/results/viewport-clip-product-overscan64.json`; the 128px reading was a
 * discarded intermediate whose result file later runs overwrote, so it survives only as this note.)
 * The margin is worth about a third of a viewport, no more.
 */
export const STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX = 64;

/**
 * Clip-box dimensions are rounded up to this grid.
 *
 * Changing the Stage *size* reallocates every scene canvas; changing its *position* does not. Panel
 * animations and scrollbar appearance move the viewport box by a few pixels at a time, and without
 * quantization each of those frames would pay a reallocation.
 */
export const STUDIO_STAGE_VIEWPORT_CLIP_QUANTUM_PX = 64;

export interface StudioStageBackingPixelsInput {
  /** Unscaled document width. */
  readonly documentWidth: number;
  /** Unscaled document height. */
  readonly documentHeight: number;
  /** `fit scale * user zoom`. */
  readonly scale: number;
  /** Canvas backing-store pixels per CSS pixel. Konva multiplies the Stage box by this. */
  readonly devicePixelRatio?: number;
}

/** Live scroll viewport of the canvas host, in the scaled document's CSS pixel space. */
export interface StudioStageViewportClipViewport {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

/** The window of the on-screen document box the Stage actually rasterizes. */
export interface StudioStageViewportClipBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Backing-store pixels one Konva scene canvas holds for this view.
 *
 * Rotation is irrelevant — a quarter turn transposes the box without changing its area — so this is
 * the same number whichever way the artist has turned the page.
 */
export function studioStageBackingPixels(input: StudioStageBackingPixelsInput): number {
  const documentWidth = finitePositive(input.documentWidth, 0);
  const documentHeight = finitePositive(input.documentHeight, 0);
  const scale = finitePositive(input.scale, 0);
  const devicePixelRatio = finitePositive(input.devicePixelRatio, 1);
  return documentWidth * documentHeight * scale * scale * devicePixelRatio * devicePixelRatio;
}

/**
 * Schmitt trigger over the Stage's backing-store size.
 *
 * `previousArmed` is the last committed decision. Arming happens on the *same* render that crosses
 * the threshold — deferring it to an effect would render one document-sized frame first, which is
 * precisely the multi-megapixel allocation the clip exists to avoid.
 */
export function resolveStudioStageViewportClipArmed(
  backingPixels: number,
  previousArmed: boolean
): boolean {
  if (!Number.isFinite(backingPixels)) return false;
  if (backingPixels > STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS) return true;
  if (backingPixels < STUDIO_STAGE_VIEWPORT_CLIP_RELEASE_PIXELS) return false;
  return previousArmed;
}

function quantizeUp(value: number): number {
  const quantum = STUDIO_STAGE_VIEWPORT_CLIP_QUANTUM_PX;
  return Math.ceil(value / quantum) * quantum;
}

/**
 * Size of the clip window along one axis. Independent of the scroll offset by construction, so
 * panning never reallocates the backing store — only {@link positionStudioStageViewportClip} moves.
 */
function clipExtent(stageExtent: number, viewportExtent: number): number {
  const desired = quantizeUp(viewportExtent + 2 * STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX);
  return Math.min(stageExtent, desired);
}

/**
 * Where the clip window sits inside the on-screen document box for a given scroll offset.
 *
 * The overscan is centred on the viewport, then clamped so the window never leaves the document
 * box. Clamping is what makes a smaller-than-viewport document (which scrolls to 0 and may be
 * centred by layout) fall out correctly without the planner needing to know the host's offset
 * inside the scroll content.
 */
export function positionStudioStageViewportClip(
  box: {
    readonly stageWidth: number;
    readonly stageHeight: number;
    readonly width: number;
    readonly height: number;
  },
  scrollLeft: number,
  scrollTop: number
): { readonly left: number; readonly top: number } {
  const overscan = STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX;
  return {
    left: clamp(finiteOrZero(scrollLeft) - overscan, 0, Math.max(0, box.stageWidth - box.width)),
    top: clamp(finiteOrZero(scrollTop) - overscan, 0, Math.max(0, box.stageHeight - box.height)),
  };
}

/**
 * Plan the clip window for an on-screen document box, or `null` when clipping would not shrink it.
 *
 * Returning `null` rather than a full-size box matters: it keeps the Stage in exactly the layout it
 * ships today (in flow, no transform, no per-frame redraw) whenever the clip would buy nothing.
 */
export function planStudioStageViewportClipBox(
  stageWidth: number,
  stageHeight: number,
  viewport: StudioStageViewportClipViewport | null | undefined
): StudioStageViewportClipBox | null {
  if (!viewport) return null;
  const boxWidth = finitePositive(stageWidth, 0);
  const boxHeight = finitePositive(stageHeight, 0);
  const viewportWidth = finitePositive(viewport.viewportWidth, 0);
  const viewportHeight = finitePositive(viewport.viewportHeight, 0);
  if (boxWidth <= 0 || boxHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;

  const width = clipExtent(boxWidth, viewportWidth);
  const height = clipExtent(boxHeight, viewportHeight);
  if (width >= boxWidth && height >= boxHeight) return null;

  const { left, top } = positionStudioStageViewportClip(
    { stageWidth: boxWidth, stageHeight: boxHeight, width, height },
    viewport.scrollLeft,
    viewport.scrollTop
  );
  return { left, top, width, height };
}

/**
 * Everything the per-scroll-frame updater needs, captured once per React commit.
 *
 * `baseX`/`baseY` are the *unclipped* Stage translation — the position the document origin would
 * have if the Stage still covered the whole document. The clip offset is subtracted from it, and
 * the same offset is added to the Stage container's CSS transform, so the document origin lands on
 * exactly the same screen pixel as before. That cancellation is why pointer mapping is unaffected.
 */
export interface StudioStageViewportClipRuntime {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly width: number;
  readonly height: number;
  readonly baseX: number;
  readonly baseY: number;
  /** Last applied offset, so a scroll frame that did not move the window skips the redraw. */
  appliedLeft: number;
  appliedTop: number;
}

/**
 * Structural view of the Konva Stage this module drives, declared here so the geometry can be
 * tested without a DOM or a real canvas.
 */
export interface StudioStageViewportClipSurface {
  position(point: { x: number; y: number }): unknown;
  batchDraw(): unknown;
  container(): { style: { transform: string } } | null | undefined;
}

/**
 * Move the clipped Stage to a scroll offset. Returns true when the window actually moved.
 *
 * The container transform and the Stage translation must be written together: they are equal and
 * opposite, and a frame that applied only one of them would put the artwork a scroll-delta away
 * from where pointer mapping expects it.
 */
export function applyStudioStageViewportClip(
  stage: StudioStageViewportClipSurface,
  runtime: StudioStageViewportClipRuntime,
  scrollLeft: number,
  scrollTop: number
): boolean {
  const { left, top } = positionStudioStageViewportClip(runtime, scrollLeft, scrollTop);
  if (left === runtime.appliedLeft && top === runtime.appliedTop) return false;
  runtime.appliedLeft = left;
  runtime.appliedTop = top;
  const container = stage.container();
  if (container) container.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  stage.position({ x: runtime.baseX - left, y: runtime.baseY - top });
  stage.batchDraw();
  return true;
}
