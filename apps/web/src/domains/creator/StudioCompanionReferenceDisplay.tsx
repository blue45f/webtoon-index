import {
  ImageIcon,
  Maximize2,
  Minus,
  Move,
  Pipette,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type {
  StudioCompanionReferenceControl,
  StudioCompanionReferencePoint,
  StudioCompanionReferenceProjection,
} from "./studio-companion-reference-projection";

import { cn } from "@/shared/lib/utils";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const MODIFIED_WHEEL_ZOOM_SENSITIVITY = 0.01;
const MIN_WHEEL_ZOOM_FACTOR = 0.8;
const MAX_WHEEL_ZOOM_FACTOR = 1.25;
const WHEEL_FEEDBACK_IDLE_MS = 150;

export type StudioCompanionReferenceConnectionStatus =
  | "connected"
  | "reconnecting"
  | "disconnected";

export type StudioCompanionReferencePreviewMetadata = {
  url: string;
  generation: number;
  revision: number;
  referenceRevision: number;
  sequence: number;
  width: number;
  height: number;
};

export type StudioCompanionReferenceColorResult = {
  color: string;
  generation: number;
  revision: number;
  referenceRevision: number;
  sequence: number;
};

export interface StudioCompanionReferenceDisplayProps {
  projection: StudioCompanionReferenceProjection | null;
  preview: StudioCompanionReferencePreviewMetadata | null;
  connectionStatus: StudioCompanionReferenceConnectionStatus;
  latestColorResult?: StudioCompanionReferenceColorResult | null;
  /** Increment when the transport callback/channel is replaced without changing generation. */
  connectionEpoch?: number;
  onControl: (control: StudioCompanionReferenceControl) => void;
}

type Pan = { x: number; y: number };
type ReferenceViewMode = "fit" | "actual" | "custom";
type PendingWheelZoom = {
  zoom: number;
  pan: Pan;
  percent: number;
};
type TouchPoint = {
  x: number;
  y: number;
};
type PinchSession = {
  pointerIds: readonly [number, number];
  startDistance: number;
  startCentroid: TouchPoint;
  startZoom: number;
  startPan: Pan;
  moved: boolean;
};
type PanSession = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  suppressPrimaryClick: boolean;
};

type ReferenceDisplayState =
  | "ready"
  | "partial"
  | "loading"
  | "empty"
  | "unavailable"
  | "reconnecting"
  | "disconnected";

type ContainedImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const toolButtonClass = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border px-2",
  "text-[0.68rem] font-semibold outline-none",
  "transition-[border-color,background-color,color] duration-150 motion-reduce:transition-none",
  "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
  "disabled:cursor-not-allowed disabled:opacity-40"
);

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function fitScale(containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number) {
  if (
    containerWidth <= 0
    || containerHeight <= 0
    || imageWidth <= 0
    || imageHeight <= 0
  ) return 0;
  return Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
}

function containedImageRect(input: {
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  pan: Pan;
}): ContainedImageRect | null {
  const scale = fitScale(
    input.containerWidth,
    input.containerHeight,
    input.imageWidth,
    input.imageHeight
  );
  if (scale <= 0) return null;
  const width = input.imageWidth * scale * input.zoom;
  const height = input.imageHeight * scale * input.zoom;
  return {
    x: (input.containerWidth - width) / 2 + input.pan.x,
    y: (input.containerHeight - height) / 2 + input.pan.y,
    width,
    height,
  };
}

function pointWithinImage(input: {
  clientX: number;
  clientY: number;
  bounds: DOMRect;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  pan: Pan;
}): StudioCompanionReferencePoint | null {
  const image = containedImageRect({
    containerWidth: input.bounds.width,
    containerHeight: input.bounds.height,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    zoom: input.zoom,
    pan: input.pan,
  });
  if (!image || image.width <= 0 || image.height <= 0) return null;
  const x = input.clientX - input.bounds.left - image.x;
  const y = input.clientY - input.bounds.top - image.y;
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  return { x: x / image.width, y: y / image.height };
}

function anchorPreservingPan(input: {
  anchorX: number;
  anchorY: number;
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
  nextZoom: number;
  currentPan: Pan;
}): Pan {
  if (input.currentZoom <= 0 || input.nextZoom <= 0) return input.currentPan;
  const ratio = input.nextZoom / input.currentZoom;
  const offsetX = input.anchorX - input.containerWidth / 2;
  const offsetY = input.anchorY - input.containerHeight / 2;
  return {
    x: offsetX - (offsetX - input.currentPan.x) * ratio,
    y: offsetY - (offsetY - input.currentPan.y) * ratio,
  };
}

