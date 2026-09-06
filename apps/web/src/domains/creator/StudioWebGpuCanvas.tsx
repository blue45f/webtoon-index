import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import { resolveStudioWebGpuCanvasStrokes } from "./render/studio-webgpu-canvas-authority";
import { isStudioWebGpuCanvasActive } from "./render/studio-webgpu-dab-planner";
import {
  StudioWebGpuEngine,
  type StudioGpuStrokeJournalSuffixBatchPatch,
  type StudioGpuStrokeJournalSuffixPatch,
  type StudioWebGpuResizeOutcome,
} from "./render/studio-webgpu-engine";
import {
  sameStudioGpuStrokes,
  snapshotStudioGpuStrokes,
  type StudioGpuStroke,
} from "./render/studio-webgpu-stroke";
import {
  planStudioGpuPinnedStrokeFeedUpdate,
  type StudioGpuStrokeOperationsAppendPatch,
  type StudioGpuStrokeSuffixBatchPatch,
  type StudioGpuStrokeSuffixPatch,
} from "./render/studio-webgpu-stroke-feed";
import { resolveStudioLiveSurfaceDevicePixelRatio } from "./studio-low-latency-canvas";

import type {
  StudioGpuBackend,
  StudioGpuFrameReadbackRequest,
  StudioGpuFrameReadbackResult,
  StudioGpuFrameReceipt,
  StudioGpuPerformanceMetrics,
} from "./render/studio-webgpu-frame-contract";
import type { StudioWebGpuSurfaceBounds } from "./render/studio-webgpu-viewport";
import type { StudioGpuViewTransform } from "./render/studio-webgpu-viewport-contract";

import { cn } from "@/shared/lib/utils";

const EMPTY_STROKES: readonly StudioGpuStroke[] = Object.freeze([]);
const EMPTY_PERFORMANCE_METRICS: StudioGpuPerformanceMetrics = Object.freeze({
  instanceBufferAllocations: 0,
  presentationBufferAllocations: 0,
  presentationBindGroupAllocations: 0,
  presentationBindGroupReuses: 0,
});

export interface StudioWebGpuCanvasProps extends StudioGpuViewTransform {
  readonly className?: string;
  /** Logical document coordinates, independent of CSS zoom and device pixel ratio. */
  readonly width: number;
  readonly height: number;
  /**
   * Optional CSS bounds inside the scaled document. Supplying these keeps the presentation and
   * backing surfaces viewport-sized while `width`/`height` continue to describe document space.
   */
  readonly surfaceBounds?: StudioWebGpuSurfaceBounds;
  /**
   * Ordered operations composited inside this surface. `erase` strokes destination-out only pixels
   * produced by earlier strokes in this array; they intentionally cannot punch through DOM/Konva
   * content below the transparent canvas.
   */
  readonly strokes?: readonly StudioGpuStroke[];
  /** Must match the parent's authoritative-canvas handoff state for an atomic show/hide commit. */
  readonly frameAuthorized?: boolean;
  /**
   * Stroke-scoped live-ink pinning: while true, presentation does not wait for per-frame
   * receipts. A trailing frame only ever shows a valid prefix of the pinned stroke, so the
   * overlay may lag input by a frame but can never alternate with the Konva draft. Receipts
   * remain the sole authority for readback capture and committed handoff.
   */
  readonly pinnedVisible?: boolean;
  /**
   * Initialize the GPU device on mount instead of on the first non-empty stroke feed, so the
   * backend is already resolved when the first stroke starts (live-ink pinning decides its
   * renderer at stroke start and never mid-stroke).
   */
  readonly eagerInitialize?: boolean;
  readonly onBackendChange?: (backend: StudioGpuBackend) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /**
   * Fired synchronously before a resize/viewport change rewrites either backing surface. The
   * parent must revoke the currently-visible GPU authority immediately and only reopen it after
   * `onFrameReady` supplies this exact request id.
   */
  readonly onFrameRequest?: (request: StudioWebGpuSurfaceFrameRequest) => void;
  /** A matching receipt is the only safe signal for hiding the authoritative Konva preview. */
  readonly onFrameReady?: (receipt: StudioGpuFrameReceipt) => void;
  readonly onFrameInvalid?: () => void;
}

