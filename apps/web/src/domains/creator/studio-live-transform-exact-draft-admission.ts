/**
 * Main-thread work admission for exact, model-backed transform frames.
 *
 * A latest-frame rAF mailbox limits frequency, not the cost of one frame. Studio documents admit
 * up to 100k stroke samples, while exact presentation currently transforms all points, resolves a
 * panel clip, replans one renderer and rasterizes it on the UI thread. Letting an unbounded stroke
 * enter that path turns a transform handle into a long task. This policy is deliberately
 * conservative and renderer-aware: a rejected frame keeps the authoritative source visible and
 * still commits once at release; it never falls back to a visually different affine preview.
 *
 * These are admission ceilings, not document limits. They leave headroom inside an 8ms CPU target
 * before React/Konva paint. The long-term lane is a worker/GPU ephemeral surface and, ultimately,
 * a durable first-class object matrix; raising these constants requires measured p95 evidence.
 */

import { studioDrawObjectTransformScale } from "./brush/studio-draw-object-transform";

import type { StudioDrawObjectTransformBounds } from "./brush/studio-draw-object-transform";

export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DABS = 2_048;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES = 2_048;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DAB_AREA = 4_000_000;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH = 512;
/** Shared UI-thread path-operation ceiling; one causal dab is the established work primitive. */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_PATH_COMMANDS =
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DABS;
/** A quadratic path command serializes at most four numeric coordinate fields. */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_SCALAR_WORK =
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_PATH_COMMANDS * 4 + 2;
/** Reuse the established 4M backing-pixel paint ceiling rather than introducing a new tuning cap. */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS =
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DAB_AREA;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES = 256;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_PERFECT_SAMPLES = 2_048;
/**
 * The angled nib emits one quadrilateral per segment and fills them in disjoint bands, so its
 * per-sample cost sits between the calligraphy ribbon's expanded outline and a plain dab field.
 * Held at the shared path-operation primitive rather than given a generous new number: at 5 path
 * commands per segment, 2,048 samples already sit an order of magnitude inside the command cap,
 * and the cap is what actually decides.
 */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES = 2_048;
/**
 * Ceiling on the SUM of every member's estimated work in one multi-selection frame.
 *
 * Per-member admission bounds one stroke, but the frame draws them all in a single main-thread
 * pass, so the sum is what the 8ms CPU target actually has to cover. Measured in Chrome on the
 * real editor (2026-09-03, MacBook, DPR 2, stage zoom 107%), timing the whole exact presentation
 * -- group replan, `flushSync` React commit, Konva scene build and the isolated `drawScene`:
 *
 *     1,689 dabs -> 4.56ms      5,376 dabs -> 3.93ms      8,010 dabs -> 8.17ms
 *
 * 8k reaches the budget, so half of it keeps the 2x headroom the per-stroke lanes are set with.
 * Deliberately its own constant rather than a second use of the path-operation ceiling: that one
 * grades ONE renderer's emission, and reusing it here made two ordinary 700px strokes -- the
 * commonest multi-selection there is -- fall back to commit-at-release.
 */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_WORK = 4_096;
/**
 * Members one multi-selection gesture may claim.
 *
 * Distinct from the frame budget above, and needed because the two bound different costs. The
 * frame budget is charged per FRAME, after every member has already been compiled; this one is
 * charged once at gesture begin, where each member costs a scene-node lookup, a cached-duplicate
 * scan and an O(samples) snapshot clone — synchronously, on the pointerdown that starts the drag.
 * Without it, Ctrl+A over a page of eight hundred strokes pays all of that before the first frame
 * can be refused, which is the long task the per-element compilation gate exists to prevent.
 *
 * 64 is above any hand-made selection — commercial editors' multi-select is a handful of objects,
 * and a whole-page select is exactly the case that should stand down — and it keeps the begin-time
 * work inside the same 8ms target the frame budget is set against.
 */
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_MEMBERS = 64;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_SAMPLES = 1_024;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_PATH_LENGTH = 4_096;
export const STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS = 2_048;

