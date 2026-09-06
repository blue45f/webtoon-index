/**
 * Konva's renderer adapter for a single DrawEl live transform gesture.
 *
 * This is the only module that owns scene-node lookup, cached-node eligibility, selection-chrome
 * parking, temporary Layer lift, panel-clip ownership and wrapper attr cleanup. React callers pass
 * the selected element and the document snapshot; brush/render-route facts are compiled here once
 * at gesture begin and never leak through UI props.
 */
import { flushSync } from "react-dom";

import {
  planStudioDrawObjectTransformWithBounds,
  studioDrawHasEffectivePerSampleOrientation,
} from "./brush/studio-draw-object-transform";
import { studioKonvaRuntime } from "./render/studio-konva-runtime";
import { studioLiveTransformCommittedClip } from "./studio-live-transform-clip-tracking";
import {
  applyStudioLiveTransformClip,
  findStudioLiveTransformClipHost,
  readStudioLiveTransformClip,
  restoreStudioLiveTransformClip,
} from "./studio-live-transform-clip-tracking-konva";
import {
  admitStudioLiveTransformDrawCompilation,
  compileStudioLiveTransformDrawSnapshot,
} from "./studio-live-transform-draw-compiler";
import { admitStudioLiveTransformExactDraft } from "./studio-live-transform-exact-draft-admission";
import {
  applyStudioLiveTransformPreviewNodeAttrs,
  resetStudioLiveTransformPreviewNodeAttrs,
  studioLiveTransformPreviewEligible,
  studioLiveTransformPreviewHasCachedDuplicate,
} from "./studio-live-transform-preview-konva";
import { createStudioLiveTransformPreviewSession } from "./studio-live-transform-preview-session";
import {
  STUDIO_DRAW_SELECTION_INDICATOR_NAME,
  STUDIO_GROUP_SELECTION_OVERLAY_NAME,
  drainStudioLateParkedChrome,
  STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR,
  findStudioDrawWrapperNode,
} from "./studio-selection-chrome-mirror";
import {
  beginStudioSingleDrawTransformChromeLayer,
  beginStudioSingleDrawTransformSourceLayer,
  restoreStudioSingleObjectDragLayer,
  studioSingleObjectDragLayerRecoveryPendingForElement,
} from "./studio-single-object-drag-layer";

import type { DrawEl, El } from "./studio-element-model";
import type { StudioGroupUniformResizeBounds } from "./studio-group-uniform-resize";
import type {
  StudioLiveCanvasGestureTransientAdapter,
  StudioLiveSelectionTransformFrame,
} from "./studio-live-canvas-gesture";
import type { StudioLiveTransformClipRect } from "./studio-live-transform-clip-tracking";
import type { StudioLiveTransformClipHost } from "./studio-live-transform-clip-tracking-konva";
import type {
  StudioLiveTransformDraftClaim,
  StudioLiveTransformDraftStore,
} from "./studio-live-transform-draft-store";
import type { StudioLiveTransformPreviewScheduler } from "./studio-live-transform-preview-session";
import type { StudioSingleObjectDragLayerSession } from "./studio-single-object-drag-layer";
import type Konva from "konva";

const STUDIO_KONVA_TRANSFORM_RECOVERY_INITIAL_DELAY_MS = 16;
const STUDIO_KONVA_TRANSFORM_RECOVERY_MAX_DELAY_MS = 1_000;
interface StudioKonvaTransformCleanupRecovery {
  readonly elementId: string;
  readonly recover: () => boolean;
}

const pendingStudioKonvaTransformRecoveries = new Set<StudioKonvaTransformCleanupRecovery>();
let studioKonvaTransformRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let studioKonvaTransformRecoveryDelayMs = STUDIO_KONVA_TRANSFORM_RECOVERY_INITIAL_DELAY_MS;

