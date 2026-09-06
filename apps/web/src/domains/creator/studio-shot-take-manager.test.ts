import { describe, expect, it } from "vitest";

import {
  addShotTake,
  blendCompositeTake,
  createShotTakeCollection,
  lockApprovedTake,
  selectHeroTake,
  type ShotTake,
} from "./studio-shot-take-manager";

describe("Studio Shot Take Manager", () => {
  function makeTake(id: string, label: string, partial: Partial<ShotTake> = {}): ShotTake {
    return {
      id,
      shotId: "shot_1",
      takeLabel: label,
      evaluation: "alternate",
      camera: { angle: "front", zoom: 1.0, fovDeg: 45 },
      poseExpression: { poseRef: "stand", expressionRef: "neutral" },
      lighting: { preset: "day", intensity: 1.0 },
      createdAtMs: 1_000,
      ...partial,
    };
  }

  it("manages takes and updates active hero take automatically", () => {
    let coll = createShotTakeCollection({ shotId: "shot_1" });
    const takeA = makeTake("t_a", "Take A - Front", { evaluation: "selected" });
    const takeB = makeTake("t_b", "Take B - Low Angle", { camera: { angle: "low", zoom: 1.2 } });

    coll = addShotTake(coll, takeA);
    expect(coll.activeHeroTakeId).toBe("t_a");

    coll = addShotTake(coll, takeB);
    expect(coll.takes).toHaveLength(2);
    expect(coll.activeHeroTakeId).toBe("t_a");

    // Select Take B as hero
    coll = selectHeroTake(coll, "t_b", "로우 앵글이 더 박진감 넘침");
    expect(coll.activeHeroTakeId).toBe("t_b");
    expect(coll.takes.find((t) => t.id === "t_b")?.evaluation).toBe("selected");
    expect(coll.takes.find((t) => t.id === "t_a")?.evaluation).toBe("alternate");
  });

  it("locks approved take", () => {
    let coll = createShotTakeCollection({ shotId: "shot_1" });
    coll = addShotTake(coll, makeTake("t_1", "Take 1", { evaluation: "selected" }));
    coll = lockApprovedTake(coll, "t_1");

    expect(coll.takes[0].isApprovedLock).toBe(true);
    expect(coll.activeHeroTakeId).toBe("t_1");
  });

  it("blends elements across multiple takes into a new composite take", () => {
    let coll = createShotTakeCollection({ shotId: "shot_1" });
    const takeCam = makeTake("t_cam", "Take 1 - High Angle", { camera: { angle: "high", zoom: 1.5 } });
    const takeLight = makeTake("t_light", "Take 2 - Night", { lighting: { preset: "night", intensity: 0.8 } });
    const takePose = makeTake("t_pose", "Take 3 - Furious", { poseExpression: { expressionRef: "rage" } });

    coll = addShotTake(coll, takeCam);
    coll = addShotTake(coll, takeLight);
    coll = addShotTake(coll, takePose);

    coll = blendCompositeTake(coll, {
      newTakeId: "t_blend_1",
      newTakeLabel: "Take Combo 1",
      cameraFromTakeId: "t_cam",
      lightingFromTakeId: "t_light",
      poseFromTakeId: "t_pose",
      nowMs: 5_000,
    });

    const blended = coll.takes.find((t) => t.id === "t_blend_1")!;
    expect(blended).toBeDefined();
    expect(blended.camera.angle).toBe("high");
    expect(blended.lighting?.preset).toBe("night");
    expect(blended.poseExpression?.expressionRef).toBe("rage");
    expect(coll.activeHeroTakeId).toBe("t_blend_1");
  });
});