export interface StudioWebGpuSurfaceFrameRequest {
  readonly requestId: string;
  readonly reason: "surface-resize" | "viewport-change";
}

export interface StudioWebGpuCanvasHandle {
  /** Captures only the exact receipt-authorized frame; stale or unavailable frames are rejected. */
  readonly captureFrame: (
    request: StudioGpuFrameReadbackRequest
  ) => Promise<StudioGpuFrameReadbackResult>;
  /** Snapshot of bounded allocation/reuse counters for browser performance instrumentation. */
  readonly getPerformanceMetrics: () => StudioGpuPerformanceMetrics;
  /** True only while the immutable selected provider can accept a new operation. */
  readonly isBackendAvailable: () => boolean;
  /**
   * Stroke-pinned imperative feed: updates the engine without a parent React render. The pinned
   * live-ink path calls this once per pointer frame so a 30k-line parent never re-renders per
   * point; the declarative `strokes` prop remains authoritative outside a pinned stroke.
   */
  readonly syncPinnedStrokes: (
    strokes: readonly StudioGpuStroke[]
  ) => StudioWebGpuJournalFeedOutcome;
  /** Explicit zero-history-copy hot path for callers that already own a proven point suffix. */
  readonly appendPinnedStrokeSuffix: (patch: StudioGpuStrokeSuffixPatch) => void;
  /** Appends a terminal symmetry group's suffixes atomically and submits exactly one frame. */
  readonly appendPinnedStrokeSuffixBatch: (patch: StudioGpuStrokeSuffixBatchPatch) => void;
  /** Suffix-only journal path; the engine binds its private revision receipt at execution time. */
  readonly appendPinnedJournalSuffix: (
    patch: StudioGpuStrokeJournalSuffixPatch
  ) => StudioWebGpuJournalFeedOutcome;
  /** Atomically advances a journal symmetry group without constructing a full replacement frame. */
  readonly appendPinnedJournalSuffixBatch: (
    patch: StudioGpuStrokeJournalSuffixBatchPatch
  ) => StudioWebGpuJournalFeedOutcome;
  /** Appends newly-started operations while retaining earlier normal/erase pixels in place. */
  readonly appendPinnedStrokeOperations: (patch: StudioGpuStrokeOperationsAppendPatch) => void;
  /** Replaces the pinned baseline and deliberately pays one full validation/snapshot cost. */
  readonly replacePinnedStrokes: (
    strokes: readonly StudioGpuStroke[]
  ) => StudioWebGpuJournalFeedOutcome;
  /** Starts a root-only journal feed; subsequent journal calls retain no caller full history. */
  readonly replacePinnedJournalBaseline: (
    strokes: readonly StudioGpuStroke[]
  ) => StudioWebGpuJournalFeedOutcome;
  /** Clears pinned pixels while keeping the initialized backend warm. */
  readonly resetPinnedStrokes: () => StudioWebGpuJournalFeedOutcome;
  /**
   * Compositor-only visibility gate. It preserves the pinned journal and never issues a
   * replacement request, so an in-flight baseline can stay hidden until its exact receipt.
   */
  readonly setPinnedPresentationVisible: (visible: boolean) => void;
  /**
   * Authority release plus visibility toggle. Passing false restores the declarative request and
   * invalidates the pinned journal; use `setPinnedPresentationVisible` for a temporary hide.
   */
  readonly setPinnedVisible: (visible: boolean) => void;
}

/** Synchronous admission plus the exact receipt identity for a suffix-only journal command. */
export interface StudioWebGpuJournalFeedOutcome {
  readonly status: "accepted" | "rejected";
  readonly requestId: string;
}

interface LatestCanvasProps {
  width: number;
  height: number;
  strokes: readonly StudioGpuStroke[];
  scaleX: number | undefined;
  scaleY: number | undefined;
  offsetX: number | undefined;
  offsetY: number | undefined;
  flipX: boolean | undefined;
  surfaceLeft: number | undefined;
  surfaceTop: number | undefined;
  surfaceWidth: number | undefined;
  surfaceHeight: number | undefined;
}