export interface StudioLiveTransformExactDraftComplexity {
  readonly rendererEngine?: string;
  readonly sampleCount: number;
  readonly pathLength: number;
  readonly strokeWidth: number;
  /** Exact causal engine radius at pressure=1 after alias diameter mapping, in document pixels. */
  readonly causalMaxDabRadius?: number;
  /** Renderer-expanded coordinate production/serialization, compiled once at gesture begin. */
  readonly rendererExpandedScalarWork?: number;
  /** Upper bound on emitted Canvas/SVG path operations, compiled from renderer structure. */
  readonly rendererPathCommandUpperBound?: number;
  /** Maximum renderer paint radius around the source centre line, in document pixels. */
  readonly rendererMaxPaintRadius?: number;
}

export type StudioLiveTransformExactDraftAdmission =
  | {
      readonly admitted: true;
      readonly lane:
        | "causal-dabs"
        | "calligraphy-ribbon"
        | "perfect-outline"
        | "angled-nib-coverage"
        | "generic";
      readonly estimatedWork: number;
      /**
       * Backing-store pixels this element's own fill can shade, at the frame's zoom and DPR.
       *
       * Returned rather than only compared, because operation COUNT and shaded AREA are
       * independent dimensions and a multi-element frame has to add up both. Sixty two-point dots
       * at a 500px width are two dabs of work each -- nothing, by count -- and ninety million
       * shaded pixels between them. The per-element ceilings below cannot see that; a caller
       * summing this can.
       */
      readonly estimatedBackingPixels: number;
    }
  | {
      readonly admitted: false;
      readonly reason: "invalid" | "scene-budget" | "renderer-budget";
      readonly estimatedWork: number;
    };

export interface StudioLiveTransformExactDraftAdmissionInput {
  readonly complexity: StudioLiveTransformExactDraftComplexity;
  readonly sourceBounds: StudioDrawObjectTransformBounds;
  readonly targetBounds: StudioDrawObjectTransformBounds;
  readonly sceneElementCount: number;
  /** Document pixel to backing-store pixel scale, including Stage zoom and canvas DPR. */
  readonly rasterScale: number;
  /** Full current Layer SceneCanvas backing store cleared by one synchronous `drawScene()`. */
  readonly sceneCanvasBackingPixels: number;
  /**
   * How the COMMIT this frame previews treats stroke width, which decides what the draft paints.
   *
   * `planStudioDrawObjectTransform` scales it with the object, so a single-stroke frame charges a
   * scaled radius. `planStudioGroupUniformResize` preserves it — a multi-selection resize moves the
   * layout without re-weighting the line art — so scaling the charge there is not conservative in
   * one direction: on a DOWNSCALE it divides the charged radius by 1/s while the drafted stroke
   * keeps its authored one, and the 512px width ceilings are defeated by shrinking the box.
   * Defaults to `scale`, the behaviour every existing caller has.
   */
  readonly strokeWidthPolicy?: "scale" | "preserve";
}

function rejected(
  reason: Extract<StudioLiveTransformExactDraftAdmission, { admitted: false }>["reason"],
  estimatedWork = Number.POSITIVE_INFINITY,
): StudioLiveTransformExactDraftAdmission {
  return { admitted: false, reason, estimatedWork };
}

/**
 * A pre-rotation target rectangle always fits inside a square whose side is its diagonal. Expanding
 * that square by the renderer's maximum radius on both sides therefore bounds every rotated fill
 * AABB without reading points in the frame loop. `rasterScale` converts the result to the actual
 * zoom×DPR backing store that Canvas must shade.
 */
function rendererBackingPixelFootprint(
  targetBounds: StudioDrawObjectTransformBounds,
  rendererRadius: number,
  rasterScale: number,
): number {
  const centerlineSide = Math.hypot(targetBounds.width, targetBounds.height);
  const backingSide = (centerlineSide + rendererRadius * 2) * rasterScale;
  return backingSide * backingSide;
}

