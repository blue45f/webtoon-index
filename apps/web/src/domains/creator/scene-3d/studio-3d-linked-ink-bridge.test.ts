import { describe, it, expect } from "vitest";

import {
  Studio3DLinkedInkBridge,
  type CameraPerspectiveView,
} from "./studio-3d-linked-ink-bridge";

describe("Studio3DLinkedInkBridge", () => {
  const dummyCamera: CameraPerspectiveView = {
    position: [0, 1.5, 5],
    target: [0, 1.0, 0],
    fovDeg: 45,
    viewportWidth: 1000,
    viewportHeight: 1000,
    near: 0.1,
    far: 1000,
    projection: "perspective",
  };

  it("registers strokes with 3D anchors and tracks them", () => {
    const bridge = new Studio3DLinkedInkBridge();
    const stroke = bridge.registerStroke([
      { sourceNodeId: "node-1", edgeId: "e-10", cameraId: "cam-1", sourceRevision: "rev-1", worldPoint: [0, 1, 0] },
      { sourceNodeId: "node-2", faceId: "f-20", cameraId: "cam-1", sourceRevision: "rev-1", worldPoint: [1, 1, 0] },
    ]);

    expect(stroke.id).toBe("ink-1");
    expect(stroke.confidence).toBe(1.0);
    expect(stroke.regenerationPolicy).toBe("follow-3d");
    expect(bridge.getAllStrokes().length).toBe(1);
  });

  it("finds affected strokes when 3D nodes are modified", () => {
    const bridge = new Studio3DLinkedInkBridge();
    bridge.registerStroke([
      { sourceNodeId: "wall-1", cameraId: "cam-1", sourceRevision: "rev-1" },
    ]);
    bridge.registerStroke([
      { sourceNodeId: "chair-1", cameraId: "cam-1", sourceRevision: "rev-1" },
    ]);
    bridge.registerStroke(
      [{ sourceNodeId: "table-1", cameraId: "cam-1", sourceRevision: "rev-1" }],
      "freeze",
    );

    const affected = bridge.findAffectedStrokes(["wall-1", "table-1"]);
    // table-1 stroke is frozen, so only wall-1 is affected
    expect(affected.length).toBe(1);
    expect(affected[0].anchors[0].sourceNodeId).toBe("wall-1");
  });

  it("reprojects all strokes to 2D canvas coordinates using camera perspective", () => {
    const bridge = new Studio3DLinkedInkBridge();
    bridge.registerStroke(
      [
        { sourceNodeId: "wall-1", worldPoint: [0, 1.0, 0] },
        { sourceNodeId: "wall-1", worldPoint: [0.5, 1.0, 0] },
      ],
      "follow-3d",
      { offsetPixels: [[2, 2], [2, 2]], thicknessScale: 1.2, smoothingLevel: 0 },
    );

    const reprojected = bridge.reprojectAllStrokes(dummyCamera);
    expect(reprojected.size).toBe(1);
    const pts = reprojected.get("ink-1");
    expect(pts).toBeDefined();
    expect(pts?.length).toBe(2);
    // Center point should be near viewport center (500, 500)
    expect(pts![0][0]).toBeGreaterThan(400);
    expect(pts![0][0]).toBeLessThan(600);
  });

  it("diagnoses stroke health under camera perspective and backface culling", () => {
    const bridge = new Studio3DLinkedInkBridge();
    const stroke = bridge.registerStroke([
      {
        sourceNodeId: "cube-1",
        worldPoint: [0, 1, 0],
        normal: [0, 0, 1], // Facing camera
      },
    ]);

    const health = bridge.diagnoseStrokeHealth(stroke.id, dummyCamera, new Set(["cube-1"]));
    expect(health?.status).toBe("healthy");
    expect(health?.confidence).toBe(1.0);
  });

  it("freezes strokes to disconnect from 3D", () => {
    const bridge = new Studio3DLinkedInkBridge();
    const stroke = bridge.registerStroke([
      { sourceNodeId: "node-1", cameraId: "cam-1", sourceRevision: "rev-1" },
    ]);

    bridge.freezeStroke(stroke.id);
    expect(bridge.getStroke(stroke.id)?.regenerationPolicy).toBe("freeze");
  });

  it("generates SVG overlay markup for 2D composite", () => {
    const bridge = new Studio3DLinkedInkBridge();
    bridge.registerStroke([
      { sourceNodeId: "n-1", worldPoint: [0, 0, 0] },
      { sourceNodeId: "n-1", worldPoint: [1, 1, 0] },
    ]);
    bridge.reprojectAllStrokes(dummyCamera);

    const svg = bridge.generateSvgOverlay(1000, 1000);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    expect(svg).toContain("stroke=");
  });
});