function requestStudioKonvaTransformRecoveryPass(): void {
  if (studioKonvaTransformRecoveryTimer !== null || pendingStudioKonvaTransformRecoveries.size === 0) {
    return;
  }
  try {
    studioKonvaTransformRecoveryTimer = globalThis.setTimeout(() => {
      studioKonvaTransformRecoveryTimer = null;
      for (const recovery of [...pendingStudioKonvaTransformRecoveries]) {
        if (recovery.recover()) pendingStudioKonvaTransformRecoveries.delete(recovery);
      }
      if (pendingStudioKonvaTransformRecoveries.size === 0) {
        studioKonvaTransformRecoveryDelayMs = STUDIO_KONVA_TRANSFORM_RECOVERY_INITIAL_DELAY_MS;
        return;
      }
      studioKonvaTransformRecoveryDelayMs = Math.min(
        STUDIO_KONVA_TRANSFORM_RECOVERY_MAX_DELAY_MS,
        studioKonvaTransformRecoveryDelayMs * 2,
      );
      requestStudioKonvaTransformRecoveryPass();
    }, studioKonvaTransformRecoveryDelayMs);
    (studioKonvaTransformRecoveryTimer as unknown as { unref?: () => void }).unref?.();
  } catch {
    studioKonvaTransformRecoveryTimer = null;
  }
}

/** Retain setup-time cleanup after construction failed before an adapter could reach its caller. */
function retainStudioKonvaTransformCleanupRecovery(
  elementId: string,
  cleanup: () => void,
): void {
  const recovery: StudioKonvaTransformCleanupRecovery = {
    elementId,
    recover: () => {
      try {
        cleanup();
        return true;
      } catch {
        return false;
      }
    },
  };
  pendingStudioKonvaTransformRecoveries.add(recovery);
  requestStudioKonvaTransformRecoveryPass();
}

/**
 * Setup can fail before the common gesture lifecycle receives an adapter token. In that case its
 * page lease is released, so both transform anchors and the draw body need this renderer-owned
 * element lease until every critical cleanup phase acknowledges recovery.
 */
export function studioKonvaDrawTransformRecoveryPendingForElement(
  elementId: string,
): boolean {
  return studioSingleObjectDragLayerRecoveryPendingForElement(elementId)
    || [...pendingStudioKonvaTransformRecoveries].some(
      (recovery) => recovery.elementId === elementId,
    );
}

export interface StudioKonvaDrawTransformPreviewSpec {
  /** Page/master identity; a draft may never survive into another document surface. */
  readonly scope: string;
  readonly element: DrawEl;
  /** Gesture-start scene snapshot used by the commit-equivalent panel-membership calculation. */
  readonly elements: readonly El[];
  /** Dedicated, otherwise-empty Layer used to isolate per-frame raster invalidation. */
  readonly dragLayer: Konva.Layer | null;
  /** Exact model-draft surface for non-uniform and route-changing frames. */
  readonly draftStore?: StudioLiveTransformDraftStore;
  /** Test/host injection; production defaults to the browser animation-frame scheduler. */
  readonly scheduler?: StudioLiveTransformPreviewScheduler;
  /**
   * React exact drafts must commit before source visibility changes, so one browser paint never
   * observes both authorities (or neither). Renderer replacements can provide their own barrier.
   */
  readonly flushDraftPublication?: (publish: () => void) => void;
}

export interface BeginStudioKonvaDrawTransformGestureOptions {
  readonly preview: StudioKonvaDrawTransformPreviewSpec;
  readonly sourceBounds: StudioGroupUniformResizeBounds;
  readonly stage: Konva.Stage;
  readonly proxy: Konva.Rect;
  readonly transformer: Konva.Transformer;
  /** Diagnostics only. A diagnostic failure is contained by the preview scheduler. */
  readonly onError?: (error: unknown) => void;
  /** A partial renderer write could not be neutralized; the outer gesture must cancel. */
  readonly onFatalError?: (error: unknown) => void;
}

function browserFrameScheduler(): StudioLiveTransformPreviewScheduler {
  return {
    requestFrame: (callback) => {
      if (typeof globalThis.requestAnimationFrame !== "function") {
        throw new Error("requestAnimationFrame is unavailable");
      }
      return globalThis.requestAnimationFrame(callback);
    },
    cancelFrame: (handle) => {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(handle);
      }
    },
  };
}

