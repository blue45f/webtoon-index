import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";

const inspectorSource = readStudioInspectorAsideSurface();

function firstSelfClosingTag(source: string, componentName: string): string {
  const start = source.indexOf(`<${componentName}`);
  if (start < 0) return "";
  const end = source.indexOf("/>", start);
  return end < 0 ? "" : source.slice(start, end + 2);
}

describe("Studio retouch tutorial routing boundary", () => {
  it.each([
    ["StudioSmudgePanel", "smudge"],
    ["StudioWetMixPanel", "wet-mix"],
    ["StudioDodgeBurnPanel", "dodge-burn"],
    ["StudioLiquifyPanel", "liquify"],
  ])("routes %s to its matching detailed tutorial", (componentName, tutorialId) => {
    const tag = firstSelfClosingTag(inspectorSource, componentName);

    expect(tag).not.toBe("");
    expect(tag).toContain(`onOpenTutorial={() => openFeatureTutorial("${tutorialId}")}`);
  });
});
