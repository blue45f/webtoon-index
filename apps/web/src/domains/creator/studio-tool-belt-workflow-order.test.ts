import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./StudioToolBeltCreateModeGroups.tsx", import.meta.url),
  "utf8",
);

function position(marker: string): number {
  const index = source.indexOf(marker);
  expect(index, `missing workflow marker: ${marker}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("Studio ToolBelt workflow order", () => {
  it("keeps primary authoring actions before specialist reference and AI surfaces", () => {
    const order = [
      position('"toolbar-assets"'),
      position('"toolbar-cut"'),
      position('"toolbar-draw"'),
      position("<StudioToolBeltCreateModeInsertTools"),
      position('"toolbar-reference"'),
      position('"toolbar-scene"'),
      position('"toolbar-style"'),
      position('"toolbar-ai"'),
      position("<StudioToolBeltCreateModeUtilityButtons"),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("mounts every creation group once so reordering cannot duplicate actions", () => {
    for (const marker of [
      "<StudioToolBeltCreateModeInsertTools",
      'id="asset-group"',
      'id="bg-group"',
      'id="style-group"',
      'id="ai-group"',
      "<StudioToolBeltCreateModeUtilityButtons",
    ]) {
      expect(source.split(marker)).toHaveLength(2);
    }
  });
});
