import { describe, expect, it, vi } from "vitest";

import {
  StudioWebXrSessionError,
  createStudioWebXrSessionController,
  studioWebXrSessionErrorMessage,
  type StudioWebXrEnvironment,
  type StudioWebXrRendererPort,
  type StudioWebXrSystemPort,
} from "./studio-webxr-session";

class FakeSession extends EventTarget {
  readonly end = vi.fn(async () => {
    this.dispatchEvent(sessionEvent(this as unknown as XRSession));
  });
}

class DeferredEndSession extends EventTarget {
  private resolveEnd!: () => void;
  private readonly endCompletion = new Promise<void>((resolve) => {
    this.resolveEnd = resolve;
  });

  readonly end = vi.fn(() => this.endCompletion);

  finishNativeEnd(): void {
    this.dispatchEvent(sessionEvent(this as unknown as XRSession));
    this.resolveEnd();
  }
}

function sessionEvent(session: XRSession): XRSessionEvent {
  const event = new Event("end") as XRSessionEvent;
  Object.defineProperty(event, "session", { value: session });
  return event;
}

function setup(input: {
  readonly secureContext?: boolean;
  readonly xr?: StudioWebXrSystemPort | null;
  readonly setSession?: (session: XRSession | null) => Promise<void>;
  readonly domOverlayRoot?: Element | null;
  readonly session?: XRSession;
  readonly attachmentPrivacyTimeoutMs?: number;
} = {}) {
  const session = input.session ?? new FakeSession() as unknown as XRSession;
  let rendererSession: XRSession | null = null;
  let rendererPresenting = false;
  const rendererNativeEnd = vi.fn(() => {
    if (!rendererSession) throw new Error("Three session was cleared during native end dispatch");
    rendererSession = null;
    rendererPresenting = false;
  });
  const renderer: StudioWebXrRendererPort = {
    enabled: false,
    get isPresenting() {
      return rendererPresenting;
    },
    setReferenceSpaceType: vi.fn(),
    setSession: vi.fn(async (next) => {
      if (next) {
        rendererSession = next;
        rendererPresenting = true;
        next.addEventListener("end", rendererNativeEnd);
      } else {
        rendererSession?.removeEventListener("end", rendererNativeEnd);
        rendererSession = null;
        rendererPresenting = false;
      }
      if (input.setSession) await input.setSession(next);
      // Three keeps the private session value cleared by native end, but its late continuation
      // still flips isPresenting back to true after the awaited reference-space work.
      rendererPresenting = next !== null;
    }),
    getSession: () => rendererSession,
  };
  const xr = input.xr === undefined
    ? {
        isSessionSupported: vi.fn(async () => true),
        requestSession: vi.fn(async () => session),
      }
    : input.xr;
  const environment: StudioWebXrEnvironment = {
    secureContext: input.secureContext ?? true,
    xr,
  };
  const states: string[] = [];
  const controller = createStudioWebXrSessionController({
    renderer,
    environment,
    domOverlayRoot: input.domOverlayRoot ?? null,
    onStateChange: (state) => states.push(state.status),
    attachmentPrivacyTimeoutMs: input.attachmentPrivacyTimeoutMs,
  });
  return { controller, environment, renderer, rendererNativeEnd, session, states, xr };
}

