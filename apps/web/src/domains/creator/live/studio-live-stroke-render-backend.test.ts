import { describe, expect, it } from "vitest";

import {
  StudioLiveStrokeRenderBackendCoordinator,
  type StudioLiveStrokeCanonicalCanvasToken,
  type StudioLiveStrokeGpuFailureReason,
  type StudioLiveStrokeGpuRequestToken,
  type StudioLiveStrokeRenderBackendAcceptedTransition,
  type StudioLiveStrokeRenderSessionSnapshot,
} from "./studio-live-stroke-render-backend";

function accepted(
  transition: ReturnType<StudioLiveStrokeRenderBackendCoordinator["pointerDown"]>,
): StudioLiveStrokeRenderBackendAcceptedTransition {
  expect(transition.status).toBe("accepted");
  if (transition.status !== "accepted") throw new Error(transition.reason);
  return transition;
}

function session(
  coordinator: StudioLiveStrokeRenderBackendCoordinator,
): StudioLiveStrokeRenderSessionSnapshot {
  const snapshot = coordinator.getSnapshot();
  expect(snapshot.phase).not.toBe("idle");
  if (snapshot.phase === "idle") throw new Error("Expected an active stroke session");
  return snapshot;
}

function beginWebGpu(
  coordinator = new StudioLiveStrokeRenderBackendCoordinator(),
  strokeId = "stroke-a",
): {
  coordinator: StudioLiveStrokeRenderBackendCoordinator;
  epoch: number;
} {
  const result = accepted(coordinator.pointerDown({ strokeId, backend: "webgpu" }));
  return { coordinator, epoch: result.next.epoch };
}

function requestGpu(
  coordinator: StudioLiveStrokeRenderBackendCoordinator,
  epoch: number,
  strokeId = "stroke-a",
  requestId = "gpu:1",
): StudioLiveStrokeGpuRequestToken {
  const result = accepted(coordinator.requestGpuFrame({ epoch, strokeId, requestId }));
  expect(result.gpuRequest).not.toBeNull();
  return result.gpuRequest as StudioLiveStrokeGpuRequestToken;
}

function receiptGpu(
  coordinator: StudioLiveStrokeRenderBackendCoordinator,
  token: StudioLiveStrokeGpuRequestToken,
): StudioLiveStrokeRenderBackendAcceptedTransition {
  return accepted(coordinator.receiveGpuFrameReceipt({
    token,
    backend: "webgpu",
    complete: true,
  }));
}

function pointerUp(
  coordinator: StudioLiveStrokeRenderBackendCoordinator,
  epoch: number,
  strokeId = "stroke-a",
  requestId = "canvas:1",
): StudioLiveStrokeCanonicalCanvasToken {
  const result = accepted(coordinator.pointerUp({
    epoch,
    strokeId,
    canonicalCanvasRequestId: requestId,
  }));
  expect(result.canonicalCanvasRequest).not.toBeNull();
  return result.canonicalCanvasRequest as StudioLiveStrokeCanonicalCanvasToken;
}

