import { describe, expect, it } from "vitest";

import {
  isStudioBg3dPhysicsTransientPhase,
  STUDIO_BG3D_PHYSICS_GRAVITY,
  type StudioBg3dPhysicsPhase,
} from "./studio-bg3d-physics-ui";

describe("Studio BG3D physics UI contracts", () => {
  it("keeps authoring locked for every preview-owned phase", () => {
    const phases: readonly StudioBg3dPhysicsPhase[] = [
      "idle",
      "loading",
      "running",
      "paused",
      "complete",
      "baking",
      "error",
    ];

    expect(phases.filter(isStudioBg3dPhysicsTransientPhase)).toEqual([
      "loading",
      "running",
      "paused",
      "complete",
      "baking",
    ]);
  });

  it("exposes immutable, finite gravity presets", () => {
    expect(STUDIO_BG3D_PHYSICS_GRAVITY).toEqual({
      earth: [0, -9.81, 0],
      moon: [0, -1.62, 0],
      zero: [0, 0, 0],
    });
    expect(Object.isFrozen(STUDIO_BG3D_PHYSICS_GRAVITY)).toBe(true);
    expect(Object.values(STUDIO_BG3D_PHYSICS_GRAVITY).every(Object.isFrozen)).toBe(true);
    expect(
      Object.values(STUDIO_BG3D_PHYSICS_GRAVITY).flat().every(Number.isFinite),
    ).toBe(true);
  });
});
