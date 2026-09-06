import { useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent } from "react";

import { loadStudioBg3dThreeWebglCaptureRuntime } from "./studio-bg3d-editor-derivations";

import type { StudioBg3dCaptureAdapter } from "./studio-bg3d-capture-adapter";
import type { CaptureState } from "./StudioBackground3DTypes";

/* ── R3F Canvas 내부에서 렌더러/씬/카메라를 꺼내 캡처용 ref에 흘려보내는 다리.
   VRM 포저의 CaptureBridge와 동일한 패턴 — ref-not-state라 마운트마다 리렌더를 유발하지 않는다. */
export function CaptureBridge({
  onCaptureUpdate,
}: {
  onCaptureUpdate: (state: CaptureState, cleanupAdapter?: StudioBg3dCaptureAdapter | null) => void;
}) {
  const { camera, gl, scene } = useThree();
  const updateCapture = useEffectEvent(onCaptureUpdate);

  useEffect(() => {
    let disposed = false;
    let adapter: StudioBg3dCaptureAdapter | null = null;
    // The interactive backend is chosen per session by the engine-selection policy, so the capture
    // adapter is picked from the renderer that actually owns this canvas rather than assumed.
    const isWebGpuRenderer =
      (gl as unknown as { readonly isWebGPURenderer?: boolean }).isWebGPURenderer === true;
    const loadAdapter = isWebGpuRenderer
      ? import("./studio-bg3d-three-webgpu-entry").then((entry) =>
        entry.createStudioBg3dThreeWebGpuCaptureAdapter({
          camera,
          renderer: gl as unknown as Parameters<
            typeof entry.createStudioBg3dThreeWebGpuCaptureAdapter
          >[0]["renderer"],
          scene,
        }))
      : loadStudioBg3dThreeWebglCaptureRuntime().then((runtime) =>
        runtime.createStudioBg3dThreeWebglCaptureAdapter({ camera, renderer: gl, scene }));
    void loadAdapter.then((created) => {
      if (disposed) return;
      adapter = created;
      updateCapture({ adapter, camera });
    }).catch(() => {
      if (!disposed) updateCapture({ adapter: null, camera: null });
    });
    return () => {
      disposed = true;
      if (adapter) updateCapture({ adapter: null, camera: null }, adapter);
    };
  }, [camera, gl, scene]);

  return null;
}

export type StudioBg3dImmersiveStageSuccess = Extract<
  import("./studio-bg3d-immersive-stage").StudioBg3dImmersiveStagePlan,
  { readonly ok: true }
>;
