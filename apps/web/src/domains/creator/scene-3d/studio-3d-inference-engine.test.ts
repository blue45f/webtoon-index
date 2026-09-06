import { describe, it, expect } from "vitest";

import {
  Studio3DInferenceEngine,
  type InferenceCandidate,
} from "./studio-3d-inference-engine";

describe("Studio3DInferenceEngine", () => {
  it("snaps to candidate endpoint within tolerance", () => {
    const engine = new Studio3DInferenceEngine(0.2);
    const candidates: InferenceCandidate[] = [
      { point: { x: 1.0, y: 2.0, z: 0.0 }, type: "endpoint", label: "Corner Vertex" },
      { point: { x: 5.0, y: 0.0, z: 0.0 }, type: "endpoint", label: "Wall End" },
    ];

    const result = engine.findBestSnap({ x: 1.05, y: 2.02, z: 0.01 }, candidates);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("endpoint");
    expect(result?.label).toBe("Corner Vertex");
  });

  it("computes midpoint and nearest point on line segment", () => {
    const engine = new Studio3DInferenceEngine();
    const mid = engine.computeMidpoint({ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: 2 });
    expect(mid).toEqual({ x: 5, y: 2, z: 1 });

    const nearest = engine.computeNearestPointOnSegment(
      { x: 3, y: 5, z: 0 },
      { id: "seg-1", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
    );
    expect(nearest.x).toBe(3);
    expect(nearest.y).toBe(0);
  });

  it("falls back to grid snap when no candidate is close", () => {
    const engine = new Studio3DInferenceEngine(0.2);
    const result = engine.findBestSnap({ x: 0.49, y: 0.01, z: 0.99 }, [], 0.5);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("grid");
    expect(result?.snappedPoint).toEqual({ x: 0.5, y: 0.0, z: 1.0 });
  });

  it("tracks hover references and generates X/Y/Z alignment guide rays", () => {
    const engine = new Studio3DInferenceEngine(0.2);
    engine.registerHoverReference({ x: 5, y: 0, z: 0 });

    // Cursor at (5.01, 10, 0.02) -> aligns on X=5, Z=0 (Y-axis ray)
    const result = engine.findBestSnap({ x: 5.01, y: 10, z: 0.02 }, []);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("axis-y");
    expect(result?.guideRay?.colorHex).toBe("#2a9d8f");
  });

  it("applies axis locking constraints", () => {
    const engine = new Studio3DInferenceEngine(0.2);
    engine.registerHoverReference({ x: 0, y: 2, z: 3 });
    engine.setAxisLock("x");

    expect(engine.getAxisLock()).toBe("x");
  });

  it("measures 3D distances, pitch/yaw angles, and calipers", () => {
    const engine = new Studio3DInferenceEngine();
    const measurement = engine.measureDistance(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    );

    expect(measurement.distance).toBe(5);
    expect(measurement.formattedMetric).toContain("5m");
    expect(measurement.deltaX).toBe(3);
    expect(measurement.deltaY).toBe(4);
  });

  it("measures 3D protractor angles between vectors", () => {
    const engine = new Studio3DInferenceEngine();
    // 90 degree right angle
    const angle90 = engine.measureAngle(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    expect(angle90).toBe(90);

    // 180 degree straight line
    const angle180 = engine.measureAngle(
      { x: 0, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(angle180).toBe(180);
  });

  it("calculates 3D bounding box dimensions and volume", () => {
    const engine = new Studio3DInferenceEngine();
    const points = [
      { x: -2, y: 0, z: -3 },
      { x: 2, y: 4, z: 3 },
    ];
    const bbox = engine.calculateBoundingBox(points);
    expect(bbox.width).toBe(4);
    expect(bbox.height).toBe(4);
    expect(bbox.depth).toBe(6);
    expect(bbox.volume).toBe(96);
    expect(bbox.center).toEqual({ x: 0, y: 2, z: 0 });
  });
});
