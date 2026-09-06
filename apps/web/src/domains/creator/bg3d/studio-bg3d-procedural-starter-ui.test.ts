import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS } from "./studio-bg3d-procedural-starter-pack";
import {
  describeStudioBg3dProceduralInsertionFailure,
  filterStudioBg3dProceduralStarterAssets,
} from "./studio-bg3d-procedural-starter-ui";

describe("studio BG3D procedural starter UI model", () => {
  it("searches Korean, English tags, descriptions, and category labels", () => {
    expect(
      filterStudioBg3dProceduralStarterAssets(
        STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
        { query: "crosswalk", category: "all" },
      ).map((asset) => asset.id),
    ).toEqual(["ts3d-crosswalk-street-v1"]);

    expect(
      filterStudioBg3dProceduralStarterAssets(
        STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
        { query: "문·창호", category: "all" },
      ),
    ).toHaveLength(2);

    expect(
      filterStudioBg3dProceduralStarterAssets(
        STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
        { query: "  작업   ", category: "furniture" },
      ).map((asset) => asset.id),
    ).toEqual(["ts3d-writing-desk-v1"]);
  });

  it("combines category and search filters without mutating the source", () => {
    const sourceIds = STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS.map((asset) => asset.id);
    const result = filterStudioBg3dProceduralStarterAssets(
      STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
      { query: "가구", category: "furniture" },
    );

    expect(result).toHaveLength(6);
    expect(STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS.map((asset) => asset.id)).toEqual(sourceIds);
  });

  it("provides an actionable message for every insertion failure", () => {
    const reasons = [
      "unknown-asset",
      "invalid-instance-id",
      "instance-id-exhausted",
      "node-id-collision",
      "invalid-transform",
      "invalid-budget",
      "node-budget-exceeded",
      "triangle-budget-exceeded",
      "draw-call-budget-exceeded",
      "material-budget-exceeded",
    ] as const;

    for (const reason of reasons) {
      expect(describeStudioBg3dProceduralInsertionFailure(reason).length).toBeGreaterThan(12);
    }
  });
});
