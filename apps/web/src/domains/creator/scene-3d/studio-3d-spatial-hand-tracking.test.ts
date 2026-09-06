import { describe, it, expect } from "vitest";

import { Studio3DSpatialHandTrackingEngine } from "./studio-3d-spatial-hand-tracking";

describe("Studio3DSpatialHandTrackingEngine", () => {
  it("recognizes pinch gesture when thumb tip and index tip are close", () => {
    const engine = new Studio3DSpatialHandTrackingEngine();

    const frame = engine.processHandJoints("right", {
      wrist: [0, 0, 0],
      thumbTip: [0.05, 0.1, 0],
      indexTip: [0.052, 0.102, 0], // ~2.8mm distance (pinch)
      middleTip: [0.08, 0.14, 0],
      ringTip: [0.09, 0.13, 0],
      pinkyTip: [0.1, 0.11, 0],
      palmCenter: [0.05, 0.05, 0],
    });

    expect(frame.recognizedGesture).toBe("pinch");
    expect(frame.pinchStrength).toBeGreaterThan(0.8);
  });

  it("recognizes point gesture when index is extended and other fingers curled", () => {
    const engine = new Studio3DSpatialHandTrackingEngine();

    const frame = engine.processHandJoints("right", {
      wrist: [0, 0, 0],
      thumbTip: [0.03, 0.04, 0],
      indexTip: [0.05, 0.15, 0], // Extended (10cm from palm)
      middleTip: [0.05, 0.06, 0], // Curled (1cm from palm)
      ringTip: [0.05, 0.055, 0],  // Curled
      pinkyTip: [0.05, 0.05, 0],  // Curled
      palmCenter: [0.05, 0.05, 0],
    });

    expect(frame.recognizedGesture).toBe("point-index");
  });

  it("evaluates two-hand pinch-to-scale factor as hand span increases", () => {
    const engine = new Studio3DSpatialHandTrackingEngine();

    // Initial pinch state at 20cm span
    engine.processHandJoints("left", {
      wrist: [-0.1, 0, 0],
      thumbTip: [-0.1, 0.1, 0],
      indexTip: [-0.1, 0.1, 0],
      middleTip: [-0.1, 0.14, 0],
      ringTip: [-0.1, 0.13, 0],
      pinkyTip: [-0.1, 0.11, 0],
      palmCenter: [-0.1, 0.05, 0],
    });
    engine.processHandJoints("right", {
      wrist: [0.1, 0, 0],
      thumbTip: [0.1, 0.1, 0],
      indexTip: [0.1, 0.1, 0],
      middleTip: [0.1, 0.14, 0],
      ringTip: [0.1, 0.13, 0],
      pinkyTip: [0.1, 0.11, 0],
      palmCenter: [0.1, 0.05, 0],
    });

    const initScale = engine.evaluateTwoHandScale();
    expect(initScale.isScaling).toBe(true);
    expect(initScale.scaleMultiplier).toBe(1.0);

    // Spread hands to 40cm span
    engine.processHandJoints("left", {
      wrist: [-0.2, 0, 0],
      thumbTip: [-0.2, 0.1, 0],
      indexTip: [-0.2, 0.1, 0],
      middleTip: [-0.2, 0.14, 0],
      ringTip: [-0.2, 0.13, 0],
      pinkyTip: [-0.2, 0.11, 0],
      palmCenter: [-0.2, 0.05, 0],
    });
    engine.processHandJoints("right", {
      wrist: [0.2, 0, 0],
      thumbTip: [0.2, 0.1, 0],
      indexTip: [0.2, 0.1, 0],
      middleTip: [0.2, 0.14, 0],
      ringTip: [0.2, 0.13, 0],
      pinkyTip: [0.2, 0.11, 0],
      palmCenter: [0.2, 0.05, 0],
    });

    const expandedScale = engine.evaluateTwoHandScale();
    expect(expandedScale.isScaling).toBe(true);
    expect(expandedScale.scaleMultiplier).toBeCloseTo(2.0, 2); // 40cm / 20cm = 2.0x
  });

  it("calculates two-hand 3D rectangular panel frame bounds", () => {
    const engine = new Studio3DSpatialHandTrackingEngine();

    // Left hand index at [-0.3, 0.2, -1.0] pointing
    engine.processHandJoints("left", {
      wrist: [-0.3, 0.1, -1.0],
      thumbTip: [-0.3, 0.12, -1.0],
      indexTip: [-0.3, 0.2, -1.0],
      middleTip: [-0.3, 0.11, -1.0],
      ringTip: [-0.3, 0.105, -1.0],
      pinkyTip: [-0.3, 0.1, -1.0],
      palmCenter: [-0.3, 0.1, -1.0],
    });

    // Right hand index at [0.3, 0.6, -1.0] pointing
    engine.processHandJoints("right", {
      wrist: [0.3, 0.5, -1.0],
      thumbTip: [0.3, 0.52, -1.0],
      indexTip: [0.3, 0.6, -1.0],
      middleTip: [0.3, 0.51, -1.0],
      ringTip: [0.3, 0.505, -1.0],
      pinkyTip: [0.3, 0.5, -1.0],
      palmCenter: [0.3, 0.5, -1.0],
    });

    const bounds = engine.evaluateTwoHandFrameCrop();
    expect(bounds.isActive).toBe(true);
    expect(bounds.width).toBeCloseTo(0.6, 2);  // 0.3 - (-0.3)
    expect(bounds.height).toBeCloseTo(0.4, 2); // 0.6 - 0.2
    expect(bounds.center[0]).toBeCloseTo(0, 2);
    expect(bounds.center[1]).toBeCloseTo(0.4, 2);
  });
});
