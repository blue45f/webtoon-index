import { describe, expect, it } from "vitest";

import mannequinTrackingSource from "./scene-3d/studio-mannequin-webcam-tracking.ts?raw";
import backgroundRemovalSource from "./studio-bg-remove.ts?raw";
import vrmTrackingSource from "./vrm/studio-vrm-webcam-tracking.ts?raw";

const sources = [
  ["VRM live/photo tracking", vrmTrackingSource],
  ["mannequin tracking", mannequinTrackingSource],
  ["foreground segmentation", backgroundRemovalSource],
] as const;

describe("MediaPipe Vision global initialization boundary", () => {
  it.each(sources)("routes every %s Task factory through the shared arbiter", (_label, source) => {
    const factoryCalls = source.match(/\.createFromOptions\(/gu) ?? [];
    const guardedCalls = source.match(/runStudioMediaPipeVisionTaskCreation\(\{/gu) ?? [];
    expect(factoryCalls.length).toBeGreaterThan(0);
    expect(guardedCalls).toHaveLength(factoryCalls.length);
    expect(source).toContain("loadStudioMediaPipeVisionModule");
    expect(source).not.toMatch(/await import\([\s\n]*["']@mediapipe\/tasks-vision["']/u);
  });

  it("never retries a selected task with another delegate or Wasm variant", () => {
    expect(vrmTrackingSource.match(/\.createFromOptions\(/gu)).toHaveLength(5);
    expect(mannequinTrackingSource.match(/\.createFromOptions\(/gu)).toHaveLength(1);
    expect(backgroundRemovalSource.match(/\.createFromOptions\(/gu)).toHaveLength(1);
    for (const source of [
      vrmTrackingSource,
      mannequinTrackingSource,
      backgroundRemovalSource,
    ]) {
      expect(source).not.toContain("falling back to CPU");
      expect(source).not.toContain("compatibilityVision");
      expect(source).not.toMatch(/delegate:\s*["'](?:GPU|CPU)["']/u);
    }
  });

  it("fences every live VRM singleton against dispose-during-initialization resurrection", () => {
    expect(vrmTrackingSource).toContain("faceLandmarkerGeneration += 1");
    expect(vrmTrackingSource).toContain("livePoseLandmarkerGeneration += 1");
    expect(vrmTrackingSource).toContain("liveHandLandmarkerGeneration += 1");
    expect(vrmTrackingSource.match(/safelyCloseLiveLandmarker\(landmarker\)/gu)).toHaveLength(3);
    expect(vrmTrackingSource.match(/initPromiseGeneration/gu)?.length ?? 0).toBeGreaterThan(2);
    expect(vrmTrackingSource.match(/initPosePromiseGeneration/gu)?.length ?? 0).toBeGreaterThan(2);
    expect(vrmTrackingSource.match(/initHandPromiseGeneration/gu)?.length ?? 0).toBeGreaterThan(2);
  });
});
