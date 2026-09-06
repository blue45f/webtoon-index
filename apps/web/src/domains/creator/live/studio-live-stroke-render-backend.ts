import type { StudioGpuBackend } from "../render/studio-webgpu-frame-contract";

const MAX_IDENTITY_LENGTH = 1_024;

export type StudioLiveStrokeRenderPhase =
  | "idle"
  | "drawing"
  | "awaiting-canonical-canvas";

export type StudioLiveStrokeGpuFailureReason =
  | "request-failed"
  | "frame-invalid"
  | "device-lost"
  | "surface-lost"
  | "timeout"
  | "cancelled";

export type StudioLiveStrokeUnavailableReason =
  | StudioLiveStrokeGpuFailureReason
  | "canonical-commit-failed"
  | "canonical-commit-cancelled";

export interface StudioLiveStrokeGpuRequestToken {
  readonly kind: "studio-live-stroke-gpu-request";
  readonly epoch: number;
  readonly strokeId: string;
  readonly sequence: number;
  readonly requestId: string;
}

export interface StudioLiveStrokeCanonicalCanvasToken {
  readonly kind: "studio-live-stroke-canonical-canvas";
  readonly epoch: number;
  readonly strokeId: string;
  readonly sequence: number;
  readonly requestId: string;
}

export interface StudioLiveStrokeRenderIdleSnapshot {
  readonly phase: "idle";
  /** Last issued epoch. Retaining it makes results from a completed stroke provably stale. */
  readonly epoch: number;
  readonly strokeId: null;
  readonly pinnedBackend: null;
  readonly presentationBackend: null;
  readonly canvasShadowRetained: false;
  readonly canvasShadowVisible: false;
  readonly gpuOverlayVisible: false;
  readonly expectedGpuRequest: null;
  readonly acceptedGpuRequest: null;
  readonly expectedCanonicalCanvas: null;
  readonly unavailableReason: null;
}

export interface StudioLiveStrokeRenderSessionSnapshot {
  readonly phase: Exclude<StudioLiveStrokeRenderPhase, "idle">;
  readonly epoch: number;
  readonly strokeId: string;
  /**
   * Immutable pointer-down choice. Runtime failure can make presentation unavailable, but it
   * cannot switch rasterizers during a physical contact.
   */
  readonly pinnedBackend: StudioGpuBackend;
  /** Surface currently authorized to be visible. */
  readonly presentationBackend: StudioGpuBackend | null;
  /**
   * The canonical Canvas drawing remains retained for the whole session. It can be hidden only
   * after an exact GPU receipt and is released only by an exact canonical Canvas draw receipt.
   */
  readonly canvasShadowRetained: true;
  readonly canvasShadowVisible: boolean;
  readonly gpuOverlayVisible: boolean;
  readonly expectedGpuRequest: StudioLiveStrokeGpuRequestToken | null;
  readonly acceptedGpuRequest: StudioLiveStrokeGpuRequestToken | null;
  readonly expectedCanonicalCanvas: StudioLiveStrokeCanonicalCanvasToken | null;
  readonly unavailableReason: StudioLiveStrokeUnavailableReason | null;
}

export type StudioLiveStrokeRenderBackendSnapshot =
  | StudioLiveStrokeRenderIdleSnapshot
  | StudioLiveStrokeRenderSessionSnapshot;

export type StudioLiveStrokeRenderBackendEvent =
  | "pointer-down"
  | "backend-pin-check"
  | "gpu-frame-requested"
  | "gpu-frame-receipted"
  | "gpu-failed"
  | "pointer-up"
  | "canonical-canvas-requested"
  | "canonical-canvas-receipted";

