import { StudioLiveStrokeRenderBackendCoordinator } from "../live/studio-live-stroke-render-backend";
import { STUDIO_GPU_PIN_REQUEST_TIMEOUT_MS } from "../studio-page-shell-runtime";

import { StudioGpuPinReceiptWatchdog } from "./studio-webgpu-pin-receipt-watchdog";

import type {
  StudioLiveStrokeGpuFailureReason,
  StudioLiveStrokeGpuSurfaceContinuity,
  StudioLiveStrokeUnavailableReason,
} from "../live/studio-live-stroke-render-backend";
import type { StudioLiveStrokeBackendAuditSession } from "../studio-page-editor-types";
import type { StudioWebGpuCanvasHandle, StudioWebGpuSurfaceFrameRequest } from "../StudioWebGpuCanvas";
import type { StudioWebGpuAuthorityFrame } from "./studio-webgpu-authority";
import type { StudioGpuBackend, StudioGpuFrameReceipt } from "./studio-webgpu-frame-contract";
import type { StudioGpuPendingDrawAuthority } from "./studio-webgpu-pending-authority";
import type { StudioGpuStroke } from "./studio-webgpu-stroke";
import type Konva from "konva";
import type { MutableRefObject, RefObject } from "react";

/**
 * 라이브 스트로크 백엔드 감사(coordinator receipt authority) + WebGPU 표면 콜백을 StudioPage 본문에서
 * 그대로 들어낸 배선이다.
 *
 * - 이 팩토리는 훅도 컴포넌트도 아니라 react-compiler 컴파일 경계 밖이다. 반환 클로저의 ref 변이는
 *   추출 전 StudioPage 본문과 텍스트·순서가 동일하다(ref 읽기는 ref 읽기 그대로, 가드는 자기가
 *   지키던 코드와 함께 이동, teardown 순서 보존).
 * - 선택된 GPU가 실패하면 같은 획을 다른 렌더러에 넘기지 않는다. 이 모듈은 unavailable
 *   상태를 기록하고 StudioPage 에 해당 작업의 취소/오류 표시만 요청한다.
 * - `rejectActiveSelectedLiveSurface`·`setWebGpuCanvasHandle`·`onWebGpuBackendChange`·
 *   `onWebGpuDeviceLost`·`onWebGpuFrameReady` 는 StudioPage 에 남는다(소스 경계 테스트가 그 다섯
 *   함수의 인접 슬라이스와 `import("./render/studio-webgpu-live-stroke-plan")` 청크 경계를 페이지
 *   파일에서 직접 읽는다). 남은 다섯도 여기 멤버를 런타임에 그대로 호출한다.
 */
export interface StudioLiveStrokeGpuAuditContext {
  readonly gpuCanvasShadowVisibleRef: MutableRefObject<boolean>;
  readonly gpuLiveAcceptedRequestIdRef: MutableRefObject<string | null>;
  readonly gpuLiveInkPinnedRef: MutableRefObject<boolean>;
  readonly gpuPinReceiptWatchdogRef: MutableRefObject<StudioGpuPinReceiptWatchdog | null>;
  readonly liveDraftLayerRef: RefObject<Konva.Layer | null>;
  readonly liveStrokeBackendAuditActiveIdRef: MutableRefObject<string | null>;
  readonly liveStrokeBackendAuditEarlyGpuReceiptsRef: MutableRefObject<
    Map<string, { readonly strokeId: string; readonly receipt: StudioGpuFrameReceipt }>
  >;
  readonly liveStrokeBackendAuditGpuOwnersRef:
    MutableRefObject<Map<string, StudioLiveStrokeBackendAuditSession>>;
  readonly liveStrokeBackendAuditSessionsRef:
    MutableRefObject<Map<string, StudioLiveStrokeBackendAuditSession>>;
  readonly pendingGpuDrawAuthoritiesRef: MutableRefObject<StudioGpuPendingDrawAuthority[]>;
  readonly pendingGpuStrokesRef: MutableRefObject<StudioGpuStroke[]>;
  readonly onSelectedEngineUnavailable: (
    reason: StudioLiveStrokeUnavailableReason,
    strokeId: string,
  ) => void;
  readonly setWebGpuAuthority: (frame: StudioWebGpuAuthorityFrame | null) => void;
  readonly webGpuCanvasHandleRef: MutableRefObject<StudioWebGpuCanvasHandle | null>;
}

