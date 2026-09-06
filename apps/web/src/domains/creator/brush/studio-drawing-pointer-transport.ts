import {
  claimStudioStrokeMoveTransport,
  isStudioStrokePointerEvent,
  isStudioTopLevelWindowBlur,
  resolveStudioPointerCaptureLoss,
  shouldCommitStudioStrokeOnPointerCancel,
  shouldEndStudioStrokeForReleasedContact,
  shouldPreserveStudioStrokeOnTransportAbort,
  tryCaptureStudioStrokePointer,
  tryReleaseStudioStrokePointer,
  type StudioPointerCaptureTarget,
  type StudioStrokePointerSession,
} from "../canvas/studio-pointer-input";

export interface StudioDrawingPointerEventTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface StudioDrawingPointerVisibilityTarget extends StudioDrawingPointerEventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

export interface StudioDrawingPointerCaptureTarget extends StudioPointerCaptureTarget {
  addEventListener?: StudioDrawingPointerEventTarget["addEventListener"];
  removeEventListener?: StudioDrawingPointerEventTarget["removeEventListener"];
}

export interface StudioDrawingPointerStageLike {
  readonly content?: StudioDrawingPointerCaptureTarget | null;
}

export type StudioDrawingPointerFinishReason =
  | "pointerup"
  | "pointercancel-prefix"
  | "released-contact"
  | "transport-abort"
  | "lost-capture";

export interface StudioDrawingPointerFinishRequest {
  readonly cancelled: boolean;
  readonly consumeReleaseSample: boolean;
  readonly reason: StudioDrawingPointerFinishReason;
}

export interface StudioDrawingPointerTransportPorts {
  readonly getLastAuthoritativePointer: () => PointerEvent | null;
  readonly onAuthoritativeMove: (pointerEvent: PointerEvent) => void;
  /** Pen-only, preview-only low-latency signal. It must never mutate durable stroke geometry. */
  readonly onRawPreviewMove: (pointerEvent: PointerEvent) => void;
  readonly onDiscard: () => void;
  readonly onFinish: (
    pointerEvent: PointerEvent,
    request: StudioDrawingPointerFinishRequest
  ) => void;
}

export interface StudioDrawingPointerTransportEnvironment {
  readonly documentTarget?: StudioDrawingPointerVisibilityTarget | null;
  readonly windowTarget?: StudioDrawingPointerEventTarget | null;
}

export interface StartStudioDrawingPointerTransportInput {
  readonly pointerEvent: PointerEvent;
  readonly session: StudioStrokePointerSession;
  readonly stage: StudioDrawingPointerStageLike | null | undefined;
}

export interface StartStudioDrawingPointerTransportResult {
  readonly captured: boolean;
  readonly started: boolean;
}

export interface StudioDrawingPointerTransportDiagnostics {
  readonly authoritativeMoveDeliveries: number;
  readonly rawPreviewDeliveries: number;
  readonly finishRequests: number;
  readonly discardRequests: number;
  /** Native move/end deliveries suppressed after this session had already claimed its terminal path. */
  readonly deliveriesAfterTerminalClaim: number;
}

interface MutableStudioDrawingPointerTransportDiagnostics {
  authoritativeMoveDeliveries: number;
  rawPreviewDeliveries: number;
  finishRequests: number;
  discardRequests: number;
  deliveriesAfterTerminalClaim: number;
}

function emptyTransportDiagnostics(): MutableStudioDrawingPointerTransportDiagnostics {
  return {
    authoritativeMoveDeliveries: 0,
    rawPreviewDeliveries: 0,
    finishRequests: 0,
    discardRequests: 0,
    deliveriesAfterTerminalClaim: 0,
  };
}

const EMPTY_PORTS: StudioDrawingPointerTransportPorts = {
  getLastAuthoritativePointer: () => null,
  onAuthoritativeMove: () => undefined,
  onRawPreviewMove: () => undefined,
  onDiscard: () => undefined,
  onFinish: () => undefined,
};

function hasPointerCaptureSetter(value: unknown): value is StudioDrawingPointerCaptureTarget {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  try {
    return typeof (value as StudioDrawingPointerCaptureTarget).setPointerCapture === "function";
  } catch {
    return false;
  }
}

