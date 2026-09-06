import { describe, expect, it } from "vitest";

import {
  createStudioBg3dCaptureBackgroundSnapshot,
  studioBg3dCaptureBackgroundRequestFromSnapshot,
} from "./studio-bg3d-capture-background";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

describe("Studio BG3D capture background snapshot", () => {
  it("freezes one canonical intent for document, scene, and raster consumers", () => {
    const background = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
      skyPresetId: "sunset" as const,
      panoramaRotation: 540,
    };
    const snapshot = createStudioBg3dCaptureBackgroundSnapshot({
      background,
      transparent: true,
    });

    expect(snapshot).toMatchObject({
      clearColor: "#f2b183",
      panoramaRotation: 180,
      skyPresetId: "sunset",
      transparent: true,
    });
    expect(snapshot.insertPlan).toMatchObject({
      transparent: true,
      captureAlpha: 0,
      suppressSceneBackground: true,
      documentBackgroundMode: "transparent",
    });
    expect(studioBg3dCaptureBackgroundRequestFromSnapshot(snapshot)).toEqual({
      color: "#f2b183",
      alpha: 0,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.background)).toBe(true);
    expect(Object.isFrozen(snapshot.insertPlan)).toBe(true);
    expect(snapshot.background).toMatchObject({
      color: "#f2b183",
      mode: "transparent",
      panoramaRotation: 180,
      skyPresetId: "sunset",
    });

    // Later draft mutations cannot alter the in-flight capture intent.
    background.panoramaRotation = -45;
    expect(snapshot.panoramaRotation).toBe(180);
    expect(snapshot.background.panoramaRotation).toBe(180);
  });

  it("falls back to the local blank preset for a non-allowlisted runtime id", () => {
    const snapshot = createStudioBg3dCaptureBackgroundSnapshot({
      background: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
        skyPresetId: "remote-sky" as never,
      },
      transparent: false,
    });

    expect(snapshot).toMatchObject({
      clearColor: "#ffffff",
      skyPresetId: "blank",
      transparent: false,
    });
    expect(studioBg3dCaptureBackgroundRequestFromSnapshot(snapshot)).toEqual({
      color: "#ffffff",
      alpha: 1,
    });
  });
});
