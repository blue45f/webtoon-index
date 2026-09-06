// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioWebXrSessionController } from "../studio-webxr-session";

import { resetStudioBg3dRetainedOwnerForTests } from "./studio-bg3d-retained-owner";
import {
  BG3D_RETAINED_OWNER_STALE_RELEASE_MS,
  StudioBg3dRetainedOwnerHost,
} from "./StudioBg3dRetainedOwnerHost";
import { StudioBg3dRetainedOwnerRouteBridge } from "./StudioBg3dRetainedOwnerRouteBridge";

import type {
  StudioWebXrRendererPort,
  StudioWebXrSessionController,
} from "../studio-webxr-session";

function sessionEndEvent(session: XRSession): XRSessionEvent {
  const event = new Event("end") as XRSessionEvent;
  Object.defineProperty(event, "session", { value: session });
  return event;
}

class RouteUnmountSession extends EventTarget {
  private resolveEnd!: () => void;
  private readonly endCompletion = new Promise<void>((resolve) => {
    this.resolveEnd = resolve;
  });

  readonly end = vi.fn(() => this.endCompletion);

  finishNativeEnd(): void {
    this.dispatchEvent(sessionEndEvent(this as unknown as XRSession));
    this.resolveEnd();
  }
}

interface Harness {
  readonly attachment: Promise<void>;
  readonly attachmentPrivacyTimeoutMs: number;
  readonly controllerCount: () => number;
  readonly instanceCount: () => number;
  readonly nextInstanceId: () => number;
  readonly recordController: () => void;
  readonly recordUnmount: () => void;
  readonly renderer: StudioWebXrRendererPort;
  readonly resolveAttachment: () => void;
  readonly session: RouteUnmountSession;
  readonly unmountCount: () => number;
}

function createHarness(
  options: { readonly attachmentPrivacyTimeoutMs?: number } = {},
): Harness {
  let resolveAttachment!: () => void;
  const attachment = new Promise<void>((resolve) => {
    resolveAttachment = resolve;
  });
  const session = new RouteUnmountSession();
  let rendererSession: XRSession | null = null;
  let presenting = false;
  let controllerCount = 0;
  let instanceCount = 0;
  let unmountCount = 0;
  const handleNativeEnd = () => {
    rendererSession = null;
    presenting = false;
  };
  const renderer: StudioWebXrRendererPort = {
    enabled: false,
    get isPresenting() {
      return presenting;
    },
    setReferenceSpaceType: vi.fn(),
    setSession: vi.fn(async (next) => {
      if (!next) {
        rendererSession = null;
        presenting = false;
        return;
      }
      rendererSession = next;
      presenting = true;
      next.addEventListener("end", handleNativeEnd);
      await attachment;
      presenting = true;
    }),
    getSession: () => rendererSession,
  };
  return {
    attachment,
    attachmentPrivacyTimeoutMs: options.attachmentPrivacyTimeoutMs ?? 5,
    controllerCount: () => controllerCount,
    instanceCount: () => instanceCount,
    nextInstanceId: () => {
      instanceCount += 1;
      return instanceCount;
    },
    recordController: () => {
      controllerCount += 1;
    },
    recordUnmount: () => {
      unmountCount += 1;
    },
    renderer,
    resolveAttachment,
    session,
    unmountCount: () => unmountCount,
  };
}

function RetainedWebXrCanvas({
  harness,
  onWebXrCleanupPendingChange,
  open,
}: {
  readonly harness: Harness;
  readonly onWebXrCleanupPendingChange?: (pending: boolean) => void;
  readonly open: boolean;
}) {
  const instanceId = useRef(0);
  if (instanceId.current === 0) instanceId.current = harness.nextInstanceId();
  const controllerRef = useRef<StudioWebXrSessionController | null>(null);

  useLayoutEffect(() => {
    const controller = createStudioWebXrSessionController({
      renderer: harness.renderer,
      environment: {
        secureContext: true,
        xr: {
          isSessionSupported: async () => true,
          requestSession: async () => harness.session as unknown as XRSession,
        },
      },
      attachmentPrivacyTimeoutMs: harness.attachmentPrivacyTimeoutMs,
    });
    harness.recordController();
    controllerRef.current = controller;
    void controller.start("immersive-ar").catch(() => undefined);
    return () => {
      harness.recordUnmount();
      controllerRef.current = null;
    };
  }, [harness]);

  useLayoutEffect(() => {
    if (open) return;
    const controller = controllerRef.current;
    if (!controller) {
      onWebXrCleanupPendingChange?.(false);
      return;
    }
    onWebXrCleanupPendingChange?.(true);
    void controller.dispose().then(
      () => onWebXrCleanupPendingChange?.(false),
      () => onWebXrCleanupPendingChange?.(false),
    );
  }, [onWebXrCleanupPendingChange, open]);

  return (
    <canvas
      data-testid="retained-xr-canvas"
      data-instance-id={instanceId.current}
      data-open={String(open)}
    />
  );
}