function defaultWindowTarget(): StudioDrawingPointerEventTarget | null {
  const candidate = globalThis as Partial<StudioDrawingPointerEventTarget>;
  return typeof candidate.addEventListener === "function"
    && typeof candidate.removeEventListener === "function"
    ? candidate as StudioDrawingPointerEventTarget
    : null;
}

function defaultDocumentTarget(): StudioDrawingPointerVisibilityTarget | null {
  const candidate = globalThis.document as Partial<StudioDrawingPointerVisibilityTarget> | undefined;
  return candidate
    && typeof candidate.addEventListener === "function"
    && typeof candidate.removeEventListener === "function"
    && typeof candidate.visibilityState === "string"
    ? candidate as StudioDrawingPointerVisibilityTarget
    : null;
}

/**
 * Konva must retain its own event surface as the capture owner. Capturing an outer container would
 * retarget the rest of the gesture away from Stage; the native event target is only a fallback.
 */
export function resolveStudioDrawingPointerCaptureTarget(
  stage: StudioDrawingPointerStageLike | null | undefined,
  pointerEvent: PointerEvent
): StudioDrawingPointerCaptureTarget | null {
  try {
    if (hasPointerCaptureSetter(stage?.content)) return stage.content ?? null;
  } catch {
    // A detached/custom Stage can expose a throwing content accessor. Fall through to the event.
  }
  try {
    return hasPointerCaptureSetter(pointerEvent.target) ? pointerEvent.target : null;
  } catch {
    return null;
  }
}

/**
 * Owns the browser transport for exactly one drawing pointer. Domain mutation stays behind the
 * callback ports so this module remains React-, Konva-, CRDT-, and document-model-free.
 */
export class StudioDrawingPointerTransportController {
  private captureTarget: StudioDrawingPointerCaptureTarget | null = null;
  private diagnostics = emptyTransportDiagnostics();
  private terminalClaimed = false;
  private readonly handledNativeEndEvents = new WeakSet<PointerEvent>();
  private ports: StudioDrawingPointerTransportPorts = EMPTY_PORTS;
  private safetyCleanup: (() => void) | null = null;
  private session: StudioStrokePointerSession | null = null;

  constructor(
    private readonly environment: StudioDrawingPointerTransportEnvironment = {}
  ) {}

  updatePorts(ports: StudioDrawingPointerTransportPorts): void {
    this.ports = ports;
  }

  getSession(): StudioStrokePointerSession | null {
    return this.session;
  }

  getCaptureTarget(): StudioDrawingPointerCaptureTarget | null {
    return this.captureTarget;
  }

  getDiagnostics(): StudioDrawingPointerTransportDiagnostics {
    return { ...this.diagnostics };
  }

  owns(pointerEvent: PointerEvent): boolean {
    return isStudioStrokePointerEvent(this.session, pointerEvent);
  }

  replaceSession(session: StudioStrokePointerSession): boolean {
    if (!this.session || session.pointerId !== this.session.pointerId) return false;
    this.session = session;
    return true;
  }

  consumeHandledNativeEnd(pointerEvent: PointerEvent): boolean {
    return this.handledNativeEndEvents.delete(pointerEvent);
  }

  start(input: StartStudioDrawingPointerTransportInput): StartStudioDrawingPointerTransportResult {
    if (this.session || !isStudioStrokePointerEvent(input.session, input.pointerEvent)) {
      return { captured: false, started: false };
    }

    const captureTarget = resolveStudioDrawingPointerCaptureTarget(
      input.stage,
      input.pointerEvent
    );
    this.diagnostics = emptyTransportDiagnostics();
    this.terminalClaimed = false;
    this.session = input.session;
    this.captureTarget = captureTarget;
    const captured = tryCaptureStudioStrokePointer(captureTarget, input.session.pointerId);
    try {
      this.safetyCleanup = this.installSafetyListeners(input.session, captureTarget);
      return { captured, started: true };
    } catch {
      // No partially armed session may survive an unusual host/WebView listener failure.
      this.release();
      return { captured: false, started: false };
    }
  }