/** GPU 프레임 영수증 1건이 coordinator 감사에 받아들여진 결과. */
export type StudioLiveStrokeGpuAuditReceiptOutcome =
  | { readonly status: "accepted"; readonly strokeId: string; readonly active: boolean }
  | { readonly status: "rejected"; readonly strokeId: string; readonly active: boolean }
  | { readonly status: "pending-registration" | "untracked" };

/** 라이브 스트로크 GPU 감사 배선이 StudioPage 에 되돌려 주는 표면. */
export interface StudioLiveStrokeGpuAudit {
  readonly applyLiveStrokeBackendPresentationEffects: () => void;
  readonly armGpuPinnedRequestWatchdog: (requestId: string, timeoutMs?: number) => void;
  readonly armLiveStrokeCanonicalCanvasAudit: (
    strokeIds: readonly string[],
    requestId: string
  ) => void;
  readonly beginGpuPinnedReceiptEpoch: (requestId: string) => void;
  readonly beginLiveStrokeBackendAudit: (
    strokeId: string,
    backend: StudioGpuBackend
  ) => boolean;
  readonly cancelAllLiveStrokeBackendAudits: () => void;
  readonly cancelGpuPinnedRequestWatchdog: () => void;
  readonly cancelLiveStrokeBackendAudit: (strokeId: string) => void;
  readonly markActiveLiveStrokeBackendCancelled: () => void;
  readonly finalizeLiveStrokeBackendAudit: (
    strokeId: string | null,
    awaitCanonicalCanvas: boolean
  ) => void;
  readonly gpuPinReceiptWatchdog: () => StudioGpuPinReceiptWatchdog;
  readonly onWebGpuFrameInvalid: () => void;
  readonly onWebGpuFrameRequest: (request: StudioWebGpuSurfaceFrameRequest) => void;
  readonly prepareLiveStrokeGpuSubmission: (
    strokeId: string,
    surfaceContinuity?: StudioLiveStrokeGpuSurfaceContinuity
  ) => boolean;
  readonly receiveLiveStrokeCanonicalCanvasAudit: (
    strokeIds: readonly string[],
    outcome: "drawn" | "failed" | "cancelled"
  ) => void;
  readonly receiveLiveStrokeGpuAuditReceipt: (
    receipt: StudioGpuFrameReceipt
  ) => StudioLiveStrokeGpuAuditReceiptOutcome;
  readonly registerLiveStrokeGpuRequest: (
    strokeId: string,
    requestId: string,
    surfaceContinuity?: StudioLiveStrokeGpuSurfaceContinuity
  ) => boolean;
  readonly reportAllLiveStrokeGpuAuditFailures: (
    reason: "device-lost" | "surface-lost"
  ) => void;
  readonly reportLiveStrokeGpuAuditFailure: (
    reason: StudioLiveStrokeGpuFailureReason,
    requestId?: string,
    strokeId?: string
  ) => boolean;
  readonly retireLiveStrokeBackendAudit: (strokeId: string) => void;
  readonly sealLiveStrokeBackendAudit: (strokeId: string) => boolean;
}

