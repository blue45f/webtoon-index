// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAvatarForgeState } from "./studio-vrm-avatar-forge";
import {
  countStudioVrmAvatarForgeChanges,
  describeStudioVrmAvatarForgeState,
  StudioVrmAvatarForgePreview,
} from "./StudioVrmAvatarForgePreview";

describe("StudioVrmAvatarForgePreview", () => {
  it("renders deterministic visual metadata for a real recipe", () => {
    const state = createAvatarForgeState("wave-diva");
    render(<StudioVrmAvatarForgePreview state={state} label="웨이브 디바 미리보기" />);

    const preview = screen.getByRole("img", { name: "웨이브 디바 미리보기" });
    expect(preview.getAttribute("data-forge-preview")).toBe("true");
    expect(preview.getAttribute("data-hair-style")).toBe(state.hair.style);
    expect(preview.querySelectorAll("path").length).toBeGreaterThan(4);
  });

  it("describes and counts only visible authoring changes", () => {
    const baseline = createAvatarForgeState();
    const changed = createAvatarForgeState();
    changed.face = { ...changed.face, headWidth: 1.1 };
    changed.hair = { ...changed.hair, style: "bob", baseColor: "#112233" };

    const summary = describeStudioVrmAvatarForgeState(changed, baseline);
    expect(summary.face).toContain("둥근");
    expect(summary.hair).toBe("보브");
    expect(summary.changedControls).toBe(countStudioVrmAvatarForgeChanges(changed, baseline));
    expect(summary.changedControls).toBeGreaterThanOrEqual(3);
  });
});