  release(): void {
    const session = this.session;
    const captureTarget = this.captureTarget;
    const safetyCleanup = this.safetyCleanup;
    // Clear ownership before DOM teardown. releasePointerCapture can synchronously dispatch a loss
    // event in some hosts; that event must observe an already-closed session.
    this.session = null;
    this.captureTarget = null;
    this.safetyCleanup = null;
    this.terminalClaimed = false;
    safetyCleanup?.();
    if (session) tryReleaseStudioStrokePointer(captureTarget, session.pointerId);
  }

  /** StrictMode-safe lifecycle cleanup; the stable controller can be armed again after replay. */
  dispose(): void {
    this.release();
  }

  private noteDeliveryAfterTerminalClaim(): void {
    this.diagnostics.deliveriesAfterTerminalClaim += 1;
  }

  private requestFinish(
    pointerEvent: PointerEvent,
    request: StudioDrawingPointerFinishRequest
  ): boolean {
    if (this.terminalClaimed) {
      this.noteDeliveryAfterTerminalClaim();
      return false;
    }
    this.terminalClaimed = true;
    this.diagnostics.finishRequests += 1;
    try {
      this.ports.onFinish(pointerEvent, request);
    } catch (cause) {
      // A throwing consumer must not leave a captured pointer and high-rate listeners armed.
      this.release();
      throw cause;
    }
    return true;
  }

  private requestDiscard(): boolean {
    if (this.terminalClaimed) {
      this.noteDeliveryAfterTerminalClaim();
      return false;
    }
    this.terminalClaimed = true;
    this.diagnostics.discardRequests += 1;
    try {
      this.ports.onDiscard();
    } catch (cause) {
      this.release();
      throw cause;
    }
    return true;
  }