type StudioGpuEngineFeedCommand =
  | { readonly mode: "full" }
  | { readonly mode: "replace" }
  | { readonly mode: "journal-replace" }
  | { readonly mode: "append-operations"; readonly patch: StudioGpuStrokeOperationsAppendPatch }
  | { readonly mode: "append"; readonly patch: StudioGpuStrokeSuffixPatch }
  | { readonly mode: "append-batch"; readonly patch: StudioGpuStrokeSuffixBatchPatch }
  | { readonly mode: "journal-append"; readonly patch: StudioGpuStrokeJournalSuffixPatch }
  | { readonly mode: "journal-append-batch"; readonly patch: StudioGpuStrokeJournalSuffixBatchPatch }
  | { readonly mode: "retain" }
  | { readonly mode: "reset" };

function resumedPinnedFeedCommand(
  pinnedStrokes: readonly StudioGpuStroke[] | null,
  journalActive: boolean,
  currentStrokes: readonly StudioGpuStroke[]
): StudioGpuEngineFeedCommand {
  if (pinnedStrokes === null) return { mode: "full" };
  if (journalActive) return { mode: "retain" };
  return currentStrokes.length > 0 ? { mode: "replace" } : { mode: "reset" };
}

function sameCanvasViewportRequest(left: LatestCanvasProps, right: LatestCanvasProps): boolean {
  return Object.is(left.width, right.width)
    && Object.is(left.height, right.height)
    && Object.is(left.scaleX, right.scaleX)
    && Object.is(left.scaleY, right.scaleY)
    && Object.is(left.offsetX, right.offsetX)
    && Object.is(left.offsetY, right.offsetY)
    && left.flipX === right.flipX
    && Object.is(left.surfaceWidth, right.surfaceWidth)
    && Object.is(left.surfaceHeight, right.surfaceHeight);
}

function sameCanvasRequest(left: LatestCanvasProps, right: LatestCanvasProps): boolean {
  return sameCanvasViewportRequest(left, right)
    && sameStudioGpuStrokes(left.strokes, right.strokes);
}

function snapshotCanvasRequest(request: LatestCanvasProps): LatestCanvasProps {
  return {
    ...request,
    strokes: snapshotStudioGpuStrokes(request.strokes),
  };
}

function measuredCssSize(element: HTMLElement | null, logicalWidth: number, logicalHeight: number) {
  const bounds = element?.getBoundingClientRect();
  return {
    width: bounds && bounds.width > 0 ? bounds.width : logicalWidth,
    height: bounds && bounds.height > 0 ? bounds.height : logicalHeight,
  };
}

function devicePixelRatio(cssWidth: number, cssHeight: number): number {
  return typeof globalThis.devicePixelRatio === "number" && Number.isFinite(globalThis.devicePixelRatio)
    ? resolveStudioLiveSurfaceDevicePixelRatio({
        cssWidth,
        cssHeight,
        devicePixelRatio: globalThis.devicePixelRatio,
      })
    : 1;
}

