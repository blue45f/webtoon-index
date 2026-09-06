import { describe, expect, it } from "vitest";

import {
  STUDIO_CLIP_WORKSPACE_RECOMMENDATION,
  resolveStudioWorkspaceRecommendation,
  studioWorkspaceSearchAliases,
} from "./studio-workspace-recommendation";
import { STUDIO_DEFAULT_WORKSPACES } from "./studio-workspaces";

describe("Studio Clip Studio workspace recommendation model", () => {
  it("resolves the existing built-in by stable id with migration-friendly aliases", () => {
    const recommendation = resolveStudioWorkspaceRecommendation(
      STUDIO_DEFAULT_WORKSPACES,
      "storyboard"
    );

    expect(recommendation?.workspace.id).toBe("csp-migration");
    expect(recommendation?.workspace.name).toBe("클립 스튜디오형");
    expect(recommendation?.actionLabel).toBe("이 배치 사용");
    expect(studioWorkspaceSearchAliases("csp-migration")).toEqual(
      expect.arrayContaining(["CSP", "Clip Studio", "클튜"])
    );
  });

  it("does not compete with the current-workspace summary after activation", () => {
    expect(
      resolveStudioWorkspaceRecommendation(
        STUDIO_DEFAULT_WORKSPACES,
        STUDIO_CLIP_WORKSPACE_RECOMMENDATION.workspaceId
      )
    ).toBeNull();
  });

  it("fails closed if the referenced built-in is unavailable", () => {
    expect(resolveStudioWorkspaceRecommendation([], "storyboard")).toBeNull();
    expect(studioWorkspaceSearchAliases("storyboard")).toEqual([]);
  });
});