describe("studio live-stroke render backend coordinator", () => {
  it("pins the pointer-down backend and rejects every mid-stroke renderer switch", () => {
    const { coordinator, epoch } = beginWebGpu();
    expect(session(coordinator)).toMatchObject({
      phase: "drawing",
      epoch,
      strokeId: "stroke-a",
      pinnedBackend: "webgpu",
      presentationBackend: null,
      canvasShadowRetained: true,
      canvasShadowVisible: false,
      gpuOverlayVisible: false,
    });

    const retained = coordinator.checkBackendPin({
      epoch,
      strokeId: "stroke-a",
      backend: "webgpu",
    });
    expect(retained).toMatchObject({
      status: "accepted",
      effects: [{ type: "backend.pin-retained", backend: "webgpu" }],
    });

    const before = coordinator.getSnapshot();
    const switched = coordinator.checkBackendPin({
      epoch,
      strokeId: "stroke-a",
      backend: "canvas2d",
    });
    expect(switched).toMatchObject({ status: "rejected", reason: "backend-pinned" });
    expect(switched.next).toBe(before);
    expect(coordinator.getSnapshot()).toBe(before);
  });

  it("keeps a Canvas-pinned stroke on Canvas and never admits a GPU request", () => {
    const coordinator = new StudioLiveStrokeRenderBackendCoordinator();
    const down = accepted(coordinator.pointerDown({
      strokeId: "canvas-stroke",
      backend: "canvas2d",
    }));
    const epoch = down.next.epoch;

    expect(session(coordinator)).toMatchObject({
      pinnedBackend: "canvas2d",
      presentationBackend: "canvas2d",
      canvasShadowVisible: true,
      gpuOverlayVisible: false,
    });
    expect(coordinator.requestGpuFrame({
      epoch,
      strokeId: "canvas-stroke",
      requestId: "gpu:forbidden",
    })).toMatchObject({ status: "rejected", reason: "not-webgpu-stroke" });
    expect(coordinator.checkBackendPin({
      epoch,
      strokeId: "canvas-stroke",
      backend: "webgpu",
    })).toMatchObject({ status: "rejected", reason: "backend-pinned" });
  });

  it("keeps WebGPU presentation unavailable until the exact current GPU receipt", () => {
    const { coordinator, epoch } = beginWebGpu();
    const first = requestGpu(coordinator, epoch, "stroke-a", "gpu:first");
    const second = requestGpu(coordinator, epoch, "stroke-a", "gpu:second");

    expect(session(coordinator)).toMatchObject({
      presentationBackend: null,
      canvasShadowRetained: true,
      canvasShadowVisible: false,
      gpuOverlayVisible: false,
      expectedGpuRequest: second,
    });

    const stale = coordinator.receiveGpuFrameReceipt({
      token: first,
      backend: "webgpu",
      complete: true,
    });
    expect(stale).toMatchObject({ status: "rejected", reason: "stale-gpu-result" });
    expect(session(coordinator).canvasShadowVisible).toBe(false);

    const invalid = coordinator.receiveGpuFrameReceipt({
      token: second,
      backend: "canvas2d",
      complete: true,
    });
    expect(invalid).toMatchObject({ status: "rejected", reason: "invalid-gpu-receipt" });
    expect(session(coordinator).canvasShadowVisible).toBe(false);

    const shown = receiptGpu(coordinator, second);
    expect(shown.effects).toEqual([
      { type: "gpu-overlay.present", token: second },
      { type: "canvas-shadow.retain-hidden" },
    ]);
    expect(session(coordinator)).toMatchObject({
      pinnedBackend: "webgpu",
      presentationBackend: "webgpu",
      canvasShadowRetained: true,
      canvasShadowVisible: false,
      gpuOverlayVisible: true,
      expectedGpuRequest: null,
      acceptedGpuRequest: second,
    });
  });

  it("does not reveal Canvas while a newer in-place GPU frame is pending", () => {
    const { coordinator, epoch } = beginWebGpu();
    const first = requestGpu(coordinator, epoch, "stroke-a", "gpu:first");
    receiptGpu(coordinator, first);
    const second = requestGpu(coordinator, epoch, "stroke-a", "gpu:second");

    expect(session(coordinator)).toMatchObject({
      presentationBackend: null,
      gpuOverlayVisible: false,
      canvasShadowVisible: false,
      expectedGpuRequest: second,
      acceptedGpuRequest: first,
    });
    expect(coordinator.receiveGpuFrameReceipt({
      token: first,
      backend: "webgpu",
      complete: true,
    })).toMatchObject({ status: "rejected", reason: "stale-gpu-result" });
    expect(session(coordinator).acceptedGpuRequest).toEqual(first);
  });

  it("keeps an already-presented prefix on screen across its own journal appends", () => {
    // A suffix append grows the retained journal in place, so the surface still holds a valid
    // prefix of this same stroke. Closing presentation here removed the whole live stroke from
    // every frame between an append submit and its async queue fence — measured as ~115 blinks in
    // one pen gesture, one per pointer sample.
    const { coordinator, epoch } = beginWebGpu();
    const first = requestGpu(coordinator, epoch, "stroke-a", "gpu:first");
    receiptGpu(coordinator, first);

    const appended = accepted(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:append",
      surfaceContinuity: "append",
    }));
    expect(appended.effects).toEqual([
      { type: "canvas-shadow.retain-hidden" },
      { type: "gpu-overlay.linger" },
      { type: "gpu-frame.await", token: appended.gpuRequest },
    ]);
    expect(session(coordinator)).toMatchObject({
      presentationBackend: "webgpu",
      gpuOverlayVisible: true,
      // The Canvas draft stays suppressed: continuity reveals this stroke's own pixels, never a
      // second renderer's.
      canvasShadowVisible: false,
      acceptedGpuRequest: first,
      expectedGpuRequest: appended.gpuRequest,
    });

    // Authority is still receipt-gated: only the newest exact token may be accepted.
    expect(coordinator.receiveGpuFrameReceipt({
      token: first,
      backend: "webgpu",
      complete: true,
    })).toMatchObject({ status: "rejected", reason: "stale-gpu-result" });

    receiptGpu(coordinator, appended.gpuRequest as StudioLiveStrokeGpuRequestToken);
    expect(session(coordinator)).toMatchObject({
      gpuOverlayVisible: true,
      acceptedGpuRequest: appended.gpuRequest,
      expectedGpuRequest: null,
    });
  });

  it("never exposes the opening frame of a stroke, even when it is an append", () => {
    const { coordinator, epoch } = beginWebGpu();
    const opening = accepted(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:opening",
      surfaceContinuity: "append",
    }));
    // Nothing has been receipted yet, so there is no prefix to keep and continuity grants nothing.
    expect(opening.effects).toContainEqual({ type: "gpu-overlay.hide" });
    expect(session(coordinator)).toMatchObject({
      presentationBackend: null,
      gpuOverlayVisible: false,
    });
  });

  it.each(["rewrite", undefined] as const)(
    "closes presentation for a %s submission over a presented prefix",
    (surfaceContinuity) => {
      // Replacing the journal baseline or reassigning the backing store discards the presented
      // pixels. Omitting continuity must behave exactly like declaring `rewrite`.
      const { coordinator, epoch } = beginWebGpu();
      const first = requestGpu(coordinator, epoch, "stroke-a", "gpu:first");
      receiptGpu(coordinator, first);

      const rewritten = accepted(coordinator.requestGpuFrame({
        epoch,
        strokeId: "stroke-a",
        requestId: "gpu:rewrite",
        ...(surfaceContinuity ? { surfaceContinuity } : {}),
      }));
      expect(rewritten.effects).toContainEqual({ type: "gpu-overlay.hide" });
      expect(session(coordinator)).toMatchObject({
        presentationBackend: null,
        gpuOverlayVisible: false,
        acceptedGpuRequest: first,
      });
    },
  );

  it("closes an append-continued overlay as soon as the selected engine fails", () => {
    const { coordinator, epoch } = beginWebGpu();
    const first = requestGpu(coordinator, epoch, "stroke-a", "gpu:first");
    receiptGpu(coordinator, first);
    const appended = accepted(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:append",
      surfaceContinuity: "append",
    }));
    expect(session(coordinator).gpuOverlayVisible).toBe(true);

    const failed = accepted(coordinator.reportGpuFailure({
      epoch,
      strokeId: "stroke-a",
      reason: "timeout",
      token: appended.gpuRequest,
    }));
    expect(failed.effects).toContainEqual({ type: "gpu-overlay.hide" });
    expect(session(coordinator)).toMatchObject({
      presentationBackend: null,
      gpuOverlayVisible: false,
      canvasShadowVisible: false,
      unavailableReason: "timeout",
    });
  });

  it.each([
    "request-failed",
    "frame-invalid",
    "device-lost",
    "surface-lost",
    "timeout",
    "cancelled",
  ] as const)("marks %s GPU authority unavailable without selecting Canvas", (reason) => {
    const { coordinator, epoch } = beginWebGpu();
    const token = requestGpu(coordinator, epoch);
    receiptGpu(coordinator, token);
    const current = requestGpu(coordinator, epoch, "stroke-a", "gpu:progress");

    const failed = coordinator.reportGpuFailure({
      epoch,
      strokeId: "stroke-a",
      reason,
      ...(["device-lost", "surface-lost"].includes(reason) ? {} : { token: current }),
    });
    expect(failed).toMatchObject({
      status: "accepted",
      effects: [
        { type: "gpu-overlay.hide" },
        { type: "canvas-shadow.retain-hidden" },
        { type: "selected-engine.unavailable", backend: "webgpu", reason },
      ],
    });
    expect(session(coordinator)).toMatchObject({
      pinnedBackend: "webgpu",
      presentationBackend: null,
      canvasShadowRetained: true,
      canvasShadowVisible: false,
      gpuOverlayVisible: false,
      expectedGpuRequest: null,
      acceptedGpuRequest: null,
      unavailableReason: reason,
    });
    expect(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:must-not-recover-mid-stroke",
    })).toMatchObject({ status: "rejected", reason: "selected-engine-unavailable" });
    expect(coordinator.checkBackendPin({
      epoch,
      strokeId: "stroke-a",
      backend: "canvas2d",
    })).toMatchObject({ status: "rejected", reason: "backend-pinned" });
  });

  it("rejects a stale request-scoped timeout without disturbing the current GPU frame", () => {
    const { coordinator, epoch } = beginWebGpu();
    const oldToken = requestGpu(coordinator, epoch, "stroke-a", "gpu:old");
    const currentToken = requestGpu(coordinator, epoch, "stroke-a", "gpu:current");
    const before = coordinator.getSnapshot();

    expect(coordinator.reportGpuFailure({
      epoch,
      strokeId: "stroke-a",
      reason: "timeout",
    })).toMatchObject({ status: "rejected", reason: "invalid-input" });
    const result = coordinator.reportGpuFailure({
      epoch,
      strokeId: "stroke-a",
      reason: "timeout",
      token: oldToken,
    });
    expect(result).toMatchObject({ status: "rejected", reason: "stale-gpu-result" });
    expect(result.next).toBe(before);
    expect(session(coordinator).expectedGpuRequest).toEqual(currentToken);
  });

  it("allows the final GPU receipt after pointer-up and lingers until canonical Canvas draw", () => {
    const { coordinator, epoch } = beginWebGpu();
    const gpuToken = requestGpu(coordinator, epoch, "stroke-a", "gpu:final");
    const canvasToken = pointerUp(coordinator, epoch);

    expect(session(coordinator)).toMatchObject({
      phase: "awaiting-canonical-canvas",
      presentationBackend: null,
      canvasShadowVisible: false,
      gpuOverlayVisible: false,
      expectedGpuRequest: gpuToken,
      expectedCanonicalCanvas: canvasToken,
    });
    expect(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:post-pointer-up",
    })).toMatchObject({ status: "rejected", reason: "invalid-phase" });

    receiptGpu(coordinator, gpuToken);
    expect(session(coordinator)).toMatchObject({
      phase: "awaiting-canonical-canvas",
      presentationBackend: "webgpu",
      canvasShadowRetained: true,
      canvasShadowVisible: false,
      gpuOverlayVisible: true,
      expectedCanonicalCanvas: canvasToken,
    });

    const staleCanvas = coordinator.receiveCanonicalCanvasReceipt({
      token: { ...canvasToken, requestId: "canvas:stale" },
      outcome: "drawn",
    });
    expect(staleCanvas).toMatchObject({
      status: "rejected",
      reason: "stale-canonical-result",
    });
    expect(session(coordinator).gpuOverlayVisible).toBe(true);

    const settled = coordinator.receiveCanonicalCanvasReceipt({
      token: canvasToken,
      outcome: "drawn",
    });
    expect(settled).toMatchObject({
      status: "accepted",
      next: {
        phase: "idle",
        epoch,
        canvasShadowRetained: false,
        canvasShadowVisible: false,
        gpuOverlayVisible: false,
      },
      effects: [{ type: "surfaces.release" }],
    });
  });

  it("emits an explicit linger effect when pointer-up follows a visible GPU receipt", () => {
    const { coordinator, epoch } = beginWebGpu();
    receiptGpu(coordinator, requestGpu(coordinator, epoch));

    const up = coordinator.pointerUp({
      epoch,
      strokeId: "stroke-a",
      canonicalCanvasRequestId: "canvas:commit",
    });
    expect(up).toMatchObject({
      status: "accepted",
      effects: [
        { type: "gpu-overlay.linger" },
        {
          type: "canonical-canvas.await",
          token: { requestId: "canvas:commit" },
        },
      ],
    });
    expect(session(coordinator).gpuOverlayVisible).toBe(true);
  });

  it.each([
    ["failed", "canonical-commit-failed"],
    ["cancelled", "canonical-commit-cancelled"],
  ] as const)("retains the selected GPU frame on a %s canonical draw and releases after an exact retry", (
    outcome,
    reason,
  ) => {
    const { coordinator, epoch } = beginWebGpu();
    receiptGpu(coordinator, requestGpu(coordinator, epoch));
    const firstCanvas = pointerUp(coordinator, epoch);

    const failed = coordinator.receiveCanonicalCanvasReceipt({
      token: firstCanvas,
      outcome,
    });
    expect(failed).toMatchObject({
      status: "accepted",
      next: {
        phase: "awaiting-canonical-canvas",
        presentationBackend: "webgpu",
        canvasShadowVisible: false,
        gpuOverlayVisible: true,
        expectedCanonicalCanvas: null,
        unavailableReason: reason,
      },
    });

    expect(coordinator.receiveCanonicalCanvasReceipt({
      token: firstCanvas,
      outcome: "drawn",
    })).toMatchObject({
      status: "rejected",
      reason: "canonical-canvas-not-awaited",
    });

    const retry = accepted(coordinator.requestCanonicalCanvasCommit({
      epoch,
      strokeId: "stroke-a",
      requestId: "canvas:retry",
    })).canonicalCanvasRequest as StudioLiveStrokeCanonicalCanvasToken;
    expect(retry.sequence).toBeGreaterThan(firstCanvas.sequence);
    expect(coordinator.receiveCanonicalCanvasReceipt({
      token: retry,
      outcome: "drawn",
    })).toMatchObject({ status: "accepted", next: { phase: "idle" } });
  });

  it("rejects results from old epochs after a newer stroke begins", () => {
    const { coordinator, epoch: firstEpoch } = beginWebGpu();
    const oldGpu = requestGpu(coordinator, firstEpoch);
    const oldCanvas = pointerUp(coordinator, firstEpoch);
    accepted(coordinator.receiveCanonicalCanvasReceipt({
      token: oldCanvas,
      outcome: "drawn",
    }));

    const secondDown = accepted(coordinator.pointerDown({
      strokeId: "stroke-b",
      backend: "webgpu",
    }));
    const secondEpoch = secondDown.next.epoch;
    expect(secondEpoch).toBe(firstEpoch + 1);
    const before = coordinator.getSnapshot();

    expect(coordinator.receiveGpuFrameReceipt({
      token: oldGpu,
      backend: "webgpu",
      complete: true,
    })).toMatchObject({ status: "rejected", reason: "stale-epoch" });
    expect(coordinator.receiveCanonicalCanvasReceipt({
      token: oldCanvas,
      outcome: "drawn",
    })).toMatchObject({ status: "rejected", reason: "stale-epoch" });
    expect(coordinator.reportGpuFailure({
      epoch: firstEpoch,
      strokeId: "stroke-a",
      reason: "device-lost",
    })).toMatchObject({ status: "rejected", reason: "stale-epoch" });
    expect(coordinator.getSnapshot()).toBe(before);
  });

  it("rejects wrong stroke identities and a second pointer-down atomically", () => {
    const { coordinator, epoch } = beginWebGpu();
    const before = coordinator.getSnapshot();

    expect(coordinator.requestGpuFrame({
      epoch,
      strokeId: "other-stroke",
      requestId: "gpu:wrong-owner",
    })).toMatchObject({ status: "rejected", reason: "stale-stroke" });
    const nested = coordinator.pointerDown({
      strokeId: "nested",
      backend: "canvas2d",
    });
    expect(nested).toMatchObject({ status: "rejected", reason: "stroke-in-progress" });
    expect(nested.next).toBe(before);
    expect(coordinator.getSnapshot()).toBe(before);
  });

  it("freezes snapshots, correlation tokens, effects, and transitions", () => {
    const { coordinator, epoch } = beginWebGpu();
    const request = accepted(coordinator.requestGpuFrame({
      epoch,
      strokeId: "stroke-a",
      requestId: "gpu:frozen",
    }));
    const token = request.gpuRequest as StudioLiveStrokeGpuRequestToken;

    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.next)).toBe(true);
    expect(Object.isFrozen(request.effects)).toBe(true);
    expect(Object.isFrozen(request.effects[0])).toBe(true);
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("fails closed on malformed identities and receipts", () => {
    const coordinator = new StudioLiveStrokeRenderBackendCoordinator();
    expect(coordinator.pointerDown({
      strokeId: "",
      backend: "webgpu",
    })).toMatchObject({ status: "rejected", reason: "invalid-input" });

    const { epoch } = beginWebGpu(coordinator);
    const token = requestGpu(coordinator, epoch);
    expect(coordinator.receiveGpuFrameReceipt({
      token: { ...token, sequence: 0 },
      backend: "webgpu",
      complete: true,
    })).toMatchObject({ status: "rejected", reason: "invalid-gpu-receipt" });
    expect(coordinator.receiveGpuFrameReceipt({
      token,
      backend: "webgpu",
      complete: false,
    })).toMatchObject({ status: "rejected", reason: "invalid-gpu-receipt" });
  });

  it("covers every GPU failure reason at the public type boundary", () => {
    const reasons: readonly StudioLiveStrokeGpuFailureReason[] = [
      "request-failed",
      "frame-invalid",
      "device-lost",
      "surface-lost",
      "timeout",
      "cancelled",
    ];
    expect(reasons).toHaveLength(6);
  });
});
