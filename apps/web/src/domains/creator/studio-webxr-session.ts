/**
 * Narrow WebXR session authority for Studio's existing Three.js renderer.
 *
 * The browser owns XR tracking and the Three WebXRManager owns presentation. Nothing in this
 * module is project data: XRSession, reference spaces, frames, and device handles must never be
 * serialized into a Studio project or OPFS document.
 */

export const STUDIO_WEBXR_SESSION_VERSION = 1 as const;
export const STUDIO_WEBXR_ATTACH_PRIVACY_TIMEOUT_MS = 1_500;

export type StudioWebXrMode = "immersive-ar" | "immersive-vr";
export type StudioWebXrSupportLevel = "supported" | "unsupported" | "unknown";

export interface StudioWebXrSupportSnapshot {
  readonly kind: "toonspectrum.studio-webxr-support";
  readonly version: typeof STUDIO_WEBXR_SESSION_VERSION;
  readonly secureContext: boolean;
  readonly immersiveAr: StudioWebXrSupportLevel;
  readonly immersiveVr: StudioWebXrSupportLevel;
}

export type StudioWebXrSessionState =
  | { readonly status: "idle" }
  | { readonly status: "requesting"; readonly mode: StudioWebXrMode }
  | { readonly status: "presenting"; readonly mode: StudioWebXrMode }
  | { readonly status: "ending"; readonly mode: StudioWebXrMode }
  | {
      readonly status: "error";
      readonly mode: StudioWebXrMode | null;
      readonly code: StudioWebXrSessionErrorCode;
    };

export type StudioWebXrSessionErrorCode =
  | "insecure-context"
  | "unavailable"
  | "unsupported"
  | "busy"
  | "request-failed"
  | "renderer-failed"
  | "disposed";

export class StudioWebXrSessionError extends Error {
  readonly code: StudioWebXrSessionErrorCode;

  constructor(code: StudioWebXrSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioWebXrSessionError";
    this.code = code;
  }
}

export interface StudioWebXrSystemPort {
  isSessionSupported(mode: StudioWebXrMode): Promise<boolean>;
  requestSession(mode: StudioWebXrMode, options?: XRSessionInit): Promise<XRSession>;
}

export interface StudioWebXrEnvironment {
  readonly secureContext: boolean;
  readonly xr: StudioWebXrSystemPort | null;
}

/** The exact subset of THREE.WebXRManager used by the controller. */
export interface StudioWebXrRendererPort {
  enabled: boolean;
  readonly isPresenting: boolean;
  setReferenceSpaceType(type: XRReferenceSpaceType): void;
  setSession(session: XRSession | null): Promise<void>;
  getSession(): XRSession | null;
  /** Resolves only after the renderer's own native-end listener has released presentation. */
  waitUntilReleased?(session: XRSession): Promise<void>;
}