function RouteOwner({ harness }: { readonly harness: Harness }) {
  return (
    <StudioBg3dRetainedOwnerRouteBridge
      open
      element={<RetainedWebXrCanvas harness={harness} open />}
    />
  );
}

function PassiveCanvas({ id, open }: { readonly id: string; readonly open: boolean }) {
  return <canvas data-testid={`passive-${id}`} data-open={String(open)} />;
}

function PassiveRouteOwner({ id }: { readonly id: string }) {
  return (
    <StudioBg3dRetainedOwnerRouteBridge
      open
      element={<PassiveCanvas id={id} open />}
    />
  );
}

function SuspendedCanvas({ suspension }: {
  readonly onWebXrCleanupPendingChange?: (pending: boolean) => void;
  readonly open: boolean;
  readonly suspension: Promise<void>;
}): React.ReactNode {
  throw suspension;
}

function SuspendedRouteOwner({ suspension }: { readonly suspension: Promise<void> }) {
  return (
    <StudioBg3dRetainedOwnerRouteBridge
      open
      element={<SuspendedCanvas open suspension={suspension} />}
    />
  );
}

afterEach(() => {
  cleanup();
  resetStudioBg3dRetainedOwnerForTests();
  vi.restoreAllMocks();
});

describe("Studio BG3D route-independent WebXR owner", () => {
  it("hides the lazy loading overlay immediately when a suspended route detaches", async () => {
    const suspension = new Promise<void>(() => undefined);
    const view = render(
      <>
        <StudioBg3dRetainedOwnerHost />
        <SuspendedRouteOwner suspension={suspension} />
      </>,
    );

    expect(view.getByText("3D 배경 도구를 여는 중")).toBeTruthy();
    view.rerender(<StudioBg3dRetainedOwnerHost />);

    await waitFor(() => {
      expect(view.queryByText("3D 배경 도구를 여는 중")).toBeNull();
    });
  });

  it("releases a detached, still-suspended BG3D lease so a returning route can mount", async () => {
    const suspension = new Promise<void>(() => undefined);
    const view = render(
      <>
        <StudioBg3dRetainedOwnerHost />
        <SuspendedRouteOwner suspension={suspension} />
      </>,
    );
    expect(view.getByText("3D 배경 도구를 여는 중")).toBeTruthy();

    view.rerender(
      <>
        <StudioBg3dRetainedOwnerHost />
        <PassiveRouteOwner id="fallback-route" />
      </>,
    );
    expect(view.queryByTestId("passive-fallback-route")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, BG3D_RETAINED_OWNER_STALE_RELEASE_MS + 1);
      });
    });

    await waitFor(() => {
      expect(view.getByTestId("passive-fallback-route")).toBeTruthy();
    });
  });

  it("retains one Canvas through route unmount, watchdog end, late attach, and native release", async () => {
    const harness = createHarness();
    const view = render(
      <>
        <StudioBg3dRetainedOwnerHost />
        <RouteOwner harness={harness} />
      </>,
    );

    await waitFor(() => {
      expect(harness.renderer.setSession).toHaveBeenCalledWith(harness.session);
    });
    const originalCanvas = view.getByTestId("retained-xr-canvas");
    expect(originalCanvas.getAttribute("data-instance-id")).toBe("1");
    expect(harness.controllerCount()).toBe(1);

    view.rerender(<StudioBg3dRetainedOwnerHost />);
    await waitFor(() => {
      expect(view.getByTestId("retained-xr-canvas")).toBe(originalCanvas);
      expect(originalCanvas.getAttribute("data-open")).toBe("false");
    });
    expect(harness.unmountCount()).toBe(0);

    await waitFor(() => expect(harness.session.end).toHaveBeenCalledTimes(1));
    expect(harness.renderer.setSession).not.toHaveBeenCalledWith(null);

    await act(async () => {
      harness.resolveAttachment();
      await harness.attachment;
      await Promise.resolve();
      harness.session.finishNativeEnd();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.queryByTestId("retained-xr-canvas")).toBeNull();
    });
    expect(harness.session.end).toHaveBeenCalledTimes(1);
    expect(harness.renderer.getSession()).toBeNull();
    expect(harness.renderer.isPresenting).toBe(false);
    expect(harness.renderer.setSession).not.toHaveBeenCalledWith(null);
    expect(harness.instanceCount()).toBe(1);
    expect(harness.controllerCount()).toBe(1);
    expect(harness.unmountCount()).toBe(1);
  });

  it("queues a returning route behind the detached WebXR generation instead of replacing Canvas", async () => {
    const harness = createHarness();
    const view = render(
      <>
        <StudioBg3dRetainedOwnerHost />
        <RouteOwner harness={harness} />
      </>,
    );
    await waitFor(() => {
      expect(harness.renderer.setSession).toHaveBeenCalledWith(harness.session);
    });
    const originalCanvas = view.getByTestId("retained-xr-canvas");

    view.rerender(
      <>
        <StudioBg3dRetainedOwnerHost />
        <PassiveRouteOwner id="returning-route" />
      </>,
    );
    await waitFor(() => {
      expect(view.getByTestId("retained-xr-canvas")).toBe(originalCanvas);
      expect(originalCanvas.getAttribute("data-open")).toBe("false");
    });
    expect(view.queryByTestId("passive-returning-route")).toBeNull();
    expect(harness.instanceCount()).toBe(1);

    await waitFor(() => expect(harness.session.end).toHaveBeenCalledTimes(1));
    await act(async () => {
      harness.resolveAttachment();
      await harness.attachment;
      await Promise.resolve();
      harness.session.finishNativeEnd();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.queryByTestId("retained-xr-canvas")).toBeNull();
      expect(view.getByTestId("passive-returning-route")).toBeTruthy();
    });
    expect(harness.session.end).toHaveBeenCalledTimes(1);
    expect(harness.renderer.getSession()).toBeNull();
    expect(harness.renderer.isPresenting).toBe(false);
    expect(harness.instanceCount()).toBe(1);
    expect(harness.unmountCount()).toBe(1);
  });

  it("releases a Canvas poisoned by device end during attach before returning-route takeover", async () => {
    // The privacy watchdog must not race the native end below: on a slow CI runner the waitFor
    // gap after rerender can exceed a short deadline, which would fire requestSessionEnd() before
    // finishNativeEnd() fences it and break the `session.end` never-called contract of this test.
    const harness = createHarness({ attachmentPrivacyTimeoutMs: 60_000 });
    const view = render(
      <>
        <StudioBg3dRetainedOwnerHost />
        <RouteOwner harness={harness} />
      </>,
    );
    await waitFor(() => {
      expect(harness.renderer.setSession).toHaveBeenCalledWith(harness.session);
    });
    const originalCanvas = view.getByTestId("retained-xr-canvas");

    view.rerender(
      <>
        <StudioBg3dRetainedOwnerHost />
        <PassiveRouteOwner id="after-poisoned-route" />
      </>,
    );
    await waitFor(() => {
      expect(view.getByTestId("retained-xr-canvas")).toBe(originalCanvas);
      expect(originalCanvas.getAttribute("data-open")).toBe("false");
    });

    await act(async () => {
      // Browser-owned end arrives while Three is still attaching. Resolving afterward recreates
      // the real manager's null-session/isPresenting poison that requires old-Canvas disposal.
      harness.session.finishNativeEnd();
      harness.resolveAttachment();
      await harness.attachment;
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.queryByTestId("retained-xr-canvas")).toBeNull();
      expect(view.getByTestId("passive-after-poisoned-route")).toBeTruthy();
    });
    expect(harness.session.end).not.toHaveBeenCalled();
    expect(harness.renderer.getSession()).toBeNull();
    expect(harness.renderer.isPresenting).toBe(true);
    expect(harness.instanceCount()).toBe(1);
    expect(harness.controllerCount()).toBe(1);
    expect(harness.unmountCount()).toBe(1);
  });
});
