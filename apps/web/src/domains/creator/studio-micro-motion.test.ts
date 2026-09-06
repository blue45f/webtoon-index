import { describe, expect, it } from "vitest";

import {
  addKeyframeToTrack,
  applyLivingStrokeModifier,
  createMicroMotionTimeline,
  sampleTrackPropertiesAtTime,
  validatePhotosensitivitySafety,
} from "./studio-micro-motion";

describe("Studio Micro Motion Timeline & Living Stroke Engine", () => {
  it("creates timeline and interpolates keyframe properties", () => {
    let timeline = createMicroMotionTimeline({
      id: "mm_1",
      panelId: "p_1",
      totalFrames: 24,
      fps: 12,
    });

    // Add keyframe at frame 0 and frame 12
    timeline = addKeyframeToTrack(timeline, "layer_fx", "layer", {
      frameIndex: 0,
      opacity: 0.0,
      translateX: 0,
      scale: 1.0,
    });
    timeline = addKeyframeToTrack(timeline, "layer_fx", "layer", {
      frameIndex: 12,
      opacity: 1.0,
      translateX: 100,
      scale: 2.0,
    });

    expect(timeline.tracks).toHaveLength(1);

    // Sample at t = 0s (frame 0)
    const at0 = sampleTrackPropertiesAtTime(timeline, "layer_fx", 0);
    expect(at0.opacity).toBe(0.0);
    expect(at0.translateX).toBe(0);

    // Sample at t = 0.5s (frame 6 -> 50% interpolation)
    const at500ms = sampleTrackPropertiesAtTime(timeline, "layer_fx", 500);
    expect(at500ms.opacity).toBeCloseTo(0.5, 2);
    expect(at500ms.translateX).toBeCloseTo(50, 2);
    expect(at500ms.scale).toBeCloseTo(1.5, 2);

    // Sample at t = 1.0s (frame 12 -> 100%)
    const at1s = sampleTrackPropertiesAtTime(timeline, "layer_fx", 1000);
    expect(at1s.opacity).toBeCloseTo(1.0, 2);
    expect(at1s.translateX).toBeCloseTo(100, 2);
  });

  it("applies line boil modifier deterministically at given fps", () => {
    const points = [
      { x: 10, y: 10, width: 2 },
      { x: 20, y: 20, width: 2 },
      { x: 30, y: 30, width: 2 },
    ];

    const boilMod = {
      kind: "line-boil" as const,
      boilFps: 3 as const,
      amplitude: 1.5,
      frequencyHz: 3,
      seed: 42,
    };

    const boiledT0 = applyLivingStrokeModifier(points, boilMod, 0);
    const boiledT100 = applyLivingStrokeModifier(points, boilMod, 100); // within same 3fps step (0..333ms)
    const boiledT500 = applyLivingStrokeModifier(points, boilMod, 500); // next step (333..666ms)

    expect(boiledT0).toHaveLength(3);
    // At t=0 and t=100ms, step is the same -> exact same jitter
    expect(boiledT0[0].x).toBe(boiledT100[0].x);
    // At t=500ms, step changed -> different jitter
    expect(boiledT0[0].x).not.toBe(boiledT500[0].x);
  });

  it("applies width-pulse modifier", () => {
    const points = [
      { x: 0, y: 0, width: 10 },
      { x: 10, y: 10, width: 10 },
    ];
    const pulsed = applyLivingStrokeModifier(
      points,
      { kind: "width-pulse", amplitude: 0.5, frequencyHz: 2 },
      125,
    );
    expect(pulsed[0].width).toBeDefined();
    expect(pulsed[0].width).toBeCloseTo(15, 1);
  });

  it("detects photosensitivity flash risks", () => {
    let timeline = createMicroMotionTimeline({
      id: "mm_flash",
      panelId: "p_flash",
      totalFrames: 12,
      fps: 12, // 1 second duration
    });

    // Rapid flashing keyframes (0 -> 1 -> 0 -> 1 -> 0) in 1s = 4 flashes >= 3Hz
    timeline = addKeyframeToTrack(timeline, "layer_strobe", "layer", { frameIndex: 0, opacity: 0 });
    timeline = addKeyframeToTrack(timeline, "layer_strobe", "layer", { frameIndex: 3, opacity: 1 });
    timeline = addKeyframeToTrack(timeline, "layer_strobe", "layer", { frameIndex: 6, opacity: 0 });
    timeline = addKeyframeToTrack(timeline, "layer_strobe", "layer", { frameIndex: 9, opacity: 1 });
    timeline = addKeyframeToTrack(timeline, "layer_strobe", "layer", { frameIndex: 11, opacity: 0 });

    const diags = validatePhotosensitivitySafety(timeline);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("PHOTOSENSITIVITY_FLASH_RISK");
    expect(diags[0].severity).toBe("error");
  });
});