export function createStudioLiveStrokeGpuAudit(
  context: StudioLiveStrokeGpuAuditContext
): StudioLiveStrokeGpuAudit {
  const {
    gpuCanvasShadowVisibleRef,
    gpuLiveAcceptedRequestIdRef,
    gpuLiveInkPinnedRef,
    gpuPinReceiptWatchdogRef,
    liveDraftLayerRef,
    liveStrokeBackendAuditActiveIdRef,
    liveStrokeBackendAuditEarlyGpuReceiptsRef,
    liveStrokeBackendAuditGpuOwnersRef,
    liveStrokeBackendAuditSessionsRef,
    pendingGpuDrawAuthoritiesRef,
    pendingGpuStrokesRef,
    onSelectedEngineUnavailable,
    setWebGpuAuthority,
    webGpuCanvasHandleRef,
  } = context;

  function applyLiveStrokeBackendPresentationEffects(): void {
    const currentSurfaceRequestId = gpuLiveAcceptedRequestIdRef.current;
    const activeId = liveStrokeBackendAuditActiveIdRef.current;
    const activeSession = activeId
      ? liveStrokeBackendAuditSessionsRef.current.get(activeId)
      : null;
    const activeSnapshot = activeSession?.coordinator.getSnapshot();
    const activeAcceptedRequest = activeSnapshot && activeSnapshot.phase !== "idle"
      ? activeSnapshot.acceptedGpuRequest
      : null;
    const activeGpuReceiptExact = activeAcceptedRequest !== null
      && activeAcceptedRequest.requestId === currentSurfaceRequestId
      && gpuPinReceiptWatchdogRef.current?.hasExactReceipt(
        activeAcceptedRequest.requestId
      ) === true;
    const activeGpuAuthorized = Boolean(
      activeSnapshot
      && activeSnapshot.phase !== "idle"
      && activeSnapshot.gpuOverlayVisible
      && activeGpuReceiptExact
    );

    // Canvas is visible only for an explicitly Canvas-pinned operation. A WebGPU miss is an
    // unavailable selected engine, not permission to reveal the retained canonical DrawEl.
    const canvasShadowVisible = Boolean(
      activeSnapshot
      && activeSnapshot.phase !== "idle"
      && activeSnapshot.pinnedBackend === "canvas2d"
      && (
        activeSnapshot.canvasShadowVisible
        || (activeSnapshot.gpuOverlayVisible && !activeGpuAuthorized)
      )
    );

    const receiptedSessionVisible = currentSurfaceRequestId !== null && [
      ...liveStrokeBackendAuditSessionsRef.current.values(),
    ].some((session) => {
      const snapshot = session.coordinator.getSnapshot();
      if (snapshot.phase === "idle" || !snapshot.gpuOverlayVisible) return false;
      const accepted = snapshot.acceptedGpuRequest;
      return accepted?.requestId === currentSurfaceRequestId
        && gpuPinReceiptWatchdogRef.current?.hasExactReceipt(currentSurfaceRequestId) === true;
    });
    // A session mid-append over pixels it already receipted keeps presenting them. The append only
    // grows the retained journal, so the surface still holds a valid prefix of this same stroke;
    // closing it between an append submit and its async queue fence is what blanked the canvas
    // once per pointer sample. Every clause below is still required: the coordinator must have
    // carried presentation across the append (`gpuOverlayVisible` with a newer request in flight),
    // and the watchdog must confirm the already-presented request really was receipted.
    // The clause is tied to the surface it is talking about, exactly like the one above: the
    // session's in-flight append must be the request the surface ref now points at. Without that
    // tie a SEALED previous stroke satisfied every other clause — pointer-up deliberately keeps
    // its `gpuOverlayVisible` and `expectedGpuRequest`, and its accepted request really was
    // receipted — and reopened the NEXT stroke's rewritten surface before that stroke's own
    // first receipt. Its stale expected request never equals the new stroke's surface id.
    const appendContinuedSessionVisible = currentSurfaceRequestId !== null && [
      ...liveStrokeBackendAuditSessionsRef.current.values(),
    ].some((session) => {
      const snapshot = session.coordinator.getSnapshot();
      if (snapshot.phase === "idle" || snapshot.pinnedBackend !== "webgpu") return false;
      if (snapshot.unavailableReason !== null) return false;
      if (!snapshot.gpuOverlayVisible) return false;
      if (snapshot.expectedGpuRequest?.requestId !== currentSurfaceRequestId) return false;
      const accepted = snapshot.acceptedGpuRequest;
      return accepted !== null
        && gpuPinReceiptWatchdogRef.current?.hasExactReceipt(accepted.requestId) === true;
    });
    // Pending geometry alone is never a visibility capability. Every surface rewrite invalidates
    // the prior pixels, so only a coordinator session holding an exact GPU receipt may reopen it.
    const gpuOverlayVisible = receiptedSessionVisible || appendContinuedSessionVisible;
    gpuCanvasShadowVisibleRef.current = canvasShadowVisible;
    if (canvasShadowVisible) {
      // Restore the retained pixels synchronously before hiding the DOM GPU canvas. A deferred
      // batchDraw here would expose one blank compositor frame on timeout/device loss.
      liveDraftLayerRef.current?.drawScene();
      webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(gpuOverlayVisible);
    } else {
      // Conversely, publish the exact receipted GPU frame before removing the duplicate shadow.
      webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(gpuOverlayVisible);
      liveDraftLayerRef.current?.drawScene();
    }
  }

  function prepareLiveStrokeGpuSubmission(
    strokeId: string,
    surfaceContinuity: StudioLiveStrokeGpuSurfaceContinuity = "rewrite"
  ): boolean {
    const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
    const snapshot = session?.coordinator.getSnapshot();
    if (
      !session
      || snapshot?.phase !== "drawing"
      || snapshot.pinnedBackend !== "webgpu"
      || snapshot.unavailableReason !== null
    ) return false;
    // The surface's newest request is about to change either way, so the accepted id is stale here.
    gpuLiveAcceptedRequestIdRef.current = null;
    if (surfaceContinuity === "append" && snapshot.gpuOverlayVisible) {
      // An append cannot destroy the presented prefix, so there is nothing to hide and no Konva
      // draft to restore. Skipping the drawScene also drops a full layer rasterisation per pointer
      // sample; the draft stays suppressed because neither pin ref changed.
      return true;
    }
    // A rewrite mutates the shared surface before its request id can be returned. Hide the prior
    // GPU receipt until registration proves the new exact request; do not reveal another renderer.
    gpuCanvasShadowVisibleRef.current = false;
    liveDraftLayerRef.current?.drawScene();
    webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(false);
    return true;
  }

  function retireLiveStrokeBackendAudit(strokeId: string): void {
    const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
    if (!session) return;
    if (session.gpuRequest) {
      liveStrokeBackendAuditGpuOwnersRef.current.delete(session.gpuRequest.requestId);
      liveStrokeBackendAuditEarlyGpuReceiptsRef.current.delete(
        session.gpuRequest.requestId
      );
    }
    liveStrokeBackendAuditSessionsRef.current.delete(strokeId);
    if (liveStrokeBackendAuditActiveIdRef.current === strokeId) {
      liveStrokeBackendAuditActiveIdRef.current = null;
    }
    applyLiveStrokeBackendPresentationEffects();
  }

  function beginLiveStrokeBackendAudit(
    strokeId: string,
    backend: StudioGpuBackend
  ): boolean {
    retireLiveStrokeBackendAudit(strokeId);
    const coordinator = new StudioLiveStrokeRenderBackendCoordinator();
    const transition = coordinator.pointerDown({ strokeId, backend });
    if (transition.status !== "accepted" || transition.next.phase === "idle") {
      return false;
    }
    const session: StudioLiveStrokeBackendAuditSession = {
      coordinator,
      epoch: transition.next.epoch,
      strokeId,
      seenGpuRequestIds: new Set(),
      gpuRequest: null,
      canonicalCanvasRequest: null,
    };
    liveStrokeBackendAuditSessionsRef.current.set(strokeId, session);
    liveStrokeBackendAuditActiveIdRef.current = strokeId;
    applyLiveStrokeBackendPresentationEffects();
    return true;
  }

  function registerLiveStrokeGpuRequest(
    strokeId: string,
    requestId: string,
    surfaceContinuity: StudioLiveStrokeGpuSurfaceContinuity = "rewrite"
  ): boolean {
    const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
    if (!session) return false;
    // A resize can synchronously announce the exact request before the imperative journal call
    // returns the same outcome to its caller. That is one request crossing two API boundaries,
    // not a replay: accept only the currently owned identity as an idempotent registration.
    if (
      session.gpuRequest?.requestId === requestId
      && liveStrokeBackendAuditGpuOwnersRef.current.get(requestId) === session
    ) {
      return true;
    }
    if (session.seenGpuRequestIds.has(requestId)) return false;
    const pin = session.coordinator.checkBackendPin({
      epoch: session.epoch,
      strokeId,
      backend: "webgpu",
    });
    if (pin.status !== "accepted") return false;
    const transition = session.coordinator.requestGpuFrame({
      epoch: session.epoch,
      strokeId,
      requestId,
      surfaceContinuity,
    });
    if (transition.status !== "accepted" || !transition.gpuRequest) return false;
    session.seenGpuRequestIds.add(requestId);
    if (session.gpuRequest) {
      liveStrokeBackendAuditGpuOwnersRef.current.delete(session.gpuRequest.requestId);
    }
    session.gpuRequest = transition.gpuRequest;
    liveStrokeBackendAuditGpuOwnersRef.current.set(requestId, session);

    const earlyReceipt = liveStrokeBackendAuditEarlyGpuReceiptsRef.current.get(requestId);
    if (!earlyReceipt) {
      applyLiveStrokeBackendPresentationEffects();
      return true;
    }
    liveStrokeBackendAuditEarlyGpuReceiptsRef.current.delete(requestId);
    if (earlyReceipt.strokeId !== strokeId) return false;
    const receipted = session.coordinator.receiveGpuFrameReceipt({
      token: transition.gpuRequest,
      backend: earlyReceipt.receipt.backend,
      complete: earlyReceipt.receipt.complete,
    });
    if (receipted.status !== "accepted") return false;
    liveStrokeBackendAuditGpuOwnersRef.current.delete(requestId);
    session.gpuRequest = null;
    if (liveStrokeBackendAuditActiveIdRef.current === strokeId) {
      gpuPinReceiptWatchdog().receipt(requestId);
    }
    applyLiveStrokeBackendPresentationEffects();
    return true;
  }

  function receiveLiveStrokeGpuAuditReceipt(
    receipt: StudioGpuFrameReceipt
  ):
    | {
        readonly status: "accepted";
        readonly strokeId: string;
      readonly active: boolean;
      }
    | {
        readonly status: "rejected";
        readonly strokeId: string;
        readonly active: boolean;
      }
    | { readonly status: "pending-registration" | "untracked" } {
    const session = liveStrokeBackendAuditGpuOwnersRef.current.get(receipt.requestId);
    if (session?.gpuRequest) {
      const transition = session.coordinator.receiveGpuFrameReceipt({
        token: session.gpuRequest,
        backend: receipt.backend,
        complete: receipt.complete,
      });
      if (transition.status !== "accepted") {
        return {
          status: "rejected",
          strokeId: session.strokeId,
          active: liveStrokeBackendAuditActiveIdRef.current === session.strokeId,
        };
      }
      liveStrokeBackendAuditGpuOwnersRef.current.delete(receipt.requestId);
      session.gpuRequest = null;
      applyLiveStrokeBackendPresentationEffects();
      return {
        status: "accepted",
        strokeId: session.strokeId,
        active: liveStrokeBackendAuditActiveIdRef.current === session.strokeId,
      };
    }

    const activeId = liveStrokeBackendAuditActiveIdRef.current;
    const active = activeId
      ? liveStrokeBackendAuditSessionsRef.current.get(activeId)
      : null;
    const snapshot = active?.coordinator.getSnapshot();
    if (
      active
      && snapshot?.phase === "drawing"
      && snapshot.pinnedBackend === "webgpu"
    ) {
      const early = liveStrokeBackendAuditEarlyGpuReceiptsRef.current;
      early.set(receipt.requestId, { strokeId: active.strokeId, receipt });
      while (early.size > 8) {
        const oldest = early.keys().next().value;
        if (typeof oldest !== "string") break;
        early.delete(oldest);
      }
      return { status: "pending-registration" };
    }
    return { status: "untracked" };
  }

  function reportLiveStrokeGpuAuditFailure(
    reason: StudioLiveStrokeGpuFailureReason,
    requestId?: string,
    strokeId?: string
  ): boolean {
    const requestOwner = requestId
      ? liveStrokeBackendAuditGpuOwnersRef.current.get(requestId)
      : null;
    const activeId = liveStrokeBackendAuditActiveIdRef.current;
    const session = requestOwner
      ?? (strokeId
        ? liveStrokeBackendAuditSessionsRef.current.get(strokeId)
        : null)
      ?? (activeId
        ? liveStrokeBackendAuditSessionsRef.current.get(activeId)
        : null);
    if (!session) return false;
    const token = requestId
      ? session.gpuRequest?.requestId === requestId
        ? session.gpuRequest
        : null
      : session.gpuRequest;
    const transition = session.coordinator.reportGpuFailure({
      epoch: session.epoch,
      strokeId: session.strokeId,
      reason,
      ...(
        reason === "device-lost" || reason === "surface-lost"
          ? {}
          : { token }
      ),
    });
    if (transition.status !== "accepted") return false;
    if (session.gpuRequest) {
      liveStrokeBackendAuditGpuOwnersRef.current.delete(session.gpuRequest.requestId);
      session.gpuRequest = null;
    }
    applyLiveStrokeBackendPresentationEffects();
    if (reason !== "cancelled") {
      onSelectedEngineUnavailable(reason, session.strokeId);
    }
    return true;
  }

  function reportAllLiveStrokeGpuAuditFailures(
    reason: "device-lost" | "surface-lost"
  ): void {
    const unavailableStrokeIds: string[] = [];
    for (const session of [...liveStrokeBackendAuditSessionsRef.current.values()]) {
      const snapshot = session.coordinator.getSnapshot();
      if (snapshot.phase === "idle" || snapshot.pinnedBackend !== "webgpu") continue;
      const transition = session.coordinator.reportGpuFailure({
        epoch: session.epoch,
        strokeId: session.strokeId,
        reason,
      });
      if (transition.status !== "accepted") continue;
      if (session.gpuRequest) {
        liveStrokeBackendAuditGpuOwnersRef.current.delete(session.gpuRequest.requestId);
        session.gpuRequest = null;
      }
      unavailableStrokeIds.push(session.strokeId);
    }
    applyLiveStrokeBackendPresentationEffects();
    for (const strokeId of unavailableStrokeIds) {
      onSelectedEngineUnavailable(reason, strokeId);
    }
  }

  function markActiveLiveStrokeBackendCancelled(): void {
    const activeId = liveStrokeBackendAuditActiveIdRef.current;
    const session = activeId
      ? liveStrokeBackendAuditSessionsRef.current.get(activeId)
      : null;
    if (!session) return;
    if (session.gpuRequest) {
      reportLiveStrokeGpuAuditFailure("cancelled", session.gpuRequest.requestId);
      return;
    }
    // No request is pending, but an already-receipted GPU frame may still be visible. Cancellation
    // closes only this selected-provider operation and never authorizes another renderer.
    reportLiveStrokeGpuAuditFailure("cancelled", undefined, session.strokeId);
  }

  function sealLiveStrokeBackendAudit(strokeId: string): boolean {
    const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
    if (!session) return false;
    const snapshot = session.coordinator.getSnapshot();
    if (snapshot.phase === "awaiting-canonical-canvas") return true;
    const transition = session.coordinator.pointerUp({
      epoch: session.epoch,
      strokeId,
      canonicalCanvasRequestId: `canvas:${strokeId}:pending`,
    });
    if (transition.status !== "accepted" || !transition.canonicalCanvasRequest) {
      return false;
    }
    session.canonicalCanvasRequest = transition.canonicalCanvasRequest;
    if (liveStrokeBackendAuditActiveIdRef.current === strokeId) {
      liveStrokeBackendAuditActiveIdRef.current = null;
    }
    return true;
  }

  function armLiveStrokeCanonicalCanvasAudit(
    strokeIds: readonly string[],
    requestId: string
  ): void {
    for (const strokeId of strokeIds) {
      const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
      if (!session) continue;
      if (!sealLiveStrokeBackendAudit(strokeId)) {
        retireLiveStrokeBackendAudit(strokeId);
        continue;
      }
      const transition = session.coordinator.requestCanonicalCanvasCommit({
        epoch: session.epoch,
        strokeId,
        requestId: `${requestId}:${strokeId}`,
      });
      if (transition.status !== "accepted" || !transition.canonicalCanvasRequest) {
        continue;
      }
      session.canonicalCanvasRequest = transition.canonicalCanvasRequest;
    }
  }

  function receiveLiveStrokeCanonicalCanvasAudit(
    strokeIds: readonly string[],
    outcome: "drawn" | "failed" | "cancelled"
  ): void {
    for (const strokeId of strokeIds) {
      const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
      const token = session?.canonicalCanvasRequest;
      if (!session || !token) {
        if (outcome !== "failed") retireLiveStrokeBackendAudit(strokeId);
        continue;
      }
      const transition = session.coordinator.receiveCanonicalCanvasReceipt({
        token,
        outcome,
      });
      if (transition.status !== "accepted") continue;
      session.canonicalCanvasRequest = null;
      if (outcome !== "drawn") {
        // Failed canonical presentation keeps the last selected-provider frame/data installed.
        // A later canonical retry may release it, but this outcome cannot promote a substitute.
        applyLiveStrokeBackendPresentationEffects();
        if (outcome === "failed") {
          onSelectedEngineUnavailable("canonical-commit-failed", strokeId);
        }
      }
      if (outcome !== "failed") retireLiveStrokeBackendAudit(strokeId);
    }
  }

  function cancelLiveStrokeBackendAudit(strokeId: string): void {
    const session = liveStrokeBackendAuditSessionsRef.current.get(strokeId);
    if (!session) return;
    const snapshot = session.coordinator.getSnapshot();
    if (
      snapshot.phase !== "idle"
      && snapshot.pinnedBackend === "webgpu"
      && session.gpuRequest
      && snapshot.unavailableReason === null
    ) {
      session.coordinator.reportGpuFailure({
        epoch: session.epoch,
        strokeId,
        reason: "cancelled",
        token: session.gpuRequest,
      });
    }
    if (session.coordinator.getSnapshot().phase === "drawing") {
      sealLiveStrokeBackendAudit(strokeId);
    }
    receiveLiveStrokeCanonicalCanvasAudit([strokeId], "cancelled");
    retireLiveStrokeBackendAudit(strokeId);
  }

  function finalizeLiveStrokeBackendAudit(
    strokeId: string | null,
    awaitCanonicalCanvas: boolean
  ): void {
    if (!strokeId) return;
    if (awaitCanonicalCanvas && sealLiveStrokeBackendAudit(strokeId)) return;
    cancelLiveStrokeBackendAudit(strokeId);
  }

  function cancelAllLiveStrokeBackendAudits(): void {
    for (const strokeId of [...liveStrokeBackendAuditSessionsRef.current.keys()]) {
      cancelLiveStrokeBackendAudit(strokeId);
    }
    liveStrokeBackendAuditGpuOwnersRef.current.clear();
    liveStrokeBackendAuditEarlyGpuReceiptsRef.current.clear();
    liveStrokeBackendAuditActiveIdRef.current = null;
  }
  function onWebGpuFrameInvalid() {
    setWebGpuAuthority(null);
    // The Canvas boundary intentionally has no request id on invalidation. Do not let an older
    // invalidation re-arm a timer after the current receipt; every admitted journal request arms
    // its own exact-request watchdog below, while Canvas filters ready receipts by request id.
  }
  function onWebGpuFrameRequest(request: StudioWebGpuSurfaceFrameRequest) {
    setWebGpuAuthority(null);
    const activeStrokeId = liveStrokeBackendAuditActiveIdRef.current;
    const activeSession = activeStrokeId
      ? liveStrokeBackendAuditSessionsRef.current.get(activeStrokeId)
      : null;
    const snapshot = activeSession?.coordinator.getSnapshot();
    if (
      activeStrokeId
      && snapshot?.phase === "drawing"
      && snapshot.pinnedBackend === "webgpu"
      && gpuLiveInkPinnedRef.current
    ) {
      if (
        !prepareLiveStrokeGpuSubmission(activeStrokeId)
        || !registerLiveStrokeGpuRequest(activeStrokeId, request.requestId)
      ) {
        reportLiveStrokeGpuAuditFailure("surface-lost", undefined, activeStrokeId);
        return;
      }
      gpuLiveAcceptedRequestIdRef.current = request.requestId;
      armGpuPinnedRequestWatchdog(request.requestId);
      applyLiveStrokeBackendPresentationEffects();
      return;
    }

    // A pointer-up surface cannot mint a new stroke receipt by coordinator contract, and resize has
    // already destroyed its backing pixels. Keep it hidden, retain canonical queues, and report the
    // selected provider unavailable instead of exposing stale pixels or migrating renderers.
    if (
      pendingGpuStrokesRef.current.length > 0
      || pendingGpuDrawAuthoritiesRef.current.length > 0
    ) {
      globalThis.queueMicrotask(() => {
        if (liveStrokeBackendAuditActiveIdRef.current !== null) return;
        webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(false);
        for (const authority of pendingGpuDrawAuthoritiesRef.current) {
          onSelectedEngineUnavailable("surface-lost", authority.element.id);
        }
      });
    }
  }
  function gpuPinReceiptWatchdog(): StudioGpuPinReceiptWatchdog {
    gpuPinReceiptWatchdogRef.current ??= new StudioGpuPinReceiptWatchdog({
      timeoutMs: STUDIO_GPU_PIN_REQUEST_TIMEOUT_MS,
      onTimeout: (_reason, requestId) => {
        // Pointer-up may already have cleared the contact pin while the exact final request still
        // owns a deferred canonical candidate. Its deadline remains authoritative until receipt.
        reportLiveStrokeGpuAuditFailure("timeout", requestId);
      },
    });
    return gpuPinReceiptWatchdogRef.current;
  }
  function cancelGpuPinnedRequestWatchdog(): void {
    gpuPinReceiptWatchdogRef.current?.cancel();
  }
  function armGpuPinnedRequestWatchdog(requestId: string, timeoutMs?: number): void {
    if (!gpuLiveInkPinnedRef.current) return;
    gpuPinReceiptWatchdog().request(requestId, timeoutMs);
  }
  function beginGpuPinnedReceiptEpoch(requestId: string): void {
    if (!gpuLiveInkPinnedRef.current) return;
    gpuPinReceiptWatchdog().begin(requestId);
  }

  return {
    applyLiveStrokeBackendPresentationEffects,
    armGpuPinnedRequestWatchdog,
    armLiveStrokeCanonicalCanvasAudit,
    beginGpuPinnedReceiptEpoch,
    beginLiveStrokeBackendAudit,
    cancelAllLiveStrokeBackendAudits,
    cancelGpuPinnedRequestWatchdog,
    cancelLiveStrokeBackendAudit,
    markActiveLiveStrokeBackendCancelled,
    finalizeLiveStrokeBackendAudit,
    gpuPinReceiptWatchdog,
    onWebGpuFrameInvalid,
    onWebGpuFrameRequest,
    prepareLiveStrokeGpuSubmission,
    receiveLiveStrokeCanonicalCanvasAudit,
    receiveLiveStrokeGpuAuditReceipt,
    registerLiveStrokeGpuRequest,
    reportAllLiveStrokeGpuAuditFailures,
    reportLiveStrokeGpuAuditFailure,
    retireLiveStrokeBackendAudit,
    sealLiveStrokeBackendAudit,
  };
}
