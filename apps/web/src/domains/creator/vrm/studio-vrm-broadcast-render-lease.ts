import * as THREE from "three";

export interface StudioVrmBroadcastRendererPort {
  getClearAlpha: () => number;
  getClearColor: (target: THREE.Color) => THREE.Color;
  setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => unknown;
}

export interface StudioVrmBroadcastVisibilityPort {
  visible: boolean;
}

export type StudioVrmBroadcastRenderLease = Readonly<{
  release: () => void;
}>;

export type StudioVrmBroadcastRenderLeaseResult =
  | Readonly<{ ok: true; lease: StudioVrmBroadcastRenderLease }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Temporarily leases only renderer presentation state. The scene graph, camera, and project
 * document stay under their existing owners; release restores the exact values observed on entry.
 */
export function acquireStudioVrmBroadcastRenderLease(input: Readonly<{
  renderer: StudioVrmBroadcastRendererPort;
  scene: THREE.Scene;
  environment: StudioVrmBroadcastVisibilityPort | null;
  ground: StudioVrmBroadcastVisibilityPort | null;
  backgroundHex: `#${string}`;
  invalidate?: () => void;
}>): StudioVrmBroadcastRenderLeaseResult {
  if (!input.environment || !input.ground) {
    return Object.freeze({
      ok: false,
      reason: "방송 화면에서 숨길 배경 환경과 바닥 그림자가 아직 준비되지 않았습니다.",
    });
  }

  const previousClearColor = input.renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = input.renderer.getClearAlpha();
  const previousSceneBackground = input.scene.background;
  const previousEnvironmentVisibility = input.environment.visible;
  const previousGroundVisibility = input.ground.visible;
  let released = false;

  const restore = () => {
    input.scene.background = previousSceneBackground;
    input.environment!.visible = previousEnvironmentVisibility;
    input.ground!.visible = previousGroundVisibility;
    input.renderer.setClearColor(previousClearColor, previousClearAlpha);
    input.invalidate?.();
  };

  try {
    input.scene.background = null;
    input.environment.visible = false;
    input.ground.visible = false;
    input.renderer.setClearColor(input.backgroundHex, 1);
    input.invalidate?.();
  } catch {
    try {
      restore();
    } catch {
      // The renderer itself rejected both mutation and rollback. The React owner closes the mode.
    }
    return Object.freeze({
      ok: false,
      reason: "방송 배경을 기존 3D 렌더러에 안전하게 적용하지 못했습니다.",
    });
  }

  return Object.freeze({
    ok: true,
    lease: Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        restore();
      },
    }),
  });
}