describe("studio WebXR session controller", () => {
  it("reports secure-context and browser availability without requesting a session", async () => {
    const insecure = setup({ secureContext: false });
    await expect(insecure.controller.inspectSupport()).resolves.toMatchObject({
      secureContext: false,
      immersiveAr: "unsupported",
      immersiveVr: "unsupported",
    });
    expect(insecure.xr && vi.mocked(insecure.xr.requestSession)).not.toHaveBeenCalled();

    const unavailable = setup({ xr: null });
    await expect(unavailable.controller.inspectSupport()).resolves.toMatchObject({
      secureContext: true,
      immersiveAr: "unsupported",
      immersiveVr: "unsupported",
    });
  });

  it("probes AR and VR independently and contains probe failures as unknown", async () => {
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async (mode) => {
        if (mode === "immersive-vr") throw new Error("probe failed");
        return true;
      }),
      requestSession: vi.fn(),
    };
    const { controller } = setup({ xr });
    await expect(controller.inspectSupport()).resolves.toMatchObject({
      immersiveAr: "supported",
      immersiveVr: "unknown",
    });
  });

  it("invokes requestSession in the initiating turn and attaches AR to Three", async () => {
    let resolveSession!: (session: XRSession) => void;
    const sessionPromise = new Promise<XRSession>((resolve) => {
      resolveSession = resolve;
    });
    const requestSession = vi.fn<StudioWebXrSystemPort["requestSession"]>(
      (_mode, _options) => sessionPromise,
    );
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession,
    };
    const { controller, renderer, session, states } = setup({ xr });

    const starting = controller.start("immersive-ar");
    expect(requestSession).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["requesting"]);
    expect(requestSession).toHaveBeenCalledWith(
      "immersive-ar",
      expect.objectContaining({
        requiredFeatures: ["local"],
      }),
    );
    expect(vi.mocked(requestSession).mock.calls[0]?.[1]).not.toHaveProperty("optionalFeatures");
    resolveSession(session);
    await expect(starting).resolves.toBe(session);
    expect(renderer.enabled).toBe(true);
    expect(renderer.setReferenceSpaceType).toHaveBeenCalledWith("local");
    expect(renderer.setSession).toHaveBeenCalledWith(session);
    expect(controller.state).toEqual({ status: "presenting", mode: "immersive-ar" });
  });

  it("requests only the DOM overlay feature that the AR product surface actually uses", async () => {
    const domOverlayRoot = {} as Element;
    const { controller, xr } = setup({ domOverlayRoot });
    await controller.start("immersive-ar");
    expect(xr && vi.mocked(xr.requestSession)).toHaveBeenCalledWith(
      "immersive-ar",
      {
        requiredFeatures: ["local"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: domOverlayRoot },
      },
    );
  });

  it("uses the authored local rig for VR and restores renderer ownership after end", async () => {
    const { controller, renderer, session, states } = setup();
    await controller.start("immersive-vr");
    expect(renderer.setReferenceSpaceType).toHaveBeenCalledWith("local");
    await controller.end();
    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(renderer.enabled).toBe(false);
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting", "presenting", "ending", "idle"]);
  });

  it("lets Three's later native-end listener restore renderer state before publishing idle", async () => {
    const { controller, renderer, rendererNativeEnd } = setup();
    await controller.start("immersive-vr");
    await controller.end();
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(controller.state).toEqual({ status: "idle" });
  });

  it("responds to a device-owned session end and removes the active session", async () => {
    const { controller, renderer, session } = setup();
    await controller.start("immersive-vr");
    session.dispatchEvent(sessionEvent(session));
    await Promise.resolve();
    await Promise.resolve();
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(controller.activeSession).toBeNull();
  });

  it("fails unsupported cached modes before asking for device permission", async () => {
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async (mode) => mode === "immersive-vr"),
      requestSession: vi.fn(),
    };
    const { controller } = setup({ xr });
    await controller.inspectSupport();
    await expect(controller.start("immersive-ar")).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(xr.requestSession).not.toHaveBeenCalled();
  });

  it("normalizes permission rejection without retaining browser details", async () => {
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => {
        throw new DOMException("camera serial 123", "NotAllowedError");
      }),
    };
    const { controller } = setup({ xr });
    await expect(controller.start("immersive-ar")).rejects.toBeInstanceOf(
      StudioWebXrSessionError,
    );
    expect(controller.state).toEqual({
      status: "error",
      mode: "immersive-ar",
      code: "request-failed",
    });
    expect(studioWebXrSessionErrorMessage("request-failed")).not.toContain("123");
  });

  it("ends a granted session and restores renderer state when attachment fails", async () => {
    const { controller, renderer, session } = setup({
      setSession: async (next) => {
        if (next) throw new Error("attach failed");
      },
    });
    await expect(controller.start("immersive-vr")).rejects.toMatchObject({
      code: "renderer-failed",
    });
    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(renderer.enabled).toBe(false);
    expect(controller.activeSession).toBeNull();
  });

  it("rejects concurrent transitions and disposes an active session exactly once", async () => {
    let resolveSession!: (session: XRSession) => void;
    const request = new Promise<XRSession>((resolve) => {
      resolveSession = resolve;
    });
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(() => request),
    };
    const { controller, session } = setup({ xr });
    const starting = controller.start("immersive-vr");
    await expect(controller.start("immersive-ar")).rejects.toMatchObject({ code: "busy" });
    resolveSession(session);
    await starting;
    await controller.dispose();
    await controller.dispose();
    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    await expect(controller.start("immersive-vr")).rejects.toMatchObject({ code: "disposed" });
  });

  it("disposes immediately while requestSession remains pending and ends a late grant before attach", async () => {
    let resolveSession!: (session: XRSession) => void;
    const request = new Promise<XRSession>((resolve) => {
      resolveSession = resolve;
    });
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(() => request),
    };
    const { controller, renderer, session, states } = setup({ xr });

    const starting = controller.start("immersive-ar");
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    await expect(controller.dispose()).resolves.toBeUndefined();
    expect(renderer.setSession).not.toHaveBeenCalled();

    resolveSession(session);
    await rejected;
    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalled();
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting"]);
  });

  it("contains a late request rejection after dispose without publishing an error state", async () => {
    let rejectSession!: (cause: unknown) => void;
    const request = new Promise<XRSession>((_resolve, reject) => {
      rejectSession = reject;
    });
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(() => request),
    };
    const { controller, renderer, states } = setup({ xr });

    const starting = controller.start("immersive-vr");
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    await controller.dispose();
    rejectSession(new DOMException("late device rejection", "NotAllowedError"));

    await rejected;
    expect(states).toEqual(["requesting"]);
    expect(renderer.setSession).not.toHaveBeenCalled();
  });

  it("makes repeated pending-request disposal idempotent and still rejects a late grant", async () => {
    let resolveSession!: (session: XRSession) => void;
    const request = new Promise<XRSession>((resolve) => {
      resolveSession = resolve;
    });
    const xr: StudioWebXrSystemPort = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(() => request),
    };
    const { controller, renderer, session } = setup({ xr });

    const starting = controller.start("immersive-vr");
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    await Promise.all([controller.dispose(), controller.dispose(), controller.dispose()]);
    resolveSession(session);

    await rejected;
    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalled();
  });

  it("defers native end while Three attachment is pending and cannot revive presentation after close", async () => {
    let resolveAttachment!: () => void;
    const attachment = new Promise<void>((resolve) => {
      resolveAttachment = resolve;
    });
    const { controller, renderer, rendererNativeEnd, session, states } = setup({
      setSession: async (next) => {
        if (next) await attachment;
      },
    });

    const starting = controller.start("immersive-vr");
    await vi.waitFor(() => expect(renderer.setSession).toHaveBeenCalledWith(session));
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    const disposing = controller.dispose();
    const repeatedDisposal = controller.dispose();

    expect(repeatedDisposal).toBe(disposing);
    expect((session as unknown as FakeSession).end).not.toHaveBeenCalled();
    expect(renderer.isPresenting).toBe(true);

    resolveAttachment();
    await Promise.all([rejected, disposing, repeatedDisposal]);

    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.getSession()).toBeNull();
    expect(renderer.isPresenting).toBe(false);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting"]);
  });

  it("rejects a device end during attachment and releases the poisoned renderer generation", async () => {
    let resolveAttachment!: () => void;
    const attachment = new Promise<void>((resolve) => {
      resolveAttachment = resolve;
    });
    const { controller, renderer, rendererNativeEnd, session, states, xr } = setup({
      setSession: async (next) => {
        if (next) await attachment;
      },
    });

    const starting = controller.start("immersive-ar");
    await vi.waitFor(() => expect(renderer.setSession).toHaveBeenCalledWith(session));

    // The device ends before Three's non-cancellable setSession continuation settles. Its native
    // listener releases first, then the late continuation below deliberately revives presenting.
    session.dispatchEvent(sessionEvent(session));
    resolveAttachment();

    await expect(starting).rejects.toMatchObject({ code: "renderer-failed" });
    await vi.waitFor(() => {
      expect(controller.state).toEqual({
        status: "error",
        mode: "immersive-ar",
        code: "renderer-failed",
      });
    });
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.getSession()).toBeNull();
    expect(renderer.isPresenting).toBe(true);
    expect(controller.activeSession).toBeNull();
    expect(controller.requiresRendererRecreation).toBe(true);

    await expect(controller.start("immersive-vr")).rejects.toMatchObject({
      code: "renderer-failed",
    });
    expect(xr && vi.mocked(xr.requestSession)).toHaveBeenCalledTimes(1);
    await expect(controller.dispose()).resolves.toBeUndefined();
    expect((session as unknown as FakeSession).end).not.toHaveBeenCalled();
    expect(states).toEqual(["requesting", "error", "error"]);
  });

  it("watchdogs an indefinitely pending attach without releasing Three before its native end", async () => {
    let resolveAttachment!: () => void;
    const attachment = new Promise<void>((resolve) => {
      resolveAttachment = resolve;
    });
    const session = new DeferredEndSession();
    const { controller, renderer, rendererNativeEnd, states } = setup({
      attachmentPrivacyTimeoutMs: 5,
      session: session as unknown as XRSession,
      setSession: async (next) => {
        if (next) await attachment;
      },
    });

    const starting = controller.start("immersive-ar");
    await vi.waitFor(() => expect(renderer.setSession).toHaveBeenCalledWith(session));
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    const disposing = controller.dispose();

    await vi.waitFor(() => expect(session.end).toHaveBeenCalledTimes(1));
    expect(renderer.isPresenting).toBe(true);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);

    resolveAttachment();
    await attachment;
    await Promise.resolve();
    session.finishNativeEnd();
    await Promise.all([rejected, disposing]);

    expect(session.end).toHaveBeenCalledTimes(1);
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.getSession()).toBeNull();
    expect(renderer.isPresenting).toBe(false);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(states).toEqual(["requesting"]);
  });

  it("contains a late Three attachment rejection after close and ends the grant exactly once", async () => {
    let rejectAttachment!: (cause: unknown) => void;
    const attachment = new Promise<void>((_resolve, reject) => {
      rejectAttachment = reject;
    });
    const { controller, renderer, session, states } = setup({
      setSession: async (next) => {
        if (next) await attachment;
      },
    });

    const starting = controller.start("immersive-ar");
    await vi.waitFor(() => expect(renderer.setSession).toHaveBeenCalledWith(session));
    const rejected = expect(starting).rejects.toMatchObject({ code: "disposed" });
    const disposing = controller.dispose();

    expect((session as unknown as FakeSession).end).not.toHaveBeenCalled();
    rejectAttachment(new Error("late Three attachment failure"));
    await Promise.all([rejected, disposing]);

    expect((session as unknown as FakeSession).end).toHaveBeenCalledTimes(1);
    expect(renderer.getSession()).toBeNull();
    expect(renderer.isPresenting).toBe(false);
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting"]);
  });

  it("starts native end synchronously on active disposal and leaves Three's listener ordering intact", async () => {
    const deferredSession = new DeferredEndSession();
    const { controller, renderer, rendererNativeEnd, states } = setup({
      session: deferredSession as unknown as XRSession,
    });
    await controller.start("immersive-vr");

    const disposing = controller.dispose();
    expect(deferredSession.end).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["requesting", "presenting"]);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);

    deferredSession.finishNativeEnd();
    await disposing;
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting", "presenting"]);
  });

  it("coalesces an ending transition with repeated disposal and ignores the late native end", async () => {
    const deferredSession = new DeferredEndSession();
    const { controller, renderer, rendererNativeEnd, states } = setup({
      session: deferredSession as unknown as XRSession,
    });
    await controller.start("immersive-ar");

    const ending = controller.end();
    expect(states).toEqual(["requesting", "presenting", "ending"]);
    expect(deferredSession.end).toHaveBeenCalledTimes(1);
    const disposals = [controller.dispose(), controller.dispose()];
    expect(deferredSession.end).toHaveBeenCalledTimes(1);

    deferredSession.finishNativeEnd();
    await Promise.all([ending, ...disposals]);
    expect(rendererNativeEnd).toHaveBeenCalledTimes(1);
    expect(renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(controller.activeSession).toBeNull();
    expect(states).toEqual(["requesting", "presenting", "ending"]);
  });
});