export type StudioLiveStrokeRenderBackendEffect =
  | {
      readonly type: "backend.pinned";
      readonly backend: StudioGpuBackend;
    }
  | {
      readonly type: "backend.pin-retained";
      readonly backend: StudioGpuBackend;
    }
  | { readonly type: "canvas-shadow.retain-visible" }
  | { readonly type: "canvas-shadow.retain-hidden" }
  | {
      readonly type: "gpu-frame.await";
      readonly token: StudioLiveStrokeGpuRequestToken;
    }
  | {
      readonly type: "gpu-overlay.present";
      readonly token: StudioLiveStrokeGpuRequestToken;
    }
  | { readonly type: "gpu-overlay.hide" }
  | {
      readonly type: "selected-engine.unavailable";
      readonly backend: StudioGpuBackend;
      readonly reason: StudioLiveStrokeUnavailableReason;
    }
  | {
      readonly type: "canonical-canvas.await";
      readonly token: StudioLiveStrokeCanonicalCanvasToken;
    }
  | { readonly type: "gpu-overlay.linger" }
  | { readonly type: "surfaces.release" };

export type StudioLiveStrokeRenderBackendRejectionReason =
  | "invalid-input"
  | "epoch-exhausted"
  | "sequence-exhausted"
  | "stroke-in-progress"
  | "no-active-stroke"
  | "stale-epoch"
  | "stale-stroke"
  | "backend-pinned"
  | "not-webgpu-stroke"
  | "selected-engine-unavailable"
  | "invalid-phase"
  | "invalid-gpu-receipt"
  | "stale-gpu-result"
  | "canonical-canvas-not-awaited"
  | "stale-canonical-result";

export interface StudioLiveStrokeRenderBackendAcceptedTransition {
  readonly status: "accepted";
  readonly event: StudioLiveStrokeRenderBackendEvent;
  readonly previous: StudioLiveStrokeRenderBackendSnapshot;
  readonly next: StudioLiveStrokeRenderBackendSnapshot;
  readonly effects: readonly StudioLiveStrokeRenderBackendEffect[];
  readonly gpuRequest: StudioLiveStrokeGpuRequestToken | null;
  readonly canonicalCanvasRequest: StudioLiveStrokeCanonicalCanvasToken | null;
}

export interface StudioLiveStrokeRenderBackendRejectedTransition {
  readonly status: "rejected";
  readonly event: StudioLiveStrokeRenderBackendEvent;
  readonly reason: StudioLiveStrokeRenderBackendRejectionReason;
  /** Rejections are atomic: both references are the exact current frozen snapshot. */
  readonly previous: StudioLiveStrokeRenderBackendSnapshot;
  readonly next: StudioLiveStrokeRenderBackendSnapshot;
  readonly effects: readonly [];
  readonly gpuRequest: null;
  readonly canonicalCanvasRequest: null;
}

export type StudioLiveStrokeRenderBackendTransition =
  | StudioLiveStrokeRenderBackendAcceptedTransition
  | StudioLiveStrokeRenderBackendRejectedTransition;

export interface StudioLiveStrokePointerDownInput {
  readonly strokeId: string;
  /** Result of the capability/style policy evaluated exactly once at pointer-down. */
  readonly backend: StudioGpuBackend;
}

export interface StudioLiveStrokeEpochIdentity {
  readonly epoch: number;
  readonly strokeId: string;
}

/**
 * What a submission does to the pixels already presented on the shared GPU surface.
 *
 * - `rewrite` reassigns the backing store or replaces the journal baseline. The presented pixels
 *   are gone or no longer describe this stroke, so presentation must close until the new exact
 *   receipt lands.
 * - `append` extends the retained journal in place. Retained tiles are appended (`loadOp: "load"`)
 *   and the presentation pass redraws the whole composite, so the surface keeps showing either the
 *   last presented frame or a superset of it — in both cases a valid prefix of this same stroke.
 */
export type StudioLiveStrokeGpuSurfaceContinuity = "append" | "rewrite";

export interface StudioLiveStrokeGpuFrameRequestInput
  extends StudioLiveStrokeEpochIdentity {
  readonly requestId: string;
  /** Defaults to `rewrite`: a caller that does not state continuity is assumed to destroy pixels. */
  readonly surfaceContinuity?: StudioLiveStrokeGpuSurfaceContinuity;
}

export interface StudioLiveStrokeGpuFrameReceiptInput {
  readonly token: StudioLiveStrokeGpuRequestToken;
  readonly backend: StudioGpuBackend;
  readonly complete: boolean;
}

