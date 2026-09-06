/**
 * Connects the existing R3F/Three renderer to the browser-owned WebXR session authority.
 *
 * This component creates no renderer and owns no project data. It is deliberately mounted inside
 * the existing BG3D Canvas so every AR/VR frame uses the same admitted GLB/VRM scene graph that the
 * editor and capture paths already render.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent, type RefObject } from "react";

import type {
  StudioWebXrSessionController,
  StudioWebXrSessionState,
  StudioWebXrSupportSnapshot,
} from "../studio-webxr-session";

export interface StudioBg3dWebXrSessionBridgeProps {
  readonly domOverlayRootRef: RefObject<HTMLElement | null>;
  readonly onControllerReady: (controller: StudioWebXrSessionController | null) => void;
  readonly onSupportChange: (support: StudioWebXrSupportSnapshot | null) => void;
  readonly onStateChange: (state: StudioWebXrSessionState) => void;
}

/**
 * Renders the stable Drei View portal scene directly into the XR compositor target.
 *
 * Drei View normally applies a DOM-sized viewport and scissor before rendering. That rectangle is
 * valid for the editor monitor but can clip one or both headset eye targets. Keeping this bridge
 * inside the same portal preserves loaded GLB/VRM scene identity while bypassing only the monitor
 * scissor during an immersive session.
 */
export function StudioBg3dImmersiveRenderBridge({ active }: { readonly active: boolean }) {
  useFrame((state) => {
    if (!active) return;
    const autoClear = state.gl.autoClear;
    const scissorTest = state.gl.getScissorTest();
    try {
      state.gl.setScissorTest(false);
      state.gl.autoClear = true;
      state.gl.render(state.scene, state.camera);
    } finally {
      state.gl.autoClear = autoClear;
      state.gl.setScissorTest(scissorTest);
    }
  }, 2);
  return null;
}

export function StudioBg3dWebXrSessionBridge({
  domOverlayRootRef,
  onControllerReady,
  onSupportChange,
  onStateChange,
}: StudioBg3dWebXrSessionBridgeProps) {
  const webXrManager = useThree((state) => state.gl.xr);
  const publishController = useEffectEvent(onControllerReady);
  const publishSupport = useEffectEvent(onSupportChange);
  const publishState = useEffectEvent(onStateChange);

  useEffect(() => {
    let disposed = false;
    let controller: StudioWebXrSessionController | null = null;
    publishController(null);
    publishSupport(null);

    void import("../studio-webxr-session").then(async (runtime) => {
      if (disposed) return;
      const rendererPort = {
        get enabled() {
          return webXrManager.enabled;
        },
        set enabled(value: boolean) {
          webXrManager.enabled = value;
        },
        get isPresenting() {
          return webXrManager.isPresenting;
        },
        setReferenceSpaceType(type: XRReferenceSpaceType) {
          webXrManager.setReferenceSpaceType(type);
        },
        setSession(session: XRSession | null) {
          return webXrManager.setSession(session);
        },
        getSession() {
          return webXrManager.getSession();
        },
        async waitUntilReleased(session: XRSession) {
          const released = () => webXrManager.getSession() !== session
            && !webXrManager.isPresenting;
          if (released()) return;
          await new Promise<void>((resolve) => {
            const handleRelease = () => {
              if (!released()) return;
              webXrManager.removeEventListener("sessionend", handleRelease);
              resolve();
            };
            webXrManager.addEventListener("sessionend", handleRelease);
            queueMicrotask(handleRelease);
          });
        },
      };
      controller = runtime.createStudioWebXrSessionController({
        renderer: rendererPort,
        domOverlayRoot: domOverlayRootRef.current,
        onStateChange: (state) => {
          if (!disposed) publishState(state);
        },
      });
      publishController(controller);
      try {
        const support = await controller.inspectSupport();
        if (!disposed && controller) publishSupport(support);
      } catch {
        if (!disposed) publishSupport(null);
      }
    }).catch(() => {
      if (!disposed) {
        publishController(null);
        publishSupport(null);
      }
    });

    return () => {
      disposed = true;
      publishController(null);
      publishSupport(null);
      if (controller) void controller.dispose();
    };
  }, [domOverlayRootRef, webXrManager]);

  return null;
}
