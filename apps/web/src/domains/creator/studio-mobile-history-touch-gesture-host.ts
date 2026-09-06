/**
 * 모바일 두/세 손가락 탭 제스처(실행 취소·UI 토글)를 캔버스 래퍼에 붙이는 훅.
 * StudioCuttoonEditorHost 에서 통째로 옮겨온 이펙트로, 호스트 로컬은 다섯 개(래퍼 ref, 모바일
 * 여부, 포인터 소유 판정, 앱 설정 ref, 제스처 동작 ref)만 받는다. 동작은 추출 전과 동일하다 —
 * 캔버스 포인터 제스처가 이미 소유 중이거나 뷰 도구 HUD 를 눌렀으면 후보를 버리고, 손가락이
 * 12px 넘게 움직였거나 320ms 를 넘기면 탭으로 치지 않는다.
 */

import { useEffect } from "react";

import { isStudioViewToolsHudEventTarget } from "./studio-page-shell-runtime";

import type { StudioAppSettings } from "./studio-app-settings";
import type { RefObject } from "react";

/** 제스처가 부를 동작. 호스트가 매 렌더 갱신하는 ref 로 넘어와 최신 클로저를 본다. */
export type StudioMobileHistoryGestureActions = {
  undo: () => void;
  toggleUi: () => void;
};

export function useStudioMobileHistoryTouchGestures({
  surfaceRef,
  isMobile,
  canvasPointerGestureIsOwned,
  appSettingsRef,
  gestureRef,
}: {
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly isMobile: boolean;
  readonly canvasPointerGestureIsOwned: () => boolean;
  readonly appSettingsRef: RefObject<StudioAppSettings>;
  readonly gestureRef: RefObject<StudioMobileHistoryGestureActions>;
}): void {
  // 세 ref 는 호스트가 한 번 만든 useRef 객체라 정체성이 바뀌지 않는다 — 의존성 배열에 적혀 있어도
  // 실제 재구독 조건은 추출 전과 같은 `isMobile` 과 포인터 소유 판정 두 가지뿐이다.
  useEffect(() => {
    const node = surfaceRef.current;
    if (!isMobile || !node) return;
    let candidate: {
      count: 2 | 3;
      startedAt: number;
      points: Map<number, { x: number; y: number }>;
      moved: boolean;
    } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      if (isStudioViewToolsHudEventTarget(event.target)) {
        candidate = null;
        return;
      }
      if (canvasPointerGestureIsOwned()) {
        candidate = null;
        return;
      }
      if (event.touches.length !== 2 && event.touches.length !== 3) {
        candidate = null;
        return;
      }
      const touchPrefs = appSettingsRef.current.touch;
      if (
        (event.touches.length === 2 && touchPrefs.twoFinger !== "undo-redo")
        || (event.touches.length === 3 && touchPrefs.threeFinger === "none")
      ) {
        candidate = null;
        return;
      }
      candidate = {
        count: event.touches.length,
        startedAt: performance.now(),
        points: new Map(
          Array.from(event.touches).map((touch) => [
            touch.identifier,
            { x: touch.clientX, y: touch.clientY },
          ])
        ),
        moved: false,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!candidate || event.touches.length !== candidate.count) {
        candidate = null;
        return;
      }
      for (const touch of Array.from(event.touches)) {
        const start = candidate.points.get(touch.identifier);
        if (!start || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) {
          candidate.moved = true;
          break;
        }
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!candidate) return;
      if (event.touches.length > 0) return;
      const completed = !candidate.moved && performance.now() - candidate.startedAt <= 320;
      const count = candidate.count;
      candidate = null;
      if (!completed) return;
      event.preventDefault();
      const touchPrefs = appSettingsRef.current.touch;
      if (count === 2 && touchPrefs.twoFinger === "undo-redo") {
        gestureRef.current.undo();
      } else if (count === 3 && touchPrefs.threeFinger === "undo") {
        gestureRef.current.undo();
      } else if (count === 3 && touchPrefs.threeFinger === "toggle-ui") {
        gestureRef.current.toggleUi();
      } else {
        return;
      }
      if (typeof globalThis.navigator?.vibrate === "function") globalThis.navigator.vibrate(8);
    };
    const onTouchCancel = () => {
      candidate = null;
    };
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: false });
    node.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [isMobile, canvasPointerGestureIsOwned, surfaceRef, appSettingsRef, gestureRef]);
}