export interface StudioLiveStrokeGpuFailureInput
  extends StudioLiveStrokeEpochIdentity {
  readonly reason: StudioLiveStrokeGpuFailureReason;
  /**
   * Request-scoped failures must carry the exact token. Device/surface loss may omit it because
   * those invalidate the whole epoch rather than one submission.
   */
  readonly token?: StudioLiveStrokeGpuRequestToken | null;
}

export interface StudioLiveStrokePointerUpInput
  extends StudioLiveStrokeEpochIdentity {
  readonly canonicalCanvasRequestId: string;
}

export interface StudioLiveStrokeCanonicalCanvasRequestInput
  extends StudioLiveStrokeEpochIdentity {
  readonly requestId: string;
}

export interface StudioLiveStrokeCanonicalCanvasReceiptInput {
  readonly token: StudioLiveStrokeCanonicalCanvasToken;
  readonly outcome: "drawn" | "failed" | "cancelled";
}

const EMPTY_EFFECTS = Object.freeze([]) as readonly [];

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTITY_LENGTH;
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function freezeEffects(
  effects: readonly StudioLiveStrokeRenderBackendEffect[],
): readonly StudioLiveStrokeRenderBackendEffect[] {
  return Object.freeze(effects.map((effect) => Object.freeze(effect)));
}

function freezeGpuToken(
  token: StudioLiveStrokeGpuRequestToken,
): StudioLiveStrokeGpuRequestToken {
  return Object.freeze(token);
}

function freezeCanonicalToken(
  token: StudioLiveStrokeCanonicalCanvasToken,
): StudioLiveStrokeCanonicalCanvasToken {
  return Object.freeze(token);
}

function sameGpuToken(
  left: StudioLiveStrokeGpuRequestToken | null,
  right: StudioLiveStrokeGpuRequestToken,
): boolean {
  return left !== null
    && left.kind === right.kind
    && left.epoch === right.epoch
    && left.strokeId === right.strokeId
    && left.sequence === right.sequence
    && left.requestId === right.requestId;
}

function sameCanonicalToken(
  left: StudioLiveStrokeCanonicalCanvasToken | null,
  right: StudioLiveStrokeCanonicalCanvasToken,
): boolean {
  return left !== null
    && left.kind === right.kind
    && left.epoch === right.epoch
    && left.strokeId === right.strokeId
    && left.sequence === right.sequence
    && left.requestId === right.requestId;
}

function idleSnapshot(epoch: number): StudioLiveStrokeRenderIdleSnapshot {
  return Object.freeze({
    phase: "idle",
    epoch,
    strokeId: null,
    pinnedBackend: null,
    presentationBackend: null,
    canvasShadowRetained: false,
    canvasShadowVisible: false,
    gpuOverlayVisible: false,
    expectedGpuRequest: null,
    acceptedGpuRequest: null,
    expectedCanonicalCanvas: null,
    unavailableReason: null,
  });
}

function sessionSnapshot(
  snapshot: StudioLiveStrokeRenderSessionSnapshot,
): StudioLiveStrokeRenderSessionSnapshot {
  return Object.freeze(snapshot);
}

function validGpuTokenShape(token: StudioLiveStrokeGpuRequestToken): boolean {
  return token.kind === "studio-live-stroke-gpu-request"
    && validEpoch(token.epoch)
    && boundedIdentity(token.strokeId)
    && Number.isSafeInteger(token.sequence)
    && token.sequence > 0
    && boundedIdentity(token.requestId);
}

function validCanonicalTokenShape(
  token: StudioLiveStrokeCanonicalCanvasToken,
): boolean {
  return token.kind === "studio-live-stroke-canonical-canvas"
    && validEpoch(token.epoch)
    && boundedIdentity(token.strokeId)
    && Number.isSafeInteger(token.sequence)
    && token.sequence > 0
    && boundedIdentity(token.requestId);
}

/**
 * Stroke-scoped presentation arbiter.
 *
 * The coordinator deliberately owns no timer, React state, Canvas, or GPU resource. Integrators
 * translate its effects into the existing imperative surfaces and feed watchdog/device events
 * back with the epoch/token issued here. That separation makes every visibility decision atomic
 * and prevents a stale async result from authorizing pixels from a different renderer.
 */
