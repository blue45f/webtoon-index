import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";


import type { StudioAdvancedFillPreview } from "./studio-advanced-fill-preview";
import type { StudioAdvancedFillTapGesture } from "./studio-advanced-fill-tap";
import type { Tool } from "./studio-editor-tool-model";
import type { SelectionFrame } from "./studio-selection-tools";
import type { StudioAdvancedFillVirtualTarget } from "./studio-vector-fill-reference";

/** 진행 중 계산·탭 제스처를 소유하는 페이지 refs — 무효화 헬퍼들이 공유한다. */
interface StudioAdvancedFillRunRefs {
  readonly advancedFillRunIdRef: MutableRefObject<number>;
  readonly advancedFillAbortRef: MutableRefObject<AbortController | null>;
  readonly advancedFillTapGestureRef: MutableRefObject<StudioAdvancedFillTapGesture | null>;
  readonly advancedFillTapPayloadRef: MutableRefObject<{
    position: { x: number; y: number };
    frame: SelectionFrame;
  } | null>;
  readonly advancedFillTouchPanRef: MutableRefObject<{
    pointerId: number;
    last: { x: number; y: number };
  } | null>;
}

/** 진행 중 계산 무효화 — run 토큰 전진 + abort + abort 슬롯 비움(원본 3줄과 동일). */
function invalidateStudioAdvancedFillRun(refs: StudioAdvancedFillRunRefs): void {
  refs.advancedFillRunIdRef.current += 1;
  refs.advancedFillAbortRef.current?.abort();
  refs.advancedFillAbortRef.current = null;
}

/** 탭/터치 팬 제스처 상태를 비운다(원본 3줄과 동일). */
function clearStudioAdvancedFillGesture(refs: StudioAdvancedFillRunRefs): void {
  refs.advancedFillTapGestureRef.current = null;
  refs.advancedFillTapPayloadRef.current = null;
  refs.advancedFillTouchPanRef.current = null;
}

/** 자동 무장 토큰을 꺼내며 비운다 — 정확히 한 번만 통과시키는 원본 계약. */
function takeStudioAdvancedFillAutoArmTarget(
  ref: MutableRefObject<{
    targetId: string;
    status: string;
    virtualTarget?: StudioAdvancedFillVirtualTarget;
  } | null>,
): {
  targetId: string;
  status: string;
  virtualTarget?: StudioAdvancedFillVirtualTarget;
} | null {
  const pendingAutoArm = ref.current;
  ref.current = null;
  return pendingAutoArm;
}

/** 가상 타깃 참조 캐시를 비운다. */
function clearStudioAdvancedFillVirtualReference(
  ref: MutableRefObject<{ fingerprint: string; dataUrl: string } | null>,
): void {
  ref.current = null;
}

/** 채우기 색상 ref 동기화 — 바뀌었을 때만 true(원본의 조기 return 가드와 동일). */
function syncStudioAdvancedFillColor(
  ref: MutableRefObject<string>,
  color: string,
): boolean {
  if (ref.current === color) return false;
  ref.current = color;
  return true;
}

/** 언마운트 정리 — 원본과 동일하게 abort 슬롯은 비우지 않는다(재사용 없음). */
function abortStudioAdvancedFillOnUnmount(refs: StudioAdvancedFillRunRefs): void {
  refs.advancedFillRunIdRef.current += 1;
  refs.advancedFillAbortRef.current?.abort();
  refs.advancedFillTapGestureRef.current = null;
  refs.advancedFillTapPayloadRef.current = null;
  refs.advancedFillTouchPanRef.current = null;
}

/**
 * Page-owned advanced-fill session surface. State, setters and refs stay declared on
 * StudioPage (they are read/written by many command paths and by hot-path gesture
 * ownership checks that must remain compiler-provably stable); this hook owns only
 * the invalidation/cleanup effects. Every ctx member is referentially stable
 * (useState setters and useRef boxes), so the extended dependency arrays below fire
 * exactly when the original page-local effects did.
 */
export interface StudioAdvancedFillContext extends StudioAdvancedFillRunRefs {
  readonly activePageId: string;
  readonly selectedId: string | null;
  readonly tool: Tool;
  readonly color: string;
  readonly advancedFillActive: boolean;
  readonly setAdvancedFillActive: Dispatch<SetStateAction<boolean>>;
  readonly advancedFillBusy: boolean;
  readonly setAdvancedFillBusy: Dispatch<SetStateAction<boolean>>;
  readonly advancedFillPreview: StudioAdvancedFillPreview | null;
  readonly setAdvancedFillPreview: Dispatch<SetStateAction<StudioAdvancedFillPreview | null>>;
  readonly setAdvancedFillVirtualTarget: Dispatch<
    SetStateAction<StudioAdvancedFillVirtualTarget | null>
  >;
  readonly setAdvancedFillStatus: Dispatch<SetStateAction<string | null>>;
  readonly advancedFillAutoArmTargetRef: MutableRefObject<{
    targetId: string;
    status: string;
    virtualTarget?: StudioAdvancedFillVirtualTarget;
  } | null>;
  readonly advancedFillColorRef: MutableRefObject<string>;
  readonly advancedFillVirtualReferenceRef: MutableRefObject<{
    fingerprint: string;
    dataUrl: string;
  } | null>;
}