/** Refuses a second transform writer while the stroke wrapper is already under a drag pointer. */
/**
 * @param wrapper the caller's already-resolved wrapper, when it has one. `findStudioDrawWrapperNode`
 *   is a full `stage.find` traversal, and a multi-selection asks this per member right after
 *   resolving each wrapper itself — repeating the walk there triples the begin-time scene cost.
 */
export function studioKonvaDrawTransformIsBusy(
  stage: Konva.Stage,
  elementId: string,
  wrapper?: Konva.Node | null,
): boolean {
  return studioKonvaDrawTransformRecoveryPendingForElement(elementId)
    || (wrapper ?? findStudioDrawWrapperNode(stage, elementId))?.isDragging() === true;
}

interface StudioLiveTransformRasterMetrics {
  readonly rasterScale: number;
  readonly sceneCanvasBackingPixels: number;
}

/** O(1) raster facts for the candidate authority Layer, refreshed because viewport DPR can change. */
function studioLiveTransformRasterMetrics(
  stage: Konva.Stage,
  layer: Konva.Layer | null,
): StudioLiveTransformRasterMetrics {
  const stageScale = Math.max(Math.abs(stage.scaleX()), Math.abs(stage.scaleY()));
  const sceneCanvas = layer?.getCanvas();
  const nativeSceneCanvas = layer?.getNativeCanvasElement();
  const pixelRatio = sceneCanvas?.getPixelRatio() ?? studioKonvaRuntime.pixelRatio;
  return {
    rasterScale: stageScale * pixelRatio,
    // Charge the browser's actual backing allocation directly. Konva 10.3 also exposes these
    // physical dimensions through Canvas.getWidth/getHeight, but the native element avoids
    // mistaking that API for CSS/logical dimensions and accidentally dropping the DPR² cost.
    // Missing ownership becomes NaN and is rejected by the pure admission gate.
    sceneCanvasBackingPixels: nativeSceneCanvas
      ? nativeSceneCanvas.width * nativeSceneCanvas.height
      : Number.NaN,
  };
}

/**
 * Claims one eligible stroke and returns the common transient adapter, or `null` for an honest
 * commit-at-release fallback (missing/cached/duplicate/symmetry-blocked renderer node).
 */