function touchDistance(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function touchCentroid(first: TouchPoint, second: TouchPoint): TouchPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function pinchPreservingPan(input: {
  startCentroid: TouchPoint;
  currentCentroid: TouchPoint;
  containerWidth: number;
  containerHeight: number;
  startZoom: number;
  nextZoom: number;
  startPan: Pan;
}): Pan {
  if (input.startZoom <= 0 || input.nextZoom <= 0) return input.startPan;
  const ratio = input.nextZoom / input.startZoom;
  const startOffsetX = input.startCentroid.x - input.containerWidth / 2;
  const startOffsetY = input.startCentroid.y - input.containerHeight / 2;
  const currentOffsetX = input.currentCentroid.x - input.containerWidth / 2;
  const currentOffsetY = input.currentCentroid.y - input.containerHeight / 2;
  return {
    x: currentOffsetX - (startOffsetX - input.startPan.x) * ratio,
    y: currentOffsetY - (startOffsetY - input.startPan.y) * ratio,
  };
}

function normalizedWheelDelta(event: WheelEvent, viewportHeight: number): number {
  const modeScale = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? Math.max(1, viewportHeight)
      : 1;
  return Math.max(-240, Math.min(240, event.deltaY * modeScale));
}

function matchesProjection(
  projection: StudioCompanionReferenceProjection | null,
  preview: StudioCompanionReferencePreviewMetadata | null
): boolean {
  return projection !== null
    && preview !== null
    && preview.generation === projection.generation
    && preview.revision === projection.revision
    && preview.referenceRevision === projection.referenceRevision;
}

function resolveDisplayState(
  connectionStatus: StudioCompanionReferenceConnectionStatus,
  projection: StudioCompanionReferenceProjection | null,
  preview: StudioCompanionReferencePreviewMetadata | null
): ReferenceDisplayState {
  if (connectionStatus === "disconnected") return "disconnected";
  if (connectionStatus === "reconnecting") return "reconnecting";
  if (!projection) return "loading";
  if (projection.itemCount === 0) return "empty";
  if (projection.resolvedItemCount === 0) return "unavailable";
  if (!matchesProjection(projection, preview)) return "loading";
  if (projection.resolvedItemCount < projection.itemCount) return "partial";
  return "ready";
}

function stateCopy(state: ReferenceDisplayState): { title: string; detail: string } {
  switch (state) {
    case "disconnected":
      return {
        title: "기본 스튜디오 연결이 끊겼습니다",
        detail: "편집 탭을 다시 열거나 이 창을 새로 연결해 주세요.",
      };
    case "reconnecting":
      return {
        title: "기본 스튜디오에 다시 연결하는 중",
        detail: "마지막 합성본은 유지하고 새 입력은 잠시 막았습니다.",
      };
    case "empty":
      return {
        title: "레퍼런스가 아직 없습니다",
        detail: "기본 스튜디오의 레퍼런스 보드에 이미지를 추가하면 여기에 표시됩니다.",
      };
    case "unavailable":
      return {
        title: "표시할 수 있는 레퍼런스가 없습니다",
        detail: "불러오지 못한 항목을 기본 스튜디오에서 확인해 주세요.",
      };
    case "partial":
      return {
        title: "일부 레퍼런스만 표시 중",
        detail: "사용 가능한 항목으로 합성본을 만들었습니다.",
      };
    case "loading":
      return {
        title: "레퍼런스 미리보기를 준비하고 있어요",
        detail: "편집을 막지 않도록 안전한 합성본을 만드는 중입니다.",
      };
    case "ready":
      return {
        title: "레퍼런스 보드가 최신 상태입니다",
        detail: "스포이드로 합성본의 색을 기본 스튜디오에 보낼 수 있습니다.",
      };
  }
}

function colorResultIsUsable(
  result: StudioCompanionReferenceColorResult | null | undefined,
  projection: StudioCompanionReferenceProjection | null,
  expectedSequence: number
): result is StudioCompanionReferenceColorResult {
  return result !== null
    && result !== undefined
    && result.generation === projection?.generation
    && result.revision === projection?.revision
    && result.referenceRevision === projection?.referenceRevision
    && Number.isSafeInteger(result.sequence)
    && result.sequence === expectedSequence
    && expectedSequence > 0
    && /^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(result.color);
}

export function StudioCompanionReferenceDisplay({
  projection,
  preview,
  connectionStatus,
  latestColorResult = null,
  connectionEpoch = 0,
  onControl,
}: StudioCompanionReferenceDisplayProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const helpId = `${id}-help`;
  const statusId = `${id}-status`;
  const viewportRef = useRef<HTMLButtonElement>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const activeTouchPointersRef = useRef(new Map<number, TouchPoint>());
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const touchGestureWasPinchRef = useRef(false);
  const suppressClickRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const lastPointerTypeRef = useRef("");
  const viewModeRef = useRef<ReferenceViewMode>("fit");
  const pickCursorRef = useRef({
    generation: projection?.generation ?? 0,
    referenceRevision: projection?.referenceRevision ?? 0,
    sequence: 0,
  });
  const pendingPanDeltaRef = useRef<Pan>({ x: 0, y: 0 });
  const panAnimationFrameRef = useRef(0);
  const pendingWheelZoomRef = useRef<PendingWheelZoom | null>(null);
  const wheelAnimationFrameRef = useRef(0);
  const wheelFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWheelFeedbackPercentRef = useRef<number | null>(null);
  const pendingPinchZoomRef = useRef<PendingWheelZoom | null>(null);
  const pinchAnimationFrameRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [zoomLabel, setZoomLabel] = useState("맞춤");
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [pickerActive, setPickerActive] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [feedback, setFeedback] = useState("레퍼런스 전용 화면이 열렸습니다.");
  const sendDemandControl = useEffectEvent(onControl);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useLayoutEffect(() => {
    // Native wheel/pointer callbacks may outlive a render attempt. Mirror only committed view
    // state so an abandoned concurrent render cannot change the imperative transform.
    zoomRef.current = zoom;
    panRef.current = pan;
  }, [pan, zoom]);

  const displayState = resolveDisplayState(connectionStatus, projection, preview);
  const copy = stateCopy(displayState);
  const currentFrameMatches = matchesProjection(projection, preview);
  const currentFrameRenderable = currentFrameMatches
    && (projection?.resolvedItemCount ?? 0) > 0;
  const visiblePreview = preview
    && preview.url.startsWith("blob:")
    && currentFrameRenderable
    ? preview
    : null;
  const connectedPreview = connectionStatus === "connected" ? visiblePreview : null;
  const connectedPreviewRef = useRef(connectedPreview);
  useLayoutEffect(() => {
    // Keep native gesture handlers on the last committed transport frame. A render that suspends
    // or is superseded cannot grant access to a Blob URL that the visible tree never accepted.
    connectedPreviewRef.current = connectedPreview;
  }, [connectedPreview]);
  const touchGesturesReady = connectedPreview !== null;
  const pickerReady = connectionStatus === "connected"
    && currentFrameRenderable
    && projection?.canPickColor === true;
  const pickCursor = pickCursorRef.current;
  const expectedColorSequence = pickCursor.generation === projection?.generation
    && pickCursor.referenceRevision === projection?.referenceRevision
    ? pickCursor.sequence
    : 0;
  const colorResult = colorResultIsUsable(
    latestColorResult,
    projection,
    expectedColorSequence
  )
    ? latestColorResult
    : null;
  const handleNativeWheel = useEffectEvent((event: WheelEvent) => {
    scheduleWheelZoom(event);
  });

  function clearTouchGesture(input: { flush: boolean; releaseCapture: boolean }) {
    const activePointerIds = [...activeTouchPointersRef.current.keys()];
    const viewport = viewportRef.current;
    if (input.releaseCapture && viewport) {
      for (const pointerId of activePointerIds) {
        try {
          if (!viewport.hasPointerCapture || viewport.hasPointerCapture(pointerId)) {
            viewport.releasePointerCapture(pointerId);
          }
        } catch {
          // Capture can already be released by pointercancel/lostpointercapture.
        }
      }
    }
    activeTouchPointersRef.current.clear();
    pinchSessionRef.current = null;
    touchGestureWasPinchRef.current = false;
    if (panSessionRef.current && activePointerIds.includes(panSessionRef.current.pointerId)) {
      panSessionRef.current = null;
      cancelPendingPan(input.flush);
    }
    cancelPendingPinchZoom(input.flush);
    suppressClickRef.current = false;
  }

  const clearTouchGestureFromEffect = useEffectEvent(
    (input: { flush: boolean; releaseCapture: boolean }) => clearTouchGesture(input)
  );
  const cancelPendingWheelFeedbackFromEffect = useEffectEvent(
    () => cancelPendingWheelFeedback(false)
  );
  const cancelPendingWheelZoomFromEffect = useEffectEvent(
    () => cancelPendingWheelZoom(false)
  );

  useEffect(() => {
    let demanded = false;
    function releaseDemand() {
      if (!demanded) return;
      demanded = false;
      sendDemandControl({ kind: "reference-preview-demand", active: false });
    }
    function updateDemand() {
      const nextDemand = connectionStatus === "connected"
        && document.visibilityState !== "hidden";
      if (nextDemand === demanded) return;
      demanded = nextDemand;
      sendDemandControl({ kind: "reference-preview-demand", active: nextDemand });
    }

    updateDemand();
    document.addEventListener("visibilitychange", updateDemand);
    window.addEventListener("pagehide", releaseDemand);
    window.addEventListener("pageshow", updateDemand);
    return () => {
      document.removeEventListener("visibilitychange", updateDemand);
      window.removeEventListener("pagehide", releaseDemand);
      window.removeEventListener("pageshow", updateDemand);
      releaseDemand();
    };
  }, [connectionEpoch, connectionStatus, projection?.generation]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => handleNativeWheel(event);
    const preventNativeGesture = (event: Event) => {
      if (connectedPreviewRef.current) event.preventDefault();
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", preventNativeGesture, { passive: false });
    viewport.addEventListener("gesturechange", preventNativeGesture, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", preventNativeGesture);
      viewport.removeEventListener("gesturechange", preventNativeGesture);
    };
  }, []);

  useEffect(() => {
    pickCursorRef.current = {
      generation: projection?.generation ?? 0,
      referenceRevision: projection?.referenceRevision ?? 0,
      sequence: 0,
    };
    setPickerActive(false);
  }, [projection?.generation, projection?.referenceRevision]);

  useEffect(() => {
    clearTouchGestureFromEffect({ flush: false, releaseCapture: true });
    if (wheelAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(wheelAnimationFrameRef.current);
    }
    wheelAnimationFrameRef.current = 0;
    pendingWheelZoomRef.current = null;
    cancelPendingWheelFeedbackFromEffect();
    if (panAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(panAnimationFrameRef.current);
    }
    panAnimationFrameRef.current = 0;
    pendingPanDeltaRef.current = { x: 0, y: 0 };
    panSessionRef.current = null;
    suppressClickRef.current = false;
    spaceHeldRef.current = false;
    lastPointerTypeRef.current = "";
    viewModeRef.current = "fit";
    setSpaceHeld(false);
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setZoomLabel("맞춤");
    setPan({ x: 0, y: 0 });
    setFeedback("새 레퍼런스 화면을 맞춤 보기로 열었습니다.");
  }, [projection?.generation]);

  useEffect(() => {
    clearTouchGestureFromEffect({ flush: false, releaseCapture: true });
    if (!connectedPreviewRef.current) cancelPendingWheelZoomFromEffect();
  }, [
    connectionStatus,
    visiblePreview?.generation,
    visiblePreview?.referenceRevision,
    visiblePreview?.revision,
    visiblePreview?.sequence,
    visiblePreview?.url,
  ]);

  useEffect(() => () => {
    if (panAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(panAnimationFrameRef.current);
    }
    panAnimationFrameRef.current = 0;
    pendingPanDeltaRef.current = { x: 0, y: 0 };
    if (wheelAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(wheelAnimationFrameRef.current);
    }
    wheelAnimationFrameRef.current = 0;
    pendingWheelZoomRef.current = null;
    cancelPendingWheelFeedbackFromEffect();
    clearTouchGestureFromEffect({ flush: false, releaseCapture: true });
  }, []);

  useEffect(() => {
    if (pickerReady) return;
    setPickerActive(false);
  }, [pickerReady]);

  function flushPendingPan() {
    panAnimationFrameRef.current = 0;
    const delta = pendingPanDeltaRef.current;
    pendingPanDeltaRef.current = { x: 0, y: 0 };
    if (delta.x === 0 && delta.y === 0) return;
    const next = { x: panRef.current.x + delta.x, y: panRef.current.y + delta.y };
    panRef.current = next;
    setPan(next);
  }

  function cancelPendingPan(flush: boolean) {
    if (panAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(panAnimationFrameRef.current);
    }
    panAnimationFrameRef.current = 0;
    if (flush) flushPendingPan();
    else pendingPanDeltaRef.current = { x: 0, y: 0 };
  }

  function schedulePan(deltaX: number, deltaY: number) {
    pendingPanDeltaRef.current = {
      x: pendingPanDeltaRef.current.x + deltaX,
      y: pendingPanDeltaRef.current.y + deltaY,
    };
    if (panAnimationFrameRef.current) return;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      flushPendingPan();
      return;
    }
    panAnimationFrameRef.current = globalThis.requestAnimationFrame(flushPendingPan);
  }

  function flushPendingWheelZoom() {
    wheelAnimationFrameRef.current = 0;
    const pending = pendingWheelZoomRef.current;
    pendingWheelZoomRef.current = null;
    if (!pending) return;
    zoomRef.current = pending.zoom;
    panRef.current = pending.pan;
    viewModeRef.current = "custom";
    setZoom(pending.zoom);
    setPan(pending.pan);
    setZoomLabel(`${pending.percent}%`);
    scheduleWheelFeedback(pending.percent);
  }

  function flushPendingWheelFeedback() {
    if (wheelFeedbackTimerRef.current) clearTimeout(wheelFeedbackTimerRef.current);
    wheelFeedbackTimerRef.current = null;
    const percent = pendingWheelFeedbackPercentRef.current;
    pendingWheelFeedbackPercentRef.current = null;
    if (percent === null) return;
    setFeedback(`확대율 ${percent}% · 포인터 위치를 유지했습니다.`);
  }

  function cancelPendingWheelFeedback(announce: boolean) {
    if (wheelFeedbackTimerRef.current) clearTimeout(wheelFeedbackTimerRef.current);
    wheelFeedbackTimerRef.current = null;
    if (announce) flushPendingWheelFeedback();
    else pendingWheelFeedbackPercentRef.current = null;
  }

  function scheduleWheelFeedback(percent: number) {
    pendingWheelFeedbackPercentRef.current = percent;
    if (wheelFeedbackTimerRef.current) clearTimeout(wheelFeedbackTimerRef.current);
    wheelFeedbackTimerRef.current = globalThis.setTimeout(
      flushPendingWheelFeedback,
      WHEEL_FEEDBACK_IDLE_MS
    );
  }

  function cancelPendingWheelZoom(flush: boolean) {
    if (wheelAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(wheelAnimationFrameRef.current);
    }
    wheelAnimationFrameRef.current = 0;
    if (flush) {
      flushPendingWheelZoom();
      flushPendingWheelFeedback();
    } else {
      pendingWheelZoomRef.current = null;
      cancelPendingWheelFeedback(false);
    }
  }

  function flushPendingPinchZoom() {
    pinchAnimationFrameRef.current = 0;
    const pending = pendingPinchZoomRef.current;
    pendingPinchZoomRef.current = null;
    if (!pending) return;
    zoomRef.current = pending.zoom;
    panRef.current = pending.pan;
    viewModeRef.current = "custom";
    setZoom(pending.zoom);
    setPan(pending.pan);
    setZoomLabel(`${pending.percent}%`);
  }

  function cancelPendingPinchZoom(flush: boolean) {
    if (pinchAnimationFrameRef.current && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(pinchAnimationFrameRef.current);
    }
    pinchAnimationFrameRef.current = 0;
    if (flush) flushPendingPinchZoom();
    else pendingPinchZoomRef.current = null;
  }

  function schedulePinchZoom(next: PendingWheelZoom) {
    pendingPinchZoomRef.current = next;
    if (pinchAnimationFrameRef.current) return;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      flushPendingPinchZoom();
      return;
    }
    pinchAnimationFrameRef.current = globalThis.requestAnimationFrame(flushPendingPinchZoom);
  }

  function scheduleWheelZoom(event: WheelEvent) {
    const currentPreview = connectedPreviewRef.current;
    const viewport = viewportRef.current;
    if (!currentPreview || !viewport) return;
    event.preventDefault();
    if (event.deltaY === 0 || !Number.isFinite(event.deltaY)) return;
    clearTouchGesture({ flush: true, releaseCapture: true });
    cancelPendingPan(true);
    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const base = pendingWheelZoomRef.current ?? {
      zoom: zoomRef.current,
      pan: panRef.current,
      percent: 0,
    };
    const delta = normalizedWheelDelta(event, bounds.height);
    const sensitivity = event.ctrlKey || event.metaKey
      ? MODIFIED_WHEEL_ZOOM_SENSITIVITY
      : WHEEL_ZOOM_SENSITIVITY;
    const factor = Math.max(
      MIN_WHEEL_ZOOM_FACTOR,
      Math.min(MAX_WHEEL_ZOOM_FACTOR, Math.exp(-delta * sensitivity))
    );
    const nextZoom = clampZoom(base.zoom * factor);
    const anchorX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const anchorY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const nextPan = anchorPreservingPan({
      anchorX,
      anchorY,
      containerWidth: bounds.width,
      containerHeight: bounds.height,
      currentZoom: base.zoom,
      nextZoom,
      currentPan: base.pan,
    });
    const scale = fitScale(
      bounds.width,
      bounds.height,
      currentPreview.width,
      currentPreview.height
    );
    pendingWheelZoomRef.current = {
      zoom: nextZoom,
      pan: nextPan,
      percent: Math.round(scale * nextZoom * 100),
    };
    if (wheelAnimationFrameRef.current) return;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      flushPendingWheelZoom();
      return;
    }
    wheelAnimationFrameRef.current = globalThis.requestAnimationFrame(flushPendingWheelZoom);
  }

  function resetFit() {
    clearTouchGesture({ flush: false, releaseCapture: true });
    cancelPendingPan(false);
    cancelPendingWheelZoom(false);
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    viewModeRef.current = "fit";
    setZoom(1);
    setZoomLabel("맞춤");
    setPan({ x: 0, y: 0 });
    setFeedback("레퍼런스를 화면에 맞췄습니다.");
  }

  function setActualSize() {
    if (!visiblePreview || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    const scale = fitScale(
      bounds.width,
      bounds.height,
      visiblePreview.width,
      visiblePreview.height
    );
    if (scale <= 0) return;
    clearTouchGesture({ flush: false, releaseCapture: true });
    cancelPendingPan(false);
    cancelPendingWheelZoom(false);
    const next = clampZoom(1 / scale);
    const percent = Math.round(scale * next * 100);
    zoomRef.current = next;
    panRef.current = { x: 0, y: 0 };
    viewModeRef.current = "actual";
    setZoom(next);
    setZoomLabel(`${percent}%`);
    setPan({ x: 0, y: 0 });
    setFeedback(percent === 100
      ? "레퍼런스를 원본 100% 크기로 표시합니다."
      : `창 크기 제한으로 원본을 ${percent}%로 표시합니다.`);
  }

  function adjustZoom(direction: 1 | -1) {
    if (!visiblePreview) return;
    clearTouchGesture({ flush: true, releaseCapture: true });
    cancelPendingWheelZoom(true);
    const next = clampZoom(
      zoomRef.current * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
    );
    const bounds = viewportRef.current?.getBoundingClientRect();
    const scale = bounds
      ? fitScale(bounds.width, bounds.height, visiblePreview.width, visiblePreview.height)
      : 0;
    const percent = Math.round((scale > 0 ? scale * next : next) * 100);
    zoomRef.current = next;
    viewModeRef.current = "custom";
    setZoom(next);
    setZoomLabel(`${percent}%`);
    setFeedback(`확대율 ${percent}%`);
  }

  function emitPick(point: StudioCompanionReferencePoint) {
    if (!pickerReady || !projection) return;
    const previous = pickCursorRef.current;
    const sequence = previous.generation === projection.generation
      && previous.referenceRevision === projection.referenceRevision
      ? previous.sequence + 1
      : 1;
    pickCursorRef.current = {
      generation: projection.generation,
      referenceRevision: projection.referenceRevision,
      sequence,
    };
    onControl({
      kind: "reference-pick-color",
      point,
      referenceRevision: projection.referenceRevision,
      sequence,
    });
    setFeedback(`색상 위치 ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%를 보냈습니다.`);
  }

  function togglePicker() {
    if (!pickerReady) return;
    const next = !pickerActive;
    setPickerActive(next);
    setFeedback(next ? "스포이드가 켜졌습니다." : "스포이드가 꺼졌습니다.");
    viewportRef.current?.focus();
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (
      !pickerActive
      || !pickerReady
      || !visiblePreview
      || event.button !== 0
      || event.detail > 1
    ) return;
    cancelPendingWheelZoom(true);
    const point = pointWithinImage({
      clientX: event.clientX,
      clientY: event.clientY,
      bounds: event.currentTarget.getBoundingClientRect(),
      imageWidth: visiblePreview.width,
      imageHeight: visiblePreview.height,
      zoom: zoomRef.current,
      pan: panRef.current,
    });
    if (!point) {
      setFeedback("합성된 이미지 안쪽에서 색을 선택해 주세요.");
      return;
    }
    emitPick(point);
  }

  function handleDoubleClick(event: MouseEvent<HTMLButtonElement>) {
    if (
      event.button !== 0
      || pickerActive
      || lastPointerTypeRef.current === "touch"
      || !visiblePreview
    ) return;
    event.preventDefault();
    cancelPendingPan(true);
    cancelPendingWheelZoom(true);
    if (viewModeRef.current === "actual") resetFit();
    else setActualSize();
  }

  function capturePointer(target: HTMLButtonElement, pointerId: number) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is an enhancement; local gestures still work while pointers remain here.
    }
  }

  function releasePointer(target: HTMLButtonElement, pointerId: number) {
    try {
      if (!target.hasPointerCapture || target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Browsers may release capture before pointerup/lostpointercapture.
    }
  }

  function beginPinch(target: HTMLButtonElement): boolean {
    const pointers = [...activeTouchPointersRef.current.entries()];
    if (pointers.length !== 2 || !connectedPreviewRef.current) return false;
    const [[firstId, first], [secondId, second]] = pointers;
    const startDistance = touchDistance(first, second);
    const bounds = target.getBoundingClientRect();
    if (
      !Number.isFinite(startDistance)
      || startDistance <= 0
      || bounds.width <= 0
      || bounds.height <= 0
    ) return false;
    cancelPendingPan(true);
    cancelPendingWheelZoom(true);
    cancelPendingPinchZoom(false);
    panSessionRef.current = null;
    pinchSessionRef.current = {
      pointerIds: [firstId, secondId],
      startDistance,
      startCentroid: touchCentroid(first, second),
      startZoom: zoomRef.current,
      startPan: { ...panRef.current },
      moved: false,
    };
    touchGestureWasPinchRef.current = true;
    suppressClickRef.current = true;
    setFeedback("두 손가락으로 확대하고 이동할 수 있습니다.");
    return true;
  }

  function updatePinch(target: HTMLButtonElement) {
    const session = pinchSessionRef.current;
    const currentPreview = connectedPreviewRef.current;
    if (!session || !currentPreview) return;
    const first = activeTouchPointersRef.current.get(session.pointerIds[0]);
    const second = activeTouchPointersRef.current.get(session.pointerIds[1]);
    if (!first || !second) return;
    const distance = touchDistance(first, second);
    const bounds = target.getBoundingClientRect();
    if (
      !Number.isFinite(distance)
      || distance <= 0
      || bounds.width <= 0
      || bounds.height <= 0
    ) return;
    const currentCentroid = touchCentroid(first, second);
    const nextZoom = clampZoom(session.startZoom * (distance / session.startDistance));
    const nextPan = pinchPreservingPan({
      startCentroid: {
        x: session.startCentroid.x - bounds.left,
        y: session.startCentroid.y - bounds.top,
      },
      currentCentroid: {
        x: currentCentroid.x - bounds.left,
        y: currentCentroid.y - bounds.top,
      },
      containerWidth: bounds.width,
      containerHeight: bounds.height,
      startZoom: session.startZoom,
      nextZoom,
      startPan: session.startPan,
    });
    const scale = fitScale(
      bounds.width,
      bounds.height,
      currentPreview.width,
      currentPreview.height
    );
    session.moved = session.moved
      || Math.abs(distance - session.startDistance) > 0.5
      || Math.abs(currentCentroid.x - session.startCentroid.x) > 0.5
      || Math.abs(currentCentroid.y - session.startCentroid.y) > 0.5;
    schedulePinchZoom({
      zoom: nextZoom,
      pan: nextPan,
      percent: Math.round(scale * nextZoom * 100),
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    lastPointerTypeRef.current = event.pointerType;
    if (event.pointerType === "touch") {
      const pointers = activeTouchPointersRef.current;
      if (!visiblePreview || connectionStatus !== "connected") return;
      if (!pickerActive || pointers.size > 0) event.preventDefault();
      if (!pointers.has(event.pointerId) && pointers.size >= 2) {
        suppressClickRef.current = true;
        setFeedback("핀치 확대는 두 손가락까지만 사용할 수 있습니다.");
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      capturePointer(event.currentTarget, event.pointerId);
      if (pointers.size === 2) {
        touchGestureWasPinchRef.current = true;
        suppressClickRef.current = true;
        cancelPendingPan(true);
        panSessionRef.current = null;
        if (!beginPinch(event.currentTarget)) {
          setFeedback("두 손가락 간격을 벌리면 핀치 확대가 시작됩니다.");
        }
        return;
      }
      touchGestureWasPinchRef.current = false;
      if (pickerActive) return;
      cancelPendingWheelZoom(true);
      suppressClickRef.current = true;
      panSessionRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        suppressPrimaryClick: true,
      };
      return;
    }

    if (panSessionRef.current) return;
    const shouldPan = event.button === 1
      || (event.button === 0 && spaceHeldRef.current);
    if (!shouldPan || !visiblePreview) return;
    event.preventDefault();
    cancelPendingWheelZoom(true);
    suppressClickRef.current = event.button === 0;
    panSessionRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      suppressPrimaryClick: event.button === 0,
    };
    capturePointer(event.currentTarget, event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const pointers = activeTouchPointersRef.current;
    if (pointers.has(event.pointerId)) {
      const shouldPrevent = pointers.size > 1
        || pinchSessionRef.current !== null
        || panSessionRef.current?.pointerId === event.pointerId;
      if (shouldPrevent) event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        if (!pinchSessionRef.current && !beginPinch(event.currentTarget)) return;
        updatePinch(event.currentTarget);
        return;
      }
    }

    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - session.x;
    const deltaY = event.clientY - session.y;
    if (deltaX === 0 && deltaY === 0) return;
    session.x = event.clientX;
    session.y = event.clientY;
    session.moved = true;
    schedulePan(deltaX, deltaY);
  }

  function finishTouchPointer(
    event: PointerEvent<HTMLButtonElement>,
    reason: "up" | "cancel" | "lost"
  ): boolean {
    const pointers = activeTouchPointersRef.current;
    if (!pointers.has(event.pointerId)) return false;
    const pinch = pinchSessionRef.current;
    const wasPinch = touchGestureWasPinchRef.current
      || Boolean(pinch?.pointerIds.includes(event.pointerId));
    const panSession = panSessionRef.current;
    if (wasPinch || panSession?.pointerId === event.pointerId) event.preventDefault();
    pointers.delete(event.pointerId);
    if (pinch) {
      cancelPendingPinchZoom(reason === "up");
      pinchSessionRef.current = null;
    }
    if (panSession?.pointerId === event.pointerId) {
      panSessionRef.current = null;
      cancelPendingPan(reason === "up");
      if (reason === "up" && panSession.moved && !wasPinch) {
        setFeedback("레퍼런스 위치를 옮겼습니다.");
      }
    }
    if (reason !== "lost") releasePointer(event.currentTarget, event.pointerId);

    const remaining = [...pointers.entries()];
    if (remaining.length === 1 && wasPinch && connectedPreviewRef.current) {
      const [pointerId, point] = remaining[0]!;
      panSessionRef.current = {
        pointerId,
        x: point.x,
        y: point.y,
        moved: false,
        suppressPrimaryClick: true,
      };
      suppressClickRef.current = true;
    } else if (remaining.length === 0) {
      if (wasPinch && reason === "up") {
        setFeedback("핀치 확대를 마쳤습니다. 한 손가락 이동으로 자연스럽게 이어집니다.");
      }
      touchGestureWasPinchRef.current = false;
      if (suppressClickRef.current) {
        globalThis.setTimeout(() => {
          if (activeTouchPointersRef.current.size === 0) suppressClickRef.current = false;
        }, 0);
      }
    }
    return true;
  }

  function releasePan(event: PointerEvent<HTMLButtonElement>) {
    if (finishTouchPointer(event, "up")) return;
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    panSessionRef.current = null;
    cancelPendingPan(true);
    if (session.moved) setFeedback("레퍼런스 위치를 옮겼습니다.");
    if (session.suppressPrimaryClick) {
      globalThis.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    releasePointer(event.currentTarget, event.pointerId);
  }

  function cancelPan(event: PointerEvent<HTMLButtonElement>) {
    if (finishTouchPointer(event, "cancel")) return;
    if (panSessionRef.current?.pointerId !== event.pointerId) return;
    panSessionRef.current = null;
    cancelPendingPan(false);
    suppressClickRef.current = false;
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
    if (finishTouchPointer(event, "lost")) return;
    if (panSessionRef.current?.pointerId !== event.pointerId) return;
    panSessionRef.current = null;
    cancelPendingPan(false);
    suppressClickRef.current = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
        setFeedback("드래그하여 레퍼런스를 이동할 수 있습니다.");
      }
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      resetFit();
    } else if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
      event.preventDefault();
      adjustZoom(1);
    } else if (event.key === "-" || event.code === "NumpadSubtract") {
      event.preventDefault();
      adjustZoom(-1);
    } else if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      togglePicker();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearTouchGesture({ flush: false, releaseCapture: true });
      panSessionRef.current = null;
      cancelPendingPan(false);
      cancelPendingWheelZoom(false);
      suppressClickRef.current = false;
      setPickerActive(false);
      setFeedback("스포이드와 이동 조작을 취소했습니다.");
    } else if (event.key === "Enter" && pickerActive && pickerReady) {
      event.preventDefault();
      emitPick({ x: 0.5, y: 0.5 });
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.code !== "Space") return;
    spaceHeldRef.current = false;
    setSpaceHeld(false);
  }

  const connectionLabel = connectionStatus === "connected"
    ? "연결됨"
    : connectionStatus === "reconnecting"
      ? "재연결 중"
      : "연결 끊김";
  const showStateOverlay = displayState !== "ready" && displayState !== "partial";

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5"
      data-reference-state={displayState}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-sm font-semibold text-fg">
            레퍼런스 전용 화면
          </h2>
          <p id={helpId} className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
            <span className="[@media(pointer:coarse)]:hidden">
              휠 확대 · 더블 클릭 맞춤/100% · Space+드래그 이동 · I 스포이드
            </span>
            <span className="hidden [@media(pointer:coarse)]:inline">
              두 손가락 확대 · 한 손가락 이동 · I 스포이드
            </span>
          </p>
        </div>
        <span
          className={cn(
            "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.65rem] font-semibold",
            connectionStatus === "connected" && "border-good/35 bg-good/10 text-good",
            connectionStatus === "reconnecting" && "border-warn/35 bg-warn/10 text-warn",
            connectionStatus === "disconnected" && "border-line bg-raised text-fg-3"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              connectionStatus === "connected" && "bg-good",
              connectionStatus === "reconnecting" && "bg-warn motion-safe:animate-pulse",
              connectionStatus === "disconnected" && "bg-fg-3"
            )}
          />
          {connectionLabel}
        </span>
      </div>

      <div
        role="toolbar"
        aria-label="레퍼런스 보기 도구"
        className="grid min-w-0 grid-cols-5 gap-1.5 rounded-xl border border-line/80 bg-card p-1.5"
      >
        <button
          type="button"
          aria-label="화면에 맞춤"
          aria-keyshortcuts="0"
          disabled={!visiblePreview}
          onClick={resetFit}
          className={cn(toolButtonClass, "bg-raised text-fg-2 hover:border-line-strong hover:text-fg")}
        >
          <Maximize2 className="size-4" aria-hidden />
          <span className="sr-only min-[390px]:not-sr-only">맞춤</span>
        </button>
        <button
          type="button"
          aria-label="축소"
          aria-keyshortcuts="-"
          disabled={!visiblePreview || zoom <= MIN_ZOOM}
          onClick={() => adjustZoom(-1)}
          className={cn(toolButtonClass, "bg-raised text-fg-2 hover:border-line-strong hover:text-fg")}
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="원본 100% 크기"
          disabled={!visiblePreview}
          onClick={setActualSize}
          className={cn(
            toolButtonClass,
            "tabular-nums",
            zoomLabel === "100%"
              ? "border-accent/45 bg-accent-soft text-fg"
              : "bg-raised text-fg-2 hover:border-line-strong hover:text-fg"
          )}
        >
          {zoomLabel}
        </button>
        <button
          type="button"
          aria-label="확대"
          aria-keyshortcuts="+"
          disabled={!visiblePreview || zoom >= MAX_ZOOM}
          onClick={() => adjustZoom(1)}
          className={cn(toolButtonClass, "bg-raised text-fg-2 hover:border-line-strong hover:text-fg")}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="스포이드"
          aria-keyshortcuts="I"
          aria-pressed={pickerActive}
          disabled={!pickerReady}
          onClick={togglePicker}
          className={cn(
            toolButtonClass,
            pickerActive
              ? "border-accent/55 bg-accent text-on-accent"
              : "bg-raised text-fg-2 hover:border-line-strong hover:text-fg"
          )}
        >
          <Pipette className="size-4" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        ref={viewportRef}
        aria-label="합성된 레퍼런스 보드"
        aria-describedby={`${helpId} ${statusId}`}
        aria-keyshortcuts="0 + - I Escape Enter Space"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePan}
        onPointerCancel={cancelPan}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={() => {
          spaceHeldRef.current = false;
          setSpaceHeld(false);
          clearTouchGesture({ flush: true, releaseCapture: true });
          panSessionRef.current = null;
          cancelPendingPan(false);
          cancelPendingWheelZoom(true);
          suppressClickRef.current = false;
        }}
        onContextMenu={(event) => {
          if (spaceHeld || pickerActive) event.preventDefault();
        }}
        className={cn(
          "relative grid min-h-64 flex-1 place-items-center overflow-hidden rounded-xl border bg-[oklch(0.145_0.008_70)] outline-none",
          "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35",
          "motion-reduce:scroll-auto",
          spaceHeld
            ? "cursor-grab border-line-strong active:cursor-grabbing"
            : pickerActive && pickerReady
              ? "cursor-crosshair border-accent/45"
              : "cursor-default border-line"
        )}
        style={{ touchAction: touchGesturesReady ? "none" : "pan-y" }}
      >
        {visiblePreview ? (
          <img
            src={visiblePreview.url}
            alt="합성된 레퍼런스 보드 미리보기"
            draggable={false}
            className={cn(
              "pointer-events-none absolute inset-0 size-full select-none object-contain",
              "transition-opacity duration-150 motion-reduce:transition-none",
              connectionStatus === "connected" ? "opacity-100" : "opacity-45"
            )}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: "center",
            }}
          />
        ) : null}

        {pickerActive && pickerReady ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-fg/80 bg-panel/65 text-fg shadow-sm"
          >
            <span className="size-1 rounded-full bg-accent" />
          </span>
        ) : null}

        {showStateOverlay ? (
          <span className="relative z-10 flex max-w-64 flex-col items-center px-5 text-center">
            <span className="grid size-11 place-items-center rounded-xl border border-line bg-card text-fg-3">
              {displayState === "disconnected" ? (
                <Unplug className="size-5" aria-hidden />
              ) : displayState === "reconnecting" ? (
                <RefreshCw className="size-5" aria-hidden />
              ) : (
                <ImageIcon className="size-5" aria-hidden />
              )}
            </span>
            <strong className="mt-3 text-xs font-semibold text-fg-2">{copy.title}</strong>
            <span className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">{copy.detail}</span>
            {displayState === "loading" ? (
              <span
                aria-hidden
                className="mt-3 h-1 w-24 overflow-hidden rounded-full bg-raised after:block after:h-full after:w-1/2 after:rounded-full after:bg-accent motion-safe:after:animate-pulse"
              />
            ) : null}
          </span>
        ) : null}
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "min-w-0 flex-1 text-[0.68rem] leading-relaxed",
            displayState === "partial" ? "text-warn" : "text-fg-3"
          )}
        >
          {displayState === "partial" && projection
            ? `${copy.title} · ${projection.resolvedItemCount}/${projection.itemCount} · ${colorResult
                ? `선택한 색 ${colorResult.color.toUpperCase()}`
                : feedback}`
            : displayState === "ready"
              ? colorResult
                ? `선택한 색 ${colorResult.color.toUpperCase()}`
                : feedback
              : copy.title}
        </p>

        {colorResult ? (
          <output
            aria-label={`최근 선택 색상 ${colorResult.color.toUpperCase()}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-card px-2 text-[0.65rem] font-semibold text-fg-2"
          >
            <span
              aria-hidden
              className="size-5 rounded-md border border-line-strong"
              style={{ backgroundColor: colorResult.color }}
            />
            <span className="max-[359px]:sr-only">{colorResult.color.toUpperCase()}</span>
          </output>
        ) : (
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 px-1 text-[0.65rem] text-fg-3">
            <Move className="size-3.5" aria-hidden />
            <span className="max-[359px]:sr-only">보기 전용</span>
          </span>
        )}
      </div>
    </section>
  );
}

export default StudioCompanionReferenceDisplay;
