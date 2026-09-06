/**
 * Sole production lazy entry for the Three WebGPU renderer, its capture adapter, and the VRM
 * node material that lets characters render on it.
 *
 * Callers must import this file dynamically. Three's `three/webgpu` and `three/tsl` builds
 * intentionally remain in this entry's static closure so the bundle boundary can prove that
 * opening Studio — or the WebGL 3D editor — never downloads them, and so that reaching the
 * renderer costs one request rather than a nested waterfall.
 *
 * `MToonNodeMaterial` belongs here for the same reason: `@pixiv/three-vrm/nodes` imports
 * `three/webgpu` and `three/tsl` directly, so giving it its own chunk would put a second static
 * owner on Three's WebGPU build and break the single-owner boundary. It costs ~12 KiB minified
 * against this entry's 604 KiB, and it only downloads when the policy has already chosen WebGPU.
 */

export {
  createStudioBg3dThreeWebGpuCaptureAdapter,
  STUDIO_BG3D_THREE_WEBGPU_CAPTURE_IMPLEMENTATION_V1,
  type CreateStudioBg3dThreeWebGpuCaptureAdapterInput,
} from "./studio-bg3d-three-webgpu-capture";
export {
  createStudioBg3dThreeWebGpuRenderer,
  StudioBg3dWebGpuRendererError,
  type CreateStudioBg3dThreeWebGpuRendererOptions,
  type StudioBg3dThreeWebGpuRuntime,
  type StudioBg3dWebGpuDeviceLoss,
  type StudioBg3dWebGpuDeviceLossReason,
  type StudioBg3dWebGpuRendererErrorCode,
} from "./studio-bg3d-three-webgpu-renderer";
export { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";