  private installSafetyListeners(
    startedSession: StudioStrokePointerSession,
    captureTarget: StudioDrawingPointerCaptureTarget | null
  ): () => void {
    const pointerId = startedSession.pointerId;
    const windowTarget = Object.hasOwn(this.environment, "windowTarget")
      ? this.environment.windowTarget ?? null
      : defaultWindowTarget();
    const documentTarget = Object.hasOwn(this.environment, "documentTarget")
      ? this.environment.documentTarget ?? null
      : defaultDocumentTarget();
    const removers: Array<() => void> = [];
    const add = (
      target: StudioDrawingPointerEventTarget,
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions
    ) => {
      target.addEventListener(type, listener, options);
      removers.push(() => {
        try {
          target.removeEventListener(type, listener, options);
        } catch {
          // Detached WebView targets can throw during teardown; the remaining listeners still clear.
        }
      });
    };

    const onGlobalMove: EventListener = (event) => {
      const pointerEvent = event as PointerEvent;
      const session = this.session;
      if (!session || session.pointerId !== pointerId) return;
      if (this.terminalClaimed) {
        this.noteDeliveryAfterTerminalClaim();
        return;
      }
      if (shouldEndStudioStrokeForReleasedContact(session, pointerEvent)) {
        this.requestFinish(pointerEvent, {
          cancelled: false,
          consumeReleaseSample: false,
          reason: "released-contact",
        });
        return;
      }
      const claim = claimStudioStrokeMoveTransport(session, pointerEvent, "pointermove");
      this.session = claim.session;
      if (claim.accepted) {
        this.diagnostics.authoritativeMoveDeliveries += 1;
        this.ports.onAuthoritativeMove(pointerEvent);
      }
    };
    const onGlobalRawPreviewMove: EventListener = (event) => {
      const pointerEvent = event as PointerEvent;
      const session = this.session;
      if (!session || session.pointerId !== pointerId) return;
      if (this.terminalClaimed) {
        this.noteDeliveryAfterTerminalClaim();
        return;
      }
      const claim = claimStudioStrokeMoveTransport(session, pointerEvent, "pointerrawupdate");
      this.session = claim.session;
      // Pointer Events guarantees rawupdate before its corresponding processed move. Keep this
      // channel visual-only: the later pointermove/coalesced batch remains the sole ink authority.
      if (isStudioStrokePointerEvent(session, pointerEvent)) {
        this.diagnostics.rawPreviewDeliveries += 1;
        this.ports.onRawPreviewMove(pointerEvent);
      }
    };
    const onGlobalEnd: EventListener = (event) => {
      const pointerEvent = event as PointerEvent;
      if (!Number.isFinite(pointerEvent.pointerId) || pointerEvent.pointerId !== pointerId) return;
      const session = this.session;
      if (!session || session.pointerId !== pointerId) return;
      this.handledNativeEndEvents.add(pointerEvent);
      if (event.type === "pointercancel") {
        if (shouldCommitStudioStrokeOnPointerCancel(session, pointerEvent)) {
          this.requestFinish(pointerEvent, {
            cancelled: true,
            consumeReleaseSample: false,
            reason: "pointercancel-prefix",
          });
        } else {
          this.requestDiscard();
        }
        return;
      }
      this.requestFinish(pointerEvent, {
        cancelled: false,
        consumeReleaseSample: true,
        reason: "pointerup",
      });
    };
    const onGlobalAbort: EventListener = (event) => {
      const session = this.session;
      if (!session || session.pointerId !== pointerId) return;
      if (event.type === "blur" && !isStudioTopLevelWindowBlur(event.target, windowTarget)) return;
      const lastPointerSample = this.ports.getLastAuthoritativePointer();
      if (
        shouldPreserveStudioStrokeOnTransportAbort(session)
        && lastPointerSample
        && isStudioStrokePointerEvent(session, lastPointerSample)
      ) {
        this.requestFinish(lastPointerSample, {
          cancelled: true,
          consumeReleaseSample: false,
          reason: "transport-abort",
        });
        return;
      }
      this.requestDiscard();
    };
    const onVisibilityChange: EventListener = (event) => {
      if (documentTarget?.visibilityState !== "visible") onGlobalAbort(event);
    };
    const onLostPointerCapture: EventListener = (event) => {
      const pointerEvent = event as PointerEvent;
      const outcome = resolveStudioPointerCaptureLoss(this.session, pointerEvent);
      if (outcome === "foreign") return;
      // The registered remover retains the old target; release no longer tries to free capture that
      // the browser has already reported lost.
      this.captureTarget = null;
      if (outcome === "finish") {
        this.requestFinish(pointerEvent, {
          cancelled: false,
          consumeReleaseSample: false,
          reason: "lost-capture",
        });
      }
    };

    try {
      if (windowTarget) {
        // Capture phase makes processed pointermove/coalesced samples authoritative before Konva.
        add(windowTarget, "pointermove", onGlobalMove, true);
        // The high-rate listener exists only for an active pen contact and is removed on release.
        // Mouse/touch keep the ordinary processed path, avoiding unnecessary main-thread traffic.
        if (startedSession.pointerType === "pen") {
          add(windowTarget, "pointerrawupdate", onGlobalRawPreviewMove, true);
        }
        add(windowTarget, "pointerup", onGlobalEnd, true);
        add(windowTarget, "pointercancel", onGlobalEnd, true);
        add(windowTarget, "blur", onGlobalAbort);
        add(windowTarget, "pagehide", onGlobalAbort, true);
      }
      if (documentTarget) {
        add(documentTarget, "visibilitychange", onVisibilityChange, true);
      }
      if (
        captureTarget
        && typeof captureTarget.addEventListener === "function"
        && typeof captureTarget.removeEventListener === "function"
      ) {
        add(captureTarget as StudioDrawingPointerEventTarget, "lostpointercapture", onLostPointerCapture, true);
      }
    } catch (cause) {
      for (const remove of removers.toReversed()) remove();
      throw cause;
    }

    return () => {
      for (const remove of removers.toReversed()) remove();
    };
  }
}

export function createStudioDrawingPointerTransportController(
  environment: StudioDrawingPointerTransportEnvironment = {}
): StudioDrawingPointerTransportController {
  return new StudioDrawingPointerTransportController(environment);
}

export type StudioDrawingPointerTransport = StudioDrawingPointerTransportController;

export function requireStudioDrawingPointerTransport(ref: {
  current: StudioDrawingPointerTransport | null;
}): StudioDrawingPointerTransport {
  const transport = ref.current;
  if (transport === null) {
    throw new Error("Studio drawing pointer transport is not initialized");
  }
  return transport;
}