/** O(1) frame decision over complexity facts compiled once at gesture begin. */
export function admitStudioLiveTransformExactDraft(
  input: StudioLiveTransformExactDraftAdmissionInput,
): StudioLiveTransformExactDraftAdmission {
  const {
    rendererEngine,
    sampleCount,
    pathLength,
    strokeWidth,
    causalMaxDabRadius,
    rendererExpandedScalarWork,
    rendererPathCommandUpperBound,
    rendererMaxPaintRadius,
  } = input.complexity;
  const expandedVectorRenderer = rendererEngine === "calligraphy-segments"
    || rendererEngine === "perfect-outline"
    || rendererEngine === "angled-ribbon";
  if (
    !Number.isSafeInteger(sampleCount)
    || sampleCount < 0
    || !Number.isFinite(pathLength)
    || pathLength < 0
    || !Number.isFinite(strokeWidth)
    || strokeWidth < 0
    || !Number.isSafeInteger(input.sceneElementCount)
    || input.sceneElementCount < 0
    || !Number.isFinite(input.rasterScale)
    || input.rasterScale <= 0
    || !Number.isFinite(input.sceneCanvasBackingPixels)
    || input.sceneCanvasBackingPixels < 0
    || (
      rendererEngine === "causal-ink"
      && (
        causalMaxDabRadius === undefined
        || !Number.isFinite(causalMaxDabRadius)
        || causalMaxDabRadius < 0
      )
    )
    || (
      expandedVectorRenderer
      && (
        rendererExpandedScalarWork === undefined
        || !Number.isSafeInteger(rendererExpandedScalarWork)
        || rendererExpandedScalarWork < 0
        || rendererPathCommandUpperBound === undefined
        || !Number.isSafeInteger(rendererPathCommandUpperBound)
        || rendererPathCommandUpperBound < 0
        || rendererMaxPaintRadius === undefined
        || !Number.isFinite(rendererMaxPaintRadius)
        || rendererMaxPaintRadius < 0
      )
    )
  ) {
    return rejected("invalid");
  }
  if (input.sceneElementCount > STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS) {
    return rejected("scene-budget", input.sceneElementCount);
  }
  // Every admitted retained or exact model frame ends in Layer.drawScene(). Konva's default
  // clearBeforeDraw clears the full SceneCanvas before object-local rasterization, so a tiny AABB
  // on a large Retina canvas is still a large frame. getWidth/getHeight are backing dimensions;
  // this comparison is O(1), includes DPR, and fails closed before renderer-specific work.
  if (input.sceneCanvasBackingPixels > STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS) {
    return rejected("renderer-budget", input.sceneCanvasBackingPixels);
  }
  const scale = studioDrawObjectTransformScale(input.sourceBounds, input.targetBounds);
  if (!scale) return rejected("invalid");
  const transformedPathLength = pathLength * Math.max(scale.scaleX, scale.scaleY);
  if (!Number.isFinite(transformedPathLength)) return rejected("invalid");
  const widthFactor = input.strokeWidthPolicy === "preserve" ? 1 : scale.uniformEquivalent;
  const transformedStrokeWidth = strokeWidth * widthFactor;
  if (
    !Number.isFinite(transformedStrokeWidth)
    || transformedStrokeWidth > STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH
  ) {
    return rejected("renderer-budget", transformedStrokeWidth);
  }

  if (rendererEngine === "causal-ink") {
    // Every non-empty causal segment emits AT LEAST one dab, even when it is shorter than 0.5px.
    // Summing only totalLength / 0.5 under-counts a highly subdivided path. For each segment,
    // ceil(distance / spacing) <= 1 + distance / 0.5, so samples + ceil(totalLength / 0.5) is a
    // conservative O(1) upper bound for legacy and residual planners alike.
    const upperDabs = sampleCount === 0
      ? 0
      : sampleCount + Math.ceil(transformedPathLength / 0.5);
    // Path length alone is not a bound on planner work: an imported/adversarial stroke may carry
    // 100k duplicate or sub-pixel samples while spanning almost no distance. The transform and
    // causal planner still visit every sample, so both independent dimensions must fit.
    const estimatedWork = Math.max(sampleCount, upperDabs);
    const radius = causalMaxDabRadius! * widthFactor;
    const backingRadius = radius * input.rasterScale;
    const estimatedDabArea = upperDabs * Math.PI * backingRadius * backingRadius;
    const transformedFootprintDiameter = radius * 2;
    return sampleCount <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES
      && upperDabs <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DABS
      && transformedFootprintDiameter <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH
      && estimatedDabArea <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DAB_AREA
      ? {
          admitted: true,
          lane: "causal-dabs",
          estimatedWork,
          estimatedBackingPixels: estimatedDabArea,
        }
      : rejected("renderer-budget", Math.max(estimatedWork, estimatedDabArea));
  }

  if (rendererEngine === "calligraphy-segments") {
    // Brush-width floors do not shrink below their source value, so retaining the source radius
    // for downscales is conservative; upscales still follow the transform's geometric mean. That
    // `max(1, …)` is also what keeps the estimate an upper bound under a width-PRESERVING commit,
    // where the drafted radius stays authored however far the box shrinks.
    const transformedRadius = rendererMaxPaintRadius!
      * Math.max(1, widthFactor);
    const backingPixels = rendererBackingPixelFootprint(
      input.targetBounds,
      transformedRadius,
      input.rasterScale,
    );
    const estimatedWork = Math.max(
      sampleCount,
      rendererExpandedScalarWork!,
      rendererPathCommandUpperBound!,
    );
    return sampleCount <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES
      && rendererExpandedScalarWork! <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_SCALAR_WORK
      && rendererPathCommandUpperBound!
        <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_PATH_COMMANDS
      && transformedRadius * 2 <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH
      && backingPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS
      ? {
          admitted: true,
          lane: "calligraphy-ribbon",
          estimatedWork,
          estimatedBackingPixels: backingPixels,
        }
      : rejected("renderer-budget", Math.max(estimatedWork, backingPixels));
  }

  if (rendererEngine === "perfect-outline") {
    const transformedRadius = rendererMaxPaintRadius!
      * Math.max(1, widthFactor);
    const backingPixels = rendererBackingPixelFootprint(
      input.targetBounds,
      transformedRadius,
      input.rasterScale,
    );
    const estimatedWork = Math.max(
      sampleCount,
      rendererExpandedScalarWork!,
      rendererPathCommandUpperBound!,
    );
    return sampleCount <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_PERFECT_SAMPLES
      && rendererExpandedScalarWork! <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_SCALAR_WORK
      && rendererPathCommandUpperBound!
        <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_PATH_COMMANDS
      && transformedRadius * 2 <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH
      && backingPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS
      ? {
          admitted: true,
          lane: "perfect-outline",
          estimatedWork,
          estimatedBackingPixels: backingPixels,
        }
      : rejected("renderer-budget", Math.max(estimatedWork, backingPixels));
  }

  if (rendererEngine === "angled-ribbon") {
    // The nib half-width is the whole paint radius: the ribbon is the swept quadrilateral of the
    // centre line offset by it, with no join expansion, cap or halo outside that envelope. A
    // downscale can only shrink it, so retaining the source radius there is conservative in the
    // same way the ribbon lanes above are.
    const transformedRadius = rendererMaxPaintRadius!
      * Math.max(1, widthFactor);
    const backingPixels = rendererBackingPixelFootprint(
      input.targetBounds,
      transformedRadius,
      input.rasterScale,
    );
    const estimatedWork = Math.max(
      sampleCount,
      rendererExpandedScalarWork!,
      rendererPathCommandUpperBound!,
    );
    return sampleCount <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES
      && rendererExpandedScalarWork! <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_SCALAR_WORK
      && rendererPathCommandUpperBound!
        <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_RENDERER_PATH_COMMANDS
      && transformedRadius * 2 <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_STROKE_WIDTH
      && backingPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS
      ? {
          admitted: true,
          lane: "angled-nib-coverage",
          estimatedWork,
          estimatedBackingPixels: backingPixels,
        }
      : rejected("renderer-budget", Math.max(estimatedWork, backingPixels));
  }

  // Direct adapter tests and future positively certified renderers can still use the exact seam,
  // but unknown work never receives a renderer-specific generous limit.
  const admitted = sampleCount <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_SAMPLES
    && transformedPathLength <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_PATH_LENGTH;
  const estimatedWork = Math.max(sampleCount, transformedPathLength);
  // Unknown adapters have no certified radius helper. Charge a full (not half) clamped renderer
  // width on each side, then also charge the backing-pixel path sweep. This preserves the generic
  // low-DPR seam while preventing its 1,024-sample / 4,096px caps from bypassing zoom and DPR.
  const genericPaintWidth = Math.max(1, strokeWidth, transformedStrokeWidth);
  const backingPixels = rendererBackingPixelFootprint(
    input.targetBounds,
    genericPaintWidth,
    input.rasterScale,
  );
  const backingSweepPixels = transformedPathLength
    * genericPaintWidth
    * input.rasterScale
    * input.rasterScale;
  return admitted
    && backingPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS
    && backingSweepPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS
    ? {
        admitted: true,
        lane: "generic",
        estimatedWork,
        estimatedBackingPixels: Math.max(backingPixels, backingSweepPixels),
      }
    : rejected(
        "renderer-budget",
        Math.max(estimatedWork, backingPixels, backingSweepPixels),
      );
}