export class StudioLiveStrokeRenderBackendCoordinator {
  private state: StudioLiveStrokeRenderBackendSnapshot = idleSnapshot(0);
  private gpuSequence = 0;
  private canonicalSequence = 0;

  public getSnapshot(): StudioLiveStrokeRenderBackendSnapshot {
    return this.state;
  }

  public pointerDown(
    input: StudioLiveStrokePointerDownInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    if (!boundedIdentity(input.strokeId) || !["canvas2d", "webgpu"].includes(input.backend)) {
      return this.reject("pointer-down", "invalid-input", previous);
    }
    if (previous.phase !== "idle") {
      return this.reject("pointer-down", "stroke-in-progress", previous);
    }
    if (previous.epoch >= Number.MAX_SAFE_INTEGER) {
      return this.reject("pointer-down", "epoch-exhausted", previous);
    }

    this.gpuSequence = 0;
    this.canonicalSequence = 0;
    const next = sessionSnapshot({
      phase: "drawing",
      epoch: previous.epoch + 1,
      strokeId: input.strokeId,
      pinnedBackend: input.backend,
      // WebGPU starts unavailable until its own exact receipt arrives. Canvas is visible only when
      // Canvas was explicitly selected at pointer-down; it is never an implicit standby renderer.
      presentationBackend: input.backend === "canvas2d" ? "canvas2d" : null,
      canvasShadowRetained: true,
      canvasShadowVisible: input.backend === "canvas2d",
      gpuOverlayVisible: false,
      expectedGpuRequest: null,
      acceptedGpuRequest: null,
      expectedCanonicalCanvas: null,
      unavailableReason: null,
    });
    return this.accept("pointer-down", previous, next, [
      { type: "backend.pinned", backend: input.backend },
      {
        type: input.backend === "canvas2d"
          ? "canvas-shadow.retain-visible"
          : "canvas-shadow.retain-hidden",
      },
    ]);
  }

  /**
   * Verifies a later capability/rollout observation without changing the pointer-down pin.
   * Repeating the same backend is an idempotent acknowledgement; a different backend is rejected.
   */
  public checkBackendPin(
    input: StudioLiveStrokeEpochIdentity & { readonly backend: StudioGpuBackend },
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    const sessionRejection = this.validateSession(previous, input);
    if (sessionRejection) {
      return this.reject("backend-pin-check", sessionRejection, previous);
    }
    if (!["canvas2d", "webgpu"].includes(input.backend)) {
      return this.reject("backend-pin-check", "invalid-input", previous);
    }
    if (input.backend !== previous.pinnedBackend) {
      return this.reject("backend-pin-check", "backend-pinned", previous);
    }
    return this.accept("backend-pin-check", previous, previous, [
      { type: "backend.pin-retained", backend: previous.pinnedBackend },
    ]);
  }

