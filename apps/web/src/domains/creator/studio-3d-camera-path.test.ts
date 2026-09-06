import { describe, expect, it } from "vitest";

import {
  addCameraKeyframe,
  createCameraPathSequence,
  mapPhoneTelemetryToCameraPose,
  sampleCameraStateAtTime,
} from "./studio-3d-camera-path";

describe("Studio 3D Virtual Camera Path & AR Linker", () => {
  it("interpolates camera position, lookAt and fov along path", () => {
    let seq = createCameraPathSequence({ id: "cam_seq_1", sceneId: "scene_battle", totalDurationMs: 2000 });
    seq = addCameraKeyframe(seq, {
      timeMs: 0,
      position: [0, 2, 5],
      lookAt: [0, 1, 0],
      fovDeg: 50,
      focalLengthMm: 35,
      motionType: "dolly",
    });
    seq = addCameraKeyframe(seq, {
      timeMs: 2000,
      position: [0, 1, 2], // Dollying closer
      lookAt: [0, 1, 0],
      fovDeg: 35,
      focalLengthMm: 50,
      motionType: "dolly",
    });

    // Sample at midpoint (1000ms)
    const mid = sampleCameraStateAtTime(seq, 1000);
    expect(mid.position[0]).toBe(0);
    expect(mid.position[1]).toBeCloseTo(1.5, 1);
    expect(mid.position[2]).toBeCloseTo(3.5, 1);
    expect(mid.fovDeg).toBeCloseTo(42.5, 1);
  });

  it("maps phone gyroscope telemetry to camera orientation", () => {
    const baseCam = sampleCameraStateAtTime(
      createCameraPathSequence({ id: "cam_base", sceneId: "sc" }),
      0,
    );

    const phoneTelemetry = {
      alphaDeg: 90, // yaw 90 deg
      betaDeg: 0, // pitch 0
      gammaDeg: 15, // roll 15 deg
    };

    const mapped = mapPhoneTelemetryToCameraPose(phoneTelemetry, baseCam);
    expect(mapped.rollDeg).toBe(15);
    expect(mapped.lookAt[0]).toBeGreaterThan(baseCam.position[0]); // rotated right
  });
});