export interface StudioWebXrSessionController {
  readonly state: StudioWebXrSessionState;
  readonly activeSession: XRSession | null;
  /**
   * True only after the browser ended a session while Three's non-cancellable attachment was
   * still live and the manager revived presentation after its native-end cleanup. The owner must
   * replace that one Canvas after dispose() settles; the poisoned WebXRManager cannot be repaired
   * through its public API without racing its private continuation.
   */
  readonly requiresRendererRecreation: boolean;
  inspectSupport(): Promise<StudioWebXrSupportSnapshot>;
  start(mode: StudioWebXrMode): Promise<XRSession>;
  end(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateStudioWebXrSessionControllerOptions {
  readonly renderer: StudioWebXrRendererPort;
  readonly environment?: StudioWebXrEnvironment;
  readonly domOverlayRoot?: Element | null;
  readonly onStateChange?: (state: StudioWebXrSessionState) => void;
  /** Deterministic test seam; product uses the bounded privacy timeout above. */
  readonly attachmentPrivacyTimeoutMs?: number;
}

function readProductEnvironment(): StudioWebXrEnvironment {
  const browserNavigator = typeof navigator === "undefined" ? null : navigator;
  return {
    secureContext: globalThis.isSecureContext === true,
    xr: browserNavigator?.xr ?? null,
  };
}

function supportForMode(
  snapshot: StudioWebXrSupportSnapshot,
  mode: StudioWebXrMode,
): StudioWebXrSupportLevel {
  return mode === "immersive-ar" ? snapshot.immersiveAr : snapshot.immersiveVr;
}

function sessionInitForMode(
  mode: StudioWebXrMode,
  domOverlayRoot: Element | null,
): XRSessionInit {
  if (mode === "immersive-ar") {
    return {
      requiredFeatures: ["local"],
      ...(domOverlayRoot
        ? {
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: domOverlayRoot },
          }
        : {}),
    };
  }
  return {
    // The authored shot already supplies the rig origin. `local-floor` would add the viewer's
    // physical eye height a second time on devices whose floor origin is calibrated.
    requiredFeatures: ["local"],
  };
}

function referenceSpaceForMode(_mode: StudioWebXrMode): XRReferenceSpaceType {
  return "local";
}

function stateMode(state: StudioWebXrSessionState): StudioWebXrMode | null {
  return state.status === "idle" ? null : state.mode;
}

function toRequestError(mode: StudioWebXrMode, cause: unknown): StudioWebXrSessionError {
  return new StudioWebXrSessionError(
    "request-failed",
    `${mode} WebXR session request failed.`,
    { cause },
  );
}

export function createStudioWebXrSessionController(
  options: CreateStudioWebXrSessionControllerOptions,
): StudioWebXrSessionController {
  const environment = options.environment ?? readProductEnvironment();
  const domOverlayRoot = options.domOverlayRoot ?? null;
  let currentState: StudioWebXrSessionState = { status: "idle" };
  let supportSnapshot: StudioWebXrSupportSnapshot | null = null;
  let activeSession: XRSession | null = null;
  let disposed = false;
  let lifecycleGeneration = 0;
  let rendererEnabledBeforeSession = options.renderer.enabled;
  let cleanupPromise: Promise<void> | null = null;
  let rendererAttachmentSession: XRSession | null = null;
  let rendererAttachmentPromise: Promise<void> | null = null;
  let rendererReleaseBlockedSession: XRSession | null = null;
  let nativeEndedSession: XRSession | null = null;
  let nativeEndedDuringAttachmentSession: XRSession | null = null;
  let rendererRecreationSession: XRSession | null = null;
  let endRequestSession: XRSession | null = null;
  let endRequestPromise: Promise<void> | null = null;
  let disposalPromise: Promise<void> | null = null;
  const attachmentPrivacyTimeoutMs = Number.isFinite(options.attachmentPrivacyTimeoutMs)
    ? Math.max(1, Math.floor(options.attachmentPrivacyTimeoutMs!))
    : STUDIO_WEBXR_ATTACH_PRIVACY_TIMEOUT_MS;

  const publishState = (state: StudioWebXrSessionState) => {
    currentState = Object.freeze(state);
    options.onStateChange?.(currentState);
  };

  const detachAfterNativeEnd = async (session: XRSession): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    if (activeSession !== session) return;
    const pendingRendererAttachment = rendererAttachmentSession === session
      ? rendererAttachmentPromise
      : null;
    cleanupPromise = (async () => {
      // A device-owned end can arrive while Three is still awaiting makeXRCompatible() or a
      // reference space. Do not decide renderer release until that continuation has settled.
      // Product-owned disposal avoids creating this race in the first place by deferring end().
      if (pendingRendererAttachment) {
        try {
          await pendingRendererAttachment;
        } catch {
          // Attachment failure is handled by start(); cleanup still owns the session reference.
        }
      }
      session.removeEventListener("end", onSessionEnd);
      // This listener is registered before Three.WebXRManager's own `end` listener. Yield until
      // the native event dispatch has let Three restore its framebuffer, viewport, animation
      // loop, and private session reference. Calling setSession(null) from inside this callback
      // would null Three's private session before its listener can remove its event handlers.
      await Promise.resolve();
      const rendererReleased = options.renderer.getSession() !== session
        && !options.renderer.isPresenting;
      rendererReleaseBlockedSession = rendererReleased ? null : session;
      rendererRecreationSession = !rendererReleased && nativeEndedSession === session
        ? session
        : null;
      activeSession = null;
      options.renderer.enabled = rendererEnabledBeforeSession;
      cleanupPromise = null;
      if (!disposed) {
        publishState(
          nativeEndedDuringAttachmentSession === session || !rendererReleased
            ? { status: "error", mode: stateMode(currentState), code: "renderer-failed" }
            : { status: "idle" },
        );
      }
    })();
    return cleanupPromise;
  };