export function beginStudioKonvaDrawTransformGesture(
  options: BeginStudioKonvaDrawTransformGestureOptions,
): StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame> | null {
  const { element, elements, dragLayer } = options.preview;
  const node = findStudioDrawWrapperNode(options.stage, element.id);
  if (
    !node
    || !studioLiveTransformPreviewEligible(node)
    || studioLiveTransformPreviewHasCachedDuplicate(options.stage, element.id, node)
  ) {
    return null;
  }
  // Reject unbounded source payloads before the compiler clones or traverses any sample array.
  // The orientation predicate is intentionally after this gate: it scans at most 256 calligraphy
  // samples here, never every calligraphy stroke during an unrelated Stage React render.
  if (
    !admitStudioLiveTransformDrawCompilation(element, elements.length).admitted
    || studioDrawHasEffectivePerSampleOrientation(element)
  ) {
    return null;
  }
  const snapshot = compileStudioLiveTransformDrawSnapshot(element);

  let parkedIndicators: Konva.Node[] = [];
  let chromeLift: StudioSingleObjectDragLayerSession | null = null;
  let sourceLift: StudioSingleObjectDragLayerSession | null = null;
  let sourceIsolationUnavailable = false;
  let clipHost: StudioLiveTransformClipHost | null = null;
  let originalClip: StudioLiveTransformClipRect | null = null;
  let previewSession: ReturnType<typeof createStudioLiveTransformPreviewSession> | null = null;
  let draftClaim: StudioLiveTransformDraftClaim | null = null;
  let terminalDraft: DrawEl | null = null;
  let handoffRegistered = false;
  let handoffReleaseRequested = false;
  let handoffSourceRestored = false;
  // Refreshed after claiming the exact-draft store. A claim may synchronously supersede a prior
  // terminal handoff, whose release callback restores this same authoritative wrapper.
  let sourceVisible = node.visible();
  let sourceHiddenForDraft = false;
  let closeState: "open" | "closing" | "closed" = "open";
  let closeOutcome: Parameters<
    StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame>["close"]
  >[0] | null = null;
  let terminalFramePrepared = false;

  const flushDraftPublication = options.preview.flushDraftPublication ?? flushSync;

  /**
   * Commit scene attrs and rasterize the Layer that owns the source after the mutation.
   *
   * Every admitted live frame owns the isolated drag Layer. Reading the current owner still matters
   * during terminal cleanup, after lifted nodes have moved back to the document Layer.
   */
  const mutateAndDrawSourceLayerSynchronously = (mutation: () => void): void => {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    const sourceLayer = (() => {
      try {
        // react-konva normally schedules another rAF after its commit. Suppress that redundant frame
        // and paint the actual authority Layer after source/draft authority is fully switched.
        studioKonvaRuntime.autoDrawEnabled = false;
        mutation();
        return node.getLayer();
      } finally {
        studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
      }
    })();
    sourceLayer?.drawScene();
  };

  const frameAdmitted = (frame: StudioLiveSelectionTransformFrame): boolean => {
    // Admission charges the destination SceneCanvas before the authoritative source can move.
    // Reading `node.getLayer()` here would grade the document Layer before the first frame and the
    // drag Layer afterwards, making the answer depend on a mutation the gate is meant to authorize.
    const rasterMetrics = studioLiveTransformRasterMetrics(options.stage, dragLayer);
    return admitStudioLiveTransformExactDraft({
      complexity: snapshot.exactDraftComplexity,
      sourceBounds: options.sourceBounds,
      targetBounds: frame.targetBounds,
      sceneElementCount: elements.length,
      rasterScale: rasterMetrics.rasterScale,
      sceneCanvasBackingPixels: rasterMetrics.sceneCanvasBackingPixels,
    }).admitted;
  };

  const restoreSourceVisibilityAttr = (): void => {
    if (!sourceHiddenForDraft) return;
    node.visible(sourceVisible);
    sourceHiddenForDraft = false;
  };

  const hideSourceForDraft = (): void => {
    if (sourceHiddenForDraft) return;
    node.visible(false);
    sourceHiddenForDraft = true;
  };

  /**
   * Transfer raster authority back without a blank frame:
   *
   * 1. restore source attrs and synchronously paint its CURRENT owning Layer;
   * 2. remove the React exact draft through the publication barrier;
   * 3. repaint the isolated Layer after the draft child has been removed.
   *
   * When source and draft share the drag Layer, step 1 is an unobservable intermediate draw in the
   * same JavaScript turn and step 3 is the final source-only receipt. Once cleanup moves the source
   * home, the two receipts land on separate Layers in the same source-before-draft order.
   */
  const paintSourceReceipt = (): void => {
    restoreSourceVisibilityAttr();
    node.getLayer()?.drawScene();
  };

  const paintSourceReceiptSynchronously = (): void => {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      paintSourceReceipt();
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
  };

  const transferAuthorityToSource = (
    mode: "clear" | "release",
    prepareSource: () => void = () => undefined,
  ): void => {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      prepareSource();
      paintSourceReceipt();
      const draftWasPresented = draftClaim?.hasPresentation() === true;
      // A retained affine frame normally has no exact subtree. Keep its hot path to one isolated
      // SceneCanvas draw; clearing an already-empty claim and drawing the same Layer again adds no
      // authority receipt. Release must still surrender even an empty generation during cleanup.
      if (draftClaim && (mode === "release" || draftWasPresented)) {
        let claimReceipt: boolean | null = null;
        flushDraftPublication(() => {
          claimReceipt = mode === "release"
            ? draftClaim?.release() ?? false
            : draftClaim?.clear() ?? false;
        });
        // `false` while this generation still owns the store means an onRelease/source receipt
        // failed. Propagate that ownership failure into close/settle recovery; acknowledging it here
        // would release the page writer lease underneath a still-authoritative exact draft.
        if (claimReceipt !== true && !draftClaim.isReleased()) {
          throw new Error(`Failed to ${mode} the live-transform draft claim`);
        }
        if (draftWasPresented) dragLayer?.drawScene();
      }
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
  };

  const claimIsolatedSource = (): boolean => {
    if (sourceLift && !sourceLift.restored) return true;
    if (sourceIsolationUnavailable) return false;
    const claimed = beginStudioSingleDrawTransformSourceLayer({
      elementId: snapshot.elementId,
      wrapper: node,
      transformer: options.transformer,
      dragLayer,
    });
    if (!claimed) {
      sourceIsolationUnavailable = true;
      return false;
    }
    sourceLift = claimed;
    sourceVisible = node.visible();
    clipHost = findStudioLiveTransformClipHost(node, dragLayer);
    originalClip = readStudioLiveTransformClip(clipHost);
    return true;
  };

  /**
   * End only the source authority claim while leaving proxy/Transformer chrome isolated.
   *
   * This transition runs once when an admitted presentation falls back to release-only. Later
   * rejected handle frames mutate only the chrome Layer; the authoritative wrapper stays in its
   * document Layer and is neither transformed nor included in the chrome canvas redraw.
   */
  const returnSourceToDocumentLayer = (): void => {
    if (!sourceLift) return;
    if (!sourceLift.restored) {
      transferAuthorityToSource("clear", () => {
        resetStudioLiveTransformPreviewNodeAttrs(node);
        applyStudioLiveTransformClip(clipHost, originalClip);
        terminalDraft = null;
      });
      restoreStudioLiveTransformClip(clipHost, originalClip);
      if (!restoreStudioSingleObjectDragLayer(sourceLift)) {
        throw new Error(
          "Failed to return the rejected live-transform source to its document Layer",
        );
      }
    }
    sourceLift = null;
    clipHost = null;
    originalClip = null;
  };

  const exactPresentation = (
    frame: StudioLiveSelectionTransformFrame,
  ): DrawEl | null => {
    if (!draftClaim) return null;
    if (!frameAdmitted(frame) || !claimIsolatedSource()) {
      returnSourceToDocumentLayer();
      return null;
    }
    const plan = planStudioDrawObjectTransformWithBounds({
      el: snapshot.element,
      sourceBounds: options.sourceBounds,
      targetBounds: frame.targetBounds,
      rotationDeg: frame.rotationDeg,
    });
    if (!plan) {
      returnSourceToDocumentLayer();
      return null;
    }
    const transformed = plan.element;
    let published = false;
    mutateAndDrawSourceLayerSynchronously(() => {
      flushDraftPublication(() => {
        draftClaim?.present([{
          element: transformed,
          clip: studioLiveTransformCommittedClip({
            targetBounds: frame.targetBounds,
            rotationDeg: frame.rotationDeg,
            transformedBounds: plan.bounds,
            elements,
            ...(snapshot.noClip !== undefined ? { noClip: snapshot.noClip } : {}),
          }),
        }]);
      });
      // A subscriber may synchronously supersede this generation while the publication barrier is
      // open. Never hide the source unless this exact object is still the store authority.
      const publishedSnapshot = options.preview.draftStore?.getSnapshot();
      if (
        publishedSnapshot?.scope !== options.preview.scope
        || publishedSnapshot.entries[0]?.element !== transformed
        || publishedSnapshot.entries.length !== 1
      ) {
        return;
      }
      resetStudioLiveTransformPreviewNodeAttrs(node);
      applyStudioLiveTransformClip(clipHost, originalClip);
      hideSourceForDraft();
      terminalDraft = transformed;
      published = true;
    });
    if (!published) {
      returnSourceToDocumentLayer();
      return null;
    }
    return transformed;
  };

  const cleanup = (
    outcome: Parameters<
      StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame>["close"]
    >[0],
  ): void => {
    if (closeState === "closed") return;
    if (closeState === "closing") {
      throw new Error("Konva live-transform renderer cleanup is already in progress");
    }
    // The first resolution owns the renderer claim forever. Recovery retries must resume that same
    // outcome; a late/re-entrant browser event cannot turn a cancelled claim into a commit.
    closeOutcome ??= outcome;
    const ownedOutcome = closeOutcome;
    closeState = "closing";
    const criticalFailures: unknown[] = [];
    const critical = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        criticalFailures.push(error);
      }
    };
    // Invalidate the rAF generation first: even an already-dispatched callback must not repaint a
    // pose after the document has regained renderer authority.
    critical(() => previewSession?.dispose());
    if (!terminalFramePrepared) {
      if (ownedOutcome.kind === "commit") {
        critical(() => {
          terminalDraft = exactPresentation(ownedOutcome.terminalFrame);
          terminalFramePrepared = true;
        });
      } else {
        // Keep the last exact pixels authoritative until the source is structurally home and has a
        // synchronous raster receipt below. Releasing here would clear the drag canvas while the
        // hidden source still waits for lift cleanup/main-Layer redraw.
        terminalDraft = null;
        terminalFramePrepared = true;
      }
    }
    // Restore the clip BEFORE nodes move home. A wrapper-local clipFunc reads the wrapper transform,
    // which the lift restore and neutralization below are about to change.
    critical(() => {
      restoreStudioLiveTransformClip(clipHost, originalClip);
    });
    let ownershipRestored = true;
    critical(() => {
      if (sourceLift && !sourceLift.restored && !restoreStudioSingleObjectDragLayer(sourceLift)) {
        ownershipRestored = false;
        throw new Error("Failed to restore the single-draw source Layer ownership");
      }
    });
    critical(() => {
      if (chromeLift && !chromeLift.restored && !restoreStudioSingleObjectDragLayer(chromeLift)) {
        ownershipRestored = false;
        throw new Error("Failed to restore the single-draw transform chrome Layer ownership");
      }
    });
    critical(() => {
      node.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, undefined);
    });
    critical(() => {
      resetStudioLiveTransformPreviewNodeAttrs(node);
    });
    if ((ownedOutcome.kind !== "commit" || terminalDraft === null) && ownershipRestored) {
      critical(() => {
        transferAuthorityToSource("release");
      });
    }
    // Selection chrome is cosmetic and can already have been destroyed by React reconciliation.
    for (const indicator of parkedIndicators) {
      try {
        indicator.visible(true);
      } catch {
        // Ignore destroyed chrome; authoritative geometry cleanup continues.
      }
    }
    // Chrome that mounted after begin is absent from the snapshot. It is cosmetic cleanup and must
    // never prevent the safety-critical wrapper neutralization above.
    try {
      drainStudioLateParkedChrome(node.getStage?.() ?? null);
    } catch {
      // A stale hidden indicator is recoverable; a stuck renderer transform is not.
    }
    try {
      node.getLayer()?.drawScene();
    } catch {
      // Cosmetic redraw only; the next authoritative render will repaint the Layer.
    }
    if (criticalFailures.length > 0) {
      // Re-open only after every best-effort phase has run. The common gesture lifecycle retains
      // this adapter and retries close; the phase-aware Layer session resumes unfinished records.
      closeState = "open";
      throw new AggregateError(
        criticalFailures,
        "Failed to completely release a Konva live-transform renderer claim",
      );
    }
    closeState = "closed";
  };

  try {
    parkedIndicators = [
      ...options.stage.find(`.${STUDIO_DRAW_SELECTION_INDICATOR_NAME}`),
      ...options.stage.find(`.${STUDIO_GROUP_SELECTION_OVERLAY_NAME}`),
    ].filter((indicator) => indicator.visible());
    for (const indicator of parkedIndicators) indicator.visible(false);

    // Gate drag/chrome mirrors before the first frame: wrapper x/y now represent an absolute live
    // transform pose, not a drag delta.
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      node.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, true);
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
    chromeLift = beginStudioSingleDrawTransformChromeLayer({
      elementId: snapshot.elementId,
      wrapper: node,
      proxy: options.proxy,
      transformer: options.transformer,
      dragLayer,
    });
    // Chrome must be isolated even when every source frame is release-only. The wrapper remains in
    // the document Layer until one real frame passes admission and claims source authority below.
    if (!chromeLift) {
      cleanup({ kind: "cancel", reason: "preview-error" });
      return null;
    }
    draftClaim = options.preview.draftStore?.claim(
      options.preview.scope,
      [snapshot.elementId],
    ) ?? null;
    sourceVisible = node.visible();

    previewSession = createStudioLiveTransformPreviewSession({
      sourceBounds: options.sourceBounds,
      renderRoute: snapshot.renderRoute,
      scheduler: options.preview.scheduler ?? browserFrameScheduler(),
      adapter: {
        presentationEnvironmentKey: () => {
          const metrics = studioLiveTransformRasterMetrics(options.stage, dragLayer);
          return `rasterScale:${metrics.rasterScale};backingPixels:${metrics.sceneCanvasBackingPixels}`;
        },
        apply: ({ frame, attrs }) => {
          const gestureFrame = {
            targetBounds: frame.targetBounds,
            rotationDeg: frame.rotationDeg,
          };
          if (!frameAdmitted(gestureFrame) || !claimIsolatedSource()) {
            returnSourceToDocumentLayer();
            return false;
          }
          transferAuthorityToSource("clear", () => {
            applyStudioLiveTransformPreviewNodeAttrs(node, attrs);
            applyStudioLiveTransformClip(
              clipHost,
              studioLiveTransformCommittedClip({
                sourceBounds: frame.sourceBounds,
                points: snapshot.points,
                targetBounds: frame.targetBounds,
                rotationDeg: frame.rotationDeg,
                elements,
                ...(snapshot.noClip !== undefined ? { noClip: snapshot.noClip } : {}),
              }),
            );
            terminalDraft = null;
          });
          return true;
        },
        applyExact: (frame) => {
          return exactPresentation({
            targetBounds: frame.targetBounds,
            rotationDeg: frame.rotationDeg,
          }) !== null;
        },
        neutralize: () => {
          returnSourceToDocumentLayer();
        },
      },
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
      ...(options.onFatalError !== undefined
        ? { onFatalError: options.onFatalError }
        : {}),
    });

    return {
      offer: (frame) => previewSession?.push(frame),
      close: cleanup,
      settle: ({ committed }) => {
        if (committed && terminalDraft) {
          if (!draftClaim) {
            transferAuthorityToSource("release");
            return true;
          }
          if (!handoffRegistered) {
            const retained = draftClaim.handoff([terminalDraft], () => {
              // The store invokes this before publishing snapshot=null. Paint the source first; the
              // draft root's layout receipt then clears the isolated canvas in the same React commit.
              // These latches let common settlement distinguish "awaiting receipt" from a failed
              // source raster receipt without forcing the handoff to release before acknowledgement.
              handoffReleaseRequested = true;
              paintSourceReceiptSynchronously();
              handoffSourceRestored = true;
            });
            handoffRegistered = retained;
            if (!retained) {
              if (!(handoffSourceRestored && draftClaim.isReleased())) {
                transferAuthorityToSource("release");
              }
              return true;
            }
          }
          if (handoffSourceRestored && draftClaim.isReleased()) return true;
          if (handoffReleaseRequested) {
            const released = draftClaim.release();
            if (!released && !draftClaim.isReleased()) return false;
            if (!(handoffSourceRestored && draftClaim.isReleased())) {
              transferAuthorityToSource("release");
            }
            return true;
          }
          // Registration alone is not settlement: keep the page/CRDT writer lease until the
          // authoritative document receipt (or timeout) restores source pixels and releases this
          // exact generation. Retrying while no release was requested must not expose old source.
          return false;
        }
        transferAuthorityToSource("release");
        return true;
      },
    };
  } catch (error) {
    try {
      cleanup({ kind: "cancel", reason: "preview-error" });
    } catch (cleanupError) {
      // Construction never returned an adapter, so the common lifecycle cannot retain this claim.
      // Transfer it to the renderer host before propagating the setup failure.
      retainStudioKonvaTransformCleanupRecovery(snapshot.elementId, () => {
        cleanup({ kind: "cancel", reason: "preview-error" });
      });
      throw new AggregateError(
        [error, cleanupError],
        "Konva live-transform setup and rollback both failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
