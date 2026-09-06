import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { CANVAS_W } from "../studio-assets";
import { clampZoom } from "../studio-page-shell-runtime";
import {
  clampStudioViewZoomGestureAnchor,
  planStudioViewZoomGestureFrame,
  projectStudioDocumentPointToView,
  projectStudioViewPointToDocument,
  type StudioViewRotation,
} from "../studio-view-controls";

/**
 * In-flight wheel/pinch gesture bookkeeping. Lives entirely in refs — the gesture
 * paints through a CSS transform on the zoom host and only settles into React state
 * once, when the gesture goes quiet.
 */
export interface StudioZoomGestureState {
  baseZoom: number;
  targetZoom: number;
  originClientX: number;
  originClientY: number;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  baseLeft: number;
  baseTop: number;
  baseWidth: number;
  baseHeight: number;
  wrapLeft: number;
  wrapTop: number;
  viewportWidth: number;
  viewportHeight: number;
  raf: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

export type StudioZoomGestureStep = (
  nextTarget: (target: number) => number,
  clientX: number,
  clientY: number,
  options?: {
    followClient?: boolean;
    originClientX?: number;
    originClientY?: number;
  }
) => void;

/** 문서 기하 — 정착 앵커 투영이 렌더 시점 값을 그대로 본다(매 렌더 재설치). */
interface StudioZoomGestureGeometry {
  readonly canvasH: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
  readonly studioViewDocumentWidth: number;
}

/** 페이지가 소유한 제스처 refs — 휠/핀치 핸들러와 소유권 검사가 안정 참조로 읽는다. */
interface StudioZoomGestureRefs {
  readonly wrapRef: { readonly current: HTMLDivElement | null };
  readonly updateScrollPosRef: { readonly current: () => void };
  readonly zoomRef: { readonly current: number };
  readonly zoomHostRef: { readonly current: HTMLDivElement | null };
  readonly zoomGestureRef: MutableRefObject<StudioZoomGestureState | null>;
  readonly zoomSettleAnchorRef: MutableRefObject<{
    docX: number;
    docY: number;
    clientX: number;
    clientY: number;
  } | null>;
  readonly settleZoomGestureRef: MutableRefObject<() => void>;
  readonly stepZoomGestureRef: MutableRefObject<StudioZoomGestureStep>;
}

/**
 * 휠·핀치 줌 제스처는 리렌더 없이 캔버스 호스트에 CSS transform 만 걸어 즉시 반응하고,
 * 제스처가 잦아들면(마지막 틱 후 ~170ms) 한 번만 zoom 상태로 정착한다. 정착 시에는 제스처
 * 앵커(포인터 아래 문서점)가 그대로 유지되도록 스크롤을 보정한다. 틱마다 setZoom 을 부르면
 * 에디터 전체가 틱당 한 번씩 다시 그려져 연속 휠이 초 단위로 밀리는 것을 계측으로 확인했다.
 */
function installStudioZoomGestureHandlers(
  refs: StudioZoomGestureRefs,
  geometry: StudioZoomGestureGeometry,
  setZoom: (action: SetStateAction<number>) => void,
): void {
  const {
    wrapRef,
    updateScrollPosRef,
    zoomRef,
    zoomHostRef,
    zoomGestureRef,
    zoomSettleAnchorRef,
    settleZoomGestureRef,
    stepZoomGestureRef,
  } = refs;
  const { canvasH, canvasFlipH, canvasRotation, studioViewDocumentWidth } = geometry;
  settleZoomGestureRef.current = () => {
    const gesture = zoomGestureRef.current;
    zoomGestureRef.current = null;
    if (!gesture) return;
    if (gesture.raf) globalThis.cancelAnimationFrame(gesture.raf);
    if (gesture.settleTimer) globalThis.clearTimeout(gesture.settleTimer);
    const host = zoomHostRef.current;
    const translated = gesture.clientX !== gesture.originClientX
      || gesture.clientY !== gesture.originClientY;
    if (gesture.targetZoom === gesture.baseZoom && !translated) {
      if (host) {
        host.style.transform = "";
        host.style.willChange = "";
      }
      return;
    }
    const effBase = gesture.baseWidth / studioViewDocumentWidth;
    const documentPoint = effBase > 0
      ? projectStudioViewPointToDocument({
          documentWidth: CANVAS_W,
          documentHeight: canvasH,
          canvasFlipH,
          canvasRotation,
          x: gesture.originX / effBase,
          y: gesture.originY / effBase,
        })
      : null;
    const settleAnchor = documentPoint
      ? {
          docX: documentPoint.x,
          docY: documentPoint.y,
          clientX: gesture.clientX,
          clientY: gesture.clientY,
        }
      : null;
    zoomSettleAnchorRef.current = settleAnchor;
    if (gesture.targetZoom === gesture.baseZoom) {
      if (host) {
        host.style.transform = "";
        host.style.willChange = "";
      }
      const wrap = wrapRef.current;
      if (!settleAnchor || !host || !wrap) {
        zoomSettleAnchorRef.current = null;
        return;
      }
      const effNow = host.clientWidth / studioViewDocumentWidth;
      if (!(effNow > 0)) {
        zoomSettleAnchorRef.current = null;
        return;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const projected = projectStudioDocumentPointToView({
        documentWidth: CANVAS_W,
        documentHeight: canvasH,
        canvasFlipH,
        canvasRotation,
        x: settleAnchor.docX,
        y: settleAnchor.docY,
      });
      wrap.scrollLeft = Math.max(
        0,
        projected.x * effNow - (settleAnchor.clientX - wrapRect.left)
      );
      wrap.scrollTop = Math.max(
        0,
        projected.y * effNow - (settleAnchor.clientY - wrapRect.top)
      );
      zoomSettleAnchorRef.current = null;
      updateScrollPosRef.current();
      return;
    }
    setZoom(clampZoom(gesture.targetZoom));
  };
  stepZoomGestureRef.current = (nextTarget, clientX, clientY, options) => {
    const host = zoomHostRef.current;
    if (!host) {
      setZoom((z) => clampZoom(nextTarget(z)));
      return;
    }
    let gesture = zoomGestureRef.current;
    if (!gesture) {
      const rect = host.getBoundingClientRect();
      const wrap = wrapRef.current;
      const wrapRect = wrap?.getBoundingClientRect() ?? rect;
      const baseZoom = zoomRef.current;
      const anchor = clampStudioViewZoomGestureAnchor(
        rect,
        options?.originClientX ?? clientX,
        options?.originClientY ?? clientY
      );
      gesture = {
        baseZoom,
        targetZoom: baseZoom,
        originClientX: anchor.clientX,
        originClientY: anchor.clientY,
        originX: anchor.originX,
        originY: anchor.originY,
        clientX: anchor.clientX,
        clientY: anchor.clientY,
        baseLeft: rect.left,
        baseTop: rect.top,
        baseWidth: rect.width,
        baseHeight: rect.height,
        wrapLeft: wrapRect.left,
        wrapTop: wrapRect.top,
        viewportWidth: wrap?.clientWidth ?? rect.width,
        viewportHeight: wrap?.clientHeight ?? rect.height,
        raf: 0,
        settleTimer: null,
      };
      zoomGestureRef.current = gesture;
    }
    if (options?.followClient) {
      gesture.clientX = Number.isFinite(clientX) ? clientX : gesture.clientX;
      gesture.clientY = Number.isFinite(clientY) ? clientY : gesture.clientY;
    }
    gesture.targetZoom = clampZoom(nextTarget(gesture.targetZoom));
    if (!gesture.raf) {
      gesture.raf = globalThis.requestAnimationFrame(() => {
        const active = zoomGestureRef.current;
        const activeHost = zoomHostRef.current;
        if (!active) return;
        active.raf = 0;
        if (!activeHost) return;
        const frame = planStudioViewZoomGestureFrame(active);
        activeHost.style.transformOrigin = `${active.originX}px ${active.originY}px`;
        activeHost.style.transform = frame.scale === 1
            && frame.translateX === 0
            && frame.translateY === 0
          ? ""
          : `translate(${frame.translateX}px, ${frame.translateY}px) scale(${frame.scale})`;
        activeHost.style.willChange = "transform";
      });
    }
    if (gesture.settleTimer) globalThis.clearTimeout(gesture.settleTimer);
    gesture.settleTimer = globalThis.setTimeout(() => settleZoomGestureRef.current(), 170);
  };
}

/**
 * 외부 setZoom(버튼/단축키/맞춤)이 제스처 중에 끼어들면 제스처를 취소하고 transform 을 정리한
 * 뒤, 정착 레이아웃에서 제스처 포인터 아래에 같은 문서점이 오도록 스크롤을 보정한다(앵커 보존 줌).
 */
function settleStudioZoomViewAfterRender(
  refs: Pick<
    StudioZoomGestureRefs,
    "wrapRef" | "zoomHostRef" | "zoomGestureRef" | "zoomSettleAnchorRef"
  >,
  geometry: StudioZoomGestureGeometry,
): void {
  const { wrapRef, zoomHostRef, zoomGestureRef, zoomSettleAnchorRef } = refs;
  const { canvasH, canvasFlipH, canvasRotation, studioViewDocumentWidth } = geometry;
  const gesture = zoomGestureRef.current;
  if (gesture) {
    zoomGestureRef.current = null;
    if (gesture.raf) globalThis.cancelAnimationFrame(gesture.raf);
    if (gesture.settleTimer) globalThis.clearTimeout(gesture.settleTimer);
  }
  const host = zoomHostRef.current;
  if (host) {
    host.style.transform = "";
    host.style.willChange = "";
  }
  const anchor = zoomSettleAnchorRef.current;
  const wrap = wrapRef.current;
  if (!anchor) return;
  zoomSettleAnchorRef.current = null;
  if (!host || !wrap) return;
  const effNow = host.clientWidth / studioViewDocumentWidth;
  if (!(effNow > 0)) return;
  const wrapRect = wrap.getBoundingClientRect();
  const projected = projectStudioDocumentPointToView({
    documentWidth: CANVAS_W,
    documentHeight: canvasH,
    canvasFlipH,
    canvasRotation,
    x: anchor.docX,
    y: anchor.docY,
  });
  wrap.scrollLeft = Math.max(0, projected.x * effNow - (anchor.clientX - wrapRect.left));
  wrap.scrollTop = Math.max(0, projected.y * effNow - (anchor.clientY - wrapRect.top));
}

/** 언마운트 시 진행 중 제스처의 raf/settle 타이머를 정리한다. */
function releaseStudioZoomGestureOnUnmount(
  zoomGestureRef: MutableRefObject<StudioZoomGestureState | null>,
): void {
  const gesture = zoomGestureRef.current;
  zoomGestureRef.current = null;
  if (!gesture) return;
  if (gesture.raf) globalThis.cancelAnimationFrame(gesture.raf);
  if (gesture.settleTimer) globalThis.clearTimeout(gesture.settleTimer);
}

/**
 * Page-owned zoom gesture surface plus the document geometry the settle projection
 * reads. The refs stay declared on StudioPage so wheel/pinch handlers and gesture
 * ownership checks keep compiler-provably stable identities.
 */
export interface StudioZoomGestureEngineContext extends StudioZoomGestureRefs {
  readonly canvasH: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
  readonly studioViewDocumentWidth: number;
  readonly zoomLockedRef: { readonly current: boolean };
}

export interface StudioZoomGestureEngine {
  readonly zoom: number;
  readonly setZoom: (action: SetStateAction<number>) => void;
  readonly zoomLocked: boolean;
  readonly setZoomLocked: Dispatch<SetStateAction<boolean>>;
}

/**
 * Ref-driven zoom gesture engine extracted from StudioPage. Behavior-identical move:
 * wheel/pinch ticks mutate refs and repaint the host through `stepZoomGestureRef`
 * without a single React state read on the hot path — the page only re-renders when a
 * gesture settles (`settleZoomGestureRef` → one `setZoom`). The handler refs are
 * reassigned every render (effect without a dependency array) so the settle closure
 * observes the current document geometry, exactly as before extraction. Every ref
 * write flows through the module helpers above so the hot path stays outside the
 * compiler's memoization scope.
 */
export function useStudioZoomGestureEngine(
  ctx: StudioZoomGestureEngineContext,
): StudioZoomGestureEngine {
  const {
    canvasH,
    canvasFlipH,
    canvasRotation,
    studioViewDocumentWidth,
    wrapRef,
    updateScrollPosRef,
    zoomLockedRef,
    zoomRef,
    zoomHostRef,
    zoomGestureRef,
    zoomSettleAnchorRef,
    settleZoomGestureRef,
    stepZoomGestureRef,
  } = ctx;
  // 사용자 줌(폭맞춤 스케일에 곱함). effScale로 Stage·내보내기 해상도를 함께 보정.
  const [zoom, setZoomState] = useState(1);
  const [zoomLocked, setZoomLocked] = useState(false);
  const setZoom = useCallback((action: SetStateAction<number>) => {
    if (zoomLockedRef.current) return;
    setZoomState(action);
  }, [zoomLockedRef]);
  useEffect(() => {
    installStudioZoomGestureHandlers(
      {
        wrapRef,
        updateScrollPosRef,
        zoomRef,
        zoomHostRef,
        zoomGestureRef,
        zoomSettleAnchorRef,
        settleZoomGestureRef,
        stepZoomGestureRef,
      },
      { canvasH, canvasFlipH, canvasRotation, studioViewDocumentWidth },
      setZoom,
    );
  });
  useLayoutEffect(() => {
    settleStudioZoomViewAfterRender(
      { wrapRef, zoomHostRef, zoomGestureRef, zoomSettleAnchorRef },
      { canvasH, canvasFlipH, canvasRotation, studioViewDocumentWidth },
    );
  }, [
    canvasFlipH,
    canvasH,
    canvasRotation,
    studioViewDocumentWidth,
    wrapRef,
    zoom,
    zoomGestureRef,
    zoomHostRef,
    zoomSettleAnchorRef,
  ]);
  useEffect(() => () => {
    releaseStudioZoomGestureOnUnmount(zoomGestureRef);
  }, [zoomGestureRef]);
  return {
    zoom,
    setZoom,
    zoomLocked,
    setZoomLocked,
  };
}