  function onSessionEnd(event: XRSessionEvent): void {
    // This fence must be written before any await. Three's own end listener runs later in the same
    // native dispatch, but an already-pending setSession() continuation can subsequently revive
    // `isPresenting` with a null private session. start() must never publish presenting after this.
    nativeEndedSession = event.session;
    if (
      rendererAttachmentSession === event.session
      && rendererAttachmentPromise !== null
    ) {
      nativeEndedDuringAttachmentSession = event.session;
    }
    void detachAfterNativeEnd(event.session);
  }

  const requestSessionEnd = (session: XRSession): Promise<void> => {
    if (endRequestSession === session && endRequestPromise) return endRequestPromise;
    endRequestSession = session;
    if (nativeEndedSession === session) {
      endRequestPromise = Promise.resolve();
      return endRequestPromise;
    }
    try {
      endRequestPromise = session.end().catch(() => undefined);
    } catch {
      endRequestPromise = Promise.resolve();
    }
    return endRequestPromise;
  };

  const awaitAttachmentWithPrivacyWatchdog = async (
    session: XRSession,
    attachment: Promise<void>,
  ): Promise<void> => {
    let attachmentSettled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const settled = attachment.then(
      () => {
        attachmentSettled = true;
      },
      () => {
        attachmentSettled = true;
      },
    );
    const privacyDeadline = new Promise<void>((resolve) => {
      timeoutId = globalThis.setTimeout(resolve, attachmentPrivacyTimeoutMs);
    });
    await Promise.race([settled, privacyDeadline]);
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    if (!attachmentSettled) {
      // Privacy outranks renderer memory: stop camera/tracking permission after a bounded delay,
      // but keep the hidden renderer alive until Three's non-cancellable continuation settles.
      // The exact session is coalesced by requestSessionEnd(), so product code invokes end once.
      void requestSessionEnd(session);
    }
    try {
      await attachment;
    } catch {
      // start() owns the renderer-failure mapping; disposal still owns native shutdown.
    }
  };

  const waitForRendererRelease = async (session: XRSession): Promise<void> => {
    if (options.renderer.getSession() !== session && !options.renderer.isPresenting) return;
    rendererReleaseBlockedSession = session;
    // A native end that raced the pending Three attachment can leave its manager with
    // getSession() === null and isPresenting === true. Once both the attachment and end dispatch
    // have settled, retaining this promise forever cannot repair it; resolving lets the sole
    // owner unmount this poisoned Canvas before mounting its replacement.
    if (rendererRecreationSession === session) return;
    if (options.renderer.waitUntilReleased) {
      await options.renderer.waitUntilReleased(session);
      if (options.renderer.getSession() !== session && !options.renderer.isPresenting) {
        rendererReleaseBlockedSession = null;
        return;
      }
    }
    // The product port observes Three's `sessionend`. A minimal port can instead wait on the
    // browser session itself; unlike an intentionally never-resolving sentinel, this preserves a
    // real release path and does not permit teardown before native privacy ownership ends.
    await new Promise<void>((resolve) => {
      session.addEventListener("end", () => resolve(), { once: true });
    });
    await Promise.resolve();
    if (options.renderer.getSession() !== session && !options.renderer.isPresenting) {
      rendererReleaseBlockedSession = null;
      return;
    }
    rendererRecreationSession = session;
  };

