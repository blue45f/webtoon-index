/** Three projection of the engine-neutral Studio 3D render settings (WebGL2 and WebGPU). */

import * as THREE from "three";

import type { StudioBg3dRenderSettings } from "./studio-bg3d-scene-document";

export interface StudioBg3dResolvedThreeRenderSettings {
  readonly outputColorSpace: typeof THREE.SRGBColorSpace;
  readonly toneMapping: THREE.ToneMapping;
  readonly toneMappingExposure: number;
}

export type StudioBg3dWebglRendererSettingsTarget = Pick<
  THREE.WebGLRenderer,
  "outputColorSpace" | "toneMapping" | "toneMappingExposure"
> & { readonly isWebGLRenderer?: boolean };

/**
 * Three's WebGPURenderer exposes the same three colour/tone properties, but it is a different
 * class with a different brand flag. It is matched structurally here rather than imported, so the
 * `three/webgpu` graph never enters this module's static closure.
 */
export type StudioBg3dWebgpuRendererSettingsTarget = Pick<
  THREE.WebGLRenderer,
  "outputColorSpace" | "toneMapping" | "toneMappingExposure"
> & { readonly isWebGPURenderer?: boolean };

export type StudioBg3dThreeRendererSettingsTarget =
  | StudioBg3dWebglRendererSettingsTarget
  | StudioBg3dWebgpuRendererSettingsTarget;

/**
 * Resolves a persistence-safe render contract without relying on R3F's renderer defaults.
 * Runtime callers remain fail-closed for manually constructed or future document values.
 */
export function resolveStudioBg3dThreeRenderSettings(
  render: StudioBg3dRenderSettings,
): StudioBg3dResolvedThreeRenderSettings {
  const exposure = typeof render.exposure === "number" && Number.isFinite(render.exposure)
    ? THREE.MathUtils.clamp(render.exposure, 0.1, 8)
    : 1;
  const toneMapping = render.toneMapping === "none"
    ? THREE.NoToneMapping
    : render.toneMapping === "aces"
      ? THREE.ACESFilmicToneMapping
      : THREE.NeutralToneMapping;
  return Object.freeze({
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping,
    toneMappingExposure: exposure,
  });
}

function applyResolvedRenderSettings(
  renderer: StudioBg3dThreeRendererSettingsTarget,
  render: StudioBg3dRenderSettings,
): boolean {
  const resolved = resolveStudioBg3dThreeRenderSettings(render);
  const previous = {
    outputColorSpace: renderer.outputColorSpace,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
  };
  try {
    renderer.outputColorSpace = resolved.outputColorSpace;
    renderer.toneMapping = resolved.toneMapping;
    renderer.toneMappingExposure = resolved.toneMappingExposure;
    return true;
  } catch {
    try {
      renderer.outputColorSpace = previous.outputColorSpace;
      renderer.toneMapping = previous.toneMapping;
      renderer.toneMappingExposure = previous.toneMappingExposure;
    } catch {
      // A renderer that rejects its own previous values is already unusable. Keep this boundary
      // non-throwing so the editor can retain the persisted scene and report through its adapter.
    }
    return false;
  }
}

/**
 * Applies settings only to an admitted Three WebGL renderer. The brand check stays explicit so a
 * WebGPU renderer can never be silently accepted by the WebGL entry point.
 */
export function applyStudioBg3dThreeWebglRenderSettings(
  renderer: StudioBg3dWebglRendererSettingsTarget,
  render: StudioBg3dRenderSettings,
): boolean {
  if (renderer.isWebGLRenderer !== true) return false;
  return applyResolvedRenderSettings(renderer, render);
}

/** Applies the same engine-neutral settings to an admitted Three WebGPU renderer. */
export function applyStudioBg3dThreeWebgpuRenderSettings(
  renderer: StudioBg3dWebgpuRendererSettingsTarget,
  render: StudioBg3dRenderSettings,
): boolean {
  if (renderer.isWebGPURenderer !== true) return false;
  return applyResolvedRenderSettings(renderer, render);
}

/**
 * Routes to the applier that matches the renderer's own brand flag. A renderer claiming neither
 * brand — or both — is refused, so a partially constructed or spoofed object never silently
 * receives the document's colour contract.
 */
export function applyStudioBg3dThreeRenderSettings(
  renderer: StudioBg3dThreeRendererSettingsTarget,
  render: StudioBg3dRenderSettings,
): boolean {
  const isWebgl = (renderer as StudioBg3dWebglRendererSettingsTarget).isWebGLRenderer === true;
  const isWebgpu = (renderer as StudioBg3dWebgpuRendererSettingsTarget).isWebGPURenderer === true;
  if (isWebgl === isWebgpu) return false;
  return applyResolvedRenderSettings(renderer, render);
}