  public requestGpuFrame(
    input: StudioLiveStrokeGpuFrameRequestInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    const sessionRejection = this.validateSession(previous, input);
    if (sessionRejection) {
      return this.reject("gpu-frame-requested", sessionRejection, previous);
    }
    if (!boundedIdentity(input.requestId)) {
      return this.reject("gpu-frame-requested", "invalid-input", previous);
    }
    if (previous.phase !== "drawing") {
      // Pointer-up seals the GPU operation set. Only the already-issued final request may still
      // receipt while the overlay lingers; no post-contact frame can extend or replace that set.
      return this.reject("gpu-frame-requested", "invalid-phase", previous);
    }
    if (previous.pinnedBackend !== "webgpu") {
      return this.reject("gpu-frame-requested", "not-webgpu-stroke", previous);
    }
    if (previous.unavailableReason !== null) {
      return this.reject("gpu-frame-requested", "selected-engine-unavailable", previous);
    }
    if (this.gpuSequence >= Number.MAX_SAFE_INTEGER) {
      return this.reject("gpu-frame-requested", "sequence-exhausted", previous);
    }

    const token = freezeGpuToken({
      kind: "studio-live-stroke-gpu-request",
      epoch: previous.epoch,
      strokeId: previous.strokeId,
      sequence: this.gpuSequence + 1,
      requestId: input.requestId,
    });
    this.gpuSequence = token.sequence;
    // A rewrite mutates the shared surface: its last receipt cannot authorize pixels from a newer
    // submission, so presentation closes until the new exact token completes. An append only grows
    // the retained journal, so a session that is already presenting keeps presenting its own
    // prefix. Because `gpuOverlayVisible` is still false before the first receipt, the opening
    // frame of a stroke is never exposed unreceipted. The receipt remains the sole authority for
    // readback capture and canonical handoff either way, and the retained Canvas geometry stays
    // document-commit evidence rather than an alternate live renderer.
    const retainsPresentation = input.surfaceContinuity === "append"
      && previous.gpuOverlayVisible;
    const next = sessionSnapshot({
      ...previous,
      presentationBackend: retainsPresentation ? previous.presentationBackend : null,
      canvasShadowVisible: false,
      gpuOverlayVisible: retainsPresentation,
      expectedGpuRequest: token,
    });
    return this.accept(
      "gpu-frame-requested",
      previous,
      next,
      [
        { type: "canvas-shadow.retain-hidden" },
        retainsPresentation
          ? { type: "gpu-overlay.linger" }
          : { type: "gpu-overlay.hide" },
        { type: "gpu-frame.await", token },
      ],
      token,
    );
  }

  public receiveGpuFrameReceipt(
    input: StudioLiveStrokeGpuFrameReceiptInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    if (!validGpuTokenShape(input.token)) {
      return this.reject("gpu-frame-receipted", "invalid-gpu-receipt", previous);
    }
    const sessionRejection = this.validateSession(previous, input.token);
    if (sessionRejection) {
      return this.reject("gpu-frame-receipted", sessionRejection, previous);
    }
    if (previous.pinnedBackend !== "webgpu") {
      return this.reject("gpu-frame-receipted", "not-webgpu-stroke", previous);
    }
    if (previous.unavailableReason !== null) {
      return this.reject("gpu-frame-receipted", "selected-engine-unavailable", previous);
    }
    if (input.backend !== "webgpu" || input.complete !== true) {
      return this.reject("gpu-frame-receipted", "invalid-gpu-receipt", previous);
    }
    const acceptedToken = previous.expectedGpuRequest;
    if (!acceptedToken || !sameGpuToken(acceptedToken, input.token)) {
      return this.reject("gpu-frame-receipted", "stale-gpu-result", previous);
    }

    const next = sessionSnapshot({
      ...previous,
      presentationBackend: "webgpu",
      canvasShadowVisible: false,
      gpuOverlayVisible: true,
      expectedGpuRequest: null,
      acceptedGpuRequest: acceptedToken,
    });
    return this.accept("gpu-frame-receipted", previous, next, [
      { type: "gpu-overlay.present", token: acceptedToken },
      { type: "canvas-shadow.retain-hidden" },
    ]);
  }

  public reportGpuFailure(
    input: StudioLiveStrokeGpuFailureInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    const sessionRejection = this.validateSession(previous, input);
    if (sessionRejection) {
      return this.reject("gpu-failed", sessionRejection, previous);
    }
    if (previous.pinnedBackend !== "webgpu") {
      return this.reject("gpu-failed", "not-webgpu-stroke", previous);
    }
    if (previous.unavailableReason !== null) {
      return this.reject("gpu-failed", "selected-engine-unavailable", previous);
    }
    if (
      ![
        "request-failed",
        "frame-invalid",
        "device-lost",
        "surface-lost",
        "timeout",
        "cancelled",
      ].includes(input.reason)
    ) {
      return this.reject("gpu-failed", "invalid-input", previous);
    }
    const epochScopedFailure =
      input.reason === "device-lost" || input.reason === "surface-lost";
    if (!epochScopedFailure && (input.token === undefined || input.token === null)) {
      // A timeout/cancellation for an older request in the same physical contact must not evict a
      // newer receipted frame. Only device/surface loss is authoritative for the whole epoch.
      return this.reject("gpu-failed", "invalid-input", previous);
    }
    if (input.token !== undefined && input.token !== null) {
      if (
        !validGpuTokenShape(input.token)
        || !sameGpuToken(previous.expectedGpuRequest, input.token)
      ) {
        return this.reject("gpu-failed", "stale-gpu-result", previous);
      }
    }

    const next = sessionSnapshot({
      ...previous,
      presentationBackend: null,
      canvasShadowVisible: false,
      gpuOverlayVisible: false,
      expectedGpuRequest: null,
      acceptedGpuRequest: null,
      unavailableReason: input.reason,
    });
    return this.accept("gpu-failed", previous, next, [
      { type: "gpu-overlay.hide" },
      { type: "canvas-shadow.retain-hidden" },
      {
        type: "selected-engine.unavailable",
        backend: previous.pinnedBackend,
        reason: input.reason,
      },
    ]);
  }

