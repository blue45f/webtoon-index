import {
  getSkyPreset,
  normalizePanoramaRotationDegrees,
} from "../studio-background-3d-sky";

import {
  resolveStudioBg3dInsertBackgroundMode,
  toStudioBg3dInsertCaptureBackground,
} from "./studio-bg3d-insert-background-mode";

import type { StudioBg3dInsertBackgroundPlan } from "./studio-bg3d-insert-background-mode";
import type {
  StudioBg3dBackgroundSettings,
  StudioBg3dSkyPresetId,
} from "./studio-bg3d-scene-document";

/** Immutable intent shared by the persisted document, R3F scene, and raster request of one capture. */
export interface StudioBg3dCaptureBackgroundSnapshot {
  readonly background: StudioBg3dBackgroundSettings;
  readonly clearColor: string;
  readonly panoramaRotation: number;
  readonly skyPresetId: StudioBg3dSkyPresetId;
  readonly transparent: boolean;
  /** Portable insert plan (alpha / scene-background suppression) frozen with this snapshot. */
  readonly insertPlan: StudioBg3dInsertBackgroundPlan;
}

export function createStudioBg3dCaptureBackgroundSnapshot(input: {
  readonly background: StudioBg3dBackgroundSettings;
  readonly transparent: boolean;
}): StudioBg3dCaptureBackgroundSnapshot {
  const modeResult = resolveStudioBg3dInsertBackgroundMode({
    transparent: input.transparent,
  });
  if (!modeResult.ok) {
    // Callers pass a typed boolean; failure here is a programmer contract break, not user input.
    throw new TypeError(modeResult.reason);
  }
  const insertPlan = modeResult.plan;
  const preset = getSkyPreset(input.background.skyPresetId);
  const panoramaRotation = normalizePanoramaRotationDegrees(input.background.panoramaRotation);
  const background = Object.freeze({
    ...input.background,
    mode: insertPlan.documentBackgroundMode,
    color: preset.clearColor,
    skyPresetId: preset.id,
    panoramaRotation,
  });
  return Object.freeze({
    background,
    clearColor: preset.clearColor,
    panoramaRotation,
    skyPresetId: preset.id,
    transparent: insertPlan.transparent,
    insertPlan,
  });
}

/** Capture-request `{ color, alpha }` derived from a frozen background snapshot. */
export function studioBg3dCaptureBackgroundRequestFromSnapshot(
  snapshot: StudioBg3dCaptureBackgroundSnapshot,
): { readonly color: string; readonly alpha: 0 | 1 } {
  return toStudioBg3dInsertCaptureBackground(snapshot.insertPlan, snapshot.clearColor);
}
