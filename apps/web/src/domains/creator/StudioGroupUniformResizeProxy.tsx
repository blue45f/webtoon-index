import { Fragment, useCallback, useLayoutEffect, useRef } from "react";
import { Rect, Transformer } from "react-konva/lib/ReactKonvaCore";

import {
  beginStudioLiveCanvasGesture,
} from "./studio-live-canvas-gesture";
import {
  beginStudioKonvaDrawTransformGesture,
  studioKonvaDrawTransformIsBusy,
} from "./studio-live-transform-gesture-konva";
import { beginStudioKonvaGroupDrawTransformGesture } from "./studio-live-transform-group-gesture-konva";
import {
  mirrorStudioDrawElementTranslation,
} from "./studio-selection-chrome-mirror";

import type { DrawEl, El } from "./studio-element-model";
import type { StudioGroupUniformResizeBounds } from "./studio-group-uniform-resize";
import type {
  StudioLiveCanvasGestureCancelReason,
  StudioLiveCanvasGestureSession,
  StudioLiveSelectionTransformFrame,
} from "./studio-live-canvas-gesture";
import type { StudioLiveTransformDraftStore } from "./studio-live-transform-draft-store";
import type { StudioLiveTransformPreviewScheduler } from "./studio-live-transform-preview-session";
import type Konva from "konva";
import type { RefObject } from "react";

const MINIMUM_VISUAL_SIZE_PX = 24;
const DESKTOP_ANCHOR_VISUAL_SIZE_PX = 13;
const COARSE_ANCHOR_VISUAL_SIZE_PX = 14;
const DESKTOP_ANCHOR_HIT_SIZE_PX = 22;
const COARSE_ANCHOR_HIT_SIZE_PX = 44;
const GROUP_SELECTION_ACCENT = "#c2410c";

function safeScale(effScale: number): number {
  return Number.isFinite(effScale) && effScale > 0 ? effScale : 1;
}