  public pointerUp(
    input: StudioLiveStrokePointerUpInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    const sessionRejection = this.validateSession(previous, input);
    if (sessionRejection) {
      return this.reject("pointer-up", sessionRejection, previous);
    }
    if (previous.phase !== "drawing") {
      return this.reject("pointer-up", "invalid-phase", previous);
    }
    if (previous.unavailableReason !== null) {
      return this.reject("pointer-up", "selected-engine-unavailable", previous);
    }
    if (!boundedIdentity(input.canonicalCanvasRequestId)) {
      return this.reject("pointer-up", "invalid-input", previous);
    }

    const token = this.nextCanonicalToken(previous, input.canonicalCanvasRequestId);
    if (!token) {
      return this.reject("pointer-up", "sequence-exhausted", previous);
    }
    const next = sessionSnapshot({
      ...previous,
      phase: "awaiting-canonical-canvas",
      expectedCanonicalCanvas: token,
    });
    const effects: StudioLiveStrokeRenderBackendEffect[] = [];
    if (previous.gpuOverlayVisible) effects.push({ type: "gpu-overlay.linger" });
    effects.push({ type: "canonical-canvas.await", token });
    return this.accept("pointer-up", previous, next, effects, null, token);
  }

  public requestCanonicalCanvasCommit(
    input: StudioLiveStrokeCanonicalCanvasRequestInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    const sessionRejection = this.validateSession(previous, input);
    if (sessionRejection) {
      return this.reject("canonical-canvas-requested", sessionRejection, previous);
    }
    if (previous.phase !== "awaiting-canonical-canvas") {
      return this.reject("canonical-canvas-requested", "invalid-phase", previous);
    }
    if (!boundedIdentity(input.requestId)) {
      return this.reject("canonical-canvas-requested", "invalid-input", previous);
    }

    const token = this.nextCanonicalToken(previous, input.requestId);
    if (!token) {
      return this.reject("canonical-canvas-requested", "sequence-exhausted", previous);
    }
    const next = sessionSnapshot({
      ...previous,
      expectedCanonicalCanvas: token,
    });
    return this.accept(
      "canonical-canvas-requested",
      previous,
      next,
      [{ type: "canonical-canvas.await", token }],
      null,
      token,
    );
  }