/**
 * Advanced fill (lasso fill / paint-bucket) session effects extracted from StudioPage.
 * Behavior-identical move: page/selection reset with auto-arm replay, tool-transition
 * and color-change invalidation, and unmount cleanup are verbatim (ref writes flow
 * through the module helpers above); the settings hydration effect and the
 * arm/run/apply commands stay on StudioPage and mutate the same page-owned state
 * through these setters and refs exactly as before.
 */
export function useStudioAdvancedFill(ctx: StudioAdvancedFillContext): void {
  const {
    activePageId,
    selectedId,
    tool,
    color,
    advancedFillActive,
    setAdvancedFillActive,
    advancedFillBusy,
    setAdvancedFillBusy,
    advancedFillPreview,
    setAdvancedFillPreview,
    setAdvancedFillVirtualTarget,
    setAdvancedFillStatus,
    advancedFillRunIdRef,
    advancedFillAbortRef,
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillAutoArmTargetRef,
    advancedFillTouchPanRef,
    advancedFillColorRef,
    advancedFillVirtualReferenceRef,
  } = ctx;
  useEffect(() => {
    void activePageId;
    void selectedId;
    const pendingAutoArm = takeStudioAdvancedFillAutoArmTarget(advancedFillAutoArmTargetRef);
    invalidateStudioAdvancedFillRun({
      advancedFillRunIdRef,
      advancedFillAbortRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    });
    clearStudioAdvancedFillGesture({
      advancedFillRunIdRef,
      advancedFillAbortRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    });
    setAdvancedFillActive(false);
    setAdvancedFillBusy(false);
    setAdvancedFillPreview(null);
    setAdvancedFillVirtualTarget(null);
    clearStudioAdvancedFillVirtualReference(advancedFillVirtualReferenceRef);
    setAdvancedFillStatus(null);
    if (pendingAutoArm?.targetId === selectedId) {
      if (pendingAutoArm.virtualTarget) {
        setAdvancedFillVirtualTarget(pendingAutoArm.virtualTarget);
      }
      setAdvancedFillActive(true);
      setAdvancedFillStatus(pendingAutoArm.status);
    }
  }, [
    activePageId,
    selectedId,
    advancedFillAbortRef,
    advancedFillAutoArmTargetRef,
    advancedFillRunIdRef,
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    advancedFillVirtualReferenceRef,
    setAdvancedFillActive,
    setAdvancedFillBusy,
    setAdvancedFillPreview,
    setAdvancedFillStatus,
    setAdvancedFillVirtualTarget,
  ]);
  useEffect(() => {
    if (tool === "select" || (!advancedFillActive && !advancedFillBusy && !advancedFillPreview)) return;
    invalidateStudioAdvancedFillRun({
      advancedFillRunIdRef,
      advancedFillAbortRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    });
    clearStudioAdvancedFillGesture({
      advancedFillRunIdRef,
      advancedFillAbortRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    });
    setAdvancedFillActive(false);
    setAdvancedFillBusy(false);
    // 도구 전환은 **진행 중 계산**만 버린다. 이미 계산이 끝나 사용자의 적용/취소를 기다리는
    // 미리보기는 남긴다 — `disarmAllPixelTools` 와 같은 계약이다(그쪽 주석이 근거).
    // 예전에는 여기서도 미리보기를 지웠는데, 실제로는 disarm 이 같은 이벤트에서 먼저 지워
    // 이 안내 문구조차 뜨지 않았다. 이제 두 경로 모두 미리보기를 살려 둔다.
    if (advancedFillPreview) {
      setAdvancedFillStatus(
        "다른 도구로 전환했어요. 채우기 미리보기는 아직 적용하거나 취소할 수 있어요.",
      );
      return;
    }
    setAdvancedFillVirtualTarget(null);
    clearStudioAdvancedFillVirtualReference(advancedFillVirtualReferenceRef);
    setAdvancedFillStatus("다른 도구로 전환해 고급 채우기 계산을 취소했습니다.");
  }, [
    tool,
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreview,
    advancedFillAbortRef,
    advancedFillRunIdRef,
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    advancedFillVirtualReferenceRef,
    setAdvancedFillActive,
    setAdvancedFillBusy,
    setAdvancedFillStatus,
    setAdvancedFillVirtualTarget,
  ]);
  useEffect(() => {
    if (!syncStudioAdvancedFillColor(advancedFillColorRef, color)) return;
    if (!advancedFillBusy && !advancedFillPreview) return;
    invalidateStudioAdvancedFillRun({
      advancedFillRunIdRef,
      advancedFillAbortRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    });
    setAdvancedFillBusy(false);
    setAdvancedFillPreview(null);
    setAdvancedFillStatus("채우기 색상이 바뀌어 이전 미리보기를 취소했습니다. 캔버스를 다시 탭하세요.");
  }, [
    color,
    advancedFillBusy,
    advancedFillPreview,
    advancedFillAbortRef,
    advancedFillColorRef,
    advancedFillRunIdRef,
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    setAdvancedFillBusy,
    setAdvancedFillPreview,
    setAdvancedFillStatus,
  ]);
  useEffect(
    () => () => {
      abortStudioAdvancedFillOnUnmount({
        advancedFillRunIdRef,
        advancedFillAbortRef,
        advancedFillTapGestureRef,
        advancedFillTapPayloadRef,
        advancedFillTouchPanRef,
      });
    },
    [
      advancedFillAbortRef,
      advancedFillRunIdRef,
      advancedFillTapGestureRef,
      advancedFillTapPayloadRef,
      advancedFillTouchPanRef,
    ]
  );
}