function finitePositiveBounds(bounds: StudioGroupUniformResizeBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

function copyBounds(
  bounds: StudioGroupUniformResizeBounds
): StudioGroupUniformResizeBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export interface StudioGroupUniformResizeProxyProps {
  readonly bounds: StudioGroupUniformResizeBounds;
  readonly effScale: number;
  /** Mobile layout or any coarse-pointer surface. */
  readonly mobile?: boolean;
  readonly coarse?: boolean;
  readonly enabled: boolean;
  /**
   * Opt in to independent width/height (the mid-side anchors and no aspect lock).
   *
   * Off by default because a mixed multi-selection is only safe under the UNIFORM planner: a
   * non-uniform scale would have to re-weight every stroke by direction, and rotation would stop
   * commuting with it. A single draw(선화) element turns it on — one point array can absorb a full
   * affine exactly, so the extra degrees of freedom cost it nothing.
   */
  readonly freeTransform?: boolean;
  /**
   * Opt in to the rotation handle.
   *
   * Separate from `freeTransform` because the two are independently safe. A multi-selection can
   * turn as a rigid body — uniform scale commutes with rotation, so each member's own angle is
   * just its stored one plus the gesture's — while still being unable to take a non-uniform
   * scale. The planner refuses the angle anyway when a member cannot represent one, so this is
   * the affordance, not the authority.
   */
  readonly rotatable?: boolean;
  /**
   * Optional renderer claim for live ink. Route thresholds, arrow semantics, clip ownership,
   * Layer lift and chrome parking are compiled behind the Konva adapters at gesture begin.
   *
   * `mode` is explicit rather than inferred from the payload, because the two lanes commit
   * differently: a single stroke absorbs a full affine and SCALES its width, while a
   * multi-selection takes the uniform group planner and PRESERVES it. Picking the wrong adapter
   * would show ink the release does not produce, so the caller has to name the lane it means.
   */
  readonly livePreview?: {
    readonly scope: string;
    readonly elements: readonly El[];
    readonly draftStore?: StudioLiveTransformDraftStore;
    readonly transformLiftLayerRef?: RefObject<Konva.Layer | null>;
    readonly scheduler?: StudioLiveTransformPreviewScheduler;
  } & (
    | { readonly mode: "single"; readonly element: DrawEl }
    | {
        readonly mode: "group";
        readonly selection: readonly El[];
        readonly isLocked: (element: El) => boolean;
      }
  );
  /**
   * Sole document boundary for this gesture. `commit` is the only callback allowed to publish
   * scene/history/CRDT state; `acquire`, `release` and `cancel` own the existing page lease.
   */
  readonly gestureBinding: {
    /** Monotonic Escape/pointer-cancel/lease-loss signal from outside Konva's own events. */
    readonly externalCancelSignal?: number;
    readonly acquire: (sourceBounds: StudioGroupUniformResizeBounds) => boolean;
    readonly commit: (frame: StudioLiveSelectionTransformFrame) => boolean;
    readonly release: () => void;
    readonly cancel: (reason: StudioLiveCanvasGestureCancelReason) => void;
  };
}

type ActiveResizeSession = {
  readonly sourceBounds: StudioGroupUniformResizeBounds;
  readonly gesture: StudioLiveCanvasGestureSession<StudioLiveSelectionTransformFrame>;
};

/**
 * A selection-only Konva proxy for atomic group resize.
 *
 * The proxy owns a dedicated Transformer and never attaches it to authored child nodes. This keeps
 * per-element transform-end handlers, history entries, and CRDT publications out of the preview.
 * The parent receives one finite positive target box after the proxy has already been restored.
 */
export function StudioGroupUniformResizeProxy({
  bounds,
  effScale,
  mobile = false,
  coarse = false,
  enabled,
  freeTransform = false,
  rotatable = false,
  livePreview,
  gestureBinding,
}: StudioGroupUniformResizeProxyProps) {
  const proxyRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const activeSessionRef = useRef<ActiveResizeSession | null>(null);
  const gestureBindingRef = useRef(gestureBinding);
  const coarsePointer = mobile || coarse;
  const scale = safeScale(effScale);
  const validBounds = finitePositiveBounds(bounds);
  const anchorVisualSize =
    (coarsePointer
      ? COARSE_ANCHOR_VISUAL_SIZE_PX
      : DESKTOP_ANCHOR_VISUAL_SIZE_PX) / scale;
  const anchorHitSize =
    (coarsePointer
      ? COARSE_ANCHOR_HIT_SIZE_PX
      : DESKTOP_ANCHOR_HIT_SIZE_PX) / scale;

  useLayoutEffect(() => {
    gestureBindingRef.current = gestureBinding;
  }, [gestureBinding]);

  /**
   * Resolves the live-ink preview target for a starting gesture, or null when the stroke has no
   * scene node or sits under a cached ancestor (whose bitmap our attrs could never repaint).
   *
   * The stroke's dashed indicator is parked for the duration: its translation mirror reads the
   * wrapper's x/y as a drag offset, which the preview repurposes as the absolute target origin.
   * The Transformer frame carries the "selected" affordance for the whole gesture, and un-parking
   * re-converges the box through that same mirror once the wrapper resets to neutral.
   */
  /**
   * Is the live-preview stroke already being dragged by another pointer?
   *
   * A drag and a transform both write the wrapper's transform, and the page-side guard only
   * tracks group drags — so a second touch starting the Transformer while a first is dragging the
   * stroke body left two writers on one node, with a last-writer position surviving depending on
   * event order. Refuse the transform rather than arbitrating: the drag already owns the node,
   * and the user gets the gesture back by lifting that finger.
   */
  function livePreviewStrokeIsAlreadyDragging(): boolean {
    // Only the single-stroke lane writes the wrapper transform, so only it can collide with a
    // body drag. The group lane leaves every source node untouched and merely hides it.
    if (livePreview?.mode !== "single") return false;
    const stage = proxyRef.current?.getStage();
    if (!stage) return false;
    return studioKonvaDrawTransformIsBusy(stage, livePreview.element.id);
  }

  function restoreProxy(source: StudioGroupUniformResizeBounds) {
    const proxy = proxyRef.current;
    if (!proxy) return;
    proxy.position({ x: source.x, y: source.y });
    proxy.width(source.width);
    proxy.height(source.height);
    proxy.scaleX(1);
    proxy.scaleY(1);
    proxy.rotation(0);
    transformerRef.current?.forceUpdate();
    proxy.getLayer()?.batchDraw();
  }

  const cancelActiveTransform = useCallback((
    reason: StudioLiveCanvasGestureCancelReason,
  ): boolean => {
    const active = activeSessionRef.current;
    if (!active) return false;
    // Clear first: Konva may synchronously emit transformend from stopTransform(). That event must
    // observe an inactive session and therefore cannot commit or report a second cancellation.
    activeSessionRef.current = null;
    try {
      transformerRef.current?.stopTransform();
    } catch {
      // A broken Konva teardown must not strand the document lease or renderer claim.
    } finally {
      // The common session owns proxy/renderer rollback plus the page lease release. It was sealed
      // before stopTransform, so a synchronous transformend cannot resolve it a second time.
      active.gesture.cancel(reason);
    }
    return true;
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const cancelForWindowBlur = () => {
      cancelActiveTransform("window-blur");
    };
    const cancelForHiddenDocument = () => {
      if (document.visibilityState === "hidden") {
        cancelActiveTransform("document-hidden");
      }
    };
    window.addEventListener("blur", cancelForWindowBlur);
    document.addEventListener("visibilitychange", cancelForHiddenDocument);
    return () => {
      window.removeEventListener("blur", cancelForWindowBlur);
      document.removeEventListener("visibilitychange", cancelForHiddenDocument);
    };
  }, [cancelActiveTransform]);

  // Mount value is the baseline, never a cancellation. `cancelActiveTransform` calls back into
  // the page's cancel, which bumps this counter again — that pass finds no session on either
  // side and stops, so the round trip cannot loop.
  const externalCancelSignal = gestureBinding.externalCancelSignal;
  const lastExternalCancelSignalRef = useRef(externalCancelSignal);
  useLayoutEffect(() => {
    if (externalCancelSignal === lastExternalCancelSignalRef.current) return;
    lastExternalCancelSignalRef.current = externalCancelSignal;
    cancelActiveTransform("source-changed");
  }, [cancelActiveTransform, externalCancelSignal]);

  function handleTransformStart() {
    // Konva may deliver a duplicate transformstart for the same Transformer/pointer sequence.
    // The existing generation already owns the page lease and renderer claim; attempting a second
    // acquire would be rejected and could stop/restore underneath that still-active generation.
    if (activeSessionRef.current) return;
    const sourceBounds = copyBounds(bounds);
    if (
      !enabled
      || !finitePositiveBounds(sourceBounds)
      || livePreviewStrokeIsAlreadyDragging()
    ) {
      transformerRef.current?.stopTransform();
      if (finitePositiveBounds(sourceBounds)) restoreProxy(sourceBounds);
      return;
    }

    const proxy = proxyRef.current;
    const transformer = transformerRef.current;
    if (!proxy || !transformer) return;
    const binding = gestureBindingRef.current;
    const begun = beginStudioLiveCanvasGesture<StudioLiveSelectionTransformFrame>({
      commitPort: {
        acquire: () => binding.acquire(sourceBounds),
        commit: binding.commit,
        release: binding.release,
        cancel: binding.cancel,
      },
      createTransient: () => {
        const stage = proxy.getStage();
        const shared = livePreview && stage
          ? {
              sourceBounds,
              stage,
              proxy,
              transformer,
              onFatalError: () => {
                cancelActiveTransform("preview-error");
              },
              common: {
                scope: livePreview.scope,
                elements: livePreview.elements,
                dragLayer: livePreview.transformLiftLayerRef?.current ?? null,
                ...(livePreview.draftStore !== undefined
                  ? { draftStore: livePreview.draftStore }
                  : {}),
                ...(livePreview.scheduler !== undefined
                  ? { scheduler: livePreview.scheduler }
                  : {}),
              },
            }
          : null;
        const renderer = !shared || !livePreview
          ? null
          : livePreview.mode === "single"
            ? beginStudioKonvaDrawTransformGesture({
                preview: { ...shared.common, element: livePreview.element },
                sourceBounds: shared.sourceBounds,
                stage: shared.stage,
                proxy: shared.proxy,
                transformer: shared.transformer,
                onFatalError: shared.onFatalError,
              })
            : beginStudioKonvaGroupDrawTransformGesture({
                preview: {
                  ...shared.common,
                  selection: livePreview.selection,
                  isLocked: livePreview.isLocked,
                },
                sourceBounds: shared.sourceBounds,
                stage: shared.stage,
                proxy: shared.proxy,
                transformer: shared.transformer,
                onFatalError: shared.onFatalError,
              });
        return {
          offer: (frame) => renderer?.offer(frame),
          close: (outcome) => {
            // Restore while the proxy still belongs to the gesture Layer. The renderer adapter
            // then returns lifted nodes home and neutralizes the authored stroke wrapper.
            const failures: unknown[] = [];
            try {
              restoreProxy(sourceBounds);
            } catch (error) {
              failures.push(error);
            }
            try {
              renderer?.close(outcome);
            } catch (error) {
              failures.push(error);
            }
            if (failures.length > 0) {
              throw new AggregateError(
                failures,
                "Failed to completely close a Studio selection transform",
              );
            }
          },
          settle: (settlement) => renderer?.settle?.(settlement),
        };
      },
    });
    if (!begun.ok) {
      transformerRef.current?.stopTransform();
      restoreProxy(sourceBounds);
      return;
    }
    activeSessionRef.current = {
      sourceBounds,
      gesture: begun.session,
    };
  }

  /**
   * Live ink projection, PPT-style. Transform events only offer their newest reading to the
   * gesture session; route/clip classification and renderer writes happen at most once per rAF.
   * The adapter remains purely imperative — no React commit, document mutation or history entry —
   * so pointer-up stays the single authoritative commit.
   */
  function handleTransform(event: Konva.KonvaEventObject<Event>) {
    const active = activeSessionRef.current;
    if (!active) return;
    const proxy = event.target as Konva.Rect;
    active.gesture.offer({
      targetBounds: {
        x: proxy.x(),
        y: proxy.y(),
        width: proxy.width() * proxy.scaleX(),
        height: proxy.height() * proxy.scaleY(),
      },
      rotationDeg: rotatable ? proxy.rotation() : 0,
    });
  }

  function handleTransformEnd(event: Konva.KonvaEventObject<Event>) {
    const active = activeSessionRef.current;
    if (!active) {
      if (validBounds) restoreProxy(bounds);
      return;
    }
    activeSessionRef.current = null;

    const proxy = event.target as Konva.Rect;
    const targetBounds: StudioGroupUniformResizeBounds = {
      x: proxy.x(),
      y: proxy.y(),
      width: proxy.width() * proxy.scaleX(),
      height: proxy.height() * proxy.scaleY(),
    };
    // Konva reports the box unrotated and carries the angle separately, which is exactly the
    // scale-then-rotate decomposition the draw planner consumes.
    const rotationDeg = rotatable ? proxy.rotation() : 0;
    if (!finitePositiveBounds(targetBounds) || !Number.isFinite(rotationDeg)) {
      active.gesture.cancel("invalid-terminal-frame");
      return;
    }
    active.gesture.finish({ targetBounds, rotationDeg });
  }

  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    const transformer = transformerRef.current;
    if (!proxy || !transformer) return;
    if (enabled && validBounds) {
      transformer.nodes([proxy]);
      transformer.forceUpdate();
    } else {
      if (!cancelActiveTransform("disabled")) transformer.stopTransform();
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
    return () => {
      if (transformer.nodes().includes(proxy)) {
        transformer.nodes([]);
        transformer.getLayer()?.batchDraw();
      }
    };
  }, [cancelActiveTransform, enabled, validBounds]);

  useLayoutEffect(() => {
    if (activeSessionRef.current || !validBounds) return;
    const proxy = proxyRef.current;
    if (!proxy) return;
    proxy.position({ x: bounds.x, y: bounds.y });
    proxy.width(bounds.width);
    proxy.height(bounds.height);
    proxy.scaleX(1);
    proxy.scaleY(1);
    proxy.rotation(0);
    transformerRef.current?.forceUpdate();
    proxy.getLayer()?.batchDraw();
  }, [bounds.x, bounds.y, bounds.width, bounds.height, validBounds]);

  useLayoutEffect(
    () => () => {
      cancelActiveTransform("unmount");
    },
    [cancelActiveTransform]
  );

  // The drag mirror exists for a single stroke whose body can be dragged while the handles are
  // up. A multi-selection has no such single body, so the group lane opts out entirely.
  const mirroredDragElementId = livePreview?.mode === "single"
    ? livePreview.element.id
    : undefined;

  // Follow the stroke's imperative drag translation so the handle frame is rasterized in the same
  // frame as the ink. Skipped during an active resize, where the proxy is the thing being moved.
  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    const mirrorDragElementId = mirroredDragElementId;
    if (!proxy || !mirrorDragElementId || !validBounds) return;
    const stage = proxy.getStage();
    if (!stage) return;
    // Only ever restore what this effect hid, so a genuine `visible={false}` from props survives.
    let parkedHere = false;
    const detach = mirrorStudioDrawElementTranslation(stage, mirrorDragElementId, (offset) => {
      if (activeSessionRef.current) return;
      const x = bounds.x + offset.x;
      const y = bounds.y + offset.y;
      if (proxy.x() === x && proxy.y() === y) return;
      // No forceUpdate: moving the proxy fires `absoluteTransformChange`, which the Transformer
      // already listens to and answers by rebuilding its anchors.
      proxy.position({ x, y });

      // Park the handle frame for the duration of the move. Re-rastering nine anchors, the rotate
      // handle and the dashed border on every drag frame doubled the layer's draw time (measured
      // ~80ms -> ~157ms per drawScene), and a resize handle is not actionable mid-drag anyway.
      // The stroke's own dashed selection indicator keeps the "selected" affordance, and it is a
      // single unfilled Rect. Toggled imperatively so parking costs no React commit.
      const dragging = offset.x !== 0 || offset.y !== 0;
      const transformer = transformerRef.current;
      if (!transformer) return;
      if (dragging && transformer.visible()) {
        transformer.visible(false);
        parkedHere = true;
        transformer.getLayer()?.batchDraw();
      } else if (!dragging && parkedHere) {
        transformer.visible(true);
        parkedHere = false;
        transformer.getLayer()?.batchDraw();
      }
    });
    // Captured for cleanup: by teardown the ref may already point at a different Transformer, and
    // only the instance this effect actually hid should be restored.
    const parkedTransformer = transformerRef.current;
    return () => {
      detach();
      // Unparking must not depend on a later React render: `visible` is driven by a prop whose
      // value did not change while we hid the node, so the reconciler would never re-set it and
      // the handles would stay invisible for the rest of the selection.
      if (parkedHere && parkedTransformer) {
        parkedTransformer.visible(true);
        parkedTransformer.getLayer()?.batchDraw();
      }
    };
  }, [mirroredDragElementId, bounds.x, bounds.y, validBounds]);

  const minimumSize = MINIMUM_VISUAL_SIZE_PX / scale;

  return (
    <Fragment>
      <Rect
        ref={proxyRef}
        name="studio-group-uniform-resize-proxy"
        x={bounds.x}
        y={bounds.y}
        width={Math.max(0, bounds.width)}
        height={Math.max(0, bounds.height)}
        fill="rgba(0, 0, 0, 0.001)"
        opacity={0}
        listening={false}
        strokeEnabled={false}
        perfectDrawEnabled={false}
        onTransformStart={handleTransformStart}
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
      />
      <Transformer
        ref={transformerRef}
        name="studio-group-uniform-resize-transformer"
        visible={enabled && validBounds}
        resizeEnabled={enabled && validBounds}
        rotateEnabled={rotatable && enabled && validBounds}
        rotationSnaps={rotatable ? [0, 45, 90, 135, 180, 225, 270, 315] : []}
        rotationSnapTolerance={6}
        flipEnabled={false}
        keepRatio={!freeTransform}
        centeredScaling={false}
        shouldOverdrawWholeArea={false}
        enabledAnchors={
          freeTransform
            ? [
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
                "middle-left",
                "middle-right",
                "top-center",
                "bottom-center",
              ]
            : ["top-left", "top-right", "bottom-left", "bottom-right"]
        }
        anchorSize={anchorVisualSize}
        anchorCornerRadius={anchorVisualSize / 2}
        anchorStroke={GROUP_SELECTION_ACCENT}
        anchorStrokeWidth={1.5 / scale}
        anchorFill="#fffaf5"
        borderStroke={GROUP_SELECTION_ACCENT}
        borderStrokeWidth={1.35 / scale}
        borderDash={[2 / scale, 3 / scale]}
        anchorStyleFunc={(anchor) => {
          anchor.hitStrokeWidth(anchorHitSize);
          anchor.shadowColor("#111827");
          anchor.shadowBlur(4 / scale);
          anchor.shadowOpacity(0.32);
          anchor.shadowOffsetY(1 / scale);
        }}
        boundBoxFunc={(oldBox, newBox) =>
          !Number.isFinite(newBox.x) ||
          !Number.isFinite(newBox.y) ||
          !Number.isFinite(newBox.width) ||
          !Number.isFinite(newBox.height) ||
          newBox.width < minimumSize ||
          newBox.height < minimumSize
            ? oldBox
            : newBox
        }
      />
    </Fragment>
  );
}
