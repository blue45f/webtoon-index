import { describe, it, expect } from "vitest";

import { Studio3DShotManager } from "./studio-3d-shot-override-manager";

describe("Studio3DShotManager", () => {
  it("initializes with active shot and default camera", () => {
    const manager = new Studio3DShotManager("shot-1", "Front View");
    const active = manager.getActiveShot();
    expect(active.shotId).toBe("shot-1");
    expect(active.name).toBe("Front View");
    expect(active.camera.fov).toBe(45);
  });

  it("adds and switches active shots with camera and node overrides", () => {
    const manager = new Studio3DShotManager("shot-1", "Front");
    manager.addShot("shot-2", "High Angle Close-Up", "close-up");
    manager.setActiveShot("shot-2");

    manager.setCameraTransform("shot-2", { fov: 60, position: [0, 5, 2] });
    manager.setNodeOverride("shot-2", "wall-north", { visible: false });

    const active = manager.getActiveShot();
    expect(active.shotId).toBe("shot-2");
    expect(active.camera.fov).toBe(60);
    expect(active.nodeOverrides["wall-north"].visible).toBe(false);
  });

  it("links focal length in mm to camera field of view", () => {
    const manager = new Studio3DShotManager("shot-1", "Main");
    manager.setCameraTransform("shot-1", { focalLengthMm: 24 });
    // 24mm wide angle should result in wider FOV (>70 deg)
    expect(manager.getActiveShot().camera.fov).toBeGreaterThan(70);
  });

  it("audits storyboard continuity across consecutive panels", () => {
    const manager = new Studio3DShotManager("shot-1", "Panel 1 Wide");
    manager.getActiveShot().characterEquippedProps = {
      hero: ["sword-excalibur", "shield"],
    };
    manager.getActiveShot().lightOverrides = {
      direction: [1, 1, 0],
    };

    // Shot 2: Opposite camera angle (180-degree flip) & missing sword
    const shot2 = manager.addShot("shot-2", "Panel 2 Close-up", "close-up", false);
    shot2.camera.position = [0, 1.5, -3.5]; // Looking opposite
    shot2.camera.target = [0, 1.2, 0];
    shot2.characterEquippedProps = {
      hero: ["shield"], // sword dropped
    };
    shot2.lightOverrides = {
      direction: [-1, -1, 0], // Reverted lighting
    };

    const warnings = manager.auditContinuity();
    expect(warnings.length).toBeGreaterThan(0);

    const propWarning = warnings.find((w) => w.type === "prop-inconsistency");
    expect(propWarning).toBeDefined();
    expect(propWarning?.message).toContain("sword-excalibur");

    const lightWarning = warnings.find((w) => w.type === "lighting-flip");
    expect(lightWarning).toBeDefined();
  });

  it("supports JSON serialization and deserialization", () => {
    const manager = new Studio3DShotManager("shot-1", "Main");
    manager.addShot("shot-2", "Cut 2");
    manager.setCameraTransform("shot-2", { position: [1, 2, 3] });

    const json = manager.serialize();
    const manager2 = new Studio3DShotManager();
    manager2.deserialize(json);

    expect(manager2.listShots().length).toBe(2);
    expect(manager2.getActiveShot().shotId).toBe("shot-1");
  });
});