  const controller: StudioWebXrSessionController = {
    get state() {
      return currentState;
    },
    get activeSession() {
      return activeSession;
    },
    get requiresRendererRecreation() {
      return rendererRecreationSession !== null;
    },
    async inspectSupport() {
      if (disposed) {
        throw new StudioWebXrSessionError("disposed", "WebXR controller is disposed.");
      }
      if (!environment.secureContext || !environment.xr) {
        supportSnapshot = Object.freeze({
          kind: "toonspectrum.studio-webxr-support",
          version: STUDIO_WEBXR_SESSION_VERSION,
          secureContext: environment.secureContext,
          immersiveAr: "unsupported",
          immersiveVr: "unsupported",
        });
        return supportSnapshot;
      }
      const inspectMode = async (mode: StudioWebXrMode): Promise<StudioWebXrSupportLevel> => {
        try {
          return await environment.xr!.isSessionSupported(mode) ? "supported" : "unsupported";
        } catch {
          return "unknown";
        }
      };
      const [immersiveAr, immersiveVr] = await Promise.all([
        inspectMode("immersive-ar"),
        inspectMode("immersive-vr"),
      ]);
      supportSnapshot = Object.freeze({
        kind: "toonspectrum.studio-webxr-support",
        version: STUDIO_WEBXR_SESSION_VERSION,
        secureContext: true,
        immersiveAr,
        immersiveVr,
      });
      return supportSnapshot;
    },
    async start(mode) {
      if (disposed) {
        throw new StudioWebXrSessionError("disposed", "WebXR controller is disposed.");
      }
      if (!environment.secureContext) {
        const error = new StudioWebXrSessionError(
          "insecure-context",
          "WebXR requires a secure browser context.",
        );
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }
      if (!environment.xr) {
        const error = new StudioWebXrSessionError("unavailable", "WebXR is unavailable.");
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }
      if (activeSession || currentState.status === "requesting" || currentState.status === "ending") {
        throw new StudioWebXrSessionError("busy", "Another WebXR transition is active.");
      }
      if (rendererReleaseBlockedSession || rendererRecreationSession) {
        const error = new StudioWebXrSessionError(
          "renderer-failed",
          "The previous WebXR renderer generation must be recreated before another session.",
        );
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }
      if (supportSnapshot && supportForMode(supportSnapshot, mode) === "unsupported") {
        const error = new StudioWebXrSessionError("unsupported", `${mode} is unsupported.`);
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }

      rendererEnabledBeforeSession = options.renderer.enabled;
      const requestGeneration = ++lifecycleGeneration;
      publishState({ status: "requesting", mode });

      // requestSession must be invoked before the first await so the caller's click retains its
      // transient user activation. Support probing is deliberately a separate, earlier action.
      let sessionRequest: Promise<XRSession>;
      try {
        sessionRequest = environment.xr.requestSession(
          mode,
          sessionInitForMode(mode, domOverlayRoot),
        );
      } catch (cause) {
        if (disposed || requestGeneration !== lifecycleGeneration) {
          throw new StudioWebXrSessionError(
            "disposed",
            "WebXR controller was disposed while requesting a session.",
          );
        }
        const error = toRequestError(mode, cause);
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }

      let session: XRSession;
      try {
        session = await sessionRequest;
      } catch (cause) {
        if (disposed || requestGeneration !== lifecycleGeneration) {
          throw new StudioWebXrSessionError(
            "disposed",
            "WebXR controller was disposed while requesting a session.",
          );
        }
        const error = toRequestError(mode, cause);
        publishState({ status: "error", mode, code: error.code });
        throw error;
      }
      if (disposed || requestGeneration !== lifecycleGeneration) {
        await requestSessionEnd(session);
        throw new StudioWebXrSessionError(
          "disposed",
          "WebXR controller was disposed while requesting a session.",
        );
      }

      activeSession = session;
      session.addEventListener("end", onSessionEnd);
      options.renderer.enabled = true;
      options.renderer.setReferenceSpaceType(referenceSpaceForMode(mode));
      try {
        // Three's WebXRManager mutates its private session before awaiting WebGL compatibility and
        // a reference space. Ending the native session during either await lets Three's end
        // listener clean up first and its late continuation revive `isPresenting`. Track the exact
        // attachment so dispose() can keep the renderer alive and defer session.end() until this
        // non-cancellable promise settles.
        const attachment = Promise.resolve(options.renderer.setSession(session));
        rendererAttachmentSession = session;
        rendererAttachmentPromise = attachment;
        await attachment;
      } catch (cause) {
        session.removeEventListener("end", onSessionEnd);
        activeSession = null;
        await requestSessionEnd(session);
        options.renderer.enabled = rendererEnabledBeforeSession;
        if (disposed || requestGeneration !== lifecycleGeneration) {
          throw new StudioWebXrSessionError(
            "disposed",
            "WebXR controller was disposed while attaching a session.",
          );
        }
        const error = new StudioWebXrSessionError(
          "renderer-failed",
          "Three.js could not attach the WebXR session.",
          { cause },
        );
        publishState({ status: "error", mode, code: error.code });
        throw error;
      } finally {
        if (rendererAttachmentSession === session) {
          rendererAttachmentSession = null;
          rendererAttachmentPromise = null;
        }
      }
      if (disposed || requestGeneration !== lifecycleGeneration) {
        await requestSessionEnd(session);
        await detachAfterNativeEnd(session);
        throw new StudioWebXrSessionError(
          "disposed",
          "WebXR controller was disposed while attaching a session.",
        );
      }
      if (nativeEndedSession === session) {
        await detachAfterNativeEnd(session);
        throw new StudioWebXrSessionError(
          "renderer-failed",
          "The WebXR session ended while Three.js was attaching the renderer.",
        );
      }
      publishState({ status: "presenting", mode });
      return session;
    },
    async end() {
      if (disposed && !activeSession) return;
      const session = activeSession;
      if (!session) {
        if (!disposed && currentState.status === "error") publishState({ status: "idle" });
        return;
      }
      const mode = stateMode(currentState) ?? "immersive-vr";
      if (!disposed) publishState({ status: "ending", mode });
      await requestSessionEnd(session);
      await detachAfterNativeEnd(session);
    },
    dispose() {
      if (disposalPromise) return disposalPromise;
      disposed = true;
      lifecycleGeneration += 1;
      const session = activeSession ?? rendererReleaseBlockedSession;
      const pendingRendererAttachment = session && rendererAttachmentSession === session
        ? rendererAttachmentPromise
        : null;
      disposalPromise = (async () => {
        if (!session) return;
        if (pendingRendererAttachment) {
          await awaitAttachmentWithPrivacyWatchdog(session, pendingRendererAttachment);
        }
        // Preserve synchronous native end for an already-presenting session. Only the attaching
        // phase yields above, because ending there is what races Three's private continuation.
        await requestSessionEnd(session);
        await detachAfterNativeEnd(session);
        await waitForRendererRelease(session);
      })();
      return disposalPromise;
    },
  };
  return Object.freeze(controller);
}

export function studioWebXrSessionErrorMessage(code: StudioWebXrSessionErrorCode): string {
  switch (code) {
    case "insecure-context":
      return "AR·VR 미리보기는 HTTPS 보안 연결에서만 열 수 있습니다.";
    case "unavailable":
      return "이 브라우저는 WebXR을 제공하지 않습니다. 기존 3D 미리보기를 계속 사용할 수 있습니다.";
    case "unsupported":
      return "이 기기는 선택한 AR·VR 모드를 지원하지 않습니다.";
    case "busy":
      return "다른 AR·VR 전환이 끝난 뒤 다시 시도해 주세요.";
    case "request-failed":
      return "AR·VR 권한이 거절됐거나 기기 세션을 시작하지 못했습니다.";
    case "renderer-failed":
      return "3D 렌더러가 AR·VR 세션에 연결되지 않아 기존 보기로 돌아왔습니다.";
    case "disposed":
      return "닫힌 3D 장면에서는 AR·VR 세션을 시작할 수 없습니다.";
  }
}