  public receiveCanonicalCanvasReceipt(
    input: StudioLiveStrokeCanonicalCanvasReceiptInput,
  ): StudioLiveStrokeRenderBackendTransition {
    const previous = this.state;
    if (!validCanonicalTokenShape(input.token)) {
      return this.reject(
        "canonical-canvas-receipted",
        "stale-canonical-result",
        previous,
      );
    }
    const sessionRejection = this.validateSession(previous, input.token);
    if (sessionRejection) {
      return this.reject("canonical-canvas-receipted", sessionRejection, previous);
    }
    if (previous.phase !== "awaiting-canonical-canvas") {
      return this.reject("canonical-canvas-receipted", "invalid-phase", previous);
    }
    if (previous.expectedCanonicalCanvas === null) {
      return this.reject(
        "canonical-canvas-receipted",
        "canonical-canvas-not-awaited",
        previous,
      );
    }
    if (!sameCanonicalToken(previous.expectedCanonicalCanvas, input.token)) {
      return this.reject(
        "canonical-canvas-receipted",
        "stale-canonical-result",
        previous,
      );
    }
    if (!["drawn", "failed", "cancelled"].includes(input.outcome)) {
      return this.reject("canonical-canvas-receipted", "invalid-input", previous);
    }

    if (input.outcome === "drawn") {
      const next = idleSnapshot(previous.epoch);
      return this.accept(
        "canonical-canvas-receipted",
        previous,
        next,
        [{ type: "surfaces.release" }],
      );
    }

    const reason = input.outcome === "failed"
      ? "canonical-commit-failed"
      : "canonical-commit-cancelled";
    const next = sessionSnapshot({
      ...previous,
      // A failed canonical document draw does not invalidate the selected GPU frame. Keep the last
      // receipted frame visible while a same-boundary retry is requested; never expose Canvas as an
      // error-recovery renderer.
      presentationBackend: previous.gpuOverlayVisible ? "webgpu" : null,
      canvasShadowVisible: false,
      gpuOverlayVisible: previous.gpuOverlayVisible,
      expectedGpuRequest: null,
      expectedCanonicalCanvas: null,
      unavailableReason: reason,
    });
    return this.accept("canonical-canvas-receipted", previous, next, [
      { type: "canvas-shadow.retain-hidden" },
      {
        type: "selected-engine.unavailable",
        backend: previous.pinnedBackend,
        reason,
      },
    ]);
  }

  private validateSession(
    snapshot: StudioLiveStrokeRenderBackendSnapshot,
    identity: StudioLiveStrokeEpochIdentity,
  ): StudioLiveStrokeRenderBackendRejectionReason | null {
    if (!validEpoch(identity.epoch) || !boundedIdentity(identity.strokeId)) {
      return "invalid-input";
    }
    if (snapshot.phase === "idle") {
      return identity.epoch <= snapshot.epoch ? "stale-epoch" : "no-active-stroke";
    }
    if (identity.epoch !== snapshot.epoch) return "stale-epoch";
    if (identity.strokeId !== snapshot.strokeId) return "stale-stroke";
    return null;
  }

  private nextCanonicalToken(
    snapshot: StudioLiveStrokeRenderSessionSnapshot,
    requestId: string,
  ): StudioLiveStrokeCanonicalCanvasToken | null {
    if (this.canonicalSequence >= Number.MAX_SAFE_INTEGER) return null;
    const token = freezeCanonicalToken({
      kind: "studio-live-stroke-canonical-canvas",
      epoch: snapshot.epoch,
      strokeId: snapshot.strokeId,
      sequence: this.canonicalSequence + 1,
      requestId,
    });
    this.canonicalSequence = token.sequence;
    return token;
  }

  private accept(
    event: StudioLiveStrokeRenderBackendEvent,
    previous: StudioLiveStrokeRenderBackendSnapshot,
    next: StudioLiveStrokeRenderBackendSnapshot,
    effects: readonly StudioLiveStrokeRenderBackendEffect[],
    gpuRequest: StudioLiveStrokeGpuRequestToken | null = null,
    canonicalCanvasRequest: StudioLiveStrokeCanonicalCanvasToken | null = null,
  ): StudioLiveStrokeRenderBackendAcceptedTransition {
    this.state = next;
    return Object.freeze({
      status: "accepted",
      event,
      previous,
      next,
      effects: freezeEffects(effects),
      gpuRequest,
      canonicalCanvasRequest,
    });
  }

  private reject(
    event: StudioLiveStrokeRenderBackendEvent,
    reason: StudioLiveStrokeRenderBackendRejectionReason,
    snapshot: StudioLiveStrokeRenderBackendSnapshot,
  ): StudioLiveStrokeRenderBackendRejectedTransition {
    return Object.freeze({
      status: "rejected",
      event,
      reason,
      previous: snapshot,
      next: snapshot,
      effects: EMPTY_EFFECTS,
      gpuRequest: null,
      canonicalCanvasRequest: null,
    });
  }
}