export const StudioWebGpuCanvas = forwardRef<StudioWebGpuCanvasHandle, StudioWebGpuCanvasProps>(
function StudioWebGpuCanvas({
  className,
  width,
  height,
  surfaceBounds,
  strokes = EMPTY_STROKES,
  frameAuthorized = false,
  pinnedVisible = false,
  eagerInitialize = false,
  scaleX,
  scaleY,
  offsetX,
  offsetY,
  flipX,
  onBackendChange,
  onDeviceLost,
  onFrameRequest,
  onFrameReady,
  onFrameInvalid,
}: StudioWebGpuCanvasProps, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 파인 가시성의 임페러티브 사본 — 스트로크 시작/종료가 부모 렌더 없이 이 컴포넌트만 갱신한다.
  const [pinnedVisibleState, setPinnedVisibleState] = useState(false);
  // Mount-time decision by contract: toggling eager initialization after mount has no meaning
  // (the device either already initialized or will on the first stroke feed).
  const eagerInitializeRef = useRef(eagerInitialize);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2dCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StudioWebGpuEngine | null>(null);
  const callbacksRef = useRef({
    onBackendChange,
    onDeviceLost,
    onFrameRequest,
    onFrameReady,
    onFrameInvalid,
  });
  const requestSequenceRef = useRef(0);
  const desiredRequestIdRef = useRef("frame:0");
  const lastIssuedRequestRef = useRef<LatestCanvasProps | null>(null);
  const issueLatestRequestRef = useRef<(() => StudioWebGpuJournalFeedOutcome) | null>(null);
  const pendingEngineCommandRef = useRef<StudioGpuEngineFeedCommand>({ mode: "full" });
  const pinnedStrokesRef = useRef<readonly StudioGpuStroke[] | null>(null);
  const pinnedJournalActiveRef = useRef(false);
  const declarativeRequestRef = useRef<LatestCanvasProps>({
    width,
    height,
    strokes,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    flipX,
    surfaceLeft: surfaceBounds?.left,
    surfaceTop: surfaceBounds?.top,
    surfaceWidth: surfaceBounds?.width,
    surfaceHeight: surfaceBounds?.height,
  });
  const latestEffectiveRequestRef = useRef<LatestCanvasProps>(declarativeRequestRef.current);

  callbacksRef.current = {
    onBackendChange,
    onDeviceLost,
    onFrameRequest,
    onFrameReady,
    onFrameInvalid,
  };
  const declarativeRequest: LatestCanvasProps = {
    width,
    height,
    strokes,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    flipX,
    surfaceLeft: surfaceBounds?.left,
    surfaceTop: surfaceBounds?.top,
    surfaceWidth: surfaceBounds?.width,
    surfaceHeight: surfaceBounds?.height,
  };
  declarativeRequestRef.current = declarativeRequest;
  latestEffectiveRequestRef.current = {
    ...declarativeRequest,
    strokes: resolveStudioWebGpuCanvasStrokes(
      declarativeRequest.strokes,
      pinnedStrokesRef.current
    ),
  };

  const queuePinnedRequest = (
    nextStrokes: readonly StudioGpuStroke[],
    command: StudioGpuEngineFeedCommand
  ): StudioWebGpuJournalFeedOutcome => {
    pinnedStrokesRef.current = nextStrokes;
    latestEffectiveRequestRef.current = {
      ...declarativeRequestRef.current,
      strokes: nextStrokes,
    };
    lastIssuedRequestRef.current = {
      ...latestEffectiveRequestRef.current,
      strokes: EMPTY_STROKES,
    };
    pendingEngineCommandRef.current = command;
    requestSequenceRef.current += 1;
    desiredRequestIdRef.current = `frame:${requestSequenceRef.current}`;
    return issueLatestRequestRef.current?.() ?? {
      status: "rejected",
      requestId: desiredRequestIdRef.current,
    };
  };

  const queuePinnedJournalRequest = (
    command: StudioGpuEngineFeedCommand
  ): StudioWebGpuJournalFeedOutcome => {
    lastIssuedRequestRef.current = {
      ...latestEffectiveRequestRef.current,
      strokes: EMPTY_STROKES,
    };
    pendingEngineCommandRef.current = command;
    requestSequenceRef.current += 1;
    desiredRequestIdRef.current = `frame:${requestSequenceRef.current}`;
    return issueLatestRequestRef.current?.() ?? {
      status: "rejected",
      requestId: desiredRequestIdRef.current,
    };
  };

  useImperativeHandle(ref, () => ({
    captureFrame: (request) => engineRef.current?.captureFrame(request) ?? Promise.resolve({
      status: "rejected",
      reason: "frame-unavailable",
    }),
    getPerformanceMetrics: () =>
      engineRef.current?.getPerformanceMetrics() ?? EMPTY_PERFORMANCE_METRICS,
    isBackendAvailable: () => engineRef.current?.isBackendAvailable() ?? false,
    syncPinnedStrokes: (nextStrokes) => {
      pinnedJournalActiveRef.current = false;
      const update = planStudioGpuPinnedStrokeFeedUpdate(
        pinnedStrokesRef.current,
        nextStrokes
      );
      if (update.mode === "append") {
        return queuePinnedRequest(nextStrokes, { mode: "append", patch: update.patch });
      } else if (update.mode === "append-operations") {
        return queuePinnedRequest(nextStrokes, {
          mode: "append-operations",
          patch: update.patch,
        });
      } else if (update.mode === "retain") {
        return queuePinnedRequest(nextStrokes, { mode: "retain" });
      } else if (update.mode === "reset") {
        return queuePinnedRequest(nextStrokes, { mode: "reset" });
      } else {
        return queuePinnedRequest(nextStrokes, { mode: "replace" });
      }
    },
    appendPinnedStrokeSuffix: (patch) => {
      pinnedJournalActiveRef.current = false;
      queuePinnedRequest(patch.fallbackStrokes, { mode: "append", patch });
    },
    appendPinnedStrokeSuffixBatch: (patch) => {
      pinnedJournalActiveRef.current = false;
      queuePinnedRequest(patch.fallbackStrokes, { mode: "append-batch", patch });
    },
    appendPinnedJournalSuffix: (patch) => {
      pinnedJournalActiveRef.current = true;
      const outcome = queuePinnedJournalRequest({ mode: "journal-append", patch });
      if (outcome.status === "rejected") pinnedJournalActiveRef.current = false;
      return outcome;
    },
    appendPinnedJournalSuffixBatch: (patch) => {
      pinnedJournalActiveRef.current = true;
      const outcome = queuePinnedJournalRequest({ mode: "journal-append-batch", patch });
      if (outcome.status === "rejected") pinnedJournalActiveRef.current = false;
      return outcome;
    },
    appendPinnedStrokeOperations: (patch) => {
      pinnedJournalActiveRef.current = false;
      queuePinnedRequest(patch.fallbackStrokes, { mode: "append-operations", patch });
    },
    replacePinnedStrokes: (nextStrokes) => {
      pinnedJournalActiveRef.current = false;
      return queuePinnedRequest(nextStrokes, nextStrokes.length > 0
        ? { mode: "replace" }
        : { mode: "reset" });
    },
    replacePinnedJournalBaseline: (nextStrokes) => {
      pinnedJournalActiveRef.current = nextStrokes.length > 0;
      pinnedStrokesRef.current = nextStrokes;
      latestEffectiveRequestRef.current = {
        ...declarativeRequestRef.current,
        strokes: nextStrokes,
      };
      const outcome = queuePinnedJournalRequest(nextStrokes.length > 0
        ? { mode: "journal-replace" }
        : { mode: "reset" });
      if (outcome.status === "rejected") pinnedJournalActiveRef.current = false;
      return outcome;
    },
    resetPinnedStrokes: () => {
      pinnedJournalActiveRef.current = false;
      return queuePinnedRequest(EMPTY_STROKES, { mode: "reset" });
    },
    setPinnedPresentationVisible: (visible) => {
      const root = rootRef.current;
      if (root) {
        root.style.visibility = visible ? "visible" : "hidden";
        // The engine owns each child canvas and may set the selected provider's surface visible.
        // A visible child can override inherited `visibility: hidden`.
        // Ancestor opacity cannot be resurrected by a child, so it is the hard presentation gate
        // while the parent has not authorized the matching frame receipt.
        root.style.opacity = visible ? "1" : "0";
      }
      setPinnedVisibleState(visible);
    },
    setPinnedVisible: (visible) => {
      const root = rootRef.current;
      if (!visible && root) {
        root.style.visibility = "hidden";
        root.style.opacity = "0";
      }
      if (!visible && pinnedStrokesRef.current !== null) {
        // Pin release is an authority transition, not just a CSS visibility change. Restore the
        // newest declarative request immediately even when React can bail out of an unchanged
        // `false` state update (for example, selected-provider cancellation before visibility
        // state commits).
        pinnedStrokesRef.current = null;
        pinnedJournalActiveRef.current = false;
        const latest = declarativeRequestRef.current;
        latestEffectiveRequestRef.current = latest;
        lastIssuedRequestRef.current = snapshotCanvasRequest(latest);
        pendingEngineCommandRef.current = { mode: "full" };
        requestSequenceRef.current += 1;
        desiredRequestIdRef.current = `frame:${requestSequenceRef.current}`;
        callbacksRef.current.onFrameInvalid?.();
        issueLatestRequestRef.current?.();
      }
      if (visible && root) {
        root.style.visibility = "visible";
        root.style.opacity = "1";
      }
      setPinnedVisibleState(visible);
    },
  }), []);

  useEffect(() => {
    const canvas = gpuCanvasRef.current;
    const canvas2dCanvas = canvas2dCanvasRef.current;
    if (!canvas || !canvas2dCanvas) return;

    let mounted = true;
    let initializationRequested = false;
    const engine = new StudioWebGpuEngine({
      canvas,
      canvas2dCanvas,
      selectedBackend: "webgpu",
      // This component is the display-only live-draft path. Avoid one viewport-sized immutable
      // texture plus a texture copy per pointer frame; direct engine users keep readback by default.
      retainReadbackSnapshot: false,
      onBackendChange: (backend) => callbacksRef.current.onBackendChange?.(backend),
      onDeviceLost: (info) => callbacksRef.current.onDeviceLost?.(info),
      onFrameInvalid: () => callbacksRef.current.onFrameInvalid?.(),
      onFrameReady: (receipt) => {
        if (receipt.requestId !== desiredRequestIdRef.current) return;
        callbacksRef.current.onFrameReady?.(receipt);
      },
    });
    engineRef.current = engine;
    // Resizing an active engine historically renders its last (initially blank) operation set.
    // Suspend first so an empty Studio page neither paints a blank frame nor starts WebGPU.
    engine.suspend(desiredRequestIdRef.current);
    engine.releaseSuspendedSurfaceBackingStores();

    const syncViewport = (
      observedWidth?: number,
      observedHeight?: number,
      resizeRequest?: {
        readonly requestId: string;
        readonly render: boolean;
        readonly reason: StudioWebGpuSurfaceFrameRequest["reason"];
        readonly commitRequestId?: boolean;
      }
    ): StudioWebGpuResizeOutcome => {
      const latest = latestEffectiveRequestRef.current;
      const measured = measuredCssSize(
        rootRef.current,
        latest.surfaceWidth ?? latest.width,
        latest.surfaceHeight ?? latest.height
      );
      const cssWidth = observedWidth && observedWidth > 0 ? observedWidth : measured.width;
      const cssHeight = observedHeight && observedHeight > 0 ? observedHeight : measured.height;
      return engine.resize(
        {
          logicalWidth: latest.width,
          logicalHeight: latest.height,
          cssWidth,
          cssHeight,
          dpr: devicePixelRatio(cssWidth, cssHeight),
          scaleX: latest.scaleX,
          scaleY: latest.scaleY,
          offsetX: latest.offsetX,
          offsetY: latest.offsetY,
          flipX: latest.flipX,
        },
        resizeRequest ? {
          requestId: resizeRequest.requestId,
          render: resizeRequest.render,
          onBeforeSurfaceMutation: (requestId) => {
            if (resizeRequest.commitRequestId) {
              requestSequenceRef.current += 1;
              desiredRequestIdRef.current = requestId;
            }
            // The observer/window resize path is itself an issued viewport request. Record the
            // geometry here, before React's following layout effect, so that effect cannot enqueue
            // a second `retain` request for the same surface mutation. A duplicate retain can
            // legitimately produce no engine frame (`resize: unchanged`), leaving its receipt
            // unregistered and forcing the parent to abandon otherwise-valid GPU live ink.
            lastIssuedRequestRef.current = pinnedStrokesRef.current !== null
              ? { ...latest, strokes: EMPTY_STROKES }
              : snapshotCanvasRequest(latest);
            // Canvas width/height assignment destroys its backing pixels synchronously. Hide the
            // compositor in the same stack before the engine reaches that assignment; the parent
            // receives the exact receipt identity required to reopen it.
            const root = rootRef.current;
            if (root) {
              root.style.visibility = "hidden";
              root.style.opacity = "0";
            }
            callbacksRef.current.onFrameRequest?.({
              requestId,
              reason: resizeRequest.reason,
            });
          },
        } : undefined
      );
    };

    const requestInitialization = () => {
      if (initializationRequested) return;
      initializationRequested = true;
      void engine.initialize().then(() => {
        if (!mounted || engineRef.current !== engine) return;
        const current = latestEffectiveRequestRef.current;
        pendingEngineCommandRef.current = resumedPinnedFeedCommand(
          pinnedStrokesRef.current,
          pinnedJournalActiveRef.current,
          current.strokes
        );
        issueLatestRequestRef.current?.();
      });
    };

    const issueLatestRequest = (): StudioWebGpuJournalFeedOutcome => {
      const latest = latestEffectiveRequestRef.current;
      const requestId = desiredRequestIdRef.current;
      const command = pendingEngineCommandRef.current;
      pendingEngineCommandRef.current = { mode: "full" };
      const requiresFullValidation = command.mode === "full" || command.mode === "replace";
      if (
        command.mode === "reset"
        || (requiresFullValidation && !isStudioWebGpuCanvasActive(latest.strokes))
      ) {
        engine.resetStrokeFeed(requestId);
        engine.releaseSuspendedSurfaceBackingStores();
        return { status: "accepted", requestId };
      }
      // Resizing is part of this request, not a separate old-feed render. The engine invalidates
      // before rewriting either surface and defers rasterization to the command below, preserving
      // the journal hot path and preventing a same-id receipt for stale retained strokes.
      syncViewport(undefined, undefined, {
        requestId,
        render: false,
        reason: "viewport-change",
      });
      let journalOutcome: StudioWebGpuJournalFeedOutcome["status"] = "accepted";
      if (command.mode === "append") {
        engine.appendStrokeFeedSuffix(command.patch, requestId);
      } else if (command.mode === "append-batch") {
        engine.appendStrokeFeedSuffixBatch(command.patch, requestId);
      } else if (command.mode === "journal-append") {
        journalOutcome = engine.appendStrokeFeedJournalSuffix(command.patch, requestId)
          === "appended" ? "accepted" : "rejected";
      } else if (command.mode === "journal-append-batch") {
        journalOutcome = engine.appendStrokeFeedJournalSuffixBatch(command.patch, requestId)
          === "appended" ? "accepted" : "rejected";
      } else if (command.mode === "append-operations") {
        engine.appendStrokeFeedOperations(command.patch, requestId);
      } else if (command.mode === "retain") {
        engine.retainStrokeFeed(requestId);
      } else if (command.mode === "journal-replace") {
        journalOutcome = engine.replaceStrokeFeedJournalBaseline(latest.strokes, requestId)
          === "replaced" ? "accepted" : "rejected";
      } else if (command.mode === "replace") {
        engine.replaceStrokeFeed(latest.strokes, requestId);
      } else {
        engine.render(latest.strokes, requestId);
      }
      requestInitialization();
      return { status: journalOutcome, requestId };
    };
    issueLatestRequestRef.current = issueLatestRequest;
    issueLatestRequest();

    // Live-ink pinning decides its renderer at stroke start; resolving the backend at mount keeps
    // the very first stroke of a session from silently landing on the not-yet-initialized path.
    if (eagerInitializeRef.current && !initializationRequested) {
      initializationRequested = true;
      void engine.initialize().then(() => {
        if (!mounted || engineRef.current !== engine) return;
        const current = latestEffectiveRequestRef.current;
        pendingEngineCommandRef.current = resumedPinnedFeedCommand(
          pinnedStrokesRef.current,
          pinnedJournalActiveRef.current,
          current.strokes
        );
        issueLatestRequest();
      });
    }

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const latest = latestEffectiveRequestRef.current;
          if (!isStudioWebGpuCanvasActive(latest.strokes)) {
            return;
          }
          const requestId = `frame:${requestSequenceRef.current + 1}`;
          syncViewport(entry.contentRect.width, entry.contentRect.height, {
            requestId,
            render: true,
            reason: "surface-resize",
            commitRequestId: true,
          });
        });
    if (resizeObserver && rootRef.current) resizeObserver.observe(rootRef.current);
    const handleWindowResize = () => {
      const latest = latestEffectiveRequestRef.current;
      if (!isStudioWebGpuCanvasActive(latest.strokes)) {
        return;
      }
      const requestId = `frame:${requestSequenceRef.current + 1}`;
      syncViewport(undefined, undefined, {
        requestId,
        render: true,
        reason: "surface-resize",
        commitRequestId: true,
      });
    };
    globalThis.addEventListener?.("resize", handleWindowResize, { passive: true });

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", handleWindowResize);
      if (issueLatestRequestRef.current === issueLatestRequest) {
        issueLatestRequestRef.current = null;
      }
      if (engineRef.current === engine) engineRef.current = null;
      engine.dispose();
    };
  }, []);

  // Invalidate the old authority first, then resize and render under a new request identity in the
  // same layout phase. This semantic comparison deliberately avoids a hash collision becoming an
  // authority decision and also tolerates parents rebuilding equivalent stroke arrays.
  useLayoutEffect(() => {
    const latest = latestEffectiveRequestRef.current;
    // Imperative pinning owns pixels, but viewport transforms still invalidate the backing
    // presentation. Compare geometry only (never the growing point arrays) and re-present the
    // engine-owned journal under a fresh request id.
    if (pinnedStrokesRef.current !== null) {
      if (
        lastIssuedRequestRef.current
        && sameCanvasViewportRequest(lastIssuedRequestRef.current, latest)
      ) {
        return;
      }
      lastIssuedRequestRef.current = {
        ...latest,
        strokes: EMPTY_STROKES,
      };
      requestSequenceRef.current += 1;
      desiredRequestIdRef.current = `frame:${requestSequenceRef.current}`;
      pendingEngineCommandRef.current = { mode: "retain" };
      callbacksRef.current.onFrameInvalid?.();
      issueLatestRequestRef.current?.();
      return;
    }
    if (lastIssuedRequestRef.current && sameCanvasRequest(lastIssuedRequestRef.current, latest)) {
      return;
    }
    lastIssuedRequestRef.current = snapshotCanvasRequest(latest);
    const requestId = `frame:${requestSequenceRef.current + 1}`;
    requestSequenceRef.current += 1;
    desiredRequestIdRef.current = requestId;
    pendingEngineCommandRef.current = { mode: "full" };
    callbacksRef.current.onFrameInvalid?.();
    issueLatestRequestRef.current?.();
  });

  useLayoutEffect(() => {
    // Once authority release has committed, hand visibility back to the declarative class gate.
    // The inline value exists only to make imperative GPU↔Canvas swaps synchronous.
    if (pinnedStrokesRef.current === null) {
      rootRef.current?.style.removeProperty("visibility");
      rootRef.current?.style.removeProperty("opacity");
    }
  }, [frameAuthorized, pinnedVisibleState, strokes]);

  // 파인된 스트로크는 임페러티브 피드로만 흐르므로 strokes prop 이 비어 있어도 표시 대상이다.
  const pinnedShown = pinnedVisible || pinnedVisibleState;
  const presentationActive = isStudioWebGpuCanvasActive(strokes) || pinnedShown;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn(
        "overflow-hidden",
        surfaceBounds ? "absolute" : "relative h-full w-full",
        ((!frameAuthorized && !pinnedShown) || !presentationActive)
          && "invisible opacity-0",
        className
      )}
      style={surfaceBounds ? {
        left: surfaceBounds.left,
        top: surfaceBounds.top,
        width: surfaceBounds.width,
        height: surfaceBounds.height,
      } : undefined}
      data-studio-gpu-compositor="true"
      data-studio-gpu-active={presentationActive ? "true" : "false"}
      data-studio-gpu-readback="disabled"
      data-studio-gpu-frame-authorized={frameAuthorized ? "true" : "false"}
      data-studio-gpu-pinned={pinnedShown ? "true" : "false"}
      data-studio-gpu-surface-width={surfaceBounds?.width}
      data-studio-gpu-surface-height={surfaceBounds?.height}
    >
      <canvas
        ref={gpuCanvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        data-studio-gpu-surface="webgpu"
      />
      <canvas
        ref={canvas2dCanvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        data-studio-gpu-surface="canvas2d"
      />
    </div>
  );
});

StudioWebGpuCanvas.displayName = "StudioWebGpuCanvas";
